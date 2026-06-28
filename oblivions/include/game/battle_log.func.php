<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// Oblivions 战斗日志系统 / Oblivions battle log system
//
// 战斗动作日志的收集、持久化、读取。
// 与 obl_log（结构化日志）分离：obl_log 只存战斗摘要（battle.start/battle.end），
// battle_log 存战斗细节（每步动作）。
//
// 存储模式：played 标记机制
// - 文件：oblivions/cache/battles/obl_battle_log_{groomid}_{pid}.json — 存所有 battle_log 条目
// - 每条带 log_id（文件内自增）、played（0=未播放，1=已播放）
// - 产生新 battle_log 时，追加到文件（分配 log_id，played=0）
// - 前端拉取 played=0 的条目播放，播完调 mark_battle_log_played.php 标记 played=1
// - 文件不被清空，保留历史记录
//
// 相关文档：oblivions/docs/战斗演出系统设计案.md
// ================================================================

/**
 * 战斗日志收集器（单次请求内累积，请求结束前持久化）
 *
 * 由 battle_entry_dispatch 统一初始化，传入 battle_main()。
 * battle_main 各阶段通过 setPhase() 标记阶段。
 */
class BattleLogCollector {

    /** @var array 本请求累积的战斗日志条目 */
    private $entries = [];

    /** @var string 阶段标识（prepare / verify / excute / queue_check / finish_check） */
    private $phase = '';

    /**
     * 设置当前阶段标识（battle_main 各阶段开始时调用）
     * @param string $phase prepare / verify / excute / queue_check / finish_check
     */
    public function setPhase($phase) {
        $this->phase = (string)$phase;
    }

    /**
     * 追加一条战斗日志
     *
     * @param array $params 关联数组，支持键：
     *   - actor_pid    (int)    行动者 PID
     *   - actor_type   (int)    行动者类型：0=玩家，>0=NPC
     *   - target_pid   (int)    目标 PID：0=无实体目标
     *   - target_type  (int)    目标类型：-1=无实体目标，0=玩家，>0=NPC
     *   - action_id    (string) 动作 ID（如 'unarmed_strike'）
     *   - effect_value (int)    效果值（伤害值、恢复量等）
     *   - extra        (array|null) 额外信息（HP 快照、事件元数据等）
     */
    public function emit(array $params) {
        $this->entries[] = [
            'actor_pid'    => (int)($params['actor_pid'] ?? 0),
            'actor_type'   => (int)($params['actor_type'] ?? -1),
            'target_pid'   => (int)($params['target_pid'] ?? 0),
            'target_type'  => (int)($params['target_type'] ?? -1),
            'action_id'    => (string)($params['action_id'] ?? ''),
            'effect_value' => (int)($params['effect_value'] ?? 0),
            'extra'        => isset($params['extra']) ? $params['extra'] : null,
            'ts'           => time(),
            'phase'        => $this->phase,
        ];
    }

    /**
     * 获取本请求累积的战斗日志条目
     * @return array
     */
    public function getEntries() {
        return $this->entries;
    }

    /**
     * 本请求是否有战斗日志
     * @return bool
     */
    public function hasEntries() {
        return !empty($this->entries);
    }
}

/**
 * 读取 battle_log 历史归档最大批次配置（带静态缓存）
 * @return int
 */
function obl_battle_log_get_old_max() {
    static $max = null;
    if ($max === null) {
        $cfg = include GAME_ROOT . './oblivions/gamedata/obl_config.php';
        $max = (int)($cfg['battle_log_old_max'] ?? 10);
    }
    return $max;
}

/**
 * 持久化战斗日志到文件（追加模式 + log_id 分配）
 *
 * 文件路径：
 * - oblivions/cache/battles/obl_battle_log_{groomid}_{pid}.json
 *
 * 追加逻辑：
 * 1. 读取现有文件，找最大 log_id
 * 2. 给新条目分配 log_id（从 max+1 开始）和 played=0
 * 3. 追加到现有条目后
 * 4. 写回文件（LOCK_EX 防并发）
 *
 * @param BattleLogCollector $logger
 * @param int $groomid 房间 ID
 * @param int $pid      玩家 ID
 */
