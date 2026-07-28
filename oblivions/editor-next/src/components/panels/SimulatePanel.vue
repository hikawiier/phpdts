<!-- @module O 内容工具箱 -->
<script setup lang="ts">
// SimulatePanel：可折叠模拟面板（C-2 整合进 MapEditorView，对齐 3.4 不展示什么优先）
//
// 研判：
//   - 本面板是 O-1 框架的控件入口（取代原 SimulateView 顶部工具栏）
//   - 折叠状态持久化到 uiStore.simulatePanelOpen（默认 false，对齐 3.4）
//   - 叠层开关聚合为单一折叠组（C-3），默认折叠，启用任意叠层时标题显示"叠层 (N)"作为注意力锚点
//
// 设计契约（对齐 2.13 / 2.15）：
//   - 仅承载控件 UI，事件委托由 MapEditorView 在 GridCanvas 外层容器处理
//   - 灰阶样式，不引入彩色（对齐 2.15 灰阶基底）

import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useSimStore } from '@/stores/simStore';
import { useOverlayStore } from '@/stores/overlayStore';
import { useToolStore } from '@/stores/toolStore';
import { useProjectStore } from '@/stores/projectStore';
import { useUiStore } from '@/stores/uiStore';
import { useOverlayRenderer } from '@/composables/useOverlayRenderer';
import BaseButton from '@/components/common/BaseButton.vue';
import BaseCheckbox from '@/components/common/BaseCheckbox.vue';
import type { OverlayKey } from '@/stores/overlayStore';

const { t } = useI18n();
const sim = useSimStore();
const overlay = useOverlayStore();
const tool = useToolStore();
const project = useProjectStore();
const ui = useUiStore();
const renderer = useOverlayRenderer();

const hasProject = computed(() => project.hasProject && project.currentPgroup !== null);
const tiles = computed(() => project.currentTiles);

// ─── 折叠状态（绑定 uiStore，对齐 3.4 不展示什么优先） ──
const isOpen = computed<boolean>({
  get: () => ui.simulatePanelOpen,
  set: (v: boolean) => ui.setSimulatePanelOpen(v),
});

// ─── 滑块：vision_range / move_power ────────────────────
const visionRange = computed<number>({
  get: () => sim.config.visionRange,
  set: (v: number) => {
    const clamped = Math.min(5, Math.max(1, Math.floor(v)));
    sim.updateConfig({ visionRange: clamped });
    if (sim.playerPos.pls !== null) {
      renderer.recompute(tiles.value);
    }
  },
});

const movePower = computed<number>({
  get: () => sim.config.movePower,
  set: (v: number) => {
    const clamped = Math.min(10, Math.max(1, Math.floor(v)));
    sim.updateConfig({ movePower: clamped });
    if (sim.playerPos.pls !== null) {
      renderer.recompute(tiles.value);
    }
  },
});

// ─── Sim 工具：sim-player / sim-explore ────────────────────
const isSimPlayer = computed(() => tool.current === 'sim-player');
const isSimExplore = computed(() => tool.current === 'sim-explore');

function selectSimPlayer(): void {
  tool.setTool('sim-player');
}
function selectSimExplore(): void {
  tool.setTool('sim-explore');
}

// ─── C-3 叠层折叠组（默认折叠，启用任意叠层时标题显示"叠层 (N)"） ──
const overlayGroupOpen = ref(false);

const overlayEntries: ReadonlyArray<{ key: OverlayKey; labelKey: string }> = [
  { key: 'fog', labelKey: 'overlay.fog' },
  { key: 'vision', labelKey: 'overlay.vision' },
  { key: 'reachability', labelKey: 'overlay.reachability' },
  { key: 'tideHeatmap', labelKey: 'overlay.tideHeatmap' },
];

const activeOverlayCount = computed(() => {
  const f = overlay.flags;
  let n = 0;
  if (f.fog) n++;
  if (f.vision) n++;
  if (f.reachability) n++;
  if (f.tideHeatmap) n++;
  return n;
});

const overlayGroupLabel = computed(() => {
  if (activeOverlayCount.value === 0) return t('overlayGroup.title');
  return t('overlayGroup.countFormat', { n: activeOverlayCount.value });
});

function onToggleOverlay(key: OverlayKey, value: boolean): void {
  overlay.setFlag(key, value);
}

// ─── 玩家位置信息 ────────────────────────────────────────
const playerInfo = computed(() => {
  const { pgroup, pls } = sim.playerPos;
  if (pgroup === null || pls === null) return t('simulatePanel.playerPosUnset');
  return `pgroup=${pgroup} pls=${pls}`;
});

const isPlayerInCurrentRegion = computed(() => renderer.isPlayerInCurrentRegion.value);
</script>

