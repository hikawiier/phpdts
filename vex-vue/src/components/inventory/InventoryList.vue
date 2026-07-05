<script setup lang="ts">
// ══════════════════════════════════════════════════
// 背包列表 / Inventory List
//
// 替代现有 vex/js/inventory.js renderInventoryContent()。
//
// 布局（与现有 index.html #invDrawerContent 一致）：
//   3 列网格，每个槽位显示 [slot] name kind eff:dur
//   非空槽位显示 [使用]/[丢弃] 按钮
//   底部显示 items: N/M
//
// 注意：itm0 待整理提醒已迁移至独立的 Itm0Modal.vue（App.vue 全局挂载）。
//
// 渲染策略（M4）：v-for 响应式渲染，无 innerHTML 依赖。
// ══════════════════════════════════════════════════

import { computed } from 'vue';
import { useInventoryStore } from '@/stores/inventory';
import { useMapStore } from '@/stores/map';
import { commandQueue } from '@/stores/command-queue';
import type { InventoryItem } from '@/types/api';
import { getItemName } from '@/data/item-locale';

const inventoryStore = useInventoryStore();
const mapStore = useMapStore();

// ── 是否为 Oblivions 模式（有 mapData.links 时显示丢弃按钮） ──
const isOblivions = computed<boolean>(() => !!mapStore.links);

const slots = computed<InventoryItem[]>(() => inventoryStore.slots);
const num = computed<number>(() => inventoryStore.num);
const limit = computed<number>(() => inventoryStore.limit);

function onDiscard(slot: number): void {
  if (commandQueue.isLocked) return;
  inventoryStore.handleDiscard(slot);
}

function onUse(slot: number): void {
  if (commandQueue.isLocked) return;
  inventoryStore.handleUseItem(slot);
}

function slotDisplayName(item: InventoryItem): string {
  return getItemName(item.itmid || item.item_id, item.name);
}

/**
 * 数量/耐久语义区分显示
 * stack=true 显示 ×N（堆叠数量），stack=false 显示 耐久 N（耐久度）
 */
function slotMeta(item: InventoryItem): string {
  const dur = String(item.durability ?? '0');
  if (dur === '∞' || dur === '999') {
    return item.stack ? '×∞' : '耐久 ∞';
  }
  return item.stack ? `×${dur}` : `耐久 ${dur}`;
}
</script>

<template>
  <div v-if="inventoryStore.loading && !inventoryStore.inventoryData" class="loading">
    loading...
  </div>
  <template v-else-if="inventoryStore.inventoryData">
    <div class="inv-grid">
      <div
        v-for="s in slots"
        :key="s.slot"
        :class="['slot-card', s.empty ? 'slot-empty' : 'slot-filled']"
      >
        <span class="slot-num">[{{ s.slot }}]</span>
        <template v-if="!s.empty">
          <span class="slot-name">{{ slotDisplayName(s) }}</span>
          <span class="slot-kind">{{ s.kind }}</span>
          <span class="slot-meta">{{ slotMeta(s) }}</span>
          <div v-if="isOblivions" class="slot-actions">
            <button
              v-if="s.usable"
              class="term-btn"
              :disabled="commandQueue.isLocked"
              @click="onUse(s.slot)"
            >[使用]</button>
            <button
              class="term-btn discard"
              :disabled="commandQueue.isLocked"
              @click="onDiscard(s.slot)"
            >[丢弃]</button>
          </div>
        </template>
        <template v-else>
          <span class="slot-kind">···</span>
        </template>
      </div>
    </div>
    <div class="slot-info">items: {{ num }}/{{ limit }}</div>
  </template>
  <div v-else class="loading">loading...</div>
</template>
