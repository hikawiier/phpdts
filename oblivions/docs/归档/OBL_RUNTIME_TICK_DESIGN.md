# Oblivions Runtime 与 Tick Orchestrator 独立设计案

> 目标：让 Oblivions 从旧 `common.inc.php` 请求生命周期、旧 `game` 表运行状态、旧 `api_v2.php` 隐式 tick 副作用中独立出来，成为拥有专属 Runtime、Game State、Tick Orchestrator 与 API 入口的子应用。  
> 边界：本文设计 **Runtime / Tick / Game State 独立**；JSON Command API 契约与 Command Bus 详见 [`OBL_COMMAND_API_DESIGN.md`](./OBL_COMMAND_API_DESIGN.md)。

---

## 0. 设计状态

本文由原“备忘日志”扩写为可执行设计案。

当前前置任务状态：

- Oblivions JSON Command API 已落地。
- 前端探索、战斗、合成等写命令已通过：
  - `vex-vue` → `D:\wamp64\www\phpdts\oblivions\api\command.php`
- 但新 Command API 仍加载旧：
  - `D:\wamp64\www\phpdts\include\core\common.inc.php`
- pending tick / NPC / battle PROCESSING 结算仍由旧请求生命周期隐式触发。

本文后续任务的核心是：

```txt
Command API 独立已经完成。
下一步不是升级旧 command.php，而是让 Oblivions 拥有自己的 Runtime 和 Tick Orchestrator。
```

---

## 1. 背景与问题

Oblivions 模式虽然已有独立目录、独立玩家表、独立 domain functions、独立 JSON Command API，但当前运行时仍依赖旧核心 `common.inc.php`。

现状路径大致为：

```txt
oblivions/api/command.php
  -> include/core/common.inc.php
      -> 读取配置 / DB / cookie / user / room / gameinfo
      -> 加载旧核心配置和函数
      -> 获取 room DB lock
      -> load_gameinfo()
      -> 执行状态机
      -> 加载 oblivions/include/core/obl_bootstrap.php
      -> 如果 obl_pretick < obl_tick：解析 tick 事件
      -> save_gameinfo()
  -> obl_command_bus.php
      -> 执行玩家命令
      -> obl_tick_advance()
      -> save_gameinfo()
```

这造成几个问题：

1. **Oblivions API 没有自己的运行时边界**  
   每个 Oblivions 请求都要继承旧核心的全局变量、配置加载、输入过滤、状态机副作用。

2. **读接口可能隐式推进世界**  
   `api_v2.php?action=xxx` 作为只读接口时，只要经过 `common.inc.php`，就可能触发 pending tick 解析。

3. **tick 推进职责分散**  
   玩家命令后的 `obl_tick_advance()` 在 Command Bus 中，pending tick 解析在 `common.inc.php` 中，battle stale recovery 也在 `common.inc.php` 中。

4. **旧 `game` 表承担过多职责**  
   旧 `game` 表同时用于房间注册、规则集判断、游戏局状态、tick/gamevars 存储，导致 Oblivions 难以独立。

5. **旧 `load_gameinfo()` / `save_gameinfo()` 仍被 Oblivions 使用**  
   即使 `save_gameinfo()` 已有 Oblivions 分支，它仍属于旧核心 `global.func.php`，并携带旧模式字段和行为。

6. **前端 heartbeat 仍依赖旧 `api_v2.php`**  
   战斗 PROCESSING 时，前端仍调用：
   `GET /phpdts/api_v2.php?action=heartbeat`  
   其真实作用是“让旧入口经过 common.inc.php 并触发 tick 副作用”。

---

## 2. 总目标

本任务的最终目标是：

```txt
Oblivions 成为独立子应用。
旧核心只负责房间注册、用户系统等历史基础能力。
Oblivions 自己负责 runtime、game state、command、state read、heartbeat、tick orchestration。
```

具体目标：

- 建立 Oblivions 专属 Runtime / Request Context。
- 从 `common.inc.php` 解耦。
- 新建 Oblivions 专属 game state 表。
- 旧 `game` 表降级为 Room Registry。
- 建立专属 game repository / gamevars 读写层。
- 建立 Tick Orchestrator，集中管理：
  - 玩家命令后 tick advance。
  - pending tick resolve。
  - NPC processing。
  - battle PROCESSING refresh / stale recovery。
  - heartbeat 后台推进。
- 明确读接口纯读：state 查询不隐式推进 tick。
- 拆分 Oblivions API 入口：
  - `command.php`：玩家写命令。
  - `state.php`：纯读聚合状态。
  - `heartbeat.php`：显式后台推进。
- 让旧：
  - `D:\wamp64\www\phpdts\command.php`
  - `D:\wamp64\www\phpdts\api_v2.php`
  - `D:\wamp64\www\phpdts\include\core\common.inc.php`

  不再承担 Oblivions 新流程职责。

---

## 3. 非目标

本设计不处理以下内容：

- 不升级旧根目录 `command.php`。
- 不继续增强旧表单 POST command 模式。
- 不要求兼容旧 Oblivions API 路径的长期历史数据。
- 不以 WebSocket / SSE 为第一阶段目标。
- 不要求一次性把所有 Oblivions domain functions 改成无全局变量的纯对象式调用。
- 不重写整个战斗、地图、合成、道具业务逻辑。
- 不取消现有 JSON Command API 契约；Command API 只接入新 Runtime / Tick Orchestrator。

---

## 4. 设计原则

### 4.1 Oblivions 优先，旧核心只做历史基础设施

后续升级只围绕 Oblivions。

旧 `command.php` 不升级。  
旧 `api_v2.php` 不作为 Oblivions 长期状态接口。  
旧 `common.inc.php` 不作为 Oblivions Runtime。

### 4.2 Room Registry 与 Game State 分离

旧 `game` 表只回答：

```txt
这个房间是否存在？
这个房间属于谁？
这个房间是什么规则集？
这个房间是否是 OBLIVIONS？
```

Oblivions 自己的游戏局状态、tick、gamevars、phase、winner 等进入新表。

### 4.3 推进策略与推进机制分离

现有 `tick.func.php` 保留为 Tick Engine：

- 如何增加 tick。
- 如何同步 processed tick。
- 如何 dispatch listener。
- 如何执行 battle_npc / idle_npc / post phase。

新建 Tick Orchestrator 负责：

- 何时推进 tick。
- 何时解析 pending tick。
- 哪个 API 入口允许推进。
- 何时保存 game state。
- 何时恢复 stale battle。

### 4.4 读接口纯读

`state.php` 必须是纯读接口。

禁止在 state 请求中：

- `obl_tick_advance()`
- `obl_tick_synchronize()`
- `obl_resolve_tick_events()`
- NPC AI 行动
- battle PROCESSING 结算
- stale battle recovery

