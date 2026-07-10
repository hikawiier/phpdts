// ══════════════════════════════════════════════════
// action-specs — 动作动画规格表
//
// 按 action_id 查表返回 ActionAnimationSpec，驱动 collision 阶段时序。
// battle.ts 不再硬编码 sleep 时长，而是由规格驱动。
//
// 新增动作时只需在此表添加一条，无需改 battle.ts。
//
// 规格值与 actorAnimations.ts 的实际动画时长耦合：
//   - impactAt 对齐 attackAnim 段2 冲撞到位时刻
//   - target.duration = hitAnim 总时长 + 缓冲
//   - 修改动画时长时需同步更新此表
// ══════════════════════════════════════════════════

import type { ActionAnimationSpec } from '@/types/actor-runtime';

/**
 * 默认规格（近战冲撞）
 *
 * 时序对齐：
 *   - attackAnim 段1 蓄力 0~0.08s + 段2 冲撞 0.08~0.20s + 段3 回正 0.20~0.30s
 *   - impactAt=200ms 对齐段2 冲撞到位时刻
 *   - hitAnim 0.42s + 30ms 缓冲 = 450ms
 *   - 总时长 200 + 450 = 650ms
 */
const DEFAULT_SPEC: ActionAnimationSpec = {
  attacker: {
    kind: 'melee',
    impactAt: 200,
  },
  target: {
    duration: 450,   // hitAnim 0.42s + 30ms 缓冲
  },
};

/**
 * 按 action_id 解析动作动画规格
 *
 * 当前只有 unarmed_strike 一种攻击动作，全部走默认规格。
 * 未来新增动作（如 ranged/charge-cast）时，在此扩展查表逻辑：
 *
 * ```ts
 * const SPEC_TABLE: Record<string, ActionAnimationSpec> = {
 *   unarmed_strike: DEFAULT_SPEC,
 *   ranged_shot: { attacker: { kind: 'ranged', impactAt: 250 }, target: { duration: 450 } },
 *   // ...
 * };
 * ```
 *
 * @param actionId 后端 action_id（如 'unarmed_strike'），null 时走默认
 */
export function resolveActionSpec(actionId: string | null): ActionAnimationSpec {
  // 未来按 action_id 分发，当前全部走默认近战规格
  void actionId;
  return DEFAULT_SPEC;
}
