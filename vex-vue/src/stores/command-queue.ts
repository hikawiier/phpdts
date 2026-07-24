/**
 * @module K 状态管理层
 * @framework K-3 多层命令门控
 */

// ══════════════════════════════════════════════════
// 命令队列 + 防抖 + 战斗状态机锁
//
// 替代现有 vex/js/command-queue.js 的 CommandQueue 单例。
// 防止快速连续点击导致重复提交，支持冷却时间。
//
// 状态机（3 态，由 playerStore.oblBattleState 派生）：
//   - IDLE / AWAITING_INPUT / AUTO_PENDING / EXECUTING
//   - 轮询由 battle.ts 统一管理（系统回合 300ms / 其他 1000ms）
//   - pendingNpc getter 仅用于 UI 状态展示（StatusBar NPC 指示器）
//
// 锁结构（5 层，详见 docs/战斗锁定白名单-设计案.md §2.7.2）：
//   1. HTTP 请求锁 + 冷却（_locked / _cooldown）
//   2. itm0 锁（inventoryStore.itm0 !== null，按命令 itm0Allowed 拦截）
//   3. 模式锁（battleStore.currentMode，按命令 mode 拦截）
//   4. battle 命令演出水位锁（PresentationScene 必须 caught up）
//   5. 系统回合锁（仅拦截 advancesTick 命令）
//
// canExecute(command) 与 execute() 共用 _checkLocks()，保证 UI 查询与
// 实际执行判断完全一致——避免重蹈 isLocked 与 execute 行为分叉的隐性 bug。
// ══════════════════════════════════════════════════

import { getHeartbeatChangedScopes, isHeartbeatSoftFailed, oblHeartbeat, type CommandResult } from '@/api/client';
import { sendOblCommand, type OblCommandEnvelope } from '@/api/obl-command';
import { dataManager } from '@/stores/data-manager';
import { usePlayerStore } from '@/stores/player';
import { useBattleStore } from '@/stores/battle';
import { useInventoryStore } from '@/stores/inventory';
import { COMMAND_REGISTRY } from '@/stores/command-registry';
import { ingestPresentationResponse } from '@/stores/presentation-inbox';
import { usePresentationSceneStore } from '@/stores/presentation-scene';
import type { ActorCapability, CapabilityDecision } from '@/types/api';
import { getCapabilityLabel, getStatusLocale } from '@/data/status-locale';
import { ref, type Ref } from 'vue';

export interface CommandBlockDecision {
  code: string;
  message: string;
  capability?: ActorCapability;
  reason?: string;
  sourceStatusIds?: string[];
  expiresAtTick?: number | null;
}

function capabilityBlockDecision(
  capability: ActorCapability,
  decision: CapabilityDecision,
): CommandBlockDecision | null {
  if (decision.allowed) return null;
  const sourceStatusIds = [...new Set(decision.source_status_ids ?? [])];
  const statusNames = sourceStatusIds.map(id => getStatusLocale(id).name);
  const sourceText = statusNames.length > 0 ? statusNames.join('、') : '当前状态';
  return {
    code: 'CAPABILITY_BLOCKED',
    message: `${sourceText}使你无法${getCapabilityLabel(capability)}。`,
    capability,
    reason: decision.reason ?? 'status_blocked',
    sourceStatusIds,
    expiresAtTick: decision.expires_at_tick ?? null,
  };
}

export interface CommandQueueOptions {
  transport?: typeof sendOblCommand;
  now?: () => number;
  schedule?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  cancelSchedule?: (timer: ReturnType<typeof setTimeout>) => void;
}

export class CommandQueue {
  private readonly _locked: Ref<boolean> = ref(false);
  private readonly _cooldownUntil: Ref<number> = ref(0);
  private readonly _transport: typeof sendOblCommand;
  private readonly _now: () => number;
  private readonly _schedule: NonNullable<CommandQueueOptions['schedule']>;
  private readonly _cancelSchedule: NonNullable<CommandQueueOptions['cancelSchedule']>;
  private _cooldownTimer: ReturnType<typeof setTimeout> | null = null;
  // 移动导演播放期门控（F-K4-Director §三.7/§三.8：复用 K-3，不建第二套锁）
  // 由 move-director 在播放开始/结束时切换；阻塞新的移动/探索/目标命令
  private _navigationPlaying = false;

  constructor(options: CommandQueueOptions = {}) {
    this._transport = options.transport ?? sendOblCommand;
    this._now = options.now ?? Date.now;
    this._schedule = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this._cancelSchedule = options.cancelSchedule ?? (timer => clearTimeout(timer));
  }

