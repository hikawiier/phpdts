# 日志与 Toast 体验增强设计案

> 在已实装的结构化日志系统和 Toast 即时反馈系统基础上，增强日志区的可读性和 Toast 的显示体验。
>
> 前置文档：[结构化日志系统设计案](../../oblivions/docs/已完成任务/结构化日志系统设计案.md) | [Toast 即时反馈系统设计案](../../oblivions/docs/Toast即时反馈系统设计案.md)

---

## 1. 设计目标

### 1.1 三个功能

| 功能 | 解决的痛点 | 核心思路 |
|------|-----------|---------|
| **新日志高亮闪烁** | `refreshLog()` 全量重渲染，玩家无法区分哪些是新日志 | 渲染时给新增条目加 `log-new` 类，CSS 动画 1.5s 高亮淡出 |
| **新日志提示按钮** | 玩家翻看历史时新日志进来不知道，强制滚动打断翻看 | 尊重玩家滚动位置，不在底部时显示"↓ N 条新日志"浮层按钮 |
| **Toast 同类合并** | "全部拾取"等批量操作触发多条同 ID Toast，堆叠刷屏 | 相邻同 ID Toast 合并显示 `×N`，重置消失计时器 |

### 1.2 非目标

- 不做 Toast 队列上限（合并已解决刷屏，队列增加复杂度）
- 不做 Toast 历史栈（Toast 定位是即时反馈，错过看日志区）
- 不做日志区重复折叠（破坏时间线语义，交给未来的日志过滤）
- 不做日志 action 过滤（等未来日志类型丰富后再做）

---

## 2. 功能一：新日志高亮闪烁

### 2.1 问题

`refreshLog()` 每次全量重渲染 `#logContent` 的 `innerHTML`，所有日志条目重新创建。玩家无法区分哪些是这次刷新新增的，哪些是历史的。

### 2.2 实现思路

利用现有的 `lastTs` 增量检测机制。渲染前记录 `prevLastTs` 作为分界线，渲染时对 `entry.ts > prevLastTs` 的条目加 `log-new` 类。

### 2.3 log.js 改动

```javascript
let lastTs = 0;  // 增量检测：记录上次拉取的最大 ts

export async function refreshLog(forceScroll = true) {
    const el = document.getElementById('logContent');
    if (!el) return;

    const result = await gameApi('obl_log');
    if (result.status !== 'success') return;

    const entries = result.data.entries || [];

    // ── 增量检测 ──
    // prevLastTs 是本次渲染的分界线：ts > prevLastTs 的条目视为"新日志"
    const prevLastTs = lastTs;
    const newEntries = entries.filter(e => e.ts > prevLastTs);

    // ── Toast 触发（仅在 2 级页面打开时） ──
    if (isAnyOverlayOpen() && newEntries.length > 0) {
        for (let i = 0; i < newEntries.length; i++) {
            const entry = newEntries[i];
            const rule = TOAST_RULES[entry.id];
            if (rule) {
                const content = renderLogEntry(entry);
                if (content) showToast(content, rule.style, 2000, true, entry.id);
            }
        }
    }

    // ── 更新 lastTs ──
    lastTs = entries.length ? entries[entries.length - 1].ts : lastTs;

    // ── 渲染日志区 ──
    if (entries.length === 0) {
        el.innerHTML = '<span class="grey">[SYS] 暂无日志</span>';
        return;
    }

    // 首次加载保护：prevLastTs === 0 时不标记新日志（避免全部高亮）
    const markNew = prevLastTs > 0;

    const htmlParts = entries.map(entry => {
        const tag = ACTION_TAGS[entry.action] || 'SYS';
        const content = renderLogEntry(entry);
        if (!content) return '';
        const isNew = markNew && entry.ts > prevLastTs;
        const newClass = isNew ? ' log-new' : '';
        return `<span class="log-entry${newClass}"><span class="log-tag">[${tag}]</span>${content}</span>`;
    }).filter(p => p);

    el.innerHTML = htmlParts.join('<br>');

    // ── 滚动逻辑（见功能二改动） ──
    // ...

    DebugBus.emit('log', 'refreshLog:done', { count: entries.length, newCount: newEntries.length });
}
```

