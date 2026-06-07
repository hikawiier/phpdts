# CODEBASE MAP — 代码库地图

> 帮助AI和开发者快速定位代码。完整目录分层规则见[include/STRUCTURE.md](include/STRUCTURE.md)。

---

## 一、请求生命周期

```
浏览器请求 → 入口文件（定义CURSCRIPT）
                │
                ├── game.php       → 游戏主界面
                ├── command.php    → AJAX指令处理（核心）
                ├── valid.php      → 玩家激活/入场
                ├── admin.php      → 后台管理
                ├── index.php      → 首页/房间列表
                ├── chat.php       → 聊天轮询（跳过锁检查）
                ├── api_v2.php     → API v2
                └── 其他入口       → end.php, winner.php, record.php...
                │
                └── require './include/core/common.inc.php'
                      ├── global.func.php       → 工具函数库
                      ├── user.func.php         → 用户认证
                      ├── 输入提取+过滤(COOKIE/POST/GET, EXTR_SKIP防覆盖)
                      ├── config.inc.php        → 数据库参数
                      ├── db_{driver}.class.php → 数据库驱动
                      ├── system.php            → 系统设定
                      ├── init.func.php         → 初始化函数
                      ├── news.func.php         → 消息显示
                      ├── resources.func.php    → 资源加载库
                      ├── roommng.func.php      → 房间管理
                      ├── revclubskills.func.php→ 社团技能
                      ├── dice.func.php         → 骰子系统
                      ├── titles.func.php       → 头衔系统
                      ├── config('resources')   → 游戏资源定义
                      ├── config('gamecfg')     → 游戏主配置
                      ├── config('combatcfg')   → 战斗配置
                      ├── config('clubskills')  → 社团技能配置
                      ├── config('dialogue')    → 对话配置
                      ├── config('audio')       → 音频资源
                      ├── config('tooltip')     → 悬浮提示
                      ├── config('titles')      → 头衔配置
                      ├── ruleset_override.func.php → RuleSet覆盖
                      ├── system.func.php       → 游戏系统（重置/禁区/结束）
                      ├── deatharea.func.php    → 禁区统一函数库
                      └── messages.func.php     → 站内信（非chat入口）
```

> `template.func.php`不在`common.inc.php`中加载，而是`include template('name')`时按需加载。

### `$pdata` 生命周期

```
数据库 players 表
    ↓
fetch_playerdata_by_name($cuser) / fetch_playerdata_by_pid($id)
    ↓
check_player_misc_states() —— get_clbpara() 解析 JSON、check_skilllasttimes() 清理过期技能、reload_equip_items() 重载装备
    ↓
game.php: extract($pdata, EXTR_REFS) → 全局变量（仅渲染，不写回）
command.php: extract($pdata, EXTR_REFS) → 全局变量 → 指令执行 → player_save($pdata) → player_format_with_db_structure() JSON 编码 → 数据库
```

**设计演进：** 旧代码通过 `extract($pdata, EXTR_REFS)` 展开为全局变量，后续逻辑直接操作 `$hp`、`$itm1` 等。新设计要求函数接受 `&$data` 参数并直接进行数组操作（如 `$data['hp'] -= 10`、`$data['clbpara']['key'] = val`），禁止在函数内部再次 `extract`。入口文件的 `extract` 因模板系统依赖暂时保留。

**`$clbpara` 规范：** `$clbpara` 是 `$pdata['clbpara']` 经 `extract()` 产生的全局别名，本质为 `players.clbpara` 字段的 JSON 数组。必须通过 API（`get_clbpara()` / `check_player_misc_states()` / `player_save()`）操作；禁止直接 `json_encode` 后 `UPDATE` 数据库。

---

## 二、入口文件

| 文件 | CURSCRIPT | 功能 |
|------|-----------|------|
| [game.php](game.php) | `game` | 游戏主界面，加载玩家数据后渲染模板 |
| [command.php](command.php) | `game` | AJAX指令处理中心，按`$mode`分发 |
| [valid.php](valid.php) | `valid` | 玩家入场激活，选择称号、初始装备 |
| [admin.php](admin.php) | `admin` | 后台管理面板 |
| [index.php](index.php) | `index` | 首页，房间列表、系统公告 |
| [install.php](install.php) | — | 安装向导（独立运行，不依赖common.inc.php） |

