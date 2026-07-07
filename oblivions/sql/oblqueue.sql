--
-- 表的结构 `bra_oblqueue`:
-- Oblivions 战斗队列表
-- pid 唯一 和NPC、玩家的pid对应
-- qid 先攻队列索引编号 拥有同一qid的人都属于同一个先攻队列，同时也保存在自己的bid里
-- type 和NPC、玩家的type对应（玩家是0，NPC是0以上的数，不同type代表不同类的NPC）
-- last_acted 上一个行动者的 myorder 值（用于日志/调试）
-- myorder 自己的顺位，NPC和玩家在当前先攻队列的顺位，数值越小优先级越高
-- done 在当前先攻队列里是否已行动过 0=没行动 1=行动过
-- active 是否仍在队列中参战 1=可参战 0=已退出（不删行只标记，队列状态稳定）
--

DROP TABLE IF EXISTS bra_oblqueue;
CREATE TABLE bra_oblqueue (
  `pid` int(11) NOT NULL,
  `qid` int(11) NOT NULL,
  `type` int(11) NOT NULL,
  `last_acted` int(11) NOT NULL DEFAULT '0',
  `myorder` int(11) NOT NULL,
  `done` tinyint(1) NOT NULL DEFAULT '0',
  `active` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`pid`)
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4;
