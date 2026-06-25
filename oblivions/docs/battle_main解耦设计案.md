# battle_main 解耦设计案

> 本文档定义 `battle_main()` 函数的解耦方案：分离战斗执行与队列管理，消除隐式传递。
>
> **状态**：设计阶段，未实施。
> **前置审查**：[战斗系统全面审查](战斗演出三层架构设计案.md)（P3 架构债务）

---

## 一、问题分析

### 1.1 当前职责结构

`battle_main()` 是一个"大流程"函数，串联 5 个阶段：

```
battle_main()
├── 1. 初始化 $battle_cache          ← 无类型临时变量袋
├── 2. battle_verify()               ← 校验技能合法性 + 扣 AP
├── 3. battle_excute()               ← 执行伤害（先打）
│   └── battle_once_excute()         ← 9 个职责挤在一起
├── 4. battle_queue_check()          ← 创建/更新/解散队列（后建队列）
└── 5. battle_finish_check()         ← 结束检测 / 进入新一轮
```

### 1.2 核心耦合问题

#### 问题1："先打再建队列"的反直觉流程

突袭入口先执行伤害判定（`battle_excute`），再在 `battle_queue_check()` 中"后补票"创建先攻队列。流程是"先打→再决定谁先攻"，逻辑倒置。

突袭入口和缠斗入口的差异隐藏在 `battle_queue_check()` 的 `if(empty($actor_data['bid']))` 判断中：

| 入口 | bid 状态 | queue_check 行为 |
|------|---------|-----------------|
| 突袭 | 空 | 创建新队列 |
| 缠斗 | 非空 | 更新现有队列 |

两种入口都调用同一个 `battle_main()`，差异靠 `bid` 是否为空隐式判断。

#### 问题2：$battle_cache 隐式传递

`$battle_cache` 是无类型约束的临时变量袋，在 4 个子函数间隐式传递，**结构在流程中变化**：

| 阶段 | combatants 格式 | 写入者 | 读取者 |
|------|----------------|--------|--------|
| 初始化 | `[pid => 1]` | `battle_main` | — |
| excute | `[pid => 0\|1]` | `battle_once_excute` | — |
| queue_check | `[pid, pid, ...]`（格式转换！） | `battle_queue_check` | `battle_queue_create` |
| finish_check | — | — | `last_qid` 读取 |

- `combatants` 从关联数组 `[pid => status]` 变为索引数组 `[pid, ...]`，格式转换隐藏在 `battle_queue_check()` 内部
- `last_qid` 在 `battle_queue_update()` 中设置，在 `battle_finish_check()` 中读取，跨函数隐式传递

#### 问题3：battle_once_excute() 职责过载

一个函数承担 9 个职责：

| 行号 | 职责 | 调用 |
|------|------|------|
| 98 | 状态初始化 | `battle_state_init()` |
| 102 | 技能执行 | `skill_execute()` |
| 105-106 | HP 快照保存 | 手动保存 |
| 109 | 伤害计算 | `obl_calc_damage()` |
| 110 | 伤害应用 | `battle_apply_damage()` |
| 114-129 | 日志记录 | `$obl_battle_log->emit()` |
| 131 | 存活检测 | `battle_target_alive_check()` |
| 135-142 | 参战者收集 | 手动写入 `$battle_cache` |
| 150-151 | 数据保存 | `obl_save_player()` × 2 |

#### 问题4：队列管理与战斗执行耦合

`battle_main()` 既是"执行一次先攻轮"的入口，又承担"创建/更新/解散队列"的职责。两个关注点应该分离：

- **战斗执行**：校验 → 执行 → 伤害 → 存活检测
- **队列管理**：创建 → 更新 → 解散 → 重建 → 结束检测

当前它们混在同一个函数中，通过 `$battle_cache` 隐式传递数据。

---

## 二、解耦方案

### 2.1 分离"战斗执行"与"队列管理"

```
当前：
battle_main()
  → battle_verify()        # 校验
  → battle_excute()        # 执行
  → battle_queue_check()   # 队列管理（创建/更新/解散）
  → battle_finish_check()  # 结束检测

解耦后：
battle_execute_turn()      # 战斗执行（纯执行，不管理队列）
  → battle_verify()
  → battle_excute()

battle_manage_queue()      # 队列管理（创建/更新/解散/结束检测）
  → battle_queue_check()
  → battle_finish_check()
```

### 2.2 三个入口统一调用

**突袭入口**（`cmd_handle_obl_battle_start`）：
```php
$ctx = new BattleContext($actor_data, isAmbush: true);
battle_execute_turn($actor_data, $atk_act, $obl_battle_log, $ctx);
battle_manage_queue($actor_data, $obl_battle_log, $ctx);
```

**缠斗入口**（`cmd_handle_obl_battle_action`）：
```php
$ctx = new BattleContext($actor_data, isAmbush: false);
battle_execute_turn($actor_data, $atk_act, $obl_battle_log, $ctx);
battle_manage_queue($actor_data, $obl_battle_log, $ctx);
```

