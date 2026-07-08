# Oblivions State / Read API 独立设计案

> 目标：把 Oblivions 前端运行期的只读数据请求从旧 `api_v2.php -> common.inc.php` 迁移到 Oblivions 专属 Runtime 下，让 `command / heartbeat / state-read` 三条主链路都不再依赖旧请求生命周期。  
> 边界：本文只设计 **只读 State / Read API**。房间创建、玩家激活、生命周期启动、`valid.php` 独立不在本任务内。

---

## 0. 当前背景

前两类运行期接口已经独立：

```txt
写命令：
  vex-vue -> /phpdts/oblivions/api/command.php
    -> obl_runtime_boot('command')
    -> Command Bus
    -> Tick Orchestrator after-command

显式 tick 推进：
  vex-vue -> /phpdts/oblivions/api/heartbeat.php
    -> obl_runtime_boot('heartbeat')
    -> Tick Orchestrator heartbeat
```

阶段三之后，`common.inc.php` 已不再处理 Oblivions pending tick；前端读状态前需要显式 `heartbeat`，这已经通过 `oblHeartbeat()` 修复。

但前端大部分只读数据仍走：

```txt
vex-vue -> /phpdts/api_v2.php?action=xxx
  -> include/core/common.inc.php
  -> obl_bootstrap.php
  -> handle_xxx()
```

这意味着 Oblivions 运行期仍有一条重要读链路依赖旧核心。下一步应迁移这条链路。

---

## 1. 问题定义

### 1.1 旧读接口仍绑定 common.inc.php

`D:\wamp64\www\phpdts\api_v2.php` 顶部仍加载：

```php
require_once './include/core/common.inc.php';
```

即使它现在不再隐式推进 Oblivions tick，它仍然承担：

- 旧核心 runtime 初始化。
- 旧输入过滤与全局变量装配。
- 旧 `game` 表生命周期读取。
- 旧 entrypoint 和 `pdata` 装配。
- Oblivions 日志 shutdown 持久化。

这些对 Oblivions 新 API 来说都不是理想边界。需要注意：`api_v2.php` 并不是“旧模式主接口”，而是当前 vex-vue / Oblivions 过渡读接口；本设计的首要目标是让 Oblivions 正常运行期从这个过渡接口迁出，最终目标是在调试写接口与文档引用也迁移完成后删除 `api_v2.php`。

### 1.2 前端运行期仍处于混合架构

当前前端大致是：

```txt
write command -> oblivions/api/command.php      ✅ 新 Runtime
heartbeat     -> oblivions/api/heartbeat.php    ✅ 新 Runtime
read data     -> api_v2.php?action=xxx          ❌ 旧 Runtime
```

这会造成：

- 状态刷新语义不统一。
- 前端容易误以为读接口可以推进世界。
- 新 Runtime 与旧 Runtime 同时装配 `$pdata / $gamevars / loggers`。
- 后续 Room / Lifecycle 解耦前缺少干净运行期基础。

### 1.3 刚发生过的典型风险

阶段三后移除 `common.inc.php` 隐式 tick 解析，导致旧前端部分逻辑仍假设：

```txt
fetch(player_info) 会顺便结算 NPC / pending tick
```

实际新契约应是：

```txt
heartbeat 显式推进世界。
state/read 纯读，不推进世界。
```

因此 Read API 独立时必须把这个契约写入接口层，而不是继续让读接口带隐式副作用。

---

## 2. 总目标

建立 Oblivions 专属 State / Read API，使前端运行期读数据不再访问：

```txt
D:\wamp64\www\phpdts\api_v2.php
D:\wamp64\www\phpdts\include\core\common.inc.php
```

最终目标链路：

```txt
写命令：
  /phpdts/oblivions/api/command.php

显式推进：
  /phpdts/oblivions/api/heartbeat.php

读数据：
  /phpdts/oblivions/api/state.php?scope=xxx
```

核心要求：

