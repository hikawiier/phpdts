# Vex-Vue 合成界面设计案

> 本案定义 Oblivions 合成系统的前端界面设计与实现方案（v2.0 重写版）。
>
> **职责边界**：本案仅覆盖 CraftModal 合成交互。道具使用入口、itm0 待整理区、整理/丢弃 itm0 业务逻辑归属《vex-vue-背包与道具使用界面设计案.md》。
>
> **依赖文档**：
>
> * 后端契约补丁（preview\_log / WorkbenchMaterial tags-itmk）→ 《oblivions-前端契约补丁-设计案.md》
>
> * 背包界面（itm0Locked 状态来源 / handleOrganize / handleDiscardItm0）→ 《vex-vue-背包与道具使用界面设计案.md》
>
> * 后端合成逻辑 → 《道具使用与合成系统-设计案.md》
>
> * itm0 机制 → 《堆叠功能与合成系统P2重构-设计案.md》

***

## 一、设计目标

### 1.1 目标

| 目标                   | 实现方式                                            |
| -------------------- | ----------------------------------------------- |
| 玩家能进入合成界面，查看可用素材     | ACTIONS 区 `[合成]` 按钮 → CraftModal                |
| "确认函"模式：放素材→系统判断→亮/灭 | 素材池选择 → `craft_preview` 实时预判 → 合成按钮状态反馈         |
| 工作台素材可选用             | 实时计算可用工作台列表（POI），与背包素材统一进池                        |
| 配方可浏览、可快速合成           | 可折叠列表，点击配方自动选材填充素材池                             |
| 精细反馈"为什么不能合成"        | `preview_log` 8 种 ID 反馈（缺工具/多余素材/素材不足等）         |
| itm0 锁定态正确处理         | 读取 `inventoryStore.itm0Locked`，锁定时禁用选材 + 提供整理入口 |

### 1.2 范围

**在本案范围内**：

* CraftModal 组件（核心合成交互界面，三列布局）

* CraftRecipeList 子组件（配方列表）

* craft Store（合成临时状态管理）

* API 调用封装（`craft_preview` / `craft_workbench_materials` / `craft_recipes` / `obl_craft`）

* 合成入口（ACTIONS `[合成]` 按钮 + ESC 级联关闭 CraftModal）

* 相关 TypeScript 类型扩展

**不在本案范围内**：

* itm0 待整理区展示与整理/丢弃业务逻辑 → 背包界面设计案

* 道具使用入口（`[使用]` 按钮）→ 背包界面设计案

* 后端合成逻辑 → 已实现

* 后端契约补丁（preview\_log / WorkbenchMaterial）→ 契约补丁设计案

* 合成日志渲染 → 已实现（log-templates.ts）

***

## 二、整体架构

### 2.1 组件树

```
App.vue
├── RightPanel.vue
│   └── TileActionBar.vue
│       ├── ExploreButton ([E] 探索)
│       ├── [合成] 按钮 ← 新增入口（内联在 TileActionBar.vue，与 [E] 同级）
│       └── (POI/ground 内联模态)
└── CraftModal.vue ← 新增：Teleport to body 浮动模态框
    └── CraftRecipeList.vue ← 新增：配方列表子组件
```

### 2.2 数据流

```
玩家操作                    Store               API / Command
─────────────────────────────────────────────────────────────
点击 [合成] 按钮 ─────→ craftStore.openModal()
                         ├── dataManager.fetch('craft_workbench_materials')
                         ├── dataManager.fetch('craft_recipes')
                         ├── 读取 inventoryStore（已有数据，无需 fetch）
                         └→ craftModalOpen = true

点击背包素材槽位 ──────→ craftStore.toggleBackpackSlot(slot)
                         └→ 读取 inventoryStore 获取该槽 itms
                         └→ backpackSlots 追加 {slot, count: itms}（整格投入）
                         └→ refreshPreview()

调整投入数量 [-][+] ──→ craftStore.adjustBackpackCount(slot, delta)
                         └→ 更新 backpackSlots[slot].count
                         └→ refreshPreview()

点击工作台素材 ────────→ craftStore.toggleWbMaterial(id)
                         └→ refreshPreview()

refreshPreview (debounced 200ms, leading+trailing)
  → 拼接 slots="1:3,2:1"（槽位:数量）
  → gameApiWithParams('craft_preview', {slots, workbench_materials})
  → 更新 previewResult + previewLog

点击 [合成] 按钮 ─────→ craftStore.doCraft()
                         └── commandQueue.execute({ command: 'obl_craft', slots, workbench_materials })
                         └→ 成功:
                              invalidate('player_inventory')
                              await loadInventory()  // 等待背包刷新
                              检查 inventoryStore.itm0Locked:
                                ├→ false → closeModal()（正常完成）
                                └→ true  → 保持打开，显示 itm0 锁定提示

点击配方行 ────────────→ craftStore.quickCraft(recipeId)
                         └→ 自动计算所需素材 + 投入数量
                         └→ 自动填充 backpackSlots + wbMaterialIds
                         └→ refreshPreview() → doCraft()
```

### 2.3 与现有模式的一致性

| 模式                          | 合成系统                                                  | 参考来源                                           |
| --------------------------- | ----------------------------------------------------- | ---------------------------------------------- |
| Pinia Composition API store | `stores/craft.ts`                                     | `stores/tileAction.ts`                         |
| 模态框内联交互                     | `CraftModal.vue` 独立模态                                 | `TileActionBar.vue` 内联 modal 模式                |
| 写命令通过 commandQueue          | `commandQueue.execute({ command: 'obl_craft', ... })` | `stores/tileAction.ts:handleSearch`            |
| 读 API 通过 dataManager（无参）    | `dataManager.fetch('craft_workbench_materials')`      | `stores/inventory.ts:loadInventory`            |
| 读 API 直接调用（带参）              | `gameApiWithParams('craft_preview', params)`          | 无现有模式（新增）                                      |
| 操作后失效+广播                    | `invalidate + broadcast('game:action-completed')`     | `stores/tileAction.ts`                         |
| 名称通过 locale 渲染              | `getItemName()`, `getRecipeName()`                    | `data/item-locale.ts`, `data/recipe-locale.ts` |
| ESC 级联                      | `ESC` 关闭 CraftModal（最优先级）                             | `App.vue:onKeydown`（ESC 级联扩展）                  |

