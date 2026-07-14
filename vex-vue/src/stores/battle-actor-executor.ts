/**
 * @module K 状态管理层
 * @framework K-1 战斗回合编排 + 演示播放管道
 */

import { nextTick } from 'vue';
import { getActorById } from '@/composables/actorRegistry';
import { isCueAnimationHandle } from '@/composables/useActorRuntime';
import { actorTraceEnabled, debugBus } from '@/composables/useDebugBus';
import {
  isExplosionDelivery,
  isProjectileDelivery,
  resolveBattleAnimationChain,
  type BattleAnimationCue,
} from '@/animations/action-specs';
import {
  createExplosionOverlay,
  createProjectileOverlay,
  createUnarmedHitPopup,
} from './battle-overlay-executor';
import type { AnimationHandle } from '@/types/actor-runtime';
import type { SceneGeometry, ScenePoint } from '@/types/scene';
import type { BattlePresentationSession } from './battle-presentation-session';
import type {
  CombatantView,
  CombatTargetView,
  DirectedActionV2,
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

export function playActionChoreography(
  action: DirectedActionV2,
  context: BattleActorExecutionContext,
): PlaybackExecutionTask {
  switch (action.animation.kind) {
    case 'move': return playMoveAction(action, context);
    case 'escape':
      return completedTask();
    default:
      break;
  }
  if (action.animation.kind === 'none'
    && action.deliveries.every(delivery => delivery.type === 'none')) return completedTask();

  const spec = resolveBattleAnimationChain(action);
  return createTask(async scope => {
    traceChoreography(action, 'choreography:start', {
      animation: action.animation,
      hitTrigger: spec.hitTrigger,
      targets: action.targets,
      deliveries: action.deliveries,
      effects: action.effects.map(effect => ({
        effectUid: effect.effectUid,
        type: effect.type,
        target: effect.target,
        delta: effect.delta,
      })),
    });
    await playCueStage('attackBefore', spec.attackBefore, action, context, scope);
    if (scope.cancelled) return;

    traceChoreography(action, 'stage:start', { stage: 'attackMain', cues: spec.attackMain ? [spec.attackMain] : [] });
    const attackMain = spec.attackMain
      ? startCue('attackMain', spec.attackMain, action, context, scope)
      : [];
    traceChoreography(action, 'stage:start', { stage: 'attackConcurrent', cues: spec.attackConcurrent });
    const attackConcurrent = startCues('attackConcurrent', spec.attackConcurrent, action, context, scope);
    const attackHandles = [...attackMain, ...attackConcurrent];

    if (spec.hitTrigger === 'attack-impact') {
      const impactHandle = attackMain.find(isCueAnimationHandle);
      if (impactHandle) await impactHandle.cue('impact');
      else await waitHandles(attackMain);
      traceChoreography(action, 'trigger:impact', { source: impactHandle ? 'actor-cue' : 'attack-main-settle' });
      if (scope.cancelled) return;
      await Promise.all([
        waitHandles(attackHandles),
        playHitSequence(spec, action, context, scope),
      ]);
      traceChoreography(action, 'stage:settle', { stage: 'attackMain+attackConcurrent' });
      if (scope.cancelled) return;
      await playCueStage('attackAfter', spec.attackAfter, action, context, scope);
      traceChoreography(action, 'choreography:settle');
      return;
    }

    await waitHandles(attackHandles);
    traceChoreography(action, 'stage:settle', { stage: 'attackMain+attackConcurrent' });
    if (scope.cancelled) return;
    await playCueStage('attackAfter', spec.attackAfter, action, context, scope);
    if (scope.cancelled) return;
    await playHitSequence(spec, action, context, scope);
    traceChoreography(action, 'choreography:settle');
  });
}

type ChoreographyStage =
  | 'attackBefore'
  | 'attackMain'
  | 'attackConcurrent'
  | 'attackAfter'
  | 'hitBefore'
  | 'hitMain'
  | 'hitConcurrent'
  | 'hitAfter';

async function playHitSequence(
  spec: ReturnType<typeof resolveBattleAnimationChain>,
  action: DirectedActionV2,
  context: BattleActorExecutionContext,
  scope: TaskScope,
): Promise<void> {
  await playCueStage('hitBefore', spec.hitBefore, action, context, scope);
  if (scope.cancelled) return;
  traceChoreography(action, 'stage:start', { stage: 'hitMain', cues: spec.hitMain ? [spec.hitMain] : [] });
  const hitMain = spec.hitMain ? startCue('hitMain', spec.hitMain, action, context, scope) : [];
  traceChoreography(action, 'stage:start', { stage: 'hitConcurrent', cues: spec.hitConcurrent });
  const hitConcurrent = startCues('hitConcurrent', spec.hitConcurrent, action, context, scope);
  await waitHandles([...hitMain, ...hitConcurrent]);
  traceChoreography(action, 'stage:settle', { stage: 'hitMain+hitConcurrent' });
  if (scope.cancelled) return;
  await playCueStage('hitAfter', spec.hitAfter, action, context, scope);
}

async function playCueStage(
  stage: ChoreographyStage,
  cues: readonly BattleAnimationCue[],
  action: DirectedActionV2,
  context: BattleActorExecutionContext,
  scope: TaskScope,
): Promise<void> {
  traceChoreography(action, 'stage:start', { stage, cues });
  await waitHandles(startCues(stage, cues, action, context, scope));
  traceChoreography(action, 'stage:settle', { stage });
}

function startCues(
  stage: ChoreographyStage,
  cues: readonly BattleAnimationCue[],
  action: DirectedActionV2,
  context: BattleActorExecutionContext,
  scope: TaskScope,
): AnimationHandle[] {
  return cues.flatMap(cue => startCue(stage, cue, action, context, scope));
}

function startCue(
  stage: ChoreographyStage,
  cue: BattleAnimationCue,
  action: DirectedActionV2,
  context: BattleActorExecutionContext,
  scope: TaskScope,
): AnimationHandle[] {
  if (scope.cancelled || !context.scene.active) return [];
  traceChoreography(action, 'cue:start', { stage, cue });
  if (cue === 'actor-melee' || cue === 'actor-ranged') {
    const attackerId = combatantEntityId(action.actor);
    const lease = context.presentation.getLease(attackerId, ['action', 'pose']);
    if (!lease) return [];
    const target = resolvePrimaryTargetScenePoint(action, context);
    const handle = scope.add(lease.play({
      kind: 'attack',
      target: target ?? undefined,
      attackKind: cue === 'actor-melee' ? 'melee' : 'ranged',
    }));
    traceHandle(action, stage, cue, handle, { target });
    return [handle];
  }
  if (cue === 'target-hit') return startTargetHits(action, context, scope);
  if (cue === 'projectile-delivery') return startProjectileDeliveries(action, context, scope);
  if (cue === 'unarmed-hit-popup') return startUnarmedHitPopups(action, context, scope);
  return startExplosionDeliveries(action, context, scope);
}

function startTargetHits(
  action: DirectedActionV2,
  context: BattleActorExecutionContext,
  scope: TaskScope,
): AnimationHandle[] {
  const attacker = getActorById(combatantEntityId(action.actor));
  const targets = damagedCombatants(action);
  return targets.flatMap(targetView => {
    const target = getActorById(combatantEntityId(targetView));
    const lease = context.presentation.getLease(combatantEntityId(targetView), ['action', 'pose']);
    if (!target || !lease) return [];
    const handle = scope.add(lease.play({
      kind: 'hit',
      direction: directionBetween(attacker?.getScenePoint(), target.getScenePoint()),
    }));
    traceHandle(action, 'hitMain', 'target-hit', handle, {
      targetId: combatantEntityId(targetView),
      targetPid: targetView.pid,
    });
    return [handle];
  });
}

function startUnarmedHitPopups(
  action: DirectedActionV2,
  context: BattleActorExecutionContext,
  scope: TaskScope,
): AnimationHandle[] {
  return damagedCombatants(action).flatMap(targetView => {
    const targetId = combatantEntityId(targetView);
    const point = getActorById(targetId)?.getScenePoint();
    const at = point ? context.scene.sceneToViewport(point) : null;
    if (!at) return [];
    const handle = scope.add(createUnarmedHitPopup(at));
    traceHandle(action, 'hitConcurrent', 'unarmed-hit-popup', handle, {
      targetId,
      targetPid: targetView.pid,
      at,
    });
    return [handle];
  });
}

function startProjectileDeliveries(
  action: DirectedActionV2,
  context: BattleActorExecutionContext,
  scope: TaskScope,
): AnimationHandle[] {
  const attackerPoint = getActorById(combatantEntityId(action.actor))?.getScenePoint();
  const from = attackerPoint ? context.scene.sceneToViewport(attackerPoint) : null;
  if (!from) return [];
  return action.deliveries.filter(delivery => isProjectileDelivery(delivery.type)).flatMap(delivery => {
    const target = resolveTargetScenePoint(delivery.resolvedAim, action, context);
    const to = target ? context.scene.sceneToViewport(target) : null;
    if (!to) return [];
    const handle = scope.add(createProjectileOverlay(from, to));
    traceHandle(action, 'attackAfter', 'projectile-delivery', handle, {
      rawLogId: delivery.rawLogId,
      resolvedAim: delivery.resolvedAim,
      from,
      to,
    });
    return [handle];
  });
}

function startExplosionDeliveries(
  action: DirectedActionV2,
  context: BattleActorExecutionContext,
  scope: TaskScope,
): AnimationHandle[] {
  return action.deliveries.filter(delivery => isExplosionDelivery(delivery.type)).flatMap(delivery => {
    const target = resolveTargetScenePoint(delivery.resolvedAim, action, context);
    const at = target ? context.scene.sceneToViewport(target) : null;
    if (!at) return [];
    const handle = scope.add(createExplosionOverlay(at));
    traceHandle(action, 'hitConcurrent', 'explosion-delivery', handle, {
      rawLogId: delivery.rawLogId,
      resolvedAim: delivery.resolvedAim,
      at,
    });
    return [handle];
  });
}

function waitHandles(handles: readonly AnimationHandle[]): Promise<void> {
  return Promise.all(handles.map(handle => handle.finished)).then(() => undefined);
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

function taskFromHandle(handle: AnimationHandle): PlaybackExecutionTask {
  return {
    finished: handle.finished.then(() => undefined),
    cancel: reason => handle.cancel(reason),
  };
}

function resolvePrimaryTargetScenePoint(
  action: DirectedActionV2,
  context: BattleActorExecutionContext,
): ScenePoint | null {
  const target = action.targets.find(candidate => candidate.kind !== 'none')
    ?? action.deliveries.find(delivery => delivery.type !== 'none')?.resolvedAim
    ?? action.effects.find(effect => effect.target.kind !== 'none')?.target;
  return target ? resolveTargetScenePoint(target, action, context) : null;
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

function damagedCombatants(action: DirectedActionV2): CombatantView[] {
  return uniqueCombatants(action.effects
    .filter(isDamageHpDrop)
    .map(effect => effect.target.snapshot)
    .filter((target): target is CombatantView => Boolean(target)));
}

function traceHandle(
  action: DirectedActionV2,
  stage: ChoreographyStage,
  cue: BattleAnimationCue,
  handle: AnimationHandle,
  data: Record<string, unknown>,
): void {
  traceChoreography(action, 'handle:start', { stage, cue, ...data });
  void handle.finished.then(result => {
    traceChoreography(action, 'handle:settle', { stage, cue, result, ...data });
  });
}

function traceChoreography(
  action: DirectedActionV2,
  step: string,
  data: Record<string, unknown> = {},
): void {
  if (!actorTraceEnabled) return;
  const entry = {
    ts: Date.now(),
    batchSeq: (globalThis as Record<string, unknown>).__battleChoreographyActiveBatchV1 ?? null,
    step,
    actionUid: action.actionUid,
    actionId: action.actionId,
    actorPid: action.actor.pid,
    ...data,
  };
  debugBus.emit('battle-choreography', step, entry);
  const root = globalThis as Record<string, unknown>;
  const trace = Array.isArray(root.__battleChoreographyTraceV1)
    ? root.__battleChoreographyTraceV1 as unknown[]
    : [];
  trace.push(entry);
  if (trace.length > 400) trace.splice(0, trace.length - 400);
  root.__battleChoreographyTraceV1 = trace;
}
