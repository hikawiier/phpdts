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
import { onMoveAnimationCompletion } from '@/composables/moveAnimationChannel';
import { getActorById } from '@/composables/actorRegistry';
import { getSceneGeometry } from '@/composables/sceneRegistry';
import { setPlaybackSpeed } from '@/composables/useActorRuntime';
import { debugBus } from '@/composables/useDebugBus';
import { animationTrace } from '@/utils/animation-trace';
import type { MoveTier } from '@/types/actor-runtime';
import type { CommandResult } from '@/api/client';
import type { Enemy } from '@/types/api';

// ── 演出会话状态机（F-K4-Director §四，与 K-7 平行） ──
export type DirectorPhase = 'idle' | 'playing' | 'rebasing' | 'scene-transition';

// ── 播放速度（B6.4/B6.5） ──
export type NavSpeed = 1 | 2 | 4;

// ── 导航结果 ──
// K-Q5-A Q5-7/8/15：新增 handed_off_to_battle 终态
//   interrupted_combat 是过渡态（场景交接中），handed_off_to_battle 是终态（已交接给战斗导演）
//   避免与"未发生战斗的 idle"混淆，UI 可据终态显示中断原因
// E-Q5-D Q5-13：新增 max_steps_reached 终态——单次导航达上限，前端自动断点续导航
//   不映射为 failed：这是"未抵达但可续行"，不是失败；续发命令携带实际落点/tendency
export type NavOutcome =
  | 'idle'
  | 'playing'
  | 'arrived'
  | 'interrupted_enemy'
  | 'interrupted_combat'
  | 'handed_off_to_battle'
  | 'max_steps_reached'
  | 'failed';

// ── 移动 tick 事件（导航领域类型，3.4 移动导演本地定义） ──
// 注：discovery-store 的 AttentionPayload.moves/discoveries 使用 unknown[]，
// 此处类型仅用于 move-director 内部约束；传入 discovery 时由其防御性转换处理。
export interface MoveTickEvent {
  type: 'discover_enemy' | 'discover_poi' | 'discover_item' | 'forced_combat' | 'move';
  text: string;
  name?: string;
  // K-Q5-C Q5-12：discover_enemy 携带 pid（后端 info.enemies_discovered 已含 pid，原解析漏读）
  // applyStep 据此增量写入 mapStore.enemies，避免逐格重载 roster
  pid?: number;
  // 发现敌人所在的 pls（用于增量写入 mapStore.enemies 的 pgroup/pls 字段）
  pls?: number;
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

export type TargetAdjustmentReason = 'impassable' | 'occupied';

export interface TargetAdjustment {
  requestedPls: number;
  resolvedPls: number;
  reasons: TargetAdjustmentReason[];
}

// 1x 速度下单步演出时长（ms）
const BASE_STEP_MS = 500;

// K-12-B：动画完成信号超时兜底倍数——按 tier 分级
// duck 动画约 0.5s，jump 动画约 0.9s（K-12-H：elastic.out 从 0.9s 缩短到 0.4s，总时长 0.5+0.4=0.9s）
// 超时倍数需覆盖动画全长 + 缓冲，避免 jump 动画未完成就超时打断导致后续 step 早退
const STEP_TIMEOUT_MULTIPLIER_DUCK = 2;   // 500 × 2 = 1000ms（duck 动画 ~0.5s，充裕）
const STEP_TIMEOUT_MULTIPLIER_JUMP = 2;   // 500 × 2 = 1000ms（jump 动画 ~0.9s，覆盖 +100ms 缓冲）
const STEP_TIMEOUT_MULTIPLIER_LONG = 1;   // 500 × 1 = 500ms（long 是闪现，无需等待动画）

// K-12-F：超时兜底安全缓冲——避免 speed 高时 timeout 与动画加速后时长过于接近
// 动画 timeScale(speed) 后实际时长 = 原时长 / speed：
//   jump 1x=900ms, 2x=450ms, 4x=225ms（K-12-H：elastic.out 缩短后）
// 原公式 timeout = BASE_STEP_MS * multiplier / speed：
//   jump 1x=1000ms(✓), 2x=500ms(✓), 4x=250ms(只剩 25ms 缓冲，太紧)
// 加 100ms 缓冲后：
//   jump 1x=1100ms, 2x=600ms, 4x=350ms(125ms 缓冲 ✓)
const SAFETY_BUFFER_MS = 100;

// K-12-A：振荡检测阈值——连续出现 A→B→A 模式即判定振荡，截断到第二次 A 之前
// 设计案 §6.1 验收标准：curLoc 不出现 A→B→A→B 振荡
const OSCILLATION_PATTERN_MIN = 3;

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
  requested_target_pls?: number | null;
  target_pls?: number | null;
  target_adjustment?: {
    from_pls?: number;
    to_pls?: number;
    reasons?: string[];
  } | null;
  target_is_auto?: boolean;
  tendency?: string;
  steps_taken?: number;
  max_steps?: number;
  navigation_id?: string;
}

