# Toast 即时反馈系统设计案

> 解决问题：2 级页面（模态框/抽屉）打开时，全屏遮罩遮挡日志区，玩家看不到操作反馈。
>
> 核心思路：利用结构化日志系统作为单一数据源，在 2 级页面打开期间，根据日志增量触发 Toast 即时反馈。零布局改动，操作函数零侵入。

---

## 1. 设计目标

### 1.1 核心目标
- **2 级页面打开时，操作反馈立即可见**，不被遮罩遮挡
- **零布局改动**：不改 HTML 结构，不改模态框/抽屉定位
- **操作函数零侵入**：`handlePickup`/`handleSearch` 等不修改
- **单一数据源**：后端 emit → 前端拉取 → 同时渲染日志 + 触发 Toast

### 1.2 非目标
- 不改模态框/抽屉的定位与遮罩
- 不改背包/属性抽屉为模态框（保持抽屉形态）
- 不处理 `move.*` 类日志的 Toast（移动反馈通过地图变化已足够明显）

---

## 2. 触发机制

### 2.1 增量检测

`refreshLog()` 拉取日志时，通过时间戳对比识别新增条目：

```javascript
let lastTs = 0;  // 模块级状态，记录上次拉取的最大 ts

// 在 refreshLog 内部
const newEntries = entries.filter(e => e.ts > lastTs);
// ... 渲染 + Toast 逻辑 ...
lastTs = entries.length ? entries[entries.length - 1].ts : lastTs;
```

**首次加载保护**：`lastTs` 初始为 0，但首次拉取时不触发 Toast（避免历史日志全部弹出）。通过 `isAnyOverlayOpen()` 守卫自然实现——页面首次加载时没有 2 级页面打开。

### 2.2 触发条件

**任何 2 级页面（模态框/抽屉）打开时，才触发 Toast。** 无 2 级页面时，日志区可见，不需要 Toast。

```javascript
function isAnyOverlayOpen() {
    return document.getElementById('modalOverlay').classList.contains('open') ||
           document.getElementById('invDrawerOverlay').classList.contains('open') ||
           document.getElementById('drawerOverlay').classList.contains('open');
}
```

### 2.3 白名单规则

只对"需要即时反馈"的日志 ID 触发 Toast。`move.*` 不加入（地图变化已足够明显）。

```javascript
const TOAST_RULES = {
    'pickup.bag_full':  { style: 'error' },
    'pickup.success':   { style: 'success' },
    'pickup.no_item':   { style: 'error' },
    'search.no_find':   { style: 'error' },
    'search.already':   { style: 'error' },
    'discard.success':  { style: 'success' },
};
```

**Toast 内容**：复用 `renderLogEntry(entry)` 的输出，与日志区显示一致。

---

## 3. Toast 位置动态切换

### 3.1 位置规则

根据当前打开的 2 级页面类型，动态切换 Toast 容器位置：

| 2 级页面状态 | Toast 位置 | CSS class |
|-------------|-----------|-----------|
| 无（默认） | 右上角 | （无 class） |
| 开右抽屉（背包） | 左上角 | `.pos-left` |
| 开左抽屉（属性） | 右上角（保持默认） | （无 class） |
| 开模态框 | 中上 | `.pos-center` |

### 3.2 优先级

模态框和抽屉当前互斥（不能共存），优先级：`模态框 > 右抽屉 > 左抽屉/默认`。

### 3.3 CSS 实现

```css
/* 默认：右上角 */
.toast-container {
    top: 12px;
    right: 12px;
    left: auto;
    transform: none;
}

/* 右抽屉开：左上角 */
.toast-container.pos-left {
    right: auto;
    left: 12px;
}

/* 模态框开：中上 */
.toast-container.pos-center {
    right: auto;
    left: 50%;
    transform: translateX(-50%);
}
```

### 3.4 位置切换时机

在 `openModal`/`closeModal`/`openInvDrawer`/`closeInvDrawer`/`openPlayerDrawer`/`closeDrawer` 等函数中调用 `updateToastPosition()`：

```javascript
function updateToastPosition() {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    container.classList.remove('pos-left', 'pos-center');

    if (document.getElementById('modalOverlay').classList.contains('open')) {
        container.classList.add('pos-center');
    } else if (document.getElementById('invDrawerOverlay').classList.contains('open')) {
        container.classList.add('pos-left');
    }
    // 左抽屉或无 2 级页面：保持默认（右上角）
}
```

**已有 Toast 的处理**：位置切换时已有 Toast 会跟随容器跳动。Toast 持续 2s，跳动可接受，不做特殊处理。

---

## 4. Toast 自动消失

