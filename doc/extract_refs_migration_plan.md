# extract($pdata, EXTR_REFS) 迁移方案

> 目标：将所有 `extract($pdata, EXTR_REFS)` 替换为直接 `$pdata` 数组访问，消除隐式全局变量，提升代码安全性和可维护性。

---

## 一、代码定位与分析

### 1.1 全量实例清单

经全局搜索，共发现 **11 处** `extract($pdata)` 调用（不含文档/注释）：

| # | 文件 | 行号 | 调用形式 | 类别 |
|---|------|------|----------|------|
| 1 | `command.php` | 32 | `extract($pdata, EXTR_REFS)` | A-入口 EXTR_REFS |
| 2 | `game.php` | 37 | `extract($pdata, EXTR_REFS)` | A-入口 EXTR_REFS |
| 3 | `end.php` | 23 | `extract($pdata)` (无REFS) | B-入口 无REFS |
| 4 | `winner.php` | 14 | `extract($pdata)` (无REFS) | B-入口 无REFS |
| 5 | `include/gamectl/game.func.php` | 17 | `extract($data,EXTR_REFS)` (init_playerdata内部) | C-函数内部 |
| 6 | `include/gamectl/game.func.php` | 43 | `extract($data,EXTR_REFS)` (init_profile内部) | C-函数内部 |
| 7 | `include/gamectl/game.func.php` | 138 | `extract($pdata,EXTR_REFS)` (init_bgm内部) | C-函数内部 |
| 8 | `include/game/encounter.func.php` | 20 | `extract($pdata,EXTR_REFS)` (findteam内部) | C-函数内部 |
| 9 | `include/game/encounter.func.php` | 41 | `extract($pdata,EXTR_REFS)` (findcorpse内部) | C-函数内部 |
| 10 | `include/game/combat/revcombat.func.php` | 299 | `extract($pdata,EXTR_REFS)` | C-函数内部 |
| 11 | `include/game/combat/revcombat.func.php` | 304 | `extract($pdata,EXTR_REFS)` | C-函数内部 |

### 1.2 依赖关系图

```
command.php: extract($pdata, EXTR_REFS)
│
├── 直接访问（command.php 内）
│   ├── $hp, $clbpara, $pls, $pid, $state, $itms0
│   ├── $endtime, $bid, $teamID, $pgroup
│   └── $cdsec, $cdmsec, $cdtime（cmd_router_post_process 写回）
│
├── init_playerdata()    → 内部 extract($data, EXTR_REFS) → $lvl, $exp, $gd, $icon, $clbpara
├── init_profile()       → 内部 extract($data, EXTR_REFS) → 装备栏/物品栏全部字段
├── init_player_log()    → global $pid
├── init_cooldown()      → global $coldtimeon, $cdsec, $cdmsec, $cdtime
├── init_dizzy_check()   → global $clbpara
├── init_club_check()    → global $club, $name
├── init_bgm()           → 内部 extract($pdata, EXTR_REFS)
│
├── resolve_pre_checks() → global $clbpara
├── cmd_router_dispatch()
│   ├── global: $club, $clbpara, $pls, $state, $itms0（pdata来源）
│   ├── global: $plsinfo, $hospitals, $itemcmd, $sp_cmd, $main（非pdata）
│   └── 调用9个handler文件（见下方）
│
├── cmd_router_post_process() → global: $cdsec, $cdmsec, $cdtime, $endtime（写回）
│                               global: $pls, $pid, $arbsk, $arbs, $arbe（只读）
│
└── 响应组装（command.php end部分）
    ├── $clbpara → $gamedata['clbpara']
    ├── $teamID  → $gamedata['value']['teamID']
    └── $pls     → $gamedata['locationId'], $gamedata['innerHTML']['pls']
```

### 1.3 Handler 文件中的 pdata 变量依赖（通过 global）

| Handler 文件 | pdata 来源 global | 非 pdata global |
|-------------|-------------------|-----------------|
| `basic_commands.php` | `$art` | `$coldtimeon`, `$movecoldtime`, `$searchcoldtime`, `$itemusecoldtime`, `$plsinfo`, `$hospitals`, `$state`, `$pls` |
| `itemmain_entry.php` | `$club`, `$clbstatusa` | — |
| `special_dispatch.php` | `${'itmk'.$imn}`, `${'itme'.$imn}`, `${'itm'.$imn}`（动态变量） | `$coldtimeon`, `$weaponswapcoldtime`, `$choice` |
| `misc_commands.php` | `$clbpara` | — |
| `team_handler.php` | — | `$teamcmd` |
| `console_handler.php` | `$clbpara` | `$csc`, `$cwth`, `$csnm`, `$cstype` |
| `dialogue_handler.php` | `$clbpara` | `$dialogue_branch`, `$dialogue_log` |