---

## 三、核心 include 文件

### 基础设施层（`include/core/`）

| 文件 | 功能 |
|------|------|
| [config.inc.php](config.inc.php) | 数据库连接参数、表前缀、加密密钥、主从配置 |
| [include/core/common.inc.php](include/core/common.inc.php) | **核心初始化**：常量、输入过滤（EXTR_SKIP防覆盖）、数据库连接、配置加载、状态机调度 |
| [include/core/global.func.php](include/core/global.func.php) | **全局工具函数**：模板引擎、`config()`、日志、聊天、物品信息解析 |
| [include/core/template.func.php](include/core/template.func.php) | 模板编译引擎（按需加载） |
| [include/core/JSON.php](include/core/JSON.php) | JSON编解码兼容层 |

### 用户认证层（`include/auth/`）

| 文件 | 功能 |
|------|------|
| [include/auth/user.func.php](include/auth/user.func.php) | 用户认证、注册、登录 |

### 房间基础设施（`include/room/`）

| 文件 | 功能 |
|------|------|
| [include/room/roommng.func.php](include/room/roommng.func.php) | 房间创建/管理、RuleSet房间 |
| [include/room/ruleset_override.func.php](include/room/ruleset_override.func.php) | RuleSet覆盖系统 |

### 游戏会话控制层（`include/gamectl/`）

| 文件 | 功能 |
|------|------|
| [include/gamectl/gamestate.func.php](include/gamectl/gamestate.func.php) | **游戏状态机**：7个状态转换函数 |
| [include/gamectl/system.func.php](include/gamectl/system.func.php) | **游戏系统**：重置`rs_game()`、禁区管理、游戏结束 |
| [include/gamectl/deatharea.func.php](include/gamectl/deatharea.func.php) | **禁区统一函数库**：`is_death_area()`/`is_safe_area()`/`get_death_areas()`等14个封装函数 |
| [include/gamectl/game.func.php](include/gamectl/game.func.php) | **玩家数据函数**：数据初始化、存档、NPC武器切换、玩家查询 |
| [include/gamectl/state.func.php](include/gamectl/state.func.php) | 玩家状态管理（休息、治疗等） |
| [include/gamectl/init.func.php](include/gamectl/init.func.php) | 角色状态初始化、头像、天眼技能 |
| [include/gamectl/resources.func.php](include/gamectl/resources.func.php) | 资源加载函数、装备列表、Quest配置加载 |
| [include/gamectl/news.func.php](include/gamectl/news.func.php) | 游戏进行状况消息显示 |
| [include/gamectl/messages.func.php](include/gamectl/messages.func.php) | 站内信系统 |
| [include/gamectl/antiafk.func.php](include/gamectl/antiafk.func.php) | 反挂机检查 |

### 游戏准备（`include/pregame/`）

| 文件 | 功能 |
|------|------|
| [include/pregame/clubslct.func.php](include/pregame/clubslct.func.php) | 社团选择（入场阶段） |
| [include/pregame/titles.func.php](include/pregame/titles.func.php) | 头衔系统（选择初始称号） |

### 跨游戏结算（`include/meta/`）

| 文件 | 功能 |
|------|------|
| [include/meta/credits.func.php](include/meta/credits.func.php) | 积分结算（游戏结束后） |
| [include/meta/gambling.func.php](include/meta/gambling.func.php) | 赌局系统（跨游戏） |
| [include/meta/achievement.func.php](include/meta/achievement.func.php) | 成就系统 |

### 数据库层（`include/db/`）

| 文件 | 说明 |
|------|------|
| [include/db/db_mysqli.class.php](include/db/db_mysqli.class.php) | MySQLi驱动（当前使用） |
| [include/db/db_pdo.class.php](include/db/db_pdo.class.php) | PDO驱动 |
| [include/db/db_mysql.class.php](include/db/db_mysql.class.php) | MySQL驱动（旧） |
| [include/db/masterslave.func.php](include/db/masterslave.func.php) | 主从数据库配置 |

---

## 四、include/game/ 游戏逻辑模块

### 战斗系统（`include/game/combat/`，rev*系列）

