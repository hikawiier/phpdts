// @module O 内容工具箱
//
// projectStore：编辑中的地图项目（对齐 NEW_DESIGN.md §3.1 + §2.3.1）
//
// 研判（P1-E 重构后）：
//   - 数据权威源已从 MapProject 转移到 Resource Graph（world.region / world.tile 节点）
//   - projectStore 退化为 Vue 响应式入口 + 历史会话元数据持有者
//   - project / regions / grids / tiles / currentRegion / currentGrid / currentTiles /
//     currentTile / regionCount / regionList / tileCount 均为只读 computed，从 graph-store 派生
//   - 所有 actions 内部操作 graph-store；外部接口签名保持不变（MapEditorView / useToolActions /
//     useImportExport / GeneratorsView 等调用方零修改）
//   - 撤销/重做通过 GraphSnapshot（world 节点 + contains/adjacent_to 边）记录前置/后置状态
//
// 数据模型（向后兼容）：regions / grids / tiles 三层嵌套字典（pgroup → pls → Tile）
//   - 通过 projectFromGraph 重建 MapProject 形状供 useImportExport 导出与现有调用方消费
//   - 派生 project 是只读 computed；现有 `project.value = ...` 的写法迁移到 replaceProject
//
// 持久化策略（P1-E 调整）：
//   - localStorage 仅持久化 projectName / createdAt / updatedAt / currentPgroup / selectedPls 元数据
//   - 不再持久化完整 MapProject（避免与 graph-store 权威源冲突）
//   - 移除 IndexedDB 回退（数据量 < 1KB，不再触发配额阈值）
//   - graph-store 的 world 节点从 loader.ts 重新装配（P0 已实现工作区加载器）
//
// 边界处理：
//   - pls 范围 1-254 / pgroup 范围 1-255 / 同 (pgroup, pls) 唯一性 / 8 方向自动连通
//   - migrateProject 保留，迁移时机在 loadProject 内部、装配器写入 graph-store 之前
//   - _breaks 字段不删除 adjacent_to 边，仅在 world.tile 节点的 data._breaks 数组中增删 pls
//   - usingIndexedDB 永远为 false（保留字段供 StatusBar 兼容显示）

import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
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
  Pgroup,
  Pls,
  Region,
  Grid,
  Tile,
  ExitLink,
  Floor,
  Tide,
} from '@/shared';
import { useGraphStore } from '@/graph/graph-store';
import {
  assembleWorldResources,
  projectFromGraph,
  type WorldRegionData,
  type WorldTileData,
} from '@/graph/assemblers/world-assembler';
import type { ResourceNode } from '@/graph/types';
import type { RelationshipEdge } from '@/graph/edge';

// ─── 持久化常量 ───────────────────────────────────────────────────
const STORAGE_KEY = 'oblivions_editor_project_meta';

/** 元数据持久化结构（P1-E：仅元数据，不再持久化完整 MapProject） */
interface ProjectMeta {
  name: string;
  createdAt: number;
  updatedAt: number;
  currentPgroup: Pgroup | null;
  selectedPls: Pls | null;
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

// ─── 数据迁移（与旧 Vanilla JS migrateProject 对齐） ──────────────
/**
 * 把旧格式 MapProject 迁移到当前 schema：
 *   - exit_links 裸 pgroup 数字数组 → 对象数组
 *   - region.cols / rows ← grids.cols / rows 冗余字段同步
 *   - tiles 缺失字段补全（height / destructible / preset_safe / neighbors / _breaks）
 *   - tide='safe' → tide='shallow' + preset_safe=true（对齐 DESIGN.md 1.3）
 *
 * 时机：在 loadProject / appendProject 调用 assembleWorldResources 写入 graph-store 之前。
 */
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

/**
 * Graph 快照——用于 undo/redo 还原整体 world 子图状态。
 *
 * 仅包含 world.region / world.tile 节点与 contains / adjacent_to 边（P1 范围）；
 * 其他 kind 节点不参与历史栈，避免快照过大。
 */
export interface GraphSnapshot {
  worldNodes: ResourceNode[];
  worldEdges: RelationshipEdge[];
}

export const useProjectStore = defineStore('project', () => {
  // ─── graph-store 实例（响应式入口） ─────────────────
  const graph = useGraphStore();

  // ─── state：仅编辑器侧元数据 ────────────────────────
  const projectName = ref<string>('未命名项目');
  const createdAt = ref<number>(Date.now());
  const updatedAt = ref<number>(Date.now());
  const currentPgroup = ref<Pgroup | null>(null);
  const selectedPls = ref<Pls | null>(null);
  const isDirty = ref(false);
  /** 自动保存最近一次错误（用于 StatusBar 提示，null 表示无错误） */
  const lastSaveError = ref<string | null>(null);
  /** 是否已回退到 IndexedDB——P1-E 后永远为 false（保留字段供 StatusBar 兼容显示） */
  const usingIndexedDB = ref(false);

  // ─── 派生 getters：从 graph-store 重建 MapProject ────
  /**
   * 派生 MapProject——从 graph-store 的 world.region / world.tile 节点重建。
   *
   * 只读 computed：外部不得直接修改（mutation 不会写回 graph-store）。
   * 现有 `project.value = ...` 写法迁移到 replaceProject。
   */
  const project = computed<MapProject>(() => {
    const regionNodes = graph.findNodesByKind('world.region');
    const tileNodes = graph.findNodesByKind('world.tile');
    return projectFromGraph(regionNodes, tileNodes);
  });

  /** regions 字典（从 graph 派生） */
  const regions = computed<MapProject['regions']>(() => project.value.regions);
  /** grids 字典（从 graph 派生——grids 与 region.cols/rows 冗余同步） */
  const grids = computed<MapProject['grids']>(() => project.value.grids);
  /** tiles 字典（从 graph 派生） */
  const tiles = computed<MapProject['tiles']>(() => project.value.tiles);

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
    const tilesInRegion = project.value.tiles[currentPgroup.value];
    return tilesInRegion ? Object.keys(tilesInRegion).length : 0;
  });

