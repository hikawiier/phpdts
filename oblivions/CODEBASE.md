# Oblivions 子系统 — 代码库说明

> 帮助 AI 智能体快速了解 Oblivions 模式的后端架构、API 接口、数据结构和代码规范。
> 主项目文档：[CODEBASE.md](../../CODEBASE.md) | [GLOBALS.md](../../GLOBALS.md)

---

## 一、子系统概述

Oblivions 是 PHPDTS 的大逃杀游戏模式之一，采用网格地图 + 迷雾探索机制，区别于传统模式的线性地点列表。通过全局变量 `$gruleset === 'OBLIVIONS'` 切换激活，所有模式分支由 `oblivions_is_active()` 守卫。

**核心差异**：
- 传统模式：`$plsinfo` 线性地点列表，`move()` 切换地点，玩家数据存 `bra_players`
- Oblivions：网格地图 + 迷雾 + POI + 道具散落 + 战斗演出，`obl_move()` 移动 + `obl_explore()` 探索，玩家数据存 `bra_oblplayers`（独立数据层）

**设计原则：Oblivions 完全独立于 bra_players**
- 玩家+敌人统一存储在 `bra_oblplayers` 表，不依赖 `bra_players`
- `obl_save_player()` 不同步任何数据到 `bra_players`
- `save_gameinfo()` 在 Oblivions 模式下跳过 `bra_players` 查询，`alivenum`/`deathnum`/`validnum` 默认 0
- `valid.php` 仍向 `bra_players` 插入记录（开发阶段防御性保留），但 Oblivions 模式不读取它
- 未来完整完成后将清理 `bra_players` 的防御性保留代码

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

### 2.6 itmpara 与 itempara

**itmpara**（地图道具实例的 JSON 附加参数，`bra_oblmapitem.itmpara`）：
- 拾取时将 `item_id`（地图道具实例ID）注入 `itmpara` 的 `obl_item_id` 键
- 丢弃时从 `itmpara` 读取 `obl_item_id`，还原为地图道具实例
- 格式：JSON 对象，如 `{"obl_item_id": "42"}`

**itempara**（玩家道具栏 JSON 大字段，`bra_oblplayers.itempara`）：
- 替代传统模式的 `itm0~itm6`（42 字段），改为 1 个 JSON 数组
- 数组长度 = `itemmaxslots + 1`（index 0=特殊槽，1~itemmaxslots=普通槽）
- 每个元素是一个道具对象或 `null`（空槽）

**道具对象七字段规范**（itempara 数组元素 + 地图道具实例均遵循）：

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

### 2.7 游戏刻 (tick)

- 每次移动更新 1 游戏刻，存储在 `$gamevars['obl_tick']`
- 每次 tick 增长触发 `obl_resolve_tick_events($delta)`，循环调用 `obl_resolve_all_enemy_ai()` 结算所有 NPC 敌人行动

### 2.8 结构化日志 (Structured Log)

Oblivions 模式下的日志传递机制，**完全替代传统 `$log` HTML 字符串**：

| | 传统模式 | Oblivions 模式 |
|---|---|---|
| **数据形态** | HTML 字符串拼接 | 结构化数组（id + logcategory + params） |
| **全局变量** | `$log` | `$obl_log`（`OblivionsLogger` 实例） |
| **输出方式** | `$log .= '...<br>'` | `$obl_log->emit($id, $logcategory, $params)` |
| **样式控制** | 后端写 `<span class="xxx">` | 前端模板控制（`log-templates.js`） |
| **持久化** | `vex/cache/log_{groomid}_{pid}.php` | `vex/cache/obl_log_{groomid}_{pid}.json` |
| **API 端点** | `game_log` | `obl_log` |

**关键设计**：后端只输出事件结构（发生了什么 + 参数），前端完全控制视觉呈现（文案、样式、随机化）。详见第十二章。

### 2.9 战斗日志 (Battle Log) 与 played 标记机制

**与 obl_log 分离的第二套日志系统**，专门记录战斗细节（每一步动作），obl_log 只存战斗摘要（`battle.start`/`battle.end`）。

| | obl_log（结构化日志） | obl_battle_log（战斗日志） |
|---|---|---|
| **存储内容** | 探索/移动/拾取/战斗摘要 | 战斗内每一步动作（攻击/反击/先攻判定/逃跑） |
| **全局变量** | `$obl_log`（`OblivionsLogger`） | `$obl_battle_log`（`BattleLogCollector`） |
| **持久化文件** | `vex/cache/obl_log_{groomid}_{pid}.json` | `vex/cache/obl_battle_log_{groomid}_{pid}.json` |
| **API 端点** | `obl_log` | `battle_log` |
| **前端用途** | 日志区渲染 + Toast 触发 | 战斗模态框播放 + 碰撞动画 |

**played 标记机制**（替代"命令响应附带 battlelog"的双路径方案）：

```
后端 emit battlelog（played=0）
  → obl_battle_log_persist() 追加到文件，分配 log_id，played=0
  → 命令响应只返回 {}（不再附带 battlelog 字段）

前端 fetchAndPlayBattleLog()
  → gameApi('battle_log') → 返回 played=0 的条目
  → 按 enemy_pid 分组 → 每组播放（碰撞动画 + 模态框 + 残留伤害数字）
  → POST mark_battle_log_played.php 标记 played=1
```

