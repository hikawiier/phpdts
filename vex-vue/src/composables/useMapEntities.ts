/**
 * @module M 组合式函数
 */

import { nextTick, shallowRef, watch, type Ref } from 'vue';
import { createActorRuntime } from '@/composables/useActorRuntime';
import { getActorById, registerActor, unregisterActor } from '@/composables/actorRegistry';
import { createMapSceneGeometry } from '@/composables/mapSceneGeometry';
import { registerSceneGeometry, getSceneGeometry } from '@/composables/sceneRegistry';
import { useEntitiesStore } from '@/stores/entities';
import { useMapStore } from '@/stores/map';
import { usePlayerAvatarStore } from '@/stores/player-avatar';
import { usePresentationSceneStore } from '@/stores/presentation-scene';
import { actorTraceEnabled, debugBus } from '@/composables/useDebugBus';
import type { ActorElements, AnimationHandle, MoveTier, PresentationLease } from '@/types/actor-runtime';
import type { MapEntity } from '@/types/map-entity';
import type { PresentationRebaseMoveRegistration } from '@/types/presentation-scene';
import type { SceneAnchor, TileRef } from '@/types/scene';

const DUCK_MAX_GRID = 1.5;
const JUMP_MAX_GRID = 6.5;

function toTileRef(entity: MapEntity): TileRef | null {
  const pgroup = Number(entity.pgroup);
  const pls = Number(entity.pls);
  return Number.isFinite(pgroup) && Number.isFinite(pls) ? { pgroup, pls } : null;
}

function sameTile(left: MapEntity | undefined, right: MapEntity): boolean {
  if (!left) return false;
  return Number(left.pgroup) === Number(right.pgroup)
    && Number(left.pls) === Number(right.pls);
}

export function isRegionTransition(left: MapEntity | undefined, right: MapEntity): boolean {
  return Boolean(left) && Number(left?.pgroup) !== Number(right.pgroup);
}

function calcMoveTier(fromX: number, fromY: number, target: SceneAnchor): MoveTier {
  const gridDist = Math.max(
    Math.abs(target.point.x - fromX) / target.cellWidth,
    Math.abs(target.point.y - fromY) / target.cellHeight,
  );
  if (gridDist <= DUCK_MAX_GRID) return 'duck';
  if (gridDist <= JUMP_MAX_GRID) return 'jump';
  return 'long';
}

export function isScenePointAtAnchor(from: { x: number; y: number }, target: SceneAnchor): boolean {
  return Math.abs(from.x - target.point.x) < 0.5
    && Math.abs(from.y - target.point.y) < 0.5;
}

export interface CancellableProjectedRemoval {
  readonly finished: Promise<void>;
  cancel(reason?: string, recoverVisibility?: boolean): void;
}

export function createCancellableProjectedRemoval(
  handle: AnimationHandle,
  callbacks: {
    complete(): void;
    cancel(recoverVisibility: boolean): void;
  },
): CancellableProjectedRemoval {
  let cancelled = false;
  const finished = handle.finished.then(() => {
    if (!cancelled) callbacks.complete();
  });
  return {
    finished,
    cancel(reason = 'projected_removal_cancelled', recoverVisibility = true) {
      if (cancelled) return;
      cancelled = true;
      handle.cancel(reason);
      callbacks.cancel(recoverVisibility);
    },
  };
}

function actorElements(root: HTMLElement): ActorElements | null {
  const action = root.querySelector<HTMLElement>('.actor-action');
  const visibility = root.querySelector<HTMLElement>('.actor-visibility');
  const pose = root.querySelector<HTMLElement>('.actor-pose');
  const debugLabel = root.querySelector<HTMLElement>('.actor-debug-label') ?? undefined;
  return action && visibility && pose
    ? { anchor: root, action, visibility, pose, debugLabel }
    : null;
}

