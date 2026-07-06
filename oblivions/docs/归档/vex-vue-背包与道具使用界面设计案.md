# Vex-Vue 背包与道具使用界面设计案

> 本案定义 Oblivions 背包界面扩展（道具使用 + itm0 待整理区 + 数量/耐久语义区分）与对应的 store / 类型扩展。
>
> 合成界面（CraftModal）详见《vex-vue-合成界面设计案.md》。
> 后端 itm0 机制详见《堆叠功能与合成系统P2重构-设计案.md》。
> 后端道具使用命令详见《道具使用与合成系统-设计案.md》。
> 后端契约补丁（preview_log / WorkbenchMaterial tags-itmk）详见《oblivions-前端契约补丁-设计案.md》。

---

## 一、设计目标

### 1.1 目标

| 目标 | 实现方式 |
|------|---------|
| 玩家能使用道具（面包/药剂等） | InventoryList 每个非空槽位显示 `[使用]` 按钮（仅 `usable=true`），触发 `obl_use_item` |
| itm0 待整理区可见且可处理 | InventoryList 顶部独立区显示 itm0 内容，含 `[整理]` / `[丢弃]` 按钮 |
| 数量模型与耐久模型视觉区分 | `stack=true` 显示 `×N`（堆叠数量），`stack=false` 显示 `耐久 N` |
| itm0 锁定态全局可见 | `itm0Locked` 状态从 `inventoryStore.itm0` 派生，CraftModal 等其他组件只读引用 |

### 1.2 范围

**在本案范围内**：
- `InventoryList.vue` 扩展（道具使用按钮 + itm0 区域 + 数量/耐久区分）
- `inventory.ts` store 扩展（itm0 / itm0Locked / handleUseItem / handleOrganize / handleDiscardItm0）
- `types/api.ts` 类型扩展（`InventoryItem` 增 `usable/tags/itmk/stack`，`PlayerInventory` 增 `itm0`）
- 相关日志模板（use_item / organize / itm0 相关，已在后端实现阶段注册，本案仅核对）

**不在本案范围内**：
- 合成界面（CraftModal）— 归属《vex-vue-合成界面设计案.md》
- 后端 itm0 / organize / use_item 命令逻辑 — 已实现
- 工作台素材查询 — 归属合成界面设计案

### 1.3 与合成界面设计案的职责边界

| 功能 | 归属 | 理由 |
|------|------|------|
| itm0 区域展示 + 整理/丢弃按钮 | **本案**（InventoryList） | itm0 锁定是全局状态，玩家可能在背包界面就需要整理（如拾取导致背包满） |
| itm0Locked 状态定义 | **本案**（inventoryStore） | 单一真值源，CraftModal 只读引用 |
| CraftModal 内 itm0 锁定态 UI | 合成界面设计案 | CraftModal 读取 inventoryStore.itm0Locked 决定是否禁用选材，不重复定义状态 |

---

## 二、整体架构

### 2.1 组件树

```
InventoryDrawer.vue
└── InventoryList.vue ← 本案扩展
    ├── itm0 待整理区（顶部，条件渲染）← 新增
    │   ├── 道具信息（名称 + 数量/耐久）
    │   └── [整理] [丢弃] 按钮
    ├── 背包槽位网格（现有）
    │   └── 每个槽位增加：
    │       ├── 数量/耐久语义显示（替换现有 eff:dur）
    │       ├── [使用] 按钮（仅 usable=true）← 新增
    │       └── [丢弃] 按钮（现有）
    └── items: N/M（现有）
```

### 2.2 数据流

