# 道具POI交互系统-设计案

> 让标注 `tag_poi_interactive` 的道具能与特定 mechanic POI 交互产生效果（撬棍撬门、钥匙开宝箱、点火器生火等）。
>
> 本案基于 E-10（POI 搜刮三档判定）、L-9（POI 交互模态框）、F-3（使用效果分发器）三个已落地框架扩展，与 poi.search 命令并列存在，不破坏既有契约。

---

## 一、问题与目标

### 1.1 现状审计

| 维度 | 现状 | 缺口 |
|------|------|------|
| Tag 系统 | DESIGN.md 1.8 已定义 `tag_poi_interactive` 为系统钩子 Tag，"可与 POI 交互" | **item_table.php 中没有任何道具标注该 Tag**；后端没有任何交互消费逻辑 |
| POI 系统 | poi_table.php 含三类 POI：可搜索（E-10 三档判定）/ 机制型（mechanic 分发 `obl_mechanic_{name}`）/ 工作台（mechanic=craft_source） | **没有可被道具触发交互的 POI**；mechanic 分发框架只处理 life_totem/skill_totem/craft_source，不接受道具入参 |
| 命令系统 | poi.search 已实现"搜刮 POI 获得道具"（不需要特定道具） | **没有 poi.interact 命令**；无法表达"用 X 道具对 Y POI 触发 Z 效果"语义 |
| 前端 UI | L-9 模态框三列四区布局已完成；PoiToolSelector 仅作为 poi.search 的工具路由选择 | **无交互入口**；玩家无法从 UI 发起"道具 × POI"互动 |
| 道具模板 | crowbar / lockpick / lockpick_set / lighter / torch_unlit 等典型工具道具已存在，但仅 lockpick 在 poi.search 的 prob_mods_source 中作为改良工具使用 | **这些道具没有"对 POI 触发效果"的能力**；撬棍、点火器等只能作为装备或修饰概率 |

### 1.2 设计目标

| 目标 | 实现方式 |
|------|---------|
| 让 tag_poi_interactive 真实生效 | 给 5 个典型道具补 `tag_poi_interactive` + 关联交互配置 |
| 配置驱动的交互映射 | 新建 `poi_interactions.php` 配置表：`{poi_mechanic × required_item/tag → effect_type + effect_params}` |
| 三种典型效果函数 | 实现 `poi_interact_effect_unlock_door` / `open_container` / `ignite` |
| 新增 poi.interact 命令 | payload `{slot, iaid}`，advances_tick=true，与 poi.search 同级 |
| 前端闭环 | L-9 交互态新增"道具交互"区，显示可用交互按钮 |
| 不破坏既有契约 | 不修改 poi.search 逻辑 / F-2 合成 / F-3 use_effect / F-5 装备 |

### 1.3 范围边界

**在本案范围内**：
- 5 个道具补充 `tag_poi_interactive`（crowbar / lockpick / lockpick_set / lighter / torch_unlit）
- 新建 `oblivions/gamedata/poi_interactions.php` 交互配置表
- 新增 3 个 POI 模板（locked_door / locked_chest / campfire_unlit），均采用 `mechanic=interact_*` 与 E-10 三档判定并列
- 新建 `oblivions/include/game/poi/poi.interact.func.php` 核心函数 + `poi.interact_effects.func.php` 效果函数
- 新增 `poi.interact` 命令合约 + handler + bootstrap 加载
- 扩展 `obl_state_handle_tile_actions` 投影：POI 返回可用交互列表（前端按道具 × POI 配置渲染按钮）
- 前端 `poi.interact` 命令注册 + `stores/poi.ts` `handleInteract` + `PoiInteraction.vue` 新增"道具交互"区
- 日志模板补 `poi.interact.*` 系列
- Dian.md 新增 F-6 框架章节（POI 道具交互系统），更新 E-7/L-9 关联说明

**不在本案范围内**（归属其他系统）：
- 工作台交互（F-2 合成系统已覆盖，POI 工作台 mechanic=craft_source 不变）
- 已搜索 POI 的二次撬开（locked_door 解锁后变 searchable POI，归 E-10 流程）
- 点火后的火焰增益/伤害机制（ ignite 仅设置 POI 状态 + emit 事件，未来由健康系统/状态系统订阅）
- 元素口袋、绳索等其他场景道具的使用（未来扩展）
- 交互配置的可视化编辑工具（手动维护配置文件即可）
- 数据迁移（Oblivions 模式 DROP IF EXISTS + CREATE，无迁移需求）

