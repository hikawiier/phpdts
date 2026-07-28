/**
 * @module O 内容工具箱
 *
 * 配方匹配算法夹具（F-2 合成系统）。
 *
 * 原镜像目标（执行案 §4.2.5）：
 * - 后端函数：item_resolve_material_mapping($materials, $placed_items)
 *   （item.craft.func.php:252-338）/ item_craft($slots, &$pdata, $workbench_materials)
 *   （item.craft.func.php:777-904）
 *
 * 关键发现：合成系统完全不使用随机数，纯匹配逻辑。
 *
 * 算法夹具实现：
 * - 输入：Resource Graph 中的 recipe.template + item.template 节点 + 玩家放置的素材列表
 * - 输出：前端配方匹配结果（匹配的 recipe + 消耗的素材映射 + 产物列表）
 * - 算法：复用 obl-resolve-material-mapping（itemResolveMaterialMapping）
 *
 * 关键不变量：
 * - 匹配优先级：item_id > itmk > tag
 * - min_level 检查：素材的 tool_level 必须 ≥ material 的 min_level
 * - consume 约束：工作台素材（source='workbench'）只能匹配 consume='none' 槽位
 * - 完全消耗约束：所有 placed_items 必须都被消耗
 *
 * 当前边界：
 * - 不注册到运行时 MIRRORS 列表
 * - 配方开发正确性由静态 schema / reference / semantic 校验覆盖
 * - 不再用后端 craft_preview 反向证明作者刚编辑出的配方“能不能合成”
 *
 * P6-3 阶段实现说明：
 * - 复用 P6-2 的 obl-resolve-material-mapping 算法
 * - 算法夹具为每个 recipe.template 尝试用"典型素材组合"匹配——
 *   由于这里不接入玩家实际放置的素材，此处用"recipe 自身的 materials
 *   反向构造最小素材集"作为输入：每个 material slot 放置 1 个满足要求的素材
 * - 这覆盖了"匹配成功"路径；"匹配失败"路径由单元测试覆盖（见 obl-resolve-material-mapping.test.ts）
 * - PRNG 不使用——本算法夹具是纯函数
 */

import type { useGraphStore } from '@/graph/graph-store';
import type { MirrorRunOutput } from './index';
import type { StateScope } from './snapshot-fetcher';
import type { CompareOptions, InvariantViolation } from './snapshot-comparator';
import type { MirrorSnapshot } from './snapshot-fetcher';
import {
  itemResolveMaterialMapping,
  type MaterialRequirement,
  type PlacedItem,
  type MaterialMappingEntry,
} from './algorithms/obl-resolve-material-mapping';

type GraphStore = ReturnType<typeof useGraphStore>;

export const RECIPE_MATCH_MIRROR_ID = 'recipe-match';

export const RECIPE_MATCH_REQUIRED_SCOPES: readonly StateScope[] = [
  'craft_preview',
  'craft_recipes',
  'player_inventory',
];

/**
 * recipe-match 算法夹具对比配置——1:1 精确对比，无容忍度。
 *
 * 合成系统不使用随机数；此配置仅供算法级测试保留，不进入运行时镜像门禁。
 */
export const RECIPE_MATCH_COMPARE_OPTIONS: CompareOptions = {
  exactMatch: true,
};

/**
 * 单个 recipe.template 的匹配结果。
 *
 * - recipeId：recipe.template 节点 ID
 * - matched：是否匹配成功
 * - mapping：匹配映射（matched=true 时含 placed_index + consume）
 * - results：产物列表（recipe.results，仅 matched=true 时有意义）
 * - materials：素材需求列表（用于调试）
 */
export interface RecipeMatchResult {
  recipeId: string;
  matched: boolean;
  mapping: MaterialMappingEntry[] | null;
  results: Array<{ item_id: string; count: number }>;
  materials: MaterialRequirement[];
}

/**
 * recipe-match 算法输出结构。
 *
 * - count：匹配成功的 recipe 总数
 * - distribution：recipe_id → 匹配状态（1=成功，0=失败）
 * - matchResults：每个 recipe.template 的匹配结果
 * - totalRecipes：参与的 recipe 数量
 */
export interface RecipeMatchMirrorOutput {
  /** 匹配成功的 recipe 总数 */
  count: number;
  /** recipe_id → 匹配状态（1=成功，0=失败） */
  distribution: Record<string, number>;
  /** 每个 recipe.template 的匹配结果 */
  matchResults: RecipeMatchResult[];
  /** 参与的 recipe 数量 */
  totalRecipes: number;
}

// ─── Graph 节点 data 形状（与 schema/kinds/* 对齐） ────────────────

/**
 * recipe.template 节点 data 形状（与 schema/kinds/recipe-template.ts 对齐）。
 *
 * 字段是扁平的（category / materials / results），materials 和 results 是数组。
 */
interface RecipeTemplateData {
  category?: string;
  materials?: Array<{
    item_id?: string;
    itmk?: string;
    tag?: string;
    count?: number;
    consume?: 'all' | 'durability' | 'none';
    min_level?: number;
  }>;
  results?: Array<{
    item_id: string;
    count: number;
  }>;
  [key: string]: unknown;
}

