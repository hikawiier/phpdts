# Oblivions Event Log Registry（阶段一清单）

> 状态：阶段一产物。  
> 来源设计案：`D:\wamp64\www\phpdts\oblivions\docs\OBL_EVENT_LOG_DESIGN.md`。  
> 生成日期：2026-07-09。  
> 范围：只盘点与分类，不修改运行行为。

---

## 1. 扫描范围

本清单根据以下位置交叉盘点：

```txt
D:\wamp64\www\phpdts\oblivions\include\**\*.php
D:\wamp64\www\phpdts\oblivions\api\*.php
D:\wamp64\www\phpdts\vex-vue\src\data\log-templates.ts
D:\wamp64\www\phpdts\vex-vue\src\stores\log.ts
D:\wamp64\www\phpdts\vex-vue\src\stores\error-log.ts
D:\wamp64\www\phpdts\vex-vue\src\stores\battle-director.ts
```

扫描对象：

```txt
$obl_log->emit(...)
$obl_error_log->emit(...)
$obl_battle_log->setPhase(...)
$obl_battle_log->emit(...)
前端 LogPanel 模板
前端 TOAST_RULES
前端 ErrorLog renderer
前端 BattleDirector phase case
```

---

## 2. 分类说明

| 分类 | 含义 | 后续方向 |
|---|---|---|
| `player_event` | 玩家可见历史事件 | 保留在 `obl_log`，LogPanel 展示 |
| `passive_event` | 非玩家直接点击产生、但玩家可见的世界事件 | 可保留 `obl_log`；是否 Toast 另行决定 |
| `command_feedback` | 命令即时成功/失败/拒绝反馈 | 应由 Command API response 直接表达；后端返回 code/feedback.id/params，前端渲染文案；日志可选保留 |
| `diagnostic` | 异常、非法状态、配置缺失、调试诊断 | 应进入/保留 `obl_error_log`，普通 UI 不默认依赖 |
| `debug_noise` | 高频或内部调试噪声 | 默认不 Toast；可 debug 面板显示 |
| `director` | 战斗导演事件流 | 保持 `battle_log`，本轮 out-of-scope |
| `frontend_only` | 前端模板/预览/遗留事件，未发现后端 emit | 后续清理或明确其前端来源 |

---

## 3. `obl_log` 后端事件清单

> 当前 `OblivionsLogger::DEBUG_IDS` 包含 `enemy.move`、`battle.invalid`。其中 `battle.invalid` 当前未发现后端 `obl_log` emit。

