<script setup lang="ts">
/**
 * @module L Vue 组件
 * @framework L-11 主操作区
 */
// ══════════════════════════════════════════════════
// MainActionBar — 主操作区（F-K2-Explore §5.4 / 设计案 §7.3）
//
// 始终提供四项（认知稳定性，§5.4），并按位置追加区域通行命令：
//   1. 移动 —— 接入移动导演
//   2. 探索 —— 标签稳定，演出期间改显"[扫描中…]"而非"等待"（§5.10/B2.5）
//   3. 区域通行 —— 仅站在区域入口/出口时显示
//   4-5. 当前移动倾向与临时目标默认收纳为导航设置摘要，手动展开后显示
//
// 演出期间门控分层（§5.4 / B6.10）：
//   - inputLocked 锁定移动/探索/目标（会改变游戏状态的操作）
//   - 加速/跳过/暂停始终可用（不改变游戏状态，仅控制演出播放）
//
// variant: 'desktop'（右侧面板底部）/ 'mobile'（手机横屏底部安全区，紧凑横排）
//
// 移动按钮触发 startNavigation；移动进度与播放控制由地图上的 K-12 叠层独占
// ══════════════════════════════════════════════════

import { computed, ref } from 'vue';
import {
  useExploreStore,
  TENDENCY_OPTIONS,
  type MoveTendency,
} from '@/stores/explore-store';
import { useMoveDirectorStore } from '@/stores/move-director';
import { useTileActionStore } from '@/stores/tileAction';
import { useMapStore } from '@/stores/map';
import { commandQueue } from '@/stores/command-queue';

const props = withDefaults(defineProps<{
  variant?: 'desktop' | 'mobile';
}>(), {
  variant: 'desktop',
});

const explore = useExploreStore();
const nav = useMoveDirectorStore();
const tileActionStore = useTileActionStore();
const mapStore = useMapStore();

const settingsOpen = ref<boolean>(false);
const tendencyOpen = ref<boolean>(false);

const currentTendencyLabel = computed<string>(() => {
  const opt = TENDENCY_OPTIONS.find((o) => o.id === explore.tendency);
  return opt ? opt.label : '稳健探索';
});

const targetLabel = computed<string>(() => {
  const t = explore.target;
  if (t.kind === 'none') return '无目标';
  if (t.kind === 'paused') return `继续前往：${t.name}`;
  return t.name;
});

const targetState = computed<'none' | 'active' | 'paused'>(() => explore.target.kind);
const navigationSettingsSummary = computed<string>(
  () => `${currentTendencyLabel.value} · ${targetLabel.value}`,
);
const moveButtonTitle = computed<string>(() => {
  const action = explore.navigationPlaying
    ? '移动导演播放中，可在地图进度条中加速或跳过。'
    : '按当前倾向自动选择目标并逐格移动。';
  return `${action} 当前导航设置：${navigationSettingsSummary.value}。使用右侧窄按钮展开或收起导航设置。`;
});

const currentRegionInfo = computed(() => {
  if (!mapStore.links || mapStore.curRegion === null) return null;
  return (mapStore.links.regions as Record<string, {
    name?: string;
    exit_pls?: string | number;
    entrance_pls?: string | number;
    next_region?: string | number | null;
    prev_region?: string | number | null;
  }>)[String(mapStore.curRegion)] || null;
});
const switchRegionVisible = computed<boolean>(() => {
  const region = currentRegionInfo.value;
  if (!region) return false;
  const isOnExit = String(mapStore.curLoc) === String(region.exit_pls);
  const isOnEntrance =
    String(mapStore.curLoc) === String(region.entrance_pls) &&
    region.prev_region !== null && region.prev_region !== undefined;
  return isOnExit || isOnEntrance;
});
const isOnRegionExit = computed<boolean>(() => {
  const region = currentRegionInfo.value;
  return !!region && String(mapStore.curLoc) === String(region.exit_pls);
});
const switchRegionText = computed<string>(() => (
  isOnRegionExit.value ? '前往下一区域' : '返回上一区域'
));
const switchRegionSummary = computed<string>(() => {
  const region = currentRegionInfo.value;
  if (!region || !mapStore.links) return '区域通行';
  const targetRegionId = isOnRegionExit.value ? region.next_region : region.prev_region;
  if (targetRegionId === null || targetRegionId === undefined) return '区域通行';
  const targetRegion = (mapStore.links.regions as Record<string, { name?: string }>)[String(targetRegionId)];
  return targetRegion?.name ? `通往 ${targetRegion.name}` : '区域通行';
});

// ── 移动按钮：接入移动导演（3.4，委托 explore.startNavigation → move-director） ──
function onMove(): void {
  if (explore.inputLocked) return;
  explore.startNavigation();
}

// ── 探索按钮：标签稳定，不改名"等待"（B2.5） ──
function onExplore(): void {
  if (explore.inputLocked) return;
  explore.explore();
}

