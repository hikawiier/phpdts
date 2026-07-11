# Oblivions 子系统 — 代码库参考手册

> 帮助 AI 智能体快速查阅 Oblivions 模式的后端架构、API 接口、数据结构和代码规范。
> 概念与设计原则：[DESIGN.md](./DESIGN.md) | 项目文档总入口：[AGENTS.md](../../AGENTS.md) | 前端文档：[vex-vue/CODEBASE.md](../../vex-vue/CODEBASE.md)

---

## 章节快速跳转

| 我想查… | 跳转 |
|---------|------|
| 当前架构摘要 / 三个入口 / 新命令名 | [§0 当前架构摘要](#〇当前架构摘要ai-快速判断区) |
| 目录结构 / 文件在哪 | [§3 目录结构](#三目录结构) |
| 引导加载顺序 | [§4 引导加载（bootstrap）](#四引导加载bootstrap) |
| 数据库表字段 | [§5 数据库表](#五数据库表) |
| API 接口请求/响应格式 | [§6 API 接口](#六api-接口) |
| 命令路由 / 提交格式 | [§7 命令路由](#七命令路由) |
| 游戏数据文件配置（道具/POI/敌人） | [§8 游戏数据文件](#八游戏数据文件) |
| 函数签名 / 核心函数索引 | [§9 核心函数索引](#九核心函数索引) |
| 命名约定 / 数据传递规范 | [§10 代码规范](#十代码规范) |
| 玩家生命周期流程 | [§11 玩家生命周期](#十一玩家生命周期oblivions模式) |
| 前端对接点 | [§12 前端集成速查](#十二前端集成速查) |
| 概念定义 / 设计理由 | [DESIGN.md](./DESIGN.md) |

---

## 〇、当前架构摘要（AI 快速判断区）

> 阅读以下要点后再深入各章节，可避免被历史段落误导。本节是"当前真相"，正文若与本节冲突以本节为准。完整设计理由见 [DESIGN.md 〇、当前架构摘要](./DESIGN.md#〇当前架构摘要ai-快速判断区)。

**三个独立 HTTP 入口**（均不依赖 `common.inc.php`，由 `obl_runtime_boot($kind)` 提供独立运行期）：

| 入口 | 用途 | 关键文件 |
|------|------|---------|
| `oblivions/api/command.php` | JSON Command API（玩家写操作唯一主路径） | `include/command/obl_command_bus.php`（核心）+ `obl_command_handlers.php`（switch 新命令名调 domain 函数）+ `obl_command_contract.php` |
| `oblivions/api/heartbeat.php` | Heartbeat API（前端显式驱动 tick 推进 + NPC 行动） | `include/core/obl_tick_orchestrator.php`（`obl_tick_orchestrator_heartbeat()`） |
| `oblivions/api/state.php` | State API（纯读，不推进 tick） | `include/api/obl_state_handlers.php` |

**新命令名**（旧名已 deprecated，仅存于 `include/core/obl_command.php` 兼容路径）：

| 旧命令 | 新命令 |
|---|---|
| `move` | `map.move` |
| `obl_explore` | `map.explore` |
| `obl_search` | `poi.search` |
| `obl_pickup` | `item.pickup` |
| `obl_discard` | `item.discard` |
| `obl_use_item` | `item.use` |
| `obl_organize` | `inventory.organize` |
| `obl_craft` | `craft.execute` |
| `obl_battle_start` | `battle.start` |
| `obl_battle_action` | `battle.submit_turn` |

**Command API 响应契约**：`{ status, code, request_id, data: { feedback, refresh, server_state, ...domainData }, warnings? }`。战斗命令把 action/target results 展平在 `data.actions[]`；commit 后 battlelog 文件失败通过 `warnings=['BATTLELOG_PERSIST_FAILED']` 返回。

**两条 tick 推进路径**（互斥，由战斗状态机管辖）：
1. **玩家命令路径**：Command Bus `obl_command_save_and_tick()` → `obl_tick_orchestrator_after_command()` → `obl_tick_advance()`（仅 `advancesTick=true` 的命令）
2. **心跳路径**：`obl_tick_orchestrator_heartbeat()` → `obl_tick_orchestrator_resolve_pending()` → `obl_resolve_tick_events()`（处理 NPC 行动）

**TickFrame 行为互斥**：同一 TickFrame 内同一 actor 最多执行一个主动行为。`tick.func.php` 维护 `ActorBehaviorLedger` 与 `BattleActorScope`；`enemy_ai.func.php` 的 world AI 必须先通过 `obl_actor_can_world_ai()`，禁止本 tick 战斗成员在同 tick 再执行非战斗 AI。

**战斗结束后的下一 tick**：NPC 战斗回合结束会通过 `obl_tick_request_advance()` 自驱动下一 pending tick。若战斗已完全 disband，下一 TickFrame 的 `BattleActorScope` 为空，原战斗 actor 恢复普通 NPC 后执行 world AI 属于当前预期行为，不是同 tick 双行动 bug。

**战斗执行当前结构**：`include/game/combat/` 是唯一战斗执行主流程；`include/game/battle/` 只保留数值、队列、状态机 hook、battle log 等 shared combat infrastructure。旧 `battle.entry.php` / `battle.main.php` 已删除，运行时不加载。

**前端战斗播放当前结构（四层架构）**：战斗日志先由 `battle-director-v2.ts::directV2()` 转成语义脚本 `BattlePlayScriptV2`（导演层），再由 `planPlaybackV2()` 编排为 `BattlePlaybackPlan` / `PlaybackStep[]`（计划层，同文件），最后交给 `battle-playback-runner.ts::runBattlePlaybackPlan()` 顺序/并发执行（执行器），单 actor 动画由 `battle-actor-executor.ts` 负责（演员）。

**核心目录补充**：
- `include/core/` 共 8 个文件：`obl_bootstrap.php` / `obl_runtime.php` / `obl_command.php`（@deprecated） / `obl_command_response.php` / `obl_json_request.php` / `obl_tick_orchestrator.php` / `obl_game_repository.php` / `obl_gamevars.php`
- `include/command/` 共 5 个文件：`obl_command_bus.php` / `obl_command_contract.php` / `obl_command_handlers.php`（新路径）+ `oblivions_router.php` / `oblivions_commands.php`（旧 deprecated 路径）

**不可破的边界**：
- 不升级旧根 `command.php` 为 JSON；Oblivions 新写操作只走 `oblivions/api/command.php`
- Oblivions 运行时不依赖 `common.inc.php`
- 后端只返回结构（`code + feedback.id + params`），前端负责文案/i18n/HTML
- battlelog.v2 是请求内战斗演出事件流，通过 response `presentation.v1` 投递，不是 State API 日志
- `obl_error_log` 是诊断流，默认不作为普通 UI 提示通道（仅 `?debug=ai` / `?poll_error=1` 弹 Toast）

---

## 一、子系统概述

Oblivions 是 PHPDTS 的大逃杀游戏模式之一，采用网格地图 + 迷雾探索机制。通过全局变量 `$gruleset === 'OBLIVIONS'` 切换激活，所有模式分支由 `oblivions_is_active()` 守卫。

**核心特征**：
- 网格地图 + 迷雾 + POI + 道具散落 + 战斗演出
- `obl_move()` 移动 + `obl_explore()` 探索
- 玩家数据存 `bra_oblplayers`（独立数据层，详见 [DESIGN.md §2.1](./DESIGN.md#21-数据层独立性)）

**数据层独立性约束**：
- 玩家+敌人统一存储在 `bra_oblplayers` 表
- `obl_save_player()` 仅写 `bra_oblplayers`，不同步 `bra_players`
- `save_gameinfo()` 在 Oblivions 模式下跳过 `bra_players` 查询

---

## 二、目录结构

```
oblivions/
├── api/
│   ├── command.php              # JSON Command API：写入命令入口
│   ├── heartbeat.php            # Heartbeat API：显式 tick 推进入口
│   └── state.php                # State API：纯读状态入口
├── include/
│   ├── api/
│   │   ├── obl_api_bootstrap.php           # API 共用 bootstrap（Runtime）
│   │   ├── obl_command_api_bootstrap.php   # Command API 依赖聚合
│   │   ├── obl_heartbeat_api_bootstrap.php # Heartbeat API 依赖聚合
│   │   ├── obl_state_api_bootstrap.php     # State API 依赖聚合
│   │   ├── obl_state_response.php          # State API 响应 helper
│   │   └── obl_state_handlers.php          # State API scope handlers
│   ├── core/
│   │   ├── obl_runtime.php         # Oblivions 独立运行期（DB/cookie/room/gamevars/logger），由三个 HTTP 入口调用 obl_runtime_boot($kind)
│   │   ├── obl_bootstrap.php       # Domain 函数库加载入口（按拓扑排序分层加载，详见 §4）
│   │   ├── obl_tick_orchestrator.php  # tick 推进编排器（after_command / heartbeat / resolve_pending / recover_stale_battles）
│   │   ├── obl_game_repository.php # 单房间 Oblivions game state 表（{$tablepre}oblgame）DDL 与 CRUD
│   │   ├── obl_gamevars.php        # gamevars 兼容镜像层（$gamevars['obl_tick']/['obl_pretick'] 同步自 oblgame 表）
│   │   ├── obl_json_request.php    # JSON body 读取与解析（Command API 入口用）
│   │   ├── obl_command_response.php # 统一 success/error JSON 响应与 HTTP 状态码
│   │   └── obl_command.php         # 旧根 command.php 兼容处理器（@deprecated，[A0]/[A]/[C2]/[C2b]/[D]/[C2d]/[E]/[F-pre]/[G]/[F]/[H] 段，新前端不走此路径）
│   ├── command/
│   │   ├── obl_command_bus.php      # Command Bus 核心（contract/payload 校验 + auth + flock + gate + dispatch + save_and_tick）
│   │   ├── obl_command_contract.php # 命令 contract 定义（allowed_actions/advances_tick/payload_schema/battle_state_required 等）
│   │   ├── obl_command_handlers.php # 新命令名 → domain 函数的 switch 适配器（map.move/.../battle.submit_turn）
│   │   ├── oblivions_router.php     # 旧 deprecated 路由（分发到 cmd_handle_obl_*，含 actions JSON 解析）
│   │   └── oblivions_commands.php   # 旧 deprecated 命令处理器（cmd_handle_obl_explore/search/pickup/discard + battle_start/battle_action）
│   ├── gamectl/
│   │   ├── init.func.php         # 游戏初始化（obl_rs_game 主入口 + obl_init_enemies 敌人生成 + 建表/地图/迷雾生成）
│   │   └── state.func.php        # 游戏状态机（触发 obl_rs_game）
│   └── game/
│       ├── obl_global.func.php   # 公共函数（obl_get_config 等）
│       ├── log.func.php          # 结构化日志收集器 + 持久化/读取（详见 §8.6）
│       ├── battle_log.func.php   # 请求内战斗演出事件收集器（详见 §8.10）
│       ├── sql.func.php          # SQL 操作封装（队列/状态机查询）
│       ├── player.func.php       # 玩家数据层：认证/抓取/格式化/保存 + 命令状态过滤（详见 §8.1）
│       ├── move.func.php         # 移动/地图数据加载/BFS距离计算（详见 §8.4）
│       ├── generate.func.php     # 区域资源生成（道具/POI/野生道具，详见 §8.5）
│       ├── vision.func.php       # 视野/迷雾/发现系统（BFS视野 + 迷雾点亮 + 敌人发现/discovered 管理）
│       ├── explore.func.php      # 探索/搜索核心逻辑（详见 §8.3）
│       ├── enemy_ai.func.php     # NPC 敌人 AI 行为（10 函数：tick 监听器/决策/移动，详见 §8.7）
│       ├── tick.func.php         # 游戏刻核心（推进控制/监听器注册/事件调度，详见 §8.2）
│       ├── battle_state_machine.func.php  # 战斗状态机（PLAYER_TURN/PROCESSING 状态转换）
│       ├── combat/
│       │   ├── README.md                 # new combat 模块边界说明
│       │   ├── combat.runtime.php        # battle log 初始化 + battle_cache
│       │   ├── combat.context.php        # CombatContext 单 action 执行上下文
│       │   ├── combat.aim.php            # AimResolver registry（pid/tile/self/none）
│       │   ├── combat.target_capture.php # 内置 Capturer + provenance/结构/排序校验
│       │   ├── combat.target_unit.php    # 逐目标结算 + target SAVEPOINT
│       │   ├── combat.participation.php  # member/joinable/left/other_battle/blocked
│       │   ├── combat.planned_state.php  # 动作链 dry-run 计划状态
│       │   ├── combat.core.php           # 唯一战斗入口与主循环
│       │   ├── combat.pipeline.php       # Aim -> Capture -> TargetResolutionUnit 编排
│       │   ├── combat.effect.php         # damage/heal/move/escape/ap_change 实际应用
│       │   ├── combat.target.php         # 旧目标入口兼容 facade
│       │   ├── combat.skill.php          # 战斗技能配置与 hook 加载
│       │   ├── combat.ap.php             # AP 计算器注册与消费
│       │   ├── combat.tag.php            # 目标 Tag 派生与规则匹配
│       │   ├── combat.queue.php          # 对 battle.queue 的 combat 适配层
│       │   ├── combat.state.php          # combatants/tag_mutations/清场
│       │   ├── combat.effect_projector.php # dry-run effect 投影
│       │   ├── combat.chain.php          # 动作链 verify/preview 投影
│       │   ├── combat.preview.php        # engage/single/chain 预览
│       │   └── combat.log.php            # battlelog.v2 日志适配
│       ├── battle/
│       │   ├── README.md             # shared combat infrastructure 边界说明
│       │   ├── battle.func.php       # 共享战斗函数（规则/AP/turn hook，详见 §8.8）
│       │   ├── battle.calc.php       # 共享数值计算（伤害/先攻/射程）
│       │   ├── battle.queue.func.php # 共享先攻队列原语层（详见 §8.13）
│       │   └── battle.queue.main.php # 共享队列编排 / battle_manage_queue
│       └── item/
│           ├── item.tag.func.php       # 道具 Tag 系统（tags/itmk/tool_level 查询，详见 §8.14.1）
│           ├── item.basic.func.php     # 道具库存基础操作（堆叠/itm0/拾取/丢弃/整理，详见 §8.14.0）
│           ├── item.use.func.php       # 道具使用系统（use_effect 分发框架，详见 §8.14.2）
│           └── item.craft.func.php     # 合成系统（匹配算法/素材消耗/已发现配方，详见 §8.14.3）
├── gamedata/
│   ├── obl_config.php          # 可调参数配置
│   ├── item_table.php          # 道具模板表
│   ├── poi_table.php           # POI 模板表
│   ├── poi_loot.php            # POI 掉落表
│   ├── poi_pool.php            # POI 刷新池（按潮汐区配置）
│   ├── scatter_pool.php        # 野生散落道具池（按潮汐区配置）
│   ├── enemies_config.php      # NPC 敌人类型定义（名称/属性/AI 类型/技能/策略槽）
│   ├── enemy_pool.php          # NPC 敌人刷新池（按潮汐区分桶配置类型与数量）
│   ├── map.php                 # 区域元数据 + 网格布局
│   └── tiles/
│       ├── region_1.php        # 区域1（垃圾平原）地图格数据
│       └── region_2.php        # 区域2（腐烂沼泽）地图格数据
├── sql/
│   ├── oblplayers.sql          # 玩家表DDL（bra_oblplayers）
│   ├── oblmapstates.sql        # 图格状态表DDL
│   ├── oblmappoi.sql           # POI实例表DDL
│   └── oblmapitem.sql          # 地图道具实例表DDL
├── cache/                      # 运行时缓存
│   ├── .htaccess               # Apache 访问保护（Deny from all）
│   ├── locks/                  # obl_lock_{groomid}_{pid}.php — 命令并发锁
│   ├── logs/                   # obl_log_{groomid}_{pid}.json + obl_error_{groomid}_{pid}.json
│   └── debug/                  # ai_dump_{groomid}.jsonl — AI 调试 dump
├── editor/                     # 地图编辑器（Node.js/Vite前端工具）
└── docs/                       # 设计文档
```

**外部集成文件**（不在 oblivions/ 目录下）：

| 文件 | 作用 |
|------|------|
| `include/core/global.func.php` | `oblivions_is_active()` 定义 + `save_gameinfo()` Oblivions 分支 |
| `include/core/common.inc.php` | 旧模式全局入口；Oblivions 局内 command/heartbeat/state 运行期已不再依赖它 |
| `command.php` | 旧根命令入口；Oblivions 新写操作不再调用，仅保留兼容路径 |
| `oblivions/api/command.php` | Oblivions JSON Command API 写入口，加载 `obl_command_api_bootstrap.php` |
| `oblivions/api/heartbeat.php` | Oblivions Heartbeat API tick 推进入口，加载 `obl_heartbeat_api_bootstrap.php` |
| `oblivions/api/state.php` | Oblivions 只读 State API，加载 `obl_state_api_bootstrap.php` |
| `include/gamectl/system.func.php` | `rs_init_areas()` 在 Oblivions 模式下跳过禁区系统初始化 |
| `valid.php` | 玩家激活时创建 oblplayers 记录 + 出生点迷雾点亮 |
| `game.php` | 重定向到 `vex-vue/dist/index.html`（生产）或 dev server（开发） |

---

## 三、引导加载（bootstrap）

Oblivions 运行期采用两层 bootstrap：

1. **API bootstrap**：`oblivions/include/api/*_bootstrap.php` 只聚合各 HTTP 入口需要的 request/response/handler 依赖，不调用 `obl_runtime_boot()`，不执行业务逻辑。
2. **Domain bootstrap**：`oblivions/include/core/obl_bootstrap.php` 只加载游戏领域函数库，由 `obl_runtime_boot($kind)` 在完成独立运行期初始化时加载。

### 3.1 API 入口加载边界

| HTTP 入口 | Bootstrap | 职责边界 |
|---|---|---|
| `oblivions/api/command.php` | `include/api/obl_command_api_bootstrap.php` | 写入命令：Runtime + JSON request + Command response + Command Bus |
| `oblivions/api/heartbeat.php` | `include/api/obl_heartbeat_api_bootstrap.php` | tick 推进：Runtime + Command-style response + Tick Orchestrator |
| `oblivions/api/state.php` | `include/api/obl_state_api_bootstrap.php` | 纯读状态：Runtime + State response + Tick status + State handlers；不加载 Command Bus |

`obl_runtime_boot($kind)` 仍由入口显式调用，bootstrap 文件只做 `require_once` 聚合，避免加载阶段产生 schema 创建、heartbeat、pending tick resolve 等副作用。

### 3.2 Domain 函数库加载顺序

`oblivions/include/core/obl_bootstrap.php` 集中加载所有 domain/game 函数库，按拓扑排序分层。实际层序以该文件为准：

| 层 | 文件/模块 | 说明 |
|----|----------|------|
| 0 | `obl_global.func.php` | 公共函数，最先加载 |
| 0.5 | `obl_game_repository.php` / `obl_gamevars.php` | 单局状态仓储与 gamevars 兼容镜像 |
| 1 | `log` / `battle_log` / `sql` / `player` / `move` / `generate` / `battle.calc` / `item.tag` / `skill` | 基础模块 |
| 2 | `vision` | 依赖 obl_global + player + move + log |
| 2.5 | `battle_state_machine.func.php` | 战斗状态机，供队列推进 / NPC 回合 / Tick Orchestrator 使用 |
| 3-4.5 | `battle.func` / `battle.queue.func` / `battle.queue.main` | shared combat infrastructure；旧主执行链已删除 |
| 4.7 | `combat/*` | new combat 唯一战斗执行模块，按 runtime/context/planned_state/core/pipeline/effect/target/skill/ap/tag/queue/state/projector/chain/preview/log 顺序加载 |
| 5 | `explore` / `enemy_ai` | 依赖 vision + battle |
| 5.5 | `item.tag` / `item.basic` / `item.use` / `item.craft` | 道具系统（依赖 log + player + explore，无循环依赖；加载顺序：tag（数据加载）→ basic（基础操作）→ use（衍生）→ craft（衍生）） |
| 6 | `tick` | tick engine；末尾注册 tick 监听器 |
| 6.5 | `obl_tick_orchestrator.php` | command/heartbeat/state 的 tick 策略编排器 |
| 7 | `gamectl/init.func.php` | 游戏初始化 |
| 8 | `gamectl/state.func.php` | 游戏状态机 |

**强制约定**：新增 API request/response/handler 文件注册到对应 `include/api/*_bootstrap.php`；新增 `.func.php` / `.main.php` 领域函数库注册到 `include/core/obl_bootstrap.php`，按拓扑排序。

## 四、数据库表

所有表前缀为 `$tablepre`（默认 `bra_`），建表由 `rs_init_oblivions_tables()` 读取 `oblivions/sql/` 下SQL文件执行。命名规范：`bra_obl` 前缀 + 实体名连写（无下划线）。

### 4.1 `bra_oblplayers` — 玩家+敌人统一数据表

Oblivions 模式独立数据层，玩家与 NPC 敌人统一存储。

| 字段分类 | 字段 | 说明 |
|---------|------|------|
| **身份** | `pid` | 主键（smallint auto_increment） |
| | `type` | 0=玩家, >0=敌人类型 |
| | `name`/`pass`/`gd`/`icon` | 基础信息（pass 与 user 表双重校验） |
| **战斗状态** | `action` | 空=正常 / `'battle'`=战斗中 |
| | `bid` | 先攻队列编号 qid（= 战场编号，0=不在战斗） |
| **属性** | `hp`/`mhp`/`sp`/`msp`/`att`/`def` | 战斗属性 |
| | `ap`/`max_ap` | AP 值（独立字段，便于频繁读写） |
| **位置** | `pgroup`/`pls` | 区域ID + 格子ID |
| **进度** | `lvl`/`exp`/`state` | 等级/经验/状态（0=存活, 1=死亡） |
| **装备** | `wepid`/`wep`/`wepk`/... | 7 槽装备（每槽 1 个模板 ID + 6 个运行时字段：自定义名/k/e/s/sk/para） |
| **道具栏** | `itempara` | JSON 数组（七字段规范，见下方 itmpara / itempara 小节） |
| | `itemmaxslots` | 道具栏最大格数（默认 6，index 0=itm0 缓存槽，1~itemmaxslots=普通槽） |
| **Oblivions专属** | `tacpara` | 策略槽（JSON） |
| | `skillpara` | 技能数据（JSON；effect-lifetime 被动含 `effect_instances`） |
| | `oblpara` | 杂项功能数据（JSON，含 `killnum`/`ai_type`/`vision_range`/`battle` 等） |
| | `discovered` | 敌人发现状态（0=未发现, 1=已发现） |

**`action` 字段取值**：
- 空（`''`）= 正常探索状态
- `'battle'` = 战斗中（玩家主动攻击或遭遇战触发后直接进入）

**`oblpara['battle']` 战斗状态结构**（战斗中存在，战斗结束清除）：

```php
$oblpara['battle'] = [
    'queue' => [        // 先攻队列（双方同步保存）
        ['pid' => 101, 'done' => 0],
        ['pid' => 5,   'done' => 0],
    ],
];
```

逃跑后的休整不再使用 `oblpara` 专用字段。`escape` 施加 pending `flustered` effect-skill，qid disband 后激活一 tick，并由 capability evaluator 统一限制行为。

**itmpara / itempara 道具对象七字段规范**（itempara 数组元素 + 地图道具实例均遵循）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `itm` | string | 实例自定义名；空值表示用 `itmid` 查前端 locale 渲染模板名 |
| `itmk` | string | 道具种类（如 WP/WK/HH）；前端通过 `itmk-locale.ts` 渲染中文名 |
| `itme` | int | 效果值 |
| `itms` | string | 数量（可堆叠）或耐久（不可堆叠）；`'∞'`=无限（`item_is_infinite()` 判断） |
| `itmsk` | string | 耐久种类 |
| `itmpara` | object | 实例附加参数（JSON 对象） |
| `itmid` | string | 道具模板 ID（如 `rusty_pipe`）；地图实例主键为 `iid`，不写入背包 |

```json
[
  null,
  {"itm":"","itmk":"HH","itme":120,"itms":"15","itmsk":"","itmpara":[],"itmid":"bread"},
  {"itm":"自定义水瓶","itmk":"HS","itme":140,"itms":"15","itmsk":"","itmpara":[],"itmid":"mineral_water"},
  null, null, null, null
]
```

> index 0 = itm0 缓存槽（新增道具中转槽，详见 [DESIGN.md §2.24](./DESIGN.md#224-itm0-缓存槽与事件解耦)）；1~itemmaxslots = 普通槽位

**装备字段规范**：装备槽与背包道具对象保持同样的“模板索引 + 运行时状态”分离。

| 槽位 | 模板 ID 字段 | 自定义名字段 | 其他运行时字段 |
|------|-------------|-------------|----------------|
| 主武器 | `wepid` | `wep` | `wepk`/`wepe`/`weps`/`wepsk`/`weppara` |
| 副武器 | `wep2id` | `wep2` | `wep2k`/`wep2e`/`wep2s`/`wep2sk`/`wep2para` |
| 身体 | `arbid` | `arb` | `arbk`/`arbe`/`arbs`/`arbsk`/`arbpara` |
| 头部 | `arhid` | `arh` | `arhk`/`arhe`/`arhs`/`arhsk`/`arhpara` |
| 饰品 | `araid` | `ara` | `arak`/`arae`/`aras`/`arask`/`arapara` |
| 足部 | `arfid` | `arf` | `arfk`/`arfe`/`arfs`/`arfsk`/`arfpara` |
| 其他 | `artid` | `art` | `artk`/`arte`/`arts`/`artsk`/`artpara` |

### 5.2 `bra_oblmapstates` — 图格状态

| 字段 | 类型 | 说明 |
|------|------|------|
| `pgroup` | tinyint unsigned | 区域ID（主键之一） |
| `pls` | tinyint unsigned | 格子ID（主键之一） |
| `fog` | tinyint(1) unsigned | 0=迷雾 1=已点亮 |
| `damaged` | tinyint(1) unsigned | 0=完好 1=被破坏 |
| `flags` | varchar(255) | 扩展标记(JSON) |

主键: `(pgroup, pls)`

### 5.3 `bra_oblmappoi` — POI实例

| 字段 | 类型 | 说明 |
|------|------|------|
| `iaid` | mediumint unsigned | POI实例ID（自增主键） |
| `pgroup` | tinyint unsigned | 区域ID |
| `pls` | tinyint unsigned | 格子ID |
| `poi_id` | varchar(32) | POI模板ID（关联 poi_table.php） |
| `searched` | tinyint(1) unsigned | 0=未搜索 1=已搜索 |
| `search_count` | tinyint unsigned | 搜索次数 |
| `last_search_turn` | int unsigned | 上次搜索回合 |

索引: `idx_pgroup_pls(pgroup, pls)`

### 5.4 `bra_oblmapitem` — 地图道具实例

| 字段 | 类型 | 说明 |
|------|------|------|
| `iid` | mediumint unsigned | 道具实例ID（自增主键） |
| `pgroup` | tinyint unsigned | 区域ID |
| `pls` | tinyint unsigned | 格子ID |
| `iaid` | mediumint unsigned | 关联POI实例ID，0=散落/掉落 |
| `item_id` | varchar(32) | 道具模板ID（关联 item_table.php） |
| `itm` | char(30) | 道具名 |
| `itmk` | char(40) | 道具种类 |
| `itme` | int(10) unsigned | 效果值 |
| `itms` | char(10) | 耐久 |
| `itmsk` | char(40) | 耐久种类 |
| `itmpara` | text | 参数(JSON数组) |
| `discovered` | tinyint(1) unsigned | 0=未发现 1=已发现 2=近视(拟态/假名) |
| `fake_item_id` | varchar(32) | 近视时假道具ID |
| `is_trap` | tinyint(1) unsigned | 是否为陷阱 |

索引: `idx_pgroup_pls(pgroup, pls)`, `idx_iaid(iaid)`

### 5.5 `bra_oblqueue` — 先攻队列

| 字段 | 类型 | 说明 |
|------|------|------|
| `qid` | int | 队列编号（关联 oblbattle_state.qid） |
| `pid` | int | 参战者 PID |
| `myorder` | int | 先攻顺序（小=优先） |
| `done` | tinyint(1) | 0=未行动 1=已行动 |
| `last_acted` | int | 上一个行动者的 myorder 值（原名 `qorder`，用于日志/调试） |

主键: `pid`（一个角色最多保留一条队列记录）；调度索引: `idx_qid_turn_order(qid, active, done, myorder)`。动态成员以 `myorder=max+1, active=1, done=0` 追加，不重投已有成员先攻。

`oblplayers`、`oblqueue`、`oblbattle_state`、`oblmapstates`、`oblmappoi`、`oblmapitem` 和 `oblgame` 的建表模板均使用 InnoDB，确保 command/heartbeat 请求事务覆盖实际写路径。

### 5.6 `bra_oblbattle_state` — 战斗状态机

| 字段 | 类型 | 说明 |
|------|------|------|
| `qid` | int | 主键（= 战场编号） |
| `state` | varchar(32) | 状态值（`PLAYER_TURN`/`PROCESSING`/...） |
| `next_pid` | int | 当前顺位者 PID（0=无，`battle_manage_queue` 统一维护） |
| `round_num` | int | 回合计数（Round） |
| `updated_at` | int | 时间戳 |

---

## 五、API 接口

### 5.0 通用约定

> **重要：响应中的数值字段是混合类型**
>
> 数据库直接读出的旧字段（如 `pid`/`hp`/`ap`）通常仍是 **string**；后端显式 `(int)` 归一化的字段（如 `obl_tick`、`presentation_head_seq`、`presentation.v1.batch_seq/event_seq`）是 **number**。`compatible_json_encode()` 只是调用 `json_encode()`，不会自动统一数值类型。
>
> 前端应按具体 API 契约声明类型，并在业务计算边界使用 `Number()` 防御性归一化。详见 [vex-vue/CODEBASE.md](../../vex-vue/CODEBASE.md) 类型定义章节。

### 5.1 通用协议

- 入口: `oblivions/api/state.php?scope=xxx`
- 认证: Cookie 中的 `$cuser` / `$cpass`
- 响应格式:
```json
{ "status": "success"|"error", "data": {...}, "message": "..." }
```
- 错误响应: `{ "status": "error", "error": { "code": "NOT_OBLIVIONS", "message": "..." } }`

### 5.2 `game_map` — 地图数据（Oblivions扩展）

- **请求**: `GET oblivions/api/state.php?scope=game_map`
- **Oblivions扩展**: 当 `oblivions_is_active()` 为 true 时，额外返回 `links` 字段
- **响应**:
```json
{
  "status": "success",
  "data": {
    "currentLocation": 1,
    "currentRegion": 1,
    "links": {
      "regions": {
        "1": { "name": "垃圾平原", "entrance_pls": 1, "exit_pls": 10, ... },
        "2": { "name": "腐烂沼泽", ... }
      },
      "tiles": {
        "1": { "1": { "name": "废墟入口", "neighbors": [2,3], "x": 0, "y": 0, "passable": true }, ... },
        "2": { "1": { ... }, ... }
      },
      "grids": {
        "1": { "cols": 10, "rows": 10 },
        "2": { "cols": 6, "rows": 4 }
      }
    }
  }
}
```

**前端用途**: `links.tiles[pgroup][pls].neighbors` 用于渲染可移动方向；`links.grids` 用于网格布局；`links.regions` 用于区域信息展示。

### 5.3 `tile_actions` — 当前格交互数据

- **请求**: `GET oblivions/api/state.php?scope=tile_actions`
- **前置条件**: 必须在 Oblivions 模式下
- **响应**:
```json
{
  "status": "success",
  "data": {
    "pois": [
      {
        "iaid": 1,
        "poi_id": "supply_cache",
        "name": "补给储藏箱",
        "desc": "...",
        "searchable": true,
        "repeatable": false,
        "searched": false,
        "search_count": 0,
        "items": [
          {
            "iid": 1,
            "item_id": "supply_pack",
            "itm": "补给包",
            "itmk": "HH",
            "itme": 30,
            "itms": "3",
            "itmsk": "",
            "itmpara": "",
            "discovered": 1
          }
        ],
        "repeat_limit": 0,
        "repeat_cooldown": 3,
        "mechanic": "max_hp_up",
        "mechanic_value": 10,
        "mechanic_params": []
      }
    ],
    "ground_items": [
      {
        "iid": 5,
        "item_id": "scrap_metal",
        "itm": "废铁片",
        "itmk": "MT",
        "itme": 5,
        "itms": "1",
        "itmsk": "",
        "itmpara": "",
        "discovered": 1,
        "display_name": "废铁片（？）",
        "fake_item_id": "xxx",
        "is_trap": 0
      }
    ]
  }
}
```

**字段说明**:
- `pois[].items`: POI 关联道具（仅 `discovered>0` 的返回）
- `ground_items`: 散落道具（`iaid=0`，仅 `discovered>0` 的返回）
- 近视道具（`discovered=2`）额外返回 `display_name`（带"？"后缀）、`fake_item_id`、`is_trap`
- 机制型POI额外返回 `mechanic`/`mechanic_value`/`mechanic_params`

### 5.4 `obl_log` — 结构化日志

- **请求**: `GET oblivions/api/state.php?scope=obl_log`
- **前置条件**: 必须在 Oblivions 模式下
- **响应**:
```json
{
  "status": "success",
  "data": {
    "entries": [LogEntry, LogEntry, ...],
    "total": 42
  }
}
```

**LogEntry 结构**:

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 细粒度 ID，命名规则 `{logcategory}.{subevent}`，如 `move.success`、`pickup.trap` |
| `logcategory` | string | 粗粒度日志类别，8 类之一：`move`/`explore`/`search`/`pickup`/`discard`/`system`/`enemy`/`battle` |
| `params` | object | 模板参数，值限 string/number/boolean。可为空对象 `{}` |
| `html` | string\|null | fallback HTML，正常为 `null`。仅用于前端模板无法覆盖的极端情况 |
| `debug` | bool | 是否为 debug 日志（由 `OblivionsLogger::DEBUG_IDS` 清单自动判定），前端默认不渲染 |
| `ts` | number | `time()` 返回的 Unix 秒级时间戳 |

- `entries`：日志条目数组，按时间正序（旧→新）
- `total`：当前存储的条目总数（正式日志 200 条 + debug 日志 50 条，分开计数）

**ID 命名规则**：`{logcategory}.{subevent}`，如 `move.success`、`organize.fail`、`search.result`。完整 ID 清单见前端 `vex-vue/src/data/log-templates.ts`。

**debug 分类**：`OblivionsLogger::DEBUG_IDS` 常量声明 debug 日志 ID 清单（当前含 `enemy.move`、`battle.invalid`）。这些日志持久化保留但前端默认不渲染，debug 模式下显示并加 `[DBG]` 前缀。

### 5.5 `presentation.v1` — command/heartbeat 实时演出批次

command 与 heartbeat 的成功响应顶层始终可返回 `presentation_head_seq`；本请求存在 render events 时同时返回 `presentation`：

```json
{
  "presentation_head_seq": 12,
  "presentation": {
    "schema": "presentation.v1",
    "batch_seq": 12,
    "groomid": 1,
    "recipient_pid": 19,
    "qid": 7,
    "request_id": "obl-...",
    "tick": 31,
    "state_after": { "pid": 19, "action": "", "bid": 0, "battle_state": "IDLE" },
    "events": [BattleLogV2Event]
  }
}
```

约束：

- `batch_seq` 在 `oblgame.vars_json.obl_presentation_head_seq` 中事务性递增；事务回滚不消耗序号。
- `events` 只包含 `debug=false` 的 battlelog.v2 render events，并按 `event_seq` 排序。
- 在线投递为 best-effort；缺批时前端接受最新权威状态并 rebase，不调用补拉接口。
- `player_info.presentation_head_seq` 供 F5/冷启动直接把 runtime cursor 快进到 server head。
- 已删除 `battle_log` State scope、mutable JSON 和 played/mark 接口。

### 5.6 `enemies` — 当前区域敌人列表

- **请求**: `GET oblivions/api/state.php?scope=enemies`
- **前置条件**: 必须在 Oblivions 模式下
- **响应**:
```json
{
  "status": "success",
  "data": {
    "enemies": [
      {
        "pid": 101,
        "type": 1,
        "name": "废铁史莱姆",
        "icon": "enemy_slime",
        "gd": "m",
        "pgroup": 1,
        "pls": 5,
        "hp": 50,
        "mhp": 50,
        "lvl": 1,
        "state": 0,
        "discovered": 1
      }
    ]
  }
}
```

**字段说明**:
- `enemies[]`：当前区域已发现的敌人列表（`discovered=1` 且 `state=0` 存活）
- 若玩家处于战斗状态（`action='battle'`），确保返回战斗对象（即使 `discovered=0`）
- 字段由 `obl_simplify_enemy_data()` 精简，仅返回前端渲染所需字段

### 5.7 `player_info` — 玩家信息（含 groomid / combat_context）

Oblivions 模式下 `player_info` 额外返回 `groomid` 字段。处于战斗或存在战斗队列时，响应同时返回 `battle_queue` 与 `combat_context`；它们是当前 qid、成员和回合权限的权威视图。自由瞄准的展示/可提交候选由独立 `combat_targets` scope 提供。

```php
api_response('success', array(
    'pid'     => $pdata['pid'],
    'groomid' => $groomid,  // 房间 ID（供前端调用零依赖接口）
    'action'  => $pdata['action'],
    'bid'     => $pdata['bid'],
    'battle_queue' => $queue,
    'combat_context' => $combatContext,
    // ... 其他字段
));
```

**CombatViewModel 字段**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `qid` | number | 战场 / 先攻队列 ID |
| `state` | `IDLE\|PLAYER_TURN\|PROCESSING` | 当前战斗状态机状态 |
| `playerPid` | number | 当前玩家 PID |
| `roundNum` | number | 当前队列 round_num |
| `currentActorPid` / `currentActorType` | number\|null | 当前顺位 actor |
| `canSubmitTurn` | bool | 当前玩家是否可提交 `battle.submit_turn` |
| `combatants[]` | CombatantViewModel[] | 战斗成员快照（pid/type/name/hp/ap/pgroup/pls/active/done/myorder） |
| `validTargets[]` | CombatTargetViewModel[] | 当前 qid active 角色的兼容投影，不含 joinable |
| `suggestedTargetPid` | number\|null | 建议 focus PID，不自动写入动作 |

前端类型定义位于 `vex-vue/src/types/api.ts`：`CombatViewModel` / `CombatantViewModel` / `CombatTargetViewModel`。

### 5.8 `combat_targets` — 战斗候选视图

- **请求**：`GET oblivions/api/state.php?scope=combat_targets`
- **响应**：`{ qid: number|null, suggestedTargetPid: number|null, candidates: CombatTargetCandidate[] }`
- **候选字段**：`pid/relation/participation/selectable/reason/character`
- **Participation**：`member` 与 `joinable` 可提交；`left`、`other_battle`、`blocked` 仅展示，不可提交
- **身份边界**：`qid` 是 battle session identity；suggested PID 只是 focus。前端在 API 边界把 qid 统一 normalize 为 `number|null`，并拒绝旧 qid 的迟到候选响应。

State scope 只提供候选投影，具体技能射程、Aim/Capture 和 Participation 会在 preview/execute 时由后端再次校验。

### 5.9 `craft_preview` — 合成预判（前端用）

- **请求**: `GET oblivions/api/state.php?scope=craft_preview&slots=1,3,5&workbench_materials=poi:123`
- **前置条件**: 必须在 Oblivions 模式下
- **参数**:
  - `slots` (string) — 逗号分隔的背包槽位号，数量不限
  - `workbench_materials` (string, 可选) — 逗号分隔的工作台素材 ID
- **响应**:
```json
{
  "status": "success",
  "data": {
    "match_count": 1,
    "craftable": true,
    "recipe_id": "craft_bandage",
    "preview_log": {"id": "craft.ready", "params": {}}
  }
}
```
- `match_count = 0` → 不亮（无匹配，preview_log 返回失败原因：tool_missing/extra_material/insufficient/fail_no_match）
- `match_count = 1` → 亮灯（可合成，preview_log 返回 craft.ready）
- `match_count >= 2` → 不亮（指向不明确，preview_log 返回 craft.fail_ambiguous）
- `recipe_id` → match_count=1 时为匹配配方 ID，否则 null（供前端查 recipes 显示消耗）
- `preview_log` → 单对象 `{id, params}`，复用 log-templates.ts 模板渲染（详见前端契约补丁设计案 §2）

### 5.10 `craft_workbench_materials` — 可用工作台素材

- **请求**: `GET oblivions/api/state.php?scope=craft_workbench_materials`
- **前置条件**: 必须在 Oblivions 模式下
- **响应**:
```json
{
  "status": "success",
  "data": {
    "workbench_materials": [
      {"source": "passive", "id": "passive:innate_t0", "item_id": "innate_craft_t0", "tool_level": 0},
      {"source": "poi",     "id": "poi:123",           "item_id": "forge_t1",        "tool_level": 1}
    ]
  }
}
```
- `source` 来源：`passive`（永久可用）/ `cat`（猫身边，P0 未实现）/ `poi`（需站在该 POI 上）
- `id` 传给 `obl_craft` / `craft_preview` 的 `workbench_materials` 参数

### 5.11 `craft_recipes` — 配方列表

- **请求**: `GET oblivions/api/state.php?scope=craft_recipes`
- **前置条件**: 必须在 Oblivions 模式下
- **响应**:
```json
{
  "status": "success",
  "data": {
    "recipes": [
      {"recipe_id": "craft_bandage", "category": "tool", "materials": [...], "results": [{"item_id": "bandage", "count": 1}]}
    ]
  }
}
```
- 过滤逻辑：返回所有配方，经 `item_recipe_visibility_filter` 过滤（P0 默认全部可见）
- 取消"已发现/未发现"机制：所有配方天然可见，软锁通过资源可达性自然限制（玩家不到 POI → 工作台素材不可用 → 配方实际无法合成，但配方仍可查看了解需求）

**零依赖设计**：详见 [DESIGN.md §2.5](./DESIGN.md#25-零依赖接口设计)。

### 5.13 Heartbeat `tick_frame` / `changed_scopes`

`oblivions/api/heartbeat.php` 返回 Command-style JSON。`data.tick_frame` 是本次 pending tick 的 TickFrameResult，`data.changed_scopes` 是从 TickFrameResult 汇总出的前端刷新范围。

```json
{
  "status": "success",
  "data": {
    "resolved": true,
    "advanced": true,
    "tick": 42,
    "processed_tick": 41,
    "pending_tick": true,
    "tick_frame": {
      "delta": 1,
      "phases": [
        {"name": "combat_domain", "changed_scopes": ["player_info"]},
        {"name": "world_ai_domain", "changed_scopes": ["game_map", "enemies"]}
      ],
      "actor_behaviors": {},
      "changed_scopes": ["player_info", "game_map", "enemies"]
    },
    "changed_scopes": ["player_info", "game_map", "enemies"]
  }
}
```

前端 `vex-vue/src/api/client.ts::getHeartbeatChangedScopes()` 兼容读取 `changed_scopes` / `changedScopes`。`command-queue.ts` 与 `battle.ts` 使用该列表触发 `dataManager.invalidate(scope)`，并在包含 `game_map` / `enemies` 时刷新地图实体。

---

## 六、命令路由

### 6.1 JSON Command API 提交格式

Oblivions 新写操作通过独立入口提交，不再调用根目录旧 `command.php`：

```txt
POST /phpdts/oblivions/api/command.php
Content-Type: application/json
```

请求 envelope：

```json
{
  "command": "map.explore",
  "request_id": "client-generated-id",
  "payload": {},
  "expected": {}
}
```

### 6.2 新命令名

| command | 说明 |
|---|---|
| `map.move` | 移动到目标格 |
| `map.explore` | 探索当前格 |
| `poi.search` | 搜索 POI |
| `item.pickup` | 拾取道具 |
| `item.discard` | 丢弃道具 |
| `item.use` | 使用道具 |
| `inventory.organize` | 整理背包 / 处理 itm0 |
| `craft.execute` | 执行合成 |
| `battle.start` | 开始战斗 |
| `battle.submit_turn` | 提交玩家回合战斗动作队列 |

### 6.3 Command API 执行流程

```
oblivions/api/command.php
  → require include/api/obl_command_api_bootstrap.php
  → obl_runtime_boot('command')
  → method / mode / envelope 检查
  → obl_runtime_acquire_room_lock()         // 房间级 DB lock
  → obl_runtime_transaction_begin()         // InnoDB 请求事务
  → obl_runtime_reload_tick_globals()
  → obl_command_api_handle($envelope)       // Command Bus
      → contract + payload 校验
      → player auth + player flock lock
      → 状态门控 / itm0 门控 / expected 冲突检查
      → obl_command_handler_dispatch()      // 调用 domain 函数
      → domain save + tick lifecycle
  → commit 或 rollback-only rollback
  → commit 后持久化 collector；失败附加 warning
  → obl_runtime_release_room_lock()
  → JSON response
```

**Command API 响应 schema**（统一由 `obl_command_response.php` 输出）：

```json
{
  "status": "success",
  "code": "OK",
  "request_id": "client-generated-id",
  "data": {
    "command": "battle.submit_turn",
    "feedback": { "id": "battle.start", "params": { "enemy_pid": 101 } },
    "refresh": ["player_info", "enemies"],
    "server_state": { "action": "battle", "bid": 42, "battle_state": "PROCESSING" },
    "actions": [
      {
        "actId": "unarmed_strike",
        "status": "resolved",
        "resolvedAim": { "kind": "character", "pid": 101 },
        "capturedTargetCount": 1,
        "targets": [{ "pid": 101, "status": "resolved", "participation": "joined" }]
      }
    ]
  }
}
```

错误响应：`{ "status": "error", "code": "BATTLE_BUSY", "request_id": "...", "data": { "feedback": {...}, "refresh": [...] } }`。`code` 取值由 Command Bus gate / dispatch 返回（`UNKNOWN_COMMAND` / `AUTH_FAILED` / `COMMAND_IN_PROGRESS` / `COMMAND_NOT_ALLOWED` / `ITM0_PENDING` / `STATE_CONFLICT` / `BATTLE_BUSY` / `INTERNAL_ERROR` 等）。

> `feedback.id + params` 复用前端 `vex-vue/src/data/log-templates.ts` 模板，由 `vex-vue/src/data/command-feedback.ts` 渲染文案。后端不输出用户可见文案。

**事务边界**：command 与 heartbeat 都在 room `GET_LOCK` 内开启 InnoDB 事务。事务开始时设置 `obl_db_throw_on_error=true`，DB adapter 将非 SILENT SQL 失败抛为 `RuntimeException`；正常路径只 commit 一次，异常/rollback-only 路径只 rollback 一次。shutdown guard 只对仍 active 的事务执行兜底 rollback，并释放 room lock。BattleLogCollector 在事务中只积累内存事件，commit 后才写文件；commit 后 fatal 已不可回滚。`request_id` 当前只校验格式并回显，不做幂等去重。

### 6.4 当前架构边界

- 根目录旧 `command.php` 不升级为 JSON，只作为旧核心入口/兼容路径保留。
- `oblivions/include/core/obl_command.php` 已标记为 deprecated，仅服务旧根 `command.php` 的兼容处理器。
- 新写操作统一走 `oblivions/api/command.php` + `include/command/obl_command_bus.php`。
- 前端通过 `oblivions/api/state.php` 获取业务数据，命令响应只返回统一 Command API 结果与刷新建议。

### 6.4.1 战斗状态机三态与转换触发点

战斗状态机由 [`battle_state_machine.func.php`](../include/game/battle_state_machine.func.php) 实现，存储在 `bra_oblbattle_state` 表（按 qid 分离）。三态转换的代码触发点：

| # | 转换 | 触发位置 | 触发时机 |
|---|------|---------|---------|
| 1 | (创建) → PROCESSING | [`battle.queue.func.php:154`](../include/game/battle/battle.queue.func.php#L154) `obl_battle_state_create($qid, OBL_BS_PROCESSING)` | `battle_queue_create_and_init` 创建先攻队列后 |
| 2 | PLAYER_TURN → PROCESSING | `obl_command_after_dispatch()` / Command Bus tick lifecycle 触发 `obl_battle_state_transition($qid, 'player_acted')` | 玩家提交推进 tick 命令后 |
| 3 | PROCESSING → PLAYER_TURN | [`battle.queue.main.php:172`](../include/game/battle/battle.queue.main.php#L172) `obl_battle_state_transition($qid, 'player_turn')` | `battle_manage_queue` 检测下一顺位是玩家时 |
| 4 | PROCESSING → PLAYER_TURN | [`enemy_ai.func.php:81`](../include/game/enemy_ai.func.php#L81) `obl_battle_state_transition($qid, 'player_turn')` | `obl_tick_phase_battle_npc` 调度 NPC 行动时，发现下一顺位是玩家 |
| 5 | PROCESSING → PROCESSING | `obl_battle_state_refresh($qid)` | NPC 持续行动（self_loop 转换的轻量替代，仅刷新时间戳） |
| 6 | 任意 → IDLE | [`battle.queue.main.php:141`](../include/game/battle/battle.queue.main.php#L141) `obl_battle_state_transition($qid, 'battle_end')` + `obl_battle_state_destroy($qid)` | 队列解散时 |
| 7 | (异常恢复) PROCESSING → PLAYER_TURN | [`battle_state_machine.func.php:150`](../include/game/battle_state_machine.func.php#L150) `obl_battle_state_reset($qid, OBL_BS_PLAYER_TURN)` | `obl_battle_state_find_stale` 检测 PROCESSING 超过 30 秒未更新 |

**状态转换表**（[battle_state_machine.func.php L104-117](../include/game/battle_state_machine.func.php#L104-L117)）：

```
IDLE        + battle_start → PROCESSING
PLAYER_TURN + player_acted → PROCESSING
PLAYER_TURN + battle_end   → IDLE
PROCESSING  + player_turn  → PLAYER_TURN
PROCESSING  + battle_end   → IDLE
PROCESSING  + self_loop    → PROCESSING（仅刷新时间戳）
```

**非法转换处理**：不在转换表中的事件被记录到 `$obl_error_log`（`battle_state.illegal_transition`），保持原状态，不抛异常（避免阻塞流程）。

**与命令执行流程的关系**（Command Bus 中对应位置）：
- `obl_command_allowed_by_contract()`：检查 `action` 字段（玩家维度，normal/battle），返回 `COMMAND_NOT_ALLOWED`
- `obl_command_gate()` 的 `BATTLE_BUSY` 分支：检查 `obl_battle_state` 字段（战场维度，PROCESSING），拒绝推进 tick 命令（`battle.submit_turn` 自身例外）
- `obl_command_after_dispatch()`：触发状态机过渡（`player_acted` 事件，`PLAYER_TURN → PROCESSING`）

> 旧 deprecated `obl_command.php` 中的 `[C2]` / `[C2b]` / `[C2d]` 段名是上述逻辑的等价实现，新前端走 Command Bus 不经过这些段。

设计原则与概念解释详见 [DESIGN.md §2.9.2](./DESIGN.md#292-战场状态机三态obl_battle_state-字段)。

### 6.5 并发锁机制

详见 [DESIGN.md §2.6](./DESIGN.md#26-flock-并发锁--前端短锁)。

**后端锁实现**：
```php
$lock_name = obl_runtime_acquire_room_lock(5);
// ...
$lock = obl_command_acquire_lock($groomid, $pdata['pid']);
if (!$lock['ok']) {
    return obl_command_response_error('COMMAND_IN_PROGRESS', '上一个命令仍在处理中');
}
// 房间锁由入口显式 release；玩家 flock 在进程结束/脚本 exit 时由 OS 自动释放
```

---

## 七、游戏数据文件

### 7.1 `obl_config.php` — 可调参数

```php
return [
    'explore_sp_cost'    => 0,    // 探索消耗体力
    'vision_range'       => 1,    // 视野范围等级（BFS跳数）
    'memory_range'       => 3,    // 每次探索最多发现道具数
    'move_sp_cost'       => 0,    // 每格移动消耗体力
    'log_max_entries'    => 200,  // 结构化日志最大条目数
    'battlelog_schema'   => 'v2', // PresentationBatch 内事件结构
];
```

读取方式: `obl_get_config()`（带静态缓存）

### 7.2 `item_table.php` — 道具模板

```php
'item_id' => [
    'itm'         => string,  // 道具名（deprecated: 文案将移至前端 item-locale.ts）
    'itmk'        => string,  // 种类代码 (WP/WK/WG/WD/WF/AR/AH/AA/MT/HH/HS/DX/TK/SP)
    'itme'        => int,     // 效果值
    'itms'        => string,  // 耐久
    'itmsk'       => string,  // 耐久种类
    'itmpara'     => string,  // 参数(JSON)
    'desc'        => string,  // 描述（deprecated: 文案将移至前端 locale）
    'tier'        => string,  // 稀有度: common/uncommon/rare/epic
    'stack'       => bool,    // 是否可堆叠
    'stack_limit' => int,     // 堆叠上限（仅stack=true时）
    // ─── 道具系统扩展字段（《道具使用与合成系统-设计案》）───
    'tags'        => array,   // 性质描述 Tag + 系统钩子 Tag ID 数组
    'use_effect'  => string,  // 使用效果名（非空时 tags 必须含 tag_usable）
    'tool_level'  => int,     // 工具等级（仅工作台/工具类道具有效，0=无等级）
]
```

**种类代码**: WP=钝器 WK=刃器 WG=枪械 WD=投掷 WF=灵符 AR=身体防具 AH=头部防具 AA=饰品 MT=材料 HH=恢复 HS=食物 DX=药物 TK=工具 SP=特殊

**Tag 相关函数**: `item_get_tags()` / `item_has_tag()` / `item_get_itmk()` / `item_get_tool_level()` / `item_get_items_by_tag()` 定义于 `item.tag.func.php`，带静态缓存。

### 7.3 `poi_table.php` — POI模板

```php
'poi_id' => [
    'name'            => string,  // POI名称
    'desc'            => string,  // 描述
    'searchable'      => bool,    // 是否可搜索
    'repeatable'      => bool,    // 是否可重复搜索
    'repeat_limit'    => int,     // 最大搜索次数(0=无限)
    'repeat_cooldown' => int,     // 冷却回合数
    'mechanic'        => string,  // 机制名(如 max_hp_up/learn_skill/craft_source)
    'mechanic_value'  => mixed,   // 机制值
    'mechanic_params' => array,   // 机制参数
]
```

**`mechanic='craft_source'`**：工作台 POI，`mechanic_value` 存储 `item_id` 指向工作台道具。玩家站在该 POI 上时，由 `item_get_available_workbench_materials()` 将其作为工作台素材加入可用列表。（详见《道具使用与合成系统-设计案》§3.5）

### 7.4 `poi_loot.php` — POI掉落表

```php
'poi_id' => [
    'loot' => [                           // 首次搜索掉落
        ['item_id' => string, 'count' => int|[min,max], 'rate' => float],
    ],
    'repeat_loot' => [                    // 重复搜索掉落（可选）
        ['item_id' => string, 'count' => int|[min,max], 'rate' => float],
    ],
]
```

### 7.5 `map.php` — 区域元数据

```php
return [
    'regions' => [
        '1' => [
            'name'         => string,
            'desc'         => string,
            'entrance_pls' => int,      // 入口格pls
            'exit_pls'     => int,      // 出口格pls
            'next_region'  => int|null, // 下一区域ID
            'prev_region'  => int|null, // 上一区域ID
            'exit_links'   => [int],    // 出口连接的区域ID列表
        ],
    ],
    'grids' => [
        '1' => ['cols' => 10, 'rows' => 10],
        '2' => ['cols' => 6,  'rows' => 4],
    ],
];
```

### 7.6 `tiles/region_{pgroup}.php` — 地图格数据

```php
'pls' => [
    'name'         => string,   // 格名
    'desc'         => string,   // 格描述
    'floor'        => string,   // 地板类型(standard/metal/...)
    'tide'         => string,   // 潮汐区(shallow/deep/abyss)，不含 safe
    'passable'     => bool,     // 是否可通行
    'neighbors'    => [int],    // 邻接格pls列表
    'x'            => int,      // 网格X坐标
    'y'            => int,      // 网格Y坐标
    // 以下为可选/占位字段
    'preset_safe'  => bool,     // 安全区状态标记，仅前端视觉用，后端不读取
    'height'       => int,      // 占位：未来高度系统 TODO（默认 0）
    'destructible' => bool,     // 占位：未来可破坏地形 TODO（默认 false）
],
```

> **数据一致性提示**：有名格（手写）通常只有前 8 个字段，无名格（编辑器生成）带全部 11 个字段。前端读取 `preset_safe` 时用 `!!` 容错缺失情况。

### 7.7 `scatter_pool.php` / `poi_pool.php` — 生成池

按潮汐区分桶，`scatter_pool` 控制野生道具生成，`poi_pool` 控制POI生成：

```php
'tide_zone' => [
    ['item_id' => string, 'count' => int|[min,max], 'rate' => float],  // scatter_pool
    ['poi_id' => string, 'per_region' => int],                          // poi_pool
]
```

### 7.8 `recipe_table.php` — 合成配方表

合成配方定义文件 `oblivions/gamedata/recipe_table.php`。**仅含游戏逻辑，不含文案**（文案由前端 `recipe-locale.ts` 提供）。

```php
return [
    'craft_bandage' => [
        'category'  => 'tool',                     // 分类标识（tool/armor/food/weapon），用于前端显示过滤
        'materials' => [
            ['item_id' => 'cloth', 'count' => 3, 'consume' => 'all'],          // 精确匹配指定道具
        ],
        'results'   => [
            ['item_id' => 'bandage', 'count' => 1],
        ],
    ],
    'craft_frying_pan' => [
        'category'  => 'tool',
        'materials' => [
            ['tag' => 'tag_forge', 'min_level' => 1, 'count' => 1, 'consume' => 'none'],  // 性质 Tag + 工具等级
            ['itmk' => 'MT', 'count' => 4, 'consume' => 'all'],                            // 大类匹配
        ],
        'results'   => [
            ['item_id' => 'frying_pan', 'count' => 1],
        ],
    ],
];
```

**匹配规则**（由 `item_resolve_material_mapping` 实现）：
- 匹配优先级：`item_id` > `itmk` > `tag`
- `consume`：`'all'`=消耗 / `'durability'`=扣耐久 / `'none'`=返还（工作台素材只能匹配 `'none'`）
- `min_level`：要求素材 `tool_level >= min_level`（高级工具兼容低级）
- 所有放置的素材必须都被消耗，多放算不匹配
- 同一素材不能同时满足多个槽位

读取函数：`item_get_recipe()` / `item_get_all_recipes()`（带静态缓存）。

### 7.9 `enemies_config.php` — NPC 敌人类型定义

定义每种敌人的静态属性。与 `item_table.php` / `poi_table.php` 同层，只定义属性，不关心分布（分布由 `enemy_pool.php` 按潮汐区控制）。NPC 与玩家共用 `bra_oblplayers` 表，通过 `type` 字段区分（`type>0` 为敌人类型 ID）。

```php
$obl_enemies_config = array(
    // 敌人类型 ID => 配置
    1 => array(
        'name'            => string,   // 敌人名称
        'icon'            => string,   // 图标标识
        'gd'              => string,   // 性别
        'hp'/'mhp'        => int,      // 当前/最大 HP
        'sp'/'msp'        => int,      // 当前/最大 SP
        'att'/'def'       => int,      // 攻击/防御
        'lvl'             => int,      // 等级
        'ai_type'         => string,   // AI 类型：patrol/aggressive/idle
        'vision_range'    => int,      // 感知范围（BFS 跳数）
        'action_chance'   => float,    // 行动意愿（每 tick 行动概率，0-1）
        'skills'          => [string], // 技能 ID 列表
        'strategy_slots'  => [         // 初始策略槽（4 槽）
            ['type' => 'skill', 'id' => 'basic_attack'],
            null, null, null,
        ],
    ),
);
```

**当前定义的敌人类型**：

| type | 名称 | AI 类型 | 感知范围 | 行动意愿 | 等级 |
|------|------|---------|---------|---------|------|
| 1 | 废铁史莱姆 | patrol | 3 | 0.4 | 1 |
| 2 | 锈蚀守卫 | aggressive | 5 | 0.7 | 2 |

### 7.10 `enemy_pool.php` — NPC 敌人刷新池

按潮汐区分桶，控制每个潮汐区生成哪些敌人 + 数量。与 `scatter_pool.php` / `poi_pool.php` 完全对齐。

```php
return [
    'shallow' => [
        ['enemy_type' => 1, 'count' => [3, 5]],  // 废铁史莱姆 3-5 个
        ['enemy_type' => 2, 'count' => [1, 2]],  // 锈蚀守卫 1-2 个
    ],
    'deep' => [
        ['enemy_type' => 2, 'count' => [3, 5]],
    ],
    'abyss' => [],
];
```

**生成规则**：
- `count` 为 `[min, max]` 区间，初始化时随机取值
- 每个潮汐区独立配置，互不影响
- 区域的潮汐区由 `tiles/region_{pgroup}.php` 中每个格的 `tide` 字段决定
- 只选 `passable=1` 的格，排除区域出入口（`entrance_pls` / `exit_pls`）
- 排除已被其他单位占用的格（一个格一个单位）

---

## 八、核心函数索引

### 8.1 player.func.php — 玩家数据层

| 函数 | 签名 | 说明 |
|------|------|------|
| `obl_auth_player` | `($username, $password): int\|false` | user 表双重校验，返回 oblplayers.pid |
| `obl_fetch_playerdata_by_pid` | `($pid): array\|false` | 按 pid 抓取原始数据（JSON 未解码） |
| `obl_fetch_playerdata_batch` | `(array $pids): array` | 批量抓取多 pid 玩家数据 |
| `obl_fetch_playerdata_by_name` | `($name): array\|false` | 按 name 抓取并格式化（type=0 玩家） |
| `obl_fetch_enemies_by_region` | `($pgroup): array` | 批量获取区域内敌人（type>0，已格式化） |
| `obl_format_playerdata` | `(array &$pdata): void` | 解码所有 JSON 字段，保证结构合法（itempara/tacpara/skillpara/oblpara/装备 para） |
| `obl_save_player` | `(array &$pdata): void` | 编码 JSON 字段并 UPDATE 到 oblplayers（不同步 bra_players） |
| `obl_game_entrypoint` | `($entry_type = 'game'): array` | 入口封装：cookie 校验 → 抓取 → 格式化 |
| `obl_entrypoint_handle_failure` | `($status, $entry_type): void` | 认证失败处理（command 返回 JSON，game 跳转登录） |
| `obl_create_player_record` | `($ndata): int\|false` | valid.php 激活时创建 oblplayers 记录（从 $ndata itm1~itm6 构建 itempara） |
| `obl_command_allowed_by_state` | `($command, $action): bool` | 旧 deprecated 命令状态过滤（被 Command Bus `obl_command_allowed_by_contract` 替代）：action='battle' 只允许 `battle.submit_turn`；非战斗状态不允许 `battle.submit_turn`（`battle.start` 仍允许） |

> 道具栏槽位读写函数（`obl_get_items` / `obl_get_item` / `obl_set_item` / `obl_find_empty_slot` / `obl_is_bag_full`）已迁至 [§8.14.0 item.basic.func.php](#8140-itembasicfuncphp--道具库存基础操作)。

### 8.2 tick.func.php

游戏刻核心模块：标记管理 + 推进控制 + TickFrame 行为账本 + BattleActorScope + 监听器注册 + 事件调度 + 命令推进判定。

| 函数 | 签名 | 说明 |
|------|------|------|
| `obl_tick_request_advance` | `(): void` | 请求推进 tick（监听器调用，替代旧的 $obl_tick_advanced 引用传递） |
| `obl_tick_consume_advance` | `(): bool` | 消费"请求推进"标记（读取并清除） |
| `obl_tick_reset_advance` | `(): void` | 重置"请求推进"标记（调度开始时调用） |
| `obl_tick_advance` | `(): void` | 推进 1 游戏刻（obl_tick++ + 标记 $ginfochange，不调 save_gameinfo） |
| `obl_tick_synchronize` | `(): void` | 同步 obl_pretick = obl_tick（标记已处理） |
| `obl_tick_get` | `(): int` | 获取当前游戏刻 |
| `obl_tick_get_pretick` | `(): int` | 获取已处理到的游戏刻 |
| `obl_command_advances_tick` | `($command): bool` | 命令是否推进游戏刻（白名单：`map.move`/`map.explore`/`poi.search`/`battle.start`/`battle.submit_turn`；contract 用 `advances_tick` 字段声明） |
| `obl_tick_ctx_actor_has_behavior` | `(&$ctx, $pid): bool` | 查询 actor 在当前 TickFrame 是否已执行过主动行为 |
| `obl_tick_ctx_claim_actor_behavior` | `(&$ctx, $pid, $domain, $behavior, $meta = array()): bool` | 登记 actor 本 TickFrame 的主动行为；同一 actor 同 tick 只能登记一次，domain 限 `combat` / `world` |
| `obl_tick_ctx_mark_battle_actor` | `(&$ctx, $pid): void` | 将 actor 标记为当前 TickFrame 的战斗域成员 |
| `obl_tick_ctx_merge_battle_actor_scope` | `(&$ctx, $pids): void` | 合并一组 BattleActorScope pid |
| `obl_tick_ctx_actor_in_battle_scope` | `(&$ctx, $pid): bool` | 查询 actor 在当前 TickFrame 入口是否属于战斗域 |
| `obl_tick_collect_battle_actor_ids` | `(): array` | 从 `oblplayers` 收集当前 `action='battle' OR bid>0` 的 actor pid |
| `obl_tick_ctx_snapshot_battle_actors` | `(&$ctx): void` | 初始化 TickFrame 实时 BattleActorScope |
| `obl_tick_prepare_pending_battle_actor_scope` | `($command = '', $actor_pid = 0): void` | 会推进 tick 的玩家命令在 handler 执行前记录命令前战斗域快照，供后续 TickFrame 合并 |
| `obl_tick_frame_result_init` | `($delta): array` | 初始化 TickFrameResult（phases / actor_behaviors / changed_scopes） |
| `obl_tick_frame_result_finalize` | `(&$ctx): array` | 归集 TickFrameResult，输出 actor_behaviors 与 changed_scopes |
| `obl_tick_register_listener` | `($phase, $cb): void` | 注册 tick 事件监听器（phase: battle_npc/idle_npc/post） |
| `obl_tick_get_listeners` | `($phase): array` | 获取指定阶段的所有监听器 |
| `obl_tick_dispatch` | `($delta, &$ctx): void` | 调度 TickFrame（三阶段：combat_domain/battle_npc → world_ai_domain/idle_npc → post_domain/post） |
| `obl_resolve_tick_events` | `($delta): array` | tick 事件处理入口（由 Tick Orchestrator 调用，抓取玩家+构造 TickFrame 上下文+合并 pending BattleActorScope+调度+返回 TickFrameResult） |
| `obl_tick_has_busy_battle` | `(): bool` | 检查是否有战场在 PROCESSING 状态（委托 obl_battle_state_has_busy_battle） |
| `obl_tick_debug_log` | `($tag, $data = array()): void` | 诊断桩子，优先写入 `combat_debug.log`，用于复盘 tick/world AI 时序 |

> **tick 推进驱动机制**：前端显式调用 `oblivions/api/heartbeat.php`，由 Oblivions Tick Orchestrator 处理 pending tick 与 NPC 行动。详见 [DESIGN.md §2.16](./DESIGN.md#216-前端守护进程模型心跳)。
> **battle_npc phase 监听器**：`obl_tick_phase_battle_npc` 位于 [§8.7 enemy_ai.func.php](#87-enemy_aifuncphp--npc-敌人-ai)，负责调度 NPC 行动并触发战斗状态机转换（详见 [§6.4.1](#641-战斗状态机三态与转换触发点)）。
> **同 tick 行为互斥**：world AI 不只看实时 `action/bid`，还必须检查 TickFrame 入口 BattleActorScope 与 ActorBehaviorLedger。战斗成员在本 TickFrame 内即使被 combat cleanup 清空 `action/bid`，也不能进入 world AI。
> **战斗结束后移动语义**：若最后一个 NPC 战斗回合结束后自驱动出下一 pending tick，且下一 TickFrame 的 BattleActorScope 已为空，原战斗 actor 作为普通 NPC 参与 world AI 是当前预期行为。

### 8.3 explore.func.php

| 函数 | 签名 | 说明 |
|------|------|------|
| `obl_get_config` | `(): array` | 读取配置（带静态缓存） |
| `obl_update_vision` | `(int $pgroup, int $pls, array &$pdata): void` | 视野更新入口 |
| `obl_calc_vision_range` | `(int $pgroup, int $pls, array &$pdata): array` | BFS计算视野范围，返回 `[pls => ['distance' => int]]` |
| `obl_clear_fog` | `(int $pgroup, array $visible_tiles): void` | 点亮迷雾（INSERT ON DUPLICATE KEY UPDATE） |
| `obl_discover_items` | `(int $pgroup, array $visible_tiles): void` | 按记忆范围随机发现道具 |
| `obl_check_explore_sp` | `(array &$pdata): bool` | 探索体力检查+扣除 |
| `obl_explore` | `(array &$pdata, bool $skip_sp_check = false): void` | 探索命令入口 |
| `obl_post_explore_hook` | `(array &$pdata): void` | 探索后钩子（预留） |
| `obl_search_poi` | `(int $iaid, array &$pdata): void` | 搜索POI：掉落表+机制触发 |
| `obl_execute_mechanic` | `(array $template, array &$pdata): void` | 机制分发（→ `obl_mechanic_{name}`） |
| `obl_mechanic_max_hp_up` | `(array $template, array &$pdata): void` | 机制：增加最大HP |
| `obl_get_poi_at_position` | `($pgroup, $pls): array` | 查询指定地图格上的所有 POI 实例（被 item.craft.func.php 的工作台素材查询调用） |

> 拾取/丢弃函数（`obl_pickup_item` / `obl_discard_item`）已迁至 [§8.14.0 item.basic.func.php](#8140-itembasicfuncphp--道具库存基础操作)。

### 8.4 move.func.php

| 函数 | 签名 | 说明 |
|------|------|------|
| `obl_get_map_data` | `(?int $pgroup = null): array` | 加载地图数据（按区域懒加载+静态缓存） |
| `obl_get_move_range` | `(): int` | 可移动最大格数（保底1） |
| `obl_get_distance` | `(int $pgroup, int $from, int $to): int` | BFS最短路径（不可达返回-1） |
| `obl_move` | `(int $moveto, array &$pdata): void` | 移动（含区域切换/体力/自动探索） |
| `obl_check_move_sp` | `(array &$pdata, int $distance = 1): bool` | 移动体力检查+扣除 |
| `obl_post_move_hook` | `(array &$pdata): void` | 移动后钩子：自动探索（跳过体力检查） |

### 8.5 generate.func.php

| 函数 | 签名 | 说明 |
|------|------|------|
| `obl_generate_region_items` | `(int $pgroup, array $tiles, array $cfg): void` | 区域资源生成入口 |
| `obl_generate_region_pois` | `(int $pgroup, array $tiles, array $poi_pool, array $poi_table): void` | POI生成 |
| `obl_generate_wild_items` | `(int $pgroup, array $tiles, array $scatter_pool, array $item_table): void` | 野生道具生成 |

### 8.6 log.func.php

| 函数/类 | 签名 | 说明 |
|---------|------|------|
| `OblivionsLogger` | 类 | 结构化日志收集器，单次请求内累积 |
| `OblivionsLogger::emit` | `($id, $logcategory, $params = [], $html = null): void` | 追加一条日志（自动判定 debug 标记） |
| `OblivionsLogger::getEntries` | `(): array` | 获取本请求累积的日志条目 |
| `OblivionsLogger::hasEntries` | `(): bool` | 本请求是否有日志 |
| `obl_log_persist` | `($logger, $groomid, $pid, $max_entries = 200): void` | 持久化日志到 JSON 文件（追加+裁剪+LOCK_EX，正式/debug 分开计数） |
| `obl_log_load` | `($groomid, $pid): array` | 从文件读取日志条目（按时间正序） |
| `OblivionsErrorLogger` | 类 | 错误日志收集器（emit 签名无 logcategory） |
| `obl_error_log_persist` | `($logger, $groomid, $pid): void` | 持久化错误日志到 JSON 文件 |
| `obl_error_log_load` | `($groomid, $pid): array` | 从文件读取错误日志条目 |
| `obl_log_clear_all` | `(): void` | 清理所有结构化日志文件（rs_game() 调用） |
| `obl_error_log_clear_all` | `(): void` | 清理所有错误日志文件（rs_game() 调用） |

### 8.7 enemy_ai.func.php — NPC 敌人 AI

NPC 敌人 AI 行为核心。NPC 数据与玩家同构（统一存 `bra_oblplayers`，`type>0` 区分），AI 不依赖当前请求的玩家，在 tick 结算入口自行从数据库查询。

> **模块迁移说明**：NPC 生成（`obl_init_enemies` / `obl_create_enemy_record` / `obl_get_occupied_positions` / `obl_pick_available_tile`）已迁至 `gamectl/init.func.php`；discovered 状态管理（`obl_discover_enemies` / `obl_update_enemy_discovered` / `obl_get_player_vision_range`）已迁至 `vision.func.php`。本文件仅保留 AI 行为逻辑。
>
> **与 tick 推进的关系**：`obl_tick_phase_battle_npc` 是 battle_npc phase 监听器，由 `obl_tick_dispatch` 调用（详见 [§8.2 tick.func.php](#82-tickfuncphp)）。NPC 行动后通过 `obl_tick_request_advance()` 请求推进 tick，调度器末尾 `obl_tick_advance()` 自驱动下次心跳继续（详见 [DESIGN.md §2.16.1](./DESIGN.md#2161-heartbeat--tick-推进完整链路)）。

**模块 1：Tick 事件监听器**（2 函数，由 `tick.func.php` 末尾集中注册）

| 函数 | 签名 | 说明 |
|------|------|------|
| `obl_tick_phase_battle_npc` | `($delta, &$ctx): void` | battle_npc phase 监听器：查询活跃先攻队列，当前顺位者是 NPC 时执行 NPC 回合（`obl_ai_select_combat_action` → `combat_dispatch('npc_turn')`），最多处理 1 个回合 |
| `obl_tick_phase_idle_npc` | `($delta, &$ctx): void` | idle_npc/world_ai phase 监听器：结算当前玩家所在区域的非战斗敌人 AI；每个 actor 先通过 `obl_actor_world_ai_block_reason()` 判定，跳过 BattleActorScope / 已行动 actor |

**模块 1.5：world AI 行动资格**（2 函数）

| 函数 | 签名 | 说明 |
|------|------|------|
| `obl_actor_can_world_ai` | `(&$actor, &$ctx): bool` | 判断 actor 是否可在当前 TickFrame 执行非战斗 AI |
| `obl_actor_world_ai_block_reason` | `(&$actor, &$ctx): string` | 返回 world AI 阻断原因：`battle_scope` / `action_battle` / `bid_present` / `actor_behavior_claimed` 等；空字符串表示可行动 |

**模块 2：AI 决策**（2 函数）

| 函数 | 签名 | 说明 |
|------|------|------|
| `obl_enemy_tick` | `(&$enemy, &$player, &$ctx = null): bool` | 单敌人 world AI 决策：world AI 资格检查 → 行动意愿门控 → 按 `ai_type` claim `world` 行为并行动（patrol/aggressive/idle）。追击/突袭/碰撞战斗待 tick 框架重构后实现 |
| `obl_ai_select_combat_action` | `(&$npc_data, $target_pid): array` | NPC 战斗技能选择：从 `oblpara['combat_skills']` 选第一个可用技能（含目标/射程/AP 检查），无可用攻击时尝试 `escape`，再兜底 `idle` |

**模块 3：移动逻辑**（3 函数）

| 函数 | 签名 | 说明 |
|------|------|------|
| `obl_enemy_move` | `(&$enemy, $target_pls, &$player, &$ctx = null, $reason = ''): bool` | 敌人移动（可在雾中移动）：校验 passable/占用/玩家格 → 更新 pls → 更新 discovered → save。在玩家视野内时 emit 移动日志；诊断模式写 world AI move 成败桩 |
| `obl_enemy_patrol` | `(&$enemy, &$player, &$ctx = null): bool` | 巡逻：随机选邻居格移动 |
| `obl_enemy_hunt` | `(&$enemy, &$player, &$ctx = null): bool` | 主动搜寻（MVP 简化为巡逻） |

**模块 4：占用检查与辅助函数**（3 函数）

| 函数 | 签名 | 说明 |
|------|------|------|
| `obl_is_tile_occupied_by_others` | `($pgroup, $pls, $exclude_pid): bool` | 检查地图格是否被其他单位占用 |
| `obl_calc_next_step_towards` | `($pgroup, $from_pls, $to_pls): int\|false` | 计算向目标移动的下一步（选距离最近的邻居格） |
| `obl_get_tile_neighbors` | `($pgroup, $pls): array` | 获取地图格的邻居列表 |

### 8.7.1 combat/ 子文件夹 — 战斗执行系统

`oblivions/include/game/combat/` 是当前唯一战斗执行主流程。`combat_start_battle()` 负责首次建队列，`combat_dispatch()` 负责已有队列中的玩家 / NPC 回合推进；旧 `battle.entry.php` / `battle.main.php` 不再加载。

| 文件 | 关键函数 / 类型 | 说明 |
|------|----------------|------|
| `combat.runtime.php` | `combat_ensure_battle_log` / `combat_cache_create` | 初始化全局 battle log 与 battle_cache |
| `combat.context.php` | `CombatContext` | 单 action 执行上下文，承载 ResolvedAim、CapturedTargetSet、current target、target results 与资源/delivery 状态 |
| `combat.aim.php` | `combat_aim_resolve` / `combat_aim_check_rules` | 把不可信 AimIntent 解析为后端权威 `pid/tile/self/none` ResolvedAim，并接入 observation decision |
| `combat.observation.php` | `combat_observation_decide` / `combat_observation_preload_revealed_tiles` | actor-aware 的 tile knowledge / character detection 判定；revealed set 在请求内 battle_cache 缓存 |
| `combat.range.php` | `combat_range_resolve_base` / `combat_spatial_decide` | 五种射程模式唯一解析器；组合距离、预扣前 AP wallet、真实 AP quote 与可负担性 |
| `combat.target_capture.php` | `combat_capture_resolution_targets` | 四个内置 Capturer；检查结构、重复 PID、entity ref、ResolvedAim/tile capture provenance，并稳定排序 |
| `combat.target_unit.php` | `combat_target_units_run` / `combat_resolve_target_unit` | 逐目标完整结算、target SAVEPOINT、collector checkpoint、资源一次提交 |
| `combat.participation.php` | `combat_participation_classify*` / `combat_participation_enlist` | member/joinable/left/other_battle/blocked 分类与安全动态入列 |
| `combat.core.php` | `combat_start_battle` / `combat_dispatch` / `combat_main` / `combat_verify` / `combat_execute` | 战斗入口、action normalize、AP wallet 校验、主循环与收尾 |
| `combat.pipeline.php` | `combat_pipeline_run` | `Aim -> Capture -> foreach TargetResolutionUnit`，不再按 stage 批量遍历 targets |
| `combat.skill.php` | `combat_skill_get_config` / `combat_skill_validate_config` / `combat_skill_load_module` | 校验并加载 aim/capture/execution/delivery 技能配置 |
| `combat.target.php` | `combat_target_resolve_all` | 旧调用兼容 facade，领域实现已拆到 aim/capture |
| `combat.tag.php` | `combat_tag_build` / `combat_check_target_rules` | 构建当前 Aim/ResolutionTarget 标签，供 `aim.rules` / `capture.rules` 判定 |
| `combat.ap.php` | `combat_ap_register` / `combat_ap_calculate` / `combat_ap_project_budget` | AP 计算器注册、具体目标报价与同 calculator 的预算摘要 |
| `combat.effect.php` | `combat_effect_apply_all` | 实际应用 `damage` / `heal` / `move` / `escape` / `ap_change` |
| `combat.state.php` | `combat_state_post_check` / `combat_state_clear` / `combat_state_mark_post_battle_handoff_pending` / `combat_state_activate_post_battle_handoff` | 管理 `combatants` 与 `tag_mutations`；逃跑时登记待交接状态，qid 解散时才锚定首个战后 world-AI 跳过帧 |
| `combat.queue.php` | `combat_queue_create_and_init` / `combat_queue_exit` | combat 层队列适配，内部复用 `battle.queue.*` |
| `combat.planned_state.php` | `combat_planned_state_*` | dry-run/verify/preview 的计划状态读写 |
| `combat.effect_projector.php` | `combat_effect_project_all` | 在 planned state 上投影效果，不写 DB |
| `combat.chain.php` | `combat_chain_project` | 动作链 verify / preview 共用投影入口，返回每个 action 的成功/失败与 effects |
| `combat.preview.php` | `combat_can_engage` / `combat_preview_single` / `combat_preview_targets` / `combat_preview_chain` | actor-owned engagement planner、单目标预览、批量候选投影、动作链预览 |
| `combat.log.php` | `combat_log_v2_*` | battlelog.v2 事件适配 |

**战斗技能配置**：

- 主配置：`oblivions/gamedata/combat_skill_config.php`
- 技能 hook：`oblivions/gamedata/combat_skills/skill_{act_id}.php`
- hook 签名：`skill_{act_id}_execute(CombatContext $ctx): void`
- 配置形状：`aim.resolver/observation/rules` + `capture` + `execution.empty_policy` + `delivery.types: string[]` + `range` + `ap_calc`
- hook 只声明 current target effect；actor effect 显式 `scope=actor`，不得查询或修改任意 PID
- 已接入 hook：`unarmed_strike` / `throw` / `escape` / `move` / `heal` / `execute` / `grenade` / `vampiric_bite` / `whirlwind`

### 8.8 battle.func.php — 战斗功能函数

`battle/` 目录当前是 shared combat infrastructure，不再承载旧战斗主执行链。`battle.func.php` 保留轻量状态切换、AP 恢复、目标规则与 turn hook，供 `combat/` 与队列编排复用。

**模块 1：战斗状态管理**（2 函数）

| 函数 | 签名 | 说明 |
|------|------|------|
| `battle_state_init` | `(&$actor_data): void` | 初始化参战者战斗状态（设 `action='battle'`） |
| `battle_state_clear` | `(&$actor_data, &$obl_battle_log, &$battle_cache, $reason = 'unknown'): void` | 清理战斗状态：reason='death' 时设 state=1；清 action → queue_exit → 恢复 AP → save |

**模块 2：数值辅助**（3 函数，与 battle.calc.php 配合）

| 函数 | 签名 | 说明 |
|------|------|------|
| `battle_ap_recover` | `(&$actor_data, &$battle_cache, &$obl_battle_log): void` | AP 恢复（每轮开始时，恢复量为 max_ap，不超过上限） |
| `battle_act_verify` | `(&$actor_data, $act_id, &$obl_battle_log, &$battle_cache): bool` | 单动作校验：委托 skill_act_verify 查配置/拥有/CD/AP/扣 AP |
| `battle_apply_damage` | `(&$actor_data, &$target_data, $damage, &$obl_battle_log, &$battle_cache): void` | 扣除目标 HP，保底 0 |

**模块 3：目标状态检测**（1 函数，旧接口，逐步被 combat tag 系统替代）

| 函数 | 签名 | 说明 |
|------|------|------|
| `battle_target_distance_check` | `(&$actor_data, &$target_data, $act_id, &$battle_cache): bool` | 射程检测：委托共享射程计算，供旧规则层兼容使用 |

**模块 4：Tag 系统**（4 函数）

| 函数 | 签名 | 说明 |
|------|------|------|
| `battle_tag_dead` | `(&$target_data): bool` | 单 tag 派生：`target.state === 1` |
| `battle_tag_self` | `(&$actor_data, &$target_data): bool` | 单 tag 派生：`target.pid === actor.pid` |
| `battle_tag_out_of_range` | `(&$actor_data, &$target_data, &$battle_cache): bool` | 单 tag 派生：`!battle_target_distance_check` |
| `battle_build_target_tags` | `(&$actor_data, &$target_data, $act_id, &$battle_cache): array` | 统一构建目标标签集：Cat A（self/out_of_range）重算；Cat B（dead/escaped/hidden）从 `tag_mutations[pid]` 读取缓存/DB 首次派生，写回缓存 |

**模块 5：规则匹配**（1 函数）

| 函数 | 签名 | 说明 |
|------|------|------|
| `battle_check_target_rules` | `($config, array $tags): array` | 白名单（require）+ 黑名单（forbid）规则匹配，返回 `['pass'=>bool,'reason'=>string\|null]` |

**模块 6：Actor 检查**（1 函数）

| 函数 | 签名 | 说明 |
|------|------|------|
| `battle_actor_can_act` | `(&$actor_data, &$obl_battle_log, &$battle_cache = null): bool` | Actor 行动资格检查（state>0 或 hp<=0 视为不能行动），失败时 emit + 写 combatants 缓存 |

### 8.9 battle.main.php — 已删除

旧 battle engine 的动作执行模块 `battle.main.php` 已下线，运行时不再加载。

替代关系：

- 新入口：`combat/combat.core.php::combat_dispatch`
- 新执行主流程：`combat/combat.core.php::combat_main`
- 新管道：`combat/combat.pipeline.php`
- 共享队列出口：`battle.queue.main.php::battle_manage_queue`

### 8.10 battle_log.func.php — 请求内战斗演出事件收集器

`BattleLogCollector` 与 `obl_log` 分离，但不再持久化为在线队列（详见 [DESIGN.md §1.10](./DESIGN.md#110-战斗演出事件与-presentationbatch)）。

**BattleLogCollector 关键设计：**
- **battlelog.v2 事件**：render channel 使用 round/turn/action/delivery/joined/effect/cleared/end/notice 等正式 `event_type`；phase 仅用于 collector 内部调试分类
- **render/debug 分离**：`emit()` 的 `$debug` 参数控制是否进入 response PresentationBatch；诊断事件不进入 render script
- **边界标记**：每个条目携带 `bl_turn_num` / `bl_round_num`，Director 直接使用 `round_start` / `turn_start` / `battle_end` 事件分段
- **Turn/Round 管理**：`nextTurn()` 由 `battle_hook_turn_start` 调用递增；`setRoundNum()` 由 `battle_queue_create_and_init` / `battle_queue_rebuild` 调用同步 DB 的 round_num
- **目标原子性**：`checkpoint()` / `rollbackTo()` 与 TargetResolutionUnit SAVEPOINT 同步，单目标回滚时丢弃该目标尚未提交的 action/delivery/join/effect 事件
- **事务边界**：collector 在事务中只驻留内存；Runtime 在 COMMIT 前冻结 render events 与 batch sequence，COMMIT 后附加到 response

| 函数/类 | 签名 | 说明 |
|---------|------|------|
| `BattleLogCollector` | 类 | 战斗日志收集器，单次请求内累积。由 `combat_ensure_battle_log()` 统一初始化为全局 `$obl_battle_log` |
| `BattleLogCollector::setPhase` | `($phase): void` | 设置当前 phase（12 个事件类型之一），emit 时自动附加 |
| `BattleLogCollector::nextTurn` | `(): void` | Turn 计数递增（由 `battle_hook_turn_start` 调用） |
| `BattleLogCollector::setRoundNum` | `(int $num): void` | 设置 Round 计数（由队列创建/重建调用） |
| `BattleLogCollector::emit` | `(array $params, ?bool $debug = null): void` | 追加结构化事件，自动附加时间、phase、debug、turn/round 元数据 |
| `BattleLogCollector::getEntries` | `(): array` | 获取本请求累积的战斗日志条目 |
| `BattleLogCollector::checkpoint` / `rollbackTo` | `(): int` / `(int): void` | 建立并恢复目标单元事件检查点 |
| `BattleLogCollector::hasEntries` | `(): bool` | 本请求是否有战斗日志 |

### 8.11 battle.entry.php — 已删除

旧入口 `battle_entry_dispatch` 已下线，运行时不再加载。

替代关系：

- `battle_entry_dispatch` → `combat/combat.core.php::combat_dispatch`
- `battle_entry_ensure_battle_log` → `combat/combat.runtime.php::combat_ensure_battle_log`
- `battle_cache_create` → `combat/combat.runtime.php::combat_cache_create`
- actions 解析 / normalize → `combat/combat.core.php` 内的 `combat_action_normalize_*`

### 8.12 skill.main.php — 技能系统核心

| 函数 | 签名 | 说明 |
|------|------|------|
| `skill_get_definition` | `($skill_id): array\|null` | 获取技能身份、生命周期、可见性与 effect 规则 |
| `skill_get_all_definitions` | `(): array` | 加载全部技能定义 |
| `skill_has_cd` | `($skill_id): bool` | 检查技能是否有 CD 定义 |
| `skill_is_finisher` | `($skill_id): bool` | 检查技能是否为终结技（配置 `finisher=1`） |
| `skill_is_usable` | `(&$actor_data, $skill_id): bool` | 检查技能是否可用（配置存在/拥有/CD/AP），不修改状态 |
| `skill_format_skillpara` | `(&$skillpara): void` | 技能数据格式化：补默认技能并规范 effect instances |
| `skill_ensure_defaults` | `(&$skillpara): void` | 确保 skillpara 存在默认字段 |
| `skill_strip_temporary` | `(&$skillpara): void` | 剥离临时技能 |
| `skill_act_verify` | `(&$actor_data, $act_id, &$obl_battle_log, &$battle_cache): bool` | 动作校验入口：查配置/拥有/CD/AP/扣 AP |
| `skill_execute` | `(&$actor_data, $act_id, &$target_data, &$obl_battle_log, &$battle_cache): void` | 技能执行入口：按 category 分发到 calc/escape 等 |
| `skill_get_available_list` | `(&$pdata): array` | 获取可用技能列表（含运行时状态：on_cd/available） |

### 8.13 battle.queue.func.php — 战斗队列管理

| 函数 | 签名 | 说明 |
|------|------|------|
| `battle_manage_queue` | `(&$actor_data, &$obl_battle_log, &$battle_cache): array` | 统一完成当前 actor、解散/重建队列、确定 next 并同步状态机 |
| `battle_queue_setup` | `(&$actor_data, &$obl_battle_log, $combatants_map)` | 初始 roster 建队适配 |
| `battle_queue_create_and_init` | `(&$actor_data, array $pids, &$obl_battle_log): int` | 创建 qid、插入初始成员、投一次先攻并创建 battle state |
| `battle_queue_set_initiative` | `($qid, &$actor_data, &$obl_battle_log, $ambush_pid=0): array` | 仅对初始/重建 active roster 排先攻 |
| `battle_queue_append_tail` | `(&$target_data, int $qid, &$battle_cache, $log, ?CombatContext $ctx): array` | 锁定后 compare-and-append；新成员 `done=0` 排尾，不删除旧 qid 行 |
| `battle_queue_rebuild` | `($qid, &$actor_data, &$obl_battle_log): array` | 新一轮重建 active 成员顺位 |
| `battle_queue_exit` | `(&$actor_data, &$obl_battle_log, &$battle_cache)` | 标记当前 qid 行 `active=0`，bid 由解散清理 |
| `battle_disband_cleanup` | `($qid, &$actor_data, &$obl_battle_log): array` | 清理成员 action/bid/AP 并激活匹配的 effect boundary |

### 8.14 skill_effect / actor capability

| 模块 | 主要职责 |
|------|----------|
| `skill_effect.main.php` | effect instance 格式化、幂等 apply、refresh stacking、active 判定 |
| `skill_effect.lifecycle.php` | boundary activation、post GC、下一可行动 tick |
| `skill_effect.projector.php` | 公开 statuses/capabilities 投影与 hidden 来源过滤 |
| `actor.capability.php` | 合法 capability registry、provider 聚合、deny-wins 与 unknown fail-closed |

旧 `battle_queue_join()` 的 delete-by-pid 后插入语义已经删除；不得建立兼容 wrapper。

### 8.14 item/ 子文件夹 — 道具系统

**文件**：`item.tag.func.php` + `item.basic.func.php` + `item.use.func.php` + `item.craft.func.php`

**依赖**：`item.tag.func.php` 依赖 `item_table.php`（数据文件）；`item.basic.func.php` 依赖 `item.tag.func.php`；`item.use.func.php` 依赖 `item.tag.func.php`；`item.craft.func.php` 依赖 `item.tag.func.php` + `item.use.func.php` + `item.basic.func.php`（`obl_put_item_to_itm0` / `obl_organize_inventory`）+ `explore.func.php`（`obl_get_poi_at_position`）

#### 8.14.0 `item.basic.func.php` — 道具库存基础操作

道具系统的"基础操作层"——槽位读写、堆叠、itm0 缓存槽、拾取、丢弃、整理。被 `item.use.func.php` / `item.craft.func.php` / `oblivions_commands.php`（旧 deprecated）/ `obl_command_handlers.php`（新）等衍生层调用。

**itm0 缓存槽约定**（详见 [DESIGN.md §2.24](./DESIGN.md#224-itm0-缓存槽与事件解耦)）：
- `itempara[0]` 是新增道具的中转槽，所有新增道具（拾取/合成产物/未来卸装备）先入 itm0 再整理入背包
- itm0 非空时命令层拒绝除 `inventory.organize` / `item.discard` 外的所有命令（Command Bus gate 返回 `ITM0_PENDING`；旧 deprecated 路径在 router 层等价检查）
- `obl_put_item_to_itm0`（检查 itm0 为空 + 放入）和 `obl_organize_inventory`（合并堆叠 + 转移 itm0 → 背包）是独立函数，由调用方分别调用
- `obl_organize_inventory` 是纯逻辑函数（不内部 emit），由调用方根据返回值 emit `item.to_bag`（整理成功，道具入背包）/ `organize.fail`（整理失败）事件

| 函数 | 签名 | 说明 |
|------|------|------|
| `item_is_infinite` | `($itms): bool` | 判断 itms 是否为无限标识（`'∞'`）。数量模型=无限数量，耐久模型=无限耐久 |
| `item_get_stack` | `($item_id): bool` | 读取道具是否可堆叠（带静态缓存） |
| `item_get_stack_limit` | `($item_id): int` | 读取道具的 stack_limit（带静态缓存） |
| `item_destroy_if_depleted` | `(array &$pdata, $slot): bool` | 检查 itms 归零并销毁道具实例（unset 槽位）。**"销毁道具"的统一入口**，所有 itms 扣减后的销毁逻辑都经过此函数。返回 true=已销毁，false=未归零 |
| `_item_para_key` | `($itmpara): string` | 将 itmpara 标准化为字符串键，用于堆叠合并时的相等性比较 |
| `obl_get_items` | `(array &$pdata): array` | 获取道具栏数组（index 0=itm0，1~itemmaxslots=普通） |
| `obl_get_item` | `(array &$pdata, $slot): array\|null` | 获取指定槽位道具 |
| `obl_set_item` | `(array &$pdata, $slot, $item): void` | 设置指定槽位道具（null=清空） |
| `obl_find_empty_slot` | `(array &$pdata): int\|false` | 找空普通槽（1~itemmaxslots），无空位返回 false |
| `obl_is_bag_full` | `(array &$pdata): bool` | 背包是否已满 |
| `obl_find_mergeable_slot` | `(array &$pdata, $item_id, $itmpara = null): int\|false` | 查找可合并堆叠的槽位（仅查 1~itemmaxslots，不含 itm0）。合并条件：item_id 相同 + itmpara 相等 + 未达 stack_limit |
| `obl_add_item_to_inventory` | `(array &$pdata, $item): int\|false` | 添加道具到背包（自动合并，原子性）。预检查空间不足时返回 false，不修改任何数据。**只操作背包槽位 1~itemmaxslots，不操作 itm0** |
| `obl_merge_stacks_in_inventory` | `(array &$pdata): void` | 合并背包内同类堆叠（腾出空槽）。仅合并，不转移 itm0，不排序 |
| `obl_put_item_to_itm0` | `(array &$pdata, $item): bool` | 放入道具到 itm0 缓存槽。itm0 已被占用时返回 false（返回错误码让调用方 emit 上报，router 门控已拦截） |
| `obl_organize_inventory` | `(array &$pdata): bool` | 整理背包：合并同类堆叠 + 转移 itm0 → 背包。**纯逻辑函数（不内部 emit）**。返回 true=整理成功（itm0 已清空），false=背包满（itm0 保留）。由调用方根据返回值 emit `item.to_bag`（成功）/ `organize.fail`（失败）事件 |
| `obl_pickup_item` | `($iid, array &$pdata): void` | 拾取道具（流程：读取实例 + itms='0' 检查 + 位置/发现状态检查 + 近视揭示 + 构建实例 + 放入 itm0 + 原子删除地图实例 + emit pickup.success（捡起，传 item_id）+ 自动整理 + emit item.to_bag（成功）/ organize.fail（失败）解耦） |
| `obl_discard_item` | `($slot, array &$pdata): void` | 丢弃道具。slot=0 丢弃 itm0 缓存槽内容（直接抛弃，不写回地图）；1~itemmaxslots 丢弃普通槽位道具（写回 `bra_oblmapitem` 表） |

**事件解耦原则**（详见 [DESIGN.md §2.24](./DESIGN.md#224-itm0-缓存槽与事件解耦)；itm0拾取语义拆分-设计案 §3）：
- `pickup.success`（捡起成功，道具进入 itm0）与 `item.to_bag`（整理成功，道具进入背包）是独立事件，前端可分别呈现"捡起"和"入背包"两个时刻
- `pickup.success`（捡起成功）与 `organize.fail`（整理失败）是独立事件，前端可同时收到分别处理（捡起后道具卡在 itm0）
- `craft.success`（合成总事件）与每个产物的 `item.to_bag`（入背包）/ `organize.fail`（整理失败）解耦
- `item.to_bag` 命名不绑死拾取场景，未来卸装备流程（卸下 → itm0 → 整理入背包）可直接复用
- `organize.fail` 替代旧的 `pickup.bag_full_itm0` / `craft.bag_full_itm0` / `organize.bag_full` 三个事件，统一携带 `item_id`

#### 8.14.1 `item.tag.func.php` — 道具 Tag 系统

| 函数 | 签名 | 说明 |
|------|------|------|
| `item_load_table` | `(): array` | 读取 item_table（带静态缓存） |
| `item_get_tags` | `($item_id): array` | 读取道具的 Tag 列表（性质描述 Tag + 系统钩子 Tag 统一返回，各系统按需过滤） |
| `item_has_tag` | `($item_id, $tag_id): bool` | 判断道具是否拥有某 Tag |
| `item_get_itmk` | `($item_id): string` | 读取道具的 itmk 类别 |
| `item_get_tool_level` | `($item_id): int` | 读取道具的工具等级（非工具返回 0） |
| `item_get_items_by_tag` | `($tag_id): array` | 反向查询：拥有某 Tag 的所有道具 |

#### 8.14.2 `item.use.func.php` — 道具使用系统

| 函数 | 签名 | 说明 |
|------|------|------|
| `item_use` | `($slot, &$pdata): void` | 命令入口：读取槽位 → 检查 tag_usable → 耐久检查 → use_effect 分发 → itms 扣减 → item_destroy_if_depleted → emit use_item.success |
| `item_execute_use_effect` | `($item, &$pdata): void` | use_effect 分发框架（纯分发器，调 `item_use_effect_{name}()`，不预定义任何效果） |
| `item_consume_itms` | `(&$item, $amount = 1): void` | itms 扣减（"∞"/"0" 特殊处理，归零 emit durability.broken）。注意：只扣减不销毁，销毁由 item_destroy_if_depleted 统一处理 |

**use_effect 注册约定**：具体效果函数由归属系统实现，框架只负责分发。当前预定义的 use_effect 名称：
- `restore_sp` → 食物经验系统注册（恢复 SP）
- `restore_hp` → 食物经验系统注册（恢复 HP）
- `cure_bs` → 健康系统注册（解除 Body Status）
- `gain_resistance` → 被动技能系统注册（抗性跃迁）

#### 8.14.3 `item.craft.func.php` — 合成系统

| 函数 | 签名 | 说明 |
|------|------|------|
| `item_get_recipe` | `($recipe_id): array\|null` | 读取单个配方（带静态缓存） |
| `item_get_all_recipes` | `(): array` | 读取全部配方 |
| `item_get_available_workbench_materials` | `(&$pdata): array` | 查询可用工作台素材（被动技能 + POI craft_source；cat 来源 P0 未实现） |
| `item_can_consume` | `($item, $consume): bool` | 检查素材是否可匹配指定 consume 模式（工作台素材只能 'none'） |
| `item_resolve_material_mapping` | `($materials, $placed_items): array\|null` | 核心匹配算法：按 item_id→itmk→tag 优先级映射素材槽位 |
| `item_materials_match` | `($materials, $placed_items): bool` | 布尔包装（调 `item_resolve_material_mapping`） |
| `item_count_material_in_inventory` | `(&$pdata, $item_id): int` | 统计背包中指定 item_id 的素材数量 |
| `item_consume_materials` | `(&$pdata, $materials, $slots, $workbench_materials): bool` | 按 consume 模式扣除素材（'all'=移除, 'durability'=扣耐久, 'none'=保留） |
| `item_match_recipes_by_slots` | `(&$pdata, $slots, $workbench_materials): array` | 指向性判断：返回匹配的 recipe_id 列表 |
| `item_recipe_visibility_filter` | `($recipe, &$pdata): bool` | 配方可见性过滤接口（P0 返回 true，所有配方可见；取消"已发现/未发现"机制后作为未来剧情/事件门控的扩展钩子保留） |
| `item_get_visible_recipes` | `(&$pdata): array` | 查询配方列表（返回所有配方，经 `item_recipe_visibility_filter` 过滤；取消"已发现/未发现"机制后所有配方天然可见） |
| `item_craft_preview` | `($slots, &$pdata, $workbench_materials): array` | 前端预判 API 逻辑：返回 `{match_count, craftable, recipe_id, preview_log}`（preview_log 为单对象，复用 log-templates.ts 模板渲染） |
| `item_craft` | `($slots, &$pdata, $workbench_materials): void` | 合成入口（11 步流程：解析素材 → 指向性判断 → 空间检查 → 扣素材 → 产物入 itm0（`obl_put_item_to_itm0`）+ 自动整理（`obl_organize_inventory`）→ emit `craft.success`（仅 recipe_id）+ 整理失败 emit `organize.fail` 解耦） |
| `obl_mechanic_craft_source` | `($template, &$pdata): void` | POI 机制占位（工作台素材的 POI 交互由 `item_get_available_workbench_materials` 接管，P0 不实现） |

### 8.15 obl_runtime.php — Oblivions 独立运行期

Oblivions 三个 HTTP 入口（command / state / heartbeat）的共用运行期，不依赖 `common.inc.php`。由 `obl_runtime_boot($kind)` 装配 DB / cookie / room / gamevars / logger。

| 函数 | 签名 | 说明 |
|------|------|------|
| `obl_runtime_boot` | `($kind = 'command'): array` | Runtime 入口，按 kind（command/state/heartbeat）装配运行期：DB 连接 + cookie 解析 + 房间/gamevars/logger 上下文 |
| `obl_runtime_require_oblivions` | `($ctx): bool` | 判断当前房间是否为 Oblivions 模式 |
| `obl_runtime_acquire_room_lock` | `($timeout = 5): bool` | 获取房间锁（防止房间生命周期操作与运行期并发） |
| `obl_runtime_release_room_lock` | `($lock_name): void` | 释放房间锁 |
| `obl_runtime_transaction_begin/commit/rollback` | `(): void` | 管理 request-local InnoDB 事务状态；连接故障时 rollback cleanup 仍清除 active/throw 标记 |
| `obl_runtime_shutdown_cleanup` | `(): ?array` | fatal shutdown 兜底：回滚仍 active 的事务、释放 room lock，并返回 fatal error 信息 |
| `obl_runtime_persist_logs` | `($pdata = null, $source = 'api', $writers = array()): array` | commit 后持久化日志并返回 `warnings[]`；writers 参数用于隔离故障测试 |
| `obl_runtime_reload_tick_globals` | `(): void` | 重新加载 tick 全局状态（从 oblgame 表同步到 $gamevars） |
| `obl_runtime_save_tick_globals` | `($extra = array()): void` | 保存 tick 全局状态（$gamevars 同步回 oblgame 表） |

### 8.16 obl_tick_orchestrator.php — tick 推进编排器

两条 tick 推进路径的编排核心。玩家命令路径与心跳路径互斥，由战斗状态机管辖。

| 函数 | 签名 | 说明 |
|------|------|------|
| `obl_tick_orchestrator_after_command` | `($ctx, $command, $contract, &$pdata, $dispatched): array` | 玩家命令路径：Command Bus 保存后调用，推进 tick + 结算 pending，返回 tick 生命周期信息 |
| `obl_tick_orchestrator_heartbeat` | `($ctx = null): array` | 心跳路径：前端 heartbeat.php 调用，检测 pending tick 并结算 NPC 行动，返回 `tick_frame` / `changed_scopes` |
| `obl_tick_orchestrator_resolve_pending` | `($ctx = null, $reason = 'heartbeat'): array` | 结算 pending tick（`processed_tick < tick` 时调 `obl_resolve_tick_events()`），汇总 TickFrameResult |
| `obl_tick_orchestrator_recover_stale_battles` | `($ctx = null, $ttl = 30): array` | 恢复卡死的 PROCESSING 战斗（超时阈值后强制推进） |
| `obl_tick_orchestrator_status` | `($ctx = null): array` | 返回 tick 状态（tick / processed_tick / pending_tick） |
| `obl_tick_orchestrator_now` | `(): int` | 当前时间戳 |
| `obl_tick_orchestrator_persist` | `($extra = array()): void` | 持久化 tick 状态到 oblgame 表 |
| `obl_tick_orchestrator_reload` | `(): void` | 从 oblgame 表重新加载 tick 状态 |

### 8.17 obl_game_repository.php — 单房间 Game State 表

`{$tablepre}oblgame` 表的 DDL 与 CRUD。每房间一张表，固定一行 id=1，tick / processed_tick 是主字段。

| 函数 | 签名 | 说明 |
|------|------|------|
| `obl_game_table_name` | `($tablepre_override = ''): string` | 返回表名（`{$tablepre}oblgame`） |
| `obl_game_schema_ensure` | `(): void` | 建表（CREATE TABLE IF NOT EXISTS） |
| `obl_game_schema_known` | `($table = ''): bool` | 检查表是否存在 |
| `obl_game_default_row` | `($defaults = array()): array` | 返回默认行 |
| `obl_game_load` | `($ensure = true): array\|false` | 读取行（ensure=false 时不自动建表） |
| `obl_game_reset` | `($defaults = array()): array` | 重置行 |
| `obl_game_save` | `($data): bool` | 保存行 |
| `obl_game_touch` | `($field, $time = null): void` | 更新时间戳字段（heartbeat_at / last_command_at） |
| `obl_game_note_command` | `($time = null): void` | 记录命令时间 |
| `obl_game_note_heartbeat` | `($time = null): void` | 记录心跳时间 |
| `obl_game_state_from_legacy_gamestate` | `($legacy_gamestate): string` | legacy gamestate → state（INIT/READY/RUNNING/ENDED） |
| `obl_game_state_to_legacy_gamestate` | `($state, $fallback = 0): int` | state → legacy gamestate（0/10/20） |

### 8.18 obl_gamevars.php — gamevars 兼容镜像层

让 `{$tablepre}oblgame` 成为 tick/gamevars 的 source of truth，同时继续向领域函数暴露 `$gamevars['obl_tick']` / `$gamevars['obl_pretick']` 兼容镜像。

| 函数 | 签名 | 说明 |
|------|------|------|
| `obl_gamevars_normalize` | `($vars): array` | 规范化 gamevars（非数组返回空数组） |
| `obl_gamevars_from_row` | `($row): array` | oblgame 行 → $gamevars（注入 obl_tick / obl_pretick） |
| `obl_gamevars_sync_to_globals` | `($create_from_legacy = true, $sync_lifecycle = false): array\|false` | oblgame → $gamevars（纯读用 `false, false` 避免建表） |
| `obl_gamevars_sync_from_globals` | `($extra = array()): bool` | $gamevars → oblgame（含 tick / state / winner 同步） |

### 8.19 obl_command_bus.php — Command Bus 核心

Command API 的核心处理器：contract 校验 + 认证 + flock + gate + dispatch + save_and_tick + 响应组装。

| 函数 | 签名 | 说明 |
|------|------|------|
| `obl_command_api_handle` | `($envelope): array` | Command API 入口（envelope → 响应数组） |
| `obl_command_authenticate_player` | `(): array\|false` | 认证当前玩家（cookie → $pdata） |
| `obl_command_gate` | `($command, $contract, $payload, $envelope, &$pdata): array\|null` | 门控（BATTLE_BUSY / ITM0_PENDING / STATE_CONFLICT），返回 error 或 null |
| `obl_command_allowed_by_contract` | `($contract, &$pdata): bool` | contract allowed_actions 校验（替代旧 `obl_command_allowed_by_state`） |
| `obl_command_check_expected` | `($expected, &$pdata): array\|null` | expected 状态冲突检测 |
| `obl_command_itm0_pending` | `(&$pdata): bool` | itm0 门控（itempara[0] 非空时仅放行 `inventory.organize` / `item.discard`） |
| `obl_command_acquire_lock` | `($groomid, $pid): bool` | 获取文件锁（flock `LOCK_EX\|LOCK_NB`） |
| `obl_command_after_dispatch` | `($command, $contract, &$pdata): void` | 分发后处理（PLAYER_TURN → PROCESSING 状态转换） |
| `obl_command_save_and_tick` | `($command, $contract, &$pdata, $dispatched, $ctx = null): void` | 保存玩家 + tick 推进（仅 `advancesTick=true` 命令） |
| `obl_command_build_response_data` | `($command, $contract, &$pdata): array` | 组装响应 data（feedback + refresh + server_state） |
| `obl_command_persist_logs` | `(&$pdata): void` | 持久化日志 |
| `obl_command_emit_rejected` | `($command, &$pdata, $reason): void` | 命令被 gate 拒绝时 emit 诊断日志 |

### 8.20 obl_state_handlers.php — State API handlers

State API 的 scope 分发器。所有 handler 纯读，不推进 tick。

| 函数 | 签名 | 说明 |
|------|------|------|
| `obl_state_dispatch` | `($scope, $ctx): array` | scope 分发（空/runtime → runtime_status，其他 → 对应 handler） |
| `obl_state_handle_runtime_status` | `($ctx): array` | tick / processed_tick / pending_tick 状态 |
| `obl_state_handle_player_info` | `($ctx): array` | 玩家状态栏 + 战斗状态 + 装备 + `battle_queue` + `combat_context` |
| `obl_state_build_battle_queue` | `($pdata): array\|null` | 构建当前玩家所在战场的队列视图 |
| `obl_state_build_combat_context` | `($pdata): array\|null` | 构建当前 qid CombatViewModel（combatants / validTargets / suggestedTargetPid） |
| `obl_state_handle_combat_targets` | `($ctx): array` | 构建 member/joinable/left/other_battle/blocked 候选与角色投影 |
| `obl_state_combatant_view` | `($pdata, $qrow = null): array` | 单 combatant 视图 |
| `obl_state_target_view` | `($combatant): array` | 单可选目标视图 |
| `obl_state_handle_player_inventory` | `($ctx): array` | 背包列表 |
| `obl_state_handle_game_map` | `($ctx): array` | 当前区域地图 |
| `obl_state_handle_tile_actions` | `($ctx): array` | 当前格可执行动作 |
| `obl_state_handle_obl_log` | `($ctx): array` | 结构化日志 |
| `obl_state_handle_obl_error` | `($ctx): array` | 错误诊断日志 |
| `obl_state_handle_enemies` | `($ctx): array` | 当前区域敌人 |
| `obl_state_handle_skill_list` | `($ctx): array` | 技能列表 |
| `obl_state_handle_skill_cd_check` | `($ctx): array` | 技能 CD 检查 |
| `obl_state_handle_craft_preview` | `($ctx): array` | 合成预览（带 slots 参数） |
| `obl_state_handle_craft_workbench_materials` | `($ctx): array` | 工作台素材 |
| `obl_state_handle_craft_recipes` | `($ctx): array` | 配方列表 |

---

## 九、代码规范

### 9.1 命名约定

| 类别 | 规则 | 示例 |
|------|------|------|
| 函数（通用） | `obl_` 前缀 + 蛇形命名 | `obl_update_vision`, `obl_search_poi` |
| 道具系统内部函数 | `item_` 前缀 + 蛇形命名 | `item_get_tags`, `item_craft`, `item_materials_match` |
| use_effect 注册函数 | `item_use_effect_` 前缀 | `item_use_effect_restore_sp`, `item_use_effect_cure_bs` |
| 机制函数 | `obl_mechanic_{name}` | `obl_mechanic_max_hp_up`, `obl_mechanic_craft_source` |
| 命令处理器（旧 deprecated） | `cmd_handle_obl_{command}`（旧扁平命令名） | `cmd_handle_obl_explore`, `cmd_handle_obl_battle_action`（仅 `oblivions_router.php` 调用） |
| 命令处理器（新） | 新命令名 switch dispatch（无统一函数名前缀） | `obl_command_handler_dispatch($command, $payload, &$pdata)` 内 `case 'map.move':` / `case 'battle.submit_turn':` 等，直接调 domain 函数 |
| 数据库表 | `{$tablepre}obl{entity}`（无下划线连写） | `bra_oblplayers`, `bra_oblmapstates`, `bra_oblmappoi`, `bra_oblmapitem` |
| 配置键 | 蛇形命名 | `explore_sp_cost`, `vision_range` |
| 日志 ID | `{logcategory}.{subevent}` | `move.success`, `organize.fail`, `search.result` |
| 战斗日志 action_id | 蛇形命名 | `unarmed_strike`, `escape`, `battle.start`, `initiative.roll`, `battle.end` |

### 9.2 数据传递规范

- **`$pdata` 引用传递**: 所有修改玩家数据的函数接受 `&$pdata`，禁止函数内 `extract()`
- **日志输出**: 通过 `global $obl_log` + `$obl_log->emit($id, $logcategory, $params)`
- **战斗日志输出**: 通过 `global $obl_battle_log` + `$obl_battle_log->emit(array $params)`，`$params` 键：`actor_pid`/`actor_type`/`target_pid`/`target_type`/`action_id`/`effect_value`/`extra`
- **数据库操作**: 使用全局 `$db` + `$tablepre`，SQL中表名写 `{$tablepre}oblmapxxx`
- **配置读取**: 通过 `obl_get_config()` 获取，带静态缓存，不直接 include

### 9.3 并发安全

- **拾取竞态**: `DELETE ... WHERE iid='$iid' AND discovered>0`，检查 `affected_rows()` 防重复拾取
- **搜索计数**: `UPDATE ... SET search_count=search_count+1` 原子递增
- **迷雾写入**: `INSERT ... ON DUPLICATE KEY UPDATE fog=1` 幂等操作
- **日志写入**: `file_put_contents` 加 `LOCK_EX`，多请求并发写入不丢数据
- **演出序号**: `obl_presentation_head_seq` 与领域事务一起写入 `oblgame.vars_json`；回滚不消耗序号
- **命令并发锁**: 新 Command API 先使用房间级 DB lock，再由 Command Bus 使用玩家级 `flock(LOCK_EX|LOCK_NB)`，同一玩家同时只能处理一个命令（详见 [§6.5](#65-并发锁机制)）

### 9.4 itmpara 约定

- 数据库中为 JSON 对象字符串；背包 `itempara[].itmpara` 解码为对象/数组
- 拾取时保持原始 `itmpara`，不注入地图实例主键
- 道具模板 ID 存在 `itempara[].itmid`，丢弃时用它还原 `bra_oblmapitem.item_id`

### 9.5 战斗日志 emit 规范

- **双参数 emit**：`$obl_battle_log->emit(array $params, ?bool $debug = null)`。`$debug` 省略时按 phase 自动推断（`$phaseDebugDefault`），显式传入覆盖默认
- **无占位符**：未提供的字段记为 `null`，不使用 `0`/`-1`/`''` 等占位符
- **无 extra**：所有字段均为正式字段，无 `extra` 中间容器
- **按 phase 分布**：不同 phase 填不同字段集，未填的为 `null`（如 `initiative_roll` 只填 `qid`/`rolls`/`ambush_pid`；`once_execute_pre` 填 actor/target 全名+HP+action_id；`once_execute_post` 只填 actor/target HP+effect_value+success）
- **actor_type 约定**：`0`=玩家，`>0`=敌人类型 ID（与 `bra_oblplayers.type` 一致）
- **段边界自动填充**：emit 输出的 `bl_turn_num`/`bl_round_num`/`bl_segment_flag` 由 `BattleLogCollector` 内部自动计算，各调用点无需关心
- **phase 由 setPhase 标记**：各函数内部调 `setPhase('initiative_roll'|'once_execute_pre'|'once_execute_post'|'flee'|'combatant_cleared'|'battle_end'|'ambush_battle_end'|...)`，emit 时自动附加当前 phase

### 9.6 防御性代码约束

防御代码必须有对策，禁止"纯跳过"式死防御（return / continue 不处理异常）。允许的对策：执行修复 / emit 错误日志 / 返回错误码让调用方处理 / 去除检查让正常逻辑自然覆盖。

详见 [DESIGN.md §2.25](./DESIGN.md#225-防御性代码约束)。

---

## 十、玩家生命周期（Oblivions模式）

```
0. 地图初始化 → 所有格子迷雾覆盖 → obl_init_enemies() 生成 NPC 敌人
1. 玩家出生 → 出生格点亮迷雾 → POI显示在界面
2. 仅可执行探索（迷雾中无法移动）
3. 探索流程:
   3.0 体力检查（obl_check_explore_sp）
   3.1 点亮迷雾（obl_clear_fog，范围=vision_range）
   3.2 发现道具（obl_discover_items，上限=memory_range）
   3.3 发现敌人（obl_discover_enemies，设 discovered=1 + 清除敌人格迷雾）
   3.4 探索后钩子（obl_post_explore_hook）
4. 拾取/丢弃道具
5. 搜索POI → 掉落表生成 + 机制触发
6. 移动 → 移动后自动探索（跳过体力检查）
7. 移动推进游戏刻 → obl_resolve_tick_events($delta) → obl_tick_dispatch($delta, $ctx)
   → 阶段 1 battle_npc：obl_tick_phase_battle_npc（战斗中 NPC 回合，当前顺位是 NPC 时执行）
   → 阶段 2 idle_npc：obl_tick_phase_idle_npc（非战斗敌人 AI）
     → 逐个当前区域敌人执行 obl_enemy_tick() → 按 ai_type 行动（patrol/aggressive/idle）
   → 阶段 3 post：tick 后处理（预留扩展）
8. 战斗流程（统一入口 `combat_start_battle` / `combat_dispatch`）:
   8.1 首次进入战斗：`battle.start` 命令 → `combat_start_battle()`（建队列 + 进入战斗）
   8.2 玩家回合：`battle.submit_turn` 命令 → `combat_dispatch('player_turn')`（在已有队列中推进）
   8.3 NPC 回合：tick 结算 → `combat_dispatch('npc_turn')`（AI 决策 + 队列推进）
   8.4 战斗结束：battle_manage_queue 内部 try_end 检测（队列解散 + 状态清理）
```

每一步操作产生的日志通过 `$obl_log->emit()` 收集，请求结束前由 `obl_log_persist()` 持久化。
战斗演出事件通过 `$obl_battle_log->emit()` 在请求内收集，COMMIT 后由 command/heartbeat response 的 `presentation.v1` 直接投递。

---

## 十一、前端集成速查

> 前端完整架构详见 [vex-vue/CODEBASE.md](../../vex-vue/CODEBASE.md)。本节仅列出后端需要知道的前端对接点。

### 11.1 页面入口

Oblivions 模式下 `game.php` 重定向到 `vex-vue/dist/index.html`（生产环境）或 Vite dev server（开发环境）。

### 11.2 数据拉取

| 需求 | API | 关键字段 |
|------|-----|----------|
| 地图网格+连通性 | `game_map` | `links.tiles[pgroup][pls].neighbors`, `links.grids[pgroup]` |
| 当前格交互 | `tile_actions` | `pois[]`, `ground_items[]` |
| 玩家位置 + 演出水位 | `player_info` | `pgroup`, `pls`, `groomid`, `presentation_head_seq` |
| 战斗上下文视图 | `player_info.combat_context` | `qid/state/canSubmitTurn/combatants/validTargets/suggestedTargetPid` |
| 战斗候选视图 | `combat_targets` | `qid/suggestedTargetPid/candidates[relation,participation,selectable,reason,character]` |
| 玩家背包详情 | `player_inventory` | `items[]`（含 usable/tags/itmk 字段，供前端判断可使用/可装备道具） |
| 结构化日志 | `obl_log` | `entries[]`（LogEntry 数组）, `total` |
| 当前区域敌人 | `enemies` | `enemies[]`（已发现敌人列表） |
| 合成预判 | `craft_preview` | `match_count`, `craftable`, `is_new_recipe` |
| 可用工作台素材 | `craft_workbench_materials` | `workbench_materials[]`（含 source/id/item_id/tool_level） |
| 已发现配方列表 | `craft_recipes` | `recipes[]`（含 recipe_id/category/materials/results） |
| tick 后刷新范围 | `heartbeat.changed_scopes` | `player_info/game_map/enemies/combat_targets/...`，由前端用于精准 invalidate |

### 11.3 命令提交

前端通过 `commandQueue.execute(envelope)` 提交命令（详见 vex-vue/CODEBASE.md）。`envelope` 是 Command API 的结构化请求体：

```typescript
interface OblCommandEnvelope {
  command: string;          // 新命令名（map.move / map.explore / ...）
  request_id: string;       // 客户端生成的请求 ID
  payload: Record<string, unknown>;  // 命令参数
  expected?: {              // 可选：客户端预期的服务端状态，冲突时返回 STATE_CONFLICT
    pid?: number;
    action?: string;
    bid?: number;
    battle_state?: string;
  };
}
```

示例：

```typescript
// 探索
commandQueue.execute({ command: 'map.explore', request_id, payload: {} });

// 搜索POI
commandQueue.execute({ command: 'poi.search', request_id, payload: { iaid: poiIaid } });

// 拾取道具
commandQueue.execute({ command: 'item.pickup', request_id, payload: { iid: itemIid } });

// 丢弃道具
commandQueue.execute({ command: 'item.discard', request_id, payload: { slot: slotNumber } }); // slot: 0=itm0 缓存槽, 1-itemmaxslots=普通槽位

// 整理背包（合并同类堆叠 + 转移 itm0 → 背包；itm0 锁定时唯一可用命令之一）
commandQueue.execute({ command: 'inventory.organize', request_id, payload: {} });

// 移动
commandQueue.execute({ command: 'map.move', request_id, payload: { to: targetPls } });

// 玩家突袭（预装填动作数组）
commandQueue.execute({ command: 'battle.start', request_id, payload: { actions: [{ act_id: 'unarmed_strike', target: enemyPid }] } });

// 战斗动作（玩家回合，预装填动作数组）
commandQueue.execute({
  command: 'battle.submit_turn',
  request_id,
  payload: { actions: [{ act_id: 'unarmed_strike', target: enemyPid }] },
  expected: { action: 'battle', battle_state: 'PLAYER_TURN', bid: enemyQid },
});

// 使用道具
commandQueue.execute({ command: 'item.use', request_id, payload: { slot: slotNumber } });

// 合成道具
commandQueue.execute({ command: 'craft.execute', request_id, payload: { slots: [1,3,5], workbench_materials: ['poi:123', 'passive:innate_t0'] } });
```

> 旧扁平 POST 命令名（`obl_explore`/`obl_search`/`move`/...）仅保留在根 `command.php` + `oblivions_router.php` deprecated 路径中，新前端不再调用。

### 11.4 实时战斗演出

前端从 command/heartbeat 响应顶层读取 `presentation_head_seq` 与可选 `presentation.v1`。批次进入 `PresentationInbox` 后由 Director/Planner/Runner 消费；F5 或缺批直接按权威快照 rebase，不存在 played 标记请求。

### 11.5 前端关键逻辑

- **迷雾渲染**: `fog=0` 的格子不可见（不渲染/灰色覆盖），`fog=1` 的格子正常显示
- **POI可见性**: 仅迷雾清除后的POI返回（由API过滤）
- **道具可见性**: 仅 `discovered>0` 的道具返回（由API过滤）
- **近视道具**: `discovered=2` 时显示 `display_name`（带"？"），拾取后揭示真实身份
- **道具分组**: POI关联道具在 `pois[].items`，散落道具在 `ground_items`
- **道具类别渲染**: 前端按 `itmk` 查 `vex-vue/src/data/itmk-locale.ts` 渲染中文类别名（如 WP→钝器、HH→生命恢复），未注册的 itmk 原样显示
- **背包槽位**: `itempara` JSON 数组（index 0=itm0 缓存槽，1~itemmaxslots=普通槽），对应 `slot` 参数 1~itemmaxslots（slot=0 用于 `item.discard` 丢弃 itm0 内容）
- **itm0 锁定处理**: `itempara[0]` 非空时后端拒绝除 `inventory.organize` / `item.discard` 外的所有命令（Command Bus 返回 `ITM0_PENDING` code）；前端需检测 itm0 状态，提示玩家整理或丢弃 itm0 内容
- **整理失败事件**: 收到 `organize.fail`（携带 `item_id`）时，Itm0Modal 持续显示强制玩家处理（整理或丢弃）；不在日志区渲染（黑名单），不触发 Toast；与 `pickup.success` / `item.to_bag` / `craft.success` 是独立事件，可同时收到
- **道具入背包事件**: 收到 `item.to_bag`（携带 `item_id`）时，日志区呈现"把 XX 放进了背包" + Toast 即时反馈；多条批量合并为"把 N 件道具放进了背包"避免刷屏；自动整理（拾取/合成内部）与手动整理成功均复用此事件。事件呈现策略详见 [DESIGN.md §1.9](./DESIGN.md#19-结构化日志--前端-toast-强化提醒)
- **结构化日志渲染**: 前端按 `entry.id` 查 `vex-vue/src/data/log-templates.ts` 模板渲染，后端不参与视觉呈现
- **地块描述生成**: 无名格描述由前端 `vex-vue/src/data/terrain-desc.ts` 的 `generateTerrainDesc()` 随机组合，后端只传 floor/tide/passable 属性
- **敌人可见性**: 仅 `discovered=1` 的敌人返回（由 `enemies` API 过滤），敌人移动超出玩家视野后自动从列表移除
- **战斗会话与候选**: `battle.ts` 以规范化 qid 维护 session；`combat_context` 提供成员/回合，`combat_targets` 提供展示与 selectable 候选。suggested PID 只预高亮，每个 QueueItem 保存自己的 AimIntent
- **战斗日志播放 V2（四层架构）**: Director 聚合 action/delivery/joined/effects；Planner 生成 `action_delivery` / `combatant_joined` / action animation 等 steps；Runner 调 ActorExecutor 播放投射、图格爆炸、动态成员准备、受击和清场
- **Heartbeat 精准刷新**: `client.ts::getHeartbeatChangedScopes()` 读取 `heartbeat.data.changed_scopes`，`command-queue.ts` / `battle.ts` 按 scope 调 `dataManager.invalidate()`；包含 `game_map` / `enemies` 时刷新地图实体
- **战斗状态过滤**: `action='battle'` 时前端只允许提交 `battle.submit_turn`；非战斗状态不允许提交 `battle.submit_turn`（`battle.start` 在 action='normal' 时仍允许；后端 Command Bus `obl_command_allowed_by_contract` 强制，返回 `COMMAND_NOT_ALLOWED`）
- **战斗处理中锁**: 前端 `commandQueue` 采用 5 层锁架构（HTTP/冷却 → 演出 → itm0 → 模式 → PROCESSING），其中 PROCESSING 层仅拦截 `COMMAND_REGISTRY` 中 `advancesTick=true` 的命令，`isLocked` 仅包含 HTTP/演出两层全局锁；详见 [vex-vue/CODEBASE.md §3.1](../vex-vue/CODEBASE.md#31-五层并发锁)
- **技能渲染**: 前端按 `skill_id` 查 `vex-vue/src/data/skill-templates.ts` 渲染名称/描述/动作描述，未注册的 skill_id 回退到以 skillId 作为 name 的默认模板
- **可用技能列表**: `player_info` API 返回 `skills` 字段（由 `skill_get_available_list()` 生成，含运行时状态 on_cd/available）

---

**文档结束。** 概念定义与设计原则见 [DESIGN.md](./DESIGN.md)，结构化日志系统的完整 ID 清单见 `vex-vue/src/data/log-templates.ts`，Toast 即时反馈机制详见 [vex-vue/CODEBASE.md](../../vex-vue/CODEBASE.md)。

