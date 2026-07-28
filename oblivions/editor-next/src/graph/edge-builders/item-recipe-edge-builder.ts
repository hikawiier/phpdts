/**
 * @module O 内容工具箱
 *
 * item/recipe/presentation 关系边构建器——P2 §4.4.1-4.4.3 装配逻辑。
 *
 * 构建 4 类关系边：
 *
 * 1. renders_as 边（template ↔ presentation，§4.4.1）
 *    - item.template:{id} → presentation.item:{id}
 *    - recipe.template:{id} → presentation.recipe:{id}
 *    - 节点 ID 相同即构建边；孤儿 presentation（如 innate_craft_t0）不构建
 *
 * 2. consumes_item / consumes_tag / consumes_itmk 边（recipe → item，§4.4.2）
 *    - recipe.template 的 materials[].item_id 非空 → consumes_item
 *    - recipe.template 的 materials[].tag 非空 → consumes_tag（按 tag 值聚合反向索引）
 *    - recipe.template 的 materials[].itmk 非空 → consumes_itmk（按 itmk 值聚合反向索引）
 *
 * 3. produces_item 边（recipe → item，§4.4.3）
 *    - recipe.template 的 results[].item_id → produces_item
 *
 * 4. uses_effect 边（item → effect.func，§4.4.4）
 *    - item.template 的 use_effect 非空 → uses_effect
 *
 * 边 ID 唯一性策略：
 *   - 同一 from/to/type 组合通过序号区分（如同一 recipe 多个 consumes_item 槽位引用同一 item）
 *   - 序号由 slot_index 决定（materials 数组索引 / results 数组索引）
 *
 * 边界：
 *   - 漂移条目（如 innate_craft_t0 无对应 item.template）只构建能构建的边
 *   - 引用目标不存在时仍构建边（O-10 第 3 层引用校验会检测 dangling）
 *   - 装配是纯函数——输入节点列表，输出边列表；不修改 graph-store 状态
 */

import type { ResourceNode } from '../types';
import type { RelationshipEdge, NodeId } from '../edge';
import { buildEdgeId } from '../edge';

// ─── 节点 data 形状（与 item-template.ts / recipe-template.ts schema 对齐） ─────

interface ItemTemplateData {
  /** 使用效果函数名（如 'restore_hp'）；空字符串表示无使用效果 */
  use_effect?: string;
  [key: string]: unknown;
}

interface RecipeMaterialEntry {
  /** 精确匹配指定道具 ID */
  item_id?: string;
  /** 匹配道具类别码 */
  itmk?: string;
  /** 匹配 Tag ID */
  tag?: string;
  /** 数量 */
  count?: number;
  /** 消耗模式 */
  consume?: string;
  /** 最低工具等级 */
  min_level?: number;
}

interface RecipeResultEntry {
  /** 产物道具 ID */
  item_id: string;
  /** 产物数量 */
  count?: number;
}

interface RecipeTemplateData {
  /** 配方分类 */
  category?: string;
  /** 素材列表 */
  materials?: RecipeMaterialEntry[];
  /** 产物列表 */
  results?: RecipeResultEntry[];
  [key: string]: unknown;
}

// ─── 公共 API ──────────────────────────────────────────────────

/**
 * 构建 item/recipe/presentation 之间的关系边
 *
 * @param nodes 当前 graph 中所有相关 kind 的节点列表
 *   （应包含 item.template / recipe.template / presentation.item / presentation.recipe / effect.func）
 * @returns 关系边数组（不含节点本身）；调用方负责写入 graph-store
 */
