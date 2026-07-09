// ══════════════════════════════════════════════════
// 命令队列 + 防抖 + 战斗状态机锁
//
// 替代现有 vex/js/command-queue.js 的 CommandQueue 单例。
// 防止快速连续点击导致重复提交，支持冷却时间。
//
// 状态机（3 态，由 playerStore.oblBattleState 派生）：
//   - IDLE / PLAYER_TURN / PROCESSING
//   - 轮询由 battle.ts 统一管理（PROCESSING 300ms / 其他 1000ms 心跳守护进程 + 1000ms NPC 状态轮询）
//   - pendingNpc getter 仅用于 UI 状态展示（StatusBar NPC 指示器）
//
// 锁结构（5 层，详见 docs/战斗锁定白名单-设计案.md §2.7.2）：
//   1. HTTP 请求锁 + 冷却（_locked / _cooldown）
//   2. 战斗演出锁（isPlayingBattleLog）
//   3. itm0 锁（inventoryStore.itm0 !== null，按命令 itm0Allowed 拦截）
//   4. 模式锁（battleStore.currentMode，按命令 mode 拦截）
//   5. PROCESSING 锁（仅拦截 advancesTick 命令）
//
// canExecute(command) 与 execute() 共用 _checkLocks()，保证 UI 查询与
// 实际执行判断完全一致——避免重蹈 isLocked 与 execute 行为分叉的隐性 bug。
// ══════════════════════════════════════════════════

import { getHeartbeatChangedScopes, oblHeartbeat, type CommandResult } from '@/api/client';
import { sendOblCommand, type OblCommandEnvelope } from '@/api/obl-command';
import { dataManager } from '@/stores/data-manager';
import { usePlayerStore } from '@/stores/player';
import { useBattleStore } from '@/stores/battle';
import { useInventoryStore } from '@/stores/inventory';
import { useMapStore } from '@/stores/map';
import { COMMAND_REGISTRY } from '@/stores/command-registry';

class CommandQueue {
  private _locked = false;
  private _cooldown = 0;

  /**
   * 统一的前置检查逻辑（execute 与 canExecute 共用）
   * 返回 null 表示通过所有锁；否则返回锁定原因。
   *
   * 五层锁顺序：HTTP/冷却 → 演出 → itm0 → 模式 → PROCESSING
   */
  private _lockReason(command: string): string | null {
    // ── 第 1 层：HTTP 请求锁 + 冷却 ──
    if (this._locked) return 'HTTP_LOCKED';
    if (this._cooldown > Date.now()) return 'COOLDOWN';

    const battleStore = useBattleStore();
    const playerStore = usePlayerStore();
    const inventoryStore = useInventoryStore();

    // ── 第 2 层：战斗演出锁 ──
    if (battleStore.isPlayingBattleLog) return 'BATTLE_LOG_PLAYING';

    const spec = COMMAND_REGISTRY[command];
    if (!spec) return 'UNKNOWN_COMMAND';

    // ── 第 3 层：itm0 锁 ──
    if (inventoryStore.itm0 !== null && !spec.itm0Allowed) return 'ITM0_PENDING';

    // ── 第 4 层：模式锁（以前端 currentMode 为真值源） ──
    const inBattle = battleStore.currentMode === 'battle';
    if (inBattle && spec.mode !== 'battle') return 'MODE_BATTLE';
    if (!inBattle && spec.mode === 'battle') return 'MODE_EXPLORE';

    // ── 第 5 层：PROCESSING 锁（仅拦截推进 tick 命令） ──
    if (spec.advancesTick && playerStore.oblBattleState === 'PROCESSING') return 'BATTLE_PROCESSING';

    return null;
  }

  private _checkLocks(command: string): boolean {
    return this._lockReason(command) === null;
  }

  /**
   * UI :disabled 派生用——查询指定命令当前是否可执行
   *
   * 与 execute() 内部 _checkLocks 共用同一逻辑，保证 UI 反馈与实际执行一致。
   * UI 检查不取代 execute() 内部拦截——execute() 仍会再次调用 _checkLocks 兜底，
   * 防止 UI 层绕过（如键盘快捷键、开发者工具直接调用 execute()）。
   */
  canExecute(command: string): boolean {
    return this._checkLocks(command);
  }

  /**
   * 执行命令（带锁 + 冷却 + 状态机锁检查）
   *
   * @param envelope 提交给 Oblivions JSON Command API 的命令信封
   * @returns CommandResult（由 sendOblCommand 适配旧调用语义）
   *   - 锁定/冷却/演出/itm0/模式/PROCESSING 任一不通过返回 { success: false, error: 'LOCKED', message: '当前状态不可执行此操作' }
   */
  async execute<TPayload = unknown>(envelope: OblCommandEnvelope<TPayload>): Promise<CommandResult> {
    const command = envelope.command || '';

    // ── 前置检查：复用 _checkLocks（与 canExecute 共用，保证一致） ──
    const lockReason = this._lockReason(command);
    if (lockReason !== null) {
      return { success: false, error: 'LOCKED', message: `当前状态不可执行此操作：${lockReason}` };
    }

    const spec = COMMAND_REGISTRY[command];
    this._locked = true;
    try {
      const result = await sendOblCommand(envelope);
      // 后端返回 timer 时设置冷却（单位：秒）
      if (result.timer) {
        this._cooldown = Date.now() + result.timer * 1000;
      }
      // 成功推进 tick 后拉取最新状态并广播事件（由 battle.ts 决定轮询行为）
      if (result.success && spec?.advancesTick) {
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
   * 阶段三后 player_info 不再隐式推进 tick；先显式等待 heartbeat，
   * 再拉取 player_info，最后广播 game:tick-advanced 事件，
   * 由 battle.ts 响应并决定是否启动/停止轮询。
   */
  private async _checkBattleState(): Promise<void> {
    try {
      const heartbeat = await oblHeartbeat();
      const changedScopes = getHeartbeatChangedScopes(heartbeat);
      for (const scope of changedScopes) {
        dataManager.invalidate(scope);
      }
      if (changedScopes.includes('game_map') || changedScopes.includes('enemies')) {
        try {
          await useMapStore().loadMap();
        } catch (e) {
          console.error('[CommandQueue] map refresh after heartbeat error:', e);
        }
      }
      await usePlayerStore().loadPlayerInfo(true);
      // 广播事件，由 battle.ts 监听并调用 refreshBattle 决定轮询行为
      dataManager.broadcast('game:tick-advanced', { heartbeat, changedScopes });
    } catch (e) {
      console.error('[CommandQueue] checkBattleState error:', e);
    }
  }

  /**
   * 全局锁：对所有命令都生效的锁
   *
   * 仅包含 HTTP 锁 + 演出锁——这两种锁会阻止所有命令执行。
   * PROCESSING / itm0 / 模式锁是"针对特定命令的锁"，不纳入 isLocked，
   * 应通过 canExecute(command) 查询具体命令是否可执行。
   *
   * 重构后 isLocked 主要用于"全局 UI 反馈"（如全屏遮罩、状态栏指示器），
   * 按钮 :disabled 应改用 canExecute(command) 精细化控制。
   */
  get isLocked(): boolean {
    return this._locked || useBattleStore().isPlayingBattleLog;
  }

  /** 后端是否处理中（PROCESSING 状态，由状态机派生，供 UI 绑定） */
  get pendingNpc(): boolean {
    return usePlayerStore().oblBattleState === 'PROCESSING';
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
