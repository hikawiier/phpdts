// ══════════════════════════════════════════════════
// 全局配置 / Global configuration
// ══════════════════════════════════════════════════

export const BASE_URL = document.querySelector('meta[name="base-url"]')?.content || '/phpdts';

// ══════════════════════════════════════════════════
// DebugBus — 极简事件总线 / Minimal event bus
// 始终存在，零开销（无订阅者时 emit 为空操作）
// 其他模块通过 DebugBus.emit() 投递事件，不依赖 debug.js
// debug.js 订阅事件后按 AI 需求格式化输出
// ══════════════════════════════════════════════════

export const DebugBus = (function() {
    const MAX_BUFFER = 200;
    const _buffer = [];
    let _writeIdx = 0;
    const _listeners = [];
    const _stateHooks = [];

    function emit(cat, step, data) {
        const entry = {
            ts: Date.now(),
            cat: cat,
            step: step,
            data: data || null
        };
        if (_buffer.length < MAX_BUFFER) {
            _buffer.push(entry);
        } else {
            _buffer[_writeIdx % MAX_BUFFER] = entry;
        }
        _writeIdx++;
        for (let i = 0; i < _listeners.length; i++) {
            try { _listeners[i](entry); } catch(e) {}
        }
    }

    function snapshot() {
        if (_buffer.length < MAX_BUFFER) return _buffer.slice();
        const result = [];
        for (let i = 0; i < MAX_BUFFER; i++) {
            result.push(_buffer[(_writeIdx + i) % MAX_BUFFER]);
        }
        return result;
    }

    function on(fn)  { _listeners.push(fn); }
    function off(fn) {
        const idx = _listeners.indexOf(fn);
        if (idx >= 0) _listeners.splice(idx, 1);
    }

    function registerState(name, fn) { _stateHooks.push({name: name, fn: fn}); }

    function getState() {
        const state = {};
        for (let i = 0; i < _stateHooks.length; i++) {
            try { state[_stateHooks[i].name] = _stateHooks[i].fn(); } catch(e) {}
        }
        return state;
    }

    return {
        emit: emit,
        snapshot: snapshot,
        on: on,
        off: off,
        registerState: registerState,
        getState: getState
    };
})();

// ══════════════════════════════════════════════════
// 资源数据预设 / Resource data presets
// ══════════════════════════════════════════════════

export const GENDER_NAMES = {0:'未定', m:'男生', f:'女生', n:'投影'};

// ══════════════════════════════════════════════════
// 地图状态 / Map state (Oblivions dynamic links map)
// ══════════════════════════════════════════════════

export const mapData = { curLoc: null, curRegion: null, links: null, enemies: [] };