**BattleLogEntry 字段**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 固定 `'battle.action'` |
| `log_id` | int | 文件内自增 ID（持久化时分配），用于标记 played |
| `turn` | int | 先攻轮序号（0=战斗开始/结束，1+=回合 N） |
| `actor` | string | 行动方标识（`'player'` 或 `'enemy_{pid}'`） |
| `action_id` | string | 动作 ID（`unarmed_strike`/`escape`/`battle.start`/`initiative.roll`/`battle.end`） |
| `action_name` | string | 动作显示名（如 `'空手攻击'`） |
| `target` | string | 目标标识（`'player'`/`'enemy_{pid}'`/结果标识） |
| `effect_value` | int | 效果值（伤害值等） |
| `extra` | object\|null | 额外信息（如 `{'success': true}`、`{'player_roll': 50, 'enemy_roll': 30}`） |
| `enemy_pid` | int | 战斗对象 PID（前端按战斗分组播放） |
| `played` | int | 0=未播放，1=已播放（前端播放后通过 mark 接口标记） |
| `ts` | int | Unix 时间戳 |

**关键设计决策**：
- **零依赖 mark 接口**：`vex/mark_battle_log_played.php` 不依赖任何游戏框架（无 common.inc.php、无 player.func.php、无 DB），只做文件读写。安全性靠 `(int)` 强制转换防路径遍历。理由：mark 请求即使被伪造也无严重后果（最多让玩家少看一条 battlelog）。
- **文件不被清空**：played=1 的条目仍保留在文件中，作为历史记录。游戏重置时由 `obl_battle_log_clear_all()` 清理。
- **log_id 而非 turn 排序**：前端按 `log_id`（emit 顺序）排序播放，而非 `turn`（非唯一，回合内多条日志 turn 相同）。

---

## 三、目录结构

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
│       ├── battle.func.php     # 战斗系统：先攻轮/动作执行/战斗结束（详见第八章 8.7）
│       ├── battle_log.func.php # 战斗日志收集器 + played 标记机制（详见第八章 8.8）
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
| `game.php` | 重定向到 `vex/index.html` |
| `vex/mark_battle_log_played.php` | 零依赖 battlelog 标记接口（无 auth/DB，只文件读写） |

---

## 四、数据库表

所有表前缀为 `$tablepre`（默认 `bra_`），建表由 `rs_init_oblivions_tables()` 读取 `oblivions/sql/` 下SQL文件执行。命名规范：`bra_obl` 前缀 + 实体名连写（无下划线）。

### 4.0 `bra_oblplayers` — 玩家+敌人统一数据表

Oblivions 模式独立数据层，玩家与 NPC 敌人统一存储。替代传统模式的 `bra_players`。

| 字段分类 | 字段 | 说明 |
|---------|------|------|
| **身份** | `pid` | 主键（smallint auto_increment） |
| | `type` | 0=玩家, >0=敌人类型 |
| | `name`/`pass`/`gd`/`icon` | 基础信息（pass 与 user 表双重校验） |
| **战斗状态** | `action` | 空=正常 / `'battle'`=战斗中（prebattle 中间态已取消） |
| | `bid` | 战斗目标 pid |
| **属性** | `hp`/`mhp`/`sp`/`msp`/`att`/`def` | 战斗属性 |
| | `ap`/`max_ap` | AP 值（独立字段，便于频繁读写） |
| **位置** | `pgroup`/`pls` | 区域ID + 格子ID |
| **进度** | `lvl`/`exp`/`state` | 等级/经验/状态（0=存活, 1=死亡） |
| **装备** | `wep`/`wep2`/`arb`/`arh`/`ara`/`arf`/`art` | 7 槽装备（每槽 6 字段：name/k/e/s/sk/para） |
| **道具栏** | `itempara` | JSON 数组（七字段规范，详见 2.6） |
| | `itemmaxslots` | 道具栏最大格数（默认 6，index 0=特殊槽） |
| **Oblivions专属** | `tacpara` | 策略槽（JSON） |
| | `skillpara` | 技能数据（JSON） |
| | `oblpara` | 杂项功能数据（JSON，含 `killnum`/`ai_type`/`vision_range`/`battle`/`escape_skip_tick` 等） |
| | `discovered` | 敌人发现状态（0=未发现, 1=已发现） |

**`action` 字段取值**（prebattle 中间态已取消）：
- 空（`''`）= 正常探索状态
- `'battle'` = 战斗中（玩家主动攻击或遭遇战触发后直接进入）

**`oblpara['battle']` 战斗状态结构**（战斗中存在，战斗结束清除）：

```php
$oblpara['battle'] = [
    'turn'  => int,    // 先攻轮序号（递增，用于日志排序）
    'queue' => [        // 先攻队列（双方同步保存）
        ['pid' => 101, 'done' => 0],
        ['pid' => 5,   'done' => 0],
    ],
];
```

**`oblpara['escape_skip_tick']`**：逃跑成功时设置的标志，跳过本次命令的 tick 推进（一次性，避免 NPC 在同 tick 内再次遭遇玩家）。

