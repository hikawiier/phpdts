<script setup lang="ts">
// ══════════════════════════════════════════════════
// 背包列表 / Inventory List
//
// 替代现有 vex/js/inventory.js renderInventoryContent()。
//
// 布局（与现有 index.html #invDrawerContent 一致）：
//   3 列网格，每个槽位显示 [slot] name kind eff:dur
//   非空槽位显示 [丢弃] 按钮
//   底部显示 items: N/M
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

function slotDisplayName(item: InventoryItem): string {
  return getItemName(item.itmid || item.item_id, item.name);
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
          <span class="slot-meta">eff:{{ s.effect }} dur:{{ s.durability }}</span>
          <div v-if="isOblivions" class="discard-wrap">
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
