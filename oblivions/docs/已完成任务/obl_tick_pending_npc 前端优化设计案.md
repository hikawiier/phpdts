# obl_tick_pending_npc 前端优化设计案

> 后端 API 已提供 `obl_tick_pending_npc` 标志（`api_v2.php:205`），true 表示 NPC 事件未结算完，前端应等待。本设计案规划前端如何利用该标志优化流程。

---

## 一、背景：后端标志语义

| 维度 | 说明 |
|------|------|
| 字段位置 | `player_info` API 响应，`api_v2.php:205`：`'obl_tick_pending_npc' => !empty($gamevars['obl_tick_pending_npc'])` |
| 类型 | `bool`（后端 `!empty()` 转换） |
| 设置 true | `obl_command.php:129` 玩家操作推进 tick 后立即设置（`obl_tick_set_pending_npc()`） |
| 清除 false | `tick.func.php:309-311` `obl_tick_dispatch()` 末尾，NPC 未推进 tick 时清除 |
| 互斥语义 | 玩家操作与 NPC 先攻轮互斥：玩家行动后必须等 NPC 事件结算完毕才能再次行动 |
| 推进 tick 白名单 | move / obl_explore / obl_search / obl_battle_start / obl_battle_action（`tick.func.php:191-199`） |

**生命周期**：
```
玩家操作 → obl_command.php 推进 tick → set pending_npc=true → POST 返回
    ↓
前端拉取 player_info → pending_npc=true（NPC 结算中）
    ↓
common.inc.php 下次请求触发 obl_tick_dispatch → NPC 先攻轮
    ↓
NPC 未推进 tick → clear pending_npc=false → 前端拉取到 false（可操作）
```

---

## 二、现状分析

### 前端缺口

| 缺口 | 位置 | 说明 |
|------|------|------|
| **零引用** | `vex-vue/src` 全目录 | `obl_tick_pending_npc` / `pending_npc` / `pendingNpc` 无任何匹配 |
| **类型未声明** | `types/api.ts:11-43` PlayerInfo 接口 | 仅有 `obl_tick` / `obl_pretick`，缺 `obl_tick_pending_npc` |
| **store 未暴露** | `stores/player.ts` | 无 `oblTickPendingNpc` computed |
| **隐式信号未利用** | `StatusBar.vue:80` | `tickPending = oblTick > oblPretick` 仅 debug 可见，未用于流程控制 |

### 现有问题流程

1. **命令队列短锁**：`commandQueue`（`command-queue.ts`）仅覆盖一次 HTTP 请求周期，POST 完成立即释放。玩家可立刻提交下一个推进 tick 的命令，但后端 `obl_command.php:60-71` 会以 `npc_action_pending` 拒绝 → 触发 `command.rejected` 错误 Toast（正常游戏流程不该显示为"错误"）。

2. **无 NPC 结算反馈**：NPC 结算期间玩家无任何视觉反馈，不知道为什么不能操作。

3. **NPC 回合固定轮询**：`startNpcTurnRefresh()`（`battle.ts:146-160`）固定 2 秒间隔，无论 NPC 是否结算完都按固定频率拉取，可能过早（浪费请求）或过晚（玩家空等）。

4. **数据刷新过早**：`game:action-completed` 广播后，log/enemies/inventory 等 store 同时刷新。但 NPC 事件可能还在结算，此时拉到的日志/敌人位置不完整。

---

## 三、约束（必须遵守）

### C1. 后端 API 变动时前端接口对齐

**约束**：后端对 `api_v2.php` 的响应结构变动时（新增/删除/修改字段），前端 `types/api.ts` 必须同步对齐类型声明，并在 `stores/player.ts` 等消费方暴露对应 computed/ref。

**当前缺口示例**：后端 `api_v2.php:205` 已返回 `obl_tick_pending_npc`，但前端 `PlayerInfo` 接口未声明该字段。

**落实方式**：本设计案的"前置工作"章节即是对齐该约束的具体执行。后续后端新增 API 字段时，应同步检查前端类型定义。

---

## 四、前置工作（所有方向的基础）

### 4.1 类型声明

**文件**：`vex-vue/src/types/api.ts`

`PlayerInfo` 接口补充：
```ts
obl_tick_pending_npc: boolean;
```

### 4.2 store 暴露

**文件**：`vex-vue/src/stores/player.ts`

