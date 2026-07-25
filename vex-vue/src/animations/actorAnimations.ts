/**
 * @module K 状态管理层
 */

// 实体动画函数库：所有地图实体的 GSAP 动画实现
// 每个函数接收 ActorElements（anchor/pose/visibility），不关心实体身份
// 调用方（useMapEntities / battle-actor-executor）负责决定何时播放何种动画
import gsap from 'gsap';
import type { ActorElements, AttackKind } from '@/types/actor-runtime';

const Z_STANDING = 10;

// 根据 Y 坐标更新实体的 z-index，实现 Y-sorting
export function updateEntityZIndex(anchor: HTMLElement): void {
  const y = Number(gsap.getProperty(anchor, 'y')) || 0;
  anchor.style.zIndex = String(Z_STANDING + Math.round(y));
}

// 设置实体为倒地位：缩小旋转 + 透明度归零，用于死亡/场景切换
export function setDown(elements: ActorElements): void {
  gsap.killTweensOf(elements.pose);
  gsap.killTweensOf(elements.visibility);
  gsap.set(elements.pose, { x: 0, y: 0, scaleY: 0.04, scaleX: 1, rotation: -90 });
  gsap.set(elements.visibility, { alpha: 0 });
  updateEntityZIndex(elements.anchor);
}

// 启动待机呼吸动画：Y 轴微缩放循环，让实体看起来有生命感
export function startIdle(pose: HTMLElement): gsap.core.Tween {
  gsap.killTweensOf(pose);
  gsap.set(pose, { x: 0, y: 0, scaleY: 1, scaleX: 1, rotation: 0 });
  return gsap.to(pose, {
    scaleY: 1.02,
    scaleX: 0.99,
    duration: 0.6,
    ease: 'sine.inOut',
    yoyo: true,
    repeat: -1,
  });
}

// 弹出动画：实体从地面弹出到正常站立位置，带弹性效果
// 用于新实体出现在地图上时的入场动效
export function popUp(elements: ActorElements): gsap.core.Timeline {
  gsap.killTweensOf(elements.pose);
  gsap.killTweensOf(elements.visibility);
  const tl = gsap.timeline();
  tl.to(elements.pose, {
    scaleY: 0.02, scaleX: 1.05, rotation: -95,
    duration: 0.12, ease: 'power1.in',
  });
  tl.to(elements.pose, {
    scaleY: 1, scaleX: 1, rotation: 0,
    duration: 0.9, ease: 'elastic.out(1, 0.55)',
  });
  tl.to(elements.visibility, { alpha: 1, duration: 0.18, ease: 'power1.out' }, 0.12);
  return tl;
}

// 倒下动画：实体旋转 + 缩小归零，用于死亡/退场效果
export function fall(elements: ActorElements): gsap.core.Timeline {
  gsap.killTweensOf(elements.pose);
  gsap.killTweensOf(elements.visibility);
  const tl = gsap.timeline();
  tl.to(elements.pose, {
    rotation: -22, scaleY: 1.05, scaleX: 0.96,
    duration: 0.1, ease: 'power1.out',
  });
  tl.to(elements.pose, {
    rotation: -90, scaleY: 0.04, scaleX: 1,
    duration: 0.32, ease: 'power2.in',
  });
  tl.to(elements.visibility, { alpha: 0, duration: 0.28, ease: 'power2.in' }, 0.14);
  return tl;
}

export function moveActor(
  anchor: HTMLElement,
  pose: HTMLElement,
  toX: number,
  toY: number,
  direction: 1 | -1 | 0,
): gsap.core.Timeline {
  gsap.killTweensOf(anchor);
  gsap.killTweensOf(pose);
  gsap.set(pose, { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 });
  updateEntityZIndex(anchor);
  const duration = 0.5;
  const swayAmp = 12;
  const swayCycles = 2;
  const swaySegments = swayCycles * 4;
  const swayDir = direction === 0 ? 1 : direction;
  const tl = gsap.timeline();
  tl.to(anchor, {
    x: toX,
    y: toY,
    duration,
    ease: 'power1.inOut',
    onUpdate: () => updateEntityZIndex(anchor),
  }, 0);
  tl.to(pose, {
    rotation: swayDir * swayAmp,
    duration: duration / swaySegments,
    ease: 'sine.inOut',
    yoyo: true,
    repeat: swaySegments - 1,
  }, 0);
  tl.to(pose, {
    scaleY: 0.97,
    duration: duration / (swayCycles * 2),
    ease: 'sine.inOut',
    yoyo: true,
    repeat: swayCycles * 2 - 1,
  }, 0);
  tl.set(pose, { y: 0, rotation: 0, scaleX: 1, scaleY: 1 });
  return tl;
}

