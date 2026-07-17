--
-- 表的结构 `bra_oblmappoi`
-- Oblivions 模式地图兴趣点（POI）实例
-- POI = 可交互的地图实体（宝箱、图腾、地标等）
-- 搜索后按掉落表生成道具，道具存入 bra_oblmapitem（iaid 关联此表 iaid）
-- POI 可见性由图格迷雾状态(bra_oblmapstates.fog)决定，无需单独的 discovered 字段
--
-- 状态机：idle → searched →（cooldown / exhausted / 直接 idle）
--   - idle: 可搜索
--   - searched: 已搜索结算，待拾取道具已直接物化到 oblmapitem（source_iaid=本 POI.iaid, discovered=1）
--   - cooldown: 冷却中，等 tick >= cooldown_until_turn
--   - exhausted: 次数耗尽（repeat_limit 达成 / 一次性 POI 已搜索），终态
-- 搜刮结果采用直接物化方案，不在本表暂存 pending_loot / pending_loot_seen。
--

DROP TABLE IF EXISTS bra_oblmappoi;
CREATE TABLE bra_oblmappoi (
  iaid mediumint unsigned NOT NULL auto_increment,
  pgroup tinyint unsigned NOT NULL default '0',
  pls tinyint unsigned NOT NULL default '0',
  poi_id varchar(32) NOT NULL default '',

  -- 状态机（核心）
  state varchar(16) NOT NULL default 'idle',
    -- idle / searched / cooldown / exhausted
    -- varchar(16) 而非 enum：便于未来新增状态无需 ALTER TABLE

  -- 搜索计数与限制
  search_count int unsigned NOT NULL default '0',
    -- 累计搜索次数（保留，便于统计/前端显示）
  search_count_remaining smallint signed NOT NULL default '-1',
    -- 剩余可搜索次数；-1=无限（repeat_limit=0）0=已耗尽 >0=剩余次数
    -- 初始化时从 poi_table.repeat_limit 拷贝：repeat_limit=0 → -1（无限）；repeat_limit>0 → repeat_limit
    -- 搜索结算时：若 =-1 保持不变；若 >0 递减 1，归 0 时转 exhausted
  last_search_turn int unsigned NOT NULL default '0',      -- 上次搜索 tick，用于调试与第三方判定

  -- 冷却
  cooldown_until_turn int unsigned NOT NULL default '0',
    -- state=cooldown 时有效；tick >= cooldown_until_turn 时转 idle
    -- state≠cooldown 时此字段无意义（保留上次值便于调试）

  -- 兼容字段（保留以便平滑迁移；新代码应使用 state）
  searched tinyint(1) unsigned NOT NULL default '0',       -- 0=未搜索 1=已搜索（与 state in ('searched','cooldown','exhausted') 等价）

  PRIMARY KEY (iaid),
  INDEX idx_pgroup_pls (pgroup, pls),
  INDEX idx_state (state)
    -- 支持按状态批量查询（如 tick 末尾批量检查 cooldown 到期）
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
