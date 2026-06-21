# Vex 前端重构设计文档

> 版本：2.0 | 日期：2026-06-15
>
> 目标：解决现有前端架构痛点 + 将 ASCII 终端（CRT）视觉风格应用到正式项目
>
> 风格参考：`vex/demo-ascii.html`（OBLIVIONS ASCII 终端风原型）

---

## 第一部分：现有痛点与解决方案

### 痛点 1：window 全局函数污染

**现状**：由于 HTML 使用 `onclick="closeBottomSheet()"` 等内联事件，而 JS 使用 ES Modules（模块作用域隔离），导致大量函数被挂载到 `window` 上：

- `app.js`：`toggleDrawer`、`closeDrawer`、`__vex_debug_bus`、`__vex_base_url`
- `tile-action.js`：`_tileActionExplore`、`_tileActionSearch`、`_tileActionPickup`、`_tileActionDiscard`、`_tileActionCheckPoi`、`_tileActionCheckGround`、`_tileActionCloseSheet`、`_tileActionPickupAllPoi`、`_tileActionPickupAllGround`、`closeBottomSheet`

**风险**：命名冲突、无法 tree-shake、违背 ES Modules 封装初衷

**解决方案**：HTML 中移除所有 `onclick` 属性，改用 `addEventListener` 在 JS 模块内绑定事件。

- `index.html`：移除 `onclick="closeBottomSheet()"`、`onclick="closeDrawer()"`、`onclick="toggleDrawer()"`
- `tile-action.js`：所有 `window._tileActionXxx` 改为模块内部函数，通过 `addEventListener` 绑定
- `map.js`：不再通过 `window._tileActionExplore()` 调用 tile-action，改为 import 调用
- `app.js`：移除所有 `window.xxx = xxx` 暴露

**改动范围**：`index.html`、`app.js`、`tile-action.js`、`map.js`、`player.js`

---

### 痛点 2：刷新策略不统一

**现状**：各操作成功后手动列举需要刷新的面板函数，列表不一致，容易遗漏：

- `map.js clickMove()` 成功后：`loadMap()` + `loadPlayerInfo()` + `loadInventory()` + `loadTileAction()` + `refreshLog()`（5个）
- `tile-action.js handleExplore()` 成功后：`loadMap()` + `loadInventory()` + `loadTileAction()`（3个，缺 `refreshLog` 和 `loadPlayerInfo`）
- `tile-action.js handleSearch()` / `handlePickup()`：同上

**风险**：新增面板时需要逐个修改所有 handler，遗漏则 UI 不同步

**解决方案**：利用现有 DataManager 的订阅机制（已实现但未使用），建立"操作 → 事件 → 刷新"的统一流程：

1. 操作成功后调用 `dataManager.invalidateAll()` + 发出一个语义事件（如 `game:action-completed`）
2. 各面板模块在初始化时通过 `dataManager.subscribe('game:action-completed', loadXxx)` 注册自己的刷新函数
3. 新增面板只需在自己的模块里 subscribe，无需修改其他模块

```
操作成功 → invalidateAll() → emit('game:action-completed')
                                    ↓
                          ┌─────────┼─────────┐
                          ↓         ↓         ↓
                      loadMap  loadInv   refreshLog  ...
```

**改动范围**：`data-manager.js`（确认 subscribe 可用）、`data.js`（事件定义）、`map.js`、`tile-action.js`、`inventory.js`、`log.js`、`player.js`、`app.js`

---

### 痛点 3：Promise.allSettled 无 await

**现状**：`app.js` 的 `loadAll()` 和 `map.js` 的 `clickMove()` 中：

```js
Promise.allSettled([loadMap(), loadInventory(), ...]);
```

没有 `await`，是"发射后不管"模式，无法捕获错误，也无法确保刷新完成。

**解决方案**：所有 `Promise.allSettled` 调用加 `await`，并用 `try/catch` 包裹。

**改动范围**：`app.js`、`map.js`

---

### 痛点 4：日志轮询效率

**现状**：`log.js` 使用 `setInterval` 每 3 秒调用 `gameApi('game_log')`，无论游戏状态是否变化都发请求。

**解决方案**：改为事件驱动——仅在 `game:action-completed` 事件触发时刷新日志，移除 `setInterval` 轮询。如果后续需要被动通知（如其他玩家操作），可引入 SSE 或长轮询。

