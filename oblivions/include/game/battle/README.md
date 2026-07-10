# Battle Shared Infrastructure

`oblivions/include/game/battle/` 不再承载旧 battle engine 的主执行入口。

当前状态：

- 旧执行链 `battle.main.php` / `battle.entry.php` 已删除。
- command / NPC / bootstrap 运行入口已全部切到 `combat/`。
- 本目录保留下来的文件，都是 **new combat 仍在复用的共享基础设施**。

## 文件职责

| 文件 | 当前职责 | 典型调用方 |
|---|---|---|
| `battle.calc.php` | 射程 / 先攻 / 伤害计算等共享数值函数 | `combat.preview.php` / `combat.ap.php` / `battle.queue.func.php` |
| `battle.func.php` | 轻量战斗状态切换、AP 恢复、目标规则、turn hook | `combat.core.php` / `battle.queue.main.php` / `battle.queue.func.php` |
| `battle.queue.func.php` | 先攻队列原语：建队列、重排顺位、锁定后 append-tail、exit | `combat.participation.php` / `combat.core.php` / `battle.queue.main.php` |
| `battle.queue.main.php` | 队列编排：rebuild、disband、`battle_manage_queue()` | `combat.core.php` / `enemy_ai.func.php` |

## 迁移边界

- **已下线**：旧 battle engine 的动作执行主流程。
- **仍保留**：队列、状态机、AP 恢复、battle log collector 兼容持久化。
- **暂不迁名**：`battle_*` 函数名仍被大量活代码调用；当前优先保持运行稳定。

## 动态参战约束

`battle_queue_append_tail()` 是现有战场新增成员的唯一写入口：

- Participation 先锁定并重读目标 player/queue 状态；
- 已是当前 qid active member 时幂等返回；
- `left`、`other_battle` 和 player/queue/bid/action 不一致时 fail closed；
- joinable 目标以 `myorder=max+1, active=1, done=0` 追加；
- 不删除其他 qid 的队列行，不重投已有成员先攻，不立即推进当前 actor；
- 成功后同步 target `action/bid`、battle cache，并在效果前 emit `combatant_joined`。

旧 `battle_queue_join()` 的“先按 PID 删除旧队列行再插入”行为不安全，已经删除，不能恢复兼容 wrapper。

所有 queue/player/battle-state 写入都位于 command/heartbeat 的 InnoDB 请求事务内。TargetResolutionUnit 还会在 append-tail 前建立 SAVEPOINT，使当前目标后续效果失败时能够撤销本目标入列，而不回滚此前已经成功的目标。

## 维护原则

1. 不要把本目录等同于“旧引擎死代码”直接删除。
2. 新执行逻辑继续放在 `combat/`。
3. 若未来要迁名为 `combat_queue_*` / `combat_runtime_*`，应先做引用收束与回归验证，再逐步迁移。
4. 不得绕过 Participation 直接修改 `oblqueue` 或角色 `bid/action`。
