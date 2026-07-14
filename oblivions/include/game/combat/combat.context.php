<?php
/**
 * @module D 战斗系统（Combat）
 * @framework D-7 战斗上下文
 */
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// 新战斗系统 — CombatContext 上下文封装（唯一状态载体）
//
// 职责：封装单次 action 执行过程中的全部状态。
//   - 输入层：actor_data / act_id / config / battle_cache / log
//   - 目标层：targets 数组（per-target 独立持有 effects + snapshot）
//   - 状态层：success / failure_reason
//   - AP 层：ap_cost（verify 算出后写入）
//   - 预校验层：dry_run
//   - 反应层：react_queue / applied_reacts（v1 预留不启用）
//
// 与旧系统边界：旧系统状态散落在 $actor_data / $battle_cache / 局部变量，
//   新系统集中到 CombatContext，消除隐式状态耦合。
//
// 关键设计约束：
//   - effects 与 snapshot 是 per-target 的：每个 target 独立持有，避免多目标技能
//     （whirlwind）下效果被重复应用 N 次的 bug。
//   - 引用硬约束：构造函数引用赋值 actor_data / battle_cache，getCurrentTarget
//     返回引用，修改生效到 targets 数组。
//   - 无外部依赖，可独立单测。
// ================================================================

class CombatContext {

    // ── 输入层 ──
    /** @var array 行动者数据（引用赋值，跨 action 共享） */
    public array $actor_data;
    /** @var string 技能 ID */
    public string $act_id;
    /** @var array 技能配置 */
    public array $config;
    /** @var array 战斗缓存（引用赋值，跨 action 共享） */
    public array $battle_cache;
    /** @var mixed BattleLogCollector 对象（天然引用） */
    public $log;

    // ── 目标层 ──
    /** @var string 目标类型：pid / tile / self / none */
    public string $target_type = '';
    /** @var string ResolvedAim kind */
    public string $aim_kind = '';
    /** @var string 当前 ResolutionTarget kind */
    public string $current_resolution_kind = '';
    /** @var array 后端权威瞄准对象 */
    public array $resolved_aim = [];
    /** @var array 一次捕获后冻结的目标集合 */
    public array $captured_target_set = [];
    /** @var array 有序 ResolutionTarget 列表 */
    public array $resolution_targets = [];
    /** @var array 完整目标列表（每项含 target_data + tags + effects + snapshot） */
    public array $targets = [];
    /** @var int 当前 target 索引（唯一可变状态） */
    public int $current_target_index = 0;
    /** @var array 每个目标的独立结果 */
    public array $target_results = [];
    public bool $any_target_resolved = false;
    public bool $delivery_executed = false;
    public bool $resources_committed = false;
    public bool $resources_reserved = false;

    // ── 状态层 ──
    public bool $success = true;
    public ?string $failure_reason = null;

    // ── AP 层 ──
    /** @var int 当前 action 的 AP 消耗（verify 算出后写入 $action['_ap_cost']，persist 从 action 读） */
    public int $ap_cost = 0;
    public int $ap_before = 0;
    public int $ap_after = 0;

    // ── Battlelog v2 层 ──
    /** @var string|null 当前 action 的 v2 关联 ID */
    public ?string $action_uid = null;
    /** @var bool action_start 是否已发射 */
    public bool $v2_action_started = false;
    /** @var bool action_end 是否已发射 */
    public bool $v2_action_ended = false;
    /** @var array 本 action 已发射的 effect_uid 列表 */
    public array $v2_effect_uids = [];
    /** @var array<string,array<int,string>> 本 action 按 effect type 分组的 effect_uid */
    public array $v2_effect_uids_by_type = [];

    // ── 预校验层 ──
    public bool $dry_run = false;

    // ── 反应层（反击机制预留，v1 不启用） ──
    /** @var array 待处理的反应效果 */
    public array $react_queue = [];
    /** @var array 已应用的反应效果 */
    public array $applied_reacts = [];

    // ── 内部缓存 ──
    /** @var array|null 标签集懒构建缓存（绑定 current_target，切换 target 时需 invalidateTagsCache） */
    private ?array $current_tags_cache = null;

    /**
     * targets 为空时 getCurrentTarget 返回的空数组引用载体（避免返回局部变量引用）
     * @var array
     */
    private array $empty_target_ref = [];

    /**
     * @param array  &$actor_data   行动者数据（引用赋值）
     * @param string $act_id        技能 ID
     * @param array  $config        技能配置
     * @param mixed  $log           BattleLogCollector 对象
     * @param array  &$battle_cache 战斗缓存（引用赋值）
     */
    public function __construct(array &$actor_data, string $act_id, array $config, $log, array &$battle_cache) {
        // 引用赋值：actor_data / battle_cache 跨 action 共享，修改回流到调用方
        $this->actor_data = &$actor_data;
        $this->act_id = $act_id;
        $this->config = $config;
        $this->log = $log;
        $this->battle_cache = &$battle_cache;
    }

