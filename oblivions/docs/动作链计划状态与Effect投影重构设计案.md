# 动作链计划状态与 Effect 投影重构设计案

> 目的：记录战斗移动后接打击失败问题背后的结构判断，并提出新的框架基准。本文不只是修复 `move -> attack` 个例，而是重新定义新战斗系统中“动作链”应如何被校验、预演和执行。

## 1. 背景

新战斗系统已接入 6 个基线技能和 P9 边缘测试技能。测试战斗移动时发现：

1. 前端战斗移动瞄准曾错误触发真实地图移动。
2. 战斗移动的动态距离、动态 AP、动作阶段移动动画存在缺口。
3. 修复前端计划位置后，继续测试 `move -> unarmed_strike`，后端日志显示打击动作仍被过滤。

这暴露出一个更深层的问题：新框架并没有真正打通“移动后打击”的完整管道链条。

## 2. 日志事实

日志文件：

`oblivions/cache/battles/combat_debug.log`

关键流程：

```text
START_BATTLE_ENTRY actions=[
  {"act_id":"move","target":{"type":"tile","id":3}},
  {"act_id":"unarmed_strike","target":{"type":"pid","id":12}}
]

VERIFY_RULES move pass=true
VERIFY_AP move ap_cost=1

VERIFY_RULES unarmed_strike pass=false reason=out_of_range

VERIFY_END verified_count=1
EXECUTE_ENTRY atk_act_count=1
DISPATCH_MAIN_AFTER atk_act=[move]
```

结论：

1. 前端确实提交了 `move -> unarmed_strike` 两个动作。
2. `move` 在 verify 阶段通过。
3. `unarmed_strike` 在 verify 阶段因为 `out_of_range` 被过滤。
4. execute 阶段只执行了 `move`，攻击动作根本没有进入真实执行管道。

这不是“移动技能没有执行”，也不是“前端没有提交攻击”，而是后端队列验证没有理解前序移动对后续动作上下文的改变。

## 3. 当前结构问题

当前真实结构更接近：

```text
sort(actions)
verify(action[0] against current DB/actor state)
verify(action[1] against current DB/actor state)
verify(action[2] against current DB/actor state)
execute(verified actions)
```

而不是：

```text
planned_state = current state

for action in sorted actions:
  resolve target against planned_state
  check rules against planned_state
  calculate AP against planned_state
  project effects into planned_state

execute verified chain with strong recheck
```

因此，当前系统虽然有“队列”形式，但缺少真正的一等概念：动作链状态。

## 4. 已有设计中已预见的问题

`phase1.5-supplement-preview-system.md` 中已经记录过 L2 动作链模拟的限制：

1. v1 不模拟效果应用。
2. `$sim_actor` 的位置/HP 在遍历中不更新。
3. `move` 后的 action 会按旧位置算距离/AP，可能误判 `out_of_range` 或 AP 不足。
4. v2 方向是真正模拟效果应用，让前序动作的 HP/位置改动对后序可见。

也就是说，这次 bug 不是偶发实现错误，而是原设计中“未来 v2 方向”尚未落地导致的必然结果。

## 5. 概念提炼

### 5.1 ActionChain 应成为框架基准

队列不应被看作多个独立 action 的数组，而应被看作一个顺序计划。

动作链中的每个 action 都可能改变后续 action 的上下文：

- `move` 改变位置。
- `damage` 改变 HP / 死亡状态。
- `escape` 改变 combatant 活跃状态。
- `heal` 改变 HP。
- `grenade` 改变多个目标 HP。
- `execute` 依赖目标当前 HP。
- `vampiric_bite` 同时影响敌人和自己。

如果框架只累计 AP，不维护动作链状态，后续技能越复杂，误判越多。

### 5.2 PlannedState 应成为框架基准

需要一个显式的计划状态，而不是给 `move` 单独开特例。

计划状态至少应包含：

| 状态 | 用途 |
|------|------|
| actor_data | 位置、AP、HP、state |
| targets / combatants | 死亡、逃跑、清场 |
| tag_mutations | dead / escaped / custom tags |
| battle_cache | 战斗内共享状态 |
| effect_targets | 非当前目标 effect 重定向 |

计划状态的语义：

1. verify / preview 使用计划状态，不写 DB。
2. execute 使用真实状态，但应走同一套规则和 effect 应用语义。
3. execute 仍必须强校验，因为真实状态可能在 verify 后变化。

### 5.3 Effect Projection 应成为框架基准

技能不应在 verify 中被特殊模拟。

更优雅的结构是：

```text
skill_execute declares effects
effect_projector applies effects to planned_state
effect_applier applies effects to real state
```

同一个 effect 类型应具备两种执行模式：

| 模式 | 作用 |
|------|------|
| project / dry-run | 修改计划状态，不写 DB，不发真实日志 |
| apply / execute | 修改真实内存状态，发 battlelog，persist |

这样 `move`、`damage`、`heal`、`escape`、`status`、`custom` 都能被统一处理，而不是在 `combat_verify()` 里不断增加 `if move`、`if damage`。

