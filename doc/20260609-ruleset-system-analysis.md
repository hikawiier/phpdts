# RuleSet 系统（时光重现）说明文档

> **文档日期**：2026-06-09  
> **系统别名**：时光重现（Time Replay）  
> **设计目标**：允许在一个游戏实例中并行运行多个旧版本/变体版本的房间，每个房间拥有独立的配置、资源、头像和剧情。

---

## 一、架构概览

RuleSet 系统在 PHPDTS 中是一个**平行配置层**，嵌入在原有的房间系统之上。它不修改核心代码文件，而是通过三个机制实现版本隔离：

1. **配置覆盖**：`config()` 函数的三级 fallback（RuleSet cache → 主 cache → `_1.php`）
2. **数据覆盖**：`get_ruleset_plain_resource_file()` 的路径改写
3. **逻辑覆盖**：`ruleset_override.func.php` 动态加载的函数文件

### 数据流全景

```
[用户创建房间] → index.php
    → roommng_create_new_room($udata, $ruleset_id)
    → INSERT INTO game (..., gruleset='ACBRA_2009')
        ↓
[其他玩家加入] → common.inc.php 初始化
    → config() 函数读取 gruleset → 自动优先加载 RuleSet cache 文件
    → init_ruleset_override() 加载覆盖函数
    → get_current_ruleset_id() 查询当前房间的 ruleset
        ↓
[玩家入场] → valid.php
    → 从 game 表读取 gruleset
    → 应用 initial_setup（血量/SP/装备/clbpara标记）
    → 设置 ruleset_opening_story 标记
        ↓
[游戏进行] → game.php / command.php
    → $gruleset 来自 load_gameinfo()（已缓存在全局变量）
    → 游戏结束时检查 ruleset_ending_shown
    → 显示对应的开场/结束剧情
        ↓
[功能触发] → init.func.php init_icon_states()
    → 检查 gruleset → 加载 RuleSet 自定义头像
    → resources.func.php get_questcfg()
    → 读取 RuleSet 的 addnpc_quest_1.php / questcfg_1.php
```

---

## 二、核心配置文件

### 2.1 `gamedata/ruleset/ruleset_config.php`（616 行）

**全局变量**：

- `$ruleset_enabled` (bool)：系统总开关
- `$ruleset_config` (array)：所有 RuleSet 的配置定义

**定义的 RuleSet**（5 个）：

| 标识符 | 名称 | credits_cost | admin_free | head_avatars | title_system | club_skills |
|--------|------|:----------:|:----------:|:--------:|:-----------:|:----------:|
| YELLOWKNIFE | YELLOWKNIFE | 1 | ✅ | 0/0 | 2 | 2 |
| ACBRA_2009 | ACBRA 2009版 | 1 | ✅ | 43/43 | 0 | 0 |
| ACDTS_2011 | ACDTS 2011版 | 1 | ✅ | 21/21 | 0 | 0 |
| ACDTS_298SP4 | ACDTS 298SP4版 | 5 | ✅ | 22/21 | 0 | 0 |
| ACDTS_298SP4_AR | ACDTS298 ALL RANDOM | 5 | ✅ | 22/21 | 0 | 0 |

**每个 RuleSet 配置的结构**：
```php
'RULESET_ID' => Array(
    'name'          => '显示名称',
    'description'   => '描述文字',
    'credits_cost'  => 1,           // 创建所需的切糕数
    'admin_free'    => true,        // 管理员免费
    'initial_setup' => Array(       // 玩家入场初始化
        'hp_limit'           => 400,
        'sp_limit'           => 400,
        'base_exp'           => 20,
        'money'              => 20,
        'initial_items'      => Array(),
        'initial_equipment'  => Array(),
        'clbpara_flags'      => Array( 'ruleset_version' => '...' ),
    ),
    'title_system'  => 2,           // 0=禁用 1=限制奖励 2=全部启用
    'club_skills'   => 2,           // 0=禁用 1=覆盖 2=不禁用
    'avatar_config' => Array(
        'use_ruleset_avatars' => true,
        'avatar_path'          => './gamedata/ruleset/.../img/',
        'male_avatars'         => 43,
        'female_avatars'       => 43,
        'npc_avatars'          => Array( /* NPC 头像映射 */ ),
        'special_avatars'      => Array( /* 特殊头像 */ ),
    ),
    'story_config' => Array(
        'opening_story' => '欢迎...',
        'ending_story'  => '再见...',
    ),
),
```

