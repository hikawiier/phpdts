# VEX 前端设计文档

> 版本：2.0 | 2026-06-14
> 定位：Oblivions 新模式的 SPA 前端，独立于 PHP 模板系统运行

---

## 一、现状总览

### 1.1 文件结构

```
vex/
├── index.html          # SPA 入口（90行）
├── css/
│   └── style.css       # 立体剪纸视觉风格（955行）
├── js/
│   ├── data.js         # 全局配置 + DebugBus 事件总线 + 硬编码数据表（131行）⚠ 含过时地图数据
│   ├── utils.js        # 工具函数 + API请求封装 + 命令提交（102行）
│   ├── player.js       # 玩家信息 + 侧滑抽屉（75行）
│   ├── inventory.js    # 背包 + 装备 + 物品发现 + 探索记忆（250行）⚠ 含过时探索记忆系统
│   ├── map.js          # 地图渲染 + 移动操作（296行）⚠ 含旧版10×10地图遗留
│   ├── log.js          # 游戏日志 + 3秒轮询（25行）
│   ├── app.js          # 应用入口 + 动态加载 debug.js（23行）
│   └── debug.js        # AI 调试模块（JSON Lines 管道，105行）
└── cache/
    ├── ai_dump_1.jsonl # AI 调试数据
    └── log_*.php       # 日志缓存
```

**总代码量**：~2000 行（JS ~1000行 + CSS ~955行 + HTML ~90行）

### 1.2 技术栈

| 层 | 技术 | 说明 |
|---|---|---|
| HTML | 原生 HTML5 | 无模板引擎，静态 DOM 结构 |
| CSS | 原生 CSS3 | Flexbox + Grid 布局，手写动画库 |
| JS | 原生 ES5/ES6 混用 | 全局函数 + IIFE，无模块系统 |
| HTTP | 原生 fetch API | async/await，JSON 读 + form-urlencoded 写 |
| 构建 | 无 | 无 npm/webpack/vite，直接引用 script 标签 |

### 1.3 数据流

```
页面加载 → app.js:loadAll()
  ├── loadMap()                  → GET  api_v2.php?action=game_map
  ├── loadItemFind()             → GET  api_v2.php?action=player_info
  ├── loadExplorationMemory()    → GET  api_v2.php?action=player_info  ← 重复（⚠ 过时系统，待删除）
  ├── loadInventory()            → GET  api_v2.php?action=player_inventory
  └── refreshLog()               → GET  api_v2.php?action=game_log

移动操作 → clickMove(pls) → submitCommand({command:'move', moveto}) → POST command.php
  └── 成功后并行刷新 5 个面板（loadMap + loadPlayerInfo + loadItemFind + loadInventory + refreshLog）

日志轮询 → setInterval(refreshLog, 3000) → GET api_v2.php?action=game_log

调试管道 → DebugBus.emit() → debug.js 批量缓冲 → POST api_v2.php?action=ai_dump_save
```

### 1.4 与旧模板的对比

| 维度 | Default/Nouveau 模板 | VEX |
|------|---------------------|-----|
| 渲染方式 | PHP SSR + innerHTML 替换 | 纯客户端渲染 |
| 数据来源 | command.php 返回 gamedata | api_v2.php 只读 + command.php 写入 |
| 状态管理 | 服务端持有，前端无状态 | 客户端持有 mapData 等全局变量 |
| 指令反馈 | showData() 处理 innerHTML/value/display/timer | submitCommand() 仅返回 resp.ok，然后重新拉取 |
| 功能覆盖 | 完整（战斗/聊天/商店/合成/技能/组队/对话...） | 仅地图/背包/装备/物品发现/日志 |
| 视觉风格 | 经典半透明面板 / 深色终端窗口 | 立体剪纸暖色风格 |

---

## 二、过时内容清理

VEX 前端中存在两块已过时的内容，需要在重构前先行清理。

### 2.1 过时地图数据（data.js / map.js / utils.js）

**现状**：`data.js` 中硬编码了旧版 10×10 固定网格的地图数据：

```javascript
var PLACE_NAMES = { 0:'无月之影', 1:'端点', ... };  // 35个旧版地名
var XY_COORDS = { 0:'B-2', 1:'A-6', ... };          // 旧版坐标映射
var COORD_TO_AREA = {};                               // 反向映射
```

