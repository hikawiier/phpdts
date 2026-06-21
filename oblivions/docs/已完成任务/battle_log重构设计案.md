# battle_log 重构设计案

> 版本：v1.1 | 日期：2026-06-22 | 状态：待审核

---

## 1. 背景与目标

### 1.1 当前问题

Oblivions 战斗日志系统（battle_log）存在以下结构性问题：

1. **emit() 签名不可维护**：11 个位置参数，增删字段需数参数位置，极易传错
2. **enemy_pid 语义歧义**：同一字段在 6 个 emit 调用点有 2 种不同计算逻辑，含义不统一
3. **前后端职责混淆**：后端传中文名称（`action_name`/`actor_name`），前端硬编码 switch-case 渲染
4. **字段冗余**：8 个字段前端从未消费（`id`/`actor`/`position`/`entry_type`/`turn`/`played`/`target`字符串/`action_name`）
5. **HP 条不更新**：`battle_once_excute` 的 emit 传 `extra=null`，前端无法获取 HP 变化数据，HP 条无法更新
6. **enemies API 过滤死亡单位**：战斗结束后无法从 API 获取已死亡敌人名称

### 1.2 重构目标

| 目标 | 度量 |
|------|------|
| 消除 enemy_pid 歧义 | 完全移除 enemy_pid 字段，由 actor_pid/target_pid 综合推导 |
| emit 签名可维护 | 改为关联数组传参，增删字段无需数参数位置 |
| 前后端职责分离 | 后端只传索引 ID，前端负责渲染文案 |
| 统一 actor/target 结构 | actor_pid+actor_type / target_pid+target_type 四元组 |
| HP 实时更新 | extra 携带 actor/target 的 oldhp+newhp，前端 HP 条过渡更新 |
| 全局状态同步 | 每条 entry 播放前请求 API，同步 AP/state 等当前状态 |
| enemies API 返回死亡单位 | 调整 SQL 查询，不过滤 state!=0 |

### 1.3 不在本次范围

- 遭遇事件（"你遇到了XX"）的 battle_log 事件设计——留待战斗入口设计完善后
- phase 分阶段渲染模板的完整实现——本次只建立模板系统框架，不实现全部 phase 模板
- 任务 A（enemy_pid → target_pid 入口参数改名）和任务 C（enemy → npc 改名）——独立任务，本次不处理
- `turn` 字段激活——先攻轮计数功能后续实现，本次暂不加入

---

## 2. 新数据结构设计

### 2.1 新 entry 字段定义

```php
[
    'actor_pid'    => (int),    // 行动者 PID
    'actor_type'   => (int),    // 行动者类型：0=玩家，>0=NPC
    'target_pid'   => (int),    // 目标 PID：0=无实体目标
    'target_type'  => (int),    // 目标类型：-1=无实体目标，0=玩家，>0=NPC
    'action_id'    => (string), // 动作 ID（如 'unarmed_strike'）
    'effect_value' => (int),    // 效果值（伤害值、恢复量等）
    'extra'        => (array|null), // 额外信息（HP 快照、事件元数据等）
    'ts'           => (int),    // 时间戳（debug 用）
    // 以下由类属性注入
    'phase'        => (string), // 阶段标识
    // 以下由持久化层注入
    'log_id'       => (int),    // 文件内自增 ID
    'played'       => (int),    // 0=未播放，1=已播放
]
```

**extra 字段内容因 action_id 而异**：

| action_id | extra 内容 | 说明 |
|-----------|-----------|------|
| `unarmed_strike` 等攻击动作 | `actor_oldhp`, `target_oldhp`, `actor_newhp`, `target_newhp` | HP 快照，供前端 HP 条过渡 |
| `battle_end` | `ended` | 事件元数据 |
| `queue_create` | `qid`, `combatants`, `ambush` | 事件元数据 |
| `queue_update` | `qid`, `remaining`, `rebuilt` | 事件元数据 |
| `ap_recover` | 无（null） | — |
| 动作校验 | `result` | 事件元数据 |

### 2.2 字段变更对照表

| 旧字段 | 新字段 | 变化说明 |
|--------|--------|----------|
| `id` | — | 移除：固定值 `'battle.action'` 无意义 |
| `turn` | — | 移除：始终为 0，需要时再加 |
| `actor` (string) | — | 移除：被 actor_pid+actor_type 替代 |
| `actor_name` | — | 移除：前端从 API 数据查找 |
| `actor_type` | `actor_type` | **保留**：语义不变 |
| `action_id` | `action_id` | **保留**：语义不变 |
| `action_name` | — | 移除：前端模板渲染 |
| `target` (string) | — | 移除：被 target_pid+target_type 替代 |
| `effect_value` | `effect_value` | **保留**：语义不变 |
| `extra` | `extra` | **保留**：携带 HP 快照（oldhp+newhp）和事件元数据 |
| `position` | — | 移除：未使用 |
| `ts` | `ts` | **保留**：debug 用 |
| `enemy_pid` | — | **移除**：由 actor_pid/target_pid 综合推导 |
| `entry_type` | — | 移除：前端未使用 |
| `phase` | `phase` | **保留**：语义不变 |
| `log_id` | `log_id` | **保留**：持久化层注入 |
| `played` | `played` | **保留**：持久化层注入 |
| — | `actor_pid` | **新增**：行动者 PID |
| — | `target_pid` | **新增**：目标 PID |
| — | `target_type` | **新增**：目标类型 |

