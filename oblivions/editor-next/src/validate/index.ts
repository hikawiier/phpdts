/**
 * @module O 内容工具箱
 *
 * 校验模块导出聚合。
 *
 * 模块结构：
 *   - issue-model.ts：统一问题模型（Issue / Severity / ValidationLayer）
 *   - quick-fixes.ts：QuickFix 类型与注册表
 *   - validators/：8 层校验器与调度入口
 *
 * 使用方式：
 *   import { runLight, runFull, runAll } from '@/validate';
 *   const issues = runLight(graphStore);
 */

export type { Issue, Severity, ValidationLayer, ResourceRef } from './issue-model';
export { makeIssue } from './issue-model';
export type { QuickFix, GraphStore, ChangeSet } from './quick-fixes';
export { quickFixRegistry, QuickFixRegistry } from './quick-fixes';
export {
  VALIDATOR_LAYERS,
  getValidatorLayer,
  runLayer,
  runLayers,
  runLight,
  runFull,
  runAll,
} from './validators';
export type { ValidatorLayerMeta } from './validators';