function isPositivePls(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

export function parseTargetAdjustment(raw: RawNavigationResult): TargetAdjustment | null {
  const adjustment = raw.target_adjustment;
  if (!adjustment) return null;
  const requestedPls = adjustment.from_pls ?? raw.requested_target_pls;
  const resolvedPls = adjustment.to_pls ?? raw.target_pls;
  if (!isPositivePls(requestedPls) || !isPositivePls(resolvedPls) || requestedPls === resolvedPls) {
    return null;
  }
  const reasons = [...new Set(
    (adjustment.reasons ?? []).filter(
      (reason): reason is TargetAdjustmentReason => reason === 'impassable' || reason === 'occupied',
    ),
  )];
  return { requestedPls, resolvedPls, reasons };
}

export function mergeTargetAdjustment(
  current: TargetAdjustment | null,
  incoming: TargetAdjustment | null,
): TargetAdjustment | null {
  if (!incoming) return current;
  if (!current) return incoming;
  return {
    requestedPls: current.requestedPls,
    resolvedPls: incoming.resolvedPls,
    reasons: [...new Set([...current.reasons, ...incoming.reasons])],
  };
}

export function buildArrivalFeedback(
  targetName: string,
  adjustment: TargetAdjustment | null,
): string {
  if (!adjustment) return `已抵达 ${targetName || '目标'}`;
  const impassable = adjustment.reasons.includes('impassable');
  const occupied = adjustment.reasons.includes('occupied');
  const reason = impassable && occupied
    ? '不可通行且已被占据'
    : impassable
      ? '不可通行'
      : occupied
        ? '已被占据'
        : '无法落脚';
  return `已抵达附近落点 (${adjustment.resolvedPls})；原目标格 (${adjustment.requestedPls}) ${reason}`;
}

/**
 * 将后端导航结果映射为人类可读的中文 interruptReason。
 *
 * - arrived：用 targetName 描述"已抵达 XXX"
 * - interrupted_enemy / interrupted_combat：固定中断描述
 * - failed：按 rawReason 子分支映射具体失败原因
 */
function humanizeOutcomeReason(
  outcome: NavOutcome,
  rawReason: string,
  targetName: string,
  targetAdjustment: TargetAdjustment | null,
): string {
  switch (outcome) {
    case 'arrived':
      return buildArrivalFeedback(targetName, targetAdjustment);
    case 'interrupted_enemy':
      return '发现敌对目标，导航中断';
    case 'interrupted_combat':
      return '遭遇突袭，导航中断';
    case 'handed_off_to_battle':
      // K-Q5-A Q5-7/8/15：已交接给战斗导演的终态
      return '已交接给战斗导演';
    case 'max_steps_reached':
      // E-Q5-D Q5-13：单次导航达上限，前端自动断点续导航（不向玩家显示失败）
      return '继续前往目标';
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
 *     requested_target_pls: int|null,
 *     target_pls: int|null,
 *     target_adjustment: { from_pls, to_pls, reasons }|null,
 *     ...
 *   }
 * 若后端未返回结构化导航数据，降级为基于命令成功/失败的单步结果。
 */
export function parseNavigationResult(result: CommandResult, startPls: number): {
  steps: NavigationStep[];
  outcome: NavOutcome;
  interruptReason: string;
  targetName: string;
  targetAdjustment: TargetAdjustment | null;
  resolvedTargetPls: number | null;
  finalPls: number;
  oscillationDetected: boolean;
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
        targetAdjustment: null,
        resolvedTargetPls: null,
        finalPls: startPls,
        oscillationDetected: false,
      };
    }
    return {
      steps: [],
      outcome: 'arrived',
      interruptReason: result.message || '已抵达目标',
      targetName: '',
      targetAdjustment: null,
      resolvedTargetPls: null,
      finalPls: startPls,
      oscillationDetected: false,
    };
  }

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
    // E-Q5-D Q5-13：max_steps_reached 是独立终态，不映射为 failed
    // 前端识别后自动断点续导航（续发 map.navigate 携带实际落点/tendency）
    // 设计案 §十：不丢失已完成移动与游戏刻，续发命令从断点继续
    outcome = 'max_steps_reached';
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

  // 步骤 5：目标解析事实——target_pls 是实际落点；调整信息保留玩家原始锚点与公开原因。
  const targetPlsRaw = raw.target_pls;
  const targetAdjustment = parseTargetAdjustment(raw);
  const targetName = (typeof targetPlsRaw === 'number' && targetPlsRaw > 0)
    ? `${targetAdjustment ? '附近落点' : '目标格'} (${targetPlsRaw})`
    : '';

  // finalPls：优先用 final_position.pls（最终权威位置），其次回退到最后一步的 to_pls
  const finalPls = raw.final_position?.pls
    ?? (steps.length > 0 ? steps[steps.length - 1].to_pls : startPls);

  // K-12-A：振荡检测——后端 BFS 在 steady 倾向下可能返回 A↔B 振荡路径（设计案 §2.2 运行时复现）
  // 设计案 §6.1 验收：curLoc 不出现 A→B→A→B 振荡。
  // 前端预处理：若 steps[i].to_pls === steps[i-2].to_pls（i>=2），判定振荡，截断到 i 前。
  // 截断后 outcome 强制为 max_steps_reached（auto-target 不续行，player-target 由续行重新选路）。
  const truncated = detectAndTruncateOscillation(steps);
  let oscillationDetected = false;
  if (truncated.oscillationDetected) {
    oscillationDetected = true;
    steps.splice(truncated.truncateAt);
    if (steps.length === 0) {
      outcome = 'failed';
    } else {
      outcome = 'max_steps_reached';
    }
  }

  // 步骤 6：生成人类可读的 interruptReason（替代原始枚举值）
  const interruptReason = humanizeOutcomeReason(outcome, rawReason, targetName, targetAdjustment);

  // 步骤 7：返回
  return {
    steps,
    outcome,
    interruptReason,
    targetName,
    targetAdjustment,
    resolvedTargetPls: isPositivePls(targetPlsRaw) ? targetPlsRaw : null,
    finalPls,
    oscillationDetected,
  };
}

/**
 * K-12-A 振荡检测：扫描 steps 数组，若 steps[i].to_pls === steps[i-2].to_pls (i>=2)，
 * 判定振荡并返回截断位置。设计案 §6.1：curLoc 不出现 A→B→A→B 振荡。
 *
 * 检测逻辑：A→B→A→B 模式中，第 3 步 (i=2) 的 to_pls (B) === 第 1 步 (i=0) 的 to_pls (B)。
 * 截断到 i（保留前 i 步），让玩家最多看到一次 A→B→A 回退，不进入第二次 A→B 重复。
 */
function detectAndTruncateOscillation(steps: NavigationStep[]): {
  oscillationDetected: boolean;
  truncateAt: number;
} {
  if (steps.length < OSCILLATION_PATTERN_MIN) {
    return { oscillationDetected: false, truncateAt: steps.length };
  }
  for (let i = 2; i < steps.length; i++) {
    if (steps[i].to_pls === steps[i - 2].to_pls) {
      animationTrace.log('move-director.detectAndTruncateOscillation.detected', {
        oscillationStepIdx: i,
        prevToPls: steps[i - 2].to_pls,
        curToPls: steps[i].to_pls,
        truncateAt: i,
        stepsLength: steps.length,
        stepsToPls: steps.map(s => s.to_pls),
      });
      return { oscillationDetected: true, truncateAt: i };
    }
  }
  return { oscillationDetected: false, truncateAt: steps.length };
}

/**
 * K-12-C：在 applyStep 前预判当前 step 的 tier，决定视觉中心冻结/释放。
 * 方案A（验收补充2推荐）：复用 mapSceneGeometry.resolveTile + actor runtime.getScenePoint
 * 计算 gridDist，与 useMapEntities.calcMoveTier 同一距离定义（切比雪夫距离，cellWidth/cellHeight 归一化）。
 *
 * 距离定义（设计案 §3）：DUCK_MAX_GRID=1.5 / JUMP_MAX_GRID=6.5 基于切比雪夫距离（max(|dx|/cellW, |dy|/cellH)）。
 * 邻接格（正交/对角线）gridDist=1 ≤ 1.5 → duck；2~6.5 → jump；>6.5 → long。
 *
 * 场景未初始化时回退 duck；图格锚点异常缺失时回退 jump，二者都保持相机冻结。
 */