**相对 bra_players 的关键变更**：
- 删除 50+ 字段（race/sNo/club/endtime/nick/skills/cdsec/money/rage/pose/tactic/wp~wf/teamID/extrabag_*/itm0~6/clbpara/flare/aura/souls/debuff/status/element 等）
- 道具栏 `itm0~itm6`（42 字段）→ `itempara`（1 个 JSON 字段）
- 技能数据 `clbpara` → `skillpara`（JSON）
- 杂项数据 → `oblpara`（JSON，含原 `killnum` 等）
- 新增 `ap`/`max_ap`（独立字段）/`itemmaxslots`/`tacpara`/`discovered`

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

> **注**：传统模式的 `arealist`/`areanum`/`areaadd`/`hack`/`totalAreas` 字段在 Oblivions 模式下不再返回（前端从未使用）。

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

**ID 命名规则**：`{logcategory}.{subevent}`，如 `move.success`、`pickup.bag_full`、`search.result`。完整 ID 清单见前端 `vex/data/log-templates.js`。

**debug 分类**：`OblivionsLogger::DEBUG_IDS` 常量声明 debug 日志 ID 清单（当前含 `enemy.move`、`battle.invalid`）。这些日志持久化保留但前端默认不渲染，`?debug=ai` 模式下显示并加 `[DBG]` 前缀。

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

**BattleLogEntry 结构**：详见 2.9 节。

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

**前端用途**: 渲染当前区域的敌人列表，玩家可看到已发现敌人的位置、名称、等级、HP。战斗状态下用于显示战斗对象信息。

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

**独立文件**（不走 `api_v2.php`），位于 `vex/mark_battle_log_played.php`。

- **请求**: `POST vex/mark_battle_log_played.php`
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

**零依赖设计**：
- 不 require 任何游戏框架文件（无 common.inc.php / player.func.php / DB 连接）
- 只做文件读写操作
- 安全性靠 `(int)` 强制转换防路径遍历（`groomid`/`pid`/`log_ids` 全部 `(int)` 化）
- 并发写靠 `LOCK_EX` 保护

**设计理由**：mark 请求的唯一目的是"修改文件中某些条目的 played 字段"，即使被伪造也无严重后果（最多让玩家少看一条 battlelog），不值得走完整的 auth + DB 流程。

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
| `obl_battle_start` | `enemy_pid` (int) | `obl_battle_initiate($enemy_pid, $pdata)` | 玩家主动攻击：直接进入 battle 状态（取消 prebattle 中间态） |
| `obl_battle_action` | `action_id` (string) | `obl_battle_resolve_round($action_id, $pdata)` | 战斗动作（玩家先攻轮执行 + NPC 自动执行） |

> **注**：原 `obl_battle_cancel` 命令已移除（prebattle 中间态取消后，取消攻击是纯前端确认界面的"取消"按钮，无需后端命令）。

### 6.3 通用命令的 Oblivions 分支

| 命令 | Oblivions分支 | 非Oblivions分支 |
|------|--------------|----------------|
| `move` | `obl_move($moveto, $pdata)` | `move($moveto)` |
| `search` | `obl_explore($pdata)` | `search()` |

### 6.4 命令执行流程

Oblivions 模式下，`command.php` 仅做模式判定，业务逻辑全部委托给独立文件 `oblivions/include/core/obl_command.php`：

```
command.php
  → oblivions_is_active() === true
  → require GAME_ROOT.'./oblivions/include/core/obl_command.php'
  → exit

obl_command.php 内部流程：
  [A]  require player.func.php
  [A2] 并发锁：flock(LOCK_EX|LOCK_NB) — 同一玩家同时只能处理一个命令
       → 获取失败返回 {'error': 'COMMAND_IN_PROGRESS'} 并 exit
  [B]  obl_game_entrypoint('command')           // 认证 + 抓取 + 格式化 $pdata
  [C]  obl_validate_battle_state($pdata)         // battle 状态防呆校验（脏状态自动清除）
  [C2] obl_command_allowed_by_state($command, $action)  // 命令状态过滤
       → action='battle' 时只允许 obl_battle_action
       → 非战斗状态不允许 obl_battle_action（obl_battle_start 仍允许）
       → 被拒绝的命令 emit 'command.rejected' 日志，不推进 tick
  [D]  if (!$command_rejected && $pdata['hp'] > 0):
        require router_helpers.php + router.php
        cmd_router_dispatch($command, $mode, $pdata, $cmdcdtime, $post)
          → oblivions_commands.php: cmd_handle_obl_xxx($params, $pdata)
            → explore.func.php / battle.func.php: obl_xxx($params, $pdata)  // &$pdata 引用传递
  [E]   obl_log_persist($obl_log, $groomid, $pdata['pid'])  // 持久化结构化日志
  [E2]  obl_battle_log_persist($obl_battle_log, $groomid, $pdata['pid'])  // 持久化战斗日志（played=0）
  [F]   if obl_command_advances_tick($command) && !escape_skip_tick:
        $gamevars['obl_tick']++; save_gameinfo()          // 推进游戏刻
  [G]   obl_save_player($pdata)                             // 写回 oblplayers
  [H]   echo compatible_json_encode(array())                // 返回空 JSON {}
       （flock 在进程结束/脚本结束时由 OS 自动释放）
```

