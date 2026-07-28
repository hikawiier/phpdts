/**
 * @module O 内容工具箱
 *
 * 浏览器安全的构建常量——从 content-compiler.ts 和 migration-flow.ts 提取，
 * 避免浏览器端拉入 node:child_process / node:fs 等 Node.js 依赖。
 *
 * MigrationConfirmModal.vue / BuildView.vue 等浏览器组件从此文件导入常量，
 * 而非从 content-compiler.ts / migration-flow.ts 导入。
 */

/**
 * 编译目标文件清单——九步管道第 5 步「临时目录生成」使用。
 *
 * 顺序按 PHP gamedata (12) + TS locale (9) 排列。
 * content-compiler.ts 从本文件 re-export 此常量。
 */
export const COMPILATION_TARGET_FILES: readonly string[] = [
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
 * 迁移步骤类型——与 migration-flow.ts 的 MigrationStep 保持同步。
 */
export type MigrationStep =
  | 'backup'
  | 'create_dirs'
  | 'reverse_project'
  | 'write_yaml'
  | 'forward_compile'
  | 'round_trip_verify'
  | 'finalize';

/**
 * 迁移步骤标签——UI 显示用。键为 MigrationStep，值为中文标签。
 *
 * migration-flow.ts 从本文件 re-export 此常量。
 */
export const MIGRATION_STEP_LABELS: Record<MigrationStep, string> = {
  backup: '备份原文件',
  create_dirs: '创建 oblivions/content/ 目录',
  reverse_project: '逆向投影 PHP/TS → YAML 数据',
  write_yaml: '写入 YAML 作者资源',
  forward_compile: '正向编译生成 PHP/TS 产物',
  round_trip_verify: 'round-trip 一致性验证',
  finalize: '完成迁移',
};
