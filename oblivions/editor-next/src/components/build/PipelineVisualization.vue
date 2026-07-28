<!-- @module O 内容工具箱 -->
<script setup lang="ts">
//
// PipelineVisualization：编译管道可视化（对齐执行案 §4.9.2 + §4.6 + P6 §4.6.2）
//
// 设计意图：
//   - BuildView 的核心组件，可视化 O-5 完整九步管道状态
//   - 九步：基线捕获 → 内存编辑 → diff 展示 → 完整校验 → 临时目录生成 →
//     语法校验 → 冲突检查 → 自动备份 + 原子替换 → 镜像校验（P6 新增）
//   - 每步显示状态图标 + 步骤名 + 日志 + 诊断
//   - 支持 collapsed 展开/收起单步详情
//   - 无管道状态时显示占位提示
//   - P6 扩展：第 9 步失败 + mirrorRolledBack=true 时显示"已回滚"标记
//
// 边界：
//   - 步骤状态为 pending 时不显示日志区域
//   - diagnostics 按 severity 着色（error 红 / warning 黄 / info 灰）
//   - 日志按行显示，max-h 限制高度避免溢出
//   - 第 9 步"已回滚"标记仅在 mirrorRolledBack=true 且步骤 9 状态为 failed 时显示
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { PipelineStepState, BuildDiagnostic } from '@/build/content-compiler';

defineProps<{
  steps: PipelineStepState[];
  affectedFiles?: string[];
  /** P6 镜像校验失败后是否已自动回滚到备份（执行案 §4.6.2） */
  mirrorRolledBack?: boolean;
}>();
const { t } = useI18n();

// ─── 展开状态（步骤号 → 是否展开） ────────────────────────────
const expanded = ref<Set<number>>(new Set());

function toggleExpand(step: number): void {
  if (expanded.value.has(step)) {
    expanded.value.delete(step);
  } else {
    expanded.value.add(step);
  }
}

// ─── 步骤状态样式 ──────────────────────────────────────────────
function statusClass(status: PipelineStepState['status']): string {
  switch (status) {
    case 'success':
      return 'text-green-400 border-green-700';
    case 'failed':
      return 'text-red-400 border-red-700';
    case 'running':
      return 'text-blue-400 border-blue-700 animate-pulse';
    case 'skipped':
      return 'text-gray-600 border-gray-800';
    default:
      return 'text-gray-500 border-gray-800';
  }
}

function statusGlyph(status: PipelineStepState['status']): string {
  switch (status) {
    case 'success':
      return '✓';
    case 'failed':
      return '✕';
    case 'running':
      return '◐';
    case 'skipped':
      return '–';
    default:
      return '○';
  }
}

// ─── 诊断着色 ──────────────────────────────────────────────────
function diagSeverityClass(severity: BuildDiagnostic['severity']): string {
  switch (severity) {
    case 'error':
      return 'text-red-400';
    case 'warning':
      return 'text-yellow-400';
    default:
      return 'text-gray-400';
  }
}

// ─── 耗时格式化 ────────────────────────────────────────────────
function formatDuration(step: PipelineStepState): string {
  if (!step.startedAt || !step.finishedAt) return '';
  const ms = step.finishedAt - step.startedAt;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
</script>

<template>
  <section class="rounded border border-gray-700 p-4">
    <h2 class="mb-3 font-semibold text-gray-200">{{ t('pipeline.title') }}</h2>

    <!-- 无管道状态 -->
    <div v-if="steps.length === 0" class="text-sm text-gray-500">
      {{ t('pipeline.empty') }}
    </div>

    <!-- 九步管道 -->
    <ol v-else class="space-y-1">
      <li
        v-for="step in steps"
        :key="step.step"
        class="rounded border-l-2 bg-gray-900/50"
        :class="statusClass(step.status)"
      >
        <button
          type="button"
          class="flex w-full items-center gap-3 px-3 py-2 text-left"
          @click="toggleExpand(step.step)"
        >
          <span class="w-4 text-center">{{ statusGlyph(step.status) }}</span>
          <span class="flex-1 text-sm">
            <span class="text-gray-200">{{ step.step }}. {{ step.name }}</span>
            <!-- P6：第 9 步失败 + 已回滚标记（执行案 §4.6.2） -->
            <span
              v-if="step.step === 9 && step.status === 'failed' && mirrorRolledBack"
              class="ml-2 rounded border border-yellow-700 bg-yellow-900/30 px-1 py-0.5 text-[10px] text-yellow-300"
            >
              已回滚
            </span>
          </span>
          <span v-if="formatDuration(step)" class="text-xs text-gray-500">
            {{ formatDuration(step) }}
          </span>
          <span v-if="step.log.length || step.diagnostics?.length" class="text-xs text-gray-500">
            {{ expanded.has(step.step) ? '▼' : '▶' }}
          </span>
        </button>

        <!-- 展开详情 -->
        <div
          v-if="expanded.has(step.step) && (step.log.length || step.diagnostics?.length)"
          class="space-y-2 border-t border-gray-800 px-3 py-2"
        >
          <!-- 日志 -->
          <div v-if="step.log.length" class="space-y-0.5">
            <div class="text-[10px] font-semibold text-gray-500">{{ t('pipeline.logs') }}</div>
            <pre class="max-h-32 overflow-auto whitespace-pre-wrap text-xs text-gray-400">{{ step.log.join('\n') }}</pre>
          </div>

          <!-- 诊断 -->
          <div v-if="step.diagnostics && step.diagnostics.length" class="space-y-0.5">
            <div class="text-[10px] font-semibold text-gray-500">{{ t('pipeline.diagnostics') }}</div>
            <ul class="space-y-0.5 text-xs">
              <li
                v-for="(d, i) in step.diagnostics"
                :key="i"
                :class="diagSeverityClass(d.severity)"
                class="break-all"
              >
                · [{{ d.ruleId }}] {{ d.message }}
                <span v-if="d.file" class="text-gray-600">（{{ d.file }}<template v-if="d.line">:{{ d.line }}</template>）</span>
              </li>
            </ul>
          </div>
        </div>
      </li>
    </ol>

    <!-- 受影响文件列表 -->
    <div v-if="affectedFiles && affectedFiles.length > 0" class="mt-3 space-y-1">
      <div class="text-[10px] font-semibold text-gray-500">
        {{ t('pipeline.affectedFiles', { count: affectedFiles.length }) }}
      </div>
      <ul class="max-h-32 space-y-0.5 overflow-auto text-xs text-gray-400">
        <li v-for="f in affectedFiles" :key="f" class="font-mono">{{ f }}</li>
      </ul>
    </div>
  </section>
</template>
