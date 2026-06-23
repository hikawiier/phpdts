# Vex 前端 Vue 3 + Vite 迁移计划

> 将当前原生 ES Modules + Tailwind CSS 的 Vex 前端过渡到 Vue 3 + Vite 框架。
> 后端 Oblivions 保持不变，仅做必要的前端兼容性调整。
>
> **核心原则**：文档与代码不一致时，以代码为准。迁移过程中必须先核对实际实现再设计映射。

---

## 一、当前前端实现全面评估

### 1.1 技术栈现状

| 维度 | 现状 | 备注 |
|------|------|------|
| 框架 | 无框架，原生 ES Modules | 23 个 JS 文件，全部 `import`/`export` |
| 构建 | 仅 Tailwind CSS v4 编译（`npm run dev`/`build`） | JS 无构建步骤，浏览器直接加载 |
| 样式 | Tailwind v4 + 自定义 CSS（terminal.css + battle.css） | 三层样式架构 |
| 字体 | IBM Plex Mono（Google Fonts CDN） | 等宽字体，终端风格 |
| HTTP | 原生 fetch API | Cookie 认证（`credentials: include`） |
| 路由 | 无路由，单页 + DOM 显隐切换 | `#normalMode` / `#battleMode` |
| 状态管理 | 单例对象 + 模块内变量 | 无响应式系统 |
| 部署 | 纯静态文件，`vex/index.html` 直接打开 | `.htaccess` 仅设置缓存头 |

### 1.2 模块层级与依赖图（实际代码核对后）

```
app.js（入口：全局事件绑定 + 抽屉/模态框管理 + loadAll 编排）
  │
  ├── 数据层
  │   ├── data.js              全局状态：mapData / DebugBus / BASE_URL / GENDER_NAMES / updateMapData()
  │   ├── data-manager.js      单例：白名单缓存 + 去重 + 语义事件广播（broadcast/listen）
  │   ├── command-queue.js     单例：HTTP 请求锁 + 冷却（execute）
  │   └── utils.js             escapeHtml / gameApi / submitCommand / getPlaceName
  │
  ├── 地图系统（4 文件，已拆分）
  │   ├── map.js                业务编排：loadMap / clickMove / handleEnemyClick / 事件协调
  │   ├── map-render.js         渲染层：renderMapGrid + 缩放/居中
  │   ├── map-interaction.js    交互层：拖拽/键盘/点击 + 路径预览
  │   └── map-reachability.js   算法层：BFS findPath
  │
  ├── 战斗系统（6 文件）
  │   ├── battle.js             状态机：normal/battle + battlelog 拉取/分组/播放/标记 + NPC 回合自动刷新
  │   ├── battle-preload.js     装填区：技能列表 + AP 队列 + 瞄准模式 + 提交 obl_battle_start/action
  │   ├── battle-aim.js         瞄准模式：地图选目标 + SVG 路径线
  │   ├── battle-modal.js       战斗模态框：打字机播放 + 自动关闭
  │   ├── battle-animation.js   碰撞动画：冲刺 + 抖动 + 残留伤害数字
  │   └── battle-render.js     渲染：BattleLogEntry → HTML + 动作按钮 + 等待提示
  │
  ├── 面板模块
  │   ├── tile-action.js        地格交互：探索/搜索/拾取 + 居中模态框 + Toast
  │   ├── inventory.js          背包 + 装备渲染 + 丢弃（右侧抽屉）
  │   ├── player.js             玩家信息（左侧抽屉）+ 状态栏渲染
  │   └── log.js                日志：结构化渲染 + 增量检测 + Toast 触发 + 未读提示
  │
  ├── 辅助模块
  │   ├── toast.js              Toast 显示 + 同类合并
  │   ├── toast-position.js     Toast 位置管理：isAnyOverlayOpen + updateToastPosition
  │   └── debug.js              AI 调试（仅 ?debug=ai 时动态加载，非模块脚本）
  │
  └── 数据模板（data/ 目录）
      ├── log-templates.js      结构化日志模板（40 个 ID）+ renderLogEntry
      ├── skill-templates.js    技能显示模板（unarmed_strike / escape）
      ├── battle-templates.js   战斗渲染模板
      └── terrain-desc.js       地形描述词库 + generateTerrainDesc
```

### 1.3 状态管理模式

**无响应式系统**，三层状态：

| 层 | 实现 | 特征 |
|----|------|------|
| 全局可变单例 | `mapData`（data.js 导出） | 直接 `Object.assign` 修改，无变更通知 |
| 数据缓存层 | `DataManager` 单例 | 白名单 TTL 缓存 + `_pending` 去重 + 语义事件广播 |
| 模块内部状态 | 各模块 `let` 变量 | 如 battle.js 的 `currentMode`/`currentEnemyPid`/`isPlayingBattleLog` |

**事件通信**：`dataManager.broadcast(event, data)` / `dataManager.listen(event, cb)`，独立于 API action。

**实际事件清单（代码核对后）**：

| 事件 | 触发者 | 订阅者 | 文档状态 |
|------|--------|--------|----------|
| `map:loaded` | map.js | inventory, tile-action, log, battle-aim | 已记录 |
| `game:action-completed` | map.js, tile-action.js, inventory.js, battle.js | inventory, tile-action, log, player, battle | 已记录 |
| `map:click-current` | map.js | tile-action.js | 已记录 |
| `ui:toast` | 各模块 | tile-action.js | 已记录 |
| `battle:ended` | battle.js | map.js, battle-aim.js | 已记录 |
| `battle:started` | battle.js | app.js（更新战斗按钮文字） | **未记录** |
| `battle:aim-mode` | battle-preload.js | app.js, battle-aim.js | **未记录** |
| `battle:aim-exit` | battle-preload.js | app.js, battle-aim.js | **未记录** |
| `preload:executed` | battle-preload.js | battle.js | **未记录** |

