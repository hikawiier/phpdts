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
// 边界标记字段（由 BattleLogCollector 自动填充）：
// - bl_turn_num:  Turn 计数（null=Phase 0/尚未开始，1+=第 N turn），由 battle_hook_turn_start 递增
// - bl_round_num: Round 计数（null=Phase 0 无队列，0+=第 N round，0-indexed），从 DB oblbattle_state.round_num 读
// - bl_segment_flag: phase 自动映射的段边界标记（round_start/turn_start/battle_end/ambush_battle_end/null）
//
// 相关文档：oblivions/docs/设计案2-新建前端导演系统.md
// ================================================================

/**
 * 战斗日志收集器（单次请求内累积，请求结束前持久化）
 *
 * 由 new combat 入口统一初始化。
 * battlelog.v2 事件通过 combat.log.php 写入；队列层仍可写少量共享队列事件。
 */
class BattleLogCollector {

    /** @var array 本请求累积的战斗日志条目 */
    private $entries = [];

    /** @var string 阶段标识 */
    private $phase = '';

    /** @var int|null Turn 计数（0=尚未开始，1+=第 N turn），由 battle_hook_turn_start 递增 */
    private $turnNum = 0;

    /** @var int|null Round 计数（null=Phase 0 无队列，0+=第 N round，0-indexed），从 DB 缓存 */
    private $roundNum = null;

    /** @var array phase 级默认 debug 映射 */
    private static array $phaseDebugDefault = [
        'initiative_roll'          => false,
        'queue_create'             => true,
        'queue_rebuild'            => true,
        'actor_state_check'        => true,
        'ap_recover'               => false,
        'flee'                     => false,
        'combatant_cleared'        => false,
        'battle_end'               => false,
        'ambush_battle_end'        => false,
    ];

    /** @var array phase → bl_segment_flag 自动映射 */
    private static array $phaseSegmentFlag = [
        'initiative_roll'    => 'round_start',
        'ap_recover'         => 'turn_start',
        'battle_end'         => 'battle_end',
        'ambush_battle_end'  => 'ambush_battle_end',
    ];

    /**
     * 注册新 phase（用于新战斗系统扩展，不修改既有 phase 配置）
     *
     * $phaseDebugDefault / $phaseSegmentFlag 是 private static，外部无法直接修改，
     * 此方法提供受控的扩展入口。新系统通过此方法注册 move/heal/escape/ap_change 等 phase。
     *
     * @param string      $phase         阶段名
     * @param bool        $debugDefault  debug 默认值
     * @param string|null $segmentFlag   段边界标记（null=非段边界，不写入 $phaseSegmentFlag）
     */
    public static function registerPhase(string $phase, bool $debugDefault, ?string $segmentFlag = null): void {
        self::$phaseDebugDefault[$phase] = $debugDefault;
        if ($segmentFlag !== null) {
            self::$phaseSegmentFlag[$phase] = $segmentFlag;
        }
    }

    /**
     * 设置当前阶段标识
     * @param string $phase
     */
    public function setPhase($phase) {
        $this->phase = (string)$phase;
    }

    /**
     * Turn 计数递增（由 battle_hook_turn_start 调用）
     */
    public function nextTurn(): void {
        $this->turnNum++;
    }

    /**
     * 设置 Round 计数（由 battle_queue_create_and_init / battle_queue_rebuild 调用）
     * @param int $num round_num（0-indexed）
     */
    public function setRoundNum(int $num): void {
        $this->roundNum = $num;
    }

