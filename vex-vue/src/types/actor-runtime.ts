/**
 * @module K 状态管理层
 */

import type { SceneAnchor, ScenePoint } from './scene';

export type MoveTier = 'duck' | 'jump' | 'long';
export type AttackKind = 'melee' | 'ranged';
export type ActorChannel = 'spatial' | 'action' | 'visibility' | 'pose';
export type PresentationOwner = 'ambient' | 'world' | 'battle' | 'terminal';
export type RemovalDisposition = 'animated' | 'projected' | 'immediate';

export interface ActorElements {
  anchor: HTMLElement;
  action: HTMLElement;
  visibility: HTMLElement;
  pose: HTMLElement;
  debugLabel?: HTMLElement;
}

export interface AnimationResult {
  status: 'completed' | 'cancelled' | 'skipped';
  reason?: string;
}

export interface AnimationHandle {
  readonly finished: Promise<AnimationResult>;
  cancel(reason?: string): void;
}

export interface CueAnimationHandle extends AnimationHandle {
  cue(name: 'impact'): Promise<AnimationResult>;
}

export type ActorCommand =
  | { kind: 'idle' }
  | { kind: 'enter' }
  | { kind: 'arrive' }
  | { kind: 'transform-appearance'; swap: () => void }
  | { kind: 'reset-pose' }
  | {
    kind: 'move';
    target: SceneAnchor;
    tier: MoveTier;
    hold?: boolean;
    onTravelProgress?: (progress: number) => void;
  }
  | { kind: 'attack'; target?: ScenePoint; attackKind: AttackKind }
  | { kind: 'hit'; direction: -1 | 0 | 1 }
  | { kind: 'fall' }
  | { kind: 'fade' }
  | { kind: 'reset-visible' };

export interface LeaseRequest {
  owner: PresentationOwner;
  channels: ActorChannel[];
  sessionId?: string;
  replaceEqualOwner?: boolean;
}

export interface PresentationLease {
  readonly actorId: string;
  readonly owner: PresentationOwner;
  readonly sessionId: string | null;
  readonly channels: ReadonlySet<ActorChannel>;
  readonly released: boolean;
  play(command: ActorCommand): AnimationHandle;
  release(options?: { reconcile?: boolean }): void;
}

export interface ActorRuntime {
  readonly id: string;
  readonly generation: number;
  readonly disposed: boolean;
  setElements(elements: ActorElements | null): void;
  acquire(request: LeaseRequest): PresentationLease | null;
  projectAnchor(anchor: SceneAnchor): void;
  getProjectedAnchor(): SceneAnchor | null;
  getScenePoint(): ScenePoint | null;
  setFacing(direction: 'left' | 'right'): void;
  markTerminal(): void;
  settleTerminalPresentation(): void;
  markDown(): void;
  markStanding(): void;
  recoverPresentation(): void;
  markRemovalAnimated(sessionId: string): void;
  markBattleExitAnimated(sessionId: string): void;
  consumeBattleExitAnimated(sessionId: string): boolean;
  consumeRemovalDisposition(): RemovalDisposition;
  dispose(): void;
}
