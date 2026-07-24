<script setup lang="ts">
/**
 * @module K 状态管理层
 */
// ══════════════════════════════════════════════════
// 状态栏 / Status Bar — 单一顶栏所有者（F-K1-Scenes §三不变量 3 / B5.41）
//
// 替代现有 vex/index.html 的 .status-bar + vex/js/player.js 的 applyStatusBar()。
//
// 三场景顶栏切换（v-if/v-else-if/v-else 强制单一顶栏，不重复）：
//   - 探索场景：区域 + 位置 + HP/SP + tick + 全局入口（属性/战斗/背包/完整地图）
//   - 完整地图场景：返回 + 区域 + 地图工具 + 当前目标（3.3 详细实现，本子任务留骨架）
//   - 战斗场景：战斗状态 + HP/SP + 禁用导航（3.5 详细实现 phase/actor/AP）
//
// 右侧头像三场景共享。
//
// 数据来源：playerStore（HP/SP/tick/头像）+ mapStore（区域/位置名）
//         + sceneStore（场景所有权）+ battleStore（战斗模式派生）
// ══════════════════════════════════════════════════

import { computed, ref, watch } from 'vue';
import { usePlayerStore } from '@/stores/player';
import { useCharacterStore } from '@/stores/character';
import { useMapStore } from '@/stores/map';
import { useUiStore } from '@/stores/ui';
import { useBattleStore } from '@/stores/battle';
import { useSceneStore } from '@/stores/scene-store';
import { useAtlasStore } from '@/stores/atlas-store';
import { dataManager } from '@/stores/data-manager';
import { commandQueue } from '@/stores/command-queue';
import { getPlaceName } from '@/utils/format';
import type { BattleState } from '@/types/api';
import { getStatusDisplayName, getStatusLocale } from '@/data/status-locale';
import { UI_TEXT } from '@/data/ui-locale';

const playerStore = usePlayerStore();
const characterStore = useCharacterStore();
const mapStore = useMapStore();
const uiStore = useUiStore();
const battleStore = useBattleStore();
const sceneStore = useSceneStore();
const atlasStore = useAtlasStore();

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
  const player = characterStore.player;
  const mhp = player?.mhp ?? 1;
  return Math.max(0, Math.min(100, ((player?.hp ?? 0) / mhp) * 100));
});

const spPct = computed(() => {
  const player = characterStore.player;
  const msp = player?.msp ?? 1;
  return Math.max(0, Math.min(100, ((player?.sp ?? 0) / msp) * 100));
});

const hpDanger = computed(() => {
  const player = characterStore.player;
  const mhp = player?.mhp ?? 1;
  return (player?.hp ?? 0) / mhp < 0.3;
});

// ── 天与昼夜相位（E-11）+ tick 调试 ──
// 显示格式：D3 昼 · T:245/240
//   - D3 昼：玩家日常感知游戏世界时间（天 + 相位中文化）
//   - T:245/240：调试场景保留 tick 调试能力（obl_tick / obl_pretick）
const tickText = computed(() => {
  const phaseLabel = playerStore.isNight ? '夜' : '昼';
  return `D${playerStore.oblDay} ${phaseLabel} · T:${playerStore.oblTick}/${playerStore.oblPretick}`;
});

const tickPending = computed(() => playerStore.oblTick > playerStore.oblPretick);
const isNight = computed(() => playerStore.isNight);

// ── 战斗状态机调试显示 ──
const battleStateText = computed(() => {
  const state = playerStore.oblBattleState;
  const stateMap: Record<BattleState, string> = {
    IDLE: '空闲',
    AWAITING_INPUT: '等待玩家',
    AUTO_PENDING: '系统待行动',
    EXECUTING: '执行中',
  };
  return stateMap[state] || state;
});

// ── 战斗场景顶栏：阶段/行动者/AP（3.5 补全 / B5.40 / F-K5-Feedback §5.1） ──
// 数据来源：battleStore.combatContext（CombatViewModel | null）
//   - 战斗阶段：round_num + turn_seq → "回合 N · 顺位 M"
//   - 行动者：combatants 中 active_pid 对应的参战者名称
//   - AP：combatants 中 type=0（玩家）的 ap / max_ap
const combatContext = computed(() => battleStore.combatContext);

