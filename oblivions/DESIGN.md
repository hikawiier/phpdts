# Oblivions 子系统 — 概念与设计要点

> AI 智能体介入项目前必读。本文档解释 Oblivions 子系统的关键概念、核心设计原则和跨任务沉淀的设计思路。
> 代码库参考手册：[CODEBASE.md](./CODEBASE.md) | 项目文档总入口：[AGENTS.md](../../AGENTS.md)

---

## 〇、当前架构摘要（AI 快速判断区）

> 阅读以下要点后再深入各章节，可避免被历史段落误导。本节是"当前真相"，正文若与本节冲突以本节为准。

**三个独立 HTTP 入口**（均不依赖 `common.inc.php`，由 `obl_runtime_boot($kind)` 提供独立运行期）：

| 入口 | 用途 | 加载的 bootstrap |
|------|------|-----------------|
| `oblivions/api/command.php` | JSON Command API（玩家写操作唯一主路径） | `obl_command_api_bootstrap.php` → Command Bus |
| `oblivions/api/heartbeat.php` | Heartbeat API（前端显式驱动 tick 推进 + NPC 行动） | `obl_heartbeat_api_bootstrap.php` → Tick Orchestrator |
| `oblivions/api/state.php` | State API（纯读，不推进 tick） | `obl_state_api_bootstrap.php` → State handlers |

**命令名（新）**：`map.move` / `map.explore` / `poi.search` / `world.wait` / `item.pickup` / `item.discard` / `item.use` / `inventory.organize` / `craft.execute` / `battle.start` / `battle.submit_turn`。旧名 `obl_explore` / `obl_battle_action` 等仅存于 deprecated 的根 `command.php` → `obl_command.php` 兼容路径，前端不再调用。

**tick 推进两条路径**：
1. **玩家命令路径**：Command Bus `obl_command_save_and_tick()` → `obl_tick_orchestrator_after_command()` → `obl_tick_advance()`（仅 `advancesTick=true` 的命令）
2. **心跳路径**：`obl_tick_orchestrator_heartbeat()` → `obl_tick_orchestrator_resolve_pending()` → `obl_resolve_tick_events()`（处理 NPC 行动）

> 旧 `obl_command.php` 的 [F] 段 `obl_tick_advance()` 仍存在于代码中，但该文件整体标记为 `@deprecated`，仅服务旧根 `command.php` 兼容路径。新前端走 Command API，不经过 [F] 段。

**TickFrame 行为基准**：
- 一个 TickFrame 内，同一 actor 最多执行一个主动行为。
- 主动行为只属于两个域之一：`combat` 或 `world`。
- TickFrame 初始化 `BattleActorScope`，world AI 必须排除本 TickFrame 战斗域成员。
- 普通离场 actor 在后续 TickFrame 按世界规则恢复资格；escape effect 为 actor 创建 pending `flustered` effect-skill，qid disband 时激活为 starts=`disband_tick+1`、duration=1。它通过 capability evaluator 阻止首个真正的战后 world AI、移动和参战，不依赖逃跑专用字段。

**战斗系统边界**：`combat/` 是唯一战斗执行主流程；`battle/` 是仍被复用的 shared combat infrastructure，负责队列、状态机 hook、共享数值与请求内 BattleLogCollector。在线演出由 response `presentation.v1` 投递，不由 `battle/` 维护持久 played 队列。旧 `battle.entry.php` / `battle.main.php` 不再存在于运行时心智模型里。

**战斗 UI 数据源**：`player_info.combat_context` 提供当前 qid、队列成员和提交权限；独立的 `combat_targets` scope 提供全部展示候选及 `member/joinable/left/other_battle/blocked` 投影。前端战斗会话以规范化后的 `qid` 为身份，点击敌人的 PID 只作为 suggested/focused target，不能代替战场身份或后端合法性判断。

**前端战斗播放边界（四层架构）**：battlelog.v2 是语义事件流；后端原料层 emit 事件，Director（`directV2`）负责把事件转脚本，PlaybackPlan（`planPlaybackV2`）负责排序/并发/等待策略，Runner/ActorExecutor（`battle-playback-runner.ts` / `battle-actor-executor.ts`）负责真实动画执行。不要把动画时序散落回组件事件里。

**Command API 响应契约**：后端返回 `{ status, code, request_id, data: { feedback, refresh, changed_scopes, server_state, ...domainData }, presentation_head_seq, presentation?, warnings? }`。`changed_scopes` 是动态权威失效范围；`CAPABILITY_BLOCKED` 返回 capability、公开 status 来源和恢复 tick。战斗命令的领域结果位于 `data.actions[]`；在线演出随 `presentation.v1` 直带。

**三套日志系统职责**（物理隔离）：

| 日志 | 用途 | 前端呈现 |
|------|------|---------|
| `obl_log` | 玩家历史事件 | 日志区 + Toast（按白名单） |
| `$obl_battle_log` / battlelog.v2 | 请求内战斗导演事件收集器 | 随 `presentation.v1` 进入 Director/Planner/Runner |
| `obl_error_log` | **诊断流**（后端异常/命令拒绝） | 默认不提示；仅 `?debug=ai` / `?poll_error=1` 时弹诊断 Toast |

> `obl_error_log` 不再作为普通 UI 错误通道。普通业务拒绝由 Command API response 的 `code + feedback` 负责，前端 `command-feedback.ts` 渲染。

**不可破的边界**：
- 不升级旧根 `command.php` 为 JSON；Oblivions 新写操作只走 `oblivions/api/command.php`
- Oblivions 运行时不依赖 `common.inc.php`
- 后端只返回结构（`code + feedback.id + params`），前端负责文案/i18n/HTML
- battlelog.v2 是请求内战斗导演事件流，不是普通日志，也不是 played/ack 消息队列
- Vite proxy 保留（开发环境转发 `/phpdts/*` 到后端）

---

## 一、核心概念词典

以下概念在 Oblivions 中有特定含义，不可按字面意思理解。

### 1.1 区域 (Region) vs 地图格 (Tile)

- **区域**：一个独立的子地图，由多个地图格拼接而成。数据库键 `pgroup`，最多 255 个区域。
- **地图格**：最小的移动单元，数据库键 `pls`（区域内局部索引 1-254）。跨区域时 pls 可重用——区域1的 pls=5 和区域2的 pls=5 是不同的格。
- **组合键**：`(pgroup, pls)` 唯一确定一个地图格。

### 1.2 地板属性 (floor)

地图格的地板属性，**影响玩家交互**（移动消耗修正、技能效果、可破坏性），不是纯装饰：

| 值 | 含义 |
|----|------|
| `standard` | 标准地板 |
| `water` | 含水地板 |
| `vegetation` | 覆植地板 |
| `metal` | 金属地板 |
| `magic` | 富魔力地板 |

### 1.3 潮汐属性 (tide)

**不是海潮涨落，是区域危险等级分区标签。** 潮汐影响资源生成倾向（稀有度权重、敌人生成偏向、事件点类型），不影响玩家移动：

| 值 | 危险等级 | 含义 |
|----|---------|------|
| `shallow` | T-1（低） | 浅滩区，低危险 |
| `deep` | T（中） | 深水区，中危险 |
| `abyss` | T+1（高） | 深海区，高危险 |

> **注意**：`safe` **不是** `tide` 的取值。安全区状态由独立字段 `preset_safe` 标记。

### 1.4 迷雾 (fog) vs 发现 (discovered)

两个**独立**的关注点，不可混淆：

| | 迷雾 (fog) | 发现 (discovered) |
|---|---|---|
| **控制什么** | 地图格的可见性 | 道具的可操作性 |
| **数据位置** | `oblmapstates` 表 `fog` 字段 | `oblmapitem` 表 `discovered` 字段 |
| **如何点亮** | BFS 视野计算，玩家位置扩展 | 玩家进入地图格时自动发现该格所有道具 |
| **效果** | 迷雾格在前端显示为 `░░░` | 未发现的道具不出现在拾取列表中 |

### 1.5 POI vs 散落道具

都是道具来源，但机制不同：

| | POI（建筑物） | 散落道具 |
|---|---|---|
| **位置** | 地图格内的建筑物 | 直接在地图格上 |
| **获取方式** | 需搜索（`obl_search_poi`），消耗体力 | 直接拾取（`obl_pickup_item`） |
| **数据表** | `oblmappoi` | `oblmapitem` |
| **搜索次数** | 有 `search_count` 上限 | 无搜索概念 |
| **生成池** | `poi_pool.php` | `scatter_pool.php` |

### 1.6 itmpara 与 itempara

**itmpara**（地图道具实例的 JSON 附加参数，`bra_oblmapitem.itmpara`）：
- 拾取时保持原始附加参数，不注入地图实例主键
- 道具模板 ID 由背包对象的 `itmid` 保存，丢弃时还原到 `bra_oblmapitem.item_id`
- 格式：JSON 对象，如 `{}` 或 `{ "charge": 3 }`

**itempara**（玩家道具栏 JSON 大字段，`bra_oblplayers.itempara`）：
- JSON 数组，长度 = `itemmaxslots + 1`（index 0=itm0 缓存槽，1~itemmaxslots=普通槽）
- 每个元素是一个道具对象或 `null`（空槽）
- itm0 是新增道具（拾取/合成产物/未来卸装备）的中转槽，所有新增道具先入 itm0 再整理入背包；itm0 非空时玩家被锁定，仅 `inventory.organize` / `item.discard` 命令可用（详见 §2.24）
- 道具对象的 `itmid` 是模板 ID（如 `rusty_pipe`），地图实例主键是 `bra_oblmapitem.iid`

