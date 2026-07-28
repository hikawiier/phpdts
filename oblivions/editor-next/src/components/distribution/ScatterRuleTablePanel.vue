<!-- @module O 内容工具箱 -->
<script setup lang="ts">
//
// ScatterRuleTablePanel：野生道具分布规则表视图（执行案 §4.5.2）
//
// 设计意图：
//   - 逐条编辑 distribution.scatter 的 selector / phase / placement，
//     按 tide × phase 矩阵分组（3 tide × 2 phase = 6 组）
//   - 每条规则：subject.item_id（资源选择器）+ phase + placement.rate + placement.count
//   - selector.tides 由 tide 桶隐式派生（当前运行时契约每条规则只有一个 tide）
//   - selector.excludeEntrance / excludeExit 在 scatter 不应用（运行时不查），不暴露
//   - 新增规则：先选 item_id + tide + phase，自动生成 id=`${tide}:${phase}:${item_id}`
//   - 删除规则：distribution.scatter 是叶子，直接删除（无 inbound 引用）
//   - 显示 effective_rate 派生字段（refresh 相位时 = rate × obl_config.wild_item_refresh_rate_by_tide[tide]）
//
// 三视图同步：选中规则时 emit('select', ruleId) 给父 DistributionView，
//   由父同步矩阵 / 叠层视图的高亮状态。
//

import { ref, computed } from 'vue';
import draggable from 'vuedraggable';
import { useGraphStore } from '@/graph/graph-store';
import { useConfigStore } from '@/stores/configStore';
import { useTemplateActions } from '@/composables/useTemplateActions';
import ResourcePicker from '@/components/templates/ResourcePicker.vue';
import BaseButton from '@/components/common/BaseButton.vue';
import BaseInput from '@/components/common/BaseInput.vue';
import {
  DISTRIBUTION_TIDE_OPTIONS,
  DISTRIBUTION_TIDE_ORDER,
  DISTRIBUTION_SCATTER_PHASE_OPTIONS,
  DISTRIBUTION_SCATTER_PHASE_ORDER,
  tideLabel,
  phaseLabel,
  buildScatterRuleId,
  createEmptyScatterRule,
  scatterRuleFromNode,
  dataFromScatterRule,
  type ScatterRule,
  type DistributionScatterData,
} from '@/schema/distribution-rule';
import type { ResourceNode } from '@/graph/types';

/**
 * scatter 相位——与 ScatterRule.phase 同步（'game_init' 开局 / 'day_refresh' 刷新）。
 *
 * 局部类型别名——schema/distribution-rule.ts 中 ScatterRule.phase 已声明为内联联合类型，
 * 此处复用同名导出避免在组件内多处重复声明。
 */
type ScatterPhase = 'game_init' | 'day_refresh';

const props = defineProps<{
  /** 当前选中的规则 ID（用于三视图同步高亮） */
  selectedRuleId: string | null;
}>();

const emit = defineEmits<{
  /** 选中某条规则——父组件同步矩阵 / 叠层视图 */
  select: [ruleId: string | null];
}>();

const graph = useGraphStore();
const config = useConfigStore();
const actions = useTemplateActions();

// ─── Tide × Phase Tab 状态 ─────────────────────────────────
const currentTide = ref<string>('shallow');
const currentPhase = ref<ScatterPhase>('game_init');

// ─── ResourcePicker 模态框状态 ──────────────────────────
const pickerOpen = ref(false);
const pickerForRuleId = ref<string | null>(null);

// ─── 新增规则模态状态 ────────────────────────────────────
const newRuleTide = ref<string>('shallow');
const newRulePhase = ref<ScatterPhase>('game_init');
const newRuleItemId = ref<string>('');
const showNewRulePanel = ref(false);

// ─── wild_item_refresh_rate_by_tide 倍率表（从 obl_config 读取） ──
/**
 * refresh 相位的 effective_rate = rate × wild_item_refresh_rate_by_tide[tide]。
 *
 * obl_config 未加载时退化为 1.0（不影响 initial 相位）。
 */
const refreshRateByTide = computed<Record<string, number>>(() => {
  const cfg = config.oblConfig as Record<string, unknown> | null;
  if (!cfg) return { shallow: 1, deep: 1, abyss: 1 };
  const raw = cfg['wild_item_refresh_rate_by_tide'];
  if (!raw || typeof raw !== 'object') return { shallow: 1, deep: 1, abyss: 1 };
  const result: Record<string, number> = { shallow: 1, deep: 1, abyss: 1 };
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'number') result[k] = v;
  }
  return result;
});

