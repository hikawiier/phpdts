import type {
  BattleLogRawEntry,
  BattleLogV2Event,
  CombatantSnapshot,
  CombatTargetRef,
  StateDelta,
} from '@/types/api';
import { escapeHtml } from '@/utils/format';

export type BattleSegmentKindV2 = 'round_intro' | 'turn' | 'battle_end' | 'system';

export interface CombatantView {
  id: string;
  pid: number;
  type: number;
  name: string;
  hp: number;
  maxHp: number;
  ap?: number;
  maxAp?: number;
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

export interface DirectedEffectV2 {
  effectUid: string;
  rawLogId: number;
  type: 'damage' | 'heal' | 'move' | 'escape' | 'ap_change' | 'status' | 'custom';
  source?: CombatantView | null;
  target: CombatTargetView;
  value?: number;
  delta?: StateDelta;
  visual: EffectVisualPlan;
  text?: TextCue;
}

export interface DirectedActionV2 {
  actionUid: string;
  rawLogId: number;
  actionId: string;
  actor: CombatantView;
  targets: CombatTargetView[];
  effects: DirectedEffectV2[];
  success: boolean;
  reason?: string | null;
  animation: ActionAnimationPlan;
  text: TextCue[];
}

export interface DirectedNoticeV2 {
  type: 'action_failed' | 'combatant_cleared' | 'battle_end' | 'notice' | 'diagnostic';
  text: TextCue;
  rawLogId: number;
  actor?: CombatantView | null;
  combatant?: CombatantView | null;
  actionId?: string | null;
  reason?: string | null;
  winnerPid?: number | null;
}

export interface BattleSegmentV2 {
  kind: BattleSegmentKindV2;
  roundNum?: number;
  turnNum?: number;
  actor?: CombatantView;
  actions: DirectedActionV2[];
  notices: DirectedNoticeV2[];
}

export interface BattlePlayScriptV2 {
  schema: 'battleplay.v2';
  segments: BattleSegmentV2[];
  rawLogIds: number[];
}

export type PlaybackStepKind =
  | 'prepare_map'
  | 'segment_context'
  | 'action_animation'
  | 'combatant_cleared'
  | 'modal_text'
  | 'damage_linger';

export type PlaybackAwaitPolicy = 'none' | 'completion' | 'duration';

export interface PlaybackStepBase {
  id: string;
  kind: PlaybackStepKind;
  awaitPolicy: PlaybackAwaitPolicy;
  timeout?: number;
}

export interface PrepareMapStep extends PlaybackStepBase {
  kind: 'prepare_map';
  segment: BattleSegmentV2;
}

export interface SegmentContextStep extends PlaybackStepBase {
  kind: 'segment_context';
  segment: BattleSegmentV2;
}

export interface ActionAnimationStep extends PlaybackStepBase {
  kind: 'action_animation';
  segment: BattleSegmentV2;
  action: DirectedActionV2;
}

export interface CombatantClearedStep extends PlaybackStepBase {
  kind: 'combatant_cleared';
  segment: BattleSegmentV2;
  notice: DirectedNoticeV2;
}

export interface ModalTextStep extends PlaybackStepBase {
  kind: 'modal_text';
  segment: BattleSegmentV2;
  options: {
    alwaysShowHeader?: boolean;
    isBattleEnd?: boolean;
  };
}

export interface DamageLingerStep extends PlaybackStepBase {
  kind: 'damage_linger';
  segment: BattleSegmentV2;
  effects: DirectedEffectV2[];
}

export type PlaybackStep =
  | PrepareMapStep
  | SegmentContextStep
  | ActionAnimationStep
  | CombatantClearedStep
  | ModalTextStep
  | DamageLingerStep;

export interface BattlePlaybackPlan {
  schema: 'battleplayback.v1';
  script: BattlePlayScriptV2;
  steps: PlaybackStep[];
}

interface PendingAction {
  action: DirectedActionV2;
  roundNum?: number;
  turnNum?: number;
  order: number;
}

export function isBattleLogV2Event(entry: BattleLogRawEntry): entry is BattleLogV2Event {
  return (entry as BattleLogV2Event).schema === 'battlelog.v2';
}

export function directV2(events: BattleLogV2Event[]): BattlePlayScriptV2 {
  const renderEvents = events
    .filter(e => e.channel === 'render')
    .slice()
    .sort((a, b) => Number(a.log_id) - Number(b.log_id));

  const pending = new Map<string, PendingAction>();
  const segments: BattleSegmentV2[] = [];
  const rawLogIds = events.map(e => Number(e.log_id)).filter(id => id > 0);
  let order = 0;

  const getTurnSegment = (event: BattleLogV2Event, actor?: CombatantView): BattleSegmentV2 => {
    const roundNum = event.bl_round_num !== null ? event.bl_round_num + 1 : undefined;
    const turnNum = event.bl_turn_num ?? undefined;
    let segment = segments.find(seg =>
      seg.kind === 'turn' &&
      seg.roundNum === roundNum &&
      seg.turnNum === turnNum,
    );
    if (!segment) {
      segment = {
        kind: 'turn',
        roundNum,
        turnNum,
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

  const flushAction = (uid: string, event: BattleLogV2Event): void => {
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
    if (event.event_type === 'round_start') {
      const roundNum = event.bl_round_num !== null ? event.bl_round_num + 1 : undefined;
      const exists = segments.some(seg => seg.kind === 'round_intro' && seg.roundNum === roundNum);
      if (!exists) {
        segments.push({
          kind: 'round_intro',
          roundNum,
          actions: [],
          notices: [],
        });
      }
      continue;
    }

    if (event.event_type === 'turn_start') {
      const actor = toCombatantView(payload.actor);
      getTurnSegment(event, actor ?? undefined);
      continue;
    }

    if (event.event_type === 'action_start') {
      const actor = toCombatantView(payload.actor);
      if (!actor) continue;
      const actionUid = String(payload.action_uid ?? event.action_uid ?? '');
      if (!actionUid) continue;
      const targets = Array.isArray(payload.targets)
        ? payload.targets.map(toTargetView)
        : [];
      const actionId = String(payload.action_id ?? event.action_id ?? 'unknown');
      pending.set(actionUid, {
        order: order++,
        roundNum: event.bl_round_num ?? undefined,
        turnNum: event.bl_turn_num ?? undefined,
        action: {
          actionUid,
          rawLogId: event.log_id,
          actionId,
          actor,
          targets,
          effects: [],
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
      segment.notices.push({
        type: 'action_failed',
        rawLogId: event.log_id,
        actor,
        actionId: String(payload.action_id ?? event.action_id ?? '动作'),
        reason: String(payload.reason ?? event.reason ?? 'unknown'),
        text: {
          html: `${htmlText(actor?.name ?? '行动者')}的${htmlText(payload.action_id ?? event.action_id ?? '动作')}失败：${htmlText(payload.reason ?? event.reason ?? 'unknown')}`,
          tone: 'danger',
        },
      });
      continue;
    }

    if (event.event_type === 'combatant_cleared') {
      const combatant = toCombatantView(payload.combatant);
      const segment = getTurnSegment(event, combatant ?? undefined);
      segment.notices.push({
        type: 'combatant_cleared',
        rawLogId: event.log_id,
        combatant,
        reason: String(payload.reason ?? event.reason ?? 'unknown'),
        text: {
          html: `${htmlText(combatant?.name ?? event.cleared_name ?? '参战者')}已退出战斗（${htmlText(payload.reason ?? event.reason ?? 'unknown')}）`,
          tone: 'system',
        },
      });
      continue;
    }

    if (event.event_type === 'battle_end') {
      segments.push({
        kind: 'battle_end',
        actions: [],
        notices: [{
          type: 'battle_end',
          rawLogId: event.log_id,
          reason: String(payload.reason ?? event.reason ?? 'unknown'),
          winnerPid: payload.winner_pid !== undefined && payload.winner_pid !== null
            ? Number(payload.winner_pid)
            : (event.winner_pid ?? null),
          text: {
            html: `战斗结束：${htmlText(payload.reason ?? event.reason ?? 'unknown')}`,
            tone: 'system',
          },
        }],
      });
      continue;
    }

    if (event.event_type === 'notice') {
      const segment = getTurnSegment(event);
      segment.notices.push({
        type: 'notice',
        rawLogId: event.log_id,
        reason: buildNoticeText(event),
        text: {
          html: buildNoticeText(event),
          tone: 'system',
        },
      });
    }
  }

  for (const item of Array.from(pending.values()).sort((a, b) => a.order - b.order)) {
    let segment = segments.find(seg =>
      seg.kind === 'turn' &&
      seg.roundNum === (item.roundNum !== undefined ? item.roundNum + 1 : undefined) &&
      seg.turnNum === item.turnNum,
    );
    if (!segment) {
      segment = {
        kind: 'turn',
        roundNum: item.roundNum !== undefined ? item.roundNum + 1 : undefined,
        turnNum: item.turnNum,
        actor: item.action.actor,
        actions: [],
        notices: [],
      };
      segments.push(segment);
    }
    segment.actions.push(item.action);
  }

  return { schema: 'battleplay.v2', segments, rawLogIds };
}

export function planPlaybackV2(script: BattlePlayScriptV2): BattlePlaybackPlan {
  const steps: PlaybackStep[] = [];
  let order = 0;
  const nextId = (kind: PlaybackStepKind, segment: BattleSegmentV2): string => {
    const segKey = [
      segment.kind,
      segment.roundNum ?? 'x',
      segment.turnNum ?? 'x',
      order++,
    ].join('-');
    return `${kind}-${segKey}`;
  };

  for (const segment of script.segments) {
    if (segment.kind === 'round_intro') {
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
        id: nextId('modal_text', segment),
        kind: 'modal_text',
        segment,
        options: { isBattleEnd: true },
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
        id: `${nextId('action_animation', segment)}-${action.actionUid}`,
        kind: 'action_animation',
        segment,
        action,
        awaitPolicy: action.animation.kind === 'none' ? 'none' : 'completion',
        timeout: action.animation.kind === 'move' ? 2200 : 1400,
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

    steps.push({
      id: nextId('damage_linger', segment),
      kind: 'damage_linger',
      segment,
      effects: segment.actions.flatMap(action => action.effects),
      awaitPolicy: 'none',
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
    maxHp: Number(s.max_hp) || 0,
    ap: s.ap !== undefined ? Number(s.ap) : undefined,
    maxAp: s.max_ap !== undefined ? Number(s.max_ap) : undefined,
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

function toDirectedEffect(event: BattleLogV2Event): DirectedEffectV2 {
  const payload = event.payload || {};
  const effectType = normalizeEffectType(String(payload.effect_type ?? event.effect_type ?? 'custom'));
  const target = payload.target
    ? toTargetView(payload.target)
    : { id: 'none', kind: 'none' as const };
  const value = typeof payload.value === 'number'
    ? payload.value
    : (event.effect_value !== null ? Number(event.effect_value) : undefined);

  return {
    effectUid: String(payload.effect_uid ?? event.effect_uid ?? `effect-${event.log_id}`),
    rawLogId: event.log_id,
    type: effectType,
    source: toCombatantView(payload.source) ?? undefined,
    target,
    value,
    delta: payload.delta,
    visual: decideEffectVisual(effectType, target, value),
    text: buildEffectText(effectType, target, value),
  };
}

function normalizeEffectType(type: string): DirectedEffectV2['type'] {
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

function deriveActionAnimationFromEffects(action: DirectedActionV2): ActionAnimationPlan {
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

function decideEffectVisual(type: DirectedEffectV2['type'], target: CombatTargetView, value?: number): EffectVisualPlan {
  if (type === 'damage') return { kind: 'damage_number', targetId: target.id, value };
  if (type === 'heal') return { kind: 'heal_number', targetId: target.id, value };
  if (type === 'move') return { kind: 'move_avatar', targetId: target.id };
  if (type === 'escape') return { kind: 'fade_out', targetId: target.id };
  return { kind: 'none' };
}

function buildActionText(actionId: string, actor: CombatantView, targets: CombatTargetView[]): TextCue {
  const targetNames = targets.map(t => t.name).filter(Boolean).join('、');
  return {
    html: `${htmlText(actor.name || '行动者')}使用了${htmlText(actionId)}${targetNames ? `，目标：${htmlText(targetNames)}` : ''}`,
    tone: 'normal',
  };
}

function buildEffectText(type: DirectedEffectV2['type'], target: CombatTargetView, value?: number): TextCue | undefined {
  const name = target.name || target.id;
  if (type === 'damage') return { html: `${htmlText(name)}受到${htmlText(value ?? 0)}点伤害`, tone: 'damage' };
  if (type === 'heal') return { html: `${htmlText(name)}恢复${htmlText(value ?? 0)}点生命`, tone: 'heal' };
  if (type === 'move') return { html: `${htmlText(name)}发生了位移`, tone: 'system' };
  if (type === 'escape') return { html: `${htmlText(name)}尝试脱离战斗`, tone: 'system' };
  return undefined;
}

function buildNoticeText(event: BattleLogV2Event): string {
  const payload = event.payload || {};
  const text = payload.message ?? payload.text ?? payload.title ?? payload.reason ?? event.reason;
  if (text !== undefined && text !== null && String(text) !== '') return String(text);
  if (payload.detail && typeof payload.detail === 'object') {
    return JSON.stringify(payload.detail);
  }
  return '战斗事件';
}

function htmlText(value: unknown): string {
  return escapeHtml(String(value));
}
