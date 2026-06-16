# Oblivions 子系统 — 代码库说明

> 帮助 AI 智能体快速了解 Oblivions 模式的后端架构、API 接口、数据结构和代码规范。
> 主项目文档：[CODEBASE.md](../../CODEBASE.md) | [GLOBALS.md](../../GLOBALS.md)

---

## 一、子系统概述

Oblivions 是 PHPDTS 的大逃杀游戏模式之一，采用网格地图 + 迷雾探索机制，区别于传统模式的线性地点列表。通过全局变量 `$gruleset === 'OBLIVIONS'` 切换激活，所有模式分支由 `oblivions_is_active()` 守卫。

**核心差异**：
- 传统模式：`$plsinfo` 线性地点列表，`move()` 切换地点
- Oblivions：网格地图 + 迷雾 + POI + 道具散落，`obl_move()` 移动 + `obl_explore()` 探索

---

## 二、核心概念词典

> AI 智能体介入项目前必读。以下概念在 Oblivions 中有特定含义，不可按字面意思理解。

### 2.1 区域 (Region) vs 地图格 (Tile)

- **区域**：一个独立的子地图，由多个地图格拼接而成。数据库键 `pgroup`，最多 255 个区域。
- **地图格**：最小的移动单元，数据库键 `pls`（区域内局部索引 1-254）。跨区域时 pls 可重用——区域1的 pls=5 和区域2的 pls=5 是不同的格。
- **组合键**：`(pgroup, pls)` 唯一确定一个地图格。

### 2.2 地板属性 (floor)

地图格的地板属性，**影响玩家交互**（移动消耗修正、技能效果、可破坏性），不是纯装饰：

| 值 | 含义 |
|----|------|
| `standard` | 标准地板 |
| `water` | 含水地板 |
| `vegetation` | 覆植地板 |
| `metal` | 金属地板 |
| `magic` | 富魔力地板 |

### 2.3 潮汐属性 (tide)

**不是海潮涨落，是区域危险等级分区标签。** 潮汐影响资源生成倾向（稀有度权重、敌人生成偏向、事件点类型），不影响玩家移动：

| 值 | 危险等级 | 含义 |
|----|---------|------|
| `shallow` | T-1（低） | 浅滩区，低危险 |
| `deep` | T（中） | 深水区，中危险 |
| `abyss` | T+1（高） | 深海区，高危险 |

> **注意**：`safe` **不是** `tide` 的取值。安全区状态由独立字段 `preset_safe` 标记，详见 2.8 节。

### 2.4 迷雾 (fog) vs 发现 (discovered)

两个**独立**的关注点，不可混淆：

| | 迷雾 (fog) | 发现 (discovered) |
|---|---|---|
| **控制什么** | 地图格的可见性 | 道具的可操作性 |
| **数据位置** | `oblmapstates` 表 `fog` 字段 | `oblmapitem` 表 `discovered` 字段 |
| **如何点亮** | BFS 视野计算，玩家位置扩展 | 玩家进入地图格时自动发现该格所有道具 |
| **效果** | 迷雾格在前端显示为 `░░░` | 未发现的道具不出现在拾取列表中 |

### 2.5 POI vs 散落道具

都是道具来源，但机制不同：

| | POI（建筑物） | 散落道具 |
|---|---|---|
| **位置** | 地图格内的建筑物 | 直接在地图格上 |
| **获取方式** | 需搜索（`obl_search_poi`），消耗体力 | 直接拾取（`obl_pickup_item`） |
| **数据表** | `oblmappoi` | `oblmapitem` |
| **搜索次数** | 有 `search_count` 上限 | 无搜索概念 |
| **生成池** | `poi_pool.php` | `scatter_pool.php` |

### 2.6 itmpara

道具的 JSON 附加参数字段（`$pdata['itmpara']`）。Oblivions 利用它追踪道具的原始索引：

- **拾取时**：将 `item_id`（地图道具实例ID）注入 `itmpara` 的 `obl_item_id` 键
- **丢弃时**：从 `itmpara` 读取 `obl_item_id`，还原为地图道具实例
- **格式**：JSON 对象，如 `{"obl_item_id": "42"}`

### 2.7 游戏刻 (tick)

- 每次移动更新 1 游戏刻，存储在 `$gamevars['obl_tick']`
- 当前仅记录，不驱动任何系统（战斗/NPC AI 未实现）

### 2.8 结构化日志 (Structured Log)

Oblivions 模式下的日志传递机制，**完全替代传统 `$log` HTML 字符串**：