```
玩家操作                    Store               API / Command
─────────────────────────────────────────────────────────────
打开背包抽屉 ─────────→ inventoryStore.loadInventory()
                         └── dataManager.fetch('player_inventory')
                              └→ 更新 inventoryData（含 itm0）

点击 [使用] ──────────→ inventoryStore.handleUseItem(slot)
                         └── commandQueue.execute({ command: 'obl_use_item', slot })
                         └→ 统一成功路径（业务结果通过日志反馈）:
                              invalidate('player_inventory')
                              broadcast('game:action-completed')
                              （日志显示 use_item.success / durability.broken）
                              （或 itm0 锁定时日志显示 system.itm0_pending，玩家从日志感知拒绝）

点击 itm0 [整理背包] ─────→ inventoryStore.handleOrganize()
                         └── commandQueue.execute({ command: 'obl_organize' })
                         └→ 统一成功路径（业务结果通过日志反馈）:
                              invalidate('player_inventory')
                              broadcast('game:action-completed')
                              （itm0 清空 → itm0Locked 自动变 false；日志显示 item.to_bag）
                              （或日志显示 organize.fail，玩家从日志感知失败）

点击 itm0 [丢弃暂存] ─────→ inventoryStore.handleDiscardItm0()
                         └── commandQueue.execute({ command: 'obl_discard', slot: '0' })
                         └→ 统一成功路径（业务结果通过日志反馈）:
                              invalidate('player_inventory')
                              broadcast('game:action-completed')
                              （itm0 清空 → itm0Locked 自动变 false；日志显示 discard.success）
                              （slot=0 与普通槽位走同一逻辑：写回地图 + 清槽 + emit discard.success）
```

---

## 三、InventoryList.vue 扩展

### 3.1 布局

```
┌─ 背包 ──────────────────────────────────────────────┐
│                                                       │
│  ┌─ itm0 待整理区（itm0 非空时显示） ──────────────┐ │
│  │ ⚠ 待整理：[0] 布料×3                            │ │
│  │   [使用]  [整理背包]  [丢弃暂存]                 │ │
│  └──────────────────────────────────────────────────┘ │
│                                                       │
│  ┌─ 背包槽位网格（3列） ──────────────────────────┐ │
│  │ [1] 布料×5          [2] 废铁片×3    [3] 生兔肉×1│ │
│  │  [使用] [丢弃]        [丢弃]          [使用] [丢弃]│ │
│  │                                                   │ │
│  │ [4] 刀片碎片        [5] ···          [6] ···    │ │
│  │  耐久 20              ···             ···        │ │
│  │  [丢弃]                                  ···      │ │
│  └──────────────────────────────────────────────────┘ │
│                                                       │
│  items: 4/6                                           │
└───────────────────────────────────────────────────────┘
```

### 3.2 itm0 待整理区

**显示条件**：`inventoryStore.itm0 !== null`（即后端 `player_inventory.itm0` 非空）

**内容**：
- 标题行：`⚠ 待整理：[0] {道具名} {数量/耐久}`
  - 道具名通过 `getItemName(item.itmid, item.name)` 渲染（与现有槽位一致）
  - 数量/耐久显示规则见 §3.4
- 按钮行：`[使用]`（条件显示）+ `[整理背包]`（主）+ `[丢弃暂存]`（次）
  - `[使用]` 仅当 `itm0.usable === true` 时显示，调用 `inventoryStore.handleUseItem(0)`
  - `[整理背包]` 调用 `inventoryStore.handleOrganize()`
  - `[丢弃暂存]` 调用 `inventoryStore.handleDiscardItm0()`
  - 三按钮均受 `commandQueue.isLocked` 约束（锁定时 disabled）

**视觉**：
- 独立区块，与下方背包槽位网格用分隔线区分
- 使用 `⚠` 警示符号 + 警示边框/背景提示玩家"需处理"（灰阶渲染，不使用彩色）
- `⚠`（U+26A0）在部分 OS 会被着色，实施时需在 CSS 中强制 `color: inherit` 避免 OS 默认着色，与 Terminal 风格一致（黑底白字 + 灰阶强调）

### 3.3 背包槽位扩展

每个非空槽位增加：

| 元素 | 显示条件 | 实现 |
|------|---------|------|
| 数量/耐久显示 | 所有非空槽位 | 替换现有 `eff:{effect} dur:{durability}`，按 `stack` 字段区分（见 §3.4） |
| `[使用]` 按钮 | `usable === true` | 调用 `inventoryStore.handleUseItem(slot)` |
| `[丢弃]` 按钮 | 所有非空槽位（现有） | 保持现有 `onDiscard(slot)` 逻辑 |

**按钮布局**：`[使用] [丢弃]` 水平排列，仅 `usable=true` 时显示 `[使用]`。

### 3.4 数量/耐久语义区分显示

后端 `player_inventory.slots[]` 每个元素含 `stack`（bool）和 `durability`（string）字段，前端按 `stack` 区分显示：

