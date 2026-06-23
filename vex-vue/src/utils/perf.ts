// ══════════════════════════════════════════════════
// 临时性能分析工具 / Performance Profiler
//
// 用途：定位指令提交到界面更新的延迟瓶颈
// 使用：在浏览器控制台执行 perf.enable() 开启，perf.disable() 关闭
//       perf.report() 输出汇总报告
// ══════════════════════════════════════════════════

interface PerfMark {
  name: string;
  time: number;
  category: 'api' | 'store' | 'broadcast' | 'render';
  duration?: number;
}

const marks: PerfMark[] = [];
let enabled = false;

function now(): number {
  return performance.now();
}

export const perf = {
  get enabled(): boolean {
    return enabled;
  },

  enable(): void {
    enabled = true;
    marks.length = 0;
    console.warn('[Perf] 性能分析已开启');
  },

  disable(): void {
    enabled = false;
    console.warn('[Perf] 性能分析已关闭');
  },

  /** 标记一个时间点 */
  mark(name: string, category: PerfMark['category'] = 'store'): void {
    if (!enabled) return;
    marks.push({ name, time: now(), category });
  },

  /** 标记一个持续时间段 */
  span<T>(name: string, category: PerfMark['category'], fn: () => T): T {
    if (!enabled) return fn();
    const start = now();
    const result = fn();
    const duration = now() - start;
    marks.push({ name, time: start, category, duration });
    return result;
  },

  /** 标记一个异步持续时间段 */
  async spanAsync<T>(name: string, category: PerfMark['category'], fn: () => Promise<T>): Promise<T> {
    if (!enabled) return fn();
    const start = now();
    const result = await fn();
    const duration = now() - start;
    marks.push({ name, time: start, category, duration });
    return result;
  },

  /** 输出汇总报告 */
  report(): void {
    if (marks.length === 0) {
      console.warn('[Perf] 无记录');
      return;
    }

    const startTime = marks[0].time;
    const endTime = marks[marks.length - 1].time;
    const totalDuration = endTime - startTime;

    console.warn(`[Perf] ═══════════════════════════════════════`);
    console.warn(`[Perf] 总耗时: ${totalDuration.toFixed(1)}ms (${marks.length} 个标记)`);
    console.warn(`[Perf] ──────────────────────────────────────`);

    for (const mark of marks) {
      const offset = mark.time - startTime;
      const prefix = mark.category === 'api' ? '🌐' :
                     mark.category === 'broadcast' ? '📡' :
                     mark.category === 'render' ? '🎨' : '⚙️';
      if (mark.duration !== undefined) {
        console.warn(
          `[Perf] ${offset.toFixed(1).padStart(7)}ms | ${prefix} ${mark.name}: ${mark.duration.toFixed(1)}ms`,
        );
      } else {
        console.warn(
          `[Perf] ${offset.toFixed(1).padStart(7)}ms | ${prefix} ${mark.name}`,
        );
      }
    }
    console.warn(`[Perf] ═══════════════════════════════════════`);

    // 按类别汇总
    const byCategory: Record<string, number> = {};
    for (const mark of marks) {
      if (mark.duration !== undefined) {
        byCategory[mark.category] = (byCategory[mark.category] || 0) + mark.duration;
      }
    }
    if (Object.keys(byCategory).length > 0) {
      console.warn('[Perf] 按类别汇总:');
      for (const [cat, dur] of Object.entries(byCategory)) {
        console.warn(`[Perf]   ${cat}: ${dur.toFixed(1)}ms`);
      }
    }
  },

  /** 清空记录 */
  clear(): void {
    marks.length = 0;
  },
};

// 暴露到 window 供控制台调用
if (typeof window !== 'undefined') {
  (window as unknown as { perf: typeof perf }).perf = perf;
}
