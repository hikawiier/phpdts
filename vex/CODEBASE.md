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

---

## 一、项目概述

Vex 是 PHPDTS 大逃杀游戏 **Oblivions 模式** 的专用前端，采用 ASCII 终端风格（黑白灰阶 + CRT 特效），单页应用（SPA），无框架依赖。

**技术栈**：
- ES Modules（原生 JS，无 React/Vue）
- Tailwind CSS v4（构建版，`npm run build` 编译到 `css/output.css`）
- 自定义 CSS（`css/terminal.css`，覆盖 Tailwind 无法处理的部分）
- IBM Plex Mono 等宽字体
- 原生 fetch API

**部署方式**：纯静态文件，`vex/index.html` 直接浏览器打开即可运行，无需构建步骤（开发时用 `npm run dev` 监听 Tailwind 变更）。

---

## 二、目录结构

```
vex/
├── index.html              # SPA 入口（含 Tailwind 类名 + HTML 结构）
├── package.json            # Tailwind CSS v4 构建配置
├── css/
│   ├── input.css           # Tailwind 源文件（@theme 色板定义）
│   ├── output.css          # Tailwind 编译输出（勿手动编辑）
│   └── terminal.css        # 自定义样式（CRT/地图格/按钮/动画/日志类/状态栏/模态框/Toast）
├── js/
│   ├── app.js              # 入口：初始化 + 全局事件绑定 + 抽屉/模态框管理
│   ├── data.js             # 全局配置：BASE_URL / DebugBus / mapData / GENDER_NAMES
│   ├── data-manager.js     # 数据层：缓存 + 去重 + 订阅/广播
│   ├── command-queue.js    # 命令队列：防抖 + 锁定 + 冷却
│   ├── map.js              # 地图：渲染 + 移动 + 可达性判定
│   ├── tile-action.js      # 地图格交互：探索/搜索/拾取 + 居中模态框 + Toast
│   ├── inventory.js        # 背包 + 装备渲染 + 丢弃（右侧抽屉）
│   ├── player.js           # 玩家信息（左侧抽屉，含 AP 条 + oblpara.killnum）+ 状态栏渲染
│   ├── log.js              # 日志：结构化渲染 + 增量检测 + Toast 触发
│   ├── toast-position.js   # Toast 位置管理：isAnyOverlayOpen + updateToastPosition
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
  └── log.js ──────────┤── toast-position.js ──┘
                       └── data/log-templates.js ── data/terrain-desc.js
```

