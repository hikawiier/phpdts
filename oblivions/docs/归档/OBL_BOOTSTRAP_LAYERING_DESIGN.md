# Oblivions Bootstrap 分层整理设计案

> 状态：已执行。  
> 背景：Oblivions 已完成 Command API、Runtime / Tick、State API 独立化；当前局内运行期不再依赖旧 `command.php` / `api_v2.php` / `common.inc.php` 请求生命周期。随着新入口和新模块增加，依赖加载仍散落在各入口文件中，存在后续维护风险。  
> 目标：整理 Oblivions 新系统的 require / bootstrap 分层，不改变业务逻辑，只统一加载边界、降低漏加载和职责漂移风险。

---

## 1. 当前问题

当前 Oblivions 新运行期入口主要是：

```txt
D:\wamp64\www\phpdts\oblivions\api\command.php
D:\wamp64\www\phpdts\oblivions\api\heartbeat.php
D:\wamp64\www\phpdts\oblivions\api\state.php
```

它们分别手动加载部分依赖：

```php
require_once GAME_ROOT . './oblivions/include/core/obl_runtime.php';
require_once GAME_ROOT . './oblivions/include/core/obl_json_request.php';
require_once GAME_ROOT . './oblivions/include/core/obl_command_response.php';
require_once GAME_ROOT . './oblivions/include/command/obl_command_bus.php';
require_once GAME_ROOT . './oblivions/include/api/obl_state_response.php';
require_once GAME_ROOT . './oblivions/include/api/obl_state_handlers.php';
require_once GAME_ROOT . './oblivions/include/core/obl_tick_orchestrator.php';
```

虽然当前测试通过，但继续扩展后会出现隐患：

```txt
入口依赖漂移
加载顺序不一致
漏 require
纯读/写入边界被破坏
死代码判断困难
维护者误判入口职责
```

---

## 2. 核心判断

不建议把所有文件都塞进一个巨大 `obl_bootstrap.php`。

原因：

```txt
state.php 不应该加载 command bus
command.php 不应该加载 state handlers
heartbeat.php 不需要 state handlers
纯读入口不应无意加载带写入副作用的模块
```

更合理的是 **分层 bootstrap**：

```txt
Runtime 层：基础运行期
Domain 层：游戏领域函数库
API Shared 层：API 通用能力
Command API 层：命令写入相关依赖
State API 层：只读状态相关依赖
Heartbeat 层：tick 推进相关依赖
```

---

## 3. 设计目标

### 3.1 统一依赖入口

让每个 API 入口只 require 一个或少数几个清晰 bootstrap 文件，而不是散落加载具体实现文件。

目标形态：

```php
// command.php
require_once GAME_ROOT . './oblivions/include/api/obl_command_api_bootstrap.php';

// heartbeat.php
require_once GAME_ROOT . './oblivions/include/api/obl_heartbeat_api_bootstrap.php';

// state.php
require_once GAME_ROOT . './oblivions/include/api/obl_state_api_bootstrap.php';
```

### 3.2 保持职责边界

```txt
command bootstrap 只加载写命令需要的依赖
state bootstrap 只加载纯读 state 需要的依赖
heartbeat bootstrap 只加载 tick 推进需要的依赖
```

### 3.3 不改变业务逻辑

本任务只整理加载方式，不修改：

```txt
Command API 契约
State API 响应结构
Tick Orchestrator 推进规则
Command Bus dispatch 逻辑
battle state machine
state handlers 业务字段
```

### 3.4 降低未来清理成本

未来判断某个文件是否还活着时，可以优先检查 bootstrap，而不是全项目散搜。

---

## 4. 非目标

本任务不处理：

```txt
不重构 Room / Lifecycle
不删除旧 command.php
不删除 common.inc.php
不修改旧模式入口
不重写领域函数
不引入 Composer autoload
不引入框架
不改变数据库结构
不改变前端请求路径
```

---

## 5. 建议文件规划

### 5.1 保留现有 Runtime 与 Domain Bootstrap

现有：

```txt
D:\wamp64\www\phpdts\oblivions\include\core\obl_runtime.php
D:\wamp64\www\phpdts\oblivions\include\core\obl_bootstrap.php
```

职责继续保持：

```txt
obl_runtime.php
  - IN_GAME / GAME_ROOT 基础
  - config / DB / cookie / user / room
  - tablepre / gtablepre / groomid
  - gamevars / oblgame 同步
  - logger 初始化

obl_bootstrap.php
  - Oblivions domain/game 函数库
  - player / map / battle / item / skill / tick / gamectl
```

### 5.2 新增 API Shared Bootstrap

新增：

```txt
D:\wamp64\www\phpdts\oblivions\include\api\obl_api_bootstrap.php
```

职责：

```txt
加载所有 API 入口共用的小工具
统一 fatal handler 注册工具
统一 OPTIONS / method helper（可选）
统一 JSON content-type helper（可选）
```

第一阶段可以只做轻量 require，不强行抽公共函数。

