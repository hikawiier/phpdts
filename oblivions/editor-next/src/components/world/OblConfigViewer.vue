<!-- @module O 内容工具箱 -->
<script setup lang="ts">
//
// OblConfigViewer：通用键值对展示组件（对齐 P1 执行案 §4.10.5）
//
// 设计意图：
//   - 通用键值对展示，按字段类型分组（number / string / boolean / array / object）
//   - props.entries 接受任意 Record<string, unknown>（不仅限于 obl_config）
//   - 灰阶样式，对齐 2.15
//
// 边界：
//   - 字段顺序按 entries 的插入顺序（PHP 解析后保留原文件顺序）
//   - 未知字段也展示，但顶部提示 "未知字段" 数量
//   - 嵌套 object / array 用 <pre> + JSON 格式化展示
import { computed } from 'vue';

interface FieldEntry {
  key: string;
  value: unknown;
  type: 'number' | 'string' | 'boolean' | 'array' | 'object' | 'null';
  json: string;
}

type FieldType = FieldEntry['type'];

const props = defineProps<{
  /** 键值对 entries（value 类型不限） */
  entries: Record<string, unknown> | null;
  /** 已知字段名列表（用于"未知字段"提示，可选） */
  knownFields?: ReadonlyArray<string>;
}>();

function classifyType(value: unknown): FieldType {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'boolean') return 'boolean';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') return 'object';
  return 'null';
}

const sortedEntries = computed<FieldEntry[]>(() => {
  if (!props.entries) return [];
  return Object.entries(props.entries).map(([key, value]) => ({
    key,
    value,
    type: classifyType(value),
    json: JSON.stringify(value, null, 2),
  }));
});

const groupedByType = computed<Record<FieldType, FieldEntry[]>>(() => {
  const groups: Record<FieldType, FieldEntry[]> = {
    number: [],
    string: [],
    boolean: [],
    array: [],
    object: [],
    null: [],
  };
  for (const entry of sortedEntries.value) {
    groups[entry.type].push(entry);
  }
  return groups;
});

const unknownFieldCount = computed(() => {
  if (!props.knownFields || !props.entries) return 0;
  const known = new Set(props.knownFields);
  return Object.keys(props.entries).filter((k) => !known.has(k)).length;
});

const groupOrder: ReadonlyArray<FieldType> = ['number', 'string', 'boolean', 'array', 'object'];

const groupLabels: Record<FieldType, string> = {
  number: '数字字段',
  string: '字符串字段',
  boolean: '布尔字段',
  array: '数组字段',
  object: '对象字段',
  null: '空值字段',
};
</script>

<template>
  <div class="flex h-full flex-col gap-2 overflow-auto p-2 text-sm">
    <div v-if="!entries" class="flex flex-1 items-center justify-center text-xs text-gray-600">
      无数据（obl_config.php 未加载）
    </div>

    <template v-else>
      <!-- 未知字段提示 -->
      <div
        v-if="unknownFieldCount > 0"
        class="rounded border border-accent-error bg-gray-900 px-2 py-1 text-[10px] text-accent-error"
      >
        检测到 {{ unknownFieldCount }} 个未知字段（不在已知 23 项清单中）
      </div>

      <!-- 按类型分组展示 -->
      <details
        v-for="type in groupOrder"
        :key="type"
        v-show="groupedByType[type].length > 0"
        open
        class="rounded border border-gray-800 bg-gray-900"
      >
        <summary class="cursor-pointer px-2 py-1 text-xs text-gray-300 hover:bg-gray-800">
          {{ groupLabels[type] }}（{{ groupedByType[type].length }}）
        </summary>
        <div class="flex flex-col gap-1 p-2">
          <div
            v-for="entry in groupedByType[type]"
            :key="entry.key"
            class="rounded border border-gray-800 bg-gray-950 p-2"
          >
            <div class="mb-1 flex items-center justify-between">
              <span class="font-mono text-xs text-gray-300">{{ entry.key }}</span>
              <span class="text-[10px] text-gray-600">{{ entry.type }}</span>
            </div>
            <!-- 标量：直接展示 -->
            <div
              v-if="entry.type === 'number' || entry.type === 'string' || entry.type === 'boolean'"
              class="font-mono text-xs text-gray-200"
            >
              {{ entry.type === 'boolean' ? (entry.value ? 'true' : 'false') : entry.value }}
            </div>
            <!-- 复合类型：JSON 格式化展示 -->
            <pre
              v-else
              class="overflow-auto rounded bg-gray-900 p-1.5 text-[10px] text-gray-300"
              >{{ entry.json }}</pre
            >
          </div>
        </div>
      </details>
    </template>
  </div>
</template>