export function buildItemRecipeEdges(nodes: ResourceNode[]): RelationshipEdge[] {
  const edges: RelationshipEdge[] = [];

  // 按 kind 分组，避免每次扫描全量节点
  const itemTemplates = filterByKind<ItemTemplateData>(nodes, 'item.template');
  const recipeTemplates = filterByKind<RecipeTemplateData>(nodes, 'recipe.template');
  const presentationItems = filterByKind(nodes, 'presentation.item');
  const presentationRecipes = filterByKind(nodes, 'presentation.recipe');
  const effectFuncs = filterByKind<{ name: string }>(nodes, 'effect.func');

  // 构建快速查找索引：节点 ID → 节点是否存在
  const presentationItemIds = new Set(presentationItems.map((n) => n.id));
  const presentationRecipeIds = new Set(presentationRecipes.map((n) => n.id));
  const itemTemplateIds = new Set(itemTemplates.map((n) => n.id));
  const effectFuncIds = new Set(effectFuncs.map((n) => n.id));

  // 1. renders_as 边（item.template ↔ presentation.item）
  for (const item of itemTemplates) {
    if (presentationItemIds.has(item.id)) {
      edges.push(buildRendersAsEdge('item.template', item.id, 'presentation.item', item.id));
    }
  }
  // 2. renders_as 边（recipe.template ↔ presentation.recipe）
  for (const recipe of recipeTemplates) {
    if (presentationRecipeIds.has(recipe.id)) {
      edges.push(
        buildRendersAsEdge('recipe.template', recipe.id, 'presentation.recipe', recipe.id),
      );
    }
  }

  // 3. consumes_item / consumes_tag / consumes_itmk 边（recipe → item）
  for (const recipe of recipeTemplates) {
    const materials = recipe.data.materials ?? [];
    materials.forEach((material, slotIndex) => {
      // 三选一：item_id / itmk / tag
      if (material.item_id && material.item_id !== '') {
        // consumes_item: 即使目标 item.template 不存在也构建边（O-10 检测 dangling）
        // 但若目标存在，反向索引立即生效；若不存在，O-10 第 3 层报 dangling error
        void itemTemplateIds; // 引用一下避免 TS unused 警告
        edges.push(
          buildConsumesEdge('recipe.template', recipe.id, 'item.template', material.item_id, {
            edgeType: 'consumes_item',
            slotIndex,
            matchMode: 'item_id',
          }),
        );
      }
      if (material.itmk && material.itmk !== '') {
        // consumes_itmk: 目标是"任一使用该 itmk 的 item"，按 itmk 值聚合
        // 这里构建虚拟目标节点 ID `item.template:__itmk__:{value}`，由 O-10 第 3 层校验解析
        edges.push(
          buildConsumesEdge('recipe.template', recipe.id, 'item.template', material.itmk, {
            edgeType: 'consumes_itmk',
            slotIndex,
            matchMode: 'itmk',
            itmk: material.itmk,
          }),
        );
      }
      if (material.tag && material.tag !== '') {
        // consumes_tag: 类似 consumes_itmk
        edges.push(
          buildConsumesEdge('recipe.template', recipe.id, 'item.template', material.tag, {
            edgeType: 'consumes_tag',
            slotIndex,
            matchMode: 'tag',
            tag: material.tag,
          }),
        );
      }
    });
  }

  // 4. produces_item 边（recipe → item）
  for (const recipe of recipeTemplates) {
    const results = recipe.data.results ?? [];
    results.forEach((result, slotIndex) => {
      if (!result.item_id || result.item_id === '') return;
      edges.push(
        buildProducesEdge('recipe.template', recipe.id, 'item.template', result.item_id, {
          slotIndex,
          count: result.count ?? 1,
        }),
      );
    });
  }

  // 5. uses_effect 边（item → effect.func）
  for (const item of itemTemplates) {
    const useEffect = item.data.use_effect;
    if (!useEffect || useEffect === '') continue;
    // 引用 effectFuncIds 仅用于一致性检查（边仍构建，O-10 检测 dangling）
    void effectFuncs;
    void effectFuncIds;
    edges.push(
      buildUsesEffectEdge('item.template', item.id, 'effect.func', useEffect),
    );
  }

  return edges;
}

// ─── 内部工具：边构建 ──────────────────────────────────────────

function buildRendersAsEdge(
  fromKind: string,
  fromId: string,
  toKind: string,
  toId: string,
): RelationshipEdge {
  const from: NodeId = `${fromKind}:${fromId}`;
  const to: NodeId = `${toKind}:${toId}`;
  return {
    id: buildEdgeId('renders_as', from, to),
    type: 'renders_as',
    from,
    to,
  };
}

interface ConsumesEdgeMetadata {
  edgeType: 'consumes_item' | 'consumes_itmk' | 'consumes_tag';
  slotIndex: number;
  matchMode: 'item_id' | 'itmk' | 'tag';
  itmk?: string;
  tag?: string;
}

function buildConsumesEdge(
  fromKind: string,
  fromId: string,
  toKind: string,
  toId: string,
  meta: ConsumesEdgeMetadata,
): RelationshipEdge {
  const from: NodeId = `${fromKind}:${fromId}`;
  const to: NodeId = `${toKind}:${toId}`;
  // 同一 recipe 可能多个 slot 引用同一 item/itmk/tag，用 slotIndex 作序号
  const edgeId = buildEdgeId(meta.edgeType, from, to, meta.slotIndex);
  return {
    id: edgeId,
    type: meta.edgeType,
    from,
    to,
    metadata: {
      slot_index: meta.slotIndex,
      match_mode: meta.matchMode,
      ...(meta.itmk !== undefined ? { itmk: meta.itmk } : {}),
      ...(meta.tag !== undefined ? { tag: meta.tag } : {}),
    },
  };
}

interface ProducesEdgeMetadata {
  slotIndex: number;
  count: number;
}

function buildProducesEdge(
  fromKind: string,
  fromId: string,
  toKind: string,
  toId: string,
  meta: ProducesEdgeMetadata,
): RelationshipEdge {
  const from: NodeId = `${fromKind}:${fromId}`;
  const to: NodeId = `${toKind}:${toId}`;
  const edgeId = buildEdgeId('produces_item', from, to, meta.slotIndex);
  return {
    id: edgeId,
    type: 'produces_item',
    from,
    to,
    metadata: {
      slot_index: meta.slotIndex,
      count: meta.count,
    },
  };
}

function buildUsesEffectEdge(
  fromKind: string,
  fromId: string,
  toKind: string,
  toId: string,
): RelationshipEdge {
  const from: NodeId = `${fromKind}:${fromId}`;
  const to: NodeId = `${toKind}:${toId}`;
  return {
    id: buildEdgeId('uses_effect', from, to),
    type: 'uses_effect',
    from,
    to,
  };
}

// ─── 内部工具：节点过滤 ────────────────────────────────────────

function filterByKind<T = unknown>(nodes: ResourceNode[], kind: string): ResourceNode<T>[] {
  return nodes.filter((n) => n.kind === kind) as ResourceNode<T>[];
}
