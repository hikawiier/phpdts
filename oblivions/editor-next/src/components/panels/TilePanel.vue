<!-- @module O 内容工具箱 -->
<script setup lang="ts">
// TilePanel：格属性编辑（对齐 NEW_DESIGN.md §3.1.2）
//
// 编辑当前选中格的属性：name / desc / floor / tide / height / destructible / preset_safe / passable / x / y / neighbors（只读）

import { computed } from 'vue';
import { useProjectStore } from '@/stores/projectStore';
import { useI18n } from 'vue-i18n';
import { FLOOR_OPTIONS, TIDE_OPTIONS } from '@/shared';
import BaseInput from '@/components/common/BaseInput.vue';
import BaseSelect from '@/components/common/BaseSelect.vue';
import BaseCheckbox from '@/components/common/BaseCheckbox.vue';
import type { Floor, Tide, Pls } from '@/shared';

const project = useProjectStore();
const { t } = useI18n();

const tile = computed(() => project.currentTile);
const pgroup = computed(() => project.currentPgroup);
const pls = computed<Pls | null>(() => project.selectedPls);

// 与 BrushPresetPanel 一致：value=英文 key（对齐后端 PHP），label=i18n 本地化文案
const floorOptions = FLOOR_OPTIONS.map((o) => ({ value: o.value, label: t(`floor.${o.value}`) }));
const tideOptions = TIDE_OPTIONS.map((o) => ({ value: o.value, label: t(`tide.${o.value}`) }));

function onName(value: string): void {
  if (pgroup.value === null || pls.value === null) return;
  project.updateTile(pgroup.value, pls.value, { name: value });
}
function onDesc(value: string): void {
  if (pgroup.value === null || pls.value === null) return;
  project.updateTile(pgroup.value, pls.value, { desc: value });
}
function onFloor(value: string): void {
  if (pgroup.value === null || pls.value === null) return;
  project.updateTile(pgroup.value, pls.value, { floor: value as Floor });
}
function onTide(value: string): void {
  if (pgroup.value === null || pls.value === null) return;
  project.updateTile(pgroup.value, pls.value, { tide: value as Tide });
}
function onHeight(value: string): void {
  if (pgroup.value === null || pls.value === null) return;
  const num = Number(value);
  if (!Number.isNaN(num)) project.updateTile(pgroup.value, pls.value, { height: num });
}
function onX(value: string): void {
  if (pgroup.value === null || pls.value === null) return;
  const num = Number(value);
  if (!Number.isNaN(num)) project.updateTile(pgroup.value, pls.value, { x: Math.floor(num) });
}
function onY(value: string): void {
  if (pgroup.value === null || pls.value === null) return;
  const num = Number(value);
  if (!Number.isNaN(num)) project.updateTile(pgroup.value, pls.value, { y: Math.floor(num) });
}
function onPassable(value: boolean): void {
  if (pgroup.value === null || pls.value === null) return;
  project.updateTile(pgroup.value, pls.value, { passable: value });
}
function onDestructible(value: boolean): void {
  if (pgroup.value === null || pls.value === null) return;
  project.updateTile(pgroup.value, pls.value, { destructible: value });
}
function onPresetSafe(value: boolean): void {
  if (pgroup.value === null || pls.value === null) return;
  project.updateTile(pgroup.value, pls.value, { preset_safe: value });
}
</script>

<template>
  <div class="flex h-full flex-col gap-2 overflow-auto p-2 text-sm">
    <div class="text-xs text-gray-500">
      格属性
      <span v-if="pls !== null" class="ml-1 text-gray-400">#{{ pls }}</span>
    </div>
    <div v-if="tile && pls !== null" class="flex flex-col gap-2">
      <label class="flex flex-col gap-1 text-xs text-gray-400">
        <span>名称</span>
        <BaseInput :model-value="tile.name" aria-label="名称" @update:model-value="onName" />
      </label>
      <label class="flex flex-col gap-1 text-xs text-gray-400">
        <span>描述</span>
        <BaseInput :model-value="tile.desc" aria-label="描述" @update:model-value="onDesc" />
      </label>
      <div class="grid grid-cols-2 gap-2">
        <label class="flex flex-col gap-1 text-xs text-gray-400">
          <span>Floor</span>
          <BaseSelect
            :model-value="tile.floor"
            :options="floorOptions"
            aria-label="Floor"
            @change="onFloor"
          />
        </label>
        <label class="flex flex-col gap-1 text-xs text-gray-400">
          <span>Tide</span>
          <BaseSelect
            :model-value="tile.tide"
            :options="tideOptions"
            aria-label="Tide"
            @change="onTide"
          />
        </label>
        <label class="flex flex-col gap-1 text-xs text-gray-400">
          <span>Height</span>
          <BaseInput
            :model-value="tile.height"
            type="number"
            aria-label="Height"
            @update:model-value="onHeight"
          />
        </label>
        <label class="flex flex-col gap-1 text-xs text-gray-400">
          <span>X</span>
          <BaseInput :model-value="tile.x" type="number" aria-label="X" @update:model-value="onX" />
        </label>
        <label class="flex flex-col gap-1 text-xs text-gray-400">
          <span>Y</span>
          <BaseInput :model-value="tile.y" type="number" aria-label="Y" @update:model-value="onY" />
        </label>
      </div>
      <div class="flex flex-wrap gap-3">
        <BaseCheckbox :model-value="tile.passable" label="Passable" @update:model-value="onPassable" />
        <BaseCheckbox
          :model-value="tile.destructible"
          label="Destructible"
          @update:model-value="onDestructible"
        />
        <BaseCheckbox
          :model-value="tile.preset_safe"
          label="Preset Safe"
          @update:model-value="onPresetSafe"
        />
      </div>
      <div class="mt-1 border-t border-gray-800 pt-2 text-xs text-gray-500">
        <div>neighbors ({{ tile.neighbors.length }})</div>
        <div class="flex flex-wrap gap-1 text-gray-400">
          <span
            v-for="n in tile.neighbors"
            :key="n"
            class="rounded bg-gray-800 px-1.5 py-0.5 text-[10px]"
            >#{{ n }}</span
          >
          <span v-if="tile.neighbors.length === 0" class="text-gray-600">无</span>
        </div>
        <div v-if="tile._breaks && tile._breaks.length > 0" class="mt-1">
          <div>_breaks ({{ tile._breaks.length }})</div>
          <div class="flex flex-wrap gap-1 text-gray-400">
            <span
              v-for="b in tile._breaks"
              :key="b"
              class="rounded bg-gray-800 px-1.5 py-0.5 text-[10px] text-accent-error"
              >#{{ b }}</span
            >
          </div>
        </div>
      </div>
    </div>
    <div v-else class="text-xs text-gray-600">未选中格</div>
  </div>
</template>
