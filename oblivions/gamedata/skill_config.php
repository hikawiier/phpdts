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
#     'category'      => 分类：attack/escape/utility/passive（默认utility）
#     'damage_type'   => 伤害类型：physical/magical/none（默认none）
#     'damage_factor' => 伤害系数（att × factor，默认0）
# ]
# 不含 name/desc/icon，资源由前端 skill-templates.js 按 skill_id 渲染
return [
    # ── 攻击类 ──────────────────────────────
    'unarmed_strike' => [
        'apcost'        => 1,
        'cd'            => 0,
        'target'        => 'enemy',
        'range_bonus'   => 0,
        'lifetime'      => 'permanent',
        'category'      => 'attack',
        'damage_type'   => 'physical',
        'damage_factor' => 1.0,
    ],
    # ── 逃跑类 ──────────────────────────────
    'escape' => [
        'apcost'        => 0,
        'cd'            => 1,
        'target'        => 'self',
        'range_bonus'   => 0,
        'lifetime'      => 'permanent',
        'category'      => 'escape',
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
