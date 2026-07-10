<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// Compatibility facade for callers that still use the historical target entrypoint.
// Aim resolution and target capture are separate registries in combat.aim.php and
// combat.target_capture.php; no target resolver registry remains here.
function combat_target_resolve_all(CombatContext $ctx): void {
    combat_aim_resolve($ctx);
    if ($ctx->success) {
        combat_capture_resolution_targets($ctx);
    }
}
