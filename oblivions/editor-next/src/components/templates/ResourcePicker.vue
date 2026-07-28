<!-- @module O 内容工具箱 -->
<script setup lang="ts">
//
// ResourcePicker：引用字段资源选择器（P2 §4.5.4）
//
// 设计意图：
//   - 引用字段（如 recipe.materials[].item_id / item.use_effect）编辑时不让开发者
//     手输未知 ID，而是通过选择器从 graph 中按 refKind 过滤候选项
//   - 模态框显示候选资源列表，支持搜索（按 ID 或 name 字段）
//   - 选中后 emit select 事件，父组件更新字段值
//   - 仍允许直接粘贴 ID（输入框模式），失焦时由 O-10 第 3 层引用校验兜底
//
// 复用约束（P2 §4.5.4）：
//   - 按 refKind 自动过滤候选项
//   - 引用字段必须通过 refField 校验（默认 'id'）
//   - refField 为 'tags' / 'itmk' 等非 id 字段时，候选项按字段值去重
//

import { ref, computed, watch } from 'vue';
import { useGraphStore } from '@/graph/graph-store';
import { getKindSchema } from '@/schema/registry';
import BaseModal from '@/components/common/BaseModal.vue';
import BaseInput from '@/components/common/BaseInput.vue';
import BaseButton from '@/components/common/BaseButton.vue';

const props = defineProps<{
  /** 模态框是否打开 */
  open: boolean;
  /** 引用目标资源 kind（如 'item.template' / 'effect.func'） */
  refKind: string;
  /** 引用目标字段名（默认 'id'） */
  refField?: string;
  /** 当前已选值（用于高亮显示） */
  current_value?: string;
  /** 模态框标题 */
  title?: string;
}>();

const emit = defineEmits<{
  close: [];
  select: [value: string];
}>();

const graph = useGraphStore();
const searchInput = ref('');

// 切换打开状态时清空搜索
watch(
  () => props.open,
  (open) => {
    if (open) searchInput.value = '';
  },
);

interface Candidate {
  /** 候选项值（refField 字段对应的值） */
  value: string;
  /** 显示标签（优先 name 字段，否则用 value） */
  label: string;
  /** 副标签（如 itmk / tier 等辅助信息） */
  sublabel?: string;
}

/**
 * 候选项列表——按 refKind 查询所有节点，按 refField 取值去重。
 *
 * refField === 'id' 时：每个节点是一个候选项
 * refField === 'tags' / 'itmk' 时：按字段值去重（一个值对应多个节点合并）
 */
const candidates = computed<Candidate[]>(() => {
  if (!props.open) return [];
  const field = props.refField ?? 'id';
  const nodes = graph.findNodesByKind(props.refKind);
  const result: Candidate[] = [];
  const seenValues = new Set<string>();

  for (const node of nodes) {
    const data = node.data as Record<string, unknown>;
    if (field === 'id') {
      // id 引用——每个节点直接是一个候选项
      const name = typeof data['name'] === 'string' ? data['name'] : '';
      result.push({
        value: node.id,
        label: name || node.id,
        sublabel: name ? node.id : undefined,
      });
    } else if (field === 'tags') {
      // tags 引用——按 tag 值去重
      const tags = Array.isArray(data['tags']) ? (data['tags'] as unknown[]) : [];
      for (const tag of tags) {
        if (typeof tag !== 'string') continue;
        if (seenValues.has(tag)) continue;
        seenValues.add(tag);
        result.push({ value: tag, label: tag });
      }
    } else if (field === 'itmk') {
      // itmk 引用——按 itmk 值去重
      const itmk = typeof data['itmk'] === 'string' ? data['itmk'] : '';
      if (!itmk || seenValues.has(itmk)) continue;
      seenValues.add(itmk);
      // itmk 中文标签从 schema options 查询
      const label = lookupItmkLabel(itmk);
      result.push({ value: itmk, label: `${label} (${itmk})` });
    } else if (field === 'name') {
      // effect.func 按 name 字段引用——node.id 与 name 一致
      const name = typeof data['name'] === 'string' ? data['name'] : node.id;
      result.push({ value: name, label: name });
    } else {
      // 通用：按字段值去重
      const val = data[field];
      if (typeof val === 'string' && !seenValues.has(val)) {
        seenValues.add(val);
        result.push({ value: val, label: val });
      }
    }
  }
  // 按 label 字母序排序（保证展示稳定）
  result.sort((a, b) => a.label.localeCompare(b.label));
  return result;
});

/**
 * 从 item.template schema 查询 itmk 中文标签。
 */
function lookupItmkLabel(itmk: string): string {
  const schema = getKindSchema('item.template');
  if (!schema) return itmk;
  for (const field of schema.fields) {
    if (field.key === 'itmk' && field.options) {
      for (const opt of field.options) {
        if (opt.value === itmk) return opt.label;
      }
    }
  }
  return itmk;
}

/**
 * 过滤候选项——按搜索词匹配 value 或 label。
 */
const filteredCandidates = computed<Candidate[]>(() => {
  const q = searchInput.value.trim().toLowerCase();
  if (!q) return candidates.value;
  return candidates.value.filter(
    (c) =>
      c.value.toLowerCase().includes(q) ||
      c.label.toLowerCase().includes(q) ||
      (c.sublabel ?? '').toLowerCase().includes(q),
  );
});

function onSelect(value: string): void {
  emit('select', value);
  emit('close');
}

function onClose(): void {
  emit('close');
}
</script>

<template>
  <BaseModal :open="open" :title="title ?? '选择资源'" @close="onClose">
    <div class="flex flex-col gap-2">
      <!-- 搜索框 -->
      <BaseInput
        :model-value="searchInput"
        placeholder="按 ID 或名称搜索…"
        @update:model-value="(v) => (searchInput = v)"
      />

      <!-- 候选列表 -->
      <div class="max-h-[50vh] overflow-auto rounded border border-gray-800 bg-gray-900">
        <div v-if="filteredCandidates.length === 0" class="p-3 text-xs text-gray-600">
          无候选项
        </div>
        <button
          v-for="c in filteredCandidates"
          :key="c.value"
          type="button"
          class="flex w-full flex-col items-start gap-0.5 border-b border-gray-800 px-3 py-1.5 text-left text-xs transition-colors last:border-b-0 hover:bg-gray-800"
          :class="c.value === current_value ? 'bg-gray-700 text-gray-100' : 'text-gray-300'"
          @click="onSelect(c.value)"
        >
          <span class="font-medium">{{ c.label }}</span>
          <span v-if="c.sublabel" class="text-[10px] text-gray-500">{{ c.sublabel }}</span>
        </button>
      </div>

      <!-- 候选统计 -->
      <div class="flex items-center justify-between text-[10px] text-gray-600">
        <span>{{ filteredCandidates.length }} / {{ candidates.length }} 个候选项</span>
        <span>refKind: {{ refKind }} · refField: {{ refField ?? 'id' }}</span>
      </div>
    </div>

    <template #footer>
      <BaseButton variant="ghost" @click="onClose">取消</BaseButton>
    </template>
  </BaseModal>
</template>
