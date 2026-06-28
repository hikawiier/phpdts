# 设计案1：重构后端 battle_log（v2）

> 本文档定义后端 `BattleLogCollector` 的重构方案：12 phase 体系 + emit() 签名改造 + debug/渲染分离 + 两层 setPhase 策略。
>
> **所属总纲**：[战斗演出三层架构设计案.md](战斗演出三层架构设计案.md)
> **依赖**：无（基础层）
> **下游**：[设计案2-新建前端导演系统.md](设计案2-新建前端导演系统.md)

---

## 一、设计目标

### 1.1 核心问题

当前 `BattleLogCollector.emit()` 存在三大问题：

1. **phase 粗粒度**：只有 4 个实际使用的 phase（verify/excute/queue_check/prepare），所有 emit 用统一字段结构，不需要的字段填占位符（`target_pid=0`, `target_type=-1`），需要的字段塞进 `extra`
2. **字段缺失**：emit 时未给全原料（名称、HP 快照），前端被迫查 API 或反推
3. **无渲染/调试区分**：一回合战斗产生 ~50 条 log，其中超过一半是纯流程追踪，前端被迫全量解析

### 1.2 改动目标

1. **phase 细分**：从 4 个粗粒度 phase 细分为 12 个事件类型 phase
2. **emit() 签名改造**：未提供的字段记为 `null`，不填占位符；新增 `debug` 参数区分渲染/调试
3. **字段补全**：各 emit 调用点补全名称/HP/AP 等原料
4. **消除 extra**：所有字段成为正式字段，`battle_log` 仅存放渲染原料或调试信息，无中间容器
5. **伤害拆分**：`battle_once_execute` 的单次 emit 拆分为 `once_execute_pre` + `once_execute_post` 两次 emit，语义扩大为"动作执行前后快照"
6. **渲染/调试分离**：添加 `debug` 布尔字段，前端默认过滤 `debug=true` 条目

---

## 二、phase 完整表

### 2.1 当前 phase（实际使用）

| phase | 对应阶段 | 说明 |
|-------|---------|------|
| `verify` | battle_main 中的 skill 校验期 | 技能校验（已移除 emit） |
| `excute` | battle_main 中的执行期 | 伤害/动作执行 |
| `queue_check` | battle_manage_queue | 队列管理期 |
| `prepare` | battle_manage_queue 尾部 | AP 恢复期 |

### 2.2 细分后 phase

| phase | 来源 emit | 参数 | 渲染 | debug 策略 |
|-------|----------|------|------|-----------|
| `initiative_roll` | `queue_create_and_init` / `queue_set_initiative` | `qid`, `rolls`, `ambush_pid` | ✓ | phase 级 |
| `queue_create` | `queue_create_and_init` | `qid`, `combatants` | ✗ | phase 级 |
| `queue_rebuild` | `battle_queue_rebuild` | `qid` | ✗ | phase 级 |
| `once_execute_pre` | `battle_once_execute`（前快照） | `actor_pid/name/hp/mhp`, `target_pid/name/hp/mhp`, `action_id` | ✓ | phase 级 |
| `once_execute_post` | `battle_once_execute`（后快照） | `actor_pid/hp`, `target_pid/hp`, `action_id`, `effect_value`, `success` | ✓ | phase 级 |
| `execute_verify_failed` | `battle_execute_verify` | `actor_pid/name`, `action_id`, `reason` | ✓ | phase 级 |
| `middle_check_target_dead` | `battle_state_middle_check` | `actor_pid`, `target_pid/name`, `action_id` | ✓ | **条目级** |
| `main_end_cleanup` | `battle_main_end` | `actor_pid`, `reason` | ✓ | **条目级** |
| `actor_state_check` | `battle_actor_can_act` | `actor_pid`, `reason` | ✗ | phase 级 |
| `ap_recover` | `battle_ap_recover` | `actor_pid/name`, `actor_ap/max_ap`, `effect_value` | ✓ | phase 级 |
| `flee` | `escape_calc` | `actor_pid/name`, `success` | ✓ | phase 级 |
| `battle_end` | `battle_main_end` / `battle_manage_queue` | `winner_pid`, `reason` | ✓ | 条目级 |

