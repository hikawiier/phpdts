# Oblivions Bootstrap 设计方案

## 1. 背景与问题

### 1.1 触发事件

调试 NPC 先攻轮不行动的 bug 时，发现根因是 `obl_command.php` [F] 段的条件判断 `function_exists('obl_command_advances_tick')` 返回 false —— 因为 `tick.func.php` 从未被加载，而 `tick.func.php` 只在条件块内部才 include，形成死循环。

### 1.2 根本问题

Oblivions 子系统采用"条件 include + function_exists 双保险"模式加载函数库，散落在各文件各位置：

```php
// 散落的条件 include（当前模式）
if (!function_exists('obl_fetch_playerdata_by_pid')) {
    include_once GAME_ROOT . './oblivions/include/game/player.func.php';
}
```

这种模式的问题：
1. **依赖关系不集中可见** —— 要知道一个文件依赖哪些函数库，必须通读全文
2. **容易漏写** —— tick.func.php bug 就是漏写 include 的直接后果
3. **加载顺序不确定** —— 循环依赖（explore ↔ enemy_ai）靠条件 include 绕过，但脆弱
4. **入口加载不一致** —— api_v2.php 只 require player.func.php，但 handler 实际还需要 move.func.php + sql.func.php（潜在 bug）

### 1.3 为什么不用 PHP autoload

PHP autoload（`spl_autoload_register`）只支持类的自动加载，**不支持函数**。Oblivions 子系统 100 个函数 vs 3 个类，autoload 覆盖率不到 3%。函数式风格的项目更适合"子系统 bootstrap"模式。

---

## 2. 现状依赖图

### 2.1 文件清单与依赖关系

```
独立文件（无 include 依赖）：
├── log.func.php              OblivionsLogger + OblivionsErrorLogger
├── battle_log.func.php       BattleLogCollector
├── sql.func.php              队列 DB 操作
├── player.func.php           玩家数据 CRUD + 认证 + 道具栏
├── move.func.php             地图数据 + 移动逻辑
├── generate.func.php         区域生成（物品/POI/野战道具）
├── battle/battle.calc.php    战斗数值计算（obl_get_range/initiative/damage）
└── skill/skill.main.php      技能系统核心

有依赖的文件：
├── battle/battle.func.php    → battle.calc.php
├── battle/battle.main.php    → player.func.php + sql.func.php + battle.func.php
├── explore.func.php          → move.func.php + enemy_ai.func.php (obl_discover_enemies)
├── enemy_ai.func.php         → move.func.php + player.func.php + battle.main.php + explore.func.php (obl_clear_fog)
├── tick.func.php             → player.func.php + enemy_ai.func.php (末尾注册监听器)
└── core/obl_command.php      → player.func.php + tick.func.php (条件)
```

### 2.2 循环依赖

`explore.func.php` ↔ `enemy_ai.func.php`：
- explore 调用 enemy_ai 的 `obl_discover_enemies`
- enemy_ai 调用 explore 的 `obl_clear_fog`

PHP 函数式风格中这不是问题（只要调用前两个文件都加载了即可），但在 bootstrap 中需用 `require_once` 保证不重复加载。

### 2.3 入口点加载现状

| 入口文件 | Oblivions 分支加载的文件 | 缺失 |
|----------|-------------------------|------|
| common.inc.php | log.func.php + battle_log.func.php + tick.func.php(条件) | player/move/sql/battle/explore/enemy_ai/skill |
| command.php | obl_command.php（内部 require player.func.php） | tick/battle/explore/enemy_ai/skill 靠条件 include |
| api_v2.php | player.func.php | **move.func.php + sql.func.php + log.func.php + battle_log.func.php**（handler 实际需要但未加载） |
| game.php | 直接重定向，不加载 | 无需 |

**api_v2.php 的潜在 bug**：`handle_game_map` 调用 `obl_get_map_data`（move.func.php），`handle_player_info` 调用 `obl_fetch_queue_all_by_qid`（sql.func.php），但这些文件未在 api_v2.php 入口加载。目前可能因 common.inc.php 的某条路径偶然加载了，但属于隐性依赖。

---

## 3. Bootstrap 设计方案

### 3.1 核心思路

创建 `oblivions/include/core/obl_bootstrap.php`，集中 `require_once` 所有 Oblivions 函数库，按拓扑排序排列。所有入口点统一 require 这个 bootstrap 文件。

### 3.2 bootstrap 文件结构

