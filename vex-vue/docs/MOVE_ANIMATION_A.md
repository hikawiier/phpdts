# 移动动画方案 A：鸭子步摇摆（MOVE_ANIMATION_A）v1

> 替代当前"瞬间 gsap.set 定位 + resetTransform 顿挫"的移动表现，改为立绘从旧格平滑滑到新格，期间左右摇摆模拟行走。

---

## 1. 问题分析

### 1.1 当前移动时序

1. 玩家点击相邻格 → `mapStore.curLoc` 变为新值
2. `watch(curLoc)` → `nextTick` → `raf` → `syncAllPositions()`（`gsap.set` 瞬间把立绘移到新格）→ `playerAvatarStore.onMove()`（派发 `move` 意图）
3. `watch(intentSeq)` → `move` handler：`resetTransform`（重置 scale/rotation）+ `startIdle`

### 1.2 视觉问题

- 步骤 2 的 `gsap.set` 让立绘**瞬间跳到新格**，无过渡
- 步骤 3 的 `resetTransform` 把 scale/rotation 瞬间归位，视觉上有"顿挫"
- 整体观感像"弹了一下"，而非"走过去"

### 1.3 根因

位置切换无过渡。`syncEntityPosition` 用 `gsap.set`（瞬时），移动与 idle 共用同一套 transform 重置逻辑。

---

## 2. 方案 A 设计

### 2.1 核心

`watch(curLoc)` 时，不再瞬间 `syncAllPositions` 玩家立绘，而是启动 `moveActor` 动画：从旧位置平滑插值到新位置，期间立绘绕底部中心左右摇摆模拟走路。

### 2.2 动画要素

| 要素 | 实现 | 参数 |
|------|------|------|
| 位置插值 | `gsap.to(el, { x: toX, y: toY })` | duration 0.4s, `power1.inOut` |
| 左右摇摆 | `gsap.to(el, { rotation })` yoyo repeat | 振幅 ±8°，2 个完整周期，`sine.inOut` |
| 脚步压缩 | `gsap.to(el, { scaleY })` yoyo repeat | 0.97，与摇摆同步，模拟着地 |

**方向感知**：右移先摆右（+），左移先摆左（−），更自然。

### 2.3 fromX/fromY 来源

`watch(curLoc)` 触发时，`syncAllPositions` 尚未执行，立绘的 gsap transform 仍是旧格位置。用 `gsap.getProperty(el, 'x'/'y')` 读取作为起点。

### 2.4 降级条件

以下场景不走摇摆动画，降级为原行为（`syncAllPositions` + `onMove`）：

| 场景 | 判据 | 原因 |
|------|------|------|
| 玩家倒下 | `playerAvatarStore.isDown === true` | 应走 pendingIntent popUp 恢复 |
| 多格移动 | `dx > cellW*1.5 \|\| dy > cellH*1.5` | 传送/回退/跨区域，长距离摇摆怪异 |
| 首次挂载 | `fromX/fromY === 0` 且新格非原点 | 走 entities watch 的初始定位 |
| 无 el/grid | 引用缺失 | 兜底 |

### 2.5 isMoving 标志

`moveActor` 期间设置 `isMoving = true`，`syncEntityPosition` 检测到玩家正在移动则跳过（避免 ResizeObserver 打断移动动画）。移动完成后清除标志并强制 `syncEntityPosition` 一次（确保位置精确）。

### 2.6 onMove 调用决策

正常移动**不再调用** `playerAvatarStore.onMove()`，避免 `move` handler 的 `resetTransform` 打断移动动画。

降级场景仍调用 `onMove()`（走原 move handler 或 pendingIntent 恢复）。

`move` handler 保留作为兜底，改为只 `startIdle`（去掉 `resetTransform`，避免未来误调用时打断位置）。

---

## 3. 实现细节

### 3.1 moveActor 函数

