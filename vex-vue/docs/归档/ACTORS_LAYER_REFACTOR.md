# 角色层重构设计案 v3（路径 1 + 多角色层）

> **目标**：将玩家立绘从 `.map-cell.current` 内部迁出，独立为 `#mapGrid` 内与 cells 同级的角色层，复刻 demo 的 z-index 切换丝滑效果，并为未来 NPC/敌怪小人预留统一架构。

---

## 1. 架构概览

### 1.1 三层结构

```
事件源层（battle.ts / MapGrid.vue / 调试按钮）
    ↓ 调用 playerAvatarStore.onXxx()
意图层（player-avatar store，玩家专用，保留不变）
    ↓ intentSeq 变化
动画层（useActors composable，新建）
    ↓ watch(intentSeq) 派发动画 + watch(curLoc/actors) + ResizeObserver 同步位置
DOM 层（#mapGrid > .actor × N，与 .map-cell × N 同级）
```

### 1.2 核心决策

| 决策 | 方案 | 理由 |
|------|------|------|
| actor DOM 位置 | `#mapGrid` 直接子元素，与 cells 同级 | z-index 可与 cells 自由比较，实现"被遮挡/浮出"切换 |
| actor 定位方式 | `position:absolute` + GSAP `x/y/xPercent/yPercent` + `width/height` | 脱离 grid 流；GSAP 合并 transform；尺寸等于 cell 让 img 150% 比例生效 |
| 位置同步触发 | ResizeObserver + watch(curLoc) + watch(actors) | 覆盖缩放/resize/移动/初始挂载全场景 |
| z-index 切换 | class 切换（`.popped`） | 语义清晰，不与 GSAP transform 混淆 |
| 玩家意图状态机 | 保留 player-avatar store 不变 | battle.ts 接入零改动 |
| 多角色扩展 | actorsStore 管理 actor 列表 | 当前只有玩家，未来加 NPC/敌怪只加数据 |

---

## 2. 数据层

### 2.1 Actor 类型（新建 `src/types/actor.ts`）

```typescript
/** 角色小人类型 */
export type ActorKind = 'player' | 'npc' | 'enemy';

/** 角色小人数据 */
export interface Actor {
  /** 唯一 ID（player / enemy-{pid} / npc-{pid}） */
  id: string;
  /** 角色类型 */
  kind: ActorKind;
  /** 所在位置 ID（pls） */
  pls: string | number;
  /** 立绘图片 URL */
  img: string;
}
```

### 2.2 actorsStore（新建 `src/stores/actors.ts`）

```typescript
import { defineStore } from 'pinia';
import { computed } from 'vue';
import { useMapStore } from '@/stores/map';
import type { Actor } from '@/types/actor';

export const useActorsStore = defineStore('actors', () => {
  const mapStore = useMapStore();

  // ── actor 列表（响应式，从 mapStore 派生） ──
  const actors = computed<Actor[]>(() => {
    const list: Actor[] = [];

    // 玩家 actor（当前格存在时）
    if (mapStore.curLoc !== null && mapStore.curRegion !== null) {
      list.push({
        id: 'player',
        kind: 'player',
        pls: mapStore.curLoc,
        img: '/img/4.png',
      });
    }

    // 敌人 actors（state===0 的活动敌人，预留，当前不渲染立绘）
    // 未来启用时取消注释
    // if (mapStore.enemies) {
    //   for (const e of mapStore.enemies) {
    //     if (Number(e.state) === 0) {
    //       list.push({
    //         id: `enemy-${e.pid}`,
    //         kind: 'enemy',
    //         pls: e.pls,
    //         img: `/img/enemy_${e.icon}.png`,
    //       });
    //     }
    //   }
    // }

    return list;
  });

  return { actors };
});
```

### 2.3 player-avatar store（保留不变）

