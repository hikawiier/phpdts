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
- **itmpara**: 拾取时前端无需处理，丢弃时 slot 参数 1-6 对应 itm1~itm6

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
│   └── terminal.css        # 自定义样式（CRT/地图格/按钮/动画/日志类/状态栏/模态框）
├── js/
│   ├── app.js              # 入口：初始化 + 全局事件绑定 + 抽屉/模态框管理
│   ├── data.js             # 全局配置：BASE_URL / DebugBus / mapData / 常量
│   ├── data-manager.js     # 数据层：缓存 + 去重 + 订阅/广播
│   ├── command-queue.js    # 命令队列：防抖 + 锁定 + 冷却
│   ├── map.js              # 地图：渲染 + 移动 + 可达性判定
│   ├── tile-action.js      # 地图格交互：探索/搜索/拾取 + 居中模态框
│   ├── inventory.js        # 背包 + 装备渲染 + 丢弃（右侧抽屉）
│   ├── player.js           # 玩家信息（左侧抽屉）+ 状态栏渲染
│   ├── log.js              # 日志：标签推断 + 事件驱动刷新
│   ├── utils.js            # 工具：escapeHtml / API请求 / 命令提交
│   └── debug.js            # AI调试模块（仅 ?debug=ai 时加载）
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
  └── log.js ──────────┘── debug.js (动态加载)
```

**关键依赖**：
- 所有面板模块依赖 `data-manager.js`（订阅刷新）和 `data.js`（全局状态）
- 所有写操作依赖 `command-queue.js`（防重复提交）
- `utils.js` 提供 `gameApi()`（只读）和 `submitCommand()`（写操作）
- `player.js` 同时负责状态栏渲染和左侧玩家抽屉

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
  → refreshLog()                 // gameApi('game_log')
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
      → log.js: refreshLog()            // 订阅 game:action-completed
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
| `player_inventory` | 背包槽位 + 装备 | inventory.js |
| `player_info` | 玩家属性 + 装备详情 + gd/icon | player.js（状态栏+抽屉）, inventory.js |
| `game_log` | 日志 HTML 字符串 | log.js |

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
{ mode: 'command', command: 'obl_discard', slot: number }  // slot: 1-6

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

写入 API：
```json
{ "success": true|false, "error": "...", "gamedata": {...}, "timer": number|null }
```

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
| 左侧抽屉 | `[属性]` 按钮 | 页面左侧滑出 | 玩家属性详情 |
| 右侧抽屉 | `[背包]` 按钮 | 页面右侧滑出 | 背包(INVENTORY) + 装备(ARMAMENT) 标签切换 |
| 居中模态框 | POI/脚边道具点击 | 画面中央 | 360px 宽，半透明遮罩，scale 动画 |
| Toast | `ui:toast` 事件 | 右上角 | 自动消失通知 |

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
| `toastContainer` | index.html | Toast 容器 |
| `drawerOverlay` | index.html | 抽屉遮罩 |
| `playerDrawer` | index.html | 左侧抽屉主体（玩家属性） |
| `inventoryDrawer` | index.html | 右侧抽屉主体（背包+装备） |

---

## 八、CSS 架构

### 8.1 三层样式

| 层 | 文件 | 内容 |
|----|------|------|
| Tailwind 编译 | `css/output.css` | 工具类 + 主题 token（由 `input.css` 编译） |
| Tailwind 源 | `css/input.css` | `@theme` 色板定义（bg/fg-dim/fg-mid/fg-bright/fg-glow/hi） |
| 自定义 | `css/terminal.css` | CRT 特效、地图格、按钮、动画、日志类、状态栏、模态框、抽屉 |

### 8.2 Tailwind 主题色

```css
/* input.css @theme */
--color-bg: #0a0a0a;        /* 纯黑底 */
--color-fg-dim: #444;       /* 暗灰（边框/标签） */
--color-fg-mid: #888;       /* 中灰（正文） */
--color-fg-bright: #bbb;    /* 亮灰（标题/强调） */
--color-fg-glow: #eee;      /* 近白（道具名/高亮） */
--color-hi: #fff;           /* 纯白（当前格/按钮hover） */
```

### 8.3 JS 动态生成的 CSS 类名

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
| `.toast` / `.toast.show` / `.toast-error` | Toast 通知 | terminal.css |
| `.log-tag` / `.log-content .yellow` 等 | 日志样式 | terminal.css |
| `.status-bar` / `.status-bar-row` / `.bar-fill` / `.bar-container` | 状态栏 | terminal.css |
| `.status-avatar` / `.status-avatar-fallback` | 头像框 | terminal.css |
| `.modal-overlay` / `.modal-box` | 居中模态框 | terminal.css |

### 8.4 日志颜色映射

后端日志用 HTML `<span class="xxx">` 标记颜色，前端映射为灰阶：

| 后端 class | 前端效果 |
|-----------|---------|
| `.yellow` | `#fff` 加粗（重要地名/物品名） |
| `.red` | `#ccc` 加粗+下划线（伤害/陷阱） |
| `.green` | `#bbb`（发现/成功） |
| `.blue` / `.lime` / `.skyblue` | `#999`/`#aaa`/`#999`（次要信息） |
| `.orange` / `.white` | `#ccc`/`#ddd` |
| `.grey` / `.linen` | `#555`/`#777`（弱化信息） |

