# Actor 动画框架设计案

> 版本：v2.0 · 状态：设计待评审
> 阶段：1+2 一步到位（通用动画函数 + 每 actor 独立控制器）
>
> v2.0 修订要点（相对 v1.0）：
> - **修复敌人移动瞬移漏洞**：entities watch 同步阶段比较新旧 pls，对变化的敌人预 `lockMove()`，避免 rAF 内 syncAllPositions 先瞬移导致 `from===to`
> - **修复 player 长距离移动丢 notifyUp**：`moveTo` 不再处理长距离分支，长距离由调用方显式走 `onEnter`（player）/ `enter`（敌人），保证 isDown 状态机正确
> - **修复 elRef 响应式失效**：放弃 `computed(() => entityRefs.get(id))`（普通 Map 无响应式），改为 actor 暴露 `setEl(el)` 方法，setEntityRef 时命令式调用
> - **保留 player 正常移动 done 直接 startIdle**：不绕 intent 系统，避免视觉延迟；onMove 仅在降级分支调用
> - **补充**：calcTarget 提取为 `getCellAnchor` 公共函数、moveTo done 补 `updateEntityZIndex`、dispose 清理 actors、handleEnemyMoves 防御性清理消失敌人

---

## 一、背景与目标

### 1.1 当前痛点

`useMapEntities.ts` 单文件 515 行，承载了三层职责：
- **动画函数**（popUp/fall/idle/move/jump/arriveAnim）—— 本应是通用工具
- **player 专用逻辑**（intent 派发、isMoving/animToken 竞态、移动分级）
- **调度逻辑**（4 路 watch：grid/curLoc/entities/intent）

具体问题：
1. `isMoving` / `animToken` 是模块级单变量，只服务 player。敌人移动时无法复用竞态保护
2. `syncEntityPosition` 硬编码 `if (entity.id === 'player' && isMoving)` —— 敌人移动时同样需要跳过同步
3. `tryEntityEnter` 中 `if (entity.id === 'player') continue` —— 首次入场逻辑分叉
4. player 走 `playerAvatarStore` intent 系统，敌人直接调函数，两套触发路径
5. 未来战斗小人碰撞需要获取任意 actor 位置、协调多 actor 时序，当前架构无此能力

### 1.2 目标

- **阶段 1**：提取动画函数为纯函数模块，与 store 解耦
- **阶段 2**：每 actor 独立动画控制器（`useActorAnimation`），独立持有 `isMoving` / `animToken`
- **敌人移动**：敌人位置变化时自动播放鸭子步/跳跃动画，与 player 竞态保护一致
- **战斗碰撞预留**：控制器暴露 `getPosition()` / `killAll()`，供未来战斗系统协调

### 1.3 借鉴导演系统

参考 `DESIGN.md §2.7 / §2.18` 前端导演系统的三层分离原则：

| 导演系统 | 地图动画框架 | 对应关系 |
|----------|-------------|---------|
| 原料层（PHP BattleLogCollector） | 数据层（stores：map/entities/playerAvatar） | 提供原始数据，不预判消费方式 |
| 导演层（battle-director.ts，纯函数） | 调度层（useMapEntities 的 watch） | 将数据变化翻译为动画意图，不触 DOM |
| 演员层（battle.ts + BattleModal.vue） | 演员层（useActorAnimation + actorAnimations） | 纯执行动画，不关心为什么播 |

**借鉴的关键原则**：
1. **演员层纯执行**：`useActorAnimation` 接收意图执行动画，不关心触发时机
2. **幂等性**：同一意图重复触发应产生一致结果（`animToken` 保证旧动画不干扰新动画）
3. **边界信号驱动**：导演用 `bl_segment_flag` 驱动分段；地图动画用 `curLoc` / `curRegion` / `intent` / `entity.pls` 变化驱动动画切换 —— 都是"数据变化信号"驱动，而非轮询

**不借鉴的部分**：
- 导演层的"剧本"（PlayScript）概念不适用于地图动画 —— 地图动画是实时的（用户点击立即播放），非回放式的（按剧本播放）。地图动画只需"意图"（Intent），无需"剧本"

---

## 二、目标架构

### 2.1 文件结构

