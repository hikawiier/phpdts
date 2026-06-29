// ══════════════════════════════════════════════════
// useActors composable
//
// 多角色动画层：管理所有 actor 的 DOM 引用、位置同步、GSAP 动画。
// 替代 usePlayerAvatar，从单 actor 扩展为多 actor 架构。
//
// 三层职责：
//   - 位置同步（syncActorPosition）：用 offsetLeft/offsetTop 累加计算 cell 偏移，
//     同时设 actor width/height 等于 cell 尺寸，让 .actor-img 的 height:150% 生效
//   - z-index 切换：popUp 回弹 onStart 加 .popped（浮出），fall onComplete 移除（被遮挡）
//   - GSAP 动画：resetTransform/setDown/startIdle/popUp/fall，参数沿用 usePlayerAvatar
//
// 关键设计：
//   - resetTransform/setDown 不动 x/y/xPercent/yPercent/width/height（位置由 syncActorPosition 管）
//   - 角色投影由 .actor-img 的 CSS filter: drop-shadow 提供，跟随立绘形状，无需独立阴影元素
//   - notifyUp 挂在回弹 tween 的 onComplete（非 timeline.onComplete，因末尾 idle repeat:-1）
//
// 触发位置同步的三路 watch：
//   - watch(gridRef) → ResizeObserver（缩放/resize）
//   - watch(curLoc) → 移动后同步 + 触发 onMove 意图
//   - watch(actors) → 初始挂载/区域切换
// ══════════════════════════════════════════════════

import { watch, nextTick, type Ref } from 'vue';
import gsap from 'gsap';
import { usePlayerAvatarStore } from '@/stores/player-avatar';
import { useActorsStore } from '@/stores/actors';
import { useMapStore } from '@/stores/map';
import type { PlayerAvatarIntent } from '@/types/player-avatar';

