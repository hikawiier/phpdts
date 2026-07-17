# 搜索建筑物与掉落机制重构 — 模块 E：探索与搜刮

> 本设计案基于 [搜索建筑物与掉落机制设计案.md](file:///d:/wamp64/www/phpdts/oblivions/docs/原始方案/搜索建筑物与掉落机制设计案.md) 对当前 obl 模式的地图探索、野生道具、POI 探索机制进行完整重构。
> 覆盖 E 模块组三个框架：E-7 探索与交互管道（扩展）、E-9 静态世界生成系统（扩展）、E-10 POI 搜刮三档判定系统（新增）。
> 关键重构取向：去除容器、容器嵌套、递归展开概念；战利品表扁平化为"物品组 + 互斥选项（按 weight）+ count + durability_decay"；POI 状态机化；搜刮结果暂存机制；三档判定算法；事件池分发框架；保底 pity_timer。

---

## 一、模块概览

### 1.1 三个框架的职责边界

| 框架 | 职责 | 核心问题 |
|------|------|---------|
| **E-7 探索与交互管道（扩展）** | 玩家与世界交互的入口编排 | "玩家点了探索/搜刮按钮后系统做什么" |
| **E-9 静态世界生成系统（扩展）** | 世界的初始填充与时间流逝刷新 | "地图上凭空长出什么东西" |
| **E-10 POI 搜刮三档判定系统（新增）** | POI 搜刮的掷骰与结果生成 | "搜刮一次 POI 该出什么、发生什么" |

### 1.2 框架协作关系

```
[E-9 世界生成]                           [E-9 时间流逝刷新]
   ↓ 初始填充                                ↑ tick 钩子触发
   ↓ 野生道具 → oblmapitem (source_iaid=0)   ↑ obl_refresh_wild_items (批量 COUNT)
   ↓ POI 实例 → oblmappoi
                       ↓
                       ↓ 玩家踩点
                       ↓
[E-7 探索管道] ──> 视野/迷雾/发现 ──> 探索后钩子（事件点、地板效果占位）
                       ↓
                       ↓ 玩家点击 POI 搜刮
                       ↓
[E-10 三档判定] ──> 状态机校验 → 概率计算 → 保底/事件/普通/空
                       ↓                  ↑ 工具/技能路由
                       ↓ 直接物化         ↓ prob_mods + loot_table_override
                       ↓ 写入 oblmapitem (source_iaid=POI.iaid, discovered=1)
                       ↓
                  玩家通过 item.pickup 取走 → 进入 F-1 拾取流程（与野生道具一致）
```

### 1.3 关键重构决策

1. **去除容器与嵌套**：旧 [poi_loot.php](file:///d:/wamp64/www/phpdts/oblivions/gamedata/poi_loot.php) 的扁平 rate 列表与 [loot_tables.json](file:///d:/wamp64/www/phpdts/oblivions/docs/原始方案/loot_tables.json) 的嵌套递归展开都被新战利品表结构取代——物品组 + 互斥选项（按 weight）+ count + durability_decay，无嵌套表引用、无容器装填。原型阶段任何"多件物品需求"通过扩 count 或拆组实现。
2. **POI 状态机化**：旧 [oblmappoi](file:///d:/wamp64/www/phpdts/oblivions/sql/oblmappoi.sql) 的 `searched` 布尔位升级为四态状态机（idle/searched/cooldown/exhausted），新增 `cooldown_until_turn`（冷却到期 tick）；**不暂存 `pending_loot`**，搜刮结果直接物化到 oblmapitem。
3. **搜刮结果直接物化到 oblmapitem**：POI 搜刮产出的道具**直接 INSERT 进 oblmapitem**（带 `source_iaid=POI.iaid, discovered=1`），玩家通过现有 `item.pickup` 命令拾取——与野生道具拾取流程完全一致，无需 `pending_loot` 暂存或 `poi.fetch_loot` 命令。前端"首次弹出"通过 `poi.search` 响应附带的 `loot_dropped: [item_id列表]` 字段实现。
4. **图格刷新状态独立**：野生道具刷新状态记录在 [oblmapstates](file:///d:/wamp64/www/phpdts/oblivions/sql/oblmapstates.sql)（与迷雾同表，仅 `last_refresh_turn` 与 `refresh_count`），不在 oblmapitem 上加 `last_refresh_turn`——图格属性而非道具属性。**容量计数采用批量 COUNT 方案**：刷新函数执行时一次 SQL 查询所有图格当前野生道具数（`WHERE iaid=0 AND source_iaid=0`），不在 oblmapstates 上维护 `wild_item_count` 冗余字段。
5. **三档判定算法**：保底（pity_timer 存 `oblpara.pity_timer`，跨 POI 共享）→ 事件池分发 → 普通掉落（调用 F-4 引擎）→ 空，按优先级依次判定，前三档任一命中即停止。
6. **事件池分发框架**：命名约定 `obl_event_{event_id}()`，与现有 [obl_mechanic_{name}()](file:///d:/wamp64/www/phpdts/oblivions/include/game/explore.func.php#L357-L371) 分发框架同构。
7. **prob_mods 超界保护**：在 `obl_calc_poi_probabilities()` 末尾统一 clamp 到 [0,1]，不阻塞搜索流程，玩家无感知。

### 1.4 与其他模块的契约

- **F-1（槽位背包与 itm0 暂存槽协议）**：POI 产出道具通过现有 `item.pickup` 命令拾取，与野生道具流程完全一致——`obl_pickup_item` 的 itm0 写入与 `obl_organize_inventory` 整理流程被两端复用；**不引入 `poi.fetch_loot` 命令**。
- **F-4（战利品表引擎，新增占位）**：E-10 的"普通掉落"档与"保底"档调用 F-4 引擎执行新战利品表结构（物品组 + 互斥选项 + count + durability_decay）。**F-4 引擎返回物品实例数组，由 E-10 负责逐件物化进 oblmapitem**（`source_iaid=POI.iaid, discovered=1`）。F-4 是本案派生的新框架锚点，未来由独立设计案落地。
- **E-1（Tick 驱动事件调度）**：野生道具刷新通过注册 `post` phase 监听器接入 tick 调度，每 N tick 触发一次刷新判定（采用批量 COUNT 方案，详见 E-9）。
- **G-1（技能系统）**：搜刮技能等级从 `skillpara` 读取，决定野生道具发现数量与 POI 搜刮的概率修正。

---

## 二、框架 E-7：探索与交互管道（扩展）

### 2.1 设计意图

E-7 的本职是"玩家与世界交互的入口编排"——视野更新 → 迷雾清除 → 道具发现 → 敌人发现 → 钩子。本次扩展保留这条主链不变，把三个原本被简化或预留的点补全：

1. **道具发现数量从固定值改为技能驱动**：旧 [obl_discover_items()](file:///d:/wamp64/www/phpdts/oblivions/include/game/explore.func.php#L64-L121) 用 `memory_range`（固定 3）作为每次探索发现数量上限，与"搜刮技能等级"完全脱钩。扩展后改为 `discover_base + discover_per_level * scavenge_skill_level`，让"搜刮技能"在地图探索阶段（而非仅 POI 搜刮阶段）就有可感知的收益。**默认值与 memory_range 对齐**：`discover_base=3`、`discover_per_level=1`，确保 G-1 技能系统未加载时 Lv0 玩家与旧版行为一致（3 件），技能系统加载后 Lv0 仍为 3 件、Lv3 达到 6 件。
2. **野生道具刷新接入 tick**：旧实现只在 [E-9 静态世界生成](file:///d:/wamp64/www/phpdts/oblivions/include/game/generate.func.php#L135-L203) 的 `obl_generate_wild_items()` 中做"首次进入"刷新，时间流逝刷新机制完全缺失。扩展后由 tick 调度的 `post` phase 监听器 `obl_tick_phase_refresh_wild_items` 调用 E-9 的 `obl_refresh_wild_items($current_turn)`（**P3 已落地**：wild_refresh.func.php 已实现 + tick.func.php 末尾已注册监听器；本任务 P4 仅核查无重复注册，不重新实现）。
3. **探索后钩子扩展**：旧 [obl_post_explore_hook()](file:///d:/wamp64/www/phpdts/oblivions/include/game/explore.func.php#L198-L200) 是空函数。扩展后接入三段式占位骨架：事件点触发（占位，待事件系统落地）、地板属性效果（占位，待地板属性系统落地）、任务进度通知（占位，待任务系统落地）。每段为独立函数，原型阶段为空实现 + 一条 `explore.hook_completed` 调试日志。

E-7 不直接负责"野生道具如何刷新"（那是 E-9 的职责）或"POI 搜刮如何掷骰"（那是 E-10 的职责），它只负责"何时调用这些子系统"。POI 搜索命令 (`poi.search`) 由命令层 [obl_command_handlers.php](file:///d:/wamp64/www/phpdts/oblivions/include/command/obl_command_handlers.php) 直接路由到 E-10 的 `obl_search_poi($pdata, $poi, $tool_id, $skill_id)`，不经过 E-7 探索管道。

### 2.2 代码锚点

- 主文件：[oblivions/include/game/explore.func.php](file:///d:/wamp64/www/phpdts/oblivions/include/game/explore.func.php)
  - `obl_explore(&$pdata, $skip_sp_check = false)` — 探索命令入口（体力检查 → 视野更新 → 敌人发现 → 探索日志 → 探索后钩子）
  - `obl_update_vision($pgroup, $pls, &$pdata)` — 视野更新编排者（已扩展转发 $pdata 给 obl_discover_items）
  - `obl_discover_items($pgroup, $visible_tiles, &$pdata)` — **签名扩展**：新增 `&$pdata` 参数以读取技能等级；发现数量从 `memory_range` 改为调用 `obl_get_discovery_limit($pdata)` 计算
  - `obl_get_discovery_limit(&$pdata)` — **新增辅助函数**：返回 `discover_base + discover_per_level * scavenge_skill_level`；技能系统未加载或 scavenge 未注册时回退 `memory_range` 兜底值
  - `obl_post_explore_hook(&$pdata)` — 钩子扩展点（三段式占位骨架：事件点/地板属性/任务进度，各段调用占位函数或直接 emit 调试日志）
  - `obl_execute_mechanic($template, &$pdata)` — **保留**：机制型 POI（life_totem/skill_totem 等）的分发框架，与 E-10 三档判定并列存在（mechanic 型 POI 的 E-10 概率配置留空，三档判定天然跳过）
  - `obl_search_poi()`（旧实现位于 L212-L344，已删除）— 整体迁移到 E-10（新文件 `oblivions/include/game/poi/poi.search.func.php`），新签名 `obl_search_poi($pdata, $poi, $tool_id = null, $skill_id = null)`
- 配置文件：[oblivions/gamedata/obl_config.php](file:///d:/wamp64/www/phpdts/oblivions/gamedata/obl_config.php) 新增配置项：
  - `discover_base`（基础发现数量，默认 3，与 memory_range 对齐避免 Lv0 倒退）
  - `discover_per_level`（每级搜刮技能增加的发现数量，默认 1）
  - `memory_range`（保留作为兜底，技能系统未加载时使用，默认 3）
  - `wild_item_refresh_interval_ticks` / `wild_item_capacity_per_tile` / `wild_item_refresh_rate_by_tide`（**P3 已落地**，本任务不修改）
- tick 接入：[oblivions/include/game/tick.func.php](file:///d:/wamp64/www/phpdts/oblivions/include/game/tick.func.php) 末尾已注册 `obl_tick_phase_refresh_wild_items` 为 `post` phase 监听器（与现有 `skill_effect_register_tick_listener` 同模式：`if (function_exists('obl_tick_phase_refresh_wild_items')) { obl_tick_register_listener('post', 'obl_tick_phase_refresh_wild_items'); }`）—— **P3 已落地**，本任务 P4 仅核查无重复注册
- 技能等级读取：通过 G-1 技能系统提供的查询接口从 `$pdata['skillpara']` 读取 `scavenge` 技能等级

### 2.3 具体案例

#### 案例 2.3.1：搜刮技能驱动的发现数量

玩家 Lv0 搜刮技能，每次探索发现数量 = `discover_base(3) + discover_per_level(1) * 0 = 3`（与旧版 memory_range=3 一致）；
玩家 Lv3 搜刮技能，每次探索发现数量 = `3 + 1 * 3 = 6`。

实现要点：`obl_discover_items($pgroup, $visible_tiles, &$pdata)` 内部不再直接读 `memory_range`，改为调用辅助函数 `obl_get_discovery_limit($pdata)` 计算最终值；`memory_range` 配置项保留作为兜底（技能系统未加载或 scavenge 未注册时使用）。`obl_update_vision($pgroup, $pls, &$pdata)` 将 `&$pdata` 透传给 `obl_discover_items`，形成完整的玩家数据链路。

#### 案例 2.3.2：tick 触发的野生道具刷新（P3 已落地）

每 N tick（默认 100）触发一次刷新判定：
1. tick 调度的 `post` phase 监听器 `obl_tick_phase_refresh_wild_items($delta, &$ctx)` 被调用
2. 按 `delta` 循环遍历历史 tick，对每个满足 `t % wild_refresh_interval_ticks == 0` 的 tick 调用 E-9 的 `obl_refresh_wild_items($t)`（**全局批量执行**，扫描所有"已发现过"的图格，不限当前玩家区域）
3. E-9 的 `obl_refresh_wild_items($current_turn)` 内部采用**批量 COUNT 方案**：一次 SQL 查询所有图格当前野生道具数（`WHERE iaid=0 AND source_iaid=0 GROUP BY pgroup, pls`），内存中过滤 `cnt < wild_item_capacity_per_tile(5)` 的图格，结合刷新潮汐倍率，决定哪些图格需要生成新道具（详见 E-9 §3.3 案例 3.3.2）

P4 本任务对这条链路仅核查 tick.func.php 末尾无重复注册 `obl_tick_phase_refresh_wild_items`，不重新实现 wild_refresh.func.php。

#### 案例 2.3.3：探索后钩子三段式占位

`obl_post_explore_hook(&$pdata)` 扩展为三段式占位骨架：
```php
function obl_post_explore_hook(&$pdata) {
    // 1. 事件点触发（占位，待事件系统落地）
    obl_trigger_tile_event_points($pdata);

    // 2. 地板属性效果（占位，待地板属性系统落地）
    obl_apply_tile_floor_effects($pdata);

    // 3. 任务进度通知（占位，待任务系统落地）
    obl_notify_explore_completes_quests($pdata);

    // 调试日志：钩子完成
    global $obl_log;
    if (isset($obl_log) && $obl_log) {
        $obl_log->emit('explore.hook_completed', 'explore');
    }
}
```

三个占位函数（`obl_trigger_tile_event_points` / `obl_apply_tile_floor_effects` / `obl_notify_explore_completes_quests`）原型阶段为空实现，待各子系统落地后填充。函数未定义时通过 `function_exists` 守卫避免崩溃。

### 2.4 边界案例

- **技能系统未加载时**：`obl_get_discovery_limit($pdata)` 在 `skillpara` 缺失或 `scavenge` 技能未注册时回退到 `memory_range` 兜底值（3），不抛异常；与旧版行为完全一致。
- **tick 推进多 tick 时**：`obl_tick_phase_refresh_wild_items` 监听器接收 `$delta` 参数，按 `for (t = current-delta+1; t <= current; t++)` 循环，对每个满足 `t % interval == 0` 的 tick 调用一次 `obl_refresh_wild_items($t)`。delta=1 退化为单次检查；delta=250、interval=100 时触发 2 次（tick=100/200）。
- **玩家所在区域未加载 tiles 时**：刷新函数 `obl_refresh_wild_items` 内部对 `obl_get_map_data($pgroup)` 返回空 tiles 的情况直接 `continue` 跳过该区域所有格，不报错（**P3 已实现**）。
- **同一 tick 内多次探索**：探索命令本身推进 tick，所以同一 tick 内不会出现两次 `obl_explore` 调用；但 `obl_post_move_hook` 触发的自动探索若与玩家主动探索命令在同一 tick 内，会触发两次道具发现——这是设计意图（移动+探索双收益），不算 bug。
- **obl_refresh_wild_items 与玩家拾取并发**：刷新写入 oblmapitem 的 INSERT 与拾取的 DELETE 之间无显式锁，依赖 InnoDB 行锁与拾取的 `discovered>0` 条件判定；新刷新出的道具 `discovered=0`，不会被并发拾取。
- **map.explore 命令路由**：`map.explore` 命令（命令合约 `legacy=obl_explore`、`advances_tick=true`）由命令层 [obl_command_handlers.php](file:///d:/wamp64/www/phpdts/oblivions/include/command/obl_command_handlers.php) 直接调用 `obl_explore($pdata)`，经 B-1/B-2/B-3 命令总线校验后进入 E-7 探索管道。
- **POI 搜索命令边界**：`poi.search` 命令**不经过 E-7 探索管道**，由命令层 [obl_command_handlers.php](file:///d:/wamp64/www/phpdts/oblivions/include/command/obl_command_handlers.php#L18-L29) 先按 `iaid` 查 POI 实例 + 位置校验（`obl_lookup_poi_for_search`），再调用 E-10 的 `obl_search_poi($pdata, $poi, $tool_id, $skill_id)`。E-7 与 E-10 是命令层之下的并列分支。
- **机制型 POI 与 E-10 三档判定并列**：`obl_execute_mechanic` 分发框架（life_totem/skill_totem 等）保留在 E-7 主文件 explore.func.php 中，与 E-10 三档判定是两类不同的 POI 处理路径——mechanic 型 POI 不走三档判定（其 E-10 概率配置字段留空），由 `obl_execute_mechanic` 直接执行机制效果。

---

## 三、框架 E-9：静态世界生成系统（扩展）

### 3.1 设计意图

E-9 的本职是"世界的初始填充"——按潮汐区分桶、按池配置生成 POI 实例与野生散落道具。本次扩展把"时间流逝刷新"这条原本缺失的链路补全，并引入三个核心概念：

1. **scatter_pool 双相位（initial / refresh）**：旧 [scatter_pool.php](file:///d:/wamp64/www/phpdts/oblivions/gamedata/scatter_pool.php) 只有一个道具列表，既用于首次生成也用于未来刷新。扩展后每个潮汐区的配置显式区分 `initial`（首次进入时使用，概率较高、池较丰富）与 `refresh`（时间流逝刷新时使用，概率较低、池较稀疏），模拟"被丢弃过的好东西在第一次进入时还有，被搜刮干净后只能等环境慢慢补给的"生态感。
2. **图格容量上限（批量 COUNT 方案）**：每格最多 5 件野生道具，达上限后跳过刷新。容量计数**不维护冗余字段**，刷新函数执行时一次 SQL 查询所有图格当前野生道具数（`WHERE iaid=0 AND source_iaid=0 GROUP BY pgroup, pls`），内存中过滤 `cnt < 5` 的图格再刷新。这是图格的属性，不是道具的属性——`wild_item_count` 字段被废弃，**拾取/丢弃/生成道具的代码无需任何同步逻辑**。
3. **潮汐倍率作用于刷新概率**：浅水/深水/深渊区的刷新概率按 `tide_refresh_multiplier` 缩放，越危险的区域物资越丰沛（与设计目标 §7.5 "生态感"对齐）。
4. **图格刷新状态字段化**：新增 `oblmapstates.last_refresh_turn`（上次刷新的 tick），用于"每 N tick 刷新一次"的判定——避免每 tick 都遍历所有格子。
5. **POI 产出道具不计入容量**：批量 COUNT 时 `WHERE iaid=0 AND source_iaid=0` 过滤掉 POI 产出（`source_iaid>0`）的待拾取道具——野生道具容量与 POI 搜刮产出完全解耦。

E-9 不负责"何时触发刷新"（那是 E-7 的职责），它只负责"刷新时该做什么"。

### 3.2 代码锚点

- 主文件（新增）：`oblivions/include/game/wild_refresh.func.php` — E-9 时间流逝刷新全部实现集中于此，由 `obl_bootstrap.php` 在 tick.func.php 之前加载（与 `skill_effect.lifecycle.php` 同模式）
  - `obl_refresh_wild_items($current_turn)` — **全局批量执行**（扫描所有"已发现过"的图格），读取 `refresh` 相位，采用批量 COUNT 方案与潮汐倍率；参数为本次刷新所对应的 tick（用于 per-tile 间隔检查与 `last_refresh_turn` 更新，多 tick 推进时由监听器循环传入历史 tick）
  - `obl_tick_phase_refresh_wild_items($delta, &$ctx)` — post phase 监听器包装：按 delta 循环遍历历史 tick，对每个满足 `t % interval == 0` 的 tick 调用 `obl_refresh_wild_items($t)`
  - **不引入** `obl_get_wild_item_count()` / `obl_decrement_wild_item_count()` — 容量计数走批量 COUNT，无需冗余字段或同步函数
- 主文件（保留）：[oblivions/include/game/generate.func.php](file:///d:/wamp64/www/phpdts/oblivions/include/game/generate.func.php)
  - `obl_generate_wild_items()`（[L135-L203](file:///d:/wamp64/www/phpdts/oblivions/include/game/generate.func.php#L135-L203)）— 由 P0 改为读取 `initial` 相位（本案不修改）
- 配置文件：[oblivions/gamedata/scatter_pool.php](file:///d:/wamp64/www/phpdts/oblivions/gamedata/scatter_pool.php) 改为双相位结构（`[tide => ['initial' => [...], 'refresh' => [...]]]`）
- 配置项：[oblivions/gamedata/obl_config.php](file:///d:/wamp64/www/phpdts/oblivions/gamedata/obl_config.php) 新增：
  - `wild_item_refresh_interval_ticks`（野生道具刷新间隔 tick 数，默认 100；0=不刷新）
  - `wild_item_capacity_per_tile`（每格容量上限，默认 5；应用层校验，不在 DB 硬约束）
  - `wild_item_refresh_rate_by_tide`（潮汐倍率表，`['shallow' => 0.5, 'deep' => 1.0, 'abyss' => 1.5]`，越危险越丰沛）
- tick 接入：[oblivions/include/game/tick.func.php](file:///d:/wamp64/www/phpdts/oblivions/include/game/tick.func.php) 末尾注册 `obl_tick_phase_refresh_wild_items` 为 post phase 监听器（与现有 `skill_effect_register_tick_listener` 同模式：`if (function_exists('obl_tick_phase_refresh_wild_items')) { obl_tick_register_listener('post', 'obl_tick_phase_refresh_wild_items'); }`）
- 数据库：[oblivions/sql/oblmapstates.sql](file:///d:/wamp64/www/phpdts/oblivions/sql/oblmapstates.sql) 新增字段：
  - `last_refresh_turn int unsigned NOT NULL default '0'` — 上次刷新 tick
  - `refresh_count int unsigned NOT NULL default '0'` — 累计刷新次数（统计/调试用）
  - **不引入** `wild_item_count` 字段（容量计数走批量 COUNT 方案）
- 数据库：[oblivions/sql/oblmapitem.sql](file:///d:/wamp64/www/phpdts/oblivions/sql/oblmapitem.sql) 新增字段：
  - `source_iaid mediumint unsigned NOT NULL default '0'` — 区分野生道具（0）与 POI 产出（>0）
  - 新增组合索引 `idx_pgroup_pls_iaid_source (pgroup, pls, iaid, source_iaid)` — 支撑批量 COUNT 与按 POI 查询
- **拾取/丢弃流程零侵入**：[oblivions/include/game/item/item.basic.func.php](file:///d:/wamp64/www/phpdts/oblivions/include/game/item/item.basic.func.php) 的 `obl_pickup_item()` / `obl_discard_item()` **无需任何同步逻辑**——野生道具容量计数由下次刷新时的批量 COUNT 自动反映

### 3.3 具体案例

#### 案例 3.3.1：scatter_pool 双相位结构

```php
// scatter_pool.php 新结构
return [
    'shallow' => [
        'initial' => [
            ['item_id' => 'scrap_metal',   'count' => [1,3], 'rate' => 0.6],
            ['item_id' => 'rusty_gear',    'count' => 1,     'rate' => 0.3],
            ['item_id' => 'rope_coil',     'count' => 1,     'rate' => 0.1],
            ['item_id' => 'supply_pack',   'count' => 1,     'rate' => 0.15],
        ],
        'refresh' => [
            ['item_id' => 'scrap_metal',   'count' => 1,     'rate' => 0.25],
            ['item_id' => 'rusty_gear',    'count' => 1,     'rate' => 0.10],
        ],
    ],
    // ...
];
```

`initial` 相位概率较高、池丰富（首次进入时还有"被丢弃过的好东西"）；`refresh` 相位概率较低、池稀疏（环境慢慢补给）。

#### 案例 3.3.2：刷新流程（批量 COUNT 方案）

`obl_refresh_wild_items($current_turn)` 流程（**全局批量执行**，扫描所有已发现图格）：

1. **读配置**：`wild_item_refresh_interval_ticks`（间隔，0=直接返回）、`wild_item_capacity_per_tile`（容量上限）、`wild_item_refresh_rate_by_tide`（潮汐倍率表）。

2. **批量 COUNT 查询所有图格当前野生道具数**：
   ```sql
   SELECT pgroup, pls, COUNT(*) AS cnt
   FROM bra_oblmapitem
   WHERE iaid=0 AND source_iaid=0
   GROUP BY pgroup, pls
   ```
   - 一次 SQL 拿到所有图格的当前野生道具数（不含 POI 产出道具，被 `source_iaid=0` 过滤）
   - 内存中构建 `[(pgroup, pls, cnt), ...]` 映射

3. **查询所有"已发现过"的图格**（`fog=1` 或 `last_refresh_turn>0`）：
   ```sql
   SELECT pgroup, pls, last_refresh_turn FROM bra_oblmapstates
   WHERE fog=1 OR last_refresh_turn>0
   ```
   - `fog=1`：玩家已踏足并点亮过迷雾的格
   - `last_refresh_turn>0`：曾经刷新过的格（即使玩家后续未再踏足也继续刷新，符合"野生道具刷新是世界行为"语义）

4. **按 pgroup 分组加载 tiles 数据**：对每个出现的 pgroup 调用 `obl_get_map_data($pgroup)`（懒加载缓存，同区域多次调用零开销），从 `$map['tiles'][$pgroup][$pls]` 读取该格的 `tide`（缺失时回退 `'shallow'`）。tile 文件不存在的区域直接跳过该区域所有格。

5. **遍历每个图格**，对每个图格判定是否需要刷新：
   - 容量检查：`cnt >= wild_item_capacity_per_tile(5)` → 跳过该格
   - 刷新间隔检查（per-tile 双重保险）：`$current_turn - last_refresh_turn < wild_item_refresh_interval_ticks(100)` → 跳过该格（与监听器的全局 `t % interval == 0` 检查双保险，避免多 tick delta 循环内同一格被重复刷新）
   - 读取 tile 的 `tide`（步骤 4 已加载）
   - 加载 `scatter_pool[$tide]['refresh']`，逐条按 `rate * wild_item_refresh_rate_by_tide[$tide]` 概率判定
   - 生成道具 INSERT oblmapitem（`iaid=0, source_iaid=0` 默认值, `discovered=0`），与 `obl_generate_wild_items()` 的 INSERT 字段列表完全一致

6. **更新 oblmapstates**：`last_refresh_turn = $current_turn`、`refresh_count = refresh_count + 1`（**不更新 wild_item_count**——本字段已删除）

**多 tick 推进时 delta 循环**（监听器 `obl_tick_phase_refresh_wild_items($delta, &$ctx)` 内）：
```php
$current = obl_tick_get();
$start = $current - $delta + 1;
for ($t = $start; $t <= $current; $t++) {
    if ($t % $interval === 0) {
        obl_refresh_wild_items($t);
    }
}
```
- delta=1 时退化为单次 `current % interval == 0` 检查
- delta=250、interval=100、current=250 时循环触发 tick=100/200 两次（250%100≠0 不触发），匹配"delta=250 触发 2 次"约束
- per-tile 的 `last_refresh_turn` 检查确保同一格在一次 delta 批处理内最多被刷新一次（第一次刷新后 `last_refresh_turn` 被更新到 `$t`，后续 `t' - t < interval` 跳过）

**性能**：1000 格 × 5 件 ≈ 5000 行级，有 `idx_pgroup_pls_iaid_source` 覆盖索引时 GROUP BY 查询耗时 < 10ms。

#### 案例 3.3.3：拾取零侵入（无同步逻辑）

玩家拾取野生道具时，`obl_pickup_item()` 删除 oblmapitem 行——**无需任何同步 UPDATE**。下次刷新时的批量 COUNT 会自动反映道具已被拾取（COUNT 自然 -1）。

POI 搜刮产出的道具（`source_iaid>0`）在批量 COUNT 时被 `WHERE source_iaid=0` 过滤掉，**天然不计入野生道具容量**——拾取 POI 产出道具同样无需任何同步逻辑。

#### 案例 3.3.4：潮汐倍率

深水区刷新倍率 1.0，意味着 `rate=0.25` 的 scrap_metal 在深水区实际刷新概率为 `0.25 * 1.0 = 0.25`；深渊区倍率 1.5，实际刷新概率为 `0.25 * 1.5 = 0.375`；浅水区倍率 0.5，实际刷新概率为 `0.25 * 0.5 = 0.125`。这模拟"越危险的区域物资越丰沛"的生态——玩家被鼓励向外探索而非固守浅水区。

### 3.4 边界案例

- **首次进入即触发刷新**：旧设计案说"玩家第一次踏上一格地格时生成初始物品"，但当前实现是 `rs_init_oblivions()` 在区域初始化时一次性生成所有可通行格的野生道具。本案保留区域初始化批量生成的做法（`initial` 相位），玩家首次踏入时不需要触发生成——道具已经在那里，只是被迷雾遮挡。
- **玩家从未踏入的格子也会刷新吗？**：会。野生道具刷新是世界行为，不依赖玩家视野。但 `last_refresh_turn` 在初始化时设为 `obl_tick_get()`，所以新初始化的区域要等 N tick 后才开始第一次刷新——避免初始化即触发刷新。
- **玩家丢弃道具是否占用容量？**：是。玩家通过 `obl_discard_item` 丢弃的道具写入 oblmapitem（`iaid=0, source_iaid=0`），同样被批量 COUNT 计入——丢弃到满容量（5 件）的格子上时，discard 操作的 INSERT 仍然成功，但下次刷新会跳过该格。这是设计意图（避免玩家利用丢弃刷出道具）。**无需同步 wild_item_count**——批量 COUNT 自动反映。
- **野生道具被陷阱揭示后**：近视陷阱道具（is_trap=1）被揭示后会被原子删除（见 [obl_pickup_item](file:///d:/wamp64/www/phpdts/oblivions/include/game/item/item.basic.func.php#L519-L529)）——**无需任何同步逻辑**，下次批量 COUNT 自动反映道具已被删除。
- **区域切换后旧区域的刷新**：刷新监听器**全局扫描所有"已发现过"的图格**（`fog=1 OR last_refresh_turn>0`），不限于当前玩家所在区域——旧区域的道具继续按间隔刷新，符合"野生道具刷新是世界行为，不依赖玩家视野"的设计意图。性能上由批量 COUNT + 主键扫描覆盖，1000 格规模下 GROUP BY 查询 < 10ms，无需按区域裁剪。
- **多 tick 推进时 delta 循环**：监听器接收 `$delta` 参数，内部按 `for (t = current-delta+1; t <= current; t++)` 循环，对每个满足 `t % interval == 0` 的 tick 调用一次 `obl_refresh_wild_items($t)`。delta=1 时退化为单次检查；delta=250、interval=100 时触发 2 次（tick=100/200）。per-tile 的 `last_refresh_turn` 检查确保同一格在一次 delta 批处理内最多被刷新一次。
- **scatter_pool 缺失 refresh 相位**：某些潮汐区可能只配置 `initial` 而无 `refresh`（如"一次性资源区"），`obl_refresh_wild_items` 检测到 `refresh` 缺失时直接跳过该 tide 桶，不报错。
- **POI 搜刮产出不计入容量**：E-10 直接物化产出的道具写入 oblmapitem（`source_iaid=POI.iaid > 0, discovered=1`），批量 COUNT 时 `WHERE source_iaid=0` 过滤掉这些道具——**野生道具容量与 POI 搜刮产出完全解耦**。玩家拾取 POI 产出道具同样不影响野生容量计数。

---

## 四、框架 E-10：POI 搜刮三档判定系统（新增）

### 4.1 设计意图

E-10 是本案的核心新增框架，负责"搜刮一次 POI 该出什么、发生什么"的完整掷骰与结果生成。旧 [obl_search_poi()](file:///d:/wamp64/www/phpdts/oblivions/include/game/explore.func.php#L212-L344) 是一个简单的"读掉落表 → 按 rate 概率生成道具 → 直接写入 oblmapitem"的扁平流程，缺少：状态机校验、概率修正、事件触发、保底机制。E-10 把这些全部补齐。

核心设计点：

1. **状态机校验**：POI 实例从 [oblmappoi](file:///d:/wamp64/www/phpdts/oblivions/sql/oblmappoi.sql) 的 `searched` 布尔位升级为四态状态机：
   - `idle`：可搜刮
   - `searched`：刚搜刮完，待拾取道具已直接物化到 oblmapitem（`source_iaid=POI.iaid, discovered=1`）
   - `cooldown`：冷却中（cooldown_until_turn > 当前 tick）
   - `exhausted`：耗尽（不可重复 POI 搜刮次数达上限）

2. **概率计算**：每个 POI 模板有三项核心概率（物资概率、良性事件概率、恶性事件概率），受光照（占位）、天气（占位）、地板属性、潮汐等级综合影响；工具/技能可对概率施加修正（prob_mods）或路由到改良版战利品表（loot_table_override）。**prob_mods 累积超界时统一在 `obl_calc_poi_probabilities()` 末尾 clamp 到 [0,1]**，不阻塞搜索流程，玩家无感知。

3. **三档判定算法**（严格按优先级，命中即停止）：
   - **第一档 保底（pity_timer）**：玩家全局 `pity_timer` 字段（**存在 `oblpara.pity_timer` JSON 字段**，跨 POI 共享），不出货+1，达阈值 `pity_threshold`（默认 5）强制触发保底掉落；保底触发后 reset 为 0（最低 0）。
   - **第二档 事件池分发**：掷骰命中"事件概率"范围内 → 从该 POI 的事件池中按权重抽取一个事件，调用 `obl_dispatch_poi_event($event_id, $poi, $pdata)` 分发到具体处理函数 `obl_event_{event_id}()`。
   - **第三档 普通掉落**：掷骰命中"物资概率"范围内 → 调用 F-4 战利品表引擎，传入 POI 的 loot_table_id（或 loot_table_override 路由后的改良版表 ID），**F-4 返回物品实例数组，由 E-10 负责逐件 INSERT 进 oblmapitem**（`source_iaid=POI.iaid, discovered=1`）。
   - **第四档 空**：以上都没触发，emit "这次什么也没找到"。

4. **pity_timer 全局回拨**：除保底档外，事件档与普通掉落档触发时 pity_timer 回拨 1（最低 0）；空档触发时 pity_timer +1。这让"出货稍微延后保底，但出货本身也会推迟保底"，避免保底过于频繁。

5. **POI 搜刮结果直接物化（不走 pending_loot 暂存）**：搜刮产出的道具**直接 INSERT 进 oblmapitem**（`source_iaid=POI.iaid, discovered=1`），玩家通过现有 `item.pickup` 命令拾取——与野生道具拾取流程完全一致，**无需 `pending_loot` 暂存或 `poi.fetch_loot` 命令**。
   - **"首次弹出"实现**：`poi.search` 响应附带 `loot_dropped: [item_id列表]` 字段，前端 L-9 收到后自动切到交互态显示掉落物。
   - **"再次呼出"实现**：玩家离开交互态后通过 PoiInteractButton → `poi.list` → 选中 POI → 交互态查询 `WHERE source_iaid=POI.iaid AND discovered=1` 显示未拾取道具列表。
   - 背包满时玩家可先丢弃其他道具再回来拾取——道具保留在 oblmapitem 中，不会丢失。

6. **事件池分发框架**：与现有 [obl_mechanic_{name}()](file:///d:/wamp64/www/phpdts/oblivions/include/game/explore.func.php#L357-L371) 分发框架同构——新增事件只需添加 `obl_event_{event_id}()` 函数，框架自动分发。原型阶段先填 2-4 个测试事件。

7. **战利品表新结构**（去除容器与嵌套）：
   ```
   loot_table = [
       'groups' => [
           [
               'roll_chance' => 1.0,           // 本组掷骰概率（独立于其他组）
               'options' => [                   // 互斥选项，按 weight 加权选择
                   ['item_id' => '...', 'weight' => 10, 'count' => [1,3], 'durability_decay' => 0.5],
                   ['item_id' => '...', 'weight' => 5,  'count' => 1,     'durability_decay' => 0.8],
               ],
           ],
           // 更多组...
       ]
   ]
   ```
   - `roll_chance`：本组是否掷骰（独立于其他组）
   - `options`：互斥选项列表，按 `weight` 加权选择其中一个
   - `count`：单值或 [min,max] 区间
   - `durability_decay`：耐久度衰减系数（0-1），最终耐久 = `itme_max * (1 - decay * rand(0,1))`
   - **无嵌套表引用，无容器装填**——原型阶段多件物品需求通过扩 count 或拆组实现

### 4.2 代码锚点

- 主文件（新增）：`oblivions/include/game/poi/poi.search.func.php` — E-10 三档判定核心，由 obl_bootstrap.php 在 loot.engine.func.php 之后、tick.func.php 之前加载
  - `obl_search_poi($pdata, $poi, $tool_id = null, $skill_id = null)` — 命令入口（直接物化方案；命令分发层先按 iaid 查 POI 实例 + 位置校验，再调用本函数）
  - `obl_calc_poi_probabilities($poi, $context)` — 概率计算（**末尾统一 clamp 到 [0,1]**）；$poi 含模板与实例字段，$context 含 tile/prob_mods/tool_id/skill_id
  - `obl_get_pity_timer($uid)` / `obl_set_pity_timer($uid, $value)` — pity_timer 读写 oblpara.pity_timer JSON 字段（跨 POI 共享）
  - `obl_advance_poi_state($poi, $new_state, $current_turn)` — 状态机推进（乐观锁 `UPDATE ... WHERE iaid=X AND state=旧值`）
  - `obl_materialize_loot($poi, $items)` — 将 F-4 返回的物品实例数组逐件 INSERT 进 oblmapitem（`source_iaid=POI.iaid, iaid=POI.iaid, discovered=1`）
  - 状态机校验内联在 `obl_search_poi` 入口（idle → 通过；searched → 检查 oblmapitem 是否仍有待拾取；cooldown → 检查 tick ≥ cooldown_until_turn 自动推进到 idle；exhausted → 拒绝）
  - 三档判定主流程：保底 → 事件 → 普通 → 空（命中即停止）
  - 工具/技能路由：prob_mods + loot_table_override（同一时刻只一个生效，工具 > 技能）
- 事件池分发文件（新增）：`oblivions/include/game/poi/poi.event.func.php` — 事件池分发框架与测试事件，由 obl_bootstrap.php 与 poi.search.func.php 一同加载
  - `obl_dispatch_poi_event($event_id, $context)` — 分发框架（命名约定 `obl_event_{event_id}`，找不到函数时 emit `search.event_pending` 并降级为普通掉落档）
  - 4 个测试事件实现：`obl_event_find_extra_cache` / `obl_event_safe_route` / `obl_event_trap_trigger` / `obl_event_structure_collapse`
  - 事件函数签名：`function obl_event_{event_id}($context): array`，$context = `['poi' => 实例行, 'template' => 模板配置, 'pdata' => &玩家数据引用, 'tool_id' => ?, 'skill_id' => ?]`
  - 事件返回结构化结果：`['type' => 'good'/'bad', 'items' => [...], 'message' => '...', 'state_change' => 'exhausted'/null, 'damage' => ?, 'delete_loot' => bool, ...]`；`items` 由调用方 `obl_materialize_loot()` 物化进 oblmapitem（事件函数不直接写 oblmapitem）
  - **不引入** `obl_fetch_loot()` 函数（直接物化方案，无 pending_loot 取走命令）
- POI 模板扩展：[oblivions/gamedata/poi_table.php](file:///d:/wamp64/www/phpdts/oblivions/gamedata/poi_table.php) 每个可搜索 POI 增加：
  - `base_loot_chance`：基础物资概率
  - `base_good_event_chance`：基础良性事件概率
  - `base_bad_event_chance`：基础恶性事件概率
  - `event_pool`：事件 ID 列表（带权重）
  - `loot_table_id`：关联 F-4 战利品表 ID
  - `loot_table_overrides`：工具/技能路由的改良版表 ID 映射（如 `['lockpick' => 'supply_cache_lockpick', 'flashlight' => 'supply_cache_flashlight']`）
  - `prob_mods_source`：声明该 POI 接受哪些工具/技能的 prob_mods（白名单）
- 战利品表文件（新增）：`oblivions/gamedata/loot_tables.php` — 新战利品表结构，替代旧 [poi_loot.php](file:///d:/wamp64/www/phpdts/oblivions/gamedata/poi_loot.php)
- 数据库：[oblivions/sql/oblmappoi.sql](file:///d:/wamp64/www/phpdts/oblivions/sql/oblmappoi.sql) 新增字段：
  - `state varchar(16) NOT NULL default 'idle'` — 状态机（idle/searched/cooldown/exhausted）
  - `cooldown_until_turn int unsigned NOT NULL default '0'` — 冷却到期 tick
  - `search_count_total smallint unsigned NOT NULL default '0'` — 累计搜刮次数（与现有 search_count 区分，search_count 改名后弃用）
  - **不引入** `pending_loot` / `pending_loot_seen` 字段（直接物化方案，本表不暂存）
- 数据库：[oblivions/sql/oblmapitem.sql](file:///d:/wamp64/www/phpdts/oblivions/sql/oblmapitem.sql) 新增字段（见附录 B §2.2）：
  - `source_iaid mediumint unsigned NOT NULL default '0'` — 区分野生道具（0）与 POI 产出（>0，待拾取）
- 数据库：[oblivions/sql/oblplayers.sql](file:///d:/wamp64/www/phpdts/oblivions/sql/oblplayers.sql) 的 `oblpara` JSON 字段内新增：
  - `pity_timer`：保底计时器（默认 0，**跨 POI 共享**）
  - `pity_threshold`：保底阈值（默认 5，可被技能/buff 覆盖）
- 命令合约：[oblivions/include/command/obl_command_contract.php](file:///d:/wamp64/www/phpdts/oblivions/include/command/obl_command_contract.php)：
  - `poi.search` 扩展 payload：`tool_slot`（可选）、`skill_id`（可选）；响应增加 `loot_dropped: [item_id列表]` 字段（前端"首次弹出"用）
  - **不引入 `poi.fetch_loot` 命令**（直接物化方案，玩家通过现有 `item.pickup` 拾取，与野生道具流程一致）
- 命令分发：[oblivions/include/command/obl_command_handlers.php](file:///d:/wamp64/www/phpdts/oblivions/include/command/obl_command_handlers.php) 无需新增分支（`item.pickup` 已存在）

### 4.3 具体案例

#### 案例 4.3.1：完整搜刮流程

玩家点击"搜刮废弃房子"（poi_id=supply_cache），未使用工具。命令分发层先按 iaid 查 oblmappoi 行 + 校验玩家位置 (pgroup/pls) 与 POI 一致，再调用 `obl_search_poi($pdata, $poi, null, null)`：

1. **状态机校验**（内联在 `obl_search_poi` 入口，检查 `$poi['state']`）：
   - `idle` → 允许搜刮，继续
   - `searched` → 检查 oblmapitem 是否仍有 `source_iaid=POI.iaid AND discovered=1` 的待拾取道具；有则提示先拾取（可选阻止），无则推进状态机继续
   - `cooldown` → 检查 `cooldown_until_turn <= tick`，是则 `obl_advance_poi_state($poi, 'idle', $tick)` 推进到 `idle` 继续；否则拒绝，emit `search.in_cooldown`
   - `exhausted` → 拒绝（永久），emit `search.exhausted`

2. **概率计算**：`obl_calc_poi_probabilities($poi, $context)` 综合计算（$context = `['template' => 模板配置, 'tile' => 地块数据, 'prob_mods' => [...], 'tool_id' => ?, 'skill_id' => ?]`）：
   ```
   loot_chance     = base_loot_chance * floor_mod * tide_mod
   good_event_chance = base_good_event_chance * floor_mod
   bad_event_chance  = base_bad_event_chance * tide_mod
   ```
   - `floor_mod`：地板属性修正（占位为 1.0）
   - `tide_mod`：潮汐等级修正（如 shallow=1.0, deep=1.2, abyss=1.4）
   - 工具/技能的 prob_mods 在此之后应用
   - **末尾统一 clamp 所有概率到 [0,1]**，超界（如负数或 >1）自动收敛

3. **pity_timer 检查**：
   - 读取 `$pdata['oblpara']['pity_timer']`（假设当前为 5，阈值 5）
   - 达阈值 → 触发保底档：调用 F-4 引擎 `obl_roll_loot_table($poi_template['loot_table_id'], $context)` 生成物品实例数组，**E-10 调用 `obl_materialize_loot($poi, $items)` 逐件 INSERT 进 oblmapitem（`source_iaid=POI.iaid, discovered=1, iaid=POI.iaid`）**，pity_timer reset 为 0（`obl_set_pity_timer($pdata['pid'], 0)` + 同步 `$pdata['oblpara']['pity_timer']`）
   - 响应 payload 附带 `loot_dropped: [item_id列表]`
   - emit `search.pity_triggered`

4. **若保底未触发**：按优先级依次掷骰：
   - 事件档：`rand() < (good_event_chance + bad_event_chance)` → 从 event_pool 按权重抽一个 event_id，调用 `obl_dispatch_poi_event($event_id, $context)`（$context 含 `poi/template/pdata/tool_id/skill_id/tick` 引用）；事件返回 `items` 由 `obl_materialize_loot()` 物化；pity_timer 回拨 1
   - 普通档：`rand() < loot_chance` → 调用 F-4 引擎 `obl_roll_loot_table($loot_table_id_or_override, $context)` 生成物品实例数组，`obl_materialize_loot()` 物化进 oblmapitem；pity_timer 回拨 1
   - 空档：以上都没命中，emit `search.nothing_found`；pity_timer +1

5. **状态机推进**：`obl_advance_poi_state($poi, $new_state, $tick)` 乐观锁推进：
   - 一次性 POI（repeatable=false）：state → `exhausted`（但 oblmapitem 中已物化的道具仍可拾取）
   - 可重复 POI（repeatable=true）：state → `searched`（待玩家拾取完 oblmapitem 中 `source_iaid=POI.iaid AND discovered=1` 的道具后推进）
   - 玩家拾取完待拾取道具后：state → `cooldown`，`cooldown_until_turn = tick + repeat_cooldown`；若 `search_count_remaining=0` 则 → `exhausted`

#### 案例 4.3.2：工具/技能路由

玩家搜刮 supply_cache 时使用"开锁器"（tool_slot=3）：
1. 读取工具的 `itmid`（如 `lockpick`）
2. 查 POI 模板的 `loot_table_overrides`：`['lockpick' => 'supply_cache_lockpick']`
3. 查 POI 模板的 `prob_mods_source`：声明接受 `lockpick` 的 prob_mods
4. 查工具定义（item_table）的 `poi_prob_mods`：`['lockpick' => ['loot_chance' => +0.2, 'bad_event_chance' => -0.1]]`
5. 应用 prob_mods 到最终概率，末尾 clamp 到 [0,1]
6. 普通档触发时使用 `supply_cache_lockpick` 战利品表（通常有更高 weight 的高级物品）

技能路由同理：`skill_id` 路由到 `loot_table_overrides` 的改良版表，技能等级影响 prob_mods 强度。

#### 案例 4.3.3：事件池分发

POI 模板配置：
```php
'event_pool' => [
    ['event_id' => 'find_extra_cache', 'weight' => 30, 'kind' => 'good'],
    ['event_id' => 'safe_route',        'weight' => 20, 'kind' => 'good'],
    ['event_id' => 'trap_trigger',      'weight' => 35, 'kind' => 'bad'],
    ['event_id' => 'structure_collapse','weight' => 15, 'kind' => 'bad'],
]
```

事件档触发时：
1. 按 weight 加权随机抽一个 event_id
2. 调用 `obl_dispatch_poi_event('find_extra_cache', $context)`（$context 含 `poi/template/pdata/tool_id/skill_id/tick` 引用）
3. 框架查找 `obl_event_find_extra_cache()` 函数并调用
4. 函数内部：emit 事件描述日志、生成额外物品通过返回值 `items` 字段交回调用方物化（事件函数不直接写 oblmapitem）、可能施加 buff（如 trap_trigger 扣 HP 通过 `pdata` 引用修改）

#### 案例 4.3.4：四个测试事件

| 事件 ID | 类型 | 行为 |
|---------|------|------|
| `find_extra_cache` | 良性 | 调用 F-4 引擎用 `extra_cache_loot` 表生成物品实例数组，通过 `obl_materialize_loot()` 物化进 oblmapitem；emit `search.event.find_extra_cache` |
| `safe_route` | 良性 | 发现安全路径，下次移动消耗体力 -50%（写入 oblpara 临时 buff）；emit `search.event.safe_route` |
| `trap_trigger` | 恶性 | 玩家立即受到 10-20 点伤害（不低于 1 HP），emit `search.event.trap_trigger`，伤害由前端通过 log 渲染 |
| `structure_collapse` | 恶性 | POI 永久 `exhausted`，本次 oblmapitem 中已物化的 `source_iaid=POI.iaid` 道具全部 DELETE（结构坍塌压坏了物资），emit `search.event.structure_collapse` |

事件函数签名：`function obl_event_{event_id}($context): array`，$context = `['poi' => 实例行, 'template' => 模板配置, 'pdata' => &玩家数据引用, 'tool_id' => ?, 'skill_id' => ?, 'tick' => int]`，返回值结构 `['type' => 'good'/'bad', 'items' => [...], 'message' => '...', 'state_change' => 'exhausted'/null, 'damage' => ?, 'delete_loot' => bool, ...]`（`items` 由调用方 `obl_materialize_loot()` 物化进 oblmapitem，事件函数不直接写 oblmapitem；`state_change='exhausted'` 触发 POI 终态推进；`delete_loot=true` 触发本次 oblmapitem 中 `source_iaid=POI.iaid` 道具全量 DELETE；`damage` 由调用方施加到玩家）。

#### 案例 4.3.5：POI 产出道具拾取流程（统一 item.pickup）

玩家通过现有 `item.pickup` 命令拾取 POI 产出的道具（`source_iaid=POI.iaid` 的 oblmapitem 行）：

1. **首次弹出**：玩家执行 `poi.search`，后端物化产出后响应附带 `loot_dropped: [item_id列表]`，前端 L-9 收到后自动切到交互态显示掉落物列表
2. **拾取流程**：玩家点击某件道具 → 调用 `item.pickup` 命令（与野生道具拾取完全一致的流程）
   - `obl_pickup_item()` 内部 `DELETE FROM oblmapitem WHERE iid=X AND discovered>0`
   - **无需区分 source_iaid**，affected_rows 检查防并发
   - **无需同步 oblmappoi.pending_loot**（已删除该字段）
3. **再次呼出**：玩家离开交互态后想再查看 → 通过 PoiInteractButton → `poi.list` → 选中 POI → 交互态查询 `WHERE source_iaid=POI.iaid AND discovered=1` 显示未拾取道具列表
4. **背包满时**：`item.pickup` 自身的背包满机制生效（emit `pickup.bag_full`），玩家可丢弃其他道具后重试——POI 产出的道具保留在 oblmapitem 中不会丢失
5. **待拾取道具清空后**： oblmapitem 中 `source_iaid=POI.iaid AND discovered=1` 已无剩余，根据 POI 类型推进状态机（cooldown / exhausted / idle）

#### 案例 4.3.6：pity_timer 流转

| 当前 pity | 本次结果 | pity 变化 |
|-----------|---------|----------|
| 0 | 空档 | 1 |
| 1 | 空档 | 2 |
| 2 | 普通掉落 | 1（回拨 1） |
| 3 | 事件档 | 2（回拨 1） |
| 4 | 空档 | 5（达阈值） |
| 5 | 保底触发 | 0（reset） |

注意：保底档在事件档与普通档之前判定，所以达阈值时即使本次掷骰本来会触发事件/普通档，也会被保底档抢先触发——这是设计意图（"长时间没出货"的补偿优先级最高）。

### 4.4 边界案例

- **POI 状态持久化与并发**：状态机推进使用 `UPDATE oblmappoi SET state=... WHERE iaid=... AND state=旧值` 的乐观锁，affected_rows=0 说明并发冲突，emit `search.concurrent_conflict` 并 return。
- **POI 产出未拾取道具与背包满**：玩家背包满时 `item.pickup` 自身机制返回 `pickup.bag_full`，**POI 产出的道具保留在 oblmapitem 中不会丢失**——玩家可丢弃背包道具后通过 PoiInteractButton 再次呼出交互态拾取。这避免玩家因一时背包满永久丢失搜刮成果。
- **POI 状态机与待拾取道具**：可重复 POI 的 `cooldown` 状态必须等 oblmapitem 中 `source_iaid=POI.iaid AND discovered=1` 的待拾取道具清空后才进入——玩家不能"搜刮一次后立刻搜刮第二次"而把第一次的成果丢弃。这强制玩家做出"取走或丢弃"的决策。
- **一次性 POI 的待拾取道具**：一次性 POI 搜刮后 state → `exhausted`，但 oblmapitem 中已物化的道具仍可通过 `item.pickup` 拾取（exhausted 仅阻止再次搜刮，不阻止拾取已物化的道具）。玩家可以分多次取走——这避免一次性 POI 搜刮产出超过背包容量时被迫丢弃。
- **事件档与 pity_timer 互斥**：保底档优先级最高，事件档与普通档触发时都会回拨 pity_timer，但保底档触发时不会触发事件/普通档（保底是"强制掉落"而非"附加掉落"）。这意味着保底档不会同时触发事件——设计意图是保底就是"补偿一下，别让玩家太挫败"，不需要额外惊喜。
- **工具/技能 prob_mods 边界**：
  - **prob_mods 的累积结果在 `obl_calc_poi_probabilities()` 末尾统一 clamp 到 [0,1] 区间**，避免出现负概率或 >100% 概率；clamp 不阻塞搜索流程，玩家无感知
  - 不同工具/技能的 prob_mods 可叠加（如同时用开锁器+手电筒），但 POI 模板的 `prob_mods_source` 必须显式声明接受哪些工具/技能——未声明的修正被忽略
  - `loot_table_override` 同一时刻只能有一个生效（玩家只能选一个工具/技能路由），多个工具同时使用时按优先级（工具 > 技能）选一个
- **事件池为空**：某些 POI 可能没有 event_pool（如纯掉落型 POI），事件档直接跳过——但 `base_good_event_chance + base_bad_event_chance` 应当为 0，避免概率悬空。配置校验在 POI 模板加载时进行。
- **事件函数未定义**：`obl_dispatch_poi_event` 找不到 `obl_event_{event_id}` 函数时，emit `search.event_pending` 并降级为普通掉落档判定——与 [obl_mechanic 分发框架](file:///d:/wamp64/www/phpdts/oblivions/include/game/explore.func.php#L362-L370) 的容错策略一致。
- **耐久度衰减为 0**：`durability_decay=0` 表示无衰减，物品满耐久；`durability_decay=1` 表示最严重衰减（耐久 = `itme_max * (1 - 1 * rand(0,1))`，可能为 0）。耐久为 0 的物品是否生成由 F-4 引擎决定（建议跳过，避免生成已损坏物品）。
- **F-4 引擎未落地时**：E-10 的普通档与保底档依赖 F-4 战利品表引擎。F-4 未落地前，可临时降级为旧 [poi_loot.php](file:///d:/wamp64/www/phpdts/oblivions/gamedata/poi_loot.php) 的扁平 rate 列表（适配层在 `obl_search_poi` 内部，命令层无感知）。F-4 落地后切换为新战利品表结构。
- **pity_timer 跨 POI 共享**：pity_timer 是玩家全局字段（存 `oblpara.pity_timer`），不与具体 POI 绑定——玩家在 supply_cache 搜刮 5 次都没出货，第 6 次搜刮 danger_chest 时也会触发保底。这避免玩家通过"切 POI"绕过保底。
- **pity_timer 持久化**：pity_timer 写在 `oblpara.pity_timer`，与玩家其他 obl 杂项数据一起序列化持久化——玩家退出重连不丢失。
- **state 字段向后兼容**：旧 `searched` 布尔位迁移到 `state` 枚举：`searched=0 → state='idle'`，`searched=1 → state='exhausted'`（一次性 POI）或 `state='cooldown'`（可重复 POI，cooldown_until_turn=0 立即推进到 idle）。**无需迁移 pending_loot**——本字段已废弃，旧数据中无该字段。迁移脚本由独立设计案处理（本案不涉及数据迁移）。
- **POI 产出与野生道具拾取流程统一**：直接物化方案下，POI 产出（`source_iaid>0`）与野生道具（`source_iaid=0`）走完全相同的 `item.pickup` 流程——`obl_pickup_item()` **无需区分 source_iaid**，统一 `DELETE WHERE iid=X AND discovered>0` + affected_rows 检查；命令合约 `item.pickup` 的 `itm0_allowed` 设为 `false` 已是现有约束，无需新增门控。

---

## 五、附：与设计案原始方案的差异说明

本设计案在落地 [原始方案](file:///d:/wamp64/www/phpdts/oblivions/docs/原始方案/搜索建筑物与掉落机制设计案.md) 时，根据项目现状与用户明确约束做了以下调整：

| 原始方案条目 | 本设计案处理 | 理由 |
|------------|------------|------|
| §6.2 嵌套表（占位，未来实现） | **去除** | 用户明确要求去除容器、容器嵌套、递归展开概念；原型阶段所有战利品表扁平化 |
| §6.3 容器装填（占位，未来实现） | **去除** | 同上 |
| §6.1 战利品表结构 | 改为"物品组 + 互斥选项（按 weight）+ count + durability_decay" | 与去除嵌套保持一致，且更易于 F-4 引擎实现 |
| §2.1 每推进 100 次游戏刻刷新 | 保留，配置项 `wild_refresh_interval_ticks` 默认 100 | 与设计意图一致 |
| §2.3 搜刮技能等级决定发现数量 | 落地为 `discover_base + discover_per_level * scavenge_skill_level` | 与 E-7 扩展要点一致 |
| §3.2 三项核心概率 | 落地为 `base_loot_chance / base_good_event_chance / base_bad_event_chance` | 与 E-10 概率计算一致 |
| §3.3 工具/技能路由到"改良版搜刮分支" | 落地为 `loot_table_override` + `prob_mods` | 路由到改良版战利品表 + 概率修正 |
| §3.4 POI 状态机 | 落地为四态（idle/searched/cooldown/exhausted） | 比原始方案的"两态+冷却"更清晰 |
| §4.3 掉落物不直接飞入背包 | 落地为直接物化到 `oblmapitem`（`source_iaid=POI.iaid, discovered=1`）+ 现有 `item.pickup` 拾取（与野生道具流程完全一致）；**删除 `pending_loot` 暂存与 `poi.fetch_loot` 命令** | 避免引入额外的暂存字段与拾取命令；野生道具与 POI 产出共用一套拾取流程，`obl_pickup_item()` 无需区分 `source_iaid`；前端通过 `poi.search` 响应附带的 `loot_dropped` 字段实现首次弹出 |
| §5 三档判定 | 落地为保底 → 事件 → 普通 → 空 | 与原始方案优先级一致 |
| §5 保底触发后计时器重置；其他档触发时计时器略微回拨 | 落地为：保底 reset=0，事件/普通档 -1（最低 0），空档 +1 | 与"略微回拨"对齐 |
| §5 测试事件 | 先填 4 个：find_extra_cache / safe_route（良性）、trap_trigger / structure_collapse（恶性） | 与"2-4 个测试事件"对齐 |

---

## 六、待后续设计案落地的占位

本设计案不直接实现，但为以下后续设计案预留接口：

1. **F-4 战利品表引擎**：本设计案引用 F-4 作为普通掉落档与保底档的执行引擎，F-4 的具体实现（物品组掷骰、互斥选项 weight 加权、count 区间随机、durability_decay 耐久衰减）由独立设计案落地。**F-4 引擎返回物品实例数组（含 item_id / itm / itmk / itme / itms / itmsk / itmpara 等字段），由 E-10 负责逐件物化进 oblmapitem**（`source_iaid=POI.iaid, discovered=1`）—— F-4 仅负责"掷骰出物品"，物化与拾取流程归 E-10 与 F-1。
2. **地板属性系统**：E-7 探索后钩子与 E-10 概率计算都引用 `floor_mod`，地板属性（如湿地、辐射区、神圣地）的具体定义由独立设计案落地。
3. **光照/天气系统**：E-10 概率计算引用光照/天气修正，目前为占位（1.0），具体定义由独立设计案落地。
4. **事件系统**：E-7 探索后钩子的"事件点触发"占位，与 E-10 的事件池分发是两套机制——前者是"踩点触发"（如踩到地雷），后者是"搜刮时触发"（如搜到一半塌方）。前者由独立事件系统设计案落地。
5. **任务系统**：E-7 探索后钩子的"任务进度通知"占位，由独立任务系统设计案落地。
