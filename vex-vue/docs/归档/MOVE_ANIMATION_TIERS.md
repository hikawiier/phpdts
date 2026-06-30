# 移动动画分级方案（MOVE_ANIMATION_TIERS）v1.3

> 根据移动距离与场景，将玩家小人移动动画分为三级：鸭子步（短距）、棋子跳跃（中距）、弹出（特殊场景），提供与距离匹配的视觉反馈。
>
> v1.1 修订：修正首次挂载保护方案（isFirstMove → oldVal 判断）、jumpActor y 弧线方向（非水平移动时峰值计算）、scaleY 序列间隙（补空中渐回段）、风险描述阈值同步。
>
> v1.2 修订：调整分级阈值（鸭子步 1-3 格 → 1-2 格，跳跃 4-8 格 → 3-6 格，弹出 >8 格 → >6 格）。
>
> v1.3 修订：jumpActor 落地阶段改用 `elastic.out` 弹性缓动（替代手动分段）；修复连续移动竞态 BUG（animToken 令牌机制）；区域切换改用 `arriveAnim` 淡入弹起（替代 popUp）；鸭子步阈值收紧到 ≤1.5 格（仅 1 格邻接）；`isMoving=true` 提前到 watch 同步阶段。

---

## 1. 背景与目标

### 1.1 现状

当前已实现鸭子步移动动画（单格邻接移动），但降级条件为 `> 1.5 格` 即走瞬间定位 + onMove，缺乏中距离移动的过渡动画。多格移动、传送、跨区域等场景视觉断裂。

### 1.2 目标

建立三级动画分级，让不同距离/场景获得匹配的移动反馈：

