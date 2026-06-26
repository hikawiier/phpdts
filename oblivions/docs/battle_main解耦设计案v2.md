# battle_main 解耦设计案 v2

> 把队列管理从 `battle_main()` 中拆出,`$battle_cache` 改为外部传入。
>
> **状态**:设计阶段,未实施
> **前置**:[战斗入口设计案.md](战斗入口设计案.md)（已实施）
> **替换**:[battle_main解耦设计案.md](battle_main解耦设计案.md)（v1,已过时）
>
> 本设计案除了 3 项主解耦,还顺带修复 3 个 bug 和清理 2 个冗余点。

---

## 一、目标

按用户要求:
1. `$battle_cache` 作为固定参数在 `battle_main()` 开始时**外部传入**
2. 从 `battle_main` 中**移除队列管理**,独立为新的队列管理系统 `battle_manage_queue()`
3. 在 3 个入口函数内加入 `battle_cache` 判定和队列管理

---

## 二、主解耦方案

### 2.1 battle_main() 改造后

```php
/**
 * 战斗执行主函数（不含队列管理）
 *
 * 职责:仅做技能校验 + 动作执行。
 * 队列管理（创建/更新/解散/结束检测）由调用方在 battle_main 返回后调用 battle_manage_queue()。
 *
 * @param array &$actor_data    行动者数据
 * @param array &$atk_act       解析后的动作数组 [{act_id, target}, ...]
 * @param array &$obl_battle_log 战斗日志
 * @param array &$battle_cache  战斗上下文（外部传入,执行中填充 combatants）
 * @return void
 */
function battle_main(&$actor_data, &$atk_act, &$obl_battle_log, &$battle_cache)
{
    $obl_battle_log->setPhase('verify');
    battle_verify($actor_data, $atk_act, $obl_battle_log, $battle_cache);

    if (!empty($atk_act)) {
        $obl_battle_log->setPhase('excute');
        battle_excute($actor_data, $atk_act, $obl_battle_log, $battle_cache);
    }

    // 移除:battle_queue_check / battle_finish_check
}
```

要点:
- `$battle_cache` 完全由外部初始化,battle_main 不再内部 `= []`
- 函数只保留 verify + excute 两阶段
- `$battle_cache['combatants']` 仍由 `battle_once_excute` 在执行中累积填充

### 2.2 新增 battle_manage_queue()

```php
/**
 * 队列管理主函数（从 battle_main 拆出）
 *
 * 职责:创建/更新先攻队列 + 检测战斗结束 + 进入新先攻轮。
 * 由入口函数在 battle_main 返回后调用（入口 3 不调 battle_main 时单独调用）。
 *
 * @param array &$actor_data    行动者数据
 * @param array &$obl_battle_log 战斗日志
 * @param array &$battle_cache  战斗上下文
 * @return void
 */
function battle_manage_queue(&$actor_data, &$obl_battle_log, &$battle_cache)
{
    $obl_battle_log->setPhase('queue_check');
    battle_queue_check($actor_data, $obl_battle_log, $battle_cache);

    $obl_battle_log->setPhase('finish_check');
    battle_finish_check($actor_data, $obl_battle_log, $battle_cache);
}
```

