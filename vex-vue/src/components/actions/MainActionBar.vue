<script setup lang="ts">
/**
 * @module L Vue 组件
 * @framework L-11 主操作区
 */
// ══════════════════════════════════════════════════
// MainActionBar — 主操作区（F-K2-Explore §5.4 / 设计案 §7.3）
//
// 始终显示四项（认知稳定性，§5.4）：
//   1. 移动 —— 接入移动导演（3.4 实现，本子任务 UI 占位）
//   2. 探索 —— 标签稳定，演出期间改显"[扫描中…]"而非"等待"（§5.10/B2.5）
//   3. 当前移动倾向 —— 四种切换（稳健/就近/深入/效率，§5.6）
//   4. 当前临时目标或暂停目标状态 —— 三态显示 none/active/paused（§5.9）
//
// 演出期间门控分层（§5.4 / B6.10）：
//   - inputLocked 锁定移动/探索/目标（会改变游戏状态的操作）
//   - 加速/跳过/暂停始终可用（不改变游戏状态，仅控制演出播放）
//
// variant: 'desktop'（右侧面板底部）/ 'mobile'（手机横屏底部安全区，紧凑横排）
//
// 3.4 移动导演实现后：移动按钮触发 startNavigation；演出控制区接入播放进度
// 本子任务：移动按钮只切换 moveMode 占位；演出控制区为骨架
// ══════════════════════════════════════════════════

import { computed, ref } from 'vue';
import {
  useExploreStore,
  TENDENCY_OPTIONS,
  type MoveTendency,
} from '@/stores/explore-store';
import { useMoveDirectorStore } from '@/stores/move-director';

const props = withDefaults(defineProps<{
  variant?: 'desktop' | 'mobile';
}>(), {
  variant: 'desktop',
});

const explore = useExploreStore();
const nav = useMoveDirectorStore();

const tendencyOpen = ref<boolean>(false);

const currentTendencyLabel = computed<string>(() => {
  const opt = TENDENCY_OPTIONS.find((o) => o.id === explore.tendency);
  return opt ? opt.label : '稳健探索';
});

const targetLabel = computed<string>(() => {
  const t = explore.target;
  if (t.kind === 'none') return '无目标';
  if (t.kind === 'paused') return `暂停：${t.name}`;
  return t.name;
});

const targetState = computed<'none' | 'active' | 'paused'>(() => explore.target.kind);

// ── 移动按钮：接入移动导演（3.4，委托 explore.startNavigation → move-director） ──
function onMove(): void {
  if (explore.inputLocked) return;
  explore.startNavigation();
}

// ── 移动导演播放控制（B6.10：加速/跳过始终可用，不被 inputLocked 门控） ──
const navStatusText = computed<string>(() => {
  if (nav.isPlaying) {
    const stepNo = Math.max(0, nav.currentStepIndex + 1);
    return `移动中… ${stepNo}/${nav.totalSteps}`;
  }
  if (nav.outcome === 'arrived') return nav.interruptReason || '已抵达';
  if (nav.outcome === 'failed') return nav.interruptReason || '导航失败';
  if (nav.outcome === 'interrupted_enemy') return nav.interruptReason || '导航中断';
  return '';
});

const speedOptions: Array<{ id: 1 | 2 | 4; label: string }> = [
  { id: 1, label: '1x' },
  { id: 2, label: '2x' },
  { id: 4, label: '4x' },
];

function onPickSpeed(s: 1 | 2 | 4): void {
  nav.setSpeed(s);
}

function onSkipNav(): void {
  nav.skip();
}

// ── 探索按钮：标签稳定，不改名"等待"（B2.5） ──
function onExplore(): void {
  if (explore.inputLocked) return;
  explore.explore();
}

// ── 跳过主动探索演出（B6.10：始终可用，不被 inputLocked 门控） ──
function onSkipExplore(): void {
  explore.skipExplore();
}

function onToggleTendency(): void {
  if (explore.inputLocked) return;
  tendencyOpen.value = !tendencyOpen.value;
}

