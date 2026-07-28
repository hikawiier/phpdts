<!-- @module O 内容工具箱 -->
<!-- @framework O-7 模板工作区 -->
<script setup lang="ts">
//
// TemplateList：模板工作区中栏可搜索表格（P2 §4.5.2）
//
// 设计意图：
//   - schema 驱动列定义——每个 kind 的 listColumns 来自 schema.listColumns
//   - 全文搜索：ID / 中文名 / Tag / 引用目标，debounce 200ms
//   - 排序：所有列可点击排序，默认按 ID 字母序
//   - 单击选中，Ctrl/Cmd+点击多选，Shift+点击范围选择
//   - 引用数列：通过 graph-store getInbound + getOutbound 边总数派生
//   - 错误数列：P2 阶段暂显示 0（O-10 issue 索引在 P3+ 接入）
//
// 列布局：
//   ID | 中文名 | schema.listColumns 各列 | 引用数 | 错误数
//   - ID 始终显示
//   - 中文名：template kinds 从 renders_as 反向查询 presentation；presentation kinds 从 data.name 直接读
//   - 引用数：inbound + outbound 边总数（templates 含双向，presentation 仅 renders_as 反向）
//   - 错误数：P2 占位为 0
//

import { ref, computed, watch } from 'vue';
import { useGraphStore } from '@/graph/graph-store';
import { getKindSchema } from '@/schema/registry';
import type { ResourceNode } from '@/graph/types';
import type { ListColumnSpec, FieldSchemaSpec } from '@/schema/types';
import BaseInput from '@/components/common/BaseInput.vue';

const props = defineProps<{
  /** 当前 kind */
  kind: string;
  /** 当前选中节点 ID 列表（双向绑定） */
  selectedIds: string[];
}>();

const emit = defineEmits<{
  'update:selectedIds': [ids: string[]];
  /** 触发删除（带影响范围预览） */
  deleteRequest: [nodeId: string];
}>();

const graph = useGraphStore();
const searchInput = ref('');
const debouncedSearch = ref('');
const sortKey = ref<'id' | 'name' | string>('id');
const sortDir = ref<'asc' | 'desc'>('asc');

// debounce 200ms
let searchTimer: ReturnType<typeof setTimeout> | null = null;
watch(searchInput, (val) => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    debouncedSearch.value = val;
  }, 200);
});

// 切换 kind 时重置搜索 + 排序 + 选择
watch(
  () => props.kind,
  () => {
    searchInput.value = '';
    debouncedSearch.value = '';
    sortKey.value = 'id';
    sortDir.value = 'asc';
    emit('update:selectedIds', []);
  },
);

/**
 * schema 中的列定义——前置 ID 与 name 列，后置引用数与错误数列。
 */
const schema = computed(() => getKindSchema(props.kind));

/**
 * 是否为 presentation kind——name/desc 直接从 data 读取。
 */
const isPresentationKind = computed(() => props.kind.startsWith('presentation.'));

/**
 * 列定义——按 ID / 中文名 / schema.listColumns / 引用数 / 错误数 顺序拼接。
 */
interface ColumnDef {
  field: string;
  label: string;
  width: number;
  sortable: boolean;
}

const columns = computed<ColumnDef[]>(() => {
  const cols: ColumnDef[] = [
    { field: 'id', label: 'ID', width: 160, sortable: true },
    { field: 'name', label: '中文名', width: 160, sortable: true },
  ];
  const listCols = schema.value?.listColumns ?? [];
  for (const c of listCols) {
    cols.push({
      field: c.field,
      label: getColumnLabel(c, schema.value?.fields ?? []),
      width: c.width ?? 120,
      sortable: c.sortable ?? false,
    });
  }
  cols.push({ field: '__refCount', label: '引用数', width: 70, sortable: true });
  cols.push({ field: '__issueCount', label: '错误', width: 50, sortable: false });
  return cols;
});

/**
 * 从 schema.fields 查询字段中文 label；查不到时回退到 field 名。
 */
function getColumnLabel(col: ListColumnSpec, fields: FieldSchemaSpec[]): string {
  // 字段名可能是 'itmk' / 'tier' 等直接字段，从 schema.fields 查 label
  const fieldKey = col.field.split('.')[0]!;
  const field = fields.find((f) => f.key === fieldKey);
  return field?.label ?? col.field;
}

/**
 * 当前 kind 的所有节点——从 graph-store 查询。
 */
const allNodes = computed<ResourceNode[]>(() => graph.findNodesByKind(props.kind));

/**
 * presentation name 查找表——对 template kinds 通过 renders_as 边查询关联 presentation 节点的 name。
 *
 * renders_as 边方向：xxx.template → presentation.xxx（template 持有 outbound 边）。
 * P4 修复：原实现误用 getInbound（template 节点 inbound 中无 renders_as 边），
 * 改为 getOutbound 后 item.template / recipe.template / enemy.template 均能正确显示中文名。
 */
