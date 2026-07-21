<script setup lang="ts">
//
// SchemaField：按 schema 渲染单个字段的通用控件（对齐 NEW_DESIGN.md §3.4.5 schema 驱动 UI）
//
// 设计意图（对齐 2.6 配置驱动 + §3.4.5）：
//   - 表单组件按 schema 自动渲染控件，新增字段只需更新 schema 无需修改组件
//   - 支持类型：text / number / boolean / select / json / count-range / string-list / kv-list / entry-list
//   - 视觉对齐 2.15：错误用唯一强调色（accent-error），正常态全用灰阶
//   - JSON 字段（mechanic_params 等）以文本框 + JSON.parse 校验，不强行结构化
//
// 研判：
//   - schema 驱动 UI 是配置编辑框架的核心契约
//   - 复用 BaseInput / BaseSelect / BaseCheckbox 通用控件
//
// 数据流：父组件传入 modelValue + schema，子组件 emit update:modelValue
// 对于 entry-list / kv-list / string-list，modelValue 是数组/对象，整体替换

import { computed, ref, watch } from 'vue';
import type { FieldSchema } from '@/shared';
import BaseInput from '@/components/common/BaseInput.vue';
import BaseSelect from '@/components/common/BaseSelect.vue';
import BaseCheckbox from '@/components/common/BaseCheckbox.vue';
import BaseButton from '@/components/common/BaseButton.vue';

const props = defineProps<{
  schema: FieldSchema;
  modelValue: unknown;
  /** select 类型的动态选项（覆盖 schema.options） */
  options?: ReadonlyArray<{ value: string; label: string }>;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: unknown];
}>();

// ─── 控件选项优先级：props.options > schema.options ──────
const effectiveOptions = computed(() => props.options ?? props.schema.options ?? []);

// ─── JSON 字段：文本框 + JSON.parse 校验 ─────────────────
const jsonText = ref('');
const jsonError = ref<string | null>(null);
const jsonPlaceholder = 'JSON 字符串，如 ["passive", "strategy"]';

// 同步外部 modelValue → jsonText（仅在 modelValue 变化时）
watch(
  () => props.modelValue,
  (val) => {
    if (props.schema.type === 'json') {
      const next = val === undefined || val === null ? '' : JSON.stringify(val, null, 2);
      // 避免循环更新：仅当文本不同时更新
      if (next !== jsonText.value) {
        jsonText.value = next;
        jsonError.value = null;
      }
    }
  },
  { immediate: true },
);

function onJsonInput(text: string): void {
  jsonText.value = text;
  if (text === '') {
    jsonError.value = null;
    emit('update:modelValue', undefined);
    return;
  }
  try {
    const parsed = JSON.parse(text);
    jsonError.value = null;
    emit('update:modelValue', parsed);
  } catch (e) {
    jsonError.value = e instanceof Error ? e.message : 'JSON 解析失败';
    // 不 emit 错误值，保留原 modelValue 不变
  }
}

// ─── count-range 字段：min/max 双数字输入 ─────────────────
const countIsRange = computed(() => Array.isArray(props.modelValue));
const countMin = computed(() => {
  const v = props.modelValue;
  if (Array.isArray(v)) return v[0] ?? 0;
  if (typeof v === 'number') return v;
  return 0;
});
const countMax = computed(() => {
  const v = props.modelValue;
  if (Array.isArray(v)) return v[1] ?? 0;
  if (typeof v === 'number') return v;
  return 0;
});

function onCountMin(value: string): void {
  const num = Number(value);
  if (Number.isNaN(num)) return;
  if (countIsRange.value) {
    emit('update:modelValue', [num, countMax.value]);
  } else {
    // 单值模式：直接覆盖
    emit('update:modelValue', num);
  }
}
function onCountMax(value: string): void {
  const num = Number(value);
  if (Number.isNaN(num)) return;
  if (countIsRange.value) {
    emit('update:modelValue', [countMin.value, num]);
  } else {
    // 单值模式：max !== min 时切到 range
    if (num !== countMin.value) {
      emit('update:modelValue', [countMin.value, num]);
    }
  }
}
function toggleCountMode(isRange: boolean): void {
  if (isRange) {
    emit('update:modelValue', [countMin.value, countMax.value]);
  } else {
    emit('update:modelValue', countMin.value);
  }
}

