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
| `battle.queue.func.php` | 先攻队列原语：建队列、重排顺位、join/exit | `combat.queue.php` / `combat.core.php` / `battle.queue.main.php` |
| `battle.queue.main.php` | 队列编排：rebuild、disband、`battle_manage_queue()` | `combat.core.php` / `enemy_ai.func.php` |

## 迁移边界

- **已下线**：旧 battle engine 的动作执行主流程。
- **仍保留**：队列、状态机、AP 恢复、battle log collector 兼容持久化。
- **暂不迁名**：`battle_*` 函数名仍被大量活代码调用；当前优先保持运行稳定。

## 维护原则

1. 不要把本目录等同于“旧引擎死代码”直接删除。
2. 新执行逻辑继续放在 `combat/`。
3. 若未来要迁名为 `combat_queue_*` / `combat_runtime_*`，应先做引用收束与回归验证，再逐步迁移。
