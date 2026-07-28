<!-- @module O 内容工具箱 -->
<script setup lang="ts">
//
// MigrationConfirmModal：P5-4 一次性迁移确认对话框（对齐执行案 §4.10.1）
//
// 设计意图：
//   - 迁移是高风险操作（覆盖 PHP/TS 文件为编译产物），必须由用户主动确认
//   - 三阶段：confirm（确认）→ running（迁移中）→ result（结果）
//   - confirm 阶段列出将要备份的文件 + 将要创建的 YAML + 风险提示
//   - running 阶段显示 7 步迁移管道进度
//   - result 阶段显示成功/失败 + 诊断列表
//   - 成功后 emit 'migrated'，父组件刷新状态
//
// 边界：
//   - Gateway 不可达时显示错误，不进入 running 阶段
//   - 迁移中禁用关闭按钮（closable=false）
//   - 失败时显示回滚状态（若 rollback 存在）
//   - 成功时显示备份目录与 YAML 文件数
import { ref, computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import BaseModal from '@/components/common/BaseModal.vue';
import BaseButton from '@/components/common/BaseButton.vue';
import { COMPILATION_TARGET_FILES, MIGRATION_STEP_LABELS } from '@/build/build-constants';
import type {
  MigrationResult,
  MigrationStepState,
  MigrationDiagnostic,
} from '@/build/migration-flow';
import {
  migrateWorkspace,
  GatewayUnavailableError,
} from '@/services/workspace/gateway-client';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: []; migrated: [] }>();
const { t } = useI18n();

// ─── 阶段管理 ──────────────────────────────────────────────────
type Phase = 'confirm' | 'running' | 'result';
const phase = ref<Phase>('confirm');
const isMigrating = ref(false);
const result = ref<MigrationResult | null>(null);
const errorMsg = ref<string | null>(null);

// ─── 文件清单（从 COMPILATION_TARGET_FILES 派生） ─────────────
const phpFiles = computed(() =>
  COMPILATION_TARGET_FILES.filter((f) => f.endsWith('.php')),
);
const tsFiles = computed(() =>
  COMPILATION_TARGET_FILES.filter((f) => f.endsWith('.ts')),
);

// ─── 步骤进度（running 阶段显示） ──────────────────────────────
const stepStates = ref<MigrationStepState[]>([]);
const stepLabels = MIGRATION_STEP_LABELS;

// ─── 诊断（result 阶段显示） ───────────────────────────────────
const errorDiagnostics = computed<MigrationDiagnostic[]>(() =>
  (result.value?.diagnostics ?? []).filter((d) => d.severity === 'error'),
);
const warningDiagnostics = computed<MigrationDiagnostic[]>(() =>
  (result.value?.diagnostics ?? []).filter((d) => d.severity === 'warning'),
);

// ─── 模态框打开时重置状态 ─────────────────────────────────────
watch(
  () => props.open,
  (open) => {
    if (open) {
      phase.value = 'confirm';
      isMigrating.value = false;
      result.value = null;
      errorMsg.value = null;
      stepStates.value = [];
    }
  },
);

// ─── 确认迁移 ──────────────────────────────────────────────────
async function handleConfirm(): Promise<void> {
  if (isMigrating.value) return;
  isMigrating.value = true;
  phase.value = 'running';
  errorMsg.value = null;
  result.value = null;
  stepStates.value = [];

  try {
    const res = await migrateWorkspace();
    result.value = res;
    stepStates.value = res.stepStates;
    phase.value = 'result';
    if (res.success) {
      // 延迟通知父组件，让用户先看到结果
      // 父组件通过 @migrated 刷新状态
    }
  } catch (err) {
    const msg =
      err instanceof GatewayUnavailableError
        ? t('migration.gatewayUnavailable')
        : err instanceof Error
          ? err.message
          : String(err);
    errorMsg.value = msg;
    phase.value = 'result';
  } finally {
    isMigrating.value = false;
  }
}

