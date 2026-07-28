<!-- @module O 内容工具箱 -->
<script setup lang="ts">
//
// MapTab：地图子 Tab（迁移自 MapEditorView 主体，对齐 P1 执行案 §4.10.2）
//
// 设计意图：
//   - 三栏布局（左 RegionPanel + 中 GridCanvas + GridOverlay + 右 TilePanel）
//   - 顶部工具栏：ToolPanel + 画笔预设（撤销/重做由 WorldHeader 持有，不在此重复）
//   - 底部 SimulatePanel（折叠，与 SimulateTab 区分——SimulateTab 是展开版独立子 Tab）
//   - 重新挂载 useEditorKeyboard / useOverlayRenderer / useToolActions
//   - useEditorKeyboard 在 v-show 切换时不会卸载，键盘层保持激活
//
// 边界：
//   - MapTab 是 WorldView 的子组件，不是顶层 view；不再调用 project.loadFromStorage
//     （元数据恢复由 WorldView 顶层在首次进入时调用，避免重复加载）
//   - 切换 pgroup 不清空历史栈（由 historyStore 保证）
//   - sim-player / sim-explore 工具下事件委托外层 div 处理点击/hover（对齐 2.13）
import { computed, onBeforeUnmount } from 'vue';
import { useProjectStore } from '@/stores/projectStore';
import { useToolStore } from '@/stores/toolStore';
import { useUiStore } from '@/stores/uiStore';
import { useSimStore } from '@/stores/simStore';
import { useEditorKeyboard } from '@/composables/useEditorKeyboard';
import { useOverlayRenderer } from '@/composables/useOverlayRenderer';
import RegionPanel from '@/components/panels/RegionPanel.vue';
import TilePanel from '@/components/panels/TilePanel.vue';
import ToolPanel from '@/components/panels/ToolPanel.vue';
import BrushPresetPanel from '@/components/panels/BrushPresetPanel.vue';
import SimulatePanel from '@/components/panels/SimulatePanel.vue';
import GridCanvas from '@/components/grid/GridCanvas.vue';
import GridOverlay from '@/components/grid/GridOverlay.vue';
import BaseToast from '@/components/common/BaseToast.vue';
import BaseButton from '@/components/common/BaseButton.vue';
import type { Pls } from '@/shared';

const project = useProjectStore();
const tool = useToolStore();
const ui = useUiStore();
const sim = useSimStore();
const renderer = useOverlayRenderer();

// 挂载统一键盘层（onMounted 内 addEventListener / onBeforeUnmount 内 removeEventListener）
// v-show 切换不会触发 onBeforeUnmount，键盘绑定在子 Tab 切换时保持
useEditorKeyboard();

const showBrushPanel = computed(() => tool.isBrushActive);
const hasProject = computed(() => project.hasProject);

// GridCanvas 内部布局常量（与 GridCanvas.vue 对齐，用于 GridOverlay 叠加）
const CELL_WIDTH = 52;
const CELL_HEIGHT = 44;
const HEADER_WIDTH = 38;
const HEADER_HEIGHT = 28;

const cols = computed(() => project.currentGrid?.cols ?? 0);
const rows = computed(() => project.currentGrid?.rows ?? 0);
const tiles = computed(() => project.currentTiles);

function onNewProject(): void {
  project.clearProject();
  const pgroup = project.addRegion();
  if (pgroup === null) {
    ui.showToast('项目创建失败：已达区域数量上限', 'error');
    return;
  }
  ui.showToast(`已新建项目，初始区域 #${pgroup}`, 'success');
}

// ─── C-2 事件委托：sim-player / sim-explore 工具下接管点击/hover ──

function findPlsFromEvent(event: MouseEvent): Pls | null {
  const target = event.target as HTMLElement | null;
  if (!target) return null;
  const cell = target.closest<HTMLElement>('[data-pls]');
  if (!cell) return null;
  const raw = cell.getAttribute('data-pls');
  if (raw === null) return null;
  const pls = Number(raw);
  if (Number.isNaN(pls)) return null;
  return pls as Pls;
}

function onGridClick(event: MouseEvent): void {
  if (tool.current !== 'sim-player' && tool.current !== 'sim-explore') return;
  const pgroup = project.currentPgroup;
  if (pgroup === null) return;
  const pls = findPlsFromEvent(event);
  if (pls === null) return;

  if (tool.current === 'sim-player') {
    sim.setPlayerPos(pgroup, pls);
    renderer.recompute(tiles.value);
  } else if (tool.current === 'sim-explore') {
    if (sim.playerPos.pls === null || sim.playerPos.pgroup !== pgroup) {
      sim.setPlayerPos(pgroup, pls);
    }
    renderer.recompute(tiles.value);
    sim.simulateExplore(tiles.value);
  }
}

function onGridMouseMove(event: MouseEvent): void {
  if (tool.current !== 'sim-player' && tool.current !== 'sim-explore') return;
  if (sim.playerPos.pls === null) return;
  const pls = findPlsFromEvent(event);
  if (pls === null) {
    sim.clearPathPreview();
    return;
  }
  sim.setHoverTarget(tiles.value, pls);
}

function onGridMouseLeave(): void {
  if (sim.playerPos.pls !== null) {
    sim.clearPathPreview();
  }
}

onBeforeUnmount(() => {
  renderer.cancelPendingRaf();
});
</script>

<template>
  <div class="flex h-full w-full flex-col">
    <!-- 顶部工具栏（仅 ToolPanel，撤销/重做由 WorldHeader 持有） -->
    <ToolPanel />

    <!-- 画笔预设面板（仅 draw / paint 工具激活时） -->
    <BrushPresetPanel v-if="showBrushPanel" />

    <!-- 主体三栏：左 RegionPanel + 中 [GridCanvas + GridOverlay + SimulatePanel] + 右 TilePanel -->
    <div class="flex min-h-0 flex-1">
      <!-- 左：区域面板 -->
      <aside class="w-64 shrink-0 overflow-auto border-r border-gray-800 bg-gray-900">
        <RegionPanel />
      </aside>

      <!-- 中：网格画布 + 叠层 + 模拟面板（C-2 整合） -->
      <main class="flex min-w-0 flex-1 flex-col bg-gray-950">
        <div
          class="relative min-h-0 flex-1"
          @click="onGridClick"
          @mousemove="onGridMouseMove"
          @mouseleave="onGridMouseLeave"
        >
          <GridCanvas v-if="hasProject" />
          <GridOverlay
            v-if="hasProject"
            :tiles="tiles"
            :cols="cols"
            :rows="rows"
            :cell-width="CELL_WIDTH"
            :cell-height="CELL_HEIGHT"
            :header-width="HEADER_WIDTH"
            :header-height="HEADER_HEIGHT"
          />
          <div
            v-else
            class="flex h-full flex-col items-center justify-center gap-3 text-sm text-gray-500"
          >
            <p>尚无项目数据</p>
            <BaseButton variant="primary" @click="onNewProject">新建项目</BaseButton>
          </div>
        </div>

        <!-- C-2 可折叠模拟面板（底部，默认折叠，与 SimulateTab 区分） -->
        <SimulatePanel />
      </main>

      <!-- 右：格属性面板 -->
      <aside class="w-72 shrink-0 overflow-auto border-l border-gray-800 bg-gray-900">
        <TilePanel />
      </aside>
    </div>

    <!-- Toast 容器（Teleport 到 body） -->
    <BaseToast />
  </div>
</template>
