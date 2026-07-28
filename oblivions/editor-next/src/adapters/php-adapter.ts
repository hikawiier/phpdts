/**
 * @module O 内容工具箱
 * @framework O-4 Source Adapter
 *
 * PHP 通用适配器——把 oblivions/gamedata/*.php 解析为 ResourceNode[]。
 *
 * 覆盖两种 parser：
 *   - 'php-array'       — `return [...]` / `return array(...)` 形态（13 个根级 PHP）
 *   - 'php-global-var'  — `$var = array(...)` / `$var = [...]` 形态（enemies_config.php 唯一）
 *
 * 两种 parser 共用 parsePhpArrayExt（自动识别四种形态），区别仅在 codegen
 * 阶段是否输出 `$var = ...` 前缀。P0 阶段 serializePhpResource 返回空数组
 * （P0 只读路径，P1 阶段实现写路径）。
 *
 * 切分策略（由 kindSchema.sourceFiles[0].load 决定）：
 *   - 'single'       — 整文件作为单个 ResourceNode，id='default'
 *   - 'map-keyed'    — 每个顶层 key 是一个 ResourceNode
 *   - 'partitioned'  — 按顶层 key（如 tide 桶）切分：
 *                       * 默认行为：每个 key 一个 ResourceNode（id=tide, data=桶内容）
 *                       * distribution.poi 特例（P3 §4.3.3）：每个桶内 entry 投影为
 *                         DistributionRule 统一模型节点，id=`${tide}:${poi_id}`，
 *                         data 含 'subject.poi_id' / 'selector.tides' 等字段
 *
 * 模板路径（如 `oblivions/gamedata/tiles/region_${id}.php`）的 extractedId
 * 在 map-keyed load 下作为 ID 前缀，避免跨文件 ID 冲突（如 tile 1-1 / 1-2 / 2-1）。
 *
 * P3 §4.3.1 poi_table.php / §4.3.2 loot_tables.php 走标准 map-keyed 路径，
 * mechanic_params 数组、count 多态（int | [min,max]）、durability_decay bool
 * 均由 parsePhpArrayExt 原样保留，schema 层负责类型转换。
 */

import { parsePhpArrayExt, type PhpValue } from '../shared/serializer/php-array-parser';
import {
  generateMapPhp,
  generateRegionPhp,
} from '../shared/serializer/php-codegen';
import type { Region, Grid, Tile, Pgroup, Pls } from '../shared/types/map';
import type {
  WorldRegionData,
  WorldTileData,
} from '../graph/assemblers/world-assembler';
import type { KindSchema, SourceFileSpec } from '../schema/types';
import type { ResourceNode } from '../graph/types';
import type { SourceAnchor } from '../graph/edge';
// P3/P4/P5 投影器（执行案 §4.7.2 / §4.3.2）——poi.template / loot.table / distribution.poi /
// enemy.template / distribution.enemy / distribution.scatter / item.template /
// recipe.template / config.runtime / combat.skill / skill.definition 走独立投影器，
// 不复用 generateMapPhp / generateRegionPhp / generateConfigPhp 通用 codegen。
// projector 仅 import type SerializedPhpFile（编译时擦除），无运行时循环依赖。
import { projectPoiTable } from '../build/projectors/poi-table-projector';
import { projectLootTable } from '../build/projectors/loot-table-projector';
import { projectPoiPool } from '../build/projectors/poi-pool-projector';
import { projectEnemiesConfig } from '../build/projectors/enemies-config-projector';
import { projectEnemyPool } from '../build/projectors/enemy-pool-projector';
import { projectScatterPool } from '../build/projectors/scatter-pool-projector';
import { projectItemTable } from '../build/projectors/item-table-projector';
import { projectRecipeTable } from '../build/projectors/recipe-table-projector';
import { projectOblConfig } from '../build/projectors/obl-config-projector';
import { projectCombatSkillConfig } from '../build/projectors/combat-skill-config-projector';
import { projectSkillDefinitionConfig } from '../build/projectors/skill-definition-config-projector';

