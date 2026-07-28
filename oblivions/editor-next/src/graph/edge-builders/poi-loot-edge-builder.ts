/**
 * @module O 内容工具箱
 *
 * POI / loot / distribution / presentation.poi 关系边构建器——P3 §4.4.1 装配逻辑。
 *
 * 构建 6 类关系边（按执行案 §4.4.1 边类型清单）：
 *
 * 1. uses_loot_table（poi.template → loot.table，§4.4.1）
 *    - poi.loot_table_id 非空 → 单条边，metadata={ field:'loot_table_id' }
 *    - poi.loot_table_overrides 每个 value → 边，metadata={ field:'loot_table_overrides', key:toolOrSkillId }
 *    - 同一 (poi, loot_table) 对可有多条（默认表 + 多个 override 路由），用 sequence 区分
 *
 * 2. drops_item（loot.table → item.template，§4.4.1）
 *    - loot.groups[].entries[].item_id 建边
 *    - metadata={ groupIndex, entryIndex }
 *    - 同一 (loot_table, item) 对可有多条（不同 group/entry），用 buildEdgeId sequence 区分
 *
 * 3. dismantle_returns（poi.template → item.template，§4.4.1）
 *    - poi.dismantle_returns[].item_id 建边
 *    - metadata={ count }
 *    - 同一 POI 多个 dismantle_returns 槽位可指向同一 item，用 sequence=index 区分
 *
 * 4. mechanic_ref（poi.template → item.template，§4.4.1）
 *    - 仅 mechanic=craft_source 且 mechanic_value 非空时建边
 *    - metadata={ mechanic:'craft_source' }
 *    - 其他 mechanic 类型（max_hp_up / learn_skill / interact_*）不建边
 *      （mechanic_value 是数字或无意义字符串）
 *
 * 5. distributed_by（distribution.poi → poi.template，§4.4.1）
 *    - distribution.poi.subject.poi_id 非空时建边
 *    - metadata={ tide }
 *    - 兼容两种 distribution.poi 节点 data 形状：
 *      a) 统一模型（O-4 适配器扩展后）：id=`${tide}:${poi_id}`，data 含 'subject.poi_id'
 *      b) partitioned 模式（O-4 适配器扩展前）：id=tide，data 是 PoiPoolEntry[] 数组
 *
 * 6. renders_as（poi.template → presentation.poi，§4.4.1）
 *    - 同 ID 自动构建（poi.template:{id} → presentation.poi:{id}）
 *    - 无 metadata
 *    - 方向与 P2 一致（template → presentation），确保 TemplateDetail 等组件双向查询逻辑统一
 *
 * 边 ID 唯一性策略：
 *   - 同一 from/to/type 组合通过 buildEdgeId 的 sequence 序号区分
 *   - sequence 选用稳定索引（loot_table_overrides 遍历顺序 / groupIndex*1000+entryIndex / dismantle_returns 数组 index）
 *
 * 边界：
 *   - 引用目标不存在时仍构建边（O-10 第 3 层引用校验检测 dangling）
 *   - 装配是纯函数——输入节点列表，输出边列表；不修改 graph-store 状态
 *   - 漂移条目（如 presentation.poi 无对应 poi.template）只构建能构建的边
 *
 * 不实现的边：
 *   - selects_tiles（distribution.poi → world.tile）：动态派生，不持久化
 *     见 buildSelectsTilesEdges 函数——保留给 O-8 分布工作区在 world.tile 加载后单独触发
 */

import type { ResourceNode } from '../types';
import type { RelationshipEdge, NodeId } from '../edge';
import { buildEdgeId } from '../edge';

// ─── 节点 data 形状（与 poi-template / loot-table / distribution-poi / presentation-poi schema 对齐）───