const presentationNameMap = computed<Map<string, string>>(() => {
  const map = new Map<string, string>();
  if (!isPresentationKind.value) {
    for (const node of allNodes.value) {
      const nodeId = `${props.kind}:${node.id}`;
      const outbound = graph.getOutbound(nodeId);
      const rendersAsEdge = outbound.find((e) => e.type === 'renders_as');
      if (rendersAsEdge) {
        const presentationNode = graph.nodes.get(rendersAsEdge.to);
        if (presentationNode) {
          const data = presentationNode.data as { name?: string };
          if (typeof data.name === 'string') map.set(node.id, data.name);
        }
      }
    }
  }
  return map;
});

/**
 * 行数据——每行包含 ID / 中文名 / schema 列值 / 引用数 / 错误数。
 */
interface RowData {
  node: ResourceNode;
  id: string;
  name: string;
  cells: Record<string, unknown>;
  refCount: number;
  issueCount: number;
}

const rows = computed<RowData[]>(() => {
  const result: RowData[] = [];
  for (const node of allNodes.value) {
    const data = node.data as Record<string, unknown>;
    const name = isPresentationKind.value
      ? typeof data['name'] === 'string'
        ? (data['name'] as string)
        : ''
      : presentationNameMap.value.get(node.id) ?? '';
    const nodeId = `${props.kind}:${node.id}`;
    const refCount = graph.getInbound(nodeId).length + graph.getOutbound(nodeId).length;
    result.push({
      node,
      id: node.id,
      name,
      cells: data,
      refCount,
      issueCount: 0, // P2 占位，O-10 issue 索引在 P3+ 接入
    });
  }
  return result;
});

/**
 * 过滤后行——按搜索词匹配 ID / 中文名 / Tag / 引用目标。
 */
const filteredRows = computed<RowData[]>(() => {
  const q = debouncedSearch.value.trim().toLowerCase();
  if (!q) return rows.value;
  return rows.value.filter((r) => {
    // ID
    if (r.id.toLowerCase().includes(q)) return true;
    // 中文名
    if (r.name.toLowerCase().includes(q)) return true;
    // Tag / 其他字段（文本类）
    for (const [key, val] of Object.entries(r.cells)) {
      if (key === 'name' || key === 'id') continue;
      if (typeof val === 'string' && val.toLowerCase().includes(q)) return true;
      if (Array.isArray(val)) {
        for (const item of val) {
          if (typeof item === 'string' && item.toLowerCase().includes(q)) return true;
          if (item && typeof item === 'object') {
            const s = JSON.stringify(item).toLowerCase();
            if (s.includes(q)) return true;
          }
        }
      }
    }
    return false;
  });
});

/**
 * 排序后行——按 sortKey + sortDir。
 */
const sortedRows = computed<RowData[]>(() => {
  const arr = [...filteredRows.value];
  const key = sortKey.value;
  const dir = sortDir.value === 'asc' ? 1 : -1;
  arr.sort((a, b) => {
    let av: unknown;
    let bv: unknown;
    if (key === 'id') {
      av = a.id;
      bv = b.id;
    } else if (key === 'name') {
      av = a.name;
      bv = b.name;
    } else if (key === '__refCount') {
      av = a.refCount;
      bv = b.refCount;
    } else if (key === '__issueCount') {
      av = a.issueCount;
      bv = b.issueCount;
    } else {
      av = a.cells[key];
      bv = b.cells[key];
    }
    // 统一为字符串比较
    const as = av === undefined || av === null ? '' : String(av);
    const bs = bv === undefined || bv === null ? '' : String(bv);
    // 数字优先
    const an = Number(as);
    const bn = Number(bs);
    if (!Number.isNaN(an) && !Number.isNaN(bn) && /^\d+(\.\d+)?$/.test(as) && /^\d+(\.\d+)?$/.test(bs)) {
      return (an - bn) * dir;
    }
    return as.localeCompare(bs) * dir;
  });
  return arr;
});

/**
 * 点击列头切换排序。
 */
function onSortClick(field: string, sortable: boolean): void {
  if (!sortable) return;
  if (sortKey.value === field) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc';
  } else {
    sortKey.value = field;
    sortDir.value = 'asc';
  }
}

/**
 * 行选择——支持 Ctrl/Cmd 多选 + Shift 范围选择。
 */
let lastSelectedId: string | null = null;

