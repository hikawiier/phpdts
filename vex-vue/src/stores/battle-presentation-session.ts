import { getActorById } from '@/composables/actorRegistry';
import { actorTraceEnabled, debugBus } from '@/composables/useDebugBus';
import type {
  ActorChannel,
  AnimationHandle,
  PresentationLease,
} from '@/types/actor-runtime';
import type {
  BattleExitPresentation,
  PostCombatHandoff,
  PostCombatReason,
} from '@/types/presentation-scene';
import type { TileRef } from '@/types/scene';

let nextSessionId = 1;

export interface PostCombatHandoffRun {
  readonly sessionId: string;
  readonly finished: Promise<void>;
  cancel(reason?: string): void;
}

export interface BattlePresentationSession {
  readonly id: string;
  readonly qid: number | null;
  readonly active: boolean;
  readonly sealed: boolean;
  getLease(actorId: string, channels: ActorChannel[], owner?: 'battle' | 'terminal'): PresentationLease | null;
  markTerminal(actorId: string): void;
  markBattleExit(actorId: string, reason?: PostCombatReason, retreatTarget?: TileRef | null): void;
  sealForHandoff(): readonly BattleExitPresentation[];
  startCommit(handoffs: readonly PostCombatHandoff[]): PostCombatHandoffRun;
  commit(handoffs: readonly PostCombatHandoff[]): Promise<void>;
  abort(reason: string): void;
}

class BattlePresentationSessionImpl implements BattlePresentationSession {
  readonly id = `battle-presentation-${nextSessionId++}`;
  active = true;
  sealed = false;
  private readonly leases = new Map<string, PresentationLease>();
  private readonly terminalActors = new Set<string>();
  private readonly battleExitActors = new Map<string, BattleExitPresentation>();

  constructor(readonly qid: number | null) {}

  getLease(
    actorId: string,
    channels: ActorChannel[],
    owner: 'battle' | 'terminal' = 'battle',
  ): PresentationLease | null {
    if (!this.active || this.sealed) {
      this.traceLease(actorId, channels, owner, 'session_inactive');
      return null;
    }
    const actor = getActorById(actorId);
    if (!actor) {
      this.traceLease(actorId, channels, owner, 'actor_missing');
      return null;
    }
    const lease = actor.acquire({ owner, channels, sessionId: this.id });
    if (lease) this.leases.set(actorId, lease);
    this.traceLease(actorId, channels, owner, lease ? 'acquired' : 'runtime_rejected', actor.generation);
    return lease;
  }

  private traceLease(
    actorId: string,
    channels: ActorChannel[],
    owner: 'battle' | 'terminal',
    result: string,
    generation: number | null = null,
  ): void {
    if (!actorTraceEnabled) return;
    debugBus.emit('actor-runtime', 'lease:battle', {
      sessionId: this.id,
      qid: this.qid,
      actorId,
      generation,
      channels,
      owner,
      result,
    });
  }

  markTerminal(actorId: string): void {
    const actor = getActorById(actorId);
    if (!actor) return;
    actor.markTerminal();
    actor.markRemovalAnimated(this.id);
    this.terminalActors.add(actorId);
  }

  markBattleExit(
    actorId: string,
    reason: PostCombatReason = 'escaped',
    retreatTarget: TileRef | null = null,
  ): void {
    const actor = getActorById(actorId);
    if (!actor) return;
    actor.markBattleExitAnimated(this.id);
    const anchor = actor.getProjectedAnchor();
    this.battleExitActors.set(actorId, {
      actorId,
      generation: actor.generation,
      reason,
      from: anchor?.tile ?? null,
      fromPoint: actor.getScenePoint(),
      retreatTarget,
    });
  }

  sealForHandoff(): readonly BattleExitPresentation[] {
    if (!this.active) return [];
    this.sealed = true;
    return [...this.battleExitActors.values()];
  }

  startCommit(handoffs: readonly PostCombatHandoff[]): PostCombatHandoffRun {
    if (!this.active) {
      return { sessionId: this.id, finished: Promise.resolve(), cancel: () => {} };
    }
    this.active = false;

    const animations: AnimationHandle[] = [];
    for (const handoff of handoffs) {
      const actor = getActorById(handoff.actorId);
      if (!actor || actor.generation !== handoff.generation
        || !actor.consumeBattleExitAnimated(this.id)) continue;
      if (handoff.visualPolicy === 'remove') {
        actor.markRemovalAnimated(this.id);
        continue;
      }
      let lease = this.leases.get(handoff.actorId) ?? null;
      if (handoff.visualPolicy === 'retreat') {
        const target = actor.getProjectedAnchor();
        if (lease && target) {
          const from = handoff.fromPoint;
          const gridDistance = from
            ? Math.max(
              Math.abs(target.point.x - from.x) / target.cellWidth,
              Math.abs(target.point.y - from.y) / target.cellHeight,
            )
            : Number.POSITIVE_INFINITY;
          const tier = gridDistance <= 1.5 ? 'duck' : gridDistance <= 6.5 ? 'jump' : 'long';
          animations.push(lease.play({ kind: 'move', target, tier }));
          continue;
        }
      }
      if (handoff.visualPolicy === 'hidden-relocate-arrive' || handoff.visualPolicy === 'retreat') {
        lease?.release({ reconcile: true });
        lease = actor.acquire({
          owner: 'battle',
          channels: ['pose', 'visibility'],
          sessionId: this.id,
        });
        if (lease) this.leases.set(handoff.actorId, lease);
      } else if (!lease) {
        lease = actor.acquire({
          owner: 'battle',
          channels: ['visibility'],
          sessionId: this.id,
        });
        if (lease) this.leases.set(handoff.actorId, lease);
      }
      if (lease) animations.push(lease.play({
        kind: handoff.visualPolicy === 'hidden-relocate-arrive' ? 'arrive' : 'reset-visible',
      }));
    }
    const finished = Promise.all(animations.map(handle => handle.finished))
      .then(() => undefined)
      .finally(() => {
        for (const lease of new Set(this.leases.values())) lease.release({ reconcile: true });
        this.leases.clear();
        this.terminalActors.clear();
        this.battleExitActors.clear();
      });
    return {
      sessionId: this.id,
      finished,
      cancel(reason = 'post_combat_handoff_cancelled') {
        for (const animation of animations) animation.cancel(reason);
      },
    };
  }

  async commit(handoffs: readonly PostCombatHandoff[]): Promise<void> {
    await this.startCommit(handoffs).finished;
  }

  abort(reason: string): void {
    if (!this.active) return;
    this.active = false;
    const terminalRuntimes = [...this.terminalActors]
      .map(actorId => getActorById(actorId))
      .filter(actor => actor !== undefined);
    for (const actorId of this.leases.keys()) {
      if (!this.terminalActors.has(actorId)) getActorById(actorId)?.recoverPresentation();
    }
    for (const lease of new Set(this.leases.values())) lease.release({ reconcile: true });
    for (const actor of terminalRuntimes) actor.settleTerminalPresentation();
    this.leases.clear();
    this.terminalActors.clear();
    this.battleExitActors.clear();
    if (import.meta.env.DEV) console.warn(`[BattlePresentation] ${this.id} aborted: ${reason}`);
  }
}

export function createBattlePresentationSession(qid: number | null): BattlePresentationSession {
  return new BattlePresentationSessionImpl(qid);
}
