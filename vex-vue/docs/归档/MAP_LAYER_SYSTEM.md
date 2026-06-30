# 地图分层系统设计案（MAP_LAYER_SYSTEM）v2

> 将散落的 z-index 硬编码升级为语义化分层架构，支持 NPC / POI 立绘 / 草丛遮挡 / 蠕虫钻出 / 地面裂隙等多实体多层级需求。
>
> **v2 修订要点**：
> - 删除所有独立阴影元素相关代码（已由 `.actor-img` 的 CSS `drop-shadow` 替代）
> - 修正 `battle.ts` 接入点数量（5 → 6）
> - 补全 `useActors` 四路 watch（漏列 `intentSeq`）
> - 拆分 `syncEntityPosition`（位置同步）与 `updateEntityZIndex`（z-index 更新）职责
> - 明确 `entities` computed 不依赖 `playerAvatarStore.isDown`，避免不必要的重算
> - 修正 Y 排序基址上限（`yZ ≤ 99`，确保 `< 2000`）
> - 明确 `.popped` CSS 类完全删除，z-index 全部由 JS 控制
> - 明确 NPC 初版无 intent 状态，`playerAvatarStore` 单例不共用
> - 标注 POI/草丛/蠕虫/裂隙场景为"未来推测，后端尚未实现"

---

## 0. 当前实现状态（基线）

本设计案基于以下已实现代码（修订基线）：

| 文件 | 状态 | 关键内容 |
|------|------|---------|
| `composables/useActors.ts` | ✅ 已实现 | 多 actor 动画层，四路 watch，250 行 |
| `stores/actors.ts` | ✅ 已实现 | actors computed 派生自 mapStore，仅含 player |
| `stores/player-avatar.ts` | ✅ 已实现 | 玩家意图状态机，intentSeq + pendingIntent 回调链 |
| `types/actor.ts` | ✅ 已实现 | ActorKind + Actor 接口 |
| `types/player-avatar.ts` | ✅ 已实现 | PlayerAvatarIntent 11 种意图 |
| `components/map/MapGrid.vue` | ✅ 已实现 | actors v-for + :class="{ popped: !isDown }" |
| `components/map/MapContainer.vue` | ✅ 已实现 | 调试按钮直调 playerAvatarStore |
| `assets/styles/terminal.css` | ✅ 已实现 | .actor / .actor.popped / .actor-img（drop-shadow） |
| `stores/battle.ts` | ✅ 已实现 | 6 处接入 playerAvatarStore（line 204/228/277/469/481/501） |

**已废弃**：`usePlayerAvatar.ts`（已删除）、独立阴影元素 `.actor-shadow`（已删除）、`player:popup`/`player:fall` 事件（已从 events.ts 移除）。

---

## 1. 背景与问题

### 1.1 当前现状

当前 `#mapGrid` 内部 z-index 散落硬编码（见 `terminal.css`）：

| 元素 | z-index | 来源 | 说明 |
|------|---------|------|------|
| `.actor`（倒下/扁平） | -1 | terminal.css | 被 `.map-background`(0) 遮挡 |
| `.map-background` | 0 | terminal.css | 地面背景层 |
| `.map-cell` | 1 | terminal.css | 普通地图格 |
| `.map-cell.current` | 2 | terminal.css | 当前格高亮 |
| `.actor.popped`（站立） | 10 | terminal.css | 浮出 cells 之上 |

### 1.2 核心问题

1. **z-index 魔法数字散落**：新增层时手动计算数值，易冲突
2. **无 Y 轴深度排序**：POI 大楼、NPC、玩家同屏时无法判断谁遮谁
3. **无多格实体支持**：蠕虫占 4 格，当前 `syncActorPosition` 只支持单格
4. **无地面叠加层**：裂隙效果无处安放
5. **实体类型单一**：`useActors` 只管 actor，无法扩展 POI/草丛/裂隙

### 1.3 设计目标

- 建立语义化 z-index 层级表（CSS 变量集中管理）
- 支持 Y 轴深度排序（2D 伪 3D 效果）
- 支持多格实体（蠕虫占 4 格）
- 支持地面叠加效果（裂隙）
- `useActors` 泛化为 `useMapEntities`，统一管理所有地图实体

### 1.4 适用范围

- **本设计案 v2 阶段 1-2**：基于已实现代码的可执行重构，行为不变
- **阶段 3+ 场景**（POI/草丛/蠕虫/裂隙）：**未来推测**，oblivions 后端 DESIGN.md/CODEBASE.md 尚无对应概念。本设计案提供接口预留，实际实现时需与后端协同设计数据契约

---

## 2. 需求场景分析

### 2.1 场景清单

> ⚠️ 标注"未来"的场景均为设计推测，后端尚未实现。

| 场景 | 实体类型 | 层级需求 | 遮挡关系 | 状态 |
|------|---------|---------|---------|------|
| 玩家/NPC 立绘 | actor | 角色层 | 与玩家同层，Y 排序 | ✅ 玩家已实现 / 📋 NPC 未来 |
| POI 废弃大楼 | poi | 角色层（Y 排序） | 立绘向上延伸，actor 走到前方遮挡大楼下部 | 📋 未来 |
| 草丛 | grass | 角色层（Y 排序） | 遮挡同格 actor 下半身（图片高度只到腰部） | 📋 未来 |
| 大蠕虫 | worm | 角色层（Y 排序） | 占 4 格，从裂隙钻出，z-index 切换 | 📋 未来 |
| 地面裂隙 | crevice | 地面装饰层 | 透明 PNG 叠加在地面背景之上，低于角色 | 📋 未来 |

