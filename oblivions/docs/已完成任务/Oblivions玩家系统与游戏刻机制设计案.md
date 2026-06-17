# Oblivions 玩家系统与游戏刻机制设计案

> 建立 Oblivions 模式独立的数据层（oblplayers 表）和游戏刻驱动机制，作为 NPC 敌人系统和战斗系统的基础设施。
>
> **设计原则**：Oblivions 独立于旧模式，非不得已不调用旧项目代码（仅修改 command.php、common.inc.php、system.func.php）。

---

## 一、设计目标

### 1.1 核心目标

1. **独立的 oblplayers 表**：玩家+敌人统一存储，参考 bra_players 但精简字段，道具栏改用 JSON 大字段
2. **独立的认证与数据抓取函数**：3 个模块（user 表校验、fetch 数据、格式化数据），玩家与 NPC 共用
3. **游戏刻机制**：双变量（obl_tick / obl_pretick），common.inc 检测并驱动后续系统（NPC AI、buff/dot 等）
4. **玩家数据初始化**：游戏开始时为每个玩家创建 oblplayers 记录

### 1.2 非目标

- NPC 敌人生成与 AI（见《Oblivions NPC 敌人系统设计案》）
- 战斗系统
- 技能系统（skillpara 预留字段，不定义内容）

---

## 二、oblplayers 表设计

### 2.1 表结构

```sql
DROP TABLE IF EXISTS oblplayers;
CREATE TABLE oblplayers (
  -- 身份与认证
  pid          smallint unsigned NOT NULL auto_increment,
  type         tinyint NOT NULL default '0',       -- 0=玩家, >0=敌人类型
  name         char(40) NOT NULL default '',
  pass         char(32) NOT NULL default '',       -- 双重校验（与 user 表）
  gd           char(1) NOT NULL default 'm',
  icon         varchar(255) NOT NULL default '0',

  -- 战斗状态
  action       char(12) NOT NULL default '',       -- null/prebattle/battle
  bid          smallint unsigned NOT NULL default '0',  -- 战斗目标 pid

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

  -- 装备（7 槽 × 6 字段，保留固定字段结构）
  wep char(30) NOT NULL default '', wepk char(40) not null default '', wepe int(10) unsigned NOT NULL DEFAULT '0', weps char(10) not null default '0', wepsk char(40) not null default '', weppara text not null,
  wep2 char(30) NOT NULL default '', wep2k char(40) not null default '', wep2e int(10) unsigned NOT NULL DEFAULT '0', wep2s char(10) not null default '0', wep2sk char(40) not null default '', wep2para text not null,
  arb char(30) NOT NULL default '', arbk char(40) not null default '', arbe int(10) unsigned NOT NULL DEFAULT '0', arbs char(10) not null default '0', arbsk char(40) not null default '', arbpara text not null,
  arh char(30) NOT NULL default '', arhk char(40) not null default '', arhe int(10) unsigned NOT NULL DEFAULT '0', arhs char(10) not null default '0', arhsk char(40) not null default '', arhpara text not null,
  ara char(30) NOT NULL default '', arak char(40) not null default '', arae int(10) unsigned NOT NULL DEFAULT '0', aras char(10) not null default '0', arask char(40) not null default '', arapara text not null,
  arf char(30) NOT NULL default '', arfk char(40) not null default '', arfe int(10) unsigned NOT NULL DEFAULT '0', arfs char(10) not null default '0', arfsk char(40) not null default '', arfpara text not null,
  art char(30) NOT NULL default '', artk char(40) not null default '', arte int(10) unsigned NOT NULL DEFAULT '0', arts char(10) not null default '0', artsk char(40) not null default '', artpara text not null,

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
) ENGINE=MyISAM;
```

### 2.2 相对 bra_players 的变更

**删除的字段**：
- 身份：`race, sNo, club`
- 时间：`endtime, validtime, deathtime, cmdnum`
- 技能：`nick, nicks, skillpoint, skills`
- 冷却：`cdsec, cdmsec, cdtime, horizon`
- 属性：`ss, mss`（灵魂值）
- 进度：`money, rp, inf, rage, pose, tactic, killnum`
- 熟练度：`wp, wk, wg, wc, wd, wf`
- 队伍：`teamID, teamPass, teamIcon`
- 扩展背包：`extrabag_put, extrabag, extrabag_num, extrabag_max`
- 特殊系统：`flare, dcloak, auraa~e, souls, debuffa~c, vcode, statusa~e, clbstatusa~e, nikstatusa~e, element0~5`
- 旧扩展：`clbpara`（技能数据迁移到 skillpara）
- 道具栏：`itm0~itm6` + 对应 `itmk/itme/itms/itmsk/itmpara`（42 字段，合并为 itempara JSON）

