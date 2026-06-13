// ══════════════════════════════════════════════════
// 左栏：区域列表面板 / Region list panel
// ══════════════════════════════════════════════════

import state, { saveToStorage } from '../state.js';
import { getRegionList, createRegion, deleteRegion, updateRegion } from '../logic/region.js';
import { renderGrid } from './grid.js';
import { renderTilePanel } from './tile-panel.js';

/**
 * 渲染区域列表
 */
export function renderRegionPanel() {
  const listEl = document.getElementById('regionList');
  const propsEl = document.getElementById('regionProps');
  const propsPanel = document.getElementById('regionPropsPanel');
  if (!listEl) return;

  const regions = getRegionList();

  if (regions.length === 0) {
    listEl.innerHTML = '<p class="hint">暂无区域，点击下方按钮创建</p>';
    if (propsPanel) propsPanel.style.display = 'none';
    return;
  }

  let html = '';
  for (const r of regions) {
    const isActive = state.currentRegion === r.pgroup;
    html += `<div class="region-item ${isActive ? 'active' : ''}" data-pgroup="${r.pgroup}">
      <span class="region-name">${escHtml(r.name)}</span>
      <span class="region-meta">#${r.pgroup}</span>
      <button class="region-delete" data-pgroup="${r.pgroup}" title="删除区域">&times;</button>
    </div>`;
  }
  listEl.innerHTML = html;

  // 绑定点击事件
  listEl.querySelectorAll('.region-item').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.classList.contains('region-delete')) return;
      const pgroup = parseInt(el.dataset.pgroup);
      selectRegion(pgroup);
    });
  });

  listEl.querySelectorAll('.region-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const pgroup = parseInt(btn.dataset.pgroup);
      if (confirm(`确定删除区域 "${state.project.regions[pgroup]?.name || pgroup}" 吗？`)) {
        deleteRegion(pgroup);
        renderRegionPanel();
        renderGrid();
        renderTilePanel();
      }
    });
  });

  // 渲染区域属性
  if (state.currentRegion !== null && state.project.regions[state.currentRegion]) {
    if (propsPanel) propsPanel.style.display = '';
    renderRegionProps();
  } else {
    if (propsPanel) propsPanel.style.display = 'none';
  }
}

/**
 * 选中区域
 */
function selectRegion(pgroup) {
  state.currentRegion = pgroup;
  state.selectedTile = null;
  state.breakFirst = null;

  // 同步网格尺寸到输入框
  const grid = state.project.grids[pgroup];
  if (grid) {
    const colsInput = document.getElementById('gridCols');
    const rowsInput = document.getElementById('gridRows');
    if (colsInput) colsInput.value = grid.cols;
    if (rowsInput) rowsInput.value = grid.rows;
  }

  renderRegionPanel();
  renderGrid();
  renderTilePanel();
}

/**
 * 渲染区域属性编辑
 */
function renderRegionProps() {
  const propsEl = document.getElementById('regionProps');
  if (!propsEl || state.currentRegion === null) return;

  const r = state.project.regions[state.currentRegion];
  const grid = state.project.grids[state.currentRegion];
  const tiles = state.project.tiles[state.currentRegion] || {};

  // 构建地图格下拉选项
  const tileOptions = Object.keys(tiles).map(Number).sort((a, b) => a - b)
    .map(pls => `<option value="${pls}" ${r.entrance_pls === pls ? 'selected' : ''}>#${pls} ${escHtml(tiles[pls].name || '未命名')}</option>`)
    .join('');

  const exitTileOptions = Object.keys(tiles).map(Number).sort((a, b) => a - b)
    .map(pls => `<option value="${pls}" ${r.exit_pls === pls ? 'selected' : ''}>#${pls} ${escHtml(tiles[pls].name || '未命名')}</option>`)
    .join('');

  // 区域连接下拉
  const regionOptions = Object.keys(state.project.regions).map(Number).sort((a, b) => a - b)
    .map(pg => `<option value="${pg}" ${r.next_region === pg ? 'selected' : ''}>#${pg} ${escHtml(state.project.regions[pg].name)}</option>`)
    .join('');

  const prevRegionOptions = Object.keys(state.project.regions).map(Number).sort((a, b) => a - b)
    .map(pg => `<option value="${pg}" ${r.prev_region === pg ? 'selected' : ''}>#${pg} ${escHtml(state.project.regions[pg].name)}</option>`)
    .join('');

  propsEl.innerHTML = `
    <div class="prop-row">
      <label>名称</label>
      <input type="text" id="rpName" value="${escHtml(r.name)}">
    </div>
    <div class="prop-row">
      <label>描述</label>
      <textarea id="rpDesc" rows="2">${escHtml(r.desc || '')}</textarea>
    </div>
    <div class="prop-row">
      <label>入口格</label>
      <select id="rpEntrance">
        <option value="">-- 无 --</option>
        ${tileOptions}
      </select>
    </div>
    <div class="prop-row">
      <label>出口格</label>
      <select id="rpExit">
        <option value="">-- 无 --</option>
        ${exitTileOptions}
      </select>
    </div>
    <div class="prop-row">
      <label>下一区域</label>
      <select id="rpNext">
        <option value="">-- 无 --</option>
        ${regionOptions}
      </select>
    </div>
    <div class="prop-row">
      <label>上一区域</label>
      <select id="rpPrev">
        <option value="">-- 无 --</option>
        ${prevRegionOptions}
      </select>
    </div>
  `;

  // 绑定变更事件
  const bindChange = (id, key, isNum) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', () => {
      const val = el.value === '' ? null : (isNum ? parseInt(el.value) : el.value);
      updateRegion(state.currentRegion, { [key]: val });
      renderGrid();
    });
  };

  bindChange('rpName', 'name', false);
  bindChange('rpDesc', 'desc', false);
  bindChange('rpEntrance', 'entrance_pls', true);
  bindChange('rpExit', 'exit_pls', true);
  bindChange('rpNext', 'next_region', true);
  bindChange('rpPrev', 'prev_region', true);
}

/**
 * 初始化区域面板事件
 */
export function initRegionPanel() {
  // 新建区域按钮
  document.getElementById('btnAddRegion')?.addEventListener('click', () => {
    const name = prompt('区域名称：', '新区域');
    if (name === null) return;
    const cols = parseInt(document.getElementById('gridCols')?.value) || 8;
    const rows = parseInt(document.getElementById('gridRows')?.value) || 6;
    const pgroup = createRegion(name, cols, rows);
    state.currentRegion = pgroup;
    renderRegionPanel();
    renderGrid();
    renderTilePanel();
  });

  // 网格尺寸变更
  document.getElementById('gridCols')?.addEventListener('change', (e) => {
    if (state.currentRegion === null) return;
    updateRegion(state.currentRegion, { cols: parseInt(e.target.value) || 8 });
    renderGrid();
  });

  document.getElementById('gridRows')?.addEventListener('change', (e) => {
    if (state.currentRegion === null) return;
    updateRegion(state.currentRegion, { rows: parseInt(e.target.value) || 6 });
    renderGrid();
  });
}

function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