| 文件 | 功能 |
|------|------|
| [include/game/combat/revcombat.func.php](include/game/combat/revcombat.func.php) | 战斗主流程（新版） |
| [include/game/combat/revcombat.calc.php](include/game/combat/revcombat.calc.php) | 非伤害性计算（射程、能否反击） |
| [include/game/combat/revcombat_extra.func.php](include/game/combat/revcombat_extra.func.php) | 战斗流程中的特殊行为 |
| [include/game/combat/revbattle.func.php](include/game/combat/revbattle.func.php) | 战斗前端渲染 |
| [include/game/combat/revbattle.calc.php](include/game/combat/revbattle.calc.php) | 战斗前端计算 |
| [include/game/combat/revattr.func.php](include/game/combat/revattr.func.php) | **战斗伤害系统核心**（最大文件） |
| [include/game/combat/revattr.calc.php](include/game/combat/revattr.calc.php) | 战斗伤害特殊计算方法 |
| [include/game/combat/revattr_extra.func.php](include/game/combat/revattr_extra.func.php) | 战斗伤害额外逻辑 |

### 社团系统（`include/game/club/`）

| 文件 | 功能 |
|------|------|
| [include/game/club/revclubskills.func.php](include/game/club/revclubskills.func.php) | 社团技能底层函数 |
| [include/game/club/revclubskills_extra.func.php](include/game/club/revclubskills_extra.func.php) | 各社团技能具体逻辑 |
| [include/game/club/elementmix.func.php](include/game/club/elementmix.func.php) | 元素合成（社团20） |
| `club21.func.php` / `club22.func.php` | 社团21/22功能汇总 |

### 事件系统（`include/game/event/`）

| 文件 | 功能 |
|------|------|
| [include/game/event/revevent.func.php](include/game/event/revevent.func.php) | 事件系统（新版） |
| [include/game/event/event.func.php](include/game/event/event.func.php) | 探索地图遭遇事件 |
| [include/game/event/aievent.func.php](include/game/event/aievent.func.php) | 特殊单位sanma行为处理 |

### 物品系统（`include/game/item/`）

| 文件 | 功能 |
|------|------|
| [include/game/item/itemmain.func.php](include/game/item/itemmain.func.php) | **物品系统主入口**，按`$itemcmd`分发 |
| [include/game/item/item.func.php](include/game/item/item.func.php) | 物品使用分发器`itemuse()` |
| [include/game/item/item2.func.php](include/game/item/item2.func.php) | 物品使用具体逻辑 |
| [include/game/item/itemmix.func.php](include/game/item/itemmix.func.php) | 物品合成系统 |
| [include/game/item/itemplace.func.php](include/game/item/itemplace.func.php) | 物品放置/刷新 |
| [include/game/item/itmpara_tooltip.func.php](include/game/item/itmpara_tooltip.func.php) | 物品参数提示 |
| `type/*.php` | 各类型物品实现（weapon/tool/trap/recovery/quest/special_effect/platform等20+个文件） |

### 其他游戏模块

| 文件 | 功能 |
|------|------|
| [include/game/search.func.php](include/game/search.func.php) | 探索/移动系统 |
| [include/game/encounter.func.php](include/game/encounter.func.php) | 玩家遭遇交互 |
| [include/game/extrabag.func.php](include/game/extrabag.func.php) | 额外背包 |
| [include/game/special.func.php](include/game/special.func.php) | 杂项行动 |
| [include/game/quest.func.php](include/game/quest.func.php) | 任务系统 |
| [include/game/team.func.php](include/game/team.func.php) | 队伍系统 |
| [include/game/duel.func.php](include/game/duel.func.php) | 决斗系统 |
| [include/game/npc.func.php](include/game/npc.func.php) | NPC管理（动态生成、进化） |
| [include/game/setitems.func.php](include/game/setitems.func.php) | 套装系统 |
| `fishing.func.php` / `fortune.func.php` / `dice.func.php` / `depot.func.php` / `console.func.php` / `song.inc.php` | 钓鱼/运势/骰子/仓库/控制台/歌曲 |

### 已废弃文件（`include/deprecated/`，不需要阅读）

旧版战斗、属性、社团技能、物品系统、加密、微博日志等`.old`文件。

---

