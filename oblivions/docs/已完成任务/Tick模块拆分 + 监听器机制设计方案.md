# Oblivions Tick 模块拆分 + 监听器机制设计方案

## 一、设计目标

1. **职责分离**：tick 时间驱动层从 player.func.php 抽离为独立模块
2. **开放-封闭**：新增依赖 tick 的功能时无需修改 tick 模块（监听器注册即可）
3. **生命周期清晰**：tick 的"推进策略"与"事件调度"分离，标记管理封装
4. **最小侵入**：保持外部调用入口（common.inc.php / obl_command.php）的改动最小
5. **可测试性**：tick 模块可独立加载、独立调度监听器进行验证

## 二、新模块文件结构

```
oblivions/include/game/
  tick.func.php              # 新增：tick 核心模块（调度/标记/推进/监听器注册）
  enemy_ai.func.php          # 改造：obl_resolve_all_enemy_ai 拆分为监听器
  player.func.php            # 瘦身：移除 obl_resolve_tick_events / obl_command_advances_tick
  battle/battle.main.php     # 不变
```

单文件方案，与项目现有 `.func.php` 风格一致。模块内分四节：标记管理 / 推进控制 / 监听器注册 / 事件调度。

## 三、监听器机制设计

### 3.1 阶段（Phase）划分

将原"两阶段处理"显式化为三个 phase，第三个 phase 为未来扩展预留：

| Phase | 语义 | 执行顺序 | 并发性 | 推进 tick？ |
|-------|------|---------|--------|------------|
| `battle_npc` | 战斗中 NPC 先攻轮 | 串行 | 最多 1 个监听器执行 | 是（若执行了先攻轮） |
| `idle_npc` | 非战斗 NPC AI 行为 | 并行 | 所有监听器都执行 | 否 |
| `post` | tick 后处理（技能 CD、buff 等） | 串行 | 所有监听器都执行 | 否 |

### 3.2 监听器注册表

全局注册表，按 phase 分组：

```php
$GLOBALS['obl_tick_listeners'] = array(
    'battle_npc' => array(),  // callable 列表
    'idle_npc'   => array(),
    'post'       => array(),
);
```

### 3.3 监听器签名约定

```php
/**
 * @param int   $delta   待处理的 tick 差值（obl_tick - obl_pretick 同步前的值）
 * @param array &$ctx    调度上下文（引用传递），结构：
 *                       [
 *                         'player'      => &$pdata,       // 当前玩家数据
 *                         'advanced'    => bool,          // 是否请求推进 tick（battle_npc phase 有效）
 *                         'ginfochange' => &bool,         // 是否需要 save_gameinfo
 *                       ]
 * @return void
 */
function listener_callback(int $delta, array &$ctx): void
```

**关键约定**：
- `battle_npc` phase 的监听器执行了 NPC 先攻轮后，调用 `obl_tick_request_advance()` 设置标记
- `idle_npc` / `post` phase 的监听器不推进 tick（并行语义）
- 监听器不直接访问 `$cuser`，从 `$ctx['player']` 获取玩家数据

### 3.4 注册 API

```php
function obl_tick_register_listener(string $phase, callable $cb): void
function obl_tick_get_listeners(string $phase): array
```

注册时机：在 `tick.func.php` 末尾或独立的 `tick.listeners.php` 中注册内置监听器。第三方功能（如技能系统）可在其文件加载时注册 `post` phase 监听器。

## 四、Tick 核心模块 API（tick.func.php）

### 4.1 标记管理（封装 `$obl_tick_advanced`）

```php
function obl_tick_request_advance(): void      // 设置"请求推进"标记（静态变量）
function obl_tick_consume_advance(): bool      // 读取并清除标记
function obl_tick_reset_advance(): void        // 重置标记（调度开始时调用）
```

**收益**：废弃引用传递，监听器通过函数调用请求推进，调度器统一消费。

### 4.2 推进控制

```php
function obl_tick_advance(): void              // obl_tick++ + 标记 ginfochange（不调 save_gameinfo）
function obl_tick_synchronize(): void          // obl_pretick = obl_tick
function obl_tick_get(): int                   // 读取 obl_tick
function obl_tick_get_pretick(): int           // 读取 obl_pretick
```

**关键**：`obl_tick_advance()` 只修改内存中的 `$gamevars` 并设置 `$ginfochange = true`，持久化统一由 `common.inc.php` 末尾的 `save_gameinfo()` 完成。**消除重复调用**。

### 4.3 命令推进判定（从 player.func.php 迁移）

```php
function obl_command_advances_tick(string $command): bool  // 白名单机制，原样迁移
```