| 模型 | `stack` | `durability` 含义 | 显示格式 | 示例 |
|------|---------|-------------------|---------|------|
| 数量模型 | `true` | 堆叠数量 | `×{N}` | `布料×5` |
| 耐久模型 | `false` | 当前耐久度 | `耐久 {N}` | `刀片碎片 耐久 20` |
| 无限标识 | 任意 | `'∞'` 或 `'999'` | `×∞` 或 `耐久 ∞` | `神兵 耐久 ∞` |

**实现**：

```typescript
function slotMeta(item: InventoryItem): string {
  const dur = String(item.durability ?? '0')
  if (dur === '∞' || dur === '999') {
    return item.stack ? '×∞' : '耐久 ∞'
  }
  return item.stack ? `×${dur}` : `耐久 ${dur}`
}
```

**移除现有 `eff:dur` 显示**：现有 `eff:{{ s.effect }} dur:{{ s.durability }}` 替换为上述 `slotMeta`。`effect` 字段不再在槽位卡片显示（玩家无需直接看到数值，效果通过使用体现）。

### 3.5 itm0 锁定态对背包界面的影响

**itm0 锁定 = itm0 非空**，此时后端 `oblivions_router.php` 拒绝所有非整理/丢弃命令。

**后端响应机制**（关键约束）：
- 后端命令处理函数（`cmd_handle_obl_use_item` 等）无 return 语句，HTTP 响应恒为 `{}`
- itm0 锁定门控触发时，后端 emit `system.itm0_pending` 日志，HTTP 响应仍为 `{}`
- 前端 `commandQueue.execute` 返回的 `result.success` **仅反映 HTTP 错误 / 并发锁 / PHP fatal**，无法反映业务失败
- **设计决策**：前端不依赖 `result.success` 感知业务失败，而是通过 log/error_log 系统感知命令执行结果

**日志感知链路**（已实现，无需新增）：

```
玩家点击 [使用] / [丢弃]
  → commandQueue.execute({command, slot})
  → 后端命令处理（itm0 锁定时 emit system.itm0_pending 到 obl_log）
  → HTTP 响应 {}（result.success === true）
  → dataManager.invalidate('player_inventory')
  → dataManager.broadcast('game:action-completed')
  → logStore 监听 game:action-completed（log.ts:167-170）
  → dataManager.fetch('obl_log', true) 拉取最新日志
  → LogPanel.vue 渲染日志（含 system.itm0_pending）
  → 玩家从日志区看到"需先整理"反馈
```

- 链路已完整实现：`broadcast('game:action-completed')` 触发 `logStore.refreshLog`（log.ts:167-170），拉取 obl_log 并渲染到 LogPanel（RightPanel CHRONICLE 区，玩家可见）
- itm0 锁定反馈走 obl_log（非 error_log），渲染在 LogPanel 日志区
- error_log（OblivionsErrorLogger）用于诊断性错误（如 `tick.dispatch.error`），通过 Toast 显示，不参与 itm0 锁定反馈
- 注意：log.ts:168 有 `if (commandQueue.pendingNpc) return;` 短路，但 `obl_use_item` / `obl_organize` / `obl_discard` 不涉及 NPC，pendingNpc 为 false，日志立即刷新

背包界面的表现：
- itm0 区域显示（§3.2）
- 背包槽位的 `[使用]` / `[丢弃]` 按钮 **保持可点击**（前端不主动禁用）
  - 玩家点击后，前端统一走"成功"路径（invalidate + broadcast），触发背包刷新 + 日志拉取
  - 后端若拒绝命令（itm0 锁定），emit `system.itm0_pending` 日志，玩家通过日志渲染感知"需先整理"
  - **理由**：避免前端重复实现门控逻辑，让后端作为单一真值源；日志系统是统一的反馈渠道
- `[使用]` / `[整理背包]` / `[丢弃暂存]` 按钮始终可用（这是 itm0 锁定时的唯一可用操作）

**与合成界面 itm0 锁定态策略的差异**：

合成界面设计案 §8.6 中 itm0 锁定态会**禁用选材区**（灰色遮罩），而背包界面保持按钮可点击。差异理由：

