# Oblivions 子系统 — 代码库参考手册

> 帮助 AI 智能体快速查阅 Oblivions 模式的后端架构、API 接口、数据结构和代码规范。
> 概念与设计原则：[DESIGN.md](./DESIGN.md) | 项目文档总入口：[AGENTS.md](../../AGENTS.md) | 前端文档：[vex-vue/CODEBASE.md](../../vex-vue/CODEBASE.md)

---

## 章节快速跳转

| 我想查… | 跳转 |
|---------|------|
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
├── include/
│   ├── core/
│   │   └── obl_command.php     # Oblivions 命令入口（由 command.php require，处理全部命令流程 + 并发锁）
│   └── game/
│       ├── player.func.php     # 玩家数据层：认证/抓取/格式化/保存 + 道具栏 + battle 状态防呆 + 命令状态过滤
│       ├── explore.func.php    # 探索/搜索/拾取/丢弃核心逻辑
│       ├── move.func.php       # 移动/地图数据加载/BFS距离计算
│       ├── log.func.php        # 结构化日志收集器 + 持久化/读取
│       ├── battle.func.php     # 战斗系统功能函数（Tag/规则/状态管理，详见 §8.8）
│       ├── battle_log.func.php # 战斗日志收集器 + played 标记机制（详见 §8.10）
│       └── enemy_ai.func.php   # NPC 敌人 AI 核心（17 函数：初始化/tick 结算/感知/决策/碰撞）
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
│   ├── battles/                # obl_battle_log_{groomid}_{pid}.json — 战斗日志
│   └── debug/                  # ai_dump_{groomid}.jsonl — AI 调试 dump
├── mark_battle_log_played.php  # 零依赖 battlelog 标记接口（无 auth/DB，只文件读写）
├── editor/                     # 地图编辑器（Node.js/Vite前端工具）
└── docs/                       # 设计文档
```

**外部集成文件**（不在 oblivions/ 目录下）：

| 文件 | 作用 |
|------|------|
| `include/core/global.func.php` | `oblivions_is_active()` 定义 + `save_gameinfo()` Oblivions 分支 |
| `include/core/common.inc.php` | 全局入口：初始化 `$obl_log` + `$obl_battle_log` + tick 事件触发 |
| `include/command/router.php` | Oblivions 命令路由注册（含 obl_battle_start / obl_battle_action） |
| `include/command/handlers/oblivions_commands.php` | 6个Oblivions命令处理器（explore/search/pickup/discard + battle_start/battle_action） |
| `include/command/handlers/basic_commands.php` | move/search 命令的 Oblivions 分支 |
| `api_v2.php` | 8个API端点（player_info/player_inventory/game_map/tile_actions/obl_log/battle_log/enemies/ai_dump_save） |
| `command.php` | Oblivions 模式路由分发器（require obl_command.php 后 exit） |
| `include/gamectl/system.func.php` | 游戏初始化时调用 `obl_init_enemies()` 生成 NPC 敌人 |
| `valid.php` | 玩家激活时创建 oblplayers 记录 + 出生点迷雾点亮 |
| `game.php` | 重定向到 `vex-vue/dist/index.html`（生产）或 dev server（开发） |

---

## 三、引导加载（bootstrap）

Oblivions 子系统通过统一入口 `oblivions/include/core/obl_bootstrap.php` 集中加载所有函数库，按拓扑排序分 8 层。

**当前层序概览**（实际层序以 `obl_bootstrap.php` 为准）：

| 层 | 文件/模块 | 说明 |
|----|----------|------|
| 0 | `obl_global.func.php` | 公共函数，最先加载 |
| 1 | `log` / `battle_log` / `sql` / `player` / `move` / `generate` / `battle.calc` / `skill` | 基础模块 |
| 2 | `vision` | 依赖 obl_global + player + move + log |
| 3 | `battle.func` | 依赖第 1-2 层 |
| 4 | `battle.main` / `battle.entry` / `battle.queue` | 依赖第 1-3 层 |
| 5 | `explore` / `enemy_ai` | 依赖 vision + battle |
| 6 | `tick` | 依赖最广，末尾注册监听器 |
| 7 | `gamectl/init.func.php` | 游戏初始化 |
| 8 | `gamectl/state.func.php` | 游戏状态机 |

**强制约定**：源于 [DESIGN.md §2.12](./DESIGN.md#212-新文件必须注册到-obl_bootstrap)。新增任何 `.func.php` / `.main.php` 文件，必须在 `obl_bootstrap.php` 中注册，按拓扑排序。

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
| **装备** | `wep`/`wep2`/`arb`/`arh`/`ara`/`arf`/`art` | 7 槽装备（每槽 6 字段：name/k/e/s/sk/para） |
| **道具栏** | `itempara` | JSON 数组（七字段规范，见下方 itmpara / itempara 小节） |
| | `itemmaxslots` | 道具栏最大格数（默认 6，index 0=特殊槽） |
| **Oblivions专属** | `tacpara` | 策略槽（JSON） |
| | `skillpara` | 技能数据（JSON） |
| | `oblpara` | 杂项功能数据（JSON，含 `killnum`/`ai_type`/`vision_range`/`battle`/`escape_skip_tick` 等） |
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

**`oblpara['escape_skip_tick']`**：逃跑成功时设置的标志，跳过本次命令的 tick 推进（一次性，避免 NPC 在同 tick 内再次遭遇玩家）。

**itmpara / itempara 道具对象七字段规范**（itempara 数组元素 + 地图道具实例均遵循）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `itm` | string | 道具名 |
| `itmk` | string | 道具种类 |
| `itme` | int | 效果值 |
| `itms` | string | 耐久 |
| `itmsk` | string | 耐久种类 |
| `itmpara` | object | 参数（JSON 对象，含 `obl_item_id` 等） |
| `itmid` | string | 地图道具实例ID（拾取时注入，丢弃时用于还原） |

```json
[
  null,
  {"itm":"面包","itmk":"HH","itme":120,"itms":"15","itmsk":"","itmpara":[],"itmid":""},
  {"itm":"矿泉水","itmk":"HS","itme":140,"itms":"15","itmsk":"","itmpara":[],"itmid":""},
  null, null, null, null
]
```

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

主键: `(qid, pid)`

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

> **重要：数值字段返回 string**
>
> 后端 PHP 通过 `compatible_json_encode()` 返回的所有数值字段（如 `pid`/`hp`/`ap`/`log_id`/`turn`/`effect_value`/`played`/`ts` 等）实际为 **string 类型**。这是 PHP json_encode 对数据库取出的值的行为。
>
> 前端 TypeScript 类型定义中这些字段均声明为 `string`，使用时需 `Number()` 转换。详见 [vex-vue/CODEBASE.md](../../vex-vue/CODEBASE.md) 类型定义章节。

### 5.1 通用协议

- 入口: `api_v2.php?action=xxx`
- 认证: Cookie 中的 `$cuser` / `$cpass`
- 响应格式:
```json
{ "status": "success"|"error", "data": {...}, "message": "..." }
```
- 错误响应: `{ "status": "error", "error": { "code": "NOT_OBLIVIONS", "message": "..." } }`

### 5.2 `game_map` — 地图数据（Oblivions扩展）

- **请求**: `GET api_v2.php?action=game_map`
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

- **请求**: `GET api_v2.php?action=tile_actions`
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

- **请求**: `GET api_v2.php?action=obl_log`
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

**ID 命名规则**：`{logcategory}.{subevent}`，如 `move.success`、`pickup.bag_full`、`search.result`。完整 ID 清单见前端 `vex-vue/src/data/log-templates.ts`。

**debug 分类**：`OblivionsLogger::DEBUG_IDS` 常量声明 debug 日志 ID 清单（当前含 `enemy.move`、`battle.invalid`）。这些日志持久化保留但前端默认不渲染，debug 模式下显示并加 `[DBG]` 前缀。

### 5.5 `battle_log` — 战斗日志（未播放条目）

- **请求**: `GET api_v2.php?action=battle_log`
- **前置条件**: 必须在 Oblivions 模式下
- **响应**:
```json
{
  "status": "success",
  "data": {
    "entries": [BattleLogEntry, ...],
    "total": 3
  }
}
```

**只返回 `played=0` 的条目**。文件中 `played=1` 的条目保留但不返回（历史归档）。

**BattleLogEntry 字段**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 固定 `'battle.action'` |
| `log_id` | string | 文件内自增 ID（持久化时分配），用于标记 played |
| `turn` | string | 回合序号（0=战斗开始/结束，1+=回合 N） |
| `actor` | string | 行动方标识（`'player'` 或 `'enemy_{pid}'`） |
| `action_id` | string | 动作 ID（`unarmed_strike`/`escape`/`battle.start`/`initiative.roll`/`battle.end`） |
| `action_name` | string | 动作显示名（如 `'空手攻击'`） |
| `target` | string | 目标标识（`'player'`/`'enemy_{pid}'`/结果标识） |
| `effect_value` | string | 效果值（伤害值等） |
| `extra` | object\|null | 额外信息（如 `{'success': true}`、`{'player_roll': 50, 'enemy_roll': 30}`） |
| `enemy_pid` | int | 战斗对象 PID（前端按战斗分组播放） |
| `played` | string | 0=未播放，1=已播放（前端播放后通过 mark 接口标记） |
| `ts` | string | Unix 时间戳 |

> **关于数值类型**：后端 PHP 返回的所有数值字段实际为 **string 类型**（PHP json_encode 行为），前端使用时需 `Number()` 转换。详见 [§5.0](#50-通用约定)。

**前端用途**：拉取后按 `enemy_pid` 分组，每组按 `log_id` 排序播放（碰撞动画 → 模态框 → 残留伤害数字），播完调 `mark_battle_log_played.php` 标记 `played=1`。

### 5.6 `enemies` — 当前区域敌人列表

- **请求**: `GET api_v2.php?action=enemies`
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

### 5.7 `player_info` — 玩家信息（含 groomid）

Oblivions 模式下 `player_info` 额外返回 `groomid` 字段，供前端调用零依赖接口（如 `mark_battle_log_played.php`）：

```php
api_response('success', array(
    'pid'     => $pdata['pid'],
    'groomid' => $groomid,  // 房间 ID（供前端调用零依赖接口）
    'action'  => $pdata['action'],
    'bid'     => $pdata['bid'],
    // ... 其他字段
));
```

### 5.8 `mark_battle_log_played.php` — 零依赖标记接口

**独立文件**（不走 `api_v2.php`），位于 `oblivions/mark_battle_log_played.php`。

- **请求**: `POST oblivions/mark_battle_log_played.php`
- **Content-Type**: `application/x-www-form-urlencoded`
- **参数**:
  - `groomid` (int) — 房间 ID
  - `pid` (int) — 玩家 ID
  - `log_ids` (array 或逗号分隔字符串) — 要标记的 log_id 数组
- **响应**:
```json
{ "success": true, "marked": 3 }
```
或
```json
{ "success": false, "error": "invalid_params" }
```

**零依赖设计**：详见 [DESIGN.md §2.5](./DESIGN.md#25-零依赖接口设计)。

---

## 六、命令路由

### 6.1 提交格式

通过 `command.php` POST 提交：
- `mode=command`（必须）
- `command=命令名`
- 附加字段见下表

### 6.2 Oblivions 专用命令

| 命令 | POST附加字段 | 处理函数 | 说明 |
|------|-------------|----------|------|
| `obl_explore` | 无 | `obl_explore($pdata)` | 探索（点亮迷雾+发现道具） |
| `obl_search` | `iaid` (int) | `obl_search_poi($iaid, $pdata)` | 搜索POI |
| `obl_pickup` | `iid` (int) | `obl_pickup_item($iid, $pdata)` | 拾取道具 |
| `obl_discard` | `slot` (int 1~itemmaxslots) | `obl_discard_item($slot, $pdata)` | 丢弃背包道具 |
| `obl_battle_start` | `enemy_pid` (int) | `obl_battle_initiate($enemy_pid, $pdata)` | 玩家主动攻击：直接进入 battle 状态 |
| `obl_battle_action` | `actions` (JSON) | `cmd_handle_obl_battle_action($pdata, $actions)` | 战斗动作：入口 5，通过 battle_main→battle_manage_queue 分离流程 |

### 6.3 通用命令的 Oblivions 分支

| 命令 | Oblivions分支 |
|------|--------------|
| `move` | `obl_move($moveto, $pdata)` |
| `search` | `obl_explore($pdata)` |

### 6.4 命令执行流程

Oblivions 模式下，`command.php` 仅做模式判定，业务逻辑全部委托给独立文件 `oblivions/include/core/obl_command.php`：

```
command.php
  → oblivions_is_active() === true
  → require GAME_ROOT.'./oblivions/include/core/obl_command.php'
  → exit