***

## 三、CraftModal 布局

### 3.1 三列布局

参考游戏主界面的左右分区思路，合成界面分为三列：

```
┌─ 合成 ──────────────────────────────────────────────── [X] ─┐
│                                                                  │
│  左（参考）25%      中（状态/反馈）30%    右（操作）45%        │
│  ┌──────────────┐ ┌──────────────────┐ ┌──────────────────────┐ │
│  │ ⑤ 配方列表  │ │ ① 素材池        │ │ ② 背包素材          │ │
│  │ ▼ 可合成(3) │ │ [槽3] 布料×5    │ │ [1] 布料×5  ✓       │ │
│  │  ▼ 食物(2) │ │   投入 5 [-][+] │ │ [2] 废铁片×3        │ │
│  │   烤兔肉 ▸  │ │ [T] 铁砧        │ │ [3] 生兔肉×1 ✓      │ │
│  │   简易炖菜  │ │   (tool:1)     │ │ [4] 刀片碎片 耐久20  │ │
│  │  ▼ 工具(1) │ │ 合计 2 件素材   │ │                     │ │
│  │   绷带 ▸   │ │                  │ │ ③ 工作台候选        │ │
│  │ ▶ 不可合成  │ │ ④ 反馈         │ │ ─ POI 工作台 ─      │ │
│  │              │ │ ✓ 可合成        │ │ ☐ 铁砧(t:1)        │ │
│  │              │ │               │ │                     │ │
│  │              │ │               │ │ ┌────────────────┐  │ │
│  │              │ │               │ │ │  [合成]（高亮） │  │ │
│  │              │ │               │ │ └────────────────┘  │ │
│  └──────────────┘ └──────────────────┘ └──────────────────────┘ │
│                                                                  │
│  ── itm0 锁定态（inventoryStore.itm0Locked=true 时） ────────  │
│                          ┌──────────────────┐ ┌──────────────┐ │
│                          │ [!] 合成部分成功，│ │ ② 选材已禁用 │ │
│                          │ 请整理背包       │ │ ③ 工作台已禁用│ │
│                          │ "产物已暂存，整理 │ │             │ │
│                          │ 后可继续操作"   │ │ ┌──────────┐ │ │
│                          │                  │ │ │[整理背包] │ │ │
│                          │                  │ │ │[丢弃暂存] │ │ │
│                          │                  │ │ └──────────┘ │ │
│                          └──────────────────┘ └──────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

**符号说明**：布局图中 `[T]` 表示工具类工作台素材（tool 缩写），`[!]` 表示警告提示。避免使用 Unicode emoji（如 `⚒`/`⚠`），以防 OS 着色与 Terminal 风格不一致（详见前端美学风格设计案 §1.2）。

**各列与游戏界面元素的对应关系**：

| 列     | 类比游戏界面          | 职责           | 交互形式                            |
| ----- | --------------- | ------------ | ------------------------------- |
| 左（参考） | 地图区（信息展示）       | 配方浏览（两级分组）  | 可合成组点击配方触发快速合成；不可合成组只读查看        |
| 中（状态） | StatusBar（实时反馈） | 素材池 + 预判反馈   | **纯展示，无交互元素**（数量调整 \[-]\[+] 除外） |
| 右（操作） | ACTIONS 区（交互入口） | 选材 + 移除 + 合成 | **所有选材交互集中在此**                  |

### 3.2 各列设计要点

**左列（参考）— ⑤ 配方列表**：

* 通过 `craft_recipes` API 加载所有配方（2s 白名单缓存，不再区分已发现/未发现）

* **两级分组**：
  * 第一级：**可合成** / **素材不全** / **无关联素材**（三组分类，关联匹配规则见下文）
  * 第二级：`category`（`food` / `tool` / `armor` / `weapon`）

* 可合成组默认展开，素材不全组与无关联素材组默认折叠（玩家想看可展开）

* 每组显示：`▼ 可合成(3)` → 展开后 `▼ 食物(2)` → 配方名称

* **三组分类规则**（按"关联匹配"判定，不检查数量，数量是否足够由后端 craft_preview 判断）：
  * **可合成**= 该配方的**每个 material** 都能在背包或工作台中找到匹配项（关联全匹配）。点击后 `fillRecipeMaterials` 能填入所有素材，预判通常返回 `craftable=true`。精确可合成（match_count=1）的配方条目加 `▸` 标记 + bright class 高亮
  * **素材不全**= 背包素材能匹配该配方的**至少一个 material**，但不是所有 material 都有匹配（通常缺工作台或部分素材）。点击后 `fillRecipeMaterials` 填入已关联素材，玩家通过 ④ 反馈看到缺失项
  * **无关联素材**= 背包素材**完全不能匹配**任何 material（工作台匹配与否不影响此组判定）。只读查看（展开显示 materials，了解需要什么）

* **判定优先级**：先检查"可合成"（全匹配），不满足再检查"素材不全"（背包有关联），都不满足归入"无关联素材"

* 可合成组内精确可合成的配方点击触发快速合成；可合成组内非精确匹配与素材不全组配方点击后跳转手动选材并自动填入已关联素材；无关联素材组内配方只读查看

* 此列是纯参考区，不参与选材或状态显示

**中列（状态）— ① 素材池 + ④ 反馈**：

* **① 素材池**（上部）：

  * 显示已选背包素材：`[槽3] 布料×5  投入 5 [-][+]`

    * `投入 N` 为当前投入数量，`[-][+]` 仅在数量模型（stack=true）时显示

    * 耐久模型（stack=false）显示 `[槽4] 刀片碎片  整槽消耗`（无 \[-]\[+]）

  * 显示已选工作台素材：`[T] 铁砧  (tool:1)  不消耗`

  * 显示素材合计数量：`合计 N 件素材`

  * 素材池为空时显示"尚未选择素材"

* **④ 反馈区**（下部）：

  * 渲染 `preview_log`（复用 `log-templates.ts` 模板，单对象非数组）

  * 仅显示状态文字，不含交互按钮

  * 统一灰阶渲染，通过 `bright` / `dim` class 区分强调（详见 §3.4 与前端美学风格设计案 §6.3）

* **中列交互元素仅限 \[-]\[+] 数量调整按钮**（用于减少多放素材），无其他按钮/复选框/输入框

**右列（操作）— ② 背包素材 + ③ 工作台候选 + 合成按钮**：

* **② 背包素材列表**（上部）：

  * 从 inventory store 读取 slots\[]，过滤空槽位

  * 每行：`[槽位号] 名称 ×数量` + ✓ 选中指示

  * 点击切换选中/取消（再次点击已选中的槽位取消选中）

  * **堆叠投量初始值**：选中时按整格 itms 投入（`backpackSlots` 记录 `{slot, count: itms}`）

  * 若 preview 返回 `craft.extra_material`，玩家通过中列 \[-]\[+] 减少数量

* **③ 工作台候选**（中部）：

  * 从 `craft_workbench_materials` API 返回的列表渲染

  * **按来源分组**：`─ POI 工作台 ─` / `─ 猫身上 ─`（未来）

  * 每行：`checkbox + 名称 + (tool:N)`

  * 默认不选中任何工作台素材（玩家根据配方需求手动勾选；徒手合成的语义已由"配方 materials 无 `consume='none'` 槽位"表达，不再需要被动技能素材）

  * 再次点击已选中的工作台取消选中

* **合成按钮**（底部，正常态）：

  * 根据 `previewResult.craftable` 决定启用/禁用

  * 按钮文字固定为"合成"，通过 ④ 的文案传达具体状态

  * 置于右列底部，与中列④的反馈文字对齐

* **itm0 锁定态**（`inventoryStore.itm0Locked === true` 时）：

  * ② ③ 全部禁用（灰色遮罩），提示"请先整理或丢弃暂存道具"

  * 合成按钮替换为两个按钮：`[整理背包]`（主）+ `[丢弃暂存]`（次）

  * 这两个按钮调用 `inventoryStore.handleOrganize()` / `inventoryStore.handleDiscardItm0()`（背包设计案定义）

### 3.3 动效/反馈

* 素材选择/取消时：简单的高亮过渡（CSS transition）

* 合成成功时：模态框关闭（让玩家看到日志变化和背包更新），log 中渲染 `craft.success`

* 所有动效提供 `@media (prefers-reduced-motion: reduce)` 兜底，禁用 transition（详见前端美学风格设计案 §1.4）

### 3.4 preview\_log 反馈渲染

`craft_preview` 响应含 `preview_log` 单对象（详见契约补丁设计案 §2.4），前端构造 LogEntry 传入 `renderLogEntry` 渲染：

```typescript
const fakeEntry: LogEntry = {
  id: previewLog.id,
  logcategory: 'system',  // 复用 system，不新增枚举值
  params: previewLog.params,
  html: null,
  debug: false,
  ts: 0,
}
const feedbackHtml = renderLogEntry(fakeEntry)
```

**反馈 ID 与文案映射**：

| ID                     | 文案                           |
| ---------------------- | ---------------------------- |
| `craft.empty_pool`     | "放入素材才能合成。"                  |
| `craft.tool_missing`   | "需要合适的工具（如烹饪器具/锻造工具）。"       |
| `craft.extra_material` | "有些素材用不上，试试移除部分素材。"          |
| `craft.insufficient`   | "素材不足，试试放入更多同类素材。"           |
| `craft.fail_no_match`  | "这些素材无法合成任何东西。"              |
| `craft.fail_ambiguous` | "素材指向不明确（匹配 N 个配方），需要放更多素材。" |
| `craft.ready`          | "可合成。"                       |

**渲染说明**：所有反馈统一走 `terminal.css` 灰阶渲染，不引入彩色信号色（详见前端美学风格设计案 §6.3）。

***

## 四、Store 设计

### 4.1 `stores/craft.ts` 接口

```typescript
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { commandQueue } from '@/stores/command-queue'
import { dataManager } from '@/stores/data-manager'
import { useInventoryStore } from '@/stores/inventory'
import { debugBus } from '@/composables/useDebugBus'
import { gameApiWithParams } from '@/api/client'
import { API_ACTIONS } from '@/api/endpoints'
import type {
  CraftPreviewResult,
  WorkbenchMaterial,
  CraftRecipe,
  PreviewLog,
} from '@/types/api'

