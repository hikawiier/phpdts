/**
 * @module K 状态管理层
 */

import type { BattleLogV3Event } from '@/types/api';
import { resolveBattleAnimationChain } from '@/animations/action-specs';
import {
  directBattleEvents,
  planBattlePlayback,
  selectUnconsumedBattleEvents,
  type ActionChoreographyStep,
} from './battle-director';

const PLAYER = {
  pid: 100, type: 0, name: '测试玩家', hp: 40, mhp: 40, ap: 3, max_ap: 3,
};
const ENEMY = {
  pid: 200, type: 1, name: '测试敌人', hp: 20, mhp: 20, ap: 2, max_ap: 2,
};

export function assertBattleDirectorFixture(): void {
  const events: BattleLogV3Event[] = [
    makeEvent(1, 'turn_opened', {
      event_uid: 'battle:1:turn:1:opened',
      payload: {
        actor: PLAYER,
        controller: 'player',
        opening_kind: 'battle_start',
        ap_recovered: 1,
      },
    }),
    makeEvent(2, 'action_start', {
      action_uid: 'fixture-a1',
      action_id: 'unarmed_strike',
      payload: {
        action_uid: 'fixture-a1', action_id: 'unarmed_strike', actor: PLAYER,
        targets: [{ kind: 'pid', pid: ENEMY.pid, snapshot: ENEMY }], ap_cost: 1,
      },
    }),
    makeEvent(3, 'combatant_joined', {
      action_uid: 'fixture-a1',
      target_pid: ENEMY.pid,
      payload: {
        combatant: ENEMY, source_action_uid: 'fixture-a1', myorder: 2, done: 0,
      },
    }),
    makeEvent(4, 'effect_applied', {
      action_uid: 'fixture-a1', effect_uid: 'fixture-e1', effect_type: 'damage', effect_value: 7,
      target_pid: ENEMY.pid,
      payload: {
        action_uid: 'fixture-a1', effect_uid: 'fixture-e1', effect_type: 'damage',
        source: PLAYER, target: { kind: 'pid', pid: ENEMY.pid, snapshot: ENEMY },
        value: 7, delta: { hp_before: 20, hp_after: 13 },
      },
    }),
    makeEvent(5, 'action_end', {
      action_uid: 'fixture-a1', action_id: 'unarmed_strike', success: true,
      payload: { action_uid: 'fixture-a1', action_id: 'unarmed_strike', actor: PLAYER, success: true },
    }),
    makeEvent(6, 'action_failed', {
      action_id: 'throw', success: false, reason: 'target_invalid',
      payload: { action_id: 'throw', actor: PLAYER, reason: 'target_invalid' },
    }),
    makeEvent(7, 'combatant_cleared', {
      target_pid: ENEMY.pid,
      payload: {
        combatant: { ...ENEMY, hp: 0 }, reason: 'death',
        by_action_uid: 'fixture-a1', by_effect_uid: 'fixture-e1',
      },
    }),
    makeEvent(8, 'battle_end', {
      winner_pid: PLAYER.pid,
      payload: { reason: 'victory', winner_pid: PLAYER.pid, survivors: [PLAYER] },
    }),
  ];

  const script = directBattleEvents(events);
  const intro = script.segments.find(segment => segment.kind === 'turn_intro');
  const turn = script.segments.find(segment => segment.kind === 'turn');
  const battleEnd = script.segments.find(segment => segment.kind === 'battle_end');
  const action = turn?.actions[0];
  if (script.schema !== 'battleplay.v3') throw new Error('fixture schema mismatch');
  if (!intro || intro.openingKind !== 'battle_start' || intro.turnKey !== '1:1') {
    throw new Error('authoritative battle-start intro missing');
  }
  if (!turn || turn.turnKey !== '1:1' || turn.notices.length < 2) throw new Error('fixture turn missing');
  if (!action || action.effects[0]?.visual.kind !== 'damage_number') throw new Error('fixture action missing');
  if (action.joinedCombatants[0]?.combatant.pid !== ENEMY.pid) throw new Error('joined fact missing');
  const melee = resolveBattleAnimationChain(action);
  if (melee.hitTrigger !== 'attack-impact' || melee.attackMain !== 'actor-melee') {
    throw new Error('melee choreography mismatch');
  }

  const plan = planBattlePlayback(script);
  const battleEndSteps = plan.steps.filter(step => step.segment === battleEnd).map(step => step.kind);
  if (battleEndSteps.join(',') !== 'battle_end_overlay_enter,presentation_scene_handoff,battle_end_modal_content') {
    throw new Error('battle_end barrier ordering mismatch');
  }

  assertOrdinaryFirstRoundTurn();
  assertCrossBatchTurnIntro();
  assertMoveThenDeliveryOrder();
  assertEscapeThenClearOrder();
  assertMissingTurnKeyRejected();
  assertDuplicateEventUidFiltered();
}

