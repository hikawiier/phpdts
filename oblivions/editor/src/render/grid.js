// ══════════════════════════════════════════════════
// CSS Grid 画布渲染 / Grid canvas renderer
// ══════════════════════════════════════════════════
// @module O
// @framework O-6 开局分布预览 overlay 调度入口（applyOverlays 集成 wilditem / poi 调用）
//
// 阶段2 整合（UPGRADE_DESIGN.md §2.4-2.7）：
//   - 渲染完基础格后调用 applyOverlays() 应用叠层（fog/vision/reachability/tide-heatmap + 任务3 O-6 wilditem/poi）
//   - handleCellClick 路由 sim-tools 工具（sim-set-player）到 handleSimToolClick
//   - 鼠标 hover 触发 reachability overlay 的路径预览

import state, { currentTiles, currentGrid, currentRegion, saveToStorage } from '../state.js';
import { createTile, deleteTile, updateTile, moveTile } from '../logic/tile.js';
import { breakConnection, restoreConnection, getBrokenNeighbors } from '../logic/connectivity.js';
import { setTool, getBrushPreset, isSimTool, handleSimToolClick } from '../tools.js';
import { renderConnections } from './connections.js';
import { renderTilePanel } from './tile-panel.js';
import { renderRegionPanel } from './region-panel.js';
// 阶段2 叠层模块
import { applyFogOverlay } from './overlay-fog.js';
import { applyVisionOverlay } from './overlay-vision.js';
import { applyReachabilityOverlay, setHoverTarget, clearPathLine } from './overlay-reachability.js';
import { applyTideHeatmapOverlay } from './overlay-tide-heatmap.js';
// 任务3 O-6 新增：开局分布预览 overlay（wildItems / POI 实例）
import { applyWildItemOverlay } from './overlay-wilditem.js';
import { applyPoiOverlay } from './overlay-poi.js';

const CELL_W = 52;
const CELL_H = 44;
const HEADER_W = 38;
const HEADER_H = 28;

// 拖拽状态
let dragState = null; // { pls, startX, startY, originX, originY, el }

/**
 * 渲染当前区域的网格画布
 */
export function renderGrid() {
  const container = document.getElementById('gridContainer');
  const info = document.getElementById('canvasInfo');
  if (!container) return;

  container.innerHTML = '';

  const region = currentRegion();
  if (!region) {
    container.innerHTML = '<div class="canvas-empty">选择一个区域开始编辑</div>';
    if (info) info.textContent = '选择一个区域开始编辑';
    return;
  }

  const grid = currentGrid();
  const tiles = currentTiles();
  const cols = grid.cols || 8;
  const rows = grid.rows || 6;

  // 构建坐标索引
  const coordIndex = {};
  for (const pls in tiles) {
    const t = tiles[pls];
    coordIndex[t.x + ',' + t.y] = { pls: parseInt(pls), tile: t };
  }

  // 设置网格尺寸
  container.style.gridTemplateColumns = `${HEADER_W}px repeat(${cols}, ${CELL_W}px)`;
  container.style.gridTemplateRows = `${HEADER_H}px repeat(${rows}, ${CELL_H}px)`;

  // 左上角空白格
  const corner = document.createElement('div');
  corner.className = 'grid-cell coord-header';
  corner.textContent = '#';
  container.appendChild(corner);

  // 列标题
  for (let c = 0; c < cols; c++) {
    const colHeader = document.createElement('div');
    colHeader.className = 'grid-cell coord-header';
    colHeader.textContent = c;
    container.appendChild(colHeader);
  }

  // 行
  for (let r = 0; r < rows; r++) {
    // 行标题
    const rowHeader = document.createElement('div');
    rowHeader.className = 'grid-cell coord-header';
    rowHeader.textContent = String.fromCharCode(65 + r);
    container.appendChild(rowHeader);

    for (let c = 0; c < cols; c++) {
      const cellInfo = coordIndex[c + ',' + r];
      const cell = document.createElement('div');
      cell.className = 'grid-cell';
      cell.dataset.x = c;
      cell.dataset.y = r;

      if (!cellInfo) {
        // 空白格
        cell.classList.add('cell-empty');
      } else {
        const pls = cellInfo.pls;
        const tile = cellInfo.tile;

        cell.dataset.pls = pls;

        // 状态样式
        if (state.selectedTile === pls) {
          cell.classList.add('cell-selected');
        } else if (!tile.passable) {
          cell.classList.add('cell-blocked');
        } else {
          cell.classList.add('cell-tile');
        }

        // 入口/出口标记
        if (region.entrance_pls === pls) {
          cell.classList.add('cell-entrance');
        }
        if (region.exit_pls === pls) {
          cell.classList.add('cell-exit');
        }

        // 地板/潮汐视觉标记
        if (tile.floor && tile.floor !== 'standard') {
          cell.classList.add('cell-floor-' + tile.floor);
        }
        if (tile.tide && tile.tide !== 'shallow') {
          cell.classList.add('cell-tide-' + tile.tide);
        }

        // 内容：显示坐标，有名字时追加显示
        const coord = String.fromCharCode(65 + tile.y) + tile.x;
        let html = `<span class="cell-coord">${coord}</span>`;
        if (tile.name) html += `<span class="cell-name">${escHtml(tile.name)}</span>`;
        html += `<span class="cell-pls">#${pls}</span>`;
        if (region.entrance_pls === pls) html += `<span class="cell-badge badge-entrance">入</span>`;
        if (region.exit_pls === pls) html += `<span class="cell-badge badge-exit">出</span>`;
        if (!tile.passable) html += `<span class="cell-badge badge-blocked">✕</span>`;
        cell.innerHTML = html;

        // 点击事件
        cell.addEventListener('click', () => handleCellClick(pls));

        // 拖拽事件（选择工具下）
        cell.addEventListener('mousedown', (e) => handleDragStart(e, pls));

        // 阶段2：hover 事件用于路径预览（reachability overlay 启用时）
        cell.addEventListener('mouseenter', () => handleCellHover(pls));
        cell.addEventListener('mouseleave', () => handleCellLeave());
      }

      // 空白格点击（绘制工具）
      if (!cellInfo) {
        cell.addEventListener('click', () => handleEmptyCellClick(c, r));
        // 拖拽释放目标
        cell.addEventListener('mouseup', () => handleDragDrop(c, r));
        cell.addEventListener('mouseenter', () => handleDragEnter(c, r));
        cell.addEventListener('mouseleave', () => handleDragLeave(c, r));
      }

      container.appendChild(cell);
    }
  }

  // 渲染连接线
  renderConnections();

  // 阶段2 + 任务3：应用叠层（fog/vision/reachability/tide-heatmap/wilditem/poi）
  applyOverlays(state.currentRegion, tiles);

  // 更新信息栏
  const tileCount = Object.keys(tiles).length;
  if (info) info.textContent = `${region.name} | ${cols}×${rows} | ${tileCount} 个地图格`;
}

