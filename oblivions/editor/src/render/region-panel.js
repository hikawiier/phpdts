// ══════════════════════════════════════════════════
// 左栏：区域列表面板 / Region list panel
// ══════════════════════════════════════════════════
// @module O
// @framework O-5 任务2 单区域模式入口：#btnAddRegion 弹出二选一 modal（空白区域 / 随机生成器）
//
// 任务2 单区域模式扩展：
//   - "+ 新建区域"按钮改为弹出二选一 modal：① 创建空白区域 ② 使用随机生成器创建
//   - 选项 ② 触发 generator-tools.js 的 openModalForRegion()（mode='region'）
//   - 单区域生成 modal 关闭后焦点回到 #btnAddRegion（returnFocusEl 参数传递）
//   - 复用现有 .modal-overlay / .modal 样式，无新增 CSS

import state, { saveToStorage } from '../state.js';
import { getRegionList, createRegion, deleteRegion, updateRegion, addExitLink, updateExitLink, removeExitLink } from '../logic/region.js';
import { renderGrid } from './grid.js';
import { renderTilePanel } from './tile-panel.js';
import { rerenderBackendPanel } from './backend-panel.js';
import generatorTools from '../tools/generator-tools.js';

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
  // 切换区域时同步刷新后端面板的 Live 数据统计（O-6 overlay 守卫依赖 state.currentRegion）
  rerenderBackendPanel();
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

  // 区域连接下拉（排除自身）
  const otherRegions = Object.keys(state.project.regions).map(Number).filter(pg => pg !== state.currentRegion).sort((a, b) => a - b);
  const regionOptions = otherRegions
    .map(pg => `<option value="${pg}" ${r.next_region === pg ? 'selected' : ''}>#${pg} ${escHtml(state.project.regions[pg].name)}</option>`)
    .join('');

  const prevRegionOptions = otherRegions
    .map(pg => `<option value="${pg}" ${r.prev_region === pg ? 'selected' : ''}>#${pg} ${escHtml(state.project.regions[pg].name)}</option>`)
    .join('');

  // exit_links 编辑器：每条 entry 渲染为 3 个下拉 + 删除按钮
  const exitLinks = Array.isArray(r.exit_links) ? r.exit_links : [];
  const exitLinksHtml = exitLinks.map((link, i) => {
    // from_pls 下拉：当前区域的所有格
    const fromPlsOpts = Object.keys(tiles).map(Number).sort((a, b) => a - b)
      .map(pls => `<option value="${pls}" ${link.from_pls === pls ? 'selected' : ''}>#${pls} ${escHtml(tiles[pls].name || '未命名')}</option>`)
      .join('');
    // to_pgroup 下拉：除当前区域外的所有区域
    const toPgroupOpts = otherRegions
      .map(pg => `<option value="${pg}" ${link.to_pgroup === pg ? 'selected' : ''}>#${pg} ${escHtml(state.project.regions[pg].name)}</option>`)
      .join('');
    // to_pls 下拉：目标区域的格
    const targetTiles = (link.to_pgroup && state.project.tiles[link.to_pgroup]) ? state.project.tiles[link.to_pgroup] : {};
    const toPlsOpts = Object.keys(targetTiles).map(Number).sort((a, b) => a - b)
      .map(pls => `<option value="${pls}" ${link.to_pls === pls ? 'selected' : ''}>#${pls} ${escHtml(targetTiles[pls].name || '未命名')}</option>`)
      .join('');
    return `<div class="exit-link-row">
      <select class="rp-el-from" data-idx="${i}">
        <option value="">本区·任意</option>
        ${fromPlsOpts}
      </select>
      <span class="exit-link-arrow">→</span>
      <select class="rp-el-toregion" data-idx="${i}">
        <option value="">目标区</option>
        ${toPgroupOpts}
      </select>
      <select class="rp-el-topls" data-idx="${i}">
        <option value="">目标·任意</option>
        ${toPlsOpts}
      </select>
      <button class="btn-sm rp-el-del" data-idx="${i}" title="删除此出口链接">×</button>
    </div>`;
  }).join('');

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
    <div class="prop-section">
      <h3>额外出口链接 (exit_links)</h3>
      <p class="hint" style="text-align:left; padding: 2px 0;">多对多出口映射，与 next/prev_region 独立</p>
      <div id="rpExitLinksList">${exitLinksHtml || '<p class="hint">暂无额外出口链接</p>'}</div>
      <button class="btn btn-sm rp-el-add" style="margin-top:4px;">+ 添加出口链接</button>
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

  // exit_links 编辑器事件
  bindExitLinkEvents();
}

/**
 * 绑定 exit_links 编辑器事件
 */
