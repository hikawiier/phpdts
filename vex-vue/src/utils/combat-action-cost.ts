/**
 * @module K 状态管理层
 */

import type { Skill } from '@/types/api';

export function getSkillBaseRange(skill: Skill | undefined): number {
  if (!skill) return 1;
  const value = skill.range?.base ?? skill.action_range ?? skill.range_max ?? 1;
  const range = Number(value);
  return Number.isFinite(range) ? Math.max(0, range) : 1;
}

export function estimateMoveActionCost(skill: Skill, distance: number | null): number {
  const baseCost = Math.max(1, Number(skill.apcost || 1));
  if (distance === null) return baseCost;
  const movePower = Math.max(1, getSkillBaseRange(skill));
  return Math.max(baseCost, Math.ceil(distance / movePower));
}
