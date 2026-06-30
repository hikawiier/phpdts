# 战斗小人动画需求表

> 用途：供导演系统/播放系统设计者对接接口。
> 背景：地图小人动画框架已建立（见 [ACTOR_ANIMATION_FRAMEWORK.md](ACTOR_ANIMATION_FRAMEWORK.md)），
> 每 actor 拥有独立动画控制器（`useActorAnimation`），支持 `enter/arrive/moveTo/idle/playFall` 等方法。
> 本表列出战斗场景下小人所需的动画，以及当前接口对接现状。
> 附注：目前敌人（NPC）从视野消失的淡出动画会应用于所有被移出地图的对象。这是因为在未来战斗中死去的敌人不会被直接从地图中移出，而是以尸体形式留在地图上。尸体被移除时可以应用和视野消失一样的淡出动画。
>
> 创建时间：2026-07-01

---

## 一、接口对接现状总览

| 动画 | player 接口 | 敌人接口 | 后端事件源 | 导演层 directedKind |
|------|------------|---------|-----------|-------------------|
| 受击摇晃 | ✅ `onHit()` 已有 | ❌ 无 | `once_execute_pre/post` | `action`（含 `animation='collision'`） |
| 攻击冲撞 | ❌ 无 | ❌ 无 | `once_execute_pre/post` | `action` |
| 逃跑淡出 | ❌ 无 `onFlee()` | ❌ 无 | `phase='flee'` | `flee` |
| 死亡倒下 | ✅ `onDie()` 已有 | ❌ 无 | `combatant_cleared`（reason=dead） | `combatant_cleared` |
| 战斗开始姿态 | ✅ `onBattleStart()` 已有 | ❌ 无 | 战斗模式进入 | — |
| 战斗结束恢复 | ✅ `onBattleEnd()` 已有 | ❌ 无 | `battle_end` | `battle_end` |
| 低血量虚弱 | ✅ `onLowHp()` 已有 | ❌ 无 | HP 比例变化 | — |
| 消失淡出（非战斗） | — | ✅ TransitionGroup leave | entities 列表移除 | — |

**关键缺口**：敌人（NPC）没有任何动画接口。当前 battle.ts 仅在 `target_pid === currentPid`（player 被打）时调 `onHit()`，敌人作为攻击者或受击者时无任何地图小人动画触发。

---

## 二、详细需求

### 2.1 受击摇晃（Hit Shake）

**动画效果**：角色被攻击命中时，轻微左右摇晃 + 冲击压缩，表示被打中。总时长约 0.35s。

**触发条件**：
- 后端 emit `once_execute_pre` + `once_execute_post` 配对
- 导演层 `pairPrePost` 合并为 `directedKind='action'`，`animation='collision'`
- `hpSnapshot.targetHpAfter < hpSnapshot.targetHpBefore`（HP 实际下降）

**player 接口现状**：
- ✅ 已通：`battle.ts:469` 的 `playTurnSegment` 已判断 `target_pid === currentPid` → `playerAvatarStore.onHit()` → intent='hit'
- ⚠️ 当前 intent watch 中 'hit' 映射到 `player.idle()`（无受击动画），需改为 `player.playHit()`（动画函数待实现）

**敌人接口需求**：
- ❌ 当前 battle.ts 只处理 `target_pid === currentPid`，敌人被打中时无动画
- **需要**：battle.ts 添加分支，当 `target_pid` 是敌人（`target_type` 为敌人类型）且 HP 下降时，通知地图层播放敌人受击动画
- **建议接口**：battle.ts 通过某种机制（如 battle store 添加 `lastHitTargetId` 状态，或直接调用 useMapEntities 暴露的方法）通知地图层对指定敌人播放 `playHit()`

### 2.2 攻击冲撞（Attack Lunge）

**动画效果**：角色发动攻击时，向目标方向快速冲撞一小段距离再弹回。总时长约 0.3s。

**触发条件**：
- 后端 emit `once_execute_pre` + `once_execute_post` 配对
- 导演层 `directedKind='action'`
- 当前角色是攻击者（`actor_pid`）

**player 接口现状**：
- ❌ 无 `onAttack()` 方法，`PlayerAvatarIntent` 无 'attack' 意图

**敌人接口需求**：
- ❌ 无

**需要**：
- playerAvatarStore 新增 `onAttack(targetId?)` → intent='attack'
- battle.ts 在 `directedKind='action'` 且 `actor_pid === currentPid` 时调 `onAttack()`
- 敌人攻击时（`actor_pid` 是敌人），通知地图层对敌人播放攻击冲撞

### 2.3 逃跑淡出（Flee Fade）

**动画效果**：角色逃跑成功时，快速淡出消失。总时长约 0.4s。

**触发条件**：
- 后端 emit `phase='flee'`，携带 `actor_pid` / `success`
- 导演层映射为 `directedKind='flee'`
- 或 `directedKind='combatant_cleared'` + `reason='escaped'`