**改动范围**：`log.js`

---

### 痛点 5：innerHTML 拼接的可维护性

**现状**：几乎所有 DOM 渲染都靠 HTML 字符串拼接 + `innerHTML`，模板与逻辑混杂，难以阅读。

**解决方案**：不引入模板引擎，但改善现有模式：

1. 将长字符串拼接改为模板字面量（template literal），提升可读性
2. 将模板提取为模块内的 `renderXxx()` 纯函数，与逻辑分离
3. 所有动态内容必须经过 `escapeHtml()` 转义

**改动范围**：`map.js`、`inventory.js`、`tile-action.js`、`player.js`（渐进式，不阻塞其他任务）

---

### 痛点 6：DebugBus 职责越界

**现状**：`DebugBus` 本意是调试日志通道，现在承担了模块间通信的职责（`map:loaded` 事件触发 inventory 和 tile-action 刷新）。

**解决方案**：模块间通信改用 DataManager 的 subscribe 机制（见痛点 2），DebugBus 回归纯调试职责。

**改动范围**：`data.js`、`map.js`、`inventory.js`、`tile-action.js`

---

## 第二部分：ASCII 终端风格迁移任务计划

> 参考实现：`vex/demo-ascii.html`（OBLIVIONS ASCII 终端风原型）
>
> 设计语言：CRT 显示器 + 终端界面美学。纯黑底色、灰阶亮度层次、等宽字体、ASCII 边框装饰、扫描线暗角、光标闪烁。

### 风格对照表

| 元素 | 剪纸风（当前） | ASCII 终端（目标，参考 demo-ascii） |
|------|---------------|--------------------------------------|
| 底色 | 奶油色 `#ede4d3` + 圆点纹理 | 纯黑 `#0a0a0a` + CRT 扫描线（`body::before`）+ 暗角（`body::after`） |
| 文字 | 纯黑 `#2d3436` | 灰阶亮度层次：dim `#444` / mid `#888` / bright `#bbb` / glow `#eee` / hi `#fff` |
| 字体 | Comic Sans MS + 微软雅黑 | **IBM Plex Mono**（等宽），回退 Consolas/Fira Code/monospace |
| 面板 | 白底 `#f5f0e8` + 3px 粗黑边框 + 12px 圆角 + drop-shadow 偏移 | 黑底 + **1px 灰线分隔**（`border-fg-dim/30`）+ 0 圆角 + 无阴影 |
| 面板标题 | `✂ 剪刀` + 虚线分隔 | **ASCII 边框** `┌─ TITLE ────┐` + 字符间距 `tracking-widest` + 英文（CARTOGRAPHY/CHRONICLE/INVENTORY/ARMAMENT/ACTIONS） |
| 按钮 | 糖果色底（黄/蓝/粉/绿）+ 粗边框 + 弹跳 hover | 黑底 + `border-fg-mid` 1px 边框 + **hover 反色**（白底黑字 `hover:bg-white hover:text-black`） |
| 地图格 | DOM grid + 彩色底（绿/黄/红）+ drop-shadow | 保留 DOM grid + ASCII 字符内容：`◆当前`/`▸▸▸出口`/`░░░迷雾`/`▓▓▓阻挡`/`··空`；灰阶边框 + hover 反色 |
| 迷雾 | 棕色纸质纹理 + 大号 `?` | `░░░` 字符 + `text-fg-dim/30`（极暗灰） |
| 当前格 | 黄底 + 红色内边框 | `◆` 字符 + `text-hi` 纯白 + `pulse-white` 发光动画 |
| 日志 | 黑色文字 + 彩色 span 高亮 | 灰阶文字 + **左侧竖线**（`border-l border-fg-dim/20`）+ `[SYS][MOV][FND][SRC][TRP][ENV]` 标签前缀 + log-yellow/green/red/gray 灰阶高亮类 |
| 背包格 | 白底卡片 + 粗边框 + 斜线空格 | 黑底 + 1px 灰线边框（`border-fg-dim/30`）+ `[N]` 序号 + 空格用虚线边框 + `opacity-25` |
| 装备槽 | 白底卡片 + emoji 图标 | 黑底 + 底部 1px 分隔线（`border-b`）+ `WPN/ARM/ACC` 三字母标签 + 数值右对齐 + HP/SP/EXP 状态条 |
| 抽屉 | 黄底 + 粗边框 | 黑底 + 蜡黄右边框 `border-r-2 border-hi` + `├─/└─` 树状标签前缀 |
| Bottom Sheet | 米色 + 4px 粗描边 + 16px 圆角 | 黑底 + 顶部 2px 白线 `border-t-2 border-hi` + 0 圆角 + ASCII 标题栏 + `[ESC]` 关闭提示 |
| Toast | 米色卡片 + 旋转入场 | 黑底 + `border-fg-mid` 1px 边框 + `[OK]`/`[ERR]` 标签前缀 + `shadow-[0_0_10px_rgba(255,255,255,0.08)]` 微光 |
| 动画 | live2dBreathe 呼吸抖动 + panelBreathe | **cursor-blink** 光标闪烁 + **pulse-white** 当前格发光 + **bar-fill** 状态条填充 |
| 色彩策略 | 多彩色相（黄/蓝/粉/绿/红） | **纯灰阶 + 白**，几乎无彩色，靠亮度层次区分 |