```
vex-vue/src/
├── animations/
│   └── actorAnimations.ts        ← 新建：纯动画函数（操作 HTMLElement，不依赖 store）
├── composables/
│   ├── useMapEntities.ts         ← 改造：注册中心 + 调度（大幅瘦身）
│   └── useActorAnimation.ts      ← 新建：每 actor 独立控制器（状态封装）
├── types/
│   └── actor-animation.ts        ← 新建：ActorAnimation 接口 + MoveTier 类型
└── stores/
    ├── player-avatar.ts          ← 保留：player 专用 intent 状态机
    ├── entities.ts               ← 保留：实体列表 computed
    └── map.ts                    ← 保留：curLoc / curRegion / enemies
```

### 2.2 三层职责

```
┌─────────────────────────────────────────────────────┐
│ 数据层（stores）                                      │
│   mapStore.curLoc / curRegion / enemies              │
│   entitiesStore.entities (computed)                  │
│   playerAvatarStore.intent / intentSeq / isDown      │
└──────────────────────┬──────────────────────────────┘
                       │ 响应式数据变化
┌──────────────────────▼──────────────────────────────┐
│ 调度层（useMapEntities）                              │
│   4 路 watch → 翻译为动画意图                          │
│   ├─ watch(gridRef)    → ResizeObserver → syncAll    │
│   ├─ watch(curLoc)     → player 移动意图              │
│   ├─ watch(entities)   → 敌人位置变化 / 首次入场       │
│   └─ watch(intentSeq)  → player intent 派发           │
│   注册中心：Map<id, ActorAnimation>                   │
└──────────────────────┬──────────────────────────────┘
                       │ 动画意图（enter/move/arrive/hit/die...）
┌──────────────────────▼──────────────────────────────┐
│ 演员层（useActorAnimation + actorAnimations）         │
│   每 actor 一个控制器实例                              │
│   内部状态：isMoving / animToken / el                 │
│   纯执行：popUp / fall / idle / move / jump / arrive  │
└─────────────────────────────────────────────────────┘
```

---

## 三、模块设计

### 3.1 `actorAnimations.ts` — 纯动画函数

从 `useMapEntities.ts` 原样提取，改为模块级纯函数。**唯一变化**：`fall` 的 `onComplete` 回调从硬编码 `playerAvatarStore.notifyDown()` 改为可选参数 `onDown?`。

```typescript
// src/animations/actorAnimations.ts
import gsap from 'gsap';

const Z_STANDING = 10;

/**
 * 基于 GSAP y 属性动态计算 z-index：下方 actor z-index 更高，遮挡上方 actor
 * Z_STANDING=10 保证立绘始终在 cells(z-index:1) 之上
 */
export function updateEntityZIndex(el: HTMLElement): void {
  const y = gsap.getProperty(el, 'y') as number;
  el.style.zIndex = String(Z_STANDING + Math.round(y));
}

export function setDown(el: HTMLElement): void { /* 原样提取 */ }
export function startIdle(el: HTMLElement): void { /* 原样提取 */ }
export function popUp(el: HTMLElement, onUp?: () => void): void { /* 原样提取 */ }
export function fall(el: HTMLElement, onDown?: () => void): void {
  // onComplete: onDown?.()  替代  playerAvatarStore.notifyDown()
}
export function moveActor(el, toX, toY, direction, onComplete): void { /* 原样提取 */ }
export function jumpActor(el, toX, toY, cellH, onComplete): void { /* 原样提取 */ }
export function arriveAnim(el: HTMLElement): void { /* 原样提取 */ }
```

**约束**：
- 不 import 任何 store，只依赖 gsap
- 所有函数操作传入的 `el`，不持有状态
- 回调（onUp/onDown/onComplete）由调用方注入
- `updateEntityZIndex` 也导出，供 useActorAnimation 在 done 回调中调用

### 3.2 `useActorAnimation.ts` — 每 actor 控制器

每 actor 实例化一个，封装 `isMoving` / `animToken` 竞态保护。

**v2.0 关键变更**：
- el 不再用响应式 ref 跟踪（普通 Map 无响应式），改为 `setEl(el)` 命令式注入
- `moveTo` **不再处理长距离分支**，只处理鸭子步/跳跃。长距离由调用方判断后走 `enter`（保证 player 的 notifyUp）/ `arrive`
- `moveTo` 的 `done` 回调补 `updateEntityZIndex(el)`，且**不调 onMove**（onMove 由调用方在降级分支显式调）
- 新增 `getEl()` 供战斗系统获取 DOM