- 所有 Read API 使用 `obl_runtime_boot('state')`。
- Read API 绝不推进 tick。
- Read API 绝不调用 `obl_tick_orchestrator_heartbeat()`。
- Read API 绝不调用 `obl_resolve_tick_events()`。
- Read API 响应格式尽量兼容 `api_v2.php`，降低前端迁移成本。
- 前端在需要确保世界已推进时，继续显式调用 `oblHeartbeat()`。

---

## 3. 非目标

本任务不处理：

- 不重构 `api_v2.php` 中与本次迁移无关的调试/过渡功能。
- 不在 State API 迁移第一阶段删除 `api_v2.php` 文件；但整体最终目标是迁移所有剩余调用后删除 `api_v2.php`。
- 不独立房间创建入口。
- 不新建 `obl_roommng`。
- 不独立 `valid.php` / 玩家激活。
- 不改变 Command API 契约。
- 不改变 Tick Orchestrator 推进规则。
- 不把所有 domain function 改为无 globals 形式。
- 不要求一次性删除所有旧页面入口。

---

## 4. 设计原则

### 4.1 读接口纯读

Read API 必须只做：

```txt
认证当前用户
读取当前房间/玩家/地图/日志/背包/合成数据
返回 JSON
```

禁止做：

```txt
tick++
resolve pending tick
NPC 行动
battle state recovery
隐式调用 heartbeat
save_gameinfo()
```

如果发现：

```txt
processed_tick < tick
```

只能返回状态提示，不能结算。

### 4.2 显式推进与读取分离

前端需要最新战斗状态时，时序必须是：

```txt
await oblHeartbeat();
await gameApi('player_info');
await gameApi('battle_log');
```

而不是让读接口自己推进。

### 4.3 响应兼容优先

第一阶段迁移时，响应结构保持：

```json
{
  "status": "success",
  "data": {},
  "message": ""
}
```

错误结构保持：

```json
{
  "status": "error",
  "message": "...",
  "code": "..."
}
```

原因：前端 `dataManager` / stores 已以旧 `api_v2.php` 响应格式为基础，保持兼容可降低风险。

### 4.4 先搬迁 Oblivions handlers，不重写业务

`api_v2.php` 中已有的 Oblivions handler 逻辑应先搬到新文件中，必要时提取公共函数。不要在第一步重写地图、背包、合成、战斗日志业务。

### 4.5 分批迁移，前端可回滚

前端 `gameApi(action)` 可以先按 action 白名单路由到新接口；未迁移 action 继续走旧 `api_v2.php`。

示例：

```ts
const OBL_STATE_SCOPES = new Set([
  'player_info',
  'game_map',
]);
```

这样可以逐项迁移和测试。

---

## 5. API 形态选择

### 5.1 推荐方案：扩展 `state.php?scope=xxx`

使用现有入口：

```txt
D:\wamp64\www\phpdts\oblivions\api\state.php
```

新增 query 参数：

```txt
GET /phpdts/oblivions/api/state.php?scope=player_info
GET /phpdts/oblivions/api/state.php?scope=game_map
GET /phpdts/oblivions/api/state.php?scope=tile_actions
GET /phpdts/oblivions/api/state.php?scope=battle_log
```

不带 `scope` 时保留当前 runtime/tick probe：

```txt
GET /phpdts/oblivions/api/state.php
```

返回：

```json
{
  "status": "success",
  "data": {
    "tick": 1,
    "processed_tick": 1,
    "pending_tick": false
  }
}
```

### 5.2 为什么不优先拆成多个小 API

可选方案是：

```txt
oblivions/api/player.php
oblivions/api/map.php
oblivions/api/inventory.php
oblivions/api/log.php
```

但第一阶段不推荐，原因：

- 前端已有 action-based `dataManager`。
- `api_v2.php` 也是 action 分发模型。
- 统一 `state.php?scope=` 可以最小化前端改动。
- 后续稳定后再按领域拆分不迟。

---

## 6. 目标 scope 清单

从 `api_v2.php` 当前 action 梳理，Oblivions 前端运行期读接口包括：

