<script setup lang="ts">
// 顶部导航栏（对齐 NEW_DESIGN.md §2.2 components/layout/TopBar.vue）
// Task G3：新增 导入 / 导出 / 备份 三个按钮（独立于模态框，备份按钮直接执行不打开模态）
import { useI18n } from 'vue-i18n';
import { useUiStore } from '@/stores/uiStore';
import { useImportExport } from '@/composables/useImportExport';
import BaseButton from '@/components/common/BaseButton.vue';

const { t } = useI18n();
const ui = useUiStore();
const { backupGamedata, isExporting } = useImportExport();

function handleImport(): void {
  ui.openModal('import');
}

function handleExport(): void {
  ui.openModal('export');
}

async function handleBackup(): Promise<void> {
  await backupGamedata();
}
</script>

<template>
  <header
    class="flex items-center justify-between border-b border-gray-800 bg-gray-900 px-4 py-1.5"
  >
    <div class="flex items-center gap-3">
      <span class="text-base font-semibold text-gray-100">
        {{ t('app.title') }}
      </span>
      <span class="text-xs text-gray-500">v{{ '0.0.1' }}</span>
    </div>
    <div class="flex items-center gap-2">
      <BaseButton
        size="sm"
        variant="ghost"
        @click="handleImport"
      >
        导入
      </BaseButton>
      <BaseButton
        size="sm"
        variant="ghost"
        @click="handleExport"
      >
        导出
      </BaseButton>
      <BaseButton
        size="sm"
        variant="default"
        :disabled="isExporting"
        :title="isExporting ? '备份中...' : '把 gamedata 目录所有 .php 备份到 backup/{timestamp}/'"
        @click="handleBackup"
      >
        {{ isExporting ? '备份中...' : '备份' }}
      </BaseButton>
    </div>
  </header>
</template>
