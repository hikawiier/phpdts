# Vex-Vue 合成界面设计案

> 本案定义 Oblivions 合成系统的前端界面设计与实现方案。
>
> 后端接口与数据层详见《道具使用与合成系统-设计案.md》。
> 系统钩子 Tag 详见《道具-系统钩子Tag设计案.md》。

---

## 一、设计目标

### 1.1 目标

| 目标 | 实现方式 |
|------|---------|
| 玩家能进入合成界面，查看可用素材 | ACTIONS 区按钮 + C 键快捷键 → CraftModal |
| "确认函"模式：放素材→系统判断→亮/灭 | 素材池选择 → `craft_preview` 实时预判 → 合成按钮状态反馈 |
| 工作台素材可选用 | 实时计算可用工作台列表（被动技能 + POI），与背包素材统一进池 |
| 已发现配方可浏览、可快速合成 | 可折叠列表，点击配方自动选材填充素材池 |
| 未发现配方可"试出来" | 放素材→匹配到未发现配方→合成成功→"发现新配方！" |
| 软锁不影响合成可行性 | 已发现配方列表经过 `item_recipe_visibility_filter` 过滤，但合成命令不做此检查 |

### 1.2 范围

**在本案范围内**：
- CraftModal 组件（核心合成交互界面）
- craft Store（合成状态管理）
- API 调用封装（`craft_preview` / `craft_workbench_materials` / `craft_recipes` / `obl_craft`）
- 合成入口（ACTIONS 按钮 + 快捷键）
- 已发现配方列表（快速合成入口）
- 相关 TypeScript 类型扩展

**不在本案范围内**：
- 后端合成逻辑（归属《道具使用与合成系统-设计案.md》）
- 合成日志渲染（已在 `log-templates.ts` 中实现）
- 猫的合成提醒（归属对话系统）
- 工作台 POI 的添加与配置（归属地图设计）

---

## 二、整体架构

### 2.1 组件树

```
App.vue
├── RightPanel.vue
│   └── TileActionBar.vue
│       ├── ExploreButton ([E] 探索)
│       ├── [C] 合成 ← 新增入口（与 [E] 同级）
│       └── (POI/ground 内联模态)
└── CraftModal.vue ← 新增：Teleport to body 浮动模态框
    └── CraftRecipeList.vue ← 新增：已发现配方列表子组件
```

### 2.2 数据流

```
玩家操作                    Store               API
─────────────────────────────────────────────────────
点击 ACTIONS [C] 按钮 ─→ craftStore.openModal()
                         ├── dataManager.fetch(craft_workbench_materials)
                         ├── dataManager.fetch(craft_recipes)
                         └── 读取 inventory store 已有数据（无需额外 fetch）
                         └→ 设置 craftModalOpen=true

点击背包素材槽位 ──────→ craftStore.toggleBackpackSlot(slot)
点击工作台素材 ────────→ craftStore.toggleWbMaterial(id)
                         └→ craftStore.refreshPreview()
                              └── debounce 200ms
                                   └── gameApiWithParams('craft_preview', {slots, workbench_materials})
                                        └→ 更新 previewResult + previewLogs

点击 [合成] 按钮 ─────→ craftStore.doCraft()
                         └── commandQueue.execute()
                              └── POST obl_craft
                              └→ 成功: invalidate(inventory) + broadcast + close/toast

点击配方行 ────────────→ craftStore.quickCraft(recipeId)
                         └→ 自动计算所需素材
                         └→ 自动填充 backpackSlots + wbMaterialIds
                         └→ refreshPreview() → doCraft()
```

### 2.3 与现有模式的一致性

| 模式 | 合成系统 | 参考来源 |
|------|---------|---------|
| Pinia Composition API store | `stores/craft.ts` | `stores/tileAction.ts` |
| 模态框内联交互 | `CraftModal.vue` 独立模态 | `TileActionBar.vue` 内联 modal 模式 |
| 写命令通过 commandQueue | `commandQueue.execute({ command: 'obl_craft', ... })` | `stores/tileAction.ts:handleSearch` |
| 读 API 通过 dataManager（无参） | `dataManager.fetch('craft_workbench_materials')` | `stores/inventory.ts:loadInventory` |
| 读 API 直接调用（带参） | `gameApiWithParams('craft_preview', params)` | 无现有模式需对照，因 craft_preview 需要传参 |
| 操作后失效+广播 | `invalidate + broadcast('game:action-completed')` | `stores/tileAction.ts` |
| 名称通过 locale 渲染 | `getItemName()`, `getRecipeName()` | `data/item-locale.ts`, `data/recipe-locale.ts` |
| 快捷键 | `C` 键打开合成、`ESC` 关闭合成 | `App.vue:onKeydown`（ESC 级联扩展） |