```typescript
// src/composables/useActorAnimation.ts
import gsap from 'gsap';
import {
  setDown, startIdle, popUp, fall,
  moveActor, jumpActor, arriveAnim,
  updateEntityZIndex,
} from '@/animations/actorAnimations';

/** 移动分级（供调用方判断，moveTo 内部不再决策长距离） */
export type MoveTier = 'duck' | 'jump' | 'long';

export interface ActorAnimation {
  /** 命令式注入/更新 el（替代响应式 ref，避免 Map 无响应式问题） */
  setEl(el: HTMLElement | null): void;
  /** 首次入场 / 强调到达：setDown + popUp */
  enter(onUp?: () => void): void;
  /** 跨区域到达：淡入弹起（无倒下阶段） */
  arrive(): void;
  /**
   * 移动到指定坐标（仅处理鸭子步/跳跃，长距离由调用方判断）
   * 内部封装 animToken 竞态保护 + done 回调（startIdle + updateEntityZIndex）
   */
  moveTo(toX: number, toY: number, cellW: number, cellH: number, onDone?: () => void): void;
  /** 预锁定 isMoving=true（防止 rAF 前 syncEntityPosition 瞬移），见 §7.1 风险 3 */
  lockMove(): void;
  /** 解除预锁定（降级/区域切换/长距离分支调用，恢复正常同步） */
  unlockMove(): void;
  /** 进入 idle 循环 */
  idle(): void;
  /** 倒下 */
  playFall(onDown?: () => void): void;
  /** 获取当前 GSAP transform 位置（供战斗系统计算碰撞轨迹） */
  getPosition(): { x: number; y: number };
  /** 获取当前 el（供战斗系统操作 DOM） */
  getEl(): HTMLElement | null;
  /** 杀掉所有 tween（供战斗系统接管） */
  killAll(): void;
  /** 是否正在移动动画中（供 syncEntityPosition 跳过同步） */
  readonly isMoving: boolean;
}

export function useActorAnimation(): ActorAnimation {
  let el: HTMLElement | null = null;
  let isMoving = false;
  let animToken = 0;

  function getEl(): HTMLElement {
    if (!el) throw new Error('ActorAnimation: el not set');
    return el;
  }

  function setEl(nextEl: HTMLElement | null): void {
    el = nextEl;
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

    // moveTo 仅处理鸭子步/跳跃；长距离由调用方判断后走 enter/arrive
    if (gridDist <= 1.5) {
      const direction: 1 | -1 | 0 = toX > fromX ? 1 : toX < fromX ? -1 : 0;
      moveActor(e, toX, toY, direction, done);
    } else {
      // gridDist <= 6.5（调用方已排除 long）
      jumpActor(e, toX, toY, cellH, done);
    }
  }

  return {
    setEl, enter, arrive, idle, playFall, moveTo,
    lockMove, unlockMove,
    getPosition, getEl: () => el, killAll,
    get isMoving() { return isMoving; },
  };
}
```

**关键设计**：
- `isMoving` / `animToken` 是闭包私有，每 actor 独立 —— player 和敌人移动互不干扰
- `moveTo` 仅封装短中距离动画 + 竞态保护；**长距离不在此处理**（见 §3.3 调用方逻辑）
- `moveTo` 的 `done` 内部直接 `startIdle` + `updateEntityZIndex`，不绕 intent 系统（保留当前视觉行为，避免延迟）；`onDone` 仅作为附加回调，player 正常分支不传
- `setEl` 命令式注入 el，避免 `computed(() => map.get(id))` 对普通 Map 无响应式的问题
- `enter(onUp?)` / `playFall(onDown?)` 的可选回调：player 传 `notifyUp` / `notifyDown`，敌人不传
- `getPosition()` / `getEl()` / `killAll()` 为战斗碰撞预留

### 3.3 `useMapEntities.ts` — 注册中心 + 调度

改造为"注册中心 + 调度层"，不再持有动画函数和 `isMoving`。

