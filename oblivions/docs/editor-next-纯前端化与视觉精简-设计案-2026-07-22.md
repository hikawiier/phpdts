# editor-next 纯前端化与视觉精简 — 设计案

> 2026-07-22 · 模块 O（地图编辑器）重构
>
> 编排协议：orchestrate-oblivions-task
> 校准基准：DESIGN.md 2.15（少即是多视觉元约束）/ 3.4（注意力稀缺）/ 2.2（后端只输出事件结构）/ 2.12（双向锚点契约）
>
> 组织方式：`Module -> Base framework -> Design intent -> Boundary cases`

---

## 一、当前问题（基于源码调研，非用户反馈转述）

### 1.1 后端冗余耦合（违背"本地静态编辑器"定位）

editor-next 定位是**读取本地静态 gamedata 的地图编辑器**，但当前实现存在两条数据流：

- **模式 A（FSAA 直接文件系统）**：通过 `services/file-io.ts` 的 File System Access API + webkitdirectory 回退，直接读写 `oblivions/gamedata/*.php`，**零后端依赖**。
- **模式 B（HTTP API）**：通过 `?editor=1` + Bearer token 双重守卫，复用 `state.php` / `command.php`，调用 7 个 `editor_*` scope + 7 个 `editor.*` 命令。

模式 B 的存在导致后端为编辑器单独维护 **11 处专用代码**：

| # | 文件 / 位置 | 性质 |
|---|---|---|
| 1 | `oblivions/include/api/obl_editor_guard.php` | 整文件（守卫 + 合约 + 分发入口） |
| 2 | `oblivions/include/api/obl_editor_state_handlers.php` | 整文件（7 个读 handler） |
| 3 | `oblivions/include/api/obl_editor_command_handlers.php` | 整文件（7 个写 handler + PHP 代码生成 + ZIP 备份 + `php -l` 语法检查） |
| 4 | `oblivions/editor/editor_token.php` | Bearer token 凭据文件 |
| 5 | `oblivions/include/core/obl_bootstrap.php` 行 150-156 | 3 行 `require_once` |
| 6 | `oblivions/api/command.php` 行 33-49 | CORS 编辑器分支 |
| 7 | `oblivions/api/state.php` 行 32-48 | CORS 编辑器分支 |
| 8 | `oblivions/include/command/obl_command_bus.php` 行 39-79 | `editor_only` 短路分支 |
| 9 | `oblivions/include/command/obl_command_handlers.php` 行 151-160 | `editor.*` 分发分支 |
| 10 | `oblivions/include/command/obl_command_contract.php` 行 269-274 | 合并 `editor.*` 合约 |
| 11 | `oblivions/include/api/obl_state_handlers.php` 行 40-47 | `editor_*` scope 分发分支 |

**关键事实**：运行时游戏（无 `?editor=1` 的 `command.php` / `state.php` 调用）**完全不依赖**上述任何代码。运行时通过 `obl_get_map_data()`（`oblivions/include/game/move.func.php:26-51`）直接 `require` gamedata PHP 文件，通过原生 SQL 读写 `bra_oblmapitem` / `bra_oblmappoi` / `bra_oblmapstates` 三张表。**移除编辑器后端代码对运行时零影响**。

模式 B 在前端对应的冗余实现：

- `src/services/backend-client.ts`、`backend-map-api.ts`、`backend-wilditem-api.ts`、`backend-poi-api.ts`、`backend-fog-api.ts`、`backend-config-api.ts`、`backend-backup-api.ts`、`backend-import-api.ts`（8 个 service 文件）
- `src/stores/backendStore.ts`、`src/stores/liveStore.ts`（2 个 store）
- `src/composables/useBackendConnection.ts`（1 个 composable）
- `src/views/BackendView.vue`、`src/components/panels/BackendPanel.vue`、`src/components/modals/BackupModal.vue`（3 个组件）
- `src/components/overlays/OverlayWildItem.vue`、`OverlayPoi.vue`（2 个依赖 liveStore 的叠层）
- `src/services/ai-guard.ts` 的 `assertBackendConnected` 守卫
- `SimulateView` 的 Live 模式切换 + wilditem/poi 叠层开关 + `backend.connected` 守卫
- `TopBar.vue` 的连接状态徽标 + 模式切换按钮
- `StatusBar.vue` 的连接状态指示
- `Dian.md` 框架 O-4（后端对接）+ O-6（开局分布预览 overlay）+ O-7（AI 约束）整章

### 1.2 视觉元素杂糅（违背 2.15 / 3.4 注意力原则）

**问题 A：SideNav 6 个视图入口过密**

当前 6 个视图：map / config / validate / generators / backend / simulate。其中：
- `backend` 视图存在意义消失（纯前端化后无后端可对接）
- `simulate` 视图与 `map` 视图共享同一份 `project.currentGrid` / `currentTiles`，本质是地图视图的"模拟模式"，独立成视图导致用户在两个 Tab 间反复切换

**问题 B：SimulateView 工具栏过载**

`SimulateView.vue` 顶部工具栏一行塞入 **7 组控件**：
1. 模式切换（Simulate / Live）
2. 视野滑块（1-5）
3. 移动滑块（1-10）
4. sim 工具（玩家 / 探索）
5. 叠层开关（迷雾 / 视野 / 可达 / 潮汐 / 道具 / POI）共 6 个 checkbox
6. 玩家位置信息

违背 3.4"设计的第一要务不是展示什么，而是不展示什么"。Live 按钮 + 道具/POI 叠层都依赖 `backend.connected`，纯前端化后这些都要消失。

**问题 C：6 个 overlays 默认全可见开关**

