# 玩家小人重构设计案

> 目标：P0 接入游戏事件 + P1 方案 B 架构解耦（stores/player-avatar.ts）。
> 原则：先建管道后填肉——事件→意图→动画三层映射建好，动画层暂沿用现有 popup/fall/idle，未来扩展新特效时只改动画层。
> 相关代码：[MapGrid.vue](../src/components/map/MapGrid.vue) · [battle.ts](../src/stores/battle.ts) · [battle-director.ts](../src/stores/battle-director.ts) · [player.ts](../src/stores/player.ts) · [StatusBar.vue](../src/components/layout/StatusBar.vue) · [MapContainer.vue](../src/components/map/MapContainer.vue) · [events.ts](../src/types/events.ts) · [api.ts](../src/types/api.ts)

---

## 一、设计目标

| # | 目标 | 验收标准 |
|---|------|---------|
| 1 | **接入游戏事件**：让小人在战斗/移动/HP 变化时有反馈 | 玩家受击（hpSnapshot 过滤）、死亡（combatant_cleared 实时 + winnerPid 兜底）、战斗开始/结束（含主动+被动入口）、移动、HP 危险时小人触发对应意图 |
| 2 | **架构解耦**：动画逻辑从 MapGrid.vue 抽离到 store + composable | MapGrid.vue 减少 ~90 行 GSAP 代码，动画状态由 store 驱动 |
| 3 | **预留扩展接口**：每个接入事件预留意图枚举与 handler 钩子 | 未来新增 flinch/battle-idle/low-hp-idle 等特效时，事件层和意图层零改动 |
| 4 | **沿用现有特效**：动画层暂时只调用 popup/fall/idle | 不引入新动画素材、不写新 GSAP timeline |
| 5 | **调试按钮迁移**：从 StatusBar 移到地图缩放条左侧 | 缩放控件左侧出现 `弹` / `倒` 调试按钮 |
| 6 | **死亡恢复路径**：fall 后能自动站起 | isDown 状态机 + pendingIntent 回调链：任何非死亡意图触发时若 isDown=true，先 popUp 站起，回弹完成后派发实际意图 |

---

## 二、架构分层

```
┌─────────────────────────────────────────────────────────────┐
│  事件源层（Stores）                                          │
│  battle.ts / map.ts / player.ts / 调试按钮                   │
│    ↓ 调用 playerAvatarStore.onXxx()                         │
├─────────────────────────────────────────────────────────────┤
│  意图层（playerAvatarStore）                                 │
│  state: { intent, isDown, hpRatio, pendingIntent }          │
│  actions: onEnter/onMove/onBattleStart/onHit/onDie/...      │
│    ↓ watch(intent) 触发                                     │
├─────────────────────────────────────────────────────────────┤
│  动画层（usePlayerAvatar composable）                        │
│  INTENT_HANDLERS: Record<intent, () => void>                │
│    ├─ 'enter'  → setDown + popUp                            │
│    ├─ 'move'   → resetTransform + startIdle                 │
│    ├─ 'hit'    → (预留 flinch) → startIdle                  │
│    ├─ 'die'    → fall                                       │
│    └─ ...                                                   │
│    ↓ 调用 GSAP                                              │
├─────────────────────────────────────────────────────────────┤
│  DOM 层（MapGrid.vue 中的 <img ref="avatarRef">）            │
└─────────────────────────────────────────────────────────────┘
```

**关键解耦点**：
- 事件源只调 store action，不关心动画如何执行
- Store 只存意图状态，不关心 GSAP
- Composable 只响应意图变化，不关心事件来源
- 未来扩展：新增特效只改 INTENT_HANDLERS，新增事件只加 store action

---

## 三、意图清单与事件接入点

### 3.1 意图枚举

```typescript
export type PlayerAvatarIntent =
  | 'enter'         // 入场（首次加载）
  | 'move'          // 移动到新格
  | 'battle-start'  // 战斗开始（主动攻击或被动遭遇）
  | 'battle-end'    // 战斗结束
  | 'hit'           // 玩家受击（真实掉血）
  | 'die'           // 玩家死亡
  | 'low-hp'        // HP 进入危险区（< 30%）
  | 'normal-hp'     // HP 恢复到安全区（≥ 30%）
  | 'popup'         // 调试：弹起
  | 'fall'          // 调试：倒下
  | 'idle';         // 兜底：重置到 idle
```

### 3.2 事件接入点表

| 意图 | 接入位置 | 当前代码 | 改造后 |
|------|---------|---------|--------|
| `enter` | MapGrid.vue `onMounted` (line 256-263) | `setAvatarDown(el); popUpAvatar(el)` | `playerAvatarStore.onEnter()` |
| `move` | MapGrid.vue `watch(curLoc)` (line 184-195) | `resetAvatarTransform; gsap.set; startIdleAnimation` | `playerAvatarStore.onMove()` |
| `battle-start`（主动） | battle.ts `startBattle` (line 249-268) | `broadcast('battle:started')` | **追加** `playerAvatarStore.onBattleStart()` |
| `battle-start`（被动） | battle.ts `enterBattleMode` (line 187-201) | 无广播 | **追加** `playerAvatarStore.onBattleStart()` |
| `battle-end` | battle.ts `exitBattleMode` (line 208-222) | `broadcast('battle:ended')` | **追加** `playerAvatarStore.onBattleEnd()` |
| `hit` | battle.ts `playTurnSegment` 循环 (line 443-463) | 仅 `broadcast('battle:play-collision')` | 循环内**追加**：若 `target_pid === currentPid` **且 hpSnapshot 显示真实掉血** 则 `playerAvatarStore.onHit()` |
| `die`（主判定） | battle.ts `playTurnSegment` 循环 | 未利用 combatant_cleared | 循环内**追加**：遇 `directedKind === 'combatant_cleared'` 且 `cleared_pid === currentPid` 且 `reason === 'death'` 即 `onDie()` |
| `die`（兜底） | battle.ts `playBattleEndSegment` (line 466) | 仅播放模态框 | **追加**：若 `segment.meta.winnerPid !== currentPid` 则 `onDie()` |
| `low-hp` / `normal-hp` | player store `loadPlayerInfo` 后 | 无 | MapGrid.vue `watch(() => playerStore.hp / playerStore.mhp)` 触发 |
| `popup` / `fall` | MapContainer.vue 调试按钮 | `broadcast('player:popup'/'player:fall')` | `playerAvatarStore.debugPopUp()` / `debugFall()` |

