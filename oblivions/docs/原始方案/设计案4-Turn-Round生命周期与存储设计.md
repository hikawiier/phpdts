# 设计案4：Turn / Round 生命周期与存储设计

> 定义战斗系统中 Turn、Round 的生命周期边界、hook 位置、存储策略。

---

## 一、Two-Phase 背景

战斗入口有两个不同的执行阶段：

| | Phase 0（Ambush） | Phase 1（Standard Battle） |
|---|---|---|
| 范围 | step 3 → step 5, 单请求 | `queue_create_and_init` → destroy |
| 队列 | ❌ | ✅ |
| **Turn** | ❌ 不存在 | ✅ 按先攻顺位 |
| **Round** | ❌ 不存在 | ✅ 全员 done → rebuild |

Phase 0 是一个整体执行块，不作为 Turn/Round 的载体。Turn 和 Round 只定义在 Phase 1 内。

---

## 二、Turn（Phase 1）

### 定义

Phase 1 中单 combatant 一次完整行动（verify → execute → cleanup），由先攻队列的 `next_pid` 驱动。

### hook 位置（仅 emit log，不持久化）

```
Turn start → step 6，manage_queue 确定下一顺位后，AP 恢复后
             语义："下一顺位 combatant 的回合已就绪"
             代码：battle_hook_turn_start() 在 battle_manage_queue 末尾调用

Turn end   → step 4.5（battle_main_end 入口，Phase 1 时触发）
             语义："当前 combatant 的行动已全部执行完毕"
             代码：battle_hook_turn_end() 在 battle_main_end 入口 Phase 1 分支调用
```

### Turn end 触发条件

`battle_hook_turn_end()` 在 `battle_main_end` 入口由 `!empty($actor_data['bid'])` 守护——这不是"战斗是否已结束"的判断，而是"是否 Phase 1"的判断。

`$actor_data['bid']` 的三种状态：

| bid | 所属 | 含义 | 后续 |
|-----|------|------|------|
| 空 | Phase 0 | 队列未创建，ambush 阶段 | step 5 三路出口（quit / killed all / 建队列转 Phase 1） |
| 非空 | Phase 1 | 队列存在，正常战斗中 | manage_queue 推进或解散 |
| 空 | Phase 1 | 队列已丢失（异常） | 不应正常发生 |

Phase 0 走到 step 4.5 时 `bid` 为空，但战斗**未**结束——step 5 可能成功建队列。此时不触发 Turn end，因为不存在 Turn。

### 跨请求分布

Turn start 在请求 N 的 step 6，Turn end 在请求 N+1 的 step 4.5。队列行（`done=0`）是"谁的回合"的持久化证据，无需额外存储。

例外：Phase 1 第一个 Turn start（紧接在 Phase 0 成功之后）与 Phase 0 在同一次请求内——step 5 ok → queue_create_and_init → step 6 manage_queue 确定第一个 next_pid。

---

## 三、Round（Phase 1）

### 定义

先攻队列全员 `done=1` → 重建队列（重新投先攻）。由 `battle_queue_rebuild()` 执行。

### hook 位置

```
Round end   → step 6 manage_queue，if (empty($undone))（rebuild 前）
Round start → battle_queue_rebuild() 末尾（round_num++ 后）
```

### round_num 修复

字段 `bra_oblbattle_state.round_num` 已存在但从未递增。修复：在 `battle_queue_rebuild()` 末尾 +1。

```php
function battle_queue_rebuild($qid, &$actor_data, &$obl_battle_log): array
{
    // ... 现有逻辑 ...
    obl_battle_state_increment_round($qid);
    return $result;
}

function obl_battle_state_increment_round($qid) {
    global $db, $tablepre;
    $db->query("UPDATE {$tablepre}oblbattle_state SET round_num = round_num + 1 WHERE qid = " . (int)$qid);
}
```

起始值说明：`battle_queue_create_and_init` 创建时 `round_num=0`（Round 1），第一次 rebuild 后为 1（Round 2）。0-indexed。

---

## 四、骨架中的 hook 位置

```
step 3  首次进入战斗（仅 ambush：state_init）
         ╰── 无 Turn/Round hook（Phase 0）
step 4  动作执行（battle_main：verify → execute）
step 4.5 战斗清理（battle_main_end）
         ├─ Phase 0：cleanup + 返回 ambusher quit flag，无 Turn 事件
         └─ Phase 1：Turn end → battle_hook_turn_end()
step 5  队列后补票（仅 ambush）
         ├─ 失败 → return（Phase 0 出口，无 Turn/Round）
         └─ ok → battle_queue_create_and_init → step 6
                  ╰── Phase 1 开始
step 6  队列管理（battle_manage_queue）
         ├─ empty($undone) → Round end → rebuild → Round start
         └─ 确定 next_pid 后 → Turn start → battle_hook_turn_start()（Phase 1）
step 7  返回
```

---

## 五、Battle end 锚点

`battle_state_clear($actor, $log, $cache, $reason)` 的 `$reason` 天然分两层：

| 层次 | 调用位置 | reason 取值 | 是否 battle end |
|------|---------|-------------|:---:|
| per-combatant cleanup | step 4.5 `battle_main_end` foreach | `'death'` / `'escaped'` / `'unknown'` | ❌ |
| dispatch 层结束 | step 5 A1/A2 → return 前 | `'ambush_dead'` / `'ambush_escaped'` / `'ambush_killed_all'` | ✅ |
| dispatch 层结束 | step 6 manage_queue 解散 → return 前 | `'battle_end'` | ✅ |

per-combatant cleanup 和 battle end anchor 是两次独立调用——`battle_main_end` 对每个退场 combatant 先清一次（reason=death/escaped），dispatch 层再清一次（reason=ambush_*/battle_end）。后者因 `battle_state_clear` 内部二次调用保护（检测 `action` 和 `bid` 已空）直接 return。

约定：**dispatch 层（step 5 / step 6）的 `battle_state_clear` 调用即为战斗结束锚点**，以 `$reason` 中的 `ambush_*` 或 `battle_end` 作为标识。

---

## 六、汇总表

| 事件 | hook 位置 | 函数 | DB 变更 |
|------|----------|------|---------|
| **Turn start (Phase 1)** | step 6 manage_queue 确定下一顺位后 | `battle_hook_turn_start()` | 无 |
| **Turn end (Phase 1)** | step 4.5（battle_main_end 入口） | `battle_hook_turn_end()` | 无 |
| **Round end** | step 6 manage_queue，`empty($undone)` 前 | 无 |
| **Round start** | `battle_queue_rebuild()` 末尾 | `round_num++` |

---

## 七、存储总结

| 概念 | DB 变更 | 理由 |
|------|--------|------|
| **Turn** | 不变 | queue（done 标志）+ state（next_pid）已覆盖 |
| **Round** | 仅 `round_num++` | 字段已存在，只缺递增逻辑 |
