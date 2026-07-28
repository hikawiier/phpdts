<!-- @module O 内容工具箱 -->
<script setup lang="ts">
//
// SimulateTab：模拟子 Tab（提升自 SimulatePanel，对齐 P1 执行案 §4.10.4）
//
// 设计意图：
//   - 把现有 SimulatePanel 提升为独立子 Tab（不再折叠）
//   - 玩家位置设置 + 4 个叠层开关 + 路径预览
//   - 状态仍由 simStore / overlayStore 持有（全局 Pinia store，子 Tab 切换不清空）
//   - onMounted 时强制展开 uiStore.simulatePanelOpen（与 MapTab 内的折叠版保持一致行为）
//
// 边界：
//   - SimulateTab 与 MapTab 底部 SimulatePanel 共享同一 simStore / overlayStore 状态
//   - 在 MapTab 中点击 sim-player 工具设置玩家位置后，切到 SimulateTab 仍可见
//   - 与 MapTab 内的折叠 SimulatePanel 是同一组件，行为一致
import { onMounted } from 'vue';
import { useUiStore } from '@/stores/uiStore';
import SimulatePanel from '@/components/panels/SimulatePanel.vue';

const ui = useUiStore();

// 进入 SimulateTab 时自动展开模拟面板（与 MapTab 中折叠版区分）
onMounted(() => {
  ui.setSimulatePanelOpen(true);
});
</script>

<template>
  <div class="flex h-full w-full flex-col bg-gray-950">
    <!-- 模拟面板（自动展开） -->
    <SimulatePanel />

    <!-- 占位说明：sim-player / sim-explore 工具下的画布交互在 MapTab 中进行 -->
    <div class="flex flex-1 items-center justify-center p-4 text-xs text-gray-600">
      <div class="max-w-md text-center">
        <p class="mb-2">
          切换到"地图"子 Tab，选择 sim-player / sim-explore 工具后，点击地图格设置玩家位置或触发探索。
        </p>
        <p>
          玩家位置、视野范围、移动能力、4 个叠层开关在此面板调节；状态在子 Tab 切换时保留。
        </p>
      </div>
    </div>
  </div>
</template>
