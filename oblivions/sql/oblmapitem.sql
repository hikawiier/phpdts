--
-- 表的结构 `bra_oblmapitem`
-- Oblivions 模式地图道具实例
-- 生成时从 item_table.php 模板实例化，属性冗余存储（支持强化/损坏/附魔等偏移）
-- 拾取后属性直接映射到 bra_oblplayers.itempara JSON；itm 仅表示实例自定义名，空值由前端 locale 渲染
-- iaid 关联 POI 实例(bra_oblmappoi)，0 表示非 POI 来源（如敌人掉落）
-- source_iaid 区分野生道具(0)与 POI 产出但待拾取道具(>0=POI.iaid)；POI 产出时 source_iaid=iaid=POI.iaid
-- discovered 三态：0=未发现 1=已发现 2=近视(显示假名，实际可能是其他物品或陷阱)
-- fake_item_id 近视时显示的道具ID，空则显示真实item_id的名称+(?)
--

DROP TABLE IF EXISTS bra_oblmapitem;
CREATE TABLE bra_oblmapitem (
  iid mediumint unsigned NOT NULL auto_increment,
  pgroup tinyint unsigned NOT NULL default '0',
  pls tinyint unsigned NOT NULL default '0',
  iaid mediumint unsigned NOT NULL default '0',
    -- 0=野生/丢弃来源；>0=关联 bra_oblmappoi.iaid（POI 掉落）
  source_iaid mediumint unsigned NOT NULL default '0',
    -- 0=野生道具（野生散落 / 玩家丢弃）
    -- >0=该道具由 source_iaid 对应的 POI 产出（已直接物化到 oblmapitem，待拾取）
    -- 与 iaid 的协作：iaid 用于"按 POI 分组查询/响应"；source_iaid 进一步在 POI 产出
    -- 道具上显式标记来源（POI 产出时 source_iaid = iaid = POI.iaid）。
    -- 批量 COUNT 野生道具容量时 WHERE iaid=0 AND source_iaid=0 过滤掉 POI 产出道具。
  item_id varchar(32) NOT NULL default '',
  itm char(30) NOT NULL default '',
  itmk char(40) NOT NULL default '',
  itme int(10) unsigned NOT NULL default '0',
  itms char(10) NOT NULL default '0',
  itmsk char(40) NOT NULL default '',
  itmpara text NOT NULL,
  discovered tinyint(1) unsigned NOT NULL default '0',
  fake_item_id varchar(32) NOT NULL default '',
  is_trap tinyint(1) unsigned NOT NULL default '0',

  PRIMARY KEY (iid),
  INDEX idx_pgroup_pls (pgroup, pls),
  INDEX idx_iaid (iaid),
  INDEX idx_pgroup_pls_iaid_source (pgroup, pls, iaid, source_iaid),
    -- 四列组合索引，支撑按格查询与按 POI 查询路径：
    -- 场景2：obl_state_handle_tile_actions 按格分组 + 区分野生/POI 产出
    -- 场景3：查询某 POI 的待拾取道具 WHERE source_iaid=X AND discovered=1
    -- 注：批量 COUNT 查询（WHERE iaid=0 AND source_iaid=0 GROUP BY pgroup, pls）
    -- 走下方 idx_iaid_source_iaid_pgroup_pls（最左前缀匹配 iaid/source_iaid 等值过滤），
    -- 不走本索引（GROUP BY 列在前、WHERE 列在后时无法用本索引高效过滤）。
  INDEX idx_iaid_source_iaid_pgroup_pls (iaid, source_iaid, pgroup, pls)
    -- 四列组合索引，专门支撑 obl_refresh_wild_items 的批量 COUNT 查询：
    -- SELECT pgroup, pls, COUNT(*) FROM oblmapitem
    --   WHERE iaid=0 AND source_iaid=0 GROUP BY pgroup, pls
    -- 索引前缀 (iaid, source_iaid) 等值匹配 WHERE 双条件，
    -- 后缀 (pgroup, pls) 利用索引有序性避免 GROUP BY 临时表与排序
    -- 也是覆盖索引：查询列都在索引中，无需回表（容量计数 5000 行级 < 10ms）
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
