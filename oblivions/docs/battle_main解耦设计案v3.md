# battle_main 解耦设计案 v3

> 在 v2 基础上将队列拆为独立模块 `battle.queue.func.php`，三文件职责收敛。
>
> **状态**：设计阶段，未实施
> **前置**：战斗入口设计案（已实施）
> **超集**：替换 [battle_main解耦设计案v2.md](battle_main解耦设计案v2.md)（v2）

---

## 一、思路

v2 做到了"队列管理从 `battle_main()` 拆出"，但队列代码仍横跨两个文件：

| 文件 | 队列相关函数 |
|------|-------------|
| `battle.main.php` | `queue_check`, `finish_check`, `new_turn`（编排） |
| `battle.func.php` | `queue_create`, `calc_initiative`, `queue_join`, `queue_done`, `queue_update`, `queue_exit`（底层） |

**v3 核心变化**：将所有队列函数集中到 `battle.queue.func.php`，三文件职责互不重叠：

| 文件 | 职责 |
|------|------|
| `battle.main.php` | **纯执行** —— verify + execute + once_execute |
| `battle.queue.func.php` | **队列管理** —— 先攻顺序、回合推进、战斗结束判定 |
| `battle.func.php` | **状态+辅助** —— 战斗状态、AP、存活检测、伤害应用 |

包含 v2 全部的 3 个 bug 修复 + 2 个优化点。

---

## 二、文件职责边界

### 2.1 `battle.main.php` —— 纯执行

**只保留**：
| 函数 | 签名变化 |
|------|---------|
| `battle_main()` | 新增 `$battle_cache` 参数；删除 `= []`、`combatants` 初始化、`queue_check`/`finish_check` 调用 |
| `battle_verify()` | 不变（承接 `$battle_cache`） |
| `battle_excute()` | 不变 |
| `battle_once_excute()` | 不变 |
| `battle_target_check()` | 不变 |
| `battle_prepare()` | 不变（AP 恢复 + save，由 `battle_new_turn` 调用，但后者移至队列模块） |

**移出 → battle.queue.func.php**：`battle_queue_check`, `battle_finish_check`, `battle_new_turn`

### 2.2 `battle.queue.func.php` —— 队列管理 [新增]

**从 battle.main.php 移入**：
- `battle_queue_check()`（去除原地格式转换，改用 `battle_get_alive_pids`）
- `battle_finish_check()`（传入 `$battle_cache`）
- `battle_new_turn()`（加 `$battle_cache` 参数；删除内部 `= []` 和冗余 `queue_update`）
- `battle_manage_queue()`（v2 新增的编排函数，封装 `queue_check` + `finish_check`）

**从 battle.func.php 移入**：
- `battle_queue_create()`
- `battle_calc_initiative()`
- `battle_queue_join()`
- `battle_queue_done()`
- `battle_queue_update()`（简化 `$battle_cache` 判空为直接赋值）
- `battle_queue_exit()`

**新增**：
- `battle_get_alive_pids()`（v2 优化 4.1）

### 2.3 `battle.func.php` —— 战斗状态 + 计算辅助

**保留**：
| 函数 | 修改 |
|------|------|
| `battle_state_init()` | 不变 |
| `battle_state_clear()` | 删除冗余 `battle_queue_update`（v2 bug 3.3） |
| `battle_ap_recover()` | 不变 |
| `battle_act_verify()` | 不变 |
| `battle_target_alive_check()` | 不变 |
| `battle_target_distance_check()` | 不变 |
| `battle_apply_damage()` | 不变 |

---

## 三、依赖关系

```
battle.entry.php
  ├── include battle.main.php         # 执行层
  │     └── require_once battle.func.php  # 状态层
  │           └── require_once battle.calc.php
  ├── include battle.queue.func.php   # 队列层 [NEW]
  │     └── require_once battle.func.php  # 状态层
  └── battle_state_machine.func.php   # 由 obl_bootstrap.php 加载

sql.func.php → 全局可用
```

无循环依赖。

---

## 四、完整函数执行顺序

### 4.1 入口 1：玩家突袭 NPC（`battle_entry_player_ambush`）

设计案：战斗入口设计案 §6.1

