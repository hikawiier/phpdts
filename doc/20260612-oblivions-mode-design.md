# OBLIVIONS 遗忘之境 — 单人 PvE 模式设计方案

> 日期: 2026-06-12  
> 状态: 设计阶段

---

## 一、项目代码结构分析总结

### 1.1 整体架构

```
请求入口:
  index.php   → 首页/房间管理
  valid.php   → 玩家参赛注册
  game.php    → 游戏主页面
  command.php → AJAX 指令处理中心
  chat.php    → 聊天系统

核心初始化链:
  common.inc.php → 加载配置、数据库连接、用户认证
                → load_gameinfo() 加载当前游戏状态
                → 游戏状态机运行（gamestate.func.php）
                → 禁区系统检查（deatharea.func.php）

数据层:
  game 表（gtablepre）: 房间信息（groomid, gamestate, gruleset, groomnums...）
  players 表（tablepre）: 每局玩家数据，小房间表前缀 = tablepre + 's' + groomid + '_'
```

### 1.2 关键系统分析

**房间系统** (`include/room/roommng.func.php`):
- 房间创建/加入/退出/解散
- 房间通过 `groomid` 标识，0 为大房间（公共房间）
- 每个房间有独立的数据库表前缀，实现数据隔离

**RuleSet 系统** (`gamedata/ruleset/ruleset_config.php` + `gamedata/ruleset/ruleset_config_data.php`):
- 通过 `gruleset` 字段标识房间使用的规则集
- 支持自定义头像、覆盖函数、初始配置
- 现有 RuleSet: YELLOWKNIFE, ACBRA_2009, ACDTS_2011, ACDTS_298SP4, ACDTS_298SP4_AR
- 覆盖函数通过 `include/room/ruleset_override.func.php` 动态加载

**游戏状态机** (`include/gamectl/gamestate.func.php`):
```
状态转换链（每请求执行一次）:
  gamestate_try_prepare()    → 0→10  准备阶段
  gamestate_try_start()      → 10→20 游戏开始
  gamestate_try_add_area()   → 20    禁区推进（循环）
  gamestate_try_stop_valid() → 20→30 停止激活
  gamestate_try_combo()      → 30→40 连斗模式
  gamestate_try_anti_afk()   → 40    反挂机
  gamestate_try_gameover()   → 40    游戏结束判定
```

**禁区系统** (`include/gamectl/deatharea.func.php`):
- `$arealist` 随机排列的区域列表
- `$areanum` 当前禁区指针
- `is_death_area($area_id)` / `is_safe_area($area_id)` 判断函数
- 每次 `add_once_area()` 推进禁区，淘汰区域内玩家
- `$hack` 标志可解除禁区
- 禁区初始化在 `rs_init_areas()` 中（`include/gamectl/system.func.php` L117）

**游戏结束** (`include/gamectl/system.func.php` L723):
- `gameover($time, $mode, $winname)` 处理结算
- 结束模式: 0=故障, 1=全灭, 2=最后幸存者, 3=禁区解除, 4=无人参加, 5=核爆, 6=GM中止
- 结算流程: 胜负判定 → 记录优胜者 → 成就检查 → 重置状态 → 积分结算

**VEX 模板系统** (`vex/index.html`):
- 独立的前端 SPA 模板，位于 `vex/` 目录
- 由 `is_rich_template_enabled()` 控制（`include/game/render.func.php`），检查 `u_templateid` 为 0 或 2
- 通过 JS 模块（`data.js`, `player.js`, `map.js`, `inventory.js`, `log.js`, `app.js`）渲染游戏界面
- 与旧 PHP 模板（`templates/default/`, `templates/luluxia/`, `templates/nouveau/`）是两套平行的前端

---

## 二、OBLIVIONS 模式设计

### 2.1 概念定位

**Oblivions（遗忘之境）** 是一个**单人 PvE 探索生存模式**。玩家独自进入一个神秘领域，没有禁区压迫，没有其他玩家竞争。本阶段仅搭建基础框架，结束条件留待后续扩充。

### 2.2 核心规则