/**
 * item.template 节点 data 形状（与 schema/kinds/item-template.ts 对齐）。
 *
 * 用于构造满足 material 需求的 placed_item——
 * 算法夹具需要从 item.template 中查找符合 material.item_id / itmk / tag 的道具。
 */
interface ItemTemplateData {
  itmk: string;
  itme: number;
  itms: string;
  itmsk: string;
  tags?: string[];
  tool_level?: number;
  stack?: boolean;
  [key: string]: unknown;
}

// ─── 数据装配辅助 ───────────────────────────────────────────────

/**
 * 从 item.template 节点查找满足 material 需求的道具。
 *
 * 匹配规则（与 itemResolveMaterialMapping 一致）：
 *   - material.item_id 优先：精确匹配 item.template.id
 *   - material.itmk 次之：匹配 item.template.itmk
 *   - material.tag 最后：匹配 item.template.tags 包含该 tag
 *
 * 返回第一个匹配的 item.template 节点；无匹配返回 null。
 */
function findItemForMaterial(
  material: MaterialRequirement,
  itemNodes: ReadonlyArray<{ id: string; data: ItemTemplateData }>,
): { id: string; data: ItemTemplateData } | null {
  // 1. item_id 精确匹配
  if (typeof material.item_id === 'string' && material.item_id !== '') {
    for (const node of itemNodes) {
      if (node.id === material.item_id) return node;
    }
    return null;
  }
  // 2. itmk 类别匹配
  if (typeof material.itmk === 'string' && material.itmk !== '') {
    for (const node of itemNodes) {
      if (node.data.itmk === material.itmk) return node;
    }
    return null;
  }
  // 3. tag 性质匹配
  if (typeof material.tag === 'string' && material.tag !== '') {
    for (const node of itemNodes) {
      const tags = Array.isArray(node.data.tags) ? node.data.tags : [];
      if (tags.includes(material.tag)) return node;
    }
    return null;
  }
  return null;
}

/**
 * 为 recipe 反向构造"最小素材集"——每个 material slot 放置 1 个满足要求的素材。
 *
 * 策略：
 *   - 对每个 material，从 item.template 中查找匹配道具
 *   - 找到后构造 PlacedItem（source='bag'，除非 consume='none' 则 source='workbench'）
 *   - count > 1 时放置 count 个相同素材
 *   - 找不到匹配道具时返回 null（该 recipe 无法匹配）
 *
 * 这覆盖了"匹配成功"路径——所有素材都被消耗，映射成功。
 */
function buildPlacedItemsForRecipe(
  materials: readonly MaterialRequirement[],
  itemNodes: ReadonlyArray<{ id: string; data: ItemTemplateData }>,
): PlacedItem[] | null {
  const placed: PlacedItem[] = [];
  for (const mat of materials) {
    const count = typeof mat.count === 'number' ? mat.count : 1;
    const minLevel = typeof mat.min_level === 'number' ? mat.min_level : 0;
    const consume = mat.consume ?? 'all';
    // consume='none' 是工作台槽位——素材 source='workbench'
    const source: 'bag' | 'workbench' = consume === 'none' ? 'workbench' : 'bag';

    const found = findItemForMaterial(mat, itemNodes);
    if (!found) return null;

    // 校验 tool_level
    const toolLevel = typeof found.data.tool_level === 'number' ? found.data.tool_level : 0;
    if (toolLevel < minLevel) return null;

    const tags = Array.isArray(found.data.tags) ? found.data.tags : [];
    for (let i = 0; i < count; i++) {
      placed.push({
        item_id: found.id,
        itmk: found.data.itmk,
        tags,
        tool_level: toolLevel,
        source,
      });
    }
  }
  return placed;
}

// ─── 不变量校验 ─────────────────────────────────────────────────

/**
 * 校验"匹配优先级：item_id > itmk > tag"。
 *
 * 校验每个 material 只使用一种匹配键（item_id / itmk / tag 互斥）——
 * 这是 schema 层面的约束，由 O-10 第 4 层 recipe_material_match_conflict 保证。
 * 本算法夹具只做防御性检查：如果 material 同时声明了多个匹配键，记录不变量违反。
 */
function checkMatchPriorityInvariant(
  recipeNodes: ReadonlyArray<{ id: string; data: RecipeTemplateData }>,
): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  for (const node of recipeNodes) {
    const materials = Array.isArray(node.data.materials) ? node.data.materials : [];
    for (let i = 0; i < materials.length; i++) {
      const mat = materials[i]!;
      const keys = [
        typeof mat.item_id === 'string' && mat.item_id !== '' ? 1 : 0,
        typeof mat.itmk === 'string' && mat.itmk !== '' ? 1 : 0,
        typeof mat.tag === 'string' && mat.tag !== '' ? 1 : 0,
      ].reduce((a, b) => a + b, 0);
      if (keys > 1) {
        violations.push({
          name: 'recipe_material_match_conflict',
          detail: `recipe.template:${node.id} materials[${i}] 同时声明了多个匹配键（item_id/itmk/tag 互斥）`,
        });
      }
    }
  }
  return violations;
}

