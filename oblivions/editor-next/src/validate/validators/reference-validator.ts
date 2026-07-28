/**
 * @module O 内容工具箱
 *
 * 第 3 层：引用校验——33 个跨资源引用规则 + 3 个 legacy 配置交叉引用规则。
 *
 * 设计意图（执行案 §4.7.4 / §4.8.3）：
 *   - 用 graph-store 的 queries.ts 查询函数检查引用完整性
 *   - 对每个 kind 的节点遍历，检查 refFields 声明的引用字段
 *   - 对未注册 refKind（presentation.itmk / effect.skill / combat.skill /
 *     presentation.tag）的规则，用 string 字面量 + TODO 注释，P0 阶段跳过检查
 *   - presentation.* orphan/missing 规则用 renders_as 边检查
 *   - legacy 配置交叉引用（poi_pool_ref / loot_table_id / scatter item_id）
 *     从 structure-validator 迁移到此处，保持 Light = 1+2 不含 cross-ref 契约
 *
 * 33 个规则分类：
 *   - 17 个 P0/P3 阶段实现（refKind 已注册或 renders_as 边可用，含 P3 补齐的 4 个）
 *   - 8 个 P4 阶段新增（distribution.scatter/enemy 引用 + enemy 技能/槽位 + presentation.enemy）
 *   - 7 个 P0 阶段跳过（refKind 未注册，待 P1+ 补全；P4 已启用 enemy.skill_ref_dangling）
 *   - 1 个 P4 新增的 fallback_redundant warning（presentation.enemy）
 *
 * P3 补齐（执行案 §4.8.3）—— 4 个 P0 占位的 P3 引用规则生效：
 *   - poi.mechanic_value_ref_dangling：仅 mechanic=craft_source 时校验 mechanic_value 引用
 *     （条件引用，不能直接走 checkRefFields 通用引擎）
 *   - poi.dismantle_returns_ref_dangling：dismantle_returns[].item_id 引用 item.template.id
 *     （走 checkRefFields 通用引擎，加映射即可）
 *   - poi_interactions.item_ref_dangling：poi_interactions.required_item 引用 item.template.id
 *     （从 getPoiInteractionsIndex 读取，poi_interactions 不进图作为 kind）
 *   - poi_interactions.poi_mechanic_unknown：poi_interactions.poi_mechanic 在 poi.template 中
 *     无对应 mechanic 字段（从 getPoiInteractionsIndex + poi.template.mechanic 字段交叉校验）
 *
 * P4 补齐（执行案 §4.8.3）—— 8 个 P4 引用规则生效 + 1 个 fallback_redundant warning：
 *   - distribution.scatter.item_ref_dangling：统一模型 'subject.item_id' 路径（替换 P0 stub）
 *   - distribution.enemy.enemy_type_ref_dangling：统一模型 'subject.enemy_type' 路径（替换 P0 stub）
 *   - enemy.skill_ref_dangling：effect.skill 虚拟节点，从 combat_skills/skill_*.php 文件名派生有效集合
 *   - enemy.combat_skill_not_in_skills：combat_skills 应是 skills 子集
 *   - enemy.strategy_slot_invalid：strategy_slots 结构校验（4 槽 / type='skill' 或 null）
 *   - presentation.enemy.missing / presentation.enemy.orphan：renders_as 边检查
 *   - presentation.enemy.fallback_redundant：locale 与后端 fallback 完全相同——冗余但无害
 *
 * 关键修复（执行案 §4.7.4）：lootTableIds / itemTableIds 不再由外部填充，
 * reference-validator 从 graph-store 查询 loot.table / item.template 节点 ID 集合。
 */

import type { Issue } from '../issue-model';
import { makeIssue } from '../issue-model';
import type { GraphStore, ChangeSet } from '../quick-fixes';
import { findNode, findNodesByKind, findRenderableOf } from '@/graph/queries';
import { getKindSchema } from '@/schema/registry';
import { validateConfigReferences } from '@/services/validate-rules';
import type { ValidateIssue } from '@/shared';
import { useConfigStore } from '@/stores/configStore';
import { useRawFilesStore } from '@/stores/rawFilesStore';
import { getPoiInteractionsIndex } from '@/graph/poi-interactions-index';

// ─── 引用规则 ID 常量 ──────────────────────────────────────────
//
// 对齐执行案 §4.7.4 表。P0 阶段已注册 refKind 的规则用实际检查，
// 未注册 refKind 的规则用 string 字面量 + TODO 注释占位。