**判定过时原因**：
- VEX 前端仅服务于 Oblivions 新模式，新模式的地图数据完全由 `api_v2.php?action=game_map` 的 `links` 字段动态提供
- `map.js` 中 `getPlaceName()` 已优先从 `mapData.links` 读取地名，`PLACE_NAMES` 仅作为 fallback
- `XY_COORDS` 和 `COORD_TO_AREA` 仅在 `map.js` 初始化时填充 `mapData.areaMap`，但 Oblivions 模式下 `renderMapGrid()` 完全不使用 `areaMap`
- `map.js` 中的 `MAP_ROWS`、`MAP_COLS` 也是旧版 10×10 网格的遗留

**清理方案**：

| 删除项 | 文件 | 说明 |
|--------|------|------|
| `PLACE_NAMES` | data.js | 地名从 API links 获取 |
| `XY_COORDS` | data.js | Oblivions 模式不使用 |
| `COORD_TO_AREA` | data.js | Oblivions 模式不使用 |
| `MAP_ROWS` / `MAP_COLS` | map.js | 旧版 10×10 网格常量 |
| `mapData.areaMap` 初始化 | map.js | 旧版坐标→区域映射 |
| `getPlaceName()` fallback | utils.js | 移除 `PLACE_NAMES` fallback，Oblivions 模式下地名必须从 API 获取 |
| `renderMapGrid()` 无 links 分支 | map.js | 移除 `no map data` 的 fallback 渲染，Oblivions 模式下 `links` 必须存在 |

**清理后**：`data.js` 仅保留 `BASE_URL`、`DebugBus`、非地图相关的硬编码表（`WEATHER_NAMES`、`GAME_STATE_NAMES`、`GENDER_NAMES`、`RACE_NAMES`、`CLUB_NAMES`、`HP_STATUS`、`SP_STATUS`、`RAGE_STATUS`、`POSE_NAMES`、`TACTIC_NAMES`）。

### 2.2 过时探索记忆系统（inventory.js）

**现状**：`inventory.js` 中包含完整的探索记忆（smeo）系统：

```javascript
// 全局变量
var explorationMemory = {};
var hasExplorationMemory = false;

// 函数
async function loadExplorationMemory() { ... }  // 从 player_info.clbpara.smeo 读取
async function explorationMemoryAction(key) { ... }  // 提交 memory{key} 命令
```

**判定过时原因**：
- 探索记忆是旧版游戏机制，Oblivions 新模式将使用全新的探索系统（`oblivions/include/game/explore.func.php`，目前为 TODO）
- 新探索系统尚未设计前端交互，保留旧代码只会造成混淆

**清理方案**：

| 删除项 | 文件 | 说明 |
|--------|------|------|
| `explorationMemory` / `hasExplorationMemory` | inventory.js | 全局变量 |
| `loadExplorationMemory()` | inventory.js | 函数整体删除 |
| `explorationMemoryAction()` | inventory.js | 函数整体删除 |
| `loadExplorationMemory()` 调用 | app.js | 从 `loadAll()` 中移除 |
| `#memorySection` / `#memoryArea` | index.html | 探索记忆 DOM 节点 |
| `.panel-memory` 相关样式 | style.css | 探索记忆 CSS |
| DebugBus `render` 状态中的 `memorySection` | map.js | 状态快照钩子 |

**清理后收益**：
- `loadAll()` 减少 1 次 `player_info` 请求（从 3 次降为 2 次）
- 移动成功后的刷新列表减少 1 项
- 代码量减少约 70 行

---

## 三、架构问题清单

### 3.1 严重问题（影响功能正确性）

#### P1: submitCommand 丢弃响应体

```javascript
// utils.js:66-82
async function submitCommand(params) {
    // ...
    var resp = await fetch(BASE_URL + '/command.php', { ... });
    return resp.ok;  // 仅返回布尔值，丢弃了整个响应体
}
```

**影响**：
- 后端返回的 `gamedata`（含 innerHTML/value/display/timer/clbpara）全部丢失
- 错误信息无法传递到前端，用户只能看到 "move failed" / "pickup failed"
- 冷却时间（CD 计时器）无法显示
- 后端重定向标记（如死亡跳转）无法处理

**应改为**：解析 command.php 的 JSON 响应，至少提取错误消息和重定向标记。

#### P2: API 重复请求 player_info

`player_info` 在一次 `loadAll()` 中被调用 2 次（清理探索记忆后）：

| 调用者 | 函数 | 用途 |
|--------|------|------|
| inventory.js | `loadItemFind()` | 检查 items[0]（发现物品） |
| inventory.js | `loadEquipment()` | 读取 equipment（装备） |

移动成功后又会再调 2 次。一次操作可能产生 4 次 `player_info` 请求。

