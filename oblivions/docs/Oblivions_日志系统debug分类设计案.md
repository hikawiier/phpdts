# Oblivions 日志系统 debug 分类设计案

> 为结构化日志系统引入 debug 分类机制，区分"玩家需可见"与"仅调试用"的日志。
>
> 同时将 LogEntry 的 `action` 字段改名为 `logcategory`，消除与玩家数据库字段 `$pdata['action']`（战斗状态 null/prebattle/battle）的语义冲突。
>
> **依赖**：结构化日志系统（`OblivionsLogger` / `obl_log_persist` / `obl_log_load`）已实装。
>
> **设计原则**：
> - debug 与否是事件类型的属性，不是实例属性 → 后端用 ID 清单集中标记
> - 持久化保留 debug 日志，但与正式日志分开计数，避免高频 debug 日志挤占正式日志配额
> - 前端通过 `?debug=ai` 开关控制 debug 日志的渲染

---

## 一、设计目标

### 1.1 核心目标

1. **日志分类**：后端按 ID 清单标记 debug 日志，正式日志不受影响
2. **字段改名**：`LogEntry.action` → `LogEntry.logcategory`，消除与 `$pdata['action']` 的语义冲突
3. **持久化分计数**：正式日志和 debug 日志各自独立裁剪，互不挤占
4. **前端开关**：`?debug=ai` 启用时显示 debug 日志，默认隐藏
5. **视觉区分**：debug 日志渲染时加 `[DBG]` 前缀 + 暗化样式

### 1.2 非目标

- **日志分级系统**（info/warn/error）：MVP 只做 binary（debug/正式），未来如需分级可把 `debug: bool` 迁移为 `level: string`
- **服务端过滤**：API 始终返回全部条目（含 debug 标记），过滤由前端完成
- **动态重分类**：ID 清单为硬编码常量，不支持运行时修改

---

## 二、debug 分类清单

### 2.1 分类判断

| 日志 ID | 当前用途 | 分类 | 理由 |
|---------|---------|------|------|
| `move.*` | 玩家移动反馈 | 正式 | 玩家操作结果 |
| `explore.*` | 探索反馈 | 正式 | 玩家操作结果 |
| `search.*` | 搜索 POI 反馈 | 正式 | 玩家操作结果 |
| `pickup.*` | 拾取道具反馈 | 正式 | 玩家操作结果 |
| `discard.*` | 丢弃道具反馈 | 正式 | 玩家操作结果 |
| `system.mechanic_*` | POI 机制触发 | 正式 | 玩家需知道属性变化 |
| `system.pickup_concurrent_loss` | 拾取竞态失败 | 正式 | 玩家需知道道具被抢 |
| `enemy.discovered` | 发现敌人踪迹 | 正式 | 玩家需知道 |
| `battle.skirmish` | 碰撞交火 | 正式 | 玩家需知道 |
| `enemy.move` | 敌人移动位置 | **debug** | 太吵，地图渲染已体现位置 |
| `battle.invalid` | 防呆清除脏状态 | **debug** | 系统内部清理，玩家无感 |

### 2.2 DEBUG_IDS 清单

```php
const DEBUG_IDS = [
    'enemy.move',      // 敌人移动位置（地图渲染已体现，日志冗余）
    'battle.invalid',  // 防呆机制清除脏状态（系统内部清理）
];
```

**维护规则**：新增日志 ID 时，如果属于"玩家不需要看到"的内部事件，加入此清单。清单保持简短，debug 是例外而非常态。

---

## 三、后端设计

### 3.1 OblivionsLogger 改造

**文件**：`oblivions/include/game/log.func.php`

```php
class OblivionsLogger {

    /** debug 日志 ID 清单（这些 ID 的日志标记为 debug，前端默认不渲染） */
    const DEBUG_IDS = [
        'enemy.move',
        'battle.invalid',
    ];

    /** @var array 本请求累积的日志条目 */
    private $entries = [];

    /**
     * 追加一条日志
     *
     * @param string $id           细粒度 ID（如 'move.success'），命名规则 {logcategory}.{subevent}
     * @param string $logcategory  粗粒度日志类别（move/explore/search/pickup/discard/system/enemy/battle）
     * @param array  $params       模板参数，值限 string/number/boolean
     * @param string|null $html    fallback HTML，正常为 null
     */
    public function emit($id, $logcategory, $params = [], $html = null) {
        $this->entries[] = [
            'id'           => $id,
            'logcategory'  => $logcategory,
            'params'       => $params ?: [],
            'html'         => $html,
            'debug'        => in_array($id, self::DEBUG_IDS),
            'ts'           => time(),
        ];
    }

    public function getEntries() {
        return $this->entries;
    }

    public function hasEntries() {
        return !empty($this->entries);
    }
}
```

