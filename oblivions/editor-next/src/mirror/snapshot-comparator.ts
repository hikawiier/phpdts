/**
 * @module O 内容工具箱
 *
 * 状态快照对比器（执行案 §4.4.2）。
 *
 * 设计意图：
 * - 对比前端镜像输出与后端权威快照，输出结构化差异列表 + 不变量违反列表
 * - 不做 PRNG 对齐——P6 采用"状态快照对比法"，校验"统计分布一致"而非"单次结果一致"
 * - 对比维度（对齐 §4.1.2）：数量 / 分布 / 引用 / 容量 / 不变量
 * - 容忍度由调用方传入（如 world-init 默认 10%，loot-roll 默认 5%）
 *
 * 输出 MirrorComparisonResult 由 mirror-validator.convertMirrorResults() 转换为 O-10 Issue[]。
 *
 * 不变量校验：
 * - 每个镜像器定义自己的"关键不变量"（如"POI 放置数量 ≤ 候选格数"）
 * - 不变量违反 emit InvariantViolation，由 mirror-validator 转换为 invariant_violation rule
 */

/**
 * 对比维度（对齐执行案 §4.1.2）。
 *
 * - count：数量对比（前端镜像总数 vs 后端权威总数）
 * - distribution：分布对比（tide × region 矩阵分布）
 * - reference：引用对比（item_id / enemy_type / loot_table_id 引用闭合）
 * - capacity：容量对比（容量利用率）
 */
export type MirrorDifferenceDimension = 'count' | 'distribution' | 'reference' | 'capacity';

/**
 * 镜像差异（一条）。
 *
 * 维度决定 mirror-validator 转换到哪个 rule ID：
 *   - count → ${mirrorId}.count_mismatch
 *   - distribution → ${mirrorId}.distribution_mismatch
 *   - reference / capacity → ${mirrorId}.invariant_violation
 */
export interface MirrorDifference {
  /** 差异维度 */
  dimension: MirrorDifferenceDimension;
  /** 后端权威值（期望值） */
  expected: unknown;
  /** 前端镜像值（实际值） */
  actual: unknown;
  /** 容忍度（如 0.10 = 10%）——超出容忍度时 isWithinTolerance=false */
  tolerance: number;
  /** 是否在容忍度内——false 时 mirror-validator emit error + blocking */
  isWithinTolerance: boolean;
}

/**
 * 不变量违反（一条）。
 *
 * 不变量校验与差异校验正交——即使数量/分布在容忍度内，不变量违反仍 emit error + blocking。
 * 例：POI 放置在不可通行格 / scatter 超过 capacity_per_tile 上限。
 */
export interface InvariantViolation {
  /** 不变量名称（如 "poi_not_on_impassable_tile"） */
  name: string;
  /** 违反详情（人类可读，含具体位置/值） */
  detail: string;
}

/**
 * 镜像对比结果（一个镜像器一次对比）。
 *
 * 由 mirror-runner 调用 compareSnapshot() 生成，传递给 mirror-validator.convertMirrorResults()。
 */
export interface MirrorComparisonResult {
  /** 镜像器 ID（如 'world-init' / 'day-refresh' / 'loot-roll' / 'enemy-spawn'） */
  mirrorId: string;
  /** 对比时间戳（Date.now()） */
  timestamp: number;
  /** 后端权威快照（原始数据，便于调试与日志） */
  backendSnapshot: unknown;
  /** 前端镜像输出（原始数据） */
  mirrorOutput: unknown;
  /** 差异列表（按维度分类） */
  differences: MirrorDifference[];
  /** 不变量违反列表 */
  invariantViolations: InvariantViolation[];
  /** 整体严重级别——有差异或不变量违反时 'error'，否则 'warning' */
  severity: 'error' | 'warning';
  /** 是否阻断发布——error + blocking=true 时阻断，warning 时不阻断 */
  blocking: boolean;
  /** 人类可读摘要（如 "POI 数量差异 8%（在容忍度 10% 内）"） */
  summary: string;
}

// ─── 对比配置 ───────────────────────────────────────────────────

/**
 * 对比配置——由调用方（mirror-runner）传入，每个镜像器可定义不同容忍度。
 *
 * 容忍度默认值（执行案 §4.2）：
 *   - world-init：数量 10%，分布 10%
 *   - day-refresh：数量 10%，分布 10%
 *   - loot-roll：分布 5%（N=1000 次掷骰统计）
 *   - 精确对比镜像器：0（1:1 精确对比，无容忍度）
 *   - enemy-spawn：数量 10%，分布 10%
 */
