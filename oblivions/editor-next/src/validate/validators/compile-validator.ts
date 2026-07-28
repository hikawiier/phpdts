/**
 * @module O 内容工具箱
 *
 * 第 7 层：编译校验（P5-3 实现，执行案 §4.8.1）。
 *
 * 设计意图：
 * - 编译前最终拦截——检查 graph 状态是否可编译、是否缺少必填资源
 * - 编译时诊断转换——content-compiler 八步管道产生的 BuildDiagnostic 通过
 *   convertBuildDiagnostics 转换为 Issue[]，供 O-10 校验面板统一展示
 * - 编译产物只读保护——检测手工编辑编译产物（与 product-read-only-guard.ts 协作）
 *
 * 7 个 rule ID（执行案 §4.8.1）：
 *   - compilation.php_syntax_error (error)：PHP 编译产物语法错误（content-compiler 步骤 6 emit）
 *   - compilation.ts_type_error (error)：TS 编译产物类型错误（content-compiler 步骤 6 emit）
 *   - compilation.anchor_validation_failed (error)：设计锚点校验失败（content-compiler 步骤 6 emit）
 *   - compilation.target_file_missing (error)：编译产物目标文件缺失（本层预校验 + content-compiler emit）
 *   - compilation.round_trip_inconsistent (warning)：round-trip 不一致（content-compiler 步骤 6 emit）
 *   - compilation.byte_unstable (warning)：字节不稳定（content-compiler 步骤 6 emit）
 *   - compilation.product_manually_edited (error)：编译产物被手工编辑（本层 + product-read-only-guard.ts）
 *
 * 分工约定：
 * - 本 validate(graph, changeSet?) 函数负责编译前预校验——检查 graph 是否有足够节点
 *   生成所有目标文件；检查 rawFilesStore 缓存的文件头是否含 AUTO-GENERATED 注释
 * - convertBuildDiagnostics() 负责把编译时 BuildDiagnostic 转换为 Issue——供
 *   validateStore 在编译完成后调用，把 content-compiler 的诊断合并到 O-10 报告
 * - product-read-only-guard.ts 负责工具箱启动时的全量文件头扫描（异步，不在此处）
 *
 * 数据源：
 * - graph-store：检查各 projectable kind 是否有节点
 * - rawFilesStore：检查编译产物文件头（仅缓存中的文件）
 */

import type { Issue } from '../issue-model';
import { makeIssue } from '../issue-model';
import type { GraphStore, ChangeSet } from '../quick-fixes';
import { findNodesByKind } from '@/graph/queries';
import { useRawFilesStore } from '@/stores/rawFilesStore';
import type { BuildDiagnostic } from '@/build/atomic-publisher';

// ─── 规则 ID 常量 ──────────────────────────────────────────────

const RULE_COMPILATION_PHP_SYNTAX_ERROR = 'compilation.php_syntax_error';
const RULE_COMPILATION_TS_TYPE_ERROR = 'compilation.ts_type_error';
const RULE_COMPILATION_ANCHOR_VALIDATION_FAILED = 'compilation.anchor_validation_failed';
const RULE_COMPILATION_TARGET_FILE_MISSING = 'compilation.target_file_missing';
const RULE_COMPILATION_ROUND_TRIP_INCONSISTENT = 'compilation.round_trip_inconsistent';
const RULE_COMPILATION_BYTE_UNSTABLE = 'compilation.byte_unstable';
const RULE_COMPILATION_PRODUCT_MANUALLY_EDITED = 'compilation.product_manually_edited';

// ─── 可投影 kind → 目标文件映射 ────────────────────────────────

/**
 * 可投影 kind → 目标编译产物文件的映射（执行案 §4.3.2 / §4.3.3）。
 *
 * 用于 target_file_missing 预校验：如果某 kind 在 graph 中无节点，
 * 对应的编译产物文件将为空或缺失，触发 error。
 *
 * 注：poi_interactions.php 没有对应的 kind（P5 不编辑），不在本映射中。
 */
