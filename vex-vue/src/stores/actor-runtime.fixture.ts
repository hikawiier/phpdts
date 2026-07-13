import { createActorRuntime } from '@/composables/useActorRuntime';
import { createMapSceneGeometry } from '@/composables/mapSceneGeometry';
import { getSceneGeometry, registerSceneGeometry } from '@/composables/sceneRegistry';
import { registerActor, unregisterActor } from '@/composables/actorRegistry';
import { createBattlePresentationSession } from '@/stores/battle-presentation-session';
import { resolveCombatTargetEntityId } from '@/stores/battle-actor-executor';
import { runBattlePlaybackPlan } from '@/stores/battle-playback-runner';
import { DataManager } from '@/stores/data-manager';
import { ref } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { usePresentationSceneStore } from '@/stores/presentation-scene';
import { useCharacterStore } from '@/stores/character';
import { useEntitiesStore } from '@/stores/entities';
import { ingestPresentationResponse, presentationInbox } from '@/stores/presentation-inbox';
import {
  createCancellableProjectedRemoval,
  isRegionTransition,
  isScenePointAtAnchor,
} from '@/composables/useMapEntities';
import { closePresentationSessionOwnership } from '@/stores/battle';
import type { ApiResponse } from '@/api/client';
import type { ActorElements } from '@/types/actor-runtime';
import type { AnimationResult, PresentationLease } from '@/types/actor-runtime';
import type { SceneAnchor } from '@/types/scene';
import type { BattlePlaybackPlan, BattleSegmentV2 } from '@/stores/battle-director-v2';
import type { BattlePresentationSession } from '@/stores/battle-presentation-session';
import type { MapEntity } from '@/types/map-entity';

