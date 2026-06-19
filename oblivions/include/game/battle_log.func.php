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
// 存储模式：待播放队列（追加合并）
// - 待播放文件：vex/cache/obl_battle_log_{groomid}_{pid}.json — 存未播放的 battle_log
// - 产生新 battle_log 时，追加到待播放文件（不覆盖旧条目）
// - 前端拉取后清空待播放文件（读后即清）
//
// 相关文档：oblivions/docs/战斗系统设计案.md
// ================================================================

/**
 * 战斗日志收集器（单次请求内累积，请求结束前持久化）
 *
 * 在 common.inc.php 入口初始化为全局 $obl_battle_log：
 *   $obl_battle_log = oblivions_is_active() ? new BattleLogCollector() : null;
 *
 * obl_battle_* 函数内通过 global $obl_battle_log 引用，调用 emit() 追加条目。
 */
class BattleLogCollector {

    /** @var array 本请求累积的战斗日志条目 */
    private $entries = [];

    /**
     * 追加一条战斗日志
     *
     * @param int         $turn         先攻轮序号（从 1 开始）
     * @param string      $actor        行动方标识（'player' 或 'enemy_{pid}'）
     * @param string      $action_id    动作 ID（如 'unarmed_strike'）
     * @param string      $action_name  动作名称（如 '空手攻击'）
     * @param string      $target       目标标识（'player' 或 'enemy_{pid}'）
     * @param int|float   $effect_value 效果值（伤害值等）
     * @param array|null  $extra        额外信息（如 escape 成功/失败）
     * @param array|null  $position     位置信息（阶段一未使用）
     */
    public function emit($turn, $actor, $action_id, $action_name, $target, $effect_value = 0, $extra = null, $position = null) {
        $this->entries[] = [
            'id'           => 'battle.action',
            'turn'         => (int)$turn,
            'actor'        => $actor,
            'action_id'    => $action_id,
            'action_name'  => $action_name,
            'target'       => $target,
            'effect_value' => $effect_value,
            'extra'        => $extra,
            'position'     => $position,
            'ts'           => time(),
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
 * 持久化战斗日志到文件（追加模式）
 *
 * 文件路径：
 * - 待播放：vex/cache/obl_battle_log_{groomid}_{pid}.json
 *
 * 追加逻辑：
 * 1. 读取待播放文件现有内容（未播放的旧条目）
 * 2. 追加新条目
 * 3. 写回待播放文件
 *
 * 注意：不再使用覆盖模式。突袭和玩家执行可能在不同请求中产生 battle_log，
 * 追加模式确保所有未播放的条目都保留，前端拉取后由 obl_battle_log_load 清空。
 *
 * @param BattleLogCollector $logger
 * @param int $groomid 房间 ID
 * @param int $pid      玩家 ID
 */
function obl_battle_log_persist($logger, $groomid, $pid) {
    if (!$logger || !$logger->hasEntries()) return;

    $new_entries = $logger->getEntries();
    $log_file = GAME_ROOT . './vex/cache/obl_battle_log_' . (int)$groomid . '_' . (int)$pid . '.json';

    // 1. 读取待播放文件现有内容（未播放的旧条目）
    $existing = [];
    if (file_exists($log_file)) {
        $raw = file_get_contents($log_file);
        $existing = json_decode($raw, true);
        if (!is_array($existing)) $existing = [];
    }

    // 2. 追加新条目
    $merged = array_merge($existing, $new_entries);

    // 3. 写回待播放文件
    file_put_contents($log_file, json_encode($merged, JSON_UNESCAPED_UNICODE), LOCK_EX);
}

/**
 * 从文件读取待播放的战斗日志，读取后清空文件
 *
 * 前端拉取后视为已播放，清空待播放文件。
 * 后续新产生的 battle_log 会追加到空文件。
 *
 * @param int $groomid 房间 ID
 * @param int $pid      玩家 ID
 * @return array 战斗日志条目数组
 */
function obl_battle_log_load($groomid, $pid) {
    $log_file = GAME_ROOT . './vex/cache/obl_battle_log_' . (int)$groomid . '_' . (int)$pid . '.json';
    if (!file_exists($log_file)) return [];

    $raw = file_get_contents($log_file);
    $entries = json_decode($raw, true);
    $entries = is_array($entries) ? $entries : [];

    // 清空待播放文件（前端拉取后视为已播放）
    if (!empty($entries)) {
        file_put_contents($log_file, json_encode([], JSON_UNESCAPED_UNICODE), LOCK_EX);
    }

    return $entries;
}

/**
 * 清理所有战斗日志文件
 *
 * 在 rs_game() 游戏重置时调用，删除所有 obl_battle_log*.json 文件。
 */
function obl_battle_log_clear_all() {
    $log_dir = GAME_ROOT . './vex/cache/';
    if (!is_dir($log_dir)) return;

    $files = glob($log_dir . 'obl_battle_log*.json');
    if (empty($files)) return;

    foreach ($files as $file) {
        @unlink($file);
    }
}