export function useMapEntities(gridRef: Ref<HTMLElement | null>) {
  const entitiesStore = useEntitiesStore();
  const mapStore = useMapStore();
  const presentationScene = usePresentationSceneStore();
  const playerAvatarStore = usePlayerAvatarStore();
  const displayEntities = shallowRef<MapEntity[]>([]);
  const enteredEntities = new Set<string>();
  const runtimeIds = new Set<string>();
  const worldMoves = new Map<string, PresentationLease>();
  const rebaseMoves = new Map<string, PresentationRebaseMoveRegistration>();
  const projectedRemovals = new Map<string, CancellableProjectedRemoval>();
  let resizeObserver: ResizeObserver | null = null;
  let unregisterScene: (() => void) | null = null;

  function setEntityRef(id: string, el: HTMLElement | null): void {
    if (!el) {
      if (actorTraceEnabled) {
        debugBus.emit('actor', 'map-ref:unmount', {
          actorId: id,
          projectionRevision: mapStore.projectionRevision,
          authoritativeIds: entitiesStore.entities.map(entity => entity.id),
          displayedIds: displayEntities.value.map(entity => entity.id),
          stack: new Error('actor ref unmounted').stack ?? null,
        });
      }
      runtimeIds.delete(id);
      unregisterActor(id);
      enteredEntities.delete(id);
      rebaseMoves.get(id)?.cancel('actor_unmounted');
      rebaseMoves.delete(id);
      projectedRemovals.get(id)?.cancel('actor_unmounted', false);
      worldMoves.delete(id);
      return;
    }
    const elements = actorElements(el);
    if (!elements) return;
    let runtime = getActorById(id);
    if (!runtime) {
      runtime = createActorRuntime(id);
      registerActor(id, runtime);
    }
    runtimeIds.add(id);
    runtime.setElements(elements);
  }

  function resolveAnchor(entity: MapEntity): SceneAnchor | null {
    const tile = toTileRef(entity);
    return tile ? getSceneGeometry()?.resolveTile(tile) ?? null : null;
  }

  function syncEntityPosition(entity: MapEntity): void {
    const runtime = getActorById(entity.id);
    const anchor = resolveAnchor(entity);
    if (runtime && anchor) runtime.projectAnchor(anchor);
  }

  function syncAllPositions(): void {
    for (const entity of presentationScene.snapshot.entities) {
      if (presentationScene.phase === 'rebasing'
        && presentationScene.shouldAnimateRebaseActor(entity.id)) continue;
      syncEntityPosition(entity);
    }
  }

  async function playWorldMove(entity: MapEntity, lease: PresentationLease): Promise<void> {
    await nextTick();
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    if (lease.released || worldMoves.get(entity.id) !== lease) return;
    const runtime = getActorById(entity.id);
    const anchor = resolveAnchor(entity);
    const from = runtime?.getScenePoint();
    if (!runtime || !anchor || !from) {
      lease.release({ reconcile: true });
      worldMoves.delete(entity.id);
      return;
    }
    if (isScenePointAtAnchor(from, anchor)) {
      runtime.projectAnchor(anchor);
      lease.release({ reconcile: true });
      if (worldMoves.get(entity.id) === lease) worldMoves.delete(entity.id);
      return;
    }
    runtime.projectAnchor(anchor);
    const tier = calcMoveTier(from.x, from.y, anchor);
    const visibilityHandle = tier === 'long'
      ? null
      : lease.play({ kind: 'reset-visible' });
    const handle = lease.play({ kind: 'move', target: anchor, tier });
    await Promise.all([
      handle.finished,
      visibilityHandle?.finished ?? Promise.resolve(),
    ]);
    lease.release({ reconcile: true });
    if (worldMoves.get(entity.id) === lease) worldMoves.delete(entity.id);
  }

  async function playRegionArrival(entity: MapEntity, lease: PresentationLease): Promise<void> {
    await nextTick();
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    if (lease.released || worldMoves.get(entity.id) !== lease) return;
    const runtime = getActorById(entity.id);
    const anchor = resolveAnchor(entity);
    if (!runtime || !anchor) {
      lease.release({ reconcile: true });
      if (worldMoves.get(entity.id) === lease) worldMoves.delete(entity.id);
      return;
    }
    runtime.projectAnchor(anchor);
    await lease.play({ kind: 'arrive' }).finished;
    lease.release({ reconcile: true });
    if (worldMoves.get(entity.id) === lease) worldMoves.delete(entity.id);
  }

  function startRebaseWorldMove(
    entity: MapEntity,
    token: number,
  ): PresentationRebaseMoveRegistration | null {
    const runtime = getActorById(entity.id);
    const anchor = resolveAnchor(entity);
    const from = runtime?.getScenePoint();
    if (!runtime || !anchor || !from) return null;

    worldMoves.get(entity.id)?.release({ reconcile: false });
    rebaseMoves.get(entity.id)?.cancel('rebase_move_replaced');
    if (isScenePointAtAnchor(from, anchor)) {
      runtime.projectAnchor(anchor);
      return null;
    }
    const generation = runtime.generation;
    const lease = runtime.acquire({
      owner: 'world',
      channels: ['spatial', 'pose', 'visibility'],
      sessionId: `rebase:${token}:${generation}`,
      replaceEqualOwner: true,
    });
    if (!lease) return null;
    worldMoves.set(entity.id, lease);
    runtime.projectAnchor(anchor);
    const tier = calcMoveTier(from.x, from.y, anchor);
    const handles: AnimationHandle[] = [];
    if (tier !== 'long') handles.push(lease.play({ kind: 'reset-visible' }));
    handles.push(lease.play({ kind: 'move', target: anchor, tier }));

    let settled = false;
    let resolveFinished!: () => void;
    const finished = new Promise<void>(resolve => { resolveFinished = resolve; });
    const settle = () => {
      if (settled) return;
      settled = true;
      lease.release({ reconcile: true });
      if (worldMoves.get(entity.id) === lease) worldMoves.delete(entity.id);
      if (rebaseMoves.get(entity.id)?.generation === generation) rebaseMoves.delete(entity.id);
      resolveFinished();
    };
    const run: PresentationRebaseMoveRegistration = {
      actorId: entity.id,
      generation,
      token,
      finished,
      cancel(reason = 'rebase_move_cancelled') {
        for (const handle of handles) handle.cancel(reason);
        settle();
      },
    };
    rebaseMoves.set(entity.id, run);
    void Promise.all(handles.map(handle => handle.finished)).then(settle, settle);
    return run;
  }

  async function playFirstEnter(entity: MapEntity): Promise<void> {
    const runtime = getActorById(entity.id);
    if (!runtime || enteredEntities.has(entity.id) || projectedRemovals.has(entity.id)) return;
    const anchor = resolveAnchor(entity);
    if (!anchor) return;
    runtime.projectAnchor(anchor);
    enteredEntities.add(entity.id);
    if (entity.id === 'player') {
      playerAvatarStore.onEnter();
      return;
    }
    const lease = runtime.acquire({
      owner: 'world',
      channels: ['pose', 'visibility'],
      sessionId: `enter:${runtime.generation}`,
    });
    if (!lease) return;
    await lease.play({ kind: 'enter' }).finished;
    lease.release();
  }

  function startProjectedRemoval(entity: MapEntity): void {
    const runtime = getActorById(entity.id);
    if (!runtime) {
      displayEntities.value = displayEntities.value.filter(item => item.id !== entity.id);
      return;
    }
    const disposition = runtime.consumeRemovalDisposition();
    if (disposition === 'animated' || disposition === 'immediate') {
      displayEntities.value = displayEntities.value.filter(item => item.id !== entity.id);
      return;
    }
    const lease = runtime.acquire({
      owner: 'world',
      channels: ['visibility'],
      sessionId: `remove:${runtime.generation}`,
    });
    if (!lease) {
      displayEntities.value = displayEntities.value.filter(item => item.id !== entity.id);
      return;
    }
    const handle = lease.play({ kind: 'fade' });
    let run!: CancellableProjectedRemoval;
    run = createCancellableProjectedRemoval(handle, {
      complete() {
        if (projectedRemovals.get(entity.id) !== run) return;
        lease.release({ reconcile: false });
        projectedRemovals.delete(entity.id);
        displayEntities.value = displayEntities.value.filter(item => item.id !== entity.id);
      },
      cancel(recoverVisibility) {
        lease.release({ reconcile: false });
        if (projectedRemovals.get(entity.id) === run) projectedRemovals.delete(entity.id);
        if (!recoverVisibility) return;
        const recovery = runtime.acquire({
          owner: 'world',
          channels: ['visibility'],
          sessionId: `rediscovered:${runtime.generation}`,
          replaceEqualOwner: true,
        });
        if (recovery) {
          void recovery.play({ kind: 'reset-visible' }).finished.finally(() => recovery.release());
        }
      },
    });
    projectedRemovals.set(entity.id, run);
  }

  const stopAuthorityWatch = watch(
    () => ({ revision: mapStore.projectionRevision, entities: entitiesStore.entities }),
    ({ revision, entities }) => presentationScene.syncAuthoritative(entities, revision),
    { immediate: true },
  );

  const stopEntitiesWatch = watch(
    () => ({
      revision: presentationScene.snapshot.revision,
      phase: presentationScene.phase,
      entities: presentationScene.snapshot.entities,
    }),
    ({ entities }, previous) => {
      const oldEntities = previous?.entities ?? [];
      const oldById = new Map(oldEntities.map(entity => [entity.id, entity]));
      const newIds = new Set(entities.map(entity => entity.id));

      for (const entity of entities) {
        projectedRemovals.get(entity.id)?.cancel('entity_rediscovered');
      }
      const removedIds = oldEntities
        .filter(entity => entity.id !== 'player' && !newIds.has(entity.id))
        .map(entity => entity.id);

      if (actorTraceEnabled && removedIds.length > 0) {
        debugBus.emit('actor', 'projection:removed', {
          projectionRevision: mapStore.projectionRevision,
          removedIds,
          nextIds: [...newIds],
          fadingIds: [...projectedRemovals.keys()],
        });
      }

      for (const entity of oldEntities) {
        if (entity.id === 'player' || newIds.has(entity.id) || projectedRemovals.has(entity.id)) continue;
        startProjectedRemoval(entity);
      }

      displayEntities.value = [
        ...entities,
        ...displayEntities.value.filter(entity => projectedRemovals.has(entity.id) && !newIds.has(entity.id)),
      ];

      for (const entity of entities) {
        const previousEntity = oldById.get(entity.id);
        if (!previousEntity) continue;
        if (sameTile(previousEntity, entity)) continue;
        if (presentationScene.phase === 'rebasing') {
          if (presentationScene.shouldAnimateRebaseActor(entity.id)) {
            const token = presentationScene.rebaseToken;
            const run = token === null ? null : startRebaseWorldMove(entity, token);
            if (run) presentationScene.registerRebaseMove(run);
          } else {
            syncEntityPosition(entity);
          }
          continue;
        }
        const runtime = getActorById(entity.id);
        if (!runtime) continue;
        const existing = worldMoves.get(entity.id);
        existing?.release({ reconcile: false });
        const regionTransition = isRegionTransition(previousEntity, entity);
        const lease = runtime.acquire({
          owner: 'world',
          channels: regionTransition ? ['pose', 'visibility'] : ['spatial', 'pose', 'visibility'],
          sessionId: `world:${mapStore.projectionRevision}:${runtime.generation}`,
          replaceEqualOwner: true,
        });
        if (!lease) {
          syncEntityPosition(entity);
          continue;
        }
        worldMoves.set(entity.id, lease);
        void (regionTransition ? playRegionArrival(entity, lease) : playWorldMove(entity, lease));
      }

      nextTick(() => requestAnimationFrame(() => {
        syncAllPositions();
        for (const entity of entities) void playFirstEnter(entity);
      }));

      for (const id of [...enteredEntities]) {
        if (!newIds.has(id)) enteredEntities.delete(id);
      }
    },
    { immediate: true },
  );

  const stopIntentWatch = watch(
    () => playerAvatarStore.intentSeq,
    async () => {
      await nextTick();
      const runtime = getActorById('player');
      if (!runtime) return;
      const intent = playerAvatarStore.intent;
      const sessionId = `player-intent:${playerAvatarStore.intentSeq}:${runtime.generation}`;
      if (intent === 'move') return;

      if (intent === 'battle-start' || intent === 'battle-end') {
        const targetAppearance = intent === 'battle-start' ? 'battle' : 'normal';
        if (playerAvatarStore.currentAppearance === targetAppearance) {
          const visibleLease = runtime.acquire({
            owner: 'battle',
            channels: ['pose', 'visibility'],
            sessionId,
            replaceEqualOwner: true,
          });
          if (!visibleLease) return;
          await visibleLease.play({ kind: 'reset-visible' }).finished;
          visibleLease.release();
          return;
        }
        const transformLease = runtime.acquire({
          owner: 'battle',
          channels: ['pose', 'visibility'],
          sessionId,
          replaceEqualOwner: true,
        });
        if (!transformLease) return;
        const [result] = await Promise.all([
          transformLease.play({
            kind: 'transform-appearance',
            swap: () => {
              if (playerAvatarStore.desiredAppearance === targetAppearance) {
                playerAvatarStore.commitAppearance(targetAppearance);
              }
            },
          }).finished,
          transformLease.play({ kind: 'reset-visible' }).finished,
        ]);
        if (result.status !== 'completed'
          && playerAvatarStore.desiredAppearance === targetAppearance
          && playerAvatarStore.currentAppearance !== targetAppearance) {
          playerAvatarStore.commitAppearance(targetAppearance);
        }
        transformLease.release();
        return;
      }

      if (intent === 'low-hp' || intent === 'normal-hp' || intent === 'idle') {
        const lease = runtime.acquire({ owner: 'ambient', channels: ['pose'], sessionId: `ambient:${runtime.generation}` });
        lease?.play({ kind: 'idle' });
        return;
      }

      const terminal = intent === 'die';
      const channels = intent === 'hit' || intent === 'attack'
        ? ['action', 'pose'] as const
        : intent === 'flee'
          ? ['visibility'] as const
          : ['pose', 'visibility'] as const;
      const lease = runtime.acquire({
        owner: terminal ? 'terminal' : 'world',
        channels: [...channels],
        sessionId,
      });
      if (!lease) return;
      if (terminal) runtime.markTerminal();

      let command;
      switch (intent) {
        case 'enter': case 'popup': case 'revive': command = { kind: 'enter' } as const; break;
        case 'die': case 'fall': command = { kind: 'fall' } as const; break;
        case 'hit': command = { kind: 'hit', direction: 0 } as const; break;
        case 'attack': {
          const target = playerAvatarStore.lastAttackTargetId
            ? getActorById(playerAvatarStore.lastAttackTargetId)?.getScenePoint() ?? undefined
            : undefined;
          command = { kind: 'attack', target, attackKind: playerAvatarStore.lastAttackKind } as const;
          break;
        }
        case 'flee': command = { kind: 'fade' } as const; break;
        default: command = { kind: 'idle' } as const;
      }
      const result = await lease.play(command).finished;
      if (result.status === 'completed' && (intent === 'enter' || intent === 'popup' || intent === 'revive')) {
        runtime.markStanding();
        playerAvatarStore.notifyUp();
      }
      if (result.status === 'completed' && (intent === 'die' || intent === 'fall')) {
        runtime.markDown();
        playerAvatarStore.notifyDown();
      }
      if (!terminal) lease.release();
    },
  );

  const stopGridWatch = watch(gridRef, grid => {
    resizeObserver?.disconnect();
    resizeObserver = null;
    unregisterScene?.();
    unregisterScene = null;
    if (!grid) return;

    const scene = createMapSceneGeometry(
      gridRef,
      () => mapStore.curRegion,
      () => mapStore.projectionRevision,
    );
    unregisterScene = registerSceneGeometry(scene);
    resizeObserver = new ResizeObserver(() => requestAnimationFrame(() => syncAllPositions()));
    resizeObserver.observe(grid);
    requestAnimationFrame(() => {
      syncAllPositions();
      for (const entity of presentationScene.snapshot.entities) void playFirstEnter(entity);
    });
  }, { immediate: true });

  function dispose(): void {
    stopIntentWatch();
    stopGridWatch();
    stopAuthorityWatch();
    stopEntitiesWatch();
    resizeObserver?.disconnect();
    unregisterScene?.();
    for (const lease of worldMoves.values()) lease.release({ reconcile: false });
    for (const run of rebaseMoves.values()) run.cancel('map_entities_disposed');
    for (const run of projectedRemovals.values()) run.cancel('map_entities_disposed', false);
    for (const id of runtimeIds) unregisterActor(id);
    runtimeIds.clear();
    worldMoves.clear();
    rebaseMoves.clear();
    projectedRemovals.clear();
    enteredEntities.clear();
  }

  return { setEntityRef, syncAllPositions, displayEntities, dispose };
}
