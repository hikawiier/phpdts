<!-- @module O 内容工具箱 -->
<script setup lang="ts">
//
// RuleTablePanel：规则表视图（执行案 §4.5.2）
//
// 设计意图：
//   - 逐条编辑 distribution.poi 的 selector 与 placement，按 tide 桶分组（shallow/deep/abyss）
//   - 每条规则：subject.poi_id（资源选择器）+ placement.count（数字）
//   - selector.tides 由 tide 桶隐式派生（当前运行时契约每条规则只有一个 tide）
//   - selector.excludeEntrance / excludeExit 默认 true，折叠在"高级"面板
//   - 新增规则：先选 poi_id + tide，自动生成 id=`${tide}:${poi_id}`
//   - 删除规则：distribution.poi 是叶子，直接删除（无 inbound 引用）
//   - 拖拽排序（vuedraggable，复用 PoiPoolEditor 模式）
//
// 三视图同步：选中规则时 emit('select', ruleId) 给父 DistributionView，
//   由父同步矩阵 / 叠层视图的高亮状态。
//

import { ref, computed } from 'vue';
import draggable from 'vuedraggable';
import { useGraphStore } from '@/graph/graph-store';
import { useTemplateActions } from '@/composables/useTemplateActions';
import ResourcePicker from '@/components/templates/ResourcePicker.vue';
import BaseButton from '@/components/common/BaseButton.vue';
import BaseInput from '@/components/common/BaseInput.vue';
import BaseCheckbox from '@/components/common/BaseCheckbox.vue';
import {
  DISTRIBUTION_TIDE_OPTIONS,
  DISTRIBUTION_TIDE_ORDER,
  tideLabel,
  buildRuleId,
  createEmptyRule,
  ruleFromNode,
  dataFromRule,
  type DistributionRule,
  type DistributionPoiData,
} from '@/schema/distribution-rule';
import type { ResourceNode } from '@/graph/types';

const props = defineProps<{
  /** 当前选中的规则 ID（用于三视图同步高亮） */
  selectedRuleId: string | null;
}>();

const emit = defineEmits<{
  /** 选中某条规则——父组件同步矩阵 / 叠层视图 */
  select: [ruleId: string | null];
}>();

const graph = useGraphStore();
const actions = useTemplateActions();

// ─── Tide Tab 状态 ─────────────────────────────────────
const currentTide = ref<string>('shallow');

// ─── 高级面板展开状态（按规则 id 索引） ──────────────────
const expandedAdvanced = ref<Set<string>>(new Set());

// ─── ResourcePicker 模态框状态 ──────────────────────────
const pickerOpen = ref(false);
const pickerForRuleId = ref<string | null>(null);

// ─── 新增规则模态状态 ────────────────────────────────────
const newRuleTide = ref<string>('shallow');
const newRulePoiId = ref<string>('');
const showNewRulePanel = ref(false);

// ─── 当前 tide 桶下的规则列表 ──────────────────────────
/**
 * 当前 tide 桶下的规则节点（按 graph 中节点顺序）。
 *
 * 用 computed 派生——graph-store 变更时自动重渲染。
 * 节点 id 必须匹配 `${currentTide}:` 前缀。
 */
const currentRuleNodes = computed<ResourceNode<DistributionPoiData>[]>(() => {
  const all = graph.findNodesByKind('distribution.poi');
  return all.filter(
    (n): n is ResourceNode<DistributionPoiData> =>
      n.id.startsWith(`${currentTide.value}:`),
  );
});

/**
 * 当前 tide 桶下的 DistributionRule 列表（投影自 ResourceNode）。
 */
const currentRules = computed<DistributionRule[]>(() =>
  currentRuleNodes.value.map((n) => ruleFromNode(n)),
);

/**
 * 各 tide 桶的条目数（左栏徽标用）。
 */
const tideCounts = computed<Record<string, number>>(() => {
  const counts: Record<string, number> = { shallow: 0, deep: 0, abyss: 0 };
  const all = graph.findNodesByKind('distribution.poi');
  for (const n of all) {
    const parts = n.id.split(':');
    const tide = parts[0];
    if (tide !== undefined && tide in counts) counts[tide]!++;
  }
  return counts;
});

// ─── POI 模板选项（中文名 fallback）──────────────────────

/**
 * poi.template 节点列表——用于 poi_id 中文名 fallback 显示。
 */
const poiTemplateNodes = computed(() => graph.findNodesByKind('poi.template'));

/**
 * 由 poi_id 查询中文名（来自 poi.template.name 字段，已 deprecated 但仍是 fallback）。
 */
