//
// projectStore：编辑中的地图项目（对齐 NEW_DESIGN.md §3.1 + §2.3.1）
//
// 研判：
//   - 地图空间结构编辑是 O-0 框架的核心能力
//   - validateStore 通过 projectStore 的 getters 读取数据
//   - simStore 通过 projectStore.tiles 读取连通图
//   - M8 addGeneratedRegion 单区域追加 API（生成器调用入口）
//
// 数据模型：regions / grids / tiles 三层嵌套字典（pgroup → pls → Tile）
// 持久化策略：localStorage 自动保存（debounce 500ms，对齐 AUTOSAVE_DEBOUNCE_MS）+ IndexedDB 回退
// 边界处理：pls 范围 1-254 / pgroup 范围 1-255 / 同 (pgroup, pls) 唯一性 / 8 方向自动连通
//
// M8 扩展：addGeneratedRegion(region, tiles) 单区域追加 API
//   - 用于 GeneratorModal 单区域模式：调用 generator.generateRegion 后写入 project
//   - 与 addRegion 区别：addGeneratedRegion 接收预生成的 region + tiles，不创建空区域
//   - pgroup 自动分配（max+1），深拷贝 region/tiles 避免外部 mutation
//   - 同步写入 region.cols/rows 与 grids.cols/rows（保持冗余字段一致）

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import {
  PLS_MAX,
  PLS_MIN,
  PGROUP_MAX,
  PGROUP_MIN,
  COLS_ROWS_MAX,
  COLS_ROWS_MIN,
  AUTOSAVE_DEBOUNCE_MS,
} from '@/shared';
import type {
  MapProject,
  ProjectData,
  Pgroup,
  Pls,
  Region,
  Grid,
  Tile,
  ExitLink,
  Floor,
  Tide,
} from '@/shared';
import {
  autoConnect,
  disconnectAll,
  breakConnection,
  restoreConnection,
} from '@/shared';

// ─── 持久化常量 ───────────────────────────────────────────────────
const STORAGE_KEY = 'oblivions_editor_project';
const STORAGE_FALLBACK_KEY = 'oblivions_editor_project_fallback_idb';
const STORAGE_QUOTA_TRIGGER_BYTES = 4_500_000; // 4.5MB 阈值，预留 buffer

// ─── IndexedDB 最小封装（autosave 回退用，无外部依赖） ─────────────
const IDB_DB_NAME = 'oblivions_editor';
const IDB_STORE_NAME = 'projects';
const IDB_KEY = 'current';

