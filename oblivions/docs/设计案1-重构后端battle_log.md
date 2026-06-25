# 设计案1：重构后端 battle_log

> 本文档定义后端 `BattleLogCollector` 的重构方案：phase 细分 + emit() 签名改造 + 字段补全。
>
> **所属总纲**：[战斗演出三层架构设计案.md](战斗演出三层架构设计案.md)
> **依赖**：无（基础层）
> **下游**：[设计案2-新建前端导演系统.md](设计案2-新建前端导演系统.md)

---

## 一、设计目标

### 1.1 核心问题

当前 `BattleLogCollector.emit()` 存在两大问题：

1. **phase 粗粒度**：只有 5 个粗粒度 phase（prepare/verify/excute/queue_check/finish_check），所有 emit 用统一字段结构，导致：
   - 不需要的字段填占位符（`target_pid=0`, `target_type=-1`）
   - 需要的字段塞进 `extra`（HP 快照、qid、rolls 等）

2. **字段缺失**：emit 时未给全原料（名称、HP 快照），前端被迫查 API 或反推

### 1.2 改动目标

1. **phase 细分**：从 5 个粗粒度 phase 细分为 8 个事件类型 phase
2. **emit() 签名改造**：未提供的字段记为 `null`，不填占位符
3. **字段补全**：各 emit 调用点补全名称/HP/AP 等原料
4. **消除 extra 滥用**：HP/AP/qid/rolls 等变成正式字段
5. **伤害拆分**：`battle_once_excute` 的单次 emit 拆分为 `damage_pre` + `damage_post` 两次 emit

---

## 二、phase 细分方案

### 2.1 当前 phase（粗粒度）

| phase | 对应 battle_main 阶段 | 说明 |
|-------|---------------------|------|
| `prepare` | battle_prepare | AP 恢复 |
| `verify` | battle_verify | 技能校验 |
| `excute` | battle_excute | 伤害判定 |
| `queue_check` | battle_queue_check | 队列检查 |
| `finish_check` | battle_finish_check | 结束检查 |

### 2.2 细分后 phase（事件类型）

| 细分 phase | 原 phase | 最小参数集 | 说明 |
|-----------|---------|-----------|------|
| `turn_start` | prepare | `turn` | 回合开始 |
| `ap_recover` | prepare | `actor_pid`, `actor_name`, `ap_before`, `ap_after`, `ap_max` | AP 恢复 |
| `initiative_roll` | excute | `qid`, `rolls`, `ambush_pid` | 先攻掷骰 |
| `queue_create` | queue_check | `qid`, `combatants`, `is_rebuild` | 队列创建/重建 |
| `damage_pre` | excute | `actor_pid`, `actor_name`, `actor_hp`, `actor_max_hp`, `target_pid`, `target_name`, `target_hp`, `target_max_hp`, `action_id` | 伤害前快照 |
| `damage_post` | excute | `actor_pid`, `target_pid`, `action_id`, `effect_value`, `actor_hp`, `target_hp` | 伤害后快照 |
| `skill_failed` | verify | `actor_pid`, `action_id`, `reason` | 技能校验失败 |
| `battle_end` | finish_check | `reason`, `winner_pid` | 战斗结束 |

### 2.3 phase 与 action_id 的关系

细分后 phase 和 action_id 是**正交**的：

- `phase` 回答"这是什么类型的事件"（伤害前/伤害后/AP恢复/...）
- `action_id` 回答"具体用了什么动作"（unarmed_strike/escape/...）

| phase | action_id | 含义 |
|-------|-----------|------|
| `damage_pre` | `unarmed_strike` | 空手攻击的伤害前快照 |
| `damage_post` | `unarmed_strike` | 空手攻击的伤害后快照 |
| `damage_pre` | `escape` | 逃跑的伤害前快照 |
| `ap_recover` | `null` | AP 恢复（无具体动作） |
| `battle_end` | `null` | 战斗结束（无具体动作） |

---

## 三、emit() 签名改造

### 3.1 当前签名

```php
// battle_log.func.php 当前 emit()
public function emit(array $params) {
    $this->entries[] = [
        'actor_pid'    => (int)($params['actor_pid'] ?? 0),      // 占位符 0
        'actor_type'   => (int)($params['actor_type'] ?? -1),    // 占位符 -1
        'target_pid'   => (int)($params['target_pid'] ?? 0),     // 占位符 0
        'target_type'  => (int)($params['target_type'] ?? -1),   // 占位符 -1
        'action_id'    => (string)($params['action_id'] ?? ''),  // 占位符 ''
        'effect_value' => (int)($params['effect_value'] ?? 0),   // 占位符 0
        'extra'        => isset($params['extra']) ? $params['extra'] : null,
        'ts'           => time(),
        'phase'        => $this->phase,
    ];
}
```

