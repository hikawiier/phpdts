# 玩家放置 POI 与耐久系统 - 设计案

> 范围：基于任务1已落地的 E-11 天与昼夜相位派生层，实现"玩家放置 POI"（任务2）与"POI 破坏/清理/耐久"（任务3）。两项任务共享 POI 实例层扩展与新的通用耐久框架，因此合并为一份设计案。

---

## 一、设计目标与边界

### 1.1 设计目标

- **任务2（POI 放置）**：玩家使用特定道具（firewood）→ 在当前图格生成未点燃火堆 POI 实例，复用现有 `campfire_unlit` POI 模板，接入 F-6 道具交互框架的 `ignite` 交互。
- **任务3（POI 破坏/清理）**：
  - 主动拆除入口（poi.dismantle 命令），可返还部分材料
  - 通用 POI 耐久系统：基于 E-11 day_changed 事件钩子，到期自动清理
  - 耐久作为 POI 通用属性（框架级设计，非火堆特例）

### 1.2 强制约束

- 必须复用任务1的 day_changed 事件钩子（不重新发明时间事件机制）
- 不考虑旧系统兼容性、数据迁移、最小实现
- 可自由重构、自由创建文件
- 框架级设计优先：耐久系统不绑定火堆特例

### 1.3 框架归属

| 新框架 | 模块 | 范围 |
|--------|------|------|
| **E-12 POI 耐久系统** | E 游戏逻辑 | day_changed 监听器，按 ttl_days 清理过期 POI |
| **F-7 玩家放置 POI 框架** | F 物品系统 | item.use + 新 use_effect `place_poi`，配置驱动的"道具→POI 模板"映射 |

---

## 二、数据模型扩展

### 2.1 `bra_oblmappoi` 表扩展（任务2+3 共用）

当前表无放置者/耐久字段，世界生成 POI 与玩家放置 POI 无法区分。新增 3 个通用字段：

```sql
ALTER TABLE bra_oblmappoi
  ADD COLUMN placed_by_pid mediumint unsigned NOT NULL default 0
    COMMENT '放置者玩家 PID；0=世界生成（无耐久）',
  ADD COLUMN placed_at_day int unsigned NOT NULL default 0
    COMMENT '放置时的游戏天数（E-11 obl_day_get()）；0=无耐久跟踪',
  ADD COLUMN ttl_days smallint unsigned NOT NULL default 0
    COMMENT '存活天数；0=永久（不过期）；>0 时 placed_at_day + ttl_days <= 当前天即过期',
  ADD INDEX idx_ttl_expiry (ttl_days, placed_at_day);
    -- 支撑 day_changed 监听器的批量过期扫描
```

**字段语义**：
- 三字段同时为 0 → 世界生成 POI（无耐久、无放置者）
- 三字段非 0 → 玩家放置 POI（有耐久、可拆除、到期清理）
- `placed_by_pid`：用于 dismantle 命令校验"放置者本人才能拆"
- `placed_at_day` + `ttl_days`：到期判定 `placed_at_day + ttl_days <= current_day`

### 2.2 POI 模板字段扩展（poi_table.php）

新增两个可选字段（默认不写表示无耐久 / 无拆除返还）：

```php
'campfire_unlit' => [
    // ... 现有字段不变 ...
    'ttl_days'         => 1,   // 玩家放置时存活 1 天（任务3）
    'dismantle_returns' => [   // 拆除返还（任务3）
        ['item_id' => 'firewood', 'count' => 1, 'require_state' => 'idle'],
    ],
],
```

- `ttl_days`：缺失或 0 表示永久（不影响世界生成的同模板 POI）
- `dismantle_returns`：缺失表示无返还；`require_state` 可选，约束仅在特定 state 下才返还

### 2.3 道具模板扩展（item_table.php）

新增 `firewood` 道具（任务2）：

```php
'firewood' => [
    'itm'      => '木柴',
    'itmk'     => 'MT',
    'itme'     => 1,
    'itms'     => 5,
    'itmsk'    => '',
    'itmpara'  => 'poi_id:campfire_unlit',  // F-7 place_poi effect 读取此参数
    'desc'     => '一捆干燥的木柴，可以在当前图格生起营火。',
    'tier'     => 'common',
    'stack'    => true,
    'stack_limit' => 10,
    'tags'     => ['tag_combustible', 'tag_usable', 'tag_poi_placeable'],
    'use_effect' => 'place_poi',
    'tool_level' => 0,
],
```

**关键设计**：
- `tag_combustible`：与 tree_branch 同类，可作合成素材
- `tag_usable` + `use_effect=place_poi`：接入 F-3 use_effect 分发器
- `tag_poi_placeable`：新系统钩子 Tag，标记"此道具可放置为 POI"（参考 `tag_poi_interactive` 的 Tag 设计哲学）
- `itmpara='poi_id:campfire_unlit'`：编码目标 POI 模板 ID（字符串协议 `poi_id:{template_id}`）