**关键变更**：
1. 新增 `DEBUG_IDS` 常量：ID 清单，单一真相源
2. `emit()` 第二参 `$action` → `$logcategory`
3. LogEntry 新增 `debug: bool` 字段，由 `in_array($id, self::DEBUG_IDS)` 自动判定
4. LogEntry 字段 `action` → `logcategory`

### 3.2 配置扩展

**文件**：`oblivions/gamedata/obl_config.php`

```php
return [
    // ... 现有配置 ...
    'log_max_entries'       => 200,  // 正式日志最大条目数
    'log_max_debug_entries' => 50,   // debug 日志最大条目数（新增）
];
```

### 3.3 持久化分计数

**文件**：`oblivions/include/game/log.func.php`

新增 `obl_log_get_max_debug_entries()` 配置读取函数（带静态缓存，模式同 `obl_log_get_max_entries()`）。

`obl_log_persist()` 改造为分计数裁剪：

```php
function obl_log_persist($logger, $groomid, $pid) {
    if (!$logger || !$logger->hasEntries()) return;

    $new_entries = $logger->getEntries();
    $log_file = GAME_ROOT . './vex/cache/obl_log_' . (int)$groomid . '_' . (int)$pid . '.json';

    // 读取已有日志（已按时间正序：旧→新）
    $existing = [];
    if (file_exists($log_file)) {
        $raw = file_get_contents($log_file);
        $existing = json_decode($raw, true);
        if (!is_array($existing)) $existing = [];
    }

    // 合并（保持时间顺序：existing 旧 → new 新）
    $all = array_merge($existing, $new_entries);

    // 从末尾（最新）开始计数，标记保留的条目
    // 正式日志和 debug 日志各自独立计数，互不挤占
    $max_official = obl_log_get_max_entries();
    $max_debug    = obl_log_get_max_debug_entries();
    $official_count = 0;
    $debug_count    = 0;
    $keep = array_fill(0, count($all), false);

    for ($i = count($all) - 1; $i >= 0; $i--) {
        if (!empty($all[$i]['debug'])) {
            if ($debug_count < $max_debug) {
                $keep[$i] = true;
                $debug_count++;
            }
        } else {
            if ($official_count < $max_official) {
                $keep[$i] = true;
                $official_count++;
            }
        }
    }

    // 按原顺序输出保留的条目（时间正序：旧→新，无需重排序）
    $result = [];
    for ($i = 0; $i < count($all); $i++) {
        if ($keep[$i]) {
            $result[] = $all[$i];
        }
    }

    file_put_contents($log_file, json_encode($result, JSON_UNESCAPED_UNICODE), LOCK_EX);
}
```

**设计要点**：
- **从末尾倒序计数**：保证保留的是最新的 N 条
- **正序输出**：保持时间正序（旧→新），无需 `usort`，避免同秒条目顺序被打乱
- **分计数互不挤占**：50 条 debug 上限不影响 200 条正式上限

### 3.4 emit 调用点改名

所有 `$obl_log->emit($id, $action, ...)` 的第二参名 `$action` → `$logcategory`。**这是纯参数名变更，不影响实参值**（实参本来就是 `'move'`/`'enemy'` 等字符串）。

涉及文件与调用点数：

| 文件 | 调用点数 | 涉及的 logcategory |
|------|---------|-------------------|
| `oblivions/include/game/move.func.php` | 13 | `move` |
| `oblivions/include/game/explore.func.php` | 19 | `explore`/`search`/`pickup`/`discard`/`system` |
| `oblivions/include/game/enemy_ai.func.php` | 3 | `enemy`/`battle` |
| `oblivions/include/game/player.func.php` | 1 | `battle` |

**注意**：由于 PHP 是动态语言，参数名不影响调用方传参。这一步实际只需改 `OblivionsLogger::emit()` 的签名，调用点的字符串实参（`'move'`、`'enemy'` 等）无需修改。但为了代码可读性和 IDE 提示准确，建议同步更新调用点的注释（如有）。

---

## 四、API 变更

### 4.1 obl_log 响应格式

**文件**：`api_v2.php` 的 `handle_obl_log()`

无需改动函数逻辑——`obl_log_load()` 返回的数组直接作为 `entries` 输出，字段改名会自动透传。

**响应结构变更**：