/** 已注册 refKind 的规则（P0/P3/P4 阶段实现实际检查） */
const RULE_RECIPE_MATERIAL_REF_DANGLING = 'recipe.material_ref_dangling';
const RULE_RECIPE_RESULT_REF_DANGLING = 'recipe.result_ref_dangling';
const RULE_POI_LOOT_TABLE_REF_DANGLING = 'poi.loot_table_ref_dangling';
const RULE_POI_LOOT_TABLE_OVERRIDE_REF_DANGLING = 'poi.loot_table_override_ref_dangling';
const RULE_POI_MECHANIC_VALUE_REF_DANGLING = 'poi.mechanic_value_ref_dangling';
const RULE_POI_DISMANTLE_RETURNS_REF_DANGLING = 'poi.dismantle_returns_ref_dangling';
const RULE_LOOT_TABLE_ITEM_REF_DANGLING = 'loot_table.item_ref_dangling';
// P4 更新：rule ID 从 P0 stub 'scatter.item_ref_dangling' 升级为 'distribution.scatter.item_ref_dangling'，
// 对齐统一模型路径 'subject.item_id'（执行案 §4.8.3）
const RULE_DISTRIBUTION_SCATTER_ITEM_REF_DANGLING = 'distribution.scatter.item_ref_dangling';
// P4 更新：rule ID 从 P0 stub 'enemy_pool.enemy_type_ref_dangling' 升级为 'distribution.enemy.enemy_type_ref_dangling'，
// 对齐统一模型路径 'subject.enemy_type'（执行案 §4.8.3）
const RULE_DISTRIBUTION_ENEMY_ENEMY_TYPE_REF_DANGLING = 'distribution.enemy.enemy_type_ref_dangling';
const RULE_POI_INTERACTIONS_ITEM_REF_DANGLING = 'poi_interactions.item_ref_dangling';
const RULE_POI_INTERACTIONS_POI_MECHANIC_UNKNOWN = 'poi_interactions.poi_mechanic_unknown';
const RULE_PRESENTATION_ITEM_ORPHAN = 'presentation.item.orphan';
const RULE_PRESENTATION_ITEM_MISSING = 'presentation.item.missing';
const RULE_PRESENTATION_POI_ORPHAN = 'presentation.poi.orphan';
const RULE_PRESENTATION_POI_MISSING = 'presentation.poi.missing';
const RULE_PRESENTATION_RECIPE_ORPHAN = 'presentation.recipe.orphan';
const RULE_PRESENTATION_RECIPE_MISSING = 'presentation.recipe.missing';
// P4 新增：presentation.enemy 规则（执行案 §4.8.3）
const RULE_PRESENTATION_ENEMY_ORPHAN = 'presentation.enemy.orphan';
const RULE_PRESENTATION_ENEMY_MISSING = 'presentation.enemy.missing';
const RULE_PRESENTATION_ENEMY_FALLBACK_REDUNDANT = 'presentation.enemy.fallback_redundant';
// P4 新增：enemy.template 引用与结构规则（执行案 §4.8.3）
// effect.skill 是虚拟节点集合（P4 不注册为 BUILTIN_KIND），从 rawFilesStore 的
// combat_skills/skill_*.php 文件名派生有效 skill ID 集合
const RULE_ENEMY_SKILL_REF_DANGLING = 'enemy.skill_ref_dangling';
const RULE_ENEMY_COMBAT_SKILL_NOT_IN_SKILLS = 'enemy.combat_skill_not_in_skills';
const RULE_ENEMY_STRATEGY_SLOT_INVALID = 'enemy.strategy_slot_invalid';

/** 未注册 refKind 的规则（P0 阶段跳过，P1+ 补全） */
// TODO(P1+): presentation.itmk 注册后启用
const RULE_ITEM_TABLE_ITMK_UNKNOWN = 'item_table.itmk_unknown';
// TODO(P1+): effect.skill 注册后启用
const RULE_ITEM_TABLE_USE_EFFECT_UNKNOWN = 'item_table.use_effect_unknown';
// TODO(P1+): presentation.tag 注册后启用
const RULE_ITEM_TABLE_TAG_UNKNOWN = 'item_table.tag_unknown';
// TODO(P1+): presentation.itmk 注册后启用
const RULE_RECIPE_MATERIAL_ITMK_UNKNOWN = 'recipe.material_itmk_unknown';
// TODO(P1+): presentation.tag 注册后启用
const RULE_RECIPE_MATERIAL_TAG_UNKNOWN = 'recipe.material_tag_unknown';
// TODO(P1+): presentation.itmk 注册后启用
const RULE_PRESENTATION_ITMK_ORPHAN = 'presentation.itmk.orphan';
// TODO(P1+): presentation.itmk 注册后启用
const RULE_PRESENTATION_ITMK_MISSING = 'presentation.itmk.missing';

// ─── 字段路径解析 ──────────────────────────────────────────────

/**
 * 从节点 data 中按字段路径提取引用 ID。
 *
 * 路径语法（对齐 RefFieldSpec.field）：
 *   - `materials[].item_id`：先取 materials 字段（数组），展开每个元素，取 item_id
 *   - `[].poi_id`：展开 data 顶层数组/对象，取 poi_id
 *   - `loot_table_id`：直接取字段
 *   - `groups[].entries[].item_id`：嵌套展开
 *
 * 对数字数组（如 distribution.enemy 的 [1, 2]），[] 展开后元素本身就是引用值。
 *
 * flat-key 优先策略（P4 修复）：distribution.scatter / distribution.enemy 等 kind
 * 的 schema 字段 key 含点（如 'subject.item_id'），data 中以该带点字符串作为
 * 扁平属性名存储。直接尝试 `data[path]` 命中即返回，避免被路径解析器误拆为
 * `data.subject.item_id` 嵌套路径。仅当 flat key 不存在时才回退到路径解析
 * （处理 `materials[].item_id` / `groups[].entries[].item_id` 等真正嵌套场景）。
 */
function extractRefIds(data: unknown, path: string): string[] {
  // flat-key 优先：data 是对象且直接含该 path 属性时，按属性值返回
  if (data != null && typeof data === 'object' && !Array.isArray(data)) {
    const direct = (data as Record<string, unknown>)[path];
    if (direct != null) {
      if (typeof direct === 'string' || typeof direct === 'number') {
        return [String(direct)];
      }
      if (Array.isArray(direct)) {
        return direct
          .filter((v) => typeof v === 'string' || typeof v === 'number')
          .map((v) => String(v))
          .filter((s) => s.length > 0);
      }
    }
  }

  // 标准化路径为 tokens：materials[].item_id → ['materials', '[]', 'item_id']
  const tokens: string[] = [];
  let i = 0;
  while (i < path.length) {
    if (path[i] === '[') {
      tokens.push('[]');
      while (i < path.length && path[i] !== ']') i++;
      i++; // 跳过 ]
    } else if (path[i] === '.') {
      i++;
    } else {
      let name = '';
      while (i < path.length && path[i] !== '[' && path[i] !== '.') {
        name += path[i];
        i++;
      }
      if (name) tokens.push(name);
    }
  }

  let current: unknown[] = [data];
  for (const token of tokens) {
    const next: unknown[] = [];
    if (token === '[]') {
      // 展开数组或对象 values
      for (const item of current) {
        if (Array.isArray(item)) {
          next.push(...item);
        } else if (item != null && typeof item === 'object') {
          next.push(...Object.values(item as Record<string, unknown>));
        }
      }
    } else {
      // 取字段；若元素本身是 string/number（如 distribution.enemy 数字数组），保留
      for (const item of current) {
        if (typeof item === 'string' || typeof item === 'number') {
          next.push(item);
        } else if (item != null && typeof item === 'object') {
          const val = (item as Record<string, unknown>)[token];
          if (val != null) next.push(val);
        }
      }
    }
    current = next;
  }

  // 过滤出非空 string/number，统一转 string
  return current
    .filter((v) => typeof v === 'string' || typeof v === 'number')
    .map((v) => String(v))
    .filter((s) => s.length > 0);
}

