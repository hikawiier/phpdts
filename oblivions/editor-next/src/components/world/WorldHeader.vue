<!-- @module O 内容工具箱 -->
<script setup lang="ts">
//
// WorldHeader：世界工作区顶部工具栏（对齐 P1 执行案 §4.10.1）
//
// 设计意图：
//   - 撤销/重做绑定到 historyStore（通过 useToolActions 代理，保持与 MapEditorView 一致）
//   - 4 个子 Tab 切换按钮通过 v-model 双向绑定到 WorldView 的 activeTab
//   - 工作区状态指示（isDirty / lastSaveError）来自 projectStore
//
// 边界：
//   - 子 Tab 切换不丢失未保存 Change Set（由 WorldView 用 v-show 而非 v-if 保证）
//   - 撤销/重做按钮在所有子 Tab 下都可用（historyStore 全局可访问）
//   - useEditorKeyboard 在 MapTab 内挂载，WorldHeader 不重复挂载键盘绑定
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useProjectStore } from '@/stores/projectStore';
import { useHistoryStore } from '@/stores/historyStore';
import { useUiStore } from '@/stores/uiStore';
import { useToolActions } from '@/composables/useToolActions';
import BaseButton from '@/components/common/BaseButton.vue';

defineProps<{
  /** 子 Tab 列表（key + i18n label key） */
  tabs: ReadonlyArray<{ key: string; labelKey: string }>;
  /** 当前激活的子 Tab key */
  activeTab: string;
}>();

const emit = defineEmits<{
  'update:activeTab': [tab: string];
}>();

const { t } = useI18n();
const project = useProjectStore();
const history = useHistoryStore();
const ui = useUiStore();
const actions = useToolActions();

const canUndo = computed(() => history.canUndo);
const canRedo = computed(() => history.canRedo);
const isDirty = computed(() => project.isDirty);
const lastSaveError = computed(() => project.lastSaveError);

function onUndo(): void {
  const cmd = actions.undo();
  if (cmd === null) {
    ui.showToast(t('message.undoEmpty'), 'info');
  }
}

function onRedo(): void {
  const cmd = actions.redo();
  if (cmd === null) {
    ui.showToast(t('message.redoEmpty'), 'info');
  }
}

function selectTab(key: string): void {
  emit('update:activeTab', key);
}
</script>

<template>
  <div
    class="flex items-center justify-between border-b border-gray-800 bg-gray-900 px-2 py-1"
  >
    <!-- 左：子 Tab 切换按钮 -->
    <div class="flex items-center gap-1">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        type="button"
        class="border-b-2 px-3 py-1 text-xs transition-colors"
        :class="
          activeTab === tab.key
            ? 'border-gray-400 text-gray-100'
            : 'border-transparent text-gray-500 hover:text-gray-300'
        "
        :aria-current="activeTab === tab.key ? 'page' : undefined"
        @click="selectTab(tab.key)"
      >
        {{ t(tab.labelKey) }}
      </button>
    </div>

    <!-- 右：撤销/重做 + 工作区状态 -->
    <div class="flex items-center gap-2">
      <!-- 工作区状态指示 -->
      <div class="flex items-center gap-1 text-[10px]">
        <span
          v-if="lastSaveError !== null"
          class="rounded border border-accent-error px-1 py-0.5 text-accent-error"
          :title="lastSaveError"
        >
          {{ t('world.header.saveError') }}
        </span>
        <span
          v-else-if="isDirty"
          class="rounded border border-accent-error px-1 py-0.5 text-accent-error"
        >
          {{ t('world.header.dirty') }}
        </span>
        <span v-else class="text-gray-600">{{ t('world.header.saved') }}</span>
      </div>

      <!-- 撤销/重做 -->
      <div class="flex items-center gap-1">
        <BaseButton
          size="sm"
          variant="ghost"
          :disabled="!canUndo"
          :title="t('world.header.undo')"
          @click="onUndo"
          >↶</BaseButton
        >
        <BaseButton
          size="sm"
          variant="ghost"
          :disabled="!canRedo"
          :title="t('world.header.redo')"
          @click="onRedo"
          >↷</BaseButton
        >
      </div>
    </div>
  </div>
</template>
