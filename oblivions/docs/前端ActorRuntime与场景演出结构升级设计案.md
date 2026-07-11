# 前端 ActorRuntime 与场景演出结构升级设计案

> **⚠️ 状态：已实施完成**（2026-07-11 核查确认）
>
> 本文全部 7 个新增文件、12 个重构文件、3 个删除文件已在代码中落地。
> 第 16\~19 节的运行期轨迹修正已通过回归测试。
> 状态标记"执行前设计"已过期，需更新为"已实施完成"。
>
> 前置研判：[前端战斗导演与演员动画系统结构研判.md](./前端战斗导演与演员动画系统结构研判.md)
>
> 目标：保留现有 battlelog.v2 / Director / Planner / Runner 主链，重构 Actor 与 Scene 执行底座，消除地图投影、玩家意图和战斗编舞对同一 DOM 的竞争，统一坐标、动画取消、退场和播放提交语义。

## 1. 范围与非目标

### 1.1 本轮范围

1. 建立带坐标空间类型的 `SceneGeometry`。
2. 以 `ActorRuntime` 替换现有 callback 型 `ActorAnimation` 控制器。
3. 把 actor DOM 拆为 anchor / action / visibility / pose 四个动画通道。
4. 引入 `PresentationLease` 与跨刷新存活的 `BattlePresentationSession`。
5. 让 Battle ActorExecutor 使用 Scene/Actor 端口，不再自行查询 document。
6. 让地图位置同步、探索移动、玩家 intent 使用同一 Runtime/Lease 协议。
7. 建立 `combatant_cleared` 单一退场所有权，消除二次 fade。
8. 把 timeout 从“只放行”升级为“取消旧动画后放行”。
9. 补充纯逻辑、Runner、Runtime 和浏览器级回归验证。
10. 把地图状态改为原子 projection revision，消除跨 scope 中间态。

### 1.2 非目标

1. 不重写 battlelog.v2 事件协议。
2. 不推倒 `directV2()` / `planPlaybackV2()`。
3. 不新增技能或修改战斗数值。
4. 不为了兼容旧 ActorAnimation API 长期保留双实现；迁移完成后删除旧接口。
5. 不建设通用游戏引擎或任意场景树，只服务当前 MapGrid + BattlePlayback。

## 2. 必须成立的框架不变量

### 2.1 表现所有权

1. 同一 actor 的同一动画通道任一时刻最多一个 owner。
2. `battle` 可以抢占 `ambient/world`；`world/ambient` 不得抢占 `battle`。
3. `terminal` 可以抢占所有通道，且直到数据提交卸载前不可被 idle 恢复。
4. lease 释放后必须对齐最新权威投影，不得恢复到 lease 创建时的旧状态。

### 2.2 坐标

1. 领域位置只使用 `TileRef { pgroup, pls }`。
2. actor anchor 动画只使用 `ScenePoint`。
3. body overlay 只使用 `ViewportPoint`。
4. 不允许以裸 `{x, y}` 跨模块传递未声明空间的坐标。
5. ActorExecutor 不直接访问 `document`、`#mapGrid` 或 `[data-pls]`。

### 2.3 动画

1. 每个可等待动画返回 `AnimationHandle`。
2. timeout 必须调用 `handle.cancel('timeout')`。
3. cancel 后旧 callback 不得启动 idle、修改位置或影响后续动画。
4. 无限 idle 不作为可等待 step；它是 Runtime 的 ambient fallback。
5. animation completion、cancel、skip、timeout 都返回结构化结果。

### 2.4 状态提交

1. BattlePresentationSession 可跨多个 `PROCESSING` refresh 存活。
2. battle move 后空间 lease 不在单步结束时释放。
3. stable boundary (`PLAYER_TURN` / `IDLE`) 时先提交 CharacterHub/map，再释放 session。
4. 投影在 lease 存活期间只更新 `pendingAnchor`，不得覆盖当前演出位置。
5. `combatant_cleared` 已播放的 actor 在状态移除时直接卸载，不再播放第二次 fade。
6. `escaped` 只表示退出战斗 roster；只有最新世界投影也移除实体时才直接卸载。

## 3. 坐标与场景类型

新增 `vex-vue/src/types/scene.ts`：