### 2.4 合成配方（recipe_table.php）

新增 firewood 合成配方（任务2）：

```php
'craft_firewood' => [
    'category'  => 'tool',
    'materials' => [
        ['item_id' => 'tree_branch', 'count' => 2, 'consume' => 'all'],
    ],
    'results'   => [
        ['item_id' => 'firewood', 'count' => 1],
    ],
],
```

设计理由：tree_branch 是已存在的 combustible 素材（MT, stack=true, tag_combustible），2 个 tree_branch 合成 1 firewood 体现"木柴需要捆扎"的语义。

---

## 三、任务2：POI 放置流程（F-7 框架）

### 3.1 F-7 框架概述

**F-7 玩家放置 POI 框架**：复用 F-3 use_effect 分发器，新增 `place_poi` 效果函数。配置驱动：道具模板的 `itmpara` 字段编码目标 POI 模板 ID（`poi_id:{template_id}` 协议）。当玩家使用带 `tag_poi_placeable` + `use_effect=place_poi` 的道具时，F-3 分发到 `item_use_effect_place_poi()`，由该函数在玩家当前图格 INSERT 一条 `bra_oblmappoi` 记录，写入 placed_by_pid / placed_at_day / ttl_days。

### 3.2 use_effect 函数：`item_use_effect_place_poi`

**文件位置**：`oblivions/include/game/item/item.use_effects.func.php`（追加，保持 F-3 已注册函数集合同文件）

**签名**：`function item_use_effect_place_poi($item, &$pdata)`

**流程**：
1. 解析 `$item['itmpara']` 提取 POI 模板 ID（`poi_id:campfire_unlit` → `campfire_unlit`）
2. 加载 `poi_table.php`，校验模板存在
3. 校验玩家位置：`$pdata['pgroup']` / `$pdata['pls']` 必须有效（非战斗中、非过渡态）
4. 校验同格同模板 POI 数量上限（避免一格堆叠 100 个火堆）：默认上限 1 个/模板/图格（可配置）
5. INSERT INTO bra_oblmappoi：
   ```sql
   INSERT INTO bra_oblmappoi
     (pgroup, pls, poi_id, state, placed_by_pid, placed_at_day, ttl_days)
   VALUES ($pgroup, $pls, '$poi_id', 'idle', $pid, $current_day, $ttl_days)
   ```
   - `state='idle'`：复用 campfire_unlit 模板的设计（ignite effect 推进 idle→ignited）
   - `$current_day = obl_day_get()`（E-11 提供的读取接口）
   - `$ttl_days` 来自 POI 模板的 `ttl_days` 字段（缺失则 0）
6. emit `place_poi.success` 事件（含 iaid / poi_id / pgroup / pls）
7. 返回（itms 扣减由 F-3 框架在 effect 之后统一处理）

**失败路径**：
- itmpara 格式错误 → emit `place_poi.invalid_itmpara`，不抛异常（F-3 框架仍会扣 itms，相当于"使用失败但消耗"——为避免此问题，需在 effect 内 return 前让 F-3 框架感知失败）

**F-3 框架的语义补丁**：当前 F-3 框架的 `item_use()` 在 effect 之后无条件扣 itms，未提供"effect 失败回滚"机制。为最小改动，`place_poi` effect 在校验失败时仍返回 void，由 emit 日志记录失败原因，itms 仍被扣减。这与现有 `open_gift_box` 在背包满时仍扣 itms 的语义一致（"赌博语义"）。设计案接受此行为。

### 3.3 状态投影扩展

`obl_state_handle_tile_actions`（A-4 投影函数）已读取 `bra_oblmappoi` 全字段，玩家放置的 POI 会自动出现在 `pois[]` 列表中。前端无需修改即可看到新放置的火堆。

**新增投影字段**（可选，便于前端区分世界生成 vs 玩家放置）：
- `placed_by_pid`：在 poi_data 中返回（前端可显示"由 X 放置"）
- `ttl_remaining_days`：派生字段，`max(0, placed_at_day + ttl_days - current_day)`

### 3.4 前端动作入口

玩家在背包点击 firewood → 触发 `item.use` 命令（已有按钮入口，无需新增 UI）。命令完成后：
- `tile_actions` scope invalidate → POI 列表刷新 → 新放置的火堆出现在 TileActionBar.vue 的"当前格 POI"区
- 玩家点击该火堆 → 打开 PoiInteraction.vue → 显示 `ignite` 交互按钮（F-6 已有功能）

**无需新增前端组件**，复用 F-6 的 PoiInteraction.vue 三列四区布局。

---

## 四、任务3：POI 破坏与耐久系统

