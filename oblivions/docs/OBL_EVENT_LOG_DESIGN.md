# Oblivions Event Log 职责重置设计案

> 状态：阶段一至阶段四已执行；阶段五（Event API / Outbox）暂不建议执行。  
> 背景：Oblivions 已完成 JSON Command API、State API、Heartbeat/Tick Orchestrator 独立化。旧阶段中 `obl_log` / `obl_error_log` 曾承担部分前后端通信职责；现在前后端已有明确 command/state/heartbeat 边界，需要重新收束日志系统职责。  
> 目标：保留日志价值，但把“即时命令反馈 / 业务拒绝 / 前后端通信”从日志系统中剥离，建立清晰的事件、诊断、导演三类流。

---

## 1. 当前结论

不建议删除日志系统。

建议做的是 **职责重置**：

```txt
Command API      = 即时命令结果 / 业务拒绝 / refresh hints
State API        = 当前状态读取
Heartbeat API    = tick 推进
obl_log          = 玩家可见历史事件流
obl_error_log    = 开发/诊断日志
battle_log       = 战斗导演事件流，暂不纳入本轮重构
```

当前最需要修正的是：

```txt
不要再把 obl_log 当作 command response 的替代品
不要再把 obl_error_log 当作普通 UI 错误提示通道
不要让前端必须通过刷新日志才能判断命令成功/失败
```

---

## 2. 现状盘点

### 2.1 后端日志文件

当前核心文件：

```txt
D:\wamp64\www\phpdts\oblivions\include\game\log.func.php
```

当前三类持久化文件：

```txt
oblivions/cache/logs/obl_log_{groomid}_{pid}.json
oblivions/cache/logs/obl_error_{groomid}_{pid}.json
oblivions/cache/battles/obl_battle_log_{groomid}_{pid}.json
```

读取入口：

```txt
GET /phpdts/oblivions/api/state.php?scope=obl_log
GET /phpdts/oblivions/api/state.php?scope=obl_error
GET /phpdts/oblivions/api/state.php?scope=battle_log
```

### 2.2 obl_log 当前职责

`OblivionsLogger` 当前条目结构：

```php
[
  'id'          => 'move.success',
  'logcategory' => 'move',
  'params'      => [],
  'html'        => null,
  'debug'       => false,
  'ts'          => time(),
]
```

当前常见事件：

```txt
move.success / move.blocked / move.no_sp / move.invalid_target
explore.success / explore.no_sp
enemy.discovered / enemy.move
search.result / search.already_searched / search.not_found
item.to_bag
system.itm0_pending / system.mechanic_max_hp_up
organize.fail
```

其中一部分是玩家历史事件，一部分实际是业务拒绝或 UI 提示。

阶段一复核说明：本节为设计期“常见事件”摘要，不是全量清单；全量以 [`OBL_EVENT_LOG_REGISTRY.md`](./OBL_EVENT_LOG_REGISTRY.md) 为准。阶段一已补全 item/craft/use/diagnostic/battle phase 等事件。

### 2.3 obl_error_log 当前职责

当前常见事件：

```txt
command.exception
command.rejected
battle_state.illegal_transition
battle_state.reset
tick.dispatch.error
tick.player_fetch.error
enemy_ai.config_missing
search.data_error
skill.config_missing
initiative_calc.combatant_not_found
battle_entry.empty_actions
```

其中：

```txt
command.exception / tick.dispatch.error / battle_state.illegal_transition
```

适合作为诊断日志。

但：

```txt
command.rejected
```

更接近业务拒绝，不应该作为前端普通反馈来源。

### 2.4 前端消费点

当前前端日志 store：

```txt
D:\wamp64\www\phpdts\vex-vue\src\stores\log.ts
```

当前职责：

```txt
dataManager.fetch('obl_log', true)
按 lastTs 做增量检测
按 TOAST_RULES 白名单弹 Toast
更新 LogPanel entries
监听 game:action-completed / game:npc-settled / map:loaded 刷新日志
```

阶段三前 Toast 白名单：