**v2.0 关键变更**：
- `setEntityRef` 调 `actor.setEl(el)` 命令式注入（替代响应式 computed）
- `watch(entities)` **同步阶段**比较新旧 pls，对变化的敌人预 `lockMove()`（修复敌人瞬移漏洞）
- `watch(curLoc)` 正常分支调 `player.moveTo` 不传 onDone（保留 done 直接 startIdle）；**长距离分支显式走 `onEnter`**（修复 notifyUp 丢失）
- `watch(entities)` 的 `handleEnemyMoves` **长距离分支显式走 `actor.enter()`**（敌人无 notifyUp，但语义一致）
- 提取 `getCellAnchor(grid, pls)` 公共函数，`syncEntityPosition` 和移动计算复用
- 提取 `calcMoveTier(fromX, fromY, toX, toY, cellW, cellH)` 供 curLoc watch 和 handleEnemyMoves 复用

```typescript
// src/composables/useMapEntities.ts（改造后骨架）
import { watch, nextTick, type Ref } from 'vue';
import gsap from 'gsap';
import { usePlayerAvatarStore } from '@/stores/player-avatar';
import { useEntitiesStore } from '@/stores/entities';
import { useMapStore } from '@/stores/map';
import { updateEntityZIndex } from '@/animations/actorAnimations';
import { useActorAnimation, type ActorAnimation, type MoveTier } from '@/composables/useActorAnimation';
import type { MapEntity } from '@/types/map-entity';

const Z_STANDING = 10;

/** 移动分级阈值（与原 useMapEntities 一致） */
const DUCK_MAX_GRID = 1.5;   // ≤1.5 格：鸭子步
const JUMP_MAX_GRID = 6.5;   // ≤6.5 格：跳跃

/** 计算 cell 锚点位置（供 syncEntityPosition 和移动动画复用） */
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
  return { x: offsetX + cellW / 2, y: offsetY + cellH, cellW, cellH };
}

/** 计算移动分级（供调用方判断，moveTo 不再决策长距离） */
function calcMoveTier(fromX: number, fromY: number, toX: number, toY: number, cellW: number, cellH: number): MoveTier {
  const gridDist = Math.max(Math.abs(toX - fromX) / cellW, Math.abs(toY - fromY) / cellH);
  if (gridDist <= DUCK_MAX_GRID) return 'duck';
  if (gridDist <= JUMP_MAX_GRID) return 'jump';
  return 'long';
}

export function useMapEntities(gridRef: Ref<HTMLElement | null>) {
  const playerAvatarStore = usePlayerAvatarStore();
  const entitiesStore = useEntitiesStore();
  const mapStore = useMapStore();

  // ── 实体 DOM 引用 ──
  const entityRefs = new Map<string, HTMLElement>();
  // ── actor 动画控制器注册中心 ──
  const actors = new Map<string, ActorAnimation>();
  // ── 敌人上次位置（检测敌人移动）──
  const enemyLastPls = new Map<string, string | number>();
  // ── 已入场记录（避免重复播 enter）──
  const enteredEntities = new Set<string>();

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
  function syncEntityPosition(entityEl: HTMLElement, entity: MapEntity, gridEl: HTMLElement): boolean {
    const actor = actors.get(entity.id);
    if (actor?.isMoving) return false;  // 通用化，不再只跳 player

    const anchor = getCellAnchor(gridEl, entity.pls);
    if (!anchor) return false;
    const { x: targetX, y: targetY, cellW, cellH } = anchor;
    const spanCols = entity.spanCols ?? 1;
    const spanRows = entity.spanRows ?? 1;
    // 锚点格底部居中，尺寸 = cell × 跨度
    gsap.set(entityEl, {
      width: cellW * spanCols,
      height: cellH * spanRows,
      x: offsetX + cellW * spanCols / 2,  // 注：spanCols>1 时锚点需调整，见下
      y: targetY,
      xPercent: -50,
      yPercent: -100,
    });
    updateEntityZIndex(entityEl);
    return true;
  }
  // 注：spanCols>1 时锚点 x = offsetX + cellW * spanCols / 2，需用锚点格偏移；
  //     当前 player/enemy spanCols=1，getCellAnchor 返回的 x 已是 cellW/2 偏移，
  //     span>1 场景未来扩展时需调整 getCellAnchor 签名。初版保持一致。

  function syncAllPositions(): void {
    const grid = gridRef.value;
    if (!grid) return;
    for (const entity of entitiesStore.entities) {
      const el = entityRefs.get(entity.id);
      if (el) syncEntityPosition(el, entity, grid);
    }
  }

  // ── watch(curLoc)：player 移动 ──
  watch(() => [mapStore.curLoc, mapStore.curRegion] as const, ([newLoc, newRegion], [oldLoc, oldRegion]) => {
    if (oldLoc === null || newLoc === oldLoc) return;
    const player = actors.get('player');
    if (!player) return;

    // 预锁定（方案 A）：同步阶段立即设 isMoving=true，
    // 防止 rAF 前 syncEntityPosition 瞬移 player 导致 moveTo 读到 from===to
    // 降级/区域切换/长距离分支在 rAF 内 unlockMove() 解除
    player.lockMove();

    nextTick(() => requestAnimationFrame(() => {
      const grid = gridRef.value;
      const el = entityRefs.get('player');
      if (!grid || !el) { player.unlockMove(); syncAllPositions(); return; }

      // 区域切换：解锁 + arrive
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
  });

  // ── watch(entities)：敌人位置变化 + 首次入场 ──
  // v2.0 修复：同步阶段比较新旧 pls，对变化的敌人预 lockMove()，
  //           防止 rAF 内 syncAllPositions 先瞬移敌人导致 moveTo from===to
  watch(() => entitiesStore.entities, (entities, oldEntities) => {
    // 同步阶段：预锁定移动的敌人
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
        if (actor) actor.lockMove();  // 预锁定，rAF 内 syncAllPositions 跳过
      }
    }

    nextTick(() => requestAnimationFrame(() => {
      syncAllPositions();
      tryFirstEnter(entities);
      handleEnemyMoves(entities);
    }));
  }, { immediate: true });

  function tryFirstEnter(entities: readonly MapEntity[]): void {
    // player 首次入场：走 intent 系统（onEnter → intent='enter' → intent watch → player.enter(notifyUp)）
    if (!enteredEntities.has('player') && entityRefs.has('player')) {
      enteredEntities.add('player');
      playerAvatarStore.onEnter();
    }
    // 非 player actor 首次入场：直接调 actor.enter()（无 onUp，无 isDown 状态机）
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
  watch(() => playerAvatarStore.intentSeq, () => {
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
          player.idle();
      }
    });
  });

  // ── ResizeObserver、dispose 等保留 ──
  let resizeObserver: ResizeObserver | null = null;
  const stopGridWatch = watch(gridRef, (grid) => {
    if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null; }
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
    if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null; }
    // 清理所有 actor 的 tween
    for (const actor of actors.values()) {
      actor.killAll();
    }
    actors.clear();
    entityRefs.clear();
    enemyLastPls.clear();
    enteredEntities.clear();
  }

  return { setEntityRef, syncAllPositions, dispose };
}
```

