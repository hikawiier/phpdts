// ══════════════════════════════════════════════════
// 战斗导演模块 / Battle Director
//
// 把后端 raw battlelog entries 编排为分层演出脚本 PlayScript。
//
// 三层架构定位（设计案2 v3）：
//   后端给全原料 → 【本模块】导演集中编排 → 演员纯执行
//
// 模块性质：
//   - 同步纯函数：不涉及异步、不查 API、不修改 store 状态
//   - 无副作用：不修改输入 entries
//   - 一次性处理：拉取到一批 entries 后一次性编排完
//
// 调用时机（fetchAndPlayBattleLog 中）：
//   拉取 entries → BattleDirector.direct(entries) → extractNpcPid → BattlePlayer.play → markBattleLogPlayed
//
// 关联文档：oblivions/docs/设计案2-新建前端导演系统.md
// ══════════════════════════════════════════════════

import type { BattleLogEntry, RollData } from '@/types/api';

// ─────────────────────────────────────────────────
// 输出类型定义
// ─────────────────────────────────────────────────

/** 动画类型 */
export type AnimationType = 'none' | 'collision';

/** HP 快照（from/to 配对，仅 action kind 且非非伤害动作时有） */
export interface HpSnapshot {
  actorHpBefore: number;
  actorHpAfter: number;
  actorMaxHp: number;
  targetHpBefore: number;
  targetHpAfter: number;
  targetMaxHp: number;
}

/** 7 种渲染分发标记 */
export type DirectedKind =
  | 'action'              // pre+post 合并动作
  | 'initiative'          // 先攻掷骰（携带 rolls）
  | 'flee'                // 逃跑
  | 'combatant_cleared'   // 某人被清出队列（死亡/逃跑）
  | 'battle_end'          // 标准战斗终结（Phase 1，有赢家）
  | 'ambush_battle_end'   // 突袭阶段结束（Phase 0，无赢家概念）
  | 'display';            // 其他纯展示（ap_recover/verify_failed/middle_check 等）

/** 导演编排后的单条条目 */
export interface DirectedEntry extends BattleLogEntry {
  /** 动画类型（导演决定，仅 action kind 有意义） */
  animation: AnimationType;
  /** HP 快照（仅 action kind 且非非伤害动作时有） */
  hpSnapshot: HpSnapshot | null;
  /** 演员渲染分发标记 */
  directedKind: DirectedKind;
}

/** 段类型 */
export type SegmentKind =
  | 'phase0'              // Phase 0（ambush 攻击，无 Turn/Round）
  | 'round'               // Phase 1 的一轮
  | 'turn'                // Phase 1 的一回合
  | 'battle_end'          // 标准战斗终结
  | 'ambush_battle_end';  // 突袭阶段结束

/** 段元数据 */
export interface SegmentMeta {
  /** Round 序号（1-based，仅 round/turn 段有） */
  roundNum?: number;
  /** Turn 序号（1-based，仅 turn 段有） */
  turnNum?: number;
  /** 本回合行动者 pid（仅 turn 段有，来自 ap_recover 的 actor_pid） */
  actorPid?: number;
  /** 本回合行动者名称（仅 turn 段有） */
  actorName?: string;
  /** 先攻顺序（仅 round 段有，来自 initiative_roll 的 rolls） */
  initiatorOrder?: RollData[];
  /** 突袭者 pid（仅 round 段有，来自 ambush_pid） */
  ambushPid?: number;
  /** 战斗结束赢家 pid（仅 battle_end 段有） */
  winnerPid?: number;
  /** 战斗结束原因（battle_end / ambush_battle_end 段有） */
  reason?: string;
  /** 突袭者 pid（仅 ambush_battle_end 段有） */
  ambusherPid?: number;
  /** 标识本段是否为 Phase 0（true=突袭攻击段） */
  isPhase0?: boolean;
}

/** 演出段 */
export interface PlaySegment {
  /** 段类型 */
  kind: SegmentKind;
  /** 本段内的条目（已配对、已标记 directedKind） */
  entries: DirectedEntry[];
  /** 段元数据 */
  meta: SegmentMeta;
}

