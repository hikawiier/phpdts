# system.func.php 全面技术评估与优化方案

> 评估日期：2026-06-12  
> 评估对象：`include/gamectl/system.func.php`（668行，6个函数）  
> 项目：PHPDTS — PHP大逃杀网页游戏  

---

## 目录

1. [项目上下文与 system.func.php 定位](#一项目上下文与-systemfuncphp-定位)
2. [代码质量评估](#二代码质量评估)
3. [性能评估](#三性能评估)
4. [安全评估](#四安全评估)
5. [可维护性评估](#五可维护性评估)
6. [扩展性评估](#六扩展性评估)
7. [模块交互分析](#七模块交互分析)
8. [问题汇总与严重程度评级](#八问题汇总与严重程度评级)
9. [分阶段优化方案](#九分阶段优化方案)
10. [实施优先级矩阵](#十实施优先级矩阵)

---

## 一、项目上下文与 system.func.php 定位

### 1.1 项目架构回顾

PHPDTS 是一个原生 PHP+MySQL 的大逃杀网页游戏，无框架依赖。其分层架构自上而下：

```
入口层 (game.php/command.php/admin.php)
  └─ include/core/common.inc.php      ← 核心初始化
       ├─ core/         基础设施层
       ├─ auth/         用户认证
       ├─ room/         房间/RuleSet
       ├─ gamectl/      ← system.func.php 所在层
       │   ├─ gamestate.func.php   状态机
       │   ├─ system.func.php      游戏系统（重置/禁区/结束）
       │   ├─ deatharea.func.php   禁区函数库
       │   └─ game.func.php        玩家数据
       ├─ pregame/      游戏准备
       ├─ game/         游戏内逻辑（62个文件）
       └─ meta/         跨游戏结算
```

### 1.2 system.func.php 的核心角色

`include/gamectl/system.func.php` 是 **游戏会话控制层** 的核心组件，负责一局游戏从初始化到结束的完整生命周期中的 **三大关键时刻**：

| 函数 | 行数 | 触发时机 | 职责 |
|------|------|----------|------|
| `rs_game()` | L10–L368 | 游戏准备阶段 + 禁区增加时 | 游戏数据重置（6个flag模式） |
| `rs_sttime()` | L370–L404 | 游戏结束时调用 | 计算下一局开始时间 |
| `add_once_area()` | L407–L512 | 每次禁区时间到达 | 推进禁区、淘汰玩家 |
| `areawarn()` | L514–L521 | 禁区警告时间到达 | 发出禁区预警 |
| `gameover()` | L525–L659 | 游戏满足结束条件时 | 结算积分、记录优胜、归档日志 |
| `movehtm()` | L661–L665 | 禁区变更、Hack等 | 刷新禁区展示HTML（已委托给 deatharea.func.php） |

---

## 二、代码质量评估

### 2.1 结构设计

**优点：**
- **位掩码模式（`$mode`）**：`rs_game()` 使用 `$mode & 1/2/4/8/16/32` 六位标志控制重置粒度，调用方以 `rs_game(1+2+4+8+16+32)` 可读性好，且避免了多次调用
- **职责分离已启动**：`movehtm()` 已重构为委托给 `get_areainfo_html()`（`deatharea.func.php`），`gameover()` 调用了 `set_credits()` 和 `check_end_achievement_rev()` 分离结算逻辑

**问题：**

1. **`rs_game()` 函数过长（359行）**，承担了6种完全不同的职责，违反单一职责原则：
   - flag 1: SQL 重建（reset.sql）
   - flag 2: 禁区初始化
   - flag 4: 玩家表重建
   - flag 8: NPC 初始化（最复杂，~100行+，含位置随机化、技能初始化、RuleSet钩子、数据库写入）
   - flag 16: 地图道具/陷阱 + 仓库初始化
   - flag 32: 商店初始化

2. **`add_once_area()` 同样过长（106行）**，混合了禁区推进、玩家淘汰、NPC迁移、天气变更、Hack递减、gameover触发、地图刷新等多个逻辑

3. **`gameover()` 是最大的函数（135行）**，包含日志压缩、模式判断、胜者查询、队伍获胜处理、优胜记录写入、结局成就、积分结算、新闻生成等全部逻辑

4. **全局变量依赖爆炸**：`rs_game()` 的 `global` 声明（L11）引用了14个全局变量。每个flag块内部又有自己的 `global` 声明。`rs_game()` 总共有 **4个独立的 `global` 声明块**，分散在函数体内不同位置（L11、L32、L53、L67）

### 2.2 注释质量

**优点：**
- 保留了部分开发阶段注释，有助于理解代码意图
- 关键参数有简要说明
- 英文/中文双语注释

**问题：**
- 大量被注释掉的旧代码（L12, L22-L29, L79-L101, L173, L179-L183, L191-L198, L263-L266, L287-L294 等），累计约 **60+行**
- 废弃代码与活跃代码混杂，降低代码可读性
- 无 PHPDoc 格式的函数文档，不便于 IDE 智能提示

### 2.3 命名与风格

**问题：**
- 函数名不统一：`rs_game`（缩写）、`rs_sttime`（缩写）、`add_once_area`（下划线）、`gameover`（全小写）、`movehtm`（全小写缩写）
- `rs_sttime` 命名不直观，`starttime` 的缩写拼成了 `sttime`


---

## 三、性能评估

### 3.1 数据库操作

**高风险点：**

| 位置 | 问题 | 风险等级 |
|------|------|----------|
| L20 | `file_get_contents()` + `str_replace()` 读取 SQL 文件后用 `db->queries()` 多语句执行 | 高 |
| L172 | NPC 初始化在 foreach 循环内逐条 `array_insert`，每次一条 INSERT | 高 |
| L425-L435 | 禁区全满淘汰时 `while` 循环内逐条 UPDATE | 高 |
| L460-L494 | 禁区淘汰时 `while` 循环内逐条 UPDATE | 高 |
| L530-L540 | 每局结束遍历压缩 records 目录下所有 .txt 文件 | 中 |

**具体分析：**

1. **NPC 逐条 INSERT**：旧代码（L179-L183）曾有一段批量 INSERT 逻辑被注释掉。当前 `foreach` 内调用 `$db->array_insert()` 逐条插入，对100+ NPC的局来说性能影响显著

2. **禁区淘汰逐条 UPDATE**：L460-L494 的 `while` 循环内对每个在禁区内的玩家执行 `UPDATE ... SET pls='$pls'`，可用单条 `CASE WHEN` 批量 UPDATE 代替

3. **日志压缩**：每局结束时的 L530-L540 遍历 `records/$gamenum/` 下所有 txt 文件并逐个 gzip 压缩，是 O(n) 文件 I/O 操作

### 3.2 内存与 I/O

- `openfile()` 将整个配置文件读入数组（如 `mapitem` 配置），大文件内存消耗不可控
- `rs_game(16)` 中构建 `$iqry`/`$tqry` 字符串可能非常大（取决于 `mapitem` 条目数）

---

## 四、安全评估

### 4.1 SQL 注入风险

| 位置 | 代码 | 风险 | 等级 |
|------|------|------|------|
| L172 | `$db->array_insert(...)` | 使用了专用方法，安全 | 低 |
| L244-L261 | `$iqry .= "('$iname', '$ikind', ...)"` | 变量直接拼接 SQL | **高** |
| L356-L365 | 同上，shopitem 拼接 | 变量直接拼接 SQL | **高** |
| L433 | `UPDATE ... SET hp='$hp', bid='$bid'` | `$bid` 来自外部 | 中 |
| L469 | 同上，`$pid` 来自数据库值 | `$pid` 是 int | 低 |

**详细分析：**

`rs_game(16)` 的 L244-L261 中，`$iname`, `$ikind`, `$ieff`, `$ista`, `$iskind`, `$itmpara` 都来自配置文件 `openfile()` 解析，直接拼入 INSERT 语句。如果配置文件被篡改（或 RuleSet 引入恶意配置），可能造成 SQL 注入。

`rs_game(32)` 的 L356-L365 同理，`$price`, `$area`, `$item`, `$itmk`, `$itme`, `$itms`, `$itmsk`, `$itmpara` 直接拼接。

目前这些值来自服务端配置文件（非用户输入），风险可控，但缺乏防御纵深。如果未来支持用户自定义 RuleSet 配置，将是严重漏洞。

### 4.2 其他安全问题

- L58：`shuffle($arealist)` 使用 PHP 内置的 PRNG，可预测性较高（对于依赖随机分布的游戏公平性有影响）
- L530-L540：`glob("./records/...")` 使用相对路径，可能受当前工作目录影响
- 无文件锁或事务保护 `gameover()` 中对 winners 表的多次写入——在高并发场景下可能导致数据不一致

---

## 五、可维护性评估

### 5.1 依赖关系复杂

```
system.func.php
  ├─ include/meta/credits.func.php  (L8, 硬编码 require)
  ├─ include/gamectl/gamestate.func.php  (调用 rs_game/add_once_area/gameover/areawarn)
  ├─ include/gamectl/deatharea.func.php  (调用 get_next_death_areas/is_event_area/get_areainfo_html)
  ├─ include/meta/achievement.func.php  (gameover 内部条件加载 L602, L629)
  ├─ include/game/depot.func.php  (rs_game 内部条件加载 L299)
  ├─ include/gamectl/news.func.php  (gameover 内部加载 L650)
  ├─ include/pregame/clubslct.func.php  (rs_game 内部加载 L78)
  ├─ include/core/global.func.php  (writeover/openfile/config/save_gameinfo 等)
  └─ gamedata/cache/*.php  (config() 加载的缓存配置)
```

**问题：** 大量 `include_once` 在函数体内部（L8, L78, L299, L602, L629, L650），形成隐式依赖。任何文件路径变更需要同时修改 system.func.php。

### 5.2 全局变量蔓延

`add_once_area()` 声明了17个全局变量（L409-L410），这些变量分散定义于多个不同文件中，新人理解数据来源极其困难。

### 5.3 循环依赖风险

- `gamestate.func.php` 调用 `system.func.php` 的函数（`rs_game`, `gameover`, `add_once_area`）
- `system.func.php` 的函数内部条件加载 `gamestate.func.php` 依赖的子模块
- 若加载顺序出错可能导致"函数未定义"错误

---

## 六、扩展性评估

### 6.1 RuleSet 兼容性

代码已包含 RuleSet 钩子（L135、L141、L144、L242），但使用 `function_exists()` 运行时检查，缺乏显式的插件注册机制。

**问题：**
- 新增原创模式需要修改 `rs_game()` 的 flag 逻辑，侵入性强
- 游戏结束模式（`end1`-`end7`）硬编码在 `gameover()` 中，新增结束类型需修改核心函数

### 6.2 配置耦合

- `$areahour` 从"小时"改为了"分钟"（L55注释），但变量名未更新，命名与语义不匹配
- 禁区逻辑中大量硬编码：`$weather <= 9`、`$gamestate >= 40`、`$sub['tactic']!=4` 等，如果战斗系统配置变更，这些判断需要同步修改

---

## 七、模块交互分析

### 7.1 交互关系图

```
                  common.inc.php (状态机调度)
                        │
          ┌─────────────┼─────────────┐
          ▼             ▼             ▼
   gamestate.func   system.func   deatharea.func
   (状态转换判定)    (游戏系统)      (禁区判断)
          │             │             │
          │    ┌────────┼────────┐    │
          │    ▼        ▼        ▼    │
          │  credits  achievement news │
          │  (积分)    (成就)    (新闻) │
          │                           │
          ▼                           ▼
   console.func/item2.func/ending/npc/tool
   (各游戏模块可直接触发 gameover/movehtm/areawarn)
```

### 7.2 调用链复杂度

**`gameover()` 的调用链分析：**

```
gameover()
  ├─ glob() + gzopen()           ← 日志归档
  ├─ 模式判断分支               ← 4种分支路径
  ├─ save_gameinfo()             ← 全局状态持久化
  ├─ check_end_achievement_rev() ← 成就结算
  ├─ check_end_achievement_rev() ← 队伍成员成就
  ├─ rs_sttime()                 ← 下局开始时间
  ├─ addnews() × 2-3             ← 新闻写入
  ├─ systemputchat()             ← 聊天广播
  ├─ nparse_news()               ← 新闻归档
  ├─ writeover()                 ← HTML归档
  └─ set_credits()               ← 积分结算
```

一个 `gameover()` 调用会触发 **至少10种不同的 I/O 操作**（数据库查询、UPDATE、INSERT、文件读写），一个操作失败可能导致部分状态不一致。

---

## 八、问题汇总与严重程度评级

| ID | 类别 | 问题描述 | 严重程度 | 位置 |
|----|------|----------|----------|------|
| A1 | 结构 | `rs_game()` 承担6种职责，360行单体函数 | 高 | L10-L368 |
| A2 | 结构 | `add_once_area()` 混合禁区/淘汰/迁移/天气/刷新逻辑 | 高 | L407-L512 |
| A3 | 结构 | `gameover()` 135行包含10+种 I/O 操作 | 高 | L525-L659 |
| B1 | 性能 | NPC 逐条 INSERT，100+条 N+1 问题 | 高 | L172 |
| B2 | 性能 | 禁区淘汰逐条 UPDATE | 高 | L460, L474, L492 |
| B3 | 性能 | 日志压缩逐文件 O(n) 操作 | 中 | L530-L540 |
| C1 | 安全 | 地图道具/商店物品 SQL 拼接无参数化 | 中 | L244-L261, L356-L365 |
| C2 | 安全 | 无序列表 `shuffle()` 使用可预测 PRNG | 低 | L58 |
| D1 | 维护 | 60+行废弃注释代码 | 中 | 全局散布 |
| D2 | 维护 | 函数体内条件 `include_once` 形成隐式依赖 | 中 | L8, L78, L299, L602 |
| D3 | 维护 | 全局变量声明分散在函数体内不同位置 | 中 | L11, L32, L53, L67 |
| E2 | 可读 | 无 PHPDoc 文档 | 低 | 全部函数 |
| F1 | 扩展 | 新游戏结束模式需改核心函数 | 中 | L525-L659 |

---

## 九、分阶段优化方案

### 第一阶段：代码清理与规范化

**目标：** 消除技术债务，提升可读性，零业务逻辑变更。  
**预期工时：** 1-2天  
**风险：** 极低

| 任务 | 具体内容 | 预期效果 |
|------|----------|----------|
| 1.1 删除废弃代码 | 移除所有注释掉的旧实现（L12, L22-L29, L79-L101, L173, L179-L183, L191-L198, L263-L266, L287-L294, L654） | 减少 ~60行，提升可读性 |
| 1.2 统一全局变量声明 | 将所有 `global` 声明集中到函数顶部，按字母排序 | 提升代码规范 |
| 1.3 添加 PHPDoc | 为全部6个函数编写标准的 `@param`/`@return`/`@global`/`@since` 文档 | IDE 智能提示、类型安全 |
| 1.4 修正路径使用 | `glob("./records/...")` 改为 `glob(GAME_ROOT . "./records/...")` | 防御路径遍历 |

---

### 第二阶段：安全性加固与防御性编程

**目标：** 消除潜在安全漏洞，提升异常处理能力。  
**预期工时：** 2-3天  
**风险：** 中

| 任务 | 具体内容 | 预期效果 |
|------|----------|----------|
| 2.1 参数化 SQL 拼接 | 将 `rs_game(16)` 和 `rs_game(32)` 的字符串拼接 INSERT 改为 `array_insert` 批量插入，或使用 `$db->escape()` 转义 | 消除 SQL 注入风险（纵深防御） |
| 2.2 添加事务保护 | `gameover()` 中对 `winners` 表的多步写入用 `START TRANSACTION ... COMMIT` 包裹 | 防止半状态写入 |
| 2.3 防御性检查 | `rs_game(8)` NPC 初始化前验证 `$plsinfo` 非空；`add_once_area()` 禁区淘汰前验证 `get_death_areas()` 非空 | 防止边缘情况崩溃 |
| 2.4 消除运行时钩子检测 | 将 RuleSet 钩子改为定义空 stub 函数（`ruleset_should_randomize_npc() { return false; }`），消除 `function_exists()` 运行时检测的性能开销 | 微性能提升 |

---

### 第三阶段：性能优化

**目标：** 减少数据库往返次数，降低文件 I/O 开销。  
**预期工时：** 3-4天  
**风险：** 中

| 任务 | 具体内容 | 预期效果 |
|------|----------|----------|
| 3.1 NPC 批量 INSERT | 将 `rs_game(8)` 改为收集所有 NPC 数据到数组，最后一条 `INSERT INTO ... VALUES (...), (...), (...)` 批量写入 | NPC=100时减少99次 DB 往返 |
| 3.2 禁区淘汰批量 UPDATE | 用 `UPDATE ... SET pls = CASE WHEN pid=1 THEN X WHEN pid=2 THEN Y ... END WHERE pid IN (1,2,...)` 替代逐条 UPDATE | 减少 N 次 DB 往返 |
| 3.3 日志压缩异步化 | `gameover()` 中将 `glob`+`gzopen` 逻辑改为记录待压缩列表到数据表，由独立 cron/scheduler 处理 | `gameover()` 调用不再阻塞在 I/O 上 |
| 3.4 `openfile()` 流式处理 | 对于大配置文件（如 `mapitem`），改用 `fopen`+`fgets` 逐行处理，替代一次性读入数组 | 减少峰值内存 |

---

### 第四阶段：架构重构

**目标：** 拆分巨型函数，建立清晰的职责边界。  
**预期工时：** 4-6天  
**风险：** 高（必须全部回归测试覆盖游戏完整流程）

| 任务 | 具体内容 | 预期效果 |
|------|----------|----------|
| 4.1 拆分 `rs_game()` | 将6个 flag 对应的代码块提取为6个独立子函数：`rs_reset_social()`, `rs_init_areas()`, `rs_init_players()`, `rs_init_npcs()`, `rs_init_mapitems()`, `rs_init_shops()` | 单一职责，可独立测试 |
| 4.2 拆分 `add_once_area()` | 提取 `eliminate_players_in_death_areas()`, `migrate_npcs_from_death_areas()`, `check_post_area_gameover()` 三个子函数 | 逻辑层次清晰 |
| 4.3 拆分 `gameover()` | 提取 `compress_game_logs()`, `determine_winmode()`, `record_winner()`, `settle_all_credits()`, `archive_news()` | 每函数 < 50行 |
| 4.4 依赖注入 | `rs_game()`, `gameover()` 等通过参数接收 `$db` 和配置，而非 `global` 声明 | 可测试性提升 |

---

### 第五阶段：扩展性增强

**目标：** 支持未来游戏模式扩展，降低新功能接入成本。  
**预期工时：** 4-5天  
**风险：** 低

| 任务 | 具体内容 | 预期效果 |
|------|----------|----------|
| 5.1 游戏结束模式注册机制 | 定义 `$gameover_modes` 数组 + `register_gameover_mode()` 函数，`gameover()` 通过查表分发而非 if/else | 新增结束类型无需改核心代码 |
| 5.2 RuleSet 钩子系统正规化 | 将 `function_exists()` 检测改为事件分发器 `fire_ruleset_hook('on_npc_init', $npc)` | 支持多个 RuleSet 叠加 |
| 5.3 配置校验层 | 在 `rs_game()` 初始化前对必需配置做 schema 验证（如 `$plsinfo` 非空、`$areahour` > 0、`$areaadd` > 0） | 启动时发现问题而非运行时崩溃 |

---

## 十、实施优先级矩阵

```
                    影响范围
              低          中          高
         ┌──────────┬──────────┬──────────┐
    高   │  阶段一   │  阶段二   │  阶段四   │
风        │ (立即做)  │          │ (需回归)  │
         ├──────────┼──────────┼──────────┤
险 中   │  阶段五   │  阶段三   │          │
         ├──────────┼──────────┼──────────┤
程 低   │          │          │          │
度        └──────────┴──────────┴──────────┘
```

**推荐执行顺序：**

1. **第一阶段** → 立即执行（代码清理，零风险）
2. **第二阶段 2.1 + 2.3** → SQL 参数化 + 防御性检查
3. **第三阶段 3.1 + 3.2** → 批量 INSERT/UPDATE
4. **第二阶段 2.2** → 事务保护
5. **第四阶段** → 架构重构（充分回归测试后）
6. **第五阶段** → 扩展性增强（长期规划）

---

## 附录：涉及文件清单

| 文件 | 关系 |
|------|------|
| `include/gamectl/system.func.php` | 评估对象 |
| `include/gamectl/gamestate.func.php` | 调用 `rs_game`/`gameover`/`add_once_area`/`areawarn` |
| `include/gamectl/deatharea.func.php` | `movehtm()` 委托对象，`is_event_area()`/`is_death_area()` 等 |
| `include/core/common.inc.php` | 状态机调度，加载 system.func.php |
| `include/core/global.func.php` | `config()`/`save_gameinfo()`/`addnews()`/`writeover()` 等工具函数 |
| `include/meta/credits.func.php` | `set_credits()` 积分结算 |
| `include/meta/achievement.func.php` | `check_end_achievement_rev()` 成就检查 |
| `include/gamectl/news.func.php` | `nparse_news()` 新闻归档 |
| `include/pregame/clubslct.func.php` | `changeclub()` 社团初始化 |
| `include/game/depot.func.php` | NPC 仓库道具初始化 |
| `include/game/console.func.php` | 直接调用 `movehtm()`/`areawarn()` |
| `include/game/item/type/ending.php` | 直接调用 `gameover()` |
| `include/game/item/type/tool.php` | 直接调用 `gameover()` |
| `include/game/item/type/npc.php` | 直接调用 `movehtm()` |
| `include/admin/gameinfomng.php` | 后台调用 `gameover()` |
| `include/admin/gamecheck.php` | 后台调用 `movehtm()` |
| `gamedata/ruleset/ruleset_config.php` | RuleSet 配置文件 |
| `gamedata/cache/*.php` | `config()` 加载的游戏配置缓存 |