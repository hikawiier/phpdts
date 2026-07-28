/**
 * @module O 内容工具箱
 * @framework O-11 内容单源编译
 *
 * 逆向投影器注册中心——21 个逆向投影器的统一导出与路由表。
 *
 * 设计意图（执行案 06-P5 §4.10.1）：
 * - 把"编译产物文件路径 → 逆向投影器函数"的路由集中在一处，migration-flow 通过
 *   文件路径查表调用对应投影器，避免 switch/case 分散
 * - 21 个逆向投影器 = 12 PHP + 9 TS locale，与正向投影器一一对应（poi-interactions 桩）
 * - 每个逆向投影器遵循 ReverseProjectorFn 签名，便于统一调度
 *
 * 边界：
 * - poi-interactions-reverse-projector 是桩实现——返回 success 但不输出 YAML 资源
 * - terrain-desc-reverse-projector 独立处理（结构与其他 locale 不同）
 * - migration-flow 调用 reverseProjectByPath 时，若返回 resource=undefined 视为跳过
 */

import type { ReverseProjectorFn, ReverseProjectResult } from './types';

// PHP 逆向投影器（12 个）
import { reverseProjectItemTable } from './item-table-reverse-projector';
import { reverseProjectRecipeTable } from './recipe-table-reverse-projector';
import { reverseProjectPoiTable } from './poi-table-reverse-projector';
import { reverseProjectLootTables } from './loot-tables-reverse-projector';
import { reverseProjectPoiPool } from './poi-pool-reverse-projector';
import { reverseProjectScatterPool } from './scatter-pool-reverse-projector';
import { reverseProjectEnemiesConfig } from './enemies-config-reverse-projector';
import { reverseProjectEnemyPool } from './enemy-pool-reverse-projector';
import { reverseProjectOblConfig } from './obl-config-reverse-projector';
import { reverseProjectCombatSkillConfig } from './combat-skill-config-reverse-projector';
import { reverseProjectSkillDefinitionConfig } from './skill-definition-config-reverse-projector';
import { reverseProjectPoiInteractions } from './poi-interactions-reverse-projector';

// TS locale 逆向投影器（9 个）
import { reverseProjectItemLocale } from './item-locale-reverse-projector';
import { reverseProjectRecipeLocale } from './recipe-locale-reverse-projector';
import { reverseProjectPoiLocale } from './poi-locale-reverse-projector';
import { reverseProjectEnemyLocale } from './enemy-locale-reverse-projector';
import { reverseProjectTerrainDesc } from './terrain-desc-reverse-projector';
import { reverseProjectItmkLocale } from './itmk-locale-reverse-projector';
import { reverseProjectTagLocale } from './tag-locale-reverse-projector';
import { reverseProjectStatusLocale } from './status-locale-reverse-projector';
import { reverseProjectUiLocale } from './ui-locale-reverse-projector';

// 通用类型 re-export
export type {
  ReverseProjectOptions,
  ReverseProjectResult,
  ReverseProjectDiagnostic,
  YamlAuthorResource,
  ReverseProjectorFn,
} from './types';

// 各逆向投影器 re-export
export {
  reverseProjectItemTable,
  reverseProjectRecipeTable,
  reverseProjectPoiTable,
  reverseProjectLootTables,
  reverseProjectPoiPool,
  reverseProjectScatterPool,
  reverseProjectEnemiesConfig,
  reverseProjectEnemyPool,
  reverseProjectOblConfig,
  reverseProjectCombatSkillConfig,
  reverseProjectSkillDefinitionConfig,
  reverseProjectPoiInteractions,
  reverseProjectItemLocale,
  reverseProjectRecipeLocale,
  reverseProjectPoiLocale,
  reverseProjectEnemyLocale,
  reverseProjectTerrainDesc,
  reverseProjectItmkLocale,
  reverseProjectTagLocale,
  reverseProjectStatusLocale,
  reverseProjectUiLocale,
};

/**
 * 编译产物文件路径 → 逆向投影器函数的路由表。
 *
 * 21 个文件路径与 content-compiler.COMPILATION_TARGET_FILES 一一对应。
 * migration-flow 通过此表查表调用对应投影器。
 */
export const REVERSE_PROJECTOR_REGISTRY: ReadonlyMap<string, ReverseProjectorFn> = new Map<
  string,
  ReverseProjectorFn
>([
  // PHP gamedata (12)
  ['oblivions/gamedata/item_table.php', reverseProjectItemTable],
  ['oblivions/gamedata/recipe_table.php', reverseProjectRecipeTable],
  ['oblivions/gamedata/poi_table.php', reverseProjectPoiTable],
  ['oblivions/gamedata/loot_tables.php', reverseProjectLootTables],
  ['oblivions/gamedata/poi_pool.php', reverseProjectPoiPool],
  ['oblivions/gamedata/scatter_pool.php', reverseProjectScatterPool],
  ['oblivions/gamedata/enemies_config.php', reverseProjectEnemiesConfig],
  ['oblivions/gamedata/enemy_pool.php', reverseProjectEnemyPool],
  ['oblivions/gamedata/obl_config.php', reverseProjectOblConfig],
  ['oblivions/gamedata/combat_skill_config.php', reverseProjectCombatSkillConfig],
  ['oblivions/gamedata/skill_definition_config.php', reverseProjectSkillDefinitionConfig],
  ['oblivions/gamedata/poi_interactions.php', reverseProjectPoiInteractions],
  // TS locale (9)
  ['vex-vue/src/data/item-locale.ts', reverseProjectItemLocale],
  ['vex-vue/src/data/recipe-locale.ts', reverseProjectRecipeLocale],
  ['vex-vue/src/data/poi-locale.ts', reverseProjectPoiLocale],
  ['vex-vue/src/data/enemy-locale.ts', reverseProjectEnemyLocale],
  ['vex-vue/src/data/terrain-desc.ts', reverseProjectTerrainDesc],
  ['vex-vue/src/data/itmk-locale.ts', reverseProjectItmkLocale],
  ['vex-vue/src/data/tag-locale.ts', reverseProjectTagLocale],
  ['vex-vue/src/data/status-locale.ts', reverseProjectStatusLocale],
  ['vex-vue/src/data/ui-locale.ts', reverseProjectUiLocale],
]);

/**
 * 按编译产物文件路径调用对应逆向投影器。
 *
 * @param filePath 编译产物工作区相对路径
 * @param content 编译产物完整文件内容
 * @returns 逆向投影结果；未注册的路径返回 success=false + 诊断
 */
export function reverseProjectByPath(
  filePath: string,
  content: string,
): ReverseProjectResult {
  const fn = REVERSE_PROJECTOR_REGISTRY.get(filePath);
  if (!fn) {
    return {
      success: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'reverse_projector.not_registered',
          message: `文件路径未注册逆向投影器：${filePath}`,
        },
      ],
    };
  }
  return fn({ filePath, content });
}
