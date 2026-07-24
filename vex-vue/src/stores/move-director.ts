/**
 * @module K 状态管理层
 * @framework K-12 移动导演演出框架
 */

// ══════════════════════════════════════════════════
// MoveDirector — 移动导演演出层（F-K4-Director §5.2 / 设计案 §8.2）
//
// 承载"高层导航一次返回多次移动结果"的逐格演出会话。
//
// 核心原则（F-K4-Director §三不变量）：
//   1. 不是自动点击器：不循环发送单次移动请求；一次性消费后端返回的有序移动结果序列
//   2. 权威与演出分离：前端显示位置可能落后于最终权威位置，演出期间门控输入
//   3. 跳过不丢失领域事实：跳过动画不丢日志条目 / 发现 / 战斗结果（B6.3/B6.6/B6.7）
//   4. 输入门控统一复用 explore.navigationPlaying，不建第二套锁（§8.4）
//   5. 每次原子移动逐条记录日志，不合并（K-8）
//
// 状态机（F-K4-Director §四 与 K-7 平行）：
//   idle → playing → (arrived | interrupted_enemy | interrupted_combat | failed) → idle
//   playing ↔ rebasing（跳过时同步到权威状态）
//   playing → scene-transition（强制战斗场景交接）
//
// 与 3.5 反馈层的协同：
//   - 移动导演调用 discoveryStore.dispatchAttention(level, payload) 派发发现/中断反馈
//   - 反馈层调用 move-director.pausePlayback() / resumePlayback() 控制播放
// ══════════════════════════════════════════════════

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { commandQueue } from '@/stores/command-queue';
import { useExploreStore, type MoveTendency } from '@/stores/explore-store';
import { useMapStore } from '@/stores/map';
import { usePlayerAvatarStore } from '@/stores/player-avatar';
import { useSceneStore } from '@/stores/scene-store';
import {
  useDiscoveryStore,
  type AttentionLevel,
  type AttentionPayload,
} from '@/stores/discovery-store';
import { useToastStore } from '@/stores/toast';
import type { CommandResult } from '@/api/client';

// ── 演出会话状态机（F-K4-Director §四，与 K-7 平行） ──
export type DirectorPhase = 'idle' | 'playing' | 'rebasing' | 'scene-transition';

// ── 播放速度（B6.4/B6.5） ──
export type NavSpeed = 1 | 2 | 4;

// ── 导航结果 ──
export type NavOutcome =
  | 'idle'
  | 'playing'
  | 'arrived'
  | 'interrupted_enemy'
  | 'interrupted_combat'
  | 'failed';

// ── 移动 tick 事件（导航领域类型，3.4 移动导演本地定义） ──
// 注：discovery-store 的 AttentionPayload.moves/discoveries 使用 unknown[]，
// 此处类型仅用于 move-director 内部约束；传入 discovery 时由其防御性转换处理。
export interface MoveTickEvent {
  type: 'discover_enemy' | 'discover_poi' | 'discover_item' | 'forced_combat' | 'move';
  text: string;
  name?: string;
}

// ── 单次移动结果（用于派发注意力给 3.5 反馈层） ──
export interface MoveResult {
  seq: number;
  from_pls: number;
  to_pls: number;
  tile_name: string;
  events: MoveTickEvent[];
}

// ── 导航步骤（从后端返回的多次移动结果解析） ──
export interface NavigationStep {
  seq: number;
  from_pls: number;
  to_pls: number;
  tile_name: string;
  events: MoveTickEvent[];
}

// ── 发现记录 ──
export interface Discovery {
  kind: 'enemy' | 'poi' | 'item';
  name: string;
  at_pls: number;
}

// 1x 速度下单步演出时长（ms）
const BASE_STEP_MS = 500;

