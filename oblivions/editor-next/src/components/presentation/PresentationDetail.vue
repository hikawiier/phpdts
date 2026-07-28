<!-- @module O 内容工具箱 -->
<script setup lang="ts">
//
// PresentationDetail：呈现工作区右栏四段式详情面板（P3 §4.6.1）
//
// 四段组织（对齐执行案 §4.6.1 + presentation-poi.ts schema detailGroups）：
//   1. 定义：presentation.poi.name / desc 可编辑（SchemaField）
//   2. 后端 fallback：poi.template 的 name / desc 只读展示（deprecated 字段）
//   3. 最终值：previewPoiName / previewPoiDesc 调用结果——前端 fallback 链的
//      纯函数版本，复刻 vex-vue/src/data/poi-locale.ts getPoiName/getPoiDesc 逻辑
//   4. 诊断：缺失 / fallback 冗余 / 孤儿 / 不一致 状态徽章 + POI 分类标签
//
// 字段编辑流：
//   - SchemaField v-model 写入 → onFieldUpdate → useTemplateActions.upsertNode
//   - graph-store 节点变更触发响应式重算，"最终值"段实时反映编辑结果
//
// 跨 kind 关联查询：
//   - 通过 inbound renders_as 边定位 poi.template 节点（同 ID）
//   - poi.template 字段（searchable / mechanic / dismantle_returns / repeatable）
//     派生 POI 分类标签（可搜刮 / 机制型 / 工作台 / 可拆除 / 可重复）
//
// 渲染预览简化决策（执行案 §4.6.1）：
//   - 原方案 iframe + postMessage 隔离调用 vex-vue 的 getPoiName/getPoiDesc
//   - compass 确认这两个函数是纯函数（不依赖 Vue 响应式、无副作用）
//   - 但 editor-next 的 tsconfig.json include 不覆盖 vex-vue/src/data/，
//     直接 import 会触发 vue-tsc 类型检查失败
//   - 简化为：复刻 fallback 链逻辑（3 行代码），数据源改为 graph-store 中的
//     presentation.poi + poi.template 节点。语义完全等价，无运行时差异
//

import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useGraphStore } from '@/graph/graph-store';
import { useTemplateActions } from '@/composables/useTemplateActions';
import type { ResourceNode } from '@/graph/types';
import type { FieldSchema } from '@/shared';
import SchemaField from '@/components/config-editors/SchemaField.vue';

const props = defineProps<{
  /** 当前选中节点 ID（${kind}:${id} 格式，kind='presentation.poi'|'presentation.enemy'|...） */
  nodeId: string | null;
}>();

const emit = defineEmits<{
  /** 请求导航到另一节点（点击 backend template 链接时触发） */
  navigate: [nodeId: string];
}>();

const { t } = useI18n();
const graph = useGraphStore();
const actions = useTemplateActions();

/**
 * 当前选中的 presentation 节点（poi / enemy / item / recipe）。
 */
const presentationNode = computed<ResourceNode | null>(() => {
  if (!props.nodeId) return null;
  return graph.nodes.get(props.nodeId) ?? null;
});

/**
 * 通过 inbound renders_as 边查找关联的后端 template 节点。
 *
 * renders_as 边方向：xxx.template → presentation.xxx（同 ID 自动构建）。
 * 所以 presentation.* 的 inbound renders_as 边的 from 即 xxx.template 节点 ID。
 *
 * P3 阶段仅 POI 使用此组件；P4 扩展至 enemy——变量名从 poiTemplateNode 改为
 * backendTemplateNode 以反映通用语义。poi.template / enemy.template 都通过此
 * computed 查询，data 形状按 POI 字段集合定义，enemy.template 仅使用 name/desc
 * 子集（其他 POI 字段在 enemy 上不存在，categoryTags 派生自动跳过）。
 */