**关键变化**：
- 渲染前记录 `prevLastTs = lastTs`，作为"新日志"的分界线
- 每条日志包裹在 `<span class="log-entry">` 中（原来没有外层 span），新增 `log-new` 类
- 首次加载保护：`prevLastTs === 0` 时不标记（避免历史日志全部高亮）

### 2.4 CSS 改动

```css
/* ═══ 日志条目 ═══ */

/* 新日志高亮：1.5s 背景闪烁淡出 */
@keyframes log-new-flash {
    0%   { background: rgba(255, 255, 255, 0.15); }
    100% { background: transparent; }
}

.log-new {
    animation: log-new-flash 1.5s ease-out;
    border-radius: 2px;
}
```

**设计说明**：
- 高亮用半透明白色背景（`rgba(255,255,255,0.15)`），与终端黑白灰阶风格一致
- 1.5s 持续时间：足够引起注意，但不会持续干扰
- `ease-out`：前半段快速衰减，后半段缓慢消失
- `border-radius: 2px`：轻微圆角，让高亮区域更清晰
- 动画结束后不需要移除类（`innerHTML` 重渲染会自然清除）

### 2.5 边界情况

| 场景 | 处理 |
|------|------|
| 首次加载（`prevLastTs=0`） | 不标记新日志，避免全部高亮 |
| 无新日志（`newEntries` 为空） | 不标记，正常渲染 |
| 日志被 200 条上限裁剪 | 不影响：`prevLastTs` 仍小于现有最小 ts，无条目被标记 |
| 连续多次操作 | 每次操作的增量日志各自高亮，互不干扰 |

---

## 3. 功能二：新日志提示按钮

### 3.1 问题

当前 `refreshLog(forceScroll)` 的两个调用点都传 `forceScroll=true`（默认值），始终强制滚动到底部。未来若引入自动刷新场景（定时轮询、WebSocket 推送等），强制滚动会打断玩家翻看历史。

本功能预先建立"尊重玩家滚动位置"的机制，在 `forceScroll=false` 场景下生效：玩家不在底部时不强制滚动，改为显示"↓ N 条新日志"浮层按钮。

### 3.2 行为规则

遵循"默认操作强制滚动，特殊场景尊重玩家位置"的原则：

| `forceScroll` | 场景 | 行为 |
|---------------|------|------|
| `true`（默认） | 玩家主动操作（移动、探索、拾取等） | 始终强制滚动到底部 + 清零未读 |
| `false` | 自动刷新、被动通知等 | 在底部则滚动；不在底部则累加未读 + 显示提示按钮 |

**理由**：
1. 玩家主动操作需要立刻看到反馈 → 强制滚动
2. 被动刷新不应打断玩家翻看历史 → 尊重位置 + 提示按钮
3. 操作反馈通过 Toast（2 级页面打开时）和新日志高亮（功能一）已足够即时

### 3.3 状态管理

```javascript
// 模块级状态
let unreadCount = 0;       // 未读新日志计数
let isAtBottom = true;     // 滚动容器是否在底部（初始为 true）
```

### 3.4 log.js 改动

```javascript
let unreadCount = 0;
let isAtBottom = true;

// ── 滚动容器引用 ──
function getScroller() {
    const el = document.getElementById('logContent');
    return el ? el.parentElement : null;
}

// ── 判断是否在底部附近 ──
function checkIsAtBottom() {
    const scroller = getScroller();
    if (!scroller) return true;
    return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 50;
}

// ── 更新未读计数和提示按钮 ──
function updateUnreadButton() {
    const btn = document.getElementById('logUnreadBtn');
    const countEl = document.getElementById('logUnreadCount');
    if (!btn || !countEl) return;

    if (unreadCount > 0) {
        countEl.textContent = unreadCount;
        btn.style.display = '';
    } else {
        btn.style.display = 'none';
    }
}

// ── 滚动到底部并清零 ──
function scrollToBottom() {
    const scroller = getScroller();
    if (scroller) {
        scroller.scrollTop = scroller.scrollHeight;
    }
    unreadCount = 0;
    isAtBottom = true;
    updateUnreadButton();
}

// ── 滚动事件监听（初始化时绑定） ──
function bindScrollListener() {
    const scroller = getScroller();
    if (!scroller) return;
    scroller.addEventListener('scroll', function() {
        const wasAtBottom = isAtBottom;
        isAtBottom = checkIsAtBottom();
        // 滚动到底部时清零未读
        if (!wasAtBottom && isAtBottom) {
            unreadCount = 0;
            updateUnreadButton();
        }
    });
}

export async function refreshLog(forceScroll = true) {
    // ... 拉取日志 + 增量检测 + Toast 触发（见功能一） ...
    // ... 渲染日志区（见功能一） ...

    // ── 滚动逻辑（行为变更） ──
    const scroller = getScroller();
    if (!scroller) return;

    if (forceScroll) {
        // 操作触发：尊重玩家滚动位置
        if (isAtBottom) {
            // 在底部：自动滚动到底部
            scrollToBottom();
        } else {
            // 不在底部：不强制滚动，累加未读计数
            if (newEntries.length > 0) {
                unreadCount += newEntries.length;
                updateUnreadButton();
            }
        }
    } else {
        // 被动刷新：仅在底部时滚动
        if (isAtBottom) {
            scroller.scrollTop = scroller.scrollHeight;
        } else if (newEntries.length > 0) {
            unreadCount += newEntries.length;
            updateUnreadButton();
        }
    }

    DebugBus.emit('log', 'refreshLog:done', { count: entries.length, newCount: newEntries.length });
}

// ── 初始化时绑定滚动监听 ──
// 在 app.js 的 loadAll() 或 log.js 模块顶层调用
export function initLog() {
    bindScrollListener();
}
```

