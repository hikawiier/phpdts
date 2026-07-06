# itm0 拾取语义拆分设计案

> 本案将 itm0 中转槽的"手持"语义在日志层显式化：把当前合并 emit 的 `pickup.success`（拾取+入背包）拆分为两个独立事件——"捡起（道具进入 itm0）"和"放入背包（itm0 → 背包）"，让前端可分别呈现两个时刻。
>
> 依据：[DESIGN.md §2.24](../DESIGN.md#224-itm0-缓存槽与事件解耦)（itm0 缓存槽与事件解耦）、§2.23（道具数据三层分离）、§2.2（后端只输出事件结构）。

---

## 一、背景与问题

### 1.1 itm0 的设计语义

`itempara[0]` 是新增道具（拾取/合成产物/未来卸装备）的中转缓存槽。所有新增道具**先入 itm0，再整理入背包**，语义上等同于"将道具暂时拿在手上"。

§2.24 已确立两条核心约束：
- **函数独立性**：`obl_put_item_to_itm0`（放入 itm0）与 `obl_organize_inventory`（整理入背包）是两个独立函数，互不内嵌。
- **事件解耦**：操作成功与整理失败是两个独立事件，前端可同时收到分别处理。

### 1.2 当前实现的问题

**`obl_pickup_item`**（[item.basic.func.php:472-580](../include/game/item/item.basic.func.php)）的步骤 9 在自动整理之后才 emit `pickup.success`，注释原话：

> 9. 拾取成功（道具已从地图删除，**已存入 itm0 或背包**）

这句话暴露了问题——当前 emit 时机把"捡起（已入 itm0）"和"入背包（已整理）"两个语义合并成单个事件，违背 §2.24 的事件解耦原则。

**`item_craft`**（[item.craft.func.php:829-877](../include/game/item/item.craft.func.php)）更彻底——循环内完全不 emit 单产物入背包事件，只在最后 emit 一个总 `craft.success`。

**`cmd_handle_obl_organize`**（[oblivions_commands.php:65-77](../include/command/oblivions_commands.php)）的手动整理 emit `organize.success`（无参数），与自动整理不共享事件 ID，且无法携带道具名。

### 1.3 前端文案现状

| ID | 当前文案 | 问题 |
|----|---------|------|
| `pickup.success` | `你拾取了{item_name}。` | 用 item_name 字符串，违背 §2.23 三层分离；语义合并 |
| `pickup.nearsighted_reveal` | `你拿起了看似普通的东西——原来是xxx！` | 已含"拿起"语义，但之后不再 emit 入背包 |
| `pickup.trap` | `你伸手去拿xxx——那是一个陷阱！` | 道具不入 itm0，无后续 |
| `organize.success` | `你将手持道具收进了背包。` | 无道具名参数，无法定位是哪个道具 |
| `organize.fail` | `背包已满，xxx仍拿在手中。` | 已用 item_id 查 locale，符合规范 |

---

## 二、设计目标

1. **贯彻 §2.24 事件解耦**：把"操作成功"（道具进入 itm0）和"整理成功"（道具进入背包）作为两个独立事件分别 emit，让前端可分别呈现。
2. **统一事件 ID**：手动整理、自动整理（拾取/合成内部）成功的入背包事件复用同一 ID，命名上不绑死拾取场景，为未来卸装备流程预留扩展。
3. **统一参数规范**：所有道具相关日志事件改为传 `item_id`，前端查 `ITEM_LOCALE` 渲染名称，符合 §2.23 三层分离。
4. **控制 Toast 噪音**：拆分后只对"捡起"事件触发 Toast，"入背包"事件仅在日志区呈现，避免拾取时双 Toast 刷屏。

---

## 三、后端改动方案

### 3.1 `obl_pickup_item` emit 时机拆分

当前流程：

```
6. obl_put_item_to_itm0()
7. 原子删除地图实例（失败回滚 itm0）
8. obl_organize_inventory()  ← 自动整理
9. if (!$was_nearsighted) emit pickup.success  ← 合并 emit（含近视跳过判断）
10. 整理失败 → emit organize.fail
```

改动后流程：

```
6. obl_put_item_to_itm0()
7. 原子删除地图实例（失败回滚 itm0 + emit system.pickup_concurrent_loss，return）
7.5 if (!$was_nearsighted) emit pickup.success  ← 移至此处（捡起成功，道具在 itm0）
8. obl_organize_inventory()   ← 自动整理
8.5 整理成功 → emit item.to_bag  ← 新增：放入背包
8.6 整理失败 → emit organize.fail（不变）
```

**关键点**：
- 步骤 9 的 `if (!$was_nearsighted)` 判断**移到步骤 7.5**（保持近视道具跳过 `pickup.success` 的行为，避免与 `pickup.nearsighted_reveal` 重复）。
- `pickup.success` 的 emit 时机提前到原子删除成功之后、自动整理之前。即使整理失败，玩家也已经看到"捡起了 xxx"的反馈，与"道具卡在 itm0，仍拿在手上"的 `organize.fail` 语义自洽。
- 整理成功后 emit 新事件 `item.to_bag`，携带 `item_id`。
- 删除原步骤 9 的合并 emit 与注释。

### 3.2 `pickup.success` 参数规范调整

当前传 `item_name`（后端 include item_table 查询的字符串）。改为传 `item_id`，前端查 `ITEM_LOCALE` 渲染。

```php
// 改动前
$obl_log->emit('pickup.success', 'pickup', [
    'item_name' => $real_itm,
]);

// 改动后
$obl_log->emit('pickup.success', 'pickup', [
    'item_id' => (string)$item['item_id'],
]);
```

**影响范围**：
- `$real_itm` 变量仍需保留——步骤 4 近视揭示的 `pickup.nearsighted_reveal` 和 `pickup.trap` 仍用 `item_name`（揭示场景下道具名是关键信息，且可能涉及改名机制未来扩展，暂不改）。
- 步骤 5 构建道具实例不需要 `$real_itm`（itm 字段已留空，遵循新拾取约定）。

### 3.3 `pickup.nearsighted_reveal` 后续事件补全

当前代码（[item.basic.func.php:514-529](../include/game/item/item.basic.func.php)）：揭示后**不 return**（仅陷阱分支 return），继续走步骤 5-9。步骤 9 通过 `if (!$was_nearsighted)` 跳过 `pickup.success` emit，避免与 `pickup.nearsighted_reveal` 重复。

**改动**：本次不调整揭示流程本身。步骤 9 的 `if (!$was_nearsighted)` 判断移到步骤 7.5（见 §3.1），行为保持一致——近视道具跳过 `pickup.success`，但仍 emit `item.to_bag`。

`pickup.nearsighted_reveal` 文案"你拿起了看似普通的东西——原来是xxx！"已含"拿起"语义，等同于 `pickup.success`，不重复 emit。

### 3.4 `item_craft` 合成流程补全

当前循环内只 emit `organize.fail`（失败时），成功时不 emit。改动后每个产物整理成功 emit `item.to_bag`：

```php
// 放入 itm0
if (!obl_put_item_to_itm0($pdata, $new_item)) {
    $obl_log->emit('system.itm0_occupied', 'system');
    break;
}

// 自动整理（转移 itm0 → 背包）
$organized = obl_organize_inventory($pdata);
if (!$organized) {
    $obl_log->emit('organize.fail', 'system', ['item_id' => $item_id]);
    break;
}

// 新增：产物入背包事件
$obl_log->emit('item.to_bag', 'system', ['item_id' => $item_id]);
```

**多产物场景**：N 个产物 emit N 条 `item.to_bag`，前端日志面板自然累积，不合并。Toast 不触发（见 §4.3），不会刷屏。

`craft.success` 仍保留为合成总事件，在循环结束后 emit，携带 `recipe_id`。语义为"合成完成"，与单产物入背包事件互补。

**合成失败的语义**：若循环中某个产物整理失败（背包满，产物卡 itm0），emit `organize.fail` 后 break 出循环，**循环外仍会 emit `craft.success`**。这是当前行为，本次不调整——合成行为本身完成了（素材已扣减、之前的产物已入背包），只是某个产物卡在 itm0 需要玩家手动整理。前端同时收到 `craft.success` + `organize.fail`，分别在日志区呈现"合成成功"和"背包已满，xxx 仍拿在手中"。

### 3.5 `cmd_handle_obl_organize` 手动整理

当前 emit `organize.success`（无参数）。改为 emit `item.to_bag`（携带 item_id），与自动整理复用同一事件。

**关键修正**：`obl_organize_inventory` 成功后会 `unset($pdata['itempara'][0])`，所以 `item_id` 必须在调用 organize **之前**读取：

```php
function cmd_handle_obl_organize(&$pdata) {
    if (!oblivions_is_active()) return;
    include_once GAME_ROOT . './oblivions/include/game/item/item.basic.func.php';
    global $obl_log;
    // item_id 必须在 organize 之前读取（成功后 itm0 已清空）
    $item_id = isset($pdata['itempara'][0]['itmid']) ? (string)$pdata['itempara'][0]['itmid'] : '';
    $success = obl_organize_inventory($pdata);
    if ($success) {
        $obl_log->emit('item.to_bag', 'system', ['item_id' => $item_id]);
    } else {
        $obl_log->emit('organize.fail', 'system', ['item_id' => $item_id]);
    }
}
```

### 3.6 事件 ID `organize.success` 的处理

`organize.success` 被 `item.to_bag` 替代，**删除该 ID**。前端模板同步移除。

理由：
- `organize.success` 原本只用于手动整理，自动整理不 emit，存在事件 ID 不一致问题。
- 改动后两者统一为 `item.to_bag`，`organize.success` 失去存在意义。
- 前端模板对应清理，避免出现孤儿模板。

---

## 四、前端改动方案

### 4.1 `log-templates.ts` 模板调整

| ID | 改动类型 | 新文案 / 新模板 |
|----|---------|----------------|
| `pickup.success` | 改文案 + 改参数 | 改为 render 函数：`捡起了xxx。`（查 `ITEM_LOCALE[item_id].name`） |
| `item.to_bag` | 新增 | render 函数：`把xxx放进了背包。`（查 `ITEM_LOCALE[item_id].name`） |
| `organize.success` | 删除 | —— |
| `pickup.nearsighted_reveal` | 不变 | `你拿起了看似普通的东西——原来是xxx！` |
| `pickup.trap` | 不变 | `你伸手去拿xxx——那是一个陷阱！` |
| `organize.fail` | 不变 | `背包已满，xxx仍拿在手中。` |

**`pickup.success` 改动示例**：

```ts
// 改动前
'pickup.success': {
  text: '你拾取了{item_name}。',
  highlight: ['item_name'],
  highlightClass: 'yellow',
},

// 改动后
'pickup.success': {
  render: (params) => {
    const name = ITEM_LOCALE[params.item_id as string]?.name ?? params.item_id;
    return `捡起了<span class="yellow">${escapeHtml(name)}</span>。`;
  },
},
```

**`item.to_bag` 新增模板**：

```ts
'item.to_bag': {
  render: (params) => {
    const name = ITEM_LOCALE[params.item_id as string]?.name ?? params.item_id;
    return `把<span class="yellow">${escapeHtml(name)}</span>放进了背包。`;
  },
},
```

### 4.2 `log.ts` LOGCATEGORY_TAGS 调整

`item.to_bag` 的 logcategory 是 `system`，对应标签 `SYS`。这与 `organize.fail` 一致，无需新增标签。

### 4.3 `log.ts` TOAST_RULES 调整

```ts
// 改动前
export const TOAST_RULES: Record<string, { style: ToastStyle }> = {
  'pickup.bag_full': { style: 'error' },
  'pickup.success': { style: 'success' },
  'pickup.not_found': { style: 'error' },
  'search.result': { style: 'success' },
  'search.already_searched': { style: 'error' },
  'discard.success': { style: 'success' },
};

// 改动后（item.to_bag 加入白名单，多条批量合并）
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

**Toast 触发逻辑（`refreshLog` 内）双 Toast 合并 + 批量合并**：

拾取成功场景下 `pickup.success` + `item.to_bag` 几乎同时弹出，合并为单条 Toast 更清晰：
```ts
// 预扫描：检测拾取成功场景（pickup.success + item.to_bag 同时存在且无整理失败）
const shouldMergePickupToBag = hasPickupSuccess && toBagEntries.length > 0 && !hasOrganizeFail;
if (shouldMergePickupToBag) {
  // 合并为"捡起了 xxx，放入了背包。"（单道具）或"捡起了 N 件道具，放入了背包。"（批量）
  const mergedContent = renderPickupToBagMerged(itemId, toBagEntries.length);
  toastStore.showToast(mergedContent, 'success', 2000, true, 'pickup.to_bag');
}
```

非拾取场景（手动整理 / 合成 / 近视揭示）逐条处理，`item.to_bag` 多条批量合并：
```ts
const content = toBagEntries.length > 1
  ? `把<span class="yellow">${toBagEntries.length}</span>件道具放进了背包。`
  : renderLogEntry(entry);
toastStore.showToast(content, rule.style, 2000, true, 'item.to_bag');
```

**理由**：
- 拾取成功场景双 Toast 几乎同时弹出，合并为"捡起了 xxx，放入了背包。"更清晰，避免视觉噪音。
- 批量拾取合并为"捡起了 N 件道具，放入了背包。"（N = item.to_bag 数量）。
- 非拾取场景（合成多产物 / 手动整理）的 `item.to_bag` 批量合并为"把 N 件道具放进了背包"。
- 拾取背包满场景（有 `organize.fail`）不合并，`pickup.success` 正常 Toast"捡起了 xxx"，Itm0Modal 强制处理卡住的道具。
- `organize.fail` 不加入白名单：背包满时 Itm0Modal 持续显示提供强反馈，无需 Toast。

### 4.4 `LogPanel.vue` 日志区不渲染黑名单

`pickup.success` 和 `organize.fail` 不在日志面板渲染（仅 Toast / Itm0Modal 反馈）：

```ts
const HIDDEN_LOG_IDS = new Set<string>(['pickup.success', 'organize.fail']);
// visibleEntries computed 中：if (HIDDEN_LOG_IDS.has(entry.id)) continue;
```

- `pickup.success`：瞬时"捡起"动作，Toast 已反馈，日志区由 `item.to_bag` 记录"入背包"结果
- `organize.fail`：背包满时 Itm0Modal 持续显示（强制玩家处理），日志区不必重复

### 4.5 `inventory.ts` 注释微调

[inventory.ts:184](../../vex-vue/src/stores/inventory.ts#L184) 当前注释：

```ts
// 成功路径（itm0 清空）不广播 toast：道具入背包视觉即可见，相当于"捡起"
```

改动后：

```ts
// 成功路径（itm0 清空）不广播 toast：后端已 emit item.to_bag 日志事件，
// 背包视觉变化（数量+1 / 新槽位）由 game:action-completed → loadInventory 自然呈现
```

注释微调，无功能改动。

---

## 五、事件契约表（改动后完整状态）

### 5.1 拾取相关事件

| ID | logcategory | 触发时机 | params | 前端呈现 |
|----|------------|---------|--------|---------|
| `pickup.not_found` | pickup | 道具实例不存在 | `{}` | 日志 + Toast(error) |
| `pickup.empty_item` | pickup | itms='0'/空 | `{}` | 日志 |
| `pickup.not_adjacent` | pickup | 位置不匹配 | `{}` | 日志 |
| `pickup.unknown` | pickup | 未发现 | `{}` | 日志 |
| `pickup.trap` | pickup | 近视揭示为陷阱 | `{item_name}` | 日志 |
| `pickup.nearsighted_reveal` | pickup | 近视揭示真实身份 | `{item_name}` | 日志 |
| `pickup.bag_full` | pickup | （后端不 emit；前端 [tileAction.ts:236](../../vex-vue/src/stores/tileAction.ts#L236) 用作批量拾取 toast mergeId） | `{}` | 日志 + Toast(error) |
| `pickup.success` | pickup | **道具进入 itm0（拿在手上）** | `{item_id}` ★改 | 仅 Toast(success)（日志区黑名单） |
| `item.to_bag` ★新增 | system | **itm0 → 背包整理成功** | `{item_id}` | 日志 + Toast(success，多条合并) |
| `organize.fail` | system | 整理失败（背包满） | `{item_id}` | 仅 Itm0Modal（日志区黑名单，不 Toast） |

### 5.2 合成相关事件（改动部分）

| ID | logcategory | 触发时机 | params | 前端呈现 |
|----|------------|---------|--------|---------|
| `item.to_bag` ★新增 | system | 每个产物整理入背包 | `{item_id}` | 日志 + Toast(success，多条合并) |
| `craft.success` | system | 合成循环结束 | `{recipe_id}` | 日志 |
| `craft.fail_itm0_occupied` | system | itm0 被占用 | `{}` | 日志 |
| `organize.fail` | system | 产物整理失败 | `{item_id}` | 仅 Itm0Modal（日志区黑名单） |
| 其他 craft.fail_* | system | 各种失败 | 见现有 | 日志 |

### 5.3 手动整理相关事件

| ID | logcategory | 触发时机 | params | 前端呈现 |
|----|------------|---------|--------|---------|
| `item.to_bag` ★新增 | system | 手动整理成功 | `{item_id}` | 日志 + Toast(success) |
| `organize.fail` | system | 手动整理失败 | `{item_id}` | 仅 Itm0Modal（日志区黑名单） |
| ~~`organize.success`~~ | ~~system~~ | ~~删除~~ | —— | —— |

### 5.4 system 类共通事件

| ID | logcategory | 触发时机 | params |
|----|------------|---------|--------|
| `system.pickup_concurrent_loss` | system | 并发拾取失败 | `{}` |
| `system.itm0_occupied` | system | itm0 已被占用 | `{}` |
| `system.itm0_pending` | system | itm0 锁定提示 | `{}` |
| `system.mechanic_max_hp_up` | system | 最大 HP 提升 | `{value, hp, mhp}` |

---

## 六、边界与一致性检查

### 6.1 §2.24 事件解耦原则对齐

| 原则 | 改动前 | 改动后 |
|------|--------|--------|
| 函数独立性 | ✓ 已实现 | ✓ 不变 |
| 事件解耦（操作成功 vs 整理成功） | ✗ 拾取合并 emit | ✓ 拆分为 `pickup.success` + `item.to_bag` |
| 事件解耦（操作成功 vs 整理失败） | ✓ 已实现 | ✓ 不变 |
| 整理函数不输出日志 | ✓ 已实现 | ✓ 不变（仍由调用方 emit） |

### 6.2 §2.23 三层分离对齐

| 事件 | 改动前参数 | 改动后参数 | 符合规范 |
|------|-----------|-----------|---------|
| `pickup.success` | `item_name`（字符串） | `item_id` | ✓ |
| `pickup.nearsighted_reveal` | `item_name` | `item_name`（保留） | △ 见下方说明 |
| `pickup.trap` | `item_name` | `item_name`（保留） | △ 见下方说明 |
| `item.to_bag` | —— | `item_id` | ✓ |
| `organize.fail` | `item_id` | `item_id` | ✓ |

**`pickup.nearsighted_reveal` 和 `pickup.trap` 保留 `item_name` 的理由**：
- 近视揭示场景下，道具的"真实身份名称"是事件的核心信息，可能涉及改名机制未来扩展（ itm 字段语义调整后，揭示的名称可能来自不同来源）。
- 这两个事件不在本次拆分范围内，保持现状不动，避免改动范围扩大。
- 未来若需要统一，可作为独立的"日志事件参数规范化"任务处理。

### 6.3 §2.2 后端只输出事件结构对齐

改动后后端仍只输出事件结构（id + params），不预判前端如何呈现。前端完全控制文案、样式、Toast 触发规则。`item.to_bag` 是否触发 Toast 由前端 `TOAST_RULES` 决定，后端不感知。

### 6.4 批量拾取场景

`handlePickupAll`（[tileAction.ts:221](../../vex-vue/src/stores/tileAction.ts#L221)）逐个调用 `obl_pickup`，每个道具 emit 一对 `pickup.success` + `item.to_bag`：
- 日志面板累积 N 条 `item.to_bag`（`pickup.success` 在黑名单不渲染），合理代价。
- Toast：`pickup.success` 多条由 `mergeId=entry.id` 合并为单 Toast；`item.to_bag` 多条由 Toast 触发逻辑批量合并为"把 N 件道具放进了背包"，不会刷屏。

### 6.5 合成多产物场景

N 个产物 emit N 条 `item.to_bag` + 1 条 `craft.success`：
- 日志面板累积 N+1 条，合理代价。
- Toast：`item.to_bag` 多条由 Toast 触发逻辑批量合并为"把 N 件道具放进了背包"；`craft.success` 不在白名单，不触发 Toast。
- 玩家通过合成模态框关闭 + 背包视觉变化 + Toast 感知结果。

### 6.6 未来卸装备流程的扩展性

卸装备会走 itm0（§2.24 明确提及"未来卸装备"作为复用场景）。`item.to_bag` 的命名不绑死拾取场景，未来卸装备流程的"卸下 → itm0 → 整理入背包"可直接复用 `item.to_bag` 作为入背包事件。

---

## 七、实施步骤

### 7.1 后端改动

| 步骤 | 文件 | 改动 |
|------|------|------|
| 1 | `oblivions/include/game/item/item.basic.func.php` | `obl_pickup_item`：步骤 7.5 新增 emit `pickup.success`（传 item_id，含 `!$was_nearsighted` 判断）；步骤 9 删除原合并 emit；步骤 8.5 新增 emit `item.to_bag`（整理成功时）；同步更新函数头注释（行 450-471 的 10 步流程描述） |
| 2 | `oblivions/include/game/item/item.craft.func.php` | `item_craft`：循环内整理成功后新增 emit `item.to_bag`；同步更新步骤 9/10 注释（事件解耦描述） |
| 3 | `oblivions/include/command/oblivions_commands.php` | `cmd_handle_obl_organize`：emit 改为 `item.to_bag`（携带 item_id），item_id 在调用 organize 前读取 |
| 4 | `oblivions/CODEBASE.md` | 同步更新 §8.14 多处描述：行 1214/1232 的 `obl_organize_inventory` emit 说明（`organize.success` → `item.to_bag`）；行 1233 的 `obl_pickup_item` 流程描述；行 1237 的事件解耦原则补充 `item.to_bag`；行 1463 的整理失败事件描述 |

### 7.2 前端改动

| 步骤 | 文件 | 改动 |
|------|------|------|
| 5 | `vex-vue/src/data/log-templates.ts` | `pickup.success` 改为 render 函数（查 ITEM_LOCALE）；新增 `item.to_bag` 模板；删除 `organize.success` |
| 6 | `vex-vue/src/stores/log.ts` | `TOAST_RULES` 加入 `item.to_bag`（success）；Toast 触发逻辑对 `item.to_bag` 批量合并为"把 N 件道具放进了背包" |
| 7 | `vex-vue/src/components/log/LogPanel.vue` | 新增 `HIDDEN_LOG_IDS` 黑名单（`pickup.success`, `organize.fail`），`visibleEntries` 跳过不渲染 |
| 8 | `vex-vue/src/stores/inventory.ts` | `handleOrganize` 注释微调（无功能改动） |

### 7.3 验证清单

- [ ] 拾取普通道具：日志区仅出现"把 xxx 放进了背包。"（pickup.success 在黑名单），Toast 弹"捡起了 xxx，放入了背包。"（合并）
- [ ] 拾取近视道具：日志区出现"你拿起了看似普通的东西——原来是 xxx！"+"把 xxx 放进了背包。"，Toast 仅弹"把 xxx 放进了背包。"（nearsighted_reveal 不在白名单，无 pickup.success 不合并）
- [ ] 拾取陷阱道具：日志区仅出现"你伸手去拿 xxx——那是一个陷阱！"，无后续事件
- [ ] 背包满时拾取：日志区无条目（pickup.success + organize.fail 均在黑名单），Toast 弹"捡起了 xxx。"（有 organize.fail 不合并），Itm0Modal 持续显示
- [ ] 合成单产物：日志区出现"把 xxx 放进了背包。"+"合成成功：yyy。"，Toast 弹"把 xxx 放进了背包。"
- [ ] 合成多产物：日志区出现 N 条"把 xxx 放进了背包。"+"合成成功：yyy。"，Toast 弹"把 N 件道具放进了背包。"
- [ ] 手动整理成功：日志区出现"把 xxx 放进了背包。"，Toast 弹"把 xxx 放进了背包。"
- [ ] 手动整理失败：日志区无条目（organize.fail 在黑名单），Itm0Modal 持续显示
- [ ] 批量拾取：日志区累积 N 条 item.to_bag（pickup.success 在黑名单），Toast 弹"捡起了 N 件道具，放入了背包。"（合并）
- [ ] 改名机制启用后（未来）：拾取日志显示 locale 名称，不受 itm 字段留空影响

---

## 八、影响范围与风险

### 8.1 影响范围

- **后端代码**：3 个文件，改动集中在 emit 调用，无数据结构变化。
- **后端文档**：1 个文件（CODEBASE.md），同步描述。
- **前端**：4 个文件，改动集中在模板、Toast 规则、日志区黑名单，无状态管理变化。
- **数据库**：无变化。
- **API 契约**：无变化（`obl_log` API 仍返回 LogEntry 数组，前端按 ID 渲染）。

### 8.2 风险

1. **日志条目数量增加**：拾取场景从 1 条变 2 条，合成多产物场景从 1 条变 N+1 条。日志条目上限 200 条（§1.9），日常玩家不会触及上限，无风险。
2. **`pickup.success` emit 时机提前**：从整理之后提前到整理之前。若整理过程中 PHP 异常崩溃，玩家会看到"捡起了 xxx"但道具实际卡在 itm0。这是符合预期的——重连后玩家看到 itm0 有道具，会主动整理或丢弃，不会丢失数据（§2.24 itm0 门控保护）。

---

**设计案结束。** 待确认后按 §七 实施步骤执行。
