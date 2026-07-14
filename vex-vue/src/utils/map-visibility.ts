/**
 * @module K 状态管理层
 */

export type FogProjection = Record<string, Record<string, unknown>> | null | undefined;

export function isRevealedFogValue(value: unknown): boolean {
  return value === 1 || value === '1' || value === true;
}

export function isTileRevealed(
  fog: FogProjection,
  pgroup: string | number,
  pls: string | number,
  isCurrent = false,
): boolean {
  if (isCurrent) return true;
  return isRevealedFogValue(fog?.[String(pgroup)]?.[String(pls)]);
}