如果前端需要推进后台流程，应调用 `heartbeat.php`。

### 4.5 允许 Runtime 过渡期绑定 globals

现有 Oblivions domain functions 大量依赖：

- `$db`
- `$tablepre`
- `$gtablepre`
- `$groomid`
- `$gamevars`
- `$gamestate`
- `$now`
- `$cuser`
- `$cpass`
- `$udata`
- `$gruleset`
- `$obl_log`
- `$obl_error_log`
- `$obl_battle_log`

因此第一阶段不强制所有函数改签名。

新 Runtime 可以构造 `OblRequestContext`，同时把必要字段绑定回 globals：

```php
$ctx = obl_runtime_boot('command');
obl_runtime_bind_globals($ctx);
```

目标是先切断 `common.inc.php`，再逐步减少 globals。

---

## 5. 目标架构总览

```txt
vex-vue
  ├─ 写命令
  │    -> POST /phpdts/oblivions/api/command.php
  │       -> obl_runtime_boot('command')
  │       -> obl_command_api_handle()
  │       -> obl_tick_orchestrator_after_command()
  │
  ├─ 读状态
  │    -> GET /phpdts/oblivions/api/state.php?scope=...
  │       -> obl_runtime_boot('state')
  │       -> pure read only
  │
  └─ 后台推进
       -> POST /phpdts/oblivions/api/heartbeat.php
          -> obl_runtime_boot('heartbeat')
          -> obl_tick_orchestrator_heartbeat()
```

后端分层：

```txt
oblivions/api/*.php
  -> oblivions/include/core/obl_runtime.php
      -> obl_request_context.php
      -> obl_db.php
      -> obl_auth.php
      -> obl_room.php
      -> obl_game_repository.php
      -> obl_gamevars.php
      -> obl_lock.php
      -> obl_response.php
      -> obl_bootstrap.php
  -> command/state/heartbeat specific logic
  -> obl_tick_orchestrator.php
```

数据层分离：

```txt
旧全局房间管理层：
  {$gtablepre}game
    当前继续作为唯一 Room Registry：房间编号索引 / 统一房间管理 / ruleset 判断

Oblivions 可选全局房间管理层（未来才需要）：
  {$gtablepre}obl_roommng
    如果旧 game 表未来不再承担 Oblivions 房间管理，可由它接替；第一阶段不建立

Oblivions 单房间运行状态层：
  {$tablepre}oblgame
    例如 bra_s1_oblgame；一房间一表，一表一行，保存该房间单局 runtime state / tick / vars

Oblivions 房间实体层：
  {$tablepre}oblplayers
  {$tablepre}...
```

---

## 6. 旧 `game` 表职责收缩与未来接替

### 6.1 保留职责

旧 `{$gtablepre}game` 表当前仍作为全局 Room Registry / Room Management。

保留语义：

| 职责 | 说明 |
|---|---|
| 房间编号索引 | 根据 `groomid` 查询房间 |
| 用户当前房间 | `users.roomid` 指向 `groomid` |
| 房间 owner | 用于权限、展示、房间管理 |
| ruleset | 判断是否 `OBLIVIONS` |
| 房间生命周期粗状态 | 是否创建、关闭、可进入 |
| 大厅/房间列表展示 | 旧 UI 或管理页需要 |

结论：第一阶段 **不新建全局 Oblivions 房间管理表**，避免和旧 `game` 表形成两个 Room Registry。

### 6.2 移出职责

以下职责不再由旧 `game` 表承担，而迁移到当前房间的 `{$tablepre}oblgame`：

| 旧职责 | 新位置 |
|---|---|
| Oblivions 单局游戏状态 | `{$tablepre}oblgame.state` |
| Oblivions tick | `{$tablepre}oblgame.tick` |
| Oblivions processed tick | `{$tablepre}oblgame.processed_tick` |
| Oblivions gamevars | `{$tablepre}oblgame.vars_json` |
| Oblivions winner | `{$tablepre}oblgame.winner_pid` / `winner_name` |
| Oblivions heartbeat 时间 | `{$tablepre}oblgame.heartbeat_at` |
| Oblivions last command 时间 | `{$tablepre}oblgame.last_command_at` |

### 6.3 未来可选 `obl_roommng`

如果未来希望旧 `{$gtablepre}game` 完全回归旧核心，或者希望 Oblivions 拥有自己的全局房间管理层，可以新增：

```txt
{$gtablepre}obl_roommng
```

它的职责应是：

- 接替旧 `game` 表对 Oblivions 房间的编号索引。
- 记录 Oblivions 房间 owner / ruleset / 可见性 / 生命周期粗状态。
- 为 admin / debug / monitor 提供全局房间列表。

但它不应保存单房间 runtime 真值，例如：

- tick
- processed_tick
- vars_json
- battle PROCESSING 状态
- 当前单局 winner

这些仍属于 `{$tablepre}oblgame`。

也就是说：

```txt
{$gtablepre}game 或未来 {$gtablepre}obl_roommng
  -> 房间管理 / 房间索引

{$tablepre}oblgame
  -> 对应房间单局游戏状态 source of truth
```

### 6.4 `oblivions_is_active()` 的位置

短期可以继续通过旧 `game` 表的 `gruleset` 判断：

```php
$gruleset === 'OBLIVIONS'
```

但新 Runtime 中不要依赖 `common.inc.php` 预先设置 `$gruleset`。

应由 `obl_room.php` 显式查询：

```php
$room = obl_room_load($groomid);
if ($room['gruleset'] !== 'OBLIVIONS') deny;
```

过渡期可继续设置全局：

```php
$gruleset = $room['gruleset'];
```

用于兼容现有 `oblivions_is_active()` 和 `config()` 等函数。

---

## 7. 新建 Oblivions 单房间 game state 表

### 7.1 推荐表名

推荐新建房间前缀表：

```txt
{$tablepre}oblgame
```

默认物理表示例：

```txt
bra_s1_oblgame
bra_s2_oblgame
```

说明：

- `{$tablepre}` 已包含房间编号，例如 `bra_s1_`。
- 表名采用 `oblgame` 而不是 `obl_game`，是为了贴近当前已有 `{$tablepre}oblplayers` 命名风格。
- 每个房间一张 `oblgame` 表。
- 每张表只保存当前房间当前单局的一行 runtime state。

### 7.2 废弃全局 `{$gtablepre}obl_games` 作为主状态表

全局 `{$gtablepre}obl_games` 方案经复核后不再作为推荐方案。

原因：