`overlayStore` 暴露 fog / vision / reachability / tideHeatmap / wilditem / poi 共 6 个开关，SimulateView 全部以 checkbox 形式铺开。叠层是"按需可视化工具"，应默认隐藏，按场景聚合。

**问题 D：TopBar 死代码 + 后端依赖徽标**

`TopBar.vue` 包含：
- 撤销/重做按钮 `:disabled="true"` 永远禁用（死代码，MapEditorView 已有自己的撤销/重做）
- `backend.connected` 状态徽标（后端耦合 UI）
- Simulate/Live 模式切换按钮（后端耦合）

**问题 E：彩色信号色使用情况（已合规，仅需维持）**

`GridCell.vue` 调研显示编辑器本体已较好遵循 2.15 灰阶基底：
- passable / blocked 用 `bg-gray-800` 灰阶区分
- preset_safe 用 `::after` 形状标记
- floor / tide 用 CSS 形状纹理 + 灰阶亮度
- 唯一强调色 `ring-accent-error` 仅用于 break-first 操作提示

但 `OverlayReachability.vue` 中路径线使用绿色 `#88ff88`（Dian.md O-1 边界案例明文记录），需核验是否与"唯一强调色"规则冲突——如果 `accent-error` 已是当前场景强调色，路径线绿应改为灰阶形状或与 accent-error 协调。

### 1.3 旧版编辑器残留

`oblivions/editor/`（Vanilla JS + Vite）整个目录仍存在，Dian.md 模块 O 每个框架（O-0 至 O-7）都同时保留新旧两套代码锚点。`editor_token.php` 仍被新系统后端守卫 `obl_editor_guard.php` 加载使用——这是新旧编辑器间唯一的活引用。

用户要求"完全消除旧版地图编辑器的影响"。

---

## 二、目标行为（用户可见结果 + 完成标准）

### 2.1 用户可见结果

1. **editor-next 成为唯一地图编辑器**：`oblivions/editor/` 整个目录物理移除，Dian.md 不再保留任何旧版代码锚点。
2. **editor-next 完全脱离后端 HTTP 依赖**：作为纯本地静态数据编辑器运行，仅通过 FSAA / webkitdirectory / ZIP 导出三种路径读写 gamedata。
3. **UI 遵循 2.15 / 3.4 注意力原则**：
   - SideNav 视图入口从 6 个收敛到 4 个（map / config / validate / generators）
   - 模拟能力整合进地图视图（按需展开，不再独立 Tab）
   - 叠层开关默认隐藏，按场景聚合
   - TopBar 死代码与后端依赖徽标移除
   - 灰阶基底 + 唯一强调色规则维持并补强
4. **后端 11 处编辑器专用代码全部移除**：运行时游戏不受影响。
5. **Dian.md 模块 O 同步更新**：移除旧版代码锚点，重构 O-4（后端对接 → 移除）/ O-6（开局分布预览 → 移除）/ O-7（AI 约束 → 移除），保留 O-0 / O-1 / O-2 / O-3 / O-5。
6. **`validate_design_anchors.php` 严格校验通过**。

### 2.2 完成标准（可验证）

- [ ] `oblivions/editor/` 目录不存在
- [ ] Grep 全工作区 `editor_token|obl_editor_guard|obl_editor_state_handlers|obl_editor_command_handlers` 零命中
- [ ] Grep 全工作区 `editor_only|editor\.\*|editor_*` 在 oblivions/include 与 oblivions/api 下零命中
- [ ] editor-next 在浏览器中可独立运行（`pnpm dev`），仅通过 FSAA / webkitdirectory / ZIP 读写 gamedata
- [ ] Grep `oblivions/editor-next/src` 下 `backendStore|liveStore|useBackendConnection|backend-client|backend-map-api|backend-wilditem-api|backend-poi-api|backend-fog-api|backend-config-api|backend-backup-api|backend-import-api|BackendView|BackendPanel|BackupModal|OverlayWildItem|OverlayPoi|ai-guard` 零命中
- [ ] SideNav 仅 4 个视图入口（map / config / validate / generators）
- [ ] `pnpm build` 通过，`pnpm test`（vitest）通过
- [ ] `pnpm typecheck` 通过
- [ ] 运行时游戏 smoke test：`php oblivions/tools/validate_design_anchors.php`（严格模式）通过
- [ ] Dian.md 模块 O 不再含旧版 `oblivions/editor/` 锚点，O-4/O-6/O-7 章节已移除或重构

---

## 三、任务拆分（有界任务 + 拥有者 + 依赖 + 交付 + 禁止范围）

### 任务 A：后端解耦（拥有者：后端 agent）

**范围**：移除"一、1.1"表格中 11 处后端编辑器专用代码。

**依赖**：无（与任务 B 并行）。

**交付**：
- 删除 `obl_editor_guard.php` / `obl_editor_state_handlers.php` / `obl_editor_command_handlers.php` 三个整文件
- 删除 `oblivions/editor/editor_token.php`
- 从 `obl_bootstrap.php` 移除第 150-156 行（3 行 `require_once` + 注释）
- 从 `command.php` / `state.php` 移除 `?editor=1` CORS 分支
- 从 `obl_command_bus.php` 移除 `editor_only` 短路分支
- 从 `obl_command_handlers.php` 移除 `editor.*` 分发分支
- 从 `obl_command_contract.php` 移除 `editor.*` 合约合并
- 从 `obl_state_handlers.php` 移除 `editor_*` scope 分发分支
- 运行时游戏 smoke test 通过（手动验证 `state.php` / `command.php` 不带 `?editor=1` 仍正常响应玩家命令）

