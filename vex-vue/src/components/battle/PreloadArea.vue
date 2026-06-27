<script setup lang="ts">
// ══════════════════════════════════════════════════
// 装填区 / Preload Area
//
// 替代现有 vex/js/battle-preload.js 的模块内部状态 + DOM 渲染逻辑。
// - 上半区：技能列表（v-for 渲染，替代 renderSkillList 的 innerHTML）
// - 下半区：AP 进度条（预测扣除段）+ 装填队列 + 执行/清空按钮
//
// 两种模式：
// - 'pre-battle'：玩家点击敌人后、战斗开始前。执行 → obl_battle_start
// - 'in-battle'：战斗中玩家回合。执行 → obl_battle_action
//
// 瞄准模式（target=enemy 且无 enemyPid 时触发）：
// - 进入瞄准 → broadcast 'battle:aim-mode' → AimMode 组件接管地图选目标
// - 选定目标 → AimMode broadcast 'battle:aim-target-selected' → 本组件 onTargetSelect
// - 退出瞄准 → broadcast 'battle:aim-exit'
// ══════════════════════════════════════════════════

import { ref, computed, onMounted, onUnmounted } from 'vue';
import { dataManager } from '@/stores/data-manager';
import { commandQueue } from '@/stores/command-queue';
import { useMapStore } from '@/stores/map';
import { useToastStore } from '@/stores/toast';
import { getSkillTemplate } from '@/data/skill-templates';
import type { Skill } from '@/types/api';
import type { PreloadInitEventData } from '@/types/events';

// ── 状态 ──
const mode = ref<'pre-battle' | 'in-battle' | ''>('');
const skills = ref<Skill[]>([]);
const playerAp = ref<number>(0);
const playerMaxAp = ref<number>(0);
interface QueueItem {
  id: number;
  act_id: string;
  target: number;
}
const queue = ref<QueueItem[]>([]);
let queueIdSeed = 0;
const aimMode = ref<boolean>(false);
const pendingActId = ref<string | null>(null);
const enemyPid = ref<number>(0);
const playerPid = ref<number>(0);

const mapStore = useMapStore();

// ══════════════════════════════════════════════════
// 初始化（监听 battle:preload-init 事件）
// ══════════════════════════════════════════════════

async function initPreloadArea(data: PreloadInitEventData): Promise<void> {
  mode.value = data.mode;
  enemyPid.value = data.enemyPid || 0;
  playerPid.value = data.playerPid || 0;
  queue.value = [];
  aimMode.value = false;
  pendingActId.value = null;

  await fetchSkillList();
}

async function fetchSkillList(): Promise<void> {
  try {
    const result = await dataManager.fetch('skill_list', true);
    if (result.status === 'success' && result.data) {
      const data = result.data as {
        skills?: Skill[];
        player_ap?: string | number;
        player_max_ap?: string | number;
      };
      skills.value = data.skills || [];
      playerAp.value = parseInt(String(data.player_ap)) || 0;
      playerMaxAp.value = parseInt(String(data.player_max_ap)) || 0;
    } else {
      skills.value = [];
      playerAp.value = 0;
      playerMaxAp.value = 0;
    }
  } catch (e) {
    console.error('[Preload] fetchSkillList error:', e);
    useToastStore().showToast('技能列表加载失败，请重进战斗', 'error', 4000, false, 'skill-fetch');
    skills.value = [];
    playerAp.value = 0;
    playerMaxAp.value = 0;
  }
}

// ══════════════════════════════════════════════════
// AP 进度条计算
// ══════════════════════════════════════════════════

/** 队列累计 AP 消耗 */
const queueCost = computed<number>(() => {
  return queue.value.reduce((sum, item) => {
    const skill = skills.value.find((s) => s.act_id === item.act_id);
    return sum + (skill ? Number(skill.apcost || 0) : 0);
  }, 0);
});

/** 预测剩余 AP */
const predictedAp = computed<number>(() => Math.max(0, playerAp.value - queueCost.value));

