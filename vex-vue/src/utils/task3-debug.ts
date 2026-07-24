/**
 * @module K 状态管理层
 *
 * ══════════════════════════════════════════════════
 * Task3 调试桩基础设施 / Animation Dispatch Tracer
 * ══════════════════════════════════════════════════
 *
 * 用途：在动画派发全链路（K-10 角色动画意图派发 / K-12 移动导演演出框架 /
 *      M-1 租赁式动画架构）关键点放置持久化调试桩，让用户在浏览器中复现
 *      问题后，可通过 window.__TASK3_DEBUG 全局对象导出完整事件日志供根因分析。
 *
 * 设计原则：
 *   - 持久化到源码（非运行时 evaluate_script 注入），用户复现问题时无需我实时介入
 *   - 受 import.meta.env.DEV 守卫，生产构建整体失效（连 import 都不产生副作用）
 *   - 不破坏业务门控、时序、事务、持久化语义：log() 是纯观察函数，不返回值、不抛错、
 *     不阻塞（同步写入循环缓冲区后立即返回）
 *   - 内部循环缓冲区上限 1000 条，超出后覆盖最旧条目，防止内存爆炸
 *   - 每个事件携带双时间戳（performance.now() 用于相对时序分析，
 *     Date.now() 用于跨页面/跨会话对齐）、事件类型、关键数据、可选调用栈
 *   - 任务唯一前缀 [TASK3_DEBUG] + 彩色 console 输出，便于用户实时观察
 *
 * 浏览器侧接口（DEV 模式挂载到 window.__TASK3_DEBUG）：
 *   - events()           返回所有事件数组的副本
 *   - clear()            清空缓冲区
 *   - summary()          返回事件统计（按类型分组计数）
 *   - download()         下载所有事件为 JSON 文件
 *   - tail(n=20)         返回最近 N 条事件
 *   - filter(type)       按事件类型过滤（支持字符串或正则）
 *   - since(ts)          返回某时间戳（Date.now()）之后的事件
 *
 * 使用示例（业务代码埋桩）：
 *   import { task3Debug } from '@/utils/task3-debug';
 *   task3Debug.log('move-director.play.step', { stepIdx, from_pls, to_pls, tier });
 *   task3Debug.log('actor-runtime.acquire', { actorId, owner, channels }, true);  // 第三个参数 captureStack=true
 */

// ── 事件类型 ──
export interface Task3DebugEvent {
  /** 相对时间戳（performance.now()，页面加载后毫秒数，用于相对时序分析） */
  t: number;
  /** 绝对时间戳（Date.now()，Unix 毫秒，用于跨页面/跨会话对齐） */
  ts: number;
  /** 事件类型（点分命名空间，如 "move-director.play.step"） */
  type: string;
  /** 关键数据（任意可序列化对象） */
  data: unknown;
  /** 调用栈（仅在 log() 显式请求时捕获，避免性能开销） */
  stack?: string | null;
}

// ── 内部状态 ──
const MAX_EVENTS = 1000;
const buffer: Task3DebugEvent[] = [];
let overflowed = 0;

// DEV 守卫：生产构建中所有 log() 调用整体失效
const IS_DEV = import.meta.env.DEV;

// ── 控制台彩色样式（按事件类型命名空间分色） ──
const STYLE_BASE = 'font-weight:bold;padding:2px 4px;border-radius:3px;';
const STYLE_BY_NAMESPACE: Array<{ prefix: string; style: string }> = [
  { prefix: 'move-director', style: STYLE_BASE + 'background:#1e3a8a;color:#bfdbfe;' },
  { prefix: 'map-entities', style: STYLE_BASE + 'background:#581c87;color:#e9d5ff;' },
  { prefix: 'actor-runtime', style: STYLE_BASE + 'background:#166534;color:#bbf7d0;' },
  { prefix: 'move-animation-channel', style: STYLE_BASE + 'background:#9a3412;color:#fed7aa;' },
  { prefix: 'map-store', style: STYLE_BASE + 'background:#7c2d12;color:#fecaca;' },
  { prefix: 'map-render', style: STYLE_BASE + 'background:#134e4a;color:#99f6e4;' },
  { prefix: 'command-queue', style: STYLE_BASE + 'background:#374151;color:#f3f4f6;' },
];
const STYLE_DEFAULT = STYLE_BASE + 'background:#334155;color:#e2e8f0;';

function pickStyle(type: string): string {
  for (const entry of STYLE_BY_NAMESPACE) {
    if (type.startsWith(entry.prefix)) return entry.style;
  }
  return STYLE_DEFAULT;
}

/**
 * 安全序列化：避免循环引用/BigInt/DOM 节点等导致 console 与 JSON.stringify 抛错。
 * 失败时返回占位字符串，绝不影响业务调用方。
 */
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, (_key, v) => {
      if (typeof v === 'bigint') return String(v) + 'n';
      if (typeof v === 'function') return `[Function: ${v.name || 'anonymous'}]`;
      if (v instanceof Error) return { name: v.name, message: v.message, stack: v.stack };
      if (v instanceof HTMLElement) return `[HTMLElement: ${v.tagName.toLowerCase()}]`;
      return v;
    });
  } catch {
    return '[Unserializable]';
  }
}

