# 地图分层系统设计案（MAP_LAYER_SYSTEM）v1

> 将散落的 z-index 硬编码升级为语义化分层架构，支持 NPC / POI 立绘 / 草丛遮挡 / 蠕虫钻出 / 地面裂隙等多实体多层级需求。

---

## 1. 背景与问题

### 1.1 当前现状

当前 `#mapGrid` 内部 z-index 散落硬编码：

| 元素 | z-index | 来源 |
|------|---------|------|
| `.actor`（倒下） | -1 | terminal.css |
| `.map-background` | 0 | terminal.css |
| `.map-cell` | 1 | terminal.css |
| `.map-cell.current` | 2 | terminal.css |
| `.actor.popped`（站立） | 10 | terminal.css |

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

---

## 2. 需求场景分析

### 2.1 场景清单

| 场景 | 实体类型 | 层级需求 | 遮挡关系 |
|------|---------|---------|---------|
| NPC 立绘 | actor | 角色层 | 与玩家同层，Y 排序 |
| POI 废弃大楼 | poi | 角色层（Y 排序） | 立绘向上延伸，actor 走到前方遮挡大楼下部 |
| 草丛 | grass | 角色层（Y 排序） | 遮挡同格 actor 下半身（图片高度只到腰部） |
| 大蠕虫 | worm | 角色层（Y 排序） | 占 4 格，从裂隙钻出，z-index 切换 |
| 地面裂隙 | crevice | 地面装饰层 | 透明 PNG 叠加在地面背景之上，低于角色 |

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
   1  ground-deco     地面装饰层（裂隙、地面花纹）
   2  cell            地图格层
   3  cell-current    当前格

═══ Y 排序层（z-index = 1000 + yZ*10 + tiebreaker）═══
 1000+  poi / actor / grass / worm
        按 Y 坐标动态排序，同格时按 tiebreaker 决定前后