### 2.3 phase 与 action_id 的关系

一些 phase 的 `action_id` 可为 null：

| phase | action_id | 含义 |
|-------|-----------|------|
| `once_execute_pre` | `unarmed_strike` | 空手攻击的前快照 |
| `once_execute_post` | `unarmed_strike` | 空手攻击的后快照 |
| `execute_verify_failed` | `unarmed_strike` | 空手攻击执行校验失败 |
| `flee` | `null` | 逃跑（无具体动作） |
| `ap_recover` | `null` | AP 恢复（无具体动作） |
| `battle_end` | `null` | 战斗结束（无具体动作） |
| `initiative_roll` | `null` | 先攻掷骰（无具体动作） |

---

## 三、emit() 签名改造

### 3.1 当前签名

```php
public function emit(array $params) {
    $this->entries[] = [
        'actor_pid'    => (int)($params['actor_pid'] ?? 0),
        'actor_type'   => (int)($params['actor_type'] ?? -1),
        'target_pid'   => (int)($params['target_pid'] ?? 0),
        'target_type'  => (int)($params['target_type'] ?? -1),
        'action_id'    => (string)($params['action_id'] ?? ''),
        'effect_value' => (int)($params['effect_value'] ?? 0),
        'extra'        => isset($params['extra']) ? $params['extra'] : null,
        'ts'           => time(),
        'phase'        => $this->phase,
    ];
}
```

### 3.2 改造后签名

```php
public function emit(array $params, ?bool $debug = null) {
    $this->entries[] = [
        // ── 事件标识 ──
        'phase'        => $this->phase,
        'action_id'    => $params['action_id']    ?? null,

        // ── 行动者信息 ──
        'actor_pid'    => $params['actor_pid']    ?? null,
        'actor_type'   => $params['actor_type']   ?? null,
        'actor_name'   => $params['actor_name']   ?? null,
        'actor_hp'     => $params['actor_hp']     ?? null,
        'actor_max_hp' => $params['actor_max_hp'] ?? null,
        'actor_ap'     => $params['actor_ap']     ?? null,
        'actor_max_ap' => $params['actor_max_ap'] ?? null,

        // ── 目标信息 ──
        'target_pid'    => $params['target_pid']    ?? null,
        'target_type'   => $params['target_type']   ?? null,
        'target_name'   => $params['target_name']   ?? null,
        'target_hp'     => $params['target_hp']     ?? null,
        'target_max_hp' => $params['target_max_hp'] ?? null,

        // ── 效果 ──
        'effect_value' => $params['effect_value'] ?? null,
        'success'      => $params['success']      ?? null,

        // ── 事件元数据 ──
        'qid'        => $params['qid']        ?? null,
        'rolls'      => $params['rolls']      ?? null,
        'ambush_pid' => $params['ambush_pid'] ?? null,
        'combatants' => $params['combatants'] ?? null,
        'reason'     => $params['reason']     ?? null,
        'winner_pid' => $params['winner_pid'] ?? null,

        // ── 渲染/调试区分 ──
        'debug' => $debug,

        // ── 时间戳 ──
        'ts'   => time(),
    ];
}
```

### 3.3 改动要点

1. **消除占位符**：未提供的字段记为 `null`，不填 `0`/`-1`/`''`
2. **消除 extra**：所有字段都是正式字段，无 `extra` 容器
3. **字段按 phase 可选**：不同 phase 填不同字段，未填的为 `null`
4. **新增 `debug` 参数**：控制该条 log 是渲染原料还是调试信息
5. **新增 `success` 字段**：动作是否成功（flee/execute 通用）

### 3.4 phase 默认 debug 映射

`BattleLogCollector` 维护一个 phase 级默认 debug 表：

```php
private static array $phaseDebugDefault = [
    'initiative_roll'       => false,
    'queue_create'          => true,
    'queue_rebuild'         => true,
    'once_execute_pre'      => false,
    'once_execute_post'     => false,
    'execute_verify_failed' => false,
    'middle_check_target_dead' => false,  // 条目级覆盖
    'main_end_cleanup'      => false,     // 条目级覆盖
    'actor_state_check'     => true,
    'ap_recover'            => false,
    'flee'                  => false,
    'battle_end'            => false,
];
```

