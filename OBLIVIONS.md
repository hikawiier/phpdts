# OBLIVIONS — VEX 前端 + Oblivions 模式 + API v2 结构说明

> 辅助 AI 智能体快速介入这三个组件的开发。假设已读过 [CODEBASE.md](CODEBASE.md) 和 [GLOBALS.md](GLOBALS.md)。

---

## 一、三者关系

```
┌─────────────────────────────────────────────────────────┐
│  浏览器                                                  │
│                                                          │
│  vex/index.html  ──── SPA 前端（ES Modules）             │
│    │ 读数据 ────── GET  api_v2.php?action=xxx            │
│    │ 写指令 ────── POST command.php                      │
│    │ AI调试 ────── POST api_v2.php?action=ai_dump_save   │
│                                                          │
└─────────────────────────────────────────────────────────┘
         │                           │
         ▼                           ▼
┌─────────────────┐    ┌──────────────────────────────────┐
│  api_v2.php     │    │  command.php                     │
│  只读 API       │    │  指令处理（写操作）               │
│  8 个 action    │    │  ┌─ oblivions_is_active()?       │
│  返回 JSON      │    │  │  YES → obl_move()             │
│                 │    │  │  NO  → move()                  │
└─────────────────┘    └──────────────────────────────────┘
         │                           │
         ▼                           ▼
┌─────────────────────────────────────────────────────────┐
│  oblivions/                                              │
│  gamedata/map.php + tiles/region_*.php  ← 地图数据      │
│  include/game/move.func.php             ← 移动逻辑      │
│  include/game/explore.func.php          ← 探索（TODO）  │
│  include/game/generate.func.php         ← 生成（TODO）  │
└─────────────────────────────────────────────────────────┘
```

