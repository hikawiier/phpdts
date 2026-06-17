# Oblivions NPC 敌人系统设计案

> 为 Oblivions 模式引入 NPC 敌人，作为战斗系统的前置依赖。
>
> **依赖**：本设计案依赖《Oblivions 玩家系统与游戏刻机制设计案》（oblplayers 表、认证函数、游戏刻机制）。
>
> **设计原则**：NPC AI 独立实现，不调用旧模式 bot_acts，参考其逻辑但用 Oblivions 兼容的函数。

---

## 一、设计目标

### 1.1 核心目标

1. **NPC 敌人生成**：游戏初始化时生成，分配到区域和地图格
2. **NPC AI 行为**：移动、发呆、追击，与 Oblivions 网格地图兼容
3. **发现机制**：玩家探索发现敌人，敌人移出视野后消失
4. **突袭机制**：敌人移动到玩家所在格，自然触发战斗状态
5. **enemies API**：返回当前区域已发现的敌人
6. **前端显示**：地图上显示敌人标记

### 1.2 非目标

- **战斗系统**：本设计案不实现战斗结算，突袭只设置 `action='battle'`
- **技能系统**：skillpara 预留字段，不定义技能内容
- **NPC 间战斗**：MVP 不实现 NPC 互相攻击
- **多区域 NPC 迁移**：MVP 阶段 NPC 固定在生成区域
- **NPC 死亡处理**：战斗系统实现后处理

---

## 二、NPC 数据格式

### 2.1 NPC 配置文件

新建 `oblivions/gamedata/enemies_config.php`：

```php
<?php
// NPC 敌人配置
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
        'ai_type' => 'patrol',      // AI 类型
        'vision_range' => 3,         // 感知范围
        'skills' => ['basic_attack', 'escape'],  // 初始技能
        'strategy_slots' => [        // 初始策略槽
            ['type' => 'skill', 'id' => 'basic_attack'],
            null, null, null
        ],
    ),
    2 => array(
        'name' => '锈蚀守卫',
        'icon' => 'enemy_guard',
        'gd' => 'm',
        'hp' => 80, 'mhp' => 80,
        'sp' => 15, 'msp' => 15,
        'att' => 12, 'def' => 8,
        'lvl' => 2,
        'ai_type' => 'aggressive',   // 激进型 AI
        'vision_range' => 5,
        'skills' => ['basic_attack', 'escape'],
        'strategy_slots' => [
            ['type' => 'skill', 'id' => 'basic_attack'],
            ['type' => 'skill', 'id' => 'basic_attack'],
            null, null
        ],
    ),
);
```

### 2.2 NPC 在 oblplayers 表中的数据

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
| `lvl/exp` | 配置 | — |
| `state` | 0 | — |
| `itempara` | `[null × 7]` | 空道具栏 |
| `tacpara` | json_encode(配置的 strategy_slots) | 策略槽 |
| `skillpara` | json_encode({skills: [...]}) | 技能数据 |
| `oblpara` | json_encode({ai_type, vision_range}) | AI 配置 |
| `discovered` | 0 | 初始未发现 |

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
    global $obl_enemies_config;

    // 获取所有区域
    $regions = obl_get_all_regions();

    foreach ($regions as $pgroup => $region) {
        // 每个区域生成的敌人数量（可配置）
        $enemy_count = obl_get_region_enemy_count($pgroup);

        for ($i = 0; $i < $enemy_count; $i++) {
            // 随机选择敌人类型
            $enemy_type = obl_pick_enemy_type($pgroup);

            // 随机分配地图格（passable=1 的格）
            $pls = obl_pick_random_tile($pgroup);

            // 创建敌人记录
            obl_create_enemy_record($enemy_type, $pgroup, $pls);
        }
    }
}
```

### 3.2 生成规则

**每个区域的敌人数量**：
- MVP 阶段固定数量（如每个区域 3-5 个）
- 未来可根据区域难度配置

**敌人类型选择**：
- 根据区域配置可选敌人类型
- MVP 阶段所有区域共享同一敌人池

**地图格分配**：
- 随机选择 `passable=1` 的格
- 避免与玩家初始位置重叠
- 避免与出入口重叠
- 避免与其他敌人重叠（一个格一个单位）

### 3.3 创建敌人记录

```php
function obl_create_enemy_record($enemy_type, $pgroup, $pls) {
    global $obl_enemies_config;
    $config = $obl_enemies_config[$enemy_type];

    $enemy = array(
        'type' => $enemy_type,
        'name' => $config['name'],
        'pass' => '',
        'gd' => $config['gd'],
        'icon' => $config['icon'],
        'action' => '',
        'bid' => 0,
        'hp' => $config['hp'],
        'mhp' => $config['mhp'],
        'sp' => $config['sp'],
        'msp' => $config['msp'],
        'att' => $config['att'],
        'def' => $config['def'],
        'ap' => 0,
        'max_ap' => 10,
        'pgroup' => $pgroup,
        'pls' => $pls,
        'lvl' => $config['lvl'],
        'exp' => 0,
        'state' => 0,
        'itempara' => json_encode([null, null, null, null, null, null, null]),
        'tacpara' => json_encode(['slots' => $config['strategy_slots']]),
        'skillpara' => json_encode(['skills' => $config['skills']]),
        'oblpara' => json_encode([
            'ai_type' => $config['ai_type'],
            'vision_range' => $config['vision_range']
        ]),
        'discovered' => 0,
    );

    // INSERT INTO oblplayers
    obl_insert_player($enemy);
}
```

---

## 四、NPC 行为

### 4.1 新建文件

`oblivions/include/game/enemy_ai.func.php`

### 4.2 AI 决策流程

```php
<?php
// 全局结算所有敌人 AI（在 tick 事件中调用）
function obl_resolve_all_enemy_ai() {
    // 获取所有敌人（type > 0）
    $enemies = obl_fetch_all_enemies();

    foreach ($enemies as &$enemy) {
        obl_enemy_tick($enemy);
    }
}

