# Combat Module — 新战斗系统

## 概述

新战斗系统采用管道-阶段架构，替代旧 battle engine 的动作执行主流程。
当前 `battle/` 目录不再是旧引擎入口，而是仍被 `combat/` 复用的 shared combat infrastructure。

## 文件职责

| 文件 | 职责 | 关键函数 |
|------|------|----------|
| combat.runtime.php | 运行期 helper（battle log 初始化 + battle_cache） | combat_ensure_battle_log / combat_cache_create |
| combat.context.php | CombatContext 类（单 action 执行上下文） | CombatContext |
| combat.planned_state.php | 动作链计划状态（dry-run 覆盖读取/写入） | combat_planned_state_* |
| combat.chain.php | 动作链投影（verify / preview 共享） | combat_chain_project |
| combat.core.php | 核心调度（入口 + 主循环 + wallet） | combat_dispatch / combat_main / combat_verify / combat_execute |
| combat.pipeline.php | 管道阶段（8 阶段 attack / 7 阶段 utility） | combat_pipeline_run |
| combat.target.php | 目标系统（enemy/all/tiles/self/none） | combat_target_resolve_all |
| combat.tag.php | 标签系统（Cat A 重算 + Cat B 读 mutation） | combat_tag_build / combat_check_target_rules |
| combat.ap.php | AP 系统（动态计算 + 注册表） | combat_ap_calculate / combat_ap_register |
| combat.effect.php | 效果系统（damage/heal/move/escape） | combat_effect_apply_all |
| combat.effect_projector.php | 效果投影（dry-run planned state） | combat_effect_project_all |
| combat.skill.php | 技能系统（配置加载 + 钩子约定） | combat_skill_get_config / combat_skill_load_module |
| combat.queue.php | 队列管理（策略 B：复用 battle_manage_queue） | combat_queue_create_and_init |
| combat.state.php | 战斗状态（combatants + tag_mutations） | combat_state_post_check / combat_state_clear |
| combat.preview.php | 预校验（L0 可达性 + L1 即时 + L2 动作链） | combat_can_engage / combat_preview_single / combat_preview_chain |
| combat.log.php | battlelog.v2 日志适配 | combat_log_v2_effect_applied |

## 与旧系统边界

### 替代关系

- `combat.core.php` 的 `combat_dispatch` 是唯一回合入口
- `combat.core.php` 的 `combat_main` 是唯一战斗执行主流程
- `combat.state.php` 的 `combat_state_clear` 替代 `battle.func.php` 的 `battle_state_clear`
- `combat_skill_config.php` + `combat_skills/` 替代 `skill_config.php` + `skill/modules/`

### 共享适配层（不废止）

- `battle/README.md` — 共享基础设施边界说明
- `battle.func.php` — 轻量状态切换 / AP 恢复 / 目标规则 / turn hook
- `battle_state_machine.func.php` — 3 态状态机，`battle_manage_queue` 内部依赖
- `battle.queue.main.php` — 含 `battle_manage_queue`，新系统收尾调用
- `battle.queue.func.php` — `battle_queue_*` 原语，`combat_queue_*` 转调
- `battle.calc.php` — 射程 / 先攻 / 伤害等共享数值函数
- `battle_log.func.php` — BattleLogCollector 与持久化/played 机制

## 配置状态

旧 battle engine 已下线。`obl_config.php` 中的 `combat_engine='new'` 仅作为历史键保留，入口不再按 old/new 分流。