| | 传统模式 | Oblivions 模式 |
|---|---|---|
| **数据形态** | HTML 字符串拼接 | 结构化数组（id + action + params） |
| **全局变量** | `$log` | `$obl_log`（`OblivionsLogger` 实例） |
| **输出方式** | `$log .= '...<br>'` | `$obl_log->emit($id, $action, $params)` |
| **样式控制** | 后端写 `<span class="xxx">` | 前端模板控制（`log-templates.js`） |
| **持久化** | `vex/cache/log_{groomid}_{pid}.php` | `vex/cache/obl_log_{groomid}_{pid}.json` |
| **API 端点** | `game_log` | `obl_log` |

**关键设计**：后端只输出事件结构（发生了什么 + 参数），前端完全控制视觉呈现（文案、样式、随机化）。详见第十二章。

---

## 三、目录结构

```
oblivions/
├── include/game/
│   ├── explore.func.php      # 探索/搜索/拾取/丢弃核心逻辑
│   ├── move.func.php         # 移动/地图数据加载/BFS距离计算
│   └── log.func.php          # 结构化日志收集器 + 持久化/读取
├── gamedata/
│   ├── obl_config.php        # 可调参数配置
│   ├── item_table.php        # 道具模板表
│   ├── poi_table.php         # POI 模板表
│   ├── poi_loot.php          # POI 掉落表
│   ├── poi_pool.php          # POI 刷新池（按潮汐区配置）
│   ├── scatter_pool.php      # 野生散落道具池（按潮汐区配置）
│   ├── map.php               # 区域元数据 + 网格布局
│   └── tiles/
│       ├── region_1.php      # 区域1（垃圾平原）地图格数据
│       └── region_2.php      # 区域2（腐烂沼泽）地图格数据
├── sql/
│   ├── oblmapstates.sql      # 图格状态表DDL
│   ├── oblmappoi.sql         # POI实例表DDL
│   └── oblmapitem.sql        # 地图道具实例表DDL
├── editor/                   # 地图编辑器（Node.js/Vite前端工具）
└── docs/                     # 设计文档
```

**外部集成文件**（不在 oblivions/ 目录下）：

| 文件 | 作用 |
|------|------|
| `include/core/global.func.php` | `oblivions_is_active()` 定义 |
| `include/command/router.php` | Oblivions 命令路由注册 |
| `include/command/handlers/oblivions_commands.php` | 4个Oblivions命令处理器 |
| `include/command/handlers/basic_commands.php` | move/search 命令的 Oblivions 分支 |
| `api_v2.php` | `game_map` 扩展 + `tile_actions` + `obl_log` 端点 |
| `command.php` | Oblivions 模式下初始化 `$obl_log` + 持久化 + 跳过 `$log` 文件化 |
| `valid.php` | 出生点迷雾点亮 |
| `game.php` | 重定向到 `vex/index.html` |

---

## 四、数据库表

所有表前缀为 `$tablepre`（默认 `bra_`），建表由 `rs_init_oblivions_tables()` 读取 `oblivions/sql/` 下SQL文件执行。

### 4.1 `bra_oblmapstates` — 图格状态

| 字段 | 类型 | 说明 |
|------|------|------|
| `pgroup` | tinyint unsigned | 区域ID（主键之一） |
| `pls` | tinyint unsigned | 格子ID（主键之一） |
| `fog` | tinyint(1) unsigned | 0=迷雾 1=已点亮 |
| `damaged` | tinyint(1) unsigned | 0=完好 1=被破坏 |
| `flags` | varchar(255) | 扩展标记(JSON) |

主键: `(pgroup, pls)`

### 4.2 `bra_oblmappoi` — POI实例

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

### 4.3 `bra_oblmapitem` — 地图道具实例

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

---

## 五、API 接口

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
    "arealist": [],
    "areanum": 0,
    "areaadd": 0,
    "hack": 0,
    "totalAreas": 25,
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
| `id` | string | 细粒度 ID，命名规则 `{action}.{subevent}`，如 `move.success`、`pickup.trap` |
| `action` | string | 粗粒度动作标记，6 类之一：`move`/`explore`/`search`/`pickup`/`discard`/`system` |
| `params` | object | 模板参数，值限 string/number/boolean。可为空对象 `{}` |
| `html` | string\|null | fallback HTML，正常为 `null`。仅用于前端模板无法覆盖的极端情况 |
| `ts` | number | `time()` 返回的 Unix 秒级时间戳 |

