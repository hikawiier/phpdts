/**
 * @module K 状态管理层
 * @framework K-1 战斗回合编排 + 演示播放管道
 */

// ══════════════════════════════════════════════════
// 战报回放文本生成字典 / Battle replay text templates
//
// 与 LOG_TEMPLATES / SKILL_TEMPLATES / command-feedback 共享同一架构模式：
//   字典（Record<string, (ctx) => TextCue>） + 渲染函数 + 兜底模板
//
// 后端 emit 的 snake_case 字段（action_id / effect_type / reason / event_type）
// 作为索引锚点，前端字典 key 必须与后端枚举值 1:1 对齐。模板匹配失败视为
// 硬错误（console.warn + 兜底文案），对齐 DESIGN.md §4.1 跨层命名契约。
//
// 相关文档：oblivions/docs/战报回放文本本地化与排版重构-2026-07-16.md
// ══════════════════════════════════════════════════

import { escapeHtml } from '@/utils/format';
import { isDebugEnabled } from '@/utils/debug-flags';
import { SKILL_TEMPLATES } from './skill-templates';
import { getStatusLocale } from './status-locale';
import type {
  BattleLogV3Event,
  CombatantSnapshot,
  CombatTargetRef,
} from '@/types/api';

// ──────────────────────────────────────────────────
// 类型定义
// ──────────────────────────────────────────────────

export interface TextCue {
  html: string;
  tone?: 'normal' | 'damage' | 'heal' | 'system' | 'danger';
}

export interface CombatantView {
  id: string;
  pid: number;
  type: number;
  name: string;
  hp: number;
  mhp: number;
  ap?: number;
  max_ap?: number;
  pgroup?: number;
  pls?: number;
}

export interface CombatTargetView {
  id: string;
  kind: CombatTargetRef['kind'];
  pid?: number;
  name?: string;
  snapshot?: CombatantView | null;
  pgroup?: number;
  pls?: number;
}

export interface ActionTextContext {
  actor: CombatantView;
  targets: CombatTargetView[];
  /** 从 SKILL_TEMPLATES[actId].action_desc 注入的动词短语；idle 等未注册项为空字符串 */
  action_desc?: string;
}

export interface EffectTextContext {
  target: CombatTargetView;
  value?: number;
  detail: Record<string, unknown>;
}

export interface ReasonParams {
  raw: string;
  prefix: string;
  detail: string;
  /** 键值对参数（来自 `prefix:key1=val1,key2=val2` 格式） */
  kv: Record<string, string>;
}

export interface BattleEndInfo {
  /** 玩家 pid（type=0 的 combatant） */
  playerPid: number;
  /** 玩家是否在 battle_end.payload.survivors 中（幸存） */
  playerSurvived: boolean;
  /** 玩家是否通过 combatant_cleared.reason==='escaped' 退出战斗 */
  playerEscaped: boolean;
  /** 胜者 pid（来自 battle_end.winner_pid） */
  winnerPid: number | null;
  /** 战斗结束原因（来自 battle_end.reason） */
  reason: string;
}

export interface NoticeTextContext {
  event: BattleLogV3Event;
  /** battle_end 专用上下文（仅 event_type==='battle_end' 时存在） */
  battleEnd: BattleEndInfo | null;
  /** actor / combatant 视图（来自 payload） */
  actor?: CombatantView | null;
  combatant?: CombatantView | null;
  actionId?: string | null;
  reason?: string | null;
  winnerPid?: number | null;
}

// ──────────────────────────────────────────────────
// HTML 高亮辅助
// ──────────────────────────────────────────────────

function escape(value: unknown): string {
  return escapeHtml(value === null || value === undefined ? '' : String(value));
}

function yellow(value: unknown): string {
  return `<span class="yellow">${escape(value)}</span>`;
}

function red(value: unknown): string {
  return `<span class="red">${escape(value)}</span>`;
}

function grey(value: unknown): string {
  return `<span class="grey">${escape(value)}</span>`;
}

function combatantName(view: CombatantView | null | undefined, fallback = '参战者'): string {
  return view?.name || fallback;
}

function targetNames(targets: CombatTargetView[]): string {
  return targets
    .map(t => t.name)
    .filter(Boolean)
    .map(name => yellow(name))
    .join('、');
}

// ──────────────────────────────────────────────────
// reason 解析器
// ──────────────────────────────────────────────────