// ─── string-list 字段：增删改 ───────────────────────────
const stringList = computed<string[]>(() => {
  return Array.isArray(props.modelValue) ? (props.modelValue as unknown[]).filter((v): v is string => typeof v === 'string') : [];
});
function onStringListItem(index: number, value: string): void {
  const next = [...stringList.value];
  next[index] = value;
  emit('update:modelValue', next);
}
function addStringListItem(): void {
  emit('update:modelValue', [...stringList.value, '']);
}
function removeStringListItem(index: number): void {
  const next = [...stringList.value];
  next.splice(index, 1);
  emit('update:modelValue', next);
}

// ─── kv-list 字段：键值对映射 ───────────────────────────
const kvEntries = computed<Array<{ key: string; value: string }>>(() => {
  const v = props.modelValue;
  if (!v || typeof v !== 'object' || Array.isArray(v)) return [];
  return Object.entries(v as Record<string, unknown>).map(([k, val]) => ({
    key: k,
    value: typeof val === 'string' ? val : String(val),
  }));
});
function onKvKey(index: number, newKey: string): void {
  const entries = [...kvEntries.value];
  entries[index] = { ...entries[index]!, key: newKey };
  const obj: Record<string, string> = {};
  for (const e of entries) obj[e.key] = e.value;
  emit('update:modelValue', obj);
}
function onKvValue(index: number, newValue: string): void {
  const entries = [...kvEntries.value];
  entries[index] = { ...entries[index]!, value: newValue };
  const obj: Record<string, string> = {};
  for (const e of entries) obj[e.key] = e.value;
  emit('update:modelValue', obj);
}
function addKvEntry(): void {
  const obj: Record<string, string> = {};
  for (const e of kvEntries.value) obj[e.key] = e.value;
  obj[''] = '';
  emit('update:modelValue', obj);
}
function removeKvEntry(index: number): void {
  const entries = [...kvEntries.value];
  entries.splice(index, 1);
  const obj: Record<string, string> = {};
  for (const e of entries) obj[e.key] = e.value;
  emit('update:modelValue', obj);
}

// ─── entry-list 字段：结构化条目数组 ─────────────────────
const entryList = computed<unknown[]>(() => {
  return Array.isArray(props.modelValue) ? (props.modelValue as unknown[]) : [];
});

function updateEntryItem(index: number, item: unknown): void {
  const next = [...entryList.value];
  next[index] = item;
  emit('update:modelValue', next);
}
function removeEntryItem(index: number): void {
  const next = [...entryList.value];
  next.splice(index, 1);
  emit('update:modelValue', next);
}

/**
 * 根据 sub-schema 创建新条目（默认值填充）
 */
function makeDefaultEntry(itemSchema: FieldSchema[] | undefined): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  if (!itemSchema) return obj;
  for (const field of itemSchema) {
    if (field.default !== undefined) {
      obj[field.key] = field.default;
    } else if (field.type === 'boolean') {
      obj[field.key] = false;
    } else if (field.type === 'number') {
      obj[field.key] = 0;
    } else if (field.type === 'text' || field.type === 'json') {
      obj[field.key] = '';
    } else if (field.type === 'string-list' || field.type === 'entry-list') {
      obj[field.key] = [];
    } else if (field.type === 'kv-list') {
      obj[field.key] = {};
    }
  }
  return obj;
}

function addEntryItem(): void {
  const newItem = makeDefaultEntry(props.schema.itemSchema);
  emit('update:modelValue', [...entryList.value, newItem]);
}

// ─── 基础类型 emit 包装 ─────────────────────────────────
function onText(value: string): void {
  emit('update:modelValue', value);
}
function onNumber(value: string): void {
  const num = Number(value);
  if (!Number.isNaN(num)) emit('update:modelValue', num);
}
function onBoolean(value: boolean): void {
  emit('update:modelValue', value);
}
function onSelect(value: string): void {
  emit('update:modelValue', value);
}
</script>

