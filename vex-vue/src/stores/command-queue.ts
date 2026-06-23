// ══════════════════════════════════════════════════
// 命令队列 + 防抖 + NPC 待结算锁
//
// 替代现有 vex/js/command-queue.js 的 CommandQueue 单例。
// 防止快速连续点击导致重复提交，支持冷却时间。
//
// 扩展（obl_tick_pending_npc 优化）：
//   - 推进 tick 的命令成功后，自动拉取 player_info 检查 pending_npc
//   - pending_npc=true 时锁定队列（仅阻止推进 tick 的命令），启动 1s 轮询
//   - pending_npc=false 或超时（10s）时解锁，广播 game:npc-settled 事件
//   - 避免玩家在 NPC 结算期间重复提交导致 npc_action_pending 错误
//
// 现有实现（command-queue.js）：
//   - _locked: boolean（HTTP 请求锁）
//   - _cooldown: number（冷却到期时间戳）
//   - execute(params): 检查锁+冷却 → submitCommand → 处理 timer
//   - isLocked / remainingCooldown getter
// ══════════════════════════════════════════════════

import { ref, type Ref } from 'vue';
import { submitCommand, type CommandResult } from '@/api/client';
import { dataManager } from '@/stores/data-manager';
import { useToastStore } from '@/stores/toast';
import type { PlayerInfo } from '@/types/api';

/**
 * 推进 tick 的命令白名单（与后端 obl_command_advances_tick() 保持一致）
 * 这些命令执行后 NPC 先攻轮会被触发，前端需等待 pending_npc 清除
 */
const TICK_ADVANCING_COMMANDS = new Set([
  'move',
  'obl_explore',
  'obl_search',
  'obl_battle_start',
  'obl_battle_action',
]);

/** pendingNpc 轮询间隔（毫秒） */
const PENDING_NPC_POLL_INTERVAL = 1000;

/** pendingNpc 轮询超时（毫秒）— 防止后端异常导致永久锁定 */
const PENDING_NPC_TIMEOUT = 10000;

class CommandQueue {
  private _locked = false;
  private _cooldown = 0;
  /** NPC 待结算锁：true 时阻止推进 tick 的命令（响应式 ref，供 UI 绑定） */
  private _pendingNpc: Ref<boolean> = ref(false);
  /** pendingNpc 轮询定时器 */
  private _pendingNpcTimer: ReturnType<typeof setInterval> | null = null;
  /** pendingNpc 轮询开始时间戳（用于超时兜底） */
  private _pendingNpcStartTime = 0;

  /**
   * 执行命令（带锁 + 冷却 + pendingNpc 检查）
   *
   * @param params 提交给 command.php 的参数
   * @returns CommandResult（与 submitCommand 返回结构一致）
   *   - HTTP 锁定时返回 { success: false, error: 'LOCKED', message: '操作进行中' }
   *   - 冷却中返回 { success: false, error: 'COOLDOWN', message: '冷却中' }
   *   - pendingNpc 锁定 + 推进 tick 命令返回 { success: false, error: 'PENDING_NPC', message: 'NPC 行动中，请稍候' }
   */
  async execute(params: Record<string, string>): Promise<CommandResult> {
    // ── HTTP 请求锁（覆盖单次请求周期） ──
    if (this._locked) {
      return { success: false, error: 'LOCKED', message: '操作进行中' };
    }
    if (this._cooldown > Date.now()) {
      return { success: false, error: 'COOLDOWN', message: '冷却中' };
    }

    // ── pendingNpc 锁：仅阻止推进 tick 的命令 ──
    const command = params.command || '';
    const advancesTick = TICK_ADVANCING_COMMANDS.has(command);
    if (this._pendingNpc.value && advancesTick) {
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
      // 成功推进 tick 后检查 pendingNpc（拉取 player_info 触发后端 NPC 先攻轮）
      if (result.success && advancesTick) {
        await this._checkPendingNpc();
      }
      return result;
    } finally {
      this._locked = false;
    }
  }

  /**
   * 检查 NPC 待结算状态
   *
   * 拉取 player_info（同时触发后端 common.inc 的 NPC 先攻轮），
   * 若 pending_npc=true 则启动轮询等待结算。
   */
  private async _checkPendingNpc(): Promise<void> {
    try {
      const result = await dataManager.fetch('player_info', true);
      if (result.status !== 'success' || !result.data) return;
      const playerInfo = result.data as PlayerInfo;
      if (playerInfo.obl_tick_pending_npc) {
        this._startPendingNpcPolling();
      }
      // pending_npc=false 时不广播 game:npc-settled（无 true→false 转换）
    } catch (e) {
      console.error('[CommandQueue] checkPendingNpc error:', e);
    }
  }

  /** 启动 pendingNpc 轮询 */
  private _startPendingNpcPolling(): void {
    this._pendingNpc.value = true;
    this._pendingNpcStartTime = Date.now();
    if (this._pendingNpcTimer !== null) return; // 已在轮询
    this._pendingNpcTimer = setInterval(() => {
      void this._pollPendingNpc();
    }, PENDING_NPC_POLL_INTERVAL);
  }

  /** 轮询回调：检测 pending_npc 是否清除 */
  private async _pollPendingNpc(): Promise<void> {
    // 超时兜底：强制解锁并广播（防止后端异常导致永久锁定）
    if (Date.now() - this._pendingNpcStartTime > PENDING_NPC_TIMEOUT) {
      console.warn('[CommandQueue] pendingNpc 轮询超时，强制解锁');
      this._stopPendingNpcPolling();
      dataManager.broadcast('game:npc-settled');
      return;
    }

    try {
      const result = await dataManager.fetch('player_info', true);
      if (result.status !== 'success' || !result.data) return;
      const playerInfo = result.data as PlayerInfo;
      if (!playerInfo.obl_tick_pending_npc) {
        // NPC 已结算：停止轮询，广播事件通知各 store 刷新
        this._stopPendingNpcPolling();
        dataManager.broadcast('game:npc-settled');
      }
    } catch (e) {
      console.error('[CommandQueue] pendingNpc poll error:', e);
    }
  }

  /** 停止 pendingNpc 轮询并解锁 */
  private _stopPendingNpcPolling(): void {
    this._pendingNpc.value = false;
    if (this._pendingNpcTimer !== null) {
      clearInterval(this._pendingNpcTimer);
      this._pendingNpcTimer = null;
    }
  }

  /** 是否锁定中（HTTP 锁或 pendingNpc 锁） */
  get isLocked(): boolean {
    return this._locked || this._pendingNpc.value;
  }

  /** NPC 是否待结算中（仅 pendingNpc 锁，不含 HTTP 锁） */
  get pendingNpc(): boolean {
    return this._pendingNpc.value;
  }

  /** 剩余冷却时间（毫秒） */
  get remainingCooldown(): number {
    const remaining = this._cooldown - Date.now();
    return remaining > 0 ? remaining : 0;
  }

  /** 销毁：清理定时器（App.vue onUnmounted 调用） */
  destroy(): void {
    this._stopPendingNpcPolling();
  }
}

/** 命令队列单例（与现有 commandQueue 导出一致） */
export const commandQueue = new CommandQueue();