### 2.2 关键洞察

**草丛遮挡下半身**：不拆分 actor，草丛作为独立 DOM 元素，z-index 高于 actor，但**图片视觉高度只到 actor 腰部**（bottom 对齐）。z-index 决定"谁在前面"，视觉遮挡只发生在图片覆盖区域 → 草丛只遮下半身。

**POI 大楼伪 3D**：大楼与 actor 同层 Y 排序。actor 走到大楼前方（Y 更大）时 z-index 更高，遮挡大楼。但 actor 立绘只向上延伸 150% cell，大楼可能 300% cell，重叠区域只在大楼下部 → actor 只遮大楼下部，大楼上部仍可见。

**蠕虫钻出**：裂隙先出现（地面装饰层，低于角色），蠕虫从裂隙位置 popUp（角色层 z-index 切换，复用现有 popUp/fall 动画）。

---

## 3. 分层架构

### 3.1 z-index 层级表

采用"固定层 + Y 排序层"混合架构：

```
═══ 固定层（不参与 Y 排序）═══
  -1  actor-down      角色倒下状态（被 ground-bg 遮挡）
   0  ground-bg       地面背景层（map-background）
   1  cell            地图格层（沿用现状）
   2  cell-current    当前格（沿用现状）
   3  ground-deco     地面装饰层（裂隙、地面花纹，未来引入）

═══ Y 排序层（z-index = 1000 + yZ*10 + tiebreaker，yZ ∈ [0, 99]）═══
 1000+  poi / actor / grass / worm
        按 Y 坐标动态排序，同格时按 tiebreaker 决定前后

═══ 固定层（在 Y 排序之上）═══
2000  air-occluder   空中遮挡物（树冠、屋顶，未来引入）
3000  overlay-ui     顶层 UI
```

**与现状的差异**：
- 阶段 1：保持 `cell=1` / `cell-current=2` 不变（沿用现状），仅引入 `ground-deco=3` 占位（无实体）
- 阶段 2：引入 Y 排序层，`.actor.popped` 的 z-index 从硬编码 `10` 改为 JS 动态计算 `1000+`
- 阶段 3：引入 `ground-deco` 实体（裂隙）和 `air-occluder` 实体

### 3.2 Y 排序算法

```typescript
const Y_SORT_BASE = 1000;
const Y_SORT_STRIDE = 10;  // 每格 10 个 tiebreaker 槽位
const Y_SORT_MAX_YZ = 99;  // 最大 Y 格数（1000 + 99*10 + 9 = 1099 < 2000）

// 同格 tiebreaker：数值越大越靠前（遮挡数值小的）
const TIEBREAKER: Record<EntityKind, number> = {
  'poi':    0,  // 建筑最底（actor 走到前方遮挡大楼下部）
  'actor':  5,  // 角色（遮挡同格 poi 下部）
  'grass':  8,  // 草丛（遮挡同格 actor 下半身）
  'worm':   9,  // 蠕虫（怪物在角色前方）
};
```

**z-index 计算函数**：

```typescript
function computeZIndex(
  entity: MapEntity,
  isDown: boolean,
  yBottom: number,
  cellH: number
): number {
  // 角色倒下：固定 -1，被 ground-bg(0) 遮挡
  if (entity.kind === 'actor' && isDown) return -1;

  // 参与 Y 排序的实体
  if (entity.kind in TIEBREAKER) {
    const yZ = Math.min(Math.floor(yBottom / cellH), Y_SORT_MAX_YZ);
    return Y_SORT_BASE + yZ * Y_SORT_STRIDE + TIEBREAKER[entity.kind];
  }

  // 固定层
  return FIXED_LAYER_Z[entity.layer];
}
```

### 3.3 遮挡关系验证

**同格场景**（yZ 相同）：
- actor(1000+yZ*10+5) > poi(1000+yZ*10+0) → actor 遮挡大楼下部 ✓
- grass(1000+yZ*10+8) > actor(1000+yZ*10+5) → 草丛遮挡 actor 下半身 ✓
- worm(1000+yZ*10+9) > actor(1000+yZ*10+5) → 蠕虫遮挡 actor ✓

**跨格场景**（草丛在 actor 后方一格）：
- grass z-index = 1000 + (yZ-1)*10 + 8 = 998 + yZ*10
- actor z-index = 1000 + yZ*10 + 5 = 1005 + yZ*10
- grass < actor → 草丛被 actor 遮挡 ✓（后方草丛不遮挡前方 actor）

**跨格场景**（草丛在 actor 前方一格）：
- grass z-index = 1000 + (yZ+1)*10 + 8 = 1018 + yZ*10
- actor z-index = 1005 + yZ*10
- grass > actor → 草丛遮挡 actor ✓（但草丛与 actor 立绘不重叠，视觉上不遮挡）

---

## 4. 实体数据模型

### 4.1 类型定义