/**
 * 解析复合 reason 字段。
 *
 * 支持格式：
 * - `prefix` （无参数）
 * - `prefix:detail` （裸字符串参数）
 * - `prefix:key1=val1,key2=val2` （键值对参数）
 *
 * combatant_cleared.reason（death/escaped）与 battle_end.reason
 * （queue_empty/disband/no_candidate）是无前缀 enum，prefix === raw。
 */
export function parseReason(reason: string | null | undefined): ReasonParams {
  const raw = reason ?? '';
  if (!raw) {
    return { raw: '', prefix: '', detail: '', kv: {} };
  }

  const colonIdx = raw.indexOf(':');
  if (colonIdx < 0) {
    return { raw, prefix: raw, detail: '', kv: {} };
  }

  const prefix = raw.slice(0, colonIdx);
  const rest = raw.slice(colonIdx + 1);

  // 检测键值对格式：key1=val1,key2=val2
  const kv: Record<string, string> = {};
  let detail = rest;
  if (rest.length > 0 && rest.includes('=')) {
    const parts = rest.split(',');
    let allKv = true;
    for (const part of parts) {
      const eqIdx = part.indexOf('=');
      if (eqIdx <= 0) {
        allKv = false;
        break;
      }
      kv[part.slice(0, eqIdx)] = part.slice(eqIdx + 1);
    }
    if (allKv && parts.length > 0) {
      detail = '';
    }
  }

  return { raw, prefix, detail, kv };
}

// ──────────────────────────────────────────────────
// BATTLE_ACTION_TEMPLATES
// ──────────────────────────────────────────────────

type ActionTemplate = (ctx: ActionTextContext) => TextCue;

const BATTLE_ACTION_TEMPLATES: Record<string, ActionTemplate> = {
  unarmed_strike: ctx => ({
    html: `${yellow(ctx.actor.name)}${ctx.action_desc}${targetNames(ctx.targets)}`,
    tone: 'normal',
  }),
  move: ctx => ({
    html: `${yellow(ctx.actor.name)}${ctx.action_desc}${targetNames(ctx.targets)}`,
    tone: 'normal',
  }),
  escape: ctx => ({
    html: `${yellow(ctx.actor.name)}${ctx.action_desc}`,
    tone: 'normal',
  }),
  heal: ctx => ({
    html: `${yellow(ctx.actor.name)}${ctx.action_desc}`,
    tone: 'heal',
  }),
  throw: ctx => ({
    html: `${yellow(ctx.actor.name)}向${targetNames(ctx.targets)}${ctx.action_desc}`,
    tone: 'normal',
  }),
  whirlwind: ctx => ({
    html: `${yellow(ctx.actor.name)}${ctx.action_desc}${targetNames(ctx.targets)}`,
    tone: 'normal',
  }),
  execute: ctx => ({
    html: `${yellow(ctx.actor.name)}${ctx.action_desc}${targetNames(ctx.targets)}`,
    tone: 'normal',
  }),
  vampiric_bite: ctx => ({
    html: `${yellow(ctx.actor.name)}${ctx.action_desc}${targetNames(ctx.targets)}`,
    tone: 'normal',
  }),
  grenade: ctx => ({
    html: `${yellow(ctx.actor.name)}向${targetNames(ctx.targets)}${ctx.action_desc}`,
    tone: 'normal',
  }),
  idle: ctx => ({
    html: `${grey(ctx.actor.name)}原地待机`,
    tone: 'system',
  }),
};

function fallbackAction(actionId: string, ctx: ActionTextContext): TextCue {
  if (import.meta.env.DEV) {
    console.warn(`[battle-templates] 未匹配 act_id: ${actionId}`);
  }
  const targets = targetNames(ctx.targets);
  return {
    html: `${yellow(ctx.actor.name || '行动者')}使用了${grey(actionId)}${targets ? `，目标：${targets}` : ''}`,
    tone: 'normal',
  };
}

// ──────────────────────────────────────────────────
// BATTLE_EFFECT_TEMPLATES
// ──────────────────────────────────────────────────

type EffectTemplate = (ctx: EffectTextContext) => TextCue | undefined;

