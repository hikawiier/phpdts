// ══════════════════════════════════════════════════
// 右栏：地图格属性面板 / Tile properties panel
// ══════════════════════════════════════════════════
// @module O

import state, { selectedTileData, currentGrid } from '../state.js';
import { updateTile, deleteTile } from '../logic/tile.js';
import { breakConnection, restoreConnection } from '../logic/connectivity.js';
import { renderGrid } from './grid.js';
import { renderRegionPanel } from './region-panel.js';

const FLOOR_OPTIONS = [
  { value: 'standard', label: '标准 (standard)' },
  { value: 'water', label: '含水 (water)' },
  { value: 'vegetation', label: '覆植 (vegetation)' },
  { value: 'metal', label: '金属 (metal)' },
  { value: 'magic', label: '富魔力 (magic)' },
];

const TIDE_OPTIONS = [
  { value: 'shallow', label: '浅滩 (shallow)' },
  { value: 'deep', label: '深水 (deep)' },
  { value: 'abyss', label: '深海 (abyss)' },
];
// 注：`safe` 不是 tide 取值（DESIGN.md 1.3），安全区由独立字段 `preset_safe` 标记

/**
 * 渲染地图格属性面板
 */
export function renderTilePanel() {
  const el = document.getElementById('tileProps');
  if (!el) return;

  const tile = selectedTileData();
  if (!tile) {
    el.innerHTML = '<p class="hint">点击地图格查看属性</p>';
    return;
  }

  const pgroup = state.currentRegion;
  const pls = state.selectedTile;
  const region = state.project.regions[pgroup];

  // 邻居列表
  const neighborList = tile.neighbors.map(nPls => {
    const nTile = state.project.tiles[pgroup]?.[nPls];
    const name = nTile ? nTile.name : `#${nPls}`;
    return `<div class="neighbor-item">
      <span class="neighbor-name">#${nPls} ${escHtml(name)}</span>
      <button class="btn-sm btn-break" data-npls="${nPls}" title="断开连通">断开</button>
    </div>`;
  }).join('');

  // 已断开的邻居
  const breaks = tile._breaks || [];
  const breakList = breaks.map(bPls => {
    const bTile = state.project.tiles[pgroup]?.[bPls];
    const name = bTile ? bTile.name : `#${bPls}`;
    return `<div class="neighbor-item broken">
      <span class="neighbor-name">#${bPls} ${escHtml(name)}</span>
      <button class="btn-sm btn-restore" data-npls="${bPls}" title="恢复连通">恢复</button>
    </div>`;
  }).join('');

  const floorOptions = FLOOR_OPTIONS.map(o =>
    `<option value="${o.value}" ${tile.floor === o.value ? 'selected' : ''}>${o.label}</option>`
  ).join('');

  const tideOptions = TIDE_OPTIONS.map(o =>
    `<option value="${o.value}" ${tile.tide === o.value ? 'selected' : ''}>${o.label}</option>`
  ).join('');

  const grid = currentGrid();
  const maxCols = grid ? grid.cols : 30;
  const maxRows = grid ? grid.rows : 30;

  el.innerHTML = `
    <div class="prop-row">
      <label>pls</label>
      <span class="prop-readonly">#${pls}</span>
    </div>
    <div class="prop-row">
      <label>坐标</label>
      <span class="coord-inputs">
        X <input type="number" id="tpX" value="${tile.x}" min="0" max="${maxCols - 1}" style="width:48px">
        Y <input type="number" id="tpY" value="${tile.y}" min="0" max="${maxRows - 1}" style="width:48px">
      </span>
    </div>
    <div class="prop-row">
      <label>名称</label>
      <input type="text" id="tpName" value="${escHtml(tile.name || '')}" placeholder="可选，留空则显示坐标">
    </div>
    <div class="prop-row">
      <label>描述</label>
      <textarea id="tpDesc" rows="3">${escHtml(tile.desc || '')}</textarea>
    </div>
    <div class="prop-row">
      <label>地板</label>
      <select id="tpFloor">${floorOptions}</select>
    </div>
    <div class="prop-row">
      <label>潮汐</label>
      <select id="tpTide">${tideOptions}</select>
    </div>
    <div class="prop-row">
      <label>可通行</label>
      <input type="checkbox" id="tpPassable" ${tile.passable ? 'checked' : ''}>
    </div>
    <div class="prop-row">
      <label>安全区</label>
      <input type="checkbox" id="tpSafe" ${tile.preset_safe ? 'checked' : ''}>
    </div>
    <div class="prop-row">
      <label>高度</label>
      <input type="number" id="tpHeight" value="${tile.height ?? 0}" min="0" max="100" style="width:60px">
    </div>
    <div class="prop-row">
      <label>可破坏</label>
      <input type="checkbox" id="tpDestructible" ${tile.destructible ? 'checked' : ''}>
    </div>
    <div class="prop-section">
      <h3>连通关系</h3>
      ${neighborList || '<p class="hint">无连通</p>'}
      ${breakList ? `<h4 style="margin-top:8px;">已断开</h4>${breakList}` : ''}
    </div>
    <div class="prop-actions">
      <button class="btn btn-danger" id="tpDelete">删除此格</button>
    </div>
  `;

  // 绑定事件
  const bindInput = (id, key, transform) => {
    const el = document.getElementById(id);
    if (!el) return;
    const evt = el.type === 'checkbox' ? 'change' : 'input';
    el.addEventListener(evt, () => {
      const val = transform ? transform(el) : el.value;
      updateTile(pgroup, pls, { [key]: val });
      // 仅在需要重新渲染画布时才刷新
      if (key === 'passable') renderGrid();
    });
  };

  bindInput('tpName', 'name');
  bindInput('tpDesc', 'desc');
  bindInput('tpFloor', 'floor');
  bindInput('tpTide', 'tide');
  bindInput('tpPassable', 'passable', el => el.checked);
  bindInput('tpSafe', 'preset_safe', el => el.checked);
  bindInput('tpHeight', 'height', el => parseInt(el.value) || 0);
  bindInput('tpDestructible', 'destructible', el => el.checked);

  // 坐标输入：带校验
  const tpX = document.getElementById('tpX');
  const tpY = document.getElementById('tpY');

  const handleCoordChange = (input, axis) => {
    input.addEventListener('change', () => {
      const val = parseInt(input.value);
      if (isNaN(val)) { input.value = axis === 'x' ? tile.x : tile.y; return; }

      const newX = axis === 'x' ? val : tile.x;
      const newY = axis === 'y' ? val : tile.y;

      // 校验范围
      const g = currentGrid();
      if (newX < 0 || newX >= (g?.cols || 30) || newY < 0 || newY >= (g?.rows || 30)) {
        input.value = axis === 'x' ? tile.x : tile.y;
        return;
      }

      // 校验目标坐标是否被占用
      const tiles = state.project.tiles[pgroup] || {};
      const occupied = Object.entries(tiles).some(([p, t]) => {
        return parseInt(p) !== pls && t.x === newX && t.y === newY;
      });
      if (occupied) {
        input.value = axis === 'x' ? tile.x : tile.y;
        return;
      }

      updateTile(pgroup, pls, { x: newX, y: newY });
      renderGrid();
    });
  };

  if (tpX) handleCoordChange(tpX, 'x');
  if (tpY) handleCoordChange(tpY, 'y');

  // 断开连通按钮
  el.querySelectorAll('.btn-break').forEach(btn => {
    btn.addEventListener('click', () => {
      const nPls = parseInt(btn.dataset.npls);
      breakConnection(pgroup, pls, nPls);
      renderTilePanel();
      renderGrid();
    });
  });

  // 恢复连通按钮
  el.querySelectorAll('.btn-restore').forEach(btn => {
    btn.addEventListener('click', () => {
      const nPls = parseInt(btn.dataset.npls);
      restoreConnection(pgroup, pls, nPls);
      renderTilePanel();
      renderGrid();
    });
  });

  // 删除按钮
  document.getElementById('tpDelete')?.addEventListener('click', () => {
    if (confirm(`确定删除地图格 #${pls} "${tile.name}" 吗？`)) {
      deleteTile(pgroup, pls);
      renderGrid();
      renderTilePanel();
      renderRegionPanel();
    }
  });
}

function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