### 1.4 router.php 内部辅助函数中的 pdata 依赖

- `_dispatch_itemmain_mode()`: `${'mitm'.$i}`, `$arbs`, `$arbe`, `$arbsk`（动态变量 + 装备）
- `_dispatch_special_mode()`: `$club`, `$pls`, `$pose`, `$tactic`, `$horizon`
- `_dispatch_revskpts_mode()`: `${$command.'_nums'}`, `${$sk.'upgpara'}`, `${$sk.'mkey'}`, `${$sk.'fire'}`（动态变量）

---

## 二、变量访问方式转换规则

### 2.1 基础转换

| 旧写法（extract 后） | 新写法（$pdata 数组） |
|---------------------|----------------------|
| `$hp` | `$pdata['hp']` |
| `$pls` | `$pdata['pls']` |
| `$club` | `$pdata['club']` |
| `$state` | `$pdata['state']` |
| `$pid` | `$pdata['pid']` |
| `$name` | `$pdata['name']` |
| `$endtime` | `$pdata['endtime']` |
| `$bid` | `$pdata['bid']` |
| `$teamID` | `$pdata['teamID']` |
| `$cdsec` / `$cdmsec` / `$cdtime` | `$pdata['cdsec']` / `$pdata['cdmsec']` / `$pdata['cdtime']` |

### 2.2 装备栏转换

| 旧写法 | 新写法 |
|--------|--------|
| `$wep` / `$wep2` | `$pdata['wep']` / `$pdata['wep2']` |
| `$arb` / `$arh` / `$ara` / `$arf` / `$art` | `$pdata['arb']` / `$pdata['arh']` / `$pdata['ara']` / `$pdata['arf']` / `$pdata['art']` |
| `$arbs` / `$arbe` / `$arbsk` | `$pdata['arbs']` / `$pdata['arbe']` / `$pdata['arbsk']` |

### 2.3 6格物品栏转换

| 旧写法 | 新写法 |
|--------|--------|
| `$itm1` / `$itmk1` / `$itme1` / `$itms1` / `$itmsk1` / `$itmpara1` | `$pdata['itm1']` / `$pdata['itmk1']` / ... |
| `${'itm'.$imn}` / `${'itmk'.$imn}` | `$pdata['itm'.$imn]` / `$pdata['itmk'.$imn]` |
| `$itm0` / `$itmk0` / ... | `$pdata['itm0']` / `$pdata['itmk0']` / ... |

### 2.4 clbpara 转换

| 旧写法 | 新写法 |
|--------|--------|
| `$clbpara['skill']` | `$pdata['clbpara']['skill']` |
| `$clbpara['quest']` | `$pdata['clbpara']['quest']` |
| `unset($clbpara['dialogue'])` | `unset($pdata['clbpara']['dialogue'])` |

### 2.5 引用写入转换（关键！）

`EXTR_REFS` 意味着修改 `$hp = 10` 等价于 `$pdata['hp'] = 10`。**已经正确传入 `&$pdata` 引用参数的函数无需变化**（如 `cmd_handle_fishing(&$mode, &$pdata)` 中直接读写 `$pdata` 即可）。

**需要特别处理的模式：**

```php
// 旧：通过 global 引用写入（cmd_router_post_process 中）
global $cdsec, $cdmsec, $cdtime, $endtime;
$cdsec = floor($nowmtime / 1000);  // 实际上修改了 $pdata['cdsec']

// 新：通过 &$pdata 引用写入
$pdata['cdsec'] = floor($nowmtime / 1000);
```

### 2.6 动态变量访问转换

```php
// 旧：变量变量
${'itmk' . $imn}
${$command . '_nums'}

// 新：数组访问
$pdata['itmk' . $imn]
// 注意：${$command . '_nums'} 可能来自 $_REQUEST 而非 $pdata
// 需要区分是 pdata 变量还是 request 变量
```

### 2.7 禁止转换的情况

以下变量**不是**来自 `$pdata`，保持不变：

- `$mode`, `$command`, `$action`, `$cmd`, `$itemcmd`, `$sp_cmd` — 来自 `$_REQUEST`
- `$plsinfo`, `$hplsinfo`, `$iteminfo`, `$itemspkinfo` — 来自 `config('resources')`
- `$hp_limit`, `$sp_limit`, `$coldtimeon`, `$movecoldtime` — 来自 `config('gamecfg')`
- `$gamestate`, `$alivenum`, `$areanum`, `$weather` — 来自 `load_gameinfo()`
- `$log`, `$main`, `$cmd`, `$gamedata`, `$error` — 局部变量
- `$cuser`, `$cpass` — 认证变量

---

## 三、分阶段实施计划

