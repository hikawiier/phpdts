<?php

if(!defined('IN_GAME')) exit('Access Denied');

include_once GAME_ROOT.'./gamedata/cache/club22cfg.php';

/**
 * 获取种火的实时数据
 *
 * @param int $fireseed_id 种火ID
 * @return array|null 种火数据，如果种火不存在或已死亡则返回null
 */
function getFireseedRealTimeData($fireseed_id) {
    global $db, $tablepre;

    $result = $db->query("SELECT * FROM {$tablepre}players WHERE pid='$fireseed_id' AND type=92");
    if($db->num_rows($result) == 0) {
        return null; // 种火不存在
    }

    $fireseed_data = $db->fetch_array($result);

    // 检查种火是否死亡或被销毁
    if($fireseed_data['hp'] <= 0 || $fireseed_data['pls'] == 254) {
        return null; // 种火已死亡或被销毁
    }

    // 确保 clbpara 是数组格式
    if(!is_array($fireseed_data['clbpara'])) {
        $fireseed_data['clbpara'] = get_clbpara($fireseed_data['clbpara']);
    }

    return $fireseed_data;
}

/**
 * 检查种火是否存活且可用
 *
 * @param int $fireseed_id 种火ID
 * @return bool 种火是否存活且可用
 */
function isFireseedAlive($fireseed_id) {
    return getFireseedRealTimeData($fireseed_id) !== null;
}

/**
 * 将目标种火复活，并进行收纳种火
 *
 * @param array $npc 目标种火NPC数据
 * @return bool 是否成功收纳
 */
function FireseedRecruit($npc) {
    global $log, $now, $fireseed_recruit_rate, $db, $tablepre;

    if(!isset($data)) {
        global $pdata;
        $data = &$pdata;
    }
    extract($data, EXTR_REFS);

    // 检查是否为种火NPC
    if($npc['type'] != 92) {
        $log .= "<span class='red'>这不是一个种火！</span><br>";
        return false;
    }

    // 确保 NPC 的 clbpara 是数组格式
    if(!is_array($npc['clbpara'])) {
        $npc['clbpara'] = get_clbpara($npc['clbpara']);
    }

    // 检查是否已被其他玩家收纳
    if(!empty($npc['clbpara']['owner'])) {
        $log .= "<span class='yellow'>这个种火已经被其他枫火歌者收纳了！</span><br>";
        return false;
    }

    // 计算收纳成功率
    $recruit_dice = rand(1, 100);
    if($recruit_dice > $fireseed_recruit_rate) {
        $log .= "<span class='yellow'>你试图收纳这个种火，但失败了！</span><br>";
        return false;
    }

    // 初始化种火数据
    if(!isset($clbpara['fireseed'])) {
        $clbpara['fireseed'] = array();
    }

    // 生成种火ID
    $fireseed_id = $npc['pid'];

    // 记录种火数据 - 使用指针式存储，减少数据冗余
    $clbpara['fireseed'][$fireseed_id] = array(
        'level' => 1, // 初始等级
        'mode' => 0,  // 初始模式：跟随
        'horizon' => 0, // 初始位于通常视界而非灵子视界
        'items' => array(), // 探物模式下收集的物品
        'recruited_time' => $now
    );

    // 标记NPC已被收纳
    $npc['clbpara']['owner'] = $pid;
    $db->query("UPDATE {$tablepre}players SET hp='{$npc['mhp']}', sp='{$npc['msp']}' WHERE pid='{$npc['pid']}'");

    // 更新NPC的clbpara - 使用JSON格式存储
    $npc_clbpara = $npc['clbpara'];
    $encoded_npc_clbpara = json_encode($npc_clbpara, JSON_UNESCAPED_UNICODE);
    $db->query("UPDATE {$tablepre}players SET clbpara='$encoded_npc_clbpara' WHERE pid='{$npc['pid']}'");

    // 保存玩家的clbpara数据到数据库 - 这是关键的修复！
    $encoded_player_clbpara = json_encode($clbpara, JSON_UNESCAPED_UNICODE);
    $db->query("UPDATE {$tablepre}players SET clbpara='$encoded_player_clbpara' WHERE pid='$pid'");

    $log .= "<span class='lime'>你成功收纳了种火「{$npc['name']}」！</span><br>";
    addnews($now, 'fireseed_recruit', $name, $npc['name']);

    return true;
}

