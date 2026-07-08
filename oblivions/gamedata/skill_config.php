<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

# 技能配置文件
# 基础结构：ID => [
#     'maxlvl'        => 最大等级（默认1）
#     'effect'        => 每等级对应效果（array，对应每级的效果）
##    'apcost'        => AP消耗（默认0）
#     'cd'            => 冷却回合数（默认0，0=无CD）
#     'target'        => 目标类型：self/enemy/all/tiles（默认self）
#     'range_bonus'   => 射程补正（默认0）
#     'lifetime'      => 生命周期：permanent/equipment/effect（默认permanent）
#     'category'      => 分类：attack/unattack/utility/passive（默认utility；unattack=不进入伤害流程，如逃跑/发呆）
#     'damage_type'   => 伤害类型：physical/magical/none（默认none）
#     'damage_factor' => 伤害系数（att × factor，默认0）
# ]
# 不含 name/desc/icon，资源由前端 skill-templates.js 按 skill_id 渲染
#
# @deprecated 1.0 被 oblivions/gamedata/combat_skill_config.php 替代
# @see combat_skill_config.php
# 新系统技能钩子目录：oblivions/gamedata/combat_skills/
return [
    # ── 攻击类 ──────────────────────────────
    'unarmed_strike' => [
        'apcost'        => 1,
        'cd'            => 0,
        'target'        => 'enemy',
        'range_mode'    => 'fixed',
        'range_max'     => 1,
        'range_bonus'   => 0,
        'lifetime'      => 'permanent',
        'category'      => 'attack',
        'damage_type'   => 'physical',
        'damage_factor' => 1.0,
        'target_rules'  => [
            'forbid'  => ['self', 'dead', 'out_of_range'],
        ],
    ],
    'throw' => [
        'apcost'        => 1,
        'cd'            => 0,
        'target'        => 'enemy',
        'range_mode'    => 'fixed',
        'range_max'     => 4,
        'range_bonus'   => 0,
        'lifetime'      => 'equipment',
        'category'      => 'attack',
        'damage_type'   => 'physical',
        'damage_factor' => 1.0,
        'target_rules'  => [
            'forbid'  => ['self', 'dead', 'out_of_range'],
        ],
    ],
    # ── 逃跑类（终结技）─────────────────────
    'escape' => [
        'apcost'        => 0,
        'cd'            => 1,
        'finisher'      => 1,
        'target'        => 'self',
        'range_mode'    => 'fixed',
        'range_max'     => 0,
        'range_bonus'   => 0,
        'lifetime'      => 'permanent',
        'category'      => 'unattack',
        'target_rules'  => [
            'require' => ['self'],
            'forbid'  => ['dead'],
        ],
    ],
    # ── 发呆类（NPC 专属，玩家不可见）─────────
    'idle' => [
        'apcost'        => 0,
        'cd'            => 0,
        'finisher'      => 0,
        'target'        => 'self',
        'range_mode'    => 'fixed',
        'range_max'     => 0,
        'range_bonus'   => 0,
        'lifetime'      => 'permanent',
        'category'      => 'unattack',
        'hidden'        => true,
        'target_rules'  => [
            'require' => ['self'],
        ],
    ],
    # ── 工具类 ──────────────────────────────
    'heal' => [
        'maxlvl'        => 7,
        'effect'        => [1,2,3,4,5,6,7],
        'lifetime'      => 'permanent',
        'category'      => 'utility',
    ],
    # ── 被动类 ──────────────────────────────  
    'wep_range' => [
        'maxlvl'        => 7,
        'effect'        => [1,2,3,4,5,6,7],
        'lifetime'      => 'equipment',
        'category'      => 'passive',
    ],
];