const BATTLE_EFFECT_TEMPLATES: Record<string, EffectTemplate> = {
  damage: ctx => {
    const name = ctx.target.name || ctx.target.id;
    return {
      html: `${yellow(name)}受到${red(ctx.value ?? 0)}点伤害`,
      tone: 'damage',
    };
  },
  heal: ctx => {
    const name = ctx.target.name || ctx.target.id;
    return {
      html: `${yellow(name)}恢复${yellow(ctx.value ?? 0)}点生命`,
      tone: 'heal',
    };
  },
  escape: ctx => {
    const name = ctx.target.name || ctx.target.id;
    return {
      html: `${yellow(name)}尝试脱离战斗`,
      tone: 'system',
    };
  },
  status: ctx => {
    const name = ctx.target.name || ctx.target.id;
    const statusId = String(ctx.detail.status_id ?? ctx.detail.skill_id ?? 'status');
    const statusName = getStatusLocale(statusId).name;
    const activated = ctx.detail.operation === 'activate' || ctx.detail.state === 'active';
    return {
      html: activated
        ? `${yellow(name)}陷入了${yellow(statusName)}`
        : `${yellow(name)}获得了${yellow(statusName)}，战斗结束后生效`,
      tone: 'system',
    };
  },
  // move / ap_change / custom 默认不生成文本（由 HP 条 / 地图位姿动画 / AP 槽承担视觉反馈）
};

function fallbackEffect(type: string): TextCue | undefined {
  if (import.meta.env.DEV) {
    console.warn(`[battle-templates] 未匹配 effect_type: ${type}`);
  }
  return undefined;
}

// ──────────────────────────────────────────────────
// BATTLE_REASON_TEMPLATES
// ──────────────────────────────────────────────────

type ReasonTemplate = (params: ReasonParams) => TextCue;

function plainReason(text: string, tone: TextCue['tone'] = 'system'): () => TextCue {
  return () => ({ html: text, tone });
}

function detailReason(template: (detail: string) => string, tone: TextCue['tone'] = 'danger'): ReasonTemplate {
  return params => ({
    html: template(params.detail || ''),
    tone,
  });
}

const BATTLE_REASON_TEMPLATES: Record<string, ReasonTemplate> = {
  // *_target_missing 三个具体前缀（避免通配匹配逻辑）
  damage_target_missing: plainReason('没有有效目标'),
  heal_target_missing: plainReason('没有有效目标'),
  move_target_missing: plainReason('没有有效目标'),

  ap_insufficient: params => ({
    html: `体力不足（需要${yellow(params.kv.need ?? '?')}，当前${yellow(params.kv.have ?? '?')}）`,
    tone: 'danger',
  }),
  rule_forbid: detailReason(detail => `规则禁止：${grey(detail)}`),
  skill_not_found: detailReason(detail => `技能配置缺失${detail ? `：${grey(detail)}` : ''}`),
  move_spatial_rejected: detailReason(detail => `移动被阻挡${detail ? `：${grey(detail)}` : ''}`),
  move_ap_quote_changed: plainReason('移动预算发生变化'),

  // 补遗前缀（后端 combat_preview_reason_public 已剥离 preview 通道，BattleLog 通道未剥离）
  target_resolve_failed: detailReason(detail => `目标解析失败${detail ? `：${grey(detail)}` : ''}`),
  AIM_RULE_FAILED: detailReason(detail => `瞄准规则不允许${detail ? `：${grey(detail)}` : ''}`),

  execute_hook_missing: detailReason(detail => `执行钩子缺失${detail ? `：${grey(detail)}` : ''}`),
  CAPABILITY_BLOCKED: detailReason(detail => `能力被锁定${detail ? `：${grey(detail)}` : ''}`),
  CAPTURE_RESOLVER_NOT_FOUND: plainReason('目标解析失败'),
  CAPTURE_INVALID_OUTPUT: plainReason('目标解析异常'),

  NO_VALID_TARGET: plainReason('没有有效目标'),
  EFFECT_FAILED: plainReason('效果执行失败'),
  NO_EXECUTABLE_EFFECT: plainReason('没有可执行的效果'),

  // combatant_cleared.reason（无前缀 enum）
  death: plainReason('阵亡'),
  escaped: plainReason('逃离战场'),

  // battle_end.reason（无前缀 enum，作为附加说明仅在 debug 显示）
  queue_empty: plainReason('队列已空', 'system'),
  disband: plainReason('队列解散', 'system'),
  no_candidate: plainReason('无下一行动者', 'system'),
};