// ─── 通用 refFields 检查引擎 ───────────────────────────────────

/**
 * 对指定 kind 的所有节点，检查其 refFields 声明的引用完整性。
 *
 * 仅检查 refKind 已注册（在 graph 中有节点）的 refField。
 * 未注册 refKind 的 refField 跳过（由上层 TODO 注释标记）。
 *
 * @returns Issue[]
 */
function checkRefFields(
  _graph: GraphStore,
  kind: string,
  ruleIdMap: Record<string, { ruleId: string; severity: 'error' | 'warning' }>,
): Issue[] {
  const schema = getKindSchema(kind);
  if (!schema || schema.refFields.length === 0) return [];

  const issues: Issue[] = [];
  const nodes = findNodesByKind(kind);

  for (const refField of schema.refFields) {
    const config = ruleIdMap[refField.field];
    if (!config) continue; // 无 ruleId 映射，跳过

    // 检查 refKind 是否在 graph 中有节点（未注册 refKind 时跳过）
    const refKindNodes = findNodesByKind(refField.refKind);
    if (refKindNodes.length === 0) {
      // refKind 未注册或 graph 中无节点，跳过检查
      // TODO(P1+): refKind 注册后启用此规则
      continue;
    }

    // 构建引用目标 ID 集合
    const refIdSet = new Set(refKindNodes.map((n) => n.id));

    for (const node of nodes) {
      const refIds = extractRefIds(node.data, refField.field);
      for (const refId of refIds) {
        if (!refIdSet.has(refId)) {
          issues.push(
            makeIssue({
              ruleId: config.ruleId,
              severity: config.severity,
              message: `${kind}:${node.id} 的 ${refField.field} 引用不存在的 ${refField.refKind}:${refId}`,
              resourceRef: { kind, id: node.id },
              hint: `修正引用或创建缺失的 ${refField.refKind}:${refId}`,
              location: { pgroup: null, pls: null, field: refField.field },
            }),
          );
        }
      }
    }
  }

  return issues;
}

// ─── presentation orphan/missing 检查 ──────────────────────────

/**
 * 检查 presentation.* orphan（locale 中存在但后端无对应模板）与
 * missing（后端模板无 locale 覆盖）。
 *
 * 用 renders_as 边查询——若 graph 中无 renders_as 边，跳过检查。
 *
 * @param templateKind 后端模板 kind（如 'item.template'）
 * @param presentationKind 前端呈现 kind（如 'presentation.item'）
 * @param orphanRuleId orphan 规则 ID
 * @param missingRuleId missing 规则 ID
 * @param orphanSeverity orphan 严重级别
 * @param missingSeverity missing 严重级别
 */
function checkPresentationOrphanMissing(
  _graph: GraphStore,
  templateKind: string,
  presentationKind: string,
  orphanRuleId: string,
  missingRuleId: string,
  orphanSeverity: 'error' | 'warning',
  missingSeverity: 'error' | 'warning',
): Issue[] {
  const issues: Issue[] = [];

  const templates = findNodesByKind(templateKind);
  const presentations = findNodesByKind(presentationKind);

  // 若 graph 中无任一类节点，跳过（P0-D loader 未装配）
  if (templates.length === 0 && presentations.length === 0) return issues;

  // 检查 renders_as 边是否存在（P0 阶段边由 P0-D loader 装配）
  // 若边不存在，用 ID 集合交叉检查作为 fallback
  const templateIds = new Set(templates.map((n) => n.id));
  const presentationIds = new Set(presentations.map((n) => n.id));

  // orphan：presentation 中存在但 template 中不存在
  for (const pres of presentations) {
    if (!templateIds.has(pres.id)) {
      // 用 renders_as 边验证（若边存在且已连接，跳过）
      const renderables = findRenderableOf(templateKind, pres.id);
      if (renderables.length > 0) continue; // 边已连接，跳过

      issues.push(
        makeIssue({
          ruleId: orphanRuleId,
          severity: orphanSeverity,
          message: `${presentationKind}:${pres.id} 在后端无对应 ${templateKind} 模板`,
          resourceRef: { kind: presentationKind, id: pres.id },
          hint: `删除孤立的 locale 条目或创建对应 ${templateKind} 模板`,
          location: { pgroup: null, pls: null, field: pres.id },
        }),
      );
    }
  }

  // missing：template 中存在但 presentation 中不存在
  for (const tpl of templates) {
    if (!presentationIds.has(tpl.id)) {
      // 用 renders_as 边验证
      const renderables = findRenderableOf(templateKind, tpl.id);
      // 若 renderables 包含对应 presentation，跳过
      if (renderables.some((r) => r.kind === presentationKind)) continue;

      issues.push(
        makeIssue({
          ruleId: missingRuleId,
          severity: missingSeverity,
          message: `${templateKind}:${tpl.id} 模板无前端 ${presentationKind} locale 覆盖`,
          resourceRef: { kind: templateKind, id: tpl.id },
          hint: `在 ${presentationKind} 中添加 locale 条目`,
          location: { pgroup: null, pls: null, field: tpl.id },
        }),
      );
    }
  }

  return issues;
}

