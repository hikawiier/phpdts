/**
 * @module A API 层
 */

// ══════════════════════════════════════════════════
// DebugBus — 极简事件总线
//
// 替代现有 vex/js/data.js 的 DebugBus 单例。
// 始终存在，零开销（无订阅者时 emit 为空操作）。
// 其他模块通过 DebugBus.emit() 投递事件，不依赖 debug.js。
// debug.js 订阅事件后按 AI 需求格式化输出。
//
// 现有实现（data.js IIFE）：
//   - MAX_BUFFER = 200（环形缓冲区）
//   - emit(cat, step, data) / snapshot() / on(fn) / off(fn)
//   - registerState(name, fn) / getState()
// ══════════════════════════════════════════════════

import type { DebugBusEntry, DebugStateSnapshot } from '@/types/events';
import { isDebugAllEnabled, isDebugEnabled } from '@/utils/debug-flags';

const MAX_BUFFER = 1000;
const startedAt = typeof performance !== 'undefined' ? performance.now() : 0;

/**
 * 是否启用调试查询接口挂载（A-5-2 加固，设计案 §3.6）
 *
 * 语义澄清：DebugBus.emit() 内部始终写入缓冲区（始终收集），
 * 但业务调用点用此变量守卫避免生产环境的参数计算开销，
 * window.__phpdtsDebug 查询接口也仅在 DEV/debug 下挂载。
 *
 * 改名自 actorTraceEnabled：原命名模糊（"actor trace" 仅是子能力），
 * 新名 debugQueryEnabled 明确表达"启用调试查询"语义。
 */
export const debugQueryEnabled = import.meta.env.DEV
  || isDebugEnabled('actor')
  || isDebugAllEnabled();

/** @deprecated 保留别名兼容未迁移的调用点，新代码请用 debugQueryEnabled */
export const actorTraceEnabled = debugQueryEnabled;

class DebugBus {
  private _buffer: DebugBusEntry[] = [];
  private _writeIdx = 0;
  private _seq = 0;
  private _overflowed = 0;
  private _listeners: Array<(entry: DebugBusEntry) => void> = [];
  private _stateHooks: Array<{ name: string; fn: () => unknown }> = [];

  /**
   * 投递事件
   *
   * @param cat 事件类别（如 'map' / 'battle' / 'error'）
   * @param step 事件步骤（如 'loadMap:start' / 'window:error'）
   * @param data 事件数据
   */
  emit(cat: string, step: string, data?: unknown): void {
    const entry: DebugBusEntry = {
      seq: ++this._seq,
      t: typeof performance !== 'undefined' ? performance.now() - startedAt : 0,
      ts: Date.now(),
      cat,
      step,
      data: data ?? null,
    };
    if (this._buffer.length < MAX_BUFFER) {
      this._buffer.push(entry);
    } else {
      this._buffer[this._writeIdx % MAX_BUFFER] = entry;
      this._overflowed++;
    }
    this._writeIdx++;
    for (let i = 0; i < this._listeners.length; i++) {
      try {
        this._listeners[i](entry);
      } catch {
        // 订阅者异常不影响其他订阅者
      }
    }
  }

  /** 获取缓冲区快照（按时间顺序） */
  snapshot(): DebugBusEntry[] {
    if (this._buffer.length < MAX_BUFFER) return this._buffer.slice();
    const result: DebugBusEntry[] = [];
    for (let i = 0; i < MAX_BUFFER; i++) {
      result.push(this._buffer[(this._writeIdx + i) % MAX_BUFFER]);
    }
    return result;
  }

  since(seq: number): DebugBusEntry[] {
    return this.snapshot().filter(entry => entry.seq > seq);
  }

  tail(count = 20): DebugBusEntry[] {
    if (count <= 0) return [];
    return this.snapshot().slice(-Math.min(count, MAX_BUFFER));
  }

  clear(): void {
    this._buffer = [];
    this._writeIdx = 0;
    this._overflowed = 0;
  }

  summary(): { total: number; overflowed: number; lastSeq: number; byCategory: Record<string, number> } {
    const entries = this.snapshot();
    const byCategory: Record<string, number> = {};
    for (const entry of entries) byCategory[entry.cat] = (byCategory[entry.cat] ?? 0) + 1;
    return {
      total: entries.length,
      overflowed: this._overflowed,
      lastSeq: this._seq,
      byCategory,
    };
  }

  /** 订阅事件 */
  on(fn: (entry: DebugBusEntry) => void): void {
    this._listeners.push(fn);
  }

  /** 取消订阅 */
  off(fn: (entry: DebugBusEntry) => void): void {
    const idx = this._listeners.indexOf(fn);
    if (idx >= 0) this._listeners.splice(idx, 1);
  }

  /**
   * 注册状态钩子（供 getState 调用）
   *
   * @param name 状态名
   * @param fn 状态获取函数
   */
  registerState(name: string, fn: () => unknown): void {
    this._stateHooks.push({ name, fn });
  }

  /** 获取所有注册状态的快照 */
  getState(): DebugStateSnapshot {
    const state: DebugStateSnapshot = {};
    for (let i = 0; i < this._stateHooks.length; i++) {
      try {
        state[this._stateHooks[i].name] = this._stateHooks[i].fn();
      } catch {
        // 单个钩子异常不影响其他钩子
      }
    }
    return state;
  }
}

/** DebugBus 单例（与现有 DebugBus 导出一致） */
export const debugBus = new DebugBus();

if (debugQueryEnabled) {
  const root = globalThis as Record<string, unknown>;
  root.__phpdtsDebug = {
    ...((root.__phpdtsDebug as Record<string, unknown> | undefined) ?? {}),
    events: () => debugBus.snapshot(),
    since: (seq: number) => debugBus.since(seq),
    tail: (count?: number) => debugBus.tail(count),
    summary: () => debugBus.summary(),
    clear: () => debugBus.clear(),
    actorTimeline: () => debugBus.snapshot().filter(entry =>
      entry.cat === 'actor'
      || entry.cat === 'actor-runtime'
      || entry.cat === 'battle-playback'),
    actorTimelineJson: () => JSON.stringify(debugBus.snapshot().filter(entry =>
      entry.cat === 'actor'
      || entry.cat === 'actor-runtime'
      || entry.cat === 'battle-playback'), null, 2),
    state: () => debugBus.getState(),
  };
}