const backendTemplateNode = computed<ResourceNode | null>(() => {
  if (!props.nodeId) return null;
  const inbound = graph.getInbound(props.nodeId);
  const rendersAsEdge = inbound.find((e) => e.type === 'renders_as');
  if (!rendersAsEdge) return null;
  return graph.nodes.get(rendersAsEdge.from) ?? null;
});

/**
 * 是否为 POI kind——决定是否派生 POI 分类标签。
 */
const isPoiKind = computed(() => presentationNode.value?.kind === 'presentation.poi');

/**
 * 是否为 enemy kind——决定诊断段提示文案与最终值段说明文案。
 */
const isEnemyKind = computed(() => presentationNode.value?.kind === 'presentation.enemy');

/**
 * 空状态提示文案——按 kind 选择 i18n key。
 */
const emptyHintKey = computed<string>(() => {
  if (isPoiKind.value) return 'presentation.emptyHintPoi';
  if (isEnemyKind.value) return 'presentation.emptyHintEnemy';
  return 'presentation.emptyHintOther';
});

/**
 * 是否为孤儿——无关联后端 template（renders_as 边缺失）。
 */
const isOrphan = computed(() => presentationNode.value !== null && backendTemplateNode.value === null);

// ─── 段 1：定义（可编辑 name / desc）──────────────────────────

const nameFieldSchema: FieldSchema = {
  key: 'name',
  label: '中文名',
  type: 'text',
  required: true,
  placeholder: '如：补给储藏箱',
};

const descFieldSchema: FieldSchema = {
  key: 'desc',
  label: '中文描述',
  type: 'text',
  required: true,
  placeholder: 'POI 中文描述',
};

/**
 * 字段更新——SchemaField v-model 写入触发。
 *
 * 把字段值合并到 presentation.poi.data，调用 upsertNode 更新 graph-store。
 * 受影响文件（vex-vue/src/data/poi-locale.ts）由 useTemplateActions 内部登记。
 */
function onFieldUpdate(fieldKey: string, value: unknown): void {
  if (!presentationNode.value) return;
  const newData = {
    ...(presentationNode.value.data as Record<string, unknown>),
    [fieldKey]: value,
  };
  actions.upsertNode({
    kind: presentationNode.value.kind,
    id: presentationNode.value.id,
    data: newData,
    source: presentationNode.value.source,
    revision: '',
  });
}

// ─── 段 2：后端 fallback（poi.template 的 name / desc 只读）──────────

interface PoiTemplateData {
  name?: string;
  desc?: string;
  searchable?: boolean;
  repeatable?: boolean;
  mechanic?: string;
  dismantle_returns?: Array<{ item_id: string; count?: number }>;
  [key: string]: unknown;
}

const poiTemplateData = computed<PoiTemplateData | null>(() => {
  if (!backendTemplateNode.value) return null;
  return backendTemplateNode.value.data as PoiTemplateData;
});

const backendFallbackName = computed<string>(() => {
  return poiTemplateData.value?.name ?? '';
});

const backendFallbackDesc = computed<string>(() => {
  return poiTemplateData.value?.desc ?? '';
});

// ─── 段 3：最终值（previewPoiName / previewPoiDesc 调用结果）──────────

/**
 * 当前 presentation.poi 节点的 name / desc（响应式）。
 */
const localeName = computed<string>(() => {
  if (!presentationNode.value) return '';
  const data = presentationNode.value.data as { name?: string };
  return typeof data.name === 'string' ? data.name : '';
});

const localeDesc = computed<string>(() => {
  if (!presentationNode.value) return '';
  const data = presentationNode.value.data as { desc?: string };
  return typeof data.desc === 'string' ? data.desc : '';
});

/**
 * 复刻 vex-vue/src/data/poi-locale.ts getPoiName 的 fallback 链：
 *   POI_LOCALE[poiId]?.name || fallbackName || poiId
 *
 * 数据源替换为 graph-store 中的 presentation.poi + poi.template 节点——
 * 语义完全等价，无需 import vex-vue 模块（避免 tsconfig include 跨项目问题）。
 */
