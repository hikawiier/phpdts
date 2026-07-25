/**
 * @module M 组合式函数
 * @framework M-4 命令式事件处理
 */

// ══════════════════════════════════════════════════
// 地图交互层 / Map interaction layer
//
// 替代现有 vex/js/map-interaction.js。
// 职责：缩放、平移、键盘、触摸、路径预览、居中。
//
// 通过 setInteractionCallbacks 注入 onKeyMove（键盘移动业务逻辑），
// 避免 map-interaction ↔ useMapBusiness 的循环依赖。
//
// 使用方式：
//   const cleanup = initMapInteraction(containerEl, gridEl);
//   onUnmounted(() => cleanup());
// ══════════════════════════════════════════════════

import { ref, type Ref } from 'vue';
import { useMapStore } from '@/stores/map';
import { useUiStore } from '@/stores/ui';
import { useBattleStore } from '@/stores/battle';
import { applyZoom, getZoomLevel, renderMapGrid, ZOOM_STEP, triggerShakeCurrent } from '@/composables/useMapRender';
import { findPath, getDirectionArrow, isReachable } from '@/composables/useMapReachability';
import type { TileInfo } from '@/types/api';
import { isBattleMapInputLocked } from '@/stores/battle-ui-policy';
import { usePresentationSceneStore } from '@/stores/presentation-scene';
import type { ScenePoint } from '@/types/scene';

// ─── 回调注入（由 useMapBusiness 调用） ───
let _onKeyMove: ((pls: string | number) => Promise<void> | void) | null = null;

// ─── 路径预览响应式状态 ───
// pls → 方向箭头字符。空 Map 表示无预览。
// 由 showPathPreview/clearPathPreview 维护，由 useMapRender.cells computed 消费，
// 让 Vue 通过 :class / v-if 管理 DOM，避免命令式 appendChild 与 v-for diff 冲突。
const pathPreviewCells: Ref<Map<string, string>> = ref(new Map());

/**
 * 注入交互回调
 * @param callbacks.onKeyMove(areaId) 键盘移动到目标格
 */
export function setInteractionCallbacks(callbacks: {
  onKeyMove: (pls: string | number) => Promise<void> | void;
}): void {
  if (callbacks.onKeyMove) _onKeyMove = callbacks.onKeyMove;
}

/**
 * 处理方向键/WASD 移动
 * @param dx X 方向偏移 (-1/0/1)
 * @param dy Y 方向偏移 (-1/0/1)
 */
async function handleKeyMove(dx: number, dy: number): Promise<void> {
  const mapStore = useMapStore();
  if (mapStore.curLoc === null || mapStore.curRegion === null || !mapStore.links) return;

  const tiles = mapStore.links.tiles[String(mapStore.curRegion)] as Record<string, TileInfo & { x?: number; y?: number }> | undefined;
  if (!tiles) return;
  const curTile = tiles[String(mapStore.curLoc)];
  if (!curTile || curTile.x === undefined || curTile.y === undefined) return;

  const targetX = curTile.x + dx;
  const targetY = curTile.y + dy;

  // 查找目标坐标对应的 pls
  let targetPls: string | null = null;
  for (const pls in tiles) {
    const t = tiles[pls];
    if (t.x === targetX && t.y === targetY) {
      targetPls = pls;
      break;
    }
  }

  // 无效移动判断
  if (targetPls === null) {
    shakeCurrentCell();
    return;
  }

  // 检查可达性（BFS 距离判定，含迷雾过滤）
  if (!isReachable(targetPls)) {
    shakeCurrentCell();
    return;
  }

  // 执行移动（通过回调注入的 clickMove）
  if (_onKeyMove) await _onKeyMove(targetPls);
}

/**
 * 当前格抖动反馈（无效移动时）
 *
 * 委托 useMapRender.triggerShakeCurrent 写入响应式状态，由 cells computed 驱动 :class 渲染。
 * 取代旧命令式 classList.add + setTimeout 自清理（Vue v-for diff 不清理命令式 class）。
 */
export function shakeCurrentCell(): void {
  triggerShakeCurrent();
}