interface PoiTemplateData {
  /** 关联 F-4 战利品表 ID（uses_loot_table 边） */
  loot_table_id?: string;
  /** 工具/技能 ID → loot_table_id 映射（uses_loot_table 边，kv-list） */
  loot_table_overrides?: Record<string, string>;
  /** 机制类型——非空时走 obl_execute_mechanic 分发框架 */
  mechanic?: string;
  /** 机制值——多态：数字（max_hp_up）/ item_id（craft_source）/ 无意义字符串 */
  mechanic_value?: string;
  /** 拆除返还材料列表（dismantle_returns 边） */
  dismantle_returns?: DismantleReturnEntry[];
  [key: string]: unknown;
}

interface DismantleReturnEntry {
  /** 返还道具 ID——引用 item.template.id */
  item_id: string;
  /** 返还数量 */
  count?: number;
}

interface LootTableGroupEntry {
  /** 产物道具 ID——引用 item.template.id */
  item_id: string;
  /** 组内互斥权重 */
  weight?: number;
  /** 产物数量——int 或 [min,max] */
  count?: number | [number, number];
}

interface LootTableGroup {
  /** 0-1 组级概率——先于 entry 判定 */
  chance?: number;
  /** 互斥选项列表——按 weight 加权选一 */
  entries: LootTableGroupEntry[];
}

interface LootTableData {
  /** 表名（日志/调试用） */
  name?: string;
  /** 是否对产出物品应用耐久衰减 */
  durability_decay?: boolean;
  /** 物品组列表——每组独立掷骰 */
  groups?: LootTableGroup[];
  [key: string]: unknown;
}

/**
 * distribution.poi 统一模型形状（与 schema distribution-poi.ts 字段 key 对齐）。
 *
 * schema 字段 key 是 'subject.poi_id' / 'selector.tides'（带点），适配器按 schema 字段 key
 * 直接存储，data 中以这些带点 key 为属性名。
 */
interface DistributionPoiUnifiedData {
  /** 引用 poi.template.id */
  'subject.poi_id'?: string;
  /** 分布生效的潮汐区列表——枚举 shallow/deep/abyss */
  'selector.tides'?: string[];
  [key: string]: unknown;
}

/** poi_pool.php 原始 entry 形状（partitioned 模式下 data 是该 entry 数组） */
interface PoiPoolEntry {
  /** POI 模板 ID */
  poi_id: string;
  /** 每区域数量 */
  per_region?: number;
}

/** world.tile 节点 data 形状（仅本构建器关注的 tide 字段） */
interface WorldTileData {
  /** 潮汐区——shallow / deep / abyss */
  tide?: string;
  [key: string]: unknown;
}

// ─── 公共 API ──────────────────────────────────────────

/**
 * 构建 POI / loot / distribution / presentation.poi 之间的关系边
 *
 * @param nodes 当前 graph 中所有相关 kind 的节点列表
 *   （应包含 poi.template / loot.table / distribution.poi / presentation.poi）
 * @returns 关系边数组（不含节点本身）；调用方负责写入 graph-store
 */
export function buildPoiLootEdges(nodes: ResourceNode[]): RelationshipEdge[] {
  const edges: RelationshipEdge[] = [];

  // 1. uses_loot_table 边（poi.template → loot.table）
  // 3. dismantle_returns + 4. mechanic_ref 边（poi.template → item.template）
  // 同一遍历处理 poi.template，减少扫描
  for (const node of filterByKind<PoiTemplateData>(nodes, 'poi.template')) {
    pushUsesLootTableEdges(edges, node);
    pushDismantleReturnsEdges(edges, node);
    pushMechanicRefEdges(edges, node);
  }

  // 2. drops_item 边（loot.table → item.template）
  for (const node of filterByKind<LootTableData>(nodes, 'loot.table')) {
    pushDropsItemEdges(edges, node);
  }

  // 5. distributed_by 边（distribution.poi → poi.template）
  for (const node of filterByKind(nodes, 'distribution.poi')) {
    pushDistributedByEdges(edges, node);
  }

  // 6. renders_as 边（poi.template → presentation.poi，同 ID 自动构建）
  //    方向与 P2 一致（template → presentation）
  const presentationPoiIds = new Set(
    filterByKind(nodes, 'presentation.poi').map((n) => n.id),
  );
  for (const node of filterByKind(nodes, 'poi.template')) {
    pushRendersAsEdge(edges, node, presentationPoiIds);
  }

  return edges;
}