### 1.4 路由配置

**无前端路由**。模式切换通过 DOM `display` 显隐：

- `#normalMode`（探索模式：CHRONICLE 日志 + ACTIONS 动作条）
- `#battleMode`（战斗模式：COMBAT 动作区，无日志区）
- `showBattleMode()` / `showNormalMode()` 直接操作 `style.display`

**抽屉/模态框**：通过 CSS class `open` 控制 transform 动画，无路由。

### 1.5 API 集成方法

**只读 API**（GET `api_v2.php?action=xxx`，代码核对后共 9 个端点）：

| action | 消费模块 | 文档状态 |
|--------|---------|----------|
| `game_map` | map.js | 已记录 |
| `tile_actions` | tile-action.js | 已记录 |
| `player_inventory` | inventory.js | 已记录 |
| `player_info` | player.js, battle.js | 已记录 |
| `obl_log` | log.js | 已记录 |
| `battle_log` | battle.js | 已记录 |
| `enemies` | map.js, battle.js | 已记录 |
| `skill_list` | battle-preload.js | **未记录** |
| `ai_dump_save` | debug.js | 已记录 |

**写入 API**（POST `command.php`）：

| 命令 | 实际参数 | 文档参数 | 差异 |
|------|---------|---------|------|
| `obl_explore` | 无 | 无 | 一致 |
| `obl_search` | `iaid` | `iaid` | 一致 |
| `obl_pickup` | `iid` | `iid` | 一致 |
| `obl_discard` | `slot` | `slot` | 一致 |
| `move` | `moveto` | `moveto` | 一致 |
| `obl_battle_start` | `enemy_pid` + `actions`（JSON 数组） | `enemy_pid` | **代码多了 actions** |
| `obl_battle_action` | `action_id` + `target_pid` + `actions`（JSON 数组） | `action_id` | **代码多了 target_pid + actions** |

**零依赖接口**：POST `vex/mark_battle_log_played.php`（`groomid`/`pid`/`log_ids`）。

### 1.6 第三方依赖项

**package.json 实际依赖**：

```json
{
  "devDependencies": {
    "@tailwindcss/cli": "^4",
    "tailwindcss": "^4"
  }
}
```

**无运行时 JS 依赖**。外部资源：
- Google Fonts（IBM Plex Mono）
- 后端 PHP（api_v2.php / command.php / mark_battle_log_played.php）

### 1.7 CSS 架构

| 层 | 文件 | 说明 |
|----|------|------|
| Tailwind 源 | `css/input.css` | `@theme` 色板（bg/fg-dim/fg-mid/fg-bright/fg-glow/hi/hi-dim）+ `@import "tailwindcss"` |
| Tailwind 编译 | `css/output.css` | 构建产物，勿手改 |
| 自定义 | `css/terminal.css` | CRT 特效、地图格、按钮、动画、日志类、状态栏、模态框、抽屉、Toast |
| 自定义 | `css/battle.css` | 战斗模态框、碰撞动画、伤害数字、回合光效、确认界面 |

**JS 动态生成的 CSS 类名**：使用语义短类名（`.map-cell` / `.term-btn` / `.slot-card` 等），不用 Tailwind 工具类。

---

## 二、文档与代码不一致清单（迁移前必须解决）

> **核心原则**：迁移过程中以代码为准，文档需同步更新。以下差异已通过实际代码核对确认。

### 2.1 未记录的模块

| 模块 | 实际职责 | CODEBASE.md 状态 |
|------|---------|------------------|
| `battle-aim.js` | 瞄准模式：地图选目标 + SVG 路径线 | 未列入模块依赖图 |
| `battle-preload.js` | 装填区：技能列表 + AP 队列 + 瞄准 + 提交命令 | 未列入模块依赖图 |

### 2.2 未记录的 API 端点

| 端点 | 用途 | CODEBASE.md 状态 |
|------|------|------------------|
| `skill_list` | 返回技能列表 + 玩家 AP（供装填区） | 未列入 5.1 节只读 API 表 |

### 2.3 未记录的数据文件

| 文件 | 用途 | CODEBASE.md 状态 |
|------|------|------------------|
| `data/skill-templates.js` | 技能显示模板（name/desc/action_desc） | 未列入目录结构 |
| `data/battle-templates.js` | 战斗渲染模板 | 未列入目录结构 |

### 2.4 未记录的 DOM 元素

| ID | 用途 | CODEBASE.md 状态 |
|----|------|------------------|
| `#battleBtn` | 状态栏战斗按钮（normal/battle/aim 三态切换） | 未列入 7.5 DOM ID 索引 |
| `#tickDebug` | 状态栏 tick 调试显示 | 未列入 |
| `#preloadSkillList` | 装填区技能列表容器 | 未列入 |
| `#preloadQueueArea` | 装填区队列容器 | 未列入 |
| `#preloadExecuteBtn` | 装填区执行按钮 | 未列入 |
| `#preloadClearBtn` | 装填区清空按钮 | 未列入 |

### 2.5 战斗状态机实际与文档不符

**文档描述**："normal/battle 两态，取消 prebattle 中间态"

**实际代码**：存在三个模式：
- `normal`（探索）
- `battle`（战斗中，含 `in-battle` 装填模式）
- `pre-battle`（玩家点击敌人后、`obl_battle_start` 提交前的装填阶段）

`battle-preload.js` 的 `initPreloadArea(mode, ...)` 接受 `'pre-battle'` 或 `'in-battle'` 两种模式。