  /**
   * 自动初始化 currentPgroup——当 graph-store 中的 world.region 节点变化时，
   * 如果 currentPgroup 为 null（首次加载或全部区域被删除后回填），自动选中第一个 region。
   *
   * 设计意图：loadWorkspace 通过 graph.applyNodeBatch 写入 world 节点，
   * 但不会调用 loadProject / loadFromStorage 设置 currentPgroup。
   * 此 watch 作为 graph → projectStore 的桥接，保证 UI 加载完成后默认有选中区域。
   */
  watch(
    () => project.value.regions,
    (regions) => {
      if (currentPgroup.value !== null) return;
      const firstPgroup = Object.keys(regions)
        .map(Number)
        .sort((a, b) => a - b)[0];
      if (firstPgroup !== undefined) {
        currentPgroup.value = firstPgroup as Pgroup;
      }
    },
    { immediate: true },
  );

  // ─── 内部工具 ─────────────────────────────────────────
  function nextPgroup(): Pgroup | null {
    const keys = Object.keys(project.value.regions).map(Number);
    const next = keys.length === 0 ? PGROUP_MIN : Math.max(...keys) + 1;
    return next > PGROUP_MAX ? null : (next as Pgroup);
  }

  function nextPls(pgroup: Pgroup): Pls | null {
    const tilesInRegion = project.value.tiles[pgroup] ?? {};
    const keys = Object.keys(tilesInRegion).map(Number);
    const next = keys.length === 0 ? PLS_MIN : Math.max(...keys) + 1;
    return next > PLS_MAX ? null : (next as Pls);
  }

  function findTileByCoord(pgroup: Pgroup, x: number, y: number): Pls | null {
    const tilesInRegion = project.value.tiles[pgroup];
    if (!tilesInRegion) return null;
    for (const plsKey of Object.keys(tilesInRegion)) {
      const pls = Number(plsKey) as Pls;
      const t = tilesInRegion[pls];
      if (t && t.x === x && t.y === y) return pls;
    }
    return null;
  }

  /** 深拷贝当前派生 MapProject（用于 undo/redo 旧 API 与导入路径） */
  function cloneProject(): MapProject {
    return JSON.parse(JSON.stringify(project.value)) as MapProject;
  }

  // ─── graph-store 写入辅助 ────────────────────────────

  /**
   * 移除当前 graph 中所有 world.region / world.tile 节点（级联清理 contains / adjacent_to 边）。
   *
   * 用于 replaceProject / replaceGraphSnapshot / clearProject / loadProject 等需要全量替换的场景。
   */
  function clearWorldNodes(): void {
    const regionNodes = graph.findNodesByKind('world.region');
    const tileNodes = graph.findNodesByKind('world.tile');
    // 先移除 tile（避免 region 删除时 cascadedEdges 重复计算）
    for (const node of tileNodes) {
      graph.removeNode(`world.tile:${node.id}`);
    }
    for (const node of regionNodes) {
      graph.removeNode(`world.region:${node.id}`);
    }
  }

  /**
   * 把 MapProject 装配为 world 节点并批量写入 graph-store。
   *
   * 内部调用 assembleWorldResources（已实现 contains / adjacent_to 边装配）。
   * 调用方负责先调用 clearWorldNodes() 清空旧节点（避免 ID 冲突）。
   *
   * 同步实现（P0-P4）：graph-store.applyNodeBatch 已同步。
   */
  function applyProjectToGraph(next: MapProject): void {
    const { nodes: nodesArr, edges } = assembleWorldResources(next);
    graph.applyNodeBatch(nodesArr, edges);
  }

  // ─── 自动保存（debounce 500ms，仅持久化元数据） ──────
  function scheduleAutosave(): void {
    if (saveTimer !== null) {
      clearTimeout(saveTimer);
    }
    saveTimer = setTimeout(() => {
      void doSave();
    }, AUTOSAVE_DEBOUNCE_MS);
  }