```ts
export interface TileRef {
  pgroup: number;
  pls: number;
}

export interface ScenePoint {
  readonly space: 'scene';
  x: number;
  y: number;
}

export interface ViewportPoint {
  readonly space: 'viewport';
  x: number;
  y: number;
}

export interface SceneAnchor {
  tile: TileRef;
  point: ScenePoint;
  cellWidth: number;
  cellHeight: number;
}

export interface SceneGeometry {
  readonly generation: number;
  readonly active: boolean;
  readonly projectionRevision: number;
  resolveTile(tile: TileRef): SceneAnchor | null;
  sceneToViewport(point: ScenePoint): ViewportPoint | null;
  elementCenterToViewport(el: HTMLElement): ViewportPoint;
}
```

### 3.1 MapSceneGeometry

新增 `vex-vue/src/composables/mapSceneGeometry.ts`：

1. `createMapSceneGeometry(gridRef, currentRegion)` 创建当前 MapGrid adapter。
2. `resolveTile`：
   - 校验 `tile.pgroup === currentRegion`。
   - 在 grid 内查 `[data-pls]`。
   - 统一使用 offsetParent 累加得到 ScenePoint。
3. `sceneToViewport`：
   - 读取 grid rect 与 `offsetWidth/offsetHeight`。
   - 计算 CSS 缩放比例后转换。
   - scroll 已体现在 grid rect 中，不重复扣减。
4. `elementCenterToViewport`：只用于已存在 DOM actor/overlay anchor。

### 3.2 MapProjectionRevision

`mapStore` 新增原子投影快照：

```ts
interface MapProjection {
  revision: number;
  currentTile: TileRef | null;
  links: GameMap['links'] | null;
  enemies: Enemy[];
}
```

`loadMap()` 必须等待 game_map 与 enemies 两个请求完成后一次性 `commitProjection()`，不再先提交 region/links、后提交 enemies。每次完整提交递增 revision；旧 load generation 的响应不得覆盖较新的 projection。cacheable action 的 `forceRefresh` 必须绕过旧 pending，且旧请求后完成时不得覆盖新请求写入的缓存。

玩家地图锚点以 `projection.currentTile` 为准，CharacterHub 的 player.pls 只表达角色领域状态，不能把旧区域 pls 投影到新 grid。跨区域判断比较完整 TileRef，因此区域 A/pls=1 到区域 B/pls=1 仍会执行 arrive。

只刷新 enemies 时也通过复制当前快照并 commit 产生新 revision，不暴露半更新状态。

### 3.3 SceneRegistry

新增 `vex-vue/src/composables/sceneRegistry.ts`：

```ts
registerSceneGeometry(adapter): unregister
getSceneGeometry(): SceneGeometry | null
```

注册带 generation；MapGrid 卸载时注销。旧 generation 的等待任务必须返回 `stale_scene`。

## 4. Actor DOM 与动画通道

MapGrid actor DOM 改为：

```html
<div class="entity actor-anchor">
  <div class="actor-action">
    <div class="actor-visibility">
      <div class="actor-pose">
        <img class="entity-img">
      </div>
    </div>
  </div>
</div>
```

### 4.1 通道职责

| 通道 | DOM | 可写属性 | 示例 |
|---|---|---|---|
| spatial | `.actor-anchor` | x/y/xPercent/yPercent/width/height | 地图投影、移动 |
| action | `.actor-action` | x/y | 攻击冲撞、受击位移 |
| visibility | `.actor-visibility` | alpha | fade、隐藏、恢复 |
| pose | `.actor-pose` | scaleX/scaleY/rotation | idle、蓄力、受击、倒下 |

约束：任何低层动画函数只能 kill 自己通道的 tween，不得 `killTweensOf(actor root)`。

朝向继续由 anchor class `facing-right` 控制 img，不占用 GSAP 通道。

## 5. ActorRuntime API

新增 `vex-vue/src/types/actor-runtime.ts`：

