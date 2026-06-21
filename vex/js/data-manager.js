// ══════════════════════════════════════════════════
// DataManager — 统一数据层
// 白名单缓存 + 去重 + 语义事件广播
//
// 缓存策略：仅白名单 action 缓存（game_map/tile_actions/player_inventory），
//           高频数据（player_info/enemies/obl_log/battle_log）不缓存，每次实时拉取。
// 去重策略：所有 action 共享 _pending 去重，并发请求合并为一个。
// ══════════════════════════════════════════════════

import { gameApi } from './utils.js';

class DataManager {
    constructor() {
        this._cache = new Map();        // action -> { data, timestamp }（仅白名单 action）
        this._pending = new Map();       // action -> Promise（去重，所有 action 都生效）
        this._listeners = new Map();     // event -> Set<callback>（语义事件订阅）

        // 白名单：只缓存这些 action，TTL 各自不同
        this._cacheable = new Map([
            ['game_map', 5000],           // 地图结构，5s（移动后 invalidate）
            ['tile_actions', 3000],       // 当前格交互，3s（移动后 invalidate）
            ['player_inventory', 2000],   // 背包，2s（拾取/丢弃后 invalidate）
        ]);
        // player_info, enemies, obl_log, battle_log 不缓存
    }

    async fetch(action, forceRefresh = false) {
        const ttl = this._cacheable.get(action);

        // ── 非白名单 action：不缓存，但保留去重 ──
        if (ttl === undefined) {
            if (this._pending.has(action)) {
                return this._pending.get(action);
            }
            const promise = gameApi(action).then(result => {
                this._pending.delete(action);
                return result;
            }).catch(err => {
                this._pending.delete(action);
                throw err;
            });
            this._pending.set(action, promise);
            return promise;
        }

        // ── 白名单 action：走缓存逻辑 ──
        const now = Date.now();
        const cached = this._cache.get(action);

        if (!forceRefresh && cached && (now - cached.timestamp < ttl)) {
            return cached.data;
        }

        if (this._pending.has(action)) {
            return this._pending.get(action);
        }

        const promise = gameApi(action).then(result => {
            this._cache.set(action, { data: result, timestamp: Date.now() });
            this._pending.delete(action);
            return result;
        }).catch(err => {
            this._pending.delete(action);
            throw err;
        });

        this._pending.set(action, promise);
        return promise;
    }

    invalidate(action) {
        // 白名单内才需要清缓存；非白名单本就无缓存
        if (this._cacheable.has(action)) {
            this._cache.delete(action);
        }
    }

    invalidateAll() {
        // 只清白名单缓存
        this._cache.clear();
    }

    // ─── 语义事件机制（模块间通信，独立于 API action） ───
    // 操作完成时 broadcast('game:action-completed')，各面板 listen 后自行刷新
    broadcast(event, data) {
        const listeners = this._listeners.get(event);
        if (listeners) listeners.forEach(cb => cb(data));
    }

    listen(event, callback) {
        if (!this._listeners.has(event)) {
            this._listeners.set(event, new Set());
        }
        this._listeners.get(event).add(callback);
    }

    unlisten(event, callback) {
        const listeners = this._listeners.get(event);
        if (listeners) {
            listeners.delete(callback);
            if (listeners.size === 0) this._listeners.delete(event);
        }
    }
}

export const dataManager = new DataManager();