emit 时未显式传 `debug` 时，默认值取自该表：

```php
public function emit(array $params, ?bool $debug = null) {
    $debug = $debug ?? (self::$phaseDebugDefault[$this->phase] ?? true);
    // ...
}
```

`null` = 自动推断，`true`/`false` = 显式覆盖。

### 3.5 回传侧过滤：obl_battle_log_load 改造

当前前端轮询未播放日志的函数是 `obl_battle_log_load($groomid, $pid)`，返回所有 `played=0` 条目。

改造后新增 `$includeDebug` 参数：

```php
/**
 * @param int  $groomid      房间 ID
 * @param int  $pid          玩家 ID
 * @param bool $includeDebug 是否包含 debug 条目（默认 false）
 * @return array 未播放的战斗日志条目数组
 */
function obl_battle_log_load($groomid, $pid, $includeDebug = false) {
    // ... 读取文件逻辑不变 ...

    // 过滤逻辑：
    // 1. 始终过滤 played=0
    // 2. 非调试模式过滤 debug=true
    $unplayed = [];
    foreach ($entries as $e) {
        if (empty($e['played']) || (int)$e['played'] === 0) {
            if (!$includeDebug && !empty($e['debug'])) continue;
            $unplayed[] = $e;
        }
    }

    return $unplayed;
}
```

**过滤策略分层**：

| 入口 | $includeDebug | 用途 |
|------|--------------|------|
| 前端轮询 `check_unplayed_battle_log.php` | 默认 `false` | 仅获取渲染原料，减小 payload |
| 前端 dev 面板（可选） | `true` | 调试模式查看完整 log |
| 后端内部处理 | 按需 | 不影响后端逻辑执行 |

**前端渲染管线入口**：

```typescript
// check_unplayed_battle_log.php 返回的 entries 默认已过滤 debug=true
// BattleDirector 不再需要 filter(debug)，拿到即原料
function orchestrate(entries: BattleLogEntry[]): Script {
    // entries 全是 debug=false 的纯原料
}
```

---

## 四、各 emit 调用点改动

### 4.1 once_execute_pre / once_execute_post（battle.main.php, battle_once_execute）

**当前**：单次 emit，HP 快照塞在 extra

```php
// 当前代码
$actor_oldhp  = (int)$actor_data['hp'];
$target_oldhp = (int)$target_data['hp'];
$damage = obl_calc_damage(...);
battle_apply_damage(...);

$obl_battle_log->emit([
    'actor_pid'    => (int)$actor_data['pid'],
    'actor_type'   => (int)$actor_data['type'],
    'target_pid'   => (int)$target_data['pid'],
    'target_type'  => (int)$target_data['type'],
    'action_id'    => $act_id,
    'effect_value' => $damage,
    'extra'        => [
        'actor_oldhp'   => $actor_oldhp,
        'target_oldhp'  => $target_oldhp,
        'actor_newhp'   => (int)$actor_data['hp'],
        'target_newhp'  => (int)$target_data['hp'],
    ],
]);
```

**改造后**：拆分为 `once_execute_pre` + `once_execute_post`

```php
$actor_oldhp  = (int)$actor_data['hp'];
$target_oldhp = (int)$target_data['hp'];

// ── 动作执行前快照 ──
$obl_battle_log->setPhase('once_execute_pre');
$obl_battle_log->emit([
    'actor_pid'     => (int)$actor_data['pid'],
    'actor_type'    => (int)$actor_data['type'],
    'actor_name'    => $actor_data['name'],
    'actor_hp'      => $actor_oldhp,
    'actor_max_hp'  => (int)$actor_data['mhp'],
    'target_pid'    => (int)$target_data['pid'],
    'target_type'   => (int)$target_data['type'],
    'target_name'   => $target_data['name'],
    'target_hp'     => $target_oldhp,
    'target_max_hp' => (int)$target_data['mhp'],
    'action_id'     => $act_id,
]);

// 技能执行（处理非伤害效果，如逃跑等；可写 tag_mutations，不改 HP）
include_once GAME_ROOT . './oblivions/include/game/skill/skill.main.php';
skill_execute($actor_data, $act_id, $target_data, $obl_battle_log, $battle_cache);

// 执行动作
$damage = obl_calc_damage($actor_data, $target_data, $act_id, $battle_cache);
battle_apply_damage($actor_data, $target_data, $damage, $obl_battle_log, $battle_cache);

// ── 动作执行后快照 ──
$obl_battle_log->setPhase('once_execute_post');
$obl_battle_log->emit([
    'actor_pid'    => (int)$actor_data['pid'],
    'actor_hp'     => (int)$actor_data['hp'],
    'target_pid'   => (int)$target_data['pid'],
    'target_hp'    => (int)$target_data['hp'],
    'action_id'    => $act_id,
    'effect_value' => $damage,
    'success'      => true,
]);
```