// ── 后端响应解析（从 CommandResult.gamedata 解析导航结果） ──
// 对齐 oblivions/include/command/obl_command_handlers.php 的 obl_command_build_navigation_result
// step 两种 kind：move / move_failed
// 中断不作为独立 step（设计案 §8.1：中断是最后一次移动的属性）
//   — move step 可选 interrupt 字段携带中断信息（enemy_discovered / poi_discovered / force_combat / no_sp / capability_lost）
interface RawStepData {
  seq: number;
  kind?: 'move' | 'move_failed';
  reason?: string;
  from?: { pgroup?: number; pls?: number };
  to?: { pgroup?: number; pls?: number };
  tick?: number;
  info?: {
    // fog_cleared 后端实际是 pls 数组（info_acquire.func.php L188/L239），不参与事件派生，宽松类型
    fog_cleared?: unknown[] | boolean;
    items_discovered?: Array<{ iid: number; pls: number; distance_tier?: string }>;
    enemies_discovered?: Array<{ pid: number; name: string; pls: number }>;
    pois_discovered?: Array<{ iaid: number; pls: number; poi_id?: string | number }>;
  };
  // move step 的 interrupt 字段（设计案 §8.1：中断作为最后一次移动的属性）
  // details 结构因 reason 而异（navigation.func.php obl_navigation_check_interrupt）
  interrupt?: {
    reason: string;
    tick: number;
    details?: {
      enemies?: Array<{ pid: number; name: string; pls: number }>;
      pois?: Array<{ iaid: number; pls: number; poi_id?: string | number }>;
      bid?: number;
      action?: string;
      capability?: string;
      [key: string]: unknown;
    };
  };
}

interface RawNavigationResult {
  steps?: RawStepData[];
  outcome?: string;      // arrived | interrupted | no_target | max_steps_reached
  outcome_reason?: string; // arrived | enemy_discovered | force_combat | move_failed | route_invalid | no_sp | capability_lost | target_invalid | max_steps_reached | poi_discovered | no_target
  final_position?: { pgroup?: number; pls?: number };
  target_pls?: number | null;
  target_is_auto?: boolean;
  tendency?: string;
  steps_taken?: number;
  max_steps?: number;
  navigation_id?: string;
}

/**
 * 将后端导航结果映射为人类可读的中文 interruptReason。
 *
 * - arrived：用 targetName 描述"已抵达 XXX"
 * - interrupted_enemy / interrupted_combat：固定中断描述
 * - failed：按 rawReason 子分支映射具体失败原因
 */
function humanizeOutcomeReason(outcome: NavOutcome, rawReason: string, targetName: string): string {
  switch (outcome) {
    case 'arrived':
      return `已抵达 ${targetName || '目标'}`;
    case 'interrupted_enemy':
      return '发现敌对目标，导航中断';
    case 'interrupted_combat':
      return '遭遇突袭，导航中断';
    case 'failed':
      switch (rawReason) {
        case 'no_target':
          return '未找到合适的移动目标';
        case 'route_invalid':
          return '无法找到通往目标的路线';
        case 'no_sp':
          return '体力不足，无法继续移动';
        case 'capability_lost':
          return '移动能力失效';
        case 'target_invalid':
          return '目标已失效';
        case 'move_failed':
          return '移动失败';
        case 'max_steps_reached':
          return '已达单次导航最大步数';
        case 'poi_discovered':
          return '发现 POI，导航中断';
        default:
          return '导航失败';
      }
    default:
      // idle / playing 不应出现在 parseNavigationResult 返回值中
      return '导航失败';
  }
}

/**
 * 从 CommandResult.gamedata 解析导航结果。
 *
 * 后端 map.navigate 一次返回多次移动结果（设计案 §8.1）。
 * 后端响应结构（obl_command_build_navigation_result）：
 *   gamedata.navigation = {
 *     steps: [{ seq, kind:'move'|'move_failed'|'interrupt', from:{pgroup,pls}, to:{pgroup,pls}, tick, info, reason, details }, ...],
 *     final_position: { pgroup, pls },
 *     outcome: 'arrived'|'interrupted'|'no_target'|'max_steps_reached',
 *     outcome_reason: 'arrived'|'enemy_discovered'|'force_combat'|'move_failed'|'route_invalid'|'no_sp'|'capability_lost'|'target_invalid'|'max_steps_reached'|'poi_discovered'|'no_target',
 *     target_pls: int|null,
 *     ...
 *   }
 * 若后端未返回结构化导航数据，降级为基于命令成功/失败的单步结果。
 */
