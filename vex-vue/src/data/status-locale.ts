/**
 * @module K 状态管理层
 */

import type { ActorCapability, ActorStatusProjection } from '@/types/api';

export interface StatusLocaleEntry {
  name: string;
  description: string;
}

const STATUS_LOCALE: Record<string, StatusLocaleEntry> = {
  flustered: {
    name: '狼狈',
    description: '无法移动、战斗或进行即时操作。推进时间后恢复。',
  },
};

const CAPABILITY_LABELS: Record<ActorCapability, string> = {
  world_ai: '行动',
  voluntary_move: '移动',
  enter_combat: '发起战斗',
  participate_combat: '参与战斗',
  combat_action: '执行战斗行动',
  free_mutation: '进行即时操作',
  time_pass: '推进时间',
};

export function getStatusLocale(statusId: string): StatusLocaleEntry {
  return STATUS_LOCALE[statusId] ?? { name: statusId, description: '当前受到持续状态影响。' };
}

export function getCapabilityLabel(capability: ActorCapability): string {
  return CAPABILITY_LABELS[capability] ?? capability;
}

export function getStatusDisplayName(status: ActorStatusProjection): string {
  const name = getStatusLocale(status.status_id).name;
  if (status.phase === 'pending') return `${name}·待生效`;
  return status.remaining_ticks === null ? name : `${name} ${status.remaining_ticks}T`;
}