可能加载：

```php
require_once GAME_ROOT . './oblivions/include/core/obl_runtime.php';
```

可选提供函数：

```php
obl_api_register_fatal_json_handler($emit_error_callable);
obl_api_handle_options($methods, $headers);
obl_api_require_method($method, $emit_error_callable);
```

但如果抽函数会扩大改动，可以暂缓。

### 5.3 新增 Command API Bootstrap

新增：

```txt
D:\wamp64\www\phpdts\oblivions\include\api\obl_command_api_bootstrap.php
```

职责：

```txt
加载 Command API 所需依赖
不加载 State handlers
```

建议内容：

```php
require_once GAME_ROOT . './oblivions/include/api/obl_api_bootstrap.php';
require_once GAME_ROOT . './oblivions/include/core/obl_json_request.php';
require_once GAME_ROOT . './oblivions/include/core/obl_command_response.php';
require_once GAME_ROOT . './oblivions/include/command/obl_command_bus.php';
```

入口 `command.php` 之后仍负责：

```txt
obl_runtime_boot('command')
检查 POST
检查 Oblivions 模式
读 JSON envelope
获取房间锁
调用 obl_command_api_handle()
```

### 5.4 新增 Heartbeat API Bootstrap

新增：

```txt
D:\wamp64\www\phpdts\oblivions\include\api\obl_heartbeat_api_bootstrap.php
```

职责：

```txt
加载 heartbeat / tick 推进所需依赖
不加载 State handlers
不加载 Command Bus
```

建议内容：

```php
require_once GAME_ROOT . './oblivions/include/api/obl_api_bootstrap.php';
require_once GAME_ROOT . './oblivions/include/core/obl_command_response.php';
require_once GAME_ROOT . './oblivions/include/core/obl_tick_orchestrator.php';
```

说明：

`heartbeat.php` 目前复用 `obl_command_response.php` 输出 `{status, code, message, data}`。短期可保留，不必为了命名洁癖引入新 response。

### 5.5 新增 State API Bootstrap

新增：

```txt
D:\wamp64\www\phpdts\oblivions\include\api\obl_state_api_bootstrap.php
```

职责：

```txt
加载 State API 纯读依赖
不加载 Command Bus
```

建议内容：

```php
require_once GAME_ROOT . './oblivions/include/api/obl_api_bootstrap.php';
require_once GAME_ROOT . './oblivions/include/api/obl_state_response.php';
require_once GAME_ROOT . './oblivions/include/core/obl_tick_orchestrator.php';
require_once GAME_ROOT . './oblivions/include/api/obl_state_handlers.php';
```

注意：

虽然 State API 加载 `obl_tick_orchestrator.php`，但只用于：

```txt
runtime status / tick status 查询
```

不得调用：

```txt
obl_tick_orchestrator_heartbeat()
obl_tick_orchestrator_resolve_pending()
```

---

## 6. 目标入口结构

### 6.1 command.php

目标：

```php
require_once GAME_ROOT . './oblivions/include/api/obl_command_api_bootstrap.php';
```

替代当前多行 require：

```php
require_once GAME_ROOT . './oblivions/include/core/obl_runtime.php';
require_once GAME_ROOT . './oblivions/include/core/obl_json_request.php';
require_once GAME_ROOT . './oblivions/include/core/obl_command_response.php';
require_once GAME_ROOT . './oblivions/include/command/obl_command_bus.php';
```

### 6.2 heartbeat.php

目标：

```php
require_once GAME_ROOT . './oblivions/include/api/obl_heartbeat_api_bootstrap.php';
```

替代当前多行 require：

```php
require_once GAME_ROOT . './oblivions/include/core/obl_runtime.php';
require_once GAME_ROOT . './oblivions/include/core/obl_command_response.php';
require_once GAME_ROOT . './oblivions/include/core/obl_tick_orchestrator.php';
```

### 6.3 state.php

目标：

```php
require_once GAME_ROOT . './oblivions/include/api/obl_state_api_bootstrap.php';
```

替代当前多行 require：

```php
require_once GAME_ROOT . './oblivions/include/core/obl_runtime.php';
require_once GAME_ROOT . './oblivions/include/api/obl_state_response.php';
require_once GAME_ROOT . './oblivions/include/core/obl_tick_orchestrator.php';
require_once GAME_ROOT . './oblivions/include/api/obl_state_handlers.php';
```

---

## 7. 加载边界规则

### 7.1 Domain 层规则

`obl_bootstrap.php` 只负责 domain/game 函数库，不负责 API response / request 处理。

允许加载：

```txt
player.func.php
move.func.php
battle.func.php
battle_state_machine.func.php
item funcs
skill funcs
tick.func.php
gamectl funcs
```

不建议加载：

```txt
obl_state_response.php
obl_state_handlers.php
obl_json_request.php
obl_command_response.php
obl_command_bus.php
```

### 7.2 State 层规则

State API bootstrap 可以加载：

```txt
state response
state handlers
tick status 只读依赖
```