```txt
pickup.bag_full
pickup.success
pickup.not_found
item.to_bag
search.result
search.already_searched
discard.success
```

阶段三后当前 Toast 白名单：

```txt
pickup.success
item.to_bag
search.result
discard.success
```

这说明 `obl_log` 曾经不只是历史日志，还承担了部分即时 UI 反馈；阶段三已移除其中的 command_feedback/遗留项。

---

## 3. 问题分析

### 3.1 日志承担 command response 职责

旧模式下，前端 POST 能力弱、响应不统一，通过刷新日志感知结果是合理的。

但现在已有：

```txt
/phpdts/oblivions/api/command.php
```

命令响应已经可以直接返回：

```json
{
  "status": "success",
  "code": "OK",
  "message": "OK",
  "data": {
    "refresh": ["player_info", "tile_actions", "obl_log"]
  }
}
```

失败也可以直接返回：

```json
{
  "status": "error",
  "code": "ITM0_PENDING",
  "data": {
    "feedback": {
      "id": "system.itm0_pending",
      "params": {},
      "source": "log"
    }
  }
}
```

因此“命令是否成功 / 为什么失败”不应再依赖日志刷新。

阶段二修正后，Command API 的普通业务失败不再让后端返回用户可见文案；后端只返回 `code` 与可选 `data.feedback.id + params`，前端通过 `vex-vue/src/data/command-feedback.ts` / `LOG_TEMPLATES` 渲染具体文本，为 i18n 留出边界。

### 3.2 error_log 混入业务拒绝

例如 `command.rejected` 本质上是业务门控结果。

它可以被记录到诊断日志，但前端正常 UI 不应该依赖它。

业务拒绝应该进入：

```txt
Command API error code / data.feedback.id / params
```

### 3.3 obl_log Toast 与 Command response Toast 可能冲突

如果未来 Command API 直接携带 toast / events，而 `log.ts` 继续根据 `obl_log` 新增条目弹 Toast，就可能出现重复提示：

```txt
command response 弹一次
obl_log refresh 又弹一次
```

因此必须明确：

```txt
即时反馈由 Command API 优先负责
obl_log Toast 只能作为历史日志补充，或逐步减少到少量被动事件
```

### 3.4 battle_log 不应混入本轮

`battle_log` 现在是导演系统数据源，承担的是动作播放脚本输入，不是普通日志。

本轮不重构 `battle_log`，避免扩大范围。

---

## 4. 新职责定义

### 4.1 Command API：即时反馈源

负责：

```txt
命令是否成功
业务拒绝 code / data.feedback.id / params
需要刷新的 state scopes
可选的一次性 toast / events
```

目标响应：

```json
{
  "status": "success",
  "code": "OK",
  "request_id": "...",
  "message": "OK",
  "data": {
    "command": "item.pickup",
    "refresh": ["player_info", "player_inventory", "tile_actions", "obl_log"],
    "feedback": []
  }
}
```

错误响应：

```json
{
  "status": "error",
  "code": "MOVE_BLOCKED",
  "request_id": "...",
  "data": {
    "command": "map.move",
    "refresh": ["player_info", "game_map", "tile_actions", "player_inventory", "obl_log", "battle_log"],
    "feedback": {
      "id": "move.blocked",
      "params": {
        "name": "",
        "floor": "metal",
        "tide": "dry",
        "passable": false
      },
      "source": "log"
    }
  },
  "details": {
    "event_id": "move.blocked",
    "params": {
      "name": "",
      "floor": "metal",
      "tide": "dry",
      "passable": false
    }
  }
}
```

原则：

```txt
所有普通业务拒绝必须能通过 command response 被前端立即理解。
后端只描述“发生了什么”，不返回玩家可见中文文案。
前端负责把 code / feedback.id / params 渲染为 Toast、HTML 或 i18n 文本。
```

### 4.2 obl_log：玩家可见历史事件流

负责：

```txt
探索过程
移动描述
发现敌人 / POI
拾取/丢弃/合成/使用结果的历史记录
世界叙事/系统事件
```

不负责：

```txt
命令是否成功的唯一判断
HTTP/并发/认证/状态冲突错误
开发诊断信息
```