**净变化**：移除 8 个字段，新增 3 个字段，总字段数从 16 降至 11。

### 2.3 target_pid/target_type 取值规则

| 场景 | target_pid | target_type | 示例 |
|------|-----------|-------------|------|
| 实体目标（攻击） | 目标的 PID | 目标的 type | 玩家攻击NPC: `target_pid=NPC_pid, target_type=NPC_type` |
| 自身目标（AP恢复） | actor_pid | actor_type | 玩家AP恢复: `target_pid=player_pid, target_type=0` |
| 无实体目标（系统事件） | 0 | -1 | battle_end: `target_pid=0, target_type=-1` |

**设计约束**：`target_type=0` 保留给"玩家"标识，`-1` 表示"无实体目标"，0 不能兼作哨兵值。

### 2.4 HP 更新方案

**核心原则**：HP 的历史快照由 extra 携带，当前全局状态由 API 同步。

**数据分工**：

| 数据类型 | 来源 | 说明 |
|----------|------|------|
| HP 变化（oldhp→newhp） | `entry.extra` | 每条攻击 entry 携带 actor/target 的扣血前后 HP，前端 HP 条从 oldhp 过渡到 newhp |
| 当前全局状态（AP、state、位置等） | API 请求 | 每条 entry 播放前请求 API，同步非 HP 数据 |

**为什么 HP 不从 API 获取**：battle_log 是战斗结束后播放的，API 返回的是最终 HP，不是每条 entry 时刻的 HP。对于多 entry 战斗，中间 entry 的 HP 无法通过 API 准确获取。extra 携带的 oldhp/newhp 是该 entry 时刻的精确快照。

**为什么仍需每条 entry 请求 API**：AP 变化、敌人 state 变化（存活→死亡）、位置等数据无法从 battle_log 获取，需要 API 同步当前状态。

### 2.5 enemy_pid 消除方案

enemy_pid 当前的 4 个消费场景全部可由 actor_pid/target_pid 替代：

| 消费场景 | 替代方案 |
|----------|----------|
| groupByEnemyPid 分组 | 从 actor_pid/target_pid 中找 type>0 的一方作为 NPC pid |
| getEnemyElement(enemyPid) 定位 DOM | 同上推导 NPC pid |
| buildPlayContext 查找敌人 HP | 同上推导 NPC pid，从 enemies API 查找 |
| playDamageNumbersAfterModal 定位 DOM | 同上推导 NPC pid |

**推导函数**（前端）：
```js
function deriveNpcPid(entry) {
    if (entry.actor_type > 0) return entry.actor_pid;
    if (entry.target_type > 0) return entry.target_pid;
    return 0;
}
```

**分组函数**（前端）：
```js
function groupByEncounter(entries) {
    let npcPid = 0;
    for (const e of entries) {
        npcPid = deriveNpcPid(e);
        if (npcPid > 0) break;
    }
    if (npcPid === 0) return {};
    return { [npcPid]: entries };
}
```

---

## 3. 后端改动

### 3.1 battle_log.func.php — BattleLogCollector 类重构

**文件**：`d:\wamp64\www\phpdts\oblivions\include\game\battle_log.func.php`

#### 3.1.1 emit() 签名变更

```php
// 改前（L71）
public function emit($turn, $actor, $action_id, $action_name, $target, $effect_value = 0, $extra = null, $position = null, $enemy_pid = 0, $actor_name = '', $actor_type = -1)

// 改后
public function emit(array $params)
```

#### 3.1.2 emit() 内部实现

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

#### 3.1.3 移除 entry_type 类属性

`$entry_type` 属性和 `setEntryType()` 方法移除。entry_type 前端从未使用，4 个初始化点的 `setEntryType()` 调用一并移除。

#### 3.1.4 持久化函数不变

`obl_battle_log_persist()`、`obl_battle_log_load()`、`obl_battle_log_mark_played()`、`obl_battle_log_clear_all()` 逻辑不变，仅 entry 的字段结构变化。

### 3.2 battle.func.php — 5 处 emit 调用点改动

**文件**：`d:\wamp64\www\phpdts\oblivions\include\game\battle\battle.func.php`

#### 3.2.1 battle_state_clear（L33-41）

```php
// 改前
if ($obl_battle_log) {
    $actor_id = ($actor_data['type'] == 0) ? 'player' : 'enemy_' . $actor_data['pid'];
    $enemy_pid = ($actor_data['type'] == 0) ? 0 : (int)$actor_data['pid'];
    $obl_battle_log->emit(
        0, $actor_id, 'battle_end', '战斗结束', 'battle', 0,
        array('ended' => true), null, $enemy_pid,
        $actor_data['name'], (int)$actor_data['type']
    );
}

// 改后
if ($obl_battle_log) {
    $obl_battle_log->emit([
        'actor_pid'   => (int)$actor_data['pid'],
        'actor_type'  => (int)$actor_data['type'],
        'target_pid'  => 0,
        'target_type' => -1,
        'action_id'   => 'battle_end',
        'extra'       => ['ended' => true],
    ]);
}
```

