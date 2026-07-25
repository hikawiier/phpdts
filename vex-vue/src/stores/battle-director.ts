/**
 * @module K 状态管理层
 * @framework K-1 战斗回合编排 + 演示播放管道
 */

import type {
  BattleLogRawEntry,
  BattleLogV3Event,
  CombatantSnapshot,
  CombatTargetRef,
  StateDelta,
} from '@/types/api';
import {
  renderBattleAction,
  renderBattleEffect,
  renderBattleNotice,
  combatantViewFromSnapshot,
  type NoticeTextContext,
  type BattleEndInfo,
} from '@/data/battle-templates';

// 战斗导演系统：将后端 battlelog.v3 领域事件编导为语义化播控脚本
// 职责：事件分组 → DirectedAction → PlaybackStep，供播放管道消费
export type BattleSegmentKind = 'turn_intro' | 'turn' | 'battle_end' | 'system';

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

export interface TextCue {
  html: string;
  tone?: 'normal' | 'damage' | 'heal' | 'system' | 'danger';
}

export interface ActionAnimationPlan {
  kind: 'none' | 'melee_hit' | 'projectile' | 'area_burst' | 'move' | 'escape';
  attackerId?: string;
  targetIds?: string[];
  impactAt?: number;
}

export interface EffectVisualPlan {
  kind: 'none' | 'damage_number' | 'heal_number' | 'hit_react' | 'fade_out' | 'move_avatar';
  targetId?: string;
  value?: number;
}

export interface DirectedEffect {
  effectUid: string;
  rawLogId: number;
  type: 'damage' | 'heal' | 'move' | 'escape' | 'ap_change' | 'status' | 'custom';
  source?: CombatantView | null;
  target: CombatTargetView;
  value?: number;
  delta?: StateDelta;
  detail: Record<string, unknown>;
  visual: EffectVisualPlan;
  text?: TextCue;
}

export interface DirectedDelivery {
  rawLogId: number;
  type: string;
  resolvedAim: CombatTargetView;
}

export interface DirectedCombatantJoined {
  rawLogId: number;
  qid: number | null;
  combatant: CombatantView;
  sourceActionUid: string;
  myorder: number;
  done: number;
}

export interface DirectedAction {
  actionUid: string;
  rawLogId: number;
  actionId: string;
  actor: CombatantView;
  targets: CombatTargetView[];
  effects: DirectedEffect[];
  deliveries: DirectedDelivery[];
  joinedCombatants: DirectedCombatantJoined[];
  success: boolean;
  reason?: string | null;
  animation: ActionAnimationPlan;
  text: TextCue[];
}

export interface DirectedNotice {
  type: 'action_failed' | 'combatant_cleared' | 'battle_end' | 'combatant_joined' | 'notice' | 'diagnostic';
  text: TextCue;
  rawLogId: number;
  actor?: CombatantView | null;
  combatant?: CombatantView | null;
  actionId?: string | null;
  reason?: string | null;
  winnerPid?: number | null;
  delta?: StateDelta;
  detail?: Record<string, unknown>;
}

export interface BattleSegment {
  kind: BattleSegmentKind;
  turnKey?: string;
  roundNum?: number;
  turnSeq?: number;
  actor?: CombatantView;
  controller?: 'player' | 'system';
  openingKind?: 'battle_start' | 'turn';
  actions: DirectedAction[];
  notices: DirectedNotice[];
}

export interface BattlePlayScript {
  schema: 'battleplay.v3';
  segments: BattleSegment[];
  rawLogIds: number[];
}

export type PlaybackStepKind =
  | 'prepare_map'
  | 'segment_context'
  | 'action_choreography'
  | 'combatant_cleared'
  | 'battle_end_overlay_enter'
  | 'presentation_scene_handoff'
  | 'battle_end_modal_content'
  | 'modal_text';

export type PlaybackAwaitPolicy = 'none' | 'completion' | 'duration';