function parseNavigationResult(result: CommandResult, startPls: number): {
  steps: NavigationStep[];
  outcome: NavOutcome;
  interruptReason: string;
  targetName: string;
  finalPls: number;
} {
  const gamedata = result.gamedata ?? {};
  const raw = (gamedata.navigation ?? gamedata.nav ?? null) as RawNavigationResult | null;

  // 步骤 1：仅当后端完全没有返回 navigation 字段（raw 本身为 null）时才降级
  // raw 存在但 steps 为空数组时不降级，继续走正常路径由 outcome 决定语义
  if (!raw) {
    if (!result.success) {
      return {
        steps: [],
        outcome: 'failed',
        interruptReason: result.message || '导航失败',
        targetName: '',
        finalPls: startPls,
      };
    }
    return {
      steps: [],
      outcome: 'arrived',
      interruptReason: result.message || '已抵达目标',
      targetName: '',
      finalPls: startPls,
    };
  }

  console.log('[NAV_DEBUG] parse_in', { rawOutcome: raw.outcome, rawReason: raw.outcome_reason, stepsCount: raw.steps?.length, targetPls: raw.target_pls, finalPosition: raw.final_position });

  // 步骤 2：解析 steps（即使为空数组也继续走正常路径）
  // 设计案 §8.1：中断作为最后一次 move step 的 interrupt 字段，不作为独立 step
  // 所有 step 都有 from/to（move 和 move_failed），curPls 仅作兜底
  const steps: NavigationStep[] = [];
  let curPls = startPls;
  if (Array.isArray(raw.steps)) {
    for (const s of raw.steps) {
      const fromPlsStep = s.from?.pls ?? curPls;
      const toPlsStep = s.to?.pls ?? curPls;
      // move kind 更新 curPls；move_failed 未实际移动，不更新
      if (s.kind !== 'move_failed') {
        curPls = toPlsStep;
      }
      steps.push({
        seq: s.seq,
        from_pls: fromPlsStep,
        to_pls: toPlsStep,
        tile_name: `(${toPlsStep})`,
        events: deriveStepEvents(s),
      });
    }
  }

  // 步骤 3：outcome 映射 — 后端 outcome+outcome_reason → 前端 NavOutcome（对所有 raw 存在的情况生效）
  const rawOutcome = raw.outcome ?? '';
  const rawReason = raw.outcome_reason ?? '';
  let outcome: NavOutcome;
  if (rawOutcome === 'arrived') {
    outcome = 'arrived';
  } else if (rawOutcome === 'max_steps_reached') {
    // max_steps_reached 不是 arrived：导航未抵达目标就达到最大步数限制
    // 映射为 failed，humanizeOutcomeReason 返回"已达单次导航最大步数"
    outcome = 'failed';
  } else if (rawOutcome === 'interrupted') {
    if (rawReason === 'enemy_discovered') outcome = 'interrupted_enemy';
    else if (rawReason === 'force_combat') outcome = 'interrupted_combat';
    else if (rawReason === 'move_failed') outcome = 'failed';
    else outcome = 'failed'; // route_invalid / no_sp / capability_lost / target_invalid / poi_discovered 等
  } else if (rawOutcome === 'no_target') {
    outcome = 'failed';
  } else {
    // 空字符串或未知 outcome：根据 result.success 兜底
    outcome = result.success ? 'arrived' : 'failed';
  }

  // 步骤 4：边界处理（隐藏敌人突袭）— interrupted_combat 但最后一个 step 无 forced_combat 事件 → 注入
  // force_combat 的 details 通常只有 {bid, action}（无敌人 name），deriveStepEvents 已生成
  // forced_combat 事件；此处兜底，确保 applyStep 在播放过程中能识别中断点（§8.5 场景交接）
  if (outcome === 'interrupted_combat' && steps.length > 0) {
    const lastStep = steps[steps.length - 1];
    if (!lastStep.events.some(e => e.type === 'forced_combat')) {
      lastStep.events.push({ type: 'forced_combat', text: '遭遇突袭' });
    }
  }

  // 步骤 5：targetName — 后端只有 target_pls（number|null），fallback 为"目标格 (N)"避免 toast 显示"已抵达 "
  const targetPlsRaw = raw.target_pls;
  const targetName = (typeof targetPlsRaw === 'number' && targetPlsRaw > 0)
    ? `目标格 (${targetPlsRaw})`
    : '';

  // finalPls：优先用 final_position.pls（最终权威位置），其次回退到最后一步的 to_pls
  const finalPls = raw.final_position?.pls
    ?? (steps.length > 0 ? steps[steps.length - 1].to_pls : startPls);

  // 步骤 6：生成人类可读的 interruptReason（替代原始枚举值）
  const interruptReason = humanizeOutcomeReason(outcome, rawReason, targetName);

  // 步骤 7：返回
  console.log('[NAV_DEBUG] parse_out', { outcome, interruptReason, targetName, finalPls, stepsCount: steps.length });
  return {
    steps,
    outcome,
    interruptReason,
    targetName,
    finalPls,
  };
}