**说明**：`battle_end` 是系统事件，无实体目标，`target_pid=0, target_type=-1`。

#### 3.2.2 battle_queue_create（L97-106）

```php
// 改前
if ($obl_battle_log) {
    $actor_id = ($actor_data['type'] == 0) ? 'player' : 'enemy_' . $actor_data['pid'];
    $enemy_pid = ($actor_data['type'] == 0) ? 0 : (int)$actor_data['pid'];
    $obl_battle_log->emit(
        0, $actor_id, 'queue_create', '先攻队列创建', 'queue', 0,
        array('qid' => $qid, 'combatants' => $combatants, 'ambush' => $ambush_flag),
        null, $enemy_pid,
        $actor_data['name'], (int)$actor_data['type']
    );
}

// 改后
if ($obl_battle_log) {
    $obl_battle_log->emit([
        'actor_pid'   => (int)$actor_data['pid'],
        'actor_type'  => (int)$actor_data['type'],
        'target_pid'  => 0,
        'target_type' => -1,
        'action_id'   => 'queue_create',
        'extra'       => ['qid' => $qid, 'combatants' => $combatants, 'ambush' => $ambush_flag],
    ]);
}
```

**说明**：`queue_create` 是系统事件，无实体目标。

#### 3.2.3 battle_queue_update（L196-205）

```php
// 改后
if ($obl_battle_log) {
    $obl_battle_log->emit([
        'actor_pid'   => (int)$actor_data['pid'],
        'actor_type'  => (int)$actor_data['type'],
        'target_pid'  => 0,
        'target_type' => -1,
        'action_id'   => 'queue_update',
        'extra'       => ['qid' => $qid, 'remaining' => $count, 'rebuilt' => empty($undone)],
    ]);
}
```

#### 3.2.4 battle_ap_recover（L231-236）

```php
// 改前
if ($obl_battle_log) {
    $actor_id = ($actor_data['type'] == 0) ? 'player' : 'enemy_' . $actor_data['pid'];
    $enemy_pid = ($actor_data['type'] == 0) ? 0 : (int)$actor_data['pid'];
    $obl_battle_log->emit(0, $actor_id, 'ap_recover', 'AP恢复', $actor_id, $recovered, null, null, $enemy_pid,
        $actor_data['name'], (int)$actor_data['type']);
}

// 改后
if ($obl_battle_log) {
    $obl_battle_log->emit([
        'actor_pid'    => (int)$actor_data['pid'],
        'actor_type'   => (int)$actor_data['type'],
        'target_pid'   => (int)$actor_data['pid'],  // 自身目标
        'target_type'  => (int)$actor_data['type'], // 自身类型
        'action_id'    => 'ap_recover',
        'effect_value' => $recovered,
    ]);
}
```

**说明**：AP 恢复的目标是自身，`target_pid = actor_pid, target_type = actor_type`。

#### 3.2.5 battle_act_verify（L252-258）

```php
// 改前
if ($obl_battle_log) {
    $obl_battle_log->emit(
        0, $actor_id, $act_id, battle_action_name($act_id), 'verify', 0,
        array('result' => $verified ? 'passed' : 'failed'), null, $enemy_pid,
        $actor_data['name'], (int)$actor_data['type']
    );
}

// 改后
if ($obl_battle_log) {
    $obl_battle_log->emit([
        'actor_pid'   => (int)$actor_data['pid'],
        'actor_type'  => (int)$actor_data['type'],
        'target_pid'  => 0,
        'target_type' => -1,
        'action_id'   => $act_id,
        'extra'       => ['result' => $verified ? 'passed' : 'failed'],
    ]);
}
```

**说明**：动作校验是系统事件，无实体目标。`battle_action_name()` 调用移除（前端模板负责）。

#### 3.2.6 battle_action_name() 函数

`battle_action_name()`（L298-306）**保留**，但仅作为后端内部使用的辅助函数。前端不再依赖此函数的输出。

### 3.3 battle.main.php — 1 处 emit 调用点改动

**文件**：`d:\wamp64\www\phpdts\oblivions\include\game\battle\battle.main.php`

#### 3.3.1 battle_once_excute（L102-144）

**关键**：emit 在 `battle_apply_damage` 之后调用，此时 `$target_data['hp']` 已是扣血后的值。需在扣血前保存 oldhp。

```php
// 改前（L102-144）
function battle_once_excute(&$actor_data, $act_id, &$target_data, &$obl_battle_log, &$battle_cache)
{
    battle_state_init($target_data);

    $damage = obl_calc_damage($actor_data, $target_data, $act_id, $battle_cache);
    battle_apply_damage($actor_data, $target_data, $damage, $obl_battle_log, $battle_cache);

    // 记录战斗日志（此时 HP 已被扣除）
    if ($obl_battle_log) {
        $actor_id  = ($actor_data['type'] == 0) ? 'player' : 'enemy_' . $actor_data['pid'];
        $target_id = ($target_data['type'] == 0) ? 'player' : 'enemy_' . $target_data['pid'];
        $action_name = battle_action_name($act_id);
        $enemy_pid = ($actor_data['type'] == 0) ? (int)$target_data['pid'] : (int)$actor_data['pid'];
        $obl_battle_log->emit(
            0, $actor_id, $act_id, $action_name, $target_id, $damage,
            null, null, $enemy_pid, $actor_data['name'], (int)$actor_data['type']
        );
    }
    // ...
}

// 改后
function battle_once_excute(&$actor_data, $act_id, &$target_data, &$obl_battle_log, &$battle_cache)
{
    battle_state_init($target_data);

    // 扣血前保存 HP 快照
    $actor_oldhp  = (int)$actor_data['hp'];
    $target_oldhp = (int)$target_data['hp'];

    $damage = obl_calc_damage($actor_data, $target_data, $act_id, $battle_cache);
    battle_apply_damage($actor_data, $target_data, $damage, $obl_battle_log, $battle_cache);

    // 记录战斗日志（此时 $actor_data['hp']/$target_data['hp'] 已是扣血后的值）
    if ($obl_battle_log) {
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
    }
    // ...
}
```