### 第0阶段（准备）：建立兼容层 `include/core/pdata_compat.func.php`

创建过渡期兼容层，在不删除 extract 的前提下提供 `$pdata` 访问的统一入口。

```php
<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// pdata 兼容层 / Pdata compatibility layer
// 过渡期：对 key 的读写同时作用于 $pdata 数组和 EXTR_REFS 全局变量
// 迁移完成后移除此文件。

function pdata_get(&$pdata, $key, $default = null) {
    // 读取时：直接从 $pdata 数组读取（extract 已建立引用链接）
    return isset($pdata[$key]) ? $pdata[$key] : $default;
}

function pdata_set(&$pdata, $key, $value) {
    // 写入时：写入 $pdata 即写入全局变量（EXTR_REFS 绑定）
    $pdata[$key] = $value;
}

function pdata_has(&$pdata, $key) {
    return isset($pdata[$key]);
}

// 批量获取多个 key
function pdata_extract(&$pdata, ...$keys) {
    $result = [];
    foreach ($keys as $key) {
        $result[$key] = $pdata[$key] ?? null;
    }
    return $result;
}
```

> 注意：此兼容层**不需要实际使用**，仅作为思维模型。实际转换直接使用 `$pdata['key']` 即等价于旧 `$key`（因为 EXTR_REFS 建立了引用绑定）。

### 第1阶段：command.php 入口文件迁移（核心）

**目标：** 移除 `command.php` 中的 `extract($pdata, EXTR_REFS)`，将 `$pdata` 以引用方式传递给所有消费者。

**步骤：**

1. **删除第32行 `extract($pdata, EXTR_REFS);`**

2. **command.php 中直接使用 `$pdata['key']` 替换全局变量：**

   ```php
   // Line 41: $hp → $pdata['hp']
   if ($pdata['hp'] > 0) {
   
   // Line 86: $clbpara → $pdata['clbpara']
   if (!$just_made_choice && !empty($pdata['clbpara']['dialogue'])) {
       $opendialog = 'dialogue';
       $dialogue_id = $pdata['clbpara']['dialogue'];
   }
   
   // Line 96: $hp → $pdata['hp']
   if ($pdata['hp'] > 0 && $coldtimeon && $showcoldtimer && $rmcdtime) {
   
   // Line 103: $hp → $pdata['hp']
   if ($pdata['hp'] <= 0) {
   
   // Line 104: $endtime → $pdata['endtime']
   $dtime = date("Y年m月d日H时i分s秒", $pdata['endtime']);
   
   // Line 106: $bid → $pdata['bid']
   if ($pdata['bid']) {
       $result = $db->query("SELECT name FROM {$tablepre}players WHERE pid='{$pdata['bid']}'");
   
   // Line 118: $itms0 → $pdata['itms0']
   } elseif ($pdata['itms0']) {
   
   // Line 122: $state → $pdata['state']
   } elseif ($pdata['state'] == 1 || $pdata['state'] == 2 || $pdata['state'] == 3) {
   
   // Line 125: $clbpara → $pdata['clbpara']
   $fishing_count = count($pdata['clbpara']['fishing']['caught_items']);
   
   // Line 152: $pls → $pdata['pls']
   $gamedata['innerHTML']['pls'] = (!isset($plsinfo[$pdata['pls']]) && isset($hplsinfo[$pls_group])) 
       ? $hplsinfo[$pls_group][$pdata['pls']] : $plsinfo[$pdata['pls']];
   $gamedata['locationId'] = $pdata['pls'];
   
   // Line 170: $clbpara → $pdata['clbpara']
   $gamedata['clbpara'] = $pdata['clbpara'];
   
   // Line 171: $teamID → $pdata['teamID']
   $gamedata['value']['teamID'] = $pdata['teamID'];
   if ($pdata['teamID']) {
   
   // Line 165: $pid → $pdata['pid']
   writeover($log_dir . 'log_' . $groomid . '_' . $pdata['pid'] . '.php', $log);
   ```

3. **将 `$pdata` 传入所有需要它的函数调用：**

   ```php
   // Line 57-68: resolve_pre_checks 需要访问 $pdata['clbpara']
   $pre_check = resolve_pre_checks($command, $action, $mode,
       $coldtimeon, $rmcdtime, $sp_cmd, $pdata);
   
   // Line 68: cmd_router_dispatch 已接受 &$pdata，无需修改
   
   // Line 72: cmd_router_post_process 需要 &$pdata（写回 cdsec/cdmsec/cdtime/endtime）
   cmd_router_post_process($action, $gamestate, $pdata['bid'],
       $coldtimeon, $cmdcdtime, $rmcdtime, $now, $pdata);
   ```