**两个战斗开始入口**：
- `startBattle`（玩家主动攻击）：广播 `battle:started`，已有事件流
- `enterBattleMode`（被动遭遇战，敌人发现玩家）：**无任何广播**，当前完全静默
- 两者都必须触发 `onBattleStart()`，否则被动遭遇战时小人不切战斗意图

### 3.3 受击判定细节

利用导演系统输出的 DirectedEntry（已合并 pre/post，含 `hpSnapshot`），比裸 entry 字段判定更精确。

**DirectedEntry 关键字段**（见 [battle-director.ts](../src/stores/battle-director.ts) line 50-57）：
- `target_pid` / `target_type` (0=player, 1=npc) — 受击方（继承自 BattleLogEntry）
- `hpSnapshot: HpSnapshot | null` — HP 配对快照，非伤害动作时为 null（line 54）
- `effect_value` — 伤害数值（未来 flinch 动画可读此字段决定幅度）
- `directedKind === 'action'` — 明确是 pre+post 合并的动作条目

**HpSnapshot 字段**（[battle-director.ts](../src/stores/battle-director.ts) line 30-37）：
- `targetHpBefore` / `targetHpAfter` / `targetMaxHp`

**玩家受击判定**（用 hpSnapshot 过滤无效受击）：
```typescript
const isPlayerHit =
  Number(e.target_pid) === currentPid.value
  && Number(e.target_type) === 0
  && e.hpSnapshot !== null
  && e.hpSnapshot.targetHpAfter < e.hpSnapshot.targetHpBefore;  // 真实掉血
```

**为什么需要 hpSnapshot 过滤**：
- 未命中的攻击（`effect_value=0`）也会产生 `target_pid === currentPid` 的 action entry，但 `targetHpAfter === targetHpBefore`
- 当前 hit 意图映射到 idle，过滤与否视觉无差；但未来加 flinch 红闪时，闪避/未命中不应该闪
- 用 `hpSnapshot.targetHpAfter < targetHpBefore` 确保只有真实掉血才触发

**注意**：玩家攻击敌人时 `actor_type === 0`，`target` 是敌人，不会匹配上述判定。仅当 `target` 是玩家时触发。

### 3.4 死亡判定细节

死亡判定采用**双判定**：主判定在 turn 段循环实时触发，兜底判定在 battle_end 段补判。

#### 主判定：combatant_cleared（turn 段循环内，实时）

导演系统输出 `directedKind === 'combatant_cleared'` 的条目（[battle-director.ts](../src/stores/battle-director.ts) line 44）。BattleLogEntry 含 `cleared_pid` / `cleared_name` / `reason` 字段（[api.ts](../src/types/api.ts) line 323-326）。当前播放系统未利用此条目（仅交模态框渲染文字），本次改造在 turn 段循环中新增分支处理。

```typescript
// playTurnSegment 循环内
if (
  e.directedKind === 'combatant_cleared'
  && Number(e.cleared_pid) === currentPid.value
  && e.reason === 'death'
) {
  usePlayerAvatarStore().onDie();
}
```

**优势**：玩家被一击毙命时立即倒下，不用等 battle_end 段模态框播放完毕。视觉响应即时。

**额外数据**：combatant_cleared 还能区分"敌人死亡"（`cleared_pid !== currentPid`），未来可触发胜利动画（本次不在 11 种意图中，但数据已就绪）。

**reason 字段值待确认**：文档假设 `reason === 'death'` 表示死亡，`reason === 'escaped'` 表示逃跑。实施前需 console.log 确认后端实际返回值（见 §10 步骤 4 字段确认）。

#### 兜底判定：battle_end.winnerPid（playBattleEndSegment 内）

`segment.meta.winnerPid`（见 [battle-director.ts](../src/stores/battle-director.ts) line 82，`SegmentMeta.winnerPid?: number`）。

```typescript
// playBattleEndSegment 内
const winnerPid = segment.meta?.winnerPid;
if (winnerPid != null && Number(winnerPid) !== currentPid.value) {
  usePlayerAvatarStore().onDie();
}
```

**作用**：万一 combatant_cleared 条目异常缺失（导演配对失败降级为 display 等），winnerPid 仍能补判。store 内部的 `dispatchIntent` 已有 50ms 防抖，重复触发不会执行两次 fall 动画。

**边界**：
- `winnerPid` 为 null/undefined（异常情况）：不触发兜底，保守保持现状
- `reason === 'escaped'`（逃跑被清出队列）：不触发 die（玩家逃跑不算死亡）

---

## 四、playerAvatarStore 设计

文件：`src/stores/player-avatar.ts`

### 4.1 State

```typescript
interface PlayerAvatarState {
  /** 当前意图（动画层 watch 此字段派发） */
  intent: PlayerAvatarIntent;
  /** 当前是否倒下（fall 后 = true，popUp 回弹完成 = false） */
  isDown: boolean;
  /** HP 比例 0-1（供未来 low-hp 动画层使用） */
  hpRatio: number;
  /** 上次意图时间戳（防抖/去重用） */
  lastIntentTs: number;
  /** 恢复期间暂存的意图：dispatchWithRecovery 在 popUp 期间保存 next，notifyUp 时派发 */
  pendingIntent: PlayerAvatarIntent | null;
}
```

### 4.2 Actions

