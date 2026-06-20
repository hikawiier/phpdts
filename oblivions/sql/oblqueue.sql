--
-- 表的结构 `bra_oblqueue`:
-- Oblivions 战斗队列表
-- pid 唯一 和NPC、玩家的pid对应
-- qid 先攻队列索引编号 拥有同一qid的人都属于同一个先攻队列，同时也保存在自己的bid里
-- type 和NPC、玩家的type对应（玩家是0，NPC是0以上的数，不同type代表不同类的NPC）
-- qorder 当前队伍实时执行顺位，即上一个执行者是第几顺位的
-- myorder 自己的顺位，NPC和玩家在当前先攻队列的顺位，数值越小优先级越高
-- done 在当前先攻队列里是否已行动过 0=没行动 1=行动过
-- 

DROP TABLE IF EXISTS bra_oblqueue;
CREATE TABLE bra_oblqueue (
  `pid` int(11) NOT NULL,
  `qid` int(11) NOT NULL,
  `type` int(11) NOT NULL,
  `qorder` int(11) NOT NULL,
  `myorder` int(11) NOT NULL,
  `done` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`pid`)
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4;