```typescript
// types/map-entity.ts

/** 地图实体类型 */
export type EntityKind = 'actor' | 'poi' | 'grass' | 'crevice' | 'worm';

/** 实体层级（用于固定层分配） */
export type EntityLayer =
  | 'ground-deco'      // 地面装饰层（裂隙）
  | 'air-occluder'     // 空中遮挡层（预留）
  | 'y-sorted';        // 参与 Y 排序的层（actor/poi/grass/worm）

/** 地图实体数据 */
export interface MapEntity {
  /** 唯一 ID */
  id: string;
  /** 实体类型 */
  kind: EntityKind;
  /** 锚点格位置 ID（pls） */
  pls: string | number;
  /** 立绘图片 URL */
  img: string;
  /** 水平跨度（占几格宽，默认 1） */
  spanCols?: number;
  /** 垂直跨度（占几格高，默认 1） */
  spanRows?: number;
  /** 立绘相对 cell 高度的比例（默认 actor=1.5, poi=3, grass=0.5, worm=2） */
  imgHeightRatio?: number;

  // ── actor 特有 ──
  /** actor 子类型 */
  actorKind?: 'player' | 'npc' | 'enemy';
  // 注：isDown 不作为 MapEntity 字段
  // 玩家 actor 的 isDown 从 playerAvatarStore.isDown 实时读取
  // NPC/敌人在初版无 isDown 状态（无 popUp/fall 动画）
}
```

**关键修订（v2）**：
- **移除 `isDown` 字段**：避免 `entities` computed 依赖 `playerAvatarStore.isDown` 导致不必要的重算
- 玩家 actor 的 `isDown` 在 `updateEntityZIndex` 中实时从 `playerAvatarStore.isDown` 读取
- NPC/敌人初版无倒下状态，未来扩展时再决定数据源

### 4.2 默认参数表

| kind | spanCols | spanRows | imgHeightRatio | 层级 |
|------|----------|----------|----------------|------|
| actor (player/npc/enemy) | 1 | 1 | 1.5 | y-sorted |
| poi | 1 | 1 | 3.0 | y-sorted |
| grass | 1 | 1 | 0.5 | y-sorted |
| worm | 2 | 2 | 2.0 | y-sorted |
| crevice | 2 | 2 | 1.0 | ground-deco |

---

## 5. 位置同步与 z-index 更新系统（useMapEntities）

### 5.1 职责分离（v2 修订）

**核心修订**：将原 `syncEntityPosition` 拆分为两个独立函数：

| 函数 | 职责 | 触发时机 |
|------|------|---------|
| `syncEntityPosition` | 位置 + 尺寸（x/y/xPercent/yPercent/width/height） | 缩放/resize/移动/实体列表变化 |
| `updateEntityZIndex` | z-index（基于 isDown + yBottom + cellH） | isDown 变化 + 位置同步后 |

**原因**：`isDown` 变化时只需更新 z-index，无需重新计算位置；若两者耦合，`isDown` 变化会触发 `syncAllPositions` 浪费计算。

### 5.2 syncEntityPosition（仅位置/尺寸）

```typescript
function syncEntityPosition(el: HTMLElement, entity: MapEntity, grid: HTMLElement): boolean {
  const cell = grid.querySelector(`[data-pls="${entity.pls}"]`) as HTMLElement | null;
  if (!cell) return false;

  // 累加 offsetLeft/offsetTop 计算 cell 相对 grid 偏移
  let offsetX = 0;
  let offsetY = 0;
  let node: HTMLElement | null = cell;
  while (node && node !== grid) {
    offsetX += node.offsetLeft;
    offsetY += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }

  const cellW = cell.offsetWidth;
  const cellH = cell.offsetHeight;
  const spanCols = entity.spanCols ?? 1;
  const spanRows = entity.spanRows ?? 1;

  // 实体容器尺寸 = cell 尺寸 × 跨度
  // 实体定位到锚点格底部居中
  gsap.set(el, {
    width: cellW * spanCols,
    height: cellH * spanRows,
    x: offsetX + cellW * spanCols / 2,  // 中心 X
    y: offsetY + cellH * spanRows,      // 底部 Y
    xPercent: -50,
    yPercent: -100,
  });

  // 位置同步后立即更新 z-index（确保 yBottom 变化反映到 z-index）
  updateEntityZIndex(el, entity, offsetY + cellH * spanRows, cellH);

  return true;
}
```

### 5.3 updateEntityZIndex（仅 z-index）

```typescript
function updateEntityZIndex(
  el: HTMLElement,
  entity: MapEntity,
  yBottom: number,
  cellH: number
): void {
  // 玩家 actor 的 isDown 从 playerAvatarStore 实时读取
  // NPC/敌人在初版无 isDown 状态（视为 false）
  const isDown = entity.kind === 'actor' && entity.actorKind === 'player'
    ? playerAvatarStore.isDown
    : false;

  el.style.zIndex = String(computeZIndex(entity, isDown, yBottom, cellH));
}
```

### 5.4 z-index 实时更新（popUp/fall 动画切换）

actor 的 `isDown` 状态变化时（popUp/fall 动画切换），需实时更新 z-index：

- `popUp` 回弹 `onStart`：`el.classList.add('popped')` → **改为** 直接 `el.style.zIndex = 站立值`
- `fall` `onComplete`：`el.classList.remove('popped')` → **改为** 直接 `el.style.zIndex = '-1'`

