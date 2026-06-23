<script setup lang="ts">
// ══════════════════════════════════════════════════
// 战斗演出模态框 / Battle Presentation Modal
//
// 替代现有 vex/js/battle-modal.js 的 DOM 操作逻辑。
// 纯展示模态框，播放 battlelog 条目：
// - 逐条显示，每条带淡入动画（替代原前端打字机效果）
// - 播放完自动关闭
// - 遮罩拦截点击，播放期间禁止操作
//
// 触发方式：
// - battleStore.battleModalOpen 变为 true 时开始播放
// - 播放完成后调用 battleStore.notifyModalClosed() 通知 store
//
// Teleport to body：避免 position: fixed 与父级 transform 冲突（迁移计划风险点 7.3）
// ══════════════════════════════════════════════════

import { ref, computed, watch, nextTick, onUnmounted } from 'vue';
import { useBattleStore } from '@/stores/battle';
import { renderBattleLogEntryHtml } from '@/data/battle-templates';
import type { BattleLogEntry } from '@/types/api';

// ── 播放参数（与原前端 battle-modal.js 一致） ──
const ENTRY_INTERVAL = 500;       // 条目间隔 ms
const COMPLETE_HOLD = 1200;       // 播放完停留 ms
const OVERLAY_FADE_IN = 250;      // 模态框淡入 ms
const OVERLAY_FADE_OUT = 200;     // 模态框淡出 ms
const ENTRY_FADE_DELAY = 20;      // 条目淡入前延迟 ms（触发 CSS transition）

// ── 模态框状态 ──
const overlayOpen = ref<boolean>(false);
const overlayClosing = ref<boolean>(false);
/** 是否正在播放（并发守卫，防止 store 在上一次播放未结束时再触发） */
const playing = ref<boolean>(false);

// ── 显示的条目 ──
interface DisplayedEntry {
  html: string;
  shown: boolean;
  isDivider: boolean;
}
const displayedEntries = ref<DisplayedEntry[]>([]);

// ── HP 条状态 ──
const enemyName = ref<string>('');
const enemyHp = ref<number>(0);
const enemyMaxHp = ref<number>(1);
const playerHp = ref<number>(0);
const playerMaxHp = ref<number>(1);

// ── 播放控制 ──
let currentTimer: ReturnType<typeof setTimeout> | null = null;
let cancelRequested = false;
/** sleep 的 reject 句柄，卸载时主动 reject 避免 playBattleLog 永久挂起 */
let rejectSleep: ((e?: unknown) => void) | null = null;

const battleStore = useBattleStore();

// ── HP 条 class 计算 ──
const enemyHpClass = computed<string>(() => hpBarClass(enemyHp.value, enemyMaxHp.value));
const playerHpClass = computed<string>(() => hpBarClass(playerHp.value, playerMaxHp.value));
const enemyHpPercent = computed<string>(() => hpPercent(enemyHp.value, enemyMaxHp.value));
const playerHpPercent = computed<string>(() => hpPercent(playerHp.value, playerMaxHp.value));

function hpBarClass(hp: number, maxHp: number): string {
  const percent = maxHp > 0 ? (hp / maxHp) * 100 : 0;
  if (percent < 25) return 'critical';
  if (percent < 50) return 'low';
  return '';
}

function hpPercent(hp: number, maxHp: number): string {
  const safeMaxHp = maxHp > 0 ? maxHp : 1;
  const percent = Math.max(0, Math.min(100, (hp / safeMaxHp) * 100));
  return percent + '%';
}

// ── 正文容器 ref（用于自动滚动） ──
const bodyRef = ref<HTMLElement | null>(null);

function scrollToBottom(): void {
  if (bodyRef.value) {
    bodyRef.value.scrollTop = bodyRef.value.scrollHeight;
  }
}

// ══════════════════════════════════════════════════
// 播放逻辑
// ══════════════════════════════════════════════════

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    rejectSleep = reject;
    currentTimer = setTimeout(() => {
      currentTimer = null;
      rejectSleep = null;
      resolve();
    }, ms);
  });
}