---

## 三、CraftModal 布局

### 3.1 三列布局

沿用游戏主界面"左观看、右操作"的布局习惯，合成界面分为三列：

```
┌─ [C] 合成 ────────────────────────────────────────────── [X] ─┐
│                                                                  │
│  左（参考）25%      中（状态/反馈）30%    右（操作）45%        │
│  ┌──────────────┐ ┌──────────────────┐ ┌──────────────────────┐ │
│  │ ⑤ 已发现配方│ │ ① 素材池        │ │ ② 背包素材          │ │
│  │ ▼ 食物(2)   │ │ [槽3] 布料×3    │ │ [1] 布料×5  ✓       │ │
│  │  烤兔肉      │ │     消耗 3/5    │ │ [2] 废铁片×3        │ │
│  │  简易炖菜    │ │ [⚒] 铁砧        │ │ [3] 生兔肉×1 ✓      │ │
│  │ ▼ 工具(1)   │ │     (tool:1)     │ │ [4] 刀片碎片×1      │ │
│  │  绷带        │ │ 合计 2 件素材   │ │                     │ │
│  │ ▼ 武器(1)   │ │                  │ │ ③ 工作台候选        │ │
│  │  布包刀刃    │ │ ④ 反馈         │ │ ☑ 徒手合成(t:0)    │ │
│  │              │ │ ✓ 发现新配方！  │ │ ☐ 铁砧(t:1)        │ │
│  │              │ │               │ │                     │ │
│  │              │ │               │ │ ┌────────────────┐  │ │
│  │              │ │               │ │ │  [合成]（高亮） │  │ │
│  │              │ │               │ │ └────────────────┘  │ │
│  └──────────────┘ └──────────────────┘ └──────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

**各列与游戏界面元素的对应关系**：

| 列 | 类比游戏界面 | 职责 | 交互形式 |
|----|------------|------|---------|
| 左（参考） | 地图区（信息展示） | 已发现配方浏览 | 只读，点击配方行触发快速合成 |
| 中（状态） | StatusBar（实时反馈） | 素材池 + 预判反馈 | **纯展示，无交互元素** |
| 右（操作） | ACTIONS 区（交互入口） | 选材 + 移除 + 合成 | **所有可点击元素集中在此** |

### 3.2 各列设计要点

**左列（参考）— ⑤ 已发现配方**：
- 通过 `craft_recipes` API 加载（2s 缓存）
- 默认折叠，按 `category` 分组（`food` / `tool` / `armor` / `weapon`），每组可独立折叠展开
- 每组显示：`▼ 食物(2)` → 展开后列出 `配方名称`
- 点击配方行任意位置触发快速合成（整个行都是热区，不局限于 [快速] 按钮）
- 此列是纯参考区，不参与选材或状态显示

**中列（状态）— ① 素材池 + ④ 反馈**：
- **① 素材池**（上部）：
  - 显示已选背包素材：`[槽位号] 名称 ×数量 + 消耗 X/N`
  - 显示已选工作台素材：`[⚒] 名称 (tool:N)`
  - 显示素材合计数量：`合计 N 件素材`
  - 素材池为空时显示"尚未选择素材"
- **④ 反馈区**（下部）：
  - 渲染 `preview_logs`（复用 `log-templates.ts` 模板）
  - 仅显示状态文字，不含交互按钮
  - 根据匹配状态显示不同颜色（绿色=可合成，黄色=指向不明确，灰色=无法合成）
- **中列无任何交互元素**（按钮、复选框、输入框），确保玩家只看不点

**右列（操作）— ② 背包素材 + ③ 工作台候选 + 合成按钮**：
- **② 背包素材列表**（上部）：
  - 从 inventory store 读取 slots[]，过滤空槽位
  - 每行：`[槽位号] 名称 ×数量` + ✓ 选中指示
  - 点击切换选中/取消（再次点击已选中的槽位取消选中，替代 ① 中的 [×] 移除按钮）
  - **数量处理**：前端以整个槽位为单位选择，不提供数量选择器。后端从 `itms` 读取堆叠数量参与匹配与消耗。例如槽1 布料×5 被选中 → 后端读到 `itms=5` → 配方需 3 块 → 消耗后槽1 剩余 2 块。同种素材跨多个槽位时，后端汇总 `itms` 后统一匹配。
- **③ 工作台候选**（中部）：
  - 从 `craft_workbench_materials` API 返回的列表渲染
  - 每行：`checkbox + 名称 + (来源·tool:N)`
  - 默认选中规则：**仅** `source='passive'` 的被动技能默认选中
  - POI 来源不默认选中（避免"多放素材导致 0 匹配"）
  - 再次点击已选中的工作台取消选中
- **合成按钮**（底部）：
  - 根据 `previewResult.craftable` 决定启用/禁用
  - 按钮文字固定为"合成"，通过 ④ 的文案传达具体状态
  - 置于右列底部，与中列④的反馈文字对齐在相同视觉高度

### 3.3 动效/反馈

- 素材选择/取消时：简单的高亮过渡（CSS transition）
- 合成成功时：模态框关闭（让玩家看到日志变化和背包更新），log 中渲染 `craft.success`
- 新配方发现：`craft_preview` 返回 `is_new_recipe=true` 时，按钮文字变为"发现新配方！"（黄色高亮），点击合成后日志显示 `craft.new_recipe_discovered`

### 3.4 `preview_logs` 结构化反馈

`craft_preview` 的响应新增 `preview_logs` 数组，用于在区④显示详细的合成预判反馈，复用 `log-templates.ts` 的 `craft.*` 模板渲染：

**响应的日志 ID 与对应文案**：

| 条件 | 日志 ID | 渲染文案 |
|------|---------|---------|
| 素材池为空 | `craft.empty_pool` | "放入素材才能合成" |
| match_count=0，缺少工具 | `craft.tool_missing` | "需要合适的工具（如烹饪器具/锻造工具）" |
| match_count=0，有多余素材 | `craft.extra_material` | "有些素材用不上，试试移除部分素材" |
| match_count=0，素材不够 | `craft.insufficient` | "素材不足，试试放入更多同类素材" |
| match_count=0，无匹配配方 | `craft.fail_no_match` | "这些素材无法合成任何东西" |
| match_count≥2 | `craft.fail_ambiguous` | "素材指向不明确（匹配 {count} 个配方）" |
| match_count=1，可合成 | `craft.ready` | "可合成" |
| match_count=1，新配方 | `craft.new_recipe` | "发现新配方！" |

**实现方式**：后端 `craft_preview` 在 `match_count=0` 时，由 `item_match_recipes_by_slots` 返回失败原因枚举，前端将枚举映射为结构化日志 ID，通过 `renderLogEntry` 函数渲染为 HTML 片段显示在区④。

> **注意**：`preview_logs` 的每个条目需要被转换为 `LogEntry` 再传入 `renderLogEntry`，因为 `renderLogEntry` 期望完整的 LogEntry 结构。前端在渲染时构造 `{ id, params, html: null, debug: false, ts: 0, logcategory: 'craft' }` 传入。

---

## 四、Store 设计

### 4.1 `stores/craft.ts` 接口

```typescript
export const useCraftStore = defineStore('craft', () => {
  // ── 状态 ──
  const craftModalOpen = ref(false)
  const backpackSlots = ref<number[]>([])        // 已选背包槽位
  const wbMaterialIds = ref<string[]>([])        // 已选工作台素材 ID
  const availableWbMaterials = ref<WorkbenchMaterial[]>([])
  const previewResult = ref<CraftPreviewResult | null>(null)
  const previewLogs = ref<LogEntry[]>([])        // 预判反馈日志（供区④渲染）
  const discoveredRecipes = ref<CraftRecipe[]>([])
  const loading = ref(false)
  // 细分 loading 状态
  const loadingWb = ref(false)
  const loadingRecipes = ref(false)
  const loadingPreview = ref(false)

  // ── 计算属性 ──
  const isCraftable = computed(() => previewResult.value?.craftable ?? false)
  const matchCount = computed(() => previewResult.value?.match_count ?? 0)
  const isNewRecipe = computed(() => previewResult.value?.is_new_recipe ?? false)
  const hasSelection = computed(() => backpackSlots.value.length > 0 || wbMaterialIds.value.length > 0)

  // ── 动作 ──
  async function openModal(): Promise<void>
  function closeModal(): void
  function toggleBackpackSlot(slot: number): void
  function toggleWbMaterial(id: string): void
  function removeBackpackSlot(slot: number): void
  function removeWbMaterial(id: string): void
  async function refreshPreview(): Promise<void>    // debounced 300ms
  async function doCraft(): Promise<void>
  async function quickCraft(recipeId: string): Promise<void>
})
```

### 4.2 状态变更流程

```
toggleBackpackSlot / toggleWbMaterial
  → 更新 backpackSlots / wbMaterialIds
  → refreshPreview (debounced 200ms)
       → loadingPreview = true
       → 拼接 slots=backpackSlots.join(',')
       → 拼接 workbench_materials=wbMaterialIds.join(',')
       → gameApiWithParams('craft_preview', {slots, workbench_materials})
       → 更新 previewResult + previewLogs
       → loadingPreview = false
       → 响应式触发 ④ 状态更新