/** 进度条比例 */
const apBar = computed(() => {
  const maxAp = playerMaxAp.value > 0 ? playerMaxAp.value : 1;
  const currentRatio = (playerAp.value / maxAp) * 100;
  const costRatio = (queueCost.value / maxAp) * 100;
  const remainingRatio = Math.max(0, currentRatio - costRatio);
  return {
    currentRatio,
    costRatio,
    remainingRatio,
  };
});

// ══════════════════════════════════════════════════
// 技能点击处理
// ══════════════════════════════════════════════════

function onSkillClick(actId: string): void {
  const skill = skills.value.find((s) => s.act_id === actId);
  if (!skill || !skill.available) return;

  // 瞄准模式下再次点击同一技能 → 退出瞄准（toggle）
  if (aimMode.value && pendingActId.value === actId) {
    exitAimMode();
    return;
  }

  // 有 CD 定义的技能在队列中只能出现一次
  if (Number(skill.cd) > 0 && queue.value.some((item) => item.act_id === actId)) {
    useToastStore().showToast('该技能有冷却，无法重复装填', 'warning', 3000);
    return;
  }

  // 终结技在队列中只能出现一次
  if (Number(skill.finisher) > 0 && queue.value.some((item) => item.act_id === actId)) {
    useToastStore().showToast('终结技已存在，无法重复装填', 'warning', 3000);
    return;
  }

  if (skill.target === 'self') {
    // self 目标：直接加入队列，target 为玩家自己的 PID
    addToQueue(actId, playerPid.value);
  } else {
    // enemy 目标：MVP 单敌人战斗，直接使用当前敌人 PID
    // 未来多敌人时可启用瞄准模式：enterAimMode(actId)
    if (enemyPid.value > 0) {
      addToQueue(actId, enemyPid.value);
    } else {
      enterAimMode(actId);
    }
  }
}

/** 技能按钮 class 计算 */
function skillButtonClass(skill: Skill): string {
  const disabled = !skill.available;
  return disabled
    ? 'opacity-40 cursor-not-allowed'
    : 'hover:border-fg-mid hover:bg-fg-dim/10 cursor-pointer turn-active';
}

/** 技能 CD 文本 */
function skillCdText(skill: Skill): string {
  if (skill.on_cd) {
    return ` CD:${Math.max(0, Number(skill.cd) - (Number(skill.current_tick) - Number(skill.lstact)))}t`;
  }
  if (Number(skill.cd) > 0) {
    return ` CD:${skill.cd}t`;
  }
  return '';
}

// ══════════════════════════════════════════════════
// 瞄准模式
// ══════════════════════════════════════════════════

function enterAimMode(actId: string): void {
  aimMode.value = true;
  pendingActId.value = actId;
  dataManager.broadcast('battle:aim-mode', { actId });
}

function exitAimMode(): void {
  aimMode.value = false;
  pendingActId.value = null;
  dataManager.broadcast('battle:aim-exit');
}

/** 瞄准模式下选择目标（监听 battle:aim-target-selected 事件） */
function onTargetSelect(data: unknown): void {
  if (!aimMode.value || !pendingActId.value) return;
  const pid = typeof data === 'number' ? data : (data as { pid?: number })?.pid;
  if (typeof pid !== 'number') return;
  // 不再写入 enemyPid：避免污染后续技能的目标选择
  // enemyPid 只应由 initPreloadArea 设置（来自 battleStore.currentEnemyPid）
  // 瞄准选中的 pid 直接传入 addToQueue，用完即弃
  addToQueue(pendingActId.value, pid);
  exitAimMode();
}

/** 瞄准模式退出（监听 battle:aim-exit 事件，如 ESC 退出） */
function onAimExit(): void {
  // 同步重置瞄准状态（AimMode 组件已广播 battle:aim-exit，本组件需同步状态）
  aimMode.value = false;
  pendingActId.value = null;
}

