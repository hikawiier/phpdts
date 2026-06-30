# 移动动画分级方案（MOVE_ANIMATION_TIERS）v1.2

> 根据移动距离与场景，将玩家小人移动动画分为三级：鸭子步（短距）、棋子跳跃（中距）、弹出（特殊场景），提供与距离匹配的视觉反馈。
>
> v1.1 修订：修正首次挂载保护方案（isFirstMove → oldVal 判断）、jumpActor y 弧线方向（非水平移动时峰值计算）、scaleY 序列间隙（补空中渐回段）、风险描述阈值同步。
>
> v1.2 修订：调整分级阈值（鸭子步 1-3 格 → 1-2 格，跳跃 4-8 格 → 3-6 格，弹出 >8 格 → >6 格）。

---

## 1. 背景与目标

### 1.1 现状

当前已实现鸭子步移动动画（单格邻接移动），但降级条件为 `> 1.5 格` 即走瞬间定位 + onMove，缺乏中距离移动的过渡动画。多格移动、传送、跨区域等场景视觉断裂。

### 1.2 目标

建立三级动画分级，让不同距离/场景获得匹配的移动反馈：

| 级别 | 场景 | 动画 | 状态 |
|------|------|------|------|
| 短距 | 1-2 格移动 | 鸭子步摇摆 | 已实现 |
| 中距 | 3-6 格移动 | 棋子跳跃 | 新增 |
| 特殊 | 首次挂载/传送/回退/跨区域/>6格 | 弹出（popUp） | 复用现有 |

---

## 2. 距离判定

### 2.1 格距计算

```typescript
const gridDist = Math.max(Math.abs(toX - fromX) / cellW, Math.abs(toY - fromY) / cellH);
```

用 `max(dx/cellW, dy/cellH)` 取格距（切比雪夫距离），符合 8 方向移动的格数直觉。

### 2.2 分级阈值

```typescript
function pickMoveAnim(gridDist: number): 'duck' | 'jump' | 'pop' {
  if (gridDist <= 2.5) return 'duck';    // 1-2 格
  if (gridDist <= 6.5) return 'jump';    // 3-6 格
  return 'pop';                          // >6 格或特殊场景
}
```

阈值用 `.5` 容差：2 格移动 dx≈2*cellW，`2/1=2 ≤ 2.5` 走鸭子步；3 格 `3 > 2.5` 走跳跃；6 格 `6 ≤ 6.5` 走跳跃；7 格 `7 > 6.5` 走弹出。

### 2.3 特殊场景强制 popUp

以下场景无论距离都走 popUp（不走鸭子步/跳跃）：

| 场景 | 判据 | 原因 |
|------|------|------|
| 首次加载 | `watch(curLoc)` 的 `oldVal === null` | null→值 表示初次加载，enter 意图已接管 popUp |
| 玩家倒下 | `playerAvatarStore.isDown` | 应走 pendingIntent popUp 恢复 |
| 区域切换 | `curRegion` 变化 | 跨区域视觉重置 |
| 长距离 | `gridDist > 6.5` | 超过跳跃覆盖范围，用 popUp 强调到达 |

---

## 3. 鸭子步动画（已实现）

### 3.1 要素

| 要素 | 实现 | 参数 |
|------|------|------|
| 位置插值 | `gsap.to(el, { x, y })` | duration 0.5s, `power1.inOut` |
| 左右摇摆 | `gsap.to(el, { rotation })` yoyo | 振幅 ±12°，2 周期，`sine.inOut` |
| 脚步压缩 | `gsap.to(el, { scaleY })` yoyo | 0.97，与摇摆同频 |

### 3.2 方向感知

- 右移（direction=1）：先摆右（+12°）
- 左移（direction=-1）：先摆左（−12°）
- 垂直移动（direction=0）：默认先摆右（+12°）

摇摆模拟走路身体晃，与移动方向无关，垂直移动也摇摆。

### 3.3 衔接 idle

`onComplete` 调 `startIdle`。`startIdle` 内部 `gsap.set` 重置 scale/rotation 到中性值（1/1/0），避免 yoyo 停在与目标值重合位置导致无振幅。

---

## 4. 棋子跳跃动画（新增）

### 4.1 要素

