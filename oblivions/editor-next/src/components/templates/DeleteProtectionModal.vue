<!-- @module O 内容工具箱 -->
<script setup lang="ts">
//
// DeleteProtectionModal：删除保护两级流程（P2 §4.5.6）
//
// 设计意图：
//   - 删除前强制展示影响范围：所有 inbound 引用（谁引用了我）+ renders_as 关联（同步孤儿）
//   - 用户三选一：
//     · 替换：把所有 inbound 引用目标改为其他 ID（P2 阶段暂未实现，需 ResourcePicker 选目标）
//     · 级联删除：递归删除所有 inbound 引用节点（危险操作，二次确认）
//     · 取消：放弃删除
//   - 删除 item.template 时同步删除对应 presentation.item（通过 renders_as 边查找）
//   - 删除 presentation.item 时不删除 item.template（仅 renders_as 边自动移除）
//
// P2 MVP 简化：
//   - 替换功能暂未实现（标记为 TODO，P3 接入）
//   - 级联删除仅一层（不递归），避免误删大量关联资源
//   - 同步删除 renders_as 目标节点（item.template ↔ presentation.item）
//

import { computed, ref, watch } from 'vue';
import { useGraphStore } from '@/graph/graph-store';
import { REVERSE_RELATIONSHIP_LABEL } from '@/graph/relationship-types';
import type { RelationshipEdge } from '@/graph/edge';
import type { RelationshipType } from '@/graph/relationship-types';
import BaseModal from '@/components/common/BaseModal.vue';
import BaseButton from '@/components/common/BaseButton.vue';

const props = defineProps<{
  /** 模态框是否打开 */
  open: boolean;
  /** 待删除节点 ID（${kind}:${id} 格式） */
  nodeId: string | null;
}>();

const emit = defineEmits<{
  close: [];
  /** 确认删除——payload 是级联删除的节点 ID 列表（含主节点） */
  confirm: [payload: { primaryNodeId: string; cascadedNodeIds: string[]; syncDeleteNodeIds: string[] }];
}>();

const graph = useGraphStore();
const confirmStep = ref<'preview' | 'confirm_cascade'>('preview');

watch(
  () => props.open,
  (open) => {
    if (open) confirmStep.value = 'preview';
  },
);

/**
 * 待删除节点对象。
 */
const targetNode = computed(() => {
  if (!props.nodeId) return null;
  return graph.nodes.get(props.nodeId) ?? null;
});

/**
 * inbound 边列表——谁引用了我。
 */
const inboundEdges = computed<RelationshipEdge[]>(() => {
  if (!props.nodeId) return [];
  return graph.getInbound(props.nodeId);
});

/**
 * renders_as outbound 边——删除 template 时需要同步删除 presentation。
 */
const rendersAsOutbound = computed<RelationshipEdge[]>(() => {
  if (!props.nodeId) return [];
  return graph.getOutbound(props.nodeId).filter((e) => e.type === 'renders_as');
});

/**
 * 影响范围分组——按边类型分组 inbound 边，便于 UI 展示。
 */
const inboundByType = computed<Array<{ edgeType: RelationshipType; label: string; edges: Array<{ edge: RelationshipEdge; sourceNode?: { kind: string; id: string } }> }>>(() => {
  const groups = new Map<RelationshipType, RelationshipEdge[]>();
  for (const edge of inboundEdges.value) {
    const arr = groups.get(edge.type) ?? [];
    arr.push(edge);
    groups.set(edge.type, arr);
  }
  const result: Array<{ edgeType: RelationshipType; label: string; edges: Array<{ edge: RelationshipEdge; sourceNode?: { kind: string; id: string } }> }> = [];
  for (const [edgeType, edges] of groups) {
    const label = REVERSE_RELATIONSHIP_LABEL[edgeType] ?? edgeType;
    const enriched = edges.map((edge) => {
      const sourceNode = graph.nodes.get(edge.from);
      return {
        edge,
        sourceNode: sourceNode ? { kind: sourceNode.kind, id: sourceNode.id } : undefined,
      };
    });
    result.push({ edgeType, label, edges: enriched });
  }
  return result;
});

/**
 * 同步删除的节点 ID 列表——renders_as outbound 目标。
 *
 * 删除 item.template:{id} 时同步删除 presentation.item:{id}（renders_as 边查找）。
 */
const syncDeleteNodeIds = computed<string[]>(() => {
  return rendersAsOutbound.value.map((e) => e.to);
});

/**
 * 级联删除的节点 ID 列表——所有 inbound 引用节点。
 *
 * P2 阶段仅一层（不递归），避免误删大量关联资源。
 */
const cascadedNodeIds = computed<string[]>(() => {
  const ids = new Set<string>();
  for (const edge of inboundEdges.value) {
    // 不级联删除 renders_as 反向（presentation.item 不会因 item.template 被引用而级联）
    if (edge.type === 'renders_as') continue;
    ids.add(edge.from);
  }
  return Array.from(ids);
});

/**
 * 是否有 inbound 引用——决定是否展示"级联删除"按钮。
 */
const hasInbound = computed(() => inboundEdges.value.length > 0);

/**
 * 取消——关闭模态框。
 */
function onCancel(): void {
  emit('close');
}

