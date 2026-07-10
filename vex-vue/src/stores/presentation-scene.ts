import { defineStore } from 'pinia';
import { ref, shallowRef } from 'vue';
import type { MapEntity } from '@/types/map-entity';
import type {
  BattleExitPresentation,
  PostCombatHandoff,
  PresentationAnimationRun,
  PresentationPhase,
  PresentationRebaseMoveRegistration,
  PresentationSceneSnapshot,
} from '@/types/presentation-scene';
import type { TileRef } from '@/types/scene';

function cloneEntities(entities: readonly MapEntity[]): MapEntity[] {
  return entities.map(entity => ({ ...entity }));
}

function entityTile(entity: MapEntity | undefined): TileRef | null {
  if (!entity) return null;
  const pgroup = Number(entity.pgroup);
  const pls = Number(entity.pls);
  return Number.isFinite(pgroup) && Number.isFinite(pls) ? { pgroup, pls } : null;
}

function sameTile(left: TileRef | null, right: TileRef | null): boolean {
  return Boolean(left && right && left.pgroup === right.pgroup && left.pls === right.pls);
}

export function derivePostCombatHandoffs(
  exits: readonly BattleExitPresentation[],
  authoritativeEntities: readonly MapEntity[],
): PostCombatHandoff[] {
  const authoritativeById = new Map(authoritativeEntities.map(entity => [entity.id, entity]));
  return exits.map(exit => {
    const target = entityTile(authoritativeById.get(exit.actorId));
    const visualPolicy = !target
      ? 'remove'
      : sameTile(exit.from, target)
        ? 'settle-in-place'
        : sameTile(exit.retreatTarget, target)
          ? 'retreat'
        : 'hidden-relocate-arrive';
    return { ...exit, target, visualPolicy };
  });
}

export function deriveRebaseMoveActorIds(
  previousEntities: readonly MapEntity[],
  authoritativeEntities: readonly MapEntity[],
  excludedActorIds: ReadonlySet<string>,
): string[] {
  const previousById = new Map(previousEntities.map(entity => [entity.id, entity]));
  return authoritativeEntities
    .filter(entity => !excludedActorIds.has(entity.id))
    .filter(entity => {
      const previous = previousById.get(entity.id);
      return Boolean(previous && !sameTile(entityTile(previous), entityTile(entity)));
    })
    .map(entity => entity.id);
}

export const usePresentationSceneStore = defineStore('presentationScene', () => {
  const phase = ref<PresentationPhase>('idle');
  const snapshot = shallowRef<PresentationSceneSnapshot>({
    revision: 0,
    authoritativeRevision: 0,
    entities: [],
  });
  const rebaseToken = ref<number | null>(null);
  let nextRebaseToken = 1;
  let rollbackSnapshot: PresentationSceneSnapshot | null = null;
  let pendingAuthoritativeSnapshot: { entities: MapEntity[]; revision: number } | null = null;
  let rebaseMoveActorIds = new Set<string>();
  let rebaseMoveRegistrations = new Map<string, PresentationRebaseMoveRegistration>();
  let rebaseMovesSealed = false;

  function applySnapshot(entities: readonly MapEntity[], authoritativeRevision: number): void {
    snapshot.value = {
      revision: snapshot.value.revision + 1,
      authoritativeRevision,
      entities: cloneEntities(entities),
    };
  }

  function syncAuthoritative(entities: readonly MapEntity[], authoritativeRevision: number): void {
    if (phase.value !== 'idle') {
      pendingAuthoritativeSnapshot = {
        entities: cloneEntities(entities),
        revision: authoritativeRevision,
      };
      return;
    }
    pendingAuthoritativeSnapshot = null;
    applySnapshot(entities, authoritativeRevision);
  }

  function beginPlayback(): void {
    phase.value = 'playing';
  }

  function beginRebase(
    entities: readonly MapEntity[],
    authoritativeRevision: number,
    exits: readonly BattleExitPresentation[],
  ): PostCombatHandoff[] {
    rollbackSnapshot = snapshot.value;
    phase.value = 'rebasing';
    const handoffs = derivePostCombatHandoffs(exits, entities);
    rebaseToken.value = nextRebaseToken++;
    rebaseMoveActorIds = new Set(deriveRebaseMoveActorIds(
      snapshot.value.entities,
      entities,
      new Set(exits.map(exit => exit.actorId)),
    ));
    rebaseMoveRegistrations = new Map();
    rebaseMovesSealed = false;
    pendingAuthoritativeSnapshot = null;
    applySnapshot(entities, authoritativeRevision);
    return handoffs;
  }

  function shouldAnimateRebaseActor(actorId: string): boolean {
    return phase.value === 'rebasing' && rebaseMoveActorIds.has(actorId);
  }

  function registerRebaseMove(run: PresentationRebaseMoveRegistration): boolean {
    if (phase.value !== 'rebasing' || rebaseMovesSealed || run.token !== rebaseToken.value
      || !rebaseMoveActorIds.has(run.actorId)) {
      run.cancel('stale_rebase_move_registration');
      return false;
    }
    const existing = rebaseMoveRegistrations.get(run.actorId);
    if (existing) {
      if (existing.generation === run.generation) {
        run.cancel('duplicate_rebase_move_registration');
        return false;
      }
      existing.cancel('rebase_actor_generation_replaced');
    }
    rebaseMoveRegistrations.set(run.actorId, run);
    return true;
  }

  function sealRebaseMoves(token: number): PresentationAnimationRun {
    if (phase.value !== 'rebasing' || token !== rebaseToken.value) {
      return { finished: Promise.resolve(), cancel: () => {} };
    }
    rebaseMovesSealed = true;
    const runs = [...rebaseMoveRegistrations.values()];
    return {
      finished: Promise.all(runs.map(run => run.finished)).then(() => undefined),
      cancel(reason = 'rebase_moves_cancelled') {
        for (const run of runs) run.cancel(reason);
      },
    };
  }

  function cancelActiveRebaseMoves(reason: string): void {
    for (const run of rebaseMoveRegistrations.values()) run.cancel(reason);
  }

  function clearRebaseContext(): void {
    rebaseToken.value = null;
    rebaseMoveActorIds.clear();
    rebaseMoveRegistrations.clear();
    rebaseMovesSealed = false;
  }

  function finishRebase(): void {
    rollbackSnapshot = null;
    clearRebaseContext();
    phase.value = 'idle';
    const pending = pendingAuthoritativeSnapshot;
    pendingAuthoritativeSnapshot = null;
    if (pending) applySnapshot(pending.entities, pending.revision);
  }

  function rollbackRebase(): void {
    for (const run of rebaseMoveRegistrations.values()) run.cancel('rebase_rolled_back');
    if (rollbackSnapshot) snapshot.value = rollbackSnapshot;
    rollbackSnapshot = null;
    clearRebaseContext();
    phase.value = 'playing';
  }

  function resumePlayback(): void {
    phase.value = 'playing';
  }

  function reset(): void {
    for (const run of rebaseMoveRegistrations.values()) run.cancel('presentation_scene_reset');
    phase.value = 'idle';
    snapshot.value = { revision: 0, authoritativeRevision: 0, entities: [] };
    rollbackSnapshot = null;
    pendingAuthoritativeSnapshot = null;
    clearRebaseContext();
  }

  return {
    phase,
    snapshot,
    rebaseToken,
    syncAuthoritative,
    beginPlayback,
    beginRebase,
    shouldAnimateRebaseActor,
    registerRebaseMove,
    sealRebaseMoves,
    cancelActiveRebaseMoves,
    finishRebase,
    rollbackRebase,
    resumePlayback,
    reset,
  };
});