```typescript
const playerAvatarStore = defineStore('playerAvatar', () => {
  const intent = ref<PlayerAvatarIntent>('idle');
  const isDown = ref(false);
  const hpRatio = ref(1);
  const lastIntentTs = ref(0);
  const pendingIntent = ref<PlayerAvatarIntent | null>(null);

  // ── 内部：派发意图 ──
  function dispatchIntent(next: PlayerAvatarIntent): void {
    const now = Date.now();
    // 防抖：同一意图 50ms 内重复触发只执行一次
    if (next === intent.value && now - lastIntentTs.value < 50) return;
    lastIntentTs.value = now;
    intent.value = next;
  }

  // ── 自动恢复机制（回调链，非 setTimeout） ──
  // 任何"非 die/fall"意图触发时，若 isDown=true：
  //   1. 暂存 next 到 pendingIntent
  //   2. 只派发 'popup'（popUp 动画开始）
  //   3. popUp 回弹完成时 composable 调 notifyUp()
  //   4. notifyUp 派发 pendingIntent（此时 popUp 已完成，不会被打断）
  function dispatchWithRecovery(next: PlayerAvatarIntent): void {
    if (next !== 'die' && next !== 'fall' && isDown.value) {
      pendingIntent.value = next;
      dispatchIntent('popup');
      return;
    }
    dispatchIntent(next);
  }

  // ── 游戏事件接入（预留接口） ──
  function onEnter(): void       { dispatchWithRecovery('enter'); }
  function onMove(): void        { dispatchWithRecovery('move'); }
  function onBattleStart(): void { dispatchWithRecovery('battle-start'); }
  function onBattleEnd(): void   { dispatchWithRecovery('battle-end'); }
  function onHit(): void         { dispatchWithRecovery('hit'); }
  function onDie(): void         { dispatchIntent('die'); }   // 死亡不恢复
  function onLowHp(): void       { dispatchWithRecovery('low-hp'); }
  function onNormalHp(): void    { dispatchWithRecovery('normal-hp'); }

  // ── 调试接口 ──
  function debugPopUp(): void    { dispatchIntent('popup'); }
  function debugFall(): void     { dispatchIntent('fall'); }

  // ── 内部：动画层回调通知 ──
  // 由 usePlayerAvatar 在 popUp 回弹完成 / fall 完成时调用
  function notifyUp(): void {
    isDown.value = false;
    // 恢复完成后派发暂存的意图
    if (pendingIntent.value) {
      const pending = pendingIntent.value;
      pendingIntent.value = null;
      dispatchIntent(pending);
    }
  }
  function notifyDown(): void {
    isDown.value = true;
    pendingIntent.value = null;  // 倒下时清空 pending（防止 fall 期间堆积）
  }

  // ── HP 比例更新（由组件 watch 后调用） ──
  function setHpRatio(ratio: number): void {
    hpRatio.value = ratio;
  }

  return {
    intent, isDown, hpRatio, lastIntentTs, pendingIntent,
    onEnter, onMove, onBattleStart, onBattleEnd, onHit, onDie, onLowHp, onNormalHp,
    debugPopUp, debugFall,
    notifyUp, notifyDown, setHpRatio,
    dispatchIntent, // 暴露供测试
  };
});
```

### 4.3 设计要点

1. **防抖**：同一意图 50ms 内重复只执行一次（避免 battlelog 多条同回合受击连环触发）。注意：未来加 flinch 动画时，连续受击的第二次 flinch 可能被误杀，届时可降阈值到 16ms（一帧）或改由动画层自行决定是否打断
2. **自动恢复用回调链（非 setTimeout）**：`dispatchWithRecovery` 暂存 next 到 `pendingIntent`，只派发 `popup`；`notifyUp` 在 popUp 回弹完成后派发 pendingIntent。**不使用 setTimeout**，避免 100ms 后 next handler 的 `killTweensOf` 打断 popUp 动画
3. **isDown 由动画层回调更新**：composable 在 popUp 回弹完成 / fall 完成时调 `notifyUp/notifyDown`，store 不主动猜测。注意 popUp 的 notifyUp 必须挂在回弹 tween 上（非 timeline onComplete，因末尾 idle 循环 `repeat: -1` 会导致 timeline 永不完成）
4. **pendingIntent 在 notifyDown 时清空**：防止 fall 期间堆积的 pending 意图在下次 popUp 时误触发
5. **预留字段**：`hpRatio` 当前未被动画层使用，但已存入 store，未来 low-hp 动画直接读取

---

## 五、usePlayerAvatar composable 设计

文件：`src/composables/usePlayerAvatar.ts`

### 5.1 接口

```typescript
import type { Ref } from 'vue';

export function usePlayerAvatar(avatarRef: Ref<HTMLElement | null>): {
  /** 供外部主动触发（备用，主要靠 store 驱动） */
  popUp: () => void;
  fall: () => void;
  startIdle: () => void;
  /** 卸载时清理（killTweensOf + 停 watch） */
  dispose: () => void;
};
```

### 5.2 实现

