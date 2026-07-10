import { nextTick } from 'vue';
import { getActorById } from '@/composables/actorRegistry';
import { isCueAnimationHandle } from '@/composables/useActorRuntime';
import { resolveActionSpec } from '@/animations/action-specs';
import { createExplosionOverlay, createProjectileOverlay } from './battle-overlay-executor';
import type { AnimationHandle } from '@/types/actor-runtime';
import type { SceneGeometry, ScenePoint } from '@/types/scene';
import type { BattlePresentationSession } from './battle-presentation-session';
import type {
  CombatantView,
  CombatTargetView,
  DirectedActionV2,
  DirectedCombatantJoinedV2,
  DirectedDeliveryV2,
  DirectedEffectV2,
  DirectedNoticeV2,
} from './battle-director-v2';

const MAP_READY_RETRIES = 10;

export interface BattleActorExecutionContext {
  scene: SceneGeometry;
  presentation: BattlePresentationSession;
  currentPid: number;
}

export interface PlaybackExecutionTask {
  readonly finished: Promise<void>;
  cancel(reason?: string): void;
}

interface TaskScope {
  readonly cancelled: boolean;
  add(handle: AnimationHandle): AnimationHandle;
}

function createTask(run: (scope: TaskScope) => Promise<void>): PlaybackExecutionTask {
  const handles = new Set<AnimationHandle>();
  let cancelled = false;
  const scope: TaskScope = {
    get cancelled() { return cancelled; },
    add(handle) {
      handles.add(handle);
      void handle.finished.finally(() => handles.delete(handle));
      return handle;
    },
  };
  return {
    finished: run(scope),
    cancel(reason = 'cancelled') {
      if (cancelled) return;
      cancelled = true;
      for (const handle of handles) handle.cancel(reason);
    },
  };
}

function completedTask(): PlaybackExecutionTask {
  return { finished: Promise.resolve(), cancel: () => {} };
}

