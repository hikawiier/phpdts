<!-- @module O 内容工具箱 -->
<script setup lang="ts">
//
// DriftReport：POI 双源漂移报告 + quick fix 入口（P3 §4.6.3 / §4.9）
//
// 漂移定义（执行案 §4.9）：
//   - poi_table.php 有 29 个 POI 模板（含 name/desc 后端 fallback）
//   - poi-locale.ts 修复前 27 条 locale 条目（缺 locked_door / locked_chest）
//   - 漂移 = poi.template 节点存在但无对应 presentation.poi 节点
//
// quick fix 实现（执行案 §4.6.3 + 任务说明 §4）：
//   1. 从 poi.template 节点的 name / desc 字段读取后端 fallback
//   2. 调用 changeSet.batchAdd 把 presentation.poi add 操作登记到 ChangeSet
//   3. 调用 changeSet.markFilesAffected 标记 vex-vue/src/data/poi-locale.ts 受影响
//   4. 调用 useTemplateActions.upsertNode 让 graph-store 立即反映新节点（UI 即时更新）
//   5. 调用 graph.addEdge('renders_as', ...) 同步建立关联边
//   不直接写文件——实际写入由 O-5 原子发布管道在 BuildView.handlePublish 时执行
//
// 状态驱动设计：
//   - 即使 poi-locale.ts 已被主代理修复，UI 也应正确反映当前状态
//   - 修复后 graph-store 加载的 presentation.poi 节点为 29 条，driftList 为空
//   - DriftReport 显示"0 条漂移"——无 quick fix 按钮可点
//

import { computed } from 'vue';
import { useGraphStore } from '@/graph/graph-store';
import { useTemplateActions } from '@/composables/useTemplateActions';
import { useChangeSet } from '@/composables/useChangeSet';
import BaseModal from '@/components/common/BaseModal.vue';
import BaseButton from '@/components/common/BaseButton.vue';
import type { ResourceNode } from '@/graph/types';
import type { BatchAddEntry } from '@/build/change-set';

const props = defineProps<{
  /** 是否打开 */
  open: boolean;
}>();

const emit = defineEmits<{
  /** 关闭模态框 */
  close: [];
  /** 修复完成——通知父组件刷新（如 driftCount 重算） */
  fixed: [];
}>();

const graph = useGraphStore();
const actions = useTemplateActions();
const changeSet = useChangeSet();

/**
 * POI 双源漂移目标文件——vex-vue/src/data/poi-locale.ts。
 *
 * quick fix 必须标记此文件为受影响，BuildView 发布时才会写入。
 */
const POI_LOCALE_FILE_PATH = 'vex-vue/src/data/poi-locale.ts';

interface PoiTemplateData {
  name?: string;
  desc?: string;
  [key: string]: unknown;
}

interface DriftEntry {
  /** POI 模板节点 ID（如 'locked_door'） */
  poiId: string;
  /** 后端 fallback 中文名 */
  fallbackName: string;
  /** 后端 fallback 中文描述 */
  fallbackDesc: string;
}

/**
 * 漂移列表——所有 poi.template 节点中，无对应 presentation.poi 节点的条目。
 *
 * 派生方式：
 *   1. 遍历 graph.findNodesByKind('poi.template')
 *   2. 对每个 poi.template:{id}，检查 graph.nodes 是否有 presentation.poi:{id}
 *   3. 若无，加入 driftList（含 fallback name/desc）
 *
 * 响应式：graph-store 节点变更时自动重算——quick fix 后 driftList 立即缩短
 */
const driftList = computed<DriftEntry[]>(() => {
  const result: DriftEntry[] = [];
  const poiTemplates = graph.findNodesByKind('poi.template');
  for (const node of poiTemplates) {
    const presentationNodeId = `presentation.poi:${node.id}`;
    if (graph.nodes.has(presentationNodeId)) continue;
    const data = node.data as PoiTemplateData;
    result.push({
      poiId: node.id,
      fallbackName: typeof data.name === 'string' ? data.name : '',
      fallbackDesc: typeof data.desc === 'string' ? data.desc : '',
    });
  }
  return result;
});

/**
 * 漂移数量——顶部徽标与"一键修复"按钮 disabled 判断使用。
 */
const driftCount = computed<number>(() => driftList.value.length);

/**
 * 是否已经修复——driftCount === 0 时显示"无漂移"提示。
 */
const isFixed = computed<boolean>(() => driftCount.value === 0);

/**
 * 应用单条 quick fix——把 poi.template 的 name/desc 复制到新建 presentation.poi 节点。
 *
 * 步骤（执行案 §4.6.3 + 任务说明 §4）：
 *   1. 从 poi.template 节点读取 fallback name/desc
 *   2. changeSet.batchAdd 登记 presentation.poi add 操作
 *   3. changeSet.markFilesAffected 标记 vex-vue/src/data/poi-locale.ts
 *   4. actions.upsertNode 让 graph-store 立即反映新节点
 *   5. graph.addEdge('renders_as', 'poi.template:{id}', 'presentation.poi:{id}')
 *      同步建立关联边（与 poi-loot-edge-builder.ts pushRendersAsEdge 一致）
 *
 * 设计取舍：同时调用 ChangeSet 与 graph-store——
 *   - ChangeSet 累积 diff 供 O-5 发布管道使用
 *   - graph-store 即时变更让 UI 立即响应（用户无需等待发布才看到效果）
 *   - 双轨同步是 P3 过渡期设计；P5 单源编译后由 ChangeSet 单向驱动 graph-store
 */