| 维度 | 说明 |
|------|------|
| 人数 | **严格单人**，房间满1人后不允许加入 |
| 禁区 | **完全禁用**，不初始化禁区列表，不推进禁区 |
| 模板 | **强制使用 VEX 模板**，访问 `game.php` 时直接跳转到 `vex/index.html` |
| 覆盖系统 | **不使用 RuleSet 配置/函数覆盖系统**，后续将重新设计一套独立的覆盖系统 |
| 资源层 | **暂不调整**，沿用大房间默认资源 |
| 游戏结束 | **不自动结束**，游戏不会因玩家死亡或人数不足而结束。仅 GM 中止（mode 6）或玩家退出/解散房间时终止 |

### 2.3 与 RuleSet 系统的关系

Oblivions 模式**不接入现有的 RuleSet 系统**。具体来说：

- **不注册** `ruleset_config_data.php` 条目
- **不创建** `gamedata/ruleset/OBLIVIONS/` 目录
- **不通过** `ruleset_override.func.php` 加载覆盖函数
- 所有 oblivions 相关的分支逻辑以**内联检查**形式直接写在对应的核心文件中
- `oblivions_is_active()` 作为全局辅助函数定义在 `include/core/global.func.php`，仅通过 `$gruleset === 'OBLIVIONS'` 判断

后续将为 Oblivions 模式重新设计一套独立的覆盖系统，与现有的 RuleSet 覆盖系统完全解耦。

### 2.4 结束条件

**游戏不会自动结束。** 玩家死亡后 HP=0，但游戏状态保持不变，房间继续存在。玩家可以查看死亡画面，然后选择退出或解散房间来终止游戏。

唯二结束途径：
- **GM 强制中止**：管理员通过后台指令关闭房间，触发 `gameover(mode=6)`
- **玩家退出房间**：玩家退出（`roommng_exit_room`）后，`groomnums` 归零，触发 `roommng_close_room()` 自动清空房间

注意：玩家退出时不会调用 `gameover()`，因此不会写入优胜记录、不会结算积分。Oblivions 模式下的"结束"本质上是房间生命周期的终止，而非传统意义上的游戏胜负结算。后续可在此基础之上扩充胜利条件及对应的结算逻辑。

---

## 三、实现方案

### 3.1 需要修改的文件清单

```
修改文件:
  include/core/global.func.php               # 新增 oblivions_is_active() 全局函数
  include/room/roommng.func.php              # 创建房间：oblivions 专用创建逻辑 + 加入房间：单人限制
  include/gamectl/gamestate.func.php         # 状态机：跳过禁区/停止激活/连斗/结束
  include/gamectl/system.func.php            # rs_init_areas: 跳过禁区初始化
  include/gamectl/deatharea.func.php         # get_areainfo_html: oblivions 返回空
  valid.php                                  # 入场：oblivions 分支（单人特殊处理）
  game.php                                   # OBLIVIONS 房间 → 跳转 vex/index.html
```

### 3.2 全局模式判断函数

在 `include/core/global.func.php` 中添加：

```php
/**
 * 判断当前是否为 Oblivions 单人模式
 * 不依赖 RuleSet 覆盖系统，直接通过 gruleset 字段判断
 */
function oblivions_is_active() {
    global $gruleset;
    return isset($gruleset) && $gruleset === 'OBLIVIONS';
}
```

### 3.3 房间创建

在 `include/room/roommng.func.php` 中新增 `roommng_create_oblivions_room()` 函数：

```php
/**
 * 创建 Oblivions 单人房间
 * 不通过 RuleSet 系统，直接写入 game 表
 */
function roommng_create_oblivions_room(&$udata) {
    global $db, $gtablepre, $rerror;

    if (!empty($udata['roomid'])) {
        $rerror = 'alreay_in_room';
        return;
    }

    // 生成唯一房间号
    $rkey = roommng_generate_rkey();
    $now = time();

    $db->query("INSERT INTO {$gtablepre}game (groomid, gamestate, gruleset, groomnums, gvalidnum, garenum, gstarttime)
        VALUES ('$rkey', 0, 'OBLIVIONS', 0, 0, 0, $now)");

    $udata['roomid'] = $rkey;
    $db->query("UPDATE {$gtablepre}users SET roomid='$rkey' WHERE username='{$udata['username']}'");
}
```