---

## 二、核心概念

### 2.1 交互模式选择

**采用方案 A：玩家在 POI 上时，前端检测背包内 tag_poi_interactive 道具，在 L-9 交互态显示可用交互按钮。**

**位置约束**：玩家必须站在 POI 上（pgroup/pls 一致），不支持相邻格交互。
**理由**：与 poi.search 位置约束一致（`obl_lookup_poi_for_search` 校验 pgroup/pls），避免引入额外距离判定；玩家"站到 POI 上"是直观的探索语义。

**触发流程**：
1. 玩家移动到 POI 所在格 → tile_actions scope 返回 POI 列表
2. 玩家点击"检查"进入 L-9 交互态
3. 后端在 tile_actions 投影中返回该 POI 的可用交互列表（基于 POI mechanic × 玩家背包内 tag_poi_interactive 道具匹配）
4. 前端在交互态"道具交互"区渲染可用交互按钮（每个按钮显示：交互名 + 需要的道具名 + 当前是否可用）
5. 玩家点击按钮 → 前端发 `poi.interact` 命令（payload: slot + iaid）
6. 后端校验 + 调用效果函数 + emit 日志
7. 前端刷新 tile_actions / player_inventory / obl_log

**设计理由**：
- 符合"确认函"设计哲学（DESIGN.md §3.4）：玩家无需 memorize 配方，系统主动告知可用交互
- 与 F-3 / F-5 命令模式一致：命令分发层 → 主函数 → 效果分发器
- 不破坏 poi.search 单一职责（搜刮与交互是两条独立路径）

### 2.2 交互配置表（配置驱动）

新建 `oblivions/gamedata/poi_interactions.php`，结构如下：

```php
return [
    'interaction_id' => [
        'name'              => '交互显示名',
        'poi_mechanic'      => 'interact_locked_door',   // 匹配 POI 模板 mechanic 字段
        'required_item'     => 'crowbar',                 // 必需道具 ID（与 required_tag 二选一）
        'required_tag'      => null,                      // 必需 Tag（任一道具带此 Tag 即可触发）
        'effect_type'       => 'unlock_door',             // 分发到 poi_interact_effect_{name}
        'effect_params'     => ['target_state' => 'idle'], // 效果参数
        'consume_item'      => false,                     // 是否消耗道具（itms-1）
        'consume_count'     => 1,                         // 消耗数量
        'advances_tick'     => true,                      // 是否推进 tick（命令层已统一推进，此处仅声明）
        'repeatable'        => false,                     // 同一 POI 是否可重复交互
    ],
    // ...
];
```

**设计理由**：
- POI 模板与交互配置解耦：同一个 mechanic 可对应多条交互配置（如 locked_door 可被 crowbar 撬，也可被 lockpick 开）
- 配置驱动符合 DESIGN.md §2.6：新增交互类型只需加配置 + 注册新 effect 函数
- 字段最小化：只保留必要字段，effect_params 承载效果特定参数（如目标状态、loot_table_id 等）

### 2.3 三种典型交互

| interaction_id | poi_mechanic | 道具 | effect_type | 效果 |
|---|---|---|---|---|
| `crowbar_pry_door` | `interact_locked_door` | crowbar | `unlock_door` | POI state: locked → idle，让 poi.search 可用 |
| `lockpick_open_chest` | `interact_locked_chest` | lockpick 或 lockpick_set | `open_container` | 调用 F-4 loot_table 掷骰物化到 oblmapitem |
| `lighter_ignite_campfire` | `interact_campfire` | lighter | `ignite` | POI state: idle → ignited，emit 事件供未来状态系统订阅 |

**设计理由**：
- 三种效果覆盖三种典型语义：状态切换 / 物品产出 / 状态机推进
- 都不依赖未实现的健康系统/状态系统（ignite 仅 emit 事件，增益由未来系统订阅）
- 复用 F-4 引擎做物品产出（不重新发明掷骰逻辑）

### 2.4 命令设计

新增 `poi.interact` 命令，与 poi.search 并列：