**实现**（v2 修订，删除 .popped 类操作）：

```typescript
// popUp 回弹 onStart（第三个 tween）
onStart: () => {
  // z-index 切换到站立值（y-sorted）
  // yBottom 和 cellH 由 syncEntityPosition 缓存或重新计算
  const yBottom = el.dataset._yBottom ? Number(el.dataset._yBottom) : 0;
  const cellH = el.dataset._cellH ? Number(el.dataset._cellH) : 0;
  const yZ = Math.min(Math.floor(yBottom / cellH), Y_SORT_MAX_YZ);
  el.style.zIndex = String(Y_SORT_BASE + yZ * Y_SORT_STRIDE + TIEBREAKER['actor']);
}

// fall onComplete
onComplete: () => {
  el.style.zIndex = '-1';  // 倒下被 ground-bg 遮挡
  playerAvatarStore.notifyDown();
}
```

**关键时序**（沿用现有实现）：
- popUp 是三阶段动画：alpha 淡入 → 下沉蓄力 → 回弹（z-index 在第三阶段 onStart 切换）+ idle 循环
- fall 是两阶段动画：倾斜蓄力 → 倒下（z-index 在 timeline.onComplete 切回 -1）

### 5.5 syncAllPositions（遍历所有实体）

```typescript
function syncAllPositions(): void {
  const grid = gridRef.value;
  if (!grid) return;
  for (const entity of entitiesStore.entities) {
    const el = entityRefs.get(entity.id);
    if (el) syncEntityPosition(el, entity, grid);
  }
}
```

### 5.6 触发同步的四路 watch（沿用 useActors 设计，v2 补全）

> **v2 修订**：原设计案漏列 `intentSeq` watch，实际 `useActors` 有四路 watch。

| watch | 触发时机 | 调用 |
|-------|---------|------|
| `watch(gridRef)` + ResizeObserver | 缩放/resize | `syncAllPositions()` |
| `watch(mapStore.curLoc)` | 移动 | `syncAllPositions()` + `playerAvatarStore.onMove()` |
| `watch(entitiesStore.entities)` | 初始挂载/区域切换 | `syncAllPositions()` |
| `watch(playerAvatarStore.intentSeq)` | 意图派发 | `INTENT_HANDLERS[intent](el)` |

**额外 watch（v2 新增）**：isDown 变化时单独更新 z-index

```typescript
// isDown 变化时只需更新 z-index，无需重新同步位置
const stopIsDownWatch = watch(
  () => playerAvatarStore.isDown,
  () => {
    nextTick(() => {
      const el = entityRefs.get('player');
      if (!el) return;
      const yBottom = el.dataset._yBottom ? Number(el.dataset._yBottom) : 0;
      const cellH = el.dataset._cellH ? Number(el.dataset._cellH) : 0;
      if (yBottom && cellH) {
        updateEntityZIndex(el, playerEntity, yBottom, cellH);
      }
    });
  }
);
```

---

## 6. 场景实现方案

### 6.1 玩家/NPC actor

**数据**：`entitiesStore.entities` 包含 `{ kind: 'actor', actorKind: 'player', pls, img, imgHeightRatio: 1.5 }`

**渲染**：与当前实现一致，`<div class="entity entity-actor">` + img（无阴影元素）

**动画**：沿用 useActors 的 popUp/fall/startIdle，z-index 切换改为动态计算（删除 .popped 类操作）

**NPC 扩展（v2 修订）**：
- **初版**：NPC 只渲染立绘，无 intent 状态，无 popUp/fall 动画（z-index 固定为 y-sorted 站立值）
- **未来扩展**：`playerAvatarStore` 是单例（含单一 isDown/intent 状态），多 NPC 无法共用
  - 方案 A：新增 `npcAvatarsStore`（按 id 索引的 intent 状态机）
  - 方案 B：泛化 `playerAvatarStore` 为 `actorsAvatarStore`（按 actor id 索引）
  - 方案选择推迟到实际需要时

### 6.2 POI 大楼立绘（未来场景）

**数据**：`{ kind: 'poi', pls, img, imgHeightRatio: 3.0 }`

**渲染**：
```html
<div class="entity entity-poi" :data-entity-id="entity.id">
  <img class="entity-img" :src="entity.img" :style="imgStyle(entity)" />
</div>
```

**CSS**：
```css
.entity-poi {
  position: absolute;
  left: 0; top: 0;
  pointer-events: none;
  transform-origin: bottom center;
}
.entity-poi .entity-img {
  position: absolute;
  left: 50%;
  bottom: 0;
  width: auto;
  transform: translateX(-50%);
}
```

**z-index**：Y 排序，tiebreaker=0。actor 走到大楼格时 actor(5) > poi(0)，actor 遮挡大楼下部。大楼上部（超过 actor 立绘 150% 的部分）仍可见。

### 6.3 草丛遮挡下半身（未来场景）

**数据**：`{ kind: 'grass', pls, img, imgHeightRatio: 0.5 }`

**渲染**：
```html
<div class="entity entity-grass" :data-entity-id="entity.id">
  <img class="entity-img" :src="entity.img" :style="imgStyle(entity)" />
</div>
```

