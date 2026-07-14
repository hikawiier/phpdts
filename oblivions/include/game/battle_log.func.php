<?php
/**
 * @module C 核心运行时
 * @framework C-4 事件批量投递（Presentation 系统）
 */
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// Oblivions 战斗演出事件收集器
//
// 本对象只在单次 command/heartbeat 请求内积累 battlelog.v2 事件。
// COMMIT 前由 Runtime 冻结为 PresentationBatch，COMMIT 后随响应直接投递；
// 不再维护 mutable JSON、log_id/played 或跨页面补播队列。
//
// 边界标记字段（由 BattleLogCollector 自动填充）：
// - bl_turn_num:  Turn 计数（null=Phase 0/尚未开始，1+=第 N turn），由 battle_hook_turn_start 递增
// - bl_round_num: Round 计数（null=Phase 0 无队列，0+=第 N round，0-indexed），从 DB oblbattle_state.round_num 读
// - bl_segment_flag: phase 自动映射的段边界标记（round_start/turn_start/battle_end/ambush_battle_end/null）
//
// 相关文档：oblivions/docs/设计案2-新建前端导演系统.md
// ================================================================

/**
 * 战斗演出事件收集器（单次请求内累积）
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