// ─── 内部工具：边构建 ──────────────────────────────────────

/**
 * uses_loot_table 边——poi.template → loot.table
 *
 * 同一 POI 可有多条边：
 *   - 1 条 loot_table_id（默认表）
 *   - N 条 loot_table_overrides（工具/技能路由表）
 * 用 metadata.field 区分（'loot_table_id' / 'loot_table_overrides'），key 字段补充工具/技能 ID。
 *
 * sequence 策略：loot_table_id 用 0；overrides 用 1..N 累加序号。
 * 同一 (poi, loot_table) 对在不同 field 下也算不同边（buildEdgeId 仍按 type+from+to+seq 唯一）。
 */
function pushUsesLootTableEdges(
  edges: RelationshipEdge[],
  node: ResourceNode<PoiTemplateData>,
): void {
  const from: NodeId = `poi.template:${node.id}`;
  const data = node.data;

  // 默认表 loot_table_id（sequence=0）
  const lootTableId = data.loot_table_id;
  if (typeof lootTableId === 'string' && lootTableId !== '') {
    const to: NodeId = `loot.table:${lootTableId}`;
    edges.push({
      id: buildEdgeId('uses_loot_table', from, to, 0),
      type: 'uses_loot_table',
      from,
      to,
      metadata: { field: 'loot_table_id' },
    });
  }

  // loot_table_overrides——每个工具/技能一条边（sequence=1..N）
  const overrides = data.loot_table_overrides;
  if (overrides && typeof overrides === 'object' && !Array.isArray(overrides)) {
    let seq = 1;
    for (const [toolOrSkillId, tableId] of Object.entries(overrides)) {
      if (typeof tableId !== 'string' || tableId === '') continue;
      const to: NodeId = `loot.table:${tableId}`;
      edges.push({
        id: buildEdgeId('uses_loot_table', from, to, seq),
        type: 'uses_loot_table',
        from,
        to,
        metadata: {
          field: 'loot_table_overrides',
          key: toolOrSkillId,
        },
      });
      seq += 1;
    }
  }
}

/**
 * drops_item 边——loot.table → item.template
 *
 * 同一 loot_table 的同一 item 可有多条（不同 group/entry 槽位）。
 * sequence 策略：groupIndex * 1000 + entryIndex（每组 entries 上限 1000，远超 F-4 引擎实际限制）。
 * metadata.groupIndex + entryIndex 保留可读性，便于 O-7 反向引用面板定位槽位。
 */
function pushDropsItemEdges(
  edges: RelationshipEdge[],
  node: ResourceNode<LootTableData>,
): void {
  const from: NodeId = `loot.table:${node.id}`;
  const groups = node.data.groups ?? [];

  groups.forEach((group, groupIndex) => {
    const entries = group.entries ?? [];
    entries.forEach((entry, entryIndex) => {
      if (typeof entry.item_id !== 'string' || entry.item_id === '') return;
      const to: NodeId = `item.template:${entry.item_id}`;
      const seq = groupIndex * 1000 + entryIndex;
      edges.push({
        id: buildEdgeId('drops_item', from, to, seq),
        type: 'drops_item',
        from,
        to,
        metadata: { groupIndex, entryIndex },
      });
    });
  });
}

/**
 * dismantle_returns 边——poi.template → item.template
 *
 * 同一 POI 多个 dismantle_returns 槽位可指向同一 item，用 sequence=index 区分。
 * metadata.count 来自 dismantle_returns 条目（默认 1）。
 */
function pushDismantleReturnsEdges(
  edges: RelationshipEdge[],
  node: ResourceNode<PoiTemplateData>,
): void {
  const from: NodeId = `poi.template:${node.id}`;
  const returns = node.data.dismantle_returns ?? [];

  returns.forEach((entry, index) => {
    if (typeof entry.item_id !== 'string' || entry.item_id === '') return;
    const to: NodeId = `item.template:${entry.item_id}`;
    edges.push({
      id: buildEdgeId('dismantle_returns', from, to, index),
      type: 'dismantle_returns',
      from,
      to,
      metadata: { count: entry.count ?? 1 },
    });
  });
}

