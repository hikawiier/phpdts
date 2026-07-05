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
│   │   ├── obl_bootstrap.php     # 统一加载入口（按拓扑排序分 8 层加载所有函数库，详见 §4）
│   │   └── obl_command.php       # Oblivions 命令入口（由 command.php require，处理全部命令流程 + 并发锁）
│   ├── command/
│   │   ├── oblivions_router.php       # Oblivions 命令子路由（分发到各 cmd_handle_obl_*，含 actions JSON 解析）
│   │   └── oblivions_commands.php     # 6 个命令处理器（explore/search/pickup/discard + battle_start/battle_action）
│   ├── gamectl/
│   │   ├── init.func.php         # 游戏初始化（obl_rs_game 主入口 + obl_init_enemies 敌人生成 + 建表/地图/迷雾生成）
│   │   └── state.func.php        # 游戏状态机（触发 obl_rs_game）
│   └── game/
│       ├── obl_global.func.php   # 公共函数（obl_get_config 等）
│       ├── log.func.php          # 结构化日志收集器 + 持久化/读取（详见 §8.6）
│       ├── battle_log.func.php   # 战斗日志收集器 + played 标记机制（详见 §8.10）
│       ├── sql.func.php          # SQL 操作封装（队列/状态机查询）
│       ├── player.func.php       # 玩家数据层：认证/抓取/格式化/保存 + 命令状态过滤（详见 §8.1）
│       ├── move.func.php         # 移动/地图数据加载/BFS距离计算（详见 §8.4）
│       ├── generate.func.php     # 区域资源生成（道具/POI/野生道具，详见 §8.5）
│       ├── vision.func.php       # 视野/迷雾/发现系统（BFS视野 + 迷雾点亮 + 敌人发现/discovered 管理）
│       ├── explore.func.php      # 探索/搜索核心逻辑（详见 §8.3）
│       ├── enemy_ai.func.php     # NPC 敌人 AI 行为（10 函数：tick 监听器/决策/移动，详见 §8.7）
│       ├── tick.func.php         # 游戏刻核心（推进控制/监听器注册/事件调度，详见 §8.2）
│           ├── battle_state_machine.func.php  # 战斗状态机（PLAYER_TURN/PROCESSING 状态转换）
│           ├── item/
│           │   ├── item.tag.func.php       # 道具 Tag 系统（tags/itmk/tool_level 查询，详见 §8.14.1）
│           │   ├── item.basic.func.php     # 道具库存基础操作（堆叠/itm0/拾取/丢弃/整理，详见 §8.14.0）
│           │   ├── item.use.func.php       # 道具使用系统（use_effect 分发框架，详见 §8.14.2）
│           │   └── item.craft.func.php     # 合成系统（匹配算法/素材消耗/已发现配方，详见 §8.14.3）
│           └── battle/
│           ├── battle.func.php       # 战斗功能函数（Tag/规则/状态管理，详见 §8.8）
│           ├── battle.calc.php       # 伤害计算
│           ├── battle.main.php       # 战斗执行（verify→sort→execute→end，详见 §8.9）
│           ├── battle.entry.php      # 战斗入口（battle_entry_dispatch 唯一入口，详见 §8.11）
│           ├── battle.queue.func.php # 战斗队列管理接口（详见 §8.13）
│           └── battle.queue.main.php # 队列管理实现
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
| `include/command/handlers/basic_commands.php` | move/search 命令的 Oblivions 分支（Oblivions 模式由 oblivions_router.php 直接调用 obl_move） |
| `api_v2.php` | 15 个 API 端点（player_info/player_inventory/game_map/tile_actions/obl_log/obl_error/battle_log/enemies/skill_list/skill_cd_check/ai_dump_save/heartbeat + 合成三件套：craft_preview/craft_workbench_materials/craft_recipes） |
| `command.php` | Oblivions 模式路由分发器（require obl_command.php 后 exit） |
| `include/gamectl/system.func.php` | `rs_init_areas()` 在 Oblivions 模式下跳过禁区系统初始化 |
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
| 5.5 | `item.tag` / `item.basic` / `item.use` / `item.craft` | 道具系统（依赖 log + player + explore，无循环依赖；加载顺序：tag（数据加载）→ basic（基础操作）→ use（衍生）→ craft（衍生）） |
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
| **装备** | `wepid`/`wep`/`wepk`/... | 7 槽装备（每槽 1 个模板 ID + 6 个运行时字段：自定义名/k/e/s/sk/para） |
| **道具栏** | `itempara` | JSON 数组（七字段规范，见下方 itmpara / itempara 小节） |
| | `itemmaxslots` | 道具栏最大格数（默认 6，index 0=itm0 缓存槽，1~itemmaxslots=普通槽） |
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
| `itm` | string | 实例自定义名；空值表示用 `itmid` 查前端 locale 渲染模板名 |
| `itmk` | string | 道具种类 |
| `itme` | int | 效果值 |
| `itms` | string | 耐久 |
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