```ts
export type ActorChannel = 'spatial' | 'action' | 'visibility' | 'pose';
export type PresentationOwner = 'ambient' | 'world' | 'battle' | 'terminal';

export interface AnimationResult {
  status: 'completed' | 'cancelled' | 'skipped';
  reason?: string;
}

export interface AnimationHandle {
  finished: Promise<AnimationResult>;
  cancel(reason?: string): void;
}

export interface LeaseRequest {
  owner: PresentationOwner;
  channels: ActorChannel[];
  sessionId?: string;
}

export interface PresentationLease {
  readonly actorId: string;
  readonly owner: PresentationOwner;
  readonly channels: ReadonlySet<ActorChannel>;
  readonly released: boolean;
  play(command: ActorCommand): AnimationHandle;
  release(options?: { reconcile?: boolean }): void;
}

export interface ActorRuntime {
  readonly id: string;
  readonly generation: number;
  setElements(elements: ActorElements | null): void;
  acquire(request: LeaseRequest): PresentationLease | null;
  projectAnchor(anchor: SceneAnchor): void;
  getScenePoint(): ScenePoint | null;
  setFacing(direction: 'left' | 'right'): void;
  markTerminal(): void;
  settleTerminalPresentation(): void;
  markDown(): void;
  markStanding(): void;
  recoverPresentation(): void;
  markRemovalAnimated(sessionId: string): void;
  markBattleExitAnimated(sessionId: string): void;
  consumeBattleExitAnimated(sessionId: string): boolean;
  consumeRemovalDisposition(): 'animated' | 'projected' | 'immediate';
  dispose(): void;
}
```

### 5.1 ActorCommand

```ts
export type ActorCommand =
  | { kind: 'idle' }
  | { kind: 'enter' }
  | { kind: 'arrive' }
  | { kind: 'move'; target: SceneAnchor; tier: MoveTier; hold: boolean }
  | { kind: 'attack'; target?: ScenePoint; attackKind: AttackKind }
  | { kind: 'hit'; direction: -1 | 0 | 1 }
  | { kind: 'fall' }
  | { kind: 'fade' }
  | { kind: 'reset-visible' };
```

Runtime 根据 command 校验 lease 是否覆盖所需通道。非法调用返回 skipped handle，并在 DEV 输出结构化警告。

### 5.2 owner 优先级

`terminal > battle > world > ambient`

- 高优先级 acquire 可 cancel 并释放低优先级冲突 lease。
- 同优先级不同 session 不自动抢占，避免旧 battle 回调进入新 battle。
- dispose 取消全部 handle，并使所有 lease 失效。

`escaped` 不使用 terminal owner。它在 battle lease 内播放退出战斗动画，稳定边界后再根据最新 world projection 决定恢复为 world actor 或卸载。

### 5.3 pendingAnchor

`projectAnchor(anchor)`：

- spatial 无 lease：立即写 `.actor-anchor`。
- spatial 有 lease：只覆盖 `pendingAnchor`。
- spatial lease release(reconcile=true)：使用最新 pendingAnchor；若无 pending，则保持当前视觉位置。

Battle move `hold=true`：动画完成后保持 target ScenePoint，不启动位置 reconcile，直到 BattlePresentationSession commit。

## 6. 动画实现

重构 `animations/actorAnimations.ts`：

1. 接收 `ActorElements` 或明确通道 element。
2. 每个函数返回 `AnimationHandle`。
3. 用统一 `createGsapHandle()` 封装 timeline completion/cancel。
4. cancel 只 kill 对应 timeline，不触发 completed callback。
5. idle 作为 pose 通道的 ambient handle；被抢占后不自动恢复，lease release 时由 Runtime 按状态恢复。

### 6.1 动作完成与 cue point

`action-specs.ts` 不再双写纯毫秒等待：

```ts
interface ActorActionSpec {
  attackKind: AttackKind;
  impactRatio: number;
  fallbackDuration: number;
}
```

攻击 handle 暴露 cue：

```ts
interface CueAnimationHandle extends AnimationHandle {
  cue(name: 'impact'): Promise<AnimationResult>;
}
```

ActorExecutor await impact cue 后触发 hit，再 await 两个 handle 完成。若第一阶段实现 cue 过重，可由 Runtime 内部把 timeline label 转 Promise；不得继续让 Executor 用独立 sleep 猜测。

## 7. BattlePresentationSession

新增 `vex-vue/src/stores/battle-presentation-session.ts`。

```ts
export interface BattlePresentationSession {
  readonly id: string;
  readonly qid: number | null;
  getLease(actorId: string, channels: ActorChannel[]): PresentationLease | null;
  markTerminal(actorId: string): void;
  commit(projectedActorIds: ReadonlySet<string>): void;
  abort(reason: string): void;
}
```

