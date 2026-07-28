<!-- @module O 内容工具箱 -->
<script setup lang="ts">
// 底部状态栏（对齐 NEW_DESIGN.md §2.2 components/layout/StatusBar.vue）
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useProjectStore } from '@/stores/projectStore';
import { useValidateStore } from '@/stores/validateStore';

const { t } = useI18n();
const project = useProjectStore();
const validate = useValidateStore();

const regionCount = computed(() =>
  project.project ? Object.keys(project.project.regions).length : 0,
);
const errorCount = computed(
  () => validate.issues.filter((issue) => issue.severity === 'error').length,
);
const warningCount = computed(
  () => validate.issues.filter((issue) => issue.severity === 'warning').length,
);
const dirtyLabel = computed(() => (project.isDirty ? '*' : ''));
</script>

<template>
  <footer
    class="flex items-center justify-between border-t border-gray-800 bg-gray-900 px-4 py-1 text-xs text-gray-400"
  >
    <div class="flex items-center gap-3">
      <span>{{ t('nav.map') }}: {{ regionCount }}{{ dirtyLabel }}</span>
      <span v-if="errorCount > 0" class="text-accent-error">
        {{ errorCount }} {{ t('validate.severity.error') }}
      </span>
      <span v-if="warningCount > 0" class="text-gray-300">
        {{ warningCount }} {{ t('validate.severity.warning') }}
      </span>
    </div>
  </footer>
</template>