| 事件 ID | 类别 | 当前来源 | 前端模板 | 当前 Toast | 阶段一分类 | 迁移建议 |
|---|---|---|---|---|---|---|
| `move.same_pos` | move | `oblivions/include/game/move.func.php` | 是 | 否 | `command_feedback` | Command API 应直接返回 no-op/同位置提示；日志可保留 |
| `move.invalid_target` | move | `oblivions/include/game/move.func.php` | 是 | 否 | `command_feedback` | Command API 返回非法目标 |
| `move.blocked` | move | `oblivions/include/game/move.func.php` | 是 | 否 | `command_feedback` | Command API 返回地块阻挡 |
| `move.occupied` | move | `oblivions/include/game/move.func.php` | 是 | 否 | `command_feedback` | Command API 返回目标位置已被占据；阶段二新增，替代原静默失败 |
| `move.unreachable` | move | `oblivions/include/game/move.func.php` | 是 | 否 | `command_feedback` | Command API 返回不可达 |
| `move.no_path` | move | `oblivions/include/game/move.func.php` | 是 | 否 | `command_feedback` | Command API 返回无路径 |
| `move.no_sp_far` | move | `oblivions/include/game/move.func.php` | 是 | 否 | `command_feedback` | Command API 返回体力不足 |
| `move.no_sp` | move | `oblivions/include/game/move.func.php` | 是 | 否 | `command_feedback` | Command API 返回体力不足 |
| `move.success` | move | `oblivions/include/game/move.func.php` | 是 | 否 | `player_event` | 保留历史日志；即时成功可由 command response 表达 |
| `move.tile_desc` | move | `oblivions/include/game/move.func.php` | 是 | 否 | `player_event` | 保留历史日志 |
| `move.region_leave` | move | `oblivions/include/game/move.func.php` | 是 | 否 | `player_event` | 保留历史日志 |
| `move.region_enter` | move | `oblivions/include/game/move.func.php` | 是 | 否 | `player_event` | 保留历史日志 |
| `move.region_end` | move | `oblivions/include/game/move.func.php` | 是 | 否 | `player_event` | 保留历史日志 |
| `explore.no_sp` | explore | `oblivions/include/game/explore.func.php` | 是 | 否 | `command_feedback` | Command API 返回体力不足 |
| `explore.success` | explore | `oblivions/include/game/explore.func.php` | 是 | 否 | `player_event` | 保留历史日志 |
| `search.not_found` | search | `oblivions/include/game/explore.func.php` | 是 | 否 | `command_feedback` | Command API 返回 POI 不存在/已消失 |
| `search.not_adjacent` | search | `oblivions/include/game/explore.func.php` | 是 | 否 | `command_feedback` | Command API 返回不在当前位置 |
| `search.not_searchable` | search | `oblivions/include/game/explore.func.php` | 是 | 否 | `command_feedback` | Command API 返回不可搜索 |
| `search.already_searched` | search | `oblivions/include/game/explore.func.php` | 是 | 否（阶段三移除；原 error） | `command_feedback` | Command API 返回已搜索；避免后续重复 Toast |
| `search.mechanic_pending` | search | `oblivions/include/game/explore.func.php` | 是 | 否 | `player_event` | 保留日志，表示机制等待/提示 |
| `search.mechanic_triggered` | search | `oblivions/include/game/explore.func.php` | 是 | 否 | `player_event` | 保留日志 |
| `search.result` | search | `oblivions/include/game/explore.func.php` | 是 | 是（success） | `player_event` | 保留日志；阶段三评估是否仍需 Toast |
| `pickup.not_found` | pickup | `oblivions/include/game/item/item.basic.func.php` | 是 | 否（阶段三移除；原 error） | `command_feedback` | Command API 返回道具不存在/已被拾取 |
| `pickup.empty_item` | pickup | `oblivions/include/game/item/item.basic.func.php` | 是 | 否 | `command_feedback` | Command API 返回空道具；可另记诊断 |
| `pickup.not_adjacent` | pickup | `oblivions/include/game/item/item.basic.func.php` | 是 | 否 | `command_feedback` | Command API 返回位置不匹配 |
| `pickup.unknown` | pickup | `oblivions/include/game/item/item.basic.func.php` | 是 | 否 | `command_feedback` | Command API 返回未发现，不可拾取 |
| `pickup.trap` | pickup | `oblivions/include/game/item/item.basic.func.php` | 是 | 否 | `player_event` | 保留历史事件；可视为被动反馈 |
| `pickup.nearsighted_reveal` | pickup | `oblivions/include/game/item/item.basic.func.php` | 是 | 否 | `player_event` | 保留历史事件 |
| `pickup.success` | pickup | `oblivions/include/game/item/item.basic.func.php` | 是 | 是（success，可能与 `item.to_bag` 合并） | `player_event` | 保留历史日志；阶段三避免与 command response 双 Toast |
| `discard.invalid_slot` | discard | `oblivions/include/game/item/item.basic.func.php` | 是 | 否 | `command_feedback` | Command API 返回非法槽位 |
| `discard.empty_slot` | discard | `oblivions/include/game/item/item.basic.func.php` | 是 | 否 | `command_feedback` | Command API 返回空槽位 |
| `discard.success` | discard | `oblivions/include/game/item/item.basic.func.php` | 是 | 是（success） | `player_event` | 保留历史日志；阶段三评估 Toast 来源 |
| `item.to_bag` | system | `obl_command_handlers.php` / `oblivions_commands.php` / `item.basic.func.php` / `item.craft.func.php` | 是 | 是（success，合并） | `player_event` | 保留历史日志；阶段三防重复 Toast |
| `organize.fail` | system | `obl_command_handlers.php` / `oblivions_commands.php` / `item.basic.func.php` / `item.craft.func.php` | 是 | 否 | `command_feedback` | Command API 返回整理失败/itm0 未处理 |
| `system.itm0_pending` | system | `obl_command_handlers.php` / `oblivions_commands.php` / `oblivions_router.php` | 是 | 否 | `command_feedback` | Command API 返回 `ITM0_PENDING`；日志可选 |
| `system.itm0_occupied` | system | `item.basic.func.php` / `item.craft.func.php` | 是（阶段二补充） | 否 | `command_feedback` | Command API 返回 itm0 占用；日志模板仅作历史兜底 |
| `system.pickup_concurrent_loss` | system | `oblivions/include/game/item/item.basic.func.php` | 是 | 否 | `command_feedback` | Command API 返回并发丢失/道具已被拾取 |
| `system.mechanic_max_hp_up` | system | `oblivions/include/game/explore.func.php` | 是 | 否 | `player_event` | 保留历史日志 |
| `enemy.discovered` | enemy | `oblivions/include/game/vision.func.php` | 是 | 否 | `passive_event` | 保留；可考虑阶段三加入被动 Toast |
| `enemy.move` | enemy | `oblivions/include/game/enemy_ai.func.php` | 是 | 否 | `debug_noise` | 已在后端标记 debug，默认不渲染 |
| `craft.fail_no_match` | system | `oblivions/include/game/item/item.craft.func.php` | 是 | 否 | `command_feedback` | Command API 返回无匹配配方 |
| `craft.fail_ambiguous` | system | `oblivions/include/game/item/item.craft.func.php` | 是 | 否 | `command_feedback` | Command API 返回配方歧义 |
| `craft.fail_itm0_occupied` | system | `oblivions/include/game/item/item.craft.func.php` | 是 | 否 | `command_feedback` | Command API 返回 itm0 占用 |
| `craft.success` | system | `oblivions/include/game/item/item.craft.func.php` | 是 | 否 | `player_event` | 保留历史日志；前端合成 store 也有本地预览反馈 |
| `use_item.empty_slot` | system | `oblivions/include/game/item/item.use.func.php` | 是 | 否 | `command_feedback` | Command API 返回空槽位 |
| `use_item.not_usable` | system | `oblivions/include/game/item/item.use.func.php` | 是 | 否 | `command_feedback` | Command API 返回不可使用 |
| `use_item.broken` | system | `oblivions/include/game/item/item.use.func.php` | 是 | 否 | `command_feedback` | Command API 返回已损坏 |
| `use_item.effect_not_registered` | system | `oblivions/include/game/item/item.use.func.php` | 是 | 否 | `diagnostic` | 应迁入 `obl_error_log` 或 debug 日志 |
| `use_item.success` | system | `oblivions/include/game/item/item.use.func.php` | 是 | 否 | `player_event` | 保留历史日志 |
| `durability.broken` | system | `oblivions/include/game/item/item.use.func.php` | 是 | 否 | `player_event` | 保留历史日志 |

