<!-- @module O 内容工具箱 -->
<script setup lang="ts">
//
// EnemyRuleTablePanel：敌人分布规则表视图（执行案 §4.5.3）
//
// 设计意图：
//   - 逐条编辑 distribution.enemy 的 selector / placement，按 tide 桶分组
//     （shallow / deep / abyss）
//   - 每条规则：subject.enemy_type（资源选择器）+ placement.count（int 或 [min,max]）
//   - selector.tides 由 tide 桶隐式派生（当前运行时契约每条规则只有一个 tide）
//   - selector.excludeEntrance / excludeExit / excludeOccupied 默认 true，折叠在"高级"面板
//   - 新增规则：先选 enemy_type + tide，自动生成 id=`${tide}:${enemy_type}`
//   - 删除规则：distribution.enemy 是叶子，直接删除（无 inbound 引用）
//   - 显示"注释漂移"提示：若代码注释与实际 count 不一致，由 O-10 校验报告
//     distribution.enemy.comment_data_drift warning（本面板不重复校验，仅占位提示）
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
  buildEnemyRuleId,
  createEmptyEnemyRule,
  enemyRuleFromNode,
  dataFromEnemyRule,
  type EnemyRule,
  type DistributionEnemyData,
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
const newRuleEnemyType = ref<string>('');
const showNewRulePanel = ref(false);

// ─── 当前 tide 桶下的规则列表 ──────────────────────────
const currentRuleNodes = computed<ResourceNode<DistributionEnemyData>[]>(() => {
  const all = graph.findNodesByKind('distribution.enemy');
  return all.filter(
    (n): n is ResourceNode<DistributionEnemyData> =>
      n.id.startsWith(`${currentTide.value}:`),
  );
});

const currentRules = computed<EnemyRule[]>(() =>
  currentRuleNodes.value.map((n) => enemyRuleFromNode(n)),
);

const tideCounts = computed<Record<string, number>>(() => {
  const counts: Record<string, number> = { shallow: 0, deep: 0, abyss: 0 };
  const all = graph.findNodesByKind('distribution.enemy');
  for (const n of all) {
    const parts = n.id.split(':');
    const tide = parts[0];
    if (tide !== undefined && tide in counts) counts[tide]!++;
  }
  return counts;
});

// ─── enemy.template 选项（中文名 fallback）──────────────────
const enemyTemplateNodes = computed(() => graph.findNodesByKind('enemy.template'));

