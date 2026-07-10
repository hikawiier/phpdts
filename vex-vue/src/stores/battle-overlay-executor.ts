import type { AnimationHandle, AnimationResult } from '@/types/actor-runtime';
import type { ViewportPoint } from '@/types/scene';

const DELIVERY_PROJECTILE_DURATION = 360;
const DELIVERY_EXPLOSION_DURATION = 420;

export function createProjectileOverlay(from: ViewportPoint, to: ViewportPoint): AnimationHandle {
  const el = document.createElement('div');
  el.setAttribute('aria-hidden', 'true');
  Object.assign(el.style, {
    position: 'fixed', left: `${from.x}px`, top: `${from.y}px`, width: '6px', height: '6px',
    border: '1px solid #fff', background: '#ff6b6b', boxShadow: '0 0 8px rgba(255,107,107,.9)',
    pointerEvents: 'none', zIndex: '520',
  });
  document.body.appendChild(el);
  const animation = el.animate([
    { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 },
    { transform: `translate(${to.x - from.x}px, ${to.y - from.y}px) translate(-50%, -50%) scale(.7)`, opacity: 1 },
  ], { duration: DELIVERY_PROJECTILE_DURATION, easing: 'ease-in' });
  return nativeAnimationHandle(animation, el);
}

export function createExplosionOverlay(at: ViewportPoint): AnimationHandle {
  const el = document.createElement('div');
  el.setAttribute('aria-hidden', 'true');
  Object.assign(el.style, {
    position: 'fixed', left: `${at.x}px`, top: `${at.y}px`, width: '18px', height: '18px',
    border: '2px solid #ff6b6b', background: 'rgba(255,107,107,.18)', pointerEvents: 'none',
    zIndex: '519', transform: 'translate(-50%, -50%)',
  });
  document.body.appendChild(el);
  const animation = el.animate([
    { transform: 'translate(-50%, -50%) scale(.25)', opacity: 1 },
    { transform: 'translate(-50%, -50%) scale(2.8)', opacity: 0 },
  ], { duration: DELIVERY_EXPLOSION_DURATION, easing: 'ease-out' });
  return nativeAnimationHandle(animation, el);
}

function nativeAnimationHandle(animation: Animation, el: HTMLElement): AnimationHandle {
  let settled = false;
  let resolveFinished!: (result: AnimationResult) => void;
  const finished = new Promise<AnimationResult>(resolve => { resolveFinished = resolve; });
  const settle = (result: AnimationResult) => {
    if (settled) return;
    settled = true;
    el.remove();
    resolveFinished(result);
  };
  void animation.finished.then(
    () => settle({ status: 'completed' }),
    () => settle({ status: 'cancelled', reason: 'native_animation_cancelled' }),
  );
  return {
    finished,
    cancel(reason = 'cancelled') {
      if (settled) return;
      animation.cancel();
      settle({ status: 'cancelled', reason });
    },
  };
}