/** 战斗阶段文本（pre-battle 时 combatContext=null，显示"战斗中"占位） */
const battlePhaseText = computed(() => {
  const ctx = combatContext.value;
  if (!ctx) return '战斗中';
  return `回合 ${ctx.round_num} · 顺位 ${ctx.turn_seq}`;
});

/** 当前行动者名称（玩家或敌人，由 active_pid 决定） */
const activeActorName = computed(() => {
  const ctx = combatContext.value;
  if (!ctx) return '';
  const actor = ctx.combatants.find((c) => c.pid === ctx.active_pid);
  return actor?.name ?? '';
});

/** 玩家 AP（从 combatants 中 type=0 的参战者派生） */
const playerAP = computed<{ ap: number; maxAp: number } | null>(() => {
  const ctx = combatContext.value;
  if (!ctx) return null;
  const player = ctx.combatants.find((c) => c.type === 0);
  if (!player) return null;
  return { ap: player.ap, maxAp: player.max_ap };
});

/** 玩家是否当前行动者（决定行动者标签是否高亮） */
const isPlayerActive = computed(() => {
  const ctx = combatContext.value;
  if (!ctx) return false;
  const player = ctx.combatants.find((c) => c.type === 0);
  return player?.pid === ctx.active_pid;
});

// ── 后端系统回合提示（由 AUTO_PENDING / EXECUTING 派生） ──
// 非 debug 模式下显示"NPC 行动中…"轻量提示；debug 模式下由 tick 调试信息覆盖
const npcPending = computed(() => commandQueue.pendingNpc);
const visibleStatuses = computed(() => playerStore.statuses);
const enterCombatBlock = computed(() => commandQueue.getCapabilityBlock('enter_combat'));
const battleButtonText = computed(() => {
  if (uiStore.battleBtnState === 'aim') return '取消瞄准';
  if (uiStore.battleBtnState === 'battle') {
    return playerStore.isInBattle ? '战斗中' : '取消';
  }
  return '战斗';  // normal
});
const battleButtonDisabled = computed(() => {
  if (uiStore.battleBtnState === 'normal') return enterCombatBlock.value !== null;
  if (uiStore.battleBtnState === 'battle') return playerStore.isInBattle;
  return false;  // aim
});
const battleButtonTitle = computed(() => {
  if (uiStore.battleBtnState === 'battle' && playerStore.isInBattle) {
    return '战斗进行中，无法主动退出';
  }
  return enterCombatBlock.value?.message || '';
});

function statusTitle(statusId: string): string {
  return getStatusLocale(statusId).description;
}

// ── 完整地图顶栏：当前目标显示 + 缩放百分比（B5.39） ──
const atlasTargetLabel = computed<string>(() => {
  const t = atlasStore.target;
  if (t.kind === 'none') return '无';
  if (t.kind === 'paused') return `暂停：${t.name}`;
  return t.name;
});
const atlasZoomPct = computed<number>(() => Math.round(atlasStore.zoom * 100));

// ── 战斗按钮点击处理 ──
// normal 态：startBattle(0)（无指定敌人，进入战斗模式）
// battle 态：退出预战斗 UI（常态战斗态由 disabled 阻止）
// aim 态：广播 battle:aim-exit（退出瞄准模式，PreloadArea 监听后清理）
function onBattleBtnClick(): void {
  if (battleButtonDisabled.value) return;
  if (uiStore.battleBtnState === 'normal') {
    battleStore.startBattle(0);
  } else if (uiStore.battleBtnState === 'battle') {
    battleStore.exitBattleMode();
  } else if (uiStore.battleBtnState === 'aim') {
    dataManager.broadcast('battle:aim-exit');
  }
}

function onAvatarError(): void {
  avatarLoaded.value = false;
}
</script>