```json
{
  "status": "success",
  "data": {
    "entries": [
      {
        "id": "move.success",
        "logcategory": "move",
        "params": { "from_name": "废墟入口", "to_name": "废旧轮胎山" },
        "html": null,
        "debug": false,
        "ts": 1718800000
      },
      {
        "id": "enemy.move",
        "logcategory": "enemy",
        "params": { "enemy_name": "废铁史莱姆", "enemy_pid": 5, "to_pls": 7 },
        "html": null,
        "debug": true,
        "ts": 1718800001
      }
    ],
    "total": 42
  }
}
```

**字段变更**：
- `action` → `logcategory`（改名）
- 新增 `debug: bool`（debug 标记）

**API 行为**：始终返回全部条目（含 debug），前端按开关过滤。

---

## 五、前端设计

### 5.1 debug 开关

**决策**：`?debug=ai` 直接包含 debug 日志显示（不新增独立开关）。

**理由**：`?debug=ai` 是开发者调试模式，启用时理应看到所有信息。独立开关会增加认知成本，且 debug 日志查看是低频操作。

**检测方式**：`log.js` 内直接读取 URL 参数，无需跨模块状态：

```javascript
const isDebugLogMode = new URLSearchParams(window.location.search).get('debug') === 'ai';
```

### 5.2 log.js 改造

**文件**：`vex/js/log.js`

**5.2.1 常量改名**：

```javascript
// 动作标记 → 前端显示标签（改名：ACTION_TAGS → LOGCATEGORY_TAGS）
const LOGCATEGORY_TAGS = {
    move:    'MOV',
    explore: 'EXP',
    search:  'SRC',
    pickup:  'PKG',
    discard: 'DSC',
    enemy:   'EMY',
    battle:  'BTL',
    system:  'SYS',
};
```

**5.2.2 渲染逻辑改造**（`refreshLog()` 内）：

```javascript
const htmlParts = entries.map((entry, idx) => {
    // debug 日志过滤：非 debug 模式下跳过
    if (entry.debug && !isDebugLogMode) return '';

    const tag = LOGCATEGORY_TAGS[entry.logcategory] || 'SYS';
    const content = renderLogEntry(entry);
    if (!content) return '';

    const isNew = idx === lastIdx;
    const newClass = isNew ? ' log-new' : '';
    const debugClass = entry.debug ? ' log-debug' : '';
    const debugPrefix = entry.debug ? '<span class="log-tag-dbg">[DBG]</span>' : '';

    return `<span class="log-entry${newClass}${debugClass}">${debugPrefix}<span class="log-tag">[${tag}]</span>${content}</span>`;
}).filter(p => p);
```

**5.2.3 增量检测与 Toast 的 debug 处理**：

```javascript
// Toast 触发：debug 日志不触发 Toast（即使 debug 模式开启）
const newEntries = entries.filter(e => e.ts > prevLastTs && !e.debug);
```

**理由**：Toast 是即时反馈，debug 日志是回溯用的，不应弹 Toast 打扰。

**5.2.4 未读计数排除 debug**：

```javascript
// 未读计数：只统计正式日志
const officialNewCount = newEntries.filter(e => !e.debug).length;
if (!isAtBottom && officialNewCount > 0) {
    unreadCount += officialNewCount;
    updateUnreadButton();
}
```

### 5.3 CSS 样式

**文件**：`vex/css/terminal.css`

新增 debug 日志样式：

```css
/* debug 日志：暗化 + [DBG] 标签 */
.log-entry.log-debug {
    opacity: 0.5;
}
.log-tag-dbg {
    color: #666;
    margin-right: 2px;
}
```

**效果**：debug 日志整体半透明，`[DBG]` 前缀灰色，与正式日志视觉区分。

### 5.4 log-templates.js

**文件**：`vex/data/log-templates.js`

**无需改动**。`renderLogEntry(entry)` 只读取 `entry.id` 和 `entry.params`，不引用 `entry.action`/`entry.logcategory`。字段改名对模板渲染无影响。

---

## 六、字段改名：action → logcategory

### 6.1 改名理由

当前两个 `action` 语义完全无关，共存于同一代码库：

| 位置 | 含义 | 取值 |
|------|------|------|
| `LogEntry.action` | 日志分类标签 | `move`/`explore`/`search`/... |
| `$pdata['action']` | 玩家战斗状态（DB 字段） | `null`/`prebattle`/`battle` |

战斗系统实装后，`$pdata['action']` 成为高频引用字段（状态机判断、前端战斗模式切换、突袭检测）。两个 `action` 共存会导致认知负担，AI agent 和开发者容易混淆。

### 6.2 改名范围