---

## 九、代码规范

### 9.1 模块规范

- **ES Modules**：所有 JS 文件使用 `import`/`export`，无 CommonJS
- **无 window 全局函数**：HTML 中无 `onclick`，事件绑定在 JS 模块内通过 `addEventListener` 完成
- **唯一例外**：`window.__vex_debug_bus` 和 `window.__vex_base_url` 供 `debug.js`（非模块脚本）访问

### 9.2 命名约定

| 类别 | 规则 | 示例 |
|------|------|------|
| 导出函数 | camelCase | `loadMap`, `loadInventory`, `refreshLog` |
| 模块内部函数 | camelCase | `renderMapGrid`, `handleExplore`, `isReachable` |
| DOM 事件处理 | `handle` 前缀 | `handleExplore`, `handleSearch`, `handlePickup` |
| CSS 类名 | kebab-case | `map-cell`, `tile-row`, `slot-card` |
| 数据事件 | `namespace:action` | `game:action-completed`, `map:loaded`, `ui:toast` |

### 9.3 HTML 拼接规范

- 使用模板字面量（template literal）拼接，不用字符串 `+` 连接
- 所有动态内容必须经过 `escapeHtml()` 转义
- 按钮使用 `data-action` + `data-xxx` 属性传递参数，渲染后 `addEventListener` 绑定

### 9.4 刷新策略

操作成功后统一调用：
```javascript
dataManager.invalidateAll();
await loadMap();
dataManager.broadcast('game:action-completed');
```

各面板模块在初始化时订阅 `game:action-completed` 事件自行刷新，无需手动列举刷新函数。

---

## 十、调试系统

### 10.1 DebugBus（始终运行）

`data.js` 中的极简事件总线，零开销（无订阅者时 emit 为空操作）：

```javascript
DebugBus.emit(category, step, data);  // 投递事件
DebugBus.on(callback);                // 订阅所有事件
DebugBus.registerState(name, fn);     // 注册状态快照钩子
DebugBus.getState();                  // 获取所有状态快照
```

### 10.2 AI 调试模式

URL 加 `?debug=ai` 参数时，`app.js` 动态加载 `debug.js`，功能：
- 订阅 DebugBus 所有事件
- 批量写入服务端（`POST api_v2.php?action=ai_dump_save`，JSON Lines 格式）
- 2 秒批量或 20 条满时立即写入
- 页面卸载前强制写入
- 捕获 `window.error` 和 `unhandledrejection`

---

## 十一、Tailwind 构建流程

```bash
# 开发：监听 input.css 变更，自动编译到 output.css
npm run dev

# 生产：编译 + 压缩
npm run build
```

**注意**：修改 `input.css` 中的 `@theme` 后需运行 `npm run dev` 或 `npm run build` 重新编译。修改 `terminal.css` 无需构建（浏览器直接加载）。

---

## 十二、地图缩放/平移/居中

### 12.1 缩放

- **状态**: `zoomLevel`（map.js 模块内部变量，默认智能计算）
- **范围**: 0.5x ~ 2.5x，步进 0.15
- **智能默认**: 首次渲染时自动计算 `fitZoom × 1.25`，让地图边缘约 1-2 行/列被裁切，引导探索
- **操作方式**:
  - Ctrl + 滚轮（桌面端）
  - 双指缩放（移动端）
  - +/- 按钮（地图面板右下角）
- **效果**: 改变 cellSize/cellHeight/字号，grid 超出容器时自动出现滚动区域

### 12.2 平移

- **鼠标拖拽**: 桌面端左键拖拽空白处/地图格
- **单指滑动**: 移动端由浏览器原生滚动处理
- **滚动条**: 隐藏（`scrollbar-width: none` + `::-webkit-scrollbar { display: none }`）

### 12.3 自动居中

- **触发时机**: `loadMap()` 渲染后、`applyZoom()` 缩放后、`resize` 事件后
- **实现**: `centerOnPlayer()` 用 `offsetLeft/offsetTop` 链计算玩家格位置，`scrollTo` 居中
- **边界**: 玩家在地图边缘时滚动到极限位置，不超出

### 12.4 小地图居中

当 grid 尺寸小于容器时，容器自动切换为 `align-items: center; justify-content: center`，地图居中显示无需滚动。