// ─── legacy 配置交叉引用（迁移自 structure-validator） ──────────

/**
 * legacy 配置交叉引用校验——poi_pool_ref / loot_table_id / scatter item_id。
 *
 * 从 structure-validator（第 2 层）迁移到此处（第 3 层），保持：
 *   - Light = 1+2 不含 cross-ref（生成器调用 includeConfig=false 时 runLight 不触发）
 *   - Full = 1+2+3 含 cross-ref（includeConfig=true 时通过 runFull 触发）
 *
 * 设计意图：
 *   - 从 graph-store 查询 loot.table / item.template 节点 ID 集合
 *     替代原 lootTableIds / itemTableIds 参数（执行案 §4.7.5 关键修复）
 *   - 从 configStore 读取 scatterPool / poiTable / poiPool（P1+ 迁移到 graph-store）
 *   - 转换为统一 Issue 模型时 resourceRef 标记为 { kind: 'config', id: '' }
 */
function checkLegacyConfigReferences(graph: GraphStore): Issue[] {
  const config = useConfigStore();

  const lootTableIds: string[] = [];
  const itemTableIds: string[] = [];
  for (const node of graph.nodes.values()) {
    if (node.kind === 'loot.table') {
      lootTableIds.push(node.id);
    } else if (node.kind === 'item.template') {
      itemTableIds.push(node.id);
    }
  }

  const legacyIssues: ValidateIssue[] = validateConfigReferences({
    lootTableIds,
    itemTableIds,
    scatterPool: config.scatterPool,
    poiTable: config.poiTable,
    poiPool: config.poiPool,
  });

  return legacyIssues.map((v) => ({
    ruleId: v.rule,
    severity: v.severity,
    message: v.message,
    resourceRef:
      v.location.pgroup != null
        ? { kind: 'world.region', id: String(v.location.pgroup) }
        : { kind: 'config', id: '' },
    hint: v.hint,
    location: v.location,
  }));
}

// ─── P3 条件引用校验：poi.mechanic_value_ref_dangling ─────────

/**
 * 校验 poi.template.mechanic_value 的条件引用完整性。
 *
 * 仅当 poi.template.mechanic === 'craft_source' 时，mechanic_value 才引用 item.template.id；
 * 其他 mechanic 类型（max_hp_up / learn_skill / interact_*）的 mechanic_value 是数字或
 * 无意义字符串，不参与引用校验。
 *
 * 不能直接走 checkRefFields 通用引擎——通用引擎会无差别校验所有 mechanic_value，
 * 对非 craft_source 类型的 POI 产生误报（如 max_hp_up 的 mechanic_value=10 会被当作
 * item.template.id 检查）。
 *
 * 实现路径（执行案 §4.8.3 建议的"基于节点数据"路径）：
 *   - 遍历 poi.template 节点
 *   - 仅对 mechanic === 'craft_source' 的节点检查
 *   - mechanic_value 非空字符串时，检查 item.template:{mechanic_value} 是否存在
 */
function checkPoiMechanicValueRef(_graph: GraphStore): Issue[] {
  const issues: Issue[] = [];
  const poiNodes = findNodesByKind<{ mechanic?: string; mechanic_value?: string }>(
    'poi.template',
  );
  if (poiNodes.length === 0) return issues;

  // 构建 item.template ID 集合
  const itemNodes = findNodesByKind('item.template');
  if (itemNodes.length === 0) return issues; // item.template 未加载，跳过
  const itemIdSet = new Set(itemNodes.map((n) => n.id));

  for (const node of poiNodes) {
    const data = node.data;
    if (!data || data.mechanic !== 'craft_source') continue;

    const mechanicValue = data.mechanic_value;
    if (typeof mechanicValue !== 'string' || mechanicValue === '') continue;

    if (!itemIdSet.has(mechanicValue)) {
      issues.push(
        makeIssue({
          ruleId: RULE_POI_MECHANIC_VALUE_REF_DANGLING,
          severity: 'error',
          message: `poi.template:${node.id} 的 mechanic_value 引用不存在的 item.template:${mechanicValue}`,
          resourceRef: { kind: 'poi.template', id: node.id },
          hint: `修正 mechanic_value 或创建缺失的 item.template:${mechanicValue}`,
          location: { pgroup: null, pls: null, field: 'mechanic_value' },
        }),
      );
    }
  }

  return issues;
}

// ─── P3 辅助索引校验：poi_interactions 引用规则 ─────────────────

/**
 * 校验 poi_interactions 的两个引用规则：
 *   - poi_interactions.item_ref_dangling：required_item 引用不存在的 item.template
 *   - poi_interactions.poi_mechanic_unknown：poi_mechanic 在 poi.template 中无对应 mechanic
 *
 * poi_interactions.php 不进图作为 kind（执行案 §4.3.4），通过 getPoiInteractionsIndex()
 * 读取辅助索引。索引结构：
 *   - poiMechanicToInteractionId: Map<poi_mechanic, interaction_id>
 *   - requiredItemToInteractionId: Map<item_id, interaction_id[]>
 *
 * Issue 的 resourceRef 用 { kind: 'poi_interactions', id: interaction_id } 标记，
 * 虽然 poi_interactions 不是注册 kind，但 kind 字段是 string，UI 可据此显示来源。
 */
