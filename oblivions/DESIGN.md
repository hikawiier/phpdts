# Oblivions 子系统 — 概念与设计要点

> AI 智能体介入项目前必读。本文档解释 Oblivions 子系统的关键概念、核心设计原则和跨任务沉淀的设计思路。
> 代码库参考手册：[CODEBASE.md](./CODEBASE.md) | 项目文档总入口：[AGENTS.md](../../AGENTS.md)

---

## 一、核心概念词典

以下概念在 Oblivions 中有特定含义，不可按字面意思理解。

### 1.1 区域 (Region) vs 地图格 (Tile)

- **区域**：一个独立的子地图，由多个地图格拼接而成。数据库键 `pgroup`，最多 255 个区域。
- **地图格**：最小的移动单元，数据库键 `pls`（区域内局部索引 1-254）。跨区域时 pls 可重用——区域1的 pls=5 和区域2的 pls=5 是不同的格。
- **组合键**：`(pgroup, pls)` 唯一确定一个地图格。

### 1.2 地板属性 (floor)

地图格的地板属性，**影响玩家交互**（移动消耗修正、技能效果、可破坏性），不是纯装饰：

| 值 | 含义 |
|----|------|
| `standard` | 标准地板 |
| `water` | 含水地板 |
| `vegetation` | 覆植地板 |
| `metal` | 金属地板 |
| `magic` | 富魔力地板 |

### 1.3 潮汐属性 (tide)

**不是海潮涨落，是区域危险等级分区标签。** 潮汐影响资源生成倾向（稀有度权重、敌人生成偏向、事件点类型），不影响玩家移动：

| 值 | 危险等级 | 含义 |
|----|---------|------|
| `shallow` | T-1（低） | 浅滩区，低危险 |
| `deep` | T（中） | 深水区，中危险 |
| `abyss` | T+1（高） | 深海区，高危险 |

> **注意**：`safe` **不是** `tide` 的取值。安全区状态由独立字段 `preset_safe` 标记。

### 1.4 迷雾 (fog) vs 发现 (discovered)

两个**独立**的关注点，不可混淆：

| | 迷雾 (fog) | 发现 (discovered) |
|---|---|---|
| **控制什么** | 地图格的可见性 | 道具的可操作性 |
| **数据位置** | `oblmapstates` 表 `fog` 字段 | `oblmapitem` 表 `discovered` 字段 |
| **如何点亮** | BFS 视野计算，玩家位置扩展 | 玩家进入地图格时自动发现该格所有道具 |
| **效果** | 迷雾格在前端显示为 `░░░` | 未发现的道具不出现在拾取列表中 |

### 1.5 POI vs 散落道具

都是道具来源，但机制不同：

| | POI（建筑物） | 散落道具 |
|---|---|---|
| **位置** | 地图格内的建筑物 | 直接在地图格上 |
| **获取方式** | 需搜索（`obl_search_poi`），消耗体力 | 直接拾取（`obl_pickup_item`） |
| **数据表** | `oblmappoi` | `oblmapitem` |
| **搜索次数** | 有 `search_count` 上限 | 无搜索概念 |
| **生成池** | `poi_pool.php` | `scatter_pool.php` |

### 1.6 itmpara 与 itempara

**itmpara**（地图道具实例的 JSON 附加参数，`bra_oblmapitem.itmpara`）：
- 拾取时将 `item_id`（地图道具实例ID）注入 `itmpara` 的 `obl_item_id` 键
- 丢弃时从 `itmpara` 读取 `obl_item_id`，还原为地图道具实例
- 格式：JSON 对象，如 `{"obl_item_id": "42"}`

**itempara**（玩家道具栏 JSON 大字段，`bra_oblplayers.itempara`）：
- JSON 数组，长度 = `itemmaxslots + 1`（index 0=特殊槽，1~itemmaxslots=普通槽）
- 每个元素是一个道具对象或 `null`（空槽）

**道具对象七字段规范**（itempara 数组元素 + 地图道具实例均遵循）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `itm` | string | 道具名 |
| `itmk` | string | 道具种类 |
| `itme` | int | 效果值 |
| `itms` | string | 耐久 |
| `itmsk` | string | 耐久种类 |
| `itmpara` | object | 参数（JSON 对象，含 `obl_item_id` 等） |
| `itmid` | string | 地图道具实例ID（拾取时注入，丢弃时用于还原） |

```json
[
  null,
  {"itm":"面包","itmk":"HH","itme":120,"itms":"15","itmsk":"","itmpara":[],"itmid":""},
  {"itm":"矿泉水","itmk":"HS","itme":140,"itms":"15","itmsk":"","itmpara":[],"itmid":""},
  null, null, null, null
]
```

### 1.7 游戏刻 (tick)

