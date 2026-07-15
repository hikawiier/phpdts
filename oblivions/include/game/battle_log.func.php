<?php
/**
 * @module C 核心运行时
 * @framework C-4 事件批量投递（Presentation 系统）
 */
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

/**
 * 请求级事件缓冲区。领域坐标必须由事件构造器显式提供；本对象只保存顺序。
 */
class BattleLogCollector {
    private $entries = array();
    private $phase = '';

    private static array $phaseDebugDefault = array(
        'queue_create' => true,
        'queue_rebuild' => true,
        'queue_check' => true,
        'actor_state_check' => true,
        'combatant_cleared' => false,
        'battle_end' => false,
        'battlelog_v3' => false,
    );

    public static function registerPhase(string $phase, bool $debugDefault, ?string $unused = null): void {
        self::$phaseDebugDefault[$phase] = $debugDefault;
    }

    public function setPhase($phase) {
        $this->phase = (string)$phase;
    }

    public function emit(array $params, ?bool $debug = null) {
        $debug = $debug ?? (self::$phaseDebugDefault[$this->phase] ?? true);
        $entry = array(
            'phase' => $this->phase,
            'debug' => $debug,
            'ts' => time(),
        );
        foreach (array(
            'schema', 'event_type', 'channel', 'event_uid', 'action_uid', 'effect_uid',
            'payload', 'qid', 'round_num', 'turn_seq', 'turn_key', 'actor_pid',
            'actor_type', 'actor_name', 'actor_hp', 'actor_max_hp', 'actor_ap',
            'actor_max_ap', 'target_pid', 'target_type', 'target_name', 'target_hp',
            'target_max_hp', 'action_id', 'effect_type', 'effect_value', 'success',
            'reason', 'winner_pid', 'cleared_pid', 'cleared_name', 'rolls',
            'ambush_pid', 'combatants', 'distance', 'from_pls', 'to_pls', 'range',
            'range_mode', 'range_max', 'range_bonus'
        ) as $field) {
            $entry[$field] = $params[$field] ?? null;
        }
        $this->entries[] = $entry;
    }

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

    public function hasEntries() {
        return !empty($this->entries);
    }
}
