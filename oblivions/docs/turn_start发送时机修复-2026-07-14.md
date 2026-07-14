# turn_start 发送时机修复设计案

> **目标**：把 `turn_start` 事件的发送时机从"前一个 actor 的 `battle_manage_queue` 末尾为下一 actor emit"改为"当前 actor 的 `combat_dispatch` 入口 emit"，保证每个 turn（含第一个 turn）都有 `turn_start` 事件，从而让 K-1 框架"每个 turn 1 个 round_intro 横幅"的设计基准在所有 turn 上生效。
>
> **关联文档**：
> - [Dian.md K-1 框架](../Dian.md#框架-k-1战斗回合编排--演示播放管道)（轮次开场 → 回合演出的阶段切片模型）
> - [回合宣告每turn生成-2026-07-14.md](回合宣告每turn生成-2026-07-14.md)（已实施，本方案修复其遗留的框架基准缺失）

---

## 一、问题

### 1.1 现状

`turn_start` 事件由 `battle_ap_recover` 内部的 `combat_log_v2_turn_start` emit（[battle.func.php:72-74](../../vex-vue/../../oblivions/include/game/battle/battle.func.php#L72-L74)），而 `battle_ap_recover` 只在 `battle_manage_queue` 末尾为"**下一 actor**"调用（[battle.queue.main.php:260-261](../../oblivions/include/game/battle/battle.queue.main.php#L260-L261)）。

`battle_hook_turn_start`（递增 `BattleLogCollector::$turnNum`）也在同一位置为"下一 actor"调用。

结果：**第一个 actor（先攻顺位 1）的第一回合没有 turn_start 事件**——他没有"前一个 battle_manage_queue"为他 emit。

### 1.2 三条 combat_dispatch 路径都受影响

`combat_dispatch` 共 3 个调用点，入口都**不**调用 turn_start hook：

| 调用点 | 文件 | 场景 |
|--------|------|------|
| `combat_dispatch('player_turn', $actor, $remaining_actions)` | [combat.core.php:298](../../oblivions/include/game/combat/combat.core.php#L298) | 玩家发起战斗（`battle.start`）的第一回合 |
| `combat_dispatch('player_turn', $pdata, $payload['actions'])` | [obl_command_handlers.php:51](../../oblivions/include/command/obl_command_handlers.php#L51) | 玩家后续回合（`battle.submit_turn`） |
| `combat_dispatch('npc_turn', $npc_data, $atk_act, ...)` | [enemy_ai.func.php:121](../../oblivions/include/game/enemy_ai.func.php#L121) | NPC 回合（tick 推进） |

每场战斗的第一个 actor（玩家或 NPC）的第一回合都没有 turn_start 事件。

### 1.3 前端表现

按 [回合宣告每turn生成-2026-07-14.md](回合宣告每turn生成-2026-07-14.md) 已实施的 directV2 逻辑：
- `round_start` 事件被忽略
- 第一个 actor 的 `action_start` 通过 pending 在末尾创建 turn 段，**但没有 round_intro 段**（因为没有 turn_start）
- 第二个 actor 的 `turn_start` 才生成第一个 round_intro 横幅

**结果**：玩家发起战斗的第一个回合（玩家自己的回合），**没有任何 round_intro 横幅宣告**——玩家直接看到自己的动作演出和战报，跳过了"第 1 轮 - 你的回合"横幅。设计文档 1.3 节"第一个 turn 的 round_intro 自然承担战斗开始的视觉宣告"的意图在第一个 turn 上失效。

### 1.4 fixture 误打误撞

[battle-director-v2.fixture.ts](../../vex-vue/src/stores/battle-director-v2.fixture.ts) 第一个事件是 `turn_start`（actor=PLAYER, bl_turn_num=1）——模拟"玩家发起战斗后的第一个事件是 turn_start"。但后端实际不 emit。fixture 与真实事件流不符，所以测试用例通过但实际场景缺失横幅。修复后 fixture 反而成为正确的事件流模拟。

---

## 二、研判：框架基准缺失

### 2.1 K-1 框架的设计基准

[Dian.md K-1](../Dian.md#框架-k-1战斗回合编排--演示播放管道)：

> **轮次开场**（round_intro 段，每 `turn_start` 事件 1 个，1 阶段）

设计基准是"每个 `turn_start` 事件生成一个 `round_intro` 段"——隐含假设"每个 turn 都有 turn_start 事件"。

### 2.2 后端实现的视角错误

后端 `battle_hook_turn_start` 的注释（[battle.func.php:134-148](../../oblivions/include/game/battle/battle.func.php#L134-L148)）：

> 在 `battle_manage_queue` 末尾（step 6）调用，"**下一 combatant 的回合已就绪**"。

这是"按 turn 切换"的视角——turn_start 标记的是"下一 actor 已就绪"，而非"当前 actor 回合开始"。

视角错误导致：第一个 actor 没有"前一个 battle_manage_queue"为他 emit turn_start，他的第一回合被遗漏。

### 2.3 研判结论

**框架基准缺失**，不是边界案例：
- "每个 turn 都有 turn_start 事件"是 K-1 框架的设计基准
- 第一个 turn 没有 turn_start 不是罕见情况——每场战斗的第一个 actor 都会触发
- 修复应从框架重构角度：把 turn_start 的发送时机从"按 turn 切换"改为"按 turn 开始"

### 2.4 从目的反推实现

**目的**：每个 turn（含第一个 turn）都有 turn_start 事件。

**反推**：turn_start 应该在"当前 actor 的回合开始时" emit，而不是"前一个 actor 的 battle_manage_queue 末尾为下一 actor emit"。

**实现**：把 `battle_hook_turn_start` + `battle_ap_recover` 的调用从 `battle_manage_queue` 末尾移到 `combat_dispatch` 入口。`combat_dispatch` 是所有 turn 的统一入口（3 个调用点），在这里 emit turn_start 保证所有 turn 都覆盖。

---

## 三、设计

### 3.1 核心改动：turn_start hook 移位

**`combat_dispatch` 入口**添加 turn_start hook 调用（在 `combat_main` 之前）：

```php
// ── Turn start hook：当前 actor 回合开始 ──
// 递增 turnNum + 恢复 AP + emit turn_start 事件
// 放在 combat_main 之前，保证当前 actor 的所有事件（含 turn_start 自身）都有正确的 bl_turn_num
battle_hook_turn_start($actor, $obl_battle_log, $battle_cache);
battle_ap_recover($actor, $battle_cache, $obl_battle_log);
obl_save_player($actor);
```

**`battle_manage_queue` 末尾**删除 turn_start hook 调用（step 6）：

```php
// ── 6. 状态转换已就绪：下一 actor 的 turn_start hook 由其自身的 combat_dispatch 入口触发 ──
// （不再在此处递增 turnNum / 恢复 AP / emit turn_start，避免第一个 actor 漏发 turn_start）
```

保留 step 5 的 `obl_battle_state_set_next_pid` + 状态转换（这些是 next 的状态机推进，与 turn_start 无关）。

### 3.2 AP 恢复语义变化

**当前**：`battle_ap_recover` 在 `battle_manage_queue` 末尾为"下一 actor"调用——下一 actor 在自己的回合开始前 AP 已恢复。

**新设计**：`battle_ap_recover` 在 `combat_dispatch` 入口为"当前 actor"调用——当前 actor 在自己的回合开始时 AP 恢复。

**效果差异**：
- 后续 actor：AP 恢复时机从"回合开始前"改为"回合开始时"——actor 开始回合时 AP 已恢复，效果相同
- 第一个 actor：当前实现不恢复 AP（但他本来就是满 AP 进入战斗）；新设计也恢复 AP（ap_recovered=0，emit 时 ap_recovered=0，合理）
- ambush 场景（未来）：NPC 第一回合也恢复 AP——合理，符合"每个 turn 开始时恢复 AP"的语义

### 3.3 turnNum 计数变化

**当前**：
- `battle_queue_create_and_init` 时 turnNum=0
- 第一个 actor 的所有事件 bl_turn_num=null（turnNum=0 时 emit 返回 null）
- `battle_manage_queue` 末尾递增 turnNum=1
- 第二个 actor 的 turn_start bl_turn_num=1

**新设计**：
- `battle_queue_create_and_init` 时 turnNum=0
- `combat_dispatch` 入口递增 turnNum=1
- 第一个 actor 的 turn_start bl_turn_num=1
- 第一个 actor 的所有事件 bl_turn_num=1
- `battle_manage_queue` 末尾不递增
- 第二个 actor `combat_dispatch` 入口递增 turnNum=2
- 第二个 actor 的 turn_start bl_turn_num=2

每个 turn 都有正确的、唯一的 bl_turn_num。

### 3.4 NPC turn_start 不再提前预告

**当前**：玩家提交 `battle.start` → 后端在同一请求中 emit 玩家动作 + **NPC turn_start**（在 `battle_manage_queue` 末尾）→ 前端收到后提前播放 NPC round_intro 横幅，然后等待 NPC 动作（下一个 tick 才来）。

**新设计**：玩家提交 `battle.start` → 后端只 emit 玩家 turn_start + 玩家动作 → 前端播放玩家回合 → 等下一个 tick → 收到 NPC turn_start + NPC 动作 → 前端播放 NPC round_intro 横幅紧贴 NPC 回合开始。

新设计更自然——NPC 的 round_intro 横幅紧贴 NPC 回合开始，而不是提前预告。200ms tick 间隔玩家几乎无感。

### 3.5 前端无需改动

- `directV2` 已经按 `turn_start` 事件生成 round_intro 段——新设计后第一个 turn 也有 turn_start，自然生成 round_intro
- `getTurnSegment` 使用 roundNum + turnNum 查找 turn 段——新设计后每个 turn 都有正确的 bl_turn_num，查找逻辑不变
- `fixture` 已经模拟正确的 turn_start 事件流——新设计后 fixture 与实际事件流一致，无需修改

### 3.6 round_start 事件保留

`round_start` 事件继续由 `battle_queue_create_and_init` / `battle_queue_set_initiative` emit，前端 directV2 继续忽略。`round_start` 的 `bl_turn_num` 在新设计下：
- `battle_queue_create_and_init` 时 turnNum=0 → round_start 的 bl_turn_num=null（首轮开始时还未进入任何 turn）
- rebuild 路径：`battle_queue_rebuild` 在 `battle_manage_queue` 内部触发，turnNum 已经是当前值 → round_start 的 bl_turn_num=N

前端忽略 round_start，不影响。

### 3.7 第一个 round_intro 显示"战斗开始"

修复后第一个 turn（`roundNum === 1 && turnNum === 1`）的 `round_intro` 段承担战斗开始的视觉宣告。为了让玩家从视觉上明确"战斗刚开始"，第一个 round_intro 的标题显示"战斗开始"而非"第 1 轮"，副标题"xx 的回合"保持不变。后续 round_intro 继续显示"第 N 轮"。

**实现**：
- `BattleSegmentV2` 新增可选字段 `isBattleStart?: boolean`
- `directV2` 生成 `round_intro` 段时判断 `roundNum === 1 && turnNum === 1`，标记 `isBattleStart: true`
- `BattleBanner.vue` 模板根据 `currentSeg.isBattleStart` 切换标题：`true` 显示"战斗开始"，`false` 显示"第 N 轮"

**为什么用 `roundNum === 1 && turnNum === 1` 判断而非后端标记**：
- 修复后第一个 turn_start 事件的 `bl_round_num=0`（→ roundNum=1）、`bl_turn_num=1`（→ turnNum=1）是确定的
- 前端 directV2 是无状态纯函数，根据事件本身的 `bl_round_num` / `bl_turn_num` 判断即可，不需要后端额外标记
- 把"战斗开始"的语义判断集中在 directV2（数据层），BattleBanner 模板只消费标记，避免把 roundNum/turnNum 的组合判断散落到视图层

---

## 四、落地步骤

### 4.1 `oblivions/include/game/combat/combat.core.php`

`combat_dispatch` 入口在 step 3（roundNum 同步）之后、step 4（`combat_main`）之前插入新的 step 3.5：

```php
// ── 3.5. Turn start hook：当前 actor 回合开始 ──
// 递增 turnNum + 恢复 AP + emit turn_start 事件
// 放在 step 3（roundNum 同步）之后、step 4（combat_main）之前，
// 保证当前 actor 的所有事件（含 turn_start 自身）都有正确的 bl_round_num 和 bl_turn_num
// 设计案：oblivions/docs/turn_start发送时机修复-2026-07-14.md
battle_hook_turn_start($actor, $obl_battle_log, $battle_cache);
battle_ap_recover($actor, $battle_cache, $obl_battle_log);
obl_save_player($actor);
```

**位置说明**：
- step 2 已构建 `$battle_cache`，step 3 已同步 `$obl_battle_log->roundNum`，step 3.5 可直接使用
- `combat_ensure_battle_log()`（step 0 入口处）保证 `$obl_battle_log` 非 null，无需 null 检查
- `obl_save_player` 保证 AP 恢复状态持久化（即使 `combat_main` verify 失败，AP 恢复仍然生效）

### 4.2 `oblivions/include/game/battle/battle.queue.main.php`

`battle_manage_queue` step 6 完全删除（包括 `$obl_battle_log->setPhase('prepare')`、`battle_hook_turn_start`、`battle_ap_recover`、`obl_save_player`）：

```php
// ── 6. 状态转换已就绪 ──
// 下一 actor 的 turn_start hook 由其自身的 combat_dispatch 入口触发
// （不在此处递增 turnNum / 恢复 AP / emit turn_start，避免第一个 actor 漏发 turn_start）
// 设计案：oblivions/docs/turn_start发送时机修复-2026-07-14.md
```

保留 step 5 的 `obl_battle_state_set_next_pid` + 状态转换（`obl_battle_state_transition` / `obl_battle_state_refresh`）——这些是 next 的状态机推进，与 turn_start 无关。

### 4.3 `oblivions/include/game/battle/battle.func.php`

更新 `battle_hook_turn_start` 和 `battle_ap_recover` 的注释：

- `battle_hook_turn_start`：从"在 `battle_manage_queue` 末尾调用，下一 combatant 的回合已就绪"改为"在 `combat_dispatch` 入口调用，当前 combatant 的回合开始"
- `battle_ap_recover`：从"每轮开始时，先攻者恢复 AP"改为"每个 turn 开始时，当前 actor 恢复 AP"

### 4.4 回归测试

- **玩家发起战斗**：`battle.start` → `combat_dispatch('player_turn')` 入口 emit turn_start（玩家，turnNum=1）→ 玩家第一回合有 round_intro 横幅"第 1 轮 - 你的回合"
- **NPC 回合**：tick → `combat_dispatch('npc_turn')` 入口 emit turn_start（NPC，turnNum=2）→ NPC 回合有 round_intro 横幅"第 1 轮 - XX 的回合"
- **玩家后续回合**：`battle.submit_turn` → `combat_dispatch('player_turn')` 入口 emit turn_start（玩家，turnNum=N）
- **连续多轮**：所有 done → rebuild → emit round_start（新 round）→ 下一 actor `combat_dispatch` 入口 emit turn_start
- **battle_end 路径**：`battle_manage_queue` step 2 检测解散 → emit battle_end → return（无 turn_start，正确）
- **queue_empty 路径**：`battle_manage_queue` step 0 检测 queue_rows 为空 → emit battle_end → return（无 turn_start，正确）
- **AP 恢复**：每个 actor 的回合开始时 AP 恢复到 max（第一个 actor ap_recovered=0，后续 actor ap_recovered=消耗量）
- **turnNum 计数**：每个 turn 都有唯一的 bl_turn_num（1, 2, 3, ...），不再有 null
- **fixture 测试通过**：fixture 第一个事件是 turn_start，与实际事件流一致

---

## 五、边界情况

### 5.1 pre-battle 阶段（玩家发起战斗的准备动作）

**触发场景**：`combat_start_battle` 中 230-271 行的 pre-battle 阶段，玩家执行非敌对动作（装填、移动到攻击位置）。

**处理**：pre-battle 阶段在 `battle_queue_create_and_init` 之前，`$obl_battle_log->roundNum=null`，`turnNum=0`。这些动作的事件 bl_round_num=null, bl_turn_num=null，前端 directV2 归到 roundNum=undefined, turnNum=undefined 的 turn 段，没有 round_intro 横幅——这是合理的，pre-battle 不是正式回合。

新设计不影响 pre-battle 阶段（`combat_main` 直接调用，不经过 `combat_dispatch`）。

### 5.2 rebuild 路径

**触发场景**：所有 active=1 都 done=1 时，`battle_manage_queue` step 3 触发 `battle_queue_rebuild` → emit round_start（新 round）。

**处理**：
- rebuild 在当前 actor 的 `combat_dispatch` 末尾 `battle_manage_queue` 中触发
- 当前 actor 的 turn_start 已经在 `combat_dispatch` 入口 emit（turnNum=N）
- rebuild 的 round_start 在同一请求中 emit（bl_turn_num=N）
- 下一 actor 通过下一个 tick 的 `combat_dispatch` 入口 emit turn_start（turnNum=N+1）

前端收到的 event 序列：
1. turn_start（当前 actor, round=旧, turn=N）
2. action_start / ... （当前 actor, round=旧, turn=N）
3. round_start（新 round, turn=N）—— 前端忽略
4. [下一个 tick]
5. turn_start（next actor, round=新, turn=N+1）

正确。

### 5.3 combat_main 失败

**触发场景**：`combat_main` 的 verify 阶段失败，actor 没有执行任何动作。

**处理**：`combat_dispatch` 入口已经 emit turn_start（turnNum=N）+ 恢复 AP + 保存 actor。即使 `combat_main` 失败，turn_start 事件已经 emit，前端会生成 round_intro 横幅 + 空 turn 段。这正确——actor 的回合开始了，只是没有动作。

### 5.4 actor 死亡

**触发场景**：`combat_main` 执行过程中 actor 死亡（HP=0）。

**处理**：`combat_dispatch` 入口已经 emit turn_start。actor 死亡后 `battle_manage_queue` 检测解散 → emit battle_end。前端收到 turn_start + action_start（含死亡效果）+ battle_end，正确播放回合 + 战斗结束。

### 5.5 ambush 场景（未来）

**触发场景**：NPC 突袭玩家，NPC 是先攻顺位 1。

**处理**：NPC 通过 `combat_dispatch('npc_turn')` 入口 emit turn_start（NPC, turnNum=1）。新设计自然支持 ambush 场景，不需要额外改动。

---

## 六、不变量清单

### 6.1 后端事件流
- `turn_start` 事件由 `combat_dispatch` 入口 emit（不再由 `battle_manage_queue` 末尾 emit）
- `battle_hook_turn_start` 在 `combat_dispatch` 入口调用（递增 turnNum）
- `battle_ap_recover` 在 `combat_dispatch` 入口调用（恢复 AP + emit turn_start）
- `battle_manage_queue` 末尾不再调用 `battle_hook_turn_start` / `battle_ap_recover`
- `battle_manage_queue` step 5 的状态转换（`obl_battle_state_set_next_pid` + 状态机推进）不变

### 6.2 段类型与播放流程
- `BattleSegmentKindV2` 不变（`'round_intro' | 'turn' | 'battle_end' | 'system'`）
- `directV2` 对 `turn_start` 事件的处理不变（生成 round_intro + turn 段）
- `directV2` 对 `round_start` 事件的处理不变（忽略）
- `planPlaybackV2` / `battle.ts` / `BattleBanner.vue` / `BattleModal.vue` 不变

### 6.3 turnNum 计数
- `BattleLogCollector::$turnNum` 初始化为 0
- `battle_hook_turn_start` 递增 turnNum（每次 `combat_dispatch` 入口调用一次）
- 每个 turn 的所有事件（含 turn_start 自身）都有相同的 bl_turn_num
- turn_start 的 bl_turn_num 不再为 null（除 round_start 在首轮时仍为 null，前端忽略）

### 6.4 AP 恢复
- 每个 actor 的回合开始时（`combat_dispatch` 入口）恢复 AP 到 max
- 第一个 actor 也恢复 AP（ap_recovered=0 如果本来满 AP）
- `battle_ap_recover` 内部 emit turn_start 事件的 ap_recovered 字段反映实际恢复量

### 6.5 战斗开始视觉宣告
- 第一个 turn（`roundNum === 1 && turnNum === 1`）的 round_intro 横幅承担战斗开始的视觉宣告
- 玩家发起战斗的第一个 round_intro 标题显示"战斗开始"，副标题"你的回合"
- NPC ambush（未来）的第一个 round_intro 标题显示"战斗开始"，副标题"XX 的回合"
- 后续 round_intro 继续显示"第 N 轮" + 副标题
- `BattleSegmentV2.isBattleStart` 字段由 directV2 根据 `roundNum === 1 && turnNum === 1` 判断标记，BattleBanner 模板只消费该标记，不重复 roundNum/turnNum 组合判断
