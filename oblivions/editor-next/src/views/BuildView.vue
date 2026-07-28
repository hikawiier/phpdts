<!-- @module O 内容工具箱 -->
<script setup lang="ts">
//
// BuildView：构建与发布工作区（对齐 O-6 §4.6.4 + §4.9.2 + 设计案 §4.4.4 + P6 §4.7.2）
//
// P5-4 升级：
//   - 新增 PipelineVisualization 组件——可视化 O-5 完整八步管道
//   - 新增 BackupHistory 组件——提取备份列表为独立组件
//   - 新增迁移触发入口——MigrationConfirmModal
//   - 保留 P1-H 的 Change Set 摘要 + 发布功能
//
// P6 升级（执行案 §4.7.2）：
//   - 显示第 9 步镜像校验的当前状态
//   - 镜像器对比摘要
//   - blocking=true 差异列表（红色高亮，标记为"阻断发布"）
//   - 回滚按钮（如镜像校验失败已自动回滚后仍可手动恢复）
//   - 发布门禁：mirrorBlockingCount > 0 时禁用发布按钮
//
// 设计意图：
//   - 单源编译：从 graph-store 读取所有资源节点 → serializeNodes 序列化为 SerializedFile[]
//     → 转换为 PublishableFile[] → gateway-client.publishFiles 原子写入
//   - 编译管道可视化：P5-4 阶段 pipelineState 占位为空数组——/compile 路由在后续任务实现
//     届时 publish 流程将切换为先 compile 再 publish，pipelineState 从 CompileResult 获取
//   - Change Set 摘要：P1 阶段 ChangeSet 类尚未全局注入，用 graph-store 节点统计作为
//     "工作区当前状态"代理；P5 阶段接入真实 ChangeSet 后替换为 pendingChanges 派生
//   - 原子发布：通过 gateway-client 调用 /api/write，由 atomic-publisher 执行
//     备份 + 原子替换；任一步失败自动回滚
//   - baseline 简化：P1 阶段传空 BaselineEntry[]，让 atomic-publisher 跳过外部修改检测
//     （P5 阶段从 ChangeSet.getBaseline(filePath) 派生真实 baseline entries）
//   - P6 镜像校验：复用 validateStore 的 mirrorResults / mirrorBlockingCount /
//     mirrorStatusList，与 ValidateView 共享状态；编译管道第 9 步通过 mirrorFn 注入
//     完成后调用 validate.setMirrorResults(results) 同步状态
//
// 边界：
//   - 发布按钮 disabled 条件：图无节点 OR 正在发布 OR 镜像阻断差异 > 0
//   - 备份列表展示最近 N 份（gateway-client.listBackups 已按时间倒序）
//   - 还原前 confirm 确认（未发布的 Change Set 会丢失）
//   - publishFiles / listBackups / restoreBackup 抛 GatewayUnavailableError 时
//     转换为 PublishResult.error 显示
//   - PipelineVisualization 在无管道状态时显示占位提示
//   - mirrorRolledBack 由编译管道第 9 步失败回滚后注入，仅用于显示"已回滚"标记
import { ref, computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useGraphStore } from '@/graph/graph-store';
import { useValidateStore } from '@/stores/validateStore';
import { serializeNodes } from '@/adapters/adapter-registry';
import { getKindSchema } from '@/schema/registry';
import {
  publishFiles as gatewayPublishFiles,
  GatewayUnavailableError,
} from '@/services/workspace/gateway-client';
import type {
  PublishResult,
  PublishableFile,
  BaselineEntry,
} from '@/build/atomic-publisher';
import type { PipelineStepState } from '@/build/content-compiler';
import PipelineVisualization from '@/components/build/PipelineVisualization.vue';
import BackupHistory from '@/components/build/BackupHistory.vue';
import MigrationConfirmModal from '@/components/migration/MigrationConfirmModal.vue';
import BaseButton from '@/components/common/BaseButton.vue';

const { t } = useI18n();
const graphStore = useGraphStore();
const validate = useValidateStore();

// ─── state ────────────────────────────────────────────────────
const isPublishing = ref(false);
const lastResult = ref<PublishResult | null>(null);

// ─── P5-4 编译管道状态 ────────────────────────────────────────
// 占位：/compile 路由在后续任务实现，届时从 CompileResult.pipelineState 获取
const pipelineSteps = ref<PipelineStepState[]>([]);
const affectedFiles = ref<string[]>([]);

// ─── P6 镜像校验状态（执行案 §4.7.2） ─────────────────────────
// mirrorRolledBack：编译管道第 9 步失败回滚后置 true，仅用于显示"已回滚"标记
// 通过 CompileResult.mirrorRolledBack 注入（compileAndPublish 完成后）
const mirrorRolledBack = ref<boolean>(false);

