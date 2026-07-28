<!-- @module O 内容工具箱 -->
<!-- @framework O-7 模板工作区 -->
<script setup lang="ts">
//
// TemplatesView：模板工作区主视图（P2 §4.5.1 + P4 enemy 扩展）
//
// 三栏布局（对齐设计案 §5.2）：
//   - 左栏（w-48）：资源类型切换（6 种 kind） + 当前 kind 节点数徽标
//   - 中栏（flex-1）：可搜索表格（TemplateList）
//   - 右栏（w-96）：详情检查器（TemplateDetail）
//
// 资源类型 Tab：
//   - item.template：道具模板（item_table.php）
//   - recipe.template：配方模板（recipe_table.php）
//   - presentation.item：道具呈现（item-locale.ts）
//   - presentation.recipe：配方呈现（recipe-locale.ts）
//   - enemy.template：敌人模板（enemies_config.php，P4 新增）
//   - presentation.enemy：敌人呈现（enemy-locale.ts，P4 新增）
//
// 设计意图：
//   - 旧 ConfigView 是按"文件"组织（item_table / scatter_pool / poi_table 各一个长表单），
//     工具箱改为按"资源类型"组织，配合 schema 驱动 UI 实现统一编辑框架
//   - 6 种 kind 涵盖 P2/P4 阶段所有模板与呈现资源；P3 POI 呈现单独在 PresentationView 管理
//   - 左栏节点数实时反映 graph-store 状态，便于开发者感知工作区加载情况
//

import { ref, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useGraphStore } from '@/graph/graph-store';
import { useTemplateActions } from '@/composables/useTemplateActions';
import TemplateList from '@/components/templates/TemplateList.vue';
import TemplateDetail from '@/components/templates/TemplateDetail.vue';
import DeleteProtectionModal from '@/components/templates/DeleteProtectionModal.vue';

const { t } = useI18n();
const graph = useGraphStore();
const actions = useTemplateActions();

/**
 * 资源类型清单——P4 阶段固定 6 种。
 *
 * 顺序约定：先模板后呈现——让用户先看到主数据（template），再看到本地化（presentation）。
 * kind 与 labelKey 一一对应，labelKey 在 i18n.templates.* 中维护。
 */
interface ResourceKindTab {
  kind: string;
  labelKey: string;
}

const resourceKinds: ResourceKindTab[] = [
  { kind: 'item.template', labelKey: 'templates.kindItemTemplate' },
  { kind: 'recipe.template', labelKey: 'templates.kindRecipeTemplate' },
  { kind: 'presentation.item', labelKey: 'templates.kindPresentationItem' },
  { kind: 'presentation.recipe', labelKey: 'templates.kindPresentationRecipe' },
  { kind: 'enemy.template', labelKey: 'templates.kindEnemyTemplate' },
  { kind: 'presentation.enemy', labelKey: 'templates.kindPresentationEnemy' },
];

const currentKind = ref<string>('item.template');

/**
 * 当前选中节点 ID 列表（仅 ID，不含 kind 前缀）。
 *
 * 切换 kind 时由 TemplateList 内部 watch 重置为 []。
 */
const selectedIds = ref<string[]>([]);

/**
 * 删除保护模态框状态。
 */
const showDeleteModal = ref(false);
const pendingDeleteNodeId = ref<string | null>(null);

/**
 * 节点数统计——按 kind 分组，左栏徽标使用。
 */
const nodeCountByKind = computed<Record<string, number>>(() => {
  const counts = graph.nodeCountByKind;
  const result: Record<string, number> = {};
  for (const [kind, count] of counts) {
    result[kind] = count;
  }
  return result;
});

/**
 * 详情页 nodeId——单选时拼成 `${kind}:${id}`，无选择或多选时为 null。
 */
const detailNodeId = computed<string | null>(() => {
  if (selectedIds.value.length !== 1) return null;
  return `${currentKind.value}:${selectedIds.value[0]}`;
});

/**
 * 触发删除——由 TemplateList 派发 deleteRequest 事件。
 */
function onDeleteRequest(nodeId: string): void {
  pendingDeleteNodeId.value = nodeId;
  showDeleteModal.value = true;
}