obl_command.php 内部流程：
  [A0] register_shutdown_function — PHP fatal error 时输出 JSON 错误（兜底保护）
  [A]  obl_game_entrypoint('command')           // 认证 + 抓取 + 格式化 $pdata
  [A2] 并发锁：flock(LOCK_EX|LOCK_NB) — 同一玩家同时只能处理一个命令
       → 获取失败返回 {'error': 'COMMAND_IN_PROGRESS'} 并 exit
  [B]  $command/$mode 来自 POST（common.inc.php 已 extract）
  [C2] obl_command_allowed_by_state($command, $action)  // 命令状态过滤
       → action='battle' 时只允许 obl_battle_action
       → 非战斗状态不允许 obl_battle_action（obl_battle_start 仍允许）
       → 被拒绝的命令 emit 'command.rejected' 日志，不推进 tick
   [C2b] obl_tick_has_busy_battle() → 委托 obl_battle_state_has_busy_battle()
        → 战场 PROCESSING 时拒绝推进 tick 的命令，emit 'command.rejected' (reason=battle_busy)
  [D]  if (!$command_rejected && $pdata['hp'] > 0):
        require oblivions_router.php
        oblivions_cmd_dispatch($command, $pdata, $post)
          → obl_command_allowed_by_state → cmd_handle_obl_xxx($params, $pdata)
            → explore.func.php / battle.func.php: obl_xxx($params, $pdata)  // &$pdata 引用传递
      所有函数库由 obl_bootstrap.php 统一加载，handler 不再 include
   [C2d] 命令执行完后：PLAYER_TURN → PROCESSING（状态机过渡 'player_acted'）
  [E]   obl_log_persist($obl_log, $groomid, $pdata['pid'])  // 持久化结构化日志
  [E1b] obl_error_log_persist($obl_error_log, $groomid, $pdata['pid'])  // 持久化错误日志
  [E2]  obl_battle_log_persist($obl_battle_log, $groomid, $pdata['pid'])  // 持久化战斗日志（played=0）
  [F-pre] 处理 escape_skip_tick 标志（逃跑成功时跳过本次 tick 推进）
  [G]   obl_save_player($pdata)                             // 写回 oblplayers
  [F]   if obl_command_advances_tick($command) && !escape_skip_tick:
        obl_tick_advance()             // obl_tick++ + 标记 $ginfochange
        [F-bs] PROCESSING 下刷新时间戳（obl_battle_state_refresh）
        save_gameinfo()                // 命令路径需显式持久化
  [H]   echo compatible_json_encode(array())                // 返回空 JSON {}
       （flock 在进程结束/脚本结束时由 OS 自动释放）