export interface PlaybackStepBase {
  id: string;
  kind: PlaybackStepKind;
  awaitPolicy: PlaybackAwaitPolicy;
  timeout?: number;
}

export interface PrepareMapStep extends PlaybackStepBase {
  kind: 'prepare_map';
  segment: BattleSegment;
}

export interface SegmentContextStep extends PlaybackStepBase {
  kind: 'segment_context';
  segment: BattleSegment;
}

export interface ActionChoreographyStep extends PlaybackStepBase {
  kind: 'action_choreography';
  segment: BattleSegment;
  action: DirectedAction;
}

export interface CombatantClearedStep extends PlaybackStepBase {
  kind: 'combatant_cleared';
  segment: BattleSegment;
  notice: DirectedNotice;
}

export interface ModalTextStep extends PlaybackStepBase {
  kind: 'modal_text';
  segment: BattleSegment;
  options: {
    alwaysShowHeader?: boolean;
  };
}

export interface BattleEndOverlayEnterStep extends PlaybackStepBase {
  kind: 'battle_end_overlay_enter';
  segment: BattleSegment;
}

export interface PresentationSceneHandoffStep extends PlaybackStepBase {
  kind: 'presentation_scene_handoff';
  segment: BattleSegment;
}

export interface BattleEndModalContentStep extends PlaybackStepBase {
  kind: 'battle_end_modal_content';
  segment: BattleSegment;
}

export type PlaybackStep =
  | PrepareMapStep
  | SegmentContextStep
  | ActionChoreographyStep
  | CombatantClearedStep
  | BattleEndOverlayEnterStep
  | PresentationSceneHandoffStep
  | BattleEndModalContentStep
  | ModalTextStep;

export interface BattlePlaybackPlan {
  schema: 'battleplayback.v1';
  script: BattlePlayScript;
  steps: PlaybackStep[];
}

interface PendingAction {
  action: DirectedAction;
  turnKey: string;
  order: number;
}

export function isBattleLogV3Event(entry: BattleLogRawEntry): entry is BattleLogV3Event {
  return (entry as BattleLogV3Event).schema === 'battlelog.v3';
}

export function selectUnconsumedBattleEvents(
  events: BattleLogV3Event[],
  consumed: ReadonlySet<string>,
): { events: BattleLogV3Event[]; eventUids: string[] } {
  const selected: BattleLogV3Event[] = [];
  const eventUids: string[] = [];
  const claimed = new Set<string>();
  for (const event of events) {
    if (consumed.has(event.event_uid) || claimed.has(event.event_uid)) continue;
    claimed.add(event.event_uid);
    eventUids.push(event.event_uid);
    selected.push(event);
  }
  return { events: selected, eventUids };
}