const KIND_TO_TARGET_FILE: ReadonlyArray<{ kind: string; filePath: string }> = [
  // PHP gamedata (11)
  { kind: 'item.template', filePath: 'oblivions/gamedata/item_table.php' },
  { kind: 'recipe.template', filePath: 'oblivions/gamedata/recipe_table.php' },
  { kind: 'poi.template', filePath: 'oblivions/gamedata/poi_table.php' },
  { kind: 'loot.table', filePath: 'oblivions/gamedata/loot_tables.php' },
  { kind: 'distribution.poi', filePath: 'oblivions/gamedata/poi_pool.php' },
  { kind: 'distribution.scatter', filePath: 'oblivions/gamedata/scatter_pool.php' },
  { kind: 'enemy.template', filePath: 'oblivions/gamedata/enemies_config.php' },
  { kind: 'distribution.enemy', filePath: 'oblivions/gamedata/enemy_pool.php' },
  { kind: 'config.runtime', filePath: 'oblivions/gamedata/obl_config.php' },
  { kind: 'combat.skill', filePath: 'oblivions/gamedata/combat_skill_config.php' },
  { kind: 'skill.definition', filePath: 'oblivions/gamedata/skill_definition_config.php' },
  // TS locale (9)
  { kind: 'presentation.item', filePath: 'vex-vue/src/data/item-locale.ts' },
  { kind: 'presentation.recipe', filePath: 'vex-vue/src/data/recipe-locale.ts' },
  { kind: 'presentation.poi', filePath: 'vex-vue/src/data/poi-locale.ts' },
  { kind: 'presentation.enemy', filePath: 'vex-vue/src/data/enemy-locale.ts' },
  { kind: 'presentation.terrain', filePath: 'vex-vue/src/data/terrain-desc.ts' },
  { kind: 'presentation.itmk', filePath: 'vex-vue/src/data/itmk-locale.ts' },
  { kind: 'presentation.tag', filePath: 'vex-vue/src/data/tag-locale.ts' },
  { kind: 'presentation.status', filePath: 'vex-vue/src/data/status-locale.ts' },
  { kind: 'presentation.ui', filePath: 'vex-vue/src/data/ui-locale.ts' },
];

/**
 * 编译产物文件头标识——AUTO-GENERATED 注释（执行案 §4.8.2）。
 *
 * PHP 文件：`// AUTO-GENERATED FROM oblivions/content/...`
 * TS 文件：`// AUTO-GENERATED FROM oblivions/content/...`
 *
 * 缺失或被修改即视为手工编辑，触发 product_manually_edited error。
 */
const AUTO_GENERATED_MARKER = 'AUTO-GENERATED FROM';

// ─── 第 7 层校验入口 ──────────────────────────────────────────

/**
 * 第 7 层校验——编译校验。
 *
 * 编译前预校验：
 *   1. target_file_missing：检查每个可投影 kind 是否有节点（无节点 → 对应文件将缺失）
 *   2. product_manually_edited：检查 rawFilesStore 缓存的编译产物文件头（若有）
 *
 * 编译时检查（php_syntax_error / ts_type_error / anchor_validation_failed /
 * round_trip_inconsistent / byte_unstable）由 content-compiler 八步管道 emit 为
 * BuildDiagnostic，调用方通过 convertBuildDiagnostics 转换为 Issue 后合并到 O-10 报告。
 *
 * @param graph graph-store 实例
 * @param changeSet Change Set（可选，P5-3 阶段不使用）
 * @returns Issue[]——编译前预校验问题
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function validate(_graph: GraphStore, _changeSet?: ChangeSet): Issue[] {
  const issues: Issue[] = [];

  // 1. target_file_missing：检查每个可投影 kind 是否有节点
  issues.push(...checkTargetFileMissing(_graph));

  // 2. product_manually_edited：检查 rawFilesStore 缓存的文件头
  issues.push(...checkProductManuallyEdited());

  return issues;
}

// ─── 编译时诊断转换 ────────────────────────────────────────────

/**
 * 把 content-compiler 的 BuildDiagnostic[] 转换为 O-10 Issue[]（执行案 §4.8.1）。
 *
 * 设计意图：
 * - content-compiler 八步管道 emit BuildDiagnostic（含 ruleId / severity / message / file 等）
 * - O-10 校验面板统一使用 Issue 结构（含 resourceRef / sourceAnchor 等）
 * - 本函数负责桥接：BuildDiagnostic.file → Issue.resourceRef = { kind: 'file', id: filePath }
 *
 * 已知 ruleId（执行案 §4.8.1）：
 *   - compilation.php_syntax_error → error
 *   - compilation.ts_type_error → error
 *   - compilation.anchor_validation_failed → error
 *   - compilation.target_file_missing → error
 *   - compilation.round_trip_inconsistent → warning
 *   - compilation.byte_unstable → warning
 *   - compilation.product_manually_edited → error
 *
 * 其他 ruleId（如 compilation.atomic_replace_failed / compilation.backup_creation_failed 等
 * 管道执行错误）保留原 severity 转换——这些是编译管道内部错误，O-10 面板展示但不属于
 * 7 个编译校验规则。
 *
 * @param diagnostics content-compiler emit 的 BuildDiagnostic 列表
 * @returns Issue[]——可直接合并到 O-10 校验报告
 */
