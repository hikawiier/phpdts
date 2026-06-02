# CODEBASE MAP — 代码库地图

> 快速导航：本文档帮助 AI 和开发者快速定位代码位置。阅读时间约 5 分钟。

---

## 一、请求生命周期

```
浏览器请求 → 入口文件（定义 CURSCRIPT 常量）
                │
                ├── game.php       → 游戏主界面
                ├── command.php    → AJAX 指令处理（核心）
                ├── valid.php      → 玩家激活/入场
                ├── admin.php      → 后台管理
                ├── index.php      → 首页/房间列表
                ├── chat.php       → 聊天轮询（跳过锁检查）
                ├── api_v2.php     → API v2 端点
                └── 其他功能入口   → end.php, winner.php, record.php ...
                │
                └── require './include/common.inc.php'
                      │
                      ├── #1  require global.func.php       → 工具函数库
                      ├── #2  require user.func.php         → 用户认证
                      ├── #3  extract($_COOKIE, $_POST, $_GET) → 输入提取+过滤
                      ├── #4  require config.inc.php        → 数据库连接参数
                      ├── #5  require db_{driver}.class.php → 数据库驱动
                      ├── #6  new dbstuff() + connect()     → 数据库连接
                      ├── #7  require gamedata/system.php   → 系统设定
                      ├── #8  require init.func.php         → 初始化函数
                      ├── #9  require news.func.php         → 游戏内进行状况的消息显示系统
                      ├── #10 require resources.func.php    → 资源层加载库
                      ├── #11 require roommng.func.php      → 房间管理
                      ├── #12 require game/revclubskills.func.php → 社团技能
                      ├── #13 require game/dice.func.php    → 骰子系统
                      ├── #14 require game/titles.func.php  → 头衔系统
                      │
                      ├── #15 require config('resources')   → 游戏资源定义
                      ├── #16 require config('gamecfg')     → 游戏主配置
                      ├── #17 require config('combatcfg')   → 战斗配置
                      ├── #18 require config('clubskills')  → 社团技能配置
                      ├── #19 require config('dialogue')    → 对话系统配置
                      ├── #20 require config('audio')       → 音频资源配置
                      ├── #21 require config('tooltip')     → 悬浮提示配置
                      ├── #22 require config('titles')      → 头衔配置
                      │
                      ├── #23 include_once ruleset_override.func.php → RuleSet 覆盖
                      ├── #24 require system.func.php       → 游戏系统（状态机）
                      │
                      └── #25 include_once messages.func.php (非 chat 入口时)
```

> **注意**：`template.func.php` 不在 `common.inc.php` 中加载，而是在调用 `include template('name')` 时按需加载。

---

## 二、入口文件

| 文件 | CURSCRIPT | 功能 |
|------|-----------|------|
| [game.php](game.php) | `game` | 游戏主界面，加载玩家数据后渲染模板 |
| [command.php](command.php) | `game` | AJAX 指令处理中心，按 `$mode` 分发到各模块 |
| [valid.php](valid.php) | `valid` | 玩家入场激活，选择称号、初始装备 |
| [admin.php](admin.php) | `admin` | 后台管理面板，按 `$admin_cmd_list` 权限控制 |
| [index.php](index.php) | `index` | 首页，显示房间列表、系统公告 |
| [install.php](install.php) | — | 安装向导，独立运行（不依赖 common.inc.php） |

---

## 三、核心 include 文件

### 基础设施层

| 文件 | 行数 | 功能 |
|------|------|------|
| [config.inc.php](config.inc.php) | 126 | 数据库连接参数、表前缀、加密密钥、主从配置 |
| [include/common.inc.php](include/common.inc.php) | 276 | **核心初始化**：定义常量、输入过滤、数据库连接、加载配置、游戏状态机 |
| [include/global.func.php](include/global.func.php) | ~1170 | **全局工具函数**：模板引擎、config() 加载、日志、聊天、物品信息解析 |
| [include/game.func.php](include/game.func.php) | ~690 | **玩家数据函数**：数据初始化、存档、NPC 武器切换、玩家数据查询 |
| [include/user.func.php](include/user.func.php) | — | 用户认证、注册、登录 |

