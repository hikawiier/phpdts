<!-- @module O 内容工具箱 -->
<script setup lang="ts">
//
// WorldView：世界工作区入口（对齐 P1 执行案 §4.10.1 + O-6 §4.6.4）
//
// 设计意图：
//   - 整合 4 个子 Tab：地图 / 生成 / 模拟 / 配置
//   - 旧 /map 与 /generators 路由在此归并为一等公民的工作区
//   - 模拟面板与生成器面板作为世界工作区的命令，而非独立视图
//   - 子 Tab 切换不丢失未保存 Change Set（v-show 而非 v-if）
//   - 子 Tab 选择持久化到 localStorage + URL query
//
// 边界：
//   - 旧 /map /generators /config /validate 路由在 P1 迁移期保留兼容重定向
//   - useEditorKeyboard 在 MapTab 内挂载（v-show 切换不卸载，键盘绑定保持）
//   - 顶层 WorldView 调用 project.loadFromStorage 恢复元数据（避免子 Tab 重复加载）
import { ref, watch, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import WorldHeader from '@/components/world/WorldHeader.vue';
import MapTab from '@/components/world/MapTab.vue';
import GeneratorTab from '@/components/world/GeneratorTab.vue';
import SimulateTab from '@/components/world/SimulateTab.vue';
import ConfigTab from '@/components/world/ConfigTab.vue';
import { useProjectStore } from '@/stores/projectStore';

const route = useRoute();
const router = useRouter();
const project = useProjectStore();

const tabs = [
  { key: 'map', labelKey: 'world.tab.map' },
  { key: 'generator', labelKey: 'world.tab.generator' },
  { key: 'simulate', labelKey: 'world.tab.simulate' },
  { key: 'config', labelKey: 'world.tab.config' },
] as const;

type TabKey = (typeof tabs)[number]['key'];

const STORAGE_KEY = 'world:active-tab';

// 初始化优先级：URL query > localStorage > 'map'
function resolveInitialTab(): TabKey {
  const fromQuery = route.query.tab as TabKey | undefined;
  if (fromQuery && tabs.some((t) => t.key === fromQuery)) return fromQuery;
  const fromStorage = localStorage.getItem(STORAGE_KEY) as TabKey | null;
  if (fromStorage && tabs.some((t) => t.key === fromStorage)) return fromStorage;
  return 'map';
}

const activeTab = ref<TabKey>(resolveInitialTab());

// activeTab 变化时同步 localStorage + URL query
// immediate: true 保证从 URL query 初始化时也同步 localStorage
// （否则通过 /map → /world?tab=map 重定向进入时，初始 activeTab 来自 URL，
//   watch 不会触发，localStorage 仍为旧值）
watch(
  activeTab,
  (tab) => {
    localStorage.setItem(STORAGE_KEY, tab);
    // 仅在 query 与当前值不同时 replace，避免重复导航
    if (route.query.tab !== tab) {
      void router.replace({ query: { ...route.query, tab } });
    }
  },
  { immediate: true },
);

// 监听浏览器前进/后退导致的 URL query 变化
watch(
  () => route.query.tab,
  (tabFromUrl) => {
    const next = tabFromUrl as TabKey | undefined;
    if (next && tabs.some((t) => t.key === next) && next !== activeTab.value) {
      activeTab.value = next;
    }
  },
);

// 顶层恢复元数据（原 MapEditorView 的 loadFromStorage 逻辑迁移至此）
onMounted(async () => {
  try {
    await project.loadFromStorage();
  } catch {
    // 持久化恢复失败不影响编辑器可用性
  }
});
</script>

<template>
  <div class="flex h-full w-full flex-col">
    <WorldHeader
      :tabs="tabs"
      :active-tab="activeTab"
      @update:active-tab="activeTab = $event as TabKey"
    />
    <div class="flex min-h-0 flex-1">
      <!-- 使用 v-show 而非 v-if，避免子 Tab 切换丢失状态 -->
      <div v-show="activeTab === 'map'" class="flex h-full w-full">
        <MapTab />
      </div>
      <div v-show="activeTab === 'generator'" class="flex h-full w-full">
        <GeneratorTab />
      </div>
      <div v-show="activeTab === 'simulate'" class="flex h-full w-full">
        <SimulateTab />
      </div>
      <div v-show="activeTab === 'config'" class="flex h-full w-full">
        <ConfigTab />
      </div>
    </div>
  </div>
</template>