### 4.4 事件调度（核心）

```php
function obl_tick_dispatch(int $delta, array &$ctx): void
{
    obl_tick_reset_advance();

    // 阶段 1：战斗 NPC 先攻轮（串行，最多 1 个监听器请求推进）
    foreach (obl_tick_get_listeners('battle_npc') as $cb) {
        $cb($delta, $ctx);
        if (obl_tick_consume_advance()) {
            $ctx['advanced'] = true;
            break;  // 最多处理 1 个 NPC 先攻轮
        }
    }

    // 阶段 2：非战斗 NPC AI（并行，所有监听器都执行）
    foreach (obl_tick_get_listeners('idle_npc') as $cb) {
        $cb($delta, $ctx);
    }

    // 阶段 3：后处理（技能 CD 等）
    foreach (obl_tick_get_listeners('post') as $cb) {
        $cb($delta, $ctx);
    }

    // 末尾：统一推进
    if (!empty($ctx['advanced'])) {
        obl_tick_advance();
    }
}
```

### 4.5 入口封装（替代原 `obl_resolve_tick_events`）

```php
function obl_resolve_tick_events(int $delta): void
{
    global $cuser;

    // 抓取当前玩家数据（MVP 策略：只结算当前玩家区域）
    $player = obl_fetch_playerdata_by_name($cuser);
    if (!$player) return;

    $ctx = array(
        'player'      => &$player,
        'advanced'    => false,
        'ginfochange' => false,
    );

    obl_tick_dispatch($delta, $ctx);

    // 若监听器标记了 ginfochange，由调用方（common.inc.php）统一持久化
    if (!empty($ctx['ginfochange'])) {
        global $ginfochange;
        $ginfochange = true;
    }
}
```

**保留原函数名**，common.inc.php 调用点无需改动，降低迁移风险。

## 五、Tick 生命周期重定义

### 5.1 新流程图

```
═══════════════════════════════════════════════════════════
请求入口：common.inc.php
═══════════════════════════════════════════════════════════

load_gameinfo()
→ 检测 obl_pretick < obl_tick ?
  │
  ├─ 否 → 跳过 tick 处理
  │
  └─ 是 → $delta = obl_tick - obl_pretick
          → obl_tick_synchronize()              // obl_pretick = obl_tick
          → obl_resolve_tick_events($delta)
              │
              ├─ 抓取 $player（从 $cuser，MVP 策略）
              ├─ obl_tick_dispatch($delta, $ctx)
              │   │
              │   ├─ reset_advance()
              │   │
              │   ├─ Phase battle_npc（串行）
              │   │   └─ obl_tick_phase_battle_npc($delta, $ctx)
              │   │       ├─ 查询所有活跃先攻队列
              │   │       ├─ 当前顺位者是 NPC → 执行先攻轮
              │   │       └─ obl_tick_request_advance() + break
              │   │
              │   ├─ Phase idle_npc（并行）
              │   │   └─ obl_tick_phase_idle_npc($delta, $ctx)
              │   │       ├─ 查询当前区域敌人
              │   │       └─ foreach 敌人: obl_enemy_tick()
              │   │
              │   ├─ Phase post（预留）
              │   │   └─ （技能 CD / buff 等未来注册）
              │   │
              │   └─ if (ctx['advanced']): obl_tick_advance()  // obl_tick++（不持久化）
              │
              └─ if (ctx['ginfochange']): $ginfochange = true
  │
  → 末尾：if ($ginfochange) save_gameinfo()    // 统一持久化

═══════════════════════════════════════════════════════════
命令处理：obl_command.php
═══════════════════════════════════════════════════════════

[A] 认证 + 抓取 $pdata
[A2] 并发锁
[C2] 命令状态过滤
[D] 路由分发（执行命令逻辑）
[E] 日志持久化
[G] obl_save_player($pdata)                    // ★ 顺序调整：先保存玩家
[F] if (obl_command_advances_tick($command) && !escape_skip_tick):
      → obl_tick_advance()                      // ★ 后推进 tick（只改内存 + 标记 ginfochange）
      → save_gameinfo()                         // ★ 持久化（命令路径无 common 末尾兜底）
[H] 响应
```

### 5.2 关键变更点