- 它一行对应一个 `groomid`，天然承担跨房间索引 / 管理职责。
- 它与旧 `{$gtablepre}game` 的 Room Registry 职责重叠。
- 如果未来保留全局表，更合理的命名应是 `{$gtablepre}obl_roommng` 或 `{$gtablepre}obl_room_index`。
- 单房间 runtime state 应跟随房间数据域，用即创建、用完可抛弃。
- 当前已有 `{$tablepre}oblplayers`，`{$tablepre}oblgame` 与其边界一致。

因此最终分工为：

```txt
{$gtablepre}game
  -> 当前全局房间管理 / 房间编号索引 / ruleset 判断

未来可选 {$gtablepre}obl_roommng
  -> 如果需要，接替旧 game 表的 Oblivions 房间管理职能

{$tablepre}oblgame
  -> 当前房间单局 runtime state 真值源
```

### 7.3 表职责

`{$tablepre}oblgame` 是当前房间的 Oblivions Game State。

它负责：

- 当前房间 Oblivions 局是否已初始化。
- 当前房间当前局的运行状态。
- tick / processed tick。
- runtime vars。
- 胜者和结束信息。
- heartbeat / command 时间。

它不负责：

- 跨房间列表。
- 房间 owner。
- ruleset 判断。
- 大厅展示。

这些仍由旧 `{$gtablepre}game` 或未来 `{$gtablepre}obl_roommng` 负责。

### 7.4 建议字段

```sql
CREATE TABLE IF NOT EXISTS `{$tablepre}oblgame` (
  `id` tinyint unsigned NOT NULL DEFAULT 1,
  `run_id` varchar(64) NOT NULL DEFAULT '',
  `state` varchar(32) NOT NULL DEFAULT 'INIT',
  `phase` varchar(32) NOT NULL DEFAULT '',

  `tick` int unsigned NOT NULL DEFAULT 0,
  `processed_tick` int unsigned NOT NULL DEFAULT 0,
  `tick_version` int unsigned NOT NULL DEFAULT 0,

  `vars_json` mediumtext NOT NULL,

  `map_seed` varchar(64) NOT NULL DEFAULT '',
  `map_version` int unsigned NOT NULL DEFAULT 1,

  `started_at` int unsigned NOT NULL DEFAULT 0,
  `updated_at` int unsigned NOT NULL DEFAULT 0,
  `ended_at` int unsigned NOT NULL DEFAULT 0,
  `heartbeat_at` int unsigned NOT NULL DEFAULT 0,
  `last_command_at` int unsigned NOT NULL DEFAULT 0,

  `winner_pid` int unsigned NOT NULL DEFAULT 0,
  `winner_name` varchar(64) NOT NULL DEFAULT '',
  `end_reason` varchar(64) NOT NULL DEFAULT '',

  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
```

约束：

```txt
id 固定为 1
```

读取当前局：

```sql
SELECT * FROM `{$tablepre}oblgame` WHERE id = 1 LIMIT 1;
```

保存当前局：

```sql
UPDATE `{$tablepre}oblgame` SET ... WHERE id = 1;
```

字段说明：

| 字段 | 说明 |
|---|---|
| `id` | 固定为 1，表示当前房间当前单局 |
| `run_id` | 当前局唯一 ID；重开局时变化 |
| `state` | Oblivions 局状态，如 `INIT` / `READY` / `RUNNING` / `ENDED` |
| `phase` | 可选细分阶段，如 `PREPARE` / `ACTIVE` / `RESOLVING` |
| `tick` | 当前世界 tick，替代 `gamevars['obl_tick']` 主存储 |
| `processed_tick` | 已处理到的 tick，替代 `gamevars['obl_pretick']` 主存储 |
| `tick_version` | 乐观并发/调试用版本号 |
| `vars_json` | Oblivions runtime vars，不再放旧 `game.gamevars` |
| `map_seed` | 地图生成种子或版本标记 |
| `heartbeat_at` | 最近 heartbeat 时间 |
| `last_command_at` | 最近玩家命令时间 |
| `winner_pid` / `winner_name` | Oblivions 胜者信息 |

### 7.5 与旧 `$gamevars` 的兼容映射

过渡期 Runtime 仍向现有函数提供 `$gamevars`。

加载时：

```php
$gamevars = json_decode($oblGame['vars_json'], true);
$gamevars['obl_tick'] = (int)$oblGame['tick'];
$gamevars['obl_pretick'] = (int)$oblGame['processed_tick'];
$gamestate = obl_game_state_to_legacy_gamestate($oblGame['state']);
```

保存时：

```php
$oblGame['tick'] = (int)$gamevars['obl_tick'];
$oblGame['processed_tick'] = (int)$gamevars['obl_pretick'];
$oblGame['vars_json'] = json_encode(obl_gamevars_without_tick_keys($gamevars));
```

注意：

- `tick` / `processed_tick` 是 `{$tablepre}oblgame` 的主字段。
- `vars_json` 内不应重复保存 `obl_tick` / `obl_pretick`。
- 如果过渡期重复保存，也必须以表字段为准。

### 7.6 初始化策略

Oblivions 初始化流程需要创建或重置 `{$tablepre}oblgame` 表和固定 `id = 1` 的行。

目标：

```txt
obl_rs_game()
  -> 创建 / 重置 {$tablepre}oblgame
  -> 插入 / 重置 id = 1 的当前局状态行
  -> 初始化 tick = 0
  -> 初始化 processed_tick = 0
  -> 初始化 vars_json
  -> 初始化 map_seed / map_version
  -> 初始化 {$tablepre}oblplayers
```

短期可在 `obl_gamestate_try_prepare()` / `obl_gamestate_try_start()` 或新的 `obl_game_initialize()` 中执行。

长期应由 Oblivions Runtime / Game Repository 提供：

```php
obl_game_ensure_schema($ctx);
obl_game_ensure_initialized($ctx);
obl_game_reset($ctx, $options = array());
```

---

## 8. Oblivions Runtime 设计

### 8.1 Runtime 文件

新增：

```txt
D:\wamp64\www\phpdts\oblivions\include\core\obl_runtime.php
D:\wamp64\www\phpdts\oblivions\include\core\obl_request_context.php
D:\wamp64\www\phpdts\oblivions\include\core\obl_db.php
D:\wamp64\www\phpdts\oblivions\include\core\obl_auth.php
D:\wamp64\www\phpdts\oblivions\include\core\obl_room.php
D:\wamp64\www\phpdts\oblivions\include\core\obl_game_repository.php
D:\wamp64\www\phpdts\oblivions\include\core\obl_gamevars.php
D:\wamp64\www\phpdts\oblivions\include\core\obl_lock.php
D:\wamp64\www\phpdts\oblivions\include\core\obl_response.php
```

可选新增：

```txt
D:\wamp64\www\phpdts\oblivions\include\core\obl_command_api_bootstrap.php
D:\wamp64\www\phpdts\oblivions\include\core\obl_state_api_bootstrap.php
```