### 2.6 BattleLogEntry 字段结构变化

**文档字段**：`enemy_pid`（int）用于前端按战斗分组

**实际代码**（`battle.js: groupByEncounter`）：使用 `actor_type`/`actor_pid`/`target_type`/`target_pid` 推导 NPC pid，并新增 `phase` 字段（`'excute'` 阶段才播放动画）。

### 2.7 未记录的后端表与函数

| 项 | 用途 | CODEBASE.md 状态 |
|----|------|------------------|
| `bra_oblqueue` 表 | 先攻队列存储（`oblqueue.sql`） | 仅在 sql 目录列出，未在第四章数据库表说明 |
| `obl_fetch_queue_all_by_qid()` | 查询先攻队列 | 未在 8.x 函数索引中 |
| `battle_queue` 字段 | `player_info` API 返回的先攻队列数据 | 未在 5.7 节说明 |

### 2.8 未记录的前端机制

| 机制 | 实际实现 | 文档状态 |
|------|---------|----------|
| NPC 回合自动刷新 | `npcTurnRefreshTimer` 每 2s 拉取 `player_info` 触发后端 common.inc 推进 NPC 行动 | 未记录 |
| 装填队列提交 | `obl_battle_start`/`obl_battle_action` 携带 `actions` JSON 数组（多动作队列） | 未记录 |
| 瞄准模式 | `battle:aim-mode` 事件 + 地图敌人格标记 + SVG 路径线 | 未记录 |
| `updateMapData()` | 集中修改 mapData，返回 `{ prevRegion }` 供区域切换判断 | 未记录 |
| `mapData.enemies` | data.js 中 mapData 已含 `enemies: []` 字段 | 未在 6.1 mapData 结构中记录 |

### 2.9 M0 验证发现的新不一致点

**API 响应状态值**：实际 API 返回 `status: 'success'`（非 `'ok'`）。迁移计划第六章 API 端点表未明确状态值，Vue 客户端需检查 `=== 'success'`。

**API 数值字段类型**：`player_info` 等端点返回的所有数值字段均为**字符串**（如 `"pid": "20"`、`"hp": "398"`），非数字。第五章 TypeScript 类型定义中 `PlayerInfo` 接口需将 `number` 改为 `string`（或在 store 层做类型转换）。

**未记录的 player_info 字段**：实际响应包含以下未在类型定义中的字段：
- `tacpara`：战术参数（含 `slots` 数组）
- `skillpara`：技能参数（含 `unarmed_strike.lstact` / `escape.lstact`）
- `obl_tick`：当前 tick 值
- `obl_pretick`：上一次 tick 值

### 2.10 M1 验证发现的新不一致点

**gameApi() 返回值结构**：现有 `vex/js/utils.js` 的 `gameApi()` 返回**完整响应对象** `{status, data, ...}`（通过 `apiRequest` 的 `return await response.json()`），而 M0 的 `client.ts` 返回提取后的 `json.data`。这导致 `data-manager.ts` 迁移时语义不一致（现有 `data-manager.js` 的 `fetch()` 返回完整响应对象，调用方用 `result.status`/`result.data` 访问）。

**修复方案**：M1 已调整 `client.ts` 的 `gameApi()` 返回完整响应对象（与现有 utils.js 一致），新增 `gameApiData()` 辅助函数供简单场景使用（提取 data 并检查 status）。

**submitCommand() 返回结构**：现有 `utils.js` 的 `submitCommand()` 返回 `{success, gamedata, redirect, timer, error, message}` 结构（含 P2 修复：`gamedata.error` 存在时不误判为成功）。M0 的 `client.ts` 只返回 `res.json()`。M1 已修复为与现有 utils.js 一致的结构。

**aiDumpSave() Content-Type**：现有 `debug.js` 使用 `Content-Type: text/plain`，M0 的 `client.ts` 使用 `application/x-ndjson`。M1 已修复为 `text/plain`（与现有 debug.js 一致）。

### 2.11 不一致解决流程（迁移期间持续执行）

```
迁移每个模块前：
  1. 读 CODEBASE.md 对应章节
  2. 读实际 JS 源码核对
  3. 发现差异 → 记录到本文件第二章
  4. 以代码为准设计 Vue 组件
  5. 迁移完成后同步更新 CODEBASE.md
```

**责任分配**：迁移负责人在每个里程碑结束时更新 CODEBASE.md，确保文档与代码一致。

---

## 三、Vue 3 + Vite 兼容性问题识别

### 3.1 架构层面兼容性问题

| 问题 | 现状 | Vue 3/Vite 要求 | 影响 |
|------|------|----------------|------|
| 无组件化 | 23 个 JS 模块直接操作 DOM | 组件树 + 模板 | 需重新划分组件边界 |
| 无响应式 | `mapData` 直接赋值 + `innerHTML` 重渲染 | `ref`/`reactive` + 模板自动更新 | 状态管理需重构 |
| 无虚拟 DOM | 每次操作 `innerHTML = ...` 全量替换 | diff + patch | 渲染策略变化 |
| 事件系统 | 自建 `dataManager.broadcast/listen` | 可保留，或改用 `mitt`/`provide+inject` | 需评估 |
| 全局状态 | 模块单例 + 模块内 `let` 变量 | Pinia store 或 `provide`/`inject` | 需引入状态管理库 |

### 3.2 模块层面兼容性问题