export interface CompareOptions {
  /** 数量差异容忍度（0-1，默认 0.10 = 10%） */
  countTolerance?: number;
  /** 分布差异容忍度（0-1，默认 0.10 = 10%） */
  distributionTolerance?: number;
  /** 是否 1:1 精确对比（默认 false） */
  exactMatch?: boolean;
}

const DEFAULT_COUNT_TOLERANCE = 0.10;
const DEFAULT_DISTRIBUTION_TOLERANCE = 0.10;

// ─── 对比入口 ───────────────────────────────────────────────────

/**
 * 对比前端镜像输出与后端权威快照（执行案 §4.4.2）。
 *
 * 调用方（mirror-runner）在镜像器计算完前端镜像输出后调用本函数：
 *   1. 调用 snapshot-fetcher 拉取后端权威快照
 *   2. 调用镜像器计算前端镜像输出
 *   3. 调用 compareSnapshot() 对比两者
 *   4. 把 MirrorComparisonResult 传给 mirror-validator.convertMirrorResults()
 *
 * 本函数是纯函数——不调用后端、不读取 graph-store，仅做对比计算。
 *
 * @param mirrorId 镜像器 ID（用于 result.mirrorId）
 * @param backendSnapshot 后端权威快照（snapshot-fetcher 输出）
 * @param mirrorOutput 前端镜像输出（镜像器计算结果）
 * @param invariantViolations 镜像器自检的不变量违反列表（可为空）
 * @param options 对比配置（容忍度等）
 * @returns MirrorComparisonResult——传递给 mirror-validator.convertMirrorResults()
 */
export function compareSnapshot(
  mirrorId: string,
  backendSnapshot: unknown,
  mirrorOutput: unknown,
  invariantViolations: InvariantViolation[] = [],
  options: CompareOptions = {},
): MirrorComparisonResult {
  const countTolerance = options.countTolerance ?? DEFAULT_COUNT_TOLERANCE;
  const distributionTolerance = options.distributionTolerance ?? DEFAULT_DISTRIBUTION_TOLERANCE;
  const exactMatch = options.exactMatch ?? false;

  const differences: MirrorDifference[] = [];

  if (exactMatch) {
    // 1:1 精确对比——任意差异都 emit，无容忍度
    if (!deepEqual(backendSnapshot, mirrorOutput)) {
      differences.push({
        dimension: 'count',
        expected: backendSnapshot,
        actual: mirrorOutput,
        tolerance: 0,
        isWithinTolerance: false,
      });
    }
  } else {
    // 数量对比——如果两端都提供 count 字段，则对比
    const backendCount = tryGetCount(backendSnapshot);
    const mirrorCount = tryGetCount(mirrorOutput);
    if (backendCount !== null && mirrorCount !== null) {
      const diff = Math.abs(backendCount - mirrorCount);
      const toleranceValue = backendCount * countTolerance;
      differences.push({
        dimension: 'count',
        expected: backendCount,
        actual: mirrorCount,
        tolerance: countTolerance,
        isWithinTolerance: diff <= toleranceValue,
      });
    }

    // 分布对比——如果两端都提供 distribution 字段，则对比
    const backendDist = tryGetDistribution(backendSnapshot);
    const mirrorDist = tryGetDistribution(mirrorOutput);
    if (backendDist && mirrorDist) {
      const distDiff = computeDistributionDifference(backendDist, mirrorDist);
      differences.push({
        dimension: 'distribution',
        expected: backendDist,
        actual: mirrorDist,
        tolerance: distributionTolerance,
        isWithinTolerance: distDiff <= distributionTolerance,
      });
    }
  }

  // 判定整体 severity 与 blocking
  const hasBlockingDifference = differences.some((d) => !d.isWithinTolerance);
  const hasInvariantViolation = invariantViolations.length > 0;
  const severity: 'error' | 'warning' = hasBlockingDifference || hasInvariantViolation ? 'error' : 'warning';
  const blocking = severity === 'error';

  // 生成人类可读摘要
  const summary = buildSummary(mirrorId, differences, invariantViolations);

  return {
    mirrorId,
    timestamp: Date.now(),
    backendSnapshot,
    mirrorOutput,
    differences,
    invariantViolations,
    severity,
    blocking,
    summary,
  };
}

// ─── 后端不可达对比结果构造 ─────────────────────────────────────