**应改为**：统一数据层，一次请求缓存结果，其他模块从缓存读取。

#### P3: 竞态条件 — 移动后立即刷新

```javascript
// map.js:233-240
submitCommand(cmdParams).then(function(ok) {
    if (ok) {
        Promise.all([
            loadMap(),
            loadPlayerInfo(),
            loadItemFind(),
            loadInventory(),
            refreshLog()
        ]);
    }
});
```

`submitCommand` 返回时，后端可能尚未完成所有状态更新（如区域切换、物品生成）。立即发起 API 请求可能拿到旧数据。

**应改为**：等待 command.php 响应确认完成后再刷新，或在刷新时加入短暂延迟/重试机制。

#### P4: 日志直接注入 innerHTML

```javascript
// log.js:17
el.innerHTML = result.data.log || '<span class="grey">暂无日志</span>';
```

`game_log` 返回的日志内容是服务端生成的 HTML，直接注入 DOM。虽然数据来自可信后端，但如果日志内容包含用户输入（如聊天消息中的 HTML），存在 XSS 风险。

**应改为**：对日志内容进行 sanitize，或使用 DOMPurify 等库过滤。

### 3.2 中等问题（影响用户体验）

#### P5: 无全局加载状态

`loadAll()` 使用 `Promise.allSettled()` 但不处理结果。各面板独立显示 "loading..."，但缺少全局加载协调：
- 用户可能在数据未加载完成时点击地图格
- 没有加载失败的重试机制
- 没有全局错误提示

#### P6: 无请求防抖/去重

- 快速连续点击地图格会发送多个 move 命令
- `loadPlayerInfo()` 每次打开抽屉都重新请求，无缓存
- 日志 3 秒轮询无论页面是否可见都在运行

#### P7: 键盘快捷键未实现

按钮标注了快捷键 `[Z]pickup`、`[A]use`、`[X]discard`，但没有任何键盘事件监听器实现。

#### P8: 移动端体验差

- `html, body { overflow: hidden }` 导致小屏幕内容截断
- 地图格固定 52px × 44px，手机上无法完整显示
- `user-select: none` 全局禁用文本选择，日志无法复制
- 抽屉宽度固定 320px，小屏幕占比过大

#### P9: ~~探索记忆 onclick 注入风险~~ → 已过时，整体删除

探索记忆系统已过时（见第二章 2.2 节），无需修复此问题，直接删除整个探索记忆模块。

#### P10: beforeunload 不可靠

```javascript
// debug.js:84-86
window.addEventListener('beforeunload', function() {
    flush();  // fetch 可能被浏览器取消
});
```

`fetch` 在 `beforeunload` 中不可靠，应使用 `navigator.sendBeacon()` 或同步 `XMLHttpRequest`。

### 3.3 轻微问题（代码质量）

#### P11: 全局变量污染

所有模块在全局作用域运行，变量/函数散落各处：

| 文件 | 全局变量 | 全局函数 |
|------|---------|---------|
| data.js | `BASE_URL`, `DebugBus`, `PLACE_NAMES`, `XY_COORDS`, `COORD_TO_AREA`, `WEATHER_NAMES` 等 | — |
| map.js | `MAP_ROWS`, `MAP_COLS`, `mapData` | `getAreaStatus()`, `isReachable()`, `getTileByCoord()`, `renderMapGrid()`, `loadMap()`, `clickMove()` |
| player.js | `drawerOpen` | `loadPlayerInfo()`, `toggleDrawer()`, `closeDrawer()` |
| inventory.js | `playerClub`, `hasFoundItem` | `loadInventory()`, `loadEquipment()`, `loadItemFind()`, `itemFindPickup()`, `itemFindUse()`, `itemFindRefine()`, `itemFindDiscard()` |
| log.js | `_lastLogLength` | `refreshLog()` |
| utils.js | — | `escapeHtml()`, `getPlaceName()`, `getWeatherText()`, `apiRequest()`, `gameApi()`, `submitCommand()`, `flushDebugLog()` |

跨模块依赖通过全局变量隐式耦合：
- `map.js` 读取 `inventory.js` 的 `hasFoundItem`
- `map.js` 读取 `data.js` 的 `mapData`
- `utils.js` 读取 `data.js` 的 `BASE_URL`
- `inventory.js` 读取 `data.js` 的 `DebugBus`

#### P12: ES5 闭包模式

```javascript
// map.js:140-142
cell.onclick = (function(pls) {
    return function() { clickMove(pls); };
})(tileInfo.pls);
```

