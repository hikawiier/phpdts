// ══════════════════════════════════════════════════
// 区域 CRUD 逻辑 / Region CRUD logic
// ══════════════════════════════════════════════════

import state, { nextPgroup, saveToStorage } from '../state.js';

/**
 * 新建区域
 */
export function createRegion(name, cols, rows) {
  const pgroup = nextPgroup();
  state.project.regions[pgroup] = {
    name: name || '新区域',
    desc: '',
    entrance_pls: null,
    exit_pls: null,
    next_region: null,
    prev_region: null,
    exit_links: [],
  };
  state.project.grids[pgroup] = { cols: cols || 8, rows: rows || 6 };
  state.project.tiles[pgroup] = {};
  saveToStorage();
  return pgroup;
}

/**
 * 删除区域
 */
export function deleteRegion(pgroup) {
  // 清理其他区域对该区域的引用
  for (const pg in state.project.regions) {
    const r = state.project.regions[pg];
    if (r.next_region === pgroup) r.next_region = null;
    if (r.prev_region === pgroup) r.prev_region = null;
    r.exit_links = (r.exit_links || []).filter(l => l !== pgroup);
  }

  delete state.project.regions[pgroup];
  delete state.project.grids[pgroup];
  delete state.project.tiles[pgroup];

  if (state.currentRegion === pgroup) {
    state.currentRegion = null;
    state.selectedTile = null;
  }

  saveToStorage();
}

/**
 * 更新区域属性
 */
export function updateRegion(pgroup, props) {
  const region = state.project.regions[pgroup];
  if (!region) return;

  Object.assign(region, props);

  // 双向同步 next_region / prev_region
  if (props.next_region !== undefined) {
    const target = state.project.regions[props.next_region];
    if (target) {
      target.prev_region = pgroup;
    }
  }

  // 更新网格尺寸
  if (props.cols || props.rows) {
    const grid = state.project.grids[pgroup];
    if (props.cols) grid.cols = props.cols;
    if (props.rows) grid.rows = props.rows;
  }

  saveToStorage();
}

/**
 * 获取所有区域列表（排序后）
 */
export function getRegionList() {
  return Object.keys(state.project.regions)
    .map(Number)
    .sort((a, b) => a - b)
    .map(pg => ({ pgroup: pg, ...state.project.regions[pg] }));
}