**导出的函数**：

| 函数 | 参数 | 返回值 | 用途 |
|------|------|--------|------|
| `get_ruleset_config($id)` | (string\|null) | `array\|false` | 获取指定或全部 RuleSet 配置 |
| `can_create_ruleset_room($id, $user_data)` | (string, array) | `bool` | 检查用户是否有权限创建 |
| `get_ruleset_resource_path($id, $type)` | (string, string) | `string\|false` | 获取 RuleSet 资源目录路径 |
| `ruleset_resource_exists($id, $filename, $type)` | (string, string, string) | `bool` | 检查资源文件是否存在 |
| `get_ruleset_avatar_path($id, $type, $avatar_id)` | (string, string, int\|null) | `string\|false` | 获取 RuleSet 头像文件路径 |
| `ruleset_uses_custom_avatars($id)` | (string) | `bool` | 检查是否使用自定义头像 |
| `get_ruleset_avatar_limits($id)` | (string) | `array\|false` | 获取头像数量限制 |

### 2.2 `gamedata/ruleset/story_config.php`（283 行）

**全局变量**：
- `$ruleset_stories` (array)：简版剧情内容（带 HTML 格式化和按钮）
- `$ruleset_story_pages` (array)：分镜式剧情内容（纯文本，多个分页面）

**导出的函数**：

| 函数 | 参数 | 用途 |
|------|------|------|
| `get_ruleset_story($id, $type)` | (string, 'opening'\|'ending') | 获取指定 RuleSet 的简版剧情 |
| `has_ruleset_story($id)` | (string) | 检查 RuleSet 是否有自定义剧情 |
| `get_ruleset_story_pages($id, $type, $hp, $state, $winmode)` | (string, string, int, int, int) | 获取分镜剧情（按结局类型区分） |
| `get_ruleset_ending_story_key($hp, $state, $winmode)` | (int, int, int) | 计算结局剧情键名 |

**结局剧情键名规则**（由 `get_ruleset_ending_story_key()` 计算）：

| 条件 | 键名 | 示例 |
|------|------|------|
| `$hp <= 0` | `death` | "你倒下了..." |
| `$winmode=2 && winner` | `end2_winner` | "锁定解除成功" |
| `$winmode=2 && !winner` | `end2_other` | "锁定被其他人解除" |
| `$winmode=5 && winner` | `end5_winner` | "核爆胜利" |
| `$winmode=7 && winner` | `end7_winner` | "幻境解离" |
| 其他 | `end{$winmode}` | 通用结局 |

### 2.3 `include/room/ruleset_override.func.php`（87 行）

运行时覆盖系统的入口。在 `common.inc.php` 中调用。

**导出的函数**：

| 函数 | 用途 |
|------|------|
| `get_current_ruleset_id()` | 从 DB 查询当前房间的 `gruleset` 字段 |
| `is_all_random_mode()` | 检查是否为全随机模式（ACDTS_298SP4_AR） |
| `init_ruleset_override()` | 初始化覆盖系统：加载 `ruleset_config.php` 并缓存当前房间配置 |
| `load_ruleset_override_functions()` | 动态加载 RuleSet 特定的函数覆盖文件 |
| `debug_ruleset_override()` | 调试输出当前 RuleSet 信息 |

### 2.4 `include/gamectl/resources.func.php`（174 行）

**关键函数**：

