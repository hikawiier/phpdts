# include/ 目录结构说明

> 本文档描述`include/`目录的分层架构和文件分类规则。

---

## 一、目录结构

```
include/
├── core/                 # [A] 基础设施层 — 与游戏逻辑无关
│   ├── common.inc.php    # 核心初始化：常量定义、输入过滤、数据库连接、配置加载
│   ├── global.func.php   # 全局工具函数：config()、模板引擎、日志、聊天、物品信息解析
│   ├── template.func.php # 模板编译引擎（按需加载）
│   └── JSON.php          # JSON编解码
│
├── db/                   # [B] 数据库层
│   ├── db_mysql.class.php
│   ├── db_mysqli.class.php
│   ├── db_pdo.class.php
│   ├── db_mysql_error.inc.php
│   ├── db_mysqli_error.inc.php
│   └── masterslave.func.php  # 主从数据库同步
│
├── auth/                 # [C] 用户认证
│   └── user.func.php     # 用户注册、登录、密码验证
│
├── room/                 # [D] 房间基础设施 — 游戏的「容器」
│   ├── roommng.func.php      # 房间创建、子房间管理
│   └── ruleset_override.func.php  # RuleSet覆盖（房间级别配置版本控制）
│
├── gamectl/              # [E] 游戏会话控制 — 一局游戏的生命周期
│   ├── gamestate.func.php    # 游戏状态机（0→10→20→30→40调度器）
│   ├── system.func.php       # 游戏重置、禁区推进、游戏结束
│   ├── game.func.php         # 玩家数据初始化、存档、NPC武器切换
│   ├── init.func.php         # 角色状态初始化、头像、天眼技能
│   ├── state.func.php        # 状态管理（死亡处理、休息、治疗）
│   ├── news.func.php         # 游戏进行状况消息显示
│   ├── messages.func.php     # 站内信系统
│   ├── resources.func.php    # 资源加载函数
│   └── antiafk.func.php      # 反挂机检查（定时任务）
│
├── pregame/              # [F] 游戏准备 — valid.php激活阶段
│   ├── clubslct.func.php     # 社团选择
│   └── titles.func.php       # 头衔系统（选择初始称号）
│
├── game/                 # [G] 游戏内逻辑 — 仅$gamestate == 20
│   ├── combat/           # G1. 战斗系统
│   │   ├── revcombat.func.php       # 战斗主流程
│   │   ├── revcombat.calc.php       # 非伤害性计算
│   │   ├── revcombat_extra.func.php # 战斗流程特殊行为
│   │   ├── revbattle.func.php       # 战斗前端渲染
│   │   ├── revbattle.calc.php       # 战斗前端计算
│   │   ├── revattr.func.php         # 战斗伤害核心
│   │   ├── revattr.calc.php         # 战斗伤害特殊计算
│   │   └── revattr_extra.func.php   # 战斗伤害额外逻辑
│   │
│   ├── item/             # G2. 物品系统
│   │   ├── itemmain.func.php       # 主入口
│   │   ├── item.func.php           # 分发器itemuse()
│   │   ├── item2.func.php          # 具体逻辑
│   │   ├── itemmix.func.php        # 合成
│   │   ├── itemplace.func.php      # 放置/刷新
│   │   ├── itmpara_tooltip.func.php # 物品参数提示
│   │   └── type/                   # 各类型物品实现（20+文件）
│   │
│   ├── club/             # G3. 社团系统
│   │   ├── revclubskills.func.php       # 社团技能底层
│   │   ├── revclubskills.inc.php        # 社团技能常量
│   │   ├── revclubskills_extra.func.php # 各社团技能具体逻辑
│   │   ├── club21.func.php, club22.func.php
│   │   ├── elementmix.func.php, elementmix.calc.php
│   │
│   ├── event/            # G4. 事件系统
│   │   ├── event.func.php
│   │   ├── revevent.func.php
│   │   └── aievent.func.php
│   │
│   ├── search.func.php   # G5. 探索/移动
│   ├── encounter.func.php # G5. 遭遇
│   ├── quest.func.php    # G5. 任务
│   ├── special.func.php  # G5. 杂项行动
│   ├── team.func.php     # G5. 队伍
│   ├── duel.func.php     # G5. 决斗
│   ├── extrabag.func.php # G5. 额外背包
│   ├── depot.func.php    # G5. 仓库
│   ├── fishing.func.php  # G5. 钓鱼
│   ├── fortune.func.php  # G5. 运势
│   ├── dice.func.php     # G5. 骰子
│   ├── setitems.func.php # G5. 套装
│   ├── console.func.php  # G5. 控制台
│   ├── song.inc.php      # G5. 歌曲
│   └── npc.func.php      # G5. NPC管理（被多阶段调用）
│
├── meta/                 # [H] 跨游戏/结算
│   ├── credits.func.php      # 积分结算（游戏结束后）
│   ├── gambling.func.php     # 赌局系统（跨游戏）
│   └── achievement.func.php  # 成就系统（被多模块调用）
│
├── admin/                # 后台管理
│   └── ...
│
├── js/                   # 前端资源
│   ├── lib/jquery.min.js
│   ├── common.js, game.js, game20130526.js
│   ├── dialogue.js, json.js, pako.js, record.js
│
├── devtools/             # 开发工具
├── vnworld/              # VN世界
└── deprecated/           # 废弃文件
    ├── combat.func.old, attr.func.old
    ├── clubskills.func.old, item.func.old
    ├── weibolog.func.old, gameencrypt.old
```