**关键依赖**：
- 所有面板模块依赖 `data-manager.js`（订阅刷新）和 `data.js`（全局状态）
- 所有写操作依赖 `command-queue.js`（防重复提交）
- `utils.js` 提供 `gameApi()`（只读）和 `submitCommand()`（写操作）
- `player.js` 同时负责状态栏渲染和左侧玩家抽屉
- `log.js` 依赖 `log-templates.js`（渲染）和 `toast-position.js`（Toast 触发判定）
- `tile-action.js` / `app.js` / `player.js` 都依赖 `toast-position.js`（2 级页面开关时更新 Toast 位置）
- `log-templates.js` 依赖 `terrain-desc.js`（无名格描述生成）

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
```

### 4.3 事件清单

| 事件名 | 触发者 | 订阅者 | 说明 |
|--------|--------|--------|------|
| `map:loaded` | map.js | inventory, tile-action, log | 地图数据加载完成 |
| `game:action-completed` | map.js, tile-action.js, inventory.js | inventory, tile-action, log, player | 任何游戏操作成功后 |
| `map:click-current` | map.js | tile-action.js | 点击当前格触发探索 |
| `ui:toast` | 各模块 | tile-action.js | 显示 Toast 通知 |

---

## 五、API 接口

### 5.1 只读 API（GET `api_v2.php?action=xxx`）

| action | 返回数据 | 消费模块 |
|--------|---------|---------|
| `game_map` | 地图网格+连通性+迷雾+区域信息 | map.js |
| `tile_actions` | 当前格 POI + 脚边道具 | tile-action.js |
| `player_inventory` | 背包槽位（itempara 渲染） + 装备 | inventory.js |
| `player_info` | 玩家属性 + AP + 装备 + oblpara（含 killnum） | player.js（状态栏+抽屉）, inventory.js |
| `obl_log` | 结构化日志条目数组（LogEntry[]） | log.js |

**`player_info` 字段说明**（Oblivions 模式独立数据层 `bra_oblplayers`）：
- 基本信息：`pid`/`type`/`name`/`gd`/`icon`
- 战斗状态：`action`/`bid`
- 战斗属性：`hp`/`mhp`/`sp`/`msp`/`att`/`def`
- **AP（Oblivions 专属）**：`ap`/`max_ap`
- 位置与进度：`pgroup`/`pls`/`lvl`/`exp`/`upexp`/`state`
- 道具栏：`itemmaxslots`（道具栏上限，道具详情走 `player_inventory`）
- **Oblivions 专属 JSON 字段**：`tacpara`/`skillpara`/`oblpara`（含 `killnum` 等杂项数据）
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

// 区域切换（站在出入口格时移动到当前位置触发）
{ command: 'move', moveto: number }  // moveto = 出入口格 pls
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

### 5.5 `enemies` 响应格式

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
- 敌人图标渲染在对应 `(pgroup, pls)` 格子上
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
│ │ CARTOGRAPHY          │ │ │ CHRONICLE (flex:4)        │ │
│ │ (地图网格)            │ │ │ (日志，带 [TAG] 前缀)     │ │
│ │                      │ │ │                           │ │
│ │                      │ │ ├───────────────────────────┤ │
│ │                      │ │ │ ACTIONS (flex:6)          │ │
│ │                      │ │ │ [E] 探索周围              │ │
│ │                      │ │ │ ┌────────┬────────────┐  │ │
│ │                      │ │ │ │[G]脚边 │ [S]废料堆  │  │ │
│ │                      │ │ │ │ 道具×6 │ (已搜索)   │  │ │
│ │                      │ │ │ └────────┴────────────┘  │ │
│ └──────────────────────┘ │ └───────────────────────────┘ │
├──────────────────────────┴───────────────────────────────┤
│ 浮动组件：左侧抽屉(玩家属性) / 右侧抽屉(背包+装备)       │
│           居中模态框(POI搜索/道具拾取) / Toast通知         │
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
| Toast | `ui:toast` 事件 / 日志增量 | 动态位置（右上/左上/中上） | 自动消失通知，同类合并，详见第八章 |
| 未读日志提示 | `forceScroll=false` + 新日志 | CHRONICLE 标题栏右侧 | `↓ N 条新日志`，点击滚动到底部，详见 8.4 |

### 7.4 动作条 (ACTIONS)

动作条分为三个区域：
1. **常驻按钮区**：`[E] 探索周围`、`前往下一区域`（满宽）
2. **交互网格区**：2 列网格 (`.poi-grid`)，脚边道具和 POI 并排显示
3. **空状态**：无可交互对象时显示"此处无可交互对象"

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
| `tileActionBar` | index.html | 动作条容器（tile-action.js 渲染） |
| `logContent` | index.html | 日志容器（log.js 渲染） |
| `inventoryList` | index.html | 背包容器（inventory.js 渲染） |
| `equipment` | index.html | 装备容器（inventory.js 渲染） |
| `playerInfo` | index.html | 左侧抽屉内容容器（player.js 渲染） |
| `modalOverlay` | index.html | 模态框遮罩 |
| `modalBox` | index.html | 模态框主体 |
| `modalTitle` / `modalBody` | index.html | 模态框标题 / 内容区 |
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
- 独立的一次性通知 → 不传 `mergeId`（如"移动失败"、"体力不足"）

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

优先级：`模态框 > 右抽屉 > 左抽屉/默认`。

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

JS 中拼接 HTML 时使用语义短类名（定义在 `terminal.css`），不用 Tailwind 工具类：

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
| `.toast-container` / `.toast-container.pos-left` / `.toast-container.pos-center` | Toast 容器（动态定位） | terminal.css |
| `.toast` / `.toast.show` / `.toast-error` / `.toast-success` | Toast 通知 | terminal.css |
| `.log-tag` / `.log-content .yellow` 等 | 日志样式 | terminal.css |
| `.status-bar` / `.status-bar-row` / `.bar-fill` / `.bar-container` | 状态栏 | terminal.css |
| `.status-avatar` / `.status-avatar-fallback` | 头像框 | terminal.css |
| `.modal-overlay` / `.modal-box` | 居中模态框 | terminal.css |

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
| 导出函数 | camelCase | `loadMap`, `loadInventory`, `refreshLog` |
| 模块内部函数 | camelCase | `renderMapGrid`, `handleExplore`, `isReachable` |
| DOM 事件处理 | `handle` 前缀 | `handleExplore`, `handleSearch`, `handlePickup` |
| CSS 类名 | kebab-case | `map-cell`, `tile-row`, `slot-card` |
| 数据事件 | `namespace:action` | `game:action-completed`, `map:loaded`, `ui:toast` |
| 日志 ID | `{action}.{subevent}` | `move.success`, `pickup.bag_full`（与后端一致） |

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

**注意**：修改 `input.css` 中的 `@theme` 后需运行 `npm run dev` 或 `npm run build` 重新编译。修改 `terminal.css` 无需构建（浏览器直接加载）。

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