| 函数 | 用途 |
|------|------|
| `get_ruleset_plain_resource_file($filename)` | 返回 RuleSet 下的非缓存文件路径（如 `questcfg_1.php`），优先 RuleSet 目录再 fallback 到 `gamedata/` |

---

## 三、实现机制详解

### 3.1 配置加载：config() 函数的三级 Fallback

`config()`（`include/core/global.func.php` L144-174）是 RuleSet 的配置加载核心：

```
config('gamecfg', $gamecfg) 被调用
    ↓
查询当前房间 gruleset
    ↓
Level 1 -> 尝试 gamedata/ruleset/{ruleset_id}/cache/gamecfg_{gamecfg}.php
    ↓ 不存在
Level 2 -> 尝试 gamedata/ruleset/{ruleset_id}/cache/gamecfg_1.php
    ↓ 不存在
Level 3 -> 尝试 gamedata/cache/gamecfg_{gamecfg}.php
    ↓ 不存在
Level 4 -> 尝试 gamedata/cache/gamecfg_1.php（最终 fallback）
```

这意味着多个 RuleSet 可以共享同一个 `gamedata/cache/` 目录中的配置，仅在有独立配置时才用 RuleSet 的 cache 覆盖。

### 3.2 房间创建流程

```
[index.php] 用户点击"创建 RuleSet 房间"
    → include_once ruleset_config.php
    → can_create_ruleset_room($ruleset_id, $udata)
        → 检查管理员免费用（groupid >= 2）
        → 检查切糕数（credits2 >= credits_cost）
    → roommng_create_new_room($udata, $ruleset_id)
        → 扣除切糕（非管理员）
        → INSERT INTO game (..., gruleset='{ruleset_id}')
    → 清空房间列表缓存（roomlist.php）
```

### 3.3 玩家入场初始化

```
[valid.php] 玩家激活
    → 查询 game 表 gruleset
    → include_once ruleset_config.php
    → get_ruleset_config($ruleset_id)
    → 应用 initial_setup:
        → hp_limit → $mhp, $hp
        → sp_limit → $msp, $sp
        → base_exp → $exp
        → money → $money
        → initial_items → 填充物品栏
        → initial_equipment → 设置装备属性
        → clbpara_flags → 写入 clbpara（标记版本号）
    → 设置 $clbpara['ruleset_opening_story'] = true
    → 设置 $clbpara['noskip_dialogue'] = 'opening'
```

### 3.4 剧情显示流程

```
[game.php] 首次刷新后
    → 检测 clbpara['ruleset_opening_story'] && !clbpara['ruleset_story_shown']
    → include_once story_config.php
    → get_ruleset_story($ruleset_id, 'opening')
    → 注入剧情内容到 $dialogues / $dialogue_log
    → 打开对话模态框

[game.php] 死亡后
    → 检测 ruleset_ending_shown 标记
    → 加载 ending 剧情

[game.php] 入场首次见面（validover 后）
    → $clbpara['noskip_dialogue'] = 'opening'
    → 显示强制不可跳过的开场对话
```

### 3.5 头像系统

`init_icon_states()`（`include/gamectl/init.func.php`）在加载玩家/NPC 头像时检查 gruleset：

```
init_icon_states(&$pa, $pd, $ismeet)
    → 查询 gruleset
    → include_once ruleset_config.php
    → get_ruleset_avatar_path($ruleset_id, 'male'|'female'|'npc', $icon_id)
    → 头像路径映射：
        NPC：ruleset_config.php 的 npc_avatars 数组
        玩家：m_{id}.gif / f_{id}.gif
    → fallback：如果 RuleSet 头像不存在，回退到主 img/ 目录
```

`get_iconlist()`（`include/auth/user.func.php`）在头像选择器中使用 RuleSet 的头像数量限制替换全局 `$iconlimit`。

### 3.6 全随机模式（ACDTS_298SP4_AR）