**关键改动**：
1. 在 `battle_apply_damage` 之前保存 `$actor_oldhp` 和 `$target_oldhp`
2. `extra` 携带 actor/target 的 oldhp + newhp，供前端 HP 条从 oldhp 过渡到 newhp
3. `enemy_pid` 移除，由前端从 actor_pid/target_pid + type 推导
4. `actor_id`/`target_id` 字符串格式移除，由 actor_pid/target_pid 替代
5. `action_name`/`actor_name` 移除，前端模板负责

**HP 字段命名说明**：采用 actor/target 视角命名（`actor_oldhp`/`target_oldhp`/`actor_newhp`/`target_newhp`），与 entry 的 actor/target 结构一致。前端根据 `actor_type`/`target_type` 判断哪一方是玩家、哪一方是 NPC，分别更新对应的 HP 条。

### 3.4 oblivions_commands.php — 移除 setEntryType 调用

**文件**：`d:\wamp64\www\phpdts\include\command\handlers\oblivions_commands.php`

#### 3.4.1 cmd_handle_obl_battle_start（L97-101）

```php
// 改前
if (!$obl_battle_log) {
    include_once GAME_ROOT . './oblivions/include/game/battle_log.func.php';
    $obl_battle_log = new BattleLogCollector();
}
$obl_battle_log->setEntryType('player_ambush');

// 改后
if (!$obl_battle_log) {
    include_once GAME_ROOT . './oblivions/include/game/battle_log.func.php';
    $obl_battle_log = new BattleLogCollector();
}
```

#### 3.4.2 cmd_handle_obl_battle_action（L140-144）

```php
// 改前
if (!$obl_battle_log) {
    include_once GAME_ROOT . './oblivions/include/game/battle_log.func.php';
    $obl_battle_log = new BattleLogCollector();
}
$obl_battle_log->setEntryType('player_turn');

// 改后（同上，移除 setEntryType 调用）
```

### 3.5 enemy_ai.func.php — 移除 setEntryType 调用

**文件**：`d:\wamp64\www\phpdts\oblivions\include\game\enemy_ai.func.php`

#### 3.5.1 obl_resolve_all_enemy_ai（L263-267）

```php
// 改前
if (!$obl_battle_log) {
    include_once GAME_ROOT . './oblivions/include/game/battle_log.func.php';
    $obl_battle_log = new BattleLogCollector();
}
$obl_battle_log->setEntryType('npc_turn');

// 改后（移除 setEntryType 调用）
```

#### 3.5.2 obl_enemy_ambush_player（L390-394）

```php
// 改前
if (!$obl_battle_log) {
    include_once GAME_ROOT . './oblivions/include/game/battle_log.func.php';
    $obl_battle_log = new BattleLogCollector();
}
$obl_battle_log->setEntryType('npc_ambush');

// 改后（移除 setEntryType 调用）
```

### 3.6 api_v2.php — enemies API 调整

**文件**：`d:\wamp64\www\phpdts\api_v2.php`

#### 3.6.1 obl_fetch_discovered_enemies（L543-553）

```php
// 改前
$result = $db->query("SELECT * FROM {$tablepre}oblplayers
                      WHERE type > 0 AND pgroup='{$pgroup}' AND discovered=1 AND state=0");

// 改后
$result = $db->query("SELECT * FROM {$tablepre}oblplayers
                      WHERE type > 0 AND pgroup='{$pgroup}' AND discovered=1");
```

**说明**：移除 `state=0` 条件，已死亡敌人也返回。前端通过 `state` 字段判断生死状态。

#### 3.6.2 handle_obl_enemies 战斗对象补丁（L510-526）

现有逻辑已能处理战斗对象（即使 discovered=0 也强制加入），但需增加对已死亡战斗对象的处理。当前 `obl_fetch_playerdata_by_pid` 不受 state 过滤，所以已死亡的战斗对象仍能被查到。**此部分无需改动**，但需验证 `obl_simplify_enemy_data` 返回的 `state` 字段正确反映死亡状态。

#### 3.6.3 obl_simplify_enemy_data（L561-576）

`state` 字段已在返回数据中，无需改动。前端可通过 `enemy.state` 判断生死。

---

## 4. 前端改动

### 4.1 新增：battle_log 渲染模板

**新文件**：`d:\wamp64\www\phpdts\vex\data\battle-templates.js`

