<script setup lang="ts">
// ══════════════════════════════════════════════════
// 碰撞动画 / Collision Animation
//
// 替代现有 vex/js/battle-animation.js 的 playCollisionAnimation()。
// 地图上的即时反馈动画：
// - 攻击方冲刺（向受击方方向位移后回位）
// - 受击方抖动（延迟 120ms，模拟命中时机）
//
// 触发方式：监听 dataManager 'battle:play-action-animation' 事件
// 数据格式：{ action: DirectedActionV2, plan: ActionAnimationPlan, npcPid: number }
//
// DOM 操作说明：
// 由于需要直接操作地图格元素的 class 和 CSS 变量（触发 CSS 动画），
// 无法用 Vue 响应式实现，保留原前端的 DOM 操作方式。
// 只添加/移除临时 class 和 CSS 变量，不影响 Vue 虚拟 DOM。
// ══════════════════════════════════════════════════

import { onMounted, onUnmounted } from 'vue';
import { dataManager } from '@/stores/data-manager';
import type { ActionAnimationPlan, CombatantView, CombatTargetView, DirectedActionV2 } from '@/stores/battle-director-v2';
import type { PlayActionAnimationEventData } from '@/types/events';

// 动画时长（与原前端一致）
const LUNGE_DURATION = 300;
const SHAKE_DELAY = 120;
const SHAKE_DURATION = 300;

// 定时器跟踪（onUnmounted 时清理）
const timers: ReturnType<typeof setTimeout>[] = [];

function addTimer(fn: () => void, ms: number): void {
  const timer = setTimeout(fn, ms);
  timers.push(timer);
}

function clearAllTimers(): void {
  for (const timer of timers) {
    clearTimeout(timer);
  }
  timers.length = 0;
}

// ══════════════════════════════════════════════════
// DOM 元素查询
// ══════════════════════════════════════════════════

/** 获取玩家地图元素（当前格） */
function getPlayerElement(): HTMLElement | null {
  const grid = document.getElementById('mapGrid');
  if (!grid) return null;
  return grid.querySelector<HTMLElement>('.map-cell.current');
}

/** 获取敌人地图元素 */
function getEnemyElement(enemyPid: number): HTMLElement | null {
  const grid = document.getElementById('mapGrid');
  if (!grid) return null;
  return grid.querySelector<HTMLElement>(`[data-enemy-pid="${enemyPid}"]`);
}

// ══════════════════════════════════════════════════
// 动画播放
// ══════════════════════════════════════════════════

/**
 * 播放动作动画计划
 *
 * 根据 DirectorV2 的 ActionAnimationPlan 判断攻击方/受击方，在地图上播放动画。
 * 玩家元素通过 .current 类定位，敌人元素通过 [data-enemy-pid] 定位。
 *
 * 迁移自现有 vex/js/battle-animation.js playCollisionAnimation()。
 */
function playActionAnimation(action: DirectedActionV2, plan: ActionAnimationPlan, enemyPid: number): void {
  if (!action || !plan) return;
  if (plan.kind !== 'melee_hit' && plan.kind !== 'projectile' && plan.kind !== 'area_burst') return;

  const attackerEl = getCombatantElement(action.actor, enemyPid);
  const primaryTarget = getPrimaryTarget(action, plan);
  const targetEl = primaryTarget
    ? getTargetElement(primaryTarget, enemyPid)
    : getElementByPlanId(plan.targetIds?.[0] ?? '', enemyPid);

  if (!attackerEl || !targetEl) return;

  // 计算冲刺方向（攻击方 → 受击方）
  const lunge = calculateLungeVector(attackerEl, targetEl);

  // 1. 攻击方冲刺
  playLunge(attackerEl, lunge.x, lunge.y);

  // 2. 受击方抖动（延迟 120ms，模拟命中时机）
  addTimer(() => {
    playShake(targetEl);
  }, SHAKE_DELAY);
}

/**
 * 计算冲刺向量（攻击方 → 受击方方向，缩放到 4px）
 */
