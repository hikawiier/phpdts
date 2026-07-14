/**
 * @module K 状态管理层
 */

import type { Skill } from '@/types/api';

export type SkillCategory = 'maneuver' | 'assault' | 'support' | 'finisher';

export const SKILL_CATEGORY_LABELS: Record<SkillCategory, string> = {
  maneuver: '机动',
  assault: '攻击',
  support: '辅助',
  finisher: '终结',
};

export const SKILL_CATEGORY_TAB_ORDER: SkillCategory[] = [
  'maneuver', 'assault', 'support', 'finisher',
];

/**
 * 派生分类：后端字段为唯一权威，前端不维护映射表
 *
 * - 终结性：Skill.finisher 字段驱动（时序约束）
 * - 功能分类：Skill.category 字段驱动（maneuver/assault/support）
 *
 * 后端新增技能只需在 skill_definition_config.php 配置 category 字段，
 * 前端自动正确分类，无需双重同步。
 */
export function getSkillCategory(skill: Skill): SkillCategory {
  if (skill.finisher) return 'finisher';
  const c = skill.category;
  if (c === 'maneuver' || c === 'assault' || c === 'support') return c;
  return 'assault';
}

/** 终结性判定：直接读后端下发字段 */
export function isFinisherSkill(skill: Skill): boolean {
  return Boolean(skill.finisher);
}