**新增的字段**：
- `ap, max_ap`：AP 值（独立字段，便于频繁读写）
- `itempara`：道具栏 JSON 大字段（替代 itm0~itm6，遵循旧字段命名 + itmid，支持可变格子数）
- `itemmaxslots`：道具栏最大格数（初始 6 格，未来可扩展）
- `tacpara`：策略槽（JSON），战斗系统用
- `skillpara`：技能数据（JSON），替代 clbpara 的技能存储
- `oblpara`：杂项功能数据（JSON），灵活扩展
- `discovered`：敌人发现状态

### 2.3 JSON 字段格式

#### itempara（道具栏）

```json
[
    {
        "itm": "废铁片",
        "itmk": "XX",
        "itme": 1,
        "itms": "0",
        "itmsk": "",
        "itmpara": {},
        "itmid": "123"
    },
    null,
    {
        "itm": "急救包",
        "itmk": "YY",
        "itme": 3,
        "itms": "0",
        "itmsk": "",
        "itmpara": {"obl_item_id": 456},
        "itmid": "456"
    }
]
```

- JSON 数组，每个元素是一个道具对象或 null（空槽）
- 道具对象遵循七字段规范：`itm/itmk/itme/itms/itmsk/itmpara/itmid`（与 oblmapitem 表字段命名一致）
  - `itm`：道具名 / `itmk`：道具类型 / `itme`：效果值 / `itms`：耐久 / `itmsk`：技能 / `itmpara`：道具参数（JSON 对象）/ `itmid`：地图道具实例 ID（字符串，丢弃时还原）
- `itmpara` 本身也是 JSON 对象（嵌套 JSON，标准支持），保持原始数据，不注入 obl_item_id
- `itmid` 为独立字段，不再嵌在 itmpara 里
- **格子数可变**：数组长度即格子数（0~itemmaxslots），MVP 默认 itemmaxslots=6（+特殊槽 0=共 7 格），未来可扩展
- 索引 0 = 特殊槽位，1~itemmaxslots = 普通槽位

#### tacpara（策略槽）

```json
{
    "slots": [
        {"type": "skill", "id": "basic_attack"},
        {"type": "item", "slot": 1},
        null,
        null
    ]
}
```

- 1-4 个槽位
- 每槽放 1 个技能或 1 件道具，或为 null
- 战斗中不可修改

#### skillpara（技能数据）

```json
{
    "skills": ["basic_attack", "escape", "move_step"]
}
```

- `skills`：已学技能 ID 数组
- AP 已移出为独立字段

#### oblpara（杂项）

```json
{
    "ai_type": "patrol",
    "vision_range": 3,
    "killnum": 0
}
```

- `ai_type`：AI 行为类型（敌人用）
- `vision_range`：感知范围（敌人用）
- `killnum`：击杀数（如需要）
- 其他杂项数据按需扩展

---

## 三、认证与数据抓取函数

### 3.1 新建文件

`oblivions/include/game/player.func.php`

### 3.2 三个模块

```php
<?php
// 模块 1：user 表对比信息检验
function obl_auth_player($username, $password) {
    // 从 user 表校验用户名密码
    // 返回 pid 或 false
}

// 模块 2：从 oblplayers 抓取数据（玩家和 NPC 共用）
function obl_fetch_playerdata_by_pid($pid) {
    // SELECT * FROM oblplayers WHERE pid = $pid
    // 返回原始数据数组
}

// 模块 3：格式化 player 数据（玩家和 NPC 共用）
function obl_format_playerdata(&$pdata) {
    // 解码 JSON 字段：itempara, tacpara, skillpara, oblpara
    // 类似 check_player_misc_states() 对 clbpara/itmpara 的处理
    // 防止"怪东西"
}
```

### 3.3 完整认证流程

