<!-- @module O 内容工具箱 -->
<script setup lang="ts">
//
// StatCard：总览页统计卡片（对齐 O-6 §4.6.3）
//
// 设计意图：
//   - 简洁卡片样式，复用 BaseButton / BaseInput 灰阶基底风格
//   - trend 用于错误（down 警示）/ 警告（flat 中性）/ 资源（up 增长）等语义
//   - P0 阶段不展示历史趋势线，仅展示当前值
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    label: string;
    value: string | number;
    icon?: string;
    trend?: 'up' | 'down' | 'flat';
  }>(),
  {
    icon: '',
    trend: 'flat',
  },
);

const trendClass = computed(() => {
  if (props.trend === 'down') return 'text-accent-error';
  if (props.trend === 'up') return 'text-gray-100';
  return 'text-gray-300';
});

const trendGlyph = computed(() => {
  if (props.trend === 'down') return '▼';
  if (props.trend === 'up') return '▲';
  return '—';
});
</script>

<template>
  <div
    class="flex flex-col gap-1 rounded border border-gray-800 bg-gray-900 px-3 py-2"
  >
    <div class="flex items-center justify-between text-[10px] text-gray-500">
      <span>{{ label }}</span>
      <span v-if="icon">{{ icon }}</span>
    </div>
    <div class="flex items-baseline gap-2">
      <span class="text-xl font-semibold text-gray-100">{{ value }}</span>
      <span class="text-[10px]" :class="trendClass">{{ trendGlyph }}</span>
    </div>
  </div>
</template>
