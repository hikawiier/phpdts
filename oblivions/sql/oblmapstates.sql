--
-- 表的结构 `bra_oblmapstates`
-- Oblivions 模式图格状态表
-- 记录每个图格的实际状态（迷雾、破坏、编辑等）
--

DROP TABLE IF EXISTS bra_oblmapstates;
CREATE TABLE bra_oblmapstates (
  pgroup tinyint unsigned NOT NULL,
  pls tinyint unsigned NOT NULL default '0',
  fog tinyint(1) unsigned NOT NULL default '0',        -- 0=未探索(迷雾) 1=已探索
  damaged tinyint(1) unsigned NOT NULL default '0',     -- 0=完好 1=被破坏
  flags varchar(255) NOT NULL default '',               -- 扩展状态标记(JSON)

  PRIMARY KEY (pgroup, pls)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
