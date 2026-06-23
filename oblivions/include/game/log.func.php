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

    /** debug 日志 ID 清单（这些 ID 的日志标记为 debug，前端默认不渲染） */
    const DEBUG_IDS = [
        'enemy.move',      // 敌人移动位置（地图渲染已体现，日志冗余）
        'battle.invalid',  // 防呆机制清除脏状态（系统内部清理）
    ];

    /** @var array 本请求累积的日志条目 */
    private $entries = [];

    /**
     * 追加一条日志
     *
     * @param string $id           细粒度 ID（如 'move.success'），命名规则 {logcategory}.{subevent}
     * @param string $logcategory  粗粒度日志类别（move/explore/search/pickup/discard/system/enemy/battle）
     * @param array  $params       模板参数，值限 string/number/boolean
     * @param string|null $html    fallback HTML，正常为 null（仅用于前端模板无法覆盖的极端情况）
     */
    public function emit($id, $logcategory, $params = [], $html = null) {
        $this->entries[] = [
            'id'           => $id,
            'logcategory'  => $logcategory,
            'params'       => $params ?: [],
            'html'         => $html,
            'debug'        => in_array($id, self::DEBUG_IDS),
            'ts'           => time(),
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
 * 读取正式日志最大条目数配置（带静态缓存）
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
 * 读取 debug 日志最大条目数配置（带静态缓存）
 * @return int
 */
function obl_log_get_max_debug_entries() {
    static $max = null;
    if ($max === null) {
        $cfg = include GAME_ROOT . './oblivions/gamedata/obl_config.php';
        $max = (int)($cfg['log_max_debug_entries'] ?? 50);
    }
    return $max;
}

/**
 * 持久化日志到文件（追加模式，正式/debug 分计数裁剪）
 *
 * 文件路径：oblivions/cache/logs/obl_log_{groomid}_{pid}.json
 * 格式：JSON 数组，按时间正序（旧→新）
 *
 * 轮转逻辑：
 * 1. 读取已有日志 → 追加新条目（保持时间顺序）
 * 2. 从末尾（最新）倒序计数，正式日志和 debug 日志各自独立裁剪
 * 3. 正式日志上限 log_max_entries（默认 200），debug 日志上限 log_max_debug_entries（默认 50）
 * 4. 按原顺序输出保留的条目（时间正序，无需重排序）
 *
 * 分计数设计：debug 日志（如 enemy.move）频率较高，若与正式日志共用配额会
 * 把玩家操作反馈挤掉。独立计数确保两类日志互不挤占。
 *
 * @param OblivionsLogger $logger
 * @param int $groomid 房间 ID
 * @param int $pid      玩家 ID
 */
function obl_log_persist($logger, $groomid, $pid) {
    if (!$logger || !$logger->hasEntries()) return;

    $new_entries = $logger->getEntries();
    $log_file = GAME_ROOT . './oblivions/cache/logs/obl_log_' . (int)$groomid . '_' . (int)$pid . '.json';
    $obl_log_dir = dirname($log_file);
    if (!is_dir($obl_log_dir)) @mkdir($obl_log_dir, 0755, true);

    // 读取已有日志（已按时间正序：旧→新）
    $existing = [];
    if (file_exists($log_file)) {
        $raw = file_get_contents($log_file);
        $existing = json_decode($raw, true);
        if (!is_array($existing)) $existing = [];
    }

    // 合并（保持时间顺序：existing 旧 → new 新）
    $all = array_merge($existing, $new_entries);

    // 从末尾（最新）开始计数，标记保留的条目
    // 正式日志和 debug 日志各自独立计数，互不挤占
    $max_official   = obl_log_get_max_entries();
    $max_debug      = obl_log_get_max_debug_entries();
    $official_count = 0;
    $debug_count    = 0;
    $keep = array_fill(0, count($all), false);

    for ($i = count($all) - 1; $i >= 0; $i--) {
        if (!empty($all[$i]['debug'])) {
            if ($debug_count < $max_debug) {
                $keep[$i] = true;
                $debug_count++;
            }
        } else {
            if ($official_count < $max_official) {
                $keep[$i] = true;
                $official_count++;
            }
        }
    }

    // 按原顺序输出保留的条目（时间正序：旧→新，无需重排序）
    $result = [];
    for ($i = 0; $i < count($all); $i++) {
        if ($keep[$i]) {
            $result[] = $all[$i];
        }
    }

    // 写入文件（加锁防并发）
    file_put_contents($log_file, json_encode($result, JSON_UNESCAPED_UNICODE), LOCK_EX);
}

/**
 * 从文件读取日志
 *
 * @param int $groomid 房间 ID
 * @param int $pid      玩家 ID
 * @return array 日志条目数组（按时间正序）
 */
function obl_log_load($groomid, $pid) {
    $log_file = GAME_ROOT . './oblivions/cache/logs/obl_log_' . (int)$groomid . '_' . (int)$pid . '.json';
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
    $log_dir = GAME_ROOT . './oblivions/cache/logs/';
    if (!is_dir($log_dir)) return;

    $files = glob($log_dir . 'obl_log_*.json');
    if (empty($files)) return;

    foreach ($files as $file) {
        @unlink($file);
    }
}

// ================================================================
// Oblivions 错误日志系统 / Oblivions error log system
//
// 与 obl_log（结构化事件日志）物理隔离，专门收集诊断性错误信息。
// 设计原则：
// - 错误日志独立存储，不被 obl_log 的 200 条上限挤掉
// - 前端通过 api_v2.php ?action=obl_error 独立轮询
// - POST 不返回信息，前端通过 GET 拉取错误日志感知后端异常
// ================================================================

/**
 * 错误日志收集器（单次请求内累积，请求结束前持久化）
 *
 * 在 common.inc.php 中与 $obl_log 同步初始化为全局 $obl_error_log。
 * 后端异常捕获时通过 emit() 追加条目，请求结束时统一持久化。
 */
class OblivionsErrorLogger {

    /** @var array 本请求累积的错误条目 */
    private $entries = [];

    /**
     * 追加一条错误日志
     *
     * @param string $id       错误 ID（如 'tick.dispatch.error'），命名规则 {模块}.{错误类型}
     * @param array  $params   错误详情，值限 string/number/boolean
     * @param string $request  请求来源（'command'/'api'/'unknown'），便于定位错误入口
     */
    public function emit($id, $params = [], $request = 'unknown') {
        $this->entries[] = [
            'id'      => $id,
            'params'  => $params ?: [],
            'ts'      => time(),
            'request' => $request,
        ];
    }

    /**
     * 获取本请求累积的错误条目
     * @return array
     */
    public function getEntries() {
        return $this->entries;
    }

    /**
     * 本请求是否有错误日志
     * @return bool
     */
    public function hasEntries() {
        return !empty($this->entries);
    }
}

/**
 * 读取错误日志最大条目数（带静态缓存）
 * @return int 默认 50
 */
function obl_error_log_get_max_entries() {
    static $max = null;
    if ($max === null) {
        $max = 50;  // 错误日志量小，50 条保留足够历史
    }
    return $max;
}

/**
 * 持久化错误日志到文件（追加模式，倒序计数裁剪）
 *
 * 文件路径：oblivions/cache/logs/obl_error_{groomid}_{pid}.json
 * 格式：JSON 数组，按时间正序（旧→新）
 *
 * 轮转逻辑：与 obl_log_persist 类似，但无 debug/正式区分，统一计数裁剪。
 *
 * @param OblivionsErrorLogger $logger
 * @param int $groomid 房间 ID
 * @param int $pid      玩家 ID
 */
function obl_error_log_persist($logger, $groomid, $pid) {
    if (!$logger || !$logger->hasEntries()) return;

    $new_entries = $logger->getEntries();
    $log_file = GAME_ROOT . './oblivions/cache/logs/obl_error_' . (int)$groomid . '_' . (int)$pid . '.json';
    $obl_error_log_dir = dirname($log_file);
    if (!is_dir($obl_error_log_dir)) @mkdir($obl_error_log_dir, 0755, true);

    // 读取已有错误日志（已按时间正序：旧→新）
    $existing = [];
    if (file_exists($log_file)) {
        $raw = file_get_contents($log_file);
        $existing = json_decode($raw, true);
        if (!is_array($existing)) $existing = [];
    }

    // 合并（保持时间顺序：existing 旧 → new 新）
    $all = array_merge($existing, $new_entries);

    // 从末尾（最新）开始计数，保留最近 N 条
    $max_entries = obl_error_log_get_max_entries();
    $count = 0;
    $keep = array_fill(0, count($all), false);

    for ($i = count($all) - 1; $i >= 0; $i--) {
        if ($count < $max_entries) {
            $keep[$i] = true;
            $count++;
        }
    }

    // 按原顺序输出保留的条目（时间正序：旧→新）
    $result = [];
    for ($i = 0; $i < count($all); $i++) {
        if ($keep[$i]) {
            $result[] = $all[$i];
        }
    }

    // 写入文件（加锁防并发）
    file_put_contents($log_file, json_encode($result, JSON_UNESCAPED_UNICODE), LOCK_EX);
}

/**
 * 从文件读取错误日志
 *
 * @param int $groomid 房间 ID
 * @param int $pid      玩家 ID
 * @return array 错误条目数组（按时间正序）
 */
function obl_error_log_load($groomid, $pid) {
    $log_file = GAME_ROOT . './oblivions/cache/logs/obl_error_' . (int)$groomid . '_' . (int)$pid . '.json';
    if (!file_exists($log_file)) return [];

    $raw = file_get_contents($log_file);
    $entries = json_decode($raw, true);
    return is_array($entries) ? $entries : [];
}

/**
 * 清理所有 Oblivions 错误日志文件
 *
 * 在 rs_game() 游戏重置时调用，与 obl_log_clear_all() 同步清理。
 */
function obl_error_log_clear_all() {
    $log_dir = GAME_ROOT . './oblivions/cache/logs/';
    if (!is_dir($log_dir)) return;

    $files = glob($log_dir . 'obl_error_*.json');
    if (empty($files)) return;

    foreach ($files as $file) {
        @unlink($file);
    }
}
