<!-- @module O 内容工具箱 -->
<!-- @framework O-7 模板工作区 -->
<script setup lang="ts">
//
// TemplateDetail：右栏五段式详情检查器（P2 §4.5.3）
//
// 五段组织：
//   1. 定义：schema 驱动字段编辑，按 detailGroups 分组渲染
//   2. 分布：P2 占位（P3/P4 实现 POI/scatter/enemy 分布）
//   3. 呈现：通过 renders_as 边查询对应 presentation 节点，内嵌呈现编辑子组件
//   4. 引用：inbound（谁引用了我）+ outbound（我引用了谁）边列表，按边类型分组
//   5. 诊断：实时反映当前 Change Set 的轻量校验结果（P2 占位为 0，O-10 issue 索引在 P3+ 接入）
//
// 字段编辑流：
//   - SchemaField v-model 写入 → onFieldUpdate → useTemplateActions.upsertNode
//   - 重新计算 revision + 触发 O-10 light 校验调度（debounce 300ms）
//   - 同时标记该 kind 对应的源文件为受影响（BuildView 显示 diff 预览）
//

import { computed, ref, watch } from 'vue';
import { useGraphStore } from '@/graph/graph-store';
import { getKindSchema } from '@/schema/registry';
import { useTemplateActions } from '@/composables/useTemplateActions';
import { REVERSE_RELATIONSHIP_LABEL } from '@/graph/relationship-types';
import type { ResourceNode } from '@/graph/types';
import type { RelationshipEdge } from '@/graph/edge';
import type { RelationshipType } from '@/graph/relationship-types';
import type { FieldSchemaSpec, DetailGroupSpec } from '@/schema/types';
import type { FieldSchema } from '@/shared';
import SchemaField from '@/components/config-editors/SchemaField.vue';
import BaseButton from '@/components/common/BaseButton.vue';
import ResourcePicker from './ResourcePicker.vue';

const props = defineProps<{
  /** 当前选中节点 ID（${kind}:${id} 格式） */
  nodeId: string | null;
}>();

const emit = defineEmits<{
  /** 请求导航到另一节点（点击引用边时触发） */
  navigate: [nodeId: string];
}>();

const graph = useGraphStore();
const actions = useTemplateActions();

// ResourcePicker 状态
const pickerOpen = ref(false);
const pickerRefField = ref<{ fieldKey: string; refKind: string; refField?: string } | null>(null);

/**
 * 当前选中节点对象。
 */
const node = computed<ResourceNode | null>(() => {
  if (!props.nodeId) return null;
  return graph.nodes.get(props.nodeId) ?? null;
});

/**
 * 当前 kind schema。
 */
const schema = computed(() => (node.value ? getKindSchema(node.value.kind) : null));

/**
 * 是否为 template kind（含 renders_as 边）。
 */
const isTemplateKind = computed(() => node.value?.kind.endsWith('.template') ?? false);

/**
 * detailGroups——按 schema.detailGroups 顺序分组渲染字段。
 */
const detailGroups = computed<DetailGroupSpec[]>(() => schema.value?.detailGroups ?? []);

/**
 * 把 FieldSchemaSpec 转换为 FieldSchema（SchemaField 接受的类型）。
 *
 * FieldSchemaSpec 比 FieldSchema 多 visibleWhen / refKind / refField / presentation / deprecated
 * 等扩展字段，SchemaField 不使用这些，转换时剥离。
 */
function toFieldSchema(spec: FieldSchemaSpec): FieldSchema {
  return {
    key: spec.key,
    label: spec.label,
    type: spec.type,
    options: spec.options,
    required: spec.required,
    min: spec.min,
    max: spec.max,
    step: spec.step,
    placeholder: spec.placeholder,
    default: spec.default,
    group: spec.group,
    description: spec.description,
    itemSchema: spec.itemSchema?.map(toFieldSchema),
    itemType: spec.itemType,
    itemOptions: spec.itemOptions,
    valueType: spec.valueType,
    valueOptions: spec.valueOptions,
    keyPlaceholder: spec.keyPlaceholder,
    valuePlaceholder: spec.valuePlaceholder,
  };
}