openModal
  → 并行加载:
       loadingWb = true, loadingRecipes = true
       dataManager.fetch('craft_workbench_materials')
       dataManager.fetch('craft_recipes')
  → inventory 数据复用 inventoryStore（已在打开前加载）
  → 设置默认值：被动技能（source='passive'）默认选中
  → loadingWb = false, loadingRecipes = false
  → craftModalOpen = true

closeModal
  → 清除 _debounceTimer（防止卸载后触发 preview）
  → 重置 backpackSlots, wbMaterialIds, previewResult, previewLogs = null
  → craftModalOpen = false

doCraft
  → const params = {
       command: 'obl_craft',
       slots: backpackSlots.value.join(','),
       workbench_materials: wbMaterialIds.value.join(','),
     }
  → commandQueue.execute(params)
  → 成功:
       dataManager.invalidate('player_inventory')
       dataManager.broadcast('game:action-completed')
       closeModal()
       // 后端已 emit craft.success，前端 log 自动刷新
  → 失败:
       broadcast('ui:toast', { type: 'error', msg })
```

---

## 五、API 集成

### 5.1 新增常量

`api/endpoints.ts` 新增：

```typescript
export const API_ACTIONS = {
  // ... 现有常量
  CRAFT_PREVIEW: 'craft_preview',
  CRAFT_WORKBENCH_MATERIALS: 'craft_workbench_materials',
  CRAFT_RECIPES: 'craft_recipes',
} as const;
```

### 5.2 新增带参 GET 方法

`api/client.ts` 新增：

```typescript
/**
 * 带参只读 API：GET api_v2.php?action=xxx&key=val&...
 * 供 craft_preview 等需要查询参数的端点使用
 */
