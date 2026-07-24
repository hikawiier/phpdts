<script setup lang="ts">
/**
 * @module K 状态管理层
 * @framework K-12 移动导演演出框架
 */
// ══════════════════════════════════════════════════
// MoveDirector — 移动导演演出层（F-K4-Director §5.2 / 设计案 §8.2）
//
// 作为地图上的叠加层，承载"逐格移动演出"的可视反馈：
//   - 顶部进度条（当前步 / 总步数）+ 速度指示
//   - 抵达 / 失败 / 中断 的短时 toast 反馈（自动淡出）
//   - 紧凑发现摘要（敌人/POI/道具 计数徽章）
//   - 加速（1x/2x/4x）+ 跳过 控制（B6.10：演出期间始终可用，不被 inputLocked 门控）
//   - 强制战斗中断由 K-1 战斗导演接管（场景切换），本组件不重复呈现
//
// 与 3.5 反馈层协同（F-K5-Feedback §六.1）：
//   - 组件挂载时注册 PlaybackController 给 discovery-store
//   - 发现模态打开时 discovery-store 调用 pausePlayback()
//   - 发现模态关闭时 discovery-store 调用 resumePlayback()
//   - 完整发现模态由 DiscoveryModal.vue 统一呈现，本组件只显示紧凑摘要
//
// 逐格移动动画本身由 K-10 立绘意图 + mapStore 位置投影驱动，
// 本组件只承担进度与反馈投影，不直接操作 DOM 位置（§2.13）。
//
// 卸载清理（F-K4-Director §4.7）：
//   - onUnmounted 注销 PlaybackController
//   - 调用 nav.dispose() 清理播放定时器（场景切换到战斗时确保无残留）
//   - 清理本地 transientTimer（toast 自动淡出定时器）
// ══════════════════════════════════════════════════

import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useMoveDirectorStore } from '@/stores/move-director';
import { useDiscoveryStore } from '@/stores/discovery-store';

const nav = useMoveDirectorStore();
const discovery = useDiscoveryStore();

// ── 抵达/失败/中断 toast 的短时显示窗口（自动淡出，避免遮挡地图） ──
const showTransient = ref<boolean>(false);
let transientTimer: ReturnType<typeof setTimeout> | null = null;

function armTransient(): void {
  showTransient.value = true;
  if (transientTimer) clearTimeout(transientTimer);
  transientTimer = setTimeout(() => {
    showTransient.value = false;
    transientTimer = null;
  }, 1800);
}

// outcome 变化时触发短时 toast；interrupted_enemy 持续显示直到玩家确认
watch(
  () => nav.outcome,
  (o) => {
    if (o === 'arrived' || o === 'failed' || o === 'interrupted_enemy') armTransient();
    if (o === 'idle' && !nav.hasPendingDiscoveries) showTransient.value = false;
  },
);

// ── 是否渲染层（播放中 或 有反馈待显示） ──
const visible = computed<boolean>(() => {
  if (nav.isPlaying) return true;
  if (showTransient.value && nav.outcome !== 'idle') return true;
  return false;
});

const statusText = computed<string>(() => {
  if (nav.isPlaying) {
    const stepNo = Math.max(0, nav.currentStepIndex + 1);
    return `移动中… ${stepNo}/${nav.totalSteps}`;
  }
  if (nav.outcome === 'arrived') return nav.interruptReason || '已抵达目标';
  if (nav.outcome === 'failed') return nav.interruptReason || '导航失败';
  if (nav.outcome === 'interrupted_enemy') return nav.interruptReason || '导航中断';
  return '';
});

const progressPct = computed<number>(() => Math.round(nav.progress * 100));

// ── 紧凑发现摘要（徽章） ──
const enemyCount = computed(() => nav.enemyDiscoveries.length);
const poiCount = computed(
  () => nav.discoveries.filter((d) => d.kind === 'poi').length,
);
const itemCount = computed(
  () => nav.discoveries.filter((d) => d.kind === 'item').length,
);
const hasDiscoveries = computed(
  () => enemyCount.value > 0 || poiCount.value > 0 || itemCount.value > 0,
);

