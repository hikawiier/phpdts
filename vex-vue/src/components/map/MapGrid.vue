<script setup lang="ts">
// ══════════════════════════════════════════════════
// MapGrid — 地图网格组件
//
// 阶段 B 策略（M3B）：响应式数据驱动渲染。
//   cells computed（来自 useMapRender）返回 CellData[]，
//   本组件用 v-for 渲染，:class/:style/{{}} 绑定数据。
//
// 职责：
//   - 挂载 #mapGrid + #mapContainer DOM 元素
//   - v-for 渲染 cells（替代 innerHTML 命令式渲染）
//   - onMounted: 注册业务回调 + 应用布局 + 初始化交互 + 居中
//   - watch mapStore 数据变化 → 重新应用布局 + 居中
//   - watch prevRegionSnapshot → CRT 闪烁过渡
//   - onUnmounted: 清理事件监听 + 重置渲染状态
//
// 注意：#mapGrid 和 #mapContainer 的 id 保留（与现有 CSS + useMapInteraction 一致）。
//       cell DOM 由 Vue v-for 管理，不能再通过 innerHTML 修改。
//       shakeCurrentCell/highlightCell/showPathPreview 仍通过 class 切换操作 DOM
//       （只添加/移除临时 class，不修改内容，与 Vue 虚拟 DOM 兼容）。
// ══════════════════════════════════════════════════

import { ref, onMounted, onUnmounted, watch, nextTick, computed } from 'vue';
import { useMapStore } from '@/stores/map';
import {
  cells,
  gridStyle,
  nameFontSize,
  meFontSize,
  renderMapGrid,
  resetRenderState,
  triggerCellClick,
  triggerEnemyClick,
  triggerCellHover,
  triggerCellLeave,
  type CellData,
} from '@/composables/useMapRender';
import { initMapInteraction, centerOnPlayer } from '@/composables/useMapInteraction';
import { setupMapCallbacks } from '@/composables/useMapBusiness';
import { dataManager } from '@/stores/data-manager';

const mapStore = useMapStore();

// ─── DOM 引用（供布局计算 + 交互事件使用） ───
const gridRef = ref<HTMLElement | null>(null);
const containerRef = ref<HTMLElement | null>(null);

// ─── 交互事件 cleanup 函数 ───
let cleanupInteraction: (() => void) | null = null;

// ─── 初始渲染标志（避免 watch 在 onMounted 前触发） ───
let initialized = false;

// ─── 错误/加载状态提示（cells 为空时显示） ───
const placeholderText = computed<string>(() => {
  if (mapStore.loading) return 'loading...';
  if (mapStore.error) return '数据加载失败';
  if (!mapStore.links) return '等待地图加载...';
  return 'no grid data';
});

// ─── 单元格事件处理 ───
function onCellClick(cell: CellData): void {
  if (cell.isEmpty) return;
  if (cell.hasEnemy && cell.enemy) {
    // 敌人格：触发战斗确认
    triggerEnemyClick(cell.enemy);
  } else if (cell.isCurrent || cell.isReachable) {
    // 当前格（探索）/ 可达格（移动）
    triggerCellClick(cell.pls);
  } else if (!cell.passable) {
    // 不可通行格点击反馈
    const msg = cell.name ? '无法通过：' + cell.name : '此处无法通行';
    dataManager.broadcast('ui:toast', { type: 'error', msg });
  }
}

function onCellEnter(cell: CellData): void {
  if (cell.isEmpty || cell.isCurrent || cell.hasEnemy) return;
  if (cell.isReachable) {
    triggerCellHover(cell.pls);
  }
}

function onCellLeave(cell: CellData): void {
  if (cell.isEmpty || cell.isCurrent || cell.hasEnemy) return;
  if (cell.isReachable) {
    triggerCellLeave();
  }
}

