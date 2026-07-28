/**
 * @module O 内容工具箱
 * @framework O-4 Source Adapter
 *
 * 工作区加载器——P0 阶段唯一允许的"批量读"入口。
 *
 * 流程（执行案 §4.4.4）：
 *   1. 遍历 listKinds() 中所有已注册 kind
 *   2. 跳过 p0Loaded=false 的 kind（如 presentation.enemy 待 P4 装配）
 *   3. 对每个 kindSchema.sourceFiles 中的 spec：
 *      - 固定路径：直接 readFile
 *      - 模板路径（含 ${id}）：readDir 列目录，匹配前缀+后缀，提取 ID
 *   4. 调用 adapter-registry.parseFile() 解析为 ResourceNode[]
 *   5. 收集到 batch 后调用 graph-store.upsertNodes(batch)
 *   6. 调用 graph-store.rebuildIndexes()
 *   7. emit workspace:loaded 事件
 *
 * 约定：
 *   - 加载失败 emit 结构化 diagnostic（LoadDiagnostics），不抛异常阻断 UI
 *   - 加载完成后 emit workspace:loaded，O-6 总览页订阅此事件刷新覆盖率
 *   - P0 不构建 RelationshipEdge（P1+ 由 O-3 关系构建器从 refFields 派生）
 *   - Gateway 不可达时短路返回，避免后续每个文件都触发网络错误
 *
 * 集成时机（P0-H 任务）：main.ts 在 createApp + Pinia 装配后、mount 之前调用：
 *   ```ts
 *   registerAllKinds();          // O-2 注册 kind schema
 *   const app = createApp(App);
 *   app.use(createPinia());
 *   // 此时 Pinia 已就位，可以调用 useGraphStore()
 *   await loadWorkspace();       // O-4 装配 Resource Graph
 *   app.mount('#app');
 *   ```
 */

import { listKinds, getKindSchema } from '@/schema';
import type { KindSchema, SourceFileSpec } from '@/schema/types';
import { parseFile } from '@/adapters/adapter-registry';
import { useGraphStore } from '@/graph/graph-store';
import type { ResourceNode } from '@/graph/types';
import {
  parseMapPhp,
  parseRegionPhp,
  assembleMapProject,
  extractPgroupFromFilename,
  parsePhpArrayExt,
} from '@/shared/serializer/php-array-parser';
import { assembleWorldResources } from '@/graph/assemblers/world-assembler';
import { buildEffectFuncNodes } from '@/graph/edge-builders/effect-func-builder';
import { buildItemRecipeEdges } from '@/graph/edge-builders/item-recipe-edge-builder';
import { buildPoiLootEdges } from '@/graph/edge-builders/poi-loot-edge-builder';
import { buildEnemyScatterEdges } from '@/graph/edge-builders/enemy-scatter-edge-builder';
import {
  buildPoiInteractionsIndex,
  setPoiInteractionsIndex,
} from '@/graph/poi-interactions-index';
import type { Pgroup, Pls, Tile } from '@/shared/types/map';
import type { RelationshipEdge } from '@/graph/edge';
import {
  readFile,
  readDir,
  GatewayUnavailableError,
  type ClientOptions,
} from './gateway-client';

/**
 * 加载诊断——P0 阶段使用 console 兜底输出（debugBus 在 P0+ 后续任务接入）。
 * O-6 总览页根据 LoadResult.ok 与 parseFailures 渲染覆盖率与失败清单。
 */
export interface LoadDiagnostics {
  /** 解析失败的文件清单（filePath 为工作区相对路径） */
  parseFailures: Array<{ filePath: string; kind: string; error: string }>;
  /** Gateway 不可达——所有读取都失败，应提示用户启动 Gateway */
  gatewayUnavailable?: boolean;
  /** 已加载的文件总数（按 spec 计数，模板路径算 1 个 spec） */
  filesLoaded: number;
  /** 已加载的 ResourceNode 总数 */
  nodesLoaded: number;
  /** 已加载的 kind 清单（O-6 用于显示已装配 vs 待装配 kind） */
  kindsLoaded: string[];
}

export interface LoadResult {
  ok: boolean;
  diagnostics: LoadDiagnostics;
}

type WorkspaceLoadedListener = (result: LoadResult) => void;

const listeners = new Set<WorkspaceLoadedListener>();

