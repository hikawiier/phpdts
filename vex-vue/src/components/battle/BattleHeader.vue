<script setup lang="ts">
// ══════════════════════════════════════════════════
// 战斗标题 / Battle Header
//
// 显示 `vs [敌人名]` 标题，替代现有 vex/js/battle-render.js renderBattleHeader()。
//
// 数据源（CharacterHub 改造后）：
//   - 敌人位置：从 characterStore.getCharacter(currentEnemyPid)?.pls 派生
//   - 敌人名称：保留 battleStore.enemyName（来自 battlelog v2 segment 的 snapshot，
//     是事件流数据，不在 CharacterHub 范畴），回退到 CharacterHub
// ══════════════════════════════════════════════════

import { computed } from 'vue';
import { useBattleStore } from '@/stores/battle';
import { useCharacterStore } from '@/stores/character';

const battleStore = useBattleStore();
const characterStore = useCharacterStore();

/** 当前敌人 Character（用于位置/名称回退） */
const enemyChar = computed(() => characterStore.getCharacter(battleStore.currentEnemyPid));

/** 敌人位置 pls（从 CharacterHub 派生） */
const enemyLocation = computed<string | number | null>(() => enemyChar.value?.pls ?? null);

/** 标题文本：vs [位于(X)的]敌人名 */
const headerText = computed<string>(() => {
  // enemyName 优先用 battleStore（来自 battlelog segment，更及时），回退到 CharacterHub
  const name = battleStore.enemyName || enemyChar.value?.name || '';
  if (!name) return '';
  const loc = enemyLocation.value;
  const locText = loc !== null && loc !== undefined && loc !== '' ? `位于(${loc})的` : '';
  return `vs ${locText}${name}`;
});
</script>

<template>
  <span class="text-fg-dim text-[10px]">{{ headerText }}</span>
</template>