```
用户登录
    ↓
obl_auth_player($username, $password)
    ↓ 校验 user 表，返回 pid
obl_fetch_playerdata_by_pid($pid)
    ↓ 从 oblplayers 抓取原始数据
obl_format_playerdata($pdata)
    ↓ 解码 JSON 字段
    ↓ 返回格式化后的 $pdata
```

### 3.4 辅助函数

```php
// 通过 name 抓取玩家数据（type=0）
function obl_fetch_playerdata_by_name($name) {
    // SELECT * FROM oblplayers WHERE name = '$name' AND type = 0
    // obl_format_playerdata($data)
    // return $data
}

// 批量获取指定区域的敌人（type > 0）
function obl_fetch_enemies_by_region($pgroup) {
    // SELECT * FROM oblplayers WHERE type > 0 AND pgroup = $pgroup
    // 循环 obl_format_playerdata
    // return $enemies[]
}

// 保存玩家数据到数据库
function obl_save_player(&$pdata) {
    // 编码 JSON 字段：itempara, tacpara, skillpara, oblpara
    // UPDATE oblplayers SET ... WHERE pid = $pdata['pid']
}
```

### 3.5 command.php 改动

command.php 顶部采用双分支架构，Oblivions 模式接管整个请求生命周期：

```php
// Oblivions 模式分支：独立认证 + 数据层 + SPA 响应
if (oblivions_is_active()) {
    require GAME_ROOT.'./oblivions/include/game/player.func.php';
    $pdata = obl_game_entrypoint('command');  // 封装认证流程

    // [B] 精简初始化（不使用 extract，不调用 init_playerdata()）
    // [C] 路由分发（跳过传统预检查：眩晕/冷却/对话框/追击/物品索引）
    // [D] 结构化日志持久化（替代 $log HTML 字符串）
    // [E] 游戏刻推进（黑名单机制）
    // [F] obl_save_player($pdata)（替代 player_save）
    // [G] 响应组装（SPA 精简版 JSON，跳过传统模板渲染）
    exit;
}

// 传统模式（原逻辑保持不变）
$pdata = game_entrypoint('command');
```

**Oblivions 分支与传统模式的区别**：
- 不使用 `extract`，直接操作 `$pdata` 数组
- 跳过 `init_playerdata()` 及传统预检查（眩晕/冷却/对话框/追击/物品索引）
- 跳过模板渲染，直接输出 JSON 响应（SPA 前端消费）
- `obl_save_player()` 替代 `player_save()`，且不同步任何数据到 bra_players

`obl_game_entrypoint()` 内部调用 3 个模块（auth → fetch → format）。

---

## 四、道具栏系统重构

### 4.1 重构原因

道具栏从 `itm0~itm6`（42 字段）改为 `itempara`（1 个 JSON 字段），需要重构现有的探索/拾取/丢弃系统。

### 4.2 涉及函数

| 函数 | 文件 | 改动 |
|------|------|------|
| `obl_pickup_item()` | `oblivions/include/game/explore.func.php` | 改用 itempara 读写 |
| `obl_discard_item()` | 同上 | 改用 itempara 读写 |
| `handle_player_inventory()` | `api_v2.php` | 改用 itempara 渲染 |
| 前端 `inventory.js` | `vex/js/inventory.js` | 适配新数据结构 |

### 4.3 新增辅助函数

`oblivions/include/game/player.func.php` 新增：

```php
// 获取道具栏数组
function obl_get_items(&$pdata) {
    return $pdata['itempara'];  // 已格式化为数组
}

// 获取指定槽位的道具
function obl_get_item(&$pdata, $slot) {
    return $pdata['itempara'][$slot] ?? null;
}

// 设置指定槽位的道具
function obl_set_item(&$pdata, $slot, $item) {
    $pdata['itempara'][$slot] = $item;
}

// 找空槽位（返回索引或 false）
function obl_find_empty_slot(&$pdata) {
    for ($i = 1; $i <= 6; $i++) {  // 1-6 为普通槽位，0 为特殊
        if ($pdata['itempara'][$i] === null) {
            return $i;
        }
    }
    return false;
}

// 检查背包是否已满
function obl_is_bag_full(&$pdata) {
    return obl_find_empty_slot($pdata) === false;
}
```

### 4.4 拾取函数改造示例