## 6. 当前短期补丁的定位

当前已做过一个止血方向：

1. `combat_verify()` 增加 `$sim_actor = $actor_data`。
2. 通过动作后把 AP 扣到 `sim_actor.ap`。
3. 如果技能声明 `move` effect，则把 `sim_actor.pgroup/pls` 推进到目标格。

这个补丁能缓解 `move -> attack` 的一部分场景，但不是最终结构。

局限：

1. 只投影 AP 和位移。
2. 不投影 damage / heal / escape / death / tag_mutations。
3. 与 `combat_preview_chain()` 仍然是两套逻辑。
4. 技能 effect 的真实执行和计划投影仍未统一。
5. P9 技能会继续放大裂缝，尤其是 `execute / vampiric_bite / grenade`。

因此，短期补丁只能作为验证线索，不应成为新框架基准。

## 7. 目标结构

建议新增一层动作链运行器：

```text
CombatChainRunner
  - normalize actions
  - sort actions
  - create PlannedState
  - run each action in project mode
  - return verified chain + projected result
  - execute verified chain in real mode
```

推荐职责拆分：

| 模块 | 职责 |
|------|------|
| `combat.chain.php` | 动作链 orchestration |
| `combat.planned_state.php` | 计划状态创建、读取、写入 |
| `combat.effect_projector.php` | effect dry-run 投影 |
| `combat.effect.php` | 真实 effect 应用 |
| `combat.core.php` | 入口调度，尽量变薄 |

## 8. 目标流程

### 8.1 Verify / Preview 链路

```text
planned = combat_planned_state_create(actor_data, battle_cache)

for action in sorted_actions:
  ctx = combat_context_from_planned_state(planned, action)
  resolve_target(ctx)
  check_rules(ctx)
  calculate_ap(ctx)
  if pass:
    declared_effects = skill_execute(ctx, dry_run=true)
    project_effects(planned, declared_effects)
    action._ap_cost = ap_cost
    verified_actions[] = action
  else:
    emit failure / collect preview failure
```

关键点：

1. dry-run 可以调用技能声明逻辑，但所有副作用必须走 effect projector。
2. 技能钩子不能直接写真实 DB。
3. `move` 不能在技能钩子里作为唯一例外直接修改 actor，需重新评估其原子占用语义。

### 8.2 Execute 链路

```text
for action in verified_actions:
  ctx = combat_context_from_real_state(actor_data, action)
  resolve_target(ctx)
  check_rules(ctx)
  ctx.ap_cost = action._ap_cost
  skill_execute(ctx, dry_run=false)
  apply_effects(ctx)
  persist(ctx)
```

execute 不应盲信 verify：

1. 目标可能死亡。
2. 目标可能逃跑。
3. 格子可能被占用。
4. actor 可能被前序效果终止。

但 execute 和 verify 应共享同一套 effect 语义，而不是各写一套。

## 9. Move 的特殊性重新评估

当前 `skill_move_execute()` 会直接调用 `obl_perform_move_core()` 修改 actor 位置，然后声明 `move` effect。

原理由是：

1. 位置需要原子化更新。
2. 避免并发占用。
3. resolve_effects 阶段再改可能太晚。

这确实是一个真实约束，但它不应破坏 effect-driven 架构。

可选方向：

1. 保留 execute 阶段真实移动原子化，但 project 阶段用 `move` effect projector 模拟位置。
2. 把 `obl_perform_move_core()` 拆成 validate / reserve / apply 三段：
   - project：只 validate + planned apply。
   - execute：validate + real apply。
3. 未来如果需要强并发一致性，再引入 tile lock / occupancy reservation，而不是让技能钩子绕开 effect 系统。

## 10. P9 对结构的压力测试

P9 技能不是单纯验收技能，而是结构压力测试：

| 技能 | 暴露的问题 |
|------|------------|
| `execute` | 后序动作依赖前序 damage 后的 HP |
| `vampiric_bite` | 一个 action 同时 damage 敌人、heal 自己 |
| `grenade` | tile target 扩展到多个 pid effect target |

如果没有 PlannedState + Effect Projection：

1. `execute` 可能按旧 HP 判断是否可斩杀。
2. `vampiric_bite` 的自我治疗无法影响后续自己状态判断。
3. `grenade` 的多目标死亡无法影响后续 all/enemy 目标解析。

因此 P9 完整验证前，动作链结构需要先补齐。

## 11. 推荐推进顺序

### P0：冻结补丁扩散

不要继续在 `combat_verify()` 中为每个技能或 effect 增加特判。

### P1：抽出 PlannedState

先建立最小 PlannedState：

1. actor AP。
2. actor pgroup / pls。
3. actor HP / state。
4. battle_cache tag_mutations。

### P2：抽出 Effect Projector

为现有 effect 建立 dry-run 投影：

1. `move`
2. `damage`
3. `heal`
4. `escape`
5. `ap_change`

### P3：统一 verify 和 preview_chain

