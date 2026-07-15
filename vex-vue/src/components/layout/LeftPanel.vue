<script setup lang="ts">
/**
 * @module L Vue 组件
 */
// ══════════════════════════════════════════════════
// LeftPanel — 左侧面板
//
// M3 阶段：替换 M2 占位为 MapContainer 组件。
// 仅作为 MapContainer 的包装层（保持布局结构一致）。
// ══════════════════════════════════════════════════

import MapContainer from '@/components/map/MapContainer.vue';
</script>

<template>
  <!-- §3.8 push 模式：左侧地图区 flex:65，被抽屉挤压时自动收缩 -->
  <MapContainer class="flex-[65_1_0%] min-w-0" />
</template>