/**
 * 按 detailGroup 分组字段。
 */
const groupedFields = computed<Array<{ group: DetailGroupSpec; fields: Array<{ spec: FieldSchemaSpec; schema: FieldSchema }> }>>(() => {
  if (!schema.value || !node.value) return [];
  const result: Array<{ group: DetailGroupSpec; fields: Array<{ spec: FieldSchemaSpec; schema: FieldSchema }> }> = [];
  for (const group of detailGroups.value) {
    const fields: Array<{ spec: FieldSchemaSpec; schema: FieldSchema }> = [];
    for (const fieldKey of group.fields) {
      const spec = schema.value.fields.find((f) => f.key === fieldKey);
      if (!spec) continue;
      // visibleWhen 条件可见性
      if (!isVisible(spec)) continue;
      fields.push({ spec, schema: toFieldSchema(spec) });
    }
    if (fields.length > 0) {
      result.push({ group, fields });
    }
  }
  return result;
});

/**
 * 评估 visibleWhen 条件——简单表达式解析（如 `use_effect === 'place_poi'`）。
 *
 * P2 阶段仅支持 `field === 'value'` 形式；其他表达式一律返回 true。
 */
function isVisible(spec: FieldSchemaSpec): boolean {
  if (!spec.visibleWhen) return true;
  if (!node.value) return true;
  const data = node.value.data as Record<string, unknown>;
  // 简单解析：field === 'value' 形式
  const match = spec.visibleWhen.match(/^(\w+)\s*===?\s*'([^']*)'$/);
  if (match) {
    const fieldKey = match[1]!;
    const expected = match[2]!;
    const actual = data[fieldKey];
    return String(actual ?? '') === expected;
  }
  // 不支持的表达式一律显示
  return true;
}

/**
 * 字段更新——SchemaField v-model 写入触发。
 *
 * 把字段值合并到 node.data，调用 upsertNode 更新 graph-store。
 */
function onFieldUpdate(fieldKey: string, value: unknown): void {
  if (!node.value) return;
  const newData = { ...(node.value.data as Record<string, unknown>), [fieldKey]: value };
  actions.upsertNode({
    kind: node.value.kind,
    id: node.value.id,
    data: newData,
    source: node.value.source,
    revision: '',
  });
}

/**
 * 打开 ResourcePicker——为引用字段选择目标。
 */
function openPicker(spec: FieldSchemaSpec): void {
  if (!spec.refKind) return;
  pickerRefField.value = { fieldKey: spec.key, refKind: spec.refKind, refField: spec.refField };
  pickerOpen.value = true;
}

/**
 * ResourcePicker 选中回调。
 */
function onPickerSelect(value: string): void {
  if (pickerRefField.value) {
    onFieldUpdate(pickerRefField.value.fieldKey, value);
  }
  pickerRefField.value = null;
}

// ─── 呈现段（renders_as 关联）──────────────────────────────

/**
 * renders_as 关联的 presentation 节点。
 *
 * 对 template kind：通过 outbound renders_as 边查询
 * 对 presentation kind：通过 inbound renders_as 边查询
 */
const presentationNode = computed<ResourceNode | null>(() => {
  if (!node.value) return null;
  const nodeId = props.nodeId!;
  if (isTemplateKind.value) {
    const edges = graph.getOutbound(nodeId).filter((e) => e.type === 'renders_as');
    if (edges.length === 0) return null;
    return graph.nodes.get(edges[0]!.to) ?? null;
  } else {
    const edges = graph.getInbound(nodeId).filter((e) => e.type === 'renders_as');
    if (edges.length === 0) return null;
    return graph.nodes.get(edges[0]!.from) ?? null;
  }
});

/**
 * 是否有 renders_as 关联——决定呈现段显示"内嵌编辑"还是"创建"按钮。
 */