  /**
   * 统一的前置检查逻辑（execute 与 canExecute 共用）
   * 返回 null 表示通过所有锁；否则返回锁定原因。
   *
   * 锁顺序：HTTP/冷却 → itm0 → 模式/演出水位 → capability → 系统回合
   */
  private _blockDecision(command: string): CommandBlockDecision | null {
    // ── 第 1 层：HTTP 请求锁 + 冷却 ──
    if (this._locked.value) return { code: 'HTTP_LOCKED', message: '上一个请求仍在处理中。' };
    if (this._cooldownUntil.value > this._now()) return { code: 'COOLDOWN', message: '操作过于频繁，请稍候。' };

    const battleStore = useBattleStore();
    const playerStore = usePlayerStore();
    const inventoryStore = useInventoryStore();

    const spec = COMMAND_REGISTRY[command];
    if (!spec) return { code: 'UNKNOWN_COMMAND', message: '未知命令。' };

    // ── 第 3 层：itm0 锁 ──
    if (inventoryStore.itm0 !== null && !spec.itm0Allowed) {
      return { code: 'ITM0_PENDING', message: '你正手持道具，请先处理。' };
    }

    // ── 第 4 层：模式锁（以前端 currentMode 为真值源） ──
    const inBattle = battleStore.currentMode === 'battle';
    if (inBattle && spec.mode !== 'battle') return { code: 'MODE_BATTLE', message: '战斗准备中无法执行此操作。' };
    if (!inBattle && spec.mode === 'battle') return { code: 'MODE_EXPLORE', message: '当前不在战斗操作界面。' };
    if (spec.mode === 'battle' && usePresentationSceneStore().phase !== 'idle') {
      return { code: 'PRESENTATION_NOT_CAUGHT_UP', message: '战斗演出尚未结束。' };
    }

    // ── 第 4.5 层：移动导演播放期门控（F-K4-Director §三.7/§三.8） ──
    // 阻塞探索模式中推进 tick 的命令（map.move / map.explore / poi.* / world.wait）
    // 排除 map.navigate：移动导演自身的初始化命令不走此门控
    // （startNavigation 已有 isPlaying 兜底防重复；UI 层 inputLocked 禁用移动按钮）
    // 加速/跳过/查看面板不通过命令队列，始终可用（B6.10/B6.11）
    if (this._navigationPlaying && spec.mode === 'explore' && spec.advancesTick && command !== 'map.navigate') {
      return {
        code: 'NAVIGATION_PLAYING',
        message: '移动导演播放中，请等待演出结束或加速/跳过。',
      };
    }

    for (const capability of spec.requiredCapabilities) {
      const block = capabilityBlockDecision(capability, playerStore.getCapabilityDecision(capability));
      if (block) return block;
    }

    // ── 第 5 层：系统回合锁（仅拦截推进 tick 命令） ──
    if (spec.advancesTick && (
      playerStore.oblBattleState === 'AUTO_PENDING'
      || playerStore.oblBattleState === 'EXECUTING'
    )) {
      return { code: 'BATTLE_PROCESSING', message: '战斗处理中，请稍候。' };
    }

    return null;
  }

  private _checkLocks(command: string): boolean {
    return this._blockDecision(command) === null;
  }

  getCapabilityBlock(capability: ActorCapability): CommandBlockDecision | null {
    return capabilityBlockDecision(capability, usePlayerStore().getCapabilityDecision(capability));
  }

  getBlockDecision(command: string): CommandBlockDecision | null {
    return this._blockDecision(command);
  }

  /**
   * 移动导演播放期门控开关（F-K4-Director §三.7/§三.8，由 explore.setNavigationLock 联动调用）。
   *
   * 开启时阻塞探索模式中推进 tick 的命令（map.move / map.explore / map.navigate /
   * poi.* / world.wait）；加速/跳过/查看面板不通过命令队列，始终可用（B6.10/B6.11）。
   */
  setNavigationPlaying(v: boolean): void {
    this._navigationPlaying = v;
  }