    /**
     * 声明效果（追加到当前 target 的 effects 数组）
     *
     * per-target 设计：每个 target 独立持有 effects，避免多目标技能下效果被
     * 重复应用 N 次。effects 在 execute 阶段由 effect 应用器消费。
     *
     * @param string $type    效果类型（damage / heal / move / buff / ...）
     * @param array  $payload 效果负载（value / subtype / ...）
     */
    public function declareEffect(string $type, array $payload): void {
        if (empty($this->targets)) return;
        $target = &$this->getCurrentTarget();
        $target['effects'][] = ['type' => $type, 'payload' => $payload];
    }

    /**
     * 声明反应效果（反击机制预留，v1 不启用）
     *
     * 反应效果不立即应用，先入 react_queue，待当前 action 完成后统一处理。
     *
     * @param string $type       效果类型
     * @param array  $payload    效果负载
     * @param int    $source_pid 反应来源 pid
     */
    public function declareReactEffect(string $type, array $payload, int $source_pid): void {
        $this->react_queue[] = [
            'type' => $type,
            'payload' => $payload,
            'source_pid' => $source_pid,
        ];
    }

    /**
     * 获取当前 target（返回引用，修改生效到 targets 数组）
     *
     * 如果 targets 为空，返回 empty_target_ref 的引用（避免返回局部变量引用
     * 导致的悬空引用问题）。
     *
     * @return array
     */
    public function &getCurrentTarget(): array {
        if (empty($this->targets)) {
            return $this->empty_target_ref;
        }
        $this->current_resolution_kind = (string)($this->targets[$this->current_target_index]['kind'] ?? '');
        $this->target_type = $this->current_resolution_kind === 'character'
            ? 'pid'
            : $this->current_resolution_kind;
        return $this->targets[$this->current_target_index];
    }

    /**
     * 获取当前 target 的 effects 数组（返回副本，仅读）
     *
     * @return array
     */
    public function getCurrentEffects(): array {
        $target = &$this->getCurrentTarget();
        return $target['effects'] ?? [];
    }

    /**
     * 获取当前 target 的 snapshot（返回副本，仅读）
     *
     * @return array|null
     */
    public function getCurrentSnapshot(): ?array {
        $target = &$this->getCurrentTarget();
        return $target['snapshot_target_state'] ?? null;
    }

    /**
     * 获取当前 target 的标签集（懒构建 + 缓存）
     *
     * 缓存绑定到 current_target_index，切换 target 时必须调用 invalidateTagsCache()。
     * snapshot/execute 后也应调用 invalidateTagsCache()（状态变更可能影响标签派生）。
     *
     * @return array
     */
    public function getCurrentTags(): array {
        if ($this->current_tags_cache !== null) {
            return $this->current_tags_cache;
        }
        // 调用 combat.tag.php 的派生函数注册表构建标签集（纯读，不写 tag_mutations）
        $this->current_tags_cache = combat_tag_build($this);
        return $this->current_tags_cache;
    }

    /**
     * 清空标签集缓存（切换 target / snapshot / execute 后调用）
     */
    public function invalidateTagsCache(): void {
        $this->current_tags_cache = null;
    }

    /**
     * 当前 target_type 是否为 pid
     * @return bool
     */
    public function isPidTarget(): bool {
        return $this->target_type === 'pid';
    }

    /**
     * 当前 target_type 是否为 tile
     * @return bool
     */
    public function isTileTarget(): bool {
        return $this->target_type === 'tile';
    }

    /**
     * 当前 target_type 是否为 self
     * @return bool
     */
    public function isSelfTarget(): bool {
        return $this->target_type === 'self';
    }

    /**
     * 当前 target_type 是否为 none
     * @return bool
     */
    public function isNoneTarget(): bool {
        return $this->target_type === 'none';
    }

    /**
     * 快照 actor + current_target 的 HP/AP/位置前值
     *
     * 写入 getCurrentTarget()['snapshot_target_state']，供回滚 / 日志 / 前端导演系统对比前后值。
     * per-target 设计：每个 target 独立持有 snapshot。
     */
    public function snapshotTargetState(): void {
        if (empty($this->targets)) return;
        $target = &$this->getCurrentTarget();
        $target['snapshot_target_state'] = [
            'actor' => [
                'hp' => $this->actor_data['hp'] ?? 0,
                'ap' => $this->actor_data['ap'] ?? 0,
                'pls' => $this->actor_data['pls'] ?? 0,
            ],
            'target' => [
                'hp' => $target['target_data']['hp'] ?? 0,
                'ap' => $target['target_data']['ap'] ?? 0,
                'pls' => $target['target_data']['pls'] ?? 0,
            ],
        ];
    }

    public function storeRuntimePlayer(array $data): void {
        $pid = (int)($data['pid'] ?? 0);
        if ($pid <= 0) return;
        if (!isset($this->battle_cache['_runtime_players']) || !is_array($this->battle_cache['_runtime_players'])) {
            $this->battle_cache['_runtime_players'] = [];
        }
        $this->battle_cache['_runtime_players'][$pid] = $data;
        if ($this->dry_run) combat_planned_state_put_player($this->battle_cache, $data);
    }
}
