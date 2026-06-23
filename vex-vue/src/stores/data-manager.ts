// ══════════════════════════════════════════════════
// DataManager — 统一数据层
//
// 替代现有 vex/js/data-manager.js 的 DataManager 单例。
// 白名单缓存 + 去重 + 语义事件广播。
//
// 缓存策略：仅白名单 action 缓存（game_map/tile_actions/player_inventory），
//           高频数据（player_info/enemies/obl_log/battle_log）不缓存，每次实时拉取。
// 去重策略：所有 action 共享 _pending 去重，并发请求合并为一个。
//
// 现有实现（data-manager.js）：
//   - fetch(action, forceRefresh) 返回完整响应对象 {status, data, ...}
//   - invalidate(action) / invalidateAll()
//   - broadcast(event, data) / listen(event, cb) / unlisten(event, cb)
// ══════════════════════════════════════════════════

import { gameApi, type ApiResponse } from '@/api/client';
import { perf } from '@/utils/perf';
import type { ApiAction } from '@/api/endpoints';
import type { AppEvent, EventCallback } from '@/types/events';

interface CacheEntry {
  data: ApiResponse;
  timestamp: number;
}

class DataManager {
  /** action -> { data, timestamp }（仅白名单 action） */
  private _cache = new Map<ApiAction, CacheEntry>();
  /** action -> Promise（去重，所有 action 都生效） */
  private _pending = new Map<ApiAction, Promise<ApiResponse>>();
  /** event -> Set<callback>（语义事件订阅） */
  private _listeners = new Map<AppEvent, Set<EventCallback>>();

  /**
   * 白名单：只缓存这些 action，TTL 各自不同
   * player_info, enemies, obl_log, battle_log 不缓存（每次实时拉取）
   */
  private _cacheable = new Map<ApiAction, number>([
    ['game_map', 5000], // 地图结构，5s（移动后 invalidate）
    ['tile_actions', 3000], // 当前格交互，3s（移动后 invalidate）
    ['player_inventory', 2000], // 背包，2s（拾取/丢弃后 invalidate）
  ]);

  /**
   * 拉取数据（带缓存 + 去重）
   *
   * @param action API action
   * @param forceRefresh true 时强制刷新（跳过缓存，但仍走去重）
   * @returns 完整响应对象 {status, data, ...}（与现有 data-manager.js 一致）
   */
  async fetch(action: ApiAction, forceRefresh = false): Promise<ApiResponse> {
    const ttl = this._cacheable.get(action);

    // ── 非白名单 action：不缓存，但保留去重 ──
    if (ttl === undefined) {
      if (this._pending.has(action)) {
        perf.mark(`fetch(${action}) → 去重命中`, 'store');
        return this._pending.get(action)!;
      }
      const promise = gameApi(action)
        .then((result) => {
          this._pending.delete(action);
          return result;
        })
        .catch((err) => {
          this._pending.delete(action);
          throw err;
        });
      this._pending.set(action, promise);
      return promise;
    }

    // ── 白名单 action：走缓存逻辑 ──
    const now = Date.now();
    const cached = this._cache.get(action);

    if (!forceRefresh && cached && now - cached.timestamp < ttl) {
      perf.mark(`fetch(${action}) → 缓存命中`, 'store');
      return cached.data;
    }

    if (this._pending.has(action)) {
      perf.mark(`fetch(${action}) → 去重命中(白名单)`, 'store');
      return this._pending.get(action)!;
    }

    const promise = gameApi(action)
      .then((result) => {
        this._cache.set(action, { data: result, timestamp: Date.now() });
        this._pending.delete(action);
        return result;
      })
      .catch((err) => {
        this._pending.delete(action);
        throw err;
      });

    this._pending.set(action, promise);
    return promise;
  }

  /**
   * 失效指定 action 的缓存
   * 白名单内才需要清缓存；非白名单本就无缓存。
   */
  invalidate(action: ApiAction): void {
    if (this._cacheable.has(action)) {
      this._cache.delete(action);
    }
  }

  /** 失效所有白名单缓存 */
  invalidateAll(): void {
    this._cache.clear();
  }

  // ─── 语义事件机制（模块间通信，独立于 API action） ───
  // 操作完成时 broadcast('game:action-completed')，各面板 listen 后自行刷新
  broadcast(event: AppEvent, data?: unknown): void {
    const listeners = this._listeners.get(event);
    if (listeners) {
      perf.span(`broadcast(${event}) → ${listeners.size} listeners`, 'broadcast', () => {
        listeners.forEach((cb) => cb(data));
      });
    }
  }

  /** 订阅事件 */
  listen(event: AppEvent, callback: EventCallback): void {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event)!.add(callback);
  }

  /** 取消订阅 */
  unlisten(event: AppEvent, callback: EventCallback): void {
    const listeners = this._listeners.get(event);
    if (listeners) {
      listeners.delete(callback);
      if (listeners.size === 0) this._listeners.delete(event);
    }
  }
}

/** DataManager 单例（与现有 dataManager 导出一致） */
export const dataManager = new DataManager();
