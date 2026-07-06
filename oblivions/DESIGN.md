# Oblivions 子系统 — 概念与设计要点

> AI 智能体介入项目前必读。本文档解释 Oblivions 子系统的关键概念、核心设计原则和跨任务沉淀的设计思路。
> 代码库参考手册：[CODEBASE.md](./CODEBASE.md) | 项目文档总入口：[AGENTS.md](../../AGENTS.md)

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
- itm0 是新增道具（拾取/合成产物/未来卸装备）的中转槽，所有新增道具先入 itm0 再整理入背包；itm0 非空时玩家被锁定，仅 `obl_organize` / `obl_discard` 命令可用（详见 §2.24）
- 道具对象的 `itmid` 是模板 ID（如 `rusty_pipe`），地图实例主键是 `bra_oblmapitem.iid`

> 道具对象七字段规范与 JSON 示例见 [CODEBASE.md §3.1](./CODEBASE.md#31-bra_oblplayers-玩家敌人统一数据表)。

### 1.7 游戏刻 (tick) 与推进驱动

- 游戏刻存储在 `$gamevars['obl_tick']`，`$gamevars['obl_pretick']` 标记已处理到的刻
- **前端心跳是后端 tick 推进的唯一驱动力**：前端守护进程 200ms fire-and-forget 调用 `api_v2.php?action=heartbeat`，触发 common.inc.php 末尾检测 `obl_pretick < obl_tick` 并执行 `obl_resolve_tick_events($delta)` 调度 NPC 敌人行动
- **tick 推进的两种触发源**：
  - 玩家提交推进 tick 的命令（`move` / `obl_explore` / `obl_search` / `obl_battle_start` / `obl_battle_action`）→ `obl_command.php` [F] 段 `obl_tick_advance()`
  - NPC 行动后通过 `obl_tick_request_advance()` 请求推进 → 调度器末尾 `obl_tick_advance()`，下次心跳继续处理
- **玩家操作与 NPC 回合互斥**：由战斗状态机管辖，PROCESSING 状态时拒绝推进 tick 的命令（[C2b]，防止玩家在 NPC 行动期间重复提交）

> 完整链路（heartbeat → common.inc.php → tick 推进）与 PROCESSING 实际生命周期详见 [§2.16 前端守护进程模型](#216-前端守护进程模型心跳)。

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

### 1.10 战斗日志 (Battle Log) 与 played 标记机制

**与 obl_log 分离的第二套日志系统**，专门记录战斗细节（每一步动作），obl_log 只存战斗摘要（`battle.start`/`battle.end`）。

| | obl_log（结构化日志） | obl_battle_log（战斗日志） |
|---|---|---|
| **存储内容** | 探索/移动/拾取/战斗摘要 | 战斗内每一步动作（攻击/反击/先攻判定/逃跑） |
| **全局变量** | `$obl_log`（`OblivionsLogger`） | `$obl_battle_log`（`BattleLogCollector`） |
| **持久化文件** | `oblivions/cache/logs/obl_log_{groomid}_{pid}.json` | `oblivions/cache/battles/obl_battle_log_{groomid}_{pid}.json` |
| **API 端点** | `obl_log` | `battle_log` |
| **前端用途** | 日志区渲染 + Toast 触发 | 战斗模态框播放 + 碰撞动画 |

**phase 细分与原料补全**：

后端 emit 已从粗粒度 4-phase 细分为 12+ 事件类型 phase（`initiative_roll` / `once_execute_pre` / `once_execute_post` / `flee` / `combatant_cleared` / `battle_end` / `ambush_battle_end` 等）。每个 phase 对应明确的最小参数集：消除占位符（未提供字段记为 null）、消除 extra 滥用（所有字段为正式字段）、补全名称和 HP 快照（前端无需查 API）。

**render/debug 分离**：

每条 emit 携带 `debug` 布尔字段，由 phase 级默认映射表控制（如 `queue_create` / `actor_state_check` / `queue_rebuild` 默认 debug=true）。`obl_battle_log_load` 新增 `$includeDebug` 参数，前端轮询时默认 `false`，只获取渲染原料，减小 payload。debug 条目保留在后端文件中但不传输。

**边界标记字段**：

每个条目自动附加三个边界标记字段：
- `bl_turn_num` — Turn 计数（null=Phase 0/尚未开始，1+=第 N turn），由 `battle_hook_turn_start` 递增
- `bl_round_num` — Round 计数（null=Phase 0 无队列，0+=第 N round），从 DB `oblbattle_state.round_num` 同步
- `bl_segment_flag` — 段边界信号（`round_start`/`turn_start`/`battle_end`/`ambush_battle_end`/null），由 phase 自动映射

这些字段供前端导演系统进行分层分段编排，不依赖 phase 字符串推断。

**played 标记机制**：

```
后端 emit battlelog（played=0）
  → obl_battle_log_persist() 追加到文件，分配 log_id，played=0
  → 命令响应只返回 {}（不再附带 battlelog 字段）

前端 fetchAndPlayBattleLog()
  → gameApi('battle_log') → 返回 played=0 的条目（已过滤 debug=true）
  → BattleDirector.direct(entries) → 编排为 PlayScript
  → playScript(script) → 逐段执行
  → POST mark_battle_log_played.php 标记 played=1
```

> BattleLogEntry 字段结构见 [CODEBASE.md §4.5](./CODEBASE.md#45-battle_log-战斗日志未播放条目)。

### 1.11 错误日志 (Error Log)

与 `obl_log` / `obl_battle_log` 物理隔离的第三套日志系统，专门记录后端异常和命令拒绝事件：

- **全局变量**：`$obl_error_log`（`OblivionsErrorLogger` 实例）
- **持久化**：`oblivions/cache/logs/obl_error_{groomid}_{pid}.json`
- **emit 签名**：无 `logcategory` 参数（区别于 `$obl_log->emit($id, $logcategory, $params)`）
- **前端使用**：前端按 ID 分发渲染，常用于 Toast 错误提示
- **兜底保护**：`obl_command.php [A0]` 注册 `register_shutdown_function`，PHP fatal error 时输出 JSON 错误而非 HTML 500；前端 `submitCommand()` 检测非 JSON 响应时返回 `SERVER_ERROR`

**设计理由**：与结构化日志分离存储，避免错误日志污染正常日志流；独立裁剪策略，错误日志不参与正式日志的 200 条上限计数。

### 1.12 Tag 系统（A/B 分类）

战斗目标状态通过 Tag 统一描述。分两类：

**Category A（主视角相关）**：`self`（目标是自己）、`out_of_range`（超出射程）。每次从当前 actor/target 重算，不缓存。

**Category B（绝对状态）**：`dead`（`state=1`）、`escaped`（已逃跑）、`hidden`（隐身）。通过 `$battle_cache['tag_mutations'][pid]` 缓存，同一 `battle_main` 调用内跨 action 可见，随 cache 销毁自动清零。

**配置驱动规则匹配**：`target_rules.require`（白名单）和 `target_rules.forbid`（黑名单），在 `battle_execute_verify` 中对标签集做匹配，失败时 emit 日志不执行。

### 1.13 战斗入口 (Battle Entry)

`battle_entry_dispatch` 是唯一战斗入口，采用三层分离：入口调度（`battle.entry.php`）→ 动作执行（`battle.main.php`）→ 队列管理（`battle.queue.*.php`）。

**3 种触发模式**：

| 模式 | 触发源 | 队列 |
|------|--------|------|
| `ambush` | 玩家/NPC 突袭 | 后补票建队列（先执行动作，后建队列） |
| `player_turn` | 玩家命令 | 已有队列中推进 |
| `npc_turn` | tick 结算 NPC 回合 | 已有队列中推进（允许空动作） |

**核心约束**：
- 所有触发源不做任何合法性判断，只传 raw `$actions`
- actions 解析/校验统一由 dispatch 内部完成
- 目标合法性（存在/射程/死亡等）由战斗执行阶段的 Tag 系统拦截

**队列生命周期后处理**：`battle_manage_queue` 返回后，调用方通过 `result.disbanded` 区分两条清理路径——解散时调 `battle_state_clear`（退队列、清 bid/action、AP 回满），存活时由 step 6 prepare 为下一顺位者恢复 AP 并保存。前者是"战斗结束打扫干净"，后者是"下一个人准备上场"，互不重叠。

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

- 玩家提交战斗指令并结束 → `PLAYER_TURN → PROCESSING`（[C2d] 过渡，`player_acted` 事件）
- tick 推进 / NPC 回合处理 → 在 `PROCESSING` 状态下允许（[F-bs] 刷新时间戳）
- 后端 [C2b] 检测 `PROCESSING` 状态 → 拒绝提交战斗命令的命令
- 前端 `commandQueue` 第 5 层 PROCESSING 锁（`_checkLocks` 中检查 `oblBattleState === 'PROCESSING'`）仅拦截 `COMMAND_REGISTRY` 中 `advancesTick=true` 的命令；`isLocked` 只含 HTTP/演出两层全局锁，`pendingNpc` 仅用于 UI 状态展示（详见 [vex-vue/CODEBASE.md §3.1](../vex-vue/CODEBASE.md#31-五层并发锁)）
- 下一顺位判定 → `battle_manage_queue()` 集中确定 next 并写入 `bra_oblbattle_state.next_pid`：下一位是玩家则 `player_turn` 事件 → `PLAYER_TURN`，仍是 NPC 则 `self_loop` 事件刷新时间戳

**设计理由**：全局标志是单布尔值，无法区分多战场。状态机按 qid 分离，支持多战场并发，且 qid 销毁后自动清理状态。

### 2.4 played 标记机制替代响应内嵌

战斗日志采用"持久化 → 前端拉取 → 标记"的统一单路径流程，替代"命令响应附带 battlelog"的双路径方案：

- 后端 emit battlelog 后持久化到文件（`played=0`），命令响应只返回 `{}`
- 前端通过 `battle_log` API 拉取未播放条目，播放后调 mark 接口标记 `played=1`
- `played=1` 的条目保留在文件中作为历史记录，游戏重置时清理

**设计理由**：
- 统一单路径：玩家命令和遭遇战走相同流程，避免双路径维护成本
- 响应体精简：命令响应不再携带大量 battlelog 数据
- 可重放：前端可重新拉取未播放的 battlelog

### 2.5 零依赖接口设计

`mark_battle_log_played.php` 采用零依赖设计：不 require 任何游戏框架文件（无 common.inc.php / player.func.php / DB 连接），只做文件读写。

- 安全性靠 `(int)` 强制转换防路径遍历
- 并发写靠 `LOCK_EX` 保护

**设计理由**：mark 请求的唯一目的是"修改文件中某些条目的 played 字段"，即使被伪造也无严重后果（最多让玩家少看一条 battlelog），不值得走完整的 auth + DB 流程。

### 2.6 flock 并发锁 + 前端 5 层锁

前端 `commandQueue._checkLocks(command)` 提供 5 层细粒度锁（`canExecute` 与 `execute` 共用，避免行为分叉），后端 `flock` 提供独占文件锁兜底：

| 层 | 位置 | 机制 | 释放时机 |
|----|------|------|---------|
| 前端第 1 层：HTTP/冷却 | `commandQueue._locked` / `_cooldown` | HTTP 请求期间 + 后端返回 timer 设置的冷却 | `try/finally` 末尾 / 冷却计时到期 |
| 前端第 2 层：战斗演出 | `battleStore.isPlayingBattleLog` | battlelog 播放期间阻止所有命令 | `fetchAndPlayBattleLog` 播完释放 |
| 前端第 3 层：itm0 | `inventoryStore.itm0 !== null` | itm0 非空时仅放行 `spec.itm0Allowed=true` 命令 | 玩家整理/丢弃后 itm0 清空 |
| 前端第 4 层：模式 | `battleStore.currentMode` | 探索/战斗模式与命令 `spec.mode` 不匹配时拒绝 | `currentMode` 切换时 |
| 前端第 5 层：PROCESSING | `playerStore.oblBattleState === 'PROCESSING'` | 仅拦截 `spec.advancesTick=true` 命令 | 状态机过渡到 `PLAYER_TURN` 或 `IDLE` 时自动释放 |
| 后端文件锁 | `obl_command.php: flock(LOCK_EX\|LOCK_NB)` | 同一玩家 PID 的独占文件锁 | 进程结束/脚本 exit 时 OS 自动释放 |

**`isLocked` 语义边界**：`isLocked` getter 只包含第 1+2 层（全局锁），用于全局 UI 反馈；按钮 `:disabled` 应改用 `canExecute(command)` 精细化控制。`pendingNpc` getter 仍从 `oblBattleState === 'PROCESSING'` 派生，仅用于 StatusBar NPC 指示器和 log.ts 延迟刷新，不参与 `isLocked`。

> 完整 5 层锁架构与 `COMMAND_REGISTRY` 三维度分类详见 [vex-vue/CODEBASE.md §3.1](../vex-vue/CODEBASE.md#31-五层并发锁)。

**为什么选 flock 而非 DB 锁**：
- flock 在进程异常退出时由 OS 自动释放，不会死锁
- DB 锁需要额外的"超时清理"逻辑，复杂度高
- 单机部署足够，无需分布式锁
- 性能优于 DB 锁

### 2.7 三层战斗演出架构

战斗日志从产出到消费经历三层，每层职责独立：

1. **后端原料层**（PHP `BattleLogCollector`）
   - emit 时补全名称、HP 快照、边界标记字段（`bl_turn_num`/`bl_round_num`/`bl_segment_flag`）
   - 按 phase 精细区分事件类型，设置默认 `debug` 标记控制前端可见性
   - 不预判前端如何消费，专注提供完整的原始事件结构

2. **前端导演层**（`battle-director.ts`）
   - 同步纯函数，输入 raw entries → 输出 `PlayScript`
   - 配对 pre/post → 构建分层段（Phase 0/Round/Turn/BattleEnd）
   - 不涉及网络、不涉及 DOM、不涉及组件状态

3. **前端演员层**（`battle.ts` + `BattleModal.vue`）
   - 按段播放：碰撞动画 → 模态框渲染 → 伤害数字
   - 纯执行，不涉及编排逻辑

**约束**：生产端和消费端不互斥，同一文件可多次追加后一次性拉取播放。导演层与演员层均幂等——同名脚本可复播。

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

- **prebattle 取消**：玩家点击敌人 → 纯前端确认界面（"是否攻击？"）→ 确认后直接提交 `obl_battle_start`，后端直接进入 `action='battle'`
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
| `PLAYER_TURN` | 玩家回合 | 仅 `obl_battle_action` |
| `PROCESSING` | 后端处理中（NPC 行动 / 玩家行动已提交未结算） | 拒绝推进 tick 的命令 |

**关键转换触发点**（代码位置见 [CODEBASE.md §6.4.1](./CODEBASE.md#641-战斗状态机三态与转换触发点)）：
- 队列创建（`battle_queue_create_and_init`）：初始为 `PROCESSING`（首顺位是 NPC 时 NPC 先行动；首顺位是玩家时立即切到 `PLAYER_TURN`）
- 玩家提交推进 tick 命令（`obl_command.php` [C2d]）：`PLAYER_TURN → PROCESSING`
- `battle_manage_queue` 检测下一顺位是玩家：`PROCESSING → PLAYER_TURN`
- NPC 行动调度（`obl_tick_phase_battle_npc`）：`PROCESSING → PLAYER_TURN`
- 队列解散（`battle.queue.main.php`）：任意 → `IDLE`

**`self_loop` 转换的设计用途**：NPC 多回合连击时保持 `PROCESSING` 状态并刷新时间戳，避免被超时恢复机制误判为卡死。`obl_battle_state_find_stale` 会检测 `PROCESSING` 状态超过 30 秒的战场并降级到 `PLAYER_TURN`（兜底异常恢复）。

**与 §2.10 命令状态强制过滤的协作**：
- `action='battle'` 时 `obl_command_allowed_by_state` 仅允许 `obl_battle_action`（覆盖 `PLAYER_TURN` 与 `PROCESSING`）
- `obl_tick_has_busy_battle()` 检查**任何**战场在 `PROCESSING`，配合 [C2b] 拒绝推进 tick 命令（防止玩家在 NPC 行动期间重复提交）
- 二者正交：`action` 是玩家维度的战斗状态，`obl_battle_state` 是战场维度的处理状态

### 2.10 命令状态强制过滤

后端 `obl_command_allowed_by_state` 强制过滤命令：
- `action='battle'` 时只允许 `obl_battle_action`
- 非战斗状态不允许 `obl_battle_action`（`obl_battle_start` 仍允许）
- 被拒绝的命令 emit `command.rejected` 日志，不推进 tick

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

### 2.15 后端日志 ID 必须有前端模板对应

Oblivions 有三套独立的日志系统，后端 emit 的每个 ID 必须在前端有对应的渲染模板，否则前端会静默失败（渲染为空或 undefined），不会报错，非常难排查：

| 日志系统 | 后端 emit 位置 | 前端模板文件 | 模板格式 |
|---------|---------------|------------|---------|
| `obl_log`（结构化日志） | `$obl_log->emit($id, ...)` | `vex-vue/src/data/log-templates.ts` | `{ id: { render(params) { return '...' } } }` |
| `obl_battle_log`（战斗日志） | `$obl_battle_log->emit($action_id, ...)` | `vex-vue/src/data/battle-templates.ts` | `{ action_id: { render(entry) { return '...' } } }` |
| `obl_error_log`（错误日志） | `$obl_error_log->emit($id, ...)` | 前端错误渲染逻辑 | 按 ID 分发渲染 |

**强制约定**：
- 后端新增任何日志 ID 时，必须同步在对应前端模板文件中添加渲染函数
- ID 命名使用点号分隔（如 `initiative.roll`），前后端必须完全一致
- 如果该日志不需要前端渲染（如纯 debug），仍需在模板中注册返回空字符串的 render 函数

**设计理由**：
- 曾因 `initiative.roll`（后端）vs `initiative_roll`（前端）命名不一致导致静默失败
- 跨层一致性是前后端分离架构的常见坑，强制约定可避免遗漏

---

### 2.16 前端守护进程模型（心跳）

前端是后端游戏刻推进的唯一驱动力。

**两个独立定时器，职责分离**：

| 定时器 | 职责 | 间隔 | 与前端业务耦合 |
|--------|------|------|--------------|
| 心跳守护进程 | 纯 tick 激活，fire-and-forget | 200ms | **零耦合** — 不读响应 body，不触发任何 store |
| NPC 状态轮询 | 前端状态同步（`refreshBattle`） | 1000ms | 无改动，沿用原有逻辑 |

**设计原则**：
- 心跳与前端业务数据同步彻底解耦，心跳不做任何"帮后端判断是否推进"的逻辑
- 原有 NPC 轮询定时器的隐含双重职责（tick 激活 + 状态同步）被心跳剥离后，变为纯粹的"状态发现"
- 动画播放期间心跳持续不受影响，`refreshBattle` 由 `isProcessingBattle` 锁保护

**入口**：`api_v2.php?action=heartbeat`，响应仅 `{"status":"success"}`，不进业务字段组装。

**实施**：`battle.ts` 新增 `startDaemonPoll/stopDaemonPoll`，`App.vue` `onMounted` 启动。

#### 2.16.1 heartbeat → tick 推进完整链路

heartbeat 之所以能驱动后端 tick 推进，是因为 `api_v2.php` 第 11 行 `require_once './include/core/common.inc.php'`——**所有 API 请求（含 heartbeat）都会加载 common.inc.php**，而 common.inc.php 末尾会检测并处理未消费的 tick 差值：

```
前端 _daemonBeat（200ms 周期）
  ↓
fetch('/api_v2.php?action=heartbeat')
  ↓
api_v2.php 加载 common.inc.php
  ↓
common.inc.php 末尾检测：obl_pretick < obl_tick ?
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
$ginfochange = true → save_gameinfo() 持久化 obl_tick/obl_pretick
  ↓
下次 heartbeat 检测 obl_pretick < obl_tick 仍成立 → 继续 NPC 行动循环
```

**关键设计点**：
- 心跳请求**不携带任何业务参数**，仅触发 common.inc.php 的末尾逻辑
- 后端通过 `obl_pretick < obl_tick` 判断是否有未处理 tick，与请求来源无关——任何请求（含 command.php 命令提交）都会触发同样的处理
- NPC 多回合连击时，每次心跳推进一个 NPC 行动，通过 `obl_tick_request_advance` 自驱动下次心跳继续

#### 2.16.2 PROCESSING 的实际生命周期

由于心跳 200ms 高频驱动，PROCESSING 通常在 **200-400ms 内**（一个心跳周期）被处理完：

| 场景 | PROCESSING 持续时间 | 前端感知 |
|------|---------------------|---------|
| 单次 NPC 行动 | 200-400ms | 1 秒轮询大概率看不到，已切回 PLAYER_TURN |
| NPC 多回合连击（self_loop） | N × 200ms | 1 秒轮询可能看到 PROCESSING |
| 服务器高负载 / 数据库慢 | 不定 | 1 秒轮询看到 PROCESSING，启动轮询循环 |

**前端实际感知 PROCESSING 的场景**：
1. 玩家执行 `obl_battle_action` 后 `_checkBattleState` 立即拉取 `player_info`——可能在守护进程推动 NPC 行动前看到 PROCESSING（这是 PROCESSING 锁的主要触发场景）
2. NPC 多回合连击时 1 秒轮询拉取到 PROCESSING

**设计含义**：
- 前端 PROCESSING 锁（`commandQueue` 第 5 层，仅拦截 `COMMAND_REGISTRY` 中 `advancesTick=true` 的命令）实际是兜底机制，触发概率低但必要
- 前端 1 秒轮询拉取 player_info 是"状态发现"，不是"驱动后端"——这是常见误解
- 真正驱动后端 NPC 行动的是 200ms 心跳，而非 1 秒轮询

### 2.17 Phase 0 vs Phase 1 — 两阶段战斗执行分离

战斗执行分为两个本质不同的阶段：

| | Phase 0（突袭阶段） | Phase 1（标准战斗阶段） |
|---|---|---|
| **触发条件** | `obl_battle_start` 时立即执行 | 玩家/敌人队列存在后执行 |
| **队列** | 无队列（不创建 `oblbattle_queue`） | 有队列，按先攻排序 |
| **Turn/Round** | 无 Turn/Round（`bl_turn_num=null`） | 有 Turn/Round 递增 |
| **边界信号** | 达到 `ambush_battle_end` 条件（被攻击者全死/全逃）→ `ambush_battle_end` 段 | `round_start` / `turn_start` / `battle_end` |
| **可以执行的动作** | 仅无队列的动作（如先攻回合、逃跑检测） | 队列中任意动作 |
| **战斗日志** | `bl_segment_flag` 固定为 `null`，自动归入 `phase0` 段 | `bl_segment_flag` 携带 `round_start`/`turn_start` |

**设计理由**：
- Phase 0 本质是一个"战斗预热"阶段——先处理先攻掷骰、确认双方能否进入标准战斗。Phase 1 才是真正的回合制战斗
- 两阶段分离后，导演系统可以按段类型渲染不同 UI（Phase 0 显示"突袭"头，Phase 1 显示"第N轮/第N回合"头）
- 旧版将 Phase 0 和 Phase 1 混在一起 emit，前端通过 `turn=0` 和 `action_id` 猜测阶段归属，导致渲染逻辑复杂且脆弱

**实施**：`BuildLogCollector` 自动管理 `bl_turn_num`/`bl_round_num`：Phase 0 期间两者均为 `null`；队列首次创建时 `setRoundNum(0)+nextTurn()` 触发 `round_start+turn_start` 进入 Phase 1。`battle_queue_rebuild` 也会调 `setRoundNum` 同步 DB 的 `round_num`。

### 2.18 前端导演系统概念

**为什么需要导演层**：
- 后端 emit 的事件是扁平的（按执行顺序排列的日志条目列表），每个条目只携带当前事件的信息
- 前端播放需要"上下文"——需要知道哪些条目属于同一个回合、哪些是 pre/post 配对、战斗何时开始何时结束
- 旧方案是播放器兼任导编职责：在播放过程中实时判断 `action_id=xxx` 来决定渲染方式，导致 `BattleModal.vue` 逻辑膨胀

**导演层与后端原料层的契约**：

后端负责提供"足够原始且完整"的原料（名称、HP 快照、边界标记），导演层负责将这些原料排列成具有层次结构的"剧本"（PlayScript）。

```
后端 emit 3 条：
  [once_execute_pre, actor="玩家", target="野狼A", hp=30→25]
  [queue_create, ...]                           ← debug=true（前端不可见）
  [once_execute_post, actor="玩家", target="野狼A", dmg=5]  

导演编排为 1 条 DirectedEntry（kind=action）：
  玩家 → 野狼A: 5点伤害 [HP: 30→25]
```

**关键设计决策**：
1. **导演层是纯同步函数**：不涉及网络请求、不涉及 DOM。`direct(entries) → PlayScript` 的纯函数签名使其可测试、可复播、可调试
2. **段 (Segment) 是播放的最小组织单位**：每个段包含一个段类型（phase0/round/turn/battle_end/ambush_battle_end）、段元数据（轮数/回合数/行动者/胜利者）、以及该段内的有序列队条目
3. **配对的 pre/post 合并为 action**：`pairPrePost` 用栈算法匹配 `once_execute_pre` 和 `once_execute_post`。pre 记录动作执行前的全部状态快照，post 记录执行结果（伤害值/是否成功）。配对后合并为单条 `action` 条目供前端渲染
4. **边界信号驱动分段**：不依赖 phase 字符串理解，而是依赖 `bl_segment_flag` 驱动。`round_start` → 截断当前段并开始新 round；`turn_start` → 截断并开始新 turn。这降低了后端 phase 变动时导演层需要调整的风险
5. **异常健壮性**：悬空 pre（无 post 配对）降级为 `display` 渲染；孤儿 post（无 pre）直接渲染；尾部未配对条目自动归入当前段
6. **段元数据完整**：每个段携带 `roundNum`/`turnNum`/`actorPid`/`actorName`/`initiatorOrder` 等，演员层无需回溯上一个条目

**调试便利**：`direct()` 运行时自动挂载 `window.__battleScript` 和 `window.__battleRawEntries`，浏览器控制台直接检查编排结果。`exportScriptToJson()` 可将脚本导出为 JSON 文件下载，方便离线分析。

**旧逻辑清理**：导演层替代了以下旧实现——`groupByEncounter`（由 `extractNpcPid`+`buildSegments` 替代）、`playBattleLogGroup`（由 `playScript` 替代）、`buildPlayContext`（后端 pre emit 已带名称/HP）、`BATTLE_TEMPLATES` 按 action_id 索引（由 `KIND_TEMPLATES` 按 directedKind 分发替代）。

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
| 玩家主动攻击时前端先切换 `currentMode='battle'` | 前端比后端**早进入** | ✅ 合理 | 玩家需要装填区才能发起 `obl_battle_start`，UI 必须先切换 |
| 退出战斗时前端等 battlelog 播完才切 `currentMode='normal'` | 前端比后端**晚退出** | ✅ 合理 | 演出完整性优先，避免战斗突然结束的突兀感 |
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
PreloadArea.onExecute → commandQueue.execute({ command: 'obl_battle_start' })
  ↓
后端收到命令：action='normal'（尚未切换）→ obl_command_allowed_by_state 允许
  ↓
后端处理 obl_battle_start → 创建队列（状态=PROCESSING）→ action='battle' → 切到 PLAYER_TURN
  ↓
后续 refreshBattle → enterBattleMode（currentMode 已是 battle，仅更新 isPlayerTurn）
```

**路径 B：被动遭遇**——后端先切换，前端跟随：

```
玩家执行 move/obl_explore/obl_search
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
前端 refreshBattle 拉取 player_info → action !== 'battle'
  ↓
fetchAndPlayBattleLog（先播完积压的 battlelog）← 关键：演出完整性优先
  ↓
播完后 afterAction !== 'battle' → exitBattleMode → currentMode='normal'
```

#### 2.26.3 设计含义

- `currentMode` 反映"UI 应该处于什么模式"，`action` 反映"逻辑上是否在战斗中"——二者在稳定状态下一致，仅在窗口期有合理偏差
- 前端白名单判断应**以前端 `currentMode` 为真值源**（详见 [战斗锁定白名单-设计案](./docs/战斗锁定白名单-设计案.md) §4 决策 5），因为前端 UI 反馈需要即时性，不能等待后端 action 同步
- `obl_battle_start` 在前端归"战斗内"（mode='battle'），在后端归"探索内"（action='normal' 时允许）——两端分类不同但语义自洽：前端按 UI 模式，后端按逻辑状态

---

## 三、缓存目录结构

Oblivions 子系统的运行时缓存文件统一存储在 `oblivions/cache/` 下，按用途分子目录。具体目录结构和文件命名规范见 [CODEBASE.md §2](./CODEBASE.md#二目录结构)。

**设计原则**：
- 缓存文件由后端 PHP 运行时生成，与前端代码彻底解耦
- 每个 `*_persist` 函数和锁文件路径都有 `is_dir + @mkdir` 保护，避免目录缺失导致 bug
- 游戏重置时（`rs_game()` 钩子）自动清理，日常依赖条目上限自然轮转
- `.htaccess` 防止直接访问（锁文件有 `die` 保护，但 json/jsonl 文件可被直接读取）

---

**文档结束。** 代码库参考手册见 [CODEBASE.md](./CODEBASE.md)。