function fallbackReason(params: ReasonParams): TextCue {
  if (import.meta.env.DEV) {
    console.warn(`[battle-templates] 未匹配 reason 前缀: ${params.prefix}（raw: ${params.raw}）`);
  }
  return {
    html: `原因：${grey(params.raw)}`,
    tone: 'danger',
  };
}

// ──────────────────────────────────────────────────
// BATTLE_NOTICE_TEMPLATES
// ──────────────────────────────────────────────────

type NoticeTemplate = (ctx: NoticeTextContext) => TextCue;

const BATTLE_NOTICE_TEMPLATES: Record<string, NoticeTemplate> = {
  action_failed: ctx => {
    const actorName = combatantName(ctx.actor, '行动者');
    const actionId = ctx.actionId ?? '动作';
    const reasonText = renderReason(ctx.reason);
    return {
      html: `${yellow(actorName)}的${grey(actionId)}失败：${reasonText.html}`,
      tone: 'danger',
    };
  },

  combatant_cleared: ctx => {
    const name = combatantName(ctx.combatant, '参战者');
    const reasonText = renderReason(ctx.reason);
    return {
      html: `${yellow(name)}已退出战斗（${reasonText.html}）`,
      tone: 'system',
    };
  },

  battle_end: ctx => {
    const info = ctx.battleEnd;
    if (!info) {
      return { html: grey('战斗结束'), tone: 'system' };
    }

    // 玩家幸存：按 winner_pid 判定胜负
    if (info.playerSurvived) {
      if (info.winnerPid === info.playerPid) {
        return { html: yellow('你获得了胜利'), tone: 'normal' };
      }
      return { html: grey('战斗结束'), tone: 'system' };
    }

    // 玩家退出：按退出原因判定
    if (info.playerEscaped) {
      return { html: yellow('你成功逃离了战斗'), tone: 'system' };
    }

    return { html: red('你战败了'), tone: 'danger' };
  },

  combatant_joined: ctx => ({
    html: `${yellow(combatantName(ctx.combatant, '新参战者'))}加入了战斗`,
    tone: 'normal',
  }),

  notice: ctx => {
    const payload = ctx.event.payload || {};
    const message = payload.message;
    const messageType = payload.message_type as string | undefined;

    // 按 §5.3 决策：message_type 显式标记优先
    if (typeof message === 'string' && message !== '') {
      if (messageType === 'zh') {
        return { html: escapeHtml(message), tone: 'system' };
      }
      if (messageType === 'key') {
        const tpl = BATTLE_NOTICE_TEMPLATES[message];
        if (tpl) {
          return tpl(ctx);
        }
        if (import.meta.env.DEV) {
          console.warn(`[battle-templates] notice message_type=key 未匹配: ${message}`);
        }
        return { html: grey(message), tone: 'system' };
      }
      // messageType === 'debug' 或未标记：直接显示（兼容后端暂未实现 message_type 的情况）
      return { html: escapeHtml(message), tone: 'system' };
    }

    // 无 message 字段：仅 debug 模式显示 detail
    if (isDebugEnabled('ai') && payload.detail && typeof payload.detail === 'object') {
      return {
        html: grey(`[detail] ${JSON.stringify(payload.detail)}`),
        tone: 'system',
      };
    }

    return { html: grey('战斗事件'), tone: 'system' };
  },
};

function fallbackNotice(eventType: string, ctx: NoticeTextContext): TextCue {
  if (import.meta.env.DEV) {
    console.warn(`[battle-templates] 未匹配 event_type: ${eventType}`);
  }
  // diagnostic channel 走 debug-only
  if (ctx.event.channel === 'diagnostic') {
    if (!isDebugEnabled('ai')) return { html: '', tone: 'system' };
    const detail = ctx.event.payload?.detail;
    return {
      html: grey(`[诊断] ${detail ? JSON.stringify(detail) : ctx.event.event_type}`),
      tone: 'system',
    };
  }
  return { html: grey(`[未识别事件] ${eventType}`), tone: 'system' };
}

// ──────────────────────────────────────────────────
// 渲染函数（外部入口）
// ──────────────────────────────────────────────────

