<script setup lang="ts">
// RegionPanel：区域列表 + 区域属性编辑（对齐 NEW_DESIGN.md §3.1.1）
//
// 功能：
//   - 区域列表（pgroup + name）→ 点击切换 currentPgroup
//   - 新增 / 删除区域按钮
//   - 区域属性编辑：name / desc / cols / rows / entrance_pls / exit_pls / next_region / prev_region / exit_links
//   - pls 范围 1-254 / pgroup 范围 1-255 校验（对齐 DESIGN.md 1.1）
//   - cols / rows 上限 254（对齐 COLS_ROWS_MAX）

import { computed, ref } from 'vue';
import { useProjectStore } from '@/stores/projectStore';
import { useUiStore } from '@/stores/uiStore';
import { PLS_MAX, PLS_MIN, PGROUP_MAX, PGROUP_MIN, COLS_ROWS_MAX, COLS_ROWS_MIN } from '@/shared';
import BaseButton from '@/components/common/BaseButton.vue';
import BaseInput from '@/components/common/BaseInput.vue';
import BaseSelect from '@/components/common/BaseSelect.vue';
import { useI18n } from 'vue-i18n';
import type { Pgroup, Pls, ExitLink } from '@/shared';

const project = useProjectStore();
const ui = useUiStore();
const { t } = useI18n();

const regions = computed(() => project.regionList);
const current = computed(() => project.currentRegion);
const currentPgroup = computed(() => project.currentPgroup);

const regionOptions = computed(() =>
  regions.value.map((r) => ({
    value: r.pgroup,
    label: `#${r.pgroup} ${r.region.name}`,
  })),
);

function selectRegion(pgroup: Pgroup): void {
  project.setCurrentPgroup(pgroup);
}

function onAddRegion(): void {
  const pgroup = project.addRegion();
  if (pgroup === null) {
    ui.showToast(`已达区域数量上限（${PGROUP_MAX}）`, 'error');
  }
}

function onDeleteRegion(): void {
  if (currentPgroup.value === null) return;
  ui.openConfirm(`确认删除区域 #${currentPgroup.value}？该操作可撤销。`, () => {
    if (currentPgroup.value !== null) project.deleteRegion(currentPgroup.value);
  });
}

function onName(value: string): void {
  if (currentPgroup.value === null) return;
  project.updateRegion(currentPgroup.value, { name: value });
}
function onDesc(value: string): void {
  if (currentPgroup.value === null) return;
  project.updateRegion(currentPgroup.value, { desc: value });
}
function onCols(value: string): void {
  if (currentPgroup.value === null) return;
  const num = Number(value);
  if (Number.isNaN(num)) return;
  const safe = Math.min(Math.max(Math.floor(num), COLS_ROWS_MIN), COLS_ROWS_MAX);
  project.updateRegion(currentPgroup.value, { cols: safe });
}
function onRows(value: string): void {
  if (currentPgroup.value === null) return;
  const num = Number(value);
  if (Number.isNaN(num)) return;
  const safe = Math.min(Math.max(Math.floor(num), COLS_ROWS_MIN), COLS_ROWS_MAX);
  project.updateRegion(currentPgroup.value, { rows: safe });
}
function onEntrancePls(value: string): void {
  if (currentPgroup.value === null) return;
  if (value === '') {
    project.updateRegion(currentPgroup.value, { entrance_pls: null });
    return;
  }
  const num = Number(value);
  if (Number.isNaN(num)) return;
  const safe = Math.min(Math.max(Math.floor(num), PLS_MIN), PLS_MAX);
  project.updateRegion(currentPgroup.value, { entrance_pls: safe as Pls });
}
function onExitPls(value: string): void {
  if (currentPgroup.value === null) return;
  if (value === '') {
    project.updateRegion(currentPgroup.value, { exit_pls: null });
    return;
  }
  const num = Number(value);
  if (Number.isNaN(num)) return;
  const safe = Math.min(Math.max(Math.floor(num), PLS_MIN), PLS_MAX);
  project.updateRegion(currentPgroup.value, { exit_pls: safe as Pls });
}
function onNextRegion(value: string): void {
  if (currentPgroup.value === null) return;
  if (value === '') {
    project.updateRegion(currentPgroup.value, { next_region: null });
    return;
  }
  const num = Number(value);
  if (Number.isNaN(num)) return;
  const safe = Math.min(Math.max(Math.floor(num), PGROUP_MIN), PGROUP_MAX);
  project.updateRegion(currentPgroup.value, { next_region: safe as Pgroup });
}
function onPrevRegion(value: string): void {
  if (currentPgroup.value === null) return;
  if (value === '') {
    project.updateRegion(currentPgroup.value, { prev_region: null });
    return;
  }
  const num = Number(value);
  if (Number.isNaN(num)) return;
  const safe = Math.min(Math.max(Math.floor(num), PGROUP_MIN), PGROUP_MAX);
  project.updateRegion(currentPgroup.value, { prev_region: safe as Pgroup });
}

// ─── exit_links 编辑 ─────────────────────────────────
const newExitLink = ref<ExitLink>({ from_pls: null, to_pgroup: 1, to_pls: null });

function onAddExitLink(): void {
  if (currentPgroup.value === null) return;
  project.addExitLink(currentPgroup.value, { ...newExitLink.value });
}
function onRemoveExitLink(index: number): void {
  if (currentPgroup.value === null) return;
  project.removeExitLink(currentPgroup.value, index);
}
function onUpdateExitLink(index: number, patch: Partial<ExitLink>): void {
  if (currentPgroup.value === null) return;
  project.updateExitLink(currentPgroup.value, index, patch);
}
</script>

