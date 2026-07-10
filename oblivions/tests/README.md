# Oblivions Combat Tests

Run with the WAMP PHP build that includes mysqli:

```powershell
& 'D:\wamp64\bin\php\php8.3.28\php.exe' oblivions/tests/run.php
```

The runner creates a process-unique table prefix, uses the production SQL schemas,
and drops every temporary table in `finally`. It never mutates the active room.

## Automated Evidence

The current suite is focused regression coverage, not complete proof of every item in design section 16.

| Covered behavior | Automated evidence |
|---|---|
| Tile AimIntent mismatch, duplicate capture rejection, built-in tile provenance, capture-once, snapshot immutability, captured action index | `aim_capture_provenance_freeze_and_snapshot` |
| Delivery config requires canonical ordered `types: string[]` and allows an empty list | `delivery_config_requires_ordered_types_array` |
| Queue-member-before-joinable ordering and stable PID order | `aim_capture_direct_and_tile_order` |
| Queue-order target/effect events | `multi_target_resolution_follows_queue_order` |
| Multi-target AP/CD commits once; all-invalid fail-policy action commits neither | `multi_target_commits_resources_once_and_all_failed_commits_nothing` |
| Dead A and skipped B do not block C | `dead_a_and_skipped_b_do_not_block_c` |
| Actor termination during A stops B/C | `actor_termination_after_a_stops_b_and_c` |
| Existing member idempotency and left-member re-entry rejection | `member_is_idempotent_and_left_cannot_reenter` |
| One AOE joins B/C in order while friendly/dead/other-qid targets skip independently | `aoe_joins_in_order_and_skips_each_invalid_target_independently` |
| Dynamic join followed by immediate death cleanup | `joined_target_can_die_in_same_unit` |
| Action 1 initial target and Action 2 dynamic append-tail | `initial_roster_then_dynamic_join_and_target_order` |
| Initial grenade builds A/B/C roster while preserving D in another qid | `initial_grenade_filters_other_qid_without_blocking_roster` |
| Failed utility remains visible in `battle.start` action results | `battle_start_reports_failed_utility_before_hostile_action` |
| Move updates planned/current position before later grenade Aim/Capture | `move_before_grenade_uses_updated_actor_position` |
| Empty grenade ordered delivery events | `empty_grenade_emits_two_delivery_events` |
| Direct attack target in another qid is rejected without stealing its row | `other_qid_target_is_not_stolen` |
| Target SAVEPOINT rolls back failed effect, AP, target mutation, collector entries, and dynamic join | `target_effect_failure_rolls_back_savepoint_and_join` |
| Queue insert and player save failures roll back partial membership writes | `queue_insert_failure_leaves_no_player_membership`, `player_save_failure_removes_inserted_queue_row` |
| Third-target SQL fault rolls back prior effects/AP and does not persist the request collector | `third_target_sql_failure_rolls_back_prior_targets` |
| NPC dynamic-join fault and real heartbeat-orchestrator NPC fault both roll back | `npc_turn_dynamic_join_fault_rolls_back_membership`, `heartbeat_orchestrator_fault_rolls_back_npc_turn_and_tick` |
| Target rules and skill hooks see the same reserved AP in preview and execute | `ap_reservation_is_visible_to_rules_and_hooks` |
| Schema engines and queue composite index | `schema_engines_and_queue_index` |
| SQL exception causes explicit transaction rollback | `sql_exception_rolls_back_transaction` |
| Isolated fatal shutdown rolls back active transaction and releases room lock | `fatal_shutdown_rolls_back_and_releases_room_lock` |
| Commit failure cleanup clears request-local transaction state even on a broken connection | `commit_failure_cleanup_clears_runtime_state` |
| Battlelog persistence failure after commit returns warning and preserves domain state | `post_commit_battlelog_failure_returns_warning_and_keeps_state` |
| Preview preserves DB/files, real collector, gamevars, request/event UID sequence, and RNG; readonly Command Bus preserves debug collector | `preview_has_no_db_or_file_side_effects`, `readonly_command_bus_does_not_touch_player_or_game` |
| Director creates ordered delivery/joined playback; target validator rejects stale qid, blocked, dead, and missing projections | `npm test` in `vex-vue` |

## Remaining Acceptance Gaps

The following section 16 requirements do not yet have direct automated evidence:

- complete Aim error taxonomy, forged pgroup/pls, direct-character identity, latest-state rebind, and full snapshot fields;
- reaction-specific behavior beyond the current actor-termination boundary;
- commit failure and post-COMMIT fatal ambiguity; a fatal after COMMIT cannot roll back committed state, so clients must reconcile State and must not automatically replay;
- AimMode/PreloadArea/MapGrid DOM behaviors in section 16.7 remain browser evidence; `npm test` now covers Director playback and the shared strict target/session validator.