function onRowClick(event: MouseEvent, id: string): void {
  const current = [...props.selectedIds];
  if (event.ctrlKey || event.metaKey) {
    // Ctrl/Cmd+click：切换选中
    const idx = current.indexOf(id);
    if (idx >= 0) {
      current.splice(idx, 1);
    } else {
      current.push(id);
    }
    lastSelectedId = id;
    emit('update:selectedIds', current);
  } else if (event.shiftKey && lastSelectedId !== null) {
    // Shift+click：范围选择
    const ids = sortedRows.value.map((r) => r.id);
    const start = ids.indexOf(lastSelectedId);
    const end = ids.indexOf(id);
    if (start >= 0 && end >= 0) {
      const lo = Math.min(start, end);
      const hi = Math.max(start, end);
      const range = ids.slice(lo, hi + 1);
      // 合并到已选（不重复）
      const set = new Set([...current, ...range]);
      emit('update:selectedIds', Array.from(set));
    }
  } else {
    // 单选
    lastSelectedId = id;
    emit('update:selectedIds', [id]);
  }
}

/**
 * Ctrl+A 全选当前过滤结果。
 */
function onSelectAll(): void {
  emit('update:selectedIds', sortedRows.value.map((r) => r.id));
}

/**
 * 单元格显示——把字段值渲染为人类可读文本。
 */
function cellDisplay(row: RowData, field: string): string {
  if (field === '__refCount') return String(row.refCount);
  if (field === '__issueCount') return row.issueCount === 0 ? '' : String(row.issueCount);
  if (field === 'id') return row.id;
  if (field === 'name') return row.name;
  const val = row.cells[field];
  if (val === undefined || val === null) return '';
  if (Array.isArray(val)) {
    // tags 等数组字段：显示逗号分隔
    return val.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join(', ');
  }
  if (typeof val === 'object') return JSON.stringify(val);
  // select 字段：尝试从 schema 查询中文 label
  const fieldSchema = schema.value?.fields.find((f) => f.key === field);
  if (fieldSchema?.options) {
    for (const opt of fieldSchema.options) {
      if (opt.value === String(val)) return opt.label;
    }
  }
  return String(val);
}

/**
 * 触发删除请求——父组件展示删除保护模态框。
 */
function onDeleteClick(nodeId: string): void {
  emit('deleteRequest', `${props.kind}:${nodeId}`);
}
</script>

<template>
  <div class="flex h-full flex-col gap-2 overflow-hidden">
    <!-- 工具栏 -->
    <div class="flex items-center gap-2">
      <BaseInput
        :model-value="searchInput"
        placeholder="搜索 ID / 中文名 / Tag / 引用目标…"
        class="flex-1"
        @update:model-value="(v) => (searchInput = v)"
      />
      <span class="shrink-0 text-[10px] text-gray-600">
        {{ filteredRows.length }} / {{ rows.length }}
      </span>
      <button
        type="button"
        class="shrink-0 rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-300 hover:bg-gray-700"
        title="Ctrl+A 全选当前过滤结果"
        @click="onSelectAll"
      >
        全选
      </button>
    </div>

    <!-- 表格 -->
    <div class="flex-1 overflow-auto rounded border border-gray-800 bg-gray-900">
      <table class="w-full border-collapse text-xs">
        <thead class="sticky top-0 z-10 bg-gray-800 text-gray-300">
          <tr>
            <th
              v-for="col in columns"
              :key="col.field"
              class="border-b border-gray-700 px-2 py-1 text-left font-medium"
              :style="{ width: `${col.width}px`, minWidth: `${col.width}px` }"
              :class="col.sortable ? 'cursor-pointer hover:text-gray-100' : ''"
              @click="onSortClick(col.field, col.sortable)"
            >
              <span class="inline-flex items-center gap-0.5">
                {{ col.label }}
                <span v-if="sortKey === col.field" class="text-[8px]">
                  {{ sortDir === 'asc' ? '▲' : '▼' }}
                </span>
              </span>
            </th>
            <th class="w-8 border-b border-gray-700 px-1 py-1"></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in sortedRows"
            :key="row.id"
            class="cursor-pointer border-b border-gray-800 transition-colors hover:bg-gray-800"
            :class="selectedIds.includes(row.id) ? 'bg-gray-700 text-gray-100' : 'text-gray-300'"
            @click="(e) => onRowClick(e, row.id)"
          >
            <td
              v-for="col in columns"
              :key="col.field"
              class="px-2 py-1"
              :class="col.field === 'id' ? 'font-mono text-[11px]' : ''"
            >
              <span class="block truncate" :title="cellDisplay(row, col.field)">
                {{ cellDisplay(row, col.field) }}
              </span>
            </td>
            <td class="px-1 py-1 text-center">
              <button
                type="button"
                class="text-[10px] text-gray-600 hover:text-accent-error"
                title="删除"
                @click.stop="onDeleteClick(row.id)"
              >
                ×
              </button>
            </td>
          </tr>
          <tr v-if="sortedRows.length === 0">
            <td :colspan="columns.length + 1" class="px-3 py-4 text-center text-gray-600">
              无匹配资源
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
