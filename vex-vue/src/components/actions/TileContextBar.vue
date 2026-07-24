<script setup lang="ts">
/**
 * @module L Vue 组件
 */
// ══════════════════════════════════════════════════
// TileContextBar — 当前格情境操作区（F-K2-Explore §5.4 / 设计案 §7.2）
//
// 退化为"当前格情境操作"（主操作已上提到 MainActionBar）：
//   - 拾取（如有可拾取道具）
//   - POI 互动（如有 POI）
//   - 合成（始终可用，不依赖当前格内容）
//   - 区域切换（当前格位于区域出入口时显示，文案随出口/入口分支）
//   - 空状态（无可操作内容时显示"当前格无可操作内容"）
//
// 移除了探索按钮（已移入 MainActionBar，标签稳定）。
// 复用现有 tileActionStore（ground_items / pois）+ poiStore + craftStore，
// 不重复实现拾取/POI/合成业务逻辑。
//
// 位置：右侧面板中，日志下方、主操作区上方。
// 旧 TileActionBar.vue 保留作为参考（3.6 验收后再决定是否删除）。
// ══════════════════════════════════════════════════

import { computed } from 'vue';
import { useTileActionStore } from '@/stores/tileAction';
import { usePoiStore } from '@/stores/poi';
import { useCraftStore } from '@/stores/craft';
import { useMapStore } from '@/stores/map';
import { commandQueue } from '@/stores/command-queue';
import { getPlaceName } from '@/utils/format';

const tileActionStore = useTileActionStore();
const poiStore = usePoiStore();
const craftStore = useCraftStore();
const mapStore = useMapStore();

// ── 当前格名称 ──
const currentTileName = computed<string>(() => {
  if (mapStore.curLoc === null) return '未知地';
  return getPlaceName(mapStore.curLoc) || `位置${mapStore.curLoc}`;
});

// ── 当前格情境数据（复用 tileActionStore） ──
const groundItems = computed(() => tileActionStore.groundItems);
const pois = computed(() => tileActionStore.pois);
const hasGround = computed(() => groundItems.value.length > 0);
const hasPois = computed(() => pois.value.length > 0);
/** 合成始终可用（不依赖当前格内容） */
const craftAvailable = computed(() => true);
/** 区域切换按钮显示条件：当前格位于区域出入口（F-K2-Explore §5.4） */
const switchRegionVisible = computed<boolean>(() => {
  if (!mapStore.links || mapStore.curRegion === null) return false;
  const regionInfo = (mapStore.links.regions as Record<string, {
    exit_pls?: string | number;
    entrance_pls?: string | number;
    prev_region?: string | number | null;
  }>)[String(mapStore.curRegion)];
  if (!regionInfo) return false;
  const isOnExit = String(mapStore.curLoc) === String(regionInfo.exit_pls);
  const isOnEntrance =
    String(mapStore.curLoc) === String(regionInfo.entrance_pls) &&
    regionInfo.prev_region !== null && regionInfo.prev_region !== undefined;
  return isOnExit || isOnEntrance;
});
/** 区域切换按钮文案：出口 → "前往下一区域" / 入口 → "返回上一区域" */
const switchRegionText = computed<string>(() => {
  if (!mapStore.links || mapStore.curRegion === null) return '';
  const regionInfo = (mapStore.links.regions as Record<string, {
    exit_pls?: string | number;
    entrance_pls?: string | number;
    prev_region?: string | number | null;
  }>)[String(mapStore.curRegion)];
  if (!regionInfo) return '';
  const isOnExit = String(mapStore.curLoc) === String(regionInfo.exit_pls);
  return isOnExit ? '前往下一区域' : '返回上一区域';
});
/** 空状态：无道具 + 无 POI（合成始终可用，不计入空状态） */
const isEmpty = computed(() => !hasGround.value && !hasPois.value);

// ── 交互处理 ──
function onCheckGround(): void {
  tileActionStore.openGroundModal();
}

function onCheckPoi(): void {
  poiStore.openModal();
}

function onOpenCraft(): void {
  void craftStore.openModal();
}

function onSwitchRegion(): void {
  tileActionStore.handleSwitchRegion();
}
</script>

<template>
  <div class="tile-context-bar">
    <div class="action-subtitle">当前格 · {{ currentTileName }}</div>

    <!-- 空状态：无可操作内容（合成始终可用，单独显示） -->
    <div v-if="isEmpty" class="tile-empty">当前格无可操作内容</div>

    <div class="ctx-entries">
      <!-- 拾取（脚边道具） -->
      <button
        v-if="hasGround"
        class="term-btn block ctx-entry"
        @click="onCheckGround"
      >[拾取 ×{{ groundItems.length }}] {{ groundItems[0]?.name || '脚边道具' }}</button>

      <!-- POI 互动 -->
      <button
        v-if="hasPois"
        class="term-btn block ctx-entry"
        @click="onCheckPoi"
      >[POI 互动 ×{{ pois.length }}] {{ pois[0]?.name || 'POI' }}</button>

      <!-- 合成（始终可用） -->
      <button
        v-if="craftAvailable"
        class="term-btn block ctx-entry"
        :disabled="!commandQueue.canExecute('craft.execute')"
        @click="onOpenCraft"
      >[合成]</button>

      <!-- 区域切换（仅当前格位于区域出入口时显示，F-K2-Explore §5.4） -->
      <button
        v-if="switchRegionVisible"
        class="term-btn block ctx-entry"
        :disabled="!commandQueue.canExecute('map.move')"
        @click="onSwitchRegion"
      >[{{ switchRegionText }}]</button>
    </div>
  </div>
</template>

<style scoped>
.tile-context-bar {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ctx-entries {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.ctx-entry {
  padding: 4px 8px;
  font-size: 10px;
  text-align: left;
  letter-spacing: 0.04em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tile-empty {
  color: #555;
  font-size: 10px;
  letter-spacing: 0.05em;
  padding: 2px 0;
}
.action-subtitle {
  color: #777;
  font-size: 9px;
  letter-spacing: 0.1em;
  padding-bottom: 2px;
  border-bottom: 1px solid rgba(68, 68, 68, 0.2);
}
</style>
