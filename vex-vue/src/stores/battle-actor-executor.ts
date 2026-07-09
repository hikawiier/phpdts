import { nextTick } from 'vue';
import { getActorById } from '@/composables/actorRegistry';
import { resolveActionSpec } from '@/animations/action-specs';
import { usePlayerAvatarStore } from '@/stores/player-avatar';
import type { ActorAnimation } from '@/types/actor-animation';
import type {
  CombatantView,
  CombatTargetView,
  DirectedActionV2,
  DirectedEffectV2,
  DirectedNoticeV2,
} from './battle-director-v2';

const MAP_READY_RETRIES = 10;
const CLEARED_ANIM_DURATION = 450;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function nextFrame(): Promise<void> {
  return new Promise(resolve => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve());
      return;
    }
    setTimeout(resolve, 16);
  });
}

async function waitForUiFrame(): Promise<void> {
  await nextTick();
  await nextFrame();
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T | undefined> {
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      if (import.meta.env.DEV) console.warn(`[BattlePlayback] ${label} timed out after ${ms}ms`);
      resolve(undefined);
    }, ms);

    promise
      .then(value => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch(error => {
        clearTimeout(timer);
        if (import.meta.env.DEV) console.warn(`[BattlePlayback] ${label} failed`, error);
        resolve(undefined);
      });
  });
}

export async function prepareBattlefield(): Promise<void> {
  for (let i = 0; i < MAP_READY_RETRIES; i++) {
    if (document.getElementById('mapGrid') && getActorById('player')) return;
    await waitForUiFrame();
  }
}

export async function playActionAnimation(action: DirectedActionV2, currentPid: number): Promise<void> {
  switch (action.animation.kind) {
    case 'move':
      await playMoveAction(action);
      return;
    case 'melee_hit':
    case 'projectile':
      await playDamageAction(action);
      return;
    case 'area_burst':
      await playAreaDamageAction(action);
      return;
    case 'escape':
    case 'none':
    default:
      void currentPid;
      return;
  }
}

export async function playCombatantCleared(notice: DirectedNoticeV2, currentPid: number): Promise<void> {
  const combatant = notice.combatant;
  if (!combatant) return;

  const reason = notice.reason;
  if (combatant.pid === currentPid && combatant.type === 0) {
    const playerAvatarStore = usePlayerAvatarStore();
    if (reason === 'death') {
      playerAvatarStore.onDie();
    } else if (reason === 'escaped') {
      playerAvatarStore.onFlee();
    }
    await sleep(CLEARED_ANIM_DURATION);
    return;
  }

  if (combatant.type <= 0) return;
  if (reason !== 'death' && reason !== 'escaped') return;

  const actor = await waitForActor(combatantEntityId(combatant));
  if (!actor) {
    await sleep(CLEARED_ANIM_DURATION);
    return;
  }

  await withTimeout(new Promise<void>(resolve => {
    actor.playFadeOut(resolve);
  }), CLEARED_ANIM_DURATION + 500, `clear:${combatant.id}`);
}

async function playMoveAction(action: DirectedActionV2): Promise<void> {
  const target = getMoveTarget(action);
  if (!target) return;

  const actor = await waitForActor(combatantEntityId(action.actor));
  const anchor = await waitForTileAnchor(target);
  if (!actor || !anchor) return;

  await withTimeout(new Promise<void>(resolve => {
    actor.moveTo(anchor.x, anchor.y, anchor.cellW, anchor.cellH, resolve);
  }), 1800, `move:${action.actionUid}`);
}

async function playDamageAction(action: DirectedActionV2): Promise<void> {
  const damageEffect = action.effects.find(isDamageHpDrop);
  const target = damageEffect?.target.snapshot;
  if (!target) return;

  const spec = resolveActionSpec(action.actionId);
  const attacker = await waitForActor(combatantEntityId(action.actor));
  const defender = await waitForActor(combatantEntityId(target));
  if (!attacker || !defender) return;

  const targetPos = defender.getPosition();
  attacker.playAttack(targetPos, spec.attacker.kind);

  await sleep(action.animation.impactAt ?? spec.attacker.impactAt);

  const attackerPos = attacker.getPosition();
  const defenderPos = defender.getPosition();
  const dir: 1 | -1 | 0 = attackerPos && defenderPos
    ? (attackerPos.x < defenderPos.x ? 1 : -1)
    : 0;
  defender.playHit(dir);

  await sleep(spec.target.duration);
}

