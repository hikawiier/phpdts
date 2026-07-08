﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿# vex-vue 前端项目 — 代码库说明

> 帮助 AI 智能体快速了解 vex-vue 前端的架构、模块职责、数据流、API 对接约定和战斗演出系统。
> 项目文档总入口：[AGENTS.md](../AGENTS.md) | 后端文档：[oblivions/CODEBASE.md](../oblivions/CODEBASE.md)

---

## 一、项目概述

vex-vue 是 PHPDTS 大逃杀游戏 **Oblivions 模式** 的专用前端，采用 ASCII 终端风格（黑白灰阶 + CRT 特效），单页应用（SPA）。替代旧版 vex 前端（原生 JS，已废弃）。

**技术栈**：
- Vue 3.5（Composition API + `<script setup>`）
- Vite 6（构建工具 + dev server）
- Pinia 2（状态管理）
- TypeScript 5（类型系统）
- Tailwind CSS v4（`@tailwindcss/vite` 插件，构建时编译）
- 自定义 CSS（`terminal.css` + `battle.css`，覆盖 Tailwind 无法处理的部分）
- IBM Plex Mono 等宽字体
- GSAP（角色层动画：标靶弹起/倒下/呼吸）
- 原生 fetch API（无 axios 依赖）

**部署方式**：
- 开发：`npm run dev` 启动 Vite dev server（端口 5174），通过 proxy 转发 `/phpdts/*` 到后端
- 生产：`npm run build` 构建到 `dist/`，由 `game.php` 重定向到 `vex-vue/dist/index.html`
- 部署路径：`/phpdts/vex-vue/`（vite.config.js `base` 配置）

**与旧 vex 前端的关键差异**：
- 响应式驱动：Pinia store + Vue ref/computed 替代手动 DOM 操作
- 类型安全：TypeScript 全量类型定义（API 响应、事件、组件 props）
- 事件系统：dataManager.broadcast/listen 替代全局事件总线
- 战斗演出：store 驱动 + BattleModal Promise 等待 + sleep reject 取消机制

---

## 二、目录结构

```
vex-vue/
├── index.html              # SPA 入口 HTML
├── package.json            # 依赖配置（vue/pinia/vite/tailwind/typescript/gsap）
├── vite.config.js          # Vite 配置（proxy keepAlive + base 路径 + manualChunks）
├── tsconfig.json           # TypeScript 配置
├── .env.production         # 生产环境变量（VITE_API_BASE=/phpdts, VITE_DEBUG=false）
├── .gitignore              # 忽略 node_modules/dist/*.local/.DS_Store
├── public/
│   └── img/
│       ├── test2.png       # 玩家角色立绘（1-bit 漫画风格，旧素材）
│       └── 4.png           # 玩家角色立绘（当前使用）
└── src/
    ├── main.ts             # 入口：createApp + createPinia + 挂载 #app
    ├── App.vue             # 根布局：StatusBar + LeftPanel + RightPanel + 浮动组件
    ├── api/
    │   ├── client.ts       # API 客户端：gameApi/submitCommand/markBattleLogPlayed/aiDumpSave
    │   └── endpoints.ts    # API action 常量（9 个只读端点）
    ├── assets/
    │   └── styles/
    │       ├── input.css       # Tailwind 源文件（@theme 色板定义）
    │       ├── terminal.css    # 自定义样式（CRT/地图格/实体层/按钮/动画/日志类/状态栏/模态框/Toast）
    │       └── battle.css      # 战斗样式（战斗模态框/碰撞动画/伤害数字/回合光效/装填区）
    ├── components/
    │   ├── actions/
    │   │   ├── ExploreButton.vue       # 探索按钮
    │   │   └── TileActionBar.vue       # 地图格动作条（POI + 脚边道具 + 探索/搜索/拾取）
    │   ├── battle/
    │   │   ├── AimMode.vue             # 瞄准模式（选目标技能）
    │   │   ├── BattleActionBar.vue     # 战斗动作条（装填区 + 等待提示）
    │   │   ├── BattleHeader.vue        # 战斗头部（敌人名称 + 位置）
    │   │   ├── BattleModal.vue         # 战斗演出模态框（播放 battlelog + HP 条）
    │   │   ├── BattleMode.vue          # 战斗模式容器
    │   │   ├── CollisionAnimation.vue  # 碰撞动画（冲刺 + 抖动）
    │   │   ├── DamageNumber.vue        # 残留伤害数字
    │   │   └── PreloadArea.vue         # 装填区（技能列表 + AP 条 + 队列 + 执行/清空）
    │   ├── inventory/
    │   │   ├── EquipmentList.vue       # 装备列表（7 槽）
    │   │   └── InventoryList.vue       # 背包列表（slots + 丢弃）
    │   ├── layout/
    │   │   ├── InventoryDrawer.vue     # 右抽屉（背包 + 装备标签切换）
    │   │   ├── LeftPanel.vue           # 左面板（地图容器）
    │   │   ├── Modal.vue               # 通用模态框
    │   │   ├── PlayerDrawer.vue        # 左抽屉（玩家属性详情）
    │   │   ├── RightPanel.vue          # 右面板（日志 + 动作条 / 战斗动作条）
    │   │   ├── StatusBar.vue           # 顶部状态栏（HP/SP/AP + 位置 + tick）
    │   │   └── ToastContainer.vue      # Toast 容器
    │   ├── log/
    │   │   ├── LogEntry.vue            # 单条日志渲染
    │   │   ├── LogPanel.vue            # 日志面板（v-for + 滚动 + 未读计数）
    │   │   └── LogUnreadBtn.vue        # 未读日志提示按钮
    │   └── map/
    │       ├── MapContainer.vue        # 地图容器（缩放按钮 + 立绘调试按钮 + 网格）
    │       └── MapGrid.vue             # 地图网格（v-for 渲染 cells + 实体层 entities + 迷雾）
    ├── composables/
    │   ├── useMapEntities.ts      # 多实体动画层（entity DOM 引用 + 位置同步 + z-index 更新 + GSAP 动画 + 意图派发）
    │   ├── useDebugBus.ts          # DebugBus（?debug=ai 时收集事件流）
    │   ├── useLogScroll.ts         # 日志滚动逻辑（自动滚动 + 未读计数）
    │   ├── useMapBusiness.ts       # 地图业务逻辑（clickMove/handleEnemyClick）
    │   ├── useMapInteraction.ts    # 地图交互（缩放/平移/键盘/触摸/路径预览/居中）
    │   ├── useMapReachability.ts   # 地图可达性（BFS + findPath + 方向箭头）
    │   ├── useMapRender.ts         # 地图渲染（renderMapGrid + applyZoom）
    │   ├── useMapZoom.ts           # 地图缩放状态
    │   └── useToastPosition.ts     # Toast 位置管理（isAnyOverlayOpen + 位置类）
    ├── data/
    │   ├── battle-templates.ts     # battle_log 渲染模板（按 act_id 索引）
    │   ├── log-templates.ts        # 结构化日志模板（按 id 索引）+ renderLogEntry
    │   ├── skill-templates.ts      # 技能模板（按 act_id 索引）+ getSkillTemplate
    │   └── terrain-desc.ts         # 地形描述词库 + generateTerrainDesc
    ├── stores/
    │   ├── entities.ts             # 实体层数据（entities computed 派生自 mapStore，不依赖 isDown）
    │   ├── battle.ts               # 战斗状态机（normal/battle + battlelog 播放 + NPC 刷新）
    │   ├── battle-director.ts      # 战斗导演模块（同步纯函数：编排 raw entries → 分层演出脚本 PlayScript）
    │   ├── command-registry.ts    # 命令三维度分类（mode/advancesTick/itm0Allowed）单一真值源
    │   ├── command-queue.ts        # 命令队列（5 层锁 + canExecute + 冷却）
    │   ├── data-manager.ts         # 数据层（白名单缓存 + 去重 + 事件总线）
    │   ├── inventory.ts            # 背包 + 装备（loadInventory + handleDiscard）
    │   ├── log.ts                  # 日志（refreshLog + 增量检测 + Toast 触发）
    │   ├── map.ts                  # 地图（loadMap + updateMapData + enemies）
    │   ├── player-avatar.ts        # 玩家小人意图状态机（intent/intentSeq/isDown/pendingIntent + 自动恢复）
    │   ├── player.ts               # 玩家信息（loadPlayerInfo + computed 属性）
    │   ├── tileAction.ts           # 地图格动作（探索/搜索/拾取/丢弃/区域切换 + 模态框）
    │   ├── toast.ts                # Toast（showToast + 同类合并）
    │   └── ui.ts                   # UI 全局状态（抽屉/模态框/战斗按钮三态/标签）
    ├── types/
    │   ├── map-entity.ts           # 地图实体类型（EntityKind/EntityLayer/ActorKind/MapEntity）
    │   ├── api.ts                  # API 响应类型定义（PlayerInfo/Enemy/GameMap/BattleLogEntry 等）
    │   ├── events.ts               # 语义事件类型定义（AppEvent + 事件数据接口）
    │   └── player-avatar.ts        # 玩家小人动画意图类型（PlayerAvatarIntent）
    └── utils/
        ├── format.ts               # 工具（escapeHtml / isFalsy 等）
        └── perf.ts                 # 性能分析工具（perf.mark/span/spanAsync，默认关闭）
```

---

## 三、核心概念词典

> 后端概念定义见 [oblivions/CODEBASE.md 第二节](../oblivions/CODEBASE.md)。以下为前端特有概念。

### 3.1 五层并发锁

前端通过 `commandQueue._checkLocks(command)` 在 `execute()` 和 `canExecute(command)` 内部依次检查 5 层锁。前两层为全局锁（写入 `isLocked`），后三层为按命令维度（依赖 `COMMAND_REGISTRY` 三维度分类）的细粒度锁：