可改用 `let` 块作用域简化。

#### P13: getTileByCoord O(n) 扫描

```javascript
// map.js:58-69
function getTileByCoord(coord) {
    for (var pls in tiles) {
        var t = tiles[pls];
        if (t.x === coord.x && t.y === coord.y) {
            return { pls: parseInt(pls), tile: t };
        }
    }
}
```

每次渲染地图格都要遍历全部 tiles，在 `renderMapGrid()` 的双重循环中被调用 `cols × rows` 次。应预构建坐标索引。

#### P14: 日志长度比较不精确

```javascript
// log.js:13
if (newLen !== _lastLogLength) {
```

如果日志被替换但长度恰好相同，不会触发更新。应比较内容 hash 或使用版本号。

#### P15: DebugBus 与 Debug 设计文档不一致

设计文档描述了带 UI 面板的 `Debug` 对象（`?debug=1` 触发），实际实现是无 UI 的 `DebugBus` + `debug.js`（`?debug=ai` 触发，纯数据管道）。两套方案需要统一或明确分工。

#### P16: 硬编码路径

```javascript
// data.js:5
var BASE_URL = '/phpdts';
```

部署路径变化时需要手动修改。应从 HTML 的 `<base>` 或 `<meta>` 标签读取。

---

## 四、功能缺失清单

VEX 目前仅覆盖了游戏核心交互的一小部分。以下是 default 模板支持但 VEX 缺失的功能：

### 4.1 核心游戏功能

| 功能 | Default 模板 | VEX 现状 | 优先级 |
|------|-------------|---------|--------|
| 战斗界面 | battle.htm / battle_rev.htm | 无 | 高 |
| 聊天系统 | chat.htm + chat.php 轮询 | 无 | 高 |
| 指令面板（完整） | command.htm（搜寻/合成/休息/商店/组队/技能/社团） | 仅物品操作 | 高 |
| 冷却时间显示 | gamedata.timer + JS 倒计时 | 无 | 中 |
| 对话系统 | dialogue.htm（NPC 交互） | 无 | 中 |
| 技能使用 | skillpage.htm | 无 | 中 |
| 合成系统 | command.htm 内合成选项 | 无 | 中 |
| 商店系统 | command.htm 内商店选项 | 无 | 低 |
| 组队系统 | command.htm 内组队选项 | 无 | 低 |
| 休息/睡眠 | rest.htm | 无 | 中 |
| 死亡界面 | death.htm | 无 | 高 |
| 开场/结局剧情 | opening.htm / ending.htm | 无 | 低 |

### 4.2 UI/UX 功能

| 功能 | Default 模板 | VEX 现状 |
|------|-------------|---------|
| BGM 播放器 | sp_terminal.htm | 无 |
| 纸娃娃系统 | profile.htm 内角色图 | 无 |
| 位置背景图 | img/location/{pls}.jpg 动态切换 | 无 |
| 侧边滑动面板 | slidingpanel.htm（任务/种火） | 无 |
| 快捷键 | Z 键提交 | 标注了但未实现 |
| 认证流程 | 登录/注册页面 | 无（假设已登录） |

### 4.3 Oblivions 模式特有

| 功能 | 设计文档 | VEX 现状 |
|------|---------|---------|
| 潮汐属性可视化 | tide 属性边缘颜色渲染 | 未实现 |
| 区域名称/描述显示 | 移动到达时显示 | 仅显示地名 |
| 地板属性效果 | floor 属性影响移动消耗 | 未实现 |
| 禁区可视化 | arealist/areanum 在新地图上的映射 | getAreaStatus() 存在但 Oblivions 模式未使用 |
| 多出口选择 | exit_links 弹出选择界面 | 未实现 |

---

## 五、改进方案

### 5.1 架构改进（不引入框架）

#### A. ES Modules 重构

将全局函数改为 ES Modules，零工具链成本：

```html
<!-- index.html -->
<script type="module" src="js/app.js"></script>
```

```javascript
// js/data.js
export const BASE_URL = document.querySelector('meta[name="base-url"]')?.content || '/phpdts';
export const DebugBus = /* ... */;
export const WEATHER_NAMES = { /* ... */ };
// 地图数据从 API 获取，不再硬编码

// js/utils.js
import { BASE_URL } from './data.js';
export async function apiRequest(url, method, data) { /* ... */ }
export async function gameApi(action) { /* ... */ }
export async function submitCommand(params) { /* ... */ }

// js/map.js
import { gameApi, submitCommand } from './utils.js';
import { DebugBus } from './data.js';
import { hasFoundItem } from './inventory.js';
```

