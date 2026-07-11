<script setup lang="ts">
// ══════════════════════════════════════════════════
// 装填区 / Preload Area
//
// 替代现有 vex/js/battle-preload.js 的模块内部状态 + DOM 渲染逻辑。
// - 上半区：技能列表（v-for 渲染，替代 renderSkillList 的 innerHTML）
// - 下半区：AP 进度条（预测扣除段）+ 装填队列 + 执行/清空按钮
//
// 两种模式：
// - 'pre-battle'：玩家点击敌人后、战斗开始前。执行 → battle.start
// - 'in-battle'：战斗中玩家回合。执行 → battle.submit_turn
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
import { useCharacterStore } from '@/stores/character';
import { useBattleStore } from '@/stores/battle';
import { useToastStore } from '@/stores/toast';
import { findPath } from '@/composables/useMapReachability';
import { getSkillTemplate } from '@/data/skill-templates';
import { findSelectableCombatTarget } from '@/utils/combat-targeting';
import type { Skill, CombatAimIntent, CombatViewModel, CombatTargetViewModel, CombatantViewModel } from '@/types/api';
import type { Character } from '@/types/character';
import type { PreloadInitEventData } from '@/types/events';
import { estimateMoveActionCost, getSkillBaseRange } from '@/utils/combat-action-cost';

// ── 状态 ──
const mode = ref<'pre-battle' | 'in-battle' | ''>('');
const skills = ref<Skill[]>([]);
// 前端过滤 hidden 技能（后端正常返回，前端不显示）
const visibleSkills = computed(() => skills.value.filter(s => !s.hidden));
const playerAp = ref<number>(0);
const playerMaxAp = ref<number>(0);
type TargetIntent = CombatAimIntent;
interface QueueItem {
  id: number;
  act_id: string;
  target: TargetIntent;
}
const queue = ref<QueueItem[]>([]);
let queueIdSeed = 0;
const aimMode = ref<boolean>(false);
const pendingActId = ref<string | null>(null);
const pendingTargetMode = ref<'enemy' | 'tile'>('enemy');
const enemyPid = ref<number>(0);
const playerPid = ref<number>(0);
const combatContext = ref<CombatViewModel | null>(null);
const sessionKey = ref<string>('');

const mapStore = useMapStore();
const characterStore = useCharacterStore();
const battleStore = useBattleStore();

// ══════════════════════════════════════════════════
// 初始化（监听 battle:preload-init 事件）
// ══════════════════════════════════════════════════

