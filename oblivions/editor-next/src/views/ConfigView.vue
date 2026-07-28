<!-- @module O 内容工具箱 -->
<script setup lang="ts">
//
// ConfigView：配置编辑视图（对齐 NEW_DESIGN.md §3.4 + §3.4.4 + §3.4.5）
//
// 研判：
//   - 配置编辑框架的视图入口
//   - 复用 ConfigPanel / BaseModal / BaseButton / zip-bundle
//   - M7 后端保存调用 configStore.toPhpFiles()，由 generateConfigPhp 反向生成
//
// 设计意图（对齐 2.6 配置驱动 + 2.15 视觉 + §3.4.4 边界案例）：
//   - 顶部工具栏：加载 / 导出 ZIP / 重置 / dirty 状态指示
//   - 主内容：ConfigPanel（三子 Tab + obl_config 只读）
//   - 加载模态框：4 个 textarea 分别粘贴 4 个 PHP 文件内容
//   - 视觉对齐 2.15：灰阶基底 + 唯一强调色（accent-error 仅用于错误 / dirty 提示）
//   - 内存缓存：所有操作仅修改 configStore 内存状态，需通过导出按钮持久化
//
// 数据流：
//   - 加载：textarea → config.loadFromPhpStrings(files)
//   - 导出：config.toPhpFiles() → bundleZip → downloadZip
//   - 重置：config.reset()
//   - 单一数据源：configStore（无本地副本）

import { ref, computed } from 'vue';
import { useConfigStore } from '@/stores/configStore';
import { useUiStore } from '@/stores/uiStore';
import ConfigPanel from '@/components/panels/ConfigPanel.vue';
import BaseButton from '@/components/common/BaseButton.vue';
import BaseModal from '@/components/common/BaseModal.vue';
import { bundleZip, downloadZip, generateExportFilename } from '@/services/zip-bundle';
import type { FileEntry } from '@/services/file-io';

const config = useConfigStore();
const ui = useUiStore();

// ─── 加载模态框状态 ────────────────────────────────────
const isLoadModalOpen = ref(false);
const pasteScatterPool = ref('');
const pastePoiTable = ref('');
const pastePoiPool = ref('');
const pasteOblConfig = ref('');

const hasAnyConfig = computed(() => config.hasConfig || config.oblConfig !== null);
const isDirty = computed(() => config.isDirty);

// ─── 加载逻辑 ──────────────────────────────────────────

function openLoadModal(): void {
  isLoadModalOpen.value = true;
}

function closeLoadModal(): void {
  isLoadModalOpen.value = false;
}

/**
 * 加载粘贴的配置文件到 configStore
 *
 * 跳过空文本（未粘贴的文件不被加载，保留已加载的旧数据）
 */
function handleLoadFromPaste(): void {
  const files: Record<string, string> = {};
  if (pasteScatterPool.value.trim()) files['scatter_pool.php'] = pasteScatterPool.value.trim();
  if (pastePoiTable.value.trim()) files['poi_table.php'] = pastePoiTable.value.trim();
  if (pastePoiPool.value.trim()) files['poi_pool.php'] = pastePoiPool.value.trim();
  if (pasteOblConfig.value.trim()) files['obl_config.php'] = pasteOblConfig.value.trim();

  if (Object.keys(files).length === 0) {
    ui.showToast('请至少粘贴一个配置文件内容', 'error');
    return;
  }

  const result = config.loadFromPhpStrings(files);
  if (result.ok) {
    ui.showToast(`加载成功：${result.loaded.length} 个文件`, 'success');
    isLoadModalOpen.value = false;
    // 清空 textarea
    pasteScatterPool.value = '';
    pastePoiTable.value = '';
    pastePoiPool.value = '';
    pasteOblConfig.value = '';
  } else {
    const errorFiles = Object.keys(result.errors).join(', ');
    ui.showToast(`部分文件解析失败：${errorFiles}`, 'error');
  }
}

// ─── 导出逻辑 ──────────────────────────────────────────

/**
 * 导出为 ZIP（受 AI 约束守卫，对齐 §3.9 + O-7）
 *
 * configStore.toPhpFiles() 返回 scatter_pool / poi_table / poi_pool 三个文件
 * （obl_config 不参与导出，对齐 §3.4.4 边界案例）
 */