### 8.2 Runtime 启动入口

建议统一入口：

```php
$ctx = obl_runtime_boot('command');
```

支持类型：

| 类型 | 说明 |
|---|---|
| `command` | 写命令，需要认证玩家、加载 game state、允许 after-command tick |
| `state` | 纯读状态，需要认证玩家、加载 game state、禁止 tick 副作用 |
| `heartbeat` | 后台推进，需要认证或内部 token、加载 game state、允许 pending tick resolve |
| `valid` | 激活/入场流程，可选后续迁移 |
| `admin` | 调试/管理流程，可选 |

### 8.3 Request Context 结构

PHP 5/旧项目兼容考虑，可先用数组结构：

```php
$ctx = array(
    'kind' => 'command',
    'now' => $now,
    'db' => $db,
    'gtablepre' => $gtablepre,
    'tablepre' => $tablepre,
    'cuser' => $cuser,
    'cpass' => $cpass,
    'udata' => $udata,
    'groomid' => $groomid,
    'room' => $room,
    'is_oblivions' => true,
    'obl_game' => $oblGame,
    'gamevars' => $gamevars,
    'locks' => array(),
    'loggers' => array(
        'obl_log' => $obl_log,
        'obl_error_log' => $obl_error_log,
        'obl_battle_log' => $obl_battle_log,
    ),
);
```

后续可演进为类，但第一阶段数组更贴合现有代码。

### 8.4 Runtime 启动步骤

```txt
obl_runtime_boot($kind)
  1. 定义 IN_GAME / GAME_ROOT / GAMENAME
  2. chdir(GAME_ROOT)，兼容旧相对路径 require
  3. 加载最小旧基础函数或 Oblivions 替代函数
  4. 加载 config.inc.php
  5. 初始化 error handler / timezone / now
  6. 初始化 DB
  7. 读取 cookie 登录态，不 extract POST/GET
  8. debug autologin
  9. 读取用户 udata
 10. 解析 groomid
 11. 设置 gtablepre / tablepre
 12. 查询旧 game 表作为 Room Registry
 13. 校验 gruleset === OBLIVIONS
 14. 加载 / 初始化 {$tablepre}oblgame
 15. 映射 gamevars / gamestate 兼容 globals
 16. 加载 oblivions/include/core/obl_bootstrap.php
 17. 初始化 Oblivions loggers
 18. 根据 kind 执行权限策略
 19. bind globals
 20. 返回 ctx
```

### 8.5 禁止 Runtime 的旧行为

新 Runtime 不应执行：

```php
extract(gstrfilter($_POST), EXTR_SKIP);
extract(gstrfilter($_GET), EXTR_SKIP);
```

原因：

- JSON Command API 已经有明确 envelope。
- State API 应该显式读取 query。
- Heartbeat API 应该显式读取 body 或无 body。
- 避免请求参数污染全局变量。

新 Runtime 也不应自动执行：

- pending tick 解析。
- NPC AI。
- battle stale recovery。
- 旧核心状态机。
- 旧 `save_gameinfo()`。

这些应由具体 API 或 Tick Orchestrator 显式调用。

### 8.6 Runtime 与 `common.inc.php` 的关系

新 Oblivions API 禁止 require：

```php
D:\wamp64\www\phpdts\include\core\common.inc.php
```

允许短期 require 的旧基础文件包括：

```txt
D:\wamp64\www\phpdts\include\core\global.func.php
D:\wamp64\www\phpdts\include\auth\user.func.php
D:\wamp64\www\phpdts\include\db\db_{database}.class.php
D:\wamp64\www\phpdts\config.inc.php
```

但新增代码不应调用旧：

```php
load_gameinfo();
save_gameinfo();
```

而应调用：

```php
obl_game_load($groomid);
obl_game_save($ctx);
obl_gamevars_get($ctx, $key);
obl_gamevars_set($ctx, $key, $value);
```

---

## 9. Game Repository / Gamevars 设计

### 9.1 文件职责

```txt
obl_game_repository.php
  - 创建 {$tablepre}oblgame
  - load/save 一房间一行状态
  - 初始化 / 重置游戏局
  - state 转换

obl_gamevars.php
  - 从 ctx 读取 / 写入 gamevars
  - tick 字段兼容映射
  - vars_json 编解码
```

### 9.2 建议函数

```php
obl_game_table_name();
obl_game_schema_ensure();
obl_game_load($groomid);
obl_game_create($groomid, $defaults = array());
obl_game_ensure($groomid);
obl_game_save($ctx);
obl_game_touch($ctx, $field);
obl_game_mark_command($ctx);
obl_game_mark_heartbeat($ctx);
obl_game_set_state($ctx, $state, $phase = null);
```

Gamevars：

```php
obl_gamevars_decode($varsJson);
obl_gamevars_encode($gamevars);
obl_gamevars_get($ctx, $key, $default = null);
obl_gamevars_set(&$ctx, $key, $value);
obl_gamevars_export_to_globals($ctx);
obl_gamevars_import_from_globals(&$ctx);
```

### 9.3 Legacy gamestate 映射

为兼容现有函数，可临时映射：

| `{$tablepre}oblgame.state` | legacy `$gamestate` 建议值 | 说明 |
|---|---:|---|
| `INIT` | 0 | 未准备 |
| `READY` | 10 | 准备完成 |
| `RUNNING` | 20 | 游戏中；对齐当前 `obl_gamestate_try_start()` 的 `$gamestate = 20` |
| `ENDED` | 50 | 已结束 |

注意：

- 这是过渡兼容，不鼓励新代码依赖 `$gamestate`。
- 新代码应读取 `ctx['obl_game']['state']`。

### 9.4 Tick 主存储

`{$tablepre}oblgame.tick` 与 `{$tablepre}oblgame.processed_tick` 是主存储。

`$gamevars['obl_tick']` / `$gamevars['obl_pretick']` 只是旧函数兼容镜像。

Tick Orchestrator 在保存前必须执行：

```php
obl_gamevars_import_from_globals($ctx);
obl_game_save($ctx);
```

或提供统一函数：

```php
obl_game_save_from_runtime($ctx);
```

---

## 10. Tick Orchestrator 设计

### 10.1 文件

新增：

```txt
D:\wamp64\www\phpdts\oblivions\include\core\obl_tick_orchestrator.php
```

### 10.2 与 `tick.func.php` 的分工

| 层 | 文件 | 职责 |
|---|---|---|
| Tick Engine | `oblivions/include/game/tick.func.php` | tick 原语、listener、dispatch、resolve |
| Tick Orchestrator | `oblivions/include/core/obl_tick_orchestrator.php` | 决定何时推进、何时结算、何时保存、何时锁 |

