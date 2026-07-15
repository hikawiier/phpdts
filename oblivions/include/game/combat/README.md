# Combat Module

## 执行模型

`include/game/combat/` 是 Oblivions 唯一战斗执行模块。动作执行使用目标优先管道：

```text
AimIntent
-> AimResolver
-> ResolvedAim
-> ResolutionTargetCapturer
-> ordered ResolutionTarget[]
-> TargetResolutionUnit A 完整结算
-> TargetResolutionUnit B 完整结算
-> action finalize
```

每个目标单元依次执行最新状态绑定、规则、Participation、效果声明、入列、`snapshot_target_state`、效果应用、死亡/逃跑清理、持久化和事件输出。一个目标被拒绝只产生 `skipped`，不会阻止后续目标。

真实执行会为每个目标建立数据库 SAVEPOINT 和 BattleLogCollector checkpoint。入列或效果阶段出现可恢复失败时，只撤销当前目标的 DB、内存和暂存事件；SQL/PHP 基础设施异常仍由 command/heartbeat 外层事务回滚整条请求。

## 文件职责

| 文件 | 当前职责 |
|---|---|
| `combat.context.php` | `CombatContext`，保存 ResolvedAim、CapturedTargetSet、当前目标、target results、资源与 delivery 状态 |
| `combat.aim.php` | `pid/tile/self/none` AimResolver registry 与瞄准规则 |
| `combat.target_capture.php` | 四个内置 Capturer、权威来源校验、去重和稳定排序 |
| `combat.target_unit.php` | 逐目标完整结算、Participation enlist、目标 SAVEPOINT、资源一次提交 |
| `combat.participation.php` | `member/joinable/left/other_battle/blocked/not_applicable` 分类 |
| `combat.pipeline.php` | 入口编排：Aim -> Capture -> TargetResolutionUnit，不再按 stage 批量遍历所有目标 |
| `combat.chain.php` | verify/preview 的 planned-state 投影，复用同一 Aim/Capture/Unit 语义 |
| `combat.effect.php` | 只对 current target 或显式 `scope=actor` 应用效果；move 写入也在 applier 内 |
| `combat.core.php` | 动作排序、首回合意图绑定，以及已认领回合的执行链 |
| `combat.skill.php` | 技能配置加载及 aim/capture/execution/delivery 组合校验 |
| `combat.log.php` | `turn_opened`、`action_delivery`、逐目标 effect 等 battlelog.v3 事件 |
| `combat.preview.php` | 无 DB/文件日志/RNG 副作用的 engage/single/chain 预览 |
| `combat.target.php` | 仅保留旧入口 facade，领域实现位于 aim/capture 文件 |

## 技能配置

技能必须显式声明：

```php
'aim' => ['resolver' => 'pid|tile|self|none', 'rules' => []],
'capture' => [
    'resolver' => 'direct_character|battle_hostiles|tile_characters|identity',
    'relation' => 'hostile|friendly|any|self',
    'participation' => 'join_if_unengaged|members_only|none',
    'order' => 'single|queue|queue_then_pid|pid',
    'rules' => [],
],
'execution' => ['empty_policy' => 'fail|execute'],
'delivery' => ['types' => []],
```

`delivery.types` 是有序语义 cue。grenade 使用 `['projectile_to_tile', 'explosion_at_tile']`；无独立投送的动作使用空数组。技能 hook 只能声明当前目标效果，不能查询或写入任意 PID。

## 共享边界

`battle/` 只提供先攻计算和队列顺位原语；E-5 的 `battle_turn.func.php` 统一开放、认领和关闭权威回合。动态参战只允许调用锁定后的 `battle_queue_append_tail()`；会先删除 PID 旧队列记录的 unsafe join 接口已经移除。

旧 battle engine 已下线，`obl_config.php` 的 `combat_engine='new'` 仅保留为历史配置键。