**关键设计**：
- **不使用 `extract($pdata, EXTR_REFS)`**：直接操作 `$pdata` 数组，避免全局变量污染
- **跳过传统预检查**：眩晕/冷却/对话框/追击/物品索引等传统模式预检查全部跳过
- **跳过模板渲染**：SPA 前端不需要 HTML 模板，响应只返回最小确认 `{}`
- **使用 `obl_save_player()`** 替代 `player_save()`，仅写 `bra_oblplayers`，不同步 `bra_players`
- **Oblivions 命令在 router.php 中优先处理**，独立于 `itm0` 阻塞检查（传统模式下手持道具会阻塞其他命令）
- **前端通过 `api_v2.php` 获取业务数据**，命令响应不再包含 `$gamedata` 或 `battlelog` 字段（旧版组装的 5 行 `$gamedata` 已删除，battlelog 改为 played 标记机制，详见 2.9）

### 6.5 并发锁机制（三层防护）

防止短时间多次请求导致重复提交/状态错乱，前后端三层防护：

| 层 | 位置 | 机制 | 释放时机 |
|----|------|------|---------|
| 前端全生命周期锁 | `vex/js/battle.js: isProcessingBattle` | 布尔标志，覆盖"提交命令 → 拉取播放 battlelog → 刷新状态"全流程 | `try/finally` 末尾 |
| 前端 HTTP 锁 | `vex/js/command-queue.js: _locked` | 布尔标志，仅覆盖 HTTP 请求期间 | `try/finally` 末尾 |
| 后端文件锁 | `obl_command.php [A2]: flock(LOCK_EX\|LOCK_NB)` | 同一玩家 PID 的独占文件锁 | 进程结束/脚本 exit 时 OS 自动释放 |

**后端锁实现**：
```php
$obl_lock_file = GAME_ROOT . './vex/cache/obl_lock_' . $groomid . '_' . $pdata['pid'] . '.php';
$obl_lock_fp = fopen($obl_lock_file, 'w');
if (!$obl_lock_fp || !flock($obl_lock_fp, LOCK_EX | LOCK_NB)) {
    // 另一个请求正在处理
    echo compatible_json_encode(array('error' => 'COMMAND_IN_PROGRESS'));
    exit;
}
// 锁在进程结束/脚本 exit 时由 OS 自动释放，无需显式释放
```

**为什么选 flock 而非 DB 锁**：
- flock 在进程异常退出时由 OS 自动释放，不会死锁
- DB 锁需要额外的"超时清理"逻辑，复杂度高
- 单机部署足够，无需分布式锁
- 性能优于 DB 锁

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
| `obl_command_advances_tick` | `($command): bool` | 命令是否推进游戏刻（白名单：move/obl_explore/obl_search/obl_battle_action） |
| `obl_resolve_tick_events` | `($delta): void` | 处理游戏刻事件（循环 $delta 次调用 obl_resolve_all_enemy_ai() 结算 NPC 行动） |
| `obl_validate_battle_state` | `(array &$pdata): void` | battle 状态防呆校验：bid 非空/对手存在/对手存活/双向关联完整/同区域，脏状态自动清除 |
| `obl_clear_invalid_battle_state` | `(&$pdata, &$opponent, $reason): void` | 清除脏的 battle 状态（obl_validate_battle_state 辅助函数，emit `battle.invalid` 日志） |
| `obl_command_allowed_by_state` | `($command, $action): bool` | 命令状态过滤：action='battle' 只允许 obl_battle_action；非战斗状态不允许 obl_battle_action（obl_battle_start 仍允许） |

### 8.2 explore.func.php

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

### 8.3 move.func.php

| 函数 | 签名 | 说明 |
|------|------|------|
| `obl_get_map_data` | `(?int $pgroup = null): array` | 加载地图数据（按区域懒加载+静态缓存） |
| `obl_get_move_range` | `(): int` | 可移动最大格数（保底1） |
| `obl_get_distance` | `(int $pgroup, int $from, int $to): int` | BFS最短路径（不可达返回-1） |
| `obl_move` | `(int $moveto, array &$pdata): void` | 移动（含区域切换/体力/自动探索） |
| `obl_check_move_sp` | `(array &$pdata, int $distance = 1): bool` | 移动体力检查+扣除 |
| `obl_post_move_hook` | `(array &$pdata): void` | 移动后钩子：自动探索（跳过体力检查） |

> **注**：原 `obl_get_tile_display_name()` 已删除，地块显示名由前端 `vex/data/terrain-desc.js` 的 `generateTerrainDesc()` 生成。

### 8.4 generate.func.php

| 函数 | 签名 | 说明 |
|------|------|------|
| `obl_generate_region_items` | `(int $pgroup, array $tiles, array $cfg): void` | 区域资源生成入口 |
| `obl_generate_region_pois` | `(int $pgroup, array $tiles, array $poi_pool, array $poi_table): void` | POI生成 |
| `obl_generate_wild_items` | `(int $pgroup, array $tiles, array $scatter_pool, array $item_table): void` | 野生道具生成 |

### 8.5 log.func.php