```
battle_entry_player_ambush(&$pdata, $actions)
  │
  ├── I. 入口层（battle.entry.php）
  │
  │    battle_entry_parse_actions($actions, pid, 'player_ambush')  → $atk_act
  │    if (empty($atk_act)) return
  │
  │    $battle_cache = [
  │       'combatants' => [$pdata['pid'] => 1],
  │       'last_qid'   => 0,
  │       'is_ambush'  => true,
  │    ]
  │
  │    $pdata['oblpara']['ambush_flag'] = true
  │    battle_state_init($pdata)
  │
  ├── II. 执行层（battle.main.php）
  │
  │    battle_main($pdata, $atk_act, $obl_battle_log, $battle_cache)
  │      └── setPhase('verify')
  │      └── battle_verify($pdata, $atk_act, $obl_battle_log, $battle_cache)
  │            └── foreach $atk_act
  │                  └── battle_act_verify()       [battle.func.php] → 校验+扣AP
  │            └── unset 失败项, array_values 重索引
  │
  │      └── if (!empty($atk_act))
  │            └── setPhase('excute')
  │            └── battle_excute($pdata, $atk_act, $obl_battle_log, $battle_cache)
  │                  └── foreach $act
  │                        └── foreach $target
  │                              └── battle_target_check() → $target_data
  │                                    └── obl_fetch_playerdata_by_pid
  │                                    └── battle_target_alive_check()
  │                                    └── battle_target_distance_check()
  │                              └── battle_once_excute($pdata, $act_id, $target_data, ...)
  │                                    └── battle_state_init($target_data)
  │                                    └── skill_execute()      [skill.main.php]
  │                                    └── obl_calc_damage()    [battle.calc.php]
  │                                    └── battle_apply_damage()
  │                                    └── emit attack log
  │                                    └── battle_target_alive_check()
  │                                    └── update $battle_cache['combatants']
  │                                    └── obl_save_player × 2
  │
  ├── III. 队列层（battle.queue.func.php）
  │
  │    battle_manage_queue($pdata, $obl_battle_log, $battle_cache)
  │      └── setPhase('queue_check')
  │      └── battle_queue_check($pdata, $obl_battle_log, $battle_cache)
  │            └── $alive_pids = battle_get_alive_pids($battle_cache)
  │            └── if (empty($pdata['bid']))
  │            │     └── battle_queue_create($pdata, $alive_pids, $obl_battle_log)
  │            │           ├── 确定 qid（新建 MAX+1 / 重建复用原 qid）
  │            │           ├── battle_calc_initiative($pdata, $alive_pids)
  │            │           │     └── 突袭者（ambush_flag）强制顺位 1，不投掷
  │            │           │     └── 其他参战者 mt_rand(1, initiative)
  │            │           │     └── usort: 突袭者优先→投掷降序→属性降序→玩家优先
  │            │           ├── DELETE 旧队列记录
  │            │           ├── INSERT 新队列记录（bid 更新）
  │            │           ├── unset ambush_flag（一次性清除）
  │            │           └── obl_battle_state_create(qid, PLAYER_ACTING)
  │            │
  │            └── battle_queue_done($pdata, $pdata['bid'], ...)
  │            │     └── obl_update_queue_done(pid, qid, 1)
  │            │
  │            └── battle_queue_update($pdata, $obl_battle_log, $battle_cache)
  │                  ├── 死亡参战者兜底扫描（当前注释，待后续启用）
  │                  ├── 解散检查：count ≤ 1 → DELETE + bid=0 + last_qid 保存
  │                  ├── 重建检查：all done → battle_queue_create(preserve_qid)
  │                  └── qorder 更新
  │
  │      └── setPhase('finish_check')
  │      └── battle_finish_check($pdata, $obl_battle_log, $battle_cache)
  │            └── if (empty($pdata['bid']))
  │            │     ├── 从 $battle_cache['last_qid'] 获取 qid
  │            │     ├── obl_battle_state_transition(last_qid, 'battle_end')
  │            │     ├── obl_battle_state_destroy(last_qid)
  │            │     └── battle_state_clear($pdata, ...)    [battle.func.php]
  │            │
  │            └── else (有 bid，战斗继续)
  │                  └── battle_new_turn($pdata, $obl_battle_log, $battle_cache)
  │                        └── setPhase('prepare')
  │                        └── battle_prepare($pdata, ...)  [battle.main.php]
  │                        │     └── battle_ap_recover()    [battle.func.php]
  │                        └── obl_save_player($pdata)
  │
  └── 返回（命令层负责后续 save + tick 推进）
```

### 4.2 入口 2：NPC 突袭玩家（`battle_entry_npc_ambush`）

设计案：战斗入口设计案 §6.2

