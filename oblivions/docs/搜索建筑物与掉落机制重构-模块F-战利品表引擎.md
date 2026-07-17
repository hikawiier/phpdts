# 搜索建筑物与掉落机制重构 — 模块 F：战利品表引擎

> 本设计案落地 F-4 战利品表引擎，替代现有扁平 [poi_loot.php](file:///d:/wamp64/www/phpdts/oblivions/gamedata/poi_loot.php)。
> 对照原始设计案 [§6 战利品池规则](file:///d:/wamp64/www/phpdts/oblivions/docs/原始方案/搜索建筑物与掉落机制设计案.md)，
> 落实"物品组 + 互斥选项 + 耐久衰减"三要素，按用户明确约束去除容器、容器嵌套、递归展开概念。

---

## 一、模块概览

F-4 在物品系统 F 中的位置：

| 框架 | 定位 | 与 F-4 的关系 |
|------|------|---------------|
| [F-1 槽位背包与 itm0 暂存槽协议](file:///d:/wamp64/www/phpdts/oblivions/include/game/item/item.basic.func.php) | 物品实例的存储与流转基础设施 | F-4 产出的物品实例最终经 F-1 的拾取/整理流程入背包 |
| [F-2 配置驱动的合成系统](file:///d:/wamp64/www/phpdts/oblivions/include/game/item/item.craft.func.php) | 玩家驱动的物品转换 | 与 F-4 互不依赖；F-4 产出的素材可作为 F-2 的合成材料 |
| [F-3 使用效果分发器](file:///d:/wamp64/www/phpdts/oblivions/include/game/item/item.use.func.php) | 道具使用效果执行 | F-4 产出的消耗品（HH/HS/DX）经 F-3 触发使用效果 |
| **F-4 战利品表引擎（本设计）** | **POI 搜刮的物品生成入口** | **被 E-7 探索管道 / E-10 三档判定调用；F-4 仅返回物品实例数组，物化（INSERT oblmapitem、discovered 标记、source_iaid 归属等）由 E-10 负责** |

F-4 是物品系统的"生成侧入口"——F-1/F-2/F-3 处理"物品已存在后的流转与转换"，F-4 处理"物品从无到有的生成"。F-4 产出的物品实例格式与 F-1 拾取流程期望的 itempara 七字段结构对齐（itm/itmk/itme/itms/itmsk/itmpara/itmid），由调用方（E-10）物化后无缝衔接 F-1 的 obl_pickup_item。

---

## 二、框架 F-4：战利品表引擎（新增）

### 2.1 设计意图

**核心问题**：现有 [poi_loot.php](file:///d:/wamp64/www/phpdts/oblivions/gamedata/poi_loot.php) 是扁平的 `[['item_id','count','rate']]` 数组，每条独立按 rate 判定。该结构无法表达"先抽大类、再在类内抽具体物品"的互斥选择语义，导致：

1. 同类物品互相竞争掉落时，需要在多条 entry 上手工分配 rate，概率分布不可推断、难维护
2. 无法表达"这组必出一件，但具体是哪件按权重"的常见废土搜刮语义
3. 多件物品配置只能"扁平平铺"，缺少语义分组，配置膨胀后可读性陡降

**解决思路**：引入"物品组 + 互斥选项"两层结构。每张表由若干物品组构成，每组独立掷骰（先按组级 chance 判定是否掷骰，再按 entries 的 weight 加权选择一个 entry），按 count 生成物品实例。组内互斥选择自然表达"必出一件但具体看权重"语义，组间独立掷骰表达"各组各自概率出货"语义。

**关键决策（用户明确约束）**：

| 决策 | 说明 |
|------|------|
| **去除容器、容器嵌套、递归展开** | 不引入容器类型道具，不实现容器装填，不实现嵌套表递归展开。原始设计案 §8.2/§8.3 标记为占位，本引擎不实现 |
| **多件物品配置拆解为多个单件独立掉落** | 不再"装进容器"，而是直接生成多件独立物品实例。配置层支持 count=int 或 [min,max]，引擎按 count 生成实例 |
| **扩容 entries 上限** | 单张表 entries 总数上限提升至 100+（默认 `OBL_LOOT_MAX_ENTRIES = 100`），原扁平结构无明确上限但语义受限 |
| **保留耐久度衰减** | 在物品 itms 最大值范围内随机 [1, itms]，模拟"被丢弃前已用过一段时间" |
| **循环检测不再需要** | 无嵌套表 → 无递归展开 → 无循环引用风险，引擎无需循环检测 |

**与外部参考 loot_tables.json 的关系**：[loot_tables.json](file:///d:/wamp64/www/phpdts/oblivions/docs/原始方案/loot_tables.json)（663KB，764 张表）是外部游戏的战利品表转储，含 `is_nested_table`/`nested`/`suppress`/`identify` 等外部语义字段。本引擎**不直接复用其结构**——`is_nested_table=true` 的条目（嵌套表引用）在迁移时跳过或扁平化为本表的物品组；`nested`/`suppress`/`identify` 字段忽略。迁移时将外部 `item_id`（如 "94.2"）映射为本游戏 [item_table.php](file:///d:/wamp64/www/phpdts/oblivions/gamedata/item_table.php) 的 item_id（如 "health_potion"），将 `chance` 拆解为组级 chance 或 entry weight。

### 2.2 代码锚点

| 文件 | 角色 | 状态 |
|------|------|------|
| `oblivions/gamedata/loot_tables.php` | 战利品表配置文件（替代 poi_loot.php） | 新增 |
| `oblivions/include/game/loot/loot.engine.func.php` | 引擎核心：掷骰、衰减、实例化 | 新增 |
| `oblivions/include/core/obl_bootstrap.php` | 第 5.5 层 item 系统加载后追加 `require_once loot.engine.func.php` | 修改 |
| `oblivions/gamedata/poi_loot.php` | 旧扁平配置，迁移完成后废弃（删除时机由 E-10 决定） | 废弃 |

文件头注解同步双向锚点：
- `loot.engine.func.php` 同步 `@module F 物品系统` + `@framework F-4 战利品表引擎`
- `loot_tables.php` 同步 `@module F 物品系统`（普通模块文件仅同步 `@module`）
- 迁移完成后运行 `php oblivions/tools/validate_design_anchors.php` 严格模式校验（校验器尚未实现时，依赖 `php -l` 语法校验与人工审阅）

### 2.3 战利品表配置格式（loot_tables.php）

```php
<?php
/**
 * @module F 物品系统
 */
if (!defined('IN_GAME')) { exit('Access Denied'); }

// ================================================================
// Oblivions 战利品表（F-4 引擎配置）
// 表 ID (string key) → 表定义
// 结构：groups[] 物品组 + 组内 entries[] 互斥选项 + 耐久衰减开关
// 替代旧 poi_loot.php 的扁平 [['item_id','count','rate']] 结构
// ================================================================

return [
    'medical_supplies' => [
        'name' => '医疗物资表',
        'durability_decay' => true,    // 启用耐久衰减（仅对非堆叠装备生效）
        'groups' => [
            // 第一组：100% 出一件基础医疗工具（互斥三选一，按权重）
            [
                'chance' => 1.0,
                'entries' => [
                    ['item_id' => 'health_potion',  'weight' => 60, 'count' => 1],
                    ['item_id' => 'stamina_potion', 'weight' => 30, 'count' => 1],
                    ['item_id' => 'antidote',       'weight' => 10, 'count' => 1],
                ],
            ],
            // 第二组：50% 出 1~3 件草药（可堆叠，count 直接作为 itms）
            [
                'chance' => 0.5,
                'entries' => [
                    ['item_id' => 'swamp_herb', 'weight' => 100, 'count' => [1, 3]],
                ],
            ],
            // 第三组：20% 出一件装备（耐久衰减生效）
            [
                'chance' => 0.2,
                'entries' => [
                    ['item_id' => 'rust_circlet', 'weight' => 70, 'count' => 1],
                    ['item_id' => 'bone_amulet',  'weight' => 30, 'count' => 1],
                ],
            ],
        ],
    ],

    'scrap_pile_loot' => [
        'name' => '废料堆掉落',
        'durability_decay' => false,   // 纯素材表，无耐久概念
        'groups' => [
            [
                'chance' => 1.0,
                'entries' => [
                    ['item_id' => 'scrap_metal', 'weight' => 50, 'count' => [2, 5]],
                    ['item_id' => 'rusty_gear',  'weight' => 30, 'count' => [1, 3]],
                    ['item_id' => 'cloth',       'weight' => 20, 'count' => [1, 2]],
                ],
            ],
            [
                'chance' => 0.3,
                'entries' => [
                    ['item_id' => 'rusty_pipe', 'weight' => 100, 'count' => 1],
                ],
            ],
        ],
    ],

    // 空表：无 groups，返回空数组
    'empty_loot' => [
        'name' => '空白表',
        'durability_decay' => false,
        'groups' => [],
    ],
];
```

**字段语义**：

| 层级 | 字段 | 类型 | 默认 | 语义 |
|------|------|------|------|------|
| 表 | `name` | string | 必填 | 表名（用于日志/调试） |
| 表 | `durability_decay` | bool | false | 是否对产出物品应用耐久衰减 |
| 表 | `groups` | array | [] | 物品组列表，每组独立掷骰 |
| 组 | `chance` | float 0-1 | 1.0 | 组级概率：本组是否掷骰（先于 entry 选择） |
| 组 | `entries` | array | 必填 | 组内互斥选项列表，按 weight 加权选一 |
| entry | `item_id` | string | 必填 | 物品模板 ID（对应 item_table.php 的 key） |
| entry | `weight` | int/float | 1 | 组内互斥选择的权重（非概率，组内归一化） |
| entry | `count` | int \| [min,max] | 1 | 生成数量；stackable 物品作为 itms，非 stackable 作为实例数 |

**与旧扁平结构的对照**：

| 旧扁平结构 | 新 groups 结构 |
|-----------|---------------|
| 每条 entry 独立按 rate 判定 | 组级 chance 判定 + 组内 weight 互斥选择 |
| 无互斥语义（多条 entry 可能同时出货） | 组内互斥（每组至多一个 entry 出货） |
| rate 是绝对概率 | chance 是组级绝对概率，weight 是组内相对权重 |
| count 仅作为实例数 | count 对 stackable 作为 itms，对非 stackable 作为实例数 |
| 无耐久衰减（实例直接用模板 itms） | 表级 durability_decay 开关，衰减仅对非 stackable 装备生效 |

### 2.4 引擎核心函数

文件：`oblivions/include/game/loot/loot.engine.func.php`

```php
<?php
/**
 * @module F 物品系统
 * @framework F-4 战利品表引擎
 */
if (!defined('IN_GAME')) { exit('Access Denied'); }

// ================================================================
// F-4 战利品表引擎
// 替代 obl_search_poi 内联的扁平掉落循环
// 入口：obl_roll_loot_table() → list<item_instance>
// item_instance 格式与 F-1 itempara 七字段对齐：
//   ['itm','itmk','itme','itms','itmsk','itmpara','itmid']
// ================================================================

/**
 * 掷战利品表，返回物品实例列表
 *
 * @param string $table_id  战利品表 ID（loot_tables.php 的 key）
 * @param array  $context   运行时上下文（可选）：
 *                          - loot_table_override: string 覆盖表 ID（工具/技能路由）
 *                          - player_skills: array 玩家技能（预留，未来 E-10 使用）
 *                          - search_count: int POI 搜索次数（预留，衰减判定）
 * @return array 物品实例列表（可能为空）
 */
function obl_roll_loot_table($table_id, $context = []) {
    // 1. 上下文覆盖优先
    if (!empty($context['loot_table_override'])) {
        $table_id = $context['loot_table_override'];
    }

    // 2. 加载配置
    $tables = include GAME_ROOT . './oblivions/gamedata/loot_tables.php';
    if (!isset($tables[$table_id])) {
        global $obl_log, $obl_error_log;
        if (isset($obl_error_log) && $obl_error_log) {
            $obl_error_log->emit('loot.table_not_found', [
                'table_id' => $table_id,
            ], 'command');
        }
        return [];
    }
    $table = $tables[$table_id];

    // 3. entries 上限校验
    $total_entries = 0;
    foreach ($table['groups'] as $group) {
        $total_entries += isset($group['entries']) ? count($group['entries']) : 0;
    }
    if ($total_entries > OBL_LOOT_MAX_ENTRIES) {
        global $obl_error_log;
        if (isset($obl_error_log) && $obl_error_log) {
            $obl_error_log->emit('loot.entries_exceed_limit', [
                'table_id' => $table_id,
                'total'    => $total_entries,
                'limit'    => OBL_LOOT_MAX_ENTRIES,
            ], 'command');
        }
        return [];
    }

    // 4. 遍历 groups 累积物品实例
    $items = [];
    foreach ($table['groups'] as $group) {
        $group_items = obl_roll_group($group, $context);
        foreach ($group_items as $it) {
            $items[] = $it;
        }
    }

    // 5. 统一应用耐久衰减
    if (!empty($table['durability_decay'])) {
        obl_apply_durability_decay($items);
    }

    return $items;
}

/**
 * 单组掷骰
 *
 * 流程：
 *   1. 组级 chance 判定（失败返回空数组）
 *   2. 组内 entries 按 weight 加权选择一个 entry
 *   3. 按 count 生成物品实例（stackable 单实例 + itms=count；非 stackable 多实例）
 *
 * @param array $group   组配置（chance + entries）
 * @param array $context 运行时上下文
 * @return array 物品实例列表
 */
function obl_roll_group($group, $context) {
    $chance = isset($group['chance']) ? (float)$group['chance'] : 1.0;
    if ($chance <= 0) return [];
    if ($chance < 1.0 && (mt_rand() / mt_getrandmax()) > $chance) return [];

    $entries = isset($group['entries']) ? $group['entries'] : [];
    if (empty($entries)) return [];

    // 加权选择 entry
    $entry = obl_weighted_pick($entries);

    // 解析 count
    $count = isset($entry['count']) ? $entry['count'] : 1;
    if (is_array($count)) {
        $lo = isset($count[0]) ? (int)$count[0] : 1;
        $hi = isset($count[1]) ? (int)$count[1] : $lo;
        if ($hi < $lo) { $tmp = $lo; $lo = $hi; $hi = $tmp; }
        $n = rand($lo, $hi);
    } else {
        $n = max(1, (int)$count);
    }

    // 实例化
    $item_id = isset($entry['item_id']) ? (string)$entry['item_id'] : '';
    if ($item_id === '') return [];

    $item_table = include GAME_ROOT . './oblivions/gamedata/item_table.php';
    if (!isset($item_table[$item_id])) {
        global $obl_error_log;
        if (isset($obl_error_log) && $obl_error_log) {
            $obl_error_log->emit('loot.item_template_missing', [
                'item_id' => $item_id,
            ], 'command');
        }
        return [];
    }
    $template = $item_table[$item_id];

    $is_stack = !empty($template['stack']);
    $items = [];

    if ($is_stack) {
        // 可堆叠：单实例，itms=count（受 stack_limit 上限）
        $stack_limit = isset($template['stack_limit']) ? (int)$template['stack_limit'] : 1;
        $remaining = $n;
        while ($remaining > 0) {
            $batch = min($remaining, $stack_limit);
            $instance = obl_instantiate_item($template, $item_id);
            $instance['itms'] = (string)$batch;
            $items[] = $instance;
            $remaining -= $batch;
        }
    } else {
        // 不可堆叠：多实例，每个 itms=模板 itms
        for ($i = 0; $i < $n; $i++) {
            $items[] = obl_instantiate_item($template, $item_id);
        }
    }

    return $items;
}

/**
 * 加权随机选择一个 entry
 * weight 全 0 时随机选一个（避免除零）
 *
 * @param array $entries entries 列表
 * @return array 选中的 entry
 */
function obl_weighted_pick($entries) {
    $total_weight = 0;
    foreach ($entries as $e) {
        $total_weight += isset($e['weight']) ? (float)$e['weight'] : 1.0;
    }

    if ($total_weight <= 0) {
        // 全 0 权重：均匀随机选一个
        return $entries[array_rand($entries)];
    }

    $r = mt_rand() / mt_getrandmax() * $total_weight;
    $cum = 0;
    foreach ($entries as $e) {
        $w = isset($e['weight']) ? (float)$e['weight'] : 1.0;
        $cum += $w;
        if ($r <= $cum) return $e;
    }
    return $entries[count($entries) - 1];
}

/**
 * 从模板实例化物品（itempara 七字段结构）
 *
 * itm 留空：新实例遵循约定，前端通过 itmid 查 locale 渲染名称
 * itmpara 从模板拷贝（默认空数组）
 *
 * @param array  $template 模板（item_table.php 的 entry）
 * @param string $item_id  物品 ID
 * @return array 物品实例
 */
function obl_instantiate_item($template, $item_id) {
    $itmpara = isset($template['itmpara']) ? $template['itmpara'] : '';
    if (!is_array($itmpara)) {
        $decoded = $itmpara !== '' ? json_decode((string)$itmpara, true) : [];
        $itmpara = is_array($decoded) ? $decoded : [];
    }
    return [
        'itm'     => '',
        'itmk'    => (string)$template['itmk'],
        'itme'    => (int)$template['itme'],
        'itms'    => (string)$template['itms'],
        'itmsk'   => (string)$template['itmsk'],
        'itmpara' => $itmpara,
        'itmid'   => (string)$item_id,
    ];
}

/**
 * 应用耐久度衰减（引用修改）
 *
 * 衰减规则（基于 itms 双模型语义）：
 *   - stack=true（数量模型，材料/消耗品）：跳过（itms 是堆叠数量，非耐久）
 *   - stack=false（耐久模型，装备/工具）：
 *       - itms='∞'：保留 ∞（无限耐久，如指南针）
 *       - itms 为数值且 > 0：随机 [1, itms]
 *       - itms=0：保留 0（防御性，模板不应出现）
 *
 * @param array &$items 物品实例列表
 */
function obl_apply_durability_decay(&$items) {
    $item_table = include GAME_ROOT . './oblivions/gamedata/item_table.php';

    foreach ($items as &$item) {
        $item_id = isset($item['itmid']) ? $item['itmid'] : '';
        if (!isset($item_table[$item_id])) continue;

        $template = $item_table[$item_id];
        if (!empty($template['stack'])) continue;  // 数量模型跳过

        $itms = (string)$item['itms'];
        if ($itms === '∞') continue;               // 无限耐久保留

        $max = (int)$itms;
        if ($max <= 0) continue;                    // 0 或负值保留

        // 随机 [1, max]：模拟"被丢弃前已用过一段时间"
        $item['itms'] = (string)rand(1, $max);
    }
    unset($item);
}
```

**辅助常量**（在 `loot.engine.func.php` 顶部用 `if (!defined(...)) define(...)` 定义，避免依赖外部文件加载顺序）：

```php
if (!defined('OBL_LOOT_MAX_ENTRIES')) {
    define('OBL_LOOT_MAX_ENTRIES', 100);
}
```

### 2.5 掷骰算法

**顶层流程（obl_roll_loot_table）**：

```
1. 解析 context.loot_table_override（可选，工具/技能路由覆盖）
2. 加载 loot_tables.php，查表
   ├─ 表不存在 → emit error，返回 []
   └─ 表存在 → 继续
3. entries 总数校验（≤ OBL_LOOT_MAX_ENTRIES）
   ├─ 超限 → emit error，返回 []
   └─ 通过 → 继续
4. 遍历 groups：
   └─ group_items = obl_roll_group(group, context)
      └─ 累积到 items 列表
5. 若表 durability_decay=true → obl_apply_durability_decay(items)
6. 返回 items
```

**单组流程（obl_roll_group）**：

```
1. chance 判定
   ├─ chance <= 0 → 返回 []
   ├─ chance < 1.0 且随机数 > chance → 返回 []
   └─ 通过 → 继续
2. entries 为空 → 返回 []
3. 加权选择 entry = obl_weighted_pick(entries)
4. 解析 count（int 或 [min,max]，min>max 自动 swap）
5. 加载 item_table，校验 item_id 存在
   ├─ 不存在 → emit error，返回 []
   └─ 存在 → 继续
6. 实例化：
   ├─ stackable → 单实例，itms=count（超 stack_limit 分批）
   └─ 非 stackable → count 个独立实例，各 itms=模板 itms
7. 返回实例列表
```

**加权选择算法（obl_weighted_pick）**：

```
total = Σ weight(entry)
若 total <= 0：
    均匀随机选一个（避免除零，全 0 权重的兜底）
否则：
    r = random() * total
    累加 cum，第一个 cum >= r 的 entry 选中
```

**关键不变量**：

- 每组至多产生一个 entry 的物品（互斥语义）
- 组间独立掷骰（不互斥，多组可同时出货）
- stackable 物品的 count 直接作为 itms（修正旧 obl_search_poi 对 bread 等 stackable 物品的 N×模板itms 缺陷）
- 非 stackable 物品的 count 作为实例数（生成 N 个独立实例）

### 2.6 耐久度衰减算法

**衰减适用性判定**（基于 itms 双模型）：

[item_table.php](file:///d:/wamp64/www/phpdts/oblivions/gamedata/item_table.php) 的 itms 字段承载两种语义，由 `stack` 字段区分：

| stack | itms 语义 | 物品类别示例 | 衰减行为 |
|-------|----------|-------------|---------|
| true | 数量（堆叠数） | MT 材料、HH/HS/DX 消耗品 | **跳过**（itms 是数量，非耐久） |
| false | 最大耐久 | WP/WK/WG/WD/WF/WC 武器、AR/AH/AF/AA 防具 | **应用衰减** |
| false | 使用次数 | TK 工具（如开锁器 itms=5） | **应用衰减**（与装备同语义） |
| false | ∞ 无限 | TK 工具（如指南针 itms='∞'） | **保留 ∞** |

**衰减算法**：

```
对每个 item in items:
    template = item_table[item.itmid]
    if template.stack == true: continue              # 数量模型跳过
    itms = item.itms
    if itms == '∞': continue                         # 无限耐久保留
    max = intval(itms)
    if max <= 0: continue                            # 0 或负值保留（防御性）
    item.itms = rand(1, max)                         # 随机 [1, max]
```

**为何用 `stack` 字段而非 itms=0 判定**：

调研 [item_table.php](file:///d:/wamp64/www/phpdts/oblivions/gamedata/item_table.php) 发现，材料类道具（MT）的模板 itms=1（非 0），消耗品（HH/HS/DX）的模板 itms=1 或 3（如 supply_pack itms=3）。若按"itms=0 跳过"判定，材料与消耗品会被错误地应用衰减（itms=1 → rand(1,1)=1，看似无害但语义错误；itms=3 → rand(1,3) 会随机减少补给包数量，破坏游戏体验）。

`stack` 字段是 itms 双模型的权威区分信号——`stack=true` 恒为数量模型，`stack=false` 恒为耐久/次数模型。以 `stack` 作为衰减适用性的主判定，避免 itms 数值误判。

**与原始设计案 §8.4 的对齐**：

> 通过搜刮获得的物品，其耐久度通常是衰减过的。系统会在物品原有最大耐久度范围内随机取一个值。

本算法严格按"原有最大耐久度范围内随机"实现：`rand(1, max)` 其中 max 为模板 itms。对无限耐久（∞）和数量模型（stackable）特例化处理，避免破坏其他语义。

### 2.7 与调用方（E-7 / E-10）的接口契约

**职责边界**：F-4 仅负责"掷骰生成物品实例列表"，不负责物化（INSERT oblmapitem、`source_iaid` 归属标记、`discovered` 标记、`loot_dropped` 响应字段等都属于 E-7 / E-10 调用方的物化逻辑）。本节明确双方契约。

**F-4 接口**：

```php
/**
 * 掷战利品表，返回物品实例列表
 *
 * @param string $table_id  战利品表 ID（loot_tables.php 的 key）
 * @param array  $context   运行时上下文（可选）：
 *                          - loot_table_override: string 覆盖表 ID（工具/技能路由）
 *                          - player_skills: array 玩家技能（预留，未来 E-10 使用）
 *                          - search_count: int POI 搜索次数（预留，衰减判定）
 * @return array 物品实例列表，每项为 itempara 七字段：
 *               ['itm','itmk','itme','itms','itmsk','itmpara','itmid']
 *               itm 留空（前端通过 itmid 查 locale 渲染名称）
 *               itmpara 为数组（已 json_decode，空 itmpara 为 []）
 *               itms 为字符串（保留 '∞' 字符串）
 *               可能为空数组（空表、全 0 概率、表不存在等）
 */
function obl_roll_loot_table($table_id, $context = []) { ... }
```

**调用方契约**（E-7 / E-10）：

1. **表 ID 即 POI ID**：调用方传入 `$poi_id` 作为 `$table_id`（POI 模板与战利品表共用同一命名空间，如 `medical_supplies` 既是 POI ID 也是 loot table ID），消除旧 [poi_loot.php](file:///d:/wamp64/www/phpdts/oblivions/gamedata/poi_loot.php) 的间接映射层
2. **工具/技能路由覆盖**：调用方从 POI 模板或工具/技能判定中读取 `loot_table_override` / `repeat_loot_table_override`，通过 `context['loot_table_override']` 传入；F-4 优先使用覆盖值
3. **物化由调用方负责**：F-4 返回 items 数组后，调用方自行决定物化策略（直接 INSERT oblmapitem、JSON 暂存、丢弃等）。`source_iaid` / `discovered` / `loot_dropped` 等字段与响应都属于调用方范畴
4. **物化字段映射建议**：调用方 INSERT 时建议按 F-1 itempara 七字段对齐：
   - `itm` ← `$item['itm']`（空字符串）
   - `itmk` ← `$item['itmk']`
   - `itme` ← `(int)$item['itme']`
   - `itms` ← `(string)$item['itms']`（保留 '∞'）
   - `itmsk` ← `$item['itmsk']`
   - `itmpara` ← `json_encode($item['itmpara'])`（数组转字符串，空数组写空字符串）
   - `item_id` ← `$item['itmid']`

**E-7 / E-10 落地节奏**：

| 阶段 | 调用方 | 说明 |
|------|--------|------|
| F-4 落地 | 无（仅引擎就绪） | F-4 引擎与配置可用，但 obl_search_poi 仍走旧 poi_loot.php 内联循环；E-7/E-10 后续接入时切换调用 |
| E-7 接入（过渡） | obl_search_poi 第 8 步替换为 `obl_roll_loot_table` 调用 + 调用方物化 | 物化策略由 E-7 设计案决定 |
| E-10 三档判定 | `obl_e10_roll_normal_loot` 第三档调用 F-4 | 三档判定 + 物化由 E-10 设计案决定 |

F-4 不预设物化策略，留给 E-7 / E-10 设计案自由选择（直接物化、JSON 暂存、或其他方式），保持 F-4 引擎纯净。

### 2.8 与 F-1 拾取流程的对齐

F-4 产出的物品实例格式与 [F-1 拾取流程](file:///d:/wamp64/www/phpdts/oblivions/include/game/item/item.basic.func.php) 期望的 itempara 七字段结构完全对齐：

| 字段 | F-4 输出 | F-1 obl_pickup_item 期望 | 说明 |
|------|---------|-------------------------|------|
| `itm` | `''`（空字符串） | `''`（空字符串） | 实例不写死名称，前端通过 `itmid` 查 locale 渲染 |
| `itmk` | `(string)$template['itmk']` | 原样 | 类别（WP/WK/.../MT/HH/HS/DX/TK/SP） |
| `itme` | `(int)$template['itme']` | `(int)$item['itme']` | 数值（攻击/防御/恢复/素材价值） |
| `itms` | `(string)$template['itms']` 或 `(string)$batch` 或 `(string)rand(1,$max)` | 原样（含 '∞'） | 数量模型（stackable）或耐久模型（非 stackable），衰减后已是字符串 |
| `itmsk` | `(string)$template['itmsk']` | 原样 | 技能键 |
| `itmpara` | 数组（json_decode 后） | 数组（json_decode 后） | 默认空数组 `[]` |
| `itmid` | `(string)$item_id` | `(string)$item['item_id']` | 物品模板 ID（item_table.php 的 key） |

**对齐验证**：F-1 `obl_pickup_item` 第 537-548 行从 oblmapitem 读取 itmpara 后 `json_decode` 为数组；调用方物化时将 F-4 的 itmpara 数组 `json_encode` 写入 oblmapitem，闭环对称。

F-4 不直接调用 F-1，调用方物化后玩家通过现有 `item.pickup` 命令拾取（与野生道具流程完全一致，复用现有命令路径，不新增命令）。

### 2.9 物品上限扩容配置

**常量**：`OBL_LOOT_MAX_ENTRIES = 100`

定义位置：`oblivions/include/game/loot/loot.engine.func.php` 顶部 `if (!defined(...)) define(...)`（与引擎实现就近，避免依赖外部文件加载顺序）。

**校验时机**：`obl_roll_loot_table` 加载表时统计 `Σ count(group.entries)`，超限则 emit `loot.entries_exceed_limit` 错误并返回空数组。

**为何 100**：

| 因素 | 分析 |
|------|------|
| 单次掷骰性能 | 100 entries 全遍历 + 加权选择 = O(100)，PHP 单次 < 1ms，无性能压力 |
| 配置可维护性 | 100 entries 足以表达任意复杂 POI（医疗/武器/素材分区 + 各区互斥选项），超过则配置过载 |
| 旧结构对比 | 旧 [poi_loot.php](file:///d:/wamp64/www/phpdts/oblivions/gamedata/poi_loot.php) 单表最多 4 条 entry（扁平 rate 平铺），新结构 100 是 25 倍扩容 |
| 外部参考 | [loot_tables.json](file:///d:/wamp64/www/phpdts/oblivions/docs/原始方案/loot_tables.json) 764 张表中，单表 entries 最大约 20-30（含 nested），扁平化后估算 50-80，100 留余量 |

**超限处理策略**：

- **不截断**：超限即 emit error 返回空数组，强制配置者修正。避免静默截断导致概率分布失真
- **配置期校验**（推荐）：未来在 `oblivions/tools/` 下新增 `validate_loot_tables.php` 校验脚本，CI 阶段扫描所有表，超限报错

### 2.10 具体案例

#### 案例 A：医疗物资表（典型三组互斥）

配置见 2.3 节 `medical_supplies`。掷骰示例（玩家搜刮医疗 POI）：

```
组 1（chance=1.0）：必掷骰
  entries: health_potion(w60) / stamina_potion(w30) / antidote(w10)
  → 加权选择：r=0.45*100=45，cum=60 ≥ 45 → 选中 health_potion
  → count=1，stackable，生成 1 实例 itms=1

组 2（chance=0.5）：50% 掷骰
  → 随机数 0.3 < 0.5 → 通过
  entries: swamp_herb(w100)
  → 唯一选项，选中
  → count=[1,3]，rand(1,3)=2，stackable，生成 1 实例 itms=2

组 3（chance=0.2）：20% 掷骰
  → 随机数 0.8 > 0.2 → 跳过

items = [health_potion(itms=1), swamp_herb(itms=2)]

durability_decay=true → 应用衰减：
  health_potion: stack=true → 跳过（数量模型）
  swamp_herb:    stack=true → 跳过（数量模型）

最终 items = [health_potion(itms=1), swamp_herb(itms=2)]
F-4 返回此 items 数组，物化（INSERT oblmapitem）由调用方（E-7/E-10）负责
```

#### 案例 B：废料堆掉落（纯素材 + 装备混出）

配置见 2.3 节 `scrap_pile_loot`。掷骰示例：

```
组 1（chance=1.0）：必掷骰
  entries: scrap_metal(w50) / rusty_gear(w30) / cloth(w20)
  → 选中 scrap_metal
  → count=[2,5]，rand(2,5)=4，stackable(stack_limit=10)，生成 1 实例 itms=4

组 2（chance=0.3）：30% 掷骰
  → 随机数 0.15 < 0.3 → 通过
  entries: rusty_pipe(w100)
  → 选中 rusty_pipe
  → count=1，非 stackable，生成 1 实例 itms=20（模板耐久）

items = [scrap_metal(itms=4), rusty_pipe(itms=20)]

durability_decay=false → 不应用衰减

最终 items = [scrap_metal(itms=4), rusty_pipe(itms=20)]
```

#### 案例 C：耐久衰减生效（装备表）

假设新增配置：

```php
'weapon_cache' => [
    'name' => '武器储藏点',
    'durability_decay' => true,
    'groups' => [
        ['chance' => 1.0, 'entries' => [
            ['item_id' => 'rusty_pipe',    'weight' => 50, 'count' => 1],
            ['item_id' => 'scrap_blade',   'weight' => 30, 'count' => 1],
            ['item_id' => 'swamp_spear',   'weight' => 20, 'count' => 1],
        ]],
    ],
],
```

掷骰示例：

```
组 1：选中 swamp_spear（itmk=WK, stack=false, itms=25）
items = [swamp_spear(itms=25)]

durability_decay=true → 应用衰减：
  swamp_spear: stack=false → 应用
  itms=25（数值 > 0）→ rand(1,25)=13

最终 items = [swamp_spear(itms=13)]
```

物品以 13/25 的耐久度由 F-4 返回给调用方，模拟"被丢弃前已用过一段时间"。物化由 E-7/E-10 负责。

#### 案例 D：F-4 与调用方集成的完整时序（仅 F-4 职责部分）

```
1. 玩家点击"搜刮医疗物资" → 前端发 poi.search 命令
2. obl_command_handler_dispatch → obl_search_poi(iaid=42, $pdata)（或未来 E-10 第三档判定）
3. 调用方（obl_search_poi / E-10）：
   a. 读取 POI 实例（iaid=42, poi_id='medical_supplies'）
   b. 加载 POI 模板（searchable=true）
   c. 构建 context（可选 loot_table_override 等）
   d. 调用 F-4 引擎：$items = obl_roll_loot_table('medical_supplies', $context)
      ├─ F-4 加载 loot_tables.php['medical_supplies']
      ├─ F-4 遍历 groups，逐组掷骰（chance 判定 + weight 加权选择 + count 实例化）
      ├─ F-4 应用耐久衰减（durability_decay=true 时）
      └─ F-4 返回 [health_potion(itms=1), rust_circlet(itms=8)]
   ── F-4 职责到此为止 ──
   e. 调用方负责物化（INSERT oblmapitem、discovered 标记、source_iaid 归属等，由 E-7/E-10 设计案决定）
   f. 调用方负责 POI 状态更新（UPDATE bra_oblmappoi SET searched=1, search_count=search_count+1）
   g. 调用方负责 emit 日志与响应字段（loot_dropped 等）
4. 玩家拾取通过现有 item.pickup 命令（由调用方物化策略决定是否立即拾取或先暂存）
```

F-4 仅负责步骤 3.d 的"掷骰返回 items 数组"，其他步骤均由调用方（E-7 / E-10）负责。

### 2.11 边界案例

F-4 引擎内部边界（与物化无关）：

| 边界场景 | 触发条件 | 引擎行为 |
|---------|---------|---------|
| **空表（无 groups）** | `groups` 为空数组或缺失 | obl_roll_loot_table 跳过组遍历，返回 `[]` |
| **全 0 概率组（chance=0）** | `chance => 0` | obl_roll_group 直接返回 `[]`，不掷骰 |
| **chance > 1.0** | 配置错误 | 按 1.0 处理（`chance < 1.0` 判定不通过则视为必掷骰） |
| **count 区间反向（min > max）** | `count => [5, 2]` | obl_roll_group 自动 swap 为 [2, 5]，rand(2, 5) |
| **count 为 0 或负数** | `count => 0` 或 `count => -1` | `max(1, (int)$count)` 兜底为 1 |
| **weight 全 0** | 所有 entries 的 `weight => 0` | obl_weighted_pick 检测 `total_weight <= 0`，均匀随机选一个（`array_rand`），避免除零 |
| **weight 为负数** | `weight => -5` | 累加为负，可能导致 `r <= cum` 永远成立或永不成立；建议配置期校验拒绝负权重（运行时不显式拦截，依赖校验脚本） |
| **entries 为空** | `entries => []` | obl_roll_group 返回 `[]` |
| **物品模板不存在** | `item_id` 不在 item_table.php | obl_roll_group emit `loot.item_template_missing` 错误，返回 `[]`（该组不出货，不影响其他组） |
| **表 ID 不存在** | `table_id` 不在 loot_tables.php | obl_roll_loot_table emit `loot.table_not_found` 错误，返回 `[]` |
| **entries 超限** | `Σ count(group.entries) > 100` | obl_roll_loot_table emit `loot.entries_exceed_limit` 错误，返回 `[]` |
| **耐久衰减遇 itms=∞** | 工具类如指南针（itms='∞'） | obl_apply_durability_decay 检测 `itms === '∞'`，跳过保留 ∞ |
| **耐久衰减遇 itms=0** | 模板配置异常（itms=0） | `max <= 0` 跳过，保留 0（防御性，模板不应出现） |
| **耐久衰减遇 stackable** | 材料/消耗品（stack=true） | 跳过（itms 是数量，非耐久） |
| **耐久衰减遇非数值 itms** | itms 为非法字符串 | `(int)$itms` 转为 0，`max <= 0` 跳过，保留原值 |
| **stackable count 超过 stack_limit** | `count=15, stack_limit=10` | 分批生成：第一实例 itms=10，第二实例 itms=5；调用方物化后玩家拾取时 F-1 自动合并 |
| **loot_table_override 覆盖** | context 指定 `loot_table_override` | obl_roll_loot_table 优先使用覆盖值，跳过原 table_id |
| **单次掷骰产出大量物品** | 多组同时出货 + count 较大 | 当前不截断，全部返回给调用方；调用方自行决定物化策略（直接物化、暂存等）。未来可配置 `max_yield_per_roll` 软上限（设计决策：当前不实现） |

物化相关边界（INSERT 失败、背包满、并发搜索、source_iaid 查询、未拾取保留等）均由 E-7 / E-10 设计案承担，不属于 F-4 引擎职责。

---

## 三、迁移与落地

### 3.1 旧 poi_loot.php 迁移映射

旧扁平结构 → 新 groups 结构的迁移规则：

| 旧字段 | 新字段 | 迁移逻辑 |
|--------|--------|---------|
| 顶层 key (POI ID) | 顶层 key (POI ID) | 保持不变 |
| `loot` / `repeat_loot` | 由 POI 模板的 `loot_table` / `repeat_loot_table` 字段指向 loot_tables.php 的表 ID | 旧结构按 POI ID 直接索引 loot/repeat_loot；新结构按 POI ID 查 loot_tables.php，repeat 通过 POI 模板字段或命名约定（如 `{poi_id}_repeat`）区分 |
| `['item_id','count','rate']` | 一个 group 含一个 entry | 每条旧 entry → 一个独立 group（chance=rate, entries=[{item_id, weight=1, count}]） |
| 多条 entry 独立判定 | 多个 group 各自掷骰 | 旧结构多条 entry 可能同时出货 → 新结构多个 group 也可能同时出货，语义等价 |
| 无耐久衰减 | `durability_decay => false` | 旧结构不衰减，迁移时默认 false；按表语义决定是否开启 |

**迁移示例**：

旧：
```php
'supply_cache' => [
    'loot' => [
        ['item_id' => 'supply_pack',    'count' => [2,4],  'rate' => 1.0],
        ['item_id' => 'health_potion',  'count' => [1,2],  'rate' => 0.6],
    ],
],
```

新：
```php
'supply_cache' => [
    'name' => '补给箱',
    'durability_decay' => false,
    'groups' => [
        ['chance' => 1.0, 'entries' => [
            ['item_id' => 'supply_pack', 'weight' => 1, 'count' => [2, 4]],
        ]],
        ['chance' => 0.6, 'entries' => [
            ['item_id' => 'health_potion', 'weight' => 1, 'count' => [1, 2]],
        ]],
    ],
],
```

**语义升级机会**：迁移时若发现多条 entry 是同类互斥（如多种药品选一），应合并为单个 group 的多个 entries，用 weight 表达互斥选择，而非保留多个独立 group。

### 3.2 落地步骤

1. **新增配置文件** `oblivions/gamedata/loot_tables.php`，按 2.3 格式编写（含 3-5 张示例表）
2. **新增引擎文件** `oblivions/include/game/loot/loot.engine.func.php`，按 2.4 实现（含顶部 `OBL_LOOT_MAX_ENTRIES` 常量定义）
3. **修改 [obl_bootstrap.php](file:///d:/wamp64/www/phpdts/oblivions/include/core/obl_bootstrap.php)**：第 5.5 层 item 系统加载后追加 `require_once GAME_ROOT . './oblivions/include/game/loot/loot.engine.func.php';`
4. **运行语法校验**：`php -l oblivions/gamedata/loot_tables.php` 与 `php -l oblivions/include/game/loot/loot.engine.func.php`
5. **运行锚点校验**：`php oblivions/tools/validate_design_anchors.php --module=F`（校验器尚未实现时跳过，依赖步骤 4 的语法校验与人工审阅）
6. **沉淀 Dian.md**：按 AGENTS.md 要求更新 F-4 代码锚点指向新文件路径

**不在 F-4 落地范围的步骤**（留给 E-7 / E-10）：

- 修改 [explore.func.php](file:///d:/wamp64/www/phpdts/oblivions/include/game/explore.func.php) obl_search_poi 第 8 步：替换内联掉落循环为 `obl_roll_loot_table` 调用 + 调用方物化策略
- 修改 [oblmapitem.sql](file:///d:/wamp64/www/phpdts/oblivions/sql/oblmapitem.sql)：新增 `source_iaid` 列（如 E-10 选择直接物化策略）
- 扩展 poi.inspect 响应：`unpicked_loot` 字段（如 E-10 选择直接物化策略）
- 迁移旧 [poi_loot.php](file:///d:/wamp64/www/phpdts/oblivions/gamedata/poi_loot.php) 配置 → loot_tables.php（按 3.1 规则；E-10 接入时同步完成）
- 删除 poi_loot.php（迁移完成且无引用后由 E-10 决定）

**全量严格校验**：F-4 + E-7 + E-10 全部落地后，统一运行 `php oblivions/tools/validate_design_anchors.php` 严格模式（校验器实现后）。

### 3.3 不实现项（明确排除）

| 项 | 原因 | 未来扩展点 |
|----|------|-----------|
| 容器类型道具 | 用户明确约束去除 | 原始设计案 §8.3 占位 |
| 容器装填机制 | 用户明确约束去除 | 原始设计案 §8.3 占位 |
| 嵌套表递归展开 | 用户明确约束去除 | 原始设计案 §8.2 占位 |
| 循环检测 | 无嵌套表 → 无循环引用 | 嵌套表落地时新增 |
| 抑制标志（suppress） | 外部游戏语义，本游戏不适用 | loot_tables.json 字段忽略 |
| 鉴定标志（identify） | 外部游戏语义，本游戏不适用 | loot_tables.json 字段忽略 |
| 保底掉落计数器 | 属于 E-10 三档判定范畴，非 F-4 职责 | E-10 落地时实现 |
| 意外事件池 | 属于 E-10 三档判定范畴，非 F-4 职责 | E-10 落地时实现 |
| max_yield_per_roll 软上限 | 当前不截断，依赖背包满兜底 | 未来按需引入 |

---

## 四、设计自校准

按 [DESIGN.md 第三节设计哲学](file:///d:/wamp64/www/phpdts/oblivions/DESIGN.md) 校准：

| 设计哲学 | F-4 的体现 |
|---------|-----------|
| 配置驱动 | 战利品表是纯数据（loot_tables.php），引擎是通用函数（loot.engine.func.php）。新增表无需改引擎代码 |
| 单一职责 | F-4 仅负责"掷骰生成物品实例"，不负责拾取（F-1）、不负责 POI 状态（E-7）、不负责三档判定（E-10） |
| 边界明确 | 空表/全 0 概率/weight 全 0/模板缺失/超限 等边界均有显式处理，不依赖隐式行为 |
| 与 F-1/F-2/F-3 正交 | F-4 产出的物品实例格式与 F-1 itempara 七字段对齐，可直接经 F-1 拾取流程入背包；不与 F-2 合成、F-3 使用效果耦合 |
| 去除冗余抽象 | 无容器、无嵌套、无递归展开——按用户约束剥离原始设计案的占位复杂度，聚焦"物品组+互斥+衰减"核心 |
| 数据双向锚点 | loot.engine.func.php 同步 `@module F` + `@framework F-4`；loot_tables.php 同步 `@module F`；Dian.md 同步代码锚点 |