function onSwitchRegion(): void {
  if (explore.inputLocked || !commandQueue.canExecute('map.move')) return;
  tileActionStore.handleSwitchRegion();
}

// ── 跳过主动探索演出（B6.10：始终可用，不被 inputLocked 门控） ──
function onSkipExplore(): void {
  explore.skipExplore();
}

function onToggleTendency(): void {
  if (explore.inputLocked) return;
  tendencyOpen.value = !tendencyOpen.value;
}

function onToggleSettings(): void {
  settingsOpen.value = !settingsOpen.value;
  if (!settingsOpen.value) tendencyOpen.value = false;
}

function onPickTendency(id: MoveTendency): void {
  explore.setTendency(id);
  tendencyOpen.value = false;
}

// ── 目标状态操作：目标只能由完整地图/发现入口创建 ──
// active → paused；paused → active + 重新导航；none 为只读状态
function onTargetAction(): void {
  if (explore.inputLocked) return;
  const t = explore.target;
  if (t.kind === 'none') return;
  if (t.kind === 'active') {
    explore.pauseTarget();
  } else {
    explore.resumeTarget();
    nav.startNavigation(explore.tendency, Number(t.pls));
  }
}

// 点击倾向菜单外部关闭
function onTendencyBlur(): void {
  tendencyOpen.value = false;
}
</script>

<template>
  <div class="main-action-bar" :class="`variant-${props.variant}`">
    <div class="ma-move-cluster" :class="{ 'is-settings-open': settingsOpen }">
      <button
        class="term-btn ma-command ma-move"
        :class="{ 'is-active': explore.moveMode, 'is-busy': explore.navigationPlaying }"
        :disabled="explore.inputLocked"
        :title="moveButtonTitle"
        @click="onMove"
      >
        <span class="ma-command-index">01</span>
        <span class="ma-command-copy">
          <span class="ma-command-label">{{ explore.navigationPlaying ? '移动中' : '移动' }}</span>
          <span class="ma-command-state">{{ navigationSettingsSummary }}</span>
        </span>
      </button>
      <button
        class="term-btn ma-settings-trigger"
        :class="{ 'is-open': settingsOpen }"
        :aria-expanded="settingsOpen"
        aria-label="展开或收起导航设置"
        @click="onToggleSettings"
      >{{ settingsOpen ? '⌃' : '⌄' }}</button>
    </div>

    <button
      class="term-btn ma-command ma-explore"
      :class="{ 'is-busy': explore.exploring }"
      :disabled="explore.inputLocked"
      title="扫描周围：强化信息获取，普通结果进日志，重要结果进合并模态框"
      @click="onExplore"
    >
      <span class="ma-command-index">02</span>
      <span class="ma-command-copy">
        <span class="ma-command-label">{{ explore.exploring ? '扫描中' : '探索' }}</span>
        <span class="ma-command-state">当前区域</span>
      </span>
      <span class="ma-command-glyph">⌁</span>
    </button>

    <button
      v-if="switchRegionVisible"
      class="term-btn ma-command ma-region"
      :disabled="explore.inputLocked || !commandQueue.canExecute('map.move')"
      :title="switchRegionSummary"
      @click="onSwitchRegion"
    >
      <span class="ma-command-index">03</span>
      <span class="ma-command-copy">
        <span class="ma-command-label">{{ switchRegionText }}</span>
        <span class="ma-command-state">{{ switchRegionSummary }}</span>
      </span>
      <span class="ma-command-glyph">›</span>
    </button>

    <div v-if="settingsOpen" class="ma-tendency">
      <button
        class="term-btn ma-meta-control"
        :class="{ 'is-active': tendencyOpen }"
        :disabled="explore.inputLocked"
        title="切换移动倾向"
        @click="onToggleTendency"
        @blur="onTendencyBlur"
      >
        <span class="ma-meta-label">移动倾向</span>
        <span class="ma-meta-value">{{ currentTendencyLabel }}</span>
        <span class="ma-meta-glyph">⌄</span>
      </button>
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

    <button
      v-if="settingsOpen"
      class="term-btn ma-meta-control ma-target"
      :class="`tgt-${targetState}`"
      :disabled="explore.inputLocked || targetState === 'none'"
      :title="targetState === 'none' ? '尚未选择临时目标' : targetState === 'paused' ? '继续前往目标' : '暂停当前目标'"
      @click="onTargetAction"
    >
      <span class="ma-meta-label">临时目标</span>
      <span class="ma-meta-value ma-target-value">{{ targetLabel }}</span>
      <span class="ma-target-state" aria-hidden="true"></span>
    </button>

    <div v-if="explore.exploring" class="ma-skip">
      <span>扫描演出</span>
      <button class="term-btn ma-skip-btn" @click="onSkipExplore">跳过  »</button>
    </div>
  </div>
</template>

