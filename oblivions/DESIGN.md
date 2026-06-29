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
- 拾取时将 `item_id`（地图道具实例ID）注入 `itmpara` 的 `obl_item_id` 键
- 丢弃时从 `itmpara` 读取 `obl_item_id`，还原为地图道具实例
- 格式：JSON 对象，如 `{"obl_item_id": "42"}`

**itempara**（玩家道具栏 JSON 大字段，`bra_oblplayers.itempara`）：
- JSON 数组，长度 = `itemmaxslots + 1`（index 0=特殊槽，1~itemmaxslots=普通槽）
- 每个元素是一个道具对象或 `null`（空槽）

> 道具对象七字段规范与 JSON 示例见 [CODEBASE.md §3.1](./CODEBASE.md#31-bra_oblplayers-玩家敌人统一数据表)。

### 1.7 游戏刻 (tick)

- 每次移动更新 1 游戏刻，存储在 `$gamevars['obl_tick']`
- 每次 tick 增长触发 `obl_resolve_tick_events($delta)`，通过监听器机制调度 NPC 敌人行动
- **玩家操作与 NPC 回合互斥**：由战斗状态机管辖，`PROCESSING` 状态时拒绝提交战斗命令（推进 tick 仍允许）

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

### 1.9 结构化日志 (Structured Log)

Oblivions 模式的日志传递机制。后端只输出事件结构（发生了什么 + 参数），前端完全控制视觉呈现（文案、样式、随机化）。

- **数据形态**：结构化数组（id + logcategory + params）
- **全局变量**：`$obl_log`（`OblivionsLogger` 实例）
- **输出方式**：`$obl_log->emit($id, $logcategory, $params)`
- **样式控制**：前端模板控制（`log-templates.ts`）
- **持久化**：`oblivions/cache/logs/obl_log_{groomid}_{pid}.json`
- **API 端点**：`obl_log`

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
- 前端 `isLocked` / `pendingNpc` getter 从 `oblBattleState === 'PROCESSING'` 派生
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

### 2.6 flock 并发锁 + 前端短锁

前后端三层防护防止短时间多次请求导致重复提交/状态错乱：

| 层 | 位置 | 机制 | 释放时机 |
|----|------|------|---------|
| 前端命令队列锁 | `command-queue.ts: isLocked` | 布尔标志，覆盖 HTTP 请求期间 | `try/finally` 末尾 |
| 前端战斗处理中锁 | `command-queue.ts: pendingNpc` | 从 `oblBattleState === 'PROCESSING'` 派生（响应式） | 状态机过渡到 `PLAYER_TURN` 或 `IDLE` 时自动释放 |
| 后端文件锁 | `obl_command.php: flock(LOCK_EX\|LOCK_NB)` | 同一玩家 PID 的独占文件锁 | 进程结束/脚本 exit 时 OS 自动释放 |

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

```
normal（探索）←→ battle（战斗）
```

- **prebattle 取消**：玩家点击敌人 → 纯前端确认界面（"是否攻击？"）→ 确认后直接提交 `obl_battle_start`，后端直接进入 `action='battle'`
- **ended 取消**：模态框播放完自动关闭，关闭后刷新状态决定去留

**设计理由**：减少中间态，降低状态机复杂度。前端确认界面承担了 prebattle 的确认职责，无需后端状态。

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

> 当前 8 层加载清单见 [CODEBASE.md](./CODEBASE.md#引导加载bootstrap)。

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
