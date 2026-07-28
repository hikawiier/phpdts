<!-- @module O 内容工具箱 -->
<script setup lang="ts">
//
// GeneratorModal：生成器双模式模态框（M8 主题生成器入口）
//
// 设计意图（对齐 2.6 配置驱动 + 2.15 灰阶基底 + 唯一强调色 + §3.7.6 双模式）：
//   - Schema 驱动 UI：按 generator.getParamSchema() 自动渲染控件，新增字段无需修改组件
//   - 双模式：mode='full' 全项目覆盖（loadProject，弹 confirm 提示备份风险）
//             mode='region' 单区域追加（addGeneratedRegion，无 confirm）
//   - 字段过滤：mode='region' 时隐藏 hideInRegionMode=true 的字段
//   - 焦点恢复：模态关闭后将焦点恢复到触发按钮（可访问性，对齐 §3.7.6）
//   - 生成后自动验证：调用 M6 runFull({ includeConfig: false }) 形成闭环
//   - 视觉对齐 2.15：模态框复用 ExportModal 灰阶样式
//
// 数据流：
//   - 输入：uiStore.modals.generator + uiStore.generatorModalState（mode/returnFocusEl）
//   - 生成器列表：listGenerators() 从 registry 读取
//   - 参数：根据 generator.getDefaultParams() 初始化，schema 驱动表单更新
//   - 输出：全项目模式 → projectStore.loadProject（覆盖）
//          单区域模式 → projectStore.addGeneratedRegion（追加）
//   - 验证：写入后调用 validateStore.runFull({ includeConfig: false }) 形成闭环

import { ref, computed, watch, nextTick } from 'vue';
import { useUiStore } from '@/stores/uiStore';
import { useProjectStore } from '@/stores/projectStore';
import { useValidateStore } from '@/stores/validateStore';
import { listGenerators, getGenerator } from '@/services/generators/registry';
import type {
  Generator,
  GeneratorParamField,
  GeneratorParams,
  Pls,
} from '@/shared';
import BaseButton from '@/components/common/BaseButton.vue';
import BaseInput from '@/components/common/BaseInput.vue';
import BaseSelect from '@/components/common/BaseSelect.vue';
import BaseCheckbox from '@/components/common/BaseCheckbox.vue';

const ui = useUiStore();
const project = useProjectStore();
const validate = useValidateStore();

// ─── 派生状态 ──────────────────────────────────────────
const open = computed(() => ui.modals.generator);
const mode = computed(() => ui.generatorModalState.mode);

const generators = computed<Generator[]>(() => listGenerators());
const currentGeneratorId = ref<string>('');
const currentGenerator = computed<Generator | null>(() => {
  if (!currentGeneratorId.value) return null;
  return getGenerator(currentGeneratorId.value) ?? null;
});
const params = ref<GeneratorParams>({});
const errorMessage = ref<string | null>(null);
const isGenerating = ref(false);

// 模式化标题与按钮文案
const title = computed(() =>
  mode.value === 'full' ? '随机生成地图（全项目）' : '随机生成区域（追加）',
);
const confirmButtonText = computed(() =>
  mode.value === 'full' ? '生成并覆盖项目' : '生成并追加区域',
);

// schema 字段（按 mode 过滤 hideInRegionMode）
const visibleFields = computed<GeneratorParamField[]>(() => {
  if (!currentGenerator.value) return [];
  const fields = currentGenerator.value.getParamSchema();
  if (mode.value === 'region') {
    return fields.filter((f) => !f.hideInRegionMode);
  }
  return fields;
});

// ─── 选择生成器时初始化默认参数 ────────────────────────
watch(currentGeneratorId, (id) => {
  if (!id) {
    params.value = {};
    return;
  }
  const gen = getGenerator(id);
  if (gen) {
    params.value = gen.getDefaultParams();
  }
});

// 模态打开时自动选第一个生成器 + 清空错误
watch(open, (isOpen) => {
  if (isOpen) {
    errorMessage.value = null;
    if (!currentGeneratorId.value && generators.value.length > 0) {
      currentGeneratorId.value = generators.value[0]!.id;
    }
  }
});

// ─── 参数变更处理 ─────────────────────────────────────
function onNumberInput(field: GeneratorParamField, value: string): void {
  const num = Number(value);
  if (!Number.isNaN(num)) {
    params.value = { ...params.value, [field.key]: num };
  }
}

function onSelectChange(field: GeneratorParamField, value: string): void {
  params.value = { ...params.value, [field.key]: value };
}

function onCheckboxChange(field: GeneratorParamField, value: boolean): void {
  params.value = { ...params.value, [field.key]: value };
}

function onTextInput(field: GeneratorParamField, value: string): void {
  params.value = { ...params.value, [field.key]: value };
}

// ─── 关闭 + 焦点恢复（可访问性） ─────────────────────
function handleClose(): void {
  const target = ui.generatorModalState.returnFocusEl;
  ui.closeGeneratorModal();
  if (target instanceof HTMLElement) {
    void nextTick(() => target.focus());
  }
}

