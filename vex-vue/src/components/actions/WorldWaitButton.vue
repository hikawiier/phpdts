<script setup lang="ts">
import { computed } from 'vue';
import { commandQueue } from '@/stores/command-queue';
import { useBattleStore } from '@/stores/battle';
import { useTileActionStore } from '@/stores/tileAction';
import { useInventoryStore } from '@/stores/inventory';
import { usePlayerStore } from '@/stores/player';

const battleStore = useBattleStore();
const tileActionStore = useTileActionStore();
const inventoryStore = useInventoryStore();
const playerStore = usePlayerStore();
const needsRecoveryExit = computed(() =>
  inventoryStore.itm0 !== null || playerStore.statuses.some(status => status.phase === 'active'),
);
const visible = computed(() => battleStore.currentMode === 'normal' && needsRecoveryExit.value);
const block = computed(() => commandQueue.getBlockDecision('world.wait'));

function onWait(): void {
  if (block.value) return;
  void tileActionStore.handleWait();
}
</script>

<template>
  <button
    v-if="visible"
    class="term-btn world-wait-button"
    :disabled="block !== null"
    :title="block?.message || '推进 1 tick，不消耗资源'"
    @click="onWait"
  >[W] 等待</button>
</template>
