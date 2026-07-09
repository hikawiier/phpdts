# CharacterHub、宽松战斗表现与动态参战统一设计案

> **已被替代**：本文中的动态参战、ImpactBatch、AOE 批量原子性和 action UnitOfWork 设计已由
> [`逐目标结算与动态参战框架重构设计案.md`](./逐目标结算与动态参战框架重构设计案.md) 替代。本文仅保留为分析记录；实施以新设计案为准。

> 目的：在保留 CharacterHub 统一角色当前状态、前端战斗 UI 可早进晚退这两个正确方向的基础上，修正目标选择与战场成员关系之间的错误边界，建立完整的动态参战、自由瞄准、动作链预览、事务、事件播放和前端一致性协议。
>
> 本设计案基于当前实际代码，而不是仅基于已有文档推演。它修正并覆盖：
>
> - [`地图实体真值源统一设计案.md`](./地图实体真值源统一设计案.md) 中“战斗中所有可见敌人可直接作为动作目标”的不完整结论；
> - [`前端战斗退出后端校验设计案.md`](./前端战斗退出后端校验设计案.md) 中“前端不维护任何阶段”和“空 battlelog 合成战斗结束演出”的不准确目标；
> - 当前前端 `in-battle` 装填强制绑定 `defaultTargetPid` 的实现错误；
> - 当前后端允许任意 PID 承受战斗效果、但没有加入当前 qid 的领域缺口。

---

## 1. 结论摘要

### 1.1 保留的设计方向

1. **CharacterHub 方向正确**：前端需要一个以 PID 为 key 的角色当前状态统一投影，地图、状态栏、角色详情和目标显示不应分别维护角色副本。
2. **宽松战斗表现模式正确**：前端战斗工作区可以早于后端 `action='battle'` 打开，也可以晚于后端退出，以容纳预装填和战斗演出。
3. **战斗中显示所有已发现 NPC 正确**：非当前战场成员可以继续显示并半透明降级，不能因为进入战斗就从地图消失。
4. **每个动作独立保存目标正确**：当前 `TargetIntent` 和队列项已经能表达一条动作链分别攻击不同 PID，不需要退回“整场战斗只有一个敌人”的模型。
5. **退出以后端状态校验为准正确**：battlelog 播放完成后再读取后端 `action`/战场状态决定是否退出，前端不推断领域战斗是否结束。

### 1.2 必须修正的设计边界

1. CharacterHub 不是游戏真值源，只是**前端角色当前状态投影**。后端数据库、先攻队列、战场状态机和 Combat ViewModel 才是领域权威。
2. `validTargets` 不是完整的“合法目标集合”。当前后端只筛选当前 qid 中 `type>0 / state=0 / active=1` 的成员，没有包含具体技能射程、AP、标签规则和动态参战资格。
3. “可见”不等于“可提交”。CharacterHub 决定角色能否呈现；CombatSession 决定角色属于当前战场、可动态加入还是被阻止；具体技能 preview/执行决定本动作是否合法。
4. 前端不应复制后端领域状态机，但必须维护或派生**表现阶段**。预装填、等待后端、播放、玩家输入、NPC 处理、重校验本来就是不同 UI 阶段。
5. 空 battlelog 不代表战斗结束，不得合成“战斗已结束”。空日志后继续后端校验才是正确行为。
6. 动态参战不能通过“目标解析器允许查任意 PID”间接实现，必须是一个原子的领域操作：验证资格、加入 qid、设置 `action/bid`、写队列、更新缓存并生成事件。

### 1.3 最终架构分工

```text
后端领域真值
  oblplayers + oblqueue + oblbattle_state + oblgame
        │
        ├─ Combat Participation：谁属于当前战场、谁可以加入
        ├─ Combat Plan/Preview：动作链是否合法、会影响谁、谁会加入
        ├─ Combat Execution：效果、死亡、逃跑、队列推进
        └─ Battle Event Outbox：已提交的语义事件
        │
        ▼
Combat ViewModel / State API
        │
        ├─ CharacterHub：角色现在是什么
        ├─ MapEntityProjection：当前区域哪些角色如何呈现
        ├─ CombatSession：当前战场允许什么
        ├─ CombatDraftStore：本输入窗口已装填什么、preview 是否可提交
        ├─ TargetingSession：玩家这次正在选什么
        └─ BattlePlayback：过去发生了什么、如何播放
```

---

## 2. 已核实的当前实现

### 2.1 `in-battle` 被固定到旧目标的完整链路

当前固定目标不是 AimMode 的限制，而是 PreloadArea 在进入 AimMode 前被默认 PID 快捷路径截断。

后端在构建 Combat ViewModel 时，把当前队列中第一个存活、活跃 NPC 设为 `defaultTargetPid`：

