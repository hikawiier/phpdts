<script setup lang="ts">
/**
 * @module L Vue 组件
 * @framework L-9 POI 交互模态框
 */
// ══════════════════════════════════════════════════
// POI 反馈面板 / POI Feedback Panel
//
// L-9 POI 交互模态框的反馈区（设计案 §2.3 §2.8）。
//
// 三态视觉切换：
//   1. 空闲态（idle）：未执行搜索时显示 POI 描述文字（占位）
//   2. 搜索反馈态（feedback）：poi.search 命令完成后渲染 poiStore.lastSearchFeedback
//      （CommandResult.message / feedback 渲染后的文案，v-html 渲染）
//   3. 道具列表态（loot）：currentPoi.items.length > 0 时显示（与反馈态并存）
//      - 显示已发现道具列表（物品名 + 类别 + 效/耐 + 单件 [拾取] 按钮）
//      - [全部拾取] 按钮调用 poiStore.pickupAllItems
//      - 道具列表响应式更新——拾取后 tile_actions 刷新，currentPoi.items[] 自动移除
//
// itm0 锁定下：单件 [拾取] / [全部拾取] 按钮 :disabled="!canPickup"，
// 与搜索按钮区替换的 [尝试堆叠合并] / [丢到地上] 解锁按钮协同。
//
// 相关文档：oblivions/docs/搜索建筑物与掉落机制重构-模块L-POI交互界面.md §2.3 §2.7 §2.8
// ══════════════════════════════════════════════════

import { computed } from 'vue';
import { usePoiStore } from '@/stores/poi';
import { getItemName, isInfinite } from '@/data/item-locale';
import { getItmkName } from '@/data/itmk-locale';
import type { GroundItem } from '@/types/api';

const poiStore = usePoiStore();

// ── 派生状态 ──
const lastSearchFeedback = computed(() => poiStore.lastSearchFeedback);
const items = computed<GroundItem[]>(() => poiStore.currentPoiItems);
const canPickup = computed(() => poiStore.canPickup);
const pickupLoading = computed(() => poiStore.pickupLoading);

/** 是否显示反馈区（有反馈文案或有道具） */
const hasFeedback = computed<boolean>(() => lastSearchFeedback.value !== null);
const hasItems = computed<boolean>(() => items.value.length > 0);

// ── 道具显示辅助（迁移自 TileActionBar.vue） ──

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
  const dur = isInfinite(rawDur) ? '∞' : rawDur;
  return `${eff}/${dur}`;
}

// ── 事件处理 ──

function onPickup(iid: string | number): void {
  void poiStore.pickupItem(iid);
}

function onPickupAll(): void {
  void poiStore.pickupAllItems();
}
</script>

<template>
  <div class="poi-feedback-panel">
    <!-- ── 反馈文案区（feedback 态） ── -->
    <div v-if="hasFeedback" class="feedback-section">
      <div class="ascii-title">
        <span class="ascii-label">反馈</span>
        <span class="ascii-line" style="flex:1"></span>
      </div>
      <div
        class="feedback-content log-content"
        :class="{ 'is-html': lastSearchFeedback?.isHtml }"
        v-html="lastSearchFeedback?.message || ''"
      ></div>
    </div>

    <!-- ── 道具列表区（loot 态） ── -->
    <div v-if="hasItems" class="items-section">
      <div class="ascii-title">
        <span class="ascii-label">已发现道具</span>
        <span class="ascii-line" style="flex:1"></span>
      </div>
      <div class="items-list">
        <div
          v-for="item in items"
          :key="item.iid"
          class="item-row"
        >
          <span class="item-name">{{ itemDisplayName(item) }}</span>
          <span v-if="showItemMeta(item)" class="item-meta">
            {{ getItmkName(item.itmk) }} {{ itemMeta(item) }}
          </span>
          <button
            class="term-btn pickup-btn"
            :disabled="!canPickup || pickupLoading"
            @click="onPickup(item.iid)"
          >[拾取]</button>
        </div>
      </div>
      <div class="items-footer">
        <button
          class="term-btn block"
          :disabled="!canPickup || pickupLoading"
          @click="onPickupAll"
        >[全部拾取]</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.poi-feedback-panel {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 4px 0;
}

/* ── 反馈区 ── */
.feedback-section {
  padding: 4px 0;
}

.ascii-title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
  font-size: 10px;
  color: #666;
}

.ascii-label {
  flex: 0 0 auto;
}

.ascii-line {
  height: 1px;
  background: rgba(68, 68, 68, 0.3);
}

.feedback-content {
  font-size: 11px;
  line-height: 1.5;
  padding: 4px 2px;
  color: #ddd;
}

.feedback-content.is-html {
  /* v-html 渲染的 HTML 可能含 .yellow/.red/.grey 等 terminal.css 内联类 */
}

/* ── 道具列表区 ── */
.items-section {
  padding: 4px 0;
  border-top: 1px dashed rgba(68, 68, 68, 0.3);
}

.items-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.item-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 6px;
  font-size: 11px;
  border: 1px solid rgba(68, 68, 68, 0.2);
  transition: border-color 0.12s;
}

.item-row:hover {
  border-color: rgba(68, 68, 68, 0.5);
}

.item-name {
  color: #ddd;
  flex: 1 1 auto;
}

.item-meta {
  color: #666;
  font-size: 10px;
  flex: 0 0 auto;
  white-space: nowrap;
}

.pickup-btn {
  padding: 2px 8px;
  font-size: 10px;
  flex: 0 0 auto;
}

.items-footer {
  margin-top: 4px;
  padding-top: 4px;
  border-top: 1px dashed rgba(68, 68, 68, 0.2);
}
</style>