/**
 * 应用所有叠层（fog/vision/reachability/tide-heatmap + 任务3 O-6 wilditem/poi）
 *
 * 由 renderGrid 调用：基础格渲染完毕后立即应用叠层 CSS 类。
 * 各叠层通过 state.overlayFlags 自判是否启用，互不干扰。
 *
 * @param {number} pgroup 当前区域
 * @param {Object} tiles  当前区域 tiles
 */
function applyOverlays(pgroup, tiles) {
  if (pgroup === null) return;
  applyFogOverlay(pgroup, tiles);
  applyVisionOverlay(pgroup, tiles);
  applyReachabilityOverlay(pgroup, tiles);
  applyTideHeatmapOverlay(pgroup, tiles);
  // 任务3 O-6 新增：开局分布预览 overlay（仅 state.backend.connected 时由 main.js 允许启用）
  applyWildItemOverlay(pgroup, tiles);
  applyPoiOverlay(pgroup, tiles);
}

/**
 * 处理已有地图格的点击
 */
function handleCellClick(pls) {
  // 拖拽中不处理点击
  if (dragState && dragState.moved) return;

  const tool = state.currentTool;
  const pgroup = state.currentRegion;

  // 阶段2：sim-tools 工具路由（sim-set-player）
  if (isSimTool(tool)) {
    if (handleSimToolClick(pgroup, pls)) {
      // 玩家位置变化 → 重渲染画布以应用叠层
      renderGrid();
      renderTilePanel();
    }
    return;
  }

  switch (tool) {
    case 'select':
      state.selectedTile = pls;
      renderGrid();
      renderTilePanel();
      break;

    case 'erase':
      deleteTile(pgroup, pls);
      if (state.selectedTile === pls) state.selectedTile = null;
      renderGrid();
      renderTilePanel();
      renderRegionPanel();
      break;

    case 'paint': {
      const preset = getBrushPreset();
      updateTile(pgroup, pls, {
        floor: preset.floor,
        tide: preset.tide,
        passable: preset.passable,
      });
      renderGrid();
      renderTilePanel();
      break;
    }

    case 'break':
      if (state.breakFirst === null) {
        state.breakFirst = pls;
        // 高亮第一步
        document.querySelectorAll(`[data-pls="${pls}"]`).forEach(el => el.classList.add('cell-break-first'));
      } else if (state.breakFirst !== pls) {
        breakConnection(pgroup, state.breakFirst, pls);
        state.breakFirst = null;
        renderGrid();
        renderTilePanel();
      }
      break;

    case 'restore':
      if (state.breakFirst === null) {
        state.breakFirst = pls;
        document.querySelectorAll(`[data-pls="${pls}"]`).forEach(el => el.classList.add('cell-restore-first'));
      } else if (state.breakFirst !== pls) {
        restoreConnection(pgroup, state.breakFirst, pls);
        state.breakFirst = null;
        renderGrid();
        renderTilePanel();
      }
      break;
  }
}

/**
 * 处理空白格的点击（绘制工具）
 */