```php
'poi.interact' => array(
    'legacy' => 'obl_poi_interact',
    'ui_mode' => 'explore',
    'allowed_actions' => array('', null),
    'advances_tick' => true,           // 交互消耗时间（与 poi.search 一致）
    'itm0_allowed' => false,           // 交互需先整理 itm0
    'required_capabilities' => array('time_pass'),
    'payload_schema' => array(
        'slot' => array('type' => 'int', 'required' => true, 'min' => 1),
        'iaid' => array('type' => 'int', 'required' => true, 'min' => 1),
    ),
    'refresh' => array('player_info', 'tile_actions', 'player_inventory', 'obl_log'),
),
```

**设计决策**：
- `advances_tick=true`：交互是"对 POI 做一件耗时操作"，与 poi.search 同级
- `itm0_allowed=false`：交互前需先整理 itm0（防御性，避免交互产物与 itm0 暂存冲突）
- `required_capabilities=['time_pass']`：与 poi.search 一致
- payload 用 `slot + iaid`：slot 是道具槽位（1~maxslots），iaid 是目标 POI 实例 ID；不用 item_id 是因为同一道具可能有多份实例
- 不传 interaction_id：后端按 (poi.mechanic × item) 在 poi_interactions.php 中查找匹配项，前端只需传 slot+iaid

### 2.5 效果分发器（复用 F-3 模式）

与 F-3 use_effect 分发器同构：
- `poi_interact($slot, $iaid, &$pdata)` 主入口，负责校验 + 分发 + 消耗
- `poi_interact_effect_{name}($item, $poi, $interaction, &$pdata)` 效果函数，签名约定
- 效果函数内部不应自行扣 itms，由 `poi_interact` 主流程在 effect 之后统一消耗

---

## 三、数据结构变更

### 3.1 `item_table.php` 修改

5 个道具补充 `tag_poi_interactive`：

| item_id | 现有 tags | 变更后 tags |
|---|---|---|
| `crowbar` | `['tag_equippable', 'tag_heavy_weight', 'tag_tool_crowbar']` | 增加 `tag_poi_interactive` |
| `lockpick` | `[]` | 增加 `tag_poi_interactive` |
| `lockpick_set` | `['tag_tool_lockpick', 'tag_tool']` | 增加 `tag_poi_interactive` |
| `lighter` | `['tag_tool_igniter']` | 增加 `tag_poi_interactive` |
| `torch_unlit` | `['tag_tool_light', 'tag_combustible']` | 增加 `tag_poi_interactive` |

其他道具模板**不变更**。

### 3.2 `poi_table.php` 新增 POI 模板

新增 3 个 mechanic POI 模板：

```php
'locked_door' => [
    'name'       => '上锁的门',
    'desc'       => '一扇紧锁的金属门，看起来需要工具才能打开。',
    'searchable' => false,    // 解锁后由 effect 改为 searchable=true（运行时变更实例字段）
    'repeatable' => false,
    'mechanic'   => 'interact_locked_door',
    // 不配置 E-10 概率字段（与 life_totem 同模式：mechanic 型 POI 不走三档判定）
    'base_loot_chance'        => 0.0,
    'base_good_event_chance'  => 0.0,
    'base_bad_event_chance'   => 0.0,
    'loot_table_id'           => 'empty_loot',
    'event_pool'              => [],
    'prob_mods_source'        => [],
    'loot_table_overrides'    => [],
],

'locked_chest' => [
    'name'       => '上锁的宝箱',
    'desc'       => '结实的金属宝箱，锁孔锈迹斑斑，需要合适的工具。',
    'searchable' => false,
    'repeatable' => false,
    'mechanic'   => 'interact_locked_chest',
    'base_loot_chance'        => 0.0,
    'base_good_event_chance'  => 0.0,
    'base_bad_event_chance'   => 0.0,
    'loot_table_id'           => 'locked_chest_loot',  // unlock 后 effect 直接调用 F-4 掷骰
    'event_pool'              => [],
    'prob_mods_source'        => [],
    'loot_table_overrides'    => [],
],

'campfire_unlit' => [
    'name'            => '熄灭的营火',
    'desc'            => '一堆未点燃的柴火，看起来可以生火。',
    'searchable'      => false,
    'repeatable'      => false,
    'mechanic'        => 'interact_campfire',
    'base_loot_chance'        => 0.0,
    'base_good_event_chance'  => 0.0,
    'base_bad_event_chance'   => 0.0,
    'loot_table_id'           => 'empty_loot',
    'event_pool'              => [],
    'prob_mods_source'        => [],
    'loot_table_overrides'    => [],
],
```

### 3.3 新建 `oblivions/gamedata/poi_interactions.php`