function offsetWithinContainer(
  element: HTMLElement,
  container: HTMLElement,
): { left: number; top: number } | null {
  let cellOffsetLeft = 0;
  let cellOffsetTop = 0;
  let el: HTMLElement | null = element;
  while (el && el !== container) {
    cellOffsetLeft += el.offsetLeft;
    cellOffsetTop += el.offsetTop;
    el = el.offsetParent as HTMLElement | null;
  }
  return el === container ? { left: cellOffsetLeft, top: cellOffsetTop } : null;
}

function scrollCameraTo(
  contentX: number,
  contentY: number,
  container: HTMLElement,
  smooth: boolean,
): void {
  container.scrollTo({
    left: Math.max(0, contentX - container.clientWidth / 2),
    top: Math.max(0, contentY - container.clientHeight / 2),
    behavior: smooth ? 'smooth' : 'auto',
  });
}

/** 将场景坐标移动到相机中心，供动画进度驱动的连续跟随使用。 */
export function centerOnScenePoint(point: ScenePoint, smooth = false): void {
  const grid = document.getElementById('mapGrid');
  const container = document.getElementById('mapContainer');
  if (!grid || !container) return;
  const gridOffset = offsetWithinContainer(grid, container);
  if (!gridOffset) return;
  scrollCameraTo(gridOffset.left + point.x, gridOffset.top + point.y, container, smooth);
}

/** 仅在元素越出相机中心安全区时修正滚动，保留局部动作幅度。 */
export function keepElementWithinCameraSafeZone(
  element: HTMLElement,
  horizontalRadius: number,
  verticalRadius: number,
): void {
  const container = document.getElementById('mapContainer');
  if (!container || !element.isConnected) return;
  const elementRect = element.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  const deltaX = elementRect.left + elementRect.width / 2
    - (containerRect.left + containerRect.width / 2);
  const deltaY = elementRect.top + elementRect.height / 2
    - (containerRect.top + containerRect.height / 2);
  const correctionX = Math.abs(deltaX) > horizontalRadius
    ? deltaX - Math.sign(deltaX) * horizontalRadius
    : 0;
  const correctionY = Math.abs(deltaY) > verticalRadius
    ? deltaY - Math.sign(deltaY) * verticalRadius
    : 0;
  if (correctionX === 0 && correctionY === 0) return;
  container.scrollTo({
    left: Math.max(0, container.scrollLeft + correctionX),
    top: Math.max(0, container.scrollTop + correctionY),
    behavior: 'auto',
  });
}

/** 将指定图格移动到相机中心。 */
export function centerOnTile(pls: string | number, smooth = true): void {
  const grid = document.getElementById('mapGrid');
  const container = document.getElementById('mapContainer');
  const targetCell = grid
    ? grid.querySelector(`[data-pls="${String(pls)}"]`) as HTMLElement | null
    : null;
  if (!targetCell || !container) return;
  const cellOffset = offsetWithinContainer(targetCell, container);
  if (!cellOffset) return;

  const cellW = targetCell.offsetWidth;
  const cellH = targetCell.offsetHeight;
  scrollCameraTo(
    cellOffset.left + cellW / 2,
    cellOffset.top + cellH / 2,
    container,
    smooth,
  );
}

/**
 * 居中到导演视觉中心；无演出冻结时回退到玩家权威位置。
 */
export function centerOnPlayer(smooth = true): void {
  const mapStore = useMapStore();
  const cameraPls = mapStore.visualCenter ?? mapStore.curLoc;
  if (cameraPls === null) return;
  centerOnTile(cameraPls, smooth);
}

/**
 * 路径预览响应式状态（供 useMapRender.cells computed 消费）
 *
 * 每个条目：pls → 方向箭头字符。空 Map 表示无预览。
 * 由 showPathPreview/clearPathPreview 维护；Vue 通过 :class / v-if 渲染。
 */
export function getPathPreviewCells(): ReadonlyMap<string, string> {
  return pathPreviewCells.value;
}

/**
 * 清除所有路径预览高亮
 *
 * 通过清空响应式状态触发 cells computed 重算，
 * Vue 在 patch 时自动移除 .cell-path class 与 .cell-path-arrow 子节点。
 */
export function clearPathPreview(): void {
  if (pathPreviewCells.value.size === 0) return;
  pathPreviewCells.value = new Map();
}

