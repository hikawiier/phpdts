# 战斗小人动画对接设计

> 配套需求文档：[BATTLE_ACTOR_ANIMATION_REQUIREMENTS.md](BATTLE_ACTOR_ANIMATION_REQUIREMENTS.md)
> 配套框架文档：[ACTOR_ANIMATION_FRAMEWORK.md](ACTOR_ANIMATION_FRAMEWORK.md)
>
> 创建时间：2026-07-01
> 修订：2026-07-01 v2（二次审阅修正 6 处问题：playHit startIdle 回调、分阶段标注、dir 坐标计算、flee 恢复路径、hitAnim x 偏移约束、M1 实施清单）

---

## 一、设计目标

打通"导演系统 → 战斗播放系统 → 地图小人动画"三者之间的接口缺口，使战斗中以下场景对 **player 与敌人（NPC）均产生动画反馈**：

- 受击摇晃（Hit Shake）
- 攻击冲撞（Attack Lunge）
- 逃跑淡出（Flee Fade）
- 死亡倒下（Die Fall）

战斗姿态、低血量虚弱等锦上添花项不在本次范围内（接口已通，仅缺专属动画函数）。

---

## 二、现状速览（4 子系统接口能力）

### 2.1 后端 battlelog（完备）

- 事件类型齐全：`once_execute_pre/post`（配对）、`flee`、`combatant_cleared`（reason=`escaped`/`death`/`unknown`）、`battle_end`、`ambush_battle_end`
- 字段完备：`actor_pid/actor_type/target_pid/target_type/actor_hp/target_hp/effect_value/success/cleared_pid/reason`
- **关键事实**：HP 不是嵌套对象，而是平铺在 `actor_hp/target_hp`，由 pre（执行前快照）+ post（执行后快照）配对提供 before/after
- `actor_type`/`target_type`：`0=玩家`，`非0=NPC`
- **flee 路径**：`flee` 事件由 `escape.calc.php` emit（仅 success=true），不直接 emit combatant_cleared；由后续 `battle_main_end` 统一 emit `combatant_cleared` reason='escaped'

### 2.2 导演系统 `battle-director.ts`（完备）

- `directedKind` 7 种：`'action' | 'initiative' | 'flee' | 'combatant_cleared' | 'battle_end' | 'ambush_battle_end' | 'display'`
- `pairPrePost` 已合并 pre/post，产出 `DirectedEntry`，构造好 `HpSnapshot`（`actorHpBefore/After`、`targetHpBefore/After`、maxHp）
- `AnimationType = 'none' | 'collision'`，`decideAnimation` 仅对 `attackActions=['unarmed_strike']` 返回 `'collision'`
- `flee` 走 `toDisplay`，`animation='none'`、`hpSnapshot=null`，但 `directedKind='flee'` 可识别
- `DirectedEntry` 已携带足够信息支持敌人动画（`actor_pid/actor_type/target_pid/target_type/hpSnapshot`）

### 2.3 战斗播放系统 `battle.ts`（缺口集中在此）