**player 接口现状**：
- ❌ playerAvatarStore 无 `onFlee()` 方法，`PlayerAvatarIntent` 无 'flee' 意图
- battle.ts 中 flee 事件只走模态框文字渲染，未调 playerAvatarStore

**敌人接口需求**：
- ❌ 无

**需要**：
- playerAvatarStore 新增 `onFlee()` → intent='flee'
- battle.ts 在 `directedKind='flee'` 且 `actor_pid === currentPid` 时调 `onFlee()`
- intent watch 中 'flee' case → `player.playFadeOut()`
- 淡出完成后可能需要配合区域切换（arrive 到新区域）

### 2.4 死亡倒下（Die Fall）

**动画效果**：角色 HP 归零时倒下（旋转 + 渐隐）。已有 `fall()` 动画函数。

**触发条件**：
- `directedKind='combatant_cleared'` + `reason='dead'`
- 或 `directedKind='battle_end'` 兜底

**player 接口现状**：
- ✅ 已通：`battle.ts:481/501` 在 combatant_cleared 主判定 + battle_end 兜底调 `onDie()` → intent='die' → intent watch → `player.playFall(notifyDown)`

**敌人接口需求**：
- ❌ 敌人死亡时无动画
- **需要**：battle.ts 在 `cleared_pid` 是敌人时，通知地图层对敌人播放 `playFall()`
- 敌人倒下后应从 entities 列表移除（走 TransitionGroup 淡出，或直接 fall + 延迟移除）

### 2.5 战斗开始姿态（Battle Ready）

**动画效果**：进入战斗时，角色切换到战斗待机姿态（如身体前倾、握拳）。可选——当前用 idle 也可接受。

**触发条件**：战斗模式进入

**player 接口现状**：
- ✅ 已有：`onBattleStart()` → intent='battle-start' → intent watch → `player.idle()`（当前无专属姿态）

**敌人接口需求**：
- ❌ 无

### 2.6 战斗结束恢复（Battle End）

**动画效果**：战斗结束后，角色恢复普通待机。

**触发条件**：`directedKind='battle_end'`

**player 接口现状**：
- ✅ 已有：`onBattleEnd()` → intent='battle-end' → intent watch → `player.idle()`

**敌人接口需求**：
- ❌ 无（敌人通常在战斗结束时已死亡或逃跑）

### 2.7 低血量虚弱（Low HP）

**动画效果**：HP 低于阈值时，角色进入虚弱姿态（如身体倾斜、呼吸急促）。可选。

**触发条件**：HP 比例变化

**player 接口现状**：
- ✅ 已有：`onLowHp()` / `onNormalHp()` → intent='low-hp'/'normal-hp' → intent watch → `player.idle()`（当前无专属姿态）

**敌人接口需求**：
- ❌ 无

---

## 三、敌人动画接口对接方案建议

当前敌人没有任何动画接口。以下是三种可选的对接方案，供导演系统设计者参考：

### 方案 A：battle store 状态 + useMapEntities watch（推荐）

- battle.ts 在检测到敌人受击/死亡/逃跑时，更新 battle store 的状态（如 `lastHitTargetId`、`lastDeadTargetId`、`lastFleeActorId`）
- useMapEntities watch 这些状态，变化时调对应敌人的 `actor.playHit()` / `actor.playFall()` / `actor.playFadeOut()`
- 优点：解耦，battle.ts 不依赖 useMapEntities
- 缺点：需要 battle store 添加新状态字段

### 方案 B：useMapEntities 暴露命令式方法

- useMapEntities 暴露 `playActorHit(id)` / `playActorFall(id)` / `playActorFadeOut(id)` 方法
- battle.ts 通过某种方式获取 useMapEntities 实例（如 provide/inject 或全局单例）
- 优点：直接调用，无中间状态
- 缺点：battle.ts（store）依赖 useMapEntities（composable），架构上不太干净

### 方案 C：敌人 intent 系统（类似 player）

- 给敌人也建立 intent 状态机（类似 playerAvatarStore 但每敌人一个）
- battle.ts 调 `enemyAvatarStore.onHit()` 等
- 优点：与 player 架构一致
- 缺点：过度设计，敌人不需要 isDown 状态机

**推荐方案 A**：最小改动，保持架构清晰。

---

## 四、优先级

| 优先级 | 动画 | 理由 |
|--------|------|------|
| P0 | 受击摇晃 | 战斗最常见反馈，player 接口已通只需补动画函数 |
| P0 | 死亡倒下（敌人） | 敌人死亡无动画是明显缺失 |
| P1 | 逃跑淡出（player） | 逃跑无视觉反馈 |
| P1 | 攻击冲撞 | 增强战斗打击感 |
| P2 | 战斗开始/结束姿态 | 锦上添花 |
| P2 | 低血量虚弱 | 锦上添花 |

---

**文档结束。**