```typescript
import { watch, nextTick } from 'vue';
import gsap from 'gsap';
import { usePlayerAvatarStore } from '@/stores/player-avatar';
import type { PlayerAvatarIntent } from '@/types/player-avatar';

export function usePlayerAvatar(avatarRef: Ref<HTMLElement | null>) {
  const store = usePlayerAvatarStore();

  // ── GSAP 基础函数（从 MapGrid.vue 搬迁，逻辑不变） ──
  function resetTransform(el: HTMLElement): void {
    gsap.set(el, {
      xPercent: -50,
      yPercent: 0,
      transformOrigin: 'bottom center',
    });
  }

  function setDown(el: HTMLElement): void {
    gsap.killTweensOf(el);
    resetTransform(el);
    gsap.set(el, {
      scaleY: 0.04,
      scaleX: 1,
      rotation: -90,
      alpha: 0.25,
    });
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

  // 注意：notifyUp 挂在回弹 tween 的 onComplete 上，而非 timeline.onComplete
  // 原因：timeline 末尾是 repeat:-1 的 idle 循环，timeline 永不完成
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
      onComplete: () => store.notifyUp(),  // 回弹完成时通知 store
    });
    tl.to(el, {
      scaleY: 1.02, scaleX: 0.99,
      duration: 0.6, ease: 'sine.inOut',
      yoyo: true, repeat: -1,
    });
  }

  function fall(el: HTMLElement): void {
    gsap.killTweensOf(el);
    const tl = gsap.timeline({
      onComplete: () => store.notifyDown(),  // fall 末尾无 repeat，timeline 能正常完成
    });
    tl.to(el, {
      rotation: -22, scaleY: 1.05, scaleX: 0.96,
      duration: 0.1, ease: 'power1.out',
    });
    tl.to(el, {
      rotation: -90, scaleY: 0.04, scaleX: 1, alpha: 0,
      duration: 0.32, ease: 'power2.in',
    });
  }

  // ── 意图 → 动画映射（核心预留点） ──
  // 当前所有非 die/fall/popup 意图都映射到 idle（沿用现有特效）
  // 未来扩展：在此表中替换 handler 即可，事件层和 store 零改动
  const INTENT_HANDLERS: Record<PlayerAvatarIntent, (el: HTMLElement) => void> = {
    'enter':        (el) => { setDown(el); popUp(el); },                          // 入场：先倒下再弹起
    'move':         (el) => { resetTransform(el); gsap.set(el, { scaleY: 1, scaleX: 1, rotation: 0, alpha: 1 }); startIdle(el); },
    'battle-start': (el) => { startIdle(el); },  // 预留：未来切战斗 idle
    'battle-end':   (el) => { startIdle(el); },  // 预留：未来 victory 动画
    'hit':          (el) => { startIdle(el); },  // 预留：未来 flinch 红闪
    'die':          (el) => { fall(el); },
    'low-hp':       (el) => { startIdle(el); },  // 预留：未来 low-hp 摇晃
    'normal-hp':    (el) => { startIdle(el); },  // 预留：未来恢复正常
    'popup':        (el) => { setDown(el); popUp(el); },  // 调试：先倒下再弹起（与原代码一致）
    'fall':         (el) => { fall(el); },       // 调试：直接倒下
    'idle':         (el) => { startIdle(el); },
  };

  // ── watch store.intent 派发动画 ──
  const stopWatch = watch(
    () => store.intent,
    (next: PlayerAvatarIntent) => {
      nextTick(() => {
        const el = avatarRef.value;
        if (!el) return;
        const handler = INTENT_HANDLERS[next];
        if (handler) handler(el);
      });
    },
  );

  function dispose(): void {
    stopWatch();
    const el = avatarRef.value;
    if (el) gsap.killTweensOf(el);
  }

  return {
    popUp: () => { const el = avatarRef.value; if (el) popUp(el); },
    fall: () => { const el = avatarRef.value; if (el) fall(el); },
    startIdle: () => { const el = avatarRef.value; if (el) startIdle(el); },
    dispose,
  };
}
```

### 5.3 设计要点

1. **GSAP 函数完整搬迁**：不修改任何动画参数，保证视觉一致
2. **INTENT_HANDLERS 是唯一扩展点**：未来加 flinch 红闪，只需改 `'hit': (el) => { flinch(el); }`
3. **popUp 的 notifyUp 挂在回弹 tween 上**（第三个 tween 的 `onComplete`），**不是 timeline.onComplete**。原因：timeline 末尾是 `repeat: -1` 的 idle 循环，timeline 永不完成，若挂在 timeline 上 notifyUp 永不触发
4. **fall 的 notifyDown 挂在 timeline.onComplete**：fall 末尾无 repeat，timeline 能正常完成
5. **'popup' handler 是 setDown + popUp**：与原 MapGrid.vue 的调试弹起逻辑一致（先倒下再弹起），而非直接从 idle 弹起
6. **avatarRef 由外部传入**：解耦 DOM 获取方式，MapGrid.vue 用 `ref="avatarRef"`
7. **不 import onUnmounted**：dispose 由外部显式调用（MapGrid.vue 的 onUnmounted 内调 `avatarAnim.dispose()`）

---

## 六、MapGrid.vue 改造点

### 6.1 删除内容

| 行号 | 内容 | 原因 |
|------|------|------|
| 92-181 | 全部 GSAP 函数（getPlayerAvatar/resetAvatarTransform/setAvatarDown/startIdleAnimation/popUpAvatar/fallAvatar） | 迁移到 usePlayerAvatar |
| 184-195 | `watch(mapStore.curLoc)` 内的动画逻辑 | 改为调用 store.onMove() |
| 197-199 | `onDebugPopup` / `onDebugFall` 监听器 | store 接管调试事件 |
| 252-254 | `dataManager.listen('player:popup'/'player:fall')` | 调试按钮改为直调 store |
| 256-263 | onMounted 首次入场动画 | 改为调用 store.onEnter() |
| 273-274 | `dataManager.unlisten(...)` | 同上 |

### 6.2 新增内容

```typescript
import { usePlayerAvatar } from '@/composables/usePlayerAvatar';
import { usePlayerAvatarStore } from '@/stores/player-avatar';
import { usePlayerStore } from '@/stores/player';

const playerAvatarStore = usePlayerAvatarStore();
const playerStore = usePlayerStore();

// ── 立绘 DOM 引用（替代 querySelector） ──
const avatarRef = ref<HTMLElement | null>(null);

// ── 初始化动画 composable ──
const avatarAnim = usePlayerAvatar(avatarRef);

// ── 移动时触发 onMove 意图 ──
watch(
  () => mapStore.curLoc,
  () => {
    playerAvatarStore.onMove();
  },
);

// ── HP 危险/恢复触发 ──
watch(
  () => {
    const mhp = playerStore.mhp || 1;
    return playerStore.hp / mhp;
  },
  (ratio) => {
    playerAvatarStore.setHpRatio(ratio);
    if (ratio < 0.3) {
      playerAvatarStore.onLowHp();
    } else {
      playerAvatarStore.onNormalHp();
    }
  },
);

onMounted(() => {
  // ... 原有逻辑保留 ...

  // 首次入场：触发 enter 意图（动画层会 setDown + popUp）
  nextTick(() => {
    playerAvatarStore.onEnter();
  });
});

onUnmounted(() => {
  // ... 原有逻辑保留 ...
  avatarAnim.dispose();
});
```

### 6.3 模板改造

```vue
<!-- 当前格：角色立绘 + 前缀 + 地名 -->
<template v-else-if="cell.isCurrent">
  <img
    ref="avatarRef"
    :key="mapStore.curLoc ?? 'none'"
    class="player-avatar"
    src="/img/4.png"
    alt="player"
  />
  <span class="cell-name pulse-white player-label">
    {{ cell.prefix }}{{ cell.displayLabel }}
  </span>
</template>
```