`playTurnSegment`（[battle.ts#L453-L493](file:///d:/wamp64/www/phpdts/vex-vue/src/stores/battle.ts#L453-L493)）仅显式处理两类：

| 分支 | 行号 | 当前条件 | 当前动作 |
|------|------|---------|---------|
| collision | L459-473 | `target_pid===currentPid && target_type===0 && HP下降` | `usePlayerAvatarStore().onHit()` + `await sleep(COLLISION_ANIM_DURATION)` |
| combatant_cleared | L476-482 | `cleared_pid===currentPid && reason==='death'` | `usePlayerAvatarStore().onDie()`（无 sleep） |
| battle_end 兜底 | L499-502 | `winnerPid != null && winnerPid !== currentPid` | `usePlayerAvatarStore().onDie()` |

**核心缺口**：
- 敌人作为 target/actor/cleared 时无任何小人动画（仅模态框文本 + 伤害数字 broadcast）
- flee 事件未触发 playerAvatarStore
- combatant_cleared 分支无 sleep，动画会被下一个 entry 打断
- battle.ts 未 import useMapEntities / actorsStore / useActorAnimation
- `onLowHp()` 未被 battle.ts 调用（需求文档说"已有"但实际未接）

**已有常量**：`COLLISION_ANIM_DURATION = 450`（[battle.ts#L53](file:///d:/wamp64/www/phpdts/vex-vue/src/stores/battle.ts#L53)）

### 2.4 地图小人动画层

**`useActorAnimation.ts`**（每 actor 控制器，已预留对接钩子）：
- 已有：`playFall(onDown)`、`playFadeOut(onDone)`、`getPosition()`、`getEl()`、`killAll()`
- 接口注释（[types/actor-animation.ts#L39-L44](file:///d:/wamp64/www/phpdts/vex-vue/src/types/actor-animation.ts#L39-L44)）明确写着"供战斗系统计算碰撞轨迹 / 操作 DOM / 接管"——作者本就计划让战斗系统直接调 actor 方法
- 缺：`playHit()`、`playAttack()`（接口已声明 `playHit`，但实现未添加）
- **关键实现细节**：`playFadeOut` 内部已 `gsap.killTweensOf(el) + isMoving=false`（[useActorAnimation.ts#L125-L131](file:///d:/wamp64/www/phpdts/vex-vue/src/composables/useActorAnimation.ts#L125-L131)）；`fall` 动画也内部 `killTweensOf`（[actorAnimations.ts#L95](file:///d:/wamp64/www/phpdts/vex-vue/src/animations/actorAnimations.ts#L95)）

**`actorAnimations.ts`**（纯动画函数库）：
- 已有：`fall`（倾斜 0.1s → 旋转倒地 alpha:0 0.32s，总 0.42s）、`fadeOut`（alpha:0 + 缩到 0.7, 0.35s）、`popUp`、`moveActor`、`jumpActor`、`arriveAnim`、`startIdle`、`hitAnim`（M1 已添加）
- 缺：`attackAnim`（M4 添加）
- 可作模板：`fall`（两段 timeline + onComplete）、`popUp`（三段 timeline + 中段回调）

**`useMapEntities.ts`**（注册中心，结构性缺口）：
- `actors: Map<string, ActorAnimation>` 是**模块私有闭包**（[useMapEntities.ts#L83](file:///d:/wamp64/www/phpdts/vex-vue/src/composables/useMapEntities.ts#L83)），未通过 return 暴露
- 已新建 `actorRegistry.ts` 模块级注册中心，但 useMapEntities 尚未接入 register/unregister 调用
- player 与敌人统一管理，player id = `'player'`，敌人 id = `'enemy-${pid}'`
- **entities watch 已有淡出逻辑**（[useMapEntities.ts#L242-L253](file:///d:/wamp64/www/phpdts/vex-vue/src/composables/useMapEntities.ts#L242-L253)）：敌人从列表移除时自动调 `actor.playFadeOut(callback)`，callback 内从 displayEntities 移除。**注意**：该逻辑有 `e.id === 'player'` 跳过，player 不会被自动淡出
- **intent watch**（[useMapEntities.ts#L369-L389](file:///d:/wamp64/www/phpdts/vex-vue/src/composables/useMapEntities.ts#L369-L389)）：`intent='hit'` 当前映射到 default 分支 `player.idle()`（占位）

**`player-avatar.ts`**（playerAvatarStore）：
- 已有：`onEnter/onMove/onBattleStart/onBattleEnd/onHit/onDie/onLowHp/onNormalHp/notifyUp/notifyDown/setHpRatio`
- 缺：`onAttack()`、`onFlee()`、`onRevive()`（M3/M4 添加）
- `PlayerAvatarIntent` 11 种，缺 `'attack'`、`'flee'`、`'revive'`（M3/M4 添加）
- **dispatchIntent 有 50ms 防抖**（[player-avatar.ts#L36-L42](file:///d:/wamp64/www/phpdts/vex-vue/src/stores/player-avatar.ts#L36-L42)）：同一 intent 50ms 内重复触发会跳过。但 playTurnSegment 的 collision 间隔 450ms > 50ms，不影响连续受击
- **自动恢复机制**：`isDown=true` 时收到非 die/fall 意图 → 暂存 pendingIntent → 先派 popup → notifyUp 后 dispatch pending

**`actorRegistry.ts`**（已新建，M1 Task 1 完成）：
- 模块级单例 Map，提供 `registerActor`/`unregisterActor`/`getActorById`/`peekActors`
- useMapEntities 尚未接入（M1 Task 5 待完成）

---

## 三、关键缺口诊断

### 缺口 1：useMapEntities 无对外命令式 API

battle.ts 是 `await` 链式命令式时序（`playTurnSegment` 逐 entry 循环 + sleep），需要"播完动画再 sleep 再下一个 entry"的精确时序。Vue 响应式 watch 是异步 tick，不适合这种同步时序模型。

→ **必须暴露命令式 API**，让 battle.ts 直接 `actor.playHit()`、`actor.playFadeOut()`。

### 缺口 2：敌人无任何动画触发路径

battle.ts 仅判 `===currentPid`，敌人作为 target/actor/cleared 时静默。

→ 扩展 `playTurnSegment` 分支判断，区分 4 个角色身份（player 攻击/player 受击/敌人攻击/敌人受击）。

### 缺口 3：player intent='hit' 映射到 idle（占位未替换）

→ intent watch 中 `'hit'` case 改为 `player.playHit()`。

### 缺口 4：player 无 onAttack/onFlee/onRevive 接口

→ playerAvatarStore 新增方法 + intent 类型扩展 + watch 映射（M3/M4 实施）。

### 缺口 5：敌人死亡动画与 entities watch 的时序冲突（已决议）

**冲突分析**：敌人死亡时，battle.ts 若调 `playFall`（0.42s），后端随后从 enemies 列表移除该敌人 → entities watch 触发 `playFadeOut` → `playFadeOut` 内部 `killTweensOf` 会 kill 掉 `playFall` 的 tween → 视觉突兀（倒下中途变纯淡出）。

**决议**：当前阶段敌人死亡直接调 `playFadeOut`（与 entities watch 一致，无冲突）。`playFall` 留给未来 POI 转换（后端保留尸体时不触发 entities watch，playFall 能完整播放）。

未来扩展：敌人死亡后转为 POI 实体保留为尸体（可发现/可搜索），需后端配合——前端预留转换接口，当前不实施。

---

## 四、方案选择

需求文档列出方案 A/B/C。结合实际代码研判：

### 方案 A（battle store 状态 + useMapEntities watch）—— 不推荐

- battle.ts 已是 `await` 命令式链，再加 watch 异步触发会让时序失控
- useMapEntities 已有 4 路 watch，再加 3 路（lastHitTargetId/lastDeadTargetId/lastFleeActorId）会进一步膨胀
- 时序对齐困难：watch 触发是 next tick，无法保证"动画完成后再 sleep"

### 方案 B（useMapEntities 暴露命令式方法）—— 推荐（改良版）

- battle.ts 直接 `actor.playHit()` 符合命令式时序模型
- useActorAnimation 已预留 `getPosition()/getEl()/killAll()` 给战斗系统
- 敌人不需要 intent 状态机（无 isDown 恢复链），直接命令式调用最简
- player 继续走 playerAvatarStore（保留 intent 状态机和恢复链）

**改良点**：不直接让 battle.ts import useMapEntities（store 依赖 composable 不干净），而是**抽出独立的 actorRegistry 模块**作为命令式入口。

### 方案 C（敌人 intent 系统）—— 过度设计

敌人不需要 isDown 恢复链、不需要 pendingIntent 暂存，给它建状态机是浪费。

### 选定方案：B 改良版

核心改动：
1. 新建 `actorRegistry.ts` 模块级注册中心（✓ 已完成）
2. useMapEntities 在 setEntityRef 时 register/unregister
3. battle.ts import `getActorById` 直接命令式调用敌人动画
4. player 走 playerAvatarStore（扩展 onAttack/onFlee/onRevive，M3/M4）
5. 新增 `hitAnim`（✓ 已完成）/ `attackAnim`（M4）动画函数
6. **useActorAnimation 不依赖 actorRegistry**（playAttack 接收 targetPosition 而非 targetId，由调用方查询位置）

---

## 五、详细设计

### 5.1 新建 `actorRegistry.ts`（命令式注册中心）✓ 已完成

路径：`vex-vue/src/composables/actorRegistry.ts`

```ts
import type { ActorAnimation } from '@/types/actor-animation';

const actors = new Map<string, ActorAnimation>();

export function registerActor(id: string, controller: ActorAnimation): void {
  actors.set(id, controller);
}

export function unregisterActor(id: string): void {
  actors.delete(id);
}

export function getActorById(id: string): ActorAnimation | undefined {
  return actors.get(id);
}

/** 仅供调试用 */
export function peekActors(): ReadonlyMap<string, ActorAnimation> {
  return actors;
}
```

**职责**：模块级单例 Map，作为 battle.ts（store）与 useMapEntities（composable）之间的解耦层。battle.ts 不依赖 useMapEntities 实例，只依赖这个纯函数模块。

**useMapEntities 改动**（[setEntityRef#L93-L107](file:///d:/wamp64/www/phpdts/vex-vue/src/composables/useMapEntities.ts#L93-L107)）：
- `actors.set(id, useActorAnimation())` 后追加 `registerActor(id, controller)`
- `actors.delete(id)` 前追加 `unregisterActor(id)`

**依赖关系**（无循环）：
- `actorRegistry` → 仅依赖类型 `types/actor-animation`
- `useActorAnimation` → 依赖 `actorAnimations` + 类型（**不依赖 actorRegistry**）
- `useMapEntities` → 依赖 `useActorAnimation` + `actorRegistry`（注册）
- `battle.ts` → 依赖 `actorRegistry`（查询）+ `playerAvatarStore`
- intent watch（在 useMapEntities 内）→ 依赖 `actorRegistry`（查询 target 位置，M4）

### 5.2 动画函数扩展 `actorAnimations.ts`

#### `hitAnim(el, direction?, onComplete?)` ✓ 已完成（M1）

- **视觉**：受击方向轻微反冲 + 身体压缩 + 弹性回正，总时长 ~0.35s
- **参数**：`direction: 1 | -1 | 0`（受击方向，0 表示无方向只压缩）
- **结构**（参考 `fall` 的两段 timeline）：
  - 段 1（0~0.08s）：scaleY 1→0.85（受击压缩）+ x 朝受击方向偏移 direction * 6px
  - 段 2（0.08~0.35s）：x 回原位 + scaleY 弹性回正到 1（elastic.out 过冲 ~1.1 再回 1）
- **约束**：不动 x/y 基线（位置由 syncEntityPosition 管），只动 transform 的 scale/rotation/小范围 x 偏移
- **内部 killTweensOf**：与 fall/fadeOut 一致，开始前清掉 idle tween
- **x 偏移累积风险**：用 `+=`/`-=` 相对偏移，若段 1 执行中途被新 hitAnim 的 killTweensOf 杀掉，已应用的 x 偏移不会回滚，可能导致 x 累积偏移。当前阶段 collision 间隔 450ms > hitAnim 总时长 350ms，正常不会中途被 kill。若未来出现连续受击缩短间隔的场景，需改为记录初始 x 的绝对定位方式

#### `attackAnim(el, targetPosition?, kind?, onComplete?)`（M4 实施，当前留空骨架）

- **视觉**：根据 kind 分支
  - `melee`（默认）：朝目标方向快速冲撞一小段再弹回，总时长 ~0.3s
  - `ranged`：不位移，只做"蓄力后仰 → 释放前倾"姿势，总时长 ~0.3s
- **参数**：
  - `targetPosition: { x: number; y: number } | undefined`（用于 melee 算方向，undefined 时做无方向前冲）
  - `kind: AttackKind`（默认 'melee'）
- **melee 结构**（参考 `popUp` 三段 timeline）：
  - 段 1（0~0.08s）：scaleY 1→1.15（蓄力）+ 微后撤
  - 段 2（0.08~0.2s）：x/y 朝目标方向位移 ~15px + scaleY 1.15→0.95（冲刺压缩）
  - 段 3（0.2~0.3s）：x/y 回原位 + scaleY 0.95→1.0（回正）
- **ranged 结构**：
  - 段 1（0~0.1s）：scaleY 1→0.92 + rotation -5°（蓄力后仰）
  - 段 2（0.1~0.25s）：scaleY 0.92→1.08 + rotation +8°（释放前倾）
  - 段 3（0.25~0.3s）：scaleY/rotation 回正
- **方向计算**：由 `targetPosition` 与 actor 当前 `getPosition()` 算方向向量；未传则用 actor 当前朝向
- **约束**：动画结束必须回到原位（避免污染后续 syncEntityPosition）
- **内部 killTweensOf**：与 fall/fadeOut 一致
- **当前阶段仅实现 melee 分支，ranged 留空骨架**（未来扩展远程技能时填充）

### 5.3 `useActorAnimation.ts` 接口扩展

#### `playHit(direction?)`（M1 实施）

接口已声明（[types/actor-animation.ts#L39-L40](file:///d:/wamp64/www/phpdts/vex-vue/src/types/actor-animation.ts#L39-L40)），实现待添加。

**实现要点**：
- 内部调 `hitAnim(el, direction, () => startIdle(el))`
- **必须在 onComplete 里调 `startIdle(el)`**：hitAnim 段 2 结束后角色停在 scaleY:1 静止状态，不调 startIdle 会失去 idle 呼吸循环动画
- 不修改 isMoving（不影响移动同步逻辑）
- 不传 onDone 给 hitAnim（playHit 无额外回调需求，startIdle 已是最终态）

```ts
function playHit(direction?: 1 | -1 | 0): void {
  const e = getEl();
  hitAnim(e, direction, () => startIdle(e));
}
```

#### `playAttack(targetPosition?, kind?)`（M4 实施）

- 接收 `targetPosition`（已由调用方查询好的坐标），**不直接调 getActorById**（保持 useActorAnimation 不依赖 actorRegistry）
- `kind='melee'`（默认）：调 `attackAnim` 走冲撞分支
- `kind='ranged'`：调 `attackAnim` 走远程分支
- 动画结束后回调 `startIdle()`
- 不修改 isMoving

**数据流**（playAttack 方向计算，M4）：
1. battle.ts / intent watch 调 `getActorById(targetId)?.getPosition()` 查询目标位置
2. 把 `targetPosition` 传给 `actor.playAttack(targetPosition, kind)`
3. playAttack 内部调 `attackAnim(el, targetPosition, kind, onDone)`

### 5.4 `player-avatar.ts` 扩展（M3/M4 实施，M1 无需改动）

新增方法：

```ts
onAttack(targetId?: string, kind?: AttackKind): void  // dispatchWithRecovery('attack')
onFlee(): void                                         // dispatchIntent('flee')（直派，绕过恢复链）
onRevive(): void                                       // dispatchIntent('revive')（直派，绕过恢复链）
```

`PlayerAvatarIntent` 类型扩展：

```ts
| 'attack'        // 玩家发动攻击
| 'flee'          // 玩家逃跑
| 'revive'        // 玩家复活弹起
```

`dispatchWithRecovery` 不改签名，attack 的 targetId/kind 通过 store 内额外字段传递（最小改动，不破坏现有 dispatch 签名）：

```ts
lastAttackTargetId: string | null   // 供 intent watch 读取，默认 null
lastAttackKind: AttackKind          // 供 intent watch 读取，默认 'melee'
```

**onAttack 实现**：
```ts
function onAttack(targetId?: string, kind?: AttackKind): void {
  lastAttackTargetId.value = targetId ?? null;
  lastAttackKind.value = kind ?? 'melee';
  dispatchWithRecovery('attack');
}
```

**onFlee / onRevive 走 dispatchIntent 直派**（绕过恢复链），语义类似 `onDie`：
- `onFlee`：player 已逃跑，不应触发恢复链（逃跑后不"弹起"）
- `onRevive`：player 处于 isDown 状态时收到 revive，直接派发，由 intent watch 调 `player.enter(notifyUp)` 复用 popUp 弹起动画（已倒下时 setDown 是 no-op，popUp 直接弹起，语义匹配"复活"）

**onRevive 调用时机**：本次只预留接口，battle.ts 不调用。待未来复活功能（复活道具/战斗胜利复活）实现时接入。

### 5.5 intent watch 映射扩展

[useMapEntities.ts#L376-L386](file:///d:/wamp64/www/phpdts/vex-vue/src/composables/useMapEntities.ts#L376-L386) 的 intent→动画映射表扩展。

**M1 改动**（仅 'hit' 分支）：

| intent | 当前映射 | M1 新映射 |
|--------|---------|--------|
| `'hit'` | default 分支 `player.idle()`（占位） | `player.playHit()` |

M1 只改 'hit' 分支，其他 intent 保持不变。

**M3/M4 后续扩展**（本次不实施）：

| intent | M3/M4 新映射 |
|--------|--------|
| `'attack'` | `player.playAttack(getActorById(lastAttackTargetId)?.getPosition(), lastAttackKind)` |
| `'flee'` | `player.playFadeOut()`（**无 notifyDown 回调**） |
| `'revive'` | 合并到 `'enter'`/`'popup'` 分支：`player.enter(notifyUp)` |

**M1 完整 switch 代码**：
```ts
switch (intent) {
  case 'enter': case 'popup':
    player.enter(() => playerAvatarStore.notifyUp());
    break;
  case 'die': case 'fall':
    player.playFall(() => playerAvatarStore.notifyDown());
    break;
  case 'hit':
    player.playHit();
    break;
  default:
    // move / battle-start / battle-end / low-hp / normal-hp / idle → idle
    player.idle();
}
```

**M3/M4 关键修正**（本次仅记录，不实施）：
- `'flee'` → `player.playFadeOut()` **不调 notifyDown**。flee 是"逃跑离开"非"倒下死亡"，若调 notifyDown 会设 isDown=true，导致后续 onBattleEnd 触发恢复链（暂存 battle-end → 派 popup → 弹起），语义错误。player 保持 alpha=0。
- **flee 后 player 恢复可见性路径**：player 不会被 entities watch 自动淡出（L243 有 `e.id === 'player'` 跳过）。flee 后 player 保持 alpha:0 不可见。恢复路径：
  1. 若玩家逃跑后发生区域切换 → `watch(curLoc)` 的 `newRegion !== oldRegion` 分支调 `player.arrive()`（淡入弹起，恢复可见）
  2. 若玩家逃跑后仍在原区域 → `exitBattleMode()` 调 `onBattleEnd()` → intent='battle-end' 走 default 分支 `player.idle()`，但 idle 不恢复 alpha。**需在 M3 实施时确认是否在 onBattleEnd 或 flee 后手动调 `player.arrive()` 恢复可见性**
- `'revive'` 合并到 `case 'enter': case 'popup': case 'revive':`，复用 `player.enter(notifyUp)`。
- `'attack'` 的 targetPosition 由 intent watch 内部调 `getActorById` 查询（useMapEntities 已依赖 actorRegistry）。

### 5.6 `battle.ts` 对接逻辑

#### 新增常量

```ts
/** 清场动画时长（毫秒）— playFadeOut 0.35s + 缓冲 */
const CLEARED_ANIM_DURATION = 450;
```

#### collision 分支扩展 — M1 实施（仅敌人受击）

当前仅 `target_pid===currentPid` 调 `onHit`。M1 扩展为：在原有玩家受击基础上，新增敌人受击分支。

**M1 collision 分支代码**：
```ts
if (e.animation === 'collision' && e.hpSnapshot) {
  dataManager.broadcast('battle:play-collision', { entry: e, npcPid });

  const actor_pid = Number(e.actor_pid);
  const actor_type = Number(e.actor_type);
  const target_pid = Number(e.target_pid);
  const target_type = Number(e.target_type);
  const hpDropped = e.hpSnapshot.targetHpAfter < e.hpSnapshot.targetHpBefore;

  if (hpDropped) {
    if (target_pid === currentPid.value && target_type === 0) {
      // 玩家受击（已有逻辑，保留）
      usePlayerAvatarStore().onHit();
    } else if (target_type !== 0) {
      // 敌人受击：基于 attacker/target 实际 x 坐标计算受击方向
      const attackerId = actor_type === 0 ? 'player' : `enemy-${actor_pid}`;
      const attackerPos = getActorById(attackerId)?.getPosition();
      const targetPos = getActorById(`enemy-${target_pid}`)?.getPosition();
      // 攻击者在目标左边 → 目标被推向右（dir=1）；右边 → 推向左（dir=-1）；位置未知 → 仅压缩（dir=0）
      const dir: 1 | -1 | 0 = attackerPos && targetPos
        ? (attackerPos.x < targetPos.x ? 1 : -1)
        : 0;
      getActorById(`enemy-${target_pid}`)?.playHit(dir);
    }
  }

  await sleep(COLLISION_ANIM_DURATION);
}
```

**方向计算说明**：基于 attacker/target 的 GSAP x 坐标比较，而非假设"玩家始终在左"。这处理了玩家从右侧攻击敌人的情况。若坐标查询失败（actor 未注册），dir=0 仅播放压缩动画，不报错。

#### collision 分支扩展 — M4 后续（攻击者动画，本次不实施）

M4 在 M1 基础上追加攻击者动画：
```ts
// 攻击者动画（player 或敌人）— M4
if (actor_pid === currentPid.value && actor_type === 0) {
  usePlayerAvatarStore().onAttack(targetId, 'melee');
} else if (actor_type !== 0) {
  const targetPos = getActorById(targetId)?.getPosition();
  getActorById(`enemy-${actor_pid}`)?.playAttack(targetPos, 'melee');
}
```

#### combatant_cleared 分支扩展 — M2 实施（本次不实施，仅记录设计）

当前仅 `cleared_pid===currentPid && reason==='death'` 调 `onDie`。M2 扩展：

```ts
if (e.directedKind === 'combatant_cleared') {
  const cleared_pid = Number(e.cleared_pid);
  const reason = e.reason;

  if (cleared_pid === currentPid.value) {
    if (reason === 'death') {
      usePlayerAvatarStore().onDie();  // 已有
    } else if (reason === 'escaped') {
      usePlayerAvatarStore().onFlee();  // M3：玩家逃跑淡出
    }
  } else if (cleared_pid === npcPid) {
    const actor = getActorById(`enemy-${cleared_pid}`);
    if (reason === 'death' || reason === 'escaped') {
      // 当前阶段：死亡和逃跑都走 playFadeOut（与 entities watch 一致，无时序冲突）
      // playFall 留给未来 POI 转换（后端保留尸体时不触发 entities watch）
      actor?.playFadeOut();
    }
  }

  await sleep(CLEARED_ANIM_DURATION);  // 等动画完成再继续下一个 entry
}
```

**关键决议**：敌人死亡调 `playFadeOut` 而非 `playFall`。原因：
- 后端会从 enemies 列表移除死亡敌人 → entities watch 触发 `playFadeOut`（内部 `killTweensOf`）
- 若 battle.ts 先调 `playFall`，entities watch 的 `playFadeOut` 会 kill 掉 fall 的 tween，视觉突兀
- 直接调 `playFadeOut` 与 entities watch 一致，两者都从当前 alpha 继续到 0，无冲突
- 视觉是淡出消失，用户已确认接受

**entities watch 的 playFadeOut 交互**：battle.ts 调 `actor.playFadeOut()` 后，后端从 enemies 移除该敌人时，entities watch 再次调 `actor.playFadeOut(callback)`——此时 actor alpha 已≈0，fadeOut 是 no-op（从 0 到 0），但 callback 仍会触发，正常完成 displayEntities 移除。无重复动画问题。

#### flee 事件处理

`directedKind==='flee'` 是"开始逃跑"信号（仅 success=true，无 HP 变化），**不触发动画**——逃跑视觉反馈在后续 `combatant_cleared reason='escaped'` 时统一触发。flee 事件继续走模态框文本渲染。

### 5.7 敌人死亡处理（已决议）

**当前阶段**：敌人死亡 → `playFadeOut()`（淡出消失）。后端从 enemies 列表移除 → entities watch 触发 `playFadeOut`（no-op）→ DOM 卸载。无需前端冻结机制。

**未来扩展（POI 转换，需后端配合）**：敌人死亡后转为 POI 实体保留为尸体（可发现/可搜索）。预留接口：

```ts
// 未来在 useMapEntities 新增
function convertActorToCorpse(pid: number): void {
  const actorId = `enemy-${pid}`;
  const corpseId = `corpse-${pid}`;
  // 1. 调用 playFall（完整倒下动画，后端此时不会从 enemies 移除，entities watch 不触发）
  // 2. unregisterActor(actorId) —— 移除动画控制器
  // 3. 从 entities 列表把 enemy-{pid} 替换为 corpse-{pid}（kind='poi'）
  // 4. corpse 实体复用原立绘 img，无 actorKind
}
```

当前不实施，待后端支持"尸体作为可交互 POI"后再启用。

### 5.8 时序对齐

当前 `playTurnSegment` 用固定 `await sleep()` 对齐动画。动画时长：
- `playHit` ~0.35s（hitAnim 0.35s + startIdle 接管，startIdle 是 repeat:-1 不会阻塞）
- `playAttack` ~0.3s（M4）
- `playFadeOut` ~0.35s（已有）
- `playFall` ~0.42s（已有，未来 POI 用）

**本次方案**：
- collision 分支：保持 `await sleep(COLLISION_ANIM_DURATION)` = 450ms（覆盖 hit 0.35s + attack 0.3s）
- combatant_cleared 分支：新增 `await sleep(CLEARED_ANIM_DURATION)` = 450ms（覆盖 fadeOut 0.35s）

**长期方案（可选优化）**：让 `playHit/playAttack/playFadeOut` 返回 Promise，`playTurnSegment` 改为 `await Promise.race([actor.playHit(), sleep(800)])`（超时兜底）。本次不实施，留待后续优化。

### 5.9 连续受击处理（已决议）

`playTurnSegment` 是 `await` 链式串行——每次 collision 后 `await sleep(450)`，所以"连续受击"在时序上是**串行**的，第一次 hit（0.35s）播完 + sleep 100ms 空档后，才播第二次 hit。**不存在真正打断**。

**决议**：每次受击都播 `playHit()`，依靠串行时序自然分隔。animToken 机制（已有）防止旧 tween 残留。无需专门的"连续受击动画"。

**dispatchIntent 防抖验证**：[player-avatar.ts#L38](file:///d:/wamp64/www/phpdts/vex-vue/src/stores/player-avatar.ts#L38) 的 50ms 防抖对同一 intent 生效，但 playTurnSegment 的 collision 间隔 450ms > 50ms，连续 onHit 不会触发防抖。✓

可选优化（后续视效果再定）：检测到同一敌人连续受击时缩短 sleep（如 450→250ms），让两次 hit 视觉更紧凑。本次不实施。

---

## 六、实施优先级与里程碑

按需求文档 P0/P1/P2 分级，结合依赖关系排序：

### M1：P0 受击摇晃（player + 敌人）

依赖：actorRegistry（✓ 已建）→ hitAnim（✓ 已建）→ playHit → intent watch 改映射 → battle.ts collision 分支扩展

**M1 任务清单**：
1. ✓ 新建 `actorRegistry.ts`（已完成）
2. ✓ `actorAnimations.ts` 新增 `hitAnim`（已完成）
3. ✓ `types/actor-animation.ts` 接口加 `playHit`（已完成）
4. ⬜ `useActorAnimation.ts` 新增 `playHit` 方法实现（内部调 `hitAnim(el, direction, () => startIdle(el))`）
5. ⬜ `useMapEntities.ts`：
   - import `registerActor`/`unregisterActor`/`getActorById`
   - `setEntityRef` 接入 register/unregister
   - intent watch `'hit'` 分支从 default 改为 `player.playHit()`
6. ⬜ `battle.ts`：
   - import `getActorById`
   - collision 分支扩展敌人受击（基于坐标计算 dir）

### M2：P0 敌人死亡/逃跑淡出

依赖：M1 的 actorRegistry（已建）

1. `battle.ts` 新增 `CLEARED_ANIM_DURATION` 常量
2. `battle.ts` combatant_cleared 分支扩展：敌人死亡/逃跑调 `actor.playFadeOut()` + `await sleep(CLEARED_ANIM_DURATION)`
3. 玩家逃跑分支：`usePlayerAvatarStore().onFlee()`（依赖 M3 的 onFlee 实现，或合并 M2/M3）

### M3：P1 玩家逃跑淡出 + 复活弹起接口

依赖：M1 的 actorRegistry

1. `player-avatar.ts` 新增 `onFlee()` + `onRevive()` + intent='flee'/'revive' + `dispatchIntent` 直派
2. `PlayerAvatarIntent` 类型加 `'flee'`、`'revive'`
3. intent watch 新增 `'flee'` → `player.playFadeOut()`（无 notifyDown）、`'revive'` 合并到 `'enter'`/`'popup'`
4. `battle.ts` combatant_cleared reason='escaped' 扩展 player 分支（调 onFlee）
5. **确认 flee 后 player 恢复可见性路径**：若 onBattleEnd 的 idle 不恢复 alpha，需在 flee 动画完成后或区域切换时手动调 `player.arrive()`

**注意**：M2 的玩家逃跑分支（步骤 3）与 M3 的 onFlee 重复。实施时 M2 先用 `usePlayerAvatarStore().onFlee()` 调用（store 方法在 M3 实现），或合并 M2/M3。

### M4：P1 攻击冲撞（player + 敌人，近战）

依赖：M1 的 actorRegistry + M3 的 playerAvatarStore 扩展模式

1. `actorAnimations.ts` 新增 `attackAnim`（melee 分支，ranged 留空骨架）
2. `useActorAnimation.ts` 新增 `playAttack(targetPosition?, kind?)` + 接口扩展
3. `types/actor-animation.ts` 新增 `AttackKind` 类型
4. `player-avatar.ts` 新增 `onAttack(targetId?, kind?)` + intent='attack' + `lastAttackTargetId`/`lastAttackKind` 字段
5. `PlayerAvatarIntent` 类型加 `'attack'`
6. intent watch 新增 `'attack'` 分支（查 targetPosition 后调 playAttack）
7. `battle.ts` collision 分支扩展攻击者动画（player onAttack + 敌人 playAttack）

### M5：P2 战斗姿态 / 低血量（可选，本次不实施）

- 接口已通，仅缺专属动画函数（如 `battleReadyAnim`、`weakStanceAnim`）
- `battle.ts` 补 `onLowHp()` 调用（当前未接）

### M6：未来扩展 —— 敌人尸体转 POI（需后端配合，本次不实施）

- 后端支持"尸体作为可交互 POI"后，实施 `convertActorToCorpse(pid)` 转换逻辑
- 前端预留接口设计见 5.7 节
- 届时敌人死亡动画从 `playFadeOut` 改回 `playFall`（完整倒下 + 尸体保留）

---

## 七、已确认决议（原待确认问题）

### Q1：敌人死亡后保留方式 → 当前走淡出，未来 POI 预留

**决议**：当前阶段敌人死亡直接 `playFadeOut()`（淡出消失，与 entities watch 一致无冲突）。未来改为 POI 身份保留为尸体（可发现/可搜索），需后端配合——前端预留 `convertActorToCorpse` 接口（见 5.7 节），当前不实施。届时敌人死亡动画改回 `playFall`（完整倒下，后端不移除尸体所以 entities watch 不触发）。

**POI 方案长期优势**：
- 类型已预留（[map-entity.ts#L20](file:///d:/wamp64/www/phpdts/vex-vue/src/types/map-entity.ts#L20) 明确列出 `'poi'`）
- 不污染战斗动画系统：尸体不绑定 `ActorAnimation` 控制器，不会被 `getActorById` 误触发
- 语义清晰：actor 是会动的角色，尸体是场景物件
- 尸体的"可发现/可搜索"语义正是 POI 的典型用途

### Q2：玩家复活弹起 → 预留 onRevive 接口

**决议**：`playerAvatarStore.onRevive()` → intent='revive' → intent watch 合并到 `'enter'`/`'popup'` 分支调 `player.enter(notifyUp)` 复用 popUp 弹起动画。无需新动画函数（已倒下时 setDown 是 no-op，popUp 直接弹起，语义匹配"复活"）。调用时机由 battle.ts 决定（战斗胜利后、或复活道具使用后），本次只预留接口不实现调用。

### Q3：近战/远程区分 → playAttack 加 kind 参数

**决议**：`playAttack(targetPosition?, kind?: AttackKind)`，`AttackKind = 'melee' | 'ranged'`。
- `melee`（默认）：冲撞 15px（当前设计）
- `ranged`：不位移，只做"蓄力后仰 → 释放前倾"姿势
- 当前阶段仅实现 melee 分支，ranged 留空骨架
- battle.ts 调用时根据 `action_id` 推导 kind（`unarmed_strike` → melee；未来远程技能 → ranged）

**数据流**：playAttack 接收 `targetPosition`（{x,y} 对象）而非 targetId，由调用方（battle.ts / intent watch）通过 `getActorById(targetId)?.getPosition()` 查询后传入。useActorAnimation 不依赖 actorRegistry。

### Q4：连续受击 → 每次播 playHit，依靠串行时序

**决议**：每次受击都播 `playHit()`。`playTurnSegment` 是 `await` 链式串行，每次 collision 后 `await sleep(450)`，第一次 hit（0.35s）播完 + sleep 100ms 空档后才播第二次 hit，不存在真正打断。animToken 机制（已有）防止旧 tween 残留。dispatchIntent 的 50ms 防抖对 450ms 间隔无效。无需专门的"连续受击动画"。

---

## 八、审阅修正记录

### v1 修正（2026-07-01 首次审阅）

| 问题 | 原设计 | 修正后 |
|------|--------|--------|
| 1. flee 的 isDown 语义 | `'flee'` → `playFadeOut(notifyDown)` | `'flee'` → `playFadeOut()`（无回调），flee 不设 isDown=true |
| 2. combatant_cleared 缺 sleep | 分支代码无 await sleep | 加 `await sleep(CLEARED_ANIM_DURATION)` |
| 3. playAttack 依赖关系 | playAttack 内部调 getActorById | playAttack 接收 targetPosition，由调用方查询位置 |
| 4. intent watch revive 映射 | 'revive' 单列 | 合并到 `'enter'`/`'popup'` 分支 |
| 5. 敌人死亡动画选择 | 调 playFall（与 entities watch 冲突） | 改调 playFadeOut（与 entities watch 一致） |

### v2 修正（2026-07-01 二次审阅）

| 问题 | v1 设计 | v2 修正 |
|------|--------|--------|
| 1. playHit 缺 startIdle 回调 | 5.3 仅写"内部调 hitAnim(el, direction)" | 明确 `hitAnim(el, direction, () => startIdle(el))`，段 2 结束后角色停在 scaleY:1 静止状态，必须调 startIdle 恢复呼吸循环 |
| 2. 5.5/5.6 混合多里程碑代码 | intent watch 映射表和 collision 分支把 M1/M3/M4 代码混写 | 拆分 M1/M3/M4 代码段，明确标注当前阶段实施范围 |
| 3. dir 计算过于简化 | `dir = actor_pid === currentPid ? 1 : -1`（假设玩家在左） | 改为基于 attacker/target 实际 x 坐标：`attackerPos.x < targetPos.x ? 1 : -1`，坐标未知时 dir=0 |
| 4. flee 后 player 恢复路径未说明 | 5.5 未提及 player alpha 恢复 | 补充恢复路径分析：entities watch 跳过 player，flee 后 alpha=0，需区域切换 arrive 或手动调 arrive 恢复；M3 实施时需确认 |
| 5. hitAnim x 偏移累积风险未记录 | 5.2 未提及 `+=`/`-=` 的累积风险 | 补充约束说明：当前 450ms 间隔无风险，未来缩短间隔需改绝对定位 |
| 6. 缺 M1 实施清单 | 里程碑只有粗略步骤 | M1 补充详细任务清单（6 项，标注已完成/待完成） |

---

## 九、文件改动清单

| 文件 | 改动类型 | 里程碑 | 说明 |
|------|---------|--------|------|
| `vex-vue/src/composables/actorRegistry.ts` | 新建 | M1 ✓ | 模块级 actor 注册中心 |
| `vex-vue/src/animations/actorAnimations.ts` | 修改 | M1 ✓ / M4 | M1: 新增 hitAnim；M4: 新增 attackAnim |
| `vex-vue/src/types/actor-animation.ts` | 修改 | M1 ✓ / M4 | M1: 接口加 playHit；M4: 加 playAttack + AttackKind |
| `vex-vue/src/composables/useActorAnimation.ts` | 修改 | M1 / M4 | M1: 新增 playHit；M4: 新增 playAttack |
| `vex-vue/src/composables/useMapEntities.ts` | 修改 | M1 / M3 / M4 | M1: setEntityRef 接入 register/unregister + intent watch 改 hit；M3/M4: 扩展其他 intent 映射 |
| `vex-vue/src/types/player-avatar.ts` | 修改 | M3 / M4 | PlayerAvatarIntent 加 'attack'、'flee'、'revive' |
| `vex-vue/src/stores/player-avatar.ts` | 修改 | M3 / M4 | 新增 onAttack、onFlee、onRevive、lastAttackTargetId、lastAttackKind |
| `vex-vue/src/stores/battle.ts` | 修改 | M1 / M2 / M3 / M4 | M1: collision 敌人受击；M2: combatant_cleared 敌人淡出；M3: 玩家逃跑；M4: 攻击者动画 |

预计代码增量：~450 行（含动画函数 ~180 行、battle.ts 分支扩展 ~120 行、其他 ~150 行）。

---

**文档结束。**
