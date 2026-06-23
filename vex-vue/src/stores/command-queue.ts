// ══════════════════════════════════════════════════
// 命令队列 + 防抖
//
// 替代现有 vex/js/command-queue.js 的 CommandQueue 单例。
// 防止快速连续点击导致重复提交，支持冷却时间。
//
// 现有实现（command-queue.js）：
//   - _locked: boolean（HTTP 请求锁）
//   - _cooldown: number（冷却到期时间戳）
//   - execute(params): 检查锁+冷却 → submitCommand → 处理 timer
//   - isLocked / remainingCooldown getter
// ══════════════════════════════════════════════════

import { submitCommand, type CommandResult } from '@/api/client';

class CommandQueue {
  private _locked = false;
  private _cooldown = 0;

  /**
   * 执行命令（带锁 + 冷却检查）
   *
   * @param params 提交给 command.php 的参数
   * @returns CommandResult（与 submitCommand 返回结构一致）
   *   - 锁定时返回 { success: false, error: 'LOCKED', message: '操作进行中' }
   *   - 冷却中返回 { success: false, error: 'COOLDOWN', message: '冷却中' }
   */
  async execute(params: Record<string, string>): Promise<CommandResult> {
    if (this._locked) {
      return { success: false, error: 'LOCKED', message: '操作进行中' };
    }
    if (this._cooldown > Date.now()) {
      return { success: false, error: 'COOLDOWN', message: '冷却中' };
    }

    this._locked = true;
    try {
      const result = await submitCommand(params);
      // 后端返回 timer 时设置冷却（单位：秒）
      if (result.timer) {
        this._cooldown = Date.now() + result.timer * 1000;
      }
      return result;
    } finally {
      this._locked = false;
    }
  }

  /** 是否锁定中 */
  get isLocked(): boolean {
    return this._locked;
  }

  /** 剩余冷却时间（毫秒） */
  get remainingCooldown(): number {
    const remaining = this._cooldown - Date.now();
    return remaining > 0 ? remaining : 0;
  }
}

/** 命令队列单例（与现有 commandQueue 导出一致） */
export const commandQueue = new CommandQueue();
