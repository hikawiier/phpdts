import gsap from 'gsap';
import type { ActorElements, AttackKind } from '@/types/actor-runtime';

const Z_STANDING = 10;

export function updateEntityZIndex(anchor: HTMLElement): void {
  const y = Number(gsap.getProperty(anchor, 'y')) || 0;
  anchor.style.zIndex = String(Z_STANDING + Math.round(y));
}

export function setDown(elements: ActorElements): void {
  gsap.killTweensOf(elements.pose);
  gsap.killTweensOf(elements.visibility);
  gsap.set(elements.pose, { x: 0, y: 0, scaleY: 0.04, scaleX: 1, rotation: -90 });
  gsap.set(elements.visibility, { alpha: 0 });
  updateEntityZIndex(elements.anchor);
}

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
): gsap.core.Timeline {
  gsap.killTweensOf(elements.anchor);
  gsap.killTweensOf(elements.pose);
  updateEntityZIndex(elements.anchor);
  const airTime = 0.5;
  const fromY = Number(gsap.getProperty(elements.anchor, 'y')) || 0;
  const peakY = Math.min(fromY, toY) - cellHeight * 0.6;
  const tl = gsap.timeline();
  tl.to(elements.anchor, { x: toX, duration: airTime, ease: 'power1.inOut' }, 0);
  tl.to(elements.anchor, {
    y: peakY, duration: airTime / 2, ease: 'power2.out',
    onUpdate: () => updateEntityZIndex(elements.anchor),
  }, 0);
  tl.to(elements.anchor, {
    y: toY, duration: airTime / 2, ease: 'power2.in',
    onUpdate: () => updateEntityZIndex(elements.anchor),
  }, airTime / 2);
  tl.to(elements.pose, { scaleY: 0.6, duration: 0.1, ease: 'power2.in' }, 0);
  tl.to(elements.pose, { scaleY: 1.2, duration: 0.15, ease: 'power2.out' }, 0.1);
  tl.to(elements.pose, { scaleY: 0.55, duration: 0.25, ease: 'sine.in' }, 0.25);
  tl.to(elements.pose, { scaleY: 1, duration: 0.9, ease: 'elastic.out(1, 0.35)' }, 0.5);
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
