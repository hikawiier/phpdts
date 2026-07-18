<?php
/**
 * @module F 物品系统
 */
if (!defined('IN_GAME')) { exit('Access Denied'); }

// ================================================================
// Oblivions 神秘礼盒战利品表 / Oblivions gift_box loot table
//
// 配置格式与 oblivions/gamedata/loot_tables.php 同构（表 ID → 表定义），
// 便于未来合并到主战利品表或被 F-4 引擎扩展支持多文件加载。
//
// 调用方：item_use_effect_open_gift_box（item.use_effects.func.php）
// 调用方式：include 本文件 → 取 ['gift_box_loot'] 表定义
//           → 遍历 groups 调用 obl_roll_group（F-4 原语）
//           → obl_apply_durability_decay（如启用）
//
// 字段语义同 loot_tables.php：
//   - 表级 name               : 表名（日志/调试用）
//   - 表级 durability_decay    : bool 是否对产出物品应用耐久衰减
//   - 表级 groups              : 物品组列表，每组独立掷骰
//   - 组级 chance             : float 0-1 组级概率（先于 entry 判定），默认 1.0
//   - 组级 entries            : 互斥选项列表，按 weight 加权选一
//   - entry item_id           : 物品模板 ID（对应 item_table.php 的 key）
//   - entry weight            : int/float 组内互斥权重（非概率，组内归一化），默认 1
//   - entry count             : int 或 [min,max] 生成数量
//
// 相关文档：
// - 《道具使用与装备系统-设计案.md》§3.2
// - 《搜索建筑物与掉落机制重构-模块F-战利品表引擎.md》
// ================================================================

return [
    'gift_box_loot' => [
        'name' => '神秘礼盒掉落',
        // 礼盒产物不含装备耐久概念（盒子本身的 itme=1 是开盒次数标识）
        'durability_decay' => false,
        'groups' => [
            // 第一组：100% 出一件物品（互斥加权选一）
            [
                'chance' => 1.0,
                'entries' => [
                    // 常见物资（高权重）
                    ['item_id' => 'scrap_metal', 'weight' => 30, 'count' => [1, 3]],
                    ['item_id' => 'dirty_rag',  'weight' => 25, 'count' => [1, 2]],
                    ['item_id' => 'cloth',      'weight' => 20, 'count' => [1, 2]],
                    // 偶尔有好装备（中权重）
                    ['item_id' => 'scrap_blade', 'weight' => 10, 'count' => 1],
                    ['item_id' => 'scrap_vest',  'weight' => 8,  'count' => 1],
                    // 罕见药物（低权重）
                    ['item_id' => 'health_potion',  'weight' => 5, 'count' => 1],
                    ['item_id' => 'stamina_potion', 'weight' => 2, 'count' => 1],
                ],
            ],
        ],
    ],
];
