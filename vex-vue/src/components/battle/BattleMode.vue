<script setup lang="ts">
// ══════════════════════════════════════════════════
// 战斗模式容器 / Battle Mode Container
//
// 组合所有战斗子组件，替代现有 vex/index.html #battleMode 区。
// 仅在 battleStore.currentMode === 'battle' 时渲染。
//
// 子组件职责：
// - BattleHeader：vs [敌人名] 标题
// - BattleActionBar：动作按钮区（玩家回合嵌入 PreloadArea，NPC 回合显示等待提示）
// - BattleModal：战斗演出模态框（Teleport to body，全屏覆盖）
// - DamageNumber：残留伤害数字（Teleport to body）
// - AimMode：瞄准模式（Teleport to body，SVG 路径线）
// ══════════════════════════════════════════════════

import BattleHeader from '@/components/battle/BattleHeader.vue';
import BattleActionBar from '@/components/battle/BattleActionBar.vue';
import BattleModal from '@/components/battle/BattleModal.vue';
import DamageNumber from '@/components/battle/DamageNumber.vue';
import AimMode from '@/components/battle/AimMode.vue';
</script>

<template>
  <div class="flex flex-col h-full min-h-0">
    <!-- 战斗标题 -->
    <BattleHeader />

    <!-- 动作按钮区（玩家回合：装填区；NPC 回合：等待提示） -->
    <BattleActionBar />

    <!-- 战斗演出模态框（Teleport to body，全屏覆盖） -->
    <BattleModal />

    <!-- 残留伤害数字（Teleport to body） -->
    <DamageNumber />

    <!-- 瞄准模式（Teleport to body，SVG 路径线） -->
    <AimMode />
  </div>
</template>
