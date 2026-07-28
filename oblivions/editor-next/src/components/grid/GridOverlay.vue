<!-- @module O 内容工具箱 -->
<script setup lang="ts">
//
// GridOverlay：叠层容器组件（对齐 NEW_DESIGN.md §3.3.2 + §3.8 + DESIGN.md 2.13）
//
// 研判：
//   - 通过 useOverlayRenderer 调度 O-1 的四叠层（fog/vision/reachability/tideHeatmap）
//   - POI 图标类型从 configStore.poiTable 查询（在 useOverlayRenderer 内完成）
//
// 设计契约（对齐 2.13）：
//   - 通过 v-if 动态挂载子叠层，由 Vue diff 管理 DOM 子树
//   - 子叠层组件纯 props 驱动 SVG 渲染，无命令式 DOM
//   - 渲染顺序由 useOverlayRenderer.activeOverlayList 决定（底层 → 顶层）
//
// 与 GridCanvas / GridConnections 的关系：
//   - GridOverlay 与 GridConnections 平级，都作为 GridCanvas 的子组件
//   - 共享相同的 layout props（cols/rows/cellWidth/...）保证 SVG 坐标对齐
//   - 叠层 z-index 高于 GridConnections，低于 GridCell 选中态

import { computed } from 'vue';
import { useOverlayRenderer } from '@/composables/useOverlayRenderer';
import OverlayFog from '@/components/overlays/OverlayFog.vue';
import OverlayVision from '@/components/overlays/OverlayVision.vue';
import OverlayReachability from '@/components/overlays/OverlayReachability.vue';
import OverlayTideHeatmap from '@/components/overlays/OverlayTideHeatmap.vue';
import OverlayPoiDistribution from '@/components/overlays/OverlayPoiDistribution.vue';
import OverlayWilditemDistribution from '@/components/overlays/OverlayWilditemDistribution.vue';
import OverlayEnemyDistribution from '@/components/overlays/OverlayEnemyDistribution.vue';
import type { Pls, Tile } from '@/shared';

const props = defineProps<{
  tiles: Record<Pls, Tile>;
  cols: number;
  rows: number;
  cellWidth: number;
  cellHeight: number;
  headerWidth: number;
  headerHeight: number;
}>();

const renderer = useOverlayRenderer();

const layoutProps = computed(() => ({
  tiles: props.tiles,
  cols: props.cols,
  rows: props.rows,
  cellWidth: props.cellWidth,
  cellHeight: props.cellHeight,
  headerWidth: props.headerWidth,
  headerHeight: props.headerHeight,
}));

// 激活状态解构（响应式）
const activeOverlays = computed(() => renderer.activeOverlays.value);
const fogData = computed(() => renderer.fogData.value);
const visionDistance = computed(() => renderer.visionDistance.value);
const enemySenseDistance = computed(() => renderer.enemySenseDistance.value);
const reachabilityDistance = computed(() => renderer.reachabilityDistance.value);
const pathPreview = computed(() => renderer.pathPreview.value);
// 玩家位置 pls（用于 OverlayVision 渲染玩家中心点）
const playerPls = computed(() => renderer.playerPos.value.pls);
</script>

<template>
  <div class="pointer-events-none absolute left-0 top-0 z-10" aria-hidden="true">
    <!-- 渲染顺序：底层 → 顶层（对齐 OVERLAY_RENDER_ORDER） -->
    <OverlayTideHeatmap
      v-if="activeOverlays.tideHeatmap"
      v-bind="layoutProps"
    />
    <OverlayFog
      v-if="activeOverlays.fog"
      v-bind="layoutProps"
      :fog-data="fogData"
    />
    <OverlayVision
      v-if="activeOverlays.vision && renderer.isPlayerInCurrentRegion.value"
      v-bind="layoutProps"
      :vision-distance="visionDistance"
      :enemy-sense-distance="enemySenseDistance"
      :player-pls="playerPls"
    />
    <OverlayReachability
      v-if="activeOverlays.reachability && renderer.isPlayerInCurrentRegion.value"
      v-bind="layoutProps"
      :reachability-distance="reachabilityDistance"
      :path-preview="pathPreview"
    />
    <!-- POI 分布叠层（O-8）：不依赖玩家位置，由 distribution workspace 选中规则驱动 -->
    <OverlayPoiDistribution
      v-if="activeOverlays.poi"
      v-bind="layoutProps"
    />
    <!-- 野生道具分布叠层（O-8）：选中 distribution.scatter 规则时激活 -->
    <OverlayWilditemDistribution
      v-if="activeOverlays.wilditem"
      v-bind="layoutProps"
    />
    <!-- 敌人分布叠层（O-8）：选中 distribution.enemy 规则时激活 -->
    <OverlayEnemyDistribution
      v-if="activeOverlays.enemy"
      v-bind="layoutProps"
    />
  </div>
</template>