function effectiveRate(tide: string, phase: ScatterPhase, rate: number): number {
  if (phase !== 'day_refresh') return rate;
  return rate * (refreshRateByTide.value[tide] ?? 1);
}

// ─── 当前 tide × phase 桶下的规则列表 ────────────────────
/**
 * 当前 tide × phase 桶下的规则节点。
 *
 * 节点 id 形如 `${tide}:${phase}:${item_id}`，按 `${currentTide}:${currentPhase}:` 前缀过滤。
 */
const currentRuleNodes = computed<ResourceNode<DistributionScatterData>[]>(() => {
  const all = graph.findNodesByKind('distribution.scatter');
  const prefix = `${currentTide.value}:${currentPhase.value}:`;
  return all.filter(
    (n): n is ResourceNode<DistributionScatterData> => n.id.startsWith(prefix),
  );
});

const currentRules = computed<ScatterRule[]>(() =>
  currentRuleNodes.value.map((n) => scatterRuleFromNode(n)),
);

/**
 * 各 tide × phase 桶的条目数（Tab 徽标用）。
 */
const bucketCounts = computed<Record<string, number>>(() => {
  const counts: Record<string, number> = {};
  for (const tide of DISTRIBUTION_TIDE_ORDER) {
    for (const phase of DISTRIBUTION_SCATTER_PHASE_ORDER) {
      counts[`${tide}:${phase}`] = 0;
    }
  }
  const all = graph.findNodesByKind('distribution.scatter');
  for (const n of all) {
    const parts = n.id.split(':');
    const tide = parts[0];
    const phase = parts[1];
    if (typeof tide === 'string' && typeof phase === 'string') {
      const key = `${tide}:${phase}`;
      if (key in counts) counts[key]!++;
    }
  }
  return counts;
});

// ─── item.template 选项（中文名 fallback）──────────────────
const itemTemplateNodes = computed(() => graph.findNodesByKind('item.template'));

function itemLabel(itemId: string): string {
  if (!itemId) return '';
  const node = itemTemplateNodes.value.find((n) => n.id === itemId);
  if (!node) return itemId;
  const name = (node.data as { name?: string }).name;
  return name && typeof name === 'string' ? name : itemId;
}

// ─── 选中规则 ────────────────────────────────────────────
function selectRule(ruleId: string): void {
  emit('select', ruleId);
}

// ─── 字段更新 ────────────────────────────────────────────

/**
 * ScatterRule 局部补丁类型——允许 placement 内部字段单独更新。
 *
 * Partial<ScatterRule> 仅浅层可选，placement.rate / placement.count 仍为必填，
 * 此类型补充深层可选以支持 onRateChange / onCountChange 单字段更新。
 */
type ScatterRulePatch = Omit<Partial<ScatterRule>, 'placement'> & {
  placement?: Partial<ScatterRule['placement']>;
};

function updateRuleField(ruleId: string, patch: ScatterRulePatch): void {
  const nodeId = `distribution.scatter:${ruleId}`;
  const existing = graph.nodes.get(nodeId) as ResourceNode<DistributionScatterData> | undefined;
  if (!existing) return;
  const rule = scatterRuleFromNode(existing);
  const merged: ScatterRule = {
    id: rule.id,
    subject: { itemId: patch.subject?.itemId ?? rule.subject.itemId },
    selector: {
      tides: patch.selector?.tides ?? rule.selector.tides,
      regions: patch.selector?.regions ?? rule.selector.regions,
    },
    phase: patch.phase ?? rule.phase,
    placement: {
      rate: patch.placement?.rate ?? rule.placement.rate,
      count: patch.placement?.count ?? rule.placement.count,
    },
  };
  const data = dataFromScatterRule(merged);
  actions.upsertNode({
    kind: 'distribution.scatter',
    id: ruleId,
    data,
    source: existing.source,
    revision: '',
  });
}