```php
<?php
// oblivions/include/core/obl_bootstrap.php
// Oblivions 子系统统一引导文件
// 集中加载所有函数库，消除散落的条件 include，避免漏写依赖

if (!defined('IN_GAME')) {
    exit('Access Denied');
}

// ================================================================
// 加载顺序按拓扑排序：被依赖的文件先加载
// require_once 保证不重复加载（循环依赖 explore ↔ enemy_ai 安全）
// ================================================================

// 第 1 层：独立函数库（无依赖）
require_once GAME_ROOT . './oblivions/include/game/log.func.php';
require_once GAME_ROOT . './oblivions/include/game/battle_log.func.php';
require_once GAME_ROOT . './oblivions/include/game/sql.func.php';
require_once GAME_ROOT . './oblivions/include/game/player.func.php';
require_once GAME_ROOT . './oblivions/include/game/move.func.php';
require_once GAME_ROOT . './oblivions/include/game/generate.func.php';
require_once GAME_ROOT . './oblivions/include/game/battle/battle.calc.php';
require_once GAME_ROOT . './oblivions/include/game/skill/skill.main.php';

// 第 2 层：依赖第 1 层
require_once GAME_ROOT . './oblivions/include/game/battle/battle.func.php';

// 第 3 层：依赖第 1-2 层
require_once GAME_ROOT . './oblivions/include/game/battle/battle.main.php';

// 第 4 层：循环依赖（explore ↔ enemy_ai），require_once 保证安全
require_once GAME_ROOT . './oblivions/include/game/explore.func.php';
require_once GAME_ROOT . './oblivions/include/game/enemy_ai.func.php';

// 第 5 层：依赖最广，末尾注册 tick 监听器
require_once GAME_ROOT . './oblivions/include/game/tick.func.php';
```

### 3.3 分层说明

| 层 | 文件 | 依赖 |
|----|------|------|
| 1 | log / battle_log / sql / player / move / generate / battle.calc / skill | 无 |
| 2 | battle.func | battle.calc |
| 3 | battle.main | player + sql + battle.func |
| 4 | explore / enemy_ai | move + player + battle.main + 互相依赖 |
| 5 | tick | player + enemy_ai（末尾注册监听器） |

---

## 4. 入口改造点

### 4.1 common.inc.php（第 301-343 行 Oblivions 分支）

**改造前**：
```php
// Oblivions 日志收集器初始化
if (function_exists('oblivions_is_active') && oblivions_is_active()) {
    include_once GAME_ROOT.'./oblivions/include/game/log.func.php';
    if (class_exists('OblivionsLogger') && !isset($obl_log)) { ... }
    // ...
    include_once GAME_ROOT.'./oblivions/include/game/battle_log.func.php';
    if (class_exists('BattleLogCollector') && !isset($obl_battle_log)) { ... }
}

// tick 事件处理（条件 include tick.func.php）
if (... && $gamevars['obl_pretick'] < $gamevars['obl_tick']) {
    if (!function_exists('obl_resolve_tick_events')) {
        include_once GAME_ROOT . './oblivions/include/game/tick.func.php';
    }
    obl_tick_synchronize();
    obl_resolve_tick_events($delta);
    ...
}
```

**改造后**：
```php
// Oblivions 子系统引导 + 日志收集器初始化
if (function_exists('oblivions_is_active') && oblivions_is_active()) {
    // 一次性加载所有 Oblivions 函数库
    require_once GAME_ROOT.'./oblivions/include/core/obl_bootstrap.php';

    if (!isset($obl_log)) {
        $obl_log = new OblivionsLogger();
    }
    if (!isset($obl_error_log)) {
        $obl_error_log = new OblivionsErrorLogger();
    }
    if (!isset($obl_battle_log)) {
        $obl_battle_log = new BattleLogCollector();
    }
}

// tick 事件处理（tick.func.php 已由 bootstrap 加载，无需条件 include）
if (... && $gamevars['obl_pretick'] < $gamevars['obl_tick']) {
    obl_tick_synchronize();
    obl_resolve_tick_events($delta);
    $ginfochange = true;
}
```

### 4.2 command.php（Oblivions 分支）

**改造前**：
```php
if (function_exists('oblivions_is_active') && oblivions_is_active()) {
    require GAME_ROOT.'./oblivions/include/core/obl_command.php';
    exit;
}
```

**改造后**：
```php
if (function_exists('oblivions_is_active') && oblivions_is_active()) {
    require_once GAME_ROOT.'./oblivions/include/core/obl_bootstrap.php';
    require GAME_ROOT.'./oblivions/include/core/obl_command.php';
    exit;
}
```

### 4.3 api_v2.php（Oblivions 分支，第 18-19 行）