| 变更 | 原方案 | 新方案 | 理由 |
|------|--------|--------|------|
| [F]/[G] 顺序 | 先 tick 后保存玩家 | **先保存玩家后 tick** | 避免 tick 已推进但玩家动作未持久化的不一致 |
| `save_gameinfo` 调用 | tick_events 内部 + common 末尾各一次 | **仅 common 末尾一次**（命令路径除外） | 消除重复 IO |
| 标记传递 | `&$obl_tick_advanced` 引用 | **`obl_tick_request_advance()` 函数封装** | 封装内部状态，调用方不可见 |
| NPC AI 玩家数据 | 监听器内 `obl_fetch_playerdata_by_name($cuser)` | **调度器抓取，通过 `$ctx['player']` 传递** | 监听器解耦 `$cuser`，便于未来扩展 |

## 六、现有函数拆分映射

### 6.1 `obl_resolve_all_enemy_ai` 拆分

原函数（[enemy_ai.func.php:236-313](file:///d:/wamp64/www/phpdts/oblivions/include/game/enemy_ai.func.php#L236-L313)）拆为两个监听器 + 一个调度壳：

```php
// 监听器 1：战斗 NPC 先攻轮（原阶段 1）
function obl_tick_phase_battle_npc(int $delta, array &$ctx): void
{
    // 原阶段 1 逻辑：查询 oblqueue，找 NPC 当前顺位者，执行 battle_main
    // 执行后调用 obl_tick_request_advance()
    // 不再处理 $obl_battle_log 初始化（由调度器或入口负责）
}

// 监听器 2：非战斗 NPC AI（原阶段 2）
function obl_tick_phase_idle_npc(int $delta, array &$ctx): void
{
    $player = &$ctx['player'];
    $enemies = obl_fetch_enemies_by_region($player['pgroup']);
    foreach ($enemies as &$enemy) {
        if ($enemy['bid']) continue;       // 战斗中跳过
        obl_enemy_tick($enemy, $player);
        obl_save_player($enemy);
    }
    // 删除 ambush_flag / collision_flag 检测（死代码清理）
}

// 注册（在 tick.func.php 末尾或 enemy_ai.func.php 末尾）
obl_tick_register_listener('battle_npc', 'obl_tick_phase_battle_npc');
obl_tick_register_listener('idle_npc',   'obl_tick_phase_idle_npc');
```

### 6.2 `obl_resolve_all_enemy_ai` 去留

**保留函数壳**作为向后兼容，内部委托给监听器调度：

```php
function obl_resolve_all_enemy_ai(): bool
{
    $ctx = array('player' => null, 'advanced' => false, 'ginfochange' => false);
    // 抓取玩家 + 调用 dispatch
    // 返回 $ctx['advanced']
}
```

实际上推荐**直接删除**，调用方（`obl_resolve_tick_events`）改为调用 `obl_tick_dispatch`。

### 6.3 player.func.php 瘦身

迁移到 `tick.func.php` 的函数：
- `obl_command_advances_tick()` → 迁移
- `obl_resolve_tick_events()` → 迁移（重写为调度入口）

player.func.php 保留：认证/抓取/格式化/保存/道具栏/战斗状态校验。

## 七、死代码清理清单

| 代码 | 位置 | 处理 | 理由 |
|------|------|------|------|
| `collision_flag` 设置 | [enemy_ai.func.php:485](file:///d:/wamp64/www/phpdts/oblivions/include/game/enemy_ai.func.php#L485) 已注释 | **删除注释行** | 从未启用 |
| `collision_flag` 检测 | [enemy_ai.func.php:304-309](file:///d:/wamp64/www/phpdts/oblivions/include/game/enemy_ai.func.php#L304-L309) | **删除** | 设置点已注释，检测空转 |
| `ambush_flag` 检测推进 | [enemy_ai.func.php:298-303](file:///d:/wamp64/www/phpdts/oblivions/include/game/enemy_ai.func.php#L298-L303) | **删除**（推进被注释，只 unset） | 半成品 |
| `obl_enemy_ambush_player` 调用 | [enemy_ai.func.php:350-356](file:///d:/wamp64/www/phpdts/oblivions/include/game/enemy_ai.func.php#L350-L356) 已注释 | **删除注释块** | 突袭未启用 |
| `obl_enemy_ambush_player` 函数 | [enemy_ai.func.php:436-457](file:///d:/wamp64/www/phpdts/oblivions/include/game/enemy_ai.func.php#L436-L457) | **保留** | 函数完整，未来突袭机制可复用 |
| `obl_resolve_collision_battle` 函数 | [enemy_ai.func.php:583-629](file:///d:/wamp64/www/phpdts/oblivions/include/game/enemy_ai.func.php#L583-L629) | **保留** | 碰撞战斗逻辑完整，未来可启用 |
| `obl_enemy_move` 中碰撞处理 | [enemy_ai.func.php:483-488](file:///d:/wamp64/www/phpdts/oblivions/include/game/enemy_ai.func.php#L483-L488) | **保留**（return false 逻辑） | 当前"碰撞不移动"语义正确，未来可改触发战斗 |
| `$delta` 参数 | `obl_resolve_tick_events($delta)` | **保留并使用** | 传递给监听器，供其决定是否批量处理 |

## 八、迁移步骤（分 7 步，可独立验证）

### Step 1：创建 tick.func.php 骨架
- 实现 4 节：标记管理 / 推进控制 / 监听器注册 / 事件调度
- 实现 `obl_command_advances_tick()`（从 player.func.php 复制）
- 实现 `obl_resolve_tick_events()`（新调度入口，暂不注册监听器，空跑）
- **验证**：加载文件无错误，函数存在

### Step 2：注册内置监听器（占位）
- 在 tick.func.php 末尾注册两个空监听器
- **验证**：`obl_tick_get_listeners('battle_npc')` 返回非空

### Step 3：改造 common.inc.php 调用点
- 将 `obl_resolve_tick_events` 的 include 路径从 player.func.php 改为 tick.func.php
- 调整同步逻辑：`obl_tick_synchronize()` 替代直接赋值
- **验证**：请求进入，tick 处理流程跑通（监听器空跑，无副作用）

### Step 4：实现 `obl_tick_phase_idle_npc` 监听器
- 从 `obl_resolve_all_enemy_ai` 阶段 2 抽取逻辑
- 删除 `ambush_flag` / `collision_flag` 检测
- 玩家数据从 `$ctx['player']` 获取
- **验证**：非战斗 NPC AI 行为正常（移动/巡逻）

### Step 5：实现 `obl_tick_phase_battle_npc` 监听器
- 从 `obl_resolve_all_enemy_ai` 阶段 1 抽取逻辑
- 执行 NPC 先攻轮后调用 `obl_tick_request_advance()`
- **验证**：战斗中 NPC 先攻轮推进 tick，前端自动刷新循环正常

### Step 6：改造 obl_command.php [F] 段
- 顺序调整：[G] 保存玩家 → [F] 推进 tick
- `obl_tick_advance()` 替代直接 `$gamevars['obl_tick']++`
- 命令路径保留 `save_gameinfo()`（无 common 末尾兜底）
- **验证**：玩家命令推进 tick 正常，状态一致

### Step 7：清理与瘦身
- 删除 player.func.php 中的 `obl_resolve_tick_events` / `obl_command_advances_tick`
- 删除 enemy_ai.func.php 中的 `obl_resolve_all_enemy_ai`（或保留壳委托）
- 清理死代码（第七节清单）
- 更新 CODEBASE.md 文档
- **验证**：全流程回归测试

## 九、风险与权衡

| 风险 | 影响 | 缓解 |
|------|------|------|
| 监听器执行顺序依赖 | 同 phase 多监听器顺序未定义 | 文档约定同 phase 监听器不应有顺序依赖；当前每 phase 仅 1 个监听器 |
| `$ctx` 引用传递复杂 | 监听器可能误改 context | 约定监听器只读 `$ctx['player']`，只写 `$ctx['advanced']` / `$ctx['ginfochange']` |
| 顺序调整（[G]→[F]） | 若 `obl_save_player` 失败，tick 不推进 | 原方案也有类似风险（tick 推进了但保存失败）；新方案至少保证"玩家状态已持久化才推进时间" |
| common.inc.php 末尾 save_gameinfo 依赖 `$ginfochange` | 若 tick_events 设置了 ginfochange 但 common 未检测 | 代码已确认 common.inc.php:339 `if($ginfochange \|\| $lostfocus) save_gameinfo()`，可靠 |
| 监听器未捕获异常 | tick 处理中断 | 监听器内部 try-catch（未来增强）；当前 MVP 不处理 |

## 十、待确认决策点

1. **`obl_resolve_all_enemy_ai` 去留**：直接删除（推荐，调用方只有 `obl_resolve_tick_events`）还是保留壳委托？
2. **监听器注册位置**：在 `tick.func.php` 末尾集中注册（推荐，便于总览）还是各业务文件自行注册（更解耦但分散）？
3. **`$ctx['player']` 抓取策略**：MVP 只抓 `$cuser` 对应玩家（推荐，与现状一致）还是抓取所有活跃玩家（忠于设计案但性能开销大）？
4. **`obl_validate_battle_state` 处理**：本次一并恢复实现、彻底删除、还是保持现状留待后续？建议本次只做 tick 拆分，战斗状态校验另开任务。

---
