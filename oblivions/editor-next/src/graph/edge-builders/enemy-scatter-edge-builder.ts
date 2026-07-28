/**
 * @module O 内容工具箱
 *
 * enemy / scatter / distribution.enemy / distribution.scatter / presentation.enemy
 * 关系边构建器——P4 §4.4 装配逻辑。
 *
 * 构建 5 类关系边（按执行案 §4.4 P4 边类型清单）：
 *
 * 1. spawned_by（distribution.enemy → enemy.template，§4.4 P4）
 *    - distribution.enemy.subject.enemy_type 非空 → 单条边
 *    - metadata={ tide }（从 id 前缀或 selector.tides[0] 取）
 *    - 兼容两种 distribution.enemy 节点 data 形状：
 *      a) 统一模型（O-4 适配器扩展后）：id=`${tide}:${enemy_type}`，data 含 'subject.enemy_type'
 *      b) partitioned 模式（O-4 适配器扩展前临时形状）：id=tide，data 是 EnemyPoolEntry[] 数组
 *
 * 2. distributed_by（distribution.scatter → item.template，§4.4 P4）
 *    - distribution.scatter.subject.item_id 非空 → 单条边
 *    - metadata={ tide, phase }（phase 用 game_init / day_refresh）
 *    - 兼容两种 distribution.scatter 节点 data 形状：
 *      a) 统一模型：id=`${tide}:${phase}:${item_id}`，data 含 'subject.item_id'
 *      b) partitioned 模式（过渡期）：id=tide，data 是 { initial: [...], refresh: [...] } 字典
 *
 * 3. consumes_skill（enemy.template → effect.skill，§4.4 P4）
 *    - enemy.template.skills[] 每个非空字符串 → consumes_skill 边
 *    - metadata={ field:'skills', slot_index }
 *    - effect.skill 是纯字符串集合（P4 不注册为 BUILTIN_KIND），to 端点用
 *      `effect.skill:{skill_id}` 字符串引用，但不入 graph-store 节点表
 *
 * 4. casts_skill（enemy.template → effect.skill，§4.4 P4）
 *    - enemy.template.combat_skills[] 每个非空字符串 → casts_skill 边
 *    - enemy.template.strategy_slots[].id 每个非空 → casts_skill 边
 *    - metadata={ field:'combat_skills'|'strategy_slots', slot_index }
 *    - 同上：effect.skill 是字符串引用，不入节点表
 *
 * 5. renders_as（enemy.template → presentation.enemy，§4.4 P4）
 *    - 同 ID 自动构建（enemy.template:{id} → presentation.enemy:{id}）
 *    - 无 metadata
 *    - 方向与 P2/P3 一致（template → presentation）
 *
 * 边 ID 唯一性策略：
 *   - 同一 from/to/type 组合通过 buildEdgeId 的 sequence 序号区分
 *   - sequence 选用稳定索引（skills 数组索引 / combat_skills 数组索引 / strategy_slots 数组索引）
 *
 * 边界：
 *   - 引用目标不存在时仍构建边（O-10 第 3 层引用校验检测 dangling）
 *   - effect.skill 是虚拟节点集合，不注册为 BUILTIN_KIND——边 to 端用字符串引用
 *   - 装配是纯函数——输入节点列表，输出边列表；不修改 graph-store 状态
 *   - 漂移条目（如 presentation.enemy 无对应 enemy.template）只构建能构建的边
 *
 * 不实现的边：
 *   - selects_tiles（distribution.* → world.tile）：动态派生，不持久化
 *     见 buildSelectsTilesEdges 函数——保留给 O-8 分布工作区在 world.tile 加载后单独触发
 */

import type { ResourceNode } from '../types';
import type { RelationshipEdge, NodeId } from '../edge';
import { buildEdgeId } from '../edge';

// ─── 节点 data 形状（与 enemy-template / distribution-enemy / distribution-scatter /
//                     presentation-enemy schema 对齐）───

