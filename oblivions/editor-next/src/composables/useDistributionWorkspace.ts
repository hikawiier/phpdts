/**
 * @module O 内容工具箱
 *
 * 分布工作区共享状态——当前选中的分布规则 + 固定 seed 模拟结果。
 *
 * 设计意图（执行案 §4.5.1 / §4.5.4）：
 *   - 三视图同步：规则表选中规则后，矩阵 / 地图叠层 / 反向查询都要响应。
 *     通过模块级 ref 共享，避免 prop 透传穿过 GridOverlay 这类无关节点。
 *   - 叠层激活：选中规则时由 DistributionView 调用 overlayStore.setFlag 对应类别
 *     激活叠层；OverlayPoiDistribution / OverlayWilditemDistribution /
 *     OverlayEnemyDistribution 各自通过本 composable 读取当前规则并按类别过滤。
 *   - 固定 seed 模拟：mulberry32 种子可复现，模拟结果（ruleId → 选中 pls 列表）
 *     缓存到模块级 Map，切回同一 seed 时不重算。
 *
 * P4 扩展：selectedRuleId 现承载三类规则（POI / scatter / enemy），由
 * inferCategoryFromRuleId 派生 selectedCategory。叠层组件按类别判断是否渲染。
 *
 * 与 useTemplateActions 同样的模块级单例模式——P5 切换到 ChangeSet 时可平移。
 */

import { computed, ref } from 'vue';
import type { Pls } from '@/shared';
import { inferCategoryFromRuleId, type DistributionCategory } from '@/schema/distribution-rule';

/** 当前选中的分布规则 ID（POI 形如 `shallow:supply_cache` / scatter 形如 `shallow:game_init:scrap_metal` / enemy 形如 `shallow:1`）；null=未选中 */
const selectedRuleId = ref<string | null>(null);

/** 当前模拟种子（正整数；0=未设置，使用随机种子） */
const simulationSeed = ref<number>(0);

/** 模拟结果：ruleId → 被选中的 pls 列表（按 region 分组合并）。null=未模拟 */
const simulatedPlacements = ref<Map<string, Pls[]> | null>(null);

/**
 * 当前选中规则的类别（poi / scatter / enemy）。
 *
 * 由 selectedRuleId 通过 inferCategoryFromRuleId 派生，未选中时为 null。
 * 用于 DistributionOverlayPanel 决定激活哪个叠层 flag。
 */
const selectedCategory = computed<DistributionCategory | null>(() => {
  if (selectedRuleId.value === null) return null;
  return inferCategoryFromRuleId(selectedRuleId.value);
});

/**
 * 分布工作区共享状态 composable。
 *
 * 用法：
 *   const ws = useDistributionWorkspace();
 *   ws.selectRule('shallow:supply_cache');
 *   ws.simulate(seed, placements);
 */
export function useDistributionWorkspace() {
  function selectRule(ruleId: string | null): void {
    selectedRuleId.value = ruleId;
    // 切换规则时清空模拟结果——不同规则的候选格集合不同
    simulatedPlacements.value = null;
  }

  function setSimulationSeed(seed: number): void {
    simulationSeed.value = seed;
  }

  function setSimulatedPlacements(placements: Map<string, Pls[]>): void {
    simulatedPlacements.value = placements;
  }

  function clearSimulation(): void {
    simulatedPlacements.value = null;
  }

  return {
    // state
    selectedRuleId,
    selectedCategory,
    simulationSeed,
    simulatedPlacements,
    // actions
    selectRule,
    setSimulationSeed,
    setSimulatedPlacements,
    clearSimulation,
  };
}