/**
 * 序列化后的文件形态——P1 阶段实现写路径时使用。
 */
export interface SerializedPhpFile {
  filePath: string;
  content: string;
}

/**
 * 解析 PHP 文件内容为 ResourceNode[]
 *
 * @param filePath 工作区相对路径（如 'oblivions/gamedata/item_table.php'）
 * @param content PHP 文件完整内容
 * @param kindSchema 资源 kind 的 schema 契约
 * @param extractedId 模板路径提取的 ID（如 region_1.php → '1'）；固定路径不传
 */
export function parsePhpResource(
  filePath: string,
  content: string,
  kindSchema: KindSchema,
  extractedId?: string,
): ResourceNode[] {
  const spec = kindSchema.sourceFiles[0];
  if (!spec) return [];

  const result = parsePhpArrayExt(content);
  if (!result.ok || result.value === null) {
    // 解析失败：返回空数组，loader 层会记录诊断
    return [];
  }

  const sourceAnchor: SourceAnchor = {
    filePath,
    // P0 阶段不计算精确行号；P1+ 阶段由 O-7 详情页按需派生
    lineStart: 0,
    lineEnd: 0,
    format: 'php',
  };

  return splitByLoad(result.value, spec, kindSchema, sourceAnchor, extractedId);
}

/**
 * 按 kindSchema.sourceFiles[0].load 切分 PhpValue 为 ResourceNode[]
 *
 * single 模式下：
 *   - 优先使用 spec.singleNodeId 作为节点 ID（schema 契约优先）
 *   - 若 schema.fields 长度为 1 且 type='kv-list'，则把 PHP 字典包装到该字段下
 *     （config.runtime 节点 data 形态：{ entries: {...obl_config...} }）
 *   - 否则 data 直接是 PHP 解析结果（保持向后兼容）
 */
function splitByLoad(
  value: PhpValue,
  spec: SourceFileSpec,
  kindSchema: KindSchema,
  source: SourceAnchor,
  extractedId?: string,
): ResourceNode[] {
  switch (spec.load) {
    case 'single': {
      // 优先使用 schema 声明的 singleNodeId，否则回退到 'default'
      const id = spec.singleNodeId ?? 'default';
      // 若 schema.fields 只有一个 kv-list 字段，则把 PHP 字典包装到该字段下
      // （config.runtime 的 data 形态应是 { entries: {...} }，而非裸 obl_config 字典）
      const singleField = kindSchema.fields.length === 1 ? kindSchema.fields[0] : undefined;
      const shouldWrap =
        singleField !== undefined && singleField.type === 'kv-list';
      const data = shouldWrap ? { [singleField!.key]: value } : value;
      return [
        {
          kind: kindSchema.kind,
          id,
          data,
          source: [source],
          revision: '',
        },
      ];
    }

    case 'map-keyed': {
      // 每个顶层 key 是一个 ResourceNode
      if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
      const obj = value as Record<string, PhpValue>;
      const nodes: ResourceNode[] = [];
      for (const [key, val] of Object.entries(obj)) {
        // 模板路径（如 region_${id}.php）下，extractedId 是区域 pgroup，
        // 文件内每个 pls 是区域内局部索引。用 `${extractedId}:${pls}` 作为
        // 全局唯一 ID（与 world.tile schema idPattern /^\d+:\d+$/ 对齐），
        // 避免跨区域 pls 冲突。projectStore.deleteTile 等编辑操作按此 ID 寻址。
        const id = extractedId !== undefined ? `${extractedId}:${key}` : key;
        nodes.push({
          kind: kindSchema.kind,
          id,
          data: val,
          source: [source],
          revision: '',
        });
      }
      return nodes;
    }

    case 'partitioned': {
      // 按顶层 key（如 tide 桶）切分。
      // distribution.enemy / distribution.scatter 按 P4 §4.3.3 投影为统一模型——
      // 每个桶内 entry 一个节点，id=`${tide}:${subject_id}`（enemy）或
      // `${tide}:${phase}:${item_id}`（scatter），data 含 'subject.*' / 'selector.tides'
      // 等字段（匹配 schema idPattern 与 O-3 边构建器的统一模型形状分支）。
      // distribution.poi 按 P3 §4.3.3 同样投影为统一模型——每个桶内 entry 一个节点，
      // id=`${tide}:${poi_id}`。
      if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
      const obj = value as Record<string, PhpValue>;
      if (kindSchema.kind === 'distribution.poi') {
        return projectDistributionPoi(obj, kindSchema, source);
      }
      if (kindSchema.kind === 'distribution.enemy') {
        return projectDistributionEnemy(obj, kindSchema, source);
      }
      if (kindSchema.kind === 'distribution.scatter') {
        return projectDistributionScatter(obj, kindSchema, source);
      }
      const nodes: ResourceNode[] = [];
      for (const [tide, val] of Object.entries(obj)) {
        nodes.push({
          kind: kindSchema.kind,
          id: tide,
          data: val,
          source: [source],
          revision: '',
        });
      }
      return nodes;
    }

    default:
      return [];
  }
}