### 7.1 生命周期

```text
enter/first log
  -> create session(qid, generation)
  -> play one or more battlelog batches
  -> state remains PROCESSING: keep session and leases
  -> state becomes PLAYER_TURN / IDLE
  -> flush CharacterHub/map/combat_targets while leases remain active
  -> entity projection writes pendingAnchor / removal
  -> session.commit(latest projected actor ids)
  -> surviving actors reconcile pendingAnchor
  -> terminal actors direct unmount
```

### 7.2 异常

- playback step skip：继续 session。
- step timeout：cancel handle，继续 fallback。
- battle fetch/director fatal error：`session.abort('playback_error')`，取消所有 handles并立即 reconcile 最新投影。
- reset/qid change：abort old session；旧 session API 后续调用均 no-op。
- scene generation change：abort current animations，等待新 scene 注册后 reconcile。

## 8. Battle Runner 与 ActorExecutor 迁移

### 8.1 Runner

`BattlePlaybackRuntime` 新增：

```ts
presentation: BattlePresentationSession;
scene: SceneGeometry;
```

Runner timeout 逻辑改为接收 `AnimationHandle` 或 cancellable task。timeout 时调用 cancel，再等待 cancellation settled。

### 8.2 ActorExecutor

函数签名改为显式依赖：

```ts
playActionAnimation(action, context): Promise<PlaybackExecutionResult>
playActionDelivery(action, delivery, context): Promise<PlaybackExecutionResult>
playCombatantCleared(notice, context): Promise<PlaybackExecutionResult>
```

`context` 包含 scene、presentation、currentPid。

删除：

- `document.getElementById`。
- `[data-pls]` query。
- 重复 `getTileAnchor`。
- ActorExecutor 内部 withTimeout。
- 对玩家清场转发 playerAvatarStore 的特例。

玩家和 NPC 全部通过 ActorRuntime；entity id 解析保留为纯函数。

### 8.3 delivery overlay

投射和爆炸仍可动态创建 overlay DOM，但坐标全部由 SceneGeometry 返回 ViewportPoint。overlay handle 必须可取消，并在 cancel/finally 中 remove。

## 9. 地图实体调度迁移

### 9.1 useMapEntities 职责

迁移后只负责：

1. ActorRuntime 创建/注册/注销。
2. DOM elements 注入。
3. CharacterHub entities diff -> world transition command。
4. SceneGeometry 注册。
5. Resize 时重新 projectAnchor；有 lease 时进入 pendingAnchor。

删除本地 `actors` 双 Map，只保留 registry 中的 Runtime；entityRefs 可由 Runtime elements 取代。

### 9.2 探索移动

状态变化时：

1. 同步阶段 acquire world spatial lease，防止 resize 投影抢占。
2. nextTick/rAF 后 resolve 新 SceneAnchor。
3. 根据旧 ScenePoint 与新 anchor 计算 tier。
4. 播放 move/arrive。
5. handle finished 后 release(reconcile=true)。

### 9.3 玩家 intent

playerAvatarStore 暂时保留为 command producer：

- ambient：idle、battle-start、battle-end、low-hp、normal-hp。
- terminal：仅 die。
- world lifecycle：enter、revive、fall、flee；其中 fall 记录 down posture，lease 释放不得自动恢复 idle；flee 释放 visibility lease 后允许 battle-end enter 恢复。

intent watcher 不再直接调裸动画，而是 acquire 相应 lease 并 play command。战斗 ActorExecutor 不通过 playerAvatarStore。

后续可把 store 收敛成通用 ActorIntentQueue，但不作为本轮阻塞项。

## 10. 单一退场协议

### 10.1 战斗清场

`combatant_cleared`：

1. death：session acquire terminal visibility/pose/action lease。
2. escaped：session acquire battle visibility/action lease，不把 Runtime 标记为实体 terminal。
3. death -> fall/fade；escaped -> fade。
4. await handle completion。
5. death 立即 `markRemovalAnimated(session.id)`。
6. escaped 只记录 `battleExitAnimated`，等待最新 projection 决定 disposition。

### 10.2 entities removal

角色从 aliveList 消失时：

- `consumeRemovalDisposition() === 'animated'`：直接从 displayEntities 移除。
- `projected`：这是非战斗视野移除，播放 world fade 后移除。