async function initPreloadArea(data: PreloadInitEventData): Promise<void> {
  const nextQid = data.combatContext?.qid ?? null;
  const nextSessionKey = data.mode === 'in-battle'
    ? `in-battle:${nextQid ?? 'none'}`
    : `pre-battle:${data.playerPid || 0}`;
  if (sessionKey.value === nextSessionKey) {
    onPreloadContextRefresh(data);
    await fetchSkillList();
    return;
  }
  sessionKey.value = nextSessionKey;
  mode.value = data.mode;
  combatContext.value = data.combatContext || null;
  enemyPid.value = data.mode === 'pre-battle'
    ? (data.enemyPid || battleStore.combatTargets.suggestedTargetPid || 0)
    : (battleStore.combatTargets.suggestedTargetPid || combatContext.value?.suggestedTargetPid || data.enemyPid || 0);
  playerPid.value = data.playerPid || 0;
  queue.value = [];
  aimMode.value = false;
  pendingActId.value = null;
  pendingTargetMode.value = 'enemy';

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
  return estimateQueueCost(queue.value);
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


function normalizePls(pls: string | number | null | undefined): number | null {
  if (pls === null || pls === undefined) return null;
  const n = Number(pls);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * 获取战斗中玩家自身信息
 *
 * 数据源：CharacterHub（characterStore.player）。
 * 未加载时回退到 combatContext.combatants 中的玩家元素，保留原逻辑兜底。
 */
function getCombatPlayer(): Character | CombatantViewModel | null {
  const player = characterStore.player;
  if (player) return player;
  // 回退：CharacterHub 未加载时（初始化时序差），从 combatContext 找玩家
  const ctx = combatContext.value;
  if (!ctx) return null;
  return ctx.combatants.find((c) => Number(c.pid) === Number(ctx.playerPid)) || null;
}

/**
 * 获取目标信息（用于射程判断和目标显示）
 *
 * 数据源：combatContext.validTargets（保留，战斗规则过滤后的合法目标集合）
 * → characterStore.getCharacter(pid)（回退，角色完整状态）
 */
function getCombatTarget(pid: number): CombatTargetViewModel | Character | null {
  const ctx = combatContext.value;
  if (ctx) {
    const validTarget = ctx.validTargets.find((target) => Number(target.pid) === Number(pid));
    if (validTarget) return validTarget;
  }
  // 回退：从 CharacterHub 查询（覆盖非战斗 NPC、战斗中但不在 validTargets 的目标等场景）
  return characterStore.getCharacter(pid) || null;
}

function getActorBasePls(): number | null {
  return normalizePls(characterStore.player?.pls ?? getCombatPlayer()?.pls ?? mapStore.curLoc);
}

function getTileDistanceFrom(fromPls: number | null, targetPls: number): number | null {
  if (fromPls === null) return null;
  const path = findPath(fromPls, targetPls);
  if (!path) return null;
  return Math.max(0, path.length - 1);
}

function estimateActionCostFrom(item: QueueItem, fromPls: number | null): number {
  const skill = skills.value.find((s) => s.act_id === item.act_id);
  if (!skill) return 0;

  if (skill.act_id === 'move' && item.target.type === 'tile') {
    const distance = getTileDistanceFrom(fromPls, item.target.id);
    return estimateMoveActionCost(skill, distance);
  }

  return Number(skill.apcost || 0);
}

function estimateQueueCost(items: QueueItem[]): number {
  let total = 0;
  let plannedLoc = getActorBasePls();
  for (const item of items) {
    total += estimateActionCostFrom(item, plannedLoc);
    if (item.act_id === 'move' && item.target.type === 'tile') {
      plannedLoc = item.target.id;
    }
  }
  return total;
}

function getPlannedActorPls(): number | null {
  let plannedLoc = getActorBasePls();
  for (const item of queue.value) {
    if (item.act_id === 'move' && item.target.type === 'tile') {
      plannedLoc = item.target.id;
    }
  }
  return plannedLoc;
}

function estimateActionCost(item: QueueItem): number {
  let plannedLoc = getActorBasePls();
  for (const queued of queue.value) {
    if (queued.id === item.id) {
      return estimateActionCostFrom(item, plannedLoc);
    }
    if (queued.act_id === 'move' && queued.target.type === 'tile') {
      plannedLoc = queued.target.id;
    }
  }
  return estimateActionCostFrom(item, plannedLoc);
}

function isEnemyInSkillRange(skill: Skill, targetPid: number, originPls: number | null = getActorBasePls()): boolean {
  if (originPls === null) return false;

  const combatTarget = getCombatTarget(targetPid);
  if (combatTarget) {
    const actorRegion = characterStore.player?.pgroup ?? getCombatPlayer()?.pgroup ?? mapStore.curRegion;
    if (String(combatTarget.pgroup) !== String(actorRegion)) return false;
    const path = findPath(originPls, combatTarget.pls);
    if (!path) return false;
    const distance = Math.max(0, path.length - 1);
    return distance <= getSkillBaseRange(skill);
  }

  // 兜底：getCombatTarget 已回退到 CharacterHub，此处不再需要 mapStore.enemies
  return false;
}

function skillRangeText(skill: Skill): string {
  if (skill.aimType !== 'pid') return '';
  return ` R:${getSkillBaseRange(skill)}`;
}

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

  if (skill.aimType === 'none') {
    addToQueue(actId, { type: 'none' });
  } else if (skill.aimType === 'self') {
    addToQueue(actId, { type: 'self' });
  } else if (skill.aimType === 'tile') {
    enterAimMode(actId, 'tile');
  } else {
    enterAimMode(actId, 'enemy');
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

function enterAimMode(actId: string, targetMode: 'enemy' | 'tile' = 'enemy'): void {
  const skill = skills.value.find((s) => s.act_id === actId);
  aimMode.value = true;
  pendingActId.value = actId;
  pendingTargetMode.value = targetMode;
  dataManager.broadcast('battle:aim-mode', {
    actId,
    ...(targetMode === 'enemy' ? { actionRange: getSkillBaseRange(skill) } : {}),
    targetMode,
    originPls: getPlannedActorPls(),
    focusedTargetPid: mode.value === 'pre-battle'
      ? (enemyPid.value || battleStore.combatTargets.suggestedTargetPid || null)
      : (battleStore.combatTargets.suggestedTargetPid || enemyPid.value || null),
    prefixActions: normalizeActions(queue.value),
  });
}

function exitAimMode(): void {
  aimMode.value = false;
  pendingActId.value = null;
  pendingTargetMode.value = 'enemy';
  dataManager.broadcast('battle:aim-exit');
}

/** 瞄准模式下选择目标（监听 battle:aim-target-selected 事件） */
function onTargetSelect(data: unknown): void {
  if (!aimMode.value || !pendingActId.value) return;
  if (pendingTargetMode.value === 'tile') {
    const pls = typeof data === 'number'
      ? data
      : (data as { pls?: number; id?: number })?.pls ?? (data as { id?: number })?.id;
    if (typeof pls !== 'number' || pls <= 0) return;

    addToQueue(pendingActId.value, { type: 'tile', id: pls });
    exitAimMode();
    return;
  }

  const pid = typeof data === 'number' ? data : (data as { pid?: number })?.pid;
  if (typeof pid !== 'number') return;

  const candidate = findSelectableCombatTarget(
    battleStore.combatTargets,
    battleStore.currentQid,
    pid,
    targetPid => characterStore.getCharacter(targetPid),
  );
  if (!candidate) {
    useToastStore().showToast('目标状态已变化，请重新选择', 'warning', 3000);
    return;
  }

  const skill = skills.value.find((s) => s.act_id === pendingActId.value);
  if (skill && !isEnemyInSkillRange(skill, pid, getPlannedActorPls())) {
    useToastStore().showToast('目标距离过远，无法装填该技能', 'warning', 3000);
    return;
  }

  // 瞄准选中的 pid 直接传入 addToQueue，用完即弃
  addToQueue(pendingActId.value, { type: 'pid', id: pid });
  exitAimMode();
}


/** 瞄准模式退出（监听 battle:aim-exit 事件，如 ESC 退出） */
function onAimExit(): void {
  // 同步重置瞄准状态（AimMode 组件已广播 battle:aim-exit，本组件需同步状态）
  aimMode.value = false;
  pendingActId.value = null;
  pendingTargetMode.value = 'enemy';
}

// ══════════════════════════════════════════════════
// 队列操作
// ══════════════════════════════════════════════════

function addToQueue(actId: string, target: TargetIntent): void {
  const skill = skills.value.find((s) => s.act_id === actId);
  const isFinisher = skill ? Number(skill.finisher) > 0 : false;

  if (isFinisher) {
    queue.value.push({ id: ++queueIdSeed, act_id: actId, target });
  } else {
    // 普通技：如果队列有终结技，插入到它前面
    const finisherIdx = queue.value.findIndex((item) => {
      const s = skills.value.find((sk) => sk.act_id === item.act_id);
      return s ? Number(s.finisher) > 0 : false;
    });
    if (finisherIdx >= 0) {
      queue.value.splice(finisherIdx, 0, { id: ++queueIdSeed, act_id: actId, target });
    } else {
      queue.value.push({ id: ++queueIdSeed, act_id: actId, target });
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
function getTargetDisplayText(target: TargetIntent): string {
  if (target.type === 'self') return '自己';
  if (target.type === 'none') return '无目标';
  if (target.type === 'tile') return `位置${target.id}`;

  const pid = parseInt(String(target.id));
  if (pid === parseInt(String(playerPid.value))) return '自己';

  // 优先查 validTargets（战斗规则过滤后的合法目标），回退到 CharacterHub
  const combatTarget = getCombatTarget(pid);
  if (combatTarget && Number(combatTarget.state) === 0) {
    return `位于位置${combatTarget.pls}的 ${combatTarget.name}`;
  }
  return `目标${pid}`;
}


function normalizeActions(actions: QueueItem[]): Array<{ act_id: string; target: TargetIntent; params: Record<string, unknown> }> {
  return actions.map((action) => ({
    act_id: action.act_id,
    target: action.target,
    params: {},
  }));
}

// ══════════════════════════════════════════════════
// 执行装填队列
// ══════════════════════════════════════════════════

const executeCommand = computed(() => mode.value === 'pre-battle' ? 'battle.start' : 'battle.submit_turn');
const executeBlock = computed(() => commandQueue.getBlockDecision(executeCommand.value));

async function onExecute(): Promise<void> {
  if (queue.value.length === 0 || executeBlock.value) return;

  const actions = queue.value.slice();

  let result;
  if (mode.value === 'pre-battle') {
    result = await commandQueue.execute({
      command: 'battle.start',
      payload: { actions: normalizeActions(actions) },
    });
  } else {
    result = await commandQueue.execute({
      command: 'battle.submit_turn',
      payload: { actions: normalizeActions(actions) },
    });
  }

  if (!result.success) {
    useToastStore().showToast(
      result.message || result.error || '战斗指令提交失败',
      'error',
      3000,
      !!result.messageIsHtml,
    );
    return;
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

function onPreloadContextRefresh(data: unknown): void {
  if (!data) return;
  const next = data as PreloadInitEventData;
  combatContext.value = next.combatContext || combatContext.value;
  enemyPid.value = battleStore.combatTargets.suggestedTargetPid || next.enemyPid || enemyPid.value;
  playerPid.value = next.playerPid || playerPid.value;
}

function onBattleEnded(): void {
  sessionKey.value = '';
  mode.value = '';
  queue.value = [];
  aimMode.value = false;
  pendingActId.value = null;
  pendingTargetMode.value = 'enemy';
  enemyPid.value = 0;
  playerPid.value = 0;
  combatContext.value = null;
}

function onPreloadClear(): void {
  queue.value = [];
  if (aimMode.value) {
    exitAimMode();
  }
}

onMounted(() => {
  dataManager.listen('battle:preload-init', onPreloadInit);
  dataManager.listen('battle:preload-context-refresh', onPreloadContextRefresh);
  dataManager.listen('battle:aim-target-selected', onTargetSelect);
  dataManager.listen('battle:aim-exit', onAimExit);
  dataManager.listen('battle:preload-clear', onPreloadClear);
  dataManager.listen('battle:ended', onBattleEnded);
});

onUnmounted(() => {
  dataManager.unlisten('battle:preload-init', onPreloadInit);
  dataManager.unlisten('battle:preload-context-refresh', onPreloadContextRefresh);
  dataManager.unlisten('battle:aim-target-selected', onTargetSelect);
  dataManager.unlisten('battle:aim-exit', onAimExit);
  dataManager.unlisten('battle:preload-clear', onPreloadClear);
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
      <div v-if="visibleSkills.length === 0" class="text-fg-dim text-[10px] py-2 text-center">
        无可用技能
      </div>
      <button
        v-for="skill in visibleSkills"
        :key="skill.act_id"
        class="obl-btn w-full text-left px-2 py-1.5 mb-1 transition-colors"
        :class="skillButtonClass(skill)"
        :disabled="!skill.available"
        @click="onSkillClick(skill.act_id)"
      >
        <span class="text-fg-bright font-bold">[{{ getSkillTemplate(skill.act_id).name }}]</span>
        <span class="text-fg-dim text-[10px] ml-2">{{ getSkillTemplate(skill.act_id).desc }}</span>
        <span class="text-fg-dim text-[10px] ml-2">
          {{ Number(skill.apcost) > 0 ? ` AP:${skill.apcost}` : '' }}{{ skillRangeText(skill) }}{{ skillCdText(skill) }}
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
          <span class="text-fg-dim ml-1">AP:{{ estimateActionCost(item) }}</span>
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
          :disabled="executeBlock !== null"
          :title="executeBlock?.message || ''"
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