| 模块 | 问题 | 迁移难度 |
|------|------|---------|
| `map.js` 系列 | 渲染依赖 `innerHTML` 拼接 + `data-enemy-pid` 属性定位 + `getBoundingClientRect` 视口坐标 | 高（需重写为 Canvas/SVG 组件或保留命令式渲染） |
| `battle-animation.js` | `position: fixed` + 视口坐标附加到 `document.body` | 中（Vue 中需用 Teleport） |
| `battle-modal.js` | 打字机效果 + `setTimeout` 链 + 自动关闭 | 中（需用 `onMounted`/`onUnmounted` 管理定时器） |
| `battle-aim.js` | SVG 路径线 + `mousemove` 实时绘制 | 中（SVG 组件 + 事件绑定） |
| `toast.js` | 同类合并 + `dataset.timerId` + 动态位置 class | 低（Pinia store + 计算属性） |
| `log.js` | 增量检测 + 未读计数 + 滚动监听 | 中（需保留命令式滚动逻辑） |
| `debug.js` | 非模块脚本，`window.__vex_debug_bus` 全局访问 | 低（改用动态 `import()`） |

### 3.3 CSS 兼容性问题

| 问题 | 现状 | Vue 3/Vite 方案 |
|------|------|----------------|
| Tailwind v4 + 自定义 CSS 混用 | `input.css` 编译 + `terminal.css`/`battle.css` 直接加载 | Vite 用 `@vitejs/plugin-vue` + `postcss` 处理 Tailwind；自定义 CSS 可保留或改 `<style scoped>` |
| JS 动态生成类名 | `innerHTML` 拼接中写 `class="map-cell reachable"` | Vue 模板中用 `:class` 绑定 |
| 主题色 token | `@theme` 定义在 `input.css` | 迁移到 `tailwind.config.js` 或保留 `@theme`（v4 支持） |

### 3.4 后端集成兼容性问题

| 问题 | 现状 | Vue 3/Vite 方案 |
|------|------|----------------|
| Cookie 认证 | `credentials: include` | 不变（同源部署） |
| CORS | `api_v2.php` 已处理同源 + `extra_origins` | 开发环境需配置 Vite proxy 或加入 `extra_origins` |
| `mark_battle_log_played.php` | 零依赖 PHP 文件，位于 vex/ | 保留原位（Vite 构建产物不影响 PHP） |
| `game.php` 重定向 | Oblivions 模式重定向到 `vex/index.html` | 改为重定向到 `vex/dist/index.html`（构建产物） |

### 3.5 部署兼容性问题

| 问题 | 现状 | Vue 3/Vite 方案 |
|------|------|----------------|
| 静态文件部署 | `vex/index.html` 直接打开 | 改为 `vex/dist/index.html`（构建产物） |
| `.htaccess` 缓存头 | 仅 js/css | 需扩展到构建产物的 hash 命名文件（长缓存） |
| 资源路径 | 相对路径 `css/output.css` | Vite 默认绝对路径，需配置 `base: './'` 或 `/phpdts/vex/` |

---

## 四、分阶段实施策略

### 4.1 里程碑总览

```
M0：准备与脚手架（基础设施）
  ↓
M1：数据层迁移（Pinia + API 封装）
  ↓
M2：核心页面骨架（布局 + 状态栏 + 路由）
  ↓
M3：地图系统迁移（最高风险，最高优先级）
  ↓
M4：探索交互迁移（tile-action + inventory + player）
  ↓
M5：日志与反馈迁移（log + toast）
  ↓
M6：战斗系统迁移（battle 系列 6 文件）
  ↓
M7：调试系统 + 收尾（debug + 文档同步 + 旧代码清理）
```

### 4.2 迁移优先级判定原则

| 优先级 | 判定标准 | 模块 |
|--------|---------|------|
| P0（最高） | 其他模块的基础依赖 | data / data-manager / utils / command-queue |
| P1（高） | 核心用户体验，不可降级 | map 系列 / player 状态栏 |
| P2（中） | 核心交互闭环 | tile-action / inventory / log |
| P3（中低） | 复杂但可独立 | battle 系列（含 preload/aim） |
| P4（低） | 辅助功能 | toast / debug |

### 4.3 各里程碑详细任务

#### M0：准备与脚手架

**目标**：建立 Vue 3 + Vite 项目骨架，不影响现有 vex/ 目录运行。

**任务**：
1. 在 `vex/` 同级创建 `vex-vue/` 目录（并行开发，不破坏现有）
2. 初始化 Vite + Vue 3 项目：`npm create vite@latest vex-vue -- --template vue`
3. 安装核心依赖：
   - `vue@^3.5`
   - `pinia@^2`（状态管理）
   - `vue-router@^4`（未来多页扩展，当前单页也用）
   - `@vueuse/core`（工具集，可选）
   - `axios`（可选，或继续用 fetch）
4. 配置 Tailwind CSS v4（参考 oblivions/editor/vite.config.js）
5. 配置 Vite proxy：`/phpdts/api_v2.php` → `http://localhost`
6. 迁移 `css/input.css` 主题色板
7. 建立目录结构（见 5.3）
8. 验证 `npm run dev` 可启动 + 能访问后端 API

**验收标准**：空白 Vue 页面能通过 proxy 拉取 `player_info` 并打印 JSON。

#### M1：数据层迁移

**目标**：建立 Pinia stores + API 封装，替代 data.js / data-manager.js / utils.js。

**任务**：
1. 创建 `src/api/client.ts`：封装 `gameApi(action)` / `submitCommand(params)` / `markBattleLogPlayed()`
2. 创建 `src/stores/map.ts`：替代 `mapData` + `updateMapData()`，用 `reactive` 实现响应式
3. 创建 `src/stores/data-manager.ts`：替代 `DataManager` 单例
   - 保留白名单 TTL 缓存 + `_pending` 去重
   - 语义事件广播改用 `mitt` 或 Pinia 的 `$subscribe`