/**
 * 订阅 workspace:loaded 事件。
 *
 * O-6 总览页通过此订阅刷新覆盖率；O-7 模板工作区通过此订阅初始化列表视图。
 * 返回取消订阅函数。
 */
export function onWorkspaceLoaded(listener: WorkspaceLoadedListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emitWorkspaceLoaded(result: LoadResult): void {
  for (const listener of listeners) {
    try {
      listener(result);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[O-4 loader] workspace:loaded listener error:', err);
    }
  }
}

/**
 * 加载工作区所有已注册 kind 的源文件，装配 Resource Graph。
 *
 * 调用前置条件：
 *   - registerAllKinds() 已调用（main.ts 负责）
 *   - adapter-registry 已注册内置适配器（adapter-registry.ts 模块加载时自动注册）
 *   - Pinia 已通过 app.use(createPinia()) 装配
 *
 * @param opts Gateway 客户端选项（dev/prod base url 切换）
 * @returns LoadResult；ok=false 时 diagnostics 包含失败原因
 */
export async function loadWorkspace(opts?: ClientOptions): Promise<LoadResult> {
  const diagnostics: LoadDiagnostics = {
    parseFailures: [],
    filesLoaded: 0,
    nodesLoaded: 0,
    kindsLoaded: [],
  };
  const batch: ResourceNode[] = [];

  let gatewayFailed = false;

  for (const kind of listKinds()) {
    const schema = getKindSchema(kind);
    if (!schema) continue;
    // 跳过 P0 阶段未装配的 kind（如 presentation.enemy 待 P4 新建 locale 文件后启用）
    if (schema.p0Loaded === false) continue;

    let kindHasAnySuccess = false;

    for (const spec of schema.sourceFiles) {
      try {
        const nodes = await loadFromSpec(spec, schema, opts);
        batch.push(...nodes);
        diagnostics.filesLoaded += 1;
        diagnostics.nodesLoaded += nodes.length;
        kindHasAnySuccess = true;
      } catch (err) {
        if (err instanceof GatewayUnavailableError) {
          gatewayFailed = true;
          break;
        }
        const error = err instanceof Error ? err.message : String(err);
        diagnostics.parseFailures.push({
          filePath: spec.path,
          kind: schema.kind,
          error,
        });
        // eslint-disable-next-line no-console
        console.warn(
          `[O-4 loader] 解析失败 kind='${schema.kind}' path='${spec.path}':`,
          err,
        );
      }
    }

    if (kindHasAnySuccess) {
      diagnostics.kindsLoaded.push(schema.kind);
    }

    if (gatewayFailed) break;
  }

  if (gatewayFailed) {
    diagnostics.gatewayUnavailable = true;
    const result: LoadResult = { ok: false, diagnostics };
    emitWorkspaceLoaded(result);
    return result;
  }

  // 批量写入 graph-store。Pinia 已由 main.ts 装配，此处 useGraphStore() 可安全调用。
  // graph-store actions 同步（P0-P4），无需 await；保留 async/await 是因 readFile 等仍异步。
  const graph = useGraphStore();
  graph.upsertNodes(batch);
  // P0 阶段不构建边（关系派生在 P1+），rebuildIndexes 仍调用以保持索引一致性。
  graph.rebuildIndexes();

  // —— world.region / world.tile 专用装配（P1 执行案 §4.1.1）——
  // 这两类 kind 的 p0Loaded=false，跳过通用 schema-driven 路径，由专用函数
  // 调用 parseMapPhp + parseRegionPhp + assembleMapProject + assembleWorldResources
  // 重建为标准形态节点（id=pgroup / id=pgroup:pls）+ contains/adjacent_to 边。
  if (!gatewayFailed) {
    const worldResult = await loadWorldResources(diagnostics, opts);
    if (worldResult !== null) {
      graph.applyNodeBatch(worldResult.nodes, worldResult.edges);
      // 重新构建索引，确保 contains / adjacent_to 边反向索引生效
      graph.rebuildIndexes();
    }
  }

  // —— effect.func 虚拟节点装配 + item/recipe 关系边构建（P2 §4.4）——
  // effect.func 通过 effect-func-builder 从 item.use_effects.func.php 提取，
  // 不走 O-4 adapter 通用路径（该文件是函数定义文件，不是数据文件）。
  // item/recipe/presentation 关系边（renders_as / consumes_* / produces_item / uses_effect）
  // 由 buildItemRecipeEdges 从节点列表派生，装配是纯函数。
  if (!gatewayFailed) {
    const p2Result = await loadEffectFuncAndItemRecipeEdges(diagnostics, opts);
    if (p2Result !== null) {
      graph.applyNodeBatch(p2Result.nodes, p2Result.edges);
      graph.rebuildIndexes();
    }
  }

  // —— POI / loot / distribution / presentation.poi 关系边构建（P3 §4.4）——
  // 所有 P3 kind 通过通用 schema-driven 路径加载（O-2 schema + O-4 adapter 已注册），
  // 此处仅从 graph-store 读取节点派生关系边，无新文件读取、无新节点产生。
  // 边类型：uses_loot_table / drops_item / dismantle_returns / mechanic_ref /
  //         distributed_by / renders_as。
  // selects_tiles 边由 O-8 分布工作区在 world.tile 加载后动态派生，不在此处装配。
  if (!gatewayFailed) {
    const p3Edges = buildPoiLootEdgesFromGraph();
    if (p3Edges.length > 0) {
      graph.applyNodeBatch([], p3Edges);
      graph.rebuildIndexes();
    }
  }

  // —— enemy / scatter / distribution.enemy / distribution.scatter / presentation.enemy
  //    关系边构建（P4 §4.4）——
  // 所有 P4 kind 通过通用 schema-driven 路径加载（O-2 schema + O-4 adapter 已注册），
  // 此处仅从 graph-store 读取节点派生关系边，无新文件读取、无新节点产生。
  // 边类型：spawned_by / distributed_by / consumes_skill / casts_skill / renders_as。
  // selects_tiles 边由 O-8 分布工作区在 world.tile 加载后动态派生，不在此处装配。
  if (!gatewayFailed) {
    const p4Edges = buildEnemyScatterEdgesFromGraph();
    if (p4Edges.length > 0) {
      graph.applyNodeBatch([], p4Edges);
      graph.rebuildIndexes();
    }
  }

  // —— poi_interactions.php 辅助索引构建（P3 §4.3.4）——
  // poi_interactions.php 不作为可编辑资源 kind 注册——不进入 ResourceNode 图，
  // 但 O-10 校验器需要其内容做引用闭合校验：
  //   - poi.template.mechanic=interact_* 时校验是否有对应 interaction 配置
  //   - poi_interactions.required_item 引用 item.template.id 校验引用闭合
  // 索引挂在 poi-interactions-index 模块级状态上，由 O-10 校验器读取。
  // 解析失败时不阻断工作区加载，仅记录 diagnostic。
  if (!gatewayFailed) {
    await loadPoiInteractionsIndex(diagnostics, opts);
  }

  const result: LoadResult = { ok: true, diagnostics };
  emitWorkspaceLoaded(result);
  return result;
}

/**
 * effect.func 虚拟节点装配 + item/recipe 关系边构建（P2 §4.4）
 *
 * 流程：
 *   1. 读取 oblivions/include/game/item/item.use_effects.func.php
 *   2. 调用 buildEffectFuncNodes 提取 effect.func 节点（预期 6 个）
 *   3. 调用 buildItemRecipeEdges 从当前 graph 中所有 item/recipe/presentation/effect.func
 *      节点派生 renders_as / consumes_* / produces_item / uses_effect 边
 *
 * 失败时记录 diagnostic 并返回 null；不抛异常阻断 UI。
 *
 * @returns 装配结果（nodes + edges）；Gateway 不可达或解析失败返回 null
 */
async function loadEffectFuncAndItemRecipeEdges(
  diagnostics: LoadDiagnostics,
  opts?: ClientOptions,
): Promise<{ nodes: ResourceNode[]; edges: RelationshipEdge[] } | null> {
  const EFFECT_FUNCS_PATH = 'oblivions/include/game/item/item.use_effects.func.php';

  // 1. 读取 item.use_effects.func.php
  let effectFuncContent: string;
  try {
    const resp = await readFile(EFFECT_FUNCS_PATH, opts);
    effectFuncContent = resp.content;
  } catch (err) {
    if (err instanceof GatewayUnavailableError) {
      diagnostics.gatewayUnavailable = true;
    } else {
      const error = err instanceof Error ? err.message : String(err);
      diagnostics.parseFailures.push({
        filePath: EFFECT_FUNCS_PATH,
        kind: 'effect.func',
        error,
      });
    }
    return null;
  }

  // 2. 提取 effect.func 节点
  const effectFuncNodes = buildEffectFuncNodes(EFFECT_FUNCS_PATH, effectFuncContent);
  if (effectFuncNodes.length === 0) {
    diagnostics.parseFailures.push({
      filePath: EFFECT_FUNCS_PATH,
      kind: 'effect.func',
      error: 'buildEffectFuncNodes 提取 0 个函数（预期 6 个）',
    });
    return null;
  }

  diagnostics.filesLoaded += 1;
  diagnostics.nodesLoaded += effectFuncNodes.length;
  diagnostics.kindsLoaded.push('effect.func');

  // 3. 构建 item/recipe/presentation 关系边
  //    从 graph-store 中读取所有相关 kind 节点 + 新装配的 effect.func 节点
  const graph = useGraphStore();
  const allNodes: ResourceNode[] = [
    ...graph.findNodesByKind('item.template'),
    ...graph.findNodesByKind('recipe.template'),
    ...graph.findNodesByKind('presentation.item'),
    ...graph.findNodesByKind('presentation.recipe'),
    ...effectFuncNodes,
  ];
  const edges = buildItemRecipeEdges(allNodes);

  return { nodes: effectFuncNodes, edges };
}

/**
 * POI / loot / distribution / presentation.poi 关系边构建（P3 §4.4）
 *
 * 不需要读取新文件——所有 P3 kind（poi.template / loot.table / distribution.poi /
 * presentation.poi）已通过通用 schema-driven 路径加载到 graph-store。
 * 此函数仅从 graph-store 读取节点，调用 buildPoiLootEdges 派生关系边。
 *
 * 不产生新节点——边由现有节点派生，调用方 applyNodeBatch([], edges)。
 *
 * 边类型：uses_loot_table / drops_item / dismantle_returns / mechanic_ref /
 *         distributed_by / renders_as。
 * selects_tiles 边由 O-8 分布工作区在叠层激活时单独触发（buildSelectsTilesEdges）。
 *
 * @returns P3 关系边数组
 */
function buildPoiLootEdgesFromGraph(): RelationshipEdge[] {
  const graph = useGraphStore();
  const allNodes: ResourceNode[] = [
    ...graph.findNodesByKind('poi.template'),
    ...graph.findNodesByKind('loot.table'),
    ...graph.findNodesByKind('distribution.poi'),
    ...graph.findNodesByKind('presentation.poi'),
  ];
  return buildPoiLootEdges(allNodes);
}

/**
 * enemy / scatter / distribution.enemy / distribution.scatter / presentation.enemy
 * 关系边构建（P4 §4.4）
 *
 * 不需要读取新文件——所有 P4 kind（enemy.template / distribution.enemy /
 * distribution.scatter / presentation.enemy）已通过通用 schema-driven 路径加载到
 * graph-store。此函数仅从 graph-store 读取节点，调用 buildEnemyScatterEdges 派生关系边。
 *
 * 不产生新节点——边由现有节点派生，调用方 applyNodeBatch([], edges)。
 *
 * 边类型：spawned_by / distributed_by / consumes_skill / casts_skill / renders_as。
 * selects_tiles 边由 O-8 分布工作区在叠层激活时单独触发（buildEnemyScatterSelectsTilesEdges）。
 *
 * @returns P4 关系边数组
 */
function buildEnemyScatterEdgesFromGraph(): RelationshipEdge[] {
  const graph = useGraphStore();
  const allNodes: ResourceNode[] = [
    ...graph.findNodesByKind('enemy.template'),
    ...graph.findNodesByKind('distribution.enemy'),
    ...graph.findNodesByKind('distribution.scatter'),
    ...graph.findNodesByKind('presentation.enemy'),
  ];
  return buildEnemyScatterEdges(allNodes);
}

/**
 * poi_interactions.php 辅助索引构建（P3 §4.3.4）
 *
 * 流程：
 *   1. 读取 oblivions/gamedata/poi_interactions.php
 *   2. 调用 parsePhpArrayExt 解析为 PhpValue（key=interaction_id, value=配置）
 *   3. 调用 buildPoiInteractionsIndex 构建两个映射表
 *   4. 调用 setPoiInteractionsIndex 写入模块级状态
 *
 * 失败时记录 diagnostic 并返回——不抛异常阻断 UI。
 * Gateway 不可达时不在此处标记 gatewayUnavailable（已由前置加载步骤标记，
 * 此函数仅在 !gatewayFailed 时被调用，但 readFile 仍可能失败）。
 *
 * 不进入 ResourceNode 图——poi_interactions 不是可编辑资源 kind，
 * 索引仅供 O-10 校验器与 O-7 删除保护查询。
 */
async function loadPoiInteractionsIndex(
  diagnostics: LoadDiagnostics,
  opts?: ClientOptions,
): Promise<void> {
  const POI_INTERACTIONS_PATH = 'oblivions/gamedata/poi_interactions.php';

  let content: string;
  try {
    const resp = await readFile(POI_INTERACTIONS_PATH, opts);
    content = resp.content;
  } catch (err) {
    if (err instanceof GatewayUnavailableError) {
      diagnostics.gatewayUnavailable = true;
    } else {
      const error = err instanceof Error ? err.message : String(err);
      diagnostics.parseFailures.push({
        filePath: POI_INTERACTIONS_PATH,
        kind: 'poi_interactions',
        error,
      });
    }
    return;
  }

  const result = parsePhpArrayExt(content);
  if (!result.ok || result.value === null) {
    diagnostics.parseFailures.push({
      filePath: POI_INTERACTIONS_PATH,
      kind: 'poi_interactions',
      error: 'parsePhpArrayExt 解析失败',
    });
    return;
  }

  const index = buildPoiInteractionsIndex(result.value);
  setPoiInteractionsIndex(index);
  diagnostics.filesLoaded += 1;
}

/**
 * world.region / world.tile 专用装配（P1 执行案 §4.1.1）
 *
 * 流程：
 *   1. 读取 oblivions/gamedata/map.php，调用 parseMapPhp 得到 regions/grids
 *   2. 读取 oblivions/gamedata/tiles/ 目录，对每个 region_${pgroup}.php 调用 parseRegionPhp
 *   3. 调用 assembleMapProject 合并为完整 MapProject
 *   4. 调用 assembleWorldResources 转换为 ResourceNode[] + RelationshipEdge[]
 *
 * 失败时记录 diagnostic 并返回 null；不抛异常阻断 UI。
 *
 * @returns 装配结果（nodes + edges）；Gateway 不可达或解析失败返回 null
 */
async function loadWorldResources(
  diagnostics: LoadDiagnostics,
  opts?: ClientOptions,
): Promise<{ nodes: ResourceNode[]; edges: RelationshipEdge[] } | null> {
  const MAP_PHP_PATH = 'oblivions/gamedata/map.php';
  const TILES_DIR = 'oblivions/gamedata/tiles/';

  // 1. 读取 map.php
  let mapPhpContent: string;
  try {
    const resp = await readFile(MAP_PHP_PATH, opts);
    mapPhpContent = resp.content;
  } catch (err) {
    if (err instanceof GatewayUnavailableError) {
      diagnostics.gatewayUnavailable = true;
    } else {
      const error = err instanceof Error ? err.message : String(err);
      diagnostics.parseFailures.push({
        filePath: MAP_PHP_PATH,
        kind: 'world.region',
        error,
      });
    }
    return null;
  }

  // 2. 解析 map.php → regions/grids（tiles 待填充）
  const mapParsed = parseMapPhp(mapPhpContent);
  if (mapParsed === null) {
    diagnostics.parseFailures.push({
      filePath: MAP_PHP_PATH,
      kind: 'world.region',
      error: 'parseMapPhp 返回 null',
    });
    return null;
  }

  // 3. 读取 tiles/ 目录，找出所有 region_*.php
  let tilesEntries: { name: string; type: 'file' | 'dir' }[];
  try {
    const dirResp = await readDir(TILES_DIR, false, opts);
    tilesEntries = dirResp.entries as { name: string; type: 'file' | 'dir' }[];
  } catch (err) {
    if (err instanceof GatewayUnavailableError) {
      diagnostics.gatewayUnavailable = true;
    } else {
      const error = err instanceof Error ? err.message : String(err);
      diagnostics.parseFailures.push({
        filePath: TILES_DIR,
        kind: 'world.tile',
        error,
      });
    }
    return null;
  }

  // 4. 对每个 region_${pgroup}.php 调用 parseRegionPhp
  const regionResults: Array<{ pgroup: Pgroup; tiles: Record<Pls, Tile> }> = [];
  let tilesLoadedCount = 0;
  for (const entry of tilesEntries) {
    if (entry.type !== 'file') continue;
    const pgroup = extractPgroupFromFilename(entry.name);
    if (pgroup === null) continue;
    const filePath = `${TILES_DIR}${entry.name}`;
    try {
      const fileResp = await readFile(filePath, opts);
      const regionParsed = parseRegionPhp(fileResp.content, pgroup);
      if (regionParsed !== null) {
        regionResults.push(
          regionParsed as { pgroup: Pgroup; tiles: Record<Pls, Tile> },
        );
        tilesLoadedCount += 1;
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      diagnostics.parseFailures.push({
        filePath,
        kind: 'world.tile',
        error,
      });
    }
  }

  // 5. assembleMapProject + assembleWorldResources
  const mapProject = assembleMapProject(mapParsed, regionResults);
  const { nodes, edges } = assembleWorldResources(mapProject);

  // 6. 更新 diagnostics
  diagnostics.filesLoaded += 1 + tilesLoadedCount;
  diagnostics.nodesLoaded += nodes.length;
  diagnostics.kindsLoaded.push('world.region', 'world.tile');

  return { nodes, edges };
}

/**
 * 加载单个 sourceFiles spec 对应的文件，解析为 ResourceNode[]
 *
 * 路由：
 *   - 固定路径（无 ${id}）：直接 readFile
 *   - 模板路径（含 ${id}）：readDir 找出所有匹配文件，提取 ID 后逐个读取
 */
async function loadFromSpec(
  spec: SourceFileSpec,
  schema: KindSchema,
  opts?: ClientOptions,
): Promise<ResourceNode[]> {
  if (spec.path.includes('${id}')) {
    return await loadTemplatePath(spec, schema, opts);
  }
  // 固定路径
  const filePath = spec.path;
  const response = await readFile(filePath, opts);
  return parseFile(filePath, response.content, schema);
}

/**
 * 处理模板路径（如 oblivions/gamedata/tiles/region_${id}.php）
 *
 * 1. 把 path 拆分为 dirPath + filenamePrefix + ${id} + filenameSuffix
 * 2. readDir(dirPath) 列出所有文件
 * 3. 对每个匹配 prefix + suffix 的文件，提取 ID 部分作为 extractedId
 * 4. 逐个 readFile + parseFile，extractedId 用于模板路径下 ID 前缀生成（见 php-adapter splitByLoad）
 */
async function loadTemplatePath(
  spec: SourceFileSpec,
  schema: KindSchema,
  opts?: ClientOptions,
): Promise<ResourceNode[]> {
  const placeholder = '${id}';
  const placeholderIdx = spec.path.indexOf(placeholder);
  if (placeholderIdx === -1) {
    // 不应进入此分支（loadFromSpec 已判断），防御性返回空
    return [];
  }

  const beforePlaceholder = spec.path.substring(0, placeholderIdx);
  const filenameSuffix = spec.path.substring(placeholderIdx + placeholder.length);

  const lastSlashIdx = beforePlaceholder.lastIndexOf('/');
  // dirPath 末尾含 '/'，便于与 entry.name 拼接
  const dirPath = lastSlashIdx >= 0 ? beforePlaceholder.substring(0, lastSlashIdx + 1) : '';
  const filenamePrefix = lastSlashIdx >= 0
    ? beforePlaceholder.substring(lastSlashIdx + 1)
    : beforePlaceholder;

  const response = await readDir(dirPath, false, opts);
  const allNodes: ResourceNode[] = [];

  for (const entry of response.entries) {
    if (entry.type !== 'file') continue;
    if (!entry.name.startsWith(filenamePrefix)) continue;
    if (!entry.name.endsWith(filenameSuffix)) continue;
    // 排除 prefix+suffix 本身长度等于文件名的退化情况（ID 为空）
    if (entry.name.length <= filenamePrefix.length + filenameSuffix.length) continue;

    const idStr = entry.name.substring(
      filenamePrefix.length,
      entry.name.length - filenameSuffix.length,
    );
    if (!idStr) continue;

    const filePath = `${dirPath}${entry.name}`;
    const fileResp = await readFile(filePath, opts);
    // extractedId 用于 map-keyed load 下的 ID 前缀，避免跨文件 ID 冲突
    // （如 tile 1-1 / 1-2 / 2-1，见 php-adapter splitByLoad）
    const nodes = parseFile(filePath, fileResp.content, schema, idStr);
    allNodes.push(...nodes);
  }

  return allNodes;
}