export function convertBuildDiagnostics(diagnostics: BuildDiagnostic[]): Issue[] {
  return diagnostics.map((diag) => {
    const filePath = diag.file ?? 'unknown';
    return makeIssue({
      ruleId: diag.ruleId,
      severity: diag.severity === 'info' ? 'warning' : diag.severity,
      message: diag.message,
      resourceRef: { kind: 'file', id: filePath },
      hint: diag.source ? `来源：${diag.source}` : undefined,
    });
  });
}

// ─── 子检查实现 ────────────────────────────────────────────────

/**
 * 检查 target_file_missing——每个可投影 kind 是否有节点。
 *
 * 如果某 kind 在 graph 中无节点，对应的目标编译产物文件将为空或缺失，
 * 触发 error（执行案 §4.8.1）。
 *
 * 边界案例：
 * - config.runtime 是特殊的——obl_config.php 即使无节点也应保留默认值，
 *   但 P5 单源编译后 config.runtime 必须有节点才能投影；无节点 → error
 * - presentation.* kind 无节点意味着对应 locale 文件将为空——error
 */
function checkTargetFileMissing(graph: GraphStore): Issue[] {
  const issues: Issue[] = [];

  for (const { kind, filePath } of KIND_TO_TARGET_FILE) {
    const nodes = graph.findNodesByKind(kind);
    if (nodes.length === 0) {
      issues.push(
        makeIssue({
          ruleId: RULE_COMPILATION_TARGET_FILE_MISSING,
          severity: 'error',
          message: `可投影 kind "${kind}" 无节点，编译产物 ${filePath} 将缺失——请在工具箱中创建对应资源`,
          resourceRef: { kind: 'file', id: filePath },
          hint: `在工具箱对应工作区添加 ${kind} 资源`,
        }),
      );
    }
  }

  return issues;
}

/**
 * 检查 product_manually_edited——编译产物文件头是否含 AUTO-GENERATED 注释。
 *
 * 设计意图（执行案 §4.8.2）：
 * - 编译产物头部应有 `// AUTO-GENERATED FROM oblivions/content/...` 注释
 * - 缺失或被修改即视为手工编辑，触发 error
 * - 工具箱启动时由 product-read-only-guard.ts 做全量扫描
 * - 本函数仅检查 rawFilesStore 缓存中的文件（同步可用）
 *
 * 边界案例：
 * - rawFilesStore 不缓存编译产物（它们由适配器解析后入 graph）——本函数通常返回空
 * - 文件未迁移到单源编译时（P5 迁移前）无 AUTO-GENERATED 注释，不视为错误
 * - 仅当文件头有其他 AUTO-GENERATED 标识但被修改时才触发——避免误报
 */
function checkProductManuallyEdited(): Issue[] {
  const issues: Issue[] = [];
  const rawFilesStore = useRawFilesStore();

  for (const { filePath } of KIND_TO_TARGET_FILE) {
    const content = rawFilesStore.getRawFile(filePath);
    if (content === undefined) continue; // 未缓存的文件跳过

    // 检查文件头（前 500 字符足够覆盖注释）
    const header = content.slice(0, 500);

    // 文件包含 AUTO-GENERATED 标识但格式异常——视为手工修改
    // 注：P5 迁移前的文件无此标识，不触发；迁移后的文件应有此标识
    if (header.includes('AUTO-GENERATED')) {
      // 有标识——检查是否被破坏（如标识被注释掉或修改）
      if (!header.includes(AUTO_GENERATED_MARKER)) {
        issues.push(
          makeIssue({
            ruleId: RULE_COMPILATION_PRODUCT_MANUALLY_EDITED,
            severity: 'error',
            message: `编译产物 ${filePath} 的 AUTO-GENERATED 注释可能被手工修改——请编辑 oblivions/content/ 下的作者资源后重新编译`,
            resourceRef: { kind: 'file', id: filePath },
            hint: '请编辑 oblivions/content/ 下的作者资源，然后重新编译',
          }),
        );
      }
    }
  }

  return issues;
}

// ─── 规则 ID 导出（供 validate-rules.ts 注册） ─────────────────

export const COMPILE_VALIDATOR_RULE_IDS = [
  RULE_COMPILATION_PHP_SYNTAX_ERROR,
  RULE_COMPILATION_TS_TYPE_ERROR,
  RULE_COMPILATION_ANCHOR_VALIDATION_FAILED,
  RULE_COMPILATION_TARGET_FILE_MISSING,
  RULE_COMPILATION_ROUND_TRIP_INCONSISTENT,
  RULE_COMPILATION_BYTE_UNSTABLE,
  RULE_COMPILATION_PRODUCT_MANUALLY_EDITED,
] as const;

// 引用 findNodesByKind 避免未使用警告（本文件使用 graph.findNodesByKind 实例方法）
void findNodesByKind;