**CSS**：
```css
.entity-grass {
  position: absolute;
  left: 0; top: 0;
  pointer-events: none;
  transform-origin: bottom center;
}
.entity-grass .entity-img {
  position: absolute;
  left: 50%;
  bottom: 0;
  width: auto;
  transform: translateX(-50%);
}
```

**z-index**：Y 排序，tiebreaker=8。同格时 grass(8) > actor(5)，草丛遮挡 actor 下半身。但草丛图片只到 actor 腰部（50% cell），视觉上只遮下半身。

### 6.4 蠕虫钻出 + 裂隙（未来场景）

**数据**：
- 裂隙：`{ kind: 'crevice', pls, img, spanCols: 2, spanRows: 2, imgHeightRatio: 1.0 }`
- 蠕虫：`{ kind: 'worm', pls, img, spanCols: 2, spanRows: 2, imgHeightRatio: 2.0 }`

**渲染**（v2 修订，删除蠕虫的阴影元素）：
```html
<!-- 裂隙（ground-deco 层，固定 z-index:3） -->
<div class="entity entity-crevice" :data-entity-id="entity.id">
  <img class="entity-img" :src="entity.img" :style="imgStyle(entity)" />
</div>

<!-- 蠕虫（y-sorted 层，无阴影元素） -->
<div class="entity entity-worm" :data-entity-id="entity.id">
  <img class="entity-img" :src="entity.img" :style="imgStyle(entity)" />
</div>
```

**钻出动画时序**：
1. 裂隙淡入（ground-deco 层，z-index:3，低于角色 y-sorted 1000+）
2. 蠕虫 setDown（z-index:-1，被 ground-bg 遮挡，不可见）
3. 蠕虫 popUp（z-index 切换到 y-sorted，从裂隙位置弹出）

**CSS**：
```css
.entity-crevice {
  position: absolute;
  left: 0; top: 0;
  pointer-events: none;
  /* z-index 由 syncEntityPosition 动态设置（固定 3） */
}
.entity-crevice .entity-img {
  position: absolute;
  left: 0; top: 0;
  width: 100%;
  height: 100%;
  /* 透明 PNG，叠加在地面之上 */
}
.entity-worm {
  position: absolute;
  left: 0; top: 0;
  pointer-events: none;
  transform-origin: bottom center;
}
.entity-worm .entity-img {
  position: absolute;
  left: 50%;
  bottom: 0;
  width: auto;
  transform: translateX(-50%);
}
```

---

## 7. CSS 改造

### 7.1 z-index 层级表（CSS 变量）

在 `terminal.css` 顶部定义：

```css
:root {
  /* ── 固定层 ── */
  --z-actor-down:     -1;
  --z-ground-bg:       0;
  --z-cell:            1;   /* 沿用现状，不改为 2 */
  --z-cell-current:    2;   /* 沿用现状，不改为 3 */
  --z-ground-deco:     3;   /* 未来引入（裂隙） */
  /* ── Y 排序层（1000+，由 JS 动态设置）── */
  /* ── 固定层（在 Y 排序之上）── */
  --z-air-occluder: 2000;
  --z-overlay-ui:   3000;
}
```

**v2 修订**：`--z-cell` 保持 1（沿用现状），`--z-cell-current` 保持 2，避免阶段 1 改变现有 z-index 行为。

### 7.2 现有元素改造

```css
/* 背景层 */
.map-background {
  z-index: var(--z-ground-bg);  /* 0 */
}

/* 地图格（沿用现状，仅改用变量） */
.map-cell {
  z-index: var(--z-cell);  /* 1 */
}
.map-cell.current {
  z-index: var(--z-cell-current);  /* 2 */
}

/* 角色（倒下状态） */
.actor {
  z-index: var(--z-actor-down);  /* -1，倒下被 ground-bg 遮挡 */
}
/* 站立状态 z-index 由 JS 动态设置（1000+），删除 .actor.popped 规则 */
```

**v2 修订**：
- 删除 `.actor.popped { z-index: 10 }` 规则
- z-index 全部由 JS 通过 `el.style.zIndex` 控制
- `MapGrid.vue` 模板删除 `:class="{ popped: ... }"` 绑定

### 7.3 新增实体样式

```css
/* 通用实体容器 */
.entity {
  position: absolute;
  left: 0;
  top: 0;
  pointer-events: none;
  transform-origin: bottom center;
  will-change: transform, opacity;
}

/* 地面装饰层实体（裂隙等） */
.entity-ground-deco {
  z-index: var(--z-ground-deco);  /* 3 */
}

/* Y 排序实体 z-index 由 JS 动态设置，CSS 不设 z-index */
.entity-actor,
.entity-poi,
.entity-grass,
.entity-worm {
  /* z-index 由 syncEntityPosition/updateEntityZIndex 动态设置 */
}

/* 实体立绘通用 */
.entity-img {
  position: absolute;
  left: 50%;
  bottom: 0;
  width: auto;
  transform: translateX(-50%);
  image-rendering: auto;
  filter:
    drop-shadow( 1px  0 0 #fff)
    drop-shadow(-1px  0 0 #fff)
    drop-shadow( 0  1px 0 #fff)
    drop-shadow( 0 -1px 0 #fff)
    drop-shadow(0 4px 4px rgba(0, 0, 0, 0.6));
}
```

