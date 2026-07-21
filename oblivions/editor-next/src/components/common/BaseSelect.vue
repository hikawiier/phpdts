<script setup lang="ts">
// 通用下拉选择（灰阶基底，对齐 DESIGN.md 2.15）
import { computed } from 'vue';

export interface SelectOption<T = string> {
  readonly value: T;
  readonly label: string;
  readonly disabled?: boolean;
}

const props = withDefaults(
  defineProps<{
    modelValue: string | number | null;
    options: ReadonlyArray<SelectOption<string | number>>;
    disabled?: boolean;
    placeholder?: string;
  }>(),
  {
    disabled: false,
  },
);

const emit = defineEmits<{
  'update:modelValue': [value: string];
  change: [value: string];
}>();

const value = computed({
  get: () => (props.modelValue === null ? '' : String(props.modelValue)),
  set: (v: string) => {
    emit('update:modelValue', v);
    emit('change', v);
  },
});
</script>

<template>
  <select
    v-model="value"
    :disabled="disabled"
    class="w-full rounded border border-gray-700 bg-gray-900 px-2 py-1 text-sm text-gray-100 focus:border-gray-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gray-400 disabled:cursor-not-allowed disabled:opacity-50"
  >
    <option v-if="placeholder" value="" disabled>{{ placeholder }}</option>
    <option
      v-for="opt in options"
      :key="opt.value"
      :value="opt.value"
      :disabled="opt.disabled"
    >
      {{ opt.label }}
    </option>
  </select>
</template>