**关键变化总结**：
1. `isMoving` / `animToken` 从模块级移入 `useActorAnimation` 闭包
2. `syncEntityPosition` 改为 `actor?.isMoving` 通用判断，不再硬编码 player
3. `setEntityRef` 调 `actor.setEl(el)` 命令式注入（替代响应式 computed）
4. `watch(curLoc)` 正常分支调 `player.moveTo`（不传 onDone，保留 done 直接 startIdle）；长距离分支显式走 `onEnter`
5. `watch(entities)` **同步阶段**预锁定移动的敌人；rAF 内 `handleEnemyMoves` 长距离走 `actor.enter()`
6. 提取 `getCellAnchor` / `calcMoveTier` 公共函数
7. `INTENT_HANDLERS` 映射表内联到 intent watch，调用 `player.enter/idle/playFall`
8. `tryFirstEnter` / `tryEntityEnter` 合并，player 走 `onEnter()`（intent），敌人走 `actor.enter()`
9. `dispose` 清理所有 actor 的 tween

---

## 四、迁移步骤

### 步骤 1：创建 `actorAnimations.ts`
- 从 `useMapEntities.ts` 原样提取 8 个动画函数 + `updateEntityZIndex`
- `fall` 的 `onComplete` 改为可选 `onDown` 参数
- `popUp` 已有 `onUp` 参数（保持）
- 验证：`vue-tsc --noEmit` 通过

### 步骤 2：创建 `useActorAnimation.ts`
- 实现闭包封装 `isMoving` / `animToken` / `el`
- `setEl(el)` 命令式注入 el
- `moveTo` 内部封装鸭子步/跳跃 + 竞态保护（**不处理长距离**）
- `moveTo` done 回调补 `updateEntityZIndex`，不调 onMove
- 导出 `ActorAnimation` 接口 + `MoveTier` 类型
- 验证：单元级——手动构造 el 测试 `moveTo` / `enter` / `arrive`