备注：阶段二已补充 `system.itm0_occupied` 普通日志模板；即时反馈仍由 Command API 返回 `ITM0_PENDING`。

---

## 4. `obl_error_log` 后端事件清单

| 事件 ID | 当前来源 | 前端 Error renderer | 当前 Toast | 阶段一分类 | 迁移建议 |
|---|---|---|---|---|---|
| `command.exception` | `oblivions/include/command/obl_command_bus.php` | 否（默认渲染） | 是（默认 error） | `diagnostic` | 保留诊断；Command API 同时返回 `INTERNAL_ERROR` |
| `command.rejected` | `oblivions/include/command/obl_command_bus.php`；legacy `include/core/obl_command.php` | 是 | 是（部分 warning） | `command_feedback` + `diagnostic` | 普通拒绝迁移到 Command API；error_log 只保留 debug 诊断 |
| `battle_state.illegal_transition` | `oblivions/include/game/battle_state_machine.func.php` | 否（默认渲染） | 是（默认 error） | `diagnostic` | 保留诊断，普通 UI 可隐藏 |
| `battle_state.reset` | `oblivions/include/game/battle_state_machine.func.php` | 否（默认渲染） | 是（默认 error） | `diagnostic` | 保留诊断/恢复记录；普通 UI 可隐藏或降级 warning |
| `tick.dispatch.error` | `oblivions/include/game/tick.func.php` | 是 | 是（error） | `diagnostic` | 保留诊断 |
| `tick.player_fetch.error` | `oblivions/include/game/tick.func.php` | 是 | 是（error） | `diagnostic` | 保留诊断 |
| `enemy_ai.config_missing` | `oblivions/include/gamectl/init.func.php` | 是 | 是（error） | `diagnostic` | 保留诊断 |
| `search.data_error` | `oblivions/include/game/explore.func.php` | 是 | 是（error） | `diagnostic` | 保留诊断；注意前端 normal log 模板也有同名 ID，需清理歧义 |
| `skill.config_missing` | `oblivions/include/game/battle/battle.calc.php` | 否（默认渲染） | 是（默认 error） | `diagnostic` | 补 renderer 或保留默认，仅开发可见 |
| `initiative_calc.combatant_not_found` | `oblivions/include/game/battle/battle.queue.func.php` | 否（默认渲染） | 是（默认 error） | `diagnostic` | 保留诊断 |
| `battle_entry.empty_actions` | `oblivions/include/game/battle/battle.entry.php` | 否（默认渲染） | 是（默认 error） | `command_feedback` + `diagnostic` | Command API 应返回 invalid battle actions；error_log 只保留诊断 |

