# Vex 前端项目 — AI 智能体介入指南

> 帮助 AI 智能体快速了解 Vex 前端项目的架构、模块职责、数据流、API 接口和代码规范。
> 后端参考：[oblivions/CODEBASE.md](../oblivions/CODEBASE.md)

---

## 概念参考

核心概念定义见 [oblivions/CODEBASE.md 第二节](../oblivions/CODEBASE.md#二核心概念词典)。

前端表现：
- **迷雾 (fog)**: fog=0 的格子渲染为 ░░░，fog=1 正常显示
- **潮汐 (tide)**: 影响地图格边框颜色（shallow=灰, deep=黄, abyss=红, safe=绿）
- **地板 (floor)**: 影响地图格背景色和 ASCII 字符
- **发现 (discovered)**: discovered=0 的道具不返回给前端，discovered=2 显示假名+？
- **POI vs 散落道具**: pois[] 和 ground_items[] 两个独立列表，在动作条中以 2 列网格并排显示
- **区域 vs 地图格**: currentRegion 对应 pgroup，currentLocation 对应 pls
- **itempara（七字段规范）**: 玩家道具栏 JSON 数组（index 0=特殊槽，1~itemmaxslots=普通槽），每个元素含 `itm/itmk/itme/itms/itmsk/itmpara/itmid` 七字段。前端丢弃时 `slot` 参数 1~itemmaxslots 对应普通槽
- **结构化日志**: 后端 emit 结构化条目（id+action+params），前端按 ID 查模板渲染，详见第八章
- **战斗日志 (battlelog)**: 与 obl_log 分离的第二套日志，存战斗细节动作。前端按 `enemy_pid` 分组播放，播完调零依赖接口标记 played=1，详见第十四章
- **战斗状态机**: normal/battle 两态，取消 prebattle/ended 中间态。玩家点击敌人 → 纯前端确认界面 → 提交 obl_battle_start 直接进入 battle

---

## 一、项目概述

Vex 是 PHPDTS 大逃杀游戏 **Oblivions 模式** 的专用前端，采用 ASCII 终端风格（黑白灰阶 + CRT 特效），单页应用（SPA），无框架依赖。

**技术栈**：
- ES Modules（原生 JS，无 React/Vue）
- Tailwind CSS v4（构建版，`npm run build` 编译到 `css/output.css`）
- 自定义 CSS（`css/terminal.css` + `css/battle.css`，覆盖 Tailwind 无法处理的部分）
- IBM Plex Mono 等宽字体
- 原生 fetch API

**部署方式**：纯静态文件，`vex/index.html` 直接浏览器打开即可运行，无需构建步骤（开发时用 `npm run dev` 监听 Tailwind 变更）。

---

## 二、目录结构

```
vex/
├── index.html              # SPA 入口（含 Tailwind 类名 + HTML 结构）
├── package.json            # Tailwind CSS v4 构建配置
├── mark_battle_log_played.php  # 零依赖 battlelog 标记接口（无 auth/DB，只文件读写）
├── css/
│   ├── input.css           # Tailwind 源文件（@theme 色板定义）
│   ├── output.css          # Tailwind 编译输出（勿手动编辑）
│   ├── terminal.css        # 自定义样式（CRT/地图格/按钮/动画/日志类/状态栏/模态框/Toast）
│   └── battle.css          # 战斗样式（战斗模态框/碰撞动画/伤害数字/回合光效/确认界面）
├── js/
│   ├── app.js              # 入口：初始化 + 全局事件绑定 + 抽屉/模态框管理
│   ├── data.js             # 全局配置：BASE_URL / DebugBus / mapData / GENDER_NAMES
│   ├── data-manager.js     # 数据层：缓存 + 去重 + 订阅/广播
│   ├── command-queue.js    # 命令队列：防抖 + 锁定 + 冷却（HTTP 请求级锁）
│   ├── map.js              # 地图：渲染 + 移动 + 可达性判定 + 敌人渲染
│   ├── tile-action.js      # 地图格交互：探索/搜索/拾取 + 居中模态框 + Toast
│   ├── inventory.js        # 背包 + 装备渲染 + 丢弃（右侧抽屉）
│   ├── player.js           # 玩家信息（左侧抽屉，含 AP 条 + oblpara.killnum）+ 状态栏渲染
│   ├── log.js              # 日志：结构化渲染 + 增量检测 + Toast 触发
│   ├── toast-position.js   # Toast 位置管理：isAnyOverlayOpen + updateToastPosition
│   ├── battle.js           # 战斗状态机：normal/battle 切换 + battlelog 拉取/分组/播放/标记
│   ├── battle-modal.js     # 战斗模态框：播放 battlelog + 打字机效果 + 自动关闭
│   ├── battle-animation.js # 战斗碰撞动画：冲刺 + 抖动 + 残留伤害数字
│   ├── battle-render.js    # 战斗渲染：BattleLogEntry → HTML + 动作按钮
│   ├── utils.js            # 工具：escapeHtml / API请求 / 命令提交
│   └── debug.js            # AI调试模块（仅 ?debug=ai 时加载）
├── data/
│   ├── log-templates.js    # 结构化日志模板配置（40 个 ID）+ renderLogEntry
│   └── terrain-desc.js     # 地形描述词库（迁移自后端）+ generateTerrainDesc
└── docs/                   # 设计文档
```

---

## 三、模块依赖图

```
app.js
  ├── map.js ──────────┐
  ├── inventory.js ────┤
  ├── tile-action.js ──┤── data-manager.js ── data.js
  ├── player.js ───────┤── command-queue.js ── utils.js
  ├── log.js ──────────┤── toast-position.js ──┘
  └── battle.js ───────┤── battle-modal.js ── battle-render.js
                       │   battle-animation.js
                       └── data/log-templates.js ── data/terrain-desc.js
```

**关键依赖**：
- 所有面板模块依赖 `data-manager.js`（订阅刷新）和 `data.js`（全局状态）
- 所有写操作依赖 `command-queue.js`（防重复提交，HTTP 请求级锁）
- `utils.js` 提供 `gameApi()`（只读）和 `submitCommand()`（写操作）
- `player.js` 同时负责状态栏渲染和左侧玩家抽屉
- `log.js` 依赖 `log-templates.js`（渲染）和 `toast-position.js`（Toast 触发判定）
- `tile-action.js` / `app.js` / `player.js` 都依赖 `toast-position.js`（2 级页面开关时更新 Toast 位置）
- `log-templates.js` 依赖 `terrain-desc.js`（无名格描述生成）
- `battle.js` 依赖 `battle-modal.js`（模态框播放）+ `battle-animation.js`（碰撞动画）+ `battle-render.js`（渲染）
- `battle-modal.js` 依赖 `battle-render.js`（BattleLogEntry → HTML）

---

## 四、数据流

### 4.1 读取流

```
页面加载 → app.js:loadAll()
  → loadMap()                    // gameApi('game_map')
    → mapData 更新
    → dataManager.broadcast('map:loaded')
      → inventory.js: loadInventory()   // 订阅 map:loaded
      → tile-action.js: loadTileAction() // 订阅 map:loaded
      → log.js: refreshLog()            // 订阅 map:loaded
  → loadInventory()              // gameApi('player_inventory')
  → loadTileAction()             // gameApi('tile_actions')
  → refreshLog()                 // gameApi('obl_log')
  → loadPlayerInfo()             // gameApi('player_info') → 渲染状态栏
  → refreshBattle()              // 检测 action 状态，进入/退出战斗模式
```

### 4.2 写入流

```
用户操作 → commandQueue.execute(params)
  → submitCommand(params)        // POST command.php
  → 成功后:
    dataManager.invalidateAll()  // 清缓存
    await loadMap()              // 重新拉取地图
    dataManager.broadcast('game:action-completed')
      → inventory.js: loadInventory()   // 订阅 game:action-completed
      → tile-action.js: loadTileAction() // 订阅 game:action-completed
      → log.js: refreshLog()            // 订阅 game:action-completed（含 Toast 触发）
      → player.js: loadPlayerInfo()     // 订阅 game:action-completed（渲染状态栏+抽屉打开时更新内容）
      → battle.js: refreshBattle()      // 订阅 game:action-completed（检测遭遇战）
```

### 4.3 战斗数据流（played 标记机制）

```
后端 emit battlelog（played=0）
  → obl_battle_log_persist() 追加到文件
  → 命令响应只返回 {}（不附带 battlelog）

前端 fetchAndPlayBattleLog()
  → gameApi('battle_log') → 返回 played=0 的条目
  → 按 enemy_pid 分组
  → 逐组三阶段播放：
    1. 碰撞动画（地图上，冲刺+抖动，无伤害数字）
    2. 模态框（中央遮罩，逐条播放 battlelog，含伤害信息）
    3. 残留伤害数字（地图格上，模态框关闭后淡入显示）
  → POST mark_battle_log_played.php 标记 played=1
  → 若仍是玩家回合，显示"你的回合"Toast + 动作按钮 turn-active 光效
```

### 4.4 事件清单

| 事件名 | 触发者 | 订阅者 | 说明 |
|--------|--------|--------|------|
| `map:loaded` | map.js | inventory, tile-action, log | 地图数据加载完成 |
| `game:action-completed` | map.js, tile-action.js, inventory.js, battle.js | inventory, tile-action, log, player, battle | 任何游戏操作成功后 |
| `map:click-current` | map.js | tile-action.js | 点击当前格触发探索 |
| `ui:toast` | 各模块（含 battle.js） | tile-action.js | 显示 Toast 通知 |
| `battle:ended` | battle.js | （map.js 等监听刷新） | 战斗结束，触发地图和动作条刷新 |

---

## 五、API 接口

### 5.1 只读 API（GET `api_v2.php?action=xxx`）

| action | 返回数据 | 消费模块 |
|--------|---------|---------|
| `game_map` | 地图网格+连通性+迷雾+区域信息 | map.js |
| `tile_actions` | 当前格 POI + 脚边道具 | tile-action.js |
| `player_inventory` | 背包槽位（itempara 渲染） + 装备 | inventory.js |
| `player_info` | 玩家属性 + AP + 装备 + oblpara（含 killnum）+ groomid | player.js（状态栏+抽屉）, inventory.js, battle.js |
| `obl_log` | 结构化日志条目数组（LogEntry[]） | log.js |
| `battle_log` | 战斗日志条目数组（BattleLogEntry[]，played=0） | battle.js |
| `enemies` | 当前区域敌人列表 | map.js（敌人渲染）, battle.js（敌人名称查询） |

**`player_info` 字段说明**（Oblivions 模式独立数据层 `bra_oblplayers`）：
- 基本信息：`pid`/`type`/`name`/`gd`/`icon`
- **房间 ID**：`groomid`（供前端调用零依赖接口如 `mark_battle_log_played.php`）
- 战斗状态：`action`/`bid`
- 战斗属性：`hp`/`mhp`/`sp`/`msp`/`att`/`def`
- **AP（Oblivions 专属）**：`ap`/`max_ap`
- 位置与进度：`pgroup`/`pls`/`lvl`/`exp`/`upexp`/`state`
- 道具栏：`itemmaxslots`（道具栏上限，道具详情走 `player_inventory`）
- **Oblivions 专属 JSON 字段**：`tacpara`/`skillpara`/`oblpara`（含 `killnum`/`battle` 等杂项数据）
- 装备：`equipment`（7 槽 × 6 字段：wep/wep2/arb/arh/ara/arf/art）

> **注**：传统模式字段（race/club/nick/money/rage/pose/tactic/killnum/skills 等）在 Oblivions 模式下不再返回。`killnum` 改为从 `oblpara.killnum` 读取。

### 5.2 写入 API（POST `command.php`）

所有写操作通过 `commandQueue.execute(params)` 提交，params 格式：

```javascript
// 探索
{ mode: 'command', command: 'obl_explore' }

// 搜索 POI
{ mode: 'command', command: 'obl_search', iaid: number }

// 拾取道具
{ mode: 'command', command: 'obl_pickup', iid: number }

// 丢弃背包道具
{ mode: 'command', command: 'obl_discard', slot: number }  // slot: 1~itemmaxslots

// 移动
{ command: 'move', moveto: number }  // moveto = 目标格 pls

// 玩家主动攻击（直接进入 battle 状态，取消 prebattle）
{ command: 'obl_battle_start', enemy_pid: number }

// 战斗动作（玩家先攻轮）
{ command: 'obl_battle_action', action_id: 'unarmed_strike' }
```

### 5.3 响应格式

只读 API：
```json
{ "status": "success"|"error", "data": {...} }
```

写入 API（Oblivions 模式）：
```json
{}
```

**说明**：Oblivions 模式下 `command.php` 仅做模式判定后委托给 `oblivions/include/core/obl_command.php`，响应只返回空 JSON `{}`。前端不依赖命令响应获取业务数据，而是通过 `dataManager.invalidateAll()` + 重新拉取只读 API 获取最新状态。

**并发冲突响应**：若同一玩家同时提交多个命令，后端 `flock` 锁会拒绝后续请求：
```json
{ "error": "COMMAND_IN_PROGRESS" }
```
前端 `commandQueue.execute()` 会将此视为失败，但 `isProcessingBattle` 全生命周期锁通常会在前端就拦截重复点击。

> **注**：传统模式下 `command.php` 仍返回 `{ "success": ..., "gamedata": {...}, "timer": ... }` 格式，但 Vex 前端仅在 Oblivions 模式下运行，不消费这些字段。`utils.js:submitCommand()` 仍兼容解析 JSON 响应，但 Oblivions 模式下 `gamedata` 为空对象。

### 5.4 `obl_log` 响应格式

```json
{
  "status": "success",
  "data": {
    "entries": [LogEntry, ...],
    "total": 42
  }
}
```

**LogEntry 结构**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 细粒度 ID，命名规则 `{logcategory}.{subevent}`，如 `move.success`、`pickup.bag_full` |
| `logcategory` | string | 粗粒度日志类别，8 类之一：`move`/`explore`/`search`/`pickup`/`discard`/`system`/`enemy`/`battle` |
| `params` | object | 模板参数，值限 string/number/boolean。可为空对象 `{}` |
| `html` | string\|null | fallback HTML，正常为 `null` |
| `debug` | bool | 是否为 debug 日志，前端默认不渲染（`?debug=ai` 模式下显示并加 `[DBG]` 前缀） |
| `ts` | number | Unix 秒级时间戳，用于排序和增量检测 |

- `entries`：按时间正序（旧→新）
- `total`：当前存储的条目总数（正式日志 200 条 + debug 日志 50 条，分开计数）

### 5.5 `battle_log` 响应格式

```json
{
  "status": "success",
  "data": {
    "entries": [BattleLogEntry, ...],
    "total": 3
  }
}
```

**只返回 `played=0` 的条目**。

**BattleLogEntry 结构**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 固定 `'battle.action'` |
| `log_id` | int | 文件内自增 ID，用于标记 played |
| `turn` | int | 先攻轮序号（0=战斗开始/结束，1+=回合 N） |
| `actor` | string | 行动方标识（`'player'` 或 `'enemy_{pid}'`） |
| `action_id` | string | 动作 ID（`unarmed_strike`/`escape`/`battle.start`/`initiative.roll`/`battle.end`） |
| `action_name` | string | 动作显示名 |
| `target` | string | 目标标识 |
| `effect_value` | int | 效果值（伤害值等） |
| `extra` | object\|null | 额外信息 |
| `enemy_pid` | int | 战斗对象 PID（前端按战斗分组播放） |
| `played` | int | 0=未播放（API 总是返回 0） |
| `ts` | int | Unix 时间戳 |

### 5.6 `mark_battle_log_played.php` — 零依赖标记接口

**独立文件**（不走 `api_v2.php`），位于 `vex/mark_battle_log_played.php`。

- **请求**: `POST vex/mark_battle_log_played.php`
- **Content-Type**: `application/x-www-form-urlencoded`
- **参数**:
  - `groomid` (int) — 房间 ID
  - `pid` (int) — 玩家 ID
  - `log_ids` (逗号分隔字符串) — 要标记的 log_id 数组
- **响应**: `{ "success": true, "marked": N }`

**前端调用**（`battle.js: markBattleLogPlayed()`）：
```javascript
const body = new URLSearchParams();
body.append('groomid', currentGroomid);
body.append('pid', currentPid);
body.append('log_ids', logIds.join(','));

await fetch(BASE_URL + '/vex/mark_battle_log_played.php', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
});
```

**零依赖设计**：不依赖任何游戏框架（无 auth/DB），只文件读写。安全性靠 `(int)` 强制转换防路径遍历。设计理由：mark 请求即使被伪造也无严重后果（最多让玩家少看一条 battlelog）。

### 5.7 `enemies` 响应格式

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

**字段说明**：
- `enemies[]`：当前区域已发现的敌人列表（`discovered=1` 且 `state=0` 存活）
- 若玩家处于战斗状态（`action='battle'`），确保返回战斗对象（即使 `discovered=0`）
- 字段由后端 `obl_simplify_enemy_data()` 精简，仅返回前端渲染所需字段

**敌人渲染逻辑**（map.js）：
- 仅 `discovered=1` 的敌人在地图上渲染（敌人移动超出玩家视野后自动从列表移除）
- 敌人图标渲染在对应 `(pgroup, pls)` 格子上，带 `data-enemy-pid` 属性供战斗动画定位
- 战斗状态下（`action='battle'`），战斗对象始终显示（即使 `discovered=0`）
- 敌人 HP 条显示在图标下方（`hp`/`mhp`）

---

## 六、全局状态

### 6.1 `mapData`（data.js 导出）

```javascript
export const mapData = {
    curLoc: null,      // 当前格 pls（整数）
    curRegion: null,   // 当前区域 pgroup（整数）
    links: null,       // 地图完整数据（game_map API 返回的 links 字段）
};
```

`links` 结构：
```javascript
links = {
    regions: { [pgroup]: { name, entrance_pls, exit_pls, prev_region, next_region } },
    tiles:   { [pgroup]: { [pls]: { name, neighbors, x, y, passable, floor, tide } } },
    grids:   { [pgroup]: { cols, rows } },
    fog:     { [pgroup]: { [pls]: 0|1 } },   // 0=迷雾 1=已点亮
}
```

### 6.2 DataManager（data-manager.js 导出单例）

- `fetch(action, forceRefresh)` — 带缓存+去重的 API 请求（TTL 2秒）
- `invalidate(action)` / `invalidateAll()` — 清缓存
- `subscribe(action, callback)` — API 数据变更通知
- `broadcast(event, data)` / `listen(event, callback)` — 语义事件

### 6.3 CommandQueue（command-queue.js 导出单例）

- `execute(params)` — 提交命令，自动锁定+冷却
- `isLocked` — 当前是否锁定中
- `remainingCooldown` — 剩余冷却毫秒数

**注意**：`_locked` 仅覆盖 HTTP 请求期间，不覆盖"播放 battlelog + 刷新状态"的全生命周期。全生命周期锁由 `battle.js: isProcessingBattle` 负责（详见 14.4）。

### 6.4 Battle 模块状态（battle.js 内部）

```javascript
let currentMode = 'normal';        // 'normal' | 'battle'
let currentBid = 0;                // 当前战斗对象 PID
let currentEnemyName = '';         // 当前战斗对象名称
let currentGroomid = 0;            // 当前房间 ID（用于 mark 接口）
let currentPid = 0;                // 当前玩家 PID（用于 mark 接口）
let isPlayingBattleLog = false;    // 是否正在播放 battlelog（防重入）
let isProcessingBattle = false;    // 命令处理中（全生命周期锁，屏蔽快速重复点击）
```

---

## 七、UI 组件

### 7.1 页面布局

```
┌──────────────────────────────────────────────────────────┐
│ STATUS BAR (80px)                                        │
│ ┌──────────────────────────────────┐  ┌───────────────┐ │
│ │ 垃圾平原     ████████░░ HP 400  │  │               │ │
│ │ 废旧轮胎山   ██████░░░░ SP 12   │  │    头像       │ │
│ │ [属性]                    [背包] │  │   140×80      │ │
│ └──────────────────────────────────┘  └───────────────┘ │
├──────────────────────────┬───────────────────────────────┤
│ LEFT (65%)               │ RIGHT (35%)                   │
│ ┌──────────────────────┐ │ ┌───────────────────────────┐ │
│ │ CARTOGRAPHY          │ │ │ 探索模式：CHRONICLE + ACTIONS │
│ │ (地图网格)            │ │ │ 战斗模式：vs 敌人名 + 动作按钮│
│ │                      │ │ │ (battleMode 切换)         │ │
│ │                      │ │ └───────────────────────────┘ │
│ └──────────────────────┘ │                               │
├──────────────────────────┴───────────────────────────────┤
│ 浮动组件：左侧抽屉(玩家属性) / 右侧抽屉(背包+装备)       │
│           居中模态框(POI搜索/道具拾取)                    │
│           战斗模态框(battlelog 播放)                      │
│           战斗确认界面(玩家主动攻击)                      │
│           Toast通知                                      │
└──────────────────────────────────────────────────────────┘
```

### 7.2 状态栏结构

状态栏由 `player.js` 统一渲染（`renderStatusBar()`），三行布局：

| 行 | 左侧 | 右侧 |
|----|------|------|
| 1 | 区域名 (`#regionInfo`) | HP 可视化条 + 数值 (`#hpBar` / `#hpText`) |
| 2 | 地图格名 (`#locationInfo`) | SP 可视化条 + 数值 (`#spBar` / `#spText`) |
| 3 | `[属性]` 按钮 (`#playerDrawerBtn`) | `[背包]` 按钮 (`#inventoryDrawerBtn`) |

右侧固定头像框 (`#statusAvatar`)，140×80px，图片路径 `/phpdts/img/{gd}_{icon}.gif`。

HP/SP 条：CSS 窄条（6px 高），HP 正常灰色 `#888`，HP<30% 白色闪烁；SP 暗灰 `#555`。

### 7.3 交互组件

| 组件 | 触发 | 位置 | 说明 |
|------|------|------|------|
| 左侧抽屉 | `[属性]` 按钮 | 页面左侧滑出 | 玩家属性详情（VITALITY/STAMINA/ACTION POINTS/EXPERIENCE 四条进度条 + ATK/DEF/KILLS/POS/STATE + PROFILE） |
| 右侧抽屉 | `[背包]` 按钮 | 页面右侧滑出 | 背包(INVENTORY) + 装备(ARMAMENT) 标签切换 |
| 居中模态框 | POI/脚边道具点击 | 画面中央 | 360px 宽，半透明遮罩，scale 动画 |
| 战斗模态框 | battlelog 播放 | 画面中央 | 半透明遮罩 + 双方 HP 条 + 逐条打字机显示 battlelog，详见 14.3 |
| 战斗确认界面 | 玩家点击敌人攻击 | 画面中央 | "是否攻击 [敌人名]？" + [攻击]/[取消] 按钮，纯前端确认 |
| 碰撞动画 | battlelog 播放阶段 1 | 地图格上 | 攻击方冲刺 + 受击方抖动，详见 14.5 |
| 残留伤害数字 | battlelog 播放阶段 3 | 地图格上 | 模态框关闭后淡入显示，2s 后淡出 |
| 回合光效 | 玩家回合时 | 动作按钮 | 边框渐变 + 内发光呼吸动画（2s 周期） |
| Toast | `ui:toast` 事件 / 日志增量 / 战斗回合提示 | 动态位置（右上/左上/中上/header下方） | 自动消失通知，同类合并，详见第八章 |
| 未读日志提示 | `forceScroll=false` + 新日志 | CHRONICLE 标题栏右侧 | `↓ N 条新日志`，点击滚动到底部，详见 8.4 |

### 7.4 动作条 (ACTIONS)

**探索模式**（`#normalMode`）：
1. **常驻按钮区**：`[E] 探索周围`、`前往下一区域`（满宽）
2. **交互网格区**：2 列网格 (`.poi-grid`)，脚边道具和 POI 并排显示
3. **空状态**：无可交互对象时显示"此处无可交互对象"

**战斗模式**（`#battleMode`）：
1. **标题区**：`vs [敌人名]`（`#battleEnemyName`）
2. **动作按钮区**（`#battleActionBar`）：
   - 玩家回合：渲染 `[空手攻击]` + `[逃跑]` 按钮，带 `turn-active` 光效
   - NPC 回合：渲染"敌人正在行动..."等待提示

### 7.5 DOM ID 索引

| ID | 所在文件 | 用途 |
|----|---------|------|
| `regionInfo` | index.html | 区域名（状态栏第1行左侧） |
| `locationInfo` | index.html | 地图格名（状态栏第2行左侧） |
| `hpBar` / `hpText` | index.html | HP 可视化条 / 数值文字 |
| `spBar` / `spText` | index.html | SP 可视化条 / 数值文字 |
| `playerDrawerBtn` | index.html | [属性] 按钮（开左侧抽屉） |
| `inventoryDrawerBtn` | index.html | [背包] 按钮（开右侧抽屉） |
| `statusAvatar` | index.html | 头像容器（140×80） |
| `mapGrid` | index.html | 地图网格容器（map.js 渲染） |
| `mapInfo` | index.html | 地图状态行（LOC/REGION） |
| `normalMode` | index.html | 探索模式容器（tile-action.js 渲染） |
| `tileActionBar` | index.html | 探索模式动作条容器 |
| `battleMode` | index.html | 战斗模式容器（battle.js 切换显示） |
| `battleEnemyName` | index.html | 战斗模式标题（vs 敌人名） |
| `battleActionBar` | index.html | 战斗模式动作按钮容器 |
| `battleModalOverlay` | index.html | 战斗模态框遮罩 |
| `battleModal` | index.html | 战斗模态框主体 |
| `battleModalEnemyName` / `battleModalPlayerName` | index.html | 战斗模态框双方名称 |
| `battleModalEnemyHpFill` / `battleModalEnemyHpText` | index.html | 战斗模态框敌人 HP 条/文字 |
| `battleModalPlayerHpFill` / `battleModalPlayerHpText` | index.html | 战斗模态框玩家 HP 条/文字 |
| `battleModalBody` | index.html | 战斗模态框正文（battlelog 逐条显示） |
| `battleConfirmOverlay` | index.html | 战斗确认界面遮罩 |
| `battleConfirmEnemyName` | index.html | 战斗确认界面敌人名 |
| `battleConfirmYes` / `battleConfirmNo` | index.html | 战斗确认界面 [攻击] / [取消] 按钮 |
| `logContent` | index.html | 日志容器（log.js 渲染） |
| `inventoryList` | index.html | 背包容器（inventory.js 渲染） |
| `equipment` | index.html | 装备容器（inventory.js 渲染） |
| `playerInfo` | index.html | 左侧抽屉内容容器（player.js 渲染） |
| `modalOverlay` | index.html | 居中模态框遮罩（POI/道具） |
| `modalBox` | index.html | 居中模态框主体 |
| `modalTitle` / `modalBody` | index.html | 居中模态框标题 / 内容区 |
| `toastContainer` | index.html | Toast 容器（动态定位） |
| `drawerOverlay` | index.html | 左抽屉遮罩 |
| `invDrawerOverlay` | index.html | 右抽屉遮罩 |
| `playerDrawer` | index.html | 左侧抽屉主体（玩家属性） |
| `inventoryDrawer` | index.html | 右侧抽屉主体（背包+装备） |

---

## 八、日志与反馈系统

### 8.1 设计原则

本节记录跨会话讨论沉淀的认知共识，避免重复歧义。新增功能或修改现有逻辑前必读。

#### 8.1.1 `forceScroll` 的语义

`forceScroll` 不是"是否滚动"的技术参数，而是"这次刷新是否代表玩家主动操作"的语义标记。

| `forceScroll` | 语义 | 场景 | 行为 |
|---------------|------|------|------|
| `true`（默认） | 玩家主动操作，需要立刻看到反馈 | `game:action-completed` | 强制滚动到底部 + 清零未读 |
| `false` | 被动刷新，不应打断玩家 | `map:loaded`、未来的自动轮询 | 尊重位置：在底部则滚动，不在底部则累加未读 |

**关键决策**：`map:loaded` 改为 `forceScroll=false`。理由：玩家操作后 `game:action-completed` 已经负责强制滚动，`map:loaded` 再强制一次是冗余；首次加载时 `isAtBottom=true`，仍会自动滚动到底部。

**新增调用点的判断规则**：未来新增 `refreshLog` 调用点时，判断这次刷新是"玩家主动触发"还是"被动通知"：
- 玩家主动操作（点击移动、探索、拾取等）→ `forceScroll=true`
- 被动通知（自动轮询、WebSocket 推送、NPC 事件等）→ `forceScroll=false`
- 判断错误会导致：要么打断玩家翻看历史，要么玩家看不到新反馈

#### 8.1.2 新日志高亮的"够用即可"原则

高亮的目标是"提示玩家最新操作结果在哪"，**不是**"精确标记哪些是本次新增的"。

**决策**：只给 `entries` 数组最后一条加 `log-new` 类，不做 `ts > prevLastTs` 的增量判断。

**理由**：
- 增量判断需要处理首次加载保护、200 条裁剪、ts 相等等边界，复杂度高
- 视觉上多条同时高亮反而分散注意力
- 玩家真正关心的是"最后一条"（最新操作结果），不是"这次刷新新增了几条"
- `prevLastTs` 增量检测仍保留，但只服务于 Toast 触发，不参与高亮

#### 8.1.3 Toast 同类合并的"相邻"语义

合并只看容器内**最后一个** Toast 是否同类，不做全局聚合。

**合并条件**：`lastElementChild.mergeId === mergeId && toastType === type`

**不合并的情况**：
- 不同 ID 交替出现（如 `pickup.success` → `pickup.bag_full` → `pickup.success`）不会合并中间那条
- Toast 消失后合并链断裂，再来同 ID 会创建新 Toast

**为什么不做全局聚合**：会破坏时间顺序语义，玩家会困惑"为什么刚才的 Toast 计数突然变了"。相邻合并是"批量操作刷屏"这个具体痛点的最小解决方案。

#### 8.1.4 `showToast` 的 `mergeId` 可选性

`mergeId` 是可选参数，不传时保持原有行为（不合并）。

**调用规则**：
- 日志触发的 Toast 传 `mergeId = entry.id`（启用合并）
- `ui:toast` 事件触发的 Toast 不传 `mergeId`（不合并，保持兼容）

**新增 Toast 调用点的判断规则**：
- 同一操作可能批量触发的同类反馈 → 传 `mergeId`（如拾取、搜索）
- 独立的一次性通知 → 不传 `mergeId`（如"移动失败"、"体力不足"、"你的回合"）

#### 8.1.5 `log-entry` 的 display:block 决策

日志条目用 `display: block` 而非 `inline` + `<br>` 分隔。

**理由**：
- inline 元素的 `background` 只覆盖文字部分，换行时背景断裂
- block 元素背景覆盖整行，高亮动画可靠
- **警告**：如果改回 inline（比如想做行内紧凑布局），高亮动画会失效

### 8.2 结构化日志渲染

**数据源**：`obl_log` API 返回的 `LogEntry[]`（详见 5.4）

**渲染流程**：
```
refreshLog()
  → gameApi('obl_log')
  → entries.forEach(entry => renderLogEntry(entry))
    → 查 LOG_TEMPLATES[entry.id]
      → 有 render 函数 → 调用 render(params)
      → 有 text 模板 → 替换 {param} 占位符 + 应用高亮
      → 未知 ID → 显示 [未知日志] 占位
  → 每条包裹 <span class="log-entry">（block 布局，独占一行）
  → 最后一条加 log-new 类（1.5s 高亮动画）
  → 写入 #logContent
```

**关键文件**：
- `data/log-templates.js`：40 个 ID 的模板配置 + `renderLogEntry(entry)` 函数
- `data/terrain-desc.js`：无名格描述词库 + `generateTerrainDesc(floor, tide, passable)`
- `js/log.js`：拉取日志 + 渲染 + 增量检测 + Toast 触发 + 新日志高亮 + 未读提示

**日志类别标签映射**（`log.js` 的 `LOGCATEGORY_TAGS`）：

| logcategory | 标签 |
|--------|------|
| `move` | `[MOV]` |
| `explore` | `[EXP]` |
| `search` | `[SRC]` |
| `pickup` | `[PKG]` |
| `discard` | `[DSC]` |
| `enemy` | `[EMY]` |
| `battle` | `[BTL]` |
| `system` | `[SYS]` |

**debug 日志**：`entry.debug === true` 的条目默认不渲染。`?debug=ai` 模式下显示，加 `[DBG]` 前缀 + `opacity: 0.5` 暗化样式（`.log-debug` / `.log-tag-dbg`）。debug 日志不触发 Toast、不计入未读计数。

**样式控制**：日志颜色/高亮完全由前端模板控制（`<span class="yellow">` 等），后端不输出样式标记。颜色映射见 9.4。

### 8.3 新日志高亮

**目标**：提示玩家最新操作结果在哪（详见 8.1.2 设计原则）。

**实现**：
- 渲染时 `entries` 数组最后一条加 `log-new` 类
- CSS 动画 `log-new-flash`：1.5s 内背景从 `rgba(255,255,255,0.18)` 淡出到透明 + 左侧 2px 白色色条（`box-shadow inset`）淡出
- `ease-out` 缓动，前半段快速衰减
- 动画结束后不需要移除类（`innerHTML` 重渲染会自然清除）

**CSS 类**：
- `.log-entry`：`display: block`，每条日志独占一行（详见 8.1.5）
- `.log-new`：触发 `log-new-flash` 动画

### 8.4 未读日志提示按钮

**解决问题**：`forceScroll=false` 场景下，玩家翻看历史时新日志进来不知道。

**机制**（`log.js`）：
- 模块级状态：`unreadCount`（未读计数）、`isAtBottom`（是否在底部）
- `forceScroll=false` + 不在底部 + 有新日志 → 累加 `unreadCount`，显示提示按钮
- 玩家手动滚动到底部 或 点击提示按钮 → 清零 `unreadCount`，隐藏按钮

**提示按钮**（`#logUnreadBtn`）：
- 位置：CHRONICLE 标题栏右侧（`┐` 之前）
- 文案：`↓ N 条新日志`
- 样式：`.log-unread-btn`（白色文字 + 灰色边框，终端风格）
- 点击：调用 `scrollToBottom()`（滚动到底部 + 清零未读）

**滚动监听**（`initLog()`，由 `app.js:loadAll()` 调用）：
- 绑定 `scroll` 事件到 `#logContent` 的父级（滚动容器）
- 滚动到底部附近（< 50px）时自动清零未读

### 8.5 Toast 即时反馈系统

**解决问题**：2 级页面（模态框/抽屉）打开时，全屏遮罩遮挡日志区，玩家看不到操作反馈。

**核心机制**：利用结构化日志作为单一数据源，在 2 级页面打开期间，根据日志增量触发 Toast 即时反馈。零布局改动，操作函数零侵入。

**触发流程**：
```
玩家在 2 级页面操作（如拾取）
  → commandQueue.execute() → 后端 obl_pickup
  → 后端 $obl_log->emit('pickup.bag_full', ...) → 持久化
  → command.php 响应 → broadcast('game:action-completed')
  → refreshLog() 触发
  → 拉取 obl_log API → 增量检测（ts > prevLastTs）
  → isAnyOverlayOpen() === true → 查 TOAST_RULES 白名单
  → 匹配白名单 → showToast(content, style, 2000, isHtml=true, mergeId=entry.id)
  → Toast 在动态位置显示 2s（同类合并，详见 8.1.3）
```

**增量检测**（`log.js`）：
- 模块级变量 `lastTs` 记录上次拉取的最大 ts
- `prevLastTs = lastTs`（渲染前记录，作为 Toast 增量的分界线）
- `newEntries = entries.filter(e => e.ts > prevLastTs)`
- 首次加载保护：`lastTs` 初始为 0，但首次拉取时无 2 级页面打开，自然不触发 Toast

**白名单规则**（`log.js` 的 `TOAST_RULES`）：
- 仅 `pickup.*` / `search.*` / `discard.*` 的成功/失败 ID 触发
- `move.*` 不触发（地图变化已足够明显）
- 完整白名单见 `log.js` 源文件

**Toast 位置动态切换**（`toast-position.js`）：

| 2 级页面状态 | Toast 位置 | CSS class |
|-------------|-----------|-----------|
| 无（默认） | 右上角 | （无 class） |
| 开左抽屉（属性） | 右上角（保持默认） | （无 class） |
| 开右抽屉（背包） | 左上角 | `.pos-left` |
| 开模态框 | 中上 | `.pos-center` |
| 战斗模态框关闭后（你的回合提示） | header 下方（水平居中） | `.pos-screen-center` |

优先级：`模态框 > 右抽屉 > 左抽屉/默认`。

`.pos-screen-center` 是战斗模块专用的临时位置：战斗模态框关闭后显示"你的回合"Toast，2.5s 后自动移除该 class 恢复默认位置。

**位置切换时机**：在 `openModal`/`closeModal`/`openInvDrawer`/`closeInvDrawer`/`toggleDrawer`/`closeDrawer` 等函数末尾调用 `updateToastPosition()`。

**集中管理原因**：为避免 `log.js`/`tile-action.js`/`app.js`/`player.js` 之间循环依赖，新建 `toast-position.js` 集中管理 `isAnyOverlayOpen()` + `updateToastPosition()`。

### 8.6 Toast 显示与同类合并

**`showToast(message, type, duration, isHtml, mergeId)`**（`tile-action.js`）：
- `type`：`'error'`（[ERR]）/ `'success'`（[OK]）/ `'info'`（[i]）
- `duration`：默认 2000ms，到时自动移除（300ms 淡出动画）
- `isHtml`：默认 `false`（转义纯文本）；日志触发时传 `true`（`renderLogEntry` 输出含高亮 span）
- `mergeId`：可选，传入日志 ID 时启用同类合并（详见 8.1.3、8.1.4）

**同类合并逻辑**：
- 传入 `mergeId` 时，检查容器内最后一个 Toast 是否同类（相同 `mergeId` + 相同 `type`）
- 同类：更新计数（`×N`），重置消失计时器
- 不同类或无 `mergeId`：创建新 Toast
- 合并计数显示在 `.toast-count` 元素中

**Timer 管理**：合并时通过 `dataset.timerId` 存储计时器 ID，便于 `clearTimeout` 重置。

---

## 九、CSS 架构

### 9.1 三层样式

| 层 | 文件 | 内容 |
|----|------|------|
| Tailwind 编译 | `css/output.css` | 工具类 + 主题 token（由 `input.css` 编译） |
| Tailwind 源 | `css/input.css` | `@theme` 色板定义（bg/fg-dim/fg-mid/fg-bright/fg-glow/hi） |
| 自定义 | `css/terminal.css` | CRT 特效、地图格、按钮、动画、日志类、状态栏、模态框、抽屉、Toast |
| 自定义 | `css/battle.css` | 战斗模态框、碰撞动画、伤害数字、回合光效、战斗确认界面 |

### 9.2 Tailwind 主题色

```css
/* input.css @theme */
--color-bg: #0a0a0a;        /* 纯黑底 */
--color-fg-dim: #444;       /* 暗灰（边框/标签） */
--color-fg-mid: #888;       /* 中灰（正文） */
--color-fg-bright: #bbb;    /* 亮灰（标题/强调） */
--color-fg-glow: #eee;      /* 近白（道具名/高亮） */
--color-hi: #fff;           /* 纯白（当前格/按钮hover） */
```

### 9.3 JS 动态生成的 CSS 类名

JS 中拼接 HTML 时使用语义短类名（定义在 `terminal.css` / `battle.css`），不用 Tailwind 工具类：

| 类名 | 用途 | 定义位置 |
|------|------|---------|
| `.map-cell` / `.reachable` / `.fogged` / `.blocked` / `.current` | 地图格状态 | terminal.css |
| `.term-btn` / `.term-btn.block` / `.term-btn.discard` | 终端风格按钮 | terminal.css |
| `.tile-row` / `.tile-tag` / `.tile-name` | 动作条行 | terminal.css |
| `.tile-explore-row` | 探索按钮行（居中） | terminal.css |
| `.poi-grid` | POI + 脚边道具 2 列网格 | terminal.css |
| `.slot-card` / `.slot-filled` / `.slot-empty` | 背包格 | terminal.css |
| `.eq-slot` / `.eq-label` / `.eq-name` | 装备槽 | terminal.css |
| `.modal-item` / `.item-tag` / `.item-name` | 模态框道具行 | terminal.css |
| `.toast-container` / `.toast-container.pos-left` / `.toast-container.pos-center` / `.toast-container.pos-screen-center` | Toast 容器（动态定位） | terminal.css |
| `.toast` / `.toast.show` / `.toast-error` / `.toast-success` | Toast 通知 | terminal.css |
| `.log-tag` / `.log-content .yellow` 等 | 日志样式 | terminal.css |
| `.status-bar` / `.status-bar-row` / `.bar-fill` / `.bar-container` | 状态栏 | terminal.css |
| `.status-avatar` / `.status-avatar-fallback` | 头像框 | terminal.css |
| `.modal-overlay` / `.modal-box` | 居中模态框 | terminal.css |
| `.battle-modal-overlay` / `.battle-modal` / `.battle-modal-header` / `.battle-modal-body` | 战斗模态框 | battle.css |
| `.battle-modal-hp-fill` / `.battle-modal-hp-text` | 战斗模态框 HP 条 | battle.css |
| `.battle-log-entry` / `.battle-log-entry.shown` / `.turn-divider` | 战斗模态框日志条目 | battle.css |
| `.battle-confirm-overlay` / `.battle-confirm-btn` | 战斗确认界面 | battle.css |
| `.attack-lunge` | 攻击方冲刺动画 | battle.css |
| `.hit-shake` | 受击方抖动动画 | battle.css |
| `.damage-number` / `.damage-number.heal` | 碰撞动画伤害数字（浮起） | battle.css |
| `.damage-number-linger` | 模态框关闭后残留伤害数字（淡入淡出） | battle.css |
| `.action-btn.turn-active` | 玩家回合动作按钮光效（边框渐变 + 内发光呼吸） | battle.css |
| `.battle-active`（body class） | 战斗模式全界面边框光效 | battle.css |
| `.battle-mode`（.map-container class） | 地图战斗模式 | battle.css |

### 9.4 日志颜色映射

**结构化日志系统下，颜色由前端 `log-templates.js` 模板控制**（后端不再输出 `<span class="xxx">`）。模板中使用以下 class，`terminal.css` 映射为灰阶：

| 模板使用的 class | 前端效果 |
|-----------------|---------|
| `.yellow` | `#fff` 加粗（重要地名/物品名） |
| `.red` | `#ccc` 加粗+下划线（伤害/陷阱） |
| `.green` | `#bbb`（发现/成功） |
| `.blue` / `.lime` / `.skyblue` | `#999`/`#aaa`/`#999`（次要信息） |
| `.orange` / `.white` | `#ccc`/`#ddd` |
| `.grey` / `.linen` | `#555`/`#777`（弱化信息） |

---

## 十、代码规范

### 10.1 模块规范

- **ES Modules**：所有 JS 文件使用 `import`/`export`，无 CommonJS
- **无 window 全局函数**：HTML 中无 `onclick`，事件绑定在 JS 模块内通过 `addEventListener` 完成
- **唯一例外**：`window.__vex_debug_bus` 和 `window.__vex_base_url` 供 `debug.js`（非模块脚本）访问

### 10.2 命名约定

| 类别 | 规则 | 示例 |
|------|------|------|
| 导出函数 | camelCase | `loadMap`, `loadInventory`, `refreshLog`, `refreshBattle` |
| 模块内部函数 | camelCase | `renderMapGrid`, `handleExplore`, `isReachable`, `playBattleLogGroup` |
| DOM 事件处理 | `handle` / `on` 前缀 | `handleExplore`, `handleSearch`, `onBattleAction` |
| CSS 类名 | kebab-case | `map-cell`, `tile-row`, `slot-card`, `battle-modal`, `turn-active` |
| 数据事件 | `namespace:action` | `game:action-completed`, `map:loaded`, `ui:toast`, `battle:ended` |
| 日志 ID | `{action}.{subevent}` | `move.success`, `pickup.bag_full`（与后端一致） |
| 战斗日志 action_id | 蛇形命名 | `unarmed_strike`, `escape`, `battle.start`, `initiative.roll`, `battle.end` |

### 10.3 HTML 拼接规范

- 使用模板字面量（template literal）拼接，不用字符串 `+` 连接
- 所有动态内容必须经过 `escapeHtml()` 转义
- 按钮使用 `data-action` + `data-xxx` 属性传递参数，渲染后 `addEventListener` 绑定

### 10.4 刷新策略

操作成功后统一调用：
```javascript
dataManager.invalidateAll();
await loadMap();
dataManager.broadcast('game:action-completed');
```

各面板模块在初始化时订阅 `game:action-completed` 事件自行刷新，无需手动列举刷新函数。

**战斗模块例外**：`battle.js` 的 `confirmStartBattle()` / `onBattleAction()` 不直接广播 `game:action-completed`，而是：
1. 失效 `player_info` / `enemies` / `battle_log` 缓存
2. 调用 `fetchAndPlayBattleLog()` 播放 battlelog
3. 调用 `refreshBattle()` 刷新战斗状态
4. `isProcessingBattle` 全生命周期锁在 `finally` 块中释放

### 10.5 并发控制规范

**三层防护**（详见 14.4）：
1. `battle.js: isProcessingBattle` — 全生命周期锁（覆盖提交+播放+刷新）
2. `command-queue.js: _locked` — HTTP 请求锁
3. 后端 `flock(LOCK_EX|LOCK_NB)` — 文件锁

**前端锁使用模式**：
```javascript
async function someBattleAction() {
    if (isProcessingBattle) return;  // 重复点击直接丢弃
    isProcessingBattle = true;
    try {
        // 提交命令 + 播放 battlelog + 刷新状态
    } finally {
        isProcessingBattle = false;  // 确保异常时也释放
    }
}
```

**设计决策**：选择"丢弃模式"而非"队列模式"。理由：战斗指令需要根据最新状态决策，缓存旧指令依次执行会导致状态错乱。

---

## 十一、调试系统

### 11.1 DebugBus（始终运行）

`data.js` 中的极简事件总线，零开销（无订阅者时 emit 为空操作）：

```javascript
DebugBus.emit(category, step, data);  // 投递事件
DebugBus.on(callback);                // 订阅所有事件
DebugBus.registerState(name, fn);     // 注册状态快照钩子
DebugBus.getState();                  // 获取所有状态快照
```

### 11.2 AI 调试模式

URL 加 `?debug=ai` 参数时，`app.js` 动态加载 `debug.js`，功能：
- 订阅 DebugBus 所有事件
- 批量写入服务端（`POST api_v2.php?action=ai_dump_save`，JSON Lines 格式）
- 2 秒批量或 20 条满时立即写入
- 页面卸载前强制写入
- 捕获 `window.error` 和 `unhandledrejection`

---

## 十二、Tailwind 构建流程

```bash
# 开发：监听 input.css 变更，自动编译到 output.css
npm run dev

# 生产：编译 + 压缩
npm run build
```

**注意**：修改 `input.css` 中的 `@theme` 后需运行 `npm run dev` 或 `npm run build` 重新编译。修改 `terminal.css` / `battle.css` 无需构建（浏览器直接加载）。

---

## 十三、地图缩放/平移/居中

### 13.1 缩放

- **状态**: `zoomLevel`（map.js 模块内部变量，默认智能计算）
- **范围**: 0.5x ~ 2.5x，步进 0.15
- **智能默认**: 首次渲染时自动计算 `fitZoom × 1.25`，让地图边缘约 1-2 行/列被裁切，引导探索
- **操作方式**:
  - Ctrl + 滚轮（桌面端）
  - 双指缩放（移动端）
  - +/- 按钮（地图面板右下角）
- **效果**: 改变 cellSize/cellHeight/字号，grid 超出容器时自动出现滚动区域

### 13.2 平移

- **鼠标拖拽**: 桌面端左键拖拽空白处/地图格
- **单指滑动**: 移动端由浏览器原生滚动处理
- **滚动条**: 隐藏（`scrollbar-width: none` + `::-webkit-scrollbar { display: none }`）

### 13.3 自动居中

- **触发时机**: `loadMap()` 渲染后、`applyZoom()` 缩放后、`resize` 事件后
- **实现**: `centerOnPlayer()` 用 `offsetLeft/offsetTop` 链计算玩家格位置，`scrollTo` 居中
- **边界**: 玩家在地图边缘时滚动到极限位置，不超出

### 13.4 小地图居中

当 grid 尺寸小于容器时，容器自动切换为 `align-items: center; justify-content: center`，地图居中显示无需滚动。

---

## 十四、战斗演出系统

### 14.1 设计目标

建立可扩展的战斗演出框架，三阶段播放（碰撞动画 + 模态框 + 残留伤害数字），配合 played 标记机制实现可靠的 battlelog 投递。

**核心问题解决**：
1. **battlelog 投递可靠**：played 标记机制（后端持久化 played=0 → 前端拉取播放 → 标记 played=1）
2. **演出反馈**：三阶段播放（碰撞动画 + 模态框 + 残留伤害数字）
3. **状态机简化**：normal/battle 两态，取消 prebattle/ended
4. **并发控制**：三层锁（isProcessingBattle + commandQueue._locked + 后端 flock）
5. **玩家回合提示**：动作按钮 turn-active 光效 + "你的回合" Toast

### 14.2 模块结构

| 模块 | 职责 |
|------|------|
| `battle.js` | 战斗状态机 + battlelog 拉取/分组/播放/标记 + 全生命周期锁 |
| `battle-modal.js` | 战斗模态框：播放 battlelog + 打字机效果 + 自动关闭 |
| `battle-animation.js` | 碰撞动画：冲刺 + 抖动 + 残留伤害数字 |
| `battle-render.js` | BattleLogEntry → HTML 渲染 + 动作按钮渲染 |
| `battle.css` | 战斗模态框/碰撞动画/伤害数字/回合光效/确认界面样式 |

### 14.3 战斗模态框（battle-modal.js）

**接口**：
- `playBattleLog(entries, context, onComplete)` — 播放 battlelog
- `closeBattleModal()` — 关闭模态框
- `isBattleModalPlaying()` — 是否正在播放

**播放参数**：
```javascript
const TYPEWRITER_SPEED = 25;      // 打字机速度 ms/字符
const ENTRY_INTERVAL = 500;       // 条目间隔 ms
const COMPLETE_HOLD = 1200;       // 播放完停留 ms
const TRANSITION_INTERVAL = 200;  // 连续模态框过渡 ms
```

**播放流程**：
1. 渲染头部（双方名称 + HP 条）
2. 显示模态框遮罩，等待 250ms 淡入
3. **按 `log_id` 排序**（emit 顺序，非 turn——turn 非唯一会导致排序不稳定）
4. 逐条播放：
   - turn 变化时插入分隔符（turn=0 显示"── 战斗开始 ──"，turn>=1 显示"── 回合 N ──"）
   - 渲染条目 HTML（委托 `battle-render.js: renderBattleLogEntryHtml`）
   - 更新 HP 条（若 extra 中有 hp_after）
   - 间隔 500ms
5. 播放完停留 1200ms
6. 自动关闭（淡出 200ms）

**连续模态框过渡**：若正在播放时调用 `playBattleLog`，先关闭当前模态框（淡出 200ms）→ 短暂过渡 → 新模态框淡入。

**关键设计**：
- **按 log_id 排序而非 turn**：turn 非唯一（回合内多条日志 turn 相同），按 turn 排序会导致顺序不稳定
- **turn=0 显示"战斗开始"**：battle.start / initiative.roll / battle.end 用 turn=0，避免显示"回合 0"

### 14.4 并发控制（三层锁）

防止短时间多次请求导致重复提交/状态错乱，前后端三层防护：

| 层 | 位置 | 覆盖范围 | 释放时机 |
|----|------|---------|---------|
| 前端全生命周期锁 | `battle.js: isProcessingBattle` | 提交命令 → 拉取播放 battlelog → 刷新状态 | `try/finally` 末尾 |
| 前端 HTTP 锁 | `command-queue.js: _locked` | HTTP 请求期间 | `try/finally` 末尾 |
| 后端文件锁 | `obl_command.php: flock(LOCK_EX\|LOCK_NB)` | 命令处理期间 | 进程结束/脚本 exit 时 OS 自动释放 |

**前端锁使用模式**（`confirmStartBattle` / `onBattleAction`）：
```javascript
async function onBattleAction(actionId) {
    if (currentMode !== 'battle') return;
    if (!currentBid) return;
    if (isProcessingBattle) return;  // 重复点击直接丢弃
    isProcessingBattle = true;
    try {
        const result = await commandQueue.execute({...});
        if (!result.success) return;
        dataManager.invalidate('player_info');
        dataManager.invalidate('enemies');
        dataManager.invalidate('battle_log');
        await fetchAndPlayBattleLog();  // 播放 battlelog
        await refreshBattle();          // 刷新状态
    } finally {
        isProcessingBattle = false;     // 确保异常时也释放
    }
}
```

**设计决策**：选择"丢弃模式"而非"队列模式"。理由：战斗指令需要根据最新状态决策，缓存旧指令依次执行会导致状态错乱。

### 14.5 碰撞动画（battle-animation.js）

**接口**：
- `playCollisionAnimation(entry, enemyPid)` — 播放碰撞动画（冲刺+抖动，无伤害数字）
- `playDamageNumbersAfterModal(entries, enemyPid)` — 模态框关闭后残留伤害数字

**碰撞动画流程**（`playCollisionAnimation`）：
1. 跳过非攻击动作（`battle.start`/`initiative.roll`/`battle.end`/`escape`）
2. 判断攻击方/受击方：
   - `actor === 'player'` → 攻击方=玩家元素（`.map-cell.current`），受击方=敌人元素（`[data-enemy-pid="X"]`）
   - 否则反之
3. 计算冲刺向量（攻击方 → 受击方方向，缩放到 4px）
4. 攻击方冲刺（`attack-lunge` CSS 动画，300ms）
5. 受击方抖动（延迟 120ms，`hit-shake` CSS 动画，300ms）
6. 等待 450ms 动画完成

**关键设计**：
- **不含伤害数字**：避免"未卜先知"（玩家还没看到模态框就知道伤害值）。伤害数字在模态框关闭后才显示
- **CSS 选择器**：`.map-cell.current`（不是 `.cell.current`，曾因此导致动画不播放）

**残留伤害数字**（`playDamageNumbersAfterModal`）：
1. 遍历 entries，只处理 `action_id === 'unarmed_strike'` 且 `effect_value > 0` 的条目
2. 定位受击方元素（玩家或敌人）
3. 用 `position: fixed` + 视口坐标（`getBoundingClientRect`），附加到 `document.body`
4. 多条伤害数字错开显示（`marginTop: i * 18px`）
5. 2s 后自动移除

**为什么用 `position: fixed` 而非 `position: absolute`**：
- `.map-container` 缺少 `position: relative`，`position: absolute` 会定位到错误的祖先元素
- `position: fixed` + 视口坐标不受容器定位上下文影响

### 14.6 三阶段播放流程（battle.js: playBattleLogGroup）

```javascript
async function playBattleLogGroup(entries, enemyPid) {
    const context = await buildPlayContext(enemyPid);

    // 1. 碰撞动画（地图上，无伤害数字）
    for (const entry of entries) {
        if (entry.action_id === 'unarmed_strike') {
            await playCollisionAnimation(entry, enemyPid);
        }
    }

    // 2. 模态框前移除按钮光效（避免透过模态框遮罩闪烁）
    removeTurnActiveGlow();

    // 3. 模态框（中央遮罩，逐条播放 battlelog，含伤害信息）
    await playBattleLog(entries, context, null);

    // 4. 残留伤害数字（地图格上，模态框关闭后淡入）
    playDamageNumbersAfterModal(entries, enemyPid);

    // 5. 恢复按钮光效（如果仍是玩家回合）
    restoreTurnActiveGlow();
}
```

**阶段顺序的理由**：
- 碰撞动画在模态框前：让玩家先看到"谁打谁"的视觉反馈
- 伤害数字在模态框后：避免"未卜先知"，模态框关闭后伤害数字作为残留反馈
- 移除/恢复 turn-active 光效：模态框遮罩 75% 透明，黄色光效会透过遮罩闪烁，影响体验

### 14.7 玩家回合提示

战斗模态框关闭后，`fetchAndPlayBattleLog()` 检查是否仍是玩家回合：
1. 拉取 `player_info`，检查 `action === 'battle'`
2. 检查先攻队列（`oblpara.battle.queue`），判断玩家是否当前顺位
3. 若是玩家回合：
   - 添加 `.pos-screen-center` class 到 `#toastContainer`（header 下方水平居中）
   - 广播 `ui:toast` 事件显示"你的回合"
   - 2.5s 后移除 `.pos-screen-center` class 恢复默认位置
4. 动作按钮渲染时带 `turn-active` class（`battle-render.js: renderBattleActions`）

**回合光效 CSS**（方案D：边框渐变 + 内发光）：
```css
.action-btn.turn-active {
    animation: turn-glow 2s ease-in-out infinite;
}
@keyframes turn-glow {
    0%, 100% {
        border-color: rgba(255, 200, 0, 0.3);
        box-shadow: inset 0 0 4px rgba(255, 200, 0, 0.1);
    }
    50% {
        border-color: rgba(255, 200, 0, 0.7);
        box-shadow: inset 0 0 10px rgba(255, 200, 0, 0.2);
    }
}
```

**设计决策**：选择"边框渐变 + 内发光"而非"外发光"，理由：
- 外发光过于刺眼，破坏终端风格
- 内发光更克制，与现有按钮风格协调
- 2s 呼吸周期足够明显但不打扰

### 14.8 战斗确认界面（纯前端）

玩家点击地图敌人时，`battle.js: startBattle(enemyPid)` 显示确认界面：
1. 从 `enemies` API 获取敌人名称
2. 显示 `.battle-confirm-overlay`（"是否攻击 [敌人名]？"）
3. 玩家点击 [攻击] → `confirmStartBattle(enemyPid)` → 提交 `obl_battle_start` 命令
4. 玩家点击 [取消] → 隐藏确认界面，不提交命令

**关键设计**：取消 prebattle 中间态后，"是否攻击"的确认完全是前端行为，后端只接收最终的 `obl_battle_start` 命令。

### 14.9 battlelog 数据流（played 标记机制）

```
后端 emit battlelog（played=0）
  → obl_battle_log_persist() 追加到文件，分配 log_id，played=0
  → 命令响应只返回 {}（不附带 battlelog）

前端 fetchAndPlayBattleLog()
  → gameApi('battle_log') → 返回 played=0 的条目
  → 按 enemy_pid 分组（groupByEnemyPid）
  → 逐组三阶段播放（playBattleLogGroup）
  → POST mark_battle_log_played.php 标记 played=1
```

**关键决策**：
- **统一单路径**：所有 battlelog（玩家命令 + 遭遇战）都走"持久化 → 前端拉取 → 标记"统一流程，不再有"命令响应附带"的双路径
- **零依赖 mark 接口**：`vex/mark_battle_log_played.php` 不走 api_v2，无 auth/DB，只文件读写
- **文件不被清空**：played=1 的条目保留作为历史记录
- **log_id 排序**：前端按 `log_id`（emit 顺序）排序播放，而非 `turn`（非唯一）

### 14.10 战斗状态机

```
normal（探索模式）
  └─ 玩家点击敌人 → 纯前端确认界面 → 提交 obl_battle_start
     → 后端 action='battle' → 切换到 battle

battle（战斗模式）
  ├─ 玩家提交 obl_battle_action → 三阶段播放 → 仍在 battle → 继续
  ├─ 战斗结束（action=''）→ 模态框播放结算 → 关闭 → 切换到 normal
  └─ 遭遇战（tick 结算触发）→ game:action-completed → refreshBattle 检测 → 进入 battle
```

**状态切换**（`battle.js: refreshBattle`）：
- 拉取 `player_info`，检查 `action` 字段
- `action === 'battle'` → 进入 battle 模式（`enterBattleMode`）
- `action === ''` → 退出 battle 模式（`exitBattleMode`）

**进入 battle 模式**（`enterBattleMode`）：
1. 切换 DOM（隐藏 `#normalMode`，显示 `#battleMode`）
2. 添加 `body.battle-active` class（全界面边框光效）
3. 添加 `.map-container.battle-mode` class（地图战斗模式）
4. 渲染战斗标题（`vs [敌人名]`）
5. 根据顺位渲染动作面板（玩家回合=动作按钮，NPC 回合=等待提示）
6. 拉取并播放未播放的 battlelog（`fetchAndPlayBattleLog`）

**退出 battle 模式**（`exitBattleMode`）：
1. 切换 DOM（显示 `#normalMode`，隐藏 `#battleMode`）
2. 移除 `body.battle-active` class
3. 移除 `.map-container.battle-mode` class
4. 失效所有缓存，广播 `battle:ended` 事件触发地图和动作条刷新

### 14.11 相关文档

- `oblivions/docs/战斗演出系统设计案.md` — 战斗演出系统设计案（前端框架）
- `oblivions/docs/战斗系统重构设计案.md` — 先攻轮机制设计案（后端逻辑基础）
- `oblivions/CODEBASE.md` — Oblivions 后端代码库地图（含战斗系统详细说明，第十三章）

---

**文档结束。** 结构化日志系统的完整 ID 清单见 `vex/data/log-templates.js`，后端战斗系统详见 `oblivions/CODEBASE.md` 第十三节。