**关键变化**：
- `<img>` 添加 `ref="avatarRef"`（替代 querySelector）
- `:key` 保留以维持移动时强制重建行为（动画状态重置）

### 6.4 注意事项

- `avatarRef` 在 `<img>` 销毁时会自动变为 `null`，composable 内部已处理 `if (!el) return`
- 移动时 `:key` 变化导致 `<img>` 重建，`avatarRef` 先变 null 再变新元素。`watch(curLoc)` 触发 `onMove` 时 `nextTick` 内 `avatarRef.value` 已指向新元素
- HP watch 首次挂载时也会触发一次（ratio 从 undefined → 实际值），但此时 `avatarRef` 可能为 null，composable 内部 `if (!el) return` 兜底
- onEnter 在 onMounted 的 nextTick 内调用，若此时地图未加载完成（`cell.isCurrent` 为 false），avatarRef 为 null，enter 意图被跳过。这是可接受的——地图加载完成后 curLoc 变化会触发 onMove，小人会进入 idle（视觉上跳过弹起）。若需保证弹起效果，可改为 watch avatarRef 首次非 null 时触发 onEnter（本次不做，列为未来优化）

---

## 七、调试按钮迁移

### 7.1 StatusBar.vue 删除

```vue
<!-- 第三行：按钮 -->
<div class="status-bar-row">
  <button class="status-bar-btn" @click="uiStore.togglePlayerDrawer">[属性]</button>
  <button class="status-bar-btn" @click="onBattleBtnClick">[{{ uiStore.battleBtnText() }}]</button>
  <button class="status-bar-btn" @click="uiStore.toggleInventoryDrawer">[背包]</button>
  <span class="status-bar-divider">|</span>
  <button class="status-bar-btn debug" @click="dataManager.broadcast('player:popup')">[弹起]</button>   <!-- 删除 -->
  <button class="status-bar-btn debug" @click="dataManager.broadcast('player:fall')">[倒下]</button>    <!-- 删除 -->
</div>
```

### 7.2 MapContainer.vue 新增

在 `.zoom-controls` 左侧插入调试按钮组：

```vue
<!-- 缩放控件（id 保留供 useMapInteraction 绑定事件） -->
<div class="zoom-controls" title="Ctrl+滚轮缩放 | 拖拽平移">
  <!-- 调试按钮组（玩家小人动画） -->
  <div class="avatar-debug-group" title="玩家立绘动画调试">
    <button
      class="zoom-btn debug"
      @click="playerAvatarStore.debugPopUp()"
    >弹</button>
    <button
      class="zoom-btn debug"
      @click="playerAvatarStore.debugFall()"
    >倒</button>
  </div>
  <span class="zoom-controls-divider">|</span>
  <button id="zoomOut" class="zoom-btn">-</button>
  <span id="zoomLevel" class="zoom-label">1.0x</span>
  <button id="zoomIn" class="zoom-btn">+</button>
</div>
```

```typescript
// MapContainer.vue <script setup>
import { usePlayerAvatarStore } from '@/stores/player-avatar';
const playerAvatarStore = usePlayerAvatarStore();
```

### 7.3 CSS（terminal.css 追加）

```css
/* 调试按钮组（缩放条左侧） */
.zoom-controls .avatar-debug-group {
  display: inline-flex;
  gap: 2px;
}
.zoom-controls .avatar-debug-group .zoom-btn.debug {
  font-size: 10px;
  color: #888;
  width: auto;
  min-width: 28px;
  padding: 0 4px;
}
.zoom-controls .avatar-debug-group .zoom-btn.debug:hover {
  color: #fff;
  background: #333;
}
.zoom-controls-divider {
  color: #444;
  margin: 0 2px;
}
```

### 7.4 按钮文字说明

按钮文字从 `[弹起]` / `[倒下]` 简化为 `弹` / `倒`，因为缩放条空间有限，且与 `+` / `-` 按钮视觉对齐。鼠标悬停有 `title` 提示完整说明。

---

## 八、battle.ts 改造点

### 8.1 startBattle（line 249-268）— 主动攻击入口

```typescript
function startBattle(enemyPid: number): void {
  if (currentMode.value !== 'normal') return;
  // ... 原有逻辑 ...

  dataManager.broadcast('battle:started', { enemyPid });

  // ── 新增：玩家小人战斗开始意图 ──
  usePlayerAvatarStore().onBattleStart();
}
```

### 8.2 enterBattleMode（line 187-201）— 被动遭遇战入口

```typescript
function enterBattleMode(enemyPid: number, playerTurn: boolean): void {
  if (currentMode.value === 'battle' && currentEnemyPid.value === enemyPid) {
    updateActionPanel(playerTurn);
    return;
  }

  currentMode.value = 'battle';
  currentEnemyPid.value = enemyPid;
  enemyName.value = '';
  enemyLocation.value = null;

  updateActionPanel(playerTurn);

  // ── 新增：玩家小人战斗开始意图（被动遭遇战） ──
  // 注意：此函数原本无任何广播，被动遭遇战时小人不会切战斗意图
  usePlayerAvatarStore().onBattleStart();
}
```

**为什么需要这里也接入**：`enterBattleMode` 是敌人发现玩家时的被动遭遇战入口，与 `startBattle`（玩家主动攻击）都是进入战斗模式。两者都必须触发 `onBattleStart()`，否则被动遭遇战时小人不切战斗意图。

### 8.3 exitBattleMode（line 208-222）

```typescript
function exitBattleMode(): void {
  if (currentMode.value === 'normal') return;
  // ... 原有逻辑 ...

  dataManager.invalidate('enemies');
  dataManager.broadcast('battle:ended');

  // ── 新增：玩家小人战斗结束意图 ──
  usePlayerAvatarStore().onBattleEnd();
}
```

### 8.4 playTurnSegment（line 443-463）— 受击 + 死亡主判定