```php
return [
    'crowbar_pry_door' => [
        'name'           => '撬开',
        'poi_mechanic'   => 'interact_locked_door',
        'required_item'  => 'crowbar',
        'required_tag'   => null,
        'effect_type'    => 'unlock_door',
        'effect_params'  => ['target_searchable' => true],
        'consume_item'   => false,    // 撬棍不消耗（耐久模型，未来可扣耐久）
        'consume_count'  => 0,
        'repeatable'     => false,
    ],
    'lockpick_open_chest' => [
        'name'           => '开锁',
        'poi_mechanic'   => 'interact_locked_chest',
        'required_item'  => null,
        'required_tag'   => 'tag_tool_lockpick',  // lockpick 或 lockpick_set 均可
        'effect_type'    => 'open_container',
        'effect_params'  => ['loot_table_id' => 'locked_chest_loot'],
        'consume_item'   => true,     // 数量模型扣 1
        'consume_count'  => 1,
        'repeatable'     => false,
    ],
    'lighter_ignite_campfire' => [
        'name'           => '点燃',
        'poi_mechanic'   => 'interact_campfire',
        'required_item'  => 'lighter',
        'required_tag'   => null,
        'effect_type'    => 'ignite',
        'effect_params'  => ['target_state' => 'ignited'],
        'consume_item'   => false,    // 耐久模型，未来可扣耐久
        'consume_count'  => 0,
        'repeatable'     => false,
    ],
];
```

### 3.4 `loot_tables.php` 新增 `locked_chest_loot` 表

```php
'locked_chest_loot' => [
    'name' => '上锁宝箱掉落',
    'durability_decay' => true,
    'groups' => [
        [
            'chance' => 1.0,
            'entries' => [
                ['item_id' => 'scrap_metal',     'weight' => 30, 'count' => [2, 5]],
                ['item_id' => 'supply_pack',     'weight' => 25, 'count' => [1, 3]],
                ['item_id' => 'health_potion',   'weight' => 15, 'count' => 1],
                ['item_id' => 'stamina_potion',  'weight' => 15, 'count' => 1],
                ['item_id' => 'rusty_pipe',      'weight' => 10, 'count' => 1],
                ['item_id' => 'scrap_vest',      'weight' => 5,  'count' => 1],
            ],
        ],
    ],
],
```

### 3.5 数据库结构

**不变更**。复用 `oblmappoi` 表的 `state` 字段存储 POI 状态（idle/searched/cooldown/exhausted/locked/ignited 等），新增状态字符串由 effect 函数直接 UPDATE。

POI 实例的 `searchable` 字段为模板级属性（POI 模板中定义），运行时通过修改实例的 `state` 字段表达"已解锁"语义：
- locked_door 初始 state='locked'，unlock_door effect 将 state 改为 'idle'，同时由 effect_params 标记 target_searchable=true（前端依据 state 判定可搜性）
- campfire_unlit 初始 state='idle'，ignite effect 将 state 改为 'ignited'

**state 字段值约定**（扩展 E-10 状态机）：
- 既有：idle / searched / cooldown / exhausted（E-10 三档判定专用）
- 新增：locked（被锁住，需道具交互解锁）/ ignited（已点燃，未来扩展增益语义）
- 前端 `currentPoiSearchable` computed 扩展：state='locked' 时返回 false，state='ignited' 时按 POI 模板 searchable 判定

---

## 四、命令设计

### 4.1 `poi.interact` 命令合约

见 §2.4。

### 4.2 命令 handler

```php
case 'poi.interact':
    obl_command_handler_poi_interact($payload, $pdata);
    break;
```

```php
function obl_command_handler_poi_interact($payload, &$pdata) {
    $slot = (int)$payload['slot'];
    $iaid = (int)$payload['iaid'];
    // itm0_pending 防御性检查（合约 itm0_allowed=false，bus 已拦截）
    $itm0_pending = obl_command_itm0_pending($pdata);
    if ($itm0_pending) {
        global $obl_log;
        if (isset($obl_log) && $obl_log) $obl_log->emit('system.itm0_pending', 'system');
        return;
    }
    $poi = obl_lookup_poi_for_search($iaid, $pdata);  // 复用 poi.search 的位置校验
    if ($poi === null) return;
    poi_interact($slot, $poi, $pdata);
}
```

### 4.3 主流程 `poi_interact($slot, $poi, &$pdata)`