reset/unmount 直接 dispose，不播放退场。

### 10.3 escaped 的稳定边界处理

状态投影提交后：

- escaped actor 不在最新 entities：把 `battleExitAnimated` 转为 `animated`，直接卸载。
- escaped actor 仍在最新 entities：释放 battle lease，project 最新 anchor，播放短 `arrive/reset-visible`，恢复为 world actor。

因此 roster exit 不再被错误等同于角色死亡或离开地图。

## 11. 文件改动清单

### 新增

- `src/types/scene.ts`
- `src/types/actor-runtime.ts`
- `src/composables/mapSceneGeometry.ts`
- `src/composables/sceneRegistry.ts`
- `src/composables/useActorRuntime.ts`
- `src/stores/battle-presentation-session.ts`
- `src/stores/actor-runtime.fixture.ts`

### 重构

- `src/stores/map.ts`
- `src/animations/actorAnimations.ts`
- `src/animations/action-specs.ts`
- `src/composables/actorRegistry.ts`
- `src/composables/useMapEntities.ts`
- `src/stores/battle-actor-executor.ts`
- `src/stores/battle-playback-runner.ts`
- `src/stores/battle.ts`
- `src/components/map/MapGrid.vue`
- `src/assets/styles/terminal.css`
- `src/types/player-avatar.ts`
- `src/stores/player-avatar.ts`

### 删除

- `src/composables/useActorAnimation.ts`
- `src/types/actor-animation.ts`（MoveTier/AttackKind/规格类型迁入 actor-runtime/action-specs）

如迁移期间必须短暂保留旧文件，只允许在同一提交中作为 re-export compatibility shim，最终验收前必须删除 shim 和旧调用点。

## 12. 实施顺序

### Phase A：无行为变化的底座

1. mapStore 新增原子 MapProjection revision，并修正跨区域同 pls 的判断基础。
2. 新增 scene/actor runtime 类型。
3. 新增 SceneGeometry + registry。
4. MapGrid DOM 分层和 CSS，保持视觉一致。
5. 实现 Runtime 基础通道、handle、lease、registry。

### Phase B：地图链迁移

1. useMapEntities 改用 Runtime。
2. 迁移位置同步和探索移动。
3. 迁移 player intent。
4. 验证 resize/zoom/区域切换/首次入场。

### Phase C：战斗链迁移

1. 新增 BattlePresentationSession。
2. Runner 注入 scene/presentation。
3. ActorExecutor 全量迁移。
4. battle store 把 session commit 接到 deferred visual flush 稳定边界。

### Phase D：退场与清理

1. terminal disposition。
2. 删除双 fade。
3. 删除旧 ActorAnimation 接口、重复 anchor 和 document 查询。

### Phase E：文档与验证

1. 更新 CODEBASE/DESIGN。
2. 运行测试、type-check、build、PHP 回归。
3. 浏览器验证实际地图和战斗播放。

## 13. 测试矩阵

### 13.1 纯逻辑

- 坐标空间转换，含 grid 缩放。
- owner 优先级和冲突 acquire。
- cancel 只影响目标通道。
- stale generation/session no-op。
- pendingAnchor 取最后一次投影。
- terminal disposition 只消费一次。
- 旧 map load generation 不得覆盖新 projection revision。

### 13.2 Runtime DOM fixture

- move 与 idle 同时存在时互不 kill。
- attack action offset 不污染 anchor。
- hit pose 不改变 spatial。
- timeout cancel 后旧 completion 不恢复 idle/覆盖新动画。
- release(reconcile=true) 对齐最新 pendingAnchor。
- 非死亡 fall 释放 lease 后仍保持 down posture。
- terminal death 后 session abort 不恢复可见、不触发二次退场。

### 13.3 地图工作流

- 初次入场。
- 短移/跳跃/长距离/跨区域。
- 跨区域同 `pls` 仍触发 arrive。
- game_map/enemies 只产生完整 projection revision，不暴露中间组合。
- 两次 forceRefresh 重叠时真正发起两个请求，旧响应不覆盖新缓存。
- 移动中 resize 不瞬移到终点或旧点。
- battle spatial lease 中 resize 不拉回旧 pls。
- 非战斗 enemies removal fade 一次。

### 13.4 战斗工作流