  async function doSave(): Promise<void> {
    const meta: ProjectMeta = {
      name: projectName.value,
      createdAt: createdAt.value,
      updatedAt: updatedAt.value,
      currentPgroup: currentPgroup.value,
      selectedPls: selectedPls.value,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(meta));
      lastSaveError.value = null;
    } catch (err) {
      lastSaveError.value = err instanceof Error ? err.message : 'localStorage 写入失败';
    }
  }

  async function loadFromStorage(): Promise<boolean> {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const meta = JSON.parse(raw) as Partial<ProjectMeta>;
      if (typeof meta.name !== 'string') return false;
      projectName.value = meta.name;
      createdAt.value = meta.createdAt ?? Date.now();
      updatedAt.value = meta.updatedAt ?? Date.now();
      currentPgroup.value = meta.currentPgroup ?? null;
      selectedPls.value = meta.selectedPls ?? null;
      usingIndexedDB.value = false;
      // graph-store 的 world 节点从 loader.ts 重新装配（P0 已实现）
      // 若 currentPgroup 不在 graph 中，回退到第一个 region
      if (currentPgroup.value !== null && !project.value.regions[currentPgroup.value]) {
        const firstPgroup = Object.keys(project.value.regions)
          .map(Number)
          .sort((a, b) => a - b)[0];
        currentPgroup.value = firstPgroup !== undefined ? (firstPgroup as Pgroup) : null;
        selectedPls.value = null;
      }
      return true;
    } catch {
      return false;
    }
  }

  // ─── 项目级 actions ───────────────────────────────────

  /**
   * 覆盖式加载项目（用于导入 / 从存储恢复）
   *
   * 自动迁移旧格式（exit_links 裸数字 / tide='safe' / 缺字段）。
   * 默认选中第一个 pgroup。
   *
   * 同步实现（P0-P4）：graph-store actions 同步。
   */
  function loadProject(
    next: MapProject,
    opts?: { name?: string; preserveTimestamps?: boolean; createdAt?: number; updatedAt?: number },
  ): void {
    migrateProject(next);
    clearWorldNodes();
    applyProjectToGraph(next);
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
   * 同步版本（保留 API 兼容）：与 loadProject 等价，因 graph-store 已同步。
   *
   * 历史背景：P1-E 重构初期 graph-store 曾异步，loadProject 是 async，loadProjectSync
   * 是同步 wrapper。P0-P4 djb2 同步 hash 后两者行为完全一致。
   */
  function loadProjectSync(
    next: MapProject,
    opts?: { name?: string; preserveTimestamps?: boolean; createdAt?: number; updatedAt?: number },
  ): void {
    loadProject(next, opts);
  }

  /**
   * 追加式加载：将 next 的区域追加到当前项目
   *
   * 用于"从后端导入"或"合并项目"。pgroup 自动重新分配为当前 max+1，避免冲突。
   * next 中所有 pgroup 都会被重新映射；next_region / prev_region / exit_links.to_pgroup
   * 也会跟随重新映射。
   *
   * 同步实现（P0-P4）：graph-store actions 同步。
   */
  function appendProject(next: MapProject): Pgroup[] {
    migrateProject(next);
    const oldToNew = new Map<Pgroup, Pgroup>();
    const newPgroups: Pgroup[] = [];
    const existingKeys = Object.keys(project.value.regions).map(Number);
    let nextPgroupCandidate = existingKeys.length === 0 ? PGROUP_MIN : Math.max(...existingKeys) + 1;

    for (const oldPgroupKey of Object.keys(next.regions).map(Number).sort((a, b) => a - b)) {
      if (nextPgroupCandidate > PGROUP_MAX) break;
      const newPgroup = nextPgroupCandidate as Pgroup;
      oldToNew.set(oldPgroupKey as Pgroup, newPgroup);
      newPgroups.push(newPgroup);
      nextPgroupCandidate += 1;
    }

    // 构建已重新映射 pgroup 的 MapProject，与现有项目合并
    const merged: MapProject = {
      regions: { ...project.value.regions },
      grids: { ...project.value.grids },
      tiles: { ...project.value.tiles },
    };

    for (const [oldPgroup, newPgroup] of oldToNew) {
      const region = next.regions[oldPgroup];
      const grid = next.grids[oldPgroup];
      const tilesInRegion = next.tiles[oldPgroup];
      if (!region || !grid) continue;
      merged.regions[newPgroup] = JSON.parse(JSON.stringify(region));
      merged.grids[newPgroup] = JSON.parse(JSON.stringify(grid));
      merged.tiles[newPgroup] = tilesInRegion ? JSON.parse(JSON.stringify(tilesInRegion)) : {};
    }

    // 重新映射 next_region / prev_region / exit_links.to_pgroup
    for (const newPgroup of newPgroups) {
      const region = merged.regions[newPgroup];
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

    // 全量替换 graph-store（旧节点清空 + 新合并 MapProject 装配）
    clearWorldNodes();
    applyProjectToGraph(merged);

    isDirty.value = true;
    updatedAt.value = Date.now();
    scheduleAutosave();
    return newPgroups;
  }

  function clearProject(): void {
    clearWorldNodes();
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
    } catch {
      /* ignore */
    }
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

  // ─── 区域 CRUD（内部操作 graph-store） ────────────────

  /**
   * 新增区域
   *
   * @param name 区域名（默认"新区域 N"）
   * @param cols 列数（1-254）
   * @param rows 行数（1-254）
   * @returns 新 pgroup，已达上限返回 null
   *
   * 同步实现（P0-P4）：graph-store.upsertNode 同步。
   */
  function addRegion(name?: string, cols: number = 8, rows: number = 6): Pgroup | null {
    const pgroup = nextPgroup();
    if (pgroup === null) return null;
    const safeCols = Math.min(Math.max(Math.floor(cols), COLS_ROWS_MIN), COLS_ROWS_MAX);
    const safeRows = Math.min(Math.max(Math.floor(rows), COLS_ROWS_MIN), COLS_ROWS_MAX);
    const regionName = name ?? `新区域 ${regionCount.value + 1}`;
    const region = makeDefaultRegion(regionName, safeCols, safeRows);
    const regionData: WorldRegionData = { ...region, pgroup };
    graph.upsertNode({
      kind: 'world.region',
      id: String(pgroup),
      data: regionData,
      source: [
        {
          filePath: 'oblivions/gamedata/map.php',
          lineStart: 1,
          lineEnd: 1,
          format: 'php',
        },
      ],
      revision: '',
    });
    currentPgroup.value = pgroup;
    selectedPls.value = null;
    markDirty();
    return pgroup;
  }

  /**
   * 新增预生成区域（M8 单区域生成器调用入口）
   *
   * 与 addRegion 的区别：
   *   - addRegion 创建空区域（cols × rows 网格，无 tiles）
   *   - addGeneratedRegion 接收生成器产出的预生成 region + tiles，直接写入 graph-store
   *
   * pgroup 自动分配（max+1，达上限返回 null）
   * 深拷贝 region/tiles 避免外部 mutation 影响 state
   * 同步写入 region.cols/rows 与 grids.cols/rows（保持冗余字段一致）
   * 切换 currentPgroup 到新区域 + 清空 selectedPls
   *
   * @param region 生成器产出的 Region 对象（pgroup 字段会被忽略，由本方法分配）
   * @param tiles  生成器产出的 tiles 字典
   * @returns 新 pgroup，已达上限返回 null
   *
   * 同步实现（P0-P4）：graph-store.applyNodeBatch 同步。
   */
  function addGeneratedRegion(
    region: Region,
    tiles: Record<Pls, Tile>,
  ): Pgroup | null {
    const pgroup = nextPgroup();
    if (pgroup === null) return null;
    // 构造一个仅含新区域的 MapProject，再通过 assembleWorldResources 装配为节点 + 边
    const singleRegionProject: MapProject = {
      regions: { [pgroup]: JSON.parse(JSON.stringify(region)) },
      grids: { [pgroup]: makeDefaultGrid(region.cols, region.rows) },
      tiles: { [pgroup]: JSON.parse(JSON.stringify(tiles)) },
    };
    // 修复 region 的 pgroup 字段（assembleWorldResources 会读取）
    (singleRegionProject.regions[pgroup] as WorldRegionData).pgroup = pgroup;
    const { nodes: regionTileNodes, edges } = assembleWorldResources(singleRegionProject);
    graph.applyNodeBatch(regionTileNodes, edges);
    currentPgroup.value = pgroup;
    selectedPls.value = null;
    markDirty();
    return pgroup;
  }

  /**
   * 删除区域
   *
   * 清理其他区域对该区域的引用：next_region / prev_region / exit_links
   * 内部级联清理该区域下所有 world.tile 节点（由 graph.removeNode 自动处理边）
   *
   * 同步实现（P0-P4）：graph-store.removeNode / updateRegion 同步。
   */
  function deleteRegion(pgroup: Pgroup): void {
    const region = project.value.regions[pgroup];
    if (!region) return;

    // 先收集其他区域对该区域的引用，准备 patch
    const patches: Array<{ pgroup: Pgroup; patch: Partial<Region> }> = [];
    for (const pgKey of Object.keys(project.value.regions)) {
      const pg = Number(pgKey) as Pgroup;
      if (pg === pgroup) continue;
      const r = project.value.regions[pg];
      if (!r) continue;
      const patch: Partial<Region> = {};
      if (r.next_region === pgroup) patch.next_region = null;
      if (r.prev_region === pgroup) patch.prev_region = null;
      const newExitLinks = r.exit_links.filter((l) => l.to_pgroup !== pgroup);
      if (newExitLinks.length !== r.exit_links.length) {
        patch.exit_links = newExitLinks;
      }
      if (Object.keys(patch).length > 0) {
        patches.push({ pgroup: pg, patch });
      }
    }

    // 移除该区域下所有 tile 节点（先于 region 删除，避免 region 删除时 cascadedEdges 重复处理）
    const regionNodeId = `world.region:${pgroup}`;
    const tileNodes = graph.findChildren(regionNodeId);
    for (const tileNode of tileNodes) {
      graph.removeNode(tileNode.kind + ':' + tileNode.id);
    }
    // 移除 region 节点本身
    graph.removeNode(regionNodeId);

    // 应用其他 region 的 patch
    for (const { pgroup: pg, patch } of patches) {
      updateRegion(pg, patch);
    }

    if (currentPgroup.value === pgroup) {
      const firstPgroup = Object.keys(project.value.regions)
        .map(Number)
        .sort((a, b) => a - b)[0];
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
   *
   * 同步实现（P0-P4）：graph-store.upsertNode 同步。
   */
  function updateRegion(pgroup: Pgroup, patch: Partial<Region>): void {
    const region = project.value.regions[pgroup];
    if (!region) return;
    const merged: WorldRegionData = { ...region, pgroup, ...patch };

    // next_region 双向同步
    if (patch.next_region !== undefined && patch.next_region !== null) {
      const target = project.value.regions[patch.next_region];
      if (target) {
        // 清理原 target 的 prev_region 反指
        if (target.prev_region !== null && target.prev_region !== pgroup) {
          const oldPrev = project.value.regions[target.prev_region];
          if (oldPrev && oldPrev.next_region === patch.next_region) {
            updateRegion(target.prev_region, { next_region: null });
          }
        }
        // 设置 target.prev_region = pgroup
        const targetMerged: WorldRegionData = { ...target, pgroup: patch.next_region, prev_region: pgroup };
        graph.upsertNode({
          kind: 'world.region',
          id: String(patch.next_region),
          data: targetMerged,
          source: [
            {
              filePath: 'oblivions/gamedata/map.php',
              lineStart: 1,
              lineEnd: 1,
              format: 'php',
            },
          ],
          revision: '',
        });
      }
    }

    graph.upsertNode({
      kind: 'world.region',
      id: String(pgroup),
      data: merged,
      source: [
        {
          filePath: 'oblivions/gamedata/map.php',
          lineStart: 1,
          lineEnd: 1,
          format: 'php',
        },
      ],
      revision: '',
    });
    markDirty();
  }

  /**
   * 添加一条 exit_links 条目
   */
  function addExitLink(pgroup: Pgroup, link: ExitLink): void {
    const region = project.value.regions[pgroup];
    if (!region) return;
    updateRegion(pgroup, { exit_links: [...region.exit_links, { ...link }] });
  }

  /**
   * 更新指定索引的 exit_links 条目
   */
  function updateExitLink(pgroup: Pgroup, index: number, patch: Partial<ExitLink>): void {
    const region = project.value.regions[pgroup];
    if (!region) return;
    const link = region.exit_links[index];
    if (!link) return;
    const newLinks = region.exit_links.map((l, i) => (i === index ? { ...l, ...patch } : l));
    updateRegion(pgroup, { exit_links: newLinks });
  }

  /**
   * 删除指定索引的 exit_links 条目
   */
  function removeExitLink(pgroup: Pgroup, index: number): void {
    const region = project.value.regions[pgroup];
    if (!region) return;
    const newLinks = region.exit_links.filter((_, i) => i !== index);
    updateRegion(pgroup, { exit_links: newLinks });
  }

  // ─── 格 CRUD（内部操作 graph-store） ──────────────────

  /**
   * 新增格
   *
   * 同 (pgroup, x, y) 坐标唯一性：已存在则返回 null
   * 自动分配 pls（max+1），超上限返回 null
   * 自动调用 autoConnect 建立 8 方向连通（写入 adjacent_to 边）
   *
   * @param preset 画笔预设（floor / tide / passable / height / destructible）
   *
   * 同步实现（P0-P4）：graph-store.upsertNode / addEdge 同步。
   */
  function addTile(
    pgroup: Pgroup,
    x: number,
    y: number,
    preset?: { floor?: Floor; tide?: Tide; passable?: boolean; height?: number; destructible?: boolean; preset_safe?: boolean },
  ): Pls | null {
    // P1-E：检查 region 存在而非 tiles[pgroup]——新区域首次 addTile 时 tiles[pgroup] 还是 undefined
    if (!project.value.regions[pgroup]) return null;
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

    const tileData: WorldTileData = { ...tile, pgroup, pls };
    const tileNodeId = `world.tile:${pgroup}:${pls}`;
    const regionNodeId = `world.region:${pgroup}`;

    // 先 upsert 节点
    graph.upsertNode({
      kind: 'world.tile',
      id: `${pgroup}:${pls}`,
      data: tileData,
      source: [
        {
          filePath: `oblivions/gamedata/tiles/region_${pgroup}.php`,
          lineStart: 1,
          lineEnd: 1,
          format: 'php',
        },
      ],
      revision: '',
    });
    // 添加 contains 边：region → tile
    graph.addEdge('contains', regionNodeId, tileNodeId);

    // 自动连通：在 8 方向找已有格，建立 adjacent_to 边（对称去重 from < to）
    // P1-E：tiles[pgroup] 可能为 undefined（首次 addTile），使用 ?? {} 兜底
    const existingTiles: Record<Pls, Tile> = project.value.tiles[pgroup] ?? {};
    for (const plsKey of Object.keys(existingTiles)) {
      const otherPls = Number(plsKey) as Pls;
      if (otherPls === pls) continue;
      const other: Tile | undefined = existingTiles[otherPls];
      if (!other) continue;
      // _breaks 跳过：被显式断开的连通不重建
      if (tile._breaks?.includes(otherPls) || other._breaks?.includes(pls)) continue;
      const dx = Math.abs(other.x - x);
      const dy = Math.abs(other.y - y);
      if (dx <= 1 && dy <= 1 && (dx + dy) > 0) {
        // 邻接
        const otherNodeId = `world.tile:${pgroup}:${otherPls}`;
        // 对称去重：仅 from < to
        if (tileNodeId < otherNodeId) {
          graph.addEdge('adjacent_to', tileNodeId, otherNodeId);
        } else {
          graph.addEdge('adjacent_to', otherNodeId, tileNodeId);
        }
        // 同步更新内存中的 neighbors 数组（供派生 project 时使用）
        // 注意：projectFromGraph 不从 adjacent_to 边重建 neighbors，而是直接读取 tile.neighbors
        // 所以这里也需要更新 tile.neighbors——通过再次 upsert 实现
        const updatedTile = { ...tile, neighbors: [...tile.neighbors, otherPls] };
        const updatedOther = { ...other, neighbors: [...other.neighbors, pls] };
        tile.neighbors = updatedTile.neighbors;
        graph.upsertNode({
          kind: 'world.tile',
          id: `${pgroup}:${pls}`,
          data: { ...updatedTile, pgroup, pls },
          source: [
            {
              filePath: `oblivions/gamedata/tiles/region_${pgroup}.php`,
              lineStart: 1,
              lineEnd: 1,
              format: 'php',
            },
          ],
          revision: '',
        });
        graph.upsertNode({
          kind: 'world.tile',
          id: `${pgroup}:${otherPls}`,
          data: { ...updatedOther, pgroup, pls: otherPls },
          source: [
            {
              filePath: `oblivions/gamedata/tiles/region_${pgroup}.php`,
              lineStart: 1,
              lineEnd: 1,
              format: 'php',
            },
          ],
          revision: '',
        });
      }
    }

    markDirty();
    return pls;
  }

  /**
   * 删除格
   *
   * 清理连通关系（disconnectAll 等价于 removeNode 级联清理 adjacent_to 边）
   * + 清理邻居 tile 的 data.neighbors 引用（对称移除）
   * + 清理 region 中对该格的引用（entrance/exit_pls）
   *
   * 同步实现（P0-P4）：graph-store.removeNode / upsertNode / updateRegion 同步。
   */
  function deleteTile(pgroup: Pgroup, pls: Pls): void {
    const tileNodeId = `world.tile:${pgroup}:${pls}`;

    // 先收集邻居，用于清理 data.neighbors 引用（removeNode 后 graph 中无此 tile 数据）
    const tilesInRegion: Record<Pls, Tile> = project.value.tiles[pgroup] ?? {};
    const tile: Tile | undefined = tilesInRegion[pls];
    if (tile) {
      for (const neighborPls of tile.neighbors) {
        const neighborTile: Tile | undefined = tilesInRegion[neighborPls];
        if (!neighborTile) continue;
        const updatedNeighbor: Tile = {
          ...neighborTile,
          neighbors: neighborTile.neighbors.filter((p) => p !== pls),
        };
        graph.upsertNode({
          kind: 'world.tile',
          id: `${pgroup}:${neighborPls}`,
          data: { ...updatedNeighbor, pgroup, pls: neighborPls },
          source: [
            {
              filePath: `oblivions/gamedata/tiles/region_${pgroup}.php`,
              lineStart: 1,
              lineEnd: 1,
              format: 'php',
            },
          ],
          revision: '',
        });
      }
    }

    // removeNode 会级联清理 contains / adjacent_to 边
    graph.removeNode(tileNodeId);

    // 清理 region.entrance_pls / exit_pls 引用
    const region = project.value.regions[pgroup];
    if (region) {
      const patch: Partial<Region> = {};
      if (region.entrance_pls === pls) patch.entrance_pls = null;
      if (region.exit_pls === pls) patch.exit_pls = null;
      if (Object.keys(patch).length > 0) {
        updateRegion(pgroup, patch);
      }
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
   *
   * 同步实现（P0-P4）：graph-store.upsertNode / removeEdge / addEdge 同步。
   */
  function updateTile(pgroup: Pgroup, pls: Pls, patch: Partial<Tile>): void {
    const tilesInRegion = project.value.tiles[pgroup];
    if (!tilesInRegion) return;
    const oldTile = tilesInRegion[pls];
    if (!oldTile) return;
    const oldX = oldTile.x;
    const oldY = oldTile.y;
    const newTile: Tile = { ...oldTile, ...patch };

    if (
      (patch.x !== undefined && patch.x !== oldX) ||
      (patch.y !== undefined && patch.y !== oldY)
    ) {
      // 坐标变化：重建邻接关系
      // 1. 收集旧邻居（来自旧 tile.neighbors）
      const oldNeighbors = [...oldTile.neighbors];
      // 2. 清空 newTile.neighbors（重新计算）
      newTile.neighbors = [];
      // 3. upsert 新 tile
      graph.upsertNode({
        kind: 'world.tile',
        id: `${pgroup}:${pls}`,
        data: { ...newTile, pgroup, pls },
        source: [
          {
            filePath: `oblivions/gamedata/tiles/region_${pgroup}.php`,
            lineStart: 1,
            lineEnd: 1,
            format: 'php',
          },
        ],
        revision: '',
      });
      // 4. 移除旧 adjacent_to 边（与旧邻居）
      const thisNodeId = `world.tile:${pgroup}:${pls}`;
      for (const neighborPls of oldNeighbors) {
        const otherNodeId = `world.tile:${pgroup}:${neighborPls}`;
        // 边可能以任一方向存储
        const edge1Id = `adjacent_to:${thisNodeId}->${otherNodeId}`;
        const edge2Id = `adjacent_to:${otherNodeId}->${thisNodeId}`;
        graph.removeEdge(edge1Id);
        graph.removeEdge(edge2Id);
        // 同步移除邻居的 neighbors 引用
        const neighborTile = tilesInRegion[neighborPls];
        if (neighborTile) {
          const updatedNeighbor: Tile = {
            ...neighborTile,
            neighbors: neighborTile.neighbors.filter((p) => p !== pls),
          };
          graph.upsertNode({
            kind: 'world.tile',
            id: `${pgroup}:${neighborPls}`,
            data: { ...updatedNeighbor, pgroup, pls: neighborPls },
            source: [
              {
                filePath: `oblivions/gamedata/tiles/region_${pgroup}.php`,
                lineStart: 1,
                lineEnd: 1,
                format: 'php',
              },
            ],
            revision: '',
          });
        }
      }
      // 5. 重新计算 autoConnect（基于新坐标）
      // _breaks 跳过：被显式断开的连通不重建
      const newNeighbors: Pls[] = [];
      for (const plsKey of Object.keys(tilesInRegion)) {
        const otherPls = Number(plsKey) as Pls;
        if (otherPls === pls) continue;
        const other = tilesInRegion[otherPls];
        if (!other) continue;
        if (newTile._breaks?.includes(otherPls) || other._breaks?.includes(pls)) continue;
        const dx = Math.abs(other.x - newTile.x);
        const dy = Math.abs(other.y - newTile.y);
        if (dx <= 1 && dy <= 1 && (dx + dy) > 0) {
          newNeighbors.push(otherPls);
          const otherNodeId = `world.tile:${pgroup}:${otherPls}`;
          if (thisNodeId < otherNodeId) {
            graph.addEdge('adjacent_to', thisNodeId, otherNodeId);
          } else {
            graph.addEdge('adjacent_to', otherNodeId, thisNodeId);
          }
          // 同步更新邻居 neighbors
          const updatedNeighbor: Tile = {
            ...other,
            neighbors: [...other.neighbors, pls],
          };
          graph.upsertNode({
            kind: 'world.tile',
            id: `${pgroup}:${otherPls}`,
            data: { ...updatedNeighbor, pgroup, pls: otherPls },
            source: [
              {
                filePath: `oblivions/gamedata/tiles/region_${pgroup}.php`,
                lineStart: 1,
                lineEnd: 1,
                format: 'php',
              },
            ],
            revision: '',
          });
        }
      }
      // 6. 更新本 tile 的 neighbors
      newTile.neighbors = newNeighbors;
      graph.upsertNode({
        kind: 'world.tile',
        id: `${pgroup}:${pls}`,
        data: { ...newTile, pgroup, pls },
        source: [
          {
            filePath: `oblivions/gamedata/tiles/region_${pgroup}.php`,
            lineStart: 1,
            lineEnd: 1,
            format: 'php',
          },
        ],
        revision: '',
      });
    } else {
      // 坐标未变化：直接 upsert
      graph.upsertNode({
        kind: 'world.tile',
        id: `${pgroup}:${pls}`,
        data: { ...newTile, pgroup, pls },
        source: [
          {
            filePath: `oblivions/gamedata/tiles/region_${pgroup}.php`,
            lineStart: 1,
            lineEnd: 1,
            format: 'php',
          },
        ],
        revision: '',
      });
    }
    markDirty();
  }

  /**
   * 移动格坐标（select 工具拖拽）
   *
   * 若目标坐标已有其他格，移动失败返回 false（UI 提示）
   *
   * 同步实现（P0-P4）：updateTile 同步。
   */
  function moveTile(pgroup: Pgroup, pls: Pls, newX: number, newY: number): boolean {
    const tilesInRegion = project.value.tiles[pgroup];
    if (!tilesInRegion) return false;
    const tile = tilesInRegion[pls];
    if (!tile) return false;
    if (tile.x === newX && tile.y === newY) return true;
    const existing = findTileByCoord(pgroup, newX, newY);
    if (existing !== null && existing !== pls) return false;

    updateTile(pgroup, pls, { x: newX, y: newY });
    return true;
  }

  // ─── 连通图直接操作（break / restore 工具调用） ────────
  // 这些操作不走 historyStore（由 useToolActions 包装为 Command 时记录）
  // P1-E 设计：_breaks 字段在 world.tile 节点的 data._breaks 数组中增删 pls，
  // 不删除 adjacent_to 边（保留拓扑信息）；useOverlayRenderer 渲染时读 _breaks 决定视觉态

  function breakTileConnection(pgroup: Pgroup, pls1: Pls, pls2: Pls): void {
    const tilesInRegion = project.value.tiles[pgroup];
    if (!tilesInRegion) return;
    const t1 = tilesInRegion[pls1];
    const t2 = tilesInRegion[pls2];
    if (!t1 || !t2) return;
    // 更新 t1：neighbors 移除 pls2，_breaks 添加 pls2
    const newT1: Tile = {
      ...t1,
      neighbors: t1.neighbors.filter((p) => p !== pls2),
      _breaks: [...(t1._breaks ?? []), pls2],
    };
    const newT2: Tile = {
      ...t2,
      neighbors: t2.neighbors.filter((p) => p !== pls1),
      _breaks: [...(t2._breaks ?? []), pls1],
    };
    graph.upsertNode({
      kind: 'world.tile',
      id: `${pgroup}:${pls1}`,
      data: { ...newT1, pgroup, pls: pls1 },
      source: [
        {
          filePath: `oblivions/gamedata/tiles/region_${pgroup}.php`,
          lineStart: 1,
          lineEnd: 1,
          format: 'php',
        },
      ],
      revision: '',
    });
    graph.upsertNode({
      kind: 'world.tile',
      id: `${pgroup}:${pls2}`,
      data: { ...newT2, pgroup, pls: pls2 },
      source: [
        {
          filePath: `oblivions/gamedata/tiles/region_${pgroup}.php`,
          lineStart: 1,
          lineEnd: 1,
          format: 'php',
        },
      ],
      revision: '',
    });
    // 注意：不删除 adjacent_to 边——_breaks 是编辑器视觉态，拓扑邻接保留
    markDirty();
  }

  function restoreTileConnection(pgroup: Pgroup, pls1: Pls, pls2: Pls): void {
    const tilesInRegion = project.value.tiles[pgroup];
    if (!tilesInRegion) return;
    const t1 = tilesInRegion[pls1];
    const t2 = tilesInRegion[pls2];
    if (!t1 || !t2) return;
    // 检查坐标是否仍相邻（restore 前提）
    const dx = Math.abs(t1.x - t2.x);
    const dy = Math.abs(t1.y - t2.y);
    const adjacent = dx <= 1 && dy <= 1 && (dx + dy) > 0;
    const newT1Neighbors = adjacent && !t1.neighbors.includes(pls2)
      ? [...t1.neighbors, pls2]
      : t1.neighbors;
    const newT2Neighbors = adjacent && !t2.neighbors.includes(pls1)
      ? [...t2.neighbors, pls1]
      : t2.neighbors;
    const newT1: Tile = {
      ...t1,
      neighbors: newT1Neighbors,
      _breaks: (t1._breaks ?? []).filter((p) => p !== pls2),
    };
    const newT2: Tile = {
      ...t2,
      neighbors: newT2Neighbors,
      _breaks: (t2._breaks ?? []).filter((p) => p !== pls1),
    };
    graph.upsertNode({
      kind: 'world.tile',
      id: `${pgroup}:${pls1}`,
      data: { ...newT1, pgroup, pls: pls1 },
      source: [
        {
          filePath: `oblivions/gamedata/tiles/region_${pgroup}.php`,
          lineStart: 1,
          lineEnd: 1,
          format: 'php',
        },
      ],
      revision: '',
    });
    graph.upsertNode({
      kind: 'world.tile',
      id: `${pgroup}:${pls2}`,
      data: { ...newT2, pgroup, pls: pls2 },
      source: [
        {
          filePath: `oblivions/gamedata/tiles/region_${pgroup}.php`,
          lineStart: 1,
          lineEnd: 1,
          format: 'php',
        },
      ],
      revision: '',
    });
    markDirty();
  }

  // ─── undo/redo 快照 API ──────────────────────────────

  /**
   * 替换当前 world 子图为指定 MapProject 快照（用于 undo/redo 还原整体状态）。
   *
   * 旧 API（保留）：useToolActions 通过 createCommand + push 使用 MapProject 快照。
   * 内部清空所有 world 节点 + 重新装配。
   *
   * 注意：此 API 不通过 markDirty 触发 autosave，调用方负责后续 scheduleAutosave。
   *
   * 同步实现（P0-P4）：graph-store actions 同步。
   */
  function replaceProject(snapshot: MapProject): void {
    clearWorldNodes();
    applyProjectToGraph(snapshot);
    // 校验 currentPgroup / selectedPls 仍在快照中
    if (currentPgroup.value !== null && !snapshot.regions[currentPgroup.value]) {
      const first = Object.keys(snapshot.regions).map(Number).sort((a, b) => a - b)[0];
      currentPgroup.value = first !== undefined ? (first as Pgroup) : null;
      selectedPls.value = null;
    }
    if (currentPgroup.value !== null && selectedPls.value !== null) {
      const tilesInRegion = snapshot.tiles[currentPgroup.value];
      if (!tilesInRegion || !tilesInRegion[selectedPls.value]) {
        selectedPls.value = null;
      }
    }
    updatedAt.value = Date.now();
    scheduleAutosave();
  }

  /**
   * 同步版本 replaceProject（保留 API 兼容）：与 replaceProject 等价。
   *
   * 历史背景：P1-E 重构初期 graph-store 曾异步，replaceProject 是 async，
   * replaceProjectSync 是同步 wrapper。P0-P4 djb2 同步 hash 后两者行为完全一致。
   */
  function replaceProjectSync(snapshot: MapProject): void {
    replaceProject(snapshot);
  }

  /**
   * 取当前 MapProject 深拷贝快照（用于 undo/redo 旧 API）。
   */
  function snapshot(): MapProject {
    return cloneProject();
  }

  // ─── Graph 快照 API（新 historyStore 使用） ───────────

  /**
   * 取当前 world 子图的 GraphSnapshot（节点 + 边深拷贝）。
   *
   * 用于新 historyStore.executeGraph() 记录 before/after。
   * 仅包含 world.region / world.tile 节点与 contains / adjacent_to 边。
   */
  function graphSnapshot(): GraphSnapshot {
    const worldNodes = [
      ...graph.findNodesByKind('world.region'),
      ...graph.findNodesByKind('world.tile'),
    ];
    // 深拷贝节点，避免后续 mutation 影响快照
    const worldNodesCloned = JSON.parse(JSON.stringify(worldNodes)) as ResourceNode[];
    // Pinia setup store 中 ref 已自动解包：graph.edges 即 RelationshipEdge[]
    const worldEdgesCloned = graph.edges
      .filter((e: RelationshipEdge) => e.type === 'contains' || e.type === 'adjacent_to')
      .map((e: RelationshipEdge) => JSON.parse(JSON.stringify(e)) as RelationshipEdge);
    return { worldNodes: worldNodesCloned, worldEdges: worldEdgesCloned };
  }

  /**
   * 用 GraphSnapshot 替换当前 world 子图。
   *
   * 1. 清空所有 world.region / world.tile 节点（级联清理边）
   * 2. 批量写入快照中的节点 + 边
   *
   * 同步实现（P0-P4）：graph-store.applyNodeBatch 同步。
   */
  function replaceGraphSnapshot(snapshot: GraphSnapshot): void {
    clearWorldNodes();
    graph.applyNodeBatch(snapshot.worldNodes, snapshot.worldEdges);
    // 校验 currentPgroup / selectedPls 仍在快照中
    const regionIds = new Set(snapshot.worldNodes.filter((n) => n.kind === 'world.region').map((n) => Number(n.id)));
    if (currentPgroup.value !== null && !regionIds.has(currentPgroup.value)) {
      const sortedIds = [...regionIds].sort((a, b) => a - b);
      currentPgroup.value = sortedIds.length > 0 ? (sortedIds[0] as Pgroup) : null;
      selectedPls.value = null;
    }
    if (currentPgroup.value !== null && selectedPls.value !== null) {
      const tileIdToFind = `${currentPgroup.value}:${selectedPls.value}`;
      const tileExists = snapshot.worldNodes.some(
        (n) => n.kind === 'world.tile' && n.id === tileIdToFind,
      );
      if (!tileExists) {
        selectedPls.value = null;
      }
    }
    updatedAt.value = Date.now();
    scheduleAutosave();
  }

  return {
    // state
    projectName,
    createdAt,
    updatedAt,
    currentPgroup,
    selectedPls,
    isDirty,
    lastSaveError,
    usingIndexedDB,
    // getters
    project,
    regions,
    grids,
    tiles,
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
    loadProjectSync,
    appendProject,
    clearProject,
    setCurrentPgroup,
    setSelectedPls,
    markDirty,
    markSaved,
    setProjectName,
    loadFromStorage,
    doSave,
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
    // undo/redo 快照（旧 API：MapProject）
    replaceProject,
    replaceProjectSync,
    snapshot,
    // undo/redo 快照（新 API：GraphSnapshot）
    graphSnapshot,
    replaceGraphSnapshot,
    // 工具函数（导出供测试 / useToolActions 使用）
    nextPgroup,
    nextPls,
    findTileByCoord,
  };
});