| 界面 | 操作复杂度 | 试错成本 | 策略 |
|------|-----------|---------|------|
| 背包 | 简单（点击即触发） | 低（一次点击 → 日志反馈） | 保持可点击，依赖后端门控 + 日志反馈 |
| 合成 | 复杂（选多个素材 → 调整数量 → 合成） | 高（多步操作后发现不能合成，体验差） | 禁用选材区，提供整理入口 |

背包操作是"一次点击即可完成或被拒绝"的原子操作，日志反馈足以让玩家理解结果；合成是多步操作，如果在 itm0 锁定态允许选材，玩家会浪费多步操作后才发现不能合成，体验差。

---

## 四、inventory.ts store 扩展

### 4.1 新增状态与计算属性

```typescript
export const useInventoryStore = defineStore('inventory', () => {
  // ── 现有状态 ──
  const inventoryData = ref<PlayerInventory | null>(null)
  const loading = ref<boolean>(false)

  // ── 现有计算属性 ──
  const slots = computed<InventoryItem[]>(() => inventoryData.value?.slots || [])
  const num = computed<number>(() => Number(inventoryData.value?.num) || 0)
  const limit = computed<number>(() => Number(inventoryData.value?.limit) || 20)
  const equipment = computed<Record<string, EquipmentSlot | null>>(/* 现有 */)

  // ── 新增计算属性 ──
  /** itm0 缓存槽内容（null 表示无待整理道具） */
  const itm0 = computed<InventoryItem | null>(() => inventoryData.value?.itm0 ?? null)

  /**
   * itm0 锁定状态（全局门控）
   * true = itm0 非空，后端拒绝所有非整理/丢弃命令
   * CraftModal 等其他组件只读引用此状态
   */
  const itm0Locked = computed<boolean>(() => !!itm0.value)

  // ── 现有动作 ──
  async function loadInventory(): Promise<void> { /* 现有 */ }
  async function handleDiscard(slot: number): Promise<void> { /* 现有 */ }

  // ── 新增动作 ──
  async function handleUseItem(slot: number): Promise<void>
  async function handleOrganize(): Promise<void>
  async function handleDiscardItm0(): Promise<void>

  return {
    // 现有
    inventoryData, loading, slots, num, limit, equipment,
    loadInventory, handleDiscard, registerListeners,
    // 新增
    itm0, itm0Locked,
    handleUseItem, handleOrganize, handleDiscardItm0,
  }
})
```

### 4.2 itm0Locked 状态来源（单一真值源）

**关键决策**：`itm0Locked` 从 `inventoryData.itm0` 派生（computed），**不**在 store 中维护独立的 `ref(false)`。

**理由**：
- itm0 状态来自后端 `player_inventory.itm0`，是持久状态（不只存在于 CraftModal 内）
- 独立 ref 会导致双源真值不同步（如拾取导致 itm0 锁定时，CraftModal 未打开，独立 ref 仍为 false）
- computed 派生确保任何 itm0 变化都自动反映到 itm0Locked

**CraftModal 的引用方式**：
- CraftModal 不维护自己的 `itm0Locked` 状态
- 直接 `import { useInventoryStore }` 读取 `inventoryStore.itm0Locked`
- 合成成功后若产物入 itm0 → `invalidate('player_inventory')` → `loadInventory` 重新拉取 → itm0 自动更新 → itm0Locked 自动变 true

### 4.3 新增动作实现

#### 4.3.1 handleUseItem

```typescript
/**
 * 使用道具（obl_use_item 命令）
 *
 * 后端流程（道具使用设计案 §4.1）：
 *   - 状态过滤（战斗状态自动拒绝）
 *   - 应用 use_effect（restore_hp / restore_sp / cure_bs 等）
 *   - 数量模型扣 itms-1（归零 unset），耐久模型不消耗
 *   - emit use_item.success
 *
 * @param slot 背包槽位号（1~maxslots）
 */
async function handleUseItem(slot: number): Promise<void> {
  debugBus.emit('action', 'useItem:trigger', { slot })
  try {
    await commandQueue.execute({
      command: 'obl_use_item',
      slot: String(slot),
    })
    // result.success 仅反映 HTTP/系统错误，业务失败通过 log 系统反馈
    // 统一走成功路径：触发背包刷新 + 日志拉取
    dataManager.invalidate('player_inventory')
    dataManager.broadcast('game:action-completed')
  } catch (e) {
    // catch 仅处理网络错误/JS 异常
    debugBus.emit('error', 'useItem:error', {
      error: e instanceof Error ? e.message : String(e),
    })
    dataManager.broadcast('ui:toast', {
      type: 'error',
      msg: '使用失败：' + (e instanceof Error ? e.message : String(e)),
    })
  }
}
```

