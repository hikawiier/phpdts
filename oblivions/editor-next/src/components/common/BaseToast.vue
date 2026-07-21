<script setup lang="ts">
// 通用 Toast 容器（订阅 uiStore.toasts，灰阶基底 + 强调色，对齐 DESIGN.md 2.15）
import { useUiStore } from '@/stores/uiStore';
import { computed } from 'vue';

const ui = useUiStore();

const toasts = computed(() => ui.toasts);

function toastClass(type: 'info' | 'error' | 'success'): string {
  if (type === 'error') return 'border-accent-error text-accent-error';
  if (type === 'success') return 'border-gray-400 text-gray-100';
  return 'border-gray-600 text-gray-200';
}
</script>

<template>
  <Teleport to="body">
    <div
      class="pointer-events-none fixed bottom-4 right-4 z-[60] flex flex-col gap-2"
      aria-live="polite"
    >
      <div
        v-for="toast in toasts"
        :key="toast.id"
        class="pointer-events-auto rounded border bg-gray-900 px-3 py-2 text-sm shadow-lg"
        :class="toastClass(toast.type)"
        @click="ui.dismissToast(toast.id)"
      >
        {{ toast.message }}
      </div>
    </div>
  </Teleport>
</template>