---

## 5. `battle_log` 战斗导演阶段清单（out-of-scope）

> 这些不是普通 `obl_log`。本轮仅标记为 `director`，不迁移。

| Phase | 当前来源 | 前端 BattleDirector case | 默认 debug 倾向 | 备注 |
|---|---|---|---|---|
| `initiative_roll` | `battle.queue.func.php` | 是 | render | round_start 段 |
| `queue_create` | `battle.queue.func.php` | 否 | debug | 队列创建调试 |
| `queue_rebuild` | `battle.queue.main.php` | 否 | debug | 队列重建调试 |
| `once_execute_pre` | `battle.main.php` | 是 | render | 动作执行前，director 会合并 pre/post |
| `once_execute_post` | `battle.main.php` | 是 | render | 动作执行后 |
| `execute_verify_failed` | `battle.main.php` | 否 | render/debug 混合 | 执行校验失败，目前非主渲染 case |
| `middle_check_target_dead` | `battle.main.php` | 否 | debug | 中途死亡检查 |
| `actor_state_check` | `battle.func.php` | 否 | debug | actor 状态检查 |
| `ap_recover` | `battle.func.php` | 否 | render | turn_start 段，但 director 未直接 case；需另案确认 |
| `flee` | `skill/modules/escape.skill.php` | 是 | render | 逃跑表现 |
| `combatant_cleared` | `battle.main.php` | 是 | render | 战斗单位清场 |
| `battle_end` | `battle.queue.main.php` | 是 | render | battle_end 段 |
| `ambush_battle_end` | `battle.entry.php` | 是 | render | ambush_battle_end 段 |
| `idle` | `skill/modules/idle.skill.php` | 否 | 默认 debug | 技能 idle 模块，后续如需渲染应另案处理 |
| `disband_cleanup` | `battle.queue.main.php` | 否 | 默认 debug | 解散清理 |
| `queue_check` | `battle.queue.main.php` | 否 | phase-only/默认 debug | 当前扫描到 setPhase，未确认是否直接 emit |
| `prepare` | `battle.queue.main.php` | 否 | phase-only/默认 debug | 当前扫描到 setPhase，未确认是否直接 emit |
| `verify` | `battle.main.php` | 否 | phase-only/默认 debug | 当前扫描到 setPhase，未确认是否直接 emit |
| `excute` | `battle.main.php` | 否 | phase-only/默认 debug | 注意拼写为 `excute`，疑似历史 typo；当前仅 setPhase |