/**
 * mechanic_ref 边——poi.template → item.template
 *
 * 仅当 mechanic=craft_source 且 mechanic_value 非空时建边。
 * 其他 mechanic 类型（max_hp_up / learn_skill / interact_*）的 mechanic_value 是数字或无意义字符串，
 * 不构建边——O-10 引用校验器也仅对 craft_source 类型校验引用闭合。
 *
 * 单 POI 单边——craft_source 只能引用一个 item.template.id。
 */
function pushMechanicRefEdges(
  edges: RelationshipEdge[],
  node: ResourceNode<PoiTemplateData>,
): void {
  if (node.data.mechanic !== 'craft_source') return;
  const mechanicValue = node.data.mechanic_value;
  if (typeof mechanicValue !== 'string' || mechanicValue === '') return;

  const from: NodeId = `poi.template:${node.id}`;
  const to: NodeId = `item.template:${mechanicValue}`;
  edges.push({
    id: buildEdgeId('mechanic_ref', from, to),
    type: 'mechanic_ref',
    from,
    to,
    metadata: { mechanic: 'craft_source' },
  });
}

/**
 * distributed_by 边——distribution.poi → poi.template
 *
 * 兼容两种 distribution.poi 节点 data 形状：
 *   a) 统一模型（O-4 适配器扩展后）：id=`${tide}:${poi_id}`，data 含 'subject.poi_id' 字段
 *      - from = `distribution.poi:${node.id}`（如 distribution.poi:shallow:supply_cache）
 *      - to = `poi.template:${subject.poi_id}`
 *      - tide 从 selector.tides[0] 取（fallback 从 id 前缀取）
 *
 *   b) partitioned 模式（O-4 适配器扩展前临时形状）：id=tide，data 是 PoiPoolEntry[] 数组
 *      - 每个 entry={poi_id, per_region} 投影为一条边
 *      - from = `distribution.poi:${tide}:${poi_id}`（按统一模型 id 格式构造）
 *      - to = `poi.template:${poi_id}`
 *      - tide = node.id（partitioned 模式下 id 即 tide 桶 key）
 *
 * 形状 b 是过渡期支持——O-4 适配器扩展完成后 partitioned 模式应投影为统一模型，b 分支可移除。
 */
function pushDistributedByEdges(
  edges: RelationshipEdge[],
  node: ResourceNode,
): void {
  const data = node.data as DistributionPoiUnifiedData | PoiPoolEntry[] | Record<string, unknown>;

  // 形状 a：统一模型——data 是对象，含 'subject.poi_id'
  if (!Array.isArray(data)) {
    const poiId = (data as DistributionPoiUnifiedData)['subject.poi_id'];
    if (typeof poiId !== 'string' || poiId === '') return;

    const tides = (data as DistributionPoiUnifiedData)['selector.tides'] ?? [];
    const tide = tides[0] ?? node.id.split(':')[0] ?? '';

    const from: NodeId = `distribution.poi:${node.id}`;
    const to: NodeId = `poi.template:${poiId}`;
    edges.push({
      id: buildEdgeId('distributed_by', from, to),
      type: 'distributed_by',
      from,
      to,
      metadata: { tide },
    });
    return;
  }

  // 形状 b：partitioned 模式——data 是 PoiPoolEntry[] 数组
  // 仅当 node.id 是合法 tide 桶 key 时处理（避免误识别其他 partitioned kind）
  const tide = node.id;
  if (tide !== 'shallow' && tide !== 'deep' && tide !== 'abyss') return;

  data.forEach((entry, index) => {
    if (!entry || typeof entry.poi_id !== 'string' || entry.poi_id === '') return;
    // 按统一模型 id 格式构造 distribution.poi 节点 ID
    const distributionId = `${tide}:${entry.poi_id}`;
    const from: NodeId = `distribution.poi:${distributionId}`;
    const to: NodeId = `poi.template:${entry.poi_id}`;
    edges.push({
      id: buildEdgeId('distributed_by', from, to, index),
      type: 'distributed_by',
      from,
      to,
      metadata: { tide },
    });
  });
}