| scope | 当前 handler | 是否迁移 | 说明 |
|---|---|---:|---|
| `player_info` | `handle_player_info()` | 是 | 状态栏、战斗状态、装备数据来源 |
| `player_inventory` | `handle_player_inventory()` | 是 | 背包列表 |
| `game_map` | `handle_game_map()` | 是 | 当前区域地图、连通性 |
| `tile_actions` | `handle_tile_actions()` | 是 | 当前格可执行动作 |
| `obl_log` | `handle_obl_log()` | 是 | 结构化日志 |
| `obl_error` | `handle_obl_error()` | 是 | 错误日志 |
| `battle_log` | `handle_battle_log()` | 是 | 前端导演输入 |
| `enemies` | `handle_obl_enemies()` | 是 | 当前区域敌人 / 战斗目标 |
| `skill_list` | `handle_skill_list()` | 是 | 技能列表 |
| `skill_cd_check` | `handle_skill_cd_check()` | 可迁移 | 如果前端仍使用则迁移 |
| `craft_preview` | `handle_craft_preview()` | 是 | 带参数预览 |
| `craft_workbench_materials` | `handle_craft_workbench_materials()` | 是 | 工作台材料 |
| `craft_recipes` | `handle_craft_recipes()` | 是 | 配方列表 |
| `heartbeat` | inline case | 不迁移 | 已由 `heartbeat.php` 接管 |
| `ai_dump_save` | `handle_ai_dump_save()` | 暂不迁移到 State API | 调试写接口，不属于纯读；若目标是让 vex-vue 完全不再访问 api_v2，可后续新建 Oblivions debug/dump API 单独迁移 |

---

## 7. 后端文件规划

### 7.1 第一阶段最小文件

新增：

```txt
D:\wamp64\www\phpdts\oblivions\include\api\obl_state_response.php
D:\wamp64\www\phpdts\oblivions\include\api\obl_state_handlers.php
```

修改：

```txt
D:\wamp64\www\phpdts\oblivions\api\state.php
```

可选后续拆分：

```txt
D:\wamp64\www\phpdts\oblivions\include\api\state\player.handlers.php
D:\wamp64\www\phpdts\oblivions\include\api\state\map.handlers.php
D:\wamp64\www\phpdts\oblivions\include\api\state\craft.handlers.php
D:\wamp64\www\phpdts\oblivions\include\api\state\log.handlers.php
```

第一阶段为减少文件数量，先用单个 `obl_state_handlers.php`。

### 7.2 state.php 入口职责

`state.php` 负责：

```txt
1. 定义 IN_GAME / GAME_ROOT / GAMENAME
2. require obl_runtime.php
3. require obl_state_response.php
4. require obl_state_handlers.php
5. obl_runtime_boot('state')
6. 检查 GET / OPTIONS
7. 检查 Oblivions 模式
8. 读取 scope
9. 分发 handler
10. emit JSON
```

不负责：

```txt
业务数据组装细节
tick 推进
日志写入
```

### 7.3 handler 命名

建议：

```php
obl_state_handle_runtime_status($ctx);
obl_state_handle_player_info($ctx);
obl_state_handle_player_inventory($ctx);
obl_state_handle_game_map($ctx);
obl_state_handle_tile_actions($ctx);
obl_state_handle_obl_log($ctx);
obl_state_handle_obl_error($ctx);
obl_state_handle_battle_log($ctx);
obl_state_handle_enemies($ctx);
obl_state_handle_skill_list($ctx);
obl_state_handle_skill_cd_check($ctx);
obl_state_handle_craft_preview($ctx);
obl_state_handle_craft_workbench_materials($ctx);
obl_state_handle_craft_recipes($ctx);
```

分发：

```php
function obl_state_dispatch($scope, $ctx) {
    switch ($scope) {
        case '':
        case 'runtime':
            return obl_state_handle_runtime_status($ctx);
        case 'player_info':
            return obl_state_handle_player_info($ctx);
        ...
    }
}
```

---

## 8. 响应契约

### 8.1 成功响应

兼容旧 `api_v2.php`：