```

**关键设计**：
- **不使用 `extract($pdata, EXTR_REFS)`**：直接操作 `$pdata` 数组，避免全局变量污染
- **跳过传统预检查**：眩晕/冷却/对话框/追击/物品索引等预检查全部跳过
- **跳过模板渲染**：SPA 前端不需要 HTML 模板，响应只返回最小确认 `{}`
- **使用 `obl_save_player()`** 替代 `player_save()`，仅写 `bra_oblplayers`
- **前端通过 `api_v2.php` 获取业务数据**，命令响应不再包含 `$gamedata` 或 `battlelog` 字段

### 6.5 并发锁机制

详见 [DESIGN.md §2.6](./DESIGN.md#26-flock-并发锁--前端短锁)。

**后端锁实现**：
```php
$obl_lock_file = GAME_ROOT . './oblivions/cache/locks/obl_lock_' . $groomid . '_' . $pdata['pid'] . '.php';
$obl_lock_dir = dirname($obl_lock_file);
if (!is_dir($obl_lock_dir)) @mkdir($obl_lock_dir, 0755, true);
$obl_lock_fp = fopen($obl_lock_file, 'w');
if (!$obl_lock_fp || !flock($obl_lock_fp, LOCK_EX | LOCK_NB)) {
    echo compatible_json_encode(array('error' => 'COMMAND_IN_PROGRESS'));
    exit;
}
// 锁在进程结束/脚本 exit 时由 OS 自动释放，无需显式释放
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
    'battle_log_old_max' => 10,   // 战斗日志历史归档最大批次（保留量）
];
```

读取方式: `obl_get_config()`（带静态缓存）

### 7.2 `item_table.php` — 道具模板

```php
'item_id' => [
    'itm'         => string,  // 道具名
    'itmk'        => string,  // 种类代码 (WP/WK/WG/WD/WF/AR/AH/AA/MT/HH/HS/DX/TK/SP)
    'itme'        => int,     // 效果值
    'itms'        => string,  // 耐久
    'itmsk'       => string,  // 耐久种类
    'itmpara'     => string,  // 参数(JSON)
    'desc'        => string,  // 描述
    'tier'        => string,  // 稀有度: common/uncommon/rare/epic
    'stack'       => bool,    // 是否可堆叠
    'stack_limit' => int,     // 堆叠上限（仅stack=true时）
]
```

**种类代码**: WP=钝器 WK=刃器 WG=枪械 WD=投掷 WF=灵符 AR=身体防具 AH=头部防具 AA=饰品 MT=材料 HH=恢复 HS=食物 DX=药物 TK=工具 SP=特殊

### 7.3 `poi_table.php` — POI模板

```php
'poi_id' => [
    'name'            => string,  // POI名称
    'desc'            => string,  // 描述
    'searchable'      => bool,    // 是否可搜索
    'repeatable'      => bool,    // 是否可重复搜索
    'repeat_limit'    => int,     // 最大搜索次数(0=无限)
    'repeat_cooldown' => int,     // 冷却回合数
    'mechanic'        => string,  // 机制名(如 max_hp_up/learn_skill)
    'mechanic_value'  => mixed,   // 机制值
    'mechanic_params' => array,   // 机制参数
]
```

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

### 7.8 `enemies_config.php` — NPC 敌人类型定义

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

### 7.9 `enemy_pool.php` — NPC 敌人刷新池

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
| `obl_fetch_playerdata_by_name` | `($name): array\|false` | 按 name 抓取并格式化（type=0 玩家） |
| `obl_fetch_enemies_by_region` | `($pgroup): array` | 批量获取区域内敌人（type>0，已格式化） |
| `obl_format_playerdata` | `(array &$pdata): void` | 解码所有 JSON 字段，保证结构合法（itempara/tacpara/skillpara/oblpara/装备 para） |
| `obl_save_player` | `(array &$pdata): void` | 编码 JSON 字段并 UPDATE 到 oblplayers（不同步 bra_players） |
| `obl_game_entrypoint` | `($entry_type = 'game'): array` | 入口封装：cookie 校验 → 抓取 → 格式化 |
| `obl_entrypoint_handle_failure` | `($status, $entry_type): void` | 认证失败处理（command 返回 JSON，game 跳转登录） |
| `obl_get_items` | `(array &$pdata): array` | 获取道具栏数组（index 0=特殊槽，1~itemmaxslots=普通） |
| `obl_get_item` | `(array &$pdata, $slot): array\|null` | 获取指定槽位道具 |
| `obl_set_item` | `(array &$pdata, $slot, $item): void` | 设置指定槽位道具（null=清空） |
| `obl_find_empty_slot` | `(array &$pdata): int\|false` | 找空普通槽（1~itemmaxslots），无空位返回 false |
| `obl_is_bag_full` | `(array &$pdata): bool` | 背包是否已满 |
| `obl_create_player_record` | `($ndata): int\|false` | valid.php 激活时创建 oblplayers 记录（从 $ndata itm1~itm6 构建 itempara） |
| `obl_command_allowed_by_state` | `($command, $action): bool` | 命令状态过滤：action='battle' 只允许 obl_battle_action；非战斗状态不允许 obl_battle_action（obl_battle_start 仍允许） |

### 8.2 tick.func.php

游戏刻核心模块：标记管理 + 推进控制 + 监听器注册 + 事件调度 + 命令推进判定。

| 函数 | 签名 | 说明 |
|------|------|------|
| `obl_tick_request_advance` | `(): void` | 请求推进 tick（监听器调用，替代旧的 $obl_tick_advanced 引用传递） |
| `obl_tick_consume_advance` | `(): bool` | 消费"请求推进"标记（读取并清除） |
| `obl_tick_reset_advance` | `(): void` | 重置"请求推进"标记（调度开始时调用） |
| `obl_tick_advance` | `(): void` | 推进 1 游戏刻（obl_tick++ + 标记 $ginfochange，不调 save_gameinfo） |
| `obl_tick_synchronize` | `(): void` | 同步 obl_pretick = obl_tick（标记已处理） |
| `obl_tick_get` | `(): int` | 获取当前游戏刻 |
| `obl_tick_get_pretick` | `(): int` | 获取已处理到的游戏刻 |
| `obl_command_advances_tick` | `($command): bool` | 命令是否推进游戏刻（白名单：move/obl_explore/obl_search/obl_battle_start/obl_battle_action） |
| `obl_tick_register_listener` | `($phase, $cb): void` | 注册 tick 事件监听器（phase: battle_npc/idle_npc/post） |
| `obl_tick_get_listeners` | `($phase): array` | 获取指定阶段的所有监听器 |
| `obl_tick_dispatch` | `($delta, &$ctx): void` | 调度 tick 事件（三阶段：battle_npc 串行/idle_npc 并行/post 后处理） |
| `obl_resolve_tick_events` | `($delta): void` | tick 事件处理入口（由 common.inc.php 调用，抓取玩家+构造上下文+调度） |
| `obl_tick_has_busy_battle` | `(): bool` | 检查是否有战场在 PROCESSING 状态（委托 obl_battle_state_has_busy_battle） |

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
| `obl_pickup_item` | `(int $iid, array &$pdata): void` | 拾取道具（含近视揭示/陷阱/并发保护） |
| `obl_discard_item` | `(int $slot, array &$pdata): void` | 丢弃道具（含item_id还原到地图） |

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

NPC 敌人系统核心，17 个函数按模块分组。NPC 数据与玩家同构（统一存 `bra_oblplayers`，`type>0` 区分），AI 不依赖当前请求的玩家，在 tick 结算入口自行从数据库查询。

**模块 1：NPC 生成**（4 函数）

| 函数 | 签名 | 说明 |
|------|------|------|
| `obl_init_enemies` | `(): void` | 生成所有区域的 NPC 敌人（在 `rs_init_oblivions` 中调用，按 `enemy_pool.php` 配置） |
| `obl_create_enemy_record` | `($enemy_type, $pgroup, $pls): int\|false` | 创建敌人记录（从 `enemies_config.php` 读属性，写入 oblplayers） |
| `obl_get_occupied_positions` | `($pgroup): array` | 获取指定区域已占用的 pls（玩家+NPC，`{pls => true}`） |
| `obl_pick_available_tile` | `($available_pls, &$occupied): int\|false` | 从可用格列表随机选一个未被占用的 |

**模块 2：NPC AI 结算**（2 函数）

| 函数 | 签名 | 说明 |
|------|------|------|
| `obl_resolve_all_enemy_ai` | `(): void` | 全局结算入口（在 `obl_resolve_tick_events` 中调用，查询所有玩家并结算其所在区域敌人） |
| `obl_enemy_tick` | `(&$enemy, &$player): void` | 单个敌人的 AI 决策：行动意愿门控 → 感知范围内追击 / 否则按 ai_type 行动 |

**模块 3：移动逻辑**（4 函数）

| 函数 | 签名 | 说明 |
|------|------|------|
| `obl_enemy_move` | `(&$enemy, $target_pls, &$player): bool` | 敌人移动（可在雾中移动，目标格=玩家格时触发碰撞战斗，移动后更新 discovered） |
| `obl_enemy_chase_player` | `(&$enemy, &$player): void` | 追击玩家（计算向玩家移动的下一步） |
| `obl_enemy_patrol` | `(&$enemy, &$player): void` | 巡逻（随机选邻居格移动） |
| `obl_enemy_hunt` | `(&$enemy, &$player): void` | 主动搜寻（MVP 简化为巡逻） |

**模块 4：碰撞战斗**（1 函数）

| 函数 | 签名 | 说明 |
|------|------|------|
| `obl_resolve_collision_battle` | `(&$a, &$b): void` | 碰撞战斗结算（过渡实现：设 action='battle' → emit 日志 → 立即清除。`$a` 永远是发起方/移动方） |

**模块 5：discovered 状态管理**（2 函数）

| 函数 | 签名 | 说明 |
|------|------|------|
| `obl_discover_enemies` | `($player_pgroup, $player_pls, $vision_range): void` | 玩家探索时发现敌人（设 discovered=1 + 清除敌人格迷雾 + emit 日志） |
| `obl_update_enemy_discovered` | `(&$enemy, &$player): void` | 敌人移动后更新 discovered（超出玩家视野→0，仍在视野内→清除迷雾） |

**模块 6：占用检查与辅助函数**（4 函数）

| 函数 | 签名 | 说明 |
|------|------|------|
| `obl_is_tile_occupied_by_others` | `($pgroup, $pls, $exclude_pid): bool` | 检查地图格是否被其他单位占用 |
| `obl_calc_next_step_towards` | `($pgroup, $from_pls, $to_pls): int\|false` | 计算向目标移动的下一步（选距离最近的邻居格） |
| `obl_get_tile_neighbors` | `($pgroup, $pls): array` | 获取地图格的邻居列表 |
| `obl_get_player_vision_range` | `(&$player): int` | 获取玩家视野范围（MVP 固定值 3，用于敌人 discovered 管理） |

### 8.8 battle.func.php — 战斗功能函数

战斗系统基础功能。NPC 与玩家共用同一套战斗逻辑，通过 `actor['type']` 区分。

**模块 1：战斗状态管理**（2 函数）

| 函数 | 签名 | 说明 |
|------|------|------|
| `battle_state_init` | `(&$actor_data): void` | 初始化参战者战斗状态（设 `action='battle'`） |
| `battle_state_clear` | `(&$actor_data, &$obl_battle_log, &$battle_cache): void` | 清理战斗状态：清 action → 退出队列（queue_exit）→ 恢复 AP → save |

**模块 2：数值辅助**（3 函数，与 battle.calc.php 配合）

| 函数 | 签名 | 说明 |
|------|------|------|
| `battle_ap_recover` | `(&$actor_data, &$battle_cache, &$obl_battle_log): void` | AP 恢复（每轮开始时，恢复量为 max_ap，不超过上限） |
| `battle_act_verify` | `(&$actor_data, $act_id, &$obl_battle_log, &$battle_cache): bool` | 单动作校验：委托 skill_act_verify 查配置/拥有/CD/AP/扣 AP |
| `battle_apply_damage` | `(&$actor_data, &$target_data, $damage, &$obl_battle_log, &$battle_cache): void` | 扣除目标 HP，保底 0 |

**模块 3：目标状态检测**（2 函数，旧接口，逐步被 tag 系统替代）

| 函数 | 签名 | 说明 |
|------|------|------|
| `battle_target_alive_check` | `(&$target_data, &$obl_battle_log, &$battle_cache): bool` | 存活检测：hp<=0 且 state=0 → 设 state=1 + state_clear；state=1 → 返回 false |
| `battle_target_distance_check` | `(&$actor_data, &$target_data, &$battle_cache): bool` | 射程检测（阶段一恒返回 true） |

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
| `battle_actor_can_act` | `(&$actor_data, &$obl_battle_log): bool` | Actor 行动资格检查（state>0 或 hp<=0 视为不能行动），失败时 emit |

### 8.9 battle.main.php — 战斗执行模块

verify（校验）→ sort（终结技排序）→ execute（执行+后检）→ end（集中 cleanup）四阶段分离。

| 函数 | 签名 | 说明 |
|------|------|------|
| `battle_main` | `(&$actor_data, &$atk_act, &$obl_battle_log, &$battle_cache): void` | 回合主函数：verify → sort_actions → execute → main_end。队列管理由调用方在返回后调 `battle_manage_queue` |
| `battle_verify` | `(&$actor_data, &$atk_act, &$obl_battle_log, &$battle_cache): void` | 回合校验：遍历 atk_act 调用 battle_act_verify，失败的 unset |
| `battle_execute` | `(&$actor_data, &$atk_act, &$obl_battle_log, &$battle_cache): void` | 遍历 atk_act：actor_can_act → 对每个 target 调 execute_verify → once_execute |
| `battle_once_execute` | `(&$actor_data, $act_id, &$target_data, &$obl_battle_log, &$battle_cache): void` | 单次受击：state_init → skill_execute → calc_damage → apply_damage → middle_check → save(both) |
| `battle_execute_verify` | `(&$actor_data, $act, &$obl_battle_log, &$battle_cache): ?array` | 单 action-target 校验：fetch target → build_tags → check target_rules，返回 `['target_data','tags']` 或 null |
| `battle_state_middle_check` | `(&$actor_data, &$target_data, $act_id, &$obl_battle_log, &$battle_cache): void` | 伤害结算后写缓存（combatants + tag_mutations），不改 DB。三路：存活→1，逃跑→0不改dead，死→0+dead=true |
| `battle_main_end` | `(&$actor_data, &$atk_act, &$obl_battle_log, &$battle_cache): void` | 集中 cleanup：遍历 combatants[pid]=0，dead→state=1+clear，escaped→clear(不改state)，兜底→clear |
| `battle_sort_actions` | `(array &$atk_act): void` | 终结技排序：普通技在前，finisher 在后；多终结技只保留最后一个 |

### 8.10 battle_log.func.php — 战斗日志系统

战斗日志收集与持久化，与 obl_log 分离（详见 [DESIGN.md §1.10](./DESIGN.md#110-战斗日志-battle-log-与-played-标记机制)）。

| 函数/类 | 签名 | 说明 |
|---------|------|------|
| `BattleLogCollector` | 类 | 战斗日志收集器，单次请求内累积。在 `common.inc.php` 入口初始化为全局 `$obl_battle_log` |
| `BattleLogCollector::emit` | `($turn, $actor, $action_id, $action_name, $target, $effect_value = 0, $extra = null, $position = null, $enemy_pid = 0): void` | 追加一条战斗日志（含 `enemy_pid` 用于前端按战斗分组） |
| `BattleLogCollector::getEntries` | `(): array` | 获取本请求累积的战斗日志条目 |
| `BattleLogCollector::hasEntries` | `(): bool` | 本请求是否有战斗日志 |
| `obl_battle_log_get_old_max` | `(): int` | 读取 battle_log 历史归档最大批次配置（带静态缓存） |
| `obl_battle_log_persist` | `($logger, $groomid, $pid): void` | 持久化战斗日志到文件（追加模式 + log_id 分配 + played=0 + LOCK_EX） |
| `obl_battle_log_load` | `($groomid, $pid): array` | 从文件读取**未播放**的战斗日志（played=0），不清空文件 |
| `obl_battle_log_mark_played` | `($groomid, $pid, $log_ids): int` | 标记指定 log_id 的战斗日志为已播放（played=1）。供 `mark_battle_log_played.php` 调用 |
| `obl_battle_log_clear_all` | `(): void` | 清理所有战斗日志文件（在 `rs_game()` 游戏重置时调用，删除 `oblivions/cache/battles/obl_battle_log*.json`） |

### 8.11 battle.entry.php — 战斗入口

4 种战斗入口 + 1 个玩家回合入口（入口 5），统一调用 battle_main + battle_manage_queue 分离模式。

| 函数 | 签名 | 说明 |
|------|------|------|
| `battle_entry_player_ambush` | `(&$pdata, $actions): void` | 入口 1：玩家突袭 NPC。命令触发，后补票建队列 |
| `battle_entry_npc_ambush` | `(&$npc, $actions): void` | 入口 2：NPC 突袭玩家。AI 决策触发，后补票建队列 |
| `battle_entry_encounter` | `(&$actor, $combatants): void` | 入口 3：遭遇战。移动重叠触发，先建队列+先攻判定。NPC 先攻时立即触发入口 4 |
| `battle_entry_npc_prepare_actions` | `(&$npc, $actions): array` | 入口 4：NPC 回合准备。tick 系统或入口 3 分支触发，返回 manage_queue 结果 |
| `cmd_handle_obl_battle_action` | `(&$pdata, $actions = null): void` | 入口 5：玩家回合动作。`obl_battle_action` 命令处理器（位于 oblivions_commands.php） |
| `battle_cache_create` | `(&$initiator_data, $is_ambush = false, $combatants = null): array` | 统一构建战斗上下文。有队列→载入全部成员，无队列→仅自己。初始化 `combatants` + `tag_mutations` |
| `battle_entry_parse_actions` | `($actions, $actor_pid, $entry): array` | 解析 actions 合集为 `$atk_act` 格式 |

### 8.12 skill.main.php — 技能系统核心

| 函数 | 签名 | 说明 |
|------|------|------|
| `skill_get_config` | `($skill_id): array\|null` | 获取技能配置（带静态缓存） |
| `skill_get_all_configs` | `(): array` | 加载全部技能配置 |
| `skill_has_cd` | `($skill_id): bool` | 检查技能是否有 CD 定义 |
| `skill_is_finisher` | `($skill_id): bool` | 检查技能是否为终结技（配置 `finisher=1`） |
| `skill_is_usable` | `(&$actor_data, $skill_id): bool` | 检查技能是否可用（配置存在/拥有/CD/AP），不修改状态 |
| `skill_format_skillpara` | `(&$skillpara): void` | 技能数据格式化：解码 JSON+补默认值 |
| `skill_ensure_defaults` | `(&$skillpara): void` | 确保 skillpara 存在默认字段 |
| `skill_strip_temporary` | `(&$skillpara): void` | 剥离临时技能 |
| `skill_act_verify` | `(&$actor_data, $act_id, &$obl_battle_log, &$battle_cache): bool` | 动作校验入口：查配置/拥有/CD/AP/扣 AP |
| `skill_execute` | `(&$actor_data, $act_id, &$target_data, &$obl_battle_log, &$battle_cache): void` | 技能执行入口：按 category 分发到 calc/escape 等 |
| `skill_get_available_list` | `(&$pdata): array` | 获取可用技能列表（含运行时状态：on_cd/available） |

### 8.13 battle.queue.func.php — 战斗队列管理

| 函数 | 签名 | 说明 |
|------|------|------|
| `battle_manage_queue` | `(&$actor_data, &$obl_battle_log, &$battle_cache): array` | 队列管理入口（ensure → advance → try_end），返回 `['disbanded','rebuilt','next']`；内部同步 `next_pid` 到 state 表并做状态转换 |
| `battle_queue_ensure` | `(&$actor_data, &$obl_battle_log, &$battle_cache): void` | 确保 actor_data 关联先攻队列（无队列时创建） |
| `battle_queue_create` | `(&$actor_data, &$combatants, &$obl_battle_log): void` | 创建队列+状态机：设 bid → 写 bra_oblqueue → 创建 bra_oblbattle_state |
| `battle_queue_rebuild` | `($qid, $combatants, &$obl_battle_log): void` | 重建队列（不设 bid，不建状态机） |
| `battle_queue_join` | `(&$actor_data, $qid, &$obl_battle_log): void` | 加入已有队列 |
| `battle_queue_done` | `(&$actor_data, $qid, &$obl_battle_log): void` | 标记 pid 回合完成 |
| `battle_queue_update` | `(&$actor_data, &$obl_battle_log, &$battle_cache): void` | 检查全员 done → 解散/重建/下轮 |
| `battle_queue_exit` | `(&$actor_data, &$obl_battle_log, &$battle_cache): void` | 从队列删除自己，设 bid=0 |
| `battle_queue_advance` | `(...): void` | 标记 done + 解散/重建检查 + 更新 `last_acted` |
| `battle_queue_try_end` | `(...): void` | 战斗结束检测 |
| `battle_queue_prepare_next_round` | `(&$actor_data, &$obl_battle_log, &$battle_cache): void` | 准备下一轮：AP 恢复 + 重置全员 done + 更新 last_acted |

---

## 九、代码规范

### 9.1 命名约定

| 类别 | 规则 | 示例 |
|------|------|------|
| 函数 | `obl_` 前缀 + 蛇形命名 | `obl_update_vision`, `obl_search_poi` |
| 机制函数 | `obl_mechanic_{name}` | `obl_mechanic_max_hp_up` |
| 命令处理器 | `cmd_handle_obl_{command}` | `cmd_handle_obl_explore` |
| 数据库表 | `{$tablepre}obl{entity}`（无下划线连写） | `bra_oblplayers`, `bra_oblmapstates`, `bra_oblmappoi`, `bra_oblmapitem` |
| 配置键 | 蛇形命名 | `explore_sp_cost`, `vision_range` |
| 日志 ID | `{logcategory}.{subevent}` | `move.success`, `pickup.bag_full`, `search.result` |
| 战斗日志 action_id | 蛇形命名 | `unarmed_strike`, `escape`, `battle.start`, `initiative.roll`, `battle.end` |

### 9.2 数据传递规范

- **`$pdata` 引用传递**: 所有修改玩家数据的函数接受 `&$pdata`，禁止函数内 `extract()`
- **日志输出**: 通过 `global $obl_log` + `$obl_log->emit($id, $logcategory, $params)`
- **战斗日志输出**: 通过 `global $obl_battle_log` + `$obl_battle_log->emit($turn, $actor, $action_id, $action_name, $target, $effect_value, $extra, $position, $enemy_pid)`
- **数据库操作**: 使用全局 `$db` + `$tablepre`，SQL中表名写 `{$tablepre}oblmapxxx`
- **配置读取**: 通过 `obl_get_config()` 获取，带静态缓存，不直接 include

### 9.3 并发安全

- **拾取竞态**: `DELETE ... WHERE iid='$iid' AND discovered>0`，检查 `affected_rows()` 防重复拾取
- **搜索计数**: `UPDATE ... SET search_count=search_count+1` 原子递增
- **迷雾写入**: `INSERT ... ON DUPLICATE KEY UPDATE fog=1` 幂等操作
- **日志写入**: `file_put_contents` 加 `LOCK_EX`，多请求并发写入不丢数据
- **战斗日志写入**: `obl_battle_log_persist()` 加 `LOCK_EX`，多请求并发写入不丢数据
- **命令并发锁**: `obl_command.php` 使用 `flock(LOCK_EX|LOCK_NB)`，同一玩家同时只能处理一个命令（详见 [§6.5](#65-并发锁机制)）

### 9.4 itmpara 约定

- 数据库中为 JSON 数组格式
- 拾取时注入 `obl_item_id` 键保存原始地图道具ID
- 丢弃时取出 `obl_item_id` 并 `unset`，还原原始 itmpara 写回地图

### 9.5 战斗日志 emit 规范

- **必须传 `enemy_pid`**：所有 `$obl_battle_log->emit()` 调用必须传第 9 个参数 `enemy_pid`，用于前端按战斗分组播放
- **actor 是玩家时**：`enemy_pid = target['pid']`
- **actor 是敌人时**：`enemy_pid = actor['pid']`
- **turn=0 用于非回合事件**：`battle.start` / `initiative.roll` / `battle.end` 用 turn=0，前端显示为"战斗开始"分隔符
- **turn>=1 用于回合内动作**：`unarmed_strike` / `escape` 用实际回合号，前端显示为"回合 N"分隔符

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
7. 移动推进游戏刻 → obl_resolve_tick_events($delta)
   → 循环 $delta 次调用 obl_resolve_all_enemy_ai()
     → 逐个玩家所在区域的敌人执行 obl_enemy_tick()
       → 感知范围内：追击玩家（obl_enemy_chase_player）
       → 感知范围外：按 ai_type 行动（patrol/aggressive/idle）
       → 敌人移动到玩家格 → 碰撞战斗（obl_resolve_collision_battle）
8. 战斗流程:
   8.1 玩家主动攻击：obl_battle_start 命令 → obl_battle_initiate（校验+状态检测+先攻判定+NPC自动执行）
   8.2 遭遇战：tick 结算中 NPC 移动到玩家格 → obl_battle_encounter（状态检测+先攻判定+NPC自动执行）
   8.3 战斗动作：obl_battle_action 命令 → obl_battle_resolve_round（玩家回合+NPC自动执行）
   8.4 战斗结束：obl_battle_end（清空状态+设置死亡+emit 日志+保存）
```

