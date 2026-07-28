/**
 * @module O 内容工具箱
 * @framework O-2 Schema 注册表
 *
 * 首批 15 种 BUILTIN_KINDS 常量与辅助函数。重新导出 types.ts 中的常量，
 * 供 registry/index 等模块按需引用，避免直接穿透到 types.ts。
 */

import { BUILTIN_KINDS, type ResourceKind } from './types';

export { BUILTIN_KINDS };
export type { ResourceKind };

/**
 * 判断字符串是否为首批 15 种内置 kind 之一。
 *
 * 注意：P1+ 阶段会新增 presentation.itmk / presentation.tag / effect.skill /
 * combat.skill / skill.definition 等 kind。本函数仅判断"首批 15 种"是否注册，
 * 不判断未来扩展的 kind（那些通过 registerKind 动态注册，由 getKindSchema 查询）。
 */
export function isBuiltinKind(kind: string): boolean {
  return (BUILTIN_KINDS as readonly string[]).includes(kind);
}