export interface CraftBackpackSlot {
  slot: number
  count: number       // 该格投入数量（初始=itms 整格，可由玩家调整或 quickCraft 指定）
}

export const useCraftStore = defineStore('craft', () => {
  // ── 状态 ──
  const craftModalOpen = ref(false)
  const backpackSlots = ref<CraftBackpackSlot[]>([])    // 已选背包槽位+投入数量
  const wbMaterialIds = ref<string[]>([])                // 已选工作台素材 ID
  const availableWbMaterials = ref<WorkbenchMaterial[]>([])
  const previewResult = ref<CraftPreviewResult | null>(null)
  const recipes = ref<CraftRecipe[]>([])

  // ── loading 状态（简化为两个） ──
  const loading = ref(false)              // openModal 时加载 wb + recipes
  const previewLoading = ref(false)       // refreshPreview 防抖期间

  // ── 计算属性 ──
  const isCraftable = computed(() => previewResult.value?.craftable ?? false)
  const matchCount = computed(() => previewResult.value?.match_count ?? 0)
  const previewLog = computed<PreviewLog | null>(() => previewResult.value?.preview_log ?? null)
  const hasSelection = computed(() => backpackSlots.value.length > 0 || wbMaterialIds.value.length > 0)

  /**
   * itm0 锁定状态（从 inventoryStore 派生，不维护独立状态）
   * 详见背包界面设计案 §4.2
   */
  const itm0Locked = computed(() => useInventoryStore().itm0Locked)

  // ── 动作 ──
  async function openModal(): Promise<void>
  function closeModal(): void
  function toggleBackpackSlot(slot: number): void
  function toggleWbMaterial(id: string): void
  function adjustBackpackCount(slot: number, delta: number): void  // [-][+] 按钮调用
  async function refreshPreview(): Promise<void>    // debounced 200ms, leading+trailing
  async function doCraft(): Promise<void>
  async function quickCraft(recipeId: string): Promise<void>
})
```

### 4.2 状态变更流程

#### openModal

```
openModal
  → loading = true
  → 并行加载（任一失败不阻塞其他）:
       dataManager.fetch('craft_workbench_materials') → availableWbMaterials
         └→ 失败：availableWbMaterials = []（右列③显示"工作台素材加载失败"）
       dataManager.fetch('craft_recipes') → recipes
         └→ 失败：recipes = []（左列⑤显示"配方列表加载失败"，不影响手动合成）
  → inventory 数据复用 inventoryStore（已在打开前加载）
  → wbMaterialIds = []（不默认选中任何工作台素材）
  → backpackSlots = []（清空选材）
  → previewResult = null
  → loading = false
  → craftModalOpen = true
  → refreshPreview()（placed_items 为空 → 触发初始 craft.empty_pool 反馈）
