# Oblivions NPC 敌人系统设计案

> 为 Oblivions 模式引入 NPC 敌人，作为战斗系统的前置依赖。
>
> **依赖**：本设计案依赖《Oblivions 玩家系统与游戏刻机制设计案》（oblplayers 表、认证函数、游戏刻机制、结构化日志）。
>
> **设计原则**：
> - NPC AI 独立实现，不调用旧模式 bot_acts，参考其逻辑但用 Oblivions 兼容的函数
> - NPC 数据与玩家同构，统一存 `bra_oblplayers` 表，通过 `type` 字段区分
> - NPC 完全独立于 `bra_players`，不产生任何关联

---

## 一、设计目标

### 1.1 核心目标

1. **NPC 敌人生成**：游戏初始化时按潮汐区配置生成，分配到区域和地图格
2. **NPC AI 行为**：移动、发呆、追击，与 Oblivions 网格地图兼容（不涉及战斗结算）
3. **发现机制**：玩家探索发现敌人，敌人移出视野后静默消失
4. **突袭机制**：敌人移动到玩家所在格，设置 `action='battle'`（战斗结算留待战斗系统）
5. **enemies API**：返回当前区域已发现的敌人
6. **前端显示**：地图上显示敌人标记
7. **结构化日志**：NPC 相关事件通过 `$obl_log->emit()` 输出

### 1.2 非目标

- **战斗系统**：本设计案不实现战斗结算，突袭只设置 `action='battle'` + emit 日志
- **技能系统**：skillpara 预留字段，不定义技能内容
- **NPC 间战斗**：MVP 不实现 NPC 互相攻击
- **多区域 NPC 迁移**：MVP 阶段 NPC 固定在生成区域
- **NPC 死亡处理**：战斗系统实现后处理（死亡标记 `state>0`，保留装备/道具栏供玩家搜刮）
- **尸体搜刮**：NPC 死后保留自身装备/道具栏，玩家可从尸体摸东西（战斗系统实装后实现）

---

## 二、NPC 数据格式

### 2.1 敌人类型配置（`oblivions/gamedata/enemies_config.php`）

定义每种敌人的静态属性。与 `item_table.php` / `poi_table.php` 同层，只定义属性，不关心分布。

```php
<?php
if (!defined('IN_GAME')) { exit('Access Denied'); }

$obl_enemies_config = array(
    // 敌人类型 ID => 配置
    1 => array(
        'name' => '废铁史莱姆',
        'icon' => 'enemy_slime',
        'gd' => 'm',
        'hp' => 50, 'mhp' => 50,
        'sp' => 10, 'msp' => 10,
        'att' => 8, 'def' => 3,
        'lvl' => 1,
        'ai_type' => 'patrol',        // AI 类型：patrol/aggressive/idle
        'vision_range' => 3,           // 感知范围（BFS 跳数）
        'action_chance' => 0.4,        // 行动意愿（每 tick 行动概率，0-1）
        'skills' => ['basic_attack', 'escape'],
        'strategy_slots' => array(     // 初始策略槽（4 槽）
            array('type' => 'skill', 'id' => 'basic_attack'),
            null, null, null
        ),
    ),
    2 => array(
        'name' => '锈蚀守卫',
        'icon' => 'enemy_guard',
        'gd' => 'm',
        'hp' => 80, 'mhp' => 80,
        'sp' => 15, 'msp' => 15,
        'att' => 12, 'def' => 8,
        'lvl' => 2,
        'ai_type' => 'aggressive',
        'vision_range' => 5,
        'action_chance' => 0.7,
        'skills' => ['basic_attack', 'escape'],
        'strategy_slots' => array(
            array('type' => 'skill', 'id' => 'basic_attack'),
            array('type' => 'skill', 'id' => 'basic_attack'),
            null, null
        ),
    ),
);
```

**字段说明**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | string | 敌人名称 |
| `icon` | string | 图标标识（前端用于拼接头像路径） |
| `gd` | string | 性别（m/f，影响头像） |
| `hp/mhp/sp/msp/att/def` | int | 战斗属性 |
| `lvl` | int | 等级 |
| `ai_type` | string | AI 类型：`patrol`（巡逻）/ `aggressive`（激进）/ `idle`（发呆） |
| `vision_range` | int | 感知范围（BFS 跳数），NPC 发现玩家的范围 |
| `action_chance` | float | 行动意愿（0-1），每 tick 通过随机数决定是否行动 |
| `skills` | array | 初始技能列表（skillpara 预留） |
| `strategy_slots` | array | 初始策略槽（4 槽，空槽默认填"逃跑"） |

### 2.2 敌人生成池（`oblivions/gamedata/enemy_pool.php`）

按潮汐区分桶，控制每个潮汐区生成哪些敌人 + 数量。与 `scatter_pool.php` / `poi_pool.php` 完全对齐。

