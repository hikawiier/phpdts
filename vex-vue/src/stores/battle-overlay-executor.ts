// 战斗覆盖层动画执行器：创建投射物和爆炸等全局视觉效果
// 使用 Web Animations API 创建独立于地图实体的覆盖图层
import gsap from 'gsap';
import type { AnimationHandle, AnimationResult } from '@/types/actor-runtime';
import type { ViewportPoint } from '@/types/scene';

const DELIVERY_PROJECTILE_DURATION = 360;
const DELIVERY_EXPLOSION_DURATION = 420;
const UNARMED_HIT_IMAGE = '/img/temp/on_hit_4.png';

// 创建投射物飞行动画：从起点到终点的红色弹道覆盖层
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

// 创建爆炸动画：在指定位置产生扩散消散的红色圆形覆盖层
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

// 空手命中立绘：在受击者身体前方快速 popUp，并随 action scope 统一取消。
export function createUnarmedHitPopup(at: ViewportPoint): AnimationHandle {
  const img = document.createElement('img');
  img.src = UNARMED_HIT_IMAGE;
  img.alt = '';
  img.setAttribute('aria-hidden', 'true');
  Object.assign(img.style, {
    position: 'fixed',
    left: `${at.x}px`,
    top: `${at.y - 8}px`,
    width: '76px',
    height: '67px',
    objectFit: 'contain',
    pointerEvents: 'none',
    zIndex: '521',
    opacity: '0',
    transformOrigin: '50% 78%',
  });
  document.body.appendChild(img);

  let timeline: gsap.core.Timeline | null = null;
  let settled = false;
  let resolveFinished!: (result: AnimationResult) => void;
  const finished = new Promise<AnimationResult>(resolve => { resolveFinished = resolve; });
  const settle = (result: AnimationResult) => {
    if (settled) return;
    settled = true;
    timeline?.kill();
    img.remove();
    resolveFinished(result);
  };
  const start = () => {
    if (settled) return;
    timeline = gsap.timeline({ onComplete: () => settle({ status: 'completed' }) });
    timeline.set(img, { xPercent: -50, yPercent: -82, scale: 0.28, rotation: -4, opacity: 0 });
    timeline.to(img, { scale: 1.08, rotation: 2, opacity: 1, duration: 0.07, ease: 'power3.out' });
    timeline.to(img, { scale: 1, rotation: 0, duration: 0.08, ease: 'back.out(2)' });
    timeline.to(img, { scale: 0.94, yPercent: -92, opacity: 0, duration: 0.12, ease: 'power2.in' });
  };

  const ready = img.complete && img.naturalWidth > 0
    ? Promise.resolve()
    : img.decode().catch(() => undefined);
  void ready.then(start);

  return {
    finished,
    cancel(reason = 'cancelled') {
      if (settled) return;
      settle({ status: 'cancelled', reason });
    },
  };
}

// 将 Web Animation 对象包装为统一的 AnimationHandle 接口
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
