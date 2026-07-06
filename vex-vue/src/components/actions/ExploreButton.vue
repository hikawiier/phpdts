<script setup lang="ts">
// ══════════════════════════════════════════════════
// 探索按钮 / Explore Button
//
// 替代现有 vex/js/tile-action.js 的探索按钮部分。
// 点击触发 tileActionStore.handleExplore()。
//
// 命令锁定时禁用（防重复提交）。
// ══════════════════════════════════════════════════

import { computed } from 'vue';
import { useTileActionStore } from '@/stores/tileAction';
import { commandQueue } from '@/stores/command-queue';

const tileActionStore = useTileActionStore();

const disabled = computed(() => !commandQueue.canExecute('obl_explore'));

function onClick(): void {
  if (disabled.value) return;
  tileActionStore.handleExplore();
}
</script>

<template>
  <button
    class="term-btn block"
    style="flex:3;"
    :disabled="disabled"
    @click="onClick"
  >[E] 探索周围</button>
</template>
