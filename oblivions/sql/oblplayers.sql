--
-- 表的结构 `bra_oblplayers`
-- Oblivions 模式独立玩家表（玩家+敌人统一存储）
-- 参考 bra_players 但精简字段，道具栏改用 JSON 大字段
--

DROP TABLE IF EXISTS bra_oblplayers;
CREATE TABLE bra_oblplayers (
  -- 身份与认证
  pid          smallint unsigned NOT NULL auto_increment,
  type         tinyint NOT NULL default '0',       -- 0=玩家, >0=敌人类型
  name         char(40) NOT NULL default '',
  pass         char(32) NOT NULL default '',       -- 双重校验（与 user 表）
  gd           char(1) NOT NULL default 'm',
  icon         varchar(255) NOT NULL default '0',

  -- 战斗状态
  action       char(12) NOT NULL default '',       -- null/prebattle/battle
  bid          smallint unsigned NOT NULL default '0',  -- 先攻队列编号 qid（= 战场编号，0=不在战斗）

  -- 属性
  hp           int(10) unsigned NOT NULL DEFAULT '0',
  mhp          int(10) unsigned NOT NULL DEFAULT '0',
  sp           int(10) unsigned NOT NULL DEFAULT '0',
  msp          int(10) unsigned NOT NULL DEFAULT '0',
  att          int(10) unsigned NOT NULL DEFAULT '0',
  def          int(10) unsigned NOT NULL DEFAULT '0',

  -- AP（战斗系统用，独立字段便于频繁读写）
  ap           int(10) NOT NULL DEFAULT '0',
  max_ap       int(10) NOT NULL DEFAULT '10',

  -- 位置
  pgroup       tinyint unsigned NOT NULL DEFAULT '0',
  pls          tinyint unsigned NOT NULL default '0',

  -- 进度
  lvl          tinyint unsigned NOT NULL default '0',
  exp          smallint unsigned NOT NULL default '0',
  state        tinyint unsigned NOT NULL default '0',  -- 含义待定，先保留

  -- 装备（7 槽 × ID + 6 运行时字段）
  wepid varchar(32) NOT NULL default '', wep char(30) NOT NULL default '', wepk char(40) not null default '', wepe int(10) unsigned NOT NULL DEFAULT '0', weps char(10) not null default '0', wepsk char(40) not null default '', weppara text not null,
  wep2id varchar(32) NOT NULL default '', wep2 char(30) NOT NULL default '', wep2k char(40) not null default '', wep2e int(10) unsigned NOT NULL DEFAULT '0', wep2s char(10) not null default '0', wep2sk char(40) not null default '', wep2para text not null,
  arbid varchar(32) NOT NULL default '', arb char(30) NOT NULL default '', arbk char(40) not null default '', arbe int(10) unsigned NOT NULL DEFAULT '0', arbs char(10) not null default '0', arbsk char(40) not null default '', arbpara text not null,
  arhid varchar(32) NOT NULL default '', arh char(30) NOT NULL default '', arhk char(40) not null default '', arhe int(10) unsigned NOT NULL DEFAULT '0', arhs char(10) not null default '0', arhsk char(40) not null default '', arhpara text not null,
  araid varchar(32) NOT NULL default '', ara char(30) NOT NULL default '', arak char(40) not null default '', arae int(10) unsigned NOT NULL DEFAULT '0', aras char(10) not null default '0', arask char(40) not null default '', arapara text not null,
  arfid varchar(32) NOT NULL default '', arf char(30) NOT NULL default '', arfk char(40) not null default '', arfe int(10) unsigned NOT NULL DEFAULT '0', arfs char(10) not null default '0', arfsk char(40) not null default '', arfpara text not null,
  artid varchar(32) NOT NULL default '', art char(30) NOT NULL default '', artk char(40) not null default '', arte int(10) unsigned NOT NULL DEFAULT '0', arts char(10) not null default '0', artsk char(40) not null default '', artpara text not null,

  -- 道具栏（JSON 大字段，替代 itm0~itm6；遵循旧字段命名 + itmid）
  itempara     mediumtext NOT NULL,    -- 道具栏数据（JSON 数组）
  itemmaxslots tinyint unsigned NOT NULL default '6',  -- 道具栏最大格数（初始 6 格）

  -- Oblivions 专属（JSON 字段）
  tacpara      mediumtext NOT NULL,    -- 策略槽（JSON）
  skillpara    mediumtext NOT NULL,    -- 技能数据（JSON）
  oblpara      mediumtext NOT NULL,    -- 杂项功能数据（JSON）
  discovered   tinyint NOT NULL default '0',  -- 0=未发现, 1=已发现（敌人用）

  PRIMARY KEY  (pid),
  INDEX TYPE (type),
  INDEX NAME (name, type)
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4;
