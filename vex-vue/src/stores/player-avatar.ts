/**
 * @module K 状态管理层
 * @framework K-10 角色动画意图派发
 */

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
import { computed, ref } from 'vue';
import type { PlayerAvatarIntent } from '@/types/player-avatar';
import type { AttackKind } from '@/types/actor-runtime';

export type PlayerAppearance = 'normal' | 'battle';

const PLAYER_APPEARANCE_IMAGES: Record<PlayerAppearance, string> = {
  normal: '/img/3.png',
  battle: '/img/3_a.png',
};

export const usePlayerAvatarStore = defineStore('playerAvatar', () => {
  const intent = ref<PlayerAvatarIntent>('idle');
  const intentSeq = ref(0);
  const isDown = ref(false);
  const hpRatio = ref(1);
  const lastIntentTs = ref(0);
  const pendingIntent = ref<PlayerAvatarIntent | null>(null);
  const isFled = ref(false);
  const lastAttackTargetId = ref<string | null>(null);
  const lastAttackKind = ref<AttackKind>('melee');
  const currentAppearance = ref<PlayerAppearance>('normal');
  const desiredAppearance = ref<PlayerAppearance>('normal');
  const currentImage = computed(() => PLAYER_APPEARANCE_IMAGES[currentAppearance.value]);

  // ── 内部：派发意图 ──
  // 防抖：同一意图 50ms 内重复触发只执行一次
  // intentSeq 每次都递增：Vue ref 对相同值赋值不触发 watch，
  // 连续移动（intent 都是 'move'）时需要 intentSeq 变化来触发 composable 的 watch
  // force 参数：移动导演连续派发逐次移动意图时跳过 50ms 抑制，确保序号递增（F-K4-Director §四 K-10）
  function dispatchIntent(next: PlayerAvatarIntent, force = false): void {
    const now = Date.now();
    const suppressed = !force && next === intent.value && now - lastIntentTs.value < 50;
    if (suppressed) return;
    lastIntentTs.value = now;
    intent.value = next;
    intentSeq.value++;
  }

  // ── 自动恢复机制 ──
  function dispatchWithRecovery(next: PlayerAvatarIntent, force = false): void {
    if (next !== 'die' && next !== 'fall' && isDown.value) {
      pendingIntent.value = next;
      dispatchIntent('popup');
      return;
    }
    dispatchIntent(next, force);
  }

  // ── 游戏事件接入（预留接口） ──
  function onEnter(): void       {
    dispatchWithRecovery('enter');
  }
  function onMove(): void        { dispatchWithRecovery('move'); }
  /**
   * 移动导演逐次移动意图派发（F-K4-Director §四 K-10）。
   * 强制跳过 50ms 抑制，确保连续移动 intentSeq 递增，触发 composable watch。
   * 实际玩家位置动画由 useMapEntities 的 entity position watch 驱动，
   * 此意图用于驱动玩家立绘的移动姿态。
   */
  function onNavigateMove(): void { dispatchWithRecovery('move', true); }
  function onBattleStart(): void {
    desiredAppearance.value = 'battle';
    dispatchWithRecovery('battle-start');
  }
  function onBattleEnd(): void {
    desiredAppearance.value = 'normal';
    // flee 后 player alpha=0，退出战斗时需恢复可见性
    if (isFled.value) {
      isFled.value = false;
      pendingIntent.value = 'battle-end';
      dispatchIntent('enter');  // 恢复可见后由 notifyUp 继续切回普通形态
      return;
    }
    dispatchWithRecovery('battle-end');
  }
  function onHit(): void         { dispatchWithRecovery('hit'); }
  function onDie(): void         { dispatchIntent('die'); }
  function onFlee(): void        { isFled.value = true; dispatchIntent('flee'); }
  function onRevive(): void      { dispatchIntent('revive'); }
  function onAttack(targetId?: string, kind?: AttackKind): void {
    lastAttackTargetId.value = targetId ?? null;
    lastAttackKind.value = kind ?? 'melee';
    dispatchWithRecovery('attack');
  }
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

  function commitAppearance(appearance: PlayerAppearance): void {
    currentAppearance.value = appearance;
  }

  /** 战斗场景挂载前固定常规形态，实际翻面由战斗地图的入场序列编排。 */
  function prepareBattleEntry(): void {
    desiredAppearance.value = 'battle';
    currentAppearance.value = 'normal';
    isFled.value = false;
  }

  /** 场景所有权交还探索前同步收敛外观，避免退出意图随战斗 DOM 一起卸载。 */
  function settleBattleExit(): void {
    desiredAppearance.value = 'normal';
    currentAppearance.value = 'normal';
    isFled.value = false;
    pendingIntent.value = null;
  }

  function resetAppearance(): void {
    desiredAppearance.value = 'normal';
    currentAppearance.value = 'normal';
  }

  function preloadAppearanceImages(): void {
    if (typeof Image === 'undefined') return;
    for (const src of Object.values(PLAYER_APPEARANCE_IMAGES)) {
      const image = new Image();
      image.src = src;
    }
  }

  return {
    intent,
    intentSeq,
    isDown,
    hpRatio,
    lastIntentTs,
    pendingIntent,
    isFled,
    lastAttackTargetId,
    lastAttackKind,
    currentAppearance,
    desiredAppearance,
    currentImage,
    onEnter,
    onMove,
    onNavigateMove,
    onBattleStart,
    onBattleEnd,
    onHit,
    onDie,
    onFlee,
    onRevive,
    onAttack,
    onLowHp,
    onNormalHp,
    debugPopUp,
    debugFall,
    notifyUp,
    notifyDown,
    setHpRatio,
    commitAppearance,
    prepareBattleEntry,
    settleBattleExit,
    resetAppearance,
    preloadAppearanceImages,
    dispatchIntent,
  };
});
