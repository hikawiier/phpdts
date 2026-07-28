<!-- @module O 内容工具箱 -->
<!-- @framework O-9 呈现工作区 -->
<script setup lang="ts">
//
// PresentationView：呈现工作区主视图（P3 §4.6.1-4.6.3 + P4 enemy 扩展）
//
// 三栏布局（对齐设计案 §5.4 + TemplatesView 信息架构）：
//   - 左栏（w-48）：资源类型切换（POI / item / recipe / enemy） + 当前 kind 节点数徽标
//   - 中栏（flex-1）：可搜索列表（PresentationList）
//   - 右栏（w-96）：四段式详情面板（PresentationDetail）
//
// 资源类型 Tab：
//   - presentation.poi：POI 呈现（poi-locale.ts，P3 重点）
//   - presentation.item：道具呈现（item-locale.ts，P2 已实现）
//   - presentation.recipe：配方呈现（recipe-locale.ts，P2 已实现）
//   - presentation.enemy：敌人呈现（enemy-locale.ts，P4 新增）
//
// 顶部工具栏按钮：
//   - 漂移报告：打开 DriftReport 模态框（POI kind 专属，仅 P3 阶段需要修复
//     locked_door / locked_chest 双源漂移）
//
// 设计意图（执行案 §4.6.1）：
//   - 呈现不是单独维护的翻译字典，而是资源图的投影视图
//   - 显示中文名/描述/后端 fallback/前端最终值/诊断
//   - 修改模板 ID 时，presentation 与所有引用在同一 Change Set 内重命名（P5 实现）
//
// 详情页导航（navigate 事件）：
//   - 仅当目标 kind 在 resourceKinds 清单内时切换 tab + 选中节点；
//   - 否则忽略（如 poi.template 不在本工作区范围，由模板工作区管理）。
//

import { ref, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useGraphStore } from '@/graph/graph-store';
import PresentationList from '@/components/presentation/PresentationList.vue';
import PresentationDetail from '@/components/presentation/PresentationDetail.vue';
import DriftReport from '@/components/presentation/DriftReport.vue';
import BaseButton from '@/components/common/BaseButton.vue';

const { t } = useI18n();
const graph = useGraphStore();

/**
 * 资源类型清单——P4 阶段 4 种呈现 kind。
 *
 * 顺序约定：POI 在首位——P3 阶段重点；item / recipe 在中（P2 已实现）；enemy 在末（P4 新增）。
 */
interface ResourceKindTab {
  kind: string;
  labelKey: string;
}

const resourceKinds: ResourceKindTab[] = [
  { kind: 'presentation.poi', labelKey: 'presentation.kindPoi' },
  { kind: 'presentation.item', labelKey: 'presentation.kindItem' },
  { kind: 'presentation.recipe', labelKey: 'presentation.kindRecipe' },
  { kind: 'presentation.enemy', labelKey: 'presentation.kindEnemy' },
];

const currentKind = ref<string>('presentation.poi');

/**
 * 当前选中节点 ID 列表（仅 ID，不含 kind 前缀）。
 *
 * 切换 kind 时由 PresentationList 内部 watch 重置为 []。
 */
const selectedIds = ref<string[]>([]);

/**
 * 漂移报告模态框状态——仅 POI kind 显示入口按钮。
 */
const showDriftModal = ref(false);

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
 * 详情页 nodeId——单选时拼成 `${kind}:${id}`，无选择时为 null。
 */
const detailNodeId = computed<string | null>(() => {
  if (selectedIds.value.length !== 1) return null;
  return `${currentKind.value}:${selectedIds.value[0]}`;
});

/**
 * 是否为 POI kind——决定是否显示漂移报告入口按钮。
 */
const isPoiKind = computed(() => currentKind.value === 'presentation.poi');

/**
 * 详情页导航——点击 poi.template 链接时触发。
 *
 * 仅当目标 kind 在 resourceKinds 清单内时切换；否则忽略
 * （如 poi.template 由模板工作区管理，不在此视图范围）。
 */
function onDetailNavigate(nodeId: string): void {
  const idx = nodeId.indexOf(':');
  if (idx < 0) return;
  const kind = nodeId.slice(0, idx);
  const id = nodeId.slice(idx + 1);
  const tab = resourceKinds.find((k) => k.kind === kind);
  if (!tab) return;
  currentKind.value = kind;
  selectedIds.value = [id];
}
</script>

<template>
  <div class="flex h-full flex-col gap-2 overflow-hidden p-2">
    <!-- ─── 顶部工具栏（漂移报告入口，仅 POI kind 显示） ─── -->
    <div v-if="isPoiKind" class="flex items-center justify-end">
      <BaseButton size="sm" variant="ghost" @click="showDriftModal = true">
        {{ t('presentation.driftButton') }}
      </BaseButton>
    </div>

    <!-- ─── 三栏主体 ─── -->
    <div class="flex flex-1 gap-2 overflow-hidden">
      <!-- ─── 左栏：资源类型切换 ─── -->
      <div class="flex w-48 flex-col gap-1 border-r border-gray-800 pr-2">
        <div class="mb-1 px-1 text-[10px] uppercase tracking-wider text-gray-500">
          {{ t('presentation.title') }}
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

      <!-- ─── 中栏：可搜索列表 ─── -->
      <div class="flex flex-1 flex-col overflow-hidden">
        <PresentationList
          :kind="currentKind"
          :selected-ids="selectedIds"
          @update:selected-ids="selectedIds = $event"
        />
      </div>

      <!-- ─── 右栏：详情检查器 ─── -->
      <div class="flex w-96 flex-col overflow-hidden border-l border-gray-800 pl-2">
        <PresentationDetail :node-id="detailNodeId" @navigate="onDetailNavigate" />
      </div>
    </div>

    <!-- ─── 漂移报告模态框 ─── -->
    <DriftReport
      :open="showDriftModal"
      @close="showDriftModal = false"
      @fixed="() => { /* driftList 在 DriftReport 内部响应式重算，无需额外处理 */ }"
    />
  </div>
</template>
