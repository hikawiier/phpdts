// ══════════════════════════════════════════════════
// 命令队列 + 防抖 + 战斗状态机锁
//
// 替代现有 vex/js/command-queue.js 的 CommandQueue 单例。
// 防止快速连续点击导致重复提交，支持冷却时间。
//
// 状态机重构（阶段2）：
//   - 用 obl_battle_state === 'NPC_ACTING' 替代 pendingNpc 锁
//   - 移除独立轮询定时器（由 battle.ts 统一管理轮询）
//   - 推进 tick 成功后拉取 player_info 更新状态机，广播 game:tick-advanced
//     由 battle.ts 响应事件并决定是否启动/停止轮询
//   - isLocked / pendingNpc getter 直接从 playerStore.oblBattleState 派生
// ══════════════════════════════════════════════════

import { submitCommand, type CommandResult } from '@/api/client';
import { dataManager } from '@/stores/data-manager';
import { useToastStore } from '@/stores/toast';
import { usePlayerStore } from '@/stores/player';

/**
 * 推进 tick 的命令白名单（与后端 obl_command_advances_tick() 保持一致）
 * 这些命令执行后 NPC 先攻轮会被触发，前端需等待 NPC_ACTING 状态清除
 */
const TICK_ADVANCING_COMMANDS = new Set([
  'move',
  'obl_explore',
  'obl_search',
  'obl_battle_start',
  'obl_battle_action',
]);

class CommandQueue {
  private _locked = false;
  private _cooldown = 0;

  /**
   * 执行命令（带锁 + 冷却 + 状态机锁检查）
   *
   * @param params 提交给 command.php 的参数
   * @returns CommandResult（与 submitCommand 返回结构一致）
   *   - HTTP 锁定时返回 { success: false, error: 'LOCKED', message: '操作进行中' }
   *   - 冷却中返回 { success: false, error: 'COOLDOWN', message: '冷却中' }
   *   - NPC_ACTING 状态 + 推进 tick 命令返回 { success: false, error: 'PENDING_NPC', message: 'NPC 行动中，请稍候' }
   */
  async execute(params: Record<string, string>): Promise<CommandResult> {
    // ── HTTP 请求锁（覆盖单次请求周期） ──
    if (this._locked) {
      return { success: false, error: 'LOCKED', message: '操作进行中' };
    }
    if (this._cooldown > Date.now()) {
      return { success: false, error: 'COOLDOWN', message: '冷却中' };
    }

    // ── 状态机锁：NPC_ACTING 状态时阻止推进 tick 的命令 ──
    const command = params.command || '';
    const advancesTick = TICK_ADVANCING_COMMANDS.has(command);
    if (advancesTick && usePlayerStore().oblBattleState === 'NPC_ACTING') {
      useToastStore().showToast(
        'NPC 行动中，请稍候',
        'warning',
        2000,
        false,
        'pending-npc',
      );
      return { success: false, error: 'PENDING_NPC', message: 'NPC 行动中，请稍候' };
    }

    this._locked = true;
    try {
      const result = await submitCommand(params);
      // 后端返回 timer 时设置冷却（单位：秒）
      if (result.timer) {
        this._cooldown = Date.now() + result.timer * 1000;
      }
      // 成功推进 tick 后拉取最新状态并广播事件（由 battle.ts 决定轮询行为）
      if (result.success && advancesTick) {
        await this._checkBattleState();
      }
      return result;
    } finally {
      this._locked = false;
    }
  }

  /**
   * 推进 tick 后检查战斗状态
   *
   * 拉取 player_info（同时触发后端 common.inc 的 NPC 先攻轮），
   * 更新 playerStore.oblBattleState，然后广播 game:tick-advanced 事件，
   * 由 battle.ts 响应并决定是否启动/停止轮询。
   */
  private async _checkBattleState(): Promise<void> {
    try {
      await dataManager.fetch('player_info', true);
      // 广播事件，由 battle.ts 监听并调用 refreshBattle 决定轮询行为
      dataManager.broadcast('game:tick-advanced');
    } catch (e) {
      console.error('[CommandQueue] checkBattleState error:', e);
    }
  }

  /** 是否锁定中（HTTP 锁或 NPC_ACTING 状态锁） */
  get isLocked(): boolean {
    return this._locked || usePlayerStore().oblBattleState === 'NPC_ACTING';
  }

  /** NPC 是否待结算中（NPC_ACTING 状态，由状态机派生，供 UI 绑定） */
  get pendingNpc(): boolean {
    return usePlayerStore().oblBattleState === 'NPC_ACTING';
  }

  /** 剩余冷却时间（毫秒） */
  get remainingCooldown(): number {
    const remaining = this._cooldown - Date.now();
    return remaining > 0 ? remaining : 0;
  }

  /** 销毁（轮询由 battle.ts 统一管理，无需清理定时器） */
  destroy(): void {
    // no-op
  }
}

/** 命令队列单例（与现有 commandQueue 导出一致） */
export const commandQueue = new CommandQueue();