/**
 * 把 poi_pool.php 的 tide 桶结构投影为 distribution.poi 统一模型节点（P3 §4.3.3）
 *
 * 输入形态（PHP 解析结果）：
 *   {
 *     shallow: [{ poi_id: 'supply_cache', per_region: 2 }, ...],
 *     deep:    [...],
 *     abyss:   [...],
 *   }
 *
 * 输出形态：每个 entry 投影为一个 distribution.poi 节点
 *   - id: `${tide}:${poi_id}`（匹配 schema idPattern `/^(shallow|deep|abyss):[a-z][a-z0-9_]*$/`）
 *   - data: DistributionRule 统一模型字段（与 distribution-poi.ts schema 字段 key 对齐）
 *
 * 字段映射：
 *   - 'subject.poi_id'        = entry.poi_id
 *   - 'selector.tides'        = [tide]（当前运行时契约每条规则只有一个 tide）
 *   - 'selector.regions'      = []（留空=所有区域，运行时不支持 per-region 过滤）
 *   - 'selector.excludeEntrance' = true（对齐 J-1 / E-9 运行时默认）
 *   - 'selector.excludeExit'    = true（同上）
 *   - 'placement.count'       = entry.per_region
 *
 * schema 字段 key 含点号（如 'subject.poi_id'）是约定——O-3 边构建器按字面 key 读取，
 * 不解释为嵌套对象。这与 distribution-poi.ts schema fields[].key 字段名一致。
 *
 * tide 桶 key 顺序保留（shallow → deep → abyss），桶内条目顺序保留——
 * O-5 投影器在序列化回 poi_pool.php 时按此顺序输出。
 *
 * 边界：
 *   - entry.poi_id 缺失或非字符串时跳过该 entry
 *   - entry.per_region 缺失时默认 1（与 schema default 对齐）
 *   - tide 桶 value 非数组时跳过该桶
 */
function projectDistributionPoi(
  tideBuckets: Record<string, PhpValue>,
  kindSchema: KindSchema,
  source: SourceAnchor,
): ResourceNode[] {
  const nodes: ResourceNode[] = [];
  for (const [tide, entries] of Object.entries(tideBuckets)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const e = entry as { poi_id?: PhpValue; per_region?: PhpValue };
      if (typeof e.poi_id !== 'string') continue;
      const poiId = e.poi_id;
      const perRegion = typeof e.per_region === 'number' ? e.per_region : 1;
      nodes.push({
        kind: kindSchema.kind,
        id: `${tide}:${poiId}`,
        data: {
          'subject.poi_id': poiId,
          'selector.tides': [tide],
          'selector.regions': [],
          'selector.excludeEntrance': true,
          'selector.excludeExit': true,
          'placement.count': perRegion,
        },
        source: [source],
        revision: '',
      });
    }
  }
  return nodes;
}