```
1. 读取背包槽位 $slot 的道具实例（slot >= 1，非 itm0）
   - 空槽位 → emit poi.interact.empty_slot
2. 检查 tag_poi_interactive → 不含 → emit poi.interact.not_interactive
3. 检查耐久 itms='0' → emit poi.interact.broken
4. 加载 poi_interactions.php 配置
5. 按 (poi.mechanic × item) 匹配交互配置：
   - required_item 严格匹配 item_id
   - required_tag 匹配（item 的 tags 包含 required_tag）
   - 无匹配 → emit poi.interact.no_interaction
6. 校验 POI 状态：
   - locked_door: state 必须='locked'，否则 emit poi.interact.already_unlocked
   - locked_chest: state 必须='locked'
   - campfire_unlit: state 必须='idle'（未点燃），state='ignited' 时 emit poi.interact.already_ignited
   - repeatable=false 且已交互过 → emit poi.interact.already_done
7. 调用 poi_interact_effect_{effect_type}($item, $poi, $interaction, $pdata)
8. 消耗道具（如 interaction.consume_item=true）：
   - 调用 item_consume_itms($item, consume_count)
   - 归零 → item_destroy_if_depleted
9. emit poi.interact.success（含 interaction_id、effect_type、item_id、iaid）
```

### 4.4 交互效果函数（3 个）

签名约定：`poi_interact_effect_{name}($item, $poi, $interaction, &$pdata)`

- `$item`：道具实例（itempara 七字段，按值传递）
- `$poi`：POI 实例行（含 iaid/pgroup/pls/poi_id/state 等）
- `$interaction`：交互配置数组
- `&$pdata`：玩家数据引用

**`poi_interact_effect_unlock_door`**：
```
1. 读 effect_params.target_searchable（默认 true）
2. UPDATE oblmappoi SET state='idle' WHERE iaid=X AND state='locked'（乐观锁）
   - affected=0 → emit poi.interact.concurrent_conflict，不消耗道具
3. emit unlock_door.unlocked（iaid, poi_id）
```

**`poi_interact_effect_open_container`**：
```
1. 读 effect_params.loot_table_id
2. 调用 obl_roll_loot_table($loot_table_id) 掷骰
3. UPDATE oblmappoi SET state='exhausted' WHERE iaid=X AND state='locked'（乐观锁，避免并发开箱）
   - affected=0 → emit poi.interact.concurrent_conflict，不物化、不消耗
4. 物化 items 到 oblmapitem（source_iaid=poi.iaid, discovered=1）
   - 复用 obl_materialize_loot($poi, $items)
5. emit open_container.opened（iaid, item_ids）
```

**`poi_interact_effect_ignite`**：
```
1. 读 effect_params.target_state（默认 'ignited'）
2. UPDATE oblmappoi SET state=target_state WHERE iaid=X AND state='idle'（乐观锁）
   - affected=0 → emit poi.interact.concurrent_conflict，不消耗
3. emit ignite.ignited（iaid, poi_id）
   - 未来状态系统/健康系统可订阅此事件触发增益/伤害
```

---

## 五、前端交互

### 5.1 命令门控注册（K-3）

`vex-vue/src/stores/command-registry.ts` 新增：

```typescript
'poi.interact': { mode: 'explore', advancesTick: true, itm0Allowed: false, readOnly: false, requiredCapabilities: ['time_pass'] },
```

### 5.2 types/api.ts 新增类型

```typescript
/** POI 可用交互（tile_actions scope 返回，前端按道具匹配渲染按钮） */
export interface PoiInteraction {
  /** 交互 ID（poi_interactions.php 的 key） */
  interaction_id: string;
  /** 交互显示名（如"撬开"/"开锁"/"点燃"） */
  name: string;
  /** 关联的 POI mechanic（前端调试用） */
  poi_mechanic: string;
  /** 触发所需的道具 ID（与 required_tag 二选一） */
  required_item: string | null;
  /** 触发所需的 Tag（任一道具带此 Tag 即可） */
  required_tag: string | null;
  /** 是否消耗道具 */
  consume_item: boolean;
  /** 玩家当前背包内可触发该交互的道具槽位列表（后端预匹配，前端直接渲染） */
  available_slots: number[];
}

/** poi.interact 命令 payload */
export interface PoiInteractCommandPayload {
  slot: number;
  iaid: string | number;
}
```

`Poi` 接口新增字段：
```typescript
/** 当前 POI 可用的道具交互列表（后端按玩家背包预匹配） */
interactions?: PoiInteraction[];
```