### 3.2 改造后签名

```php
// 改造后 emit()：未提供的字段记为 null
public function emit(array $params) {
    $this->entries[] = [
        // ── 事件标识 ──
        'phase'        => $this->phase,                    // 细分后的 phase
        'action_id'    => $params['action_id']    ?? null, // 具体动作（可为 null）

        // ── 行动者信息 ──
        'actor_pid'    => $params['actor_pid']    ?? null, // null = 不适用
        'actor_type'   => $params['actor_type']   ?? null, // null = 不适用
        'actor_name'   => $params['actor_name']   ?? null, // 显示名
        'actor_hp'     => $params['actor_hp']     ?? null, // 当前 HP 快照
        'actor_max_hp' => $params['actor_max_hp'] ?? null, // 最大 HP
        'actor_ap'     => $params['actor_ap']     ?? null, // 当前 AP（ap_recover 用）
        'actor_max_ap' => $params['actor_max_ap'] ?? null, // 最大 AP

        // ── 目标信息 ──
        'target_pid'    => $params['target_pid']    ?? null,
        'target_type'   => $params['target_type']   ?? null,
        'target_name'   => $params['target_name']   ?? null,
        'target_hp'     => $params['target_hp']     ?? null,
        'target_max_hp' => $params['target_max_hp'] ?? null,

        // ── 效果 ──
        'effect_value' => $params['effect_value'] ?? null, // 伤害值/恢复量

        // ── 事件元数据（按 phase 不同而不同）──
        'turn'         => $params['turn']         ?? null, // 回合编号（turn_start 用）
        'qid'          => $params['qid']          ?? null, // 队列编号（initiative_roll/queue_create 用）
        'rolls'        => $params['rolls']        ?? null, // 先攻掷骰结果
        'ambush_pid'   => $params['ambush_pid']   ?? null, // 突袭者 PID
        'combatants'   => $params['combatants']   ?? null, // 参战者列表
        'is_rebuild'   => $params['is_rebuild']   ?? null, // 是否重建队列
        'reason'       => $params['reason']       ?? null, // 失败/结束原因
        'winner_pid'   => $params['winner_pid']   ?? null, // 胜利者 PID

        // ── 时间戳 ──
        'ts'           => time(),
    ];
}
```

### 3.3 改动要点

1. **消除占位符**：未提供的字段记为 `null`，不填 `0`/`-1`/`''`
2. **消除 extra**：所有字段都是正式字段，不再用 `extra` 容器
3. **字段按 phase 可选**：不同 phase 填不同字段，未填的为 `null`

---

## 四、各 emit 调用点改动

### 4.1 伤害执行（battle.main.php:115）

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

**改造后**：拆分为 `damage_pre` + `damage_post` 两次 emit

```php
// 改造后代码
$actor_oldhp  = (int)$actor_data['hp'];
$target_oldhp = (int)$target_data['hp'];

// ── 伤害前 emit ──
$obl_battle_log->setPhase('damage_pre');
$obl_battle_log->emit([
    'actor_pid'    => (int)$actor_data['pid'],
    'actor_type'   => (int)$actor_data['type'],
    'actor_name'   => $actor_data['name'],
    'actor_hp'     => $actor_oldhp,
    'actor_max_hp' => (int)$actor_data['mhp'],
    'target_pid'   => (int)$target_data['pid'],
    'target_type'  => (int)$target_data['type'],
    'target_name'  => $target_data['name'],
    'target_hp'    => $target_oldhp,
    'target_max_hp'=> (int)$target_data['mhp'],
    'action_id'    => $act_id,
]);

// 执行伤害
$damage = obl_calc_damage($actor_data, $target_data, $act_id, $battle_cache);
battle_apply_damage($actor_data, $target_data, $damage, $obl_battle_log, $battle_cache);

// ── 伤害后 emit ──
$obl_battle_log->setPhase('damage_post');
$obl_battle_log->emit([
    'actor_pid'    => (int)$actor_data['pid'],
    'target_pid'   => (int)$target_data['pid'],
    'action_id'    => $act_id,
    'effect_value' => $damage,
    'actor_hp'     => (int)$actor_data['hp'],      // 伤害后 HP
    'target_hp'    => (int)$target_data['hp'],     // 伤害后 HP
]);
```

**改动要点**：
- 拆分为两次 emit，每次只记录"当前 HP"（事实），不记录"变化量"（演出语义）
- `damage_pre` 携带名称/最大HP（模态框显示用）
- `damage_post` 只携带变化的字段（HP + 伤害值）
- 删除 `extra` 容器

### 4.2 战斗结束（battle.func.php:38）

**当前**：

