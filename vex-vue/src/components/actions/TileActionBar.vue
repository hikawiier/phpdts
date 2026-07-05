<script setup lang="ts">
// ══════════════════════════════════════════════════
// 地格动作条 / Tile Action Bar
//
// 替代现有 vex/js/tile-action.js 的渲染 + 交互逻辑。
//
// 布局（与现有 index.html #tileActionBar 一致）：
//   ┌─ 常驻按钮区 ──────────────────
//   [E] 探索周围  [区域切换]（条件显示）
//   ┌─ 统一交互列表（2列网格） ─────
//   [G] 脚边道具 ×N    [S] POI 名称
//   ...
//
// 模态框（点击脚边道具/POI 时打开）：
//   - ground：道具列表 + [全部拾取]
//   - poi：搜索按钮 + 道具列表 + [全部拾取] / 机制触发结果
//
// 渲染策略（M4）：v-for + v-if 响应式渲染，无 innerHTML 依赖。
// ══════════════════════════════════════════════════

import { computed } from 'vue';
import { useTileActionStore } from '@/stores/tileAction';
import { useMapStore } from '@/stores/map';
import { commandQueue } from '@/stores/command-queue';
import type { GroundItem, Poi } from '@/types/api';
import { getItemName, isInfinite } from '@/data/item-locale';
import { getItmkName } from '@/data/itmk-locale';
import { getPoiName } from '@/data/poi-locale';
import ExploreButton from './ExploreButton.vue';

const tileActionStore = useTileActionStore();
const mapStore = useMapStore();

// ── 区域切换按钮显示条件 ──
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

// ── 列表数据 ──
const pois = computed<Poi[]>(() => tileActionStore.pois);
const groundItems = computed<GroundItem[]>(() => tileActionStore.groundItems);
const hasGround = computed<boolean>(() => groundItems.value.length > 0);
const hasPois = computed<boolean>(() => pois.value.length > 0);
const isEmpty = computed<boolean>(() => !hasGround.value && !hasPois.value);

// ── 模态框数据 ──
const modalOpen = computed<boolean>(() => tileActionStore.modalOpen);
const modalType = computed(() => tileActionStore.modalType);
const modalPoi = computed<Poi | null>(() => tileActionStore.modalPoi);
const modalTitle = computed<string>(() => tileActionStore.modalTitle);
const modalItems = computed<GroundItem[]>(() => tileActionStore.modalItems);

/** 是否显示搜索按钮 */
const showSearchBtn = computed<boolean>(() => {
  const poi = modalPoi.value;
  if (!poi) return false;
  // 可搜索且未搜索 → 显示
  if (poi.searchable && !poi.searched) return true;
  // 可搜索 + 可重复 + 未达上限 → 显示
  if (poi.searchable && poi.repeatable) {
    const limit = Number(poi.repeat_limit) || 0;
    const count = Number(poi.search_count) || 0;
    if (limit > 0 && count >= limit) return false;
    return true;
  }
  return false;
});

/** 搜索按钮文字 */
const searchBtnText = computed<string>(() => {
  const poi = modalPoi.value;
  if (!poi) return '[搜索]';
  if (poi.mechanic) {
    return poi.searched ? '[再触碰]' : '[触碰]';
  }
  return poi.searched ? '[再搜索]' : '[搜索]';
});

/** 是否已达搜索上限 */
const searchLimitReached = computed<boolean>(() => {
  const poi = modalPoi.value;
  if (!poi || !poi.searchable || !poi.repeatable) return false;
  const limit = Number(poi.repeat_limit) || 0;
  const count = Number(poi.search_count) || 0;
  return limit > 0 && count >= limit;
});

/** 是否显示机制触发结果（已搜索的机制型 POI） */
const showMechanicResult = computed<boolean>(() => {
  const poi = modalPoi.value;
  return !!(poi && poi.mechanic && poi.searched);
});

/** 是否显示道具列表 */
const showItemsList = computed<boolean>(() => {
  if (modalType.value === 'ground') return modalItems.value.length > 0;
  const poi = modalPoi.value;
  if (!poi) return false;
  // 机制型已搜索 → 不显示道具列表（只显示机制结果）
  if (poi.mechanic && poi.searched) return false;
  return modalItems.value.length > 0;
});

/** 是否显示"无可交互内容" */
const showEmptyContent = computed<boolean>(() => {
  if (modalType.value !== 'poi') return false;
  const poi = modalPoi.value;
  if (!poi) return false;
  if (poi.mechanic && poi.searched) return false;
  if (poi.searchable) return false;
  return modalItems.value.length === 0;
});

// ── 交互处理 ──
function onSwitchRegion(): void {
  if (commandQueue.isLocked) return;
  tileActionStore.handleSwitchRegion();
}

function onCheckGround(): void {
  tileActionStore.openGroundModal();
}

function onCheckPoi(iaid: string | number): void {
  tileActionStore.openPoiModal(iaid);
}

function onSearch(): void {
  if (!modalPoi.value) return;
  tileActionStore.handleSearch(modalPoi.value.iaid);
}

function onPickup(iid: string | number): void {
  tileActionStore.handlePickup(iid);
}

function onPickupAll(): void {
  tileActionStore.handlePickupAll(modalItems.value);
}

function onCloseModal(): void {
  tileActionStore.closeModal();
}

/** 点击模态框遮罩空白处关闭 */
function onOverlayClick(e: MouseEvent): void {
  if (e.target === e.currentTarget) {
    onCloseModal();
  }
}