export function directBattleEvents(events: BattleLogV3Event[]): BattlePlayScript {
  const renderEvents = events
    .filter(e => e.channel === 'render')
    .slice()
    .sort((a, b) => Number(a.log_id) - Number(b.log_id));

  // 预扫描：计算 battle_end 胜负判定的显式上下文（BattleEndInfo）
  const battleEndCtx = computeBattleEndContext(renderEvents);

  const pending = new Map<string, PendingAction>();
  const segments: BattleSegment[] = [];
  const rawLogIds = events.map(e => Number(e.log_id)).filter(id => id > 0);
  let order = 0;

  const getTurnSegment = (event: BattleLogV3Event, actor?: CombatantView): BattleSegment => {
    const turnKey = String(event.turn_key || '');
    if (!turnKey) throw new Error(`battlelog.v3 ${event.event_type} missing turn_key`);
    let segment = segments.find(seg =>
      seg.kind === 'turn' &&
      seg.turnKey === turnKey,
    );
    if (!segment) {
      segment = {
        kind: 'turn',
        turnKey,
        roundNum: event.round_num,
        turnSeq: event.turn_seq,
        actor,
        actions: [],
        notices: [],
      };
      segments.push(segment);
    } else if (!segment.actor && actor) {
      segment.actor = actor;
    }
    return segment;
  };

  const flushAction = (uid: string, event: BattleLogV3Event): void => {
    const item = pending.get(uid);
    if (!item) return;
    const segment = getTurnSegment(event, item.action.actor);
    if (!segment.actions.some(a => a.actionUid === uid)) {
      segment.actions.push(item.action);
    }
    pending.delete(uid);
  };

  for (const event of renderEvents) {
    const payload = event.payload || {};

    if (event.event_type === 'turn_opened') {
      const actor = toCombatantView(payload.actor);
      const turnKey = String(event.turn_key || '');
      if (!turnKey) throw new Error('battlelog.v3 turn_opened missing turn_key');
      const openingKind = payload.opening_kind === 'battle_start' ? 'battle_start' : 'turn';
      const controller = payload.controller === 'player' ? 'player' : 'system';
      segments.push({
        kind: 'turn_intro',
        turnKey,
        roundNum: event.round_num,
        turnSeq: event.turn_seq,
        actor: actor ?? undefined,
        controller,
        openingKind,
        actions: [],
        notices: [],
      });
      getTurnSegment(event, actor ?? undefined);
      continue;
    }

    if (event.event_type === 'action_start') {
      const actor = toCombatantView(payload.actor);
      if (!actor) continue;
      const turnKey = String(event.turn_key || '');
      if (!turnKey) throw new Error('battlelog.v3 action_start missing turn_key');
      const actionUid = String(payload.action_uid ?? event.action_uid ?? '');
      if (!actionUid) continue;
      const targets = Array.isArray(payload.targets)
        ? payload.targets.map(toTargetView)
        : [];
      const actionId = String(payload.action_id ?? event.action_id ?? 'unknown');
      pending.set(actionUid, {
        order: order++,
        turnKey,
        action: {
          actionUid,
          rawLogId: event.log_id,
          actionId,
          actor,
          targets,
          effects: [],
          deliveries: [],
          joinedCombatants: [],
          success: true,
          animation: decideActionAnimation(actionId, actor, targets),
          text: [buildActionText(actionId, actor, targets)],
        },
      });
      continue;
    }

    if (event.event_type === 'effect_applied') {
      const actionUid = String(payload.action_uid ?? event.action_uid ?? '');
      const item = pending.get(actionUid);
      if (!item) continue;
      const effect = toDirectedEffect(event);
      item.action.effects.push(effect);
      item.action.animation = deriveActionAnimationFromEffects(item.action);
      continue;
    }

    if (event.event_type === 'action_delivery') {
      const actionUid = String(payload.action_uid ?? event.action_uid ?? '');
      const item = pending.get(actionUid);
      if (!item) continue;
      item.action.deliveries.push({
        rawLogId: event.log_id,
        type: String(payload.delivery_type ?? 'none'),
        resolvedAim: toResolvedAimView(payload.resolved_aim),
      });
      continue;
    }

    if (event.event_type === 'combatant_joined') {
      const actionUid = String(payload.source_action_uid ?? payload.action_uid ?? event.action_uid ?? '');
      const item = pending.get(actionUid);
      const combatant = toCombatantView(payload.combatant);
      if (item && combatant) {
        item.action.joinedCombatants.push({
          rawLogId: event.log_id,
          qid: payload.qid === null || payload.qid === undefined ? event.qid : Number(payload.qid),
          combatant,
          sourceActionUid: actionUid,
          myorder: Number(payload.myorder ?? 0),
          done: Number(payload.done ?? 0),
        });
      }
      // 追加 notice 文本生成（动态参战场景的叙事完整性）
      if (combatant) {
        const segment = getTurnSegment(event);
        segment.notices.push({
          type: 'combatant_joined',
          rawLogId: event.log_id,
          combatant,
          text: buildNoticeText(event, battleEndCtx, { combatant }),
        });
      }
      continue;
    }

    if (event.event_type === 'action_end') {
      const actionUid = String(payload.action_uid ?? event.action_uid ?? '');
      const item = pending.get(actionUid);
      if (item) {
        item.action.success = payload.success !== false;
        item.action.reason = typeof payload.reason === 'string' ? payload.reason : null;
        flushAction(actionUid, event);
      }
      continue;
    }

    if (event.event_type === 'action_failed') {
      const actionUid = String(payload.action_uid ?? event.action_uid ?? '');
      if (actionUid) pending.delete(actionUid);
      const actor = toCombatantView(payload.actor);
      const segment = getTurnSegment(event, actor ?? undefined);
      const actionId = String(payload.action_id ?? event.action_id ?? '动作');
      const reason = String(payload.reason ?? event.reason ?? 'unknown');
      segment.notices.push({
        type: 'action_failed',
        rawLogId: event.log_id,
        actor,
        actionId,
        reason,
        delta: payload.delta,
        detail: payload.detail,
        text: buildNoticeText(event, battleEndCtx, { actor, actionId, reason }),
      });
      continue;
    }

    if (event.event_type === 'combatant_cleared') {
      const combatant = toCombatantView(payload.combatant);
      const segment = getTurnSegment(event, combatant ?? undefined);
      const reason = String(payload.reason ?? event.reason ?? 'unknown');
      segment.notices.push({
        type: 'combatant_cleared',
        rawLogId: event.log_id,
        combatant,
        reason,
        delta: payload.delta,
        detail: payload.detail,
        text: buildNoticeText(event, battleEndCtx, { combatant, reason }),
      });
      continue;
    }

    if (event.event_type === 'battle_end') {
      const reason = String(payload.reason ?? event.reason ?? 'unknown');
      const winnerPid = payload.winner_pid !== undefined && payload.winner_pid !== null
        ? Number(payload.winner_pid)
        : (event.winner_pid ?? null);
      segments.push({
        kind: 'battle_end',
        actions: [],
        notices: [{
          type: 'battle_end',
          rawLogId: event.log_id,
          reason,
          winnerPid,
          text: buildNoticeText(event, battleEndCtx, { reason, winnerPid }),
        }],
      });
      continue;
    }

    if (event.event_type === 'notice') {
      const segment = getTurnSegment(event);
      segment.notices.push({
        type: 'notice',
        rawLogId: event.log_id,
        reason: event.reason ?? null,
        text: buildNoticeText(event, battleEndCtx),
      });
    }
  }

  for (const item of Array.from(pending.values()).sort((a, b) => a.order - b.order)) {
    let segment = segments.find(seg => seg.kind === 'turn' && seg.turnKey === item.turnKey);
    if (!segment) {
      segment = {
        kind: 'turn',
        turnKey: item.turnKey,
        actor: item.action.actor,
        actions: [],
        notices: [],
      };
      segments.push(segment);
    }
    segment.actions.push(item.action);
  }

  return { schema: 'battleplay.v3', segments, rawLogIds };
}

