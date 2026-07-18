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
//   7 个装备槽（主武器/副武器/护甲/头部防具/手部防具/足部防具/饰品）
//   每个槽位显示 label + name + ATK:exp
//   空槽位显示 ---
//   副武器槽位下方提供"交换"按钮：主副武器互换（item.swap_weapon）
//
// 数据来源：playerStore.playerInfo.equipment（经 inventoryStore.equipment 计算属性）
// 渲染策略（M4）：v-for 响应式渲染，无 innerHTML 依赖。
// ══════════════════════════════════════════════════

import { computed } from 'vue';
import { useInventoryStore, EQUIPMENT_SLOTS } from '@/stores/inventory';
import { commandQueue } from '@/stores/command-queue';
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

function onUnequip(equipSlot: string): void {
  inventoryStore.handleUnequip(equipSlot);
}

/**
 * 主副武器交换按钮可用性：
 * - 命令门控通过（command-registry 注册了 item.swap_weapon）
 * - 至少有一把武器在槽（wep 或 wep2 任一非空）
 *   双空时后端会走 swap_weapon.both_empty 路径不报错，但 UI 仍禁用避免无意义点击
 */
const canSwapWeapon = computed<boolean>(() => {
  if (!commandQueue.canExecute('item.swap_weapon')) return false;
  const wep = getEquip('wep');
  const wep2 = getEquip('wep2');
  return !isEquipEmpty(wep) || !isEquipEmpty(wep2);
});

function onSwapWeapon(): void {
  inventoryStore.handleSwapWeapon();
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
        <button
          class="term-btn unequip"
          :disabled="!commandQueue.canExecute('item.unequip')"
          @click="onUnequip(es.key)"
        >[卸下]</button>
      </template>
      <template v-else>
        <span class="eq-name">---</span>
      </template>
    </div>
    <div class="eq-slot eq-swap-row">
      <span class="eq-label">武器互换</span>
      <button
        class="term-btn swap"
        :disabled="!canSwapWeapon"
        @click="onSwapWeapon"
      >[交换]</button>
    </div>
  </div>
  <div v-else class="loading">{{ UI_TEXT.LOADING }}</div>
</template>