═══ 固定层（在 Y 排序之上）═══
2000  air-occluder   空中遮挡物（树冠、屋顶）
3000  overlay-ui     顶层 UI
```

### 3.2 Y 排序算法

```typescript
const Y_SORT_BASE = 1000;
const Y_SORT_STRIDE = 10;  // 每格 10 个 tiebreaker 槽位

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
function computeZIndex(entity: MapEntity, isDown: boolean, y: number, cellH: number): number {
  // 角色倒下：固定 -1，被 ground-bg(0) 遮挡
  if (entity.kind === 'actor' && isDown) return -1;

  // 参与 Y 排序的实体
  if (entity.kind in TIEBREAKER) {
    const yZ = Math.floor(y / cellH);
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
  /** 是否倒下（仅 actor 有效，控制 z-index 切换） */
  isDown?: boolean;
}
```

### 4.2 默认参数表

| kind | spanCols | spanRows | imgHeightRatio | 层级 |
|------|----------|----------|----------------|------|
| actor (player/npc/enemy) | 1 | 1 | 1.5 | y-sorted |
| poi | 1 | 1 | 3.0 | y-sorted |
| grass | 1 | 1 | 0.5 | y-sorted |
| worm | 2 | 2 | 2.0 | y-sorted |
| crevice | 2 | 2 | 1.0 | ground-deco |

---

## 5. 位置同步系统（useMapEntities）

### 5.1 syncEntityPosition（泛化版）

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

  // 动态 z-index（Y 排序）
  const isDown = entity.kind === 'actor' ? entity.isDown ?? false : false;
  el.style.zIndex = String(computeZIndex(entity, isDown, offsetY + cellH * spanRows, cellH));

  // 阴影初始化（仅 actor 有阴影）
  if (entity.kind === 'actor') {
    const shadow = el.querySelector('.actor-shadow') as HTMLElement | null;
    if (shadow && !shadow.dataset.inited) {
      gsap.set(shadow, { xPercent: -50, scale: 1, alpha: 1 });
      shadow.dataset.inited = '1';
    }
  }

  return true;
}
```

### 5.2 syncAllPositions（遍历所有实体）

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

### 5.3 z-index 实时更新

actor 的 `isDown` 状态变化时（popUp/fall 动画切换），需要实时更新 z-index：

- `popUp` 回弹 `onStart`：`el.classList.add('popped')` + 更新 z-index 为站立值
- `fall` `onComplete`：`el.classList.remove('popped')` + 更新 z-index 为倒下值（-1）

**实现**：在 `popUp`/`fall` 动画函数中，z-index 切换时同步设置 `el.style.zIndex`：

```typescript
// popUp 回弹 onStart
onStart: () => {
  el.classList.add('popped');
  el.style.zIndex = String(Y_SORT_BASE + yZ * Y_SORT_STRIDE + TIEBREAKER['actor']);
}

// fall onComplete
onComplete: () => {
  el.classList.remove('popped');
  el.style.zIndex = '-1';  // 倒下被 ground-bg 遮挡
}
```

### 5.4 触发同步的三路 watch（沿用 useActors 设计）

- `watch(gridRef)` → ResizeObserver（缩放/resize）
- `watch(curLoc)` → 移动后同步 + 触发 onMove 意图
- `watch(entities)` → 初始挂载/区域切换

---

## 6. 场景实现方案

### 6.1 玩家/NPC actor

**数据**：`entitiesStore.entities` 包含 `{ kind: 'actor', actorKind: 'player', pls, img, isDown }`

**渲染**：与当前实现一致，`<div class="entity entity-actor">` + 阴影 + img

**动画**：沿用 useActors 的 popUp/fall/startIdle，z-index 切换改为动态计算

**NPC 扩展**：NPC 也用 player-avatar store 的 intent 机制，或新增 npc 独立 intent store。初版 NPC 只做 idle 动画（站立即可）。

### 6.2 POI 大楼立绘

**数据**：`{ kind: 'poi', pls, img, imgHeightRatio: 3.0 }`

**渲染**：
```html
<div class="entity entity-poi" :data-entity-id="entity.id">
  <img class="entity-img" :src="entity.img" />
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
  height: 300%;  /* imgHeightRatio * 100% */
  width: auto;
  transform: translateX(-50%);
}
```

**z-index**：Y 排序，tiebreaker=0。actor 走到大楼格时 actor(5) > poi(0)，actor 遮挡大楼下部。大楼上部（超过 actor 立绘 150% 的部分）仍可见。

### 6.3 草丛遮挡下半身

**数据**：`{ kind: 'grass', pls, img, imgHeightRatio: 0.5 }`

**渲染**：
```html
<div class="entity entity-grass" :data-entity-id="entity.id">
  <img class="entity-img" :src="entity.img" />
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
  height: 50%;  /* imgHeightRatio * 100%，只到 actor 腰部 */
  width: auto;
  transform: translateX(-50%);
}
```

**z-index**：Y 排序，tiebreaker=8。同格时 grass(8) > actor(5)，草丛遮挡 actor 下半身。但草丛图片只到 actor 腰部（50% cell），视觉上只遮下半身。

### 6.4 蠕虫钻出 + 裂隙

**数据**：
- 裂隙：`{ kind: 'crevice', pls, img, spanCols: 2, spanRows: 2, imgHeightRatio: 1.0 }`
- 蠕虫：`{ kind: 'worm', pls, img, spanCols: 2, spanRows: 2, imgHeightRatio: 2.0 }`

**渲染**：
```html
<!-- 裂隙（ground-deco 层，固定 z-index:1） -->
<div class="entity entity-crevice" :data-entity-id="entity.id">
  <img class="entity-img" :src="entity.img" />
</div>

<!-- 蠕虫（y-sorted 层） -->
<div class="entity entity-worm" :data-entity-id="entity.id">
  <div class="actor-shadow"></div>
  <img class="entity-img" :src="entity.img" />
</div>
```

**钻出动画时序**：
1. 裂隙淡入（ground-deco 层，z-index:1，低于角色）
2. 蠕虫 setDown（z-index:-1，被 ground-bg 遮挡，不可见）
3. 蠕虫 popUp（z-index 切换到 y-sorted，从裂隙位置弹出）

**CSS**：
```css
.entity-crevice {
  position: absolute;
  left: 0; top: 0;
  pointer-events: none;
  /* z-index 由 syncEntityPosition 动态设置（固定 1） */
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
  height: 200%;  /* imgHeightRatio * 100% */
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
  --z-ground-deco:     1;
  --z-cell:            2;
  --z-cell-current:    3;
  /* ── Y 排序层（1000+，由 JS 动态设置）── */
  /* ── 固定层（在 Y 排序之上）── */
  --z-air-occluder: 2000;
  --z-overlay-ui:   3000;
}
```

### 7.2 现有元素改造

```css
/* 背景层 */
.map-background {
  z-index: var(--z-ground-bg);  /* 0 */
}

/* 地图格 */
.map-cell {
  z-index: var(--z-cell);  /* 2，替代硬编码 1 */
}
.map-cell.current {
  z-index: var(--z-cell-current);  /* 3，替代硬编码 2 */
}

/* 角色（倒下状态） */
.actor {
  z-index: var(--z-actor-down);  /* -1，倒下被 ground-bg 遮挡 */
}
/* 站立状态 z-index 由 JS 动态设置（1000+），不再用 .popped CSS 类 */
```

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
  z-index: var(--z-ground-deco);  /* 1 */
}