**收益**：
- 依赖关系显式化，消除隐式全局耦合
- 浏览器原生支持，无需构建工具
- 严格模式下避免意外全局变量

**代价**：
- 需要本地 HTTP 服务器（file:// 协议不支持 CORS 模块加载）
- 所有 `<script>` 标签改为 `<script type="module">`
- 调试时调用栈多一层 module 包装

#### B. 统一数据层（DataManager）

解决 API 重复请求问题：

```javascript
// js/data-manager.js
class DataManager {
    constructor() {
        this._cache = new Map();      // action -> { data, timestamp }
        this._pending = new Map();     // action -> Promise（去重）
        this._ttl = 2000;             // 缓存有效期 2 秒
        this._subscribers = new Map(); // action -> Set<callback>
    }

    async fetch(action, forceRefresh = false) {
        const now = Date.now();
        const cached = this._cache.get(action);

        // 缓存有效且非强制刷新
        if (!forceRefresh && cached && (now - cached.timestamp < this._ttl)) {
            return cached.data;
        }

        // 去重：同一 action 的并发请求合并为一个
        if (this._pending.has(action)) {
            return this._pending.get(action);
        }

        const promise = gameApi(action).then(result => {
            this._cache.set(action, { data: result, timestamp: Date.now() });
            this._pending.delete(action);
            this._notify(action, result);
            return result;
        }).catch(err => {
            this._pending.delete(action);
            throw err;
        });

        this._pending.set(action, promise);
        return promise;
    }

    invalidate(action) {
        this._cache.delete(action);
    }

    invalidateAll() {
        this._cache.clear();
    }

    subscribe(action, callback) {
        if (!this._subscribers.has(action)) {
            this._subscribers.set(action, new Set());
        }
        this._subscribers.get(action).add(callback);
    }

    _notify(action, data) {
        const subs = this._subscribers.get(action);
        if (subs) subs.forEach(cb => cb(data));
    }
}

export const dataManager = new DataManager();
```

**使用方式**：

```javascript
// 替代直接调用 gameApi('player_info')
const result = await dataManager.fetch('player_info');

// 移动成功后，强制刷新所有数据
dataManager.invalidateAll();
await Promise.all([
    dataManager.fetch('game_map', true),
    dataManager.fetch('player_info', true),
    // ...
]);
```

**收益**：
- `player_info` 从 2-4 次/操作 降为 1 次/操作
- 并发请求自动合并（去重）
- 数据变更时自动通知订阅者

#### C. 完善 submitCommand

```javascript
export async function submitCommand(params) {
    const body = new URLSearchParams();
    if (!params.mode) params.mode = 'command';
    for (const k in params) body.append(k, params[k]);

    try {
        const resp = await fetch(BASE_URL + '/command.php', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString()
        });

        if (!resp.ok) {
            return { success: false, error: 'HTTP_ERROR', status: resp.status };
        }

        // 尝试解析 JSON 响应（command.php 返回 gamedata）
        const contentType = resp.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
            const gamedata = await resp.json();
            return {
                success: true,
                gamedata: gamedata,
                // 提取关键信息
                redirect: gamedata.redirect || null,
                timer: gamedata.timer || null,
                error: gamedata.error || null
            };
        }

        return { success: true };
    } catch (e) {
        return { success: false, error: 'NETWORK_ERROR', message: e.message };
    }
}
```

**收益**：
- 获取后端错误消息，可以显示给用户
- 处理重定向标记（死亡/游戏结束）
- 提取冷却时间数据

#### D. 日志推送（SSE 替代轮询）

服务端改动极小，只需在 `api_v2.php` 新增一个 SSE 端点：

```php
// api_v2.php 新增 action=game_log_stream
function handle_game_log_stream() {
    header('Content-Type: text/event-stream');
    header('Cache-Control: no-cache');
    header('Connection: keep-alive');

    $lastLen = 0;
    while (true) {
        $log = get_game_log(); // 复用现有函数
        $newLen = strlen($log);
        if ($newLen !== $lastLen) {
            echo "data: " . json_encode(['log' => $log, 'length' => $newLen]) . "\n\n";
            ob_flush();
            flush();
            $lastLen = $newLen;
        }
        sleep(1); // 1 秒检查一次
    }
}
```

前端：