```

#### toggleBackpackSlot

```
toggleBackpackSlot(slot)
  → 从 inventoryStore.slots 读取该槽 itms（堆叠数量）
  → 已在 backpackSlots 中？
       → 是 → 移除（取消选中）
       → 否 → 追加 {slot, count: itms}（整格投入）
            → 数量模型（stack=true）：count = itms
            → 耐久模型（stack=false）：count = 1（整槽）
  → refreshPreview()
```

#### adjustBackpackCount（新增，O3 修正）

```
adjustBackpackCount(slot, delta)
  → 在 backpackSlots 中找到该 slot
  → 从 inventoryStore 读取该槽 itms（上限）
  → newCount = clamp(current + delta, 1, itms)
  → 耐久模型（stack=false）不允许调整（固定 1）
  → 更新 backpackSlots[slot].count = newCount
  → refreshPreview()
```

#### toggleWbMaterial

```
toggleWbMaterial(id)
  → 已在 wbMaterialIds 中？
       → 是 → 移除
       → 否 → 追加
  → refreshPreview()
```

#### refreshPreview（防抖 leading+trailing，P4 修正）

```
refreshPreview (debounced 200ms, {leading: true, trailing: true})
  → previewLoading = true
  → 拼接 slots: backpackSlots.map(s => `${s.slot}:${s.count}`).join(',')
  → 拼接 workbench_materials: wbMaterialIds.join(',')
  → try:
       gameApiWithParams('craft_preview', {slots, workbench_materials})
       → 更新 previewResult（含 preview_log）
       → 响应式触发 ④ 状态更新
  → catch (网络错误/服务器错误):
       保留旧 previewResult（或清空，让 ④ 显示"预判失败，请重试"）
  → finally:
       previewLoading = false
```

**leading+trailing 策略**：

* `leading: true`：首次点击立即触发 preview，玩家无需等 200ms

* `trailing: true`：连续快速点击后，最后一次点击后 200ms 再触发一次，确保状态最终一致

#### closeModal

```
closeModal
  → 清除 _debounceTimer（防止卸载后触发 preview）
  → 重置 backpackSlots, wbMaterialIds, previewResult = 默认值
  → craftModalOpen = false
  → 不重置 availableWbMaterials / recipes（缓存，下次打开复用）
```

#### doCraft（O7 修正：不依赖日志事件，直接检查 itm0Locked）

```
doCraft
  → const slots_str = backpackSlots.value
       .map(s => `${s.slot}:${s.count}`)
       .join(',')
  → const params = {
       command: 'obl_craft',
       slots: slots_str,
       workbench_materials: wbMaterialIds.value.join(','),
     }
  → commandQueue.execute(params)
  → 统一成功路径（业务结果通过日志反馈）:
       dataManager.invalidate('player_inventory')
       dataManager.broadcast('game:action-completed')
       await inventoryStore.loadInventory()  // 等待背包刷新（含 itm0 状态）
       检查 inventoryStore.itm0Locked:
         ├→ false → closeModal()（正常完成）
         └→ true  → 保持打开，显示 itm0 锁定提示
                   （不调用 closeModal，玩家看到 itm0 锁定 UI）
       // 业务失败（如 craft.fail_no_match）应在 preview 阶段被拦截（craftable=false 时按钮 disabled）
       // 网络/系统错误通过 catch 处理
  → catch (网络/系统错误):
       broadcast('ui:toast', { type: 'error', msg })
