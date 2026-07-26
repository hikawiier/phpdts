<?php
/**
 * @module E 游戏逻辑
 * @framework E-4 结构化事件日志系统
 */
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
 * 由 Oblivions Runtime / 兼容入口初始化为全局 $obl_log：
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
// - 前端通过 oblivions/api/state.php?scope=obl_error 独立轮询
// - POST 不返回信息，前端通过 GET 拉取错误日志感知后端异常
// ================================================================

/**
 * 错误日志收集器（单次请求内累积，请求结束前持久化）
 *
 * 由 Oblivions Runtime / 兼容入口与 $obl_log 同步初始化为全局 $obl_error_log。
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

    // 写入文件（加锁防并发，json_encode 失败时回退为占位条目避免整个文件损坏）
    $json = json_encode($result, JSON_UNESCAPED_UNICODE);
    if ($json === false) {
        $error_msg = json_last_error_msg();
        $fallback = [['id' => 'system.error_log.encode_failed', 'params' => ['_encode_failed' => $error_msg, 'entry_count' => count($result)], 'ts' => time()]];
        $json = json_encode($fallback, JSON_UNESCAPED_UNICODE);
    }
    file_put_contents($log_file, $json, LOCK_EX);
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

// ================================================================
// Oblivions 诊断日志系统 / Oblivions diagnostic log system
//
// A-5 调试工具框架下的诊断日志通道，仅在 ?debug=all 守卫下启用。
// 与 obl_log（玩家事件）/ obl_error_log（运行时错误 + 命令反馈）物理隔离：
//   - 用途：调试期诊断信息（含正常流程），用于排查"为什么没触发"类问题
//   - 守卫：仅 ?debug=all 启用时实例化与 emit，零生产开销
//   - 保留：按游戏局保留，obl_rs_game() 时清空；软上限 1000 条防膨胀
//   - 前端通道：state.php?scope=debug_diag_log&debug=all
// ================================================================

/**
 * 诊断日志收集器（单次请求内累积，请求结束前持久化）
 *
 * 由 Oblivions Runtime 在 ?debug=all 启用时初始化为全局 $obl_diag_log：
 *   $obl_diag_log = obl_debug_enabled() ? new OblivionsDiagnosticLogger() : null;
 *
 * 调用方需 if (isset($obl_diag_log) && $obl_diag_log) 守卫。
 */
class OblivionsDiagnosticLogger {

    /** @var array 本请求累积的诊断条目 */
    private $entries = [];

    /** @var int 请求内递增序号（每请求从 0 开始） */
    private $requestSeq = 0;

    /**
     * 追加一条诊断日志
     *
     * @param string $id       诊断 ID（如 'nav.interrupt'），命名规则 {module}.{subevent}
     * @param string $category 粗粒度分类（navigate/move/tick/...），供前端筛选
     * @param array  $params   结构化参数，由 obl_diag_emit() 门面预先清洗
     */
    public function emit($id, $category, $params = []) {
        $this->requestSeq++;
        $this->entries[] = [
            'seq'          => $this->requestSeq,
            'request_uid'  => isset($GLOBALS['obl_request_uid']) ? (string)$GLOBALS['obl_request_uid'] : '',
            'request_kind' => isset($GLOBALS['obl_request_kind']) ? (string)$GLOBALS['obl_request_kind'] : '',
            'command'      => isset($GLOBALS['obl_current_command']) ? (string)$GLOBALS['obl_current_command'] : '',
            'id'           => $id,
            'category'     => $category,
            'params'       => $params ?: [],
            'ts'           => time(),
            'ts_ms'        => (int)(microtime(true) * 1000),
        ];
    }

    /**
     * 获取本请求累积的诊断条目
     * @return array
     */
    public function getEntries() {
        return $this->entries;
    }

    /**
     * 本请求是否有诊断日志
     * @return bool
     */
    public function hasEntries() {
        return !empty($this->entries);
    }

    /**
     * 清空本请求累积的诊断条目（持久化后调用，保证幂等）
     */
    public function clear() {
        $this->entries = [];
    }
}

/**
 * 读取诊断日志最大条目数（带静态缓存）
 * @return int 默认 1000（按局保留，软上限防膨胀）
 */
function obl_diag_log_get_max_entries() {
    static $max = null;
    if ($max === null) {
        $max = 1000;
    }
    return $max;
}

/**
 * 持久化诊断日志到文件（追加模式，倒序计数裁剪）
 *
 * 文件路径：oblivions/cache/logs/obl_diag_{groomid}_{pid}.json
 * 格式：JSON 数组，按时间正序（旧→新）
 *
 * 轮转逻辑：与 obl_error_log_persist 类似，单计数裁剪，软上限 1000 条。
 * 按局保留：obl_rs_game() 时调用 obl_diag_log_clear_all() 清空，局内不主动裁剪。
 *
 * @param OblivionsDiagnosticLogger $logger
 * @param int $groomid 房间 ID
 * @param int $pid      玩家 ID
 */
