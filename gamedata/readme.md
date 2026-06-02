# gamedata 目录说明

## 目录结构

```
gamedata/
├── cache/          # 【主目录】主要的配置文件保存在此，config() 函数默认加载路径
├── ruleset/        # RuleSet（时光重现）规则集资源，按版本分目录
├── sql/            # 数据库 SQL 结构文件
├── readme.md       # 本文件
└── *.php           # 部分通过 get_ruleset_plain_resource_file() 加载的 fallback 文件
```

---

## 一、加载机制

### 1. `config($file, $cfg)` — 主配置加载函数

定义位置：[include/global.func.php](../include/global.func.php#L144)

加载优先级：
1. 若当前房间启用了 RuleSet → 加载 `gamedata/ruleset/{ruleset_id}/cache/{file}_{cfg}.php`
2. 否则 → 加载 `gamedata/cache/{file}_{cfg}.php`
3. 若指定版本不存在 → fallback 到 `{file}_1.php`

**关键：`config()` 不会加载 `gamedata/` 根目录的文件。**

### 2. `get_ruleset_plain_resource_file($filename)` — 非缓存资源加载

定义位置：[include/resources.func.php](../include/resources.func.php#L8)

加载优先级：
1. 若启用了 RuleSet → 加载 `gamedata/ruleset/{ruleset_id}/{filename}`
2. 否则 → fallback 到 `gamedata/{filename}`（根目录）

---

## 二、gamedata/cache/ 文件清单（活跃）

以下文件通过 `config()` 函数被加载，均处于活跃状态：

| 文件 | 加载位置 | 用途 |
|------|----------|------|
| `resources_1.php` | `common.inc.php` | 游戏资源定义 |
| `gamecfg_1.php` | `common.inc.php` | 游戏主配置 |
| `combatcfg_1.php` | `common.inc.php` | 战斗系统配置 |
| `clubskills_1.php` | `common.inc.php` | 社团技能配置 |
| `dialogue_1.php` | `common.inc.php` | 对话系统配置 |
| `audio_1.php` | `common.inc.php` | 音频资源配置 |
| `tooltip_1.php` | `common.inc.php` | 悬浮提示配置 |
| `titles_1.php` | `common.inc.php` | 头衔系统配置 |
| `npc_1.php` | `system.func.php` | NPC 数据 |
| `mapitem_1.php` | `system.func.php` | 地图物品配置 |
| `shopitem_1.php` | `system.func.php` | 商店物品配置 |
| `addnpc_1.php` | `system.func.php` | 额外 NPC 配置 |
| `evonpc_1.php` | `system.func.php` | 进化 NPC 配置 |
| `overlay_1.php` | `itemmain.func.php` | 超量合成配置 |
| `synitem_1.php` | `itemmain.func.php` | 同调合成配置 |
| `mixitem_1.php` | `resources.func.php` | 主合成配置 |
| `vnmixitem_1.php` | `vnmix.func.php` | vnworld-玩家提交合成配置 |
| `vnworld_1.php` | `vnmix.func.php` | vnworld-玩家提交系统主配置 |
| `stwep_1.php` | `valid.php` | 起始武器配置 |
| `stitem_1.php` | `valid.php` | 起始道具配置 |
| `achievement_1.php` | `resources.func.php` | 成就系统配置 |
| `setitems_1.php` | `resources.func.php` | 套装物品配置 |
| `wepchange_1.php` | `special.func.php` | 武器变换配置 |
| `fy_1.php` | `item.giftbox.php` | 特殊礼盒配置 |
| `f99_1.php` | `item.giftbox.php` | 特殊礼盒配置 |
| `itmlist_1.php` | `vn_postitem.php` 等 | 供快速输入调用的缓存文件 |
| `present_1.php` | `itemplace.func.php` | 特殊礼盒配置 |
| `box_1.php` | `itemplace.func.php` | 特殊礼盒配置 |
| `randomFS_1.php` | `item.other.php` | 特殊礼盒配置 |
| `randomFSW_1.php` | `item.other.php` | 特殊礼盒配置 |
| **以下为直接引用（非 config()）：** | | |
| `fishing.php` | `fishing.func.php` | 钓鱼系统配置 |
| `itmpara_tooltip.php` | `global.func.php` | 物品额外参数悬浮提示 |
| `club22cfg.php` | `club22.func.php` | 新版社团配置 |
| `style_20240120.css` | `header.htm` | 当前主样式表 |
| `style_buttons.20180118.css` | `header.htm` | 按钮样式表 |
| `style_messages.20180221.css` | `header.htm` | 消息样式表 |

---

## 三、gamedata/ 根目录文件清单（活跃）

以下文件通过直接 `require`/`include` 或 `get_ruleset_plain_resource_file()` 加载：

| 文件 | 加载方式 | 用途 |
|------|----------|------|
| `admincfg.php` | `admin.php` 直接 require | 管理员权限配置 |
| `club21cfg.php` | `club21.func.php` 直接 include | 旧版社团配置 |
| `questcfg_1.php` | `get_ruleset_plain_resource_file()` fallback | 任务配置（非 RuleSet 房间） |
| `addnpc_quest_1.php` | `get_ruleset_plain_resource_file()` fallback | 任务 NPC 配置 |
| `questitem_1.php` | `get_ruleset_plain_resource_file()` fallback | 任务物品模板 |

---

## 四、规范指引

### 新增配置文件

1. **优先放入 `gamedata/cache/` 目录**，命名格式为 `{name}_{version}.php`
2. 通过 `config('name', $version)` 函数加载，确保兼容 RuleSet 系统
3. 如需 RuleSet 独立版本，在 `gamedata/ruleset/{ruleset_id}/cache/` 下放置同名文件

### 非缓存类资源文件

1. 如需在 RuleSet 房间中覆盖，放入 `gamedata/ruleset/{ruleset_id}/` 目录
2. 在 `gamedata/` 根目录保留一份作为默认 fallback
3. 使用 `get_ruleset_plain_resource_file()` 加载

### 注意事项

- **不要**在 `gamedata/` 根目录直接放置 `config()` 加载的配置缓存文件
- 废弃文件请添加 `.old` 后缀
- RuleSet 专用的字体、CSS 等静态资源放在 `gamedata/ruleset/{ruleset_id}/` 下
- SQL 文件统一放在 `gamedata/sql/` 目录