```typescript
async function playTurnSegment(segment: PlaySegment, npcPid: number): Promise<void> {
  updateEnemyNameFromSegment(segment);
  await refreshEnemyLocation(npcPid);

  // 碰撞动画 + 受击意图 + 死亡主判定
  for (const e of segment.entries) {
    if (e.animation === 'collision') {
      dataManager.broadcast('battle:play-collision', { entry: e, npcPid });
      // ── 新增：玩家受击意图（用 hpSnapshot 过滤无效受击） ──
      if (
        Number(e.target_pid) === currentPid.value
        && Number(e.target_type) === 0
        && e.hpSnapshot !== null
        && e.hpSnapshot.targetHpAfter < e.hpSnapshot.targetHpBefore
      ) {
        usePlayerAvatarStore().onHit();
      }
      await sleep(COLLISION_ANIM_DURATION);
    }

    // ── 新增：玩家死亡主判定（combatant_cleared 实时触发） ──
    // 当前播放系统未利用此条目，本次改造新增分支
    if (
      e.directedKind === 'combatant_cleared'
      && Number(e.cleared_pid) === currentPid.value
      && e.reason === 'death'
    ) {
      usePlayerAvatarStore().onDie();
    }
  }

  await playSegmentInModal(segment, { npcPid });

  dataManager.broadcast('battle:play-damage-numbers', {
    entries: segment.entries,
    npcPid,
  });
}
```

**关键设计点**：
- **hit 用 hpSnapshot 过滤**：只有真实掉血（`targetHpAfter < targetHpBefore`）才触发，未命中/0 伤害不触发。当前映射 idle 无视觉差异，但为未来 flinch 红闪预留正确语义。
- **die 主判定用 combatant_cleared**：玩家被清出队列的瞬间立即倒下，不等 battle_end 段。store 内部 50ms 防抖保证不会因兜底重复触发而执行两次 fall 动画。
- **combatant_cleared 分支与 collision 分支并列**：两者互斥（一条 entry 不会同时是 collision 和 combatant_cleared），用 `if` 而非 `else if` 以应对未来可能的新 DirectedKind。

### 8.5 playBattleEndSegment（line 466）— 死亡兜底判定

```typescript
async function playBattleEndSegment(segment: PlaySegment, npcPid: number): Promise<void> {
  // ── 兜底：玩家死亡意图（万一 combatant_cleared 主判定未触发） ──
  // 主判定在 playTurnSegment 循环内的 combatant_cleared 分支
  const winnerPid = segment.meta?.winnerPid;
  if (winnerPid != null && Number(winnerPid) !== currentPid.value) {
    usePlayerAvatarStore().onDie();
  }

  await playSegmentInModal(segment, { npcPid, isBattleEnd: true });
}
```

**兜底场景**：导演配对异常导致 combatant_cleared 条目降级为 display（失去 directedKind 标记）时，主判定失效，此处仍能通过 winnerPid 补判。store 内 `dispatchIntent` 的 50ms 防抖 + isDown 状态机保证重复调用安全。

### 8.6 注意事项

- `usePlayerAvatarStore()` 在函数内部调用（非顶部），因为 Pinia store 需在 `createPinia()` 之后才能使用。battle.ts 顶部已有 `usePlayerStore` / `useToastStore` 等同样模式
- `segment.meta.winnerPid` 类型已在 `SegmentMeta` 接口定义（[battle-director.ts](../src/stores/battle-director.ts) line 82），无需 any 兜底
- `e.cleared_pid` / `e.reason` 字段类型在 `BattleLogEntry` 已定义（[api.ts](../src/types/api.ts) line 323-326），combatant_cleared 条目必有
- `e.hpSnapshot` 类型为 `HpSnapshot | null`（[battle-director.ts](../src/stores/battle-director.ts) line 54），非伤害动作（escape 等）为 null，判定时已显式检查 `!== null`
- `e.directedKind` 类型为 `DirectedKind`（[battle-director.ts](../src/stores/battle-director.ts) line 56），含 `'combatant_cleared'`（line 44）

---

## 九、类型定义新增

### 9.1 types/player-avatar.ts（新文件）

```typescript
/** 玩家小人动画意图 */
export type PlayerAvatarIntent =
  | 'enter'
  | 'move'
  | 'battle-start'
  | 'battle-end'
  | 'hit'
  | 'die'
  | 'low-hp'
  | 'normal-hp'
  | 'popup'
  | 'fall'
  | 'idle';
```

### 9.2 types/events.ts 修改

**删除** `player:popup` 和 `player:fall`（调试按钮不再用事件总线）：

```typescript
export type AppEvent =
  | 'map:loaded'
  | 'game:action-completed'
  | 'game:npc-settled'
  | 'game:tick-advanced'
  | 'map:click-current'
  | 'ui:toast'
  | 'battle:ended'
  | 'battle:started'
  | 'battle:aim-mode'
  | 'battle:aim-exit'
  | 'preload:executed'
  | 'log:force-scroll'
  | 'log:add-unread'
  | 'battle:play-collision'
  | 'battle:play-damage-numbers'
  | 'battle:preload-init'
  | 'battle:aim-target-selected';
// 删除：| 'player:popup' | 'player:fall'
```

**理由**：调试按钮现在直接调 store action，不再经过事件总线。保留无用的旧事件类型会误导后续开发者。

---

## 十、实施步骤

按依赖顺序执行，每步可独立验证：

### 步骤 1：创建类型与 store（无副作用）

1. 新建 `src/types/player-avatar.ts`（§9.1）
2. 新建 `src/stores/player-avatar.ts`（§4.2）
3. 验证：`npm run build` 通过，无类型错误

### 步骤 2：创建 composable（无副作用）

1. 新建 `src/composables/usePlayerAvatar.ts`（§5.2）
2. 验证：build 通过

### 步骤 3：改造 MapGrid.vue（核心改造）

1. 删除 §6.1 列出的旧代码
2. 新增 §6.2 列出的新代码
3. 模板加 `ref="avatarRef"`（§6.3）
4. 验证：dev server 启动，地图加载后小人弹起 + 呼吸（与改造前视觉一致）；移动后小人 idle；HP 变化时无报错

### 步骤 4：改造 battle.ts（事件接入）