4. 创建 `src/stores/command-queue.ts`：替代 `CommandQueue` 单例
5. 创建 `src/stores/battle.ts`：替代 battle.js 内部状态（currentMode / currentEnemyPid / isPlayingBattleLog / npcTurnRefreshTimer）
6. 创建 `src/composables/useDebugBus.ts`：保留 DebugBus 极简事件总线

**验收标准**：Pinia stores 能拉取所有 9 个 API 端点数据，命令队列能提交并锁定。

#### M2：核心页面骨架

**目标**：搭建主布局 + 状态栏 + 模式切换框架。

**任务**：
1. 创建 `src/App.vue`：根布局（status-bar + main + 浮动组件 slot）
2. 创建 `src/components/layout/StatusBar.vue`：状态栏（区域/格名 + HP/SP 条 + [属性]/[战斗]/[背包] 按钮 + 头像）
3. 创建 `src/components/layout/LeftPanel.vue`：地图容器（占位）
4. 创建 `src/components/layout/RightPanel.vue`：日志 + 动作条容器（占位）
5. 创建 `src/components/layout/PlayerDrawer.vue`：左侧抽屉（占位）
6. 创建 `src/components/layout/InventoryDrawer.vue`：右侧抽屉（占位）
7. 创建 `src/components/layout/Modal.vue`：居中模态框（通用）
8. 创建 `src/components/layout/ToastContainer.vue`：Toast 容器
9. 实现模式切换：`normalMode` / `battleMode` 用 `v-if` 替代 `display:none`
10. 实现全局键盘快捷键（ESC/i/p）

**验收标准**：页面布局与现有 vex 视觉一致，抽屉/模态框开关正常。

#### M3：地图系统迁移（P1，最高风险）

**目标**：迁移 map.js 系列 4 文件 + 地图渲染。

**风险**：地图渲染依赖大量 DOM 操作（`innerHTML` 拼接 + `data-enemy-pid` 属性 + `getBoundingClientRect`），直接 Vue 匝始化成本高。

**策略**：**渐进式迁移**——先用 Vue 组件包裹现有命令式渲染逻辑，后续再逐步 Vue 化。

**任务**：
1. 创建 `src/components/map/MapContainer.vue`：地图容器（缩放/平移/居中）
2. 创建 `src/components/map/MapGrid.vue`：地图网格
   - **阶段 A**：保留 `innerHTML` 命令式渲染，用 `ref` 挂载后调用现有 `renderMapGrid()`
   - **阶段 B**（后续优化）：重写为 `v-for` + 响应式 cell 数据
3. 创建 `src/composables/useMapInteraction.ts`：迁移 map-interaction.js（拖拽/键盘/点击）
4. 创建 `src/composables/useMapReachability.ts`：迁移 map-reachability.js（BFS findPath）
5. 创建 `src/composables/useMapZoom.ts`：缩放/居中逻辑
6. 迁移 `loadMap()` 到 `src/stores/map.ts` 的 action
7. 迁移 `clickMove()` / `handleEnemyClick()` 到组件方法
8. 迁移敌人渲染（`data-enemy-pid` 属性 + HP 条）

**验收标准**：地图能渲染、缩放、平移、点击移动、敌人显示，视觉与现有一致。

#### M4：探索交互迁移（P2）

**目标**：迁移 tile-action.js + inventory.js + player.js。

**任务**：
1. 创建 `src/components/actions/TileActionBar.vue`：探索模式动作条（POI + 脚边道具 2 列网格）
2. 创建 `src/components/actions/ExploreButton.vue`：探索按钮
3. 创建 `src/components/inventory/InventoryList.vue`：背包列表
4. 创建 `src/components/inventory/EquipmentList.vue`：装备列表
5. 创建 `src/components/inventory/InventoryDrawer.vue`：右侧抽屉（标签切换）
6. 创建 `src/components/player/PlayerDrawer.vue`：左侧抽屉（属性详情）
7. 创建 `src/components/player/PlayerInfo.vue`：属性进度条 + 数值
8. 迁移 `loadTileAction()` / `loadInventory()` / `loadPlayerInfo()` 到 stores
9. 迁移 `showToast()` 到 `src/stores/toast.ts`

**验收标准**：探索/搜索/拾取/丢弃/移动全流程闭环，背包与装备显示正确。

#### M5：日志与反馈迁移（P2）

**目标**：迁移 log.js + toast.js + toast-position.js + 数据模板。

**任务**：
1. 迁移 `data/log-templates.js` → `src/data/log-templates.ts`（保留 `renderLogEntry`）
2. 迁移 `data/terrain-desc.js` → `src/data/terrain-desc.ts`
3. 创建 `src/components/log/LogPanel.vue`：日志容器
4. 创建 `src/components/log/LogEntry.vue`：单条日志（用 `v-html` 渲染 `renderLogEntry` 输出）
5. 创建 `src/components/log/LogUnreadBtn.vue`：未读提示按钮
6. 创建 `src/composables/useLogScroll.ts`：滚动监听 + 未读计数（保留命令式滚动逻辑）
7. 创建 `src/stores/toast.ts`：Toast 状态管理（同类合并 + 动态位置）
8. 创建 `src/components/feedback/ToastContainer.vue`：Toast 容器
9. 创建 `src/composables/useToastPosition.ts`：位置管理（`isAnyOverlayOpen` + `updateToastPosition`）

**验收标准**：日志增量检测 + Toast 触发 + 未读提示 + 同类合并 全部正常。

#### M6：战斗系统迁移（P3，最复杂）

**目标**：迁移 battle.js 系列 6 文件 + battle-aim.js + battle-preload.js。

