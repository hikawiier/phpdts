<script setup lang="ts">
//
// PoiPoolEditor：poi_pool 编辑器（对齐 NEW_DESIGN.md §3.4.3 + §3.4.5 schema 驱动 UI）
//
// 研判：
//   - poi_pool 是配置编辑框架的核心子模块
//   - 复用 SchemaField / BaseButton / draggable
//   - poi_id 联动下拉选项来自 configStore.poiIdOptions（依赖 poiTable 已加载）
//   - poi_id 外部引用存在性校验由 validateStore 负责
//
// 设计意图（对齐 2.6 配置驱动 + 2.15 视觉）：
//   - 三 tide Tab（shallow/deep/abyss），每 Tab 一个 poi_pool entry 列表
//   - 每条 entry：poi_id（select 联动下拉）+ per_region（number）
//   - 增删改查 + vuedraggable 拖拽排序
//   - poi_id 选项来自 config.poiIdOptions（getters 派生自 poiTable）
//   - 当 poiTable 未加载时，下拉为空但允许手动输入（外部引用校验由 O-3 负责）
//   - 视觉对齐 2.15：错误用 accent-error，正常态全用灰阶
//
// 数据流：
//   - 读：config.poiPool[tide] → vuedraggable :list
//   - 写（CRUD）：addPoiPoolEntry / updatePoiPoolEntry / removePoiPoolEntry
//   - 写（拖拽）：vuedraggable :list 直接 mutate 数组 + @end 设置 isDirty
//   - 联动：config.poiIdOptions（getter，派生自 poiTable）→ SchemaField options

import { ref, computed } from 'vue';
import draggable from 'vuedraggable';
import { useConfigStore } from '@/stores/configStore';
import {
  POI_POOL_ENTRY_SCHEMA,
  POI_POOL_TIDES,
  TIDE_SCHEMA_OPTIONS,
  type FieldSchema,
} from '@/shared';
import type { Tide, PoiPoolEntry } from '@/shared';
import SchemaField from './SchemaField.vue';
import BaseButton from '@/components/common/BaseButton.vue';

const config = useConfigStore();

// ─── Tab 状态：tide ─────────────────────────────────────
const currentTide = ref<Tide>('shallow');

const tideOptions = TIDE_SCHEMA_OPTIONS;

// ─── 当前选中列表的响应式引用（直接指向 store 的数组） ──
const currentList = computed<PoiPoolEntry[]>(() => {
  if (!config.poiPool) return [];
  return config.poiPool[currentTide.value];
});

const hasData = computed(() => config.poiPool !== null);

// ─── poi_id 联动下拉选项（来自 config.poiIdOptions getter） ──
const poiIdOptions = computed(() => config.poiIdOptions);

const hasPoiTable = computed(() => config.poiTable !== null);

// ─── schema 字段映射（按 key 索引） ─────────────────────
const fieldsByKey = computed<Record<string, FieldSchema>>(() => {
  const map: Record<string, FieldSchema> = {};
  for (const field of POI_POOL_ENTRY_SCHEMA.fields) {
    map[field.key] = field;
  }
  return map;
});

// ─── CRUD 操作 ─────────────────────────────────────────

/**
 * 创建默认 entry（基于 schema.default 字段填充）
 */
function makeDefaultEntry(): PoiPoolEntry {
  const entry: Record<string, unknown> = {};
  for (const field of POI_POOL_ENTRY_SCHEMA.fields) {
    if (field.default !== undefined) {
      entry[field.key] = field.default;
    }
  }
  return entry as unknown as PoiPoolEntry;
}

function addEntry(): void {
  config.addPoiPoolEntry(currentTide.value, makeDefaultEntry());
}

function removeEntry(index: number): void {
  config.removePoiPoolEntry(currentTide.value, index);
}

/**
 * 字段更新回调
 *
 * 对于 poi_id 字段，需要把 SchemaField options 透传过去（来自 config.poiIdOptions）
 */
function onFieldUpdate(index: number, key: string, value: unknown): void {
  config.updatePoiPoolEntry(currentTide.value, index, { [key]: value } as Partial<PoiPoolEntry>);
}

