import type { BattleLogV2Event } from '@/types/api';
import { directV2, planPlaybackV2, type ActionDeliveryStep, type BattlePlayScriptV2 } from './battle-director-v2';

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
  makeEvent(4, 'combatant_joined', {
    actor_pid: PLAYER.pid,
    target_pid: ENEMY.pid,
    action_uid: 'fixture-a1',
    action_id: 'unarmed_strike',
    bl_round_num: 0,
    bl_turn_num: 1,
    payload: {
      qid: 1,
      combatant: ENEMY,
      source_actor_pid: PLAYER.pid,
      source_action_uid: 'fixture-a1',
      myorder: 2,
      done: 0,
    },
  }),
  makeEvent(5, 'effect_applied', {
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
  makeEvent(6, 'action_end', {
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
  makeEvent(7, 'action_failed', {
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
  makeEvent(8, 'combatant_cleared', {
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
  makeEvent(9, 'action_start', {
    actor_pid: PLAYER.pid,
    action_uid: 'fixture-grenade-empty',
    action_id: 'grenade',
    bl_round_num: 0,
    bl_turn_num: 1,
    payload: {
      action_uid: 'fixture-grenade-empty',
      action_id: 'grenade',
      actor: PLAYER,
      resolved_aim: { kind: 'tile', pgroup: 1, pls: 1005 },
      targets: [],
      ap_cost: 1,
    },
  }),
  makeEvent(10, 'action_delivery', {
    actor_pid: PLAYER.pid,
    action_uid: 'fixture-grenade-empty',
    action_id: 'grenade',
    bl_round_num: 0,
    bl_turn_num: 1,
    payload: {
      action_uid: 'fixture-grenade-empty',
      action_id: 'grenade',
      delivery_type: 'projectile_to_tile',
      resolved_aim: { kind: 'tile', pgroup: 1, pls: 1005 },
      actor: PLAYER,
    },
  }),
  makeEvent(11, 'action_delivery', {
    actor_pid: PLAYER.pid,
    action_uid: 'fixture-grenade-empty',
    action_id: 'grenade',
    bl_round_num: 0,
    bl_turn_num: 1,
    payload: {
      action_uid: 'fixture-grenade-empty',
      action_id: 'grenade',
      delivery_type: 'explosion_at_tile',
      resolved_aim: { kind: 'tile', pgroup: 1, pls: 1005 },
      actor: PLAYER,
    },
  }),
  makeEvent(12, 'action_end', {
    actor_pid: PLAYER.pid,
    action_uid: 'fixture-grenade-empty',
    action_id: 'grenade',
    success: true,
    bl_round_num: 0,
    bl_turn_num: 1,
    payload: {
      action_uid: 'fixture-grenade-empty',
      action_id: 'grenade',
      actor: PLAYER,
      success: true,
      ap_spent: 1,
    },
  }),
  makeEvent(13, 'battle_end', {
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
  const plan = planPlaybackV2(script);
  const joinedStepIndex = plan.steps.findIndex(step => step.kind === 'combatant_joined');
  const firstActionStepIndex = plan.steps.findIndex(step => step.kind === 'action_animation' && step.action.actionUid === 'fixture-a1');
  const emptyGrenade = turn?.actions.find(item => item.actionUid === 'fixture-grenade-empty');
  const deliverySteps = plan.steps.filter((step): step is ActionDeliveryStep =>
    step.kind === 'action_delivery' && step.action.actionUid === 'fixture-grenade-empty');
  const battleEndSteps = plan.steps
    .filter(step => step.segment === battleEnd)
    .map(step => step.kind);

  if (script.schema !== 'battleplay.v2') throw new Error('fixture schema mismatch');
  if (!turn || turn.notices.length < 2) throw new Error('fixture turn notices missing');
  if (!action || action.actionUid !== 'fixture-a1') throw new Error('fixture action missing');
  if (!effect || effect.visual.kind !== 'damage_number') throw new Error('fixture damage visual missing');
  if (joinedStepIndex < 0 || firstActionStepIndex < 0 || joinedStepIndex >= firstActionStepIndex) {
    throw new Error('fixture combatant_joined ordering mismatch');
  }
  if (!emptyGrenade || emptyGrenade.effects.length !== 0
    || emptyGrenade.deliveries.map(delivery => delivery.type).join(',') !== 'projectile_to_tile,explosion_at_tile') {
    throw new Error('fixture empty grenade delivery missing');
  }
  if (deliverySteps.length !== 2
    || deliverySteps.map(step => step.delivery.type).join(',') !== 'projectile_to_tile,explosion_at_tile') {
    throw new Error('fixture delivery playback order mismatch');
  }
  assertMoveThenDeliveryOrder();
  assertEscapeThenClearOrder();
  if (!battleEnd || battleEnd.notices[0]?.winnerPid !== PLAYER.pid) throw new Error('fixture battle_end missing');
  if (battleEndSteps.join(',') !== 'battle_end_overlay_enter,presentation_scene_handoff,battle_end_modal_content') {
    throw new Error('fixture battle_end handoff ordering mismatch');
  }
}

function assertEscapeThenClearOrder(): void {
  const escapingEnemy = { ...ENEMY, pid: 201, name: '逃跑敌人' };
  const events: BattleLogV2Event[] = [
    makeEvent(201, 'turn_start', {
      actor_pid: escapingEnemy.pid,
      bl_round_num: 1,
      bl_turn_num: 2,
      payload: { actor: escapingEnemy, ap_recovered: 0 },
    }),
    makeEvent(202, 'action_start', {
      actor_pid: escapingEnemy.pid,
      action_uid: 'fixture-escape',
      action_id: 'escape',
      bl_round_num: 1,
      bl_turn_num: 2,
      payload: {
        action_uid: 'fixture-escape',
        action_id: 'escape',
        actor: escapingEnemy,
        targets: [{ kind: 'pid', pid: escapingEnemy.pid, snapshot: escapingEnemy }],
      },
    }),
    makeEvent(203, 'effect_applied', {
      actor_pid: escapingEnemy.pid,
      target_pid: escapingEnemy.pid,
      action_uid: 'fixture-escape',
      effect_uid: 'fixture-escape-effect',
      action_id: 'escape',
      effect_type: 'escape',
      bl_round_num: 1,
      bl_turn_num: 2,
      payload: {
        action_uid: 'fixture-escape',
        effect_uid: 'fixture-escape-effect',
        effect_type: 'escape',
        source: escapingEnemy,
        target: { kind: 'pid', pid: escapingEnemy.pid, snapshot: escapingEnemy },
      },
    }),
    makeEvent(204, 'action_end', {
      actor_pid: escapingEnemy.pid,
      action_uid: 'fixture-escape',
      action_id: 'escape',
      success: true,
      bl_round_num: 1,
      bl_turn_num: 2,
      payload: {
        action_uid: 'fixture-escape',
        action_id: 'escape',
        actor: escapingEnemy,
        success: true,
      },
    }),
    makeEvent(205, 'combatant_cleared', {
      target_pid: escapingEnemy.pid,
      bl_round_num: 1,
      bl_turn_num: 2,
      payload: {
        combatant: escapingEnemy,
        reason: 'escaped',
        by_action_uid: 'fixture-escape',
        by_effect_uid: 'fixture-escape-effect',
      },
    }),
  ];
  const plan = planPlaybackV2(directV2(events));
  const escapeIndex = plan.steps.findIndex(step =>
    step.kind === 'action_animation' && step.action.actionUid === 'fixture-escape');
  const clearIndex = plan.steps.findIndex(step =>
    step.kind === 'combatant_cleared' && step.notice.combatant?.pid === escapingEnemy.pid);
  if (escapeIndex < 0 || clearIndex <= escapeIndex) {
    throw new Error('fixture escape must play before combatant clear');
  }
}

function assertMoveThenDeliveryOrder(): void {
  const events: BattleLogV2Event[] = [
    makeEvent(101, 'action_start', {
      action_uid: 'fixture-move', action_id: 'move', bl_round_num: 0, bl_turn_num: 1,
      payload: {
        action_uid: 'fixture-move', action_id: 'move', actor: PLAYER,
        resolved_aim: { kind: 'tile', pgroup: 1, pls: 1002 },
        targets: [{ kind: 'tile', pgroup: 1, pls: 1002 }],
      },
    }),
    makeEvent(102, 'effect_applied', {
      action_uid: 'fixture-move', action_id: 'move', effect_uid: 'fixture-move-effect', effect_type: 'move',
      bl_round_num: 0, bl_turn_num: 1,
      payload: {
        action_uid: 'fixture-move', effect_uid: 'fixture-move-effect', effect_type: 'move',
        source: PLAYER, target: { kind: 'tile', pgroup: 1, pls: 1002 },
        delta: { pls_before: 1001, pls_after: 1002 },
      },
    }),
    makeEvent(103, 'action_end', {
      action_uid: 'fixture-move', action_id: 'move', success: true, bl_round_num: 0, bl_turn_num: 1,
      payload: { action_uid: 'fixture-move', action_id: 'move', actor: PLAYER, success: true },
    }),
    makeEvent(104, 'action_start', {
      action_uid: 'fixture-after-move-grenade', action_id: 'grenade', bl_round_num: 0, bl_turn_num: 1,
      payload: {
        action_uid: 'fixture-after-move-grenade', action_id: 'grenade', actor: { ...PLAYER, pls: 1002 },
        resolved_aim: { kind: 'tile', pgroup: 1, pls: 1005 }, targets: [],
      },
    }),
    makeEvent(105, 'action_delivery', {
      action_uid: 'fixture-after-move-grenade', action_id: 'grenade', bl_round_num: 0, bl_turn_num: 1,
      payload: {
        action_uid: 'fixture-after-move-grenade', action_id: 'grenade', delivery_type: 'projectile_to_tile',
        resolved_aim: { kind: 'tile', pgroup: 1, pls: 1005 }, actor: { ...PLAYER, pls: 1002 },
      },
    }),
    makeEvent(106, 'action_delivery', {
      action_uid: 'fixture-after-move-grenade', action_id: 'grenade', bl_round_num: 0, bl_turn_num: 1,
      payload: {
        action_uid: 'fixture-after-move-grenade', action_id: 'grenade', delivery_type: 'explosion_at_tile',
        resolved_aim: { kind: 'tile', pgroup: 1, pls: 1005 }, actor: { ...PLAYER, pls: 1002 },
      },
    }),
    makeEvent(107, 'action_end', {
      action_uid: 'fixture-after-move-grenade', action_id: 'grenade', success: true, bl_round_num: 0, bl_turn_num: 1,
      payload: { action_uid: 'fixture-after-move-grenade', action_id: 'grenade', actor: PLAYER, success: true },
    }),
  ];
  const plan = planPlaybackV2(directV2(events));
  const moveIndex = plan.steps.findIndex(step => step.kind === 'action_animation' && step.action.actionUid === 'fixture-move');
  const deliverySteps = plan.steps.filter((step): step is ActionDeliveryStep =>
    step.kind === 'action_delivery' && step.action.actionUid === 'fixture-after-move-grenade');
  const firstDeliveryIndex = deliverySteps.length > 0 ? plan.steps.indexOf(deliverySteps[0]) : -1;
  if (moveIndex < 0 || deliverySteps.length !== 2 || firstDeliveryIndex <= moveIndex) {
    throw new Error('fixture move/delivery playback order mismatch');
  }
  if (deliverySteps.some(step => step.delivery.resolvedAim.pls !== 1005)) {
    throw new Error('fixture delivery resolved aim mismatch');
  }
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