const hasPresentation = computed(() => presentationNode.value !== null);

/**
 * 呈现字段更新——写入 presentation 节点。
 */
function onPresentationFieldUpdate(fieldKey: string, value: unknown): void {
  if (!presentationNode.value) return;
  const newData = { ...(presentationNode.value.data as Record<string, unknown>), [fieldKey]: value };
  actions.upsertNode({
    kind: presentationNode.value.kind,
    id: presentationNode.value.id,
    data: newData,
    source: presentationNode.value.source,
    revision: '',
  });
}

/**
 * 呈现节点的字段 schema（name / desc）——内联构造，避免引入新文件。
 *
 * presentation.item / presentation.recipe 节点的 data 形如 { name, desc }，
 * 没有 schema 注册（仅作为 template 的呈现副本存在），故直接构造 FieldSchema。
 */
const presentationNameFieldSchema: FieldSchema = {
  key: 'name',
  label: '中文名',
  type: 'text',
  required: true,
  placeholder: '中文显示名称',
};

const presentationDescFieldSchema: FieldSchema = {
  key: 'desc',
  label: '中文描述',
  type: 'text',
  placeholder: '中文描述文本（可为空）',
};

/**
 * 创建新 presentation 节点并建立 renders_as 边。
 *
 * P2 简化：仅创建空 presentation 节点，renders_as 边由 O-3 重新装配时自动构建
 * （实际场景中用户刷新工作区即可看到关联）。
 *
 * P4 扩展：enemy.template → presentation.enemy 映射。
 */
function createPresentation(): void {
  if (!node.value) return;
  let presentationKind: string;
  if (node.value.kind === 'item.template') {
    presentationKind = 'presentation.item';
  } else if (node.value.kind === 'enemy.template') {
    presentationKind = 'presentation.enemy';
  } else {
    presentationKind = 'presentation.recipe';
  }
  const newNode: ResourceNode = {
    kind: presentationKind,
    id: node.value.id,
    data: { name: '', desc: '' },
    source: [],
    revision: '',
  };
  actions.upsertNode(newNode);
  // 立即添加 renders_as 边
  graph.addEdge('renders_as', `${node.value.kind}:${node.value.id}`, `${presentationKind}:${node.value.id}`);
}

// ─── 引用段（inbound + outbound 边）────────────────────────

interface EdgeGroup {
  edgeType: RelationshipType;
  label: string;
  direction: 'inbound' | 'outbound';
  edges: Array<{ edge: RelationshipEdge; otherNodeId: string; otherNode?: ResourceNode }>;
}

const inboundGroups = computed<EdgeGroup[]>(() => {
  if (!props.nodeId) return [];
  return groupEdges(graph.getInbound(props.nodeId), 'inbound');
});

const outboundGroups = computed<EdgeGroup[]>(() => {
  if (!props.nodeId) return [];
  return groupEdges(graph.getOutbound(props.nodeId), 'outbound');
});

function groupEdges(edges: RelationshipEdge[], direction: 'inbound' | 'outbound'): EdgeGroup[] {
  const groups = new Map<RelationshipType, RelationshipEdge[]>();
  for (const edge of edges) {
    const arr = groups.get(edge.type) ?? [];
    arr.push(edge);
    groups.set(edge.type, arr);
  }
  const result: EdgeGroup[] = [];
  for (const [edgeType, groupEdges] of groups) {
    // 过滤 renders_as 边（已在呈现段显示）
    if (edgeType === 'renders_as') continue;
    const label = direction === 'inbound'
      ? (REVERSE_RELATIONSHIP_LABEL[edgeType] ?? edgeType)
      : edgeType;
    const enriched = groupEdges.map((edge) => {
      const otherNodeId = direction === 'inbound' ? edge.from : edge.to;
      return {
        edge,
        otherNodeId,
        otherNode: graph.nodes.get(otherNodeId),
      };
    });
    result.push({ edgeType, label, direction, edges: enriched });
  }
  return result;
}