async function gameApiWithParams(
  action: ApiAction,
  params: Record<string, string>,
): Promise<ApiResponse>
// → GET api_v2.php?action=craft_preview&slots=1,3,5&workbench_materials=poi:123
```

### 5.3 请求/响应映射

| API | 请求参数 | 响应 data | 缓存策略 |
|-----|---------|-----------|---------|
| `craft_preview` | `slots=1,3,5` + `workbench_materials=poi:123` | `{match_count, craftable, is_new_recipe, preview_logs?: [{id, params}]}` | 不缓存，每次刷新 |
| `craft_workbench_materials` | 无 | `{workbench_materials: [...]}` | 不缓存（POI 位置变化） |
| `craft_recipes` | 无 | `{recipes: [...]}` | 2s 白名单缓存（与 player_inventory 一致） |
| `obl_craft` (POST) | `command=obl_craft` + `slots` + `workbench_materials` | `{}`（标准命令响应） | - |

---

## 六、TypeScript 类型扩展

`types/api.ts` 新增：

```typescript
// craft_preview 响应
export interface CraftPreviewResult {
  match_count: number
  craftable: boolean
  is_new_recipe: boolean
  preview_logs?: PreviewLog[]   // 预判反馈（后端按原因枚举生成）
}

// 预判日志条目（与 LogEntry 结构一致，复用 renderLogEntry）
export interface PreviewLog {
  id: string          // 如 'craft.tool_missing' | 'craft.extra_material' | ...
  params: Record<string, string | number | boolean>
}

// workbench_materials 的元素
export interface WorkbenchMaterial {
  source: 'passive' | 'cat' | 'poi'
  id: string
  item_id: string
  tool_level: number
  tags: string[]       // 道具 tags（供 quickCraft 匹配 tag 类型槽位）
  itmk: string         // 道具类别（供 quickCraft 匹配 itmk 类型槽位）
}
// 注意：后端 API 需补充 tags 和 itmk 字段，前端需要这些信息用于
//       quickCraft 的本地匹配，避免为每个素材发起额外请求