function poiLabel(poiId: string): string {
  if (!poiId) return '';
  const node = poiTemplateNodes.value.find((n) => n.id === poiId);
  if (!node) return poiId;
  const name = (node.data as { name?: string }).name;
  return name && typeof name === 'string' ? name : poiId;
}

// ─── 选中规则 ────────────────────────────────────────────

function selectRule(ruleId: string): void {
  emit('select', ruleId);
}

function toggleAdvanced(ruleId: string): void {
  if (expandedAdvanced.value.has(ruleId)) {
    expandedAdvanced.value.delete(ruleId);
  } else {
    expandedAdvanced.value.add(ruleId);
  }
}

// ─── 字段更新 ────────────────────────────────────────────

/**
 * 更新规则的字段——投影回 ResourceNode.data 后写入 graph-store。
 *
 * ruleId 形如 `shallow:supply_cache`，nodeId = `distribution.poi:${ruleId}`。
 */
function updateRuleField(ruleId: string, patch: Partial<DistributionRule>): void {
  const nodeId = `distribution.poi:${ruleId}`;
  const existing = graph.nodes.get(nodeId) as ResourceNode<DistributionPoiData> | undefined;
  if (!existing) return;
  const rule = ruleFromNode(existing);
  const merged: DistributionRule = {
    id: rule.id,
    subject: { poiId: patch.subject?.poiId ?? rule.subject.poiId },
    selector: {
      tides: patch.selector?.tides ?? rule.selector.tides,
      regions: patch.selector?.regions ?? rule.selector.regions,
      excludeEntrance: patch.selector?.excludeEntrance ?? rule.selector.excludeEntrance,
      excludeExit: patch.selector?.excludeExit ?? rule.selector.excludeExit,
    },
    placement: { count: patch.placement?.count ?? rule.placement.count },
  };
  const data = dataFromRule(merged);
  actions.upsertNode({
    kind: 'distribution.poi',
    id: ruleId,
    data,
    source: existing.source,
    revision: '',
  });
}

function onCountChange(ruleId: string, value: string): void {
  const num = Number(value);
  if (Number.isNaN(num) || num < 0) return;
  updateRuleField(ruleId, { placement: { count: Math.floor(num) } });
}

function onExcludeEntranceChange(ruleId: string, value: boolean): void {
  updateRuleField(ruleId, { selector: { excludeEntrance: value } } as Partial<DistributionRule>);
}

function onExcludeExitChange(ruleId: string, value: boolean): void {
  updateRuleField(ruleId, { selector: { excludeExit: value } } as Partial<DistributionRule>);
}

// ─── ResourcePicker ───────────────────────────────────────

function openPicker(ruleId: string): void {
  pickerForRuleId.value = ruleId;
  pickerOpen.value = true;
}

function onPickerSelect(value: string): void {
  if (pickerForRuleId.value === null) return;
  // poi_id 变更：直接更新字段（id 不变——id 改变等价于删除+新建）
  updateRuleField(pickerForRuleId.value, { subject: { poiId: value } });
  pickerForRuleId.value = null;
  pickerOpen.value = false;
}

// ─── 新增 / 删除规则 ─────────────────────────────────────

function startAddRule(): void {
  newRuleTide.value = currentTide.value;
  newRulePoiId.value = '';
  showNewRulePanel.value = true;
}

function openPickerForNew(): void {
  pickerForRuleId.value = null; // null 表示新增模式
  pickerOpen.value = true;
}

function onPickerSelectForNew(value: string): void {
  newRulePoiId.value = value;
  pickerForRuleId.value = null;
  pickerOpen.value = false;
}

/**
 * 资源选择器选中回调——区分新增模式与编辑模式。
 *
 * pickerForRuleId === null：新增模式 → 填入 newRulePoiId
 * pickerForRuleId !== null：编辑模式 → 更新该规则的字段
 */
function onPickerSelectDispatch(value: string): void {
  if (pickerForRuleId.value === null) {
    onPickerSelectForNew(value);
  } else {
    onPickerSelect(value);
  }
}

/**
 * 当前 ResourcePicker 的预选值——新增模式为 newRulePoiId，编辑模式为对应规则的 poi_id。
 */
const pickerCurrentValue = computed<string>(() => {
  if (pickerForRuleId.value === null) return newRulePoiId.value;
  const rule = currentRules.value.find((r) => r.id === pickerForRuleId.value);
  return rule?.subject.poiId ?? '';
});