function checkPoiInteractionsReferences(): Issue[] {
  const issues: Issue[] = [];
  const index = getPoiInteractionsIndex();

  // 索引为空时跳过（loader 未加载或文件不存在）
  if (
    index.poiMechanicToInteractionId.size === 0 &&
    index.requiredItemToInteractionId.size === 0
  ) {
    return issues;
  }

  // 构建 item.template ID 集合
  const itemNodes = findNodesByKind('item.template');
  const itemIdSet = new Set(itemNodes.map((n) => n.id));

  // 构建 poi.template 的 mechanic 字段值集合
  const poiNodes = findNodesByKind<{ mechanic?: string }>('poi.template');
  const poiMechanicSet = new Set<string>();
  for (const poi of poiNodes) {
    if (poi.data && typeof poi.data.mechanic === 'string' && poi.data.mechanic !== '') {
      poiMechanicSet.add(poi.data.mechanic);
    }
  }

  // poi_interactions.item_ref_dangling
  // 遍历 requiredItemToInteractionId，检查每个 item_id 是否在 item.template 中存在
  // 若 item.template 未加载（itemIdSet 为空），跳过避免误报
  if (itemIdSet.size > 0) {
    for (const [itemId, interactionIds] of index.requiredItemToInteractionId) {
      if (!itemIdSet.has(itemId)) {
        for (const interactionId of interactionIds) {
          issues.push(
            makeIssue({
              ruleId: RULE_POI_INTERACTIONS_ITEM_REF_DANGLING,
              severity: 'error',
              message: `poi_interactions:${interactionId} 的 required_item 引用不存在的 item.template:${itemId}`,
              resourceRef: { kind: 'poi_interactions', id: interactionId },
              hint: `修正 required_item 或创建缺失的 item.template:${itemId}`,
              location: { pgroup: null, pls: null, field: 'required_item' },
            }),
          );
        }
      }
    }
  }

  // poi_interactions.poi_mechanic_unknown
  // 遍历 poiMechanicToInteractionId，检查每个 poi_mechanic 是否在 poi.template 中有对应 mechanic
  // 若 poi.template 未加载（poiMechanicSet 为空），跳过避免误报
  if (poiMechanicSet.size > 0) {
    for (const [poiMechanic, interactionId] of index.poiMechanicToInteractionId) {
      if (!poiMechanicSet.has(poiMechanic)) {
        issues.push(
          makeIssue({
            ruleId: RULE_POI_INTERACTIONS_POI_MECHANIC_UNKNOWN,
            severity: 'error',
            message: `poi_interactions:${interactionId} 的 poi_mechanic=${poiMechanic} 在 poi.template 中无对应 mechanic`,
            resourceRef: { kind: 'poi_interactions', id: interactionId },
            hint: `修正 poi_mechanic 或在 poi.template 中添加 mechanic=${poiMechanic} 的 POI`,
            location: { pgroup: null, pls: null, field: 'poi_mechanic' },
          }),
        );
      }
    }
  }

  return issues;
}

// ─── P4: enemy.template 引用与结构校验 ─────────────────────────

/**
 * enemy.template 节点 data 形状（与 enemy-template.ts schema 对齐）。
 *
 * skills / combat_skills 是 string[]；strategy_slots 是 4 槽数组，
 * 每槽可为 null 或 { type: 'skill', id: string }。
 */
interface EnemyTemplateData {
  skills?: string[];
  combat_skills?: string[];
  strategy_slots?: Array<{ type: string; id: string } | null>;
  /** deprecated 后端 fallback 中文名——由 presentation.enemy.name 投影 */
  name?: string;
  [key: string]: unknown;
}

/**
 * 派生 effect.skill 有效 ID 集合（执行案 §4.4.1 审查补丁 A11）。
 *
 * P4 阶段 effect.skill 是纯字符串集合，不注册为 BUILTIN_KIND。
 * 有效集合从 rawFilesStore 中已缓存的 `combat_skills/skill_*.php` 文件名派生：
 *   - 文件名模式：`combat_skills/skill_{skill_id}.php`
 *   - 派生 skill_id：去除 `skill_` 前缀与 `.php` 后缀
 *   - 例：`combat_skills/skill_unarmed_strike.php` → `unarmed_strike`
 *
 * rawFilesStore 不可用（非组件上下文）或无 combat_skills 文件时返回空集合，
 * checkEnemySkillRefs 跳过校验避免误报。
 */
function deriveValidSkillIds(): Set<string> {
  try {
    const rawFilesStore = useRawFilesStore();
    const allFiles = rawFilesStore.getAllFiles();
    const skillIds = new Set<string>();
    for (const path of Object.keys(allFiles)) {
      // 兼容 `combat_skills/skill_xxx.php` 与 `oblivions/gamedata/combat_skills/skill_xxx.php`
      const match = path.match(/combat_skills\/skill_([a-z0-9_]+)\.php$/i);
      if (match && match[1]) {
        skillIds.add(match[1]);
      }
    }
    return skillIds;
  } catch {
    // rawFilesStore 在非组件上下文（如测试）可能不可用
    return new Set();
  }
}

/**
 * 校验 enemy.template 的三个引用与结构规则（执行案 §4.8.3）：
 *   - enemy.skill_ref_dangling（warning）：skills[] / combat_skills[] / strategy_slots[].id
 *     引用未注册的 skill。P4 effect.skill 是虚拟节点集合，从 combat_skills/skill_*.php
 *     文件名派生有效集合
 *   - enemy.combat_skill_not_in_skills（warning）：combat_skills 应是 skills 子集
 *   - enemy.strategy_slot_invalid（error）：strategy_slots 槽位结构无效
 *     （type 仅 'skill' 或 null，长度固定 4）
 *
 * 三类检查合并到一次遍历，避免重复扫描 enemy.template 节点。
 */