function obl_diag_log_persist($logger, $groomid, $pid) {
    if (!$logger || !$logger->hasEntries()) return;

    $new_entries = $logger->getEntries();
    $log_file = GAME_ROOT . './oblivions/cache/logs/obl_diag_' . (int)$groomid . '_' . (int)$pid . '.json';
    $obl_diag_log_dir = dirname($log_file);
    if (!is_dir($obl_diag_log_dir)) @mkdir($obl_diag_log_dir, 0755, true);

    // 读取已有诊断日志（已按时间正序：旧→新）
    $existing = [];
    if (file_exists($log_file)) {
        $raw = file_get_contents($log_file);
        $existing = json_decode($raw, true);
        if (!is_array($existing)) $existing = [];
    }

    // 合并（保持时间顺序：existing 旧 → new 新）
    $all = array_merge($existing, $new_entries);

    // 从末尾（最新）开始计数，保留最近 N 条（软上限防膨胀）
    $max_entries = obl_diag_log_get_max_entries();
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

    // 写入文件（加锁防并发，json_encode 失败时回退为占位条目避免整个文件损坏）
    $json = json_encode($result, JSON_UNESCAPED_UNICODE);
    if ($json === false) {
        $error_msg = json_last_error_msg();
        $fallback = [[
            'seq' => 0,
            'request_uid' => isset($GLOBALS['obl_request_uid']) ? (string)$GLOBALS['obl_request_uid'] : '',
            'request_kind' => isset($GLOBALS['obl_request_kind']) ? (string)$GLOBALS['obl_request_kind'] : '',
            'command' => '',
            'id' => 'system.diag_log.encode_failed',
            'category' => 'diag',
            'params' => ['_encode_failed' => $error_msg, 'entry_count' => count($result)],
            'ts' => time(),
            'ts_ms' => (int)(microtime(true) * 1000),
        ]];
        $json = json_encode($fallback, JSON_UNESCAPED_UNICODE);
    }
    file_put_contents($log_file, $json, LOCK_EX);

    // 清空 logger entries，保证同一请求多次调用 obl_runtime_persist_logs() 幂等
    $logger->clear();
}

/**
 * 从文件读取诊断日志
 *
 * @param int $groomid 房间 ID
 * @param int $pid      玩家 ID
 * @return array 诊断条目数组（按时间正序）
 */
function obl_diag_log_load($groomid, $pid) {
    $log_file = GAME_ROOT . './oblivions/cache/logs/obl_diag_' . (int)$groomid . '_' . (int)$pid . '.json';
    if (!file_exists($log_file)) return [];

    $raw = file_get_contents($log_file);
    $entries = json_decode($raw, true);
    return is_array($entries) ? $entries : [];
}

/**
 * 清理所有 Oblivions 诊断日志文件
 *
 * 在 obl_rs_game() 游戏重置时调用，与 obl_log_clear_all/obl_error_log_clear_all 同步清理。
 * 按局保留策略：局结束清空，避免跨局残留。
 */
function obl_diag_log_clear_all() {
    $log_dir = GAME_ROOT . './oblivions/cache/logs/';
    if (!is_dir($log_dir)) return;

    $files = glob($log_dir . 'obl_diag_*.json');
    if (empty($files)) return;

    foreach ($files as $file) {
        @unlink($file);
    }
}

// ================================================================
// A-5-2 加固：诊断日志门面函数与参数清洗
//
// 设计案：oblivions/docs/诊断日志系统框架加固-设计案-2026-07-26.md
//
// 业务代码应优先使用 obl_diag_emit() / obl_diag_critical() 门面，
// 框架内部处理守卫、参数清洗、请求关联字段附加、多通道分发。
// 直接调用 $obl_diag_log->emit() 的旧代码向后兼容（但 AGENTS.md 鼓励用门面）。
// ================================================================

/**
 * 诊断日志参数清洗（深度/长度/键数限制 + 类型归一化）
 *
 * 标准值（设计案 §3.3）：
 *   - 最大深度 5 层
 *   - 字符串最大长度 1024
 *   - 数组最大键数 50
 *   - 资源/Closure 替换为占位
 *   - json_encode 失败时整体回退为占位条目
 *
 * @param mixed $params 原始参数
 * @return array 清洗后的数组
 */