**注**：`drop-shadow` 滤镜沿用现有 `.actor-img` 实现，所有实体立绘共享。

---

## 8. 实体 Store（entitiesStore）

### 8.1 替代 actorsStore

```typescript
// stores/entities.ts
import { defineStore } from 'pinia';
import { computed } from 'vue';
import { useMapStore } from '@/stores/map';
import type { MapEntity } from '@/types/map-entity';

export const useEntitiesStore = defineStore('entities', () => {
  const mapStore = useMapStore();

  // ── 所有地图实体（响应式，从 mapStore 派生） ──
  // 注：不依赖 playerAvatarStore.isDown，避免 isDown 变化触发 entities 重算
  // 玩家 actor 的 isDown 在 updateEntityZIndex 中实时读取
  const entities = computed<MapEntity[]>(() => {
    const list: MapEntity[] = [];

    // 玩家 actor
    if (mapStore.curLoc !== null && mapStore.curRegion !== null) {
      list.push({
        id: 'player',
        kind: 'actor',
        actorKind: 'player',
        pls: mapStore.curLoc,
        img: '/img/4.png',
        imgHeightRatio: 1.5,
      });
    }

    // 未来：NPC / 敌人 / POI / 草丛 / 蠕虫 / 裂隙
    // 各自从 mapStore 数据派生，push 到 list

    return list;
  });

  return { entities };
});
```

### 8.2 与 playerAvatarStore 的关系（v2 明确）

| Store | 职责 | 数据 |
|-------|------|------|
| `entitiesStore` | 实体数据（位置、类型、图片） | `entities` computed（从 mapStore 派生） |
| `playerAvatarStore` | 玩家 actor 意图/动画状态 | `intent`/`intentSeq`/`isDown`/`pendingIntent`/`hpRatio` |

**关键**：
- `entitiesStore.entities` **不依赖** `playerAvatarStore.isDown`
- 玩家 actor 的 `isDown` 在 `updateEntityZIndex` 中实时从 `playerAvatarStore.isDown` 读取
- `watch(playerAvatarStore.isDown)` 单独触发 `updateEntityZIndex`（不触发 `syncAllPositions`）

---

## 9. MapGrid.vue 改造

### 9.1 模板（v2 修订，删除 .popped 类绑定）

```vue
<div id="mapGrid" ref="gridRef" class="ascii-map-grid" :style="gridStyle">
  <!-- 背景层 -->
  <div class="map-background"></div>

  <!-- 数据不可用时显示占位 -->
  <div v-if="cells.length === 0" class="error">{{ placeholderText }}</div>

  <!-- 地图格 -->
  <div v-for="cell in cells" ...>...</div>

  <!-- 实体层：所有地图实体（actor/poi/grass/crevice/worm） -->
  <!-- v2：删除 :class="{ popped: ... }" 绑定，z-index 由 JS 动态设置 -->
  <div
    v-for="entity in entitiesStore.entities"
    :key="entity.id"
    :ref="el => setEntityRef(entity.id, el as HTMLElement | null)"
    class="entity"
    :class="`entity-${entity.kind}`"
    :data-entity-id="entity.id"
  >
    <img class="entity-img" :src="entity.img" :alt="entity.id" :style="imgStyle(entity)" />
  </div>
</div>
```

**v2 修订**：
- 删除 `:class="{ popped: actor.id === 'player' ? !playerAvatarStore.isDown : true }"`
- 删除阴影元素 v-if（已废弃）
- 立绘高度改为 `:style="imgStyle(entity)"` 动态绑定

### 9.2 imgStyle 动态立绘高度

```typescript
function imgStyle(entity: MapEntity): Record<string, string> {
  const ratio = entity.imgHeightRatio ?? 1;
  return { height: `${ratio * 100}%` };
}
```

### 9.3 script 改造

```typescript
// 替代 useActors
const entityAnim = useMapEntities(gridRef);
const { setEntityRef, syncAllPositions, dispose: disposeEntities } = entityAnim;

// 替代 actorsStore
const entitiesStore = useEntitiesStore();
```

**保留不变（v2 明确）**：
- HP watch（`watch(() => playerStore.hp / mhp, ...)` 触发 `onLowHp`/`onNormalHp`）
- `mapStore` 数据变化 watch（重新渲染 + 居中）
- 区域切换 CRT 闪烁 watch
- onMounted 中的 `setupMapCallbacks` + `renderMapGrid` + `initMapInteraction` + `playerAvatarStore.onEnter()`
- onUnmounted 中的 cleanup

---

## 10. 迁移路径

### 10.1 阶段 1：基础设施（不改现有行为）

**目标**：引入 entitiesStore + useMapEntities，行为与现有 useActors 完全一致。

**步骤**：
1. 新建 `types/map-entity.ts`（实体类型定义，含 EntityKind/MapEntity）
2. 新建 `stores/entities.ts`（替代 actorsStore，先只含 player actor，不依赖 isDown）
3. 新建 `composables/useMapEntities.ts`（替代 useActors）：
   - `syncEntityPosition`（位置 + 尺寸，沿用现有算法）
   - `updateEntityZIndex`（z-index，初版直接硬编码 -1/10，与现状一致）
   - 四路 watch（ResizeObserver + curLoc + entities + intentSeq）
   - GSAP 动画函数（resetTransform/setDown/startIdle/popUp/fall，沿用现有实现）
   - `INTENT_HANDLERS` 映射