### 5.3 store 扩展（stores/poi.ts）

新增 `handleInteract(slot, iaid)` 方法（与 `doSearch` 同模式）：

```typescript
async function handleInteract(slot: number, iaid: string | number): Promise<void> {
  if (!commandQueue.canExecute('poi.interact')) return;
  debugBus.emit('action', 'poi:interact', { slot, iaid });
  interactLoading.value = true;
  try {
    const result = await commandQueue.execute({
      command: 'poi.interact',
      payload: { slot: Number(slot), iaid: Number(iaid) },
    });
    if (!result.success) {
      dataManager.broadcast('ui:toast', {
        type: 'error',
        msg: result.message || result.error || '交互失败',
        isHtml: !!result.messageIsHtml,
      });
      return;
    }
    dataManager.invalidate('player_inventory');
    dataManager.invalidate('player_info');
    dataManager.invalidate('tile_actions');
    dataManager.broadcast('game:action-completed');
  } catch (e) {
    debugBus.emit('error', 'poi:interactError', {
      error: e instanceof Error ? e.message : String(e),
    });
    dataManager.broadcast('ui:toast', {
      type: 'error',
      msg: '交互失败：' + (e instanceof Error ? e.message : String(e)),
    });
  } finally {
    interactLoading.value = false;
  }
}
```

新增状态：`const interactLoading = ref<boolean>(false);`
新增计算属性：`const canInteract = computed<boolean>(() => commandQueue.canExecute('poi.interact'));`
新增派生：`const currentPoiInteractions = computed<PoiInteraction[]>(() => currentPoi.value?.interactions || []);`

### 5.4 组件扩展（PoiInteraction.vue）

在交互态"中下部反馈区"之前新增"道具交互"区：

```vue
<!-- 道具交互区（currentPoiInteractions 非空时显示） -->
<div v-if="currentPoiInteractions.length > 0" class="poi-interact-zone">
  <div class="ascii-title">
    <span class="ascii-label">道具交互</span>
    <span class="ascii-line" style="flex:1"></span>
  </div>
  <div class="interact-list">
    <div
      v-for="interact in currentPoiInteractions"
      :key="interact.interaction_id"
      class="interact-row"
    >
      <span class="interact-name">{{ interact.name }}</span>
      <span class="dim interact-need">需要：{{ interact.required_item || interact.required_tag }}</span>
      <button
        v-for="slot in interact.available_slots"
        :key="slot"
        class="term-btn interact-btn"
        :disabled="!canInteract || interactLoading || interact.available_slots.length === 0"
        @click="onInteract(slot, currentPoi!.iaid)"
      >[槽位 {{ slot }}]</button>
    </div>
  </div>
</div>
```

### 5.5 状态投影扩展（obl_state_handle_tile_actions）

`obl_state_handle_tile_actions` 在每个 POI 数据中增加 `interactions` 字段：

```php
// 在 $poi_data 数组中追加
$poi_data['interactions'] = obl_get_available_interactions_for_poi($poi, $pdata);
```

新增辅助函数 `obl_get_available_interactions_for_poi($poi, $pdata)`：
1. 加载 poi_interactions.php 配置
2. 加载 POI 模板，取 mechanic
3. 遍历配置，筛选 poi_mechanic === template.mechanic 的项
4. 对每个 interaction：
   - 按 required_item 或 required_tag 在玩家 itempara[1..maxslots] 中查找匹配道具
   - 校验 POI state（locked_door 必须 state='locked' 等）
   - 收集可触发的 slot 列表 → available_slots
5. 返回 interactions 列表（available_slots 为空的交互也返回，前端显示"需要 X 道具"占位）

### 5.6 日志模板（log-templates.ts）

新增以下模板：

| log_id | 文案 |
|---|---|
| `poi.interact.empty_slot` | `该槽位没有道具。` |
| `poi.interact.not_interactive` | `这个道具无法与 POI 交互。`（高亮 item_name） |
| `poi.interact.broken` | `已损坏，无法用于交互。`（高亮 item_name） |
| `poi.interact.no_interaction` | `该道具无法与此 POI 交互。` |
| `poi.interact.already_unlocked` | `此 POI 已被解锁。` |
| `poi.interact.already_ignited` | `此 POI 已被点燃。` |
| `poi.interact.already_done` | `此 POI 已被交互过。` |
| `poi.interact.concurrent_conflict` | `并发冲突，请重试。` |
| `poi.interact.success` | `你使用 {item_name} 与 POI 交互：{interaction_name}。` |
| `unlock_door.unlocked` | `门被撬开了。` |
| `open_container.opened` | `宝箱被打开，获得了 {item_count} 件物品。` |
| `ignite.ignited` | `火堆被点燃了。` |

