# GLOBALS — 全局变量词典

> 本文档列出项目中所有全局变量，帮助 AI 追踪数据流。
> **速查索引见下方，跳转到对应章节即可。不需要全读。**

---

## 速查索引

| 找什么 | 去第几节 | 典型变量 |
|--------|----------|----------|
| 数据库连接、表前缀、密码相关 | [一](#一基础设施变量) / [二](#二定义来源) | `$db`, `$tablepre`, `$dbhost` |
| 当前用户/登录态 | [三](#三用户认证变量) | `$cuser`, `$cpass`, `$udata` |
| 游戏版本、房间设定、定时开始 | [四](#四游戏系统设定) | `$gameversion`, `$startmode`, `$iplimit` |
| 游戏状态、禁区、幸存者数、天气 | [五](#五游戏运行时状态) | `$gamestate`, `$areanum`, `$alivenum`, `$weather` |
| 请求参数（mode/command/action） | [六](#六请求参数变量) | `$mode`, `$command`, `$itemcmd` |
| 玩家属性（HP/SP/攻击/防御/等级） | [七](#七玩家数据变量) | `$hp`, `$att`, `$def`, `$lvl`, `$money` |
| 装备栏（武器/防具/饰品） | [七-装备栏](#装备栏) | `$wep`, `$arb`, `$arh`, `$ara`, `$arf`, `$art` |
| 6 格物品栏 | [七-6格物品栏](#6-格物品栏itm--itmk--itme--itms--itmsk--itmpara) | `$itm1`~`$itm6`, `$itmk1`~`$itmk6` |
| 临时手持道具槽（探索拾取） | [七-临时手持道具槽](#临时手持道具槽itm0-系列) | `$itm0`, `$itmk0`, `$itme0` |
| 额外背包 | [七-额外背包](#额外背包) | `$extrabag`, `$extrabag_num`, `$extrabag_max` |
| 游戏核心配置（血量上限/概率/冷却） | [八](#八游戏配置变量) | `$hp_limit`, `$sp_limit`, `$coldtimeon` |
| 资源数据（地点/物品/天气信息模板） | [九](#九资源数据变量) | `$plsinfo`, `$iteminfo`, `$typeinfo` |
| 战斗配置（命中/伤害/射程/反击/天气…） | [十三](#十三战斗系统变量) | `$hitrate_obbs`, `$skill_dmg`, `$counter_obbs` |
| 战斗运行时状态（pa/pd 数组） | [十三-运行时](#战斗运行时临时变量) | `$pa['hitrate']`, `$pa['final_damage']` |
| clbpara 全部键（技能/任务/成就/BGM…） | [十四](#十四clbpara-结构详解) | `$clbpara['skill']`, `$clbpara['quest']` |
| 搜索记忆/视野（smeo） | [十四-smeo](#探索视野--搜索记忆系统smeo) | `$clbpara['smeo']` |
| 日志输出/错误/调试变量 | [十五](#十五其他特殊变量) | `$log`, `$main`, `$error` |

---

## 一、定义来源

全局变量通过以下方式进入作用域：

| 来源 | 机制 | 示例 |
|------|------|------|
| `config.inc.php` | 直接 `$var = value` | `$dbhost`, `$tablepre`, `$authkey` |
| `gamedata/system.php` | 直接 `$var = value` | `$gameversion`, `$gamecfg`, `$startmode` |
| `include/common.inc.php` | 定义常量 + 初始化变量 | `$now`, `$db`, `$gtablepre`, `$cuser` |
| `config('gamecfg')` | require 配置文件 | `$hp_limit`, `$sp_limit`, `$startmin`... |
| `config('resources')` | require 配置文件 | `$plsinfo`, `$hplsinfo`, `$wthinfo`... |
| `config('combatcfg')` | require 配置文件 | `$movesp`, `$movehp`, `$infwords`... |
| `load_gameinfo()` | 从数据库加载 | `$gamestate`, `$areanum`, `$alivenum`... |
| `extract($pdata)` | 从玩家数据提取 | `$pid`, `$name`, `$hp`, `$itm1`... |
| `extract($_POST/$_GET)` | 从请求提取 | `$mode`, `$command`, `$action`... |

---

## 二、基础设施变量

> 定义于 `config.inc.php` → `include/common.inc.php`

| 变量 | 类型 | 定义位置 | 说明 |
|------|------|----------|------|
| `$dbhost` | string | `config.inc.php` | 数据库服务器地址 |
| `$dbuser` | string | `config.inc.php` | 数据库用户名 |
| `$dbpw` | string | `config.inc.php` | 数据库密码（用后 unset） |
| `$dbname` | string | `config.inc.php` | 数据库名 |
| `$tablepre` | string | `config.inc.php` | 表前缀，如 `acbra3_`。小房间变为 `acbra3_s{id}_` |
| `$gtablepre` | string | `common.inc.php` | 全局表前缀（主数据库表前缀） |
| `$database` | string | `config.inc.php` | 数据库驱动：`mysql`/`mysqli`/`pdo` |
| `$authkey` | string | `config.inc.php` | 加密密钥 |
| `$charset` | string | `config.inc.php` | 字符集：`utf-8`/`gbk`/`big5` |
| `$dbcharset` | string | `config.inc.php` | 数据库字符集：`utf8mb4`/`utf8`/`gbk` |
| `$db` | object | `common.inc.php` | 数据库连接对象（`dbstuff` 实例） |
| `$now` | int | `common.inc.php` | 当前时间戳（含时区偏移） |
| `$errorinfo` | int | `config.inc.php` | 是否显示错误信息：0=关闭, 1=开启 |
| `$pconnect` | bool | `config.inc.php` | 是否持久连接 |
| `$gamefounder` | string | `config.inc.php` | 游戏创始人用户名 |
| `$salt` | string | `config.inc.php` | 密码盐值 |

---

## 三、用户认证变量

> 定义于 `include/common.inc.php`（从 Cookie 提取）

| 变量 | 类型 | 说明 |
|------|------|------|
| `$cuser` | string | 当前登录用户名（从 Cookie） |
| `$cpass` | string | 当前登录密码（从 Cookie） |
| `$udata` | array | 当前用户数据（从 `users` 表查询） |

---

## 四、游戏系统设定

> 定义于 `gamedata/system.php`

| 变量 | 类型 | 说明 |
|------|------|------|
| `$gameversion` | string | 游戏版本号，如 `GE942 ～TORONTO` |
| `$gamecfg` | int | 配置文件版本号，默认 `1` |
| `$startmode` | int | 游戏开始方式：0=手动, 1=定时, 2=间隔小时, 3=间隔分钟 |
| `$starthour` | int | 开始小时/间隔小时 |
| `$startmin` | int | 开始分钟/间隔分钟 |
| `$iplimit` | int | 同 IP 限制激活人数，0=不限制 |
| `$iconlimit` | int | 头像数量限制 |
| `$newslimit` | int | 游戏进行状况显示条数 |
| `$alivelimit` | int | 生存者显示条数 |
| `$ranklimit` | int | 排行榜显示条数 |
| `$winlimit` | int | 历史优胜者显示条数 |
| `$noiselimit` | int | 枪声间隔时间（秒） |
| `$chatlimit` | int | 聊天信息显示条数 |
| `$chatrefresh` | int | 聊天刷新间隔（毫秒） |
| `$chatinnews` | int | 新闻区显示聊天条数，0=不显示 |
| `$allowcsscache` | int | 是否缓存 CSS：0=不缓存, 1=缓存 |
| `$checkstr` | string | 文件验证字符串 |
| `$tplrefresh` | int | 模板自动刷新：0=关闭, 1=打开 |

---

## 五、游戏运行时状态

> 定义于 `include/common.inc.php`，通过 `load_gameinfo()` 从数据库加载

| 变量 | 类型 | 说明 |
|------|------|------|
| `$groomid` | int | 当前房间 ID，0=主房间，>0=小房间 |
| `$gamenum` | int | 当前游戏局数 |
| `$gamestate` | int | 游戏状态：0=等待, 10=准备, 20=进行, 30=停止激活, 40=连斗 |
| `$starttime` | int | 游戏开始/预计开始时间戳 |
| `$lastupdate` | int | 最后更新时间戳 |
| `$winmode` | int | 胜利模式 |
| `$winner` | string | 胜利者名称 |
| `$validnum` | int | 已激活玩家数 |
| `$alivenum` | int | 存活玩家数 |
| `$deathnum` | int | 死亡玩家数 |
| `$areanum` | int | 当前禁区编号 |
| `$areatime` | int | 下次增加禁区时间戳 |
| `$areawarn` | int | 是否已发出禁区警告 |
| `$arealist` | array | 禁区列表 |
| `$weather` | int | 当前天气 |
| `$hack` | int | 当前禁区的 Hack 率 |
| `$combonum` | int | 连斗触发所需死亡数 |
| `$gamevars` | array | 游戏通用变量 |
| `$afktime` | int | 上次反挂机检查时间 |
| `$optime` | int | 操作时间 |
| `$hdamage` | int | 当前游戏局内由玩家造成过的最高伤害值 |
| `$hplayer` | string | 当前游戏局内造成最高伤害玩家 |
| `$noisetime` | int | 游戏内功能：玩家制造的声音信息传出的时间 |
| `$noisepls` | string | 游戏内功能：玩家制造的声音信息来源地点 |
| `$noiseid` | int | 游戏内功能：玩家制造的声音信息来源 1 |
| `$noiseid2` | int | 游戏内功能：玩家制造的声音信息来源 2 |
| `$noisemode` | string | 游戏内功能：玩家制造的声音信息类型 |
| `$groomnums` | int | 房间内玩家数 |
| `$groomownid` | int | 房间所有者 ID |
| `$gruleset` | string | 房间使用的 RuleSet ID |
| `$rdown` | int | 待废弃的变量 |
| `$bdown` | int | 待废弃的变量 |
| `$ldown` | int | 待废弃的变量 |
| `$kdown` | int | 待废弃的变量 |

---

## 六、请求参数变量

> 定义于 `include/common.inc.php`（`extract($_POST)` + `extract($_GET)`）

| 变量 | 类型 | 说明 |
|------|------|------|
| `$mode` | string | 当前操作模式（核心分发变量），如 `command`、`revcombat`、`itemmain` |
| `$command` | string | 指令名称，如 `move`、`search`、`itemmain`、`rest` |
| `$action` | string | 动作名称，如 `chase`、`tpmove` |
| `$cmd` | string | 子命令 |
| `$itemcmd` | string | 物品子命令，如 `itemmix`、`elementmix` |
| `$sp_cmd` | string | 特殊技能子命令 |
| `$moveto` | string | 移动目标地点 |
| `$bid` | int | 战斗/交互目标 ID |
| `$sub` | string | 子参数 |

---

## 七、玩家数据变量

> 定义于 `extract($pdata)` 后，来自 `players` 表字段

### 基础属性

| 变量 | 字段 | 说明 |
|------|------|------|
| `$pid` | `pid` | 玩家 ID |
| `$name` | `name` | 玩家名称 |
| `$nick` | `nick` | 玩家昵称 |
| `$type` | `type` | 类型：0=PC, 1=NPC |
| `$gd` | `gd` | 性别：`m`=男, `f`=女 |
| `$icon` | `icon` | 头像编号 |
| `$hp` | `hp` | 当前生命值 |
| `$mhp` | `mhp` | 最大生命值 |
| `$sp` | `sp` | 当前体力值 |
| `$msp` | `msp` | 最大体力值 |
| `$att` | `att` | 攻击力 |
| `$def` | `def` | 防御力 |
| `$lvl` | `lvl` | 等级 |
| `$exp` | `exp` | 经验值 |
| `$money` | `money` | 金钱 |
| `$pls` | `pls` | 当前位置 |
| `$state` | `state` | 状态值 |
| `$club` | `club` | 社团编号 |
| `$killnum` | `killnum` | 击杀数 |
| `$deathtime` | `deathtime` | 死亡时间 |
| `$endtime` | `endtime` | 上次操作时间 |

### 装备栏

| 变量 | 字段 | 说明 |
|------|------|------|
| `$wep` | `wep` | 武器 |
| `$wep2` | `wep2` | 副武器 |
| `$arb` | `arb` | 身体防具 |
| `$arh` | `arh` | 头部防具 |
| `$ara` | `ara` | 手臂防具 |
| `$arf` | `arf` | 腿部防具 |
| `$art` | `art` | 饰品 |

### 6 格物品栏（`itm` + `itmk` + `itme` + `itms` + `itmsk` + `itmpara`）

| 变量 | 字段 | 说明 |
|------|------|------|
| `$itm1`~`$itm6` | `itm1`~`itm6` | 物品名称 |
| `$itmk1`~`$itmk6` | `itmk1`~`itmk6` | 物品类别 |
| `$itme1`~`$itme6` | `itme1`~`itme6` | 物品效果值 |
| `$itms1`~`$itms6` | `itms1`~`itms6` | 物品耐久 |
| `$itmsk1`~`$itmsk6` | `itmsk1`~`itmsk6` | 物品特殊属性 |
| `$itmpara1`~`$itmpara6` | `itmpara1`~`itmpara6` | 物品参数（JSON） |

### 临时手持道具槽（`itm0` 系列）

> `$itm0` 系列存储在 `players` 表（`itm0`, `itmk0`, `itme0`, `itms0`, `itmsk0`, `itmpara0` 字段）。
> 当玩家在探索中发现道具时，系统将其装入 `itm0` 系列作为"拿在手上待处理"的临时槽位。
> 处理完毕后（拾取/丢弃/触发陷阱），通过 `itemget()` 将道具转入背包或触发陷阱效果，
> 然后清空 itm0 系列。

| 变量 | 字段 | 类型 | 说明 |
|------|------|------|------|
| `$itm0` | `itm0` | char(30) | 临时持有的道具名称（探索发现道具/陷阱时赋值） |
| `$itmk0` | `itmk0` | char(40) | 临时持有的道具类别（`TO` 开头=陷阱类） |
| `$itme0` | `itme0` | int | 临时持有的道具效果值 |
| `$itms0` | `itms0` | char(10) | 临时持有的道具耐久（0=无效道具，不触发拾取） |
| `$itmsk0` | `itmsk0` | char(40) | 临时持有的道具特殊属性（陷阱场景下存储设置者 PID） |
| `$itmpara0` | `itmpara0` | text | 临时持有的道具参数（JSON） |

### 额外背包

| 变量 | 字段 | 说明 |
|------|------|------|
| `$extrabag` | `extrabag` | 额外背包物品列表（JSON） |
| `$extrabag_put` | `extrabag_put` | 要从额外背包中取出特定道具时，将道具信息暂存在此 |
| `$extrabag_num` | `extrabag_num` | 额外背包当前物品数 |
| `$extrabag_max` | `extrabag_max` | 额外背包容量上限 |

### 其他玩家数据

| 变量 | 字段 | 说明 |
|------|------|------|
| `$clbpara` | `clbpara` | 社团参数（JSON，含技能、任务状态等）详见 AI看到了补充一个跳转在这 |
| `$club` | `club` | 社团编号 |
| `$wd` | `wd` | 武器熟练度 |
| `$ss` | `ss` | 子技能点 |
| `$sNo` | `sNo` | 初始编号 |
| `$coldtimeon` | `coldtimeon` | 冷却时间开关 |
| `$cdtime` | `cdtime` | 冷却结束时间戳 |
| `$cdsec` | `cdsec` | 冷却秒数 |
| `$cdmsec` | `cdmsec` | 冷却毫秒数 |

---

## 八、游戏配置变量

> 定义于 `config('gamecfg')` 加载的 `gamedata/cache/gamecfg_1.php`

| 变量 | 类型 | 说明 |
|------|------|------|
| `$hp_limit` | int | 初始生命值上限 |
| `$sp_limit` | int | 初始体力值上限 |
| `$baseexp` | int | 基础经验值（影响升级经验曲线） |
| `$startmin` | int | 游戏开始准备时间 |
| `$movesp` | int | 移动消耗体力 |
| `$movehp` | int | 移动消耗生命 |
| `$inf_move_sp` | int | 受伤时移动消耗体力 |
| `$inf_move_hp` | int | 受伤时移动消耗生命 |
| `$coldtimeon` | int | 冷却时间开关 |
| `$movecoldtime` | int | 移动冷却时间 |
| `$searchcoldtime` | int | 探索冷却时间 |
| `$itemusecoldtime` | int | 物品使用冷却时间 |
| `$hack_obbs` | int | Hack 概率 |
| `$event_obbs` | int | 事件触发概率 |
| `$item_obbs` | int | 物品发现概率 |
| `$enemy_obbs` | int | 遇敌概率 |
| `$trap_min_obbs` | int | 最小陷阱概率 |
| `$trap_max_obbs` | int | 最大陷阱概率 |
| `$corpse_obbs` | int | 尸体发现概率 |
| `$corpseprotect` | int | 尸体保护时间（用于判断是否可以销毁尸体） |
| `$combolimit` | int | 连斗触发人数上限 |
| `$validlimit` | int | 激活人数上限 |
| `$deathlimit` | int | 死亡人数基础值 |
| `$deathdeno` | int | 死亡人数分母（连斗公式参数） |
| `$deathnume` | int | 死亡人数额外系数 |
| `$arealimit` | int | 禁区增加次数上限（`$areanum >= $arealimit * $areaadd` 时停止激活） |
| `$areahour` | int | 禁区增加间隔（小时） |
| `$areaadd` | int | 禁区增加因子 |
| `$areawarntime` | int | 禁区警告提前时间 |
| `$antiAFKertime` | int | 反挂机检查间隔 |
| `$rsgame_bots` | int | 每局自动部署 Bot 数量 |
| `$allow_semo` | int | 搜索记忆/视野系统开关（0=关闭, 1=启用） |
| `$smeo_max` | int | 搜索记忆最大容量（默认 3），超出时自动移除最旧记忆 |
| `$allow_destory_corpse` | int | 是否允许销毁尸体 |
| `$no_destory_corpse_type` | array | 不允许销毁的尸体类型 |
| `$rpup_destory_corpse` | int | 销毁尸体 RP 提升 |

> **注意**：`$shops`、`$hospitals`、`$wthinfo`、`$infwords` 虽在游戏逻辑中与 gamecfg 变量一起使用，但实际定义于 `resources_1.php`（见第九节）。`$weather` 是运行时变量，由 `load_gameinfo()` 从数据库 `game` 表加载（见第五节）。

---

## 九、资源数据变量

> 定义于 `config('resources')` 加载的 `gamedata/cache/resources_1.php`

| 变量 | 类型 | 说明 |
|------|------|------|
| `$plsinfo` | array | 地点信息（名称、描述） |
| `$hplsinfo` | array | 隐藏地点信息 |
| `$pls_bgm` | array | 地点背景音乐 |
| `$typeinfo` | array | 玩家类型信息 |
| `$noiseinfo` | array | 玩家制造的声音类型信息 |
| `$iteminfo` | array | 物品类别（itmk）信息 |
| `$itemspkinfo` | array | 物品特殊属性（itmsk）信息 |
| `$cskills` | array | 社团技能全定义信息 |
| `$tps_name` | array | 仅供tooltip 根据道具名显示tooltip |
| `$tps_names` | array | 仅为$tps_name提供道具名索引 |
| `$tps_name_lore` | array | 仅供tooltip 根据道具名显示lore相关tooltip |
| `$tps_ik` | array | 仅供tooltip 根据道具类别显示tooltip |
| `$tps_isk` | array | 仅供tooltip 根据道具特殊属性显示tooltip |
| `$noitm` | array | 道具栏无道具时固定显示的文本 仅供旧模板使用 |
| `$nospk` | array | 道具栏无特殊属性时固定显示的文本 仅供旧模板使用 |
| `$horizon` | array | 游戏内特殊功能：视界 |
| `$emdata` | array | 用于存放聊天功能要用到的表情图片url与其他信息 |
| `$elements_info` | array | 社团20元素大师的专有变量 |
| `$syschatinfo` | array | 待废弃系统 |
| `$chatinfo` | array | 系统广播时的类别前缀 |

---

## 十、战斗配置变量

> 定义于 `config('combatcfg')` 加载的 `gamedata/cache/combatcfg_1.php`

| 变量 | 类型 | 说明 |
|------|------|------|
| `$nowep` | int | 无武器时时显示的武器名 仅旧模板使用 |
| `$noarb` | int | 无防具时的显示的防具名 仅旧模板使用|
| `$nosta` | int | 输入特殊符号无限的替代方案 |

---

## 十一、日志与输出变量

| 变量 | 类型 | 说明 |
|------|------|------|
| `$log` | string | **游戏日志缓冲区**（HTML 字符串），几乎所有操作都会追加内容 |
| `$main` | string | 主界面内容区 |
| `$cmd` | string | 当前命令 |
| `$actlog` | string | 行为日志 |
| `$gamedata` | array | AJAX 返回数据（`command.php` 输出） |
| `$error` | string | 错误信息 |

---

## 十二、物品合成相关变量

| 变量 | 类型 | 说明 |
|------|------|------|
| `$itemindex` | array | 物品合成索引 |
| `$syncn` | string | 合成物品名称 |
| `$synck` | string | 合成物品类别 |
| `$synce` | int | 合成物品效果 |
| `$syncs` | int | 合成物品耐久 |
| `$syncsk` | string | 合成物品特殊属性 |
| `$sync` | array | 合成配方 |
| `$reqname` | string | 需求物品名称 |
| `$star` | int | 物品星级 |
| `$itm0` | string | 手中物品（临时持有） |
| `$itmk0` | string | 手中物品类别 |
| `$itme0` | int | 手中物品效果 |
| `$itms0` | int | 手中物品耐久 |
| `$itmsk0` | string | 手中物品特殊属性 |
| `$itmpara0` | string | 手中物品参数 |

---
## 十三、战斗系统变量

> 战斗属性计算由 revattr 系列处理（`revattr.func.php` / `revattr.calc.php` / `revattr_extra.func.php`），
> 战斗主流程由 revcombat 系列处理（`revcombat.func.php` / `revcombat.calc.php` / `revcombat_extra.func.php`），
> 前端渲染由 `revbattle.func.php` / `revbattle.calc.php` 处理。
> 以下变量来自 `config('resources')`、`config('gamecfg')`、`config('combatcfg')`。

### 战斗流程核心变量

| 变量 | 类型 | 定义来源 | 说明 |
|------|------|----------|------|
| `$battle_title` | string | `revcombat.func.php` | 战斗界面标题，如「战斗发生」「遭遇突袭」 |
| `$attinfo` | array | `config('resources')` | 攻击方式描述文本，key 为 `wep_kind`（`N`=殴打, `K`=斩击, `G`=射击, `D`=投掷, `F`=灵力, `C`=爆系, `P`=殴符, `J`=符卡, `B`=弓系） |
| `$skillinfo` | array | `config('resources')` | 武器种类 → 熟练度字段名映射（`N`→`wd`, `K`→`wk`, `G`→`wg`, `D`→`wc`, `F`→`wf`, `C`→`wd`, `J`→`wj`, `B`→`wb`） |
| `$nosta` | int | `config('combatcfg')` | 无状态时的基础值（攻击/防御基准） |
| `$infinfo` | array | `config('resources')` | 异常状态信息（名称、效果描述等） |
| `$infobbs` | array | `config('combatcfg')` | 各攻击方式的基础异常状态触发概率（key=`wep_kind`，值=百分比） |
| `$infatt` | string[] | `config('combatcfg')` | 各攻击方式可造成的异常状态标记列表（key=`wep_kind`，值如 `'bhaf'`，顺序=头/身体/手臂/脚） |
| `$infatt_rev` | array | `config('combatcfg')` | `$infatt` 的逆转形式，key=`wep_kind`，值=`['b','h','a','f']` |
| `$inf_att_p` | array | `config('combatcfg')` | 各异常状态对攻击力的惩罚系数（`a`=0.75, `u`=0.6） |
| `$inf_def_p` | array | `config('combatcfg')` | 各异常状态对防御力的惩罚系数（`b`=0.75, `i`=0.9, `w`=0.75） |
| `$inf_htr_p` | array | `config('combatcfg')` | 各异常状态对命中率的惩罚系数（`h`=0.75, `i`=0.8, `e`=0.9） |
| `$inf_active_p` | array | `config('combatcfg')` | 各异常状态对先制率的惩罚系数（`i`=0.9, `e`=0.2, `w`=0.8） |
| `$inf_counter_p` | array | `config('combatcfg')` | 各异常状态对反击率的惩罚系数（`i`=0.9, `e`=0.2, `w`=0.8） |
| `$wepimprate` | array | `config('combatcfg')` | 各攻击方式的武器改进成功率，-1=不可改进（`N`→-1, `P`→12, `K`→30…） |
| `$specialrate` | array | `config('combatcfg')` | 特殊攻击触发率（`N`=40, `n`=30, `y`=30, `B`=95, `b`=95） |
| `$elements_info` | array | `config('resources')` | 元素大师系统：元素信息（名称、分类、属性效果等） |
| `$r_elements_info` | array | `config('resources')` | 元素大师系统：逆元素信息（弱点映射表） |

### 命中率系统

> 由 `get_hitrate_rev()` 计算

| 变量 | 类型 | 定义来源 | 说明 |
|------|------|----------|------|
| `$hitrate_obbs` | array | `config('combatcfg')` | 各攻击方式的基础命中率（`N`=80, `K`=75, `G`=70…key=`wep_kind`） |
| `$hitrate_max_obbs` | array | `config('combatcfg')` | 各攻击方式的最高命中率（`N`=90, `K`=85, `G`=95…） |
| `$hitrate_r` | array | `config('combatcfg')` | 熟练度对命中的影响系数（每点熟练增加的命中率） |

### 射程系统

> 由 `get_wep_range()` 计算

| 变量 | 类型 | 定义来源 | 说明 |
|------|------|----------|------|
| `$rangeinfo` | array | `config('combatcfg')` | 各攻击方式的射程（`N`=3, `K`=3, `G`=7, `D`=0, `F`=1…`D`=0不可反击任何系也不可被任何系反击） |

### 物理伤害系统

> 由 `get_base_dmg_rev()` / `get_original_dmg_rev()` 计算

| 变量 | 类型 | 定义来源 | 说明 |
|------|------|----------|------|
| `$skill_dmg` | array | `config('combatcfg')` | 各攻击方式的熟练度对伤害的系数（`N`=0.6, `K`=0.65, `G`=0.6…key=`wep_kind`） |
| `$dmg_fluc` | array | `config('combatcfg')` | 各攻击方式的伤害浮动范围（`N`=15, `K`=40, `C`=5…越小越稳定） |
| `$def_kind` | array | `config('combatcfg')` | 各攻击方式对应的防御属性（`N`→`P`, `K`→`K`, `G`→`G`, `D`→`D`, `F`→`F`, `C`→`C`…） |

### 天气修正变量

> 由 `get_weather_modifier()` 读取，key 为天气编号（0=晴天, 1=大晴, 2=多云…18=光玉雨）

| 变量 | 类型 | 定义来源 | 说明 |
|------|------|----------|------|
| `$weather_attack_modifier` | array | `config('combatcfg')` | 天气对攻击力的影响（百分比加算，如晴+10, 暴雨-10, 暴风雪-20） |
| `$weather_defend_modifier` | array | `config('combatcfg')` | 天气对防御力的影响（百分比加算，如大晴+30, 起雾-20, 瘴气-50） |
| `$weather_find_r` | array | `config('combatcfg')` | 天气对发现率的修正（大晴+20, 浓雾-8, 光玉雨+25） |
| `$weather_hide_r` | array | `config('combatcfg')` | 天气对隐藏率的修正 |
| `$weather_active_r` | array | `config('combatcfg')` | 天气对先制率的修正 |

### 姿态修正变量

> 姿态编号：0=通常, 1=作战, 2=强袭, 3=探索, 4=治疗, 5=专守, 6=躲避, 7=投降

| 变量 | 类型 | 定义来源 | 说明 |
|------|------|----------|------|
| `$pose_attack_active` | int | `config('combatcfg')` | 姿态攻击修正是否启用（0=关闭, 非0=启用，如为0以下 modifier 数组无效） |
| `$pose_attack_modifier` | array | `config('combatcfg')` | 各姿态对攻击力的修正值（百分比加算，key=姿态编号） |
| `$pose_defend_active` | int | `config('combatcfg')` | 姿态防御修正是否启用 |
| `$pose_defend_modifier` | array | `config('combatcfg')` | 各姿态对防御力的修正值 |
| `$pose_find_modifier` | array | `config('combatcfg')` | 各姿态对发现率的修正值 |
| `$pose_hide_modifier` | array | `config('combatcfg')` | 各姿态对隐藏率的修正值 |
| `$pose_active_modifier` | array | `config('combatcfg')` | 各姿态对先制率的修正值 |
| `$pose_counter_modifier` | array | `config('combatcfg')` | 各姿态对反击率的修正值 |

### 策略修正变量

> 策略编号：0=通常, 1=重视攻击, 2=重视防御, 3=重视探索, 4=重视治疗

| 变量 | 类型 | 定义来源 | 说明 |
|------|------|----------|------|
| `$tactic_attack_active` | int | `config('combatcfg')` | 策略攻击修正是否启用（0=关闭） |
| `$tactic_attack_modifier` | array | `config('combatcfg')` | 各策略对攻击力的修正值（百分比加算，key=策略编号） |
| `$tactic_defend_active` | int | `config('combatcfg')` | 策略防御修正是否启用 |
| `$tactic_defend_modifier` | array | `config('combatcfg')` | 各策略对防御力的修正值 |
| `$tactic_hide_modifier` | array | `config('combatcfg')` | 各策略对隐藏率的修正值 |
| `$tactic_active_modifier` | array | `config('combatcfg')` | 各策略对先制率的修正值 |
| `$tactic_counter_modifier` | array | `config('combatcfg')` | 各策略对反击率的修正值 |

### 地点修正变量

> key 为地点编号（如 0=无月, 1=端点, 2=RF高校…）

| 变量 | 类型 | 定义来源 | 说明 |
|------|------|----------|------|
| `$pls_attack_modifier` | array | `config('combatcfg')` | 各地点的攻击力修正（百分比加算） |
| `$pls_defend_modifier` | array | `config('combatcfg')` | 各地点的防御力修正（百分比加算） |
| `$pls_find_modifier` | array | `config('combatcfg')` | 各地点的发现率修正 |
| `$pls_hide_modifier` | array | `config('combatcfg')` | 各地点的隐藏率修正 |

### 反击系统变量

> 由 `get_counter()` 计算

| 变量 | 类型 | 定义来源 | 说明 |
|------|------|----------|------|
| `$counter_obbs` | array | `config('combatcfg')` | 各攻击方式的基础反击概率（`N`=75, `K`=85, `G`=50, `D`=0不可反击…） |
| `$pose_counter_modifier` | array | `config('combatcfg')` | 姿态对反击率的修正（5=专守 -100, 7=投降 -100） |
| `$tactic_counter_modifier` | array | `config('combatcfg')` | 策略对反击率的修正（2=重防 +30） |

### 追击/鏖战系统变量

| 变量 | 类型 | 定义来源 | 说明 |
|------|------|----------|------|
| `$chase_obbs` | int | `config('gamecfg')` | 追击触发概率（百分比） |
| `$dfight_obbs` | int | `config('gamecfg')` | 鏖战触发概率（百分比） |
| `$chase_escape_obbs` | int | `config('gamecfg')` | 追击中逃跑成功概率 |

### 先制率计算变量

> 由 `get_active_obbs()` 计算

| 变量 | 类型 | 定义来源 | 说明 |
|------|------|----------|------|
| `$active_obbs` | int | `config('gamecfg')` | 基础先制率（百分比） |
| `$chase_active_obbs` | int | `config('gamecfg')` | 追击状态下的先制率 |
| `$weather_active_r` | array | `config('combatcfg')` | 天气对先制率的修正 |
| `$pose_active_modifier` | array | `config('combatcfg')` | 姿态对先制率的修正（强袭+50, 投降-100） |
| `$tactic_active_modifier` | array | `config('combatcfg')` | 策略对先制率的修正 |

### 属性伤害系统（完整）

> 属性标记：`p`=灼烧, `u`=冻结, `i`=电击, `d`=音波, `e`=爆炸, `w`=量子, `f`=光辉, `k`=暗影
> 由 `deal_ex_damage_prepare_events()` / `get_base_ex_att_array()` / `ex_dmg_check()` 计算

| 变量 | 类型 | 定义来源 | 说明 |
|------|------|----------|------|
| `$ex_attack` | array | `config('combatcfg')` | 可造成属性伤害的属性标记列表 |
| `$ex_def_kind` | array | `config('combatcfg')` | 各属性标记对应的防御武器种类（key=属性标记→`wep_kind`） |
| `$ex_dmg_def` | array | `config('combatcfg')` | 各属性标记对应的属性防御标记（`p`→`q`, `u`→`U`, `i`→`I`…） |
| `$ex_good_wep` | array | `config('combatcfg')` | 各属性伤害的优势武器种类（使用优势武器属性伤害翻倍） |
| `$ex_good_club` | array | `config('combatcfg')` | 各属性伤害的优势社团 |
| `$exdmgname` | array | `config('resources')` | 属性伤害名称（`u`=灼烧, `i`=冻结, `w`=电击…） |
| `$exdmginf` | array | `config('resources')` | 属性伤害信息（伤害描述、颜色等） |
| `$ex_base_dmg` | array | `config('combatcfg')` | 属性伤害基础值（各属性的初始伤害值） |
| `$ex_max_dmg` | array | `config('combatcfg')` | 属性伤害上限（单次属性伤害最大值） |
| `$ex_wep_dmg` | array | `config('combatcfg')` | 武器效果值 → 属性伤害的系数（武器越好伤害越高） |
| `$ex_skill_dmg` | array | `config('combatcfg')` | 熟练度 → 属性伤害的系数（熟练越高伤害越高） |
| `$ex_dmg_fluc` | array | `config('combatcfg')` | 属性伤害浮动范围（越小越稳定） |
| `$ex_inf` | array | `config('combatcfg')` | 各属性伤害可附加的异常状态（`p`→`p`置热, `u`→`u`冻结…） |
| `$ex_inf_punish` | array | `config('combatcfg')` | 已持有属性弱点的伤害惩罚系数（弱点已有时追加异常状态的概率系数） |
| `$ex_inf_r` | array | `config('combatcfg')` | 属性异常状态基础触发概率（百分比，`u`=10, `f`=25, `k`=25…） |
| `$ex_max_inf_r` | array | `config('combatcfg')` | 属性异常状态最高触发概率上限 |
| `$ex_skill_inf_r` | array | `config('combatcfg')` | 熟练度对属性异常触发率的系数（每点熟练增加的概率） |

### 战斗运行时临时变量

> 由 `get_base_att()` → `get_hitrate_rev()` → `get_original_dmg_rev()` → 伤害计算流程依次赋值

| 变量 | 类型 | 赋值阶段 | 说明 |
|------|------|----------|------|
| `$pa['wep_kind']` | string | 攻击准备 | 攻击方实际使用的攻击方式（`N`/`K`/`G`/`D`/`F`/`C`/`P`/`J`/`B`） |
| `$pa['wep_range']` | int | 攻击准备 | 攻击方武器射程（由 `$rangeinfo` 查表） |
| `$pa['wep_skill']` | float | 攻击准备 | 攻击方武器熟练度（含技能修正后的值） |
| `$pa['wep_name']` | string | 攻击准备 | 攻击方武器显示名称 |
| `$pa['hitrate']` | float | 命中计算 | 本次攻击的基础命中率（含熟练度修正、异常状态惩罚） |
| `$pa['hitrate_times']` | int | 命中计算 | 本次攻击的命中次数（连击数 = diceroll(hitrate) / 命中阈值） |
| `$pa['base_att']` | int | 物理伤害 | 攻击方基础攻击力（含天气/地点/姿态/策略/技能/异常状态修正后） |
| `$pd['base_def']` | int | 物理伤害 | 防守方基础防御力（含天气/地点/姿态/策略/技能/异常状态修正后） |
| `$pa['phy_damage']` | int | 物理伤害 | 本次造成的物理伤害值（`base_att/base_def * wep_skill * skill_dmg * 浮动`） |
| `$pa['ex_damage']` | int | 属性伤害 | 本次造成的属性伤害值（各属性 `ex_base_dmg + wepe/ex_wep_dmg + skill/ex_skill_dmg`，优势武器翻倍） |
| `$pa['final_damage']` | int | 最终伤害 | 本次造成的最终总伤害（物理+属性，含所有修正后的最终值） |
| `$pa['ex_keys']` | array | 伤害计算 | 攻击方装备的所有属性标记（`+`/`*`/`-`/`u`/`i`…含武器+防具+饰品全部属性） |
| `$pd['ex_keys']` | array | 伤害计算 | 防守方装备的所有属性标记（含属性防御 `q`/`U`/`I` / `E` / `W`等） |
| `$pa['ex_attack_keys']` | array | 属性伤害 | 攻击方能造成的属性伤害类型列表（从 `$ex_attack` 和 `pa['ex_keys']` 取交集） |
| `$pa['bskill']` | string | 技能判定 | 攻击方使用的主动战斗技能 ID |
| `$pa['is_counter']` | int | 反击 | 标记本次为反击攻击（1=是，影响主动技能是否可用） |
| `$pa['is_dfight']` | int | 鏖战 | 鏖战状态标记（1=鏖战中，影响战斗轮次计数） |
| `$pa['is_chase']` | int | 追击 | 追击方标记（1=正在追击） |
| `$pd['is_pchase']` | int | 追击 | 被追击方标记（1=正在被追） |
| `$pa['is_merc']` | int | 佣兵 | 佣兵标记（1=NPC辅助，影响技能判定） |
| `$pa['inf_times']` | int | 致伤 | 本次攻击的致伤次数（用于防具受损/致伤判定） |
| `$pa['charge_flag']` | mixed | 防具贯穿 | 冲击效果标记（隔防具造成伤害） |
| `$pa['gg_flag']` | string | 暴毙 | 非正常死亡标记（武器直死、DOT致死等），值=死法编号 |
| `$pa['cannot_counter']` | int | 反击 | 防守方无法反击的原因编号 |
| `$pa['cannot_counter_log']` | string | 反击 | 防守方无法反击的日志文本 |
| `$pa['coveratk_flag']` | mixed | 协战 | 协战标记，值=协战者 ID |
| `$pa['fail_escape']` | int | 逃跑 | 逃跑失败标记 |
| `$pa['skdr_flag']` | int | 技能抽取 | 技能抽取生效标记（部分技能被禁用） |
| `$pa['sldr_flag']` | int | 灵魂抽取 | 灵魂抽取生效标记（武器/饰品属性失效） |
| `$pa['mdr_flag']` | int | 精神抽取 | 精神抽取生效标记（防具属性失效） |
| `$pd['logsave']` | string | 日志 | 防守方战斗过程中的累积日志 |
| `$pd['lvlup_log']` | string | 日志 | 防守方战斗中升级的日志 |
| `$pa['action']` | string | 战斗结果 | 战斗结束后的行动标记（`corpse`=搜索尸体, `chase`=追击, `dfight`=鏖战, `cover`=协战, `tpmove`=传送） |
| `$pa['bid']` | int | 战斗结果 | 战斗结束后行动关联的目标 ID |
| `$battle_skills` | array | `revbattle.func.php` | 战斗中可用的技能列表 |
| `$quest_battle_mode` | int | `revbattle.func.php` | 任务战斗模式 |
| `$quest_battle_state` | int | `revbattle.func.php` | 任务战斗状态 |
| `$fog` | array | `revbattle.func.php` | 战争迷雾数据（视野/可见性） |
| `$action_list` | array | `revbattle.func.php` | 战斗可用行动列表 |

### 战斗中 pa/pd 的装备参数变量

> 由 `get_itmpara()` 解析 JSON 后赋值到 pa/pd 数组

| 变量 | 说明 |
|------|------|
| `$pa['weppara']` | 武器参数（JSON→array） |
| `$pa['wep2para']` | 副武器参数 |
| `$pa['arbpara']` | 身体防具参数 |
| `$pa['arhpara']` | 头部防具参数 |
| `$pa['arapara']` | 手臂防具参数 |
| `$pa['arfpara']` | 腿部防具参数 |
| `$pa['artpara']` | 饰品参数 |

---

## 十四、clbpara 结构详解

> `$clbpara` 是 `players` 表的 `clbpara` 字段，存储为 JSON 字符串。通过
> `$pdata['clbpara'] = get_clbpara($pdata['clbpara']);` 解析为数组。
> 它是一个**玩家级别的持久化状态存储**，用于保存技能状态、任务进度、
> 成就追踪、BGM 偏好、对话历史等所有不属于基础属性表的额外数据。

### 技能系统

| 键名 | 类型 | 说明 |
|------|------|------|
| `skill` | string[] | 已习得技能 ID 列表，如 `['c2_intuit','inf_dizzy']` |
| `skillpara` | array | 技能详细参数，结构见下 |
| `starttimes` | int[] | 技能激活时间戳，`starttimes[skillId]` = 激活时的 `$now` |
| `lasttimes` | int[] | 技能持续时长（秒），`lasttimes[skillId]` = 剩余秒数 |
| `lastturns` | int[] | 技能持续回合数，`lastturns[skillId]` = 剩余战斗回合数 |

**`skillpara` 子结构（以 `skillId` 为第一层 key）：**

| 键名 | 类型 | 说明 |
|------|------|------|
| `skillpara[skillId]['lvl']` | int | 技能等级 |
| `skillpara[skillId]['choice']` | mixed | 技能选择参数（如选择了哪个子技能） |
| `skillpara[skillId]['active']` | mixed | 时效性技能的激活状态标记 |
| **佣兵系统子结构**（以佣兵 key `$mkey` 为第二层 key）： | | |
| `skillpara[skillId]['id'][mkey]` | int | 佣兵的 `pid` |
| `skillpara[skillId]['paid'][mkey]` | int | 佣兵薪水 |
| `skillpara[skillId]['leave'][mkey]` | int | 佣兵解雇时的反应编号 |
| `skillpara[skillId]['coverp'][mkey]` | int | 佣兵协战概率（0-100） |
| `skillpara[skillId]['mms'][mkey]` | int | 佣兵跟随累计移动步数 |
| `skillpara[skillId]['cancover'][mkey]` | int | 佣兵当前是否能协战（1=可协战） |

### 任务系统

| 键名 | 类型 | 说明 |
|------|------|------|
| `quest` | array | 任务数据容器 |
| `quest['active']` | array | 进行中的任务，`quest.active[questId]` = 任务状态对象 |
| `quest['active'][questId]['title']` | string | 任务标题 |
| `quest['active'][questId]['step']` | int | 当前步骤编号 |
| `quest['active'][questId]['step_desc']` | string | 当前步骤描述 |
| `quest['active'][questId]['linked_npc_id']` | int | 关联 NPC 的 ID |
| `quest['active'][questId]['buff_level']` | int | 任务 Buff 等级 |
| `quest['active'][questId]['ready_to_claim']` | int | 是否可领取奖励（1=可领取） |
| `quest['active'][questId]['target_pls']` | string | 任务目标地点 |
| `quest['completed']` | array | 已完成任务，`quest.completed[questId]` = `['time'=>时间戳, 'reason'=>原因]` |
| `quest['failed']` | array | 已失败任务，`quest.failed[questId]` = `['time'=>时间戳, 'reason'=>原因]` |
| `quest['cooldown']` | array | 任务冷却：`assign`=下次可分配时间戳, `assign_steps`=分配步数计数, `reject_steps`=拒绝步数计数 |
| `quest['pending']` | array | 待确认的任务数据 |

### 成就追踪变量

| 键名 | 类型 | 说明 |
|------|------|------|
| `achvars` | array | 成就追踪数据容器 |
| `achvars['immix']` | int | 物品合成次数 |
| `achvars['hack']` | int | Hack 次数 |
| `achvars['wthchange']` | int | 天气改变次数 |
| `achvars['team']` | int | 组队次数 |
| `achvars['corpse_n14']` | int | 发现类型 14 尸体次数 |
| `achvars['eat_jelly']` | int | 是否吃过桔黄色果酱（0/1） |
| `achvars['eat_weiqi']` | int | 是否吃过围棋子饼干（0/1） |
| `achvars['gacha_sr']` | int | 抽到 SR 次数 |
| `achvars['gacha_ssr']` | int | 抽到 SSR 次数 |
| `achvars['thiphase']` | int | Thiphase 事件触发次数 |

### BGM / 音乐系统

| 键名 | 类型 | 说明 |
|------|------|------|
| `event_bgmbook` | string[]\|null | 当前事件 BGM 曲集名，如 `['wth18']`；unset 可恢复地图曲集 |
| `pls_bgmbook` | string\|null | 当前地点专属 BGM 记录 |
| `BGMBrand` | string | 当前 BGM 品牌，影响道具效果：`'azure'`/`'crimson'`/`'rimefire'`/`'rixolamal'`/`'lila'`/`'fleur'`/`'christine'` |

### 对话系统

| 键名 | 类型 | 说明 |
|------|------|------|
| `dialogue` | string | 当前待显示的对话 ID |
| `noskip_dialogue` | int | 不可跳过的对话 ID（0=允许跳过） |
| `dialogue_choice` | array | 玩家已做的对话选择记录 |
| `nobutton` | int | 隐藏操作按钮标记 |

### 消耗与状态

| 键名 | 类型 | 说明 |
|------|------|------|
| `consumpt` | int | 消耗率（影响移动时的 HP/SP 燃烧速率） |
| `battle_turns` | int | 战斗轮次计数（鏖战/追击中累加，战斗结束后 unset） |
| `coveratk` | int | 协战攻击目标 ID（设为玩家 PID 触发协战界面） |
| `mercchase` | int | 佣兵追击目标 PID |

### 元素合成系统

| 键名 | 类型 | 说明 |
|------|------|------|
| `elements` | array | 元素合成数据容器 |
| `elements['tags']` | array | 元素标签，`elements.tags[eid]['dom'][ekey]` 或 `['sub'][ekey]` = 1 |
| `elements['info']['d']` | array | 已发现的单元素，`d1`~`d{n}` = 1 |
| `elements['info']['hd']` | array | 已发现的混合元素，`h1`~`h{n}` 含子键 `s1`~`s{n}` |
| `elements['info']['dd']` | array | 已发现的双元素，`dd1`~`dd{n}` = 1 |
| `elements['info']['sd']` | array | 已发现的子元素，`sd1`~`sd{n}` = 1 |

### 随机种子

| 键名 | 类型 | 范围 | 说明 |
|------|------|------|------|
| `randver1` | int | 1–128 | 随机种子 1（影响运势签、物品效果、骰子判定等） |
| `randver2` | int | 1–256 | 随机种子 2（影响物品生成、属性随机等） |
| `randver3` | int | 1–1024 | 随机种子 3（影响稀有事件、高精度随机等） |

### Charge 充能系统 / 事件触发器

> 用于跟踪局内事件触发次数和充能状态（见 `revevent.func.php`）

| 键名 | 类型 | 范围 | 说明 |
|------|------|------|------|
| `charge1` | int | 0–101 | 充能值 1（每次移动概率增加 1-4） |
| `charge2` | int | 累计 | 充能值 2（每次操作增加 `randver2/3`） |
| `charge3` | int | -128–128 | 充能值 3（上下浮动） |
| `charge4` | int | 累计 | 充能值 4（每次操作概率增加） |

### 种火系统

> 见 `command.php` 和 `item.other.php`

| 键名 | 类型 | 说明 |
|------|------|------|
| `fireseed` | array | 种火数据，`fireseed[id]['name']` + `fireseed[id]['items'][itemId]` |
| `fireseed_ui_state` | array | 种火 UI 状态，`fireseed_ui_state[selectType]` = 种火 ID |
| `fireseedAshUsage` | int | 种火灰烬使用次数 |
| `fireseedMaxHPRecover` | int | 种火最大 HP 恢复量 |
| `fireseedmaxHPGain` | int | 种火最大 HP 增益上限 |
| `fireseedmaxHPAdd` | int | 种火已增加 HP |
| `fireseedmaxProfGain` | int | 种火最大熟练度增益上限 |
| `fireseedmaxProfAdd` | int | 种火已增加熟练度 |
| `fireseedmaxDefGain` | int | 种火最大防御增益上限 |
| `fireseedmaxDefAdd` | int | 种火已增加防御 |

### 钓鱼系统

> 见 `fishing.func.php`

| 键名 | 类型 | 说明 |
|------|------|------|
| `fishing` | array | 钓鱼数据容器 |
| `fishing['last_check_time']` | int | 上次检查钓鱼的时间戳 |
| `fishing['rod_message_shown']` | bool | 是否已显示鱼竿提示 |
| `fishing['caught_items']` | array | 已钓到的物品列表 |
| `fishing['stat_increases']` | array | 钓鱼过程中获得的属性提升列表 |
| `fish_basket` | array | 钓篓数据，`['position'=>地点, 'items'=>[...]]` |

### 探索视野 / 搜索记忆系统（smeo）

> `smeo` = **S**earch **Me**mory **O**bject。用于记录玩家在探索过程中"保持在视野范围内"的
> 对象（物品/尸体/NPC/敌人）。玩家可以随时通过「记忆」指令重新锁定这些对象。
>
> 相关全局开关：`$allow_semo`（是否启用视野系统，0/1）、`$smeo_max`（最大记忆槽位数，默认 3）。
> 由 `check_add_searchmemory()` 添加记忆，`lost_searchmemory()` 删除记忆，
> `focus_item()` / `focus_enemy()` 重新锁定记忆中的目标。

| 键名 | 类型 | 说明 |
|------|------|------|
| `smeo` | array | 探索记忆数组，按时间顺序排列（最新记忆在末尾） |
| `smeo[N]` | array | 第 N 个记忆槽位（0 为最旧），结构 `[目标ID, 类型, 名称]` |
| `smeo[N][0]` | int | 记忆中的目标 ID（物品 `iid`、玩家 `pid`、尸体 `pid`） |
| `smeo[N][1]` | string | 记忆中的目标类型：`'itm'`=物品, `'corpse'`=尸体, `'npc'`=NPC, `'enemy'`=敌人 |
| `smeo[N][2]` | string | 记忆中的目标名称（尸体时自动追加"的尸体"后缀） |

**操作流程：**
```
check_add_searchmemory(id, type, name) → 添加到视野末尾
  ├── 容量满时 → lost_searchmemory(NULL) 移除最旧记忆
  ├── 同 ID 同类型已存在 → 移除旧记忆，重新添加到末尾（刷新）
  └── 日志输出「你设法将 {名称} 保持在视野范围内」

前端 "memory" 指令 → lost_searchmemory(smn) → 取出记忆
  ├── type='itm' → focus_item() → 重新拾取该物品
  └── type!='itm' → chase_flag → focus 敌人/NPC

lost_searchmemory('all') → 清空全部视野 → 「先前所见的一切东西都离开了视线」
```

**关联游戏配置变量：**

| 变量 | 类型 | 定义来源 | 说明 |
|------|------|----------|------|
| `$allow_semo` | int | `config('gamecfg')` | 是否启用搜索记忆系统（0=关闭, 1=启用） |
| `$smeo_max` | int | `config('gamecfg')` | 最大记忆槽位数（`check_add_searchmemory` 中容量满时自动移除最旧记忆） |

### 物品相关

| 键名 | 类型 | 说明 |
|------|------|------|
| `opened_pack` | string | 最近打开的福袋名称 |
| `smartmix` | mixed | 合成配方快速索引 |

### RuleSet 相关

| 键名 | 类型 | 说明 |
|------|------|------|
| `ruleset_ending_shown` | bool | RuleSet 结局已展示标记 |
| `ruleset_opening_story` | mixed | RuleSet 开场剧情数据 |
| `ruleset_story_shown` | bool | RuleSet 开场剧情已展示标记 |

### BGM 品牌特殊追踪

| 键名 | 类型 | 说明 |
|------|------|------|
| `iAmHandsome` | int | 自我评价计数器（特定 BGM 下使用） |
| `iAmGreat` | int | 自我评价计数器 |
| `iAmRich` | int | 自我评价计数器 |
| `iAmStrong` | int | 自我评价计数器 |
| `traitorRoll` | int | 背叛者判定计数器 |
| `touchedByBunny` | int | 兔子触碰次数计数器 |
| `tl_oncemore_used` | bool | 头衔技能「再演」已使用标记 |

### 调试与其他

| 键名 | 类型 | 说明 |
|------|------|------|
| `console` | int | 判断游戏内的特殊功能-控制台是否被解锁（1=解锁） |
| `SetItmparaDebug` | bool | 物品参数调试模式开关 |
| `PlatformName` | string | 平台投影名称（platform 物品使用） |

---

## 十五、其他特殊变量

| 变量 | 类型 | 说明 |
|------|------|------|
| `$achievement` | array | 已废弃属性 |
| `$opendialog` | string | 当前打开的对话框 ID |
| `$cdover` | int | 冷却结束时间戳（毫秒） |
| `$rmcdtime` | int | 剩余冷却时间（毫秒） |
| `$cmdcdtime` | int | 命令冷却时间 |
| `$hpls_flag` | int | 隐藏地点标记 |
| `$rename` | string | 改名相关 |
| `$ntitm` | int | 新物品位置 |
| `$TEMPLATEID_OVERRIDE` | int\|null | 模板覆盖 ID |
| `$TPLDIR_OVERRIDE` | string\|null | 模板覆盖路径 |

---

## 十六、常见使用模式

### 物品变量动态访问

```php
// 6 格物品栏通过变量变量访问
$itm = &${'itm' . $itmn};    // 物品名
$itmk = &${'itmk' . $itmn};  // 物品类别
$itme = &${'itme' . $itmn};  // 物品效果
$itms = &${'itms' . $itmn};  // 物品耐久
$itmsk = &${'itmsk' . $itmn}; // 物品特殊属性
$itmpara = &${'itmpara' . $itmn}; // 物品参数
```

### 玩家数据提取

```php
// 在 command.php 中，玩家数据通过 extract() 展开
$pdata['clbpara'] = get_clbpara($pdata['clbpara']);
extract($pdata, EXTR_REFS);
// 之后 $pid, $name, $hp, $itm1, $itm2... 等全部可用
```

### 配置加载

```php
// config() 返回文件路径，require 将变量注入当前作用域
require config('gamecfg', $gamecfg);  // 加载 gamecfg_1.php
// 之后 $hp_limit, $sp_limit 等变量全部可用
```

### clbpara 读写

```php
// 读取：clbpara 是持久化 JSON，使用前必须先 get_clbpara() 解析
$pdata['clbpara'] = get_clbpara($pdata['clbpara']);
extract($pdata, EXTR_REFS);

// 读取技能等级
$slvl = $clbpara['skillpara']['c2_intuit']['lvl'] ?? 0;
// 读取任务进度
$qstep = $clbpara['quest']['active'][$questId]['step'] ?? 0;
// 读取随机种子
$rv = $clbpara['randver1'];

// 写入：修改后必须 json_encode 存回数据库
// clbpara 在 json_encode 时会自动通过 player_format_with_db_structure() 处理
$clbpara['battle_turns'] = $clbpara['battle_turns'] ?? 0;
$clbpara['battle_turns']++;
```