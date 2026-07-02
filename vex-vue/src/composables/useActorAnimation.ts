// ══════════════════════════════════════════════════
// useActorAnimation — 每 actor 独立动画控制器
//
// 封装 isMoving / animToken 竞态保护，每 actor 实例独立持有闭包状态。
// player 和敌人移动互不干扰，未来战斗碰撞可独立 kill。
//
// 关键设计：
//   - el 通过 setEl(el) 命令式注入（普通 Map 无响应式，computed 方案失效）
//   - moveTo 仅处理鸭子步/跳跃，长距离由调用方判断后走 enter/arrive
//     （player 长距离需走 onEnter intent 保证 notifyUp，敌人长距离走 enter，语义不同不宜封装）
//   - moveTo done 内部直接 startIdle + updateEntityZIndex，不绕 intent 系统
//     （保留当前视觉行为，避免 intentSeq + nextTick 延迟）；onDone 仅作附加回调
//   - animToken 机制：每次启动新动画递增，done 回调检查 token 匹配才执行 startIdle，
//     避免旧动画被 kill 后 timeline 立即完成触发旧 done 杀掉新动画的 tween
//   - lockMove/unlockMove 供调度层在 watch 同步阶段预锁定，防止 rAF 窗口期 syncEntityPosition 瞬移
// ══════════════════════════════════════════════════

import gsap from 'gsap';
import {
  setDown, startIdle, popUp, fall,
  moveActor, jumpActor, arriveAnim, fadeOut, hitAnim, attackAnim,
  updateEntityZIndex,
} from '@/animations/actorAnimations';
import type { ActorAnimation, AttackKind } from '@/types/actor-animation';

/** 重新导出类型，供 useMapEntities 引用 */
export type { ActorAnimation, MoveTier, AttackKind } from '@/types/actor-animation';

/** 鸭子步阈值（≤此值走鸭子步） */
const DUCK_MAX_GRID = 1.5;

/**
 * 创建一个 actor 动画控制器
 *
 * 每 actor 实例化一个，闭包封装 isMoving / animToken / el。
 * 通过 setEl(el) 命令式注入 DOM 元素。
 */
export function useActorAnimation(): ActorAnimation {
  let el: HTMLElement | null = null;
  let isMoving = false;
  let animToken = 0;
  let facingDirection: 'left' | 'right' = 'left';

  function getEl(): HTMLElement {
    if (!el) throw new Error('ActorAnimation: el not set');
    return el;
  }

  function setEl(nextEl: HTMLElement | null): void {
    el = nextEl;
    if (el && facingDirection === 'right') {
      el.classList.add('facing-right');
    }
  }

  function setFacing(dir: 'left' | 'right'): void {
    if (dir === facingDirection) return;
    facingDirection = dir;
    const e = getEl();
    if (dir === 'right') e.classList.add('facing-right');
    else e.classList.remove('facing-right');
  }

  function enter(onUp?: () => void): void {
    const e = getEl();
    setDown(e);
    popUp(e, onUp);
  }

  function arrive(): void {
    arriveAnim(getEl());
  }

  function idle(): void {
    startIdle(getEl());
  }

  function playFall(onDown?: () => void): void {
    fall(getEl(), onDown);
  }

  function lockMove(): void {
    isMoving = true;
  }

  function unlockMove(): void {
    isMoving = false;
  }

  function getPosition(): { x: number; y: number } {
    if (!el) return { x: 0, y: 0 };
    return {
      x: gsap.getProperty(el, 'x') as number,
      y: gsap.getProperty(el, 'y') as number,
    };
  }

  function killAll(): void {
    if (el) gsap.killTweensOf(el);
    isMoving = false;
  }

  function moveTo(toX: number, toY: number, cellW: number, cellH: number, onDone?: () => void): void {
    const e = getEl();

    isMoving = true;
    animToken++;
    const myToken = animToken;

    const fromX = gsap.getProperty(e, 'x') as number;
    const fromY = gsap.getProperty(e, 'y') as number;
    const gridDist = Math.max(Math.abs(toX - fromX) / cellW, Math.abs(toY - fromY) / cellH);

    // 设实体尺寸（与 syncEntityPosition 一致，确保 width/height 正确）
    gsap.set(e, { width: cellW, height: cellH });

    const done = () => {
      // 旧动画被新动画的 killTweensOf 杀掉后，旧 timeline 会立即完成触发此 done。
      // 此时 myToken !== animToken，跳过 startIdle，避免杀掉新动画的 tween。
      if (myToken !== animToken) return;
      isMoving = false;
      updateEntityZIndex(e);
      startIdle(e);
      onDone?.();
    };

    // 朝向：右移转右、左移转左、垂直保持当前
    if (toX > fromX) setFacing('right');
    else if (toX < fromX) setFacing('left');

    // moveTo 仅处理鸭子步/跳跃；长距离由调用方判断后走 enter/arrive
    if (gridDist <= DUCK_MAX_GRID) {
      const direction: 1 | -1 | 0 = toX > fromX ? 1 : toX < fromX ? -1 : 0;
      moveActor(e, toX, toY, direction, done);
    } else {
      // gridDist > 1.5 且调用方已排除 long（≤6.5）：跳跃
      jumpActor(e, toX, toY, cellH, done);
    }
  }

  function playFadeOut(onDone?: () => void): void {
    const e = getEl();
    gsap.killTweensOf(e);
    isMoving = false;
    fadeOut(e, onDone);
  }

  function playHit(direction?: 1 | -1 | 0): void {
    const e = getEl();
    // hitAnim 内部已 killTweensOf；onComplete 调 startIdle 恢复呼吸循环
    // （段 2 结束后角色停在 scaleY:1 静止状态，不调 startIdle 会失去 idle 动画）
    hitAnim(e, direction, () => startIdle(e));
  }

  function playAttack(targetPosition?: { x: number; y: number }, kind?: AttackKind): void {
    const e = getEl();
    // 朝向：攻击目标在右侧则转右，左侧则转左
    if (targetPosition) {
      const myX = gsap.getProperty(e, 'x') as number;
      if (targetPosition.x > myX) setFacing('right');
      else if (targetPosition.x < myX) setFacing('left');
    }
    // attackAnim 内部已 killTweensOf；onComplete 调 startIdle 恢复呼吸循环
    attackAnim(e, targetPosition, kind, () => startIdle(e));
  }

  return {
    setEl,
    setFacing,
    enter,
    arrive,
    idle,
    playFall,
    moveTo,
    playFadeOut,
    playHit,
    playAttack,
    lockMove,
    unlockMove,
    getPosition,
    getEl: () => el,
    killAll,
    get isMoving() { return isMoving; },
  };
}
