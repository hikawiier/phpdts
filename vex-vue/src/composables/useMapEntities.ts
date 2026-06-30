// ══════════════════════════════════════════════════
// useMapEntities composable — 注册中心 + 调度层
//
// 改造自原 useMapEntities（515 行三层职责混合），现为"注册中心 + 调度层"：
//   - 动画函数已提取到 @/animations/actorAnimations.ts（纯函数，不依赖 store）
//   - 每 actor 竞态保护（isMoving/animToken）已提取到 @/composables/useActorAnimation.ts
//   - 本文件只负责：实体 DOM 引用管理 + 4 路 watch 调度 + 位置同步
//
// 三层架构：
//   数据层（stores）→ 调度层（本文件 watch）→ 演员层（useActorAnimation + actorAnimations）
//
// 4 路 watch：
//   - watch(gridRef)    → ResizeObserver（缩放/resize）→ syncAllPositions
//   - watch(curLoc)     → player 移动：预锁定 → rAF 内分级（long→onEnter / 短中→moveTo）
//   - watch(entities)   → 敌人位置变化（同步阶段预锁定）+ 首次入场
//   - watch(intentSeq)  → player intent 派发（enter/idle/playFall）
//
// 关键设计：
//   - actors: Map<id, ActorAnimation> 注册中心，每 actor 独立竞态保护
//   - syncEntityPosition 通用化：跳过任何 isMoving 的 actor（不再硬编码 player）
//   - setEntityRef 调 actor.setEl(el) 命令式注入（普通 Map 无响应式，computed 方案失效）
//   - 敌人 pls 变化在 entities watch 同步阶段预 lockMove()，防止 rAF 内 syncAllPositions 瞬移
//   - player 长距离移动走 onEnter intent（保证 notifyUp），敌人长距离走 actor.enter()
//   - 可见性由 alpha 控制（倒下 alpha:0，站立 alpha:1），z-index 固定 Z_STANDING+Math.round(y)
// ══════════════════════════════════════════════════

import { watch, nextTick, shallowRef, type Ref } from 'vue';
import gsap from 'gsap';
import { usePlayerAvatarStore } from '@/stores/player-avatar';
import { useEntitiesStore } from '@/stores/entities';
import { useMapStore } from '@/stores/map';
import { updateEntityZIndex } from '@/animations/actorAnimations';
import { useActorAnimation } from '@/composables/useActorAnimation';
import type { ActorAnimation, MoveTier } from '@/types/actor-animation';
import type { MapEntity } from '@/types/map-entity';

/** 移动分级阈值（与原 useMapEntities 一致） */
const DUCK_MAX_GRID = 1.5;   // ≤1.5 格：鸭子步
const JUMP_MAX_GRID = 6.5;   // ≤6.5 格：跳跃

/**
 * 计算 cell 锚点位置（供 syncEntityPosition 和移动动画复用）
 * 返回 cell 底部居中的坐标 + cell 尺寸
 */