/**
 * 构造"后端不可达"对比结果（执行案 §8.2 风险二回退策略）。
 *
 * snapshot-fetcher 拉取后端 State API 失败时，mirror-runner 调用本函数生成一个
 * "后端不可达"对比结果，传给 mirror-validator.convertMirrorResults() 后会转换为
 * mirror.backend_unreachable warning（不阻断发布）。
 *
 * @param mirrorId 触发不可达的镜像器 ID（用于日志）
 * @param reason 不可达原因（如 'GatewayUnavailableError' / 'timeout'）
 * @returns MirrorComparisonResult——mirrorId='__backend__'，severity='warning'，blocking=false
 */
export function buildBackendUnreachableResult(
  mirrorId: string,
  reason: string,
): MirrorComparisonResult {
  return {
    mirrorId: '__backend__',
    timestamp: Date.now(),
    backendSnapshot: null,
    mirrorOutput: null,
    differences: [],
    invariantViolations: [],
    severity: 'warning',
    blocking: false,
    summary: `镜像器 ${mirrorId} 拉取后端快照失败：${reason}`,
  };
}

// ─── 内部工具 ───────────────────────────────────────────────────

/**
 * 浅层深度相等——用于 1:1 精确对比。
 *
 * 不做完整 deepEqual——镜像输出应保持为简单结构，JSON.stringify 对比足够。
 */
function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * 尝试从快照中提取数量字段（优先 count / total / length）。
 *
 * 返回 null 表示快照未提供数量字段——调用方应跳过数量对比。
 */
function tryGetCount(snapshot: unknown): number | null {
  if (snapshot == null || typeof snapshot !== 'object') return null;
  const obj = snapshot as Record<string, unknown>;
  if (typeof obj.count === 'number') return obj.count;
  if (typeof obj.total === 'number') return obj.total;
  if (Array.isArray(obj.items)) return obj.items.length;
  if (Array.isArray(obj.entries)) return obj.entries.length;
  return null;
}

/**
 * 尝试从快照中提取分布字段（distribution）。
 *
 * 返回 null 表示快照未提供分布字段——调用方应跳过分布对比。
 * 分布字段预期是 Record<string, number>，key 是 tide 或 pgroup 等分类键。
 */
function tryGetDistribution(snapshot: unknown): Record<string, number> | null {
  if (snapshot == null || typeof snapshot !== 'object') return null;
  const obj = snapshot as Record<string, unknown>;
  const dist = obj.distribution;
  if (dist == null || typeof dist !== 'object' || Array.isArray(dist)) return null;
  // 校验所有 value 都是 number
  const result: Record<string, number> = {};
  for (const [k, v] of Object.entries(dist as Record<string, unknown>)) {
    if (typeof v !== 'number') return null;
    result[k] = v;
  }
  return result;
}

/**
 * 计算两个分布的差异度（平均绝对百分比差异）。
 *
 * 返回 0-1 之间的值，0 表示完全一致，1 表示完全不一致。
 * 算法：对每个 key 计算 |backend - mirror| / max(backend, 1)，取平均。
 */
function computeDistributionDifference(
  backend: Record<string, number>,
  mirror: Record<string, number>,
): number {
  const allKeys = new Set([...Object.keys(backend), ...Object.keys(mirror)]);
  if (allKeys.size === 0) return 0;

  let totalDiff = 0;
  for (const key of allKeys) {
    const b = backend[key] ?? 0;
    const m = mirror[key] ?? 0;
    const denom = Math.max(Math.abs(b), 1);
    totalDiff += Math.abs(b - m) / denom;
  }
  return totalDiff / allKeys.size;
}

/**
 * 构造人类可读摘要。
 */
function buildSummary(
  mirrorId: string,
  differences: MirrorDifference[],
  invariantViolations: InvariantViolation[],
): string {
  const parts: string[] = [];
  for (const diff of differences) {
    const tolerancePercent = (diff.tolerance * 100).toFixed(1);
    const status = diff.isWithinTolerance ? '在容忍度内' : '超出容忍度';
    parts.push(`${diff.dimension} ${status}（容忍度 ${tolerancePercent}%）`);
  }
  if (invariantViolations.length > 0) {
    parts.push(`${invariantViolations.length} 个不变量违反`);
  }
  if (parts.length === 0) {
    return `镜像器 ${mirrorId} 对比通过，无差异`;
  }
  return `镜像器 ${mirrorId}：${parts.join('；')}`;
}