/**
 * 校验"工作台槽位（consume='none'）必须用 tag 匹配"。
 *
 * 这是 schema 层面的约束（recipe_table.php:24-27），由 O-10 第 4 层
 * recipe_workbench_slot_not_tag 保证。本算法夹具只做防御性检查。
 */
function checkWorkbenchSlotInvariant(
  recipeNodes: ReadonlyArray<{ id: string; data: RecipeTemplateData }>,
): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  for (const node of recipeNodes) {
    const materials = Array.isArray(node.data.materials) ? node.data.materials : [];
    for (let i = 0; i < materials.length; i++) {
      const mat = materials[i]!;
      if (mat.consume === 'none') {
        if (typeof mat.tag !== 'string' || mat.tag === '') {
          violations.push({
            name: 'recipe_workbench_slot_not_tag',
            detail: `recipe.template:${node.id} materials[${i}] consume='none' 但未使用 tag 匹配（工作台槽位必须用 tag）`,
          });
        }
      }
    }
  }
  return violations;
}

// ─── run 入口 ───────────────────────────────────────────────────

/**
 * 运行 recipe-match 算法夹具——计算前端配方匹配结果。
 *
 * 流程：
 *   1. 从 graph-store 读取 recipe.template + item.template 节点
 *   2. 对每个 recipe.template：
 *      a. 从 materials 反向构造"最小素材集"（每个 slot 放置 1 个匹配素材）
 *      b. 调用 itemResolveMaterialMapping 计算匹配映射
 *      c. 记录匹配结果（matched + mapping + results）
 *   3. 聚合所有 recipe 的匹配结果
 *   4. 自检关键不变量（匹配优先级互斥 / 工作台槽位用 tag）
 *
 * @param graphStore graph-store 实例（读取 Resource Graph 节点）
 * @param _snapshot 保留历史签名兼容，当前算法夹具不读取后端快照
 * @returns 算法输出 + 不变量违反列表
 */
export async function run(
  graphStore: GraphStore,
  _snapshot: MirrorSnapshot,
): Promise<MirrorRunOutput> {
  // 1. 读取 graph 节点
  const recipeNodes = graphStore.findNodesByKind('recipe.template') as ReadonlyArray<{
    id: string;
    data: RecipeTemplateData;
  }>;
  const itemNodes = graphStore.findNodesByKind('item.template') as ReadonlyArray<{
    id: string;
    data: ItemTemplateData;
  }>;

  // 2. 逐 recipe 匹配
  const matchResults: RecipeMatchResult[] = [];
  const distribution: Record<string, number> = {};
  let matchedCount = 0;

  for (const node of recipeNodes) {
    const recipeId = node.id;
    const materials: MaterialRequirement[] = Array.isArray(node.data.materials)
      ? node.data.materials.map((m) => ({
          item_id: m.item_id,
          itmk: m.itmk,
          tag: m.tag,
          count: typeof m.count === 'number' ? m.count : 1,
          consume: m.consume ?? 'all',
          min_level: typeof m.min_level === 'number' ? m.min_level : 0,
        }))
      : [];
    const results = Array.isArray(node.data.results)
      ? node.data.results.map((r) => ({
          item_id: r.item_id,
          count: typeof r.count === 'number' ? r.count : 1,
        }))
      : [];

    // 反向构造最小素材集
    const placedItems = buildPlacedItemsForRecipe(materials, itemNodes);

    let matched = false;
    let mapping: MaterialMappingEntry[] | null = null;

    if (placedItems !== null) {
      mapping = itemResolveMaterialMapping(materials, placedItems);
      matched = mapping !== null;
    }

    matchResults.push({
      recipeId,
      matched,
      mapping,
      results,
      materials,
    });

    distribution[recipeId] = matched ? 1 : 0;
    if (matched) matchedCount++;
  }

  // 3. 不变量校验
  const invariantViolations: InvariantViolation[] = [];
  invariantViolations.push(...checkMatchPriorityInvariant(recipeNodes));
  invariantViolations.push(...checkWorkbenchSlotInvariant(recipeNodes));

  // 4. 构造输出
  const output: RecipeMatchMirrorOutput = {
    count: matchedCount,
    distribution,
    matchResults,
    totalRecipes: recipeNodes.length,
  };

  return {
    output,
    invariantViolations,
  };
}

/**
 * recipe-match 算法验证实例。
 *
 * 不注册到 MIRRORS：配方开发由静态 schema / reference / semantic 校验覆盖，
 * 不作为运行时镜像门禁项。
 */
export const recipeMatchMirror = {
  id: RECIPE_MATCH_MIRROR_ID,
  requiredScopes: RECIPE_MATCH_REQUIRED_SCOPES,
  compareOptions: RECIPE_MATCH_COMPARE_OPTIONS,
  run,
} as const;
