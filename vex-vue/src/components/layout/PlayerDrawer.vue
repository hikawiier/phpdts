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
import { useCharacterStore } from '@/stores/character';
import { useUiStore } from '@/stores/ui';
import { getPlaceName, getGenderText } from '@/utils/format';
import { getStatusDisplayName, getStatusLocale } from '@/data/status-locale';

const playerStore = usePlayerStore();
const characterStore = useCharacterStore();
const uiStore = useUiStore();

// ── 进度条百分比 ──
const hpPct = computed(() => {
  const player = characterStore.player;
  const mhp = player?.mhp ?? 1;
  return mhp ? ((player?.hp ?? 0) / mhp) * 100 : 0;
});

const spPct = computed(() => {
  const player = characterStore.player;
  const msp = player?.msp ?? 1;
  return msp ? ((player?.sp ?? 0) / msp) * 100 : 0;
});

const apPct = computed(() => {
  const player = characterStore.player;
  const maxAp = player?.max_ap ?? 1;
  return maxAp ? ((player?.ap ?? 0) / maxAp) * 100 : 0;
});

const expPct = computed(() => {
  const player = characterStore.player;
  const d = playerStore.playerInfo;
  if (!player || !d || !d.upexp) return 0;
  const upexp = Number(d.upexp);
  if (!upexp) return 0;
  return (player.exp / upexp) * 100;
});

// ── oblpara.killnum ──
const killnum = computed(() => {
  const d = playerStore.playerInfo;
  return d?.oblpara?.killnum || 0;
});

const lvl = computed(() => characterStore.player?.lvl ?? 0);
const exp = computed(() => characterStore.player?.exp ?? 0);
const upexp = computed(() => playerStore.playerInfo?.upexp || '100');
const att = computed(() => characterStore.player?.att ?? 0);
const def = computed(() => characterStore.player?.def ?? 0);
const state = computed(() => characterStore.player?.state ?? 0);
const pls = computed(() => characterStore.player?.pls ?? 0);
const name = computed(() => characterStore.player?.name ?? '');
const gd = computed(() => characterStore.player?.gd ?? '');

const placeName = computed(() => getPlaceName(pls.value));
const genderText = computed(() => getGenderText(gd.value));
const statuses = computed(() => playerStore.statuses);
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
      <template v-if="characterStore.player">
        <!-- VITALITY -->
        <div>
          <div class="drawer-section-title">├─ VITALITY</div>
          <div class="stat-bar">
            <div class="stat-fill hp" :style="{ width: hpPct + '%' }"></div>
          </div>
          <div class="drawer-stat-line">{{ characterStore.player?.hp ?? 0 }} / {{ characterStore.player?.mhp ?? 0 }}</div>
        </div>
        <!-- STAMINA -->
        <div>
          <div class="drawer-section-title">├─ STAMINA</div>
          <div class="stat-bar">
            <div class="stat-fill sp" :style="{ width: spPct + '%' }"></div>
          </div>
          <div class="drawer-stat-line">{{ characterStore.player?.sp ?? 0 }} / {{ characterStore.player?.msp ?? 0 }}</div>
        </div>
        <!-- ACTION POINTS -->
        <div>
          <div class="drawer-section-title">├─ ACTION POINTS</div>
          <div class="stat-bar">
            <div class="stat-fill" style="background:#888;" :style="{ width: apPct + '%' }"></div>
          </div>
          <div class="drawer-stat-line">{{ characterStore.player?.ap ?? 0 }} / {{ characterStore.player?.max_ap ?? 0 }}</div>
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
          v-if="statuses.length > 0"
          class="drawer-stat-line"
          style="padding-top:8px; border-top:1px solid rgba(68,68,68,0.2);"
        >
          <div class="drawer-section-title">├─ STATUS EFFECTS</div>
          <div v-for="status in statuses" :key="status.instance_uid || status.status_id" style="margin-top:6px;">
            <div>├─ {{ getStatusDisplayName(status) }}</div>
            <div class="dim">{{ getStatusLocale(status.status_id).description }}</div>
          </div>
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
