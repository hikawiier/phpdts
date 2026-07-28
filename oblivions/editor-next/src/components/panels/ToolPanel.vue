<!-- @module O 内容工具箱 -->
<script setup lang="ts">
// ToolPanel：工具栏（对齐 NEW_DESIGN.md §3.1.4）
//
// 7 个编辑工具按钮 + 快捷键提示（灰阶基底，对齐 2.15）
// sim-player / sim-explore 不在本面板（由 SimulatePanel 管理，C-2 整合进 MapEditorView）

import { computed } from 'vue';
import { useToolStore, EDITOR_TOOL_LIST, TOOL_SHORTCUT_LABELS } from '@/stores/toolStore';
import type { ToolId } from '@/stores/toolStore';
import { useI18n } from 'vue-i18n';

const tool = useToolStore();
const { t } = useI18n();

interface ToolItem {
  readonly id: ToolId;
  readonly labelKey: string;
  readonly shortcut: string | undefined;
}

const items = computed<ToolItem[]>(() =>
  EDITOR_TOOL_LIST.map((id) => ({
    id,
    labelKey: `tool.${id}`,
    shortcut: TOOL_SHORTCUT_LABELS[id],
  })),
);

function select(id: ToolId): void {
  tool.setTool(id);
}

function isActive(id: ToolId): boolean {
  return tool.current === id;
}
</script>

<template>
  <div class="flex flex-col gap-1 border-b border-gray-800 bg-gray-900 p-2">
    <div class="text-xs text-gray-500">{{ t('nav.map') }}</div>
    <div class="grid grid-cols-4 gap-1">
      <button
        v-for="item in items"
        :key="item.id"
        type="button"
        class="flex flex-col items-center justify-center rounded border px-2 py-1 text-xs transition-colors"
        :class="
          isActive(item.id)
            ? 'border-gray-400 bg-gray-700 text-gray-100'
            : 'border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700'
        "
        :title="t(item.labelKey)"
        @click="select(item.id)"
      >
        <span>{{ t(item.labelKey) }}</span>
        <span v-if="item.shortcut" class="text-[10px] text-gray-500">{{ item.shortcut }}</span>
      </button>
    </div>
  </div>
</template>