interface EnemyTemplateData {
  /** 拥有技能 ID 列表（refKind=effect.skill，纯字符串集合） */
  skills?: string[];
  /** 战斗倾向技能列表（应为 skills 的子集，refKind=effect.skill） */
  combat_skills?: string[];
  /** 4 槽策略数组，每槽可为 null 或 {type:'skill', id:'...'} */
  strategy_slots?: Array<{ type: string; id: string } | null>;
  [key: string]: unknown;
}

/** distribution.enemy 统一模型形状（与 distribution-enemy.ts schema 字段 key 对齐） */
interface DistributionEnemyUnifiedData {
  /** 引用 enemy.template.id（数字，与原文件 enemy_pool.php 对齐） */
  'subject.enemy_type'?: number | string;
  /** 分布生效的潮汐区列表——枚举 shallow/deep/abyss */
  'selector.tides'?: string[];
  [key: string]: unknown;
}

/** enemy_pool.php 原始 entry 形状（partitioned 模式下 data 是该 entry 数组） */
interface EnemyPoolEntry {
  /** 敌人模板 ID（数字） */
  enemy_type: number;
  /** 每区域数量 */
  count?: number | [number, number];
}

/** distribution.scatter 统一模型形状（与 distribution-scatter.ts schema 字段 key 对齐） */
interface DistributionScatterUnifiedData {
  /** 引用 item.template.id */
  'subject.item_id'?: string;
  /** 分布生效的潮汐区列表 */
  'selector.tides'?: string[];
  /** 相位——game_init / day_refresh */
  phase?: string;
  [key: string]: unknown;
}

/** scatter_pool.php 原始 phase 桶形状（partitioned 模式下 data 是该字典） */
interface ScatterPoolPhaseBuckets {
  /** 开局放置列表 */
  initial?: ScatterPoolEntry[];
  /** 时间流逝刷新列表 */
  refresh?: ScatterPoolEntry[];
  [key: string]: unknown;
}

/** scatter_pool.php 原始 entry 形状 */
interface ScatterPoolEntry {
  /** 道具模板 ID */
  item_id: string;
  /** 生成数量 */
  count?: number | [number, number];
  /** 基础生成率 */
  rate?: number;
}

/** world.tile 节点 data 形状（仅本构建器关注的 tide 字段） */
interface WorldTileData {
  /** 潮汐区——shallow / deep / abyss */
  tide?: string;
  [key: string]: unknown;
}

/** phase schema 值 → metadata phase 值（保持原值，用于边 metadata） */

// ─── 公共 API ──────────────────────────────────────────

/**
 * 构建 enemy / scatter / distribution.enemy / distribution.scatter / presentation.enemy
 * 之间的关系边
 *
 * @param nodes 当前 graph 中所有相关 kind 的节点列表
 *   （应包含 enemy.template / distribution.enemy / distribution.scatter /
 *    presentation.enemy）
 * @returns 关系边数组（不含节点本身）；调用方负责写入 graph-store
 */
export function buildEnemyScatterEdges(nodes: ResourceNode[]): RelationshipEdge[] {
  const edges: RelationshipEdge[] = [];

  // 1. spawned_by 边（distribution.enemy → enemy.template）
  for (const node of filterByKind(nodes, 'distribution.enemy')) {
    pushSpawnedByEdges(edges, node);
  }

  // 2. distributed_by 边（distribution.scatter → item.template）
  for (const node of filterByKind(nodes, 'distribution.scatter')) {
    pushDistributedByScatterEdges(edges, node);
  }

  // 3. consumes_skill + 4. casts_skill 边（enemy.template → effect.skill）
  for (const node of filterByKind<EnemyTemplateData>(nodes, 'enemy.template')) {
    pushConsumesSkillEdges(edges, node);
    pushCastsSkillEdges(edges, node);
  }

  // 5. renders_as 边（enemy.template → presentation.enemy，同 ID 自动构建）
  //    方向与 P2/P3 一致（template → presentation）
  const presentationEnemyIds = new Set(
    filterByKind(nodes, 'presentation.enemy').map((n) => n.id),
  );
  for (const node of filterByKind(nodes, 'enemy.template')) {
    pushRendersAsEdge(edges, node, presentationEnemyIds);
  }

  return edges;
}