### 4.1 主动拆除：`poi.dismantle` 命令（B-1/B-2/B-3 合约）

**为什么不复用 poi.interact**：F-6 的 `poi.interact` payload 强制要求 `{slot, iaid}`，slot 用于查道具触发效果。拆除是直接对 POI 的操作（无需道具），强行塞入 F-6 会破坏 slot 语义并污染 `available_slots` 投影。新命令 `poi.dismantle` 更清晰。

**合约定义**（obl_command_contract.php 追加）：

```php
'poi.dismantle' => array(
    'legacy' => 'obl_poi_dismantle',
    'ui_mode' => 'explore',
    'allowed_actions' => array('', null),
    'advances_tick' => true,        // 拆除是显著动作，推进 tick
    'itm0_allowed' => false,
    'required_capabilities' => array('time_pass'),
    'payload_schema' => array(
        'iaid' => array('type' => 'int', 'required' => true, 'min' => 1),
    ),
    'refresh' => array('player_info', 'tile_actions', 'player_inventory', 'obl_log'),
),
```

设计决策：
- `advances_tick=true`：与 `poi.search` / `poi.interact` 一致（显著动作）
- `itm0_allowed=false`：避免 itm0 暂存中的物品被拆除返还物覆盖
- `required_capabilities=['time_pass']`：拆除需要时间，与 search/interact 同档

### 4.2 拆除 handler 与主流程

**handler 文件**：`oblivions/include/command/obl_command_handlers.php` 追加 `obl_command_handler_poi_dismantle`

**主流程函数文件**：`oblivions/include/game/poi/poi.dismantle.func.php`（新建，参考 poi.interact.func.php 结构）

**主流程**：`function poi_dismantle($iaid, &$pdata)`

1. 位置校验：复用 `obl_lookup_poi_for_search($iaid, $pdata)` 确保 POI 在玩家当前图格
2. 校验 `placed_by_pid > 0`：仅玩家放置的 POI 可拆除（世界生成 POI 拒绝，emit `poi.dismantle.not_player_placed`）
3. 加载 POI 模板，读取 `dismantle_returns` 配置
4. 校验 `require_state`（若配置）：state 不匹配 → emit `poi.dismantle.wrong_state`，不返还但仍删除？或拒绝拆除？
   - 决策：**拒绝拆除**。理由：玩家可能误操作（如想拆未点燃的火堆却点到已点燃的），state 校验避免误拆。玩家需先等火堆燃尽 / 自然过期。
   - 但若玩家执意拆除已点燃的火堆（无返还），应允许：**两阶段校验**——若 `require_state` 不匹配，仍可拆除但不返还材料（emit `poi.dismantle.no_return`）。这样玩家有选择权。
5. 乐观锁 DELETE：`DELETE FROM bra_oblmappoi WHERE iaid=X AND placed_by_pid=$pid`（确保不被他人拆除）
   - affected=0 → emit `poi.dismantle.concurrent_conflict`，返回
6. 关联清理：`DELETE FROM bra_oblmapitem WHERE source_iaid=X`（删除 POI 产出的未拾取道具）
7. 物化返还物：若 `dismantle_returns` 匹配当前 state，调用 `obl_put_item_to_itm0` + `obl_organize_inventory` 放入背包
8. emit `poi.dismantle.success`（含 iaid / returned_items 列表）

### 4.3 耐久系统：E-12 框架

**E-12 POI 耐久系统**：通用框架级耐久系统。任何 POI 模板声明 `ttl_days > 0` 即纳入耐久管理。day_changed 事件触发时，监听器扫描所有到期 POI（`ttl_days > 0 AND placed_at_day + ttl_days <= current_day`），批量 DELETE + 关联清理 oblmapitem。

**文件位置**：`oblivions/include/game/poi/poi.durability.func.php`（新建）

**核心函数**：`function obl_poi_durability_cleanup(array $transition)`

**监听器签名**：与 E-11 约定一致（`function(array $transition): void`），复用任务1事件钩子。

**流程**：
1. 解析 `$transition['to']['day']` 为当前天数
2. 批量 SELECT 到期 POI：
   ```sql
   SELECT iaid, pgroup, pls, poi_id FROM bra_oblmappoi
   WHERE ttl_days > 0 AND placed_at_day + ttl_days <= $current_day
   ```
3. 收集 iaid 列表，分批 DELETE（每批 500 条）：
   - `DELETE FROM bra_oblmappoi WHERE iaid IN (...)`
   - `DELETE FROM bra_oblmapitem WHERE source_iaid IN (...)`
4. emit `poi.durability.expired`（含 iaid 列表 / count）

**注册位置**（参考 wild_refresh 模式）：
- `obl_bootstrap.php` 第 5.78 层（在 5.75 day_cycle 之后、第 6 层 tick 之前）：
  ```php
  require_once GAME_ROOT . './oblivions/include/game/poi/poi.durability.func.php';
  ```