在 `index.php` 中新增路由 `roomact=create_oblivions`，调用上述函数。

### 3.4 单人限制

在 `include/room/roommng.func.php` 的 `roommng_join_room()` 函数中添加：

```php
function roommng_join_room($rkey, &$udata) {
    global $db, $gtablepre, $rerror;

    if (!empty($udata['roomid'])) {
        $rerror = 'alreay_in_room';
        return;
    }

    $result = $db->query("SELECT * FROM {$gtablepre}game WHERE groomid='$rkey'");
    if ($db->num_rows($result)) {
        $gdata = $db->fetch_array($result);

        // OBLIVIONS 模式：单人限制
        if (!empty($gdata['gruleset']) && $gdata['gruleset'] === 'OBLIVIONS' && $gdata['groomnums'] >= 1) {
            $rerror = 'oblivions_single_player';
            return;
        }

        // ... 原有加入逻辑 ...
    }
    // ...
}
```

### 3.5 游戏状态机变更

在 `include/gamectl/gamestate.func.php` 中修改四个函数：

**① `gamestate_try_add_area()` — 跳过禁区推进：**

```php
function gamestate_try_add_area() {
    global $gamestate, $now, $areatime, $areahour;
    global $areawarn, $areawarntime;

    // OBLIVIONS 模式：无禁区系统，直接跳过
    if (oblivions_is_active()) {
        return false;
    }

    // ... 原有逻辑不变 ...
}
```

**② `gamestate_try_stop_valid()` — 跳过停止激活：**

```php
function gamestate_try_stop_valid() {
    global $gamestate, $arealimit, $validnum, $areanum, $areaadd, $validlimit, $areatime;

    // OBLIVIONS 模式：跳过停止激活，单人模式不需要此逻辑
    if (oblivions_is_active()) {
        return false;
    }

    // ... 原有逻辑不变 ...
}
```

**③ `gamestate_try_combo()` — 跳过连斗：**

```php
function gamestate_try_combo() {
    global $gamestate, $now, $alivenum, $combolimit;
    global $combonum, $deathnum, $deathlimit, $validnum, $deathdeno, $deathnume;

    // OBLIVIONS 模式：单人模式不需要连斗机制
    if (oblivions_is_active()) {
        return false;
    }

    // ... 原有逻辑不变 ...
}
```

**④ `gamestate_try_gameover()` — 永远不自动结束：**

```php
function gamestate_try_gameover() {
    global $gamestate, $db, $tablepre, $alivenum;

    // OBLIVIONS 模式：游戏不自动结束，死亡/人数不足均不触发 gameover
    // 仅 GM 中止或玩家退出/解散房间可终止游戏
    if (oblivions_is_active()) {
        return false;
    }

    // 原逻辑
    if ($gamestate >= 40) {
        $result = $db->query("SELECT pid FROM {$tablepre}players WHERE hp>0 AND type=0");
        $alivenum = $db->num_rows($result);
        save_gameinfo();
        if ($alivenum <= 1) {
            gameover();
            return true;
        }
    }
    return false;
}
```

### 3.6 禁区初始化跳过

在 `include/gamectl/system.func.php` 的 `rs_init_areas()` 函数开头添加：

```php
function rs_init_areas() {
    global $starttime, $areahour, $areatime, $plsinfo, $arealist, $areanum, $weather, $rswtharr, $hack;

    // OBLIVIONS 模式：不初始化禁区系统
    if (oblivions_is_active()) {
        $arealist = array(0);
        $areanum = 0;
        $areatime = 0;
        $weather = $rswtharr[array_rand($rswtharr)];
        $hack = 0;
        return;
    }

    // ... 原有逻辑不变 ...
}
```

### 3.7 禁区展示函数适配

在 `include/gamectl/deatharea.func.php` 的 `get_areainfo_html()` 中添加：

```php
function get_areainfo_html() {
    global $plsinfo, $arealist, $areanum, $areaadd, $areatime, $areahour;

    // OBLIVIONS 模式：无禁区，返回空
    if (oblivions_is_active()) {
        return '';
    }

    // ... 原有逻辑不变 ...
}
```