| 函数/类 | 签名 | 说明 |
|---------|------|------|
| `OblivionsLogger` | 类 | 结构化日志收集器，单次请求内累积 |
| `OblivionsLogger::emit` | `($id, $logcategory, $params = [], $html = null): void` | 追加一条日志（自动判定 debug 标记） |
| `OblivionsLogger::getEntries` | `(): array` | 获取本请求累积的日志条目 |
| `OblivionsLogger::hasEntries` | `(): bool` | 本请求是否有日志 |
| `obl_log_persist` | `($logger, $groomid, $pid, $max_entries = 200): void` | 持久化日志到 JSON 文件（追加+裁剪+LOCK_EX，正式/debug 分开计数） |
| `obl_log_load` | `($groomid, $pid): array` | 从文件读取日志条目（按时间正序） |

### 8.6 enemy_ai.func.php — NPC 敌人 AI

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

### 8.7 battle.func.php — 战斗系统

战斗系统核心，先攻轮机制。NPC 与玩家共用同一套战斗逻辑，通过 `actor['type']` 区分。

**模块 1：接口预留函数**（4 函数，阶段一返回固定值，未来由技能/装备系统覆盖）

| 函数 | 签名 | 说明 |
|------|------|------|
| `obl_get_range` | `(&$pdata): int` | 玩家攻击射程（阶段一固定 1，未来由武器类型决定） |
| `obl_get_weapon_attack_modes` | `(&$pdata): array` | 玩家可用攻击模式（阶段一固定 `['unarmed_strike']`） |
| `obl_calc_damage` | `($att, $def, $weapon_bonus = 0): int` | 伤害公式 `max(1, att - def + weapon_bonus)`，保底 1 |
| `obl_get_initiative_rate` | `(&$pdata): int` | 先攻率（阶段一固定 50，未来由敏捷/技能/装备覆盖） |

**模块 2：辅助函数**（2 函数）

| 函数 | 签名 | 说明 |
|------|------|------|
| `obl_battle_actor_id` | `(&$pdata): string` | 战斗单位标识符（`'player'` 或 `'enemy_{pid}'`） |
| `obl_battle_action_name` | `($action_id): string` | 动作显示名（`unarmed_strike`→`空手攻击`，`escape`→`逃跑`） |

**模块 3：战斗状态管理**（4 函数）

| 函数 | 签名 | 说明 |
|------|------|------|
| `obl_battle_init_state` | `(&$pdata): void` | 初始化 `oblpara['battle']`（含 turn 计数器和先攻队列占位） |
| `obl_battle_clear_state` | `(&$pdata): void` | 清除 `oblpara['battle']`（战斗结束时调用） |
| `obl_battle_get_turn` | `(&$pdata): int` | 获取当前先攻轮序号（用于日志排序） |
| `obl_battle_inc_turn` | `(&$pdata): void` | 递增先攻轮序号 |

**模块 4：先攻队列管理**（4 函数）

| 函数 | 签名 | 说明 |
|------|------|------|
| `obl_battle_roll_initiative` | `(&$player, &$enemy, $player_roll_override = null): array` | 先攻判定：摇随机数 + 排序 + 生成队列。玩家主动攻击时传 101 强制先攻。含先攻补正（玩家非第一顺位时随机数 += 第一顺位者 × 25%，1v1 中无实际效果，为 1vN 预留） |
| `obl_battle_get_current_initiator` | `(&$pdata): array\|null` | 获取当前顺位（第一个 done=0 的队列项） |
| `obl_battle_mark_done` | `(&$pdata, $pid): void` | 标记某个 pid 的先攻轮已完成（done=1） |
| `obl_battle_all_done` | `(&$pdata): bool` | 检查是否所有人都已完成先攻轮 |

**模块 5：战斗发起与载入**（4 函数）

| 函数 | 签名 | 说明 |
|------|------|------|
| `obl_battle_validate_target` | `($enemy_pid, &$pdata, &$enemy): string` | 校验攻击目标合法性（敌人存在/已发现/同区域/BFS 距离 ≤ 射程），不修改状态，返回错误信息（空=成功） |
| `obl_battle_initiate` | `($enemy_pid, &$pdata): string` | 玩家主动攻击入口：校验 + 状态检测 + emit `battle.start` + 先攻判定（强制先攻）+ NPC 自动执行。取消 prebattle 中间态 |
| `obl_battle_enter_battle` | `(&$player, &$enemy): void` | 状态检测：双方 `action='battle'` + `bid` 互指 + 初始化战斗状态 |
| `obl_battle_resolve_round` | `($action_id, &$pdata): string` | 战斗载入流程入口（玩家提交 obl_battle_action 时调用）：执行玩家先攻轮 + NPC 自动执行直到玩家顺位或战斗结束 |

**模块 6：NPC 自动执行**（2 函数）

| 函数 | 签名 | 说明 |
|------|------|------|
| `obl_battle_auto_npc` | `(&$player, &$enemy): string` | NPC 自动执行循环：NPC 是当前顺位时自动执行先攻轮，直到轮到玩家或战斗结束。所有人都完成时重新先攻判定 |
| `obl_battle_encounter` | `(&$player, &$enemy): void` | 遭遇战入口（tick 结算中 NPC 移动到玩家格时调用）：状态检测 + 互相 discovered=1 + emit `battle.start` + 先攻判定 + NPC 自动执行 + 立即持久化 battlelog（避免写到错误 pid 文件） |

