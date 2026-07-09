<script setup lang="ts">
// ══════════════════════════════════════════════════
// 状态栏 / Status Bar
//
// 替代现有 vex/index.html 的 .status-bar + vex/js/player.js 的 applyStatusBar()。
//
// 布局（与现有 index.html 一致）：
//   左侧：区域名 + tick调试 + HP条 | 位置名 + SP条 | [属性][战斗][背包] 按钮
//   右侧：头像（gd_icon.gif）
//
// 数据来源：playerStore（HP/SP/tick/头像）+ mapStore（区域/位置名）
// ══════════════════════════════════════════════════

import { computed, ref, watch } from 'vue';
import { usePlayerStore } from '@/stores/player';
import { useMapStore } from '@/stores/map';
import { useUiStore } from '@/stores/ui';
import { useBattleStore } from '@/stores/battle';
import { dataManager } from '@/stores/data-manager';
import { commandQueue } from '@/stores/command-queue';
import { getPlaceName } from '@/utils/format';
import type { BattleState } from '@/types/api';

const playerStore = usePlayerStore();
const mapStore = useMapStore();
const uiStore = useUiStore();
const battleStore = useBattleStore();

const API_BASE = import.meta.env.VITE_API_BASE || '/phpdts';

// ── 头像 URL（与现有 player.js 一致：BASE_URL + '/img/' + gd + '_' + icon + '.gif'） ──
const avatarSrc = computed(() => {
  const d = playerStore.playerInfo;
  if (!d) return '';
  const gd = d.gd || 'f';
  const icon = d.icon || '0';
  return `${API_BASE}/img/${gd}_${icon}.gif`;
});

const avatarLoaded = ref(true);

// 头像 URL 变化时重置加载状态（玩家切换角色/icon 更新后重新尝试加载）
watch(avatarSrc, () => {
  avatarLoaded.value = true;
});

// ── 位置信息 ──
const regionName = computed(() => {
  if (mapStore.links && mapStore.curRegion !== null) {
    const region = (mapStore.links.regions as Record<string, { name?: string }>)[String(mapStore.curRegion)];
    if (region?.name) return region.name;
  }
  return 'unknown';
});

const locationName = computed(() => {
  if (mapStore.curLoc === null) return 'unknown';
  return getPlaceName(mapStore.curLoc);
});

// ── HP/SP 条 ──
const hpPct = computed(() => {
  const mhp = playerStore.mhp || 1;
  return Math.max(0, Math.min(100, (playerStore.hp / mhp) * 100));
});

const spPct = computed(() => {
  const msp = playerStore.msp || 1;
  return Math.max(0, Math.min(100, (playerStore.sp / msp) * 100));
});

const hpDanger = computed(() => {
  const mhp = playerStore.mhp || 1;
  return playerStore.hp / mhp < 0.3;
});

// ── tick 调试 ──
const tickText = computed(() => {
  return `T: ${playerStore.oblTick}/${playerStore.oblPretick}`;
});

const tickPending = computed(() => playerStore.oblTick > playerStore.oblPretick);

// ── 战斗状态机调试显示 ──
const battleStateText = computed(() => {
  const state = playerStore.oblBattleState;
  const stateMap: Record<BattleState, string> = {
    IDLE: '空闲',
    PLAYER_TURN: '等待玩家',
    PROCESSING: '处理中',
  };
  return stateMap[state] || state;
});

// ── 后端处理中提示（由状态机派生，PROCESSING 状态时显示） ──
// 非 debug 模式下显示"NPC 行动中…"轻量提示；debug 模式下由 tick 调试信息覆盖
const npcPending = computed(() => commandQueue.pendingNpc);

// ── 战斗按钮点击处理（与现有 vex/js/app.js 一致） ──
// normal 态：startBattle(0)（无指定敌人，进入战斗模式）
// battle 态：后端已在战斗中时只取消本地装填；预战斗阶段可退出本地 battle UI
// aim 态：广播 battle:aim-exit（退出瞄准模式，PreloadArea 监听后清理）
function onBattleBtnClick(): void {
  if (uiStore.battleBtnState === 'normal') {
    battleStore.startBattle(0);
  } else if (uiStore.battleBtnState === 'battle') {
    if (playerStore.isInBattle) {
      dataManager.broadcast('battle:preload-clear');
    } else {
      battleStore.exitBattleMode();
    }
  } else if (uiStore.battleBtnState === 'aim') {
    dataManager.broadcast('battle:aim-exit');
  }
}

function onAvatarError(): void {
  avatarLoaded.value = false;
}
</script>

<template>
  <div class="status-bar flex-none">
    <!-- 左侧：位置 + 按钮 -->
    <div class="status-left">
      <!-- 第一行：区域 + tick + HP -->
      <div class="status-bar-row">
        <span class="status-location">{{ regionName }}</span>
        <span
          v-if="npcPending"
          class="status-npc-pending"
          title="后端处理中，请稍候"
        >处理中…</span>
        <span
          class="status-tick-debug"
          :class="{ pending: tickPending }"
          title="obl_tick / obl_pretick — 两者相等时NPC AI不触发 | obl_battle_state"
        >{{ tickText }} | {{ battleStateText }}</span>
        <div class="bar-container">
          <div
            class="bar-fill hp"
            :class="{ danger: hpDanger }"
            :style="{ width: hpPct + '%' }"
          ></div>
        </div>
        <span class="bar-text" :class="{ danger: hpDanger }">
          HP {{ playerStore.hp }}/{{ playerStore.mhp }}
        </span>
      </div>
      <!-- 第二行：位置名 + SP -->
      <div class="status-bar-row">
        <span class="status-location">{{ locationName }}</span>
        <div class="bar-container">
          <div
            class="bar-fill sp"
            :style="{ width: spPct + '%' }"
          ></div>
        </div>
        <span class="bar-text">SP {{ playerStore.sp }}/{{ playerStore.msp }}</span>
      </div>
      <!-- 第三行：按钮 -->
      <div class="status-bar-row">
        <button class="status-bar-btn" @click="uiStore.togglePlayerDrawer">[属性]</button>
        <button class="status-bar-btn" @click="onBattleBtnClick">[{{ uiStore.battleBtnText() }}]</button>
        <button class="status-bar-btn" @click="uiStore.toggleInventoryDrawer">[背包]</button>
      </div>
    </div>
    <!-- 右侧：头像 -->
    <div class="status-avatar">
      <img
        v-if="avatarSrc && avatarLoaded"
        :src="avatarSrc"
        alt="avatar"
        @error="onAvatarError"
      />
      <span v-else class="status-avatar-fallback">???</span>
    </div>
  </div>
</template>