- battle move 后下一动作从新视觉位置开始。
- PROCESSING 多批日志之间 actor 保持移动后位置。
- stable boundary commit 后无跳变。
- throw/grenade delivery 在滚动、缩放后命中正确 actor/tile。
- death/escape clear 只退场一次。
- escaped actor 若仍存在于 world projection，稳定边界后恢复为 world actor；若不存在则直接卸载。
- actor/tile 缺失返回 skipped，不阻塞 Runner。
- timeout cancel 后下一 PlaybackStep 不被旧 tween 干扰。
- reset/qid 变化取消旧 session。
- MapGrid 重挂载令旧 SceneGeometry.active=false，当前 PlaybackExecutionTask 取消并 abort session。

### 13.5 浏览器验收

桌面与移动 viewport：

1. 地图首次加载无闪现。
2. 缩放、滚动、resize 后 actor 仍锚定格底部中心。
3. 探索移动正常。
4. 战斗移动 -> 攻击顺序正确。
5. 多目标投掷/手雷 delivery 位置正确。
6. 死亡/逃跑不提前消失、不二次淡出。
7. 播放期间地图输入仍被屏障阻止。
8. 控制台无 uncaught promise、stale actor、lease leak。

## 14. 完成标准

1. 代码中不存在 `ActorAnimation` / `useActorAnimation` 旧调用。
2. ActorExecutor 中不存在 `document`、`getElementById`、`querySelector([data-pls])`。
3. tile anchor 算法只有 SceneGeometry 一处。
4. `killTweensOf` 不再针对包含多个动画域的 actor root。
5. Runner timeout 会 cancel 当前 handle。
6. battle spatial lease 跨 PROCESSING 批次存活，并在 stable boundary 后释放。
7. combatant clear 和 entities removal 不重复 fade。
8. map projection 以 revision 原子提交，跨区域同 pls 正确识别。
9. 自动化测试、type-check、build、PHP tests、lint、diff check 全部通过。
10. 浏览器验收矩阵通过。

## 15. 设计自检清单

执行前必须确认：

- SceneGeometry 能处理当前 CSS zoom 实现，而不是假设无 transform。
- actor root 与 child transform 分层不会破坏 facing-right 和 image height。
- BattlePresentationSession 的生命周期与现有 deferred visual scopes 是同一 stable boundary。
- session commit 的顺序是“先投影、后释放”，不能反转。
- terminal actor 被 Vue 卸载前 Runtime 仍可读取 disposition。
- escaped actor 的 battle-exit 与实体 terminal 不得混为一类。
- MapProjection 必须原子提交并拒绝旧 generation 返回。
- reset/unmount 不等待动画，所有 handle 可同步 cancel。
- skipped actor/tile 不等同 fatal，Runner 仍继续。
- 不把 battle/normal 建成两套动画实现。

以上检查全部满足后方可进入实施。

## 16. 运行期轨迹修正（2026-07-11）

实机采样确认：world move 开始后 anchor 在动画首帧直接落到终点，pose 时间线仍继续。根因不是 SceneGeometry 测量错误，而是 Runtime 在 move handle 完成前提前提交 `currentAnchor=target`；随后 Vue 对相同 DOM 的函数 ref 再绑定触发 `setElements()`，按已提交 target 重写 anchor。

修正规则：

1. `setElements()` 对相同 anchor/action/visibility/pose DOM 必须幂等，不重置通道或重写 anchor。
2. move 的 `currentAnchor` 只能在 handle `completed` 后提交；cancel/replaced 不得把目标点伪装成已完成位置。
3. world move 继续通过 spatial lease 的 `pendingAnchor` 在 release 时对齐后端权威终点。
4. duck tier 必须复用旧版鸭子步参数：`duration=0.5s`、`swayAmp=12deg`、两轮八段 `sine.inOut + yoyo` 左右扭摆，并同步执行 `scaleY=0.97` 的四段脚步压缩。新框架只把空间插值放到 anchor、把旧 rotation/scale 放到 pose，不重新设计视觉效果。
5. 回归夹具必须覆盖“move 播放中相同 DOM ref 再绑定不瞬移终点”和“cancel 不提交目标 anchor”。

## 17. 刷新后首次操作的入场抢占规则（2026-07-11）