// ─── 内部工具：边构建 ──────────────────────────────────────

/**
 * spawned_by 边——distribution.enemy → enemy.template
 *
 * 兼容两种 distribution.enemy 节点 data 形状：
 *   a) 统一模型（O-4 适配器扩展后）：id=`${tide}:${enemy_type}`，data 含 'subject.enemy_type'
 *      - from = `distribution.enemy:${node.id}`（如 distribution.enemy:shallow:1）
 *      - to = `enemy.template:${subject.enemy_type}`
 *      - tide 从 selector.tides[0] 取（fallback 从 id 前缀取）
 *
 *   b) partitioned 模式（O-4 适配器扩展前临时形状）：id=tide，data 是 EnemyPoolEntry[] 数组
 *      - 每个 entry={enemy_type, count} 投影为一条边
 *      - from = `distribution.enemy:${tide}:${enemy_type}`（按统一模型 id 格式构造）
 *      - to = `enemy.template:${enemy_type}`
 *      - tide = node.id（partitioned 模式下 id 即 tide 桶 key）
 *
 * 形状 b 是过渡期支持——O-4 适配器扩展完成后 partitioned 模式应投影为统一模型，b 分支可移除。
 *
 * enemy_type 在统一模型中是 number——to 端点用 `enemy.template:${enemy_type}` 字符串引用，
 * 数字会自动转为字符串（与 enemy.template.id 字符串形态对齐）。
 */
function pushSpawnedByEdges(
  edges: RelationshipEdge[],
  node: ResourceNode,
): void {
  const data = node.data as DistributionEnemyUnifiedData | EnemyPoolEntry[] | Record<string, unknown> | null;

  // 防御：data 为 null/undefined 时跳过（PHP 解析失败等场景下 node.data 可能为 null）
  if (data === null || data === undefined) return;

  // 形状 a：统一模型——data 是对象，含 'subject.enemy_type'
  if (!Array.isArray(data)) {
    const enemyType = (data as DistributionEnemyUnifiedData)['subject.enemy_type'];
    if (enemyType === undefined || enemyType === null) return;
    // enemy_type 是 number 或 string，统一转字符串作为 to 端点
    const enemyTypeStr = String(enemyType);
    if (enemyTypeStr === '') return;

    const tides = (data as DistributionEnemyUnifiedData)['selector.tides'] ?? [];
    const tide = tides[0] ?? node.id.split(':')[0] ?? '';

    const from: NodeId = `distribution.enemy:${node.id}`;
    const to: NodeId = `enemy.template:${enemyTypeStr}`;
    edges.push({
      id: buildEdgeId('spawned_by', from, to),
      type: 'spawned_by',
      from,
      to,
      metadata: { tide },
    });
    return;
  }

  // 形状 b：partitioned 模式——data 是 EnemyPoolEntry[] 数组
  // 仅当 node.id 是合法 tide 桶 key 时处理（避免误识别其他 partitioned kind）
  const tide = node.id;
  if (tide !== 'shallow' && tide !== 'deep' && tide !== 'abyss') return;

  data.forEach((entry, index) => {
    if (!entry || typeof entry.enemy_type !== 'number') return;
    const enemyTypeStr = String(entry.enemy_type);
    // 按统一模型 id 格式构造 distribution.enemy 节点 ID
    const distributionId = `${tide}:${enemyTypeStr}`;
    const from: NodeId = `distribution.enemy:${distributionId}`;
    const to: NodeId = `enemy.template:${enemyTypeStr}`;
    edges.push({
      id: buildEdgeId('spawned_by', from, to, index),
      type: 'spawned_by',
      from,
      to,
      metadata: { tide },
    });
  });
}