```js
/**
 * battle_log 渲染模板
 *
 * 按 action_id 索引，每个模板定义渲染函数。
 * 渲染函数接收 (entry, context) 参数：
 *   entry: battle_log 条目（新结构）
 *   context: { playerName, npcName, npcLocation, ... }
 *
 * 人称渲染规则：
 *   actor_type === 0 → "你"
 *   actor_type > 0 → 显示 actor 名称（从 context.npcName 获取）
 */

import { escapeHtml } from '../js/utils.js';

const BATTLE_TEMPLATES = {
    'unarmed_strike': {
        render(entry, ctx) {
            const actor = displayActor(entry, ctx);
            const target = displayTarget(entry, ctx);
            const actorClass = entry.actor_type === 0 ? 'yellow' : 'red';
            return `<span class="${actorClass}">${escapeHtml(actor)}</span>对<span class="red">${escapeHtml(target)}</span>使用了空手攻击，造成 <span class="yellow">${entry.effect_value}</span> 点伤害。`;
        }
    },
    'escape': {
        render(entry, ctx) {
            const actor = displayActor(entry, ctx);
            const actorClass = entry.actor_type === 0 ? 'yellow' : 'red';
            const success = entry.extra && entry.extra.success;
            if (success) {
                return `<span class="${actorClass}">${escapeHtml(actor)}</span>尝试逃跑，<span class="yellow">成功了！</span>`;
            }
            return `<span class="${actorClass}">${escapeHtml(actor)}</span>尝试逃跑，但<span class="red">失败了</span>。`;
        }
    },
    'battle_end': {
        render(entry, ctx) {
            if (entry.actor_type !== 0) {
                // NPC 被清除 → 玩家胜利
                return `<span class="yellow">═══ 战斗胜利！你击败了 ${escapeHtml(ctx.npcName)} ═══</span>`;
            }
            return `<span class="text-fg-dim">═══ 战斗结束 ═══</span>`;
        }
    },
    'ap_recover': {
        render(entry, ctx) {
            // AP 恢复：轻量提示，不渲染为模态框条目
            return '';
        }
    },
    'queue_create': {
        render(entry, ctx) {
            return '';
        }
    },
    'queue_update': {
        render(entry, ctx) {
            return '';
        }
    },
};

function displayActor(entry, ctx) {
    if (entry.actor_type === 0) return '你';
    return ctx.npcName || '未知敌人';
}

function displayTarget(entry, ctx) {
    if (entry.target_type === 0) return '你';
    if (entry.target_type > 0) return ctx.npcName || '未知敌人';
    return '';
}

/**
 * 渲染单条 battle_log 条目为 HTML
 */
export function renderBattleLogEntryHtml(entry, context) {
    const template = BATTLE_TEMPLATES[entry.action_id];
    if (template && template.render) {
        return template.render(entry, context || {});
    }
    // 默认模板
    const actor = displayActor(entry, context || {});
    const actorClass = entry.actor_type === 0 ? 'yellow' : 'red';
    return `<span class="${actorClass}">${escapeHtml(actor)}</span>使用了${escapeHtml(entry.action_id)}。`;
}

export { BATTLE_TEMPLATES };
```

### 4.2 battle-render.js — 重构

**文件**：`d:\wamp64\www\phpdts\vex\js\battle-render.js`

#### 4.2.1 renderBattleLogEntryHtml — 改为调用模板系统

```js
// 改前：本地 switch-case 实现
export function renderBattleLogEntryHtml(entry, context) { ... }

// 改后：委托给 battle-templates.js
import { renderBattleLogEntryHtml } from '../data/battle-templates.js';
// 本文件不再导出 renderBattleLogEntryHtml，由 battle-modal.js 直接从模板导入
```

**本文件改动**：移除 `renderBattleLogEntryHtml` 函数实现，改为从 `battle-templates.js` 导入并重新导出（保持其他模块的 import 路径不变）。

其余函数（`renderBattleActions`/`renderBattleWaiting`/`renderBattleHeader`）不变。

### 4.3 battle.js — 核心逻辑重构

**文件**：`d:\wamp64\www\phpdts\vex\js\battle.js`

#### 4.3.1 groupByEnemyPid → groupByEncounter

```js
// 改前
function groupByEnemyPid(entries) {
    const groups = {};
    for (const entry of entries) {
        const enemyPid = parseInt(entry.enemy_pid) || 0;
        if (enemyPid === 0) continue;
        if (!groups[enemyPid]) groups[enemyPid] = [];
        groups[enemyPid].push(entry);
    }
    return groups;
}

// 改后
function groupByEncounter(entries) {
    // 从 entries 中推导 NPC pid（actor_type>0 或 target_type>0 的一方）
    let npcPid = 0;
    for (const e of entries) {
        if (e.actor_type > 0) { npcPid = e.actor_pid; break; }
        if (e.target_type > 0) { npcPid = e.target_pid; break; }
    }
    if (npcPid === 0) return {};
    // 单 NPC 战斗约束下，所有条目归入同一组
    return { [npcPid]: entries };
}
```

#### 4.3.2 buildPlayContext + refreshContextFromApi — 重构

**抽出共享函数**：`refreshContextFromApi` 负责从 API 获取最新状态，`buildPlayContext` 负责首次构建，`refreshContextFromApi` 负责播放中增量更新。