### 3.5 提示按钮点击处理

```javascript
// 点击提示按钮 → 滚动到底部并清零
function bindUnreadButton() {
    const btn = document.getElementById('logUnreadBtn');
    if (btn) {
        btn.addEventListener('click', scrollToBottom);
    }
}
```

### 3.6 index.html 改动

在 CHRONICLE 标题栏右侧添加未读提示按钮：

```html
<!-- Log (flex:4) -->
<div class="min-h-0 flex flex-col p-3 overflow-hidden border-b border-fg-dim/30" style="flex:4 1 0%;">
    <div class="ascii-title flex-none mb-1.5">
        <span>┌─</span>
        <span class="ascii-label">CHRONICLE</span>
        <span>─</span>
        <span class="flex-1 ascii-line"></span>
        <!-- 新增：未读日志提示按钮 -->
        <span id="logUnreadBtn" class="log-unread-btn" style="display:none;">
            ↓ <span id="logUnreadCount">0</span> 条新日志
        </span>
        <span>┐</span>
    </div>
    <div class="flex-1 overflow-y-auto pl-2 border-l border-fg-dim/20 min-h-0">
        <div id="logContent" class="text-fg-mid leading-[1.8]"></div>
    </div>
</div>
```

### 3.7 CSS 改动

```css
/* ═══ 日志未读提示按钮 ═══ */

.log-unread-btn {
    color: #fff;
    font-size: 10px;
    cursor: pointer;
    padding: 2px 6px;
    border: 1px solid #888;
    background: #0a0a0a;
    pointer-events: auto;
    transition: background 0.15s;
    white-space: nowrap;
}

.log-unread-btn:hover {
    background: #222;
}
```

**设计说明**：
- 按钮放在 CHRONICLE 标题栏右侧（`┐` 之前），不占用日志区空间
- 白色文字 + 灰色边框，与终端风格一致
- `pointer-events: auto`：标题栏可能有点击穿透问题，显式开启
- `white-space: nowrap`：防止文字换行

### 3.8 边界情况

| 场景 | 处理 |
|------|------|
| 玩家在底部，操作触发刷新 | 自动滚动到底部，不显示提示 |
| 玩家翻看历史，操作触发刷新 | 不滚动，显示"↓ N 条新日志"，点击后滚动 |
| 玩家翻看历史，连续操作多次 | 未读计数累加，提示按钮显示总数 |
| 玩家手动滚动到底部 | 自动清零未读计数，隐藏提示 |
| 首次加载 | `isAtBottom=true`，自动滚动到底部，不显示提示 |
| 无新日志（`newEntries` 为空） | 不累加未读，不显示提示 |

---

## 4. 功能三：Toast 同类合并

### 4.1 问题

"全部拾取"等批量操作会触发多条同 ID 日志（如 6 条 `pickup.bag_full`），每条都触发 Toast，导致 Toast 堆叠刷屏。

### 4.2 实现思路