  /** 移动导演是否正在播放（用于 UI 派生 / 测试断言） */
  get navigationPlaying(): boolean {
    return this._navigationPlaying;
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
   *   - 锁定/冷却/演出/itm0/模式/系统回合任一不通过时返回失败
   */
  async execute<TPayload = unknown>(envelope: OblCommandEnvelope<TPayload>): Promise<CommandResult> {
    const command = envelope.command || '';

    // ── 前置检查：复用 _checkLocks（与 canExecute 共用，保证一致） ──
    const block = this._blockDecision(command);
    if (block !== null) {
      return {
        success: false,
        error: block.code === 'CAPABILITY_BLOCKED' ? block.code : 'LOCKED',
        lockReason: block.code,
        message: block.message,
        details: block.capability ? {
          capability: block.capability,
          reason: block.reason,
          source_status_ids: block.sourceStatusIds,
          expires_at_tick: block.expiresAtTick,
        } : null,
      };
    }

    const spec = COMMAND_REGISTRY[command];
    this._locked.value = true;
    try {
      const result = await this._transport(envelope);
      ingestPresentationResponse(result);
      const commandChangedScopes = getHeartbeatChangedScopes(result);
      for (const scope of commandChangedScopes) dataManager.invalidate(scope);
      dataManager.broadcast('game:command-committed', { changedScopes: commandChangedScopes });
      if (!result.success && result.error === 'CAPABILITY_BLOCKED') {
        dataManager.invalidate('player_info');
        await usePlayerStore().loadPlayerInfo(true);
      }
      // 后端返回 timer 时设置冷却（单位：秒）
      if (result.timer) {
        this._setCooldown(result.timer * 1000);
      }
      // 成功推进 tick 后拉取最新状态并广播事件（由 battle.ts 决定轮询行为）
      if (result.success && spec?.advancesTick) {
        await this._checkBattleState();
      }
      return result;
    } finally {
      this._locked.value = false;
    }
  }

  private _setCooldown(durationMs: number): void {
    if (this._cooldownTimer !== null) this._cancelSchedule(this._cooldownTimer);
    this._cooldownUntil.value = this._now() + Math.max(0, durationMs);
    const release = (): void => {
      const remaining = this._cooldownUntil.value - this._now();
      if (remaining > 0) {
        this._cooldownTimer = this._schedule(release, remaining);
        return;
      }
      this._cooldownTimer = null;
      this._cooldownUntil.value = 0;
    };
    this._cooldownTimer = this._schedule(release, Math.max(0, durationMs));
  }

  /**
   * 推进 tick 后检查战斗状态
   *
   * 显式等待 heartbeat 推进 tick + 失效受影响缓存，然后广播 game:tick-advanced
   * 事件（携带 heartbeat 结果），由 battleStore.refreshBattle 复用该结果拉取
   * player_info 并决定轮询行为——避免 commandQueue 与 refreshBattle 各自重复
   * 调用 oblHeartbeat + loadPlayerInfo。
   *
   * heartbeat 软失败（锁持续占用）时仅广播事件，不刷新地图/状态——下一轮
   * daemon 心跳或 NPC 轮询会重试。
   */
  private async _checkBattleState(): Promise<void> {
    try {
      const heartbeat = await oblHeartbeat();
      ingestPresentationResponse(heartbeat);
      const changedScopes = getHeartbeatChangedScopes(heartbeat);

      if (!isHeartbeatSoftFailed(heartbeat)) {
        for (const scope of changedScopes) {
          dataManager.invalidate(scope);
        }
      }

      // 广播事件，battleStore.refreshBattle 会复用 heartbeat 结果跳过重复心跳
      dataManager.broadcast('game:tick-advanced', { heartbeat, changedScopes });
    } catch (e) {
      console.error('[CommandQueue] checkBattleState error:', e);
    }
  }

  /**
   * 全局锁：对所有命令都生效的锁
   *
   * 仅包含 HTTP 请求锁。演出水位、系统回合、itm0、模式锁都只针对特定命令，
   * 不纳入 isLocked，
   * 应通过 canExecute(command) 查询具体命令是否可执行。
   *
   * 重构后 isLocked 主要用于"全局 UI 反馈"（如全屏遮罩、状态栏指示器），
   * 按钮 :disabled 应改用 canExecute(command) 精细化控制。
   */
  get isLocked(): boolean {
    return this._locked.value;
  }

  /** 后端系统回合是否待认领或执行中 */
  get pendingNpc(): boolean {
    const state = usePlayerStore().oblBattleState;
    return state === 'AUTO_PENDING' || state === 'EXECUTING';
  }

  /** 剩余冷却时间（毫秒） */
  get remainingCooldown(): number {
    const remaining = this._cooldownUntil.value - this._now();
    return remaining > 0 ? remaining : 0;
  }

  /** 销毁（轮询由 battle.ts 统一管理，无需清理定时器） */
  destroy(): void {
    if (this._cooldownTimer !== null) this._cancelSchedule(this._cooldownTimer);
    this._cooldownTimer = null;
    this._cooldownUntil.value = 0;
    this._locked.value = false;
  }
}

/** 命令队列单例（与现有 commandQueue 导出一致） */
export const commandQueue = new CommandQueue();