export function planBattlePlayback(script: BattlePlayScript): BattlePlaybackPlan {
  const steps: PlaybackStep[] = [];
  let order = 0;
  const nextId = (kind: PlaybackStepKind, segment: BattleSegment): string => {
    const segKey = [
      segment.kind,
      segment.turnKey ?? 'x',
      order++,
    ].join('-');
    return `${kind}-${segKey}`;
  };

  for (const segment of script.segments) {
    if (segment.kind === 'turn_intro') {
      steps.push({
        id: nextId('modal_text', segment),
        kind: 'modal_text',
        segment,
        options: { alwaysShowHeader: true },
        awaitPolicy: 'completion',
        timeout: 30000,
      });
      continue;
    }

    if (segment.kind === 'battle_end') {
      steps.push({
        id: nextId('battle_end_overlay_enter', segment),
        kind: 'battle_end_overlay_enter',
        segment,
        awaitPolicy: 'completion',
        timeout: 1500,
      });
      steps.push({
        id: nextId('presentation_scene_handoff', segment),
        kind: 'presentation_scene_handoff',
        segment,
        awaitPolicy: 'completion',
        timeout: 20000,
      });
      steps.push({
        id: nextId('battle_end_modal_content', segment),
        kind: 'battle_end_modal_content',
        segment,
        awaitPolicy: 'completion',
        timeout: 30000,
      });
      continue;
    }

    steps.push({
      id: nextId('segment_context', segment),
      kind: 'segment_context',
      segment,
      awaitPolicy: 'completion',
      timeout: 5000,
    });

    steps.push({
      id: nextId('prepare_map', segment),
      kind: 'prepare_map',
      segment,
      awaitPolicy: 'completion',
      timeout: 1000,
    });

    for (const action of segment.actions) {
      steps.push({
        id: `${nextId('action_choreography', segment)}-${action.actionUid}`,
        kind: 'action_choreography',
        segment,
        action,
        awaitPolicy: action.animation.kind === 'none'
          && action.deliveries.every(delivery => delivery.type === 'none')
          ? 'none'
          : 'completion',
        timeout: action.animation.kind === 'move' ? 2200 : 2800,
      });
    }

    for (const notice of segment.notices) {
      if (notice.type !== 'combatant_cleared') continue;
      steps.push({
        id: `${nextId('combatant_cleared', segment)}-${notice.rawLogId}`,
        kind: 'combatant_cleared',
        segment,
        notice,
        awaitPolicy: 'completion',
        timeout: 1200,
      });
    }

    steps.push({
      id: nextId('modal_text', segment),
      kind: 'modal_text',
      segment,
      options: {},
      awaitPolicy: 'completion',
      timeout: 30000,
    });

  }

  return { schema: 'battleplayback.v1', script, steps };
}

