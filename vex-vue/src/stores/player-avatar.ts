// ══════════════════════════════════════════════════
// playerAvatar store
//
// 玩家小人意图层：事件源调 onXxx() action，store 派发意图，
// usePlayerAvatar composable watch(intent) 执行 GSAP 动画。
//
// 自动恢复机制（pendingIntent 回调链，非 setTimeout）：
//   任何"非 die/fall"意图触发时若 isDown=true：
//     1. 暂存 next 到 pendingIntent
//     2. 只派发 'popup'（popUp 动画开始）
//     3. popUp 回弹完成时 composable 调 notifyUp()
//     4. notifyUp 派发 pendingIntent（此时 popUp 已完成，不会被打断）
//
// isDown 由动画层回调更新：
//   - popUp 的 notifyUp 必须挂在回弹 tween 上（非 timeline onComplete，
//     因末尾 idle 循环 repeat:-1 会导致 timeline 永不完成）
//   - fall 的 notifyDown 挂在 timeline.onComplete（fall 末尾无 repeat）
// ══════════════════════════════════════════════════

import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { PlayerAvatarIntent } from '@/types/player-avatar';

export const usePlayerAvatarStore = defineStore('playerAvatar', () => {
  const intent = ref<PlayerAvatarIntent>('idle');
  const intentSeq = ref(0);
  const isDown = ref(false);
  const hpRatio = ref(1);
  const lastIntentTs = ref(0);
  const pendingIntent = ref<PlayerAvatarIntent | null>(null);

  // ── 内部：派发意图 ──
  // 防抖：同一意图 50ms 内重复触发只执行一次
  // intentSeq 每次都递增：Vue ref 对相同值赋值不触发 watch，
  // 连续移动（intent 都是 'move'）时需要 intentSeq 变化来触发 composable 的 watch
  function dispatchIntent(next: PlayerAvatarIntent): void {
    const now = Date.now();
    if (next === intent.value && now - lastIntentTs.value < 50) return;
    lastIntentTs.value = now;
    intent.value = next;
    intentSeq.value++;
  }

  // ── 自动恢复机制 ──
  function dispatchWithRecovery(next: PlayerAvatarIntent): void {
    if (next !== 'die' && next !== 'fall' && isDown.value) {
      pendingIntent.value = next;
      dispatchIntent('popup');
      return;
    }
    dispatchIntent(next);
  }

  // ── 游戏事件接入（预留接口） ──
  function onEnter(): void       { dispatchWithRecovery('enter'); }
  function onMove(): void        { dispatchWithRecovery('move'); }
  function onBattleStart(): void { dispatchWithRecovery('battle-start'); }
  function onBattleEnd(): void   { dispatchWithRecovery('battle-end'); }
  function onHit(): void         { dispatchWithRecovery('hit'); }
  function onDie(): void         { dispatchIntent('die'); }
  function onLowHp(): void       { dispatchWithRecovery('low-hp'); }
  function onNormalHp(): void    { dispatchWithRecovery('normal-hp'); }

  // ── 调试接口 ──
  function debugPopUp(): void    { dispatchIntent('popup'); }
  function debugFall(): void     { dispatchIntent('fall'); }

  // ── 内部：动画层回调通知 ──
  function notifyUp(): void {
    isDown.value = false;
    if (pendingIntent.value) {
      const pending = pendingIntent.value;
      pendingIntent.value = null;
      dispatchIntent(pending);
    }
  }
  function notifyDown(): void {
    isDown.value = true;
    pendingIntent.value = null;
  }

  // ── HP 比例更新 ──
  function setHpRatio(ratio: number): void {
    hpRatio.value = ratio;
  }

  return {
    intent,
    intentSeq,
    isDown,
    hpRatio,
    lastIntentTs,
    pendingIntent,
    onEnter,
    onMove,
    onBattleStart,
    onBattleEnd,
    onHit,
    onDie,
    onLowHp,
    onNormalHp,
    debugPopUp,
    debugFall,
    notifyUp,
    notifyDown,
    setHpRatio,
    dispatchIntent,
  };
});