1. `startBattle` 追加 `onBattleStart()`（§8.1）
2. `enterBattleMode` 追加 `onBattleStart()`（§8.2）
3. `exitBattleMode` 追加 `onBattleEnd()`（§8.3）
4. `playTurnSegment` 追加受击判定（hpSnapshot 过滤）+ 死亡主判定（combatant_cleared）（§8.4）
5. `playBattleEndSegment` 追加死亡兜底判定（winnerPid）（§8.5）
6. **字段确认**（实施前必做）：在 `playTurnSegment` 内临时加 `console.log(e.directedKind, e.cleared_pid, e.reason, e.hpSnapshot)` 跑一场战斗，确认：
   - `combatant_cleared` 条目存在且 `cleared_pid` / `reason` 字段有值
   - `reason` 实际值是 `'death'` / `'escaped'` 还是其他（文档假设可能不准）
   - `hpSnapshot` 在伤害动作时有值且 `targetHpAfter < targetHpBefore`
   - 若 `reason` 实际值与文档不符，调整 §8.4 的判定条件
   - 若 `hpSnapshot` 缺失，回退到无 hpSnapshot 过滤的裸判定（仅判 `target_pid` + `target_type`）
7. 验证：进入战斗时无报错（含主动+被动两种入口）；受击时无报错（视觉暂无变化，因为 hit 映射到 idle）；玩家阵亡时小人实时倒下（不等 battle_end 段）；战斗结束无报错

### 步骤 5：调试按钮迁移

1. StatusBar.vue 删除调试按钮（§7.1）
2. MapContainer.vue 新增调试按钮组（§7.2）
3. terminal.css 追加样式（§7.3）
4. 验证：缩放条左侧出现 `弹` / `倒` 按钮；点击 `弹` 小人先倒下再弹起（与原代码一致）；点击 `倒` 小人倒下；倒下后再点 `弹` 能站起

### 步骤 6：清理旧事件

1. types/events.ts 删除 `player:popup` / `player:fall`（§9.2）
2. 全局搜索确认无残留引用
3. 验证：build 通过

### 步骤 7：HP 危险接入

1. MapGrid.vue 新增 HP watch（§6.2）
2. 验证：HP 降到 30% 以下时无报错（视觉暂无变化，因为 low-hp 映射到 idle）

---

## 十一、测试要点

### 11.1 视觉一致性（改造前后对比）

| 场景 | 期望视觉 | 验证方法 |
|------|---------|---------|
| 首次加载地图 | 小人从倒下状态弹起 + 呼吸 | 刷新页面观察 |
| 移动到新格 | 小人直接 idle 呼吸（无弹起） | 点击可达格观察 |
| 调试弹起 | 小人**先倒下再弹起** + 呼吸（与原代码一致） | 点击缩放条左侧 `弹` 按钮 |
| 调试倒下 | 小人倒下消失 | 点击缩放条左侧 `倒` 按钮 |
| 倒下后弹起 | 小人重新弹起 | 倒下后点 `弹` |

### 11.2 事件接入

| 场景 | 期望行为 | 验证方法 |
|------|---------|---------|
| 主动进入战斗（startBattle） | store.intent = 'battle-start'，小人 idle | 控制台 `usePlayerAvatarStore().intent` |
| 被动遭遇战（enterBattleMode） | store.intent = 'battle-start'，小人 idle | 被敌人发现时观察控制台 |
| 玩家受击（命中掉血） | store.intent = 'hit'，小人 idle | 战斗中观察控制台 |
| 玩家受击（未命中/0 伤害） | store.intent 不变（hpSnapshot 过滤生效） | 战斗中观察控制台，确认未触发 |
| 玩家死亡（combatant_cleared） | store.intent = 'die'，小人**实时**倒下（不等 battle_end 段） | 战斗中阵亡观察小人倒下时机 |
| 玩家死亡（兜底） | 若 combatant_cleared 缺失，battle_end 段触发 onDie | 故意制造异常数据测试 |
| 战斗结束 | store.intent = 'battle-end'，小人 idle | 战斗结束观察 |
| HP < 30% | store.intent = 'low-hp'，小人 idle | 调试扣血观察 |
| HP 恢复 | store.intent = 'normal-hp'，小人 idle | 调试回血观察 |

### 11.3 自动恢复（pendingIntent 回调链）

| 场景 | 期望行为 |
|------|---------|
| 死亡后战斗结束 | 小人先 popUp 站起（回弹完成后），再 idle |
| 死亡后移动 | 小人先 popUp 站起（回弹完成后），再 idle |
| 调试倒下后调试弹起 | 小人 popUp 站起 |
| 死亡后连续触发多个意图 | popUp 回弹完成后只派发最后一个 pending 意图（中间意图被覆盖） |

### 11.4 边界情况

- avatarRef 为 null 时（img 销毁窗口期）：composable 内部 `if (!el) return` 兜底
- 同意图 50ms 内重复触发：store 防抖，只执行一次
- combatant_cleared + battle_end 双触发 die：store 50ms 防抖 + isDown 状态机保证只 fall 一次
- `segment.meta.winnerPid` 为 null/undefined：兜底不触发，保守 idle（主判定 combatant_cleared 仍可生效）
- `e.hpSnapshot` 为 null（非伤害动作如 escape）：hit 判定跳过，不误触发
- `e.reason === 'escaped'`（玩家逃跑被清出队列）：不触发 die（仅 reason === 'death' 触发，需步骤 4 字段确认实际值）
- HP watch 首次触发（ratio undefined → 实际值）：composable 内部兜底
- onEnter 时 avatarRef 为 null（地图未加载完成）：enter 意图被跳过，地图加载后 onMove 补 idle（可接受，见 §6.4）

---

## 十二、未来扩展路径（不在本次实施）

本次建立的管道支持以下扩展，**只需改 INTENT_HANDLERS，事件层和 store 零改动**：