### 4.3 obl_error_log：诊断日志

负责：

```txt
异常
非法状态
数据配置缺失
tick 调度失败
战斗状态机非法转换
command exception
```

不负责：

```txt
普通玩家操作失败提示
正常业务门控提示
Toast 数据源
```

### 4.4 battle_log：战斗导演事件流

保持现状。

负责：

```txt
战斗动作条目
播放段落
导演系统消费
played 标记
```

本轮不迁移，不重命名，不合并进 obl_log。

---

## 5. 事件分类规范

### 5.1 玩家可见事件（保留在 obl_log）

示例：

```txt
move.success
move.region_enter
move.region_leave
move.tile_desc
explore.success
enemy.discovered
search.result
item.to_bag
system.mechanic_max_hp_up
```

特点：

```txt
玩家可以在日志面板回看
不要求前端立即阻塞式处理
可以由前端模板渲染成文本/HTML
```

### 5.2 业务拒绝事件（迁移到 Command API）

示例：

```txt
move.no_sp
move.no_path
move.blocked
move.invalid_target
search.not_adjacent
search.not_searchable
search.not_found
system.itm0_pending
organize.fail
command.rejected
```

这些可以选择性保留一条历史日志，但即时反馈必须来自 command response。

### 5.3 诊断事件（保留/迁移到 obl_error_log）

示例：

```txt
command.exception
tick.dispatch.error
tick.player_fetch.error
battle_state.illegal_transition
battle_state.reset
enemy_ai.config_missing
search.data_error
```

特点：

```txt
不应默认弹 Toast
开发模式可显示 Debug Panel
生产模式可隐藏或只保留本地文件
```

### 5.4 导演事件（保持 battle_log）

示例：

```txt
initiative.roll
attack.hit
attack.miss
damage.apply
battle.end
```

特点：

```txt
不是普通日志
需要 played 标记
需要保序播放
由 battle director 消费
```

---

## 6. 建议实施阶段

### 阶段一：事件盘点与文档化

目标：不改行为，只建立清单。

工作：

```txt
扫描所有 $obl_log->emit / $obl_error_log->emit / battle_log emit
建立 EVENT_LOG_REGISTRY 文档或 PHP 数组
给每个事件标注：player_visible / command_feedback / diagnostic / director
标注当前前端是否 Toast
```

产出：

```txt
D:\wamp64\www\phpdts\oblivions\docs\OBL_EVENT_LOG_REGISTRY.md
```

### 阶段二：Command API 接管业务拒绝反馈

状态：已执行。

目标：常规失败不再依赖 log/error_log。

工作：

```txt
已在 Command Bus 增加单请求日志快照与反馈映射：
  dispatch 前记录 obl_log / obl_error_log 条目数
  dispatch 后只检查新增条目
  命中 command_feedback 映射时返回结构化 Command API error
  error.data.feedback = { id, params, source }
  后端不再硬编码业务反馈中文文案
  失败命令不推进 tick

已覆盖：
  map.move / map.explore / poi.search
  item.pickup / item.discard / item.use / inventory.organize
  craft.execute
  battle.start / battle.submit_turn 的 empty actions 诊断映射

前端已新增 command-feedback renderer：
  先按 response.data.feedback.id + params 复用 LOG_TEMPLATES 渲染
  再按 response.code 使用前端 code 兜底模板
  CommandResult.message 是前端渲染结果，messageIsHtml 标记是否按 HTML Toast 展示
```

注意：

```txt
可以保留对应 obl_log 历史记录，但前端不再依赖它判断结果。
```

阶段二额外修正：

```txt
move 目标格被其他单位占据时不再静默失败，新增 move.occupied 日志事件与 MOVE_OCCUPIED response。
远距离移动先确认路径与总 SP，再一次性扣除体力，避免不可达/远距离体力不足路径错误预扣首格体力。
```

### 阶段三：收束前端 log Toast

状态：已执行。

目标：LogPanel 继续存在，但 Toast 职责降级。

工作：