| 级别 | 场景 | 动画 | 状态 |
|------|------|------|------|
| 短距 | 1 格邻接移动 | 鸭子步摇摆 | 已实现 |
| 中距 | 2-6 格移动 | 棋子跳跃 | 已实现 |
| 特殊 | 首次挂载/传送/跨区域/>6格 | 弹出（popUp）/ 到达弹起（arriveAnim） | 复用现有 |

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
  if (gridDist <= 1.5) return 'duck';     // 1 格邻接
  if (gridDist <= 6.5) return 'jump';     // 2-6 格
  return 'pop';                           // >6 格或特殊场景
}
```

阈值用 `.5` 容差：1 格移动 dx≈1*cellW，`1 ≤ 1.5` 走鸭子步；2 格 `2 > 1.5` 走跳跃；6 格 `6 ≤ 6.5` 走跳跃；7 格 `7 > 6.5` 走弹出。

### 2.3 特殊场景

以下场景无论距离都走特殊动画（不走鸭子步/跳跃）：

| 场景 | 判据 | 动画 | 原因 |
|------|------|------|------|
| 首次加载 | `watch(curLoc)` 的 `oldLoc === null` | onEnter popUp | null→值 表示初次加载，enter 意图已接管 |
| 玩家倒下 | `playerAvatarStore.isDown` | syncAllPositions + onMove | 应走 pendingIntent popUp 恢复 |
| 区域切换 | `curRegion` 变化 | arriveAnim 淡入弹起 | 跨区域视觉重置，无倒下阶段 |
| 长距离 | `gridDist > 6.5` | syncAllPositions + onEnter popUp | 超过跳跃覆盖范围，强调到达 |

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

## 4. 棋子跳跃动画

### 4.1 要素

| 要素 | 实现 | 说明 |
|------|------|------|
| x 平移 | `gsap.to(el, { x: toX })` | 空中阶段 0.5s，`power1.inOut` |
| y 弧线 | 两段 `gsap.to`：跳起→落下 | 模拟抛物线，峰值取 `min(fromY, toY) - jumpHeight` |
| scaleY 空中形变 | 3 段：蓄力压缩→弹起拉伸→落地压缩 | 0~0.5s，模拟弹簧形变 |
| scaleY 落地弹性 | 1 段 `elastic.out` | 0.5~1.4s，自带振荡衰减，自然过渡到 idle |

### 4.2 时序

```
0s       0.10s     0.25s     0.50s              1.40s
│        │         │         │                  │
├ 蓄力0.60 ┤        │         │                  │   scaleY 压缩（弹簧压扁）
│        ├ 拉伸1.20 ─┤       │                  │   scaleY 拉伸（弹簧释放）
│        │         ├ 压缩0.55─┤                  │   scaleY 空中渐回 + 落地压缩
│        │         │         ├ elastic.out ─────┤   scaleY 0.55→1.0 振荡衰减
├ y 跳起 ──────────┤         │                  │   y: fromY → peakY (0~0.25s)
│        │         ├ y 落下 ──┤                  │   y: peakY → toY  (0.25~0.5s)
├ x 平移（全程 0.5s）─────────┤                  │   x: fromX → toX
```

**空中阶段（0~0.5s）**：scaleY 3 段无缝衔接，x/y 在 0.5s 内完成位移。

**落地阶段（0.5~1.4s）**：单个 `elastic.out(1, 0.35)` tween，scaleY 从 0.55 → 1.0。elastic.out 的数学曲线本身就是弹簧物理，会自动产生"冲过→回弹→再冲→再回"的振荡衰减（约 0.55 → ~1.15 → ~0.92 → ~1.08 → ... → 1.0），比手动分段更自然。duration 放宽到 0.9s 让振荡充分释放。

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

  const airTime = 0.5;            // 空中阶段时长
  const jumpHeight = cellH * 0.6;
  const half = airTime / 2;

  const fromY = gsap.getProperty(el, 'y') as number;
  const fromX = gsap.getProperty(el, 'x') as number;
  const peakY = Math.min(fromY, toY) - jumpHeight;

  const tl = gsap.timeline({ onComplete });

  // ── 空中阶段（0~0.5s）──

  // x 全程平移（空中阶段完成位移）
  tl.to(el, { x: toX, duration: airTime, ease: 'power1.inOut' }, 0);

  // y 抛物线：跳起（y 减小到 peakY）→ 落下（y 增大到 toY）
  tl.to(el, { y: peakY, duration: half, ease: 'power2.out' }, 0);
  tl.to(el, { y: toY, duration: half, ease: 'power2.in' }, half);

  // scaleY 弹簧形变（3 段：蓄力压缩 → 弹起拉伸 → 落地压缩）
  tl.to(el, { scaleY: 0.60, duration: 0.10, ease: 'power2.in'  }, 0);     // 蓄力压缩（弹簧压扁）
  tl.to(el, { scaleY: 1.20, duration: 0.15, ease: 'power2.out' }, 0.10);  // 弹起拉伸（弹簧释放）
  tl.to(el, { scaleY: 0.55, duration: 0.25, ease: 'sine.in'   }, 0.25);  // 空中渐回 + 落地压缩

  // ── 落地弹性阶段（0.5s+）──
  // elastic.out 自带振荡衰减：0.55 → 1.0 会冲到 ~1.15 → 回 ~0.92 → 弹 ~1.08 ... 逐渐收敛
  // duration 放宽到 0.9s，让弹簧振动充分释放，自然过渡到 idle
  tl.to(el, { scaleY: 1.0, duration: 0.9, ease: 'elastic.out(1, 0.35)' }, 0.50);
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

## 5. 弹出动画（复用现有 popUp）与到达弹起（arriveAnim）

### 5.1 场景

- 首次加载（curLoc 从 null 变为值，由 `MapGrid.onMounted → onEnter()` 接管）
- 传送/回退/长距离（>6 格）：`syncAllPositions()` + `onEnter()` popUp
- 玩家倒下状态移动：走 pendingIntent popUp 恢复
- 区域切换（curRegion 变化）：`arriveAnim` 淡入弹起（无倒下阶段）

### 5.2 popUp 实现（长距离/倒下恢复）

降级分支调 `syncAllPositions()` 瞬间定位 + `playerAvatarStore.onEnter()`，onEnter 经 `dispatchWithRecovery` 若 isDown=true 则暂存意图走 popUp 恢复，若 isDown=false 则直接派发 enter（setDown + popUp）强调"到达"。

```typescript
if (gridDist > 6.5) {
  isMoving = false;  // popUp 不需要 isMoving 保护
  syncAllPositions();
  playerAvatarStore.onEnter();  // 弹出强调到达
}
```

### 5.3 arriveAnim 实现（区域切换）

跨区域加载很快，倒下动画无法完整播放；arriveAnim 直接从透明缩小状态弹起出现，语义是"到达"而非"从地面爬起"。

```typescript
function arriveAnim(el: HTMLElement): void {
  gsap.killTweensOf(el);
  el.style.zIndex = String(Z_STANDING);
  gsap.set(el, { alpha: 0, scaleY: 0.3, scaleX: 0.3, rotation: 0 });
  const tl = gsap.timeline();
  tl.to(el, { alpha: 1, scaleY: 1, scaleX: 1, duration: 0.4, ease: 'back.out(1.7)' });
  tl.to(el, { scaleY: 1.02, scaleX: 0.99, duration: 0.6, ease: 'sine.inOut', yoyo: true, repeat: -1 });
}
```

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
    if (oldLoc === null) return;          // 首次加载，让 onEnter 接管
    if (newLoc === oldLoc) return;        // curLoc 未变化
    const isRegionChange = newRegion !== oldRegion;
    // ... 分级动画逻辑（isRegionChange 时走 arriveAnim）
  },
);
```

