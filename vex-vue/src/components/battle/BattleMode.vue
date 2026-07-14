<script setup lang="ts">
/**
 * @module L Vue 组件
 */
// ══════════════════════════════════════════════════
// 战斗模式容器 / Battle Mode Container
//
// 组合所有战斗子组件，替代现有 vex/index.html #battleMode 区。
// 仅在 battleStore.currentMode === 'battle' 时渲染（由 RightPanel.vue 控制）。
//
// 子组件职责：
// - BattleActionBar：动作按钮区（玩家回合嵌入 PreloadArea，NPC 回合显示等待提示）
// - BattleBanner：战斗横幅（Teleport to body，承担 round_intro / battle_end 段）
// - BattleModal：战斗演出模态框（Teleport to body，承担 turn / system 段）
// - DamageNumber：残留伤害数字（Teleport to body）
// - AimMode：瞄准模式（Teleport to body，SVG 路径线）
//
// 注意：BattleBanner / BattleModal 在自身 onMounted 中向 store 注册播放器接口，
// onUnmounted 中注销。BattleMode.vue 仅负责挂载点，无需 ref 绑定或显式注册。
// ══════════════════════════════════════════════════

import BattleActionBar from '@/components/battle/BattleActionBar.vue';
import BattleBanner from '@/components/battle/BattleBanner.vue';
import BattleModal from '@/components/battle/BattleModal.vue';
import DamageNumber from '@/components/battle/DamageNumber.vue';
import AimMode from '@/components/battle/AimMode.vue';
</script>

<template>
  <div class="flex flex-col h-full min-h-0">
    <!-- 动作按钮区（玩家回合：装填区；NPC 回合：等待提示） -->
    <BattleActionBar />

    <!-- 战斗横幅（Teleport to body，承担 round_intro / battle_end 段） -->
    <BattleBanner />

    <!-- 战斗演出模态框（Teleport to body，承担 turn / system 段） -->
    <BattleModal />

    <!-- 残留伤害数字（Teleport to body） -->
    <DamageNumber />

    <!-- 瞄准模式（Teleport to body，SVG 路径线） -->
    <AimMode />
  </div>
</template>