**禁止范围**：
- 不得修改 `oblivions/include/game/` 下任何运行时游戏代码
- 不得修改 `oblivions/gamedata/` 下任何数据文件
- 不得修改 `bra_oblmapitem` / `bra_oblmappoi` / `bra_oblmapstates` 表 schema
- 不得修改 `obl_get_map_data()` 函数

**风险**：
- 若 `obl_command_bus.php` 的 `editor_only` 分支与玩家命令分支有共用代码，移除时需保留玩家分支完整 → 实施前需精读 `obl_command_bus.php` 行 39-79 上下文
- 若 `obl_command_contract.php` 合约合并函数有其他模块依赖 `editor.*` 注册副作用 → 实施前需 Grep `obl_editor_command_contracts` 调用链

### 任务 B：前端切换为纯本地静态数据源（拥有者：前端 agent）

**范围**：移除 editor-next 中所有后端耦合代码，保留并增强 FSAA / ZIP 路径。

**依赖**：与任务 A 并行。

**交付**：
- 删除 `src/services/backend-client.ts` / `backend-map-api.ts` / `backend-wilditem-api.ts` / `backend-poi-api.ts` / `backend-fog-api.ts` / `backend-config-api.ts` / `backend-backup-api.ts` / `backend-import-api.ts`（8 个文件）
- 删除 `src/stores/backendStore.ts` / `liveStore.ts`（2 个文件）
- 删除 `src/composables/useBackendConnection.ts`
- 删除 `src/services/ai-guard.ts`（或重构为只保留与后端无关的守卫）
- 删除 `src/views/BackendView.vue` / `src/components/panels/BackendPanel.vue` / `src/components/modals/BackupModal.vue`
- 删除 `src/components/overlays/OverlayWildItem.vue` / `OverlayPoi.vue`（依赖 liveStore）
- 从 `src/router/index.ts` 移除 `/backend` 路由
- 从 `src/components/layout/SideNav.vue` 移除 BackendView 入口
- 从 `src/components/layout/TopBar.vue` 移除 `backend.connected` 徽标 + Simulate/Live 模式切换按钮 + 死代码撤销/重做按钮（MapEditorView 已有自己的）
- 从 `src/components/layout/StatusBar.vue` 移除连接状态指示
- 从 `src/views/SimulateView.vue` 移除 Live 模式切换 + wilditem/poi 叠层开关 + `backend.connected` 守卫
- 从 `src/stores/index.ts` 移除 `backendStore` / `liveStore` 导出
- 从 `src/i18n/zh-CN.ts` / `en-US.ts` 移除 backend 相关文案（保留必要的连接失败提示转为本地 IO 错误提示）
- 增强 `src/services/file-io.ts`：作为唯一数据路径，确保 FSAA + webkitdirectory + ZIP 导出三条路径完整覆盖原模式 B 的所有用例（地图加载/保存、配置加载/保存、备份）
- 重构 `src/composables/useImportExport.ts`：移除"从后端导入"分支，仅保留 FSAA 导入 + ZIP 导入 + ZIP 导出
- 重构 `src/stores/overlayStore.ts`：移除 `wilditem` / `poi` flags，移除 `clearBackendOverlays` 方法
- 重构 `src/stores/simStore.ts`：移除 `mode: 'live'` 状态，仅保留 `mode: 'simulate'`
- 重构 `src/components/grid/GridOverlay.vue`：移除 OverlayWildItem / OverlayPoi 调度
- `pnpm build` + `pnpm test` + `pnpm typecheck` 通过

**禁止范围**：
- 不得修改 `oblivions/shared/` 下任何算法 / 类型 / 常量文件（这些是前后端共享的纯函数库，与后端耦合无关）
- 不得修改 `src/services/generators/` 下生成器代码（纯函数，无后端依赖）
- 不得修改 `src/services/validate-rules.ts` / `src/workers/php-parser.worker.ts`
- 不得削弱 FSAA 路径的现有能力（必须保持与原模式 B 等价的 CRUD 完整性）

**风险**：
- `useImportExport.ts` 可能在多处被引用，移除"从后端导入"分支需同步更新 ImportModal → 实施前需 Grep `useImportExport` 调用链
- `simStore.mode` 类型从 `'simulate' | 'live'` 收敛为 `'simulate'` 后，所有读取 `sim.mode` 的地方需同步清理 → 实施前需 Grep `sim.mode` / `isLiveMode` 引用
- `BackupModal` 可能在 BackendView 之外被引用 → 实施前需 Grep `BackupModal`

### 任务 C：UI 视觉精简（拥有者：前端 agent）

**范围**：在任务 B 基础上进一步精简 UI，遵循 2.15 / 3.4 注意力原则。

**依赖**：任务 B 完成后。

**交付**：

**C-1：SideNav 收敛**
- 从 6 个视图入口收敛到 4 个：map / config / validate / generators
- 移除 `simulate` 独立视图入口（模拟能力整合进 map 视图，见 C-2）
- `src/router/index.ts` 移除 `/simulate` 路由
- 删除 `src/views/SimulateView.vue`（其能力迁移到 MapEditorView 的可折叠模拟面板）

**C-2：模拟能力整合进地图视图**
- 在 `MapEditorView.vue` 主体下方增加可折叠的"模拟面板"（默认折叠，对齐 3.4"不展示什么优先"）
- 模拟面板包含：
  - 视野滑块（1-5）+ 移动滑块（1-10）
  - sim 工具按钮（玩家 / 探索）
  - 叠层开关聚合为单一下拉/折叠组（默认折叠）：迷雾 / 视野 / 可达 / 潮汐
- 移除所有 Live 模式相关 UI（任务 B 已完成）
- 模拟面板折叠时，GridCanvas 全屏；展开时占据底部固定高度

