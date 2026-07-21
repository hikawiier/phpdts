<script setup lang="ts">
//
// ConfigPanel：配置编辑面板（对齐 NEW_DESIGN.md §3.4 + §3.4.4 + §3.4.5）
//
// 研判：
//   - 配置编辑框架的 UI 入口（三子 Tab）
//   - 复用 ScatterPoolEditor / PoiTableEditor / PoiPoolEditor 子组件
//   - obl_config 只读展示，外部引用校验由 validateStore 负责
//
// 设计意图（对齐 2.6 配置驱动 + 2.15 视觉 + §3.4.4 边界案例）：
//   - 三子 Tab：scatter_pool / poi_table / poi_pool（编辑）+ obl_config（只读）
//   - obl_config 只读不编辑（避免覆盖后端现存配置，对齐 §3.4.4 边界案例）
//   - obl_config 用 JSON 格式化展示（key-value 树形）
//   - 视觉对齐 2.15：灰阶基底 + 唯一强调色（accent-error 仅用于错误）
//   - 内存缓存：所有编辑操作仅修改 configStore 内存状态，需通过 ConfigView 保存按钮写回后端
//
// 数据流：
//   - 读：config.scatterPool / poiTable / poiPool / oblConfig
//   - 写：子组件各自调用 configStore CRUD action
//   - 单一数据源：configStore（无本地副本）

import { ref, computed } from 'vue';
import { useConfigStore } from '@/stores/configStore';
import ScatterPoolEditor from '@/components/config-editors/ScatterPoolEditor.vue';
import PoiTableEditor from '@/components/config-editors/PoiTableEditor.vue';
import PoiPoolEditor from '@/components/config-editors/PoiPoolEditor.vue';

const config = useConfigStore();

type SubTab = 'scatter' | 'poi_table' | 'poi_pool' | 'obl_config';

const activeTab = ref<SubTab>('scatter');

const tabs: ReadonlyArray<{ key: SubTab; label: string }> = [
  { key: 'scatter', label: '散布池（scatter_pool）' },
  { key: 'poi_table', label: 'POI 模板（poi_table）' },
  { key: 'poi_pool', label: 'POI 生成池（poi_pool）' },
  { key: 'obl_config', label: '核心配置（obl_config，只读）' },
] as const;

// ─── obl_config 只读展示 ───────────────────────────────

const hasOblConfig = computed(() => config.oblConfig !== null);

const oblConfigEntries = computed<Array<{ key: string; value: unknown; json: string }>>(() => {
  if (!config.oblConfig) return [];
  return Object.entries(config.oblConfig).map(([key, value]) => ({
    key,
    value,
    json: JSON.stringify(value, null, 2),
  }));
});

// ─── 加载状态提示 ──────────────────────────────────────
const hasAnyConfig = computed(() => config.hasConfig || hasOblConfig.value);
</script>

<template>
  <div class="flex h-full flex-col gap-2 overflow-hidden">
    <!-- 子 Tab 头 -->
    <div class="flex border-b border-gray-800">
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
        @click="activeTab = tab.key"
      >
        {{ tab.label }}
      </button>
    </div>

    <!-- 未加载任何配置 -->
    <div
      v-if="!hasAnyConfig"
      class="flex flex-1 items-center justify-center text-xs text-gray-600"
    >
      请先加载配置文件（scatter_pool.php / poi_table.php / poi_pool.php / obl_config.php）
    </div>

    <!-- 子 Tab 内容 -->
    <template v-else>
      <ScatterPoolEditor v-show="activeTab === 'scatter'" class="flex-1 overflow-hidden" />
      <PoiTableEditor v-show="activeTab === 'poi_table'" class="flex-1 overflow-hidden" />
      <PoiPoolEditor v-show="activeTab === 'poi_pool'" class="flex-1 overflow-hidden" />

      <!-- obl_config 只读展示 -->
      <div
        v-if="activeTab === 'obl_config'"
        class="flex-1 overflow-auto p-2 text-sm"
      >
        <div v-if="!hasOblConfig" class="text-xs text-gray-600">
          obl_config.php 未加载
        </div>
        <template v-else>
          <div class="mb-2 text-[10px] text-gray-500">
            obl_config 只读不编辑——避免覆盖后端现存配置（对齐 §3.4.4 边界案例）
          </div>
          <div class="flex flex-col gap-1">
            <div
              v-for="entry in oblConfigEntries"
              :key="entry.key"
              class="rounded border border-gray-800 bg-gray-900 p-2"
            >
              <div class="mb-1 text-xs text-gray-400">{{ entry.key }}</div>
              <pre class="overflow-auto rounded bg-gray-950 p-1.5 text-[10px] text-gray-300">{{ entry.json }}</pre>
            </div>
          </div>
        </template>
      </div>
    </template>
  </div>
</template>