function toCombatantView(snapshot: unknown): CombatantView | null {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const s = snapshot as CombatantSnapshot;
  const pid = Number(s.pid) || 0;
  if (pid <= 0) return null;
  const type = Number(s.type) || 0;
  return {
    id: type === 0 ? 'player' : `enemy-${pid}`,
    pid,
    type,
    name: String(s.name ?? ''),
    hp: Number(s.hp) || 0,
    mhp: Number(s.mhp) || 0,
    ap: s.ap !== undefined ? Number(s.ap) : undefined,
    max_ap: s.max_ap !== undefined ? Number(s.max_ap) : undefined,
    pgroup: s.pgroup !== undefined ? Number(s.pgroup) : undefined,
    pls: s.pls !== undefined ? Number(s.pls) : undefined,
  };
}

function toTargetView(ref: CombatTargetRef): CombatTargetView {
  if (ref.kind === 'pid' || ref.kind === 'self') {
    const snapshot = toCombatantView(ref.snapshot ?? null);
    const pid = Number(ref.pid) || snapshot?.pid || 0;
    return {
      id: snapshot?.id ?? (pid > 0 ? `pid-${pid}` : 'none'),
      kind: ref.kind,
      pid,
      name: snapshot?.name,
      snapshot,
    };
  }
  if (ref.kind === 'tile') {
    return {
      id: `tile-${ref.pgroup}-${ref.pls}`,
      kind: 'tile',
      name: ref.name,
      pgroup: Number(ref.pgroup) || 0,
      pls: Number(ref.pls) || 0,
    };
  }
  return { id: 'none', kind: 'none' };
}

function toResolvedAimView(value: unknown): CombatTargetView {
  if (!value || typeof value !== 'object') return { id: 'none', kind: 'none' };
  const aim = value as Record<string, unknown>;
  const kind = String(aim.kind ?? 'none');
  if (kind === 'tile') {
    const pgroup = Number(aim.pgroup ?? 0);
    const pls = Number(aim.pls ?? 0);
    return { id: `tile-${pgroup}-${pls}`, kind: 'tile', pgroup, pls };
  }
  if (kind === 'character') {
    const pid = Number(aim.pid ?? 0);
    return { id: pid > 0 ? `pid-${pid}` : 'none', kind: 'pid', pid };
  }
  if (kind === 'self') {
    const pid = Number(aim.pid ?? 0);
    return { id: pid > 0 ? `pid-${pid}` : 'player', kind: 'self', pid };
  }
  return { id: 'none', kind: 'none' };
}