/**
 * 把 enemy_pool.php 的 tide 桶结构投影为 distribution.enemy 统一模型节点（P4 §4.3.3）
 *
 * 输入形态（PHP 解析结果）：
 *   {
 *     shallow: [{ enemy_type: 1, count: [1,1] }, ...],
 *     deep:    [{ enemy_type: 2, count: [1,1] }, ...],
 *     abyss:   [...],
 *   }
 *
 * 输出形态：每个 entry 投影为一个 distribution.enemy 节点
 *   - id: `${tide}:${enemy_type}`（匹配 schema idPattern `/^(shallow|deep|abyss):[1-9]\d*$/`）
 *   - data: DistributionRule 统一模型字段（与 distribution-enemy.ts schema 字段 key 对齐）
 *
 * 字段映射：
 *   - 'subject.enemy_type'        = entry.enemy_type（number，保留原类型）
 *   - 'selector.tides'            = [tide]（当前运行时契约每条规则只有一个 tide）
 *   - 'selector.regions'          = []（留空=所有区域，运行时不支持 per-region 过滤）
 *   - 'selector.excludeEntrance'  = true（对齐 J-1 / init.func.php 运行时默认）
 *   - 'selector.excludeExit'      = true（同上）
 *   - 'selector.excludeOccupied'  = true（敌人放置不可重叠）
 *   - 'placement.count'           = entry.count（int 或 [min,max] 区间）
 *
 * enemy_type 保留为 number 类型——原文件 enemy_pool.php 用 `'enemy_type' => 1` 数字，
 * 投影回写时 enemy-pool-projector 同样输出数字，保证 round-trip 一致性。
 *
 * 边界：
 *   - entry.enemy_type 缺失或非数字时跳过该 entry
 *   - entry.count 缺失时默认 1（与 schema default 对齐）
 *   - tide 桶 value 非数组时跳过该桶
 *   - 注释行（enemy_pool.php 中的 `//['enemy_type' => 2, ...]`）已被 parser 剥离，不进入 entry 数组
 */
function projectDistributionEnemy(
  tideBuckets: Record<string, PhpValue>,
  kindSchema: KindSchema,
  source: SourceAnchor,
): ResourceNode[] {
  const nodes: ResourceNode[] = [];
  for (const [tide, entries] of Object.entries(tideBuckets)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const e = entry as { enemy_type?: PhpValue; count?: PhpValue };
      // enemy_type 必须是 number（原文件用 `'enemy_type' => 1` 数字）
      if (typeof e.enemy_type !== 'number') continue;
      const enemyType = e.enemy_type;
      const count = e.count;
      nodes.push({
        kind: kindSchema.kind,
        id: `${tide}:${enemyType}`,
        data: {
          'subject.enemy_type': enemyType,
          'selector.tides': [tide],
          'selector.regions': [],
          'selector.excludeEntrance': true,
          'selector.excludeExit': true,
          'selector.excludeOccupied': true,
          'placement.count': count ?? 1,
        },
        source: [source],
        revision: '',
      });
    }
  }
  return nodes;
}

