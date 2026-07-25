<script setup lang="ts">
/**
 * @module L Vue 组件
 * @framework L-12 固定等距战斗场景
 */

import PlayerDrawer from '@/components/layout/PlayerDrawer.vue';
import InventoryDrawer from '@/components/layout/InventoryDrawer.vue';
import BattleMap from '@/components/battle/BattleMap.vue';
import BattleMode from '@/components/battle/BattleMode.vue';
import { UI_TEXT } from '@/data/ui-locale';
</script>

<template>
  <div class="battle-scene-root relative flex h-full min-h-0 flex-row">
    <PlayerDrawer />

    <div class="battle-scene-workspace flex min-h-0 min-w-0 flex-1">
      <BattleMap class="min-w-0 flex-1" />

      <aside class="battle-scene-actions flex min-h-0 min-w-0 flex-col overflow-hidden">
        <div class="flex-none px-3 pt-3">
          <div class="ascii-title">
            <span>┌─</span>
            <span class="ascii-label">{{ UI_TEXT.COMBAT }}</span>
            <span>─</span>
            <span class="ascii-line flex-1"></span>
            <span>┐</span>
          </div>
        </div>
        <div class="min-h-0 flex-1 overflow-hidden p-3 pt-1.5">
          <BattleMode />
        </div>
      </aside>
    </div>

    <InventoryDrawer />
  </div>
</template>

<style scoped>
.battle-scene-root {
  background: #030303;
}

.battle-scene-actions {
  flex: 0 1 35%;
  width: 35%;
  min-width: 280px;
  background: #070707;
}

@media (max-width: 900px) {
  .battle-scene-actions {
    flex-basis: 36%;
    width: 36%;
    min-width: 250px;
  }
}
</style>

