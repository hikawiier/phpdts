<script setup lang="ts">
/**
 * @module K 状态管理层
 * @framework K-1 战斗回合编排 + 演示播放管道
 * @framework L-4 异步播放编排器
 */

// ══════════════════════════════════════════════════
// 战斗演出模态框 / Battle Presentation Modal
//
// 处理 turn（战报回放）和 system（系统段）的视觉呈现。
// 实现 SegmentPlayer 接口，由 store 命令式调用 playSegment。
//
// 纯展示模态框，按 BattleSegmentV2 分段播放 battlelog 条目：
// - 逐条显示，每条带淡入动画
// - 段首插入段分隔符（turn 段显示"── xx 的回合 ──"）
// - HP 条从 effect delta 更新（仅 turn 段显示）
// - 播放完自动关闭
// - 遮罩拦截点击，播放期间禁止操作
//
// Teleport to body：避免 position: fixed 与父级 transform 冲突
//
// 关联文档：oblivions/docs/战斗横幅组件设计案-2026-07-14.md §7.2
// ══════════════════════════════════════════════════

import { ref, computed, nextTick, onMounted, onUnmounted } from 'vue';
import { useBattleStore } from '@/stores/battle';
import type {
  BattleSegmentV2,
  CombatantView,
  DirectedActionV2,
  DirectedEffectV2,
  TextCue,
} from '@/stores/battle-director-v2';
import type { SegmentPlayOptions } from '@/stores/battle-playback-runner';

// ── 播放参数 ──
const ENTRY_INTERVAL = 500;       // 条目间隔 ms
const COMPLETE_HOLD = 1200;       // 播放完停留 ms
const ENTRY_FADE_DELAY = 20;      // 条目淡入前延迟 ms（触发 CSS transition）
const TRANSITION_FALLBACK = 1000;

// ── 模态框状态 ──
const overlayOpen = ref<boolean>(false);
const overlayClosing = ref<boolean>(false);
/** 是否正在播放（并发守卫） */
const playing = ref<boolean>(false);

// ── 当前段（由 playSegment 设置，供 computed 使用） ──
const currentSeg = ref<BattleSegmentV2 | null>(null);

// ── 显示的条目 ──
interface DisplayedEntry {
  html: string;
  shown: boolean;
  isDivider: boolean;
}
const displayedEntries = ref<DisplayedEntry[]>([]);

interface PlaybackItem {
  rawLogId: number;
  cue: TextCue;
  action?: DirectedActionV2;
  effect?: DirectedEffectV2;
}

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

/** HP 条是否显示（仅 turn 段且有 HP effect 时显示） */
const showHpBar = computed<boolean>(() => {
  const seg = currentSeg.value;
  if (!seg) return false;
  return seg.kind === 'turn' && hasHpEffect(seg);
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
const overlayRef = ref<HTMLElement | null>(null);

function scrollToBottom(): void {
  if (bodyRef.value) {
    bodyRef.value.scrollTop = bodyRef.value.scrollHeight;
  }
}

// ══════════════════════════════════════════════════
// 播放工具
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

function waitForOverlayTransition(): Promise<void> {
  const overlay = overlayRef.value;
  if (!overlay) return Promise.resolve();
  return new Promise(resolve => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      overlay.removeEventListener('transitionend', onTransitionEnd);
      clearTimeout(timeout);
      resolve();
    };
    const onTransitionEnd = (event: TransitionEvent) => {
      if (event.target === overlay && event.propertyName === 'opacity') finish();
    };
    const timeout = setTimeout(finish, TRANSITION_FALLBACK);
    overlay.addEventListener('transitionend', onTransitionEnd);
  });
}

// ══════════════════════════════════════════════════
// 段内容收集
// ══════════════════════════════════════════════════

function collectPlaybackItems(segment: BattleSegmentV2): PlaybackItem[] {
  const items: PlaybackItem[] = [];
  for (const action of segment.actions) {
    for (const cue of action.text) {
      items.push({ rawLogId: action.rawLogId, cue, action });
    }
    for (const effect of action.effects) {
      if (effect.text) {
        items.push({ rawLogId: effect.rawLogId, cue: effect.text, action, effect });
      }
    }
  }
  for (const notice of segment.notices) {
    items.push({ rawLogId: notice.rawLogId, cue: notice.text });
  }
  return items;
}

function hasHpEffect(segment: BattleSegmentV2): boolean {
  return segment.actions.some(action => action.effects.some(isHpEffect));
}

function isHpEffect(effect: DirectedEffectV2): boolean {
  return (effect.type === 'damage' || effect.type === 'heal') && Boolean(effect.target.snapshot);
}

/** 从段首 HP effect 初始化 HP 条 */
function initHpFromSegment(segment: BattleSegmentV2): void {
  for (const action of segment.actions) {
    const effect = action.effects.find(isHpEffect);
    if (effect) {
      initHpFromEffect(action, effect);
      return;
    }
  }
}

