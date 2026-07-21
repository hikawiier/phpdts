<script setup lang="ts">
//
// MapEditorView：地图空间结构编辑主视图（对齐 NEW_DESIGN.md §3.1 + §7.3 M2）
//
// 研判：
//   - 本视图是 O-0 框架的入口组合
//   - C-2 整合模拟面板 + 叠层渲染 + 事件委托（取代原 SimulateView）
//   - 集成已完成组件：RegionPanel / TilePanel / ToolPanel / BrushPresetPanel / GridCanvas / GridOverlay / SimulatePanel / BaseToast
//   - 挂载 useEditorKeyboard：统一键盘层（对齐 2.14，优先级 Modal > Tool > Panel > Map）
//   - 自动 loadFromStorage：onMounted 时尝试恢复上次会话（localStorage 优先 + IndexedDB 回退）
//   - 响应式 :class 驱动：所有视觉态由 store / composable 暴露的 ref 派生，无命令式 DOM（对齐 2.13）
//
// 布局：左 RegionPanel（w-64） + 中 [GridCanvas + GridOverlay + SimulatePanel] + 右 TilePanel（w-72） + BaseToast
//
// 事件委托（对齐 2.13，从 SimulateView 迁移）：
//   - sim-player / sim-explore 工具下，外层 div 监听 click/mousemove/mouseleave
//   - 通过 event.target.closest('[data-pls]') 找到 pls（GridCell 已通过 :data-pls 暴露）
//   - 其他工具不响应（GridCanvas 自行处理）
//
// 边界：无项目时显示空状态 + 新建按钮；切换 pgroup 不清空历史栈（由 historyStore 保证）

import { computed, onBeforeUnmount, onMounted } from 'vue';
import { useProjectStore } from '@/stores/projectStore';
import { useToolStore } from '@/stores/toolStore';
import { useHistoryStore } from '@/stores/historyStore';
import { useUiStore } from '@/stores/uiStore';
import { useSimStore } from '@/stores/simStore';
import { useToolActions } from '@/composables/useToolActions';
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
import { useI18n } from 'vue-i18n';
import type { Pls } from '@/shared';

const project = useProjectStore();
const tool = useToolStore();
const history = useHistoryStore();
const ui = useUiStore();
const sim = useSimStore();
const actions = useToolActions();
const renderer = useOverlayRenderer();
const { t } = useI18n();

// 挂载统一键盘层（onMounted 内 addEventListener / onBeforeUnmount 内 removeEventListener）
useEditorKeyboard();

// 画笔面板仅在 draw / paint 工具激活时显示
const showBrushPanel = computed(() => tool.isBrushActive);

// 历史与项目状态：供可选的状态条/快捷按钮使用
const canUndo = computed(() => history.canUndo);
const canRedo = computed(() => history.canRedo);
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
  // 新建项目：清空 + 默认新建一个区域
  project.clearProject();
  const pgroup = project.addRegion();
  if (pgroup === null) {
    ui.showToast('项目创建失败：已达区域数量上限', 'error');
    return;
  }
  ui.showToast(`已新建项目，初始区域 #${pgroup}`, 'success');
}

function onUndo(): void {
  const cmd = actions.undo();
  if (cmd === null) {
    ui.showToast(t('message.undoEmpty'), 'info');
  }
}

function onRedo(): void {
  const cmd = actions.redo();
  if (cmd === null) {
    ui.showToast(t('message.redoEmpty'), 'info');
  }
}

// ─── C-2 事件委托：sim-player / sim-explore 工具下接管点击/hover（从 SimulateView 迁移） ──
//
// 实现思路（对齐 2.13，不操作 DOM）：
//   - GridCell 渲染时已通过 :data-pls 暴露 pls 属性（空白格不渲染该属性）
//   - MapEditorView 在 grid 容器外层 div 监听 click / mousemove / mouseleave
//   - 通过 event.target.closest('[data-pls]') 找到点击/hover 的 pls
//   - sim-player / sim-explore 工具下接管事件；其他工具不响应（GridCanvas 自行处理）

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
  // 仅在 sim-player / sim-explore 工具下处理点击
  if (tool.current !== 'sim-player' && tool.current !== 'sim-explore') return;
  const pgroup = project.currentPgroup;
  if (pgroup === null) return;
  const pls = findPlsFromEvent(event);
  if (pls === null) return;

  if (tool.current === 'sim-player') {
    // 设置玩家位置 + 重算 BFS
    sim.setPlayerPos(pgroup, pls);
    renderer.recompute(tiles.value);
  } else if (tool.current === 'sim-explore') {
    // sim-explore：先确保玩家位置已设置（未设置时以点击格为玩家位置）
    if (sim.playerPos.pls === null || sim.playerPos.pgroup !== pgroup) {
      sim.setPlayerPos(pgroup, pls);
    }
    renderer.recompute(tiles.value);
    // 触发探索发现（itemsAtPls 留空，M7 对接后端时填充）
    sim.simulateExplore(tiles.value);
  }
}

function onGridMouseMove(event: MouseEvent): void {
  // 仅在 sim-player / sim-explore 工具下处理 hover（用于路径预览）
  if (tool.current !== 'sim-player' && tool.current !== 'sim-explore') return;
  if (sim.playerPos.pls === null) return; // 无玩家位置时不显示路径预览
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

// ─── 清空 RAF 调度（组件卸载时避免泄漏） ─────────────────
onBeforeUnmount(() => {
  renderer.cancelPendingRaf();
});

// onMounted：恢复上次会话；若无数据则不自动新建（保持空状态，由用户主动创建）
onMounted(async () => {
  try {
    await project.loadFromStorage();
  } catch {
    // 持久化恢复失败不影响编辑器可用性
  }
});
</script>

<template>
  <div class="flex h-full w-full flex-col">
    <!-- 顶部工具栏 + 撤销/重做 -->
    <div class="flex items-center justify-between border-b border-gray-800 bg-gray-900">
      <ToolPanel />
      <div class="flex items-center gap-1 px-2">
        <BaseButton
          size="sm"
          variant="ghost"
          :disabled="!canUndo"
          :title="t('common.undo')"
          @click="onUndo"
          >↶</BaseButton
        >
        <BaseButton
          size="sm"
          variant="ghost"
          :disabled="!canRedo"
          :title="t('common.redo')"
          @click="onRedo"
          >↷</BaseButton
        >
      </div>
    </div>

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
        <!-- 网格 + 叠层容器（事件委托层，对齐 2.13） -->
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

        <!-- C-2 可折叠模拟面板（底部，默认折叠，对齐 3.4 不展示什么优先） -->
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