// ─── 监听 mapStore 数据变化 → 重新应用布局 + 居中 ───
// cells computed 会自动重新计算（响应式），这里只需处理布局 + 居中
watch(
  () => [mapStore.links, mapStore.enemies, mapStore.curLoc, mapStore.curRegion],
  () => {
    if (!initialized) return;
    if (!gridRef.value || !containerRef.value) return;
    try {
      renderMapGrid(gridRef.value, containerRef.value);
      // 渲染后居中到玩家位置（等 DOM 更新完成）
      nextTick(() => {
        requestAnimationFrame(() => centerOnPlayer(true));
      });
    } catch (e) {
      console.error('[MapGrid] render error:', e);
    }
  },
  { deep: false }, // 顶层引用变化即可（loadMap 会替换整个 links/enemies）
);

// ─── 监听区域切换 → CRT 闪烁过渡 ───
watch(
  () => mapStore.prevRegionSnapshot,
  (prev) => {
    if (!initialized || prev === null) return;
    if (gridRef.value) {
      gridRef.value.classList.add('crt-transition');
      setTimeout(() => {
        if (gridRef.value) gridRef.value.classList.remove('crt-transition');
      }, 500);
    }
  },
);

onMounted(() => {
  if (!gridRef.value || !containerRef.value) return;

  // 1. 注册业务回调（渲染/交互/事件监听/DebugBus）
  setupMapCallbacks();

  // 2. 应用布局（如果 mapStore 已有数据，cells computed 会自动渲染）
  if (mapStore.links && mapStore.curRegion !== null) {
    renderMapGrid(gridRef.value, containerRef.value);
    nextTick(() => {
      requestAnimationFrame(() => centerOnPlayer(true));
    });
  }

  // 3. 初始化交互事件（缩放/平移/键盘/触摸）
  cleanupInteraction = initMapInteraction(containerRef.value, gridRef.value);

  initialized = true;
});

onUnmounted(() => {
  if (cleanupInteraction) {
    cleanupInteraction();
    cleanupInteraction = null;
  }
  resetRenderState();
  initialized = false;
});
</script>

<template>
  <!-- 地图容器（保留 id 供 useMapInteraction 使用） -->
  <div
    id="mapContainer"
    ref="containerRef"
    class="map-container flex-1 min-h-0 overflow-auto relative"
  >
    <!-- 地图网格（保留 id 供 useMapRender + useMapInteraction 使用） -->
    <div id="mapGrid" ref="gridRef" class="ascii-map-grid" :style="gridStyle">
      <!-- 数据不可用时显示占位 -->
      <div v-if="cells.length === 0" class="error">{{ placeholderText }}</div>

      <!-- v-for 渲染 cell 列表 -->
      <div
        v-for="cell in cells"
        :key="cell.key"
        :class="cell.classList"
        :data-pls="cell.pls || undefined"
        :data-enemy-pid="cell.hasEnemy && cell.enemy ? String(cell.enemy.pid) : undefined"
        :style="cell.styleObj"
        :title="cell.title"
        @click="onCellClick(cell)"
        @mouseenter="onCellEnter(cell)"
        @mouseleave="onCellLeave(cell)"
      >
        <!-- 空格子：无内容 -->
        <template v-if="cell.isEmpty"></template>

        <!-- 迷雾格：显示 ? -->
        <template v-else-if="cell.isFogged">
          <span class="cell-name" :style="{ fontSize: nameFontSize + 'px' }">?</span>
        </template>

        <!-- 当前格：[我] + 前缀 + 地名 -->
        <template v-else-if="cell.isCurrent">
          <span class="cell-name pulse-white">
            <span class="cell-me" :style="{ fontSize: meFontSize + 'px' }">[我]</span>{{ cell.prefix }}{{ cell.displayLabel }}
          </span>
        </template>

        <!-- 敌人格：[敌人名] + 前缀 + 地名 -->
        <template v-else-if="cell.hasEnemy">
          <span class="cell-name">
            <span class="cell-enemy">[{{ cell.enemyName }}]</span>{{ cell.prefix }}{{ cell.displayLabel }}
          </span>
        </template>

        <!-- 有名格：前缀 + 地名 -->
        <template v-else-if="cell.displayLabel">
          <span class="cell-name" :style="{ fontSize: nameFontSize + 'px' }">{{ cell.prefix }}{{ cell.displayLabel }}</span>
        </template>

        <!-- 无名格：坐标标签 -->
        <template v-else>
          <span class="cell-coord">{{ cell.coordLabel }}</span>
        </template>
      </div>
    </div>
  </div>
</template>