function getCellAnchor(gridEl: HTMLElement, pls: string | number): {
  x: number; y: number; cellW: number; cellH: number;
} | null {
  const cell = gridEl.querySelector(`[data-pls="${pls}"]`) as HTMLElement | null;
  if (!cell) return null;
  let offsetX = 0, offsetY = 0;
  let node: HTMLElement | null = cell;
  while (node && node !== gridEl) {
    offsetX += node.offsetLeft;
    offsetY += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  const cellW = cell.offsetWidth;
  const cellH = cell.offsetHeight;
  // 锚点：cell 底部居中（span=1 场景）
  return { x: offsetX + cellW / 2, y: offsetY + cellH, cellW, cellH };
}

/** 计算移动分级（供调用方判断，moveTo 不决策长距离） */
function calcMoveTier(
  fromX: number, fromY: number,
  toX: number, toY: number,
  cellW: number, cellH: number,
): MoveTier {
  const gridDist = Math.max(Math.abs(toX - fromX) / cellW, Math.abs(toY - fromY) / cellH);
  if (gridDist <= DUCK_MAX_GRID) return 'duck';
  if (gridDist <= JUMP_MAX_GRID) return 'jump';
  return 'long';
}

export function useMapEntities(gridRef: Ref<HTMLElement | null>) {
  const playerAvatarStore = usePlayerAvatarStore();
  const entitiesStore = useEntitiesStore();
  const mapStore = useMapStore();

  // ── 实体 DOM 引用（id → HTMLElement） ──
  const entityRefs = new Map<string, HTMLElement>();
  // ── actor 动画控制器注册中心（id → ActorAnimation） ──
  const actors = new Map<string, ActorAnimation>();
  // ── 敌人上次位置（检测敌人移动）──
  const enemyLastPls = new Map<string, string | number>();
  // ── 已入场记录（避免重复播 enter）──
  const enteredEntities = new Set<string>();
  // ── 正在淡出的实体 id（displayEntities 中间层，延迟移除直到动画完成）──
  const fadingOutIds = new Set<string>();
  // ── 实际渲染的实体列表（entities + 正在淡出的实体）──
  const displayEntities = shallowRef<MapEntity[]>([]);

  function setEntityRef(id: string, el: HTMLElement | null): void {
    if (el) {
      entityRefs.set(id, el);
      // actor 创建控制器并命令式注入 el
      if (!actors.has(id)) {
        actors.set(id, useActorAnimation());
      }
      actors.get(id)!.setEl(el);
    } else {
      entityRefs.delete(id);
      actors.delete(id);  // killAll 在 dispose 统一处理，这里仅移除引用
      enemyLastPls.delete(id);
      enteredEntities.delete(id);
    }
  }

  // ── 位置同步（通用化：跳过任何 isMoving 的 actor）──
  // 算法与 centerOnPlayer 一致：offsetLeft/offsetTop 累加计算 cell 相对 grid 偏移
  // 同时设实体 width/height 等于 cell 尺寸 × 跨度，让 .entity-img 的 height 生效
  function syncEntityPosition(entityEl: HTMLElement, entity: MapEntity, gridEl: HTMLElement): boolean {
    const actor = actors.get(entity.id);
    if (actor?.isMoving) return false;  // 通用化，不再只跳 player

    const anchor = getCellAnchor(gridEl, entity.pls);
    if (!anchor) return false;
    const { x: targetX, y: targetY, cellW, cellH } = anchor;
    const spanCols = entity.spanCols ?? 1;
    const spanRows = entity.spanRows ?? 1;

    // 实体定位到锚点格底部居中，尺寸 = cell 尺寸 × 跨度
    // x/y 是实体原点（左上角）的目标位置
    // xPercent:-50 yPercent:-100 让实体中心底部对准 (targetX, targetY)
    // 注：spanCols>1 时 targetX 需为 offsetX + cellW*spanCols/2，当前 span=1 用 anchor.x 即可
    gsap.set(entityEl, {
      width: cellW * spanCols,
      height: cellH * spanRows,
      x: targetX,
      y: targetY,
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

  // ── watch(curLoc)：player 移动 ──
  // 同时监听 curLoc 和 curRegion：curLoc 变化触发移动动画，curRegion 变化强制走 arrive
  const stopCurLocWatch = watch(
    () => [mapStore.curLoc, mapStore.curRegion] as const,
    ([newLoc, newRegion], [oldLoc, oldRegion]) => {
      // 首次加载（curLoc null → 值）：让 onEnter 接管 popUp，跳过分级动画
      if (oldLoc === null) return;
      // curLoc 未变化（仅 curRegion 变化等）：不处理移动
      if (newLoc === oldLoc) return;
      // curLoc 变为 null（退出游戏）：不处理移动
      if (newLoc === null) return;

      const player = actors.get('player');
      if (!player) return;

      // 预锁定（方案 A）：同步阶段立即设 isMoving=true，
      // 防止 rAF 前 syncEntityPosition 瞬移 player 导致 moveTo 读到 from===to
      // 降级/区域切换/长距离分支在 rAF 内 unlockMove() 解除
      player.lockMove();

      nextTick(() => requestAnimationFrame(() => {
        const grid = gridRef.value;
        const el = entityRefs.get('player');

        // 降级：无 grid / 无 el → 走 syncAllPositions + onMove
        if (!grid || !el) { player.unlockMove(); syncAllPositions(); playerAvatarStore.onMove(); return; }

        // 区域切换：到达弹起动画（淡入弹起，无倒下阶段）
        // 跨区域加载很快，倒下动画无法完整播放；arrive 直接从透明缩小状态弹起出现
        if (newRegion !== oldRegion) {
          player.unlockMove();
          syncAllPositions();
          player.arrive();
          return;
        }

        // 倒下降级：解锁 + onMove（走 intent 系统触发 popup 恢复）
        if (playerAvatarStore.isDown) {
          player.unlockMove();
          syncAllPositions();
          playerAvatarStore.onMove();
          return;
        }

        // 计算目标位置
        const anchor = getCellAnchor(grid, newLoc);
        if (!anchor) { player.unlockMove(); syncAllPositions(); playerAvatarStore.onMove(); return; }
        const { x: toX, y: toY, cellW, cellH } = anchor;

        // 读取旧位置（gsap transform 当前值，此时 syncAllPositions 未执行因 player 已锁定）
        const fromX = gsap.getProperty(el, 'x') as number;
        const fromY = gsap.getProperty(el, 'y') as number;
        const tier = calcMoveTier(fromX, fromY, toX, toY, cellW, cellH);

        if (tier === 'long') {
          // 长距离：解锁 + syncAllPositions + onEnter（走 intent 系统触发 popUp + notifyUp）
          // 不走 moveTo，避免丢失 isDown 状态机更新
          player.unlockMove();
          syncAllPositions();
          playerAvatarStore.onEnter();
          return;
        }

        // 短/中距离：moveTo 内部 isMoving=true 幂等，保持锁定状态
        // 不传 onDone：moveTo done 直接 startIdle，保留当前视觉行为（不绕 intent 系统）
        player.moveTo(toX, toY, cellW, cellH);
      }));
    },
  );

  // ── watch(entities)：敌人位置变化 + 首次入场 ──
  // v2.0 修复：同步阶段比较新旧 pls，对变化的敌人预 lockMove()，
  //           防止 rAF 内 syncAllPositions 先瞬移敌人导致 moveTo from===to
  const stopEntitiesWatch = watch(
    () => entitiesStore.entities,
    (entities, oldEntities) => {
      // ── 同步阶段 ──

      const newIds = new Set(entities.map(e => e.id));

      // 1. 取消正在淡出但又重新出现的实体（敌人消失后又回来）
      for (const e of entities) {
        if (fadingOutIds.has(e.id)) {
          fadingOutIds.delete(e.id);
          const actor = actors.get(e.id);
          if (actor) actor.idle();
        }
      }

      // 2. 对从列表移除的 actor（非 player）启动淡出动画
      //    displayEntities 会保留这些实体直到动画完成，Vue 不会调用 :ref(null)
      for (const e of oldEntities ?? []) {
        if (e.kind !== 'actor' || e.id === 'player') continue;
        if (newIds.has(e.id)) continue;       // 仍在列表中
        if (fadingOutIds.has(e.id)) continue;  // 已在淡出
        const actor = actors.get(e.id);
        if (!actor) continue;
        fadingOutIds.add(e.id);
        actor.playFadeOut(() => {
          fadingOutIds.delete(e.id);
          displayEntities.value = displayEntities.value.filter(x => x.id !== e.id);
        });
      }

      // 3. 更新 displayEntities：新 entities + 正在淡出的旧 entities
      //    正在淡出的实体使用旧数据（旧位置/旧图片），不会被 syncAllPositions 同步
      displayEntities.value = [
        ...entities,
        ...displayEntities.value.filter(e => fadingOutIds.has(e.id) && !newIds.has(e.id)),
      ];

      // 4. 预锁定移动的敌人（防止 rAF 内 syncAllPositions 瞬移）
      const oldPlsMap = new Map<string, string | number>();
      for (const e of oldEntities ?? []) {
        if (e.id !== 'player' && e.kind === 'actor') oldPlsMap.set(e.id, e.pls);
      }
      for (const entity of entities) {
        if (entity.id === 'player') continue;
        if (entity.kind !== 'actor') continue;
        const oldPls = oldPlsMap.get(entity.id);
        if (oldPls !== undefined && oldPls !== entity.pls) {
          const actor = actors.get(entity.id);
          if (actor) actor.lockMove();
        }
      }

      // 5. 清理已消失 entity 的入场记录（player 消失后重现可重新播 enter）
      for (const id of enteredEntities) {
        if (!newIds.has(id)) enteredEntities.delete(id);
      }

      nextTick(() => requestAnimationFrame(() => {
        syncAllPositions();
        tryFirstEnter(entities);
        handleEnemyMoves(entities);
      }));
    },
    { immediate: true },
  );

  // ── 首次入场触发 ──
  function tryFirstEnter(entities: readonly MapEntity[]): void {
    // player 首次入场：走 intent 系统（onEnter → intent='enter' → intent watch → player.enter(notifyUp)）
    // 解决异步加载场景：onMounted 调 onEnter 时 player entity 还没渲染，intent watch 取不到 el 静默跳过。
    // 改由 entities watch 检测 player el 可用后触发。
    if (!enteredEntities.has('player') && entityRefs.has('player')) {
      enteredEntities.add('player');
      playerAvatarStore.onEnter();
    }

    // 非 player actor 首次入场：直接调 actor.enter()（无 onUp，无 isDown 状态机）
    // 与 player 的 'enter' intent 视觉一致，但不走 playerAvatarStore 状态机
    for (const entity of entities) {
      if (entity.id === 'player') continue;
      if (entity.kind !== 'actor') continue;
      if (enteredEntities.has(entity.id)) continue;
      const actor = actors.get(entity.id);
      if (!actor) continue;
      enteredEntities.add(entity.id);
      actor.enter();  // 不传 onUp
    }

    // 清理已消失 entity（区域切换/敌人被击败/player reset）
    const currentIds = new Set(entities.map(e => e.id));
    for (const id of enteredEntities) {
      if (!currentIds.has(id)) enteredEntities.delete(id);
    }
  }

  // ── 敌人移动检测：比较 pls 变化 ──
  function handleEnemyMoves(entities: readonly MapEntity[]): void {
    const grid = gridRef.value;
    const currentIds = new Set(entities.map(e => e.id));

    for (const entity of entities) {
      if (entity.id === 'player') continue;
      if (entity.kind !== 'actor') continue;

      const oldPls = enemyLastPls.get(entity.id);
      enemyLastPls.set(entity.id, entity.pls);

      // 首次记录 / 未变化 → 跳过
      if (oldPls === undefined || oldPls === entity.pls) continue;

      const actor = actors.get(entity.id);
      if (!actor || !grid) continue;

      // 敌人已预锁定（同步阶段），此处读取的 from 是旧位置（syncAllPositions 跳过了它）
      const el = entityRefs.get(entity.id);
      if (!el) continue;
      const anchor = getCellAnchor(grid, entity.pls);
      if (!anchor) { actor.unlockMove(); continue; }
      const { x: toX, y: toY, cellW, cellH } = anchor;

      const fromX = gsap.getProperty(el, 'x') as number;
      const fromY = gsap.getProperty(el, 'y') as number;
      const tier = calcMoveTier(fromX, fromY, toX, toY, cellW, cellH);

      if (tier === 'long') {
        // 敌人长距离：解锁 + enter（setDown + popUp，无 onUp）
        actor.unlockMove();
        // 先同步到新位置（syncAllPositions 已跳过，这里手动 gsap.set）
        gsap.set(el, { x: toX, y: toY, width: cellW, height: cellH, xPercent: -50, yPercent: -100 });
        actor.enter();
      } else {
        // 短/中距离：moveTo 内部 isMoving=true 幂等
        actor.moveTo(toX, toY, cellW, cellH);
      }
    }

    // 防御性清理消失敌人的 enemyLastPls（setEntityRef(null) 已清理，这里双保险）
    for (const id of enemyLastPls.keys()) {
      if (!currentIds.has(id)) enemyLastPls.delete(id);
    }
  }

  // ── watch(intentSeq)：player intent 派发 ──
  // watch intentSeq 而非 intent：连续移动（intent 都是 'move'）时 intentSeq 递增确保每次都触发
  const stopIntentWatch = watch(
    () => playerAvatarStore.intentSeq,
    () => {
      nextTick(() => {
        const player = actors.get('player');
        if (!player) return;
        const intent = playerAvatarStore.intent;
        switch (intent) {
          case 'enter': case 'popup':
            player.enter(() => playerAvatarStore.notifyUp());
            break;
          case 'die': case 'fall':
            player.playFall(() => playerAvatarStore.notifyDown());
            break;
          default:
            // move / battle-start / battle-end / hit / low-hp / normal-hp / idle → idle
            player.idle();
        }
      });
    },
  );

  // ── 位置同步触发：ResizeObserver ──
  // 监听 grid 尺寸变化（缩放/resize），用 watch(gridRef) 而非 watchEffect，避免重复创建 observer
  let resizeObserver: ResizeObserver | null = null;
  const stopGridWatch = watch(gridRef, (grid) => {
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
    if (!grid) return;
    resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => syncAllPositions());
    });
    resizeObserver.observe(grid);
  });

  function dispose(): void {
    stopIntentWatch();
    stopGridWatch();
    stopCurLocWatch();
    stopEntitiesWatch();
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
    // 清理所有 actor 的 tween
    for (const actor of actors.values()) {
      actor.killAll();
    }
    actors.clear();
    entityRefs.clear();
    enemyLastPls.clear();
    enteredEntities.clear();
  }

  return {
    setEntityRef,
    syncAllPositions,
    displayEntities,
    dispose,
  };
}