function idbOpen(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
          db.createObjectStore(IDB_STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbSave(data: string): Promise<boolean> {
  const db = await idbOpen();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
      tx.objectStore(IDB_STORE_NAME).put(data, IDB_KEY);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

async function idbLoad(): Promise<string | null> {
  const db = await idbOpen();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE_NAME, 'readonly');
      const req = tx.objectStore(IDB_STORE_NAME).get(IDB_KEY);
      req.onsuccess = () => resolve((req.result as string) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

// ─── 默认值工厂 ───────────────────────────────────────────────────
function makeDefaultTile(floor: Floor, tide: Tide, passable: boolean, height: number, destructible: boolean): Tile {
  return {
    name: '',
    desc: '',
    floor,
    tide,
    height,
    passable,
    destructible,
    neighbors: [],
    x: 0,
    y: 0,
    preset_safe: false,
    _breaks: [],
  };
}

function makeDefaultRegion(name: string, cols: number, rows: number): Region {
  return {
    name,
    desc: '',
    entrance_pls: null,
    exit_pls: null,
    next_region: null,
    prev_region: null,
    exit_links: [],
    cols,
    rows,
  };
}

function makeDefaultGrid(cols: number, rows: number): Grid {
  return { cols, rows };
}

function makeEmptyProject(): MapProject {
  return { regions: {}, grids: {}, tiles: {} };
}

// ─── 数据迁移（与旧 Vanilla JS migrateProject 对齐） ──────────────
function migrateProject(project: MapProject): void {
  for (const pgroupKey of Object.keys(project.regions)) {
    const pgroup = Number(pgroupKey) as Pgroup;
    const region = project.regions[pgroup];
    if (!region) continue;

    // exit_links 旧格式（裸 pgroup 数字数组）→ 对象数组
    if (Array.isArray(region.exit_links)) {
      region.exit_links = region.exit_links.map((l): ExitLink => {
        if (typeof l === 'number') {
          return { from_pls: null, to_pgroup: l as Pgroup, to_pls: null };
        }
        return l;
      });
    } else {
      region.exit_links = [];
    }

    // 同步冗余字段 region.cols / rows ← grids.cols / rows
    const grid = project.grids[pgroup];
    if (grid) {
      region.cols = grid.cols;
      region.rows = grid.rows;
    }

    // tiles 字段补全
    const tiles = project.tiles[pgroup];
    if (tiles) {
      for (const plsKey of Object.keys(tiles)) {
        const pls = Number(plsKey) as Pls;
        const t = tiles[pls];
        if (!t) continue;
        if (t.height === undefined) t.height = 0;
        if (t.destructible === undefined) t.destructible = false;
        if (t.preset_safe === undefined) t.preset_safe = false;
        if (t.neighbors === undefined) t.neighbors = [];
        if (t._breaks === undefined) t._breaks = [];
        // tide='safe' → tide='shallow' + preset_safe=true（对齐 DESIGN.md 1.3）
        if (t.tide === ('safe' as unknown as Tide)) {
          t.tide = 'shallow';
          t.preset_safe = true;
        }
      }
    } else {
      project.tiles[pgroup] = {};
    }
  }
}

// ─── debounce 自动保存 ────────────────────────────────────────────
let saveTimer: ReturnType<typeof setTimeout> | null = null;

export const useProjectStore = defineStore('project', () => {
  // ─── state ────────────────────────────────────────────
  const project = ref<MapProject>(makeEmptyProject());
  const projectName = ref<string>('未命名项目');
  const createdAt = ref<number>(Date.now());
  const updatedAt = ref<number>(Date.now());
  const currentPgroup = ref<Pgroup | null>(null);
  const selectedPls = ref<Pls | null>(null);
  const isDirty = ref(false);
  /** 自动保存最近一次错误（用于 StatusBar 提示，null 表示无错误） */
  const lastSaveError = ref<string | null>(null);
  /** 是否已回退到 IndexedDB（用于 StatusBar 提示） */
  const usingIndexedDB = ref(false);

  // ─── getters ──────────────────────────────────────────
  const hasProject = computed(() => Object.keys(project.value.regions).length > 0);
  const regionCount = computed(() => Object.keys(project.value.regions).length);
  const regionList = computed<{ pgroup: Pgroup; region: Region }[]>(() =>
    Object.keys(project.value.regions)
      .map((k) => Number(k) as Pgroup)
      .sort((a, b) => a - b)
      .map((pgroup) => ({ pgroup, region: project.value.regions[pgroup]! })),
  );
  const currentRegion = computed<Region | null>(() => {
    if (currentPgroup.value === null) return null;
    return project.value.regions[currentPgroup.value] ?? null;
  });
  const currentGrid = computed<Grid | null>(() => {
    if (currentPgroup.value === null) return null;
    return project.value.grids[currentPgroup.value] ?? null;
  });
  const currentTiles = computed<Record<Pls, Tile>>(() => {
    if (currentPgroup.value === null) return {};
    return project.value.tiles[currentPgroup.value] ?? {};
  });
  const currentTile = computed<Tile | null>(() => {
    if (selectedPls.value === null) return null;
    return currentTiles.value[selectedPls.value] ?? null;
  });
  const tileCount = computed(() => {
    if (currentPgroup.value === null) return 0;
    const tiles = project.value.tiles[currentPgroup.value];
    return tiles ? Object.keys(tiles).length : 0;
  });

  // ─── 内部工具 ─────────────────────────────────────────
  function nextPgroup(): Pgroup | null {
    const keys = Object.keys(project.value.regions).map(Number);
    const next = keys.length === 0 ? PGROUP_MIN : Math.max(...keys) + 1;
    return next > PGROUP_MAX ? null : (next as Pgroup);
  }

  function nextPls(pgroup: Pgroup): Pls | null {
    const tiles = project.value.tiles[pgroup] ?? {};
    const keys = Object.keys(tiles).map(Number);
    const next = keys.length === 0 ? PLS_MIN : Math.max(...keys) + 1;
    return next > PLS_MAX ? null : (next as Pls);
  }

  function findTileByCoord(pgroup: Pgroup, x: number, y: number): Pls | null {
    const tiles = project.value.tiles[pgroup];
    if (!tiles) return null;
    for (const plsKey of Object.keys(tiles)) {
      const pls = Number(plsKey) as Pls;
      const t = tiles[pls];
      if (t && t.x === x && t.y === y) return pls;
    }
    return null;
  }

  function cloneProject(): MapProject {
    return JSON.parse(JSON.stringify(project.value)) as MapProject;
  }

  // ─── 自动保存（debounce 500ms + IndexedDB 回退） ──────
  function scheduleAutosave(): void {
    if (saveTimer !== null) {
      clearTimeout(saveTimer);
    }
    saveTimer = setTimeout(() => {
      void doSave();
    }, AUTOSAVE_DEBOUNCE_MS);
  }

  async function doSave(): Promise<void> {
    const data: ProjectData = {
      name: projectName.value,
      createdAt: createdAt.value,
      updatedAt: updatedAt.value,
      payload: project.value,
    };
    const json = JSON.stringify(data);

    // 估算大小，超阈值直接走 IndexedDB
    if (json.length > STORAGE_QUOTA_TRIGGER_BYTES) {
      const ok = await idbSave(json);
      usingIndexedDB.value = true;
      lastSaveError.value = ok ? null : 'IndexedDB save failed';
      if (ok) {
        // 同步在 localStorage 留 fallback 标记
        try {
          localStorage.setItem(STORAGE_FALLBACK_KEY, IDB_KEY);
        } catch {
          /* ignore */
        }
      }
      return;
    }

    // 小数据走 localStorage
    try {
      localStorage.setItem(STORAGE_KEY, json);
      usingIndexedDB.value = false;
      lastSaveError.value = null;
    } catch {
      // localStorage 配额超限 → 回退到 IndexedDB
      const ok = await idbSave(json);
      usingIndexedDB.value = true;
      lastSaveError.value = ok ? null : 'storage quota exceeded and IndexedDB unavailable';
      if (ok) {
        try {
          localStorage.setItem(STORAGE_FALLBACK_KEY, IDB_KEY);
        } catch {
          /* ignore */
        }
      }
    }
  }

  async function loadFromStorage(): Promise<boolean> {
    // 优先 localStorage
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const data = JSON.parse(raw) as ProjectData;
        if (data.payload && data.payload.regions && data.payload.grids && data.payload.tiles) {
          loadProject(data.payload, { name: data.name, preserveTimestamps: true, createdAt: data.createdAt, updatedAt: data.updatedAt });
          usingIndexedDB.value = false;
          return true;
        }
      }
    } catch {
      /* fall through to IndexedDB */
    }

    // 回退 IndexedDB
    const raw = await idbLoad();
    if (raw) {
      try {
        const data = JSON.parse(raw) as ProjectData;
        if (data.payload && data.payload.regions && data.payload.grids && data.payload.tiles) {
          loadProject(data.payload, { name: data.name, preserveTimestamps: true, createdAt: data.createdAt, updatedAt: data.updatedAt });
          usingIndexedDB.value = true;
          return true;
        }
      } catch {
        /* ignore */
      }
    }
    return false;
  }

  // ─── 项目级 actions ───────────────────────────────────

  /**
   * 覆盖式加载项目（用于导入 / 从存储恢复）
   *
   * 自动迁移旧格式（exit_links 裸数字 / tide='safe' / 缺字段）。
   * 默认选中第一个 pgroup。
   */
  function loadProject(
    next: MapProject,
    opts?: { name?: string; preserveTimestamps?: boolean; createdAt?: number; updatedAt?: number },
  ): void {
    migrateProject(next);
    project.value = next;
    projectName.value = opts?.name ?? '未命名项目';
    const now = Date.now();
    if (opts?.preserveTimestamps) {
      createdAt.value = opts.createdAt ?? now;
      updatedAt.value = opts.updatedAt ?? now;
    } else {
      createdAt.value = now;
      updatedAt.value = now;
    }
    const firstPgroup = Object.keys(next.regions).map(Number).sort((a, b) => a - b)[0];
    currentPgroup.value = firstPgroup !== undefined ? (firstPgroup as Pgroup) : null;
    selectedPls.value = null;
    isDirty.value = false;
  }

  /**
   * 追加式加载：将 next 的区域追加到当前项目
   *
   * 用于"从后端导入"或"合并项目"。pgroup 自动重新分配为当前 max+1，避免冲突。
   * next 中所有 pgroup 都会被重新映射；next_region / prev_region / exit_links.to_pgroup
   * 也会跟随重新映射。
   */
  function appendProject(next: MapProject): Pgroup[] {
    migrateProject(next);
    const oldToNew = new Map<Pgroup, Pgroup>();
    const newPgroups: Pgroup[] = [];
    // 先计算当前 max pgroup，循环中递增，避免 nextPgroup() 重复返回同一值
    const existingKeys = Object.keys(project.value.regions).map(Number);
    let nextPgroupCandidate = existingKeys.length === 0 ? PGROUP_MIN : Math.max(...existingKeys) + 1;
    for (const oldPgroupKey of Object.keys(next.regions).map(Number).sort((a, b) => a - b)) {
      if (nextPgroupCandidate > PGROUP_MAX) break;
      const newPgroup = nextPgroupCandidate as Pgroup;
      oldToNew.set(oldPgroupKey as Pgroup, newPgroup);
      newPgroups.push(newPgroup);
      nextPgroupCandidate += 1;
    }

    // 复制 regions / grids / tiles 到新 pgroup
    for (const [oldPgroup, newPgroup] of oldToNew) {
      const region = next.regions[oldPgroup];
      const grid = next.grids[oldPgroup];
      const tiles = next.tiles[oldPgroup];
      if (!region || !grid) continue;
      project.value.regions[newPgroup] = JSON.parse(JSON.stringify(region));
      project.value.grids[newPgroup] = JSON.parse(JSON.stringify(grid));
      project.value.tiles[newPgroup] = tiles ? JSON.parse(JSON.stringify(tiles)) : {};
    }

    // 重新映射 next_region / prev_region / exit_links.to_pgroup
    for (const newPgroup of newPgroups) {
      const region = project.value.regions[newPgroup];
      if (!region) continue;
      if (region.next_region !== null) {
        region.next_region = oldToNew.get(region.next_region) ?? null;
      }
      if (region.prev_region !== null) {
        region.prev_region = oldToNew.get(region.prev_region) ?? null;
      }
      for (const link of region.exit_links) {
        link.to_pgroup = oldToNew.get(link.to_pgroup) ?? link.to_pgroup;
      }
    }

    isDirty.value = true;
    updatedAt.value = Date.now();
    scheduleAutosave();
    return newPgroups;
  }

  function clearProject(): void {
    project.value = makeEmptyProject();
    projectName.value = '未命名项目';
    createdAt.value = Date.now();
    updatedAt.value = Date.now();
    currentPgroup.value = null;
    selectedPls.value = null;
    isDirty.value = false;
    lastSaveError.value = null;
    usingIndexedDB.value = false;
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(STORAGE_FALLBACK_KEY);
    } catch {
      /* ignore */
    }
    void idbSave(''); // 清空 IndexedDB
  }

  function setCurrentPgroup(pgroup: Pgroup): void {
    if (!project.value.regions[pgroup]) return;
    currentPgroup.value = pgroup;
    selectedPls.value = null;
  }

  function setSelectedPls(pls: Pls | null): void {
    selectedPls.value = pls;
  }

  function markDirty(): void {
    isDirty.value = true;
    updatedAt.value = Date.now();
    scheduleAutosave();
  }

  function markSaved(): void {
    isDirty.value = false;
  }

  /**
   * 设置项目名（编辑器侧元数据，不写回 PHP）
   */
  function setProjectName(name: string): void {
    projectName.value = name;
    updatedAt.value = Date.now();
    scheduleAutosave();
  }

  // ─── 区域 CRUD ────────────────────────────────────────

  /**
   * 新增区域
   *
   * @param name 区域名（默认"新区域 N"）
   * @param cols 列数（1-254）
   * @param rows 行数（1-254）
   * @returns 新 pgroup，已达上限返回 null
   */
  function addRegion(name?: string, cols: number = 8, rows: number = 6): Pgroup | null {
    const pgroup = nextPgroup();
    if (pgroup === null) return null;
    const safeCols = Math.min(Math.max(Math.floor(cols), COLS_ROWS_MIN), COLS_ROWS_MAX);
    const safeRows = Math.min(Math.max(Math.floor(rows), COLS_ROWS_MIN), COLS_ROWS_MAX);
    const regionName = name ?? `新区域 ${regionCount.value + 1}`;
    project.value.regions[pgroup] = makeDefaultRegion(regionName, safeCols, safeRows);
    project.value.grids[pgroup] = makeDefaultGrid(safeCols, safeRows);
    project.value.tiles[pgroup] = {};
    currentPgroup.value = pgroup;
    selectedPls.value = null;
    markDirty();
    return pgroup;
  }

  /**
   * 新增预生成区域（M8 单区域生成器调用入口，对齐 §3.7.6 + Dian.md O-5）
   *
   * 与 addRegion 的区别：
   *   - addRegion 创建空区域（cols × rows 网格，无 tiles）
   *   - addGeneratedRegion 接收生成器产出的预生成 region + tiles，直接写入 project
   *
   * pgroup 自动分配（max+1，达上限返回 null）
   * 深拷贝 region/tiles 避免外部 mutation 影响内部 state
   * 同步写入 region.cols/rows 与 grids.cols/rows（保持冗余字段一致）
   * 切换 currentPgroup 到新区域 + 清空 selectedPls
   *
   * @param region 生成器产出的 Region 对象（pgroup 字段会被忽略，由本方法分配）
   * @param tiles  生成器产出的 tiles 字典
   * @returns 新 pgroup，已达上限返回 null
   */
  function addGeneratedRegion(
    region: Region,
    tiles: Record<Pls, Tile>,
  ): Pgroup | null {
    const pgroup = nextPgroup();
    if (pgroup === null) return null;
    // 深拷贝避免外部 mutation 影响 state
    project.value.regions[pgroup] = JSON.parse(JSON.stringify(region));
    project.value.grids[pgroup] = makeDefaultGrid(region.cols, region.rows);
    project.value.tiles[pgroup] = JSON.parse(JSON.stringify(tiles));
    currentPgroup.value = pgroup;
    selectedPls.value = null;
    markDirty();
    return pgroup;
  }

  /**
   * 删除区域
   *
   * 清理其他区域对该区域的引用：next_region / prev_region / exit_links
   */
  function deleteRegion(pgroup: Pgroup): void {
    if (!project.value.regions[pgroup]) return;
    // 清理引用
    for (const pgKey of Object.keys(project.value.regions)) {
      const pg = Number(pgKey) as Pgroup;
      if (pg === pgroup) continue;
      const r = project.value.regions[pg];
      if (!r) continue;
      if (r.next_region === pgroup) r.next_region = null;
      if (r.prev_region === pgroup) r.prev_region = null;
      r.exit_links = r.exit_links.filter((l) => l.to_pgroup !== pgroup);
    }
    delete project.value.regions[pgroup];
    delete project.value.grids[pgroup];
    delete project.value.tiles[pgroup];
    if (currentPgroup.value === pgroup) {
      const firstPgroup = Object.keys(project.value.regions).map(Number).sort((a, b) => a - b)[0];
      currentPgroup.value = firstPgroup !== undefined ? (firstPgroup as Pgroup) : null;
      selectedPls.value = null;
    }
    markDirty();
  }

  /**
   * 更新区域属性
   *
   * 双向同步 next_region / prev_region（设置 A.next_region=B 时自动设置 B.prev_region=A）
   * 调整 cols/rows 时同步 grids.cols / rows 与 region.cols / rows
   */
  function updateRegion(pgroup: Pgroup, patch: Partial<Region>): void {
    const region = project.value.regions[pgroup];
    if (!region) return;
    Object.assign(region, patch);

    // 同步 grids.cols / rows
    if (patch.cols !== undefined || patch.rows !== undefined) {
      const grid = project.value.grids[pgroup];
      if (grid) {
        if (patch.cols !== undefined) grid.cols = patch.cols;
        if (patch.rows !== undefined) grid.rows = patch.rows;
      }
    }

    // next_region 双向同步
    if (patch.next_region !== undefined && patch.next_region !== null) {
      const target = project.value.regions[patch.next_region];
      if (target) {
        // 清理原 target 的 prev_region 反指
        if (target.prev_region !== null && target.prev_region !== pgroup) {
          const oldPrev = project.value.regions[target.prev_region];
          if (oldPrev && oldPrev.next_region === patch.next_region) {
            oldPrev.next_region = null;
          }
        }
        target.prev_region = pgroup;
      }
    }

    markDirty();
  }

  /**
   * 添加一条 exit_links 条目
   */
  function addExitLink(pgroup: Pgroup, link: ExitLink): void {
    const region = project.value.regions[pgroup];
    if (!region) return;
    region.exit_links = [...region.exit_links, { ...link }];
    markDirty();
  }

  /**
   * 更新指定索引的 exit_links 条目
   */
  function updateExitLink(pgroup: Pgroup, index: number, patch: Partial<ExitLink>): void {
    const region = project.value.regions[pgroup];
    if (!region) return;
    const link = region.exit_links[index];
    if (!link) return;
    region.exit_links = region.exit_links.map((l, i) => (i === index ? { ...l, ...patch } : l));
    markDirty();
  }

  /**
   * 删除指定索引的 exit_links 条目
   */
  function removeExitLink(pgroup: Pgroup, index: number): void {
    const region = project.value.regions[pgroup];
    if (!region) return;
    region.exit_links = region.exit_links.filter((_, i) => i !== index);
    markDirty();
  }

  // ─── 格 CRUD ──────────────────────────────────────────

  /**
   * 新增格
   *
   * 同 (pgroup, x, y) 坐标唯一性：已存在则返回 null
   * 自动分配 pls（max+1），超上限返回 null
   * 自动调用 autoConnect 建立 8 方向连通
   *
   * @param preset 画笔预设（floor / tide / passable / height / destructible）
   */
  function addTile(
    pgroup: Pgroup,
    x: number,
    y: number,
    preset?: { floor?: Floor; tide?: Tide; passable?: boolean; height?: number; destructible?: boolean; preset_safe?: boolean },
  ): Pls | null {
    if (!project.value.tiles[pgroup]) return null;
    if (findTileByCoord(pgroup, x, y) !== null) return null;
    const pls = nextPls(pgroup);
    if (pls === null) return null;

    const tile = makeDefaultTile(
      preset?.floor ?? 'standard',
      preset?.tide ?? 'shallow',
      preset?.passable ?? true,
      preset?.height ?? 0,
      preset?.destructible ?? false,
    );
    tile.x = x;
    tile.y = y;
    tile.preset_safe = preset?.preset_safe ?? false;

    project.value.tiles[pgroup]![pls] = tile;
    autoConnect(project.value.tiles[pgroup]!, pls);
    markDirty();
    return pls;
  }

  /**
   * 删除格
   *
   * 清理连通关系（disconnectAll）+ 清理 region 中对该格的引用（entrance/exit_pls）
   */
  function deleteTile(pgroup: Pgroup, pls: Pls): void {
    const tiles = project.value.tiles[pgroup];
    if (!tiles || !tiles[pls]) return;
    disconnectAll(tiles, pls);
    delete tiles[pls];

    const region = project.value.regions[pgroup];
    if (region) {
      if (region.entrance_pls === pls) region.entrance_pls = null;
      if (region.exit_pls === pls) region.exit_pls = null;
    }
    if (selectedPls.value === pls && currentPgroup.value === pgroup) {
      selectedPls.value = null;
    }
    markDirty();
  }

  /**
   * 更新格属性
   *
   * 若 x/y 变化：先 disconnectAll 清除旧连通，再 autoConnect 重建连通
   */
  function updateTile(pgroup: Pgroup, pls: Pls, patch: Partial<Tile>): void {
    const tiles = project.value.tiles[pgroup];
    if (!tiles || !tiles[pls]) return;
    const oldTile = tiles[pls]!;
    const oldX = oldTile.x;
    const oldY = oldTile.y;
    Object.assign(oldTile, patch);

    if (
      (patch.x !== undefined && patch.x !== oldX) ||
      (patch.y !== undefined && patch.y !== oldY)
    ) {
      const tileRef = tiles[pls]!;
      disconnectAll(tiles, pls);
      tileRef.neighbors = [];
      autoConnect(tiles, pls);
    }
    markDirty();
  }

  /**
   * 移动格坐标（select 工具拖拽）
   *
   * 若目标坐标已有其他格，移动失败返回 false（UI 提示）
   */
  function moveTile(pgroup: Pgroup, pls: Pls, newX: number, newY: number): boolean {
    const tiles = project.value.tiles[pgroup];
    if (!tiles || !tiles[pls]) return false;
    const tile = tiles[pls]!;
    if (tile.x === newX && tile.y === newY) return true;
    const existing = findTileByCoord(pgroup, newX, newY);
    if (existing !== null && existing !== pls) return false;

    disconnectAll(tiles, pls);
    tile.x = newX;
    tile.y = newY;
    tile.neighbors = [];
    autoConnect(tiles, pls);
    markDirty();
    return true;
  }

  // ─── 连通图直接操作（break / restore 工具调用） ────────
  // 这些操作不走 historyStore（由 useToolActions 包装为 Command 时记录）

  function breakTileConnection(pgroup: Pgroup, pls1: Pls, pls2: Pls): void {
    const tiles = project.value.tiles[pgroup];
    if (!tiles) return;
    breakConnection(tiles, pls1, pls2);
    markDirty();
  }

  function restoreTileConnection(pgroup: Pgroup, pls1: Pls, pls2: Pls): void {
    const tiles = project.value.tiles[pgroup];
    if (!tiles) return;
    restoreConnection(tiles, pls1, pls2);
    markDirty();
  }

  /**
   * 内部使用：用快照替换当前 project（用于 undo/redo 还原整体状态）
   *
   * 注意：此 API 不通过 markDirty 触发 autosave，调用方负责后续 scheduleAutosave。
   */
  function replaceProject(snapshot: MapProject): void {
    project.value = snapshot;
    // 校验 currentPgroup / selectedPls 仍在快照中
    if (currentPgroup.value !== null && !snapshot.regions[currentPgroup.value]) {
      const first = Object.keys(snapshot.regions).map(Number).sort((a, b) => a - b)[0];
      currentPgroup.value = first !== undefined ? (first as Pgroup) : null;
      selectedPls.value = null;
    }
    if (currentPgroup.value !== null && selectedPls.value !== null) {
      const tiles = snapshot.tiles[currentPgroup.value];
      if (!tiles || !tiles[selectedPls.value]) {
        selectedPls.value = null;
      }
    }
    updatedAt.value = Date.now();
    scheduleAutosave();
  }

  /**
   * 内部使用：取当前 project 快照（用于 undo/redo 记录前置状态）
   */
  function snapshot(): MapProject {
    return cloneProject();
  }

  return {
    // state
    project,
    projectName,
    createdAt,
    updatedAt,
    currentPgroup,
    selectedPls,
    isDirty,
    lastSaveError,
    usingIndexedDB,
    // getters
    hasProject,
    regionCount,
    regionList,
    currentRegion,
    currentGrid,
    currentTiles,
    currentTile,
    tileCount,
    // 项目级 actions
    loadProject,
    appendProject,
    clearProject,
    setCurrentPgroup,
    setSelectedPls,
    markDirty,
    markSaved,
    setProjectName,
    loadFromStorage,
    // 区域 CRUD
    addRegion,
    addGeneratedRegion,
    deleteRegion,
    updateRegion,
    addExitLink,
    updateExitLink,
    removeExitLink,
    // 格 CRUD
    addTile,
    deleteTile,
    updateTile,
    moveTile,
    // 连通图操作
    breakTileConnection,
    restoreTileConnection,
    // undo/redo 快照
    replaceProject,
    snapshot,
    // 工具函数（导出供测试 / useToolActions 使用）
    nextPgroup,
    nextPls,
    findTileByCoord,
  };
});