**C-3：叠层开关聚合**
- `overlayStore` 移除 `wilditem` / `poi` 后剩 4 个 flag：fog / vision / reachability / tideHeatmap
- 4 个开关不再以平铺 checkbox 形式展示，改为单一"叠层"下拉/折叠组，默认全部关闭
- 启用任意叠层时，下拉组标题显示"叠层 (N)"作为注意力锚点

**C-4：TopBar 精简**
- 移除撤销/重做按钮（死代码）
- 移除模式切换按钮（无 Live 模式后无意义）
- 移除连接状态徽标
- TopBar 仅保留：应用标题 + 版本号 + 项目加载/保存入口（FSAA 路径）+ 导入/导出 ZIP 入口
- 项目加载/保存入口整合进 TopBar 右侧，替代原 BackendView 的连接表单

**C-5：StatusBar 精简**
- 移除连接状态指示
- 保留：区域数 / 错误数 / 警告数（验证 issue 计数）
- 形状编码：错误用 `accent-error` 唯一强调色，警告用灰阶

**C-6：彩色信号色核验**
- 核验 `OverlayReachability.vue` 路径线绿色 `#88ff88` 是否与 `accent-error` 构成"同时存在的强调色"
- 若构成冲突，路径线改为灰阶虚线（dasharray）或与 `accent-error` 协调的唯一强调色
- 核验 `main.css` 中 `cell-entrance` / `cell-exit` / `cell-safe` / `floor-*` / `tide-*` 样式是否纯灰阶
- 核验 `OverlayVision.vue` / `OverlayFog.vue` / `OverlayTideHeatmap.vue` 是否纯灰阶

**C-7：i18n 文案清理**
- 移除 `backend.*` / `mode.live` / `mode.simulate` 相关文案
- 新增"模拟面板"折叠/展开文案

**禁止范围**：
- 不得改变编辑器的核心编辑能力（7 个工具：select / draw / erase / paint / break / restore / sim-set-player）
- 不得改变生成器、验证、配置编辑的功能
- 不得引入新的彩色信号色

**风险**：
- 模拟面板整合进 MapEditorView 可能与现有 ToolPanel + BrushPresetPanel + 三栏布局产生空间冲突 → 实施前需评估 MapEditorView 高度预算
- 模拟面板折叠状态需持久化到 `uiStore` 以避免用户每次切换视图都丢失状态

### 任务 D：旧版编辑器物理移除（拥有者：归档 agent）

**范围**：删除 `oblivions/editor/` 整个目录。

**依赖**：任务 A 完成（`editor_token.php` 不再被引用）。

**交付**：
- 删除 `oblivions/editor/` 目录及其全部内容（含 `index.html` / `src/` / `css/` / `vite.config.js` / `package.json` / `package-lock.json` / `.gitignore` / 7 个 `*.md` 文档 / `editor_token.php`）
- Grep 全工作区 `oblivions/editor/` 零命中（除 `oblivions/docs/归档/` 历史归档文档与 git 历史）
- 确认 `pnpm workspace` 配置不再引用 `oblivions/editor`（检查 `pnpm-workspace.yaml`）

**禁止范围**：
- 不得删除 `oblivions/editor-next/` 任何文件
- 不得删除 `oblivions/shared/` 任何文件
- 不得修改 `oblivions/gamedata/` 任何数据文件

**风险**：
- 若 `pnpm-workspace.yaml` 显式包含 `oblivions/editor`，删除目录会导致 workspace 解析失败 → 实施前需 Read `pnpm-workspace.yaml`

### 任务 E：Dian.md 模块 O 同步 + 锚点校验（拥有者：文档 agent）

**范围**：重构 Dian.md 模块 O，反映纯前端化后的架构。

**依赖**：任务 A、B、C、D 全部完成后。

**交付**：

**E-1：模块 O 概述重写**
- 移除"旧 Vanilla JS 项目 `oblivions/editor/` 仍作为历史参考保留，Dian.md 暂同时保留两套代码锚点"段落
- 改为：editor-next 是唯一的地图编辑器，纯前端运行，通过 FSAA / webkitdirectory / ZIP 读写本地静态 gamedata，与 Oblivions 后端零耦合

**E-2：框架重构**
- **O-0 基础架构**：保留，更新代码锚点（移除 BackendView / BackendPanel / BackupModal / backend-client 等，新增模拟面板整合相关锚点）
- **O-1 Simulate 模式**：保留，移除 Live 模式描述，移除 OverlayWildItem / OverlayPoi 锚点，更新 SimulateView 锚点为 MapEditorView 模拟面板
- **O-2 配置文件编辑**：保留，代码锚点不变
- **O-3 验证工具集**：保留，代码锚点不变
- **O-4 后端对接**：**整章移除**（纯前端化后无后端对接）
- **O-5 随机生成扩展点**：保留，代码锚点不变
- **O-6 开局分布预览 overlay**：**整章移除**（依赖 liveStore，纯前端化后无此能力）
- **O-7 AI 约束**：**整章移除**（AI 约束的核心 `assertBackendConnected` 已消失）
- 框架编号重排：O-0 / O-1 / O-2 / O-3 / O-5 → O-0 / O-1 / O-2 / O-3 / O-4（O-5 升格为 O-4，避免编号空洞）**或**保留原编号避免破坏现有引用（推荐保留原编号，因 Dian.md 内部交叉引用可能含 O-5）

**E-3：边界案例更新**
- 移除所有提及 Live 模式 / backend.connected / editor_token / `?editor=1` 的边界案例
- 新增边界案例：FSAA 仅 Chromium 系支持写回，Firefox / Safari 通过 webkitdirectory 只读 + ZIP 导出兜底
- 新增边界案例：模拟面板折叠状态持久化