function initHpFromEffect(action: DirectedActionV2, effect: DirectedEffectV2): void {
  const target = effect.target.snapshot;
  if (!target) return;

  const before = effect.delta?.hp_before ?? target.hp;
  const source = effect.source ?? action.actor;

  if (target.type === 0) {
    playerHp.value = before;
    playerMaxHp.value = target.mhp || 1;
    setEnemyHpFromCombatant(source);
  } else {
    enemyName.value = target.name || enemyName.value || '敌人';
    enemyHp.value = before;
    enemyMaxHp.value = target.mhp || 1;
    if (source.type === 0) {
      playerHp.value = source.hp;
      playerMaxHp.value = source.mhp || 1;
    }
  }
}

/** 根据 effect delta 更新 HP 条 */
function updateHpFromEffect(action: DirectedActionV2, effect: DirectedEffectV2): void {
  const target = effect.target.snapshot;
  if (!target || !isHpEffect(effect)) return;

  const after = effect.delta?.hp_after ?? target.hp;
  if (target.type === 0) {
    playerHp.value = after;
    playerMaxHp.value = target.mhp || 1;
    setEnemyHpFromCombatant(effect.source ?? action.actor);
  } else {
    enemyName.value = target.name || enemyName.value || '敌人';
    enemyHp.value = after;
    enemyMaxHp.value = target.mhp || 1;
  }
}

function setEnemyHpFromCombatant(combatant: CombatantView | null | undefined): void {
  if (!combatant || combatant.type === 0) return;
  enemyName.value = combatant.name || enemyName.value || '敌人';
  enemyHp.value = combatant.hp;
  enemyMaxHp.value = combatant.mhp || 1;
}

/** 获取段的分隔符（接收 segment 参数，不读 store） */
function getSegmentDivider(seg: BattleSegmentV2): { html: string } | null {
  switch (seg.kind) {
    case 'round_intro': return { html: `── 第 ${seg.roundNum ?? 0} 轮 ──` };
    case 'turn':
      if (!seg.actor) return null;
      return { html: `── ${seg.actor.type === 0 ? '你' : seg.actor.name} 的回合 ──` };
    case 'battle_end':  return { html: '── 战斗结束 ──' };
    default:            return null;
  }
}

// ══════════════════════════════════════════════════
// SegmentPlayer 接口实现
// ══════════════════════════════════════════════════

/** 播放 turn / system 段：overlay 淡入 → HP 条 → 段分隔符 → 逐条正文 → HP 同步 → 停留 → overlay 淡出 */
async function playSegment(
  segment: BattleSegmentV2,
  _sessionId: string,
  options: SegmentPlayOptions,
): Promise<void> {
  // 重入保护：直接返回（命令式模式下"返回"即"推进"）
  if (playing.value) return;
  playing.value = true;
  try {
    currentSeg.value = segment;
    const playbackItems = collectPlaybackItems(segment);
    if (playbackItems.length === 0 && !options.alwaysShowHeader) return;

    // 初始化 HP（从段首 HP effect 的 before 值读）
    initHpFromSegment(segment);

    // 清空正文
    displayedEntries.value = [];

    // 显示模态框
    const entered = waitForOverlayTransition();
    overlayOpen.value = true;
    overlayClosing.value = false;
    await entered;
    if (cancelRequested) return;

    // 段分隔符
    const divider = getSegmentDivider(segment);
    if (divider) {
      displayedEntries.value.push({ html: divider.html, shown: false, isDivider: true });
      await nextTick();
      displayedEntries.value[displayedEntries.value.length - 1].shown = true;
      scrollToBottom();
      await sleep(ENTRY_INTERVAL / 2);
      if (cancelRequested) return;
    }

    // 逐条播放（含 HP 同步）
    const sorted = playbackItems.sort((a, b) => Number(a.rawLogId || 0) - Number(b.rawLogId || 0));
    for (const item of sorted) {
      if (cancelRequested) return;
      const html = item.cue.html;
      if (html) {
        displayedEntries.value.push({ html, shown: false, isDivider: false });
        await nextTick();
        await sleep(ENTRY_FADE_DELAY);
        displayedEntries.value[displayedEntries.value.length - 1].shown = true;
        scrollToBottom();
      }
      if (item.effect && item.action) updateHpFromEffect(item.action, item.effect);
      await sleep(ENTRY_INTERVAL);
    }

    if (cancelRequested) return;
    await sleep(COMPLETE_HOLD);
    if (cancelRequested) return;

    overlayClosing.value = true;
    const exited = waitForOverlayTransition();
    overlayOpen.value = false;
    await exited;
    overlayClosing.value = false;
    displayedEntries.value = [];
  } finally {
    playing.value = false;
  }
}

defineExpose({ playSegment });

// ══════════════════════════════════════════════════
// 生命周期
// ══════════════════════════════════════════════════

onMounted(() => {
  battleStore.registerModalPlayer({ playSegment });
});

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
  battleStore.unregisterModalPlayer();
  // 不再需要调 notifyModalClosed / notifyBattleEndOverlayCovered
  // —— 共享状态已消除，函数返回即完成
});
</script>

<template>
  <Teleport to="body">
    <div
      ref="overlayRef"
      class="battle-modal-overlay"
      :class="{ open: overlayOpen, closing: overlayClosing }"
    >
      <div class="battle-modal">
        <!-- 头部：双方名称 + HP 条（仅 turn 段显示） -->
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