**模块 7：先攻轮执行**（5 函数）

| 函数 | 签名 | 说明 |
|------|------|------|
| `obl_battle_load_attack_queue` | `(&$actor, $action_id): array` | 加载先攻者攻击动作队列（玩家用提交的 action_id，敌人 AI 行为树固定 unarmed_strike） |
| `obl_battle_check_counter` | `(&$defender): array\|null` | 检查被攻击者是否有反击策略（留接口，阶段一返回 null） |
| `obl_battle_execute_counter` | `(&$defender, &$attacker): void` | 执行被攻击者的反击动作（留接口，阶段一空实现） |
| `obl_battle_execute` | `(&$actor, &$target, $action_id): string` | 先攻轮执行：加载攻击队列 → foreach 执行动作 → 检查反击 → 死亡判定。返回 `'continue'`/`'escape'`/`'victory'` |
| `obl_battle_do_action` | `(&$actor, &$target, $action_id, $turn): bool` | 执行单个攻击动作（unarmed_strike 计算伤害扣 HP / escape 50% 概率成功）。emit battlelog 时附带 `enemy_pid` 用于前端分组。返回 true=继续，false=战斗结束 |

**模块 8：战斗结束**（2 函数）

| 函数 | 签名 | 说明 |
|------|------|------|
| `obl_battle_check_end` | `(&$player, &$enemy): string` | 检查战斗是否结束（`'continue'`/`'victory'`/`'defeat'`） |
| `obl_battle_end` | `(&$player, &$enemy, $result): void` | 结束战斗：**先获取 turn 再清空状态**（避免清空后 turn=0 导致 battle.end 日志排序错误）→ 清空 action/bid/oblpara['battle'] → 设置死亡方 state=1 → emit `battle.end` → 逃跑成功时设置 `escape_skip_tick` 标志 → 保存双方数据 |

### 8.8 battle_log.func.php — 战斗日志系统

战斗日志收集与持久化，与 obl_log 分离（详见 2.9）。

| 函数/类 | 签名 | 说明 |
|---------|------|------|
| `BattleLogCollector` | 类 | 战斗日志收集器，单次请求内累积。在 `common.inc.php` 入口初始化为全局 `$obl_battle_log` |
| `BattleLogCollector::emit` | `($turn, $actor, $action_id, $action_name, $target, $effect_value = 0, $extra = null, $position = null, $enemy_pid = 0): void` | 追加一条战斗日志（含 `enemy_pid` 用于前端按战斗分组） |
| `BattleLogCollector::getEntries` | `(): array` | 获取本请求累积的战斗日志条目 |
| `BattleLogCollector::hasEntries` | `(): bool` | 本请求是否有战斗日志 |
| `obl_battle_log_get_old_max` | `(): int` | 读取 battle_log 历史归档最大批次配置（带静态缓存） |
| `obl_battle_log_persist` | `($logger, $groomid, $pid): void` | 持久化战斗日志到文件（追加模式 + log_id 分配 + played=0 + LOCK_EX）。读取现有文件找最大 log_id，给新条目分配 log_id（从 max+1 开始）和 played=0，追加到现有条目后写回 |
| `obl_battle_log_load` | `($groomid, $pid): array` | 从文件读取**未播放**的战斗日志（played=0），不清空文件 |
| `obl_battle_log_mark_played` | `($groomid, $pid, $log_ids): int` | 标记指定 log_id 的战斗日志为已播放（played=1）。供 `mark_battle_log_played.php` 调用 |
| `obl_battle_log_clear_all` | `(): void` | 清理所有战斗日志文件（在 `rs_game()` 游戏重置时调用，删除 `vex/cache/obl_battle_log*.json`） |

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
- **日志输出（Oblivions 模式）**: 通过 `global $obl_log` + `$obl_log->emit($id, $logcategory, $params)`，**不再使用** `global $log` + `$log .=`
- **战斗日志输出**: 通过 `global $obl_battle_log` + `$obl_battle_log->emit($turn, $actor, $action_id, $action_name, $target, $effect_value, $extra, $position, $enemy_pid)`
- **日志输出（传统模式）**: 仍通过全局 `$log` 变量追加，格式 `$log .= '消息<br>';`
- **数据库操作**: 使用全局 `$db` + `$tablepre`，SQL中表名写 `{$tablepre}oblmapxxx`
- **配置读取**: 通过 `obl_get_config()` 获取，带静态缓存，不直接 include

### 9.3 并发安全

- **拾取竞态**: `DELETE ... WHERE iid='$iid' AND discovered>0`，检查 `affected_rows()` 防重复拾取
- **搜索计数**: `UPDATE ... SET search_count=search_count+1` 原子递增
- **迷雾写入**: `INSERT ... ON DUPLICATE KEY UPDATE fog=1` 幂等操作
- **日志写入**: `file_put_contents` 加 `LOCK_EX`，多请求并发写入不丢数据
- **战斗日志写入**: `obl_battle_log_persist()` 加 `LOCK_EX`，多请求并发写入不丢数据
- **命令并发锁**: `obl_command.php [A2]` 使用 `flock(LOCK_EX|LOCK_NB)`，同一玩家同时只能处理一个命令。获取失败返回 `{'error': 'COMMAND_IN_PROGRESS'}` 并 exit。锁在进程结束/脚本 exit 时由 OS 自动释放（详见 6.5）

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
8. 战斗流程（详见第十三章）:
   8.1 玩家主动攻击：obl_battle_start 命令 → obl_battle_initiate（校验+状态检测+先攻判定+NPC自动执行）
   8.2 遭遇战：tick 结算中 NPC 移动到玩家格 → obl_battle_encounter（状态检测+先攻判定+NPC自动执行）
   8.3 战斗动作：obl_battle_action 命令 → obl_battle_resolve_round（玩家先攻轮+NPC自动执行）
   8.4 战斗结束：obl_battle_end（清空状态+设置死亡+emit 日志+保存）