**E-4：代码锚点同步**
- 对每个保留的框架，移除所有 `oblivions/editor/src/...` 旧版锚点
- 对每个保留的框架，移除所有 `@oblivions/editor-next/src/...` 中已删除文件（BackendView / BackendPanel / BackupModal / OverlayWildItem / OverlayPoi / backend-* / backendStore / liveStore / useBackendConnection / ai-guard / SimulateView）的锚点
- 新增模拟面板相关锚点

**E-5：@module / @framework 标签同步**
- 删除文件中的 `@module O` / `@framework O-4` / `@framework O-6` / `@framework O-7` 标签随文件删除
- 保留文件中 `@framework O-1` 移除 Live 模式相关注释
- 新增文件（模拟面板组件）添加 `@module O` / `@framework O-1` 标签

**E-6：校验**
- 运行 `php oblivions/tools/validate_design_anchors.php --module=O`
- 运行 `php oblivions/tools/validate_design_anchors.php`（全项目严格模式）
- 两者均通过才视为完成

**禁止范围**：
- 不得修改 DESIGN.md（本次重构不引入新设计哲学，仅应用现有原则）
- 不得修改其他模块（A / B / C / D / E / F / G / H / I / J / K / L / M / N）的 Dian.md 内容

**风险**：
- 框架编号重排可能破坏其他文档对 O-5 的引用 → 推荐保留原编号，仅移除 O-4 / O-6 / O-7 章节
- `validate_design_anchors.php` 可能因遗漏的 `@framework` 标签报错 → 实施时需逐文件核验

---

## 四、跨层契约

### 4.1 前后端契约变化

**变化前**：
- 编辑器前端 → `state.php?editor=1` + `command.php?editor=1`（Bearer token）→ 编辑器专用 handler → gamedata 文件 + DB 表
- 运行时游戏 → `state.php` + `command.php`（cookie 会话）→ 玩家 handler → gamedata 文件 + DB 表

**变化后**：
- 编辑器前端 → FSAA / webkitdirectory → 直接读写 `oblivions/gamedata/*.php`
- 编辑器前端 → ZIP 导出 → 用户手动放置到 `oblivions/gamedata/`
- 运行时游戏 → `state.php` + `command.php`（cookie 会话）→ 玩家 handler → gamedata 文件 + DB 表（**不变**）

**契约断点**：编辑器不再调用任何 HTTP API。运行时游戏调用路径完全不变。

### 4.2 共享存储层契约（不变）

编辑器与运行时游戏共享的存储层保持不变：
- `oblivions/gamedata/map.php` / `tiles/region_*.php` / `scatter_pool.php` / `poi_table.php` / `poi_pool.php` / `obl_config.php`
- `bra_oblmapitem` / `bra_oblmappoi` / `bra_oblmapstates` 三张 DB 表

**注意**：纯前端化后，编辑器仅读写 gamedata PHP 文件（FSAA 路径），**不再直接操作 DB 表**。DB 表中的 wilditem / poi / fog 实例数据由运行时游戏在游戏过程中产生，编辑器不再预置。这是符合"本地静态编辑器"定位的——编辑器编辑静态地图结构，运行时游戏生成动态实例。

### 4.3 模块间契约

- `@oblivions/shared` 包：保持不变（纯函数库 + 类型 + 常量，与后端耦合无关）
- `oblivions/editor-next` 与 `vex-vue`：无直接依赖（各自独立前端项目）
- `oblivions/editor-next` 与 `oblivions/include/`：变化后**零依赖**

---

## 五、不变量

1. **运行时游戏行为不变**：所有玩家命令、状态查询、地图加载、战斗、探索、POI 交互行为完全不变
2. **gamedata 文件格式不变**：PHP return 数组格式、字段命名、文件路径完全不变
3. **DB 表 schema 不变**：`bra_oblmapitem` / `bra_oblmappoi` / `bra_oblmapstates` 表结构不变
4. **编辑器核心编辑能力不变**：7 个工具（select / draw / erase / paint / break / restore / sim-set-player）、画笔预设、区域管理、格属性编辑、连通性编辑、配置编辑、验证、生成器全部保留
5. **`@oblivions/shared` 不变**：算法 / 类型 / 常量 / 序列化器全部保留
6. **DESIGN.md 不变**：本次重构不引入新设计哲学

---

## 六、失败处理

| 失败场景 | 处理策略 |
|---|---|
| FSAA 在非 Chromium 浏览器不可用 | webkitdirectory 回退（只读）+ ZIP 导出兜底（写） |
| 用户未选择 gamedata 目录 | 编辑器显示空状态 + "选择目录"引导按钮 |
| PHP 文件解析失败 | Worker 返回错误 + Toast 提示具体文件 + 行号 |
| PHP 代码生成失败 | 不写入文件 + Toast 提示 + 保留原数据 |
| `pnpm build` 失败 | 阻塞任务 B/C 完成，必须修复 |
| `validate_design_anchors.php` 失败 | 阻塞任务 E 完成，必须修复 |
| 运行时游戏 smoke test 失败 | 阻塞任务 A 完成，必须回滚 |

---

## 七、测试策略

### 7.1 后端测试（任务 A）

- 手动 smoke test：`state.php` + `command.php` 不带 `?editor=1` 仍正常响应玩家命令
- Grep 验证：全工作区 `obl_editor` 零命中（除 git 历史）
- PHP 语法检查：`php -l` 对修改后的 5 个文件（`obl_bootstrap.php` / `command.php` / `state.php` / `obl_command_bus.php` / `obl_command_handlers.php` / `obl_command_contract.php` / `obl_state_handlers.php`）通过