function bindExitLinkEvents() {
  const pgroup = state.currentRegion;

  // from_pls 变更
  document.querySelectorAll('.rp-el-from').forEach(sel => {
    sel.addEventListener('change', () => {
      const idx = parseInt(sel.dataset.idx);
      const val = sel.value === '' ? null : parseInt(sel.value);
      updateExitLink(pgroup, idx, { from_pls: val });
    });
  });

  // to_pgroup 变更（重置 to_pls）
  document.querySelectorAll('.rp-el-toregion').forEach(sel => {
    sel.addEventListener('change', () => {
      const idx = parseInt(sel.dataset.idx);
      const val = sel.value === '' ? null : parseInt(sel.value);
      updateExitLink(pgroup, idx, { to_pgroup: val, to_pls: null });
      // 目标区域变了，需要重新渲染 to_pls 选项
      renderRegionProps();
    });
  });

  // to_pls 变更
  document.querySelectorAll('.rp-el-topls').forEach(sel => {
    sel.addEventListener('change', () => {
      const idx = parseInt(sel.dataset.idx);
      const val = sel.value === '' ? null : parseInt(sel.value);
      updateExitLink(pgroup, idx, { to_pls: val });
    });
  });

  // 删除按钮
  document.querySelectorAll('.rp-el-del').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx);
      removeExitLink(pgroup, idx);
      renderRegionProps();
    });
  });

  // 添加按钮
  document.querySelector('.rp-el-add')?.addEventListener('click', () => {
    // 默认指向第一个其他区域
    const otherRegions = Object.keys(state.project.regions).map(Number).filter(pg => pg !== pgroup).sort((a, b) => a - b);
    const defaultTarget = otherRegions[0] ?? null;
    addExitLink(pgroup, { from_pls: null, to_pgroup: defaultTarget, to_pls: null });
    renderRegionProps();
  });
}

/**
 * 初始化区域面板事件
 */
export function initRegionPanel() {
  // 新建区域按钮 → 弹出二选一 modal（任务2：原 prompt 改为选择 modal）
  document.getElementById('btnAddRegion')?.addEventListener('click', () => {
    openAddRegionChoiceModal();
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

  // 注入"新建区域方式"二选一 modal（任务2 新增）
  injectAddRegionChoiceModal();
}

/**
 * 注入"新建区域方式"二选一 modal（任务2 新增）
 * 复用现有 .modal-overlay / .modal 样式，无新增 CSS
 */
function injectAddRegionChoiceModal() {
  if (document.getElementById('addRegionChoiceModal')) return;
  const modal = document.createElement('div');
  modal.id = 'addRegionChoiceModal';
  modal.className = 'modal-overlay';
  modal.style.display = 'none';
  modal.innerHTML = `
    <div class="modal" style="width:420px;">
      <div class="modal-header">
        <h3>新建区域</h3>
        <button class="modal-close" id="addRegionChoiceClose">&times;</button>
      </div>
      <div class="modal-body">
        <p class="hint" style="margin-bottom:12px;">请选择新建区域的方式：</p>
        <div class="add-region-choice-list">
          <button class="btn add-region-choice-btn" id="addRegionChoiceBlank">
            <span class="add-region-choice-title">创建空白区域</span>
            <span class="add-region-choice-desc">手动绘制地图格，从空白网格开始</span>
          </button>
          <button class="btn add-region-choice-btn" id="addRegionChoiceGenerator">
            <span class="add-region-choice-title">使用随机生成器创建</span>
            <span class="add-region-choice-desc">选择主题生成器（群岛 / 迷宫 / 湿地 / 废墟），自动生成地图格</span>
          </button>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn" id="addRegionChoiceCancel">取消</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  // 绑定事件
  const closeBtn = modal.querySelector('#addRegionChoiceClose');
  const cancelBtn = modal.querySelector('#addRegionChoiceCancel');
  const blankBtn = modal.querySelector('#addRegionChoiceBlank');
  const generatorBtn = modal.querySelector('#addRegionChoiceGenerator');
  const btnAddRegion = document.getElementById('btnAddRegion');

  const closeChoiceModal = () => { modal.style.display = 'none'; };

  closeBtn?.addEventListener('click', closeChoiceModal);
  cancelBtn?.addEventListener('click', closeChoiceModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeChoiceModal();
  });

  // 选项1：创建空白区域（原 prompt 流程）
  blankBtn?.addEventListener('click', () => {
    closeChoiceModal();
    createBlankRegionFlow();
  });

  // 选项2：使用随机生成器创建 → 调用 generator-tools 单区域模式
  generatorBtn?.addEventListener('click', () => {
    closeChoiceModal();
    // 传递 #btnAddRegion 作为焦点恢复目标
    generatorTools.openModalForRegion(btnAddRegion);
  });
}

/**
 * 打开"新建区域方式"二选一 modal
 */
function openAddRegionChoiceModal() {
  const modal = document.getElementById('addRegionChoiceModal');
  if (modal) modal.style.display = 'flex';
}

/**
 * 创建空白区域流程（原 #btnAddRegion prompt 逻辑，提取为函数）
 */
function createBlankRegionFlow() {
  const name = prompt('区域名称：', '新区域');
  if (name === null) return;
  const cols = parseInt(document.getElementById('gridCols')?.value) || 8;
  const rows = parseInt(document.getElementById('gridRows')?.value) || 6;
  const pgroup = createRegion(name, cols, rows);
  // createRegion 返回 null 表示已达 pgroup 上限（DESIGN.md 1.1：1-255）
  if (pgroup === null) return;
  state.currentRegion = pgroup;
  renderRegionPanel();
  renderGrid();
  renderTilePanel();
}

function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