**改动要点**：
- 拆分为两次 emit，每次只记录"当前 HP"（事实），不记录"变化量"（演出语义）
- 不再假设"这是伤害"——语义扩大为"动作执行前后世界状态"
- `pre` 携带名称/最大HP（模态框显示用），`post` 只携带变化的字段

### 4.2 execute_verify_failed（battle.main.php, battle_execute_verify, 两处）

**当前**：

```php
// 目标未找到
$obl_battle_log->emit([
    'actor_pid'   => (int)$actor_data['pid'],
    'actor_type'  => (int)$actor_data['type'],
    'target_pid'  => 0,
    'target_type' => -1,
    'action_id'   => "verify.{$act_id}",
    'extra'       => ['result' => 'failed', 'reason' => 'target_not_found'],
]);

// 目标规则失败
$obl_battle_log->emit([
    'actor_pid'   => (int)$actor_data['pid'],
    'actor_type'  => (int)$actor_data['type'],
    'target_pid'  => 0,
    'target_type' => -1,
    'action_id'   => "verify.{$act_id}",
    'extra'       => ['result' => 'failed', 'reason' => $reason, 'tags' => $tags],
]);
```

**改造后**：

```php
// 目标未找到
$obl_battle_log->setPhase('execute_verify_failed');
$obl_battle_log->emit([
    'actor_pid'  => (int)$actor_data['pid'],
    'actor_name' => $actor_data['name'],
    'action_id'  => $act_id,
    'reason'     => 'target_not_found',
]);

// 目标规则失败
$obl_battle_log->setPhase('execute_verify_failed');
$obl_battle_log->emit([
    'actor_pid'  => (int)$actor_data['pid'],
    'actor_name' => $actor_data['name'],
    'action_id'  => $act_id,
    'reason'     => $reason,
]);
```

### 4.3 middle_check_target_dead（battle.main.php, battle_state_middle_check）

**当前**：

```php
$obl_battle_log->emit([
    'actor_pid'   => (int)$actor_data['pid'],
    'actor_type'  => (int)$actor_data['type'],
    'target_pid'  => 0,
    'target_type' => -1,
    'action_id'   => 'state.middle_check',
    'extra'       => ['target_hp' => $target_hp, 'target_state' => $target_state, 'tags' => $tags],
]);
```

**改造后**：

```php
$obl_battle_log->setPhase('middle_check_target_dead');
$obl_battle_log->emit([
    'actor_pid'   => (int)$actor_data['pid'],
    'target_pid'  => (int)$target_data['pid'],
    'target_name' => $target_data['name'],
    'action_id'   => $act_id,
], $debug);  // 条目级 debug：具体 emit 处决定 true/false
```

### 4.4 main_end_cleanup（battle.main.php, battle_main_end, 两处）

**当前**：

```php
// 成功清理（死亡或逃跑）
$obl_battle_log->emit([
    'actor_pid'   => (int)$actor_data['pid'],
    'actor_type'  => (int)$actor_data['type'],
    'target_pid'  => 0,
    'target_type' => -1,
    'action_id'   => 'main_end.fallback',
    'extra'       => ['ended' => true, 'target_state' => $target_state],
]);

// 兜底清理
$obl_battle_log->emit([
    'actor_pid'   => (int)$actor_data['pid'],
    'actor_type'  => (int)$actor_data['type'],
    'target_pid'  => 0,
    'target_type' => -1,
    'action_id'   => 'main_end.fallback',
    'extra'       => ['combatants' => 0],
]);
```

**改造后**：

