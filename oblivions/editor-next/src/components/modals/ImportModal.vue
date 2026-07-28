<!-- @module O 内容工具箱 -->
<script setup lang="ts">
//
// ImportModal：导入模态框（对齐 editor-next-独立化与备份还原功能-设计案 Task E + H4）
//
// 五种导入方式 Tab 切换（顺序：directory / restore / drop / webkitdirectory / paste）：
//   1. 从 gamedata 目录读取（默认，FSAA 首选 + webkitdirectory 回退）
//      └─ 附"使用预设路径"按钮（开发环境：通过 editor.config.json + vite /@fs/ 一键导入）
//   2. 从备份还原（Task H4：选备份目录 → 列时间戳 → 选目标 → 还原）
//   3. 拖拽导入
//   4. 文件夹上传（webkitdirectory 显式回退）
//   5. 手动粘贴
//
// 解析进度条（Worker 异步）：stage / current / total / message
// 解析错误展示：行号 + 列号 + 期望 token（来自 PhpParseError）

import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useImportExport } from '@/composables/useImportExport';
import { useUiStore } from '@/stores/uiStore';
import { loadPresetConfig, getCachedPresetConfig, type PresetConfig } from '@/composables/usePresetConfig';

type ImportTab = 'directory' | 'restore' | 'drop' | 'webkitdirectory' | 'paste';

const ui = useUiStore();
const {
  importFromDirectory,
  importFromPaste,
  importFromDrop,
  importFromPresetPath,
  listBackups,
  restoreFromBackup,
  importProgress,
  isImporting,
  resetProgress,
  dispose,
} = useImportExport();

const activeTab = ref<ImportTab>('directory');
const pasteText = ref('');
const pasteFilenames = ref(''); // 可选：每行一个文件名，与 --- 分段一一对应
const isDragOver = ref(false);

// restore Tab 状态
const backups = ref<string[]>([]);
const selectedBackup = ref<string | null>(null);
const isListingBackups = ref(false);
const isRestoring = ref(false);

// 预设路径配置（开发环境从 /editor.config.json 加载）
const presetConfig = ref<PresetConfig | null>(getCachedPresetConfig());

const progressPercent = computed(() => {
  if (importProgress.value.total === 0) return 0;
  return Math.min(100, Math.round((importProgress.value.current / importProgress.value.total) * 100));
});

const hasError = computed(() => importProgress.value.stage === 'error');
const isDone = computed(() => importProgress.value.stage === 'done');

// 挂载时异步加载预设配置（仅开发环境有 /editor.config.json，生产环境返回 null 静默降级）
onMounted(() => {
  if (presetConfig.value === null) {
    void loadPresetConfig().then((cfg) => {
      presetConfig.value = cfg;
    });
  }
});

function handleClose(): void {
  ui.closeModal('import');
  resetProgress();
  pasteText.value = '';
  pasteFilenames.value = '';
  // 重置 restore Tab 状态
  backups.value = [];
  selectedBackup.value = null;
}

async function handleDirectoryImport(): Promise<void> {
  await importFromDirectory();
  if (isDone.value) handleClose();
}

async function handlePasteImport(): Promise<void> {
  const filenames = pasteFilenames.value.trim()
    ? pasteFilenames.value.trim().split(/\n+/).map((s) => s.trim()).filter(Boolean)
    : undefined;
  await importFromPaste(pasteText.value, filenames);
  if (isDone.value) handleClose();
}

function handleDragOver(event: DragEvent): void {
  event.preventDefault();
  event.stopPropagation();
  isDragOver.value = true;
}

function handleDragLeave(event: DragEvent): void {
  event.preventDefault();
  event.stopPropagation();
  isDragOver.value = false;
}

async function handleDrop(event: DragEvent): Promise<void> {
  event.preventDefault();
  event.stopPropagation();
  isDragOver.value = false;
  if (!event.dataTransfer) return;
  await importFromDrop(event.dataTransfer);
  if (isDone.value) handleClose();
}