```js
// 改前：从 entry.actor_name 提取敌人名称，从 enemies API 获取 HP
async function buildPlayContext(entries, enemyPid) {
    let enemyName = '敌人';
    for (const e of entries) {
        if (e.actor_type !== 0 && e.actor_name) {
            enemyName = e.actor_name;
            break;
        }
    }
    // ... 从 player_info 和 enemies API 获取 HP ...
}

// 改后：从 enemies API 获取名称+HP+位置，供首次构建和播放中增量更新共用

/**
 * 从 API 获取最新状态，更新 ctx
 * 供 buildPlayContext（首次构建）和 playBattleLog 循环（每条 entry 前同步）共用
 */
async function refreshContextFromApi(ctx) {
    try {
        const playerInfo = await dataManager.fetch('player_info', true);
        if (playerInfo.status === 'success' && playerInfo.data) {
            ctx.playerHp = playerInfo.data.hp || 0;
            ctx.playerMaxHp = playerInfo.data.mhp || 1;
            ctx.playerName = playerInfo.data.name || '';
        }

        const enemiesResult = await dataManager.fetch('enemies', true);
        if (enemiesResult.status === 'success' && enemiesResult.data) {
            const enemies = enemiesResult.data.enemies || [];
            for (let i = 0; i < enemies.length; i++) {
                if (parseInt(enemies[i].pid) === parseInt(ctx.npcPid)) {
                    ctx.npcName = enemies[i].name || '敌人';
                    ctx.npcHp = enemies[i].hp || 0;
                    ctx.npcMaxHp = enemies[i].mhp || 1;
                    if (enemies[i].pls) ctx.npcLocation = enemies[i].pls;
                    // 兼容旧字段名（供 battle-modal.js 的 renderHeader 使用）
                    ctx.enemyName = ctx.npcName;
                    ctx.enemyHp = ctx.npcHp;
                    ctx.enemyMaxHp = ctx.npcMaxHp;
                    break;
                }
            }
        }
    } catch (e) {
        console.error('[Battle] refreshContextFromApi error:', e);
    }
}

/**
 * 首次构建播放上下文
 */
async function buildPlayContext(npcPid) {
    const ctx = {
        npcPid,
        npcName: '敌人',
        npcHp: 0,
        npcMaxHp: 1,
        npcLocation: null,
        playerHp: 0,
        playerMaxHp: 1,
        playerName: '',
        // 兼容旧字段名
        enemyName: '敌人',
        enemyHp: 0,
        enemyMaxHp: 1,
    };
    await refreshContextFromApi(ctx);
    return ctx;
}
```

**关键变化**：
1. 不再从 entry.actor_name 提取敌人名称，改为从 enemies API 查找
2. 新增 `npcLocation`（pls 位置信息），供模态框头部显示"位于(3,5)的骷髅兵"
3. 参数从 `(entries, enemyPid)` 简化为 `(npcPid)`
4. 抽出 `refreshContextFromApi` 供 `playBattleLog` 循环中每条 entry 前调用
5. 保留 `enemyName`/`enemyHp`/`enemyMaxHp` 兼容字段，供 battle-modal.js 使用

#### 4.3.3 fetchAndPlayBattleLog — 调整分组逻辑

```js
// 改前
const groups = groupByEnemyPid(entries);

// 改后
const groups = groupByEncounter(entries);
```

#### 4.3.4 playBattleLogGroup — 调整参数

```js
// 改前
async function playBattleLogGroup(entries, enemyPid) {
    const excuteEntries = entries.filter(e => e.phase === 'excute');
    if (excuteEntries.length === 0) return;
    const context = await buildPlayContext(entries, enemyPid);
    // ...
    for (const entry of excuteEntries) {
        if (entry.action_id === 'unarmed_strike') {
            await playCollisionAnimation(entry, enemyPid);
        }
    }
    // ...
    await playBattleLog(excuteEntries, context, null);
    playDamageNumbersAfterModal(excuteEntries, enemyPid);
    // ...
}

// 改后
async function playBattleLogGroup(entries, npcPid) {
    const excuteEntries = entries.filter(e => e.phase === 'excute');
    if (excuteEntries.length === 0) return;
    const context = await buildPlayContext(npcPid);
    // ...
    for (const entry of excuteEntries) {
        if (entry.action_id === 'unarmed_strike') {
            await playCollisionAnimation(entry, npcPid);
        }
    }
    // ...
    await playBattleLog(excuteEntries, context, null);
    playDamageNumbersAfterModal(excuteEntries, npcPid);
    // ...
}
```

#### 4.3.5 renderBattleHeader — 增加位置信息

```js
// 改前
export function renderBattleHeader(enemyName) {
    const el = document.getElementById('battleEnemyName');
    if (el) {
        el.textContent = enemyName ? 'vs ' + enemyName : '';
    }
}

// 改后
export function renderBattleHeader(enemyName, npcLocation) {
    const el = document.getElementById('battleEnemyName');
    if (el) {
        if (enemyName) {
            const locText = npcLocation ? `位于(${npcLocation})的` : '';
            el.textContent = 'vs ' + locText + enemyName;
        } else {
            el.textContent = '';
        }
    }
}
```