## 五、command.php 的 `$mode` 分发机制

`command.php`是核心指令处理文件：加载`common.inc.php` → 提取`$pdata` → 处理冷却/眩晕/对话框检查 → 按`$mode`分发。

| `$mode` | 处理文件 | 说明 |
|---------|----------|------|
| `command` | `command.php`内部 | 基础指令：move、search、itemuse、rest等 |
| `revcombat` | `include/game/combat/revcombat.func.php` | 战斗 |
| `itemmain` | `include/game/item/itemmain.func.php` | 物品主菜单 |
| `itemmix` | `include/game/item/itemmix.func.php` | 物品合成 |
| `elementmix` | `include/game/club/elementmix.func.php` | 元素合成 |
| `corpse` | `command.php`内部 | 尸体搜索 |
| `search` | `include/game/search.func.php` | 探索 |
| `fishing` | `include/game/fishing.func.php` | 钓鱼 |
| `special` | `include/game/special.func.php` | 特殊技能 |
| `rest` | `include/gamectl/state.func.php` | 休息 |
| `battle` | `include/game/combat/revbattle.func.php` | 战斗前端渲染 |

---

## 六、配置与数据文件

### gamedata/cache/ — 运行时配置缓存（`config()`加载）

| 文件 | 加载位置 | 用途 |
|------|----------|------|
| `gamecfg_1.php` | `common.inc.php` | 游戏主配置（血量、经验、概率、冷却等） |
| `resources_1.php` | `common.inc.php` | 游戏资源定义（地点/物品/天气/技能等） |
| `combatcfg_1.php` | `common.inc.php` | 战斗配置（命中/伤害/射程/反击/天气修正等） |
| `clubskills_1.php` | `common.inc.php` | 社团技能配置 |
| `dialogue_1.php` | `common.inc.php` | 对话系统 |
| `audio_1.php` | `common.inc.php` | 音频资源 |
| `titles_1.php` | `common.inc.php` | 头衔配置 |
| `tooltip_1.php` | `common.inc.php` | 悬浮提示 |
| `npc_1.php` / `mapitem_1.php` / `shopitem_1.php` / `addnpc_1.php` / `evonpc_1.php` | `system.func.php` | NPC/地图物品/商店/额外NPC/进化NPC |
| `overlay_1.php` / `synitem_1.php` / `mixitem_1.php` / `vnmixitem_1.php` | 各合成模块 | 超量/同调/主合成/vnworld合成配置 |
| `vnworld_1.php` | `vnmix.func.php` | vnworld主配置 |
| `stwep_1.php` / `stitem_1.php` | `valid.php` | 起始武器/道具配置 |
| `achievement_1.php` / `setitems_1.php` / `wepchange_1.php` | 各模块 | 成就/套装/武器变换配置 |
| `fy_1.php` / `f99_1.php` / `present_1.php` / `box_1.php` / `randomFS_1.php` / `randomFSW_1.php` | 礼盒模块 | 各类特殊礼盒配置 |
| `itmlist_1.php` | `vn_postitem.php`等 | 快速输入缓存 |

### gamedata/sql/ — 数据库结构

| 文件 | 用途 |
|------|------|
| `all.sql` | 完整数据库结构 |
| `players.sql` / `chat.sql` / `mapitem.sql` / `maptrap.sql` / `shopitem.sql` / `vnworld.sql` / `newsinfo.sql` / `reset.sql` | 各表结构 |

### gamedata/ 根目录 — 直接引用配置

| 文件 | 引用方式 |
|------|----------|
| `system.php` | `common.inc.php`直接require |
| `admincfg.php` | `admin.php`直接require |
| `club21cfg.php` | `club21.func.php`直接include |
| `questcfg_1.php` / `addnpc_quest_1.php` / `questitem_1.php` | `get_ruleset_plain_resource_file()` fallback |

---

## 七、模板系统

### 模板目录

| 目录 | 说明 |
|------|------|
| [templates/default/](templates/default/) | 默认模板（经典版） |
| [templates/nouveau/](templates/nouveau/) | 新版模板（NOUVEAU，现代化UI） |

### 模板语法