```php
// 成功清理
$obl_battle_log->setPhase('main_end_cleanup');
$obl_battle_log->emit([
    'actor_pid'  => (int)$actor_data['pid'],
    'reason'     => !empty($mutations['escaped']) ? 'target_escaped' : 'target_dead',
], false);  // 渲染必要

// 兜底清理（combatants=0，纯流程追踪）
$obl_battle_log->setPhase('main_end_cleanup');
$obl_battle_log->emit([
    'actor_pid'  => (int)$actor_data['pid'],
    'reason'     => 'fallback_no_combatants',
], true);  // debug
```

### 4.5 battle_end（battle.main.php / battle.queue.main.php, 4 个调用点）

battle_end 不在 `battle_state_clear` 内部 emit，而是在 4 个调用点前分别 emit：

**battle_main_end 成功清理分支（1/4）**：
```php
$obl_battle_log->setPhase('battle_end');
$obl_battle_log->emit([
    'winner_pid' => (int)$pid,
    'reason'     => !empty($mutations['escaped']) ? 'target_escaped' : 'target_dead',
]);
```

**battle_main_end 兜底分支（2/4）**：
```php
$obl_battle_log->setPhase('battle_end');
$obl_battle_log->emit([
    'winner_pid' => (int)$pid,
    'reason'     => 'forced_cleanup',
], true);  // debug
```

**battle_manage_queue 空队列分支（3/4）**：
```php
$obl_battle_log->setPhase('battle_end');
$obl_battle_log->emit([
    'winner_pid' => (int)$actor_data['pid'],
    'reason'     => 'queue_empty',
]);
```

**battle_manage_queue 解散分支（4/4）**：
```php
$obl_battle_log->setPhase('battle_end');
$obl_battle_log->emit([
    'winner_pid' => (int)$actor_data['pid'],
    'reason'     => 'disband',
]);
```

### 4.6 ap_recover（battle.func.php, battle_ap_recover）

**当前**：

```php
$obl_battle_log->emit([
    'actor_pid'    => (int)$actor_data['pid'],
    'actor_type'   => (int)$actor_data['type'],
    'target_pid'   => (int)$actor_data['pid'],
    'target_type'  => (int)$actor_data['type'],
    'action_id'    => 'ap_recover',
    'effect_value' => $recovered,
]);
```

**改造后**：

```php
$obl_battle_log->setPhase('ap_recover');
$obl_battle_log->emit([
    'actor_pid'    => (int)$actor_data['pid'],
    'actor_name'   => $actor_data['name'],
    'actor_ap'     => (int)$actor_data['ap'],
    'actor_max_ap' => (int)$actor_data['max_ap'],
    'effect_value' => $recovered,
]);
```

### 4.7 actor_state_check（battle.func.php, battle_actor_can_act, 两处）

**当前**：

```php
// 行动者死亡
$obl_battle_log->emit([
    'actor_pid'   => (int)$actor_data['pid'],
    'actor_type'  => (int)$actor_data['type'],
    'target_pid'  => 0,
    'target_type' => -1,
    'action_id'   => 'verify.actor',
    'extra'       => ['result' => 'failed', 'reason' => 'actor_dead'],
]);

// 行动者 HP=0
$obl_battle_log->emit([
    'actor_pid'   => (int)$actor_data['pid'],
    'actor_type'  => (int)$actor_data['type'],
    'target_pid'  => 0,
    'target_type' => -1,
    'action_id'   => 'verify.actor',
    'extra'       => ['result' => 'failed', 'reason' => 'actor_hp_zero'],
]);
```

**改造后**：

```php
$obl_battle_log->setPhase('actor_state_check');
$obl_battle_log->emit([
    'actor_pid' => (int)$actor_data['pid'],
    'reason'    => 'actor_dead',
], true);  // phase 级 debug

$obl_battle_log->setPhase('actor_state_check');
$obl_battle_log->emit([
    'actor_pid' => (int)$actor_data['pid'],
    'reason'    => 'actor_hp_zero',
], true);
```

### 4.8 initiative_roll（battle.queue.func.php, queue_create_and_init + queue_set_initiative, 两处）

**当前**：

