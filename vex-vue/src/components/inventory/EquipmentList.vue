<script setup lang="ts">
// ══════════════════════════════════════════════════
// 装备列表 / Equipment List
//
// 替代现有 vex/js/inventory.js renderEquipmentContent()。
//
// 布局（与现有 index.html #invDrawerContent 一致）：
//   7 个装备槽（WPN/SUB/BOD/HED/ACC/FT/OTH）
//   每个槽位显示 label + name + ATK:exp
//   空槽位显示 ---
//
// 数据来源：playerStore.playerInfo.equipment（经 inventoryStore.equipment 计算属性）
// 渲染策略（M4）：v-for 响应式渲染，无 innerHTML 依赖。
// ══════════════════════════════════════════════════

import { computed } from 'vue';
import { useInventoryStore, EQUIPMENT_SLOTS } from '@/stores/inventory';
import type { EquipmentSlot } from '@/types/api';

const inventoryStore = useInventoryStore();

const equipment = computed<Record<string, EquipmentSlot | null>>(
  () => inventoryStore.equipment,
);

/** 获取指定槽位的装备 */
function getEquip(key: string): EquipmentSlot | null {
  return equipment.value[key] || null;
}
</script>

<template>
  <div v-if="!inventoryStore.loading || inventoryStore.inventoryData">
    <div
      v-for="es in EQUIPMENT_SLOTS"
      :key="es.key"
      :class="['eq-slot', getEquip(es.key) ? '' : 'eq-empty']"
    >
      <span class="eq-label">{{ es.label }}</span>
      <template v-if="getEquip(es.key)">
        <span class="eq-name">{{ getEquip(es.key)?.name }}</span>
        <span class="eq-meta">ATK:{{ getEquip(es.key)?.exp || 0 }}</span>
      </template>
      <template v-else>
        <span class="eq-name">---</span>
      </template>
    </div>
  </div>
  <div v-else class="loading">loading...</div>
</template>