**任务**：
1. 创建 `src/stores/battle.ts`：战斗状态机（normal/battle/pre-battle 三态）
   - `currentMode` / `currentEnemyPid` / `currentGroomid` / `currentPid`
   - `isPlayingBattleLog` / `isProcessingBattle`
   - `npcTurnRefreshTimer`（NPC 回合自动刷新）
2. 创建 `src/components/battle/BattleMode.vue`：战斗模式容器
3. 创建 `src/components/battle/BattleHeader.vue`：`vs [敌人名]` 标题
4. 创建 `src/components/battle/BattleActionBar.vue`：动作按钮区
5. 创建 `src/components/battle/BattleModal.vue`：战斗模态框（打字机 + 自动关闭）
   - 用 `<Teleport to="body">` 替代 `position: fixed` 视口坐标
6. 创建 `src/components/battle/CollisionAnimation.vue`：碰撞动画（冲刺 + 抖动）
7. 创建 `src/components/battle/DamageNumber.vue`：残留伤害数字
8. 创建 `src/components/battle/BattleConfirm.vue`：战斗确认界面
9. 创建 `src/components/battle/PreloadArea.vue`：装填区（技能列表 + AP 队列 + 执行）
   - 迁移 `data/skill-templates.js` → `src/data/skill-templates.ts`
   - 迁移 `data/battle-templates.js` → `src/data/battle-templates.ts`
10. 创建 `src/components/battle/AimMode.vue`：瞄准模式（SVG 路径线 + 地图选目标）
11. 迁移 `fetchAndPlayBattleLog()` / `playBattleLogGroup()` 到 store action
12. 迁移 `markBattleLogPlayed()` 到 API client
13. 迁移 NPC 回合自动刷新（`npcTurnRefreshTimer`）

**验收标准**：
- 玩家主动攻击 → 装填区 → 执行 → 碰撞动画 + 模态框 + 残留伤害数字 全流程
- NPC 回合自动刷新 + 玩家回合提示
- 遭遇战（tick 结算触发）正常进入战斗
- 战斗结束 → 退出 battle 模式 → 刷新地图

#### M7：调试系统 + 收尾

**目标**：迁移 debug.js + 同步文档 + 清理旧代码。

**任务**：
1. 创建 `src/composables/useDebugAi.ts`：迁移 debug.js
   - 改用动态 `import()` 替代 `document.createElement('script')`
   - 保留 `DebugBus` 订阅 + 批量写入 `ai_dump_save`
2. 更新 `vex/CODEBASE.md`：同步第二章列出的所有不一致
3. 更新 `oblivions/CODEBASE.md`：补充 `skill_list` API / `bra_oblqueue` 表 / `battle_queue` 字段
4. 更新 `game.php`：重定向到 `vex-vue/dist/index.html`
5. 配置生产构建：`npm run build` → `vex-vue/dist/`
6. 更新 `.htaccess`：构建产物缓存策略
7. 删除旧 `vex/js/` + `vex/index.html`（或保留作为 fallback）
8. 端到端测试：全流程回归

**验收标准**：生产构建部署成功，所有功能与原版一致或更优。

---

## 五、Vue 3 + Vite 项目技术规范

### 5.1 构建配置

**`vite.config.js`**：

```javascript
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite'; // Tailwind v4 Vite 插件

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  root: '.',
  base: '/phpdts/vex-vue/', // 部署路径
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          'vue-vendor': ['vue', 'vue-router', 'pinia'],
        },
      },
    },
  },
  server: {
    port: 5174, // 避开 oblivions/editor 的 5173
    proxy: {
      '/phpdts/api_v2.php': {
        target: 'http://localhost',
        changeOrigin: true,
      },
      '/phpdts/command.php': {
        target: 'http://localhost',
        changeOrigin: true,
      },
      '/phpdts/vex/mark_battle_log_played.php': {
        target: 'http://localhost',
        changeOrigin: true,
      },
    },
  },
});
```

### 5.2 环境变量

**`.env.development`**：

```
VITE_API_BASE=/phpdts
VITE_DEBUG=false
```

**`.env.production`**：

```
VITE_API_BASE=/phpdts
VITE_DEBUG=false
```

**使用方式**：

```javascript
const API_BASE = import.meta.env.VITE_API_BASE || '/phpdts';
```

### 5.3 目录结构

```
vex-vue/
├── public/
│   └── favicon.ico
├── src/
│   ├── api/
│   │   ├── client.ts          # gameApi / submitCommand / markBattleLogPlayed
│   │   └── endpoints.ts        # API action 常量 + 类型定义
│   ├── assets/
│   │   └── styles/
│   │       ├── input.css      # Tailwind 源（@theme 色板）
│   │       ├── terminal.css   # 自定义样式（CRT/地图格/按钮/动画）
│   │       └── battle.css     # 战斗样式
│   ├── components/
│   │   ├── layout/
│   │   │   ├── StatusBar.vue
│   │   │   ├── LeftPanel.vue
│   │   │   ├── RightPanel.vue
│   │   │   ├── PlayerDrawer.vue
│   │   │   ├── InventoryDrawer.vue
│   │   │   ├── Modal.vue
│   │   │   └── ToastContainer.vue
│   │   ├── map/
│   │   │   ├── MapContainer.vue
│   │   │   └── MapGrid.vue
│   │   ├── actions/
│   │   │   ├── TileActionBar.vue
│   │   │   └── ExploreButton.vue
│   │   ├── inventory/
│   │   │   ├── InventoryList.vue
│   │   │   └── EquipmentList.vue
│   │   ├── player/
│   │   │   └── PlayerInfo.vue
│   │   ├── log/
│   │   │   ├── LogPanel.vue
│   │   │   ├── LogEntry.vue
│   │   │   └── LogUnreadBtn.vue
│   │   ├── feedback/
│   │   │   └── Toast.vue
│   │   └── battle/
│   │       ├── BattleMode.vue
│   │       ├── BattleHeader.vue
│   │       ├── BattleActionBar.vue
│   │       ├── BattleModal.vue
│   │       ├── CollisionAnimation.vue
│   │       ├── DamageNumber.vue
│   │       ├── BattleConfirm.vue
│   │       ├── PreloadArea.vue
│   │       └── AimMode.vue
│   ├── composables/
│   │   ├── useDebugBus.ts
│   │   ├── useMapInteraction.ts
│   │   ├── useMapReachability.ts
│   │   ├── useMapZoom.ts
│   │   ├── useLogScroll.ts
│   │   └── useToastPosition.ts
│   ├── data/
│   │   ├── log-templates.ts
│   │   ├── skill-templates.ts
│   │   ├── battle-templates.ts
│   │   └── terrain-desc.ts
│   ├── stores/
│   │   ├── map.ts
│   │   ├── data-manager.ts
│   │   ├── command-queue.ts
│   │   ├── battle.ts
│   │   ├── toast.ts
│   │   └── player.ts
│   ├── types/
│   │   ├── api.ts             # LogEntry / BattleLogEntry / PlayerInfo / Enemy 等
│   │   └── events.ts          # 事件类型定义
│   ├── App.vue
│   ├── main.ts
│   └── router.ts
├── .env.development
├── .env.production
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.js
```