- 每次移动更新 1 游戏刻，存储在 `$gamevars['obl_tick']`
- 每次 tick 增长触发 `obl_resolve_tick_events($delta)`，通过监听器机制调度 NPC 敌人行动
- **玩家操作与 NPC 先攻轮互斥**：玩家行动后设置 `obl_tick_pending_npc` 标志，锁定玩家后续操作直到 NPC 事件结算完毕

### 1.8 结构化日志 (Structured Log)

Oblivions 模式的日志传递机制。后端只输出事件结构（发生了什么 + 参数），前端完全控制视觉呈现（文案、样式、随机化）。

- **数据形态**：结构化数组（id + logcategory + params）
- **全局变量**：`$obl_log`（`OblivionsLogger` 实例）
- **输出方式**：`$obl_log->emit($id, $logcategory, $params)`
- **样式控制**：前端模板控制（`log-templates.ts`）
- **持久化**：`oblivions/cache/logs/obl_log_{groomid}_{pid}.json`
- **API 端点**：`obl_log`

### 1.9 战斗日志 (Battle Log) 与 played 标记机制

**与 obl_log 分离的第二套日志系统**，专门记录战斗细节（每一步动作），obl_log 只存战斗摘要（`battle.start`/`battle.end`）。

| | obl_log（结构化日志） | obl_battle_log（战斗日志） |
|---|---|---|
| **存储内容** | 探索/移动/拾取/战斗摘要 | 战斗内每一步动作（攻击/反击/先攻判定/逃跑） |
| **全局变量** | `$obl_log`（`OblivionsLogger`） | `$obl_battle_log`（`BattleLogCollector`） |
| **持久化文件** | `oblivions/cache/logs/obl_log_{groomid}_{pid}.json` | `oblivions/cache/battles/obl_battle_log_{groomid}_{pid}.json` |
| **API 端点** | `obl_log` | `battle_log` |
| **前端用途** | 日志区渲染 + Toast 触发 | 战斗模态框播放 + 碰撞动画 |

**played 标记机制**：

```
后端 emit battlelog（played=0）
  → obl_battle_log_persist() 追加到文件，分配 log_id，played=0
  → 命令响应只返回 {}（不再附带 battlelog 字段）

前端 fetchAndPlayBattleLog()
  → gameApi('battle_log') → 返回 played=0 的条目
  → 按 enemy_pid 分组 → 每组播放（碰撞动画 + 模态框 + 残留伤害数字）
  → POST mark_battle_log_played.php 标记 played=1
```

**BattleLogEntry 字段**：

> **重要**：后端 PHP 返回的所有数值字段实际为 **string 类型**（PHP json_encode 行为），前端 TypeScript 类型定义中 `log_id`/`turn`/`actor_type`/`actor_pid`/`target_type`/`target_pid`/`effect_value`/`played`/`ts` 均为 `string`，使用时需 `Number()` 转换。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 固定 `'battle.action'` |
| `log_id` | string | 文件内自增 ID（持久化时分配），用于标记 played |
| `turn` | string | 先攻轮序号（0=战斗开始/结束，1+=回合 N） |
| `actor` | string | 行动方标识（`'player'` 或 `'enemy_{pid}'`） |
| `action_id` | string | 动作 ID（`unarmed_strike`/`escape`/`battle.start`/`initiative.roll`/`battle.end`） |
| `action_name` | string | 动作显示名（如 `'空手攻击'`） |
| `target` | string | 目标标识（`'player'`/`'enemy_{pid}'`/结果标识） |
| `effect_value` | string | 效果值（伤害值等） |
| `extra` | object\|null | 额外信息（如 `{'success': true}`、`{'player_roll': 50, 'enemy_roll': 30}`） |
| `enemy_pid` | int | 战斗对象 PID（前端按战斗分组播放） |
| `played` | string | 0=未播放，1=已播放（前端播放后通过 mark 接口标记） |
| `ts` | string | Unix 时间戳 |

---

## 二、核心设计原则

### 2.1 数据层独立性

Oblivions 子系统拥有完全独立的数据层，不依赖传统模式的 `bra_players` 表：

- 玩家+敌人统一存储在 `bra_oblplayers` 表
- `obl_save_player()` 仅写 `bra_oblplayers`，不同步任何数据到 `bra_players`
- `save_gameinfo()` 在 Oblivions 模式下跳过 `bra_players` 查询
- 所有数据通过 `&$pdata` 引用传递，禁止函数内 `extract()`

**设计理由**：避免与传统模式的数据结构耦合，允许 Oblivions 独立演进字段结构（如 itempara JSON 数组替代 itm0~itm6 42 字段）。

### 2.2 后端只输出事件结构

