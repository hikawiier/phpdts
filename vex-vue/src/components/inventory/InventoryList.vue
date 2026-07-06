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
// 注意：itm0 手持道具提醒已迁移至独立的 Itm0Modal.vue（App.vue 全局挂载）。
//
// 渲染策略（M4）：v-for 响应式渲染，无 innerHTML 依赖。
// ══════════════════════════════════════════════════

import { computed } from 'vue';
import { useInventoryStore } from '@/stores/inventory';
import { useMapStore } from '@/stores/map';
import { commandQueue } from '@/stores/command-queue';
import type { InventoryItem } from '@/types/api';
import { getItemName, isInfinite } from '@/data/item-locale';
import { getItmkName } from '@/data/itmk-locale';

const inventoryStore = useInventoryStore();
const mapStore = useMapStore();

// ── 是否为 Oblivions 模式（有 mapData.links 时显示丢弃按钮） ──
const isOblivions = computed<boolean>(() => !!mapStore.links);

const slots = computed<InventoryItem[]>(() => inventoryStore.slots);
const num = computed<number>(() => inventoryStore.num);
const limit = computed<number>(() => inventoryStore.limit);

function onDiscard(slot: number): void {
  inventoryStore.handleDiscard(slot);
}

function onUse(slot: number): void {
  inventoryStore.handleUseItem(slot);
}

function slotDisplayName(item: InventoryItem): string {
  return getItemName(item.itmid || item.item_id, item.name);
}

/**
 * 道具元信息显示：效/耐 分数格式（如 5/10、30/∞）
 * 统一格式，不区分数量模型与耐久模型
 */
function slotMeta(item: InventoryItem): string {
  const eff = String(item.effect ?? '0');
  const dur = String(item.durability ?? '0');
  const durLabel = (isInfinite(dur)) ? '∞' : dur;
  return `${eff}/${durLabel}`;
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
          <span class="slot-kind">{{ getItmkName(s.kind) }}</span>
          <span class="slot-meta">{{ slotMeta(s) }}</span>
          <div v-if="isOblivions" class="slot-actions">
            <button
              v-if="s.usable"
              class="term-btn"
              :disabled="!commandQueue.canExecute('obl_use_item')"
              @click="onUse(s.slot)"
            >[使用]</button>
            <button
              class="term-btn discard"
              :disabled="!commandQueue.canExecute('obl_discard')"
              @click="onDiscard(s.slot)"
            >[丢弃]</button>
          </div>
        </template>
        <template v-else>
          <span class="slot-kind">···</span>
        </template>
      </div>
    </div>
    <div class="slot-info">物品: {{ num }}/{{ limit }}</div>
  </template>
  <div v-else class="loading">loading...</div>
</template>