```
battle_entry_npc_ambush(&$npc, $actions)
  │
  ├── I. 入口层（battle.entry.php）
  │
  │    battle_entry_parse_actions($actions, npc_pid, 'npc_ambush') → $atk_act
  │    if (empty($atk_act)) return
  │
  │    $battle_cache = ['combatants' => [$npc_pid => 1], 'last_qid' => 0, 'is_ambush' => true]
  │    $npc['oblpara']['ambush_flag'] = true
  │    battle_state_init($npc)
  │
  ├── II. 执行层（battle.main.php）
  │
  │    battle_main($npc, $atk_act, ...)  ← 同入口 1
  │
  ├── III. 队列层（battle.queue.func.php）
  │
  │    battle_manage_queue($npc, ...)    ← 同入口 1
  │
  └── 返回（tick 系统负责后续 save）
```

### 4.3 入口 3：遭遇战（`battle_entry_encounter`）

设计案：战斗入口设计案 §6.3

```
battle_entry_encounter(&$actor, $combatants)
  │
  ├── I. 入口层（battle.entry.php）
  │
  │    $battle_cache = [
  │       'combatants' => array_fill_keys($combatants, 1),
  │       'last_qid'   => 0,
  │       'is_ambush'  => false,
  │    ]
  │    battle_state_init($actor)
  │
  ├── II. 跳过执行层（不执行动作）
  │
  ├── III. 队列层（battle.queue.func.php）
  │
  │    battle_manage_queue($actor, $obl_battle_log, $battle_cache)
  │      └── setPhase('queue_check')
  │      └── battle_queue_check($actor, ...)
  │            └── $alive_pids = battle_get_alive_pids($battle_cache)
  │            └── 此时 bid 为空，走 battle_queue_create
  │                  └── battle_calc_initiative()  → 先攻判定
  │                  └── 无 ambush_flag，全员正常投掷
  │                  └── 建队列 + obl_battle_state_create(qid, PLAYER_ACTING)
  │            └── battle_queue_done($actor, bid, ...)
  │            └── battle_queue_update(...)  → 正常队列维护
  │
  │      └── setPhase('finish_check')
  │      └── battle_finish_check(...)
  │
  ├── IV. 入口层继续：按先攻结果校正状态机
  │
  │    $qid = (int)$actor['bid']
  │    if ($qid <= 0) return
  │
  │    $first = obl_fetch_queue_current_initiator($qid)
  │    if (!$first) return
  │
  │    if ($first['type'] == 0) {
  │        # 玩家先攻
  │        obl_battle_state_reset($qid, OBL_BS_WAITING_PLAYER)
  │    } else {
  │        # NPC 先攻
  │        obl_battle_state_reset($qid, OBL_BS_NPC_ACTING)
  │        $npc_data = obl_fetch_playerdata_by_pid($first['pid'])
  │        obl_format_playerdata($npc_data)
  │        $ai_actions = obl_ai_select_combat_action($npc_data, $actor['pid'])
  │        battle_entry_npc_prepare_actions($npc_data, $ai_actions)  ← 入口 4
  │    }
  │
  └── 返回
```

### 4.4 入口 4：NPC 先攻准备（`battle_entry_npc_prepare_actions`）

设计案：战斗入口设计案 §6.4

```
battle_entry_npc_prepare_actions(&$npc, $actions)
  │
  ├── I. 入口层（battle.entry.php）
  │
  │    battle_entry_parse_actions($actions, npc_pid, 'npc_prepare') → $atk_act
  │
  │    $battle_cache = [
  │       'combatants' => [$npc['pid'] => 1],
  │       'last_qid'   => 0,
  │       'is_ambush'  => false,
  │    ]
  │
  ├── II. 执行层（battle.main.php）
  │
  │    battle_main($npc, $atk_act, $obl_battle_log, $battle_cache)
  │      └── 即使 $atk_act 为空也必须调用（推进队列 done 状态，防死循环）
  │
  ├── III. 队列层（battle.queue.func.php）
  │
  │    battle_manage_queue($npc, $obl_battle_log, $battle_cache)
  │      └── battle_queue_check → battle_queue_done → battle_queue_update
  │      └── battle_finish_check → battle_new_turn / battle_end
  │
  └── 返回（tick 系统负责后续 save + 推进下一 tick）
```

---

## 五、函数迁移映射

### 5.1 battle.main.php → battle.queue.func.php

