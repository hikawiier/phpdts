<script setup lang="ts">
// ══════════════════════════════════════════════════
// 战斗演出模态框 / Battle Presentation Modal
//
// 纯展示模态框，按 PlaySegment 分段播放 battlelog 条目：
// - 逐条显示，每条带淡入动画
// - 段首插入段分隔符（── 突袭 ── / ── 第 N 轮 ── / ── 战斗结束 ──）
// - HP 条从 DirectedEntry.hpSnapshot 更新
// - 播放完自动关闭
// - 遮罩拦截点击，播放期间禁止操作
//
// 触发方式：
// - battleStore.battleModalOpen 变为 true 时开始播放
// - 播放完成后调用 battleStore.notifyModalClosed() 通知 store
//
// Teleport to body：避免 position: fixed 与父级 transform 冲突
//
// 关联文档：oblivions/docs/设计案3-重构前端播放系统.md §五
// ══════════════════════════════════════════════════

import { ref, computed, watch, nextTick, onUnmounted } from 'vue';
import { useBattleStore } from '@/stores/battle';
import { renderDirectedEntryHtml } from '@/data/battle-templates';
import type { DirectedEntry, PlaySegment } from '@/stores/battle-director';

// ── 播放参数 ──
const ENTRY_INTERVAL = 500;       // 条目间隔 ms
const COMPLETE_HOLD = 1200;       // 播放完停留 ms
const OVERLAY_FADE_IN = 250;      // 模态框淡入 ms
const OVERLAY_FADE_OUT = 200;     // 模态框淡出 ms
const ENTRY_FADE_DELAY = 20;      // 条目淡入前延迟 ms（触发 CSS transition）

// ── 模态框状态 ──
const overlayOpen = ref<boolean>(false);
const overlayClosing = ref<boolean>(false);
/** 是否正在播放（并发守卫） */
const playing = ref<boolean>(false);

// ── 显示的条目 ──
interface DisplayedEntry {
  html: string;
  shown: boolean;
  isDivider: boolean;
}
const displayedEntries = ref<DisplayedEntry[]>([]);

// ── HP 条状态 ──
const enemyName = ref<string>('');
const enemyHp = ref<number>(0);
const enemyMaxHp = ref<number>(1);
const playerHp = ref<number>(0);
const playerMaxHp = ref<number>(1);

// ── 播放控制 ──
let currentTimer: ReturnType<typeof setTimeout> | null = null;
let cancelRequested = false;
let rejectSleep: ((e?: unknown) => void) | null = null;

const battleStore = useBattleStore();

// ── HP 条 class 计算 ──
const enemyHpClass = computed<string>(() => hpBarClass(enemyHp.value, enemyMaxHp.value));
const playerHpClass = computed<string>(() => hpBarClass(playerHp.value, playerMaxHp.value));
const enemyHpPercent = computed<string>(() => hpPercent(enemyHp.value, enemyMaxHp.value));
const playerHpPercent = computed<string>(() => hpPercent(playerHp.value, playerMaxHp.value));

/** HP 条是否显示（仅 turn/phase0 段显示） */
const showHpBar = computed<boolean>(() => {
  const seg = battleStore.currentSegment;
  if (!seg) return false;
  return seg.kind === 'turn' || seg.kind === 'phase0';
});

function hpBarClass(hp: number, maxHp: number): string {
  const percent = maxHp > 0 ? (hp / maxHp) * 100 : 0;
  if (percent < 25) return 'critical';
  if (percent < 50) return 'low';
  return '';
}

function hpPercent(hp: number, maxHp: number): string {
  const safeMaxHp = maxHp > 0 ? maxHp : 1;
  const percent = Math.max(0, Math.min(100, (hp / safeMaxHp) * 100));
  return percent + '%';
}

// ── 正文容器 ref（用于自动滚动） ──
const bodyRef = ref<HTMLElement | null>(null);

function scrollToBottom(): void {
  if (bodyRef.value) {
    bodyRef.value.scrollTop = bodyRef.value.scrollHeight;
  }
}

// ══════════════════════════════════════════════════
// 播放逻辑
// ══════════════════════════════════════════════════

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    rejectSleep = reject;
    currentTimer = setTimeout(() => {
      currentTimer = null;
      rejectSleep = null;
      resolve();
    }, ms);
  });
}

async function playBattleLog(): Promise<void> {
  if (playing.value) {
    battleStore.notifyModalClosed();
    return;
  }
  playing.value = true;
  try {
    const segment = battleStore.currentSegment as PlaySegment | null;
    const entries = battleStore.battleLogEntries as DirectedEntry[];
    if (!segment) {
      battleStore.notifyModalClosed();
      return;
    }
    // battle_end/ambush_battle_end 段可能 entries 为空但仍需显示
    if (entries.length === 0 && segment.kind !== 'battle_end' && segment.kind !== 'ambush_battle_end') {
      battleStore.notifyModalClosed();
      return;
    }

    // 初始化 HP（从段首条 action entry 的 hpSnapshot 读 before 值）
    initHpFromSegment(entries);

    // 清空正文
    displayedEntries.value = [];

    // 显示模态框
    overlayOpen.value = true;
    overlayClosing.value = false;
    await sleep(OVERLAY_FADE_IN);
    if (cancelRequested) return;

    // 段分隔符
    const divider = getSegmentDivider();
    if (divider) {
      displayedEntries.value.push({ html: divider.html, shown: false, isDivider: true });
      await nextTick();
      displayedEntries.value[displayedEntries.value.length - 1].shown = true;
      scrollToBottom();
      await sleep(ENTRY_INTERVAL / 2);
      if (cancelRequested) return;
    }

    // 逐条播放
    const sorted = [...entries].sort((a, b) => Number(a.log_id || 0) - Number(b.log_id || 0));
    for (const entry of sorted) {
      if (cancelRequested) return;
      const html = renderDirectedEntryHtml(entry, battleStore.currentPid);
      if (html) {
        displayedEntries.value.push({ html, shown: false, isDivider: false });
        await nextTick();
        await sleep(ENTRY_FADE_DELAY);
        displayedEntries.value[displayedEntries.value.length - 1].shown = true;
        scrollToBottom();
      }
      updateHpFromSnapshot(entry);
      await sleep(ENTRY_INTERVAL);
    }

    if (cancelRequested) return;
    await sleep(COMPLETE_HOLD);
    if (cancelRequested) return;

    overlayClosing.value = true;
    overlayOpen.value = false;
    await sleep(OVERLAY_FADE_OUT);
    overlayClosing.value = false;
    displayedEntries.value = [];

    battleStore.notifyModalClosed();
  } catch {
    battleStore.notifyModalClosed();
  } finally {
    playing.value = false;
  }
}