#### 4.3.2 handleOrganize

```typescript
/**
 * 整理背包（obl_organize 命令）
 *
 * 后端流程（堆叠设计案 §7）：
 *   - 将 itm0 中的道具转移至背包空槽（不排序，仅合并同类）
 *   - 成功：itm0 清空，背包槽位更新
 *   - 失败（背包满）：emit organize.fail，itm0 保持不变
 *
 * 成功后 itm0Locked 自动变 false（因 itm0 清空）。
 */
async function handleOrganize(): Promise<void> {
  debugBus.emit('action', 'organize:trigger', {})
  try {
    await commandQueue.execute({
      command: 'obl_organize',
    })
    // result.success 仅反映 HTTP/系统错误，业务失败（如 organize.fail 背包满）通过 log 系统反馈
    // 统一走成功路径：触发背包刷新 + 日志拉取
    dataManager.invalidate('player_inventory')
    dataManager.broadcast('game:action-completed')
    // itm0 清空后 itm0Locked 自动变 false（computed 响应式）
  } catch (e) {
    // catch 仅处理网络错误/JS 异常
    debugBus.emit('error', 'organize:error', {
      error: e instanceof Error ? e.message : String(e),
    })
    dataManager.broadcast('ui:toast', {
      type: 'error',
      msg: '整理失败：' + (e instanceof Error ? e.message : String(e)),
    })
  }
}
```

#### 4.3.3 handleDiscardItm0

```typescript
/**
 * 丢弃 itm0 暂存道具（obl_discard slot=0 命令）
 *
 * 后端复用 obl_discard_item(slot=0) 分支（堆叠设计案阶段2）。
 * 成功后 itm0 清空，itm0Locked 自动变 false。
 */
async function handleDiscardItm0(): Promise<void> {
  debugBus.emit('action', 'discardItm0:trigger', {})
  try {
    await commandQueue.execute({
      command: 'obl_discard',
      slot: '0',
    })
    // result.success 仅反映 HTTP/系统错误，业务失败通过 log 系统反馈
    // 统一走成功路径：触发背包刷新 + 日志拉取
    dataManager.invalidate('player_inventory')
    dataManager.broadcast('game:action-completed')
    // itm0 清空后 itm0Locked 自动变 false
  } catch (e) {
    // catch 仅处理网络错误/JS 异常
    debugBus.emit('error', 'discardItm0:error', {
      error: e instanceof Error ? e.message : String(e),
    })
    dataManager.broadcast('ui:toast', {
      type: 'error',
      msg: '丢弃失败：' + (e instanceof Error ? e.message : String(e)),
    })
  }
}
```

---

## 五、types/api.ts 类型扩展

### 5.1 InventoryItem 扩展

```typescript
/** 背包槽位（player_inventory.slots 的元素） */
export interface InventoryItem {
  slot: number;
  empty: boolean;
  name?: string;
  itmid?: string;
  item_id?: string;
  kind?: string;
  effect?: string | number;
  durability?: string | number;
  iid?: string | number;
  // ── 新增字段（后端已返回，前端类型补齐） ──
  /** 是否可使用（tag_usable） */
  usable?: boolean;
  /** 道具 tags 数组（供合成系统匹配） */
  tags?: string[];
  /** 道具类别（供合成系统匹配） */
  itmk?: string;
  /** 是否可堆叠（true=数量模型，false=耐久模型） */
  stack?: boolean;
  [key: string]: unknown;
}
```

### 5.2 PlayerInventory 扩展

```typescript
/** 玩家背包（api_v2.php?action=player_inventory） */
export interface PlayerInventory {
  slots: InventoryItem[];
  num: number;
  limit: number;
  // ── 新增字段（后端已返回，前端类型补齐） ──
  /** itm0 缓存槽内容（null 表示无待整理道具） */
  itm0?: InventoryItem | null;
}
```