// ─── 拖拽排序 ──────────────────────────────────────────

/**
 * vuedraggable @end 回调：拖拽完成后标记 dirty
 */
function onDragEnd(): void {
  config.isDirty = true;
}

// ─── UI 辅助 ───────────────────────────────────────────
function tideLabel(tide: Tide): string {
  return tideOptions.find((o) => o.value === tide)?.label ?? tide;
}

const dragHandleClass = 'poi-pool-drag-handle';

/**
 * 判断字段是否需要动态 options（仅 poi_id 字段）
 */
function isPoiIdField(key: string): boolean {
  return key === 'poi_id';
}
</script>

<template>
  <div class="flex h-full flex-col gap-2 overflow-auto p-2 text-sm">
    <!-- 未加载状态 -->
    <div v-if="!hasData" class="flex h-full items-center justify-center text-xs text-gray-600">
      请先加载 poi_pool.php
    </div>

    <template v-else>
      <!-- Tide 三档 Tab -->
      <div class="flex border-b border-gray-800">
        <button
          v-for="tide in POI_POOL_TIDES"
          :key="tide"
          type="button"
          class="border-b-2 px-3 py-1 text-xs transition-colors"
          :class="
            currentTide === tide
              ? 'border-gray-400 text-gray-100'
              : 'border-transparent text-gray-500 hover:text-gray-300'
          "
          @click="currentTide = tide"
        >
          {{ tideLabel(tide) }}
        </button>
      </div>

      <!-- poi_table 未加载提示 -->
      <div
        v-if="!hasPoiTable"
        class="rounded border border-gray-800 bg-gray-900 px-2 py-1 text-[10px] text-gray-500"
      >
        提示：poi_table.php 未加载，poi_id 下拉为空——外部引用存在性校验由 O-3 验证工具负责
      </div>

      <!-- 列表区 -->
      <div class="flex flex-col gap-1">
        <draggable
          :list="currentList"
          :item-key="(_entry: PoiPoolEntry, index: number) => `${currentTide}-${index}`"
          handle=".poi-pool-drag-handle"
          ghost-class="opacity-30"
          :animation="150"
          @end="onDragEnd"
        >
          <template #item="{ element, index }">
            <div class="rounded border border-gray-800 bg-gray-900 p-2">
              <div class="mb-1 flex items-center justify-between">
                <div class="flex items-center gap-1">
                  <span
                    :class="dragHandleClass"
                    class="cursor-move select-none text-gray-600 hover:text-gray-400"
                    title="拖拽排序"
                  >
                    ⠿
                  </span>
                  <span class="text-[10px] text-gray-500">#{{ index + 1 }}</span>
                </div>
                <BaseButton size="sm" variant="ghost" title="删除" @click="removeEntry(index)">
                  ×
                </BaseButton>
              </div>
              <div class="grid grid-cols-1 gap-2">
                <SchemaField
                  v-for="field in POI_POOL_ENTRY_SCHEMA.fields"
                  :key="field.key"
                  :schema="fieldsByKey[field.key]!"
                  :model-value="(element as unknown as Record<string, unknown>)[field.key]"
                  :options="isPoiIdField(field.key) ? poiIdOptions : undefined"
                  @update:model-value="(v) => onFieldUpdate(index, field.key, v)"
                />
              </div>
            </div>
          </template>
        </draggable>

        <!-- 空列表提示 -->
        <div
          v-if="currentList.length === 0"
          class="rounded border border-dashed border-gray-800 p-3 text-center text-[10px] text-gray-600"
        >
          无 {{ tideLabel(currentTide) }} 模板条目
        </div>

        <!-- 新增按钮 -->
        <BaseButton size="sm" variant="ghost" class="mt-1 self-start" @click="addEntry">
          + 新增条目
        </BaseButton>
      </div>

      <!-- 提示文案 -->
      <div class="mt-2 border-t border-gray-800 pt-2 text-[10px] text-gray-600">
        poi_id 从 poi_table 模板列表中选择；per_region 是每区域生成数量
      </div>
    </template>
  </div>
</template>
