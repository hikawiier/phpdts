<!-- @module O 内容工具箱 -->
<script setup lang="ts">
// 根组件：布局壳（TopBar + SideNav + RouterView + StatusBar），对齐 NEW_DESIGN.md §2.2
// Task G4：挂载 ImportModal / ExportModal（全局可见，由 ui.modals 控制显隐）
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import TopBar from '@/components/layout/TopBar.vue';
import SideNav from '@/components/layout/SideNav.vue';
import StatusBar from '@/components/layout/StatusBar.vue';
import ImportModal from '@/components/modals/ImportModal.vue';
import ExportModal from '@/components/modals/ExportModal.vue';

const route = useRoute();
const { t } = useI18n();

const pageTitle = computed(() => {
  const key = route.meta.titleKey as string | undefined;
  return key ? t(key) : '';
});
</script>

<template>
  <div class="flex h-full w-full flex-col bg-gray-900 text-gray-100">
    <TopBar />
    <div class="flex flex-1 min-h-0">
      <SideNav />
      <main class="flex flex-1 min-w-0 flex-col">
        <div
          class="flex items-center border-b border-gray-800 bg-gray-900 px-4 py-2 text-sm text-gray-300"
        >
          <span>{{ pageTitle }}</span>
        </div>
        <div class="flex-1 min-h-0 overflow-auto">
          <RouterView />
        </div>
      </main>
    </div>
    <StatusBar />
    <ImportModal />
    <ExportModal />
  </div>
</template>