<template>
  <div class="flex flex-col border-t border-gray-800 bg-gray-900 text-xs text-gray-300">
    <!-- 折叠头：标题 + 展开/折叠按钮（灰阶样式，对齐 2.15） -->
    <button
      type="button"
      class="flex cursor-pointer items-center justify-between px-3 py-1.5 text-gray-300 hover:bg-gray-800"
      :aria-expanded="isOpen"
      @click="ui.toggleSimulatePanel()"
    >
      <span class="font-medium">{{ t('simulatePanel.title') }}</span>
      <span class="text-gray-500">{{ isOpen ? '▾' : '▸' }}</span>
    </button>

    <!-- 展开内容：滑块 + sim 工具 + 叠层折叠组 + 玩家位置 -->
    <div v-if="isOpen" class="flex flex-wrap items-center gap-4 border-t border-gray-800 px-3 py-2">
      <template v-if="hasProject">
        <!-- 滑块：vision_range -->
        <div class="flex items-center gap-2">
          <label class="text-gray-400" for="sim-vision-range">{{ t('simulatePanel.vision') }}</label>
          <input
            id="sim-vision-range"
            v-model.number="visionRange"
            type="range"
            min="1"
            max="5"
            step="1"
            class="sim-slider"
          />
          <span class="w-4 text-gray-200">{{ visionRange }}</span>
        </div>

        <!-- 滑块：move_power -->
        <div class="flex items-center gap-2">
          <label class="text-gray-400" for="sim-move-power">{{ t('simulatePanel.move') }}</label>
          <input
            id="sim-move-power"
            v-model.number="movePower"
            type="range"
            min="1"
            max="10"
            step="1"
            class="sim-slider"
          />
          <span class="w-4 text-gray-200">{{ movePower }}</span>
        </div>

        <!-- 分隔 -->
        <div class="h-4 w-px bg-gray-700"></div>

        <!-- Sim 工具 -->
        <div class="flex items-center gap-1">
          <span class="text-gray-500">{{ t('simulatePanel.tool') }}</span>
          <BaseButton
            size="sm"
            :variant="isSimPlayer ? 'primary' : 'ghost'"
            :title="t('tool.sim-player')"
            @click="selectSimPlayer"
            >{{ t('simulatePanel.toolPlayer') }}</BaseButton
          >
          <BaseButton
            size="sm"
            :variant="isSimExplore ? 'primary' : 'ghost'"
            :title="t('tool.sim-explore')"
            @click="selectSimExplore"
            >{{ t('simulatePanel.toolExplore') }}</BaseButton
          >
        </div>

        <!-- 分隔 -->
        <div class="h-4 w-px bg-gray-700"></div>

        <!-- C-3 叠层折叠组（默认折叠，启用任意叠层时标题显示"叠层 (N)"） -->
        <div class="flex flex-col">
          <button
            type="button"
            class="flex cursor-pointer items-center gap-1 text-gray-400 hover:text-gray-200"
            :aria-expanded="overlayGroupOpen"
            @click="overlayGroupOpen = !overlayGroupOpen"
          >
            <span class="text-gray-500">{{ overlayGroupOpen ? '▾' : '▸' }}</span>
            <span :class="activeOverlayCount > 0 ? 'text-gray-200' : 'text-gray-500'">{{
              overlayGroupLabel
            }}</span>
          </button>
          <div v-if="overlayGroupOpen" class="mt-1 flex items-center gap-3">
            <BaseCheckbox
              v-for="entry in overlayEntries"
              :key="entry.key"
              :model-value="overlay.flags[entry.key]"
              @update:model-value="(v: boolean) => onToggleOverlay(entry.key, v)"
              >{{ t(entry.labelKey) }}</BaseCheckbox
            >
          </div>
        </div>

        <!-- 右侧：玩家位置信息 -->
        <div class="ml-auto flex items-center gap-2 text-gray-500">
          <span>{{ t('simulatePanel.playerPos') }}</span>
          <span :class="isPlayerInCurrentRegion ? 'text-gray-300' : 'text-gray-600'">{{
            playerInfo
          }}</span>
        </div>
      </template>
      <div v-else class="py-2 text-gray-600">
        {{ t('simulatePanel.playerPosUnset') }}
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 滑块样式（灰阶基底，对齐 2.15） */
.sim-slider {
  -webkit-appearance: none;
  appearance: none;
  width: 80px;
  height: 4px;
  background: var(--color-gray-700);
  border-radius: 2px;
  outline: none;
  cursor: pointer;
}

.sim-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--color-gray-300);
  border: 1px solid var(--color-gray-500);
  cursor: pointer;
}

.sim-slider::-webkit-slider-thumb:hover {
  background: var(--color-gray-200);
}

.sim-slider::-moz-range-thumb {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--color-gray-300);
  border: 1px solid var(--color-gray-500);
  cursor: pointer;
}

.sim-slider:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