function assertOrdinaryFirstRoundTurn(): void {
  const script = directBattleEvents([
    makeEvent(20, 'turn_opened', {
      turn_seq: 2,
      turn_key: '1:2',
      payload: { actor: ENEMY, controller: 'system', opening_kind: 'turn', ap_recovered: 0 },
    }),
  ]);
  const intro = script.segments[0];
  if (intro.kind !== 'turn_intro' || intro.openingKind !== 'turn' || intro.roundNum !== 1) {
    throw new Error('first-round later actor was misclassified as battle start');
  }
}

function assertCrossBatchTurnIntro(): void {
  const opened = directBattleEvents([
    makeEvent(30, 'turn_opened', {
      event_uid: 'battle:1:turn:3:opened', turn_seq: 3, turn_key: '1:3',
      payload: { actor: PLAYER, controller: 'player', opening_kind: 'turn', ap_recovered: 0 },
    }),
  ]);
  const actions = directBattleEvents([
    makeEvent(31, 'action_start', {
      turn_seq: 3, turn_key: '1:3', action_uid: 'cross-batch', action_id: 'move',
      payload: {
        action_uid: 'cross-batch', action_id: 'move', actor: PLAYER,
        targets: [{ kind: 'tile', pgroup: 1, pls: 2 }],
      },
    }),
    makeEvent(32, 'action_end', {
      turn_seq: 3, turn_key: '1:3', action_uid: 'cross-batch', action_id: 'move', success: true,
      payload: { action_uid: 'cross-batch', action_id: 'move', actor: PLAYER, success: true },
    }),
  ]);
  if (opened.segments.filter(segment => segment.kind === 'turn_intro').length !== 1) {
    throw new Error('turn_opened did not create exactly one intro');
  }
  if (actions.segments.some(segment => segment.kind === 'turn_intro')) {
    throw new Error('action batch synthesized a duplicate turn intro');
  }
}

function assertMoveThenDeliveryOrder(): void {
  const events = [
    makeEvent(40, 'action_start', {
      action_uid: 'move', action_id: 'move',
      payload: { action_uid: 'move', action_id: 'move', actor: PLAYER, targets: [{ kind: 'tile', pgroup: 1, pls: 2 }] },
    }),
    makeEvent(41, 'effect_applied', {
      action_uid: 'move', effect_uid: 'move-e', effect_type: 'move',
      payload: {
        action_uid: 'move', effect_uid: 'move-e', effect_type: 'move', source: PLAYER,
        target: { kind: 'tile', pgroup: 1, pls: 2 }, delta: { pls_before: 1, pls_after: 2 },
      },
    }),
    makeEvent(42, 'action_end', {
      action_uid: 'move', action_id: 'move', success: true,
      payload: { action_uid: 'move', action_id: 'move', actor: PLAYER, success: true },
    }),
    makeEvent(43, 'action_start', {
      action_uid: 'grenade', action_id: 'grenade',
      payload: { action_uid: 'grenade', action_id: 'grenade', actor: { ...PLAYER, pls: 2 }, targets: [] },
    }),
    makeEvent(44, 'action_delivery', {
      action_uid: 'grenade', action_id: 'grenade',
      payload: {
        action_uid: 'grenade', action_id: 'grenade', delivery_type: 'projectile_to_tile',
        resolved_aim: { kind: 'tile', pgroup: 1, pls: 5 }, actor: { ...PLAYER, pls: 2 },
      },
    }),
    makeEvent(45, 'action_end', {
      action_uid: 'grenade', action_id: 'grenade', success: true,
      payload: { action_uid: 'grenade', action_id: 'grenade', actor: PLAYER, success: true },
    }),
  ];
  const plan = planBattlePlayback(directBattleEvents(events));
  const moveIndex = plan.steps.findIndex(step => step.kind === 'action_choreography' && step.action.actionUid === 'move');
  const grenade = plan.steps.find((step): step is ActionChoreographyStep =>
    step.kind === 'action_choreography' && step.action.actionUid === 'grenade');
  if (!grenade || plan.steps.indexOf(grenade) <= moveIndex || grenade.awaitPolicy !== 'completion') {
    throw new Error('move/delivery order mismatch');
  }
}