**ID 命名规则**：`{logcategory}.{subevent}`，如 `move.success`、`organize.fail`、`search.result`。完整 ID 清单见前端 `vex-vue/src/data/log-templates.ts`。

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

### 5.9 `craft_preview` — 合成预判（前端用）

- **请求**: `GET api_v2.php?action=craft_preview&slots=1,3,5&workbench_materials=poi:123`
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
    "is_new_recipe": false
  }
}
```
- `match_count = 0` → 不亮（无匹配）
- `match_count = 1` → 亮灯（可合成）
- `match_count >= 2` → 不亮（指向不明确）
- `is_new_recipe` → 匹配的配方玩家未发现过

### 5.10 `craft_workbench_materials` — 可用工作台素材

- **请求**: `GET api_v2.php?action=craft_workbench_materials`
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

### 5.11 `craft_recipes` — 已发现配方列表

- **请求**: `GET api_v2.php?action=craft_recipes`
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
- 过滤逻辑：从 `oblpara.discovered_recipes` 读取 → 调 `item_recipe_visibility_filter` 判断可见性 → 只返回可见配方
- P0 阶段所有已发现配方均可见（`item_recipe_visibility_filter` 返回 true）

### 5.12 `mark_battle_log_played.php` — 零依赖标记接口

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
| `obl_discard` | `slot` (int 0~itemmaxslots) | `obl_discard_item($slot, $pdata)` | 丢弃道具（slot=0 丢弃 itm0 缓存槽；1~itemmaxslots 丢弃普通槽位道具，写回地图道具表） |
| `obl_battle_start` | `actions` (JSON) | `cmd_handle_obl_battle_start($pdata, $actions)` | 玩家突袭：通过 `battle_entry_dispatch('ambush')` 执行 |
| `obl_battle_action` | `actions` (JSON) | `cmd_handle_obl_battle_action($pdata, $actions)` | 玩家回合：通过 `battle_entry_dispatch('player_turn')` 执行 |
| `obl_use_item` | `slot` (int 1~itemmaxslots) | `cmd_handle_obl_use_item($slot, $pdata)` → `item_use($slot, $pdata)` | 使用背包道具（检查 tag_usable + use_effect 分发） |
| `obl_craft` | `slots` (string 逗号分隔槽位号), `workbench_materials` (string 可选) | `cmd_handle_obl_craft($slots, $wb, $pdata)` → `item_craft($slots, $pdata, $wb)` | 合成道具（指向性判断 + 素材消耗 + 产物生成） |
| `obl_organize` | 无 | `cmd_handle_obl_organize($pdata)` → `obl_organize_inventory($pdata)` | 整理背包（合并同类堆叠 + 转移 itm0 → 背包；itm0 锁定时唯一可用命令之一） |

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
   [C2a] itm0 门控（oblivions_router.php）：itempara[0] 非空时只允许 obl_organize / obl_discard
        → 被拒绝的命令 emit 'system.itm0_pending' 日志，处理 itm0 是最高优先级
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
| `obl_fetch_playerdata_batch` | `(array $pids): array` | 批量抓取多 pid 玩家数据 |
| `obl_fetch_playerdata_by_name` | `($name): array\|false` | 按 name 抓取并格式化（type=0 玩家） |
| `obl_fetch_enemies_by_region` | `($pgroup): array` | 批量获取区域内敌人（type>0，已格式化） |
| `obl_format_playerdata` | `(array &$pdata): void` | 解码所有 JSON 字段，保证结构合法（itempara/tacpara/skillpara/oblpara/装备 para） |
| `obl_save_player` | `(array &$pdata): void` | 编码 JSON 字段并 UPDATE 到 oblplayers（不同步 bra_players） |
| `obl_game_entrypoint` | `($entry_type = 'game'): array` | 入口封装：cookie 校验 → 抓取 → 格式化 |
| `obl_entrypoint_handle_failure` | `($status, $entry_type): void` | 认证失败处理（command 返回 JSON，game 跳转登录） |
| `obl_create_player_record` | `($ndata): int\|false` | valid.php 激活时创建 oblplayers 记录（从 $ndata itm1~itm6 构建 itempara） |
| `obl_command_allowed_by_state` | `($command, $action): bool` | 命令状态过滤：action='battle' 只允许 obl_battle_action；非战斗状态不允许 obl_battle_action（obl_battle_start 仍允许） |

> 道具栏槽位读写函数（`obl_get_items` / `obl_get_item` / `obl_set_item` / `obl_find_empty_slot` / `obl_is_bag_full`）已迁至 [§8.14.0 item.basic.func.php](#8140-itembasicfuncphp--道具库存基础操作)。

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

NPC 敌人 AI 行为核心，10 个函数。NPC 数据与玩家同构（统一存 `bra_oblplayers`，`type>0` 区分），AI 不依赖当前请求的玩家，在 tick 结算入口自行从数据库查询。

> **模块迁移说明**：NPC 生成（`obl_init_enemies` / `obl_create_enemy_record` / `obl_get_occupied_positions` / `obl_pick_available_tile`）已迁至 `gamectl/init.func.php`；discovered 状态管理（`obl_discover_enemies` / `obl_update_enemy_discovered` / `obl_get_player_vision_range`）已迁至 `vision.func.php`。本文件仅保留 AI 行为逻辑。

**模块 1：Tick 事件监听器**（2 函数，由 `tick.func.php` 末尾集中注册）

| 函数 | 签名 | 说明 |
|------|------|------|
| `obl_tick_phase_battle_npc` | `($delta, &$ctx): void` | battle_npc phase 监听器：查询活跃先攻队列，当前顺位者是 NPC 时执行 NPC 回合（`obl_ai_select_combat_action` → `battle_entry_dispatch('npc_turn')`），最多处理 1 个回合 |
| `obl_tick_phase_idle_npc` | `($delta, &$ctx): void` | idle_npc phase 监听器：结算当前玩家所在区域的非战斗敌人 AI（`obl_enemy_tick`），战斗中的敌人跳过 |

**模块 2：AI 决策**（2 函数）

| 函数 | 签名 | 说明 |
|------|------|------|
| `obl_enemy_tick` | `(&$enemy, &$player): void` | 单敌人 AI 决策：死亡/战斗中跳过 → 行动意愿门控 → 按 `ai_type` 行动（patrol/aggressive/idle）。追击/突袭/碰撞战斗待 tick 框架重构后实现 |
| `obl_ai_select_combat_action` | `(&$npc_data, $target_pid): array` | 战斗技能选择：从 `oblpara['combat_skills']` 选第一个可用技能（CD/AP 检查），无可用时回退 `unarmed_strike`。按技能配置 `target` 字段决定目标（self→自身 pid，其他→传入 target_pid） |

**模块 3：移动逻辑**（3 函数）

| 函数 | 签名 | 说明 |
|------|------|------|
| `obl_enemy_move` | `(&$enemy, $target_pls, &$player): bool` | 敌人移动（可在雾中移动）：校验 passable/占用/玩家格 → 更新 pls → 更新 discovered → save。在玩家视野内时 emit 移动日志 |
| `obl_enemy_patrol` | `(&$enemy, &$player): void` | 巡逻：随机选邻居格移动 |
| `obl_enemy_hunt` | `(&$enemy, &$player): void` | 主动搜寻（MVP 简化为巡逻） |

**模块 4：占用检查与辅助函数**（3 函数）

| 函数 | 签名 | 说明 |
|------|------|------|
| `obl_is_tile_occupied_by_others` | `($pgroup, $pls, $exclude_pid): bool` | 检查地图格是否被其他单位占用 |
| `obl_calc_next_step_towards` | `($pgroup, $from_pls, $to_pls): int\|false` | 计算向目标移动的下一步（选距离最近的邻居格） |
| `obl_get_tile_neighbors` | `($pgroup, $pls): array` | 获取地图格的邻居列表 |

### 8.8 battle.func.php — 战斗功能函数

战斗系统基础功能。NPC 与玩家共用同一套战斗逻辑，通过 `actor['type']` 区分。

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
| `battle_actor_can_act` | `(&$actor_data, &$obl_battle_log, &$battle_cache = null): bool` | Actor 行动资格检查（state>0 或 hp<=0 视为不能行动），失败时 emit + 写 combatants 缓存 |

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
| `battle_main_end` | `(&$actor_data, &$atk_act, &$obl_battle_log, &$battle_cache): ?string` | 集中 cleanup：对 combatants[pid]=0 执行清理；ambush 下 actor quit 时返回 'dead'|'escaped'，不清理 actor |
| `battle_sort_actions` | `(array &$atk_act): void` | 终结技排序：普通技在前，finisher 在后；多终结技只保留最后一个 |

### 8.10 battle_log.func.php — 战斗日志系统

战斗日志收集与持久化，与 obl_log 分离（详见 [DESIGN.md §1.10](./DESIGN.md#110-战斗日志-battle-log-与-played-标记机制)）。

**BattleLogCollector 关键设计：**
- **12 phase 体系**：`initiative_roll` / `queue_create` / `queue_rebuild` / `once_execute_pre` / `once_execute_post` / `execute_verify_failed` / `middle_check_target_dead` / `combatant_cleared` / `actor_state_check` / `ap_recover` / `flee` / `battle_end` / `ambush_battle_end`。每个 phase 对应明确的最小参数集，消除占位符和 extra 滥用
- **render/debug 分离**：`emit()` 新增 `$debug` 参数（true=调试/false=渲染/null=按 phase 自动推断）。默认 debug 映射表 `$phaseDebugDefault` 控制各 phase 是否需要渲染（如 `queue_create` / `actor_state_check` 默认 debug=true 前端不可见）
- **边界标记**：每个条目自动携带 `bl_turn_num`（Turn 计数，null=Phase 0）、`bl_round_num`（Round 计数，null=Phase 0）、`bl_segment_flag`（段边界信号：`round_start`/`turn_start`/`battle_end`/`ambush_battle_end`/null）。`$phaseSegmentFlag` 映射表控制哪些 phase 触发边界标记
- **Turn/Round 管理**：`nextTurn()` 由 `battle_hook_turn_start` 调用递增；`setRoundNum()` 由 `battle_queue_create_and_init` / `battle_queue_rebuild` 调用同步 DB 的 round_num
- **字段完整**：emit 时给全名称（`actor_name`/`target_name`/`cleared_name`/`ambusher_name`）和 HP 快照（`actor_hp`/`actor_max_hp`/`target_hp`/`target_max_hp`），前端无需查 API
- **once_execute 拆分**：`once_execute_pre`（动作执行前快照，含名称/HP） + `once_execute_post`（动作执行后快照，含 effect_value/success），前端配对合并为完整动作条目

| 函数/类 | 签名 | 说明 |
|---------|------|------|
| `BattleLogCollector` | 类 | 战斗日志收集器，单次请求内累积。由 `battle_entry_ensure_battle_log` 统一初始化为全局 `$obl_battle_log` |
| `BattleLogCollector::setPhase` | `($phase): void` | 设置当前 phase（12 个事件类型之一），emit 时自动附加 |
| `BattleLogCollector::nextTurn` | `(): void` | Turn 计数递增（由 `battle_hook_turn_start` 调用） |
| `BattleLogCollector::setRoundNum` | `(int $num): void` | 设置 Round 计数（由队列创建/重建调用） |
| `BattleLogCollector::emit` | `(array $params, ?bool $debug = null): void` | 追加一条战斗日志。`$params` 支持键：`action_id` / `actor_pid/type/name/hp/max_hp/ap/max_ap` / `target_pid/type/name/hp/max_hp` / `effect_value` / `success` / `qid` / `rolls` / `ambush_pid` / `combatants` / `reason` / `winner_pid` / `cleared_pid` / `cleared_name` / `ambusher_pid` / `ambusher_name`。存储时附加 `ts` + 当前 `phase` + `debug` + `bl_turn_num`/`bl_round_num`/`bl_segment_flag` |
| `BattleLogCollector::getEntries` | `(): array` | 获取本请求累积的战斗日志条目 |
| `BattleLogCollector::hasEntries` | `(): bool` | 本请求是否有战斗日志 |
| `obl_battle_log_get_old_max` | `(): int` | 读取 battle_log 历史归档最大批次配置（带静态缓存） |
| `obl_battle_log_persist` | `($logger, $groomid, $pid): void` | 持久化战斗日志到文件（追加模式 + log_id 分配 + played=0 + LOCK_EX） |
| `obl_battle_log_load` | `($groomid, $pid, $includeDebug = false): array` | 从文件读取**未播放**的战斗日志（played=0），`$includeDebug=false` 时自动过滤 `debug=true` 的条目 |
| `obl_battle_log_mark_played` | `($groomid, $pid, $log_ids): int` | 标记指定 log_id 的战斗日志为已播放（played=1）。供 `mark_battle_log_played.php` 调用 |
| `obl_battle_log_clear_all` | `(): void` | 清理所有战斗日志文件（在 `rs_game()` 游戏重置时调用，删除 `oblivions/cache/battles/obl_battle_log*.json`） |

### 8.11 battle.entry.php — 战斗入口

唯一战斗入口 `battle_entry_dispatch`，与 `battle.main.php`（执行）+ `battle.queue.*.php`（队列）三层分离。3 种触发模式：`ambush`（突袭，后补票建队列）/ `player_turn`（玩家回合）/ `npc_turn`（NPC 回合，允许空动作）。所有触发源不做合法性判断，只传 raw `$actions`，解析/校验统一由 dispatch 内部完成。

| 函数 | 签名 | 说明 |
|------|------|------|
| `battle_entry_dispatch` | `($mode, &$actor, $actions = null, $extra = []): array\|void` | 唯一战斗入口。`$mode`：`'ambush' \| 'player_turn' \| 'npc_turn'`。ambush/player_turn 无返回值，npc_turn 返回 `battle_manage_queue` 结果 |
| `battle_entry_ensure_battle_log` | `(): void` | 确保 `$obl_battle_log` 已初始化（dispatch 统一调用） |
| `battle_cache_create` | `(&$initiator_data, $is_ambush = false, $combatants = null): array` | 统一构建战斗上下文。有队列→载入全部成员，无队列→仅自己。初始化 `combatants` + `tag_mutations` |
| `battle_entry_parse_actions` | `($actions, $actor_pid, $entry, $allow_empty = false): array` | 解析 actions 合集为 `$atk_act` 格式。空动作且 `$allow_empty=false` 时 emit 错误日志 |

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

### 8.14 item/ 子文件夹 — 道具系统

**文件**：`item.tag.func.php` + `item.basic.func.php` + `item.use.func.php` + `item.craft.func.php`

**依赖**：`item.tag.func.php` 依赖 `item_table.php`（数据文件）；`item.basic.func.php` 依赖 `item.tag.func.php`；`item.use.func.php` 依赖 `item.tag.func.php`；`item.craft.func.php` 依赖 `item.tag.func.php` + `item.use.func.php` + `item.basic.func.php`（`obl_put_item_to_itm0` / `obl_organize_inventory`）+ `explore.func.php`（`obl_get_poi_at_position`）

#### 8.14.0 `item.basic.func.php` — 道具库存基础操作

道具系统的"基础操作层"——槽位读写、堆叠、itm0 缓存槽、拾取、丢弃、整理。被 `item.use.func.php` / `item.craft.func.php` / `oblivions_commands.php` 等衍生层调用。

**itm0 缓存槽约定**（详见 [DESIGN.md §2.24](./DESIGN.md#224-itm0-缓存槽与事件解耦)）：
- `itempara[0]` 是新增道具的中转槽，所有新增道具（拾取/合成产物/未来卸装备）先入 itm0 再整理入背包
- itm0 非空时 router 层拒绝除 `obl_organize` / `obl_discard` 外的所有命令
- `obl_put_item_to_itm0`（检查 itm0 为空 + 放入）和 `obl_organize_inventory`（合并堆叠 + 转移 itm0 → 背包）是独立函数，由调用方分别调用
- `obl_organize_inventory` 是纯逻辑函数（不内部 emit），由调用方根据返回值 emit `organize.success` / `organize.fail` 事件

| 函数 | 签名 | 说明 |
|------|------|------|
| `item_get_stack` | `($item_id): bool` | 读取道具是否可堆叠（带静态缓存） |
| `item_get_stack_limit` | `($item_id): int` | 读取道具的 stack_limit（带静态缓存） |
| `_item_para_key` | `($itmpara): string` | 将 itmpara 标准化为字符串键，用于堆叠合并时的相等性比较 |
| `obl_get_items` | `(array &$pdata): array` | 获取道具栏数组（index 0=itm0，1~itemmaxslots=普通） |
| `obl_get_item` | `(array &$pdata, $slot): array\|null` | 获取指定槽位道具 |
| `obl_set_item` | `(array &$pdata, $slot, $item): void` | 设置指定槽位道具（null=清空） |
| `obl_find_empty_slot` | `(array &$pdata): int\|false` | 找空普通槽（1~itemmaxslots），无空位返回 false |
| `obl_is_bag_full` | `(array &$pdata): bool` | 背包是否已满 |
| `obl_find_mergeable_slot` | `(array &$pdata, $item_id, $itmpara = null): int\|false` | 查找可合并堆叠的槽位（仅查 1~itemmaxslots，不含 itm0）。合并条件：item_id 相同 + itmpara 相等 + 未达 stack_limit |
| `obl_add_item_to_inventory` | `(array &$pdata, $item): int\|false` | 添加道具到背包（自动合并，原子性）。预检查空间不足时返回 false，不修改任何数据。**只操作背包槽位 1~itemmaxslots，不操作 itm0** |
| `obl_merge_stacks_in_inventory` | `(array &$pdata): void` | 合并背包内同类堆叠（腾出空槽）。仅合并，不转移 itm0，不排序 |
| `obl_put_item_to_itm0` | `(array &$pdata, $item): bool` | 放入道具到 itm0 缓存槽。itm0 已被占用时返回 false（防御性检查，router 门控已拦截） |
| `obl_organize_inventory` | `(array &$pdata): bool` | 整理背包：合并同类堆叠 + 转移 itm0 → 背包。**纯逻辑函数（不内部 emit）**。返回 true=整理成功（itm0 已清空），false=背包满（itm0 保留）。由调用方根据返回值 emit `organize.success` / `organize.fail` 事件 |
| `obl_pickup_item` | `($iid, array &$pdata): void` | 拾取道具（10 步流程：读取实例 + itms='0' 检查 + 位置/发现状态检查 + 近视揭示 + 构建实例 + 放入 itm0 + 原子删除地图实例 + 自动整理 + emit pickup.success + emit organize.fail 解耦） |
| `obl_discard_item` | `($slot, array &$pdata): void` | 丢弃道具。slot=0 丢弃 itm0 缓存槽内容（直接抛弃，不写回地图）；1~itemmaxslots 丢弃普通槽位道具（写回 `bra_oblmapitem` 表） |

**事件解耦原则**（详见 [DESIGN.md §2.24](./DESIGN.md#224-itm0-缓存槽与事件解耦)）：
- `pickup.success`（拾取成功）与 `organize.fail`（整理失败）是独立事件，前端可同时收到分别处理
- `craft.success`（合成成功）与 `organize.fail` 同理解耦
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
| `item_use` | `($slot, &$pdata): void` | 命令入口：读取槽位 → 检查 tag_usable → 耐久检查 → use_effect 分发 → 耐久扣减 → emit use_item.success |
| `item_execute_use_effect` | `($item, &$pdata): void` | use_effect 分发框架（纯分发器，调 `item_use_effect_{name}()`，不预定义任何效果） |
| `item_consume_durability` | `(&$item, $amount = 1): void` | 耐久扣减（"999"/"∞"/"0" 特殊处理，归零 emit durability.broken） |

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
| `item_recipe_visibility_filter` | `($recipe, &$pdata): bool` | 配方可见性过滤接口（P0 返回 true，后续由剧情/全局事件驱动） |
| `item_get_discovered_recipes` | `(&$pdata): array` | 查询已发现配方（按可见性过滤后返回） |
| `item_discover_recipe` | `(&$pdata, $recipe_id): void` | 标记配方为已发现（写入 `oblpara.discovered_recipes`） |
| `item_craft_preview` | `($slots, &$pdata, $workbench_materials): array` | 前端预判 API 逻辑：返回 `{match_count, craftable, is_new_recipe}` |
| `item_craft` | `($slots, &$pdata, $workbench_materials): void` | 合成入口（12 步流程：解析素材 → 指向性判断 → 空间检查 → 扣素材 → 产物入 itm0（`obl_put_item_to_itm0`）+ 自动整理（`obl_organize_inventory`）→ 新配方发现 → emit `craft.success`（仅 recipe_id）+ 整理失败 emit `organize.fail` 解耦） |
| `obl_mechanic_craft_source` | `($template, &$pdata): void` | POI 机制占位（工作台素材的 POI 交互由 `item_get_available_workbench_materials` 接管，P0 不实现） |

---

## 九、代码规范

### 9.1 命名约定

| 类别 | 规则 | 示例 |
|------|------|------|
| 函数（通用） | `obl_` 前缀 + 蛇形命名 | `obl_update_vision`, `obl_search_poi` |
| 道具系统内部函数 | `item_` 前缀 + 蛇形命名 | `item_get_tags`, `item_craft`, `item_materials_match` |
| use_effect 注册函数 | `item_use_effect_` 前缀 | `item_use_effect_restore_sp`, `item_use_effect_cure_bs` |
| 机制函数 | `obl_mechanic_{name}` | `obl_mechanic_max_hp_up`, `obl_mechanic_craft_source` |
| 命令处理器 | `cmd_handle_obl_{command}` | `cmd_handle_obl_explore`, `cmd_handle_obl_craft` |
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
- **战斗日志写入**: `obl_battle_log_persist()` 加 `LOCK_EX`，多请求并发写入不丢数据
- **命令并发锁**: `obl_command.php` 使用 `flock(LOCK_EX|LOCK_NB)`，同一玩家同时只能处理一个命令（详见 [§6.5](#65-并发锁机制)）

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
8. 战斗流程（统一入口 battle_entry_dispatch）:
   8.1 玩家突袭：obl_battle_start 命令 → battle_entry_dispatch('ambush')（执行动作 + 后补票建队列）
   8.2 玩家回合：obl_battle_action 命令 → battle_entry_dispatch('player_turn')（在已有队列中推进）
   8.3 NPC 回合：tick 结算 → battle_entry_dispatch('npc_turn')（AI 决策 + 队列推进）
   8.4 战斗结束：battle_manage_queue 内部 try_end 检测（队列解散 + 状态清理）
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
| 玩家背包详情 | `player_inventory` | `items[]`（含 usable/tags/itmk 字段，供前端判断可使用/可装备道具） |
| 结构化日志 | `obl_log` | `entries[]`（LogEntry 数组）, `total` |
| 战斗日志（未播放） | `battle_log` | `entries[]`（BattleLogEntry 数组，played=0）, `total` |
| 当前区域敌人 | `enemies` | `enemies[]`（已发现敌人列表） |
| 合成预判 | `craft_preview` | `match_count`, `craftable`, `is_new_recipe` |
| 可用工作台素材 | `craft_workbench_materials` | `workbench_materials[]`（含 source/id/item_id/tool_level） |
| 已发现配方列表 | `craft_recipes` | `recipes[]`（含 recipe_id/category/materials/results） |

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
commandQueue.execute({ command: 'obl_discard', slot: String(slotNumber) }); // slot: 0=itm0 缓存槽, 1-6=普通槽位

// 整理背包（合并同类堆叠 + 转移 itm0 → 背包；itm0 锁定时唯一可用命令之一）
commandQueue.execute({ command: 'obl_organize' });

// 移动
commandQueue.execute({ command: 'move', moveto: String(targetPls) });

// 玩家突袭（预装填动作数组，JSON 字符串）
commandQueue.execute({ command: 'obl_battle_start', actions: JSON.stringify([{ act_id: 'unarmed_strike', target: enemyPid }]) });

// 战斗动作（玩家回合，预装填动作数组，JSON 字符串）
commandQueue.execute({ command: 'obl_battle_action', actions: JSON.stringify([{ act_id: 'unarmed_strike', target: enemyPid }]) });

// 使用道具
commandQueue.execute({ command: 'obl_use_item', slot: String(slotNumber) });

// 合成道具
commandQueue.execute({ command: 'obl_craft', slots: '1,3,5', workbench_materials: 'poi:123,passive:innate_t0' });
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
- **背包槽位**: `itempara` JSON 数组（index 0=itm0 缓存槽，1~itemmaxslots=普通槽），对应 `slot` 参数 1~itemmaxslots（slot=0 用于 `obl_discard` 丢弃 itm0 内容）
- **itm0 锁定处理**: `itempara[0]` 非空时后端拒绝除 `obl_organize` / `obl_discard` 外的所有命令（emit `system.itm0_pending`）；前端需检测 itm0 状态，提示玩家整理或丢弃 itm0 内容
- **整理失败事件**: 收到 `organize.fail`（携带 `item_id`）时，提示"背包已满，XX暂存到待整理区"；与 `pickup.success` / `craft.success` 是独立事件，可同时收到
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