当前 `showToast` 已有 `duration` 参数（默认 2000ms）和 `setTimeout` 自动消失逻辑（[tile-action.js:29-32](file:///d:/wamp64/www/phpdts/vex/js/tile-action.js#L29-L32)）。本次设计沿用，不修改。

```javascript
// 现有实现，无需改动
setTimeout(function() {
    toast.classList.remove('show');
    setTimeout(function() { toast.remove(); }, 300);
}, duration);
```

---

## 5. 实现方案

### 5.1 文件改动清单

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| [vex/js/log.js](file:///d:/wamp64/www/phpdts/vex/js/log.js) | 修改 | 增量检测 + Toast 触发 + `isAnyOverlayOpen` + `updateToastPosition` |
| [vex/js/tile-action.js](file:///d:/wamp64/www/phpdts/vex/js/tile-action.js) | 修改 | `openModal`/`closeModal` 调用 `updateToastPosition` |
| [vex/js/app.js](file:///d:/wamp64/www/phpdts/vex/js/app.js) | 修改 | `openInvDrawer`/`closeInvDrawer` 调用 `updateToastPosition` |
| [vex/js/player.js](file:///d:/wamp64/www/phpdts/vex/js/player.js) | 修改 | `toggleDrawer`/`closeDrawer` 调用 `updateToastPosition` |
| [vex/css/terminal.css](file:///d:/wamp64/www/phpdts/vex/css/terminal.css) | 修改 | `.toast-container` 定位 + `.pos-left` / `.pos-center` 变体 |

### 5.2 log.js 改动详情

```javascript
import { DebugBus } from './data.js';
import { gameApi } from './utils.js';
import { dataManager } from './data-manager.js';
import { renderLogEntry } from '../data/log-templates.js';
import { showToast, isAnyOverlayOpen, updateToastPosition } from './toast-position.js';

const ACTION_TAGS = { /* ... 保持不变 ... */ };

// Toast 白名单：仅这些日志 ID 触发即时反馈
const TOAST_RULES = {
    'pickup.bag_full':  { style: 'error' },
    'pickup.success':   { style: 'success' },
    'pickup.no_item':   { style: 'error' },
    'search.no_find':   { style: 'error' },
    'search.already':   { style: 'error' },
    'discard.success':  { style: 'success' },
};

let lastTs = 0;  // 增量检测：记录上次拉取的最大 ts

export async function refreshLog(forceScroll = true) {
    const el = document.getElementById('logContent');
    if (!el) return;

    const result = await gameApi('obl_log');
    if (result.status !== 'success') return;

    const entries = result.data.entries || [];

    // ── 增量检测 ──
    const newEntries = entries.filter(e => e.ts > lastTs);

    // ── Toast 触发（仅在 2 级页面打开时） ──
    if (isAnyOverlayOpen()) {
        for (const entry of newEntries) {
            const rule = TOAST_RULES[entry.id];
            if (rule) {
                const content = renderLogEntry(entry);
                if (content) showToast(content, rule.style, 2000);
            }
        }
    }

    // ── 更新 lastTs ──
    lastTs = entries.length ? entries[entries.length - 1].ts : lastTs;

    // ── 渲染日志区（保持原有逻辑） ──
    if (entries.length === 0) {
        el.innerHTML = '<span class="grey">[SYS] 暂无日志</span>';
        return;
    }
    const htmlParts = entries.map(entry => {
        const tag = ACTION_TAGS[entry.action] || 'SYS';
        const content = renderLogEntry(entry);
        if (!content) return '';
        return `<span class="log-tag">[${tag}]</span>${content}`;
    }).filter(p => p);
    el.innerHTML = htmlParts.join('<br>');

    // ── 滚动逻辑（保持原有逻辑） ──
    const scroller = el.parentElement;
    if (forceScroll) {
        scroller.scrollTop = scroller.scrollHeight;
    } else {
        const isNearBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 50;
        if (isNearBottom) scroller.scrollTop = scroller.scrollHeight;
    }

    DebugBus.emit('log', 'refreshLog:done', { count: entries.length });
}

dataManager.listen('game:action-completed', function() { refreshLog(); });
dataManager.listen('map:loaded', function() { refreshLog(); });
```

### 5.3 toast-position.js（新建，集中管理 Toast 位置逻辑）

为避免 `log.js`/`tile-action.js`/`app.js`/`player.js` 之间循环依赖，新建 `vex/js/toast-position.js` 集中管理：

```javascript
// vex/js/toast-position.js
import { showToast as originalShowToast } from './tile-action.js';

/**
 * 检测是否有 2 级页面（模态框/抽屉）打开
 */
export function isAnyOverlayOpen() {
    return document.getElementById('modalOverlay')?.classList.contains('open') ||
           document.getElementById('invDrawerOverlay')?.classList.contains('open') ||
           document.getElementById('drawerOverlay')?.classList.contains('open');
}

/**
 * 根据当前打开的 2 级页面，更新 Toast 容器位置
 * 优先级：模态框 > 右抽屉 > 左抽屉/默认
 */
export function updateToastPosition() {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    container.classList.remove('pos-left', 'pos-center');

    if (document.getElementById('modalOverlay')?.classList.contains('open')) {
        container.classList.add('pos-center');
    } else if (document.getElementById('invDrawerOverlay')?.classList.contains('open')) {
        container.classList.add('pos-left');
    }
    // 左抽屉或无 2 级页面：保持默认（右上角）
}

// 重新导出 showToast，方便其他模块统一从本文件导入
export function showToast(message, type, duration) {
    originalShowToast(message, type, duration);
}
```

### 5.4 tile-action.js 改动

```javascript
// 导入 updateToastPosition
import { updateToastPosition } from './toast-position.js';

// openModal 末尾追加
function openModal(title, bodyHtml) {
    // ... 原有逻辑 ...
    if (overlay) overlay.classList.add('open');
    bindModalEvents();
    updateToastPosition();  // 新增
}

// closeModal 末尾追加
export function closeModal() {
    const overlay = document.getElementById('modalOverlay');
    if (overlay) overlay.classList.remove('open');
    updateToastPosition();  // 新增
}
```

### 5.5 app.js 改动

```javascript
import { updateToastPosition } from './toast-position.js';

function openInvDrawer() {
    // ... 原有逻辑 ...
    overlay.classList.add('open');
    loadInventory();
    updateToastPosition();  // 新增
}

function closeInvDrawer() {
    // ... 原有逻辑 ...
    overlay.classList.remove('open');
    updateToastPosition();  // 新增
}
```

### 5.6 player.js 改动

```javascript
import { updateToastPosition } from './toast-position.js';

export function toggleDrawer() {
    // ... 原有逻辑 ...
    if (drawerOpen) {
        drawer.classList.add('open');
        overlay.classList.add('open');
        loadPlayerInfo();
    } else {
        drawer.classList.remove('open');
        overlay.classList.remove('open');
    }
    updateToastPosition();  // 新增
}

export function closeDrawer() {
    // ... 原有逻辑 ...
    drawerOpen = false;
    drawer.classList.remove('open');
    overlay.classList.remove('open');
    updateToastPosition();  // 新增
}
```

### 5.7 terminal.css 改动

```css
/* ═══ Toast ═══ */

.toast-container {
    position: fixed;
    top: 12px;
    right: 12px;
    left: auto;
    transform: none;
    z-index: 500;
    display: flex;
    flex-direction: column;
    gap: 6px;
    pointer-events: none;
    transition: left 0.2s, right 0.2s, transform 0.2s;  /* 位置切换平滑过渡 */
}

/* 右抽屉开：左上角 */
.toast-container.pos-left {
    right: auto;
    left: 12px;
}

/* 模态框开：中上 */
.toast-container.pos-center {
    right: auto;
    left: 50%;
    transform: translateX(-50%);
}
```

---

## 6. 数据流总览

```
玩家在 2 级页面操作（如拾取）
    ↓
commandQueue.execute() → 后端 obl_pickup_item
    ↓
后端 emit 日志条目（如 pickup.bag_full）→ 持久化到 obl_log_*.json
    ↓
command.php 响应 → broadcast('game:action-completed')
    ↓
refreshLog() 触发
    ↓
拉取 obl_log API → 增量检测（ts > lastTs）
    ↓
isAnyOverlayOpen() === true → 查 TOAST_RULES
    ↓
匹配白名单 → showToast(renderLogEntry(entry), style, 2000)
    ↓
Toast 在动态位置（左上/中上/右上）显示 2s
```

---

## 7. 测试要点

### 7.1 Toast 触发
- [ ] 开模态框时拾取成功 → 中上显示 `[OK]你拾取了XXX。` 2s 后消失
- [ ] 开模态框时背包已满拾取 → 中上显示 `[ERR]背包已满，无法拾取。`
- [ ] 开右抽屉时丢弃道具 → 左上显示 `[OK]你丢弃了XXX。`
- [ ] 无 2 级页面时拾取 → 不弹 Toast，仅日志区更新
- [ ] 首次加载页面（lastTs=0）→ 不弹 Toast

### 7.2 位置切换
- [ ] 开右抽屉 → Toast 容器移到左上角
- [ ] 关右抽屉 → Toast 容器回到右上角
- [ ] 开模态框 → Toast 容器移到中上
- [ ] 关模态框 → Toast 容器回到右上角
- [ ] 开左抽屉 → Toast 容器保持右上角
- [ ] 位置切换时已有 Toast 跟随跳动（可接受）

### 7.3 增量检测
- [ ] 连续操作多条 → 每条新增日志都触发对应 Toast
- [ ] `move.*` 日志不触发 Toast（不在白名单）
- [ ] `move.tile_desc` 等空内容日志不触发 Toast

### 7.4 回归测试
- [ ] 日志区渲染正常（不受 Toast 逻辑影响）
- [ ] 日志区自动滚动正常（不受 Toast 逻辑影响）
- [ ] 模态框/抽屉开关正常（不受 `updateToastPosition` 影响）

---

## 8. 实施顺序

1. **CSS**：[terminal.css](file:///d:/wamp64/www/phpdts/vex/css/terminal.css) 添加 `.pos-left` / `.pos-center`
2. **新建 toast-position.js**：`isAnyOverlayOpen` + `updateToastPosition`
3. **log.js**：增量检测 + Toast 触发逻辑
4. **tile-action.js**：`openModal`/`closeModal` 调用 `updateToastPosition`
5. **app.js**：`openInvDrawer`/`closeInvDrawer` 调用 `updateToastPosition`
6. **player.js**：`toggleDrawer`/`closeDrawer` 调用 `updateToastPosition`
7. **集成测试**：按第 7 节测试要点验证