#### 4.3.6 fetchEnemyNameByPid — 简化

```js
// 改前：从 enemies API 查找名称
async function fetchEnemyNameByPid(pid) { ... }

// 改后：逻辑不变，但 enemies API 现在返回已死亡单位，不再需要特殊处理
```

### 4.4 battle-modal.js — 适配新字段

**文件**：`d:\wamp64\www\phpdts\vex\js\battle-modal.js`

#### 4.4.1 playBattleLog — 移除 turn 分隔符 + 每条 entry 前请求 API

```js
// 改前
let currentTurn = -1;
for (let i = 0; i < sorted.length; i++) {
    const entry = sorted[i];
    if (entry.turn !== currentTurn) {
        currentTurn = entry.turn;
        const dividerText = currentTurn === 0 ? '── 战斗开始 ──' : '── 回合 ' + currentTurn + ' ──';
        await appendDivider(body, dividerText);
        await sleep(ENTRY_INTERVAL / 2);
    }
    // 渲染条目
    const html = renderBattleLogEntryHtml(entry, ctx);
    if (html) await appendEntry(body, html);
    // 更新 HP 条
    updateHpBars(entry, ctx);
    await sleep(ENTRY_INTERVAL);
}

// 改后：turn 字段已移除；每条 entry 前请求 API 同步全局状态
for (let i = 0; i < sorted.length; i++) {
    if (cancelRequested) break;
    const entry = sorted[i];

    // 首条 entry 前显示"战斗开始"分隔符
    if (i === 0) {
        await appendDivider(body, '── 战斗开始 ──');
        await sleep(ENTRY_INTERVAL / 2);
    }

    // 每条 entry 播放前请求 API，同步全局状态（AP、state、位置等）
    await refreshContextFromApi(ctx);

    // 渲染条目 HTML
    const html = renderBattleLogEntryHtml(entry, ctx);
    if (html) await appendEntry(body, html);

    // 更新 HP 条（从 entry.extra 的 oldhp/newhp 读取）
    updateHpBars(entry, ctx);

    await sleep(ENTRY_INTERVAL);
}
```

**关键变化**：
1. 移除 turn 分隔符逻辑，改为首条 entry 前固定分隔符
2. 每条 entry 播放前调用 `refreshContextFromApi(ctx)` 同步全局状态
3. `refreshContextFromApi` 从 battle.js 导入（或从共享模块导入）

**导入调整**：
```js
// 改前
import { renderBattleLogEntryHtml } from './battle-render.js';

// 改后
import { renderBattleLogEntryHtml } from '../data/battle-templates.js';
import { refreshContextFromApi } from './battle.js';
```

#### 4.4.2 updateHpBars — 重构

```js
// 改前：从 entry.extra.enemy_hp_after/player_hp_after 读取
function updateHpBars(entry, ctx) {
    if (!entry.extra) return;
    // 玩家攻击敌人 → 更新敌人 HP
    if (entry.actor_type === 0 && entry.extra.enemy_hp_after !== undefined) {
        updateHpBar('battleModalEnemyHpFill', 'battleModalEnemyHpText',
            entry.extra.enemy_hp_after, ctx.enemyMaxHp);
    }
    // 敌人攻击玩家 → 更新玩家 HP
    if (entry.actor_type !== 0 && entry.extra.player_hp_after !== undefined) {
        updateHpBar('battleModalPlayerHpFill', 'battleModalPlayerHpText',
            entry.extra.player_hp_after, ctx.playerMaxHp);
    }
}

// 改后：从 entry.extra 的 actor_oldhp/target_oldhp → actor_newhp/target_newhp 读取
function updateHpBars(entry, ctx) {
    if (!entry.extra) return;

    // 玩家攻击敌人 → 更新敌人 HP（target 是 NPC）
    if (entry.actor_type === 0 && entry.target_type > 0) {
        const newHp = entry.extra.target_newhp;
        if (newHp !== undefined) {
            updateHpBar('battleModalEnemyHpFill', 'battleModalEnemyHpText',
                newHp, ctx.enemyMaxHp);
        }
    }

    // 敌人攻击玩家 → 更新玩家 HP（target 是玩家）
    if (entry.actor_type > 0 && entry.target_type === 0) {
        const newHp = entry.extra.target_newhp;
        if (newHp !== undefined) {
            updateHpBar('battleModalPlayerHpFill', 'battleModalPlayerHpText',
                newHp, ctx.playerMaxHp);
        }
    }
}
```

**说明**：
- HP 条直接设置为 `extra.target_newhp`（扣血后的值），CSS transition 自动处理过渡动画
- `extra.target_oldhp` 可用于显示伤害数字（`oldhp - newhp = damage`），但 `effect_value` 已提供伤害值，所以 oldhp 主要用于调试
- 根据 `actor_type`/`target_type` 判断哪一方是玩家、哪一方是 NPC，分别更新对应的 HP 条

#### 4.4.3 renderBattleLogEntryHtml 导入路径

```js
// 改前
import { renderBattleLogEntryHtml } from './battle-render.js';

// 改后
import { renderBattleLogEntryHtml } from '../data/battle-templates.js';
```

### 4.5 battle-animation.js — 适配新字段