4. **更新 `init_playerdata()` 和 `init_profile()` 调用：**
   - 这两个函数内部有 `extract($data, EXTR_REFS)`，需要先迁移（见第3阶段）

5. **`cmd_router_assemble_response()` — 不需要修改：**
   - 该函数在 `router_helpers.php` 中，参数已通过参数传递
   - `$clbpara` 改为从 `$pdata['clbpara']` 获取

### 第2阶段：Handler + Router 文件迁移

**策略：** 对所有 handler 函数统一添加 `&$pdata` 参数，函数内部通过 `$pdata['key']` 访问替代 `global`。

#### 2.1 router.php → `cmd_router_dispatch()`

```php
// 修改函数签名
function cmd_router_dispatch($command, $mode, &$pdata, &$cmdcdtime) {
    // 移除: global $club, $clbpara, $pls, $state;
    // 改为:
    $club = &$pdata['club'];
    $clbpara = &$pdata['clbpara'];
    $pls = &$pdata['pls'];
    $state = &$pdata['state'];
    // itms0 保留: global $itms0;
```

#### 2.2 router_helpers.php → `resolve_pre_checks()`

```php
// 修改函数签名
function resolve_pre_checks($command, $action, $mode, $coldtimeon, $rmcdtime, $sp_cmd, &$pdata) {
    // 移除: global $clbpara;
    // 改为: $clbpara = &$pdata['clbpara'];
```

#### 2.3 router_helpers.php → `cmd_router_post_process()`

```php
// 修改函数签名
function cmd_router_post_process($action, $gamestate, $bid, $coldtimeon, &$cmdcdtime, &$rmcdtime, $now, &$pdata) {
    // 移除: global $cdsec, $cdmsec, $cdtime, $endtime, $pls, $pid, $arbsk, $arbs, $arbe;
    // 改为直接使用 $pdata['cdsec'] 等
}
```

#### 2.4 handler 文件批量修改

**模式 A：读取 pdata 变量但无需写回**
```php
// 旧
function cmd_handle_rest($command, &$mode) {
    global $pls, $hospitals, $state;
    if ($command == 'rest3' && !in_array($pls, $hospitals)) { ... }
    $state = substr($command, 4, 1);
    $mode = 'rest';
}
// 新
function cmd_handle_rest($command, &$mode, &$pdata) {
    global $hospitals;
    if ($command == 'rest3' && !in_array($pdata['pls'], $hospitals)) { ... }
    $pdata['state'] = substr($command, 4, 1);
    $mode = 'rest';
}
```

**模式 B：读取 clbpara**
```php
// 旧
function cmd_handle_dialogue_choice($command, &$mode) {
    global $clbpara, $log, $dialogue_branch, $dialogue_log, $dialogue_id, $opendialog;
    unset($clbpara['dialogue']);
}
// 新（$pdata 已传入）
function cmd_handle_dialogue_choice($command, &$mode, &$pdata) {
    global $log, $dialogue_branch, $dialogue_log, $dialogue_id, $opendialog;
    unset($pdata['clbpara']['dialogue']);
}
```

**模式 C：动态变量 `${'itmk'.$imn}`**
```php
// 旧
${'itmk' . $imn}
${'itme' . $imn}
// 新
$pdata['itmk' . $imn]
$pdata['itme' . $imn]
```
> 注意：`special_dispatch.php` 中 `sp_trapadtsk` 分支大量使用此模式，需要逐一替换。

**模式 D：`${$command.'_nums'}` 等动态 request 变量**
```php
// 这些是 request 参数，不是 pdata 变量，无需修改
${$command . '_nums'}
${$sk . 'upgpara'}
${$sk . 'mkey'}
${$sk . ${$sk . 'mkey'} . 'moveto'}
```
> 这些来自 `$_REQUEST`（在 `common.inc.php` 中 extract），与 `$pdata` 无关。

#### 2.5 router.php 内部辅助函数

**`_dispatch_itemmain_mode($command, $mode, &$pdata)`**:
```php
// 旧: global $arbs, $arbe, $arbsk; + ${'mitm'.$i}
// 新: 通过 $pdata 访问
if (strpos($pdata['arbsk'], '^') !== false && $pdata['arbs'] && $pdata['arbe']) { ... }
${'mitm'.$i} → $pdata['mitm'.$i]
```

**`_dispatch_special_mode($command, &$pdata)`**:
```php
// 旧: global $club, $pls, $pose, $tactic, $horizon;
// 新: $pdata['club'], $pdata['pls'], $pdata['pose'], $pdata['tactic'], $pdata['horizon']
```

**`_dispatch_revskpts_mode($command, &$pdata)`**:
```php
// 旧: 部分动态变量来自 pdata
// 此函数中动态变量主要是 request 参数，保持不变
```