### 5.4 TypeScript 类型定义（关键接口）

```typescript
// src/types/api.ts

export interface LogEntry {
  id: string;              // {logcategory}.{subevent}
  logcategory: 'move'|'explore'|'search'|'pickup'|'discard'|'system'|'enemy'|'battle';
  params: Record<string, string|number|boolean>;
  html: string | null;
  debug: boolean;
  ts: number;
}

export interface BattleLogEntry {
  id: string;              // 'battle.action'
  log_id: number;
  turn: number;
  actor: string;           // 'player' | 'enemy_{pid}'
  actor_type: number;      // 0=玩家, >0=敌人类型（实际代码字段）
  actor_pid: number;
  target: string;
  target_type: number;
  target_pid: number;
  action_id: string;      // unarmed_strike / escape / battle.start / ...
  action_name: string;
  effect_value: number;
  extra: Record<string, any> | null;
  phase: string;          // 'excute' 等（实际代码字段，控制动画播放）
  played: number;
  ts: number;
}

export interface PlayerInfo {
  pid: number;
  type: number;
  name: string;
  gd: string;
  icon: string;
  groomid: number;
  action: '' | 'battle';
  bid: number;
  battle_queue: {
    qid: number;
    queue: Array<{
      pid: number;
      type: number;
      myorder: number;
      done: number;
    }>;
  } | null;
  hp: number; mhp: number;
  sp: number; msp: number;
  att: number; def: number;
  ap: number; max_ap: number;
  pgroup: number; pls: number;
  lvl: number; exp: number; upexp: number; state: number;
  itemmaxslots: number;
  oblpara: { killnum?: number; battle?: any; [k: string]: any };
  equipment: Record<string, any>;
}

export interface Enemy {
  pid: number;
  type: number;
  name: string;
  icon: string;
  gd: string;
  pgroup: number;
  pls: number;
  hp: number; mhp: number;
  lvl: number;
  state: number;
  discovered: number;
}
```

---

## 六、与 Oblivions 后端集成

### 6.1 API 兼容性保证

**原则**：后端 API 不做破坏性变更，前端迁移期间两套前端（vex/ + vex-vue/）并行可用。

**API 端点清单（代码核对后完整版）**：

| 端点 | 方法 | 参数 | 响应 | 备注 |
|------|------|------|------|------|
| `api_v2.php?action=game_map` | GET | - | `{status, data:{currentLocation, currentRegion, links}}` | 含 regions/tiles/grids/fog |
| `api_v2.php?action=tile_actions` | GET | - | `{status, data:{pois[], ground_items[]}}` | 当前格交互 |
| `api_v2.php?action=player_inventory` | GET | - | `{status, data:{...}}` | itempara + equipment |
| `api_v2.php?action=player_info` | GET | - | `{status, data:{pid, groomid, action, bid, battle_queue, hp, mhp, ...}}` | 含先攻队列 |
| `api_v2.php?action=obl_log` | GET | - | `{status, data:{entries[], total}}` | 结构化日志 |
| `api_v2.php?action=battle_log` | GET | - | `{status, data:{entries[], total}}` | played=0 条目 |
| `api_v2.php?action=enemies` | GET | - | `{status, data:{enemies[]}}` | 当前区域已发现敌人 |
| `api_v2.php?action=skill_list` | GET | - | `{status, data:{skills[], player_ap, player_max_ap}}` | **装填区用** |
| `api_v2.php?action=ai_dump_save` | POST | JSON Lines | `{status}` | debug 用 |
| `command.php` | POST | `mode=command&command=xxx&...` | `{}` 或 `{error}` | Oblivions 模式返回空 |
| `vex/mark_battle_log_played.php` | POST | `groomid&pid&log_ids` | `{success, marked}` | 零依赖 |

### 6.2 数据流连续性

**读取流（保持不变）**：

```
页面加载 → loadAll()
  → loadMap()                    // game_map + enemies 并行
    → mapData 更新（响应式）
    → broadcast('map:loaded')
      → loadInventory() / loadTileAction() / refreshLog()
  → loadPlayerInfo() → 状态栏
  → refreshBattle() → 检测 action 状态
```

**写入流（保持不变）**：

