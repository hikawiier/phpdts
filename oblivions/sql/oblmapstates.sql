--
-- 表的结构 `bra_oblmapstates`
-- Oblivions 模式图格状态表
-- 记录每个图格的实际状态（迷雾、破坏、编辑等）
-- 野生道具刷新状态（last_refresh_turn / refresh_count）由本表统一管理；
-- 容量计数采用批量 COUNT 方案，不维护冗余 wild_item_count 字段。
--

DROP TABLE IF EXISTS bra_oblmapstates;
CREATE TABLE bra_oblmapstates (
  pgroup tinyint unsigned NOT NULL,
  pls tinyint unsigned NOT NULL default '0',
  fog tinyint(1) unsigned NOT NULL default '0',        -- 0=未探索(迷雾) 1=已探索
  damaged tinyint(1) unsigned NOT NULL default '0',     -- 0=完好 1=被破坏（未启用：未来地形破坏系统使用）
  flags varchar(255) NOT NULL default '',               -- 扩展状态标记(JSON)（未启用：未来扩展点）

  -- 野生道具刷新状态（iaid=0 AND source_iaid=0 的野生道具，容量计数走批量 COUNT 方案）
  last_refresh_turn int unsigned NOT NULL default '0',  -- 上次该格野生道具刷新的 tick；0=从未刷新
  refresh_count smallint unsigned NOT NULL default '0', -- 该格累计野生道具刷新次数（统计/调试用）

  PRIMARY KEY (pgroup, pls)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