function onPickTendency(id: MoveTendency): void {
  explore.setTendency(id);
  tendencyOpen.value = false;
}

// ── 目标三态循环（占位演示：none → active → paused → none） ──
function onCycleTarget(): void {
  if (explore.inputLocked) return;
  const t = explore.target;
  if (t.kind === 'none') {
    // 占位：设定玩家附近一个未探索格为目标（3.4 接完整目标选择）
    explore.setTarget(explore.playerPls ?? 0, '占位目标');
  } else if (t.kind === 'active') {
    explore.pauseTarget();
  } else {
    explore.clearTarget();
  }
}

// 点击倾向菜单外部关闭
function onTendencyBlur(): void {
  tendencyOpen.value = false;
}
</script>

<template>
  <div class="main-action-bar" :class="`variant-${props.variant}`">
    <!-- 移动 → 接入移动导演（3.4，自动选目标 → 逐格移动演出） -->
    <button
      class="term-btn ma-btn"
      :class="{ 'is-active': explore.moveMode, 'is-busy': explore.navigationPlaying }"
      :disabled="explore.inputLocked"
      :title="explore.navigationPlaying ? '移动导演播放中（可加速/跳过）' : '自动导航：按当前倾向选目标 → 逐格移动演出'"
      @click="onMove"
    >{{ explore.navigationPlaying ? '[移动中…]' : '[移动]' }}</button>

    <!-- 探索（标签稳定，演出期间改显[扫描中…]而非等待，B2.5） -->
    <button
      class="term-btn ma-btn"
      :class="{ 'is-busy': explore.exploring }"
      :disabled="explore.inputLocked"
      title="扫描周围：强化信息获取，普通结果进日志，重要结果进合并模态框"
      @click="onExplore"
    >{{ explore.exploring ? '[扫描中…]' : '[探索]' }}</button>

    <!-- 当前移动倾向 -->
    <div class="ma-tendency">
      <button
        class="term-btn ma-btn"
        :class="{ 'is-active': tendencyOpen }"
        :disabled="explore.inputLocked"
        title="切换移动倾向"
        @click="onToggleTendency"
        @blur="onTendencyBlur"
      >[倾向] {{ currentTendencyLabel }}</button>
      <div v-if="tendencyOpen" class="ma-tendency-menu" @mousedown.prevent>
        <button
          v-for="opt in TENDENCY_OPTIONS"
          :key="opt.id"
          class="term-btn ma-tendency-item"
          :class="{ 'is-selected': opt.id === explore.tendency }"
          :title="opt.hint"
          @click="onPickTendency(opt.id)"
        >{{ opt.label }}</button>
      </div>
    </div>

    <!-- 当前临时目标 / 暂停目标状态（三态） -->
    <button
      class="term-btn ma-btn ma-target"
      :class="`tgt-${targetState}`"
      :disabled="explore.inputLocked"
      :title="targetState === 'none' ? '设定临时目标' : targetState === 'paused' ? '继续目标' : '暂停/清除目标'"
      @click="onCycleTarget"
    >
      <span class="ma-target-label">[目标]</span>
      <span class="ma-target-value">{{ targetLabel }}</span>
    </button>

    <!-- 演出期间：主动探索的跳过始终可用（§5.4 / B6.10） -->
    <div v-if="explore.exploring" class="ma-skip">
      <button class="term-btn ma-skip-btn" @click="onSkipExplore">[跳过]</button>
    </div>

    <!-- 移动导演播放控制（3.4 实现，B6.10：加速/跳过始终可用，不被 inputLocked 门控） -->
    <div v-if="explore.navigationPlaying" class="ma-playback">
      <div class="ma-pb-status">
        <span class="ma-pb-step">{{ navStatusText }}</span>
      </div>
      <div class="ma-pb-controls">
        <button
          v-for="opt in speedOptions"
          :key="opt.id"
          class="term-btn ma-pb-btn"
          :class="{ 'is-active': nav.speed === opt.id }"
          :title="`切换为 ${opt.label} 速度播放（B6.4）`"
          @click="onPickSpeed(opt.id)"
        >[{{ opt.label }}]</button>
        <button
          class="term-btn ma-pb-btn ma-pb-skip"
          title="跳过全部剩余演出，立即同步到最终权威状态（B6.3）"
          @click="onSkipNav"
        >[跳过]</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.main-action-bar {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 4px;
  position: relative;
}
.main-action-bar.variant-mobile {
  grid-template-columns: repeat(4, 1fr);
  gap: 3px;
}
.ma-btn {
  padding: 5px 8px;
  font-size: 11px;
  letter-spacing: 0.08em;
  width: 100%;
  text-align: center;
}
.variant-mobile .ma-btn {
  padding: 4px 4px;
  font-size: 10px;
  letter-spacing: 0.04em;
}
.ma-btn.is-active {
  border-color: #fff;
  color: #fff;
  background: rgba(255, 255, 255, 0.1);
}
.ma-btn.is-busy {
  border-color: #fff;
  color: #fff;
  background: rgba(255, 255, 255, 0.06);
  animation: ma-pulse 1s ease-in-out infinite;
}
@keyframes ma-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}
.ma-tendency {
  position: relative;
}
.ma-tendency-menu {
  position: absolute;
  bottom: calc(100% + 2px);
  left: 0;
  right: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 3px;
  background: #0a0a0a;
  border: 1px solid rgba(68, 68, 68, 0.5);
  z-index: 5;
}
.ma-tendency-item {
  padding: 4px 6px;
  font-size: 10px;
  text-align: left;
  border-color: rgba(68, 68, 68, 0.5);
}
.ma-tendency-item.is-selected {
  border-color: #fff;
  color: #fff;
  background: rgba(255, 255, 255, 0.08);
}
.ma-target {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  flex-direction: column;
  min-height: 32px;
}
.variant-mobile .ma-target {
  flex-direction: row;
  min-height: auto;
}
.ma-target-label {
  color: #555;
  font-size: 9px;
  letter-spacing: 0.1em;
}
.ma-target-value {
  color: #ddd;
  font-size: 10px;
  letter-spacing: 0.02em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
.ma-target.tgt-active {
  border-color: #fff;
}
.ma-target.tgt-active .ma-target-value {
  color: #fff;
}
.ma-target.tgt-paused {
  border-style: dashed;
  border-color: #888;
}
.ma-target.tgt-paused .ma-target-value {
  color: #aaa;
}
.ma-skip {
  grid-column: 1 / -1;
  display: flex;
  justify-content: flex-end;
}
.ma-skip-btn {
  padding: 2px 8px;
  font-size: 9px;
  border-color: #666;
}

/* ═══ 移动导演播放控制（3.4 实现，B6.10） ═══ */
.ma-playback {
  grid-column: 1 / -1;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 4px 5px;
  border: 1px solid rgba(136, 136, 136, 0.4);
  background: rgba(255, 255, 255, 0.03);
}
.ma-pb-status {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  color: #bbb;
  letter-spacing: 0.04em;
}
.ma-pb-step {
  color: #fff;
}
.ma-pb-controls {
  display: flex;
  align-items: center;
  gap: 3px;
  flex-wrap: wrap;
}
.ma-pb-btn {
  padding: 2px 6px;
  font-size: 9px;
  border-color: rgba(68, 68, 68, 0.5);
  color: #888;
  cursor: pointer;
  line-height: 1.4;
}
.ma-pb-btn.is-active {
  border-color: #fff;
  color: #fff;
  background: rgba(255, 255, 255, 0.08);
}
.ma-pb-skip {
  border-color: rgba(136, 136, 136, 0.6);
  color: #ddd;
  margin-left: 2px;
}
.ma-pb-skip:hover {
  border-color: #fff;
  color: #fff;
  background: rgba(255, 255, 255, 0.08);
}
</style>
