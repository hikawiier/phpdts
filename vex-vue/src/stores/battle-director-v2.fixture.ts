import type { BattleLogV2Event } from '@/types/api';
import { directV2, type BattlePlayScriptV2 } from './battle-director-v2';

const PLAYER = {
  pid: 100,
  type: 0,
  name: '测试玩家',
  hp: 40,
  mhp: 40,
  ap: 3,
  max_ap: 3,
};

const ENEMY = {
  pid: 200,
  type: 1,
  name: '测试敌人',
  hp: 20,
  mhp: 20,
  ap: 2,
  max_ap: 2,
};

export const BATTLE_DIRECTOR_V2_FIXTURE_EVENTS: BattleLogV2Event[] = [
  makeEvent(1, 'round_start', {
    bl_round_num: 0,
    payload: {
      rolls: [
        { pid: PLAYER.pid, type: PLAYER.type, name: PLAYER.name, roll: 5, initiative: 5, myorder: 1 },
        { pid: ENEMY.pid, type: ENEMY.type, name: ENEMY.name, roll: 3, initiative: 3, myorder: 2 },
      ],
    },
  }),
  makeEvent(2, 'turn_start', {
    actor_pid: PLAYER.pid,
    bl_round_num: 0,
    bl_turn_num: 1,
    payload: { actor: PLAYER, ap_recovered: 1 },
  }),
  makeEvent(3, 'action_start', {
    actor_pid: PLAYER.pid,
    target_pid: ENEMY.pid,
    action_uid: 'fixture-a1',
    action_id: 'unarmed_strike',
    bl_round_num: 0,
    bl_turn_num: 1,
    payload: {
      action_uid: 'fixture-a1',
      action_id: 'unarmed_strike',
      actor: PLAYER,
      targets: [{ kind: 'pid', pid: ENEMY.pid, snapshot: ENEMY }],
      ap_cost: 1,
    },
  }),
  makeEvent(4, 'effect_applied', {
    actor_pid: PLAYER.pid,
    target_pid: ENEMY.pid,
    action_uid: 'fixture-a1',
    effect_uid: 'fixture-e1',
    action_id: 'unarmed_strike',
    effect_type: 'damage',
    effect_value: 7,
    bl_round_num: 0,
    bl_turn_num: 1,
    payload: {
      action_uid: 'fixture-a1',
      effect_uid: 'fixture-e1',
      effect_type: 'damage',
      source: PLAYER,
      target: { kind: 'pid', pid: ENEMY.pid, snapshot: ENEMY },
      value: 7,
      delta: { hp_before: 20, hp_after: 13 },
    },
  }),
  makeEvent(5, 'action_end', {
    actor_pid: PLAYER.pid,
    target_pid: ENEMY.pid,
    action_uid: 'fixture-a1',
    action_id: 'unarmed_strike',
    success: true,
    bl_round_num: 0,
    bl_turn_num: 1,
    payload: {
      action_uid: 'fixture-a1',
      action_id: 'unarmed_strike',
      actor: PLAYER,
      success: true,
      ap_spent: 1,
    },
  }),
  makeEvent(6, 'action_failed', {
    actor_pid: PLAYER.pid,
    action_uid: null,
    action_id: 'throw',
    success: false,
    reason: 'target_invalid',
    bl_round_num: 0,
    bl_turn_num: 1,
    payload: {
      action_uid: null,
      action_id: 'throw',
      actor: PLAYER,
      reason: 'target_invalid',
      ap_spent: 0,
    },
  }),
  makeEvent(7, 'combatant_cleared', {
    target_pid: ENEMY.pid,
    bl_round_num: 0,
    bl_turn_num: 1,
    payload: {
      combatant: { ...ENEMY, hp: 0 },
      reason: 'death',
      by_action_uid: 'fixture-a1',
      by_effect_uid: 'fixture-e1',
    },
  }),
  makeEvent(8, 'battle_end', {
    winner_pid: PLAYER.pid,
    bl_segment_flag: 'battle_end',
    payload: {
      reason: 'victory',
      winner_pid: PLAYER.pid,
      survivors: [PLAYER],
    },
  }),
];

export function buildBattleDirectorV2FixtureScript(): BattlePlayScriptV2 {
  return directV2(BATTLE_DIRECTOR_V2_FIXTURE_EVENTS);
}

export function assertBattleDirectorV2Fixture(): void {
  const script = buildBattleDirectorV2FixtureScript();
  const turn = script.segments.find(segment => segment.kind === 'turn');
  const battleEnd = script.segments.find(segment => segment.kind === 'battle_end');
  const action = turn?.actions[0];
  const effect = action?.effects[0];

  if (script.schema !== 'battleplay.v2') throw new Error('fixture schema mismatch');
  if (!turn || turn.notices.length < 2) throw new Error('fixture turn notices missing');
  if (!action || action.actionUid !== 'fixture-a1') throw new Error('fixture action missing');
  if (!effect || effect.visual.kind !== 'damage_number') throw new Error('fixture damage visual missing');
  if (!battleEnd || battleEnd.notices[0]?.winnerPid !== PLAYER.pid) throw new Error('fixture battle_end missing');
}

function makeEvent(
  logId: number,
  eventType: BattleLogV2Event['event_type'],
  overrides: Partial<BattleLogV2Event>,
): BattleLogV2Event {
  return {
    log_id: logId,
    played: 0,
    ts: 0,
    phase: 'battlelog_v2',
    schema: 'battlelog.v2',
    event_type: eventType,
    channel: 'render',
    event_uid: `fixture-${logId}`,
    action_uid: null,
    effect_uid: null,
    payload: {},
    debug: false,
    qid: 1,
    actor_pid: null,
    target_pid: null,
    action_id: null,
    effect_type: null,
    effect_value: null,
    success: null,
    reason: null,
    winner_pid: null,
    cleared_pid: null,
    cleared_name: null,
    bl_turn_num: null,
    bl_round_num: null,
    bl_segment_flag: null,
    ...overrides,
  };
}
