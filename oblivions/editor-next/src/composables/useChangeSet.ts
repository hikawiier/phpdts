/**
 * @module O 内容工具箱
 *
 * ChangeSet 模块级单例 composable——P3 阶段 DriftReport quick fix 入口。
 *
 * 设计意图（执行案 §4.6.3 / §4.7.3）：
 *   - P5 单源编译阶段才会由 main.ts 全局注入 ChangeSet 实例（P0-H TODO）；
 *     P3 的 O-9 呈现工作区 quick fix 提前需要一个可用的 ChangeSet 入口，
 *     用于把"修复 locked_door / locked_chest 漂移"登记为 pending add。
 *   - 模块级单例 + composable 包装：与 useTemplateActions.affectedFiles 同样的
 *     单例模式，P5 切换到全局注入时只需替换本 composable 的实现，调用方零修改。
 *   - quick fix 不直接写文件——只把 BatchAddEntry 累积到 pendingChanges，
 *     受影响文件路径通过 markFilesAffected 登记。实际写入由 O-5 原子发布管道
 *     在用户点击"发布"时执行（BuildView.handlePublish）。
 *
 * 集成点：
 *   - DriftReport.vue：quick fix 按钮调用 changeSet.batchAdd + markFilesAffected
 *   - BuildView.vue：P5 接入后会读取 changeSet.computeDiff() 派生发布文件清单
 *
 * 边界：
 *   - 单例不与 graph-store 同步——quick fix 调用方需额外调用 useTemplateActions.upsertNode
 *     让 UI 立即反映变更（ChangeSet 只累积 diff，不修改图）
 *   - 单例不持久化到 localStorage——P5 接入后由 main.ts 调用 persistToLocalStorage
 */

import { ChangeSet } from '@/build/change-set';

/**
 * 模块级单例——整个应用共享一个 ChangeSet 实例。
 *
 * 懒初始化：首次调用 useChangeSet() 时创建。后续调用复用同一实例。
 */
let _instance: ChangeSet | null = null;

/**
 * 获取 ChangeSet 单例。
 *
 * 使用方式：
 *   import { useChangeSet } from '@/composables/useChangeSet';
 *   const changeSet = useChangeSet();
 *   changeSet.batchAdd([{ nodeId: 'presentation.poi:locked_door', newData: { name: '...', desc: '...' } }]);
 *   changeSet.markFilesAffected(['vex-vue/src/data/poi-locale.ts']);
 */
export function useChangeSet(): ChangeSet {
  if (_instance === null) {
    _instance = new ChangeSet();
  }
  return _instance;
}

/**
 * 重置单例——仅供测试使用。
 *
 * 生产代码禁止调用。测试用例间隔离时使用。
 */
export function resetChangeSetInstance(): void {
  _instance = null;
}