**NPC 先攻轮入口**（`obl_tick_phase_battle_npc`）：
```php
$ctx = new BattleContext($actor_data, isAmbush: false);
battle_execute_turn($actor_data, $atk_act, $obl_battle_log, $ctx);
battle_manage_queue($actor_data, $obl_battle_log, $ctx);
```

三个入口的调用方式统一，差异在 `$ctx->isAmbush` 中明确标记。

### 2.3 $battle_cache 改造为 BattleContext

```php
class BattleContext {
    /** 参战者 [pid => status]，格式不再转换 */
    public array $combatants = [];
    
    /** 解散前的 qid（由 battle_queue_update 设置，battle_finish_check 读取） */
    public int $lastQid = 0;
    
    /** 是否突袭入口 */
    public bool $isAmbush = false;
    
    public function __construct(&$actor_data, bool $isAmbush = false) {
        $this->combatants = [$actor_data['pid'] => 1];
        $this->isAmbush = $isAmbush;
    }
    
    /** 获取存活参战者 pid 列表（封装格式转换） */
    public function getAliveCombatantPids(): array {
        return array_keys(array_filter($this->combatants, fn($s) => $s === 1));
    }
    
    /** 标记参战者存活状态 */
    public function setCombatantStatus(int $pid, int $status): void {
        $this->combatants[$pid] = $status;
    }
}
```

**改造要点**：
- `combatants` 格式不再变化（始终是 `[pid => status]`）
- 格式转换封装在 `getAliveCombatantPids()` 方法中
- `lastQid` 成为显式属性，不再隐式传递
- `isAmbush` 明确标记入口类型

### 2.4 battle_once_excute() 拆分

```php
function battle_once_excute(
    &$actor_data, $act_id, &$target_data, 
    &$obl_battle_log, BattleContext $ctx
) {
    // 1. 状态初始化
    battle_state_init($target_data);
    
    // 2. 技能执行（处理非伤害效果，如逃跑）
    battle_execute_skill($actor_data, $act_id, $target_data, $obl_battle_log, $ctx);
    
    // 3. 伤害计算 + 应用 + 日志
    $damage = battle_calc_and_apply_damage(
        $actor_data, $target_data, $act_id, $obl_battle_log, $ctx
    );
    
    // 4. 存活检测 + 参战者收集
    $alive = battle_check_survival($target_data, $obl_battle_log, $ctx);
    $ctx->setCombatantStatus($target_data['pid'], $alive ? 1 : 0);
    
    // 5. 数据保存
    battle_save_participants($actor_data, $target_data);
}
```

**拆分后的子函数**：

| 子函数 | 职责 | 原 battle_once_excute 行号 |
|--------|------|---------------------------|
| `battle_execute_skill()` | 技能执行（非伤害效果） | 101-102 |
| `battle_calc_and_apply_damage()` | 伤害计算 + 应用 + 日志 | 104-129 |
| `battle_check_survival()` | 存活检测 | 131 |
| `battle_save_participants()` | 数据保存 | 150-151 |

---

## 三、改造后的完整流程

### 3.1 battle_execute_turn()

```php
function battle_execute_turn(
    &$actor_data, &$atk_act, &$obl_battle_log, BattleContext $ctx
): void {
    $obl_battle_log->setPhase('verify');
    battle_verify($actor_data, $atk_act, $obl_battle_log, $ctx);
    
    if (!empty($atk_act)) {
        $obl_battle_log->setPhase('excute');
        battle_excute($actor_data, $atk_act, $obl_battle_log, $ctx);
    }
}
```

### 3.2 battle_manage_queue()

```php
function battle_manage_queue(
    &$actor_data, &$obl_battle_log, BattleContext $ctx
): void {
    $obl_battle_log->setPhase('queue_check');
    battle_queue_check($actor_data, $obl_battle_log, $ctx);
    
    $obl_battle_log->setPhase('finish_check');
    battle_finish_check($actor_data, $obl_battle_log, $ctx);
}
```

### 3.3 battle_queue_check() 改造

```php
function battle_queue_check(&$actor_data, &$obl_battle_log, BattleContext $ctx): void
{
    // 获取存活参战者 pid 列表（封装格式转换，不再修改 $ctx->combatants）
    $alive_pids = $ctx->getAliveCombatantPids();
    
    if (empty($actor_data['bid'])) {
        // 无队列 → 创建（突袭入口首次进入）
        battle_queue_create($actor_data, $alive_pids, $obl_battle_log);
    } else {
        // 有队列 → 更新 done + 检查重建/解散
        battle_queue_done($actor_data, $actor_data['bid'], $obl_battle_log);
        battle_queue_update($actor_data, $obl_battle_log, $ctx);
    }
}
```

**改造要点**：
- 不再修改 `$ctx->combatants` 的格式（消除格式转换）
- 用 `$ctx->getAliveCombatantPids()` 获取 pid 列表
- 突袭/缠斗的差异通过 `bid` 是否为空判断（保留，但更清晰）

### 3.4 battle_finish_check() 改造