/**
 * 设置种火部署状态
 *
 * @param string $fireseed_id 种火ID
 * @param int $mode 部署模式（0:跟随, 1:探物, 2:索敌, 3:隐藏）
 * @param int $pls 部署位置（如果不是跟随模式）
 * @return bool 是否成功部署
 */
function FireseedDeploy($fireseed_id, $mode, $deploypls = 0) {
    global $log, $fireseed_deploy_modes, $plsinfo, $danger_areas, $db, $tablepre, $poseinfo;

    if(!isset($data)) {
        global $pdata;
        $data = &$pdata;
    }
    extract($data, EXTR_REFS);

    // 检查种火是否存在
    if(!isset($clbpara['fireseed'][$fireseed_id])) {
        $log .= "<span class='red'>指定的种火不存在！</span><br>";
        return false;
    }

    // 检查种火是否存活
    if(!isFireseedAlive($fireseed_id)) {
        $log .= "<span class='red'>指定的种火已死亡或被销毁，无法部署！</span><br>";
        return false;
    }

    // 检查模式是否有效
    if(!isset($fireseed_deploy_modes[$mode])) {
        $log .= "<span class='red'>无效的部署模式！</span><br>";
        return false;
    }

    // 确保使用传入的位置参数，而不是玩家当前位置
    $fspls = intval($deploypls);

    // 检查位置是否有效（不是禁区或隐藏地图）
    if(in_array($fspls, $danger_areas) || $fspls < 0 || $fspls >= 100) {
        $log .= "<span class='red'>无法部署到指定位置！</span><br>";
        return false;
    }

    // 将模式转换为姿态值
    $pose_map = array(
        0 => 1, // 跟随 -> 作战姿态
        1 => 3, // 探物 -> 探物姿态
        2 => 2, // 索敌 -> 强袭姿态
        3 => 4  // 隐藏 -> 偷袭姿态
    );
    $pose = isset($pose_map[$mode]) ? $pose_map[$mode] : 1;

    // 如果是跟随模式，记录一下但仍然使用传入的位置
    if($mode == 0) {
        $log .= "<span class='yellow'>DEBUG: 跟随模式，部署位置 $fspls</span><br>";
    }

    // 先更新NPC的位置和姿态
    $result = $db->query("SELECT * FROM {$tablepre}players WHERE pid='$fireseed_id'");
    if($db->num_rows($result) > 0) {
        $db->query("UPDATE {$tablepre}players SET pls='$fspls', pose='$pose' WHERE pid='$fireseed_id'");
        $log .= "<span class='yellow'>DEBUG: 更新NPC位置 $fspls 和姿态 {$poseinfo[$pose]}</span><br>";
    } else {
        $log .= "<span class='red'>警告：找不到对应的种火NPC！</span><br>";
    }

    // 再更新种火部署状态
    $clbpara['fireseed'][$fireseed_id]['mode'] = $mode;
    $clbpara['fireseed'][$fireseed_id]['pls'] = $fspls;
    $clbpara['fireseed'][$fireseed_id]['pose'] = $pose;

    // 将更新后的 clbpara 保存到数据库
    $encoded_clbpara = json_encode($clbpara, JSON_UNESCAPED_UNICODE);
    $db->query("UPDATE {$tablepre}players SET clbpara='$encoded_clbpara' WHERE pid='$pid'");

    $mode_name = $fireseed_deploy_modes[$mode];
    $location = $plsinfo[$fspls];
    $pose_name = $poseinfo[$pose];

    // 获取种火名称
    $fireseed_data = getFireseedRealTimeData($fireseed_id);
    $fireseed_name = $fireseed_data ? $fireseed_data['name'] : '未知种火';

    $log .= "<span class='lime'>你将种火「{$fireseed_name}」的状态设置为「{$mode_name}」（{$pose_name}）";
    $log .= "，并部署在了「{$location}」";
    $log .= "。</span><br>";

    return true;
}