/**
 * renders_as 边——poi.template → presentation.poi（同 ID 自动构建）
 *
 * 方向与 P2 一致（template → presentation）：
 *   - P2: item.template → presentation.item
 *   - P3: poi.template → presentation.poi
 *
 * 遍历 poi.template 节点，查找同 ID 的 presentation.poi 节点构建边。
 * 孤儿 presentation.poi（无对应 poi.template）不构建边——O-10 第 6 层 presentation.poi.orphan 校验。
 */
function pushRendersAsEdge(
  edges: RelationshipEdge[],
  poiTemplateNode: ResourceNode,
  presentationPoiIds: Set<string>,
): void {
  if (!presentationPoiIds.has(poiTemplateNode.id)) return;
  const from: NodeId = `poi.template:${poiTemplateNode.id}`;
  const to: NodeId = `presentation.poi:${poiTemplateNode.id}`;
  edges.push({
    id: buildEdgeId('renders_as', from, to),
    type: 'renders_as',
    from,
    to,
  });
}

// ─── 公共 API（动态派生边，不在主构建器调用）──────────────────────────

/**
 * selects_tiles 边——distribution.poi → world.tile（动态派生，不持久化）
 *
 * 按 §4.4.1 约定，selects_tiles 边在图加载时动态计算，不写入 graph-serializer；
 * world.tile 变更时由图变更事件触发重算。本函数保留为 O-8 分布工作区的入口约定。
 *
 * 调用方：O-8 分布工作区在叠层激活时单独触发，结果缓存在叠层 computed 中；
 * graph-store 装配时不调用本函数——主 buildPoiLootEdges 也不调用它。
 *
 * 实现策略：
 *   - 按 selector.tides 匹配 world.tile 的 tide 属性
 *   - 仅处理统一模型 distribution.poi 节点（data 含 selector.tides）
 *   - partitioned 模式的过渡期形状不参与（O-8 在 O-4 适配器扩展前不应启用叠层）
 *
 * @param distributionNodes distribution.poi 节点列表（统一模型形状）
 * @param tileNodes world.tile 节点列表
 * @returns selects_tiles 边数组——不写入 graph-serializer，由 O-8 缓存使用
 */
export function buildSelectsTilesEdges(
  distributionNodes: ResourceNode[],
  tileNodes: ResourceNode[],
): RelationshipEdge[] {
  const edges: RelationshipEdge[] = [];

  // 构建 tile tide 索引：tide → tile 节点列表
  const tileByTide = new Map<string, ResourceNode<WorldTileData>[]>();
  for (const tile of tileNodes) {
    const tileData = tile.data as WorldTileData;
    const tide = tileData.tide;
    if (typeof tide !== 'string') continue;
    let list = tileByTide.get(tide);
    if (!list) {
      list = [];
      tileByTide.set(tide, list);
    }
    list.push(tile as ResourceNode<WorldTileData>);
  }

  for (const dist of distributionNodes) {
    const distData = dist.data as DistributionPoiUnifiedData | unknown[];
    // 仅处理统一模型形状（data 是对象，含 selector.tides）
    if (Array.isArray(distData)) continue;
    const tides = distData['selector.tides'] ?? [];

    for (const tide of tides) {
      const tiles = tileByTide.get(tide) ?? [];
      for (const tile of tiles) {
        const from: NodeId = `distribution.poi:${dist.id}`;
        const to: NodeId = `world.tile:${tile.id}`;
        edges.push({
          id: buildEdgeId('selects_tiles', from, to),
          type: 'selects_tiles',
          from,
          to,
          metadata: { tide },
        });
      }
    }
  }

  return edges;
}

// ─── 内部工具：节点过滤 ────────────────────────────────────

function filterByKind<T = unknown>(nodes: ResourceNode[], kind: string): ResourceNode<T>[] {
  return nodes.filter((n) => n.kind === kind) as ResourceNode<T>[];
}