```php
function battle_finish_check(&$actor_data, &$obl_battle_log, BattleContext $ctx): void
{
    if (empty($actor_data['bid'])) {
        // 战斗结束
        $lastQid = $ctx->lastQid;  // 显式读取，不再 isset 检查
        if ($lastQid > 0 && function_exists('obl_battle_state_get')) {
            $current_state = obl_battle_state_get($lastQid);
            if ($current_state !== OBL_BS_IDLE) {
                obl_battle_state_transition($lastQid, 'battle_end');
            }
            obl_battle_state_destroy($lastQid);
        }
        battle_state_clear($actor_data, $obl_battle_log, $ctx);
        return;
    }
    
    // 战斗继续，进入新一轮
    battle_new_turn($actor_data, $obl_battle_log, $ctx);
}
```

---

## 四、改造范围

### 4.1 新增

| 文件/类 | 说明 |
|---------|------|
| `BattleContext` 类 | 替代 `$battle_cache`，有类型约束 |
| `battle_execute_turn()` | 战斗执行主函数（从 `battle_main` 拆分） |
| `battle_manage_queue()` | 队列管理主函数（从 `battle_main` 拆分） |
| `battle_execute_skill()` | 技能执行子函数（从 `battle_once_excute` 拆分） |
| `battle_calc_and_apply_damage()` | 伤害计算+应用+日志子函数 |
| `battle_check_survival()` | 存活检测子函数 |
| `battle_save_participants()` | 数据保存子函数 |

### 4.2 修改

| 文件 | 函数 | 改动 |
|------|------|------|
| `battle.main.php` | `battle_main()` | 改为调用 `battle_execute_turn` + `battle_manage_queue`（或直接删除，入口改为调用新函数） |
| `battle.main.php` | `battle_once_excute()` | 拆分为 4 个子函数 |
| `battle.main.php` | `battle_queue_check()` | 参数改为 `BattleContext`，消除格式转换 |
| `battle.main.php` | `battle_finish_check()` | 参数改为 `BattleContext`，显式读取 `lastQid` |
| `battle.main.php` | `battle_new_turn()` | 参数改为 `BattleContext` |
| `battle.func.php` | `battle_queue_update()` | 参数改为 `BattleContext`，`last_qid` 改为 `$ctx->lastQid` |
| `battle.func.php` | `battle_state_clear()` | 参数改为 `BattleContext` |
| `battle.func.php` | `battle_target_alive_check()` | 参数改为 `BattleContext` |
| `oblivions_commands.php` | `cmd_handle_obl_battle_start()` | 调用 `battle_execute_turn` + `battle_manage_queue` |
| `oblivions_commands.php` | `cmd_handle_obl_battle_action()` | 同上 |
| `enemy_ai.func.php` | `obl_tick_phase_battle_npc()` | 同上 |

### 4.3 删除

| 函数 | 原因 |
|------|------|
| `battle_main()` | 被 `battle_execute_turn` + `battle_manage_queue` 替代 |

---

## 五、收益

| 维度 | 当前 | 解耦后 |
|------|------|--------|
| 入口差异 | 隐藏在 `bid` 判断中 | `$ctx->isAmbush` 明确标记 |
| $battle_cache | 无类型数组，格式隐式变化 | `BattleContext` 类，方法封装格式转换 |
| battle_once_excute | 9 个职责挤在一起 | 拆分为 4 个子函数 |
| 队列管理 | 与战斗执行耦合 | 独立的 `battle_manage_queue()` |
| 可测试性 | 难以单独测试执行/队列 | 可分别测试执行和队列管理 |
| combatants 格式 | 流程中变化（关联→索引） | 始终是 `[pid => status]`，转换封装在方法中 |

---

## 六、实施步骤（概要）

1. **新增 `BattleContext` 类**（`battle.context.php` 或 `battle.func.php` 内）
2. **拆分 `battle_once_excute()`** 为 4 个子函数
3. **新增 `battle_execute_turn()` 和 `battle_manage_queue()`**
4. **改造各子函数参数**（`$battle_cache` → `BattleContext $ctx`）
5. **改造三个入口**（`oblivions_commands.php` × 2 + `enemy_ai.func.php`）
6. **删除 `battle_main()`**
7. **验证**：PHP 语法检查 + 战斗流程测试

---

## 七、待确认细节

> 以下细节需要在实施前确认：

1. **`battle_main()` 是否保留为兼容包装？**
   - 方案A：直接删除，三个入口改为调用新函数
   - 方案B：保留 `battle_main()` 作为兼容包装，内部调用新函数

2. **`BattleContext` 类的文件位置？**
   - 方案A：`battle/battle.context.php`（独立文件）
   - 方案B：`battle/battle.func.php` 内（与其他战斗函数同文件）

3. **`battle_new_turn()` 是否也需要拆分？**
   - 当前 `battle_new_turn()` 调用 `battle_prepare()` + `battle_queue_update()` + `obl_save_player()`
   - 是否需要将 `battle_prepare()` + `battle_queue_update()` 合并到 `battle_manage_queue()` 中？

4. **`battle_state_clear()` 中的死代码（`battle_queue_update` 无效调用）是否一并清理？**
   - [battle.func.php:28-29](battle.func.php#L28-L29)：`battle_queue_exit` 后 `bid=0`，`battle_queue_update` 直接 return