新增 computed：
```ts
const oblTickPendingNpc = computed(() => playerInfo.value?.obl_tick_pending_npc ?? false);
```

并在 return 中暴露。

---

## 五、优化方向

### 方向 1：命令队列锁定优化（高优先级）

**目标**：玩家操作推进 tick 后，前端自动锁定 commandQueue 直到 NPC 结算完毕，避免无意义的 `command.rejected` + `npc_action_pending`。

**设计**：

`command-queue.ts` 新增 `pendingNpc` 状态：
- `execute(params)` 成功后，若该命令属于推进 tick 白名单（move/obl_explore/obl_search/obl_battle_start/obl_battle_action），读取响应或拉取 player_info 中的 `obl_tick_pending_npc`
- 为 true 时设置 `_pendingNpc = true`，启动轮询（间隔 1 秒，复用 dataManager.fetch('player_info', true)）
- 检测到 false 时清除 `_pendingNpc = false`，停止轮询
- `isLocked` getter 扩展：`return this._locked || this._pendingNpc`
- 非推进 tick 的命令（查看状态等）不受 pendingNpc 限制

**白名单同步**：前端需维护与后端 `obl_command_advances_tick()`（`tick.func.php:191-199`）一致的白名单。建议在 `command-queue.ts` 或独立常量文件中定义：
```ts
const TICK_ADVANCING_COMMANDS = ['move', 'obl_explore', 'obl_search', 'obl_battle_start', 'obl_battle_action'];
```

**边界处理**：
- 轮询超时兜底：最长等待 10 秒，超时自动解锁（防止后端异常导致永久锁定）
- 页面卸载时清理定时器
- 战斗场景的 `obl_battle_action` 推进 tick 后，battle.ts 的 `startNpcTurnRefresh` 已有轮询，需协调避免双重轮询（可让 commandQueue 的 pendingNpc 轮询在战斗模式下委托给 battle.ts）

**收益**：消除 `npc_action_pending` 的 `command.rejected` 错误 Toast，操作流畅度提升。

---

### 方向 2：UI 状态提示（高优先级，与方向 1 配套）

**目标**：`obl_tick_pending_npc = true` 时给玩家视觉反馈，知道"NPC 行动中，请等待"。

**设计**：

**2a. StatusBar 提示**（复用现有机制）：
- `StatusBar.vue` 现有 `tickPending`（`obl_tick > obl_pretick`）仅 `?debug=ai` 可见
- 改为：`oblTickPendingNpc` 为 true 时，非 debug 模式下也显示轻量提示（如"NPC 行动中…"文本 + pulse 动画）
- debug 模式下保留完整的 `T: tick/pretick` 调试信息

**2b. 操作按钮禁用**：
- 推进 tick 的操作按钮（移动/探索/搜索/战斗）在 `oblTickPendingNpc = true` 时禁用或显示 loading 状态
- 涉及组件：`TileActionBar.vue`、`ExploreButton.vue`、`useMapInteraction.ts` 等
- 现有代码已有 `commandQueue.isLocked` 前置检查（如 `tileAction.ts:117`），方向 1 落地后 `isLocked` 会包含 pendingNpc，自动生效

**2c. Toast 提示（可选）**：
- 玩家在 pending 期间点击操作按钮，显示"NPC 行动中，请稍候"Toast（warning 类型，mergeId 避免刷屏）
- 这是方向 1 的补充：锁定后玩家点击被拒，给即时反馈

**收益**：玩家可感知"为什么不能操作"，体验闭环。方向 1 让玩家不能操作，方向 2 让玩家知道为什么不能操作。

---

### 方向 3：数据刷新时序优化（中优先级）

**目标**：`game:action-completed` 后避免过早刷新 NPC 相关数据，等结算完毕再刷。

**设计**：

当前 `game:action-completed` 监听方（`tileAction.ts:353`、`battle.ts:606`、`log.ts:165`、`inventory.ts:133`、`error-log.ts:155`）同时刷新。

优化策略：
- **立即刷新**：玩家自身数据（player_info / player_inventory / tile_actions）——这些是玩家操作的直接结果
- **延迟刷新**：NPC 相关数据（obl_log 日志 / enemies 敌人列表）——等 `obl_tick_pending_npc = false` 后刷新

