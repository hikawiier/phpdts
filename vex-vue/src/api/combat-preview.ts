/**
 * @module N API 客户端
 */

import { sendOblCommand } from './obl-command';
import type {
  CombatPreviewAction,
  CombatPreviewTargetsResponse,
} from '@/types/api';

export interface CombatPreviewTargetsRequest {
  act_id: string;
  prefix_actions: CombatPreviewAction[];
  candidate_ids: number[];
}

export type CombatPreviewTargetsTransport = (
  request: CombatPreviewTargetsRequest,
) => Promise<CombatPreviewTargetsResponse>;

export const previewCombatTargets: CombatPreviewTargetsTransport = async request => {
  const result = await sendOblCommand({
    command: 'combat.preview_targets',
    payload: request,
  });
  if (!result.success) {
    throw new Error(result.message || result.error || '目标预判失败');
  }
  return result.gamedata as unknown as CombatPreviewTargetsResponse;
};
