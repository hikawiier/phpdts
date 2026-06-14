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

export const RACE_NAMES = {0:'人类',1:'兽人',2:'妖精',3:'龙',4:'鱼人',5:'ＡＩ'};

export const CLUB_NAMES = {
    0:'无',1:'街头霸王',2:'见敌必斩',3:'灌篮高手',4:'狙击鹰眼',5:'拆弹专家',
    6:'宛如疾风',7:'锡安成员',8:'黑衣组织',9:'超能力者',10:'天赋异禀',
    11:'富家子弟',12:'全能兄贵',13:'铁拳无敌',15:'L5状态',17:'走路萌物',
    19:'晶莹剔透',20:'元素大师',21:'码语行人',22:'枫火歌者',98:'换装迷宫',99:'第一形态'
};

export const RAGE_STATUS = ['平静','愤怒','暴怒','已经死亡'];
export const POSE_NAMES = ['通常','作战姿态','强袭姿态','探物姿态','偷袭姿态','治疗姿态','✧狂飙姿态✧','哨戒姿态'];
export const TACTIC_NAMES = ['通常','','重视防御','重视反击','重视躲避'];

// ══════════════════════════════════════════════════
// 地图状态 / Map state (Oblivions dynamic links map)
// ══════════════════════════════════════════════════

export const mapData = { curLoc: null, curRegion: null, links: null };