结构化日志系统的核心原则：后端只负责"发生了什么 + 参数"，前端完全控制视觉呈现（文案、样式、随机化）。

```php
// 后端：只输出事件结构
$obl_log->emit('move.success', 'move', [
    'from_name' => $from_name,
    'to_name'   => $to_name,
]);
```

**设计理由**：
- 视觉呈现是前端职责，后端不应关心 HTML/CSS
- 同一事件可在不同前端上下文呈现不同样式（日志区 vs Toast）
- 前端可独立迭代文案，无需后端发版

### 2.3 玩家操作与 NPC 先攻轮互斥

通过 `obl_tick_pending_npc` 标志实现玩家行动与 NPC 事件结算的互斥：

- 玩家执行推进 tick 的命令后，设置 `obl_tick_pending_npc = true`
- 前端检测到 `pending_npc = true` 时，拒绝推进 tick 的命令并提示"NPC 行动中"
- NPC 事件结算完毕后，`obl_tick_pending_npc = false`，前端广播 `game:npc-settled` 事件刷新数据

**设计理由**：防止玩家在 NPC 先攻轮未结算时再次行动，导致状态不一致。

### 2.4 played 标记机制替代响应内嵌

战斗日志采用"持久化 → 前端拉取 → 标记"的统一单路径流程，替代"命令响应附带 battlelog"的双路径方案：

- 后端 emit battlelog 后持久化到文件（`played=0`），命令响应只返回 `{}`
- 前端通过 `battle_log` API 拉取未播放条目，播放后调 mark 接口标记 `played=1`
- `played=1` 的条目保留在文件中作为历史记录，游戏重置时清理

**设计理由**：
- 统一单路径：玩家命令和遭遇战走相同流程，避免双路径维护成本
- 响应体精简：命令响应不再携带大量 battlelog 数据
- 可重放：前端可重新拉取未播放的 battlelog

### 2.5 零依赖接口设计

`mark_battle_log_played.php` 采用零依赖设计：不 require 任何游戏框架文件（无 common.inc.php / player.func.php / DB 连接），只做文件读写。

- 安全性靠 `(int)` 强制转换防路径遍历
- 并发写靠 `LOCK_EX` 保护

**设计理由**：mark 请求的唯一目的是"修改文件中某些条目的 played 字段"，即使被伪造也无严重后果（最多让玩家少看一条 battlelog），不值得走完整的 auth + DB 流程。

### 2.6 flock 并发锁 + 前端短锁

前后端三层防护防止短时间多次请求导致重复提交/状态错乱：

| 层 | 位置 | 机制 | 释放时机 |
|----|------|------|---------|
| 前端命令队列锁 | `command-queue.ts: isLocked` | 布尔标志，覆盖 HTTP 请求期间 | `try/finally` 末尾 |
| 前端 NPC 待结算锁 | `command-queue.ts: pendingNpc` | 响应式 ref，NPC 行动期间锁定 | `game:npc-settled` 事件 |
| 后端文件锁 | `obl_command.php: flock(LOCK_EX\|LOCK_NB)` | 同一玩家 PID 的独占文件锁 | 进程结束/脚本 exit 时 OS 自动释放 |

**为什么选 flock 而非 DB 锁**：
- flock 在进程异常退出时由 OS 自动释放，不会死锁
- DB 锁需要额外的"超时清理"逻辑，复杂度高
- 单机部署足够，无需分布式锁
- 性能优于 DB 锁

### 2.7 三阶段战斗演出

战斗日志播放采用三阶段流程，建立可扩展的战斗演出框架：

1. **碰撞动画阶段**（地图上）：攻击方冲刺 + 受击方抖动，不含伤害数字（避免"未卜先知"）
2. **模态框阶段**（中央遮罩）：按 log_id 排序播放 battlelog，turn=0 显示"战斗开始"分隔符，turn>=1 显示"回合 N"分隔符
3. **残留伤害数字阶段**（地图格上）：模态框关闭后，在受击方格子上淡入显示伤害数字

**职责分离**（前端核心设计）：
- `battleStore.fetchAndPlayBattleLog()` — 纯播放器，不涉及状态判断
- `battleStore.refreshBattle()` — 状态管理，播放完成后根据 action 决定后续
- `BattleModal.vue` — 演出组件，卸载时主动 reject 解锁 async 链路
- store 侧 Promise 加 30s 超时兜底

### 2.8 区域切换日志拆分

区域切换（无论前进还是回退）统一拆分为三条独立日志：
1. `move.region_leave` — 离开当前区域
2. `move.region_enter` — 进入目标区域（含区域描述）
3. `move.tile_desc` — 落脚格描述（复用已有 ID）

**设计理由**：这样"从 A 出来"和"到了 B"是两个独立事件，语义更清晰。

### 2.9 战斗状态机简化

