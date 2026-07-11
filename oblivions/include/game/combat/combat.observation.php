<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// 查询指定 region 中所有已揭示（fog=1）的格子集合，返回 pls => true 的映射表
function obl_get_revealed_tile_set(int $pgroup): array {
    if ($pgroup <= 0) return array();
    global $db, $tablepre;
    $set = array();
    $result = $db->query("SELECT pls FROM {$tablepre}oblmapstates WHERE pgroup=" . $pgroup . " AND fog=1");
    while ($row = $db->fetch_array($result)) {
        $pls = (int)($row['pls'] ?? 0);
        if ($pls > 0) $set[$pls] = true;
    }
    return $set;
}

// 预加载已揭示格子集合到 battle_cache，避免多次 DB 查询
// 缓存键为 region 分组，一次请求内只查一次
function combat_observation_preload_revealed_tiles(array &$battle_cache, int $pgroup): array {
    if ($pgroup <= 0) return array();
    if (!isset($battle_cache['_observation_revealed_tiles']) || !is_array($battle_cache['_observation_revealed_tiles'])) {
        $battle_cache['_observation_revealed_tiles'] = array();
    }
    if (!array_key_exists($pgroup, $battle_cache['_observation_revealed_tiles'])) {
        $battle_cache['_observation_revealed_tiles'][$pgroup] = obl_get_revealed_tile_set($pgroup);
    }
    return $battle_cache['_observation_revealed_tiles'][$pgroup];
}

// 判断 target 是否与 actor 在同一战场、同一队列中且 active=1
// 用于战斗成员间无视遮挡互相可见
function combat_observation_same_battle_member(array $actor, array $target): bool {
    $qid = (int)($actor['bid'] ?? 0);
    $pid = (int)($target['pid'] ?? 0);
    if ($qid <= 0 || $pid <= 0 || (int)($target['bid'] ?? 0) !== $qid || (string)($target['action'] ?? '') !== 'battle') {
        return false;
    }
    $row = obl_fetch_queue_by_pid($pid);
    return is_array($row) && (int)($row['qid'] ?? 0) === $qid && (int)($row['active'] ?? 0) === 1;
}

// NPC 感知判定：target 在同一 region 且在 vision_range 范围内则视为被 NPC 发现
function combat_observation_npc_detects(array $actor, array $target): bool {
    if ((int)($actor['pgroup'] ?? 0) !== (int)($target['pgroup'] ?? 0)) return false;
    $distance = obl_get_distance(
        (int)($actor['pgroup'] ?? 0),
        (int)($actor['pls'] ?? 0),
        (int)($target['pls'] ?? 0)
    );
    $range = max(0, (int)($actor['oblpara']['vision_range'] ?? 3));
    return $distance >= 0 && $distance <= $range;
}

// 角色可见性判定：战斗成员始终可见；玩家只能看到已发现（discovered）的 NPC；NPC 通过 vision_range 感知
function combat_observation_character_detected(array $actor, array $target): bool {
    if (combat_observation_same_battle_member($actor, $target)) return true;
    if ((int)($actor['type'] ?? 0) === 0) {
        return (int)($target['type'] ?? 0) > 0 && !empty($target['discovered']);
    }
    return combat_observation_npc_detects($actor, $target);
}

// 观察判定统一入口：根据技能配置的 observation policy 判定目标是否可见
// policy 取值：'none'（不检查）、'revealed'（格子已揭示）、'detected'（角色可见）、'visible'（预留）
function combat_observation_decide(CombatContext $ctx, array $resolved_target): array {
    $policy = (string)($ctx->config['aim']['observation'] ?? 'none');
    $kind = (string)($resolved_target['kind'] ?? 'none');
    $allowed = false;
    $reason = null;

    if ($policy === 'none') {
        $allowed = true;
    } elseif ($policy === 'revealed' || $policy === 'controller_known') {
        if ($kind !== 'tile') {
            $reason = 'OBSERVATION_KIND_MISMATCH';
        } elseif ($policy === 'controller_known' && (int)($ctx->actor_data['type'] ?? 0) > 0) {
            // Room fog is the player's map knowledge, not an NPC perception constraint.
            $allowed = true;
        } else {
            $revealed = combat_observation_preload_revealed_tiles(
                $ctx->battle_cache,
                (int)($resolved_target['pgroup'] ?? 0)
            );
            $allowed = !empty($revealed[(int)($resolved_target['pls'] ?? 0)]);
            if (!$allowed) $reason = 'tile_unrevealed';
        }
    } elseif ($policy === 'detected') {
        if ($kind !== 'character') {
            $reason = 'OBSERVATION_KIND_MISMATCH';
        } else {
            $target = combat_target_capture_player($ctx, (int)($resolved_target['pid'] ?? 0));
            if (!is_array($target)) {
                $reason = 'TARGET_NOT_VISIBLE';
            } else {
                $allowed = combat_observation_character_detected($ctx->actor_data, $target);
                if (!$allowed) $reason = 'TARGET_NOT_VISIBLE';
            }
        }
    } elseif ($policy === 'visible') {
        // Reserved until current-visibility becomes a first-class actor-relative service.
        $reason = 'OBSERVATION_POLICY_UNAVAILABLE';
    } else {
        $reason = 'OBSERVATION_POLICY_UNKNOWN';
    }

    return array(
        'allowed' => $allowed,
        'policy' => $policy,
        'reason' => $allowed ? null : $reason,
    );
}