### 7.2 前端测试（任务 B / C）

- `pnpm typecheck`：TypeScript 类型检查通过
- `pnpm test`：现有 vitest 单元测试通过
- `pnpm build`：Vite 生产构建通过
- 手动 smoke test：
  - 选择 gamedata 目录 → 加载地图 → 编辑格 → 保存 → 重新加载验证
  - 配置编辑 → 保存 → 重新加载验证
  - 验证视图 → Light / Full 验证通过
  - 生成器 → 全项目生成 + 单区域生成
  - 模拟面板 → 折叠/展开 → 玩家位置设置 → 叠层开关 → BFS 计算
  - ZIP 导出 → 解压验证文件结构

### 7.3 文档测试（任务 E）

- `php oblivions/tools/validate_design_anchors.php --module=O` 通过
- `php oblivions/tools/validate_design_anchors.php`（严格模式）通过

### 7.4 集成测试

- 运行时游戏完整流程：启动游戏 → 移动 → 探索 → 战斗 → POI 交互 → 验证无回归

---

## 八、风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| `obl_command_bus.php` 移除 `editor_only` 分支时误删玩家分支共用代码 | 中 | 高 | 实施前精读行 39-79 上下文，确认玩家分支完整 |
| `useImportExport.ts` 移除"从后端导入"分支时遗漏调用方 | 中 | 中 | 实施前 Grep `useImportExport` 调用链，逐处更新 |
| 模拟面板整合进 MapEditorView 导致布局空间冲突 | 中 | 中 | 实施前评估 MapEditorView 高度预算，必要时模拟面板作为右侧可折叠抽屉而非底部面板 |
| `pnpm-workspace.yaml` 显式包含 `oblivions/editor` 导致删除后 workspace 解析失败 | 低 | 高 | 实施前 Read `pnpm-workspace.yaml`，必要时同步移除 `oblivions/editor` 引用 |
| `validate_design_anchors.php` 报遗漏 `@framework` 标签 | 中 | 低 | 实施时逐文件核验，校验失败立即修复 |
| 旧版编辑器文档（`oblivions/editor/*.md`）含设计意图被误删 | 低 | 低 | 这些文档是旧版独立设计案，与 Dian.md 模块 O 无锚点关系，可安全删除；若有保留价值应先迁移到 `oblivions/docs/归档/` |

---

## 九、非目标

1. **不重构编辑器核心编辑能力**：7 个工具、画笔预设、区域管理、格属性编辑、连通性编辑、配置编辑、验证、生成器的内部实现保持不变
2. **不重构 `@oblivions/shared`**：算法 / 类型 / 常量 / 序列化器保持不变
3. **不修改 DESIGN.md**：本次重构应用现有原则，不引入新设计哲学
4. **不修改运行时游戏代码**：`oblivions/include/game/` 下任何代码不变
5. **不修改 gamedata 文件格式**：PHP return 数组格式不变
6. **不修改 DB 表 schema**：`bra_oblmapitem` / `bra_oblmappoi` / `bra_oblmapstates` 不变
7. **不引入新的实时通信机制**：编辑器与后端零通信，不引入 WebSocket / SSE 替代方案
8. **不实现"编辑器直接操作 DB 表"**：编辑器仅读写 gamedata PHP 文件，DB 表实例数据由运行时游戏生成
9. **不保留任何后端编辑器代码作为"可选功能"**：用户明确要求清除冗余，不留 opt-in 路径

---

## 十、实施顺序

```
任务 A（后端解耦）┐
                  ├─→ 任务 D（旧版清除）─┐
任务 B（前端去耦合）┘                      ├─→ 任务 E（Dian.md 同步）─→ 最终验收
                  任务 C（UI 精简，依赖 B）┘
```

- A 与 B 可并行
- D 依赖 A（editor_token.php 不再被引用）
- C 依赖 B（在去耦合基础上精简 UI）
- E 依赖 A/B/C/D 全部完成
- 最终验收依赖 E

---

## 十一、设计意图校准（对齐 DESIGN.md 第三节）

本设计案的每个决策均对齐 DESIGN.md 跨任务沉淀的设计哲学：

- **3.1 文档撰写的元原则**：本设计案组织为"问题 → 目标 → 任务 → 契约 → 不变量 → 失败处理 → 测试 → 风险 → 非目标"，降低理解成本
- **3.2 概念引入的成本-收益判断**：移除 O-4 / O-6 / O-7 三个框架，因为它们承载的概念（后端对接 / 开局分布预览 / AI 约束）在纯前端化后无收益，保留只会膨胀 Dian.md
- **3.3 约束是意图的近似**：移除后端耦合不是"减少功能"，是让"本地静态编辑器"这一意图从被冗余约束（HTTP API + token 守卫 + Live 模式）掩盖中显形
- **3.4 注意力稀缺**：SideNav 收敛 + 模拟面板折叠 + 叠层开关聚合 + TopBar 死代码移除，每一步都在问"它值得抢占多少注意力"
- **2.15 少即是多视觉元约束**：灰阶基底 + 唯一强调色规则维持并补强；移除 `backend.connected` 徽标等彩色信号色隐患
- **2.2 后端只输出事件结构**：纯前端化后编辑器与后端零通信，此原则对编辑器场景自然失效，不再需要"后端不输出 HTML"的约束
- **2.12 双向锚点契约**：任务 E 严格同步 `@module` / `@framework` 标签与 Dian.md 代码锚点，校验通过

---

## 十二、待批准事项

