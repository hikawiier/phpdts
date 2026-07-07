<script setup lang="ts">
// ══════════════════════════════════════════════════
// 瞄准模式 / Aim Mode
//
// 替代现有 vex/js/battle-aim.js 的 DOM 操作逻辑。
// 职责：
// - 监听 battle:aim-mode / battle:aim-exit 事件
// - 瞄准模式下标记敌人格为可选目标（.aim-targetable class）
// - mousemove 实时绘制 SVG 贝塞尔曲线（AP 栏 → 光标/敌人）
// - 点击敌人格确认目标 → broadcast 'battle:aim-target-selected'
//
// 实现说明：
// - 敌人格的 .aim-targetable class 通过 DOM 操作添加/移除（CSS 高亮效果）
// - SVG 路径线用 Vue 响应式 aimLine ref + computed pathData 驱动
// - click/mousemove 用事件委托（绑定在 mapGrid 上，检查 event.target.closest）
// ══════════════════════════════════════════════════

import { ref, computed, onMounted, onUnmounted } from 'vue';
import { dataManager } from '@/stores/data-manager';
import { useMapStore } from '@/stores/map';
import { findPath } from '@/composables/useMapReachability';

// ── 状态 ──
const aimModeActive = ref<boolean>(false);
const aimActionRange = ref<number>(1);
const mapStore = useMapStore();

// ── SVG 路径线数据 ──
interface AimLineData {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  visible: boolean;
}
const aimLine = ref<AimLineData>({ startX: 0, startY: 0, endX: 0, endY: 0, visible: false });

// ── 贝塞尔曲线路径 computed ──
const pathData = computed<string>(() => {
  if (!aimLine.value.visible) return '';
  const { startX, startY, endX, endY } = aimLine.value;

  // 柔化三次贝塞尔曲线：两端切线水平，平滑过渡
  const dx = Math.abs(startX - endX);
  const offset = Math.max(40, dx * 0.35);
  const cp1X = startX - offset;
  const cp1Y = startY;
  const cp2X = endX + offset;
  const cp2Y = endY;

  return `M ${startX} ${startY} C ${cp1X} ${cp1Y}, ${cp2X} ${cp2Y}, ${endX} ${endY}`;
});

// ── 事件处理函数引用（用于 add/removeEventListener） ──
let _onMouseMove: ((e: MouseEvent) => void) | null = null;
let _onMouseLeave: (() => void) | null = null;
let _onClick: ((e: MouseEvent) => void) | null = null;
let _onKeyDown: ((e: KeyboardEvent) => void) | null = null;

// ══════════════════════════════════════════════════
// DOM 元素查询
// ══════════════════════════════════════════════════

function getMapGrid(): HTMLElement | null {
  return document.getElementById('mapGrid');
}

/** 获取 AP 栏元素作为瞄准线起点 */
function getAimStartElement(): HTMLElement | null {
  return (
    document.querySelector<HTMLElement>('.ap-bar-container') ||
    document.getElementById('preloadQueueArea') ||
    document.getElementById('battleActionBar')
  );
}

// ══════════════════════════════════════════════════
// 标记敌人格
// ══════════════════════════════════════════════════

/** 标记所有敌人格为瞄准可选目标 + 绑定事件 */

function isEnemyInActionRange(pid: number): boolean {
  const range = Math.max(0, Number(aimActionRange.value || 1));
  const enemy = mapStore.enemies.find(
    (e) => Number(e.pid) === pid && Number(e.state) === 0 && String(e.pgroup) === String(mapStore.curRegion),
  );
  if (!enemy || mapStore.curLoc === null) return false;
  const path = findPath(mapStore.curLoc, enemy.pls);
  if (!path) return false;
  return Math.max(0, path.length - 1) <= range;
}

function applyAimTargetable(): void {
  const grid = getMapGrid();
  if (!grid) return;

  const enemyCells = grid.querySelectorAll<HTMLElement>('[data-enemy-pid]');
  enemyCells.forEach((cell) => {
    const pid = parseInt(cell.getAttribute('data-enemy-pid') || '0');
    cell.classList.remove('aim-targetable', 'aim-out-of-range');
    if (pid > 0 && isEnemyInActionRange(pid)) {
      cell.classList.add('aim-targetable');
    } else {
      cell.classList.add('aim-out-of-range');
    }
  });

  // 事件委托：在 mapGrid 上绑定 mousemove + click
  _onMouseMove = onAimMouseMove;
  _onMouseLeave = onAimMouseLeave;
  _onClick = onAimClick;
  grid.addEventListener('mousemove', _onMouseMove);
  grid.addEventListener('mouseleave', _onMouseLeave);
  grid.addEventListener('click', _onClick);
}

/** 清除所有敌人格的瞄准标记和事件 */
function clearAimTargetable(): void {
  const grid = getMapGrid();
  if (!grid) return;

  const enemyCells = grid.querySelectorAll<HTMLElement>('[data-enemy-pid]');
  enemyCells.forEach((cell) => {
    cell.classList.remove('aim-targetable', 'aim-hover', 'aim-out-of-range');
  });

  if (_onMouseMove) grid.removeEventListener('mousemove', _onMouseMove);
  if (_onMouseLeave) grid.removeEventListener('mouseleave', _onMouseLeave);
  if (_onClick) grid.removeEventListener('click', _onClick);
  _onMouseMove = null;
  _onMouseLeave = null;
  _onClick = null;
}

// ══════════════════════════════════════════════════
// mousemove：实时绘制瞄准线
// ══════════════════════════════════════════════════