> 道具对象七字段规范与 JSON 示例见 [CODEBASE.md §3.1](./CODEBASE.md#31-bra_oblplayers-玩家敌人统一数据表)。

### 1.7 游戏刻 (tick) 与推进驱动

- 游戏刻存储在 `{$tablepre}oblgame.tick` / `processed_tick`（source of truth），`$gamevars['obl_tick']` / `$gamevars['obl_pretick']` 是兼容镜像（由 `obl_gamevars_sync_to_globals()` 同步，供领域函数运行期读取）
- **tick 推进的两条路径**（互斥，由战斗状态机管辖）：
  1. **玩家命令路径**：玩家提交 `advancesTick=true` 的命令（`map.move` / `map.explore` / `poi.search` / `world.wait` / `battle.start` / `battle.submit_turn`）→ Command Bus `obl_command_save_and_tick()` → `obl_tick_orchestrator_after_command()` → `obl_tick_advance()`（`obl_tick++`）
  2. **心跳路径**：前端显式 `POST oblivions/api/heartbeat.php` → `obl_tick_orchestrator_heartbeat()` → 检测 `obl_pretick < obl_tick` → `obl_tick_orchestrator_resolve_pending()` → `obl_resolve_tick_events()` 调度 NPC 行动
- **NPC 行动自驱动**：NPC 行动后通过 `obl_tick_request_advance()` 请求推进 → 调度器末尾 `obl_tick_advance()`（`obl_tick++`），下次心跳检测到 pending tick 继续处理
- **玩家操作与 NPC 回合互斥**：PROCESSING 状态时 Command Bus gate `BATTLE_BUSY` 拒绝推进 tick 的命令（防止玩家在 NPC 行动期间重复提交）
- **同 tick 单 actor 单主动行为**：TickFrame 内每个 actor 只能执行一个主动行为；战斗行为与非战斗 world AI 共享同一个行为额度。后端通过 `ActorBehaviorLedger` 登记 `combat` / `world` 行为，通过 `BattleActorScope` 排除本 TickFrame 入口的战斗域成员。
- **战斗结束后的下一 tick**：escape 结算施加 pending `flustered`，qid 真正 disband 时才激活并锚定下一 TickFrame。active 状态通过统一 capability evaluator 拒绝 `world_ai`、主动移动、发起/参与战斗、战斗动作与即时 mutation；`map.explore`、`poi.search`、`world.wait` 仍可推进时间。该规则只作用于状态持有者。

> post-combat AI 恢复边界与 PresentationScene 的 Actor 级 handoff 共同保证领域和视觉连续性；`battle_end` 遮罩达到覆盖态时作为战斗投影向世界投影的显式交接窗口，world animation 可在遮罩下开始。详见 [`docs/战斗演出事件消费与权威投影解耦研判.md` §12](./docs/战斗演出事件消费与权威投影解耦研判.md#12-战斗结束到世界-ai-的视觉连续性)。

> 旧根 `command.php` → `obl_command.php` 的 [F] 段 `obl_tick_advance()` 仍存在于代码中，但该路径整体标记为 `@deprecated`。新前端走 Command API（`oblivions/api/command.php` → `obl_command_bus.php`），不经过 [F] 段。

> 完整链路（heartbeat.php → Oblivions Runtime → Tick Orchestrator）与 PROCESSING 实际生命周期详见 [§2.16 前端守护进程模型](#216-前端守护进程模型心跳)。

### 1.8 回合 (Turn) vs 轮 (Round)

战斗系统中两个核心时间单位，概念分层：

| | 回合 (Turn) | 轮 (Round) |
|---|---|---|
| **定义** | 单人次一次完整行动（1 tick） | 全队列一轮循环（仅队列操作） |
| **范围** | 1 回合 ⊂ 1 轮 | 1 轮包含多回合 |
| **示例** | 玩家执行技能 / NPC 出手 | 全员 done=1 → 重建队列 |

**命名约定**：
- 代码注释用"回合"指 Turn，"轮"指 Round
- 旧术语"先攻轮"已废弃——原义即为"回合"（Turn，单人次行动），**从未涉及"轮"（Round）的概念**。表述时按实际层级区分：单人次行动用"回合"，全队列循环用"轮"

### 1.9 结构化日志 + 前端 Toast 强化提醒

Oblivions 模式的日志传递机制。后端只输出事件结构（发生了什么 + 参数），前端完全控制视觉呈现（文案、样式、随机化）。

**Toast 强化提醒机制**：

前端 2 级页面（模态框，如背包 / 合成台 / Itm0Modal）打开时会遮挡日志区，玩家无法通过日志区感知刚发生的事件。后端 emit 的日志事件若仅依赖日志区呈现，玩家在模态框打开期间会错过关键反馈。

**核心约束**：关键事件必须通过 Toast 强化即时提醒，确保玩家在任何 UI 状态下都能感知。Toast 是日志区的"即时补强"，不是替代——日志区负责留痕回顾，Toast 负责即时反馈。

**三层反馈分工**：

| 反馈层 | 职责 | 触发条件 | 特征 |
|--------|------|---------|------|
| 日志区 | 留痕回顾 | 始终渲染（除黑名单） | 持久存在，可滚动回顾 |
| Toast | 即时反馈 | 仅 2 级页面打开时 + 白名单匹配 | 短暂显示，自动消失 |
| 模态框 | 强制处理 | 特定状态触发（如 itm0 非空） | 持续显示，玩家必须处理才能关闭 |

**事件呈现策略原则**：

每个事件按语义选择反馈层，避免"所有事件都 Toast"的噪音或"所有事件都日志"的遗漏。具体事件 ID 与反馈层映射由前端实现维护，设计原则如下：

- **瞬时动作事件**（如"捡起"）：Toast 即时反馈，日志区不留痕（避免与结果事件重复）
- **状态变化事件**（如"入背包"）：日志区留痕 + Toast 即时反馈，双重呈现
- **需强制处理事件**（如"背包满"）：模态框强制处理，日志区/Toast 不重复（模态框已提供足够强的反馈）
- **锁定提示事件**（如"itm0 锁定时拒绝命令"）：模态框已持续显示，日志区不重复

**双 Toast 合并原则**：同一请求内几乎同时弹出的多个 Toast 应合并为单条，避免视觉噪音。合并策略由前端实现决定（如拾取成功场景的"捡起 + 入背包"双事件合并为单条 Toast）。

**批量合并原则**：批量操作（批量拾取 / 合成多产物）产生的多条同类事件应合并为单条 Toast（按数量合并），避免刷屏。

**设计理由**：
- 模态框遮挡日志区是 Web UI 的客观限制，Toast 是跨遮挡层的即时反馈手段
- 三层分工让每个事件选择最合适的反馈层，避免反馈不足或反馈冗余
- 瞬时事件不在日志区留痕，避免与结果事件重复
- 需强制处理的事件依赖模态框而非 Toast，因为 Toast 短暂提示不足以驱动玩家行动

### 1.10 战斗演出事件与 PresentationBatch

`obl_log` 继续保存玩家可回看的结构化摘要；`$obl_battle_log` 现在只是单次 command/heartbeat 请求内的 battlelog.v2 事件收集器，不再是持久消息队列。

| | obl_log（结构化日志） | battlelog.v2（实时演出事件） |
|---|---|---|
| **内容** | 探索/移动/拾取/战斗摘要 | 战斗内 action/delivery/effect/clear/end 等演出事实 |
| **生命周期** | 按既有日志保留策略持久化 | 请求内收集，COMMIT 后随 response 的 `presentation` 字段投递 |
| **可靠性** | 可重新读取 | best-effort；丢失时按权威状态 rebase，不重放命令 |
| **前端用途** | 日志区渲染 + Toast | Director/Planner/Runner + PresentationScene |

**event_type 细分与原料补全**：

后端 render channel 当前使用 11 种 battlelog.v2 `event_type`：`round_start` / `turn_start` / `action_start` / `action_delivery` / `combatant_joined` / `effect_applied` / `action_end` / `action_failed` / `combatant_cleared` / `battle_end` / `notice`。`action_delivery` 始终引用 ResolvedAim，`effect_applied` 始终引用具体 ResolutionTarget；`combatant_joined` 必须先于该角色的 effect。

**render/debug 分离**：每条 emit 携带 `debug` 布尔字段。Runtime 只把 `debug=false` 的 render events 放入 `PresentationBatch.events`；debug/diagnostic 使用独立诊断流，不参与 presentation cursor。

**迁移兼容字段**：当前 response event 仍补充 `log_id=event_seq` 与 `played=1`，只为兼容既有 Director fixture/type；它们没有服务端游标、确认或重播语义。新代码必须使用 `batch_seq/event_seq` 排序与去重，不能恢复 played ack。

**边界标记字段**：

每个条目自动附加两项层级计数字段：
- `bl_turn_num` — Turn 计数（null=pre-battle/尚未开始，1+=第 N turn），由 `battle_hook_turn_start` 递增
- `bl_round_num` — Round 计数（null=pre-battle 尚无队列，0+=第 N round），从 DB `oblbattle_state.round_num` 同步

这些字段供前端导演系统进行分层分段编排。v2 不再依赖 `bl_segment_flag` 字段——边界信号直接由 `event_type` 本身表达（`round_start` / `turn_start` / `battle_end` 即边界）。

**在线投递流程**：

```text
领域事务内 emit battlelog.v2
  -> Runtime 冻结 render events，事务内递增 obl_presentation_head_seq
  -> COMMIT
  -> command/heartbeat response 附加 presentation.v1
  -> 前端 PresentationInbox 按 batch_seq 消费
  -> Director/Planner/Runner 更新 PresentationScene
  -> 完成或发现 gap 后 rebase 到 AuthoritativeStore
```

F5/冷启动从 `player_info.presentation_head_seq` 初始化 cursor，直接显示当前权威世界，不补播旧动画。旧 `battle_log` State scope、mutable JSON 和 `mark_battle_log_played.php` 已删除。详见 [`docs/战斗演出事件消费与权威投影解耦研判.md`](./docs/战斗演出事件消费与权威投影解耦研判.md)。

### 1.11 错误日志 (Error Log)

与 `obl_log` / `obl_battle_log` 物理隔离的第三套日志系统，专门记录后端异常和命令拒绝事件，**当前定位为诊断流**：

- **全局变量**：`$obl_error_log`（`OblivionsErrorLogger` 实例）
- **持久化**：`oblivions/cache/logs/obl_error_{groomid}_{pid}.json`
- **emit 签名**：无 `logcategory` 参数（区别于 `$obl_log->emit($id, $logcategory, $params)`）
- **前端使用**：默认不作为普通 UI 提示通道。前端 `error-log.ts` store 做增量检测，仅在 `?debug=ai` 或 `?poll_error=1` 诊断模式下弹出 Toast；普通业务拒绝改由 Command API response 的 `code + feedback` 负责（前端 `command-feedback.ts` 渲染）
- **兜底保护**：`oblivions/api/command.php` 与 `heartbeat.php` 均注册 `register_shutdown_function`，PHP fatal error 时输出 JSON 错误而非 HTML 500；前端 `sendOblCommand()` 检测非 JSON 响应时返回 `SERVER_ERROR`（经 `command-feedback.ts` 渲染兜底文案）

**设计理由**：与结构化日志分离存储，避免错误日志污染正常日志流；独立裁剪策略，错误日志不参与正式日志的 200 条上限计数。诊断流定位让 error_log 专注于后端可观测性，不承担玩家可见反馈职责。

### 1.12 Tag 系统（A/B 分类）

战斗目标状态通过 Tag 统一描述。分两类：

**Category A（主视角相关）**：`self`（目标是自己）、`out_of_range`（超出射程）。每次从当前 actor/target 重算，不缓存。

**Category B（绝对状态）**：`dead`（`state=1`）、`escaped`（已逃跑）、`hidden`（隐身）。通过 `$battle_cache['tag_mutations'][pid]` 缓存，同一 `battle_main` 调用内跨 action 可见，随 cache 销毁自动清零。

**配置驱动规则匹配**：技能配置把瞄准规则放在 `aim.rules`，把具体角色规则放在 `capture.rules`。规则由 `combat_check_target_rules()` 对当前 ResolvedAim 或当前 TargetResolutionUnit 的标签集执行；单目标失败只产生 skipped，其他目标继续。

### 1.13 战斗入口 (Battle Entry)

当前运行入口分为两类：

- `combat_start_battle`：首次建队列并进入战斗
- `combat_dispatch`：已有队列中的玩家 / NPC 回合推进

旧 `battle.entry.php` / `battle.main.php` 已删除；`battle.queue.*.php` 作为 shared combat infrastructure 保留，负责队列与状态推进。

**当前回合推进模式**：

| 模式 | 触发源 | 队列 |
|------|--------|------|
| `player_turn` | 玩家命令 | 已有队列中推进 |
| `npc_turn` | tick 结算 NPC 回合 | 已有队列中推进（允许空动作） |

**核心约束**：
- 所有触发源只提交逐动作 AimIntent，不提交 roster 或 occupant PID 集合
- actions 解析、Aim、Capture、Participation 和 target rules 统一由 combat 内部完成
- `battle.start` 以第一项成功 hostile action 的合法角色目标建立 initial roster；此前 utility 正常执行，后续首次接触的敌人走动态 append-tail
- 最终没有成功 hostile action 时整个 `battle.start` 标记 rollback-only，前序 utility 不得提交

**队列生命周期后处理**：`battle_manage_queue` 返回后，调用方通过 `result.disbanded` 区分两条清理路径——解散时调 `battle_state_clear`（退队列、清 bid/action、AP 回满），存活时由 step 6 prepare 为下一顺位者恢复 AP 并保存。前者是"战斗结束打扫干净"，后者是"下一个人准备上场"，互不重叠。

### 1.14 战斗执行模块边界（Combat vs Battle）

当前战斗系统分为两个层级：

| 层级 | 目录 | 职责 |
|------|------|------|
| 战斗执行层 | `include/game/combat/` | 回合入口、动作链、管道执行、目标解析、效果应用、planned state、battlelog.v2 |
| 共享基础设施层 | `include/game/battle/` | 队列原语、队列编排、状态机 hook、共享数值、AP 恢复、历史兼容函数 |

设计判断：`battle/` 不是“旧系统死代码”，也不是新动作逻辑的放置点。新增技能、目标规则、效果类型、动作链能力应进入 `combat/`；只有队列/状态机/共享数学这类跨执行层基础设施才保留或调整在 `battle/`。

### 1.15 配置驱动战斗技能

战斗技能由 `gamedata/combat_skill_config.php` 声明静态规则，由 `gamedata/combat_skills/skill_{act_id}.php` 提供执行 hook。

技能身份与生命周期由 `gamedata/skill_definition_config.php` 声明；主动机制只以 `combat_skill_config.php` 为真值源。effect-lifetime 被动技能持久化在 `skillpara.effect_instances`，通过 `skill_effect/*` 生命周期与 `actor.capability.php` 参与领域判定，不进入主动技能装填列表。

配置负责描述：
- `aim.resolver/rules`：玩家选择如何解析为后端 ResolvedAim
- `capture.resolver/relation/participation/order/rules`：动作捕获哪些有序 ResolutionTarget
- `execution.empty_policy`：无成功目标时失败还是仍完成投送
- `delivery.types: string[]`：按顺序播放的投射、爆炸、移动目的地 cue
- 射程、AP、CD、排序权重和 effect 参数

hook 负责声明效果：

```php
function skill_xxx_execute(CombatContext $ctx): void {
    $ctx->declareEffect('damage', array('value' => 10));
}
```

核心约束：hook 不直接写 DB，不自行查询或修改任意 PID，只对 current target 声明 effect；actor effect 必须显式 `scope=actor`。move 的真实位置写入也由 effect applier 完成。这样 verify、preview 和 execute 共享同一套 Aim/Capture/TargetResolutionUnit 语义。

### 1.16 PlannedState / Effect Projector / 动作链

玩家一次提交的多个动作是一条动作链，整条动作链属于同一个回合、同一个 tick。动作链内部要能看到前序动作的计划结果，例如 AP 已消费、目标已受伤、角色已移动、目标已逃跑。

因此 dry-run/verify/preview 不应重复读取 DB 当前态当作每一步的真相，而应使用 PlannedState：

- `combat_planned_state_*` 保存 actor/target 的计划快照
- `combat_effect_projector_*` 把 damage/heal/move/escape/ap_change 投影到计划快照
- `combat_chain_project()` 统一驱动动作链投影，返回每个 action 的成功/失败与 effects

设计基准：预览与校验必须尽量复用执行语义；差异只在“投影到内存”还是“持久化到 DB”。动作失败是具体规则综合判断结果，不应被压成单一“链失败”概念。

### 1.17 Combat ViewModel

`player_info.combat_context` 是当前战场成员和回合权限的后端权威视图；`combat_targets` 是自由瞄准候选的独立权威 scope。两者职责不能合并：前者只描述当前 qid，后者还必须展示可动态加入和被阻止的已发现角色。

核心字段包括：
- `state` / `currentActorPid` / `canSubmitTurn`：用于决定按钮与提交权限
- `combatants`：用于战斗地图实体和血量/AP 展示
- `validTargets`：当前 qid 内的 active 目标兼容投影
- `suggestedTargetPid`：只用于初始 focus，不自动写入 QueueItem
- `combat_targets.qid/candidates[]`：候选的 relation、participation、selectable、reason 和角色投影

设计理由：前端不能用 enemies 列表或 suggested PID 推断 qid membership。地图/CharacterHub 可以展示角色，`combat_context` 决定当前战场成员，`combat_targets` 决定可展示和可提交候选，具体技能执行仍由后端重新校验。

### 1.18 请求事务与目标 SAVEPOINT

Command 与 heartbeat 都遵循 `GET_LOCK -> BEGIN -> reload -> execute/tick -> freeze presentation/head -> COMMIT -> attach presentation.v1 -> optional archive/diagnostic persistence -> release lock`。所有可写 Oblivions 表使用 InnoDB；DB adapter 在事务中通过 request-local throw-on-error flag 抛出 SQL 失败。shutdown guard 在事务仍 active 的 fatal/异常收口中 rollback，并兜底释放 room lock；COMMIT 后 fatal 不可能撤销已提交状态。当前 request_id 尚无服务端去重账本，因此客户端只能先 State reconcile，不能自动重放不确定结果的命令。

每个真实 TargetResolutionUnit 还在 Participation enlist 前建立 SAVEPOINT 和 BattleLogCollector checkpoint。可恢复的单目标 enlist/effect 失败只撤销本目标的 DB、内存和事件，保留此前目标的成功结果；SQL/PHP/commit 异常必须越过该层，由请求事务回滚全部写入。collector 的 render events 只在 COMMIT 成功后随 response 投递；显式配置的可选 archive writer 失败只返回 warning，不能回滚已提交领域状态。

### 1.19 BattlePlaybackPlan

前端战斗播放分四层（详见 §2.7）：

| 层 | 产物 | 职责 |
|----|------|------|
| 后端原料层 | battlelog.v2 语义事件 | emit 时补全名称、HP 快照、边界标记，不预判前端如何消费 |
| Director | `BattlePlayScriptV2` | 把 battlelog.v2 语义事件按 `action_uid` 聚合，分段（round_intro/turn/battle_end/system） |
| Planner | `BattlePlaybackPlan` / `PlaybackStep[]` | 决定准备地图、动作动画、清场、文本、伤害残留等步骤的顺序和等待策略 |
| Runner / ActorExecutor | 可取消 PlaybackExecutionTask | 执行 plan，等待 completion，超时先 cancel，驱动 actor runtime |

设计边界：组件只呈现状态，不承担时序推理；动画排序不应靠全局事件临时串联。战斗域动画和非战斗域动画都应进入明确的编排序列，避免同一帧内互相抢表现。

**Actor/Scene 执行底座**：地图以原子 `MapProjection { revision, currentTile, links, enemies }` 为可观察边界，`game_map` 与 `enemies` 不允许半提交；强制刷新必须绕过旧 pending，旧 generation 响应不得覆盖新投影或新缓存。`SceneGeometry` 统一 `TileRef -> ScenePoint -> ViewportPoint` 转换，并通过 `active/generation` 使 MapGrid 重挂载后的旧播放任务可检测、可取消。

每个 actor DOM 固定拆为 spatial/action/visibility/pose 四个通道，由 `ActorRuntime` 统一管理。调用方必须取得 `PresentationLease`，优先级为 `terminal > battle > world > ambient`；投影在 spatial lease 期间只写 `pendingAnchor`，释放时 reconcile 最新权威位置。`death` 标记 terminal 和已动画退场；`escaped` 进入 `PostCombatHandoff`，按 `retreat/settle-in-place/hidden-relocate-arrive/remove` 对齐权威实体；非死亡 `fall` 保持 down posture，不因 lease 释放自动恢复 idle。

`BattlePresentationSession` 跨连续 `PROCESSING` 批次存活。普通稳定边界负责 scene rebase 与 lease reconcile；`battle_end` 使用 `overlay covered -> presentation_scene_handoff -> modal content` 显式移交，结果正文与 PostCombatHandoff 并行。Scene 失效或执行异常会 abort 当前 session，但不得复活已经完成死亡退场的 actor。投射物与爆炸由独立 overlay executor 使用 ViewportPoint，ActorExecutor 不直接查询 DOM。

### 1.20 TickFrameResult 与 changedScopes

TickFrameResult 是一次 pending tick 结算的结构化结果。它记录：
- phases：`combat_domain` / `world_ai_domain` / `post_domain` 的执行结果
- actor_behaviors：本 TickFrame actor 行为账本
- changed_scopes：本次 tick 影响了哪些前端读模型

`changedScopes` 是 TickFrameResult 面向前端的刷新摘要。前端按 scope 精准 invalidate：例如战斗事件刷新 `player_info/combat_targets`，world AI 移动刷新 `game_map/enemies`；实时演出由 heartbeat response 的 `presentation` 字段直带，不再存在 `battle_log` State scope。

设计理由：tick 推进是世界时间推进，不等于“全量刷新所有状态”。后端应把结算影响域显式暴露给前端，让前端既能即时同步地图，又不会把刷新策略和战斗播放时序混在一起。

---

## 二、核心设计原则

### 2.1 数据层独立性

Oblivions 子系统拥有完全独立的数据层，不依赖传统模式的 `bra_players` 表：

- 玩家+敌人统一存储在 `bra_oblplayers` 表
- `obl_save_player()` 仅写 `bra_oblplayers`，不同步任何数据到 `bra_players`
- `save_gameinfo()` 在 Oblivions 模式下跳过 `bra_players` 查询
- 所有数据通过 `&$pdata` 引用传递，禁止函数内 `extract()`

**设计理由**：避免与传统模式的数据结构耦合，允许 Oblivions 独立演进字段结构（如 itempara JSON 数组替代 itm0~itm6 42 字段）。

### 2.2 后端只输出事件结构

结构化日志系统的核心原则：后端只负责"发生了什么 + 参数"，前端完全控制视觉呈现（文案、样式、随机化）。

```php
// 后端：只输出事件结构
$obl_log->emit('move.success', 'move', [
    'from_name' => $from_name,
    'to_name'   => $to_name,
]);
```

**设计理由**：
- 视觉呈现是前端职责，后端不应关心 HTML/CSS
- 同一事件可在不同前端上下文呈现不同样式（日志区 vs Toast）
- 前端可独立迭代文案，无需后端发版

### 2.3 玩家操作与战斗处理互斥

由战斗状态机直接管辖（替代旧的 `obl_tick_pending_npc` 全局标志，该标志已移除）：

- 玩家提交战斗指令并结束 → `PLAYER_TURN → PROCESSING`（Command Bus `obl_command_after_dispatch()` 触发 `player_acted` 事件）
- tick 推进 / NPC 回合处理 → 在 `PROCESSING` 状态下允许（Tick Orchestrator `obl_tick_orchestrator_after_command()` 中调用 `obl_battle_state_refresh()` 刷新时间戳）
- 后端 Command Bus `obl_command_gate()` 检测 `PROCESSING` 状态 → 拒绝提交战斗命令的命令（返回 `BATTLE_BUSY`，`battle.submit_turn` 自身例外）
- 前端 `commandQueue` 的 PROCESSING 锁（`_checkLocks` 中检查 `oblBattleState === 'PROCESSING'`）仅拦截 `COMMAND_REGISTRY` 中 `advancesTick=true` 的命令；`isLocked` 只表示 HTTP 请求互斥，战斗命令另受 `PresentationScene.phase` 局部水位约束（详见 [vex-vue/CODEBASE.md §3.1](../vex-vue/CODEBASE.md#31-五层并发锁)）
- 下一顺位判定 → `battle_manage_queue()` 集中确定 next 并写入 `bra_oblbattle_state.next_pid`：下一位是玩家则 `player_turn` 事件 → `PLAYER_TURN`，仍是 NPC 则 `self_loop` 事件刷新时间戳

**设计理由**：全局标志是单布尔值，无法区分多战场。状态机按 qid 分离，支持多战场并发，且 qid 销毁后自动清理状态。

> 旧的 `obl_command.php` 中段名 `[C2b]` / `[C2d]` / `[F-bs]` 仍存在于 deprecated 兼容路径中，新前端走 Command Bus（`obl_command_bus.php`），不经过这些段。

### 2.4 响应直带 PresentationBatch

- command/heartbeat 在领域 COMMIT 前冻结本请求 render events，并在同一事务内推进房间级 `obl_presentation_head_seq`。
- COMMIT 成功后才把 `presentation.v1` 附加到 HTTP response；回滚不会消耗 batch sequence。
- 前端只在当前 JS runtime 保存 cursor。response 丢失时，后续 `presentation_head_seq` 触发 gap rebase，不请求历史补播。
- 在线演出不再写 mutable JSON，也没有 played/ack 接口。需要回顾或审计时应建设独立 immutable archive，不能参与实时播放正确性。

### 2.5 权威投影与演出投影分离

- `CharacterHub/map/player/combat_targets` 持续接受最新权威快照，不因动画暂停；command/heartbeat 的 changed scopes 进入串行 authority refresh worker，立即合并刷新。
- `MapGrid` 读取 `PresentationSceneStore`；战斗 Runner 只操作表现投影和 ActorRuntime lease。
- stable boundary 只负责 scene rebase、lease reconcile 和 cursor 前移，不再决定网络是否允许刷新。
- `battle_end` 遮罩达到 covered 状态时执行战斗场景向世界场景的 handoff，世界动画可在遮罩下开始。

当前实现已完成双投影闭环：权威 worker 固定按 `player_info -> game_map/enemies -> combat_targets` 更新真实 stores；`PresentationSceneStore.syncAuthoritative()` 在 `playing/rebasing` 阶段只更新 pending authority、不改写可见 snapshot，covered/stable boundary 使用最新 authority 做 rebase，动画期间继续到达的 authority 会在 `finishRebase()` 自动发布。网络刷新时机不再由表现层边界控制。

### 2.6 房间 GET_LOCK + 玩家 flock + 前端 5 层锁

前端 `commandQueue._checkLocks(command)` 提供 5 层细粒度锁；后端先用 MySQL `GET_LOCK('game_state_{groomid}')` 串行化整个房间的 command/heartbeat，再由 Command Bus 的玩家级 `flock` 防止同一 PID 重入。GET_LOCK 不是事务，取得房间锁后仍必须显式 BEGIN/COMMIT/ROLLBACK。

| 层 | 位置 | 机制 | 释放时机 |
|----|------|------|---------|
| 前端第 1 层：HTTP/冷却 | `commandQueue._locked` / `_cooldownUntil` | HTTP 请求期间 + 后端返回 timer 设置的响应式冷却截止时间 | `try/finally` 末尾 / 冷却计时到期主动清零 |
| 前端第 2 层：itm0 | `inventoryStore.itm0 !== null` | itm0 非空时仅放行 `spec.itm0Allowed=true` 命令 | 玩家整理/丢弃后 itm0 清空 |
| 前端第 3 层：模式 | `battleStore.currentMode` | 探索/战斗模式与命令 `spec.mode` 不匹配时拒绝 | `currentMode` 切换时 |
| 前端第 4 层：演出水位 | `PresentationScene.phase` | 战斗提交要求 caught up；地图位置输入仅在 `rebasing` 时局部锁定 | scene 回到 `idle` |
| 前端第 5 层：PROCESSING | `playerStore.oblBattleState === 'PROCESSING'` | 仅拦截 `spec.advancesTick=true` 命令 | 状态机过渡到 `PLAYER_TURN` 或 `IDLE` 时自动释放 |
| 后端房间锁 | `obl_runtime_acquire_room_lock()` / MySQL `GET_LOCK` | 同一 groomid 的 command 与 heartbeat 串行 | 正常 finally 或 shutdown guard `RELEASE_LOCK` |
| 后端文件锁 | `obl_command_bus.php: obl_command_acquire_lock() flock(LOCK_EX\|LOCK_NB)` | 同一玩家 PID 的独占文件锁 | 进程结束/脚本 exit 时 OS 自动释放 |

**`isLocked` 语义边界**：`isLocked` getter 只包含 HTTP 请求锁，不再把演出、冷却、PROCESSING、itm0 或模式当作全局锁；按钮 `:disabled` 必须使用 `canExecute(command)` 精细化控制。`pendingNpc` getter 仍从 `oblBattleState === 'PROCESSING'` 派生，仅用于 UI 状态提示，不参与 `isLocked`。

> 完整 5 层锁架构与 `COMMAND_REGISTRY` 三维度分类详见 [vex-vue/CODEBASE.md §3.1](../vex-vue/CODEBASE.md#31-五层并发锁)。

**为什么同时保留两种后端锁**：房间 GET_LOCK 覆盖 NPC heartbeat、多个玩家和共享世界写入；玩家 flock 是 Command Bus 内的廉价重入保护。两者都不替代 InnoDB 行锁和请求事务，shutdown guard 必须兜底释放房间锁。

### 2.7 战斗演出架构

战斗日志从产出到消费经历四层，每层职责独立：

1. **后端原料层**（PHP `BattleLogCollector`）
   - emit 时补全名称、HP 快照、边界标记字段（`bl_turn_num`/`bl_round_num`）
   - 按 `event_type` 精细区分 11 种 render 事件，设置默认 `debug` 标记控制前端可见性
   - 不预判前端如何消费，专注提供完整的原始事件结构

2. **前端导演层**（`battle-director-v2.ts`）
   - 同步纯函数，输入 battlelog.v2 events → 输出 `BattlePlayScriptV2`
   - 按 `action_uid` 聚合 action、delivery、joined、effects 与 action_end → 构建分层段（round_intro/turn/battle_end/system）
   - 不涉及网络、不涉及 DOM、不涉及组件状态

3. **前端播放计划层**（`planPlaybackV2()`）
   - 将语义脚本转成 `BattlePlaybackPlan` / `PlaybackStep[]`
   - 明确准备地图、action delivery、动态成员准备、动作动画、清场、文本和伤害残留的顺序与等待策略

4. **前端执行层**（`battle-playback-runner.ts` + `battle-actor-executor.ts` + 组件）
   - Runner 执行 playback steps
   - ActorExecutor 执行单 actor 动画 promise
   - 组件只呈现状态，不承担时序推理

**约束**：command/heartbeat response 生产 batch 与前端消费队列不互斥；同一 JS runtime 按 `batch_seq/event_seq` 去重和顺序消费，gap 时权威 rebase，不读取 mutable 文件队列。导演、计划、执行层均应保持幂等；动画排序不靠组件临时事件串联。

### 2.8 区域切换日志拆分

区域切换（无论前进还是回退）统一拆分为三条独立日志：
1. `move.region_leave` — 离开当前区域
2. `move.region_enter` — 进入目标区域（含区域描述）
3. `move.tile_desc` — 落脚格描述（复用已有 ID）

**设计理由**：这样"从 A 出来"和"到了 B"是两个独立事件，语义更清晰。

### 2.9 战斗状态机简化

#### 2.9.1 玩家战斗模式（action 字段）

```
normal（探索）←→ battle（战斗）
```

- **prebattle 取消**：玩家点击敌人 → 纯前端确认界面（"是否攻击？"）→ 确认后直接提交 `battle.start`，后端直接进入 `action='battle'`
- **ended 取消**：模态框播放完自动关闭，关闭后刷新状态决定去留

**设计理由**：减少中间态，降低状态机复杂度。前端确认界面承担了 prebattle 的确认职责，无需后端状态。

#### 2.9.2 战场状态机三态（obl_battle_state 字段）

`action` 字段只区分"是否在战斗"，但战斗内部还有三态流转，由独立的 [`bra_oblbattle_state`](../include/game/battle_state_machine.func.php) 表管理（按 qid 分离，支持多战场）：

```
IDLE ──battle_start──→ PROCESSING（队列创建即 PROCESSING）
                          │
                          ├── player_turn ──→ PLAYER_TURN（轮到玩家）
                          │                      │
                          │                      ├── player_acted ──→ PROCESSING（玩家行动后）
                          │                      └── battle_end   ──→ IDLE
                          │
                          ├── self_loop ──→ PROCESSING（NPC 持续行动，刷新时间戳）
                          │
                          └── battle_end ──→ IDLE
```

| 状态 | 含义 | 玩家是否可操作 |
|------|------|---------------|
| `IDLE` | 无战斗 | 探索命令 |
| `PLAYER_TURN` | 玩家回合 | 仅 `battle.submit_turn` |
| `PROCESSING` | 后端处理中（NPC 行动 / 玩家行动已提交未结算） | 拒绝推进 tick 的命令 |

**关键转换触发点**（代码位置见 [CODEBASE.md §6.4.1](./CODEBASE.md#641-战斗状态机三态与转换触发点)）：
- 队列创建（`battle_queue_create_and_init`）：初始为 `PROCESSING`（首顺位是 NPC 时 NPC 先行动；首顺位是玩家时立即切到 `PLAYER_TURN`）
- 玩家提交推进 tick 命令（Command Bus `obl_command_after_dispatch()`）：`PLAYER_TURN → PROCESSING`
- `battle_manage_queue` 检测下一顺位是玩家：`PROCESSING → PLAYER_TURN`
- NPC 行动调度（`obl_tick_phase_battle_npc`）：`PROCESSING → PLAYER_TURN`
- 队列解散（`battle.queue.main.php`）：任意 → `IDLE`

**`self_loop` 转换的设计用途**：NPC 多回合连击时保持 `PROCESSING` 状态并刷新时间戳，避免被超时恢复机制误判为卡死。`obl_battle_state_find_stale` 会检测 `PROCESSING` 状态超过 30 秒的战场并降级到 `PLAYER_TURN`（兜底异常恢复）。

**与 §2.10 命令状态强制过滤的协作**：
- `action='battle'` 时 Command Bus `obl_command_allowed_by_contract()` 仅允许 `battle.submit_turn`（覆盖 `PLAYER_TURN` 与 `PROCESSING`）
- `obl_tick_has_busy_battle()` 检查**任何**战场在 `PROCESSING`，配合 Command Bus gate `BATTLE_BUSY` 拒绝推进 tick 命令（防止玩家在 NPC 行动期间重复提交）
- 二者正交：`action` 是玩家维度的战斗状态，`obl_battle_state` 是战场维度的处理状态

### 2.10 命令状态强制过滤

后端 Command Bus `obl_command_allowed_by_contract()` 强制过滤命令（旧 deprecated 路径仍调 `obl_command_allowed_by_state()`）：
- `action='battle'` 时只允许 `battle.submit_turn`
- 非战斗状态不允许 `battle.submit_turn`（`battle.start` 仍允许）
- 被拒绝的命令 emit `command.rejected` 日志（`obl_error_log`），返回 `COMMAND_NOT_ALLOWED`，不推进 tick

**设计理由**：防止前端在错误状态下提交命令，后端强制兜底。

### 2.11 属性获取接口为技能系统拓展预留

战斗系统的属性获取函数（`obl_get_range` / `obl_get_initiative` 等）采用"基础值 + 补正"模式，阶段一返回固定默认值，未来通过技能系统扩展：

- `obl_get_range($actor_data)`：基础射程 1（近战），未来由武器类型 + 技能补正决定
- `obl_get_initiative($actor_data)`：基础先攻属性 50，未来由技能提供 buff/补正决定

**关键设计原则**：NPC 的属性差异不通过配置文件硬编码，而是通过技能系统实现。例如想让 NPC 有更多射程、更多先攻，就给该 NPC 配置一个增加射程/先攻的技能，而不是在 `enemies_config.php` 中写死属性值。

**设计理由**：
- 技能系统是统一的属性扩展入口，避免属性配置分散在多处
- NPC 与玩家共用同一套属性获取接口，技能效果对双方一致
- 新增 NPC 类型时只需配置技能组合，无需修改属性获取逻辑

### 2.12 战斗执行阶段重构（Tag + combatants 缓存）

**核心变更**：将战斗执行拆为 verify → sort → execute → end 四阶段，引入 Tag 系统和缓存层分离运行时判断与 DB 写入。

**三阶段死亡检测**：
- **预检**（verify 中 `tag_dead` 函数）：首次构建目标标签时从 DB 派生 `dead` tag
- **中检**（`battle_state_middle_check`）：伤害结算后只写缓存（`combatants[pid]` + `tag_mutations[pid]['dead']`），不改 DB state
- **后清**（`battle_main_end`）：actor 死亡检测→state_clear('death')，再遍历 `combatants[pid]=0` 按 reason 调 state_clear（death 时内部设 state=1）

**`combatants` 新语义**：`1`=能继续战斗，`0`=不能。有队列时从队列载入所有成员，无队列时仅自己。`battle_main_end` 消费后传给 `battle_manage_queue`。

**HP 即时落库**：`battle_once_execute` 末尾调 `obl_save_player(both)`，执行中途崩溃时 HP 已写入，state 未更新，恢复后由 hp 检查兜底。

### 2.13 终结技（Finisher）队列排序

`finisher=1` 标记的技能为终结技。前端和后端双重约束：
- **前端**：`addToQueue` 将普通技插入终结技前，终结技已存在时拒绝重复加入
- **后端**：`battle_sort_actions` 在 verify 后 execute 前强制重排：普通技在前，finisher 在后；多个终结技只保留最后一个

### 2.14 新文件必须注册到 obl_bootstrap

Oblivions 子系统通过统一入口 `oblivions/include/core/obl_bootstrap.php` 集中加载所有函数库。

**强制约定**：
- 新增任何 `.func.php` / `.main.php` 文件，必须在 `obl_bootstrap.php` 中注册，按拓扑排序
- 注册时需找到正确的层级：被依赖的文件在前，依赖方在后
- `function_exists + include_once` 双保险模式已废弃，统一走 bootstrap

**设计理由**：
- PHP 是动态语言，函数未定义只在运行时报错，编译期无提示
- 集中注册使依赖关系可见，避免散落的条件 include 导致漏加载

> 当前加载层序见 [CODEBASE.md](./CODEBASE.md#三引导加载bootstrap)。

### 2.15 后端日志 / battlelog 事件必须有前端消费契约

Oblivions 有三套独立的日志系统。普通日志仍按 ID 映射模板；战斗日志已迁移为 battlelog.v2 事件协议，由 DirectorV2 生成演出脚本。

| 日志系统 | 后端 emit 位置 | 前端消费位置 | 契约格式 |
|---------|---------------|------------|---------|
| `obl_log`（结构化日志） | `$obl_log->emit($id, ...)` | `vex-vue/src/data/log-templates.ts` | `{ id: { render(params) { return '...' } } }` |
| `obl_battle_log`（战斗日志） | `combat_log_v2_*()` / `$obl_battle_log->emit(...)` | `vex-vue/src/stores/battle-director-v2.ts`（导演+计划）+ `battle-playback-runner.ts`（执行器）+ `battle-actor-executor.ts`（演员）+ `BattleModal.vue`（模态框） | `battlelog.v2 event -> BattlePlayScriptV2 -> BattlePlaybackPlan -> PlaybackStep -> TextCue/AnimationPlan/EffectVisualPlan` |
| `obl_error_log`（错误日志） | `$obl_error_log->emit($id, ...)` | 前端错误渲染逻辑 | 按 ID 分发渲染 |

**强制约定**：
- 后端新增任何 `obl_log` ID 时，必须同步在对应前端模板文件中添加渲染函数
- 后端新增任何 battlelog.v2 `event_type` / `effect_type` / action 表现语义时，必须同步 DirectorV2 的聚合、text cue、animation plan 或 effect visual plan
- ID 命名使用点号分隔（如 `initiative.roll`），前后端必须完全一致
- 如果该日志不需要玩家演出，应放入 `debug` / `diagnostic` channel，默认不进入 render script

**设计理由**：
- 曾因 `initiative.roll`（后端）vs `initiative_roll`（前端）命名不一致导致静默失败
- 跨层一致性是前后端分离架构的常见坑，强制约定可避免遗漏

---

### 2.16 前端守护进程模型（心跳）

前端是后端游戏刻推进的唯一驱动力。

**两个独立后台节拍，职责分离**：

| 定时器 | 职责 | 间隔 | 与前端业务耦合 |
|--------|------|------|--------------|
| 心跳守护进程 | tick 激活 + 接收本响应 `presentation.v1` | PROCESSING 300ms；其他状态 1000ms | 读取战斗状态选择快/慢档；有 batch 时交给 PresentationInbox |
| NPC 状态轮询 | 前端状态同步（`refreshBattle`） | 1000ms | 拉取权威 `player_info/combat_targets` 并推动稳定状态判断 |

**设计原则**：
- heartbeat 是状态推进接口，必须使用 `POST /phpdts/oblivions/api/heartbeat.php`；后端拒绝 GET
- 心跳不组装 State API 业务快照，但必须接收并入队本次响应直带的 `presentation.v1`
- 频率只做两档：`PROCESSING` 快速推进 NPC / presentation，其他状态降到 1000ms 减少空转请求
- 守护进程使用 `setTimeout` 串行调度，避免上一次 heartbeat 未结束时下一次请求重叠
- 原有 NPC 轮询定时器的隐含双重职责（tick 激活 + 状态同步）被心跳剥离后，变为纯粹的“状态发现”
- 动画播放期间心跳持续不受影响；新 batch 进入 inbox，`refreshBattle` 由 `isProcessingBattle` 防重入保护

**入口**：`oblivions/api/heartbeat.php`，响应 Tick Orchestrator 的 JSON 结果，不进 State API 业务字段组装。

**实施**：`battle.ts` 新增 `startDaemonPoll/stopDaemonPoll`，`App.vue` `onMounted` 启动。

#### 2.16.1 heartbeat → tick 推进完整链路

heartbeat 由 `oblivions/api/heartbeat.php` 显式驱动。该入口加载 Oblivions Runtime 与 Tick Orchestrator，不依赖 `common.inc.php` 的旧请求生命周期：

```
前端 _daemonBeat（PROCESSING 300ms；其他状态 1000ms）
  ↓
POST /phpdts/oblivions/api/heartbeat.php
  ↓
heartbeat.php 加载 Oblivions Runtime 与 Tick Orchestrator
  ↓
obl_tick_orchestrator_heartbeat()
  ↓
检测 obl_pretick < obl_tick ?
  ↓ 是
obl_tick_synchronize()      // 标记已处理（obl_pretick = obl_tick）
  ↓
obl_resolve_tick_events()   // 触发 NPC 行动
  ├─ battle_npc phase → obl_tick_phase_battle_npc → NPC 行动
  │   └─ battle_manage_queue → 状态机切换（PROCESSING → PLAYER_TURN / self_loop / IDLE）
  ├─ idle_npc phase → 非战斗敌人 AI（patrol/aggressive/idle）
  └─ post phase → tick 后处理（预留扩展）
  ↓
NPC 行动后 obl_tick_request_advance() → 末尾 obl_tick_advance()（obl_tick++）
  ↓
oblgame 持久化 obl_tick/obl_pretick
  ↓
下次 heartbeat 检测 obl_pretick < obl_tick 仍成立 → 继续 NPC 行动循环
```

**关键设计点**：
- 心跳请求**不携带任何业务参数**，只通过 POST 触发 Tick Orchestrator
- 后端通过 `obl_pretick < obl_tick` 判断是否有未处理 tick，与请求来源无关
- NPC 多回合连击时，每次心跳推进一个 NPC 行动，通过 `obl_tick_request_advance` 自驱动下次心跳继续

#### 2.16.2 PROCESSING 的实际生命周期

由于 PROCESSING 下心跳以 300ms 快速驱动，PROCESSING 通常在 **300-600ms 内**（一到两个心跳周期）被处理完：

| 场景 | PROCESSING 持续时间 | 前端感知 |
|------|---------------------|---------|
| 单次 NPC 行动 | 300-600ms | 1 秒轮询大概率看不到，已切回 PLAYER_TURN |
| NPC 多回合连击（self_loop） | N × 300ms | 1 秒轮询可能看到 PROCESSING |
| 服务器高负载 / 数据库慢 | 不定 | 1 秒轮询看到 PROCESSING，启动轮询循环 |

**前端实际感知 PROCESSING 的场景**：
1. 玩家执行 `battle.submit_turn` 后立即拉取 `player_info`——可能在守护进程推动 NPC 行动前看到 PROCESSING（这是 PROCESSING 锁的主要触发场景）
2. NPC 多回合连击时 1 秒轮询拉取到 PROCESSING

**设计含义**：
- 前端 PROCESSING 锁（`commandQueue` 第 5 层，仅拦截 `COMMAND_REGISTRY` 中 `advancesTick=true` 的命令）实际是兜底机制，触发概率低但必要
- 前端 1 秒轮询拉取 player_info 是“状态发现”，不是“驱动后端”——这是常见误解
- 真正驱动后端 NPC 行动的是 heartbeat，而非 1 秒轮询

### 2.17 Pre-battle 规划与正式队列执行

`battle.start` 在创建正式战场前允许执行 utility/空投送动作，但第一项成功 hostile action 的合法角色目标必须先定义 initial roster，再创建队列并按真实 initiative 顺序结算。旧“Phase 0 无队列直接结算 hostile action”的模型已经废弃。

| | Pre-battle transaction context | 正式队列执行 |
|---|---|---|
| **触发条件** | `battle.start` 从排序后动作链开头扫描 | initial roster 创建成功后 |
| **队列** | 尚未创建；只允许 utility 或 `empty_policy=execute` 的空投送暂存结果 | actor + 首个 hostile action 合法角色目标共同建队 |
| **Turn/Round** | 尚无真实 initiative，preview 只能返回 `pending_initiative` | 按实际 `myorder` 产生 round/turn 边界 |
| **失败语义** | 最终无成功 hostile action 时整条命令 rollback-only | 单目标业务失败独立 skipped；基础设施失败回滚请求 |
| **后续目标** | 不提前吸收整条动作链目标 | 后续首次接触角色走 Participation append-tail |

**设计理由**：initial roster 必须参加同一次真实先攻；若 hostile action 在无队列阶段先结算，就会绕过 initial AOE 的队列顺序和参战语义。`BattleLogCollector` 在队列建立前可以保留 `bl_turn_num/bl_round_num=null` 的 pre-battle utility/system 事件；队列创建后由 `setRoundNum(0)+nextTurn()` 进入正式 round/turn 分段。

### 2.18 前端导演系统概念

**为什么需要导演层**：
- 后端 emit 的事件是扁平的（按执行顺序排列的日志条目列表），每个条目只携带当前事件的信息
- 前端播放需要"上下文"——需要知道哪些条目属于同一个回合、哪些 effects 归属同一个 action、战斗何时开始何时结束
- 旧方案是播放器兼任导编职责：在播放过程中实时判断 `action_id=xxx` 来决定渲染方式，导致 `BattleModal.vue` 逻辑膨胀

**导演层与后端原料层的契约**：

后端负责提供"足够原始且完整"的原料（名称、HP 快照、边界标记），导演层负责将这些原料排列成具有层次结构的"剧本"（PlayScript）。

```
后端 emit battlelog.v2 render 事件序列：
  round_start        ← 一轮开始边界
  turn_start         ← 一回合开始边界（含 actor 快照）
  action_start       ← 动作开始（含 action_uid / actor / targets）
  action_delivery    ← ResolvedAim 投送 cue，可有多个
  combatant_joined   ← 动态成员入列，先于该成员 effect
  effect_applied     ← 效果应用（含 action_uid / effect_type / target / delta）
  action_end         ← 动作结束（含 action_uid / success / reason）
  combatant_cleared  ← 参战者退场
  battle_end         ← 战斗结束

导演 directV2() 按 action_uid 聚合为 BattlePlayScriptV2：
  segments:
    - round_intro 段（round_start）
    - turn 段（turn_start + 聚合的 actions[] + notices[]）
    - battle_end 段（battle_end）
```

**关键设计决策**：
1. **导演层是纯同步函数**：不涉及网络请求、不涉及 DOM。`directV2(events) → BattlePlayScriptV2` 的纯函数签名使其可测试、可复播、可调试
2. **段 (Segment) 是播放的最小组织单位**：每个段包含段类型（`round_intro`/`turn`/`battle_end`/`system`）、段元数据（轮数/回合数/行动者）、以及该段内的有序 actions 和 notices
3. **action_uid 驱动聚合**：`action_start` 创建 pending action，`effect_applied` 按 `action_uid` 归属效果，`action_end` 完成聚合并 flush 到段。悬空 pending（无 `action_end`）在循环结束后按顺序归入对应 turn 段
4. **边界信号驱动分段**：`round_start` → 创建 round_intro 段；`turn_start` → 创建/复用 turn 段；`battle_end` → 创建 battle_end 段。不依赖 phase 字符串理解
5. **动画/视觉由导演层预决策**：`decideActionAnimation()` 在 `action_start` 时生成 `ActionAnimationPlan`，`deriveActionAnimationFromEffects()` 在 `effect_applied` 时根据效果修正（如 move 效果改写为 move 动画、多目标 damage 改写为 area_burst）。演员层只执行预决策结果
6. **文本由导演层预生成**：`buildActionText()` / `buildEffectText()` 生成已转义的 `TextCue`（含 html + tone），组件直接渲染不再做字符串拼接
7. **计划层独立于导演层**：`planPlaybackV2(script)` 把 script 拆解为 `PlaybackStep[]`，每个 step 携带 `awaitPolicy`（none/completion/duration）和 `timeout`。计划层与导演层同文件但职责独立

**与旧 v1 导演的差异**：
- 旧 v1 用 `pairPrePost` 栈算法匹配 `once_execute_pre` / `once_execute_post`；v2 用 `action_uid` 直接聚合 `action_start` / `effect_applied` / `action_end` 三元组
- 旧 v1 段类型含 `phase0` / `ambush_battle_end`；v2 段类型精简为 `round_intro` / `turn` / `battle_end` / `system`
- 旧 v1 依赖 `bl_segment_flag` 驱动分段；v2 依赖 `event_type` 本身（`round_start` / `turn_start` / `battle_end` 即边界信号）
- 旧 v1 无独立计划层；v2 引入 `planPlaybackV2` + `battle-playback-runner.ts` + `battle-actor-executor.ts` 三件套，把时序推理从组件中彻底剥离

**调试便利**：开发模式下 PresentationInbox/播放器消费 batch 时挂载 `window.__battleScriptV2`（导演产物）、`window.__battleRawEventsV2`（原始事件）、`window.__battlePlaybackPlanV2`（播放计划）和 `window.__presentationBatchV1`，浏览器控制台可直接检查各层产物。

**旧逻辑清理**：导演层替代了以下旧实现——`groupByEncounter`（由 `extractNpcPidFromScriptV2` + `BattleSegmentV2` 替代）、`playBattleLogGroup`（由 `playScriptV2` → `planPlaybackV2` + `runBattlePlaybackPlan` 替代）、`buildPlayContext`（后端 v2 emit 已带名称/HP 快照）、`BATTLE_TEMPLATES` / `KIND_TEMPLATES`（由导演层 `buildActionText` / `buildEffectText` 生成的 `TextCue` 替代）、`renderBattleLogEntryHtml` / `renderDirectedEntryHtml`（由 `BattleModal.vue` 直接播放 text cue 替代）。

### 2.19 道具 Tag 系统（性质描述 Tag + 系统钩子 Tag）

道具通过 `item_table.tags` 字段持有两类 Tag，存储在同一数组中：

| Tag 类别 | 服务系统 | 示例 |
|---------|--------|------|
| 性质描述 Tag | 合成系统：配方的大类素材匹配 | `tag_sharp`, `tag_combustible`, `tag_raw_food`, `tag_tool_cooking`, `tag_forge` |
| 系统钩子 Tag | 装备/使用/地图交互系统入口判断 | `tag_equippable`, `tag_usable`, `tag_poi_interactive` |

**关键设计原则**：
- `itmk` 回归"物理分类 + 装备槽位类型"职责，不再承担"是否可装备/可使用"的判断
- 各系统入口统一查 Tag，不查 itmk——装备系统只看 `tag_equippable`，使用系统只看 `tag_usable`，POI 交互只看 `tag_poi_interactive`
- `tag_usable`（属性层）与 `use_effect`（实现层）分层：前者标识"可使用"，后者记录具体效果函数
- 所有装备类道具 **显式标注** `tag_equippable`，不依赖 itmk 隐式判断（包括 TK 类可装备道具如撬棍）

### 2.20 合成确认函机制

合成采用"确认函"交互模式，不是"搜索引擎"：

核心规则：
- 不放素材在素材池里，什么都看不到
- 配方列表全部揭示——所有配方天然可见（取消"已发现/未发现"机制），通过资源可达性软锁自然限制实际可合成范围
- 指向性判断：遍历所有配方，找 `materials` 完全匹配当前素材池的
  - 0 匹配 → 不亮
  - 1 匹配 → 亮灯（可合成）
  - 2+ 匹配 → 不亮（指向不明确）
- 所有放置的素材必须都被配方消耗，多放也算不匹配
- 工作台是素材，不是独立过滤维度

**素材匹配三维度**（优先级 `item_id` > `itmk` > `tag`）：

| 维度 | 语义 | 适用场景 |
|------|------|---------|
| `item_id` | 精确匹配指定道具 | 配方需要特定道具（`cloth × 3`） |
| `itmk` | 匹配道具大类 | "任何金属类素材都行"（`itmk='MT'`） |
| `tag` | 匹配物理性质 | 跨类别性质匹配（`tag_sharp` 匹配锐器） |

**软锁的本质**：通过资源可达性自然限制实际可合成范围，不拦截合成本身，也不隐藏配方。玩家不到铁砧 POI → 工作台素材不可用 → 需要铁砧的配方实际无法合成（但配方仍可见，玩家可查看 materials 了解需求）。配方列表按"可合成/素材不全/无关联素材"三组视觉分类（前端关联匹配，非机制隐藏）。

### 2.21 工作台即素材模型

合成系统的所有输入都是素材，没有"工作台选择"独立步骤。工作台/工具就是 `materials` 里 `consume='none'` 的素材：

| 来源 | 标识 | 可用条件 |
|------|------|---------|
| 被动技能 | `passive:innate_t0` | 永久可用（P0 硬编码 `tool_level=0`） |
| 猫身上 | `cat:{id}` | 猫在身边时可用（P0 未实现） |
| 地图格 POI | `poi:{iaid}` | 玩家站在 `mechanic='craft_source'` 的 POI 上 |

**工作台素材的实时计算**：每次合成时实时计算，不存储在 oblpara。POI 工作台通过 `mechanic='craft_source'` + `mechanic_value`（指向 item_id）映射，通过 item_table 的 tags/itmk/tool_level 参与匹配。

### 2.22 use_effect 分发框架

道具"使用"行为通过效果函数分发，模式与 POI 的 `obl_mechanic_*` 对齐：

```
item_table.use_effect = 'restore_sp'
                         ↓
item_use_effect_restore_sp($item, &$pdata)  ← 框架自动分发
```

**框架本身是纯分发器，不预定义任何具体效果**。效果函数由归属系统自行注册：

| use_effect | 归属系统 |
|-----------|---------|
| `restore_sp` / `restore_hp` | 食物经验系统 |
| `cure_bs` | 健康系统 |
| `gain_resistance` | 被动技能系统 |

### 2.23 道具数据三层分离

道具/POI 的"游戏逻辑初始值"、"运行时实例状态"、"展示文案"分属三层，不可混存：

| 层 | 位置 | 内容 | 权威方 |
|----|------|------|--------|
| 前端文案层 | `vex-vue/src/data/*-locale.ts` | name/desc | 前端 |
| 后端模板层 | `gamedata/item_table.php` 等 | itmk/itme/itms/itmsk/itmpara/use_effect 等初始值 | 后端 |
| 后端实例层 | `itempara` / `bra_oblmapitem` / 装备槽字段 | 运行时状态（模板 ID + 运行时字段完整保留） | 后端 |

**七字段全部是实例状态**：`itmid`（模板索引，不变）除外，`itm`/`itmk`/`itme`/`itms`/`itmsk`/`itmpara` 均可能在游戏进程中偏离模板初始值（改名/改造/强化/涂毒/腐蚀/附魔等），持久化层必须完整保留。

**itm 字段语义调整**：从"模板名称"改为"自定义名称"。拾取时留空，前端渲染时空值查 locale、非空值直接用。这样改名机制可后续启用而不破坏现有数据。

**装备字段同步调整**：装备槽独立保存模板 ID（`wepid`/`wep2id`/`arbid`/`arhid`/`araid`/`arfid`/`artid`），原 `wep`/`arb` 等名称字段同样改为自定义名语义，空值由前端通过模板 ID 查 locale。

**设计理由**：
- 与 §2.2（后端只输出事件结构）理念对齐——文案是展示职责，归前端
- 日志系统已示范此模式（`log_id + params` → `log-templates.ts` 渲染），道具/POI 对齐
- 支持本地化（多语言只需替换 locale 文件）
- 前端可独立迭代文案，无需后端发版

> 详细迁移方案与影响范围见 [道具数据三层分离-设计案](./docs/道具数据三层分离-设计案.md)。

### 2.24 itm0 缓存槽与事件解耦

`itempara[0]` 作为新增道具（拾取 / 合成产物 / 未来卸装备）的中转缓存槽（itm0）。所有新增道具**先入 itm0，再整理入背包**，由此确立两个设计约束。

**函数独立性**：新增道具的"放入 itm0"与"整理入背包"是两个独立流程，对应两个独立函数，互不内嵌：

| 流程 | 函数 | 复用场景 |
|------|------|---------|
| 放入 itm0 | `obl_put_item_to_itm0` | 拾取 / 合成 / 卸装备 |
| 整理入背包 | `obl_organize_inventory` | 拾取 / 合成 / 手动整理 |

整理函数只承担"合并堆叠 + 转移 itm0 → 背包"的逻辑，不输出日志；调用方根据返回值决定 emit 哪些事件。这样同一个整理函数可被多种场景复用，且与日志系统解耦。

**事件解耦**：操作成功（道具进入 itm0）与整理结果（成功入背包 / 失败卡 itm0）是独立事件，前端可同时收到分别处理：

| 事件 | 语义 | params |
|------|------|--------|
| `pickup.success` | 捡起成功，道具已进入 itm0（拿在手上） | `{item_id}` |
| `item.to_bag` | 整理成功，itm0 → 背包 | `{item_id}` |
| `organize.fail` | 整理失败，背包满，道具卡在 itm0 | `{item_id}` |

操作成功不隐含整理成功，整理失败也不否定操作成功。前端可同时收到多个事件，分别在日志区 / Toast / 模态框各自呈现（详见 §1.9 Toast 强化提醒机制）。

**itm0 门控**：itm0 非空时玩家被锁定，后端只放行整理与丢弃命令。处理 itm0 是最高优先级——断线重连后 itm0 可能有遗留道具，必须先处理才能继续游戏行为。这避免道具数据在玩家未察觉时丢失。

**合成成功事件只携带 recipe_id**：合成产物是固定配置，前端通过 `recipe_id` 查 locale 即可获知产物。与 §2.2（后端只输出事件结构）和 §2.23（三层分离）一致——产物名称是展示职责，归前端。

**设计理由**：
- 函数独立性让每个流程可单独测试和复用，未来新增"卸装备"流程时只需复用放入 itm0 的函数
- 事件解耦让前端能分别呈现"捡起"和"入背包"两个时刻，整理失败时 Itm0Modal 强制处理（详见 §1.9）
- itm0 门控强制玩家显式处理遗留道具，避免数据丢失风险

> 详细实现方案见 [堆叠功能与合成系统P2重构-设计案](./docs/堆叠功能与合成系统P2重构-设计案.md)。

---

### 2.25 防御性代码约束

防御代码必须有对策，禁止"纯跳过"式死防御。

**死防御定义**：发现异常数据或边缘状态后，仅 `return` / `continue` 跳过当前逻辑，不执行任何对策，让异常数据继续存在或被掩盖。

**禁止模式**：

```php
// ❌ 死防御：发现异常 itms 直接 return，不处理
if ($s === '0' || $s === '') return;

// ❌ 死防御：发现异常 itms 直接 continue，不处理
if ($s === '0' || $s === '') continue;
```

**允许的对策**（任选其一）：

1. **执行修复**：销毁异常数据 / 重新赋值，让数据回到合法状态
2. **emit 错误日志**：通过 `$obl_log->emit('xxx.error', ...)` 上报异常，调用方或前端可感知
3. **返回错误码**：返回 `false` / `null` 让调用方决定如何处理（调用方必须执行对策，不能再次静默跳过）
4. **去除检查**：让异常数据被正常逻辑自然处理（如 `(int)'0'=0` 会被合并逻辑覆盖修复）

**业务检查 vs 死防御的区分**：

| 类型 | 异常来源 | 对策 | 示例 |
|------|---------|------|------|
| 业务检查 | 异常状态有合法语义（玩家操作触发） | emit + return 反馈玩家 | 使用已损坏道具 → emit `use_item.broken` |
| 死防御 | 异常状态理论不应存在（数据完整性问题） | 仅跳过掩盖问题 | 库存查询遇到 itms='0' → continue 跳过 |

**典型场景**：

- 拾取时发现地图道具 itms='0' → emit `pickup.empty_item`（业务反馈，告知玩家什么也没拾取到）
- 使用道具时发现 itms='0' → emit `use_item.broken`（业务反馈，告知玩家道具已损坏）
- 合成匹配时发现已确认匹配的配方不匹配 → emit `craft.fail_no_match`（异常上报）
- 库存查询时发现 itms='0' 的槽位 → 不检查，让 `(int)'0'=0` 被合并逻辑自然覆盖修复

**设计理由**：

- 纯跳过式防御让异常数据在系统中继续传播，问题被掩盖而非解决
- emit 错误日志让运维能定位异常源头，便于排查
- 自然修复（去除检查）让异常数据被正常逻辑消化，无需额外代码
- 业务检查与死防御外观相似但语义不同——前者是玩家操作的合法反馈，后者是数据完整性的掩盖

---

### 2.26 前后端战斗状态同步与窗口期

前端 `currentMode`（UI 状态）与后端 `action`（逻辑状态）在不同步场景下存在**合理窗口期**——这不是 bug，而是设计选择。明确边界有助于避免误判与错误同步逻辑。

#### 2.26.1 窗口期合理性边界

| 场景 | 方向 | 合理性 | 说明 |
|------|------|--------|------|
| 玩家主动攻击时前端先切换 `currentMode='battle'` | 前端比后端**早进入** | ✅ 合理 | 玩家需要装填区才能发起 `battle.start`，UI 必须先切换 |
| 退出战斗时前端完成当前 runtime batch 与 battle-end handoff 后才切 `currentMode='normal'` | 前端比后端**晚退出** | ✅ 合理 | 权威状态已接受；UI 等遮罩交接和局部 handoff 收口 |
| 被动遭遇时后端先切换 `action='battle'` | 后端比前端**早进入** | ✅ 合理 | 遭遇战由后端判定触发，前端通过 `player_info` 跟随 |

**反向不合理场景**（应视为 bug 修正）：
- ❌ 前端比后端**早退出**战斗——前端处理有 bug，应修正同步逻辑
- ❌ 玩家主动攻击时前端比后端**晚进入**战斗——`startBattle` 必须立即切换 currentMode，否则装填区无法显示

#### 2.26.2 三个场景的同步时序

**路径 A：玩家主动攻击**——前端比后端早进入：

```
玩家点敌人
  ↓
battleStore.startBattle() → currentMode='battle'（前端先切换，显示装填区）
  ↓
玩家装填 + 点击执行
  ↓
PreloadArea.onExecute → commandQueue.execute({ command: 'battle.start' })
  ↓
后端收到命令：action='normal'（尚未切换）→ Command Bus gate 允许
  ↓
后端处理 battle.start → 创建队列（状态=PROCESSING）→ action='battle' → 切到 PLAYER_TURN
  ↓
后续 refreshBattle → enterBattleMode（currentMode 已是 battle，仅更新 isPlayerTurn）
```

**路径 B：被动遭遇**——后端先切换，前端跟随：

```
玩家执行 map.move / map.explore / poi.search
  ↓
后端触发遭遇战 → battle_queue_create_and_init → action='battle'，状态=PROCESSING
  ↓
前端 _checkBattleState 拉取 player_info → 看到 action='battle'
  ↓
refreshBattle → enterBattleMode（currentMode 切换到 battle）
```

**路径 C：退出战斗**——前端比后端晚退出：

```
后端 battle_end → action='normal'，obl_battle_state=IDLE
  ↓
command/heartbeat response 同时更新权威状态并把 presentation.v1 放入 inbox
  ↓
battle_end overlay covered
  ↓
PresentationScene rebase + PostCombatHandoff（与结果正文并行）
  ↓
当前 batch、modal closed 与 handoff finished 收口
  ↓
afterAction !== 'battle' → exitBattleMode → currentMode='normal'
```

#### 2.26.3 设计含义

- `currentMode` 反映"UI 应该处于什么模式"，`action` 反映"逻辑上是否在战斗中"——二者在稳定状态下一致，仅在窗口期有合理偏差
- 前端白名单判断应**以前端 `currentMode` 为真值源**（详见 [战斗锁定白名单-设计案](./docs/战斗锁定白名单-设计案.md) §4 决策 5），因为前端 UI 反馈需要即时性，不能等待后端 action 同步
- `battle.start` 在前端归"战斗内"（mode='battle'），在后端归"探索内"（action='normal' 时允许）——两端分类不同但语义自洽：前端按 UI 模式，后端按逻辑状态

### 2.27 Oblivions 独立运行期（Runtime 与 common.inc.php 解耦）

**问题**：旧 `api_v2.php` → `common.inc.php` 路径在读取状态时会隐式装配旧核心 runtime，包括旧输入过滤、旧 game 表生命周期读取、旧 entrypoint 装配。更危险的是，阶段三移除 `common.inc.php` 隐式 tick 解析后，前端曾假设"fetch(player_info) 会顺便结算 NPC / pending tick"，导致 stale state（PROCESSING 残留 / battlelog 读取过早 / 导演无日志）。

**设计**：Oblivions 三个 HTTP 入口（command / state / heartbeat）共用 `obl_runtime_boot($kind)` 装配独立运行期，不加载 `common.inc.php`。Runtime 只装配 Oblivions 需要的：DB 连接、cookie 解析、房间锁、gamevars 同步、logger。旧 `{$gtablepre}game` 表仍作为 Room Registry（房间生命周期），但 Oblivions tick/gamevars 不再读写它。

**收益**：
- 读请求不再有隐式副作用——`state.php` 纯读，绝不推进 tick
- 写命令与 tick 推进在同一 Runtime 内完成，不需要跨入口状态传递
- 前端契约清晰：要推进世界就显式 `heartbeat`，要读状态就 `state.php?scope=xxx`

**未独立的内容**：房间创建（`index.php` / `roommng.func.php`）、游戏 prepare/start 触发（`common.inc.php` / `obl_gamestate_try_prepare`）、玩家激活（`valid.php`）仍依赖旧核心。这些属于 Room / Lifecycle / Spawn 独立任务，不在本设计案范围内。

### 2.28 单房间 Game State 表（{$tablepre}oblgame）与 Room Registry 分离

**问题**：旧 `{$gtablepre}game` 表同时承担房间生命周期（gamestate / winner / winmode / starttime）和 Oblivions 运行期 state（tick / gamevars）。两个字段集生命周期不同：房间生命周期跨越整局，运行期 state 每个 tick 都变。混在一张表导致：
- 纯读请求可能意外触发 gamestate 同步
- 重开局时旧 gamevars 残留可能把 gamestate 改回 stale 值（曾出现 `obl_rs_game()` 因 stale RUNNING 行不执行的 bug）
- tick 频繁写入与 gamestate 偶尔写入竞争同一行

**设计**：分离到 `{$tablepre}oblgame` 表（每房间一张，固定一行 id=1）：
- `tick` / `processed_tick` / `tick_version` 是主字段，不写入 `vars_json`
- `state`（INIT/READY/RUNNING/ENDED）与 legacy gamestate（0/10/20）双向映射（`obl_game_state_from_legacy_gamestate()` / `obl_game_state_to_legacy_gamestate()`）
- `vars_json` 存其余 gamevars，但 `obl_tick` / `obl_pretick` 不写入（由主字段提供）
- `$gamevars['obl_tick']` / `$gamevars['obl_pretick']` 退化为兼容镜像，由 `obl_gamevars_sync_to_globals()` 同步，供领域函数运行期读取

**收益**：
- 纯读用 `obl_gamevars_sync_to_globals(false, false)` 不建表、不写库
- 重开局时 `oblgame` 表被 `obl_game_reset()` 重置，不影响 `{$gtablepre}game` 的房间生命周期
- legacy gamestate 映射保留向后兼容，旧流程读 `$gamestate` 仍能拿到正确值

### 2.29 三入口职责分离（读 / 写 / 推进互不混入）

**问题**：旧 `api_v2.php` 单入口同时承担读状态、写命令、推进 tick、调试 dump 等多种职责。前端容易误以为读接口可以推进世界，后端也难以保证读请求不产生副作用。阶段三后移除 `common.inc.php` 隐式 tick 解析正是这条混淆链路造成的典型风险。

**设计**：Oblivions 正常游玩运行期三条链路完全分离：

| 入口 | 职责 | Runtime kind | tick 推进 |
|------|------|-------------|----------|
| `oblivions/api/command.php` | 玩家写操作（唯一主路径） | `command` | `advancesTick=true` 命令触发 |
| `oblivions/api/heartbeat.php` | 显式 tick 推进 + NPC 行动 | `heartbeat` | 核心职责 |
| `oblivions/api/state.php?scope=xxx` | 纯读状态 | `state` | 绝不推进 |

**核心约束**：
- State API 绝不调用 `obl_tick_orchestrator_heartbeat()` / `obl_resolve_tick_events()` / `save_gameinfo()`
- State API 发现 `processed_tick < tick` 时只返回状态提示，不结算
- 前端需要最新状态时必须 `await oblHeartbeat()` 然后 `await gameApi(scope)`，不能让读接口自己推进
- `ai_dump_save` 等调试写接口不属于纯读，不迁入 State API；已确认 vex-vue 内无实际调用者，作为过时残留不迁移

**收益**：
- 读请求幂等无副作用，可安全重试
- tick 推进只在 heartbeat 入口发生，时序可预测
- 前端契约明确：`gameApi()` 不推进世界，`oblHeartbeat()` 才推进

### 2.30 战斗空间判定与观察规则分层

战斗目标合法性拆为五个互不替代的概念：

1. `obl_get_distance()` 只负责地图拓扑距离，不读取技能、AP、fog 或战斗状态。
2. `combat_range_resolve_*()` 是五种 range mode 的唯一解析入口，静态配置只来自 `combat_skill_config.php`。
3. AP calculator 对具体目标报价；任何 tag、preview 或前端都不得根据 calculator 名称反推另一套费用公式。
4. `combat_observation_decide()` 独立判断 tile/character 是否可被当前 controller 获取。`controller_known` 对玩家读取房间 fog，对 NPC 保留其自身 perception 规则。
5. `combat_spatial_decide()` 组合距离、基础射程、预扣前 planned wallet 与 AP 报价，供 preview、projector 和 execute 共用。

战斗动作在 verify 时按预扣前 wallet 生成报价。execute 可以重验位置、路径、通行和占用等易变事实，但不得使用已经扣款后的 `actor.ap` 重算本 action 的可负担范围。

`combat.preview_targets` 是显式 tile/pid 瞄准的批量只读投影。前端只负责展示 `selectable/reason/distance`，不自行复制 occupied、range、AP 或 observation 规则。`combat.can_engage` 使用 actor-owned、CD/AP-aware 的 move+attack planner，不再使用 `max_attack_range + move_power` 近似。

---

## 三、缓存目录结构

Oblivions 子系统的运行时缓存文件统一存储在 `oblivions/cache/` 下，按用途分子目录。具体目录结构和文件命名规范见 [CODEBASE.md §2](./CODEBASE.md#二目录结构)。

**设计原则**：
- 缓存文件由后端 PHP 运行时生成，与前端代码彻底解耦
- 每个 `*_persist` 函数和锁文件路径都有 `is_dir + @mkdir` 保护，避免目录缺失导致 bug
- 游戏重置时（`rs_game()` 钩子）自动清理，日常依赖条目上限自然轮转
- `.htaccess` 防止直接访问（锁文件有 `die` 保护，但 json/jsonl 文件可被直接读取）

---

## 四、战斗系统（Combat System）

### 核心概念

**CombatContext**：单 action 执行上下文，封装 actor/battle_cache 引用、ResolvedAim、一次捕获的 ResolutionTargetSet、当前目标 effects/snapshot、target results、resource/delivery 状态。

**Pipeline 管道**：`AimResolver -> ResolutionTargetCapturer -> foreach TargetResolutionUnit`。每个目标从规则、Participation、SAVEPOINT、effect、post-check 到 persist 完整结束后才进入下一个目标，不再由多个 stage 分别遍历整组 targets。

**Participation**：角色目标被分类为 `member/joinable/left/other_battle/blocked`。joinable 在 effect 前通过 `battle_queue_append_tail()` 以 `done=0` 追加当前 qid 末尾；unsafe delete-and-insert join 已删除。

**AP Wallet 模型**：verify 阶段维护 `pending_ap_spent` 计数器，按排序后顺序累计检查 AP。通过的 action 写入 `_ap_cost` 字段，execute/persist 从 action 读取（不重算）。

**Range / Spatial 模型**：`combat.range.php` 统一解析 fixed/inherit/additive/capped_additive/move_power；`combat_spatial_decide()` 使用预扣前 AP wallet 和真实 AP calculator 对具体目标判定。move 的 preview、planned projector 与真实 effect 必须消费同源报价。

**Observation 模型**：技能通过 `aim.observation` 声明 `none/revealed/controller_known/detected/visible`。玩家不能通过直接 API 瞄准未揭示 tile 或未发现 PID；同一 qid 的有效 member 继续由 roster 授权。不存在 PID 与未发现 PID 对外返回同形 `TARGET_NOT_VISIBLE`。

**失败分级**：Aim/配置失败是动作失败；单目标规则、Participation 或可恢复 effect 失败通过目标 SAVEPOINT 回滚后记为 skipped；actor 级终止中断剩余目标和动作；SQL/PHP 异常回滚整条请求。

**Tag 纯读约束**：Cat A（每次重算）+ Cat B（从 tag_mutations 读）均不写 mutation。mutation 只由 post_check/effect applier 写入。

**最新状态硬约束**：CapturedResolutionTargetSet 冻结身份和 capture facts，不冻结角色属性。每个目标轮到时重新绑定本命令内存/锁定后的最新角色状态；self 继续引用 actor。

### 入口与切换

已有队列中的统一推进入口是 `combat_dispatch($mode, &$actor, $actions, $extra)`，当前模式为 `player_turn` / `npc_turn`。首次进入战斗由 `combat_start_battle(&$actor, $actions)` 负责建队列。

`obl_config.php` 的 `combat_engine` 字段仅作为历史键保留，不再控制新旧系统切换。出口调 `battle_manage_queue` 推进队列状态机（策略 B：复用不重写）。

### 技能钩子约定

技能配置在 `gamedata/combat_skill_config.php`，钩子文件在 `gamedata/combat_skills/skill_{act_id}.php`。

钩子函数签名：`skill_{act_id}_execute(CombatContext $ctx): void`

钩子内调 `$ctx->declareEffect($type, $payload)` 声明 current target 效果。禁止直接改 actor_data / battle_cache / tag_mutations、查询任意 PID 或调 `obl_save_player()`；move 也必须由 effect applier 写入。

---

**文档结束。** 代码库参考手册见 [CODEBASE.md](./CODEBASE.md)。
