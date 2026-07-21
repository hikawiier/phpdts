// ══════════════════════════════════════════════════
// 全局状态管理 / Global state management
// ══════════════════════════════════════════════════
// @module O
// @framework O-1
// @framework O-4 编辑器守卫与后端对接
// @framework O-5 任务2 单区域模式 addRegion API：追加而非覆盖，自动分配 pgroup
// @framework O-6 开局分布预览 overlay：overlayFlags.wilditem / poi 数据模型与开关

const STORAGE_KEY = 'oblivions_editor_project';
// 后端 baseUrl 持久化键（仅 baseUrl，不含 authToken——token 出于安全仅 session 内存）
const BACKEND_STORAGE_KEY = 'oblivions_editor_backend';

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

  // 画笔预设（绘制/油漆桶工具使用）
  brushPreset: {
    floor: 'standard',
    tide: 'shallow',
    passable: true,
  },

  // 目录句柄（用于快速导出）
  dirHandle: null,       // File System Access API 的 DirectoryHandle

  // ─── 阶段2 新增：模拟状态（Simulate 模式，UPGRADE_DESIGN.md §1.4 / §2.4-2.7）───
  // 对齐 2.8 dry-run 契约：Simulate 模式纯前端 BFS，不写 DB
  simState: {
    mode: 'simulate',                  // 'simulate' | 'live'（阶段5 启用 live）
    playerPos: { pgroup: null, pls: null },  // 模拟玩家位置（独立于 selectedTile）
    visionRange: 1,                    // 对齐 obl_config.vision_range
    enemySenseRange: 3,                // 对齐 obl_config.memory_range
    movePower: 3,                      // 对齐 obl_get_move_power
    discoverLimit: 3,                  // 对齐 obl_config.discover_base
    // fogOverride[pgroup][pls] = 0|1（Simulate 模式本地 fog 覆盖，不写 DB）
    fogOverride: {},
    // 视野 BFS 计算结果缓存：{ [pgroup]: { [pls]: distance } }
    visibleTiles: {},
    // 探索模拟发现的道具：{ [pgroup]: [{ pls, iid, discovered }] }
    discoveredItems: {},
  },

  // ─── 阶段5 占位：Live 模式拉取的 DB 实例（UPGRADE_DESIGN.md §1.4）────────────
  liveState: {
    fog: {},            // { [pgroup]: { [pls]: 1 } }
    wildItems: {},      // { [pgroup]: { [pls]: [...] } }
    poiInstances: {},   // { [pgroup]: { [pls]: [...] } }
  },

  // ─── 阶段3 占位：配置文件缓存（UPGRADE_DESIGN.md §1.4）────────────────────────
  configCache: {
    scatterPool: null,  // gamedata/scatter_pool.php
    poiTable: null,     // gamedata/poi_table.php
    poiPool: null,      // gamedata/poi_pool.php
    oblConfig: null,    // gamedata/obl_config.php
  },

  // ─── 叠层显示开关（UPGRADE_DESIGN.md §1.4 / §10 任务3 O-6）──────────────────
  // 灰阶基底 + 唯一强调色（对齐 2.15 / 3.4）：默认仅 fog/vision 关键叠层关闭，按需开启
  // wilditem / poi 开关（任务3 O-6）：仅在 state.backend.connected === true 时可用，
  // 数据源为 liveState.wildItems / liveState.poiInstances（观察者视角，不依赖玩家位置）
  overlayFlags: {
    fog: false,
    vision: false,
    reachability: false,
    tideHeatmap: false,
    wilditem: false,
    poi: false,
  },

  // ─── 阶段5 占位：后端连接配置（UPGRADE_DESIGN.md §1.4 / §2.10）──────────────
  backend: {
    baseUrl: '',
    authToken: '',
    connected: false,
  },
};

// pls / pgroup 范围约束（DESIGN.md 1.1：pls 1-254，pgroup 1-255）
const PLS_MAX = 254;
const PGROUP_MAX = 255;

// 下一个可用的 pgroup
export function nextPgroup() {
  const keys = Object.keys(state.project.regions).map(Number);
  const next = keys.length === 0 ? 1 : Math.max(...keys) + 1;
  // pgroup 范围 1-255（DESIGN.md 1.1）
  return next > PGROUP_MAX ? null : next;
}

