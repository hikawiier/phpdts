# GLOBALS — 全局变量词典

> 全局变量速查，帮助AI追踪数据流。按需跳转对应章节即可。

---

## 速查索引

| 找什么 | 章节 | 典型变量 |
|--------|------|----------|
| 数据库连接、表前缀 | [一/二](#一定义来源--二基础设施变量) | `$db`, `$tablepre`, `$dbhost` |
| 当前用户/登录态 | [三](#三用户认证变量) | `$cuser`, `$cpass`, `$udata` |
| 游戏版本、房间设定 | [四](#四游戏系统设定) | `$gameversion`, `$startmode` |
| 游戏状态、禁区、天气 | [五](#五游戏运行时状态) | `$gamestate`, `$areanum`, `$alivenum`, `$weather` |
| 请求参数（mode/command） | [六](#六请求参数变量) | `$mode`, `$command`, `$itemcmd` |
| 玩家属性（HP/SP/攻击/防御） | [七](#七玩家数据变量) | `$hp`, `$att`, `$def`, `$lvl`, `$money` |
| 装备栏 | [七-装备栏](#装备栏) | `$wep`, `$arb`, `$arh`, `$ara`, `$arf`, `$art` |
| 6格物品栏 | [七-6格物品栏](#6格物品栏) | `$itm1~6`, `$itmk1~6`, `$itme1~6`, `$itms1~6`, `$itmsk1~6`, `$itmpara1~6` |
| 临时手持槽（探索拾取） | [七-临时手持槽](#临时手持道具槽itm0系列) | `$itm0`, `$itmk0`, `$itme0`, `$itms0`, `$itmsk0`, `$itmpara0` |
| 额外背包 | [七-额外背包](#额外背包) | `$extrabag`, `$extrabag_num`, `$extrabag_max` |
| 游戏核心配置 | [八](#八游戏配置变量) | `$hp_limit`, `$sp_limit`, `$coldtimeon` |
| 资源数据（地点/物品/天气） | [九](#九资源数据变量) | `$plsinfo`, `$iteminfo`, `$wthinfo` |
| 战斗配置（命中/伤害/射程） | [十三](#十三战斗系统变量) | `$hitrate_obbs`, `$skill_dmg`, `$counter_obbs` |
| 战斗运行时状态（pa/pd） | [十三-运行时](#战斗运行时临时变量) | `$pa['hitrate']`, `$pa['final_damage']` |
| clbpara全部键 | [十四](#十四clbpara结构详解) | `$clbpara['skill']`, `$clbpara['quest']` |
| 搜索记忆/视野（smeo） | [十四-smeo](#探索视野--搜索记忆系统smeo) | `$clbpara['smeo']` |
| 日志/错误/AJAX输出 | [十一](#十一日志与输出变量) | `$log`, `$main`, `$error`, `$gamedata` |
| 禁区系统函数 | [十六](#十六禁区系统函数) | `is_death_area()`, `is_safe_area()`, `get_death_areas()` |

---

## 一、定义来源

全局变量通过以下方式进入作用域：

| 来源 | 机制 | 示例 |
|------|------|------|
| `config.inc.php` | 直接`$var = value` | `$dbhost`, `$tablepre`, `$authkey` |
| `gamedata/system.php` | 直接`$var = value` | `$gameversion`, `$gamecfg`, `$startmode` |
| `include/core/common.inc.php` | 定义常量+初始化变量 | `$now`, `$db`, `$gtablepre`, `$cuser` |
| `config('gamecfg')` | require配置文件 | `$hp_limit`, `$sp_limit`, `$startmin`... |
| `config('resources')` | require配置文件 | `$plsinfo`, `$hplsinfo`, `$wthinfo`... |
| `config('combatcfg')` | require配置文件 | `$movesp`, `$movehp`, `$infwords`... |
| `load_gameinfo()` | 从数据库加载 | `$gamestate`, `$areanum`, `$alivenum`... |
| `extract($pdata)` | 从玩家数据提取 | `$pid`, `$name`, `$hp`, `$itm1`... |
| `extract($_POST/$_GET)` | 从请求提取（Cookie优先级最高，EXTR_SKIP防覆盖） | `$mode`, `$command`, `$action`... |
| **`$post = gstrfilter($_POST)`** | **command.php 入口处构建的 POST 参数关联数组** | **`$post['mode']`, `$post['command']`, `$post['choice']`...** |

---

## 二、基础设施变量

> 定义于`config.inc.php` → `include/core/common.inc.php`

| 变量 | 类型 | 说明 |
|------|------|------|
| `$dbhost` | string | 数据库服务器地址 |
| `$dbuser` | string | 数据库用户名 |
| `$dbpw` | string | 数据库密码（用后unset） |
| `$dbname` | string | 数据库名 |
| `$tablepre` | string | 表前缀（如`acbra3_`，私房间变为`acbra3_s{id}_`） |
| `$gtablepre` | string | 全局表前缀（主数据库表前缀，不变） |
| `$database` | string | 数据库驱动：`mysql`/`mysqli`/`pdo` |
| `$authkey` | string | 加密密钥 |
| `$charset` | string | 字符集 |
| `$dbcharset` | string | 数据库字符集 |
| `$db` | object | 数据库连接对象（`dbstuff`实例） |
| `$now` | int | 当前时间戳（含时区偏移） |
| `$errorinfo` | int | 是否显示错误信息：0=关闭, 1=开启 |
| `$pconnect` | bool | 是否持久连接 |
| `$gamefounder` | string | 游戏创始人用户名 |
| `$salt` | string | 密码盐值 |

---

## 三、用户认证变量

> 定义于`include/core/common.inc.php`（从Cookie提取）

| 变量 | 类型 | 说明 |
|------|------|------|
| `$cuser` | string | 当前登录用户名（从Cookie） |
| `$cpass` | string | 当前登录密码（从Cookie） |
| `$udata` | array | 当前用户数据（从`users`表查询） |

---

## 四、游戏系统设定

> 定义于`gamedata/system.php`

| 变量 | 类型 | 说明 |
|------|------|------|
| `$gameversion` | string | 游戏版本号 |
| `$gamecfg` | int | 配置文件版本号，默认`1` |
| `$startmode` | int | 开始方式：0=手动, 1=定时, 2=间隔小时, 3=间隔分钟 |
| `$starthour` | int | 开始小时/间隔小时 |
| `$startmin` | int | 开始分钟/间隔分钟 |
| `$iplimit` | int | 同IP限制激活人数，0=不限制 |
| `$iconlimit` | int | 头像数量限制 |
| `$newslimit` | int | 进行状况显示条数 |
| `$alivelimit` | int | 生存者显示条数 |
| `$ranklimit` | int | 排行榜显示条数 |
| `$winlimit` | int | 历史优胜者显示条数 |
| `$noiselimit` | int | 枪声间隔时间（秒） |
| `$chatlimit` | int | 聊天显示条数 |
| `$chatrefresh` | int | 聊天刷新间隔（毫秒） |
| `$chatinnews` | int | 新闻区显示聊天条数，0=不显示 |
| `$allowcsscache` | int | 是否缓存CSS |
| `$checkstr` | string | 文件验证字符串 |
| `$tplrefresh` | int | 模板自动刷新 |

---

## 五、游戏运行时状态

> 定义于`include/core/common.inc.php`，通过`load_gameinfo()`从数据库加载

| 变量 | 类型 | 说明 |
|------|------|------|
| `$groomid` | int | 当前房间ID，0=主房间，>0=小房间 |
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
| `$arealist` | array | 禁区列表（随机排列的出现顺序） |
| `$weather` | int | 当前天气 |
| `$hack` | int | 当前禁区的Hack率 |
| `$combonum` | int | 连斗触发所需死亡数 |
| `$gamevars` | array | 游戏通用变量 |
| `$afktime` | int | 上次反挂机检查时间 |
| `$optime` | int | 操作时间 |
| `$hdamage` | int | 当前局内玩家造成的最高伤害值 |
| `$hplayer` | string | 当前局内造成最高伤害的玩家 |
| `$noisetime` | int | 玩家制造声音信息传出的时间 |
| `$noisepls` | string | 声音信息来源地点 |
| `$noiseid` / `$noiseid2` | int | 声音信息来源ID |
| `$noisemode` | string | 声音信息类型 |
| `$groomnums` | int | 房间内玩家数 |
| `$groomownid` | int | 房间所有者ID |
| `$gruleset` | string | 房间使用的RuleSet ID |

> 废弃变量（待清理）：`$rdown`, `$bdown`, `$ldown`, `$kdown`

---

## 六、请求参数变量

> 定义于`include/core/common.inc.php`（`extract($_POST)` + `extract($_GET)`）

| 变量 | 类型 | 说明 |
|------|------|------|
| `$mode` | string | 当前操作模式（核心分发变量），如`command`/`revcombat`/`itemmain` |
| `$command` | string | 指令名称，如`move`/`search`/`itemmain`/`rest` |
| `$action` | string | 动作名称，如`chase`/`tpmove` |
| `$cmd` | string | 子命令 |
| `$itemcmd` | string | 物品子命令，如`itemmix`/`elementmix` |
| `$sp_cmd` | string | 特殊技能子命令 |
| `$moveto` | string | 移动目标地点 |
| `$bid` | int | 战斗/交互目标ID |
| `$sub` | string | 子参数 |

---

## 七、玩家数据变量

> 定义于`extract($pdata)`后，来自`players`表字段

### 基础属性

| 变量 | 字段 | 说明 |
|------|------|------|
| `$pid` | `pid` | 玩家ID |
| `$name` | `name` | 玩家名称 |
| `$nick` | `nick` | 玩家昵称 |
| `$type` | `type` | 类型：0=PC, 1=NPC |
| `$gd` | `gd` | 性别：`m`=男, `f`=女 |
| `$icon` | `icon` | 头像编号 |
| `$hp`/`$mhp` | `hp`/`mhp` | 当前/最大生命值 |
| `$sp`/`$msp` | `sp`/`msp` | 当前/最大体力值 |
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
| `$wd` | `wd` | 武器熟练度 |
| `$ss` | `ss` | 子技能点 |
| `$sNo` | `sNo` | 初始编号 |
| `$coldtimeon` | `coldtimeon` | 冷却时间开关 |
| `$cdtime` | `cdtime` | 冷却结束时间戳 |
| `$cdsec`/`$cdmsec` | `cdsec`/`cdmsec` | 冷却秒数/毫秒数 |

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

### 6格物品栏

每格含名称/类别/效果/耐久/特殊属性/参数6个字段：

| 字段前缀 | 变量 | 说明 |
|----------|------|------|
| `itm` | `$itm1~6` | 物品名称 |
| `itmk` | `$itmk1~6` | 物品类别 |
| `itme` | `$itme1~6` | 物品效果值 |
| `itms` | `$itms1~6` | 物品耐久 |
| `itmsk` | `$itmsk1~6` | 物品特殊属性 |
| `itmpara` | `$itmpara1~6` | 物品参数（JSON） |

### 临时手持道具槽（`itm0`系列）

> 探索中发现道具时，系统将其装入`itm0`系列作为"拿在手上待处理"的临时槽位。处理完毕后通过`itemget()`转入背包或触发陷阱，然后清空。

| 变量 | 字段 | 说明 |
|------|------|------|
| `$itm0` | `itm0` | 临时道具名称 |
| `$itmk0` | `itmk0` | 临时道具类别（`TO`开头=陷阱类） |
| `$itme0` | `itme0` | 临时道具效果值 |
| `$itms0` | `itms0` | 临时道具耐久（0=无效道具） |
| `$itmsk0` | `itmsk0` | 临时道具特殊属性（陷阱场景下存储设置者PID） |
| `$itmpara0` | `itmpara0` | 临时道具参数（JSON） |

### 额外背包

| 变量 | 字段 | 说明 |
|------|------|------|
| `$extrabag` | `extrabag` | 额外背包物品列表（JSON） |
| `$extrabag_put` | `extrabag_put` | 取出特定道具时的暂存区 |
| `$extrabag_num` | `extrabag_num` | 当前物品数 |
| `$extrabag_max` | `extrabag_max` | 容量上限 |

### 其他玩家数据

| 变量 | 字段 | 说明 |
|------|------|------|
| `$clbpara` | `clbpara` | 社团参数（JSON，含技能、任务状态等）。详见[第十四节](#十四clbpara结构详解) |

---

## 八、游戏配置变量

> 定义于`config('gamecfg')`加载的`gamedata/cache/gamecfg_1.php`

### 基础属性

| 变量 | 类型 | 说明 |
|------|------|------|
| `$hp_limit` | int | 初始生命值上限 |
| `$sp_limit` | int | 初始体力值上限 |
| `$baseexp` | int | 基础经验值（影响升级曲线） |
| `$startmin` | int | 游戏开始准备时间 |

### 移动消耗

| 变量 | 类型 | 说明 |
|------|------|------|
| `$movesp` | int | 移动消耗体力 |
| `$movehp` | int | 移动消耗生命 |
| `$inf_move_sp` | int | 受伤时移动消耗体力 |
| `$inf_move_hp` | int | 受伤时移动消耗生命 |

### 冷却时间

| 变量 | 类型 | 说明 |
|------|------|------|
| `$coldtimeon` | int | 冷却时间开关 |
| `$movecoldtime` | int | 移动冷却时间 |
| `$searchcoldtime` | int | 探索冷却时间 |
| `$itemusecoldtime` | int | 物品使用冷却时间 |

### 概率与阈值配置组

以下数组/变量控制各系统的概率与阈值，具体数值见`gamecfg_1.php`：

| 变量 | 说明 |
|------|------|
| `$hack_obbs` | Hack概率 |
| `$event_obbs` | 事件触发概率 |
| `$item_obbs` | 物品发现概率 |
| `$enemy_obbs` | 遇敌概率 |
| `$trap_min_obbs` / `$trap_max_obbs` | 陷阱概率范围 |
| `$corpse_obbs` | 尸体发现概率 |
| `$corpseprotect` | 尸体保护时间 |
| `$combolimit` | 连斗触发人数上限 |
| `$validlimit` | 激活人数上限 |
| `$deathlimit` / `$deathdeno` / `$deathnume` | 连斗公式参数 |
| `$arealimit` / `$areahour` / `$areaadd` / `$areawarntime` / `$areaesc` | 禁区参数（次数上限/间隔/增量/警告提前时间/自动躲避模式） |
| `$antiAFKertime` | 反挂机检查间隔 |
| `$gamblingon` | 赌局系统开关 |
| `$credits2_values` | 切糕价值系数 |
| `$no_self_sponsored` | 是否禁止给自己赞助 |
| `$sponsor_title` | 赌局赞助者头衔前缀 |
| `$gnpctype` / `$gnpcsub` | 赌局快递员NPC类型/子类型 |
| `$rsgame_bots` | 每局自动部署Bot数量 |
| `$allow_semo` | 搜索记忆/视野系统开关 |
| `$smeo_max` | 搜索记忆最大容量（默认3） |
| `$allow_destory_corpse` | 是否允许销毁尸体 |
| `$no_destory_corpse_type` | 不允许销毁的尸体类型 |
| `$rpup_destory_corpse` | 销毁尸体RP提升 |
| `$npc_away_from_danger_areas` | NPC是否避开危险区（0=不避开, 1=避开） |

> **注意**：`$shops`、`$hospitals`、`$wthinfo`、`$infwords`虽在游戏逻辑中与gamecfg变量一起使用，但实际定义于`resources_1.php`（见第九节）。`$weather`是运行时变量，由`load_gameinfo()`从数据库加载（见第五节）。

---

## 九、资源数据变量

> 定义于`config('resources')`加载的`gamedata/cache/resources_1.php`

| 变量 | 类型 | 说明 |
|------|------|------|
| `$plsinfo` | array | 地点信息（名称、描述） |
| `$hplsinfo` | array | 隐藏地点信息 |
| `$pls_bgm` | array | 地点背景音乐 |
| `$typeinfo` | array | 玩家类型信息 |
| `$noiseinfo` | array | 玩家制造的声音类型信息 |
| `$iteminfo` | array | 物品类别（`itmk`）信息 |
| `$itemspkinfo` | array | 物品特殊属性（`itmsk`）信息 |
| `$cskills` | array | 社团技能全定义信息 |
| `$exdmgname` | array | 属性伤害名称 |
| `$exdmginf` | array | 属性伤害信息（描述、颜色） |
| `$elements_info` | array | 元素大师系统：元素信息 |
| `$r_elements_info` | array | 元素大师系统：逆元素信息（弱点映射） |
| `$horizon` | array | 游戏内特殊功能：视界 |
| `$emdata` | array | 聊天表情图片url与信息 |
| `$chatinfo` | array | 系统广播类别前缀 |
| `$danger_areas` | array | **NPC危险区**：NPC躲避禁区/追杀时不会进入的区域，默认`Array(0,32,33,34)`。原名`$deepzones` |
| `$event_areas` | array | **特殊事件区域**：移动到这些区域时触发特殊事件（如英灵殿），默认`Array(34)` |

> **Tooltip类数组**（`$tps_name`, `$tps_names`, `$tps_name_lore`, `$tps_ik`, `$tps_isk`）仅供tooltip根据道具名/类别/特殊属性显示提示，旧模板使用`$noitm`/`$nospk`。

---

## 十、战斗配置变量

> 定义于`config('combatcfg')`加载的`gamedata/cache/combatcfg_1.php`

战斗属性计算由`revattr`系列处理，战斗主流程由`revcombat`系列处理，前端渲染由`revbattle`系列处理。

### 核心变量

| 变量 | 类型 | 说明 |
|------|------|------|
| `$attinfo` | array | 攻击方式描述文本，key为`wep_kind`（`N`=殴打, `K`=斩击, `G`=射击, `D`=投掷, `F`=灵力, `C`=爆系, `P`=殴符, `J`=符卡, `B`=弓系） |
| `$skillinfo` | array | 武器种类→熟练度字段名映射（`N`→`wd`, `K`→`wk`...） |
| `$nosta` | int | 无状态时的基础值（攻击/防御基准） |
| `$infinfo` | array | 异常状态信息 |

### 命中率系统

| 变量 | 说明 |
|------|------|
| `$hitrate_obbs` | 各攻击方式基础命中率（key=`wep_kind`） |
| `$hitrate_max_obbs` | 各攻击方式最高命中率 |
| `$hitrate_r` | 熟练度对命中的影响系数 |

### 射程系统

| 变量 | 说明 |
|------|------|
| `$rangeinfo` | 各攻击方式射程（key=`wep_kind`）。`D`=0不可反击任何系也不可被任何系反击 |

### 物理伤害系统

| 变量 | 说明 |
|------|------|
| `$skill_dmg` | 各攻击方式熟练度对伤害的系数 |
| `$dmg_fluc` | 各攻击方式伤害浮动范围（越小越稳定） |
| `$def_kind` | 各攻击方式对应的防御属性 |

### 异常状态相关

| 变量 | 说明 |
|------|------|
| `$infobbs` | 各攻击方式基础异常状态触发概率 |
| `$infatt` | 各攻击方式可造成的异常状态标记列表 |
| `$infatt_rev` | `$infatt`的逆转形式 |
| `$inf_att_p` | 各异常状态对攻击力的惩罚系数 |
| `$inf_def_p` | 各异常状态对防御力的惩罚系数 |
| `$inf_htr_p` | 各异常状态对命中率的惩罚系数 |
| `$inf_active_p` | 各异常状态对先制率的惩罚系数 |
| `$inf_counter_p` | 各异常状态对反击率的惩罚系数 |
| `$wepimprate` | 各攻击方式的武器改进成功率（-1=不可改进） |
| `$specialrate` | 特殊攻击触发率 |

### 天气修正（key为天气编号）

| 变量 | 说明 |
|------|------|
| `$weather_attack_modifier` | 天气对攻击力的影响（百分比加算） |
| `$weather_defend_modifier` | 天气对防御力的影响（百分比加算） |
| `$weather_find_r` | 天气对发现率的修正 |
| `$weather_hide_r` | 天气对隐藏率的修正 |
| `$weather_active_r` | 天气对先制率的修正 |

### 姿态修正（姿态编号：0=通常, 1=作战, 2=强袭, 3=探索, 4=治疗, 5=专守, 6=躲避, 7=投降）

| 变量 | 说明 |
|------|------|
| `$pose_attack_active` / `$pose_defend_active` | 姿态攻击/防御修正是否启用 |
| `$pose_attack_modifier` / `$pose_defend_modifier` | 各姿态对攻击/防御力的修正值（百分比加算） |
| `$pose_find_modifier` / `$pose_hide_modifier` | 各姿态对发现/隐藏率的修正 |
| `$pose_active_modifier` / `$pose_counter_modifier` | 各姿态对先制/反击率的修正 |

### 策略修正（策略编号：0=通常, 1=重视攻击, 2=重视防御, 3=重视探索, 4=重视治疗）

| 变量 | 说明 |
|------|------|
| `$tactic_attack_active` / `$tactic_defend_active` | 策略攻击/防御修正是否启用 |
| `$tactic_attack_modifier` / `$tactic_defend_modifier` | 各策略对攻击/防御力的修正值 |
| `$tactic_hide_modifier` / `$tactic_active_modifier` / `$tactic_counter_modifier` | 各策略对隐藏/先制/反击率的修正 |

### 地点修正（key为地点编号）

| 变量 | 说明 |
|------|------|
| `$pls_attack_modifier` / `$pls_defend_modifier` | 各地点对攻击/防御力的修正（百分比加算） |
| `$pls_find_modifier` / `$pls_hide_modifier` | 各地点对发现/隐藏率的修正 |

### 反击系统

| 变量 | 说明 |
|------|------|
| `$counter_obbs` | 各攻击方式基础反击概率（key=`wep_kind`） |
| `$pose_counter_modifier` | 姿态对反击率的修正（5=专守-100, 7=投降-100） |
| `$tactic_counter_modifier` | 策略对反击率的修正（2=重防+30） |

### 追击/鏖战系统

| 变量 | 说明 |
|------|------|
| `$chase_obbs` | 追击触发概率（百分比） |
| `$dfight_obbs` | 鏖战触发概率（百分比） |
| `$chase_escape_obbs` | 追击中逃跑成功概率 |

### 先制率计算

| 变量 | 说明 |
|------|------|
| `$active_obbs` | 基础先制率（百分比） |
| `$chase_active_obbs` | 追击状态下的先制率 |

### 属性伤害系统

属性标记：`p`=灼烧, `u`=冻结, `i`=电击, `d`=音波, `e`=爆炸, `w`=量子, `f`=光辉, `k`=暗影

| 变量 | 说明 |
|------|------|
| `$ex_attack` | 可造成属性伤害的属性标记列表 |
| `$ex_def_kind` | 各属性标记对应的防御武器种类 |
| `$ex_dmg_def` | 各属性标记对应的属性防御标记 |
| `$ex_good_wep` | 各属性伤害的优势武器种类（使用优势武器伤害翻倍） |
| `$ex_good_club` | 各属性伤害的优势社团 |
| `$ex_base_dmg` | 属性伤害基础值 |
| `$ex_max_dmg` | 属性伤害上限（单次最大值） |
| `$ex_wep_dmg` | 武器效果值→属性伤害系数 |
| `$ex_skill_dmg` | 熟练度→属性伤害系数 |
| `$ex_dmg_fluc` | 属性伤害浮动范围 |
| `$ex_inf` | 各属性伤害可附加的异常状态 |
| `$ex_inf_punish` | 已持有属性弱点的伤害惩罚系数 |
| `$ex_inf_r` | 属性异常状态基础触发概率（百分比） |
| `$ex_max_inf_r` | 属性异常状态最高触发概率上限 |
| `$ex_skill_inf_r` | 熟练度对属性异常触发率的系数 |

---

## 十一、日志与输出变量

| 变量 | 类型 | 说明 |
|------|------|------|
| `$log` | string | **游戏日志缓冲区**（HTML字符串），几乎所有操作都会追加内容 |
| `$main` | string | 主界面内容区 |
| `$cmd` | string | 当前命令 |
| `$actlog` | string | 行为日志 |
| `$gamedata` | array | **AJAX响应数据数组**——详见下方 |
| `$error` | string | 错误信息 |

### $gamedata 结构详解

> 各入口文件局部定义的多维关联数组，经 `compatible_json_encode()` 序列化后作为 AJAX 响应返回前端。不同入口文件结构不同，`command.php` 最完整。

**定义入口：** [command.php](command.php)（游戏指令）、[user.php](user.php)（用户设置）、[register.php](register.php)（注册）、[messages.php](messages.php)（站内信）

**command.php 中的完整结构：**

| 键 | 类型 | 来源 |
|----|------|------|
| `url` | string\|null | 直接赋值（游戏结束=`end.php`） |
| `timer` | int | `$rmcdtime`（冷却计时器，毫秒） |
| `locationId` | int | `$pls`（当前位置编号） |
| `clbpara` | array | `$clbpara`（社团参数，完整传给前端） |
| `value.teamID` | string | `$teamID` |
| `innerHTML.ingamebgm` | string | `init_bgm()` |
| `innerHTML.notice` | string | `ob_get_contents()`（即时反馈） |
| `innerHTML.cmd` | string | 模板渲染（death/itemfind/fishing/rest/command 等） |
| `innerHTML.pls` | string | `$plsinfo[$pls]` |
| `innerHTML.anum` | int | `$alivenum` |
| `innerHTML.main` | string | `profile` 模板 |
| `innerHTML.log` | string | `$log`（同时写入 `vex/cache/log_{groomid}_{pid}.php`） |
| `innerHTML.error` | string\|null | `$error`（条件性） |
| `innerHTML.chattype` | string | 聊天选择器 HTML（有队伍时多"队伍"选项） |

**其他入口的简化结构：**

| 入口 | 结构 |
|------|------|
| `user.php` | `innerHTML.info`（操作结果信息） |
| `register.php` | `innerHTML.info`、`innerHTML.postreg`（注册后按钮）、`innerHTML.error` |
| `messages.php` | `innerHTML.info`、`innerHTML.messages`（消息列表 HTML）、`innerHTML.error` |

**消费方式：** `innerHTML` 子键名直接对应前端 DOM 元素 `id`，JS 遍历注入。旧前端用 `game.js`；`$_GET['is_new']` 时走 [api.php](api.php) 输出另一套 JSON。

**序列化：** `compatible_json_encode()` 定义于 [include/core/global.func.php](include/core/global.func.php)，自动选择 PHP 内置或自定义 JSON 类。

---

## 十二、物品合成相关变量

| 变量 | 类型 | 说明 |
|------|------|------|
| `$itemindex` | array | 物品合成索引 |
| `$syncn` / `$synck` / `$synce` / `$syncs` / `$syncsk` | string/int | 合成物品名称/类别/效果/耐久/特殊属性 |
| `$sync` | array | 合成配方 |
| `$reqname` | string | 需求物品名称 |
| `$star` | int | 物品星级 |
| `$itm0`~`$itmpara0` | — | 手中物品（临时持有），同第七节临时槽 |

---

## 十三、战斗系统变量

### 战斗运行时临时变量

> 由`get_base_att()` → `get_hitrate_rev()` → `get_original_dmg_rev()` → 伤害计算流程依次赋值到`$pa`（攻击方）/`$pd`（防守方）数组。

#### 攻击准备阶段

| 键 | 说明 |
|----|------|
| `$pa['wep_kind']` | 实际攻击方式（`N`/`K`/`G`/`D`/`F`/`C`/`P`/`J`/`B`） |
| `$pa['wep_range']` | 武器射程（由`$rangeinfo`查表） |
| `$pa['wep_skill']` | 武器熟练度（含技能修正后） |
| `$pa['wep_name']` | 武器显示名称 |

#### 命中与伤害计算

| 键 | 说明 |
|----|------|
| `$pa['hitrate']` | 本次攻击基础命中率 |
| `$pa['hitrate_times']` | 命中次数（连击数） |
| `$pa['base_att']` | 攻击方基础攻击力（含所有修正后） |
| `$pd['base_def']` | 防守方基础防御力（含所有修正后） |
| `$pa['phy_damage']` | 本次物理伤害值 |
| `$pa['ex_damage']` | 本次属性伤害值 |
| `$pa['final_damage']` | 最终总伤害（物理+属性） |
| `$pa['ex_keys']` / `$pd['ex_keys']` | 攻/守方装备的所有属性标记 |
| `$pa['ex_attack_keys']` | 攻击方能造成的属性伤害类型列表 |

#### 状态与标记

| 键 | 说明 |
|----|------|
| `$pa['bskill']` | 主动战斗技能ID |
| `$pa['is_counter']` | 本次为反击攻击（1=是） |
| `$pa['is_dfight']` | 鏖战状态标记 |
| `$pa['is_chase']` / `$pd['is_pchase']` | 追击方/被追击方标记 |
| `$pa['is_merc']` | 佣兵标记（1=NPC辅助） |
| `$pa['inf_times']` | 本次致伤次数 |
| `$pa['charge_flag']` | 防具贯穿（冲击效果） |
| `$pa['gg_flag']` | 非正常死亡标记（值=死法编号） |
| `$pa['cannot_counter']` | 防守方无法反击的原因编号 |
| `$pa['coveratk_flag']` | 协战标记（值=协战者ID） |
| `$pa['fail_escape']` | 逃跑失败标记 |
| `$pa['skdr_flag']` | 技能抽取生效标记 |
| `$pa['sldr_flag']` | 灵魂抽取生效标记（武器/饰品属性失效） |
| `$pa['mdr_flag']` | 精神抽取生效标记（防具属性失效） |
| `$pa['action']` | 战斗结束后行动标记（`corpse`/`chase`/`dfight`/`cover`/`tpmove`） |
| `$pa['bid']` | 战斗结束后行动关联的目标ID |
| `$pd['logsave']` | 防守方累积日志 |
| `$pd['lvlup_log']` | 防守方战斗中升级日志 |

#### 前端与装备参数

| 键 | 说明 |
|----|------|
| `$battle_skills` | 战斗中可用技能列表 |
| `$quest_battle_mode` / `$quest_battle_state` | 任务战斗模式/状态 |
| `$fog` | 战争迷雾数据（视野/可见性） |
| `$action_list` | 战斗可用行动列表 |
| `$pa['weppara']` / `$pa['wep2para']` / `$pa['arbpara']` / `$pa['arhpara']` / `$pa['arapara']` / `$pa['arfpara']` / `$pa['artpara']` | 武器/副武器/身体/头部/手臂/腿部/饰品参数（JSON解析后） |

---

## 十四、clbpara 结构详解

> `$clbpara` 是 `$pdata['clbpara']` 的全局别名（由 `extract()` 产生），对应 `players` 表的 `clbpara` 字段，JSON 字符串。它是**玩家级别的持久化状态存储**。
> **操作规范**：必须通过 API 读写（`get_clbpara()` / `check_player_misc_states()` / `check_skilllasttimes()` / `player_save()`）。禁止直接 `json_encode` + `UPDATE` 入库。新业务逻辑禁止依赖 `extract()`，应直接操作 `$data['clbpara']`。
> **生命周期**：`valid.php` 初始化（BGM/随机种子/对话等）→ 数据库 JSON → `check_player_misc_states()` 加载时解码并刷新时效技能 → `player_save()` 统一编码回写。

### 一级键速查

| 键名 | 类型 | 说明 |
|------|------|------|
| `skill` | string[] | 已习得技能ID列表 |
| `skillpara` | array | 技能详细参数（含等级/选择/激活状态/佣兵子结构） |
| `starttimes` | int[] | 技能激活时间戳 |
| `lasttimes` | int[] | 技能持续时长（秒） |
| `lastturns` | int[] | 技能持续回合数 |
| `quest` | array | 任务数据容器（含`active`/`completed`/`failed`/`cooldown`/`pending`） |
| `achvars` | array | 成就追踪数据容器（如合成次数/Hack次数/天气改变次数等） |
| `event_bgmbook` | string[]\|null | 当前事件BGM曲集名；unset恢复地图曲集 |
| `pls_bgmbook` | string\|null | 当前地点专属BGM记录 |
| `BGMBrand` | string | 当前BGM品牌，影响道具效果 |
| `dialogue` | string | 当前待显示对话ID |
| `noskip_dialogue` | int | 不可跳过对话ID（0=允许跳过） |
| `dialogue_choice` | array | 玩家已做对话选择记录 |
| `nobutton` | int | 隐藏操作按钮标记 |
| `consumpt` | int | 消耗率（影响移动时HP/SP燃烧速率） |
| `battle_turns` | int | 战斗轮次计数（鏖战/追击中累加，战斗结束后unset） |
| `coveratk` | int | 协战攻击目标ID |
| `mercchase` | int | 佣兵追击目标PID |
| `elements` | array | 元素合成数据容器（含`tags`/`info`子结构） |
| `randver1` | int(1–128) | 随机种子1（影响运势签/物品效果/骰子判定） |
| `randver2` | int(1–256) | 随机种子2（影响物品生成/属性随机） |
| `randver3` | int(1–1024) | 随机种子3（影响稀有事件/高精度随机） |
| `charge1~4` | int | 充能值（跟踪局内事件触发次数和充能状态） |
| `fireseed` / `fireseed_ui_state` / `fireseedAshUsage` / `fireseedMaxHPRecover` / `fireseedmaxHPGain` / `fireseedmaxHPAdd` / `fireseedmaxProfGain` / `fireseedmaxProfAdd` / `fireseedmaxDefGain` / `fireseedmaxDefAdd` | — | 种火系统数据与UI状态 |
| `fishing` / `fish_basket` | array | 钓鱼数据容器与钓篓 |
| `smeo` | array | 探索视野/搜索记忆系统（详见下方） |
| `opened_pack` | string | 最近打开的福袋名称 |
| `smartmix` | mixed | 合成配方快速索引 |
| `ruleset_ending_shown` / `ruleset_opening_story` / `ruleset_story_shown` | bool/mixed | RuleSet结局/开场剧情标记 |
| `iAmHandsome` / `iAmGreat` / `iAmRich` / `iAmStrong` / `traitorRoll` / `touchedByBunny` / `tl_oncemore_used` | int/bool | BGM品牌特殊追踪计数器与标记 |
| `console` | int | 游戏内特殊功能-控制台解锁标记（1=解锁） |
| `SetItmparaDebug` | bool | 物品参数调试模式开关 |
| `PlatformName` | string | 平台投影名称（platform物品使用） |

### skillpara 子结构

以`skillId`为第一层key：

| 键名 | 类型 | 说明 |
|------|------|------|
| `skillpara[skillId]['lvl']` | int | 技能等级 |
| `skillpara[skillId]['choice']` | mixed | 技能选择参数（如子技能选择） |
| `skillpara[skillId]['active']` | mixed | 时效性技能激活状态标记 |

**佣兵系统子结构**（以佣兵key`$mkey`为第二层key）：

| 键名 | 类型 | 说明 |
|------|------|------|
| `skillpara[skillId]['id'][mkey]` | int | 佣兵pid |
| `skillpara[skillId]['paid'][mkey]` | int | 佣兵薪水 |
| `skillpara[skillId]['leave'][mkey]` | int | 佣兵解雇反应编号 |
| `skillpara[skillId]['coverp'][mkey]` | int | 佣兵协战概率（0-100） |
| `skillpara[skillId]['mms'][mkey]` | int | 佣兵跟随累计移动步数 |
| `skillpara[skillId]['cancover'][mkey]` | int | 佣兵当前是否能协战（1=可协战） |

### quest 子结构

| 键名 | 类型 | 说明 |
|------|------|------|
| `quest['active']` | array | 进行中的任务，`quest.active[questId]` = 任务状态对象 |
| `quest['active'][questId]['title']` | string | 任务标题 |
| `quest['active'][questId]['step']` | int | 当前步骤编号 |
| `quest['active'][questId]['step_desc']` | string | 当前步骤描述 |
| `quest['active'][questId]['linked_npc_id']` | int | 关联NPC的ID |
| `quest['active'][questId]['buff_level']` | int | 任务Buff等级 |
| `quest['active'][questId]['ready_to_claim']` | int | 是否可领取奖励（1=可领取） |
| `quest['active'][questId]['target_pls']` | string | 任务目标地点 |
| `quest['completed']` | array | 已完成任务，`quest.completed[questId]` = `['time'=>时间戳, 'reason'=>原因]` |
| `quest['failed']` | array | 已失败任务，结构同completed |
| `quest['cooldown']` | array | 任务冷却：`assign`=下次可分配时间戳, `assign_steps`=分配步数, `reject_steps`=拒绝步数 |
| `quest['pending']` | array | 待确认任务数据 |

### 探索视野 / 搜索记忆系统（smeo）

> `smeo` = **S**earch **Me**mory **O**bject。记录探索过程中"保持在视野范围内"的对象（物品/尸体/NPC/敌人）。玩家可通过「记忆」指令重新锁定。
>
> 全局开关：`$allow_semo`（0/1）、`$smeo_max`（默认3）。由`check_add_searchmemory()`添加，`lost_searchmemory()`删除，`focus_item()`/`focus_enemy()`重新锁定。

| 键名 | 类型 | 说明 |
|------|------|------|
| `smeo` | array | 探索记忆数组，按时间顺序排列（最新在末尾） |
| `smeo[N]` | array | 第N个记忆槽位（0为最旧），结构`[目标ID, 类型, 名称]` |
| `smeo[N][0]` | int | 目标ID（物品`iid`、玩家`pid`、尸体`pid`） |
| `smeo[N][1]` | string | 目标类型：`itm`=物品, `corpse`=尸体, `npc`=NPC, `enemy`=敌人 |
| `smeo[N][2]` | string | 目标名称（尸体自动追加"的尸体"后缀） |

**操作流程：**

```
check_add_searchmemory(id, type, name) → 添加到视野末尾
  ├── 容量满 → lost_searchmemory(NULL) 移除最旧记忆
  ├── 同ID同类型已存在 → 移除旧记忆，重新添加到末尾（刷新）
  └── 日志输出「你设法将 {名称} 保持在视野范围内」

前端 "memory" 指令 → lost_searchmemory(smn) → 取出记忆
  ├── type='itm' → focus_item() → 重新拾取
  └── type!='itm' → chase_flag → focus 敌人/NPC

lost_searchmemory('all') → 清空全部视野
```

### elements 子结构（元素合成）

| 键名 | 类型 | 说明 |
|------|------|------|
| `elements['tags']` | array | 元素标签，`elements.tags[eid]['dom'][ekey]`或`['sub'][ekey]` = 1 |
| `elements['info']['d']` | array | 已发现单元素，`d1~dn` = 1 |
| `elements['info']['hd']` | array | 已发现混合元素，`h1~hn`含子键`s1~sn` |
| `elements['info']['dd']` | array | 已发现双元素，`dd1~ddn` = 1 |
| `elements['info']['sd']` | array | 已发现子元素，`sd1~sdn` = 1 |

---

## 十五、其他特殊变量

| 变量 | 类型 | 说明 |
|------|------|------|
| `$achievement` | array | 已废弃属性 |
| `$opendialog` | string | 当前打开的对话框ID |
| `$cdover` | int | 冷却结束时间戳（毫秒） |
| `$rmcdtime` | int | 剩余冷却时间（毫秒） |
| `$cmdcdtime` | int | 命令冷却时间 |
| `$hpls_flag` | int | 隐藏地点标记 |
| `$rename` | string | 改名相关 |
| `$ntitm` | int | 新物品位置 |
| `$TEMPLATEID_OVERRIDE` | int\|null | 模板覆盖ID |
| `$TPLDIR_OVERRIDE` | string\|null | 模板覆盖路径 |

---

## 十六、禁区系统函数

> 定义于`include/gamectl/deatharea.func.php`，在`common.inc.php`中`system.func.php`之后加载。统一封装了项目中散落的禁区判断逻辑，替代了`array_search($id, $arealist) <= $areanum`等重复表达式。

### 区域类型判断

| 函数 | 参数 | 返回值 | 说明 |
|------|------|--------|------|
| `is_death_area($area_id)` | int | bool | 是否为禁区（定时淘汰玩家的区域） |
| `is_safe_area($area_id)` | int | bool | 是否为安全区（非禁区或hack激活） |
| `is_danger_area($area_id)` | int | bool | 是否为危险区（NPC躲避的区域，如深渊、SCP） |
| `is_event_area($area_id)` | int | bool | 是否为特殊事件区域（触发独立脚本） |

### 区域列表获取

| 函数 | 参数 | 返回值 | 说明 |
|------|------|--------|------|
| `get_death_areas()` | — | array | 当前所有禁区编号列表 |
| `get_safe_areas()` | — | array | 当前所有安全区编号列表 |
| `get_next_death_areas($batch, $exact)` | int, bool | array | 下一批/下下批禁区列表 |
| `get_death_areas_with_future($extra)` | int | array | 当前禁区+未来N批合并列表（管理后台） |
| `get_safe_areas_ex($exclude)` | bool | array | 安全区列表（可选排除`$danger_areas`） |

### 辅助函数

| 函数 | 说明 |
|------|------|
| `get_areainfo_html()` | 生成禁区展示HTML |
| `get_death_area_count()` | 获取禁区总数索引 |
| `get_area_add_count()` | 获取每次增加禁区数量 |
| `is_hack_active()` | 判断禁区是否被hack解除 |
| `get_next_area_time()` | 获取下次禁区到来时间戳 |

### 相关全局变量

| 变量 | 类型 | 定义来源 | 说明 |
|------|------|----------|------|
| `$arealist` | array | `load_gameinfo()` | 所有区域编号的随机排列（禁区出现顺序） |
| `$areanum` | int | `load_gameinfo()` | 当前禁区指针，`$arealist[0]~$arealist[$areanum]`为禁区 |
| `$areatime` | int | `load_gameinfo()` | 下次增加禁区时间戳 |
| `$areawarn` | int | `load_gameinfo()` | 是否已发出禁区警告 |
| `$areaadd` | int | `config('gamecfg')` | 每次增加禁区数量 |
| `$areahour` | int | `config('gamecfg')` | 禁区增加间隔（小时） |
| `$arealimit` | int | `config('gamecfg')` | 禁区增加次数上限 |
| `$areaesc` | int | `config('gamecfg')` | 自动躲避禁区模式 |
| `$hack` | int | `load_gameinfo()` | 禁区Hack解除标志 |
| `$danger_areas` | array | `config('resources')` | NPC危险区列表，原名`$deepzones` |
| `$event_areas` | array | `config('resources')` | 特殊事件区域列表 |
| `$npc_away_from_danger_areas` | int | `config('gamecfg')` | NPC是否避开危险区，原名`$npc_away_from_deepzones` |

### 命名对照表

| 旧名称 | 新名称 | 说明 |
|--------|--------|------|
| `$deepzones` | `$danger_areas` | NPC危险区全局变量 |
| `$npc_away_from_deepzones` | `$npc_away_from_danger_areas` | NPC避开危险区开关 |
| `get_safe_plslist()` | `get_safe_areas()` / `get_safe_areas_ex()` | 获取安全区列表（已废弃，保留兼容） |
| `$safepls` / `$safe_pls` | `$safe_areas` | 安全区局部变量 |
| `$pls == 34` / `$rmap == 34` | `is_event_area($id)` | 特殊事件区域判断 |

---

## 十七、常见使用模式

### 物品变量动态访问

```php
// 6格物品栏通过变量变量访问
$itm = &${'itm' . $itmn};
$itmk = &${'itmk' . $itmn};
$itme = &${'itme' . $itmn};
$itms = &${'itms' . $itmn};
$itmsk = &${'itmsk' . $itmn};
$itmpara = &${'itmpara' . $itmn};
```

### 玩家数据提取

```php
// 在command.php中，玩家数据通过extract()展开
$pdata['clbpara'] = get_clbpara($pdata['clbpara']);
extract($pdata, EXTR_REFS);
// 之后$pid, $name, $hp, $itm1, $itm2...等全部可用
```

### 配置加载

```php
// config()返回文件路径，require将变量注入当前作用域
require config('gamecfg', $gamecfg);  // 加载gamecfg_1.php
// 之后$hp_limit, $sp_limit等变量全部可用
```

### clbpara 读写

```php
// 读取：使用前必须先get_clbpara()解析
$pdata['clbpara'] = get_clbpara($pdata['clbpara']);
extract($pdata, EXTR_REFS);

// 读取技能等级
$slvl = $clbpara['skillpara']['c2_intuit']['lvl'] ?? 0;
// 读取任务进度
$qstep = $clbpara['quest']['active'][$questId]['step'] ?? 0;
// 读取随机种子
$rv = $clbpara['randver1'];

// 写入：修改后必须json_encode存回数据库
$clbpara['battle_turns'] = $clbpara['battle_turns'] ?? 0;
$clbpara['battle_turns']++;
```