/** 导演编排后的完整输出 */
export interface PlayScript {
  /** 按序排列的演出段 */
  segments: PlaySegment[];
}

// ─────────────────────────────────────────────────
// 内部常量
// ─────────────────────────────────────────────────

/** 非伤害动作白名单（不产生 HP 变化的动作，hpSnapshot 置 null） */
const nonDamageActions = ['escape'];

/** 攻击类动作白名单（触发 collision 动画） */
const attackActions = ['unarmed_strike'];

// ─────────────────────────────────────────────────
// 主函数
// ─────────────────────────────────────────────────

/**
 * 战斗导演：把后端 raw entries 编排为分层演出脚本
 *
 * 编排顺序：
 * 1. 配对 once_execute_pre/post，合并为 action DirectedEntry
 * 2. 按 bl_segment_flag / bl_turn_num / bl_round_num 构建 PlaySegment[]
 *
 * @param entries 后端 raw battlelog entries（按 log_id 升序，已过滤 debug=true）
 * @returns 分层演出脚本
 */
export function direct(entries: BattleLogEntry[]): PlayScript {
  const paired = pairPrePost(entries);
  const script = buildSegments(paired);

  // dev 模式 debug：挂到 window.__battleScript，方便控制台随时查看
  if (import.meta.env.DEV) {
    (globalThis as Record<string, unknown>).__battleScript = script;
    (globalThis as Record<string, unknown>).__battleRawEntries = entries;
    console.dir(script);
  }

  return script;
}

/**
 * 导出 PlayScript 为 JSON 文件并触发浏览器下载（debug 用）
 *
 * 用法：在浏览器控制台执行
 *   import('@/stores/battle-director').then(m => m.exportScriptToJson())
 * 或先确保 direct() 已执行过，直接调本函数读取 window.__battleScript
 *
 * @param script 可选，默认读 window.__battleScript
 */