`tick.func.php` 可以保留现有函数：

```php
obl_tick_advance();
obl_tick_synchronize();
obl_tick_get();
obl_tick_get_pretick();
obl_resolve_tick_events($delta);
obl_tick_has_busy_battle();
```

但新代码不应从 Command Bus 或 API 入口直接调用这些函数，而应通过 Orchestrator。

### 10.3 建议函数

```php
obl_tick_orchestrator_after_command(&$ctx, $command, $contract, &$pdata, $dispatched);
obl_tick_orchestrator_heartbeat(&$ctx, $options = array());
obl_tick_orchestrator_resolve_pending(&$ctx, $reason = 'heartbeat');
obl_tick_orchestrator_advance_from_player_command(&$ctx, $command, $contract, &$pdata);
obl_tick_orchestrator_refresh_battle_after_command(&$ctx, &$pdata);
obl_tick_orchestrator_recover_stale_battles(&$ctx, $ttl = 30);
obl_tick_orchestrator_status($ctx);
```

### 10.4 after-command 流程

玩家命令成功后：

```txt
obl_tick_orchestrator_after_command(ctx, command, contract, pdata, dispatched)
  1. obl_save_player(pdata)
  2. 如果未 dispatched：只保存必要日志，不推进
  3. 如果 escape_skip_tick：不推进
  4. 如果 contract.advances_tick：
       - 确认当前已在 room lock 内；若未持有，则先获取并重新加载最新 game state
       - 绑定最新 game state 到 globals
       - obl_tick_advance()
       - tick_version++
       - last_command_at = now
       - 如果玩家 battle state 是 PROCESSING：refresh
       - 保存 {$tablepre}oblgame
  5. 返回 tick_advanced / server_state
```

设计选择：

- `after_command` 只负责玩家行为产生 tick。
- 是否立即 resolve pending tick 可以配置，但默认不在 command 请求内做完整 NPC 结算。
- NPC / battle PROCESSING 后续由 `heartbeat.php` 显式推进。

这样避免单个玩家命令请求过重，也能保持“玩家动作”和“后台结算”边界清楚。

### 10.5 heartbeat 流程

```txt
POST /oblivions/api/heartbeat.php
  -> obl_runtime_boot('heartbeat')
  -> 获取 room lock
  -> 重新加载 {$tablepre}oblgame
  -> 如果 processed_tick < tick：
       delta = tick - processed_tick
       obl_tick_synchronize()
       obl_resolve_tick_events(delta)
       obl_tick_orchestrator_recover_stale_battles()
       保存 {$tablepre}oblgame
  -> heartbeat_at = now
  -> 返回 tick 状态
```

heartbeat 可以由：

- 前端 battle PROCESSING 轮询调用。
- 地图页面定时低频调用。
- 后续 CLI / cron 调用。

### 10.6 state 纯读流程

```txt
GET /oblivions/api/state.php?scope=player_info,game_map,...
  -> obl_runtime_boot('state')
  -> 不获取 tick resolve lock，除非读取需要一致快照
  -> 不调用 Tick Orchestrator resolve
  -> 聚合当前持久化状态
  -> 返回 JSON
```

可以返回 tick 状态，但不能改变 tick 状态：

```json
{
  "tick": 12,
  "processed_tick": 11,
  "pending_tick": true
}
```

前端看到 `pending_tick=true` 时，可以决定调用 heartbeat。

### 10.7 stale battle recovery

当前 stale battle recovery 在 `common.inc.php`：

```php
obl_battle_state_find_stale(30, OBL_BS_PROCESSING)
obl_battle_state_reset($qid, OBL_BS_PLAYER_TURN)
```

应迁移到：

```php
obl_tick_orchestrator_recover_stale_battles($ctx, 30)
```

只允许在：

- `heartbeat.php`
- 可选的 admin repair API

中执行。

禁止在：

- `state.php`
- 纯读请求

中执行。

---

## 11. 锁策略

### 11.1 当前锁

当前存在两类锁：

| 锁 | 位置 | 粒度 | 用途 |
|---|---|---|---|
| DB `GET_LOCK('game_state_x')` | `common.inc.php` | 房间 | 保护 gameinfo / tick / 状态机 |
| `flock` 玩家锁 | `obl_command_bus.php` | 玩家 | 防同一玩家并发命令 |

### 11.2 目标锁

新 Runtime 应提供：

```php
obl_lock_room($groomid, $timeout = 5);
obl_unlock_room($lock);
obl_lock_player($groomid, $pid);
obl_unlock_player($lock);
```

策略：

| 场景 | room lock | player lock |
|---|---:|---:|
| `command.php` 执行业务 handler | 可不全程持有 | 是 |
| `command.php` 保存玩家 | 否/视情况 | 是 |
| `command.php` 推进 tick | 是 | 是 |
| `heartbeat.php` resolve pending tick | 是 | 否 |
| `state.php` 纯读 | 默认否 | 否 |
| admin repair | 是 | 视情况 |

### 11.3 锁顺序

为避免死锁，统一锁顺序：

```txt
先 room lock，后 player lock
```

但 command handler 目前已经有玩家锁。若 after-command 才需要 room lock，可能形成未来风险。

目标 command 锁定流程：

```txt
command.php
  -> authenticate player
  -> acquire room lock
  -> acquire player lock
  -> reload game state from {$tablepre}oblgame
  -> reload player state
  -> dispatch command
  -> after-command tick
  -> save player / logs / game state
  -> release player lock
  -> release room lock
```

如果担心 room lock 持有时间过长，可第一阶段保持玩家锁在外，但文档应标记技术债。

本设计推荐一步到位使用统一顺序：

```txt
room lock -> player lock
```

### 11.4 使用 DB lock 还是文件锁

room lock 建议继续使用 MySQL `GET_LOCK`：

```sql
SELECT GET_LOCK('obl_game_state_{groomid}', 5)
```

原因：

- 当前旧核心已有类似机制。
- 跨 PHP 进程有效。
- 适合保护 DB 中的 `{$tablepre}oblgame`。

player lock 可继续使用 `flock`，也可以迁移为 DB lock：

```sql
SELECT GET_LOCK('obl_player_{groomid}_{pid}', 2)
```

为统一，推荐最终也迁移 DB lock。

---

## 12. API 入口设计

### 12.1 `oblivions/api/command.php`

职责：

- 只处理 JSON Command API。
- 不 require `common.inc.php`。
- 启动 `obl_runtime_boot('command')`。
- 读取 JSON envelope。
- 调用 `obl_command_api_handle($ctx, $envelope)`。
- Command Bus 执行业务，不直接保存 gameinfo。
- Tick Orchestrator 处理 after-command tick。

目标骨架：