function checkEnemySkillAndStructure(_graph: GraphStore): Issue[] {
  const issues: Issue[] = [];
  const enemyNodes = findNodesByKind<EnemyTemplateData>('enemy.template');
  if (enemyNodes.length === 0) return issues;

  const validSkillIds = deriveValidSkillIds();
  // 有效集合为空时跳过 skill_ref_dangling（rawFilesStore 不可用或 combat_skills 未加载）
  const skipSkillRefCheck = validSkillIds.size === 0;

  for (const node of enemyNodes) {
    const data = node.data;
    if (!data || typeof data !== 'object') continue;

    const skills = Array.isArray(data.skills) ? data.skills : [];
    const combatSkills = Array.isArray(data.combat_skills) ? data.combat_skills : [];
    const strategySlots = Array.isArray(data.strategy_slots) ? data.strategy_slots : [];

    // ── enemy.skill_ref_dangling ──
    if (!skipSkillRefCheck) {
      const checkedIds = new Set<string>();
      for (const skill of skills) {
        if (typeof skill !== 'string' || skill === '') continue;
        if (checkedIds.has(skill)) continue;
        checkedIds.add(skill);
        if (!validSkillIds.has(skill)) {
          issues.push(
            makeIssue({
              ruleId: RULE_ENEMY_SKILL_REF_DANGLING,
              severity: 'warning',
              message: `enemy.template:${node.id} 的 skills 引用未注册的 effect.skill:${skill}`,
              resourceRef: { kind: 'enemy.template', id: node.id },
              hint: `修正引用或在 combat_skills/skill_${skill}.php 创建对应技能文件`,
              location: { pgroup: null, pls: null, field: 'skills' },
            }),
          );
        }
      }
      for (const skill of combatSkills) {
        if (typeof skill !== 'string' || skill === '') continue;
        if (checkedIds.has(skill)) continue;
        checkedIds.add(skill);
        if (!validSkillIds.has(skill)) {
          issues.push(
            makeIssue({
              ruleId: RULE_ENEMY_SKILL_REF_DANGLING,
              severity: 'warning',
              message: `enemy.template:${node.id} 的 combat_skills 引用未注册的 effect.skill:${skill}`,
              resourceRef: { kind: 'enemy.template', id: node.id },
              hint: `修正引用或在 combat_skills/skill_${skill}.php 创建对应技能文件`,
              location: { pgroup: null, pls: null, field: 'combat_skills' },
            }),
          );
        }
      }
      for (let i = 0; i < strategySlots.length; i++) {
        const slot = strategySlots[i];
        if (slot === null || slot === undefined) continue;
        if (typeof slot !== 'object' || typeof slot.id !== 'string') continue;
        if (checkedIds.has(slot.id)) continue;
        checkedIds.add(slot.id);
        if (!validSkillIds.has(slot.id)) {
          issues.push(
            makeIssue({
              ruleId: RULE_ENEMY_SKILL_REF_DANGLING,
              severity: 'warning',
              message: `enemy.template:${node.id} 的 strategy_slots[${i}].id 引用未注册的 effect.skill:${slot.id}`,
              resourceRef: { kind: 'enemy.template', id: node.id },
              hint: `修正引用或在 combat_skills/skill_${slot.id}.php 创建对应技能文件`,
              location: { pgroup: null, pls: null, field: `strategy_slots[${i}].id` },
            }),
          );
        }
      }
    }

    // ── enemy.combat_skill_not_in_skills ──
    const skillsSet = new Set(
      skills.filter((s): s is string => typeof s === 'string' && s !== ''),
    );
    for (const skill of combatSkills) {
      if (typeof skill !== 'string' || skill === '') continue;
      if (!skillsSet.has(skill)) {
        issues.push(
          makeIssue({
            ruleId: RULE_ENEMY_COMBAT_SKILL_NOT_IN_SKILLS,
            severity: 'warning',
            message: `enemy.template:${node.id} 的 combat_skills 包含 '${skill}'，但 skills 中不存在此项`,
            resourceRef: { kind: 'enemy.template', id: node.id },
            hint: `将 '${skill}' 加入 skills 列表，或从 combat_skills 中移除`,
            location: { pgroup: null, pls: null, field: 'combat_skills' },
          }),
        );
      }
    }

    // ── enemy.strategy_slot_invalid ──
    // 4 槽固定长度（执行案 §4.1.2）
    if (strategySlots.length !== 4) {
      issues.push(
        makeIssue({
          ruleId: RULE_ENEMY_STRATEGY_SLOT_INVALID,
          severity: 'error',
          message: `enemy.template:${node.id} 的 strategy_slots 长度=${strategySlots.length}，应为 4`,
          resourceRef: { kind: 'enemy.template', id: node.id },
          hint: `调整 strategy_slots 为 4 槽数组，空槽用 null 占位`,
          location: { pgroup: null, pls: null, field: 'strategy_slots' },
        }),
      );
    }
    for (let i = 0; i < strategySlots.length; i++) {
      const slot = strategySlots[i];
      if (slot === null || slot === undefined) continue; // null 槽位合法
      if (typeof slot !== 'object' || Array.isArray(slot)) {
        issues.push(
          makeIssue({
            ruleId: RULE_ENEMY_STRATEGY_SLOT_INVALID,
            severity: 'error',
            message: `enemy.template:${node.id} 的 strategy_slots[${i}] 不是对象也不是 null`,
            resourceRef: { kind: 'enemy.template', id: node.id },
            hint: `槽位必须是 null 或 {type:'skill', id:'...'} 结构`,
            location: { pgroup: null, pls: null, field: `strategy_slots[${i}]` },
          }),
        );
        continue;
      }
      // type 仅允许 'skill'（P4 唯一类型，P5+ 扩展）
      if (slot.type !== 'skill') {
        issues.push(
          makeIssue({
            ruleId: RULE_ENEMY_STRATEGY_SLOT_INVALID,
            severity: 'error',
            message: `enemy.template:${node.id} 的 strategy_slots[${i}].type='${slot.type}'，仅允许 'skill'`,
            resourceRef: { kind: 'enemy.template', id: node.id },
            hint: `修正 type 为 'skill'，或置 null 清空槽位`,
            location: { pgroup: null, pls: null, field: `strategy_slots[${i}].type` },
          }),
        );
      }
      // type='skill' 时 id 必须是非空字符串
      if (slot.type === 'skill' && (typeof slot.id !== 'string' || slot.id === '')) {
        issues.push(
          makeIssue({
            ruleId: RULE_ENEMY_STRATEGY_SLOT_INVALID,
            severity: 'error',
            message: `enemy.template:${node.id} 的 strategy_slots[${i}].id 缺失或非字符串`,
            resourceRef: { kind: 'enemy.template', id: node.id },
            hint: `为 type='skill' 槽位提供有效 skill id，或置 null 清空`,
            location: { pgroup: null, pls: null, field: `strategy_slots[${i}].id` },
          }),
        );
      }
    }
  }

  return issues;
}