### 第3阶段：library 函数内部 extract 消除

#### 3.1 `init_playerdata()` 和 `init_profile()`

这两个函数是最高优先级的内部 extract 消除目标——它们被 `command.php` 和 `game.php` 同时调用。

**策略：** 改为接受 `&$pdata`（或 `$data` 引用），直接操作数组。

```php
// init_playerdata 旧实现
function init_playerdata($data = NULL) {
    global $baseexp, $weather, $fog, $log, $upexp, $lvlupexp, $iconImg, $iconImgB;
    global $pls, $weather;
    if (!isset($data)) {
        global $pdata;
        $data = &$pdata;
    }
    extract($data, EXTR_REFS);  // ← 删除
    // ... 直接使用 $data['lvl'], $data['exp'], $data['gd'], $data['icon'], $data['clbpara']
}

// init_playerdata 新实现
function init_playerdata(&$data = null) {
    global $baseexp, $weather, $fog, $log, $upexp, $lvlupexp, $iconImg, $iconImgB;
    global $pls;
    if ($data === null) {
        global $pdata;
        $data = &$pdata;
    }
    // 直接用 $data 数组访问
    $upexp = round(($data['lvl'] * $baseexp) + (($data['lvl'] + 1) * $baseexp));
    $lvlupexp = $upexp - $data['exp'];
    $iconImg = $data['gd'] . '_' . $data['icon'] . '.gif';
    if (file_exists('img/' . $data['gd'] . '_' . $data['icon'] . 'a.gif')) {
        $iconImgB = $data['gd'] . '_' . $data['icon'] . 'a.gif';
    }
    if (($weather == 8) || ($weather == 9) || ($weather == 12)) {
        $fog = true;
    }
    $data['clbpara'] = get_clbpara($data['clbpara']);
}
```

**`init_profile()` 同理**：内部循环改为 `$data[$value]`、`$data[$k_value]` 等数组访问形式。输出 `_words` 变量仍通过 `global` 暴露给模板系统。

#### 3.2 `init_bgm()`

```php
// 旧：global $pdata; extract($pdata, EXTR_REFS);
// 新：直接使用 $pdata 数组
function init_bgm($force_update = 0) {
    global $command, $gamecfg, $bgmname;
    global $default_volume, $event_bgm, $pls_bgm, $parea_bgm, $regular_bgm, $bgmbook, $bgmlist;
    global $pdata;
    
    $pdata['clbpara'] = get_clbpara($pdata['clbpara']);
    $clbpara = &$pdata['clbpara'];
    
    // 旧: $pls → $pdata['pls']
    // 旧: $club → $pdata['club']
    // 旧: $name → $pdata['name']
}
```

#### 3.3 `findteam()` 和 `findcorpse()`

这两个函数同时 extract `$pdata` 和 `$w_pdata`（对方数据）：

```php
// findteam 旧实现
function findteam(&$w_pdata) {
    global $pdata;
    extract($pdata, EXTR_REFS);
    extract($w_pdata, EXTR_PREFIX_ALL, 'w');
    init_battle_rev($pdata, $w_pdata);
    // $w_name 等使用
}

// findteam 新实现
function findteam(&$w_pdata) {
    global $pdata;
    // 将 w_pdata 键也通过前缀提取到局部变量
    $w_name = $w_pdata['name'];
    $w_pid = $w_pdata['pid'];
    // ... （仅提取模板渲染需要的少量变量）
    init_battle_rev($pdata, $w_pdata);
}
```

> 注意：`EXTR_PREFIX_ALL, 'w'` 产生 `$w_name`, `$w_pid` 等变量。这些主要用于模板渲染（`include template('findteam')`）。可通过在模板 include 前将需要的变量手动赋值给局部变量来解决。

#### 3.4 `revcombat.func.php` 中的两处 extract

```php
// Line 299 + 304
// 旧
extract($pdata, EXTR_REFS);

// 新：直接使用 $pdata 数组
// 后续逻辑中 $action, $bid, $pls 等改为 $pdata['action'], $pdata['bid'], $pdata['pls']
```

### 第4阶段：game.php 入口文件迁移（模板渲染保留）

`game.php` 的 extract 服务于模板渲染系统。模板语法 `{player_name}` 读取全局变量。

**方案：** 保留 `game.php` 的 extract，因为模板系统深度依赖全局变量。但迁移 `init_playerdata()` 和 `init_profile()` 内部的 extract（第3阶段已完成），使这两个函数不再产生额外副作用。

> 模板系统改造是独立的大型任务（需修改模板引擎 `template.func.php`），超出本次 extract 迁移范围。

### 第5阶段：end.php / winner.php（低风险，直接替换）

