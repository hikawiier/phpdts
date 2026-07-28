<!-- @module O 内容工具箱 -->
<!-- @framework O-9 呈现工作区 -->
<script setup lang="ts">
//
// PresentationList：呈现工作区中栏列表（P3 §4.6.1 + §4.6.2）
//
// 与 TemplateList 的差异：
//   - POI kind 显示分类标签列（派生自关联 poi.template 的字段，对齐 §4.6.2）
//   - 不显示引用数 / 错误数列——呈现是图叶子，引用数恒为 1（renders_as 反向）
//     且 O-10 issue 索引在 P3+ 才接入
//   - 不支持删除——呈现节点由"删除关联 template 时同步删除"契约保护，
//     单独删除呈现会导致 poi.template 变成无中文孤儿（O-10 第 6 层报 missing）
//
// 列布局：
//   POI kind：ID | 中文名 | 分类标签
//   其他 kind：ID | 中文名 | 描述（截断）
//
// 分类标签派生（对齐 PresentationDetail.vue 同名逻辑）：
//   - 可搜刮：searchable=true
//   - 机制型：mechanic 非空
//   - 工作台：mechanic=craft_source
//   - 可拆除：dismantle_returns 非空
//   - 可重复：repeatable=true
//

import { ref, computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useGraphStore } from '@/graph/graph-store';
import type { ResourceNode } from '@/graph/types';
import BaseInput from '@/components/common/BaseInput.vue';

const props = defineProps<{
  /** 当前 kind（presentation.poi / presentation.item / presentation.recipe） */
  kind: string;
  /** 当前选中节点 ID 列表（双向绑定，仅 ID 不含 kind 前缀） */
  selectedIds: string[];
}>();

const emit = defineEmits<{
  'update:selectedIds': [ids: string[]];
}>();

const { t } = useI18n();
const graph = useGraphStore();

const searchInput = ref('');
const debouncedSearch = ref('');

// debounce 200ms
let searchTimer: ReturnType<typeof setTimeout> | null = null;
watch(searchInput, (val) => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    debouncedSearch.value = val;
  }, 200);
});

// 切换 kind 时重置搜索 + 选择
watch(
  () => props.kind,
  () => {
    searchInput.value = '';
    debouncedSearch.value = '';
    emit('update:selectedIds', []);
  },
);

/**
 * 是否为 POI kind——需要显示分类标签列。
 */
const isPoiKind = computed(() => props.kind === 'presentation.poi');

/**
 * 当前 kind 的所有节点——按 ID 升序，保证确定性。
 */
const allNodes = computed<ResourceNode[]>(() => graph.findNodesByKind(props.kind));

interface PoiTemplateData {
  name?: string;
  desc?: string;
  searchable?: boolean;
  repeatable?: boolean;
  mechanic?: string;
  dismantle_returns?: Array<{ item_id: string; count?: number }>;
  [key: string]: unknown;
}

interface CategoryTag {
  label: string;
  title: string;
}

/**
 * POI 分类标签派生——对齐 PresentationDetail.vue categoryTags 逻辑。
 *
 * 通过 inbound renders_as 边查找关联 poi.template 节点，从其字段派生 5 类标签。
 */
function deriveCategoryTags(nodeId: string): CategoryTag[] {
  const inbound = graph.getInbound(nodeId);
  const rendersAsEdge = inbound.find((e) => e.type === 'renders_as');
  if (!rendersAsEdge) return [];
  const templateNode = graph.nodes.get(rendersAsEdge.from);
  if (!templateNode) return [];
  const data = templateNode.data as PoiTemplateData;
  const tags: CategoryTag[] = [];
  if (data.searchable === true) {
    tags.push({ label: t('presentation.tagSearchable'), title: 'searchable=true · E-10 三档判定入口' });
  }
  if (typeof data.mechanic === 'string' && data.mechanic !== '') {
    tags.push({ label: t('presentation.tagMechanic'), title: `mechanic=${data.mechanic}` });
  }
  if (data.mechanic === 'craft_source') {
    tags.push({ label: t('presentation.tagWorkbench'), title: 'mechanic=craft_source · 提供合成能力' });
  }
  if (Array.isArray(data.dismantle_returns) && data.dismantle_returns.length > 0) {
    tags.push({ label: t('presentation.tagDismantable'), title: `dismantle_returns ×${data.dismantle_returns.length}` });
  }
  if (data.repeatable === true) {
    tags.push({ label: t('presentation.tagRepeatable'), title: 'repeatable=true · 重复搜索' });
  }
  return tags;
}

interface RowData {
  node: ResourceNode;
  id: string;
  name: string;
  desc: string;
  tags: CategoryTag[];
  isOrphan: boolean;
}