**文件**：`d:\wamp64\www\phpdts\vex\js\battle-animation.js`

#### 4.5.1 playCollisionAnimation — 不变

函数签名 `playCollisionAnimation(entry, enemyPid)` 不变。`enemyPid` 参数名保留（这是前端内部变量名，不是后端字段名），含义为"NPC 的 PID"。

entry 中访问的字段不变：`action_id`、`actor_type`。

#### 4.5.2 playDamageNumbersAfterModal — 不变

同上，`enemyPid` 参数名保留。

#### 4.5.3 getEnemyElement — 不变

`querySelector('[data-enemy-pid="' + enemyPid + '"]')` 不变。`data-enemy-pid` 是 DOM 属性名，与后端字段无关。

---

## 5. 改动文件清单

| 文件 | 改动类型 | 改动量 | 说明 |
|------|----------|--------|------|
| `oblivions/include/game/battle_log.func.php` | 重构 | 中 | emit 签名+实现，移除 entry_type |
| `oblivions/include/game/battle/battle.func.php` | 修改 | 中 | 5 处 emit 调用改为关联数组 |
| `oblivions/include/game/battle/battle.main.php` | 修改 | 中 | 1 处 emit 调用+保存 oldhp+携带 HP 快照 |
| `include/command/handlers/oblivions_commands.php` | 修改 | 小 | 移除 2 处 setEntryType |
| `oblivions/include/game/enemy_ai.func.php` | 修改 | 小 | 移除 2 处 setEntryType |
| `api_v2.php` | 修改 | 小 | enemies API 移除 state=0 过滤 |
| `vex/data/battle-templates.js` | **新增** | 中 | battle_log 渲染模板系统 |
| `vex/js/battle-render.js` | 修改 | 小 | 委托给模板系统 |
| `vex/js/battle.js` | 重构 | 大 | 分组/上下文/渲染逻辑全面适配，抽出 refreshContextFromApi |
| `vex/js/battle-modal.js` | 重构 | 中 | 导入路径+turn 移除+每条 entry 请求 API+updateHpBars 重构 |
| `vex/js/battle-animation.js` | 无改动 | — | 参数名保留，字段访问不变 |

---

## 6. 实施顺序

### 阶段 1：后端重构（必须先完成）

1. **battle_log.func.php**：emit 签名改为关联数组，移除 entry_type 属性
2. **battle.func.php**：5 处 emit 调用改为关联数组，移除 enemy_pid 计算
3. **battle.main.php**：1 处 emit 调用改为关联数组，扣血前保存 oldhp，extra 携带 oldhp+newhp
4. **oblivions_commands.php**：移除 2 处 setEntryType
5. **enemy_ai.func.php**：移除 2 处 setEntryType
6. **api_v2.php**：enemies API 移除 state=0 过滤

### 阶段 2：前端重构（依赖阶段 1）

1. **battle-templates.js**：新建模板文件
2. **battle-render.js**：委托给模板系统
3. **battle.js**：分组/上下文/渲染逻辑适配，抽出 refreshContextFromApi
4. **battle-modal.js**：导入路径+turn 适配+每条 entry 请求 API+updateHpBars 重构

### 兼容性说明

阶段 1 完成后、阶段 2 完成前，前端会因字段名不匹配而无法正常渲染。**两个阶段应在同一次部署中完成**。

---

## 7. 验证要点

### 7.1 后端验证

- [ ] 6 处 emit 调用均使用关联数组传参
- [ ] 新 entry 结构包含 11 个字段（actor_pid, actor_type, target_pid, target_type, action_id, effect_value, extra, ts, phase, log_id, played）
- [ ] battle_once_excute 在 battle_apply_damage 之前保存 actor_oldhp/target_oldhp
- [ ] battle_once_excute 的 extra 包含 actor_oldhp, target_oldhp, actor_newhp, target_newhp
- [ ] enemies API 返回已死亡单位（state=1）
- [ ] setEntryType 调用全部移除
- [ ] 持久化/读取/标记/清理函数正常工作

### 7.2 前端验证

- [ ] groupByEncounter 正确推导 NPC pid
- [ ] buildPlayContext 从 enemies API 获取名称和 HP（包括已死亡敌人）
- [ ] refreshContextFromApi 每条 entry 播放前被调用，同步全局状态
- [ ] 模态框 HP 条根据 extra 的 target_newhp 更新（oldhp→newhp 过渡）
- [ ] 战斗日志文案由模板系统渲染
- [ ] 碰撞动画和伤害数字正常播放
- [ ] 战斗结束检测（phase=finish_check + extra.ended）正常
- [ ] markBattleLogPlayed 标记功能正常

### 7.3 端到端验证

- [ ] 玩家突袭 NPC → 战斗日志正常播放 → 战斗胜利 → 退出战斗
- [ ] NPC 突袭玩家 → 战斗日志正常播放 → 玩家反击 → 战斗结束
- [ ] 多先攻轮战斗 → 日志按顺序播放
- [ ] 多次打击战斗 → HP 条逐次扣减（每条 entry 的 oldhp→newhp 过渡正确）
- [ ] 敌人死亡后 → enemies API 仍返回该敌人数据 → 名称正常显示
- [ ] NPC 回合自动刷新 → 战斗日志正常拉取播放
