--
-- 表的结构 `bra_oblmapitem`
-- Oblivions 模式地图道具实例
-- 生成时从 item_table.php 模板实例化，属性冗余存储（支持强化/损坏/附魔等偏移）
-- 拾取后属性直接映射到 bra_oblplayers.itempara JSON；itm 仅表示实例自定义名，空值由前端 locale 渲染
-- iaid 关联 POI 实例(bra_oblmappoi)，0 表示非 POI 来源（如敌人掉落）
-- discovered 三态：0=未发现 1=已发现 2=近视(显示假名，实际可能是其他物品或陷阱)
-- fake_item_id 近视时显示的道具ID，空则显示真实item_id的名称+(?)
--

DROP TABLE IF EXISTS bra_oblmapitem;
CREATE TABLE bra_oblmapitem (
  iid mediumint unsigned NOT NULL auto_increment,
  pgroup tinyint unsigned NOT NULL default '0',
  pls tinyint unsigned NOT NULL default '0',
  iaid mediumint unsigned NOT NULL default '0',
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
  INDEX idx_iaid (iaid)
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4;