function onRateChange(ruleId: string, value: string): void {
  const num = Number(value);
  if (Number.isNaN(num) || num < 0 || num > 1) return;
  updateRuleField(ruleId, { placement: { rate: num } });
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

// ─── ResourcePicker ───────────────────────────────────────
function openPicker(ruleId: string): void {
  pickerForRuleId.value = ruleId;
  pickerOpen.value = true;
}

function onPickerSelect(value: string): void {
  if (pickerForRuleId.value === null) return;
  // item_id 变更：直接更新字段（id 不变——id 改变等价于删除+新建）
  updateRuleField(pickerForRuleId.value, { subject: { itemId: value } });
  pickerForRuleId.value = null;
  pickerOpen.value = false;
}

// ─── 新增 / 删除规则 ─────────────────────────────────────
function startAddRule(): void {
  newRuleTide.value = currentTide.value;
  newRulePhase.value = currentPhase.value;
  newRuleItemId.value = '';
  showNewRulePanel.value = true;
}

function openPickerForNew(): void {
  pickerForRuleId.value = null; // null 表示新增模式
  pickerOpen.value = true;
}

function onPickerSelectForNew(value: string): void {
  newRuleItemId.value = value;
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
  if (pickerForRuleId.value === null) return newRuleItemId.value;
  const rule = currentRules.value.find((r) => r.id === pickerForRuleId.value);
  return rule?.subject.itemId ?? '';
});

function confirmAddRule(): void {
  if (!newRuleItemId.value || !newRuleTide.value) return;
  const ruleId = buildScatterRuleId(newRuleTide.value, newRulePhase.value, newRuleItemId.value);
  const existing = graph.nodes.get(`distribution.scatter:${ruleId}`);
  if (existing) {
    currentTide.value = newRuleTide.value;
    currentPhase.value = newRulePhase.value;
    emit('select', ruleId);
    showNewRulePanel.value = false;
    return;
  }
  const rule = createEmptyScatterRule(newRuleTide.value, newRulePhase.value, newRuleItemId.value);
  const data = dataFromScatterRule(rule);
  actions.upsertNode({
    kind: 'distribution.scatter',
    id: ruleId,
    data,
    source: [
      {
        filePath: 'oblivions/gamedata/scatter_pool.php',
        lineStart: 1,
        lineEnd: 1,
        format: 'php',
      },
    ],
    revision: '',
  });
  actions.markFileAffected('oblivions/gamedata/scatter_pool.php');
  currentTide.value = newRuleTide.value;
  currentPhase.value = newRulePhase.value;
  emit('select', ruleId);
  showNewRulePanel.value = false;
}

function cancelAddRule(): void {
  showNewRulePanel.value = false;
  newRuleItemId.value = '';
}

function removeRule(ruleId: string): void {
  const nodeId = `distribution.scatter:${ruleId}`;
  actions.removeNode(nodeId);
  actions.markFileAffected('oblivions/gamedata/scatter_pool.php');
  if (props.selectedRuleId === ruleId) {
    emit('select', null);
  }
}

// ─── 拖拽排序 ──────────────────────────────────────────
function onDragEnd(): void {
  actions.markFileAffected('oblivions/gamedata/scatter_pool.php');
}

// ─── count 显示文本（int 或 [min,max]） ──────────────────
function countDisplay(count: number | [number, number]): string {
  if (Array.isArray(count)) return `${count[0]}~${count[1]}`;
  return String(count);
}
</script>