```javascript
function startLogStream() {
    const evtSource = new EventSource(BASE_URL + '/api_v2.php?action=game_log_stream');
    evtSource.onmessage = function(event) {
        const data = JSON.parse(event.data);
        const el = document.getElementById('logContent');
        el.innerHTML = data.log;
        el.scrollTop = el.scrollHeight;
    };
    evtSource.onerror = function() {
        // 降级为轮询
        evtSource.close();
        setInterval(refreshLog, 3000);
    };
}
```

**收益**：
- 日志延迟从 3 秒降至 <1 秒
- 无变化时不发数据，节省带宽
- 连接断开时自动降级为轮询

#### E. 请求防抖与命令锁

```javascript
// js/command-queue.js
class CommandQueue {
    constructor() {
        this._locked = false;
        this._cooldown = 0;
    }

    async execute(params) {
        if (this._locked) {
            return { success: false, error: 'LOCKED', message: '操作进行中' };
        }
        if (this._cooldown > Date.now()) {
            return { success: false, error: 'COOLDOWN', message: '冷却中' };
        }

        this._locked = true;
        try {
            const result = await submitCommand(params);
            if (result.timer) {
                this._cooldown = Date.now() + (result.timer * 1000);
            }
            return result;
        } finally {
            this._locked = false;
        }
    }
}

export const commandQueue = new CommandQueue();
```

**收益**：
- 防止快速连续点击导致重复提交
- 支持冷却时间显示
- 操作期间 UI 可显示锁定状态

### 5.2 性能优化

#### A. 地图渲染优化

**问题**：`getTileByCoord()` 在渲染循环中被调用 `cols × rows` 次，每次 O(n) 扫描。

**方案**：预构建坐标索引

```javascript
function buildCoordIndex(tiles) {
    const index = {};  // "x,y" -> { pls, tile }
    for (const pls in tiles) {
        const t = tiles[pls];
        index[t.x + ',' + t.y] = { pls: parseInt(pls), tile: t };
    }
    return index;
}

function renderMapGrid() {
    // ...
    const coordIndex = buildCoordIndex(tiles);
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const tileInfo = coordIndex[c + ',' + r]; // O(1)
            // ...
        }
    }
}
```

#### B. CSS 动画优化

**问题**：多个 `drop-shadow` filter + `animation` 在大量元素上运行，触发 GPU 合成层爆炸。

**方案**：
- 将 `drop-shadow` 改为 `box-shadow`（性能更好）
- 使用 `will-change: transform` 提示浏览器优化
- 减少同时运行的动画数量（仅当前可见面板动画）
- 考虑 `prefers-reduced-motion` 媒体查询

```css
@media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
        animation-duration: 0.01ms !important;
        transition-duration: 0.01ms !important;
    }
}
```

#### C. 日志虚拟滚动

当日志内容超过 1000 行时，DOM 节点过多导致滚动卡顿。可引入简单的虚拟滚动：

```javascript
class VirtualLog {
    constructor(container, options = {}) {
        this.container = container;
        this.itemHeight = options.itemHeight || 28;  // 每行高度
        this.buffer = options.buffer || 5;            // 缓冲行数
        this.lines = [];
    }

    setLines(htmlLines) {
        this.lines = htmlLines;
        this.render();
    }

    render() {
        const scrollTop = this.container.scrollTop;
        const viewHeight = this.container.clientHeight;
        const startIdx = Math.max(0, Math.floor(scrollTop / this.itemHeight) - this.buffer);
        const endIdx = Math.min(this.lines.length,
            Math.ceil((scrollTop + viewHeight) / this.itemHeight) + this.buffer);

        // 仅渲染可见区域的行
        // ...
    }
}
```

### 5.3 安全加固

#### 日志内容 Sanitize

```javascript
function sanitizeLog(html) {
    // 移除 <script> 标签和事件属性
    return html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/\son\w+\s*=\s*["'][^"']*["']/gi, '');
}
```

或引入轻量 sanitize 库（如 DOMPurify ~20KB min+gzip）。

### 5.4 移动端适配

#### A. 响应式地图

```css
@media (max-width: 600px) {
    .map-grid {
        grid-template-columns: 28px repeat(var(--grid-cols), 36px);
        grid-template-rows: 24px repeat(var(--grid-rows), 32px);
    }
    .map-cell .cell-name { font-size: 7px; }
}
```

#### B. 触控优化

- 地图格最小触控区域 44px × 44px（iOS HIG 标准）
- 抽屉改为底部滑出（移动端更自然）
- 按钮增大触控区域

#### C. 文本选择

```css
/* 仅禁用地图和按钮的选择，日志区域允许选择 */
.panel-log .log-content {
    -webkit-user-select: text;
    user-select: text;
}
```