- `tick.func.php` 末尾追加：
  ```php
  if (function_exists('obl_poi_durability_cleanup') && function_exists('obl_day_register_listener')) {
      obl_day_register_listener('day_changed', 'obl_poi_durability_cleanup');
  }
  ```

### 4.4 耐久数据存储设计研判

**选择 `placed_at_day + ttl_days` 而非 `expires_at_day`**：
- 优势 1：可追溯放置时刻（placed_at_day 单独可读），便于调试与前端展示"已放置 X 天"
- 优势 2：与 wild_refresh 的 `last_refresh_day` 字段同模式（都是绝对天数比较），保持框架一致性
- 优势 3：若未来 ttl_days 被动态修改（如延长/缩短），无需重算 expires_at_day，只需改 ttl_days

**不引入 `remaining_days` 字段**：
- 派生字段 `remaining = placed_at_day + ttl_days - current_day` 是纯函数，无需持久化
- 前端投影时实时计算（参考 PoiInteraction.vue 中 cooldown_remaining_turn 的派生模式）

### 4.5 通用性研判：耐久作为 POI 通用属性

**结论：耐久是 POI 实例层通用属性，不是火堆特例**。

**论证**：
1. **数据模型层面**：`placed_by_pid` / `placed_at_day` / `ttl_days` 三字段是 POI 实例属性，不绑定特定 POI 模板
2. **模板配置层面**：任何 POI 模板可声明 `ttl_days > 0`（如未来 `trap` 模板 ttl_days=3、`temporary_shelter` ttl_days=5）
3. **清理机制层面**：E-12 监听器是通用扫描器，不区分 POI 类型
4. **与世界生成 POI 的关系**：世界生成 POI 三字段为 0（默认值），天然不被 E-12 触及
5. **与 F-7 放置框架的关系**：F-7 在 INSERT 时**写入**这三字段，但 E-12 的清理逻辑**不依赖**于 F-7（任何来源的 ttl_days>0 都会被清理）

**未来扩展场景**：
- 玩家建造的陷阱（ttl_days=3，到期失效）
- 玩家标记的临时路标（ttl_days=1，避免地图污染）
- 玩家搭建的临时庇护所（ttl_days=5，提供短暂休息 buff）
- 任务系统触发的临时传送门（ttl_days=2）

这些场景均无需修改 E-12 / F-7 框架代码，仅需新增 POI 模板 + 对应 placeable 道具。

---

## 五、Dian.md 收录规划

### 5.1 框架分级

| 框架 | 分级 | 依据 |
|------|------|------|
| E-12 POI 耐久系统 | 基准框架 | tick 驱动的通用清理机制，非业务特例 |
| F-7 玩家放置 POI 框架 | 基准框架 | 复用 F-3 分发器的配置驱动框架，与 F-6 同级 |

两者都属于"基准框架"级别（与 E-9/E-10/E-11/F-6 同档），不属于"模块"（业务实体）或"设计意图"（抽象原则）。

### 5.2 收录草案

#### E-12 POI 耐久系统

**设计意图**：POI 实例层通用耐久管理框架。`bra_oblmappoi` 表新增三个通用字段（`placed_by_pid` / `placed_at_day` / `ttl_days`）支撑耐久语义——世界生成 POI 三字段为 0（永久存在，不参与耐久管理）；玩家放置 POI 写入放置者 PID、放置天、存活天数。day_changed 事件触发时，监听器 `obl_poi_durability_cleanup` 批量扫描所有到期 POI（`ttl_days > 0 AND placed_at_day + ttl_days <= current_day`），DELETE POI 实例 + 关联清理 `bra_oblmapitem` 中 source_iaid 指向该 POI 的未拾取道具。任何 POI 模板声明 `ttl_days > 0` 即纳入耐久管理，框架不区分 POI 类型。耐久是 POI 实例层属性而非模板层属性——同模板的不同实例可有不同 ttl_days（如世界生成的 campfire_unlit 永久存在，玩家放置的 campfire_unlit 仅存 1 天）。E-12 监听器复用 E-11 day_changed 事件钩子，与 E-9 野生道具刷新并列存在。

**代码锚点**：`oblivions/include/game/poi/poi.durability.func.php`（day_changed 监听器 + 批量过期扫描）；事件钩子注册位于 `oblivions/include/game/tick.func.php` 末尾（与 E-9 wild_refresh 监听器同模式）；表结构扩展位于 `oblivions/sql/oblmappoi.sql`

**边界案例**：