### 步骤 3：创建 `types/actor-animation.ts`
- 导出 `ActorAnimation` 接口（从 useActorAnimation re-export 或独立定义）
- 导出 `MoveTier` 类型

### 步骤 4：改造 `useMapEntities.ts`
- 引入 `actors: Map<string, ActorAnimation>`
- 提取 `getCellAnchor` / `calcMoveTier` 公共函数
- `setEntityRef` 中创建/销毁控制器 + 调 `setEl`
- `syncEntityPosition` 改用 `actor?.isMoving`，复用 `getCellAnchor`
- `curLoc watch`：预锁定 → rAF 内分级（long 走 onEnter，短中走 moveTo 不传 onDone）
- `entities watch`：同步阶段预锁定移动敌人 → rAF 内 syncAll + tryFirstEnter + handleEnemyMoves（long 走 actor.enter）
- `intent watch` 改调 `player.enter` / `idle` / `playFall`
- 删除内联动画函数和 `INTENT_HANDLERS`
- `dispose` 清理 actors
- 验证：`vue-tsc --noEmit` + 浏览器手测 player 移动 + 敌人移动 + 首次入场

### 步骤 5：手测回归
- player 鸭子步（1 格）
- player 跳跃（2-6 格）
- player 弹出（>6 格 / 区域切换）—— 验证 onEnter 走 intent，notifyUp 正确触发
- 连续移动竞态（animToken 生效）
- 敌人首次入场 popUp
- **敌人短距离移动鸭子步**（后端推送敌人 pls 变化）—— 验证预锁定生效，不瞬移
- **敌人中距离移动跳跃**
- **敌人长距离移动 enter**（setDown + popUp）
- player 倒下 / 弹起恢复
- 区域切换 player arriveAnim 正常

---

## 五、敌人移动实现路径

### 5.1 数据流（v2.0 修复版）

```
后端推送敌人移动 → mapStore.enemies[i].pls 更新
                → entitiesStore.entities computed 重算（返回新数组）
                → useMapEntities 的 watch(entities) 触发
                │
                ├─ 同步阶段：比较新旧 pls，对变化的敌人 actor.lockMove()
                │  （防止 rAF 内 syncAllPositions 瞬移敌人）
                │
                └─ nextTick → rAF：
                   ├─ syncAllPositions()（跳过 lockMove 的敌人，保持旧位置）
                   ├─ tryFirstEnter()（首次入场走 actor.enter）
                   └─ handleEnemyMoves()：
                      ├─ 读 fromX/fromY（旧位置，因 syncAllPositions 跳过了）
                      ├─ calcMoveTier → 'duck'/'jump'：actor.moveTo(toX, toY, ...)
                      └─ calcMoveTier → 'long'：actor.unlockMove() + gsap.set + actor.enter()
```

### 5.2 敌人 vs player 的差异

| 维度 | player | 敌人 |
|------|--------|------|
| 移动触发源 | `watch(curLoc)` | `watch(entities)` 内部 pls 比较 |
| 预锁定时机 | `watch(curLoc)` 同步阶段 `player.lockMove()` | `watch(entities)` 同步阶段 `actor.lockMove()` |
| 竞态保护 | `useActorAnimation` 闭包 | 同左（每 actor 独立） |
| 区域切换 | `arrive()` | 敌人通常不跨区域（如需则同样 `arrive()`） |
| 长距离分支 | `unlockMove()` + `syncAllPositions()` + `onEnter()`（intent + notifyUp） | `unlockMove()` + `gsap.set()` + `actor.enter()`（无 notifyUp） |
| 首次入场 | `onEnter()` → intent → `enter(notifyUp)` | `enter()`（无 onUp） |
| isDown 状态机 | `playerAvatarStore` | 无（敌人不需要自动恢复） |
| 移动后回调 | 降级分支 `onMove()`，正常分支无（done 直接 startIdle） | 无 |

### 5.3 敌人移动的 syncAllPositions 交互

敌人 `moveTo` 期间 `isMoving=true`，`syncEntityPosition` 跳过该敌人 —— 与 player 逻辑一致。动画完成后 `isMoving=false`，`syncAllPositions` 恢复同步。

**v2.0 修复点**：敌人 pls 变化时，`watch(entities)` 同步阶段立即 `lockMove()`，确保 rAF 内 `syncAllPositions` 跳过该敌人。否则 `syncAllPositions` 会先瞬移敌人到新格，`handleEnemyMoves` 读到 `from===to`，走长距离分支丢失鸭子步/跳跃动画。

