# 搜索建筑物与掉落机制重构 — 模块 L：POI 交互界面

> 本案定义 POI（兴趣点）搜刮机制重构的前端界面设计与实现方案，按原始设计案 [搜索建筑物与掉落机制设计案.md](file:///d:/wamp64/www/phpdts/oblivions/docs/原始方案/搜索建筑物与掉落机制设计案.md) §4 界面表现落地。
>
> **职责边界**：本案仅覆盖 POI 模态框及其子组件的交互流程、状态管理、命令调用与防抖策略。POI 后端掉落表结算、保底机制、嵌套表展开归属后端模块 E；地图迷雾与 POI 实例数据归属后端模块 A 状态查询层；itm0 锁定回退路径复用 [vex-vue-背包与道具使用界面设计案.md](file:///d:/wamp64/www/phpdts/oblivions/docs/归档/vex-vue-背包与道具使用界面设计案.md)。
>
> **依赖文档**：
>
> - 原始设计案 §4 界面表现 → [搜索建筑物与掉落机制设计案.md](file:///d:/wamp64/www/phpdts/oblivions/docs/原始方案/搜索建筑物与掉落机制设计案.md)
>
> - 防抖预览参考 → [vex-vue-合成界面设计案.md](file:///d:/wamp64/www/phpdts/oblivions/docs/归档/vex-vue-合成界面设计案.md)（K-2 防抖模式）
>
> - 命令门控 → [战斗锁定白名单-设计案.md](file:///d:/wamp64/www/phpdts/oblivions/docs/归档/战斗锁定白名单-设计案.md)
>
> - 事件总线 → [OBL_STATE_API_DESIGN.md](file:///d:/wamp64/www/phpdts/oblivions/docs/归档/OBL_STATE_API_DESIGN.md)

***

## 一、模块概览

### 1.1 框架在前端架构中的位置

本案落在 **模块 L：Vue 组件** 下，作为 L-1（统一交互列表模式）的细化演进。原始设计案 §4.2 规定的"POI 互动界面"远比 L-1 现有的简易模态框复杂——需要四区布局、实时概率预览、工具/技能选择、事件反馈切换、掉落物首次主动弹出等多重视觉与交互逻辑。L-1 仅承担"卡片列表 + 内联模态"的轻量场景；当 POI 进入深入搜刮态时，由本案 L-9 接管渲染。

### 1.2 与已有框架的关系

| 已有框架 | 关系 | 协作点 |
|---------|------|--------|
| [L-1 统一交互列表模式](file:///d:/wamp64/www/phpdts/oblivions/Dian.md) | 共存 | TileActionBar 提供 `[POI 交互]` 入口按钮；列表态仍可复用 L-1 卡片风格 |
| [L-6 三列合成界面](file:///d:/wamp64/www/phpdts/oblivions/docs/归档/vex-vue-合成界面设计案.md) | 借鉴 | 四区布局参考 L-6 三列布局的网格策略、`itm0Locked` 覆盖态、CSS 类风格 |
| [L-4 异步播放编排器](file:///d:/wamp64/www/phpdts/oblivions/Dian.md) | 无 | 战斗演出由 BattleModal 独立承载，POI 模态框关闭后让位 |
| [K-2 合成模态状态机 + 防抖预览](file:///d:/wamp64/www/phpdts/vex-vue/src/stores/craft.ts) | 借鉴 | ProbabilityBar 概率预览落地时复用 K-2 的 leading+trailing + 递增请求 ID 防抖模式；当前概率预览占位未实现，无防抖需求（无 poi.preview 命令） |
| [K-3 多层命令门控](file:///d:/wamp64/www/phpdts/vex-vue/src/stores/command-queue.ts) | 集成 | poi.search / item.pickup 经 commandQueue.execute 提交，受 5 层门控拦截 |
| [K-4 事件驱动架构](file:///d:/wamp64/www/phpdts/vex-vue/src/stores/data-manager.ts) | 集成 | 通过 dataManager 广播 `game:action-completed` / 监听 `battle:started` 强制关闭模态框 |
| [K-6 不可变原子地图投影](file:///d:/wamp64/www/phpdts/vex-vue/src/stores/map.ts) | 解耦 | POI 列表由独立 store 管理，不污染 mapStore 投影 |

### 1.3 不在本案范围内的事项

- 后端掉落表结算、保底机制、嵌套表递归展开 → 后端模块 E
- 容器装填 UI（原始设计案 §8.3 占位）→ 用户明确去除容器概念，本案不引入
- POI 实例的数据库结构与迷雾联动 → 后端模块 A
- 战斗锁定下的 POI 模态框强制关闭由 K-3 + K-4 协作完成，本案只消费事件

***

## 二、框架 L-9：POI 交互模态框

### 2.1 设计意图

POI 搜刮是"高风险高回报的深入挖掘"——与 L-1 的"路过捡破烂"轻量交互互补。原始设计案 §4.2 规定的四区布局（左侧信息区 / 中上部交互区 / 中下部反馈区 / 右侧工具技能区）必须在一个模态框内同时承载三件事：**信息展示**（场景插图与文字介绍）、**决策辅助**（实时概率预览 + 掉落池预览）、**操作执行**（工具/技能选择 + 确认搜索）。这三件事不能分屏切换，必须在玩家决策瞬间同时可见——这是"界面信息透明"设计目标（§7.6）的硬约束。

模态框采用**双态切换**而非"列表页 + 详情页"的两个独立模态：列表态展示当前格所有可搜刮 POI 卡片，玩家选中某一 POI 后**原地切换**到交互态。这一选择避免页面层级过深，同时保留"同格多 POI 并列对比"的原始信息密度。掉落物首次主动弹出（§4.3）通过响应式数据流实现：`poi.search` 成功 → `tile_actions` scope 失效刷新 → `tileActionStore.pois[i].items[]` 响应式更新 → `poiStore.currentPoiItems` 派生刷新 → PoiFeedbackPanel 自动展示道具列表（**不依赖 `loot_dropped` 响应字段**，后端 `poi.search` 不直接返回该字段，结果通过日志条目 + scope 刷新回传）。

**实时概率预览**（ProbabilityBar 组件）**占位未实现**：后端 `tile_actions` scope 未暴露 `base_loot_chance` / `base_good_event_chance` / `base_bad_event_chance` / `prob_mods_source` 等概率字段，前端无法预知哪些 item_id 是有效工具（需后端暴露或玩家试错）。待后续后端扩展 `tile_actions` scope 或新增 `poi_preview` 只读端点后落地。原设计案设想的 K-2 防抖模式（递增请求 ID + leading+trailing 200ms）在概率预览落地时复用，当前无防抖需求（无预览命令）。

**事件反馈区**承担"意外/无事发生"二态视觉切换：描述文字由后端 `search.result` / `search.event_triggered` / `search.nothing_found` 日志条目驱动，经 `poi.search` 命令的 `CommandResult.message` 回传前端，写入 `poiStore.lastSearchFeedback` 由 PoiFeedbackPanel v-html 渲染。恶性事件可能伴随 HP 扣减，HP 槽同步由 K-5 角色数据枢纽派发，反馈区只读取 `player.hp` 派生显示。

**与命令门控集成**：POI 模态框打开期间 `ui_mode='explore'`，所有 POI 命令受 K-3 第 4 层模式锁保护——若收到 `battle:started` 事件，前端强制关闭模态框并切换到战斗场景。命令执行期间（`commandQueue.isLocked`）模态框内所有按钮禁用，防止重复提交。已物化到 oblmapitem 但未拾取的掉落物在战斗开始时保留（不强制拾取），玩家战后可重新打开 POI 模态框——`poiStore.poiList` 派生 `tileActionStore.pois`，`currentPoi.items[]` 基于 `WHERE source_iaid=POI.iaid AND discovered=1` 的 oblmapitem 行集响应式展示未拾取道具（**无 `poi.inspect` 命令**，数据直接由 `tile_actions` scope 提供）。

### 2.2 代码锚点

**新增组件（`vex-vue/src/components/poi/`）：**

- [vex-vue/src/components/poi/PoiModal.vue](file:///d:/wamp64/www/phpdts/vex-vue/src/components/poi/PoiModal.vue) — 模态框容器，Teleport to body，承载双态切换（@framework L-9）
- [vex-vue/src/components/poi/PoiInteraction.vue](file:///d:/wamp64/www/phpdts/vex-vue/src/components/poi/PoiInteraction.vue) — 交互态容器，承载 POI 信息 + 工具选择 + 反馈 + 道具列表
- [vex-vue/src/components/poi/PoiToolSelector.vue](file:///d:/wamp64/www/phpdts/vex-vue/src/components/poi/PoiToolSelector.vue) — 工具/技能选择区（单选 tool_id / skill_id，对齐后端 `obl_command_contract.php` 的 payload_schema）
- [vex-vue/src/components/poi/PoiFeedbackPanel.vue](file:///d:/wamp64/www/phpdts/vex-vue/src/components/poi/PoiFeedbackPanel.vue) — 反馈区（渲染 `search.*` 日志条目 + 道具列表 + 拾取按钮）

> **占位组件（暂不实现）：** `ProbabilityBar.vue`（三档概率条可视化）依赖后端在 `tile_actions` scope 暴露 `base_loot_chance` / `base_good_event_chance` / `base_bad_event_chance` / `prob_mods_source` 等字段，当前后端未暴露。待后续后端扩展 `tile_actions` scope 或新增 `poi_preview` 只读端点后落地。

**新增 store（`vex-vue/src/stores/`）：**

- [vex-vue/src/stores/poi.ts](file:///d:/wamp64/www/phpdts/vex-vue/src/stores/poi.ts) — POI 模态框 store（modalOpen / modalMode / currentIaid / selectedToolId / selectedSkillId / lastSearchFeedback / 强制关闭事件监听）

> **单 store 决策：** 不再拆分 `poi.ts` + `poi-interaction.ts` 双 store。原设计案的"双 store 分离"前提是 `poi.inspect` 命令缓存与 `tile_actions` 派生分离；实际后端无 `poi.inspect` 命令，POI 列表数据已由 `tileActionStore.pois` 派生，POI 交互态数据（当前 iaid / 选材 / 反馈）轻量，单 store 足以承载，避免过度拆分。

**扩展文件：**

- [vex-vue/src/stores/tileAction.ts](file:///d:/wamp64/www/phpdts/vex-vue/src/stores/tileAction.ts) — `handleSearch(iaid, tool_id?, skill_id?)` 扩展签名，透传可选 `tool_id` / `skill_id` 到 `poi.search` payload
- [vex-vue/src/components/actions/TileActionBar.vue](file:///d:/wamp64/www/phpdts/vex-vue/src/components/actions/TileActionBar.vue) — 引入 PoiModal，移除现有内联 POI 模态框渲染（脚边道具模态框保留）
- [vex-vue/src/data/poi-locale.ts](file:///d:/wamp64/www/phpdts/vex-vue/src/data/poi-locale.ts) — 如有新增 POI 类型补充本地化（本案不强制扩展）

**后端合约真值源（不在本案实施范围，仅引用）：**

- [oblivions/include/command/obl_command_contract.php](file:///d:/wamp64/www/phpdts/oblivions/include/command/obl_command_contract.php) — `poi.search` 合约已定义：payload 为 `{iaid: int required, tool_id: string optional, skill_id: string optional}`（**单值字符串，非数组**），`itm0_allowed=false`，`advances_tick=true`，refresh 列表为 `player_info / tile_actions / player_inventory / obl_log`
- [oblivions/include/command/obl_command_handlers.php](file:///d:/wamp64/www/phpdts/oblivions/include/command/obl_command_handlers.php) — `poi.search` 命令分支调用 `obl_search_poi($pdata, $poi, $tool_id, $skill_id)`，结果通过 `$obl_log->emit('search.result', ...)` 等日志条目 + `tile_actions` scope 刷新回传前端（**不直接返回 `loot_dropped` / `materialized_items` / `event_result` 等响应字段**）
- [oblivions/include/api/obl_state_handlers.php](file:///d:/wamp64/www/phpdts/oblivions/include/api/obl_state_handlers.php) — `tile_actions` scope 返回 POI 列表（含 `items[]` 数组，已发现道具按 `source_iaid` 归属到对应 POI）；**当前不暴露概率字段**

### 2.3 组件树结构

```
TileActionBar.vue
└── PoiModal.vue (Teleport to body, 由 poiStore.modalOpen 控制)
    ├── [态 A] 列表态（modalMode === 'list'）
    │   └── 内联 POI 卡片渲染 × N（v-for 渲染当前格 POI，沿用 .tile-row 风格）
    │       ├── POI 名称 + 描述 + 搜索状态徽章（已搜索次数 / 未拾取掉落计数）
    │       └── [搜刮] / [再搜刮] / [查看掉落] 按钮 → poiStore.enterInteraction(iaid)
    │
    └── [态 B] 交互态（modalMode === 'interaction'）
        └── PoiInteraction.vue（两区布局：信息+操作区 / 反馈+道具区）
            ├── 上部：POI 信息区（名称 + 描述 + 搜索次数 + 已发现道具计数）
            ├── 中部：PoiToolSelector（工具/技能单选，可折叠）
            ├── 下部：[搜索] / [尝试堆叠合并] / [丢到地上] 按钮（itm0 锁定切换）
            └── 反馈区：PoiFeedbackPanel（最近一次搜索反馈 + 道具列表 + 拾取按钮）
```

**双态切换策略：** `poiStore.modalOpen` 控制 PoiModal 整体可见，`poiStore.modalMode`（`'list' | 'interaction'`）控制内部态。态切换由 store action 驱动而非组件内部 ref，便于命令响应回调强制切换态。

**列表态卡片复用：** 列表态卡片沿用 [TileActionBar.vue](file:///d:/wamp64/www/phpdts/vex-vue/src/components/actions/TileActionBar.vue) 现有 `.tile-row` 样式（`#888` 边框、`11px` 字号、`hover` 反色），保证视觉一致性。未拾取掉落徽章基于 `tileActionStore.pois[i].items.length` 派生（POI 的 `items[]` 数组已由 `tile_actions` scope 返回，无需额外查询）。

### 2.4 状态管理（单 store：poiStore）

**单 store 决策：** 原设计案拆分 `poi.ts` + `poi-interaction.ts` 双 store，前提是 `poi.inspect` 命令缓存与 `tile_actions` 派生分离。实际后端无 `poi.inspect` 命令，POI 列表数据已由 `tileActionStore.pois` 派生，POI 交互态数据（当前 iaid / 选材 / 反馈）轻量，单 store 足以承载，避免过度拆分。

#### 2.4.1 stores/poi.ts（poiStore）

**职责：**
- `modalOpen` / `modalMode`（`'list' | 'interaction'`）状态
- `currentIaid` 状态（当前交互的 POI 实例 iaid；列表态为 null）
- `selectedToolId` / `selectedSkillId` 状态（玩家选中的单个工具/技能 ID，对齐后端 `poi.search` 的 `tool_id` / `skill_id` 单值 payload）
- `lastSearchFeedback` 状态（最近一次 `poi.search` 命令的 CommandResult.message / feedback，用于 PoiFeedbackPanel 渲染）
- `searchLoading` / `pickupLoading` 状态
- `openModal()` / `closeModal()` action
- `enterInteraction(iaid)` action（列表态 → 交互态，初始化选材为空，记录 currentIaid）
- `exitInteraction()` action（交互态 → 列表态，清空选材与反馈）
- `setToolId(id)` / `setSkillId(id)` / `clearToolId()` / `clearSkillId()` action
- `doSearch()` action（提交 `poi.search` 命令，透传 `tool_id` / `skill_id`；成功后刷新 `tile_actions` 并写入 `lastSearchFeedback`）
- `pickupItem(iid)` action（提交 `item.pickup` 命令；成功后刷新 `tile_actions` + `player_inventory`）
- 监听 `battle:started` → 强制 `closeModal()` 并清空交互态

**派生计算属性：**
- `currentPoi` — 从 `tileActionStore.pois` 派生，按 `currentIaid` 匹配（交互态用）
- `poiList` — 直接派生 `tileActionStore.pois`（列表态用）
- `hasUnpickedLoot` — 任意 POI 的 `items.length > 0`（列表态视觉强调）
- `currentPoiItems` — 当前交互 POI 的 `items[]` 数组（交互态道具列表）
- `itm0Locked` — 派生 `useInventoryStore().itm0Locked`（与 craft.ts 同模式，不维护独立状态）
- `canSearch` — `commandQueue.canExecute('poi.search')` 派生，受 itm0 锁与模式锁拦截
- `canPickup` — `commandQueue.canExecute('item.pickup')` 派生，受 itm0 锁与模式锁拦截

**与 tileActionStore 的关系：** poiStore 不重新拉取 `tile_actions`，而是 `import { useTileActionStore }` 后 `computed` 派生 `tileActionStore.pois`。`tile_actions` scope 的失效/重载完全由 tileActionStore 承担，poiStore 只增加 modal 状态层 + 命令派发逻辑。`doSearch` / `pickupItem` 内部委托 `tileActionStore.handleSearch` / `tileActionStore.handlePickup`（已扩展签名），避免命令逻辑双写。

**R5 决策落实（itm0 锁定状态来源）：** `itm0Locked` 状态**不**从 `craftStore` 提升到全局 store。复用 `inventoryStore.itm0Locked` computed 派生（与 `craft.ts` 第 120 行 `const itm0Locked = computed(() => useInventoryStore().itm0Locked);` 同模式）。poiStore 的 `itm0Locked` 计算属性直接派生 `useInventoryStore().itm0Locked`，单一数据源，无需提升。

### 2.5 命令合约（前端调用，对齐后端真值源）

**真值源：** [obl_command_contract.php](file:///d:/wamp64/www/phpdts/oblivions/include/command/obl_command_contract.php)。前端 `command-registry.ts` 已注册 `poi.search` 与 `item.pickup`，无需新增命令规格。

| 命令 | 类型 | 模式 | 推进 tick | itm0 允许 | payload | 后端响应通道 |
|------|------|------|-----------|-----------|---------|--------------|
| `poi.search` | write | explore | 是 | 否 | `{iaid: int, tool_id?: string, skill_id?: string}`（**单值字符串**） | `$obl_log->emit('search.*')` 日志条目 + `tile_actions` scope 刷新（POI 的 `items[]` 数组反映物化道具）+ `CommandResult.message` / `feedback` |
| `item.pickup` | write | explore | 否 | 否 | `{iid: int}` | 复用现有合约（拾取野生道具同路径） |

> **关键修正（对照原设计案）：**
> - **无 `poi.list` 命令**：POI 列表由 `tile_actions` scope 提供，前端 `tileActionStore.pois` 已派生，无需新增命令。
> - **无 `poi.inspect` 命令**：原设计案的"实时概率预览"无后端支撑，ProbabilityBar 组件暂不实现。
> - **`poi.search` payload 是 `tool_id` / `skill_id` 单值字符串**（非 `tool_ids` / `skill_ids` 数组），对齐 `obl_command_contract.php` 的 `payload_schema`。
> - **`poi.search` 不直接返回 `loot_dropped` / `materialized_items` / `event_result` 等响应字段**：`obl_command_handlers.php` 的 poi.search 分支不捕获 `obl_search_poi()` 返回值，结果通过日志条目（`search.result` / `search.nothing_found` / `search.event_triggered` 等）+ `tile_actions` scope 刷新回传。
> - **POI 已发现道具通过 `tile_actions` scope 的 `pois[i].items[]` 数组返回**：后端 `obl_state_handle_tile_actions` 已将 `oblmapitem` 中 `source_iaid=POI.iaid AND discovered>0` 的道具归属到对应 POI，前端无需额外查询。

### 2.6 概率预览（占位，待后端扩展）

**当前状态：** 后端 `tile_actions` scope 不暴露 POI 概率字段（`base_loot_chance` / `base_good_event_chance` / `base_bad_event_chance` / `prob_mods_source`），无法在前端展示三档概率条。

**占位策略：** `ProbabilityBar.vue` 组件暂不实现。PoiInteraction 不渲染概率条区域，玩家直接根据 POI 描述与自身工具/技能判断是否搜索——这与原始设计案 §4.2 "界面信息透明"目标有差距，但避免无数据源的空壳组件。

**后续落地条件：** 后端扩展 `tile_actions` scope 暴露概率字段，或新增 `poi_preview` 参数化只读端点（类似 `craft_preview`）。落地后 ProbabilityBar 组件 + 防抖策略（复用 K-2 craft.ts 的 leading+trailing 200ms 模式）可直接接入。

### 2.7 搜索结果反馈链

**实际触发链（对齐后端合约）：**

```
玩家点击 [搜索] → poiStore.doSearch()
                ↓
                commandQueue.execute('poi.search', { iaid, tool_id?, skill_id? })
                ↓
                后端结算：obl_search_poi 调用 F-4 引擎
                       → 直接逐件 INSERT oblmapitem（source_iaid=POI.iaid, discovered=1）
                       + $obl_log->emit('search.result', { poi_name, items: [...] }) 日志条目
                       + CommandResult.success=true, CommandResult.message=渲染后的反馈文案
                ↓
                poiStore.lastSearchFeedback = CommandResult.message / feedback
                ↓
                dataManager.invalidate('tile_actions') + loadTileAction()
                ↓
                tileActionStore.pois 响应式更新 → currentPoi.items[] 反映新物化的道具
                ↓
                PoiFeedbackPanel 渲染 lastSearchFeedback（搜索反馈文案）
                + 渲染 currentPoi.items[]（道具列表 + 单件 [拾取] 按钮）
                ↓
                玩家点击 [拾取] → poiStore.pickupItem(iid)
                                ↓
                                commandQueue.execute('item.pickup', { iid })
                                ↓
                                后端 obl_pickup_item 流程（与野生道具一致）：
                                       DELETE oblmapitem 行 → itm0 暂存 → organize 入背包
                                ↓
                                dataManager.invalidate('player_inventory') + invalidate('tile_actions')
                                + broadcast('game:action-completed')
                                → tileActionStore.pois 响应式更新 → currentPoi.items[] 移除已拾取道具
```

**"再次呼出"实现：** 玩家关闭模态框后，已物化但未拾取的道具仍保留在 oblmapitem（`source_iaid=POI.iaid, discovered=1`）。玩家再次打开 POI 模态框 → 列表态显示该 POI 卡片有未拾取掉落徽章（基于 `tileActionStore.pois[i].items.length > 0`）→ 点击卡片进入交互态 → PoiInteraction 直接展示 `currentPoi.items[]` 道具列表 + 单件拾取按钮。**无需 `poi.inspect` 命令或 `unpicked_loot` 字段**，`tile_actions` scope 已提供全部所需数据。

**itm0 锁定下的 item.pickup：** `item.pickup` 的 `itm0Allowed=false`——若背包已满 itm0 锁定，item.pickup 被 K-3 第 3 层拦截，前端 toast 提示"请先处理手持道具"。玩家可选 `item.discard`（丢掉 itm0）或 `inventory.organize`（堆叠合并）解锁后再拾取掉落物。此路径与 [CraftModal itm0 锁定态](file:///d:/wamp64/www/phpdts/vex-vue/src/components/craft/CraftModal.vue) 一致，复用相同的两个解锁按钮 UI。

### 2.8 事件反馈区视觉切换

**PoiFeedbackPanel 三态：**

1. **空闲态（idle）：** 未执行搜索时显示 POI 描述文字（占位）
2. **搜索反馈态（feedback）：** `poi.search` 命令完成后切换，渲染 `poiStore.lastSearchFeedback`（CommandResult.message / feedback 渲染后的文案，通常为 `search.result` / `search.nothing_found` / `search.event_triggered` 等日志模板渲染结果）
3. **道具列表态（loot）：** `currentPoi.items.length > 0` 时显示（与反馈态并存，反馈态在上方，道具列表在下方）
   - 显示已发现道具列表（物品名 + 类别 + 效/耐 + 单件 [拾取] 按钮）
   - [全部拾取] 按钮逐件调用 `item.pickup`（poiStore.pickupAllItems）
   - 道具列表响应式更新——拾取后 `tile_actions` 刷新，`currentPoi.items[]` 自动移除已拾取道具

**反馈文案来源：** `poi.search` 命令的 `CommandResult.message` / `feedback` 字段，由后端 `$obl_log->emit('search.result', ...)` 等日志条目经 `command-feedback.ts` 的 `renderCommandFeedback` 渲染。前端 PoiFeedbackPanel 直接 `v-html` 渲染 `lastSearchFeedback`（与 CraftModal 反馈区 `v-html="feedbackHtml"` 同模式）。

**HP 槽同步：** 反馈区不维护独立 HP 状态。恶性事件扣 HP 后，`poi.search` 的 refresh 列表包含 `player_info`，`commandQueue.execute` 内部失效 `player_info` 缓存 + `playerStore.loadPlayerInfo(true)` 自动刷新，HP 槽响应式更新（由 StatusBar / PlayerDrawer 消费 `playerStore.playerInfo.hp`）。PoiFeedbackPanel 无需直接读取 HP。

**事件描述文案本地化：** 复用现有 [log-templates.ts](file:///d:/wamp64/www/phpdts/vex-vue/src/data/log-templates.ts) 的 `search.*` 模板条目（`search.result` / `search.not_found` / `search.already_searched` / `search.mechanic_triggered` 等）。后端 emit 的日志 ID 经 `renderLogEntry` 渲染为 HTML，无需新增 `POI_EVENT_LOCALE` 字典。新增事件 ID（如 `search.event_triggered`）按需扩展 `LOG_TEMPLATES`。

### 2.9 与命令门控集成

**模式锁：** POI 模态框打开期间 `battleStore.currentMode` 保持 `'explore'`，所有 POI 命令的 `mode='explore'` 通过 K-3 第 4 层模式锁检查。若收到 `battle:started` 事件（如恶性事件触发遭遇战），`battleStore.currentMode` 切到 `'battle'`，poiStore 监听此事件强制 `closeModal()`。

**强制关闭流程：**

```
battle:started 广播
  ↓
poiStore 监听器收到事件
  ↓
closeModal()  // modalOpen=false, modalMode='list', currentIaid=null
  + 清空 selectedToolId / selectedSkillId / lastSearchFeedback
```

战斗结束后 `battle:ended` 事件触发，POI 模态框**不自动重新打开**——玩家需手动点击 POI 按钮重新进入。这避免战斗结束瞬间的视觉抖动，也符合"战斗是打断事件，玩家应主动恢复探索节奏"的设计意图。

**itm0 锁定下：**
- POI 模态框可正常打开与浏览（POI 列表/详情/道具列表均可见）
- `poi.search` 拦截（`itm0Allowed=false`）——搜索按钮禁用，title 提示"你正手持道具，请先处理"
- `item.pickup` 拦截——单件拾取按钮禁用，提示同上（itm0 锁定下无法拾取任何道具，包括 POI 产出与野生）
- 搜索按钮区替换为 [尝试堆叠合并] / [丢到地上] 两个解锁按钮（与 CraftModal itm0 锁定态一致），点击触发 `inventoryStore.handleOrganize` / `handleDiscardItm0`

**HTTP 锁与冷却：** `commandQueue.isLocked` 期间所有 POI 命令按钮禁用（K-3 第 1 层）；冷却期间同理。`canExecute(command)` 派生按钮 `:disabled`，与 [ExploreButton disabled 派生](file:///d:/wamp64/www/phpdts/vex-vue/src/components/actions/ExploreButton.vue) 模式一致。

**演出水位锁：** POI 命令的 `mode='explore'`，第 4 层演出水位锁不拦截（仅拦截 `mode='battle'` 命令）。POI 模态框打开期间若有未消费的战斗演出，由 K-3 自行处理。

### 2.10 具体案例

#### 案例 A：玩家首次进入一格有 1 个可搜刮 POI 的地图格

1. `map:loaded` → `tileActionStore.loadTileAction()` 拉取 `tile_actions` scope
2. TileActionBar 检测 `tileActionStore.pois.length > 0` → 显示 POI 模态框入口按钮（沿用现有 `.tile-row is-action` 风格，POI 列表条目即入口）
3. 玩家点击 POI 条目 → `poiStore.openModal()` → `modalOpen=true, modalMode='list'` → PoiModal 渲染列表态
4. 列表态显示 1 张 POI 卡片，玩家点击卡片 → `poiStore.enterInteraction(iaid)` → `modalMode='interaction'`
5. PoiInteraction 展示 POI 名称 + 描述 + 搜索次数（0/0 表示单次 POI，0/3 表示可重复 3 次）+ 空道具列表 + PoiToolSelector（可选）+ [搜索] 按钮
6. 玩家在 PoiToolSelector 勾选"开锁器"（可选）→ `poiStore.setToolId('lockpick')`
7. 玩家点击 [搜索] → `doSearch()` → `commandQueue.execute('poi.search', {iaid, tool_id:'lockpick'})` → 后端结算（F-4 引擎掷骰 + 直接逐件 INSERT oblmapitem） → emit `search.result` 日志 + CommandResult.success=true
8. `poiStore.lastSearchFeedback = CommandResult.message`（渲染后的"你搜索了xxx，发现了yyy"文案）
9. `dataManager.invalidate('tile_actions')` + `tileActionStore.loadTileAction()` → `tileActionStore.pois` 响应式更新 → `currentPoi.items[]` 反映新物化的 2 件道具
10. PoiFeedbackPanel 显示反馈文案 + 道具列表（2 件）+ 单件 [拾取] 按钮 + [全部拾取] 按钮
11. 玩家点击 [拾取] → `pickupItem(iid)` → `item.pickup` → 背包刷新 + tile_actions 刷新 → 该件从 `currentPoi.items[]` 移除 → 全部拾取后道具列表为空

#### 案例 B：玩家在已搜刮过的 POI 上再次搜刮（可重复 POI）

1. 列表态显示该 POI 卡片，徽章为"已搜索 1/3"（`search_count=1, repeat_limit=3`）
2. 玩家点击卡片进入交互态 → PoiInteraction 显示 POI 信息 + 空道具列表 + [再搜索] 按钮
3. 玩家不选工具直接搜索 → 后端掷骰无产出 → emit `search.nothing_found` 日志 → CommandResult.message="你搜索了xxx，但什么也没找到"
4. PoiFeedbackPanel 显示"什么也没找到"文案，道具列表保持空
5. 玩家关闭模态框 → 道具列表为空，列表态卡片无未拾取掉落徽章

#### 案例 C：同格多 POI，部分有未拾取掉落

1. 列表态显示 3 张 POI 卡片：POI-1（未拾取掉落 ×2）、POI-2（无）、POI-3（已搜索 ×1/3）
2. POI-1 卡片显示 `*2` 徽章（未拾取掉落计数，基于 `tileActionStore.pois[0].items.length`）
3. 玩家点击 POI-1 → `enterInteraction` → PoiInteraction 直接展示 `currentPoi.items[]` 道具列表 + 单件 [拾取] 按钮 + [全部拾取] 按钮（无需先搜索）
4. 玩家逐件拾取后 → `currentPoi.items[]` 响应式移除 → 切回列表态显示 POI-1 已无未拾取掉落徽章

#### 案例 D：POI 模态框打开期间触发战斗

1. 玩家在交互态选材中
2. 后端 NPC 主动发起战斗 → `battle:started` 事件广播
3. poiStore 监听器 → `closeModal()` → 模态框关闭 + 清空交互态
4. `battleStore.currentMode='battle'` → 战斗模态框打开
5. 战斗结束后 → 玩家手动点击 POI 条目重新进入（已物化到 oblmapitem 的未拾取道具仍保留，source_iaid=POI.iaid 不变）

### 2.11 边界案例

#### 边界 1：POI 列表为空

`tileActionStore.pois.length === 0` → TileActionBar 不渲染 POI 条目（现有 `isEmpty` 检查覆盖）。玩家无法看到 POI 模态框入口。

#### 边界 2：可重复 POI 达到搜索上限

`search_count >= repeat_limit` → POI 卡片显示"已达上限"灰字 + 禁用 [搜刮] 按钮。玩家仍可进入交互态查看已拾取/未拾取道具，但 [搜索] 按钮 `:disabled="!canSearch"`。

#### 边界 3：模态框打开时收到战斗事件

K-3 模式锁切换到 `'battle'` → §2.9 强制关闭流程。**未拾取道具不丢失**——已物化的道具持久化在 `oblmapitem` 表（`source_iaid=POI.iaid, discovered=1`），玩家战后重新进入 POI 模态框通过 `tile_actions` scope 刷新的 `pois[i].items[]` 字段取回。但若战斗中玩家死亡，未拾取道具随地图格保留（其他玩家可通过 item.pickup 拾取，归属扫雷机制设计案范围）。

#### 边界 4：POI 产出道具被其他事件清除

理论上不会发生——POI 产出道具 `discovered=1`，不被探索流程的"发现"机制清除；只有玩家主动 `item.pickup` 才会从 oblmapitem 中 DELETE。若因极端情况（如 GM 操作、数据修复脚本误删）导致 oblmapitem 行丢失：
- `tile_actions` scope 刷新后 `currentPoi.items[]` 缩短或为空
- 前端道具列表响应式更新，显示剩余道具或自动空
- 不会引发前端异常，因列表渲染基于响应数据动态生成

#### 边界 5：itm0 锁定下进入 POI 模态框

`itm0Locked=true` 时：
- POI 模态框可正常打开与浏览（POI 列表/详情/道具列表均可见）
- [搜索] 按钮 `:disabled="!canExecute('poi.search')"`，单件 [拾取] 按钮 `:disabled="!canExecute('item.pickup')"`
- 搜索按钮区替换为 [尝试堆叠合并] / [丢到地上] 两个解锁按钮（与 CraftModal itm0 锁定态一致），点击触发 `inventoryStore.handleOrganize` / `handleDiscardItm0`
- 解锁后 itm0Locked 变 false，[搜索] / [拾取] 按钮恢复可用

#### 边界 6：玩家在搜索命令执行期间关闭模态框

`commandQueue.isLocked=true` 期间所有按钮禁用，但模态框遮罩仍可点击关闭。关闭后：
- poiStore 状态保留 `currentIaid`，不强制清空（避免响应到达时找不到上下文）
- 响应到达后 `lastSearchFeedback` 正常写入，但 `modalOpen=false` 时不触发 UI 切换
- 玩家重新打开模态框时，PoiInteraction 直接展示 `currentPoi.items[]`（已物化道具）

#### 边界 7：网络异常导致 poi.search 超时

`commandQueue.execute` 内部 `fetchWithTimeout` 15s 超时 → 返回 `CommandResult.success=false, error='NETWORK_ERROR'` → `doSearch` 不写入 `lastSearchFeedback` → toast 提示"搜索失败：网络异常" → 模态框保持打开，玩家可重试。**不强制关闭模态框**——网络异常是临时状态，玩家应保留决策上下文。

#### 边界 8：玩家在交互态收到 map:loaded 事件

`map:loaded` 通常意味着玩家移动到了新格子，旧 POI 列表已失效。poiStore 监听 `map:loaded` → 强制 `closeModal()`。玩家需在新格子重新打开模态框。这避免玩家在已离开的格子上继续操作 POI 的逻辑错乱。

#### 边界 9：工具/技能不可用（已被消耗或脱离背包）

PoiToolSelector 的工具列表派生自 `inventoryStore.slots`，响应式更新。若玩家在 POI 模态框外通过其他命令消耗了某工具（如丢弃），下次渲染时该工具从列表移除；若该工具已被 `selectedToolId` 选中，则自动清空 `selectedToolId`。

***

## 三、附录：与原始设计案 §4 的对照

| 原始设计案条款 | 本案落地 |
|--------------|---------|
| §4.1 按钮（脚边道具右侧出现 POI 交互按钮） | TileActionBar 统一交互列表中的 POI 条目（v-for 渲染），点击触发 `poiStore.openModal()` |
| §4.2 模态框（每个 POI 一张带操作按钮的卡片） | PoiModal 列表态内联渲染 POI 卡片（名称 + 描述 + 徽章 + 入口按钮），无独立 PoiCard 组件 |
| §4.2 左侧 POI 信息区（场景插图 + 文字介绍） | PoiInteraction 上部 POI 信息区（垂直布局，非左右分栏）：名称 + 描述 + 搜索次数 + 道具计数 + 机制结果 |
| §4.2 中上部交互区（实时概率条 + 掉落池预览） | PoiInteraction 中部 PoiToolSelector + 搜索按钮；**ProbabilityBar 占位未实现**（后端 tile_actions scope 未暴露三档概率字段），掉落池预览未实现 |
| §4.2 中下部反馈区（已放入的工具、技能） | PoiInteraction 下部 PoiFeedbackPanel（注：原始描述"已放入的工具技能"在本案中改为"事件反馈 + 掉落物展示"，因工具技能选择已在中部 PoiToolSelector 可视化，反馈区承担更核心的事件/掉落信息） |
| §4.2 右侧交互区（可用工具技能） | PoiInteraction 中部 PoiToolSelector（可折叠，集成进垂直布局，非独立右侧列） |
| §4.3 掉落物首次主动弹出 | §2.7 触发链：`poi.search` 成功 → tile_actions scope 失效刷新 → `currentPoi.items[]` 响应式更新 → PoiFeedbackPanel 自动展示道具列表（**不依赖 loot_dropped 响应字段**，后端 poi.search 不直接返回该字段） |
| §4.3 之后通过 POI 交互按钮再次呼出 | §2.7 "再次呼出"实现：玩家重新打开 POI 模态框 → `poiStore.poiList` 派生 `tileActionStore.pois` → `currentPoi.items[]` 基于 `WHERE source_iaid=POI.iaid AND discovered=1` 的 oblmapitem 行集响应式展示未拾取道具（**无 poi.inspect 命令**，数据直接由 tile_actions scope 提供） |
| §4.4 意外事件（图像区切换 + 描述 + HP 扣减） | §2.8 PoiFeedbackPanel 反馈态：`poiStore.lastSearchFeedback` 渲染 CommandResult.message（v-html，含后端 search.result / search.event_triggered 日志条目转译的 HTML） |
| §4.4 无事发生（"这次什么也没找到"） | PoiFeedbackPanel 反馈态：CommandResult.message 渲染"什么也没找到"文案（与有掉落时同态展示，道具列表区为空不渲染） |

**与原始设计案的偏离：**

1. **§4.2 中下部反馈区语义重定义：** 原始描述为"已放入的交互工具、技能"，但本案将工具技能选择放在右侧区（玩家可见已选项），反馈区承担"事件反馈 + 掉落物展示"更核心的信息。这一调整符合 §7.6"界面信息透明"——反馈区是玩家决策后的结果展示，比"已放入工具列表"更重要。
2. **不引入容器装填 UI：** 用户明确去除容器概念，§8.3 占位不实现。掉落物以散件形式展示与取走。
3. **掉落物显式拾取步骤：** 原始设计案未规定掉落物是否自动入背包，本案通过 `item.pickup` 命令显式分离"搜索"与"拾取"两个动作，支持"看了不取"的玩法（如稀有但重的物品需要决策）。POI 搜刮产出物直接物化到 oblmapitem（source_iaid=POI.iaid, discovered=1），与野生道具同路径拾取。

**§4.3 "掉落物保存在 POI 自己的已发现道具表里" 的实现方式：**

| 维度 | 实现 |
|------|------|
| 物理存储 | `oblmapitem` 表中 `source_iaid=POI.iaid` 的道具行集 |
| 语义一致性 | 仍然是"POI 自己的已发现道具表"——通过 source_iaid 字段在物理表上划出虚拟子集 |
| 查询入口 | `WHERE source_iaid=POI.iaid AND discovered=1` 返回该 POI 产出且未拾取的道具 |
| 与野生道具的区分 | source_iaid=0 为野生道具，source_iaid>0 为 POI 产出道具；两者共享相同的 item.pickup 拾取流程 |
| 旧实现对照 | 从 `bra_oblmappoi.pending_loot` JSON 字段变为 oblmapitem 行集；语义不变，物理存储从 JSON 字段变为关系表行集，更易查询与维护 |