/** 从段首条 action entry 的 hpSnapshot 初始化 HP 条 */
function initHpFromSegment(entries: DirectedEntry[]): void {
  const firstAction = entries.find(e => e.directedKind === 'action' && e.hpSnapshot);
  if (firstAction?.hpSnapshot) {
    const snap = firstAction.hpSnapshot;
    if (Number(firstAction.actor_type) === 0) {
      enemyName.value = firstAction.target_name ?? '敌人';
      enemyHp.value = snap.targetHpBefore;
      enemyMaxHp.value = snap.targetMaxHp;
      playerHp.value = snap.actorHpBefore;
      playerMaxHp.value = snap.actorMaxHp;
    } else if (Number(firstAction.target_type) === 0) {
      enemyName.value = firstAction.actor_name ?? '敌人';
      enemyHp.value = snap.actorHpBefore;
      enemyMaxHp.value = snap.actorMaxHp;
      playerHp.value = snap.targetHpBefore;
      playerMaxHp.value = snap.targetMaxHp;
    }
  }
}

/** 根据 DirectedEntry 的 hpSnapshot 更新 HP 条 */
function updateHpFromSnapshot(entry: DirectedEntry): void {
  if (!entry.hpSnapshot) return;
  const snap = entry.hpSnapshot;
  if (Number(entry.actor_type) === 0) {
    enemyHp.value = snap.targetHpAfter;
    enemyMaxHp.value = snap.targetMaxHp;
    playerHp.value = snap.actorHpAfter;
    playerMaxHp.value = snap.actorMaxHp;
  } else if (Number(entry.target_type) === 0) {
    playerHp.value = snap.targetHpAfter;
    playerMaxHp.value = snap.targetMaxHp;
    enemyHp.value = snap.actorHpAfter;
    enemyMaxHp.value = snap.actorMaxHp;
  }
}

/** 获取当前段的分隔符（无则返回 null） */
function getSegmentDivider(): { html: string } | null {
  const seg = battleStore.currentSegment as PlaySegment | null;
  if (!seg) return null;
  switch (seg.kind) {
    case 'phase0':            return { html: '── 突袭 ──' };
    case 'turn':              return { html: `── 第 ${seg.meta.roundNum ?? 0} 轮 ──` };
    case 'battle_end':        return { html: '── 战斗结束 ──' };
    case 'ambush_battle_end': return { html: '── 突袭结束 ──' };
    default:                  return null;
  }
}

// ══════════════════════════════════════════════════
// 监听 store 触发播放
// ══════════════════════════════════════════════════

watch(
  () => battleStore.battleModalOpen,
  (open) => {
    if (open) {
      cancelRequested = false;
      playBattleLog();
    }
  },
);

// ══════════════════════════════════════════════════
// 生命周期清理
// ══════════════════════════════════════════════════

onUnmounted(() => {
  cancelRequested = true;
  if (currentTimer) {
    clearTimeout(currentTimer);
    currentTimer = null;
  }
  if (rejectSleep) {
    const r = rejectSleep;
    rejectSleep = null;
    r(new Error('BattleModal unmounted'));
  }
});
</script>

<template>
  <Teleport to="body">
    <div
      class="battle-modal-overlay"
      :class="{ open: overlayOpen, closing: overlayClosing }"
    >
      <div class="battle-modal">
        <!-- 头部：双方名称 + HP 条（仅 turn/phase0 段显示） -->
        <div v-if="showHpBar" class="battle-modal-header">
          <div class="battle-modal-combatant enemy">
            <span class="battle-modal-combatant-name">{{ enemyName }}</span>
            <div class="battle-modal-hp-bar">
              <div
                class="battle-modal-hp-fill"
                :class="enemyHpClass"
                :style="{ width: enemyHpPercent }"
              ></div>
            </div>
            <span class="battle-modal-hp-text">HP: {{ enemyHp }}/{{ enemyMaxHp }}</span>
          </div>
          <div class="battle-modal-combatant player">
            <span class="battle-modal-combatant-name">你</span>
            <div class="battle-modal-hp-bar">
              <div
                class="battle-modal-hp-fill"
                :class="playerHpClass"
                :style="{ width: playerHpPercent }"
              ></div>
            </div>
            <span class="battle-modal-hp-text">HP: {{ playerHp }}/{{ playerMaxHp }}</span>
          </div>
        </div>

        <!-- 正文：battlelog 逐条显示（含段分隔符） -->
        <div ref="bodyRef" class="battle-modal-body">
          <div
            v-for="(entry, i) in displayedEntries"
            :key="i"
            class="battle-log-entry"
            :class="{
              shown: entry.shown,
              'turn-divider': entry.isDivider,
            }"
            v-html="entry.html"
          ></div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