/**
 * distributed_by 边——distribution.scatter → item.template
 *
 * 兼容两种 distribution.scatter 节点 data 形状：
 *   a) 统一模型（O-4 适配器扩展后）：id=`${tide}:${phase}:${item_id}`，data 含 'subject.item_id'
 *      - from = `distribution.scatter:${node.id}`
 *      - to = `item.template:${subject.item_id}`
 *      - tide 从 selector.tides[0] 取（fallback 从 id 前缀取）
 *      - phase 从 data.phase 取（fallback 从 id 第二段取）
 *
 *   b) partitioned 模式（过渡期）：id=tide，data 是 { initial: [...], refresh: [...] } 字典
 *      - 每个 phase 桶内每个 entry 投影为一条边
 *      - from = `distribution.scatter:${tide}:${phase_schema}:${item_id}`（按统一模型 id 格式构造）
 *      - to = `item.template:${entry.item_id}`
 *      - phase_schema = 'game_init'（initial）/ 'day_refresh'（refresh）
 */
function pushDistributedByScatterEdges(
  edges: RelationshipEdge[],
  node: ResourceNode,
): void {
  const data = node.data as DistributionScatterUnifiedData | ScatterPoolPhaseBuckets | unknown[] | null;

  // 防御：data 为 null/undefined 时跳过（PHP 解析失败等场景下 node.data 可能为 null）
  if (data === null || data === undefined) return;

  // 形状 a：统一模型——data 是对象，含 'subject.item_id'
  if (!Array.isArray(data) && typeof data === 'object') {
    const itemId = (data as DistributionScatterUnifiedData)['subject.item_id'];
    if (typeof itemId !== 'string' || itemId === '') {
      // 可能在 partitioned 模式下 data 是 { initial: [...], refresh: [...] }
      // 检测是否是 phase 桶字典
      const phaseBuckets = data as ScatterPoolPhaseBuckets;
      if (
        phaseBuckets.initial !== undefined ||
        phaseBuckets.refresh !== undefined
      ) {
        pushDistributedByScatterPartitionedEdges(edges, node, phaseBuckets);
      }
      return;
    }

    const tides = (data as DistributionScatterUnifiedData)['selector.tides'] ?? [];
    const tide = tides[0] ?? node.id.split(':')[0] ?? '';
    const phase =
      (data as DistributionScatterUnifiedData).phase ?? node.id.split(':')[1] ?? '';

    const from: NodeId = `distribution.scatter:${node.id}`;
    const to: NodeId = `item.template:${itemId}`;
    edges.push({
      id: buildEdgeId('distributed_by', from, to),
      type: 'distributed_by',
      from,
      to,
      metadata: { tide, phase },
    });
    return;
  }

  // 形状 b：partitioned 模式——data 是 ScatterPoolPhaseBuckets 字典
  // 这种情况在上面已通过 'subject.item_id' 缺失分支处理
}

/**
 * 形状 b 辅助函数：partitioned 模式的 scatter_pool phase 桶字典
 *
 * phase 文件 key → schema phase 值映射：
 *   - 'initial' → 'game_init'
 *   - 'refresh' → 'day_refresh'
 */
function pushDistributedByScatterPartitionedEdges(
  edges: RelationshipEdge[],
  node: ResourceNode,
  phaseBuckets: ScatterPoolPhaseBuckets,
): void {
  const tide = node.id;
  if (tide !== 'shallow' && tide !== 'deep' && tide !== 'abyss') return;

  const PHASE_FILE_TO_SCHEMA: Record<string, string> = {
    initial: 'game_init',
    refresh: 'day_refresh',
  };

  let seq = 0;
  for (const [phaseKey, entries] of Object.entries(phaseBuckets)) {
    const phaseSchema = PHASE_FILE_TO_SCHEMA[phaseKey];
    if (phaseSchema === undefined) continue;
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!entry || typeof entry.item_id !== 'string' || entry.item_id === '') continue;
      // 按统一模型 id 格式构造 distribution.scatter 节点 ID
      const distributionId = `${tide}:${phaseSchema}:${entry.item_id}`;
      const from: NodeId = `distribution.scatter:${distributionId}`;
      const to: NodeId = `item.template:${entry.item_id}`;
      edges.push({
        id: buildEdgeId('distributed_by', from, to, seq),
        type: 'distributed_by',
        from,
        to,
        metadata: { tide, phase: phaseSchema },
      });
      seq += 1;
    }
  }
}