// ── 速度控制（B6.4/B6.5） ──
const speedOptions: Array<{ id: 1 | 2 | 4; label: string }> = [
  { id: 1, label: '1x' },
  { id: 2, label: '2x' },
  { id: 4, label: '4x' },
];

function onPickSpeed(s: 1 | 2 | 4): void {
  nav.setSpeed(s);
}

// ── 跳过（B6.3：立即同步到最终权威状态，不丢失领域事实） ──
function onSkip(): void {
  nav.skip();
}

// ── 注册 PlaybackController（3.5 反馈层协同，F-K5-Feedback §六.1） ──
// discovery-store 在发现模态打开时调用 pausePlayback()，关闭时调用 resumePlayback()
// 注册在 onMounted 而非 setup：避免 store 创建期间的副作用
onMounted(() => {
  discovery.registerPlaybackController({
    pausePlayback: () => nav.pausePlayback(),
    resumePlayback: () => nav.resumePlayback(),
  });
});

onUnmounted(() => {
  if (transientTimer) {
    clearTimeout(transientTimer);
    transientTimer = null;
  }
  discovery.unregisterPlaybackController();
  nav.dispose(); // §4.7 清理播放定时器（场景切换到战斗时确保无残留）
});
</script>

<template>
  <div class="move-director" :aria-hidden="!visible">
    <!-- ═══ 顶部进度条 + 速度/跳过控制（播放中显示，B6.10 始终可用） ═══ -->
    <Transition name="md-slide">
      <div v-if="nav.isPlaying" class="md-progress-wrap">
        <div class="md-progress-track">
          <div class="md-progress-fill" :style="{ width: progressPct + '%' }"></div>
        </div>
        <div class="md-progress-meta">
          <span class="md-status">{{ statusText }}</span>
          <span class="md-controls">
            <button
              v-for="opt in speedOptions"
              :key="opt.id"
              class="term-btn md-speed-btn"
              :class="{ 'is-active': nav.speed === opt.id }"
              :title="`切换为 ${opt.label} 速度播放（B6.4）`"
              @click="onPickSpeed(opt.id)"
            >[{{ opt.label }}]</button>
            <button
              class="term-btn md-skip-btn"
              title="跳过全部剩余演出，立即同步到最终权威状态（B6.3）"
              @click="onSkip"
            >[跳过]</button>
          </span>
        </div>
      </div>
    </Transition>

    <!-- ═══ 抵达 / 失败 / 中断 短时 toast（底部居中，自动淡出） ═══ -->
    <Transition name="md-fade">
      <div
        v-if="!nav.isPlaying && showTransient && visible"
        class="md-toast"
        :class="{
          'is-ok': nav.outcome === 'arrived',
          'is-fail': nav.outcome === 'failed',
          'is-interrupt': nav.outcome === 'interrupted_enemy',
        }"
      >
        <span class="md-toast-glyph">
          <template v-if="nav.outcome === 'failed'">!</template>
          <template v-else-if="nav.outcome === 'interrupted_enemy'">⚠</template>
          <template v-else>·</template>
        </span>
        <span class="md-toast-text">{{ statusText }}</span>
        <!-- 紧凑发现摘要（徽章） -->
        <span v-if="hasDiscoveries && nav.outcome === 'interrupted_enemy'" class="md-toast-summary">
          <span v-if="enemyCount" class="md-badge md-badge-enemy">敌 ×{{ enemyCount }}</span>
          <span v-if="poiCount" class="md-badge md-badge-poi">POI ×{{ poiCount }}</span>
          <span v-if="itemCount" class="md-badge md-badge-item">物 ×{{ itemCount }}</span>
        </span>
        <span v-else-if="nav.enRouteSummary && nav.outcome === 'arrived'" class="md-toast-summary">
          {{ nav.enRouteSummary }}
        </span>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.move-director {
  position: absolute;
  inset: 0;
  pointer-events: none; /* 容器不拦截地图交互；仅交互元素单独开启 */
  z-index: 6;
  display: flex;
  flex-direction: column;
}

