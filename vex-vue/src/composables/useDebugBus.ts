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

const MAX_BUFFER = 200;

export const actorTraceEnabled = import.meta.env.DEV
  || (typeof location !== 'undefined' && new URLSearchParams(location.search).get('actor_debug') === '1');

class DebugBus {
  private _buffer: DebugBusEntry[] = [];
  private _writeIdx = 0;
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
      ts: Date.now(),
      cat,
      step,
      data: data ?? null,
    };
    if (this._buffer.length < MAX_BUFFER) {
      this._buffer.push(entry);
    } else {
      this._buffer[this._writeIdx % MAX_BUFFER] = entry;
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

if (actorTraceEnabled) {
  (globalThis as Record<string, unknown>).__phpdtsDebug = {
    events: () => debugBus.snapshot(),
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
