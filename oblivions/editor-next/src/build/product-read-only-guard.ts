/**
 * @module O 内容工具箱
 *
 * 编译产物只读保护（执行案 §4.8.2）。
 *
 * 设计意图：
 * - P5 单源编译完成后，oblivions/gamedata/ 与 vex-vue/src/data/ 下的文件全部成为
 *   确定性编译产物，工具箱拒绝直接编辑
 * - 通过文件头 `// AUTO-GENERATED FROM oblivions/content/...` 注释识别编译产物
 * - 工具箱启动时全量扫描编译产物文件头，检测手工编辑
 * - 用户尝试直接编辑编译产物时，UI 拒绝并提示"请编辑 oblivions/content/ 下的作者资源"
 *
 * 例外（P5 阶段不进入只读保护）：
 * - map.php / tiles/region_*.php：仍由 P1 projectStore 管理
 * - poi_interactions.php：P5 暂不编辑，原样保留
 * - battle-templates.ts / command-feedback.ts / log-templates.ts / skill-templates.ts：
 *   含渲染函数逻辑，P5 不纳入投影器清单
 *
 * 运行环境：
 * - 本模块为 server 端模块（与 atomic-publisher.ts / content-compiler.ts 同级），
 *   直接 import fs。
 * - 浏览器端通过 Gateway /read-only-scan 路由（后续任务实现）间接调用。
 * - isReadOnlyProduct() 是纯函数，可浏览器端直接使用（路径模式匹配，不读文件）。
 *
 * 关键不变量：
 * - 只读保护范围 = COMPILATION_TARGET_FILES（21 文件）
 * - 文件头检测范围 = 前 500 字符（足够覆盖 AUTO-GENERATED 注释）
 * - 缺失 AUTO-GENERATED 标识不视为违规（P5 迁移前的文件无此标识）
 * - 只有标识被修改或破坏才视为违规
 */

import fs from 'node:fs';
import path from 'node:path';
import type { BuildDiagnostic } from './atomic-publisher';

// ─── 常量 ──────────────────────────────────────────────────────

/**
 * 编译产物目标文件清单（21 文件 = 12 PHP + 9 TS）。
 *
 * 与 content-compiler.COMPILATION_TARGET_FILES 对齐——只读保护范围 = 编译产物范围。
 * poi_interactions.php 在 P5 阶段不编辑但进入只读保护（避免手工修改污染）。
 */
const READ_ONLY_TARGET_FILES: readonly string[] = [
  // PHP gamedata (12)
  'oblivions/gamedata/item_table.php',
  'oblivions/gamedata/recipe_table.php',
  'oblivions/gamedata/poi_table.php',
  'oblivions/gamedata/loot_tables.php',
  'oblivions/gamedata/poi_pool.php',
  'oblivions/gamedata/scatter_pool.php',
  'oblivions/gamedata/enemies_config.php',
  'oblivions/gamedata/enemy_pool.php',
  'oblivions/gamedata/obl_config.php',
  'oblivions/gamedata/combat_skill_config.php',
  'oblivions/gamedata/skill_definition_config.php',
  'oblivions/gamedata/poi_interactions.php',
  // TS locale (9)
  'vex-vue/src/data/item-locale.ts',
  'vex-vue/src/data/recipe-locale.ts',
  'vex-vue/src/data/poi-locale.ts',
  'vex-vue/src/data/enemy-locale.ts',
  'vex-vue/src/data/terrain-desc.ts',
  'vex-vue/src/data/itmk-locale.ts',
  'vex-vue/src/data/tag-locale.ts',
  'vex-vue/src/data/status-locale.ts',
  'vex-vue/src/data/ui-locale.ts',
];

/**
 * 编译产物文件头标识——AUTO-GENERATED 注释（执行案 §4.8.2）。
 *
 * PHP 文件：`// AUTO-GENERATED FROM oblivions/content/...`
 * TS 文件：`// AUTO-GENERATED FROM oblivions/content/...`
 *
 * 缺失不视为违规（P5 迁移前文件无此标识）；只有标识被修改或破坏才视为违规。
 */
const AUTO_GENERATED_MARKER = 'AUTO-GENERATED FROM';

/**
 * 文件头检测范围——前 500 字符足够覆盖 AUTO-GENERATED 注释。
 */
const HEADER_SCAN_LENGTH = 500;

// ─── 类型 ──────────────────────────────────────────────────────

/**
 * 只读保护违规——编译产物被手工编辑或缺头标识。
 *
 * - missing_marker：文件存在但无 AUTO-GENERATED 标识（P5 迁移后应缺失标识才报）
 * - modified_marker：AUTO-GENERATED 标识被修改或破坏
 * - file_missing：编译产物文件不存在（应有却缺失）
 */
export interface ReadOnlyViolation {
  filePath: string;
  reason: 'missing_marker' | 'modified_marker' | 'file_missing';
  message: string;
}

/**
 * 扫描选项。
 *
 * - workspaceRoot：工作区根路径
 * - requireMarker：是否要求所有文件都有 AUTO-GENERATED 标识（默认 false）
 *   - false：P5 迁移前模式，缺失标识不视为违规（避免误报）
 *   - true：P5 迁移后模式，所有文件必须有标识（缺失视为违规）
 */
export interface ScanOptions {
  workspaceRoot: string;
  requireMarker?: boolean;
}