- 世界生成 POI 三字段为 0 不被扫描——`WHERE ttl_days > 0` 过滤条件天然排除，无需额外标记字段
- 多 tick 批量推进时由每次 obl_tick_advance() 内的 obl_day_advance_hook() 自然触发多次 day_changed 事件，E-12 监听器每次调用都扫描全表，多次调用幂等（已删除的 POI 不会重复匹配）
- DELETE 关联 oblmapitem 的 source_iaid 引用——批量 DELETE 时按 iaid IN (...) 一次清理，避免遗留孤儿道具记录
- 玩家放置 POI 的 `placed_by_pid` 字段同时用于 dismantle 命令的权限校验（仅放置者本人可拆），与 E-12 的清理逻辑解耦
- POI 实例同时被 dismantle 和到期清理时——两者都用 `WHERE iaid=X` 删除，删除一方后另一方 affected=0，无并发风险
- ttl_days 动态修改场景——若未来引入"延长耐久"道具（如修补火堆），只需 UPDATE ttl_days 字段，next day_changed 监听器自动按新值判定，无需重算 expires_at_day
- 监听器异常被 E-11 框架捕获防扩散——day_changed 监听器抛异常时记录 `day_cycle.listener.error` 日志，不阻塞其他监听器

#### F-7 玩家放置 POI 框架

**设计意图**：复用 F-3 use_effect 分发器的配置驱动"道具→POI 实例"映射框架。道具模板通过 `tag_poi_placeable` + `use_effect=place_poi` + `itmpara='poi_id:{template_id}'` 三字段声明可放置性，F-3 分发器调用命名约定的 `item_use_effect_place_poi()` 函数，由该函数在玩家当前图格 INSERT 一条 bra_oblmappoi 记录，写入 placed_by_pid / placed_at_day / ttl_days 三字段（F-7 写入，E-12 读取清理）。itms 扣减由 F-3 框架在 effect 之后统一处理（与 F-6 同模式），effect 函数内部不扣 itms。POI 模板的 `ttl_days` 字段决定放置后是否进入 E-12 耐久管理——缺失或 0 表示永久（与野生 POI 同行为）。同格同模板 POI 数量上限默认 1（避免堆叠），可在 POI 模板的 `place_limit_per_tile` 字段配置。INSERT 时 state 取 POI 模板的 `initial_state`（默认 'idle'）。F-7 与 F-6 是并列的"POI 交互层"——F-6 处理"道具 × 已存在 POI"的交互（ignite/unlock/open），F-7 处理"道具 → 新建 POI"的放置。

**代码锚点**：`oblivions/include/game/item/item.use_effects.func.php`（place_poi effect 函数）；itmpara 协议解析位于同一文件；POI 模板配置位于 `oblivions/gamedata/poi_table.php`（ttl_days / dismantle_returns / place_limit_per_tile 字段）；放置道具配置位于 `oblivions/gamedata/item_table.php`（firewood 条目）

**边界案例**：

- itmpara 协议 `poi_id:{template_id}`——解析失败时 emit `place_poi.invalid_itmpara` 日志，F-3 框架仍扣 itms（"赌博语义"，与 open_gift_box 一致）；为避免误用，建议在数据校验阶段验证 itmpara 格式
- 玩家位置校验——战斗中（action='battle'）禁止放置 POI，需校验 $pdata['action'] 非 battle
- 同格同模板上限——默认 1，超限时 emit `place_poi.tile_limit_reached`，不放置但仍扣 itms（或拒绝放置并返还 itms？决策：拒绝放置 + emit 错误 + F-3 框架扣 itms，与失败语义一致）
- 世界生成 vs 玩家放置同模板——campfire_unlit 既有世界生成实例（ttl_days=0）也有玩家放置实例（ttl_days=1），两者共享模板配置但实例层 placed_by_pid / ttl_days 不同
- placed_by_pid 用于 dismantle 权限校验——其他玩家不能拆除他人放置的 POI（即使站在同格），需用 `WHERE iaid=X AND placed_by_pid=$pid` 乐观锁
- INSERT 与 ablmapstates.fog 的关系——放置 POI 不修改图格的 fog 状态（玩家所在图格必然 fog=1，POI 自动可见）
- 命令 advances_tick=false——item.use 合约 advances_tick=false（与 item.pickup / item.equip 一致），放置 POI 是"自由变更"语义不推进 tick

---

## 六、实施清单

### 6.1 后端文件修改