### 系统层

| 文件 | 行数 | 功能 |
|------|------|------|
| [include/system.func.php](include/system.func.php) | ~1070 | **游戏系统**：重置游戏 `rs_game()`、禁区管理、NPC 生成、游戏结束 |
| [include/state.func.php](include/state.func.php) | — | 玩家状态管理（休息、治疗等） |
| [include/roommng.func.php](include/roommng.func.php) | — | 房间创建/管理、RuleSet 房间 |
| [include/resources.func.php](include/resources.func.php) | ~170 | 资源加载函数、装备列表、Quest 配置加载 |
| [include/template.func.php](include/template.func.php) | — | 模板编译引擎 |
| [include/messages.func.php](include/messages.func.php) | — | 站内信系统 |
| [include/news.func.php](include/news.func.php) | — | 游戏内进行状况的消息显示系统 |
| [include/ruleset_override.func.php](include/ruleset_override.func.php) | — | RuleSet 覆盖系统 |

### 数据库层

| 文件 | 说明 |
|------|------|
| [include/db_mysql.class.php](include/db_mysql.class.php) | MySQL 驱动（旧） |
| [include/db_mysqli.class.php](include/db_mysqli.class.php) | MySQLi 驱动（当前使用） |
| [include/db_pdo.class.php](include/db_pdo.class.php) | PDO 驱动 |

---

## 四、include/game/ 游戏逻辑模块

### 战斗系统（rev* 系列）

| 文件 | 行数 | 功能 |
|------|------|------|
| [revcombat.func.php](include/game/revcombat.func.php) | 728 | 战斗主流程（新版） |
| [revcombat.calc.php](include/game/revcombat.calc.php) | — | 非伤害性计算（射程、能否反击） |
| [revcombat_extra.func.php](include/game/revcombat_extra.func.php) | 514 | 战斗流程中的特殊行为 |
| [revbattle.func.php](include/game/revbattle.func.php) | 461 | 战斗前端渲染 |
| [revbattle.calc.php](include/game/revbattle.calc.php) | 262 | 战斗前端计算 |
| [revattr.func.php](include/game/revattr.func.php) | **2736** | 战斗伤害系统核心（最大文件） |
| [revattr.calc.php](include/game/revattr.calc.php) | 370 | 战斗伤害特殊计算方法 |
| [revattr_extra.func.php](include/game/revattr_extra.func.php) | 490 | 战斗伤害额外逻辑 |


### 物品系统

| 文件 | 行数 | 功能 |
|------|------|------|
| [itemmain.func.php](include/game/itemmain.func.php) | **2019** | 物品系统主入口，按 `$itemcmd` 分发 |
| [item.func.php](include/game/item.func.php) | — | 物品使用分发器 `itemuse()` |
| [item2.func.php](include/game/item2.func.php) | 961 | 物品使用具体逻辑 |
| [itemmix.func.php](include/game/itemmix.func.php) | 506 | 物品合成系统 |
| [itemplace.func.php](include/game/itemplace.func.php) | 496 | 物品放置/刷新 |
| [item.weapon.php](include/game/item.weapon.php) | 122 | 武器类物品 |
| [item.weapon_mod.php](include/game/item.weapon_mod.php) | 311 | 武器改装 |
| [item.tool.php](include/game/item.tool.php) | 188 | 工具类物品 |
| [item.cure.php](include/game/item.cure.php) | — | 治疗类物品 |
| [item.ammo.php](include/game/item.ammo.php) | — | 弹药类物品 |
| [item.trap.php](include/game/item.trap.php) | 86 | 陷阱类物品 |
| [item.radar.php](include/game/item.radar.php) | 106 | 雷达类物品 |
| [item.poison.php](include/game/item.poison.php) | 85 | 毒药类物品 |
| [item.quest.php](include/game/item.quest.php) | 269 | 任务类物品 |
| [item.other.php](include/game/item.other.php) | — | 其他物品 |
| [item.npc.php](include/game/item.npc.php) | — | NPC 物品 |
| [item.giftbox.php](include/game/item.giftbox.php) | — | 福袋/礼盒 |
| [item.dice.php](include/game/item.dice.php) | — | 骰子类物品 |
| [item.enhance.php](include/game/item.enhance.php) | — | 强化类物品 |
| [item.ending.php](include/game/item.ending.php) | — | 结局类物品 |
| [item.main.php](include/game/item.main.php) | — | 主物品逻辑 |
| [item.club_card.php](include/game/item.club_card.php) | — | 社团卡片 |
| [item.recovery.php](include/game/item.recovery.php) | 261 | 恢复类物品 |
| [item.skillbook.php](include/game/item.skillbook.php) | 180 | 技能书 |
| [item.synthesis.php](include/game/item.synthesis.php) | 93 | 合成类物品 |
| [item.special_effect.php](include/game/item.special_effect.php) | 227 | 特殊效果 |
| [item.electronic.php](include/game/item.electronic.php) | — | 电子类物品 |
| [item.platform.php](include/game/item.platform.php) | 525 | 平台类物品 |
| [item.weather.php](include/game/item.weather.php) | — | 天气物品 |
| [item.test.php](include/game/item.test.php) | 265 | 测试物品 |
| [item.nachster_booster.php](include/game/item.nachster_booster.php) | — | nachster版本新增物品 |
| [item.nouveau_booster1.php](include/game/item.nouveau_booster1.php) | — | nouveau版本新增物品 |