function assertEscapeThenClearOrder(): void {
  const escaping = { ...ENEMY, pid: 201, name: '逃跑敌人' };
  const events = [
    makeEvent(50, 'action_start', {
      action_uid: 'escape', action_id: 'escape',
      payload: { action_uid: 'escape', action_id: 'escape', actor: escaping, targets: [{ kind: 'self', pid: 201, snapshot: escaping }] },
    }),
    makeEvent(51, 'effect_applied', {
      action_uid: 'escape', effect_uid: 'escape-e', effect_type: 'escape',
      payload: {
        action_uid: 'escape', effect_uid: 'escape-e', effect_type: 'escape', source: escaping,
        target: { kind: 'self', pid: 201, snapshot: escaping },
      },
    }),
    makeEvent(52, 'action_end', {
      action_uid: 'escape', action_id: 'escape', success: true,
      payload: { action_uid: 'escape', action_id: 'escape', actor: escaping, success: true },
    }),
    makeEvent(53, 'combatant_cleared', {
      target_pid: 201,
      payload: { combatant: escaping, reason: 'escaped', by_action_uid: 'escape', by_effect_uid: 'escape-e' },
    }),
  ];
  const plan = planBattlePlayback(directBattleEvents(events));
  const escapeIndex = plan.steps.findIndex(step => step.kind === 'action_choreography');
  const clearIndex = plan.steps.findIndex(step => step.kind === 'combatant_cleared');
  if (escapeIndex < 0 || clearIndex <= escapeIndex) throw new Error('escape must precede clear');
}

function assertMissingTurnKeyRejected(): void {
  const malformed = makeEvent(60, 'action_start', {
    turn_key: '',
    action_uid: 'malformed', action_id: 'move',
    payload: { action_uid: 'malformed', action_id: 'move', actor: PLAYER, targets: [] },
  });
  let threw = false;
  try { directBattleEvents([malformed]); } catch { threw = true; }
  if (!threw) throw new Error('missing turn_key was silently guessed');
}

function assertDuplicateEventUidFiltered(): void {
  const event = makeEvent(70, 'turn_opened', {
    event_uid: 'battle:1:turn:7:opened',
    turn_seq: 7,
    turn_key: '1:7',
    payload: { actor: PLAYER, controller: 'player', opening_kind: 'turn' },
  });
  const withinBatch = selectUnconsumedBattleEvents([event, { ...event }], new Set());
  if (withinBatch.events.length !== 1) throw new Error('duplicate event_uid survived one batch');
  const acrossBatch = selectUnconsumedBattleEvents([event], new Set(withinBatch.eventUids));
  if (acrossBatch.events.length !== 0) throw new Error('duplicate event_uid survived across batches');
}

function makeEvent(
  logId: number,
  eventType: BattleLogV3Event['event_type'],
  overrides: Partial<BattleLogV3Event>,
): BattleLogV3Event {
  return {
    log_id: logId,
    event_seq: logId,
    played: 0,
    ts: 0,
    phase: 'battlelog_v3',
    schema: 'battlelog.v3',
    event_type: eventType,
    channel: 'render',
    event_uid: `fixture-${logId}`,
    action_uid: null,
    effect_uid: null,
    payload: {},
    debug: false,
    qid: 1,
    round_num: 1,
    turn_seq: 1,
    turn_key: '1:1',
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
    ...overrides,
  };
}
