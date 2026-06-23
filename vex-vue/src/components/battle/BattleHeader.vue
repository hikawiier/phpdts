<script setup lang="ts">
// ══════════════════════════════════════════════════
// 战斗标题 / Battle Header
//
// 显示 `vs [敌人名]` 标题，替代现有 vex/js/battle-render.js renderBattleHeader()。
// 从 battleStore.enemyName + enemyLocation 响应式读取。
//
// 原前端逻辑：
//   const locText = npcLocation ? `位于(${npcLocation})的` : '';
//   el.textContent = 'vs ' + locText + enemyName;
// ══════════════════════════════════════════════════

import { computed } from 'vue';
import { useBattleStore } from '@/stores/battle';

const battleStore = useBattleStore();

/** 标题文本：vs [位于(X)的]敌人名 */
const headerText = computed<string>(() => {
  const name = battleStore.enemyName;
  if (!name) return '';
  const loc = battleStore.enemyLocation;
  const locText = loc !== null && loc !== undefined && loc !== '' ? `位于(${loc})的` : '';
  return `vs ${locText}${name}`;
});
</script>

<template>
  <span class="text-fg-dim text-[10px]">{{ headerText }}</span>
</template>