| 层 | 变更 |
|----|------|
| 后端 Logger | `emit($id, $action, ...)` → `emit($id, $logcategory, ...)` |
| LogEntry 结构 | 字段名 `action` → `logcategory` |
| 持久化 JSON | 字段名 `action` → `logcategory` |
| API 响应 | 字段名 `action` → `logcategory` |
| 前端 log.js | `ACTION_TAGS` → `LOGCATEGORY_TAGS`；`entry.action` → `entry.logcategory` |
| 文档 | 两份 CODEBASE.md 的 LogEntry 结构说明 |

### 6.3 迁移

现有 `vex/cache/obl_log_*.json` 文件使用旧字段名 `action`。由于日志是瞬态数据（200 上限、游戏重置时 `obl_log_clear_all()` 清空），**直接清空所有日志文件，不写兼容层**。

迁移操作：部署后执行一次 `obl_log_clear_all()`（或在下次 `rs_game()` 游戏重置时自动清理）。

---

## 七、文件改动清单

### 7.1 后端

| 文件 | 改动 |
|------|------|
| `oblivions/include/game/log.func.php` | `OblivionsLogger` 新增 `DEBUG_IDS` 常量 + `debug` 字段；`emit()` 参数改名；新增 `obl_log_get_max_debug_entries()`；`obl_log_persist()` 分计数改造 |
| `oblivions/gamedata/obl_config.php` | 新增 `log_max_debug_entries => 50` |
| `oblivions/include/game/move.func.php` | 13 处 emit 调用（实参不变，仅注释/可读性） |
| `oblivions/include/game/explore.func.php` | 19 处 emit 调用（实参不变，仅注释/可读性） |
| `oblivions/include/game/enemy_ai.func.php` | 3 处 emit 调用（实参不变，仅注释/可读性） |
| `oblivions/include/game/player.func.php` | 1 处 emit 调用（实参不变，仅注释/可读性） |

### 7.2 前端

| 文件 | 改动 |
|------|------|
| `vex/js/log.js` | `ACTION_TAGS` → `LOGCATEGORY_TAGS`；`entry.action` → `entry.logcategory`；新增 `isDebugLogMode` 检测；debug 过滤 + `[DBG]` 前缀 + `log-debug` 类；Toast/未读计数排除 debug |
| `vex/css/terminal.css` | 新增 `.log-entry.log-debug` + `.log-tag-dbg` 样式 |
| `vex/data/log-templates.js` | 无改动（不引用 `entry.action`） |

### 7.3 文档

| 文件 | 改动 |
|------|------|
| `oblivions/CODEBASE.md` | LogEntry 结构（`action`→`logcategory` + 新增 `debug`）；12.x 章节更新 |
| `vex/CODEBASE.md` | LogEntry 结构；8.2 节 `ACTION_TAGS` → `LOGCATEGORY_TAGS` |

---

## 八、测试要点

### 8.1 后端

- [ ] `OblivionsLogger::emit()` 传入 `enemy.move` 时，条目 `debug=true`
- [ ] `OblivionsLogger::emit()` 传入 `move.success` 时，条目 `debug=false`
- [ ] `obl_log_persist()` 正式日志超过 200 条时，保留最新 200 条
- [ ] `obl_log_persist()` debug 日志超过 50 条时，保留最新 50 条
- [ ] `obl_log_persist()` 正式日志 200 条 + debug 日志 50 条时，两者都完整保留（互不挤占）
- [ ] `obl_log_persist()` 输出数组按时间正序（旧→新）
- [ ] `obl_log_load()` 返回的条目含 `logcategory` 和 `debug` 字段

### 8.2 API

- [ ] `obl_log` 响应的 `entries[].logcategory` 字段正确
- [ ] `obl_log` 响应的 `entries[].debug` 字段正确
- [ ] `obl_log` 响应包含 debug 日志（不过滤）

### 8.3 前端

- [ ] 默认模式（无 `?debug=ai`）：debug 日志不渲染
- [ ] `?debug=ai` 模式：debug 日志渲染，带 `[DBG]` 前缀 + 半透明样式
- [ ] `LOGCATEGORY_TAGS` 映射正确（move/explore/search/pickup/discard/enemy/battle/system）
- [ ] debug 日志不触发 Toast
- [ ] debug 日志不计入未读计数
- [ ] 正式日志的渲染、高亮、滚动行为不受影响

### 8.4 迁移

- [ ] 部署后旧格式日志文件被清理（`obl_log_clear_all()`）
- [ ] 清理后首次请求正常工作（无字段缺失错误）