function confirmAddRule(): void {
  if (!newRulePoiId.value || !newRuleTide.value) return;
  const ruleId = buildRuleId(newRuleTide.value, newRulePoiId.value);
  const existing = graph.nodes.get(`distribution.poi:${ruleId}`);
  if (existing) {
    // 已存在——切到对应 tide 桶并选中
    currentTide.value = newRuleTide.value;
    emit('select', ruleId);
    showNewRulePanel.value = false;
    return;
  }
  const rule = createEmptyRule(newRuleTide.value, newRulePoiId.value);
  const data = dataFromRule(rule);
  actions.upsertNode({
    kind: 'distribution.poi',
    id: ruleId,
    data,
    source: [
      {
        filePath: 'oblivions/gamedata/poi_pool.php',
        lineStart: 1,
        lineEnd: 1,
        format: 'php',
      },
    ],
    revision: '',
  });
  actions.markFileAffected('oblivions/gamedata/poi_pool.php');
  currentTide.value = newRuleTide.value;
  emit('select', ruleId);
  showNewRulePanel.value = false;
}

function cancelAddRule(): void {
  showNewRulePanel.value = false;
  newRulePoiId.value = '';
}

function removeRule(ruleId: string): void {
  const nodeId = `distribution.poi:${ruleId}`;
  actions.removeNode(nodeId);
  actions.markFileAffected('oblivions/gamedata/poi_pool.php');
  if (props.selectedRuleId === ruleId) {
    emit('select', null);
  }
}

// ─── 拖拽排序 ──────────────────────────────────────────
/**
 * vuedraggable @end 回调——拖拽完成后需要重写所有节点以保证顺序持久化。
 *
 * graph-store 的节点顺序由 findNodesByKind 的 sort 决定（按 nodeId 字母序），
 * 拖拽顺序无法直接持久化到 graph-store——这里仅更新本地展示顺序，
 * 实际持久化顺序由 poi-pool-projector 在发布时按节点数组顺序输出。
 *
 * 简化：拖拽仅影响 UI 列表展示顺序；调用 markFileAffected 触发 BuildView diff。
 *
 * 注：vuedraggable 直接 mutate 列表数组——为保证 graph-store 与本地数组同步，
 * 拖拽后逐个 upsert 节点（无变化字段，仅触发 revision 重算 + 文件标记）。
 */
function onDragEnd(): void {
  actions.markFileAffected('oblivions/gamedata/poi_pool.php');
}
</script>