<template>
  <div class="flex h-full flex-col gap-2 overflow-auto p-2 text-sm">
    <div class="flex items-center justify-between">
      <span class="text-xs text-gray-500">区域</span>
      <div class="flex gap-1">
        <BaseButton size="sm" @click="onAddRegion">{{ t('common.add') }}</BaseButton>
        <BaseButton
          size="sm"
          variant="danger"
          :disabled="currentPgroup === null"
          @click="onDeleteRegion"
          >{{ t('common.delete') }}</BaseButton
        >
      </div>
    </div>

    <select
      v-if="regions.length > 0"
      :value="currentPgroup ?? ''"
      class="rounded border border-gray-700 bg-gray-900 px-2 py-1 text-sm text-gray-100"
      @change="(e) => selectRegion(Number((e.target as HTMLSelectElement).value) as Pgroup)"
    >
      <option v-for="r in regions" :key="r.pgroup" :value="r.pgroup">
        #{{ r.pgroup }} {{ r.region.name }}
      </option>
    </select>

    <div v-if="current" class="flex flex-col gap-2">
      <label class="flex flex-col gap-1 text-xs text-gray-400">
        <span>名称</span>
        <BaseInput :model-value="current.name" @update:model-value="onName" />
      </label>
      <label class="flex flex-col gap-1 text-xs text-gray-400">
        <span>描述</span>
        <BaseInput :model-value="current.desc" @update:model-value="onDesc" />
      </label>
      <div class="grid grid-cols-2 gap-2">
        <label class="flex flex-col gap-1 text-xs text-gray-400">
          <span>列数 (1-{{ COLS_ROWS_MAX }})</span>
          <BaseInput
            :model-value="current.cols"
            type="number"
            :min="COLS_ROWS_MIN"
            :max="COLS_ROWS_MAX"
            @update:model-value="onCols"
          />
        </label>
        <label class="flex flex-col gap-1 text-xs text-gray-400">
          <span>行数 (1-{{ COLS_ROWS_MAX }})</span>
          <BaseInput
            :model-value="current.rows"
            type="number"
            :min="COLS_ROWS_MIN"
            :max="COLS_ROWS_MAX"
            @update:model-value="onRows"
          />
        </label>
        <label class="flex flex-col gap-1 text-xs text-gray-400">
          <span>入口 pls (1-{{ PLS_MAX }})</span>
          <BaseInput
            :model-value="current.entrance_pls"
            type="number"
            :min="PLS_MIN"
            :max="PLS_MAX"
            @update:model-value="onEntrancePls"
          />
        </label>
        <label class="flex flex-col gap-1 text-xs text-gray-400">
          <span>出口 pls (1-{{ PLS_MAX }})</span>
          <BaseInput
            :model-value="current.exit_pls"
            type="number"
            :min="PLS_MIN"
            :max="PLS_MAX"
            @update:model-value="onExitPls"
          />
        </label>
        <label class="flex flex-col gap-1 text-xs text-gray-400">
          <span>下一区域 pgroup (1-{{ PGROUP_MAX }})</span>
          <BaseInput
            :model-value="current.next_region"
            type="number"
            :min="PGROUP_MIN"
            :max="PGROUP_MAX"
            @update:model-value="onNextRegion"
          />
        </label>
        <label class="flex flex-col gap-1 text-xs text-gray-400">
          <span>上一区域 pgroup (1-{{ PGROUP_MAX }})</span>
          <BaseInput
            :model-value="current.prev_region"
            type="number"
            :min="PGROUP_MIN"
            :max="PGROUP_MAX"
            @update:model-value="onPrevRegion"
          />
        </label>
      </div>

      <div class="mt-2 border-t border-gray-800 pt-2">
        <div class="mb-1 text-xs text-gray-500">exit_links</div>
        <div
          v-for="(link, idx) in current.exit_links"
          :key="idx"
          class="mb-1 flex items-center gap-1 text-xs"
        >
          <BaseInput
            :model-value="link.from_pls"
            type="number"
            placeholder="from"
            @update:model-value="(v) => onUpdateExitLink(idx, { from_pls: v === '' ? null : (Number(v) as Pls) })"
          />
          <BaseSelect
            :model-value="link.to_pgroup"
            :options="regionOptions"
            @change="(v) => onUpdateExitLink(idx, { to_pgroup: Number(v) as Pgroup })"
          />
          <BaseInput
            :model-value="link.to_pls"
            type="number"
            placeholder="to"
            @update:model-value="(v) => onUpdateExitLink(idx, { to_pls: v === '' ? null : (Number(v) as Pls) })"
          />
          <BaseButton size="sm" variant="ghost" @click="onRemoveExitLink(idx)">×</BaseButton>
        </div>
        <div class="flex items-center gap-1 text-xs">
          <BaseInput
            v-model="newExitLink.from_pls"
            type="number"
            placeholder="from"
          />
          <BaseSelect
            v-model="newExitLink.to_pgroup"
            :options="regionOptions"
          />
          <BaseInput
            v-model="newExitLink.to_pls"
            type="number"
            placeholder="to"
          />
          <BaseButton size="sm" @click="onAddExitLink">+</BaseButton>
        </div>
      </div>
    </div>
    <div v-else class="text-xs text-gray-600">未选中区域</div>
  </div>
</template>