/**
 * 删除确认——执行级联删除 + 同步删除 + 主节点删除。
 *
 * 执行顺序：
 *   1. 先删除所有 cascadedNodeIds（inbound 引用节点）
 *   2. 再删除所有 syncDeleteNodeIds（renders_as 关联呈现节点）
 *   3. 最后删除主节点
 *
 * 这样保证 graph-store 的边级联清理顺序正确：
 *   - 主节点删除时 inbound 边已被级联清理（因为源节点已删除）
 *   - renders_as 边在同步删除呈现节点时由 graph-store 自动清理
 */
function onDeleteConfirm(payload: {
  primaryNodeId: string;
  cascadedNodeIds: string[];
  syncDeleteNodeIds: string[];
}): void {
  // 1. 级联删除 inbound 引用节点
  for (const nodeId of payload.cascadedNodeIds) {
    actions.removeNode(nodeId);
  }
  // 2. 同步删除 renders_as 关联呈现节点
  for (const nodeId of payload.syncDeleteNodeIds) {
    actions.removeNode(nodeId);
  }
  // 3. 删除主节点
  actions.removeNode(payload.primaryNodeId);

  // 清理选择状态——已被删除的 ID 从选中列表中移除
  const deletedIds = new Set<string>([
    payload.primaryNodeId,
    ...payload.cascadedNodeIds,
    ...payload.syncDeleteNodeIds,
  ]);
  // nodeId 形如 `${kind}:${id}`，提取 id 部分比对 selectedIds
  selectedIds.value = selectedIds.value.filter((id) => {
    return !deletedIds.has(`${currentKind.value}:${id}`);
  });

  showDeleteModal.value = false;
  pendingDeleteNodeId.value = null;
}

/**
 * 详情页导航——点击引用边时切换 currentKind + 选中目标节点。
 *
 * nodeId 形如 `${kind}:${id}`，需要解析出 kind 和 id 分别更新两个状态。
 */
function onDetailNavigate(nodeId: string): void {
  const idx = nodeId.indexOf(':');
  if (idx < 0) return;
  const kind = nodeId.slice(0, idx);
  const id = nodeId.slice(idx + 1);
  // 仅当目标 kind 在 resourceKinds 清单内时切换；否则忽略（如 effect.func）
  const tab = resourceKinds.find((k) => k.kind === kind);
  if (!tab) return;
  currentKind.value = kind;
  selectedIds.value = [id];
}
</script>

<template>
  <div class="flex h-full gap-2 overflow-hidden p-2">
    <!-- ─── 左栏：资源类型切换 ───────────────────────── -->
    <div class="flex w-48 flex-col gap-1 border-r border-gray-800 pr-2">
      <div class="mb-1 px-1 text-[10px] uppercase tracking-wider text-gray-500">
        {{ t('templates.title') }}
      </div>
      <button
        v-for="kind in resourceKinds"
        :key="kind.kind"
        type="button"
        :class="
          currentKind === kind.kind
            ? 'bg-gray-700 text-gray-100'
            : 'text-gray-300 hover:bg-gray-800'
        "
        class="flex items-center justify-between rounded px-2 py-1.5 text-xs"
        @click="currentKind = kind.kind"
      >
        <span class="truncate">{{ t(kind.labelKey) }}</span>
        <span class="rounded bg-gray-800 px-1 text-[10px] text-gray-400">
          {{ nodeCountByKind[kind.kind] ?? 0 }}
        </span>
      </button>
    </div>

    <!-- ─── 中栏：可搜索表格 ───────────────────────── -->
    <div class="flex flex-1 flex-col overflow-hidden">
      <TemplateList
        :kind="currentKind"
        :selected-ids="selectedIds"
        @update:selected-ids="selectedIds = $event"
        @delete-request="onDeleteRequest"
      />
    </div>

    <!-- ─── 右栏：详情检查器 ───────────────────────── -->
    <div class="flex w-96 flex-col overflow-hidden border-l border-gray-800 pl-2">
      <TemplateDetail :node-id="detailNodeId" @navigate="onDetailNavigate" />
    </div>

    <!-- ─── 删除保护模态框 ───────────────────────── -->
    <DeleteProtectionModal
      :open="showDeleteModal"
      :node-id="pendingDeleteNodeId"
      @close="showDeleteModal = false"
      @confirm="onDeleteConfirm"
    />
  </div>
</template>