这两个文件使用 `extract($pdata)` 无 EXTR_REFS（返回副本），风险最低。

- `end.php`: 变量数少（约15个），直接替换为 `$pdata['key']`
- `winner.php`: 同上，且 `winner.php:14` extract 后仅用于 `init_playerdata()` 和 `init_profile()` 调用

---

## 四、潜在风险评估及规避措施

### 4.1 风险矩阵

| 风险 | 严重度 | 概率 | 规避措施 |
|------|--------|------|----------|
| EXTR_REFS 写入丢失（通过global引用修改$pdata的代码遗漏） | **高** | 中 | 全局搜索所有对 `$hp`, `$state`, `$pls` 等的赋值语句，逐一确认已改为 `$pdata['key'] =` |
| 动态变量 `${'itmk'.$imn}` 遗漏 | **高** | 中 | Grep 搜索所有 `\$\{'itm` 模式，逐文件审查 |
| handler 函数签名变更遗漏调用点 | **中** | 中 | 所有 handler 仅被 `router.php` 调用，范围可控；PHP 参数计数不匹配会报错 |
| 模板渲染访问未定义的全局变量 | **高** | 低 | 仅在 `command.php` 中影响 `$gamedata['innerHTML']['cmd']` 的模板渲染（如 `rest.htm`、`fishing.htm`），需要确保渲染前相关变量仍在全局作用域 |
| `init_playerdata/extract` 消除后 clbpara 未写回 | **中** | 低 | `init_playerdata()` 中 `$data['clbpara'] = get_clbpara(...)` 直接写入 `$data` 引用，无写回问题 |
| `player_save($pdata)` 在 extract 移除后数据不一致 | **高** | 低 | `player_save` 直接接受 `$pdata` 数组参数，不受 extract 影响 |

### 4.2 关键规避措施

1. **EXTR_REFS 写入追踪：** 在迁移前先 grep 所有对 pdata 字段的**赋值**语句（`$hp =`, `$state =`, `$pls =`, `$cdsec =` 等），确保迁移后全部改为 `$pdata['key'] =`

2. **clbpara 操作保护：** 所有 `$clbpara['key'] =` 的写入是通过 EXTR_REFS 自动写回 `$pdata['clbpara']`。迁移后 `clbpara` 必须通过 `$pdata['clbpara']` 访问，否则写入不会持久化到数据库。

3. **`check_extrabag_overflow()` 问题：** 该函数位于 `router_helpers.php`，通过 `global $arbsk, $arbs, $arbe` 读取。迁移后需要传入 `$pdata`。

4. **`extrabag_over_limit()` 写入：** 该函数可能会修改 `$extrabag`, `$extrabag_num` 等。同样需要确保通过 `$pdata` 引用传递。

5. **渐进式开关：** 建议为 `command.php` 添加一个常量开关 `define('PDATA_ARRAY_MODE', true)`，允许在迁移过程中快速切换新旧模式：

```php
if (defined('PDATA_ARRAY_MODE') && PDATA_ARRAY_MODE) {
    // 新模式：不 extract，使用 $pdata 数组
} else {
    // 旧模式：extract（保留作为回滚）
    extract($pdata, EXTR_REFS);
}
```

---

## 五、测试验证策略

### 5.1 静态检查（自动化，优先执行）

```bash
# 1. PHP 语法检查所有修改文件
for f in command.php game.php include/command/*.php include/command/handlers/*.php include/gamectl/game.func.php include/game/encounter.func.php; do
    php -l "$f"
done

# 2. 检查是否有遗漏的 extract($pdata
grep -rn 'extract.*\$pdata' --include='*.php' . | grep -v '\.old' | grep -v 'doc/' | grep -v '\.md'

# 3. 检查 handler 文件中是否有未迁移的 global pdata 变量
grep -rn 'global.*\$\(hp\|pls\|state\|club\|clbpara\|pid\|name\|endtime\|bid\|teamID\|cdsec\|cdmsec\|cdtime\)' include/command/
```

### 5.2 单元测试（关键函数）

针对每个 handler 函数编写独立的验证脚本：

```php
// tests/migration/test_handler_move.php
<?php
// 模拟 $pdata 和必要的 global 变量
$pdata = array(
    'hp' => 100, 'pls' => 10, 'state' => 0, 'club' => 1,
    'clbpara' => array(), 'cdsec' => 0, 'cdmsec' => 0, 'cdtime' => 0,
    'endtime' => time(),
);
$GLOBALS['coldtimeon'] = 1;
$GLOBALS['movecoldtime'] = 500;
$GLOBALS['log'] = '';

// 调用 handler
$cmdcdtime = 0;
cmd_handle_move('0', $cmdcdtime, $pdata);

// 断言
assert($cmdcdtime === 500);
assert(isset($GLOBALS['log']));
echo "PASS: cmd_handle_move\n";
```

