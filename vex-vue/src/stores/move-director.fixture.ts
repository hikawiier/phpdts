/**
 * @module K 状态管理层
 */

import type { CommandResult } from '@/api/client';
import {
  buildArrivalFeedback,
  mergeTargetAdjustment,
  parseNavigationResult,
  type TargetAdjustment,
} from '@/stores/move-director';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function assertMoveDirectorTargetAdjustmentFixture(): void {
  const parsed = parseNavigationResult({
    success: true,
    gamedata: {
      navigation: {
        steps: [],
        outcome: 'arrived',
        outcome_reason: 'arrived',
        final_position: { pgroup: 1, pls: 28 },
        requested_target_pls: 5,
        target_pls: 28,
        target_adjustment: {
          from_pls: 5,
          to_pls: 28,
          reasons: ['impassable', 'occupied'],
        },
      },
    },
  } as unknown as CommandResult, 1);

  assert(parsed.targetName === '附近落点 (28)', 'adjusted navigation target was presented as an ordinary target');
  assert(parsed.interruptReason === '已抵达附近落点 (28)；原目标格 (5) 不可通行且已被占据',
    'adjusted arrival feedback did not explain the resolved landing');
  assert(parsed.resolvedTargetPls === 28, 'resolved target was not preserved for breakpoint continuation');

  const laterAdjustment: TargetAdjustment = {
    requestedPls: 28,
    resolvedPls: 29,
    reasons: ['occupied'],
  };
  const merged = mergeTargetAdjustment(parsed.targetAdjustment, laterAdjustment);
  assert(merged?.requestedPls === 5 && merged.resolvedPls === 29,
    'breakpoint adjustment did not preserve the original player anchor');
  assert(merged.reasons.join(',') === 'impassable,occupied',
    'breakpoint adjustment did not preserve all public reasons');
  assert(buildArrivalFeedback('附近落点 (29)', merged)
    === '已抵达附近落点 (29)；原目标格 (5) 不可通行且已被占据',
  'merged arrival feedback did not describe the final landing');
  assert(buildArrivalFeedback('目标格 (4)', null) === '已抵达 目标格 (4)',
    'ordinary arrival feedback changed unexpectedly');
}