| 扩展项 | 改造点 | 示例 |
|--------|--------|------|
| 受击红闪（按伤害量分级） | INTENT_HANDLERS['hit'] | `(el) => { flashRed(el, e.effect_value); startIdle(el); }`（effect_value 已在 DirectedEntry） |
| 战斗姿态 idle | INTENT_HANDLERS['battle-start'] | `(el) => { startBattleIdle(el); }` |
| 低 HP 摇晃 | INTENT_HANDLERS['low-hp'] | `(el) => { startSway(el); }` |
| 胜利庆祝 | INTENT_HANDLERS['battle-end'] | `(el) => { playVictory(el); }` |
| 移动步行动画 | INTENT_HANDLERS['move'] | `(el) => { playStep(el); }` |
| **敌人击杀庆祝**（新增意图） | 新增 `'enemy-killed'` 意图 + playTurnSegment 内 combatant_cleared 分支补 `cleared_pid !== currentPid` 判定 | 数据已就绪（combatant_cleared 含 cleared_pid/reason） |
| 角色个性化素材 | MapGrid.vue `<img :src>` | 绑定 playerStore 的 gd/icon 字段 |
| onEnter 时机优化 | watch avatarRef 首次非 null 时触发 onEnter | 解决 §6.4 提到的"地图未加载完成时 enter 被跳过"问题 |

---

## 十三、风险与回滚

### 13.1 风险

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| `combatant_cleared` 条目字段缺失（导演配对异常降级为 display） | 中 | 死亡主判定失效 | 兜底判定（winnerPid）补判；步骤 4 实施前 console.log 确认字段 |
| `reason` 字段实际值与文档假设不符 | 中 | 死亡主判定条件永不匹配 | 步骤 4 字段确认阶段必须验证 reason 实际值，按实际值调整 §8.4 判定 |
| `segment.meta.winnerPid` 字段实际不存在 | 低 | 兜底失效 | 主判定（combatant_cleared）仍可生效；步骤 4 已要求字段确认 |
| `hpSnapshot` 在伤害动作时为 null | 低 | hit 判定跳过 | 步骤 4 console.log 确认；若缺失则回退到无 hpSnapshot 过滤的裸判定 |
| `avatarRef` 在 img 重建窗口期为 null | 低 | 该次意图被跳过 | composable 已兜底，下次意图会补 |
| HP watch 首次触发误调 onLowHp | 低 | 小人无视觉变化 | 当前 low-hp 映射 idle，无副作用 |
| 调试按钮位置在窄屏被挤压 | 低 | 视觉问题 | CSS 已设 min-width，必要时响应式调整 |
| onEnter 时 avatarRef 为 null（地图未加载完成） | 低 | 首次弹起动画被跳过 | 地图加载后 onMove 补 idle；未来可 watch avatarRef 优化 |

### 13.2 回滚

本次改造全部为增量+迁移，无破坏性变更。回滚方案：

1. `git revert` 本次 commit
2. 或手动恢复 MapGrid.vue 的 GSAP 函数 + StatusBar.vue 的调试按钮

旧事件 `player:popup` / `player:fall` 删除后，若回滚需同步恢复 events.ts 中的类型。

---

## 十四、文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/types/player-avatar.ts` | 新建 | PlayerAvatarIntent 类型 |
| `src/stores/player-avatar.ts` | 新建 | playerAvatarStore（含 pendingIntent 回调链） |
| `src/composables/usePlayerAvatar.ts` | 新建 | 动画 composable（popUp notifyUp 挂回弹 tween） |
| `src/components/map/MapGrid.vue` | 修改 | 删 GSAP 代码，加 ref + watch + store 调用 |
| `src/components/map/MapContainer.vue` | 修改 | 缩放条加调试按钮 |
| `src/components/layout/StatusBar.vue` | 修改 | 删调试按钮 |
| `src/stores/battle.ts` | 修改 | 5 处接入 store action（startBattle + enterBattleMode + exitBattleMode + playTurnSegment 内 hit+die 主判定 + playBattleEndSegment 内 die 兜底） |
| `src/types/events.ts` | 修改 | 删 player:popup / player:fall |
| `src/assets/styles/terminal.css` | 修改 | 加调试按钮组样式 |

**预计代码量**：新增 ~260 行（store + composable + 类型），删除 ~120 行（MapGrid 旧 GSAP + StatusBar 调试按钮），净增 ~140 行。其中 ~90 行 GSAP 是从 MapGrid 搬迁到 composable，逻辑不变。

---

## 附录：本次审查修复的问题清单

> 本节记录 v2 重新生成时相对 v1 的修复点，供实施者参考。

### 严重问题（已修复）

1. **文档内部不一致**：v1 的 §3.3/§3.4 已修正为 hpSnapshot+combatant_cleared，但 §8.3/§8.4 仍是旧版裸字段判定。v2 统一为 combatant_cleared + hpSnapshot 版本
2. **popUp onComplete 永不触发**：v1 的 popUp 把 `onComplete: () => store.notifyUp()` 挂在 `gsap.timeline({...})` 上，但末尾 tween 是 `repeat: -1`，timeline 永不完成，notifyUp 永不调用，isDown 永远不变 false。v2 改为挂在回弹 tween（第三个）的 `onComplete` 上
3. **dispatchWithRecovery setTimeout 打断 popUp**：v1 用 `setTimeout(() => dispatchIntent(next), 100)`，100ms 后 next handler 的 `killTweensOf` 打断 popUp 动画。v2 改为 `pendingIntent` 回调链：暂存 next，notifyUp 时派发

### 重要问题（已修复）

4. **enterBattleMode 遗漏**：v1 只列了 `startBattle` 触发 onBattleStart，遗漏被动遭遇战入口 `enterBattleMode`。v2 新增 §8.2
5. **'popup' handler 缺 setDown**：v1 的 `'popup': (el) => { popUp(el); }` 直接弹起，与原代码 `setAvatarDown + popUpAvatar` 不一致。v2 改为 `setDown + popUp`

### 细节问题（已修复）

6. composable `import { onUnmounted }` 未使用 → v2 删除
7. §3.2 行号是 broadcast 点而非函数定义点 → v2 统一用函数定义行号
8. reason 字段实际值未核实 → v2 在 §10 步骤 4 字段确认 + §13.1 风险表中明确要求验证
9. 防抖 50ms 可能误杀连续受击 → v2 在 §4.3 设计要点中说明未来优化路径
