<script setup lang="ts">
/**
 * @module L Vue 组件
 * @framework L-1 统一交互列表模式
 */
// ══════════════════════════════════════════════════
// 地格动作条 / Tile Action Bar
//
// 替代现有 vex/js/tile-action.js 的渲染 + 交互逻辑。
//
// 布局（与现有 index.html #tileActionBar 一致）：
//   ┌─ 常驻按钮区 ──────────────────
//   [E] 探索周围  [区域切换]（条件显示）
//   ┌─ 行动入口区 ─────────────────
//   [脚边道具 ×N]   [POI 交互 ×N]   ← 单按钮入口，与脚边道具并列
//
// 模态框（仅脚边道具，POI 交互由 L-9 PoiModal 接管）：
//   - ground：道具列表 + [全部拾取]
//
// POI 入口（onCheckPoi）委托 poiStore.openModal()，由 PoiModal.vue (L-9)
// 承载列表态 + 交互态双态切换。tileActionStore 的 POI 模态框逻辑保留但不再使用。
//
// 渲染策略（M4）：v-for + v-if 响应式渲染，无 innerHTML 依赖。
//
// 设计案：oblivions/docs/POI入口收敛与交互列表合并研判-设计案-2026-07-19.md §3.2
// ══════════════════════════════════════════════════

import { computed } from 'vue';
import { useTileActionStore } from '@/stores/tileAction';
import { usePoiStore } from '@/stores/poi';
import { useMapStore } from '@/stores/map';
import { useCraftStore } from '@/stores/craft';
import { commandQueue } from '@/stores/command-queue';
import type { GroundItem } from '@/types/api';
import { getItemName, isInfinite } from '@/data/item-locale';
import { getItmkName } from '@/data/itmk-locale';
import { UI_TEXT } from '@/data/ui-locale';
import ExploreButton from './ExploreButton.vue';

const tileActionStore = useTileActionStore();
const poiStore = usePoiStore();
const mapStore = useMapStore();
const craftStore = useCraftStore();

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
const poiCount = computed<number>(() => tileActionStore.pois.length);
const groundItems = computed<GroundItem[]>(() => tileActionStore.groundItems);
const hasGround = computed<boolean>(() => groundItems.value.length > 0);
const hasPois = computed<boolean>(() => poiCount.value > 0);
const isEmpty = computed<boolean>(() => !hasGround.value && !hasPois.value);

// ── 模态框数据（仅 ground 模态框；POI 模态框由 PoiModal.vue L-9 接管） ──
const modalOpen = computed<boolean>(() => tileActionStore.modalOpen);
const modalType = computed(() => tileActionStore.modalType);
const modalTitle = computed<string>(() => tileActionStore.modalTitle);
const modalItems = computed<GroundItem[]>(() => tileActionStore.modalItems);

/** 是否显示道具列表（ground 模态框且非空时） */
const showItemsList = computed<boolean>(() => {
  if (modalType.value !== 'ground') return false;
  return modalItems.value.length > 0;
});

// ── 交互处理 ──
function onSwitchRegion(): void {
  tileActionStore.handleSwitchRegion();
}

function onOpenCraft(): void {
  void craftStore.openModal();
}

function onCheckGround(): void {
  tileActionStore.openGroundModal();
}

/** 点击 POI 入口 → 委托 poiStore 打开 L-9 PoiModal（双态切换由 PoiModal 内部承载） */
function onCheckPoi(): void {
  poiStore.openModal();
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
</script>

<template>
  <div class="flex-1 overflow-y-auto min-h-0">
    <!-- 加载中 -->
    <div v-if="tileActionStore.loading && !tileActionStore.tileActions" class="loading">{{ UI_TEXT.LOADING }}</div>

    <template v-else-if="tileActionStore.tileActions">
      <!-- ── 常驻按钮区 ── -->
      <div class="action-buttons" style="display:flex;gap:6px;margin-bottom:6px;">
        <ExploreButton />
        <button
          class="term-btn block"
          style="flex:1;"
          :disabled="!commandQueue.canExecute('craft.execute')"
          @click="onOpenCraft"
        >[合成]</button>
        <button
          v-if="switchRegionVisible"
          class="term-btn block"
          style="flex:2;"
          :disabled="!commandQueue.canExecute('map.move')"
          @click="onSwitchRegion"
        >[{{ switchRegionText }}]</button>
      </div>

      <!-- ── 行动入口区（脚边道具 + POI 交互单按钮入口） ── -->
      <div v-if="isEmpty" class="tile-empty">此处无可交互对象</div>
      <div v-else class="action-entries">
        <!-- 脚边道具 -->
        <button
          v-if="hasGround"
          class="term-btn block action-entry"
          @click="onCheckGround"
        >[脚边道具 ×{{ groundItems.length }}]</button>
        <!-- POI 交互单按钮入口（仅当图格有 POI 时显示，按原始方案 §3.1 §4.1 设计） -->
        <button
          v-if="hasPois"
          class="term-btn block action-entry"
          @click="onCheckPoi"
        >[POI 交互 ×{{ poiCount }}]</button>
      </div>
    </template>

    <!-- ── 脚边道具模态框（POI 模态框由 PoiModal.vue L-9 独立承载） ── -->
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
          <!-- 脚边道具列表 -->
          <template v-if="showItemsList">
            <div
              v-for="item in modalItems"
              :key="item.iid"
              class="modal-item"
              @click="onPickup(item.iid)"
            >
              <span class="item-name">{{ itemDisplayName(item) }}</span>
              <span v-if="showItemMeta(item)" class="item-meta">
                {{ getItmkName(item.itmk) }} {{ itemMeta(item) }}
              </span>
            </div>
            <div class="modal-footer">
              <button
                class="term-btn"
                :disabled="!commandQueue.canExecute('item.pickup')"
                @click="onPickupAll"
              >[全部拾取]</button>
            </div>
          </template>

          <!-- 无可交互内容 -->
          <div v-else class="tile-empty">
            无可交互内容
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ── 行动入口区：脚边道具 + POI 交互 单按钮入口并列 ──
 * 替代原 .poi-grid 2 列网格（POI 列表收敛到 PoiModal 列表态卡片，参见设计案 §3.2.1）
 */
.action-entries {
  display: flex;
  gap: 6px;
  align-items: stretch;
}

.action-entry {
  flex: 1 1 0;
  min-width: 0;
  padding: 6px 8px;
  font-size: 12px;
}
</style>