/**
 * 渲染 action 文本。
 *
 * actId 对应 BATTLE_ACTION_TEMPLATES 的 key；模板内通过 ctx.action_desc 引用
 * SKILL_TEMPLATES[actId].action_desc 作为动词短语来源（不重写 SKILL_TEMPLATES）。
 * idle 不在 SKILL_TEMPLATES 注册，模板内硬编码"原地待机"。
 */
export function renderBattleAction(
  actionId: string,
  actor: CombatantView,
  targets: CombatTargetView[],
): TextCue {
  const actionDesc = SKILL_TEMPLATES[actionId]?.action_desc ?? '';
  const ctx: ActionTextContext = { actor, targets, action_desc: actionDesc };

  const template = BATTLE_ACTION_TEMPLATES[actionId];
  if (!template) {
    return fallbackAction(actionId, ctx);
  }
  // idle 是 BATTLE_ACTION_TEMPLATES 独有条目（不在 SKILL_TEMPLATES 注册），跳过 action_desc 校验
  // 其他 act_id 的 action_desc 必须从 SKILL_TEMPLATES 注入，缺失视为硬错误（静默回退会引入文案漂移）
  if (actionId !== 'idle' && !actionDesc) {
    return fallbackAction(actionId, ctx);
  }
  return template(ctx);
}

/**
 * 渲染 effect 文本。返回 undefined 表示该 effect_type 不生成文本。
 */
export function renderBattleEffect(
  type: string,
  target: CombatTargetView,
  value: number | undefined,
  detail: Record<string, unknown>,
): TextCue | undefined {
  const template = BATTLE_EFFECT_TEMPLATES[type];
  if (!template) {
    return fallbackEffect(type);
  }
  return template({ target, value, detail });
}

/**
 * 渲染 reason 文本。支持复合 reason（前缀:剩余）与无前缀 enum。
 */
export function renderReason(reason: string | null | undefined): TextCue {
  const params = parseReason(reason);
  if (!params.prefix) {
    return { html: '', tone: 'system' };
  }
  const template = BATTLE_REASON_TEMPLATES[params.prefix];
  if (!template) {
    return fallbackReason(params);
  }
  return template(params);
}

/**
 * 渲染 notice 文本。按 event_type 路由到 BATTLE_NOTICE_TEMPLATES。
 *
 * 注：diagnostic 是 channel 不是 event_type；当 event.channel === 'diagnostic'
 * 时由 fallbackNotice 走 debug-only 渲染。
 */
export function renderBattleNotice(ctx: NoticeTextContext): TextCue {
  const eventType = ctx.event.event_type;

  // diagnostic channel 优先短路
  if (ctx.event.channel === 'diagnostic') {
    return fallbackNotice('diagnostic', ctx);
  }

  const template = BATTLE_NOTICE_TEMPLATES[eventType];
  if (!template) {
    return fallbackNotice(eventType, ctx);
  }
  return template(ctx);
}

// ──────────────────────────────────────────────────
// 校验函数（开发模式入口调用）
// ──────────────────────────────────────────────────

/** 后端已知 act_id 清单（含 SKILL_TEMPLATES 已注册项 + idle） */
const KNOWN_ACT_IDS = new Set<string>([
  ...Object.keys(SKILL_TEMPLATES),
  'idle',
]);

/** 后端已知 reason 前缀清单 */
const KNOWN_REASON_PREFIXES = new Set<string>([
  'damage_target_missing',
  'heal_target_missing',
  'move_target_missing',
  'ap_insufficient',
  'rule_forbid',
  'skill_not_found',
  'move_spatial_rejected',
  'move_ap_quote_changed',
  'target_resolve_failed',
  'AIM_RULE_FAILED',
  'execute_hook_missing',
  'CAPABILITY_BLOCKED',
  'CAPTURE_RESOLVER_NOT_FOUND',
  'CAPTURE_INVALID_OUTPUT',
  'NO_VALID_TARGET',
  'EFFECT_FAILED',
  'NO_EXECUTABLE_EFFECT',
  'death',
  'escaped',
  'queue_empty',
  'disband',
  'no_candidate',
]);

export interface ValidationResult {
  missingActions: string[];
  missingEffects: string[];
  missingReasons: string[];
  missingNotices: string[];
  extraActions: string[];
}

/**
 * 校验 BATTLE_TEMPLATES 字典覆盖度。
 *
 * 在开发模式入口（main.ts 的 import.meta.env.DEV 分支）调用，
 * 输出未覆盖项警告，对齐 §3.3 跨层契约可校验要求。
 */