// ══════════════════════════════════════════════════
// 队列操作
// ══════════════════════════════════════════════════

function addToQueue(actId: string, targetPid: number): void {
  const skill = skills.value.find((s) => s.act_id === actId);
  const isFinisher = skill ? Number(skill.finisher) > 0 : false;

  if (isFinisher) {
    queue.value.push({ id: ++queueIdSeed, act_id: actId, target: targetPid });
  } else {
    // 普通技：如果队列有终结技，插入到它前面
    const finisherIdx = queue.value.findIndex((item) => {
      const s = skills.value.find((sk) => sk.act_id === item.act_id);
      return s ? Number(s.finisher) > 0 : false;
    });
    if (finisherIdx >= 0) {
      queue.value.splice(finisherIdx, 0, { id: ++queueIdSeed, act_id: actId, target: targetPid });
    } else {
      queue.value.push({ id: ++queueIdSeed, act_id: actId, target: targetPid });
    }
  }
}

function removeFromQueue(index: number): void {
  if (index < 0 || index >= queue.value.length) return;
  queue.value.splice(index, 1);
}

function clearQueue(): void {
  queue.value = [];
}

/** 根据 PID 查询目标显示文本 */
function getTargetDisplayText(targetPid: number): string {
  const pid = parseInt(String(targetPid));
  if (pid === parseInt(String(playerPid.value))) return '自己';

  const enemy = mapStore.enemies.find(
    (e) => parseInt(String(e.pid)) === pid && parseInt(String(e.state)) === 0,
  );
  if (enemy) {
    return `位于位置${enemy.pls}的 ${enemy.name}`;
  }
  return `目标${pid}`;
}

// ══════════════════════════════════════════════════
// 执行装填队列
// ══════════════════════════════════════════════════

async function onExecute(): Promise<void> {
  if (queue.value.length === 0) return;
  if (commandQueue.isLocked) return;

  const actions = queue.value.slice();

  let result;
  if (mode.value === 'pre-battle') {
    result = await commandQueue.execute({
      command: 'obl_battle_start',
      actions: JSON.stringify(actions),
    });
  } else {
    result = await commandQueue.execute({
      command: 'obl_battle_action',
      actions: JSON.stringify(actions),
    });
  }

  // 清空队列和瞄准状态
  queue.value = [];
  mode.value = '';
  if (aimMode.value) {
    exitAimMode();
  }

  // 广播执行完成事件，battleStore 监听后刷新
  dataManager.broadcast('preload:executed', { result });
}

// ══════════════════════════════════════════════════
// 生命周期
// ══════════════════════════════════════════════════

function onPreloadInit(data: unknown): void {
  if (data) initPreloadArea(data as PreloadInitEventData);
}

function onBattleEnded(): void {
  mode.value = '';
  queue.value = [];
  aimMode.value = false;
  pendingActId.value = null;
  enemyPid.value = 0;
  playerPid.value = 0;
}

onMounted(() => {
  dataManager.listen('battle:preload-init', onPreloadInit);
  dataManager.listen('battle:aim-target-selected', onTargetSelect);
  dataManager.listen('battle:aim-exit', onAimExit);
  dataManager.listen('battle:ended', onBattleEnded);
});

onUnmounted(() => {
  dataManager.unlisten('battle:preload-init', onPreloadInit);
  dataManager.unlisten('battle:aim-target-selected', onTargetSelect);
  dataManager.unlisten('battle:aim-exit', onAimExit);
  dataManager.unlisten('battle:ended', onBattleEnded);
});

// 暴露方法供外部调用（如 StatusBar 的退出瞄准按钮）
defineExpose({
  exitAimMode,
});
</script>