/**
 * 显示从当前格到目标格的路径预览
 *
 * 计算路径后写入响应式状态（pls → arrow），不再操作 DOM。
 * 迷雾中间格不写入（保持神秘感）。
 */
export function showPathPreview(targetPls: string | number): void {
  const mapStore = useMapStore();
  if (mapStore.curLoc === null || mapStore.curRegion === null || !mapStore.links) {
    clearPathPreview();
    return;
  }

  const path = findPath(mapStore.curLoc, targetPls);
  if (!path || path.length < 2) {
    clearPathPreview();
    return;
  }

  const tiles = mapStore.links.tiles[String(mapStore.curRegion)] as Record<string, TileInfo & { x?: number; y?: number }> | undefined;
  if (!tiles) {
    clearPathPreview();
    return;
  }

  const fogData = mapStore.links.fog as Record<string, Record<string, number>> | undefined;
  const regionFog = fogData && fogData[String(mapStore.curRegion)] ? fogData[String(mapStore.curRegion)] : {};

  // 路径中间格（不含起点和终点）高亮 + 方向箭头
  // 迷雾中间格不高亮（保持神秘感）
  const next = new Map<string, string>();
  for (let i = 1; i < path.length - 1; i++) {
    const pls = path[i];
    if (!regionFog[String(pls)]) continue; // 迷雾格跳过

    const fromTile = tiles[String(path[i - 1])];
    const toTile = tiles[String(pls)];
    if (fromTile && toTile && fromTile.x !== undefined && fromTile.y !== undefined && toTile.x !== undefined && toTile.y !== undefined) {
      const arrow = getDirectionArrow(
        { x: fromTile.x, y: fromTile.y },
        { x: toTile.x, y: toTile.y },
      );
      if (arrow) {
        next.set(String(pls), arrow);
      }
    }
  }

  pathPreviewCells.value = next;
}

/**
 * 计算两个触摸点之间的距离
 */