/**
 * consumes_skill 边——enemy.template → effect.skill（来自 skills[]）
 *
 * effect.skill 是纯字符串集合（P4 不注册为 BUILTIN_KIND），to 端点用
 * `effect.skill:{skill_id}` 字符串引用，但不入 graph-store 节点表。
 * O-10 第 3 层引用校验器检测 dangling 时按此字符串引用查找。
 *
 * 同一 enemy 多个 skills[] 槽位可引用同一 skill，用 slot_index 序号区分。
 */
function pushConsumesSkillEdges(
  edges: RelationshipEdge[],
  node: ResourceNode<EnemyTemplateData>,
): void {
  // 防御：data 为 null/undefined 时跳过（PHP 解析失败等场景下 node.data 可能为 null）
  if (node.data === null || node.data === undefined) return;

  const from: NodeId = `enemy.template:${node.id}`;
  const skills = node.data.skills ?? [];

  skills.forEach((skillId, slotIndex) => {
    if (typeof skillId !== 'string' || skillId === '') return;
    const to: NodeId = `effect.skill:${skillId}`;
    edges.push({
      id: buildEdgeId('consumes_skill', from, to, slotIndex),
      type: 'consumes_skill',
      from,
      to,
      metadata: { field: 'skills', slot_index: slotIndex },
    });
  });
}

/**
 * casts_skill 边——enemy.template → effect.skill
 *
 * 来自两个来源：
 *   - combat_skills[]：战斗倾向技能（按优先级排列）
 *   - strategy_slots[].id：4 槽策略数组中非空槽位的 id
 *
 * 两个来源的 slot_index 独立编序，metadata.field 区分（'combat_skills' / 'strategy_slots'）。
 *
 * strategy_slots 4 槽结构数组：每槽可为 null 或 {type:'skill', id:'...'}。
 * null 槽位跳过；非空槽位的 id 字段引用 effect.skill。
 */
function pushCastsSkillEdges(
  edges: RelationshipEdge[],
  node: ResourceNode<EnemyTemplateData>,
): void {
  // 防御：data 为 null/undefined 时跳过（PHP 解析失败等场景下 node.data 可能为 null）
  if (node.data === null || node.data === undefined) return;

  const from: NodeId = `enemy.template:${node.id}`;

  // combat_skills[] 边
  const combatSkills = node.data.combat_skills ?? [];
  combatSkills.forEach((skillId, slotIndex) => {
    if (typeof skillId !== 'string' || skillId === '') return;
    const to: NodeId = `effect.skill:${skillId}`;
    edges.push({
      id: buildEdgeId('casts_skill', from, to, slotIndex),
      type: 'casts_skill',
      from,
      to,
      metadata: { field: 'combat_skills', slot_index: slotIndex },
    });
  });

  // strategy_slots[].id 边——slot_index 从 0 开始（与 strategy_slots 数组索引对齐）
  const strategySlots = node.data.strategy_slots ?? [];
  strategySlots.forEach((slot, slotIndex) => {
    if (slot === null) return;
    if (typeof slot !== 'object') return;
    const skillId = slot.id;
    if (typeof skillId !== 'string' || skillId === '') return;
    const to: NodeId = `effect.skill:${skillId}`;
    edges.push({
      id: buildEdgeId('casts_skill', from, to, slotIndex),
      type: 'casts_skill',
      from,
      to,
      metadata: { field: 'strategy_slots', slot_index: slotIndex },
    });
  });
}