**注意**：后端 `player_inventory` 响应中还包含 `equipment` 字段（仅 weapon/armor 简化版），但前端 `inventory.ts` 的 `equipment` computed 实际从 `player_info.equipment` 读取（7 槽位完整版：wep/wep2/arb/arh/ara/arf/art）。因此 `PlayerInventory` 类型**不**包含 `equipment` 字段，避免类型混淆。

### 5.3 类型扩展说明

- 后端 `handle_player_inventory` 已返回 `usable/tags/itmk/stack/itm0` 字段（见 `api_v2.php` L383-L411），前端类型定义仅为补齐，**无需后端改动**
- `InventoryItem` 已有 `[key: string]: unknown` 索引签名，技术上前端已能访问新字段，但显式定义类型可获得 IDE 提示和编译时检查

---

## 六、日志模板核对

后端实现阶段已注册以下日志模板，本案仅需核对前端 `log-templates.ts` 是否已包含：

| 日志 ID | 触发场景 | 前端模板状态 |
|---------|---------|-------------|
| `use_item.empty_slot` | 使用空槽位 | ✅ 已注册（L323） |
| `use_item.not_usable` | 使用不可使用的道具 | ✅ 已注册（L326） |
| `use_item.broken` | 道具已损坏 | ✅ 已注册（L329） |
| `use_item.effect_not_registered` | use_effect 未注册 | ✅ 已注册（L335） |
| `use_item.success` | 使用成功 | ✅ 已注册（L340） |
| `durability.broken` | 耐久归零损坏 | ✅ 已注册（L346） |
| `item.to_bag` | 道具入背包（整理成功） | ✅ 已注册 |
| `organize.fail` | 整理失败（背包满） | ✅ 已注册（L246） |
| `craft.success` | 合成成功 | ✅ 已注册（L354） |
| `craft.fail_no_match` | 合成无匹配 | ✅ 已注册（L361） |
| `craft.fail_ambiguous` | 合成指向不明确 | ✅ 已注册（L364） |
| `craft.fail_bag_full` | 背包空间不足 | ✅ 已注册（L370） |
| `system.itm0_pending` | itm0 被占用 | ✅ 已注册 |

**结论**：本案涉及的日志模板均已注册，无需新增。

---

## 七、文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `vex-vue/src/components/inventory/InventoryList.vue` | 修改 | 新增 itm0 待整理区；扩展槽位卡片（数量/耐久区分 + `[使用]` 按钮） |
| `vex-vue/src/stores/inventory.ts` | 修改 | 新增 `itm0` / `itm0Locked` 计算属性；新增 `handleUseItem` / `handleOrganize` / `handleDiscardItm0` 动作 |
| `vex-vue/src/types/api.ts` | 修改 | `InventoryItem` 增 `usable/tags/itmk/stack`；`PlayerInventory` 增 `itm0` |

---

## 八、实施顺序建议

1. **types/api.ts 类型扩展**（无依赖，先定义类型）
2. **inventory.ts store 扩展**（依赖类型，新增计算属性和动作）
3. **InventoryList.vue 扩展**（依赖 store，渲染 itm0 区域和使用按钮）

三步可在一次提交中完成，无外部依赖。

---

## 九、与合成界面设计案的协作点

合成界面设计案（CraftModal）需引用本案的以下定义：

| 引用项 | 来源 | CraftModal 使用方式 |
|--------|------|---------------------|
| `inventoryStore.itm0Locked` | 本案 §4.2 | CraftModal 读取此状态决定是否禁用选材 |
| `inventoryStore.itm0` | 本案 §4.1 | CraftModal 显示"产物已暂存"提示时引用 itm0 内容 |
| `inventoryStore.handleOrganize()` | 本案 §4.3.2 | CraftModal 内 `[整理背包]` 按钮调用（若设计案决定在 CraftModal 内也放置此按钮） |
| `inventoryStore.handleDiscardItm0()` | 本案 §4.3.3 | CraftModal 内 `[丢弃暂存]` 按钮调用（同上） |

**职责边界**：
- 整理/丢弃 itm0 的**业务逻辑**在本案（inventoryStore）
- 整理/丢弃 itm0 的**入口位置**由各设计案自行决定（背包界面必有，CraftModal 可选）

---

*文档版本：v1.3 | 2026-07-06（v1.2 基础上补充日志感知链路验证：log.ts:167-170 已实现 game:action-completed → refreshLog 触发链路）*