// ─── 纯函数：路径检查（浏览器端可直接使用） ────────────────────

/**
 * 判断文件路径是否属于只读编译产物（执行案 §4.8.2）。
 *
 * 纯函数——不读文件，只做路径模式匹配。浏览器端可直接使用。
 *
 * 用法：
 *   - UI 编辑器在用户尝试编辑文件前调用本函数检查
 *   - 如果返回 true，UI 拒绝编辑并提示"请编辑 oblivions/content/ 下的作者资源"
 *
 * @param filePath 工作区相对路径（如 'oblivions/gamedata/item_table.php'）
 * @returns true=只读编译产物；false=可编辑文件
 */
export function isReadOnlyProduct(filePath: string): boolean {
  // 标准化路径分隔符（Windows → Unix）
  const normalized = filePath.replace(/\\/g, '/');
  return READ_ONLY_TARGET_FILES.includes(normalized);
}

/**
 * 断言文件路径不属于只读编译产物——如果属于则抛错。
 *
 * 浏览器端 UI 编辑器调用入口：
 *   try {
 *     assertNotReadOnly(filePath);
 *     // 继续编辑...
 *   } catch (err) {
 *     // 显示提示："请编辑 oblivions/content/ 下的作者资源，然后重新编译"
 *   }
 *
 * @param filePath 工作区相对路径
 * @throws Error 如果文件属于只读编译产物
 */
export function assertNotReadOnly(filePath: string): void {
  if (isReadOnlyProduct(filePath)) {
    throw new Error(
      `文件 ${filePath} 是编译产物（只读保护）——请编辑 oblivions/content/ 下的作者资源，然后重新编译`,
    );
  }
}

// ─── Server 端：全量扫描（通过 Gateway 调用） ──────────────────

/**
 * 扫描所有编译产物文件头，检测手工编辑（执行案 §4.8.2）。
 *
 * 工具箱启动时由 server 端调用（经 Gateway /read-only-scan 路由）：
 *   - 检查每个目标文件是否存在
 *   - 检查文件头是否含 AUTO-GENERATED FROM 标识
 *   - 标识被修改或破坏 → modified_marker 违规
 *   - 文件不存在 → file_missing 违规
 *   - requireMarker=true 且无标识 → missing_marker 违规（P5 迁移后模式）
 *
 * @param options 扫描选项
 * @returns ReadOnlyViolation[]——违规列表（空数组=无违规）
 */
export async function scanProductReadOnlyViolations(
  options: ScanOptions,
): Promise<ReadOnlyViolation[]> {
  const { workspaceRoot } = options;
  const requireMarker = options.requireMarker ?? false;
  const violations: ReadOnlyViolation[] = [];

  for (const filePath of READ_ONLY_TARGET_FILES) {
    const absPath = path.resolve(workspaceRoot, filePath);

    // 检查文件是否存在
    let content: string;
    try {
      content = await fs.promises.readFile(absPath, 'utf8');
    } catch {
      violations.push({
        filePath,
        reason: 'file_missing',
        message: `编译产物 ${filePath} 不存在——请运行编译管道生成`,
      });
      continue;
    }

    // 检查文件头
    const header = content.slice(0, HEADER_SCAN_LENGTH);
    const hasMarker = header.includes(AUTO_GENERATED_MARKER);
    const hasAnyAutoGenerated = header.includes('AUTO-GENERATED');

    if (hasMarker) {
      // 标识完整——无违规
      continue;
    }

    if (hasAnyAutoGenerated && !hasMarker) {
      // 有 AUTO-GENERATED 字样但格式异常——视为手工修改
      violations.push({
        filePath,
        reason: 'modified_marker',
        message: `编译产物 ${filePath} 的 AUTO-GENERATED 注释被手工修改——请编辑 oblivions/content/ 下的作者资源后重新编译`,
      });
      continue;
    }

    // 无 AUTO-GENERATED 标识
    if (requireMarker) {
      // P5 迁移后模式：所有文件必须有标识
      violations.push({
        filePath,
        reason: 'missing_marker',
        message: `编译产物 ${filePath} 缺少 AUTO-GENERATED 注释——可能未迁移到单源编译或被手工删除注释`,
      });
    }
    // requireMarker=false（P5 迁移前模式）：无标识不视为违规
  }

  return violations;
}

/**
 * 把 ReadOnlyViolation[] 转换为 BuildDiagnostic[]（执行案 §4.8.2）。
 *
 * 供 compile-validator.ts 的 convertBuildDiagnostics 使用——把只读保护违规
 * 转换为 O-10 Issue[] 供校验面板展示。
 *
 * @param violations 只读保护违规列表
 * @returns BuildDiagnostic[]——可传入 convertBuildDiagnostics 转为 Issue[]
 */
export function violationsToDiagnostics(
  violations: ReadOnlyViolation[],
): BuildDiagnostic[] {
  return violations.map((v) => ({
    severity: 'error' as const,
    ruleId: 'compilation.product_manually_edited',
    message: v.message,
    file: v.filePath,
    source: 'product-read-only-guard',
  }));
}

// ─── 导出常量 ──────────────────────────────────────────────────

/**
 * 只读保护目标文件清单（供外部查询）。
 */
export const READ_ONLY_FILES: readonly string[] = READ_ONLY_TARGET_FILES;