function getTouchDistance(touches: TouchList): number {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * 初始化地图交互事件（缩放/平移/触摸/双击/键盘）
 *
 * 与现有 map-interaction.js initMapInteraction 一致，改为：
 *   - 接受 containerEl 参数（Vue ref 传入）
 *   - 返回 cleanup 函数（用于 onUnmounted 清理事件监听）
 *
 * @param containerEl #mapContainer DOM 元素
 * @param gridEl #mapGrid DOM 元素（用于缩放时重新渲染）
 * @returns cleanup 函数（移除所有事件监听）
 */
export function initMapInteraction(
  containerEl: HTMLElement,
  gridEl: HTMLElement,
): () => void {
  // ─── 滚轮缩放（桌面端，Ctrl+滚轮） ───
  const onWheel = (e: WheelEvent): void => {
    e.preventDefault(); // 阻止默认滚动，无论是否 Ctrl
    if (!e.ctrlKey) return; // 仅 Ctrl+滚轮触发缩放
    const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
    applyZoom(getZoomLevel() + delta, gridEl, containerEl);
  };
  containerEl.addEventListener('wheel', onWheel, { passive: false });

  // ─── 鼠标拖拽平移（桌面端） ───
  let isDragging = false;
  let dragStartX = 0, dragStartY = 0;
  let scrollStartX = 0, scrollStartY = 0;

  const onMouseDown = (e: MouseEvent): void => {
    // 只在空白处/地图格上拖拽，不阻断按钮点击
    if ((e.target as HTMLElement).closest('.zoom-btn')) return;
    isDragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    scrollStartX = containerEl.scrollLeft;
    scrollStartY = containerEl.scrollTop;
    containerEl.style.cursor = 'grabbing';
  };
  const onMouseMove = (e: MouseEvent): void => {
    if (!isDragging) return;
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;
    containerEl.scrollLeft = scrollStartX - dx;
    containerEl.scrollTop = scrollStartY - dy;
  };
  const onMouseUp = (): void => {
    if (isDragging) {
      isDragging = false;
      containerEl.style.cursor = '';
    }
  };
  containerEl.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);

  // ─── 触摸缩放/平移（移动端） ───
  let touchStartDist = 0;
  let touchStartZoom = 1;
  let isTouchZooming = false;

  const onTouchStart = (e: TouchEvent): void => {
    if (e.touches.length === 2) {
      isTouchZooming = true;
      touchStartDist = getTouchDistance(e.touches);
      touchStartZoom = getZoomLevel();
    }
  };
  const onTouchMove = (e: TouchEvent): void => {
    if (e.touches.length === 2 && isTouchZooming) {
      e.preventDefault();
      const dist = getTouchDistance(e.touches);
      const scale = dist / touchStartDist;
      applyZoom(touchStartZoom * scale, gridEl, containerEl);
    }
    // 单指平移由浏览器原生滚动处理
  };
  const onTouchEnd = (): void => {
    isTouchZooming = false;
  };
  containerEl.addEventListener('touchstart', onTouchStart, { passive: true });
  containerEl.addEventListener('touchmove', onTouchMove, { passive: false });
  containerEl.addEventListener('touchend', onTouchEnd);

  // ─── 缩放 +/- 按钮 ───
  const zoomInBtn = document.getElementById('zoomIn');
  const zoomOutBtn = document.getElementById('zoomOut');
  const onZoomIn = (): void => applyZoom(getZoomLevel() + ZOOM_STEP, gridEl, containerEl);
  const onZoomOut = (): void => applyZoom(getZoomLevel() - ZOOM_STEP, gridEl, containerEl);
  if (zoomInBtn) zoomInBtn.addEventListener('click', onZoomIn);
  if (zoomOutBtn) zoomOutBtn.addEventListener('click', onZoomOut);

  // ─── 窗口 resize ───
  let resizeTimer: ReturnType<typeof setTimeout> | null = null;
  const onResize = (): void => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      renderMapGrid(gridEl, containerEl);
      requestAnimationFrame(() => centerOnPlayer(false));
    }, 150);
  };
  window.addEventListener('resize', onResize);

  // ─── 键盘方向键/WASD 移动 ───
  const onKeyDown = (e: KeyboardEvent): void => {
    // 输入框聚焦时忽略
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TAGNAME') return;
    // 模态框/抽屉打开时忽略（与现有 map-interaction.js 一致）
    const uiStore = useUiStore();
    if (uiStore.modalOpen || uiStore.playerDrawerOpen || uiStore.inventoryDrawerOpen) return;
    // 瞄准模式下地图点击/键盘移动由 AimMode 独占消费，不能触发真实移动
    if (uiStore.mapInputMode === 'aim') return;
    // 战斗事务期间地图命令输入由战斗 UI 独占。
    const battleStore = useBattleStore();
    const presentationScene = usePresentationSceneStore();
    if (isBattleMapInputLocked({
      currentMode: battleStore.currentMode,
      isPlayingBattleLog: battleStore.isPlayingBattleLog,
      isProcessingBattle: battleStore.isProcessingBattle,
      presentationPhase: presentationScene.phase,
    })) return;

    let dx = 0, dy = 0;
    switch (e.key) {
      case 'ArrowUp': case 'w': case 'W':    dy = -1; break;
      case 'ArrowDown': case 's': case 'S':  dy = 1;  break;
      case 'ArrowLeft': case 'a': case 'A':  dx = -1; break;
      case 'ArrowRight': case 'd': case 'D': dx = 1;  break;
      default: return;
    }
    e.preventDefault();
    handleKeyMove(dx, dy);
  };
  document.addEventListener('keydown', onKeyDown);

  // ─── 返回 cleanup 函数 ───
  return () => {
    containerEl.removeEventListener('wheel', onWheel);
    containerEl.removeEventListener('mousedown', onMouseDown);
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    containerEl.removeEventListener('touchstart', onTouchStart);
    containerEl.removeEventListener('touchmove', onTouchMove);
    containerEl.removeEventListener('touchend', onTouchEnd);
    if (zoomInBtn) zoomInBtn.removeEventListener('click', onZoomIn);
    if (zoomOutBtn) zoomOutBtn.removeEventListener('click', onZoomOut);
    window.removeEventListener('resize', onResize);
    document.removeEventListener('keydown', onKeyDown);
    if (resizeTimer) clearTimeout(resizeTimer);
  };
}