<template>
  <div class="flex h-full flex-col gap-2 overflow-auto p-2 text-sm">
    <!-- Tide × Phase 矩阵 Tab -->
    <div class="flex flex-wrap gap-1 border-b border-gray-800 pb-1">
      <button
        v-for="tide in DISTRIBUTION_TIDE_ORDER"
        :key="`bucket-${tide}`"
        type="button"
        class="flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors"
        :class="
          currentTide === tide
            ? 'bg-gray-700 text-gray-100'
            : 'text-gray-400 hover:bg-gray-800'
        "
        @click="currentTide = tide"
      >
        {{ tideLabel(tide) }}
      </button>
    </div>
    <div class="flex flex-wrap gap-1">
      <button
        v-for="phase in DISTRIBUTION_SCATTER_PHASE_ORDER"
        :key="`bucket-${phase}`"
        type="button"
        class="rounded px-2 py-0.5 text-[11px] transition-colors"
        :class="
          currentPhase === phase
            ? 'bg-gray-800 text-gray-100'
            : 'text-gray-500 hover:bg-gray-800/50'
        "
        @click="currentPhase = phase"
      >
        {{ phaseLabel(phase) }}
        <span class="ml-1 text-[10px] text-gray-500">
          ({{ bucketCounts[`${currentTide}:${phase}`] ?? 0 }})
        </span>
      </button>
    </div>

    <!-- 规则列表 -->
    <div class="flex flex-col gap-1">
      <draggable
        :list="currentRules"
        :item-key="(rule: ScatterRule) => rule.id"
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

            <!-- 道具 + 数量 + 生成率 -->
            <div class="grid grid-cols-[1fr_80px_80px] gap-2">
              <button
                type="button"
                class="flex items-center justify-between rounded border border-gray-700 bg-gray-900 px-2 py-1 text-xs hover:border-gray-500"
                @click="openPicker(rule.id)"
              >
                <span class="truncate text-gray-200">{{ itemLabel(rule.subject.itemId) }}</span>
                <span class="text-[10px] text-gray-500">{{ rule.subject.itemId || '未选择' }}</span>
              </button>
              <label class="flex flex-col gap-0.5">
                <span class="text-[10px] text-gray-500">基础率</span>
                <BaseInput
                  :model-value="rule.placement.rate"
                  type="number"
                  :min="0"
                  :max="1"
                  :step="0.01"
                  @update:model-value="(v) => onRateChange(rule.id, v)"
                />
              </label>
              <label class="flex flex-col gap-0.5">
                <span class="text-[10px] text-gray-500">数量</span>
                <BaseInput
                  :model-value="countDisplay(rule.placement.count)"
                  type="text"
                  @update:model-value="(v) => onCountChange(rule.id, v)"
                />
              </label>
            </div>

            <!-- effective_rate 派生字段（refresh 相位） -->
            <div
              v-if="rule.phase === 'day_refresh'"
              class="mt-1 text-[10px] text-gray-500"
            >
              effective_rate = {{ rule.placement.rate.toFixed(2) }} ×
              {{ refreshRateByTide[rule.selector.tides[0] ?? ''] ?? 1 }} =
              <span class="text-gray-300">
                {{ effectiveRate(rule.selector.tides[0] ?? '', rule.phase, rule.placement.rate).toFixed(3) }}
              </span>
              （运行时 clamp 到 [0,1]）
            </div>
          </div>
        </template>
      </draggable>

      <!-- 空列表提示 -->
      <div
        v-if="currentRules.length === 0"
        class="rounded border border-dashed border-gray-800 p-3 text-center text-[10px] text-gray-600"
      >
        无 {{ tideLabel(currentTide) }} · {{ phaseLabel(currentPhase) }} 桶分布规则
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
      <div class="mb-2 text-xs text-gray-300">新增野生道具分布规则</div>
      <div class="grid grid-cols-[1fr_1fr_1fr] gap-2">
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
          <span class="text-[10px] text-gray-500">相位</span>
          <select
            v-model="newRulePhase"
            class="rounded border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-100"
          >
            <option v-for="opt in DISTRIBUTION_SCATTER_PHASE_OPTIONS" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </label>
        <label class="flex flex-col gap-0.5">
          <span class="text-[10px] text-gray-500">道具模板</span>
          <button
            type="button"
            class="flex items-center justify-between rounded border border-gray-700 bg-gray-900 px-2 py-1 text-xs hover:border-gray-500"
            @click="openPickerForNew"
          >
            <span class="truncate text-gray-200">{{ itemLabel(newRuleItemId) || '选择...' }}</span>
            <span class="text-[10px] text-gray-500">{{ newRuleItemId || '—' }}</span>
          </button>
        </label>
      </div>
      <div class="mt-2 flex items-center justify-between">
        <span class="text-[10px] text-gray-500">
          将生成 ID：
          {{ newRuleTide && newRulePhase && newRuleItemId
            ? buildScatterRuleId(newRuleTide, newRulePhase, newRuleItemId)
            : '—' }}
        </span>
        <div class="flex gap-1">
          <BaseButton size="sm" variant="ghost" @click="cancelAddRule">取消</BaseButton>
          <BaseButton
            size="sm"
            variant="primary"
            :disabled="!newRuleItemId || !newRuleTide"
            @click="confirmAddRule"
          >
            添加
          </BaseButton>
        </div>
      </div>
    </div>

    <!-- 提示文案 -->
    <div class="mt-2 border-t border-gray-800 pt-2 text-[10px] text-gray-600">
      规则 ID = `${tide}:${phase}:${item_id}`，自动生成不可手编。<br />
      refresh 相位的 effective_rate = rate × obl_config.wild_item_refresh_rate_by_tide[tide]。
    </div>

    <!-- 资源选择器 -->
    <ResourcePicker
      :open="pickerOpen"
      ref-kind="item.template"
      ref-field="id"
      :current_value="pickerCurrentValue"
      title="选择道具模板"
      @close="pickerOpen = false"
      @select="onPickerSelectDispatch"
    />
  </div>
</template>