```
用户操作 → commandQueue.execute(params)
  → submitCommand(params)        // POST command.php
  → 成功后:
    dataManager.invalidateAll()
    await loadMap()
    broadcast('game:action-completed')
      → 各面板自行刷新
```

**战斗数据流（保持不变，但需注意实际字段）**：

```
后端 emit battlelog（played=0）
  → obl_battle_log_persist() 追加到文件

前端 fetchAndPlayBattleLog()
  → gameApi('battle_log') → played=0 条目
  → groupByEncounter(entries)  // 用 actor_type/target_type 推导 NPC pid
  → 过滤 phase==='excute' 的条目播放动画
  → 三阶段播放（碰撞 + 模态框 + 残留伤害）
  → POST mark_battle_log_played.php 标记 played=1
```

### 6.3 后端必要调整（最小化）

| 调整项 | 文件 | 说明 |
|--------|------|------|
| `game.php` 重定向目标 | `game.php` | Oblivions 模式从 `vex/index.html` 改为 `vex-vue/dist/index.html`（M7 阶段） |
| CORS `extra_origins` | `api_v2.php` | 开发环境加入 `http://localhost:5174`（Vite dev server） |
| `.htaccess` | `vex-vue/.htaccess` | 新建，配置构建产物缓存（hash 文件长缓存，index.html 不缓存） |

**后端业务逻辑零改动**：所有 `oblivions/include/` 下 PHP 文件不变。

### 6.4 并发控制保持

三层锁机制完全保留：

| 层 | 位置 | Vue 3 实现 |
|----|------|-----------|
| 前端全生命周期锁 | `battle.ts` store 的 `isProcessingBattle` | Pinia state + action 包裹 |
| 前端 HTTP 锁 | `command-queue.ts` store 的 `_locked` | Pinia state + action 包裹 |
| 后端文件锁 | `obl_command.php` flock | 不变 |

### 6.5 认证保持

- Cookie 认证（`credentials: include`）不变
- 同源部署（`/phpdts/vex-vue/dist/`）确保 Cookie 自动携带
- 开发环境通过 Vite proxy 转发请求（携带 Cookie）

---

## 七、风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| 地图渲染 Vue 化成本高 | M3 延期 | 阶段 A 保留命令式渲染（`ref` + `innerHTML`），阶段 B 再优化 |
| 战斗动画 `position: fixed` 与 Vue Teleport 冲突 | M6 卡住 | 用 `<Teleport to="body">` + `onMounted` 中操作 DOM |
| 打字机效果 `setTimeout` 链在 Vue 中内存泄漏 | M6 卡住 | 用 `onUnmounted` 清理定时器 + `ref` 跟踪 |
| Tailwind v4 + Vite 配置问题 | M0 卡住 | 参考 `oblivions/editor/vite.config.js` 已验证配置 |
| 文档与代码不一致导致迁移错误 | 全程 | 每个模块迁移前核对代码，差异记录在第二章 |
| 两套前端并行期间 API 变更 | M1-M7 | 后端 API 冻结，仅前端迁移 |

---

## 八、验收标准

### 8.1 功能验收（全流程回归）

- [ ] 登录 → 进入游戏 → 状态栏显示正确
- [ ] 地图渲染 + 缩放 + 平移 + 居中
- [ ] 点击移动 + 路径预览 + 区域切换
- [ ] 探索 + 迷雾点亮 + 道具/敌人发现
- [ ] 拾取 + 丢弃 + 背包满提示
- [ ] 搜索 POI + 机制触发
- [ ] 日志增量 + 高亮 + 未读提示 + Toast
- [ ] 玩家主动攻击 → 装填区 → 执行 → 战斗演出
- [ ] NPC 回合自动刷新 + 玩家回合提示
- [ ] 遭遇战（NPC 碰撞触发）
- [ ] 战斗结束 → 退出 battle 模式 → 地图刷新
- [ ] `?debug=ai` 调试面板正常

### 8.2 性能验收

- [ ] 首屏加载 < 现有版本 1.2 倍
- [ ] 地图渲染帧率 ≥ 30fps（缩放/平移时）
- [ ] 战斗动画无卡顿
- [ ] 构建产物 gzip 后 < 200KB（不含字体）

### 8.3 文档验收

- [ ] `vex-vue/README.md` 完整
- [ ] `vex/CODEBASE.md` 同步更新（第二章差异全部解决）
- [ ] `oblivions/CODEBASE.md` 补充 `skill_list` / `bra_oblqueue` / `battle_queue`
- [ ] 关键组件有 JSDoc 注释

---

## 九、附录：关键决策记录

### 9.1 为什么选择渐进式迁移而非全量重写

- 地图渲染（`innerHTML` + `data-enemy-pid` + `getBoundingClientRect`）直接 Vue 化成本极高
- 渐进式迁移允许两套前端并行验证，降低风险
- 保留现有命令式渲染逻辑作为 fallback

### 9.2 为什么选择 Pinia 而非 Vuex

- Vue 3 官方推荐
- TypeScript 支持更好
- API 更简洁（无 mutations）
- 与 Composition API 配合更自然

### 9.3 为什么保留 DebugBus 而非改用 Vue 响应式

- DebugBus 是极简事件总线，零开销
- 跨模块调试事件收集，不适合用响应式 state
- `debug.js` 仅 `?debug=ai` 时加载，不影响生产

### 9.4 为什么不引入 UI 组件库

- 终端 ASCII 风格高度定制，UI 组件库风格不匹配
- 现有 CSS（terminal.css + battle.css）已成熟
- 引入组件库增加包体积，违背"够用即可"原则

---

**文档结束。** 迁移过程中发现新的文档-代码不一致时，追加到第二章并同步更新对应 CODEBASE.md。