```php
define('CURSCRIPT', 'obl_command');
require_once dirname(__DIR__) . '/include/core/obl_runtime.php';

$ctx = obl_runtime_boot('command');
obl_runtime_load_command_api($ctx);

$envelope = obl_json_request_read_or_fail();
$response = obl_command_api_handle($ctx, $envelope);
obl_response_emit($response);
```

### 12.2 `oblivions/api/state.php`

职责：

- 替代 Oblivions 对 `api_v2.php?action=xxx` 的只读依赖。
- 纯读。
- 支持 scope 聚合。

示例：

```txt
GET /phpdts/oblivions/api/state.php?scope=player_info,game_map,tile_actions
```

响应：

```json
{
  "ok": true,
  "data": {
    "player_info": {},
    "game_map": {},
    "tile_actions": {},
    "runtime": {
      "tick": 12,
      "processed_tick": 11,
      "pending_tick": true
    }
  }
}
```

### 12.3 `oblivions/api/heartbeat.php`

职责：

- 显式推进 pending tick。
- 替代 `api_v2.php?action=heartbeat`。
- 前端 battle PROCESSING 时调用。

建议使用 POST：

```txt
POST /phpdts/oblivions/api/heartbeat.php
```

响应：

```json
{
  "ok": true,
  "data": {
    "resolved": true,
    "delta": 1,
    "tick": 13,
    "processed_tick": 13,
    "battle_busy": false,
    "refresh": ["player_info", "battle_log", "enemies"]
  }
}
```

### 12.4 `valid.php` 后续迁移

当前：

```txt
D:\wamp64\www\phpdts\oblivions\valid.php
```

承担 Oblivions 入场/激活流程，仍可能依赖旧初始化。

本阶段可以不优先改，但新 `{$tablepre}oblgame` 初始化必须与 valid / game start 流程对齐。

后续可迁移为：

```txt
D:\wamp64\www\phpdts\oblivions\api\valid.php
```

或由 Runtime kind `valid` 支持。

---

## 13. Command Bus 调整

当前：

```php
obl_command_api_handle($envelope)
```

建议改为：

```php
obl_command_api_handle(&$ctx, $envelope)
```

需要调整：

1. 认证不再从 `global $cuser, $cpass` 隐式读，改从 ctx 读取。
2. 锁由 Runtime/Lock 层提供。
3. `obl_command_save_and_tick()` 改名或移除。
4. 保存玩家保留在 Command Bus 或交给 after-command 统一处理。
5. `save_gameinfo()` 调用移除。
6. tick advance 改为：

```php
obl_tick_orchestrator_after_command($ctx, $command, $contract, $pdata, $dispatched);
```

当前函数：

```php
obl_command_save_and_tick()
```

应拆分为：

```php
obl_command_save_player_after_dispatch();
obl_tick_orchestrator_after_command();
```

或完全由 Orchestrator 包含保存玩家步骤。

---

## 14. State API 迁移范围

前端当前仍使用：

```txt
GET /phpdts/api_v2.php?action=xxx
```

读取以下 scope：

| 旧 action | 新 scope |
|---|---|
| `player_info` | `player_info` |
| `game_map` | `game_map` |
| `tile_actions` | `tile_actions` |
| `player_inventory` | `player_inventory` |
| `skill_list` | `skill_list` |
| `obl_log` | `obl_log` |
| `obl_error` | `obl_error` |
| `battle_log` | `battle_log` |
| `enemies` | `enemies` |
| `craft_preview` | `craft_preview` |
| `craft_workbench_materials` | `craft_workbench_materials` |

新 `state.php` 可以第一阶段直接复用原 `api_v2.php` 中对应 action 的内部逻辑，但必须避免加载 `common.inc.php` 和避免 tick 副作用。

建议新增：

```txt
D:\wamp64\www\phpdts\oblivions\include\state\obl_state_handlers.php
D:\wamp64\www\phpdts\oblivions\include\state\obl_state_contract.php
```

与 Command API 类似建立 state scope contract。

---

## 15. 前端迁移

### 15.1 command

已完成：

```txt
vex-vue commandQueue.execute(envelope)
  -> src/api/obl-command.ts
  -> POST /phpdts/oblivions/api/command.php
```

后续只需保持路径不变，后端内部切换 Runtime。

### 15.2 heartbeat

当前：

```ts
fetch(`${apiBase}/api_v2.php?action=heartbeat`, { credentials: 'include' })
```

目标：

```ts
fetch(`${apiBase}/oblivions/api/heartbeat.php`, {
  method: 'POST',
  credentials: 'include',
})
```

### 15.3 state

当前：

```ts
GET /api_v2.php?action=player_info
```

目标可分两步：

#### 阶段 A：保留 dataManager action 语义，换 base endpoint

```txt
GET /oblivions/api/state.php?scope=player_info
```

前端改动较小。

#### 阶段 B：支持聚合 scope

```txt
GET /oblivions/api/state.php?scope=player_info,game_map,tile_actions
```

减少多次请求。

---

## 16. 三大实施阶段

本任务不建议一次性同时完成“数据表拆分 + Runtime 解耦 + Tick Orchestrator 重构”。

虽然项目当前没有历史用户和旧数据负担，可以大胆重构，但这三个改动属于不同风险域：

| 风险域 | 典型问题 |
|---|---|
| 数据表职能分离 | 表结构、初始化、gamevars 映射、tick 主存储不一致 |
| Runtime 解耦 | DB / auth / room / globals 初始化缺失，旧 include 依赖暴露 |
| Tick Orchestrator | command 后推进、heartbeat resolve、NPC / battle PROCESSING 调度错误 |

因此实施拆成三个大阶段：

```txt
阶段一：分离数据表职能
阶段二：从 common.inc.php 分离 Runtime，但沿用原 tick engine
阶段三：实现 Oblivions 自己的 Tick Orchestrator
```

---

### 阶段一：分离数据表职能

目标：

```txt
旧 {$gtablepre}game
  -> 继续承担房间编号索引 / 统一房间管理 / ruleset 判断

新 {$tablepre}oblgame
  -> 接管旧 game 表中与 Oblivions 单局运行有关的状态：tick / processed_tick / vars_json / state / phase / winner
```

本阶段 **不移除 `common.inc.php`**，也 **不重构 tick 调度模型**。请求仍可经过旧 runtime，但 Oblivions 单局状态的 source of truth 开始迁移到 `{$tablepre}oblgame`。

#### 主要任务

- 新建 `{$tablepre}oblgame` schema ensure。
- 新建：
  - `D:\wamp64\www\phpdts\oblivions\include\core\obl_game_repository.php`
  - `D:\wamp64\www\phpdts\oblivions\include\core\obl_gamevars.php`
