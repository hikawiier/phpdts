<?php

if(!defined('IN_GAME')) {
    exit('Access Denied');
}

/*
 * RuleSet系统（时光重现）配置数据
 * 从 ruleset_config.php 提取，消除 get_ruleset_config() 中的重复定义
 * Extracted from ruleset_config.php to eliminate duplicate definitions in get_ruleset_config()
 */

// 系统总开关
$ruleset_enabled = true;

// RuleSet配置
$ruleset_config = Array(
    'YELLOWKNIFE' => Array(
        'name' => 'YELLOWKNIFE',
        'description' => '以当前大房间资源和规则为基准保存的剧情改造用RuleSet。后续可在此基础上独立调整资源层、NPC、物品和配置。',
        'credits_cost' => 1,
        'admin_free' => true,
        'initial_setup' => Array(
            'hp_limit' => 400,
            'sp_limit' => 400,
            'base_exp' => 20,
            'money' => 20,
            'initial_items' => Array(),
            'initial_equipment' => Array(),
            'clbpara_flags' => Array(
                'ruleset_version' => 'YELLOWKNIFE',
                'ruleset_name' => 'YELLOWKNIFE',
            ),
        ),
        'override_modules' => Array(),
        'title_system' => 2,
        'club_skills' => 2,
        'avatar_config' => Array(
            'use_ruleset_avatars' => false,
            'avatar_path' => './img/',
            'male_avatars' => 0,
            'female_avatars' => 0,
            'npc_avatars' => Array(),
            'special_avatars' => Array(),
        ),
        'story_config' => Array(
            'opening_story' => '沿用当前大房间开场剧情。',
            'ending_story' => '沿用当前大房间结局剧情。',
        ),
    ),

    'ACBRA_2009' => Array(
        'name' => 'ACBRA 2009版',
        'description' => '重现2009年经典ACBRA版本的游戏体验，包含原版的平衡性设置、道具系统和NPC配置。',
        'credits_cost' => 1,  // 开启房间需要的切糕数量
        'admin_free' => true,   // 管理员是否免费
        'initial_setup' => Array(
            // 初始装备和属性设置
            'hp_limit' => 500,
            'sp_limit' => 800,
            'base_exp' => 9,
            'money' => 20,
            'initial_items' => Array(
                // 格式：位置 => Array('name' => 道具名, 'type' => 类型, 'effect' => 效果, 'durability' => 耐久, 'special' => 特殊属性)
            ),
            'initial_equipment' => Array(
                // 初始装备设置
            ),
            'clbpara_flags' => Array(
                'ruleset_version' => 'ACBRA_2009',
                'ruleset_name' => 'ACBRA 2009版',
            ),
        ),
        'override_modules' => Array(
            // 需要覆盖的游戏模块文件
            // 'module_name' => 'path_to_override_file'
        ),
        'title_system' => 0,    // 0=全部禁用, 1=只禁用头衔奖励, 2=均不禁用
        'club_skills' => 0,     // 0=全部禁用, 1=使用RuleSet下的社团技能文件, 2=不禁用
        'avatar_config' => Array(
            'use_ruleset_avatars' => true,  // 是否使用RuleSet专用头像
            'avatar_path' => './gamedata/ruleset/ACBRA_2009/img/',  // 头像文件路径
            'male_avatars' => 43,    // 男性头像数量 (m_0.gif 到 m_42.gif)
            'female_avatars' => 43,  // 女性头像数量 (f_0.gif 到 f_42.gif)
            'npc_avatars' => Array(  // NPC头像映射
                1 => 'n_1.gif',     // 董事长/红暮
                11 => 'n_11.gif',   // 真职人
                12 => 'n_12.gif',   // 其他NPC
                13 => 'n_13.gif',
                14 => 'n_14.gif',
                15 => 'n_15.gif',
                16 => 'n_16.gif',
                17 => 'n_17.gif',
                18 => 'n_18.gif',
                81 => 'n_81.gif',   // 特殊NPC
                82 => 'n_82.gif',
                83 => 'n_83.gif',
                84 => 'n_84.gif',
                85 => 'n_85.gif',
                86 => 'n_86.gif',
                87 => 'n_87.gif',
                90 => 'n_90.gif',   // 各路党派
            ),
            'special_avatars' => Array(  // 特殊头像
                'boss' => 'boss.gif',
                'army' => 'army1.gif',
                'question' => 'question.gif',
            ),
        ),
        'story_config' => Array(
            'opening_story' => '欢迎来到2009年的ACBRA世界！这里保留了最初的游戏体验...',
            'ending_story' => '游戏结束！感谢体验2009年版本的经典玩法。',
        ),
    ),
    
    'ACDTS_2011' => Array(
        'name' => 'ACDTS 2011版',
        'description' => '体验2011年ACDTS版本的独特魅力，包含当时的特色系统和平衡调整。',
        'credits_cost' => 1,
        'admin_free' => true,
        'initial_setup' => Array(
            'hp_limit' => 400,
            'sp_limit' => 400,
            'base_exp' => 9,
            'money' => 20,
            'initial_items' => Array(),
            'initial_equipment' => Array(),
            'clbpara_flags' => Array(
                'ruleset_version' => 'ACDTS_2011',
                'ruleset_name' => 'ACDTS 2011版',
            ),
        ),
        'override_modules' => Array(),
        'title_system' => 0,
        'club_skills' => 0,
        'avatar_config' => Array(
            'use_ruleset_avatars' => true,
            'avatar_path' => './gamedata/ruleset/ACDTS_2011/img/',
            'male_avatars' => 21,    // 男性头像数量 (m_0.gif 到 m_20.gif)
            'female_avatars' => 21,  // 女性头像数量 (f_0.gif 到 f_20.gif)
            'npc_avatars' => Array(
                1 => 'n_1.gif',     // 董事长
                2 => 'n_2.gif',     // 全息幻象
                3 => 'n_3.gif',     // 各路党派
                4 => 'n_4.gif',     // 非作战人员
                5 => 'n_5.gif',     // 代码聚合体
                6 => 'n_6.gif',     // 黑幕
                11 => 'n_11.gif',   // 真职人
                12 => 'n_12.gif',
                13 => 'n_13.gif',
                14 => 'n_14.gif',
                21 => 'n_21.gif',   // 特殊NPC
                22 => 'n_22.gif',
                23 => 'n_23.gif',
                24 => 'n_24.gif',
                31 => 'n_31.gif',
                32 => 'n_32.gif',
                33 => 'n_33.gif',
                41 => 'n_41.gif',
                42 => 'n_42.gif',
                43 => 'n_43.gif',
                51 => 'n_51.gif',
                91 => 'n_91.gif',
                92 => 'n_92.gif',
                93 => 'n_93.gif',
                94 => 'n_94.gif',
            ),
            'special_avatars' => Array(
                'star' => 'STAR.gif',
                'question' => 'question.gif',
            ),
        ),
        'story_config' => Array(
            'opening_story' => '时光倒流至2011年，重新体验ACDTS的经典时光...',
            'ending_story' => '2011年的冒险结束了，希望你享受了这段怀旧之旅。',
        ),
    ),
    
    'ACDTS_298SP4' => Array(
        'name' => 'ACDTS 298SP4版',
        'description' => '最后的经典版本298SP4，包含了丰富的内容和完善的系统。',
        'credits_cost' => 5,
        'admin_free' => true,
        'initial_setup' => Array(
            'hp_limit' => 400,
            'sp_limit' => 400,
            'base_exp' => 9,
            'money' => 20,
            'initial_items' => Array(),
            'initial_equipment' => Array(),
            'clbpara_flags' => Array(
                'ruleset_version' => 'ACDTS_298SP4',
                'ruleset_name' => 'ACDTS 298SP4版',
            ),
        ),
        'override_modules' => Array(),
        'title_system' => 0,
        'club_skills' => 0,
        'avatar_config' => Array(
            'use_ruleset_avatars' => true,
            'avatar_path' => './gamedata/ruleset/ACDTS_298SP4/img/',
            'male_avatars' => 22,    // 男性头像数量 (m_0.gif 到 m_21.gif)
            'female_avatars' => 21,  // 女性头像数量 (f_0.gif 到 f_20.gif)
            'npc_avatars' => Array(
                1 => 'n_1.gif',     // 董事长
                2 => 'n_2.gif',     // 全息幻象
                3 => 'n_3.gif',     // 各路党派
                4 => 'n_4.gif',     // 非作战人员
                5 => 'n_5.gif',     // 代码聚合体
                6 => 'n_6.gif',     // 黑幕
                7 => 'n_7.gif',     // 首席执行官
                9 => 'n_9.gif',     // 活动盔甲
                11 => 'n_11.gif',   // 真职人
                12 => 'n_12.gif',
                13 => 'n_13.gif',
                14 => 'n_14.gif',
                21 => 'n_21.gif',   // 特殊NPC
                22 => 'n_22.gif',
                23 => 'n_23.gif',
                24 => 'n_24.gif',
                31 => 'n_31.gif',
                32 => 'n_32.gif',
                33 => 'n_33.gif',
                41 => 'n_41.gif',
                42 => 'n_42.gif',
                43 => 'n_43.gif',
                51 => 'n_51.gif',
                52 => 'n_52.gif',
                61 => 'n_61.gif',
                62 => 'n_62.gif',
                63 => 'n_63.gif',
                64 => 'n_64.gif',
                65 => 'n_65.gif',
                66 => 'n_66.gif',
                81 => 'n_81.gif',
                82 => 'n_82.gif',
                83 => 'n_83.gif',
                91 => 'n_91.gif',
                92 => 'n_92.gif',
                93 => 'n_93.gif',
                94 => 'n_94.gif',
                95 => 'n_95.gif',
                96 => 'n_96.gif',
                98 => 'n_98.gif',
            ),
            'special_avatars' => Array(
                'pb' => 'PB.gif',
                'p' => 'p.gif',
                'p2' => 'p2.gif',
                'question' => 'question.gif',
            ),
        ),
        'story_config' => Array(
            'opening_story' => '欢迎来到298SP4版本！这是经典时代的最后辉煌...',
            'ending_story' => '298SP4的传奇落下帷幕，感谢你的参与！',
        ),
    ),

    'ACDTS_298SP4_AR' => Array(
        'name' => 'ACDTS298 ALL RANDOM',
        'description' => '基于ACDTS_298SP4的全随机版本：全地图物品随机刷新，全NPC随机刷新，物品属性完全随机化。体验前所未有的混沌游戏！',
        'credits_cost' => 5,
        'admin_free' => true,
        'initial_setup' => Array(
            'hp_limit' => 400,
            'sp_limit' => 400,
            'base_exp' => 9,
            'money' => 20,
            'initial_items' => Array(),
            'initial_equipment' => Array(),
            'clbpara_flags' => Array(
                'ruleset_version' => 'ACDTS_298SP4_AR',
                'ruleset_name' => 'ACDTS298 ALL RANDOM',
                'all_random_mode' => true,  // 标记为全随机模式
            ),
        ),
        'override_modules' => Array(
            // 使用函数覆盖而不是文件覆盖
        ),
        'title_system' => 0,
        'club_skills' => 0,
        'avatar_config' => Array(
            'use_ruleset_avatars' => true,
            'avatar_path' => './gamedata/ruleset/ACDTS_298SP4_AR/img/',
            'male_avatars' => 22,    // 男性头像数量 (m_0.gif 到 m_21.gif)
            'female_avatars' => 21,  // 女性头像数量 (f_0.gif 到 f_20.gif)
            'npc_avatars' => Array(
                1 => 'n_1.gif',     // 董事长
                2 => 'n_2.gif',     // 全息幻象
                3 => 'n_3.gif',     // 各路党派
                4 => 'n_4.gif',     // 非作战人员
                5 => 'n_5.gif',     // 代码聚合体
                6 => 'n_6.gif',     // 黑幕
                7 => 'n_7.gif',     // 首席执行官
                9 => 'n_9.gif',     // 活动盔甲
                11 => 'n_11.gif',   // 真职人
                12 => 'n_12.gif',
                13 => 'n_13.gif',
                14 => 'n_14.gif',
                21 => 'n_21.gif',   // 特殊NPC
                22 => 'n_22.gif',
                23 => 'n_23.gif',
                24 => 'n_24.gif',
                31 => 'n_31.gif',
                32 => 'n_32.gif',
                33 => 'n_33.gif',
                41 => 'n_41.gif',
                42 => 'n_42.gif',
                43 => 'n_43.gif',
                51 => 'n_51.gif',
                52 => 'n_52.gif',
                61 => 'n_61.gif',
                62 => 'n_62.gif',
                63 => 'n_63.gif',
                64 => 'n_64.gif',
                65 => 'n_65.gif',
                66 => 'n_66.gif',
                81 => 'n_81.gif',
                82 => 'n_82.gif',
                83 => 'n_83.gif',
                91 => 'n_91.gif',
                92 => 'n_92.gif',
                93 => 'n_93.gif',
                94 => 'n_94.gif',
                95 => 'n_95.gif',
                96 => 'n_96.gif',
                98 => 'n_98.gif',
            ),
            'special_avatars' => Array(
                'pb' => 'PB.gif',
                'p' => 'p.gif',
                'p2' => 'p2.gif',
                'question' => 'question.gif',
            ),
        ),
        'story_config' => Array(
            'opening_story' => '欢迎来到ACDTS298 ALL RANDOM！在这个混沌的世界里，一切都是随机的——物品、NPC、属性，没有什么是确定的！准备好迎接前所未有的挑战吧！',
            'ending_story' => '在这个完全随机的世界中，你竟然能够生存到最后！你已经征服了混沌本身！',
        ),
    ),
);