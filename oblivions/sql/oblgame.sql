--
-- 表的结构 `bra_oblgame`
-- Oblivions 单房间单局运行状态表
-- 每个房间一张表，一表一行，id 固定为 1
--

DROP TABLE IF EXISTS bra_oblgame;
CREATE TABLE bra_oblgame (
  id              tinyint unsigned NOT NULL DEFAULT '1',
  run_id          varchar(64) NOT NULL DEFAULT '',
  state           varchar(32) NOT NULL DEFAULT 'INIT',
  phase           varchar(16) NOT NULL DEFAULT 'day',

  tick            int unsigned NOT NULL DEFAULT '0',
  processed_tick  int unsigned NOT NULL DEFAULT '0',
  tick_version    int unsigned NOT NULL DEFAULT '0',
  day             int unsigned NOT NULL DEFAULT '1',

  vars_json       mediumtext NOT NULL,

  map_seed        varchar(64) NOT NULL DEFAULT '',
  map_version     int unsigned NOT NULL DEFAULT '1',

  started_at      int unsigned NOT NULL DEFAULT '0',
  updated_at      int unsigned NOT NULL DEFAULT '0',
  ended_at        int unsigned NOT NULL DEFAULT '0',
  heartbeat_at    int unsigned NOT NULL DEFAULT '0',
  last_command_at int unsigned NOT NULL DEFAULT '0',

  winner_pid      int unsigned NOT NULL DEFAULT '0',
  winner_name     varchar(64) NOT NULL DEFAULT '',
  end_reason      varchar(64) NOT NULL DEFAULT '',

  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