```php
$obl_battle_log->emit([
    'actor_pid'   => (int)$actor_data['pid'],
    'actor_type'  => (int)$actor_data['type'],
    'target_pid'  => 0,           // ← 占位符
    'target_type' => -1,          // ← 占位符
    'action_id'   => 'battle_end',
    'extra'       => ['ended' => true],
]);
```

**改造后**：

```php
$obl_battle_log->setPhase('battle_end');
$obl_battle_log->emit([
    'winner_pid'  => (int)$actor_data['pid'],
    'reason'      => $reason,  // 'player_won' / 'player_dead' / 'player_escaped'
]);
```

**改动要点**：
- 消除占位符 `target_pid=0`, `target_type=-1`
- 删除 `extra`，`reason`/`winner_pid` 成为正式字段
- `action_id` 为 null（battle_end 无具体动作）

### 4.3 先攻掷骰（battle.func.php:76）

**当前**：

```php
$obl_battle_log->emit([
    'actor_pid'   => (int)$actor_data['pid'],
    'actor_type'  => (int)$actor_data['type'],
    'target_pid'  => 0,           // ← 占位符
    'target_type' => -1,          // ← 占位符
    'action_id'   => 'initiative.roll',
    'extra'       => [
        'qid' => $qid,
        'rolls' => $initiative_result,
        'ambush_pid' => $ambush_pid,
    ],
]);
```

**改造后**：

```php
$obl_battle_log->setPhase('initiative_roll');
$obl_battle_log->emit([
    'qid'        => $qid,
    'rolls'      => $initiative_result,
    'ambush_pid' => $ambush_pid,
]);
```

**改动要点**：
- 消除占位符 `actor_pid`/`target_pid`（先攻掷验不是某个人的行动）
- 删除 `extra`，`qid`/`rolls`/`ambush_pid` 成为正式字段

### 4.4 队列创建（battle.func.php:144）

**当前**：

```php
$obl_battle_log->emit([
    'actor_pid'   => (int)$actor_data['pid'],
    'actor_type'  => (int)$actor_data['type'],
    'target_pid'  => 0,           // ← 占位符
    'target_type' => -1,          // ← 占位符
    'action_id'   => $is_rebuild ? 'queue_rebuild' : 'queue_create',
    'extra'       => ['qid' => $qid, 'combatants' => $combatants],
]);
```

**改造后**：

```php
$obl_battle_log->setPhase('queue_create');
$obl_battle_log->emit([
    'qid'        => $qid,
    'combatants' => $combatants,
    'is_rebuild' => $is_rebuild,
]);
```

**改动要点**：
- 消除占位符
- 删除 `extra`，`qid`/`combatants`/`is_rebuild` 成为正式字段
- `action_id` 为 null（队列创建无具体动作）

### 4.5 AP 恢复（battle.func.php:372）

**当前**：

```php
$obl_battle_log->emit([
    'actor_pid'    => (int)$actor_data['pid'],
    'actor_type'   => (int)$actor_data['type'],
    'target_pid'   => (int)$actor_data['pid'],    // ← 自己（语义模糊）
    'target_type'  => (int)$actor_data['type'],   // ← 自己
    'action_id'    => 'ap_recover',
    'effect_value' => $recovered,
]);
```

**改造后**：

```php
$obl_battle_log->setPhase('ap_recover');
$obl_battle_log->emit([
    'actor_pid'   => (int)$actor_data['pid'],
    'actor_name'  => $actor_data['name'],
    'actor_ap'    => (int)$actor_data['ap'],       // 恢复后 AP
    'actor_max_ap'=> (int)$actor_data['max_ap'],
    'effect_value'=> $recovered,                    // 恢复量
]);
```

**改动要点**：
- 消除 `target_pid=自己`（AP 恢复没有目标概念）
- 补全 `actor_name`/`actor_ap`/`actor_max_ap`
- `action_id` 为 null（AP 恢复无具体动作）

### 4.6 技能失败（skill.main.php:178/193）

**当前**：

```php
$obl_battle_log->emit([
    'actor_pid'   => (int)$actor_data['pid'],
    'actor_type'  => (int)$actor_data['type'],
    'target_pid'  => 0,           // ← 占位符
    'target_type' => -1,          // ← 占位符
    'action_id'   => $act_id,
    'extra'       => ['result' => 'failed', 'reason' => 'no_config'],
]);
```

**改造后**：

```php
$obl_battle_log->setPhase('skill_failed');
$obl_battle_log->emit([
    'actor_pid'  => (int)$actor_data['pid'],
    'action_id'  => $act_id,
    'reason'     => 'no_config',  // 'no_config' / 'not_owned' / 'cd_not_ready' / ...
]);
```

**改动要点**：
- 消除占位符 `target_pid`/`target_type`
- 删除 `extra`，`reason` 成为正式字段

### 4.7 回合开始（battle.main.php battle_new_turn）