function calculateLungeVector(
  attackerEl: HTMLElement,
  targetEl: HTMLElement,
): { x: number; y: number } {
  const aRect = attackerEl.getBoundingClientRect();
  const tRect = targetEl.getBoundingClientRect();

  const dx = tRect.left + tRect.width / 2 - (aRect.left + aRect.width / 2);
  const dy = tRect.top + tRect.height / 2 - (aRect.top + aRect.height / 2);

  const distance = Math.sqrt(dx * dx + dy * dy);
  if (distance === 0) return { x: 0, y: 0 };

  // 缩放到 4px 位移
  const scale = 4 / distance;
  return {
    x: Math.round(dx * scale),
    y: Math.round(dy * scale),
  };
}

/**
 * 播放冲刺动画
 *
 * 通过 CSS 变量 --lunge-x/y 控制方向，class attack-lunge 触发动画。
 */
function playLunge(el: HTMLElement, x: number, y: number): void {
  el.style.setProperty('--lunge-x', x + 'px');
  el.style.setProperty('--lunge-y', y + 'px');
  el.classList.remove('attack-lunge');
  // 触发重排以重启动画
  void el.offsetWidth;
  el.classList.add('attack-lunge');

  // 动画结束后清理
  addTimer(() => {
    el.classList.remove('attack-lunge');
    el.style.removeProperty('--lunge-x');
    el.style.removeProperty('--lunge-y');
  }, LUNGE_DURATION);
}

/**
 * 播放抖动动画
 *
 * 通过 class hit-shake 触发动画。
 */
function playShake(el: HTMLElement): void {
  el.classList.remove('hit-shake');
  void el.offsetWidth;
  el.classList.add('hit-shake');

  addTimer(() => {
    el.classList.remove('hit-shake');
  }, SHAKE_DURATION);
}

// ══════════════════════════════════════════════════
// 事件监听
// ══════════════════════════════════════════════════

function onPlayActionAnimation(data: unknown): void {
  const payload = data as PlayActionAnimationEventData;
  if (!payload || !payload.action || !payload.plan || typeof payload.npcPid !== 'number') return;
  playActionAnimation(payload.action, payload.plan, payload.npcPid);
}

onMounted(() => {
  dataManager.listen('battle:play-action-animation', onPlayActionAnimation);
});

onUnmounted(() => {
  clearAllTimers();
});

// 暴露方法供外部调用（备用，主要通过事件触发）
defineExpose({
  playActionAnimation,
});

function getCombatantElement(combatant: CombatantView, fallbackEnemyPid: number): HTMLElement | null {
  if (combatant.type === 0) return getPlayerElement();
  return getEnemyElement(combatant.pid || fallbackEnemyPid);
}

function getTargetElement(target: CombatTargetView, fallbackEnemyPid: number): HTMLElement | null {
  if (target.snapshot) return getCombatantElement(target.snapshot, fallbackEnemyPid);
  if (target.id === 'player') return getPlayerElement();
  if (target.pid && target.pid > 0) return getEnemyElement(target.pid);
  return getElementByPlanId(target.id, fallbackEnemyPid);
}

function getElementByPlanId(id: string, fallbackEnemyPid: number): HTMLElement | null {
  if (id === 'player') return getPlayerElement();
  const enemyMatch = /^enemy-(\d+)$/.exec(id);
  if (enemyMatch) return getEnemyElement(Number(enemyMatch[1]));
  const pidMatch = /^pid-(\d+)$/.exec(id);
  if (pidMatch) return getEnemyElement(Number(pidMatch[1]));
  if (fallbackEnemyPid > 0) return getEnemyElement(fallbackEnemyPid);
  return null;
}

function getPrimaryTarget(action: DirectedActionV2, plan: ActionAnimationPlan): CombatTargetView | null {
  const targetIds = plan.targetIds ?? [];
  if (targetIds.length > 0) {
    const matched = action.targets.find(target => targetIds.includes(target.id));
    if (matched) return matched;
  }
  return action.targets.find(target => target.kind === 'pid' || target.kind === 'self') ?? null;
}
</script>

<template>
  <!-- 纯逻辑组件，无 UI -->
</template>