每一步操作产生的日志通过 `$obl_log->emit()` 收集，请求结束前由 `obl_log_persist()` 持久化。
战斗细节日志通过 `$obl_battle_log->emit()` 收集，请求结束前由 `obl_battle_log_persist()` 持久化（played=0）。

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
| 玩家位置 + 房间ID | `player_info` | `pgroup`(区域), `pls`(格子), `groomid`(房间ID, 供 mark 接口用) |
| 结构化日志 | `obl_log` | `entries[]`（LogEntry 数组）, `total` |
| 战斗日志（未播放） | `battle_log` | `entries[]`（BattleLogEntry 数组，played=0）, `total` |
| 当前区域敌人 | `enemies` | `enemies[]`（已发现敌人列表） |

### 11.3 命令提交

前端通过 `commandQueue.execute()` 提交命令（详见 vex-vue/CODEBASE.md）：

```typescript
// 探索
commandQueue.execute({ command: 'obl_explore' });

// 搜索POI
commandQueue.execute({ command: 'obl_search', iaid: String(poiIaid) });

// 拾取道具
commandQueue.execute({ command: 'obl_pickup', iid: String(itemIid) });

// 丢弃道具
commandQueue.execute({ command: 'obl_discard', slot: String(slotNumber) }); // slot: 1-6

// 移动
commandQueue.execute({ command: 'move', moveto: String(targetPls) });

// 玩家主动攻击（直接进入 battle 状态）
commandQueue.execute({ command: 'obl_battle_start', enemy_pid: String(enemyPid) });

// 战斗动作（玩家回合）
commandQueue.execute({ command: 'obl_battle_action', action_id: 'unarmed_strike' });
```