    /**
     * 追加一条战斗日志
     *
     * @param array    $params 关联数组
     * @param bool|null $debug  true=调试/false=渲染/null=按 phase 自动推断
     */
    public function emit(array $params, ?bool $debug = null) {
        $debug = $debug ?? (self::$phaseDebugDefault[$this->phase] ?? true);
        $this->entries[] = [
            'phase'        => $this->phase,
            'action_id'    => $params['action_id']    ?? null,
            'actor_pid'    => $params['actor_pid']    ?? null,
            'actor_type'   => $params['actor_type']   ?? null,
            'actor_name'   => $params['actor_name']   ?? null,
            'actor_hp'     => $params['actor_hp']     ?? null,
            'actor_max_hp' => $params['actor_max_hp'] ?? null,
            'actor_ap'     => $params['actor_ap']     ?? null,
            'actor_max_ap' => $params['actor_max_ap'] ?? null,
            'target_pid'    => $params['target_pid']    ?? null,
            'target_type'   => $params['target_type']   ?? null,
            'target_name'   => $params['target_name']   ?? null,
            'target_hp'     => $params['target_hp']     ?? null,
            'target_max_hp' => $params['target_max_hp'] ?? null,
            'effect_value' => $params['effect_value'] ?? null,
            'effect_type'  => $params['effect_type']  ?? null,
            'success'      => $params['success']      ?? null,
            'qid'          => $params['qid']          ?? null,
            'schema'       => $params['schema']       ?? null,
            'event_type'   => $params['event_type']   ?? null,
            'channel'      => $params['channel']      ?? null,
            'event_uid'    => $params['event_uid']    ?? null,
            'action_uid'   => $params['action_uid']   ?? null,
            'effect_uid'   => $params['effect_uid']   ?? null,
            'payload'      => $params['payload']      ?? null,
            'rolls'        => $params['rolls']        ?? null,
            'ambush_pid'   => $params['ambush_pid']   ?? null,
            'combatants'   => $params['combatants']   ?? null,
            'reason'       => $params['reason']       ?? null,
            'distance'     => $params['distance']     ?? null,
            'from_pls'     => $params['from_pls']     ?? null,
            'to_pls'       => $params['to_pls']       ?? null,
            'range'        => $params['range']        ?? null,
            'range_mode'   => $params['range_mode']   ?? null,
            'range_max'    => $params['range_max']    ?? null,
            'range_bonus'  => $params['range_bonus']  ?? null,
            'winner_pid'   => $params['winner_pid']   ?? null,
            'cleared_pid'   => $params['cleared_pid']   ?? null,
            'cleared_name'  => $params['cleared_name']  ?? null,
            'ambusher_pid'  => $params['ambusher_pid']  ?? null,
            'ambusher_name' => $params['ambusher_name'] ?? null,
            'debug'        => $debug,
            'ts'           => time(),

            'bl_turn_num'     => $this->turnNum > 0 ? $this->turnNum : null,
            'bl_round_num'    => $this->roundNum,
            'bl_segment_flag' => self::$phaseSegmentFlag[$this->phase] ?? null,
        ];
    }

    /**
     * 获取本请求累积的战斗日志条目
     * @return array
     */
    public function getEntries() {
        return $this->entries;
    }

    public function checkpoint(): int {
        return count($this->entries);
    }

    public function rollbackTo(int $checkpoint): void {
        $checkpoint = max(0, min($checkpoint, count($this->entries)));
        if ($checkpoint < count($this->entries)) {
            $this->entries = array_slice($this->entries, 0, $checkpoint);
        }
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
    if (!$logger || !$logger->hasEntries()) return true;

    $new_entries = $logger->getEntries();
    $log_file = GAME_ROOT . './oblivions/cache/battles/obl_battle_log_' . (int)$groomid . '_' . (int)$pid . '.json';
    $obl_battle_log_dir = dirname($log_file);
    if (!is_dir($obl_battle_log_dir) && !@mkdir($obl_battle_log_dir, 0755, true) && !is_dir($obl_battle_log_dir)) {
        error_log('[battle_log] Failed to create log directory: ' . $obl_battle_log_dir);
        return false;
    }

    // 1. 读取现有文件
    $existing = [];
    if (file_exists($log_file)) {
        $raw = @file_get_contents($log_file);
        if ($raw === false) {
            error_log('[battle_log] Failed to read log file: ' . $log_file);
            return false;
        }
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
    $encoded = json_encode($merged, JSON_UNESCAPED_UNICODE);
    if ($encoded === false || @file_put_contents($log_file, $encoded, LOCK_EX) === false) {
        error_log('[battle_log] Failed to write log file: ' . $log_file);
        return false;
    }
    return true;
}

/**
 * 从文件读取未播放的战斗日志（played=0）
 *
 * 不清空文件。前端播放后通过 mark_battle_log_played.php 标记 played=1。
 * $includeDebug=false 时过滤掉 debug=true 的条目（渲染管线只需非调试数据）。
 *
 * @param int  $groomid      房间 ID
 * @param int  $pid          玩家 ID
 * @param bool $includeDebug 是否包含 debug 条目（默认 false）
 * @return array 未播放的战斗日志条目数组（played=0）
 */
function obl_battle_log_load($groomid, $pid, $includeDebug = false) {
    $log_file = GAME_ROOT . './oblivions/cache/battles/obl_battle_log_' . (int)$groomid . '_' . (int)$pid . '.json';
    if (!file_exists($log_file)) return [];

    $raw = file_get_contents($log_file);
    $entries = json_decode($raw, true);
    $entries = is_array($entries) ? $entries : [];

    // 只返回 played=0 的条目
    $unplayed = [];
    foreach ($entries as $e) {
        if (empty($e['played']) || (int)$e['played'] === 0) {
            if (!$includeDebug && !empty($e['debug'])) continue;
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