---

## 六、实施拆分

### 6.1 后端任务

| 任务 | 文件 | 依赖 |
|------|------|------|
| T1: item_table.php 5 个道具补 tag_poi_interactive | `oblivions/gamedata/item_table.php` | 无 |
| T2: poi_table.php 新增 3 个 mechanic POI | `oblivions/gamedata/poi_table.php` | 无 |
| T3: 新建 poi_interactions.php 配置表 | `oblivions/gamedata/poi_interactions.php` | T1, T2 |
| T4: loot_tables.php 新增 locked_chest_loot 表 | `oblivions/gamedata/loot_tables.php` | 无 |
| T5: 新建 poi.interact_effects.func.php（3 个 effect 函数） | `oblivions/include/game/poi/poi.interact_effects.func.php` | T3, T4 |
| T6: 新建 poi.interact.func.php（主流程 + 查询函数） | `oblivions/include/game/poi/poi.interact.func.php` | T5 |
| T7: 新增 poi.interact 命令合约 | `oblivions/include/command/obl_command_contract.php` | T6 |
| T8: 新增 obl_command_handler_poi_interact | `oblivions/include/command/obl_command_handlers.php` | T7 |
| T9: bootstrap 加载新文件 | `oblivions/include/core/obl_bootstrap.php` | T5, T6 |
| T10: tile_actions 投影扩展（返回 interactions） | `oblivions/include/api/obl_state_handlers.php` | T6 |

### 6.2 前端任务

| 任务 | 文件 | 依赖 |
|------|------|------|
| F1: 命令门控注册 | `vex-vue/src/stores/command-registry.ts` | 后端 T7 |
| F2: types/api.ts 新增 PoiInteraction / PoiInteractCommandPayload + Poi.interactions | `vex-vue/src/types/api.ts` | 后端 T10 |
| F3: stores/poi.ts 新增 handleInteract + interactLoading + canInteract + currentPoiInteractions | `vex-vue/src/stores/poi.ts` | F1, F2 |
| F4: PoiInteraction.vue 新增"道具交互"区 | `vex-vue/src/components/poi/PoiInteraction.vue` | F3 |
| F5: 日志模板补充 poi.interact.* / unlock_door.* / open_container.* / ignite.* | `vex-vue/src/data/log-templates.ts` | 后端 T6 |

### 6.3 文档与锚点同步任务

| 任务 | 文件 |
|------|------|
| D1: 新增 F-6 框架章节到 Dian.md | `oblivions/Dian.md` |
| D2: 更新 E-7 章节（说明 poi.interact 与 poi.search 同为命令层并列分支） | `oblivions/Dian.md` |
| D3: 更新 L-9 章节（补充"道具交互区"扩展） | `oblivions/Dian.md` |
| D4: 运行 `php oblivions/tools/validate_design_anchors.php` 严格模式校验 | — |

---

## 七、风险与边界

### 7.1 已知风险

1. **POI state 字段扩展**：E-10 状态机原有 4 个值（idle/searched/cooldown/exhausted），本案新增 2 个值（locked/ignited）。前端 `currentPoiSearchable` computed 需扩展判定。
   - **缓解**：state='locked' 直接返回 false（不可搜）；state='ignited' 按 searchable 字段判定（campfire_unlit 的 searchable=false，ignited 后仍不可搜，纯语义标记）

2. **poi.search 与 poi.interact 状态重叠**：locked_chest 解锁后 state 改为 'exhausted'（已开过），玩家无法再搜刮。这是设计意图——一次性开箱。
   - **缓解**：在 effect 函数中显式 UPDATE state='exhausted'，确保不与 poi.search 的 idle 状态重叠

3. **item 既 tag_equippable 又 tag_poi_interactive**：crowbar 同时可装备可交互。前端 InventoryList 已有"装备"按钮，本案在 POI 模态框新增"交互"按钮，两者位置不同不冲突。
   - **缓解**：UI 上不混用，POI 交互入口仅出现在 L-9 模态框内