/**
 * 行数据——按 ID 升序，含 name / desc / 分类标签 / 孤儿状态。
 */
const rows = computed<RowData[]>(() => {
  const result: RowData[] = [];
  for (const node of allNodes.value) {
    const data = node.data as { name?: string; desc?: string };
    const nodeId = `${props.kind}:${node.id}`;
    const isOrphan = isPoiKind.value && graph.getInbound(nodeId).every((e) => e.type !== 'renders_as');
    result.push({
      node,
      id: node.id,
      name: typeof data.name === 'string' ? data.name : '',
      desc: typeof data.desc === 'string' ? data.desc : '',
      tags: isPoiKind.value ? deriveCategoryTags(nodeId) : [],
      isOrphan,
    });
  }
  // 按 ID 升序——执行案 §4.6.1 要求"按 ID 排序"
  result.sort((a, b) => a.id.localeCompare(b.id));
  return result;
});

/**
 * 过滤后行——按搜索词匹配 ID / 中文名 / 描述。
 */
const filteredRows = computed<RowData[]>(() => {
  const q = debouncedSearch.value.trim().toLowerCase();
  if (!q) return rows.value;
  return rows.value.filter((r) => {
    if (r.id.toLowerCase().includes(q)) return true;
    if (r.name.toLowerCase().includes(q)) return true;
    if (r.desc.toLowerCase().includes(q)) return true;
    return false;
  });
});

/**
 * 单击行——单选。
 *
 * 不支持 Ctrl/Cmd 多选——呈现工作区详情页一次只看一个节点；
 * 批量操作（如 drift quick fix）在 DriftReport 模态框内完成。
 */
function onRowClick(id: string): void {
  emit('update:selectedIds', [id]);
}
</script>

<template>
  <div class="flex h-full flex-col gap-2 overflow-hidden">
    <!-- 工具栏 -->
    <div class="flex items-center gap-2">
      <BaseInput
        :model-value="searchInput"
        :placeholder="t('presentation.searchPlaceholder')"
        class="flex-1"
        @update:model-value="(v) => (searchInput = v)"
      />
      <span class="shrink-0 text-[10px] text-gray-600">
        {{ filteredRows.length }} / {{ rows.length }}
      </span>
    </div>

    <!-- 列表 -->
    <div class="flex-1 overflow-auto rounded border border-gray-800 bg-gray-900">
      <table class="w-full border-collapse text-xs">
        <thead class="sticky top-0 z-10 bg-gray-800 text-gray-300">
          <tr>
            <th class="border-b border-gray-700 px-2 py-1 text-left font-medium" style="width: 160px; min-width: 160px;">
              {{ t('presentation.colId') }}
            </th>
            <th class="border-b border-gray-700 px-2 py-1 text-left font-medium" style="width: 180px; min-width: 180px;">
              {{ t('presentation.colName') }}
            </th>
            <th v-if="isPoiKind" class="border-b border-gray-700 px-2 py-1 text-left font-medium">
              {{ t('presentation.colTags') }}
            </th>
            <th v-else class="border-b border-gray-700 px-2 py-1 text-left font-medium">
              {{ t('presentation.colDesc') }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in filteredRows"
            :key="row.id"
            class="cursor-pointer border-b border-gray-800 transition-colors hover:bg-gray-800"
            :class="selectedIds.includes(row.id) ? 'bg-gray-700 text-gray-100' : 'text-gray-300'"
            @click="onRowClick(row.id)"
          >
            <td class="px-2 py-1 font-mono text-[11px]">
              <span class="flex items-center gap-1">
                <span
                  v-if="row.isOrphan"
                  class="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-accent-error"
                  :title="t('presentation.orphanHint')"
                ></span>
                <span class="truncate" :title="row.id">{{ row.id }}</span>
              </span>
            </td>
            <td class="px-2 py-1">
              <span class="block truncate" :title="row.name">{{ row.name || '—' }}</span>
            </td>
            <td v-if="isPoiKind" class="px-2 py-1">
              <div v-if="row.tags.length > 0" class="flex flex-wrap gap-1">
                <span
                  v-for="(tag, idx) in row.tags"
                  :key="idx"
                  :title="tag.title"
                  class="rounded border border-gray-700 bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-300"
                >
                  {{ tag.label }}
                </span>
              </div>
              <span v-else class="text-[10px] text-gray-600">—</span>
            </td>
            <td v-else class="px-2 py-1">
              <span class="block truncate text-gray-400" :title="row.desc">{{ row.desc || '—' }}</span>
            </td>
          </tr>
          <tr v-if="filteredRows.length === 0">
            <td :colspan="isPoiKind ? 3 : 3" class="px-3 py-4 text-center text-gray-600">
              {{ t('presentation.emptyRows') }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
