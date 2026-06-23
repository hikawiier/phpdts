<script setup lang="ts">
// ══════════════════════════════════════════════════
// 右侧抽屉 / Inventory Drawer — 背包 + 装备
//
// 替代现有 vex/index.html 的 #invDrawer + vex/js/inventory.js 的渲染逻辑。
//
// 布局（与现有 index.html 一致）：
//   ┌─ INVENTORY | ARMAMENT ──── [X]
//   当前标签内容（背包列表 / 装备列表）
//
// 标签切换逻辑已实现（uiStore.activeInvTab）。
// 内容由 InventoryList.vue / EquipmentList.vue 渲染（M4）。
// ══════════════════════════════════════════════════

import { useUiStore } from '@/stores/ui';
import InventoryList from '@/components/inventory/InventoryList.vue';
import EquipmentList from '@/components/inventory/EquipmentList.vue';

const uiStore = useUiStore();
</script>

<template>
  <!-- 遮罩 -->
  <div
    class="inv-drawer-overlay fixed inset-0 bg-black/70 z-[350]"
    :class="{ open: uiStore.inventoryDrawerOpen }"
    @click="uiStore.closeInventoryDrawer"
  ></div>
  <!-- 抽屉 -->
  <div
    class="inv-drawer fixed top-0 right-0 w-[300px] h-screen bg-bg z-[400] flex flex-col border-l-2 border-hi"
    :class="{ open: uiStore.inventoryDrawerOpen }"
  >
    <!-- 头部：标签 + 关闭 -->
    <div class="flex justify-between items-center px-4 py-3 border-b border-fg-dim/30 text-fg-bright text-xs tracking-widest flex-none">
      <div class="flex gap-4">
        <button
          class="inv-tab"
          :class="{ active: uiStore.activeInvTab === 'inventory' }"
          @click="uiStore.setActiveInvTab('inventory')"
        >INVENTORY</button>
        <button
          class="inv-tab"
          :class="{ active: uiStore.activeInvTab === 'equipment' }"
          @click="uiStore.setActiveInvTab('equipment')"
        >ARMAMENT</button>
      </div>
      <button
        class="text-fg-dim hover:text-hi transition-colors cursor-pointer text-sm"
        @click="uiStore.closeInventoryDrawer"
      >[X]</button>
    </div>
    <!-- 内容 -->
    <div class="flex-1 overflow-y-auto p-4 min-h-0">
      <InventoryList v-if="uiStore.activeInvTab === 'inventory'" />
      <EquipmentList v-else />
    </div>
  </div>
</template>