/**
 * 玩家行动时触发探物逻辑
 *
 * @param int $pls 玩家当前地图ID（不再使用此参数限制种火位置）
 * @return void
 */
function FireseedSearch($pls) {
    global $log, $fireseed_search_rate, $db, $tablepre, $plsinfo;

    if(!isset($data)) {
        global $pdata;
        $data = &$pdata;
    }
    extract($data, EXTR_REFS);

    // 检查是否有种火
    if(empty($clbpara['fireseed'])) {
        return;
    }

    // 查找所有处于探物模式且存活的种火，不限制地图位置
    $search_fireseeds = array();
    foreach($clbpara['fireseed'] as $fs_id => $fs_data) {
        // 检查种火是否存活
        if(!isFireseedAlive($fs_id)) {
            continue; // 跳过死亡或被销毁的种火
        }

        // 获取种火实时数据
        $realtime_data = getFireseedRealTimeData($fs_id);
        if(!$realtime_data) {
            continue;
        }

        // 检查是否为探物模式
        $is_search_mode = false;

        // 优先检查 pose 字段（新数据）
        if(isset($fs_data['pose'])) {
            $is_search_mode = ($fs_data['pose'] == 3); // 探物姿态
        } else {
            // 兼容旧数据，使用 mode 字段
            $is_search_mode = ($fs_data['mode'] == 1); // 探物模式
        }

        if($is_search_mode) {
            $search_fireseeds[$fs_id] = array_merge($fs_data, array('pls' => $realtime_data['pls']));
        }
    }

    if(empty($search_fireseeds)) {
        return;
    }

    // 按位置分组处理种火
    $fireseeds_by_location = array();
    foreach($search_fireseeds as $fs_id => $fs_data) {
        $location = $fs_data['pls'];
        if(!isset($fireseeds_by_location[$location])) {
            $fireseeds_by_location[$location] = array();
        }
        $fireseeds_by_location[$location][$fs_id] = $fs_data;
    }

    // 对每个位置分别处理
    foreach($fireseeds_by_location as $location => $location_fireseeds) {
        // 获取该位置的物品
        $result = $db->query("SELECT * FROM {$tablepre}mapitem WHERE pls='$location' LIMIT 1");
        if(!$db->num_rows($result)) {
            continue; // 该位置没有物品，继续检查下一个位置
        }

        // 计算探物成功率（每个种火增加一次成功机会）
        $success = false;
        foreach($location_fireseeds as $fs_id => $fs_data) {
            $search_dice = rand(1, 100);
            // 种火等级会提高探物成功率
            $adjusted_rate = $fireseed_search_rate + ($fs_data['level'] * 2);

            if($search_dice <= $adjusted_rate) {
                $success = true;
                $finder_id = $fs_id;
                break;
            }
        }

        if(!$success) {
            continue; // 该位置的种火探物失败，继续检查下一个位置
        }

        // 获取物品数据
        $item_data = $db->fetch_array($result);

        // 将物品添加到种火的物品池中
        $clbpara['fireseed'][$finder_id]['items'][] = array(
            'itm' => $item_data['itm'],
            'itmk' => $item_data['itmk'],
            'itme' => $item_data['itme'],
            'itms' => $item_data['itms'],
            'itmsk' => $item_data['itmsk']
        );

        // 从地图上移除物品
        $db->query("DELETE FROM {$tablepre}mapitem WHERE iid='{$item_data['iid']}'");

        // 获取种火名称
        $finder_data = getFireseedRealTimeData($finder_id);
        $finder_name = $finder_data ? $finder_data['name'] : '未知种火';

        $log .= "<span class='lime'>你的种火「{$finder_name}」在「{$plsinfo[$location]}」发现了物品「{$item_data['itm']}」！</span><br>";
    }

    // 如果有任何种火成功探物，更新玩家的 clbpara
    if(isset($finder_id)) {
        // 将更新后的 clbpara 保存到数据库
        $encoded_clbpara = json_encode($clbpara, JSON_UNESCAPED_UNICODE);
        $db->query("UPDATE {$tablepre}players SET clbpara='$encoded_clbpara' WHERE pid='$pid'");
    }
}

