import type { CombatTargetCandidate, CombatTargetsResponse } from '@/types/api';
import type { Character } from '@/types/character';

export function combatTargetSessionMatches(
  targets: CombatTargetsResponse,
  currentQid: number | null,
): boolean {
  return targets.qid === currentQid;
}

export function isCombatTargetSelectable(
  candidate: CombatTargetCandidate | undefined,
  getCharacter: (pid: number) => Character | undefined,
): candidate is CombatTargetCandidate {
  if (!candidate || candidate.selectable !== true || candidate.relation !== 'hostile') return false;
  if (candidate.participation !== 'member' && candidate.participation !== 'joinable') return false;
  const character = getCharacter(Number(candidate.pid));
  return Boolean(character && character.type > 0 && character.state === 0);
}

export function findSelectableCombatTarget(
  targets: CombatTargetsResponse,
  currentQid: number | null,
  pid: number,
  getCharacter: (pid: number) => Character | undefined,
): CombatTargetCandidate | undefined {
  if (!combatTargetSessionMatches(targets, currentQid)) return undefined;
  const candidate = targets.candidates.find(item => Number(item.pid) === Number(pid));
  return isCombatTargetSelectable(candidate, getCharacter) ? candidate : undefined;
}