<template>
  <div class="flex flex-col h-full min-h-0">
    <!-- 上半区：技能列表（动态高度，上限 60% 滚动） -->
    <div class="overflow-y-auto min-h-0 max-h-[60%]">
      <div v-if="skills.length === 0" class="text-fg-dim text-[10px] py-2 text-center">
        无可用技能
      </div>
      <button
        v-for="skill in skills"
        :key="skill.act_id"
        class="obl-btn w-full text-left px-2 py-1.5 mb-1 transition-colors"
        :class="skillButtonClass(skill)"
        :disabled="!skill.available"
        @click="onSkillClick(skill.act_id)"
      >
        <span class="text-fg-bright font-bold">[{{ getSkillTemplate(skill.act_id).name }}]</span>
        <span class="text-fg-dim text-[10px] ml-2">{{ getSkillTemplate(skill.act_id).desc }}</span>
        <span class="text-fg-dim text-[10px] ml-2">
          {{ Number(skill.apcost) > 0 ? ` AP:${skill.apcost}` : '' }}{{ skillCdText(skill) }}
        </span>
      </button>
    </div>

    <!-- 下半区：AP + 队列 + 执行按钮（flex-1 占满剩余空间） -->
    <div class="flex-1 border-t border-fg-dim/20 pt-2 overflow-y-auto min-h-0">
      <!-- AP 显示 — 进度条式预测扣除 -->
      <div class="mb-2">
        <!-- 数值行 -->
        <div class="flex items-center justify-between mb-1 px-1">
          <span class="text-fg-bright text-[12px] font-bold tracking-wider">AP</span>
          <span v-if="queueCost > 0" class="text-fg-bright text-[13px] font-bold">
            {{ playerAp }} → {{ predictedAp }}
            <span class="text-red text-[10px]">(-{{ queueCost }})</span>
          </span>
          <span v-else class="text-fg-bright text-[13px] font-bold">
            {{ playerAp }} / {{ playerMaxAp }}
          </span>
        </div>
        <!-- 进度条 -->
        <div class="bar-container ap-bar-container">
          <!-- 预测剩余段（亮色）：从左开始 -->
          <div
            class="bar-fill ap-remaining"
            :style="{ width: apBar.remainingRatio + '%' }"
          ></div>
          <!-- 预测扣除段（警告色）：从剩余段右边缘开始 -->
          <div
            v-if="apBar.costRatio > 0"
            class="bar-fill ap-cost"
            :style="{ left: apBar.remainingRatio + '%', width: Math.min(apBar.costRatio, apBar.currentRatio) + '%' }"
          ></div>
        </div>
      </div>

      <!-- 队列标签 -->
      <div class="text-fg-mid text-[11px] mb-1 px-1">
        装填队列 ({{ queue.length }})
      </div>

      <!-- 队列项 -->
      <div
        v-if="queue.length === 0"
        class="text-fg-dim text-[11px] py-2 text-center border border-dashed border-fg-dim/30"
      >
        点击上方技能加入队列
      </div>
      <div
        v-for="(item, i) in queue"
        :key="item.id"
        class="obl-btn flex items-center justify-between px-2 py-1.5 mb-1"
      >
        <span class="text-fg-mid text-[11px]">
          [{{ getSkillTemplate(item.act_id).name }}] → {{ getTargetDisplayText(item.target) }}
        </span>
        <button
          class="text-fg-dim hover:text-red text-[11px] px-1 transition-colors"
          @click="removeFromQueue(i)"
        >
          [x]
        </button>
      </div>

      <!-- 操作按钮 -->
      <div v-if="queue.length > 0" class="flex gap-1 mt-2">
        <button
          class="obl-btn turn-active flex-1 px-2 py-2 hover:border-fg-mid hover:bg-fg-dim/10 transition-colors cursor-pointer"
          @click="onExecute"
        >
          <span class="text-fg-bright font-bold">[执行]</span>
        </button>
        <button
          class="obl-btn flex-none px-2 py-2 hover:border-red hover:text-red transition-colors cursor-pointer"
          @click="clearQueue"
        >
          <span class="text-fg-mid text-[11px]">[清空]</span>
        </button>
      </div>
    </div>
  </div>
</template>