```php
function obl_state_response_success($data = null, $message = '') {
    return array(
        'status' => 'success',
        'data' => $data,
        'message' => $message,
    );
}
```

### 8.2 错误响应

```php
function obl_state_response_error($message, $code = 'ERROR', $http_status = 400) {
    http_response_code($http_status);
    return array(
        'status' => 'error',
        'message' => $message,
        'code' => $code,
    );
}
```

### 8.3 与 Command API 响应区分

Command API 使用：

```json
{
  "status": "success",
  "code": "OK",
  "data": {}
}
```

State API 第一阶段保持旧读接口格式：

```json
{
  "status": "success",
  "data": {},
  "message": ""
}
```

原因是前端读层已使用 `ApiResponse` 类型，不宜在本阶段同时重构读响应契约。

---

## 9. 前端迁移设计

### 9.1 client.ts 增加 Oblivions Read API

新增：

```ts
const OBL_STATE_SCOPES = new Set<ApiAction>([
  API_ACTIONS.PLAYER_INFO,
  API_ACTIONS.PLAYER_INVENTORY,
  API_ACTIONS.GAME_MAP,
  API_ACTIONS.TILE_ACTIONS,
  API_ACTIONS.OBL_LOG,
  API_ACTIONS.OBL_ERROR,
  API_ACTIONS.BATTLE_LOG,
  API_ACTIONS.ENEMIES,
  API_ACTIONS.SKILL_LIST,
  API_ACTIONS.SKILL_CD_CHECK,
  API_ACTIONS.CRAFT_PREVIEW,
  API_ACTIONS.CRAFT_WORKBENCH_MATERIALS,
  API_ACTIONS.CRAFT_RECIPES,
]);
```

`gameApi(action)` 改为：

```ts
const url = OBL_STATE_SCOPES.has(action)
  ? `${API_BASE}/oblivions/api/state.php?scope=${action}`
  : `${API_BASE}/api_v2.php?action=${action}`;
```

`gameApiWithParams(action, params)` 同理：

```ts
const query = new URLSearchParams(
  OBL_STATE_SCOPES.has(action)
    ? { scope: action, ...params }
    : { action, ...params }
);
```

### 9.2 Vite proxy

已有：

```txt
/phpdts/oblivions/api/state.php
```

无需新增。

### 9.3 保持显式 heartbeat 契约

任何依赖 tick 后状态的调用仍保持：

```ts
await oblHeartbeat();
await gameApi(API_ACTIONS.PLAYER_INFO);
```

不要把 heartbeat 塞进 `gameApi()`。

---

## 10. 迁移阶段

### 阶段 1：后端框架与最小 scope

迁移：

```txt
runtime / player_info / battle_log
```

原因：

- `runtime` 已存在。
- `player_info` 是状态锁核心。
- `battle_log` 是前端导演核心。

验收：

- `state.php?scope=player_info` 返回与 `api_v2.php?action=player_info` 兼容的数据。
- `state.php?scope=battle_log` 返回未播放 battlelog。
- 战斗行动、NPC 回合、导演播放正常。

### 阶段 2：地图与敌人

迁移：

```txt
game_map / tile_actions / enemies
```

验收：

- 地图加载正常。
- 移动后地图刷新正常。
- 当前格动作正常。
- 敌人显示与战斗点击正常。

### 阶段 3：背包与合成

迁移：

```txt
player_inventory / craft_preview / craft_workbench_materials / craft_recipes
```

验收：

- 背包显示正常。
- 拾取、使用、丢弃后刷新正常。
- 合成预览、合成执行、工作台材料正常。

### 阶段 4：日志与技能

迁移：

```txt
obl_log / obl_error / skill_list / skill_cd_check
```

验收：

- 日志面板正常。
- 错误日志正常。
- 技能列表和 CD 检查正常。

### 阶段 5：前端默认切换

当前端所有 Oblivions read action 都走新接口后：