| 要素 | 实现 | 说明 |
|------|------|------|
| x 平移 | `gsap.to(el, { x: toX })` | 全程，`power1.inOut` |
| y 弧线 | 两段 `gsap.to`：跳起→落下 | 模拟抛物线，峰值取 `min(fromY, toY) - jumpHeight` |
| scaleY 弹性 | 蓄力压缩→弹起拉伸→空中渐回→落地压缩 | 模拟弹跳形变，无间隙 |

### 4.2 时序

```
0s       0.08s     0.23s     0.4s      0.5s
│        │         │         │         │
├ 蓄力0.9 ┤         │         │         │   scaleY 压缩（蓄力）
│        ├ 拉伸1.1 ─┤        │         │   scaleY 拉伸（弹起）
│        │         ├ 空中1.0 ─┤        │   scaleY 渐回（空中）
│        │         │         ├ 落地0.95┤   scaleY 压缩（落地）
├ y 跳起 ──────────┤         │         │   y: fromY → peakY (0~0.25s)
│        │         ├ y 落下 ──────────┤   y: peakY → toY  (0.25~0.5s)
├ x 平移（全程 0.5s）──────────────────┤   x: fromX → toX
```

scaleY 四段无缝衔接：蓄力(0.08s) → 拉伸(0.15s) → 空中渐回(0.17s) → 落地压缩(0.1s)，总 0.5s。

### 4.3 实现

```typescript
function jumpActor(
  el: HTMLElement,
  toX: number, toY: number,
  cellH: number,
  onComplete: () => void,
): void {
  gsap.killTweensOf(el);
  el.style.zIndex = String(Z_STANDING);

  const duration = 0.5;
  const jumpHeight = cellH * 0.6;  // 跳起高度
  const half = duration / 2;

  // 读取起点 y（gsap transform 当前值，此时 syncAllPositions 未执行）
  // 关键：peakY 取 min(fromY, toY) - jumpHeight，确保垂直/斜向移动时也"向上跳"
  // 屏幕坐标 y 向下为正，"向上跳"= y 减小，所以峰值比起点和终点都小
  const fromY = gsap.getProperty(el, 'y') as number;
  const peakY = Math.min(fromY, toY) - jumpHeight;

  const tl = gsap.timeline({ onComplete });

  // 1. x 全程平移（gsap.to 自动从当前 x 插值到 toX）
  tl.to(el, { x: toX, duration, ease: 'power1.inOut' }, 0);

  // 2. y 抛物线：跳起（y 减小到 peakY）→ 落下（y 增大到 toY）
  tl.to(el, { y: peakY, duration: half, ease: 'power2.out' }, 0);
  tl.to(el, { y: toY, duration: half, ease: 'power2.in' }, half);

  // 3. scaleY 弹性形变（四段无缝衔接，避免中间停在 1.1）
  tl.to(el, { scaleY: 0.9,  duration: 0.08, ease: 'power2.in'  }, 0);     // 蓄力压缩
  tl.to(el, { scaleY: 1.1,  duration: 0.15, ease: 'power2.out' }, 0.08);  // 弹起拉伸
  tl.to(el, { scaleY: 1.0,  duration: 0.17, ease: 'sine.inOut' }, 0.23);  // 空中渐回
  tl.to(el, { scaleY: 0.95, duration: 0.10, ease: 'power2.in'  }, 0.40);  // 落地压缩
  // onComplete 后 startIdle 重置 scaleY 到 1
}
```

### 4.4 y 弧线峰值计算说明

屏幕坐标系 y 向下为正，"向上跳"意味着 y 值减小。跳跃峰值应高于起点和终点：

- 水平移动（fromY === toY）：`peakY = toY - jumpHeight`（与旧方案一致）
- 向下移动（fromY < toY）：`peakY = fromY - jumpHeight`（峰值跟从起点向上跳，再落到更低的终点）
- 向上移动（fromY > toY）：`peakY = toY - jumpHeight`（峰值跟终点向上跳，从更高的起点直接落下）
- 斜向移动：取 `min(fromY, toY) - jumpHeight`，保证峰值始终高于两端

统一公式 `peakY = Math.min(fromY, toY) - jumpHeight` 覆盖所有情况。

### 4.5 跳跃与鸭子步的区别