```

**O7 修正说明**：原设计案说"检查后端是否触发了 organize.fail"，但 commandQueue.execute 返回 CommandResult 不含日志事件。改为直接检查 `inventoryStore.itm0Locked`（从 itm0 派生），这是合成部分成功的唯一可观测后果。

**result.success 不反映业务失败说明**：后端命令处理函数无 return 语句，HTTP 响应恒为 `{}`，`result.success` 仅反映 HTTP 错误 / 并发锁 / PHP fatal（详见背包设计案 §3.5）。业务失败通过 log/error_log 系统反馈，前端统一走成功路径。

**显式 await 说明**：doCraft 中 `await inventoryStore.loadInventory()` 是显式等待背包刷新，因为需要检查 itm0Locked 状态决定是否保持模态框打开。其他命令（如背包设计案的 handleUseItem）不需要等待 itm0Locked，仅依赖 `broadcast('game:action-completed')` 触发 loadInventory 即可，模式不统一是因为需求不同。

#### quickCraft

详见 §五 quickCraft 实现。

***

## 五、quickCraft 快速合成

### 5.1 匹配策略

`quickCraft(recipeId)` 的实现逻辑：

1. 读取该配方的 `materials` 数组
2. 对每个 material，按 consume 类型分支：

   * **`consume='none'`**（工作台/工具类素材）：

     * 从 `availableWbMaterials` 中查找匹配项

     * 匹配条件：`tags` 包含 material 的 `tag`（或 `itmk` 匹配，或 `item_id` 匹配）+ `tool_level >= min_level`

     * 选中第一个匹配的工作台素材

   * **`consume='all'`** **或** **`consume='durability'`**（背包素材）：

     * 先按匹配优先级扫槽：`item_id` > `itmk` > `tag`

     * 对每个匹配到的槽位，读取 `itms`（堆叠数量）

     * **堆叠适配**：投入数量 = `min(配方需求count, 该格itms)`，即只消耗需要数量

     * 如果单格 `itms` 不足以满足 `count`，继续从下一个匹配槽位补足

     * 记录为 `{slot, count: 实际投入数量}`
3. 不足的素材（未找到匹配或总量不够）→ `broadcast('ui:toast', { type: 'error', msg: '素材不足，无法快速合成' })` + **保留已填充的 backpackSlots/wbMaterialIds**（让玩家手动补充缺失素材）+ 触发 `refreshPreview()`（让玩家看到当前部分填充状态的反馈，如 `craft.insufficient`）+ 停止 quick craft（不触发 doCraft）
4. 全部匹配 → 自动填充 `backpackSlots` + `wbMaterialIds` → 触发 refreshPreview
5. 同一背包槽位不能同时匹配多个 material 槽位（步骤 2 维护 `usedSlots` 集合，匹配成功的槽位标记为已用，后续 material 跳过已用槽位）

### 5.2 双源去重策略（O5 / C2 修正）

当同一类型的素材同时存在于背包和工作台候选区（如煎锅可携带也可由 POI 提供）：

**策略：quickCraft 优先选择工作台素材（consume='none'），背包同类工具自动不选**

理由：

* `consume='none'` 的工作台素材不消耗，优先选用更经济

* 避免背包中的工具被误消耗（玩家可能想保留）

**手动选材时不去重**：

* 玩家可同时选中背包煎锅和 POI 炉灶

* 后端 `item_resolve_material_mapping` 会把两个都放入 placed\_items

* 若配方只需 1 个，会"多放"导致 0 匹配

* preview 返回 `craft.extra_material`，玩家通过 \[-]\[+] 减少或取消其中一个

* **前端不主动去重**，让后端作为单一真值源，依赖 preview 反馈引导玩家

### 5.3 注意事项

> `consume='durability'` 的素材（如布包刀刃配方中的锐器，扣耐久不消耗）走背包匹配，不从工作台匹配。

***

## 六、API 集成

### 6.1 新增常量

`api/endpoints.ts` 新增：

```typescript
export const API_ACTIONS = {
  // ... 现有 11 个常量
  CRAFT_PREVIEW: 'craft_preview',
  CRAFT_WORKBENCH_MATERIALS: 'craft_workbench_materials',
  CRAFT_RECIPES: 'craft_recipes',
} as const;
```

### 6.2 新增带参 GET 方法

`api/client.ts` 新增：

```typescript
/**
 * 带参只读 API：GET api_v2.php?action=xxx&key=val&...
 * 供 craft_preview 等需要查询参数的端点使用
 *
 * 与 gameApi() 语义一致：返回完整响应对象
 * {status: 'success'|'error', data, ...}，调用方负责检查 status。
 */
export async function gameApiWithParams(
  action: ApiAction,
  params: Record<string, string>,
): Promise<ApiResponse> {
  const query = new URLSearchParams({ action, ...params }).toString();
  const url = `${API_BASE}/api_v2.php?${query}`;
  return perf.spanAsync(`gameApi(${action})`, 'api', async () => {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      throw new Error('服务器返回格式错误（非 JSON）');
    }
    return res.json();
  });
}
```

### 6.3 请求/响应映射

| API                         | 请求参数                                                  | 响应 data                                                | 缓存策略                             |
| --------------------------- | ----------------------------------------------------- | ------------------------------------------------------ | -------------------------------- |
| `craft_preview`             | `slots=1:3,2:1` + `workbench_materials=poi:123`       | `{match_count, craftable, recipe_id, preview_log}` | 不缓存，每次刷新                         |
| `craft_workbench_materials` | 无                                                     | `{workbench_materials: [...]}`                         | 不缓存（POI 位置变化）                    |
| `craft_recipes`             | 无                                                     | `{recipes: [...]}`                                     | 2s 白名单缓存（与 player\_inventory 一致） |
| `obl_craft` (POST)          | `command=obl_craft` + `slots` + `workbench_materials` | `{}`（标准命令响应）                                           | -                                |

**data-manager.ts 白名单修改**：

`craft_recipes` 使用 2s 白名单缓存，需在 `vex-vue/src/stores/data-manager.ts` 的 `_cacheable` Map 中新增：

```typescript
private _cacheable = new Map<ApiAction, number>([
  ['game_map', 5000],
  ['tile_actions', 3000],
  ['player_inventory', 2000],
  ['craft_recipes', 2000],   // 新增：2s 白名单缓存
]);
```

`craft_workbench_materials` 和 `craft_preview` 不加入白名单（前者因 POI 位置变化不缓存，后者走 `gameApiWithParams` 不经 `dataManager.fetch`）。

***

## 七、TypeScript 类型扩展

`types/api.ts` 新增（依赖契约补丁设计案）：

```typescript
// craft_preview 响应（依赖契约补丁 C1）
export interface CraftPreviewResult {
  match_count: number
  craftable: boolean
  recipe_id: string | null  // match_count=1 时为匹配配方 ID，否则 null（供前端查 recipes 显示消耗）
  preview_log: PreviewLog  // 单对象（非数组）
}

