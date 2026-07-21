<script setup lang="ts">
// BrushPresetPanel：画笔预设面板（对齐 NEW_DESIGN.md §3.1.5）
//
// floor 下拉 5 类 / tide 下拉 3 档（不含 safe，对齐 DESIGN.md 1.3） / passable / height / destructible / preset_safe
// 仅在 draw / paint 工具激活时显示（由父级 v-if 控制）

import { computed } from 'vue';
import { useToolStore } from '@/stores/toolStore';
import { FLOOR_OPTIONS, TIDE_OPTIONS } from '@/shared';
import BaseSelect from '@/components/common/BaseSelect.vue';
import BaseInput from '@/components/common/BaseInput.vue';
import BaseCheckbox from '@/components/common/BaseCheckbox.vue';
import { useI18n } from 'vue-i18n';
import type { Floor, Tide } from '@/shared';

const tool = useToolStore();
const { t } = useI18n();

const brush = computed(() => tool.brush);

const floorOptions = FLOOR_OPTIONS.map((o) => ({
  value: o.value,
  label: t(`floor.${o.value}`),
}));

const tideOptions = TIDE_OPTIONS.map((o) => ({
  value: o.value,
  label: t(`tide.${o.value}`),
}));

function onFloor(value: string): void {
  tool.updateBrush({ floor: value as Floor });
}
function onTide(value: string): void {
  tool.updateBrush({ tide: value as Tide });
}
function onPassable(value: boolean): void {
  tool.updateBrush({ passable: value });
}
function onHeight(value: string): void {
  const num = Number(value);
  if (!Number.isNaN(num)) tool.updateBrush({ height: num });
}
function onDestructible(value: boolean): void {
  tool.updateBrush({ destructible: value });
}
function onPresetSafe(value: boolean): void {
  tool.updateBrush({ preset_safe: value });
}
</script>

<template>
  <div class="flex flex-col gap-2 border-b border-gray-800 bg-gray-900 p-2">
    <div class="text-xs text-gray-500">画笔预设</div>
    <div class="grid grid-cols-2 gap-2">
      <label class="flex flex-col gap-1 text-xs text-gray-400">
        <span>Floor</span>
        <BaseSelect
          :model-value="brush.floor"
          :options="floorOptions"
          aria-label="Floor"
          @change="onFloor"
        />
      </label>
      <label class="flex flex-col gap-1 text-xs text-gray-400">
        <span>Tide</span>
        <BaseSelect
          :model-value="brush.tide"
          :options="tideOptions"
          aria-label="Tide"
          @change="onTide"
        />
      </label>
      <label class="flex flex-col gap-1 text-xs text-gray-400">
        <span>Height</span>
        <BaseInput
          :model-value="brush.height"
          type="number"
          aria-label="Height"
          @update:model-value="onHeight"
        />
      </label>
      <div class="flex items-center gap-2">
        <BaseCheckbox
          :model-value="brush.passable"
          label="Passable"
          @update:model-value="onPassable"
        />
      </div>
      <div class="flex items-center gap-2">
        <BaseCheckbox
          :model-value="brush.destructible"
          label="Destructible"
          @update:model-value="onDestructible"
        />
      </div>
      <div class="flex items-center gap-2">
        <BaseCheckbox
          :model-value="brush.preset_safe"
          label="Preset Safe"
          @update:model-value="onPresetSafe"
        />
      </div>
    </div>
  </div>
</template>