// ─── P4: presentation.enemy.fallback_redundant 校验 ─────────────

/**
 * 校验 presentation.enemy.name 与 enemy.template.name 是否冗余一致（warning）。
 *
 * 执行案 §4.8.3：locale 与后端 fallback 完全相同——冗余但无害。
 * P4 过渡期双源同步投影保证两者一致，此规则用于提示冗余状态；
 * P5 单源编译后 enemy.template.name 标记为 deprecated + auto-projected，
 * 此规则不再触发。
 */
function checkPresentationEnemyFallbackRedundant(): Issue[] {
  const issues: Issue[] = [];
  const enemyTemplates = findNodesByKind<EnemyTemplateData>('enemy.template');
  const presentations = findNodesByKind<{ name?: string }>('presentation.enemy');
  if (enemyTemplates.length === 0 || presentations.length === 0) return issues;

  const templateNameById = new Map<string, string>();
  for (const tpl of enemyTemplates) {
    if (tpl.data && typeof tpl.data.name === 'string' && tpl.data.name !== '') {
      templateNameById.set(tpl.id, tpl.data.name);
    }
  }

  for (const pres of presentations) {
    const fallbackName = templateNameById.get(pres.id);
    if (!fallbackName) continue; // 无 fallback，不触发冗余检查
    const presName = pres.data?.name;
    if (typeof presName === 'string' && presName === fallbackName) {
      issues.push(
        makeIssue({
          ruleId: RULE_PRESENTATION_ENEMY_FALLBACK_REDUNDANT,
          severity: 'warning',
          message: `presentation.enemy:${pres.id} 的 name 与后端 fallback 完全相同（均为 '${fallbackName}'）——冗余但无害`,
          resourceRef: { kind: 'presentation.enemy', id: pres.id },
          hint: `P5 单源编译后 enemy.template.name 字段移除，此冗余自动消失`,
          location: { pgroup: null, pls: null, field: 'name' },
        }),
      );
    }
  }

  return issues;
}

// ─── 主入口 ────────────────────────────────────────────────────