export function useActors(gridRef: Ref<HTMLElement | null>) {
  const playerAvatarStore = usePlayerAvatarStore();
  const actorsStore = useActorsStore();
  const mapStore = useMapStore();

  // ── actor DOM 引用（id → HTMLElement） ──
  const actorRefs = new Map<string, HTMLElement>();
  function setActorRef(id: string, el: HTMLElement | null): void {
    if (el) actorRefs.set(id, el);
    else actorRefs.delete(id);
  }

  // ── 位置同步（§4.1） ──
  // 算法与 centerOnPlayer 一致：offsetLeft/offsetTop 累加计算 cell 相对 grid 偏移
  // 关键：同时设 actor width/height 等于 cell 尺寸，让 .actor-img 的 height:150% 生效
  function syncActorPosition(actorEl: HTMLElement, pls: string | number, gridEl: HTMLElement): boolean {
    const cell = gridEl.querySelector(`[data-pls="${pls}"]`) as HTMLElement | null;
    if (!cell) return false;

    // 累加 offsetLeft/offsetTop 直到 gridEl
    let offsetX = 0;
    let offsetY = 0;
    let el: HTMLElement | null = cell;
    while (el && el !== gridEl) {
      offsetX += el.offsetLeft;
      offsetY += el.offsetTop;
      el = el.offsetParent as HTMLElement | null;
    }

    // actor 定位到 cell 底部居中，尺寸等于 cell
    // x/y 是 actor 原点（左上角）的目标位置
    // xPercent:-50 yPercent:-100 让 actor 中心底部对准 (offsetX + cellW/2, offsetY + cellH)
    gsap.set(actorEl, {
      width: cell.offsetWidth,
      height: cell.offsetHeight,
      x: offsetX + cell.offsetWidth / 2,
      y: offsetY + cell.offsetHeight,
      xPercent: -50,
      yPercent: -100,
    });

    return true;
  }

  // ── 同步所有 actor（§4.3） ──
  function syncAllPositions(): void {
    const grid = gridRef.value;
    if (!grid) return;
    for (const actor of actorsStore.actors) {
      const el = actorRefs.get(actor.id);
      if (el) syncActorPosition(el, actor.pls, grid);
    }
  }

  // ── GSAP 基础函数 ──
  // 关键：resetTransform/setDown 不设 x/y/xPercent/yPercent/width/height
  //        位置由 syncActorPosition 管理，动画函数只动 scale/rotation/alpha

  function resetTransform(el: HTMLElement): void {
    gsap.set(el, {
      scaleY: 1,
      scaleX: 1,
      rotation: 0,
      alpha: 1,
    });
  }

  function setDown(el: HTMLElement): void {
    gsap.killTweensOf(el);
    gsap.set(el, {
      scaleY: 0.04,
      scaleX: 1,
      rotation: -90,
      alpha: 0.25,
    });
    el.classList.remove('popped');
  }

  function startIdle(el: HTMLElement): void {
    gsap.killTweensOf(el);
    gsap.to(el, {
      scaleY: 1.02,
      scaleX: 0.99,
      duration: 0.6,
      ease: 'sine.inOut',
      yoyo: true,
      repeat: -1,
    });
  }

  // notifyUp 挂在回弹 tween（第三个）的 onComplete 上
  // timeline 末尾是 repeat:-1 的 idle 循环，timeline 永不完成
  function popUp(el: HTMLElement): void {
    gsap.killTweensOf(el);
    const tl = gsap.timeline();
    tl.to(el, { alpha: 1, duration: 0.08, ease: 'none' });
    tl.to(el, {
      scaleY: 0.02, scaleX: 1.05, rotation: -95,
      duration: 0.12, ease: 'power1.in',
    });
    tl.to(el, {
      scaleY: 1, scaleX: 1, rotation: 0,
      duration: 0.9, ease: 'elastic.out(1, 0.55)',
      onStart: () => el.classList.add('popped'),
      onComplete: () => playerAvatarStore.notifyUp(),
    });
    tl.to(el, {
      scaleY: 1.02, scaleX: 0.99,
      duration: 0.6, ease: 'sine.inOut',
      yoyo: true, repeat: -1,
    });
  }

  // fall 末尾无 repeat，timeline 能正常完成，notifyDown 挂在 timeline.onComplete
  function fall(el: HTMLElement): void {
    gsap.killTweensOf(el);
    const tl = gsap.timeline({
      onComplete: () => {
        el.classList.remove('popped');
        playerAvatarStore.notifyDown();
      },
    });
    tl.to(el, {
      rotation: -22, scaleY: 1.05, scaleX: 0.96,
      duration: 0.1, ease: 'power1.out',
    });
    tl.to(el, {
      rotation: -90, scaleY: 0.04, scaleX: 1,
      alpha: 0.25,  // 倒下后保持 0.25 透明（被 .map-background 遮挡不可见）
      duration: 0.32, ease: 'power2.in',
    });
  }

  // ── 意图 → 动画映射（玩家专用，未来扩展按 kind 分发） ──
  const INTENT_HANDLERS: Record<PlayerAvatarIntent, (el: HTMLElement) => void> = {
    'enter':        (el) => { setDown(el); popUp(el); },
    'move':         (el) => { resetTransform(el); startIdle(el); },
    'battle-start': (el) => { startIdle(el); },
    'battle-end':   (el) => { startIdle(el); },
    'hit':          (el) => { startIdle(el); },
    'die':          (el) => { fall(el); },
    'low-hp':       (el) => { startIdle(el); },
    'normal-hp':    (el) => { startIdle(el); },
    'popup':        (el) => { setDown(el); popUp(el); },
    'fall':         (el) => { fall(el); },
    'idle':         (el) => { startIdle(el); },
  };

  // ── watch 玩家意图派发动画 ──
  // watch intentSeq 而非 intent：连续移动（intent 都是 'move'）时 intentSeq 递增确保每次都触发
  const stopIntentWatch = watch(
    () => playerAvatarStore.intentSeq,
    () => {
      nextTick(() => {
        const el = actorRefs.get('player');
        if (!el) return;
        const handler = INTENT_HANDLERS[playerAvatarStore.intent];
        if (handler) handler(el);
      });
    },
  );

  // ── 位置同步触发（§4.2） ──

  // ResizeObserver：监听 grid 尺寸变化（缩放/resize）
  // 用 watch(gridRef) 而非 watchEffect，避免重复创建 observer 不 disconnect
  let resizeObserver: ResizeObserver | null = null;
  const stopGridWatch = watch(gridRef, (grid) => {
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
    if (!grid) return;
    // v3：去掉 nextTick，ResizeObserver 回调本身在 DOM 已更新后触发
    resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => syncAllPositions());
    });
    resizeObserver.observe(grid);
  });

  // 移动触发：同步位置 + 触发 onMove 意图
  const stopCurLocWatch = watch(
    () => mapStore.curLoc,
    () => {
      nextTick(() => requestAnimationFrame(() => {
        syncAllPositions();              // 先同步位置
        playerAvatarStore.onMove();      // 再触发 move 意图（intentSeq 递增 → move handler）
      }));
    },
  );

  // actor 列表变化触发：初始挂载 / 区域切换
  const stopActorsWatch = watch(
    () => actorsStore.actors,
    () => {
      nextTick(() => requestAnimationFrame(() => syncAllPositions()));
    },
  );

  function dispose(): void {
    stopIntentWatch();
    stopGridWatch();
    stopCurLocWatch();
    stopActorsWatch();
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
    for (const el of actorRefs.values()) {
      gsap.killTweensOf(el);
    }
    actorRefs.clear();
  }

  return {
    setActorRef,
    syncAllPositions,
    dispose,
  };
}