function handleEmptyCellClick(x, y) {
  if (state.currentTool !== 'draw') return;

  const pgroup = state.currentRegion;
  const preset = getBrushPreset();
  const pls = createTile(pgroup, x, y, preset);
  if (pls !== null) {
    state.selectedTile = pls;
    renderGrid();
    renderTilePanel();
    renderRegionPanel();
  }
}

// ══════════════════════════════════════════════════
// 拖拽移动 / Drag to move tile
// ══════════════════════════════════════════════════

function handleDragStart(e, pls) {
  if (state.currentTool !== 'select') return;
  if (e.button !== 0) return; // 仅左键

  const tiles = currentTiles();
  const tile = tiles[pls];
  if (!tile) return;

  const el = e.currentTarget;
  dragState = {
    pls,
    originX: tile.x,
    originY: tile.y,
    el,
    moved: false,
    startX: e.clientX,
    startY: e.clientY,
  };

  el.classList.add('cell-dragging');

  // 全局 mousemove/mouseup 监听
  document.addEventListener('mousemove', handleDragMove);
  document.addEventListener('mouseup', handleDragEnd);
}

function handleDragMove(e) {
  if (!dragState) return;

  // 判断是否真正移动了（阈值 4px 防误触）
  const dx = e.clientX - dragState.startX;
  const dy = e.clientY - dragState.startY;
  if (!dragState.moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;

  dragState.moved = true;

  // 计算鼠标在 gridContainer 中的位置，确定目标格
  const container = document.getElementById('gridContainer');
  if (!container) return;

  const rect = container.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  const grid = currentGrid();
  const cols = grid.cols || 8;
  const rows = grid.rows || 6;

  // 减去表头偏移
  const cellX = Math.floor((mx - HEADER_W) / CELL_W);
  const cellY = Math.floor((my - HEADER_H) / CELL_H);

  // 清除之前的高亮
  container.querySelectorAll('.cell-drop-target, .cell-drop-forbidden').forEach(el => {
    el.classList.remove('cell-drop-target', 'cell-drop-forbidden');
  });

  if (cellX >= 0 && cellX < cols && cellY >= 0 && cellY < rows) {
    // 检查目标格是否为空
    const tiles = currentTiles();
    const occupied = Object.values(tiles).some(t => t.x === cellX && t.y === cellY);

    const targetCell = container.querySelector(`[data-x="${cellX}"][data-y="${cellY}"]`);
    if (targetCell) {
      if (occupied && !(cellX === dragState.originX && cellY === dragState.originY)) {
        targetCell.classList.add('cell-drop-forbidden');
      } else {
        targetCell.classList.add('cell-drop-target');
      }
    }
  }
}

function handleDragEnd(e) {
  document.removeEventListener('mousemove', handleDragMove);
  document.removeEventListener('mouseup', handleDragEnd);

  if (!dragState) return;

  const { pls, originX, originY, el, moved } = dragState;

  // 清除高亮
  const container = document.getElementById('gridContainer');
  if (container) {
    container.querySelectorAll('.cell-drop-target, .cell-drop-forbidden').forEach(c => {
      c.classList.remove('cell-drop-target', 'cell-drop-forbidden');
    });
  }

  el.classList.remove('cell-dragging');

  if (!moved) {
    dragState = null;
    return;
  }

  // 计算目标格
  const rect = container.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  const grid = currentGrid();
  const cols = grid.cols || 8;
  const rows = grid.rows || 6;

  const cellX = Math.floor((mx - HEADER_W) / CELL_W);
  const cellY = Math.floor((my - HEADER_H) / CELL_H);

  // 验证目标
  if (cellX >= 0 && cellX < cols && cellY >= 0 && cellY < rows
      && !(cellX === originX && cellY === originY)) {
    const tiles = currentTiles();
    const occupied = Object.values(tiles).some(t => t.x === cellX && t.y === cellY);

    if (!occupied) {
      moveTile(state.currentRegion, pls, cellX, cellY);
      renderGrid();
      renderTilePanel();
    }
  }

  dragState = null;
}

function handleDragDrop(x, y) {
  // mouseup 在空白格上触发时，handleDragEnd 已处理
  // 此处留空，逻辑统一在 handleDragEnd 中
}

function handleDragEnter(x, y) {
  if (!dragState || !dragState.moved) return;
  // 高亮由 handleDragMove 统一处理
}

function handleDragLeave(x, y) {
  if (!dragState || !dragState.moved) return;
  // 高亮由 handleDragMove 统一处理
}

// ══════════════════════════════════════════════════
// 阶段2：hover 事件（路径预览，reachability overlay 启用时）
// ══════════════════════════════════════════════════

/**
 * 格 hover 进入：reachability overlay 启用时设置目标格 → 重绘路径线
 */
function handleCellHover(pls) {
  if (!state.overlayFlags.reachability) return;
  if (dragState && dragState.moved) return;  // 拖拽中不处理 hover
  setHoverTarget(pls);
  // 重画叠层（路径线变化）
  applyReachabilityOverlay(state.currentRegion, currentTiles());
}

/**
 * 格 hover 离开：清除路径线
 */
function handleCellLeave() {
  if (!state.overlayFlags.reachability) return;
  setHoverTarget(null);
  clearPathLine();
}

function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