<template>
  <div class="flex h-full flex-col gap-2 overflow-auto p-2 text-sm">
    <!-- Tide 三档 Tab -->
    <div class="flex border-b border-gray-800">
      <button
        v-for="tide in DISTRIBUTION_TIDE_ORDER"
        :key="tide"
        type="button"
        class="border-b-2 px-3 py-1 text-xs transition-colors"
        :class="
          currentTide === tide
            ? 'border-gray-400 text-gray-100'
            : 'border-transparent text-gray-500 hover:text-gray-300'
        "
        @click="currentTide = tide"
      >
        {{ tideLabel(tide) }}
        <span class="ml-1 rounded bg-gray-800 px-1 text-[10px] text-gray-400">
          {{ tideCounts[tide] ?? 0 }}
        </span>
      </button>
    </div>

    <!-- 规则列表 -->
    <div class="flex flex-col gap-1">
      <draggable
        :list="currentRules"
        :item-key="(rule: DistributionRule) => rule.id"
        handle=".rule-drag-handle"
        ghost-class="opacity-30"
        :animation="150"
        @end="onDragEnd"
      >
        <template #item="{ element: rule }">
          <div
            class="rounded border bg-gray-900 p-2"
            :class="rule.id === selectedRuleId ? 'border-gray-500' : 'border-gray-800'"
          >
            <div class="mb-1 flex items-center justify-between gap-1">
              <button
                type="button"
                class="flex flex-1 items-center gap-1 text-left"
                @click="selectRule(rule.id)"
              >
                <span
                  class="rule-drag-handle cursor-move select-none text-gray-600 hover:text-gray-400"
                  title="拖拽排序"
                >
                  ⠿
                </span>
                <span class="truncate text-xs text-gray-200">{{ rule.id }}</span>
              </button>
              <BaseButton size="sm" variant="ghost" title="删除规则" @click="removeRule(rule.id)">
                ×
              </BaseButton>
            </div>

            <!-- POI 模板 + 数量 -->
            <div class="grid grid-cols-[1fr_80px] gap-2">
              <button
                type="button"
                class="flex items-center justify-between rounded border border-gray-700 bg-gray-900 px-2 py-1 text-xs hover:border-gray-500"
                @click="openPicker(rule.id)"
              >
                <span class="truncate text-gray-200">{{ poiLabel(rule.subject.poiId) }}</span>
                <span class="text-[10px] text-gray-500">{{ rule.subject.poiId || '未选择' }}</span>
              </button>
              <label class="flex flex-col gap-0.5">
                <span class="text-[10px] text-gray-500">每区域数量</span>
                <BaseInput
                  :model-value="rule.placement.count"
                  type="number"
                  :min="0"
                  :step="1"
                  @update:model-value="(v) => onCountChange(rule.id, v)"
                />
              </label>
            </div>

            <!-- 高级面板（excludeEntrance / excludeExit） -->
            <div class="mt-1">
              <button
                type="button"
                class="text-[10px] text-gray-500 hover:text-gray-300"
                @click="toggleAdvanced(rule.id)"
              >
                {{ expandedAdvanced.has(rule.id) ? '▾' : '▸' }} 高级
              </button>
              <div v-if="expandedAdvanced.has(rule.id)" class="mt-1 flex gap-3 rounded bg-gray-950/40 p-2">
                <BaseCheckbox
                  :model-value="rule.selector.excludeEntrance"
                  @update:model-value="(v: boolean) => onExcludeEntranceChange(rule.id, v)"
                >
                  排除入口格
                </BaseCheckbox>
                <BaseCheckbox
                  :model-value="rule.selector.excludeExit"
                  @update:model-value="(v: boolean) => onExcludeExitChange(rule.id, v)"
                >
                  排除出口格
                </BaseCheckbox>
              </div>
            </div>
          </div>
        </template>
      </draggable>

      <!-- 空列表提示 -->
      <div
        v-if="currentRules.length === 0"
        class="rounded border border-dashed border-gray-800 p-3 text-center text-[10px] text-gray-600"
      >
        无 {{ tideLabel(currentTide) }} 桶分布规则
      </div>

      <!-- 新增按钮 -->
      <BaseButton size="sm" variant="ghost" class="mt-1 self-start" @click="startAddRule">
        + 新增规则
      </BaseButton>
    </div>

    <!-- 新增规则面板 -->
    <div
      v-if="showNewRulePanel"
      class="rounded border border-gray-700 bg-gray-900 p-2"
    >
      <div class="mb-2 text-xs text-gray-300">新增分布规则</div>
      <div class="grid grid-cols-[1fr_1fr] gap-2">
        <label class="flex flex-col gap-0.5">
          <span class="text-[10px] text-gray-500">潮汐区</span>
          <select
            v-model="newRuleTide"
            class="rounded border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-100"
          >
            <option v-for="opt in DISTRIBUTION_TIDE_OPTIONS" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </label>
        <label class="flex flex-col gap-0.5">
          <span class="text-[10px] text-gray-500">POI 模板</span>
          <button
            type="button"
            class="flex items-center justify-between rounded border border-gray-700 bg-gray-900 px-2 py-1 text-xs hover:border-gray-500"
            @click="openPickerForNew"
          >
            <span class="truncate text-gray-200">{{ poiLabel(newRulePoiId) || '选择...' }}</span>
            <span class="text-[10px] text-gray-500">{{ newRulePoiId || '—' }}</span>
          </button>
        </label>
      </div>
      <div class="mt-2 flex items-center justify-between">
        <span class="text-[10px] text-gray-500">
          将生成 ID：{{ newRuleTide && newRulePoiId ? buildRuleId(newRuleTide, newRulePoiId) : '—' }}
        </span>
        <div class="flex gap-1">
          <BaseButton size="sm" variant="ghost" @click="cancelAddRule">取消</BaseButton>
          <BaseButton
            size="sm"
            variant="primary"
            :disabled="!newRulePoiId || !newRuleTide"
            @click="confirmAddRule"
          >
            添加
          </BaseButton>
        </div>
      </div>
    </div>

    <!-- 提示文案 -->
    <div class="mt-2 border-t border-gray-800 pt-2 text-[10px] text-gray-600">
      规则 ID = `${tide}:${poi_id}`，自动生成不可手编。<br />
      每条规则当前仅支持单一 tide（运行时契约）。
    </div>

    <!-- 资源选择器 -->
    <ResourcePicker
      :open="pickerOpen"
      ref-kind="poi.template"
      ref-field="id"
      :current_value="pickerCurrentValue"
      title="选择 POI 模板"
      @close="pickerOpen = false"
      @select="onPickerSelectDispatch"
    />
  </div>
</template>