```

每一步操作产生的日志通过 `$obl_log->emit()` 收集，请求结束前由 `obl_log_persist()` 持久化。
战斗细节日志通过 `$obl_battle_log->emit()` 收集，请求结束前由 `obl_battle_log_persist()` 持久化（played=0）。

---

## 十一、前端集成速查

### 11.1 页面入口

Oblivions 模式下 `game.php` 重定向到 `vex/index.html`（SPA前端）。

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

// 玩家主动攻击（直接进入 battle 状态，取消 prebattle）
submitCommand('obl_battle_start', { enemy_pid: enemyPid });

// 战斗动作（玩家先攻轮）
submitCommand('obl_battle_action', { action_id: 'unarmed_strike' });
```

### 11.4 战斗日志标记

```javascript
// 播完 battlelog 后标记 played=1（零依赖接口）
fetch('/phpdts/vex/mark_battle_log_played.php', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
        groomid: groomid,
        pid: pid,
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
- **结构化日志渲染**: 前端按 `entry.id` 查 `log-templates.js` 模板渲染，后端不参与视觉呈现
- **地块描述生成**: 无名格描述由前端 `terrain-desc.js` 的 `generateTerrainDesc()` 随机组合，后端只传 floor/tide/passable 属性
- **敌人可见性**: 仅 `discovered=1` 的敌人返回（由 `enemies` API 过滤），敌人移动超出玩家视野后自动从列表移除
- **战斗日志播放**: 前端按 `enemy_pid` 分组，每组按 `log_id` 排序，三阶段播放（碰撞动画 → 模态框 → 残留伤害数字），播完调 mark 接口
- **战斗状态过滤**: `action='battle'` 时前端只允许提交 `obl_battle_action`；非战斗状态不允许提交 `obl_battle_action`（后端 `obl_command_allowed_by_state` 强制）

---

## 十二、结构化日志系统

### 12.1 设计原则

- **后端只输出事件结构**（发生了什么 + 参数），前端完全控制视觉呈现（文案、样式、随机化）
- **完全替代** `$log` HTML 字符串机制（Oblivions 模式下不再使用 `$log`）
- **隔离性**：改动只影响 Oblivions 模式和 Vex 前端，不侵入传统模式

### 12.2 数据流

```
obl_* 函数执行
  → $obl_log->emit($id, $logcategory, $params)  // 收集日志条目
  ↓
obl_command.php: 路由分发后
  → obl_log_persist($obl_log, $groomid, $pdata['pid'])  // 持久化到 JSON 文件
  ↓
前端 refreshLog()
  → gameApi('obl_log')  // 拉取结构化日志
  → renderLogEntry(entry)  // 按 ID 查模板渲染
  → 同时触发 Toast（若 2 级页面打开 + 命中白名单）