// ─── P5-4 迁移对话框 ──────────────────────────────────────────
const showMigrationModal = ref(false);

// ─── Change Set 摘要（P1 简化版：从 graph-store 节点统计派生） ───
//
// P1 阶段 ChangeSet 类尚未全局注入（main.ts TODO P0-H），用 graph-store 节点数
// 作为"工作区当前状态"代理：pendingCount = 资源总数，affectedKinds = 有节点的 kind 列表。
// P5 阶段接入真实 ChangeSet 后，替换为 changeSet.getPendingChanges() 派生。
const pendingCount = computed(() => graphStore.nodeCount);

const kindBreakdown = computed<Array<{ kind: string; count: number }>>(() => {
  const counts = graphStore.nodeCountByKind;
  const result: Array<{ kind: string; count: number }> = [];
  for (const [kind, count] of counts) {
    result.push({ kind, count });
  }
  result.sort((a, b) => a.kind.localeCompare(b.kind));
  return result;
});

const affectedKinds = computed<string[]>(() => kindBreakdown.value.map((k) => k.kind));

// ─── P6 镜像校验摘要（执行案 §4.7.2） ─────────────────────────
//
// 复用 validateStore 的派生状态，与 ValidateView / MirrorCheckSection 共享同一份镜像结果。
// - mirrorBlockingCount > 0：阻断发布，发布按钮禁用
// - hasMirrorBackendUnavailable：后端不可达 warning，不阻断
// - mirrorStatusList：镜像器的聚合状态，用于摘要展示
const canPublish = computed(
  () =>
    pendingCount.value > 0 &&
    !isPublishing.value &&
    validate.mirrorBlockingCount === 0,
);

// ─── 发布 ──────────────────────────────────────────────────────
/**
 * 收集所有有节点的 kind，序列化为 PublishableFile[]。
 *
 * 跳过 schema 未注册的 kind（getKindSchema 返回 undefined）；
 * 跳过 serializeNodes 返回空数组的 kind（如未实现 serializer 的代码模块）。
 */
function collectPublishableFiles(): PublishableFile[] {
  const files: PublishableFile[] = [];
  for (const kind of affectedKinds.value) {
    const schema = getKindSchema(kind);
    if (!schema) continue;
    const nodes = graphStore.findNodesByKind(kind);
    if (nodes.length === 0) continue;
    const serialized = serializeNodes(nodes, schema);
    for (const file of serialized) {
      files.push({ filePath: file.filePath, content: file.content });
    }
  }
  return files;
}

async function handlePublish(): Promise<void> {
  if (pendingCount.value === 0 || isPublishing.value) return;
  isPublishing.value = true;
  try {
    const files = collectPublishableFiles();
    if (files.length === 0) {
      lastResult.value = {
        success: false,
        publishedFiles: [],
        backupDir: '',
        conflicts: [],
        error: t('build.publish.noFiles'),
      };
      return;
    }
    // P1 简化：传空 baseline，让 atomic-publisher 跳过外部修改检测
    // P5 阶段从 ChangeSet.getBaseline(filePath) 派生真实 BaselineEntry[]
    const baseline: BaselineEntry[] = [];
    const result = await gatewayPublishFiles(files, baseline);
    lastResult.value = result;
    // 发布成功后记录受影响文件（供 PipelineVisualization 展示）
    if (result.success) {
      affectedFiles.value = result.publishedFiles;
    }
  } catch (err) {
    const errorMessage =
      err instanceof GatewayUnavailableError
        ? t('build.publish.gatewayUnavailable')
        : err instanceof Error
          ? err.message
          : String(err);
    lastResult.value = {
      success: false,
      publishedFiles: [],
      backupDir: '',
      conflicts: [],
      error: errorMessage,
    };
  } finally {
    isPublishing.value = false;
  }
}

// ─── P6 镜像校验（执行案 §4.7.2） ─────────────────────────────
/**
 * 手动触发第 8 层镜像校验——拉取后端权威快照 + 跑镜像器。
 *
 * 与编译管道第 9 步的关系：
 *   - 本方法是用户在 BuildView 手动触发的入口
 *   - 编译管道第 9 步通过 mirrorFn 依赖注入在 compileAndPublish 内部完成，
 *     完成后通过 validate.setMirrorResults(results) 注入结果（不走本方法）
 *   - 两条路径最终都写入 validate.mirrorResults，UI 无感知差异
 */
async function handleRunMirror(): Promise<void> {
  await validate.runMirrorValidation();
}

/**
 * 清空镜像校验结果——重置 mirrorRolledBack 标记。
 */