阶段一发现：`battle_log` 有若干 phase 未被前端 director 显式 case 覆盖，但它们多为 debug 或 phase-only。本轮不处理；如后续出现战斗日志渲染缺失，再单独做 BattleLog registry / director 对齐任务。

---

## 6. 前端普通日志模板中未发现后端 `obl_log` emit 的 ID

这些事件存在于 `D:\wamp64\www\phpdts\vex-vue\src\data\log-templates.ts`，但阶段一扫描未发现对应后端 `$obl_log->emit(...)`。

| 事件 ID | 当前前端用途 | 分类 | 建议 |
|---|---|---|---|
| `pickup.bag_full` | 有模板，阶段三已从 `TOAST_RULES` 移除 | `frontend_only` / 旧逻辑残留 | 普通失败由 Command API 返回；模板可后续清理 |
| `search.data_error` | 有普通日志模板，但后端实际 emit 到 `obl_error_log` | `diagnostic` 映射歧义 | 普通日志模板疑似过时，阶段四清理 |
| `enemy.ambush` | 有模板，未发现普通日志 emit | `frontend_only` / 预留 | 确认是否已被 battle_log 取代 |
| `battle.skirmish` | 有模板，未发现普通日志 emit | `frontend_only` / 旧战斗摘要 | 若 battle_log 已接管，阶段三清理 |
| `battle.invalid` | 有模板，且在后端 DEBUG_IDS 中，但未发现 emit | `debug_noise` / 旧调试 | 可清理或保留为预留 |
| `battle.start` | 有模板，未发现普通日志 emit | `frontend_only` / 旧战斗摘要 | 若 battle_log 已接管，阶段三清理 |
| `battle.end` | 有模板，未发现普通日志 emit | `frontend_only` / 旧战斗摘要 | 若 battle_log 已接管，阶段三清理 |
| `craft.fail_bag_full` | 有模板，未发现后端 emit | `frontend_only` / 预留 | 确认合成失败是否会发生；Command API 应直接反馈 |
| `craft.empty_pool` | craft store 本地 preview | `frontend_only` | 保留为 craft_preview 前端反馈，不属于 `obl_log` |
| `craft.tool_missing` | craft store / craft_preview | `frontend_only` | 保留为预览反馈，不属于 `obl_log` |
| `craft.extra_material` | craft store / craft_preview | `frontend_only` | 保留为预览反馈，不属于 `obl_log` |
| `craft.insufficient` | craft store / craft_preview | `frontend_only` | 保留为预览反馈，不属于 `obl_log` |
| `craft.ready` | craft store / craft_preview | `frontend_only` | 保留为预览反馈，不属于 `obl_log` |

---

## 7. 当前前端 Toast 依赖

### 7.1 Log Toast（`vex-vue/src/stores/log.ts`）

| 事件 ID | Toast 类型 | 当前状态 |
|---|---|---|
| `pickup.success` | success | 保留；与 `item.to_bag` 合并 Toast，属于成功历史事件轻提示 |
| `item.to_bag` | success | 保留；道具入背包是可见状态变化，批量时合并 Toast |
| `search.result` | success | 保留；搜索成功历史事件轻提示 |
| `discard.success` | success | 保留；丢弃成功历史事件轻提示 |
| `pickup.bag_full` | - | 阶段三移除；未发现后端 emit，普通失败由 Command API 返回 |
| `pickup.not_found` | - | 阶段三移除；命令失败反馈由 Command API 返回 |
| `search.already_searched` | - | 阶段三移除；命令失败反馈由 Command API 返回 |