export function exportScriptToJson(script?: PlayScript): void {
  const s = script ?? (globalThis as Record<string, unknown>).__battleScript as PlayScript | undefined;
  if (!s) {
    console.warn('[BattleDirector] exportScriptToJson: 无可用 script（window.__battleScript 为空）');
    return;
  }
  const json = JSON.stringify(s, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `battle-script-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─────────────────────────────────────────────────
// 配对函数 pairPrePost
// ─────────────────────────────────────────────────

interface PendingPre {
  pre: BattleLogEntry;
  /** pre→post 之间的 interleaving 条目（如 flee/middle_check） */
  buffer: BattleLogEntry[];
}

/**
 * 配对 once_execute_pre / once_execute_post
 *
 * 栈配对 + 缓冲 interleaving 条目：
 *   - pre 到来时压栈
 *   - interleaving 条目缓冲到 pending.buffer
 *   - post 到来时合并 pre+post，先输出合并条目，再刷出缓冲条目
 *
 * 异常处理：
 *   - 悬空 pre（连续两个 pre 无 post）：旧 pre 降级为 display，新 pre 压栈
 *   - 孤儿 post（无对应 pre）：降级为 display
 *   - 尾部未配对 pre：降级为 display
 */
function pairPrePost(entries: BattleLogEntry[]): DirectedEntry[] {
  const result: DirectedEntry[] = [];
  let pending: PendingPre | null = null;

  for (const e of entries) {
    if (e.phase === 'once_execute_pre') {
      // 悬空 pre（异常：连续两个 pre 无 post）→ 旧 pre 降级刷出
      if (pending) {
        result.push(toDisplay(pending.pre));
        pending.buffer.forEach(b => result.push(toDisplay(b)));
      }
      pending = { pre: e, buffer: [] };

    } else if (e.phase === 'once_execute_post') {
      if (pending) {
        // 配对成功：合并 pre+post，再刷出缓冲的 interleaving 条目
        result.push(mergePrePost(pending.pre, e));
        pending.buffer.forEach(b => result.push(toDisplay(b)));
        pending = null;
      } else {
        // 异常：post 无对应 pre → 降级为 display
        result.push(toDisplay(e));
      }

    } else {
      // interleaving 或 solo 条目
      if (pending) {
        // 处于 pre→post 之间：缓冲起来
        pending.buffer.push(e);
      } else {
        // 无 pending：直接输出
        result.push(toDisplay(e));
      }
    }
  }

  // 尾部未配对的 pre → 降级为 display
  if (pending) {
    result.push(toDisplay(pending.pre));
    pending.buffer.forEach(b => result.push(toDisplay(b)));
  }

  return result;
}

// ─────────────────────────────────────────────────
// 转换函数
// ─────────────────────────────────────────────────

/** phase → directedKind 映射 */
function toDirectedKind(e: BattleLogEntry): DirectedKind {
  switch (e.phase) {
    case 'once_execute_pre':     return 'action';             // mergePrePost 已合并
    case 'once_execute_post':    return 'action';             // 异常单 post，仍标 action
    case 'initiative_roll':      return 'initiative';
    case 'flee':                 return 'flee';
    case 'combatant_cleared':    return 'combatant_cleared';
    case 'battle_end':           return 'battle_end';
    case 'ambush_battle_end':    return 'ambush_battle_end';
    default:                     return 'display';
  }
}

/** 把 raw entry 转为纯展示 DirectedEntry（无动画、无 HP 快照） */
function toDisplay(e: BattleLogEntry): DirectedEntry {
  return {
    ...e,
    animation: 'none',
    hpSnapshot: null,
    directedKind: toDirectedKind(e),
  };
}

/** 合并 pre/post 为一条完整 action DirectedEntry */
function mergePrePost(pre: BattleLogEntry, post: BattleLogEntry): DirectedEntry {
  const isNonDamage = pre.action_id !== null && nonDamageActions.includes(pre.action_id);
  return {
    ...pre,
    effect_value: post.effect_value,
    success: post.success,
    animation: decideAnimation(pre),
    hpSnapshot: isNonDamage ? null : {
      actorHpBefore: pre.actor_hp ?? 0,
      actorHpAfter: post.actor_hp ?? 0,
      actorMaxHp: pre.actor_max_hp ?? 1,
      targetHpBefore: pre.target_hp ?? 0,
      targetHpAfter: post.target_hp ?? 0,
      targetMaxHp: pre.target_max_hp ?? 1,
    },
    directedKind: 'action',
  };
}

/** 决定动画类型：attack 动作 → collision，其余 → none */
function decideAnimation(e: BattleLogEntry): AnimationType {
  if (e.action_id && attackActions.includes(e.action_id)) {
    return 'collision';
  }
  return 'none';
}

// ─────────────────────────────────────────────────
// 分段函数 buildSegments
// ─────────────────────────────────────────────────

/**
 * 按段边界信号构建 PlaySegment[]
 *
 * 分段规则（按 bl_segment_flag 驱动，不依赖 phase 字符串推断）：
 *   - 'round_start'         → 关闭当前段，开始新 round segment
 *   - 'turn_start'          → 关闭当前 turn，开始新 turn segment
 *   - 'battle_end'          → 追加 battle_end segment（单条段，立即关闭）
 *   - 'ambush_battle_end'   → 追加 ambush_battle_end segment（单条段，立即关闭）
 *   - null + 无 open segment → 归入 phase0 segment
 *   - null + 有 open segment → 归入当前段
 *
 * roundCounter/turnCounter 由导演本地维护，与后端 bl_round_num/bl_turn_num 独立
 * （导演计数用于演出显示"第 N 轮"，后端计数用于排序校验）。
 */
function buildSegments(entries: DirectedEntry[]): PlayScript {
  const segments: PlaySegment[] = [];
  let current: PlaySegment | null = null;
  let roundCounter = 0;
  let turnCounter = 0;
  let hasSeenRoundStart = false;

  const closeCurrent = (): void => {
    if (current && current.entries.length > 0) {
      segments.push(current);
    }
    current = null;
  };

  for (const e of entries) {
    // ── 段边界信号：round_start/turn_start 仅更新计数器，不创建段 ──
    //    （边界条目由后端在 battle_main 之后才 emit，内容条目已在前面，
    //      若创建独立段则内容无法归入正确轮次且段内无可见内容。）
    if (e.bl_segment_flag === 'round_start') {
      closeCurrent();
      hasSeenRoundStart = true;
      roundCounter = (e.bl_round_num ?? 0) + 1;
      turnCounter = 0;
      continue;
    }

    if (e.bl_segment_flag === 'turn_start') {
      closeCurrent();
      turnCounter = e.bl_turn_num ?? 0;
      continue;
    }

    if (e.bl_segment_flag === 'battle_end') {
      closeCurrent();
      current = {
        kind: 'battle_end',
        entries: [e],
        meta: {
          winnerPid: e.winner_pid ?? undefined,
          reason: e.reason ?? undefined,
        },
      };
      closeCurrent();   // battle_end 段立即关闭（单条段）
      continue;
    }

    if (e.bl_segment_flag === 'ambush_battle_end') {
      closeCurrent();
      current = {
        kind: 'ambush_battle_end',
        entries: [e],
        meta: {
          ambusherPid: e.ambusher_pid ?? undefined,
          reason: e.reason ?? undefined,
        },
      };
      closeCurrent();   // ambush_battle_end 段立即关闭（单条段）
      continue;
    }

    // ── 非边界条目：归入当前段 ──
    if (!current) {
      if (hasSeenRoundStart || e.bl_round_num !== null) {
        // Phase 1 内容（有轮次信息）
        const displayRound = hasSeenRoundStart
          ? roundCounter
          : ((e.bl_round_num ?? 0) + 1);
        current = {
          kind: 'turn',
          entries: [e],
          meta: {
            roundNum: displayRound,
            turnNum: turnCounter,
            actorPid: e.actor_pid ?? undefined,
            actorName: e.actor_name ?? undefined,
          },
        };
      } else {
        // 无轮次信息 → Phase 0（突袭攻击）
        current = {
          kind: 'phase0',
          entries: [e],
          meta: { isPhase0: true },
        };
      }
    } else {
      current.entries.push(e);
    }
  }

  closeCurrent();
  return { segments };
}

// ─────────────────────────────────────────────────
// 辅助函数（供 battle.ts / BattlePlayer 使用）
// ─────────────────────────────────────────────────

/**
 * 从 PlayScript 中提取 NPC PID
 *
 * 替代现有 battle.ts 的 groupByEncounter()。
 * 单 NPC 战斗约束下，从第一条非零 actor_type/target_type 中提取 NPC pid。
 */
export function extractNpcPid(script: PlayScript): number {
  for (const seg of script.segments) {
    for (const e of seg.entries) {
      if (Number(e.actor_type) > 0) return Number(e.actor_pid);
      if (Number(e.target_type) > 0) return Number(e.target_pid);
    }
  }
  return 0;
}

/**
 * 判断脚本是否包含 combat 动作（有具体目标的 action）
 *
 * 用于决定演出模式（combat vs flow）：
 *   - 有 combat 动作 → 需要 HP 条 + 碰撞动画
 *   - 纯系统事件（initiative_roll/ap_recover/battle_end）→ flow 模式
 */
export function hasCombatEntries(script: PlayScript): boolean {
  return script.segments.some(seg =>
    seg.entries.some(e =>
      e.directedKind === 'action' &&
      Number(e.actor_pid) > 0 && Number(e.target_pid) > 0,
    ),
  );
}

/**
 * 收集所有原始 log_id（供 markBattleLogPlayed 使用）
 *
 * 基于原始 entries 而非导演输出，确保异常条目（降级为 display）的 log_id 也被标记，
 * 不会重复播放。
 */
export function collectAllLogIds(entries: BattleLogEntry[]): number[] {
  return entries.map(e => Number(e.log_id)).filter(id => id > 0);
}
