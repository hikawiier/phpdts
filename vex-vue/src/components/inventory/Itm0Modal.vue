<script setup lang="ts">
/**
 * @module L Vue 组件
 */
// ══════════════════════════════════════════════════
// itm0 手持道具提醒模态框 / Itm0 Modal
//
// 显示条件：inventoryStore.itm0 非空（玩家手中持有道具）。
//
// 设计理由：
//   itm0 状态下玩家无法进行其他操作（前后端均有拦截），因此模态框
//   不可"关闭"——[使用] / [尝试堆叠合并] / [丢到地上] 能真正消除它，
//   [等待] 是持续状态框架保留的零资源时间推进出口，不会处理 itm0。
//   （通过清空 itm0）。这避免了"假关闭"的误导，强制玩家正面处理。
//   itm0 的道具可被直接使用（与旧 phpdts "手持道具可直接使用"语义一致），
//   使用后若道具被消耗（数量/耐久归零），itm0 自动清空，模态框消失。
//
//   无 [X] 按钮、无遮罩点击关闭、无 closed 状态。
// ══════════════════════════════════════════════════

import { computed } from 'vue';
import { useInventoryStore } from '@/stores/inventory';
import { commandQueue } from '@/stores/command-queue';
import type { InventoryItem } from '@/types/api';
import { getItemName, isInfinite } from '@/data/item-locale';
import { getItmkName } from '@/data/itmk-locale';
import { useTileActionStore } from '@/stores/tileAction';

const inventoryStore = useInventoryStore();
const tileActionStore = useTileActionStore();

const itm0 = computed<InventoryItem | null>(() => inventoryStore.itm0);

function onOrganize(): void {
  inventoryStore.handleOrganize();
}

function onUseItm0(): void {
  inventoryStore.handleUseItem(0);
}

function onDiscardItm0(): void {
  inventoryStore.handleDiscardItm0();
}

function onWait(): void {
  void tileActionStore.handleWait();
}

function slotDisplayName(item: InventoryItem): string {
  return getItemName(item.itmid || item.item_id, item.name);
}

function slotMeta(item: InventoryItem): string {
  const eff = String(item.effect ?? '0');
  const dur = String(item.durability ?? '0');
  const durLabel = isInfinite(dur) ? '∞' : dur;
  return `${eff}/${durLabel}`;
}
</script>

<template>
  <div
    v-if="itm0"
    class="modal-overlay open"
  >
    <div class="modal itm0-modal">
      <div class="modal-header">
        <span class="modal-title">
          <span class="itm0-warn">[!]</span>
          手持道具
        </span>
      </div>
      <div class="modal-body">
        <p class="itm0-desc">手持道具会限制其他操作；也可以先等待一刻。</p>
        <div class="itm0-item">
          <span class="slot-num">[0]</span>
          <span class="slot-name">{{ slotDisplayName(itm0) }}</span>
          <span class="slot-kind">{{ getItmkName(itm0.kind) }}</span>
          <span class="slot-meta">{{ slotMeta(itm0) }}</span>
        </div>
      </div>
      <div class="modal-footer">
        <div class="itm0-modal-actions">
          <button
            class="term-btn"
            :disabled="!commandQueue.canExecute('world.wait')"
            :title="commandQueue.getBlockDecision('world.wait')?.message || '推进 1 tick，不处理手持道具'"
            @click="onWait"
          >[等待]</button>
          <button
            v-if="itm0.usable"
            class="term-btn"
            :disabled="!commandQueue.canExecute('item.use')"
            @click="onUseItm0"
          >[使用]</button>
          <button
            class="term-btn"
            :disabled="!commandQueue.canExecute('inventory.organize')"
            @click="onOrganize"
          >[尝试堆叠合并]</button>
          <button
            class="term-btn"
            :disabled="!commandQueue.canExecute('item.discard')"
            @click="onDiscardItm0"
          >[丢到地上]</button>
        </div>
      </div>
    </div>
  </div>
</template>