### 其他游戏模块

| 文件 | 行数 | 功能 |
|------|------|------|
| [search.func.php](include/game/search.func.php) | **963** | 探索/移动系统 |
| [encounter.func.php](include/game/encounter.func.php) | 225 | 玩家遭遇交互 |
| [extrabag.func.php](include/game/extrabag.func.php) | 359 | 额外背包（装备提供的额外存储空间） |
| [special.func.php](include/game/special.func.php) | 532 | 杂项行动 |
| [quest.func.php](include/game/quest.func.php) | 707 | 任务系统 |
| [event.func.php](include/game/event.func.php) | — | 只用于处理游戏内探索地图时会遭遇的事件系统 |
| [aievent.func.php](include/game/aievent.func.php) | — | 只用于处理游戏内特殊单位sanma的行为（存在$gamevars['sanmaact']时才会调用） |
| [revevent.func.php](include/game/revevent.func.php) | 166 | 事件系统（新版） |
| [club21.func.php](include/game/club21.func.php) | — | 社团21的功能汇总 |
| [club22.func.php](include/game/club22.func.php) | — | 社团22的功能汇总 |
| [clubslct.func.php](include/game/clubslct.func.php) | — | 社团选择 |
| [revclubskills.func.php](include/game/revclubskills.func.php) | 668 | 社团技能的底层函数，处理社团技能初始化等流程 |
| [revclubskills_extra.func.php](include/game/revclubskills_extra.func.php) | — | 每个社团技能的具体逻辑判断 |
| [revclubskills.inc.php](include/game/revclubskills.inc.php) | 9 | 社团技能常量 |
| [elementmix.func.php](include/game/elementmix.func.php) | — | 社团20的特殊功能元素合成 |
| [elementmix.calc.php](include/game/elementmix.calc.php) | — | 社团20的特殊功能元素合成计算模块 |
| [fishing.func.php](include/game/fishing.func.php) | — | 钓鱼系统 |
| [fortune.func.php](include/game/fortune.func.php) | — | 运势系统 |
| [dice.func.php](include/game/dice.func.php) | — | 骰子系统 |
| [depot.func.php](include/game/depot.func.php) | — | 仓库系统 |
| [team.func.php](include/game/team.func.php) | 192 | 队伍系统 |
| [titles.func.php](include/game/titles.func.php) | 198 | 头衔系统 |
| [achievement.func.php](include/game/achievement.func.php) | — | 成就系统，关联的用户变量不是$ach，而是$revach  |
| [setitems.func.php](include/game/setitems.func.php) | 113 | 套装系统 |
| [console.func.php](include/game/console.func.php) | — | 只用于处理游戏内提供的控制台功能 |
| [itmpara_tooltip.func.php](include/game/itmpara_tooltip.func.php) | 345 | 物品参数提示 |
| [song.inc.php](include/game/song.inc.php) | — | 歌曲系统 |