建议位置:与 `battle_main` 同文件 [battle.main.php](file:///d:/wamp64/www/phpdts/oblivions/include/game/battle/battle.main.php)（队列管理是与执行平行的另一阶段,体量小,无需独立文件）。

### 2.3 入口函数注入 battle_cache

入口函数（[battle.entry.php](file:///d:/wamp64/www/phpdts/oblivions/include/game/battle/battle.entry.php)）改造模式统一。

**入口 1 / 2 / 4**（需调 battle_main + battle_manage_queue）:

```php
function battle_entry_player_ambush(&$pdata, $actions) {
    global $obl_battle_log, $obl_error_log;

    if (!$obl_battle_log) { /* init battle_log */ }

    $atk_act = battle_entry_parse_actions($actions, $pdata['pid'], 'player_ambush');
    if (empty($atk_act)) {
        /* emit error log */
        return;
    }

    # 战斗上下文（新增,显式初始化）
    $battle_cache = [
        'combatants' => [$pdata['pid'] => 1],
        'last_qid'   => 0,
    ];

    $pdata['oblpara']['ambush_flag'] = true;
    battle_state_init($pdata);

    include_once GAME_ROOT . './oblivions/include/game/battle/battle.main.php';
    battle_main($pdata, $atk_act, $obl_battle_log, $battle_cache);
    battle_manage_queue($pdata, $obl_battle_log, $battle_cache);
}
```

**入口 3**（只调 battle_manage_queue,不调 battle_main）:

```php
function battle_entry_encounter(&$actor, $combatants) {
    global $obl_battle_log;

    if (!$obl_battle_log) { /* init */ }

    $battle_cache = [
        'combatants' => array_fill_keys($combatants, 1),  // 显式参战者
        'last_qid'   => 0,
    ];

    battle_state_init($actor);

    include_once GAME_ROOT . './oblivions/include/game/battle/battle.main.php';
    battle_manage_queue($actor, $obl_battle_log, $battle_cache);

    # 按先攻结果校正状态机
    # obl_battle_state_reset($qid, WAITING_PLAYER 或 NPC_ACTING)
    # NPC 先攻时调用 battle_entry_npc_prepare_actions(...)
}
```

---

## 三、顺带修复的 3 个 Bug

### 3.1【Bug】battle_new_turn 缺 $battle_cache 参数,丢弃外部传入

**现状**（[battle.main.php:209-220](file:///d:/wamp64/www/phpdts/oblivions/include/game/battle/battle.main.php#L209-L220)）:
```php
function battle_new_turn(&$actor_data, &$obl_battle_log) {  // ← 缺 $battle_cache
    $battle_cache = [];  // ← 内部新建,丢弃外部传入的 last_qid 等
    $obl_battle_log->setPhase('prepare');
    battle_prepare($actor_data, $battle_cache, $obl_battle_log);
    battle_queue_update($actor_data, $obl_battle_log, $battle_cache);
    obl_save_player($actor_data);
}
```

**问题**:
- 函数签名缺 `$battle_cache` 参数
- 内部 `$battle_cache = []` 覆盖了外部上下文
- 外部传入的 `last_qid` / `combatants` 全部丢失

**修复**:
```php
function battle_new_turn(&$actor_data, &$obl_battle_log, &$battle_cache) {
    $obl_battle_log->setPhase('prepare');
    battle_prepare($actor_data, $battle_cache, $obl_battle_log);
    # 同时修复 3.2（删除冗余的 queue_update）
    obl_save_player($actor_data);
}
```

并在 `battle_finish_check` 调用处传入 $battle_cache（见 [battle.main.php:204](file:///d:/wamp64/www/phpdts/oblivions/include/game/battle/battle.main.php#L204)）。

### 3.2【冗余】battle_new_turn 内重复调用 battle_queue_update

**现状**:
```php
function battle_new_turn(...) {
    ...
    battle_prepare(...);              // AP 恢复
    battle_queue_update(...);          // ← 与下面重复
}
```

调用时序:
```
battle_queue_check()
  └── battle_queue_update()           # 第 1 次
battle_finish_check()
  └── battle_new_turn()
      └── battle_queue_update()        # 第 2 次,冗余
```

第 2 次调用位于 `battle_queue_check` 之后,队列状态已经在第 1 次 update 处理完毕（解肢/重建/done 推进）。新一先攻轮开始只意味着当前 actor done=1,其他参战者仍可能 done=0,update 不会触发任何动作。

**修复**:正文 3.1 已展示,删除该调用。

### 3.3【死代码】battle_state_clear 内的 battle_queue_update 无效

**现状**（[battle.func.php:21-30](file:///d:/wamp64/www/phpdts/oblivions/include/game/battle/battle.func.php#L21-L30)）:
```php
function battle_state_clear(...) {
    $actor_data['action'] = '';
    if (!empty($actor_data['bid'])) {
        battle_queue_exit($actor_data, ...);     // 内部会 set bid = 0
        battle_queue_update($actor_data, ...);  // ← 死代码：bid=0 时 queue_update 直接 return
    }
    ...
}
```

`battle_queue_exit` 把 actor 的 bid 设为 0,之后 `battle_queue_update` 第一行 `if ($qid <= 0) return;`（[battle.func.php:281](file:///d:/wamp64/www/phpdts/oblivions/include/game/battle/battle.func.php#L281)）直接退出,无任何作用。

**修复**:删除 `battle_queue_update` 调用,保留 `battle_queue_exit`。

---

## 四、可优化点 2 项

### 4.1 优化:消除 combatants 格式原地转换

**现状**（[battle.main.php:156-165](file:///d:/wamp64/www/phpdts/oblivions/include/game/battle/battle.main.php#L156-L165)）:
```php
function battle_queue_check(...) {
    if (!empty($battle_cache['combatants'])) {
        $new_combbatants = [];
        foreach ($battle_cache['combatants'] as $pid => $status) {
            if ($status == 1 && !in_array($pid, $new_combbatants)) $new_combbatants[] = $pid;
        }
        $battle_cache['combatants'] = $new_combbatants;  // ← 原地把 [pid=>status] 改为 [pid, ...]
    }
    ...
    battle_queue_create($actor_data, $battle_cache['combatants'], ...);
}
```

**问题**:
- `combatants` 格式在流程中变化（关联数组 → 索引数组）
- 后续读 `$battle_cache['combatants']` 不知道是哪种格式
- 难追踪

**修复**:固定 `combatants` 保持 `[pid => status]` 格式不变,新增辅助函数提取 pid 列表:

```php
/**
 * 从战斗上下文中提取存活参战者 pid 列表
 * @param array $battle_cache 战斗上下文
 * @return int[] 存活参战者 pid 列表（索引数组）
 */
function battle_get_alive_pids(array &$battle_cache): array {
    if (empty($battle_cache['combatants'])) return [];
    $pids = [];
    foreach ($battle_cache['combatants'] as $pid => $status) {
        if ($status === 1) $pids[] = (int)$pid;
    }
    return $pids;
}
```

`battle_queue_check` 改造:
```php
function battle_queue_check(&$actor_data, &$obl_battle_log, &$battle_cache) {
    if (empty($actor_data['bid'])) {
        $alive_pids = battle_get_alive_pids($battle_cache);
        battle_queue_create($actor_data, $alive_pids, $obl_battle_log);
    }
    battle_queue_done($actor_data, $actor_data['bid'], $obl_battle_log);
    battle_queue_update($actor_data, $obl_battle_log, $battle_cache);
}
```

### 4.2【优化】battle_queue_update 内的 battle_cache 判空

**现状**（[battle.func.php:303-305](file:///d:/wamp64/www/phpdts/oblivions/include/game/battle/battle.func.php#L303-L305)）:
```php
if (isset($battle_cache) && is_array($battle_cache)) {
    $battle_cache['last_qid'] = $qid;
}
```

**问题**:这种弱判断掩盖"调用方未传 $battle_cache"的潜在 bug,本设计案改造后所有调用方都传数组,不需要此判断。

**修复**:直接赋值,前提是所有调用方都已传入数组（解耦后已是这种情况）:
```php
$battle_cache['last_qid'] = $qid;
```

---

## 五、新增/修改/删除清单

### 5.1 新增

| 名称 | 位置 | 说明 |
|------|------|------|
| `battle_manage_queue()` | battle.main.php | 队列管理主函数（从 battle_main 拆出的 queue_check + finish_check） |
| `battle_get_alive_pids()` | battle.func.php or battle.main.php | 从 $battle_cache 提取存活参战者 pid 列表 |

### 5.2 修改

| 文件/函数 | 改动 |
|----------|------|
| battle.main.php::battle_main | 加 $battle_cache 参数;删除内部 `= []` 和 combatants 初始化;删除 queue_check/finish_check 调用 |
| battle.main.php::battle_new_turn | 加 $battle_cache 参数;删除内部 `= []` 和冗余 queue_update 调用 |
| battle.main.php::battle_finish_check | 调用 battle_new_turn 传入 $battle_cache |
| battle.main.php::battle_queue_check | 删除原地格式转换;改用 battle_get_alive_pids |
| battle.func.php::battle_state_clear | 删除内部冗余的 battle_queue_update 调用 |
| battle.func.php::battle_queue_update | 简化 battle_cache 判空为直接赋值 |
| battle.entry.php::battle_entry_player_ambush | 新增 $battle_cache 初始化;调用 battle_manage_queue |
| battle.entry.php::battle_entry_npc_ambush | 同上 |
| battle.entry.php::battle_entry_npc_prepare_actions | 同上 |
| battle.entry.php::battle_entry_encounter | $battle_cache 已含参战者;直接调用 battle_manage_queue |

### 5.3 删除

无（旧 battle_main 函数体保留,只改实现不删函数）。

---

## 六、入口 3 的状态机 reset 细节（实装时处理）

入口 3 创建队列后需校正状态机:

```php
function battle_entry_encounter(&$actor, $combatants) {
    ...
    $battle_cache = [
        'combatants' => array_fill_keys($combatants, 1),
        'last_qid'   => 0,
    ];
    battle_state_init($actor);
    battle_manage_queue($actor, $obl_battle_log, $battle_cache);

    # 按先攻结果校正状态机
    $qid = (int)$actor['bid'];
    if ($qid <= 0) return;
    $first = obl_fetch_queue_current_initiator($qid);
    if (!$first) return;

    if ($first['type'] == 0) {
        # 玩家先攻 → 等玩家命令
        obl_battle_state_reset($qid, OBL_BS_WAITING_PLAYER);
    } else {
        # NPC 先攻 → NPC 行动
        obl_battle_state_reset($qid, OBL_BS_NPC_ACTING);
        $npc_data = obl_fetch_playerdata_by_pid($first['pid']);
        if ($npc_data) {
            obl_format_playerdata($npc_data);
            $ai_actions = obl_ai_select_combat_action($npc_data, $actor['pid']);
            battle_entry_npc_prepare_actions($npc_data, $ai_actions);
        }
    }
}
```

入口 3 当前是预留接入点,本设计案只保证签名兼容,实际触发逻辑由移动系统设计案决定。

---

## 七、不修改的部分（明确）

- `battle_verify` / `battle_excute` / `battle_once_excute` / `battle_prepare` 等具体执行函数签名改动最小（只是承接 $battle_cache 引用）
- `battle_queue_create` / `battle_queue_done` / `battle_queue_update` / `battle_queue_exit` 底层函数不动
- 战斗状态机转换表 [battle_state_machine.func.php](file:///d:/wamp64/www/phpdts/oblivions/include/game/battle_state_machine.func.php) 完全不动
- 突袭标记 `ambush_flag` 仍存在 actor_data['oblpara'],不挪到 battle_cache（信息源唯一,避免冗余）

---

## 八、实施步骤

按影响范围从小到大:

1. **battle.func.php**: 修复 bug 3.3（删除 battle_state_clear 内冗余 queue_update） + 优化 4.2（简化 battle_queue_update 内判空）
2. **battle.main.php**: 修复 bug 3.2（删除 battle_new_turn 内冗余 queue_update）
3. **battle.main.php**: 修复 bug 3.1（给 battle_new_turn 加 $battle_cache 参数 + 改 finish_check 调用）
4. **新增 battle_get_alive_pids()**: battle.main.php 或 battle.func.php
5. **battle.main.php::battle_queue_check**: 用 battle_get_alive_pids 替代原地格式转换
6. **battle.main.php::battle_main**: 加 $battle_cache 参数,删除内部初始化和队列调用
7. **新增 battle.main.php::battle_manage_queue**: 封装 queue_check + finish_check
8. **battle.entry.php**: 4 个入口函数注入 battle_cache 并分离 battle_main + battle_manage_queue 调用
9. **PHP 语法检查**
10. **MCP 浏览器测试**: 入口 1 玩家突袭场景功能不变

---

## 九、验证点

实施后需验证:
- 入口 1 玩家突袭流程:
  - 玩家行动 → 伤害判定 → 后补票建队列 → 先攻判定玩家顺位 1
  - battle_queue_done（玩家 done=1）
  - battle_queue_update 检测到 NPC 未 done,不重建不解散
  - battle_finish_check 看到 bid>0 → battle_new_turn 恢复玩家 AP + save
  - 状态机保持 PLAYER_ACTING,等前端 tick 推进后转 NPC_ACTING

- NPC 先攻轮（入口 4）流程:
  - NPC 行动 → 伤害判定 → battle_queue_done NPC → battle_queue_update
  - 若下一位是玩家 → battle_finish_check → battle_new_turn → 状态机 reset 为 WAITING_PLAYER
  - 若下一位是 NPC → 同上 → 状态机保持 NPC_ACTING，tick 继续

- 多 NPC 复杂场景:队列重建、解散、多人先攻收官等行为保持不变