/** 道具显示名：实例自定义名优先，普通模板名由前端 locale 渲染 */
function itemDisplayName(item: GroundItem): string {
  if (item.discovered === 2) {
    const displayId = item.fake_item_id || item.item_id;
    const maskedName = displayId ? getItemName(displayId) : (item.display_name?.replace(/（？）$/, '') || '');
    return maskedName ? maskedName + '（？）' : '未知物品（？）';
  }
  const customName = item.itm?.trim();
  if (customName) return customName;
  return getItemName(item.item_id) || item.name || '';
}

function poiDisplayName(poi: Poi): string {
  return getPoiName(poi.poi_id, poi.name);
}

/** 道具是否显示 meta（discovered!==2 时显示 itmk + itme） */
function showItemMeta(item: GroundItem): boolean {
  return item.discovered !== 2;
}

/** 道具元信息显示：效/耐 分数格式（如 5/10、30/∞） */
function itemMeta(item: GroundItem): string {
  const eff = String(item.itme ?? '0');
  const rawDur = String(item.itms ?? '');
  const dur = (isInfinite(rawDur)) ? '∞' : rawDur;
  return `${eff}/${dur}`;
}

/** POI 行的副标签（已搜索/可搜索/搜索次数） */
function poiSubLabel(poi: Poi): string {
  if (poi.searched) return '(已搜索)';
  if (poi.searchable) return '可搜索';
  return '';
}

/** POI 行的搜索次数标签 */
function poiCountLabel(poi: Poi): string {
  if (!poi.repeatable) return '';
  const limit = Number(poi.repeat_limit) || 0;
  if (limit <= 0) return '';
  const count = Number(poi.search_count) || 0;
  return count + '/' + limit;
}
</script>

<template>
  <div class="flex-1 overflow-y-auto min-h-0">
    <!-- 加载中 -->
    <div v-if="tileActionStore.loading && !tileActionStore.tileActions" class="loading">scanning...</div>

    <template v-else-if="tileActionStore.tileActions">
      <!-- ── 常驻按钮区 ── -->
      <div class="action-buttons" style="display:flex;gap:6px;margin-bottom:6px;">
        <ExploreButton />
        <button
          v-if="switchRegionVisible"
          class="term-btn block"
          style="flex:2;"
          :disabled="commandQueue.isLocked"
          @click="onSwitchRegion"
        >{{ switchRegionText }}</button>
      </div>

      <!-- ── 统一交互列表 ── -->
      <div v-if="isEmpty" class="tile-empty">此处无可交互对象</div>
      <div v-else class="poi-grid">
        <!-- 脚边道具 -->
        <div
          v-if="hasGround"
          class="tile-row is-action"
          @click="onCheckGround"
        >
          <span class="tile-tag">[G]</span>
          <span class="tile-name">
            脚边道具
            <span class="dim">×{{ groundItems.length }}</span>
          </span>
        </div>
        <!-- POI 条目 -->
        <div
          v-for="poi in pois"
          :key="poi.iaid"
          class="tile-row is-action"
          @click="onCheckPoi(poi.iaid)"
        >
          <span class="tile-tag">[S]</span>
          <span class="tile-name">
            {{ poiDisplayName(poi) }}
            <span v-if="poiSubLabel(poi)" class="dim">{{ poiSubLabel(poi) }}</span>
            <span v-if="poiCountLabel(poi)" class="dim">{{ poiCountLabel(poi) }}</span>
          </span>
        </div>
      </div>
    </template>

    <!-- ── 模态框（点击脚边道具/POI 时打开） ── -->
    <div
      v-if="modalOpen"
      class="modal-overlay open"
      @click="onOverlayClick"
    >
      <div class="modal">
        <div class="modal-header">
          <span class="modal-title">{{ modalTitle }}</span>
          <button class="modal-close" @click="onCloseModal">[X]</button>
        </div>
        <div class="modal-body">
          <!-- 机制触发结果（已搜索的机制型 POI） -->
          <div v-if="showMechanicResult" class="mechanic-result">
            <div class="mechanic-effect">
              ✦ {{ modalPoi?.mechanic }} +{{ modalPoi?.mechanic_value || 0 }}
            </div>
            <div class="modal-footer">
              <button class="term-btn" @click="onCloseModal">[确认]</button>
            </div>
          </div>

          <template v-else>
            <!-- 搜索按钮 -->
            <div v-if="searchLimitReached" class="tile-empty" style="margin-bottom:8px;">
              已达搜索上限
            </div>
            <div v-else-if="showSearchBtn" style="margin-bottom:8px;">
              <button
                class="term-btn block"
                :disabled="commandQueue.isLocked"
                @click="onSearch"
              >{{ searchBtnText }}</button>
            </div>

            <!-- 道具列表 -->
            <template v-if="showItemsList">
              <div
                v-for="item in modalItems"
                :key="item.iid"
                class="modal-item"
                @click="onPickup(item.iid)"
              >
                <span class="item-tag">[P]</span>
                <span class="item-name">{{ itemDisplayName(item) }}</span>
                <span v-if="showItemMeta(item)" class="item-meta">
                  {{ getItmkName(item.itmk) }} {{ itemMeta(item) }}
                </span>
              </div>
              <div class="modal-footer">
                <button
                  class="term-btn"
                  :disabled="commandQueue.isLocked"
                  @click="onPickupAll"
                >[全部拾取]</button>
              </div>
            </template>

            <!-- 无可交互内容 -->
            <div v-else-if="showEmptyContent" class="tile-empty">
              无可交互内容
            </div>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>