```php
// queue_create_and_init 处
$obl_battle_log->emit([
    'actor_pid'   => (int)$actor_data['pid'],
    'actor_type'  => (int)$actor_data['type'],
    'target_pid'  => 0,
    'target_type' => -1,
    'action_id'   => 'initiative.roll',
    'extra'       => ['qid' => $qid, 'rolls' => $initiative_result, 'ambush' => $ambush_pid],
]);

// queue_set_initiative 处（重建路径）
$obl_battle_log->emit([
    'actor_pid'   => (int)$actor_data['pid'],
    'actor_type'  => (int)$actor_data['type'],
    'target_pid'  => 0,
    'target_type' => -1,
    'action_id'   => 'initiative.roll',
    'extra'       => ['qid' => $qid, 'rolls' => $initiative_result, 'ambush' => $ambush_pid],
]);
```

**改造后**：

```php
$obl_battle_log->setPhase('initiative_roll');
$obl_battle_log->emit([
    'qid'        => $qid,
    'rolls'      => $initiative_result,  // 含全部参战者的 pid/myorder/roll/initiative/type/is_ambush
    'ambush_pid' => $ambush_pid,
]);
```

### 4.9 queue_create（battle.queue.func.php, queue_create_and_init）

**当前**：

```php
$obl_battle_log->emit([
    'actor_pid'   => (int)$actor_data['pid'],
    'actor_type'  => (int)$actor_data['type'],
    'target_pid'  => 0,
    'target_type' => -1,
    'action_id'   => 'queue_create',
    'extra'       => ['qid' => $qid, 'count' => count($combatants)],
]);
```

**改造后**：

```php
$obl_battle_log->setPhase('queue_create');
$obl_battle_log->emit([
    'qid'        => $qid,
    'combatants' => $combatants,
], true);  // debug
```

### 4.10 queue_rebuild（battle.queue.main.php, battle_queue_rebuild）

**当前**：

```php
$obl_battle_log->emit([
    'actor_pid'   => (int)$actor_data['pid'],
    'actor_type'  => (int)$actor_data['type'],
    'target_pid'  => 0,
    'target_type' => -1,
    'action_id'   => 'queue_rebuild',
    'extra'       => ['qid' => $qid],
]);
```

**改造后**：

```php
$obl_battle_log->setPhase('queue_rebuild');
$obl_battle_log->emit([
    'qid' => $qid,
], true);  // debug
```

### 4.11 flee（escape.calc.php, escape_calc）

**当前**：

```php
$obl_battle_log->emit([
    'actor_pid'   => (int)$actor_data['pid'],
    'actor_type'  => (int)$actor_data['type'],
    'target_pid'  => 0,
    'target_type' => -1,
    'action_id'   => 'flee',
    'extra'       => ['success' => $success],
]);
```

**改造后**：

```php
$obl_battle_log->setPhase('flee');
$obl_battle_log->emit([
    'actor_pid'  => (int)$actor_data['pid'],
    'actor_name' => $actor_data['name'],
    'success'    => $success,
]);
```

### 4.12 技能系统（skill.main.php，6 处 emit）

**移除**：skill 系统不完善，删除现有 6 处 emit 调用。

```php
// 删除以下所有 emit 调用：
//   skill_act_verify() 中的 no_config / not_owned / on_cd / no_ap / verify_check_failed / passed
// 原因：skill 系统不完善，校验过程无需前端渲染，纯后端流程。
```

> 注意：`battle_execute_verify`（battle.main.php 中的执行期目标校验）不属于 skill 系统，按 4.2 节改造保留。

---

## 五、两层 setPhase 策略

### 5.1 策略说明

```
┌─ battle_main / battle_manage_queue ──────────────────────┐
│  setPhase('verify')  ← 外层默认期（无消费者，预留给未来） │
│     └─ battle_verify()  → 无 emit                        │
│                                                          │
│  setPhase('excute')  ← 外层默认期                       │
│     ├─ battle_execute_verify()  → 内部 setPhase 覆盖     │
│     ├─ battle_once_execute()    → 内部 setPhase 覆盖     │
│     ├─ battle_state_middle_check() → 内部 setPhase 覆盖  │
│     └─ battle_main_end()        → 内部 setPhase 覆盖     │
│                                                          │
│  setPhase('queue_check')  ← 外层默认期                  │
│     └─ battle_queue_rebuild()  → 内部 setPhase 覆盖     │
│                                                          │
│  setPhase('prepare')  ← 外层默认期                      │
│     └─ battle_ap_recover()  → 内部 setPhase 覆盖         │
└──────────────────────────────────────────────────────────┘
```