测试覆盖清单：
- [ ] `cmd_handle_move` — 移动
- [ ] `cmd_handle_search` — 探索
- [ ] `cmd_handle_item_use` — 物品使用
- [ ] `cmd_handle_rest` — 休息（写 `$pdata['state']`）
- [ ] `cmd_handle_fishing` — 钓鱼
- [ ] `cmd_handle_song` — 唱歌
- [ ] `cmd_handle_itemmain_entry` — 物品菜单
- [ ] `cmd_handle_special_dispatch` — 特殊技能（含动态变量分支）
- [ ] `cmd_handle_memory` — 记忆（写 `$pdata['clbpara']`）
- [ ] `cmd_handle_dialogue_choice` — 对话选择（写 `$pdata['clbpara']`）
- [ ] `cmd_handle_end_dialogue` — 结束对话（写 `$pdata['clbpara']`）
- [ ] `resolve_pre_checks` — 预检查
- [ ] `cmd_router_post_process` — 后处理（写 `$pdata['cdsec']` 等）
- [ ] `init_playerdata` — 初始化（写 `$pdata['clbpara']`）
- [ ] `init_profile` — 资料渲染
- [ ] `player_save` — 数据持久化（验证输出一致性）

### 5.3 集成测试（端到端）

**测试环境：** 本地 PHP 开发服务器 `php -S localhost:8080 -t .`

**测试场景：**

1. **基础指令序列**
   - 创建测试玩家 → 激活 → `command.php?mode=command&command=move&moveto=1` → 验证位置变更
   - `command.php?mode=command&command=search` → 验证探索逻辑
   - `command.php?mode=command&command=rest1` → 验证休息状态

2. **物品操作序列**
   - 装入物品 → `command.php?mode=command&command=itm1` → 验证物品使用
   - `command.php?mode=itemmain&command=itemdrop1` → 验证丢弃

3. **clbpara 持久化验证**
   - 对话选择操作 → 检查数据库 `clbpara` JSON 字段是否正确更新
   - 记忆操作 → 检查 `smeo` 数据是否正确存储

4. **冷却时间验证**
   - 移动后检查 `cdsec/cdmsec/cdtime` 是否更新
   - 等待冷却结束后检查 `$rmcdtime` 是否为0

5. **模板渲染验证**
   - 验证 `$gamedata['innerHTML']['cmd']` 输出与迁移前一致
   - 验证 `$gamedata['innerHTML']['main']` 玩家资料面板正确

### 5.4 回归测试（对比测试）

**方法：** 抓取迁移前后的 `$gamedata` JSON 输出进行 diff 对比。

```bash
# 迁移前：保存基准输出
for mode in move search rest itemmain special; do
    curl -s -b "user=test; pass=test" "http://localhost:8080/command.php?mode=command&command=$mode" > "baseline_$mode.json"
done

# 迁移后：保存新输出
for mode in move search rest itemmain special; do
    curl -s -b "user=test; pass=test" "http://localhost:8080/command.php?mode=command&command=$mode" > "new_$mode.json"
done

# 对比
for mode in move search rest itemmain special; do
    diff <(jq -S . "baseline_$mode.json") <(jq -S . "new_$mode.json")
done
```

**排除字段：** `timer`（时间戳差异）、`innerHTML.log`（时间差异）等动态字段。

### 5.5 数据库一致性检查

迁移前后执行：
```sql
-- 验证数据完整性
SELECT pid, hp, state, pls, clbpara FROM players WHERE name = 'test_user';
-- 对比两次执行结果的差异
```

---

## 六、回滚机制设计

### 6.1 渐进式开关（推荐）

在 `command.php` 中添加常量开关：

```php
// command.php 开头（require common.inc.php 之后）
define('PDATA_MIGRATION_MODE', false); // false = 旧模式, true = 新模式
```

```php
// 原 extract 位置
if (!defined('PDATA_MIGRATION_MODE') || !PDATA_MIGRATION_MODE) {
    // [旧模式] 保持向后兼容
    extract($pdata, EXTR_REFS);
}
```

所有 handler 函数也通过此开关选择代码路径：
```php
function cmd_handle_move($moveto, &$cmdcdtime, &$pdata = null) {
    if (defined('PDATA_MIGRATION_MODE') && PDATA_MIGRATION_MODE) {
        // 新模式：$pdata 数组访问
        $pls = &$pdata['pls'];
    } else {
        // 旧模式：global 引用
        global $pls;
    }
    // ... 其余逻辑不变
}
```

> 迁移完成后，删除旧代码路径和常量定义。

### 6.2 Git 分支策略