- `entries`：日志条目数组，按时间正序（旧→新）
- `total`：当前存储的条目总数（受 200 条上限裁剪）

**ID 命名规则**：`{action}.{subevent}`，如 `move.success`、`pickup.bag_full`、`search.result`。完整 ID 清单见前端 `vex/data/log-templates.js`。

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
| `obl_discard` | `slot` (int 1-6) | `obl_discard_item($slot, $pdata)` | 丢弃背包道具 |

### 6.3 通用命令的 Oblivions 分支

| 命令 | Oblivions分支 | 非Oblivions分支 |
|------|--------------|----------------|
| `move` | `obl_move($moveto, $pdata)` | `move($moveto)` |
| `search` | `obl_explore($pdata)` | `search()` |

### 6.4 命令执行流程

```
command.php
  → extract($pdata, EXTR_REFS)
  → router.php: switch($command)
    → oblivions_commands.php: cmd_handle_obl_xxx($params, $pdata)
      → explore.func.php: obl_xxx($params, $pdata)  // &$pdata 引用传递
  → player_save($pdata)  // 写回数据库
  → obl_log_persist($obl_log, $groomid, $pid)  // Oblivions 模式：持久化结构化日志
```

**关键**: Oblivions 命令在 router.php 中优先处理，独立于 `itm0` 阻塞检查（传统模式下手持道具会阻塞其他命令）。

---

## 七、游戏数据文件

### 7.1 `obl_config.php` — 可调参数

```php
return [
    'explore_sp_cost'  => 0,    // 探索消耗体力
    'vision_range'     => 1,    // 视野范围等级（BFS跳数）
    'memory_range'     => 3,    // 每次探索最多发现道具数
    'move_sp_cost'     => 0,    // 每格移动消耗体力
    'log_max_entries'  => 200,  // 结构化日志最大条目数
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
    'passable'     => bool,     // 是否可通行（详见 2.8.2）
    'neighbors'    => [int],    // 邻接格pls列表
    'x'            => int,      // 网格X坐标
    'y'            => int,      // 网格Y坐标
    // 以下为可选/占位字段（详见 2.8.1 / 2.9）
    'preset_safe'  => bool,     // 安全区状态标记，仅前端视觉用，后端不读取（详见 2.8.1）
    'height'       => int,      // 占位：未来高度系统 TODO（默认 0）
    'destructible' => bool,     // 占位：未来可破坏地形 TODO（默认 false，详见 2.8.3）
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

---

## 八、核心函数索引

### 8.1 explore.func.php

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

### 8.2 move.func.php

| 函数 | 签名 | 说明 |
|------|------|------|
| `obl_get_map_data` | `(?int $pgroup = null): array` | 加载地图数据（按区域懒加载+静态缓存） |
| `obl_get_move_range` | `(): int` | 可移动最大格数（保底1） |
| `obl_get_distance` | `(int $pgroup, int $from, int $to): int` | BFS最短路径（不可达返回-1） |
| `obl_move` | `(int $moveto, array &$pdata): void` | 移动（含区域切换/体力/自动探索） |
| `obl_check_move_sp` | `(array &$pdata, int $distance = 1): bool` | 移动体力检查+扣除 |
| `obl_post_move_hook` | `(array &$pdata): void` | 移动后钩子：自动探索（跳过体力检查） |

> **注**：原 `obl_get_tile_display_name()` 已删除，地块显示名由前端 `vex/data/terrain-desc.js` 的 `generateTerrainDesc()` 生成。

### 8.3 generate.func.php

| 函数 | 签名 | 说明 |
|------|------|------|
| `obl_generate_region_items` | `(int $pgroup, array $tiles, array $cfg): void` | 区域资源生成入口 |
| `obl_generate_region_pois` | `(int $pgroup, array $tiles, array $poi_pool, array $poi_table): void` | POI生成 |
| `obl_generate_wild_items` | `(int $pgroup, array $tiles, array $scatter_pool, array $item_table): void` | 野生道具生成 |

### 8.4 log.func.php

| 函数/类 | 签名 | 说明 |
|---------|------|------|
| `OblivionsLogger` | 类 | 结构化日志收集器，单次请求内累积 |
| `OblivionsLogger::emit` | `($id, $action, $params = [], $html = null): void` | 追加一条日志 |
| `OblivionsLogger::getEntries` | `(): array` | 获取本请求累积的日志条目 |
| `OblivionsLogger::hasEntries` | `(): bool` | 本请求是否有日志 |
| `obl_log_persist` | `($logger, $groomid, $pid, $max_entries = 200): void` | 持久化日志到 JSON 文件（追加+裁剪+LOCK_EX） |
| `obl_log_load` | `($groomid, $pid): array` | 从文件读取日志条目（按时间正序） |

---

## 九、代码规范

### 9.1 命名约定

| 类别 | 规则 | 示例 |
|------|------|------|
| 函数 | `obl_` 前缀 + 蛇形命名 | `obl_update_vision`, `obl_search_poi` |
| 机制函数 | `obl_mechanic_{name}` | `obl_mechanic_max_hp_up` |
| 命令处理器 | `cmd_handle_obl_{command}` | `cmd_handle_obl_explore` |
| 数据库表 | `{$tablepre}oblmap{suffix}` | `bra_oblmapstates`, `bra_oblmappoi`, `bra_oblmapitem` |
| 配置键 | 蛇形命名 | `explore_sp_cost`, `vision_range` |
| 日志 ID | `{action}.{subevent}` | `move.success`, `pickup.bag_full`, `search.result` |

### 9.2 数据传递规范

- **`$pdata` 引用传递**: 所有修改玩家数据的函数接受 `&$pdata`，禁止函数内 `extract()`
- **日志输出（Oblivions 模式）**: 通过 `global $obl_log` + `$obl_log->emit($id, $action, $params)`，**不再使用** `global $log` + `$log .=`
- **日志输出（传统模式）**: 仍通过全局 `$log` 变量追加，格式 `$log .= '消息<br>';`
- **数据库操作**: 使用全局 `$db` + `$tablepre`，SQL中表名写 `{$tablepre}oblmapxxx`
- **配置读取**: 通过 `obl_get_config()` 获取，带静态缓存，不直接 include

### 9.3 并发安全

- **拾取竞态**: `DELETE ... WHERE iid='$iid' AND discovered>0`，检查 `affected_rows()` 防重复拾取
- **搜索计数**: `UPDATE ... SET search_count=search_count+1` 原子递增
- **迷雾写入**: `INSERT ... ON DUPLICATE KEY UPDATE fog=1` 幂等操作
- **日志写入**: `file_put_contents` 加 `LOCK_EX`，多请求并发写入不丢数据

### 9.4 itmpara 约定

- 数据库中为 JSON 数组格式
- 拾取时注入 `obl_item_id` 键保存原始地图道具ID
- 丢弃时取出 `obl_item_id` 并 `unset`，还原原始 itmpara 写回地图

---

## 十、玩家生命周期（Oblivions模式）

```
0. 地图初始化 → 所有格子迷雾覆盖
1. 玩家出生 → 出生格点亮迷雾 → POI显示在界面
2. 仅可执行探索（迷雾中无法移动）
3. 探索流程:
   3.0 体力检查（obl_check_explore_sp）
   3.1 点亮迷雾（obl_clear_fog，范围=vision_range）
   3.2 发现道具（obl_discover_items，上限=memory_range）
   3.3 探索后钩子（obl_post_explore_hook）
