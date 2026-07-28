<!-- @module O 内容工具箱 -->
<script setup lang="ts">
//
// ExportModal：导出模态框（对齐 editor-next-独立化与备份还原功能-设计案 Task F）
//
// 三个导出按钮：
//   1. 写入 gamedata 目录（主按钮，突出显示）：调用 writeBackToSource（扩展后含全量文件 + 自动备份）
//   2. 导出 ZIP：调用 exportZip（全量文件打包下载）
//   3. 备份 gamedata 目录：调用 backupGamedata（备份到 backup/{timestamp}/）
//
// 字段过滤选项：默认剥离 _breaks（php-codegen 自动处理，UI 仅展示提示）
// 信息展示：区域数 / 地图格数 / 配置文件状态 / 原始缓存文件数 / 源目录句柄状态
// 预设路径提示：若 editor.config.json 配置了 gamedataPath，在写入按钮下方提示用户手动选择该目录授权写入

import { ref, computed, onMounted } from 'vue';
import { useImportExport } from '@/composables/useImportExport';
import { useUiStore } from '@/stores/uiStore';
import { useProjectStore } from '@/stores/projectStore';
import { useConfigStore } from '@/stores/configStore';
import { useRawFilesStore } from '@/stores/rawFilesStore';
import { loadPresetConfig, getCachedPresetConfig, type PresetConfig } from '@/composables/usePresetConfig';

const ui = useUiStore();
const project = useProjectStore();
const config = useConfigStore();
const rawFilesStore = useRawFilesStore();
const {
  exportZip,
  writeBackToSource,
  backupGamedata,
  isExporting,
  canExport,
  sourceDirHandle,
} = useImportExport();

// 预设路径配置（仅作为提示展示，不改变写入逻辑）
const presetConfig = ref<PresetConfig | null>(getCachedPresetConfig());

// 挂载时异步加载预设配置（与 ImportModal 共享模块级缓存）
onMounted(() => {
  if (presetConfig.value === null) {
    void loadPresetConfig().then((cfg) => {
      presetConfig.value = cfg;
    });
  }
});

// canWriteBackToSource 现在检查 rawFilesStore.sourceDirHandle，但 writeBackToSource 已扩展为
// sourceDirHandle 为 null 时让用户选目录，所以按钮始终可点击（只要有项目）
const canWrite = computed(() => canExport.value);

const regionCount = computed(() => (project.project ? Object.keys(project.project.regions).length : 0));
const tileCount = computed(() => {
  if (!project.project) return 0;
  let total = 0;
  for (const pgroup of Object.keys(project.project.tiles)) {
    const tiles = project.project.tiles[Number(pgroup) as keyof typeof project.project.tiles];
    if (tiles) total += Object.keys(tiles).length;
  }
  return total;
});

/** 已加载的配置文件数（scatter_pool / poi_table / poi_pool 中非 null 的数量） */
const loadedConfigCount = computed(() => {
  let n = 0;
  if (config.scatterPool) n++;
  if (config.poiTable) n++;
  if (config.poiPool) n++;
  return n;
});

const configStatusText = computed(() => `${loadedConfigCount.value} / 3`);

/** 原始缓存文件数（rawFilesStore.rawFiles 大小） */
const rawFileCount = computed(() => rawFilesStore.rawFileCount);

function handleClose(): void {
  ui.closeModal('export');
}

async function handleExportZip(): Promise<void> {
  await exportZip();
}

async function handleWriteToSource(): Promise<void> {
  await writeBackToSource();
}

async function handleBackupGamedata(): Promise<void> {
  await backupGamedata();
}
</script>

<template>
  <div
    v-if="ui.modals.export"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
    @click.self="handleClose"
  >
    <div class="w-[560px] bg-neutral-900 border border-neutral-700 rounded-md flex flex-col">
      <!-- 标题栏 -->
      <div class="flex items-center justify-between px-5 py-3 border-b border-neutral-700">
        <h2 class="text-base font-medium text-neutral-100">导出地图项目</h2>
        <button
          type="button"
          class="text-neutral-400 hover:text-neutral-100 transition-colors"
          @click="handleClose"
        >
          关闭
        </button>
      </div>

      <!-- 内容区 -->
      <div class="p-5 space-y-5">
        <!-- 项目信息 -->
        <div class="text-xs text-neutral-400 space-y-1">
          <p>区域数：{{ regionCount }}</p>
          <p>地图格数：{{ tileCount }}</p>
          <p>配置文件：{{ configStatusText }}（scatter_pool / poi_table / poi_pool）</p>
          <p>原始缓存文件数：{{ rawFileCount }}</p>
          <p>源目录句柄：{{ sourceDirHandle ? '可用' : '不可用（仅目录选择导入后可用）' }}</p>
        </div>

        <!-- 字段过滤提示 -->
        <div class="p-3 bg-neutral-950 border border-neutral-700 rounded text-xs text-neutral-400">
          <p class="text-neutral-300 mb-1">字段过滤</p>
          <p>导出时自动剥离编辑器专用字段 _breaks，保留所有后端字段：</p>
          <p class="text-neutral-500 mt-1 font-mono">height / destructible / preset_safe / neighbors / passable</p>
        </div>

        <!-- 导出按钮 -->
        <div class="space-y-2">
          <!-- 主按钮：写入 gamedata 目录 -->
          <button
            type="button"
            :disabled="!canWrite"
            class="w-full px-4 py-2.5 text-sm bg-neutral-100 text-neutral-900 rounded hover:bg-neutral-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
            @click="handleWriteToSource"
          >
            {{ isExporting ? '写入中...' : '写入 gamedata 目录' }}
          </button>
          <p class="text-xs text-neutral-500">
            备份旧文件为 ZIP 下载，再覆盖写入源目录全部文件（map + tiles + 配置 + 原始缓存）
          </p>
          <!-- 预设路径提示（仅 editor.config.json 存在且 gamedataPath 非空时显示） -->
          <p
            v-if="presetConfig && presetConfig.gamedataPath"
            class="text-xs text-neutral-400 font-mono"
          >
            预设路径：{{ presetConfig.gamedataPath }}（需手动选择该目录授权写入）
          </p>

          <!-- 导出 ZIP -->
          <button
            type="button"
            :disabled="!canExport"
            class="w-full px-4 py-2.5 text-sm border border-neutral-600 text-neutral-200 rounded hover:bg-neutral-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            @click="handleExportZip"
          >
            {{ isExporting ? '导出中...' : '导出 ZIP' }}
          </button>
          <p class="text-xs text-neutral-500">
            打包全部文件为 ZIP 下载（map + tiles + 配置 + 原始缓存）
          </p>

          <!-- 备份 gamedata 目录 -->
          <button
            type="button"
            :disabled="isExporting"
            class="w-full px-4 py-2.5 text-sm border border-neutral-600 text-neutral-200 rounded hover:bg-neutral-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            @click="handleBackupGamedata"
          >
            {{ isExporting ? '备份中...' : '备份 gamedata 目录' }}
          </button>
          <p class="text-xs text-neutral-500">
            选择源目录 + 目标目录，把所有 .php 复制到 backup/{timestamp}/ 子目录
          </p>
        </div>
      </div>

      <!-- 底部按钮 -->
      <div class="flex justify-end gap-2 px-5 py-3 border-t border-neutral-700">
        <button
          type="button"
          class="px-4 py-2 text-sm text-neutral-300 hover:text-neutral-100 transition-colors"
          @click="handleClose"
        >
          关闭
        </button>
      </div>
    </div>
  </div>
</template>