---

## 六、功能扩展路线图

### Phase 0：过时内容清理（前置步骤）

| 任务 | 依赖 | 说明 |
|------|------|------|
| 删除旧版地图数据 | 无 | 移除 PLACE_NAMES / XY_COORDS / COORD_TO_AREA / MAP_ROWS / MAP_COLS / areaMap |
| 删除探索记忆系统 | 无 | 移除 loadExplorationMemory / explorationMemoryAction / DOM / CSS |
| 移除 map.js 无 links fallback | 删除旧版地图数据 | Oblivions 模式下 links 必须存在 |

### Phase 1：基础完善（解决现有问题）

| 任务 | 依赖 | 说明 |
|------|------|------|
| ES Modules 重构 | 无 | 消除全局变量污染 |
| DataManager 统一数据层 | ES Modules | 解决 API 重复请求 |
| 完善 submitCommand | 无 | 解析响应体，处理错误/重定向/冷却 |
| 命令队列 + 防抖 | submitCommand | 防止重复提交 |
| 地图坐标索引 | 无 | 渲染性能优化 |

### Phase 2：核心功能补全

| 任务 | 依赖 | 说明 |
|------|------|------|
| 战斗界面 | submitCommand 完善 | 最关键的缺失功能 |
| 聊天系统 | DataManager | 实时通信需求 |
| 完整指令面板 | 命令队列 | 搜寻/合成/休息/商店/技能/组队 |
| 冷却时间 UI | submitCommand 解析 timer | CD 倒计时显示 |
| 死亡界面 | submitCommand 处理重定向 | 游戏结束流程 |
| 日志 SSE 推送 | 后端新增 SSE 端点 | 替代 3 秒轮询 |

### Phase 3：体验提升

| 任务 | 依赖 | 说明 |
|------|------|------|
| 键盘快捷键 | 完整指令面板 | Z/A/X 等快捷操作 |
| 移动端适配 | 无 | 响应式地图 + 触控优化 |
| BGM 播放器 | 无 | 背景音乐 |
| 位置背景图 | 无 | 根据当前位置切换背景 |
| 潮汐属性可视化 | Oblivions 后端完善 | tide 属性边缘颜色 |
| 禁区可视化 | Oblivions 后端完善 | 新地图上的禁区渲染 |
| 日志虚拟滚动 | 无 | 大量日志时的性能优化 |

### Phase 4：高级功能

| 任务 | 依赖 | 说明 |
|------|------|------|
| 对话系统 | 后端 dialogue 接口 | NPC 交互 |
| 纸娃娃系统 | 后端角色图接口 | 装备可视化 |
| 侧边面板 | 完整指令面板 | 任务/种火信息 |
| 多出口选择 | Oblivions exit_links | 区域选择界面 |
| 离线提示 | 无 | 网络断开时的优雅降级 |
| 统一调试系统 | DebugBus + Debug 合并 | 人类调试 + AI 调试统一 |

---

## 七、设计决策记录

### 7.1 为什么不引入前端框架

| 考量 | 分析 |
|------|------|
| 交互复杂度 | 游戏前端是表单驱动的轮询应用，核心交互是"点击→提交→刷新"，不需要虚拟 DOM diffing |
| 状态管理 | 状态在服务端持有，客户端仅做展示，不需要客户端状态管理库 |
| 组件复用 | UI 元素有限且固定（地图格、道具槽、装备槽），不需要组件化框架 |
| 构建工具链 | 引入 npm + Vite/Webpack 增加部署复杂度，与项目"无框架依赖"哲学冲突 |
| 代码量 | 当前 ~1000 行 JS，框架 boilerplate 可能比业务代码还多 |
| 学习成本 | 原生 JS 门槛最低，任何开发者都能直接参与 |

**结论**：用原生 JS 的工程化手段（ES Modules + DataManager + 命令队列）即可解决当前 80% 的问题。

### 7.2 为什么选择 ES Modules 而非 IIFE

| 方案 | 优点 | 缺点 |
|------|------|------|
| 维持现状（全局函数） | 零改动 | 依赖隐式，耦合严重 |
| IIFE 命名空间 | 兼容性好 | 仍需手动管理依赖顺序 |
| ES Modules | 依赖显式、严格模式、tree-shaking 友好 | 需 HTTP 服务器（开发时） |

**结论**：ES Modules 是浏览器原生标准，零工具链成本，收益最大。

### 7.3 为什么选择 SSE 而非 WebSocket

