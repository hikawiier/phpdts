<?php
// ================================================================
// Oblivions 子系统统一引导文件
// 集中加载所有函数库，消除散落的条件 include，避免漏写依赖
//
// 加载顺序按拓扑排序：被依赖的文件先加载
// require_once 保证不重复加载
// ================================================================

if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// 第 0 层：公共函数库（跨业务域通用函数，最先加载）
require_once GAME_ROOT . './oblivions/include/game/obl_global.func.php';

// 第 0.5 层：Oblivions 单局状态仓储与 gamevars 兼容镜像
require_once GAME_ROOT . './oblivions/include/core/obl_game_repository.php';
require_once GAME_ROOT . './oblivions/include/core/obl_gamevars.php';

// 第 1 层：独立函数库（依赖第 0 层或无依赖）
require_once GAME_ROOT . './oblivions/include/game/log.func.php';
require_once GAME_ROOT . './oblivions/include/game/battle_log.func.php';
require_once GAME_ROOT . './oblivions/include/game/sql.func.php';
require_once GAME_ROOT . './oblivions/include/game/player.func.php';
require_once GAME_ROOT . './oblivions/include/game/move.func.php';
require_once GAME_ROOT . './oblivions/include/game/generate.func.php';
require_once GAME_ROOT . './oblivions/include/game/battle/battle.calc.php';
// 道具 Tag 读取层较轻量，技能模块可能依赖它进行装备性质判断。
require_once GAME_ROOT . './oblivions/include/game/item/item.tag.func.php';
require_once GAME_ROOT . './oblivions/include/game/actor/actor.capability.php';
require_once GAME_ROOT . './oblivions/include/game/skill/skill.main.php';
require_once GAME_ROOT . './oblivions/include/game/skill/skill.modules.php';
skill_load_modules();
require_once GAME_ROOT . './oblivions/include/game/skill_effect/skill_effect.main.php';
require_once GAME_ROOT . './oblivions/include/game/skill_effect/skill_effect.lifecycle.php';
require_once GAME_ROOT . './oblivions/include/game/skill_effect/skill_effect.projector.php';
skill_effect_register_capability_provider();

// 第 2 层：视野/迷雾/发现系统（依赖 obl_global + player + move + log）
require_once GAME_ROOT . './oblivions/include/game/vision.func.php';

// 第 2.5 层：共享战斗状态机（new combat 的队列推进 / NPC 回合 / Tick Orchestrator 依赖）
require_once GAME_ROOT . './oblivions/include/game/battle_state_machine.func.php';

// 第 3-4.5 层：shared combat infrastructure。
// 说明：battle/ 目录中的旧主执行链已删除；保留下来的 battle.* 文件现在只承担
// 数值、队列原语、队列编排、轻量状态切换等共享职责，供 combat/ 复用。
require_once GAME_ROOT . './oblivions/include/game/battle/battle.func.php';
require_once GAME_ROOT . './oblivions/include/game/battle/battle.queue.func.php';
require_once GAME_ROOT . './oblivions/include/game/battle/battle.queue.main.php';

// 第 4.7 层：新战斗系统 combat/ 模块（唯一战斗执行入口）
require_once GAME_ROOT . './oblivions/include/game/combat/combat.runtime.php';
require_once GAME_ROOT . './oblivions/include/game/combat/combat.context.php';
require_once GAME_ROOT . './oblivions/include/game/combat/combat.planned_state.php';
require_once GAME_ROOT . './oblivions/include/game/combat/combat.observation.php';
require_once GAME_ROOT . './oblivions/include/game/combat/combat.aim.php';
require_once GAME_ROOT . './oblivions/include/game/combat/combat.target_capture.php';
require_once GAME_ROOT . './oblivions/include/game/combat/combat.participation.php';
require_once GAME_ROOT . './oblivions/include/game/combat/combat.target_unit.php';
require_once GAME_ROOT . './oblivions/include/game/combat/combat.core.php';
require_once GAME_ROOT . './oblivions/include/game/combat/combat.pipeline.php';
require_once GAME_ROOT . './oblivions/include/game/combat/combat.effect.php';
require_once GAME_ROOT . './oblivions/include/game/combat/combat.target.php';
require_once GAME_ROOT . './oblivions/include/game/combat/combat.skill.php';
require_once GAME_ROOT . './oblivions/include/game/combat/combat.ap.php';
require_once GAME_ROOT . './oblivions/include/game/combat/combat.range.php';
require_once GAME_ROOT . './oblivions/include/game/combat/combat.tag.php';
require_once GAME_ROOT . './oblivions/include/game/combat/combat.queue.php';
require_once GAME_ROOT . './oblivions/include/game/combat/combat.state.php';
require_once GAME_ROOT . './oblivions/include/game/combat/combat.effect_projector.php';
require_once GAME_ROOT . './oblivions/include/game/combat/combat.chain.php';
require_once GAME_ROOT . './oblivions/include/game/combat/combat.preview.php';
require_once GAME_ROOT . './oblivions/include/game/combat/combat.log.php';

// 第 5 层：探索交互 + 敌人 AI（依赖 vision，无循环依赖）
require_once GAME_ROOT . './oblivions/include/game/explore.func.php';
require_once GAME_ROOT . './oblivions/include/game/enemy_ai.func.php';

// 第 5.5 层：道具系统（依赖 log + player + explore，无循环依赖）
// 加载顺序：tag（数据加载）→ basic（基础操作）→ use（衍生）→ craft（衍生）
require_once GAME_ROOT . './oblivions/include/game/item/item.basic.func.php';
require_once GAME_ROOT . './oblivions/include/game/item/item.use.func.php';
require_once GAME_ROOT . './oblivions/include/game/item/item.craft.func.php';

// 第 6 层：依赖最广，末尾注册 tick 监听器
require_once GAME_ROOT . './oblivions/include/game/tick.func.php';
skill_effect_register_tick_listener();

// 第 6.5 层：Tick Orchestrator（集中调度 command/heartbeat/state 的 tick 策略）
require_once GAME_ROOT . './oblivions/include/core/obl_tick_orchestrator.php';

// 第 7 层：游戏初始化（依赖全部函数库，仅在 obl_rs_game 调用时执行）
require_once GAME_ROOT . './oblivions/include/gamectl/init.func.php';

// 第 8 层：游戏状态机（依赖 init.func.php；当前主要由旧 Room/Lifecycle 入口调用）
require_once GAME_ROOT . './oblivions/include/gamectl/state.func.php';

