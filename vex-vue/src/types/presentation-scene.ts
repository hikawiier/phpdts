import type { MapEntity } from './map-entity';
import type { ScenePoint, TileRef } from './scene';

export type PresentationPhase = 'idle' | 'playing' | 'rebasing';
export type PostCombatReason = 'escaped' | 'survived' | 'player_fled';
export type PostCombatVisualPolicy =
  | 'retreat'
  | 'hidden-relocate-arrive'
  | 'settle-in-place'
  | 'remove';

export interface BattleExitPresentation {
  actorId: string;
  generation: number;
  reason: PostCombatReason;
  from: TileRef | null;
  fromPoint: ScenePoint | null;
  retreatTarget: TileRef | null;
}

export interface PostCombatHandoff extends BattleExitPresentation {
  target: TileRef | null;
  visualPolicy: PostCombatVisualPolicy;
}

export interface PresentationSceneSnapshot {
  revision: number;
  authoritativeRevision: number;
  entities: MapEntity[];
}

export interface PresentationAnimationRun {
  readonly finished: Promise<void>;
  cancel(reason?: string): void;
}

export interface PresentationRebaseMoveRegistration extends PresentationAnimationRun {
  actorId: string;
  generation: number;
  token: number;
}