// 预判日志条目（与 LogEntry 结构一致，复用 renderLogEntry）
export interface PreviewLog {
  id: string  // 'craft.empty_pool' | 'craft.tool_missing' | 'craft.extra_material' | 'craft.insufficient' | 'craft.fail_no_match' | 'craft.fail_ambiguous' | 'craft.ready'
  params: Record<string, string | number | boolean>
}

// workbench_materials 的元素（依赖契约补丁 C2）
export interface WorkbenchMaterial {
  source: 'cat' | 'poi'
  id: string
  item_id: string
  tool_level: number
  tags: string[]  // 契约补丁新增
  itmk: string    // 契约补丁新增
}

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

***

## 八、关键交互决策

### 8.1 "确认函"的实现

素材池变化时调用 `craft_preview`，**只反馈能不能合成，不显示产物名称**。保持探索感。产物名称在合成成功后才通过日志显示。

### 8.2 堆叠投量交互（O3 修正）

**核心问题**：5 个布料整格投入 `craft_bandage` 配方（只需 3 个）会"多放"导致 0 匹配。

**解决方案**：

* 选中槽位时**默认投入整格 itms**（最自然的交互）

* 若 preview 返回 `craft.extra_material`（多放），中列 ④ 提示"有些素材用不上，试试移除部分素材"

* 玩家通过中列 ① 的 `[-][+]` 按钮减少投入数量

* `quickCraft` 自动算出正确数量（`min(配方需求count, 该格itms)`），无需手动调整

**\[-]\[+] 按钮规则**：

* 仅数量模型（stack=true）显示

* 耐久模型（stack=false）不显示（整槽消耗，无数量概念）

* 范围：`1 ≤ count ≤ itms`

* 无限标识（`itms='∞'`，由后端 `item_is_infinite()` 判断）：count 固定为配方需求数量（quickCraft 时），手动选材时 count=1

### 8.3 模态框关闭策略（O4 修正）

* 点击右上角 \[X] 或 ESC → 关闭，重置素材选择状态

* 合成成功（产物入背包）→ **保持打开**，自动清空素材池，支持连续合成

* 合成成功（产物卡 itm0，背包满）→ 关闭模态框，由背包界面处理 itm0（见 §8.6）

* 合成失败（如 itm0 已被占用，无法暂存产物）→ 保持打开，④ 显示失败原因（`craft.fail_itm0_occupied`）

### 8.4 ESC 键处理

`App.vue:onKeydown` 的 ESC 级联扩展，**CraftModal 优先级最高**：

```typescript
function onKeydown(e: KeyboardEvent): void {
  const target = e.target as HTMLElement;
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

  if (e.key === 'Escape') {
    if (craftStore.craftModalOpen) {
      craftStore.closeModal();           // 1. CraftModal 最优先
    } else if (uiStore.modalOpen) {
      uiStore.closeModal();              // 2. 通用 Modal
    } else if (uiStore.inventoryDrawerOpen) {
      uiStore.closeInventoryDrawer();    // 3. 右抽屉
    } else if (uiStore.playerDrawerOpen) {
      uiStore.closePlayerDrawer();       // 4. 左抽屉
    }
  } else if (e.key === 'i' || e.key === 'I') {
    uiStore.toggleInventoryDrawer();
  } else if (e.key === 'p' || e.key === 'P') {
    uiStore.openPlayerDrawer();
  }
}
```

**CraftModal 优先级最高的理由**：它是当前聚焦的交互界面，ESC 应优先关闭它而非背后的抽屉。

**CraftModal 内部无嵌套模态**：CraftModal 内的 `[整理背包]` / `[丢弃暂存]` 按钮直接调用 inventoryStore 动作，不弹出确认对话框（与背包界面按钮一致）。若未来引入内部确认对话框，ESC 应优先关闭内部对话框，再关闭 CraftModal。

**App.vue 需要的修改**：

1. `import { useCraftStore } from '@/stores/craft'` + `const craftStore = useCraftStore()`
2. `import CraftModal from '@/components/craft/CraftModal.vue'`
3. template 中添加 `<CraftModal v-if="craftStore.craftModalOpen" />`（Teleport to body）
4. `onKeydown` 的 ESC 级联中加入 CraftModal 优先判断（如上代码）

### 8.5 素材消耗提示

中列 ① 中每个已选背包素材显示消耗情况，按 itms 模型区分：

* **数量模型**（stack=true，consume='all'）：
  `[槽3] 布料×5  投入 3 [-][+]  剩余 2`
  显示"投入 X（剩余 Y）"，表示消耗后 itms 减少 X，剩余 Y。

* **耐久模型**（stack=false，consume='all'）：
  `[槽4] 废铁刀 耐久20  整槽消耗`
  整槽删除，显示"整槽消耗"。

* **耐久模型**（consume='durability'）：
  `[槽4] 刀片碎片 耐久20  扣 1 耐久`

* **工作台素材**（consume='none'）：
  `[T] 铁砧 (tool:1)  不消耗`

消耗数量从匹配到的配方的 `materials[].count` 获取。当 `match_count=1` 时，前端用 `previewResult.recipe_id` 在 `recipes` 中查到配方，读取对应 material count 显示消耗量。

**无匹配时**：

* `match_count=0`（无配方匹配）：不显示消耗数，只显示素材当前总量

* `match_count≥2`（多个配方候选）：显示素材当前总量 + 中列 ④ 提示"素材指向不明确，放入更多素材以确定配方"

### 8.6 itm0 锁定状态的处理（兜底，正常流程不触达）

**正常流程**：合成成功后根据产物去向区分：
- 产物入背包（`itm0Locked=false`）→ 保持打开，清空素材池，支持连续合成
- 产物卡 itm0（`itm0Locked=true`，背包满）→ `closeModal()`，交背包界面处理

**兜底 UI**（保留但不期望触达）：当 `inventoryStore.itm0Locked === true` 时 CraftModal 显示以下 UI，作为防御性兜底（如 itm0 在打开模态框前已被占用）：

