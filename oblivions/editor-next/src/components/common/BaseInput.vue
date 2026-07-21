<script setup lang="ts">
// 通用输入框（灰阶基底，对齐 DESIGN.md 2.15）
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    modelValue: string | number | null;
    type?: 'text' | 'number' | 'password';
    placeholder?: string;
    disabled?: boolean;
    min?: number;
    max?: number;
    step?: number;
  }>(),
  {
    type: 'text',
    disabled: false,
  },
);

const emit = defineEmits<{
  'update:modelValue': [value: string];
  blur: [event: FocusEvent];
  focus: [event: FocusEvent];
}>();

const value = computed({
  get: () => (props.modelValue === null ? '' : String(props.modelValue)),
  set: (v: string) => emit('update:modelValue', v),
});

// 浮点 step（如 0.05）会触发浏览器原生 step 校验报 invalid
// （0.38 因 IEEE754 精度 0.38/0.05=7.5999... 不整除），小数 step 改用 "any" 关闭该校验
const effectiveStep = computed<string | number | undefined>(() => {
  if (props.step === undefined) return undefined;
  return Number.isInteger(props.step) ? props.step : 'any';
});

// number 类型失焦时 clamp 到 min-max 范围（原生 input 不阻止键盘越界输入）
function onBlur(e: FocusEvent): void {
  emit('blur', e);
  if (props.type !== 'number') return;
  const raw = (e.target as HTMLInputElement).value;
  if (raw === '') return;
  const num = Number(raw);
  if (Number.isNaN(num)) return;
  let clamped = num;
  if (props.min !== undefined && clamped < props.min) clamped = props.min;
  if (props.max !== undefined && clamped > props.max) clamped = props.max;
  if (clamped !== num) {
    emit('update:modelValue', String(clamped));
  }
}
</script>

<template>
  <input
    v-model="value"
    :type="type"
    :placeholder="placeholder"
    :disabled="disabled"
    :min="min"
    :max="max"
    :step="effectiveStep"
    class="w-full rounded border border-gray-700 bg-gray-900 px-2 py-1 text-sm text-gray-100 placeholder-gray-500 focus:border-gray-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gray-400 disabled:cursor-not-allowed disabled:opacity-50"
    @blur="onBlur"
    @focus="$emit('focus', $event)"
  />
</template>
