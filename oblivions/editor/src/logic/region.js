// ══════════════════════════════════════════════════
// 区域 CRUD 逻辑 / Region CRUD logic
// ══════════════════════════════════════════════════
// @module O

import state, { nextPgroup, saveToStorage } from '../state.js';

/**
 * 新建区域
 */
export function createRegion(name, cols, rows) {
  const pgroup = nextPgroup();
  // pgroup 范围校验（DESIGN.md 1.1：pgroup 1-255）
  if (pgroup === null) {
    alert('已达区域数量上限（255），无法继续创建。');
    return null;
  }
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
    // 清理 exit_links 中指向该区域的链接（新对象格式 { from_pls, to_pgroup, to_pls }）
    if (Array.isArray(r.exit_links)) {
      r.exit_links = r.exit_links.filter(l => {
        // 兼容旧格式（裸 pgroup 数字）与新格式（对象）
        if (typeof l === 'number') return l !== pgroup;
        return l && l.to_pgroup !== pgroup;
      });
    }
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

// ─────────────────────────────────────────────────
// exit_links CRUD（额外出口映射，UPGRADE_DESIGN.md §2.1.3）
// 格式：{ from_pls: number|null, to_pgroup: number, to_pls: number|null }
// ─────────────────────────────────────────────────

/**
 * 添加一条 exit_links 条目
 */
export function addExitLink(pgroup, link) {
  const region = state.project.regions[pgroup];
  if (!region) return;
  if (!Array.isArray(region.exit_links)) region.exit_links = [];
  region.exit_links.push({
    from_pls: link?.from_pls ?? null,
    to_pgroup: link?.to_pgroup ?? null,
    to_pls: link?.to_pls ?? null,
  });
  saveToStorage();
}

/**
 * 更新指定索引的 exit_links 条目
 */
export function updateExitLink(pgroup, index, patch) {
  const region = state.project.regions[pgroup];
  if (!region || !Array.isArray(region.exit_links)) return;
  const link = region.exit_links[index];
  if (!link) return;
  Object.assign(link, patch);
  saveToStorage();
}

/**
 * 删除指定索引的 exit_links 条目
 */
export function removeExitLink(pgroup, index) {
  const region = state.project.regions[pgroup];
  if (!region || !Array.isArray(region.exit_links)) return;
  region.exit_links.splice(index, 1);
  saveToStorage();
}