```php
// 原逻辑（简化）：
// 找空槽位 itm1~itm6
// $pdata['itm'.$slot] = $item['itm'];
// $pdata['itmk'.$slot] = $item['itmk'];
// ...

// 新逻辑：
function obl_pickup_item($iid, &$pdata) {
    // ... 校验逻辑不变 ...

    $slot = obl_find_empty_slot($pdata);
    if ($slot === false) {
        // 背包已满
        return;
    }

    $item = array(
        'name' => $map_item['itm'],
        'kind' => $map_item['itmk'],
        'exp' => $map_item['itme'],
        'sk' => $map_item['itms'],
        'skk' => $map_item['itmsk'],
        'para' => json_decode($map_item['itmpara'], true) ?: [],
    );
    $item['para']['obl_item_id'] = $map_item['iid'];

    obl_set_item($pdata, $slot, $item);
    // ... 删除地图道具 ...
}
```

---

## 五、游戏初始化

### 5.1 rs_init_oblivions 扩展

在 `include/gamectl/system.func.php` 的 `rs_init_oblivions()` 中扩展：

```php
function rs_init_oblivions() {
    // ... 现有逻辑（建表、POI、道具、迷雾）...

    // 新增：初始化游戏刻
    $gamevars['obl_tick'] = 0;
    $gamevars['obl_pretick'] = 0;

    // 玩家数据初始化在 valid.php 激活时逐个创建（见 §5.2），不在此处批量创建
}
```

### 5.2 玩家数据初始化

```php
function obl_create_player_record($ndata) {
    // 在 valid.php 玩家激活时调用（非 rs_init_oblivions 阶段）
    // 参数 $ndata 为 valid.php 构建的 bra_players 格式数据
    // 从 $ndata 提取通用字段（name, pass, gd, icon, hp, mhp 等）
    // 添加 Oblivions 专属字段：
    //   ap = 0, max_ap = 10
    //   itempara = [null, null, null, null, null, null, null]  // 7 格（0~itemmaxslots）
    //   itemmaxslots = 6
    //   tacpara = {"slots": [null, null, null, null]}
    //   skillpara = {"skills": []}
    //   oblpara = {}
    //   discovered = 0
    // INSERT 到 oblplayers 表
}
```

**时机**：valid.php 玩家激活时（而非 rs_init_oblivions 阶段）。

**原因**：rs_init_oblivions 跑在 `rs_game(64)` 阶段，此时 bra_players 刚被重建，里面没有任何玩家数据，无法批量创建 oblplayers 记录。改为 valid.php 激活时逐个创建，是自然的时机。

**与 bra_players 的关系**：bra_players 仍由 valid.php 原逻辑插入（开发阶段防御性保留），但 Oblivions 模式不依赖 bra_players：
- `obl_save_player()` 不同步任何数据到 bra_players
- `save_gameinfo()` 在 obl 模式下跳过 bra_players 查询，alivenum/deathnum/validnum 直接默认 0
- 未来完整完成后可清理 bra_players 相关代码

---

## 六、游戏刻机制

### 6.1 双变量设计

- `obl_tick`：当前游戏刻，由玩家行为驱动
- `obl_pretick`：已处理到的游戏刻

### 6.2 tick 推进（command.php）

在 command.php 的命令结算后、`player_save` 前推进 tick：

```php
// command.php 尾部（后处理阶段）
if (oblivions_is_active()) {
    // 判断当前命令是否推进 tick（黑名单机制）
    if (obl_command_advances_tick($command)) {
        $gamevars['obl_tick']++;
    }
}

// 黑名单：不推进 tick 的命令
function obl_command_advances_tick($command) {
    $no_tick_commands = [
        // 'obl_organize_bag',  // 整理背包（未来）
        // 'obl_view_notes',    // 查看笔记（未来）
    ];
    return !in_array($command, $no_tick_commands);
}
```

**规则**：不在黑名单里的命令都推进 tick，不需要双重判断。

### 6.3 tick 事件处理（common.inc.php）

在 common.inc.php 中插入检查逻辑：

