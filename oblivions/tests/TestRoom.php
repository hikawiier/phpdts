<?php
declare(strict_types=1);

final class TestRoom {
    public string $prefix;
    private array $tables = ['oblmapitem', 'oblmappoi', 'oblmapstates', 'oblbattle_state', 'oblqueue', 'oblplayers', 'oblgame'];
    private array $logFilesBefore = [];

    public function __construct() {
        $this->prefix = 'oblt_' . getmypid() . '_' . bin2hex(random_bytes(4)) . '_';
    }

    public function create(): void {
        global $tablepre, $obl_log, $obl_error_log, $obl_battle_log, $gamevars;
        $tablepre = $this->prefix;
        foreach (['oblplayers', 'oblqueue', 'oblbattle_state', 'oblgame', 'oblmapstates', 'oblmappoi', 'oblmapitem'] as $name) {
            $sql = file_get_contents(GAME_ROOT . "oblivions/sql/{$name}.sql");
            if ($sql === false) throw new RuntimeException("Cannot read schema {$name}");
            $sql = str_replace('bra_', $this->prefix, $sql);
            $sql = preg_replace('/^\s*--.*$/m', '', $sql);
            foreach (preg_split('/;\s*(?:\r?\n|$)/', (string)$sql) as $statement) {
                $statement = trim($statement);
                if ($statement !== '') $GLOBALS['db']->query($statement);
            }
        }
        $GLOBALS['db']->query("INSERT INTO {$this->prefix}oblgame (id, run_id, state, vars_json) VALUES (1, 'test', 'RUNNING', '{\"obl_tick\":10,\"obl_pretick\":10}')");
        $gamevars = ['obl_tick' => 10, 'obl_pretick' => 10];
        $obl_log = new OblivionsLogger();
        $obl_error_log = new OblivionsErrorLogger();
        $obl_battle_log = new BattleLogCollector();
        if (function_exists('battle_turn_set_event_context')) battle_turn_set_event_context(null);
        $this->logFilesBefore = $this->fileSnapshot();
    }

    public function cleanup(): void {
        global $db;
        if (function_exists('obl_runtime_transaction_is_active') && obl_runtime_transaction_is_active()) obl_runtime_transaction_rollback();
        foreach ($this->tables as $table) $db->query("DROP TABLE IF EXISTS {$this->prefix}{$table}", 'SILENT');
    }

    public function resetData(): void {
        global $db, $obl_log, $obl_error_log, $obl_battle_log;
        foreach (['oblmapitem', 'oblmappoi', 'oblmapstates', 'oblbattle_state', 'oblqueue', 'oblplayers'] as $table) {
            $db->query("DELETE FROM {$this->prefix}{$table}");
        }
        $obl_log = new OblivionsLogger();
        $obl_error_log = new OblivionsErrorLogger();
        $obl_battle_log = new BattleLogCollector();
        if (function_exists('battle_turn_set_event_context')) battle_turn_set_event_context(null);
    }

    public function player(string $name, int $type = 0, array $override = []): array {
        global $db;
        $skillpara = [];
        foreach (array_keys(combat_skill_get_all_configs()) as $skill) $skillpara[$skill] = ['lstact' => 0];
        $data = array_merge([
            'type' => $type, 'name' => $name, 'pass' => '', 'gd' => 'm', 'icon' => '0',
            'action' => '', 'bid' => 0, 'hp' => 100, 'mhp' => 100, 'sp' => 100, 'msp' => 100,
            'att' => 20, 'def' => 0, 'ap' => 20, 'max_ap' => 20, 'pgroup' => 1, 'pls' => 1,
            'lvl' => 1, 'exp' => 0, 'state' => 0, 'itempara' => '[]', 'itemmaxslots' => 6,
            'tacpara' => '{"slots":[]}', 'skillpara' => json_encode($skillpara), 'oblpara' => '{}', 'discovered' => 1,
        ], $override);
        foreach (['wep','wep2','arb','arh','ara','arf','art'] as $slot) {
            $data[$slot . 'para'] = '{}';
        }
        $db->array_insert("{$this->prefix}oblplayers", $data);
        $result = $db->query("SELECT pid FROM {$this->prefix}oblplayers WHERE name='" . $db->escape_string($name) . "' ORDER BY pid DESC LIMIT 1");
        $row = $db->fetch_array($result);
        return $this->fetch((int)$row['pid']);
    }

    public function fetch(int $pid): array {
        $data = obl_fetch_playerdata_by_pid($pid);
        if (!$data) throw new RuntimeException("Missing fixture pid {$pid}");
        return $data;
    }

    public function queue(array &$player, int $qid, int $order, int $active = 1, int $done = 0): void {
        global $db;
        $db->query("INSERT INTO {$this->prefix}oblqueue(pid,qid,type,last_acted,myorder,done,active) VALUES (" . (int)$player['pid'] . ",{$qid}," . (int)$player['type'] . ",0,{$order},{$done},{$active})");
        $player['bid'] = $qid;
        $player['action'] = 'battle';
        obl_save_player($player);
        $db->query("INSERT IGNORE INTO {$this->prefix}oblbattle_state"
            . "(qid,state,round_num,turn_seq,active_pid,opened_at_tick,updated_at) VALUES ("
            . "{$qid},'EXECUTING',0,1," . (int)$player['pid'] . ",10," . time() . ")");
    }

    public function reveal(int ...$tiles): void {
        global $db;
        foreach (array_values(array_unique($tiles)) as $pls) {
            $db->query("INSERT INTO {$this->prefix}oblmapstates(pgroup,pls,fog,damaged,flags) VALUES (1," . (int)$pls . ",1,0,'') ON DUPLICATE KEY UPDATE fog=1");
        }
    }

    public function tableRows(string $table): array {
        global $db;
        $rows = [];
        $result = $db->query("SELECT * FROM {$this->prefix}{$table} ORDER BY 1");
        while ($row = $db->fetch_array($result)) $rows[] = $row;
        return $rows;
    }

    public function fileSnapshot(): array {
        $dir = GAME_ROOT . 'oblivions/cache/battles';
        if (!is_dir($dir)) return [];
        $snapshot = [];
        foreach (glob($dir . '/*') ?: [] as $file) {
            if (is_file($file)) $snapshot[basename($file)] = [filesize($file), filemtime($file), md5_file($file)];
        }
        ksort($snapshot);
        return $snapshot;
    }
}