| 文件 | 操作 | 内容 |
|------|------|------|
| `oblivions/sql/oblmappoi.sql` | 修改 | 新增 placed_by_pid / placed_at_day / ttl_days 字段 + idx_ttl_expiry 索引 |
| `oblivions/gamedata/item_table.php` | 修改 | 新增 firewood 道具条目 |
| `oblivions/gamedata/recipe_table.php` | 修改 | 新增 craft_firewood 配方 |
| `oblivions/gamedata/poi_table.php` | 修改 | campfire_unlit 追加 ttl_days / dismantle_returns / place_limit_per_tile 字段 |
| `oblivions/include/game/item/item.use_effects.func.php` | 修改 | 新增 `item_use_effect_place_poi()` 函数 |
| `oblivions/include/game/poi/poi.dismantle.func.php` | 新建 | dismantle 主流程函数 |
| `oblivions/include/game/poi/poi.durability.func.php` | 新建 | E-12 day_changed 监听器 |
| `oblivions/include/command/obl_command_contract.php` | 修改 | 新增 poi.dismantle 合约 |
| `oblivions/include/command/obl_command_handlers.php` | 修改 | 新增 obl_command_handler_poi_dismantle |
| `oblivions/include/core/obl_bootstrap.php` | 修改 | 第 5.78 层加载 poi.durability.func.php；第 5.79 层加载 poi.dismantle.func.php |
| `oblivions/include/game/tick.func.php` | 修改 | 末尾注册 obl_poi_durability_cleanup 为 day_changed 监听器 |
| `oblivions/include/api/obl_state_handlers.php` | 修改 | tile_actions 投影追加 placed_by_pid / ttl_remaining_days 字段 |

### 6.2 前端文件修改

| 文件 | 操作 | 内容 |
|------|------|------|
| `vex-vue/src/types/api.ts` | 修改 | Poi 类型追加 placed_by_pid / ttl_remaining_days 字段 |
| `vex-vue/src/data/poi-locale.ts` | 修改 | 新增 campfire_unlit 名称/描述本地化（如已存在则跳过） |
| `vex-vue/src/data/item-locale.ts` | 修改 | 新增 firewood 道具本地化文案 |
| `vex-vue/src/stores/poi.ts` | 修改 | 新增 handleDismantle(iaid) action（调用 poi.dismantle 命令） |
| `vex-vue/src/components/poi/PoiInteraction.vue` | 修改 | F-6 交互区下方追加"拆除"按钮（仅当 placed_by_pid > 0 时显示）；POI 信息区追加"剩余耐久 X 天"显示 |

### 6.3 文档文件修改

| 文件 | 操作 | 内容 |
|------|------|------|
| `oblivions/Dian.md` | 修改 | 模块 E 新增 E-12 框架条目；模块 F 新增 F-7 框架条目 |
| `oblivions/DESIGN.md` | 评估 | 若引入 `tag_poi_placeable` 新 Tag，需在 §1.8 系统钩子 Tag 章节登记 |

---

## 七、验证策略

### 7.1 锚点校验

```bash
php oblivions/tools/validate_design_anchors.php --module=E
php oblivions/tools/validate_design_anchors.php --module=F
# 完成后运行严格模式
php oblivions/tools/validate_design_anchors.php
```

### 7.2 PHP 语法校验

```bash
php -l oblivions/include/game/item/item.use_effects.func.php
php -l oblivions/include/game/poi/poi.dismantle.func.php
php -l oblivions/include/game/poi/poi.durability.func.php
php -l oblivions/include/command/obl_command_handlers.php
php -l oblivions/include/command/obl_command_contract.php
php -l oblivions/include/core/obl_bootstrap.php
php -l oblivions/include/game/tick.func.php
php -l oblivions/include/api/obl_state_handlers.php
php -l oblivions/gamedata/item_table.php
php -l oblivions/gamedata/recipe_table.php
php -l oblivions/gamedata/poi_table.php
```

### 7.3 前端类型校验

```bash
cd vex-vue && npx vue-tsc --noEmit
```

---

## 八、自校准结果

### 8.1 错误（Errors）

| 项 | 发现 | 处理 |
|----|------|------|
| itmpara 解析 | 简单 `explode` 无法校验格式错误 | 使用正则 `/^poi_id:([a-z0-9_]+)$/` 严格校验 |
| SQL 注入 | $poi_id 来自 itmpara，需转义 | 在 effect 函数中显式 `$db->escape_string($poi_id)` |
| 并发乐观锁 | place_poi INSERT 本身原子；但同格上限检查存在 TOCTOU 竞态 | 决策：**接受软约束**，不引入 UNIQUE INDEX（避免限制世界生成 + 玩家放置共存），偶发突破上限不影响游戏性 |
| dismantle 乐观锁 | `DELETE WHERE iaid=X AND placed_by_pid=$pid` 防他人误拆 | ✓ 正确 |
| E-12 批量 DELETE | `DELETE FROM oblmapitem WHERE source_iaid IN(...)` 需 source_iaid 字段有索引 | 实施时检查 bra_oblmapitem 表结构，若无索引则补 `INDEX idx_source_iaid (source_iaid)` |

### 8.2 遗漏（Omissions）