// ─── 预设路径导入 ──────────────────────────────────────

async function handlePresetImport(): Promise<void> {
  await importFromPresetPath(presetConfig.value);
  if (isDone.value) handleClose();
}

// ─── restore Tab 交互 ──────────────────────────────────

async function handleListBackups(): Promise<void> {
  isListingBackups.value = true;
  try {
    const result = await listBackups();
    if (result) {
      backups.value = result.backups;
      selectedBackup.value = null;
    }
  } finally {
    isListingBackups.value = false;
  }
}

function handleSelectBackup(name: string): void {
  selectedBackup.value = name;
}

async function handleRestore(): Promise<void> {
  if (!selectedBackup.value) return;
  isRestoring.value = true;
  try {
    await restoreFromBackup(selectedBackup.value);
    if (isDone.value) handleClose();
  } finally {
    isRestoring.value = false;
  }
}

onUnmounted(() => {
  dispose();
});
</script>

<template>
  <div
    v-if="ui.modals.import"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
    @click.self="handleClose"
  >
    <div class="w-[720px] max-h-[80vh] bg-neutral-900 border border-neutral-700 rounded-md flex flex-col">
      <!-- 标题栏 -->
      <div class="flex items-center justify-between px-5 py-3 border-b border-neutral-700">
        <h2 class="text-base font-medium text-neutral-100">导入地图项目</h2>
        <button
          type="button"
          class="text-neutral-400 hover:text-neutral-100 transition-colors"
          @click="handleClose"
        >
          关闭
        </button>
      </div>

      <!-- Tab 切换：directory / restore / drop / webkitdirectory / paste -->
      <div class="flex border-b border-neutral-700">
        <button
          type="button"
          :class="[
            'px-4 py-2 text-sm transition-colors border-b-2',
            activeTab === 'directory'
              ? 'text-neutral-100 border-neutral-100'
              : 'text-neutral-400 border-transparent hover:text-neutral-200',
          ]"
          @click="activeTab = 'directory'"
        >
          从目录读取
        </button>
        <button
          type="button"
          :class="[
            'px-4 py-2 text-sm transition-colors border-b-2',
            activeTab === 'restore'
              ? 'text-neutral-100 border-neutral-100'
              : 'text-neutral-400 border-transparent hover:text-neutral-200',
          ]"
          @click="activeTab = 'restore'"
        >
          从备份还原
        </button>
        <button
          type="button"
          :class="[
            'px-4 py-2 text-sm transition-colors border-b-2',
            activeTab === 'drop'
              ? 'text-neutral-100 border-neutral-100'
              : 'text-neutral-400 border-transparent hover:text-neutral-200',
          ]"
          @click="activeTab = 'drop'"
        >
          拖拽导入
        </button>
        <button
          type="button"
          :class="[
            'px-4 py-2 text-sm transition-colors border-b-2',
            activeTab === 'webkitdirectory'
              ? 'text-neutral-100 border-neutral-100'
              : 'text-neutral-400 border-transparent hover:text-neutral-200',
          ]"
          @click="activeTab = 'webkitdirectory'"
        >
          文件夹上传
        </button>
        <button
          type="button"
          :class="[
            'px-4 py-2 text-sm transition-colors border-b-2',
            activeTab === 'paste'
              ? 'text-neutral-100 border-neutral-100'
              : 'text-neutral-400 border-transparent hover:text-neutral-200',
          ]"
          @click="activeTab = 'paste'"
        >
          手动粘贴
        </button>
      </div>

      <!-- 内容区 -->
      <div class="flex-1 overflow-y-auto p-5">
        <!-- 从目录读取（默认） -->
        <div v-if="activeTab === 'directory'" class="space-y-4">
          <p class="text-sm text-neutral-300 leading-relaxed">
            选择 oblivions/gamedata 目录（含 map.php + tiles/ + 配置文件 + combat_skills/）。
            编辑器解析支持的文件，其他作为原始字符串缓存（导出时原样写出）。
          </p>

          <!-- 使用预设路径（仅 editor.config.json 存在且 gamedataPath 非空时显示） -->
          <div v-if="presetConfig && presetConfig.gamedataPath" class="p-3 bg-neutral-950 border border-neutral-700 rounded">
            <button
              type="button"
              :disabled="isImporting"
              class="w-full px-4 py-2 text-sm bg-neutral-100 text-neutral-900 rounded hover:bg-neutral-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              @click="handlePresetImport"
            >
              {{ isImporting ? '解析中...' : `使用预设路径（${presetConfig.gamedataPath}）` }}
            </button>
            <p class="text-xs text-neutral-500 mt-2">
              开发环境一键导入：通过 vite /@fs/ 直接读取预设路径下的 .php 文件，无需选择目录
            </p>
          </div>

          <div class="flex gap-2">
            <button
              type="button"
              :disabled="isImporting"
              class="px-4 py-2 text-sm bg-neutral-100 text-neutral-900 rounded hover:bg-neutral-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              @click="handleDirectoryImport"
            >
              {{ isImporting ? '解析中...' : '选择 gamedata 目录' }}
            </button>
          </div>
        </div>

        <!-- 从备份还原 -->
        <div v-else-if="activeTab === 'restore'" class="space-y-4">
          <p class="text-sm text-neutral-300 leading-relaxed">
            从 oblivions/gamedata/backup/{timestamp}/ 还原 gamedata 状态。
            支持编辑器生成的时间戳子目录 + 后端生成的 ZIP 备份。
            还原前会自动提示备份当前 gamedata 状态，避免数据丢失。
          </p>

          <!-- 步骤 1：选择备份目录 -->
          <div>
            <button
              type="button"
              :disabled="isListingBackups"
              class="px-4 py-2 text-sm bg-neutral-100 text-neutral-900 rounded hover:bg-neutral-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              @click="handleListBackups"
            >
              {{ isListingBackups ? '读取中...' : '选择备份目录' }}
            </button>
          </div>

          <!-- 步骤 2：备份列表（点击选择） -->
          <div v-if="backups.length > 0" class="space-y-2">
            <p class="text-xs text-neutral-400">点击选择一个备份：</p>
            <div class="border border-neutral-700 rounded max-h-60 overflow-y-auto">
              <button
                v-for="name in backups"
                :key="name"
                type="button"
                :class="[
                  'w-full text-left px-3 py-2 text-sm font-mono transition-colors',
                  selectedBackup === name
                    ? 'bg-neutral-100 text-neutral-900'
                    : 'text-neutral-300 hover:bg-neutral-800',
                ]"
                @click="handleSelectBackup(name)"
              >
                {{ name }}
              </button>
            </div>
          </div>

          <!-- 步骤 3：还原按钮 -->
          <div v-if="selectedBackup">
            <button
              type="button"
              :disabled="isRestoring"
              class="px-4 py-2 text-sm bg-neutral-100 text-neutral-900 rounded hover:bg-neutral-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              @click="handleRestore"
            >
              {{ isRestoring ? '还原中...' : `从 ${selectedBackup} 还原` }}
            </button>
            <p class="text-xs text-neutral-500 mt-2">
              点击还原后会依次提示：选择目标 gamedata 目录 → 备份当前状态 → 还原文件
            </p>
          </div>
        </div>

        <!-- 拖拽 -->
        <div v-else-if="activeTab === 'drop'">
          <div
            :class="[
              'border-2 border-dashed rounded-md p-12 text-center transition-colors',
              isDragOver
                ? 'border-neutral-100 bg-neutral-800/50'
                : 'border-neutral-700 hover:border-neutral-500',
            ]"
            @dragover="handleDragOver"
            @dragleave="handleDragLeave"
            @drop="handleDrop"
          >
            <p class="text-sm text-neutral-300 mb-2">
              将 gamedata 目录或 .php 文件拖到此处
            </p>
            <p class="text-xs text-neutral-500">
              递归读取 webkitGetAsEntry，支持目录与文件混合拖入
            </p>
          </div>
        </div>

        <!-- webkitdirectory -->
        <div v-else-if="activeTab === 'webkitdirectory'" class="space-y-4">
          <p class="text-sm text-neutral-300 leading-relaxed">
            浏览器不支持 File System Access API 时的回退路径。
            使用 &lt;input webkitdirectory&gt; 选择目录，仅支持读取，无法快速写回源目录。
          </p>
          <button
            type="button"
            :disabled="isImporting"
            class="px-4 py-2 text-sm bg-neutral-100 text-neutral-900 rounded hover:bg-neutral-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            @click="handleDirectoryImport"
          >
            {{ isImporting ? '解析中...' : '选择文件夹' }}
          </button>
        </div>

        <!-- 手动粘贴 -->
        <div v-else-if="activeTab === 'paste'" class="space-y-3">
          <p class="text-sm text-neutral-300 leading-relaxed">
            手动粘贴 PHP 文件内容，多个文件用 <code class="px-1 py-0.5 bg-neutral-800 rounded text-xs">--- （单独一行）</code> 分隔。
            第一段建议为 map.php 内容，后续段落为 tiles/region_*.php。
          </p>
          <textarea
            v-model="pasteText"
            class="w-full h-64 px-3 py-2 bg-neutral-950 border border-neutral-700 rounded text-sm font-mono text-neutral-100 focus:outline-none focus:border-neutral-500 resize-none"
            placeholder="return [&#10;    'regions' => [...],&#10;    'grids' => [...],&#10;];&#10;---&#10;return [&#10;    1 => [...],&#10;    2 => [...],&#10;];"
            :disabled="isImporting"
          />
          <details class="text-xs text-neutral-400">
            <summary class="cursor-pointer hover:text-neutral-200">高级：自定义文件名（每行一个，与分段一一对应）</summary>
            <textarea
              v-model="pasteFilenames"
              class="w-full h-20 mt-1 px-3 py-2 bg-neutral-950 border border-neutral-700 rounded text-xs font-mono text-neutral-100 focus:outline-none focus:border-neutral-500 resize-none"
              placeholder="map.php&#10;tiles/region_1.php&#10;tiles/region_2.php"
              :disabled="isImporting"
            />
          </details>
          <button
            type="button"
            :disabled="isImporting || !pasteText.trim()"
            class="px-4 py-2 text-sm bg-neutral-100 text-neutral-900 rounded hover:bg-neutral-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            @click="handlePasteImport"
          >
            {{ isImporting ? '解析中...' : '解析并导入' }}
          </button>
        </div>

        <!-- 进度条 -->
        <div v-if="isImporting || isDone || hasError" class="mt-5 pt-4 border-t border-neutral-700">
          <div class="flex items-center justify-between mb-2">
            <span class="text-xs text-neutral-400">{{ importProgress.message }}</span>
            <span class="text-xs text-neutral-500">{{ progressPercent }}%</span>
          </div>
          <div class="w-full h-1.5 bg-neutral-800 rounded overflow-hidden">
            <div
              :class="[
                'h-full transition-all duration-200',
                hasError ? 'bg-neutral-400' : 'bg-neutral-100',
              ]"
              :style="{ width: `${progressPercent}%` }"
            />
          </div>
          <div v-if="hasError && importProgress.error" class="mt-3 p-3 bg-neutral-950 border border-neutral-700 rounded text-xs">
            <p class="text-neutral-300 mb-1">解析失败：</p>
            <p class="text-neutral-400 font-mono">{{ importProgress.error.message }}</p>
            <p
              v-if="importProgress.error.line !== undefined || importProgress.error.column !== undefined"
              class="text-neutral-500 mt-1"
            >
              位置：行 {{ importProgress.error.line ?? '?' }}，列 {{ importProgress.error.column ?? '?' }}
              <span v-if="importProgress.error.expected">
                （期望 {{ importProgress.error.expected }}）
              </span>
            </p>
          </div>
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