```php
<?php
if (!defined('IN_GAME')) { exit('Access Denied'); }

return [
    // ─── 浅水区 (shallow) ──────────────────────────────────
    'shallow' => [
        ['enemy_type' => 1, 'count' => [3, 5]],  // 废铁史莱姆 3-5 个
        ['enemy_type' => 2, 'count' => [1, 2]],  // 锈蚀守卫 1-2 个
    ],

    // ─── 深水区 (deep) ──────────────────────────────────
    'deep' => [
        ['enemy_type' => 2, 'count' => [3, 5]],
        // ['enemy_type' => 3, 'count' => [1, 3]],  // 未来扩展更强的敌人
    ],

    // ─── 深渊区 (abyss) ──────────────────────────────────
    'abyss' => [
        // ['enemy_type' => 3, 'count' => [4, 6]],
    ],
];
```

**生成规则**：
- `count` 为 `[min, max]` 区间，初始化时随机取值
- 每个潮汐区独立配置，互不影响
- 区域的潮汐区由 `tiles/region_{pgroup}.php` 中每个格的 `tide` 字段决定

### 2.3 NPC 在 oblplayers 表中的数据

NPC 与玩家共用 `bra_oblplayers` 表，通过 `type` 字段区分（`type=0` 玩家，`type>0` 敌人类型 ID）。

| 字段 | 来源 | 说明 |
|------|------|------|
| `pid` | 自增 | — |
| `type` | 配置的敌人类型 ID | >0 |
| `name` | 配置的 name | — |
| `pass` | 空 | NPC 不需要认证 |
| `gd/icon` | 配置 | — |
| `action/bid` | 初始空 | 战斗系统用 |
| `hp/mhp/sp/msp/att/def` | 配置 | — |
| `ap/max_ap` | 0 / 10 | 战斗系统用 |
| `pgroup/pls` | 初始化分配 | 见第三节 |
| `lvl/exp` | 配置 / 0 | — |
| `state` | 0 | 0=活着，>0=死法（战斗系统实装后使用） |
| `itempara` | `[null × 7]` | 空道具栏（index 0=特殊槽，1-6=普通槽） |
| `itemmaxslots` | 6 | 道具栏上限 |
| `tacpara` | json_encode(配置的 strategy_slots) | 策略槽 |
| `skillpara` | json_encode({skills: [...]}) | 技能数据 |
| `oblpara` | json_encode({ai_type, vision_range, action_chance}) | AI 配置 |
| `discovered` | 0 | 初始未发现（仅对 NPC 有意义，玩家记录始终为 0） |

**`discovered` 字段语义**：
- 只对 NPC 有意义，玩家记录的 `discovered` 始终为 0
- `discovered=1` 表示玩家可以发现这个 NPC（NPC 在玩家视野内）
- `discovered=0` 表示玩家看不到这个 NPC（NPC 在玩家视野外）
- NPC 发现玩家不依赖 `discovered`，而是依赖自己的 `vision_range`（NPC 的感知范围）

---

## 三、NPC 初始化

### 3.1 生成流程

在 `rs_init_oblivions()` 中调用：

```php
function rs_init_oblivions() {
    // ... 玩家系统设计案的初始化逻辑 ...

    // 新增：生成 NPC 敌人
    obl_init_enemies();
}
```

```php
function obl_init_enemies() {
    global $db, $tablepre;

    // 载入配置
    $enemy_pool = require GAME_ROOT . './oblivions/gamedata/enemy_pool.php';

    // 获取所有区域
    $map = obl_get_map_data();
    $regions = $map['regions'];

    foreach ($regions as $pgroup => $region) {
        // 加载该区域的 tiles（含 tide 字段）
        $map_data = obl_get_map_data($pgroup);
        $tiles = $map_data['tiles'][$pgroup];

        // 统计该区域各潮汐区的格数，按潮汐区分组
        $tide_tiles = array('shallow' => array(), 'deep' => array(), 'abyss' => array());
        foreach ($tiles as $pls => $tile) {
            $tide = isset($tile['tide']) ? $tile['tide'] : 'shallow';
            if (!empty($tile['passable']) && isset($tide_tiles[$tide])) {
                $tide_tiles[$tide][] = $pls;
            }
        }

        // 查询该区域已占用的位置（玩家初始位置 + 已生成的 NPC）
        $occupied = obl_get_occupied_positions($pgroup);

        // 排除出入口
        $occupied[$region['entrance_pls']] = true;
        $occupied[$region['exit_pls']] = true;

        // 按潮汐区生成敌人
        foreach ($tide_tiles as $tide => $available_pls) {
            if (!isset($enemy_pool[$tide]) || empty($available_pls)) continue;

            foreach ($enemy_pool[$tide] as $entry) {
                $enemy_type = $entry['enemy_type'];
                $count = is_array($entry['count'])
                    ? rand($entry['count'][0], $entry['count'][1])
                    : (int)$entry['count'];

                for ($i = 0; $i < $count; $i++) {
                    // 从可用格中随机选一个未被占用的
                    $pls = obl_pick_available_tile($available_pls, $occupied);
                    if ($pls === false) break;  // 该潮汐区格不够

                    obl_create_enemy_record($enemy_type, $pgroup, $pls);
                    $occupied[$pls] = true;  // 标记占用
                }
            }
        }
    }
}
```