唯一使用覆盖函数的 RuleSet：

```
[common.inc.php]
    → init_ruleset_override()
    → load_ruleset_override_functions()
        → include gamedata/ruleset/ACDTS_298SP4_AR/include/ruleset_functions.php
```

该文件的覆盖函数会**运行时替换**原有的物品生成/NPC 生成/数值计算逻辑，实现全随机化效果。

---

## 四、生命周期汇总

```
                +---------------------------------------+
                |           gamedata/ruleset/             |
                |   ruleset_config.php  (配置定义)        |
                |   story_config.php     (剧情内容)       |
                +----------------+----------------------+
                                 |
                    +------------+------------+
                    |                         |
        创建时读取                      运行时加载
                    |                         |
        房间创建/加入                include/room/
        (index.php)              ruleset_override.func.php
                    |                         |
                    v                         v
            game 表 gruleset          common.inc.php 调用
                    |                    init_ruleset_override()
                    |                    load_ruleset_override_functions()
                    |
         +----------+----------+----------+----------+
         |          |          |          |          |
         v          v          v          v          v
    config()   valid.php   game.php   init.func  resources.func
    (三级     (玩家入场   (剧情显示)  (头像覆     (任务/NPC
     fallback) 初始化)                 盖)         加载)
```

---

## 五、各文件职责总结

| 文件 | 层 | 职责 |
|------|----|------|
| `gamedata/ruleset/ruleset_config.php` | M | RuleSet 定义、权限检查、资源路径辅助函数 |
| `gamedata/ruleset/story_config.php` | M | 开场/结束/结局剧情内容 |
| `gamedata/ruleset/{id}/cache/*.php` | D | RuleSet 独立配置文件缓存 |
| `gamedata/ruleset/{id}/img/*` | D | RuleSet 自定义头像 |
| `gamedata/ruleset/{id}/include/*.php` | M | RuleSet 函数覆盖文件 |
| `gamedata/ruleset/{id}/valid.php` | M | RuleSet 特定的入场验证 |
| `gamedata/ruleset/{id}/*.php` | D | 任务配置等非缓存文件 |
| `include/room/ruleset_override.func.php` | I | 运行时覆盖初始化、函数动态加载 |
| `include/core/global.func.php :: config()` | I | 配置文件三级 fallback |
| `include/gamectl/resources.func.php` | I | 非缓存资源的 RuleSet 路径改写 |
| `include/gamectl/init.func.php` | I | 头像系统 RuleSet 集成 |
| `include/auth/user.func.php` | I | 头像选择器 RuleSet 集成 |

> 注：层标记含义 — M = 模型/配置, I = 基础设施集成, D = 数据文件

---

## 六、已知问题与改进建议

### 6.1 重复的 DB 查询
`gruleset` 数据库查询在代码中出现了 **7 处**（`config()`、`get_current_ruleset_id()`、`init_icon_states()`、`get_iconlist()`、`valid.php`、`game.php`、`user.func.php`）。其中 `config()` 每次调用都查询一次 DB，**同一个请求内的多次 `config()` 调用会产生重复查询**。建议在 `common.inc.php` 中使用全局变量缓存 `gruleset`，或利用 `load_gameinfo()` 中已有的 `$gruleset`。

### 6.2 配置获取的复合调用
`config()` 函数同时查询 DB 和检查文件系统（`file_exists`），且每次调用都执行一次 DB SELECT。在 `common.inc.php` 的配置加载循环中（8 个配置文件），这意味着**最少 8 次 DB 查询**来获取同一个 `gruleset` 字段值。

### 6.3 函数内 `global` 依赖
`ruleset_config.php` 中的函数依赖 `$ruleset_config` 全局变量。`get_ruleset_config()` 内部有 fallback 本地配置（与主 `$ruleset_config` 重复定义），这导致两份几乎相同的配置数组需要在文件中维护同步。