```typescript
function moveActor(
  el: HTMLElement,
  fromX: number, fromY: number,
  toX: number, toY: number,
  direction: 1 | -1 | 0,
  onComplete: () => void,
): void {
  gsap.killTweensOf(el);
  el.style.zIndex = String(Z_STANDING);

  const duration = 0.4;
  const swayAmp = 8;
  const swayCycles = 2;
  const swaySegments = swayCycles * 4;  // 每周期 4 段（正→反→正→反）

  const tl = gsap.timeline({ onComplete });

  // 1. 位置插值（旧格 → 新格）
  tl.to(el, {
    x: toX, y: toY,
    duration,
    ease: 'power1.inOut',
  }, 0);

  // 2. 左右摇摆（方向感知：右移先摆右 +，左移先摆左 −）
  tl.to(el, {
    rotation: direction * swayAmp,
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
```

### 3.2 watch(curLoc) 改造

```typescript
let isMoving = false;

const stopCurLocWatch = watch(
  () => mapStore.curLoc,
  () => {
    nextTick(() => requestAnimationFrame(() => {
      const grid = gridRef.value;
      const el = entityRefs.get('player');

      // 降级：倒下 / 无引用
      if (!grid || !el || playerAvatarStore.isDown) {
        syncAllPositions();
        playerAvatarStore.onMove();
        return;
      }

      // 读取旧位置（gsap transform 当前值）
      const fromX = gsap.getProperty(el, 'x') as number;
      const fromY = gsap.getProperty(el, 'y') as number;

      // 计算新格位置
      const newLoc = mapStore.curLoc;
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

      // 降级：多格移动
      const dx = Math.abs(toX - fromX);
      const dy = Math.abs(toY - fromY);
      if (dx > cellW * 1.5 || dy > cellH * 1.5) {
        syncAllPositions();
        playerAvatarStore.onMove();
        return;
      }

      // 方向判断
      const direction = toX > fromX ? 1 : toX < fromX ? -1 : 0;

      // 设实体尺寸（与 syncEntityPosition 一致，确保 width/height 正确）
      gsap.set(el, { width: cellW, height: cellH });

      // 启动移动动画
      isMoving = true;
      const entity = entitiesStore.entities.find(e => e.id === 'player');
      moveActor(el, fromX, fromY, toX, toY, direction, () => {
        isMoving = false;
        if (entity) updateEntityZIndex(el, entity);
      });
    }));
  },
);
```

### 3.3 syncEntityPosition 跳过移动中实体

```typescript
function syncEntityPosition(entityEl, entity, gridEl) {
  if (entity.id === 'player' && isMoving) return;  // 移动中跳过
  // ... 原逻辑
}
```

### 3.4 move handler 改造

```typescript
'move': (el) => { startIdle(el); },  // 去掉 resetTransform，避免打断位置
```

---

## 4. 风险与边界

### 4.1 gsap.getProperty 读取时机

`watch(curLoc)` 回调在 Vue 响应式更新后触发，`nextTick + raf` 确保 DOM 已更新。此时 `syncAllPositions` 未执行，`el` 的 transform 仍是旧格值。✓

### 4.2 移动期间 ResizeObserver

`ResizeObserver` 触发 `syncAllPositions` → `syncEntityPosition` 检测 `isMoving` 跳过玩家。其他实体正常同步。移动完成后 `moveActor.onComplete` 不强制 `syncEntityPosition`，但下次 `curLoc` 变化或 resize 会自然修正。若需精确，可在 `onComplete` 加一次 `syncEntityPosition`。

### 4.3 连续移动（快速点击多格）

每次 `curLoc` 变化触发 `moveActor`，开头 `gsap.killTweensOf(el)` 会杀死上一个移动动画，从当前位置启动新移动。视觉上表现为"中途转向"，可接受。

### 4.4 direction=0（垂直移动）

上下移动时 `direction=0`，摇摆起始角度为 0，`rotation: 0` 的 yoyo 不会产生摇摆。视觉上只有位置插值 + 脚步压缩。可接受，或改为垂直移动时用默认方向 1。

---

## 5. 文件改动

| 文件 | 改动 |
|------|------|
| `src/composables/useMapEntities.ts` | 新增 `moveActor`、`isMoving` 标志；改造 `watch(curLoc)`；`syncEntityPosition` 跳过移动中实体；`move` handler 去掉 `resetTransform` |
