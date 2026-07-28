// @module O 内容工具箱
//
// useTileSelector：可复用地图选择器（对齐 P1 执行案 §4.9.1）
//
// 研判：
//   - 单格选择 / 批量选择 / 两步点击第一步是编辑器的三类核心选择状态
//   - 现状：selectedPls 持有在 projectStore，batchSelection / breakFirst 持有在 toolStore
//   - 抽出 composable 后，分布规则（P3/P4）与引用导航可通过同一入口访问选择状态
//   - 不引入新 state：所有 actions 内部调用 projectStore / toolStore 的原始 action
//   - 保留原始 action 导出，避免破坏 useToolActions / GridCanvas / TilePanel 等现有调用方
//
// 边界：
//   - getSelectedTileIds 把 batchSelection 转为 `${pgroup}:${pls}` 格式（world.tile 节点 id）
//   - currentPgroup 为 null 时 getSelectedTileIds 返回空数组（类型安全）
//   - clearAll 同时清空 selectedPls / batchSelection / breakFirst，用于切换工作区等场景
//   - 切换 pgroup 自动清空 batchSelection / breakFirst 的行为仍由 toolStore.setTool 维护
//     （不在 composable 层重复实现，避免双源真相）

import { computed, type ComputedRef } from 'vue';
import { useProjectStore } from '@/stores/projectStore';
import { useToolStore } from '@/stores/toolStore';
import type { Pls, Pgroup } from '@/shared';

export function useTileSelector() {
  const project = useProjectStore();
  const tool = useToolStore();

  // ─── state（从 projectStore / toolStore 派生） ───────
  /** 单选 pls（select 工具选中 / draw 工具点击已有格时同步） */
  const selectedPls: ComputedRef<Pls | null> = computed(() => project.selectedPls);
  /** 批量选择 pls 数组（batch-select 工具下累积） */
  const batchSelection: ComputedRef<Pls[]> = computed(() => tool.batchSelection);
  /** break / restore 两步点击的第一步 pls（null 表示尚未开始） */
  const breakFirst: ComputedRef<Pls | null> = computed(() => tool.breakFirst);

  // ─── actions（代理到原始 store action） ──────────────

  /**
   * 设置单选 pls
   *
   * 传 null 清空单选（用于切换 pgroup / 删除当前格后等场景）
   */
  function selectTile(pls: Pls | null): void {
    project.setSelectedPls(pls);
  }

  /**
   * 切换 pls 在批量选择中的状态
   *
   * 已在批量中 → 移出；不在 → 加入。与 toolStore.toggleBatchSelection 等价。
   */
  function toggleBatch(pls: Pls): void {
    tool.toggleBatchSelection(pls);
  }

  /**
   * 替换批量选择（用于框选 selectRect 等场景）
   */
  function setBatchSelection(plsList: Pls[]): void {
    tool.setBatchSelection(plsList);
  }

  /**
   * 清空批量选择（保留单选与 breakFirst）
   */
  function clearBatchSelection(): void {
    tool.clearBatchSelection();
  }

  /**
   * 设置 break / restore 两步点击的第一步 pls
   *
   * 传 null 表示取消两步点击状态（再次点击同一格 / 切换工具时触发）
   */
  function setBreakFirst(pls: Pls | null): void {
    tool.setBreakFirst(pls);
  }

  /**
   * 清空所有选择状态（单选 + 批量 + 两步点击）
   *
   * 用于切换工作区 / 关闭编辑器等需要彻底重置的场景
   */
  function clearAll(): void {
    project.setSelectedPls(null);
    tool.setBatchSelection([]);
    tool.setBreakFirst(null);
  }

  // ─── 派生查询（供分布规则 / 渲染层复用） ─────────────

  /**
   * 返回当前批量选择的 world.tile 节点 id 列表
   *
   * 格式：['${pgroup}:${pls}', ...]，与 graph-store 中 world.tile 节点 id 一致
   * 用于分布规则（P3/P4）的 selector.tileIds 字段
   *
   * currentPgroup 为 null 时返回空数组（无活跃区域，无批量选择意义）
   */
  function getSelectedTileIds(): string[] {
    const pgroup: Pgroup | null = project.currentPgroup;
    if (pgroup === null) return [];
    return tool.batchSelection.map((pls) => `${pgroup}:${pls}`);
  }

  /**
   * 判断指定 pls 是否为当前单选格
   */
  function isTileSelected(pls: Pls): boolean {
    return project.selectedPls === pls;
  }

  /**
   * 判断指定 pls 是否在批量选择中
   */
  function isTileInBatch(pls: Pls): boolean {
    return tool.batchSelection.includes(pls);
  }

  return {
    // state（派生 computed）
    selectedPls,
    batchSelection,
    breakFirst,
    // actions
    selectTile,
    toggleBatch,
    setBatchSelection,
    clearBatchSelection,
    setBreakFirst,
    clearAll,
    // 派生查询
    getSelectedTileIds,
    isTileSelected,
    isTileInBatch,
  };
}