4. 拾取/丢弃道具
5. 搜索POI → 掉落表生成 + 机制触发
6. 移动 → 移动后自动探索（跳过体力检查）
```

每一步操作产生的日志通过 `$obl_log->emit()` 收集，请求结束前由 `obl_log_persist()` 持久化。

---

## 十一、前端集成速查

### 11.1 页面入口

Oblivions 模式下 `game.php` 重定向到 `vex/index.html`（SPA前端）。

### 11.2 数据拉取

| 需求 | API | 关键字段 |
|------|-----|----------|
| 地图网格+连通性 | `game_map` | `links.tiles[pgroup][pls].neighbors`, `links.grids[pgroup]` |
| 当前格交互 | `tile_actions` | `pois[]`, `ground_items[]` |
| 玩家位置 | `player_info` | `pgroup`(区域), `pls`(格子) |
| 结构化日志 | `obl_log` | `entries[]`（LogEntry 数组）, `total` |

### 11.3 命令提交

```javascript
// 探索
submitCommand('obl_explore');

// 搜索POI
submitCommand('obl_search', { iaid: poiIaid });

// 拾取道具
submitCommand('obl_pickup', { iid: itemIid });

// 丢弃道具
submitCommand('obl_discard', { slot: slotNumber }); // slot: 1-6