<template>
  <div class="status-bar flex-none" :class="{ 'is-night': isNight }">
    <!-- ═══ 探索场景顶栏：位置 + HP/SP + tick + 全局入口（B5.38） ═══ -->
    <div v-if="sceneStore.isExplore" class="status-left">
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
          {{ UI_TEXT.HP }} {{ characterStore.player?.hp ?? 0 }}/{{ characterStore.player?.mhp ?? 0 }}
        </span>
      </div>
      <!-- 第二行：位置名 + SP + 状态效果 chip（§3.6 chip 从第三行移入） -->
      <div class="status-bar-row">
        <span class="status-location">{{ locationName }}</span>
        <div class="bar-container">
          <div
            class="bar-fill sp"
            :style="{ width: spPct + '%' }"
          ></div>
        </div>
        <span class="bar-text">{{ UI_TEXT.SP }} {{ characterStore.player?.sp ?? 0 }}/{{ characterStore.player?.msp ?? 0 }}</span>
        <span v-if="visibleStatuses.length > 0" class="status-effects">
          <span
            v-for="status in visibleStatuses"
            :key="status.instance_uid || status.status_id"
            class="status-effect-chip"
            :title="statusTitle(status.status_id)"
          >{{ getStatusDisplayName(status) }}</span>
        </span>
      </div>
      <!-- 第三行：导航按钮三分布（属性 居左 / 战斗 居中 / 背包 / 完整地图 居右）
           §3.6 v0.7：延用 v0.4 第一版 .status-nav-btn 视觉权重，按钮独立分布
           完整地图入口：进入 atlas 模态场景（F-K1-Scenes §5.1） -->
      <div class="status-bar-row status-nav-row">
        <button
          class="status-nav-btn"
          :class="{ 'is-active': uiStore.playerDrawerOpen }"
          @click="uiStore.togglePlayerDrawer"
        >属性</button>
        <button
          class="status-nav-btn"
          :class="{
            'is-active': battleStore.currentMode === 'battle',
            'is-battle-active': battleStore.currentMode === 'battle',
          }"
          :disabled="battleButtonDisabled"
          :title="battleButtonTitle"
          @click="onBattleBtnClick"
        >{{ battleButtonText }}</button>
        <button
          class="status-nav-btn"
          :class="{ 'is-active': uiStore.inventoryDrawerOpen }"
          @click="uiStore.toggleInventoryDrawer"
        >背包</button>
        <button
          class="status-nav-btn"
          @click="sceneStore.openAtlas"
        >完整地图</button>
      </div>
    </div>

    <!-- ═══ 完整地图场景顶栏：返回 + 区域 + 地图工具 + 当前目标（3.3 详细实现 / B5.39） ═══ -->
    <div v-else-if="sceneStore.isAtlas" class="status-left">
      <div class="status-bar-row">
        <button
          class="status-nav-btn is-active"
          @click="sceneStore.closeAtlas"
        >返回</button>
        <span class="status-location">{{ regionName }}</span>
        <span class="atlas-target-display">
          <span class="atlas-muted">目标：</span>
          <span :class="atlasStore.target.kind === 'none' ? 'atlas-muted' : 'atlas-target-name'">{{ atlasTargetLabel }}</span>
        </span>
        <span
          class="status-tick-debug"
          :class="{ pending: tickPending }"
          title="obl_tick / obl_pretick — 两者相等时NPC AI不触发 | obl_battle_state"
        >{{ tickText }} | {{ battleStateText }}</span>
      </div>
      <div class="status-bar-row status-nav-row atlas-tools-row">
        <div class="atlas-tools">
          <button class="status-nav-btn atlas-tool-btn" @click="atlasStore.zoomOut" title="缩小">[−]</button>
          <span class="atlas-zoom-pct">{{ atlasZoomPct }}%</span>
          <button class="status-nav-btn atlas-tool-btn" @click="atlasStore.zoomIn" title="放大">[+]</button>
          <button class="status-nav-btn atlas-tool-btn" @click="atlasStore.focusPlayer" title="定位玩家">[玩家]</button>
          <button
            class="status-nav-btn atlas-tool-btn"
            :disabled="!atlasStore.hasTarget"
            @click="atlasStore.focusTarget"
            title="定位临时目标"
          >[目标]</button>
          <button class="status-nav-btn atlas-tool-btn" @click="atlasStore.resetView" title="恢复初始适配">[适配]</button>
          <button
            class="status-nav-btn atlas-tool-btn"
            :class="{ 'is-active': atlasStore.routeVisible }"
            @click="atlasStore.toggleRoute"
            title="当前路线显示开关"
          >[路线]</button>
          <button
            class="status-nav-btn atlas-tool-btn"
            :class="{ 'is-active': atlasStore.historyVisible }"
            @click="atlasStore.toggleHistory"
            title="历史路线图层开关"
          >[历史]</button>
        </div>
        <span class="atlas-muted">{{ atlasStore.gridW }}×{{ atlasStore.gridH }} 区域</span>
      </div>
    </div>

    <!-- ═══ 战斗场景顶栏：战斗阶段 + 行动者 + AP + HP/SP + 禁用导航（3.5 详细实现 / B5.40 / F-K5-Feedback §5.1） ═══ -->
    <div v-else class="status-left">
      <!-- 第一行：战斗阶段 + tick 调试 + HP（与探索场景第一行对齐） -->
      <div class="status-bar-row">
        <span class="status-location">{{ battlePhaseText }}</span>
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
          {{ UI_TEXT.HP }} {{ characterStore.player?.hp ?? 0 }}/{{ characterStore.player?.mhp ?? 0 }}
        </span>
      </div>
      <!-- 第二行：行动者 + AP + SP + 状态效果 chip -->
      <div class="status-bar-row">
        <span
          v-if="activeActorName"
          class="status-actor"
          :class="{ 'is-player-turn': isPlayerActive }"
          :title="isPlayerActive ? '你的回合' : '敌方行动中'"
        >行动者 · {{ activeActorName }}</span>
        <span v-if="playerAP" class="status-ap" title="行动点数（AP）">
          AP {{ playerAP.ap }}/{{ playerAP.maxAp }}
        </span>
        <div class="bar-container">
          <div
            class="bar-fill sp"
            :style="{ width: spPct + '%' }"
          ></div>
        </div>
        <span class="bar-text">{{ UI_TEXT.SP }} {{ characterStore.player?.sp ?? 0 }}/{{ characterStore.player?.msp ?? 0 }}</span>
        <span v-if="visibleStatuses.length > 0" class="status-effects">
          <span
            v-for="status in visibleStatuses"
            :key="status.instance_uid || status.status_id"
            class="status-effect-chip"
            :title="statusTitle(status.status_id)"
          >{{ getStatusDisplayName(status) }}</span>
        </span>
      </div>
      <!-- 第三行：导航按钮（属性/背包禁用；战斗按钮派生三态，提供"退出预战斗"入口，F-K1-Scenes §三不变量） -->
      <div class="status-bar-row status-nav-row">
        <button class="status-nav-btn" disabled>属性</button>
        <button
          class="status-nav-btn is-battle-active"
          :disabled="battleButtonDisabled"
          :title="battleButtonTitle"
          @click="onBattleBtnClick"
        >{{ battleButtonText }}</button>
        <button class="status-nav-btn" disabled>背包</button>
      </div>
    </div>

    <!-- 右侧：头像（三场景共享） -->
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