async function playAreaDamageAction(action: DirectedActionV2): Promise<void> {
  const damageEffects = action.effects.filter(isDamageHpDrop);
  const targets = uniqueCombatants(damageEffects
    .map(effect => effect.target.snapshot)
    .filter((target): target is CombatantView => Boolean(target)));
  if (targets.length === 0) return;

  const spec = resolveActionSpec(action.actionId);
  const attacker = await waitForActor(combatantEntityId(action.actor));
  if (!attacker) return;

  const primary = await waitForActor(combatantEntityId(targets[0]));
  attacker.playAttack(primary?.getPosition(), 'ranged');

  await sleep(action.animation.impactAt ?? spec.attacker.impactAt);

  await Promise.all(targets.map(async target => {
    const defender = await waitForActor(combatantEntityId(target));
    if (!defender) return;
    const attackerPos = attacker.getPosition();
    const defenderPos = defender.getPosition();
    const dir: 1 | -1 | 0 = attackerPos && defenderPos
      ? (attackerPos.x < defenderPos.x ? 1 : -1)
      : 0;
    defender.playHit(dir);
  }));

  await sleep(spec.target.duration);
}

async function waitForActor(id: string): Promise<ActorAnimation | undefined> {
  for (let i = 0; i < MAP_READY_RETRIES; i++) {
    const actor = getActorById(id);
    if (actor?.getEl()) return actor;
    await waitForUiFrame();
  }
  return getActorById(id);
}

async function waitForTileAnchor(target: CombatTargetView): Promise<{
  x: number; y: number; cellW: number; cellH: number;
} | null> {
  for (let i = 0; i < MAP_READY_RETRIES; i++) {
    const grid = document.getElementById('mapGrid');
    const tile = grid && target.kind === 'tile' && target.pls
      ? grid.querySelector<HTMLElement>(`[data-pls="${target.pls}"]`)
      : null;
    if (grid && tile) return getTileAnchor(grid, tile);
    await waitForUiFrame();
  }
  return null;
}

function getTileAnchor(gridEl: HTMLElement, cell: HTMLElement): {
  x: number; y: number; cellW: number; cellH: number;
} {
  let offsetX = 0;
  let offsetY = 0;
  let node: HTMLElement | null = cell;
  while (node && node !== gridEl) {
    offsetX += node.offsetLeft;
    offsetY += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  const cellW = cell.offsetWidth;
  const cellH = cell.offsetHeight;
  return { x: offsetX + cellW / 2, y: offsetY + cellH, cellW, cellH };
}

function getMoveTarget(action: DirectedActionV2): CombatTargetView | null {
  const moveEffect = action.effects.find(effect =>
    effect.type === 'move' &&
    effect.visual.kind === 'move_avatar' &&
    effect.target.kind === 'tile',
  );
  if (moveEffect) return moveEffect.target;

  const targetIds = action.animation.targetIds ?? [];
  return action.targets.find(target => targetIds.includes(target.id) && target.kind === 'tile')
    ?? action.targets.find(target => target.kind === 'tile')
    ?? null;
}

function isDamageHpDrop(effect: DirectedEffectV2): boolean {
  if (effect.type !== 'damage') return false;
  if (!effect.target.snapshot) return false;
  const before = Number(effect.delta?.hp_before ?? effect.target.snapshot.hp);
  const after = Number(effect.delta?.hp_after ?? effect.target.snapshot.hp);
  return after < before;
}

function uniqueCombatants(combatants: CombatantView[]): CombatantView[] {
  const seen = new Set<string>();
  const result: CombatantView[] = [];
  for (const combatant of combatants) {
    const id = combatantEntityId(combatant);
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(combatant);
  }
  return result;
}

function combatantEntityId(combatant: CombatantView): string {
  return combatant.type === 0 ? 'player' : `enemy-${combatant.pid}`;
}