export function jumpActor(
  elements: ActorElements,
  toX: number,
  toY: number,
  cellHeight: number,
  onTravelProgress?: (progress: number) => void,
): gsap.core.Timeline {
  gsap.killTweensOf(elements.anchor);
  gsap.killTweensOf(elements.pose);
  updateEntityZIndex(elements.anchor);
  const airTime = 0.5;
  const fromY = Number(gsap.getProperty(elements.anchor, 'y')) || 0;
  const peakY = Math.min(fromY, toY) - cellHeight * 0.6;
  const travel = { progress: 0 };
  const tl = gsap.timeline();
  onTravelProgress?.(0);
  tl.to(travel, {
    progress: 1,
    duration: airTime,
    ease: 'power1.inOut',
  }, 0);
  tl.to(elements.anchor, { x: toX, duration: airTime, ease: 'power1.inOut' }, 0);
  tl.to(elements.anchor, {
    y: peakY, duration: airTime / 2, ease: 'power2.out',
    onUpdate: () => {
      updateEntityZIndex(elements.anchor);
      onTravelProgress?.(travel.progress);
    },
  }, 0);
  tl.to(elements.anchor, {
    y: toY, duration: airTime / 2, ease: 'power2.in',
    onUpdate: () => {
      updateEntityZIndex(elements.anchor);
      onTravelProgress?.(travel.progress);
    },
  }, airTime / 2);
  tl.to(elements.pose, { scaleY: 0.6, duration: 0.1, ease: 'power2.in' }, 0);
  tl.to(elements.pose, { scaleY: 1.2, duration: 0.15, ease: 'power2.out' }, 0.1);
  tl.to(elements.pose, { scaleY: 0.55, duration: 0.25, ease: 'sine.in' }, 0.25);
  // K-12-H：落地弹性从 0.9s 缩短到 0.4s，避免角色到达目标后弹性动画拖沓感
  // 原 0.9s 导致 speed=1 时 64% 时长（900ms）是落地后的弹性振荡，用户感知为"卡顿"
  // 0.4s 保留弹性效果，总时长从 1.4s 降至 0.9s，speed=4 时从 350ms 降至 225ms
  tl.to(elements.pose, { scaleY: 1, duration: 0.4, ease: 'elastic.out(1, 0.35)' }, 0.5);
  return tl;
}

export function arriveAnim(elements: ActorElements): gsap.core.Timeline {
  gsap.killTweensOf(elements.pose);
  gsap.killTweensOf(elements.visibility);
  gsap.set(elements.visibility, { alpha: 0 });
  gsap.set(elements.pose, { scaleY: 0.3, scaleX: 0.3, rotation: 0 });
  const tl = gsap.timeline();
  tl.to(elements.visibility, { alpha: 1, duration: 0.25, ease: 'power1.out' }, 0);
  tl.to(elements.pose, {
    scaleY: 1, scaleX: 1, duration: 0.4, ease: 'back.out(1.7)',
  }, 0);
  return tl;
}

export function transformAppearance(
  pose: HTMLElement,
  swap: () => void,
): gsap.core.Timeline {
  gsap.killTweensOf(pose);
  const reducedMotion = typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const tl = gsap.timeline();

  if (reducedMotion) {
    tl.call(swap);
    tl.set(pose, { x: 0, y: 0, rotation: 0, rotationY: 0, scaleX: 1, scaleY: 1 });
    return tl;
  }

  tl.set(pose, {
    x: 0,
    rotation: 0,
    rotationY: 0,
    scaleX: 1,
    scaleY: 1,
    transformPerspective: 480,
    transformOrigin: '50% 65%',
  });
  tl.to(pose, {
    rotationY: 90,
    scaleX: 0.08,
    scaleY: 1.06,
    y: -4,
    duration: 0.22,
    ease: 'power2.in',
  });
  tl.call(swap);
  tl.set(pose, { rotationY: -90 });
  tl.to(pose, {
    rotationY: 0,
    scaleX: 1,
    scaleY: 1,
    y: 0,
    duration: 0.34,
    ease: 'back.out(1.35)',
  });
  tl.set(pose, { rotationY: 0, transformPerspective: 0 });
  return tl;
}