// ─── 生成 ────────────────────────────────────────────
async function handleGenerate(): Promise<void> {
  if (!currentGenerator.value) {
    errorMessage.value = '请先选择一个生成器';
    return;
  }
  errorMessage.value = null;
  isGenerating.value = true;

  try {
    if (mode.value === 'full') {
      // 全项目模式：覆盖式 + confirm 提示备份风险（对齐 §3.7.7 边界）
      if (project.hasProject) {
        const confirmed = window.confirm(
          '全项目生成会覆盖当前项目的所有区域，建议先导出 ZIP 备份。继续？',
        );
        if (!confirmed) {
          isGenerating.value = false;
          return;
        }
      }
      const result = currentGenerator.value.generate(params.value);
      project.loadProject({
        regions: result.regions,
        grids: result.grids,
        tiles: result.tiles,
      });
      // 自动验证（M6 接口：includeConfig=false 保持生成器纯函数性）
      validate.runFull({ includeConfig: false });
      ui.showToast('已生成并覆盖项目', 'success');
    } else {
      // 单区域模式：追加 + 不弹 confirm（无数据丢失）
      const existingPgroups = Object.keys(project.project.regions)
        .map(Number)
        .sort((a, b) => a - b) as Pls[];
      const result = currentGenerator.value.generateRegion(
        params.value,
        undefined,
        existingPgroups,
      );
      const newPgroup = project.addGeneratedRegion(result.region, result.tiles);
      if (newPgroup === null) {
        errorMessage.value = 'pgroup 已达上限，无法追加新区域';
        return;
      }
      // 自动验证
      validate.runFull({ includeConfig: false });
      ui.showToast(`已追加新区域（pgroup=${newPgroup}）`, 'success');
    }
    handleClose();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errorMessage.value = `生成失败：${msg}`;
  } finally {
    isGenerating.value = false;
  }
}
</script>

<template>
  <div
    v-if="open"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
    @click.self="handleClose"
  >
    <div
      class="w-[640px] max-h-[80vh] bg-neutral-900 border border-neutral-700 rounded-md flex flex-col"
      role="dialog"
      aria-modal="true"
    >
      <!-- 标题栏 -->
      <div class="flex items-center justify-between px-5 py-3 border-b border-neutral-700">
        <h2 class="text-base font-medium text-neutral-100">{{ title }}</h2>
        <button
          type="button"
          class="text-neutral-400 hover:text-neutral-100 transition-colors"
          aria-label="close"
          @click="handleClose"
        >
          ×
        </button>
      </div>

      <!-- 内容区 -->
      <div class="flex-1 overflow-auto p-5 space-y-4">
        <!-- 生成器选择 -->
        <div class="space-y-1">
          <label class="text-xs text-gray-400">生成器</label>
          <select
            v-model="currentGeneratorId"
            class="w-full rounded border border-gray-700 bg-gray-900 px-2 py-1 text-sm text-gray-100 focus:border-gray-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gray-400"
          >
            <option value="" disabled>请选择生成器</option>
            <option v-for="gen in generators" :key="gen.id" :value="gen.id">
              {{ gen.name }}
            </option>
          </select>
          <p v-if="currentGenerator" class="text-[10px] text-gray-500">
            {{ currentGenerator.description }}
          </p>
        </div>

        <!-- 参数表单（schema 驱动） -->
        <div v-if="currentGenerator" class="space-y-3">
          <div
            v-for="field in visibleFields"
            :key="field.key"
            class="flex flex-col gap-1"
          >
            <label class="text-xs text-gray-400">
              {{ field.label }}
              <span v-if="field.hint" class="ml-2 text-[10px] text-gray-600">
                ({{ field.hint }})
              </span>
            </label>

            <!-- number / range（range 用 number 输入框） -->
            <BaseInput
              v-if="field.type === 'number' || field.type === 'range'"
              :model-value="(params[field.key] as number) ?? 0"
              type="number"
              :min="field.min"
              :max="field.max"
              :step="field.step"
              @update:model-value="(v) => onNumberInput(field, v)"
            />

            <!-- select -->
            <BaseSelect
              v-else-if="field.type === 'select'"
              :model-value="(params[field.key] as string) ?? ''"
              :options="field.options ?? []"
              @change="(v) => onSelectChange(field, v)"
            />

            <!-- boolean -->
            <BaseCheckbox
              v-else-if="field.type === 'boolean'"
              :model-value="(params[field.key] as boolean) ?? false"
              @update:model-value="(v) => onCheckboxChange(field, v)"
            />

            <!-- text -->
            <BaseInput
              v-else-if="field.type === 'text'"
              :model-value="(params[field.key] as string) ?? ''"
              @update:model-value="(v) => onTextInput(field, v)"
            />
          </div>
        </div>

        <!-- 错误提示 -->
        <div
          v-if="errorMessage"
          class="p-3 bg-neutral-950 border border-accent-error rounded text-xs text-accent-error"
        >
          {{ errorMessage }}
        </div>

        <!-- 模式提示 -->
        <div class="p-3 bg-neutral-950 border border-neutral-700 rounded text-xs text-neutral-400">
          <p v-if="mode === 'full'">
            <span class="text-neutral-300">全项目模式：</span>
            生成结果将覆盖当前项目的所有区域。建议先导出 ZIP 备份。
          </p>
          <p v-else>
            <span class="text-neutral-300">单区域模式：</span>
            生成结果将作为新区域追加到当前项目（pgroup 自动分配），不影响现有区域。
          </p>
        </div>
      </div>

      <!-- 底部按钮 -->
      <div class="flex justify-end gap-2 px-5 py-3 border-t border-neutral-700">
        <BaseButton variant="ghost" size="sm" @click="handleClose">
          取消
        </BaseButton>
        <BaseButton
          variant="primary"
          size="sm"
          :disabled="!currentGenerator || isGenerating"
          @click="handleGenerate"
        >
          {{ isGenerating ? '生成中...' : confirmButtonText }}
        </BaseButton>
      </div>
    </div>
  </div>
</template>
