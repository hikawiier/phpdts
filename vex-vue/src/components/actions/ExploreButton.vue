<script setup lang="ts">
/**
 * @module L Vue 组件
 * @framework L-1 统一交互列表模式
 */
// ══════════════════════════════════════════════════
// 探索按钮 / Explore Button（§3.2 合并主操作）
//
// 替代现有 vex/js/tile-action.js 的探索按钮部分 + WorldWaitButton.vue。
//
// 合并策略（§3.2.2）：
//   - map.explore 可用：显示"探索周围"，点击触发 handleExplore
//   - map.explore 不可用（itm0 锁定等）：显示"等待"，点击触发 handleWait
//
// 视觉：实线边框（探索可用） / 虚线边框（等待态）
// 命令锁定时禁用（防重复提交）。
// ══════════════════════════════════════════════════

import { computed } from 'vue';
import { useTileActionStore } from '@/stores/tileAction';
import { commandQueue } from '@/stores/command-queue';

const tileActionStore = useTileActionStore();

const exploreDisabled = computed(() => !commandQueue.canExecute('map.explore'));
const waitDisabled = computed(() => !commandQueue.canExecute('world.wait'));

/** 是否处于等待态（探索不可用） */
const isWaitMode = computed(() => exploreDisabled.value);

/** 按钮禁用：等待态下检查 world.wait，探索态下检查 map.explore */
const disabled = computed(() => isWaitMode.value ? waitDisabled.value : exploreDisabled.value);

/** 按钮 label（§3.7 统一方括号包裹，与 [合成]/[前往下一区域] 风格一致） */
const label = computed(() => isWaitMode.value ? '[等待]' : '[探索周围]');

/** 按钮 title（tooltip） */
const title = computed(() => {
  if (isWaitMode.value) {
    return commandQueue.getBlockDecision('world.wait')?.message || '推进 1 tick，不消耗资源';
  }
  return commandQueue.getBlockDecision('map.explore')?.message || '';
});

function onClick(): void {
  if (disabled.value) return;
  if (isWaitMode.value) {
    void tileActionStore.handleWait();
  } else {
    tileActionStore.handleExplore();
  }
}
</script>

<template>
  <button
    class="term-btn block explore-btn"
    :class="{ 'is-wait-mode': isWaitMode }"
    style="flex:3;"
    :disabled="disabled"
    :title="title"
    @click="onClick"
  >{{ label }}</button>
</template>

<style scoped>
.explore-btn.is-wait-mode {
  border-style: dashed;
  opacity: 0.85;
}
.explore-btn.is-wait-mode:hover:not(:disabled) {
  opacity: 1;
}
</style>