| 层 | 实现位置 | 检查内容 | 覆盖范围 |
|----|---------|---------|---------|
| **1. HTTP/冷却** | `commandQueue._locked` / `_cooldown` | HTTP 请求锁 + 后端返回 timer 设置的冷却 | 防止快速连点重复 POST；冷却未过期拒绝 |
| **2. 战斗演出** | `battleStore.isPlayingBattleLog` | battlelog 播放期间 | 防止 fetchAndPlayBattleLog 重入；同时阻止所有命令（全局锁） |
| **3. itm0** | `inventoryStore.itm0 !== null` | itm0 缓存槽非空时仅放行 `spec.itm0Allowed=true` 命令（整理/丢弃/使用手持） | 强制玩家处理遗留道具 |
| **4. 模式** | `battleStore.currentMode` | 探索模式拒绝 `mode='battle'` 命令；战斗模式拒绝 `mode='explore'` 命令 | UI 状态与命令类型匹配 |
| **5. PROCESSING** | `playerStore.oblBattleState === 'PROCESSING'` | 仅拦截 `spec.advancesTick=true` 命令（`obl_battle_action` 等推进 tick） | 防止玩家在 NPC 行动期间重复提交推进 tick 命令 |

**关键设计**：

- `isLocked` getter 只包含第 1+2 层（全局锁），用于全局 UI 反馈（状态栏指示器）；按钮 `:disabled` 应改用 `canExecute(command)` 精细化控制
- `canExecute(command)` 与 `execute()` 共用 `_checkLocks()`，保证 UI 查询与实际执行判断完全一致——避免重蹈 `isLocked` 与 `execute` 行为分叉的隐性 bug
- 命令三维度分类（`mode` / `advancesTick` / `itm0Allowed`）单一真值源在 `COMMAND_REGISTRY`，新增命令时需同步登记后端 `obl_command_allowed_by_state` / `obl_command_advances_tick` / `oblivions_router.php` itm0 门控
- `obl_battle_start` 前端归 `mode='battle'`（UI 状态：startBattle 立即切换 currentMode），后端归探索内（`action='normal'` 时允许）——两端分类不同但语义自洽

> 详细设计案见 [战斗锁定白名单-设计案](../oblivions/docs/战斗锁定白名单-设计案.md)。

**与后端三层白名单对应**：

| 前端层 | 后端对应 |
|--------|---------|
| 第 3 层 itm0 | `oblivions_router.php` itm0 门控（`itempara[0]` 非空时只放行 `obl_organize`/`obl_discard`） |
| 第 4 层 模式 | `obl_command_allowed_by_state`（`action='battle'` 时只允许 `obl_battle_action`） |
| 第 5 层 PROCESSING | `obl_tick_has_busy_battle()` + `obl_command_advances_tick()`（PROCESSING 时拒绝推进 tick 命令） |

**全生命周期锁**（独立于 5 层锁）：`battleStore.isProcessingBattle` 覆盖"拉取-播放-标记-刷新"全流程，防止 `refreshBattle` 重入，由 `battleStore` 自行管理。

**后端文件锁**：`flock(LOCK_EX\|LOCK_NB)` 在命令执行期间持有，多请求并发时拒绝后续（返回 `COMMAND_IN_PROGRESS`）。

### 3.2 事件总线（dataManager）

`dataManager` 是单例数据层，承担两个职责：

1. **数据层**：白名单缓存 + 请求去重（详见第五章）
2. **事件总线**：`broadcast(event, data)` / `listen(event, cb)` / `unlisten(event, cb)`

事件总线用于模块间解耦通信。例如：
- `mapStore.loadMap()` 完成后 `broadcast('map:loaded')`
- `tileActionStore` / `inventoryStore` / `logStore` 监听 `map:loaded` 后自行刷新
- 战斗演出时 `battleStore` `broadcast('battle:play-collision')` 触发 `CollisionAnimation` 组件

**对称注册模式**：每个 store 提供 `registerListeners()` 方法，在 `App.vue` 的 `onMounted` 中统一调用一次（内部用 `_listenersRegistered` 标志防重复）。

### 3.3 战斗状态机

简化为两态（取消 prebattle/ended 中间态）：

```
normal（探索）
  ↓ 玩家点击敌人 → startBattle(enemyPid)
  ↓ 切换到 battle 模式 + 初始化装填区（pre-battle）
  ↓ 玩家装填动作 → 点击执行 → obl_battle_start
battle（战斗）
  ↓ 玩家回合：装填区（in-battle）→ 执行 → obl_battle_action
  ↓ NPC 回合：定时刷新 player_info 触发后端推进
  ↓ battlelog 播放完成 + action='' → exitBattleMode
  ↓ 回到 normal
```

#### 3.3.1 前端 currentMode 与后端 action 的同步路径

前端 `currentMode`（UI 状态）与后端 `action`（逻辑状态）通过 `player_info` 同步。三种场景的同步方向不同：

| 场景 | 同步方向 | 实现路径 |
|------|---------|---------|
| **玩家主动攻击** | 前端先切换 currentMode='battle' | `useMapBusiness.onEnemyClick` → `battleStore.startBattle()` 立即设 currentMode；后端 action 在 `obl_battle_start` 命令执行后才切换 |
| **被动遭遇** | 后端先切换 action='battle'，前端跟随 | 玩家 `move`/`obl_explore`/`obl_search` 触发后端遭遇战 → `_checkBattleState` 拉取 `player_info` 看到 action='battle' → `refreshBattle` → `enterBattleMode` |
| **退出战斗** | 后端先切换 action='normal'，前端延迟到 battlelog 播完 | `refreshBattle` 看到 action !== 'battle' → `fetchAndPlayBattleLog` 播完积压战斗日志 → `exitBattleMode` |

#### 3.3.2 窗口期合理性边界

`currentMode` 与 `action` 在以下窗口期不一致是**合理设计**，非 bug：

| 窗口期 | 方向 | 合理性 |
|--------|------|--------|
| 玩家主动攻击时前端先切换 currentMode='battle' | 前端比后端**早进入** | ✅ 玩家需要装填区才能发起 obl_battle_start |
| 退出战斗时前端等 battlelog 播完才切 currentMode='normal' | 前端比后端**晚退出** | ✅ 演出完整性优先，避免战斗突然结束的突兀感 |
| 被动遭遇时后端先切换 action='battle' | 后端比前端**早进入** | ✅ 遭遇战由后端判定触发，前端通过 player_info 跟随 |

**反向不合理场景**（应视为 bug 修正）：
- ❌ 前端比后端**早退出**战斗——前端处理有 bug，应修正同步逻辑
- ❌ 玩家主动攻击时前端比后端**晚进入**战斗——`startBattle` 必须立即切换 currentMode

#### 3.3.3 战斗内部状态（oblBattleState）

`currentMode='battle'` 时，战斗内部还有三态流转（来自后端 `player_info.obl_battle_state`）：
- `PLAYER_TURN`：玩家可操作，提交 `obl_battle_action`
- `PROCESSING`：后端处理中（NPC 行动 / 玩家行动已提交未结算），前端启动 1 秒轮询循环
- `IDLE`：无战斗（不应在 currentMode='battle' 时出现）

