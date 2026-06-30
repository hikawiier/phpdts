// ══════════════════════════════════════════════════
// useMapEntities composable
//
// 多实体动画层：管理所有地图实体的 DOM 引用、位置同步、z-index 更新、GSAP 动画。
// 替代 useActors，泛化支持 actor/poi/grass/crevice/worm 等多实体类型。
//
// 三层职责：
//   - 位置同步（syncEntityPosition）：用 offsetLeft/offsetTop 累加计算 cell 偏移，
//     同时设实体 width/height 等于 cell 尺寸 × 跨度，让 .entity-img 的 height 生效
//   - z-index 更新（updateEntityZIndex）：固定 Z_STANDING
//     阶段 1：硬编码 10（立绘始终浮出 cells 之上）
//     阶段 2：改用 computeZIndex 动态计算（Y 排序）
//   - GSAP 动画（仅 actor）：resetTransform/setDown/startIdle/popUp/fall
//
// 关键设计：
//   - 可见性由 alpha 控制（倒下 alpha:0 不可见，站立 alpha:1 可见），不再切换 z-index
//   - resetTransform/setDown 不动 x/y/xPercent/yPercent/width/height（位置由 syncEntityPosition 管）
//   - 角色投影由 .entity-img 的 CSS filter: drop-shadow 提供，无需独立阴影元素
//   - notifyUp 挂在回弹 tween 的 onComplete（非 timeline.onComplete，因末尾 idle repeat:-1）
//   - z-index 固定 10，由 JS 通过 el.style.zIndex 设置
//
// 触发的四路 watch（沿用 useActors 设计）：
//   - watch(gridRef) → ResizeObserver（缩放/resize）
//   - watch(curLoc) → 移动后同步 + 触发 onMove 意图
//   - watch(entities) → 初始挂载/区域切换
//   - watch(intentSeq) → 意图派发动画
// ══════════════════════════════════════════════════

import { watch, nextTick, type Ref } from 'vue';
import gsap from 'gsap';
import { usePlayerAvatarStore } from '@/stores/player-avatar';
import { useEntitiesStore } from '@/stores/entities';
import { useMapStore } from '@/stores/map';
import type { MapEntity } from '@/types/map-entity';
import type { PlayerAvatarIntent } from '@/types/player-avatar';

// ── z-index 常量（阶段 1：固定值） ──
// 可见性由 alpha 控制，z-index 固定不变，避免切换时序导致的遮挡失效
// 阶段 2 将改为 Y_SORT_BASE + yZ * Y_SORT_STRIDE + TIEBREAKER
const Z_STANDING = 10;  // 立绘始终浮出 cells 之上，倒下时 alpha:0 不可见

