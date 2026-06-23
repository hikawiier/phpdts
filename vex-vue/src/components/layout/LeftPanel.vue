<script setup lang="ts">
// ══════════════════════════════════════════════════
// LeftPanel — 左侧面板
//
// M3 阶段：替换 M2 占位为 MapContainer 组件。
// 仅作为 MapContainer 的包装层（保持布局结构一致）。
// ══════════════════════════════════════════════════

import MapContainer from '@/components/map/MapContainer.vue';
</script>

<template>
  <MapContainer />
</template>