// 移动
submitCommand('move', { moveto: targetPls });
```

### 11.4 前端关键逻辑

- **迷雾渲染**: `fog=0` 的格子不可见（不渲染/灰色覆盖），`fog=1` 的格子正常显示
- **POI可见性**: 仅迷雾清除后的POI返回（由API过滤）
- **道具可见性**: 仅 `discovered>0` 的道具返回（由API过滤）
- **近视道具**: `discovered=2` 时显示 `display_name`（带"？"），拾取后揭示真实身份
- **道具分组**: POI关联道具在 `pois[].items`，散落道具在 `ground_items`
- **背包槽位**: `itm1~itm6`，对应 `slot` 参数 1-6
- **结构化日志渲染**: 前端按 `entry.id` 查 `log-templates.js` 模板渲染，后端不参与视觉呈现
- **地块描述生成**: 无名格描述由前端 `terrain-desc.js` 的 `generateTerrainDesc()` 随机组合，后端只传 floor/tide/passable 属性

---

## 十二、结构化日志系统

### 12.1 设计原则

- **后端只输出事件结构**（发生了什么 + 参数），前端完全控制视觉呈现（文案、样式、随机化）
- **完全替代** `$log` HTML 字符串机制（Oblivions 模式下不再使用 `$log`）
- **隔离性**：改动只影响 Oblivions 模式和 Vex 前端，不侵入传统模式

### 12.2 数据流

```
obl_* 函数执行
  → $obl_log->emit($id, $action, $params)  // 收集日志条目
  ↓
command.php: player_save() 之后
  → obl_log_persist($obl_log, $groomid, $pid)  // 持久化到 JSON 文件
  ↓
前端 refreshLog()
  → gameApi('obl_log')  // 拉取结构化日志
  → renderLogEntry(entry)  // 按 ID 查模板渲染
  → 同时触发 Toast（若 2 级页面打开 + 命中白名单）
```

### 12.3 后端实现

**`oblivions/include/game/log.func.php`**：
- `OblivionsLogger` 类：单次请求内累积日志条目
- `obl_log_persist()`：追加模式写入 `vex/cache/obl_log_{groomid}_{pid}.json`，带 200 条上限裁剪和 `LOCK_EX` 并发保护
- `obl_log_load()`：读取日志文件，返回按时间正序的数组

**`command.php` 改动（3 处）**：
1. 入口初始化：`$obl_log = oblivions_is_active() ? new OblivionsLogger() : null;`
2. `player_save` 之前持久化：`obl_log_persist($obl_log, $groomid, $pid);`
3. 移除 Oblivions 模式下的 `$log` 文件化（传统模式仍走 `$log`）

**`obl_*` 函数改造模式**：

```php
// 改造前
global $log;
$log .= "从{$from_name}移动到了<span class=\"yellow\">{$to_name}</span>。<br>";

// 改造后
global $obl_log;
$obl_log->emit('move.success', 'move', [
    'from_name' => $from_name,
    'to_name'   => $to_name,
]);
```

### 12.4 前端实现

**`vex/data/log-templates.js`**：
- `LOG_TEMPLATES`：按 ID 索引的模板配置（text 模板 / render 函数 / 高亮参数）
- `renderLogEntry(entry)`：渲染单条日志为 HTML，未知 ID 显示 `[未知日志]` 占位

**`vex/data/terrain-desc.js`**：
- `TERRAIN_DESC`：从后端迁移的地形描述词库（floor/tide/impassable_suffix/templates）
- `generateTerrainDesc(floor, tide, passable)`：为无名格随机组合描述文案

**`vex/js/log.js`**：
- 调用 `obl_log` API 拉取结构化日志
- 委托 `renderLogEntry` 渲染，过滤空内容（如 `move.tile_desc` 无 desc 时）
- 动作标签映射：`move→[MOV]` / `explore→[EXP]` / `search→[SRC]` / `pickup→[PKG]` / `discard→[DSC]` / `system→[SYS]`

### 12.5 区域切换日志拆分

区域切换（无论前进还是回退）统一拆分为三条独立日志：
1. `move.region_leave` — 离开当前区域
2. `move.region_enter` — 进入目标区域（含区域描述）
3. `move.tile_desc` — 落脚格描述（复用已有 ID）

这样"从 A 出来"和"到了 B"是两个独立事件，语义更清晰。

### 12.6 日志文件清理

`vex/cache/obl_log_{groomid}_{pid}.json` 在游戏重置时清理（`rs_game()` 钩子），避免跨游戏残留。日常依赖 200 条上限自然轮转。

---

**文档结束。** 结构化日志系统的完整 ID 清单见 `vex/data/log-templates.js`，Toast 即时反馈机制详见 `vex/CODEBASE.md`。