function anchor(pgroup: number, pls: number, x: number, y: number): SceneAnchor {
  return {
    tile: { pgroup, pls },
    point: { space: 'scene', x, y },
    cellWidth: 48,
    cellHeight: 36,
  };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function assertActorRuntimeContractFixture(): void {
  assertLeaseAndPendingAnchorContract();
  assertLeasePriorityAndReuseContract();
  assertGenerationAndDisposeContract();
  assertRemovalContract();
  assertTransformChannelIsolationContract();
  assertMoveRefStabilityContract();
  assertInitialEnterPreemptionContract();
  assertPostureAndEscapeContract();
  assertTerminalAbortContract();
  assertCombatTargetResolutionContract();
  assertRegionTransitionContract();
}

export async function assertDataManagerRefreshContractFixture(): Promise<void> {
  const pending: Array<(response: ApiResponse) => void> = [];
  let requestCount = 0;
  const manager = new DataManager(() => {
    requestCount += 1;
    return new Promise<ApiResponse>(resolve => pending.push(resolve));
  });
  const older = manager.fetch('game_map', true);
  const newer = manager.fetch('game_map', true);
  assert(requestCount === 2, 'force refresh reused an older pending cacheable request');

  pending[1]({ status: 'success', data: { version: 2 } });
  await newer;
  pending[0]({ status: 'success', data: { version: 1 } });
  await older;

  const cached = await manager.fetch('game_map');
  assert((cached.data as { version?: number })?.version === 2,
    'older cacheable response overwrote the newer forced refresh');
}

export async function assertPlaybackSceneGuardFixture(): Promise<void> {
  let active = true;
  const segment: BattleSegmentV2 = { kind: 'system', actions: [], notices: [] };
  const plan: BattlePlaybackPlan = {
    schema: 'battleplayback.v1',
    script: { schema: 'battleplay.v2', segments: [segment], rawLogIds: [] },
    steps: [{ id: 'scene-guard', kind: 'segment_context', awaitPolicy: 'completion', segment }],
  };
  const scene = {
    generation: 1,
    get active() { return active; },
    projectionRevision: 1,
    resolveTile: () => null,
    sceneToViewport: () => null,
    elementCenterToViewport: () => ({ space: 'viewport' as const, x: 0, y: 0 }),
  };
  const presentation = {
    id: 'fixture', qid: 1, active: true, sealed: false,
    getLease: () => null,
    markTerminal: () => {},
    markBattleExit: () => {},
    sealForHandoff: () => [],
    startCommit: () => ({ sessionId: 'fixture', finished: Promise.resolve(), cancel: () => {} }),
    commit: async () => {},
    abort: () => {},
  } as BattlePresentationSession;

  const playback = runBattlePlaybackPlan(plan, {
    currentPid: 1,
    npcPid: 2,
    scene,
    presentation,
    updateSegmentContext: () => new Promise<void>(() => {}),
    playSegmentText: async () => {},
    enterBattleEndMask: async () => {},
    handoffPresentationScene: async () => {},
    playBattleEndContent: async () => {},
  });
  setTimeout(() => { active = false; }, 5);
  let rejected = false;
  try {
    await playback;
  } catch (error) {
    rejected = error instanceof Error && error.message.includes('scene');
  }
  assert(rejected, 'scene replacement did not cancel and reject the active playback step');
}

export async function assertPlaybackTimeoutCancellationFixture(): Promise<void> {
  const segment: BattleSegmentV2 = { kind: 'turn', actions: [], notices: [] };
  const combatant = { id: 'enemy-3', pid: 3, type: 1, name: 'enemy', hp: 10, mhp: 10 };
  const notice = {
    type: 'combatant_cleared' as const,
    rawLogId: 1,
    combatant,
    reason: 'death',
    text: { html: 'enemy cleared', tone: 'system' as const },
  };
  const plan: BattlePlaybackPlan = {
    schema: 'battleplayback.v1',
    script: { schema: 'battleplay.v2', segments: [segment], rawLogIds: [1] },
    steps: [{
      id: 'timeout-cancel', kind: 'combatant_cleared', awaitPolicy: 'completion', timeout: 5,
      segment, notice,
    }],
  };
  let cancelled = false;
  let finish!: (result: AnimationResult) => void;
  const finished = new Promise<AnimationResult>(resolve => { finish = resolve; });
  const lease = {
    actorId: 'enemy-3', owner: 'battle', sessionId: 'fixture',
    channels: new Set(['pose']), released: false,
    play: () => ({
      finished,
      cancel: (reason = 'cancelled') => {
        cancelled = true;
        finish({ status: 'cancelled', reason });
      },
    }),
    release: () => {},
  } as PresentationLease;
  const presentation = {
    id: 'fixture', qid: 1, active: true, sealed: false,
    getLease: () => lease,
    markTerminal: () => {},
    markBattleExit: () => {},
    sealForHandoff: () => [],
    startCommit: () => ({ sessionId: 'fixture', finished: Promise.resolve(), cancel: () => {} }),
    commit: async () => {},
    abort: () => {},
  } as BattlePresentationSession;
  const scene = {
    generation: 1, active: true, projectionRevision: 1,
    resolveTile: () => null,
    sceneToViewport: () => null,
    elementCenterToViewport: () => ({ space: 'viewport' as const, x: 0, y: 0 }),
  };

  await runBattlePlaybackPlan(plan, {
    currentPid: 1,
    npcPid: 3,
    scene,
    presentation,
    updateSegmentContext: async () => {},
    playSegmentText: async () => {},
    enterBattleEndMask: async () => {},
    handoffPresentationScene: async () => {},
    playBattleEndContent: async () => {},
  });
  assert(cancelled, 'playback timeout released the step without cancelling its animation handle');
}

export async function assertBattleEndParallelBarrierFixture(): Promise<void> {
  const segment: BattleSegmentV2 = { kind: 'battle_end', actions: [], notices: [] };
  const plan: BattlePlaybackPlan = {
    schema: 'battleplayback.v1',
    script: { schema: 'battleplay.v2', segments: [segment], rawLogIds: [] },
    steps: [
      { id: 'overlay', kind: 'battle_end_overlay_enter', awaitPolicy: 'completion', segment },
      { id: 'handoff', kind: 'presentation_scene_handoff', awaitPolicy: 'completion', segment },
      { id: 'content', kind: 'battle_end_modal_content', awaitPolicy: 'completion', segment },
    ],
  };
  let finishHandoff!: () => void;
  let finishModal!: () => void;
  let handoffSettled = false;
  let contentStarted = false;
  const handoffFinished = new Promise<void>(resolve => {
    finishHandoff = () => { handoffSettled = true; resolve(); };
  });
  const modalClosed = new Promise<void>(resolve => { finishModal = resolve; });
  const presentation = {
    id: 'battle-end-parallel', qid: 1, active: true, sealed: false,
    getLease: () => null,
    markTerminal: () => {},
    markBattleExit: () => {},
    sealForHandoff: () => [],
    startCommit: () => ({ sessionId: 'battle-end-parallel', finished: handoffFinished, cancel: () => {} }),
    commit: async () => {},
    abort: () => {},
  } as BattlePresentationSession;
  const playback = runBattlePlaybackPlan(plan, {
    currentPid: 1,
    npcPid: 2,
    scene: {
      generation: 1, active: true, projectionRevision: 1,
      resolveTile: () => null,
      sceneToViewport: () => null,
      elementCenterToViewport: () => ({ space: 'viewport' as const, x: 0, y: 0 }),
    },
    presentation,
    updateSegmentContext: async () => {},
    playSegmentText: async () => {},
    enterBattleEndMask: async () => {},
    handoffPresentationScene: async () => {},
    playBattleEndContent: async () => {
      contentStarted = true;
      assert(!handoffSettled, 'battle-end content waited for handoff animation before starting');
      await Promise.all([modalClosed, handoffFinished]);
    },
  });
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  assert(contentStarted, 'battle-end content did not start after handoff launch');
  finishModal();
  finishHandoff();
  await playback;
}

export function assertMapSceneGeometryFixture(): void {
  const cell = {
    offsetLeft: 20,
    offsetTop: 30,
    offsetWidth: 40,
    offsetHeight: 50,
    offsetParent: null as HTMLElement | null,
    getBoundingClientRect: () => ({ left: 50, top: 110, width: 80, height: 150 }),
  } as unknown as HTMLElement;
  const grid = {
    offsetWidth: 200,
    offsetHeight: 100,
    querySelector: (selector: string) => selector === '[data-pls="1001"]' ? cell : null,
    getBoundingClientRect: () => ({ left: 10, top: 20, width: 400, height: 300 }),
  } as unknown as HTMLElement;
  Object.defineProperty(cell, 'offsetParent', { value: grid });

  const gridRef = ref<HTMLElement | null>(grid);
  const region = ref<string | number | null>('2');
  const revision = ref(7);
  const geometry = createMapSceneGeometry(gridRef, region, revision);

  assert(geometry.resolveTile({ pgroup: 1, pls: 1001 }) === null,
    'scene geometry accepted a tile from another region');
  assert(geometry.resolveTile({ pgroup: 2, pls: 9999 }) === null,
    'scene geometry resolved a missing tile');

  const resolved = geometry.resolveTile({ pgroup: 2, pls: 1001 });
  assert(resolved, 'scene geometry did not resolve the active-region tile');
  assert(resolved.point.x === 40 && resolved.point.y === 80,
    'scene anchor was not the tile bottom center');
  assert(resolved.cellWidth === 40 && resolved.cellHeight === 50,
    'scene anchor did not preserve cell dimensions');
  assert(geometry.projectionRevision === 7,
    'scene geometry did not expose the projection revision');

  const viewport = geometry.sceneToViewport(resolved.point);
  assert(viewport?.x === 90 && viewport.y === 260,
    'scene-to-viewport conversion did not apply independent axis scaling');

  const unregister = registerSceneGeometry(geometry);
  const registered = getSceneGeometry();
  assert(registered?.active, 'registered scene was not active');
  unregister();
  assert(Boolean(registered.active) === false, 'unregistered scene remained active');
}

export async function assertPostCombatHandoffRunFixture(): Promise<void> {
  const runtime = createActorRuntime('enemy-88');
  runtime.setElements(createActorElements());
  runtime.projectAnchor({
    tile: { pgroup: 1, pls: 1 },
    point: { space: 'scene', x: 10, y: 10 },
    cellWidth: 40,
    cellHeight: 40,
  });
  registerActor(runtime.id, runtime);
  const session = createBattlePresentationSession(10);
  const lease = session.getLease(runtime.id, ['visibility']);
  assert(lease, 'post-combat fixture lease was not acquired');
  session.markBattleExit(runtime.id);
  session.sealForHandoff();
  const run = session.startCommit([{
    actorId: runtime.id,
    generation: runtime.generation,
    reason: 'escaped',
    from: { pgroup: 1, pls: 1 },
    fromPoint: { space: 'scene', x: 10, y: 10 },
    retreatTarget: null,
    target: { pgroup: 1, pls: 1 },
    visualPolicy: 'settle-in-place',
  }]);
  let settled = false;
  void run.finished.then(() => { settled = true; });
  assert(!settled, 'post-combat run completed synchronously instead of exposing its barrier');
  run.cancel('fixture_cancel');
  await run.finished;
  assert(settled, 'post-combat run did not settle after cancellation');
  assert(lease.released, 'post-combat run did not release its presentation lease');
  unregisterActor(runtime.id);
}

export async function assertPresentationRebaseMoveFixture(): Promise<void> {
  setActivePinia(createPinia());
  const scene = usePresentationSceneStore();
  const entity = (id: string, pls: number) => ({
    id, kind: 'actor' as const, pgroup: 1, pls, img: '',
  });
  scene.syncAuthoritative([entity('moving', 1), entity('stable', 2), entity('exit', 3)], 1);
  scene.beginPlayback();
  const playingRevision = scene.snapshot.revision;
  scene.syncAuthoritative([entity('moving', 4), entity('stable', 2), entity('exit', 5)], 2);
  assert(scene.snapshot.revision === playingRevision && Number(scene.snapshot.entities[0]?.pls) === 1,
    'authoritative refresh mutated the playing presentation scene');
  scene.beginRebase(
    [entity('moving', 4), entity('stable', 2), entity('exit', 5)],
    2,
    [{
      actorId: 'exit', generation: 1, reason: 'escaped',
      from: { pgroup: 1, pls: 3 }, fromPoint: null,
      retreatTarget: { pgroup: 1, pls: 5 },
    }],
  );
  assert(scene.snapshot.authoritativeRevision === 2 && Number(scene.snapshot.entities[0]?.pls) === 4,
    'presentation handoff did not publish the latest authoritative snapshot');
  assert(scene.shouldAnimateRebaseActor('moving'), 'ordinary authoritative position diff was not planned');
  assert(!scene.shouldAnimateRebaseActor('stable'), 'unchanged ordinary actor received a rebase move');
  assert(!scene.shouldAnimateRebaseActor('exit'), 'battle exit actor leaked into ordinary rebase moves');
  scene.syncAuthoritative(
    [entity('moving', 6), entity('stable', 2), entity('exit', 5)],
    3,
  );
  assert(scene.snapshot.authoritativeRevision === 2,
    'authority update published through the active rebase guard');
  const token = scene.rebaseToken;
  assert(token !== null, 'rebase token was not created');

  function fakeRun(actorId: string, generation: number, runToken: number) {
    let resolve!: () => void;
    let cancelled = false;
    const finished = new Promise<void>(done => { resolve = done; });
    return {
      actorId, generation, token: runToken, finished,
      cancel() { cancelled = true; resolve(); },
      finish() { resolve(); },
      get cancelled() { return cancelled; },
    };
  }

  const first = fakeRun('moving', 1, token!);
  assert(scene.registerRebaseMove(first), 'ordinary rebase move registration was rejected');
  const replacement = fakeRun('moving', 2, token!);
  assert(scene.registerRebaseMove(replacement), 'new actor generation did not replace stale rebase move');
  assert(first.cancelled, 'stale actor generation rebase move was not cancelled');
  const barrier = scene.sealRebaseMoves(token!);
  const late = fakeRun('moving', 3, token!);
  assert(!scene.registerRebaseMove(late) && late.cancelled,
    'sealed rebase accepted a late generation registration');
  let barrierSettled = false;
  void barrier.finished.then(() => { barrierSettled = true; });
  assert(!barrierSettled, 'rebase move barrier ignored the active generation');
  barrier.cancel('fixture_cancel');
  await barrier.finished;
  assert(barrierSettled && replacement.cancelled, 'rebase move cancellation did not settle the barrier');
  scene.finishRebase();
  assert(Number(scene.snapshot.authoritativeRevision) === 3 && Number(scene.snapshot.entities[0]?.pls) === 6,
    'rebase completion did not publish authority that advanced during animation');
}

export function assertCharacterMapRosterFixture(): void {
  setActivePinia(createPinia());
  const characters = useCharacterStore();
  const entities = useEntitiesStore();
  const enemy = (discovered: string | number, pls = 2) => ({
    pid: '22', type: '1', name: 'visibility-fixture', gd: 'm', icon: '0',
    action: '', bid: '0', hp: '100', mhp: '100', sp: '100', msp: '100',
    att: '10', def: '0', ap: '10', max_ap: '10', pgroup: '1', pls: String(pls),
    lvl: '1', exp: '0', state: '0', itemmaxslots: '6',
    wepid: '', wep2id: '', arbid: '', arhid: '', araid: '', arfid: '', artid: '',
    itemIds: [], discovered,
  });

  characters.replaceMapEnemies([enemy('1')]);
  assert(entities.entities.some(entity => entity.id === 'enemy-22'),
    'discovered enemy was missing from the authoritative map roster');

  characters.replaceMapEnemies([]);
  assert(characters.getCharacter(22) !== undefined,
    'hidden enemy profile was deleted instead of leaving the map roster');
  assert(!entities.entities.some(entity => entity.id === 'enemy-22'),
    'same-region enemy missing from the enemies snapshot remained visible');

  characters.mergeEnemyPatches([enemy('1', 3)]);
  assert(!entities.entities.some(entity => entity.id === 'enemy-22'),
    'combat candidate/profile patch polluted the authoritative map roster');

  characters.replaceMapEnemies([enemy('0', 3)]);
  assert(characters.getCharacter(22)?.discovered === false,
    'string discovered=0 was normalized as visible');
  assert(entities.entities.some(entity => entity.id === 'enemy-22'),
    'combat-visible enemy returned by the enemies roster was incorrectly filtered out');
}

export function assertPresentationClaimFixture(): void {
  setActivePinia(createPinia());
  const scene = usePresentationSceneStore();
  presentationInbox.reset();
  presentationInbox.initialize(0);
  const accepted = ingestPresentationResponse({
    presentation_head_seq: 1,
    presentation: {
      schema: 'presentation.v1', batch_seq: 1, groomid: 1, recipient_pid: 1,
      qid: 1, request_id: 'claim-fixture', tick: 1,
      state_after: {
        pid: 1, action: 'battle', bid: 1, battle_state: 'PROCESSING',
        pgroup: 1, pls: 1, state: 0, hp: 100, ap: 10,
      },
      events: [],
    },
  });
  assert(accepted && scene.phase === 'playing',
    'accepted live batch did not claim the presentation scene before authority refresh');
  assert(!ingestPresentationResponse({
    presentation_head_seq: 1,
    presentation: {
      schema: 'presentation.v1', batch_seq: 1, groomid: 1, recipient_pid: 1,
      qid: 1, request_id: 'claim-fixture', tick: 1,
      state_after: {
        pid: 1, action: 'battle', bid: 1, battle_state: 'PROCESSING',
        pgroup: 1, pls: 1, state: 0, hp: 100, ap: 10,
      },
      events: [],
    },
  }), 'duplicate batch claimed the scene twice');
  presentationInbox.reset();
  scene.reset();

  const target = anchor(1, 2, 48, 72);
  assert(isScenePointAtAnchor({ x: 48, y: 72 }, target),
    'rebase move did not recognize an actor already at the authoritative anchor');
  assert(!isScenePointAtAnchor({ x: 12, y: 72 }, target),
    'rebase move treated a real position delta as zero distance');
}

export async function assertProjectedRemovalRediscoveryFixture(): Promise<void> {
  function deferredHandle() {
    let finish!: (result: AnimationResult) => void;
    const finished = new Promise<AnimationResult>(resolve => { finish = resolve; });
    return {
      handle: { finished, cancel: () => {} },
      finish: () => finish({ status: 'completed' }),
    };
  }

  let firstRemoved = 0;
  let firstRecovered = 0;
  const firstHandle = deferredHandle();
  const first = createCancellableProjectedRemoval(firstHandle.handle, {
    complete: () => { firstRemoved += 1; },
    cancel: recover => { if (recover) firstRecovered += 1; },
  });

  first.cancel('entity_rediscovered');
  const secondHandle = deferredHandle();
  let secondRemoved = 0;
  const second = createCancellableProjectedRemoval(secondHandle.handle, {
    complete: () => { secondRemoved += 1; },
    cancel: () => {},
  });

  firstHandle.finish();
  await first.finished;
  assert(firstRecovered === 1, 'rediscovery did not request visibility recovery');
  assert(firstRemoved === 0,
    'cancelled projected removal deleted a newer projection after its stale fade completed');

  secondHandle.finish();
  await second.finished;
  assert(secondRemoved === 1, 'current projected removal did not complete normally');
}

export function assertQidChangeSessionOwnershipFixture(): void {
  let abortCalled = false;
  let ownerCleared = false;
  const session = {
    id: 'qid-change', qid: 1, active: true, sealed: false,
    getLease: () => null,
    markTerminal: () => {},
    markBattleExit: () => {},
    sealForHandoff: () => [],
    startCommit: () => ({ sessionId: 'qid-change', finished: Promise.resolve(), cancel: () => {} }),
    commit: async () => {},
    abort: () => { abortCalled = true; },
  } as BattlePresentationSession;
  closePresentationSessionOwnership(session, () => { ownerCleared = true; }, 'qid_changed');
  assert(ownerCleared && abortCalled,
    'qid change did not close the captured session after pending ownership cleared');
}

function assertLeaseAndPendingAnchorContract(): void {
  const runtime = createActorRuntime('enemy-7');
  const initial = anchor(1, 1001, 24, 36);
  const intermediate = anchor(1, 1002, 72, 36);
  const latest = anchor(1, 1003, 120, 36);
  runtime.projectAnchor(initial);

  const battleLease = runtime.acquire({
    owner: 'battle',
    channels: ['spatial', 'action'],
    sessionId: 'battle-17',
  });
  assert(battleLease, 'battle lease was not acquired');
  assert(runtime.acquire({ owner: 'world', channels: ['spatial'] }) === null,
    'lower-priority spatial lease was acquired');
  assert(runtime.acquire({ owner: 'ambient', channels: ['pose'] }) !== null,
    'independent pose lease was rejected');

  runtime.projectAnchor(intermediate);
  runtime.projectAnchor(latest);
  let point = runtime.getScenePoint();
  assert(point?.x === initial.point.x && point.y === initial.point.y,
    'leased spatial channel applied projection early');

  battleLease.release({ reconcile: true });
  point = runtime.getScenePoint();
  assert(battleLease.released, 'lease did not report released state');
  assert(point?.x === latest.point.x && point.y === latest.point.y,
    'lease release did not reconcile the latest pending anchor');
}

function assertLeasePriorityAndReuseContract(): void {
  const runtime = createActorRuntime('enemy-8');
  const worldLease = runtime.acquire({
    owner: 'world',
    channels: ['spatial'],
    sessionId: 'world-1',
  });
  assert(worldLease, 'world lease was not acquired');

  const reusedWorldLease = runtime.acquire({
    owner: 'world',
    channels: ['pose'],
    sessionId: 'world-1',
  });
  assert(reusedWorldLease === worldLease && worldLease.channels.has('pose'),
    'same owner/session did not extend the existing lease');

  const battleLease = runtime.acquire({
    owner: 'battle',
    channels: ['spatial'],
    sessionId: 'battle-18',
  });
  assert(battleLease, 'higher-priority battle lease did not preempt world');
  assert(worldLease.released, 'preempted world lease was not released');
  assert(runtime.acquire({ owner: 'world', channels: ['spatial'], sessionId: 'world-2' }) === null,
    'lower-priority lease displaced an active battle lease');
}

function assertGenerationAndDisposeContract(): void {
  const oldRuntime = createActorRuntime('enemy-9');
  const replacementRuntime = createActorRuntime('enemy-9');
  assert(replacementRuntime.generation > oldRuntime.generation,
    'actor runtime generation was not monotonic');

  oldRuntime.dispose();
  assert(oldRuntime.disposed, 'disposed runtime did not expose disposed state');
  assert(oldRuntime.acquire({ owner: 'battle', channels: ['spatial'] }) === null,
    'disposed runtime accepted a new lease');
  assert(replacementRuntime.acquire({ owner: 'battle', channels: ['spatial'] }) !== null,
    'replacement generation could not acquire a lease');
}

function assertRemovalContract(): void {
  const runtime = createActorRuntime('enemy-10');
  assert(runtime.consumeRemovalDisposition() === 'projected',
    'ordinary projection removal did not use projected disposition');
  assert(runtime.consumeRemovalDisposition() === 'immediate',
    'removal disposition was not consumed exactly once');

  runtime.markRemovalAnimated('battle-22');
  assert(runtime.consumeRemovalDisposition() === 'animated',
    'playback-owned removal was not consumed as animated');
  assert(runtime.consumeRemovalDisposition() === 'immediate',
    'animated removal disposition was consumed more than once');

  runtime.markBattleExitAnimated('battle-22');
  assert(!runtime.consumeBattleExitAnimated('battle-21'),
    'battle exit marker leaked across sessions');
  assert(runtime.consumeBattleExitAnimated('battle-22'),
    'matching battle exit marker was not consumed');
  assert(!runtime.consumeBattleExitAnimated('battle-22'),
    'battle exit marker was consumed more than once');
}

function assertTransformChannelIsolationContract(): void {
  const runtime = createActorRuntime('enemy-11');
  const initial = anchor(3, 2001, 80, 96);
  const latest = anchor(3, 2002, 128, 96);
  runtime.projectAnchor(initial);
  runtime.setElements(createActorElements());
  assertScenePoint(runtime.getScenePoint(), initial, 'setElements changed the projected anchor');

  const idleLease = runtime.acquire({
    owner: 'ambient',
    channels: ['pose'],
    sessionId: 'ambient-11',
  });
  assert(idleLease, 'idle lease was not acquired');
  const idleHandle = idleLease.play({ kind: 'idle' });
  assertScenePoint(runtime.getScenePoint(), initial, 'idle animation changed the anchor channel');
  idleHandle.cancel('fixture');

  const battleLease = runtime.acquire({
    owner: 'battle',
    channels: ['action', 'pose', 'spatial'],
    sessionId: 'battle-23',
  });
  assert(battleLease, 'battle animation lease was not acquired');

  const hitHandle = battleLease.play({ kind: 'hit', direction: 1 });
  assertScenePoint(runtime.getScenePoint(), initial, 'hit animation changed the anchor channel');
  hitHandle.cancel('fixture');

  const attackHandle = battleLease.play({
    kind: 'attack',
    target: { space: 'scene', x: 160, y: 96 },
    attackKind: 'melee',
  });
  assertScenePoint(runtime.getScenePoint(), initial, 'attack animation changed the anchor channel');
  attackHandle.cancel('fixture');

  runtime.projectAnchor(latest);
  assertScenePoint(runtime.getScenePoint(), initial,
    'spatial projection bypassed an active battle lease');
  battleLease.release({ reconcile: true });
  assertScenePoint(runtime.getScenePoint(), latest,
    'spatial lease release did not reconcile the pending anchor');
  runtime.dispose();
}

function assertMoveRefStabilityContract(): void {
  const runtime = createActorRuntime('enemy-12');
  const initial = anchor(3, 3001, 80, 96);
  const target = anchor(3, 3002, 128, 96);
  const elements = createActorElements();
  runtime.projectAnchor(initial);
  runtime.setElements(elements);
  const lease = runtime.acquire({
    owner: 'world', channels: ['spatial', 'pose'], sessionId: 'world-ref-stability',
  });
  assert(lease, 'world move lease was not acquired');
  runtime.projectAnchor(target);
  const move = lease.play({ kind: 'move', target, tier: 'duck' });

  runtime.setElements({ ...elements });
  const reboundPoint = runtime.getScenePoint();
  assert(reboundPoint?.x !== target.point.x,
    'same actor DOM ref rebound snapped an active move to its target');

  move.cancel('fixture');
  lease.release({ reconcile: false });
  const cancelledPoint = runtime.getScenePoint();
  assert(cancelledPoint?.x !== target.point.x,
    'cancelled move committed its target anchor');
  runtime.dispose();
}

function assertInitialEnterPreemptionContract(): void {
  const runtime = createActorRuntime('enemy-13');
  const initial = anchor(3, 4001, 80, 96);
  const target = anchor(3, 4002, 128, 96);
  runtime.projectAnchor(initial);
  runtime.setElements(createActorElements());

  const idleLease = runtime.acquire({
    owner: 'ambient', channels: ['pose'], sessionId: 'initial-idle',
  });
  assert(idleLease, 'initial ambient idle lease was not acquired');
  const idle = idleLease.play({ kind: 'idle' });

  const enterLease = runtime.acquire({
    owner: 'world', channels: ['pose', 'visibility'], sessionId: 'initial-enter',
  });
  assert(enterLease, 'initial world enter lease was not acquired');
  assert(idleLease.released, 'world enter did not preempt initialization idle');
  const enter = enterLease.play({ kind: 'enter' });

  const moveLease = runtime.acquire({
    owner: 'world', channels: ['spatial', 'pose', 'visibility'], sessionId: 'first-world-move',
    replaceEqualOwner: true,
  });
  assert(moveLease, 'first world move could not preempt the initial enter lease');
  assert(enterLease.released, 'preempted initial enter lease remained active');
  runtime.projectAnchor(target);
  const visible = moveLease.play({ kind: 'reset-visible' });
  const move = moveLease.play({ kind: 'move', target, tier: 'duck' });
  assert(!moveLease.released, 'first world move lease released before playback');

  idle.cancel('fixture');
  enter.cancel('fixture');
  visible.cancel('fixture');
  move.cancel('fixture');
  moveLease.release({ reconcile: true });
  assertScenePoint(runtime.getScenePoint(), target,
    'first world move did not reconcile its authoritative target');
  runtime.dispose();
}

function assertPostureAndEscapeContract(): void {
  const runtime = createActorRuntime('player');
  const elements = createActorElements();
  runtime.setElements(elements);

  runtime.markDown();
  runtime.recoverPresentation();
  const downLease = runtime.acquire({ owner: 'world', channels: ['pose'], sessionId: 'down' });
  assert(downLease, 'down posture lease was not acquired');
  downLease.release();
  assert(Number((elements.pose as unknown as { rotation: number }).rotation) === -90,
    'releasing a non-terminal fall restored standing idle');

  runtime.markStanding();
  runtime.recoverPresentation();
  const fleeLease = runtime.acquire({ owner: 'world', channels: ['visibility'], sessionId: 'flee' });
  assert(fleeLease, 'flee visibility lease was not acquired');
  fleeLease.release();
  const enterLease = runtime.acquire({
    owner: 'world', channels: ['pose', 'visibility'], sessionId: 'enter-after-flee',
  });
  assert(enterLease, 'released flee presentation blocked the following enter animation');
  enterLease.release();
  runtime.dispose();
}

function assertTerminalAbortContract(): void {
  const runtime = createActorRuntime('enemy-77');
  const elements = createActorElements();
  runtime.setElements(elements);
  runtime.markDown();
  runtime.recoverPresentation();
  registerActor(runtime.id, runtime);

  const session = createBattlePresentationSession(9);
  assert(session.getLease(runtime.id, ['pose', 'visibility'], 'terminal'),
    'terminal presentation lease was not acquired');
  session.markTerminal(runtime.id);
  session.abort('fixture');
  assert(Number((elements.pose as unknown as { rotation: number }).rotation) === -90,
    'aborting after terminal removal revived the actor');
  assert(Number((elements.visibility as unknown as { alpha: number }).alpha) === 0,
    'aborting after terminal removal restored actor visibility');
  unregisterActor(runtime.id);
}

function assertCombatTargetResolutionContract(): void {
  const enemy = { id: 'enemy', pid: 88, type: 1, name: 'enemy', hp: 10, mhp: 10 };
  const player = { id: 'player', pid: 42, type: 0, name: 'player', hp: 10, mhp: 10 };
  assert(resolveCombatTargetEntityId({ id: 'target', kind: 'pid', pid: 42 }, enemy, 42) === 'player',
    'enemy delivery did not resolve the current player target');
  assert(resolveCombatTargetEntityId({ id: 'target', kind: 'pid', pid: 88 }, player, 42) === 'enemy-88',
    'player delivery did not resolve an enemy target');
  assert(resolveCombatTargetEntityId({ id: 'self', kind: 'self' }, enemy, 42) === 'enemy-88',
    'self delivery did not resolve the acting combatant');
}

function createActorElements(): ActorElements {
  return {
    anchor: createDomLikeElement(),
    action: createDomLikeElement(),
    visibility: createDomLikeElement(),
    pose: createDomLikeElement(),
  };
}

function assertRegionTransitionContract(): void {
  const entity = (pgroup: number, pls: number): MapEntity => ({
    id: 'player',
    kind: 'actor',
    actorKind: 'player',
    pgroup,
    pls,
    img: '/img/3.png',
  });
  assert(!isRegionTransition(entity(1, 2), entity(1, 3)),
    'same-region movement was classified as a region transition');
  assert(isRegionTransition(entity(1, 2), entity(2, 2)),
    'pgroup change was not classified as a region transition');
}

function createDomLikeElement(): HTMLElement {
  const classes = new Set<string>();
  return {
    style: {},
    x: 0,
    y: 0,
    xPercent: 0,
    yPercent: 0,
    width: 0,
    height: 0,
    alpha: 1,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    classList: {
      toggle(name: string, force?: boolean) {
        const next = force ?? !classes.has(name);
        if (next) classes.add(name);
        else classes.delete(name);
        return next;
      },
    },
  } as unknown as HTMLElement;
}

function assertScenePoint(
  point: ReturnType<ReturnType<typeof createActorRuntime>['getScenePoint']>,
  expected: SceneAnchor,
  message: string,
): void {
  assert(point?.x === expected.point.x && point.y === expected.point.y, message);
}
