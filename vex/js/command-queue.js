// ══════════════════════════════════════════════════
// CommandQueue — 命令队列 + 防抖
// 防止快速连续点击导致重复提交，支持冷却时间
// ══════════════════════════════════════════════════

import { submitCommand } from './utils.js';

class CommandQueue {
    constructor() {
        this._locked = false;
        this._cooldown = 0;
        this._cooldownTimer = null;
    }

    async execute(params) {
        if (this._locked) {
            return { success: false, error: 'LOCKED', message: '操作进行中' };
        }
        if (this._cooldown > Date.now()) {
            return { success: false, error: 'COOLDOWN', message: '冷却中' };
        }

        this._locked = true;
        try {
            const result = await submitCommand(params);
            if (result.timer) {
                this._cooldown = Date.now() + (result.timer * 1000);
            }
            return result;
        } finally {
            this._locked = false;
        }
    }

    get isLocked() {
        return this._locked;
    }

    get remainingCooldown() {
        const remaining = this._cooldown - Date.now();
        return remaining > 0 ? remaining : 0;
    }
}

export const commandQueue = new CommandQueue();