`combat_verify()` 和 `combat_preview_chain()` 应调用同一套 chain runner，只是输出格式不同：

- verify：返回可执行 action + 发失败日志。
- preview：返回结构化预判结果，不发真实战斗日志。

### P4：重新跑基线 + P9 验证

重点验证：

1. `move -> unarmed_strike`
2. `move -> throw`
3. `grenade -> execute`
4. `vampiric_bite -> heal/self state -> 后续动作`
5. 多目标死亡后 `whirlwind/all` 的目标解析。

## 12. 当前判断

这次问题需要重新设计结构，但不需要推倒整个 combat 模块。

应保留：

1. CombatContext
2. target resolver
3. tag system
4. AP calculator
5. pipeline stages
6. battlelog v2

应重构：

1. `combat_verify()` 的职责。
2. `combat_preview_chain()` 的独立模拟逻辑。
3. effect 应用层缺少 dry-run projector 的问题。
4. `move` 技能绕开 effect 应用层直接改状态的结构例外。

最终目标是让“动态 AP / 多目标 / 多效果 / 动作链状态”成为框架基准，而不是在静态单动作框架上继续补洞。

## 13. 设计案准确性复核

执行前复核结论：

1. 设计案关于“三套语义分裂”的判断成立，但当前代码已经存在一个短期 `sim_actor` 止血补丁：`combat_verify()` 会投影 AP 和 move 位置。该补丁不足以覆盖 damage / heal / death / escape / grenade effect target，因此仍需要 PlannedState + Effect Projection。
2. 当前 effect 类型为 `damage / heal / move / escape / ap_change`。实际技能声明前四类；`ap_change` 是注册位，真实 applier 当前只发日志，不修改 AP。
3. 当前技能钩子中只有 `move` 直接改 `actor_data` 位置；其他状态变化主要集中在 effect applier、persist、state cleanup。
4. P9 的 PlannedState 需求需要补充一点：`grenade` 钩子会直接按 tile 展开 pid 并 fetch 受害者，因此 project 模式必须优先读取 planned player 覆盖，否则 `grenade -> execute` 仍会读取旧 HP。
5. 目标解析器必须支持 planned player 覆盖，否则 effect 投影后的 HP/state 对后续 pid target 解析不可见。

## 14. 已执行的结构落地

已新增并接入：

1. `combat.planned_state.php`
   - 保存 dry-run / verify / preview 动作链中的 planned player 覆盖。
   - 提供 `combat_planned_state_get_player / put_player / spend_ap / sync_actor`。
2. `combat.effect_projector.php`
   - 为 `damage / heal / move / escape / ap_change` 建立 dry-run projector。
   - `damage` 会修改 planned HP，并在 HP<=0 时写 `tag_mutations.dead`。
   - `move` 会修改 planned actor `pgroup/pls`。
   - `escape` 会写 planned battle_cache 的 `combatants/tag_mutations.escaped`。
3. `combat.chain.php`
   - 新增 `combat_chain_project()`，作为 `combat_verify()` 和 `combat_preview_chain()` 的共享动作链投影入口。
   - 负责排序、目标解析、规则检查、AP 计算、技能 effect 声明、effect 投影。
4. `combat.target.php`
   - `pid` resolver 优先读取 planned player，再 fallback 到 DB。
5. `combat.effect.php`
   - effect target 重定向解析优先读取 planned player，再 fallback 到 DB。
6. `skill_move.php`
   - dry-run 时不再调用真实 `obl_perform_move_core()`，只声明 `move` effect。
   - 真实 execute 仍保留 `obl_perform_move_core()`，保证实际移动校验和原子化写位置。
7. `skill_grenade.php`
   - 展开 tile victims 后，计算伤害时优先读取 planned player。
8. `combat_verify()`
   - 改为 thin wrapper，调用 `combat_chain_project()` 取得 verified actions。
9. `combat_preview_chain()`
   - 改为调用同一个 `combat_chain_project()`，不再维护独立 L2 模拟逻辑。
10. `obl_bootstrap.php`
   - 已加载 `combat.planned_state.php / combat.effect_projector.php / combat.chain.php`。

## 15. 当前仍需验证的风险

1. `ap_change` 的真实 applier 与 projector 语义仍不一致：projector 会改 planned AP，真实 applier 当前只发日志。因为当前没有技能声明 `ap_change`，暂不影响本轮测试，但后续启用前必须统一。
2. 真实 execute 仍有独立 precheck + pipeline check_rules，这是安全兜底，不能删除；但如果 project 与 execute 行为出现差异，需要优先检查是否有技能钩子绕过 effect 系统。
3. 多目标技能的 project 现在复用 pipeline 的 `check_rules` 标记 skip，避免把无效 target 也投影效果；仍需用 `whirlwind` 和 `grenade` 实测。
4. `move` 的真实原子化位置写仍在技能钩子内，这是一项保留的结构例外。长期更优方向是拆分 `obl_perform_move_core()` 为 validate / reserve / apply。