`showToast` 时检查容器内最后一个 Toast 是否"同类"（相同日志 ID + 相同 style）。如果同类，合并显示 `×N`，重置消失计时器。不同类则正常创建新 Toast。

### 4.3 showToast 签名扩展

```javascript
// 改动前
export function showToast(message, type, duration, isHtml)

// 改动后
export function showToast(message, type, duration, isHtml, mergeId)
```

- `mergeId`：可选，传入日志 ID 时启用合并逻辑。不传或为 `null` 时不合并（保持对 `ui:toast` 等现有调用方的兼容）。

### 4.4 tile-action.js 改动

```javascript
export function showToast(message, type, duration, isHtml, mergeId) {
    type = type || 'info';
    duration = duration || 2000;
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const tag = type === 'error' ? '[ERR]' : (type === 'success' ? '[OK]' : '[i]');

    // ── 同类合并 ──
    if (mergeId) {
        const last = container.lastElementChild;
        if (last && last.dataset.mergeId === mergeId && last.dataset.toastType === type) {
            // 合并：更新计数
            const count = parseInt(last.dataset.mergeCount || '1') + 1;
            last.dataset.mergeCount = count;

            // 更新计数显示
            let countEl = last.querySelector('.toast-count');
            if (!countEl) {
                countEl = document.createElement('span');
                countEl.className = 'toast-count';
                last.appendChild(countEl);
            }
            countEl.textContent = ' ×' + count;

            // 重置消失计时器
            const timerId = parseInt(last.dataset.timerId);
            if (timerId) clearTimeout(timerId);
            const newTimerId = setTimeout(function() {
                last.classList.remove('show');
                setTimeout(function() { last.remove(); }, 300);
            }, duration);
            last.dataset.timerId = newTimerId;
            return;
        }
    }

    // ── 正常创建新 Toast ──
    const toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    if (mergeId) {
        toast.dataset.mergeId = mergeId;
        toast.dataset.mergeCount = '1';
        toast.dataset.toastType = type;
    }
    const safeMessage = isHtml ? message : escapeHtml(message);
    toast.innerHTML = '<span class="toast-tag">' + tag + '</span>' + safeMessage;
    container.appendChild(toast);

    requestAnimationFrame(function() { toast.classList.add('show'); });

    const timerId = setTimeout(function() {
        toast.classList.remove('show');
        setTimeout(function() { toast.remove(); }, 300);
    }, duration);
    toast.dataset.timerId = timerId;
}
```

### 4.5 log.js 调用改动

```javascript
// 改动前
if (content) showToast(content, rule.style, 2000, true);

// 改动后
if (content) showToast(content, rule.style, 2000, true, entry.id);
```

### 4.6 CSS 改动

```css
/* Toast 合并计数 */
.toast .toast-count {
    color: #fff;
    font-weight: 700;
    margin-left: 4px;
}
```

### 4.7 合并判定规则

| 条件 | 是否合并 |
|------|---------|
| 相同 `mergeId`（日志 ID） + 相同 `type`（style） | 合并 |
| 不同 `mergeId` | 不合并 |
| 相同 `mergeId` 但不同 `type` | 不合并（理论上不会发生，同一 ID 的 style 固定） |
| `mergeId` 为 `null`/`undefined`（如 `ui:toast` 调用） | 不合并 |
| 容器内无 Toast（最后一个已消失） | 不合并（创建新 Toast） |

### 4.8 边界情况

| 场景 | 处理 |
|------|------|
| "全部拾取"触发 6 条 `pickup.bag_full` | 第 1 条创建 Toast，后续 5 条合并，显示 `×6` |
| 先 `pickup.success`，再 `pickup.bag_full` | 不合并（不同 ID），显示 2 个 Toast |
| `pickup.success` × 3（连续拾取成功） | 合并显示 `×3` |
| `ui:toast` 事件触发（无 `mergeId`） | 不合并，正常创建 |
| 合并后计时器到期，Toast 消失，又来一条同 ID | 创建新 Toast（容器内无同类） |

---