export function resetPose(pose: HTMLElement): gsap.core.Timeline {
  gsap.killTweensOf(pose);
  return gsap.timeline().set(pose, {
    x: 0,
    y: 0,
    rotation: 0,
    rotationY: 0,
    scaleX: 1,
    scaleY: 1,
    transformPerspective: 0,
  });
}

export function fadeOut(visibility: HTMLElement): gsap.core.Timeline {
  gsap.killTweensOf(visibility);
  return gsap.timeline().to(visibility, {
    alpha: 0,
    duration: 0.35,
    ease: 'power2.in',
  });
}

export function hitAnim(
  action: HTMLElement,
  pose: HTMLElement,
  direction: 1 | -1 | 0 = 0,
): gsap.core.Timeline {
  gsap.killTweensOf(action);
  gsap.killTweensOf(pose);
  const dx = direction * 6;
  const tl = gsap.timeline();
  tl.to(pose, {
    scaleY: 0.7, scaleX: 1.15, rotation: direction * 8,
    duration: 0.1, ease: 'power2.in',
  }, 0);
  tl.to(action, { x: dx * 1.8, duration: 0.1, ease: 'power2.in' }, 0);
  tl.to(pose, {
    scaleY: 1.18, scaleX: 0.92, rotation: direction * -6,
    duration: 0.12, ease: 'power2.out',
  });
  tl.to(action, { x: dx * -0.6, duration: 0.12, ease: 'power2.out' }, 0.1);
  tl.to(pose, {
    scaleY: 1, scaleX: 1, rotation: 0,
    duration: 0.2, ease: 'elastic.out(1, 0.4)',
  });
  tl.to(action, { x: 0, y: 0, duration: 0.2, ease: 'elastic.out(1, 0.4)' }, 0.22);
  return tl;
}

export function attackAnim(
  action: HTMLElement,
  pose: HTMLElement,
  anchorPoint: { x: number; y: number },
  targetPoint?: { x: number; y: number },
  kind: AttackKind = 'melee',
): { timeline: gsap.core.Timeline; impactAt: number } {
  gsap.killTweensOf(action);
  gsap.killTweensOf(pose);
  const tl = gsap.timeline();
  if (kind === 'ranged') {
    tl.to(pose, { scaleY: 0.92, rotation: -5, duration: 0.1, ease: 'power1.in' });
    tl.to(pose, { scaleY: 1.08, rotation: 8, duration: 0.15, ease: 'power2.out' });
    tl.to(pose, { scaleY: 1, rotation: 0, duration: 0.05, ease: 'power2.inOut' });
    return { timeline: tl, impactAt: 250 };
  }

  let dx = 15;
  let dy = 0;
  if (targetPoint) {
    const distX = targetPoint.x - anchorPoint.x;
    const distY = targetPoint.y - anchorPoint.y;
    const dist = Math.sqrt(distX * distX + distY * distY);
    if (dist > 0) {
      dx = (distX / dist) * 15;
      dy = (distY / dist) * 15;
    }
  }
  tl.to(pose, { scaleY: 1.15, duration: 0.08, ease: 'power1.in' }, 0);
  tl.to(action, { x: -dx * 0.3, y: -dy * 0.3, duration: 0.08, ease: 'power1.in' }, 0);
  tl.to(pose, { scaleY: 0.95, duration: 0.12, ease: 'power2.out' }, 0.08);
  tl.to(action, { x: dx, y: dy, duration: 0.12, ease: 'power2.out' }, 0.08);
  tl.to(pose, { scaleY: 1, duration: 0.1, ease: 'power2.inOut' }, 0.2);
  tl.to(action, { x: 0, y: 0, duration: 0.1, ease: 'power2.inOut' }, 0.2);
  return { timeline: tl, impactAt: 200 };
}