<style scoped>
.main-action-bar {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
  position: relative;
}
.main-action-bar.variant-mobile {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px;
}
.ma-move-cluster {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 24px;
  min-width: 0;
}
.ma-move-cluster .ma-command {
  min-width: 0;
  height: 100%;
}
.ma-move-cluster .ma-move {
  border-right: 0;
}
.ma-settings-trigger {
  width: 24px;
  min-width: 24px;
  height: 100%;
  padding: 0;
  border-color: #858585;
  color: #777;
  font-size: 11px;
  line-height: 1;
  letter-spacing: 0;
}
.ma-settings-trigger:hover,
.ma-settings-trigger.is-open {
  color: #fff;
  border-color: #fff;
  background: rgba(255, 255, 255, 0.075);
}
.ma-command {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr) 14px;
  align-items: center;
  gap: 7px;
  min-height: 46px;
  padding: 6px 9px;
  width: 100%;
  text-align: left;
  border-color: #858585;
  background: rgba(255, 255, 255, 0.028);
  letter-spacing: 0;
}
.ma-command:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.085);
}
.ma-command-index {
  color: #555;
  font-size: 9px;
  align-self: start;
  padding-top: 2px;
}
.ma-command-copy {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 1px;
}
.ma-command-label {
  color: #f2f2f2;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.2;
}
.ma-command-state {
  color: #696969;
  font-size: 9px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ma-command-glyph {
  color: #8b8b8b;
  font-size: 14px;
  justify-self: end;
}
.ma-command.is-active {
  border-color: #fff;
  color: #fff;
  background: rgba(255, 255, 255, 0.075);
}
.ma-command.is-busy {
  border-color: #fff;
  color: #fff;
  background: rgba(255, 255, 255, 0.065);
  animation: ma-pulse 1s ease-in-out infinite;
}
.ma-region {
  grid-column: 1 / -1;
}
@keyframes ma-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}
.ma-tendency {
  position: relative;
  min-width: 0;
}
.ma-meta-control {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-rows: auto auto;
  column-gap: 8px;
  width: 100%;
  min-height: 38px;
  padding: 5px 8px;
  text-align: left;
  border-color: rgba(82, 82, 82, 0.62);
  background: transparent;
  letter-spacing: 0;
}
.ma-meta-label {
  color: #555;
  font-size: 8px;
  line-height: 1.1;
}
.ma-meta-value {
  grid-column: 1;
  color: #b8b8b8;
  font-size: 10px;
  line-height: 1.25;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ma-meta-glyph,
.ma-target-state {
  grid-column: 2;
  grid-row: 1 / span 2;
  align-self: center;
  color: #6c6c6c;
}
.ma-target-state {
  width: 6px;
  height: 6px;
  border: 1px solid currentColor;
}
.ma-tendency-menu {
  position: static;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 4px;
  margin-top: 4px;
  background: #0a0a0a;
  border: 1px solid rgba(110, 110, 110, 0.68);
}
.ma-tendency-item {
  padding: 5px 7px;
  font-size: 10px;
  text-align: left;
  border-color: rgba(68, 68, 68, 0.5);
  letter-spacing: 0;
}
.ma-tendency-item.is-selected {
  border-color: #fff;
  color: #fff;
  background: rgba(255, 255, 255, 0.08);
}
.ma-target {
  min-width: 0;
}
.ma-target-value {
  color: #969696;
}
.ma-target.tgt-active {
  border-color: #a8a8a8;
}
.ma-target.tgt-active .ma-target-value {
  color: #fff;
}
.ma-target.tgt-active .ma-target-state {
  color: #ddd;
  background: #ddd;
}
.ma-target.tgt-paused {
  border-style: dashed;
  border-color: #888;
}
.ma-target.tgt-paused .ma-target-value {
  color: #aaa;
}
.ma-target.tgt-paused .ma-target-state {
  color: #aaa;
}
.ma-skip {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 28px;
  padding: 3px 4px 3px 8px;
  border: 1px dashed rgba(104, 104, 104, 0.5);
  color: #777;
  font-size: 9px;
}
.ma-skip-btn {
  padding: 2px 7px;
  font-size: 9px;
  border-color: #666;
  letter-spacing: 0;
}

.variant-mobile .ma-command,
.variant-mobile .ma-meta-control {
  min-height: 34px;
  padding: 4px 6px;
}
.variant-mobile .ma-command {
  grid-template-columns: 16px minmax(0, 1fr) 10px;
  gap: 4px;
}
.variant-mobile .ma-command-label {
  font-size: 10px;
}
.variant-mobile .ma-command-state,
.variant-mobile .ma-meta-label {
  display: none;
}
.variant-mobile .ma-meta-control {
  display: flex;
  align-items: center;
  gap: 5px;
}
.variant-mobile .ma-meta-value {
  flex: 1 1 auto;
  font-size: 9px;
}
.variant-mobile .ma-meta-glyph,
.variant-mobile .ma-target-state {
  flex: 0 0 auto;
}
.variant-mobile .ma-skip {
  grid-column: 1 / -1;
}
</style>