## 5. 文件改动清单

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| [vex/js/log.js](../js/log.js) | 修改 | 功能一：`prevLastTs` 分界线 + `log-new` 类；功能二：`unreadCount` + `isAtBottom` + 滚动逻辑变更 + `initLog()` 导出 |
| [vex/js/tile-action.js](../js/tile-action.js) | 修改 | 功能三：`showToast` 签名扩展 `mergeId` + 合并逻辑 |
| [vex/index.html](../index.html) | 修改 | 功能二：CHRONICLE 标题栏添加 `#logUnreadBtn` |
| [vex/css/terminal.css](../css/terminal.css) | 修改 | 功能一：`@keyframes log-new-flash` + `.log-new`；功能二：`.log-unread-btn`；功能三：`.toast-count` |
| [vex/js/app.js](../js/app.js) | 修改 | 功能二：`loadAll()` 中调用 `initLog()` |

---

## 6. 实施顺序

1. **CSS**：[terminal.css](../css/terminal.css) 添加 `@keyframes log-new-flash` + `.log-new` + `.log-unread-btn` + `.toast-count`
2. **index.html**：CHRONICLE 标题栏添加 `#logUnreadBtn`
3. **log.js**：功能一（`prevLastTs` + `log-new`）+ 功能二（`unreadCount` + `isAtBottom` + 滚动逻辑 + `initLog()`）
4. **app.js**：`loadAll()` 中调用 `initLog()`
5. **tile-action.js**：功能三（`showToast` 签名扩展 + 合并逻辑）
6. **log.js**：Toast 调用传入 `entry.id` 作为 `mergeId`
7. **集成测试**：按第 7 节测试要点验证

---

## 7. 测试要点

### 7.1 新日志高亮闪烁

- [ ] 操作后新增日志高亮闪烁 1.5s 后恢复正常
- [ ] 首次加载页面不触发高亮（`prevLastTs=0` 保护）
- [ ] 无新日志时不触发高亮
- [ ] 连续操作多次，每次的增量日志各自高亮
- [ ] 高亮动画不干扰日志区滚动

### 7.2 新日志提示按钮

- [ ] 玩家在底部时操作 → 自动滚动到底部，不显示提示
- [ ] 玩家翻看历史时操作 → 不滚动，显示"↓ N 条新日志"
- [ ] 连续操作多次 → 未读计数累加
- [ ] 点击提示按钮 → 滚动到底部，提示消失
- [ ] 玩家手动滚动到底部 → 提示自动消失
- [ ] 首次加载 → 不显示提示

### 7.3 Toast 同类合并

- [ ] "全部拾取"触发 6 条 `pickup.bag_full` → 显示 1 个 Toast `×6`
- [ ] 连续拾取成功 3 次 → 显示 1 个 Toast `×3`
- [ ] 不同 ID 的 Toast 不合并（如 `pickup.success` 后 `pickup.bag_full`）
- [ ] `ui:toast` 事件触发的 Toast 不合并（无 `mergeId`）
- [ ] 合并后计时器重置，2s 后消失
- [ ] Toast 消失后再来同 ID → 创建新 Toast

### 7.4 回归测试

- [ ] 日志区渲染正常（`log-entry` 外层 span 不影响样式）
- [ ] 日志区滚动正常（滚动事件监听不干扰）
- [ ] Toast 位置动态切换正常（合并逻辑不影响 `updateToastPosition`）
- [ ] 模态框/抽屉开关正常
- [ ] `ui:toast` 事件触发的 Toast 正常显示（无 `mergeId` 时不合并）

---

## 8. 已确认问题

### Q1：`forceScroll` 行为规则（已确认）

遵循"默认操作强制滚动，特殊场景尊重玩家位置"的原则：
- `forceScroll=true`（默认，玩家主动操作）：始终强制滚动到底部 + 清零未读
- `forceScroll=false`（特殊场景，如自动刷新）：尊重玩家位置，在底部则滚动，不在底部则累加未读 + 显示提示按钮

### Q2：`log-entry` 外层 span（已确认）

功能一在每条日志外包裹 `<span class="log-entry">`。`log-entry` 是 inline span，不影响布局。颜色继承由 `terminal.css` 的 `.log-content .yellow` 等后代选择器控制，外层 span 不影响匹配。

### Q3：是否调整 `map:loaded` 调用为 `forceScroll=false`（待确认）

见 3.9 节。建议将 `map:loaded` 的 `refreshLog()` 调用改为 `refreshLog(false)`，避免与 `game:action-completed` 重复强制滚动，同时让功能二的提示按钮在 `map:loaded` 场景下生效。此为可选优化，待用户确认。

---

**设计案完成。** 请审阅以上内容，确认 Q3 后即可进入实施阶段。