### 已废弃文件（不需要阅读）

| 文件 | 说明 |
|------|------|
| [combat.func.old](include/game/combat.func.old) | 旧版战斗系统 |
| [attr.func.old](include/game/attr.func.old) | 旧版属性系统 |
| [clubskills.func.old](include/game/clubskills.func.old) | 旧版社团技能 |
| [item.func.old](include/game/item.func.old) | 旧版物品系统 |

---

## 五、command.php 的 $mode 分发机制

`command.php` 是游戏的核心指令处理文件。流程如下：

1. 加载 `common.inc.php` → 初始化
2. 提取 `$pdata` → 获取玩家状态
3. 处理冷却时间、眩晕、对话框等检查
4. 根据 `$mode` 分发到对应模块

**主要 mode 值：**

| $mode | 处理文件 | 说明 |
|-------|----------|------|
| `command` | `command.php` 内部 | 基础指令：move、search、itemuse、rest 等 |
| `revcombat` | `revcombat.func.php` | 战斗 |
| `itemmain` | `itemmain.func.php` | 物品主菜单 |
| `itemmix` | `itemmix.func.php` | 物品合成 |
| `elementmix` | `elementmix.func.php` | 元素合成 |
| `corpse` | `command.php` 内部 | 尸体搜索 |
| `search` | `search.func.php` | 探索 |
| `fishing` | `fishing.func.php` | 钓鱼 |
| `special` | `special.func.php` | 特殊技能 |
| `rest` | `state.func.php` | 休息 |
| `battle` | `revbattle.func.php` | 战斗前端渲染 |

---

## 六、配置与数据文件

### gamedata/cache/ — 运行时配置缓存（config() 加载）

| 文件 | 加载位置 | 用途 |
|------|----------|------|
| `gamecfg_1.php` | `common.inc.php` | 游戏主配置（血量、经验、概率等） |
| `resources_1.php` | `common.inc.php` | 游戏资源定义 |
| `combatcfg_1.php` | `common.inc.php` | 战斗配置 |
| `clubskills_1.php` | `common.inc.php` | 社团技能配置 |
| `dialogue_1.php` | `common.inc.php` | 对话系统 |
| `audio_1.php` | `common.inc.php` | 音频资源 |
| `titles_1.php` | `common.inc.php` | 头衔配置 |
| `tooltip_1.php` | `common.inc.php` | 悬浮提示 |
| `mapitem_1.php` | `system.func.php` | 地图物品 |
| `npc_1.php` | `system.func.php` | NPC 数据 |
| `addnpc_1.php` | `system.func.php` | 额外 NPC |
| `evonpc_1.php` | `system.func.php` | 进化 NPC |
| `shopitem_1.php` | `system.func.php` | 商店物品 |
| 详见 [gamedata/readme.md](gamedata/readme.md) | | |

### gamedata/sql/ — 数据库结构

| 文件 | 用途 |
|------|------|
| `players.sql` | 玩家表结构 |
| `all.sql` | 完整数据库结构 |
| `chat.sql` | 聊天表 |
| `mapitem.sql` | 地图物品表 |
| `maptrap.sql` | 地图陷阱表 |
| `shopitem.sql` | 商店物品表 |
| `vnworld.sql` | VN 世界表 |
| `newsinfo.sql` | 进行状况表 |
| `reset.sql` | 重置表 |

### gamedata/ 根目录 — 直接引用的配置

| 文件 | 引用方式 |
|------|----------|
| `system.php` | `common.inc.php` 直接 require |
| `admincfg.php` | `admin.php` 直接 require |
| `club21cfg.php` | `club21.func.php` 直接 include |
| `questcfg_1.php` | `get_questcfg()` fallback |
| `addnpc_quest_1.php` | `get_ruleset_plain_resource_file()` fallback |
| `questitem_1.php` | `get_questiteminfo()` fallback |