| 方案 | 优点 | 缺点 |
|------|------|------|
| 轮询（现状） | 最简单 | 3 秒延迟，浪费带宽 |
| SSE | 单向推送，HTTP 协议，自动重连 | 仅服务端→客户端 |
| WebSocket | 双向通信，低延迟 | 需要 WebSocket 服务器，架构改动大 |

**结论**：游戏前端的实时需求是单向的（服务端推送日志/状态更新），SSE 完全满足且改动最小。

### 7.4 为什么删除旧版地图数据而非保留兼容

| 方案 | 优点 | 缺点 |
|------|------|------|
| 保留 PLACE_NAMES 作为 fallback | 降级时仍可显示地名 | 维护两套数据，混淆开发者 |
| 删除，Oblivions 模式下 links 必须存在 | 代码简洁，职责清晰 | API 故障时地图无地名 |

**结论**：VEX 前端仅服务于 Oblivions 新模式，不存在"降级到旧版地图"的场景。如果 `links` 缺失，应报错而非静默降级到不匹配的旧数据。

### 7.5 为什么删除探索记忆而非保留

| 方案 | 优点 | 缺点 |
|------|------|------|
| 保留旧探索记忆 | 功能不丢失 | 与新探索系统设计冲突，维护成本高 |
| 删除，等新探索系统实现 | 代码干净，无历史包袱 | 暂时失去探索记忆功能 |

**结论**：探索记忆是旧版游戏机制，Oblivions 新模式将使用全新的探索系统。保留旧代码只会造成混淆，且旧探索记忆的交互模式（从 clbpara.smeo 读取）与新系统设计不兼容。等新探索系统后端实现后，再设计匹配的前端交互。

---

## 八、文件变更预估

### Phase 0 完成后的文件结构（过时内容清理后）

```
vex/
├── index.html              # 修改：移除 #memorySection / #memoryArea DOM
├── css/
│   └── style.css           # 修改：移除 .panel-memory 相关样式
├── js/
│   ├── data.js             # 修改：移除 PLACE_NAMES / XY_COORDS / COORD_TO_AREA
│   ├── utils.js            # 修改：getPlaceName() 移除 PLACE_NAMES fallback
│   ├── player.js           # 不变
│   ├── inventory.js        # 修改：移除探索记忆相关代码（~70行）
│   ├── map.js              # 修改：移除 MAP_ROWS/MAP_COLS/areaMap/无links分支
│   ├── log.js              # 不变
│   ├── app.js              # 修改：loadAll() 移除 loadExplorationMemory
│   └── debug.js            # 不变
└── cache/
    └── ...
```

### Phase 1 完成后的文件结构

```
vex/
├── index.html              # 修改：script 标签改为 type="module"
├── css/
│   └── style.css           # 修改：添加 prefers-reduced-motion、移动端适配
├── js/
│   ├── data.js             # 重构：export 导出，移除硬编码 BASE_URL
│   ├── data-manager.js     # 新增：统一数据层（~80行）
│   ├── command-queue.js    # 新增：命令队列 + 防抖（~50行）
│   ├── utils.js            # 重构：export，完善 submitCommand
│   ├── player.js           # 重构：import，使用 DataManager
│   ├── inventory.js        # 重构：import，使用 DataManager
│   ├── map.js              # 重构：import，坐标索引优化
│   ├── log.js              # 重构：import，SSE 支持
│   ├── app.js              # 重构：import，全局加载状态
│   └── debug.js            # 维持现状（独立 IIFE，不参与模块系统）
└── cache/
    └── ...
```

### 代码量预估

| 文件 | 现有行数 | Phase 0 后 | Phase 1 后 | 变化（总） |
|------|---------|-----------|-----------|-----------|
| data.js | 131 | 60 | 50 | -81（移除旧地图数据 + export 重构） |
| data-manager.js | 0 | 0 | 80 | +80（新增） |
| command-queue.js | 0 | 0 | 50 | +50（新增） |
| utils.js | 102 | 95 | 130 | +28（移除 fallback + 完善 submitCommand） |
| player.js | 75 | 75 | 70 | -5（import 重构） |
| inventory.js | 250 | 180 | 170 | -80（删除探索记忆 + DataManager 简化） |
| map.js | 296 | 250 | 230 | -66（移除旧地图代码 + 坐标索引优化） |
| log.js | 25 | 25 | 60 | +35（SSE 支持 + 降级） |
| app.js | 23 | 20 | 50 | +27（移除探索记忆 + 全局加载状态） |
| **总计** | ~902 | ~705 | ~890 | -12（净减少） |