/* ═══ 顶部进度条 ═══ */
.md-progress-wrap {
  pointer-events: none;
  position: absolute;
  top: 6px;
  left: 8px;
  right: 8px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.md-progress-track {
  height: 3px;
  background: rgba(68, 68, 68, 0.35);
  border: 1px solid rgba(68, 68, 68, 0.4);
  overflow: hidden;
}
.md-progress-fill {
  height: 100%;
  background: rgba(255, 255, 255, 0.7);
  transition: width 0.18s linear;
}
.md-progress-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 10px;
  letter-spacing: 0.05em;
  color: #bbb;
  gap: 6px;
}
.md-status {
  color: #ddd;
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.md-controls {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 0 0 auto;
}
.md-speed-btn {
  padding: 1px 5px;
  font-size: 9px;
  border-color: rgba(68, 68, 68, 0.5);
  color: #888;
  cursor: pointer;
  line-height: 1.4;
}
.md-speed-btn.is-active {
  border-color: #fff;
  color: #fff;
  background: rgba(255, 255, 255, 0.08);
}
.md-skip-btn {
  padding: 1px 6px;
  font-size: 9px;
  border-color: rgba(136, 136, 136, 0.6);
  color: #ddd;
  cursor: pointer;
  line-height: 1.4;
  margin-left: 2px;
}
.md-skip-btn:hover {
  border-color: #fff;
  color: #fff;
  background: rgba(255, 255, 255, 0.08);
}

/* ═══ 抵达/失败/中断 toast ═══ */
.md-toast {
  pointer-events: none;
  position: absolute;
  left: 50%;
  bottom: 10%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  background: rgba(10, 10, 10, 0.9);
  border: 1px solid rgba(136, 136, 136, 0.5);
  color: #ddd;
  font-size: 11px;
  letter-spacing: 0.04em;
  max-width: 92%;
  flex-wrap: wrap;
}
.md-toast.is-ok {
  border-color: rgba(255, 255, 255, 0.55);
  color: #fff;
}
.md-toast.is-fail {
  border-color: rgba(204, 136, 136, 0.55);
}
.md-toast.is-interrupt {
  border-color: rgba(255, 255, 255, 0.65);
  color: #fff;
  background: rgba(20, 20, 20, 0.95);
}
.md-toast-glyph {
  color: #fff;
  font-weight: 900;
  flex: 0 0 auto;
}
.md-toast-text {
  flex: 0 1 auto;
  word-break: break-word;
}
.md-toast-summary {
  display: flex;
  align-items: center;
  gap: 3px;
  flex-wrap: wrap;
  color: #777;
  font-size: 9px;
  border-left: 1px solid rgba(68, 68, 68, 0.5);
  padding-left: 6px;
  max-width: 60%;
}
.md-badge {
  border: 1px solid rgba(136, 136, 136, 0.5);
  padding: 0 4px;
  font-size: 9px;
  color: #ddd;
  letter-spacing: 0.02em;
  white-space: nowrap;
}
.md-badge-enemy {
  border-color: rgba(255, 255, 255, 0.55);
  color: #fff;
}
.md-badge-poi {
  border-color: rgba(170, 170, 170, 0.5);
  color: #ccc;
}
.md-badge-item {
  border-color: rgba(136, 136, 136, 0.4);
  color: #aaa;
}

/* ═══ 过渡（灰阶，§2.15） ═══ */
.md-slide-enter-active,
.md-slide-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.md-slide-enter-from,
.md-slide-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
.md-fade-enter-active,
.md-fade-leave-active {
  transition: opacity 0.2s ease;
}
.md-fade-enter-from,
.md-fade-leave-to {
  opacity: 0;
}
</style>
