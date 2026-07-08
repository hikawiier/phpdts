<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// 新战斗系统 — 目标系统
//
// 职责：目标解析器注册表 + 入口分发。
//   - 注册表 $combat_target_resolvers：target 类型 => 解析器
//   - 解析器签名：function(CombatContext $ctx, $target_id): ?array
//     返回 target_data 数组（pid/tile 合成）或 null（解析失败）。
//   - 入口函数 combat_target_resolve_all：按 $ctx->config['target'] 分发，
//     为每个目标构建 ['target_data'=>..., 'tags'=>[], 'effects'=>[], 'snapshot'=>null]
//     填入 $ctx->targets[]，并设置 $ctx->target_type。
//
// target 类型与 target_type 映射：
//   enemy / all  → pid   （pid 解析器，调 obl_fetch_playerdata_by_pid）
//   tiles        → tile  （tile 解析器，合成数据不查 DB）
//   self         → self  （引用 &$ctx->actor_data，不查 DB）
//   none         → none  （target_data = null）
//
// 引用硬约束（spec §4）：
//   - self 目标必须以引用存入 targets[i]['target_data']，PHP 数组返回是值拷贝，
//     所以 self 在入口函数内特例处理（不走 resolver 返回值），直接 =&$ctx->actor_data。
//   - pid/tile 目标是临时合成数据，引用链路由 getCurrentTarget() 的 & 返回保证。
//
// 与旧系统边界：旧系统目标解析内联在 battle_execute 内，pid 路径硬编码。
//   新系统注册表化，支持 pid/tile/self/none 四类 + 多目标（all）。
// ================================================================

/** @var array 目标解析器注册表（target 类型 => callable） */
if (!isset($GLOBALS['combat_target_resolvers'])) {
    $GLOBALS['combat_target_resolvers'] = [];
}

/**
 * 注册目标解析器
 *
 * @param string   $type     目标类型（enemy / all / tiles / self / none / 自定义）
 * @param callable $resolver 解析器签名：function(CombatContext $ctx, $target_id): ?array
 */
function combat_target_register(string $type, callable $resolver): void {
    $GLOBALS['combat_target_resolvers'][$type] = $resolver;
}

// ================================================================
// 内置解析器
// ================================================================

/**
 * pid 解析器：调 obl_fetch_playerdata_by_pid，不存在返回 null
 *
 * 用于 enemy / all 两类目标。
 *
 * @param CombatContext $ctx
 * @param int           $target_id 目标 pid
 * @return array|null
 */
function combat_target_resolve_pid(CombatContext $ctx, $target_id): ?array {
    $pid = (int)$target_id;
    if ($pid <= 0) return null;
    $pdata = obl_fetch_playerdata_by_pid($pid);
    if (!$pdata) return null;
    return $pdata;
}

/**
 * tile 解析器：合成 ['pgroup','pls','pid'=>0]，不查 DB
 *
 * 用于 tiles 类目标。pid=0 标识 tile 目标（区别于 pid 目标）。
 *
 * @param CombatContext $ctx
 * @param int           $target_id 目标 pls（图格 ID）
 * @return array|null
 */
function combat_target_resolve_tile(CombatContext $ctx, $target_id): ?array {
    $pls = (int)$target_id;
    if ($pls <= 0) return null;
    return [
        'pgroup' => $ctx->actor_data['pgroup'] ?? 0,
        'pls'    => $pls,
        'pid'    => 0,
    ];
}

/**
 * self 解析器：返回 $ctx->actor_data 的副本（仅用于注册表一致性）
 *
 * 注意：入口函数 combat_target_resolve_all 对 self 类型特例处理，直接以引用存入
 * targets[i]['target_data']，不走本解析器返回值（PHP 数组返回是值拷贝，会丢失引用）。
 * 本解析器保留是为注册表完整性与外部独立调用场景。
 *
 * @param CombatContext $ctx
 * @param mixed         $target_id 占位
 * @return array|null
 */
function combat_target_resolve_self(CombatContext $ctx, $target_id): ?array {
    return $ctx->actor_data;
}

/**
 * none 解析器：返回 null（无目标）
 *
 * 用于 escape / idle 等无目标技能。
 *
 * @param CombatContext $ctx
 * @param mixed         $target_id 占位
 * @return array|null
 */
function combat_target_resolve_none(CombatContext $ctx, $target_id): ?array {
    return null;
}

// ================================================================
// 入口函数
// ================================================================