| 项 | 发现 | 处理 |
|----|------|------|
| 战斗中放置 POI | item.use 合约 `allowed_actions=['', null]` 已排除 battle 状态 | ✓ 现有合约已拦截，无需新增校验 |
| 同格上限竞态 | 见 8.1 错误表 | 接受软约束 |
| 玩家未发现自己当前格（fog=0）放置 POI | 玩家在自己所在格必然 fog=1（视野系统保证） | ✓ 无需校验 |
| firewood 作合成素材 vs 使用的语义冲突 | 同时是 combustible 素材 + 可使用道具，UI 已通过按钮区分（"使用" vs "放入合成槽"） | ✓ 不冲突 |
| dismantle advances_tick=true 与战斗封锁 | required_capabilities=['time_pass']，战斗中 time_pass 被封锁 | ✓ 与 poi.search/poi.interact 同档处理 |
| 玩家放置 POI 被他人拆除 | placed_by_pid 乐观锁校验 | ✓ 已防住 |
| firewood 被堆叠时使用单个 | F-1 �叠堆物品展开为虚拟占位，使用时扣 1，符合堆叠语义 | ✓ 与 bread/health_potion 同模式 |

### 8.3 冲突（Conflicts）

| 项 | 发现 | 处理 |
|----|------|------|
| **campfire_unlit 模板 ttl_days=1 与世界生成器的冲突** | E-9 世界生成器若读模板 ttl_days 字段并写入实例，会把世界生成的火堆也设为 1 天过期，违反"世界生成 POI 永久"的设计意图 | **解决方案**：实施时检查 `generate.func.php` 的 INSERT 路径，确保世界生成器 INSERT 时不写 ttl_days（默认 0）或显式覆盖为 0。F-7 放置时从模板读 ttl_days，世界生成时不读。这样同模板不同实例可有不同 ttl_days |
| F-7 itmpara 字段冲突 | 检查 item_table.php 中 itmpara 字段当前未被任何道具使用（mystery_box/ancient_core 等均为空） | ✓ 引入 `poi_id:` 协议安全 |
| poi.dismantle 与 poi.interact 命令混淆 | payload schema 不同（前者 {iaid}，后者 {slot, iaid}），命令分发不会混淆 | ✓ 不冲突 |
| tag_poi_placeable 与 use_effect=place_poi 冗余 | use_effect 已能识别可放置性，tag 是否冗余？ | 见 8.4 冗余分析，决策保留作可读性标记 |

### 8.4 冗余（Redundancy）

| 项 | 论证 | 结论 |
|----|------|------|
| placed_by_pid vs ttl_days | placed_by_pid 用于 dismantle 权限校验，ttl_days 用于耐久管理。一个 POI 可 placed_by_pid>0 但 ttl_days=0（玩家放置永久 POI），或反之 | ✓ 字段正交，不冗余 |
| placed_at_day vs ttl_days | placed_at_day 是绝对时间戳，ttl_days 是相对时长。两者组合才能算过期 | ✓ 字段正交，不冗余 |
| tag_poi_placeable vs use_effect=place_poi | use_effect 已能识别可放置性。**但**与 tag_usable + use_effect 模式一致（tag_usable 标记"可使用"，use_effect 指定具体效果），tag_poi_placeable 是数据校验约束 + UI 可读性标记 | ✓ 保留，符合 DESIGN.md §1.8 "性质 Tag + 钩子 Tag 共存"哲学 |
| place_limit_per_tile | 可硬编码为 1，但配置化更通用（未来某些 POI 可能允许多个共存） | ✓ 保留为可选字段，默认 1 |

### 8.5 全面性（Comprehensiveness）

| 项 | 覆盖情况 |
|----|----------|
| F-7 是否覆盖所有"道具→POI"场景 | ✓ 当前仅 firewood → campfire_unlit 一对映射；未来扩展（placeable_trap → trap_poi）仅需新增道具 + itmpara 协议，无需改框架代码 |
| E-12 是否覆盖所有"POI 过期"场景 | ✓ 当前仅 ttl_days 过期；未来若需基于 tick 的过期、基于使用次数的过期，可新增字段，不影响现有逻辑 |
| dismantle 是否覆盖所有"POI 主动移除"场景 | ✓ 仅玩家放置的 POI 可拆（placed_by_pid>0）；世界生成 POI 由 E-12 自动清理 |
| 监听器注册时机 | ✓ 与 wild_refresh 同模式（tick.func.php 末尾注册），保持框架一致性 |
| campfire_unlit 的完整生命周期 | idle（放置）→ ignited（F-6 ignite）→ [无后续状态] / 过期清理（E-12） / 主动拆除（poi.dismantle）。已点燃的火堆仍可被 E-12 清理 / 主动拆除（无返还） |

### 8.6 DESIGN.md 第三节校准