- 鸭子步：贴地滑动 + 摇摆，模拟"走"
- 跳跃：离地弧线 + 弹性形变，模拟"跳"，无摇摆

跳跃不需要 direction 参数（无摇摆），方向体现在 x 平移向量上。

---

## 5. 弹出动画（复用现有 popUp）

### 5.1 场景

- 首次加载（curLoc 从 null 变为值，由 `MapGrid.onMounted → onEnter()` 接管）
- 传送/回退/跨区域（>6 格或 curRegion 变化）
- 玩家倒下状态移动（走 pendingIntent popUp 恢复）

### 5.2 实现

无需新增代码。降级分支调 `syncAllPositions()` 瞬间定位 + `playerAvatarStore.onEnter()`，onEnter 经 `dispatchWithRecovery` 若 isDown=true 则暂存意图走 popUp 恢复，若 isDown=false 则直接派发 enter（setDown + popUp）强调"到达"。

```typescript
if (gridDist > 6.5 || isRegionChange) {
  isMoving = false;  // popUp 不需要 isMoving 保护
  syncAllPositions();
  playerAvatarStore.onEnter();  // 弹出强调到达
  return;
}
```

> 注：onEnter 在 isDown=false 时会派发 enter 意图，handler 执行 setDown（视觉倒下）+ popUp（弹起）。setDown 的倒下状态短暂（popUp 第一个 tween 立即 alpha 1），视觉上是"到达后从地面弹起"，符合强调到达的语义。

---

## 6. 首次挂载处理

### 6.1 问题

首次加载时 `curLoc` 从 `null` 变为值，`watch(curLoc)` 触发，可能误走分级动画分支，与 `MapGrid.onMounted → onEnter()` 的 popUp 冲突（killTweensOf 打断 popUp）。

### 6.2 方案

利用 `watch` 的 `oldVal` 参数判断是否首次加载，无需额外标志。同时监听 `curRegion` 用于区域切换检测：

```typescript
const stopCurLocWatch = watch(
  () => [mapStore.curLoc, mapStore.curRegion] as const,
  ([newLoc, newRegion], [oldLoc, oldRegion]) => {
    // 首次加载（curLoc null → 值）：让 onEnter 接管 popUp，跳过分级动画
    if (oldLoc === null) return;
    // curLoc 未变化（仅 curRegion 变化等）：不处理移动
    if (newLoc === oldLoc) return;
    const isRegionChange = newRegion !== oldRegion;
    nextTick(() => requestAnimationFrame(() => {
      // ... 分级动画逻辑（isRegionChange 时强制走弹出）
    }));
  },
);
```

### 6.3 三种 curLoc 时序覆盖

| 场景 | watch 触发 | oldLoc | 行为 |
|------|-----------|--------|------|
| 预加载（mount 前 curLoc 已有值） | 不触发（watch 默认非 immediate） | — | onMounted 的 onEnter 接管，无冲突 |
| 异步加载（mount 后 null → 值） | 触发 | `null` | return，让 onEnter 接管 |
| 真实移动（mount 后值A → 值B） | 触发 | 值A（非 null） | 走分级动画（区域切换时强制弹出） |

> `curLoc` 类型为 `string | number | null`，初始 `null`，加载后为非空值。`oldLoc === null` 精确匹配首次加载，不会误判合法的 0 或空字符串（pls 不会是这些值）。

---

## 7. watch(curLoc) 改造

```typescript
const stopCurLocWatch = watch(
  () => [mapStore.curLoc, mapStore.curRegion] as const,
  ([newLoc, newRegion], [oldLoc, oldRegion]) => {
    // 首次加载（curLoc null → 值）：让 onEnter 接管 popUp
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

      // 区域切换：强制弹出（跨区域视觉重置）
      if (isRegionChange) {
        isMoving = false;
        syncAllPositions();
        playerAvatarStore.onEnter();
        return;
      }

      const fromX = gsap.getProperty(el, 'x') as number;
      const fromY = gsap.getProperty(el, 'y') as number;

      const cell = grid.querySelector(`[data-pls="${newLoc}"]`) as HTMLElement | null;
      if (!cell) { syncAllPositions(); playerAvatarStore.onMove(); return; }

      // 计算新格 offset
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

      // 格距
      const gridDist = Math.max(Math.abs(toX - fromX) / cellW, Math.abs(toY - fromY) / cellH);

      // 设实体尺寸
      gsap.set(el, { width: cellW, height: cellH });

      isMoving = true;
      const entity = entitiesStore.entities.find(e => e.id === 'player');
      const done = () => {
        isMoving = false;
        if (entity) updateEntityZIndex(el, entity);
        startIdle(el);
      };

      if (gridDist <= 2.5) {
        // 鸭子步
        const direction: 1 | -1 | 0 = toX > fromX ? 1 : toX < fromX ? -1 : 0;
        moveActor(el, toX, toY, direction, done);
      } else if (gridDist <= 6.5) {
        // 棋子跳跃
        jumpActor(el, toX, toY, cellH, done);
      } else {
        // 弹出（长距离）
        isMoving = false;  // popUp 不需要 isMoving 保护
        syncAllPositions();
        playerAvatarStore.onEnter();
      }
    }));
  },
);
```