**改造前**：
```php
if (function_exists('oblivions_is_active') && oblivions_is_active()) {
    require_once GAME_ROOT.'./oblivions/include/game/player.func.php';
    $pdata = obl_game_entrypoint('api');
    ...
}
```

**改造后**：
```php
if (function_exists('oblivions_is_active') && oblivions_is_active()) {
    require_once GAME_ROOT.'./oblivions/include/core/obl_bootstrap.php';
    $pdata = obl_game_entrypoint('api');
    ...
}
```

### 4.4 obl_command.php（移除冗余 require）

**改造前**：
```php
require GAME_ROOT.'./oblivions/include/game/player.func.php';
// ...
// [F] 段
if (!function_exists('obl_command_advances_tick')) {
    include_once GAME_ROOT . './oblivions/include/game/tick.func.php';
}
```

**改造后**：
```php
// player.func.php + tick.func.php 已由 bootstrap 加载，无需重复 require
// ...
// [F] 段（直接调用，无需条件 include）
if (!$command_rejected && !$escape_skip_tick
    && obl_command_advances_tick($command)) {
    obl_tick_advance();
    obl_tick_set_pending_npc();
    save_gameinfo();
}
```

---

## 5. 清理计划

### 5.1 移除各文件中的条件 include

以下文件中的 `if (!function_exists(...)) { include_once ... }` 块可移除（bootstrap 已保证加载）：

| 文件 | 行号 | 条件 include 内容 |
|------|------|------------------|
| tick.func.php | 22 | `obl_fetch_playerdata_by_name` → player.func.php |
| tick.func.php | 369 | `obl_tick_phase_battle_npc` → enemy_ai.func.php |
| enemy_ai.func.php | 29 | `obl_get_map_data` → move.func.php |
| enemy_ai.func.php | 32 | `obl_fetch_enemies_by_region` → player.func.php |
| enemy_ai.func.php | 262 | `battle_main` → battle.main.php |
| enemy_ai.func.php | 577 | `obl_clear_fog` → explore.func.php |
| explore.func.php | 16 | `obl_get_map_data` → move.func.php |
| explore.func.php | 267 | `obl_discover_enemies` → enemy_ai.func.php |
| battle/battle.main.php | 11 | `obl_fetch_playerdata_by_pid` → player.func.php |
| battle/battle.main.php | 14-15 | sql.func.php + battle.func.php（改为 require_once 保留，或移除） |
| battle/battle.func.php | 11 | battle.calc.php（改为 require_once 保留，或移除） |
| obl_command.php | 15 | player.func.php（移除） |
| obl_command.php | 128 | tick.func.php 条件 include（移除） |

### 5.2 保留的安全守卫

每个文件顶部的 `if (!defined('IN_GAME')) exit('Access Denied');` 保留，防止直接访问。

### 5.3 battle.main.php / battle.func.php 内部的 require_once

这两个文件内部的 `include_once` 可保留（`require_once` 不会重复加载，有防御价值），也可移除（bootstrap 已保证）。建议**保留**，作为文件级自文档化的依赖声明。

---

## 6. 执行步骤

1. 创建 `oblivions/include/core/obl_bootstrap.php`
2. 改造 `common.inc.php` Oblivions 分支（第 301-343 行）
3. 改造 `command.php` Oblivions 分支
4. 改造 `api_v2.php` Oblivions 分支（第 18-19 行）
5. 改造 `obl_command.php`（移除冗余 require + 简化 [F] 段）
6. 清理各文件中的条件 include（tick.func.php / enemy_ai.func.php / explore.func.php / battle.main.php）
7. PHP 语法检查所有修改的文件
8. 手动测试：探索 / 移动 / 战斗 / API 拉取数据，确认功能正常

---

## 7. 风险评估

| 风险 | 等级 | 缓解措施 |
|------|------|---------|
| 重复加载导致函数重定义错误 | 低 | 全部使用 `require_once`，PHP 自动去重 |
| 加载顺序错误导致函数未定义 | 低 | 按拓扑排序，循环依赖用 require_once 绕过 |
| 性能下降（多加载了文件） | 极低 | api_v2.php 多加载几个轻量函数库，开销可忽略 |
| 遗漏清理某个条件 include | 低 | 清理后用 Grep 搜索 `function_exists.*include` 验证 |

---

## 8. 预期收益

1. **依赖关系集中可见** —— 一个文件看清所有 Oblivions 函数库的加载顺序
2. **消除漏写 include 的风险** —— 入口点统一 require bootstrap，不再靠条件 include 兜底
3. **修复 api_v2.php 的隐性依赖** —— handler 需要的 move.func.php / sql.func.php 将被正确加载
4. **简化各文件头部** —— 移除散落的条件 include，代码更干净
