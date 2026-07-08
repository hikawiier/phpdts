# Oblivions Room / Lifecycle 独立备忘设计案

> 状态：低优先级备忘。  
> 背景：Command API、Runtime / Tick、State API 已完成独立化，Oblivions 正常运行期已经不再依赖旧 `command.php` / `api_v2.php` / `common.inc.php` 的请求生命周期。

---

## 1. 当前判断

`Room / Lifecycle` 主要覆盖：

```txt
房间创建
房间列表 / 房间编号索引
用户加入房间
玩家激活 / valid.php
开局初始化
重开一局
房间结束 / 清理
```

这些流程发生在“进入一局 Oblivions 游戏之前”或“重开/结束一局时”。

对已经进入局内后的实际玩法链路影响很低：

```txt
探索
移动
战斗
合成
日志
技能
tick / heartbeat
State API 读取
Command API 写入
```

以上运行期内容已经由 Oblivions 专属 API 与 Runtime 接管。

因此本任务不属于当前最高优先级，可以作为后续架构清理任务排期。

---

## 2. 当前剩余耦合

虽然运行期已独立，但外围生命周期仍部分依赖旧核心：

```txt
D:\wamp64\www\phpdts\index.php
D:\wamp64\www\phpdts\valid.php
D:\wamp64\www\phpdts\game.php
D:\wamp64\www\phpdts\include\room\roommng.func.php
D:\wamp64\www\phpdts\include\gamectl\*.php
D:\wamp64\www\phpdts\oblivions\include\gamectl\*.php
```

旧 `game` 表目前仍承担：

```txt
房间编号索引
房间列表 / 房间管理
ruleset 识别
旧 gamestate 生命周期字段
```

Oblivions 局内单局状态已经迁移到：

```txt
bra_s{groomid}_oblgame
```

因此，旧 `game` 表目前主要剩余价值是“房间管理 / 房间索引”，而不是实际局内状态。

---

## 3. 低优先级原因

优先级较低的原因：

1. 不影响当前 Oblivions 局内体验。
2. 不影响 Command API。
3. 不影响 State API。
4. 不影响 Tick Orchestrator。
5. 不影响战斗状态机和前端导演。
6. 不影响合成、探索、地图、日志等主要内容。
7. 当前开发阶段可以继续使用旧房间入口作为临时外壳。

换言之：

```txt
Room / Lifecycle 独立化 = 外围入口清理
Runtime / Tick / State 独立化 = 核心运行期清理
```

后者已经完成，前者可以晚些做。

---

## 4. 未来目标

如果未来需要让 Oblivions 成为更完整的独立子应用，可以再设计：

```txt
oblivions/api/room.php
oblivions/api/lifecycle.php
oblivions/api/player_activation.php
```

或按领域拆分：

```txt
oblivions/api/rooms/create.php
oblivions/api/rooms/join.php
oblivions/api/players/activate.php
oblivions/api/games/start.php
oblivions/api/games/reset.php
```

但现阶段不急于执行。

---

## 5. 未来阶段草案

### 阶段 1：调查旧生命周期链路

只读梳理：

```txt
index.php
valid.php
game.php
include/room/roommng.func.php
include/gamectl/*.php
oblivions/include/gamectl/*.php
```

输出：

```txt
创建房间 -> 加入房间 -> 激活玩家 -> 初始化地图/NPC/玩家 -> 开局 -> 重开
```

完整链路图。

### 阶段 2：明确旧 `game` 表边界

当前暂定：

```txt
旧 game 表：继续作为房间管理 / 房间编号索引。
bra_s{groomid}_oblgame：继续作为 Oblivions 单局运行状态。
```

未来如有需要，新建：

```txt
obl_roommng
```

接替旧 `game` 表的房间管理职能。

### 阶段 3：独立玩家激活

目标：

```txt
valid.php 继续服务旧模式。
Oblivions 使用自己的玩家激活入口。
```

可能入口：

```txt
oblivions/api/player_activation.php
```

### 阶段 4：独立开局 / 重开流程

目标：

```txt
地图初始化
NPC 初始化
oblplayers 初始化
oblgame 初始化
日志 / 队列 / 战斗状态清理
```

统一由 Oblivions Lifecycle Orchestrator 管理。

### 阶段 5：可选新建 obl_roommng

仅当确实需要彻底摆脱旧 `game` 表时执行。

---

## 6. 暂不执行事项

当前不执行：

- 不重构 `index.php`。
- 不重构 `valid.php`。
- 不删除旧 `game` 表。
- 不新建 `obl_roommng`。
- 不新建 Room API。
- 不改现有开局流程。

---

## 7. 当前建议

短期建议优先继续做更影响实际开发效率和玩法内容的任务，例如：

```txt
前端状态/缓存进一步整理
战斗系统内容扩展
地图/POI/敌人生态扩展
合成与物品系统扩展
日志/调试体验优化
Oblivions 数据模型和文档同步
```

`Room / Lifecycle` 独立化可作为后续“架构完整性清理”任务保留。
