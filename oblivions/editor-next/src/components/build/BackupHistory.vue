<!-- @module O 内容工具箱 -->
<script setup lang="ts">
//
// BackupHistory：备份历史列表（对齐执行案 §4.9.2 + §4.6.5）
//
// 设计意图：
//   - 从 BuildView 提取的备份历史组件，支持独立展开/收起
//   - 列出 Gateway 备份目录下所有备份（按时间倒序）
//   - 显示备份名、文件数、创建时间
//   - 支持还原操作（二次确认）
//   - 还原成功后 emit 'restored'，父组件刷新状态
//
// 边界：
//   - Gateway 不可达时显示错误，不阻断页面
//   - 还原前 confirm 确认（未发布的 Change Set 会丢失）
//   - 还原中禁用按钮
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import BaseButton from '@/components/common/BaseButton.vue';
import {
  listBackups as gatewayListBackups,
  restoreBackup as gatewayRestoreBackup,
  GatewayUnavailableError,
} from '@/services/workspace/gateway-client';
import type { BackupInfo } from '@/build/atomic-publisher';

const emit = defineEmits<{ restored: [name: string] }>();
const { t } = useI18n();

// ─── 状态 ──────────────────────────────────────────────────────
const backups = ref<BackupInfo[]>([]);
const isLoading = ref(false);
const isRestoring = ref(false);
const errorMsg = ref<string | null>(null);
const loaded = ref(false);

// ─── 加载备份列表 ──────────────────────────────────────────────
async function loadBackups(): Promise<void> {
  if (isLoading.value) return;
  isLoading.value = true;
  errorMsg.value = null;
  try {
    backups.value = await gatewayListBackups();
    loaded.value = true;
  } catch (err) {
    errorMsg.value =
      err instanceof GatewayUnavailableError
        ? t('build.publish.gatewayUnavailable')
        : err instanceof Error
          ? err.message
          : String(err);
    backups.value = [];
  } finally {
    isLoading.value = false;
  }
}

// ─── 还原备份 ──────────────────────────────────────────────────
async function handleRestore(name: string): Promise<void> {
  if (isRestoring.value) return;
  if (!window.confirm(t('build.backup.restoreConfirm', { name }))) return;
  isRestoring.value = true;
  try {
    await gatewayRestoreBackup(name);
    await loadBackups();
    emit('restored', name);
  } catch (err) {
    errorMsg.value =
      err instanceof GatewayUnavailableError
        ? t('build.publish.gatewayUnavailable')
        : err instanceof Error
          ? err.message
          : String(err);
  } finally {
    isRestoring.value = false;
  }
}

// ─── 时间格式化 ────────────────────────────────────────────────
function formatTimestamp(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return '—';
  }
}

defineExpose({ loadBackups });
</script>

<template>
  <section class="rounded border border-gray-700 p-4">
    <div class="mb-2 flex items-center justify-between">
      <h2 class="font-semibold text-gray-200">{{ t('build.backup.title') }}</h2>
      <BaseButton size="sm" variant="ghost" :disabled="isLoading" @click="loadBackups">
        {{ t('build.backup.refresh') }}
      </BaseButton>
    </div>

    <!-- 加载中 -->
    <div v-if="isLoading && !loaded" class="text-sm text-gray-500">
      {{ t('build.backup.loading') }}
    </div>

    <!-- 错误 -->
    <div v-else-if="errorMsg" class="text-sm text-red-400">{{ errorMsg }}</div>

    <!-- 空列表 -->
    <div v-else-if="loaded && backups.length === 0" class="text-sm text-gray-500">
      {{ t('build.backup.empty') }}
    </div>

    <!-- 备份列表 -->
    <ul v-else-if="loaded" class="space-y-1">
      <li
        v-for="backup in backups"
        :key="backup.name"
        class="flex flex-wrap items-center justify-between gap-2 rounded border border-gray-800 px-2 py-1.5 text-sm"
      >
        <div class="flex flex-col">
          <span class="font-mono text-xs text-gray-300">{{ backup.name }}</span>
          <span class="text-xs text-gray-500">
            {{ t('build.backup.fileCount', { count: backup.fileCount }) }}
            · {{ formatTimestamp(backup.createdAt) }}
          </span>
        </div>
        <BaseButton
          size="sm"
          variant="ghost"
          :disabled="isRestoring"
          @click="handleRestore(backup.name)"
        >
          {{ t('build.backup.restore') }}
        </BaseButton>
      </li>
    </ul>

    <!-- 未加载提示 -->
    <div v-else class="text-sm text-gray-500">
      <BaseButton size="sm" variant="ghost" @click="loadBackups">
        {{ t('build.backup.load') }}
      </BaseButton>
    </div>
  </section>
</template>