/**
 * 玩家行动时触发索敌逻辑
 *
 * @param int $pls 玩家当前地图ID（不再使用此参数限制种火位置）
 * @return void
 */
function FireseedDrainNPC($pls) {
    global $log, $fireseed_drain_rate, $db, $tablepre, $plsinfo;

    if(!isset($data)) {
        global $pdata;
        $data = &$pdata;
    }
    extract($data, EXTR_REFS);

    // 检查是否有种火
    if(empty($clbpara['fireseed'])) {
        return;
    }

    // 查找所有处于索敌模式且存活的种火，不限制地图位置
    $drain_fireseeds = array();
    foreach($clbpara['fireseed'] as $fs_id => $fs_data) {
        // 检查种火是否存活
        if(!isFireseedAlive($fs_id)) {
            continue; // 跳过死亡或被销毁的种火
        }

        // 获取种火实时数据
        $realtime_data = getFireseedRealTimeData($fs_id);
        if(!$realtime_data) {
            continue;
        }

        // 检查是否为索敌模式
        $is_drain_mode = false;

        // 优先检查 pose 字段（新数据）
        if(isset($fs_data['pose'])) {
            $is_drain_mode = ($fs_data['pose'] == 2); // 强袭姿态
        } else {
            // 兼容旧数据，使用 mode 字段
            $is_drain_mode = ($fs_data['mode'] == 2); // 索敌模式
        }

        if($is_drain_mode) {
            $drain_fireseeds[$fs_id] = array_merge($fs_data, array(
                'pls' => $realtime_data['pls'],
                'att' => $realtime_data['att']
            ));
        }
    }

    if(empty($drain_fireseeds)) {
        return;
    }

    // 按位置分组处理种火
    $fireseeds_by_location = array();
    foreach($drain_fireseeds as $fs_id => $fs_data) {
        $location = $fs_data['pls'];
        if(!isset($fireseeds_by_location[$location])) {
            $fireseeds_by_location[$location] = array();
        }
        $fireseeds_by_location[$location][$fs_id] = $fs_data;
    }

    // 对每个位置分别处理
    foreach($fireseeds_by_location as $location => $location_fireseeds) {
        // 获取该位置的NPC
        $result = $db->query("SELECT * FROM {$tablepre}players WHERE type>0 AND hp>1 AND pls='$location'");
        if(!$db->num_rows($result)) {
            continue; // 该位置没有NPC，继续检查下一个位置
        }

        while($npc = $db->fetch_array($result)) {
            // 跳过防御力超过10000，或持有fireseed3和fireseed4技能的NPC
            if($npc['def'] > 10000 ||
               (isset($npc['clbpara']['skill']) &&
                (in_array('fireseed3', $npc['clbpara']['skill']) ||
                 in_array('fireseed4', $npc['clbpara']['skill'])))) {
                continue;
            }

            // 跳过同玩家的其他种火NPC
            if($npc['type'] == 92) {
                // 确保 NPC 的 clbpara 是数组格式
                if(!is_array($npc['clbpara'])) {
                    $npc['clbpara'] = get_clbpara($npc['clbpara']);
                }
                // 检查是否为同玩家的种火
                if(!empty($npc['clbpara']['owner']) && $npc['clbpara']['owner'] == $pid) {
                    continue; // 跳过对同玩家种火的攻击
                }
            }

            // 计算削减成功率（每个种火增加一次成功机会）
            $success = false;
            foreach($location_fireseeds as $fs_id => $fs_data) {
                $drain_dice = rand(1, 100);
                // 种火等级会提高削减成功率
                $adjusted_rate = $fireseed_drain_rate + ($fs_data['level'] * 2);

                if($drain_dice <= $adjusted_rate) {
                    $success = true;
                    $drainer_id = $fs_id;
                    break;
                }
            }

            if(!$success) {
                continue;
            }

            // 计算削减量（基于种火等级和攻击力）
            $drain_amount = ceil($location_fireseeds[$drainer_id]['att'] * ($location_fireseeds[$drainer_id]['level'] * 0.5));
            $new_hp = max(1, $npc['hp'] - $drain_amount);

            // 更新NPC生命值
            $db->query("UPDATE {$tablepre}players SET hp='$new_hp' WHERE pid='{$npc['pid']}'");

            // 获取种火名称
            $drainer_data = getFireseedRealTimeData($drainer_id);
            $drainer_name = $drainer_data ? $drainer_data['name'] : '未知种火';

            $log .= "<span class='lime'>你的种火「{$drainer_name}」在「{$plsinfo[$location]}」削弱了「{$npc['name']}」，造成了{$drain_amount}点伤害！</span><br>";
        }
    }
}