function obl_diag_sanitize_params($params) {
    if (!is_array($params)) {
        // 非数组入参（string/number/boolean/null）包成单元素数组
        return ['value' => obl_diag_sanitize_scalar($params)];
    }
    return obl_diag_sanitize_array($params, 0);
}

/**
 * 标量值清洗（字符串截断）
 */
function obl_diag_sanitize_scalar($value) {
    if (is_string($value) && strlen($value) > 1024) {
        $truncated = strlen($value) - 1024;
        return substr($value, 0, 1024) . '...[truncated ' . $truncated . ' chars]';
    }
    if (is_resource($value)) return '[resource]';
    if ($value instanceof Closure) return '[closure]';
    if (is_object($value)) {
        // 对象转数组后递归清洗（仅 public 属性）
        return obl_diag_sanitize_array((array)$value, 0);
    }
    return $value;
}

/**
 * 数组递归清洗（深度限制 + 键数限制）
 *
 * @param array $arr   待清洗数组
 * @param int   $depth 当前深度
 * @return array
 */
function obl_diag_sanitize_array(array $arr, $depth) {
    if ($depth >= 5) {
        return ['...truncated...'];
    }
    $result = [];
    $count = 0;
    $truncated_keys = 0;
    foreach ($arr as $key => $value) {
        $count++;
        if ($count > 50) {
            $truncated_keys++;
            continue;
        }
        // 键名转字符串（避免 numeric key 异常）
        $key = is_string($key) ? $key : (string)$key;
        // 键名长度也限制
        if (strlen($key) > 128) {
            $key = substr($key, 0, 128) . '...';
        }
        if (is_array($value)) {
            $result[$key] = obl_diag_sanitize_array($value, $depth + 1);
        } elseif (is_resource($value)) {
            $result[$key] = '[resource]';
        } elseif ($value instanceof Closure) {
            $result[$key] = '[closure]';
        } elseif (is_object($value)) {
            $result[$key] = obl_diag_sanitize_array((array)$value, $depth + 1);
        } else {
            $result[$key] = obl_diag_sanitize_scalar($value);
        }
    }
    if ($truncated_keys > 0) {
        $result['_truncated_keys'] = $truncated_keys;
    }
    return $result;
}

/**
 * 诊断日志统一入口（门面）
 *
 * 框架内部处理：守卫检查、参数清洗、请求关联字段附加（在 emit 内自动完成）
 * 业务代码只负责描述"发生了什么"：
 *   obl_diag_emit('nav.interrupt', 'navigate', ['reason' => 'force_combat', 'cur_pls' => 5]);
 *
 * @param string $id       诊断 ID，命名规则 {module}.{subevent}
 * @param string $category 粗粒度分类（navigate/move/tick/...）
 * @param array  $params   结构化参数（框架自动清洗）
 */
function obl_diag_emit($id, $category, $params = []) {
    global $obl_diag_log;
    if (!isset($obl_diag_log) || !$obl_diag_log) return;
    $safe_params = obl_diag_sanitize_params($params);
    $obl_diag_log->emit($id, $category, $safe_params);
}

/**
 * 严重错误三通道并行（门面）
 *
 * 自动写：
 *   1. error_log() — 运维可见（不依赖调试模式）
 *   2. $obl_error_log — 命令反馈链路（system.* 前缀豁免 obl_command_feedback_rules）
 *   3. $obl_diag_log — 调试诊断链路（结构化追溯）
 *
 * 用于监听器违反契约、数据漂移等系统级 critical。
 * 业务代码无需手写三通道，也无需关心 system.* 前缀。
 *
 * @param string $id       诊断 ID（框架自动添加 system. 前缀写入 $obl_error_log）
 * @param string $category 粗粒度分类
 * @param array  $params   结构化参数（框架自动清洗）
 */
function obl_diag_critical($id, $category, $params = []) {
    $safe_params = obl_diag_sanitize_params($params);
    $system_id = 'system.' . ltrim($id, '.');

    // 1. error_log — 运维可见（不依赖调试模式）
    $json = json_encode($safe_params, JSON_UNESCAPED_UNICODE);
    if ($json === false) {
        $json = '[_encode_failed: ' . json_last_error_msg() . ']';
    }
    error_log('[OBL_CRITICAL] ' . $system_id . ' ' . $json);

    // 2. $obl_error_log — 命令反馈链路（system.* 前缀豁免 feedback rules）
    global $obl_error_log;
    if (isset($obl_error_log) && $obl_error_log) {
        $obl_error_log->emit($system_id, $safe_params, null);
    }

    // 3. $obl_diag_log — 调试诊断链路（结构化追溯，仅调试模式）
    global $obl_diag_log;
    if (isset($obl_diag_log) && $obl_diag_log) {
        $obl_diag_log->emit($id, $category, $safe_params);
    }
}