// craft_workbench_materials 响应
export interface CraftWorkbenchMaterialsResponse {
  workbench_materials: WorkbenchMaterial[]
}

// craft_recipes 的元素
export interface CraftRecipe {
  recipe_id: string
  category: string
  materials: CraftMaterial[]
  results: CraftResult[]
}

// 配方素材项
export interface CraftMaterial {
  item_id?: string
  itmk?: string
  tag?: string
  count: number
  consume?: 'all' | 'durability' | 'none'
  min_level?: number
  [key: string]: unknown
}

// 配方产物项
export interface CraftResult {
  item_id: string
  count: number
  [key: string]: unknown
}

// craft_recipes 响应
export interface CraftRecipesResponse {
  recipes: CraftRecipe[]
}
```

---

## 七、关键交互决策

### 7.1 "确认函"的实现

素材池变化时调用 `craft_preview`，**只反馈能不能合成，不显示产物名称**。保持探索感。产物名称在合成成功后才通过日志显示。

### 7.2 防抖策略

`refreshPreview` 使用 200ms debounce：
- 用户快速点选多个素材时不会触发多次 API
- 只在素材池稳定后才发送预判请求
- 200ms 相比 300ms 减少感知延迟，适合快速点选场景

**实现方式**：在 store 中用 `_debounceTimer`（`ReturnType<typeof setTimeout>`）存储 timer 引用，每次调用时 `clearTimeout` 旧 timer 再设新 timer。`closeModal` 中调用 `clearTimeout` 防止卸载后触发脏请求。

### 7.3 快速合成的素材匹配策略

`quickCraft(recipeId)` 的实现逻辑：

1. 读取该配方的 `materials` 数组
2. 对每个 material，按 consume 类型分支：
   - **`consume='none'`**（工作台/工具类素材）：
     - 从工作台素材 `availableWbMaterials` 中查找匹配项
     - 匹配条件：`tags` 包含 material 的 `tag`（或 `itmk` 匹配）+ `tool_level >= min_level`
     - 选中第一个匹配的工作台素材
   - **`consume='all'` 或 `consume='durability'`**（背包素材）：
     - `item_id` 类型：从背包找到该 item_id 的第一个非空槽位，选中
     - `itmk` 类型：从背包找到 itmk 匹配的第一个非空槽位，选中
     - `tag` 类型：从背包找到 tags 含该 tag 的第一个非空槽位，选中
   - **匹配优先级**：`item_id` > `itmk` > `tag`（与后端一致，避免同一素材被误匹配到多个槽位）
3. 不足的素材（未找到匹配）→ 提示"素材不足"，不做填充，停止 quick craft
4. 全部匹配 → 自动填充 backpackSlots + wbMaterialIds → 触发 refreshPreview
5. 同一背包槽位不能同时匹配多个 material 槽位（由步骤 2 的顺序保证）

> **注意**：`consume='durability'` 的素材（如布包刀刃配方中的锐器，扣耐久不消耗）走背包匹配，不从工作台匹配。

### 7.4 模态框关闭策略

- 点击右上角 [X] 或 ESC → 关闭，重置素材选择状态
- 合成成功后 → 关闭模态框（让玩家看到日志和背包变化）
- 合成失败（如背包满）→ 保持打开，④ 显示失败原因

### 7.5 ESC 键处理

`App.vue:onKeydown` 的 ESC 级联需扩展以感知 CraftModal：

```
ESC 键按下
  ├→ craftStore.craftModalOpen? → 关闭 CraftModal（停止传递）
  ├→ uiStore.modalOpen? → 关闭通用 Modal
  ├→ uiStore.inventoryDrawerOpen? → 关闭右抽屉
  └→ uiStore.playerDrawerOpen? → 关闭左抽屉