const finalName = computed<string>(() => {
  const poiId = presentationNode.value?.id ?? '';
  return localeName.value || backendFallbackName.value || poiId;
});

/**
 * 复刻 getPoiDesc 的 fallback 链：
 *   POI_LOCALE[poiId]?.desc || fallbackDesc || ''
 */
const finalDesc = computed<string>(() => {
  return localeDesc.value || backendFallbackDesc.value || '';
});

// ─── 段 4：诊断 + POI 分类标签 ──────────────────────────────────

/**
 * 是否为 fallback 冗余——locale name/desc 与后端 fallback 完全相同。
 *
 * 对齐 Dian O-9 边界案例："内容不一致"指前端 locale 与后端 fallback 文本完全相同
 * 的条目（冗余但无害），warning 级。这里命名为 fallbackRedundant 更准确。
 */
const isFallbackRedundant = computed<boolean>(() => {
  if (!backendTemplateNode.value) return false;
  if (!localeName.value && !localeDesc.value) return false;
  return (
    localeName.value === backendFallbackName.value &&
    localeDesc.value === backendFallbackDesc.value
  );
});

/**
 * 是否为缺失——name 或 desc 为空。
 */
const isMissing = computed<boolean>(() => {
  return localeName.value === '' || localeDesc.value === '';
});

/**
 * 是否为不一致——locale 与 fallback 不同（且非缺失、非孤儿）。
 *
 * 这是正常情况——用户主动定制了中文文案。filter "只看不一致" 用于查看哪些
 * POI 的 locale 已经被人工修改过。
 */
const isInconsistent = computed<boolean>(() => {
  if (!backendTemplateNode.value) return false;
  if (isMissing.value || isFallbackRedundant.value) return false;
  return (
    localeName.value !== backendFallbackName.value ||
    localeDesc.value !== backendFallbackDesc.value
  );
});

/**
 * POI 分类标签（执行案 §4.6.2）——派生自 poi.template 字段。
 *
 * 5 类标签（灰阶小标签渲染）：
 *   - 可搜刮：searchable=true（E-10 三档判定入口）
 *   - 机制型：mechanic 非空（max_hp_up / learn_skill / craft_source / interact_*）
 *   - 工作台：mechanic=craft_source（提供合成能力）
 *   - 可拆除：dismantle_returns 非空（poi.dismantle 命令）
 *   - 可重复：repeatable=true（重复搜索）
 */
interface CategoryTag {
  label: string;
  title: string;
}

const categoryTags = computed<CategoryTag[]>(() => {
  if (!poiTemplateData.value) return [];
  const tags: CategoryTag[] = [];
  const data = poiTemplateData.value;

  if (data.searchable === true) {
    tags.push({ label: '可搜刮', title: 'searchable=true · E-10 三档判定入口' });
  }
  if (typeof data.mechanic === 'string' && data.mechanic !== '') {
    tags.push({ label: '机制型', title: `mechanic=${data.mechanic}` });
  }
  if (data.mechanic === 'craft_source') {
    tags.push({ label: '工作台', title: 'mechanic=craft_source · 提供合成能力' });
  }
  if (Array.isArray(data.dismantle_returns) && data.dismantle_returns.length > 0) {
    tags.push({ label: '可拆除', title: `dismantle_returns ×${data.dismantle_returns.length}` });
  }
  if (data.repeatable === true) {
    tags.push({ label: '可重复', title: 'repeatable=true · 重复搜索' });
  }
  return tags;
});

/**
 * 点击 backend template 链接——派发 navigate 事件，由父组件切换视图或弹出详情。
 *
 * 派发的 nodeId 形如 `poi.template:${id}` / `enemy.template:${id}`，由父组件
 * PresentationView.onDetailNavigate 解析。当前 PresentationView 仅接受
 * presentation.* kind 的导航目标，所以点击 template 链接会被忽略——这是
 * 既定行为（template 由模板工作区管理）。
 */