/* Y 排序实体 z-index 由 JS 动态设置，CSS 不设 z-index */
.entity-actor,
.entity-poi,
.entity-grass,
.entity-worm {
  /* z-index 由 syncEntityPosition 动态设置 */
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

### 8.2 与 playerAvatarStore 的关系

`playerAvatarStore` 仍管理玩家 actor 的意图/动画状态（isDown, intent）。`entitiesStore` 只管实体数据（位置、类型、图片）。

actor 的 `isDown` 状态从 `playerAvatarStore.isDown` 读取，用于 z-index 计算。

---

## 9. MapGrid.vue 改造

### 9.1 模板

```vue
<div id="mapGrid" ref="gridRef" class="ascii-map-grid" :style="gridStyle">
  <!-- 背景层 -->
  <div class="map-background"></div>

  <!-- 数据不可用时显示占位 -->
  <div v-if="cells.length === 0" class="error">{{ placeholderText }}</div>

  <!-- 地图格 -->
  <div v-for="cell in cells" ...>...</div>

  <!-- 实体层：所有地图实体（actor/poi/grass/crevice/worm） -->
  <div
    v-for="entity in entitiesStore.entities"
    :key="entity.id"
    :ref="el => setEntityRef(entity.id, el as HTMLElement | null)"
    class="entity"
    :class="`entity-${entity.kind}`"
    :data-entity-id="entity.id"
  >
    <!-- actor 有阴影 -->
    <div v-if="entity.kind === 'actor' || entity.kind === 'worm'" class="actor-shadow"></div>
    <img class="entity-img" :src="entity.img" :alt="entity.id" :style="imgStyle(entity)" />
  </div>
</div>
```

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

---

## 10. 迁移路径

### 10.1 阶段 1：基础设施（不改现有行为）

1. 新建 `types/map-entity.ts`（实体类型定义）
2. 新建 `stores/entities.ts`（替代 actorsStore，先只含 player actor）
3. 新建 `composables/useMapEntities.ts`（替代 useActors，先只支持单格 actor）
4. CSS：定义 `:root` z-index 变量，现有元素改用变量
5. MapGrid.vue：actors v-for → entities v-for，useActors → useMapEntities
6. 验证：现有 actor 动画/位置同步/z-index 切换行为不变

### 10.2 阶段 2：Y 排序 + 多格支持

1. `useMapEntities`：syncEntityPosition 加 Y 排序 z-index 计算
2. `useMapEntities`：syncEntityPosition 加 spanCols/spanRows 支持
3. `useMapEntities`：popUp/fall 动画 z-index 切换改为动态计算
4. 验证：actor 移动时 z-index 随 Y 变化，多格实体定位正确

### 10.3 阶段 3：新实体接入

1. POI 大楼：entitiesStore 派生 POI 数据，MapGrid 渲染 entity-poi
2. 草丛：entitiesStore 派生草丛数据，MapGrid 渲染 entity-grass
3. 蠕虫 + 裂隙：entitiesStore 派生蠕虫/裂隙数据，MapGrid 渲染对应实体
4. 各实体动画按需实现

### 10.4 阶段 4：清理

1. 删除 `types/actor.ts`（被 map-entity.ts 替代）
2. 删除 `stores/actors.ts`（被 entities.ts 替代）
3. 删除 `composables/useActors.ts`（被 useMapEntities.ts 替代）

---

## 11. 文件清单

### 11.1 新建

| 文件 | 用途 |
|------|------|
| `src/types/map-entity.ts` | 实体类型定义（EntityKind, MapEntity） |
| `src/stores/entities.ts` | 实体 store（替代 actors.ts） |
| `src/composables/useMapEntities.ts` | 实体动画/位置同步（替代 useActors.ts） |

### 11.2 修改

| 文件 | 改动 |
|------|------|
| `src/assets/styles/terminal.css` | 加 z-index 变量、实体样式、现有元素改用变量 |
| `src/components/map/MapGrid.vue` | actors v-for → entities v-for、useActors → useMapEntities |

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
| `src/stores/battle.ts` | 5 处接入零改动（仍用 playerAvatarStore） |
| `src/stores/map.ts` | 数据源不变 |

---

## 12. 附录：与 demo 的对照

| 机制 | demo 实现 | 本设计实现 |
|------|-----------|-----------|
| 倒下立绘遮挡 | `#map`(z-index:1) 整体遮挡 `#actor`(z-index:0) | `.map-background`(z-index:0) 遮挡 `.actor`(z-index:-1) |
| 站立浮出 | `#actor.popped`(z-index:10) | `.entity-actor` 动态 z-index（1000+） |
| 弹起最初几帧 | actor 无 .popped，z-index:0 被 #map 遮挡 | actor z-index:-1 被 .map-background 遮挡 |
| 倒下最后几帧 | 移除 .popped，z-index:0 被 #map 遮挡 | z-index 切回 -1，被 .map-background 遮挡 |
| 阴影动画时序 | timeline 位置参数 0.2/0.08 | 沿用 v3 修复（已对齐） |

---

## 13. 风险与权衡

### 13.1 Y 排序的 z-index 范围

地图最大行数决定 yZ 上限。`Y_SORT_BASE=1000` + `STRIDE=10`，支持 100 行（1000+100*10=2000，不超过 air-occluder 的 2000）。若地图超过 100 行，需调高 BASE 或减小 STRIDE。

### 13.2 动态 z-index 与 CSS 类的冲突

当前 `.actor.popped { z-index: 10 }` 是 CSS 类控制。新架构改为 JS 动态设置 `el.style.zIndex`，CSS 类不再控制 z-index。需确保 popUp/fall 动画函数正确设置 z-index，且 CSS 不覆盖（CSS 不设 .popped z-index）。

### 13.3 多格实体位置同步

多格实体的锚点格必须是左上角格（或明确指定的锚点）。`data-pls` 查询时用锚点格 pls，尺寸按 spanCols/spanRows 放大。

### 13.4 性能

每次 syncAllPositions 遍历所有实体并设置 z-index。实体数量预期 < 50，性能无忧。ResizeObserver 回调用 requestAnimationFrame 节流。