/**
 * 强制删除——仅删除主节点 + 同步删除 renders_as 目标，不级联 inbound。
 *
 * 适用于：inbound 引用是 recipe，用户希望保留 recipe 但让 O-10 报 dangling error。
 */
function onForceDelete(): void {
  if (!props.nodeId) return;
  emit('confirm', {
    primaryNodeId: props.nodeId,
    cascadedNodeIds: [],
    syncDeleteNodeIds: syncDeleteNodeIds.value,
  });
}

/**
 * 级联删除——删除主节点 + 同步删除 renders_as 目标 + 删除所有 inbound 引用节点。
 *
 * 二次确认后触发，避免误操作。
 */
function onCascadeDelete(): void {
  confirmStep.value = 'confirm_cascade';
}

/**
 * 二次确认级联删除。
 */
function onConfirmCascade(): void {
  if (!props.nodeId) return;
  emit('confirm', {
    primaryNodeId: props.nodeId,
    cascadedNodeIds: cascadedNodeIds.value,
    syncDeleteNodeIds: syncDeleteNodeIds.value,
  });
}

/**
 * 返回预览步骤。
 */
function backToPreview(): void {
  confirmStep.value = 'preview';
}
</script>

<template>
  <BaseModal :open="open" :title="confirmStep === 'preview' ? '删除确认' : '二次确认：级联删除'" @close="onCancel">
    <!-- 预览步骤 -->
    <div v-if="confirmStep === 'preview' && targetNode" class="flex flex-col gap-3">
      <!-- 主节点信息 -->
      <div class="rounded border border-gray-800 bg-gray-900 p-2">
        <div class="text-xs text-gray-400">待删除节点</div>
        <div class="font-mono text-sm text-gray-100">
          {{ targetNode.kind }}:{{ targetNode.id }}
        </div>
      </div>

      <!-- inbound 引用清单 -->
      <div v-if="hasInbound" class="flex flex-col gap-1">
        <div class="text-xs font-medium text-accent-error">
          以下 {{ inboundEdges.length }} 处引用会因删除而断裂（O-10 将报 dangling error）：
        </div>
        <div
          v-for="group in inboundByType"
          :key="group.edgeType"
          class="rounded border border-gray-800 bg-gray-900 p-2"
        >
          <div class="mb-1 text-[10px] uppercase tracking-wider text-gray-500">
            {{ group.label }}（{{ group.edges.length }}）
          </div>
          <div class="flex flex-col gap-0.5">
            <div
              v-for="item in group.edges"
              :key="item.edge.id"
              class="font-mono text-[11px] text-gray-300"
            >
              ← {{ item.sourceNode?.kind }}:{{ item.sourceNode?.id }}
            </div>
          </div>
        </div>
      </div>

      <!-- renders_as 同步删除提示 -->
      <div v-if="syncDeleteNodeIds.length > 0" class="rounded border border-gray-700 bg-gray-800 p-2">
        <div class="text-xs text-gray-300">
          ⚠ 同步删除 {{ syncDeleteNodeIds.length }} 个关联呈现节点：
        </div>
        <div
          v-for="id in syncDeleteNodeIds"
          :key="id"
          class="font-mono text-[11px] text-gray-400"
        >
          → {{ id }}
        </div>
      </div>

      <!-- 无 inbound 提示 -->
      <div v-if="!hasInbound" class="rounded border border-gray-700 bg-gray-800 p-2 text-xs text-gray-300">
        该节点无被引用关系，可安全删除。
      </div>
    </div>

    <!-- 二次确认步骤 -->
    <div v-else-if="confirmStep === 'confirm_cascade'" class="flex flex-col gap-2">
      <div class="rounded border border-accent-error bg-[color-mix(in_srgb,var(--color-accent-error)_12%,transparent)] p-2 text-xs text-accent-error">
        即将级联删除以下节点，此操作不可撤销：
      </div>
      <div class="rounded border border-gray-800 bg-gray-900 p-2 font-mono text-[11px] text-gray-300">
        <div>{{ props.nodeId }} (主节点)</div>
        <div v-for="id in cascadedNodeIds" :key="id">↳ {{ id }}</div>
        <div v-for="id in syncDeleteNodeIds" :key="id">→ {{ id }} (同步)</div>
      </div>
      <div class="text-[10px] text-gray-500">
        共 {{ 1 + cascadedNodeIds.length + syncDeleteNodeIds.length }} 个节点将被删除
      </div>
    </div>

    <template #footer>
      <!-- 预览步骤按钮 -->
      <template v-if="confirmStep === 'preview'">
        <BaseButton variant="ghost" @click="onCancel">取消</BaseButton>
        <BaseButton v-if="hasInbound" variant="danger" @click="onCascadeDelete">级联删除</BaseButton>
        <BaseButton variant="default" @click="onForceDelete">
          {{ hasInbound ? '仅删此节点（留悬空引用）' : '确认删除' }}
        </BaseButton>
      </template>
      <!-- 二次确认步骤按钮 -->
      <template v-else>
        <BaseButton variant="ghost" @click="backToPreview">返回</BaseButton>
        <BaseButton variant="danger" @click="onConfirmCascade">确认级联删除</BaseButton>
      </template>
    </template>
  </BaseModal>
</template>