**核心判断**：`oblivions_is_active()` — 定义于 [global.func.php](include/core/global.func.php#L278)，通过 `$gruleset === 'OBLIVIONS'` 判断。此函数是整个模式切换的开关，在 10+ 处调用点控制分支。

---

## 二、模式切换集成点

`oblivions_is_active()` 在以下位置控制旧版/新版分支：

| 文件 | 位置 | 行为 |
|------|------|------|
| [game.php](game.php#L22) | 入口 | `true` → 重定向到 `vex/index.html`，不走 PHP 模板 |
| [basic_commands.php](include/command/handlers/basic_commands.php#L14) | `cmd_handle_move()` | `true` → `obl_move()`，`false` → 旧版 `move()` |
| [api_v2.php](api_v2.php#L418) | `handle_game_map()` | `true` → 附加 `links` 字段（regions/tiles/grids） |
| [gamestate.func.php](include/gamectl/gamestate.func.php) | 状态转换 | 跳过/修改部分状态转换逻辑 |
| [system.func.php](include/gamectl/system.func.php#L121) | 游戏重置 | 跳过部分重置逻辑 |
| [deatharea.func.php](include/gamectl/deatharea.func.php#L168) | 禁区 | 跳过/修改禁区逻辑 |
| [valid.php](valid.php) | 入场 | 跳过 iplimit/validlimit 检查，跳过部分初始化 |
| [render.func.php](include/game/render.func.php#L17) | 渲染 | 禁止旧版渲染 |

---

## 三、api_v2.php — 只读 REST API

> 文件：[api_v2.php](api_v2.php)

### 3.1 请求协议

- **认证**：`game_entrypoint('api')` — Cookie 认证，未登录返回错误
- **CORS**：生产同源，开发可通过 `$extra_origins` 扩展
- **响应格式**：`{ "status": "success"|"error", "data": ..., "message": ... }`
- **错误格式**：`{ "status": "error", "message": "...", "code": "..." }`

### 3.2 Action 速查

| Action | 方法 | 用途 | 关键返回字段 |
|--------|------|------|-------------|
| `game_status` | GET | 游戏全局状态 | `gamenum`, `gamestate`, `arealist`, `weather`, `alivenum`, `noise` |
| `player_info` | GET | 完整玩家数据 | `hp/mhp/sp/msp`, `equipment{wep,arb...}`, `items[0-6]`, `clbpara`, `pls`, `pgroup` |
| `player_inventory` | GET | 背包槽位 | `slots[1-6]{name,kind,effect,durability,empty}`, `num`, `limit` |
| `game_map` | GET | 地图数据 | `currentLocation`, `currentRegion`, `arealist`, `links{regions,tiles,grids}`（仅 Oblivions） |
| `game_log` | GET | 日志内容 | `log`（HTML 字符串，从 `vex/cache/log_{groomid}_{pid}.php` 读取） |
| `chat_list` | GET | 最近聊天 | `[{sender, content, time}]` 最近 50 条倒序 |
| `debug_log` | POST | 调试数据写入 | `{written: true}` → `vex/cache/debug_move_{groomid}.log` |
| `ai_dump_save` | POST | AI 调试 JSON Lines | `{written: N}` → `vex/cache/ai_dump_{groomid}.jsonl` |

### 3.3 新增 Action 指南

1. 在 `switch ($action)` 中添加 `case`
2. 编写 `handle_xxx()` 函数
3. 需要的全局变量用 `global` 声明
4. 返回用 `api_response('success', $data)` 或 `api_error($msg, $code)`
5. 写操作**不要**放 api_v2.php，走 command.php

---

## 四、oblivions/ — 遗忘之境模式

### 4.1 文件结构

```
oblivions/
├── gamedata/
│   ├── map.php                    # 区域元数据 + 网格布局（regions/grids）
│   └── tiles/
│       ├── region_1.php           # 区域1「垃圾平原」15 个地图格
│       └── region_2.php           # 区域2「腐烂沼泽」4 个地图格
├── include/game/
│   ├── move.func.php              # obl_move() + obl_get_map_data() + obl_get_distance()
│   ├── explore.func.php           # obl_explore() — TODO
│   └── generate.func.php          # obl_generate_region_*() — TODO
└── docs/                          # 设计文档（仅供参考，不参与运行）
```

### 4.2 数据模型

**组合键**：`(pgroup, pls)` 唯一确定一个地图格。`pgroup` = 区域 ID，`pls` = 区域内局部索引（1-254）。跨区域 pls 可重用。

**map.php** — 区域元数据：

```php
'regions' => [
    $pgroup => [
        'name'         => string,   // 区域名称
        'desc'         => string,   // 区域描述
        'entrance_pls' => int,      // 入口格 pls
        'exit_pls'     => int,      // 出口格 pls（到达后切换 next_region）
        'next_region'  => int|null, // 下一区域 pgroup（null = 终点）
        'prev_region'  => int|null, // 上一区域 pgroup（入口格回退用）
        'exit_links'   => int[],    // [预留] 多出口
    ],
],
'grids' => [
    $pgroup => ['cols' => int, 'rows' => int],  // 前端渲染网格尺寸
],
```

**tiles/region_{$pgroup}.php** — 地图格数据（按需懒加载）：

```php
$pls => [
    'name'         => string,    // 地图格名称
    'desc'         => string,    // 到达时显示的描述
    'floor'        => string,    // 地板属性：standard/water/vegetation/metal/magic
    'tide'         => string,    // 潮汐属性：shallow/deep/abyss/safe
    'passable'     => bool,      // 是否可通行
    'neighbors'    => int[],     // 相邻格 pls 列表（邻接表）
    'x'            => int,       // 前端渲染坐标 X（列）
    'y'            => int,       // 前端渲染坐标 Y（行）
    'height'       => int,       // [预留] 高度
    'destructible' => bool,      // [预留] 可破坏
    'preset_safe'  => bool,      // 预设永久安全区
],
```

### 4.3 核心函数

| 函数 | 文件 | 说明 |
|------|------|------|
| `obl_get_map_data($pgroup)` | move.func.php | 加载地图数据。首次调用加载 regions/grids，传 pgroup 时按需加载 tiles。内部 static 缓存 |
| `obl_move($moveto, &$pdata)` | move.func.php | 移动主逻辑：同位置检查→有效性→可通行→体力→连通性→执行移动→区域切换→钩子 |
| `obl_get_distance($pgroup, $from, $to)` | move.func.php | BFS 最短路径距离，用于跨格移动判定 |
| `obl_get_move_range()` | move.func.php | 当前可移动最大格数，保底 1，预留技能扩展 |
| `obl_post_move_hook()` | move.func.php | 移动后钩子，TODO |
| `obl_explore()` | explore.func.php | 探索，TODO |
| `obl_generate_region_items/enemies/events()` | generate.func.php | 资源生成，TODO |

### 4.4 移动流程

```
obl_move($moveto, &$pdata)
  ├── 1. pls == moveto? → 跳过
  ├── 2. tiles[$moveto] 不存在? → 拒绝
  ├── 3. passable == false? → 拒绝
  ├── 4. sp < base_cost? → 拒绝（当前 base_cost=0）
  ├── 5. moveto 在 neighbors? → 直连移动
  │     └── 否则 move_range > 1? → BFS 距离判定
  │           └── 否则 → 拒绝
  ├── 6. sp -= cost
  ├── 7. pls = moveto, 写日志
  ├── 8. 出口格检查 → 切换区域（pgroup/pls 更新）
  ├── 9. 入口格回退检查 → 切回上一区域
  └── 10. obl_post_move_hook() [TODO]
```

**区域切换**：到达 `exit_pls` → `pgroup = next_region`，`pls = entrance_pls`。到达 `entrance_pls` 且有 `prev_region` → `pgroup = prev_region`，`pls = exit_pls`。

### 4.5 编码约束

- **禁止 `extract($pdata)`**：Oblivions 代码直接操作 `$pdata['pls']`、`$pdata['pgroup']` 等，不展开为全局变量
- **`oblivions_is_active()` 为 false 时**：所有逻辑走旧版，不受影响
- **地图数据懒加载**：`obl_get_map_data()` 使用 static 缓存，tiles 按区域按需 require

---

## 五、vex/ — SPA 前端

> 详细设计文档：[vex/DESIGN.md](vex/DESIGN.md)

### 5.1 文件结构

```
vex/
├── index.html              # SPA 入口
├── css/style.css           # 立体剪纸视觉风格
├── js/
│   ├── data.js             # BASE_URL + DebugBus + mapData + 硬编码数据表
│   ├── data-manager.js     # DataManager 统一数据层（缓存+去重+订阅）
│   ├── command-queue.js    # CommandQueue 命令队列（防抖+冷却）
│   ├── utils.js            # escapeHtml + API 请求 + submitCommand
│   ├── map.js              # 地图渲染 + 移动操作
│   ├── inventory.js        # 背包 + 装备 + 物品发现
│   ├── player.js           # 玩家信息侧滑抽屉
│   ├── log.js              # 日志面板（3 秒轮询）
│   ├── app.js              # 入口：loadAll() + window 暴露 + debug.js 动态加载
│   └── debug.js            # AI 调试模块（JSON Lines 管道，?debug=ai 触发）
└── cache/
    ├── ai_dump_{groomid}.jsonl    # AI 调试数据
    ├── debug_move_{groomid}.log   # 移动调试数据
    └── log_{groomid}_{pid}.php    # 日志缓存
```

### 5.2 模块依赖图

```
app.js
  ├── data.js          ← BASE_URL, DebugBus, mapData, 数据表
  ├── map.js           → data.js, utils.js, inventory.js, player.js, log.js, data-manager.js, command-queue.js
  ├── inventory.js     → data.js, utils.js, log.js, data-manager.js, command-queue.js
  ├── player.js        → data.js, utils.js, data-manager.js
  ├── log.js           → data.js, utils.js
  ├── data-manager.js  → utils.js
  ├── command-queue.js → utils.js
  └── debug.js         → window.__vex_debug_bus, window.__vex_base_url（IIFE，不参与模块系统）
```

### 5.3 数据流

**页面加载**：
```
app.js:loadAll()
  ├── loadMap()          → GET api_v2.php?action=game_map
  ├── loadItemFind()     → DataManager → GET api_v2.php?action=player_info
  ├── loadInventory()    → GET api_v2.php?action=player_inventory → 内部调 loadEquipment()
  └── refreshLog()       → GET api_v2.php?action=game_log
```

**移动操作**：
```
clickMove(pls)
  ├── hasFoundItem? → 阻止移动
  ├── commandQueue.execute({command:'move', moveto}) → POST command.php
  └── 成功 → dataManager.invalidateAll() → 并行刷新 5 个面板
```

**物品操作**：
```
itemFindPickup()  → commandQueue.execute({mode:'itemmain', command:'itemget'})
itemFindUse()     → commandQueue.execute({mode:'command', command:'itm0'})
itemFindRefine()  → commandQueue.execute({mode:'itemmain', command:'split_itm0'})  // 仅 club=20
itemFindDiscard() → commandQueue.execute({mode:'itemmain', command:'dropitm0'})
```

**AI 调试**（`?debug=ai`）：
```
各模块 DebugBus.emit(cat, step, data)
  → debug.js 订阅 → 缓冲（2秒/20条）→ POST api_v2.php?action=ai_dump_save
  → 写入 vex/cache/ai_dump_{groomid}.jsonl
```

### 5.4 关键全局状态

| 变量 | 文件 | 类型 | 说明 |
|------|------|------|------|
| `mapData` | data.js | object | 地图状态：`curLoc`, `curRegion`, `arealist`, `areanum`, `areaadd`, `hack`, `links` |
| `hasFoundItem` | inventory.js | bool | 是否有发现的物品（阻止移动） |
| `playerClub` | inventory.js | int | 玩家社团 ID（影响物品操作按钮） |
| `dataManager` | data-manager.js | DataManager | 统一数据层，缓存 TTL=2s，并发去重 |
| `commandQueue` | command-queue.js | CommandQueue | 命令队列，操作锁 + 冷却时间 |

### 5.5 API 调用方式

**只读**（utils.js）：
```javascript
import { gameApi } from './utils.js';
const result = await gameApi('game_map');    // → GET api_v2.php?action=game_map
// result = { status: 'success', data: {...}, message: '' }
```

**带缓存**（data-manager.js）：
```javascript
import { dataManager } from './data-manager.js';
const result = await dataManager.fetch('player_info');        // 缓存 2s
const fresh  = await dataManager.fetch('player_info', true);  // 强制刷新
dataManager.invalidateAll();  // 操作成功后清缓存
```

**写操作**（command-queue.js → utils.js）：
```javascript
import { commandQueue } from './command-queue.js';
const result = await commandQueue.execute({ command: 'move', moveto: 3 });
// result = { success: bool, gamedata: {...}, timer: ms|null, error: str|null }
```

### 5.6 地图渲染逻辑

`renderMapGrid()` 在 [map.js](vex/js/map.js) 中：

1. 从 `mapData.links.grids[curRegion]` 取网格尺寸（cols × rows）
2. `buildCoordIndex(tiles)` 预构建 `"x,y" → {pls, tile}` 索引（O(1) 查找）
3. 双重循环生成网格 DOM：
   - 无 tile → 灰色空白格
   - `passable=false` → `blocked` 样式
   - 当前位置 → `current` 样式 + `*`
   - `isReachable(pls)` 返回 true → `safe` 样式，可点击
   - 其他 → `unreachable` 样式
   - `exit_pls` → 追加 `exit-tile` 样式
   - `entrance_pls`（有 prev_region）→ 追加 `entrance-tile` 样式
4. 可点击格绑定 `clickMove(pls)`

**`isReachable(pls)`**：检查 `tiles[curLoc].neighbors` 是否包含目标 pls。入口格特殊处理：如果目标格是当前区域入口且有 prev_region，也视为可达（回退功能）。

### 5.7 DebugBus 事件协议

| 类别(cat) | 步骤(step) | 触发时机 |
|-----------|-----------|---------|
| `api` | `loadMap:start/response` | 地图 API 请求 |
| `api` | `loadInventory:start` | 背包加载 |
| `api` | `loadPlayerInfo:start/response` | 玩家信息加载 |
| `action` | `clickMove:trigger/submit/response/failed` | 移动操作 |
| `action` | `clickMove:blocked` | 物品阻挡移动 |
| `inventory` | `loadInventory:response` | 背包数据到达 |
| `player` | `loadPlayerInfo:response` | 玩家数据到达 |
| `log` | `refreshLog:changed` | 日志内容变化 |
| `error` | `clickMove:error` | 移动异常 |
| `error` | `window:error/unhandledrejection` | 全局错误 |
| `state` | `snapshot` | 每批 flush 附加的状态快照 |

---

## 六、常见开发任务

### 6.1 新增 API 端点

1. [api_v2.php](api_v2.php) — 在 `switch` 添加 case，编写 `handle_xxx()` 函数
2. 只读操作放 api_v2.php，写操作走 command.php

### 6.2 新增 Oblivions 区域

1. [oblivions/gamedata/map.php](oblivions/gamedata/map.php) — 在 `regions` 和 `grids` 中添加新区域条目
2. 创建 `oblivions/gamedata/tiles/region_{$pgroup}.php` — 定义所有地图格
3. 更新上一区域的 `next_region` 指向新区域

### 6.3 修改移动逻辑

1. [oblivions/include/game/move.func.php](oblivions/include/game/move.func.php) — 修改 `obl_move()`
2. 注意：`$pdata` 是引用传递，直接修改 `$pdata['pls']` 等
3. 日志追加到全局 `$log`

### 6.4 新增前端面板

1. [vex/index.html](vex/index.html) — 添加 DOM 结构
2. 创建 `vex/js/xxx.js` — ES Module，import 所需依赖
3. [vex/js/app.js](vex/js/app.js) — import 并在 `loadAll()` 中调用加载函数
4. 如需 HTML onclick，在 app.js 中 `window.xxx = xxx` 暴露

### 6.5 新增游戏指令

1. 后端：在 [include/command/](include/command/) 对应 handler 中添加处理函数
2. 前端：`commandQueue.execute({mode, command, ...})` 提交
3. 成功后 `dataManager.invalidateAll()` + 刷新受影响面板

### 6.6 实现探索/生成系统

1. [oblivions/include/game/explore.func.php](oblivions/include/game/explore.func.php) — 实现 `obl_explore()`
2. [oblivions/include/game/generate.func.php](oblivions/include/game/generate.func.php) — 实现 `obl_generate_region_*()`
3. 在 `obl_post_move_hook()` 中调用
4. 前端：在 map.js 的移动成功回调中增加探索结果面板刷新

---

## 七、已知问题与待办

### 后端

| 项目 | 状态 | 说明 |
|------|------|------|
| `obl_move()` 体力消耗 | `base_cost=0` | 移动不消耗体力，待配置 |
| `obl_post_move_hook()` | TODO | 移动后事件（自动探索/遇敌/事件点/地板效果） |
| `obl_explore()` | TODO | 探索系统 |
| `obl_generate_region_*()` | TODO | 资源生成 |
| 游戏刻 `$gamevars['obl_tick']` | 预留 | 未实现 |
| 跨格移动 | 预留 | `obl_get_move_range()` 固定返回 1 |
| 网状连接 `exit_links` | 预留 | 多出口选择界面 |

### 前端（详见 [vex/DESIGN.md](vex/DESIGN.md)）

| 项目 | 严重度 | 说明 |
|------|--------|------|
| 日志 innerHTML XSS | 中 | `game_log` 返回的 HTML 直接注入，需 sanitize |
| 竞态条件 | 中 | 移动后立即刷新可能拿到旧数据 |
| 无全局加载状态 | 低 | 各面板独立 loading，无协调 |
| 无请求防抖 | 低 | 快速点击可重复提交（commandQueue 部分缓解） |
| 键盘快捷键 | 低 | 按钮标注了但未实现 |
| 移动端适配 | 低 | 固定尺寸，小屏幕截断 |

### 功能缺失

VEX 目前仅覆盖：地图/背包/装备/物品发现/日志。缺失：战斗/聊天/合成/商店/技能/组队/对话/休息/死亡/BGM 等。详见 [vex/DESIGN.md 第四章](vex/DESIGN.md)。

---

## 八、快速定位索引

| 想找什么 | 去哪里 |
|----------|--------|
| Oblivions 模式开关 | [global.func.php](include/core/global.func.php) `oblivions_is_active()` |
| 移动逻辑（Oblivions） | [oblivions/include/game/move.func.php](oblivions/include/game/move.func.php) `obl_move()` |
| 移动逻辑（旧版） | [include/game/search.func.php](include/game/search.func.php) `move()` |
| 移动指令分发 | [include/command/handlers/basic_commands.php](include/command/handlers/basic_commands.php) `cmd_handle_move()` |
| 地图数据定义 | [oblivions/gamedata/map.php](oblivions/gamedata/map.php) + [tiles/](oblivions/gamedata/tiles/) |
| API 端点定义 | [api_v2.php](api_v2.php) |
| 前端地图渲染 | [vex/js/map.js](vex/js/map.js) `renderMapGrid()` |
| 前端数据层 | [vex/js/data-manager.js](vex/js/data-manager.js) `DataManager` |
| 前端命令提交 | [vex/js/utils.js](vex/js/utils.js) `submitCommand()` + [command-queue.js](vex/js/command-queue.js) |
| AI 调试管道 | [vex/js/debug.js](vex/js/debug.js) → [api_v2.php](api_v2.php) `handle_ai_dump_save()` |
| 前端设计文档 | [vex/DESIGN.md](vex/DESIGN.md) |
| Oblivions 设计文档 | [oblivions/docs/地图、移动与探索机制_v1.md](oblivions/docs/地图、移动与探索机制_v1.md) |
| game.php 重定向 | [game.php](game.php#L22) `oblivions_is_active()` → `vex/index.html` |
