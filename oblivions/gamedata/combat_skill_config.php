<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// 新战斗系统 — 技能配置表
//
// 结构：每个 act_id => 配置数组
//   - pipeline : attack / utility / passive（管道类型）
//   - target   : enemy / all / tiles / self / none（目标类型）
//   - ap_calc  : fixed / move_distance / throw_distance / 自定义 calc_id
//                 留空默认 'fixed'
//   - apcost   : int（AP 计算基数，非最终消耗）
//   - range    : ['mode' => fixed/inherit/move_power/additive/capped_additive,
//                  'max'  => int,
//                  'bonus'=> int]
//   - rules    : ['forbid' => [tag_name, ...]]（纯配置驱动匹配）
//   - effects  : ['damage', 'heal', 'move', 'escape', ...]（声明提示，
//                 实际效果由 skill_{act_id}_execute 钩子声明）
//   - finisher : bool（终结技标记，sort 阶段多个 finisher 只保留最后一个）
//
// 与旧 skill_config.php 不兼容：字段结构完全重建。
// 旧系统字段（category / damage_type / damage_factor / range_mode / range_max /
//   range_bonus / target_rules）被新字段替代。
//
// P0+P1 验收基线（6 个技能，spec "验收基线"章节）：
//   move / unarmed_strike / escape / heal / throw / whirlwind
// ================================================================

return [

    // ── move：utility 管道 + tile 目标 + 动态 AP + move 特例副作用 ──
    'move' => [
        'pipeline' => 'utility',
        'target'   => 'tiles',
        'system'   => true,
        'cd'       => 0,
        'ap_calc'  => 'move_distance',
        'apcost'   => 1,
        'range'    => ['mode' => 'move_power', 'max' => 0, 'bonus' => 0],
        'rules'    => [
            'forbid' => ['tile_impassable', 'tile_occupied', 'tile_unreachable', 'tile_out_of_range'],
        ],
        'effects'  => ['move'],
        'finisher' => false,
    ],

    // ── unarmed_strike：attack 管道完整 8 阶段 + pid 目标 + 死亡检测 ──
    'unarmed_strike' => [
        'pipeline'      => 'attack',
        'target'        => 'enemy',
        'cd'            => 0,
        'ap_calc'       => 'fixed',
        'apcost'        => 1,
        'range'         => ['mode' => 'fixed', 'max' => 1, 'bonus' => 0],
        'rules'         => [
            'forbid' => ['self', 'dead', 'escaped', 'out_of_range'],
        ],
        'effects'       => ['damage'],
        'damage_type'   => 'physical',
        'damage_factor' => 1.0,
        'finisher'      => false,
    ],

    // ── escape：none 目标不查 DB + escape 效果 + tag_mutations ──
    'escape' => [
        'pipeline' => 'utility',
        'target'   => 'none',
        'cd'       => 1,
        'ap_calc'  => 'fixed',
        'apcost'   => 0,
        'range'    => ['mode' => 'fixed', 'max' => 0, 'bonus' => 0],
        'rules'    => [
            'forbid' => [],
        ],
        'effects'  => ['escape'],
        'finisher' => true,
    ],

    // ── heal：self 目标引用 + heal 效果上限 mhp ──
    'heal' => [
        'pipeline'  => 'utility',
        'target'    => 'self',
        'cd'        => 0,
        'ap_calc'   => 'fixed',
        'apcost'    => 1,
        'range'     => ['mode' => 'fixed', 'max' => 0, 'bonus' => 0],
        'rules'     => [
            'forbid' => ['dead'],
        ],
        'effects'   => ['heal'],
        'heal_value'=> 20,
        'finisher'  => false,
    ],

    // ── throw：自定义 ap_calc 注册 + 远程射程 + L0 可达性 ──
    // throw_distance 计算器由 skill_throw.php 模块注册（combat_ap_register）
    'throw' => [
        'pipeline'      => 'attack',
        'target'        => 'enemy',
        'cd'            => 0,
        'ap_calc'       => 'throw_distance',
        'apcost'        => 1,
        'range'         => ['mode' => 'fixed', 'max' => 4, 'bonus' => 0],
        'rules'         => [
            'forbid' => ['self', 'dead', 'escaped', 'out_of_range'],
        ],
        'effects'       => ['damage'],
        'damage_type'   => 'physical',
        'damage_factor' => 1.5,
        'finisher'      => false,
    ],

    // ── whirlwind：target='all' 多目标 + per-target 迭代 + effects per-target 不重复 ──
    'whirlwind' => [
        'pipeline'      => 'attack',
        'target'        => 'all',
        'cd'            => 0,
        'ap_calc'       => 'fixed',
        'apcost'        => 2,
        'range'         => ['mode' => 'fixed', 'max' => 1, 'bonus' => 0],
        'rules'         => [
            'forbid' => ['self', 'dead', 'escaped', 'out_of_range'],
        ],
        'effects'       => ['damage'],
        'damage_type'   => 'physical',
        'damage_factor' => 0.8,
        'finisher'      => false,
    ],

    // ── idle：NPC 专属发呆技能（玩家不可见）──
    'idle' => [
        'pipeline' => 'utility',
        'target'   => 'none',
        'cd'       => 0,
        'ap_calc'  => 'fixed',
        'apcost'   => 0,
        'range'    => ['mode' => 'fixed', 'max' => 0, 'bonus' => 0],
        'rules'    => [
            'forbid' => [],
        ],
        'effects'  => [],
        'finisher' => false,
        'hidden'   => true,
    ],
];