function toDirectedEffect(event: BattleLogV3Event): DirectedEffect {
  const payload = event.payload || {};
  const effectType = normalizeEffectType(String(payload.effect_type ?? event.effect_type ?? 'custom'));
  const target = payload.target
    ? toTargetView(payload.target)
    : { id: 'none', kind: 'none' as const };
  const value = typeof payload.value === 'number'
    ? payload.value
    : (event.effect_value !== null ? Number(event.effect_value) : undefined);
  const detail = payload.detail && typeof payload.detail === 'object'
    ? payload.detail as Record<string, unknown>
    : {};

  return {
    effectUid: String(payload.effect_uid ?? event.effect_uid ?? `effect-${event.log_id}`),
    rawLogId: event.log_id,
    type: effectType,
    source: toCombatantView(payload.source) ?? undefined,
    target,
    value,
    delta: payload.delta,
    detail,
    visual: decideEffectVisual(effectType, target, value),
    text: buildEffectText(effectType, target, value, detail),
  };
}

function normalizeEffectType(type: string): DirectedEffect['type'] {
  if (type === 'damage' || type === 'heal' || type === 'move' || type === 'escape' || type === 'ap_change' || type === 'status') {
    return type;
  }
  return 'custom';
}

function decideActionAnimation(actionId: string, actor: CombatantView, targets: CombatTargetView[]): ActionAnimationPlan {
  const targetIds = targets.map(t => t.id).filter(id => id !== 'none');
  if (actionId === 'throw') {
    return { kind: 'projectile', attackerId: actor.id, targetIds, impactAt: 300 };
  }
  if (actionId === 'escape') {
    return { kind: 'escape', attackerId: actor.id, targetIds: [actor.id] };
  }
  if (targetIds.length > 0) {
    return { kind: 'melee_hit', attackerId: actor.id, targetIds, impactAt: 260 };
  }
  return { kind: 'none', attackerId: actor.id, targetIds };
}

function deriveActionAnimationFromEffects(action: DirectedAction): ActionAnimationPlan {
  const moveEffect = action.effects.find(effect =>
    effect.type === 'move' &&
    effect.target.kind === 'tile' &&
    effect.target.id !== 'none',
  );
  if (moveEffect) {
    return {
      kind: 'move',
      attackerId: action.actor.id,
      targetIds: [moveEffect.target.id],
      impactAt: 450,
    };
  }

  const damageEffects = action.effects.filter(effect =>
    effect.type === 'damage' &&
    effect.target.id !== 'none',
  );
  if (damageEffects.length > 1 || (damageEffects.length > 0 && action.targets.some(target => target.kind === 'tile'))) {
    return {
      kind: 'area_burst',
      attackerId: action.actor.id,
      targetIds: uniqueIds(damageEffects.map(effect => effect.target.id)),
      impactAt: 350,
    };
  }

  if (damageEffects.length === 1 && action.animation.kind === 'melee_hit') {
    return {
      ...action.animation,
      targetIds: [damageEffects[0].target.id],
    };
  }

  const hasHealOnly = action.effects.some(effect => effect.type === 'heal') && damageEffects.length === 0;
  if (hasHealOnly) {
    return {
      kind: 'none',
      attackerId: action.actor.id,
      targetIds: [],
    };
  }

  return action.animation;
}

function uniqueIds(ids: string[]): string[] {
  return Array.from(new Set(ids.filter(id => id !== 'none')));
}

function decideEffectVisual(type: DirectedEffect['type'], target: CombatTargetView, value?: number): EffectVisualPlan {
  if (type === 'damage') return { kind: 'damage_number', targetId: target.id, value };
  if (type === 'heal') return { kind: 'heal_number', targetId: target.id, value };
  if (type === 'move') return { kind: 'move_avatar', targetId: target.id };
  if (type === 'escape') return { kind: 'fade_out', targetId: target.id };
  return { kind: 'none' };
}