function onAimMouseMove(e: MouseEvent): void {
  const target = e.target as HTMLElement | null;
  const enemyCell = target?.closest?.('[data-enemy-pid].aim-targetable') as HTMLElement | null;

  // 清除所有敌人格的 aim-hover，仅高亮当前
  const grid = getMapGrid();
  if (grid) {
    grid.querySelectorAll<HTMLElement>('.aim-hover').forEach((c) => c.classList.remove('aim-hover'));
  }

  if (enemyCell) {
    enemyCell.classList.add('aim-hover');
    const rect = enemyCell.getBoundingClientRect();
    drawAimLine(rect.left + rect.width / 2, rect.top + rect.height / 2);
  } else {
    drawAimLine(e.clientX, e.clientY);
  }
}

/** 光标离开地图区域：清除瞄准线 */
function onAimMouseLeave(): void {
  const grid = getMapGrid();
  if (grid) {
    grid.querySelectorAll<HTMLElement>('.aim-hover').forEach((c) => c.classList.remove('aim-hover'));
  }
  clearAimLine();
}

// ══════════════════════════════════════════════════
// 点击敌人格确认目标
// ══════════════════════════════════════════════════

function onAimClick(e: MouseEvent): void {
  const target = e.target as HTMLElement | null;
  const enemyCell = target?.closest?.('[data-enemy-pid].aim-targetable') as HTMLElement | null;
  if (!enemyCell) return;

  e.stopPropagation();
  const pid = parseInt(enemyCell.getAttribute('data-enemy-pid') || '0');
  if (pid > 0) {
    // 通知 PreloadArea 目标已选定
    dataManager.broadcast('battle:aim-target-selected', { pid });
  }
}

// ══════════════════════════════════════════════════
// SVG 瞄准线绘制
// ══════════════════════════════════════════════════

/**
 * 绘制瞄准路径线（AP 栏左边缘 → 指定坐标）
 *
 * 更新 aimLine ref，由 computed pathData 驱动 SVG 渲染。
 */
function drawAimLine(endX: number, endY: number): void {
  const startEl = getAimStartElement();
  if (!startEl) return;

  const startRect = startEl.getBoundingClientRect();
  const startX = startRect.left;
  const startY = startRect.top + startRect.height / 2;

  aimLine.value = {
    startX,
    startY,
    endX,
    endY,
    visible: true,
  };
}

/** 清除瞄准路径线 */
function clearAimLine(): void {
  aimLine.value = { ...aimLine.value, visible: false };
}

// ══════════════════════════════════════════════════
// 退出瞄准模式
// ══════════════════════════════════════════════════

function exitAimMode(): void {
  // 广播 battle:aim-exit，PreloadArea 监听后清理自身状态
  dataManager.broadcast('battle:aim-exit');
}

// ══════════════════════════════════════════════════
// 事件监听
// ══════════════════════════════════════════════════

function onAimMode(data?: unknown): void {
  const payload = (data || {}) as { actionRange?: number | string };
  aimActionRange.value = Math.max(0, Number(payload.actionRange || 1));
  aimModeActive.value = true;
  applyAimTargetable();
}

function onAimExit(): void {
  aimModeActive.value = false;
  clearAimTargetable();
  clearAimLine();
}

function onBattleEnded(): void {
  if (aimModeActive.value) {
    exitAimMode();
  }
}

function onMapLoaded(): void {
  if (aimModeActive.value) applyAimTargetable();
}

onMounted(() => {
  dataManager.listen('battle:aim-mode', onAimMode);
  dataManager.listen('battle:aim-exit', onAimExit);
  dataManager.listen('battle:ended', onBattleEnded);
  dataManager.listen('map:loaded', onMapLoaded);

  // ESC 键退出瞄准模式
  _onKeyDown = (e: KeyboardEvent) => {
    if (aimModeActive.value && e.key === 'Escape') {
      exitAimMode();
    }
  };
  document.addEventListener('keydown', _onKeyDown);
});

onUnmounted(() => {
  dataManager.unlisten('battle:aim-mode', onAimMode);
  dataManager.unlisten('battle:aim-exit', onAimExit);
  dataManager.unlisten('battle:ended', onBattleEnded);
  dataManager.unlisten('map:loaded', onMapLoaded);
  clearAimTargetable();
  clearAimLine();
  if (_onKeyDown) {
    document.removeEventListener('keydown', _onKeyDown);
  }
});
</script>

<template>
  <!-- SVG 瞄准线覆盖层（Teleport to body，fixed 定位） -->
  <Teleport to="body">
    <svg
      v-show="aimLine.visible"
      class="aim-line-overlay"
    >
      <path :d="pathData" />
      <circle
        v-if="aimLine.visible"
        :cx="aimLine.startX"
        :cy="aimLine.startY"
        r="3"
        class="aim-dot"
      />
      <circle
        v-if="aimLine.visible"
        :cx="aimLine.endX"
        :cy="aimLine.endY"
        r="3"
        class="aim-dot"
      />
    </svg>
  </Teleport>
</template>

<style scoped>
.aim-line-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  pointer-events: none;
  z-index: 500;
}

.aim-line-overlay path {
  fill: none;
  stroke: #ff6b6b;
  stroke-width: 1.5;
  stroke-dasharray: 4 3;
  opacity: 0.7;
}

.aim-line-overlay .aim-dot {
  fill: #ff6b6b;
  opacity: 0.8;
}

:global(.aim-targetable) {
  outline: 1px solid #ff6b6b;
  box-shadow: inset 0 0 0 1px rgba(255, 107, 107, 0.65), 0 0 8px rgba(255, 107, 107, 0.35);
  cursor: crosshair;
}

:global(.aim-hover) {
  filter: brightness(1.25);
}

:global(.aim-out-of-range) {
  opacity: 0.45;
  cursor: not-allowed;
}
</style>