/**
 * 点击引用边——请求导航到另一节点。
 */
function onEdgeClick(otherNodeId: string): void {
  emit('navigate', otherNodeId);
}

// ─── 节点切换时重置 picker ─────────────────────────────────

watch(
  () => props.nodeId,
  () => {
    pickerOpen.value = false;
    pickerRefField.value = null;
  },
);
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden">
    <div v-if="!node" class="flex h-full items-center justify-center text-xs text-gray-600">
      请从左侧选择一个资源
    </div>

    <div v-else class="flex flex-col gap-3 overflow-auto p-2">
      <!-- 节点头部 -->
      <div class="rounded border border-gray-800 bg-gray-900 p-2">
        <div class="flex items-center gap-2">
          <span class="rounded bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-400">{{ node.kind }}</span>
          <span class="font-mono text-sm text-gray-100">{{ node.id }}</span>
        </div>
        <div class="mt-1 text-[10px] text-gray-600">
          revision: {{ node.revision.slice(0, 8) }} · source: {{ node.source.length }} 个
        </div>
      </div>

      <!-- ─── 段 1：定义 ─────────────────────────────── -->
      <section class="flex flex-col gap-1">
        <h3 class="border-b border-gray-800 pb-1 text-xs font-semibold text-gray-300">定义</h3>
        <div
          v-for="group in groupedFields"
          :key="group.group.id"
          class="flex flex-col gap-2 rounded border border-gray-800 bg-gray-900 p-2"
        >
          <div class="text-[10px] uppercase tracking-wider text-gray-500">{{ group.group.id }}</div>
          <div class="grid grid-cols-1 gap-2">
            <div
              v-for="field in group.fields"
              :key="field.spec.key"
              class="flex flex-col gap-1"
            >
              <div class="flex items-center gap-1">
                <div class="flex-1">
                  <SchemaField
                    :schema="field.schema"
                    :model-value="(node.data as Record<string, unknown>)[field.spec.key]"
                    @update:model-value="(v) => onFieldUpdate(field.spec.key, v)"
                  />
                </div>
                <!-- 引用字段选择按钮 -->
                <BaseButton
                  v-if="field.spec.refKind"
                  size="sm"
                  variant="ghost"
                  title="从资源库选择"
                  @click="openPicker(field.spec)"
                >
                  …
                </BaseButton>
              </div>
              <!-- deprecated 标记 -->
              <div v-if="field.spec.deprecated" class="text-[10px] text-yellow-700">
                ⚠ deprecated 字段——已迁移至 presentation
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- ─── 段 2：分布 ─────────────────────────────── -->
      <section class="flex flex-col gap-1">
        <h3 class="border-b border-gray-800 pb-1 text-xs font-semibold text-gray-300">分布</h3>
        <div class="rounded border border-gray-800 bg-gray-900 p-2 text-[10px] text-gray-600">
          P3/P4 阶段实现 POI/scatter/enemy 分布
        </div>
      </section>

      <!-- ─── 段 3：呈现（仅 template kinds）────────── -->
      <section v-if="isTemplateKind" class="flex flex-col gap-1">
        <h3 class="border-b border-gray-800 pb-1 text-xs font-semibold text-gray-300">呈现</h3>
        <div v-if="hasPresentation && presentationNode" class="flex flex-col gap-2 rounded border border-gray-800 bg-gray-900 p-2">
          <div class="flex items-center gap-2 text-[10px] text-gray-500">
            <span class="rounded bg-gray-800 px-1.5 py-0.5">{{ presentationNode.kind }}</span>
            <span class="font-mono">{{ presentationNode.id }}</span>
          </div>
          <SchemaField
            :schema="presentationNameFieldSchema"
            :model-value="(presentationNode.data as Record<string, unknown>)['name']"
            @update:model-value="(v) => onPresentationFieldUpdate('name', v)"
          />
          <SchemaField
            :schema="presentationDescFieldSchema"
            :model-value="(presentationNode.data as Record<string, unknown>)['desc']"
            @update:model-value="(v) => onPresentationFieldUpdate('desc', v)"
          />
        </div>
        <div v-else class="rounded border border-gray-800 bg-gray-900 p-2">
          <div class="text-[10px] text-gray-600">该模板无中文呈现</div>
          <BaseButton size="sm" variant="ghost" class="mt-1" @click="createPresentation">
            + 创建呈现
          </BaseButton>
        </div>
      </section>

      <!-- ─── 段 4：引用 ─────────────────────────────── -->
      <section class="flex flex-col gap-1">
        <h3 class="border-b border-gray-800 pb-1 text-xs font-semibold text-gray-300">引用</h3>
        <div class="flex flex-col gap-2">
          <!-- inbound -->
          <div v-if="inboundGroups.length > 0" class="flex flex-col gap-1">
            <div class="text-[10px] uppercase tracking-wider text-gray-500">谁引用了我（inbound）</div>
            <div
              v-for="group in inboundGroups"
              :key="`in-${group.edgeType}`"
              class="rounded border border-gray-800 bg-gray-900 p-2"
            >
              <div class="mb-1 text-[10px] text-gray-400">
                {{ group.label }}（{{ group.edges.length }}）
              </div>
              <div class="flex flex-col gap-0.5">
                <button
                  v-for="item in group.edges"
                  :key="item.edge.id"
                  type="button"
                  class="truncate rounded px-1 py-0.5 text-left font-mono text-[11px] text-gray-300 hover:bg-gray-800"
                  :title="item.otherNodeId"
                  @click="onEdgeClick(item.otherNodeId)"
                >
                  ← {{ item.otherNode?.kind }}:{{ item.otherNode?.id }}
                </button>
              </div>
            </div>
          </div>
          <!-- outbound -->
          <div v-if="outboundGroups.length > 0" class="flex flex-col gap-1">
            <div class="text-[10px] uppercase tracking-wider text-gray-500">我引用了谁（outbound）</div>
            <div
              v-for="group in outboundGroups"
              :key="`out-${group.edgeType}`"
              class="rounded border border-gray-800 bg-gray-900 p-2"
            >
              <div class="mb-1 text-[10px] text-gray-400">
                {{ group.label }}（{{ group.edges.length }}）
              </div>
              <div class="flex flex-col gap-0.5">
                <button
                  v-for="item in group.edges"
                  :key="item.edge.id"
                  type="button"
                  class="truncate rounded px-1 py-0.5 text-left font-mono text-[11px] text-gray-300 hover:bg-gray-800"
                  :title="item.otherNodeId"
                  @click="onEdgeClick(item.otherNodeId)"
                >
                  → {{ item.otherNode?.kind }}:{{ item.otherNode?.id }}
                </button>
              </div>
            </div>
          </div>
          <!-- 无引用 -->
          <div v-if="inboundGroups.length === 0 && outboundGroups.length === 0" class="rounded border border-gray-800 bg-gray-900 p-2 text-[10px] text-gray-600">
            无引用关系
          </div>
        </div>
      </section>

      <!-- ─── 段 5：诊断 ─────────────────────────────── -->
      <section class="flex flex-col gap-1">
        <h3 class="border-b border-gray-800 pb-1 text-xs font-semibold text-gray-300">诊断</h3>
        <div class="rounded border border-gray-800 bg-gray-900 p-2 text-[10px] text-gray-600">
          O-10 校验调度中（P3+ 接入 issue 索引）
        </div>
      </section>
    </div>

    <!-- ResourcePicker 模态框 -->
    <ResourcePicker
      :open="pickerOpen"
      :ref-kind="pickerRefField?.refKind ?? ''"
      :ref-field="pickerRefField?.refField"
      @close="pickerOpen = false"
      @select="onPickerSelect"
    />
  </div>
</template>