F5 重载后 actor 会播放约 1 秒的 enter/popup。若首个真实移动在 enter 完成前到达，enter 与 move 都申请 world pose lease；同优先级不同 session 按规则互斥，move acquire 失败后会退化为即时投影，表现为“第一次操作无动画”。

修正规则：

1. enter/popup 继续使用 world presentation，确保它能抢占初始化阶段已存在的 ambient idle；不得把 enter 降为 ambient，否则同级 ambient session 会阻止入场并让 actor 保持透明。
2. `LeaseRequest` 增加显式 `replaceEqualOwner`。默认仍禁止同 owner、同优先级、不同 session 互抢；只有权威 world move 可开启该标志，替换尚未完成的旧 world 生命周期 lease。
3. world move 抢占 enter 后，必须先把 pose 恢复到站立基线，并通过自身 visibility lease 播放 reset-visible，避免从半透明或压扁的入场中间帧开始走路。
4. battle/terminal 不开启同级替换；旧 battle callback 仍不能进入新 battle session。
5. 回归夹具覆盖 world enter 被首个 `replaceEqualOwner` world move 抢占、旧 lease 被取消且新 move lease 可执行。

## 18. Actor 演出可观测性基线（2026-07-11）

多 Actor 连续退场中，后端事件存在、Director 计划存在但个别角色未呈现动画时，服务器日志无法区分 Runtime 已卸载、lease 被拒绝、DOM 缺失、动画被替换或投影提前移除。上述状态不得继续静默退化为 `completedTask()` 而不留下运行期证据。

观测规则：

1. 开发环境默认、生产构建通过 `?actor_debug=1` 显式开启现有 DebugBus 环形缓冲，记录 PlaybackStep start/settle，字段至少包含 step id、kind、actor id、raw log id。
2. Actor registry 必须记录 register/unregister 及 Runtime generation；MapGrid ref 卸载必须记录触发实体 id。
3. battle/terminal lease 获取必须记录成功或失败，失败需区分 inactive session、actor missing 与 Runtime acquire rejected。
4. Runtime 动画必须记录 command start/settle，settle 保留 completed/cancelled/skipped 和 reason；DOM 缺失、lease channel 缺失不得无痕跳过。
5. entities projection 必须记录 removed ids、retained fading ids 和 projection revision，便于确认 Vue 节点是否在 clear step 前真实卸载。
6. 轨迹开启时提供只读全局导出入口，能够在复现后一次性复制时间线和状态快照；观测工具不得改变 lease、动画或投影时序。
7. 诊断完成后允许保留低成本环形轨迹作为框架基线，禁止通过针对“最后一个逃跑者”的延时或重试补丁掩盖生命周期错误。

## 19. 战斗日志静默点与单会话排空规则（2026-07-11）

实机轨迹确认同一 `qid` 的结算被拆成两个 PresentationSession：第一批日志播放结束后，状态校验调用 heartbeat；该 heartbeat 继续推进 PROCESSING 并生成后续逃跑日志，但旧流程立即按最新 player_info 提交地图投影、退出战斗，后续日志只能在下一次刷新中以 `qid=null` 新会话补播。由此允许稳定边界插入同一场战斗的 clear 序列，造成 Actor 重投影、会话重建和退场表现不稳定。

修正规则：

1. “日志播放完成”不构成稳定边界；只有 heartbeat 返回非 PROCESSING，且该 heartbeat 新生成的未播放 battlelog 已全部播放并标记后，才到达静默点。
2. `fetchAndPlayBattleLog` 必须在同一个 `isPlayingBattleLog` 临界区内循环执行“播放当前 pending -> heartbeat 推进并读取 player_info -> 播放 heartbeat 新生成 pending”。
3. 当读取状态仍为 PROCESSING 时继续循环，不得 commit presentation、flush deferred scopes 或退出 battle mode。
4. PLAYER_TURN/IDLE/非 battle action 的最终判定只能发生在最后一批 pending 播放之后；同一 `qid` 在此之前复用同一个 BattlePresentationSession。
5. 排空循环设置防御性上限；达到上限时保留 session 和 deferred projection，交由下一次刷新继续，不得以强制退出或即时投影伪造完成。
6. 回归验证必须确认 heartbeat 生成的尾随 clear/battle_end 在 stable commit 前播放，且不会出现同一战斗后半段 `qid=null` 的新 PresentationSession。