本设计案需用户批准后方可进入实施阶段。批准后将以任务 A / B 并行启动，按"十、实施顺序"推进。

可选调整方向（用户可指定）：

1. **模拟面板位置**：底部折叠（默认）vs 右侧抽屉 vs 保留独立 SimulateView 但隐藏 SideNav 入口
2. **框架编号重排**：保留原编号（O-0/O-1/O-2/O-3/O-5，O-4/O-6/O-7 留空，推荐）vs 重排为 O-0 至 O-4
3. **旧版编辑器文档处理**：直接删除（默认）vs 迁移到 `oblivions/docs/归档/` 保留历史
4. **`ai-guard.ts` 处理**：整文件删除（默认，因 `assertBackendConnected` 已无意义）vs 保留文件但清空 backend 相关守卫

---

## 十三、补充视觉问题研判与解决方案（用户二审反馈）

> 用户批准设计案后补充反馈："1.地图上信息过密（坐标、地名、相邻格连接线、不可通行标志）且大部分都是无意义信息；2.模拟功能给地图提供的信息（玩家位置、迷雾、视野、潮汐、道具、POI）都是有价值的，但反而视觉呈现效果很差；研判问题是否存在，确认后在任务列表里加入待办任务，设计并解决上述问题。"

### 13.1 研判结论：两个问题均确认存在

#### 问题 1：地图信息过密（确认存在）

**证据**（基于源码调研）：

每个 52×44px 格子（`GridCell.vue` 行 142-163）同时显示：
- `cell-coord` 坐标标签（如 "A0"）—— `text-[10px] text-gray-400`
- `cell-name` 地名（tile.name）—— `text-xs text-gray-200`
- `cell-pls` pls 编号（如 "#1"）—— `text-[10px] text-gray-500`
- `badge-entrance` 入口 "入" —— `text-[9px] text-gray-300`
- `badge-exit` 出口 "出" —— `text-[9px] text-gray-300`
- `badge-blocked` 不可通行 "✕" —— `text-[9px] text-gray-400`
- 加上 floor 纹理背景 + tide 灰阶背景 + 选中/拖拽/batch 边框状态

冗余分析：
- `cell-coord`（如 "A0"）与 `GridCanvas.vue` 行 130-142 的行/列标题（列数字 + 行字母）**信息完全重复**
- `cell-pls`（如 "#1"）是内部数据键，对编辑者无意义，可在 TilePanel 选中后查看
- `GridConnections.vue` 行 38-61 默认渲染所有相邻格连通线（灰色细线 opacity 0.6），大地图数百条线与格内文字叠加，非 break/restore 工具下是冗余视觉噪声
- 未命名格仍占位渲染坐标与 pls，进一步增加密度

#### 问题 2：模拟叠层视觉呈现效果差（确认存在）

**证据**（基于源码调研）：

| 叠层 | 当前样式 | 视觉问题 |
|---|---|---|
| `OverlayFog.vue` | fog=0 渲染半透明灰底 rgba(34,34,34,0.55) + `░░░` ASCII 字符 | ASCII 字符在中文 UI 中突兀，与等宽字体不协调；遮罩透明度不够深 |
| `OverlayVision.vue` | 4 种边框：near 实线白 sw2 / edge 虚线灰 dasharray 3 2 / sense 虚线灰 dasharray 2 3 / player 实线粗白 sw2.5 + 中心圆 r3 | near 与 player 都是实线白仅粗细不同（2 vs 2.5）区分度低；edge 与 sense 都是虚线灰仅 dasharray 不同（3 2 vs 2 3）几乎不可区分 |
| `OverlayReachability.vue` | 可达灰边框 #cccccc sw1.5 / 不可达半透明黑底 rgba(17,17,17,0.5) / 路径线绿色 #88ff88 sw3 dasharray 6 3 + 0.8s 动画 | 可达/不可达对比度低；绿色路径线与 accent-error 红 #ff5555 可能同时出现（break-first + 玩家位置）违反唯一强调色规则；路径线 0.8s 动画抢夺注意力违背 3.4 |
| `OverlayTideHeatmap.vue` | shallow #cccccc opacity 0.35 / deep #888888 opacity 0.45 / abyss #444444 opacity 0.55 | 三档灰阶在 #111 深色背景上几乎不可见：shallow 0.35 透明度在深背景上约等于无，abyss 0.55 也仅中灰 |
| `GridOverlay.vue` 综合 | 多叠层 z-index 10 叠加在 GridCell 之上 | 多叠层同时启用时相互叠加 + 与格内文字穿透显示，视觉层次混乱无优先级 |

### 13.2 解决方案：任务 C 新增子任务 C-8 ~ C-11

#### C-8：GridCell 信息密度精简

**目标**：每个 52×44px 格子从 5+1 个文字标签 + 纹理 + 边框 精简到 1+角标 + 纹理 + 边框。

**改动**：
- `GridCell.vue` 移除 `cell-coord` 坐标标签（与 GridCanvas 行/列标题重复，信息冗余）
- `GridCell.vue` 移除 `cell-pls` pls 编号（编辑者无意义，选中后 TilePanel 已显示）
- `GridCell.vue` 地名 `cell-name` 仅在 `tile.name` 非空时显示（已实现，但需核验未命名格不占位）
- `GridCell.vue` 不可通行标记 `badge-blocked` "✕" 改为格背景斜线纹理（CSS `repeating-linear-gradient`），不再用文字
- 入口/出口角标 "入"/"出" 保留，但样式从 `text-[9px]` 缩小为 `text-[8px]` + 移至更不显眼的角落

**对齐原则**：3.4"设计的第一要务不是展示什么，而是不展示什么"——每移除一个标签都在问"它值得抢占多少注意力"。