/**
 * 第 3 层校验——引用校验（33 个规则 + 3 个 legacy 配置交叉引用规则）。
 *
 * P0/P3 阶段实现 17 个规则（refKind 已注册或 renders_as 边可用，含 P3 补齐的 4 个）。
 * P4 新增 9 个规则（distribution.scatter/enemy 引用 + enemy 技能/槽位 + presentation.enemy 三类）。
 * 7 个规则因 refKind 未注册跳过（用 TODO 注释标记，P1+ 补全）。
 * 另含 3 个 legacy 配置交叉引用规则（poi_pool_ref / loot_table_id / scatter item_id）。
 *
 * @param graph 图状态
 * @param _changeSet Change Set（P0 阶段未使用）
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function validate(graph: GraphStore, _changeSet?: ChangeSet): Issue[] {
  const issues: Issue[] = [];

  // ── legacy 配置交叉引用（迁移自 structure-validator） ──────
  issues.push(...checkLegacyConfigReferences(graph));

  // ── 已注册 refKind 的 refFields 规则 ──────────────────────

  // recipe.material_ref_dangling / recipe.result_ref_dangling
  issues.push(
    ...checkRefFields(graph, 'recipe.template', {
      'materials[].item_id': {
        ruleId: RULE_RECIPE_MATERIAL_REF_DANGLING,
        severity: 'error',
      },
      'results[].item_id': {
        ruleId: RULE_RECIPE_RESULT_REF_DANGLING,
        severity: 'error',
      },
    }),
  );

  // poi.loot_table_ref_dangling / poi.loot_table_override_ref_dangling /
  // poi.dismantle_returns_ref_dangling
  issues.push(
    ...checkRefFields(graph, 'poi.template', {
      loot_table_id: {
        ruleId: RULE_POI_LOOT_TABLE_REF_DANGLING,
        severity: 'error',
      },
      'loot_table_overrides[]': {
        ruleId: RULE_POI_LOOT_TABLE_OVERRIDE_REF_DANGLING,
        severity: 'error',
      },
      'dismantle_returns[].item_id': {
        ruleId: RULE_POI_DISMANTLE_RETURNS_REF_DANGLING,
        severity: 'error',
      },
    }),
  );

  // poi.mechanic_value_ref_dangling（条件引用：仅 mechanic=craft_source 时校验）
  issues.push(...checkPoiMechanicValueRef(graph));

  // poi_interactions.item_ref_dangling / poi_interactions.poi_mechanic_unknown
  // （poi_interactions 不进图作为 kind，从辅助索引读取）
  issues.push(...checkPoiInteractionsReferences());

  // loot_table.item_ref_dangling
  issues.push(
    ...checkRefFields(graph, 'loot.table', {
      'groups[].entries[].item_id': {
        ruleId: RULE_LOOT_TABLE_ITEM_REF_DANGLING,
        severity: 'error',
      },
    }),
  );

  // distribution.scatter.item_ref_dangling（P4 统一模型路径 'subject.item_id'）
  issues.push(
    ...checkRefFields(graph, 'distribution.scatter', {
      'subject.item_id': {
        ruleId: RULE_DISTRIBUTION_SCATTER_ITEM_REF_DANGLING,
        severity: 'error',
      },
    }),
  );

  // distribution.enemy.enemy_type_ref_dangling（P4 统一模型路径 'subject.enemy_type'）
  issues.push(
    ...checkRefFields(graph, 'distribution.enemy', {
      'subject.enemy_type': {
        ruleId: RULE_DISTRIBUTION_ENEMY_ENEMY_TYPE_REF_DANGLING,
        severity: 'error',
      },
    }),
  );

  // P4 新增：enemy.template 引用与结构规则
  // enemy.skill_ref_dangling / enemy.combat_skill_not_in_skills / enemy.strategy_slot_invalid
  issues.push(...checkEnemySkillAndStructure(graph));

  // ── presentation orphan/missing 规则（renders_as 边） ──────

  // presentation.item orphan/missing
  issues.push(
    ...checkPresentationOrphanMissing(
      graph,
      'item.template',
      'presentation.item',
      RULE_PRESENTATION_ITEM_ORPHAN,
      RULE_PRESENTATION_ITEM_MISSING,
      'warning',
      'error',
    ),
  );

  // presentation.poi orphan/missing
  issues.push(
    ...checkPresentationOrphanMissing(
      graph,
      'poi.template',
      'presentation.poi',
      RULE_PRESENTATION_POI_ORPHAN,
      RULE_PRESENTATION_POI_MISSING,
      'warning',
      'error',
    ),
  );

  // presentation.recipe orphan/missing
  issues.push(
    ...checkPresentationOrphanMissing(
      graph,
      'recipe.template',
      'presentation.recipe',
      RULE_PRESENTATION_RECIPE_ORPHAN,
      RULE_PRESENTATION_RECIPE_MISSING,
      'warning',
      'error',
    ),
  );

  // P4 新增：presentation.enemy orphan/missing
  issues.push(
    ...checkPresentationOrphanMissing(
      graph,
      'enemy.template',
      'presentation.enemy',
      RULE_PRESENTATION_ENEMY_ORPHAN,
      RULE_PRESENTATION_ENEMY_MISSING,
      'warning',
      'error',
    ),
  );

  // P4 新增：presentation.enemy.fallback_redundant
  issues.push(...checkPresentationEnemyFallbackRedundant());

  // ── 未注册 refKind 的规则（P0 阶段跳过） ──────────────────
  //
  // 以下规则因 refKind 未注册（presentation.itmk / effect.skill /
  // combat.skill / presentation.tag），P0 阶段跳过检查。
  // P1+ 阶段注册对应 kind 后补全。
  //
  // P3 已生效的规则（不再跳过）：
  //   - RULE_POI_MECHANIC_VALUE_REF_DANGLING（条件引用，独立函数实现）
  //   - RULE_POI_DISMANTLE_RETURNS_REF_DANGLING（checkRefFields 通用引擎）
  //   - RULE_POI_INTERACTIONS_ITEM_REF_DANGLING（辅助索引 + 独立函数）
  //   - RULE_POI_INTERACTIONS_POI_MECHANIC_UNKNOWN（辅助索引 + 独立函数）
  //
  // P4 已生效的规则（不再跳过）：
  //   - RULE_DISTRIBUTION_SCATTER_ITEM_REF_DANGLING（统一模型 'subject.item_id'）
  //   - RULE_DISTRIBUTION_ENEMY_ENEMY_TYPE_REF_DANGLING（统一模型 'subject.enemy_type'）
  //   - RULE_ENEMY_SKILL_REF_DANGLING（effect.skill 虚拟节点，从 combat_skills/*.php 派生）
  //   - RULE_ENEMY_COMBAT_SKILL_NOT_IN_SKILLS（combat_skills ⊂ skills 子集校验）
  //   - RULE_ENEMY_STRATEGY_SLOT_INVALID（strategy_slots 结构校验）
  //   - RULE_PRESENTATION_ENEMY_ORPHAN / RULE_PRESENTATION_ENEMY_MISSING
  //   - RULE_PRESENTATION_ENEMY_FALLBACK_REDUNDANT
  //
  // 仍跳过的规则（不 emit issue，避免污染 UI）：
  //   - RULE_ITEM_TABLE_ITMK_UNKNOWN（待 presentation.itmk 注册）
  //   - RULE_ITEM_TABLE_USE_EFFECT_UNKNOWN（待 effect.skill 注册）
  //   - RULE_ITEM_TABLE_TAG_UNKNOWN（待 presentation.tag 注册）
  //   - RULE_RECIPE_MATERIAL_ITMK_UNKNOWN（待 presentation.itmk 注册）
  //   - RULE_RECIPE_MATERIAL_TAG_UNKNOWN（待 presentation.tag 注册）
  //   - RULE_PRESENTATION_ITMK_ORPHAN（待 presentation.itmk 注册）
  //   - RULE_PRESENTATION_ITMK_MISSING（待 presentation.itmk 注册）

  return issues;
}

// ─── 未注册 refKind 规则 ID 常量（P1+ 启用） ───────────────────
//
// 这些常量在 P0 阶段未被引用，但保留声明以便 P1+ 阶段直接启用。
// 用 const 声明避免 TS 未使用警告（通过 void 操作消费）。
// P4 已启用的 RULE_ENEMY_SKILL_REF_DANGLING 不再在此列表中。
void [
  RULE_ITEM_TABLE_ITMK_UNKNOWN,
  RULE_ITEM_TABLE_USE_EFFECT_UNKNOWN,
  RULE_ITEM_TABLE_TAG_UNKNOWN,
  RULE_RECIPE_MATERIAL_ITMK_UNKNOWN,
  RULE_RECIPE_MATERIAL_TAG_UNKNOWN,
  RULE_PRESENTATION_ITMK_ORPHAN,
  RULE_PRESENTATION_ITMK_MISSING,
];

// ─── findNode 占位消费（避免未使用导入警告） ───────────────────
// findNode 在 checkRefFields 内部未直接使用，但保留供 P1+ 扩展使用。
void findNode;