---

## 8. 文件改动

| 文件 | 改动 |
|------|------|
| `src/composables/useMapEntities.ts` | 新增 `jumpActor` 函数；`watch` 改为监听 `[curLoc, curRegion]` 双值；三级分级分发（鸭子步/跳跃/弹出）；`oldLoc` 判断首次加载；`isRegionChange` 检测区域切换强制走弹出 |

无新增文件，无 CSS 改动，无类型改动。

---

## 9. 参数表

| 动画 | 参数 | 值 |
|------|------|----|
| 鸭子步 | duration | 0.5s |
| | swayAmp | 12° |
| | swayCycles | 2 |
| | scaleY 压缩 | 0.97 |
| 跳跃 | duration | 0.5s |
| | jumpHeight | cellH × 0.6 |
| | 蓄力压缩 | scaleY 0.9, 0.08s, `power2.in` |
| | 弹起拉伸 | scaleY 1.1, 0.15s, `power2.out` |
| | 空中渐回 | scaleY 1.0, 0.17s, `sine.inOut` |
| | 落地压缩 | scaleY 0.95, 0.10s, `power2.in` |
| | y 峰值 | `min(fromY, toY) - jumpHeight` |
| 弹出 | 复用 popUp | duration 0.9s elastic |

---

## 10. 风险与边界

### 10.1 鸭子步→跳跃的视觉过渡

2 格（鸭子步）与 3 格（跳跃）的动画风格差异较大，切换时可能有视觉断裂。可接受——距离差异本身就值得不同反馈。

### 10.2 跳跃 y 弧线与位置同步

跳跃期间 `isMoving=true`，`syncEntityPosition` 跳过玩家，避免 ResizeObserver 打断 y 弧线。跳跃完成后 `startIdle` 前 `isMoving=false`，位置已由 `jumpActor` 的 `y: toY` 保证准确。

### 10.3 连续移动打断

快速连续移动时，新动画开头的 `gsap.killTweensOf(el)` 杀死前一个动画。鸭子步→跳跃→鸭子步的中途切换表现为"途中变换动作"，可接受。

### 10.4 首次挂载时序

`watch(curLoc)` 通过 `oldVal` 判断首次加载：curLoc 从 `null` 变为值时 `oldVal === null`，return 跳过，让 `MapGrid.onMounted` 的 `onEnter()` 独立执行 popUp。curLoc 预加载时 watch 默认非 immediate 不触发。两者不冲突。

### 10.5 onEnter 进行中的移动打断

若用户在 onEnter 的 popUp 进行中（挂载后 0.9s 内）触发移动，`watch(curLoc)` 会走分级动画，`gsap.killTweensOf` 打断 popUp。此时 `isDown=false`（onEnter 不改 isDown），不走 pendingIntent 暂存。视觉上是 popUp 中途开始移动，可接受（罕见场景，且 popUp 的弹性回弹已部分完成）。

### 10.6 长距离移动的 onEnter 语义

长距离移动（>6.5 格）调 `onEnter()` 复用 popUp 强调到达。onEnter 在 isDown=false 时派发 enter 意图 → setDown + popUp，立绘在目标格"从倒下状态弹起"。语义上 onEnter 原为"进入"场景，此处复用为"到达强调"，视觉效果一致（setDown 倒下极短暂，紧接 popUp 弹起）。若后续需要语义区分，可新增 `onArrive` action，但当前无需。