```txt
已移除 TOAST_RULES 中属于 command_feedback / 遗留项的条目：
  pickup.bag_full
  pickup.not_found
  search.already_searched

当前 log Toast 只保留成功/玩家事件轻提示：
  pickup.success
  item.to_bag
  search.result
  discard.success

LogPanel 仍展示完整历史日志。
```

### 阶段四：重塑 obl_error_log 为诊断流

状态：已执行。

目标：error_log 不再参与普通 UI 反馈。

工作：

```txt
error_log 持久化与 state scope 保留。
前端 error-log store 仍会拉取并推进 lastTs，但普通 UI 默认不再 Toast 诊断事件。
仅在诊断模式显示 error_log Toast：
  ?debug=ai
  ?poll_error=1

command.rejected / battle_entry.empty_actions 等不再作为普通业务反馈来源。
```

### 阶段五：可选的新 Event API / Event Outbox

当前不建议马上做。

未来如果需要更强交互，可设计：

```txt
command response.data.events
或 /oblivions/api/events.php?since=cursor
```

但在当前阶段，Command API + State API + 现有 obl_log 已够用，不宜过早引入第四类 API。

---

## 7. 迁移原则

### 7.1 不破坏玩家日志面板

`LogPanel` 仍然显示历史事件。

迁移过程中：

```txt
可以减少 Toast
不要突然让日志面板空掉
```

### 7.2 不动 battle_log

`battle_log` 与导演渲染强绑定。

除非单独设计战斗事件流，否则本轮只读不改。

### 7.3 业务拒绝优先走 response

例如：

```txt
ITM0_PENDING
BATTLE_PROCESSING
COMMAND_NOT_ALLOWED
STATE_CONFLICT
DOMAIN_REJECTED
```

必须由 Command API 直接返回。

### 7.4 诊断不等于错误提示

`obl_error_log` 可以记录：

```txt
command.rejected
```

但这不代表前端要 Toast 它。

普通用户看到的是前端根据 command response code / feedback 渲染出的文案。

### 7.5 先分类，再迁移

不要边猜边改。

第一阶段必须先生成事件清单，避免漏掉隐含前端依赖。

---

## 8. 验收标准

### 阶段一验收

```txt
所有 $obl_log->emit 事件都有分类
所有 $obl_error_log->emit 事件都有分类
battle_log 事件已标记为 out-of-scope
前端 TOAST_RULES 与事件分类存在对应说明
```

### 阶段二验收

```txt
常规业务拒绝能从 command response 直接得到 code 与 feedback.id/params
前端不需要刷新 obl_error 才能提示失败原因
探索/移动/拾取/丢弃/使用/合成/战斗提交失败均有明确错误反馈
```

### 阶段三验收

```txt
LogPanel 仍正常显示历史日志
普通命令成功/失败不会重复 Toast
被动事件仍可按需 Toast
```

### 阶段四验收

```txt
obl_error_log 不再作为普通 UI 通信渠道
诊断事件仍被持久化并可通过开发工具查看
生产/普通 UI 不被诊断日志噪声打扰
```

---

## 9. 当前执行结论

阶段一至阶段四已完成，产物：

```txt
D:\wamp64\www\phpdts\oblivions\docs\OBL_EVENT_LOG_REGISTRY.md
```

执行结论：

```txt
事件系统实际范围大于设计期摘要，已补全 item/craft/use/diagnostic/battle phase。
普通日志中存在若干 command_feedback 事件，已由 Command API response 接管即时反馈。
error_log 中存在 command.rejected / battle_entry.empty_actions 等业务反馈混入，普通 UI 已不再依赖 error_log Toast。
front-end TOAST_RULES 中 pickup.bag_full 等疑似遗留项已移除。
battle_log phase 与 BattleDirector case 存在若干未对齐项，但本轮标记为 out-of-scope。
```

阶段五 Event API / Event Outbox 暂不建议执行：

```txt
当前 Command API + State API + Heartbeat + obl_log 已能覆盖实际需要。
如未来需要跨请求可靠事件队列、cursor 增量消费、离线补偿，再另案设计 Event API / Outbox。
```