```php
// common.inc.php（公共初始化阶段）
if (oblivions_is_active() && isset($gamevars['obl_tick'])) {
    if ($gamevars['obl_pretick'] < $gamevars['obl_tick']) {
        // 执行 tick 更新事件
        obl_resolve_tick_events($gamevars['obl_tick'] - $gamevars['obl_pretick']);
        // 同步 pretick
        $gamevars['obl_pretick'] = $gamevars['obl_tick'];
        // 保存 gamevars
        save_gamevars($gamevars);
    }
}
```

### 6.4 tick 事件内容

```php
function obl_resolve_tick_events($delta) {
    for ($i = 0; $i < $delta; $i++) {
        // 1. 全局结算敌人 AI（所有敌人，不管 discovered）
        // obl_resolve_all_enemy_ai();  // NPC 设计案实现
        // 2. buff/dot 结算（未来扩展）
        // obl_resolve_buffs_dots();
    }
}
```

**注意**：本设计案只搭建 tick 机制框架，具体的 NPC AI 结算在《Oblivions NPC 敌人系统设计案》中实现。

### 6.5 完整流程

```
请求1: common.inc（pretick==tick，无事件）→ command（obl_move，tick++）
请求2: common.inc（pretick<tick，执行 tick 事件）→ pretick=tick → command（玩家下一操作）
请求3: common.inc（pretick==tick，无事件）→ command（obl_explore，tick++）
请求4: common.inc（pretick<tick，执行 tick 事件）→ pretick=tick → ...
```

---

## 七、文件改动清单

### 7.1 新建文件

| 文件 | 用途 |
|------|------|
| `oblivions/include/game/player.func.php` | 认证与数据抓取函数（3 模块）+ 道具栏辅助函数 |
| `gamedata/sql/oblplayers.sql` | oblplayers 建表语句 |

### 7.2 修改文件

| 文件 | 改动 |
|------|------|
| `include/core/common.inc.php` | 插入 tick 检查逻辑（房间锁内） |
| `command.php` | 双分支架构：Oblivions 分支接管整个请求生命周期（认证+路由+tick+保存+JSON响应） |
| `include/core/global.func.php` | `save_gameinfo()` obl 模式下跳过 bra_players 查询，alivenum/deathnum/validnum 默认 0 |
| `include/gamectl/system.func.php` | rs_init_oblivions 扩展（tick 初始化）；玩家数据初始化移至 valid.php |
| `valid.php` | 玩家激活时调用 `obl_create_player_record()` 创建 oblplayers 记录 |
| `oblivions/include/game/explore.func.php` | `obl_pickup_item` / `obl_discard_item` 改用 itempara（七字段规范） |
| `api_v2.php` | `handle_player_inventory` 改用 itempara（读取 itm/itmk/itme/itms 字段） |
| `vex/js/inventory.js` | 适配新道具栏数据结构（api 对外字段名不变，前端无需改动） |

---

## 八、MVP 范围

### 8.1 包含

- oblplayers 表创建
- 认证与数据抓取函数（3 模块）
- 道具栏系统重构（itempara JSON）
- 游戏刻机制（双变量 + common.inc 检查）
- 玩家数据初始化
- command.php / common.inc.php 改动

### 8.2 不包含

- NPC 敌人生成与 AI（见 NPC 设计案）
- 战斗系统
- 技能系统

---

## 九、测试要点

### 9.1 数据层
- [ ] oblplayers 表创建成功（含 itemmaxslots 字段，默认 6）
- [ ] 玩家认证函数正常工作（user 表校验 + oblplayers 抓取）
- [ ] JSON 字段格式化正确（itempara / tacpara / skillpara / oblpara）
- [ ] 道具栏读写正常（itempara JSON 嵌套 itmpara JSON，含 itmid）

### 9.2 道具栏重构
- [ ] 拾取道具写入 itempara 正确（含 itm/itmk/itme/itms/itmsk/itmpara/itmid 七字段）
- [ ] 丢弃道具从 itempara 删除正确
- [ ] 背包已满判断正确（基于 itemmaxslots）
- [ ] 前端背包渲染正常

### 9.3 游戏刻
- [ ] 玩家移动后 obl_tick 增加
- [ ] common.inc 检测到 tick 变化并执行 tick 事件
- [ ] pretick 同步正确
- [ ] 黑名单命令不推进 tick

### 9.4 初始化
- [ ] 游戏开始时玩家数据正确写入 oblplayers
- [ ] JSON 字段初始化为正确的空值