### 5.2 当前 setPhase 调用调整

| 位置 | 当前 phase | 调整 |
|------|-----------|------|
| `battle.main.php:24`（battle_main 入口） | `verify` | **保留**——预留锚点，未来 skill 系统扩展时使用 |
| `battle.main.php:31`（verify 之后） | `excute` | **保留**——作为执行期默认 fallback |
| `battle.queue.main.php:88`（manage_queue 入口） | `queue_check` | **保留**——为 queue_rebuild 等提供默认期 |
| `battle.queue.main.php:157`（manage_queue 尾部） | `prepare` | **保留**——为 ap_recover 提供默认期 |

各子函数内部调用 `setPhase` 覆盖为具体事件 phase。外层 setPhase 仅作为 fallback。

### 5.3 改造原则

- phase 语义从"函数阶段"变成"事件类型"
- 每个 emit 调用点明确知道自己是什么事件
- 外层 setPhase 是默认上下文，子函数按需覆盖
- 不需要 `finish_check` phase（实际代码从未使用）

---

## 六、渲染/调试条目数估算

改造后各模式下的条目估算：

**渲染条目（debug=false，前消费）**：

| emit 类型 | 单次计数 | 典型回合数 | 小计 |
|-----------|---------|-----------|------|
| initiative_roll | 1 | 1 | 1 |
| ap_recover | 1 | 1 | 1 |
| once_execute_pre | 1 | 8 | 8 |
| once_execute_post | 1 | 8 | 8 |
| execute_verify_failed | ~0.5 | 8 | ~4 |
| middle_check_target_dead（非 debug） | ~0.2 | 8 | ~2 |
| main_end_cleanup（非 debug） | ~0.5 | 8 | ~1 |
| battle_end | 1 | 1 | 1 |
| **渲染小计** | | | **~26** |

**调试条目（debug=true，后端保留前端不消费）**：

| emit 类型 | 单次计数 | 典型回合数 | 小计 |
|-----------|---------|-----------|------|
| queue_create | 1 | 1 | 1 |
| actor_state_check | ~0.3 | 8 | ~2 |
| queue_rebuild | ~0.2 | 8 | ~2 |
| middle_check_target_dead（debug） | ~0.1 | 8 | ~1 |
| main_end_cleanup（debug） | ~0.5 | 8 | ~1 |
| **debug 小计** | | | **~7** |

渲染管线处理量从 ~50 降到 ~26，debug 信息保留但前端默认不获取。

---

## 七、实施步骤

### 阶段1：BattleLogCollector 类 + 回传函数改造

**文件**：`oblivions/include/game/battle_log.func.php`

1. 修改 `emit()` 方法，按 3.2 节改造签名
2. 新增 `$phaseDebugDefault` 静态映射表
3. 删除 `extra` 字段
4. 未提供的字段记为 `null`
5. 新增 `debug` 参数和默认推断逻辑
6. 改造 `obl_battle_log_load()`，新增 `$includeDebug` 参数（3.5 节）

### 阶段2：各 emit 调用点改造

**文件及改动**：

| 文件 | 函数 | 改动 |
|------|------|------|
| `battle/battle.main.php` | `battle_once_execute` | 拆分为 once_execute_pre + once_execute_post |
| `battle/battle.main.php` | `battle_execute_verify` | phase 改为 execute_verify_failed，补全 actor_name |
| `battle/battle.main.php` | `battle_state_middle_check` | phase 改为 middle_check_target_dead |
| `battle/battle.main.php` | `battle_main_end` | phase 改为 main_end_cleanup，条目级 debug |
| `battle/battle.func.php` | `battle_state_clear` | phase 改为 battle_end，消除占位符 |
| `battle/battle.func.php` | `battle_ap_recover` | phase 改为 ap_recover，补全 AP 快照 |
| `battle/battle.func.php` | `battle_actor_can_act` | phase 改为 actor_state_check，标记 debug |
| `battle/battle.queue.main.php` | `battle_queue_rebuild` | phase 改为 queue_rebuild，标记 debug |
| `battle/battle.queue.func.php` | `queue_create_and_init` | phase 改为 initiative_roll / queue_create |
| `battle/battle.queue.func.php` | `queue_set_initiative` | phase 改为 initiative_roll |
| `escape/escape.calc.php` | `escape_calc` | phase 改为 flee，补全 actor_name |

