# vex-vue 错误日志检测与展示设计方案

## 一、关键发现

| 维度 | 现状 |
|------|------|
| 日志拉取 | **事件驱动**（`game:action-completed` / `map:loaded`），非轮询 |
| Toast 系统 | 完善，`toastStore.showToast(msg, type, duration, isHtml, mergeId)` |
| 模态框 | 通用模态框只有关闭按钮，无确认/取消回调，不适合错误展示 |
| 轮询机制 | 仅 battle.ts 有 NPC 回合轮询（2s），无统一调度器 |
| store 模式 | 全部 Setup API，统一的 `registerListeners()` + App.vue 注册 |

## 二、设计决策

### 2.1 拉取策略：事件驱动 + 独立轮询

**事件驱动**（即时检测）：
- 监听 `game:action-completed`，POST 命令后立即拉取错误日志
- 确保玩家操作后能立即感知后端错误

**独立轮询**（兜底检测）：
- 5 秒周期轮询，检测非命令路径产生的错误（如 tick 结算异常）
- 可开关：默认开启，URL 参数 `?poll_error=0` 关闭

**双重保障**：事件驱动保证即时性，轮询保证不遗漏。

### 2.2 展示方式：Toast

- 全部用 Toast（`error` 类型，4000ms 持续时间）
- 模态框留给未来扩展（当前 Modal.vue 无回调机制，不适合）
- 错误 Toast 使用 `mergeId` 避免刷屏

### 2.3 增量检测

与 obl_log 相同策略：`lastTs` 记录已展示的最大 ts，只展示 `ts > lastTs` 的新条目。

## 三、文件改动清单

| 文件 | 改动 |
|------|------|
| `src/types/api.ts` | 新增 `ErrorLogEntry` + `OblErrorLogResponse` 接口 |
| `src/api/endpoints.ts` | `API_ACTIONS` 新增 `'obl_error'` |
| `src/stores/error-log.ts` | **新建**：错误日志 store（拉取/增量/轮询/Toast） |
| `src/App.vue` | 注册 errorLogStore，启动轮询 |

## 四、核心设计

### 4.1 类型定义（api.ts）

```ts
export interface ErrorLogEntry {
  id: string;                              // 错误 ID，如 'tick.dispatch.error'
  params: Record<string, string | number | boolean>;
  ts: number;                              // Unix 时间戳
  request: string;                         // 请求来源（'command'/'api'/'unknown'）
}

export interface OblErrorLogResponse {
  entries: ErrorLogEntry[];
  total: number;
}
```

### 4.2 API endpoints（endpoints.ts）

```ts
// 在 API_ACTIONS 数组中新增
'obl_error',
```

### 4.3 error-log.ts store

```ts
export const useErrorLogStore = defineStore('error-log', () => {
  // 状态
  const lastTs = ref<number>(0);
  const polling = ref<boolean>(false);
  let pollingTimer: number | null = null;
  let _listenersRegistered = false;

  // 配置
  const POLLING_INTERVAL = 5000;  // 5秒

  // 错误渲染器（ID → HTML 渲染函数）
  const ERROR_RENDERERS: Record<string, (params: Record<string, string | number | boolean>) => string> = {
    'tick.dispatch.error': (p) =>
      `<span class="red">系统异常</span><br>游戏刻处理出错：${p.error}<br>位置：${p.file}:${p.line}`,
  };

  // 渲染错误条目
  function renderErrorEntry(entry: ErrorLogEntry): string {
    const renderer = ERROR_RENDERERS[entry.id];
    if (renderer) return renderer(entry.params);
    // 默认渲染
    const paramsStr = Object.entries(entry.params)
      .map(([k, v]) => `${k}: ${v}`).join(', ');
    return `<span class="red">[错误] ${entry.id}</span>${paramsStr ? '<br>' + paramsStr : ''}`;
  }

  // 拉取错误日志 + 增量检测 + Toast
  async function refreshErrorLog(): Promise<void> {
    const result = await dataManager.fetch('obl_error', true);
    if (result.status !== 'success' || !result.data) return;

    const data = result.data as OblErrorLogResponse;
    const allEntries = data.entries;
    if (allEntries.length === 0) return;

    // 增量检测
    const prevLastTs = lastTs.value;
    const newEntries = allEntries.filter(e => e.ts > prevLastTs);
    if (newEntries.length === 0) return;

    // 更新 lastTs
    lastTs.value = allEntries[allEntries.length - 1].ts;

    // 触发 Toast
    const toastStore = useToastStore();
    for (const entry of newEntries) {
      const content = renderErrorEntry(entry);
      toastStore.showToast(content, 'error', 4000, true, entry.id);
    }
  }

  // 启动轮询
  function startPolling(): void {
    if (polling.value) return;
    polling.value = true;
    pollingTimer = window.setInterval(refreshErrorLog, POLLING_INTERVAL);
  }

  // 停止轮询
  function stopPolling(): void {
    if (!polling.value) return;
    polling.value = false;
    if (pollingTimer !== null) {
      clearInterval(pollingTimer);
      pollingTimer = null;
    }
  }

  // 事件监听注册
  function registerListeners(): void {
    if (_listenersRegistered) return;
    _listenersRegistered = true;
    // POST 命令完成后立即检测错误
    dataManager.listen('game:action-completed', () => {
      refreshErrorLog();
    });
  }

  return {
    lastTs, polling,
    refreshErrorLog, startPolling, stopPolling, registerListeners,
  };
});
```

### 4.4 App.vue 集成

```ts
// onMounted 中
const errorLogStore = useErrorLogStore();
errorLogStore.registerListeners();

// 轮询开关：URL 参数 ?poll_error=0 关闭
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('poll_error') !== '0') {
  errorLogStore.startPolling();
}

// onUnmounted 中
errorLogStore.stopPolling();
```

## 五、错误展示效果

### 5.1 Toast 样式

```
┌─────────────────────────────────┐
│ [ERR] 系统异常                  │
│ 游戏刻处理出错：Undefined index │
│ 位置：tick.func.php:298         │
└─────────────────────────────────┘
```

- 类型：`error`（红色样式）
- 持续时间：4000ms（比普通 Toast 长，确保用户看到）
- mergeId：`entry.id`（同类错误合并，避免刷屏）

### 5.2 错误渲染器扩展

未来新增错误类型时，只需在 `ERROR_RENDERERS` 中添加映射：

```ts
'command.rejected': (p) => `操作被拒绝：${p.reason}`,
'battle.fatal': (p) => `战斗系统异常：${p.error}`,
```

## 六、待确认

1. **轮询周期**：5 秒是否合理？还是更长（如 10 秒）？ 确认：合理
2. **轮询开关**：默认开启 + URL 参数关闭，还是默认关闭 + URL 参数开启？ 确认：默认关闭 + URL 参数开启
3. **Toast 持续时间**：4000ms 是否合理？还是更长（如 6000ms）？ 确认：合理
4. **事件驱动补充**：是否在 `game:action-completed` 后也拉取错误日志（推荐）？ 确认：也拉取