<style scoped>
/* ═══ 完整地图顶栏：地图工具 + 目标显示（B5.39） ═══ */
.atlas-target-display {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: #888;
  font-size: 11px;
  letter-spacing: 0.05em;
  white-space: nowrap;
}
.atlas-muted {
  color: #555;
  font-size: 11px;
  letter-spacing: 0.05em;
  white-space: nowrap;
}
.atlas-target-name {
  color: #ddd;
  font-size: 11px;
  letter-spacing: 0.05em;
  white-space: nowrap;
}
.atlas-tools-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.atlas-tools {
  display: flex;
  align-items: center;
  gap: 4px;
}
.atlas-tool-btn {
  padding: 2px 6px;
  font-size: 11px;
  letter-spacing: 0.05em;
}
.atlas-zoom-pct {
  color: #888;
  font-size: 10px;
  min-width: 32px;
  text-align: center;
  letter-spacing: 0.05em;
}

/* ═══ 战斗场景顶栏：行动者 + AP（3.5 补全 / B5.40） ═══ */
/* 行动者标签：灰阶区分玩家/敌方回合（§3.4 少即是多，不为不同等级增加彩色信号色） */
.status-actor {
  color: #aaa;
  font-size: 11px;
  letter-spacing: 0.05em;
  white-space: nowrap;
  flex: 0 0 auto;
}
.status-actor.is-player-turn {
  color: #fff;
  font-weight: 700;
}
/* AP 标签：行动点数，灰阶显示 */
.status-ap {
  color: #888;
  font-size: 11px;
  letter-spacing: 0.05em;
  white-space: nowrap;
  flex: 0 0 auto;
}
</style>
