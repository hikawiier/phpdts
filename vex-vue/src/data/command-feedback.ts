// ══════════════════════════════════════════════════
// Command API 结构化反馈渲染 / Command feedback renderer
//
// 后端 Command API 只返回机器可读的 code + feedback.id + params。
// 前端在这里负责用户可见文案，保持与结构化日志系统相同的职责边界：
//   后端：发生了什么
//   前端：如何表达 / i18n / HTML 样式
// ══════════════════════════════════════════════════

import { LOG_TEMPLATES, renderLogEntry, type LogParams } from '@/data/log-templates';
import type { LogEntry } from '@/types/api';
import { getCapabilityLabel, getStatusLocale } from '@/data/status-locale';
import type { ActorCapability } from '@/types/api';

export interface CommandFeedback {
  id: string;
  params?: LogParams;
  source?: 'log' | 'error' | string;
}

export type CommandResponseData = Record<string, unknown> & {
  feedback?: CommandFeedback;
};

export interface RenderedCommandFeedback {
  message: string;
  isHtml: boolean;
}

type ErrorTemplate = string | ((params?: Record<string, unknown>) => string);

/**
 * code 级兜底模板。
 *
 * 更精确的业务反馈优先走 data.feedback.id + params，并复用 LOG_TEMPLATES 渲染；
 * 这里仅覆盖协议/门控/网络错误，或 feedback 缺失时的降级展示。
 */
const COMMAND_ERROR_TEMPLATES: Record<string, ErrorTemplate> = {
  BAD_JSON: '请求格式错误。',
  INVALID_ENVELOPE: '请求格式错误。',
  INVALID_PAYLOAD: '提交内容不完整或格式错误。',
  UNKNOWN_COMMAND: '未知命令。',
  AUTH_FAILED: '认证失败，请重新登录。',
  COMMAND_IN_PROGRESS: '上一个命令仍在处理中。',
  COMMAND_NOT_ALLOWED: '当前状态不可执行此操作。',
  ITM0_PENDING: '你正手持道具，请先处理。',
  BATTLE_BUSY: '战斗处理中，请稍候。',
  STATE_CONFLICT: '客户端状态已过期，请刷新后重试。',
  DOMAIN_REJECTED: '操作未能完成。',
  CAPABILITY_BLOCKED: '当前状态不允许执行此操作。',

  NO_SP: '体力不足。',
  MOVE_SAME_POSITION: '已经在当前位置。',
  MOVE_INVALID_TARGET: '请选择正确的移动地点。',
  MOVE_BLOCKED: '目标地形无法通行。',
  MOVE_OCCUPIED: '目标位置已被占据。',
  MOVE_UNREACHABLE: '无法移动到目标地点。',
  MOVE_NO_PATH: '无法直接移动到目标地点。',
  POI_NOT_FOUND: '找不到这个建筑物。',
  POI_NOT_HERE: '你不在那个建筑物旁边。',
  POI_NOT_SEARCHABLE: '这个建筑物无法搜索。',
  POI_ALREADY_SEARCHED: '你已经搜索过这个建筑物了。',
  POI_DATA_ERROR: '建筑物数据异常。',
  ITEM_NOT_FOUND: '找不到这个道具。',
  ITEM_EMPTY: '道具无效，无法拾取。',
  ITEM_NOT_HERE: '那个道具不在你身边。',
  ITEM_NOT_DISCOVERED: '你不知道那里有什么。',
  INVALID_SLOT: '无效的背包槽位。',
  EMPTY_SLOT: '该槽位没有道具。',
  ITEM_NOT_USABLE: '这个道具无法使用。',
  ITEM_BROKEN: '这个道具已损坏，无法使用。',
  BAG_FULL: '背包已满。',
  CRAFT_NO_MATCH: '这些素材无法合成任何东西。',
  CRAFT_AMBIGUOUS: '素材指向不明确，需要放更多素材。',

  PHP_FATAL: '服务器内部错误。',
  INTERNAL_ERROR: '服务器内部错误。',
  SERVER_ERROR: '服务器内部错误。',
  NETWORK_ERROR: '网络异常。',
};

/**
 * 不属于普通 obl_log 模板、但可作为 Command API 即时反馈展示的事件。
 */
const COMMAND_FEEDBACK_TEMPLATES: Record<string, ErrorTemplate> = {
  'battle_entry.empty_actions': '战斗动作不能为空。',
  'status.capability_blocked': (params) => {
    const statusId = String(params?.status_id ?? '');
    const capability = String(params?.capability ?? '') as ActorCapability;
    const statusName = statusId ? getStatusLocale(statusId).name : '当前状态';
    return `${statusName}使你无法${getCapabilityLabel(capability)}。`;
  },
};

function hasFeedback(value: unknown): value is CommandFeedback {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === 'string' && candidate.id.length > 0;
}

function renderTemplate(template: ErrorTemplate, params?: Record<string, unknown>): string {
  return typeof template === 'function' ? template(params) : template;
}

function renderStructuredFeedback(feedback: CommandFeedback): RenderedCommandFeedback | null {
  const directTemplate = COMMAND_FEEDBACK_TEMPLATES[feedback.id];
  if (directTemplate) {
    return {
      message: renderTemplate(directTemplate, feedback.params),
      isHtml: false,
    };
  }

  if (!LOG_TEMPLATES[feedback.id]) {
    return null;
  }

  const fakeEntry: LogEntry = {
    id: feedback.id,
    logcategory: 'system',
    params: (feedback.params || {}) as LogEntry['params'],
    html: null,
    debug: false,
    ts: Math.floor(Date.now() / 1000),
  };
  const rendered = renderLogEntry(fakeEntry);
  return rendered ? { message: rendered, isHtml: true } : null;
}

export function renderCommandFeedback(
  code: string | null | undefined,
  data?: CommandResponseData | Record<string, unknown>,
  fallback?: string | null,
): RenderedCommandFeedback {
  const feedback = hasFeedback(data?.feedback) ? data.feedback : null;
  if (feedback) {
    const rendered = renderStructuredFeedback(feedback);
    if (rendered) return rendered;
  }

  if (code && COMMAND_ERROR_TEMPLATES[code]) {
    return { message: renderTemplate(COMMAND_ERROR_TEMPLATES[code], data), isHtml: false };
  }

  return { message: fallback || code || '操作未能完成。', isHtml: false };
}