| 函数 | 签名变化 | 内部变化 |
|------|---------|---------|
| `battle_queue_check` | 加 `$battle_cache` 参数 | 去格式转换，改用 `battle_get_alive_pids` |
| `battle_finish_check` | 加 `$battle_cache` 参数 | 调用 `battle_new_turn` 时传入 `$battle_cache` |
| `battle_new_turn` | 加 `$battle_cache` 参数 | 去内部 `= []`；去冗余 `queue_update`；`battle_prepare` 改为直接调 `battle_ap_recover` |

### 5.2 battle.func.php → battle.queue.func.php

| 函数 | 变化 |
|------|------|
| `battle_queue_create`, `battle_calc_initiative`, `battle_queue_join`, `battle_queue_done`, `battle_queue_update`, `battle_queue_exit` | 原样移入 |
| `battle_queue_update` | 简化 `$battle_cache` 判空（v2 优化 4.2） |

### 5.3 battle.func.php 修改

| 函数 | 变化 |
|------|------|
| `battle_state_clear` | 删除冗余 `battle_queue_update`（v2 bug 3.3） |

### 5.4 battle.main.php 修改

| 函数 | 变化 |
|------|------|
| `battle_main` | 加 `$battle_cache` 参数；去内部 `= []`；去 `combatants` 初始化；去 `queue_check` / `finish_check` 调用 |

### 5.5 新增

| 函数 | 位置 |
|------|------|
| `battle_manage_queue()` | battle.queue.func.php |
| `battle_get_alive_pids()` | battle.queue.func.php |

---

## 六、$battle_cache 完整结构

```php
$battle_cache = [
    'combatants' => [pid => 0|1, ...],   // 0=死亡, 1=存活。格式始终保持不变
    'last_qid'   => int,                  // 最后已知 qid（用于战斗结束时触发 battle_end 事件）
    'is_ambush'  => bool,                 // 入口 1/2 为 true；入口 3/4 为 false
];
```

---

## 七、不动的部分

| 模块 | 理由 |
|------|------|
| `battle.calc.php` | 职责已单一 |
| `battle_state_machine.func.php` | 独立模块，不动（可选项：移入 battle/ 目录） |
| `sql.func.php` 中的 `obl_fetch_queue_*` | DB 查询层，通用函数 |
| 战斗状态机转换表 | 完全不动 |
| `ambush_flag` | 仍存在 `actor_data['oblpara']`，不挪到 `battle_cache` |

---

## 八、实施步骤

1. **新增 `battle.queue.func.php`**
   - 从 `battle.func.php` 移入 6 个 queue 函数
   - 从 `battle.main.php` 移入 `battle_queue_check` + `battle_finish_check` + `battle_new_turn`
   - 新增 `battle_manage_queue` + `battle_get_alive_pids`
   - 修复 `battle_new_turn`（加 `$battle_cache` 参数；去冗余 `queue_update`）
   - 修复 `battle_queue_check`（去格式转换，用 `battle_get_alive_pids`）
   - 修复 `battle_queue_update`（简化判空）

2. **修改 `battle.func.php`**
   - 删除移出的 6 个队列函数
   - 修复 `battle_state_clear`（v2 bug 3.3）

3. **修改 `battle.main.php`**
   - 删除移出的 3 个函数
   - 修改 `battle_main`（加 `$battle_cache` 参数；去队列调用）
   - 修改 `battle_finish_check` 调用 `battle_new_turn` 传 `$battle_cache`

4. **修改 `battle.entry.php`**
   - 4 个入口函数注入 `$battle_cache`
   - 入口 1/2/4：`battle_main()` + `battle_manage_queue()` 分离调用
   - 入口 3：直接调 `battle_manage_queue()`

5. **更新入口函数的 include_once**
   - 入口函数需 `include_once battle.main.php` + `include_once battle.queue.func.php`

6. **PHP 语法检查 + 测试**

---

## 九、验证点（同 v2）

- 入口 1 玩家突袭：行动→伤害→后补票建队列→done→update→finish_check→new_turn
- 入口 4 NPC 先攻：行动→done→update→下一位是玩家时 reset 为 WAITING_PLAYER
- 多 NPC 复杂场景：队列重建、解散、多人先攻收官行为不变
- `battle_new_turn` 不再调用冗余 `queue_update`
- `battle_state_clear` 不再调用 `battle_queue_update`
- `battle_queue_update` 直接 `$battle_cache['last_qid'] = $qid` 无判空
- `combatants` 格式全程保持 `[pid => status]` 不变