/**
 * 记录一条调试事件。
 *
 * @param type  事件类型（点分命名空间，建议格式：模块名.函数.关键点）
 * @param data  关键数据（任意可序列化对象）
 * @param captureStack  是否捕获调用栈（默认 false，仅在调试关键决策点时开启）
 *
 * 安全保证：
 *   - 生产构建整体失效（IS_DEV=false 时直接 return）
 *   - 任何异常被 try/catch 吞掉，绝不影响业务调用方
 *   - 同步写入循环缓冲区后立即返回，不阻塞业务时序
 */
function log(type: string, data: unknown = null, captureStack = false): void {
  if (!IS_DEV) return;
  try {
    const now = performance.now();
    const event: Task3DebugEvent = {
      t: now,
      ts: Date.now(),
      type,
      data,
      stack: captureStack ? new Error('task3-debug stack').stack ?? null : undefined,
    };

    // 循环缓冲区：超出上限覆盖最旧条目
    if (buffer.length >= MAX_EVENTS) {
      buffer.shift();
      overflowed++;
    }
    buffer.push(event);

    // 彩色 console 输出（便于用户实时观察）
    // K-12-H：在 console 输出中显示 performance.now() 时间戳，便于定位卡顿位置
    const style = pickStyle(type);
    const dataStr = safeStringify(data);
    const timeStr = now.toFixed(1).padStart(9, ' ');
    console.log(`%c[TASK3_DEBUG] ${timeStr}ms ${type}`, style, dataStr || '');
  } catch {
    // 调试桩自身异常绝不影响业务
  }
}

/**
 * 返回所有事件数组的副本（避免外部修改污染内部缓冲区）。
 */
function events(): Task3DebugEvent[] {
  return buffer.slice();
}

/**
 * 清空缓冲区，重置溢出计数。
 */
function clear(): void {
  buffer.length = 0;
  overflowed = 0;
  if (IS_DEV) {
    console.log('%c[TASK3_DEBUG] buffer cleared', STYLE_DEFAULT);
  }
}

/**
 * 返回事件统计（按类型分组计数 + 溢出信息）。
 */
function summary(): {
  total: number;
  overflowed: number;
  byType: Record<string, number>;
  firstTs: number | null;
  lastTs: number | null;
} {
  const byType: Record<string, number> = {};
  let firstTs: number | null = null;
  let lastTs: number | null = null;
  for (const ev of buffer) {
    byType[ev.type] = (byType[ev.type] ?? 0) + 1;
    if (firstTs === null || ev.ts < firstTs) firstTs = ev.ts;
    if (lastTs === null || ev.ts > lastTs) lastTs = ev.ts;
  }
  return {
    total: buffer.length,
    overflowed,
    byType,
    firstTs,
    lastTs,
  };
}

/**
 * 返回最近 N 条事件（默认 20）。
 */
function tail(n = 20): Task3DebugEvent[] {
  if (n <= 0) return [];
  return buffer.slice(-Math.min(n, buffer.length));
}

/**
 * 按事件类型过滤（支持字符串前缀匹配或正则）。
 */
function filter(type: string | RegExp): Task3DebugEvent[] {
  if (typeof type === 'string') {
    return buffer.filter(ev => ev.type.startsWith(type));
  }
  return buffer.filter(ev => type.test(ev.type));
}

/**
 * 返回某时间戳（Date.now()）之后的事件。
 */
function since(ts: number): Task3DebugEvent[] {
  return buffer.filter(ev => ev.ts >= ts);
}

/**
 * 下载所有事件为 JSON 文件（便于用户分享给我）。
 *
 * 文件名格式：task3-debug-YYYYMMDD-HHmmss.json
 */
function download(): void {
  if (!IS_DEV) return;
  try {
    const payload = {
      _meta: {
        exportedAt: new Date().toISOString(),
        bufferOverflowed: overflowed,
        totalEvents: buffer.length,
        summary: summary(),
      },
      events: buffer,
    };
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const fname = `task3-debug-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.json`;
    a.href = url;
    a.download = fname;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    console.log(`%c[TASK3_DEBUG] downloaded ${buffer.length} events to ${fname}`, STYLE_DEFAULT);
  } catch (e) {
    console.error('[TASK3_DEBUG] download failed:', e);
  }
}

// ── 对外导出的调试桩 API ──
export const task3Debug = {
  log,
  events,
  clear,
  summary,
  tail,
  filter,
  since,
  download,
};

// ── 类型声明：window.__TASK3_DEBUG ──
declare global {
  interface Window {
    __TASK3_DEBUG?: typeof task3Debug;
  }
}