```

### 12.3 后端实现

**`oblivions/include/game/log.func.php`**：
- `OblivionsLogger` 类：单次请求内累积日志条目
- `OblivionsLogger::DEBUG_IDS` 常量：声明 debug 日志 ID 清单（当前含 `enemy.move`、`battle.invalid`）
- `obl_log_persist()`：追加模式写入 `vex/cache/obl_log_{groomid}_{pid}.json`，正式日志 200 条 + debug 日志 50 条分开计数裁剪，带 `LOCK_EX` 并发保护
- `obl_log_load()`：读取日志文件，返回按时间正序的数组

**`oblivions/include/core/obl_command.php` 改动**（从 `command.php` 抽离）：

Oblivions 模式下的命令处理逻辑已从 `command.php` 完全抽离到独立文件 `obl_command.php`，由 `command.php` 在模式判定后 `require` 并 `exit`。日志相关流程：

1. 入口初始化：`$obl_log = new OblivionsLogger();`（无条件创建，Oblivions 模式专用）
2. 路由分发后持久化：`if ($obl_log && $obl_log->hasEntries()) { obl_log_persist($obl_log, $groomid, $pdata['pid']); }`
3. 响应只返回空 JSON `{}`（前端通过 `api_v2.php` 获取业务数据，不依赖命令响应）

**`command.php` 改动**：Oblivions 分支精简为 3 行：
```php
if (function_exists('oblivions_is_active') && oblivions_is_active()) {
    require GAME_ROOT.'./oblivions/include/core/obl_command.php';
    exit;
}
```
传统模式仍走原 `command.php` 流程（`$log` HTML 字符串机制不变）。

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
- 动作标签映射：`move→[MOV]` / `explore→[EXP]` / `search→[SRC]` / `pickup→[PKG]` / `discard→[DSC]` / `system→[SYS]` / `enemy→[ENM]` / `battle→[BAT]`
- debug 日志过滤：默认不渲染 `debug=true` 的条目，`?debug=ai` 模式下显示并加 `[DBG]` 前缀

### 12.5 区域切换日志拆分

区域切换（无论前进还是回退）统一拆分为三条独立日志：
1. `move.region_leave` — 离开当前区域
2. `move.region_enter` — 进入目标区域（含区域描述）
3. `move.tile_desc` — 落脚格描述（复用已有 ID）

这样"从 A 出来"和"到了 B"是两个独立事件，语义更清晰。

### 12.6 日志文件清理

`vex/cache/obl_log_{groomid}_{pid}.json` 在游戏重置时清理（`rs_game()` 钩子），避免跨游戏残留。日常依赖 200 条上限自然轮转。

`vex/cache/obl_battle_log_{groomid}_{pid}.json` 在游戏重置时由 `obl_battle_log_clear_all()` 清理（删除所有 `obl_battle_log*.json` 文件）。

---

## 十三、战斗演出系统

### 13.1 设计目标

建立可扩展的战斗演出框架，包含战斗地图、碰撞动画、模态框播放三大核心模块。基于战斗系统重构设计案（先攻轮机制）的后续演进。

**核心问题解决**：
1. 战斗结束日志丢失 → played 标记机制 + 文件持久化
2. 缺乏演出反馈 → 三阶段播放（碰撞动画 + 模态框 + 残留伤害数字）
3. 状态机冗余 → normal/battle 两态，取消 prebattle/ended
4. 战斗与探索界限模糊 → 后端 `obl_command_allowed_by_state` 强制过滤
5. 短时间多次请求 → 三层并发锁（前端 isProcessingBattle + commandQueue._locked + 后端 flock）

### 13.2 状态机

```
normal（探索）←→ battle（战斗）
```

- **prebattle 取消**：玩家点击敌人 → 纯前端确认界面（"是否攻击？"）→ 确认后直接提交 `obl_battle_start`，后端直接进入 `action='battle'`
- **ended 取消**：模态框播放完自动关闭，关闭后刷新状态决定去留

### 13.3 battlelog 数据流（played 标记机制）

```
后端 emit battlelog（played=0）
  → obl_battle_log_persist() 追加到文件，分配 log_id，played=0
  → 命令响应只返回 {}（不再附带 battlelog 字段）

前端 fetchAndPlayBattleLog()
  → gameApi('battle_log') → 返回 played=0 的条目
  → 按 enemy_pid 分组 → 每组三阶段播放
  → POST mark_battle_log_played.php 标记 played=1
```

**关键决策**：
- **统一单路径**：所有 battlelog（玩家命令 + 遭遇战）都走"持久化 → 前端拉取 → 标记"统一流程，不再有"命令响应附带"的双路径
- **零依赖 mark 接口**：`vex/mark_battle_log_played.php` 不走 api_v2，无 auth/DB，只文件读写
- **文件不被清空**：played=1 的条目保留作为历史记录

### 13.4 三阶段播放流程

前端 `playBattleLogGroup(entries, enemyPid)` 实现：

```
1. 碰撞动画阶段（地图上）
   → foreach entries: 若 action_id='unarmed_strike' → playCollisionAnimation
   → 攻击方冲刺（向受击方位移 4px 后回位，300ms）
   → 受击方抖动（延迟 120ms，300ms）
   → 不含伤害数字（避免"未卜先知"）

2. 模态框阶段（中央遮罩）
   → 播放前移除动作按钮 turn-active 光效（避免透过模态框遮罩闪烁）
   → 按 log_id 排序播放 battlelog
   → turn=0 显示"── 战斗开始 ──"分隔符
   → turn>=1 显示"── 回合 N ──"分隔符
   → 逐条显示，每条间隔 500ms
   → 播放完停留 1200ms 自动关闭

3. 残留伤害数字阶段（地图格上）
   → 模态框关闭后，在受击方格子上淡入显示伤害数字
   → 使用 position: fixed + 视口坐标（避免依赖容器定位上下文）
   → 2s 后自动移除
   → 恢复动作按钮 turn-active 光效（如果仍是玩家回合）
```

### 13.5 玩家回合提示

战斗模态框关闭后，若仍是玩家回合：
- 显示"你的回合"Toast
- Toast 位置：header 下方（`top: 100px`，水平居中），使用 `.pos-screen-center` class
- 动作按钮添加 `turn-active` class，触发 `turn-glow` 呼吸动画（2s 周期，边框渐变 + 内发光）

### 13.6 相关文档

- `oblivions/docs/战斗演出系统设计案.md` — 战斗演出系统设计案（前端框架）
- `oblivions/docs/战斗系统重构设计案.md` — 先攻轮机制设计案（后端逻辑基础）
- `oblivions/docs/战斗系统设计案.md` — 原始战斗系统设计案（含 prebattle 定义，已部分过时）
- `vex/CODEBASE.md` — Vex 前端代码库地图（含战斗模块详细说明）

---

**文档结束。** 结构化日志系统的完整 ID 清单见 `vex/data/log-templates.js`，Toast 即时反馈机制详见 `vex/CODEBASE.md`。
