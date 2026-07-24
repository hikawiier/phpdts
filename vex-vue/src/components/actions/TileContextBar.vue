<script setup lang="ts">
/**
 * @module L Vue 组件
 * @framework L-1 统一交互列表模式
 */
// ══════════════════════════════════════════════════
// TileContextBar — 当前格情境操作区（F-K2-Explore §5.4 / 设计案 §7.2）
//
// 分为当前位置情境与独立功能：
//   - 当前格：脚边东西、奇妙物件
//   - 独立功能：合成（不依赖当前格内容）
//   - 空状态只描述当前格，不把合成算作当前位置内容
//
// 移除了探索按钮（已移入 MainActionBar，标签稳定）。
// 复用现有 tileActionStore（ground_items / pois）+ poiStore + craftStore，
// 不重复实现拾取/POI/合成业务逻辑。
//
// 位置：桌面右侧动作区中位于 MainActionBar 之后；手机横屏位于“当前格”标签页。
// 旧 TileActionBar.vue 保留作为参考（3.6 验收后再决定是否删除）。
// ══════════════════════════════════════════════════

import { computed } from 'vue';
import { useTileActionStore } from '@/stores/tileAction';
import { usePoiStore } from '@/stores/poi';
import { useCraftStore } from '@/stores/craft';
import { useMapStore } from '@/stores/map';
import { useExploreStore } from '@/stores/explore-store';
import { commandQueue } from '@/stores/command-queue';
import { getPlaceName } from '@/utils/format';
import { getItemName } from '@/data/item-locale';
import { getPoiName } from '@/data/poi-locale';
import type { GroundItem } from '@/types/api';

const tileActionStore = useTileActionStore();
const poiStore = usePoiStore();
const craftStore = useCraftStore();
const mapStore = useMapStore();
const explore = useExploreStore();

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
/** 当前格与独立功能统一消费探索场景输入门控，不维护第二套锁。 */
const interactionLocked = computed(() => explore.inputLocked);
/** 空状态只研判当前格内容；合成属于独立功能，不参与。 */
const isEmpty = computed(
  () => !hasGround.value && !hasPois.value,
);

function summarizeNames(names: string[], emptyText: string): string {
  const unique = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
  if (unique.length === 0) return emptyText;
  const summary = unique.slice(0, 2).join('、');
  return unique.length > 2 ? `${summary}…` : summary;
}

function groundItemDisplayName(item: GroundItem): string {
  const displayId = item.discovered === 2
    ? (item.fake_item_id || item.item_id)
    : item.item_id;
  const localizedName = displayId ? getItemName(displayId) : '';
  const fallbackName = item.display_name?.replace(/（？）$/, '') || item.name || '';
  return item.itm?.trim() || localizedName || fallbackName;
}

const groundSummary = computed<string>(() => summarizeNames(
  groundItems.value.map((item) => groundItemDisplayName(item)),
  '暂无脚边道具',
));
const poiSummary = computed<string>(() => summarizeNames(
  pois.value.map((poi) => getPoiName(poi.poi_id, poi.name)),
  '当前没有可互动的 POI',
));

// ── 交互处理 ──
function onCheckGround(): void {
  if (interactionLocked.value) return;
  tileActionStore.openGroundModal();
}

function onCheckPoi(): void {
  if (interactionLocked.value || !hasPois.value) return;
  poiStore.openModal();
}

function onOpenCraft(): void {
  if (interactionLocked.value) return;
  void craftStore.openModal();
}

</script>

<template>
  <div class="tile-action-groups">
    <section class="tile-context-bar">
      <div class="action-subtitle">脚下 · {{ currentTileName }}</div>

      <div v-if="isEmpty" class="tile-empty">当前格无可操作内容</div>

      <div class="ctx-entries ctx-primary-entries">
        <button
          v-if="hasGround"
          class="term-btn ctx-command"
          :disabled="interactionLocked"
          @click="onCheckGround"
        >
          <span class="ctx-command-index">01</span>
          <span class="ctx-command-copy">
            <span class="ctx-command-label">脚边道具 · {{ groundItems.length }}件</span>
            <span class="ctx-command-state">{{ groundSummary }}</span>
          </span>
        </button>

        <button
          class="term-btn ctx-command"
          :class="{ 'is-solo': !hasGround }"
          :disabled="interactionLocked || !hasPois"
          @click="onCheckPoi"
        >
          <span class="ctx-command-index">02</span>
          <span class="ctx-command-copy">
            <span class="ctx-command-label">POI互动 · {{ pois.length }}处</span>
            <span class="ctx-command-state">{{ poiSummary }}</span>
          </span>
        </button>
      </div>
    </section>

    <section class="standalone-actions">
      <div class="action-subtitle">独立功能</div>
      <button
        v-if="craftAvailable"
        class="term-btn block ctx-entry"
        :disabled="interactionLocked || !commandQueue.canExecute('craft.execute')"
        @click="onOpenCraft"
      >[合成]</button>
    </section>
  </div>
</template>

<style scoped>
.tile-action-groups {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.tile-context-bar {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.standalone-actions {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ctx-entries {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.ctx-primary-entries {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.ctx-primary-entries .ctx-command.is-solo {
  grid-column: 1 / -1;
}
.term-btn.ctx-command {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr);
  align-items: center;
  gap: 7px;
  min-width: 0;
  min-height: 46px;
  padding: 6px 9px;
  text-align: left;
  border-color: #858585;
  background: rgba(255, 255, 255, 0.028);
  letter-spacing: 0;
}
.ctx-command:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.085);
}
.ctx-command-index {
  color: #555;
  font-size: 9px;
  align-self: start;
  padding-top: 2px;
}
.ctx-command-copy {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 1px;
}
.ctx-command-label {
  color: #f2f2f2;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ctx-command-state {
  color: #696969;
  font-size: 9px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