- 检查浏览器 Network，不应再出现常规运行期 `/phpdts/api_v2.php?action=...`。
- `heartbeat` 不应再作为 `api_v2.php?action=heartbeat` 使用；前端应统一调用 `oblHeartbeat()` -> `oblivions/api/heartbeat.php`。
- `API_ACTIONS.HEARTBEAT` 可在确认无引用后删除或标记废弃。
- `ai_dump_save` 等调试写接口可暂时继续走 `api_v2.php`；若要求 vex-vue 完全零访问 `api_v2.php`，应追加阶段 6 单独迁移调试写接口。

### 阶段 6（可选）：调试写接口与文档类型清理

如果目标从“Oblivions 正常游玩运行期摆脱 `api_v2.php`”升级为“vex-vue 完全不再访问 `api_v2.php`”，则追加：

```txt
ai_dump_save -> 新建 oblivions/api/debug_dump.php 或 oblivions/api/debug.php?action=ai_dump_save
API_ACTIONS.HEARTBEAT -> 删除或废弃
vex-vue/src/types/api.ts 注释中的 api_v2.php?action=xxx -> 更新为 state.php?scope=xxx
vex-vue/CODEBASE.md 中旧 heartbeat/api_v2 描述 -> 更新
vite.config.js 中 /phpdts/api_v2.php proxy -> 随 api_v2 删除而移除该旧路径；但 Vite proxy 机制本身必须保留，并继续代理 command / heartbeat / state / mark_battle_log_played / img 等开发期请求
```

该阶段不属于纯读 State API 的核心迁移，但有助于彻底清理前端对 `api_v2.php` 的全部引用。注意：这里清理的是 `/phpdts/api_v2.php` 这条旧代理规则，不是删除 Vite proxy。当前 `vex-vue/vite.config.js` 的 proxy 使用 `http.Agent({ keepAlive: true })` 复用 TCP 连接，注释记录其目的是避免开发模式下每次请求重新建连导致约 `~300ms -> ~5ms` 的响应差异；因此 proxy 作为开发性能设施应保留。

---

## 11. 依赖与风险

### 11.1 `$pdata` 装配差异

旧 `api_v2.php` 使用：

```php
$pdata = obl_game_entrypoint('api');
```

新 `obl_runtime_boot('state')` 只完成 runtime，不自动返回 `$pdata`。

处理：

- state handler 内统一调用：

```php
obl_state_current_player();
```

内部：

```php
$pdata = obl_fetch_playerdata_by_name($GLOBALS['cuser']);
obl_format_playerdata($pdata);
```

或直接复用：

```php
obl_game_entrypoint('api')
```

但要注意该函数错误响应格式可能仍偏旧，应包装。

### 11.2 日志持久化差异

读接口原则上不应产生新日志；但某些读取逻辑可能调用 domain function emit error log。

处理：

- state.php shutdown 可调用：

```php
obl_runtime_persist_logs($pdata, 'state')
```

但仅在 `$pdata` 存在时执行。

### 11.3 craft_preview 是带参数读接口

`craft_preview` 需要：

```txt
slots
```

处理：

- `gameApiWithParams()` 支持 `scope=craft_preview&slots=...`。
- 后端 handler 从 `$_REQUEST['slots']` 读取。

### 11.4 `state.php` 纯读与 schema ensure

当前 `obl_runtime_boot('state')` 已避免 state 请求创建 `oblgame` 行。

迁移时必须保持：

```php
obl_gamevars_sync_to_globals(false, false)
```

不要在纯读 handler 里调用会创建/重置状态的函数。

### 11.5 与 heartbeat 的时序

Read API 不负责解决 stale state。前端战斗链路必须保留：

```ts
await oblHeartbeat();
```

否则会再次出现：

```txt
PROCESSING 残留
battle_log 读取过早
导演无日志/状态错乱
```

### 11.6 Vite proxy 保留原则

当前开发模式下，前端通过 Vite dev server（如 `localhost:5174`）访问 WAMP/PHP 后端。`D:\wamp64\www\phpdts\vex-vue\vite.config.js` 中的 proxy 不只是路径兼容层，还承担开发期性能优化：