禁止引入：

```txt
command bus
json command envelope parser
写入型 command handlers
```

### 7.3 Command 层规则

Command API bootstrap 可以加载：

```txt
JSON request reader
Command response
Command contract
Command bus
Command router
```

不应加载：

```txt
State handlers
State response
```

### 7.4 Heartbeat 层规则

Heartbeat bootstrap 可以加载：

```txt
Tick Orchestrator
response helper
```

不应加载：

```txt
State handlers
Command Bus
```

---

## 8. 执行步骤

### Step 1：新增 bootstrap 文件

新增：

```txt
oblivions/include/api/obl_api_bootstrap.php
oblivions/include/api/obl_command_api_bootstrap.php
oblivions/include/api/obl_heartbeat_api_bootstrap.php
oblivions/include/api/obl_state_api_bootstrap.php
```

只做 require 聚合，不改业务。

### Step 2：替换三个 API 入口 require

修改：

```txt
oblivions/api/command.php
oblivions/api/heartbeat.php
oblivions/api/state.php
```

把多行 require 替换为对应 bootstrap。

### Step 3：验证无行为变化

必须验证：

```txt
探索命令
移动命令
战斗开始
战斗行动
heartbeat 推进 NPC / PROCESSING
state player_info
state battle_log
state game_map / tile_actions / inventory / craft / logs / skills
```

### Step 4：清理误导注释

如果发现入口注释仍写“手动 require 某文件”，同步改成 bootstrap 描述。

### Step 5：文档同步

更新：

```txt
D:\wamp64\www\phpdts\oblivions\CODEBASE.md
D:\wamp64\www\phpdts\vex-vue\CODEBASE.md
```

只需要小范围更新 API 入口加载说明。

---

## 9. 风险与注意事项

### 9.1 不要引入循环 require

bootstrap 文件之间必须保持单向依赖：

```txt
command/state/heartbeat bootstrap
  -> api bootstrap
    -> runtime
      -> domain bootstrap
```

不要让 `obl_bootstrap.php` 反向 require API bootstrap。

### 9.2 不要改变 Runtime boot 时机

`obl_runtime_boot($kind)` 仍应由入口显式调用。

不要在 bootstrap 文件中自动执行：

```php
obl_runtime_boot('command')
```

原因：入口需要先完成常量、fatal handler、method 检查等控制，且不同入口 `$kind` 不同。

### 9.3 不要让 state bootstrap 产生写副作用

State API 是纯读入口。bootstrap 只能加载文件，不能执行：

```txt
schema ensure
oblgame create
heartbeat
resolve pending tick
save_gameinfo
```

### 9.4 保持 require_once

所有 bootstrap 内部统一使用：

```php
require_once
```

避免重复加载。

---

## 10. 验收标准

### 10.1 静态检查

```powershell
php -l D:\wamp64\www\phpdts\oblivions\api\command.php
php -l D:\wamp64\www\phpdts\oblivions\api\heartbeat.php
php -l D:\wamp64\www\phpdts\oblivions\api\state.php
php -l D:\wamp64\www\phpdts\oblivions\include\api\obl_api_bootstrap.php
php -l D:\wamp64\www\phpdts\oblivions\include\api\obl_command_api_bootstrap.php
php -l D:\wamp64\www\phpdts\oblivions\include\api\obl_heartbeat_api_bootstrap.php
php -l D:\wamp64\www\phpdts\oblivions\include\api\obl_state_api_bootstrap.php
```

前端：

```powershell
npm run type-check --prefix D:\wamp64\www\phpdts\vex-vue
```

### 10.2 行为检查

浏览器 Network 应保持不变：

```txt
/phpdts/oblivions/api/command.php
/phpdts/oblivions/api/heartbeat.php
/phpdts/oblivions/api/state.php?scope=xxx
```

功能应保持不变：

```txt
探索成功
移动成功
战斗导演正常
合成正常
日志正常
技能正常
无 LOCKED 异常回归
```

---

## 11. 当前建议

这是一个轻量架构整理任务，可以在下一轮执行。

优先级：中等。

原因：

```txt
当前系统能运行，不是紧急修复；
但继续扩展 API / Debug / Lifecycle 前，先整理 bootstrap 会降低后续维护成本。
```


---

## 12. 执行记录

执行日期：2026-07-09。

已完成：

```txt
新增 include/api/obl_api_bootstrap.php
新增 include/api/obl_command_api_bootstrap.php
新增 include/api/obl_heartbeat_api_bootstrap.php
新增 include/api/obl_state_api_bootstrap.php
command.php / heartbeat.php / state.php 改为加载对应 API bootstrap
同步更新 oblivions/CODEBASE.md 与 vex-vue/CODEBASE.md 的入口加载说明
```

执行边界：

```txt
未改变 Command API 契约
未改变 State API 响应结构
未改变 Tick Orchestrator 推进规则
未改变前端请求路径
未把 obl_runtime_boot($kind) 移入 bootstrap
```