function buildActionText(actionId: string, actor: CombatantView, targets: CombatTargetView[]): TextCue {
  return renderBattleAction(actionId, actor, targets);
}

function buildEffectText(
  type: DirectedEffect['type'],
  target: CombatTargetView,
  value?: number,
  detail: Record<string, unknown> = {},
): TextCue | undefined {
  return renderBattleEffect(type, target, value, detail);
}

interface NoticeFields {
  actor?: CombatantView | null;
  combatant?: CombatantView | null;
  actionId?: string | null;
  reason?: string | null;
  winnerPid?: number | null;
}

function buildNoticeText(
  event: BattleLogV3Event,
  battleEndInfo: BattleEndInfo | null,
  fields?: NoticeFields,
): TextCue {
  const ctx: NoticeTextContext = {
    event,
    battleEnd: battleEndInfo,
    actor: fields?.actor ?? null,
    combatant: fields?.combatant ?? null,
    actionId: fields?.actionId ?? null,
    reason: fields?.reason ?? null,
    winnerPid: fields?.winnerPid ?? null,
  };
  return renderBattleNotice(ctx);
}

/**
 * 预扫描事件流，显式计算 battle_end 胜负判定的上下文（BattleEndInfo）。
 *
 * 框架基准设计（非推断补丁）：
 * - playerPid：从事件流中所有 combatant snapshot（actor/combatant/survivors）识别 type===0
 * - playerSurvived：battle_end.payload.survivors 中是否含 playerPid（显式检查，非推断）
 * - playerEscaped：事件流中是否存在玩家本人的 combatant_cleared.reason==='escaped'
 * - winnerPid / reason：从 battle_end 事件获取
 *
 * 两个场景的自动覆盖：
 * - 玩家逃跑：playerSurvived=false + playerEscaped=true → 逃离
 * - NPC 全逃跑：playerSurvived=true + winnerPid===playerPid → 胜利
 */
function computeBattleEndContext(events: BattleLogV3Event[]): BattleEndInfo | null {
  let playerPid = 0;
  let playerEscaped = false;
  let playerSurvived = false;
  let winnerPid: number | null = null;
  let reason = '';
  let hasBattleEnd = false;

  for (const event of events) {
    const payload = (event.payload || {}) as Record<string, unknown>;

    // 识别 playerPid：从任何含 combatant snapshot 的字段扫描 type=0
    if (playerPid === 0) {
      const candidates: unknown[] = [
        payload.actor,
        payload.combatant,
        ...(Array.isArray(payload.survivors) ? payload.survivors : []),
      ];
      for (const candidate of candidates) {
        const view = combatantViewFromSnapshot(candidate as CombatantSnapshot);
        if (view && view.type === 0) {
          playerPid = view.pid;
          break;
        }
      }
    }

    // 玩家本人 escaped
    if (event.event_type === 'combatant_cleared' && !playerEscaped && playerPid > 0) {
      const clearedReason = String(payload.reason ?? event.reason ?? '');
      if (clearedReason === 'escaped' && payload.combatant && typeof payload.combatant === 'object') {
        const view = combatantViewFromSnapshot(payload.combatant as CombatantSnapshot);
        if (view && view.pid === playerPid) {
          playerEscaped = true;
        }
      }
    }

    // 从 battle_end 获取 winnerPid、reason，并检查 playerSurvived
    if (event.event_type === 'battle_end') {
      hasBattleEnd = true;
      winnerPid = event.winner_pid ?? null;
      reason = String(event.reason ?? '');
      if (playerPid > 0 && Array.isArray(payload.survivors)) {
        playerSurvived = (payload.survivors as CombatantSnapshot[]).some(
          s => Number(s.pid) === playerPid,
        );
      }
    }
  }

  if (!hasBattleEnd) return null;
  return { playerPid, playerSurvived, playerEscaped, winnerPid, reason };
}