export function validateBattleTemplates(): ValidationResult {
  const result: ValidationResult = {
    missingActions: [],
    missingEffects: [],
    missingReasons: [],
    missingNotices: [],
    extraActions: [],
  };

  // act_id：BATTLE_ACTION_TEMPLATES 应覆盖所有 KNOWN_ACT_IDS（idle 是 SKILL_TEMPLATES 例外，允许只在 BATTLE_ACTION_TEMPLATES 注册）
  for (const actId of KNOWN_ACT_IDS) {
    if (!BATTLE_ACTION_TEMPLATES[actId] && actId !== 'idle') {
      result.missingActions.push(actId);
    }
  }
  // idle 必须在 BATTLE_ACTION_TEMPLATES 注册
  if (!BATTLE_ACTION_TEMPLATES.idle) {
    result.missingActions.push('idle');
  }
  // BATTLE_ACTION_TEMPLATES 中的额外 key（不在 KNOWN_ACT_IDS）应给出提示
  for (const actId of Object.keys(BATTLE_ACTION_TEMPLATES)) {
    if (!KNOWN_ACT_IDS.has(actId)) {
      result.extraActions.push(actId);
    }
  }

  // effect_type：BATTLE_EFFECT_TEMPLATES 仅需覆盖生成文本的 4 个 type
  const REQUIRED_EFFECTS = ['damage', 'heal', 'escape', 'status'];
  for (const type of REQUIRED_EFFECTS) {
    if (!BATTLE_EFFECT_TEMPLATES[type]) {
      result.missingEffects.push(type);
    }
  }

  // reason：BATTLE_REASON_TEMPLATES 必须覆盖所有 KNOWN_REASON_PREFIXES
  for (const prefix of KNOWN_REASON_PREFIXES) {
    if (!BATTLE_REASON_TEMPLATES[prefix]) {
      result.missingReasons.push(prefix);
    }
  }

  // event_type：BATTLE_NOTICE_TEMPLATES 必须覆盖所有 KNOWN_EVENT_TYPES 中需要文本生成的事件
  // turn_opened / action_start / action_delivery / effect_applied / action_end 不生成 notice 文本
  const REQUIRED_NOTICES = [
    'action_failed',
    'combatant_cleared',
    'battle_end',
    'combatant_joined',
    'notice',
  ];
  for (const type of REQUIRED_NOTICES) {
    if (!BATTLE_NOTICE_TEMPLATES[type]) {
      result.missingNotices.push(type);
    }
  }

  if (import.meta.env.DEV) {
    if (result.missingActions.length) console.warn('[battle-templates] 未覆盖 act_id:', result.missingActions);
    if (result.missingEffects.length) console.warn('[battle-templates] 未覆盖 effect_type:', result.missingEffects);
    if (result.missingReasons.length) console.warn('[battle-templates] 未覆盖 reason 前缀:', result.missingReasons);
    if (result.missingNotices.length) console.warn('[battle-templates] 未覆盖 event_type:', result.missingNotices);
    if (result.extraActions.length) console.warn('[battle-templates] BATTLE_ACTION_TEMPLATES 含未知 act_id:', result.extraActions);
  }

  return result;
}

// ──────────────────────────────────────────────────
// snapshot → CombatantView 转换（与 battle-director 共享）
// ──────────────────────────────────────────────────

export function combatantViewFromSnapshot(snapshot: CombatantSnapshot | null | undefined): CombatantView | null {
  if (!snapshot) return null;
  const pid = Number(snapshot.pid) || 0;
  if (pid <= 0) return null;
  const type = Number(snapshot.type) || 0;
  return {
    id: type === 0 ? 'player' : `enemy-${pid}`,
    pid,
    type,
    name: String(snapshot.name ?? ''),
    hp: Number(snapshot.hp) || 0,
    mhp: Number(snapshot.mhp) || 0,
    ap: snapshot.ap !== undefined ? Number(snapshot.ap) : undefined,
    max_ap: snapshot.max_ap !== undefined ? Number(snapshot.max_ap) : undefined,
    pgroup: snapshot.pgroup !== undefined ? Number(snapshot.pgroup) : undefined,
    pls: snapshot.pls !== undefined ? Number(snapshot.pls) : undefined,
  };
}