---

## 六、战斗碰撞预留接口（阶段 3，本次不实现）

未来战斗从图格碰撞转为小人碰撞时，战斗系统可通过注册中心获取双方 actor 实例：

```typescript
// 未来战斗系统的伪代码
const player = actors.get('player');
const enemy = actors.get('enemy-1');
if (!player || !enemy) return;

const playerPos = player.getPosition();
const enemyPos = enemy.getPosition();
const playerEl = player.getEl();
const enemyEl = enemy.getEl();

// 杀掉双方 idle/move tween，战斗系统接管
player.killAll();
enemy.killAll();

// 编排碰撞 timeline（GSAP）
const tl = gsap.timeline();
// player 冲向 enemy
tl.to(playerEl, { x: enemyPos.x, y: enemyPos.y, duration: 0.3, ease: 'power2.in' });
// 碰撞瞬间：enemy 受击后退
tl.to(enemyEl, { x: enemyPos.x + 30, rotation: 15, duration: 0.2, ease: 'back.in' });
// player 弹回原位
tl.to(playerEl, { x: playerPos.x, y: playerPos.y, duration: 0.4, ease: 'elastic.out(1, 0.5)' });
// enemy 恢复
tl.to(enemyEl, { rotation: 0, duration: 0.3, ease: 'sine.out' });
// 回归 idle
tl.add(() => { player.idle(); enemy.idle(); });
```

**预留接口**：
- `getPosition()`：供战斗系统计算碰撞轨迹起点/终点
- `getEl()`：供战斗系统操作 DOM（GSAP timeline 需要）
- `killAll()`：供战斗系统接管前清理 idle/move tween
- `idle()`：战斗结束后回归待机

**阶段 3 可能新增**：
- `playHit()`：受击动画（后仰 + 抖动）
- `playAttack(targetPos)`：冲撞动画
- `playDie()`：死亡倒下（复用 `fall`）

---

## 七、风险与权衡

### 7.1 风险

1. **~~`useActorAnimation` 的 elRef 响应式~~**（v2.0 已修复）：v1.0 用 `computed(() => entityRefs.get(id))` 包装 elRef，但 `entityRefs` 是普通 Map，Vue 无法响应式跟踪 Map.get，computed 永远只取首次值。v2.0 改为 `setEl(el)` 命令式注入，`setEntityRef` 时直接调 `actor.setEl(el)`。区域切换 DOM 重建时 `:ref` 回调先 null 后 el，`setEntityRef(null)` 销毁 actor，`setEntityRef(el)` 创建新 actor 并 setEl，无残留。

2. **~~entities watch 的敌人移动检测瞬移~~**（v2.0 已修复）：v1.0 的 `watch(entities)` 在 rAF 内先 `syncAllPositions` 后 `handleEnemyMoves`，敌人 `isMoving=false` 被瞬移，`moveTo` 读 `from===to` 走长距离分支丢动画。v2.0 在同步阶段比较新旧 pls，对变化的敌人预 `lockMove()`，rAF 内 `syncAllPositions` 跳过锁定的敌人，`handleEnemyMoves` 读到正确的旧位置。

3. **同步阶段 isMoving 设置时机**（v1.0 已解决，v2.0 沿用方案 A）：player 的 `curLoc watch` 在同步阶段立即 `player.lockMove()` 设 `isMoving=true`，防止 rAF 前 `syncEntityPosition` 瞬移 player。降级/区域切换/长距离分支在 rAF 内 `unlockMove()` 解除，正常分支调 `moveTo()`（内部 `isMoving=true` 幂等）。v2.0 将此机制扩展到敌人（同步阶段预锁定）。

4. **~~player 长距离移动丢 notifyUp~~**（v2.0 已修复）：v1.0 的 `moveTo` 内部长距离分支 `gsap.set + popUp(el)` 不走 intent 系统，player 的 `isDown` 状态不会更新（notifyUp 未调），且 `gsap.set` 缺 `width/height/xPercent/yPercent`。v2.0 让 `moveTo` 不处理长距离，`curLoc watch` 长距离分支显式走 `playerAvatarStore.onEnter()`（触发 intent='enter' → intent watch → `player.enter(notifyUp)`），与改造前行为完全一致。