// 单个敌人的 AI 决策和行动
function obl_enemy_tick(&$enemy) {
    $ai_type = $enemy['oblpara']['ai_type'];
    $vision_range = $enemy['oblpara']['vision_range'];

    // 获取玩家数据
    $player = obl_fetch_playerdata_by_pid(get_current_player_pid());

    // 检查与玩家距离（同区域才有意义）
    if ($enemy['pgroup'] == $player['pgroup']) {
        $distance = obl_calc_distance($enemy['pls'], $player['pls'], $enemy['pgroup']);

        if ($distance <= $vision_range) {
            // 玩家在感知范围内 → 追击
            obl_enemy_chase_player($enemy, $player);
            return;
        }
    }

    // 玩家不在感知范围 → 根据 AI 类型行动
    switch ($ai_type) {
        case 'patrol':
            obl_enemy_patrol($enemy);  // 随机移动
            break;
        case 'aggressive':
            obl_enemy_hunt($enemy);    // 主动搜寻（MVP 可简化为巡逻）
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
// 敌人移动（参考 obl_move 但适配敌人）
function obl_enemy_move(&$enemy, $target_pls) {
    // 校验目标格 passable
    $tile = obl_get_tile($enemy['pgroup'], $target_pls);
    if (!$tile['passable']) {
        return false;
    }

    // 校验目标格未被占用（一个格一个单位）
    if (obl_is_tile_occupied($enemy['pgroup'], $target_pls)) {
        $occupant = obl_get_tile_occupant($enemy['pgroup'], $target_pls);

        // 如果占用者是玩家 → 触发突袭（移动失败的副作用）
        if ($occupant && $occupant['type'] == 0) {
            // 设置玩家战斗状态
            $occupant['action'] = 'battle';
            $occupant['bid'] = $enemy['pid'];
            obl_save_player($occupant);

            // 敌人标记为已发现（突袭者可见）
            $enemy['discovered'] = 1;
            // 敌人不移动，停留在原地
        }
        return false;  // 移动失败
    }

    // 正常移动
    $enemy['pls'] = $target_pls;

    // 更新 discovered 状态（见 4.5）
    obl_update_enemy_discovered($enemy);

    // 保存到数据库
    obl_save_player($enemy);
    return true;
}
```

### 4.4 追击与巡逻

```php
// 追击玩家
function obl_enemy_chase_player(&$enemy, &$player) {
    // 计算向玩家移动的下一步
    $next_pls = obl_calc_next_step_towards($enemy['pls'], $player['pls'], $enemy['pgroup']);

    if ($next_pls !== false) {
        obl_enemy_move($enemy, $next_pls);
        // 如果移动失败且玩家在目标格，obl_enemy_move 内部已处理突袭
    }
}

// 巡逻（随机移动）
function obl_enemy_patrol(&$enemy) {
    $neighbors = obl_get_tile_neighbors($enemy['pgroup'], $enemy['pls']);
    if (empty($neighbors)) return;

    // 随机选一个邻居格
    $target_pls = $neighbors[array_rand($neighbors)];
    obl_enemy_move($enemy, $target_pls);
}

// 主动搜寻（MVP 简化为巡逻）
function obl_enemy_hunt(&$enemy) {
    obl_enemy_patrol($enemy);
}
```

### 4.5 discovered 状态管理

```php
// 玩家探索时发现敌人（在 obl_explore 中调用）
function obl_discover_enemies($player_pgroup, $player_pls, $vision_range) {
    $enemies = obl_fetch_enemies_by_region($player_pgroup);
    foreach ($enemies as &$enemy) {
        $distance = obl_calc_distance($player_pls, $enemy['pls'], $player_pgroup);
        if ($distance <= $vision_range && $enemy['discovered'] == 0) {
            $enemy['discovered'] = 1;
            obl_save_player($enemy);
        }
    }
}

// 敌人移动后更新 discovered 状态
function obl_update_enemy_discovered(&$enemy) {
    $player = obl_fetch_playerdata_by_pid(get_current_player_pid());

    // 不同区域 → 未发现
    if ($enemy['pgroup'] != $player['pgroup']) {
        $enemy['discovered'] = 0;
        return;
    }

    // 超出玩家视野 → 未发现
    $distance = obl_calc_distance($enemy['pls'], $player['pls'], $enemy['pgroup']);
    $player_vision = obl_get_player_vision_range($player);
    if ($distance > $player_vision) {
        $enemy['discovered'] = 0;
    }
}
```

### 4.6 占用规则

一个地图格只能站一个单位：

```php
// 检查地图格是否被占用
function obl_is_tile_occupied($pgroup, $pls) {
    return obl_get_tile_occupant($pgroup, $pls) !== null;
}

// 获取地图格占用者
function obl_get_tile_occupant($pgroup, $pls) {
    // 检查玩家
    $player = obl_fetch_player_by_position($pgroup, $pls);
    if ($player) return $player;

    // 检查敌人
    $enemy = obl_fetch_enemy_by_position($pgroup, $pls);
    if ($enemy) return $enemy;

    return null;
}
```

### 4.7 辅助函数

```php
// 计算两个格子的距离（曼哈顿距离或 BFS 最短路径）
function obl_calc_distance($pls1, $pls2, $pgroup) {
    $tile1 = obl_get_tile($pgroup, $pls1);
    $tile2 = obl_get_tile($pgroup, $pls2);
    return abs($tile1['x'] - $tile2['x']) + abs($tile1['y'] - $tile2['y']);
}

// 计算向目标移动的下一步
function obl_calc_next_step_towards($from_pls, $to_pls, $pgroup) {
    $neighbors = obl_get_tile_neighbors($pgroup, $from_pls);
    if (empty($neighbors)) return false;

    // 选距离目标最近的邻居
    $min_dist = PHP_INT_MAX;
    $best_pls = false;
    foreach ($neighbors as $neighbor_pls) {
        $dist = obl_calc_distance($neighbor_pls, $to_pls, $pgroup);
        if ($dist < $min_dist) {
            $min_dist = $dist;
            $best_pls = $neighbor_pls;
        }
    }
    return $best_pls;
}

// 获取玩家视野范围（复用现有 obl_calc_vision_range 或简化）
function obl_get_player_vision_range(&$player) {
    // MVP 阶段固定值，未来可基于属性计算
    return 3;
}
```

---

## 五、tick 事件集成

### 5.1 修改玩家系统设计案的 tick 事件函数

```php
// 在 obl_resolve_tick_events 中调用 NPC AI
function obl_resolve_tick_events($delta) {
    for ($i = 0; $i < $delta; $i++) {
        // 1. 全局结算敌人 AI
        obl_resolve_all_enemy_ai();
        // 2. buff/dot 结算（未来扩展）
    }
}
```

### 5.2 探索时发现敌人

在 `obl_explore()` 中调用发现函数：

```php
function obl_explore(&$pdata, $skip_sp_check = false) {
    // ... 现有逻辑（视野更新、迷雾清除）...

    // 新增：发现视野内的敌人
    $vision_range = obl_get_player_vision_range($pdata);
    obl_discover_enemies($pdata['pgroup'], $pdata['pls'], $vision_range);

    // ... 现有逻辑（日志、钩子）...
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

function handle_obl_enemies() {
    global $pdata;
    if (!oblivions_is_active()) {
        api_error('Not in oblivions mode');
        return;
    }

    // 获取当前区域 discovered=1 的敌人
    $enemies = obl_fetch_discovered_enemies($pdata['pgroup']);

    // 如果玩家处于战斗状态，确保返回战斗对象（即使 discovered=0）
    if ($pdata['action'] == 'battle' && $pdata['bid']) {
        $battle_enemy = obl_fetch_playerdata_by_pid($pdata['bid']);
        if ($battle_enemy && !in_array($battle_enemy['pid'], array_column($enemies, 'pid'))) {
            $enemies[] = $battle_enemy;
        }
    }

    // 返回敌人数据（精简字段）
    $result = array_map('obl_simplify_enemy_data', $enemies);
    api_response('success', ['enemies' => $result]);
}

// 精简敌人数据（只返回前端需要的字段）
function obl_simplify_enemy_data(&$enemy) {
    return array(
        'pid' => $enemy['pid'],
        'type' => $enemy['type'],
        'name' => $enemy['name'],
        'icon' => $enemy['icon'],
        'pgroup' => $enemy['pgroup'],
        'pls' => $enemy['pls'],
        'hp' => $enemy['hp'],
        'mhp' => $enemy['mhp'],
        'lvl' => $enemy['lvl'],
        'discovered' => $enemy['discovered'],
    );
}
```

### 6.2 获取已发现的敌人

```php
function obl_fetch_discovered_enemies($pgroup) {
    // SELECT * FROM oblplayers WHERE type > 0 AND pgroup = $pgroup AND discovered = 1
    $enemies = obl_fetch_enemies_by_region($pgroup);
    return array_filter($enemies, function($e) {
        return $e['discovered'] == 1;
    });
}
```

---

## 七、前端显示

### 7.1 地图上显示敌人

在 `vex/js/data.js` 新增 enemiesData 状态：

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
    if (oblivionsIsActive) {
        const enemiesResult = await gameApi('enemies');
        if (enemiesResult.status === 'success') {
            mapData.enemies = enemiesResult.data.enemies;
        }
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

---

## 八、文件改动清单

### 8.1 新建文件

| 文件 | 用途 |
|------|------|
| `oblivions/include/game/enemy_ai.func.php` | NPC AI 行为 |
| `oblivions/gamedata/enemies_config.php` | NPC 配置 |

### 8.2 修改文件

| 文件 | 改动 |
|------|------|
| `include/gamectl/system.func.php` | rs_init_oblivions 扩展（调用 obl_init_enemies） |
| `oblivions/include/game/explore.func.php` | obl_explore 中调用 obl_discover_enemies |
| `api_v2.php` | 新增 enemies action |
| `vex/js/data.js` | 新增 enemiesData 状态 |
| `vex/js/map.js` | 渲染敌人标记 |
| `vex/js/app.js` | loadMap 后加载敌人数据 |

---

## 九、MVP 范围

### 9.1 包含

- NPC 敌人生成（2 种类型，每区域 3-5 个）
- NPC AI（巡逻/追击/发呆）
- discovered 机制
- 突袭机制（移动失败触发战斗状态）
- enemies API
- 前端地图显示敌人

### 9.2 不包含

- 战斗系统（突袭只设置 action=battle，不结算战斗）
- 技能系统（skillpara 预留）
- NPC 间战斗
- NPC 死亡处理
- 掉落物机制

---

## 十、测试要点

### 10.1 NPC 生成
- [ ] 每个区域生成指定数量的敌人
- [ ] 敌人位置在 passable 的格上
- [ ] 敌人数据格式正确（JSON 字段）
- [ ] 敌人初始 discovered=0

### 10.2 NPC AI
- [ ] 巡逻型敌人随机移动
- [ ] 追击型敌人在感知范围内向玩家移动
- [ ] 敌人移动到玩家所在格触发突袭（action=battle）
- [ ] 一个格不站两个单位
- [ ] 敌人不会移动到 passable=0 的格

### 10.3 发现机制
- [ ] 玩家探索后视野内敌人 discovered=1
- [ ] 敌人移出视野后 discovered=0
- [ ] enemies API 返回 discovered=1 的敌人
- [ ] 战斗状态下返回战斗对象（即使 discovered=0）

### 10.4 前端
- [ ] 地图上显示敌人标记
- [ ] 敌人移动后地图刷新
- [ ] 悬浮显示敌人信息

### 10.5 tick 集成
- [ ] 玩家移动后 tick 增加，下次请求时 NPC AI 结算
- [ ] NPC AI 结算后 pretick 同步
