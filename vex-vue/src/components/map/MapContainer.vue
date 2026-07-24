<script setup lang="ts">
/**
 * @module L Vue 组件
 */
// ══════════════════════════════════════════════════
// MapContainer — 地图容器
//
// 替代现有 vex/index.html 的左侧 main > div（CARTOGRAPHY 区域）。
// 包含 ASCII 标题 + mapInfo + MapGrid + 缩放控件。
//
// 注意：#zoomIn / #zoomOut / #zoomLevel 的 id 保留，
//       因为 useMapInteraction 通过 getElementById 绑定事件。
//       #mapInfo 改为 Vue 响应式渲染（不用 innerHTML，避免虚拟 DOM 不一致）。
// ══════════════════════════════════════════════════

import MapGrid from './MapGrid.vue';
import MoveDirector from './MoveDirector.vue';
import { useMapStore } from '@/stores/map';
import { usePlayerAvatarStore } from '@/stores/player-avatar';
import { computed } from 'vue';
import { getPlaceName } from '@/utils/format';
import { escapeHtml } from '@/utils/format';
import { UI_TEXT } from '@/data/ui-locale';

const mapStore = useMapStore();
const playerAvatarStore = usePlayerAvatarStore();

// ── 地图信息（响应式渲染，替代 useMapBusiness.updateMapInfo 的 innerHTML） ──
const mapInfoHtml = computed(() => {
  if (mapStore.loading) {
    return '<span class="grey">' + UI_TEXT.LOADING + '</span>';
  }
  if (mapStore.error) {
    return '<span class="grey">数据加载失败</span>';
  }
  if (!mapStore.links || mapStore.curLoc === null) {
    return '<span class="grey">等待地图加载...</span>';
  }
  const curName = getPlaceName(mapStore.curLoc);
  let infoText = '&gt; ' + UI_TEXT.LOC + ': <span class="yellow">' + escapeHtml(curName) + '</span>';
  if (mapStore.curRegion !== null) {
    const regionInfo = (mapStore.links.regions as Record<string, { name?: string }>)[String(mapStore.curRegion)];
    if (regionInfo) {
      infoText += ' | ' + UI_TEXT.REGION + ': ' + escapeHtml(regionInfo.name || '');
    }
  }
  return infoText;
});
</script>

<template>
  <div class="flex flex-col border-r border-fg-dim/30 min-h-0 overflow-hidden">
    <div class="flex-1 min-h-0 flex flex-col p-3 overflow-hidden">
      <!-- ASCII 标题 -->
      <div class="ascii-title flex-none">
        <span>┌─</span>
        <span class="ascii-label">{{ UI_TEXT.CARTOGRAPHY }}</span>
        <span>─</span>
        <span class="flex-1 ascii-line"></span>
        <span>┐</span>
      </div>

      <!-- 地图信息（Vue 响应式渲染，v-html 输出带样式的 HTML） -->
      <div
        class="text-fg-dim text-[10px] py-1 flex-none"
        v-html="mapInfoHtml"
      ></div>

      <!-- 地图网格 + 移动导演叠加层（3.4 MoveDirector 演出层，F-K4-Director §5.2） -->
      <div class="relative flex-1 min-h-0 flex">
        <MapGrid />
        <MoveDirector />
      </div>

      <!-- 缩放控件（id 保留供 useMapInteraction 绑定事件） -->
      <div class="zoom-controls" title="Ctrl+滚轮缩放 | 拖拽平移">
        <!-- 调试按钮组（玩家立绘动画） -->
        <div class="avatar-debug-group" title="玩家立绘动画调试">
          <button
            class="zoom-btn debug"
            @click="playerAvatarStore.debugPopUp()"
          >弹</button>
          <button
            class="zoom-btn debug"
            @click="playerAvatarStore.debugFall()"
          >倒</button>
        </div>
        <span class="zoom-controls-divider">|</span>
        <button id="zoomOut" class="zoom-btn">-</button>
        <span id="zoomLevel" class="zoom-label">1.0x</span>
        <button id="zoomIn" class="zoom-btn">+</button>
      </div>

      <div class="ascii-title-bottom flex-none">
        <span>└</span>
        <span class="flex-1 ascii-line"></span>
        <span>┘</span>
      </div>
    </div>
  </div>
</template>