function applyQuickFix(entry: DriftEntry): void {
  const newData = { name: entry.fallbackName, desc: entry.fallbackDesc };
  const presentationNodeId = `presentation.poi:${entry.poiId}`;

  // 1. ChangeSet 登记
  const batchEntry: BatchAddEntry = {
    nodeId: presentationNodeId,
    newData,
  };
  changeSet.batchAdd([batchEntry]);
  changeSet.markFilesAffected([POI_LOCALE_FILE_PATH]);

  // 2. graph-store 即时反映
  const presentationNode: ResourceNode = {
    kind: 'presentation.poi',
    id: entry.poiId,
    data: newData,
    source: [],
    revision: '',
  };
  actions.upsertNode(presentationNode);

  // 3. 建立 renders_as 边（与 poi-loot-edge-builder.ts pushRendersAsEdge 方向一致）
  //    方向：poi.template → presentation.poi
  graph.addEdge('renders_as', `poi.template:${entry.poiId}`, presentationNodeId);

  // 4. 通知父组件刷新
  emit('fixed');
}

/**
 * 一键修复全部漂移——遍历 driftList 逐条应用 quick fix。
 *
 * 不使用 batchAdd 一次性提交——逐条 upsertNode 让 graph-store 边建立顺序可控
 * （每次 addEdge 都基于已存在的 poi.template 节点）。
 */
function applyAllQuickFixes(): void {
  for (const entry of driftList.value) {
    applyQuickFix(entry);
  }
}

/**
 * 关闭模态框。
 */
function onClose(): void {
  emit('close');
}
</script>

<template>
  <BaseModal :open="props.open" title="POI 双源漂移报告" @close="onClose">
    <div class="flex flex-col gap-3">
      <!-- 漂移统计 -->
      <div class="flex items-center justify-between rounded border border-gray-800 bg-gray-900 px-3 py-2">
        <div class="text-xs text-gray-300">
          <span class="text-gray-500">漂移数量：</span>
          <span :class="driftCount > 0 ? 'text-accent-error' : 'text-gray-400'">{{ driftCount }}</span>
          <span class="text-gray-600"> 条</span>
        </div>
        <BaseButton
          v-if="!isFixed"
          size="sm"
          variant="primary"
          @click="applyAllQuickFixes"
        >
          一键修复全部
        </BaseButton>
      </div>

      <!-- 漂移列表 -->
      <div v-if="isFixed" class="rounded border border-gray-800 bg-gray-900 px-3 py-4 text-center text-xs text-gray-400">
        无漂移——所有 POI 模板均有 locale 覆盖
      </div>

      <div v-else class="flex flex-col gap-2">
        <div class="text-[10px] uppercase tracking-wider text-gray-500">
          以下 poi.template 节点缺少 presentation.poi 覆盖（locale 缺失）
        </div>
        <div
          v-for="entry in driftList"
          :key="entry.poiId"
          class="flex flex-col gap-1 rounded border border-gray-800 bg-gray-900 p-2"
        >
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              <span class="rounded bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-400">poi.template</span>
              <span class="font-mono text-xs text-gray-100">{{ entry.poiId }}</span>
            </div>
            <BaseButton
              size="sm"
              variant="ghost"
              title="从 poi.template 的 name/desc 复制到新建 presentation.poi 节点"
              @click="applyQuickFix(entry)"
            >
              修复
            </BaseButton>
          </div>
          <div class="text-[10px] text-gray-500">
            <span class="text-gray-600">fallback name：</span>
            <span class="text-gray-300">{{ entry.fallbackName || '（空）' }}</span>
          </div>
          <div class="text-[10px] text-gray-500">
            <span class="text-gray-600">fallback desc：</span>
            <span class="text-gray-300">{{ entry.fallbackDesc || '（空）' }}</span>
          </div>
        </div>
      </div>

      <!-- 说明 -->
      <div class="rounded border border-gray-800 bg-gray-900 p-2 text-[10px] text-gray-600">
        <div class="mb-1 font-semibold text-gray-500">quick fix 行为</div>
        <div>· 把 poi.template 的 name / desc 复制到新建 presentation.poi 节点</div>
        <div>· 登记到 ChangeSet（batchAdd + markFilesAffected）</div>
        <div>· 不直接写文件——需在构建工作区点击"发布"由 O-5 原子写入 poi-locale.ts</div>
        <div>· 修复后 locale 与 fallback 完全相同——O-10 第 6 层会标记 fallback_redundant warning（无害）</div>
      </div>
    </div>

    <template #footer>
      <BaseButton size="sm" variant="ghost" @click="onClose">关闭</BaseButton>
    </template>
  </BaseModal>
</template>