### 7.2 Error Toast（`vex-vue/src/stores/error-log.ts`）

阶段四后，`obl_error` 仍会被前端拉取并推进 `lastTs`，但普通 UI 默认不再 Toast 诊断事件。

仅以下诊断模式会弹出 error_log Toast：

```txt
?debug=ai
?poll_error=1
```

已显式 renderer：

```txt
tick.dispatch.error
tick.player_fetch.error
command.rejected
search.data_error
enemy_ai.config_missing
```

未显式 renderer 的 error_log 事件仍可在诊断模式走默认渲染。

---

## 8. 阶段二优先迁移候选

建议优先让 Command API 直接接管以下业务反馈：

```txt
ITM0_PENDING:
  system.itm0_pending
  system.itm0_occupied
  organize.fail
  craft.fail_itm0_occupied

MOVE_REJECTED:
  move.same_pos
  move.invalid_target
  move.blocked
  move.occupied
  move.unreachable
  move.no_path
  move.no_sp_far
  move.no_sp

SEARCH_REJECTED:
  search.not_found
  search.not_adjacent
  search.not_searchable
  search.already_searched

PICKUP_REJECTED:
  pickup.not_found
  pickup.empty_item
  pickup.not_adjacent
  pickup.unknown
  system.pickup_concurrent_loss

DISCARD_REJECTED:
  discard.invalid_slot
  discard.empty_slot

USE_ITEM_REJECTED:
  use_item.empty_slot
  use_item.not_usable
  use_item.broken

CRAFT_REJECTED:
  craft.fail_no_match
  craft.fail_ambiguous
  craft.fail_itm0_occupied

BATTLE_REJECTED:
  battle_entry.empty_actions
  command.rejected
```

迁移原则：Command API 直接返回 `code` 与可选 `data.feedback.id + params`；是否继续写 `obl_log` 作为历史痕迹另行决定。

阶段二修正补充：

```txt
后端 Command Bus 不再硬编码普通业务反馈中文文案。
命中 command_feedback 映射时，响应携带：
  code
  data.feedback.id
  data.feedback.params
  data.feedback.source
前端由 vex-vue/src/data/command-feedback.ts 复用 LOG_TEMPLATES 或 code 兜底模板渲染 Toast。
```

---

## 9. 阶段一发现的问题/待确认

1. `OBL_EVENT_LOG_DESIGN.md` 中“当前常见事件”不是全量；本 registry 已补全 `item/craft/use/diagnostic/battle phase`。
2. `system.itm0_occupied` 后端有 emit；阶段二已补普通日志模板，即时反馈由 Command API 处理。
3. `search.data_error` 同时存在普通日志模板和 error renderer，但后端实际 emit 到 `obl_error_log`。
4. `pickup.bag_full` 在旧前端 TOAST_RULES 中但未发现后端 emit；阶段三已从 Log Toast 白名单移除。
5. `battle.*` 普通日志模板很可能是旧战斗摘要残留；当前战斗导演主要使用 `battle_log`。
6. `use_item.effect_not_registered` 当前写入 `obl_log`，语义更像诊断，应迁入 `obl_error_log` 或 debug 流。
7. legacy `D:\wamp64\www\phpdts\oblivions\include\core\obl_command.php` 仍会 emit `command.rejected`，但它是旧根 `command.php` 兼容路径，不应作为新系统迁移重点。
8. `battle_log` phase `excute` 疑似 typo，但当前只发现 setPhase，不作为本轮问题处理。

---

## 10. 阶段一结论

阶段一至阶段四已完成：

```txt
1. Command API 已接管业务拒绝反馈
2. 前端 log Toast 已收束，避免 response/log 双重提示
3. error_log 已降级为诊断流，普通 UI 默认不 Toast
4. battle_log 仍保持 out-of-scope，不混入本轮
```