- [`obl_state_handlers.php:182`](../include/api/obl_state_handlers.php#L182)

前端随后依次执行：

```text
combat_context.defaultTargetPid
  → battleStore.updateActionPanel(... enemyPid)
  → PreloadArea.initPreloadArea(... enemyPid)
  → 点击 target='enemy' 技能
  → enemyPid > 0
  → 直接 addToQueue(pid)
  → AimMode 永远不启动
```

关键代码：

- [`battle.ts:322`](../../vex-vue/src/stores/battle.ts#L322)
- [`PreloadArea.vue:65`](../../vex-vue/src/components/battle/PreloadArea.vue#L65)
- [`PreloadArea.vue:268`](../../vex-vue/src/components/battle/PreloadArea.vue#L268)

`defaultTargetPid` 只是队列顺序给出的 UI 建议，不是玩家选择、当前锁定目标或具体技能规则结果。把它自动写入动作队列属于前端实现错误。

### 2.2 AimMode 已具备自由选 PID 的基本链路

AimMode 已经能够：

- 遍历 CharacterHub 的敌人；
- 按当前/计划位置与技能射程计算可达性；
- 点击后通过 `battle:aim-target-selected` 返回真实 PID；
- 由 PreloadArea 把该 PID 写入具体 QueueItem。

参考：

- [`AimMode.vue:87`](../../vex-vue/src/components/battle/AimMode.vue#L87)
- [`AimMode.vue:207`](../../vex-vue/src/components/battle/AimMode.vue#L207)
- [`PreloadArea.vue:357`](../../vex-vue/src/components/battle/PreloadArea.vue#L357)
- [`PreloadArea.vue:398`](../../vex-vue/src/components/battle/PreloadArea.vue#L398)

因此自由选目标不需要改变 action payload；只需要删除默认 PID 的隐式自动入队语义，并补全候选资格与后端动态参战。

### 2.3 当前瞄准锚点不支持多实体

当前敌人瞄准实际挂在地图 cell：

- 每个 cell 只有一个 `data-enemy-pid`：[`MapGrid.vue:224`](../../vex-vue/src/components/map/MapGrid.vue#L224)
- 同一位置只通过 `enemyList.find()` 取第一个 NPC：[`useMapRender.ts:268`](../../vex-vue/src/composables/useMapRender.ts#L268)
- 当前玩家所在格在查找敌人之前已经进入 `isCurrent` 分支，所以同格 NPC 没有敌人 cell 锚点：[`useMapRender.ts:244`](../../vex-vue/src/composables/useMapRender.ts#L244)
- 独立角色实体默认 `pointer-events:none`：[`terminal.css:171`](../../vex-vue/src/assets/styles/terminal.css#L171)

这会导致：

- 同一格多个 NPC 只能选择一个；
- 与玩家同格的 NPC 不能通过敌人格选择；
- 角色移动动画期间，cell PID 与实际角色实体可能失配。

动态参战与多目标战斗要求把敌人瞄准锚点迁移到独立角色实体，地图 cell 只继续承担 tile 目标。

### 2.4 后端允许攻击任意 PID，但不会让它参战

单 PID 目标解析器只按 PID 查询数据库，没有校验当前 qid：

- [`combat.target.php:60`](../include/game/combat/combat.target.php#L60)

动作执行后：

- effect 会修改并保存目标：[`combat.pipeline.php:270`](../include/game/combat/combat.pipeline.php#L270)
- post_check 会把目标加入本请求 `battle_cache['combatants']`：[`combat.state.php:85`](../include/game/combat/combat.state.php#L85)
- 但不会写 `action='battle'`、`bid=qid` 或队列行；
- `battle_manage_queue()` 最终仍从数据库队列行决定顺位和解散：[`battle.queue.main.php:129`](../include/game/battle/battle.queue.main.php#L129)

因此外部目标存活时会受伤但没有行动权；死亡时又会因为 `combat_state_clear()` 发现 `action` 为空而提前返回：

- [`combat.state.php:115`](../include/game/combat/combat.state.php#L115)

可能留下 `hp=0`、`state=0` 的不一致记录。

### 2.5 现有 `battle_queue_join()` 不能直接复用

现有 join 原语会先无条件删除目标 PID 的旧队列行，再插入当前 qid：

- [`battle.queue.func.php:217`](../include/game/battle/battle.queue.func.php#L217)
- [`combat.queue.php:67`](../include/game/combat/combat.queue.php#L67)

如果目标已经属于其他 qid，直接复用会把它从另一场战斗中抢走，但不会正确处理源战场的：

- 当前行动者与 done 状态；
- round 和 next_pid；
- 状态机；
- 原参与者的 `bid/action`；
- 源战场 battlelog。

动态参战必须新增带领域判断的 Participation 层，队列层只提供“不删除其他归属”的追加原语。

### 2.6 `battle.start` 也存在归属与校验缺口

当前 `battle.start`：

1. 从整条动作链提取显式 PID 和 tile 内实体；
2. 只对第一个目标执行 `combat_can_engage()`；
3. 把所有提取到的 PID 直接加入新队列；
4. 建队时无条件删除这些 PID 的旧队列行。

参考：

- [`combat.core.php:107`](../include/game/combat/combat.core.php#L107)
- [`combat.core.php:275`](../include/game/combat/combat.core.php#L275)
- [`combat.core.php:285`](../include/game/combat/combat.core.php#L285)
- [`battle.queue.func.php:141`](../include/game/battle/battle.queue.func.php#L141)

所以不能只修复 `battle.submit_turn`。初始建战与战中动态加入必须共用同一套 Participation 资格、动作链投影和跨 qid 拒绝规则。

### 2.7 AOE 同样绕过战场成员关系

`grenade` 在技能 execute hook 内查询 tile 上全部 PID并声明伤害：

- [`skill_grenade.php:15`](../gamedata/combat_skills/skill_grenade.php#L15)

底层 `obl_get_pids_in_tile()` 不过滤死亡、阵营、发现状态或战场归属：

- [`player.func.php:121`](../include/game/player.func.php#L121)

effect 系统还能在发现未知 `target_pid` 时临时查库：

- [`combat.effect.php:49`](../include/game/combat/combat.effect.php#L49)

因此动态参战必须覆盖“实际受影响实体”，不能只覆盖显式 enemy PID。

### 2.8 `target='all'` 的当前边界应保留

`all` 当前只枚举 `battle_cache` 中活跃参战者：

- [`combat.target.php:169`](../include/game/combat/combat.target.php#L169)

这是正确语义：`all` 表示当前战场内的全体合法关系目标，不应扫描整个区域并把所有旁观 NPC 自动吸入战场。

动作链顺序应表现为：

```text
攻击外部 A → A 动态参战 → 后续 all 可以命中 A

all → 攻击外部 A
前面的 all 不能提前命中尚未参战的 A
```

### 2.9 当前关键表不能提供真实事务

以下表仍是 MyISAM：

- [`oblplayers.sql:8`](../sql/oblplayers.sql#L8)
- [`oblqueue.sql:14`](../sql/oblqueue.sql#L14)
- [`oblbattle_state.sql:17`](../sql/oblbattle_state.sql#L17)

Command API 已有房间级 MySQL advisory lock：

- [`command.php:65`](../api/command.php#L65)
- [`obl_runtime.php:119`](../include/core/obl_runtime.php#L119)

它只能保证写请求串行，不能在 PHP fatal 或 SQL 中途失败时回滚多表半写。动态参战必须把战斗关键表改为 InnoDB，并在命令级事务中完成参战、效果、队列、状态机和 tick 写入。

### 2.10 CharacterHub 当前仍缺少一致性协议

当前 CharacterHub 接受 `enemies/player_info/combat_context` 三路覆盖：

- [`character.ts:145`](../../vex-vue/src/stores/character.ts#L145)
- [`character.ts:172`](../../vex-vue/src/stores/character.ts#L172)
- [`character.ts:193`](../../vex-vue/src/stores/character.ts#L193)

但存在：

- State API 响应没有统一 revision：[`obl_state_response.php:25`](../include/api/obl_state_response.php#L25)
- 非缓存 scope 的强制刷新可以跳过去重，旧响应可能后到：[`data-manager.ts:53`](../../vex-vue/src/stores/data-manager.ts#L53)
- `mergeEnemies()` 只删除旧区域实体，当前区域内已消失/取消发现的实体会残留：[`character.ts:150`](../../vex-vue/src/stores/character.ts#L150)
- characterStore 与 mapStore 循环依赖：[`character.ts:23`](../../vex-vue/src/stores/character.ts#L23)、[`map.ts:28`](../../vex-vue/src/stores/map.ts#L28)
- CharacterHub 没有 session reset；
- `Boolean('0') === true`，当前 `discovered` 归一化不正确：[`character.ts:81`](../../vex-vue/src/stores/character.ts#L81)

### 2.11 宽松模式与播放恢复的现状

`currentMode` 早进入、晚退出的窗口期合理，见：

- [`DESIGN.md:938`](../DESIGN.md#L938)

但前端实际上已有分散的表现阶段：

- `currentMode`
- `PreloadArea.mode`
- `isPlayingBattleLog`
- `isProcessingBattle`
- `oblBattleState`

空 battlelog 后继续校验的当前代码是正确的：

- [`battle.ts:495`](../../vex-vue/src/stores/battle.ts#L495)

仍有两个恢复缺口：

1. heartbeat 软失败后校验直接返回，daemon 后续不会主动补拉 `player_info/battle_log`；
2. F5 只有 `action==='battle'` 才调用 `refreshBattle()`，后端已退出但仍有未播放日志时不会排空 backlog：[`App.vue:126`](../../vex-vue/src/App.vue#L126)。

---

## 3. 新的领域概念

### 3.1 Character Projection

CharacterHub 的正式定位：

> 以 PID 为 key 的前端角色当前状态统一投影。

它负责：

- 身份、名称、外观；
- HP/AP 和标准角色属性；
- 当前区域与位置；
- 当前 `action/bid/state`。

它不负责：

- 判断某技能是否可用；
- 判断某角色是否可以动态参战；
- 保存 `canSubmitTurn`、战场状态机或 turn token；
- 保存 battlelog 历史 snapshot；
- 替代后端领域真值。

战场 membership 不写回 CharacterHub。地图上的 `inCombat/dimmed/targetable` 由
`CharacterHub character + CombatSession membershipByPid` selector 联合派生，避免同一成员关系同时由两个 Store 持有。

### 3.2 Combat Session

CombatSession 是当前战场规则投影，至少包含：

```ts
interface CombatSessionView {
  mode: 'pre-battle' | 'in-battle';
  sessionKey: string;
  runId: string;
  qid: number | null;
  state: CombatSessionState;
  roundNum: number;
  turnToken: string | null;
  rosterVersion: number;
  stateRevision: number;
  currentActorPid: number | null;
  canSubmitTurn: boolean;
  combatants: CombatantViewModel[];
  targetCandidates: CombatTargetCandidate[];
  suggestedTargetPid: number | null;
}

type CombatSessionState = BattleState | 'PREBATTLE';
```

`pre-battle` 也是正式读模型，不是前端临时拼出的空战场：

- `qid=null`、`turnToken=null`、`rosterVersion=0`、`state='PREBATTLE'`；
- `sessionKey=prebattle:{runId}:{playerPid}`，用于草稿归属，不承担后端战场身份；
- `combatants=[]`，但仍返回完整 `targetCandidates`；
- 进入 active battle 后切换为整场稳定的 `sessionKey=battle:{runId}:{qid}`；回合变化只体现在 `turnToken`。

CombatSession 回答：

- 当前是哪一个 qid；
- 当前轮到谁；
- 哪些角色已经参战；
- 哪些角色可以动态加入；
- 哪些可见角色被阻止以及粗粒度原因。

候选基集固定为：

```text
当前玩家已发现、当前区域内、仍可观察的角色
UNION
当前 qid roster 中允许向该玩家公开的角色
```

后端逐项附加 relation 与 Participation。未发现角色不得因为 `blocked` candidate 泄漏 PID；
`visibility='physical'` 的 AOE 可以在结算时卷入未发现实体，但只能在效果发生后的
`combatant_joined`/roster 事件中向有权限的收件人公开。

它不承诺具体技能一定可提交。

### 3.3 Participation

Participation 表示角色与某个 qid 的成员关系。

分类固定为：

```text
member
  已是当前 qid 的 active 成员，幂等通过

joinable
  没有战斗归属，满足动态参战基础资格

left
  属于当前 qid 但 active=0，已死亡/逃跑/退出，禁止原地复活

other_battle
  属于其他 qid，当前版本拒绝隐式合并

blocked
  死亡、未发现、非敌对、跨区域或数据不一致
```

### 3.4 Aim 与 Impact

必须把“玩家瞄准什么”和“技能实际影响谁”分开。

```text
Aim
  pid / tile / self / none / all

Impact Entities
  技能结算前解析出的实际受影响角色集合
```

示例：

| 技能 | Aim | Impact Entities | Participation 策略 |
|------|-----|-----------------|--------------------|
| unarmed_strike | 单 PID | 该 PID | join_if_unengaged |
| throw | 单 PID | 该 PID | join_if_unengaged |
| whirlwind | all | 当前 qid 内敌对 active 成员 | members_only |
| grenade | tile | tile 内满足 affects 规则的实体 | 配置决定 join_if_unengaged |
| heal | self | actor | no_join |
| move | tile | 无角色 impact | no_join |

### 3.5 Presentation Phase

前端不复制后端领域状态机，但派生以下表现阶段：

```text
explore
prebattle
awaiting_backend
playback
player_input
npc_processing
reconciling
```

表现阶段只决定 UI 和等待行为，不授权命令。后端 Command Bus 仍是安全真值源。

---

## 4. 强制领域不变量

### 4.1 成员一致性

任意角色处于活跃战斗时，必须同时满足：

```text
player.action === 'battle'
player.bid === queue.qid
queue.pid === player.pid
queue.active === 1
battle_state(qid) !== IDLE
```

禁止出现：

- `action='battle'` 但没有队列行；
- active 队列行与 `bid` 不一致；
- 一个 PID 同时属于两个 qid；
- active=0 的角色被普通攻击隐式重新激活；
- 目标已经受效果但尚未建立成员关系。

### 4.2 目标安全

所有会影响角色的技能必须在效果应用前完成：

1. impact entity 解析；
2. 敌对关系判断；
3. 生存/区域/发现规则；
4. 当前 qid 归属分类；
5. 动态参战或明确拒绝。

effect applier 不得再以“查到了 PID”为由绕过 Participation。

AOE 的失败语义固定为：

- 不满足 relation/alive/affects 的实体被过滤，不进入 `impact_entities`；
- 任一实际 impact 属于 `other_battle` 或 membership inconsistent，整个 action 失败；
- 同一 action 的全部 joinable impacts 作为一个 membership batch，全部成功或全部失败；
- 角色型 hostile action 过滤后为空，返回 `NO_VALID_IMPACT`，不扣 AP；
- move、escape、self heal 等 utility action 按 aim/self/none 规则判断，不要求非空角色 impact。

### 4.3 动作顺序

Participation 必须按 action 顺序投影和执行：

```text
Action 1 加入 A
Action 2 的 all 可以看到 A

Action 1 的 all
Action 2 才加入 A
Action 1 不能看到 A
```

### 4.4 失败原子性

动作级业务失败：

- 当前 action 不执行；
- 不扣 AP；
- 不产生成员写入；
- 丢弃该 action 暂存的角色、battle_cache 和 render event 变更；
- 后续 action 可继续。

基础设施或事务失败：

- 整条命令回滚；
- 不推进队列；
- 不推进 tick；
- 不发布本次 render battle events。

### 4.5 前端草稿不是真值

前端 targetCandidates、本地路径和 preview 都只能提供 UX 预判。正式提交必须带 `qid/turnToken/rosterVersion` 期望值，后端重新验证。`stateRevision` 用于识别读模型与 preview 是否过期，不作为所有战斗命令的强制全局冲突门禁。

---

## 5. 后端动态参战设计

### 5.1 新增 Participation 领域层

新增：

```text
oblivions/include/game/combat/combat.participation.php
oblivions/include/game/combat/combat.impact.php
```

建议接口：

```php
combat_relation(array $actor, array $target): string

combat_participation_classify(
    array $actor,
    array $target,
    int $qid,
    array $source
): array

combat_participation_project(
    CombatContext $ctx,
    array $impact_entities
): array

combat_participation_enlist(
    CombatContext $ctx,
    array $join_plan
): array

battle_create_with_members(
    array $actor,
    array $members,
    array $metadata
): array

battle_queue_append_members(
    int $qid,
    array $members
): array
```

`combat_relation()` 集中敌对关系。第一版可定义：

```text
player(type=0) ↔ NPC(type>0) = hostile
```

后续阵营、召唤物、中立角色只扩展这一处，禁止继续在各模块散落 `type>0` 判断。

### 5.2 动态参战资格

对直接 PID 目标，`joinable` 必须同时满足：

- PID 存在且不是 actor；
- `hp > 0 && state == 0`；
- 与 actor 为 hostile；
- 与 actor 同 pgroup；
- `discovered=1`；
- `action` 为空且 `bid=0`；
- 没有任何 queue row；
- 当前 action 的真实射程和规则校验通过。

对空间 AOE：

- 是否要求 `discovered=1` 由技能 `impact.visibility` 配置决定；
- 物理爆炸可以采用 `physical`，允许命中 tile 内未发现但真实存在的 hostile 实体；
- UI 不需要提前展示未发现实体，但事件与后续 CharacterHub 刷新必须能呈现其被卷入战斗的结果。

### 5.3 其他 qid 策略

当前版本明确：

```text
不进行隐式战场合并
目标属于其他 qid → TARGET_IN_OTHER_BATTLE
```

原因：自动合并必须解决两个战场的：

- 当前 actor；
- round、done、myorder；
- next_pid；
- PLAYER_TURN/PROCESSING 状态；
- 多玩家输入权；
- battlelog 时序；
- 解散与历史 inactive 行。

未来若需要合并，必须设计显式 `battle.merge` 领域操作，选择 canonical qid、重建全体顺位、销毁源状态机并发出 `battle_merged`。普通攻击绝不能调用现有 join 抢走其他 qid 成员。

### 5.4 队列追加原语

初始建战与动态追加分别使用：

```text
battle_create_with_members()
battle_queue_append_members()
```

二者都只能消费已验证的 Participation plan，不得调用 `obl_queue_delete_by_pid()` 抢占其他归属。

`battle_create_with_members()`：

- 先创建不可复用的 qid；
- 锁定并复核 actor 与全部初始成员；
- 原子写入 actor/member 的 `action/bid`、初始 queue rows 和 battle state；
- 初始 `roster_version=1`；
- 初始 `turn_version=0`，直到产生第一个新的玩家输入窗口；
- 初始 roster 通过 `round_start`/战斗创建事件表达，不重复发动态 `combatant_joined`。

`battle_queue_append_members()`：

规则：

- 只接受 Participation 已分类为 `joinable` 的角色；
- 若发现 PID 已有任意 queue row，返回 roster conflict；
- `myorder` 从当前最大值后连续追加；
- `done=0`；
- `active=1`；
- 不立即修改 `next_pid`；
- 当前 actor 完成后仍由 `battle_manage_queue()` 选下一顺位；
- 新成员可以在当前 Round 的队尾获得一次行动；
- 不重新发 `round_start`。

同一 action 多人加入时，impact 集合必须稳定排序。空间 AOE 使用 PID 升序；其他多目标先按技能定义顺序，再以 PID 兜底。

### 5.5 CombatContext 扩展

CombatContext 增加：

```php
public array $resolved_aim;
public array $impact_entities;
public array $participation_plan;
public array $joined_combatants;
```

当前 `targets` 同时承担 aim、角色 target 与 effect target，导致 grenade 在 hook/effect 阶段临时查库。新结构要求：

- aim 只描述玩家选择；
- impact_entities 是效果应用前确定的角色集合；
- effects 只能引用 impact_entities 或 actor；
- effect applier 不得按任意 PID 临时扩展角色集合。

### 5.6 技能配置扩展

技能配置增加：

```php
'impact' => [
    'resolver' => 'direct|battle_hostiles|tile_occupants|none',
    'relation' => 'hostile|friendly|any',
    'participation' => 'join_if_unengaged|members_only|no_join',
    'visibility' => 'discovered|physical|ignore',
]
```

示例：

```php
'unarmed_strike' => [
    'target' => 'enemy',
    'impact' => [
        'resolver' => 'direct',
        'relation' => 'hostile',
        'participation' => 'join_if_unengaged',
        'visibility' => 'discovered',
    ],
]

'whirlwind' => [
    'target' => 'all',
    'impact' => [
        'resolver' => 'battle_hostiles',
        'relation' => 'hostile',
        'participation' => 'members_only',
        'visibility' => 'ignore',
    ],
]

'grenade' => [
    'target' => 'tiles',
    'impact' => [
        'resolver' => 'tile_occupants',
        'relation' => 'hostile',
        'participation' => 'join_if_unengaged',
        'visibility' => 'physical',
    ],
]
```

### 5.7 新管道顺序

攻击/工具技能统一经过明确阶段：

```text
resolve_aim
→ expand_impacts
→ check_aim_rules
→ check_impact_rules
→ prepare_effects
→ resolve_participation
→ action_start
→ snapshot
→ apply_effects
→ react
→ post_check
→ persist_action
```

边界要求：

- `expand_impacts` 是纯解析，不写 DB；
- `check_aim_rules` 校验 PID/tile/self/none 的目标形状、可达性、射程与技能 aim 约束；
- `check_impact_rules` 逐实体校验 relation/alive/affects/visibility，并按 AOE 规则过滤或使整个 action 失败；
- `prepare_effects` 调用纯声明 skill hook，不产生 DB 或世界副作用；
- `resolve_participation` 在 dry-run 和真实执行中都只生成 plan/UnitOfWork，不立即写 DB；
- `apply_effects` 只修改 action-scoped 内存副本；
- `persist_action` 在 action 成功后一次性 flush Participation、角色状态、battle_cache、AP、队列状态和 outbox events；
- skill hook 不查询新的任意角色，所有 effect target 必须来自 `impact_entities`；
- move 当前在 execute 中有位置副作用，必须迁移为 staged effect，确保 action 失败时位置也能恢复；
- 角色型 hostile action 只在至少一个 impact 合法且 Participation 成功后发出 `action_start`；
- 无角色 impact 的 utility action 在其 aim/self/none 规则和 effect declaration 成功后同样可以发出 `action_start`。

`action_start/combatant_joined/effect_applied/combatant_cleared` 在 action 完成前都只是暂存事件；只有 `persist_action` 成功后才进入命令事务的 outbox buffer。

### 5.8 动作链计划与执行

`combat_chain_project()` 扩展为返回：

```php
[
    'verified_actions' => [],
    'actions' => [
        [
            'success' => true,
            'reason' => null,
            'ap_cost' => 1,
            'impact_pids' => [12],
            'participation' => [
                ['pid' => 12, 'state' => 'joinable']
            ],
        ]
    ],
    'battle_cache' => [],
]
```

每个 action 的顺序：

1. 先检查 actor 是否死亡/逃跑；
2. 解析该 action 的 aim 与 impacts；
3. 检查规则、AP、技能拥有与 CD；
4. 纯声明并验证 effects；
5. 投影该 action 的 Participation；
6. 把新成员写入 action-scoped sim battle_cache；
7. 投影 effects；
8. action 成功后提交 sim state；失败则恢复 action checkpoint；
9. 进入下一 action。

真实执行必须建立 action-scoped UnitOfWork/checkpoint，至少暂存：

```text
actor_data
target/impact entity data
battle_cache
Participation mutations
queue mutations
AP/CD mutations
render events
```

业务失败时恢复 PHP 内存 checkpoint 并丢弃事件；不能只依赖 SQL SAVEPOINT，因为 `battle_cache`、数组引用和 collector 状态同样需要回滚。外层命令事务只负责基础设施失败时回滚整条命令。

当前 `combat_actor_terminated()` 把“actor 已死亡”和“当前存活成员数 <=1”混在一起。动态参战后必须拆分：

```php
combat_actor_unavailable(...)
combat_battle_has_opposition(...)
```

如果前一 action 刚清除最后一个旧敌人，而下一 action 明确攻击一个 joinable 新敌人，则必须先投影该 action 的 Participation，再判断战斗是否有对手，不能在解析新目标前提前中断动作链。

### 5.9 `battle.start` 新流程

```text
normalize actions
→ server-owned chain plan
→ 在 provisional pre-battle context 逐项执行合法 utility actions
→ 到达第一项 executable hostile action 的 action 原子边界
→ 无副作用完成 aim/impact/effect declaration/Participation 验证
→ 基于首击前角色快照生成 pending initial roster 与 initiative
→ 在 pending-battle UnitOfWork 中完成内存 effects/react/post_check
→ post_check 成功后进入 persist_action
→ INSERT battle identity 取得 AUTO_INCREMENT qid
→ 用预先计算的 initiative 与 qid 一次写入初始 roster/effects/AP/queue/events
→ 执行后续 verified action chain
→ 后续 action 按顺序动态追加新成员
→ cleanup + battle_manage_queue
```

要求：

- 不再从整条原始动作链预先提取所有 PID建队；
- 不再只校验第一个 PID；
- 不能删除其他 qid 的队列行；
- 没有成功 hostile action 时返回 `NO_VALID_HOSTILE_ACTION`，外层事务回滚前置 utility，不得创建单人战场；
- 位于第一项 hostile action 之前的 utility action 在 provisional context 中按顺序执行，但整个命令仍处于同一事务；若后续初始建战失败，这些 utility 变更一并回滚；
- provisional utility 的 render events 先留在命令 buffer；首个 hostile action 成功分配 qid 后，才以该 qid 的 prebattle segment 排在 `round_start` 之前写入 outbox；若最终没有 qid，全部丢弃；
- `round_start` 必须发生在第一项 hostile action 建立初始 roster 之后，并承担初始 roster 展示；`combatant_joined` 只表示战场建立后的新增成员；
- initial roster/initiative 必须来自首击效果前 snapshot；即使首击同 action 杀死目标，事件仍按 `round_start → action_start/effect → combatant_cleared` 表达，最终 queue row 为 inactive；
- hostile action 之前不得使用依赖现有 roster 的 `target='all'`；这类 action 在 plan 中按 `NO_BATTLE_ROSTER` 失败。
- 初始 qid、成员关系、`round_start/action_start` 都只是首个 hostile action 的 UnitOfWork 内容；该 action 任一业务校验失败时全部丢弃。

事件身份不能继续依赖当前 [`combat.log.php`](../include/game/combat/combat.log.php#L33) 中内嵌 qid 的 action UID。
新 `action_uid={run_id}:{command_id}:{action_index}` 在进入 chain 时即可确定，与 qid 解耦；persist 时只为 event/queue/battle state 晚绑定新 qid。

### 5.10 `battle.submit_turn` 新流程

```text
Command Gate 校验 qid/state/current actor/turnToken/rosterVersion
→ 从后端 DB 构造权威 battle_cache
→ server-owned chain plan
→ 逐 action 执行
   → 同 qid member: 幂等
   → joinable: 原子加入并写当前 battle_cache
   → left/other_battle/blocked: 当前 action 失败
→ cleanup
→ battle_manage_queue
→ transaction commit
```

如果正式重校验后没有任何 executable action，返回命令级 `NO_EXECUTABLE_ACTION`：不标记 actor done、不调用 `battle_manage_queue()`、不推进 turn/tick。提交一个全部失败的动作列表不能被用来无动作消耗回合。

### 5.11 动态加入后的生命周期

加入操作必须同时完成：

```text
target.action = 'battle'
target.bid = qid
INSERT queue(active=1, done=0, myorder=tail)
battle_cache.combatants[target.pid] = 1
roster_version++
emit combatant_joined
```

以上内容先进入 action UnitOfWork；只有 action 成功到达 `persist_action` 才写 DB/outbox。

同一 action 内被击杀：

```text
combatant_joined
→ effect_applied(damage)
→ combatant_cleared(dead)
→ queue.active=0
→ target.action=''
→ target.state=1
```

逃跑：

- active=0；
- action=''；
- bid 保留到 disband；
- 当前 qid 内不得重新加入；
- roster_version++。

`roster_version` 以**一次 action 的 roster mutation batch**为递增单位：

- 初始建战版本为 1；
- 一个 AOE 同时加入三人，只递增一次；
- 同一 action 加入后又清除该成员，仍只递增一次；
- 一次 action 只清除多个旧成员，也只递增一次；
- 该 action 的 joined/cleared 事件携带同一个最终 rosterVersion。

`turn_version` 在每个新的玩家输入窗口创建时递增，即使下一轮仍是同一个玩家 PID；重复 heartbeat/recovery 识别到同一输入窗口时不得再次递增。

qid 必须是不可复用的持久战场身份。禁止继续使用当前
[`obl_queue_next_qid()`](../include/game/sql.func.php#L186) 的 `MAX(oblqueue.qid)+1`：队列解散后该算法会复用旧 qid。
首个 hostile action 必须通过持久 battle identity/`oblbattle_state` 的 `AUTO_INCREMENT` 分配 qid；战斗结束只标记 `ENDED` 并保留身份行，不能删除后重新使用编号。
跨一局游戏的完整身份为 `(run_id, qid)`，turn token、event 唯一键和客户端 session identity 都必须包含 `run_id` 语义。

### 5.12 事务边界

最低要求：

- `oblplayers` 改为 InnoDB；
- `oblqueue` 改为 InnoDB；
- `oblbattle_state` 改为 InnoDB；
- `oblgame` 保持 InnoDB。

Command API：

```text
acquire room GET_LOCK
→ BEGIN
→ 非锁定读取 actor 仅用于定位 qid
→ active battle: 锁定 battle state row → queue roster → actor → candidate PID 升序
→ battle.start: 锁定 actor → candidate PID 升序；qid 在首个 hostile persist_action 时 INSERT 分配
→ 重新校验 expected 与 Participation
→ dispatch
→ participation/effects/queue/state/tick writes
→ write battle event outbox
→ COMMIT
→ release room lock
```

Heartbeat/NPC turn 使用同一事务协调器：

```text
acquire room GET_LOCK
→ BEGIN
→ reload tick/domain state
→ 只读识别 pending qid/actor
→ 按 battle state、queue、actor、candidate 的固定顺序加锁
→ resolve pending battle / NPC action / recovery
→ participation/effects/queue/state/domain_revision writes
→ write battle event outbox
→ COMMIT
→ release room lock
```

异常时必须 `ROLLBACK`，不推进 tick/domain revision，也不发布事件。当前
[`heartbeat.php`](../api/heartbeat.php#L44) 只有 advisory lock，且在事务外执行 NPC turn 与文件日志持久化；改造不能只覆盖 Command API。

固定锁顺序：

```text
qid/battle state
→ queue roster
→ actor PID
→ candidate PID 升序
```

房间 GET_LOCK 保留为主入口串行化；InnoDB 行锁与固定顺序负责防御未来未经过同一 advisory lock 的写路径和降低死锁风险。

异常：

```text
ROLLBACK
→ discard request-local render events
→ release room lock
→ INTERNAL_ERROR / BATTLE_TRANSACTION_FAILED
```

当前 Command Bus/heartbeat 在数据库状态提交边界外持久化文件日志：

- [`obl_command_bus.php:92`](../include/command/obl_command_bus.php#L92)

事务化后不得在 commit 前发布文件 battlelog。

### 5.13 Battle Event Outbox

为保证“数据库状态已提交”和“combatant_joined 可播放”一致，battlelog.v2 迁移为 InnoDB 事件 outbox。

建议表：

```text
oblbattle_event
  event_id
  run_id
  qid
  event_seq
  event_type
  event_json
  created_at

oblbattle_event_delivery
  event_id
  recipient_pid
  played_at
```

约束：

- `PRIMARY KEY(event_id)`；
- `event_id` 使用 `bigint unsigned AUTO_INCREMENT`；
- `UNIQUE(run_id, qid, event_seq)`；
- delivery `PRIMARY KEY(event_id, recipient_pid)`；
- delivery 增加 `(recipient_pid, played_at, event_id)` 未播放查询索引；
- battle state row 保存 `last_event_seq`，事务内锁行并递增；
- 同一 action 的事件按稳定 impact PID 顺序写入；`event_seq` 在锁定 battle state 后逐事件单调分配；
- 普通 action recipient 固定为“action 开始时有观察权的玩家 ∪ actor/受影响/被清除的玩家 ∪ action 后 active 玩家”；
- `battle_end` recipient 包含该 qid 全部有观察权的历史玩家参与者，死亡或刚退出不能导致其收不到结算事件；
- mark played 只能按认证 PID 幂等更新自己的 delivery；
- action UnitOfWork 被丢弃或事务回滚时，暂存事件不能进入 outbox。

`event_id/event_seq` 在 JSON API 中统一序列化为十进制字符串，前端把 event ID/cursor 视为 opaque string，不转成 JavaScript number；服务端 SQL 排序仍使用 bigint。

命令/heartbeat 事务同时写领域状态与事件。`battle_log` State API 按 `event_id` 分页查询当前认证玩家未播放 delivery；新 mark API：

```text
POST /oblivions/api/battle-events/ack
body: { eventIds: [...] }
```

- 必须通过 Oblivions runtime 完成登录认证，PID 从会话取得，禁止客户端提交 groomid/pid 选择收件人；
- 单次 eventIds 去重并限制数量；
- 只更新 `recipient_pid=authenticated_pid` 的 delivery；
- 重复 ack 幂等返回已确认数量；
- 在短事务中批量写 `played_at`。

当前零依赖 [`mark_battle_log_played.php`](../mark_battle_log_played.php#L1) 必须移除或改造成上述认证端点，前端
[`markBattleLogPlayed()`](../../vex-vue/src/api/client.ts#L178) 同步改为只发送 event IDs。

事件文件可在迁移后删除，不再承担权威持久化。这样不会出现：

- DB 已 commit，但 PHP 在写 JSON 前崩溃；
- JSON 已写，DB 随后失败回滚；
- mark 失败后客户端无法确认事件归属。

### 5.14 `combatant_joined` 事件

新增正式 battlelog.v2 event type：

```json
{
  "schema": "battlelog.v2",
  "event_type": "combatant_joined",
  "qid": 12,
  "payload": {
    "combatant": {},
    "source": {
      "kind": "direct|area",
      "actor_pid": 1,
      "action_uid": "action-uid"
    },
    "queue": {
      "myorder": 5,
      "done": 0,
      "round_num": 2
    },
    "roster_version": 7
  }
}
```

顺序：

```text
combatant_joined
→ action_start/effect_applied
→ optional combatant_cleared
```

同 qid 已有 member 不重复发 joined。

一个 action 的 roster mutation batch 只递增一次 `rosterVersion`。同批多个 joined/cleared 事件按稳定 PID 顺序发出并共享该 batch 的最终 `rosterVersion`；
`event_seq` 负责表达批内严格顺序，不能把 `rosterVersion` 当事件序号。

前端同步修改：

- BattleLogV2EventType union；
- DirectorV2 join 分支；
- PlaybackPlan；
- fixture；
- 文本 cue 与 actor 准备步骤。

第一版表现可以是正式 notice + actor 高亮，但必须通过 `combatant_joined` 语义事件进入 Director，不得用无结构普通文案替代。

---

## 6. Combat ViewModel 与 API 契约

### 6.1 `validTargets` 重命名与扩展

当前 `validTargets` 应废弃，替换为：

```ts
type ParticipationState = 'member' | 'joinable' | 'left' | 'other_battle' | 'blocked';

interface CombatTargetCandidate {
  pid: number;
  membership: ParticipationState;
  blockReason: string | null;
  relation: 'hostile' | 'friendly' | 'neutral';
}
```

`targetCandidates` 是粗粒度战场候选，不宣称某个具体技能一定合法。

生成规则由后端拥有：pre-battle 使用“当前玩家已发现且当前区域可观察角色”；in-battle 使用该集合与当前 qid 可公开 roster 的并集，再逐 PID 分类 Participation。
`blocked` 仅用于解释玩家本来就有权观察的角色，不能暴露未发现 PID；`other_battle` 只返回粗粒度原因，不向客户端公开对方 qid。

角色名称、位置、HP 和渲染属性由同一个 `combat_workspace` bundle 中的 Character 记录提供。candidate 不携带第二份 fallback 角色快照。

### 6.2 Combat ViewModel 新字段

```json
{
  "mode": "in-battle",
  "sessionKey": "battle:run-7:12",
  "runId": "run-7",
  "qid": 12,
  "state": "PLAYER_TURN",
  "roundNum": 2,
  "turnToken": "run-7:12:9",
  "rosterVersion": 7,
  "stateRevision": 1042,
  "currentActorPid": 1,
  "canSubmitTurn": true,
  "combatants": [],
  "targetCandidates": [],
  "suggestedTargetPid": 8
}
```

`suggestedTargetPid` 仅用于视觉预选，永远不能自动写入动作。

pre-battle 响应使用同一结构，但 `qid/turnToken=null`、`state='PREBATTLE'`、`rosterVersion=0`；因此从 StatusBar 打开预战斗工作区后即可取得全部候选，而不是只保留触发入口时点击的单个 PID。

获取入口固定为：

```text
GET /oblivions/api/state.php?scope=combat_workspace
```

该 scope 无论玩家是否已参战都返回 `{ combatSession, characters }`，并在一个 consistent snapshot 中包含 roster/candidate 所需的最小完整 Character 记录。
StatusBar 的 `startBattle(0|suggestedPid)` 只负责先打开 `loading` 工作区并触发该请求；请求成功且 ingestion 原子发布后才启用技能与 Aim，失败则保留可重试错误态。入口 PID 只能成为 suggested focus，不能缩窄候选集合。

### 6.3 turn token 与 optimistic gate

`oblbattle_state` 增加：

```text
turn_version
roster_version
```

- current actor 切换到新的输入窗口时 `turn_version++`；
- member join/leave 时 `roster_version++`；
- `turnToken` 由 run_id + qid + turn_version 生成。

`battle.submit_turn` 的 expected 至少包含：

```json
{
  "pid": 1,
  "run_id": "run-7",
  "action": "battle",
  "bid": 12,
  "battle_state": "PLAYER_TURN",
  "turn_token": "run-7:12:9",
  "roster_version": 7
}
```

以上战场身份不一致时返回 `STATE_CONFLICT`，前端把旧草稿隔离为只读 quarantined draft、重新 reconcile 并展示目标/回合已变化；不得把它自动迁移到新 turn。`stateRevision` 可以随请求携带作为诊断与 preview freshness 信息；目标位置、HP 等易变字段由正式执行重新读取和校验，不因无关 scope revision 变化直接拒绝整条命令。

### 6.4 State API revision

所有 State API success response 增加：

```json
{
  "status": "success",
  "meta": {
    "runId": "run-7",
    "stateRevision": 1042,
    "tick": 30,
    "scope": "enemies"
  },
  "data": {}
}
```

新增独立 `oblgame.domain_revision` 作为 `stateRevision`，仅在领域数据成功提交时递增。不得直接复用当前
[`tick_version`](../include/core/obl_game_repository.php#L240)：无状态变化的 heartbeat 仍会经
[`obl_game_note_heartbeat()`](../include/core/obl_game_repository.php#L271) 调用 `obl_game_save()`，从而每秒递增该字段。
`heartbeat_at/updated_at/last_command_at` 等运维写入不推进 `domain_revision`；同一 command/heartbeat 事务内的所有领域变更只推进一次。

每个 State API response 必须在一致读快照中组装：

```text
SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;
→ START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY;
→ 读取 player/queue/battle state/characters/event inbox
→ 在同一快照读取 run_id + domain_revision
→ COMMIT
```

当前 [`state.php`](../api/state.php#L44) 不取房间锁且 handler 由多次独立 SELECT 组成；没有一致快照时，一个 revision 不能证明 payload 自洽。

CombatSession 与它引用的 Character 是强耦合数据，必须通过 `combat_workspace` bundle 同 revision 发布，不能由顺序调用的 `player_info/combat_context/enemies` 拼接。
其他 scope 可以有不同 revision，并按字段所有权独立合并；若 bundle 内部 revision 不一致则整包拒绝并重拉，继续保留上一份已发布 workspace snapshot。

前端合并规则：

- revision 小于记录已应用 revision：拒绝；
- revision 相等：允许不同 scope 的互补字段合并；
- revision 更大：按字段所有权应用；
- session/run id 变化：清空全部投影。

### 6.5 权威 preview

废弃由客户端传入 `battle_cache` 的可信语义。统一为服务端构造上下文：

```text
combat.preview_plan
```

请求：

```json
{
  "mode": "pre-battle|in-battle",
  "sessionKey": "prebattle:run-7:1",
  "qid": null,
  "turnToken": null,
  "rosterVersion": 0,
  "draftRevision": 4,
  "actions": []
}
```

后端：

- 根据认证玩家和 qid 构造 actor/battle_cache；
- 按正式 chain projector 运行；
- 不信任客户端 roster；
- pre-battle 模式要求 `qid/turnToken=null`，允许 `action=''`，并从认证玩家和当前区域构造 provisional targeting context；
- in-battle 模式要求当前 qid/turnToken。

响应：

```json
{
  "planRevision": "run-7:prebattle:1042:4",
  "stateRevision": 1042,
  "turnToken": null,
  "rosterVersion": 0,
  "draftRevision": 4,
  "submittable": true,
  "actions": [
    {
      "index": 0,
      "pass": true,
      "reason": null,
      "apCost": 1,
      "impactPids": [8],
      "participation": [
        { "pid": 8, "state": "will_join" }
      ]
    }
  ],
  "totalApCost": 1,
  "actorFinalState": {},
  "plannedRosterVersion": 1
}
```

preview 是 UX 权威，但正式提交仍重复执行同一语义。

响应中每项 action 都必须给出确定性失败级别：

- `blocking`：当前 plan 不可提交，例如没有 executable hostile action、战场身份冲突；
- `skippable`：按正式链语义该 action 会失败但后续 action 可继续；
- `warning`：可提交但将产生 join/范围变化等需要提示的结果。

`submittable` 是计划级唯一执行判断。AP cost、预计位置、impact、will_join 等展示在 preview 返回后全部以服务端 plan 为准；客户端估算只允许在 preview pending 前作占位反馈。

### 6.6 失败码

动作级：

```text
TARGET_NOT_FOUND
TARGET_DEAD
TARGET_NOT_DISCOVERED
TARGET_NOT_HOSTILE
TARGET_CROSS_REGION
TARGET_LEFT_BATTLE
TARGET_IN_OTHER_BATTLE
TARGET_MEMBERSHIP_INCONSISTENT
TARGET_OUT_OF_RANGE
```

基础设施级：

```text
BATTLE_ROSTER_CONFLICT
BATTLE_ROSTER_WRITE_FAILED
BATTLE_TRANSACTION_FAILED
```

`combat_dispatch()` 统一返回：

```php
[
    'ok' => true,
    'actions' => [],
    'joinedCombatants' => [],
    'queueResult' => [],
]
```

命令成功不代表每个 action 成功；前端依赖 battlelog/response action result 展示具体失败。

---

## 7. 前端设计

### 7.1 Store 边界

#### CharacterHub

负责角色当前状态：

```text
characters[pid]
aliveCharacters
```

CharacterHub 不自行判断当前地图可见性。`MapEntityProjectionStore` 使用
`visibleCharacters(region, visibilityRevision)` 联合当前 region、discovered/state/pgroup 与 CharacterHub 派生地图实体。

#### CombatSessionStore

唯一持有：

```text
mode/sessionKey/runId/qid/state/roundNum/turnToken/rosterVersion/stateRevision
currentActorPid/canSubmitTurn
combatantPids
membershipByPid
targetCandidates
suggestedTargetPid
```

移除 `playerStore/battleStore/PreloadArea` 三份 combatContext 副本。

`battle:preload-init` 不再携带 combatContext/enemyPid 快照，也不触发清 queue；它最多只表达“打开/聚焦工作区”。PreloadArea 响应式读取 CombatSessionStore 与 CombatDraftStore。

#### CombatDraftStore

唯一持有跨组件生命周期的装填草稿：

```text
draftIdentity(sessionKey + turnToken|null)
draftRevision
actions
previewStatus/result/requestRevision
submitPending
```

草稿不能留在 PreloadArea 局部状态：`BattleActionBar` 在 PROCESSING/reconcile 时可能卸载组件，局部 queue 无法满足刷新和 `STATE_CONFLICT` 后保留语义。

#### TargetingSession

只在装填期间持有：

```text
pendingActId
targetingRequestId
sessionKey
turnToken
targetMode
originPls
focusedTargetPid
candidatePids
```

TargetingSession 只管理一次“为某个 action 选择目标”的短生命周期交互。选择/取消结果必须匹配
`targetingRequestId + sessionKey + turnToken`；技能切换、重新打开 Aim、qid/turnToken 变化时旧结果作废并自动取消。

#### BattlePlayback

继续只处理 battlelog snapshot/event，不回写 CharacterHub 历史状态。

### 7.2 enemy 技能统一进入自由瞄准

删除当前逻辑：

```ts
if (enemyPid.value > 0) {
  addToQueue(... enemyPid)
} else {
  enterAimMode(...)
}
```

改为：

```ts
if (skill.target === 'enemy') {
  enterAimMode(actId, 'enemy', {
    focusedTargetPid: combatSession.suggestedTargetPid,
  });
}
```

规则：

- pre-battle 与 in-battle 使用相同选目标交互；
- `suggestedTargetPid` 只预高亮；
- 玩家必须显式确认目标；
- 每个 QueueItem 保存自己的 PID；
- 一条动作链可依次选择 A、B、C；
- 可提供显式“重复上一个目标”命令，但不能隐式自动入队。

### 7.3 候选 selector

```ts
const visibleCharacters = mapEntityProjection.visibleCharacters(
  mapSession.currentRegion,
  mapSession.visibilityRevision,
);

const targetableCharacters = combatSession.targetCandidates
  .filter(candidate =>
    candidate.relation === 'hostile'
    && (candidate.membership === 'member' || candidate.membership === 'joinable')
  )
  .map(candidate => ({ candidate, character: characterStore.getCharacter(candidate.pid)! }));
```

AimMode 不再自行从 `enemyList` 推导后端 Participation，也不在 context 有值时回退到任意 CharacterHub 角色。

同一 revision 的 CombatSession 与 CharacterHub 由 ingestion coordinator 从 `combat_workspace` bundle 原子发布；candidate 缺少对应 Character 时视为协议不完整，拒绝整包并保留上一版，不发布半成品 selector。
`suggestedTargetPid` 不在当前 member/joinable 集合时直接忽略。

上例是 enemy selector；friendly/self/any 技能必须由 CombatSession 提供对应 target-kind/relation 的 coarse selector，不能复用 hostile 过滤。

具体技能还要叠加：

- 本地 planned origin 路径/射程，提供即时反馈；
- server preview result，决定队列是否合法；
- 后端 submit 最终校验。

### 7.4 瞄准锚点迁移到角色实体

MapGrid 的敌人 entity 增加：

```html
<div
  class="entity entity-enemy"
  data-character-pid="..."
  data-entity-id="enemy-..."
>
```

AimMode：

- enemy target 查询 `[data-character-pid]`；
- aim 激活期间，仅候选 enemy entity `pointer-events:auto`；
- tile target 继续查询 `[data-pls]`；
- entity 移动后瞄准线跟随实时 DOM 位置；
- 目标失效、死亡、移出区域或 revision 变化时取消可选状态。

实时跟随不能只依赖 `mousemove`：Aim 激活且存在 hover/keyboard focus 时，用短生命周期 rAF 或角色动画 position callback 每帧重算实体中心；Aim 关闭立即取消。
候选、CharacterHub 或 entity DOM 变化时通过 reactive watch + `nextTick` 重建命中标记，不保留失效 DOM 引用。

同格多个 NPC：

- 每个实体都是独立候选；
- 点击任一重叠 entity 后，按其 `pls` 从 `targetableCharacters` 收集该 tile 的全部候选，弹出显示 name/HP/membership 的紧凑菜单；菜单返回明确 PID；
- 键盘焦点可在该 tile 候选间循环，不能依赖浏览器只命中最上层 entity；
- 不再依赖 cell 中单个 `data-enemy-pid`。

地图视觉状态仍区分 membership：joinable 可以保持 dimmed，但 Aim 激活时必须叠加 entity 级可选轮廓/亮度；blocked 保持不可选。只有 reconcile 确认 joined 后才移除 dimmed，不能因 hover 伪装成已参战。

### 7.5 草稿生命周期

当前每次 `battle:preload-init` 都清空 queue。改为由 CombatDraftStore 以 draft identity 管理：

```text
same sessionKey + same turnToken
  → 更新 context/candidates，不清草稿

turnToken 变化
  → 正常推进到新回合时，清当前草稿

sessionKey/qid 变化
  → 新战场，清草稿

submit 成功
  → 清草稿

submit STATE_CONFLICT
  → 把旧 identity 草稿移入 quarantinedDraft，只读保留
  → reconcile 新 session/turn，不把旧动作自动挂到新回合
  → 用户显式丢弃，或逐项 rebase 后生成新的 draftRevision
```

因此“新 turn 清草稿”只作用于可编辑 current draft；`quarantinedDraft` 保留其原始 sessionKey/turnToken 供用户检查，不能绕过新回合重新 preview 和确认。

### 7.6 Preview 状态

动作队列变化后 debounce 调用 `combat.preview_plan`。

状态：

```text
idle
pending
valid
invalid
stale
```

要求：

- 每个请求带本地递增 request revision；
- 只接收最后一次请求结果；
- preview pending/stale 时禁用 Execute；
- action 失败在对应队列项显示 reason；
- draftRevision/sessionKey/turnToken/rosterVersion 或相关 actor/target revision 变化后旧 preview 立即 stale；
- 全局 stateRevision 变化触发自动重新 preview，不把无关 scope 变化永久当成硬门禁；
- Execute 条件固定为 `preview.submittable && commandQueue.canExecute(mode === 'pre-battle' ? 'battle.start' : 'battle.submit_turn') && presentationPhase允许编辑 && !submitPending`；
- 双击 Execute 只允许一个命令请求。

preview 返回后的 AP cost、最终位置、impact 与 will_join 均替换本地 `queueCost/estimateActionCost` 作为主反馈；
`skippable` action 显示逐项失败但可由 plan 允许提交，只有 `submittable=false` 才禁用整个 Execute。

### 7.7 `currentEnemyPid` 降级

`currentEnemyPid` 不再作为：

- 战场身份；
- 是否为同一场战斗的判断；
- PreloadArea 自动目标；
- BattleHeader 的唯一敌人。

战场身份改用 qid。需要焦点时使用：

```text
focusedTargetPid
suggestedTargetPid
```

它们均为 UI 状态，不参与安全判断。

### 7.8 BattleHeader 多目标化

当前标题可能把 battlelog 中某敌人的名称与 `currentEnemyPid` 对应的另一角色位置拼在一起。

改为战场摘要：

```text
Round 3 · 敌方 4 · 当前：玩家回合
```

瞄准中的角色名称、位置、membership 单独显示在 TargetingSession 区域。播放中的 actor/target 继续从 battlelog segment snapshot 读取。

### 7.9 播放层移除单 NPC 兜底

需要逐步移除：

- 从 script 提取第一个 NPC 作为整段兜底；
- DamageNumber 的单 `npcPid` fallback；
- enemyName 全局单值。

所有 effect/animation 应优先按事件中的 target PID 找 actor。找不到时由 playback preparation 等待 CharacterHub/entity 挂载，或使用事件 snapshot 文本降级，而不是退回“当前唯一敌人”。

### 7.10 CharacterHub 一致性改造

新增 ingestion coordinator：

```ts
ingestCharacters({
  source: 'enemies' | 'player_info' | 'combat_workspace',
  stateRevision,
  region,
  payload,
});
```

要求：

- characterStore 不再读取 mapStore；
- mapStore 不再承担 CharacterHub 隐式写入；
- enemies 是当前可见 NPC 的权威集合快照，缺失 NPC生成 tombstone/删除；
- combat_workspace bundle 必须带齐 roster/candidate 引用的 Character，缺失时整包拒绝；
- 每条记录保存已应用 revision；
- 修正 discovered 数值归一化；
- 增加 reset(runId/playerId)；
- session/runId 变化时清空全部角色。

CombatSession membership 不作为 CharacterHub 字段 ingestion；同一 reconciliation revision 先在 staging area 合并 CharacterHub 与 CombatSession，完成后一次 publish，防止 candidate 与角色记录到达顺序造成闪烁。

### 7.11 宽松表现模式

将 `currentMode` 重命名为 `combatWorkspaceOpen` 或 `presentationMode`。

派生 phase 示例：

```ts
if (!workspaceOpen) return 'explore';
if (isPlayingBattleLog) return 'playback';
if (isSyncing) return 'reconciling';
if (!backendActionBattle) return 'prebattle';
if (battleState === 'PROCESSING') return 'npc_processing';
if (canSubmitTurn) return 'player_input';
return 'awaiting_backend';
```

commandQueue 的 mode lock 继续作为 UX 门禁；后端 action/qid/state/turnToken 继续作为安全权威。

取消语义必须保持三种不同操作：

- Aim 中按 ESC：只取消当前 TargetingSession，不删除已装填草稿；
- pre-battle 点击取消：关闭本地工作区，清 prebattle draft，不发送“退出战斗”命令；
- in-battle 点击取消：只清当前 turn draft，不能退出后端战斗。

`reconciling/playback/npc_processing/submitPending` 阶段禁用选目标和草稿编辑；阶段切换导致 session/turn identity 改变时必须取消仍打开的 Aim。

### 7.12 Reconciliation 与 backlog

建立单一 reconciliation task：

```text
heartbeat
→ state scopes by changedScopes
→ player_info / CombatSession
→ CharacterHub
→ battle event inbox
→ publish sync result and set isSyncing=false
→ playback（独立子阶段）
→ backend verify
```

要求：

- 所有触发源调用同一个 coordinator；运行中请求合并 `changedScopes`，设置 dirty/rerun，当前轮结束后至少再跑一次，不能因 `isProcessing` 直接丢掉末次更新；
- `isSyncing` 只覆盖 fetch/consistent ingest/publish；进入播放器前必须释放，playback 有更高 phase 优先级；
- heartbeat 软失败使用有上限退避自动重试；
- daemon 成功后真正刷新 `player_info/battle_log`，不只 invalidate；
- 启动时独立检查未播放 battle events，不受 `action==='battle'` 门控；
- battle event inbox 按 event_id 分页 drain 到空，再开始或续接 playback；
- 播放完后再读取 player_info 决定工作区退出；
- mark played 失败保留 `displayed-but-unacked` event IDs 并重试；同一前端会话不得因 ack 失败重复播放；
- 退出工作区要求 backend 已非 battle、无未播放/待播放事件且无正在播放步骤；ack 可后台重试，但不能触发重复演出；
- 空事件列表只进入 verify，不合成战斗结束。

---

## 8. 关键时序

### 8.1 战中攻击旁观 NPC

```text
玩家点击 enemy 技能
→ TargetingSession 打开
→ CombatSession targetCandidates 标记 B=joinable
→ 玩家选择 B
→ queue 加入 action(target=B)
→ preview_plan 返回 will_join
→ 玩家提交 battle.submit_turn(expected turnToken/rosterVersion)
→ 后端逐 action 解析 B
→ Participation classify=joinable
→ transaction 内写 action/bid/queue/cache/rosterVersion
→ 写 combatant_joined outbox event
→ 应用伤害并推进队列
→ commit
→ 前端 reconcile player_info/enemies/battle events
→ B 从半透明切为参战状态
→ Director 先播放加入，再播放伤害
```

### 8.2 动作链跨多个目标

```text
Action 1: attack A（member）
Action 2: attack B（joinable）
Action 3: all

project:
  A 已在 cache
  B 在 Action 2 投影加入 cache
  Action 3 枚举 A + B

execute:
  Action 1 正常
  Action 2 原子加入 B 后攻击
  Action 3 命中当前仍 active 的 A + B
```

### 8.3 其他 qid 目标

```text
玩家选择 C
→ targetCandidates: other_battle/blocked
→ UI 可见但不可选

若客户端伪造提交：
→ Participation classify=other_battle
→ 当前 action TARGET_IN_OTHER_BATTLE
→ 不扣 AP、不写当前队列、不修改源 qid
→ 后续 action 可继续
```

### 8.4 F5 时后端已经结束但仍有事件 backlog

```text
App mounted
→ load player_info + CharacterHub
→ 无论 action 是否 battle，都检查 battle event inbox
→ 有 backlog：打开战斗工作区进入 playback
→ 播放并 mark
→ reconcile player_info
→ action != battle
→ 退出工作区
```

---

## 9. 数据库变更

### 9.1 引擎

```text
oblplayers       MyISAM → InnoDB
oblqueue         MyISAM → InnoDB
oblbattle_state  MyISAM → InnoDB
oblgame          保持 InnoDB
```

### 9.2 `oblbattle_state`

改为持久 battle identity 表。保留现有 `state/next_pid/round_num/updated_at`，核心 schema 变更为：

```sql
qid int unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
run_id varchar(64) NOT NULL,
lifecycle varchar(16) NOT NULL DEFAULT 'ACTIVE',
state varchar(20) NOT NULL DEFAULT 'PROCESSING',
next_pid int unsigned NOT NULL DEFAULT 0,
round_num int unsigned NOT NULL DEFAULT 0,
turn_version int unsigned NOT NULL DEFAULT 0,
roster_version int unsigned NOT NULL DEFAULT 0,
last_event_seq bigint unsigned NOT NULL DEFAULT 0,
updated_at int unsigned NOT NULL DEFAULT 0,
ended_at int unsigned NULL,
UNIQUE KEY uq_run_qid (run_id, qid)
```

- qid 只由 `AUTO_INCREMENT` 分配，删除 `obl_queue_next_qid()` 依赖；
- 战斗结束将流程 `state` 置为 `IDLE`、`lifecycle='ENDED'` 并保留行；queue 可清理但 identity 不删除；
- 所有 state/queue/event 查询同时校验当前 `run_id`；
- 新一局切换 `run_id`；表和 AUTO_INCREMENT 不重置，`run_id + qid` 还负责让旧客户端 token/event 明确失效。

### 9.3 `oblqueue`

qid/bid 类型统一：

```text
oblqueue.qid  → int unsigned
oblplayers.bid → int unsigned
API qid       → TypeScript number
```

`int unsigned` 足以保持 JSON number 精确且与前端契约一致。可选新增审计字段：

```sql
joined_round int unsigned NOT NULL DEFAULT 0,
joined_tick int unsigned NOT NULL DEFAULT 0,
join_reason varchar(32) NOT NULL DEFAULT 'battle_start'
```

主键 `pid` 继续保证一个角色只能拥有一条队列归属。

### 9.4 Battle Event Outbox

新增 `oblbattle_event` 与 `oblbattle_event_delivery`，替代 JSON battlelog 权威存储。

### 9.5 `oblgame`

新增：

```sql
domain_revision bigint unsigned NOT NULL DEFAULT 0
```

它只标识成功提交的领域状态版本，和 tick 计数、heartbeat 时间、repository save 次数完全解耦。

---

## 10. 文件改造范围

### 10.1 后端新增

```text
oblivions/include/game/combat/combat.participation.php
oblivions/include/game/combat/combat.impact.php
oblivions/include/game/battle_event_repository.php
```

### 10.2 后端修改

```text
combat.context.php
combat.chain.php
combat.core.php
combat.pipeline.php
combat.target.php
combat.effect.php
combat.state.php
combat.preview.php
combat.log.php
combat_skill_config.php
battle.queue.func.php
battle.queue.main.php
battle_state_machine.func.php
api/heartbeat.php
obl_tick_orchestrator.php
obl_runtime.php
obl_command_contract.php
obl_command_handlers.php
obl_command_bus.php
obl_state_handlers.php
obl_state_response.php
obl_bootstrap.php
mark_battle_log_played.php（移除或替换为认证 ack API）
SQL schema files
```

### 10.3 前端新增

```text
vex-vue/src/stores/combat-session.ts
vex-vue/src/stores/combat-draft.ts
vex-vue/src/stores/targeting-session.ts
vex-vue/src/stores/map-entity-projection.ts
vex-vue/src/stores/character-ingestion.ts
```

### 10.4 前端修改

```text
stores/character.ts
stores/map.ts
stores/player.ts
stores/battle.ts
stores/command-queue.ts
stores/battle-director-v2.ts
stores/battle-playback-runner.ts
types/api.ts
types/events.ts
api/obl-command.ts
api/client.ts
components/battle/PreloadArea.vue
components/battle/AimMode.vue
components/battle/BattleHeader.vue
components/battle/DamageNumber.vue
components/map/MapGrid.vue
composables/useMapRender.ts
App.vue
```

---

## 11. 实施顺序

### 阶段 1：建立正确后端基线

1. 关键表转 InnoDB，建立不可复用 battle identity/domain_revision，Command 与 heartbeat 共用事务协调器。
2. 新增 Participation 分类、action UnitOfWork 与安全队列追加原语。
3. 增加 relation/impact 概念。
4. `battle.start` 和 `battle.submit_turn` 共用 server-owned chain plan。
5. direct PID、动作链多 PID、tile/AOE 全部接入动态参战。
6. 其他 qid 明确拒绝，删除无条件抢队行为。
7. 增加 turn_version、roster_version 和 expected gate。

### 阶段 2：事件与读模型

1. 建立 battle event outbox。
2. 增加 `combatant_joined`。
3. Combat ViewModel 增加 targetCandidates/turnToken/rosterVersion/stateRevision。
4. State API 用 consistent snapshot 组装，全 scope 增加 runId/revision meta。
5. preview 改为后端构造权威 cache。
6. 建立 pre-battle CombatSession/targetCandidates 契约与认证 event ack API。

### 阶段 3：前端会话与草稿基线

1. 建立 CombatSessionStore，移除 combatContext 多副本和 `battle:preload-init` 快照语义。
2. 建立 CombatDraftStore 与 sessionKey/turnToken 草稿生命周期。
3. 建立 TargetingSession request identity。
4. 接入 preview_plan、submittable 与乱序丢弃。

### 阶段 4：前端自由瞄准与架构收口

1. enemy 技能始终进入 AimMode，`defaultTargetPid` 降级为只预高亮的 suggestedTargetPid。
2. 瞄准锚点迁移到角色 entity，补实时跟随与同格多 NPC 消歧。
3. currentEnemyPid 降级为 focusedTargetPid，BattleHeader 改为多目标摘要。
4. 播放层移除单 NPC fallback。
5. CharacterHub 增加 revision、权威集合清理、reset 和 ingestion coordinator。
6. 引入派生 presentation phase 与完整取消语义。
7. 建立 single-flight reconciliation、分页 backlog drain 和 displayed-but-unacked 去重。

### 阶段 5：文档清理

1. 更新 `oblivions/DESIGN.md` 的 Combat ViewModel、目标规则、battlelog 和窗口期章节。
2. 更新 `oblivions/CODEBASE.md` 与 `vex-vue/CODEBASE.md`。
3. 在两份旧设计案开头标注已被本设计案修正的章节。
4. 删除“空 battlelog 合成战斗结束”的落地要求。

---

## 12. 验收测试

### 12.1 后端 Participation

1. 空闲 NPC 被首次有效攻击后，原子写入 action/bid/queue/battle_cache。
2. 同 qid member 重复作为目标时幂等，不重复队列行或 joined event。
3. current qid active=0 成员不能重新加入。
4. 其他 qid 目标返回 `TARGET_IN_OTHER_BATTLE`，源战场完全不变。
5. stale bid、缺 queue row、action/bid 不一致时 fail closed。
6. 死亡、未发现、非敌对、跨区域、自身目标按规则拒绝。
7. 技能不存在、未拥有、CD、AP、射程失败时不入队。
8. 新成员排当前轮末尾、done=0，不抢占当前 actor。
9. 新成员在其 turn start 正常恢复 AP并执行 NPC AI。
10. 新成员不会在同一 TickFrame 同时执行 world AI。
11. qid 在 queue 清空和战斗结束后不复用，旧 run 的 token/event 不能命中新战场。

### 12.2 动作链

1. 一条动作链分别攻击 A、B，两个 QueueItem 保持各自 PID。
2. 外部 B 在 Action 2 加入后，Action 3 的 all 能命中 B。
3. all 位于加入 B 的动作之前时不能提前命中 B。
4. 前序 move 后攻击新目标，按 planned position 校验。
5. 后序 action 因 AP/规则失败时，其目标不得误入队。
6. 前序击杀最后旧敌人、后序攻击 joinable 新敌人时，动作链不能被旧 `combat_state_check_end` 提前终止。

### 12.3 AOE

1. grenade 同格多个 hostile 实体按稳定顺序解析。
2. 所有 joinable impact entities 在受伤前完成参战。
3. 其他 qid impact entity 使该 action 按定义失败，不得被抢队或受伤。
4. 同一 action 动态加入后死亡，最终 `state=1/action='' /active=0`。
5. `target='all'` 只影响当前 qid 成员。
6. relation/alive/affects 不合法的实体被过滤；过滤后无 impact 返回 `NO_VALID_IMPACT` 且不扣 AP。
7. 一个 AOE 中任一 impact 属于其他 qid 或 membership inconsistent 时，整项 action 失败，所有 joinable 均不入队。
8. move/heal/escape 等无角色 impact 的合法 utility action 仍可正常执行。

### 12.4 事务与事件

1. 任意 SQL 故障注入都不能留下 action/bid/queue 半写。
2. 事务失败不推进 done/state/tick。
3. `combatant_joined` 必须先于该实体的 effect/cleared 事件。
4. DB commit 后事件 inbox 必定可读。
5. mark played 失败后刷新仍能取得未确认事件。
6. 同 qid member 不重复发 joined。
7. heartbeat NPC action 与 Command API 具有相同回滚/outbox 原子性。
8. 空 heartbeat 只更新运维时间，不推进 domain_revision，不使 preview 永久过期。
9. State API 并发跨 command commit 时，响应只能是提交前或提交后的完整快照，不能混合 player/queue/battle state。
10. 多成员同 action 加入共享一个 rosterVersion，事件按稳定 PID/event_seq 排序。
11. ack API 不能确认其他 PID 的 delivery，重复 ack 幂等，超量 eventIds 被拒绝。

### 12.5 前端自由瞄准

1. 有 suggested A 时，点击 enemy 技能仍进入 AimMode。
2. 玩家选择 B 后提交 payload 的 target PID 为 B。
3. 同一动作链可以选择 A、B、C。
4. pre-battle 与 in-battle 使用同一目标选择交互。
5. member 与 joinable 可选；blocked 可见但不可提交。
6. 默认目标只高亮，不自动装填。
7. 同格多个 NPC 可以分别选择。
8. 与玩家同格的 NPC 可以选择。
9. 目标移动、死亡、失去发现或 revision 变化时 AimMode 实时失效。
10. 双击 Execute 只发送一次命令。
11. pre-battle 打开后能取得当前区域全部合法候选，qid/turnToken 为 null。
12. joinable 实体 dimmed 但可选；blocked dimmed 且不可选；joined reconcile 后同一 entity key 转 active，不重建。
13. GSAP/地图移动期间 hover 或键盘焦点瞄准线逐帧跟随，Aim 关闭后无残留 rAF/listener。
14. 旧 targetingRequestId 的选择结果不能写入新技能或新 turn 草稿。
15. ESC、pre-battle 取消、in-battle 取消分别只清理其定义范围。

### 12.6 Preview 与草稿

1. preview 乱序响应被 request revision 丢弃。
2. preview pending/stale 时 Execute 禁用。
3. 同 qid + 同 turnToken 的 refresh 不清草稿。
4. 新 turnToken 清草稿。
5. submit 成功清草稿。
6. STATE_CONFLICT 把旧草稿隔离为只读 quarantined draft，新 turn 不自动继承。
7. 客户端伪造 battle_cache 不影响后端 preview。
8. CombatDraftStore 在 PreloadArea 卸载、短暂 PROCESSING 和 STATE_CONFLICT 后按 identity 保留草稿。
9. 无关 scope 的 domain revision 变化触发重新 preview，不永久锁死 Execute。
10. preview 返回后 AP/位置/impact/join 反馈使用服务端 plan；skippable action 与 blocking plan 的 UI 不混淆。

### 12.7 CharacterHub 与恢复

1. 旧 revision 的 enemies/player_info 不能回滚 CharacterHub 的 HP/位置，也不能回滚 CombatSession 的 membership。
2. 当前区域 enemies 权威快照缺失的 NPC 被正确删除。
3. combat_workspace 原子发布 CombatSession 与所引用 Character，缺失引用时保留上一版并重拉。
4. run/player 切换后 CharacterHub 完全 reset。
5. 动态加入后实体从半透明切为 active，不发生消失/重建跳变。
6. F5 时后端已结束但存在 backlog，仍先播放再退出。
7. heartbeat 连续软失败后自动 reconcile。
8. 空 battle event inbox 不合成战斗结束。
9. reconciliation 运行中新增 changedScopes 会合并并触发末次 rerun，不丢状态。
10. inbox 多页时 drain 到空；ack 失败后本会话不重复播放 displayed-but-unacked 事件。

---

## 13. 非目标与后续扩展

本阶段不做：

- 隐式战场合并；
- 多玩家同时输入；
- 完整阵营系统；
- 前端自行决定敌对关系；
- CharacterHub 保存历史事件快照；
- 用普通 notice 替代正式 joined event；
- 通过兼容旧 MyISAM 半写行为降低事务要求。

未来扩展：

- 显式 `battle.merge`；
- friendly/neutral/faction relation；
- 召唤物与援军主动加入；
- reaction/counter 导致的新 impact entities；
- 战场观察者与第三方介入提示；
- 多玩家 battle event delivery。

---

## 14. 最终设计基准

1. CharacterHub 管“角色现在是什么”。
2. CombatSession 管“当前战场允许什么”。
3. TargetingSession 管“玩家这次选择什么”。
4. Participation 管“攻击如何扩展当前战场 roster”。
5. Preview 与 Execution 共用同一动作链、impact 和 Participation 语义。
6. BattlePlayback 管“过去发生了什么以及如何演出”。
7. 前端可以早进晚退，但不能绕过后端成员关系和动作规则。
8. 所有影响角色的战斗效果，都必须先建立或确认其战场成员关系。

动态参战的正确含义不是“允许攻击任意数据库 PID”，而是：

> 一个已通过实际动作规则的 hostile impact，可以在事务内、按动作顺序、以可恢复的事件协议，把空闲目标原子地纳入当前 qid，然后再结算效果和队列生命周期。
