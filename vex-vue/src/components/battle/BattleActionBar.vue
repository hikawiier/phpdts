<script setup lang="ts">
// ══════════════════════════════════════════════════
// 战斗动作区 / Battle Action Bar
//
// 动作按钮区容器，替代现有 vex/index.html #battleActionBar。
// - 玩家回合（isPlayerTurn=true）：嵌入 PreloadArea 装填区组件
// - NPC 回合（isPlayerTurn=false）：显示"敌人正在行动..."等待提示
//
// 原前端逻辑（battle-render.js renderBattleWaiting）：
//   el.innerHTML = '<div class="text-fg-dim text-[10px] py-2 text-center">敌人正在行动...</div>';
// ══════════════════════════════════════════════════

import { useBattleStore } from '@/stores/battle';
import PreloadArea from '@/components/battle/PreloadArea.vue';

const battleStore = useBattleStore();
</script>

<template>
  <div class="flex-1 overflow-y-auto min-h-0">
    <!-- 玩家回合：装填区 -->
    <PreloadArea v-if="battleStore.isPlayerTurn" />
    <!-- NPC 回合：等待提示 -->
    <div v-else class="text-fg-dim text-[10px] py-2 text-center">
      敌人正在行动...
    </div>
  </div>
</template>