4. **并发交互冲突**：两玩家同时对同一 locked_chest 发起 lockpick_open_chest。
   - **缓解**：effect 函数使用 `UPDATE ... WHERE iaid=X AND state='locked'` 乐观锁，affected=0 时不物化、不消耗、emit concurrent_conflict

5. **available_slots 投影过期**：玩家在 POI 模态框外消耗道具后，tile_actions scope 未刷新时 available_slots 仍含已空槽位。
   - **缓解**：poi.interact 命令成功后强制 invalidate tile_actions；前端发起交互前用 inventoryStore.slots 二次校验槽位非空（防御性）

### 7.2 边界案例

| 边界 | 处理方式 |
|------|---------|
| 玩家不在 POI 上发起 poi.interact | `obl_lookup_poi_for_search` 复用位置校验，emit search.not_adjacent |
| 道具 itms='0'（损坏）发起交互 | emit poi.interact.broken 阻止 |
| 道具 itms='∞'（无限耐久）发起交互 | 正常执行；consume_item=true 时由 item_consume_itms 内部跳过扣减 |
| POI state 已变更（如已被其他玩家解锁） | effect 函数乐观锁 affected=0 → emit poi.interact.concurrent_conflict |
| 同一 POI 有多种交互（如 locked_door 既可被 crowbar 撬也可被 lockpick 开） | poi_interactions.php 配置多条；前端按 available_slots 渲染多个按钮 |
| available_slots 为空（玩家没有所需道具） | 前端显示交互名 + "需要 X 道具"占位，按钮禁用 |
| locked_door 解锁后 searchable=true 的语义传递 | effect_params.target_searchable=true 通过事件参数传递，但实际 searchable 字段在 POI 模板层。本案采用 state='idle' 表达"已解锁可搜"，前端 currentPoiSearchable 扩展判定 |
| ignite 后再次 ignite | state='ignited' 已非 'idle'，emit poi.interact.already_ignited 阻止 |
| open_container 产物物化失败（F-4 引擎返回空） | emit open_container.opened + count=0；不消耗道具（防御性） |
| 玩家在 itm0 锁定态发起 poi.interact | 命令层 gate 已拦截（itm0_allowed=false）；handler 内防御性 emit system.itm0_pending |

---

## 八、验收标准

### 8.1 功能验收

1. **道具 Tag 补充**：
   - item_table.php 中 crowbar / lockpick / lockpick_set / lighter / torch_unlit 均含 `tag_poi_interactive`
   - `item_get_items_by_tag('tag_poi_interactive')` 返回这 5 个 item_id

2. **POI 模板新增**：
   - poi_table.php 新增 locked_door / locked_chest / campfire_unlit 三个模板
   - 三者 mechanic 分别为 interact_locked_door / interact_locked_chest / interact_campfire
   - 三者 searchable=false，不参与 E-10 三档判定

3. **交互配置**：
   - poi_interactions.php 含 3 条交互配置
   - crowbar_pry_door / lockpick_open_chest / lighter_ignite_campfire

4. **poi.interact 命令**：
   - 玩家在 locked_door POI 上 + 背包有 crowbar → 点击交互按钮 → POI state='idle'（解锁）
   - 玩家在 locked_chest POI 上 + 背包有 lockpick → 点击交互按钮 → POI state='exhausted'，掉落物化到 oblmapitem，lockpick itms-1
   - 玩家在 campfire_unlit POI 上 + 背包有 lighter → 点击交互按钮 → POI state='ignited'
   - 玩家背包无所需道具 → 前端按钮显示但禁用
   - 玩家不在 POI 上 → 命令失败，emit search.not_adjacent

5. **前端闭环**：
   - L-9 交互态显示"道具交互"区（仅当 currentPoi.interactions 非空）
   - 点击交互按钮 → 发 poi.interact 命令 → 成功后刷新 tile_actions/player_inventory/obl_log
   - 槽位已空时按钮自动禁用（available_slots 响应式更新）

6. **日志渲染**：
   - poi.interact.* / unlock_door.* / open_container.* / ignite.* 日志 ID 在前端有对应模板
   - 不出现 `[未知日志: ...]`

### 8.2 锚点校验

- `php oblivions/tools/validate_design_anchors.php` 严格模式通过
- Dian.md F-6 章节新增：POI 道具交互系统框架
- Dian.md E-7 章节更新：poi.interact 与 poi.search 同为命令层并列分支
- Dian.md L-9 章节更新：交互态新增"道具交互"区