async function playBattleLog(): Promise<void> {
  // 并发守卫：上一次播放未结束时跳过
  if (playing.value) {
    battleStore.notifyModalClosed();
    return;
  }
  playing.value = true;
  try {
  const entries = battleStore.battleLogEntries;
  const ctx = battleStore.playContext;
  if (!entries.length || !ctx) {
    battleStore.notifyModalClosed();
    return;
  }

  // 初始化 HP 和名称
  enemyName.value = ctx.enemyName || '敌人';
  enemyHp.value = ctx.enemyHp || 0;
  enemyMaxHp.value = ctx.enemyMaxHp || 1;
  playerHp.value = ctx.playerHp || 0;
  playerMaxHp.value = ctx.playerMaxHp || 1;

  // 清空正文
  displayedEntries.value = [];

  // 显示模态框
  overlayOpen.value = true;
  overlayClosing.value = false;

  // 等待模态框淡入
  await sleep(OVERLAY_FADE_IN);
  if (cancelRequested) return;

  // 按 log_id 排序
  const sorted = [...entries].sort((a, b) => Number(a.log_id || 0) - Number(b.log_id || 0));

  // 逐条播放
  for (let i = 0; i < sorted.length; i++) {
    if (cancelRequested) return;

    const entry = sorted[i];

    // 首条 entry 前显示"战斗开始"分隔符
    if (i === 0) {
      displayedEntries.value.push({ html: '── 战斗开始 ──', shown: false, isDivider: true });
      await nextTick();
      displayedEntries.value[displayedEntries.value.length - 1].shown = true;
      scrollToBottom();
      await sleep(ENTRY_INTERVAL / 2);
      if (cancelRequested) return;
    }

    // 渲染条目 HTML
    const html = renderBattleLogEntryHtml(entry, ctx);
    if (html) {
      displayedEntries.value.push({ html, shown: false, isDivider: false });
      await nextTick();
      // 触发淡入动画
      await sleep(ENTRY_FADE_DELAY);
      displayedEntries.value[displayedEntries.value.length - 1].shown = true;
      scrollToBottom();
    }

    // 更新 HP 条
    updateHpBars(entry);

    await sleep(ENTRY_INTERVAL);
  }

  if (cancelRequested) return;

  // 播放完停留
  await sleep(COMPLETE_HOLD);
  if (cancelRequested) return;

  // 关闭模态框（带淡出动画）
  overlayClosing.value = true;
  overlayOpen.value = false;
  await sleep(OVERLAY_FADE_OUT);
  overlayClosing.value = false;
  displayedEntries.value = [];

  // 通知 store 播放完成
  battleStore.notifyModalClosed();
  } catch {
    // 组件卸载时 sleep 被 reject，通知 store 播放中断（避免 store Promise 永久挂起）
    battleStore.notifyModalClosed();
  } finally {
    playing.value = false;
  }
}

/**
 * 根据 battlelog 条目更新 HP 条
 *
 * 从 entry.extra 的 target_newhp 读取。
 * 根据 actor_type/target_type 判断哪一方是玩家、哪一方是 NPC。
 */
function updateHpBars(entry: BattleLogEntry): void {
  if (!entry.extra) return;
  const extra = entry.extra as { target_newhp?: number };

  // 玩家攻击敌人 → 更新敌人 HP
  if (Number(entry.actor_type) === 0 && Number(entry.target_type) > 0) {
    if (extra.target_newhp !== undefined) {
      enemyHp.value = extra.target_newhp;
    }
  }

  // 敌人攻击玩家 → 更新玩家 HP
  if (Number(entry.actor_type) > 0 && Number(entry.target_type) === 0) {
    if (extra.target_newhp !== undefined) {
      playerHp.value = extra.target_newhp;
    }
  }
}

// ══════════════════════════════════════════════════
// 监听 store 触发播放
// ══════════════════════════════════════════════════

watch(
  () => battleStore.battleModalOpen,
  (open) => {
    if (open) {
      cancelRequested = false;
      playBattleLog();
    }
  },
);

// ══════════════════════════════════════════════════
// 生命周期清理
// ══════════════════════════════════════════════════

onUnmounted(() => {
  cancelRequested = true;
  if (currentTimer) {
    clearTimeout(currentTimer);
    currentTimer = null;
  }
  // 主动 reject sleep，让 playBattleLog 的 await sleep 抛异常进入 catch
  // catch 中调用 notifyModalClosed() 通知 store resolve Promise，避免永久挂起
  if (rejectSleep) {
    const r = rejectSleep;
    rejectSleep = null;
    r(new Error('BattleModal unmounted'));
  }
});
</script>

<template>
  <Teleport to="body">
    <div
      class="battle-modal-overlay"
      :class="{ open: overlayOpen, closing: overlayClosing }"
    >
      <div class="battle-modal">
        <!-- 头部：双方名称 + HP 条 -->
        <div class="battle-modal-header">
          <div class="battle-modal-combatant enemy">
            <span class="battle-modal-combatant-name">{{ enemyName }}</span>
            <div class="battle-modal-hp-bar">
              <div
                class="battle-modal-hp-fill"
                :class="enemyHpClass"
                :style="{ width: enemyHpPercent }"
              ></div>
            </div>
            <span class="battle-modal-hp-text">HP: {{ enemyHp }}/{{ enemyMaxHp }}</span>
          </div>
          <div class="battle-modal-combatant player">
            <span class="battle-modal-combatant-name">你</span>
            <div class="battle-modal-hp-bar">
              <div
                class="battle-modal-hp-fill"
                :class="playerHpClass"
                :style="{ width: playerHpPercent }"
              ></div>
            </div>
            <span class="battle-modal-hp-text">HP: {{ playerHp }}/{{ playerMaxHp }}</span>
          </div>
        </div>

        <!-- 正文：battlelog 逐条显示 -->
        <div ref="bodyRef" class="battle-modal-body">
          <div
            v-for="(entry, i) in displayedEntries"
            :key="i"
            class="battle-log-entry"
            :class="{
              shown: entry.shown,
              'turn-divider': entry.isDivider,
            }"
            v-html="entry.html"
          ></div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