/**
 * 根据 step.kind / step.info / step.interrupt 派生 MoveTickEvent[]。
 * 保证返回非空数组（move kind 无发现时注入"移动"占位事件，避免下游循环跳过）。
 *
 * 设计案 §8.1：中断作为最后一次 move step 的 interrupt 字段（不作为独立 step）
 * 派生顺序：先派生 info 中的发现事件，再追加 interrupt 中断事件
 *   — info.enemies_discovered 与 interrupt.details.enemies 同源（navigation.func.php check_interrupt）
 *   — enemy_discovered / poi_discovered 中断时去重，避免重复派生
 */
function deriveStepEvents(s: RawStepData): MoveTickEvent[] {
  const events: MoveTickEvent[] = [];

  if (s.kind === 'move_failed') {
    // MoveTickEvent 无专门 failed 类型，用 move + 失败文本表示
    events.push({ type: 'move', text: s.reason || '移动失败' });
    return events;
  }

  // kind === 'move' 或未指定 kind：遍历 info 派生发现事件
  const info = s.info;
  if (info) {
    for (const enemy of info.enemies_discovered ?? []) {
      events.push({ type: 'discover_enemy', text: '发现敌人', name: enemy.name });
    }
    for (const _poi of info.pois_discovered ?? []) {
      events.push({ type: 'discover_poi', text: '发现 POI' });
    }
    for (const _item of info.items_discovered ?? []) {
      events.push({ type: 'discover_item', text: '发现道具' });
    }
  }

  // 设计案 §8.1：从 s.interrupt 派生中断事件，追加到 move step 已有事件之后
  // 前端播放时先播移动/发现，再播中断（符合"先播放移动原因再切换战斗场景"的语义）
  const interrupt = s.interrupt;
  if (interrupt) {
    const reason = interrupt.reason;
    if (reason === 'force_combat') {
      // force_combat details 通常只有 {bid, action}（隐藏敌人突袭），无敌人 name
      // 若 details.enemies 存在（未来扩展），取第一个敌人 name
      const enemyName = interrupt.details?.enemies?.[0]?.name;
      events.push({ type: 'forced_combat', text: '遭遇突袭', name: enemyName });
    } else if (reason === 'enemy_discovered') {
      // info.enemies_discovered 通常已派生 discover_enemy 事件，去重避免重复
      const alreadyHasEnemyEvent = events.some(e => e.type === 'discover_enemy');
      if (!alreadyHasEnemyEvent) {
        const enemies = interrupt.details?.enemies ?? [];
        if (enemies.length > 0) {
          for (const e of enemies) {
            events.push({ type: 'discover_enemy', text: '发现敌人', name: e.name });
          }
        } else {
          events.push({ type: 'discover_enemy', text: '发现敌人' });
        }
      }
    } else if (reason === 'poi_discovered') {
      // 同 enemy_discovered：info.pois_discovered 已派生时不再重复
      const alreadyHasPoiEvent = events.some(e => e.type === 'discover_poi');
      if (!alreadyHasPoiEvent) {
        events.push({ type: 'discover_poi', text: '发现 POI' });
      }
    } else {
      // no_sp / capability_lost / target_invalid / route_invalid / max_steps_reached 等
      events.push({ type: 'move', text: reason || '导航中断' });
    }
  }

  // 占位事件：保证 events 非空，避免下游 play()/skip() 循环跳过此步
  if (events.length === 0) {
    events.push({ type: 'move', text: '移动' });
  }

  return events;
}