**中列 ④ 反馈区**：

* 显示 `⚠ 合成部分成功，请整理背包`

* 说明文案："产物已暂存，整理后可继续操作"

**右列 ② 背包素材列表**：

* 全部禁用（禁止点选），显示灰色遮罩

* 提示"请先整理或丢弃暂存道具"

**右列 合成按钮位置**：

* 替换为两个按钮：

  * `[整理背包]`（主操作，调用 `inventoryStore.handleOrganize()`）

  * `[丢弃暂存]`（次要，调用 `inventoryStore.handleDiscardItm0()`）

**解锁后**：`inventoryStore.itm0Locked` 变 false → CraftModal 自动恢复选材功能 → 玩家可继续合成

**关键决策**：

* `itm0Locked` 状态**不**在 craftStore 维护，从 `inventoryStore` 派生（P3 修正）

* 整理/丢弃的业务逻辑在 `inventoryStore`（背包设计案定义），CraftModal 只调用

* 合成成功后总是关闭 CraftModal，itm0 处理移交背包界面（避免职责重叠）

**与背包界面 itm0 锁定态策略的差异**：

合成界面在 itm0 锁定态禁用选材区（灰色遮罩），而背包界面保持 `[使用]`/`[丢弃]` 按钮可点击（依赖后端门控 + toast）。差异理由：合成是多步操作（选多个素材 → 调整数量 → 合成），如果在 itm0 锁定态允许选材，玩家会浪费多步操作后才发现不能合成，体验差；背包操作是原子操作（一次点击即触发或被拒绝），toast 足以反馈。详见背包设计案 §3.5。

### 8.7 软锁的界面体现

* 配方列表揭示所有配方，不再有"已发现/未发现"机制（取消 discovered_recipes 状态）

* 软锁通过资源可达性自然限制：玩家不到铁砧 POI → 工作台素材不可用 → 需要铁砧的配方实际无法合成（但配方仍可见，玩家可查看 materials 了解需求）

* 前端用关联匹配将配方分为"可合成"/"素材不全"/"无关联素材"三组（视觉过滤，非机制隐藏）

* 玩家想看任何配方都能看到，符合"信息透明"原则

***

## 九、合成按钮状态矩阵

| match\_count | craftable | 按钮状态                | preview\_log 文案                                                                                      |
| :----------: | :-------: | ------------------- | ---------------------------------------------------------------------------------------------------- |
|       —      |     —     | disabled            | `craft.empty_pool` — "放入素材才能合成。"                                                                     |
|       0      |   false   | disabled            | `craft.tool_missing` / `craft.extra_material` / `craft.insufficient` / `craft.fail_no_match`（后端分析决定） |
|       1      |    true   | enabled (highlight) | `craft.ready` — "可合成。"                                                                               |
|      ≥2      |   false   | disabled            | `craft.fail_ambiguous` — "素材指向不明确（匹配 N 个配方）"                                                     |

***

## 十、文件清单

| 文件                                                 | 操作 | 说明                                                                                                     |
| -------------------------------------------------- | -- | ------------------------------------------------------------------------------------------------------ |
| `vex-vue/src/components/craft/CraftModal.vue`      | 新建 | 三列布局合成模态框                                                                                              |
| `vex-vue/src/components/craft/CraftRecipeList.vue` | 新建 | 配方列表子组件（两级分组：可合成/素材不全/无关联素材 × category）                                                                      |
| `vex-vue/src/stores/craft.ts`                      | 新建 | craftStore + 防抖 preview + doCraft + quickCraft                                                         |
| `vex-vue/src/types/api.ts`                         | 修改 | 新增 CraftPreviewResult / PreviewLog / WorkbenchMaterial / CraftRecipe / CraftMaterial / CraftResult 等接口 |
| `vex-vue/src/api/endpoints.ts`                     | 修改 | 新增 3 个 action 常量（CRAFT\_PREVIEW / CRAFT\_WORKBENCH\_MATERIALS / CRAFT\_RECIPES）                        |
| `vex-vue/src/api/client.ts`                        | 修改 | 新增 gameApiWithParams 方法                                                                                |
| `vex-vue/src/stores/data-manager.ts`               | 修改 | `_cacheable` 白名单新增 `CRAFT_RECIPES`（2s 缓存）                                                              |
| `vex-vue/src/components/actions/TileActionBar.vue` | 修改 | ACTIONS 区加 `[合成]` 按钮（内联实现，与 `[E] 探索` 同级）                                                               |
| `vex-vue/src/App.vue`                              | 修改 | 渲染 `<CraftModal>` + import craftStore + ESC 级联扩展（CraftModal 最优先）                                       |
| `oblivions/include/game/item/item.craft.func.php`  | 修改 | `item_craft_preview` 返回值新增 `recipe_id`、移除 `is_new_recipe`；`item_get_discovered_recipes` 重命名为 `item_get_visible_recipes` 并改为返回所有配方；删除 `item_discover_recipe` |
| `vex-vue/src/data/log-templates.ts`               | 修改 | 删除 `craft.new_recipe` / `craft.new_recipe_discovered` 模板（不再触发）                                          |

**依赖文档**：

* 《oblivions-前端契约补丁-设计案.md》— 后端 preview\_log / WorkbenchMaterial tags-itmk 补齐

* 《vex-vue-背包与道具使用界面设计案.md》— inventoryStore.itm0Locked / handleOrganize / handleDiscardItm0

***

## 十一、合成界面流程图