/**
 * 消耗焰火物品，更新种火的强化倍率
 *
 * @param string $fireseed_id 种火ID
 * @param int $item_index 物品在物品栏中的位置
 * @return bool 是否成功强化
 */
function FireseedEnhance($fireseed_id, $item_index) {
    global $log, $fireseed_enhance_multipliers, $db, $tablepre;

    if(!isset($data)) {
        global $pdata;
        $data = &$pdata;
    }
    extract($data, EXTR_REFS);

    // 检查种火是否存在
    if(!isset($clbpara['fireseed'][$fireseed_id])) {
        $log .= "<span class='red'>指定的种火不存在！</span><br>";
        return false;
    }

    // 检查种火是否存活
    if(!isFireseedAlive($fireseed_id)) {
        $log .= "<span class='red'>指定的种火已死亡或被销毁，无法强化！</span><br>";
        return false;
    }

    // 检查物品是否存在
    $item_var = 'itm' . $item_index;
    $itemk_var = 'itmk' . $item_index;
    $iteme_var = 'itme' . $item_index;
    $items_var = 'itms' . $item_index;
    $itemsk_var = 'itmsk' . $item_index;

    if(empty($$item_var)) {
        $log .= "<span class='red'>指定的物品不存在！</span><br>";
        return false;
    }

    // 检查物品是否为焰火类物品
    $item_name = $$item_var;
    if(!isset($fireseed_enhance_multipliers[$item_name])) {
        $log .= "<span class='red'>这不是可用于强化的焰火物品！</span><br>";
        return false;
    }

    // 获取强化倍率
    $multiplier = $fireseed_enhance_multipliers[$item_name];

    // 获取种火当前数据
    $fireseed_data = getFireseedRealTimeData($fireseed_id);
    if(!$fireseed_data) {
        $log .= "<span class='red'>无法获取种火数据！</span><br>";
        return false;
    }

    // 更新种火属性
    $old_level = $clbpara['fireseed'][$fireseed_id]['level'];
    $clbpara['fireseed'][$fireseed_id]['level'] = $multiplier;

    // 计算新的属性值
    $new_hp = ceil($fireseed_data['hp'] * $multiplier / $old_level);
    $new_mhp = ceil($fireseed_data['mhp'] * $multiplier / $old_level);
    $new_sp = ceil($fireseed_data['sp'] * $multiplier / $old_level);
    $new_msp = ceil($fireseed_data['msp'] * $multiplier / $old_level);
    $new_att = ceil($fireseed_data['att'] * $multiplier / $old_level);
    $new_def = ceil($fireseed_data['def'] * $multiplier / $old_level);
    $new_wepe = !empty($fireseed_data['wepe']) ? ceil($fireseed_data['wepe'] * $multiplier / $old_level) : $fireseed_data['wepe'];
    $new_arbe = !empty($fireseed_data['arbe']) ? ceil($fireseed_data['arbe'] * $multiplier / $old_level) : $fireseed_data['arbe'];

    // 更新数据库中的种火属性
    $db->query("UPDATE {$tablepre}players SET
        hp='$new_hp', mhp='$new_mhp', sp='$new_sp', msp='$new_msp',
        att='$new_att', def='$new_def', wepe='$new_wepe', arbe='$new_arbe'
        WHERE pid='$fireseed_id'");

    // 消耗物品
    $$items_var--;
    if($$items_var <= 0) {
        $$item_var = $$itemk_var = $$itemsk_var = '';
        $$iteme_var = $$items_var = 0;
    }

    $log .= "<span class='lime'>你使用「{$item_name}」强化了种火「{$fireseed_data['name']}」！</span><br>";
    $log .= "<span class='yellow'>种火的强化倍率提升到了{$multiplier}倍！</span><br>";

    // 保存玩家的clbpara数据到数据库
    $encoded_clbpara = json_encode($clbpara, JSON_UNESCAPED_UNICODE);
    $db->query("UPDATE {$tablepre}players SET clbpara='$encoded_clbpara' WHERE pid='$pid'");

    return true;
}

/**
 * 玩家移动时，将所有处于跟随状态的种火一并移动到目标位置
 *
 * @param int $target_pls 目标位置ID
 * @return void
 */
function FireseedFollow($target_pls) {
    global $log, $db, $tablepre, $plsinfo;

    if(!isset($data)) {
        global $pdata;
        $data = &$pdata;
    }
    extract($data, EXTR_REFS);

    // 检查是否有种火
    if(empty($clbpara['fireseed'])) {
        return;
    }

    // 查找所有处于跟随模式且存活的种火
    $follow_fireseeds = array();
    foreach($clbpara['fireseed'] as $fs_id => $fs_data) {
        // 检查种火是否存活
        if(!isFireseedAlive($fs_id)) {
            continue; // 跳过死亡或被销毁的种火
        }

        // 获取种火实时数据
        $realtime_data = getFireseedRealTimeData($fs_id);
        if(!$realtime_data) {
            continue;
        }

        // 检查是否为跟随模式
        $is_follow_mode = false;

        // 优先检查 pose 字段（新数据）
        if(isset($fs_data['pose'])) {
            $is_follow_mode = ($fs_data['pose'] == 1); // 作战姿态
        } else {
            // 兼容旧数据，使用 mode 字段
            $is_follow_mode = ($fs_data['mode'] == 0); // 跟随模式
        }

        if($is_follow_mode) {
            $follow_fireseeds[$fs_id] = array_merge($fs_data, array('pls' => $realtime_data['pls']));
        }
    }

    if(empty($follow_fireseeds)) {
        return;
    }

    // 移动所有跟随种火到目标位置
    $moved_count = 0;
    foreach($follow_fireseeds as $fs_id => $fs_data) {
        // 如果种火已经在目标位置，则跳过
        if($fs_data['pls'] == $target_pls) {
            continue;
        }

        // 更新数据库中的种火位置
        $db->query("UPDATE {$tablepre}players SET pls='$target_pls' WHERE pid='$fs_id'");

        // 更新clbpara中的种火位置
        $clbpara['fireseed'][$fs_id]['pls'] = $target_pls;

        $moved_count++;
    }

    // 如果有种火被移动，则更新clbpara并显示提示
    if($moved_count > 0) {
        // 将更新后的 clbpara 保存到数据库
        $encoded_clbpara = json_encode($clbpara, JSON_UNESCAPED_UNICODE);
        $db->query("UPDATE {$tablepre}players SET clbpara='$encoded_clbpara' WHERE pid='$pid'");

        // 显示提示
        $log .= "<span class='lime'>{$moved_count}个跟随状态的种火随你一起移动到了「{$plsinfo[$target_pls]}」。</span><br>";
    }
}

/**
 * 根据所有跟随种火的数量与强化层数，为玩家加成攻击防御
 * 注意：只有与玩家在同一位置的跟随种火才会提供加成
 *
 * @param int $base_att 基础攻击力（可选，如果不提供则使用玩家基础属性）
 * @param int $base_def 基础防御力（可选，如果不提供则使用玩家基础属性）
 * @return array 返回加成的攻击和防御值
 */
function FireseedBuffBonus($base_att = null, $base_def = null) {
    // 确保配置文件被加载，并直接使用配置变量
    include_once GAME_ROOT.'./gamedata/cache/club22cfg.php';
    // 如果全局变量不存在，使用默认值
    if(!isset($fireseed_follow_bonus_rate)) {
        $fireseed_follow_bonus_rate = 1; // 默认1%
    }

    if(!isset($data)) {
        global $pdata;
        $data = &$pdata;
    }
    extract($data, EXTR_REFS);

    $att_bonus = 0;
    $def_bonus = 0;

    // 检查是否有种火
    if(empty($clbpara['fireseed'])) {
        return array('att' => $att_bonus, 'def' => $def_bonus);
    }

    // 如果没有提供基础攻击力和防御力，使用玩家的基础属性
    if($base_att === null) {
        $base_att = $att;
    }
    if($base_def === null) {
        $base_def = $def;
    }

    // 计算跟随模式的种火加成
    // 注意：这里仍然只考虑与玩家在同一位置的种火，因为这是战斗加成

    // 调试代码已注释 - 问题已修复
    /*
    global $log;
    $debug_info = "【种火调试】玩家位置: {$pls}, 基础攻击: {$base_att}, 基础防御: {$base_def}, 种火数量: " . count($clbpara['fireseed']) . ", 加成系数: {$fireseed_follow_bonus_rate}<br>";
    */

    foreach($clbpara['fireseed'] as $fs_id => $fs_data) {
        // 检查种火是否存活
        if(!isFireseedAlive($fs_id)) {
            continue; // 跳过死亡或被销毁的种火
        }

        // 获取种火实时数据
        $realtime_data = getFireseedRealTimeData($fs_id);
        if(!$realtime_data) {
            continue;
        }

        /*
        $debug_info .= "【种火调试】种火ID: {$fs_id}, 位置: {$realtime_data['pls']}, 模式: " . (isset($fs_data['pose']) ? $fs_data['pose'] : $fs_data['mode']) . ", 等级: {$fs_data['level']}<br>";
        */

        // 检查是否为跟随模式且在同一位置
        $is_follow_mode = false;

        // 优先检查 pose 字段（新数据）
        if(isset($fs_data['pose'])) {
            $is_follow_mode = ($fs_data['pose'] == 1 && $realtime_data['pls'] == $pls); // 作战姿态且同位置
        } else {
            // 兼容旧数据，使用 mode 字段
            $is_follow_mode = ($fs_data['mode'] == 0 && $realtime_data['pls'] == $pls); // 跟随模式且同位置
        }

        if($is_follow_mode) {
            // 加成 = 数量(1) × 强化层数 × 1%
            $bonus_percent = 1 * $fs_data['level'] * $fireseed_follow_bonus_rate;
            $att_bonus += ceil($base_att * $bonus_percent / 100);
            $def_bonus += ceil($base_def * $bonus_percent / 100);
            /*
            $debug_info .= "【种火调试】种火{$fs_id}符合条件，加成百分比: {$bonus_percent}%, 加成系数: {$fireseed_follow_bonus_rate}, 加成等级: {$fs_data['level']}<br>";
            */
        }
    }

    /*
    $debug_info .= "【种火调试】最终攻击加成: {$att_bonus}, 防御加成: {$def_bonus}<br>";
    if(!empty($log)) $log .= $debug_info;
    */

    return array('att' => $att_bonus, 'def' => $def_bonus);
}

/**
 * 检查玩家是否有利于种火的物品
 *
 * @return bool
 */
function hasFireseedEquipment() { # 备用
    if(!isset($data)) {
        global $pdata;
        $data = &$pdata;
    }
    extract($data, EXTR_REFS);

    //return (strpos($wep, '钓竿') !== false || strpos($wep, '钓鱼竿') !== false);
    return false;
}

?>