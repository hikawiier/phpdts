<!-- @module O 内容工具箱 -->
<script setup lang="ts">
// 通用按钮组件（灰阶基底 + 唯一强调色，对齐 DESIGN.md 2.15）
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    type?: 'button' | 'submit' | 'reset';
    variant?: 'default' | 'primary' | 'danger' | 'ghost';
    size?: 'sm' | 'md' | 'lg';
    disabled?: boolean;
    title?: string;
  }>(),
  {
    type: 'button',
    variant: 'default',
    size: 'md',
    disabled: false,
  },
);

defineEmits<{ click: [event: MouseEvent] }>();

const classes = computed(() => {
  const base = 'inline-flex items-center justify-center rounded border font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-gray-400';
  const sizeCls =
    props.size === 'sm'
      ? 'px-2 py-0.5 text-xs'
      : props.size === 'lg'
        ? 'px-4 py-2 text-base'
        : 'px-3 py-1 text-sm';
  const variantCls =
    props.variant === 'primary'
      ? 'border-gray-500 bg-gray-700 text-gray-100 hover:bg-gray-600'
      : props.variant === 'danger'
        ? 'border-accent-error bg-transparent text-accent-error hover:bg-[color-mix(in_srgb,var(--color-accent-error)_12%,transparent)]'
        : props.variant === 'ghost'
          ? 'border-transparent bg-transparent text-gray-300 hover:bg-gray-800'
          : 'border-gray-700 bg-gray-800 text-gray-200 hover:bg-gray-700';
  const disabledCls = props.disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer';
  return [base, sizeCls, variantCls, disabledCls];
});
</script>

<template>
  <button
    :type="type"
    :class="classes"
    :disabled="disabled"
    :title="title"
    @click="$emit('click', $event)"
  >
    <slot />
  </button>
</template>