### 关键设计决策（基于 demo-ascii）

1. **纯灰阶无彩色**：不使用色相，只用亮度层次（dim→mid→bright→glow→hi）。这是 ASCII 终端风的核心。
2. **ASCII 边框装饰**：每个面板用 `┌─ TITLE ────┐ / └ ── ┘` 包裹，title 用英文 + `tracking-widest`。
3. **等宽字体**：IBM Plex Mono，所有内容对齐成表格感。
4. **CRT 效果**：`body::before` 扫描线（1px 黑线每 3px）+ `body::after` 暗角（径向渐变）。
5. **保留 DOM grid 地图**：不改为 `<pre>` ASCII 表格（避免 map.js 大重构）。但格子内容用 ASCII 字符（◆/▸/░/▓/·），样式改灰阶。
6. **日志标签前缀**：`[SYS]/[MOV]/[FND]/[SRC]/[TRP]/[ENV]` 分类，需后端或前端解析日志分类（前端用正则匹配关键词）。
7. **Tailwind 驱动**：HTML 和 JS 动态生成的内容都用 Tailwind 工具类（`border-fg-dim/30`、`hover:bg-white/5`、`hover:border-hi` 等）。

---

### 任务列表

#### 阶段 0：基础设施

| # | 任务 | 说明 | 涉及文件 |
|---|------|------|---------|
| 0.1 | 引入 Tailwind CSS CDN | 在 `index.html` 中添加 `<script src="https://cdn.tailwindcss.com">` | `index.html` |
| 0.2 | 定义 Tailwind 主题 | 配置色板 `bg:#0a0a0a`、`fg.dim/mid/bright/glow`、`hi`、`fontFamily.mono: IBM Plex Mono`；引入 IBM Plex Mono Google Fonts | `index.html` 内 tailwind.config |
| 0.3 | 创建 `terminal.css` | Tailwind 无法覆盖的样式：CRT 扫描线、暗角、cursor-blink/pulse-white/bar-fill 动画、滚动条、::selection、日志颜色类、ASCII 字符样式 | `css/terminal.css`（新建） |

#### 阶段 1：架构重构（第一部分痛点）

| # | 任务 | 说明 | 涉及文件 |
|---|------|------|---------|
| 1.1 | 消除 window 全局函数 | 痛点 1：HTML 移除所有 onclick，JS 用 addEventListener 绑定 | `index.html`、`app.js`、`tile-action.js`、`map.js`、`player.js` |
| 1.2 | 统一刷新策略 | 痛点 2：dataManager.subscribe 机制，操作完成发 `game:action-completed`，各面板订阅刷新 | `data-manager.js`、`data.js`、`map.js`、`tile-action.js`、`inventory.js`、`log.js`、`player.js`、`app.js` |
| 1.3 | 修复 Promise 无 await | 痛点 3：loadAll/clickMove 的 Promise.allSettled 加 await + try/catch | `app.js`、`map.js` |
| 1.4 | 日志改为事件驱动 | 痛点 4：移除 setInterval 轮询，订阅 `game:action-completed` 刷新 | `log.js` |
| 1.5 | DebugBus 回归调试职责 | 痛点 6：map:loaded 通信改用 dataManager.subscribe | `data.js`、`map.js`、`inventory.js`、`tile-action.js` |