- 在 `obl_rs_game()` / 初始化流程中创建或重置 `{$tablepre}oblgame`。
- 固定插入 / 重置 `id = 1` 的当前局状态行。
- 建立 `{$tablepre}oblgame.tick` / `processed_tick` 与旧 `$gamevars['obl_tick']` / `$gamevars['obl_pretick']` 的兼容镜像。
- 明确 `{$tablepre}oblgame` 是主存储，`$gamevars` 只是过渡兼容镜像。

#### 暂不处理

- 暂不移除 `common.inc.php`。
- 暂不迁移 `command.php` Runtime。
- 暂不实现完整 Tick Orchestrator。
- 暂不迁移所有 state 读接口。

#### 验收

- 新房间启动后存在 `{$tablepre}oblgame` 表。
- 表内存在固定行 `id = 1`。
- 初始：
  - `tick = 0`
  - `processed_tick = 0`
  - `vars_json` 可读写
- 探索、战斗、合成仍成功。
- 玩家命令后 `{$tablepre}oblgame.tick` 能与旧 `$gamevars['obl_tick']` 保持一致。
- 旧 `game.gamevars` 不再是 Oblivions tick 的权威来源。

---

### 阶段二：Runtime 从 `common.inc.php` 解耦，但沿用原 tick engine

目标：

```txt
Oblivions API 不再 require common.inc.php。
Oblivions 拥有自己的 Runtime / Request Context。
但 tick 机制仍复用现有 tick.func.php 的 engine 逻辑。
```

本阶段只改变“谁来初始化请求生命周期”，不改变 tick engine 的业务行为。

#### 主要任务

- 新建最小 Runtime：
  - `D:\wamp64\www\phpdts\oblivions\include\core\obl_runtime.php`
  - `D:\wamp64\www\phpdts\oblivions\include\core\obl_request_context.php`
  - `D:\wamp64\www\phpdts\oblivions\include\core\obl_db.php`
  - `D:\wamp64\www\phpdts\oblivions\include\core\obl_auth.php`
  - `D:\wamp64\www\phpdts\oblivions\include\core\obl_room.php`
  - `D:\wamp64\www\phpdts\oblivions\include\core\obl_lock.php`
- Runtime 完成：
  - `IN_GAME` / `GAME_ROOT` 定义。
  - `chdir(GAME_ROOT)`。
  - config / DB 初始化。
  - cookie 登录态读取。
  - debug autologin。
  - user / room / ruleset 查询。
  - `$gtablepre` / `$tablepre` 设置。
  - `{$tablepre}oblgame` 加载。
  - `$gamevars` / `$gamestate` 兼容绑定。
  - `obl_bootstrap.php` 加载。
  - loggers 初始化。
- `oblivions/api/command.php` 改为使用 `obl_runtime_boot('command')`。
- 新增 `oblivions/api/heartbeat.php`，显式触发 pending tick resolve。
- heartbeat 阶段可以使用“legacy tick runner”：

```php
if ($gamevars['obl_pretick'] < $gamevars['obl_tick']) {
    $delta = $gamevars['obl_tick'] - $gamevars['obl_pretick'];
    obl_tick_synchronize();
    obl_resolve_tick_events($delta);
}
```

也就是说，第二阶段仍复用：

```php
obl_tick_advance();
obl_tick_synchronize();
obl_resolve_tick_events($delta);
obl_battle_state_find_stale();
obl_battle_state_reset();
```

#### 暂不处理

- 暂不要求 Command Bus 完全不接触 tick 原语。
- 暂不要求 state API 全量迁移。
- 暂不删除 `common.inc.php` 中旧 Oblivions tick 副作用。
- 暂不实现最终 Tick Orchestrator API。

#### 验收

- `D:\wamp64\www\phpdts\oblivionspi\command.php` 不再 require：

```txt
D:\wamp64\www\phpdts\include\core\common.inc.php
```

- Runtime 可正确获取当前用户、房间、ruleset、玩家、`{$tablepre}oblgame`。
- 探索、战斗、合成仍成功。
- command 成功后仍能推进 tick。
- `oblivions/api/heartbeat.php` 能触发原有 pending tick resolve。
- battle PROCESSING 可恢复。
- 前端 heartbeat 开始从：

```txt
api_v2.php?action=heartbeat
```

迁移到：

```txt
oblivions/api/heartbeat.php
```

---

### 阶段三：实现 Oblivions 自己的 Tick Orchestrator

目标：

```txt
tick 推进策略完全由 Oblivions 自己的 Tick Orchestrator 管理。
Command Bus / common.inc.php / state read 不再分散推进 tick。
```

本阶段才正式建立最终调度层：

```txt
D:\wamp64\www\phpdts\oblivions\include\core\obl_tick_orchestrator.php
```

#### 主要任务

- 新建完整 Tick Orchestrator：

```php
obl_tick_orchestrator_after_command($ctx, $command, $contract, $pdata, $dispatched);
obl_tick_orchestrator_heartbeat($ctx);
obl_tick_orchestrator_resolve_pending($ctx, $reason = 'heartbeat');
obl_tick_orchestrator_recover_stale_battles($ctx, $ttl = 30);
obl_tick_orchestrator_status($ctx);
```

- Command Bus 不再直接调用：

```php
obl_tick_advance();
save_gameinfo();
```

- `heartbeat.php` 成为 pending tick / NPC / battle PROCESSING 的唯一常规推进入口。
- 新增或完善 `oblivions/api/state.php`：
  - 纯读。
  - 不 resolve pending tick。
  - 只返回 `pending_tick=true` 等状态提示。
- 前端 `dataManager` 迁移常用只读 scope 到 `state.php`。
- 当 Oblivions 前端不再依赖旧 `api_v2.php` 后，移除或禁用 `common.inc.php` 中 Oblivions pending tick 副作用。

#### 验收

- Command Bus 不再直接推进 tick 或保存旧 gameinfo。
- `state.php` 请求不推进 tick。
- `heartbeat.php` 是唯一常规后台 tick resolve 入口。
- `{$tablepre}oblgame.tick` / `processed_tick` 完全由 Tick Orchestrator 管理。
- `common.inc.php` 不再承担 Oblivions tick 解析职责。
- 前端不再调用：

```txt
api_v2.php?action=heartbeat
```

- 地图、玩家、背包、日志、战斗日志仍正常刷新。
- 探索、战斗、合成仍成功。

---

### 阶段间依赖关系

```txt
阶段一完成后：
  有独立单房间 game state 表，但请求生命周期仍可走 common.inc.php。

阶段二完成后：
  Oblivions API 脱离 common.inc.php，但 tick 业务行为仍沿用旧 tick.func.php engine。

阶段三完成后：
  tick 策略和调度也完全属于 Oblivions，common.inc.php / api_v2.php 不再服务 Oblivions 新流程。
```

