--
-- 表的结构 `bra_oblmappoi`
-- Oblivions 模式地图兴趣点（POI）实例
-- POI = 可交互的地图实体（宝箱、图腾、地标等）
-- 搜索后按掉落表生成道具，道具存入 bra_oblmapitem（iaid 关联此表 iaid）
-- POI 可见性由图格迷雾状态(bra_oblmapstates.fog)决定，无需单独的 discovered 字段
--

DROP TABLE IF EXISTS bra_oblmappoi;
CREATE TABLE bra_oblmappoi (
  iaid mediumint unsigned NOT NULL auto_increment,
  pgroup tinyint unsigned NOT NULL default '0',
  pls tinyint unsigned NOT NULL default '0',
  poi_id varchar(32) NOT NULL default '',
  searched tinyint(1) unsigned NOT NULL default '0',      -- 0=未搜索 1=已搜索
  search_count tinyint unsigned NOT NULL default '0',
  last_search_turn int unsigned NOT NULL default '0',      -- 上次搜索的回合，用于可重复POI冷却判定

  PRIMARY KEY (iaid),
  INDEX idx_pgroup_pls (pgroup, pls)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