/**
 * 解析全部目标（按 $ctx->config['target'] 分发到解析器）
 *
 * 流程：
 *   - self / none：特例处理（self 走引用，none 直接 null）
 *   - all：遍历 $ctx->battle_cache['combatants'] 中 status=1 的 pid（排除 actor 自身），
 *          对每个 pid 调 pid 解析器
 *   - enemy / tiles / 自定义：从 $ctx->config['target_id'] 取 target_id，
 *          调对应解析器，单目标
 *
 * 解析失败（target_id 无效 / pid 不存在）时设 $ctx->success=false + failure_reason。
 *
 * @param CombatContext $ctx
 */
function combat_target_resolve_all(CombatContext $ctx): void {
    $type = $ctx->config['target'] ?? 'none';
    $intent = $ctx->config['target_intent'] ?? null;
    $ctx->targets = [];
    $ctx->target_type = '';

    // self：必须以引用存入 target_data（spec §4 引用硬约束）
    if ($type === 'self') {
        $ctx->targets[] = [
            'target_data' => &$ctx->actor_data,
            'tags'        => [],
            'effects'     => [],
            'snapshot'    => null,
        ];
        $ctx->target_type = 'self';
        return;
    }

    // none：target_data = null
    if ($type === 'none') {
        $ctx->targets[] = [
            'target_data' => null,
            'tags'        => [],
            'effects'     => [],
            'snapshot'    => null,
        ];
        $ctx->target_type = 'none';
        return;
    }

    // all：多目标迭代（pid 解析器）
    if ($type === 'all') {
        $combatants = $ctx->battle_cache['combatants'] ?? [];
        $actor_pid  = (int)($ctx->actor_data['pid'] ?? 0);
        $resolver   = $GLOBALS['combat_target_resolvers']['enemy']
            ?? $GLOBALS['combat_target_resolvers']['all']
            ?? 'combat_target_resolve_pid';

        foreach ($combatants as $pid => $status) {
            $pid = (int)$pid;
            // 排除自身（whirlwind 不应攻击自己）
            if ($pid === $actor_pid) continue;
            // 只对活跃 combatant 解析（status=1）
            if ((int)$status !== 1) continue;

            $target_data = call_user_func($resolver, $ctx, $pid);
            if ($target_data === null) continue;

            $ctx->targets[] = [
                'target_data' => $target_data,
                'tags'        => [],
                'effects'     => [],
                'snapshot'    => null,
            ];
        }
        $ctx->target_type = 'pid';
        if (empty($ctx->targets)) {
            $ctx->success = false;
            $ctx->failure_reason = 'target_resolve_failed:all:no_targets';
        }
        return;
    }

    // enemy / tiles / 自定义类型：单目标，target_id 从 config 取
    $resolver = $GLOBALS['combat_target_resolvers'][$type] ?? null;
    if (!$resolver) {
        error_log("[combat_target] Unknown target type: {$type}");
        $ctx->success = false;
        $ctx->failure_reason = "unknown_target_type:{$type}";
        return;
    }

    $target_id = $ctx->config['target_id'] ?? 0;
    if (is_array($intent)) {
        $intent_type = (string)($intent['type'] ?? '');
        if ($type === 'enemy' && $intent_type === 'pid') {
            $target_id = (int)($intent['id'] ?? 0);
        } elseif ($type === 'tiles' && $intent_type === 'tile') {
            $target_id = (int)($intent['id'] ?? 0);
        } elseif ($type === 'self' || $type === 'none' || $type === 'all') {
            $target_id = 0;
        }
    }
    $target_data = call_user_func($resolver, $ctx, $target_id);

    if ($target_data === null) {
        $ctx->success = false;
        $ctx->failure_reason = "target_resolve_failed:{$type}:{$target_id}";
        return;
    }

    $ctx->targets[] = [
        'target_data' => $target_data,
        'tags'        => [],
        'effects'     => [],
        'snapshot'    => null,
    ];

    // target_type 映射：enemy/all → pid，tiles → tile，self/none 保持语义类型
    if ($type === 'enemy') {
        $ctx->target_type = 'pid';
    } elseif ($type === 'tiles') {
        $ctx->target_type = 'tile';
    } else {
        $ctx->target_type = $type;
    }
}

// ================================================================
// 注册内置解析器
// ================================================================

combat_target_register('enemy',  'combat_target_resolve_pid');
combat_target_register('all',    'combat_target_resolve_pid');
combat_target_register('tiles',  'combat_target_resolve_tile');
combat_target_register('self',   'combat_target_resolve_self');
combat_target_register('none',   'combat_target_resolve_none');