```
main ─── feature/migrate-extract-refs ─── (迁移工作)
         │
         └── (出问题时：直接切回 main，或 revert 合并提交)
```

### 6.3 逐阶段回滚

| 阶段 | 回滚方式 |
|------|----------|
| 第1阶段 (command.php) | 将 `PDATA_MIGRATION_MODE` 设为 `false` |
| 第2阶段 (handlers) | 同上，开关控制所有 handler |
| 第3阶段 (library) | `init_playerdata` 保留 `$data === null` 时的兼容分支 |
| 第5阶段 (end/winner) | `git revert` 单文件 |

### 6.4 自动化回滚脚本

```bash
#!/bin/bash
# rollback_migration.sh
# 快速回滚：恢复旧版 extract 行为
sed -i "s/define('PDATA_MIGRATION_MODE', true)/define('PDATA_MIGRATION_MODE', false)/" command.php
echo "Rollback complete. PDATA_MIGRATION_MODE set to false."
```

---

## 七、迁移执行检查清单

### 7.1 迁移前

- [ ] 全量 grep `extract.*\$pdata` 确认实例清单无误
- [ ] grep 所有 `\$hp\s*=` / `\$state\s*=` / `\$pls\s*=` 赋值语句，标记写入点
- [ ] grep 所有 `\$clbpara\[` 写入点（`unset`, `=`）
- [ ] 备份基准 JSON 输出（5.4 回归测试用）
- [ ] 创建 `feature/migrate-extract-refs` 分支
- [ ] 确认 `command.php` 的 `player_save($pdata)` 调用不受影响

### 7.2 迁移中（每阶段）

- [ ] 修改文件后执行 `php -l` 语法检查
- [ ] 确认 `global` 声明中不再有 pdata 来源变量
- [ ] 确认 `&$pdata` 引用传递链完整（无断开）
- [ ] 确认动态变量 `${'itmk'.$imn}` 全部替换为 `$pdata['itmk'.$imn]`
- [ ] 确认 request 来源变量（`$_REQUEST` extract 产物）未被误改

### 7.3 迁移后

- [ ] 所有阶段完成后，最后一次 grep 确认无遗漏 `extract($pdata`
- [ ] 执行全部单元测试
- [ ] 执行集成测试（5个场景全覆盖）
- [ ] 回归测试 JSON diff 通过
- [ ] 数据库一致性检查通过
- [ ] 删除 `PDATA_MIGRATION_MODE` 开关和旧代码路径
- [ ] 更新 CODEBASE.md §五（$pdata 生命周期部分）
- [ ] 更新 GLOBALS.md §七（标记 extract 已移除）
- [ ] 生成迁移记录文件 `doc/YYYYMMDD-HHMMSS-extract-refs-migration.txt`

---

## 八、预计影响范围

| 文件 | 修改类型 | 风险等级 |
|------|----------|----------|
| `command.php` | 结构修改（删除 extract，修改变量访问） | **高** |
| `include/command/router.php` | 函数签名 + 变量访问修改 | **高** |
| `include/command/router_helpers.php` | 函数签名 + 变量访问修改 | **高** |
| `include/command/handlers/basic_commands.php` | 函数签名 + 变量访问修改 | 中 |
| `include/command/handlers/special_dispatch.php` | 动态变量替换 | 中 |
| `include/command/handlers/dialogue_handler.php` | 变量替换（clbpara 写入） | 中 |
| `include/command/handlers/misc_commands.php` | 变量替换（clbpara 写入） | 中 |
| `include/command/handlers/itemmain_entry.php` | 变量替换 | 低 |
| `include/command/handlers/console_handler.php` | 变量替换 | 低 |
| `include/command/handlers/team_handler.php` | 无修改（无 pdata global） | — |
| `include/gamectl/game.func.php` | 3个函数内部 extract 消除 | **高** |
| `include/game/encounter.func.php` | 2个函数内部 extract 消除 | 中 |
| `include/game/combat/revcombat.func.php` | 2处 extract 消除 | 中 |
| `end.php` | 变量替换 | 低 |
| `winner.php` | 变量替换 | 低 |
| `game.php` | 不变（模板系统依赖保留）| — |

---

## 九、总结

本方案将 11 处 `extract($pdata)` 调用分 5 个阶段逐步迁移，通过以下策略保证安全性：

1. **渐进式开关** — 允许任意时刻一键回滚
2. **引用传递链** — 所有写入点通过 `&$pdata` 保持一致性
3. **分阶段实施** — 优先核心入口文件，再处理 library 函数，最后处理低风险文件
4. **多层测试** — 静态检查 + 单元测试 + 集成测试 + 回归测试 + 数据库一致性检查
5. **模板系统豁免** — `game.php` 的 extract 因模板引擎深度依赖暂时保留