```html
{variable_name}                 <!-- 变量输出 -->
<!--{if $condition}-->...<!--{/if}-->   <!-- 条件 -->
<!--{loop $array $item}-->...<!--{/loop}--> <!-- 循环 -->
<!--{template header}-->        <!-- 子模板 -->
<!--{eval ...}-->               <!-- 嵌入PHP -->
```

加载：`include template('game');` → 加载`templates/{templateid}/game.htm`

---

## 八、后台管理

[admin.php](admin.php)按`$mode`分发到[include/admin/](include/admin/)子模块：

| 文件 | 功能 | 权限 |
|------|------|------|
| `configmng.php` | 配置管理 | 9 |
| `systemmng.php` | 系统管理 | 7 |
| `gamecfgmng.php` | 游戏配置管理 | 7 |
| `gmlist.php` | GM列表 | 9 |
| `urlist.php` | 用户列表 | 6 |
| `banlistmng.php` | 封禁管理 | 6 |
| `pcmng.php` | 玩家管理 | 5 |
| `npcmng.php` | NPC管理 | 5 |
| `resourcemng.php` | 资源管理 | 7 |
| `roommng.php` | 房间管理 | 5 |
| `vnmixlist.php` | VN合成列表 | 5 |
| `gamecheck.php` | 游戏检查 | 2 |

---

## 九、RuleSet 系统（时光重现）

RuleSet允许在独立房间中运行不同版本的游戏配置。

```
gamedata/ruleset/
├── ruleset_config.php    → RuleSet定义和工具函数
├── YELLOWKNIFE/          → 当前主线版本快照
│   ├── cache/            → 配置缓存（与主cache结构相同）
│   ├── img/              → 自定义图片
│   ├── questcfg_1.php    → 任务配置
│   ├── questitem_1.php   → 任务物品
│   └── addnpc_quest_1.php → 任务NPC
├── ACBRA_2009/           → 2009经典版
├── ACDTS_2011/           → 2011版
├── ACDTS_298SP4/         → 298SP4版
└── ACDTS_298SP4_AR/      → 全随机版
```

**加载优先级：** RuleSet cache → 主cache → fallback `_1.php`

---

## 十、快速定位指南

| 想找什么 | 去哪里 |
|----------|--------|
| 数据库连接配置 | [config.inc.php](config.inc.php) |
| 请求入口初始化 | [include/core/common.inc.php](include/core/common.inc.php) |
| 工具函数 | [include/core/global.func.php](include/core/global.func.php) |
| 玩家数据处理 | [include/gamectl/game.func.php](include/gamectl/game.func.php) |
| 游戏重置逻辑 | [include/gamectl/system.func.php](include/gamectl/system.func.php) |
| 禁区系统 | [include/gamectl/deatharea.func.php](include/gamectl/deatharea.func.php) |
| NPC生成 | [include/game/npc.func.php](include/game/npc.func.php) |
| 积分结算 | [include/meta/credits.func.php](include/meta/credits.func.php) |
| 赌局系统 | [include/meta/gambling.func.php](include/meta/gambling.func.php) |
| 反挂机 | [include/gamectl/antiafk.func.php](include/gamectl/antiafk.func.php) |
| 指令处理 | [command.php](command.php) |
| 战斗逻辑 | [include/game/combat/revcombat.func.php](include/game/combat/revcombat.func.php) |
| 战斗伤害计算 | [include/game/combat/revattr.func.php](include/game/combat/revattr.func.php) |
| 物品使用 | [include/game/item/item.func.php](include/game/item/item.func.php) → [itemmain.func.php](include/game/item/itemmain.func.php) |
| 物品合成 | [include/game/item/itemmix.func.php](include/game/item/itemmix.func.php) |
| 探索移动 | [include/game/search.func.php](include/game/search.func.php) |
| 任务系统 | [include/game/quest.func.php](include/game/quest.func.php) |
| 社团技能 | [include/game/club/revclubskills.func.php](include/game/club/revclubskills.func.php) |
| 游戏配置 | [gamedata/cache/gamecfg_1.php](gamedata/cache/gamecfg_1.php) |
| 模板文件 | [templates/default/](templates/default/) |
| 配置加载 | [include/core/global.func.php](include/core/global.func.php) `config()`函数 |
| 全局变量定义 | [GLOBALS.md](GLOBALS.md) |