function nextFrame(): Promise<void> {
  return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

export function prepareBattlefield(context: BattleActorExecutionContext): PlaybackExecutionTask {
  return createTask(async scope => {
    for (let i = 0; i < MAP_READY_RETRIES && !scope.cancelled; i++) {
      if (!context.scene.active) throw new Error('Battle scene was replaced while preparing playback');
      if (getActorById('player')) return;
      await nextTick();
      await nextFrame();
    }
  });
}

export function playActionAnimation(
  action: DirectedActionV2,
  context: BattleActorExecutionContext,
): PlaybackExecutionTask {
  if (action.deliveries.some(delivery => isImpactDelivery(delivery.type))) {
    return playDeliveredEffectReactions(action, context);
  }
  switch (action.animation.kind) {
    case 'move': return playMoveAction(action, context);
    case 'melee_hit':
    case 'projectile': return playDamageAction(action, context);
    case 'area_burst': return playAreaDamageAction(action, context);
    case 'escape':
    case 'none':
    default: return completedTask();
  }
}

function playDeliveredEffectReactions(
  action: DirectedActionV2,
  context: BattleActorExecutionContext,
): PlaybackExecutionTask {
  return createTask(async scope => {
    for (const effect of action.effects.filter(isDamageHpDrop)) {
      if (scope.cancelled || !effect.target.snapshot) return;
      const targetId = combatantEntityId(effect.target.snapshot);
      const target = getActorById(targetId);
      const lease = context.presentation.getLease(targetId, ['action', 'pose']);
      if (!target || !lease) continue;
      const direction = directionBetween(getActorById(combatantEntityId(action.actor))?.getScenePoint(), target.getScenePoint());
      const handle = scope.add(lease.play({ kind: 'hit', direction }));
      await handle.finished;
    }
  });
}

export function playActionDelivery(
  action: DirectedActionV2,
  delivery: DirectedDeliveryV2,
  context: BattleActorExecutionContext,
): PlaybackExecutionTask {
  if (delivery.type === 'none') return completedTask();
  return createTask(async scope => {
    if (!context.scene.active) throw new Error('Battle scene was replaced during delivery playback');
    const targetScene = resolveTargetScenePoint(delivery.resolvedAim, action, context);
    const targetViewport = targetScene ? context.scene.sceneToViewport(targetScene) : null;
    if (!targetViewport || scope.cancelled) return;
    if (delivery.type === 'projectile' || delivery.type === 'projectile_to_tile') {
      const attackerId = combatantEntityId(action.actor);
      const attacker = getActorById(attackerId);
      const attackerPoint = attacker?.getScenePoint();
      const startViewport = attackerPoint ? context.scene.sceneToViewport(attackerPoint) : null;
      const lease = context.presentation.getLease(attackerId, ['action', 'pose']);
      if (lease) scope.add(lease.play({ kind: 'attack', target: targetScene ?? undefined, attackKind: 'ranged' }));
      if (startViewport) {
        const projectile = scope.add(createProjectileOverlay(startViewport, targetViewport));
        await projectile.finished;
      }
    }
    if (delivery.type === 'explosion' || delivery.type === 'explosion_at_tile') {
      await scope.add(createExplosionOverlay(targetViewport)).finished;
    }
  });
}

function isImpactDelivery(type: string): boolean {
  return type === 'projectile'
    || type === 'projectile_to_tile'
    || type === 'explosion'
    || type === 'explosion_at_tile';
}

export function playCombatantJoined(
  joined: DirectedCombatantJoinedV2,
  context: BattleActorExecutionContext,
): PlaybackExecutionTask {
  const actorId = combatantEntityId(joined.combatant);
  const lease = context.presentation.getLease(actorId, ['pose']);
  return lease ? taskFromHandle(lease.play({ kind: 'join-cue' })) : completedTask();
}

export function playCombatantCleared(
  notice: DirectedNoticeV2,
  context: BattleActorExecutionContext,
): PlaybackExecutionTask {
  const combatant = notice.combatant;
  if (!combatant || (notice.reason !== 'death' && notice.reason !== 'escaped')) return completedTask();
  const actorId = combatantEntityId(combatant);
  if (notice.reason === 'death') {
    const lease = context.presentation.getLease(actorId, ['action', 'pose', 'visibility'], 'terminal');
    if (!lease) return completedTask();
    context.presentation.markTerminal(actorId);
    return taskFromHandle(lease.play({ kind: 'fall' }));
  }
  const retreatTarget = readRetreatTarget(notice);
  const retreat = notice.detail?.visual_policy === 'retreat' && retreatTarget !== null;
  const lease = context.presentation.getLease(
    actorId,
    retreat ? ['spatial', 'pose', 'visibility'] : ['visibility'],
  );
  if (!lease) return completedTask();
  context.presentation.markBattleExit(actorId, 'escaped', retreatTarget);
  return retreat ? completedTask() : taskFromHandle(lease.play({ kind: 'fade' }));
}

function readRetreatTarget(notice: DirectedNoticeV2): { pgroup: number; pls: number } | null {
  const raw = notice.detail?.retreat_target;
  const target = raw && typeof raw === 'object' ? raw as Record<string, unknown> : null;
  const pgroup = Number(target?.pgroup ?? notice.combatant?.pgroup);
  const pls = Number(target?.pls ?? notice.delta?.pls_after);
  return Number.isFinite(pgroup) && Number.isFinite(pls) ? { pgroup, pls } : null;
}

function playMoveAction(
  action: DirectedActionV2,
  context: BattleActorExecutionContext,
): PlaybackExecutionTask {
  const target = getMoveTarget(action);
  if (!target || target.pgroup === undefined || target.pls === undefined) return completedTask();
  const anchor = context.scene.resolveTile({ pgroup: target.pgroup, pls: target.pls });
  const actorId = combatantEntityId(action.actor);
  const actor = getActorById(actorId);
  if (!anchor || !actor) return completedTask();
  const from = actor.getScenePoint();
  const tier = from ? calcMoveTier(from, anchor.point, anchor.cellWidth, anchor.cellHeight) : 'long';
  const channels = tier === 'long'
    ? ['spatial', 'pose', 'visibility'] as const
    : ['spatial', 'pose'] as const;
  const lease = context.presentation.getLease(actorId, [...channels]);
  return lease ? taskFromHandle(lease.play({ kind: 'move', target: anchor, tier, hold: true })) : completedTask();
}

function playDamageAction(
  action: DirectedActionV2,
  context: BattleActorExecutionContext,
): PlaybackExecutionTask {
  return createTask(async scope => {
    const effect = action.effects.find(isDamageHpDrop);
    const defenderView = effect?.target.snapshot;
    if (!defenderView) return;
    const attackerId = combatantEntityId(action.actor);
    const defenderId = combatantEntityId(defenderView);
    const attacker = getActorById(attackerId);
    const defender = getActorById(defenderId);
    const attackerLease = context.presentation.getLease(attackerId, ['action', 'pose']);
    const defenderLease = context.presentation.getLease(defenderId, ['action', 'pose']);
    if (!attacker || !defender || !attackerLease || !defenderLease) return;
    const spec = resolveActionSpec(action.actionId);
    const attack = scope.add(attackerLease.play({
      kind: 'attack',
      target: defender.getScenePoint() ?? undefined,
      attackKind: spec.attacker.kind,
    }));
    if (isCueAnimationHandle(attack)) await attack.cue('impact');
    if (scope.cancelled) return;
    const hit = scope.add(defenderLease.play({
      kind: 'hit',
      direction: directionBetween(attacker.getScenePoint(), defender.getScenePoint()),
    }));
    await Promise.all([attack.finished, hit.finished]);
  });
}

function playAreaDamageAction(
  action: DirectedActionV2,
  context: BattleActorExecutionContext,
): PlaybackExecutionTask {
  return createTask(async scope => {
    const targets = uniqueCombatants(action.effects
      .filter(isDamageHpDrop)
      .map(effect => effect.target.snapshot)
      .filter((target): target is CombatantView => Boolean(target)));
    if (targets.length === 0) return;
    const attackerId = combatantEntityId(action.actor);
    const attacker = getActorById(attackerId);
    const attackerLease = context.presentation.getLease(attackerId, ['action', 'pose']);
    if (!attacker || !attackerLease) return;
    const primary = getActorById(combatantEntityId(targets[0]));
    const attack = scope.add(attackerLease.play({
      kind: 'attack', target: primary?.getScenePoint() ?? undefined, attackKind: 'ranged',
    }));
    if (isCueAnimationHandle(attack)) await attack.cue('impact');
    if (scope.cancelled) return;
    const hits = targets.flatMap(target => {
      const targetId = combatantEntityId(target);
      const defender = getActorById(targetId);
      const lease = context.presentation.getLease(targetId, ['action', 'pose']);
      if (!defender || !lease) return [];
      return [scope.add(lease.play({
        kind: 'hit', direction: directionBetween(attacker.getScenePoint(), defender.getScenePoint()),
      }))];
    });
    await Promise.all([attack.finished, ...hits.map(handle => handle.finished)]);
  });
}

function taskFromHandle(handle: AnimationHandle): PlaybackExecutionTask {
  return {
    finished: handle.finished.then(() => undefined),
    cancel: reason => handle.cancel(reason),
  };
}

function resolveTargetScenePoint(
  target: CombatTargetView,
  action: DirectedActionV2,
  context: BattleActorExecutionContext,
): ScenePoint | null {
  if (target.kind === 'tile' && target.pgroup !== undefined && target.pls !== undefined) {
    return context.scene.resolveTile({ pgroup: target.pgroup, pls: target.pls })?.point ?? null;
  }
  const actorId = resolveCombatTargetEntityId(target, action.actor, context.currentPid);
  return actorId ? getActorById(actorId)?.getScenePoint() ?? null : null;
}

export function resolveCombatTargetEntityId(
  target: CombatTargetView,
  actionActor: CombatantView,
  currentPid: number,
): string | null {
  if (target.kind === 'self') return combatantEntityId(actionActor);
  if (target.snapshot) return combatantEntityId(target.snapshot);
  if (!target.pid) return null;
  return target.pid === currentPid ? 'player' : `enemy-${target.pid}`;
}

function calcMoveTier(from: ScenePoint, to: ScenePoint, cellWidth: number, cellHeight: number): 'duck' | 'jump' | 'long' {
  const distance = Math.max(Math.abs(to.x - from.x) / cellWidth, Math.abs(to.y - from.y) / cellHeight);
  if (distance <= 1.5) return 'duck';
  if (distance <= 6.5) return 'jump';
  return 'long';
}

function directionBetween(source: ScenePoint | null | undefined, target: ScenePoint | null | undefined): -1 | 0 | 1 {
  if (!source || !target || source.x === target.x) return 0;
  return source.x < target.x ? 1 : -1;
}

function getMoveTarget(action: DirectedActionV2): CombatTargetView | null {
  return action.effects.find(effect =>
    effect.type === 'move' && effect.visual.kind === 'move_avatar' && effect.target.kind === 'tile')?.target
    ?? action.targets.find(target => target.kind === 'tile')
    ?? null;
}

function isDamageHpDrop(effect: DirectedEffectV2): boolean {
  if (effect.type !== 'damage' || !effect.target.snapshot) return false;
  const before = Number(effect.delta?.hp_before ?? effect.target.snapshot.hp);
  const after = Number(effect.delta?.hp_after ?? effect.target.snapshot.hp);
  return after < before;
}

function uniqueCombatants(combatants: CombatantView[]): CombatantView[] {
  const seen = new Set<string>();
  return combatants.filter(combatant => {
    const id = combatantEntityId(combatant);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function combatantEntityId(combatant: CombatantView): string {
  return combatant.type === 0 ? 'player' : `enemy-${combatant.pid}`;
}
