/**
 * @module O 内容工具箱
 *
 * Schema 模块导出聚合 + registerAllKinds() 入口。
 *
 * 集成提示（P0-H 任务）：main.ts 必须在 `createApp(App).use(...)` 之前调用
 * `registerAllKinds()`，确保 Pinia store 初始化时所有 kind schema 已就位。
 *
 * 示例：
 * ```ts
 * import { registerAllKinds } from '@/schema';
 *
 * registerAllKinds();
 * const app = createApp(App);
 * app.use(createPinia());
 * app.mount('#app');
 * ```
 *
 * 重复注册策略由 registry.registerKind 处理：dev 模式立即抛错，prod 模式
 * 以后者为准并 emit warning。registerAllKinds() 本身不做幂等保护——多次调用
 * 会触发 registry 的重复注册分支。如需在测试中重置，先调用 clearRegistry()。
 */

// 重新导出常量值
export { BUILTIN_KINDS } from './types';

// 重新导出类型
export type {
  ResourceKind,
  SourceFileSpec,
  ParserName,
  RefFieldSpec,
  PresentationFieldSpec,
  ListColumnSpec,
  DetailGroupSpec,
  ValidatorSpec,
  CopyStrategy,
  KindSchema,
  FieldSchemaSpec,
  AuthorFormat,
  ProjectionTarget,
  AdapterFormat,
} from './types';

// 重新导出注册表 API
export {
  registerKind,
  getKindSchema,
  listKinds,
  assertKind,
  clearRegistry,
} from './registry';

// 重新导出 builtin-kinds 辅助
export { isBuiltinKind } from './builtin-kinds';

import { registerKind } from './registry';
import { worldRegionSchema } from './kinds/world-region';
import { worldTileSchema } from './kinds/world-tile';
import { itemTemplateSchema } from './kinds/item-template';
import { poiTemplateSchema } from './kinds/poi-template';
import { enemyTemplateSchema } from './kinds/enemy-template';
import { recipeTemplateSchema } from './kinds/recipe-template';
import { lootTableSchema } from './kinds/loot-table';
import { distributionScatterSchema } from './kinds/distribution-scatter';
import { distributionPoiSchema } from './kinds/distribution-poi';
import { distributionEnemySchema } from './kinds/distribution-enemy';
import { configRuntimeSchema } from './kinds/config-runtime';
import { presentationItemSchema } from './kinds/presentation-item';
import { presentationPoiSchema } from './kinds/presentation-poi';
import { presentationRecipeSchema } from './kinds/presentation-recipe';
import { presentationEnemySchema } from './kinds/presentation-enemy';
import { effectFuncSchema } from './kinds/effect-func';

/**
 * 注册首批 15 种 kind 的 schema + P2 新增 effect.func kind。
 *
 * 必须在 main.ts 的 createApp 之前调用一次。所有上层模块（O-3 graph-store、
 * O-4 adapter-registry、O-7 模板工作区、O-10 分层校验）都依赖此调用完成注册。
 *
 * effect.func 在 P2 §4.4.4 新增——它是"代码模块派生的虚拟节点"，不通过 O-4 adapter
 * 解析，而由 O-3 effect-func-builder 从 item.use_effects.func.php 提取。
 */
export function registerAllKinds(): void {
  registerKind(worldRegionSchema);
  registerKind(worldTileSchema);
  registerKind(itemTemplateSchema);
  registerKind(poiTemplateSchema);
  registerKind(enemyTemplateSchema);
  registerKind(recipeTemplateSchema);
  registerKind(lootTableSchema);
  registerKind(distributionScatterSchema);
  registerKind(distributionPoiSchema);
  registerKind(distributionEnemySchema);
  registerKind(configRuntimeSchema);
  registerKind(presentationItemSchema);
  registerKind(presentationPoiSchema);
  registerKind(presentationRecipeSchema);
  registerKind(presentationEnemySchema);
  // P2 §4.4.4：effect.func 虚拟节点 kind
  registerKind(effectFuncSchema);
}