/**
 * renders_as 边——enemy.template → presentation.enemy（同 ID 自动构建）
 *
 * 方向与 P2/P3 一致（template → presentation）：
 *   - P2: item.template → presentation.item
 *   - P3: poi.template → presentation.poi
 *   - P4: enemy.template → presentation.enemy
 *
 * 遍历 enemy.template 节点，查找同 ID 的 presentation.enemy 节点构建边。
 * 孤儿 presentation.enemy（无对应 enemy.template）不构建边——O-10 第 6 层
 * presentation.enemy.orphan 校验。
 */
function pushRendersAsEdge(
  edges: RelationshipEdge[],
  enemyTemplateNode: ResourceNode,
  presentationEnemyIds: Set<string>,
): void {
  if (!presentationEnemyIds.has(enemyTemplateNode.id)) return;
  const from: NodeId = `enemy.template:${enemyTemplateNode.id}`;
  const to: NodeId = `presentation.enemy:${enemyTemplateNode.id}`;
  edges.push({
    id: buildEdgeId('renders_as', from, to),
    type: 'renders_as',
    from,
    to,
  });
}

// ─── 公共 API（动态派生边，不在主构建器调用）──────────────────────────

/**
 * selects_tiles 边——distribution.enemy / distribution.scatter → world.tile
 * （动态派生，不持久化）
 *
 * 按 §4.4 约定，selects_tiles 边在图加载时动态计算，不写入 graph-serializer；
 * world.tile 变更时由图变更事件触发重算。本函数保留为 O-8 分布工作区的入口约定。
 *
 * 调用方：O-8 分布工作区在叠层激活时单独触发，结果缓存在叠层 computed 中；
 * graph-store 装配时不调用本函数——主 buildEnemyScatterEdges 也不调用它。
 *
 * 实现策略：
 *   - 按 selector.tides 匹配 world.tile 的 tide 属性
 *   - 仅处理统一模型 distribution.* 节点（data 含 selector.tides）
 *   - partitioned 模式的过渡期形状不参与（O-8 在 O-4 适配器扩展前不应启用叠层）
 *
 * @param distributionNodes distribution.enemy / distribution.scatter 节点列表（统一模型形状）
 * @param tileNodes world.tile 节点列表
 * @returns selects_tiles 边数组——不写入 graph-serializer，由 O-8 缓存使用
 */
export function buildEnemyScatterSelectsTilesEdges(
  distributionNodes: ResourceNode[],
  tileNodes: ResourceNode[],
): RelationshipEdge[] {
  const edges: RelationshipEdge[] = [];

  // 构建 tile tide 索引：tide → tile 节点列表
  const tileByTide = new Map<string, ResourceNode<WorldTileData>[]>();
  for (const tile of tileNodes) {
    // 防御：data 为 null/undefined 时跳过
    if (tile.data === null || tile.data === undefined) continue;
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
    // 防御：data 为 null/undefined 时跳过
    if (dist.data === null || dist.data === undefined) continue;

    // distribution.enemy 统一模型形状
    if (dist.kind === 'distribution.enemy') {
      const distData = dist.data as DistributionEnemyUnifiedData | unknown[];
      if (Array.isArray(distData)) continue;
      const tides = distData['selector.tides'] ?? [];
      for (const tide of tides) {
        const tiles = tileByTide.get(tide) ?? [];
        for (const tile of tiles) {
          const from: NodeId = `distribution.enemy:${dist.id}`;
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
      continue;
    }

    // distribution.scatter 统一模型形状
    if (dist.kind === 'distribution.scatter') {
      const distData = dist.data as DistributionScatterUnifiedData | unknown[];
      if (Array.isArray(distData)) continue;
      const tides = distData['selector.tides'] ?? [];
      for (const tide of tides) {
        const tiles = tileByTide.get(tide) ?? [];
        for (const tile of tiles) {
          const from: NodeId = `distribution.scatter:${dist.id}`;
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
      continue;
    }
  }

  return edges;
}

// ─── 内部工具：节点过滤 ────────────────────────────────────

function filterByKind<T = unknown>(nodes: ResourceNode[], kind: string): ResourceNode<T>[] {
  return nodes.filter((n) => n.kind === kind) as ResourceNode<T>[];
}
