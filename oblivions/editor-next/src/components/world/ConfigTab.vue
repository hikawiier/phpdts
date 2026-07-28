<!-- @module O 内容工具箱 -->
<script setup lang="ts">
//
// ConfigTab：配置子 Tab（obl_config 只读展示，对齐 P1 执行案 §4.10.5）
//
// 设计意图：
//   - 只读展示 graph-store 中 config.runtime:obl_config 节点的 entries
//   - 顶部提示 "P1 阶段为只读展示，编辑能力在后续阶段实现"
//   - 复用 OblConfigViewer 通用键值对展示组件
//
// 边界：
//   - oblConfig 派生自 graph-store（configStore.oblConfig 已派生）
//   - P1 阶段不允许通过 graph-store 编辑器修改 config.runtime 字段
//   - 已知 23 项 obl_config 字段从 schema 中读取（保留扩展性）
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useConfigStore } from '@/stores/configStore';
import OblConfigViewer from '@/components/world/OblConfigViewer.vue';

const { t } = useI18n();
const config = useConfigStore();

// oblConfig 派生自 graph-store（configStore.oblConfig 已是 computed）
const oblConfig = computed(() => config.oblConfig);

/**
 * 已知 23 项 obl_config 字段清单（按 obl_config.php 文件顺序）
 *
 * P1 阶段从 schema 中读取字段名清单，用于 OblConfigViewer 的"未知字段"提示。
 * P5 之后由 schema/kinds/config-runtime.ts 动态提供。
 */
const KNOWN_OBL_CONFIG_FIELDS: ReadonlyArray<string> = [
  'explore_sp_cost',
  'vision_range',
  'memory_range',
  'discover_base',
  'discover_per_level',
  'move_sp_cost',
  'move_types',
  'info_acquisition',
  'navigation_max_steps_default',
  'navigation_max_steps_limit',
  'tendencies',
  'log_max_entries',
  'log_max_debug_entries',
  'battlelog_schema',
  'combat_engine',
  'use_item_advances_tick',
  'craft_advances_tick',
  'wild_item_refresh_mode',
  'wild_item_refresh_interval_ticks',
  'wild_item_capacity_per_tile',
  'wild_item_refresh_rate_by_tide',
  'day_length_ticks',
  'day_phase_ticks',
];
</script>

<template>
  <div class="flex h-full w-full flex-col">
    <!-- 顶部提示（P1 只读边界） -->
    <div
      class="flex items-center gap-2 border-b border-gray-800 bg-gray-900 px-3 py-2 text-xs text-gray-400"
    >
      <span class="rounded border border-gray-700 bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-300">
        P1
      </span>
      <span>{{ t('world.config.readonlyHint') }}</span>
    </div>

    <!-- obl_config 只读展示 -->
    <div class="flex-1 overflow-hidden">
      <OblConfigViewer
        :entries="oblConfig"
        :known-fields="KNOWN_OBL_CONFIG_FIELDS"
      />
    </div>
  </div>
</template>