### 11.4 战斗日志标记

前端通过 `markBattleLogPlayed()` 标记 played=1（零依赖接口）：

```typescript
await fetch(`${API_BASE}/oblivions/mark_battle_log_played.php`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
        groomid: String(groomid),
        pid: String(pid),
        log_ids: logIds.join(',')
    }).toString()
});
```

### 11.5 前端关键逻辑

- **迷雾渲染**: `fog=0` 的格子不可见（不渲染/灰色覆盖），`fog=1` 的格子正常显示
- **POI可见性**: 仅迷雾清除后的POI返回（由API过滤）
- **道具可见性**: 仅 `discovered>0` 的道具返回（由API过滤）
- **近视道具**: `discovered=2` 时显示 `display_name`（带"？"），拾取后揭示真实身份
- **道具分组**: POI关联道具在 `pois[].items`，散落道具在 `ground_items`
- **背包槽位**: `itempara` JSON 数组（index 0=特殊槽，1~itemmaxslots=普通槽），对应 `slot` 参数 1~itemmaxslots
- **结构化日志渲染**: 前端按 `entry.id` 查 `vex-vue/src/data/log-templates.ts` 模板渲染，后端不参与视觉呈现
- **地块描述生成**: 无名格描述由前端 `vex-vue/src/data/terrain-desc.ts` 的 `generateTerrainDesc()` 随机组合，后端只传 floor/tide/passable 属性
- **敌人可见性**: 仅 `discovered=1` 的敌人返回（由 `enemies` API 过滤），敌人移动超出玩家视野后自动从列表移除
- **战斗日志播放**: 前端按 `enemy_pid` 分组，每组按 `log_id` 排序，三阶段播放（碰撞动画 → 模态框 → 残留伤害数字），播完调 mark 接口
- **战斗状态过滤**: `action='battle'` 时前端只允许提交 `obl_battle_action`；非战斗状态不允许提交 `obl_battle_action`（后端 `obl_command_allowed_by_state` 强制）
- **战斗处理中锁**: 前端 `commandQueue.isLocked` / `pendingNpc` 从 `oblBattleState === 'PROCESSING'` 派生，拒绝推进 tick 的命令
- **技能渲染**: 前端按 `skill_id` 查 `vex-vue/src/data/skill-templates.ts` 渲染名称/描述/动作描述，未注册的 skill_id 回退到以 skillId 作为 name 的默认模板
- **可用技能列表**: `player_info` API 返回 `skills` 字段（由 `skill_get_available_list()` 生成，含运行时状态 on_cd/available）

---

**文档结束。** 概念定义与设计原则见 [DESIGN.md](./DESIGN.md)，结构化日志系统的完整 ID 清单见 `vex-vue/src/data/log-templates.ts`，Toast 即时反馈机制详见 [vex-vue/CODEBASE.md](../../vex-vue/CODEBASE.md)。