**当前**：可能已有 turn_start emit（需确认），或需新增

**改造后**：

```php
$obl_battle_log->setPhase('turn_start');
$obl_battle_log->emit([
    'turn' => $obl_battle_log->getTurn(),
]);
```

**改动要点**：
- 只需要 `turn` 编号
- 其他字段为 null

---

## 五、setPhase 调用点调整

### 5.1 当前 setPhase 调用

| 位置 | 当前 phase | 改造后 |
|------|-----------|--------|
| `battle.main.php:29` | `verify` | 删除（skill_failed 内部 setPhase） |
| `battle.main.php:35` | `excute` | 删除（damage_pre/damage_post 内部 setPhase） |
| `battle.main.php:40` | `queue_check` | 删除（queue_create 内部 setPhase） |
| `battle.main.php:44` | `finish_check` | 删除（battle_end 内部 setPhase） |
| `battle.main.php:214` | `prepare` | 删除（ap_recover 内部 setPhase） |

### 5.2 改造原则

phase 不再由 `battle_main` 的函数调用流程驱动，而是由各 emit 调用点内部 `setPhase()` 驱动。这样：
- phase 语义从"函数阶段"变成"事件类型"
- 每个 emit 调用点明确知道自己是什么事件
- `battle_main` 不需要关心 phase 设置

---

## 六、实施步骤

### 阶段1：emit() 签名改造

**文件**：`oblivions/include/game/battle_log.func.php`

1. 修改 `emit()` 方法，按 3.2 节改造签名
2. 删除 `extra` 字段
3. 未提供的字段记为 `null`

### 阶段2：各 emit 调用点改造

**文件及改动**：

| 文件 | 函数 | 改动 |
|------|------|------|
| `battle/battle.main.php` | `battle_once_excute` | 拆分为 damage_pre + damage_post 两次 emit |
| `battle/battle.main.php` | `battle_new_turn` | 新增 turn_start emit |
| `battle/battle.func.php` | `battle_end` emit | 消除占位符，reason/winner_pid 成为正式字段 |
| `battle/battle.func.php` | `initiative.roll` emit | 消除占位符，qid/rolls/ambush_pid 成为正式字段 |
| `battle/battle.func.php` | `queue_create` emit | 消除占位符，qid/combatants/is_rebuild 成为正式字段 |
| `battle/battle.func.php` | `battle_ap_recover` | 消除 target_pid=自己，补全 AP 快照 |
| `skill/skill.main.php` | 技能失败 emit | 消除占位符，reason 成为正式字段 |

### 阶段3：setPhase 调用点调整

**文件**：`battle/battle.main.php`

1. 删除 `battle_main` 中的 5 处 `setPhase` 调用
2. 各 emit 调用点内部 `setPhase` 后再 emit

### 阶段4：验证

1. PHP 语法检查：`php -l` 各改动文件
2. battlelog JSON 检查：触发战斗后检查 `obl_battle_log_*.json`，确认：
   - 新字段已写入
   - 无占位符（0/-1）
   - 无 extra 字段
   - damage_pre/damage_post 成对出现

---

## 七、边界情况

### 7.1 伤害前/后配对

`damage_pre` 和 `damage_post` 必须成对出现。当前 `battle_once_excute` 中两次 emit 之间无其他 emit，前端导演可按顺序配对。

未来如果引入反击/连击，需增加 `damage_id` 字段关联（当前不需要）。

### 7.2 无目标事件

`turn_start`/`initiative_roll`/`queue_create`/`battle_end`/`ap_recover` 等事件无目标，`target_*` 字段为 `null`。前端导演据此判定为 flow 模式。

### 7.3 旧 battlelog 兼容

改造后 battlelog JSON 格式变化，旧的 `played=0` 条目可能无法正确播放。建议：
- 改造前清理所有 battlelog 文件（`obl_battle_log_clear_all()`）
- 或在 `obl_battle_log_load` 中过滤掉旧格式条目

### 7.4 extra 字段彻底删除

改造后 `emit()` 不再有 `extra` 字段。如果有其他代码读取 `entry.extra`，需同步修改。

---

## 八、验证检查清单

- [ ] `emit()` 签名改造完成（null 替代占位符，删除 extra）
- [ ] `battle_once_excute` 拆分为 damage_pre + damage_post
- [ ] `battle_end` emit 消除占位符
- [ ] `initiative.roll` emit 消除占位符
- [ ] `queue_create` emit 消除占位符
- [ ] `ap_recover` emit 消除 target_pid=自己，补全 AP 快照
- [ ] 技能失败 emit 消除占位符
- [ ] `turn_start` emit 新增
- [ ] `battle_main` 中 setPhase 调用删除
- [ ] PHP 语法检查通过
- [ ] battlelog JSON 检查通过（新字段 + 无占位符 + 无 extra）
