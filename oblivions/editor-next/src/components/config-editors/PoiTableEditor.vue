<script setup lang="ts">
//
// PoiTableEditor：poi_table 编辑器（对齐 NEW_DESIGN.md §3.4.2 + §3.4.5 schema 驱动 UI）
//
// 研判：
//   - poi_table 是配置编辑框架的核心子模块
//   - 复用 SchemaField / BaseButton / BaseInput
//   - mechanic / loot_table_id / event_id 外部引用校验由 validateStore 负责
//
// 设计意图（对齐 2.6 配置驱动 + 2.15 视觉）：
//   - 左：模板列表（poi_id 列表，新增 / 重命名 / 删除）
//   - 右：schema 驱动字段编辑（17 字段按 4 组分组：基本 / E-10 三档判定 / 机制型 / E-12 耐久）
//   - 子列表（event_pool / dismantle_returns / prob_mods_source / loot_table_overrides）由 SchemaField 递归渲染
//   - mechanic_params 是 JSON 字符串字段，由 SchemaField 内置 JSON.parse 校验
//   - 字段大部分可选——landmark / forge_anvil_poi 等仅含部分字段，未设置字段不写入导出
//   - 视觉对齐 2.15：错误用 accent-error，正常态全用灰阶
//
// 数据流：
//   - 读：config.poiTable（Record<poi_id, PoiTableEntry>）
//   - 写：addPoiTemplate / updatePoiTemplate / removePoiTemplate / renamePoiTemplate
//   - 单一数据源：configStore.poiTable（无本地副本）

import { ref, computed } from 'vue';
import { useConfigStore } from '@/stores/configStore';
import { useUiStore } from '@/stores/uiStore';
import {
  POI_TABLE_ENTRY_SCHEMA,
  POI_TABLE_FIELD_GROUPS,
  type FieldSchema,
} from '@/shared';
import type { PoiTableEntry } from '@/shared';
import SchemaField from './SchemaField.vue';
import BaseButton from '@/components/common/BaseButton.vue';
import BaseInput from '@/components/common/BaseInput.vue';

const config = useConfigStore();
const ui = useUiStore();

// ─── 选中模板 + 编辑模式 ───────────────────────────────
const selectedId = ref<string | null>(null);
const isAddingNew = ref(false);
const newIdInput = ref('');
const renamingId = ref<string | null>(null);
const renameInput = ref('');

const hasData = computed(() => config.poiTable !== null);

const poiIds = computed<string[]>(() => {
  if (!config.poiTable) return [];
  return Object.keys(config.poiTable);
});

const selectedEntry = computed<PoiTableEntry | null>(() => {
  if (!config.poiTable || selectedId.value === null) return null;
  return config.poiTable[selectedId.value] ?? null;
});

// ─── schema 字段分组（按 POI_TABLE_FIELD_GROUPS 顺序） ──
const groupedFields = computed<Array<{ group: string; fields: FieldSchema[] }>>(() => {
  const groups: Array<{ group: string; fields: FieldSchema[] }> = [];
  for (const groupName of POI_TABLE_FIELD_GROUPS) {
    const fields = POI_TABLE_ENTRY_SCHEMA.fields.filter((f) => f.group === groupName);
    if (fields.length > 0) {
      groups.push({ group: groupName, fields });
    }
  }
  return groups;
});

const fieldsByKey = computed<Record<string, FieldSchema>>(() => {
  const map: Record<string, FieldSchema> = {};
  for (const field of POI_TABLE_ENTRY_SCHEMA.fields) {
    map[field.key] = field;
  }
  return map;
});

// ─── 选中逻辑 ─────────────────────────────────────────

/**
 * 选中 POI 模板（切换时取消重命名 / 新增模式）
 */
function selectPoi(id: string): void {
  selectedId.value = id;
  isAddingNew.value = false;
  renamingId.value = null;
}

// ─── 新增模板 ──────────────────────────────────────────

function startAddNew(): void {
  isAddingNew.value = true;
  newIdInput.value = '';
}

function cancelAddNew(): void {
  isAddingNew.value = false;
  newIdInput.value = '';
}

function confirmAddNew(): void {
  const id = newIdInput.value.trim();
  if (!id) {
    ui.showToast('POI ID 不能为空', 'error');
    return;
  }
  if (config.poiTable && config.poiTable[id] !== undefined) {
    ui.showToast(`POI ID "${id}" 已存在`, 'error');
    return;
  }
  // 创建默认模板（基于 schema.default 填充必填字段）
  const template = makeDefaultEntry();
  if (config.addPoiTemplate(id, template)) {
    selectedId.value = id;
    isAddingNew.value = false;
    newIdInput.value = '';
  } else {
    ui.showToast(`POI ID "${id}" 已存在`, 'error');
  }
}

/**
 * 根据 schema.default 创建默认 PoiTableEntry
 *
 * 必填字段（searchable / repeatable）必须有默认值
 */
function makeDefaultEntry(): PoiTableEntry {
  const entry: Record<string, unknown> = {};
  for (const field of POI_TABLE_ENTRY_SCHEMA.fields) {
    if (field.default !== undefined) {
      entry[field.key] = field.default;
    }
  }
  // 必填字段兜底
  if (entry['searchable'] === undefined) entry['searchable'] = false;
  if (entry['repeatable'] === undefined) entry['repeatable'] = false;
  return entry as unknown as PoiTableEntry;
}

// ─── 删除模板 ──────────────────────────────────────────

function confirmDelete(id: string): void {
  ui.openConfirm(`确认删除 POI 模板 "${id}"？此操作不可撤销。`, () => {
    config.removePoiTemplate(id);
    if (selectedId.value === id) {
      selectedId.value = null;
    }
  });
}

// ─── 重命名模板 ────────────────────────────────────────