现有 [player-avatar.ts](file:///d:/wamp64/www/phpdts/vex-vue/src/stores/player-avatar.ts) 完全保留，继续承担玩家意图状态机（intent/intentSeq/isDown/pendingIntent/自动恢复）。battle.ts 的 5 处接入零改动。模板的 `.popped` class 直接读 `playerAvatarStore.isDown`，无需中间状态。

---

## 3. DOM 层改造

### 3.1 MapGrid.vue 模板改造

**移除**：`cell.isCurrent` template 内的 `<img class="player-avatar">`。

**新增**：`#mapGrid` 内 cells v-for 之后，新增 actors v-for。

```vue
<template>
  <div id="mapContainer" ref="containerRef" class="map-container flex-1 min-h-0 overflow-auto relative">
    <div id="mapGrid" ref="gridRef" class="ascii-map-grid" :style="gridStyle">
      <!-- 占位（数据不可用） -->
      <div v-if="cells.length === 0" class="error">{{ placeholderText }}</div>

      <!-- cells（v-for 渲染，无立绘） -->
      <div
        v-for="cell in cells"
        :key="cell.key"
        :class="cell.classList"
        :data-pls="cell.pls || undefined"
        :data-enemy-pid="cell.hasEnemy && cell.enemy ? String(cell.enemy.pid) : undefined"
        :style="cell.styleObj"
        :title="cell.title"
        @click="onCellClick(cell)"
        @mouseenter="onCellEnter(cell)"
        @mouseleave="onCellLeave(cell)"
      >
        <template v-if="cell.isEmpty"></template>
        <template v-else-if="cell.isFogged">
          <span class="cell-name" :style="{ fontSize: nameFontSize + 'px' }">?</span>
        </template>
        <template v-else-if="cell.isCurrent">
          <!-- 立绘已迁出，只保留地名标签 -->
          <span class="cell-name pulse-white player-label">
            {{ cell.prefix }}{{ cell.displayLabel }}
          </span>
        </template>
        <template v-else-if="cell.hasEnemy">
          <span class="cell-name">
            <span class="cell-enemy">[{{ cell.enemyName }}]</span>{{ cell.prefix }}{{ cell.displayLabel }}
          </span>
        </template>
        <template v-else-if="cell.displayLabel">
          <span class="cell-name" :style="{ fontSize: nameFontSize + 'px' }">{{ cell.prefix }}{{ cell.displayLabel }}</span>
        </template>
        <template v-else>
          <span class="cell-coord">{{ cell.coordLabel }}</span>
        </template>
      </div>

      <!-- 角色层：所有小人（与 cells 同级，absolute 定位） -->
      <div
        v-for="actor in actorsStore.actors"
        :key="actor.id"
        :ref="el => setActorRef(actor.id, el as HTMLElement)"
        class="actor"
        :class="{ popped: actor.id === 'player' ? !playerAvatarStore.isDown : true }"
        :data-actor-id="actor.id"
      >
        <div class="actor-shadow"></div>
        <img class="actor-img" :src="actor.img" :alt="actor.id" />
      </div>
    </div>
  </div>
</template>
```

**模板关键点**：
- `:class="{ popped: ... }"` 直接读 `playerAvatarStore.isDown`，无需中间函数。未来多角色时改为按 actor.kind 分发读对应 store 的 isDown。
- `:ref` 用函数形式绑定到 `setActorRef`，收集 actor DOM 引用。

### 3.2 关键 CSS（terminal.css 新增/修改）

```css
/* #mapGrid 加 position:relative，让 actor absolute 定位相对 grid */
.ascii-map-grid {
    display: grid;
    gap: 0;
    padding: 2px;
    position: relative;  /* 新增 */
}

/* 角色层 actor：absolute 定位，脱离 grid 流 */
/* 尺寸由 useActors 的 syncActorPosition 动态设置（等于 cell 尺寸） */
.actor {
    position: absolute;
    left: 0;
    top: 0;
    pointer-events: none;
    z-index: 0;     /* 默认：被所有 cell（普通 z-index:1 / 当前 z-index:2）遮挡 */
    transform-origin: bottom center;
    will-change: transform, opacity;
}
/* popped 状态：浮出 cells 之上 */
.actor.popped {
    z-index: 10;
}

/* 立绘图片：height 相对 actor 高度（actor 高度由 syncActorPosition 设为 cell 高度） */
.actor-img {
    position: absolute;
    left: 50%;
    bottom: 0;
    height: 150%;   /* 相对 actor 高度，等于 cell 高度的 150% */
    width: auto;
    transform: translateX(-50%);  /* 水平居中（CSS 管理，GSAP 不接管 img） */
    image-rendering: auto;
    filter:
        drop-shadow( 1px  0 0 #fff)
        drop-shadow(-1px  0 0 #fff)
        drop-shadow( 0  1px 0 #fff)
        drop-shadow( 0 -1px 0 #fff)
        drop-shadow(0 4px 4px rgba(0, 0, 0, 0.6));
}

/* 阴影：transform 由 GSAP 管理（xPercent:-50 + scale），CSS 不设 transform 避免被覆盖 */
.actor-shadow {
    position: absolute;
    left: 50%;
    bottom: -4px;
    width: 70%;
    height: 8px;
    background: rgba(0, 0, 0, 0.55);
    border-radius: 50%;
    filter: blur(2px);
    transform-origin: center center;
    /* 不设 transform，由 GSAP 初始化 xPercent:-50 + scale:1 */
}

/* v3 关键修复：普通 cell 加 z-index:1，确保倒下立绘（rotation:-90 延伸到相邻 cell）
   被所有 cell 遮挡，复刻 demo 的 #map { z-index:1 } 整体遮挡效果 */
.map-cell {
    color: #888;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    font-weight: bold;
    cursor: default;
    position: relative;
    z-index: 1;     /* v3 新增：普通格 z-index:1，遮挡倒下立绘 */
    transition: background 0.1s, color 0.1s, border-color 0.1s;
    user-select: none;
    border: 1px solid rgba(68,68,68,0.3);
}
/* 当前格：z-index:2，比普通格更高（与 demo 的 .cell.me z-index:2 一致） */
.map-cell.current {
    color: #fff;
    font-weight: 700;
    z-index: 2;
}
```

### 3.3 移除旧样式

删除 MapGrid.vue `<style scoped>` 内的 `:deep(.player-avatar)` 和 `:deep(.map-cell.current .player-label)` 中与立绘相关的规则（立绘已迁出格子）。保留 `.map-cell.current` 的背景/边框样式。

---

## 4. 位置同步

### 4.1 同步算法（核心）

```typescript
/**
 * 同步单个 actor 到其 pls 对应的格子位置
 * 算法与 centerOnPlayer 一致：用 offsetLeft/offsetTop 累加计算 cell 相对 grid 偏移
 *
 * 关键：同时设置 actor 的 width/height 等于 cell 尺寸，
 * 让 .actor-img 的 height:150% 相对 actor 高度生效
 */
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

  // 阴影初始化（首次同步时设 xPercent，后续动画只改 scale/alpha）
  const shadow = actorEl.querySelector('.actor-shadow') as HTMLElement | null;
  if (shadow && !shadow.dataset.inited) {
    gsap.set(shadow, { xPercent: -50, scale: 1, alpha: 1 });
    shadow.dataset.inited = '1';
  }

  return true;
}
```

### 4.2 触发机制（三路触发）

| 触发场景 | 机制 | 实现 |
|---------|------|------|
| 缩放 / resize | ResizeObserver 监听 `#mapGrid` 尺寸变化 | 任何导致格子尺寸变化的操作都会触发，无需改 useMapInteraction/useMapRender |
| 移动（curLoc 变化） | watch(mapStore.curLoc) | 移动后同步位置 + 触发 onMove 意图 |
| actor 列表变化 | watch(actorsStore.actors) | 初始挂载 / 区域切换 |

```typescript
// ── ResizeObserver：监听 grid 尺寸变化（缩放/resize） ──
// 用 watch(gridRef) 而非 watchEffect，避免重复创建 observer 不 disconnect
// v3 优化：去掉 nextTick，ResizeObserver 回调本身在 DOM 已更新后触发，
//         单 rAF 足以确保下一帧渲染前同步
let resizeObserver: ResizeObserver | null = null;
const stopGridWatch = watch(gridRef, (grid) => {
  // 清理旧 observer
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

// ── 移动触发：同步位置 + 触发 onMove 意图 ──
const stopCurLocWatch = watch(
  () => mapStore.curLoc,
  () => {
    nextTick(() => requestAnimationFrame(() => {
      syncAllPositions();              // 先同步位置
      playerAvatarStore.onMove();      // 再触发 move 意图（intentSeq 递增 → move handler）
    }));
  },
);

// ── actor 列表变化触发：初始挂载 / 区域切换 ──
const stopActorsWatch = watch(
  () => actorsStore.actors,
  () => {
    nextTick(() => requestAnimationFrame(() => syncAllPositions()));
  },
);
```

> **v3 优化说明**：ResizeObserver 回调去掉 `nextTick`。理由：ResizeObserver 在浏览器布局完成后、绘制前触发，此时 DOM 尺寸已是最新；`nextTick`（Vue 微任务）+ `rAF` 会延迟 2 帧才同步，导致缩放时立绘短暂错位。直接 `rAF` 在下一帧渲染前同步即可。`watch(curLoc)` 和 `watch(actors)` 保留 `nextTick` 是因为需要等 Vue 的 v-for DOM 更新完成（cells 重新渲染后才能 querySelector 到新 cell）。

### 4.3 同步所有 actor

```typescript
function syncAllPositions(): void {
  const grid = gridRef.value;
  if (!grid) return;
  for (const actor of actorsStore.actors) {
    const el = actorRefs.get(actor.id);
    if (el) syncActorPosition(el, actor.pls, grid);
  }
}
```

---

## 5. z-index 切换机制

### 5.1 class 切换规则

| 状态 | class | actor z-index | cell z-index | 视觉 |
|------|-------|---------------|--------------|------|
| 倒下（setDown / fall 后） | 无 `.popped` | 0 | 普通 1 / 当前 2 | 被所有 cell 遮挡（含延伸到相邻 cell 的部分） |
| 站立（popUp 回弹开始） | `.popped` | 10 | 普通 1 / 当前 2 | 浮出所有 cell 之上 |

**v3 关键修复**：普通 `.map-cell` 加 `z-index:1`，确保倒下立绘（rotation:-90 延伸到相邻 cell）被所有 cell 遮挡，而非仅被 `.map-cell.current` 遮挡。复刻 demo 的 `#map { z-index:1 }` 整体遮挡效果。

> **与 demo 的差异**：demo 用 `#map { z-index:1 }` 让整个地图容器遮挡 actor；本设计案 actor 与 cells 同级，改为给每个 `.map-cell` 加 `z-index:1` 达到同等效果（任意 cell 都遮挡倒下立绘）。

### 5.2 切换时机

```typescript
// popUp：回弹 tween 的 onStart 加 .popped
tl.to(el, {
  scaleY: 1, scaleX: 1, rotation: 0,
  duration: 0.9,
  ease: 'elastic.out(1, 0.55)',
  onStart: () => el.classList.add('popped'),
  onComplete: () => playerAvatarStore.notifyUp(),
});

// fall：timeline onComplete 移除 .popped
const tl = gsap.timeline({
  onComplete: () => {
    el.classList.remove('popped');
    playerAvatarStore.notifyDown();
  },
});
```

### 5.3 模板绑定

```vue
<div
  class="actor"
  :class="{ popped: actor.id === 'player' ? !playerAvatarStore.isDown : true }"
>
```

直接读 `playerAvatarStore.isDown`，无需中间状态。`!isDown` 为 true 时加 `.popped`（站立时浮出）。未来多角色时改为按 actor.kind 分发。

---

## 6. 动画层

### 6.1 useActors composable（新建 `src/composables/useActors.ts`）

替代 usePlayerAvatar，管理所有 actor 的 DOM 引用、位置同步、GSAP 动画。

```typescript
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

  // ── 阴影 tween 清理（避免重复触发时阴影动画冲突） ──
  function killShadowTweens(el: HTMLElement): void {
    const shadow = el.querySelector('.actor-shadow') as HTMLElement | null;
    if (shadow) gsap.killTweensOf(shadow);
  }

  // ── v3 新增：阴影重置到 idle 状态（popUp 完成时的阴影） ──
  // 用于 move handler：move 打断 fall 时阴影 tween 被 kill 后停在中间状态，
  // 需强制重置到 idle（scale:0.35, alpha:0.12）
  function resetShadowToIdle(el: HTMLElement): void {
    killShadowTweens(el);
    const shadow = el.querySelector('.actor-shadow') as HTMLElement | null;
    if (shadow) {
      gsap.set(shadow, { xPercent: -50, scale: 0.35, alpha: 0.12 });
    }
  }

  // ── 位置同步（§4.1） ──
  function syncActorPosition(actorEl: HTMLElement, pls: string | number, gridEl: HTMLElement): boolean {
    const cell = gridEl.querySelector(`[data-pls="${pls}"]`) as HTMLElement | null;
    if (!cell) return false;

    let offsetX = 0;
    let offsetY = 0;
    let el: HTMLElement | null = cell;
    while (el && el !== gridEl) {
      offsetX += el.offsetLeft;
      offsetY += el.offsetTop;
      el = el.offsetParent as HTMLElement | null;
    }

    gsap.set(actorEl, {
      width: cell.offsetWidth,
      height: cell.offsetHeight,
      x: offsetX + cell.offsetWidth / 2,
      y: offsetY + cell.offsetHeight,
      xPercent: -50,
      yPercent: -100,
    });

    // 阴影初始化（首次同步时设 xPercent，后续动画只改 scale/alpha）
    const shadow = actorEl.querySelector('.actor-shadow') as HTMLElement | null;
    if (shadow && !shadow.dataset.inited) {
      gsap.set(shadow, { xPercent: -50, scale: 1, alpha: 1 });
      shadow.dataset.inited = '1';
    }

    return true;
  }

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
    killShadowTweens(el);
    gsap.set(el, {
      scaleY: 0.04,
      scaleX: 1,
      rotation: -90,
      alpha: 0.25,
    });
    el.classList.remove('popped');
    // 阴影重置到倒地状态（v3：加 xPercent:-50 防止首次同步前阴影偏移）
    const shadow = el.querySelector('.actor-shadow') as HTMLElement | null;
    if (shadow) {
      gsap.set(shadow, { xPercent: -50, scale: 1.2, alpha: 0.5 });
    }
  }

  // v3：开头加 killShadowTweens（防御性，防止阴影 tween 残留）
  function startIdle(el: HTMLElement): void {
    gsap.killTweensOf(el);
    killShadowTweens(el);
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
    killShadowTweens(el);
    const shadow = el.querySelector('.actor-shadow') as HTMLElement | null;
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
    // v3 修复：阴影 tween 加入 timeline，位置参数 0.2（与回弹同时开始）
    // 对照 demo: tl.to(shadow, { scale: 0.35, alpha: 0.12, ... }, 0.2)
    if (shadow) {
      tl.to(shadow, {
        scale: 0.35, alpha: 0.12,
        duration: 0.7, ease: 'power2.out',
      }, 0.2);
    }
  }

  // fall 末尾无 repeat，timeline 能正常完成，notifyDown 挂在 timeline.onComplete
  function fall(el: HTMLElement): void {
    gsap.killTweensOf(el);
    killShadowTweens(el);
    const shadow = el.querySelector('.actor-shadow') as HTMLElement | null;
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
      alpha: 0.25,  // 倒下后保持 0.25 透明（被 z-index:0 遮挡不可见）
      duration: 0.32, ease: 'power2.in',
    });
    // v3 修复：阴影 tween 加入 timeline，位置参数 0.08（与倒下同时开始）
    // 对照 demo: tl.to(shadow, { scale: 1.2, alpha: 0.5, ... }, 0.08)
    if (shadow) {
      tl.to(shadow, {
        scale: 1.2, alpha: 0.5,
        duration: 0.28, ease: 'power2.out',
      }, 0.08);
    }
  }

  // ── 意图 → 动画映射（玩家专用，未来扩展按 kind 分发） ──
  const INTENT_HANDLERS: Record<PlayerAvatarIntent, (el: HTMLElement) => void> = {
    'enter':        (el) => { setDown(el); popUp(el); },
    // v3：move handler 加 resetShadowToIdle，防止 move 打断 fall 时阴影残留
    'move':         (el) => { resetTransform(el); resetShadowToIdle(el); startIdle(el); },
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
        syncAllPositions();
        playerAvatarStore.onMove();
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
      killShadowTweens(el);
    }
    actorRefs.clear();
  }

  return {
    setActorRef,
    syncAllPositions,
    dispose,
  };
}
```

### 6.2 关键设计点

1. **resetTransform/setDown 不动 x/y/width/height**：位置由 syncActorPosition 管理，动画函数只动 scale/rotation/alpha。避免位置被动画覆盖。

2. **killShadowTweens 辅助函数**：popUp/fall/setDown/startIdle 开头 kill 阴影 tween，避免重复触发时阴影动画冲突。

3. **resetShadowToIdle 辅助函数（v3 新增）**：move handler 调用，强制重置阴影到 idle 状态（scale:0.35, alpha:0.12）。防止 move 打断 fall 时阴影停在中间状态。

4. **阴影 transform 由 GSAP 管理**：syncActorPosition 首次同步时 `gsap.set(shadow, { xPercent: -50, scale: 1 })`，后续动画只改 scale/alpha。CSS 不设 transform，避免 GSAP 覆盖 CSS 导致位移丢失。setDown 的阴影 gsap.set 也带 `xPercent: -50`（v3 修复），防止首次同步前 setDown 导致阴影偏移。

5. **阴影 tween 加入 timeline（v3 修复）**：popUp 的阴影 tween 用 `tl.to(shadow, {...}, 0.2)` 加入 timeline（位置 0.2，与回弹同时开始）；fall 的阴影 tween 用 `tl.to(shadow, {...}, 0.08)` 加入 timeline（位置 0.08，与倒下同时开始）。对照 demo 的时序，避免阴影立即开始导致视觉不同步。

6. **HP watch 保留在 MapGrid.vue**：HP 危险/恢复的 watch 逻辑不迁移到 useActors，仍在 MapGrid.vue 内调用 playerAvatarStore.setHpRatio/onLowHp/onNormalHp。

---

## 7. battle.ts 接入（零改动）

现有 5 处接入点全部保留，仍调用 `usePlayerAvatarStore().onXxx()`：

| 接入点 | 行号 | 调用 | 改动 |
|--------|------|------|------|
| enterBattleMode | 204 | onBattleStart() | 无 |
| exitBattleMode | 228 | onBattleEnd() | 无 |
| startBattle | 277 | onBattleStart() | 无 |
| playTurnSegment | 469 | onHit() | 无 |
| playTurnSegment | 481 | onDie() | 无 |
| playBattleEndSegment | 501 | onDie() | 无 |

意图状态机（player-avatar store）不变，动画层（useActors）watch 同一个 intentSeq，无缝衔接。

---

## 8. 调试按钮（零改动）

[MapContainer.vue](file:///d:/wamp64/www/phpdts/vex-vue/src/components/map/MapContainer.vue) 的调试按钮组仍调用 `playerAvatarStore.debugPopUp()` / `debugFall()`，无需改动。

---

## 9. MapGrid.vue 改造要点

### 9.1 script 改造

```typescript
// 移除
import { usePlayerAvatar } from '@/composables/usePlayerAvatar';
const avatarRef = ref<HTMLElement | null>(null);
const avatarAnim = usePlayerAvatar(avatarRef);

// 新增
import { useActors } from '@/composables/useActors';
import { useActorsStore } from '@/stores/actors';
const actorsStore = useActorsStore();
const avatarAnim = useActors(gridRef);  // 复用现有 gridRef
// dispose 重命名为 disposeActors，避免与 onUnmounted 内其他清理逻辑混淆
const { setActorRef, syncAllPositions, dispose: disposeActors } = avatarAnim;

// watch(curLoc) 删除（已迁入 useActors）
// HP watch 保留不变
// onMounted 内：先 syncAllPositions（初始同步保险），再 onEnter
// onUnmounted 改用 disposeActors()
```

**onMounted 关键代码**：
```typescript
onMounted(() => {
  // ... 其他初始化 ...

  // 首次入场：先同步 actor 位置，再触发 enter 意图（动画层会 setDown + popUp）
  // syncAllPositions 作为初始同步保险（ResizeObserver 首次触发可能延迟一帧）
  nextTick(() => {
    syncAllPositions();
    playerAvatarStore.onEnter();
  });
});
```

**onUnmounted 关键代码**：
```typescript
onUnmounted(() => {
  if (cleanupInteraction) {
    cleanupInteraction();
    cleanupInteraction = null;
  }
  disposeActors();
  resetRenderState();
});
```

### 9.2 模板改造

见 §3.1。

### 9.3 style 改造

删除 `:deep(.player-avatar)` 规则。保留 `.map-cell.current` 的背景/边框样式。

---

## 10. 文件变更清单

### 新建（3 个）
- `src/types/actor.ts` — Actor 数据类型
- `src/stores/actors.ts` — actorsStore（actor 列表派生）
- `src/composables/useActors.ts` — 多角色动画 composable（替代 usePlayerAvatar）

### 修改（2 个）
- `src/components/map/MapGrid.vue` — 移除格子内立绘，新增角色层 v-for，改用 useActors，删除 watch(curLoc)（迁入 useActors）
- `src/assets/styles/terminal.css` — `.ascii-map-grid` 加 `position: relative`，`.map-cell` 加 `z-index: 1`（v3），新增 `.actor` / `.actor.popped` / `.actor-img` / `.actor-shadow` 样式

### 删除（1 个）
- `src/composables/usePlayerAvatar.ts` — 逻辑迁入 useActors

### 保留不变（5 个）
- `src/stores/player-avatar.ts` — 玩家意图状态机
- `src/types/player-avatar.ts` — PlayerAvatarIntent 类型（useActors 仍用）
- `src/stores/battle.ts` — 5 处接入零改动
- `src/components/map/MapContainer.vue` — 调试按钮零改动
- `src/composables/useMapRender.ts` — 无需改动（baseSize 变化由 ResizeObserver 间接捕获）

---

## 11. 实施步骤

### 步骤 1：新建类型与 store
1. 创建 `src/types/actor.ts`（§2.1）
2. 创建 `src/stores/actors.ts`（§2.2）

### 步骤 2：新建 useActors composable
1. 创建 `src/composables/useActors.ts`（§6.1）
2. 迁移 usePlayerAvatar 的 GSAP 函数，调整 resetTransform/setDown（移除 xPercent/yPercent）
3. 加位置同步（§4）+ z-index 切换（§5）+ 阴影动画（§6.1 popUp/fall）
4. 加 watch(intentSeq) + watch(curLoc) + watch(actors) + watch(gridRef) + ResizeObserver

### 步骤 3：TypeScript 编译检查
```bash
npx vue-tsc --noEmit
```

### 步骤 4：改造 MapGrid.vue
1. import 改用 useActors + actorsStore
2. 模板移除 cell.isCurrent 内的 `<img>`，新增 actors v-for（§3.1）
3. `<style scoped>` 删除 `:deep(.player-avatar)` 规则
4. 删除 watch(curLoc)（已迁入 useActors）
5. onMounted/onUnmounted 改用 useActors 的 disposeActors

### 步骤 5：CSS 改造
1. terminal.css 的 `.ascii-map-grid` 加 `position: relative`
2. `.map-cell` 加 `z-index: 1`（v3 新增）
3. 新增 `.actor` / `.actor.popped` / `.actor-img` / `.actor-shadow` 样式（§3.2）

### 步骤 6：删除旧文件
1. 删除 `src/composables/usePlayerAvatar.ts`

### 步骤 7：编译与构建验证
```bash
npx vue-tsc --noEmit && npx vite build
```

### 步骤 8：运行时验证
1. 弹起/倒下动画视觉确认（z-index 切换是否遮挡扁平状态）
2. 倒下立绘延伸到相邻 cell 时是否被普通 cell 遮挡（v3 修复点）
3. 移动后立绘位置是否正确同步
4. 缩放后立绘位置是否跟随
5. resize 后立绘位置是否跟随
6. 阴影动画是否同步（popUp 时阴影在 0.2s 开始缩小，fall 时阴影在 0.08s 开始放大）
7. 调试按钮功能是否正常
8. 立绘图片高度是否正确（150% 相对 cell 高度）

---

## 12. 测试要点

| 场景 | 预期 |
|------|------|
| 首次入场 | setDown（被遮挡）→ popUp 回弹 onStart 浮出 → idle 呼吸 |
| 调试"弹" | 同首次入场 |
| 调试"倒" | fall 动画 → onComplete 移除 .popped → 扁平状态被遮挡 |
| 移动 | curLoc 变化 → syncAllPositions（瞬移到新格）→ onMove → move handler（resetTransform + resetShadowToIdle + idle） |
| 缩放（Ctrl+滚轮） | ResizeObserver 触发 → syncAllPositions → 立绘跟随格子尺寸（width/height 重新设置） |
| 窗口 resize | 同上 |
| 玩家受击 | onHit → startIdle（当前映射，未来可改 flinch） |
| 玩家死亡 | onDie → fall → 被遮挡 |
| 连续移动 | intentSeq 递增确保每次 move handler 都触发 |
| 死亡后移动 | dispatchWithRecovery 暂存 move → popUp 恢复 → 执行 move |
| 阴影同步（popUp） | 阴影在 timeline 0.2s 开始缩小变淡（与回弹同时） |
| 阴影同步（fall） | 阴影在 timeline 0.08s 开始放大变深（与倒下同时） |
| move 打断 fall（debug） | fall 期间按"弹"或移动 → 阴影被 killShadowTweens 清理 + resetShadowToIdle 重置 |
| 立绘尺寸 | 立绘高度 = cell 高度 × 150%，缩放时跟随 |
| 倒下立绘遮挡 | rotation:-90 延伸到相邻 cell 的部分被普通 cell（z-index:1）遮挡 |

---

## 13. 风险与回滚

### 13.1 风险表

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| ResizeObserver 在某些浏览器行为不一致 | 低 | 立绘位置不同步 | 回退到 watch baseSize（需 useMapRender 导出 baseSize） |
| offsetParent 链中断（cell 的 offsetParent 不是 grid） | 中 | 位置计算错误 | 用 getBoundingClientRect 作回退方案 |
| z-index 切换时序与 GSAP onStart 不一致 | 低 | 扁平状态闪现 | onStart 在 delay 后第一帧前触发，实测足够 |
| actor absolute 定位干扰 grid 布局 | 低 | grid 错位 | position:absolute 脱离 grid 流，已验证 |
| 阴影 GSAP scale 覆盖位移 | 中 | 阴影位置偏移 | GSAP 初始化设 xPercent:-50，动画只改 scale（§6.1 已处理） |
| 立绘 height:150% 相对 actor 为 0 | 高 | 图片不可见 | syncActorPosition 设 actor width/height 等于 cell（§4.1 已处理） |
| killTweensOf 不 kill 阴影 tween | 中 | 重复触发阴影动画冲突 | popUp/fall/setDown/startIdle 开头调 killShadowTweens（§6.1 已处理） |
| move 打断 fall 阴影残留 | 中 | 阴影停在中间状态 | move handler 调 resetShadowToIdle（§6.1 已处理） |
| 普通 cell z-index:1 影响其他 cell 层叠 | 低 | 视觉异常 | 已验证：current z-index:2 仍高于普通，actor z-index:0/10 切换正常 |

### 13.2 回滚方案

若路径 1 出现严重问题，回滚步骤：
1. 恢复 MapGrid.vue 的 cell.isCurrent 内 `<img>` 立绘
2. 恢复 usePlayerAvatar composable
3. 删除 actorsStore / useActors / actor.ts
4. 恢复 terminal.css（移除 .actor 样式，#mapGrid 移除 position:relative，.map-cell 移除 z-index:1）

player-avatar store 和 battle.ts 全程未改，回滚无风险。

---

## 14. 未来扩展：NPC / 敌怪小人

### 14.1 扩展步骤

1. **数据源**：在 actorsStore.actors computed 内取消注释敌人/NPC 部分，从 mapStore.enemies 派生
2. **立绘素材**：准备 `/img/enemy_{icon}.png` 等素材
3. **意图状态机**：
   - 简单方案：actorsStore 内为每个 actor 维护独立 intent/isDown（Map<id, ActorState>）
   - 复杂方案：新建 enemy-avatar store / npc-avatar store
4. **动画层**：useActors 的 INTENT_HANDLERS 按 actor.kind 分发（player/enemy/npc 各一套 handler）
5. **事件接入**：battle.ts 的 combatant_cleared 判定敌人死亡时，调敌人的 onDie()
6. **模板 .popped**：改为按 actor.id 读对应 store 的 isDown

### 14.2 战斗互动预留

所有 actor 在同一层叠上下文（#mapGrid 内），未来可做：
- 玩家前冲攻击：tween player actor 的 x/y 朝向 enemy actor
- 敌人受击后退：tween enemy actor 的 x/y 反向
- 层次控制：战斗时动态调整 z-index（玩家在前）

**注意**：未来位置 tween 会被 popUp/fall 的 `gsap.killTweensOf(el)` 打断。届时需改用命名 tween 或 timeline 管理，避免冲突。当前 move 用 set（非 tween），无此问题。

数据已就绪（actors 列表含所有 actor 的 pls），架构零阻碍。

---

## 附录 A：v1 → v2 修复清单

| # | 问题 | 修复 |
|---|------|------|
| 1 | actor width/height 为 0 导致 img height:150% 失效 | syncActorPosition 设 actor width/height 等于 cell 尺寸 |
| 2 | move handler 不触发（watch curLoc 调 requestSync 而非 onMove） | watch curLoc 改为调 syncAllPositions + playerAvatarStore.onMove() |
| 3 | ResizeObserver 用 watchEffect 会重复创建不 disconnect | 改用 watch(gridRef) + 手动 disconnect 旧 observer |
| 4 | actorIsDown 函数未定义 | 模板直接用 `actor.id === 'player' ? !playerAvatarStore.isDown : true` |
| 5 | 阴影 GSAP scale 覆盖 CSS translateX(-50%) | GSAP 初始化设 xPercent:-50，CSS 不设 transform |
| 6 | 双重 isDown 状态冗余 | 删除 actorsStore.playerIsDown，模板直接读 playerAvatarStore.isDown |
| 7 | HP watch 迁移但 useActors 无 playerStore | HP watch 保留在 MapGrid.vue，不迁移 |
| 8 | 文件清单矛盾（useMapRender 既是修改又无需改动） | useMapRender 从修改列表移除 |
| 9 | requestSync/syncSeq 死代码 | 删除，watch(curLoc) 直接调 syncAllPositions |
| 10 | killTweensOf 不 kill 阴影 tween | 新增 killShadowTweens 辅助函数，popUp/fall/setDown 开头调用 |

---

## 附录 B：v2 → v3 修复清单

| # | 问题 | 严重度 | 修复 |
|---|------|--------|------|
| 1 | 普通 `.map-cell` 无 z-index（auto=0），倒下立绘延伸到相邻 cell 时未被遮挡 | 严重 | `.map-cell` 加 `z-index:1`，复刻 demo 的 `#map { z-index:1 }` 整体遮挡效果 |
| 2 | popUp 阴影动画用独立 `gsap.to(shadow)` 立即开始（0s），demo 是 `tl.to(shadow, {...}, 0.2)` 在 timeline 0.2s 开始 | 重要 | 改为 `tl.to(shadow, {...}, 0.2)` 加入 timeline，与回弹同时开始 |
| 3 | fall 阴影动画用独立 `gsap.to(shadow)` 立即开始（0s），demo 是 `tl.to(shadow, {...}, 0.08)` 在 timeline 0.08s 开始 | 重要 | 改为 `tl.to(shadow, {...}, 0.08)` 加入 timeline，与倒下同时开始 |
| 4 | move handler 缺阴影处理：move 打断 fall（debug 场景）时阴影 tween 被 kill 后停在中间状态 | 重要 | 新增 `resetShadowToIdle` 辅助函数，move handler 调用重置阴影到 idle 状态 |
| 5 | startIdle 只 killTweensOf(el) 不 kill 阴影 tween，阴影 tween 可能残留 | 小 | startIdle 开头加 `killShadowTweens(el)` |
| 6 | setDown 阴影 gsap.set 不设 xPercent:-50，首次同步前 setDown 会导致阴影偏移 | 健壮性 | setDown 阴影 gsap.set 加 `xPercent: -50` |
| 7 | ResizeObserver 回调 `nextTick(() => rAF(...))` 延迟 2 帧，缩放时立绘短暂错位 | 优化 | 简化为 `requestAnimationFrame(() => syncAllPositions())`，去掉 nextTick |
| 8 | §9.1 文档与实现偏差：dispose 重命名、onMounted 内 syncAllPositions 未提及 | 文档 | §9.1 更新为 `dispose: disposeActors` + onMounted 内 `syncAllPositions()` |

---

## 附录 C：与 demo 的对照

| demo 实现 | 本设计案实现 |
|-----------|------------|
| `#actor` z-index:0/10 切换 | `.actor` / `.actor.popped` class 切换 |
| `#map { z-index:1 }` 整体遮挡 actor | `.map-cell { z-index:1 }` 每个 cell 遮挡 actor（v3 对齐） |
| `setActorDown` 用绝对坐标 x/y | `syncActorPosition` 用 offsetLeft/offsetTop 计算 + 设 width/height |
| 独立 `#shadow` 元素 | `.actor-shadow` 子元素，GSAP 管理 transform |
| popUp onStart 加 `popped` class | 同 |
| fall onComplete 移除 `popped` + setActorDown | 同（notifyDown 联动 store） |
| popUp 阴影 `tl.to(shadow, {...}, 0.2)` | 同（v3 对齐，v2 是独立 gsap.to 立即开始） |
| fall 阴影 `tl.to(shadow, {...}, 0.08)` | 同（v3 对齐，v2 是独立 gsap.to 立即开始） |
| 静态地图（不缩放不平移） | 动态地图（ResizeObserver + watch 适配缩放/移动） |
| actor 尺寸固定 96×96 | actor 尺寸动态等于 cell（syncActorPosition 设置） |