### 3.2 生成规则

**每个潮汐区的敌人数量**：由 `enemy_pool.php` 的 `count` 区间随机决定。

**敌人类型选择**：由 `enemy_pool.php` 按潮汐区配置决定，不同潮汐区有不同的敌人组合。

**地图格分配**：
- 只选 `passable=1` 的格
- 排除玩家初始位置（由 `obl_get_occupied_positions` 返回）
- 排除区域出入口（`entrance_pls` / `exit_pls`）
- 排除已被其他单位占用的格（一个格一个单位）
- 敌人只生成在对应潮汐区的格上（浅水区敌人只生成在 `tide=shallow` 的格）

### 3.3 创建敌人记录

参考 [obl_create_player_record](file:///d:/wamp64/www/phpdts/oblivions/include/game/player.func.php) 的实现模式，使用 `$db->array_insert`：

```php
function obl_create_enemy_record($enemy_type, $pgroup, $pls) {
    global $db, $tablepre, $obl_enemies_config;

    $config = $obl_enemies_config[$enemy_type];
    $itemmaxslots = 6;
    $empty_itempara = array_fill(0, $itemmaxslots + 1, null);  // index 0=特殊槽，1-6=普通槽

    $enemy = array(
        'type'   => $enemy_type,
        'name'   => $config['name'],
        'pass'   => '',
        'gd'     => $config['gd'],
        'icon'   => $config['icon'],
        'action' => '',
        'bid'    => 0,
        'hp'     => $config['hp'],
        'mhp'    => $config['mhp'],
        'sp'     => $config['sp'],
        'msp'    => $config['msp'],
        'att'    => $config['att'],
        'def'    => $config['def'],
        'ap'     => 0,
        'max_ap' => 10,
        'pgroup' => $pgroup,
        'pls'    => $pls,
        'lvl'    => $config['lvl'],
        'exp'    => 0,
        'state'  => 0,
        // 装备字段（7 槽 × 6 字段，初始全空）
        'wep' => '', 'wepk' => '', 'wepe' => 0, 'weps' => '0', 'wepsk' => '', 'weppara' => '',
        'wep2' => '', 'wep2k' => '', 'wep2e' => 0, 'wep2s' => '0', 'wep2sk' => '', 'wep2para' => '',
        'arb' => '', 'arbk' => '', 'arbe' => 0, 'arbs' => '0', 'arbsk' => '', 'arbpara' => '',
        'arh' => '', 'arhk' => '', 'arhe' => 0, 'arhs' => '0', 'arhsk' => '', 'arhpara' => '',
        'ara' => '', 'arak' => '', 'arae' => 0, 'aras' => '0', 'arask' => '', 'arapara' => '',
        'arf' => '', 'arfk' => '', 'arfe' => 0, 'arfs' => '0', 'arfsk' => '', 'arfpara' => '',
        'art' => '', 'artk' => '', 'arte' => 0, 'arts' => '0', 'artsk' => '', 'artpara' => '',
        // 道具栏
        'itempara'     => json_encode($empty_itempara, JSON_UNESCAPED_UNICODE),
        'itemmaxslots' => $itemmaxslots,
        // Oblivions 专属 JSON 字段
        'tacpara'   => json_encode(array('slots' => $config['strategy_slots']), JSON_UNESCAPED_UNICODE),
        'skillpara' => json_encode(array('skills' => $config['skills']), JSON_UNESCAPED_UNICODE),
        'oblpara'   => json_encode(array(
            'ai_type'      => $config['ai_type'],
            'vision_range' => $config['vision_range'],
            'action_chance' => $config['action_chance'],
        ), JSON_UNESCAPED_UNICODE),
        'discovered' => 0,
    );

    $db->array_insert("{$tablepre}oblplayers", $enemy);

    // 获取插入的 pid
    $result = $db->query("SELECT pid FROM {$tablepre}oblplayers WHERE type='{$enemy_type}' AND pgroup='{$pgroup}' AND pls='{$pls}' ORDER BY pid DESC LIMIT 1");
    $row = $db->fetch_array($result);
    return $row ? (int)$row['pid'] : false;
}
```

### 3.4 占用位置检查

新增辅助函数，一次性查询区域已占用的位置，避免逐格查询：

```php
/**
 * 获取指定区域所有已占用的 pls（玩家 + NPC）
 * @param int $pgroup 区域 ID
 * @return array {pls => true} 已占用的格集合
 */
function obl_get_occupied_positions($pgroup) {
    global $db, $tablepre;
    $occupied = array();
    $result = $db->query("SELECT pls FROM {$tablepre}oblplayers WHERE pgroup='{$pgroup}' AND state=0");
    while ($row = $db->fetch_array($result)) {
        $occupied[(int)$row['pls']] = true;
    }
    return $occupied;
}

/**
 * 从可用格列表中随机选一个未被占用的
 * @param array $available_pls 可用格 pls 列表
 * @param array &$occupied 已占用格集合（引用传递，选中后会被标记）
 * @return int|false 选中的 pls，无可用格返回 false
 */
function obl_pick_available_tile($available_pls, &$occupied) {
    $candidates = array();
    foreach ($available_pls as $pls) {
        if (!isset($occupied[$pls])) {
            $candidates[] = $pls;
        }
    }
    if (empty($candidates)) return false;
    return $candidates[array_rand($candidates)];
}
```

---

## 四、NPC 行为（不涉及战斗）

### 4.1 新建文件

`oblivions/include/game/enemy_ai.func.php`

### 4.2 AI 决策流程

**核心设计**：
- 每个敌人通过 `action_chance`（行动意愿）概率门控决定是否行动
- NPC 可以在雾中自由移动（不受 `fog` 限制）
- NPC 发现玩家不依赖 `discovered`，而是依赖自己的 `vision_range`
- `state > 0` 的敌人（死亡）跳过 AI 结算
- MVP 只结算当前区域的敌人

```php
<?php
if (!defined('IN_GAME')) { exit('Access Denied'); }

/**
 * 全局结算敌人 AI（在 obl_resolve_tick_events 中调用）
 * MVP 只结算当前区域的敌人
 *
 * @param int $cur_pgroup 当前玩家所在区域
 * @param array &$player 当前玩家数据（$pdata）
 */
function obl_resolve_all_enemy_ai($cur_pgroup, &$player) {
    // 获取当前区域所有敌人
    $enemies = obl_fetch_enemies_by_region($cur_pgroup);

    foreach ($enemies as &$enemy) {
        // 玩家已进入战斗状态 → 中断循环
        // TODO: 未来引入先攻队列系统后，如果有多个目标在 1 tick 内同时进入战斗状态，
        //       使用先攻队列对它们的行动顺序进行排序，然后依序结算，而非简单中断
        if ($player['action'] == 'battle') break;

        obl_enemy_tick($enemy, $player);
    }
}

/**
 * 单个敌人的 AI 决策和行动
 *
 * @param array &$enemy 敌人数据（已格式化）
 * @param array &$player 当前玩家数据
 */
function obl_enemy_tick(&$enemy, &$player) {
    // 死亡敌人不行动
    if ($enemy['state'] > 0) return;

    // 行动意愿门控：随机数决定这个 tick 要不要行动
    $action_chance = isset($enemy['oblpara']['action_chance'])
        ? (float)$enemy['oblpara']['action_chance'] : 0.5;
    if (mt_rand() / mt_getrandmax() > $action_chance) return;

    $ai_type = isset($enemy['oblpara']['ai_type']) ? $enemy['oblpara']['ai_type'] : 'idle';
    $vision_range = isset($enemy['oblpara']['vision_range'])
        ? (int)$enemy['oblpara']['vision_range'] : 3;

    // 检查与玩家距离（同区域才有意义）
    $should_chase = false;
    if ($enemy['pgroup'] == $player['pgroup']) {
        $distance = obl_get_distance($enemy['pgroup'], $enemy['pls'], $player['pls']);
        if ($distance > 0 && $distance <= $vision_range) {
            // 玩家在感知范围内 → 追击
            $should_chase = true;
        }
    }

    if ($should_chase) {
        obl_enemy_chase_player($enemy, $player);
        return;
    }

    // 玩家不在感知范围 → 根据 AI 类型行动
    switch ($ai_type) {
        case 'patrol':
            obl_enemy_patrol($enemy);
            break;
        case 'aggressive':
            obl_enemy_hunt($enemy);  // MVP 简化为巡逻
            break;
        case 'idle':
        default:
            // 发呆，不行动
            break;
    }
}
```

### 4.3 移动逻辑

```php
/**
 * 敌人移动（参考 obl_move 但适配敌人）
 * NPC 可以在雾中自由移动（不受 fog 限制）
 *
 * @param array &$enemy 敌人数据
 * @param int $target_pls 目标格 pls
 * @param array &$player 当前玩家数据（用于检测突袭）
 * @return bool 移动是否成功
 */
function obl_enemy_move(&$enemy, $target_pls, &$player) {
    global $obl_log;

    // 校验目标格 passable
    $map = obl_get_map_data($enemy['pgroup']);
    $tiles = $map['tiles'][$enemy['pgroup']];
    if (!isset($tiles[$target_pls]) || empty($tiles[$target_pls]['passable'])) {
        return false;
    }

    // 校验目标格是否是玩家所在格 → 触发突袭
    if ($player['pgroup'] == $enemy['pgroup'] && $player['pls'] == $target_pls) {
        obl_enemy_ambush_player($enemy, $player);
        return false;  // 敌人不移动，停留在原地
    }

    // 校验目标格未被其他单位占用（一个格一个单位）
    if (obl_is_tile_occupied_by_others($enemy['pgroup'], $target_pls, $enemy['pid'])) {
        return false;
    }

    // 正常移动
    $enemy['pls'] = $target_pls;

    // 更新 discovered 状态（见 4.5）
    obl_update_enemy_discovered($enemy, $player);

    // 保存到数据库
    obl_save_player($enemy);
    return true;
}
```

### 4.4 追击与巡逻

```php
/**
 * 追击玩家：计算向玩家移动的下一步
 */
function obl_enemy_chase_player(&$enemy, &$player) {
    $next_pls = obl_calc_next_step_towards($enemy['pgroup'], $enemy['pls'], $player['pls']);
    if ($next_pls !== false) {
        obl_enemy_move($enemy, $next_pls, $player);
        // 如果移动失败且玩家在目标格，obl_enemy_move 内部已处理突袭
    }
}

/**
 * 巡逻：随机选一个邻居格移动
 */
function obl_enemy_patrol(&$enemy) {
    global $player;  // 巡逻时不需要玩家数据，但 obl_enemy_move 签名需要
    $neighbors = obl_get_tile_neighbors($enemy['pgroup'], $enemy['pls']);
    if (empty($neighbors)) return;

    $target_pls = $neighbors[array_rand($neighbors)];
    obl_enemy_move($enemy, $target_pls, $player);
}

/**
 * 主动搜寻（MVP 简化为巡逻）
 */
function obl_enemy_hunt(&$enemy) {
    obl_enemy_patrol($enemy);
}
```

### 4.5 discovered 状态管理

```php
/**
 * 玩家探索时发现敌人（在 obl_explore 中调用）
 * 检查玩家视野内的敌人，设 discovered=1
 *
 * @param int $player_pgroup 玩家所在区域
 * @param int $player_pls 玩家所在格
 * @param int $vision_range 玩家视野范围
 */
function obl_discover_enemies($player_pgroup, $player_pls, $vision_range) {
    global $obl_log;

    $enemies = obl_fetch_enemies_by_region($player_pgroup);
    foreach ($enemies as &$enemy) {
        // 死亡敌人不更新 discovered（保留原状态供搜刮）
        if ($enemy['state'] > 0) continue;

        $distance = obl_get_distance($player_pgroup, $player_pls, $enemy['pls']);
        if ($distance >= 0 && $distance <= $vision_range && $enemy['discovered'] == 0) {
            $enemy['discovered'] = 1;
            obl_save_player($enemy);

            // emit 结构化日志：发现敌人
            $obl_log->emit('enemy.discovered', 'enemy', array(
                'enemy_name' => $enemy['name'],
                'enemy_pid'  => $enemy['pid'],
            ));
        }
    }
}

/**
 * 敌人移动后更新 discovered 状态
 * 超出玩家视野 → discovered=0（静默移除，不 emit 日志）
 *
 * @param array &$enemy 敌人数据
 * @param array &$player 当前玩家数据
 */
function obl_update_enemy_discovered(&$enemy, &$player) {
    // 死亡敌人不更新 discovered
    if ($enemy['state'] > 0) return;

    // 不同区域 → 未发现
    if ($enemy['pgroup'] != $player['pgroup']) {
        $enemy['discovered'] = 0;
        return;
    }

    // 超出玩家视野 → 未发现（静默移除）
    $distance = obl_get_distance($enemy['pgroup'], $enemy['pls'], $player['pls']);
    $player_vision = obl_get_player_vision_range($player);
    if ($distance < 0 || $distance > $player_vision) {
        $enemy['discovered'] = 0;
    }
}
```

### 4.6 突袭机制

```php
/**
 * 敌人突袭玩家
 * 设置玩家 action='battle' + bid=敌人pid，emit 日志
 * 战斗结算留待战斗系统实装
 *
 * @param array &$enemy 敌人数据
 * @param array &$player 玩家数据（引用传递，修改 action/bid）
 */
function obl_enemy_ambush_player(&$enemy, &$player) {
    global $obl_log;

    $player['action'] = 'battle';
    $player['bid'] = $enemy['pid'];

    // 敌人标记为已发现（突袭者可见）
    $enemy['discovered'] = 1;
    obl_save_player($enemy);

    // emit 结构化日志：敌人突袭
    $obl_log->emit('enemy.ambush', 'enemy', array(
        'enemy_name' => $enemy['name'],
        'enemy_pid'  => $enemy['pid'],
    ));
}
```

### 4.7 占用规则

一个地图格只能站一个单位。占用检查通过 SQL 查询 `oblplayers` 表：

```php
/**
 * 检查地图格是否被其他单位占用
 * @param int $pgroup 区域 ID
 * @param int $pls 格子 ID
 * @param int $exclude_pid 排除的 pid（避免检查自己）
 * @return bool 是否被占用
 */
function obl_is_tile_occupied_by_others($pgroup, $pls, $exclude_pid) {
    global $db, $tablepre;
    $result = $db->query("SELECT pid FROM {$tablepre}oblplayers
                          WHERE pgroup='{$pgroup}' AND pls='{$pls}' AND state=0
                          AND pid != '{$exclude_pid}' LIMIT 1");
    return $db->num_rows($result) > 0;
}
```

### 4.8 辅助函数

```php
/**
 * 计算向目标移动的下一步（选距离目标最近的邻居格）
 * @param int $pgroup 区域 ID
 * @param int $from_pls 起点格
 * @param int $to_pls 终点格
 * @return int|false 下一步的 pls，无可行路径返回 false
 */
function obl_calc_next_step_towards($pgroup, $from_pls, $to_pls) {
    $neighbors = obl_get_tile_neighbors($pgroup, $from_pls);
    if (empty($neighbors)) return false;

    $min_dist = PHP_INT_MAX;
    $best_pls = false;
    foreach ($neighbors as $neighbor_pls) {
        $dist = obl_get_distance($pgroup, $neighbor_pls, $to_pls);
        if ($dist >= 0 && $dist < $min_dist) {
            $min_dist = $dist;
            $best_pls = $neighbor_pls;
        }
    }
    return $best_pls;
}

/**
 * 获取地图格的邻居列表
 * @param int $pgroup 区域 ID
 * @param int $pls 格子 ID
 * @return array 邻居格 pls 列表
 */
function obl_get_tile_neighbors($pgroup, $pls) {
    $map = obl_get_map_data($pgroup);
    $tiles = $map['tiles'][$pgroup];
    if (!isset($tiles[$pls])) return array();
    return isset($tiles[$pls]['neighbors']) ? $tiles[$pls]['neighbors'] : array();
}

/**
 * 获取玩家视野范围（MVP 固定值，未来可基于属性计算）
 * @param array &$player 玩家数据
 * @return int 视野范围（BFS 跳数）
 */
function obl_get_player_vision_range(&$player) {
    // MVP 阶段固定值，未来可基于属性/装备/技能计算
    return 3;
}
```

### 4.9 结构化日志

NPC 相关事件通过 `$obl_log->emit()` 输出，前端按 ID 查模板渲染。

| 日志 ID | action | params | 说明 |
|---------|--------|--------|------|
| `enemy.discovered` | `enemy` | `{ enemy_name, enemy_pid }` | 玩家探索时发现敌人 |
| `enemy.ambush` | `enemy` | `{ enemy_name, enemy_pid }` | 敌人突袭玩家（设置 `action='battle'`） |

**说明**：
- 敌人移出玩家视野时**静默移除**（`discovered=0`），不 emit 日志
- 战斗开始/结束的日志由战斗系统设计案定义（`battle.start` / `battle.end`）
- `enemy.ambush` 是 MVP 阶段的临时日志，战斗系统实装后可能被 `battle.start` 替代或合并

---

## 五、tick 事件集成

### 5.1 修改玩家系统设计案的 tick 事件函数

在 [obl_resolve_tick_events](file:///d:/wamp64/www/phpdts/oblivions/include/game/player.func.php) 中调用 NPC AI：

```php
function obl_resolve_tick_events($delta, &$player = null) {
    // 安全限制：单次请求最多处理 100 刻，防止异常情况下的死循环
    $delta = min((int)$delta, 100);

    for ($i = 0; $i < $delta; $i++) {
        // 1. 全局结算敌人 AI（只结算当前区域）
        if ($player !== null) {
            obl_resolve_all_enemy_ai($player['pgroup'], $player);
        }

        // 2. buff/dot 结算（未来扩展）
        // obl_resolve_buffs_dots();

        // 3. 其他周期性结算（未来扩展）
    }
}
```

**注意**：`obl_resolve_tick_events` 的签名需要扩展，增加 `$player` 参数。调用方（`obl_command.php`）在检测到 `obl_pretick < obl_tick` 时传入当前玩家数据。

### 5.2 探索时发现敌人

在 [obl_explore](file:///d:/wamp64/www/phpdts/oblivions/include/game/explore.func.php) 中调用发现函数：

```php
function obl_explore(&$pdata, $skip_sp_check = false) {
    global $obl_log;

    // ... 现有逻辑（体力检查、视野更新、迷雾清除）...

    // 新增：发现视野内的敌人
    $vision_range = obl_get_player_vision_range($pdata);
    obl_discover_enemies($pdata['pgroup'], $pdata['pls'], $vision_range);

    // ... 现有逻辑（探索日志、钩子）...
}
```

---

## 六、API 扩展

### 6.1 enemies API

在 `api_v2.php` 新增 `enemies` action：

```php
case 'enemies':
    handle_obl_enemies();
    break;
```

```php
function handle_obl_enemies() {
    global $pdata;

    if (!oblivions_is_active()) {
        api_error('Not in oblivions mode', 'NOT_OBLIVIONS');
    }

    // 获取当前区域 discovered=1 的敌人
    $enemies = obl_fetch_discovered_enemies($pdata['pgroup']);

    // 如果玩家处于战斗状态，确保返回战斗对象（即使 discovered=0）
    if ($pdata['action'] == 'battle' && $pdata['bid']) {
        $battle_enemy = obl_fetch_playerdata_by_pid($pdata['bid']);
        if ($battle_enemy) {
            $already_in_list = false;
            foreach ($enemies as $e) {
                if ($e['pid'] == $battle_enemy['pid']) {
                    $already_in_list = true;
                    break;
                }
            }
            if (!$already_in_list) {
                $enemies[] = $battle_enemy;
            }
        }
    }

    // 返回敌人数据（精简字段）
    $result = array();
    foreach ($enemies as &$enemy) {
        $result[] = obl_simplify_enemy_data($enemy);
    }

    api_response('success', array('enemies' => $result));
}

/**
 * 精简敌人数据（只返回前端需要的字段）
 */
function obl_simplify_enemy_data(&$enemy) {
    return array(
        'pid'        => $enemy['pid'],
        'type'       => $enemy['type'],
        'name'       => $enemy['name'],
        'icon'       => $enemy['icon'],
        'gd'         => $enemy['gd'],
        'pgroup'     => $enemy['pgroup'],
        'pls'        => $enemy['pls'],
        'hp'         => $enemy['hp'],
        'mhp'        => $enemy['mhp'],
        'lvl'        => $enemy['lvl'],
        'state'      => $enemy['state'],
        'discovered' => $enemy['discovered'],
    );
}
```

### 6.2 获取已发现的敌人

```php
/**
 * 获取当前区域 discovered=1 的敌人
 * @param int $pgroup 区域 ID
 * @return array 敌人数据数组（每个元素已格式化）
 */
function obl_fetch_discovered_enemies($pgroup) {
    global $db, $tablepre;
    $enemies = array();
    $result = $db->query("SELECT * FROM {$tablepre}oblplayers
                          WHERE type > 0 AND pgroup='{$pgroup}' AND discovered=1 AND state=0");
    while ($edata = $db->fetch_array($result)) {
        obl_format_playerdata($edata);
        $enemies[] = $edata;
    }
    return $enemies;
}
```

### 6.3 tile_actions API 预留：corpses 分类

`obl_fetch_discovered_enemies` 查询条件为 `state=0`，死亡敌人不会出现在 `enemies` API 中。尸体搜刮通过 `tile_actions` API 的 `corpses` 分类实现（与 `pois` / `ground_items` 并列）。

**MVP 阶段不实现**，但接口预留如下：

```php
// tile_actions 响应结构（未来扩展）
{
    "pois": [...],          // 已有：POI 列表
    "ground_items": [...],  // 已有：散落道具列表
    "corpses": [            // 预留：尸体列表（战斗系统实装后填充）
        {
            "pid": 101,
            "name": "废铁史莱姆",
            "icon": "enemy_slime",
            "pls": 5,
            "itempara": [...],  // 尸体上的道具栏（可搜刮）
            "wep": "...",       // 尸体上的装备（可搜刮）
            // ... 其他装备字段
        }
    ]
}
```

**尸体搜刮命令**（未来实现）：
- 新增 `obl_search_corpse` 命令，参数为 `{ corpse_pid, slot_index }`
- 从尸体的 `itempara` / 装备字段中取出指定物品，转移到玩家背包
- 尸体被搜刮后，对应槽位设为 `null`

---

## 七、前端显示

### 7.1 地图上显示敌人

在 `vex/js/data.js` 的 `mapData` 中新增 `enemies` 字段：

```javascript
export const mapData = {
    curLoc: null,
    curRegion: null,
    links: null,
    enemies: [],  // 新增：当前区域已发现的敌人
};
```

在 `vex/js/app.js` 的 `loadMap()` 后加载敌人数据：

```javascript
async function loadMap() {
    // ... 原有逻辑 ...

    // 新增：加载敌人数据
    const enemiesResult = await gameApi('enemies');
    if (enemiesResult.status === 'success') {
        mapData.enemies = enemiesResult.data.enemies;
    }
}
```

在 `vex/js/map.js` 的 `renderMapGrid()` 中渲染敌人：

```javascript
// 渲染地图格时
const enemy = mapData.enemies.find(e => e.pls === tile.pls);
if (enemy) {
    cell.textContent = `[${enemy.name}]`;
    cell.classList.add('has-enemy');
}
```

### 7.2 敌人信息展示（悬浮）

MVP 阶段简化：光标悬浮显示敌人名字和模糊血量描述。

```javascript
// 模糊血量描述
function getHpDescription(hp, mhp) {
    const percent = hp / mhp;
    if (percent > 0.75) return '非常健康';
    if (percent > 0.50) return '比较健康';
    if (percent > 0.25) return '身体不错';
    if (percent > 0) return '伤痕累累';
    return '已死亡';
}
```

### 7.3 结构化日志渲染

在 `vex/data/log-templates.js` 新增 NPC 相关日志模板：

| 日志 ID | 模板示例 |
|---------|---------|
| `enemy.discovered` | `你发现了 {enemy_name} 的踪迹` |
| `enemy.ambush` | `{enemy_name} 突然向你发起了突袭！` |

---

## 八、文件改动清单

### 8.1 新建文件

| 文件 | 用途 |
|------|------|
| `oblivions/gamedata/enemies_config.php` | 敌人类型属性配置 |
| `oblivions/gamedata/enemy_pool.php` | 敌人生成池（按潮汐区） |
| `oblivions/include/game/enemy_ai.func.php` | NPC AI 行为 |

### 8.2 修改文件

| 文件 | 改动 |
|------|------|
| `include/gamectl/system.func.php` | `rs_init_oblivions()` 扩展（调用 `obl_init_enemies`） |
| `oblivions/include/game/player.func.php` | `obl_resolve_tick_events()` 签名扩展（增加 `$player` 参数） |
| `oblivions/include/game/explore.func.php` | `obl_explore()` 中调用 `obl_discover_enemies` |
| `oblivions/include/core/obl_command.php` | tick 事件结算时传入 `$pdata` |
| `api_v2.php` | 新增 `enemies` action |
| `vex/js/data.js` | `mapData` 新增 `enemies` 字段 |
| `vex/js/map.js` | 渲染敌人标记 |
| `vex/js/app.js` | `loadMap()` 后加载敌人数据 |
| `vex/data/log-templates.js` | 新增 `enemy.discovered` / `enemy.ambush` 模板 |

---

## 九、MVP 范围

### 9.1 包含

- **NPC 配置**：2 种敌人类型（废铁史莱姆 / 锈蚀守卫），按潮汐区分布
- **NPC 生成**：按 `enemy_pool.php` 配置生成到对应潮汐区的格上
- **NPC AI**：行动意愿门控 + 巡逻/追击/发呆（不涉及战斗）
- **discovered 机制**：玩家探索发现敌人，敌人移出视野静默消失
- **突袭机制**：敌人移动到玩家所在格，设置 `action='battle'` + emit 日志（战斗结算留空）
- **enemies API**：返回当前区域已发现的敌人
- **前端地图显示**：地图上显示敌人标记
- **结构化日志**：`enemy.discovered` / `enemy.ambush`

### 9.2 不包含

- 战斗系统（突袭只设置 `action='battle'`，不结算战斗）
- 技能系统（skillpara 预留）
- NPC 间战斗
- NPC 死亡处理（`state>0` 标记，保留装备/道具栏供未来搜刮）
- 尸体搜刮（战斗系统实装后实现）
- 多区域 NPC 迁移（NPC 固定在生成区域）

---

## 十、测试要点

### 10.1 NPC 生成
- [ ] 每个潮汐区按 `enemy_pool.php` 配置生成指定数量的敌人
- [ ] 敌人位置在 `passable=1` 的格上
- [ ] 敌人位置在对应潮汐区的格上（shallow 敌人只在 shallow 格）
- [ ] 敌人数据格式正确（JSON 字段：itempara/tacpara/skillpara/oblpara）
- [ ] 敌人初始 `discovered=0`、`state=0`
- [ ] 敌人不与玩家初始位置、出入口、其他敌人重叠

### 10.2 NPC AI
- [ ] 行动意愿门控：`action_chance` 概率生效
- [ ] 巡逻型敌人随机移动到邻居格
- [ ] 追击型敌人在感知范围内向玩家移动
- [ ] 敌人移动到玩家所在格触发突袭（`action='battle'` + emit 日志）
- [ ] 一个格不站两个单位
- [ ] 敌人不会移动到 `passable=0` 的格
- [ ] NPC 可以在雾中自由移动（不受 `fog` 限制）
- [ ] `state>0` 的敌人不行动

### 10.3 发现机制
- [ ] 玩家探索后视野内敌人 `discovered=1`
- [ ] 敌人移出视野后 `discovered=0`（静默移除，无日志）
- [ ] `enemies` API 返回 `discovered=1` 的敌人
- [ ] 战斗状态下返回战斗对象（即使 `discovered=0`）

### 10.4 前端
- [ ] 地图上显示敌人标记
- [ ] 敌人移动后地图刷新（`game:action-completed` 事件触发）
- [ ] 悬浮显示敌人信息（名字 + 模糊血量）
- [ ] 结构化日志正确渲染（`enemy.discovered` / `enemy.ambush`）

### 10.5 tick 集成
- [ ] 玩家移动后 tick 增加，下次请求时 NPC AI 结算
- [ ] NPC AI 结算后 `pretick` 同步
- [ ] MVP 只结算当前区域的敌人
