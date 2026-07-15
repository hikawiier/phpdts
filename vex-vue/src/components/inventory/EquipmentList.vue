<script setup lang="ts">
/**
 * @module L Vue 组件
 */
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
import { getItemName } from '@/data/item-locale';
import { UI_TEXT } from '@/data/ui-locale';

const inventoryStore = useInventoryStore();

const equipment = computed<Record<string, EquipmentSlot | null>>(
  () => inventoryStore.equipment,
);

/** 获取指定槽位的装备 */
function getEquip(key: string): EquipmentSlot | null {
  return equipment.value[key] || null;
}

function isEquipEmpty(equip: EquipmentSlot | null): boolean {
  return !equip || (!equip.item_id && !equip.itmid && !equip.name);
}

function equipDisplayName(equip: EquipmentSlot | null): string {
  if (!equip) return '';
  const customName = equip.name?.trim();
  if (customName) return customName;
  return getItemName(equip.item_id || equip.itmid);
}
</script>

<template>
  <div v-if="!inventoryStore.loading || inventoryStore.inventoryData">
    <div
      v-for="es in EQUIPMENT_SLOTS"
      :key="es.key"
      :class="['eq-slot', isEquipEmpty(getEquip(es.key)) ? 'eq-empty' : '']"
    >
      <span class="eq-label">{{ es.label }}</span>
      <template v-if="!isEquipEmpty(getEquip(es.key))">
        <span class="eq-name">{{ equipDisplayName(getEquip(es.key)) }}</span>
        <span class="eq-meta">{{ UI_TEXT.ATK }}:{{ getEquip(es.key)?.exp || 0 }}</span>
      </template>
      <template v-else>
        <span class="eq-name">---</span>
      </template>
    </div>
  </div>
  <div v-else class="loading">{{ UI_TEXT.LOADING }}</div>
</template>