#### 阶段 2：HTML 结构调整

| # | 任务 | 说明 | 涉及文件 |
|---|------|------|---------|
| 2.1 | 重写页面头部 | 移除 SVG 剪纸装饰，改为 ASCII art 标题（OBLIVIONS 大字）+ 状态行（SECTOR/LOC/TURN/SYSTEM ONLINE） | `index.html` |
| 2.2 | 重写布局结构 | 双栏 `grid-cols-[55%_1fr]` + 1px 墨线分隔（border-r/border-b）；地图下方 ACTIONS 面板；右侧 CHRONICLE(上) + INVENTORY/ARMAMENT(下) | `index.html` |
| 2.3 | 面板标题改 ASCII 边框 | 每个面板 `┌─ TITLE ────┐` + 英文标题（CARTOGRAPHY/CHRONICLE/INVENTORY/ARMAMENT/ACTIONS）+ tracking-widest | `index.html` |
| 2.4 | 重写 Bottom Sheet DOM | 黑底 + border-t-2 border-hi + ASCII 标题栏 + `[ESC]` 关闭提示 | `index.html` |
| 2.5 | 重写 Drawer DOM | 黑底 + border-r-2 border-hi + `├─/└─` 树状标签 + STATS 竖排按钮 | `index.html` |
| 2.6 | 重写 Toast DOM | 黑底 + border-fg-mid + `[OK]/[ERR]` 标签 | `index.html` |
| 2.7 | 添加底部状态栏 | HP/SP/LV/REGION/LOC 一行状态信息 | `index.html` |

#### 阶段 3：CSS 样式迁移（terminal.css）

| # | 任务 | 说明 | 涉及文件 |
|---|------|------|---------|
| 3.1 | CRT 全局效果 | body::before 扫描线、body::after 暗角、滚动条、::selection | `css/terminal.css` |
| 3.2 | ASCII 面板标题样式 | `┌─┐│└┘` 边框组件类、tracking-widest | `css/terminal.css` |
| 3.3 | 地图格 ASCII 样式 | ◆当前（pulse-white 发光）/▸▸▸出口/░░░迷雾/▓▓▓阻挡/··空 格子类 + hover 反色 | `css/terminal.css` |
| 3.4 | 按钮终端样式 | 黑底 + border-fg-mid + hover:bg-white hover:text-black 反色 + disabled 灰显 | `css/terminal.css` |
| 3.5 | 日志终端样式 | log-yellow/green/red/grey 灰阶高亮类 + 左侧竖线 + `[TAG]` 标签 | `css/terminal.css` |
| 3.6 | 背包/装备终端样式 | 黑底道具格 + 虚线空格 + 三字母装备标签 + 状态条 | `css/terminal.css` |
| 3.7 | 弹窗/Toast/抽屉终端样式 | 黑底 + 白线分隔 + 标签前缀 + 微光阴影 | `css/terminal.css` |
| 3.8 | 动画关键帧 | cursor-blink / pulse-white / bar-fill | `css/terminal.css` |

#### 阶段 4：JS 适配

| # | 任务 | 说明 | 涉及文件 |
|---|------|------|---------|
| 4.1 | map.js 适配 | renderMapGrid 格子内容改 ASCII 字符 + 灰阶类名；clickMove 加 await；监听 game:action-completed 刷新 | `map.js` |
| 4.2 | inventory.js 适配 | slot-card 改黑底灰线类名；[N] 序号；空格虚线；丢弃按钮终端样式 | `inventory.js` |
| 4.3 | tile-action.js 适配 | tile-row 改灰线类名；[S][P] 标签前缀；按钮终端样式；addEventListener 替代 window | `tile-action.js` |
| 4.4 | player.js 适配 | drawer 内容改 `├─/└─` 树状 + 状态条；addEventListener 替代 window | `player.js` |
| 4.5 | log.js 适配 | 日志前缀 [SYS][MOV][FND] 解析 + 灰阶高亮类；事件驱动刷新 | `log.js` |
| 4.6 | app.js 适配 | 移除 window 暴露；loadAll 加 await；loadAll 改为 async | `app.js` |

#### 阶段 5：验证与清理