5. **~~player 正常移动 done 多绕 intent~~**（v2.0 已修复）：v1.0 的 `curLoc watch` 正常分支传 `onDone = () => playerAvatarStore.onMove()`，onMove 派发 intent='move' → intent watch → `player.idle()`，多一次 intentSeq + nextTick 延迟。v2.0 正常分支不传 onDone，`moveTo` done 直接 `startIdle`（与当前代码一致），onMove 仅在降级分支显式调用（触发 popup 恢复）。

6. **控制器生命周期**：`setEntityRef(null)` 时销毁控制器并清理 `enemyLastPls` / `enteredEntities`。区域切换时所有 entity ref 会被重建（key 不变但 DOM 重建），`:ref` 回调顺序为先 null 后 el，actor 先销毁后重建，无残留。`dispose` 统一调 `actor.killAll()` 清理 tween。

7. **spanCols/spanRows 扩展**：当前 `getCellAnchor` 返回单格锚点（`offsetX + cellW/2`），`syncEntityPosition` 用 `spanCols ?? 1` 调整。player/enemy 当前 span=1，一致。未来 span>1 实体（worm/poi）需扩展 `getCellAnchor` 签名接受 span 参数，初版不处理。

### 7.2 权衡

| 决策 | 选择 | 理由 |
|------|------|------|
| 动画函数是否带状态 | 纯函数（无状态） | 可被任意 actor 复用，状态由 `useActorAnimation` 闭包管理 |
| 控制器是否每 actor 独立 | 是 | player/敌人移动竞态独立，未来战斗碰撞需独立 kill |
| el 如何传递 | `setEl(el)` 命令式注入 | 普通 Map 无响应式，computed 方案失效；命令式简单可靠 |
| moveTo 是否处理长距离 | 否（调用方判断） | player 长距离需走 onEnter intent（notifyUp），敌人长距离走 enter，语义不同不宜封装 |
| player 正常移动 done 是否走 intent | 否（直接 startIdle） | 保留当前视觉行为，避免 intentSeq + nextTick 延迟 |
| 是否引入"剧本"概念 | 否 | 地图动画是实时的，非回放式，意图（Intent）足够 |
| 敌人移动检测方式 | entities watch 内 pls 比较 | 无需改 store，useMapEntities 内部闭环 |
| 敌人预锁定时机 | entities watch 同步阶段 | 与 player curLoc watch 一致，防止 rAF 窗口期瞬移 |

### 7.3 不做的事

- **不引入事件总线/发布订阅**：4 路 watch 已覆盖所有触发场景，增加间接层无收益
- **不给每 actor 独立组件**：actor 仍是 `MapGrid.vue` 中的 `<div>`，控制器通过 `setEntityRef` 注册，无需组件化
- **不改 playerAvatarStore**：intent 状态机保持不变，只是消费者从 `INTENT_HANDLERS` 改为 `player.enter/idle/playFall`
- **不实现战斗碰撞**：仅预留 `getPosition` / `getEl` / `killAll` 接口，阶段 3 实施
- **不处理 span>1 实体的移动动画**：初版仅 player/enemy（span=1），未来扩展时调整 `getCellAnchor`

---

## 八、验收标准

- [ ] `vue-tsc --noEmit` 通过
- [ ] `actorAnimations.ts` 不 import 任何 store
- [ ] `useMapEntities.ts` 行数显著减少（动画函数移出）
- [ ] player 鸭子步（1 格）行为与改造前一致
- [ ] player 跳跃（2-6 格）行为与改造前一致
- [ ] player 弹出（>6 格）走 onEnter intent，notifyUp 正确触发，isDown 状态正确
- [ ] player 区域切换 arriveAnim 正常
- [ ] 连续移动竞态（animToken）保护生效
- [ ] player 倒下/弹起恢复流程正常
- [ ] 敌人首次入场播放 popUp 动画（actor.enter，无 notifyUp）
- [ ] **敌人短距离移动播放鸭子步**（预锁定生效，不瞬移）
- [ ] **敌人中距离移动播放跳跃**
- [ ] **敌人长距离移动播放 enter（setDown + popUp）**
- [ ] 敌人移动期间 `syncEntityPosition` 跳过该敌人，不瞬移
- [ ] 区域切换后 DOM 重建，actor 正确重建（setEl 命令式注入生效）

---

**文档结束。**