function handleClearMirror(): void {
  validate.clearMirrorResults();
  mirrorRolledBack.value = false;
}

// ─── P6 镜像器状态样式（与 MirrorCheckSection 对齐） ───────────
type MirrorStatus = 'pending' | 'running' | 'success' | 'failed';

function mirrorStatusClass(status: MirrorStatus): string {
  switch (status) {
    case 'success':
      return 'text-green-400 border-green-700';
    case 'failed':
      return 'text-accent-error border-accent-error/60';
    case 'running':
      return 'text-blue-400 border-blue-700 animate-pulse';
    default:
      return 'text-gray-600 border-gray-800';
  }
}

function mirrorStatusGlyph(status: MirrorStatus): string {
  switch (status) {
    case 'success':
      return '✓';
    case 'failed':
      return '✕';
    case 'running':
      return '◐';
    default:
      return '○';
  }
}

// ─── P5-4 迁移 ────────────────────────────────────────────────
function handleMigrate(): void {
  showMigrationModal.value = true;
}

function handleMigrationClose(): void {
  showMigrationModal.value = false;
}

function handleMigrationDone(): void {
  showMigrationModal.value = false;
}

onMounted(() => {
  // 不主动加载备份列表——BackupHistory 组件内部按需加载
});
</script>

<template>
  <div class="flex h-full flex-col gap-4 overflow-auto p-4">
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-bold">{{ t('build.title') }}</h1>
      <!-- P5-4：迁移入口 -->
      <BaseButton size="sm" variant="primary" @click="handleMigrate">
        {{ t('migration.title') }}
      </BaseButton>
    </div>

    <!-- Change Set 摘要 -->
    <section class="rounded border border-gray-700 p-4">
      <h2 class="mb-2 font-semibold">{{ t('build.changeSet.title') }}</h2>
      <div v-if="pendingCount === 0" class="text-sm text-gray-500">
        {{ t('build.changeSet.empty') }}
      </div>
      <div v-else class="space-y-1">
        <div class="text-sm text-gray-400">
          {{ t('build.changeSet.pendingCount') }}：
          <span class="text-white">{{ pendingCount }}</span>
        </div>
        <div class="text-sm text-gray-400">
          {{ t('build.changeSet.affectedKinds') }}：
          <span class="text-white">{{ affectedKinds.join(', ') }}</span>
        </div>
        <ul class="mt-2 space-y-0.5 text-xs text-gray-500">
          <li v-for="entry in kindBreakdown" :key="entry.kind">
            · {{ entry.kind }}：{{ entry.count }}
          </li>
        </ul>
      </div>
    </section>

    <!-- 发布按钮 + P6 镜像校验按钮 -->
    <section class="flex flex-wrap items-center gap-2">
      <button
        :disabled="!canPublish"
        class="rounded bg-blue-600 px-4 py-2 text-white disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-500"
        @click="handlePublish"
      >
        {{ isPublishing ? t('build.publish.publishing') : t('build.publish.button') }}
      </button>

      <!-- P6 镜像校验按钮（执行案 §4.7.2） -->
      <BaseButton
        size="sm"
        variant="ghost"
        :disabled="validate.mirrorRunning"
        @click="handleRunMirror"
      >
        {{ validate.mirrorRunning ? '镜像校验运行中...' : '运行镜像校验' }}
      </BaseButton>

      <!-- P6 阻断发布提示 -->
      <span
        v-if="validate.mirrorBlockingCount > 0"
        class="text-xs text-accent-error"
      >
        镜像校验发现 {{ validate.mirrorBlockingCount }} 个阻断发布差异——已禁用发布
      </span>
    </section>

    <!-- 发布结果 -->
    <section
      v-if="lastResult"
      class="rounded border p-4"
      :class="
        lastResult.success
          ? 'border-green-700 bg-green-900/20'
          : 'border-red-700 bg-red-900/20'
      "
    >
      <h2 class="mb-2 font-semibold">
        {{ lastResult.success ? t('build.publish.success') : t('build.publish.failed') }}
      </h2>
      <div v-if="lastResult.success" class="space-y-1 text-sm text-gray-300">
        <div>{{ t('build.publish.publishedFiles', { count: lastResult.publishedFiles.length }) }}</div>
        <div v-if="lastResult.backupDir" class="break-all">
          {{ t('build.publish.backupDir') }}：{{ lastResult.backupDir }}
        </div>
      </div>
      <div v-else class="space-y-2 text-sm text-red-300">
        <div class="break-all">{{ lastResult.error }}</div>
        <div v-if="lastResult.conflicts.length" class="mt-2">
          {{ t('build.conflict.title') }}：
          <ul class="ml-5 list-disc">
            <li
              v-for="conflict in lastResult.conflicts"
              :key="conflict.filePath"
              class="break-all"
            >
              {{ conflict.filePath }}（{{ conflict.reason }}）
            </li>
          </ul>
        </div>
      </div>
    </section>

    <!-- P5-4：编译管道可视化 + P6 镜像回滚标记 -->
    <PipelineVisualization
      :steps="pipelineSteps"
      :affected-files="affectedFiles"
      :mirror-rolled-back="mirrorRolledBack"
    />

    <!-- P6 镜像校验结果段（执行案 §4.7.2） -->
    <section
      v-if="validate.mirrorResults.length > 0 || validate.mirrorRunning || mirrorRolledBack"
      class="rounded border p-4"
      :class="
        validate.mirrorBlockingCount > 0
          ? 'border-accent-error/60 bg-[color-mix(in_srgb,var(--color-accent-error)_8%,transparent)]'
          : 'border-gray-700 bg-gray-900/30'
      "
    >
      <div class="mb-2 flex items-center justify-between">
        <h2 class="font-semibold text-gray-200">镜像校验结果</h2>
        <div class="flex items-center gap-2 text-xs">
          <span
            v-if="validate.mirrorBlockingCount > 0"
            class="rounded border border-accent-error/60 px-1 py-0.5 text-accent-error"
          >
            {{ validate.mirrorBlockingCount }} 阻断
          </span>
          <span
            v-if="validate.hasMirrorBackendUnavailable"
            class="rounded border border-yellow-700 px-1 py-0.5 text-yellow-400"
          >
            部分快照不可用
          </span>
          <span
            v-if="mirrorRolledBack"
            class="rounded border border-yellow-700 bg-yellow-900/30 px-1 py-0.5 text-yellow-300"
          >
            已回滚到备份
          </span>
          <BaseButton
            v-if="validate.mirrorResults.length > 0 || mirrorRolledBack"
            size="sm"
            variant="ghost"
            :disabled="validate.mirrorRunning"
            @click="handleClearMirror"
          >
            清空
          </BaseButton>
        </div>
      </div>

      <!-- 后端不可达提示 -->
      <div
        v-if="validate.hasMirrorBackendUnavailable"
        class="mb-2 rounded border border-yellow-800 bg-yellow-900/20 px-2 py-1 text-[11px] text-yellow-300"
      >
        部分后端快照不可用，对应镜像校验已跳过——不阻断发布。请确认游戏服务器已启动、?debug=all 已启用，且镜像所需 State API scope 可用。
      </div>

      <!-- 阻断发布提示 -->
      <div
        v-if="validate.mirrorBlockingCount > 0"
        class="mb-2 rounded border border-accent-error/60 bg-[color-mix(in_srgb,var(--color-accent-error)_10%,transparent)] px-2 py-1 text-[11px] text-accent-error"
      >
        镜像校验发现 {{ validate.mirrorBlockingCount }} 个阻断发布差异——编译管道第 9 步已自动回滚到备份。
      </div>

      <!-- 回滚提示 -->
      <div
        v-if="mirrorRolledBack"
        class="mb-2 rounded border border-yellow-800 bg-yellow-900/20 px-2 py-1 text-[11px] text-yellow-300"
      >
        编译产物已回滚到备份——请修正镜像差异后重新发布。可在备份历史中查看 / 还原。
      </div>

      <!-- 镜像器对比摘要 -->
      <ul v-if="validate.mirrorStatusList.length > 0" class="space-y-0.5">
        <li
          v-for="entry in validate.mirrorStatusList"
          :key="entry.id"
          class="flex items-center gap-2 rounded border-l-2 bg-gray-900/50 px-2 py-1"
          :class="mirrorStatusClass(entry.status)"
        >
          <span class="w-3 text-center">{{ mirrorStatusGlyph(entry.status) }}</span>
          <code class="flex-1 font-mono text-[11px] text-gray-300">{{ entry.id }}</code>
          <span class="flex-1 truncate text-[10px] text-gray-500">
            {{ entry.result ? entry.result.summary : '尚未运行' }}
          </span>
        </li>
      </ul>

      <!-- 运行中提示 -->
      <div
        v-if="validate.mirrorRunning"
        class="text-[11px] text-blue-400"
      >
        镜像校验运行中——正在拉取后端权威快照与对比...
      </div>
    </section>

    <!-- P5-4：备份历史（提取为独立组件） -->
    <BackupHistory />

    <!-- P5-4：迁移确认对话框 -->
    <MigrationConfirmModal
      :open="showMigrationModal"
      @close="handleMigrationClose"
      @migrated="handleMigrationDone"
    />
  </div>
</template>
