<?php
// The legacy root command.php path cannot provide the transaction, rollback-only,
// and post-commit log guarantees required by Oblivions. New clients must use the
// Command Bus endpoint exclusively.
ob_clean();
header('Content-Type: application/json');
http_response_code(410);
echo compatible_json_encode([
    'error' => 'OBLIVIONS_LEGACY_COMMAND_DISABLED',
    'endpoint' => 'oblivions/api/command.php',
]);
ob_end_flush();
exit;