```js
const proxyAgent = new http.Agent({ keepAlive: true, maxSockets: 10 });
```

文件注释已说明：保持 TCP 连接复用，避免每次请求重新建立连接导致约 `~300ms -> ~5ms` 的响应差异。因此：

- `api_v2.php` 删除后，应删除的是 `/phpdts/api_v2.php` 这条过时代理规则。
- Vite proxy 机制本身应保留。
- 新 Read API 应继续通过 proxy 代理：`/phpdts/oblivions/api/state.php`。
- command / heartbeat / mark_battle_log_played / img 等开发期请求也应继续使用 proxy + keepAlive。

---

## 12. 验证方案

### 12.1 后端静态检查

```powershell
php -l D:\wamp64\www\phpdts\oblivions\api\state.php
php -l D:\wamp64\www\phpdts\oblivions\include\api\obl_state_response.php
php -l D:\wamp64\www\phpdts\oblivions\include\api\obl_state_handlers.php
```

### 12.2 前端类型检查

```powershell
npm run type-check --prefix D:\wamp64\www\phpdts\vex-vue
```

### 12.3 Network 验收

迁移完成后，常规运行期应看到：

```txt
/phpdts/oblivions/api/command.php
/phpdts/oblivions/api/heartbeat.php
/phpdts/oblivions/api/state.php?scope=...
/phpdts/oblivions/mark_battle_log_played.php
```

不应再看到：

```txt
/phpdts/api_v2.php?action=player_info
/phpdts/api_v2.php?action=game_map
/phpdts/api_v2.php?action=battle_log
```

### 12.4 功能验收

必须逐项测试：

- 初次进入前端，状态栏显示正常。
- 地图加载正常。
- 移动正常。
- 探索正常。
- 遭遇战进入正常。
- 玩家战斗行动正常。
- NPC 行动正常。
- battlelog 导演播放正常。
- 战斗结束后返回探索正常。
- 背包显示、拾取、使用、丢弃正常。
- 合成预览与执行正常。
- 日志面板正常。

---

## 13. 完成后的架构状态

完成本任务后，Oblivions **正常游玩运行期** 链路应变为：

```txt
vex-vue
  -> command.php       写命令
  -> heartbeat.php     显式推进 tick
  -> state.php?scope   纯读状态
```

旧：

```txt
api_v2.php -> common.inc.php
```

不再承担 Oblivions 正常游玩运行期职责。若还保留 `ai_dump_save` 等开发调试调用，则那属于调试链路，不应再混入正常读状态链路；最终删除 `api_v2.php` 前必须把这些调试链路也迁移掉。

但仍未独立的内容包括：

```txt
房间创建：index.php / roommng.func.php / {$gtablepre}game
游戏 prepare/start 触发：common.inc.php / obl_gamestate_try_prepare
玩家激活：valid.php
```

这些应作为后续 Room / Lifecycle / Spawn 独立任务处理。

---

## 14. 建议下一步执行

建议先执行：

```txt
阶段 1：后端框架 + player_info + battle_log + 前端路由白名单
```

原因：

- `player_info` 是 CommandQueue 锁和战斗状态机核心。
- `battle_log` 是前端导演核心。
- 这两者最能验证新 Read API 是否破坏 tick/战斗时序。

阶段 1 成功后，再迁移地图、背包、合成、日志；全部正常读链路稳定后，再执行可选阶段 6 迁移调试写接口与文档引用，最终删除 `api_v2.php`，但保留 Vite proxy 作为开发性能设施。

---

**文档结束。**

---

## 15. 执行结果记录

- 阶段 1-5 已完成：Oblivions 正常运行期 read action 全部迁移到 `oblivions/api/state.php?scope=xxx`。
- 阶段 6 执行时确认 `ai_dump_save` 在 `vex-vue/src` 内没有实际调用者，只剩孤立导出；判定为过时调试残留，不迁移为新 API。
- `api_v2.php` 已从运行期入口中删除；Vite proxy 机制保留，但移除 `/phpdts/api_v2.php` 旧代理规则。