---

## 二、分类总结表

| 目录 | 类别 | 文件数 | 核心特征 |
|------|------|--------|----------|
| `core/` | A. 基础设施 | 4 | 与游戏逻辑无关，纯框架 |
| `db/` | B. 数据库 | 6 | 数据库驱动和主从同步 |
| `auth/` | C. 用户认证 | 1 | 登录/注册 |
| `room/` | D. 房间基础设施 | 2 | 游戏的「容器」，不依赖游戏状态 |
| `gamectl/` | E. 游戏会话控制 | 9 | 一局游戏的生命周期管理 |
| `pregame/` | F. 游戏准备 | 2 | 激活阶段（valid.php） |
| `game/` | G. 游戏内逻辑 | 62 | 仅`$gamestate == 20` |
| `meta/` | H. 跨游戏结算 | 3 | 跨游戏阶段运行 |
| `admin/` | 后台管理 | ~25 | 保持不变 |
| `js/` | 前端资源 | 8 | JS文件统一收纳 |
| `devtools/` | 开发工具 | 2 | 保持不变 |
| `vnworld/` | VN世界 | 1 | 保持不变 |
| `deprecated/` | 废弃文件 | 6 | `.old`文件 |

---

## 三、分类规则

### 如何判断文件归属？

1. **文件是否在任何游戏阶段都使用？** → `core/`（如common.inc.php, global.func.php）
2. **文件是否只处理数据库连接？** → `db/`
3. **文件是否处理用户登录/注册？** → `auth/`
4. **文件是否处理房间创建/配置，与游戏状态无关？** → `room/`
5. **文件是否管理游戏状态转换、重置、结束？** → `gamectl/`
6. **文件是否只在valid.php激活阶段使用？** → `pregame/`
7. **文件是否仅在`$gamestate == 20`时通过command.php加载？** → `game/`
8. **文件是否跨游戏阶段运行（结算、成就、赌局）？** → `meta/`

### 边界情况

- **`npc.func.php`** 留在`game/`根：被state.func.php、quest.func.php、aievent.func.php等多个模块调用，横跨多个阶段，本质上是游戏内公用库
- **`dice.func.php`** 留在`game/`：在common.inc.php加载（始终可用），但实际只在游戏内通过command.php调用
- **`titles.func.php`** 归入`pregame/`：在common.inc.php加载，且valid.php激活阶段就使用（选择初始称号）

---

## 四、GAME_ROOT 定义

`GAME_ROOT`定义于[core/common.inc.php](core/common.inc.php)第4行：

```php
define('GAME_ROOT', dirname(__DIR__, 2) . '/');
```

`dirname(__DIR__, 2)`从`include/core/`向上两级得到项目根目录。此方案不依赖硬编码路径长度，文件移动后只需调整数字参数。