function predictStepTier(fromPls: number, toPls: number, mapStore: ReturnType<typeof useMapStore>): MoveTier {
  const scene = getSceneGeometry();
  if (!scene) {
    animationTrace.log('move-director.predictStepTier.fallback', {
      fromPls, toPls, tier: 'duck', reason: 'scene geometry missing',
    });
    return 'duck';
  }
  const region = mapStore.curRegion;
  if (region === null) {
    animationTrace.log('move-director.predictStepTier.fallback', {
      fromPls, toPls, tier: 'duck', reason: 'curRegion is null',
    });
    return 'duck';
  }
  const fromAnchor = scene.resolveTile({ pgroup: region, pls: fromPls });
  const toAnchor = scene.resolveTile({ pgroup: region, pls: toPls });
  if (!fromAnchor || !toAnchor) {
    // 完整区域固定网格下锚点缺失属于场景尚未就绪或数据异常。
    // 回退 jump 以保留更宽松的动画超时，同时维持相机冻结。
    animationTrace.log('move-director.predictStepTier.fallback', {
      fromPls, toPls, tier: 'jump',
      reason: 'anchor resolve failed (scene not ready or tile missing)',
      fromAnchorPresent: !!fromAnchor,
      toAnchorPresent: !!toAnchor,
    });
    return 'jump';
  }
  const runtime = getActorById('player');
  const from = runtime?.getScenePoint() ?? fromAnchor.point;
  const gridDist = Math.max(
    Math.abs(toAnchor.point.x - from.x) / toAnchor.cellWidth,
    Math.abs(toAnchor.point.y - from.y) / toAnchor.cellHeight,
  );
  let tier: MoveTier;
  if (gridDist <= 1.5) tier = 'duck';
  else if (gridDist <= 6.5) tier = 'jump';
  else tier = 'long';
  animationTrace.log('move-director.predictStepTier', {
    fromPls, toPls, tier, gridDist,
    fromPoint: from, toPoint: toAnchor.point,
    runtimeExists: !!runtime,
  });
  return tier;
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
      // K-Q5-C Q5-12：携带 pid/pls，applyStep 据此增量写入 mapStore.enemies
      events.push({
        type: 'discover_enemy',
        text: '发现敌人',
        name: enemy.name,
        pid: enemy.pid,
        pls: enemy.pls,
      });
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
            // K-Q5-C Q5-12：携带 pid/pls，applyStep 据此增量写入 mapStore.enemies
            events.push({
              type: 'discover_enemy',
              text: '发现敌人',
              name: e.name,
              pid: e.pid,
              pls: e.pls,
            });
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

// ─── DebugBus state 注册标志（避免重复注册） ───
let _debugStateRegistered = false;

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
  const targetAdjustment = ref<TargetAdjustment | null>(null);
  const discoveries = ref<Discovery[]>([]);
  const enRouteSummary = ref<string>('');
  const isPaused = ref<boolean>(false);
  const finalPls = ref<number>(0);

  let playTimer: ReturnType<typeof setTimeout> | null = null;
  // K-12-B：当前等待动画完成的 step 的 to_pls，用于过滤过期/不匹配的完成信号
  let expectedCompletionPls: number | null = null;

  // ── K-12-H：卡顿定位时间戳追踪 ──
  // 记录上一个关键事件的时间，在下一个关键事件中计算 dt（时间差），
  // 让用户在 console 日志中直观看到每个阶段的耗时，精确定位"卡顿"位置。
  // 关键事件链：play.step → scheduleNextStep → onCompletion.accepted → followCameraAfterStep → play.step(下一步)
  let lastKeyEventT = 0;
  function timingInfo(): { t: number; dt: number } {
    const now = performance.now();
    const dt = lastKeyEventT > 0 ? Math.round((now - lastKeyEventT) * 10) / 10 : 0;
    lastKeyEventT = now;
    return { t: Math.round(now * 10) / 10, dt };
  }
  function resetTiming(): void {
    lastKeyEventT = 0;
  }

  // ── K-Q5-B Q5-4：当前导航是否前往玩家指定目标 ──
  // true 时：interrupted_enemy → pauseTarget；arrived/interrupted_combat/failed → clearTarget
  // false 时（auto-target 自动选目标）：不触碰 explore.target，避免误清玩家书签
  // 设计案 §5.9 "事件中断后保留目标为暂停状态，由玩家明确继续或取消"
  let navHasPlayerTarget = false;

  // ── E-Q5-D Q5-13：断点续导航状态 ──
  // max_steps_reached 终态时，前端自动续发 map.navigate 携带实际落点/tendency
  // 设计案 §十：不丢失已完成移动与游戏刻，续发命令从断点继续
  // resumeTarget=undefined 表示 auto-target，续发时让后端在断点处重新选目标
  //   （隐藏敌人/POI 状态可能已变化，§5.4/§7.4 重新选目标更准确）
  // parsedOutcome 存储解析后的终态，供 play() 在播放完所有 step 后判断是否续行
  let resumeTarget: number | undefined = undefined;
  let resumeTendency: MoveTendency | undefined = undefined;
  let parsedOutcome: NavOutcome | null = null;
  // 续行次数保护：避免极端情况（如目标永久不可达但 BFS 误判）导致无限续行
  let resumeCount = 0;
  const MAX_RESUME_COUNT = 10;
  // K-12-A 振荡熔断：连续 2 次续行都检测到振荡，说明后端修复未生效，
  // 停止续行避免死循环（设计案 §6.1 验收：curLoc 不出现 A→B→A→B 振荡）
  let consecutiveOscillationCount = 0;
  const MAX_CONSECUTIVE_OSCILLATION = 2;

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

  function applyParsedTarget(
    parsed: Pick<ReturnType<typeof parseNavigationResult>, 'targetName' | 'targetAdjustment' | 'resolvedTargetPls'>,
    preserveExisting: boolean,
  ): void {
    targetAdjustment.value = preserveExisting
      ? mergeTargetAdjustment(targetAdjustment.value, parsed.targetAdjustment)
      : parsed.targetAdjustment;
    targetName.value = targetAdjustment.value
      ? `附近落点 (${targetAdjustment.value.resolvedPls})`
      : parsed.targetName;
    if (navHasPlayerTarget && parsed.resolvedTargetPls !== null) {
      resumeTarget = parsed.resolvedTargetPls;
    }
  }

  function currentArrivalFeedback(): string {
    return buildArrivalFeedback(targetName.value, targetAdjustment.value);
  }

  function arrivalToastDuration(): number {
    return targetAdjustment.value ? 2800 : 1800;
  }
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
        // K-Q5-C Q5-12：增量写入新发现敌人到 mapStore.enemies（不替换全量，避免重置 roster）
        // 仅有 pid/name/pls 部分数据，构造最小 stub Enemy（discovered=1），其余字段等终态 loadMap 刷新
        // 去重：同 pid 已存在则跳过（避免重复添加）
        if (typeof ev.pid === 'number' && ev.pid > 0) {
          const existing = mapStore.enemies as Enemy[];
          const exists = existing.some(e => Number(e.pid) === ev.pid);
          if (!exists) {
            const stubEnemy: Enemy = {
              pid: ev.pid,
              type: 1,
              name: ev.name || '敌人',
              gd: 'm',
              icon: '',
              action: '',
              bid: 0,
              hp: 0, mhp: 0, sp: 0, msp: 0,
              att: 0, def: 0, ap: 0, max_ap: 0,
              pgroup: mapStore.curRegion ?? 0,
              pls: ev.pls ?? step.to_pls,
              lvl: 0, exp: 0,
              state: 0,
              itemmaxslots: 0,
              wepid: '', wep2id: '', arbid: '', arhid: '',
              araid: '', arfid: '', artid: '',
              itemIds: [],
              discovered: 1,
            };
            mapStore.updateMapData({ enemies: [...existing, stubEnemy] });
          }
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

  async function play(): Promise<void> {
    if (phase.value !== 'playing' || isPaused.value) return;
    if (currentStepIndex.value >= steps.value.length - 1) {
      // E-Q5-D Q5-13：max_steps_reached 终态时自动断点续导航，不调用 finishArrived
      // 续行由 resumeFromBreakpoint 异步执行，phase 暂保持 playing 避免锁释放闪烁
      if (parsedOutcome === 'max_steps_reached') {
        // K-12-A：auto-target 不续行——自动选目标达 max_steps 上限时终止，
        // 让玩家决定下一步操作（设计案 §三 K-12-A 边界案例）
        // 自动选目标的设计意图是"低操作负担的短距离探索"，不是"必达远程目标"
        if (!navHasPlayerTarget) {
          animationTrace.log('move-director.play.end.max-steps-auto', {
            currentStepIdx: currentStepIndex.value,
            navHasPlayerTarget,
          });
          finishMaxStepsReachedAuto();
          return;
        }
        animationTrace.log('move-director.play.end.max-steps-resume', {
          currentStepIdx: currentStepIndex.value,
          navHasPlayerTarget,
          resumeCount,
        });
        void resumeFromBreakpoint();
        return;
      }
      animationTrace.log('move-director.play.end.arrived', {
        currentStepIdx: currentStepIndex.value,
        parsedOutcome,
      });
      finishArrived();
      return;
    }
    currentStepIndex.value++;
    const step = steps.value[currentStepIndex.value];

    // K-12-C：applyStep 前预判 tier，决定相机冻结/释放。
    // duck/jump 动画期间相机留在起点，long 闪现后直接跟随权威位置。
    const tier = predictStepTier(step.from_pls, step.to_pls, mapStore);
    const visualCenterBeforeApply = mapStore.visualCenter;
    if (tier !== 'long' && mapStore.visualCenter === null) {
      mapStore.setVisualCenter(step.from_pls);
    }

    animationTrace.log('move-director.play.step', {
      stepIdx: currentStepIndex.value,
      totalSteps: steps.value.length,
      from_pls: step.from_pls,
      to_pls: step.to_pls,
      tier,
      expectedCompletionPls_before: expectedCompletionPls,
      speed: speed.value,
      visualCenterBeforeApply,
      visualCenterAfterPredict: mapStore.visualCenter,
      ...timingInfo(),
    });

    const curLocBeforeApply = mapStore.curLoc;
    const res = applyStep(step, true);
    const curLocAfterApply = mapStore.curLoc;

    animationTrace.log('move-director.applyStep.done', {
      stepIdx: currentStepIndex.value,
      curLocBeforeApply,
      curLocAfterApply,
      interrupted: res.interrupted,
      combatName: res.combatName,
      projectionRevision: mapStore.projectionRevision,
    });

    // K-12-C：long 闪现不需要等待空间动画，权威位置更新后立即释放相机冻结。
    if (tier === 'long') {
      mapStore.clearVisualCenter();
    }

    if (res.interrupted) {
      handleInterrupt(res.interrupted, res.combatName);
      return;
    }
    // 普通移动反馈（不阻塞）
    dispatchAttentionToFeedback('normal');
    // K-12-B：动画完成信号驱动 + 超时兜底（替代固定 setTimeout 节奏）
    // 超时倍数按 tier 分级：jump 动画含 elastic.out 落地弹性（~1.4s），需更长超时
    scheduleNextStepAfterAnimation(step.to_pls, tier);
  }

  /** K-12-C：连续位移动画完成后，将相机中心推进到玩家的新位置。 */
  async function followCameraAfterStep(targetPls: number): Promise<void> {
    if (mapStore.visualCenter === null) return;
    animationTrace.log('move-director.followCameraAfterStep', {
      targetPls,
      prevVisualCenter: mapStore.visualCenter,
      curLoc: mapStore.curLoc,
      ...timingInfo(),
    });
    mapStore.setVisualCenter(targetPls);
  }

  /**
   * K-12-B：排程下一步——动画完成信号驱动 + 超时兜底。
   *
   * applyStep 更新 curLoc 后，useMapEntities.playWorldMove 通过 entity watch 触发动画。
   * 动画完成时通过 moveAnimationChannel 发送完成信号，监听器匹配 expectedPls 后
   * 清除超时定时器并立即推进 play()。若完成信号未在超时时间内到达（组件卸载/动画库异常/
   * 租约竞争死锁），超时兜底强制推进，避免演出卡死。
   *
   * K-12-F：speed 同步到动画 timeScale 后，动画实际时长 = 原时长 / speed。
   * 超时兜底时长 = BASE_STEP_MS * multiplier / speed + SAFETY_BUFFER_MS：
   *   duck 1x=1100ms, 2x=600ms, 4x=350ms（duck 动画 1x=500ms, 4x=125ms ✓）
   *   jump 1x=1100ms, 2x=600ms, 4x=350ms（jump 动画 1x=900ms, 4x=225ms ✓）
   *   long 1x=600ms, 2x=350ms, 4x=225ms（long 是闪现，无需等待动画）
   */
  function scheduleNextStepAfterAnimation(expectedPls: number, tier: MoveTier): void {
    if (playTimer) {
      clearTimeout(playTimer);
      playTimer = null;
    }
    expectedCompletionPls = expectedPls;
    const multiplier = tier === 'duck'
      ? STEP_TIMEOUT_MULTIPLIER_DUCK
      : tier === 'jump'
        ? STEP_TIMEOUT_MULTIPLIER_JUMP
        : STEP_TIMEOUT_MULTIPLIER_LONG;
    const timeoutMs = (BASE_STEP_MS * multiplier) / speed.value + SAFETY_BUFFER_MS;
    animationTrace.log('move-director.scheduleNextStepAfterAnimation', {
      expectedPls,
      timeoutMs,
      speed: speed.value,
      tier,
      multiplier,
      safetyBuffer: SAFETY_BUFFER_MS,
      playTimerSet: true,
      ...timingInfo(),
    });
    playTimer = setTimeout(() => {
      animationTrace.log('move-director.scheduleNextStepAfterAnimation.timeout', {
        expectedPls,
        timedOut: true,
        note: '动画完成信号未到达，超时兜底强制推进',
        tier,
        timeoutMs,
      });
      playTimer = null;
      expectedCompletionPls = null;
      // K-12-C：超时兜底也推进相机（动画可能被跳过，但视觉中心仍需跟随）。
      void followCameraAfterStep(expectedPls).then(() => {
        if (phase.value === 'playing' && !isPaused.value) {
          void play();
        } else {
          animationTrace.log('move-director.scheduleNextStepAfterAnimation.timeout.skip-play', {
            phase: phase.value,
            isPaused: isPaused.value,
            reason: 'phase changed during camera follow',
          });
        }
      });
    }, timeoutMs);
  }

  /**
   * K-12-A：auto-target 达 max_steps 上限时终止导航。
   *
   * 设计案 §三 K-12-A 边界案例：自动选目标达 max_steps 上限时终止导航，
   * outcome='max_steps_reached'，toast 提示"已移动 N 步，未抵达自动目标"，不续行。
   * 自动选目标的设计意图是"低操作负担的短距离探索"，不是"必达远程目标"——
   * 若需超过 max_steps 才能抵达，应让玩家显式选择是否继续。
   */
  function finishMaxStepsReachedAuto(): void {
    if (playTimer) {
      clearTimeout(playTimer);
      playTimer = null;
    }
    expectedCompletionPls = null;
    buildSummary();
    phase.value = 'idle';
    outcome.value = 'max_steps_reached';
    interruptReason.value = `已移动 ${currentStepIndex.value + 1} 步，未抵达自动目标`;
    explore.setNavigationLock(false);
    mapStore.clearVisualCenter();
    animationTrace.log('move-director.finishMaxStepsReachedAuto', {
      outcome: outcome.value,
      phase: phase.value,
      currentStepIdx: currentStepIndex.value,
      visualCenter: mapStore.visualCenter,
      note: 'K-12-A auto-target 不续行门控触发',
    });
    // auto-target 无 explore.target 可清（navHasPlayerTarget === false）
    // K-Q5-C Q5-9/12：终态触发权威刷新
    void mapStore.loadMap();
    toastStore.showToast(interruptReason.value, 'info', 2500, false, 'nav-max-steps');
  }

  /**
   * E-Q5-D Q5-13：断点续导航——max_steps_reached 终态后自动续发 map.navigate
   *
   * 设计案 §十：不丢失已完成移动与游戏刻，续发命令从断点继续。
   * 续行命令携带实际落点/tendency：
   *   - 玩家指定目标（resumeTarget 有值）：必达，续发携带后端解析出的可落脚目标
   *   - auto-target（resumeTarget=undefined）：在断点处重新选目标
   *     （隐藏敌人/POI 状态可能已变化，§5.4/§7.4 重新选目标更准确）
   *
   * 续行次数保护：MAX_RESUME_COUNT 避免极端情况（目标永久不可达但 BFS 误判）导致无限续行
   * 振荡熔断：连续 MAX_CONSECUTIVE_OSCILLATION 次续行都检测到振荡，说明后端修复未生效，
   *   停止续行避免死循环（设计案 §6.1 验收：curLoc 不出现 A→B→A→B 振荡）
   */
  async function resumeFromBreakpoint(): Promise<void> {
    // K-12-B：续行前清理动画完成信号状态，避免续行 await 期间过期信号误触发
    if (playTimer) {
      clearTimeout(playTimer);
      playTimer = null;
    }
    expectedCompletionPls = null;
    resumeCount++;
    animationTrace.log('move-director.resumeFromBreakpoint.entry', {
      resumeTarget,
      resumeTendency,
      resumeCount,
      MAX_RESUME_COUNT,
      curLoc: mapStore.curLoc,
      consecutiveOscillationCount,
    });
    if (resumeCount > MAX_RESUME_COUNT) {
      // 续行次数超限：转为 failed，避免无限循环
      phase.value = 'idle';
      outcome.value = 'failed';
      interruptReason.value = '导航续行次数超限，已停止';
      explore.setNavigationLock(false);
      mapStore.clearVisualCenter();
      if (navHasPlayerTarget) {
        explore.clearTarget();
        navHasPlayerTarget = false;
      }
      void mapStore.loadMap();
      toastStore.showToast(interruptReason.value, 'error', 3000, false, 'nav-failed');
      return;
    }
    if (consecutiveOscillationCount >= MAX_CONSECUTIVE_OSCILLATION) {
      // 振荡熔断：连续续行都检测到振荡，说明后端修复未生效，停止续行
      animationTrace.log('move-director.resumeFromBreakpoint.oscillation-circuit-breaker', {
        consecutiveOscillationCount,
        MAX_CONSECUTIVE_OSCILLATION,
        resumeCount,
      });
      phase.value = 'idle';
      outcome.value = 'failed';
      interruptReason.value = '路径出现反复振荡，已停止续行';
      explore.setNavigationLock(false);
      mapStore.clearVisualCenter();
      if (navHasPlayerTarget) {
        explore.clearTarget();
        navHasPlayerTarget = false;
      }
      void mapStore.loadMap();
      toastStore.showToast(interruptReason.value, 'error', 3000, false, 'nav-failed');
      return;
    }

    // 续行：从当前断点位置（curLoc 已由 applyStep 更新）续发 map.navigate
    // 不释放 navigationLock，避免锁闪烁；续发命令在锁保持期间执行
    const fromPls = explore.playerPls ?? 0;
    const result = await commandQueue.execute({
      command: 'map.navigate',
      payload: {
        target: resumeTarget,
        tendency: resumeTendency ?? explore.tendency,
      },
    });

    if (!result.success) {
      phase.value = 'idle';
      outcome.value = 'failed';
      interruptReason.value = result.message || '续导航失败';
      explore.setNavigationLock(false);
      mapStore.clearVisualCenter();
      if (navHasPlayerTarget) {
        explore.clearTarget();
        navHasPlayerTarget = false;
      }
      void mapStore.loadMap();
      toastStore.showToast(interruptReason.value, 'error', 3000, false, 'nav-failed');
      return;
    }

    // 解析续行结果（保留已累积的 discoveries/enRouteSummary，续行是同一会话）
    const parsed = parseNavigationResult(result, fromPls);
    steps.value = parsed.steps;
    applyParsedTarget(parsed, true);
    finalPls.value = parsed.finalPls;
    parsedOutcome = parsed.outcome;
    currentStepIndex.value = -1;

    // 振荡熔断计数：本次续行检测到振荡则累加，未振荡则归零
    if (parsed.oscillationDetected) {
      consecutiveOscillationCount++;
    } else {
      consecutiveOscillationCount = 0;
    }

    // 续行结果无步骤：直接抵达或失败
    if (steps.value.length === 0) {
      phase.value = 'idle';
      explore.setNavigationLock(false);
      mapStore.clearVisualCenter();
      if (parsed.outcome === 'failed') {
        outcome.value = 'failed';
        interruptReason.value = parsed.interruptReason || '续导航失败';
        if (navHasPlayerTarget) {
          explore.clearTarget();
          navHasPlayerTarget = false;
        }
        toastStore.showToast(interruptReason.value, 'error', 3000, false, 'nav-failed');
      } else {
        // arrived
        outcome.value = 'arrived';
        interruptReason.value = currentArrivalFeedback();
        if (navHasPlayerTarget) {
          explore.clearTarget();
          navHasPlayerTarget = false;
        }
        void mapStore.loadMap();
        toastStore.showToast(interruptReason.value, 'success', arrivalToastDuration(), false, 'nav-arrived');
      }
      return;
    }

    // 续行结果含中断：同步应用到中断点
    if (parsed.outcome === 'interrupted_combat' || parsed.outcome === 'interrupted_enemy') {
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

    // 续行结果正常或仍 max_steps_reached：继续逐格播放（max_steps_reached 由 play() 续行）
    // phase 已是 playing，直接重新进入播放循环
    void play();
  }

  function finishArrived(): void {
    if (playTimer) {
      clearTimeout(playTimer);
      playTimer = null;
    }
    expectedCompletionPls = null;
    buildSummary();
    phase.value = 'idle';
    outcome.value = 'arrived';
    interruptReason.value = currentArrivalFeedback();
    explore.setNavigationLock(false); // B6.13 演出追上权威状态后恢复输入
    // 解除视觉中心冻结：网格重新跟随 curLoc 居中到最终位置
    mapStore.clearVisualCenter();
    animationTrace.log('move-director.finishArrived', {
      outcome: outcome.value,
      phase: phase.value,
      targetName: targetName.value,
      finalPls: finalPls.value,
      visualCenter: mapStore.visualCenter,
      curLoc: mapStore.curLoc,
      navHasPlayerTarget,
      projectionRevision: mapStore.projectionRevision,
    });
    // K-Q5-B Q5-4：玩家指定目标抵达后清除（§5.9 目标已达成，不再保留为书签）
    // auto-target 不触碰 explore.target（玩家未指定目标，无书签可清）
    if (navHasPlayerTarget) {
      explore.clearTarget();
      navHasPlayerTarget = false;
    }
    // K-Q5-C Q5-9/12：终态触发权威刷新——拉取最新 enemies/links/region_discoveries
    // 演出期间 applyStep 增量写入 stub 敌人，此处一次性用后端权威数据覆盖
    // 不 await：fire-and-forget，避免阻塞 UI 终态反馈
    void mapStore.loadMap();
    toastStore.showToast(interruptReason.value, 'success', arrivalToastDuration(), false, 'nav-arrived');
  }

  function handleInterrupt(reason: NavOutcome, combatName?: string): void {
    if (playTimer) {
      clearTimeout(playTimer);
      playTimer = null;
    }
    expectedCompletionPls = null;
    buildSummary();
    phase.value = 'idle';
    // 解除视觉中心冻结：中断后网格重新跟随 curLoc 居中到中断点
    mapStore.clearVisualCenter();
    animationTrace.log('move-director.handleInterrupt', {
      reason,
      combatName,
      phase: phase.value,
      visualCenter: mapStore.visualCenter,
      curLoc: mapStore.curLoc,
      navHasPlayerTarget,
      interrupted_by: reason,
      projectionRevision: mapStore.projectionRevision,
    });

    if (reason === 'interrupted_enemy') {
      // B3.6：保留已完成移动；在发现敌人的最后一次移动处中断；弹出发现模态
      outcome.value = 'interrupted_enemy';
      const n = enemyDiscoveries.value.length;
      interruptReason.value = `发现 ${n} 个敌对目标，导航中断`;
      // 演出已追上权威状态（中断点 = 最终权威位置），恢复输入；发现卡作为可关闭反馈
      explore.setNavigationLock(false);
      // K-Q5-B Q5-4：玩家指定目标中断后转为 paused（§5.9 保留 pls/name 供"继续前往"）
      // auto-target 不暂停（无玩家指定目标，无书签可续）
      if (navHasPlayerTarget) {
        explore.pauseTarget();
      }
      // K-Q5-C Q5-9/12：终态触发权威刷新——拉取最新 enemies/links/region_discoveries
      // 演出期间 applyStep 增量写入 stub 敌人，此处一次性用后端权威数据覆盖
      // 不 await：fire-and-forget，避免阻塞发现模态反馈
      void mapStore.loadMap();
      // 派发重要发现反馈给 3.5 反馈层（反馈层打开模态框时调用 pausePlayback）
      dispatchAttentionToFeedback('important');
    } else if (reason === 'interrupted_combat') {
      // B3.7 / §8.5：先播放已完成移动 → 在遭遇位置显示突袭原因 → 切换战斗场景
      // K-Q5-A Q5-7/8/15：保留 interrupted_combat 过渡态 + scene-transition 阶段
      //   不再立即覆盖为 idle——UI 需在场景切换瞬间观察到中断原因
      //   交接完成后转为 handed_off_to_battle 终态（非 idle），明确"已交接给战斗导演"
      outcome.value = 'interrupted_combat';
      interruptReason.value = combatName
        ? `遭遇 ${combatName} 突袭，导航中断`
        : '遭遇突袭，导航中断';
      explore.setNavigationLock(false);
      // K-Q5-B Q5-4：强制战斗移交后不暂停目标（敌人已突袭，原目标路线可能失效）→ 清除
      // 设计案 §5.9 不变量：原目标失效或不再存在可达路线时中断
      if (navHasPlayerTarget) {
        explore.clearTarget();
        navHasPlayerTarget = false;
      }
      // 派发强制事件反馈给 3.5 反馈层
      dispatchAttentionToFeedback('force', { reason: interruptReason.value, type: 'combat' });
      // 场景交接：切换战斗场景（F-K4-Director §5.5/§5.6）
      phase.value = 'scene-transition';
      sceneStore.enterBattle();
      // K-Q5-A Q5-15：toast 合并途中摘要（§8.5 以简短摘要解释途中事件）
      const combatToastMsg = enRouteSummary.value
        ? `${interruptReason.value}（${enRouteSummary.value}）`
        : interruptReason.value;
      toastStore.showToast(combatToastMsg, 'error', 3000, false, 'nav-combat');
      // K-Q5-A Q5-7：交接完成后转为 handed_off_to_battle 终态（非 idle）
      //   phase 回 idle（导演会话结束，K-1 战斗导演接管），outcome 保留终态语义
      //   dispose() 兜底时才强制回 idle
      outcome.value = 'handed_off_to_battle';
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
   *
   * K-Q5-B Q5-4：当 target 为有效数值时（玩家指定目标），同步 explore.target 为 active，
   * 以便 interrupted_enemy 时 pauseTarget 保留为 paused 供"继续前往"入口。
   * auto-target（target undefined）不触碰 explore.target，避免误清玩家书签。
   */
  async function startNavigation(tendency?: MoveTendency, target?: number): Promise<void> {
    if (isPlaying.value) return; // 演出期间阻止新的导航
    if (explore.inputLocked) return;

    resetSession();
    resetTiming(); // K-12-H：重置时间戳追踪，新导航从 0 开始计 dt
    const usedTendency = tendency ?? explore.tendency;
    const fromPls = explore.playerPls ?? 0;

    // K-Q5-B Q5-4：标记本次导航是否前往玩家指定目标
    // 用于 handleInterrupt/finishArrived 决定 pauseTarget/clearTarget
    navHasPlayerTarget = (typeof target === 'number' && target > 0);
    if (navHasPlayerTarget && typeof target === 'number') {
      // 确保 explore.target 反映当前导航目标（clickMove 路径未提前 setTarget）
      // 若 atlas/DiscoveryModal 已 setTarget 且 pls 一致，不覆盖其友好名称
      const cur = explore.target;
      if (cur.kind === 'none' || String(cur.pls) !== String(target)) {
        explore.setTarget(target, `目标格 (${target})`);
      }
    }

    // E-Q5-D Q5-13：先存请求目标；后端若解析为附近落点，解析响应后改存实际落点。
    // auto-target（target undefined）续行时让后端在断点处重新选目标
    resumeTarget = target;
    resumeTendency = usedTendency;

    // §8.4 门控开始：移动导演播放时阻止新的移动/探索/目标命令
    explore.setNavigationLock(true);

    // K-12-D：在 await 前冻结相机中心到起点。
    // 命令队列在 await 期间会广播 'game:command-committed'，触发 battle.ts 的
    // flushAuthoritativeStores → mapStore.loadMap()，将 curLoc 直接更新到最终位置。
    // 命令提交会提前刷新最终权威位置；若不冻结，相机会在逐格演出开始前跳到终点。
    // 完整区域网格本身不移动，冻结只约束相机。失败路径仍需显式释放（见下方错误处理）。
    mapStore.setVisualCenter(fromPls);

    animationTrace.log('move-director.startNavigation.entry', {
      fromPls,
      target,
      tendency: usedTendency,
      navHasPlayerTarget,
      caller: target !== undefined ? 'MainActionBar/Atlas' : 'auto-target',
    });

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
      // 释放提前冻结的视觉中心（K-12-D：await 前冻结，失败时必须释放）
      mapStore.clearVisualCenter();
      outcome.value = 'failed';
      interruptReason.value = result.message || '导航失败';
      // K-Q5-B Q5-4：失败时清除玩家指定目标书签（路线失效，无续行意义）
      if (navHasPlayerTarget) {
        explore.clearTarget();
        navHasPlayerTarget = false;
      }
      toastStore.showToast(interruptReason.value, 'error', 3000, false, 'nav-failed');
      return;
    }

    // 解析后端返回的多次移动结果
    const parsed = parseNavigationResult(result, fromPls);
    steps.value = parsed.steps;
    applyParsedTarget(parsed, false);
    finalPls.value = parsed.finalPls;
    // E-Q5-D Q5-13：存储解析终态，供 play() 在播放完所有 step 后判断是否续行
    parsedOutcome = parsed.outcome;
    // 振荡熔断：初次解析也累加振荡计数（若初次就振荡，下次续行将携带此计数）
    if (parsed.oscillationDetected) {
      consecutiveOscillationCount++;
    } else {
      consecutiveOscillationCount = 0;
    }

    // 无步骤：直接抵达或失败
    if (steps.value.length === 0) {
      explore.setNavigationLock(false);
      // 释放提前冻结的视觉中心（K-12-D：await 前冻结，无步骤时直接释放）
      mapStore.clearVisualCenter();
      if (parsed.outcome === 'failed' || parsed.outcome === 'max_steps_reached') {
        // max_steps_reached 无步骤是退化情况（未移动就达上限），按失败处理
        outcome.value = 'failed';
        interruptReason.value = parsed.outcome === 'max_steps_reached'
          ? '导航未移动即达步数上限'
          : (parsed.interruptReason || '导航失败');
        // K-Q5-B Q5-4：失败时清除玩家指定目标书签
        if (navHasPlayerTarget) {
          explore.clearTarget();
          navHasPlayerTarget = false;
        }
        toastStore.showToast(interruptReason.value, 'error', 3000, false, 'nav-failed');
      } else {
        outcome.value = 'arrived';
        interruptReason.value = currentArrivalFeedback();
        // K-Q5-B Q5-4：抵达时清除玩家指定目标书签（目标已达成）
        if (navHasPlayerTarget) {
          explore.clearTarget();
          navHasPlayerTarget = false;
        }
        toastStore.showToast(interruptReason.value, 'success', arrivalToastDuration(), false, 'nav-arrived');
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
    // K-12-D：视觉中心已在 await 前冻结（startNavigation 入口处），此处不重复设置。
    // play() 内 predictStepTier 会按 tier 决定后续 step 的冻结/释放策略。
    void play();
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
    void play();
  }

  // ── 播放速度控制（B6.4/B6.5） ──
  // K-12-F：speed 同步到 useActorRuntime，让动画 timeScale 跟随 speed
  // 解决：speed=4 时 jump 动画 timeScale=4 → 实际时长 350ms，
  // 与 timeout 475ms 匹配，不再被超时打断 → 落点正确

  function setSpeed(s: NavSpeed): void {
    speed.value = s;
    setPlaybackSpeed(s);
  }

  /** 循环切换 1x → 2x → 4x → 1x */
  function cycleSpeed(): void {
    const next = speed.value === 1 ? 2 : speed.value === 2 ? 4 : 1;
    setSpeed(next as NavSpeed);
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
    expectedCompletionPls = null;
    phase.value = 'rebasing';
    animationTrace.log('move-director.skip.entry', {
      phase: phase.value,
      currentStepIdx: currentStepIndex.value,
      totalSteps: steps.value.length,
      remainingSteps: steps.value.length - currentStepIndex.value - 1,
    });
    // 跳过演出：立即解除视觉中心冻结，网格跟随 curLoc 同步到最终位置
    mapStore.clearVisualCenter();
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
    animationTrace.log('move-director.skip.done', {
      lastInterrupted,
      combatName,
      finalStepIdx: currentStepIndex.value,
      curLoc: mapStore.curLoc,
      outcome: outcome.value,
    });

    if (lastInterrupted === 'interrupted_enemy') {
      // B6.6：跳过后遇到重要发现仍弹出
      outcome.value = 'interrupted_enemy';
      const n = enemyDiscoveries.value.length;
      interruptReason.value = `发现 ${n} 个敌对目标，导航中断`;
      // K-Q5-B Q5-4：跳过后中断仍保留目标为 paused（与非跳过路径一致）
      if (navHasPlayerTarget) {
        explore.pauseTarget();
      }
      // K-Q5-A Q5-8：途中摘要已由 buildSummary() 写入 enRouteSummary，
      //   dispatchAttentionToFeedback 派发的 payload.discoveries + moves 携带完整途中信息，
      //   discovery 模态框承载摘要显示（与非跳过路径一致，不额外弹 toast）
      dispatchAttentionToFeedback('important');
    } else if (lastInterrupted === 'interrupted_combat') {
      // B6.7：跳过后遇到强制战斗仍切换场景，显示原因
      // K-Q5-A Q5-7/8/15：保留 interrupted_combat → handed_off_to_battle 终态，不覆盖为 idle
      outcome.value = 'interrupted_combat';
      interruptReason.value = combatName
        ? `遭遇 ${combatName} 突袭，导航中断`
        : '遭遇突袭，导航中断';
      // K-Q5-B Q5-4：强制战斗移交后清除目标（敌人已突袭，原路线可能失效）
      if (navHasPlayerTarget) {
        explore.clearTarget();
        navHasPlayerTarget = false;
      }
      dispatchAttentionToFeedback('force', { reason: interruptReason.value, type: 'combat' });
      sceneStore.enterBattle();
      // K-Q5-A Q5-8：toast 合并途中摘要（§8.5 以简短摘要解释途中事件）
      const combatToastMsg = enRouteSummary.value
        ? `${interruptReason.value}（${enRouteSummary.value}）`
        : interruptReason.value;
      toastStore.showToast(combatToastMsg, 'error', 3000, false, 'nav-combat');
      // K-Q5-A Q5-7：交接完成后转为 handed_off_to_battle 终态（非 idle）
      outcome.value = 'handed_off_to_battle';
    } else {
      outcome.value = 'arrived';
      interruptReason.value = currentArrivalFeedback();
      // K-Q5-B Q5-4：跳过后抵达也清除目标书签（目标已达成）
      if (navHasPlayerTarget) {
        explore.clearTarget();
        navHasPlayerTarget = false;
      }
      // K-Q5-A Q5-8：抵达反馈与途中摘要复用同一目标调整语义。
      const skippedArrival = ['跳过演出', interruptReason.value];
      if (enRouteSummary.value) skippedArrival.push(enRouteSummary.value);
      toastStore.showToast(
        skippedArrival.join('；'),
        'info', targetAdjustment.value ? 3000 : 2000, false, 'nav-skipped',
      );
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
    expectedCompletionPls = null;
    phase.value = 'idle';
    isPaused.value = false;
    steps.value = [];
    currentStepIndex.value = -1;
    outcome.value = 'idle';
    interruptReason.value = '';
    targetName.value = '';
    targetAdjustment.value = null;
    discoveries.value = [];
    enRouteSummary.value = '';
    finalPls.value = 0;
    // K-Q5-B Q5-4：重置导航目标标记（防御性：确保上次导航遗留的标记不残留）
    // 注意：不在此处 clearTarget——resetSession 在 startNavigation 开头调用，
    // 此时新导航的 navHasPlayerTarget 尚未设置，清书签会误清玩家正在前往的目标
    navHasPlayerTarget = false;
    // E-Q5-D Q5-13：重置断点续导航状态（新导航会话，续行计数清零）
    parsedOutcome = null;
    resumeTarget = undefined;
    resumeTendency = undefined;
    resumeCount = 0;
    consecutiveOscillationCount = 0;
    // 清除视觉中心冻结（防御性：确保上次导航遗留的冻结不残留）
    mapStore.clearVisualCenter();
  }

  /** 组件卸载清理（F-K4-Director §4.7：立即清理定时器/引用） */
  function dispose(): void {
    if (playTimer) {
      clearTimeout(playTimer);
      playTimer = null;
    }
    expectedCompletionPls = null;
    // 兜底释放导航锁：异常卸载场景下确保 inputLocked 与 K-3 命令门控不残留
    // 正常路径下 finishArrived/handleInterrupt/skip 已释放，此处为幂等兜底
    explore.setNavigationLock(false);
    // 兜底清除视觉中心冻结：防止卸载后网格残留冻结状态
    mapStore.clearVisualCenter();
    // K-Q5-A Q5-7：兜底强制回 idle（组件卸载时 handed_off_to_battle 终态不再有意义）
    // 正常路径下终态保留供 UI 观察，卸载时清除避免残留
    outcome.value = 'idle';
    phase.value = 'idle';
    navHasPlayerTarget = false;
  }

  // ══════════════════════════════════════════════════
  // K-12-B / M-1-A：移动动画完成信号监听
  // ══════════════════════════════════════════════════
  // playWorldMove 动画完成时通过 moveAnimationChannel 发送信号，
  // 匹配 expectedCompletionPls 后清除超时定时器并立即推进 play()。
  // 不匹配的信号（过期/其他 actor/non-playing 阶段）被过滤，由超时兜底处理。
  // 监听器在 store 工厂内注册一次，生命周期与 store 一致；phase 检查确保
  // dispose 后不会误推进（dispose 设 phase=idle，监听器早期返回）。
  onMoveAnimationCompletion((event) => {
    if (event.actorId !== 'player') {
      animationTrace.log('move-director.onMoveAnimationCompletion.filtered', {
        reason: 'actorId !== player',
        actorId: event.actorId,
        targetPls: event.targetPls,
        completed: event.completed,
      });
      return;
    }
    if (phase.value !== 'playing' || isPaused.value) {
      animationTrace.log('move-director.onMoveAnimationCompletion.filtered', {
        reason: 'phase not playing or paused',
        phase: phase.value,
        isPaused: isPaused.value,
        targetPls: event.targetPls,
        completed: event.completed,
      });
      return;
    }
    if (event.targetPls !== expectedCompletionPls) {
      animationTrace.log('move-director.onMoveAnimationCompletion.filtered', {
        reason: 'targetPls mismatch expectedCompletionPls',
        eventTargetPls: event.targetPls,
        expectedCompletionPls,
        completed: event.completed,
      });
      return;
    }
    if (!event.completed) {
      animationTrace.log('move-director.onMoveAnimationCompletion.filtered', {
        reason: 'event.completed === false',
        targetPls: event.targetPls,
        note: '动画被抢占/取消，等待超时兜底',
      });
      return;
    }
    animationTrace.log('move-director.onMoveAnimationCompletion.accepted', {
      targetPls: event.targetPls,
      completed: event.completed,
      phase: phase.value,
      ...timingInfo(),
    });
    if (playTimer) {
      clearTimeout(playTimer);
      playTimer = null;
    }
    expectedCompletionPls = null;
    // K-12-C：单步动画完成后推进相机，再开始下一步演出。
    void followCameraAfterStep(event.targetPls).then(() => {
      if (phase.value === 'playing' && !isPaused.value) {
        void play();
      } else {
        animationTrace.log('move-director.onMoveAnimationCompletion.skip-play', {
          phase: phase.value,
          isPaused: isPaused.value,
          reason: 'phase changed during camera follow',
        });
      }
    });
  });

  // ─── DebugBus 状态注册（供 ?debug=ai 使用） ───
  if (!_debugStateRegistered) {
    _debugStateRegistered = true;
    debugBus.registerState('moveDirector', () => ({
      isPlaying: isPlaying.value,
      phase: phase.value,
    }));
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
    targetAdjustment,
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
