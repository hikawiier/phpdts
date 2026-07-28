<!-- @module O 内容工具箱 -->
<!-- @framework O-8 分布工作区 -->
<script setup lang="ts">
//
// DistributionView：分布工作区主视图（执行案 §4.5.1 / 设计案 §5.3）
//
// 二维 Tab 结构（P4 升级，执行案 §4.5.1 / 审查补丁 A3）：
//   - 维度 1（顶层资源类别）：POI / 野生道具 / 敌人
//   - 维度 2（次层视图模式）：规则表 / 矩阵 / 地图叠层
//
// 三视图同步（对齐执行案 §4.5.1）：
//   - selectedRuleId 由本组件持有并向下传递
//   - 任一视图选中规则时通过 @select 事件回传，本组件更新 state 后所有视图同步高亮
//   - 同时写入 useDistributionWorkspace 共享状态，供叠层组件读取
//   - 切换资源类别时清空选中规则（避免跨类别选中态错位）
//
// 设计意图：
//   - 解决"野生道具/POI/敌人与地图的放置/刷新关系"——P4 闭合三类资源
//   - 地图叠层区分：可被选中格 / 排除原因 / initial vs refresh / 理论 vs 模拟
//   - 反向查询：点击地图格反查"这里可能生成哪些 X"（三类并列）
//

import { ref, watch } from 'vue';
import { useDistributionWorkspace } from '@/composables/useDistributionWorkspace';
import RuleTablePanel from '@/components/distribution/RuleTablePanel.vue';
import ScatterRuleTablePanel from '@/components/distribution/ScatterRuleTablePanel.vue';
import EnemyRuleTablePanel from '@/components/distribution/EnemyRuleTablePanel.vue';
import DensityMatrixPanel from '@/components/distribution/DensityMatrixPanel.vue';
import DistributionOverlayPanel from '@/components/distribution/DistributionOverlayPanel.vue';
import type { DistributionCategory } from '@/schema/distribution-rule';

type ViewMode = 'rules' | 'matrix' | 'overlay';

interface CategoryDef {
  key: DistributionCategory;
  label: string;
}

interface ViewModeDef {
  key: ViewMode;
  label: string;
}

const CATEGORIES: CategoryDef[] = [
  { key: 'poi', label: 'POI' },
  { key: 'scatter', label: '野生道具' },
  { key: 'enemy', label: '敌人' },
];

const VIEW_MODES: ViewModeDef[] = [
  { key: 'rules', label: '规则表' },
  { key: 'matrix', label: '矩阵' },
  { key: 'overlay', label: '地图叠层' },
];

const currentCategory = ref<DistributionCategory>('poi');
const currentView = ref<ViewMode>('rules');

// ─── 三视图同步状态 ───────────────────────────────────────
const selectedRuleId = ref<string | null>(null);
const workspace = useDistributionWorkspace();

function onSelectRule(ruleId: string | null): void {
  selectedRuleId.value = ruleId;
  workspace.selectRule(ruleId);
}

// 切换资源类别时清空选中规则——避免跨类别选中态错位
watch(currentCategory, () => {
  selectedRuleId.value = null;
  workspace.selectRule(null);
});

// 进入工作区时若共享状态已有选中规则，同步到本地（跨 view 切换场景）
watch(
  () => workspace.selectedRuleId.value,
  (ruleId) => {
    if (ruleId !== selectedRuleId.value) {
      selectedRuleId.value = ruleId;
    }
  },
  { immediate: true },
);
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- 顶层资源类别 Tab -->
    <div class="flex shrink-0 border-b border-gray-800 bg-gray-950">
      <button
        v-for="cat in CATEGORIES"
        :key="cat.key"
        type="button"
        class="border-b-2 px-4 py-2 text-sm transition-colors"
        :class="
          currentCategory === cat.key
            ? 'border-gray-400 text-gray-100'
            : 'border-transparent text-gray-500 hover:text-gray-300'
        "
        @click="currentCategory = cat.key"
      >
        {{ cat.label }}
      </button>
      <span
        v-if="selectedRuleId"
        class="ml-auto self-center pr-3 text-[10px] text-gray-500"
      >
        选中：{{ selectedRuleId }}
      </span>
    </div>

    <!-- 次层视图模式 Tab -->
    <div class="flex shrink-0 border-b border-gray-800 bg-gray-900/40">
      <button
        v-for="mode in VIEW_MODES"
        :key="mode.key"
        type="button"
        class="border-b-2 px-3 py-1.5 text-xs transition-colors"
        :class="
          currentView === mode.key
            ? 'border-gray-400 text-gray-100'
            : 'border-transparent text-gray-500 hover:text-gray-300'
        "
        @click="currentView = mode.key"
      >
        {{ mode.label }}
      </button>
    </div>

    <!-- 视图内容 -->
    <div class="min-h-0 flex-1">
      <!-- POI 类别 -->
      <template v-if="currentCategory === 'poi'">
        <RuleTablePanel
          v-show="currentView === 'rules'"
          :selected-rule-id="selectedRuleId"
          @select="onSelectRule"
        />
        <DensityMatrixPanel
          v-show="currentView === 'matrix'"
          :category="'poi'"
          :selected-rule-id="selectedRuleId"
          @select="onSelectRule"
        />
        <DistributionOverlayPanel
          v-show="currentView === 'overlay'"
          :category="'poi'"
          :selected-rule-id="selectedRuleId"
          @select="onSelectRule"
        />
      </template>

      <!-- 野生道具类别 -->
      <template v-else-if="currentCategory === 'scatter'">
        <ScatterRuleTablePanel
          v-show="currentView === 'rules'"
          :selected-rule-id="selectedRuleId"
          @select="onSelectRule"
        />
        <DensityMatrixPanel
          v-show="currentView === 'matrix'"
          :category="'scatter'"
          :selected-rule-id="selectedRuleId"
          @select="onSelectRule"
        />
        <DistributionOverlayPanel
          v-show="currentView === 'overlay'"
          :category="'scatter'"
          :selected-rule-id="selectedRuleId"
          @select="onSelectRule"
        />
      </template>

      <!-- 敌人类别 -->
      <template v-else-if="currentCategory === 'enemy'">
        <EnemyRuleTablePanel
          v-show="currentView === 'rules'"
          :selected-rule-id="selectedRuleId"
          @select="onSelectRule"
        />
        <DensityMatrixPanel
          v-show="currentView === 'matrix'"
          :category="'enemy'"
          :selected-rule-id="selectedRuleId"
          @select="onSelectRule"
        />
        <DistributionOverlayPanel
          v-show="currentView === 'overlay'"
          :category="'enemy'"
          :selected-rule-id="selectedRuleId"
          @select="onSelectRule"
        />
      </template>
    </div>
  </div>
</template>