/**
 * 把 scatter_pool.php 的 tide × phase 矩阵结构投影为 distribution.scatter 统一模型节点（P4 §4.3.3）
 *
 * 输入形态（PHP 解析结果）：
 *   {
 *     shallow: {
 *       initial: [{ item_id: 'scrap_metal', count: [1,3], rate: 0.60 }, ...],
 *       refresh: [{ item_id: 'scrap_metal', count: 1, rate: 0.25 }, ...],
 *     },
 *     deep:    { initial: [...], refresh: [...] },
 *     abyss:   { initial: [...], refresh: [...] },
 *   }
 *
 * 输出形态：每个 entry 投影为一个 distribution.scatter 节点
 *   - id: `${tide}:${phase}:${item_id}`（phase 用 game_init / day_refresh，匹配 schema idPattern）
 *   - data: DistributionRule 统一模型字段（与 distribution-scatter.ts schema 字段 key 对齐）
 *
 * 字段映射：
 *   - 'subject.item_id'           = entry.item_id
 *   - 'selector.tides'            = [tide]
 *   - 'selector.regions'          = []
 *   - 'selector.excludeEntrance'  = false（scatter 无入口/出口排除，运行时不查）
 *   - 'selector.excludeExit'      = false
 *   - 'phase'                     = 'game_init'（initial 桶）/ 'day_refresh'（refresh 桶）
 *   - 'placement.rate'            = entry.rate（0-1 基础率）
 *   - 'placement.count'           = entry.count（int 或 [min,max] 区间）
 *
 * phase 文件 key → schema phase 值映射：
 *   - 'initial'  → 'game_init'（开局放置，obl_generate_wild_items）
 *   - 'refresh'  → 'day_refresh'（时间流逝刷新，obl_refresh_wild_items）
 *
 * 边界：
 *   - entry.item_id 缺失或非字符串时跳过该 entry
 *   - entry.rate 缺失时默认 0.1（与 schema default 对齐）
 *   - entry.count 缺失时默认 1（与 schema default 对齐）
 *   - tide 桶 value 非对象时跳过该桶
 *   - phase 子桶 value 非数组时跳过该 phase
 */
function projectDistributionScatter(
  tideBuckets: Record<string, PhpValue>,
  kindSchema: KindSchema,
  source: SourceAnchor,
): ResourceNode[] {
  /** 文件 phase key → schema phase 值映射（与运行时 phase 字段对齐） */
  const PHASE_FILE_TO_SCHEMA: Record<string, string> = {
    initial: 'game_init',
    refresh: 'day_refresh',
  };

  const nodes: ResourceNode[] = [];
  for (const [tide, phaseBuckets] of Object.entries(tideBuckets)) {
    if (!phaseBuckets || typeof phaseBuckets !== 'object' || Array.isArray(phaseBuckets)) continue;
    const phases = phaseBuckets as Record<string, PhpValue>;
    for (const [phaseKey, entries] of Object.entries(phases)) {
      const phaseSchema = PHASE_FILE_TO_SCHEMA[phaseKey];
      if (phaseSchema === undefined) continue; // 未知 phase key 跳过
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
        const e = entry as { item_id?: PhpValue; count?: PhpValue; rate?: PhpValue };
        if (typeof e.item_id !== 'string') continue;
        const itemId = e.item_id;
        const rate = typeof e.rate === 'number' ? e.rate : 0.1;
        const count = e.count ?? 1;
        nodes.push({
          kind: kindSchema.kind,
          id: `${tide}:${phaseSchema}:${itemId}`,
          data: {
            'subject.item_id': itemId,
            'selector.tides': [tide],
            'selector.regions': [],
            'selector.excludeEntrance': false,
            'selector.excludeExit': false,
            phase: phaseSchema,
            'placement.rate': rate,
            'placement.count': count,
          },
          source: [source],
          revision: '',
        });
      }
    }
  }
  return nodes;
}

/**
 * 序列化 ResourceNode[] 为 PHP 文件
 *
 * P5-2 写入侧切换（执行案 §4.2.2 / §4.3.2）——按 kindSchema.kind 路由：
 *   - world.region / world.tile → 内联 generateMapPhp / generateRegionPhp（P1 projectStore 管理的世界资源）
 *   - 其余 11 个 kind → 独立投影器 build/projectors/*-projector.ts
 *
 * 投影器各自维护 PHP 输出模板（文件头 / 字段顺序 / 分组注释 / 字段对齐），
 * adapter 仅负责路由。enemies_config.php 由 P5 改造为 `return [...]` 标准形态。
 */
