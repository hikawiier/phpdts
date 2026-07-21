<script setup lang="ts">
//
// ScatterPoolEditor：scatter_pool 编辑器（对齐 NEW_DESIGN.md §3.4.1 + §3.4.5 schema 驱动 UI）
//
// 研判：
//   - scatter_pool 是配置编辑框架的核心子模块
//   - 复用 SchemaField / BaseButton / BaseInput / BaseSelect
//   - item_id 外部引用存在性校验由 validateStore 负责
//
// 设计意图（对齐 2.6 配置驱动 + 2.15 视觉）：
//   - 三 tide Tab（shallow/deep/abyss）+ 每 Tab 下 initial/refresh 双列表
//   - 每条 entry 用 SchemaField 按 SCATTER_POOL_ENTRY_SCHEMA 渲染
//   - 增删改查 + vuedraggable 拖拽排序
//   - rate 是"基础率"，不与运行时倍率预先折算——schema.description 提示
//   - 视觉对齐 2.15：错误用 accent-error，正常态全用灰阶
//
// 数据流：
//   - 读：config.scatterPool[tide][phase] → vuedraggable :list
//   - 写（CRUD）：addScatterEntry / updateScatterEntry / removeScatterEntry
//   - 写（拖拽）：vuedraggable :list 直接 mutate 数组 + @end 设置 isDirty
//   - 单一数据源：configStore.scatterPool（无本地副本）

import { ref, computed } from 'vue';
import draggable from 'vuedraggable';
import { useConfigStore, type ScatterPhase } from '@/stores/configStore';
import {
  SCATTER_POOL_ENTRY_SCHEMA,
  SCATTER_POOL_TIDES,
  SCATTER_POOL_PHASES,
  TIDE_SCHEMA_OPTIONS,
  SCATTER_PHASE_OPTIONS,
  type FieldSchema,
} from '@/shared';
import type { Tide, ScatterPoolEntry } from '@/shared';
import SchemaField from './SchemaField.vue';
import BaseButton from '@/components/common/BaseButton.vue';

const config = useConfigStore();

// ─── Tab 状态：tide + phase ─────────────────────────────
const currentTide = ref<Tide>('shallow');
const currentPhase = ref<ScatterPhase>('initial');

const tideOptions = TIDE_SCHEMA_OPTIONS;
const phaseOptions = SCATTER_PHASE_OPTIONS;

// ─── 当前选中列表的响应式引用（直接指向 store 的数组） ──
const currentList = computed<ScatterPoolEntry[]>(() => {
  if (!config.scatterPool) return [];
  return config.scatterPool[currentTide.value][currentPhase.value];
});

const hasData = computed(() => config.scatterPool !== null);

// ─── schema 字段映射（按 key 索引） ─────────────────────
const fieldsByKey = computed<Record<string, FieldSchema>>(() => {
  const map: Record<string, FieldSchema> = {};
  for (const field of SCATTER_POOL_ENTRY_SCHEMA.fields) {
    map[field.key] = field;
  }
  return map;
});

// ─── CRUD 操作 ─────────────────────────────────────────

/**
 * 创建默认 entry（基于 schema.default 字段填充）
 */
function makeDefaultEntry(): ScatterPoolEntry {
  const entry: Record<string, unknown> = {};
  for (const field of SCATTER_POOL_ENTRY_SCHEMA.fields) {
    if (field.default !== undefined) {
      entry[field.key] = field.default;
    }
  }
  return entry as unknown as ScatterPoolEntry;
}

function addEntry(): void {
  config.addScatterEntry(currentTide.value, currentPhase.value, makeDefaultEntry());
}

function removeEntry(index: number): void {
  config.removeScatterEntry(currentTide.value, currentPhase.value, index);
}

/**
 * 字段更新回调：把 SchemaField 的 patch 合并到指定 entry
 *
 * 对于 count-range 字段，modelValue 可能是 number | [number, number]
 */
function onFieldUpdate(index: number, key: string, value: unknown): void {
  config.updateScatterEntry(currentTide.value, currentPhase.value, index, { [key]: value } as Partial<ScatterPoolEntry>);
}

// ─── 拖拽排序 ──────────────────────────────────────────

/**
 * vuedraggable @end 回调：拖拽完成后标记 dirty
 *
 * :list 绑定会让 vuedraggable 直接 mutate store 的数组（Pinia 响应式支持），
 * 此处仅需设置 isDirty 标志
 */
function onDragEnd(): void {
  // Pinia state 是可写的 ref，直接设置 isDirty
  config.isDirty = true;
}

// ─── UI 辅助 ───────────────────────────────────────────
function tideLabel(tide: Tide): string {
  return tideOptions.find((o) => o.value === tide)?.label ?? tide;
}

function phaseLabel(phase: ScatterPhase): string {
  return phaseOptions.find((o) => o.value === phase)?.label ?? phase;
}

// 拖拽 handle 文本（避免 vuedraggable 内部对 handle 选择器的解析问题，使用显式 class）
const dragHandleClass = 'scatter-drag-handle';
</script>

<template>
  <div class="flex h-full flex-col gap-2 overflow-auto p-2 text-sm">
    <!-- 未加载状态 -->
    <div v-if="!hasData" class="flex h-full items-center justify-center text-xs text-gray-600">
      请先加载 scatter_pool.php
    </div>

    <template v-else>
      <!-- Tide 三档 Tab -->
      <div class="flex border-b border-gray-800">
        <button
          v-for="tide in SCATTER_POOL_TIDES"
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

      <!-- Phase 双列表 Tab（initial / refresh） -->
      <div class="flex gap-1">
        <button
          v-for="phase in SCATTER_POOL_PHASES"
          :key="phase"
          type="button"
          class="rounded px-2 py-0.5 text-xs transition-colors"
          :class="
            currentPhase === phase
              ? 'bg-gray-700 text-gray-100'
              : 'bg-gray-900 text-gray-500 hover:text-gray-300'
          "
          @click="currentPhase = phase"
        >
          {{ phaseLabel(phase) }}
        </button>
      </div>

      <!-- 列表区 -->
      <div class="flex flex-col gap-1">
        <draggable
          :list="currentList"
          :item-key="(_entry: ScatterPoolEntry, index: number) => `${currentTide}-${currentPhase}-${index}`"
          handle=".scatter-drag-handle"
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
                  v-for="field in SCATTER_POOL_ENTRY_SCHEMA.fields"
                  :key="field.key"
                  :schema="fieldsByKey[field.key]!"
                  :model-value="(element as unknown as Record<string, unknown>)[field.key]"
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
          无 {{ tideLabel(currentTide) }} / {{ phaseLabel(currentPhase) }} 条目
        </div>

        <!-- 新增按钮 -->
        <BaseButton size="sm" variant="ghost" class="mt-1 self-start" @click="addEntry">
          + 新增条目
        </BaseButton>
      </div>

      <!-- 提示文案 -->
      <div class="mt-2 border-t border-gray-800 pt-2 text-[10px] text-gray-600">
        rate 是"基础率"，不与运行时倍率预先折算——倍率由后端 wild_item_refresh_rate_by_tide 应用
      </div>
    </template>
  </div>
</template>