function startRename(id: string): void {
  renamingId.value = id;
  renameInput.value = id;
}

function cancelRename(): void {
  renamingId.value = null;
  renameInput.value = '';
}

function confirmRename(oldId: string): void {
  const newId = renameInput.value.trim();
  if (!newId) {
    ui.showToast('POI ID 不能为空', 'error');
    return;
  }
  if (newId === oldId) {
    renamingId.value = null;
    renameInput.value = '';
    return;
  }
  if (config.poiTable && config.poiTable[newId] !== undefined) {
    ui.showToast(`POI ID "${newId}" 已存在`, 'error');
    return;
  }
  if (config.renamePoiTemplate(oldId, newId)) {
    if (selectedId.value === oldId) {
      selectedId.value = newId;
    }
    renamingId.value = null;
    renameInput.value = '';
  } else {
    ui.showToast('重命名失败', 'error');
  }
}

// ─── 字段更新 ──────────────────────────────────────────

/**
 * SchemaField 字段更新回调
 *
 * 对于 mechanic_params 字段，modelValue 是 JSON.parse 后的对象（或 undefined）
 * configStore.toPhpFiles 会原样保留 mechanic_params
 */
function onFieldUpdate(key: string, value: unknown): void {
  if (selectedId.value === null) return;
  config.updatePoiTemplate(selectedId.value, { [key]: value } as Partial<PoiTableEntry>);
}
</script>

<template>
  <div class="flex h-full gap-2 overflow-hidden p-2 text-sm">
    <!-- 未加载状态 -->
    <div v-if="!hasData" class="flex h-full w-full items-center justify-center text-xs text-gray-600">
      请先加载 poi_table.php
    </div>

    <template v-else>
      <!-- 左：模板列表 -->
      <div class="flex w-48 flex-col gap-1 overflow-auto border-r border-gray-800 pr-2">
        <div class="flex items-center justify-between text-xs text-gray-500">
          <span>模板列表 ({{ poiIds.length }})</span>
        </div>

        <!-- 模板项 -->
        <div class="flex flex-col gap-0.5">
          <div
            v-for="id in poiIds"
            :key="id"
            class="group flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors"
            :class="
              selectedId === id
                ? 'bg-gray-700 text-gray-100'
                : 'text-gray-300 hover:bg-gray-800'
            "
          >
            <!-- 选中 / 重命名切换 -->
            <template v-if="renamingId === id">
              <BaseInput
                :model-value="renameInput"
                placeholder="新 ID"
                class="flex-1"
                @update:model-value="(v) => (renameInput = v)"
              />
              <BaseButton size="sm" variant="ghost" title="确认" @click="confirmRename(id)">√</BaseButton>
              <BaseButton size="sm" variant="ghost" title="取消" @click="cancelRename">×</BaseButton>
            </template>
            <template v-else>
              <button
                type="button"
                class="flex-1 truncate text-left"
                :title="id"
                @click="selectPoi(id)"
              >
                {{ id }}
              </button>
              <span class="hidden gap-0.5 group-hover:flex">
                <BaseButton
                  size="sm"
                  variant="ghost"
                  title="重命名"
                  @click="startRename(id)"
                >⟳</BaseButton>
                <BaseButton
                  size="sm"
                  variant="ghost"
                  title="删除"
                  class="hover:text-accent-error"
                  @click="confirmDelete(id)"
                >×</BaseButton>
              </span>
            </template>
          </div>
        </div>

        <!-- 新增输入框 -->
        <div v-if="isAddingNew" class="flex flex-col gap-1 border-t border-gray-800 pt-1">
          <BaseInput
            :model-value="newIdInput"
            placeholder="新 POI ID"
            @update:model-value="(v) => (newIdInput = v)"
          />
          <div class="flex gap-1">
            <BaseButton size="sm" variant="primary" class="flex-1" @click="confirmAddNew">新增</BaseButton>
            <BaseButton size="sm" variant="ghost" @click="cancelAddNew">取消</BaseButton>
          </div>
        </div>

        <!-- 新增按钮 -->
        <BaseButton
          v-else
          size="sm"
          variant="ghost"
          class="mt-1 self-start"
          @click="startAddNew"
        >
          + 新增模板
        </BaseButton>
      </div>

      <!-- 右：字段编辑 -->
      <div class="flex flex-1 flex-col gap-2 overflow-auto">
        <div v-if="selectedEntry === null" class="flex h-full items-center justify-center text-xs text-gray-600">
          请从左侧选择一个 POI 模板
        </div>

        <template v-else>
          <div class="flex items-center justify-between border-b border-gray-800 pb-1">
            <span class="text-xs text-gray-400">
              编辑模板：<span class="text-gray-100">{{ selectedId }}</span>
            </span>
          </div>

          <!-- 按 group 分组渲染字段 -->
          <div
            v-for="group in groupedFields"
            :key="group.group"
            class="flex flex-col gap-2 rounded border border-gray-800 bg-gray-900 p-2"
          >
            <div class="text-[10px] uppercase tracking-wider text-gray-500">{{ group.group }}</div>
            <div class="grid grid-cols-1 gap-2">
              <SchemaField
                v-for="field in group.fields"
                :key="field.key"
                :schema="fieldsByKey[field.key]!"
                :model-value="(selectedEntry as unknown as Record<string, unknown>)[field.key]"
                @update:model-value="(v) => onFieldUpdate(field.key, v)"
              />
            </div>
          </div>

          <!-- 提示文案 -->
          <div class="mt-1 border-t border-gray-800 pt-2 text-[10px] text-gray-600">
            字段大部分可选——landmark / forge_anvil_poi 等仅含部分字段；mechanic_params 是 JSON 字符串字段
          </div>
        </template>
      </div>
    </template>
  </div>
</template>