<template>
  <div class="flex flex-col gap-1">
    <label class="flex items-center gap-1 text-xs text-gray-400">
      <span>{{ schema.label }}</span>
      <span v-if="schema.required" class="text-accent-error">*</span>
    </label>

    <!-- text -->
    <BaseInput
      v-if="schema.type === 'text'"
      :model-value="(modelValue as string) ?? ''"
      :placeholder="schema.placeholder"
      @update:model-value="onText"
    />

    <!-- number -->
    <BaseInput
      v-else-if="schema.type === 'number'"
      :model-value="(modelValue as number) ?? 0"
      type="number"
      :min="schema.min"
      :max="schema.max"
      :step="schema.step"
      @update:model-value="onNumber"
    />

    <!-- boolean -->
    <BaseCheckbox
      v-else-if="schema.type === 'boolean'"
      :model-value="(modelValue as boolean) ?? false"
      @update:model-value="onBoolean"
    />

    <!-- select -->
    <BaseSelect
      v-else-if="schema.type === 'select'"
      :model-value="(modelValue as string) ?? ''"
      :options="effectiveOptions"
      :placeholder="schema.placeholder"
      @change="onSelect"
    />

    <!-- json -->
    <div v-else-if="schema.type === 'json'" class="flex flex-col gap-1">
      <textarea
        :value="jsonText"
        rows="3"
        class="w-full rounded border bg-gray-900 px-2 py-1 font-mono text-xs text-gray-100 placeholder-gray-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gray-400"
        :class="jsonError ? 'border-accent-error' : 'border-gray-700'"
        :placeholder="jsonPlaceholder"
        @input="(e) => onJsonInput((e.target as HTMLTextAreaElement).value)"
      />
      <span v-if="jsonError" class="text-[10px] text-accent-error">JSON 错误：{{ jsonError }}</span>
    </div>

    <!-- count-range -->
    <div v-else-if="schema.type === 'count-range'" class="flex items-center gap-2">
      <BaseCheckbox
        :model-value="countIsRange"
        label="范围"
        @update:model-value="(v) => toggleCountMode(v)"
      />
      <BaseInput
        :model-value="countMin"
        type="number"
        :min="schema.min"
        placeholder="min"
        class="flex-1"
        @update:model-value="onCountMin"
      />
      <span v-if="countIsRange" class="text-xs text-gray-500">~</span>
      <BaseInput
        v-if="countIsRange"
        :model-value="countMax"
        type="number"
        :min="schema.min"
        placeholder="max"
        class="flex-1"
        @update:model-value="onCountMax"
      />
    </div>

    <!-- string-list -->
    <div v-else-if="schema.type === 'string-list'" class="flex flex-col gap-1">
      <div
        v-for="(item, idx) in stringList"
        :key="idx"
        class="flex items-center gap-1"
      >
        <BaseInput
          :model-value="item"
          placeholder="字符串"
          class="flex-1"
          @update:model-value="(v) => onStringListItem(idx, v)"
        />
        <BaseButton size="sm" variant="ghost" @click="removeStringListItem(idx)">×</BaseButton>
      </div>
      <BaseButton size="sm" variant="ghost" @click="addStringListItem">+ 添加</BaseButton>
    </div>

    <!-- kv-list -->
    <div v-else-if="schema.type === 'kv-list'" class="flex flex-col gap-1">
      <div
        v-for="(entry, idx) in kvEntries"
        :key="idx"
        class="flex items-center gap-1"
      >
        <BaseInput
          :model-value="entry.key"
          :placeholder="schema.keyPlaceholder ?? 'key'"
          class="flex-1"
          @update:model-value="(v) => onKvKey(idx, v)"
        />
        <span class="text-xs text-gray-500">→</span>
        <BaseInput
          :model-value="entry.value"
          :placeholder="schema.valuePlaceholder ?? 'value'"
          class="flex-1"
          @update:model-value="(v) => onKvValue(idx, v)"
        />
        <BaseButton size="sm" variant="ghost" @click="removeKvEntry(idx)">×</BaseButton>
      </div>
      <BaseButton size="sm" variant="ghost" @click="addKvEntry">+ 添加</BaseButton>
    </div>

    <!-- entry-list -->
    <div v-else-if="schema.type === 'entry-list'" class="flex flex-col gap-2">
      <div
        v-for="(item, idx) in entryList"
        :key="idx"
        class="rounded border border-gray-800 bg-gray-900 p-2"
      >
        <div class="mb-1 flex items-center justify-between">
          <span class="text-[10px] text-gray-500">#{{ idx + 1 }}</span>
          <BaseButton size="sm" variant="ghost" @click="removeEntryItem(idx)">×</BaseButton>
        </div>
        <div class="flex flex-col gap-1">
          <SchemaField
            v-for="field in schema.itemSchema"
            :key="field.key"
            :schema="field"
            :model-value="(item as Record<string, unknown>)?.[field.key]"
            @update:model-value="(v) => updateEntryItem(idx, { ...(item as Record<string, unknown>), [field.key]: v })"
          />
        </div>
      </div>
      <BaseButton size="sm" variant="ghost" @click="addEntryItem">+ 添加</BaseButton>
    </div>

    <!-- 描述 -->
    <span v-if="schema.description" class="text-[10px] text-gray-600">{{ schema.description }}</span>
  </div>
</template>
