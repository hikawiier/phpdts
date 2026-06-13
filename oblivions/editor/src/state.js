// ══════════════════════════════════════════════════
// 全局状态管理 / Global state management
// ══════════════════════════════════════════════════

const STORAGE_KEY = 'oblivions_editor_project';

// 编辑器全局状态
const state = {
  // 项目数据
  project: {
    regions: {},
    grids: {},
    tiles: {},
  },

  // UI 状态
  currentRegion: null,   // 当前选中的区域 pgroup
  selectedTile: null,    // 当前选中的地图格 pls
  currentTool: 'select', // 当前工具

  // 连通断开操作的第二步标记
  breakFirst: null,      // 断开/恢复连通时第一次点击的 pls
};

// 下一个可用的 pgroup
export function nextPgroup() {
  const keys = Object.keys(state.project.regions).map(Number);
  return keys.length === 0 ? 1 : Math.max(...keys) + 1;
}

// 下一个可用的 pls（区域内）
export function nextPls(pgroup) {
  const tiles = state.project.tiles[pgroup] || {};
  const keys = Object.keys(tiles).map(Number);
  return keys.length === 0 ? 1 : Math.max(...keys) + 1;
}

// 获取当前区域的 tiles
export function currentTiles() {
  if (state.currentRegion === null) return {};
  return state.project.tiles[state.currentRegion] || {};
}

// 获取当前区域的 grid 配置
export function currentGrid() {
  if (state.currentRegion === null) return { cols: 8, rows: 6 };
  return state.project.grids[state.currentRegion] || { cols: 8, rows: 6 };
}

// 获取当前区域信息
export function currentRegion() {
  if (state.currentRegion === null) return null;
  return state.project.regions[state.currentRegion] || null;
}

// 获取选中的地图格数据
export function selectedTileData() {
  if (state.selectedTile === null || state.currentRegion === null) return null;
  const tiles = state.project.tiles[state.currentRegion] || {};
  return tiles[state.selectedTile] || null;
}

// 持久化到 localStorage
export function saveToStorage() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.project));
  } catch (e) {
    console.warn('[State] localStorage save failed:', e);
  }
}

// 从 localStorage 恢复
export function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (data.regions && data.grids && data.tiles) {
        state.project = data;
        return true;
      }
    }
  } catch (e) {
    console.warn('[State] localStorage load failed:', e);
  }
  return false;
}

// 加载导入数据
export function loadProject(data) {
  state.project = {
    regions: data.regions || {},
    grids: data.grids || {},
    tiles: data.tiles || {},
  };
  state.currentRegion = null;
  state.selectedTile = null;
  saveToStorage();
}

export default state;