function handleClose(): void {
  if (isMigrating.value) return; // 迁移中不允许关闭
  if (phase.value === 'result' && result.value?.success) {
    emit('migrated');
  }
  emit('close');
}

// ─── 步骤状态样式 ──────────────────────────────────────────────
function stepStatusClass(status: MigrationStepState['status']): string {
  switch (status) {
    case 'success':
      return 'text-green-400';
    case 'failed':
      return 'text-red-400';
    case 'running':
      return 'text-blue-400 animate-pulse';
    case 'skipped':
      return 'text-gray-600';
    default:
      return 'text-gray-500';
  }
}

function stepStatusGlyph(status: MigrationStepState['status']): string {
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
</script>

<template>
  <BaseModal :open="open" :title="t('migration.title')" :closable="!isMigrating" @close="handleClose">
    <!-- ─── 阶段 1：确认 ─────────────────────────────────── -->
    <div v-if="phase === 'confirm'" class="space-y-4">
      <!-- 风险提示 -->
      <div class="rounded border border-yellow-700 bg-yellow-900/20 p-3 text-sm text-yellow-200">
        <p class="font-semibold">{{ t('migration.riskTitle') }}</p>
        <p class="mt-1 text-xs text-yellow-300/80">{{ t('migration.riskDesc') }}</p>
      </div>

      <!-- 将要备份的文件 -->
      <section>
        <h4 class="mb-1 text-xs font-semibold text-gray-400">
          {{ t('migration.backupFilesTitle') }}（{{ phpFiles.length + tsFiles.length }}）
        </h4>
        <div class="max-h-32 overflow-auto rounded border border-gray-800 bg-gray-900 p-2 text-xs">
          <div class="mb-1 text-gray-500">PHP ({{ phpFiles.length }}):</div>
          <ul class="space-y-0.5 text-gray-400">
            <li v-for="f in phpFiles" :key="f" class="font-mono">{{ f }}</li>
          </ul>
          <div class="mt-2 mb-1 text-gray-500">TS ({{ tsFiles.length }}):</div>
          <ul class="space-y-0.5 text-gray-400">
            <li v-for="f in tsFiles" :key="f" class="font-mono">{{ f }}</li>
          </ul>
        </div>
      </section>

      <!-- 将要创建的 YAML -->
      <section>
        <h4 class="mb-1 text-xs font-semibold text-gray-400">
          {{ t('migration.yamlFilesTitle') }}
        </h4>
        <p class="text-xs text-gray-500">{{ t('migration.yamlFilesDesc') }}</p>
      </section>
    </div>

    <!-- ─── 阶段 2：迁移中 ───────────────────────────────── -->
    <div v-else-if="phase === 'running'" class="space-y-3">
      <p class="text-sm text-blue-300">{{ t('migration.running') }}</p>
      <ol class="space-y-1.5">
        <li
          v-for="step in stepStates"
          :key="step.step"
          class="flex items-start gap-2 text-sm"
        >
          <span :class="stepStatusClass(step.status)" class="mt-0.5 w-4 text-center">
            {{ stepStatusGlyph(step.status) }}
          </span>
          <div class="flex-1">
            <div :class="stepStatusClass(step.status)">
              {{ stepLabels[step.step] }}
            </div>
            <div v-if="step.log.length" class="mt-0.5 text-xs text-gray-500">
              {{ step.log[step.log.length - 1] }}
            </div>
          </div>
        </li>
      </ol>
    </div>

    <!-- ─── 阶段 3：结果 ─────────────────────────────────── -->
    <div v-else class="space-y-3">
      <!-- 错误消息（Gateway 不可达等） -->
      <div v-if="errorMsg" class="rounded border border-red-700 bg-red-900/20 p-3 text-sm text-red-300">
        {{ errorMsg }}
      </div>

      <template v-else-if="result">
        <!-- 成功/失败标题 -->
        <div
          class="rounded border p-3"
          :class="
            result.success
              ? 'border-green-700 bg-green-900/20 text-green-300'
              : 'border-red-700 bg-red-900/20 text-red-300'
          "
        >
          <p class="font-semibold">
            {{ result.success ? t('migration.success') : t('migration.failed') }}
          </p>
          <p v-if="result.success && result.backupPath" class="mt-1 break-all text-xs text-gray-400">
            {{ t('migration.backupPath') }}：{{ result.backupPath }}
          </p>
          <p v-if="result.success && result.yamlFiles" class="text-xs text-gray-400">
            {{ t('migration.yamlCount', { count: result.yamlFiles.length }) }}
          </p>
        </div>

        <!-- 回滚状态 -->
        <div
          v-if="result.rollback"
          class="rounded border border-orange-700 bg-orange-900/20 p-3 text-xs text-orange-300"
        >
          <p class="font-semibold">{{ t('migration.rollbackTitle') }}</p>
          <p>
            {{ t('migration.rollbackFiles', { count: result.rollback.rolledBackFiles.length }) }}
          </p>
          <p v-if="!result.rollback.fullyRolledBack" class="mt-1 text-red-400">
            {{ t('migration.rollbackIncomplete') }}
          </p>
        </div>

        <!-- 错误诊断 -->
        <div v-if="errorDiagnostics.length" class="space-y-1">
          <h4 class="text-xs font-semibold text-red-400">
            {{ t('migration.errors', { count: errorDiagnostics.length }) }}
          </h4>
          <ul class="max-h-32 space-y-0.5 overflow-auto text-xs text-red-300">
            <li v-for="(d, i) in errorDiagnostics" :key="i" class="break-all">
              · [{{ d.code }}] {{ d.message }}
            </li>
          </ul>
        </div>

        <!-- 警告诊断 -->
        <div v-if="warningDiagnostics.length" class="space-y-1">
          <h4 class="text-xs font-semibold text-yellow-400">
            {{ t('migration.warnings', { count: warningDiagnostics.length }) }}
          </h4>
          <ul class="max-h-24 space-y-0.5 overflow-auto text-xs text-yellow-300">
            <li v-for="(d, i) in warningDiagnostics" :key="i" class="break-all">
              · [{{ d.code }}] {{ d.message }}
            </li>
          </ul>
        </div>

        <!-- 步骤详情（结果阶段也显示） -->
        <details class="text-xs">
          <summary class="cursor-pointer text-gray-400">{{ t('migration.stepDetails') }}</summary>
          <ol class="mt-2 space-y-1">
            <li
              v-for="step in stepStates"
              :key="step.step"
              class="flex items-start gap-2"
            >
              <span :class="stepStatusClass(step.status)" class="w-4 text-center">
                {{ stepStatusGlyph(step.status) }}
              </span>
              <div class="flex-1">
                <span :class="stepStatusClass(step.status)">{{ stepLabels[step.step] }}</span>
                <ul v-if="step.log.length" class="mt-0.5 text-gray-600">
                  <li v-for="(log, j) in step.log" :key="j">{{ log }}</li>
                </ul>
              </div>
            </li>
          </ol>
        </details>
      </template>
    </div>

    <!-- ─── Footer 按钮 ─────────────────────────────────── -->
    <template #footer>
      <BaseButton v-if="phase === 'confirm'" variant="ghost" size="sm" @click="handleClose">
        {{ t('migration.cancel') }}
      </BaseButton>
      <BaseButton
        v-if="phase === 'confirm'"
        variant="danger"
        size="sm"
        :disabled="isMigrating"
        @click="handleConfirm"
      >
        {{ t('migration.confirmButton') }}
      </BaseButton>
      <BaseButton v-if="phase === 'result'" size="sm" @click="handleClose">
        {{ t('migration.close') }}
      </BaseButton>
    </template>
  </BaseModal>
</template>
