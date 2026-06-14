// ══════════════════════════════════════════════════
// CSS Grid 画布渲染 / Grid canvas renderer
// ══════════════════════════════════════════════════

import state, { currentTiles, currentGrid, currentRegion } from '../state.js';
import { createTile, deleteTile } from '../logic/tile.js';
import { breakConnection, restoreConnection, getBrokenNeighbors } from '../logic/connectivity.js';
import { setTool } from '../tools.js';
import { renderConnections } from './connections.js';
import { renderTilePanel } from './tile-panel.js';
import { renderRegionPanel } from './region-panel.js';

const CELL_W = 52;
const CELL_H = 44;
const HEADER_W = 38;
const HEADER_H = 28;

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
      }

      // 空白格点击（绘制工具）
      if (!cellInfo) {
        cell.addEventListener('click', () => handleEmptyCellClick(c, r));
      }

      container.appendChild(cell);
    }
  }

  // 渲染连接线
  renderConnections();

  // 更新信息栏
  const tileCount = Object.keys(tiles).length;
  if (info) info.textContent = `${region.name} | ${cols}×${rows} | ${tileCount} 个地图格`;
}

/**
 * 处理已有地图格的点击
 */
function handleCellClick(pls) {
  const tool = state.currentTool;
  const pgroup = state.currentRegion;

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
  const pls = createTile(pgroup, x, y);
  if (pls !== null) {
    state.selectedTile = pls;
    renderGrid();
    renderTilePanel();
    renderRegionPanel();
  }
}

function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