4. CSS：定义 `:root` z-index 变量（仅声明，现有元素暂不改用变量）
5. `MapGrid.vue`：
   - `actorsStore` → `entitiesStore`
   - `useActors` → `useMapEntities`
   - 模板 `actor` v-for → `entity` v-for
   - 模板 `:class="{ popped: ... }"` → 删除（z-index 由 JS 控制）
   - `actor-img` → `entity-img`
6. `terminal.css`：删除 `.actor.popped { z-index: 10 }` 规则

**验证项**：
- ✅ 玩家入场动画（setDown + popUp）时序不变
- ✅ 移动后位置同步 + onMove 意图触发不变
- ✅ HP < 30% 触发 onLowHp 不变
- ✅ 调试按钮（弹/倒）行为不变
- ✅ 倒下立绘被 `.map-background` 遮挡不变
- ⚠️ z-index 值变化可接受（10 → 1000+），但视觉效果不变（仍浮出 cells 之上）

### 10.2 阶段 2：Y 排序 + 多格支持

**目标**：引入 Y 排序算法，支持多格实体。

**步骤**：
1. `useMapEntities`：`updateEntityZIndex` 改用 `computeZIndex` 动态计算
2. `useMapEntities`：`syncEntityPosition` 加 `spanCols`/`spanRows` 支持
3. `useMapEntities`：`popUp`/`fall` 动画 z-index 切换改为动态计算（删除硬编码 -1/10）
4. 新增 `watch(playerAvatarStore.isDown)` 单独触发 `updateEntityZIndex`
5. CSS：现有元素改用 z-index 变量

**验证项**：
- ✅ actor 移动时 z-index 随 Y 变化
- ✅ 多格实体（测试用例）定位正确
- ✅ 倒下/站立 z-index 切换时序不变

### 10.3 阶段 3：新实体接入（未来，后端协同）

> ⚠️ 本阶段依赖后端数据契约，需与 oblivions 后端协同设计。

1. POI 大楼：`entitiesStore` 派生 POI 数据，`MapGrid` 渲染 `entity-poi`
2. 草丛：`entitiesStore` 派生草丛数据，`MapGrid` 渲染 `entity-grass`
3. 蠕虫 + 裂隙：`entitiesStore` 派生蠕虫/裂隙数据，`MapGrid` 渲染对应实体
4. 各实体动画按需实现

### 10.4 阶段 4：清理

1. 删除 `types/actor.ts`（被 `map-entity.ts` 替代）
2. 删除 `stores/actors.ts`（被 `entities.ts` 替代）
3. 删除 `composables/useActors.ts`（被 `useMapEntities.ts` 替代）
4. 更新 `CODEBASE.md` 同步架构变更

---

## 11. 文件清单

### 11.1 新建

| 文件 | 用途 | 阶段 |
|------|------|------|
| `src/types/map-entity.ts` | 实体类型定义（EntityKind, MapEntity） | 1 |
| `src/stores/entities.ts` | 实体 store（替代 actors.ts） | 1 |
| `src/composables/useMapEntities.ts` | 实体动画/位置同步（替代 useActors.ts） | 1 |

### 11.2 修改

| 文件 | 改动 | 阶段 |
|------|------|------|
| `src/assets/styles/terminal.css` | 加 z-index 变量、实体样式、删除 `.actor.popped` 规则 | 1-2 |
| `src/components/map/MapGrid.vue` | actors v-for → entities v-for、useActors → useMapEntities、删除 :class popped 绑定 | 1 |

### 11.3 删除（阶段 4）

| 文件 | 原因 |
|------|------|
| `src/types/actor.ts` | 被 map-entity.ts 替代 |
| `src/stores/actors.ts` | 被 entities.ts 替代 |
| `src/composables/useActors.ts` | 被 useMapEntities.ts 替代 |

### 11.4 不变

| 文件 | 原因 |
|------|------|
| `src/stores/player-avatar.ts` | 仍管理玩家 actor 意图/动画状态 |
| `src/types/player-avatar.ts` | PlayerAvatarIntent 类型保留 |
| `src/stores/battle.ts` | **6 处接入零改动**（仍用 playerAvatarStore） |
| `src/stores/map.ts` | 数据源不变 |
| `src/components/map/MapContainer.vue` | 调试按钮（弹/倒）保留，仍直调 playerAvatarStore |
| `src/composables/useMapRender.ts` | CellData（含 x/y 坐标）不变 |
| `src/composables/useMapInteraction.ts` | 缩放/平移/居中不变 |
| `src/composables/useMapBusiness.ts` | 业务回调不变 |

**v2 修订**：`battle.ts` 接入点数量从 5 改为 6（line 204 onBattleStart / line 228 onBattleEnd / line 277 onBattleStart / line 469 onHit / line 481 onDie / line 501 onDie）。

---

## 12. 附录：与 demo 的对照