实现方式：
- `game:action-completed` 广播时携带 `pendingNpc` 标志（从 player store 读取）
- 或：新增 `game:npc-settled` 事件，`obl_tick_pending_npc` 从 true→false 时广播
- log/enemies store 监听 `game:npc-settled` 刷新，不再监听 `game:action-completed`（或监听但检查 pendingNpc 决定是否延迟）

**收益**：避免刷新过早拿到不完整数据（NPC 移动日志未生成、敌人位置未更新）。

---

### 方向 4：NPC 回合轮询效率（中优先级，战斗场景）

**目标**：战斗中 NPC 回合轮询根据 `obl_tick_pending_npc` 动态调整，结算完立即停止。

**设计**：

`startNpcTurnRefresh()`（`battle.ts:146-160`）当前固定 2 秒间隔。优化：
- 轮询回调中检测 `obl_tick_pending_npc`：
  - true：NPC 事件未结算完，继续轮询（可缩短间隔至 1 秒）
  - false：NPC 事件已结算，停止轮询，触发玩家回合提示
- 与方向 1 的 commandQueue pendingNpc 轮询协调：战斗模式下 commandQueue 的 pendingNpc 委托给 battle.ts 的轮询，避免双重轮询

**收益**：减少无效请求，玩家回合切换更及时。

---

### 方向 5：command.rejected 渲染器降级（低优先级，兜底）

**目标**：方向 1 落地后 `npc_action_pending` 的 `command.rejected` 几乎不触发，但作为兜底，前端渲染器将其从"错误"降级为"提示"。

**设计**：

`error-log.ts` 的 `command.rejected` 渲染器（当前已实现）：
- `npc_action_pending` reason：改为 warning 语义（但 obl_error_log 系统只有 error Toast，可考虑前端拦截该 ID 不走 error Toast，改走 warning Toast）
- `command_not_allowed_in_current_state` reason：保持 error（这是真正的非法操作）

**实现细节**：
- `refreshErrorLog()` 中，对 `command.rejected` + `npc_action_pending` 的条目，改用 `toastStore.showToast(msg, 'warning', ...)` 而非 `'error'`
- 或：前端过滤掉 `npc_action_pending` 的 command.rejected（方向 1 已阻止提交，不会触发）

**收益**：兜底防护，避免极端情况下错误 Toast 刷屏。

---

## 六、优先级与依赖

| 优先级 | 方向 | 依赖 | 说明 |
|--------|------|------|------|
| **前置** | 4.1 类型声明 + 4.2 store 暴露 | 无 | 所有方向的基础 |
| **高** | 方向 1 命令队列锁定 | 前置 | 消除错误 Toast，操作流畅 |
| **高** | 方向 2 UI 状态提示 | 方向 1 | 与方向 1 配套，体验闭环 |
| **中** | 方向 3 数据刷新时序 | 前置 | 避免刷新过早 |
| **中** | 方向 4 NPC 回合轮询 | 前置 | 战斗场景效率 |
| **低** | 方向 5 渲染器降级 | 方向 1 | 兜底优化 |

**建议执行顺序**：前置 → 方向 1 → 方向 2 → 方向 3 → 方向 4 → 方向 5

方向 1 和 2 是一对：锁定让玩家不能操作，提示让玩家知道为什么不能操作。建议一起做。

---

## 七、风险与边界

### 7.1 白名单同步
前端 `TICK_ADVANCING_COMMANDS` 必须与后端 `obl_command_advances_tick()`（`tick.func.php:191-199`）保持一致。后端白名单变动时前端需同步。

### 7.2 轮询超时兜底
方向 1 的 pendingNpc 轮询需设超时（建议 10 秒），防止后端异常导致 commandQueue 永久锁定。

### 7.3 战斗模式协调
方向 1 的 commandQueue pendingNpc 轮询与方向 4 的 battle.ts NPC 回合轮询需协调，战斗模式下委托给 battle.ts 避免双重轮询。

### 7.4 页面卸载清理
所有轮询定时器需在页面卸载（onUnmounted / beforeUnmount）时清理。

---

## 八、不做项

- 不新增独立的 `game_info` API 端点：tick 状态字段继续挂在 `player_info` 响应中（后端现状）
- 不重构 `commandQueue` 为真正的队列（堆积请求）：保持单次互斥锁语义，仅扩展 pendingNpc 锁定
- 不在本设计案中更新 AGENTS.md 等约束文档（后续单独处理）