前端 `commandQueue` 第 5 层 PROCESSING 锁（仅拦截 `COMMAND_REGISTRY` 中 `advancesTick=true` 的命令）用于防止玩家在 NPC 行动期间重复提交 `obl_battle_action`，与后端 [C2b] 一致。详见 [§3.1 五层并发锁](#31-五层并发锁)、[oblivions/DESIGN.md §2.9.2](../../oblivions/DESIGN.md#292-战场状态机三态obl_battle_state-字段) 与 [§2.16.2](../../oblivions/DESIGN.md#2162-processing-的实际生命周期)。

### 3.4 装填区（PreloadArea）两种模式

| 模式 | 触发时机 | 执行命令 | 说明 |
|------|---------|---------|------|
| `pre-battle` | 玩家点击敌人后、战斗开始前 | `obl_battle_start` | 玩家预装填动作序列后提交，直接进入战斗 |
| `in-battle` | 战斗中玩家回合 | `obl_battle_action` | 玩家每回合装填动作并执行 |

装填区通过监听 `battle:preload-init` 事件初始化，事件数据含 `mode` / `enemyPid` / `playerPid`。

### 3.5 瞄准模式（AimMode）

部分技能 `target='enemy'` 且无明确目标时触发瞄准：
- 进入瞄准 → `broadcast('battle:aim-mode')` → `AimMode` 组件接管地图选目标
- 选定目标 → `AimMode` `broadcast('battle:aim-target-selected')` → `PreloadArea.onTargetSelect`
- 退出瞄准 → `broadcast('battle:aim-exit')`

`uiStore.battleBtnState` 三态（`normal`/`battle`/`aim`）通过监听这些事件同步。

### 3.6 心跳守护进程与 NPC 轮询

[`battle.ts`](../src/stores/battle.ts) 实现两个职责分离的后台节拍，是后端游戏刻推进的唯一驱动力。

#### 3.6.1 两个定时器

| 定时器 | 间隔 | 实现 | 职责 |
|--------|------|------|------|
| **心跳守护进程** | **PROCESSING 300ms；其他状态 1000ms** | [`oblHeartbeat()`](../src/api/client.ts) → `POST /phpdts/oblivions/api/heartbeat.php` | 显式触发后端 tick 推进 + NPC 行动 |
| **NPC 状态轮询** | **1000ms** | [`startNpcTurnRefresh`](../src/stores/battle.ts#L131-L137) → `dataManager.fetch('player_info')` | 状态发现——查看是否切回 PLAYER_TURN |

**启动方式**：`App.vue` `onMounted` 调用 `battleStore.startDaemonPoll()`，页面挂载期间持续运行；NPC 状态轮询由 `refreshBattle` 在感知到 PROCESSING 时启动，切回 PLAYER_TURN/IDLE 时停止。心跳守护进程使用 `setTimeout` 串行调度，避免慢请求重叠。

#### 3.6.2 完整链路

```
前端 _daemonBeat（PROCESSING 300ms；其他状态 1000ms）
  ↓
POST /phpdts/oblivions/api/heartbeat.php
  ↓
后端 heartbeat.php 加载 Heartbeat API bootstrap
  ↓
obl_runtime_boot('heartbeat') + obl_tick_orchestrator_heartbeat()
  ↓
检测 obl_pretick < obl_tick 并 resolve pending tick → 调度 NPC 行动
  ↓
状态机切换（PROCESSING → PLAYER_TURN / self_loop / IDLE）
  ↓
下次心跳继续（若 self_loop 持续 NPC 行动）
```

后端细节详见 [oblivions/DESIGN.md §2.16.1](../../oblivions/DESIGN.md#2161-heartbeat--tick-推进完整链路)。

#### 3.6.3 PROCESSING 实际生命周期

由于 PROCESSING 下心跳以 300ms 快速驱动，PROCESSING 通常在 **300-600ms 内**（一到两个心跳周期）被处理完：

- 单次 NPC 行动：1 秒轮询大概率看不到 PROCESSING，已切回 PLAYER_TURN
- NPC 多回合连击（self_loop）：1 秒轮询可能看到 PROCESSING
- 服务器高负载：1 秒轮询看到 PROCESSING，启动轮询循环

**前端实际感知 PROCESSING 的场景**：
1. 玩家执行 `battle.submit_turn` 后立即拉取 `player_info`——可能在守护进程推动 NPC 行动前看到 PROCESSING（这是 PROCESSING 锁的主要触发场景）
2. NPC 多回合连击时 1 秒轮询拉取到 PROCESSING

**常见误解**：1 秒轮询不是“驱动后端”——真正驱动后端 NPC 行动的是 heartbeat，1 秒轮询只是“状态发现”。

---

## 四、数据流架构

### 4.1 整体分层

```
┌─────────────────────────────────────────────────────────────┐
│  Components（.vue）                                          │
│  ├─ 读取 store 状态（ref/computed）响应式渲染                │
│  ├─ 调用 store action 触发业务逻辑                           │
│  └─ 监听 dataManager 事件触发动画（如 CollisionAnimation）    │
├─────────────────────────────────────────────────────────────┤
│  Composables（use*.ts）                                      │
│  ├─ 纯逻辑层（无响应式状态，或仅模块级缓存）                  │
│  ├─ useMapEntities：实体层动画（位置同步 + z-index 更新 + GSAP + 意图派发）       │
│  ├─ useMapBusiness：clickMove/handleEnemyClick 业务编排      │
│  ├─ useMapInteraction：缩放/平移/键盘/触摸交互               │
│  ├─ useMapReachability：BFS 可达性 + findPath 寻路           │
│  ├─ useMapRender：renderMapGrid DOM 渲染                     │
│  └─ useToastPosition：Toast 位置响应式计算                   │
├─────────────────────────────────────────────────────────────┤
│  Stores（Pinia）                                             │
│  ├─ 状态管理（ref/computed）+ action（业务函数）             │
│  ├─ 通过 dataManager.fetch 拉取数据                          │
│  ├─ 通过 commandQueue.execute 提交命令                       │
│  └─ 通过 dataManager.broadcast/listen 通信                   │
├─────────────────────────────────────────────────────────────┤
│  DataManager（单例）                                         │
│  ├─ fetch(action)：白名单缓存 + 请求去重                     │
│  ├─ invalidate/invalidateAll：清缓存                         │
│  └─ broadcast/listen/unlisten：事件总线                      │
├─────────────────────────────────────────────────────────────┤
│  API Client（api/client.ts）                                 │
│  ├─ gameApi(action)：GET oblivions/api/state.php?scope=xxx               │
│  ├─ sendOblCommand(envelope)：POST oblivions/api/command.php                  │
│  ├─ markBattleLogPlayed：POST oblivions/mark_battle_log_played.php │
│  └─ aiDumpSave：已移除（过时调试残留）          │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 读取流（页面加载）

```
App.vue onMounted
  ├─ 各 store.registerListeners()（注册 dataManager 事件监听）
  └─ Promise.all([
       playerStore.loadPlayerInfo(true),   // gameApi('player_info') → 状态栏
       mapStore.loadMap(),                  // 并行 fetch game_map + enemies
     ])
       ↓ mapStore.loadMap 完成
       ├─ updateMapData（curLoc/curRegion/links/enemies）
       ├─ computeReachableMap（BFS 可达性缓存）
       └─ broadcast('map:loaded')
            ├─ tileActionStore.loadTileAction()   // 监听 map:loaded
            ├─ inventoryStore.loadInventory()     // 监听 map:loaded
            └─ logStore.refreshLog(false)         // 监听 map:loaded（被动刷新）
```

### 4.3 写入流（玩家操作）

```
用户操作（点击地图格/探索/搜索/拾取/丢弃/移动/战斗）
  ↓
tileActionStore / inventoryStore / useMapBusiness.clickMove
  ↓
commandQueue.execute(params)              // HTTP 请求锁
  ↓
sendOblCommand(envelope)                  // POST oblivions/api/command.php
  ↓ 成功后：
  ├─ dataManager.invalidate(...)          // 精准失效受影响的缓存
  ├─ mapStore.loadMap()（移动/探索时）    // 重新拉取地图
  └─ dataManager.broadcast('game:action-completed')
       ├─ tileActionStore.loadTileAction()   // 监听 game:action-completed
       ├─ inventoryStore.loadInventory()     // 监听 game:action-completed
       ├─ logStore.refreshLog(true)          // 监听 game:action-completed（强制滚动）
       ├─ playerStore.loadPlayerInfo()       // 监听 game:action-completed（状态栏）
       └─ battleStore.refreshBattle()        // 监听 game:action-completed（检测遭遇战）
```

### 4.4 事件清单

| 事件名 | 触发者 | 订阅者 | 说明 |
|--------|--------|--------|------|
| `map:loaded` | mapStore | tileAction, inventory, log | 地图数据加载完成 |
| `game:action-completed` | tileAction, inventory, useMapBusiness, battle | tileAction, inventory, log, player, battle | 任何游戏操作成功后 |
| `game:npc-settled` | battleStore | mapStore | NPC 回合轮询结束、敌人位置稳定 |
| `game:tick-advanced` | playerStore | battleStore | tick 推进，触发 NPC 回合检测 |
| `map:click-current` | useMapBusiness | tileAction | 点击当前格触发探索 |
| `ui:toast` | 各 store | toastStore | 显示 Toast 通知 |
| `battle:started` | battleStore | uiStore | 战斗开始（同步按钮三态） |
| `battle:ended` | battleStore | uiStore, mapStore | 战斗结束（同步按钮三态 + 刷新地图） |
| `battle:aim-mode` | PreloadArea | uiStore | 进入瞄准模式 |
| `battle:aim-exit` | PreloadArea/AimMode | uiStore | 退出瞄准模式 |
| `battle:aim-target-selected` | AimMode | PreloadArea | 瞄准选定目标 |
| `battle:preload-init` | battleStore | PreloadArea | 初始化装填区 |
| `battle:play-collision` | battleStore | CollisionAnimation | 播放碰撞动画 |
| `battle:play-damage-numbers` | battleStore | DamageNumber | 播放残留伤害数字 |
| `preload:executed` | PreloadArea | battleStore | 装填区执行完成，刷新战斗状态 |
| `log:force-scroll` | logStore | useLogScroll | 强制日志滚动到底部 |
| `log:add-unread` | logStore | useLogScroll | 累加未读日志计数 |

> 立绘调试按钮（弹/倒）已从事件总线迁移为直接调用 `playerAvatarStore.debugPopUp()` / `debugFall()`，不再走 `player:popup` / `player:fall` 事件。

---

## 五、API 对接约定

### 5.1 重要：数值字段返回 string

> **这是前后端对接最关键的约定。**

后端 PHP 通过 `compatible_json_encode()` 返回的所有数值字段实际为 **string 类型**（PHP json_encode 对数据库取出的值的行为）。例如：

```json
{ "pid": "20", "hp": "398", "ap": "5", "log_id": "42", "played": "0" }
```

**前端处理规范**：
- TypeScript 类型定义中这些字段声明为 `string`（见 `types/api.ts`）
- 使用时通过 `Number()` / `parseInt(String(x))` 转换
- store 的 computed 属性集中处理转换（如 `playerStore.hp = computed(() => Number(playerInfo.value?.hp ?? 0))`）

**例外**：`obl_tick` / `obl_pretick` 是数字类型（后端显式 `intval`），`LogEntry.ts` 也是数字类型。

### 5.2 只读 API（GET `oblivions/api/state.php?scope=xxx`）

通过 `gameApi(action)` 调用，返回完整响应对象 `{status, data, ...}`。

| action | 返回数据 | 消费 store | 缓存策略 |
|--------|---------|-----------|---------|
| `game_map` | 地图网格 + 连通性 + 迷雾 + 区域信息 | mapStore | 白名单 5s |
| `tile_actions` | 当前格 POI + 脚边道具 | tileActionStore | 白名单 3s |
| `player_inventory` | 背包槽位 + 装备 | inventoryStore | 白名单 2s |
| `player_info` | 玩家属性 + AP + 装备 + oblpara + groomid | playerStore, battleStore | 不缓存（实时拉取） |
| `obl_log` | 结构化日志条目数组 | logStore | 不缓存 |
| `battle_log` | 战斗日志条目数组（played=0） | battleStore | 不缓存 |
| `enemies` | 当前区域敌人列表 | mapStore, battleStore | 不缓存 |
| `skill_list` | 技能列表 + player_ap | PreloadArea | 不缓存 |

**响应格式**：
```json
{ "status": "success" | "error", "data": {...}, "msg": "..." }
```

### 5.3 写入 API（POST `oblivions/api/command.php`）

通过 `commandQueue.execute(params)` → `sendOblCommand(envelope)` 调用。前端不再调用根目录旧 `command.php`。

**envelope 格式**：

```typescript
{
  command: 'map.explore' | 'map.move' | 'poi.search' | 'item.pickup' | 'item.discard' |
    'item.use' | 'inventory.organize' | 'craft.execute' | 'battle.start' | 'battle.submit_turn',
  request_id: string,
  payload: Record<string, unknown>,
  expected?: Record<string, unknown>,
}
```

**响应格式**：

```json
{
  "status": "success",
  "code": "OK",
  "request_id": "client-generated-id",
  "data": { "refresh": ["player_info"] }
}
```

Oblivions 模式写入请求直接提交到 `oblivions/api/command.php`，后端入口通过 `include/api/obl_command_api_bootstrap.php` 聚合加载 Runtime、JSON request、Command response 与 Command Bus，再由 Tick Orchestrator 处理推进。

**并发冲突响应**：
```json
{ "status": "error", "code": "COMMAND_IN_PROGRESS", "message": "上一个命令仍在处理中" }
```

`sendOblCommand` 检测 `status !== 'success'` 时返回 `success: false`，前端视为失败（通常由 `commandQueue._locked` 在前端就拦截）。

### 5.4 零依赖接口：`mark_battle_log_played.php`

**独立文件**（不走 State API），位于 `oblivions/mark_battle_log_played.php`。

- **请求**: `POST /phpdts/oblivions/mark_battle_log_played.php`
- **Content-Type**: `application/x-www-form-urlencoded`
- **参数**: `groomid` (int) + `pid` (int) + `log_ids` (逗号分隔字符串)
- **响应**: `{ "success": true, "marked": N }`

**零依赖设计**：不依赖任何游戏框架（无 auth/DB），只文件读写。安全性靠 `(int)` 强制转换防路径遍历。设计理由：mark 请求即使被伪造也无严重后果。

**前端调用**（`api/client.ts: markBattleLogPlayed`）：
```typescript
export async function markBattleLogPlayed(
  groomid: number, pid: number, logIds: number[]
): Promise<{ success: boolean; marked?: number }>
```

### 5.5 `player_info` 字段说明

Oblivions 模式独立数据层 `bra_oblplayers`，字段详见 [oblivions/CODEBASE.md 4.0](../oblivions/CODEBASE.md)。

前端关键字段：
- **`groomid`**：房间 ID（供调用零依赖接口 `mark_battle_log_played.php`）
- **`action`**：`''`=正常 / `'battle'`=战斗中
- **`battle_queue`**：先攻队列（`{qid, queue: [{pid, type, myorder, done}]}`），用于判断玩家是否当前顺位
- **`ap`/`max_ap`**：AP 值（Oblivions 专属）
- **`oblpara`**：杂项数据（含 `killnum`/`battle`/`escape_skip_tick` 等）
- **`obl_tick`/`obl_pretick`**：当前/上次 tick（数字类型，非字符串）
- **`equipment`**：7 槽装备（wep/wep2/arb/arh/ara/arf/art）

> 传统模式字段（race/club/nick/money/rage 等）在 Oblivions 模式下不再返回。`killnum` 改为从 `oblpara.killnum` 读取。

---

## 六、DataManager 数据层

`src/stores/data-manager.ts` 导出的 `dataManager` 单例，承担数据层 + 事件总线双重职责。

### 6.1 白名单缓存策略

仅以下 action 缓存（TTL 各不同），高频数据不缓存每次实时拉取：

| action | TTL | 失效时机 |
|--------|-----|---------|
| `game_map` | 5s | 移动/探索后 `invalidate('game_map')` |
| `tile_actions` | 3s | 移动/探索/搜索/拾取后 `invalidate('tile_actions')` |
| `player_inventory` | 2s | 拾取/丢弃后 `invalidate('player_inventory')` |
| `player_info` | 不缓存 | — |
| `enemies` | 不缓存 | — |
| `obl_log` | 不缓存 | — |
| `battle_log` | 不缓存 | — |

### 6.2 请求去重

所有 action 共享 `_pending` Map，并发请求合并为一个 Promise：

```typescript
async fetch(action: ApiAction, forceRefresh = false): Promise<ApiResponse>
```

- 白名单 action：缓存命中直接返回；缓存过期走去重
- 非白名单 action：跳过缓存，但仍走去重
- `forceRefresh=true`：跳过缓存检查，但仍走去重

### 6.3 事件总线 API

```typescript
broadcast(event: AppEvent, data?: unknown): void  // 触发事件
listen(event: AppEvent, callback: EventCallback): void   // 订阅
unlisten(event: AppEvent, callback: EventCallback): void // 取消订阅
```

事件类型见 `types/events.ts` 的 `AppEvent` 联合类型。

---

## 七、Store 层

所有 store 使用 Pinia Composition API 风格（`defineStore('name', () => {...})`）。

### 7.1 Store 职责矩阵

| Store | 职责 | 关键状态 | 关键 action |
|-------|------|---------|-------------|
| `playerStore` | 玩家信息 | `playerInfo` | `loadPlayerInfo(forceRefresh)` |
| `mapStore` | 地图数据 | `curLoc`/`curRegion`/`links`/`enemies` | `loadMap()`/`updateMapData(patch)` |
| `entitiesStore` | 实体层数据（派生） | `entities`(computed) | （无 action，computed 从 mapStore 派生，不依赖 isDown） |
| `playerAvatarStore` | 玩家小人意图状态机 | `intent`/`intentSeq`/`isDown`/`pendingIntent`/`hpRatio` | `onEnter()`/`onMove()`/`onBattleStart()`/`onBattleEnd()`/`onHit()`/`onDie()`/`onLowHp()`/`onNormalHp()`/`debugPopUp()`/`debugFall()`/`notifyUp()`/`notifyDown()` |
| `tileActionStore` | 地图格动作 | `tileActions`/`modalOpen`/`modalType` | `handleExplore()`/`handleSearch(iaid)`/`handlePickup(iid)`/`handlePickupAll(items)`/`handleSwitchRegion()` |
| `inventoryStore` | 背包 + 装备 | `inventoryData`/`equipment`(computed) | `loadInventory()`/`handleDiscard(slot)` |
| `logStore` | 游戏日志 | `entries`/`lastTs` | `refreshLog(forceScroll)` |
| `battleStore` | 战斗状态机 | `currentMode`/`isPlayingBattleLog`/`isProcessingBattle`/`battleModalOpen` | `startBattle(enemyPid)`/`refreshBattle()`/`fetchAndPlayBattleLog()`/`notifyModalClosed()` |
| `toastStore` | Toast 通知 | `toasts` | `showToast(msg, type, duration, isHtml, mergeId)` |
| `uiStore` | UI 全局状态 | `playerDrawerOpen`/`inventoryDrawerOpen`/`modalOpen`/`battleBtnState` | `openPlayerDrawer()`/`openInventoryDrawer()`/`openModal(title, bodyHtml)` |
| `commandQueue` | 命令队列（非 Pinia，单例类） | `_locked`/`_cooldown` + `COMMAND_REGISTRY` | `execute(params)` / `canExecute(command)` |

### 7.2 Store 事件监听注册模式

每个需要监听事件的 store 提供 `registerListeners()` 方法，在 `App.vue` 的 `onMounted` 中统一调用：

```typescript
// App.vue onMounted
tileActionStore.registerListeners();
inventoryStore.registerListeners();
toastStore.registerListeners();
logStore.registerListeners();
battleStore.registerListeners();
```

内部用 `_listenersRegistered` 标志防止重复注册。

### 7.3 commandQueue（非 Pinia 单例）

`src/stores/command-queue.ts` 导出的 `commandQueue` 单例（非 Pinia store），提供 5 层锁 + `canExecute` + `execute` 一致性查询：

```typescript
class CommandQueue {
  private _locked = false;
  private _cooldown = 0;

  // UI 查询与 execute() 共用 _checkLocks
  private _checkLocks(command: string): boolean
  canExecute(command: string): boolean

  async execute(params: Record<string, string>): Promise<CommandResult>

  // 全局锁（仅 HTTP/演出两层）
  get isLocked(): boolean
  // UI 状态展示（StatusBar NPC 指示器），不参与 isLocked
  get pendingNpc(): boolean
  get remainingCooldown(): number
}
```

**关键设计**：

- `_checkLocks(command)` 依次检查 5 层锁（详见 [§3.1 五层并发锁](#31-五层并发锁)），`canExecute` 与 `execute` 共用同一逻辑，保证 UI 反馈与实际执行一致
- `isLocked` getter 仅包含第 1+2 层（HTTP 锁 + 战斗演出锁），用于全局 UI 反馈；按钮 `:disabled` 应改用 `canExecute(command)` 精细化控制
- `pendingNpc` getter 从 `oblBattleState === 'PROCESSING'` 派生，仅用于 StatusBar NPC 指示器和 log.ts 延迟刷新，不参与 `isLocked`
- 锁定时返回 `{ success: false, error: 'LOCKED', message: '当前状态不可执行此操作' }`
- 命令三维度分类（`mode` / `advancesTick` / `itm0Allowed`）从 `COMMAND_REGISTRY`（`src/stores/command-registry.ts`）读取，是单一真值源
- 全生命周期锁（`battleStore.isProcessingBattle`）独立于 5 层锁，覆盖"拉取-播放-标记-刷新"全流程防止 `refreshBattle` 重入（详见第八章）

---

## 八、战斗演出系统

> 这是前端最复杂的子系统，采用**三层架构**（后端给全原料 → 导演集中编排 → 演员纯执行）。

### 8.1 架构总览

```
后端（原料层）              前端导演（编排层）             前端演员（执行层）
BattleLogCollector          battle-director.ts            battle.ts / BattleModal.vue
  emit() 12 phase             direct(entries)               playScript(script)
  debug 标记                  ├─ pairPrePost()               ├─ playPhase0Segment
  bl_turn_num/bl_round_num    ├─ buildSegments()             ├─ playRoundSegment
  bl_segment_flag             └─→ PlayScript                 ├─ playTurnSegment
  名称/HP 原料                  { segments[] }                ├─ playBattleEndSegment
  → JSON 文件                  ├─ phase0                     └─ playAmbushBattleEndSegment
                                ├─ round(roundNum)
                                ├─ turn(turnNum,actorPid)
                                ├─ battle_end
                                └─ ambush_battle_end
```

**导演 vs 演员职责分离**：
- `battle-director.ts`：同步纯函数，输入 raw entries → 输出 `PlayScript`，不做任何渲染
- `battle.ts`：播放器，按 `PlaySegment` 逐段执行（碰撞动画 → 模态框 → 伤害数字）
- `BattleModal.vue`：模态框演出组件，专注逐条播放 + HP 条更新

### 8.2 三类核心输出类型

**DirectedKind**（7 种渲染分发标记）：`action`（pre+post 合并动作）| `initiative`（先攻掷骰）| `flee`（逃跑）| `combatant_cleared`（某人离场）| `battle_end`（标准战斗终结）| `ambush_battle_end`（突袭阶段结束）| `display`（纯展示）

**SegmentKind**（5 种段类型）：`phase0`（Phase 0 突袭攻击，无 Turn/Round）| `round`（Phase 1 一轮）| `turn`（Phase 1 一回合）| `battle_end`（标准战斗终结段）| `ambush_battle_end`（突袭阶段结束段）

**SegmentMeta**：段元数据含 `roundNum` / `turnNum` / `actorPid` / `actorName` / `initiatorOrder` / `ambushPid` / `winnerPid` / `reason` / `ambusherPid`

### 8.3 整体流程（新版）

```
玩家点击敌人 → battleStore.startBattle(enemyPid)
  ├─ 切换战斗模式 + 初始化装填区（pre-battle / in-battle）
  └─ broadcast('battle:started')

玩家装填动作 → 点击执行 → 提交 obl_battle_start / obl_battle_action
  ↓ broadcast('preload:executed')
  ↓
battleStore.onPreloadExecuted()
  ├─ invalidate 相关缓存
  └─ refreshBattle()
       ├─ 拉取 player_info → 判断 action
       │   ├─ action='battle' → 维持战斗模式
       │   └─ action='' → 播放完 battlelog 后退出
       │
       └─ fetchAndPlayBattleLog()
            ├─ 拉取 battle_log（played=0，后端已过滤 debug=true）
            ├─ BattleDirector.direct(entries) → 编排为 PlayScript
            ├─ extractNpcPid(script) → 替代旧 groupByEncounter
            ├─ playScript(script, npcPid) → 逐段执行
            │    各段播放：
            │      phase0     → 更新敌人名称 → 碰撞动画 → 模态框（含段分隔符 + HP 条）
            │      round      → 碰撞动画 → 模态框（先攻面板）
            │      turn       → 更新敌人名称 → 碰撞动画 → 模态框（含 HP 条）→ 伤害数字
            │      battle_end → 模态框（战斗结束文字）
            │      ambush_battle_end → 模态框（突袭结束文字）
            └─ markBattleLogPlayed() 标记所有原始 log_id
       ↓
       播放完成后根据 action 决定后续
```

### 8.4 fetchAndPlayBattleLog（新版）

接入导演编排，`playScript` 替代旧 `playBattleLogGroup`：

```typescript
async function fetchAndPlayBattleLog(): Promise<void> {
  if (isPlayingBattleLog.value) return;
  const entries = (await dataManager.fetch('battle_log', true)).data?.entries ?? [];
  if (entries.length === 0) return;
  isPlayingBattleLog.value = true;
  try {
    const script = direct(entries);           // 导演：同步编排
    if (script.segments.length === 0) return;
    const npcPid = extractNpcPid(script);      // 替代 groupByEncounter
    await playScript(script, npcPid);           // 演员：逐段执行
    await markBattleLogPlayed(groomid, pid, collectAllLogIds(entries));
  } finally {
    isPlayingBattleLog.value = false;
  }
}
```

`direct()` 运行时会挂载 `window.__battleScript` 和 `window.__battleRawEntries`，可在浏览器控制台直接检查导演编排结果。

### 8.5 playScript 逐段执行

`playScript` 按 `segment.kind` 分发到 5 种段播放函数。每段通过 `playSegmentInModal` 统一处理模态框流程：

- **phase0/round 段**：`alwaysShowHeader: true` 确保段分隔符可见（即使 entries 渲染为空）
- **turn 段**：执行碰撞动画（读 `entry.animation` 字段），播放模态框后发伤害数字事件
- **battle_end/ambush_battle_end 段**：`isBattleEnd: true` 确保模态框打开显示结束文字

`playSegmentInModal` 通过 `renderDirectedEntryHtml(entry, playerPid)` 按 `directedKind` 分发渲染，替代旧按 `action_id` 索引的模板系统。

### 8.6 battle-director.ts 核心函数

| 函数 | 说明 |
|------|------|
| `direct(entries)` | 主入口：配对 pre/post → 构建 segments → 返回 PlayScript。开发模式挂载 `__battleScript`/`__battleRawEntries` 到 window |
| `pairPrePost(entries)` | 栈配对：pre 压栈 → interleaving 条目缓冲 → post 合并 pre+post。异常处理：悬空 pre / 孤儿 post / 尾部未配对 pre 降级为 display |
| `mergePrePost(pre, post)` | 合并为 action DirectedEntry。非伤害动作白名单（escape）→ hpSnapshot=null；攻击动作 → 计算 actorHpBefore/After + targetHpBefore/After |
| `buildSegments(entries)` | 按 `bl_segment_flag` 驱动分段：`round_start`→round, `turn_start`→turn, `battle_end`/`ambush_battle_end`→单条段立即关闭。Phase 0 条目不携带边界信号时自动归入 phase0 段 |
| `extractNpcPid(script)` | 从脚本中提取 NPC PID（替代旧 groupByEncounter） |
| `collectAllLogIds(entries)` | 收集所有原始 log_id 供 markBattleLogPlayed 使用（含异常降级条目的 log_id） |
| `exportScriptToJson(script?)` | 调试用：将当前 PlayScript 导出为 JSON 文件下载 |

### 8.7 BattleLogEntry 字段类型（新版）

后端 `BattleLogCollector::emit()` 改造后，字段结构已从旧版（含 `extra`/占位符）更新为完整原料集：

| 字段 | 类型 | 说明 |
|------|------|------|
| `phase` | string | 12+ 事件类型之一（`once_execute_pre`/`once_execute_post`/`initiative_roll`/`flee`/`combatant_cleared`/`battle_end`/`ambush_battle_end` 等） |
| `action_id` | string\|null | 动作 ID（`unarmed_strike`/`escape` 等，`initiative_roll`/`battle_end` 等无动作事件为 null） |
| `actor_pid/type/name` | number\|null | 行动者信息（含名称，无需查 API） |
| `actor_hp/max_hp` | number\|null | 行动者 HP 快照（仅 pre/post/ap_recover 等有） |
| `target_pid/type/name` | number\|null | 目标信息（含名称） |
| `target_hp/max_hp` | number\|null | 目标 HP 快照 |
| `effect_value` | number\|null | 效果值（伤害数值等） |
| `success` | boolean\|null | 动作是否成功（flee/execute 通用） |
| `reason` | string\|null | 原因（`death`/`escaped`/`queue_empty`/`disband`/`ambush_killed_all` 等） |
| `winner_pid` | number\|null | 战斗赢家 PID（仅 `battle_end` 有） |
| `cleared_pid/cleared_name` | number\|string\|null | 被清理的 combatant（仅 `combatant_cleared` 有） |
| `ambusher_pid/ambusher_name` | number\|string\|null | 突袭者（仅 `ambush_battle_end` 有） |
| `debug` | boolean | 调试标记（前端默认拉取的条目均为 false） |
| `bl_turn_num` | number\|null | Turn 计数（null=Phase 0/尚未开始） |
| `bl_round_num` | number\|null | Round 计数（null=Phase 0 无队列） |
| `bl_segment_flag` | string\|null | 段边界信号（`round_start`/`turn_start`/`battle_end`/`ambush_battle_end`/null） |
| `log_id/played/ts` | number | 持久化元数据 |

> **说明**：后端 `compatible_json_encode()` 对所有 int 字段返回 string 类型。TypeScript 类型中这些字段声明为 `number | null` 后由 `Number()`/`parseInt()` 转换。

### 8.8 旧播放逻辑的清理

以下旧逻辑已由导演系统替代并移除：

| 函数/状态 | 替代方案 |
|----------|---------|
| `groupByEncounter` | `extractNpcPid` + `buildSegments` |
| `playBattleLogGroup` | `playScript` 逐段执行 |
| `buildPlayContext` | 后端 pre emit 已带名称/HP，导演 HpSnapshot 携带 from/to |
| `refreshContextFromApi` | `updateEnemyNameFromSegment` + `refreshEnemyLocation` |
| `rebuildInitialHpFromEntries` | `initHpFromSegment`（从首条 action entry 的 hpSnapshot 读） |
| `playContext` ref | 不再需要 |
| `extractEnemyPid` | `extractNpcPid` |
| `BattlePlayContext` 接口 | 由 DirectedEntry/HpSnapshot 替代 |
| `BATTLE_TEMPLATES` 按 action_id 索引 | `KIND_TEMPLATES` 按 directedKind 分发 |
| `renderBattleLogEntryHtml` | `renderDirectedEntryHtml` |

**保留的组件/逻辑**：
- `CollisionAnimation` + `DamageNumber`：动画和伤害数字组件保留，数据源改为 segment entries
- `BattleModal` sleep reject + 30s 超时兜底：保留
- NPC 回合轮询（`startNpcTurnRefresh`/`stopNpcTurnRefresh`）：保留
- `command-queue.ts` + `isProcessingBattle` 锁：保留

### 8.9 战斗事件 → 玩家小人意图接入

`battle.ts` 在播放流程中调用 `playerAvatarStore` 的 action 驱动玩家立绘动画，共 6 处接入点：

| 接入点 | 调用 | 触发时机 |
|--------|------|---------|
| `enterBattleMode` | `onBattleStart()` | 被动遭遇战（敌人发现玩家） |
| `startBattle` | `onBattleStart()` | 主动攻击 |
| `exitBattleMode` | `onBattleEnd()` | 战斗结束 |
| `playTurnSegment` | `onHit()` | 玩家受击（hpSnapshot 过滤：仅真实掉血触发） |
| `playTurnSegment` | `onDie()` | 玩家死亡主判定（combatant_cleared + reason='death'） |
| `playBattleEndSegment` | `onDie()` | 玩家死亡兜底判定（winnerPid !== currentPid） |

受击判定用 `hpSnapshot.targetHpAfter < targetHpBefore` 过滤未命中/0 伤害；死亡主判定用 `combatant_cleared` 条目实时触发（不等 battle_end 段），兜底判定用 `segment.meta.winnerPid` 补判。store 内 50ms 防抖 + isDown 状态机保证重复调用安全。

---

## 九、Composable 层

### 9.1 地图相关 composables

| Composable | 职责 | 关键导出 |
|-----------|------|---------|
| `useMapBusiness` | 地图业务编排 | `clickMove(areaId)`/`handleEnemyClick(enemy)`/`highlightCell(areaId)`/`setupMapCallbacks()` |
| `useMapInteraction` | 地图交互（缩放/平移/键盘/触摸） | `initMapInteraction(container, grid)`/`centerOnPlayer()`/`showPathPreview()`/`setInteractionCallbacks()` |
| `useMapReachability` | BFS 可达性 + 寻路 | `computeReachableMap()`/`isReachable(pls)`/`findPath(from, to)`/`getDirectionArrow()` |
| `useMapRender` | 地图 DOM 渲染 | `renderMapGrid(grid, container)`/`applyZoom(level, grid, container)`/`setRenderCallbacks()` |
| `useMapZoom` | 缩放状态 | `getZoomLevel()`/`setZoomLevel()` |

**回调注入模式**（避免循环依赖）：
- `useMapBusiness.setupMapCallbacks()` 调用 `setRenderCallbacks()` 和 `setInteractionCallbacks()` 注入业务回调
- `useMapInteraction` 通过 `_onKeyMove` 回调触发 `useMapBusiness.clickMove`

### 9.2 实体动画层（useMapEntities）

`useMapEntities(gridRef)` 是多实体动画 composable，替代旧的 `useActors`（已删除）和 `usePlayerAvatar`（已删除）。管理所有地图实体（actor/poi/grass/crevice/worm）的 DOM 引用、位置同步、z-index 更新、GSAP 动画、意图派发。

**三层职责**：
- **位置同步**（`syncEntityPosition`）：用 `offsetLeft/offsetTop` 累加计算 cell 相对 grid 偏移，同时设实体 `width/height` 等于 cell 尺寸 × 跨度（让 `.entity-img` 的 `height` 生效）
- **z-index 更新**（`updateEntityZIndex`）：基于 `isDown` 状态切换 z-index（阶段 1 硬编码 -1/10，阶段 2 将改用 Y 排序动态计算）
- **GSAP 动画**：`resetTransform`/`setDown`/`startIdle`/`popUp`/`fall`，参数沿用旧 usePlayerAvatar

**关键设计**：
- `resetTransform`/`setDown` 不动 `x/y/xPercent/yPercent/width/height`（位置由 `syncActorPosition` 管，避免被动画覆盖）
- 角色投影由 `.entity-img` 的 CSS `filter: drop-shadow(0 4px 4px rgba(0,0,0,0.6))` 提供，跟随立绘形状，无需独立阴影元素
- `notifyUp` 挂在回弹 tween 的 `onComplete`（非 timeline.onComplete，因末尾 idle `repeat:-1` 会导致 timeline 永不完成）
- `watch(intentSeq)` 而非 `watch(intent)`：连续移动（intent 都是 'move'）时 intentSeq 递增确保每次都触发

**位置同步的三路 watch**：

| 触发场景 | 机制 | 说明 |
|---------|------|------|
| 缩放 / resize | `ResizeObserver` 监听 `#mapGrid` 尺寸变化 | `watch(gridRef)` 创建/清理 observer，回调用 `requestAnimationFrame` 同步 |
| 移动（curLoc 变化） | `watch(mapStore.curLoc)` | 先 `syncAllPositions` 再 `playerAvatarStore.onMove()` |
| 实体列表变化 | `watch(entitiesStore.entities)` | 初始挂载 / 区域切换 |

**关键导出**：`setEntityRef(id, el)` / `syncAllPositions()` / `dispose()`

### 9.3 其他 composables

| Composable | 职责 |
|-----------|------|
| `useLogScroll` | 日志自动滚动 + 未读计数（监听 `log:force-scroll`/`log:add-unread` 事件） |
| `useToastPosition` | Toast 位置响应式计算（`isAnyOverlayOpen()`/`toastPositionClass`） |
| `useDebugBus` | DebugBus 单例（`?debug=ai` 时收集事件流供调试） |

### 9.4 useToastPosition 位置规则

Toast 位置根据 2 级页面开关状态响应式计算：

| 状态 | 位置类 | 说明 |
|------|--------|------|
| 无 2 级页面 / 左抽屉开 | `''`（默认右上角） | — |
| 右抽屉开 | `'pos-left'`（左上角） | 避免被右抽屉遮挡 |
| 任何模态框开（通用/POI/ground） | `'pos-center'`（中上） | 避免被模态框遮挡 |

优先级：模态框 > 右抽屉 > 左抽屉/默认。

`isAnyOverlayOpen()` 检查范围：`uiStore.modalOpen` + `uiStore.inventoryDrawerOpen` + `uiStore.playerDrawerOpen` + `tileActionStore.modalOpen`。

### 9.5 itm0 状态管理与 Itm0Modal

itm0 是后端 `itempara[0]` 缓存槽（新增道具中转槽，详见 [oblivions/DESIGN.md §2.24](../../oblivions/DESIGN.md#224-itm0-缓存槽与事件解耦)）。前端通过 `inventoryStore` + `Itm0Modal` 协同处理 itm0 状态。

**数据来源**：`inventoryStore.inventoryData.itempara[0]`——后端返回的 itempara JSON 数组 index 0 即 itm0。非空表示玩家"手持"道具，必须处理（整理入背包或丢弃）才能继续游戏行为。

**Itm0Modal 组件**（`components/inventory/Itm0Modal.vue`）：
- **全局挂载**：在 `App.vue` 中 `<Itm0Modal />`，不受路由/抽屉开关影响
- **持续显示**：itm0 非空时模态框持续显示，玩家无法关闭（无关闭按钮，点击遮罩无效）
- **强制处理**：玩家必须点击"整理背包"或"丢弃"按钮处理 itm0 内容，模态框才会消失
- **设计理由**：避免"假关闭"误导，强制玩家正面处理遗留道具，防止数据丢失

**itm0 锁定时的命令限制**：
- 后端 router 层拦截：itm0 非空时只放行 `obl_organize` / `obl_discard`，其他命令 emit `system.itm0_pending`
- 前端 Itm0Modal 持续显示：玩家在模态框内只能选择整理或丢弃，无法进行其他操作
- `inventoryStore.handleOrganize()`：调用 `obl_organize` 命令，成功后 itm0 清空 → 模态框消失

### 9.6 Toast 即时反馈机制

Toast 是日志事件的即时反馈层，解决 2 级页面（模态框）遮挡日志区的问题。设计约束详见 [oblivions/DESIGN.md §1.9](../../oblivions/DESIGN.md#19-结构化日志--前端-toast-强化提醒)。

**触发条件**：仅当 `isAnyOverlayOpen()` 为 true（2 级页面打开，日志区被遮挡）时，`logStore.refreshLog()` 才触发 Toast。日志区可见时不触发 Toast（避免冗余反馈）。

**TOAST_RULES 白名单**（`stores/log.ts`）：仅特定事件 ID 触发 Toast，不在白名单的事件仅日志区呈现：

```typescript
export const TOAST_RULES: Record<string, { style: ToastStyle }> = {
  'pickup.bag_full': { style: 'error' },
  'pickup.success': { style: 'success' },
  'pickup.not_found': { style: 'error' },
  'item.to_bag': { style: 'success' },
  'search.result': { style: 'success' },
  'search.already_searched': { style: 'error' },
  'discard.success': { style: 'success' },
};
```

**HIDDEN_LOG_IDS 黑名单**（`components/log/LogPanel.vue`）：某些事件仅触发 Toast / 模态框，不在日志面板渲染：

```typescript
const HIDDEN_LOG_IDS = new Set<string>(['pickup.success', 'organize.fail', 'system.itm0_pending']);
```

- `pickup.success`：瞬时"捡起"动作，Toast 已反馈，日志区由 `item.to_bag` 记录结果
- `organize.fail`：背包满时 Itm0Modal 持续显示，日志区不必重复
- `system.itm0_pending`：itm0 锁定时 router 拒绝命令的提示，Itm0Modal 已持续显示

**批量合并**（`logStore.refreshLog()` 内）：多条同类事件合并为单条 Toast 避免刷屏：

**拾取成功场景**（`pickup.success` + `item.to_bag` 同时存在且无 `organize.fail`）：双 Toast 几乎同时弹出，合并为单条更清晰：
```typescript
const shouldMergePickupToBag = hasPickupSuccess && toBagEntries.length > 0 && !hasOrganizeFail;
if (shouldMergePickupToBag) {
  // 单道具："捡起了 xxx，放入了背包。"  批量："捡起了 N 件道具，放入了背包。"
  const mergedContent = renderPickupToBagMerged(itemId, toBagEntries.length);
  toastStore.showToast(mergedContent, 'success', 2000, true, 'pickup.to_bag');
}
```

**非拾取场景**（合成 / 手动整理 / 近视揭示）：`item.to_bag` 多条批量合并：
```typescript
const content = toBagEntries.length > 1
  ? `把<span class="yellow">${toBagEntries.length}</span>件道具放进了背包。`
  : renderLogEntry(entry);
toastStore.showToast(content, rule.style, 2000, true, 'item.to_bag');
```

- 拾取成功合并用固定 mergeId `'pickup.to_bag'`，首个触发后续跳过
- 非拾取场景 `item.to_bag` 用固定 mergeId `'item.to_bag'`
- 拾取背包满场景（有 `organize.fail`）不合并，`pickup.success` 正常 Toast"捡起了 xxx"

**Toast 合并机制**（`stores/toast.ts`）：相邻同 mergeId + 同 type 的 Toast 合并显示（count++，显示 ×N），避免短时间内同类 Toast 刷屏。

---

## 十、组件层

### 10.1 组件树

```
App.vue
├── StatusBar.vue                    # 顶部状态栏（HP/SP/AP + 位置 + tick）
├── main
│   ├── LeftPanel.vue
│   │   └── MapContainer.vue
│   │       ├── MapGrid.vue          # v-for 渲染地图格 + 实体层（entities v-for）+ 迷雾
│   │       │   └── （角色层 .actor × N 与 .map-cell × N 同级，详见 §10.3）
│   │       ├── CollisionAnimation.vue  # 战斗碰撞动画（监听 battle:play-collision）
│   │       ├── DamageNumber.vue     # 残留伤害数字（监听 battle:play-damage-numbers）
│   │       └── 缩放控件 + 立绘调试按钮（弹/倒，直调 playerAvatarStore）
│   └── RightPanel.vue
│       ├── LogPanel.vue             # 日志面板
│       │   ├── LogEntry.vue
│       │   └── LogUnreadBtn.vue
│       └── TileActionBar.vue        # 探索模式动作条
│           └── ExploreButton.vue
├── Modal.vue                        # 通用模态框（Teleport to body）
├── PlayerDrawer.vue                 # 左抽屉（玩家属性详情）
├── InventoryDrawer.vue              # 右抽屉（背包 + 装备标签）
│   ├── InventoryList.vue
│   └── EquipmentList.vue
├── Itm0Modal.vue                    # itm0 手持道具模态框（全局挂载，itm0 非空时持续显示）
├── ToastContainer.vue               # Toast 容器
└── BattleModal.vue                  # 战斗演出模态框（Teleport to body，监听 battleModalOpen）

# 战斗模式下 RightPanel 切换为：
RightPanel.vue (battle mode)
├── BattleHeader.vue                 # 敌人名称 + 位置
├── BattleActionBar.vue              # 战斗动作条
│   └── PreloadArea.vue              # 装填区（技能列表 + AP 条 + 队列）
│       └── AimMode.vue              # 瞄准模式（选目标技能）
```

### 10.2 组件通信模式

1. **Store 驱动**：组件读取 store 的 ref/computed 响应式渲染，调用 store action 触发业务
2. **事件触发动画**：store `broadcast` 事件 → 组件 `listen` 后执行 DOM 动画（如 `CollisionAnimation`）
3. **Teleport to body**：模态框类组件（`Modal`/`BattleModal`）使用 `<Teleport to="body">` 避免 `position: fixed` 与父级 `transform` 冲突
4. **watch store 触发**：`BattleModal` 通过 `watch(() => battleStore.battleModalOpen)` 触发播放；`useMapEntities` 通过 `watch(() => playerAvatarStore.intentSeq)` 派发动画

### 10.3 实体层（多实体动画架构）

玩家立绘（及未来 NPC/敌怪/POI/草丛/蠕虫/裂隙）独立为 `#mapGrid` 内与 `.map-cell` 同级的实体层，通过 GSAP 实现标靶式弹起/倒下/呼吸动画。架构采用事件源 → 意图层 → 动画层 → DOM 层四层解耦。

**四层架构**：

```
事件源层（battle.ts / MapGrid.vue / 调试按钮）
    ↓ 调用 playerAvatarStore.onXxx()
意图层（playerAvatarStore：intent/intentSeq/isDown/pendingIntent）
    ↓ intentSeq 变化
动画层（useMapEntities composable）
    ↓ watch(intentSeq) 派发动画 + watch(curLoc/entities) + ResizeObserver 同步位置
DOM 层（#mapGrid > .entity × N，与 .map-cell × N 同级）
```

**数据层**（`entitiesStore`）：
- `entities` computed 从 `mapStore` 派生：当前格存在时生成 `player` actor（`{id:'player', kind:'actor', actorKind:'player', pls:curLoc, img:'/img/4.png', imgHeightRatio:1.5}`）
- **不依赖 `playerAvatarStore.isDown`**：避免 isDown 变化触发 entities 重算 → watch(entities) → syncAllPositions（多余）
- 敌人/NPC/POI/草丛/蠕虫/裂隙预留（代码注释，未来取消注释即可启用）

**DOM 层**（`MapGrid.vue`）：
- `.entity` 与 `.map-cell` 同为 `#mapGrid` 直接子元素，`position:absolute` 脱离 grid 流
- `:class="`entity-${entity.kind}`"` 按实体类型添加 class（如 `entity-actor`）
- z-index 由 JS 通过 `el.style.zIndex` 动态设置（删除原 `:class="{ popped: ... }"` 绑定）
- `:ref` 用函数形式绑定到 `setEntityRef`，收集实体 DOM 引用
- `.entity-img`（`<img>`）是 `.entity` 子元素，`height` 由 `imgStyle()` 动态绑定（`imgHeightRatio × 100%`，actor=150%）

**位置同步**（`useMapEntities.syncEntityPosition`）：
- 算法与 `centerOnPlayer` 一致：用 `offsetLeft/offsetTop` 累加计算 cell 相对 grid 偏移
- 同时设实体 `width/height` 等于 cell 尺寸 × 跨度（`spanCols`/`spanRows`，默认 1），让 `.entity-img` 的 `height` 生效
- GSAP `x/y/xPercent:-50/yPercent:-100` 让实体中心底部对准锚点格底部中心
- 位置同步后立即调用 `updateEntityZIndex` 更新 z-index

**z-index 更新**（`useMapEntities.updateEntityZIndex`）：

| 状态 | z-index | 视觉 |
|------|---------|------|
| 倒下（setDown / fall 后） | -1 | 被 `.map-background`（z-index:0）遮挡 |
| 站立（popUp 回弹开始） | 10 | 浮出所有 cell 之上 |

- 阶段 1：硬编码 -1/10，与现状一致
- 阶段 2：将改用 `computeZIndex` 动态计算（Y 排序：`1000 + yZ*10 + tiebreaker`）
- 玩家 actor 的 `isDown` 从 `playerAvatarStore.isDown` 实时读取；NPC/敌人初版无 isDown 状态（视为 false）
- 切换时机：`popUp` 回弹 tween 的 `onStart` 设 `el.style.zIndex = 10`；`fall` 的 `timeline.onComplete` 设 `el.style.zIndex = -1`

**角色投影**：
- 由 `.entity-img` 的 CSS `filter: drop-shadow(...)` 提供，含白色描边（4 方向 1px 白色 drop-shadow）+ 黑色投影（`drop-shadow(0 4px 4px rgba(0,0,0,0.6))`）
- 投影跟随立绘形状，idle/popUp/fall 任何状态都自然显示，无需独立阴影元素
- 黑线稿角色在黑底地图上靠白色描边 + 黑色投影实现视觉分离

**GSAP 动画**（`useMapEntities`，仅 actor）：
- `resetTransform`：重置 scale/rotation/alpha（不动位置）
- `setDown`：扁平倒地状态（`scaleY:0.04, rotation:-90, alpha:0.25`）
- `startIdle`：呼吸循环（`scaleY:1.02, scaleX:0.99, yoyo, repeat:-1`）
- `popUp`：4 段 timeline（淡入 → 蓄力 → 回弹设 z-index:10 + `notifyUp` → idle 循环）
- `fall`：2 段 timeline（蓄力 → 倒下设 z-index:-1 + `notifyDown`）

**意图映射**（`INTENT_HANDLERS`，11 种意图）：
- `enter`/`popup` → `setDown + popUp`（先倒下再弹起）
- `move` → `resetTransform + startIdle`
- `die`/`fall` → `fall`
- `battle-start`/`battle-end`/`hit`/`low-hp`/`normal-hp`/`idle` → `startIdle`（预留扩展点，未来可替换为战斗姿态/flinch/低 HP 摇晃等）

**自动恢复**（`pendingIntent` 回调链）：
- 任何非 `die`/`fall` 意图触发时若 `isDown=true`：暂存 next 到 `pendingIntent`，只派发 `popup`
- `popUp` 回弹完成时 composable 调 `notifyUp()`，store 派发 `pendingIntent`
- 不使用 `setTimeout`，避免 `killTweensOf` 打断 popUp 动画

**调试按钮**：
- 位于 `MapContainer.vue` 缩放条左侧（`弹` / `倒` 两个按钮）
- 直接调用 `playerAvatarStore.debugPopUp()` / `debugFall()`，不走事件总线
- `StatusBar.vue` 的旧调试按钮已移除

**HP 危险接入**（`MapGrid.vue`）：
- `watch(() => playerStore.hp / playerStore.mhp)` 触发 `setHpRatio` + `onLowHp`（<30%）/ `onNormalHp`（≥30%）
- 当前 low-hp/normal-hp 映射 idle，未来可扩展低 HP 摇晃动画

相关实现文件：
- [src/composables/useMapEntities.ts](src/composables/useMapEntities.ts) — 动画层（DOM 引用 + 位置同步 + z-index 更新 + GSAP + 意图派发）
- [src/stores/entities.ts](src/stores/entities.ts) — 数据层（entities 列表 computed 派生，不依赖 isDown）
- [src/stores/player-avatar.ts](src/stores/player-avatar.ts) — 意图层（intent 状态机 + 自动恢复）
- [src/types/map-entity.ts](src/types/map-entity.ts) — MapEntity/EntityKind/EntityLayer/ActorKind 类型
- [src/types/player-avatar.ts](src/types/player-avatar.ts) — PlayerAvatarIntent 类型
- [src/components/map/MapGrid.vue](src/components/map/MapGrid.vue) — DOM 层（实体层 v-for + HP watch + imgStyle）
- [src/components/map/MapContainer.vue](src/components/map/MapContainer.vue) — 调试按钮
- [src/assets/styles/terminal.css](src/assets/styles/terminal.css) — `.entity` / `.entity-img` 样式 + z-index 层级变量
- [src/stores/battle.ts](src/stores/battle.ts) — 6 处事件接入（详见 §8.9）

> 设计案见 [docs/MAP_LAYER_SYSTEM.md](docs/MAP_LAYER_SYSTEM.md)（v2：多实体分层架构，含 Y 排序/多格实体/地面装饰层预留）。原设计案 [docs/ACTORS_LAYER_REFACTOR.md](docs/ACTORS_LAYER_REFACTOR.md) 已被取代（记录的 `.actor-shadow` 独立阴影元素已删除，角色投影改由立绘 img 的 `drop-shadow` 滤镜提供）。


---

## 十一、构建与部署

### 11.1 开发环境

```bash
cd vex-vue
npm install
npm run dev    # 启动 Vite dev server（端口 5174）
```

**Vite proxy 配置**（`vite.config.js`）：

开发环境通过 Vite proxy 转发 `/phpdts/*` 到后端 `http://127.0.0.1`，实现同源请求（与生产环境一致）。**关键优化**：使用 `http.Agent({ keepAlive: true, maxSockets: 10 })` 复用 TCP 连接，避免每请求重建连接（~300ms → ~5ms）。

```javascript
import http from 'node:http';
const proxyAgent = new http.Agent({ keepAlive: true, maxSockets: 10 });

server: {
  port: 5174,
  proxy: {
    '/phpdts/oblivions/api/command.php': { target: 'http://127.0.0.1', changeOrigin: true, agent: proxyAgent },
    '/phpdts/oblivions/api/heartbeat.php': { target: 'http://127.0.0.1', changeOrigin: true, agent: proxyAgent },
    '/phpdts/oblivions/api/state.php': { target: 'http://127.0.0.1', changeOrigin: true, agent: proxyAgent },
    '/phpdts/oblivions/mark_battle_log_played.php': { target: 'http://127.0.0.1', changeOrigin: true, agent: proxyAgent },
    '/phpdts/img/': { target: 'http://127.0.0.1', changeOrigin: true, agent: proxyAgent },
  },
}
```

### 11.2 生产构建

```bash
cd vex-vue
npm run build    # 输出到 dist/
```

**构建配置**：
- `base: '/phpdts/vex-vue/'`（生产部署路径）
- `manualChunks: { 'vue-vendor': ['vue', 'pinia'] }`（分离 Vue 运行时）
- `sourcemap: false`（不生成 sourcemap）
- `assetsDir: 'assets'`

**环境变量**（`.env.production`）：
```
VITE_API_BASE=/phpdts
VITE_DEBUG=false
```

### 11.3 部署流程

1. `npm run build` 生成 `dist/`
2. `dist/` 目录提交到 git（与后端一起部署）
3. 玩家访问 `game.php` → 重定向到 `vex-vue/dist/index.html`（由 [game.php:22-25](../game.php#L22-L25) 的 `header("Location: vex-vue/dist/index.html")` 实现）
4. 前端通过 `VITE_API_BASE=/phpdts` 发起同源请求

> **开发环境**：开发者手动启动 `npm run dev`（端口 5174）后直接访问 `http://localhost:5174`，不走 `game.php`。`game.php` 一刀切指向 `dist/`，仅服务生产环境。

### 11.4 性能调试工具

`src/utils/perf.ts` 提供性能分析工具（默认关闭）：

```typescript
import { perf } from '@/utils/perf';
perf.enable();  // 开启
perf.mark('label', 'category');
perf.span('label', 'category', () => { /* 同步 */ });
perf.spanAsync('label', 'category', async () => { /* 异步 */ });
perf.report();  // 输出报告
perf.clear();
```

在 `useMapBusiness.clickMove` 和 `mapStore.loadMap` 中已埋点，开启后可在控制台查看各阶段耗时。

---

## 十二、类型定义参考

### 12.1 API 响应类型（`types/api.ts`）

完整类型定义见 [src/types/api.ts](src/types/api.ts)。关键接口：

- `PlayerInfo` — 玩家信息（数值字段均为 string）
- `Enemy` — 敌人信息
- `GameMap` / `GameMapLinks` / `TileInfo` — 地图数据
- `TileActions` / `Poi` / `GroundItem` — 地图格交互
- `PlayerInventory` / `InventoryItem` — 背包
- `SkillList` / `Skill` — 技能列表
- `LogEntry` — 结构化日志（`ts` 为 number）
- `BattleLogEntry` — 战斗日志（所有数值字段为 string）
- `OblLogResponse` / `BattleLogResponse` / `EnemiesResponse` — 响应包装

### 12.2 实体层类型（`types/map-entity.ts` + `types/player-avatar.ts`）

- `EntityKind` — 地图实体类型联合（`'actor' | 'poi' | 'grass' | 'crevice' | 'worm'`）
- `EntityLayer` — 实体层级（`'ground-deco' | 'air-occluder' | 'y-sorted'`）
- `ActorKind` — actor 子类型联合（`'player' | 'npc' | 'enemy'`）
- `MapEntity` — 地图实体数据（`id` / `kind` / `pls` / `img` / `spanCols?` / `spanRows?` / `imgHeightRatio?` / `actorKind?`）
  - 注：`isDown` 不作为 MapEntity 字段，玩家 actor 的 isDown 在 `useMapEntities.updateEntityZIndex` 中实时从 `playerAvatarStore.isDown` 读取
- `PlayerAvatarIntent` — 玩家小人动画意图（11 种：`enter`/`move`/`battle-start`/`battle-end`/`hit`/`die`/`low-hp`/`normal-hp`/`popup`/`fall`/`idle`）

### 12.3 事件类型（`types/events.ts`）

- `AppEvent` — 语义事件名联合类型（17 个事件）
- `ToastEventData` / `MapClickCurrentEventData` / `BattleStartedEventData` 等 — 事件数据接口
- `PreloadInitEventData` — 装填区初始化事件（`mode: 'pre-battle' | 'in-battle'`）
- `PlayCollisionEventData` / `PlayDamageNumbersEventData` — 战斗演出事件
- `DebugBusEntry` / `DebugStateSnapshot` — DebugBus 调试类型

> 立绘调试按钮（`player:popup` / `player:fall`）已从事件类型中移除，改为直接调用 `playerAvatarStore.debugPopUp()` / `debugFall()`。

### 12.4 战斗模板分发（`data/battle-templates.ts`）

按 `directedKind` 分发的 7 种渲染函数定义在 `KIND_TEMPLATES` 映射中：
- `renderAction` — 动作条目（读 actor_name/target_name/effect_value，含 unarmed_strike 特殊渲染）
- `renderInitiative` — 先攻掷骰（纯数据，返回空字符串不由条目渲染）
- `renderFlee` — 逃跑成功
- `renderCombatantCleared` — 战斗者离场（读 cleared_name + reason）
- `renderBattleEnd` — 战斗终结（统一显示"战斗结束"，不区分胜负）
- `renderAmbushBattleEnd` — 突袭结束（读 ambusher_name + reason）
- `renderDisplay` — 其他事件（ap_recover/verify_failed/middle_check 等）

`BattlePlayContext` 已移除——模板所需名称/HP 直接从 entry 字段（`actor_name`/`target_name`/`cleared_name`/`ambusher_name`/`hpSnapshot`）读取，不再需要查 API 构建上下文。

---

## 十三、与旧 vex 前端的迁移对应

> 旧 vex 前端（`vex/`）已废弃，以下对应关系供理解迁移历史参考。

| 旧 vex 文件 | vex-vue 对应 |
|------------|-------------|
| `vex/js/app.js` | `App.vue` + `stores/ui.ts` |
| `vex/js/data.js` | `stores/map.ts`（mapData）+ `stores/player.ts` |
| `vex/js/data-manager.js` | `stores/data-manager.ts` |
| `vex/js/command-queue.js` | `stores/command-queue.ts` |
| `vex/js/map.js` | `stores/map.ts` + `composables/useMapBusiness.ts` |
| `vex/js/map-interaction.js` | `composables/useMapInteraction.ts` |
| `vex/js/map-reachability.js` | `composables/useMapReachability.ts` |
| `vex/js/tile-action.js` | `stores/tileAction.ts` + `components/actions/TileActionBar.vue` |
| `vex/js/inventory.js` | `stores/inventory.ts` + `components/inventory/*` |
| `vex/js/player.js` | `stores/player.ts` + `components/layout/StatusBar.vue` + `PlayerDrawer.vue` |
| `vex/js/log.js` | `stores/log.ts` + `components/log/*` + `composables/useLogScroll.ts` |
| `vex/js/toast-position.js` | `composables/useToastPosition.ts` |
| `vex/js/battle.js` | `stores/battle.ts` |
| —（新增） | `stores/battle-director.ts` |
| `vex/js/battle-render.js`（重构） | `data/battle-templates.ts` |
| `vex/js/battle-modal.js` | `components/battle/BattleModal.vue` |
| `vex/js/battle-animation.js` | `components/battle/CollisionAnimation.vue` + `DamageNumber.vue` |
| `vex/js/battle-render.js` | `data/battle-templates.ts` |
| `vex/js/battle-preload.js` | `components/battle/PreloadArea.vue` |
| `vex/js/utils.js` | `api/client.ts` + `utils/format.ts` |
| `vex/js/debug.js` | `composables/useDebugBus.ts` |
| `vex/data/log-templates.js` | `data/log-templates.ts` |
| `vex/data/terrain-desc.js` | `data/terrain-desc.ts` |
| `vex/css/terminal.css` | `assets/styles/terminal.css` |
| `vex/css/battle.css` | `assets/styles/battle.css` |
| `oblivions/mark_battle_log_played.php` | 零依赖接口，前端通过 `api/client.ts: markBattleLogPlayed` 调用（已从 vex/ 迁移至 oblivions/） |

> 玩家立绘动画最初在 `MapGrid.vue` 内联 GSAP 实现（单 actor + StatusBar 调试按钮 + `player:popup`/`player:fall` 事件），后经三次重构：
> 1. 抽离为 `usePlayerAvatar` composable + `playerAvatarStore`（单 actor 架构）
> 2. 重构为 `useActors` + `actorsStore` 的多角色层架构（立绘迁出 cell，独立为 `#mapGrid` 内与 cells 同级的角色层）
> 3. 重构为 `useMapEntities` + `entitiesStore` 的多实体分层架构（泛化支持 actor/poi/grass/crevice/worm，z-index 全部由 JS 控制，删除 `.actor.popped` CSS 类，引入 z-index 层级变量与 Y 排序预留）
>
> `usePlayerAvatar.ts` / `useActors.ts` / `actors.ts` / `actor.ts` 均已删除，`player:popup`/`player:fall` 事件已从 `events.ts` 移除。设计案见 [docs/MAP_LAYER_SYSTEM.md](docs/MAP_LAYER_SYSTEM.md)。

---

## 近期变更：Oblivions JSON Command API 前端接入（2026-07-08）

Oblivions 写操作已切换到独立 JSON Command API：

```txt
vex-vue commandQueue.execute(envelope)
  -> src/api/obl-command.ts sendOblCommand()
  -> POST /phpdts/oblivions/api/command.php
```

新增文件：

| 文件 | 职责 |
|---|---|
| `src/api/obl-command.ts` | 发送 JSON command envelope，解析后端统一响应，并适配为旧 `CommandResult` |

`src/api/client.ts` 中的旧 `submitCommand()` 仍存在，但 Oblivions 新写操作不应再调用它。

### commandQueue 入参

现在使用结构化 envelope：

```ts
commandQueue.execute({
  command: 'battle.submit_turn',
  payload: {
    actions: [
      { act_id: 'unarmed_strike', target: 101, params: {} },
    ],
  },
  expected: {
    action: 'battle',
    battle_state: 'PLAYER_TURN',
  },
});
```

战斗动作队列直接作为 JSON 数组提交，不再 `JSON.stringify(actions)` 塞入表单字段。

### 新命令名

| 场景 | 命令 |
|---|---|
| 移动 | `map.move` |
| 探索 | `map.explore` |
| 搜索 POI | `poi.search` |
| 拾取 | `item.pickup` |
| 丢弃 | `item.discard` |
| 使用道具 | `item.use` |
| 整理背包 | `inventory.organize` |
| 合成 | `craft.execute` |
| 战斗开始 | `battle.start` |
| 提交玩家回合 | `battle.submit_turn` |

`src/stores/command-registry.ts` 已同步使用新命令名。`battle.start` 的 `mode: 'battle'` 是前端预战斗装填 UI 语义；后端玩家 `action` 此时仍是普通探索状态。