async function handleExportZip(): Promise<void> {
  if (!hasAnyConfig.value) {
    ui.showToast('无可导出的配置', 'error');
    return;
  }
  const files = config.toPhpFiles();
  if (Object.keys(files).length === 0) {
    ui.showToast('无可导出的配置', 'error');
    return;
  }
  try {
    const entries: FileEntry[] = Object.entries(files).map(([path, content]) => ({
      path,
      content,
    }));
    const blob = await bundleZip(entries);
    const filename = generateExportFilename('oblivions_config');
    await downloadZip(blob, filename);
    config.markSaved();
    ui.showToast(`已导出 ${filename}`, 'success');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ui.showToast(`导出失败：${message}`, 'error');
  }
}

// ─── 重置逻辑 ──────────────────────────────────────────

function handleReset(): void {
  ui.openConfirm('确认重置所有配置缓存？未保存的修改将丢失。', () => {
    config.reset();
    ui.showToast('配置缓存已清空', 'success');
  });
}
</script>

<template>
  <div class="flex h-full flex-col gap-2 overflow-hidden">
    <!-- 顶部工具栏 -->
    <div class="flex items-center justify-between border-b border-gray-800 px-2 py-1">
      <div class="flex items-center gap-2 text-xs">
        <span class="text-gray-300">配置编辑</span>
        <span
          v-if="isDirty"
          class="rounded border border-accent-error px-1 py-0.5 text-[10px] text-accent-error"
        >
          未保存
        </span>
        <span v-else-if="hasAnyConfig" class="text-[10px] text-gray-600">已保存</span>
        <!-- P1 阶段 obl_config 只读提示 -->
        <span
          class="rounded border border-gray-700 bg-gray-800 px-1 py-0.5 text-[10px] text-gray-400"
          title="本节为只读展示，P1 阶段不可编辑；config.runtime 资源节点由 Resource Graph 装配时填充"
        >
          obl_config 只读
        </span>
      </div>
      <div class="flex items-center gap-1">
        <BaseButton size="sm" variant="default" @click="openLoadModal">加载</BaseButton>
        <BaseButton
          size="sm"
          variant="primary"
          :disabled="!hasAnyConfig"
          @click="handleExportZip"
        >
          导出 ZIP
        </BaseButton>
        <BaseButton
          size="sm"
          variant="ghost"
          :disabled="!hasAnyConfig"
          @click="handleReset"
        >
          重置
        </BaseButton>
      </div>
    </div>

    <!-- 主内容：ConfigPanel -->
    <div class="flex-1 overflow-hidden">
      <ConfigPanel />
    </div>

    <!-- 加载模态框 -->
    <BaseModal
      :open="isLoadModalOpen"
      title="加载配置文件（粘贴 PHP 内容）"
      class="max-w-3xl"
    >
      <div class="flex flex-col gap-3">
        <div class="flex flex-col gap-1">
          <label class="text-xs text-gray-400">scatter_pool.php</label>
          <textarea
            v-model="pasteScatterPool"
            rows="4"
            placeholder="粘贴 scatter_pool.php 内容（&lt;?php return [...];）"
            class="w-full rounded border border-gray-700 bg-gray-900 px-2 py-1 font-mono text-xs text-gray-100 placeholder-gray-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gray-400"
          />
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-xs text-gray-400">poi_table.php</label>
          <textarea
            v-model="pastePoiTable"
            rows="4"
            placeholder="粘贴 poi_table.php 内容"
            class="w-full rounded border border-gray-700 bg-gray-900 px-2 py-1 font-mono text-xs text-gray-100 placeholder-gray-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gray-400"
          />
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-xs text-gray-400">poi_pool.php</label>
          <textarea
            v-model="pastePoiPool"
            rows="4"
            placeholder="粘贴 poi_pool.php 内容"
            class="w-full rounded border border-gray-700 bg-gray-900 px-2 py-1 font-mono text-xs text-gray-100 placeholder-gray-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gray-400"
          />
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-xs text-gray-400">obl_config.php（只读）</label>
          <textarea
            v-model="pasteOblConfig"
            rows="4"
            placeholder="粘贴 obl_config.php 内容（仅展示，不编辑）"
            class="w-full rounded border border-gray-700 bg-gray-900 px-2 py-1 font-mono text-xs text-gray-100 placeholder-gray-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gray-400"
          />
        </div>
      </div>
      <template #footer>
        <BaseButton size="sm" variant="ghost" @click="closeLoadModal">取消</BaseButton>
        <BaseButton size="sm" variant="primary" @click="handleLoadFromPaste">加载</BaseButton>
      </template>
    </BaseModal>
  </div>
</template>
