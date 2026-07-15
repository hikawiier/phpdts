--
-- 表的结构 `bra_oblbattle_state`:
-- Oblivions 战斗状态机表
-- 按 qid（先攻队列编号 = 战场编号）分离状态，支持多战场并存
-- 与 bra_oblqueue 通过 qid 关联，职责分离：
--   - bra_oblqueue：先攻队列顺位、行动状态（每个参战者一行）
--   - bra_oblbattle_state：战斗流程状态（每个战场一行）
--
-- qid         先攻队列编号（主键）= 战场编号，与 bra_oblqueue.qid 对应
-- state           战斗状态（IDLE / AWAITING_INPUT / AUTO_PENDING / EXECUTING）
-- round_num       当前轮次，数据库内 0-indexed
-- turn_seq        战场内单调递增的权威回合序号
-- active_pid      当前回合行动者 PID（0=无）
-- opened_at_tick  当前回合开放时的 tick
-- updated_at      最后更新时间戳，用于超时检测和卡死恢复
--

DROP TABLE IF EXISTS bra_oblbattle_state;
CREATE TABLE bra_oblbattle_state (
  `qid` int(11) NOT NULL,
  `state` varchar(20) NOT NULL DEFAULT 'IDLE',
  `round_num` int(11) NOT NULL DEFAULT '0',
  `turn_seq` int(11) NOT NULL DEFAULT '0',
  `active_pid` int(11) NOT NULL DEFAULT '0',
  `opened_at_tick` int(11) NOT NULL DEFAULT '0',
  `updated_at` int(11) NOT NULL DEFAULT '0',
  PRIMARY KEY (`qid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