---

## 17. 风险与处理

### 17.1 旧函数依赖 `$gamevars`

风险：domain functions 仍直接读写 `$gamevars`。

处理：Runtime 绑定 globals，保存前从 globals 回收。

### 17.2 `config()` 依赖 `$gruleset`

风险：不加载 `common.inc.php` 后 `$gruleset` 未设置。

处理：Runtime 从旧 `game` 表读取 room 后设置 `$gruleset`。

### 17.3 相对路径 require

风险：旧文件可能使用 `./include/...`。

处理：Runtime 启动时：

```php
chdir(GAME_ROOT);
```

### 17.4 锁顺序变化

风险：command 同时涉及 player lock 和 room lock。

处理：统一顺序 room lock -> player lock。

### 17.5 tick 双写

风险：过渡期 `gamevars['obl_tick']` 和 `{$tablepre}oblgame.tick` 不一致。

处理：以 `{$tablepre}oblgame.tick` 为主，Runtime load 时覆盖 `$gamevars` 镜像。

### 17.6 state API 误触发副作用

风险：迁移旧 `api_v2.php` action 时带入隐式处理。

处理：state handler contract 标记 `pure_read=true`，禁止调用 orchestrator。

### 17.7 valid/init 流程遗漏

风险：只改 command/heartbeat，忘记开局初始化新表。

处理：阶段一优先接入 init 流程，command Runtime 如果找不到 `{$tablepre}oblgame` 行应返回明确错误或自动 ensure。

---

## 18. 验证方案

### 18.1 静态检查

```powershell
cd D:\wamp64\www\phpdts
php -l oblivions/api/command.php
php -l oblivions/api/state.php
php -l oblivions/api/heartbeat.php
php -l oblivions/include/core/obl_runtime.php
php -l oblivions/include/core/obl_tick_orchestrator.php
php -l oblivions/include/core/obl_game_repository.php
php -l oblivions/include/core/obl_gamevars.php
```

### 18.2 前端检查

```powershell
cd D:\wamp64\www\phpdts\vex-vue
npm run type-check
npm run build
```

### 18.3 功能验收

- 进入 Oblivions 房间。
- 探索成功。
- 移动成功。
- 搜索 POI 成功。
- 拾取 / 丢弃 / 使用物品成功。
- 合成成功。
- 战斗开始成功。
- 提交战斗动作队列成功。
- battle PROCESSING 后 heartbeat 推进成功。
- NPC 行动日志出现。
- 战斗日志可播放并标记 played。
- state 请求不推进 tick。
- 刷新页面后状态正确。

### 18.4 数据验收

- `bra_game` 仍能判断 room / ruleset。
- `{$tablepre}oblgame` 有当前房间行。
- 玩家命令后 `{$tablepre}oblgame.tick` 增加。
- heartbeat 后 `processed_tick` 追上 `tick`。
- 旧 `game.gamevars` 不再作为 Oblivions tick 主存储。

---

## 19. 最终目标状态

最终架构应为：

```txt
旧核心：
  common.inc.php
  command.php
  api_v2.php
  {$gtablepre}game（默认 bra_game）
    -> 旧模式继续使用
    -> 对 Oblivions 当前保留 Room Registry / ruleset 判断

Oblivions：
  oblivions/api/command.php
  oblivions/api/state.php
  oblivions/api/heartbeat.php
  oblivions/include/core/obl_runtime.php
  oblivions/include/core/obl_tick_orchestrator.php
  {$tablepre}oblgame（例如 bra_s1_oblgame）
  {$tablepre}oblplayers（例如 bra_s1_oblplayers）
```

用户写操作：

```txt
vex-vue -> oblivions/api/command.php -> Command Bus -> Tick Orchestrator after-command
```

用户读操作：

```txt
vex-vue -> oblivions/api/state.php -> pure read
```

后台推进：

```txt
vex-vue / cron -> oblivions/api/heartbeat.php -> Tick Orchestrator resolve pending
```

此时 Oblivions 不再依赖 `common.inc.php` 的请求副作用，不再依赖旧 `game.gamevars` 存储 tick，也不再通过旧 `api_v2.php` heartbeat 推进战斗/NPC 流程。

---

## 20. 设计复核修订记录（2026-07-08）

扩写后已重新阅读全文，并按当前代码事实与最新表职责判断修订以下问题：

0. **三大阶段拆分确认**  
   实施顺序调整为：先分离数据表职能；再从 `common.inc.php` 解耦 Runtime 但沿用原 tick engine；最后实现独立 Tick Orchestrator。这样可以分别隔离数据、Runtime、tick 调度三类风险。

1. **game 表职责重新确认**  
   旧 `{$gtablepre}game` 当前仍保留房间编号索引与统一房间管理职能；Oblivions 第一阶段不急于新建全局房间管理表，避免两个 Room Registry 并存。

2. **全局 `obl_games` 方案废弃**  
   原 `{$gtablepre}obl_games` 方案经复核后更像 Oblivions 专属 room management / room index 表，而不是单房间 runtime state 真值源。因此不再作为主状态表推荐。

3. **未来 `obl_roommng` 定位确认**  
   如果未来需要让 Oblivions 完全接替旧 `game` 表的房间管理职能，可新增 `{$gtablepre}obl_roommng` 或类似表；它负责房间索引/管理，不保存单局 tick/gamevars。

4. **单局状态表修订**  
   旧 `game` 表中的游戏内状态、gamevars、tick 等迁移到 `{$tablepre}oblgame`，默认物理名如 `bra_s1_oblgame`。该表严格对应当前房间当前单局，一表一行，`id = 1`。

5. **legacy gamestate 映射修订**  
   当前 `D:\wamp64\www\phpdts\oblivions\include\gamectl\state.func.php` 中 `obl_gamestate_try_start()` 使用 `$gamestate = 20` 表示 Oblivions 已开始，因此 `RUNNING` 的兼容映射应为 `20`，不是旧模式常见的 `40`。

6. **锁顺序一致性修订**  
   Command API 目标流程应在 dispatch 前按 `room lock -> player lock` 获取锁，并在锁内 reload game/player state；Tick Orchestrator after-command 默认在 room lock 内运行。

7. **`common.inc.php` 解耦边界确认**  
   新 Runtime 可以短期复用 `global.func.php`、`user.func.php`、DB class、`config.inc.php` 等旧基础文件，但不能 require `common.inc.php`，也不能调用旧 `load_gameinfo()` / `save_gameinfo()` 作为 Oblivions 新流程的一部分。

8. **state 纯读边界确认**  
   `state.php` 即使发现 `processed_tick < tick`，也只返回 `pending_tick=true`，不得自动调用 heartbeat 或 tick resolve。
