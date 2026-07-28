<!-- @module O 内容工具箱 -->
<script setup lang="ts">
//
// AuthorResourceStatus：作者资源状态卡片（对齐执行案 §4.9.1 + §4.10.1）
//
// 设计意图：
//   - OverviewView 的"作者资源状态"卡片，显示 P5-4 单源迁移状态
//   - 未迁移：黄色"待迁移"提示 + "启动单源迁移"按钮
//   - 已迁移：绿色"已迁移"状态 + YAML 文件数 + oblivions/content/ 链接
//   - 组件挂载时自动探测迁移状态；父组件可监听 @migrate 触发迁移对话框
//
// 边界：
//   - Gateway 不可达时显示灰色"未知"状态
//   - 探测失败不阻断总览页其他卡片
//   - 迁移完成后父组件应调用 refresh() 重新探测
import { ref, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import BaseButton from '@/components/common/BaseButton.vue';
import {
  getMigrationStatus,
  GatewayUnavailableError,
} from '@/services/workspace/gateway-client';
import type { MigrationStatusResponse } from '@/services/workspace/types';

const emit = defineEmits<{ migrate: [] }>();
const { t } = useI18n();

// ─── 状态 ──────────────────────────────────────────────────────
type LoadState = 'loading' | 'loaded' | 'error';
const loadState = ref<LoadState>('loading');
const status = ref<MigrationStatusResponse | null>(null);
const errorMsg = ref<string | null>(null);

// ─── 探测迁移状态 ──────────────────────────────────────────────
async function refresh(): Promise<void> {
  loadState.value = 'loading';
  errorMsg.value = null;
  try {
    status.value = await getMigrationStatus();
    loadState.value = 'loaded';
  } catch (err) {
    errorMsg.value =
      err instanceof GatewayUnavailableError
        ? t('migration.gatewayUnavailable')
        : err instanceof Error
          ? err.message
          : String(err);
    loadState.value = 'error';
  }
}

onMounted(() => {
  void refresh();
});

// ─── 触发迁移 ──────────────────────────────────────────────────
function handleMigrate(): void {
  emit('migrate');
}

defineExpose({ refresh });
</script>

<template>
  <section
    class="rounded border p-4"
    :class="
      loadState === 'error'
        ? 'border-gray-800 bg-gray-900/50'
        : status?.migrated
          ? 'border-green-800 bg-green-900/10'
          : 'border-yellow-800 bg-yellow-900/10'
    "
  >
    <div class="mb-2 flex items-center justify-between">
      <h3 class="text-sm font-semibold text-gray-200">{{ t('authorResource.title') }}</h3>
      <span
        class="rounded px-2 py-0.5 text-xs"
        :class="
          loadState === 'error'
            ? 'bg-gray-800 text-gray-500'
            : status?.migrated
              ? 'bg-green-900/40 text-green-300'
              : 'bg-yellow-900/40 text-yellow-300'
        "
      >
        {{ loadState === 'loading'
          ? t('authorResource.loading')
          : loadState === 'error'
            ? t('authorResource.unknown')
            : status?.migrated
              ? t('authorResource.migrated')
              : t('authorResource.pending') }}
      </span>
    </div>

    <!-- 加载中 -->
    <div v-if="loadState === 'loading'" class="text-xs text-gray-500">
      {{ t('authorResource.loading') }}
    </div>

    <!-- 错误 -->
    <div v-else-if="loadState === 'error'" class="space-y-2">
      <p class="text-xs text-gray-500">{{ errorMsg }}</p>
      <BaseButton size="sm" variant="ghost" @click="refresh">
        {{ t('authorResource.retry') }}
      </BaseButton>
    </div>

    <!-- 未迁移 -->
    <div v-else-if="!status?.migrated" class="space-y-2">
      <p class="text-xs text-yellow-200/80">{{ t('authorResource.pendingDesc') }}</p>
      <BaseButton size="sm" variant="primary" @click="handleMigrate">
        {{ t('authorResource.startMigration') }}
      </BaseButton>
    </div>

    <!-- 已迁移 -->
    <div v-else class="space-y-1 text-xs text-gray-400">
      <div>
        {{ t('authorResource.yamlCount', { count: status?.yamlFileCount ?? 0 }) }}
      </div>
      <div class="font-mono text-[10px] text-gray-600">oblivions/content/</div>
      <BaseButton size="sm" variant="ghost" @click="refresh">
        {{ t('authorResource.refresh') }}
      </BaseButton>
    </div>
  </section>
</template>