| # | 任务 | 说明 | 涉及文件 |
|---|------|------|---------|
| 5.1 | 全功能回归测试 | 移动、探索、搜索、拾取、丢弃、区域切换、日志刷新、抽屉开关 | 浏览器 |
| 5.2 | 清理旧文件 | 删除 `style.css`（确认无引用）、`demo-ascii.html`、其他 demo 文件 | `vex/` |

---

### 执行优先级

```
阶段 0（基础设施：Tailwind + terminal.css 骨架）
  → 阶段 2（HTML 结构调整：纯结构改动，视觉由 Tailwind 类驱动）
  → 阶段 3（CSS 补充：terminal.css 填补 Tailwind 覆盖不到的 CRT/动画/日志类）
  → 阶段 4（JS 适配：类名更新 + 架构重构整合）
  → 阶段 1（架构重构：可与阶段 4 合并，统一刷新/window 消除）
  → 阶段 5（验证清理）
```

理由：先搭好 Tailwind 基础和 HTML 骨架（demo-ascii 已验证可行的结构），再用 terminal.css 补充 CRT 特效。架构重构（window 消除/统一刷新）与 JS 类名适配天然合并，避免重复改 JS 文件。

---

### Tailwind 使用策略

| 场景 | 方案 |
|------|------|
| HTML 静态结构（布局、面板、标题、边框） | Tailwind 工具类（`flex grid border border-fg-dim/30 hover:bg-white/5` 等） |
| JS 动态生成的 HTML（地图格、道具格、动作条行） | Tailwind 工具类为主，复杂场景用 terminal.css 语义类 |
| CRT 扫描线、暗角、动画关键帧 | `terminal.css`（伪元素 + @keyframes） |
| 日志灰阶高亮 | `terminal.css`（log-yellow/green/red/grey 类） |
| 色板 token | Tailwind theme.colors（bg/fg.dim/mid/bright/glow/hi） |

---

### 日志标签分类方案（前端解析）

demo-ascii 的日志用 `[TAG]` 前缀分类。由于后端日志是 HTML 字符串（无标签），前端在 `log.js` 渲染时用正则匹配关键词推断标签：

| 后端日志特征 | 前端推断标签 |
|-------------|-------------|
| 包含「移动到了」「从...出发」 | `[MOV]` |
| 包含「发现了」「搜索了」「获得了」 | `[FND]` / `[SRC]` |
| 包含「陷阱」「伤害」「受伤」 | `[TRP]` |
| 包含「进入了」「离开了」 | `[ENV]` |
| 其他系统消息 | `[SYS]` |

**注意**：此为前端启发式解析，可能误判。若需精确分类，需后端在日志生成时注入标签（本次不做，前端解析足够 demo 效果）。

---

### 不引入额外框架的理由

| 框架 | 不引入理由 |
|------|-----------|
| React/Vue/Svelte | 项目仅 5 个面板、~1300 行 JS，组件框架过重；与"直接打开 HTML 即可运行"的部署方式冲突 |
| 构建工具(Vite) | 当前无构建步骤，改文件刷新即可；等 Tailwind 生产构建时再引入 |
| 状态管理库 | 状态仅 `mapData` + 几个模块变量，DataManager subscribe 机制够用 |
| HTTP 库(Axios) | 仅 3 个 API 端点，原生 fetch 够用 |

---

### 与原"暗黑手账"计划的差异说明

本次将原计划的"暗黑手账（Dark Grimoire）"风格改为"ASCII 终端"风格（参考 demo-ascii.html）。主要差异：

| 维度 | 暗黑手账（已废弃） | ASCII 终端（采用） |
|------|-------------------|-------------------|
| 色彩 | 暖色多色（parchment/ink/blood/moss/wax） | **纯灰阶 + 白** |
| 字体 | 衬线（Cinzel + Noto Serif SC） | **等宽**（IBM Plex Mono） |
| 装饰 | `◈` 符号 + 蜡封 | **ASCII 边框** `┌─┐│└┘` |
| 地图 | DOM grid 渐变背景 | DOM grid + **ASCII 字符内容**（◆/▸/░/▓/·） |
| 特效 | 噪点纹理 + 暗角 | **CRT 扫描线** + 暗角 + 光标闪烁 |
| 样式文件 | `grimoire.css` | **`terminal.css`** |
| 参考来源 | 原创设计 | **demo-ascii.html**（已验证原型） |
