// ══════════════════════════════════════════════════
// DataManager — 统一数据层
// 解决 API 重复请求问题：缓存 + 去重 + 订阅通知
// ══════════════════════════════════════════════════

import { gameApi } from './utils.js';

class DataManager {
    constructor() {
        this._cache = new Map();       // action -> { data, timestamp }
        this._pending = new Map();      // action -> Promise（去重）
        this._ttl = 2000;              // 缓存有效期 2 秒
        this._subscribers = new Map();  // action -> Set<callback>（API 数据订阅）
        this._listeners = new Map();    // event -> Set<callback>（语义事件订阅）
    }

    async fetch(action, forceRefresh = false) {
        const now = Date.now();
        const cached = this._cache.get(action);

        // 缓存有效且非强制刷新
        if (!forceRefresh && cached && (now - cached.timestamp < this._ttl)) {
            return cached.data;
        }

        // 去重：同一 action 的并发请求合并为一个
        if (this._pending.has(action)) {
            return this._pending.get(action);
        }

        const promise = gameApi(action).then(result => {
            this._cache.set(action, { data: result, timestamp: Date.now() });
            this._pending.delete(action);
            this._notify(action, result);
            return result;
        }).catch(err => {
            this._pending.delete(action);
            throw err;
        });

        this._pending.set(action, promise);
        return promise;
    }

    invalidate(action) {
        this._cache.delete(action);
    }

    invalidateAll() {
        this._cache.clear();
    }

    subscribe(action, callback) {
        if (!this._subscribers.has(action)) {
            this._subscribers.set(action, new Set());
        }
        this._subscribers.get(action).add(callback);
    }

    unsubscribe(action, callback) {
        const subs = this._subscribers.get(action);
        if (subs) {
            subs.delete(callback);
            if (subs.size === 0) this._subscribers.delete(action);
        }
    }

    _notify(action, data) {
        const subs = this._subscribers.get(action);
        if (subs) subs.forEach(cb => cb(data));
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
