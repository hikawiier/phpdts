<script setup lang="ts">
// ══════════════════════════════════════════════════
// 左侧抽屉 / Player Drawer — 玩家属性详情
//
// 替代现有 vex/index.html 的 #playerDrawer + vex/js/player.js 的 loadPlayerInfo()。
//
// 布局（与现有 index.html 一致）：
//   ┌─ SURVIVOR ────────── [X]
//   VITALITY (HP 条)
//   STAMINA (SP 条)
//   ACTION POINTS (AP 条)
//   EXPERIENCE (EXP 条)
//   ATK / DEF / KILLS / POS / STATE
//   PROFILE (name / gender)
//
// 数据来源：playerStore.playerInfo
// 开关控制：uiStore.playerDrawerOpen
// ══════════════════════════════════════════════════

import { computed } from 'vue';
import { usePlayerStore } from '@/stores/player';
import { useUiStore } from '@/stores/ui';
import { getPlaceName, getGenderText } from '@/utils/format';

const playerStore = usePlayerStore();
const uiStore = useUiStore();

// ── 进度条百分比 ──
const hpPct = computed(() => {
  const mhp = playerStore.mhp || 1;
  return playerStore.mhp ? (playerStore.hp / mhp) * 100 : 0;
});

const spPct = computed(() => {
  const msp = playerStore.msp || 1;
  return playerStore.msp ? (playerStore.sp / msp) * 100 : 0;
});

const apPct = computed(() => {
  const maxAp = playerStore.maxAp || 1;
  return playerStore.maxAp ? (playerStore.ap / maxAp) * 100 : 0;
});

const expPct = computed(() => {
  const d = playerStore.playerInfo;
  if (!d || !d.upexp) return 0;
  const upexp = Number(d.upexp);
  if (!upexp) return 0;
  return (Number(d.exp) / upexp) * 100;
});

// ── oblpara.killnum ──
const killnum = computed(() => {
  const d = playerStore.playerInfo;
  return d?.oblpara?.killnum || 0;
});

const lvl = computed(() => playerStore.playerInfo?.lvl || '0');
const exp = computed(() => playerStore.playerInfo?.exp || '0');
const upexp = computed(() => playerStore.playerInfo?.upexp || '100');
const att = computed(() => playerStore.playerInfo?.att || '0');
const def = computed(() => playerStore.playerInfo?.def || '0');
const state = computed(() => playerStore.playerInfo?.state || '0');
const pls = computed(() => playerStore.playerInfo?.pls || '0');
const name = computed(() => playerStore.playerInfo?.name || '');
const gd = computed(() => playerStore.playerInfo?.gd || '');

const placeName = computed(() => getPlaceName(pls.value));
const genderText = computed(() => getGenderText(gd.value));
</script>

<template>
  <!-- 遮罩 -->
  <div
    class="drawer-overlay fixed inset-0 bg-black/70 z-[250]"
    :class="{ open: uiStore.playerDrawerOpen }"
    @click="uiStore.closePlayerDrawer"
  ></div>
  <!-- 抽屉 -->
  <div
    class="player-drawer fixed top-0 left-0 w-[280px] h-screen bg-bg z-[300] flex flex-col border-r-2 border-hi"
    :class="{ open: uiStore.playerDrawerOpen }"
  >
    <!-- 头部 -->
    <div class="flex justify-between items-center px-4 py-3 border-b border-fg-dim/30 text-fg-bright text-xs tracking-widest flex-none">
      <span>┌─ SURVIVOR</span>
      <button
        class="text-fg-dim hover:text-hi transition-colors cursor-pointer text-sm"
        @click="uiStore.closePlayerDrawer"
      >[X]</button>
    </div>
    <!-- 内容 -->
    <div class="flex-1 overflow-y-auto p-4 space-y-3 text-[11px]">
      <template v-if="playerStore.playerInfo">
        <!-- VITALITY -->
        <div>
          <div class="drawer-section-title">├─ VITALITY</div>
          <div class="stat-bar">
            <div class="stat-fill hp" :style="{ width: hpPct + '%' }"></div>
          </div>
          <div class="drawer-stat-line">{{ playerStore.hp }} / {{ playerStore.mhp }}</div>
        </div>
        <!-- STAMINA -->
        <div>
          <div class="drawer-section-title">├─ STAMINA</div>
          <div class="stat-bar">
            <div class="stat-fill sp" :style="{ width: spPct + '%' }"></div>
          </div>
          <div class="drawer-stat-line">{{ playerStore.sp }} / {{ playerStore.msp }}</div>
        </div>
        <!-- ACTION POINTS -->
        <div>
          <div class="drawer-section-title">├─ ACTION POINTS</div>
          <div class="stat-bar">
            <div class="stat-fill" style="background:#888;" :style="{ width: apPct + '%' }"></div>
          </div>
          <div class="drawer-stat-line">{{ playerStore.ap }} / {{ playerStore.maxAp }}</div>
        </div>
        <!-- EXPERIENCE -->
        <div>
          <div class="drawer-section-title">├─ EXPERIENCE</div>
          <div class="stat-bar">
            <div class="stat-fill exp" :style="{ width: expPct + '%' }"></div>
          </div>
          <div class="drawer-stat-line">LV{{ lvl }} — {{ exp }} / {{ upexp }}</div>
        </div>
        <!-- 杂项 -->
        <div
          class="drawer-stat-line"
          style="padding-top:8px; border-top:1px solid rgba(68,68,68,0.2);"
        >
          <div>├─ ATK: {{ att }} | DEF: {{ def }}</div>
          <div>├─ KILLS: {{ killnum }}</div>
          <div>├─ POS: {{ placeName }} [{{ pls }}]</div>
          <div>└─ STATE: {{ state }}</div>
        </div>
        <!-- PROFILE -->
        <div
          class="drawer-stat-line"
          style="padding-top:8px; border-top:1px solid rgba(68,68,68,0.2);"
        >
          <div class="drawer-section-title">├─ PROFILE</div>
          <div>├─ name: {{ name }}</div>
          <div>└─ {{ genderText }}</div>
        </div>
      </template>
      <div v-else class="loading">loading...</div>
    </div>
  </div>
</template>