| 原则 | 符合性 |
|------|--------|
| 3.1 降低理解成本 + 快速索引 | ✓ E-12/F-7 命名清晰，代码锚点完整，索引字段 idx_ttl_expiry 支撑批量扫描 |
| 3.2 概念引入成本-收益 | ✓ tag_poi_placeable（与 tag_poi_interactive 对称，UI 直接查询收益高）；itmpara 协议（避免新增配置表，收益高于解释成本）；三字段（支撑 dismantle + 耐久双语义，收益高） |
| 3.3 约束是意图的近似 | ✓ 同格上限 1 是软约束（接受偶发突破），不引入 UNIQUE INDEX 强约束——因 UNIQUE INDEX 会限制世界生成 + 玩家放置共存，违反"世界生成 POI 永久 + 玩家放置 POI 临时"的意图 |
| 3.4 少即是多 | ✓ 未引入 expires_at_day 派生字段（用 placed_at_day + ttl_days 组合计算）；未引入 remaining_days 持久化字段（前端派生）；未引入新配置表（itmpara 编码协议） |

### 8.7 2.12 锚点契约校准

| 文件 | @module | @framework | Dian.md 锚点 |
|------|---------|------------|--------------|
| oblivions/include/game/poi/poi.durability.func.php | E | E-12 | E-12 代码锚点 |
| oblivions/include/game/poi/poi.dismantle.func.php | F | F-7（dismantle 是 F-7 框架的主动移除路径） | F-7 代码锚点 |
| oblivions/include/game/item/item.use_effects.func.php | F | F-3（文件级，已有） | F-3 代码锚点（保持）；F-7 在 place_poi 函数级 PHPDoc 标注 |
| oblivions/sql/oblmappoi.sql | - | - | E-12 表结构锚点（非 @framework 标注对象，仅在 Dian.md 引用） |
| oblivions/gamedata/poi_table.php | E | - | F-7 引用（campfire_unlit 字段扩展） |
| oblivions/gamedata/item_table.php | F | - | F-7 引用（firewood 条目） |
| oblivions/include/command/obl_command_contract.php | B | B-1（已有） | B-1 锚点（保持）；poi.dismantle 合约条目本身不单独标 @framework |
| oblivions/include/command/obl_command_handlers.php | B | B-3（已有） | B-3 锚点（保持） |
| oblivions/include/core/obl_bootstrap.php | C | C-1（已有） | C-1 锚点（保持）；新增 5.78/5.79 层 |
| oblivions/include/game/tick.func.php | E | E-1（已有） | E-1 锚点（保持）；末尾追加 E-12 监听器注册 |

**关键决策**：
- E-12 监听器注册位置在 tick.func.php 末尾（与 E-9 wild_refresh 同模式），不单独标 @framework——这是 E-1 框架的扩展点，Dian.md E-12 条目引用 tick.func.php 作为代码锚点即可
- F-7 与 F-3 共享 item.use_effects.func.php 文件——文件级 @framework 保持 F-3，函数级 PHPDoc 标注 @framework F-7（place_poi 函数注释）

### 8.8 通用性（Universality）校准

| 框架 | 通用性论证 |
|------|-----------|
| E-12 | ✓ 任何 POI 模板声明 `ttl_days > 0` 即纳入耐久管理，不绑定火堆。未来扩展：陷阱（ttl_days=3）、临时路标（ttl_days=1）、临时庇护所（ttl_days=5）、临时传送门（ttl_days=2）均无需改 E-12 代码 |
| F-7 | ✓ 任何道具声明 `tag_poi_placeable` + `use_effect=place_poi` + `itmpara='poi_id:X'` 即可放置为 X POI。未来扩展：placeable_trap → trap_poi、placeable_shelter → shelter_poi 均无需改 F-7 代码 |
| dismantle | ✓ dismantle_returns 配置在 POI 模板，任何玩家放置的 POI 都可拆。dismantle 命令的 placed_by_pid 校验是通用的（不绑定火堆） |
| 数据模型 | ✓ 三字段是 POI 实例层属性，不绑定特定 POI 模板。同模板不同实例可有不同 placed_by_pid / ttl_days |

### 8.9 自校准发现需在实施时确认的问题

1. **`generate.func.php` 的世界生成路径**：检查 INSERT bra_oblmappoi 时是否写 ttl_days 字段。如果写，需显式覆盖为 0；如果不写（用默认值 0），则无需修改。这是 E-9 框架的潜在调整点。
2. **`bra_oblmapitem` 表的 source_iaid 索引**：检查 sql 文件，若无索引则补 `INDEX idx_source_iaid (source_iaid)` 支撑 E-12 批量 DELETE。
3. **`obl_lookup_poi_for_search` 是否返回 placed_by_pid 字段**：检查该函数 SELECT 的字段列表，若未包含 placed_by_pid 需补充（dismantle 主流程依赖此字段校验）。