export function serializePhpResource(
  nodes: ResourceNode[],
  kindSchema: KindSchema,
): SerializedPhpFile[] {
  if (nodes.length === 0) return [];

  switch (kindSchema.kind) {
    case 'world.region':
      return serializeWorldRegion(nodes);
    case 'world.tile':
      return serializeWorldTile(nodes);
    case 'config.runtime':
      return projectOblConfig(nodes);
    case 'item.template':
      return projectItemTable(nodes);
    case 'recipe.template':
      return projectRecipeTable(nodes);
    case 'poi.template':
      return projectPoiTable(nodes);
    case 'loot.table':
      return projectLootTable(nodes);
    case 'distribution.poi':
      return projectPoiPool(nodes);
    case 'enemy.template':
      return projectEnemiesConfig(nodes);
    case 'distribution.enemy':
      return projectEnemyPool(nodes);
    case 'distribution.scatter':
      return projectScatterPool(nodes);
    case 'combat.skill':
      return projectCombatSkillConfig(nodes);
    case 'skill.definition':
      return projectSkillDefinitionConfig(nodes);
    default:
      // 通用回退：未实现独立投影器的 kind 返回空数组
      return [];
  }
}

/**
 * 序列化 world.region 节点为 map.php
 *
 * 从每个节点的 data（WorldRegionData 形状）重建 regions + grids 字典：
 *   - regions[pgroup]：剥离 pgroup 字段，恢复 Region 形状
 *   - grids[pgroup]：从 region.cols / rows 派生（与装配时同步冗余策略对齐）
 *
 * 节点 data 缺失 cols / rows 时跳过该节点（不写入字典）。
 */
function serializeWorldRegion(nodes: ResourceNode[]): SerializedPhpFile[] {
  const regions: Record<Pgroup, Region> = {};
  const grids: Record<Pgroup, Grid> = {};

  for (const node of nodes) {
    const data = node.data as Partial<WorldRegionData>;
    if (data.pgroup === undefined) continue;
    const pgroup = data.pgroup;

    // 剥离 pgroup 字段，恢复 Region 形状；cols/rows 缺失时跳过节点
    const { pgroup: _pgroup, cols, rows, ...regionRest } = data;
    void _pgroup;
    if (cols === undefined || rows === undefined) continue;

    regions[pgroup] = { ...regionRest, cols, rows } as Region;
    grids[pgroup] = { cols, rows };
  }

  const content = generateMapPhp(regions, grids);
  return [{ filePath: 'oblivions/gamedata/map.php', content }];
}

/**
 * 序列化 world.tile 节点为 tiles/region_${pgroup}.php（按 pgroup 分组多文件）
 *
 * 每个文件内 tiles 字典按 pls 排序重建，保证输出确定性。
 * generateRegionPhp 内部已调用 stripEditorFields 剥离 _breaks 字段。
 */
function serializeWorldTile(nodes: ResourceNode[]): SerializedPhpFile[] {
  // 按 pgroup 分组
  const tilesByPgroup = new Map<Pgroup, Array<{ pls: Pls; tile: Tile }>>();

  for (const node of nodes) {
    const data = node.data as Partial<WorldTileData>;
    if (data.pgroup === undefined || data.pls === undefined) continue;
    const { pgroup, pls, ...tileRest } = data;

    if (!tilesByPgroup.has(pgroup)) {
      tilesByPgroup.set(pgroup, []);
    }
    tilesByPgroup.get(pgroup)!.push({ pls, tile: tileRest as Tile });
  }

  const files: SerializedPhpFile[] = [];
  for (const [pgroup, list] of tilesByPgroup) {
    // 按 pls 升序排序，保证重建结果确定性
    list.sort((a, b) => a.pls - b.pls);
    const tiles: Record<Pls, Tile> = {};
    for (const { pls, tile } of list) {
      tiles[pls] = tile;
    }
    // generateRegionPhp 内部调用 stripEditorFields 剥离 _breaks
    const content = generateRegionPhp(pgroup, tiles);
    files.push({
      filePath: `oblivions/gamedata/tiles/region_${pgroup}.php`,
      content,
    });
  }
  return files;
}

// ──────────────────────────────────────────────────────────────
// P5-2 写入侧切换完成：原内联 serializeConfigRuntime / serializeItemTemplate /
// serializeRecipeTemplate 及其工具（buildMapKeyedDict / stripUndefinedFields）
// 已移除，由 build/projectors/*-projector.ts 独立维护 PHP 输出。
// ──────────────────────────────────────────────────────────────
