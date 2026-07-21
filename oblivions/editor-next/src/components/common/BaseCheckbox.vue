<script setup lang="ts">
// 通用复选框（灰阶基底，对齐 DESIGN.md 2.15）
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    disabled?: boolean;
    label?: string;
  }>(),
  {
    disabled: false,
  },
);

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  change: [value: boolean];
}>();

const checked = computed({
  get: () => props.modelValue,
  set: (v: boolean) => {
    emit('update:modelValue', v);
    emit('change', v);
  },
});
</script>

<template>
  <label class="inline-flex cursor-pointer items-center gap-1.5 text-sm text-gray-200">
    <input
      v-model="checked"
      type="checkbox"
      :disabled="disabled"
      class="h-4 w-4 cursor-pointer appearance-none rounded border border-gray-600 bg-gray-900 checked:border-gray-400 checked:bg-gray-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gray-400 disabled:cursor-not-allowed disabled:opacity-50"
    />
    <span v-if="label">{{ label }}</span>
    <slot v-else />
  </label>
</template>