---

## 七、模板系统

### 模板目录

| 目录 | 说明 |
|------|------|
| [templates/default/](templates/default/) | 默认模板（经典版） |
| [templates/nouveau/](templates/nouveau/) | 新版模板（NOUVEAU，现代化 UI） |

### 模板语法

```html
<!-- 变量输出 -->  {variable_name}
<!-- 条件判断 -->  <!--{if $condition}-->...<!--{/if}-->
<!-- 循环遍历 -->  <!--{loop $array $item}-->...<!--{/loop}-->
<!-- 引入子模板 -->  <!--{template header}-->
<!-- 嵌入 PHP -->  <!--{eval ...}-->
```

### 加载方式

```php
include template('game');  // 加载 templates/{templateid}/game.htm
```

---

## 八、后台管理

[admin.php](admin.php) 按 `$mode` 分发到 [include/admin/](include/admin/) 下的子模块：

| 文件 | 功能 | 权限 |
|------|------|------|
| `configmng.php` | 配置管理 | 9 |
| `systemmng.php` | 系统管理 | 7 |
| `gamecfgmng.php` | 游戏配置管理 | 7 |
| `gmlist.php` | GM 列表 | 9 |
| `urlist.php` | 用户列表 | 6 |
| `banlistmng.php` | 封禁管理 | 6 |
| `pcmng.php` | 玩家管理 | 5 |
| `npcmng.php` | NPC 管理 | 5 |
| `resourcemng.php` | 资源管理 | 7 |
| `roommng.php` | 房间管理 | 5 |
| `vnmixlist.php` | VN 合成列表 | 5 |
| `gamecheck.php` | 游戏检查 | 2 |

---

## 九、RuleSet 系统（时光重现）

RuleSet 允许在独立房间中运行不同版本的游戏配置。

```
gamedata/ruleset/
├── ruleset_config.php    → RuleSet 定义和工具函数
├── YELLOWKNIFE/          → 当前主线版本快照
│   ├── cache/            → 配置缓存（与主 cache 结构相同）
│   ├── img/              → 自定义图片
│   ├── questcfg_1.php    → 任务配置
│   ├── questitem_1.php   → 任务物品
│   └── addnpc_quest_1.php → 任务 NPC
├── ACBRA_2009/           → 2009 经典版
├── ACDTS_2011/           → 2011 版
├── ACDTS_298SP4/         → 298SP4 版
└── ACDTS_298SP4_AR/      → 全随机版
```

**加载优先级：** RuleSet cache → 主 cache → fallback `_1.php`

---

## 十、快速定位指南

| 想找什么 | 去哪里 |
|----------|--------|
| 数据库连接配置 | [config.inc.php](config.inc.php) |
| 请求入口初始化 | [include/common.inc.php](include/common.inc.php) |
| 工具函数 | [include/global.func.php](include/global.func.php) |
| 玩家数据处理 | [include/game.func.php](include/game.func.php) |
| 游戏重置逻辑 | [include/system.func.php](include/system.func.php) |
| 指令处理 | [command.php](command.php) |
| 战斗逻辑 | [include/game/revcombat.func.php](include/game/revcombat.func.php) |
| 战斗伤害计算 | [include/game/revattr.func.php](include/game/revattr.func.php) |
| 物品使用 | [include/game/item.func.php](include/game/item.func.php) → [itemmain.func.php](include/game/itemmain.func.php) |
| 物品合成 | [include/game/itemmix.func.php](include/game/itemmix.func.php) |
| 探索移动 | [include/game/search.func.php](include/game/search.func.php) |
| 任务系统 | [include/game/quest.func.php](include/game/quest.func.php) |
| 社团技能 | [include/game/revclubskills.func.php](include/game/revclubskills.func.php) |
| 游戏配置 | [gamedata/cache/gamecfg_1.php](gamedata/cache/gamecfg_1.php) |
| 模板文件 | [templates/default/](templates/default/) |
| 配置加载 | [include/global.func.php](include/global.func.php) `config()` 函数 |
| 全局变量定义 | [GLOBALS.md](GLOBALS.md) |