#### C-9：GridConnections 上下文显示

**目标**：连通线从"默认全显示"改为"上下文按需显示"。

**改动**：
- `GridConnections.vue` 新增 `visible` prop（默认 false）
- `GridCanvas.vue` 根据当前工具判断：仅 `break` / `restore` 工具激活时 `visible=true`，其他工具下 `visible=false`
- 或在 `toolStore` 新增 `showConnections` 开关（默认 false），由 ToolPanel 的 break/restore 工具自动触发

**对齐原则**：2.15 灰阶基底保留，但 3.4 注意力优先——连通线在非连通性编辑场景下是纯噪声。

#### C-10：叠层视觉层次重构

**目标**：4 个叠层（fog/vision/reachability/tideHeatmap）样式区分度提升，遵循 2.15 灰阶基底 + 唯一强调色。

**改动**：

**OverlayFog.vue**：
- 移除 `░░░` ASCII 字符（行 93-100）
- 半透明遮罩加深：`rgba(17,17,17,0.7)`（原 0.55）
- fog=0 格整体暗化，与 fog=1 形成强对比

**OverlayVision.vue** 4 种边框重设计：
- `vision-player`：实线粗白边框 sw3 + 中心实心圆 r4（保留，玩家位置是核心信息）
- `vision-near`：实线细白边框 sw1.5（dist ≤ 1，近距离清晰视野）
- `vision-edge`：虚线白边框 dasharray 4 2（dist > 1，远距离模糊视野）
- `vision-sense`：点状白边框 dasharray 1 3 + opacity 0.6（感知外圈，最弱信号）
- 颜色统一为灰阶白 `--color-gray-100`，区分度通过线型（实线/虚线/点状）+ 粗细 + opacity 实现

**OverlayReachability.vue**：
- 可达格 `reach-reachable`：移除边框，改为背景微亮 `rgba(255,255,255,0.08)`（不抢注意力）
- 不可达格 `reach-unreachable`：背景微暗 `rgba(0,0,0,0.45)`（与可达形成明暗对比）
- 路径线 `overlay-path-line`：从绿色 `#88ff88` 改为灰阶白 `--color-gray-100` 虚线 dasharray 6 3，**移除 0.8s 动画**（对齐 3.4 不抢夺注意力）；路径线作为"导航辅助"而非"警示信号"，不应使用强调色
- 同时移除 `main.css` 行 22 `--color-accent-path` token 与行 87-98 `path-line` 动画（绿色路径线彻底消失，唯一强调色仅剩 `--color-accent-error` 红，对齐 2.15）

**OverlayTideHeatmap.vue** 三档灰阶亮度增强：
- `tide-shallow`：`#cccccc` fill-opacity 0.5（原 0.35）
- `tide-deep`：`#888888` fill-opacity 0.65（原 0.45）
- `tide-abyss`：`#222222` fill-opacity 0.8（原 0.55，改用 #222 与背景 #111 形成可见差异）
- 同步更新 `main.css` 行 25-28 `--color-tide-*` token

**对齐原则**：2.15 唯一强调色规则——移除绿色路径线后，全编辑器仅剩 `accent-error` 红一种强调色，用于 break-first 操作提示与 ValidatePanel error 级，力量来自稀缺性。

#### C-11：叠层与格内容互斥

**目标**：启用任意叠层时，格内文字自动隐藏，画面仅保留坐标定位锚点 + 叠层数据。

**改动**：
- `GridCell.vue` 新增 `overlayActive` prop（由 GridCanvas 根据 `overlayStore.flags` 任一为 true 传入）
- `overlayActive=true` 时：
  - 隐藏 `cell-name` 地名（叠层启用时编辑者关注模拟数据，非编辑地名）
  - 隐藏 `badge-entrance` / `badge-exit` / 不可通行纹理标记
  - 保留格边框 + 灰阶背景作为定位锚点
- `overlayActive=false` 时：恢复正常编辑态显示
- 行/列标题始终保留（坐标定位锚点）

**对齐原则**：3.4"协调性即节省注意力"——叠层与编辑信息属于不同任务语境，互斥显示避免用户在两套视觉语言间切换。

### 13.3 任务 C 完整子任务清单（修订后）

任务 C 在原 C-1 ~ C-7 基础上新增 C-8 ~ C-11，共 11 个子任务：

| 子任务 | 目标 | 对齐原则 |
|---|---|---|
| C-1 | SideNav 收敛到 4 视图 | 3.4 不展示什么优先 |
| C-2 | 模拟能力整合进 MapEditorView | 3.4 不展示什么优先 |
| C-3 | 叠层开关聚合为单一折叠组 | 3.4 不展示什么优先 |
| C-4 | TopBar 精简（移除死代码 + 后端徽标） | 2.15 灰阶基底 |
| C-5 | StatusBar 精简 | 2.15 灰阶基底 |
| C-6 | 彩色信号色核验（含绿色路径线移除） | 2.15 唯一强调色 |
| C-7 | i18n 文案清理 | 3.1 降低理解成本 |
| **C-8** | **GridCell 信息密度精简**（移除坐标/pls/不可通行文字） | **3.4 不展示什么优先** |
| **C-9** | **GridConnections 上下文显示**（仅 break/restore 工具下显示） | **3.4 不展示什么优先** |
| **C-10** | **叠层视觉层次重构**（fog/vision/reachability/tideHeatmap 样式区分度提升 + 路径线灰阶化） | **2.15 灰阶基底 + 唯一强调色** |
| **C-11** | **叠层与格内容互斥**（叠层启用时隐藏格内文字） | **3.4 协调性即节省注意力** |
