<script setup lang="ts">
// ══════════════════════════════════════════════════
// 右侧面板 / Right Panel — 日志 + 动作条 / 战斗动作
//
// 替代现有 vex/index.html 的右侧 main > div（normalMode / battleMode）。
// 模式切换用 v-if 替代 display:none（迁移计划 M2 任务 9）。
//
// normalMode：CHRONICLE 日志（flex:4）+ ACTIONS 动作条（flex:6）
// battleMode：COMBAT 动作区（flex:1，扩展占满，无日志区）
//
// M4：ACTIONS 区已迁移为 TileActionBar.vue。
// M5：CHRONICLE 日志区迁移。
// M6：COMBAT 战斗动作区迁移。
// ══════════════════════════════════════════════════

import { useBattleStore } from '@/stores/battle';
import TileActionBar from '@/components/actions/TileActionBar.vue';
import LogPanel from '@/components/log/LogPanel.vue';
import BattleMode from '@/components/battle/BattleMode.vue';

const battleStore = useBattleStore();
</script>

<template>
  <div class="flex flex-col min-h-0 overflow-hidden">
    <!-- 正常模式：Log + Actions -->
    <div
      v-if="battleStore.currentMode === 'normal'"
      class="flex flex-col min-h-0 overflow-hidden flex-1"
    >
      <!-- Log (flex:4) -->
      <div
        class="min-h-0 flex flex-col p-3 overflow-hidden border-b border-fg-dim/30"
        style="flex:4 1 0%;"
      >
        <div class="ascii-title flex-none mb-1.5">
          <span>┌─</span>
          <span class="ascii-label">CHRONICLE</span>
          <span>─</span>
          <span class="flex-1 ascii-line"></span>
          <span>┐</span>
        </div>
        <div class="flex-1 overflow-y-auto min-h-0">
          <LogPanel />
        </div>
      </div>
      <!-- Actions (flex:6) -->
      <div
        class="min-h-0 flex flex-col p-3 overflow-hidden"
        style="flex:6 1 0%;"
      >
        <div class="ascii-title flex-none mb-1.5">
          <span>┌─</span>
          <span class="ascii-label">ACTIONS</span>
          <span>─</span>
          <span class="flex-1 ascii-line"></span>
          <span>┐</span>
        </div>
        <TileActionBar />
      </div>
    </div>

    <!-- 战斗模式：Battle Actions（无日志区，动作区扩展） -->
    <div
      v-else
      class="flex flex-col min-h-0 overflow-hidden flex-1"
    >
      <div class="min-h-0 flex flex-col p-3 overflow-hidden flex-1">
        <div class="ascii-title flex-none mb-1.5">
          <span>┌─</span>
          <span class="ascii-label">COMBAT</span>
          <span>─</span>
          <span class="flex-1 ascii-line"></span>
          <span>┐</span>
        </div>
        <div class="flex-1 overflow-hidden min-h-0">
          <BattleMode />
        </div>
      </div>
    </div>
  </div>
</template>