### 3.8 VEX 模板强制跳转

在 `game.php` 中，于玩家认证之后、模板渲染之前，添加 OBLIVIONS 模式跳转逻辑：

```php
// 在 game.php 中，$pdata = game_entrypoint('game') 之后添加:

// OBLIVIONS 模式：强制使用 VEX 模板
if (oblivions_is_active()) {
    header("Location: vex/index.html");
    exit();
}
```

跳转时机：在 `common.inc.php` 完成初始化、`game_entrypoint()` 完成认证后立即跳转。此时 `$gruleset` 已加载，`oblivions_is_active()` 可用。

`vex/index.html` 是一个纯前端 SPA，它通过 `api.php` / `api_v2.php` 拉取游戏数据，通过 `command.php` 发送指令。因此跳转后不影响游戏功能，只是前端渲染层从 PHP 模板切换为 VEX。

### 3.9 玩家入场 (valid.php)

在标准 `valid.php` 中，入场逻辑之前添加 oblivions 分支：

```php
// 在 valid.php 中，参赛入口处添加:

// OBLIVIONS 模式：单人入场特殊处理
if (oblivions_is_active()) {
    // 不需要 $iplimit 检查（单人模式）
    // 不需要 $validlimit 检查（停止激活逻辑已跳过）
    // 入场后重定向到 vex/index.html 而非 game.php
    $valid_url = 'vex/index.html';
} else {
    $valid_url = 'game.php';
}
```

通过 `$valid_url` 变量控制入场后的重定向目标，避免创建独立的 `valid.php` 文件。

---

## 四、数据流总结

```
玩家创建 OBLIVIONS 房间
  → index.php: roomact=create_oblivions
  → roommng_create_oblivions_room(): 插入 game 表，gruleset='OBLIVIONS'

玩家加入房间
  → roommng_join_room(): 检查 groomnums >= 1 → 拒绝（单人限制）

玩家入场参赛
  → valid.php: oblivions_is_active() → 跳过 iplimit/validlimit 检查
  → 重定向到 vex/index.html
  → rs_game(1+2+4+8+16+32): rs_init_areas() 检测 oblivions 模式 → 跳过禁区初始化

游戏运行中（每请求，command.php / api.php）
  → gamestate_try_add_area(): oblivions 模式 → return false
  → gamestate_try_stop_valid(): oblivions 模式 → return false
  → gamestate_try_combo(): oblivions 模式 → return false
  → gamestate_try_gameover(): oblivions 模式 → return false（永不自动结束）

游戏终止（仅两种途径）
  → GM 后台关闭房间 → roommng_close_room() → gameover(mode=6)
  → 玩家退出房间 → roommng_exit_room() → groomnums 归零 → roommng_close_room()

访问 game.php（OBLIVIONS 房间）
  → game_entrypoint() 认证通过
  → oblivions_is_active() → header("Location: vex/index.html")
```

---

## 五、代码改动量评估

| 文件 | 改动类型 | 改动量 |
|------|---------|--------|
| `include/core/global.func.php` | 新增函数 | +7 行 |
| `include/room/roommng.func.php` | 新增函数 + 条件分支 | +25 行 |
| `include/gamectl/gamestate.func.php` | 4 处条件分支 | +16 行 |
| `include/gamectl/system.func.php` | 1 处条件分支 | +8 行 |
| `include/gamectl/deatharea.func.php` | 1 处条件分支 | +4 行 |
| `valid.php` | 1 处条件分支 | +6 行 |
| `game.php` | 1 处条件分支 | +4 行 |
| `index.php` | 1 个新路由 | +3 行 |
| **总计** | | **约 73 行** |

## 六、前端适配要点

1. 房间列表需显示 OBLIVIONS 模式的特殊标识（"遗忘之境" 名称）
2. 游戏界面不需要显示禁区信息（`areainfo` 为空）
3. 不需要显示其他玩家信息（因为只有一个人）
4. VEX 模板的 `data.js` 可能需要适配 OBLIVIONS 模式下的特殊数据字段（如隐藏禁区面板），但属于前端范畴，不阻塞后端实现