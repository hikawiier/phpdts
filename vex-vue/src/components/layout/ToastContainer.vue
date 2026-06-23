<script setup lang="ts">
// ══════════════════════════════════════════════════
// Toast 容器 / Toast Container
//
// 替代现有 vex/index.html 的 #toastContainer + vex/js/toast.js。
//
// M4 阶段：简单 v-for 渲染 toastStore.toasts。
// M5 阶段：完善位置管理（useToastPosition composable）+ 动画。
//
// 位置类由 useToastPosition composable 计算（响应式），并同步写入
// uiStore.toastPositionClass（保持 M4 的接口不变，便于其他地方读取）。
// ══════════════════════════════════════════════════

import { watch } from 'vue';
import { useUiStore } from '@/stores/ui';
import { useToastStore } from '@/stores/toast';
import { useToastPosition } from '@/composables/useToastPosition';
import type { ToastType } from '@/stores/toast';

const uiStore = useUiStore();
const toastStore = useToastStore();

// ── M5：用 useToastPosition composable 计算位置类（响应式） ──
const { toastPositionClass } = useToastPosition();

// ── 同步到 uiStore.toastPositionClass（保持 M4 接口不变） ──
watch(
  toastPositionClass,
  (val) => {
    uiStore.toastPositionClass = val;
  },
  { immediate: true },
);

/** Toast 类型对应的标签文字 */
function toastTag(type: ToastType): string {
  if (type === 'error') return '[ERR]';
  if (type === 'success') return '[OK]';
  if (type === 'warning') return '[!]';
  return '[i]';
}
</script>

<template>
  <div
    class="toast-container fixed top-3 right-3 z-[500] flex flex-col gap-1.5 pointer-events-none"
    :class="toastPositionClass"
  >
    <div
      v-for="toast in toastStore.toasts"
      :key="toast.id"
      class="toast show"
      :class="['toast-' + toast.type]"
    >
      <span class="toast-tag">{{ toastTag(toast.type) }}</span>
      <span v-if="toast.isHtml" v-html="toast.message"></span>
      <span v-else>{{ toast.message }}</span>
      <span v-if="toast.count > 1" class="toast-count">×{{ toast.count }}</span>
    </div>
  </div>
</template>