```
normal（探索）←→ battle（战斗）
```

- **prebattle 取消**：玩家点击敌人 → 纯前端确认界面（"是否攻击？"）→ 确认后直接提交 `obl_battle_start`，后端直接进入 `action='battle'`
- **ended 取消**：模态框播放完自动关闭，关闭后刷新状态决定去留

**设计理由**：减少中间态，降低状态机复杂度。前端确认界面承担了 prebattle 的确认职责，无需后端状态。

### 2.10 命令状态强制过滤

后端 `obl_command_allowed_by_state` 强制过滤命令：
- `action='battle'` 时只允许 `obl_battle_action`
- 非战斗状态不允许 `obl_battle_action`（`obl_battle_start` 仍允许）
- 被拒绝的命令 emit `command.rejected` 日志，不推进 tick

**设计理由**：防止前端在错误状态下提交命令，后端强制兜底。

---

## 三、缓存目录结构

Oblivions 子系统的运行时缓存文件统一存储在 `oblivions/cache/` 下，按用途分子目录：

```
oblivions/cache/
├── .htaccess              # Apache 访问保护（Deny from all）
├── locks/                 # obl_lock_{groomid}_{pid}.php — 命令并发锁
├── logs/                  # obl_log_{groomid}_{pid}.json + obl_error_{groomid}_{pid}.json
├── battles/               # obl_battle_log_{groomid}_{pid}.json — 战斗日志
└── debug/                 # ai_dump_{groomid}.jsonl — AI 调试 dump
```

**设计原则**：
- 缓存文件由后端 PHP 运行时生成，与前端代码彻底解耦
- 每个 `*_persist` 函数和锁文件路径都有 `is_dir + @mkdir` 保护，避免目录缺失导致 bug
- 游戏重置时（`rs_game()` 钩子）自动清理，日常依赖条目上限自然轮转
- `.htaccess` 防止直接访问（锁文件有 `die` 保护，但 json/jsonl 文件可被直接读取）

---

## 四、相关设计文档

### 已完成任务设计案

| 文档 | 核心内容 |
|------|---------|
| [结构化日志系统设计案.md](./docs/已完成任务/结构化日志系统设计案.md) | OblivionsLogger + emit/持久化/前端模板渲染 |
| [Oblivions_日志系统debug分类设计案.md](./docs/已完成任务/Oblivions_日志系统debug分类设计案.md) | debug 日志 ID 清单 + 前端 [DBG] 前缀 |
| [战斗系统设计案.md](./docs/已完成任务/战斗系统设计案.md) | 先攻轮机制 + 战斗状态管理 |
| [战斗演出系统设计案.md](./docs/已完成任务/战斗演出系统设计案.md) | 三阶段播放 + BattleModal + 超时兜底 |
| [battle_log重构设计案.md](./docs/已完成任务/battle_log重构设计案.md) | played 标记机制 + 零依赖 mark 接口 |
| [Oblivions玩家系统与游戏刻机制设计案.md](./docs/已完成任务/Oblivions玩家系统与游戏刻机制设计案.md) | 独立数据层 + tick 推进 + 监听器 |
| [游戏刻机制设计案.md](./docs/已完成任务/游戏刻机制设计案.md) | tick 模块拆分 + 三阶段调度 |
| [Tick模块拆分 + 监听器机制设计方案.md](./docs/Tick模块拆分 + 监听器机制设计方案.md) | 监听器注册 + battle_npc/idle_npc/post 三阶段 |
| [Oblivions_NPC敌人系统设计案.md](./docs/已完成任务/Oblivions_NPC敌人系统设计案.md) | NPC 生成 + AI 决策 + 碰撞战斗 |
| [探索与交互系统设计.md](./docs/已完成任务/探索与交互系统设计.md) | 探索/搜索/拾取/丢弃核心逻辑 |
| [建筑物与道具系统设计.md](./docs/已完成任务/建筑物与道具系统设计.md) | POI 模板 + 掉落表 + 机制分发 |
| [Toast即时反馈系统设计案.md](./docs/已完成任务/Toast即时反馈系统设计案.md) | 前端 Toast 白名单触发 |
| [obl_tick_pending_npc 前端优化设计案.md](./docs/obl_tick_pending_npc 前端优化设计案.md) | pendingNpc 锁 + 轮询 + game:npc-settled 事件 |
| [错误日志迁移执行方案.md](./docs/错误日志迁移执行方案.md) | OblivionsErrorLogger + command.rejected 渲染 |
| [缓存路径迁移设计案.md](./docs/缓存路径迁移设计案.md) | vex/cache → oblivions/cache 子目录分类 |

---

**文档结束。** 代码库参考手册见 [CODEBASE.md](./CODEBASE.md)。
