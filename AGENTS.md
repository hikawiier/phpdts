# PHPDTS Agent Guidelines

> AI编码助手快速参考。PHPDTS是一个PHP大逃杀网页游戏，使用原生PHP+MySQL，无框架依赖。
>
> **关键文档：** [CODEBASE.md](CODEBASE.md)（代码库地图） | [GLOBALS.md](GLOBALS.md)（全局变量词典） | [include/STRUCTURE.md](include/STRUCTURE.md)（目录分层规则）

---

## 快速命令

```bash
# 启动开发服务器
php -S localhost:8080 -t .

# PHP语法检查
php -l file.php

```

---

## 代码规范

### 文件命名

| 类型 | 模式 | 示例 |
|------|------|------|
| 函数库 | `name.func.php` | `revcombat.func.php` |
| 类定义 | `name.class.php` | `db_mysqli.class.php` |
| 配置 | `name_version.php` | `gamecfg_1.php` |
| 模板 | `name.htm` | `game.htm` |
| SQL结构 | `table.sql` | `all.sql` |

### PHP文件头（必须）

```php
<?php
if (!defined('IN_GAME')) {
    exit('Access Denied');
}
```

### 项目约定

- **变量：** 局部用`snake_case`；全局用`global`关键字显式声明
- **表前缀：** `$tablepre`（如`acbra3_`，私房间为`acbra3_s{id}_`）；`$gtablepre`为全局前缀（不变）
- **数组语法：** 必须用`array()`（PHP 7.0兼容），禁止`[]`
- **错误处理：** 致命错误用`gexit()`；游戏内消息用`$log .=`
- **数据库查询：** 表名用`{$tablepre}players`；用户输入用`$db->escape_string()`
- **配置加载：** `require config('name', $version)` → 返回`gamedata/cache/name_version.php`路径，支持RuleSet覆盖
- **玩家数据（遗留）：** `extract($pdata, EXTR_REFS)` 将数组展开为全局变量引用。仅限入口文件（`game.php`/`command.php`）使用，**新业务逻辑禁止此写法**。
- **玩家数据（新设计）：** 函数接受 `&$data` 参数，直接通过 `$data['hp']`、`$data['clbpara']` 进行数组操作。代表：`check_player_misc_states(&$data)`、`quest_tick(&$data)`。
- **`$clbpara` 规范：** 必须通过 API 函数（`get_clbpara()` / `check_player_misc_states()` / `player_save()`）操作；禁止直接 `json_encode` 后 `UPDATE` 数据库。`$clbpara` 是 `$pdata['clbpara']` 经 `extract()` 产生的全局别名，新业务逻辑禁止依赖 `extract`，应直接操作 `$data['clbpara']`。
- **注释：** 中英双语
- **过时文档：** `doc/nouveau_250609/` 目录下的文档已过时，修改项目时**禁止参考**其中的描述。

### 模板系统

```html
<!-- 变量 --> {player_name}
<!-- 条件 --> <!--{if $gamestate == 20}-->...<!--{/if}-->
<!-- 循环 --> <!--{loop $items $item}-->...<!--{/loop}-->
<!-- 子模板 --> <!--{template header}-->
<!-- PHP --> <!--{eval echo time();}-->
```

加载：`include template('name');` → 加载`templates/{templateid}/name.htm`

---

## 核心概念

### 请求生命周期

入口文件 → `require './include/core/common.inc.php'` → 初始化（常量/输入过滤/数据库连接）→ 按`$mode`分发处理。

详细流程见[CODEBASE.md §一](CODEBASE.md)。

### 配置加载 `config()`

```php
require config('gamecfg', $gamecfg);   // gamedata/cache/gamecfg_1.php
require config('resources', $gamecfg); // 资源定义
require config('combatcfg', $gamecfg); // 战斗配置
```

配置文件直接在全局作用域定义变量，非函数包裹。RuleSet房间优先加载`gamedata/ruleset/{id}/cache/`下同名文件。

### 游戏状态机

```
0(等待) → 10(准备) → 20(进行中) → 30(停止激活) → 40(连斗) → 结束
```

调度器：`include/gamectl/gamestate.func.php`

### `$mode`分发

`command.php`按`$mode`分发到各模块。主要值：`command`(基础指令)/`revcombat`(战斗)/`itemmain`(物品)/`search`(探索)/`special`(特殊技能)/`rest`(休息)。

详见[CODEBASE.md §五](CODEBASE.md)。

### 玩家数据 `$pdata`

`$pdata` 是 `players` 表的单行数组，玩家状态的唯一权威数据源。

**生命周期：**
1. **加载**：`fetch_playerdata_by_name($cuser)` 从数据库读取，自动调用 `check_player_misc_states()` 刷新技能和装备状态
2. **展开**：入口文件用 `extract($pdata, EXTR_REFS)` 展开为全局变量（遗留设计，新业务逻辑禁止）
3. **修改**：函数内通过 `&$data` 直接数组操作（推荐），或操作全局变量（遗留）
4. **存档**：`player_save($pdata)` → `player_format_with_db_structure()` 过滤非法字段并 JSON 编码数组字段 → `array_update()` 回写数据库

**`$clbpara` 子生命周期（`$pdata['clbpara']`）：**
- **来源**：`valid.php` 初始化（BGM 曲集、随机种子、对话标记等）→ 数据库存为 JSON。
- **加载**：`check_player_misc_states()` 调用 `get_clbpara()` 解码 JSON，再调用 `check_skilllasttimes()` 自动清理过期技能。
- **使用**：直接操作 `$data['clbpara']`（`&$data` 引用传入）；`extract()` 后的全局 `$clbpara` 仅用于模板渲染。
- **保存**：由 `player_save()` 统一序列化回写。**禁止**任何模块直接 `json_encode($clbpara)` 后执行 `UPDATE`。

**结构：** 基础属性、装备栏（`wep`/`arb`/`arh`/`ara`/`arf`/`art`）、6格物品栏（`itm1~6`）、临时槽（`itm0`）、额外背包（`extrabag`）、社团参数（`clbpara`）。

详见[GLOBALS.md §七/十四](GLOBALS.md)。

---

## 安全规范

1. 文件开头检查`IN_GAME`常量
2. 用户输入用`gstrfilter()`过滤，SQL用`$db->escape_string()`
3. 禁止暴露`$dbpw`、`$authkey`、`$salt`
4. 输出用`htmlspecialchars()`转义

---

## 文档维护

重大修改（新增模块、重构子系统、变更全局变量、调整文件结构）后：
1. 更新[CODEBASE.md](CODEBASE.md) — 文件索引与模块描述
2. 更新[GLOBALS.md](GLOBALS.md) — 全局变量定义与生命周期

更新信息时要精简描述，拒绝冗余信息、技术术语和非必要细节。

变更记录保存为`doc/YYYYMMDD-HHMMSS-change-description.txt`，中英双语说明。
