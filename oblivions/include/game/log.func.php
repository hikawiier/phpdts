<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// Oblivions 结构化日志系统 / Oblivions structured log system
//
// 替代传统 $log HTML 字符串机制，建立前后端分层的新日志传递体系。
// 设计原则：后端只输出事件结构（发生了什么 + 参数），
//           前端完全控制视觉呈现（文案、样式、随机化）。
//
// 相关文档：oblivions/docs/结构化日志系统设计案.md
// ================================================================

/**
 * 日志收集器（单次请求内累积，请求结束前持久化）
 *
 * 在 command.php 入口初始化为全局 $obl_log：
 *   $obl_log = oblivions_is_active() ? new OblivionsLogger() : null;
 *
 * obl_* 函数内通过 global $obl_log 引用，调用 emit() 追加条目。
 */
class OblivionsLogger {

    /** @var array 本请求累积的日志条目 */
    private $entries = [];

    /**
     * 追加一条日志
     *
     * @param string $id     细粒度 ID（如 'move.success'），命名规则 {action}.{subevent}
     * @param string $action 粗粒度动作标记（move/explore/search/pickup/discard/system）
     * @param array  $params 模板参数，值限 string/number/boolean
     * @param string|null $html fallback HTML，正常为 null（仅用于前端模板无法覆盖的极端情况）
     */
    public function emit($id, $action, $params = [], $html = null) {
        $this->entries[] = [
            'id'     => $id,
            'action' => $action,
            'params' => $params ?: [],
            'html'   => $html,
            'ts'     => time(),
        ];
    }

    /**
     * 获取本请求累积的日志条目
     * @return array
     */
    public function getEntries() {
        return $this->entries;
    }

    /**
     * 本请求是否有日志
     * @return bool
     */
    public function hasEntries() {
        return !empty($this->entries);
    }
}

/**
 * 读取日志最大条目数配置（带静态缓存）
 * @return int
 */
function obl_log_get_max_entries() {
    static $max = null;
    if ($max === null) {
        $cfg = include GAME_ROOT . './oblivions/gamedata/obl_config.php';
        $max = (int)($cfg['log_max_entries'] ?? 200);
    }
    return $max;
}

/**
 * 持久化日志到文件（追加模式，带条目上限裁剪）
 *
 * 文件路径：vex/cache/obl_log_{groomid}_{pid}.json
 * 格式：JSON 数组，按时间正序（旧→新）
 *
 * 轮转逻辑：读取全量 → 追加新条目 → 超过上限则保留最新 N 条 → 写回。
 * array_slice($all, -$max) 实现"新增替换旧的"，无需额外逻辑。
 *
 * @param OblivionsLogger $logger
 * @param int $groomid 房间 ID
 * @param int $pid      玩家 ID
 */
function obl_log_persist($logger, $groomid, $pid) {
    if (!$logger || !$logger->hasEntries()) return;

    $new_entries = $logger->getEntries();
    $log_file = GAME_ROOT . './vex/cache/obl_log_' . (int)$groomid . '_' . (int)$pid . '.json';

    // 读取已有日志
    $existing = [];
    if (file_exists($log_file)) {
        $raw = file_get_contents($log_file);
        $existing = json_decode($raw, true);
        if (!is_array($existing)) $existing = [];
    }

    // 追加新条目
    $all = array_merge($existing, $new_entries);

    // 裁剪到上限（保留最新的 N 条）
    $max_entries = obl_log_get_max_entries();
    if (count($all) > $max_entries) {
        $all = array_slice($all, -$max_entries);
    }

    // 写入文件（加锁防并发）
    file_put_contents($log_file, json_encode($all, JSON_UNESCAPED_UNICODE), LOCK_EX);
}

/**
 * 从文件读取日志
 *
 * @param int $groomid 房间 ID
 * @param int $pid      玩家 ID
 * @return array 日志条目数组（按时间正序）
 */
function obl_log_load($groomid, $pid) {
    $log_file = GAME_ROOT . './vex/cache/obl_log_' . (int)$groomid . '_' . (int)$pid . '.json';
    if (!file_exists($log_file)) return [];

    $raw = file_get_contents($log_file);
    $entries = json_decode($raw, true);
    return is_array($entries) ? $entries : [];
}

/**
 * 清理所有 Oblivions 结构化日志文件
 *
 * 在 rs_game() 游戏重置时调用，删除所有 obl_log_*.json 文件，
 * 避免跨游戏残留。与 200 条上限自然轮转形成双重保障。
 */
function obl_log_clear_all() {
    $log_dir = GAME_ROOT . './vex/cache/';
    if (!is_dir($log_dir)) return;

    $files = glob($log_dir . 'obl_log_*.json');
    if (empty($files)) return;

    foreach ($files as $file) {
        @unlink($file);
    }
}