function enemyLabel(enemyType: string): string {
  if (!enemyType) return '';
  const node = enemyTemplateNodes.value.find((n) => n.id === enemyType);
  if (!node) return enemyType;
  const name = (node.data as { name?: string }).name;
  return name && typeof name === 'string' ? name : enemyType;
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
function updateRuleField(ruleId: string, patch: Partial<EnemyRule>): void {
  const nodeId = `distribution.enemy:${ruleId}`;
  const existing = graph.nodes.get(nodeId) as ResourceNode<DistributionEnemyData> | undefined;
  if (!existing) return;
  const rule = enemyRuleFromNode(existing);
  const merged: EnemyRule = {
    id: rule.id,
    subject: { enemyType: patch.subject?.enemyType ?? rule.subject.enemyType },
    selector: {
      tides: patch.selector?.tides ?? rule.selector.tides,
      regions: patch.selector?.regions ?? rule.selector.regions,
      excludeEntrance: patch.selector?.excludeEntrance ?? rule.selector.excludeEntrance,
      excludeExit: patch.selector?.excludeExit ?? rule.selector.excludeExit,
      excludeOccupied: patch.selector?.excludeOccupied ?? rule.selector.excludeOccupied,
    },
    placement: { count: patch.placement?.count ?? rule.placement.count },
  };
  const data = dataFromEnemyRule(merged);
  actions.upsertNode({
    kind: 'distribution.enemy',
    id: ruleId,
    data,
    source: existing.source,
    revision: '',
  });
}

function onCountChange(ruleId: string, value: string): void {
  const trimmed = value.trim();
  // 区间格式 `min~max` 或 `min-max`
  const rangeMatch = trimmed.match(/^(\d+)\s*[~-]\s*(\d+)$/);
  if (rangeMatch) {
    const lo = Number(rangeMatch[1]);
    const hi = Number(rangeMatch[2]);
    if (Number.isNaN(lo) || Number.isNaN(hi) || lo < 0 || hi < lo) return;
    updateRuleField(ruleId, { placement: { count: [lo, hi] } });
    return;
  }
  const num = Number(trimmed);
  if (Number.isNaN(num) || num < 0) return;
  updateRuleField(ruleId, { placement: { count: Math.floor(num) } });
}

function onExcludeEntranceChange(ruleId: string, value: boolean): void {
  updateRuleField(ruleId, { selector: { excludeEntrance: value } } as Partial<EnemyRule>);
}

function onExcludeExitChange(ruleId: string, value: boolean): void {
  updateRuleField(ruleId, { selector: { excludeExit: value } } as Partial<EnemyRule>);
}

function onExcludeOccupiedChange(ruleId: string, value: boolean): void {
  updateRuleField(ruleId, { selector: { excludeOccupied: value } } as Partial<EnemyRule>);
}

// ─── ResourcePicker ───────────────────────────────────────
function openPicker(ruleId: string): void {
  pickerForRuleId.value = ruleId;
  pickerOpen.value = true;
}

function onPickerSelect(value: string): void {
  if (pickerForRuleId.value === null) return;
  updateRuleField(pickerForRuleId.value, { subject: { enemyType: value } });
  pickerForRuleId.value = null;
  pickerOpen.value = false;
}

// ─── 新增 / 删除规则 ─────────────────────────────────────
function startAddRule(): void {
  newRuleTide.value = currentTide.value;
  newRuleEnemyType.value = '';
  showNewRulePanel.value = true;
}

function openPickerForNew(): void {
  pickerForRuleId.value = null;
  pickerOpen.value = true;
}

function onPickerSelectForNew(value: string): void {
  newRuleEnemyType.value = value;
  pickerForRuleId.value = null;
  pickerOpen.value = false;
}

function onPickerSelectDispatch(value: string): void {
  if (pickerForRuleId.value === null) {
    onPickerSelectForNew(value);
  } else {
    onPickerSelect(value);
  }
}

const pickerCurrentValue = computed<string>(() => {
  if (pickerForRuleId.value === null) return newRuleEnemyType.value;
  const rule = currentRules.value.find((r) => r.id === pickerForRuleId.value);
  return rule?.subject.enemyType ?? '';
});

function confirmAddRule(): void {
  if (!newRuleEnemyType.value || !newRuleTide.value) return;
  const ruleId = buildEnemyRuleId(newRuleTide.value, newRuleEnemyType.value);
  const existing = graph.nodes.get(`distribution.enemy:${ruleId}`);
  if (existing) {
    currentTide.value = newRuleTide.value;
    emit('select', ruleId);
    showNewRulePanel.value = false;
    return;
  }
  const rule = createEmptyEnemyRule(newRuleTide.value, newRuleEnemyType.value);
  const data = dataFromEnemyRule(rule);
  actions.upsertNode({
    kind: 'distribution.enemy',
    id: ruleId,
    data,
    source: [
      {
        filePath: 'oblivions/gamedata/enemy_pool.php',
        lineStart: 1,
        lineEnd: 1,
        format: 'php',
      },
    ],
    revision: '',
  });
  actions.markFileAffected('oblivions/gamedata/enemy_pool.php');
  currentTide.value = newRuleTide.value;
  emit('select', ruleId);
  showNewRulePanel.value = false;
}

function cancelAddRule(): void {
  showNewRulePanel.value = false;
  newRuleEnemyType.value = '';
}

function removeRule(ruleId: string): void {
  const nodeId = `distribution.enemy:${ruleId}`;
  actions.removeNode(nodeId);
  actions.markFileAffected('oblivions/gamedata/enemy_pool.php');
  if (props.selectedRuleId === ruleId) {
    emit('select', null);
  }
}

function onDragEnd(): void {
  actions.markFileAffected('oblivions/gamedata/enemy_pool.php');
}

function countDisplay(count: number | [number, number]): string {
  if (Array.isArray(count)) return `${count[0]}~${count[1]}`;
  return String(count);
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
        :item-key="(rule: EnemyRule) => rule.id"
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
                >⠿</span>
                <span class="truncate text-xs text-gray-200">{{ rule.id }}</span>
              </button>
              <BaseButton size="sm" variant="ghost" title="删除规则" @click="removeRule(rule.id)">
                ×
              </BaseButton>
            </div>

            <!-- 敌人模板 + 数量 -->
            <div class="grid grid-cols-[1fr_100px] gap-2">
              <button
                type="button"
                class="flex items-center justify-between rounded border border-gray-700 bg-gray-900 px-2 py-1 text-xs hover:border-gray-500"
                @click="openPicker(rule.id)"
              >
                <span class="truncate text-gray-200">{{ enemyLabel(rule.subject.enemyType) }}</span>
                <span class="text-[10px] text-gray-500">{{ rule.subject.enemyType || '未选择' }}</span>
              </button>
              <label class="flex flex-col gap-0.5">
                <span class="text-[10px] text-gray-500">每区域数量</span>
                <BaseInput
                  :model-value="countDisplay(rule.placement.count)"
                  type="text"
                  @update:model-value="(v) => onCountChange(rule.id, v)"
                />
              </label>
            </div>

            <!-- 高级面板（excludeEntrance / excludeExit / excludeOccupied） -->
            <div class="mt-1">
              <button
                type="button"
                class="text-[10px] text-gray-500 hover:text-gray-300"
                @click="toggleAdvanced(rule.id)"
              >
                {{ expandedAdvanced.has(rule.id) ? '▾' : '▸' }} 高级
              </button>
              <div v-if="expandedAdvanced.has(rule.id)" class="mt-1 flex flex-wrap gap-3 rounded bg-gray-950/40 p-2">
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
                <BaseCheckbox
                  :model-value="rule.selector.excludeOccupied"
                  @update:model-value="(v: boolean) => onExcludeOccupiedChange(rule.id, v)"
                >
                  排除已占用格
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
        无 {{ tideLabel(currentTide) }} 桶敌人分布规则
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
      <div class="mb-2 text-xs text-gray-300">新增敌人分布规则</div>
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
          <span class="text-[10px] text-gray-500">敌人模板</span>
          <button
            type="button"
            class="flex items-center justify-between rounded border border-gray-700 bg-gray-900 px-2 py-1 text-xs hover:border-gray-500"
            @click="openPickerForNew"
          >
            <span class="truncate text-gray-200">{{ enemyLabel(newRuleEnemyType) || '选择...' }}</span>
            <span class="text-[10px] text-gray-500">{{ newRuleEnemyType || '—' }}</span>
          </button>
        </label>
      </div>
      <div class="mt-2 flex items-center justify-between">
        <span class="text-[10px] text-gray-500">
          将生成 ID：{{ newRuleTide && newRuleEnemyType ? buildEnemyRuleId(newRuleTide, newRuleEnemyType) : '—' }}
        </span>
        <div class="flex gap-1">
          <BaseButton size="sm" variant="ghost" @click="cancelAddRule">取消</BaseButton>
          <BaseButton
            size="sm"
            variant="primary"
            :disabled="!newRuleEnemyType || !newRuleTide"
            @click="confirmAddRule"
          >
            添加
          </BaseButton>
        </div>
      </div>
    </div>

    <!-- 提示文案 -->
    <div class="mt-2 border-t border-gray-800 pt-2 text-[10px] text-gray-600">
      规则 ID = `${tide}:${enemy_type}`，自动生成不可手编。<br />
      注释漂移由 O-10 校验 distribution.enemy.comment_data_drift 报告（warning 级别）。
    </div>

    <!-- 资源选择器 -->
    <ResourcePicker
      :open="pickerOpen"
      ref-kind="enemy.template"
      ref-field="id"
      :current_value="pickerCurrentValue"
      title="选择敌人模板"
      @close="pickerOpen = false"
      @select="onPickerSelectDispatch"
    />
  </div>
</template>