| 机制 | demo 实现 | 本设计实现 |
|------|-----------|-----------|
| 倒下立绘遮挡 | `#map`(z-index:1) 整体遮挡 `#actor`(z-index:0) | `.map-background`(z-index:0) 遮挡 `.actor`(z-index:-1) |
| 站立浮出 | `#actor.popped`(z-index:10) | `.entity-actor` 动态 z-index（1000+） |
| 弹起最初几帧 | actor 无 .popped，z-index:0 被 #map 遮挡 | actor z-index:-1 被 .map-background 遮挡 |
| 倒下最后几帧 | 移除 .popped，z-index:0 被 #map 遮挡 | z-index 切回 -1，被 .map-background 遮挡 |
| 角色投影 | 立绘 img 自带 drop-shadow | `.entity-img` 的 CSS `filter: drop-shadow`（沿用现状） |

**v2 修订**：删除"阴影动画时序"行（独立阴影元素已废弃，投影由立绘 img 的 drop-shadow 提供，无独立动画时序）。

---

## 13. 风险与权衡

### 13.1 Y 排序的 z-index 范围

`Y_SORT_BASE=1000` + `STRIDE=10` + `MAX_YZ=99` → 最大 z-index = 1000 + 99*10 + 9 = 1099 < 2000（air-occluder）。

**v2 修订**：明确 `yZ ≤ 99` 上限，确保 Y 排序层不与 air-occluder(2000) 冲突。若地图超过 100 行，需调高 BASE 或减小 STRIDE。

### 13.2 动态 z-index 与 CSS 类的冲突（v2 已解决）

**v2 方案**：
- 完全删除 `.actor.popped` CSS 规则
- z-index 全部由 JS 通过 `el.style.zIndex` 控制
- `MapGrid.vue` 模板删除 `:class="{ popped: ... }"` 绑定
- `popUp`/`fall` 动画函数中直接设置 `el.style.zIndex`，不再操作 classList

### 13.3 多格实体位置同步

多格实体的锚点格必须是左上角格（或明确指定的锚点）。`data-pls` 查询时用锚点格 pls，尺寸按 `spanCols`/`spanRows` 放大。

### 13.4 性能

每次 `syncAllPositions` 遍历所有实体并设置 z-index。实体数量预期 < 50，性能无忧。ResizeObserver 回调用 `requestAnimationFrame` 节流。

### 13.5 isDown 数据流（v2 新增）

**风险**：`entities` computed 若依赖 `playerAvatarStore.isDown`，每次 isDown 变化都会触发 entities 重算 → `watch(entities)` 触发 `syncAllPositions`（多余）。

**v2 方案**：
- `entities` computed **不依赖** `playerAvatarStore.isDown`
- `updateEntityZIndex` 实时从 `playerAvatarStore.isDown` 读取
- `watch(playerAvatarStore.isDown)` 单独触发 `updateEntityZIndex`（不触发 `syncAllPositions`）

### 13.6 NPC intent 状态（v2 新增）

**风险**：`playerAvatarStore` 是单例（含单一 isDown/intent 状态），多 NPC 无法共用。

**v2 方案**：
- 初版 NPC 只渲染立绘，无 intent 状态，无 popUp/fall 动画
- 未来扩展时选择方案 A（npcAvatarsStore 按 id 索引）或方案 B（泛化 playerAvatarStore 为 actorsAvatarStore）
- 方案选择推迟到实际需要时

---

## 14. 实施检查清单

### 阶段 1 检查清单

- [ ] 新建 `types/map-entity.ts`（EntityKind + EntityLayer + MapEntity）
- [ ] 新建 `stores/entities.ts`（entities computed，不依赖 isDown）
- [ ] 新建 `composables/useMapEntities.ts`：
  - [ ] `syncEntityPosition`（位置 + 尺寸，沿用现有算法）
  - [ ] `updateEntityZIndex`（z-index，初版硬编码 -1/10）
  - [ ] 四路 watch（ResizeObserver + curLoc + entities + intentSeq）
  - [ ] GSAP 动画函数（resetTransform/setDown/startIdle/popUp/fall）
  - [ ] `INTENT_HANDLERS` 映射
  - [ ] `dispose` 清理
- [ ] `terminal.css`：
  - [ ] 定义 `:root` z-index 变量（仅声明）
  - [ ] 删除 `.actor.popped { z-index: 10 }` 规则
- [ ] `MapGrid.vue`：
  - [ ] `actorsStore` → `entitiesStore`
  - [ ] `useActors` → `useMapEntities`
  - [ ] 模板 `actor` v-for → `entity` v-for
  - [ ] 删除 `:class="{ popped: ... }"` 绑定
  - [ ] `actor-img` → `entity-img`
- [ ] 验证：玩家入场/移动/HP/调试按钮行为不变
- [ ] 更新 `CODEBASE.md` 同步架构变更

### 阶段 2 检查清单

- [ ] `updateEntityZIndex` 改用 `computeZIndex` 动态计算
- [ ] `syncEntityPosition` 加 `spanCols`/`spanRows` 支持
- [ ] `popUp`/`fall` 动画 z-index 切换改为动态计算
- [ ] 新增 `watch(playerAvatarStore.isDown)` 单独触发 `updateEntityZIndex`
- [ ] CSS 现有元素改用 z-index 变量
- [ ] 验证：Y 排序正确，多格实体定位正确

### 阶段 4 检查清单

- [ ] 删除 `types/actor.ts`
- [ ] 删除 `stores/actors.ts`
- [ ] 删除 `composables/useActors.ts`
- [ ] 更新 `CODEBASE.md`