export function useMapEntities(gridRef: Ref<HTMLElement | null>) {
  const playerAvatarStore = usePlayerAvatarStore();
  const entitiesStore = useEntitiesStore();
  const mapStore = useMapStore();

  // ── 实体 DOM 引用（id → HTMLElement） ──
  const entityRefs = new Map<string, HTMLElement>();
  function setEntityRef(id: string, el: HTMLElement | null): void {
    if (el) entityRefs.set(id, el);
    else entityRefs.delete(id);
  }

  // ── 移动动画标志（moveActor 期间为 true，syncEntityPosition 跳过玩家） ──
  let isMoving = false;

  // ── z-index 更新（阶段 1：固定 Z_STANDING） ──
  // 可见性由 alpha 控制（倒下 alpha:0），z-index 不再切换
  // 阶段 2 将基于 entity 的 y 坐标动态计算（Y 排序）
  function updateEntityZIndex(el: HTMLElement): void {
    el.style.zIndex = String(Z_STANDING);
  }

  // ── 位置同步（仅位置/尺寸） ──
  // 算法与 centerOnPlayer 一致：offsetLeft/offsetTop 累加计算 cell 相对 grid 偏移
  // 关键：同时设实体 width/height 等于 cell 尺寸 × 跨度，让 .entity-img 的 height 生效
  function syncEntityPosition(entityEl: HTMLElement, entity: MapEntity, gridEl: HTMLElement): boolean {
    // 玩家正在移动动画期间跳过（避免 ResizeObserver 打断 moveActor）
    if (entity.id === 'player' && isMoving) return false;
    const cell = gridEl.querySelector(`[data-pls="${entity.pls}"]`) as HTMLElement | null;
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

    const cellW = cell.offsetWidth;
    const cellH = cell.offsetHeight;
    const spanCols = entity.spanCols ?? 1;
    const spanRows = entity.spanRows ?? 1;

    // 实体定位到锚点格底部居中，尺寸 = cell 尺寸 × 跨度
    // x/y 是实体原点（左上角）的目标位置
    // xPercent:-50 yPercent:-100 让实体中心底部对准 (offsetX + cellW*spanCols/2, offsetY + cellH*spanRows)
    gsap.set(entityEl, {
      width: cellW * spanCols,
      height: cellH * spanRows,
      x: offsetX + cellW * spanCols / 2,
      y: offsetY + cellH * spanRows,
      xPercent: -50,
      yPercent: -100,
    });

    // 位置同步后立即更新 z-index
    updateEntityZIndex(entityEl);

    return true;
  }

  // ── 同步所有实体 ──
  function syncAllPositions(): void {
    const grid = gridRef.value;
    if (!grid) return;
    for (const entity of entitiesStore.entities) {
      const el = entityRefs.get(entity.id);
      if (el) syncEntityPosition(el, entity, grid);
    }
  }

  // ── GSAP 基础函数 ──
  // 关键：resetTransform/setDown 不设 x/y/xPercent/yPercent/width/height
  //        位置由 syncEntityPosition 管理，动画函数只动 scale/rotation/alpha

  function setDown(el: HTMLElement): void {
    gsap.killTweensOf(el);
    gsap.set(el, {
      scaleY: 0.04,
      scaleX: 1,
      rotation: -90,
      alpha: 0,  // 完全透明（替代 z-index:-1 被地面遮挡）
    });
    el.style.zIndex = String(Z_STANDING);
  }

  function startIdle(el: HTMLElement): void {
    gsap.killTweensOf(el);
    // 重置 scale/rotation 到中性值：上一步动画（移动摇摆/脚步压缩/倒下）可能让
    // scaleY/scaleX 停在与 idle 目标值（1.02/0.99）重合的位置，导致 yoyo 无振幅看似静态
    gsap.set(el, { scaleY: 1, scaleX: 1, rotation: 0 });
    gsap.to(el, {
      scaleY: 1.02,
      scaleX: 0.99,
      duration: 0.6,
      ease: 'sine.inOut',
      yoyo: true,
      repeat: -1,
    });
  }

  // notifyUp 挂在回弹 tween（第二个）的 onComplete 上
  // timeline 末尾是 repeat:-1 的 idle 循环，timeline 永不完成
  function popUp(el: HTMLElement): void {
    gsap.killTweensOf(el);
    const tl = gsap.timeline();
    // setDown 已 alpha:0，压扁阶段保持透明（不可见）
    tl.to(el, {
      scaleY: 0.02, scaleX: 1.05, rotation: -95,
      duration: 0.12, ease: 'power1.in',
    });
    // 弹起时渐显（alpha 0→1），替代原 z-index 切换
    tl.to(el, {
      scaleY: 1, scaleX: 1, rotation: 0,
      alpha: 1,
      duration: 0.9, ease: 'elastic.out(1, 0.55)',
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
        playerAvatarStore.notifyDown();
      },
    });
    tl.to(el, {
      rotation: -22, scaleY: 1.05, scaleX: 0.96,
      duration: 0.1, ease: 'power1.out',
    });
    tl.to(el, {
      rotation: -90, scaleY: 0.04, scaleX: 1,
      alpha: 0,  // 倒下后完全透明（替代 z-index:-1 被地面遮挡）
      duration: 0.32, ease: 'power2.in',
    });
  }

  // ── 移动动画（鸭子步摇摆）──
  // 位置插值 + 左右摇摆 + 脚步压缩，模拟行走
  // direction: 1 右移（先摆右 +）/ -1 左移（先摆左 −）/ 0 垂直移动（默认先摆右）
  // 摇摆模拟"走路时身体左右晃"，与移动方向无关，垂直移动也摇摆
  // fromX/fromY 无需传入：gsap.to 自动从当前 transform 值插值
  function moveActor(
    el: HTMLElement,
    toX: number, toY: number,
    direction: 1 | -1 | 0,
    onComplete: () => void,
  ): void {
    gsap.killTweensOf(el);
    el.style.zIndex = String(Z_STANDING);

    const duration = 0.5;
    const swayAmp = 12;
    const swayCycles = 2;
    const swaySegments = swayCycles * 4;  // 每周期 4 段（正→反→正→反）
    const swayDir = direction === 0 ? 1 : direction;  // 垂直移动默认先摆右

    const tl = gsap.timeline({ onComplete });

    // 1. 位置插值（旧格 → 新格）
    tl.to(el, {
      x: toX, y: toY,
      duration,
      ease: 'power1.inOut',
    }, 0);

    // 2. 左右摇摆（方向感知）
    tl.to(el, {
      rotation: swayDir * swayAmp,
      duration: duration / swaySegments,
      ease: 'sine.inOut',
      yoyo: true,
      repeat: swaySegments - 1,
    }, 0);

    // 3. 脚步压缩（模拟着地，与摇摆同频）
    tl.to(el, {
      scaleY: 0.97,
      duration: duration / (swayCycles * 2),
      ease: 'sine.inOut',
      yoyo: true,
      repeat: swayCycles * 2 - 1,
    }, 0);
  }

  // ── 移动动画（棋子跳跃）──
  // x 全程平移 + y 抛物线弧线 + scaleY 弹性形变，模拟跳跃
  // 无摇摆，方向体现在 x 平移向量上
  // peakY 取 min(fromY, toY) - jumpHeight，确保垂直/斜向移动时也"向上跳"
  //   屏幕坐标 y 向下为正，"向上跳"= y 减小，峰值比起点和终点都小
  function jumpActor(
    el: HTMLElement,
    toX: number, toY: number,
    cellH: number,
    onComplete: () => void,
  ): void {
    gsap.killTweensOf(el);
    el.style.zIndex = String(Z_STANDING);

    const duration = 0.5;
    const jumpHeight = cellH * 0.6;
    const half = duration / 2;

    const fromY = gsap.getProperty(el, 'y') as number;
    const peakY = Math.min(fromY, toY) - jumpHeight;

    const tl = gsap.timeline({ onComplete });

    // 1. x 全程平移
    tl.to(el, { x: toX, duration, ease: 'power1.inOut' }, 0);

    // 2. y 抛物线：跳起（y 减小到 peakY）→ 落下（y 增大到 toY）
    tl.to(el, { y: peakY, duration: half, ease: 'power2.out' }, 0);
    tl.to(el, { y: toY, duration: half, ease: 'power2.in' }, half);

    // 3. scaleY 弹性形变（四段无缝衔接，避免中间停在 1.1）
    tl.to(el, { scaleY: 0.9,  duration: 0.08, ease: 'power2.in'  }, 0);     // 蓄力压缩
    tl.to(el, { scaleY: 1.1,  duration: 0.15, ease: 'power2.out' }, 0.08);  // 弹起拉伸
    tl.to(el, { scaleY: 1.0,  duration: 0.17, ease: 'sine.inOut' }, 0.23);  // 空中渐回
    tl.to(el, { scaleY: 0.95, duration: 0.10, ease: 'power2.in'  }, 0.40);  // 落地压缩
  }

  // ── 到达弹起动画（跨区域切换专用）──
  // 淡入 + back.out 弹性放大，无倒下阶段
  // 与 popUp 的区别：不 setDown 倒下，直接从透明缩小状态弹起出现，语义是"到达"而非"从地面爬起"
  function arriveAnim(el: HTMLElement): void {
    gsap.killTweensOf(el);
    el.style.zIndex = String(Z_STANDING);
    gsap.set(el, { alpha: 0, scaleY: 0.3, scaleX: 0.3, rotation: 0 });
    const tl = gsap.timeline();
    tl.to(el, { alpha: 1, scaleY: 1, scaleX: 1, duration: 0.4, ease: 'back.out(1.7)' });
    tl.to(el, { scaleY: 1.02, scaleX: 0.99, duration: 0.6, ease: 'sine.inOut', yoyo: true, repeat: -1 });
  }

  // ── 意图 → 动画映射（玩家专用，未来扩展按 kind 分发） ──
  const INTENT_HANDLERS: Record<PlayerAvatarIntent, (el: HTMLElement) => void> = {
    'enter':        (el) => { setDown(el); popUp(el); },
    'move':         (el) => { startIdle(el); },
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
        const el = entityRefs.get('player');
        if (!el) return;
        const handler = INTENT_HANDLERS[playerAvatarStore.intent];
        if (handler) handler(el);
      });
    },
  );

  // ── 位置同步触发 ──

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

  // 移动触发：三级分级动画（鸭子步 / 棋子跳跃 / 弹出）
  // 同时监听 curLoc 和 curRegion：curLoc 变化触发移动动画，curRegion 变化强制走弹出
  const stopCurLocWatch = watch(
    () => [mapStore.curLoc, mapStore.curRegion] as const,
    ([newLoc, newRegion], [oldLoc, oldRegion]) => {
      // 首次加载（curLoc null → 值）：让 onEnter 接管 popUp，跳过分级动画
      if (oldLoc === null) return;
      // curLoc 未变化（仅 curRegion 变化等）：不处理移动
      if (newLoc === oldLoc) return;

      const isRegionChange = newRegion !== oldRegion;

      nextTick(() => requestAnimationFrame(() => {
        const grid = gridRef.value;
        const el = entityRefs.get('player');

        // 降级：倒下 / 无引用 → 走原 syncAllPositions + onMove（pendingIntent popUp）
        if (!grid || !el || playerAvatarStore.isDown) {
          syncAllPositions();
          playerAvatarStore.onMove();
          return;
        }

        // 区域切换：到达弹起动画（淡入弹起，无倒下阶段）
        // 跨区域加载很快，倒下动画无法完整播放；arriveAnim 直接从透明缩小状态弹起出现
        if (isRegionChange) {
          isMoving = false;
          syncAllPositions();
          arriveAnim(el);
          return;
        }

        // 读取旧位置（gsap transform 当前值，此时 syncAllPositions 未执行）
        const fromX = gsap.getProperty(el, 'x') as number;
        const fromY = gsap.getProperty(el, 'y') as number;

        // 计算新格位置
        const cell = grid.querySelector(`[data-pls="${newLoc}"]`) as HTMLElement | null;
        if (!cell) { syncAllPositions(); playerAvatarStore.onMove(); return; }

        let offsetX = 0, offsetY = 0;
        let node: HTMLElement | null = cell;
        while (node && node !== grid) {
          offsetX += node.offsetLeft;
          offsetY += node.offsetTop;
          node = node.offsetParent as HTMLElement | null;
        }
        const cellW = cell.offsetWidth;
        const cellH = cell.offsetHeight;
        const toX = offsetX + cellW / 2;
        const toY = offsetY + cellH;

        // 格距（切比雪夫距离）
        const gridDist = Math.max(Math.abs(toX - fromX) / cellW, Math.abs(toY - fromY) / cellH);

        // 设实体尺寸（与 syncEntityPosition 一致，确保 width/height 正确）
        gsap.set(el, { width: cellW, height: cellH });

        isMoving = true;
        const done = () => {
          isMoving = false;
          updateEntityZIndex(el);
          startIdle(el);
        };

        if (gridDist <= 2.5) {
          // 鸭子步（1-2 格）
          const direction: 1 | -1 | 0 = toX > fromX ? 1 : toX < fromX ? -1 : 0;
          moveActor(el, toX, toY, direction, done);
        } else if (gridDist <= 6.5) {
          // 棋子跳跃（3-6 格）
          jumpActor(el, toX, toY, cellH, done);
        } else {
          // 弹出（长距离）：瞬间定位 + onEnter 强调到达
          isMoving = false;  // popUp 不需要 isMoving 保护
          syncAllPositions();
          playerAvatarStore.onEnter();
        }
      }));
    },
  );

  // ── 首次入场触发（player el 可用后播 popUp）──
  // 解决异步加载场景：onMounted 调 onEnter 时 player entity 还没渲染，
  // intent watch 取不到 el 静默跳过。改由 entities watch 检测 player el 可用后触发。
  let firstEnterDone = false;
  function tryFirstEnter(): void {
    if (firstEnterDone) return;
    if (!entityRefs.has('player')) return;
    firstEnterDone = true;
    playerAvatarStore.onEnter();
  }

  // 实体列表变化触发：初始挂载 / 区域切换 / 首次入场
  const stopEntitiesWatch = watch(
    () => entitiesStore.entities,
    (entities) => {
      // player 消失（reset/退出游戏）时重置首次入场标志，支持再次加载时重新播 popUp
      if (!entities.some(e => e.id === 'player')) {
        firstEnterDone = false;
      }
      nextTick(() => requestAnimationFrame(() => {
        syncAllPositions();
        tryFirstEnter();
      }));
    },
    { immediate: true },  // 预加载场景（mount 前 entities 已有 player）立即触发首次入场
  );

  function dispose(): void {
    stopIntentWatch();
    stopGridWatch();
    stopCurLocWatch();
    stopEntitiesWatch();
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
    for (const el of entityRefs.values()) {
      gsap.killTweensOf(el);
    }
    entityRefs.clear();
  }

  return {
    setEntityRef,
    syncAllPositions,
    dispose,
  };
}