```
玩家点击 [合成] 按钮
    │
    ▼
打开 CraftModal — 三列同时加载
    │
    ├──→ 左列（参考）加载 ⑤ recipes
    ├──→ 中列（状态）加载 ① 素材池（空）+ ④ 等待反馈
    └──→ 右列（操作）加载 ② inventory + ③ workbench_materials
              ③ 默认不选中任何工作台素材
    │
    ▼
玩家在右列 ②/③ 中点击选择素材
    │
    ├──→ 点击切换选中/取消（再次点击取消）
    ├──→ 选中背包素材：默认投入整格 itms
    ├──→ 中列 ① 实时同步已选素材列表
    ├──→ debounce 200ms (leading+trailing) → craft_preview API
    │       │
    │       ├→ match_count=0 → 中列 ④: preview_log（分原因显示）+ 右列底部 [合成] 灰
    │       │       ├→ craft.tool_missing → "需要合适的工具"
    │       │       ├→ craft.extra_material → "有些素材用不上"（玩家可用 [-][+] 减少数量）
    │       │       ├→ craft.insufficient → "素材不足"
    │       │       └→ craft.fail_no_match → "无法合成任何东西"
    │       ├→ match_count=1 → 中列 ④: "可合成" + ① 显示消耗提示 + 右列底部 [合成] 亮
    │       └→ match_count≥2 → 中列 ④: "指向不明确" + 右列底部 [合成] 灰
    │
    ▼
玩家点击右列底部 [合成]（仅 match_count=1 时可用）
    │
    ▼
obl_craft POST
    │
    ├→ 成功 + itm0Locked=false → invalidate inventory → closeModal
    │         → log 显示 craft.success
    │
    ├→ 成功 + itm0Locked=true → 保持打开，显示 itm0 锁定提示
    │         → 右列底部替换为 [整理背包] + [丢弃暂存]
    │         → 玩家整理后 itm0Locked=false → 恢复选材
    │
    └→ 失败 → 中列 ④ 显示错误原因
```

***

## 十二、与原设计案（v1.3）的差异说明

本案相对原设计案（v1.3）的主要变更：

| 变更项                      | 原设计案 v1.3                     | 本案 v2.0                                 | 修正类型       |
| ------------------------ | ----------------------------- | --------------------------------------- | ---------- |
| preview\_logs 结构         | 数组 `[{id, params}]`           | 单对象 `{id, params}`                      | P2 过度设计修正  |
| WorkbenchMaterial 字段     | 假设含 tags/itmk（自承缺口）           | 引用契约补丁，后端补齐                             | E2 契约错位修正  |
| itm0Locked 状态来源          | craftStore 独立 ref             | inventoryStore 派生（computed）             | P3 双源真值修正  |
| itm0 锁定态 UI 位置           | 仅 CraftModal 右列               | 背包界面 + CraftModal（共用 inventoryStore）    | C1/P6 职责拆分 |
| 道具使用入口                   | 未设计                           | 移交背包界面设计案                               | O1 遗漏修正    |
| 堆叠投量交互                   | 未明确（仅"整格投入"）                  | 整格投入 + \[-]\[+] 调整 + quickCraft 自动算     | O3 关键交互补全  |
| itm0 锁定态关闭处理             | 未覆盖                           | 明确可关闭，回背包界面处理                           | O4 遗漏修正    |
| 双源去重                     | 未明确                           | 手动选材不去重（依赖 preview 反馈），quickCraft 优先工作台 | O5/C2 冲突修正 |
| preview\_log logcategory | 未定义                           | 复用 'system'                             | O6 遗漏修正    |
| doCraft 检测 organize.fail | 路径未定义                         | 直接检查 inventoryStore.itm0Locked          | O7 遗漏修正    |
| craft.new\_recipe         | 取消发现机制，new\_recipe/new\_recipe\_discovered 全部移除 | 配方全部揭示，不再有"已发现/未发现"区分 | 设计简化      |
| loading 状态               | 三个独立 ref（wb/recipes/preview）  | 简化为 loading + previewLoading            | P1 过度拆分修正  |
| 防抖策略                     | 仅 trailing                    | leading + trailing                      | P4 体验优化    |
| 工作台候选区                   | 平铺                            | 按 source 分组                             | P5 可读性优化   |
| ESC 级联                   | 未明确 App.vue 改法                | 给出 ESC 级联 + App.vue 渲染 CraftModal 完整说明     | C3 衔接不明修正  |
| backpackSlots consume 字段 | 缺失（无法判断消耗模式）                  | 通过 inventoryStore.slots\[i].stack 推导    | E4 字段缺失修正  |

### v2.1 变更（审阅修正）

| 变更项 | v2.0 | v2.1 | 修正类型 |
|--------|------|------|---------|
| C 键快捷键 | 新增 C 键打开合成 | 移除（不添加合成快捷键） | 需求变更 |
| App.vue 渲染 CraftModal | 未明确 | 补充 import + template 渲染说明 | O1 遗漏修正 |
| data-manager.ts 白名单 | 未提及 | 补充 CRAFT_RECIPES 2s 缓存 | O2 遗漏修正 |
| removeBackpackSlot/removeWbMaterial | 声明但未实现 | 删除（toggle 已覆盖） | O3 冗余修正 |
| CraftButton 实现方式 | 未明确 | 明确内联在 TileActionBar.vue | O4 遗漏修正 |
| quickCraft 失败 UI 反馈 | 未说明 | 补充 toast + 保留已填充状态 | O5 遗漏修正 |
| 无匹配时素材池显示 | 统一"不显示消耗数" | 区分 match_count=0/≥2 | O6 遗漏修正 |
| itm0 锁定态策略差异 | 未说明与背包的差异 | 补充差异理由（多步操作 vs 原子操作） | C1 矛盾修正 |
| doCraft 显式 await | 未说明原因 | 补充说明（需检查 itm0Locked） | C2 矛盾修正 |
| ⚒ emoji | 使用 | 改为 [T]（避免 OS 着色） | A1 美学修正 |
| prefers-reduced-motion | 未提及 | 补充兜底说明 | A4 美学修正 |
| "沿用"布局习惯 | 沿用 | 改为"参考" | A5 美学修正 |
| 颜色映射表 | 含颜色列（绿/黄/灰） | 删除颜色列，统一灰阶渲染 | A3 美学修正 |

***

*文档版本：v2.2 | 2026-07-06（审阅修正：P0 result.success 不反映业务失败 + P1 删除颜色描述 + E6/O2/O3/O4/O5 修正）*
