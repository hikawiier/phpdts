/**
 * @module K 状态管理层
 */

import type { DirectedActionV2 } from '@/stores/battle-director-v2';

export type BattleAnimationCue =
  | 'actor-melee'
  | 'actor-ranged'
  | 'projectile-delivery'
  | 'target-hit'
  | 'unarmed-hit-popup'
  | 'explosion-delivery';

export type HitTrigger = 'attack-impact' | 'attack-after';

export interface BattleAnimationChainSpec {
  hitTrigger: HitTrigger;
  attackBefore: readonly BattleAnimationCue[];
  attackMain: BattleAnimationCue | null;
  attackConcurrent: readonly BattleAnimationCue[];
  attackAfter: readonly BattleAnimationCue[];
  hitBefore: readonly BattleAnimationCue[];
  hitMain: BattleAnimationCue | null;
  hitConcurrent: readonly BattleAnimationCue[];
  hitAfter: readonly BattleAnimationCue[];
}

const EMPTY: readonly BattleAnimationCue[] = [];

const EMPTY_CHAIN: BattleAnimationChainSpec = {
  hitTrigger: 'attack-impact',
  attackBefore: EMPTY,
  attackMain: null,
  attackConcurrent: EMPTY,
  attackAfter: EMPTY,
  hitBefore: EMPTY,
  hitMain: null,
  hitConcurrent: EMPTY,
  hitAfter: EMPTY,
};

const MELEE_CHAIN: BattleAnimationChainSpec = {
  hitTrigger: 'attack-impact',
  attackBefore: EMPTY,
  attackMain: 'actor-melee',
  attackConcurrent: EMPTY,
  attackAfter: EMPTY,
  hitBefore: EMPTY,
  hitMain: 'target-hit',
  hitConcurrent: EMPTY,
  hitAfter: EMPTY,
};

const UNARMED_CHAIN: BattleAnimationChainSpec = {
  ...MELEE_CHAIN,
  hitConcurrent: ['unarmed-hit-popup'],
};

const AREA_CHAIN: BattleAnimationChainSpec = {
  hitTrigger: 'attack-impact',
  attackBefore: EMPTY,
  attackMain: 'actor-ranged',
  attackConcurrent: EMPTY,
  attackAfter: EMPTY,
  hitBefore: EMPTY,
  hitMain: 'target-hit',
  hitConcurrent: EMPTY,
  hitAfter: EMPTY,
};

export function resolveBattleAnimationChain(action: DirectedActionV2): BattleAnimationChainSpec {
  const hasProjectile = action.deliveries.some(delivery => isProjectileDelivery(delivery.type));
  const hasExplosion = action.deliveries.some(delivery => isExplosionDelivery(delivery.type));

  if (hasProjectile || action.animation.kind === 'projectile') {
    return {
      hitTrigger: 'attack-after',
      attackBefore: EMPTY,
      attackMain: 'actor-ranged',
      attackConcurrent: EMPTY,
      attackAfter: hasProjectile ? ['projectile-delivery'] : EMPTY,
      hitBefore: EMPTY,
      hitMain: 'target-hit',
      hitConcurrent: hasExplosion ? ['explosion-delivery'] : EMPTY,
      hitAfter: EMPTY,
    };
  }

  if (action.animation.kind === 'area_burst' || hasExplosion) {
    return {
      ...AREA_CHAIN,
      hitConcurrent: hasExplosion ? ['explosion-delivery'] : EMPTY,
    };
  }

  if (action.animation.kind !== 'melee_hit') return EMPTY_CHAIN;
  return action.actionId === 'unarmed_strike' ? UNARMED_CHAIN : MELEE_CHAIN;
}

export function isProjectileDelivery(type: string): boolean {
  return type === 'projectile' || type === 'projectile_to_tile';
}

export function isExplosionDelivery(type: string): boolean {
  return type === 'explosion' || type === 'explosion_at_tile';
}