### 阶段3：移除 skill 系统 emit

**文件**：`skill/skill.main.php`

1. 删除 `skill_act_verify()` 中 6 处 emit 调用（no_config / not_owned / on_cd / no_ap / verify_check_failed / passed）
2. 不新增任何替代 emit（校验流程无需前端渲染）

> 此时 `battle_main` 入口的 `setPhase('verify')` 仍保留，但不再有 emit 使用该 phase。可作为未来 skill 系统扩展时的预留锚点。

### 阶段4：验证

1. PHP 语法检查：`php -l` 各改动文件
2. battlelog JSON 检查：触发战斗后查看 `obl_battle_log_*.json`，确认：
   - 新字段已按 phase 写入
   - 无占位符（0/-1/''）
   - 无 extra 字段
   - once_execute_pre/post 成对出现
   - debug 字段存在且值正确
3. 回传过滤验证：触发战斗后调用 `obl_battle_log_load(groomid, pid)`，确认返回条目中无 `debug=true` 的条目
4. 完整日志验证：调用 `obl_battle_log_load(groomid, pid, true)`，确认返回全部条目（含 debug）

---

## 八、边界情况

### 8.1 once_execute_pre/post 配对

两阶段 emit 之间无其他 emit，前端可按顺序配对。未来引入反击/连击时需增加 `action_seq_id` 字段关联（当前不需要）。

### 8.2 无目标事件

`initiative_roll`/`queue_create`/`queue_rebuild`/`ap_recover`/`battle_end` 等事件无目标，`target_*` 字段为 `null`。前端据此判定模式。

### 8.3 旧 battlelog 兼容

改造后 JSON 格式变化。建议：
- 改造前清理所有 battlelog 文件
- 或在 `obl_battle_log_load` 中过滤旧格式条目

### 8.4 debug 字段不影响后端逻辑

`debug` 字段仅用于前端渲染管线过滤。后端写入时不做特殊处理。

### 8.5 已移除的技能系统 emit

skill.main.php 的 6 处 emit 已删除。`battle_main` 入口的 `setPhase('verify')` 不再被任何 emit 消费，作为未来 skill 系统扩展时的预留锚点保留。

### 8.6 obl_battle_log_load 的向后兼容

`$includeDebug` 参数默认值为 `false`，现有调用点不改动即可正常工作。改造前写入的旧格式条目不含 `debug` 字段，`empty($e['debug'])` 为 true → 不会被误过滤。

---

## 九、验证检查清单

- [ ] emit() 签名改造完成（null 替代占位符，删除 extra，新增 debug）
- [ ] battle_once_execute 拆分为 once_execute_pre + once_execute_post
- [ ] battle_execute_verify 改为 execute_verify_failed + 补全 actor_name
- [ ] battle_state_middle_check 改为 middle_check_target_dead
- [ ] battle_main_end 改为 main_end_cleanup + 条目级 debug
- [ ] battle_state_clear 改为 battle_end，消除占位符
- [ ] battle_ap_recover 改为 ap_recover + 补全 AP 快照
- [ ] battle_actor_can_act 改为 actor_state_check + debug
- [ ] queue_create_and_init 新增 queue_create（debug）+ initiative_roll 两次 emit
- [ ] queue_set_initiative 新增 initiative_roll emit
- [ ] battle_queue_rebuild 改为 queue_rebuild + debug
- [ ] escape_calc 改为 flee + 补全 actor_name
- [ ] skill.main.php 中 6 处 emit 调用已删除
- [ ] phase 默认 debug 映射表配置完成
- [ ] obl_battle_log_load() 新增 $includeDebug 参数 + 过滤逻辑
- [ ] PHP 语法检查通过
- [ ] battlelog JSON 检查通过（新字段 + 无占位符 + 无 extra）