```

CraftModal 优先级最高（它是当前聚焦的交互界面），不应关闭通用 Modal 或抽屉。

### 7.6 素材消耗提示

中列 ① 中每个已选背包素材显示消耗情况：

- 对于 `consume='all'` 素材：`[槽3] 布料×5  消耗 3/5`
- 对于 `consume='durability'` 素材：`[槽4] 刀片碎片×1  扣 1 耐久`
- 对于 `consume='none'` 素材（工作台）：`[⚒] 铁砧  (tool:1) 不消耗`

消耗数量从匹配到的配方的 `materials[].count` 获取。当 `match_count=1` 时，前端读取该配方对应的 material count 显示消耗量。

**无匹配时**（match_count ≠ 1）：不显示消耗数，只显示素材当前总量。

### 7.7 素材双重来源处理

当同一类型的素材同时存在于背包和工作台候选区（如煎锅可携带也可由 POI 提供）：

- 背包中的工具素材和 POI 工作台素材都可在各自区域选中
- 选中时默认优先选择背包素材（消耗需遵循 `consume` 模式）
- 快速合成 `quickCraft` 对 `consume='none'` 槽位优先匹配合适的工作台素材，背包中的同类型工具自动不选

### 7.8 软锁的界面体现

- ⑤ 已发现配方列表中的条目已经过后端 `item_recipe_visibility_filter` 过滤
- 前端不感知过滤逻辑，只展示 API 返回的数据
- 玩家放素材试出未发现配方 → 合成成功 → 日志显示 `craft.new_recipe_discovered`
- 配方自动加入 discovered_recipes，但可能仍然被软锁隐藏（前端下次打开时列表不显示）

---

## 八、合成按钮状态矩阵

| match_count | craftable | is_new_recipe | 按钮状态 | preview_logs 文案来源 |
|:-----------:|:---------:|:-------------:|---------|-----------------------|
| — | — | — | disabled | `craft.empty_pool` — "放入素材才能合成" |
| 0 | false | — | disabled | `craft.fail_no_match` / `craft.tool_missing` / `craft.extra_material` / `craft.insufficient`（由后端决定） |
| 1 | true | false | enabled | `craft.ready` — "可合成" |
| 1 | true | true | enabled (highlight) | `craft.new_recipe` — "发现新配方！" |
| ≥2 | false | — | disabled | `craft.fail_ambiguous` — "素材指向不明确（匹配 N 个配方）" |

---

## 九、文件清单

| 文件 | 操作 |
|------|------|
| `vex-vue/src/components/craft/CraftModal.vue` | 新建 |
| `vex-vue/src/components/craft/CraftRecipeList.vue` | 新建 |
| `vex-vue/src/stores/craft.ts` | 新建 |
| `vex-vue/src/types/api.ts` | 修改—新增 CraftPreviewResult 等接口 |
| `vex-vue/src/api/endpoints.ts` | 修改—新增 3 个 action 常量 |
| `vex-vue/src/api/client.ts` | 修改—新增 gameApiWithParams 方法 |
| `vex-vue/src/components/actions/TileActionBar.vue` | 修改—ACTIONS 区加 `[C] 合成` 按钮（与 `[E] 探索` 同级） |
| `vex-vue/src/App.vue` | 修改—加 C 键快捷键 + ESC 级联扩展 |
| `vex-vue/src/data/log-templates.ts` | 修改—新增 `craft.empty_pool` / `craft.tool_missing` / `craft.extra_material` / `craft.insufficient` / `craft.ready` / `craft.new_recipe` 模板 |

---

## 十、合成界面流程图

```
玩家按 C 或点击 [合成]
    │
    ▼
打开 CraftModal — 三列同时加载
    │
    ├──→ 左列（参考）加载 ⑤ discovered_recipes
    ├──→ 中列（状态）加载 ① 素材池（空）+ ④ 等待反馈
    └──→ 右列（操作）加载 ② inventory + ③ workbench_materials
    │
    ▼
玩家在右列 ②/③ 中点击选择素材
    │
    ├──→ 点击切换选中/取消（再次点击取消）
    ├──→ 中列 ① 实时同步已选素材列表
    ├──→ debounce 200ms → craft_preview API
    │       │
    │       ├→ match_count=0 → 中列 ④: preview_logs（分原因显示） + 右列底部 [合成] 灰
    │       ├→ match_count=1 → 中列 ④: "可合成" + ① 显示消耗提示 + 右列底部 [合成] 亮
    │       └→ match_count≥2 → 中列 ④: "指向不明确" + 右列底部 [合成] 灰
    │
    ▼
玩家点击右列底部 [合成]（仅 match_count=1 时可用）
    │
    ▼
    obl_craft POST
    │
    ├→ 成功 → invalidate inventory → broadcast → close
    │         → log 显示 craft.success
    │         → 如果是新配方 → log 显示 craft.new_recipe_discovered
    │
    └→ 失败 → 中列 ④ 显示错误原因
```

---

*文档版本：v1.2 | 2026-07-06*