export const useMoveDirectorStore = defineStore('moveDirector', () => {
  const explore = useExploreStore();
  const mapStore = useMapStore();
  const playerAvatar = usePlayerAvatarStore();
  const sceneStore = useSceneStore();
  const discovery = useDiscoveryStore();
  const toastStore = useToastStore();

  // ── 演出会话状态 ──
  const phase = ref<DirectorPhase>('idle');
  const speed = ref<NavSpeed>(1);
  const steps = ref<NavigationStep[]>([]);
  const currentStepIndex = ref<number>(-1);
  const outcome = ref<NavOutcome>('idle');
  const interruptReason = ref<string>('');
  const targetName = ref<string>('');
  const discoveries = ref<Discovery[]>([]);
  const enRouteSummary = ref<string>('');
  const isPaused = ref<boolean>(false);
  const finalPls = ref<number>(0);

  let playTimer: ReturnType<typeof setTimeout> | null = null;

  // ══════════════════════════════════════════════════
  // 派生
  // ══════════════════════════════════════════════════

  const isPlaying = computed<boolean>(() => phase.value === 'playing' || phase.value === 'rebasing');
  const totalSteps = computed<number>(() => steps.value.length);
  const progress = computed<number>(() => {
    if (totalSteps.value === 0) return 0;
    return Math.min(1, (currentStepIndex.value + 1) / totalSteps.value);
  });
  const currentStep = computed<NavigationStep | null>(
    () => steps.value[currentStepIndex.value] ?? null,
  );
  const hasPendingDiscoveries = computed<boolean>(
    () => outcome.value === 'interrupted_enemy' && discoveries.value.length > 0,
  );
  const enemyDiscoveries = computed<Discovery[]>(() =>
    discoveries.value.filter((d) => d.kind === 'enemy'),
  );
  const otherDiscoveries = computed<Discovery[]>(() =>
    discoveries.value.filter((d) => d.kind !== 'enemy'),
  );

  // ══════════════════════════════════════════════════
  // 应用单个步骤的权威投影
  // ══════════════════════════════════════════════════

  /**
   * 应用单个步骤的权威投影：更新局部视野/迷雾 + 派发 K-10 移动意图 + 检查中断。
   * collectDiscoveries 控制是否累积进发现池（跳过时也累积，B6.3 不丢失领域事实）。
   */
  function applyStep(
    step: NavigationStep,
    collectDiscoveries: boolean,
  ): { interrupted: NavOutcome | null; combatName?: string } {
    console.log('[NAV_DEBUG] applyStep', { seq: step.seq, from: step.from_pls, to: step.to_pls, events: step.events });
    // 每个落点更新局部视野和迷雾（F-K4-Director §5.2）
    explore.markExplored(step.to_pls);

    // 更新玩家权威位置（F-K4-Director §5.2：每个落点更新权威位置）
    // 触发 useMapEntities 的 entity position watch → playWorldMove 逐格移动动画
    // 不更新 curLoc 会导致位置动画驱动链断裂，小人直接跳到最终位置
    // 只更新 curLoc，不更新 links/enemies（避免触发完整地图重载 / enemy roster 重置）
    mapStore.updateMapData({ curLoc: step.to_pls });

    // 派发 K-10 移动意图（连续移动确保序号递增，避免 50ms 抑制）
    playerAvatar.onNavigateMove();

    let interrupted: NavOutcome | null = null;
    let combatName: string | undefined;
    for (const ev of step.events) {
      if (ev.type === 'discover_enemy') {
        if (collectDiscoveries) {
          discoveries.value.push({ kind: 'enemy', name: ev.name || '敌人', at_pls: step.to_pls });
        }
        interrupted = 'interrupted_enemy';
      } else if (ev.type === 'discover_poi') {
        if (collectDiscoveries) {
          discoveries.value.push({ kind: 'poi', name: ev.name || 'POI', at_pls: step.to_pls });
        }
      } else if (ev.type === 'discover_item') {
        if (collectDiscoveries) {
          discoveries.value.push({ kind: 'item', name: ev.name || '道具', at_pls: step.to_pls });
        }
      } else if (ev.type === 'forced_combat') {
        combatName = ev.name;
        interrupted = 'interrupted_combat';
      }
    }
    return { interrupted, combatName };
  }

  // ══════════════════════════════════════════════════
  // 途中事件摘要（B6.8）
  // ══════════════════════════════════════════════════

  function buildSummary(): void {
    const parts: string[] = [];
    parts.push(`途中移动 ${currentStepIndex.value + 1} 格`);
    const enemies = discoveries.value.filter((d) => d.kind === 'enemy').map((d) => d.name);
    const pois = discoveries.value.filter((d) => d.kind === 'poi').map((d) => d.name);
    const items = discoveries.value.filter((d) => d.kind === 'item').map((d) => d.name);
    if (enemies.length) parts.push(`发现敌人：${enemies.join('、')}`);
    if (pois.length) parts.push(`发现 POI：${pois.join('、')}`);
    if (items.length) parts.push(`发现道具：${items.join('、')}`);
    enRouteSummary.value = parts.join('；');
  }

  // ══════════════════════════════════════════════════
  // 派发注意力事件给 3.5 反馈层
  // ══════════════════════════════════════════════════

  /**
   * 按注意力等级派发发现/中断反馈给 3.5 反馈层（接口契约固定）。
   * - normal：普通移动，不阻塞
   * - item：道具/POI 发现
   * - important：敌人发现，反馈层打开模态框并暂停播放
   * - force：强制战斗，移动导演完成场景交接
   */
  function dispatchAttentionToFeedback(
    level: AttentionLevel,
    interrupt?: { reason: string; type: 'combat' | 'event' },
  ): void {
    const movesResult: MoveResult[] = steps.value.slice(0, currentStepIndex.value + 1).map(s => ({
      seq: s.seq,
      from_pls: s.from_pls,
      to_pls: s.to_pls,
      tile_name: s.tile_name,
      events: s.events,
    }));
    const payload: AttentionPayload = {
      moves: movesResult,
      discoveries: discoveries.value,
      interrupt,
    };
    discovery.dispatchAttention(level, payload);
  }

  // ══════════════════════════════════════════════════
  // 播放循环
  // ══════════════════════════════════════════════════

  function play(): void {
    if (phase.value !== 'playing' || isPaused.value) return;
    if (currentStepIndex.value >= steps.value.length - 1) {
      finishArrived();
      return;
    }
    currentStepIndex.value++;
    const step = steps.value[currentStepIndex.value];
    const res = applyStep(step, true);
    if (res.interrupted) {
      handleInterrupt(res.interrupted, res.combatName);
      return;
    }
    // 普通移动反馈（不阻塞）
    dispatchAttentionToFeedback('normal');
    // 排程下一步：加速 = BASE_STEP_MS / speed（B6.4）
    playTimer = setTimeout(() => {
      play();
    }, BASE_STEP_MS / speed.value);
  }

  function finishArrived(): void {
    if (playTimer) {
      clearTimeout(playTimer);
      playTimer = null;
    }
    buildSummary();
    phase.value = 'idle';
    outcome.value = 'arrived';
    interruptReason.value = `已抵达 ${targetName.value}`;
    explore.setNavigationLock(false); // B6.13 演出追上权威状态后恢复输入
    toastStore.showToast(interruptReason.value, 'success', 1800, false, 'nav-arrived');
  }

  function handleInterrupt(reason: NavOutcome, combatName?: string): void {
    if (playTimer) {
      clearTimeout(playTimer);
      playTimer = null;
    }
    buildSummary();
    phase.value = 'idle';

    if (reason === 'interrupted_enemy') {
      // B3.6：保留已完成移动；在发现敌人的最后一次移动处中断；弹出发现模态
      outcome.value = 'interrupted_enemy';
      const n = enemyDiscoveries.value.length;
      interruptReason.value = `发现 ${n} 个敌对目标，导航中断`;
      // 演出已追上权威状态（中断点 = 最终权威位置），恢复输入；发现卡作为可关闭反馈
      explore.setNavigationLock(false);
      // 派发重要发现反馈给 3.5 反馈层（反馈层打开模态框时调用 pausePlayback）
      dispatchAttentionToFeedback('important');
    } else if (reason === 'interrupted_combat') {
      // B3.7 / §8.5：先播放已完成移动 → 在遭遇位置显示突袭原因 → 切换战斗场景
      outcome.value = 'interrupted_combat';
      interruptReason.value = combatName
        ? `遭遇 ${combatName} 突袭，导航中断`
        : '遭遇突袭，导航中断';
      explore.setNavigationLock(false);
      // 派发强制事件反馈给 3.5 反馈层
      dispatchAttentionToFeedback('force', { reason: interruptReason.value, type: 'combat' });
      // 场景交接：切换战斗场景（F-K4-Director §5.5/§5.6）
      phase.value = 'scene-transition';
      sceneStore.enterBattle();
      toastStore.showToast(interruptReason.value, 'error', 3000, false, 'nav-combat');
      // 交接完成后导演回到 idle（K-1 战斗导演接管）
      outcome.value = 'idle';
      phase.value = 'idle';
    }
  }

  // ══════════════════════════════════════════════════
  // 公共 API
  // ══════════════════════════════════════════════════

  /**
   * 开始导航：发送 map.navigate 命令 → 解析多次移动结果 → 开始逐格播放。
   *
   * 后端一次返回多次移动结果，前端不循环发送单次移动请求（F-K4-Director §三.1）。
   */
  async function startNavigation(tendency?: MoveTendency, target?: number): Promise<void> {
    if (isPlaying.value) return; // 演出期间阻止新的导航
    if (explore.inputLocked) return;

    resetSession();
    const usedTendency = tendency ?? explore.tendency;
    const fromPls = explore.playerPls ?? 0;

    // §8.4 门控开始：移动导演播放时阻止新的移动/探索/目标命令
    explore.setNavigationLock(true);

    const result = await commandQueue.execute({
      command: 'map.navigate',
      payload: {
        target: target,
        tendency: usedTendency,
      },
    });

    // 命令失败：解除门控 + 显示失败原因
    if (!result.success) {
      explore.setNavigationLock(false);
      outcome.value = 'failed';
      interruptReason.value = result.message || '导航失败';
      toastStore.showToast(interruptReason.value, 'error', 3000, false, 'nav-failed');
      return;
    }

    // 解析后端返回的多次移动结果
    const parsed = parseNavigationResult(result, fromPls);
    steps.value = parsed.steps;
    targetName.value = parsed.targetName;
    finalPls.value = parsed.finalPls;

    // 无步骤：直接抵达或失败
    if (steps.value.length === 0) {
      explore.setNavigationLock(false);
      if (parsed.outcome === 'failed') {
        outcome.value = 'failed';
        interruptReason.value = parsed.interruptReason || '导航失败';
        toastStore.showToast(interruptReason.value, 'error', 3000, false, 'nav-failed');
      } else {
        outcome.value = 'arrived';
        interruptReason.value = parsed.interruptReason || '已抵达目标';
        toastStore.showToast(interruptReason.value, 'success', 1800, false, 'nav-arrived');
      }
      return;
    }

    // 后端已判定中断（无需逐格播放完整序列）
    if (parsed.outcome === 'interrupted_combat') {
      // 强制战斗：先逐格播放已完成移动 → 场景交接（§8.5）
      // 但后端结果已包含中断点，直接同步到中断点
      phase.value = 'rebasing';
      // 同步应用所有步骤到中断点
      for (let i = 0; i < steps.value.length; i++) {
        currentStepIndex.value = i;
        const step = steps.value[i];
        const res = applyStep(step, true);
        if (res.interrupted) {
          handleInterrupt(res.interrupted, res.combatName);
          return;
        }
      }
      // 未在中途中断则抵达
      finishArrived();
      return;
    }

    if (parsed.outcome === 'interrupted_enemy') {
      // 发现敌人中断：先逐格播放到中断点（同上同步应用）
      phase.value = 'rebasing';
      for (let i = 0; i < steps.value.length; i++) {
        currentStepIndex.value = i;
        const step = steps.value[i];
        const res = applyStep(step, true);
        if (res.interrupted) {
          handleInterrupt(res.interrupted, res.combatName);
          return;
        }
      }
      finishArrived();
      return;
    }

    // 正常逐格播放
    phase.value = 'playing';
    outcome.value = 'playing';
    isPaused.value = false;
    currentStepIndex.value = -1;
    discoveries.value = [];
    enRouteSummary.value = '';
    play();
  }

  // ── 3.5 反馈层调用的暂停/恢复接口（接口契约固定） ──

  /**
   * 暂停播放后续移动（3.5 反馈层打开"重要发现"模态框时调用）。
   * 清除当前排程的定时器，保留播放位置。
   */
  function pausePlayback(): void {
    if (!isPlaying.value || isPaused.value) return;
    isPaused.value = true;
    if (playTimer) {
      clearTimeout(playTimer);
      playTimer = null;
    }
  }

  /**
   * 恢复播放（3.5 反馈层关闭"重要发现"模态框后调用）。
   */
  function resumePlayback(): void {
    if (!isPlaying.value || !isPaused.value) return;
    isPaused.value = false;
    play();
  }

  // ── 播放速度控制（B6.4/B6.5） ──

  function setSpeed(s: NavSpeed): void {
    speed.value = s;
  }

  /** 循环切换 1x → 2x → 4x → 1x */
  function cycleSpeed(): void {
    speed.value = speed.value === 1 ? 2 : speed.value === 2 ? 4 : 1;
  }

  /**
   * 跳过全部剩余演出（B6.3）：立即同步到最终权威状态。
   * 不丢失日志条目 / 发现 / 战斗结果；遇到中断仍显示最终原因（B6.6/B6.7/B6.8）。
   */
  function skip(): void {
    if (!isPlaying.value) return;
    if (playTimer) {
      clearTimeout(playTimer);
      playTimer = null;
    }
    phase.value = 'rebasing';
    // 同步应用所有剩余步骤，遇中断即停（保留中断语义）
    let lastInterrupted: NavOutcome | null = null;
    let combatName: string | undefined;
    for (let i = currentStepIndex.value + 1; i < steps.value.length; i++) {
      const step = steps.value[i];
      const res = applyStep(step, true);
      currentStepIndex.value = i;
      if (res.interrupted) {
        lastInterrupted = res.interrupted;
        combatName = res.combatName;
        break;
      }
    }
    buildSummary();
    phase.value = 'idle';
    explore.setNavigationLock(false);

    if (lastInterrupted === 'interrupted_enemy') {
      // B6.6：跳过后遇到重要发现仍弹出
      outcome.value = 'interrupted_enemy';
      const n = enemyDiscoveries.value.length;
      interruptReason.value = `发现 ${n} 个敌对目标，导航中断`;
      dispatchAttentionToFeedback('important');
    } else if (lastInterrupted === 'interrupted_combat') {
      // B6.7：跳过后遇到强制战斗仍切换场景，显示原因
      outcome.value = 'interrupted_combat';
      interruptReason.value = combatName
        ? `遭遇 ${combatName} 突袭，导航中断`
        : '遭遇突袭，导航中断';
      dispatchAttentionToFeedback('force', { reason: interruptReason.value, type: 'combat' });
      sceneStore.enterBattle();
      toastStore.showToast(interruptReason.value, 'error', 3000, false, 'nav-combat');
      outcome.value = 'idle';
    } else {
      outcome.value = 'arrived';
      interruptReason.value = `已抵达 ${targetName.value}`;
      toastStore.showToast(`跳过演出；${enRouteSummary.value}`, 'info', 2000, false, 'nav-skipped');
    }
  }

  /**
   * 关闭发现卡（B3.6 玩家确认敌人发现）。
   *
   * 注意：3.5 反馈层的 DiscoveryModal 由 discovery-store.closeModal() 统一管理关闭，
   * 本方法仅清理 move-director 本地的发现池与中断状态——
   * DiscoveryModal 的关闭由其自身按钮（继续/进入战斗预装填/一键前往）触发，
   * 关闭时 discovery-store 会调用 _playbackController.resumePlayback() 恢复播放。
   */
  function dismissDiscoveries(): void {
    discoveries.value = [];
    if (outcome.value === 'interrupted_enemy' || outcome.value === 'arrived' || outcome.value === 'failed') {
      outcome.value = 'idle';
      interruptReason.value = '';
      enRouteSummary.value = '';
    }
  }

  function resetSession(): void {
    if (playTimer) {
      clearTimeout(playTimer);
      playTimer = null;
    }
    phase.value = 'idle';
    isPaused.value = false;
    steps.value = [];
    currentStepIndex.value = -1;
    outcome.value = 'idle';
    interruptReason.value = '';
    targetName.value = '';
    discoveries.value = [];
    enRouteSummary.value = '';
    finalPls.value = 0;
  }

  /** 组件卸载清理（F-K4-Director §4.7：立即清理定时器/引用） */
  function dispose(): void {
    if (playTimer) {
      clearTimeout(playTimer);
      playTimer = null;
    }
    // 兜底释放导航锁：异常卸载场景下确保 inputLocked 与 K-3 命令门控不残留
    // 正常路径下 finishArrived/handleInterrupt/skip 已释放，此处为幂等兜底
    explore.setNavigationLock(false);
  }

  return {
    // 状态
    phase,
    speed,
    steps,
    currentStepIndex,
    outcome,
    interruptReason,
    targetName,
    discoveries,
    enRouteSummary,
    isPaused,
    finalPls,
    // 派生
    isPlaying,
    totalSteps,
    progress,
    currentStep,
    hasPendingDiscoveries,
    enemyDiscoveries,
    otherDiscoveries,
    // 方法
    startNavigation,
    pausePlayback,
    resumePlayback,
    setSpeed,
    cycleSpeed,
    skip,
    dismissDiscoveries,
    resetSession,
    dispose,
  };
});