### 6.4 avatar/localhost 路径问题
`get_ruleset_avatar_path()` 返回的路径包含 `./` 前缀，在本地开发服务器（`php -S`）中可能需要调整 DOCUMENT_ROOT 配置。

### 6.5 剧情内容双套定义
`story_config.php` 包含两套剧情内容：
- `$ruleset_stories`：简版 HTML 格式化版本（含按钮定义）
- `$ruleset_story_pages`：详细分镜版本（按结局类型有 7 种分支）

两者之间存在内容冗余但结构不同，维护时需同时更新。

---

## 七、文件清单

```
gamedata/ruleset/
├── ruleset_config.php                     # 核心配置（616行）
├── story_config.php                       # 剧情内容（283行）
│
├── YELLOWKNIFE/                           # 当前主线版本快照
│   ├── cache/                             # 配置缓存
│   │   ├── resources_1.php
│   │   ├── gamecfg_1.php
│   │   └── ...
│   ├── img/                               # 自定义图片
│   ├── questcfg_1.php                     # 任务配置
│   ├── questitem_1.php                    # 任务物品
│   └── addnpc_quest_1.php                 # 任务 NPC
│
├── ACBRA_2009/                            # 2009 经典版
│   ├── cache/                             # 独立配置
│   ├── img/                               # 自定义头像（43 男 + 43 女 + NPC）
│   ├── include/                           # 覆盖函数
│   └── valid.php                          # 入场验证
│
├── ACDTS_2011/                            # 2011 版
│   ├── cache/
│   ├── img/                               # 自定义头像（21 男 + 21 女）
│   ├── include/
│   └── valid.php
│
├── ACDTS_298SP4/                          # 298SP4 版
│   ├── cache/
│   ├── img/                               # 自定义头像（22 男 + 21 女）
│   ├── include/
│   └── valid.php
│
├── ACDTS_298SP4_AR/                       # 全随机版
│   ├── cache/
│   ├── img/
│   ├── include/
│   │   └── ruleset_functions.php          # 覆盖函数（运行时替换逻辑）
│   └── valid.php
│
└── oblivions/                             # （目录，用途未知）
```

---

## 八、Touchpoint 调用位置索引

| 调用位置 | 文件 | 用途 |
|----------|------|------|
| `include/core/common.inc.php` L207 | `init_ruleset_override()` | 系统初始化 |
| `include/core/common.inc.php` L210 | `load_ruleset_override_functions()` | 加载覆盖函数 |
| `include/core/global.func.php` L144 | `config()` 内部 | 配置三级加载 |
| `include/core/global.func.php` L296 | `load_gameinfo()` 的 `$gruleset` | 游戏信息全局缓存 |
| `include/room/ruleset_override.func.php` L17 | `get_current_ruleset_id()` | 查询当前房间 |
| `include/room/ruleset_override.func.php` L37 | `is_all_random_mode()` | 全随机判断 |
| `include/room/roommng.func.php` L74 | `roommng_create_new_room()` | 创建房间 |
| `include/gamectl/init.func.php` L27 | `init_icon_states()` | 头像加载 |
| `include/gamectl/resources.func.php` L8 | `get_ruleset_plain_resource_file()` | 非缓存资源路径 |
| `include/gamectl/resources.func.php` L90 | `get_addnpcinfo()` | 任务 NPC 加载 |
| `include/gamectl/resources.func.php` L155 | `get_questcfg()` | 任务配置加载 |
| `include/gamectl/resources.func.php` L166 | `get_questiteminfo()` | 任务物品加载 |
| `include/auth/user.func.php` L101 | `get_iconlist()` | 头像选择器 |
| `game.php` L29 | `$gruleset` | 剧情显示 |
| `valid.php` L207 | `$ruleset_id` | 入场初始化 |
| `index.php` L34/75 | 房间列表/创建 | 首页展示 |
| `api_v2.php` L105 | `$gruleset` | VEX API 输出 |