### 6.3 三种 curLoc 时序覆盖

| 场景 | watch 触发 | oldLoc | 行为 |
|------|-----------|--------|------|
| 预加载（mount 前 curLoc 已有值） | 不触发（watch 默认非 immediate） | — | onMounted 的 onEnter 接管，无冲突 |
| 异步加载（mount 后 null → 值） | 触发 | `null` | return，让 onEnter 接管 |
| 真实移动（mount 后值A → 值B） | 触发 | 值A（非 null） | 走分级动画（区域切换时走 arriveAnim） |

---

## 7. watch(curLoc) 改造

```typescript
const stopCurLocWatch = watch(
  () => [mapStore.curLoc, mapStore.curRegion] as const,
  ([newLoc, newRegion], [oldLoc, oldRegion]) => {
    if (oldLoc === null) return;
    if (newLoc === oldLoc) return;

    const isRegionChange = newRegion !== oldRegion;

    // 立即设 isMoving = true（同步阶段），防止 entities watch / ResizeObserver 的
    // syncAllPositions 在分级动画 rAF 启动前瞬移 player，导致 from === to 角色不动。
    // 降级分支和区域切换分支会重置 isMoving = false。
    isMoving = true;

    nextTick(() => requestAnimationFrame(() => {
      const grid = gridRef.value;
      const el = entityRefs.get('player');

      // 降级：倒下 / 无引用 → syncAllPositions + onMove（pendingIntent popUp）
      if (!grid || !el || playerAvatarStore.isDown) {
        isMoving = false;
        syncAllPositions();
        playerAvatarStore.onMove();
        return;
      }

      // 区域切换：arriveAnim 淡入弹起（无倒下阶段）
      if (isRegionChange) {
        isMoving = false;
        syncAllPositions();
        arriveAnim(el);
        return;
      }

      const fromX = gsap.getProperty(el, 'x') as number;
      const fromY = gsap.getProperty(el, 'y') as number;

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

      const gridDist = Math.max(Math.abs(toX - fromX) / cellW, Math.abs(toY - fromY) / cellH);

      gsap.set(el, { width: cellW, height: cellH });

      isMoving = true;
      animToken++;
      const myToken = animToken;
      const done = () => {
        // 旧动画被新动画的 killTweensOf 杀掉后，旧 timeline 会立即完成触发此 done。
        // 此时 myToken !== animToken，跳过 startIdle，避免杀掉新动画的 tween。
        if (myToken !== animToken) return;
        isMoving = false;
        updateEntityZIndex(el);
        startIdle(el);
      };

      if (gridDist <= 1.5) {
        // 鸭子步（1 格邻接）
        const direction: 1 | -1 | 0 = toX > fromX ? 1 : toX < fromX ? -1 : 0;
        moveActor(el, toX, toY, direction, done);
      } else if (gridDist <= 6.5) {
        // 棋子跳跃（2-6 格）
        jumpActor(el, toX, toY, cellH, done);
      } else {
        // 弹出（长距离）
        isMoving = false;
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
| `src/composables/useMapEntities.ts` | `jumpActor` 落地改用 `elastic.out`；新增 `arriveAnim` 函数；新增 `animToken` 令牌机制；`isMoving=true` 提前到同步阶段；`watch` 改为监听 `[curLoc, curRegion]` 双值；三级分级分发；区域切换走 `arriveAnim` |

无新增文件，无 CSS 改动，无类型改动。

---

## 9. 参数表

| 动画 | 参数 | 值 |
|------|------|----|
| 鸭子步 | duration | 0.5s |
| | swayAmp | 12° |
| | swayCycles | 2 |
| | scaleY 压缩 | 0.97 |
| 跳跃 | airTime（空中阶段） | 0.5s |
| | jumpHeight | cellH × 0.6 |
| | 蓄力压缩 | scaleY 0.60, 0.10s, `power2.in` |
| | 弹起拉伸 | scaleY 1.20, 0.15s, `power2.out` |
| | 空中渐回+落地压缩 | scaleY 0.55, 0.25s, `sine.in` |
| | 落地弹性 | scaleY 1.0, 0.9s, `elastic.out(1, 0.35)` |
| | y 峰值 | `min(fromY, toY) - jumpHeight` |
| arriveAnim | 淡入弹起 | alpha 0→1, scale 0.3→1, 0.4s, `back.out(1.7)` |
| | idle 循环 | scaleY 1.02 yoyo, 0.6s, `sine.inOut` |
| 弹出 | 复用 popUp | duration 0.9s elastic |

---

## 10. 风险与边界

### 10.1 鸭子步→跳跃的视觉过渡

1 格（鸭子步）与 2 格（跳跃）的动画风格差异较大，切换时可能有视觉断裂。可接受——距离差异本身就值得不同反馈。

### 10.2 跳跃 y 弧线与位置同步

跳跃期间 `isMoving=true`，`syncEntityPosition` 跳过玩家，避免 ResizeObserver 打断 y 弧线。跳跃完成后 `startIdle` 前 `isMoving=false`，位置已由 `jumpActor` 的 `y: toY` 保证准确。

### 10.3 连续移动竞态与 animToken 机制

**问题**：快速连续移动时，第二次移动的 `gsap.killTweensOf(el)` 会杀掉第一次 timeline 的子 tween。GSAP timeline 检测到子 tween 被杀后会**立即完成**并触发 `onComplete`（即 `done` 回调）。`done` 内的 `startIdle(el)` 又会调用 `gsap.killTweensOf(el)`，**杀掉第二次 timeline 的 tween**，导致第二次动画的 player 停在起点不动。

**根因链**（以跳跃为例）：
1. 第一次 jumpActor：x/y 在 0.5s airTime 完成到达目标，scaleY 的 `elastic.out` 在 0.5~1.4s 振荡
2. 用户在振荡期间触发第二次移动 → jumpActor2 调用 `gsap.killTweensOf(el)`
3. killTweensOf 杀掉 jumpActor1 的 scaleY tween → timeline1 立即完成 → 触发 done1
4. done1 调用 `startIdle(el)` → `gsap.killTweensOf(el)` → **杀掉 timeline2 的 tween**
5. timeline2 立即完成触发 done2，player 停在 from 位置（第一次的目标），未移动到第二次的目标
6. isMoving=false，但 entities watch 不会再次触发 syncAllPositions（curLoc 未变），player 卡在错误位置
7. 改变窗口大小触发 ResizeObserver → syncAllPositions → gsap.set player 到 curLoc 对应位置（瞬移修正）

**修复**：animToken 令牌机制。每次启动新移动动画递增 `animToken`，`done` 回调检查闭包捕获的 `myToken` 是否等于当前 `animToken`：
- 旧动画被杀触发的旧 `done`：`myToken !== animToken` → `return`，不执行 `startIdle`，不杀新动画的 tween
- 新动画正常完成的 `done`：`myToken === animToken` → 执行 `isMoving=false` + `startIdle`

```typescript
let animToken = 0;
// ...
animToken++;
const myToken = animToken;
const done = () => {
  if (myToken !== animToken) return;  // 旧动画被取代，跳过
  isMoving = false;
  updateEntityZIndex(el);
  startIdle(el);
};
```

**副作用**：无。旧 done 被跳过后 isMoving 保持 true（新动画已设置），新动画 done 正常重置。token 为 JS 安全整数（2^53），实际不会溢出。

### 10.4 isMoving 同步设置

`isMoving = true` 在 `watch` 回调的**同步阶段**立即设置（rAF 之前），防止 `entities watch` 和 `ResizeObserver` 的 `syncAllPositions` 在分级动画 rAF 启动前瞬移 player（`gsap.set x/y` 到新格），导致 `from === to` 角色不动。

降级分支（!grid || !el || isDown）和区域切换分支（arriveAnim）会重置 `isMoving = false`，允许 `syncAllPositions` 同步 player。

### 10.5 首次挂载时序

`watch(curLoc)` 通过 `oldVal` 判断首次加载：curLoc 从 `null` 变为值时 `oldVal === null`，return 跳过，让 `MapGrid.onMounted` 的 `onEnter()` 独立执行 popUp。curLoc 预加载时 watch 默认非 immediate 不触发。两者不冲突。

### 10.6 onEnter 进行中的移动打断

若用户在 onEnter 的 popUp 进行中（挂载后 0.9s 内）触发移动，`watch(curLoc)` 会走分级动画，`gsap.killTweensOf` 打断 popUp。此时 `isDown=false`（onEnter 不改 isDown），不走 pendingIntent 暂存。视觉上是 popUp 中途开始移动，可接受（罕见场景，且 popUp 的弹性回弹已部分完成）。

### 10.7 长距离移动的 onEnter 语义

长距离移动（>6.5 格）调 `onEnter()` 复用 popUp 强调到达。onEnter 在 isDown=false 时派发 enter 意图 → setDown + popUp，立绘在目标格"从倒下状态弹起"。语义上 onEnter 原为"进入"场景，此处复用为"到达强调"，视觉效果一致（setDown 倒下极短暂，紧接 popUp 弹起）。若后续需要语义区分，可新增 `onArrive` action，但当前无需。