// 下一个可用的 pls（区域内）
export function nextPls(pgroup) {
  const tiles = state.project.tiles[pgroup] || {};
  const keys = Object.keys(tiles).map(Number);
  const next = keys.length === 0 ? 1 : Math.max(...keys) + 1;
  // pls 范围 1-254（DESIGN.md 1.1）
  return next > PLS_MAX ? null : next;
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

// 数据迁移：将旧格式归一化为新格式
// 1. exit_links: [pgroup1, pgroup2] → [{ from_pls: null, to_pgroup, to_pls: null }]（UPGRADE_DESIGN.md §2.1.3）
// 2. tide='safe' → tide='shallow' + preset_safe=true（DESIGN.md 1.3：safe 非 tide 取值）
// 3. height/destructible: undefined → 0/false
function migrateProject() {
  for (const pgroup in state.project.regions) {
    const region = state.project.regions[pgroup];
    if (Array.isArray(region.exit_links)) {
      region.exit_links = region.exit_links.map(l => {
        if (typeof l === 'number') {
          return { from_pls: null, to_pgroup: l, to_pls: null };
        }
        return l;
      });
    } else {
      region.exit_links = [];
    }

    const tiles = state.project.tiles[pgroup];
    if (tiles) {
      for (const pls in tiles) {
        const t = tiles[pls];
        if (t.height === undefined) t.height = 0;
        if (t.destructible === undefined) t.destructible = false;
        if (t.tide === 'safe') {
          // 旧数据迁移：tide='safe' 不再是合法取值（DESIGN.md 1.3）
          t.tide = 'shallow';
          t.preset_safe = true;
        }
      }
    }
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
        migrateProject();
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
  migrateProject();
  state.currentRegion = null;
  state.selectedTile = null;
  saveToStorage();
}

/**
 * 追加单个新区域到现有项目（任务2 新增，单区域模式入口）
 *
 * 与 loadProject()（覆盖整个项目）的差异：
 *   - 不清空现有 regions/grids/tiles，仅追加新区域
 *   - pgroup 由本函数自动分配（nextPgroup），调用方无需手动指定
 *   - regionData 与 tilesData 中的 pgroup 字段会被重写为本函数分配的新 pgroup
 *   - 持久化到 localStorage
 *
 * 设计契约：
 *   - 不自动建立 exit_links 到现有区域（由用户后续手动添加，避免越权）
 *   - regionData.next_region / prev_region / exit_links 保留传入值（生成器应已清空，
 *     但若调用方传入带链接的 region，本函数不强制清空——保持灵活性）
 *
 * @param {Object} regionData  区域元数据（含 name / cols / rows / entrance_pls / exit_pls 等）
 * @param {Object} tilesData   tiles 字典 { [pls]: tile }
 * @returns {number|null}  新分配的 pgroup；null=已达 pgroup 上限（255）
 */
export function addRegion(regionData, tilesData) {
  const newPgroup = nextPgroup();
  if (newPgroup === null) {
    alert('已达区域数量上限（255），无法继续添加。');
    return null;
  }

  // 重写 pgroup 字段（防止调用方误传冲突值）
  const remappedRegion = { ...regionData, pgroup: newPgroup };
  const remappedTiles = {};
  for (const pls in tilesData) {
    remappedTiles[pls] = { ...tilesData[pls], pgroup: newPgroup };
  }

  state.project.regions[newPgroup] = remappedRegion;
  // grids 从 regionData.cols/rows 推导（与 createRegion 一致）
  state.project.grids[newPgroup] = {
    cols: regionData.cols || 8,
    rows: regionData.rows || 6,
  };
  state.project.tiles[newPgroup] = remappedTiles;

  saveToStorage();
  return newPgroup;
}

// ══════════════════════════════════════════════════
// Simulate 模式辅助函数（阶段2 新增，UPGRADE_DESIGN.md §2.4-2.7）
// ══════════════════════════════════════════════════

/**
 * 重置模拟状态（切换区域 / 切换模式 / 清空玩家位置时调用）
 * 不重置 mode/visionRange/movePower 等配置项，只清运行时缓存
 */
export function resetSimState() {
  state.simState.playerPos = { pgroup: null, pls: null };
  state.simState.fogOverride = {};
  state.simState.visibleTiles = {};
  state.simState.discoveredItems = {};
}

/**
 * 设置模拟玩家位置（Simulate 模式核心入口）
 * @param {number} pgroup
 * @param {number} pls
 */
export function setSimPlayerPos(pgroup, pls) {
  state.simState.playerPos = { pgroup, pls };
}

/**
 * 设置 Simulate / Live 模式
 * @param {'simulate'|'live'} mode
 */
export function setSimMode(mode) {
  state.simState.mode = mode;
}

/**
 * 设置叠层开关
 * @param {keyof typeof state.overlayFlags} key
 * @param {boolean} value
 */
export function setOverlayFlag(key, value) {
  if (key in state.overlayFlags) {
    state.overlayFlags[key] = value;
  }
}

/**
 * 设置模拟参数（visionRange / movePower / discoverLimit 等）
 * @param {Object} patch
 */
export function setSimParams(patch) {
  Object.assign(state.simState, patch);
}

/**
 * 更新视野 BFS 缓存
 * @param {number} pgroup
 * @param {Object} visibleTiles { [pls]: distance }
 */
export function setVisibleTiles(pgroup, visibleTiles) {
  state.simState.visibleTiles = { [pgroup]: visibleTiles };
}

/**
 * 更新 fogOverride（Simulate 模式本地 fog，不写 DB）
 * @param {number} pgroup
 * @param {Object} fogMap { [pls]: 0|1 }
 */
export function setFogOverride(pgroup, fogMap) {
  state.simState.fogOverride = { [pgroup]: fogMap };
}

/**
 * 更新探索模拟发现的道具
 * @param {number} pgroup
 * @param {Array} items [{ pls, iid, discovered }]
 */
export function setDiscoveredItems(pgroup, items) {
  state.simState.discoveredItems = { [pgroup]: items };
}

/**
 * 获取当前模式下某 (pgroup, pls) 的 fog 状态
 * Simulate 模式读 simState.fogOverride；Live 模式读 liveState.fog
 * @param {number} pgroup
 * @param {number} pls
 * @returns {number|null} 0|1|null（null=无数据）
 */
export function getFogAt(pgroup, pls) {
  if (state.simState.mode === 'live') {
    return state.liveState.fog[pgroup]?.[pls] ?? null;
  }
  return state.simState.fogOverride[pgroup]?.[pls] ?? null;
}

// ══════════════════════════════════════════════════
// 阶段5 新增：后端连接管理（UPGRADE_DESIGN.md §2.10）
// ══════════════════════════════════════════════════

/**
 * 配置后端连接（baseUrl + authToken）
 * baseUrl 持久化到 localStorage（便于下次自动恢复），authToken 仅内存保留
 * @param {string} baseUrl  后端 API 根 URL（如 http://localhost/phpdts/oblivions/api）
 * @param {string} authToken  Bearer token（与 editor_token.php 返回值一致）
 */
export function setBackendConfig(baseUrl, authToken) {
  state.backend.baseUrl = baseUrl.replace(/\/+$/, '');  // 去掉末尾斜杠
  state.backend.authToken = authToken;
  state.backend.connected = false;  // 由 setBackendConnected 显式置 true
  try {
    localStorage.setItem(BACKEND_STORAGE_KEY, JSON.stringify({ baseUrl: state.backend.baseUrl }));
  } catch (e) {
    console.warn('[State] backend baseUrl save failed:', e);
  }
}

/**
 * 设置后端连接状态
 * @param {boolean} connected
 */
export function setBackendConnected(connected) {
  state.backend.connected = !!connected;
}

/**
 * 清空后端连接配置（断开时调用）
 * 同时清空 liveState 与切回 Simulate 模式，避免 UI 残留陈旧数据
 */
export function clearBackendConfig() {
  state.backend.baseUrl = '';
  state.backend.authToken = '';
  state.backend.connected = false;
  try {
    localStorage.removeItem(BACKEND_STORAGE_KEY);
  } catch (e) { /* 忽略 */ }
  clearLiveState();
  // 切回 Simulate 模式（避免 Live 模式无后端时 UI 误读空 liveState）
  state.simState.mode = 'simulate';
}

/**
 * 从 localStorage 恢复后端 baseUrl（不含 authToken）
 * 在 main.js 启动时调用，使"连接后端"对话框能预填上次的 baseUrl
 * @returns {{ baseUrl: string } | null}
 */
export function loadBackendFromStorage() {
  try {
    const raw = localStorage.getItem(BACKEND_STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data && typeof data.baseUrl === 'string') {
      state.backend.baseUrl = data.baseUrl;
      return { baseUrl: data.baseUrl };
    }
  } catch (e) {
    console.warn('[State] backend baseUrl load failed:', e);
  }
  return null;
}

// ══════════════════════════════════════════════════
// 阶段5 新增：Live 模式状态更新函数（UPGRADE_DESIGN.md §2.10.6）
// ══════════════════════════════════════════════════

/**
 * 更新 Live 模式 fog 状态（来自 editor.fog.list 端点）
 * @param {number} pgroup
 * @param {Object} fogMap  { [pls]: 0|1 }（仅含 fog=1 的格，稀疏表示）
 */
export function setLiveFog(pgroup, fogMap) {
  if (!state.liveState.fog[pgroup]) state.liveState.fog[pgroup] = {};
  state.liveState.fog[pgroup] = fogMap;
}

/**
 * 设置单个格的 fog 状态（Live 模式，editor.fog.set 成功后本地同步）
 * @param {number} pgroup
 * @param {number} pls
 * @param {number} fog  0|1
 */
export function setLiveFogCell(pgroup, pls, fog) {
  if (!state.liveState.fog[pgroup]) state.liveState.fog[pgroup] = {};
  if (fog === 1) {
    state.liveState.fog[pgroup][pls] = 1;
  } else {
    delete state.liveState.fog[pgroup][pls];
  }
}

/**
 * 更新 Live 模式 wild item 实例（来自 editor.wilditem.list 端点）
 * @param {number} pgroup
 * @param {Array} items  bra_oblmapitem 行数组
 */
export function setLiveWildItems(pgroup, items) {
  // 按 pls 分组（便于渲染层快速查询）
  const byPls = {};
  for (const item of items) {
    const pls = Number(item.pls);
    if (!byPls[pls]) byPls[pls] = [];
    byPls[pls].push(item);
  }
  if (!state.liveState.wildItems[pgroup]) state.liveState.wildItems[pgroup] = {};
  state.liveState.wildItems[pgroup] = byPls;
}

/**
 * 更新 Live 模式 POI 实例（来自 editor.poi.list 端点）
 * @param {number} pgroup
 * @param {Array} pois  bra_oblmappoi 行数组
 */
export function setLivePoiInstances(pgroup, pois) {
  // 按 pls 分组
  const byPls = {};
  for (const poi of pois) {
    const pls = Number(poi.pls);
    if (!byPls[pls]) byPls[pls] = [];
    byPls[pls].push(poi);
  }
  if (!state.liveState.poiInstances[pgroup]) state.liveState.poiInstances[pgroup] = {};
  state.liveState.poiInstances[pgroup] = byPls;
}

/**
 * 清空所有 Live 模式状态（断开后端 / 切换区域时调用）
 */
export function clearLiveState() {
  state.liveState.fog = {};
  state.liveState.wildItems = {};
  state.liveState.poiInstances = {};
}

// ══════════════════════════════════════════════════
// 任务3 O-6 新增：开局分布预览 overlay 辅助函数
// ══════════════════════════════════════════════════

/**
 * 获取指定 (pgroup, pls) 的 wildItems 实例数组
 * 数据源：state.liveState.wildItems[pgroup][pls]
 * 用于 overlay-wilditem.js 渲染
 *
 * @param {number} pgroup
 * @param {number} pls
 * @returns {Array} bra_oblmapitem 行数组（可能为空）
 */
export function getLiveWildItemsAt(pgroup, pls) {
  const byPls = state.liveState.wildItems?.[pgroup];
  if (!byPls) return [];
  const arr = byPls[pls];
  return Array.isArray(arr) ? arr : [];
}

/**
 * 获取指定 (pgroup, pls) 的 POI 实例数组
 * 数据源：state.liveState.poiInstances[pgroup][pls]
 * 用于 overlay-poi.js 渲染
 *
 * @param {number} pgroup
 * @param {number} pls
 * @returns {Array} bra_oblmappoi 行数组（可能为空）
 */
export function getLivePoiInstancesAt(pgroup, pls) {
  const byPls = state.liveState.poiInstances?.[pgroup];
  if (!byPls) return [];
  const arr = byPls[pls];
  return Array.isArray(arr) ? arr : [];
}

// ══════════════════════════════════════════════════
// 阶段5 新增：配置文件缓存管理（UPGRADE_DESIGN.md §2.10.6）
// ══════════════════════════════════════════════════

/**
 * 设置配置文件缓存（来自 editor.config.load 端点）
 * @param {'scatterPool'|'poiTable'|'poiPool'|'oblConfig'} key
 * @param {Object} data  解析后的配置对象
 */
export function setConfigCache(key, data) {
  if (key in state.configCache) {
    state.configCache[key] = data;
  } else {
    console.warn('[State] unknown configCache key:', key);
  }
}

/**
 * 批量设置配置文件缓存
 * @param {Object} config  { scatterPool?, poiTable?, poiPool?, oblConfig? }
 */
export function setConfigCacheBatch(config) {
  for (const key of ['scatterPool', 'poiTable', 'poiPool', 'oblConfig']) {
    if (config[key] !== undefined) {
      state.configCache[key] = config[key];
    }
  }
}

export default state;