function obl_battle_log_persist($logger, $groomid, $pid) {
    if (!$logger || !$logger->hasEntries()) return;

    $new_entries = $logger->getEntries();
    $log_file = GAME_ROOT . './oblivions/cache/battles/obl_battle_log_' . (int)$groomid . '_' . (int)$pid . '.json';
    $obl_battle_log_dir = dirname($log_file);
    if (!is_dir($obl_battle_log_dir)) @mkdir($obl_battle_log_dir, 0755, true);

    // 1. 读取现有文件
    $existing = [];
    if (file_exists($log_file)) {
        $raw = file_get_contents($log_file);
        $existing = json_decode($raw, true);
        if (!is_array($existing)) $existing = [];
    }

    // 2. 找最大 log_id
    $max_log_id = 0;
    foreach ($existing as $e) {
        if (!empty($e['log_id']) && (int)$e['log_id'] > $max_log_id) {
            $max_log_id = (int)$e['log_id'];
        }
    }

    // 3. 给新条目分配 log_id 和 played=0
    foreach ($new_entries as &$e) {
        $max_log_id++;
        $e['log_id'] = $max_log_id;
        $e['played'] = 0;
    }
    unset($e);

    // 4. 追加并写回
    $merged = array_merge($existing, $new_entries);
    file_put_contents($log_file, json_encode($merged, JSON_UNESCAPED_UNICODE), LOCK_EX);
}

/**
 * 从文件读取未播放的战斗日志（played=0）
 *
 * 不清空文件。前端播放后通过 mark_battle_log_played.php 标记 played=1。
 *
 * @param int $groomid 房间 ID
 * @param int $pid      玩家 ID
 * @return array 未播放的战斗日志条目数组（played=0）
 */
function obl_battle_log_load($groomid, $pid) {
    $log_file = GAME_ROOT . './oblivions/cache/battles/obl_battle_log_' . (int)$groomid . '_' . (int)$pid . '.json';
    if (!file_exists($log_file)) return [];

    $raw = file_get_contents($log_file);
    $entries = json_decode($raw, true);
    $entries = is_array($entries) ? $entries : [];

    // 只返回 played=0 的条目
    $unplayed = [];
    foreach ($entries as $e) {
        if (empty($e['played']) || (int)$e['played'] === 0) {
            $unplayed[] = $e;
        }
    }

    return $unplayed;
}

/**
 * 标记指定 log_id 的战斗日志为已播放（played=1）
 *
 * 供 mark_battle_log_played.php（零依赖接口）调用。
 *
 * @param int   $groomid 房间 ID
 * @param int   $pid      玩家 ID
 * @param array $log_ids  要标记的 log_id 数组
 * @return int 标记的条目数
 */
function obl_battle_log_mark_played($groomid, $pid, $log_ids) {
    $log_file = GAME_ROOT . './oblivions/cache/battles/obl_battle_log_' . (int)$groomid . '_' . (int)$pid . '.json';
    if (!file_exists($log_file)) return 0;

    $raw = file_get_contents($log_file);
    $entries = json_decode($raw, true);
    if (!is_array($entries)) return 0;

    $log_ids_map = array();
    foreach ($log_ids as $lid) {
        $log_ids_map[(int)$lid] = true;
    }

    $marked = 0;
    foreach ($entries as &$e) {
        if (!empty($e['log_id']) && isset($log_ids_map[(int)$e['log_id']])) {
            if (empty($e['played']) || (int)$e['played'] === 0) {
                $e['played'] = 1;
                $marked++;
            }
        }
    }
    unset($e);

    if ($marked > 0) {
        file_put_contents($log_file, json_encode($entries, JSON_UNESCAPED_UNICODE), LOCK_EX);
    }

    return $marked;
}

/**
 * 清理所有战斗日志文件
 *
 * 在 rs_game() 游戏重置时调用，删除所有 obl_battle_log*.json 文件。
 */
function obl_battle_log_clear_all() {
    $log_dir = GAME_ROOT . './oblivions/cache/battles/';
    if (!is_dir($log_dir)) return;

    $files = glob($log_dir . 'obl_battle_log*.json');
    if (empty($files)) return;

    foreach ($files as $file) {
        @unlink($file);
    }
}