function onTemplateNavigate(): void {
  if (!backendTemplateNode.value) return;
  emit('navigate', `${backendTemplateNode.value.kind}:${backendTemplateNode.value.id}`);
}
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden">
    <div v-if="!presentationNode" class="flex h-full items-center justify-center text-xs text-gray-600">
      {{ t(emptyHintKey) }}
    </div>

    <div v-else class="flex flex-col gap-3 overflow-auto p-2">
      <!-- 节点头部 -->
      <div class="rounded border border-gray-800 bg-gray-900 p-2">
        <div class="flex items-center gap-2">
          <span class="rounded bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-400">{{ presentationNode.kind }}</span>
          <span class="font-mono text-sm text-gray-100">{{ presentationNode.id }}</span>
        </div>
        <div class="mt-1 text-[10px] text-gray-600">
          revision: {{ presentationNode.revision.slice(0, 8) }} · source: {{ presentationNode.source.length }} 个
        </div>
        <!-- POI 分类标签（灰阶小标签，对齐 DESIGN.md 2.15）——仅 POI kind 派生非空 -->
        <div v-if="categoryTags.length > 0" class="mt-2 flex flex-wrap gap-1">
          <span
            v-for="(tag, idx) in categoryTags"
            :key="idx"
            :title="tag.title"
            class="rounded border border-gray-700 bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-300"
          >
            {{ tag.label }}
          </span>
        </div>
      </div>

      <!-- ─── 段 1：定义 ─────────────────────────────── -->
      <section class="flex flex-col gap-1">
        <h3 class="border-b border-gray-800 pb-1 text-xs font-semibold text-gray-300">定义</h3>
        <div class="flex flex-col gap-2 rounded border border-gray-800 bg-gray-900 p-2">
          <div class="text-[10px] uppercase tracking-wider text-gray-500">{{ presentationNode.kind }}</div>
          <SchemaField
            :schema="nameFieldSchema"
            :model-value="localeName"
            @update:model-value="(v) => onFieldUpdate('name', v)"
          />
          <SchemaField
            :schema="descFieldSchema"
            :model-value="localeDesc"
            @update:model-value="(v) => onFieldUpdate('desc', v)"
          />
        </div>
      </section>

      <!-- ─── 段 2：后端 fallback ──────────────────────── -->
      <section class="flex flex-col gap-1">
        <h3 class="border-b border-gray-800 pb-1 text-xs font-semibold text-gray-300">后端 fallback</h3>
        <div v-if="backendTemplateNode" class="flex flex-col gap-2 rounded border border-gray-800 bg-gray-900 p-2">
          <div class="flex items-center gap-2 text-[10px] text-gray-500">
            <span class="rounded bg-gray-800 px-1.5 py-0.5">{{ backendTemplateNode.kind }}</span>
            <button
              type="button"
              class="font-mono text-gray-300 hover:text-gray-100 hover:underline"
              :title="`跳转到 ${backendTemplateNode.kind}:${backendTemplateNode.id}`"
              @click="onTemplateNavigate"
            >
              {{ backendTemplateNode.id }}
            </button>
            <span class="text-gray-600">·</span>
            <span class="text-yellow-700">deprecated</span>
          </div>
          <div class="flex flex-col gap-1">
            <div class="text-[10px] uppercase tracking-wider text-gray-500">name</div>
            <div class="rounded bg-gray-800 px-2 py-1 text-xs text-gray-300">
              {{ backendFallbackName || '（空）' }}
            </div>
          </div>
          <div class="flex flex-col gap-1">
            <div class="text-[10px] uppercase tracking-wider text-gray-500">desc</div>
            <div class="rounded bg-gray-800 px-2 py-1 text-xs text-gray-300">
              {{ backendFallbackDesc || '（空）' }}
            </div>
          </div>
        </div>
        <div v-else class="rounded border border-gray-800 bg-gray-900 p-2 text-[10px] text-gray-600">
          无关联 {{ isEnemyKind ? 'enemy.template' : 'poi.template' }}（孤儿呈现）
        </div>
      </section>

      <!-- ─── 段 3：最终值 ─────────────────────────────── -->
      <section class="flex flex-col gap-1">
        <h3 class="border-b border-gray-800 pb-1 text-xs font-semibold text-gray-300">最终值</h3>
        <div class="flex flex-col gap-2 rounded border border-gray-800 bg-gray-900 p-2">
          <div class="text-[10px] text-gray-500">
            <template v-if="isEnemyKind">
              前端 getEnemyName / getEnemyDesc 实际渲染结果（fallback 链：locale → fallback → 默认）
            </template>
            <template v-else>
              前端 getPoiName / getPoiDesc 实际渲染结果（fallback 链：locale → fallback → 默认）
            </template>
          </div>
          <div class="flex flex-col gap-1">
            <div class="text-[10px] uppercase tracking-wider text-gray-500">
              {{ isEnemyKind ? 'getEnemyName' : 'getPoiName' }}
            </div>
            <div class="rounded border border-gray-700 bg-gray-800 px-2 py-1 font-mono text-xs text-gray-100">
              {{ finalName || '（空）' }}
            </div>
          </div>
          <div class="flex flex-col gap-1">
            <div class="text-[10px] uppercase tracking-wider text-gray-500">
              {{ isEnemyKind ? 'getEnemyDesc' : 'getPoiDesc' }}
            </div>
            <div class="rounded border border-gray-700 bg-gray-800 px-2 py-1 font-mono text-xs text-gray-100">
              {{ finalDesc || '（空）' }}
            </div>
          </div>
        </div>
      </section>

      <!-- ─── 段 4：诊断 ─────────────────────────────── -->
      <section class="flex flex-col gap-1">
        <h3 class="border-b border-gray-800 pb-1 text-xs font-semibold text-gray-300">诊断</h3>
        <div class="flex flex-col gap-2 rounded border border-gray-800 bg-gray-900 p-2">
          <div class="flex flex-wrap gap-1.5">
            <span
              v-if="isMissing"
              class="rounded border border-accent-error bg-transparent px-1.5 py-0.5 text-[10px] text-accent-error"
              title="locale name 或 desc 为空"
            >
              缺失
            </span>
            <span
              v-if="isOrphan"
              class="rounded border border-accent-error bg-transparent px-1.5 py-0.5 text-[10px] text-accent-error"
              :title="`无关联 ${isEnemyKind ? 'enemy.template' : 'poi.template'} 节点`"
            >
              孤儿
            </span>
            <span
              v-if="isFallbackRedundant"
              class="rounded border border-yellow-700 bg-transparent px-1.5 py-0.5 text-[10px] text-yellow-700"
              title="locale 与后端 fallback 完全相同——冗余但无害（P5 单源编译后消除）"
            >
              fallback 冗余
            </span>
            <span
              v-if="isInconsistent"
              class="rounded border border-gray-600 bg-transparent px-1.5 py-0.5 text-[10px] text-gray-300"
              title="locale 与 fallback 不同——已人工定制"
            >
              已定制
            </span>
            <span
              v-if="!isMissing && !isOrphan && !isFallbackRedundant && !isInconsistent"
              class="rounded border border-gray-700 bg-transparent px-1.5 py-0.5 text-[10px] text-gray-400"
            >
              正常
            </span>
          </div>
          <div class="text-[10px] text-gray-600">
            校验规则（O-10 第 6 层）：{{ isEnemyKind ? 'presentation.enemy' : 'presentation.poi' }}.missing / .orphan / .fallback_redundant
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
