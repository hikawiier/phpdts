// ══════════════════════════════════════════════════
// 战斗状态机 store
//
// 替代现有 vex/js/battle.js 的模块内部状态 + 函数逻辑。
//
// 状态机简化为 normal/battle 两态：
// - normal（探索）→ 玩家点击敌人 → startBattle() → battle
// - battle（战斗）→ 玩家/NPC 回合交替 → 播放 battlelog → 继续 battle 或回 normal
//
// battlelog 数据流（played 标记机制 + 导演编排，设计案2 v3）：
// - 后端所有 battlelog 持久化到文件，每条带 log_id + played=0
// - 前端拉取 played=0 的条目 → BattleDirector.direct() 编排为 PlayScript
// - playScript() 按 PlaySegment 分段执行 → BattleModal 逐段播放
// - 播完调 mark_battle_log_played.php 标记 played=1
//
// 演出事件转发（store → 组件单向触发）：
// - battle:preload-init → PreloadArea 组件初始化装填区
// - battle:play-collision → CollisionAnimation 组件播放碰撞动画
// - battle:play-damage-numbers → DamageNumber 组件播放残留伤害数字
//
// 模态框播放完成机制：
// - store 设置 currentSegment + battleLogEntries + battleModalOpen=true，返回 Promise
// - BattleModal 播放完成后调用 store.notifyModalClosed()
// - store 触发 resolve，继续后续流程
//
// 关联文档：oblivions/docs/设计案3-重构前端播放系统.md
// ══════════════════════════════════════════════════

import { defineStore } from 'pinia';
import { ref, nextTick } from 'vue';
import { dataManager } from '@/stores/data-manager';
import { markBattleLogPlayed } from '@/api/client';
import { useToastStore } from '@/stores/toast';
import type { BattleLogEntry, BattleQueue, PlayerInfo, Enemy } from '@/types/api';
import {
  direct,
  extractNpcPid,
  collectAllLogIds,
  type PlayScript,
  type PlaySegment,
  type DirectedEntry,
} from './battle-director';
import { renderDirectedEntryHtml } from '@/data/battle-templates';

/** NPC 回合自动刷新间隔（毫秒）— 与 commandQueue pendingNpc 轮询一致 */
export const NPC_TURN_REFRESH_INTERVAL = 1000;

/** 守护进程心跳间隔（毫秒）— 纯后端 tick 激活，不与前端业务耦合 */
const DAEMON_BEAT_INTERVAL = 200;

/** 碰撞动画总时长（毫秒）— 300ms 动画 + 120ms 延迟 + 30ms 缓冲 */
const COLLISION_ANIM_DURATION = 450;

/** "你的回合" Toast 显示时长（毫秒） */
const YOUR_TURN_TOAST_DURATION = 2000;

/** 模态框播放超时兜底（毫秒）— 防止组件异常卸载未通知导致 Promise 永久挂起 */
const MODAL_TIMEOUT = 30000;

/** sleep 辅助函数 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const useBattleStore = defineStore('battle', () => {
  // ── 战斗状态 ──
  const currentMode = ref<'normal' | 'battle'>('normal');
  const currentEnemyPid = ref<number>(0);
  const currentGroomid = ref<number>(0);
  const currentPid = ref<number>(0);
  const isPlayingBattleLog = ref<boolean>(false);
  const isProcessingBattle = ref<boolean>(false);

  // ── 演出状态（供组件响应式读取） ──
  /** 当前是否玩家回合（供 BattleActionBar 决定显示装填区还是等待提示） */
  const isPlayerTurn = ref<boolean>(false);
  /** 敌人名称（供 BattleHeader 显示） */
  const enemyName = ref<string>('');
  /** 敌人位置（供 BattleHeader 显示） */
  const enemyLocation = ref<string | number | null>(null);
  /** 当前正在播放的 battlelog 条目（供 BattleModal v-for 渲染，类型为 DirectedEntry[]） */
  const battleLogEntries = ref<DirectedEntry[]>([]);
  /** 战斗模态框是否打开 */
  const battleModalOpen = ref<boolean>(false);
  /** 当前正在播放的段（供 BattleModal 读取 meta + entries） */
  const currentSegment = ref<PlaySegment | null>(null);

  // ── NPC 回合自动刷新定时器（不响应式，仅内部使用） ──
  let npcTurnRefreshTimer: ReturnType<typeof setInterval> | null = null;

  // ── 守护进程定时器（不响应式，仅内部使用） ──
  let daemonTimer: ReturnType<typeof setInterval> | null = null;

  // ── 模态框播放完成回调（内部使用） ──
  let _modalResolve: (() => void) | null = null;

  // ══════════════════════════════════════════════════
  // 辅助函数
  // ══════════════════════════════════════════════════

  /**
   * 从先攻队列中提取敌人 PID（第一个 type>0 的参战者）
   *
   * 用于 refreshBattle 进入战斗模式时确定敌人。
   * battlelog 播放时的 NPC PID 提取用 BattleDirector.extractNpcPid。
   */
  function extractEnemyPid(battleQueue: BattleQueue | null): number {
    if (!battleQueue || !Array.isArray(battleQueue.queue)) return 0;
    for (const item of battleQueue.queue) {
      if (parseInt(String(item.type)) > 0) {
        return parseInt(String(item.pid));
      }
    }
    return 0;
  }

  // ══════════════════════════════════════════════════
  // NPC 回合自动刷新循环
  // ══════════════════════════════════════════════════

  /**
   * 启动 NPC 回合自动刷新循环
   *
   * NPC 顺位时，后端会在下次 common.inc 加载时执行 NPC 先攻轮。
   * 前端通过定时拉取 player_info 触发 common.inc，从而推进 NPC 行动。
   */
  function startNpcTurnRefresh(): void {
    if (npcTurnRefreshTimer !== null) return;
    npcTurnRefreshTimer = setInterval(() => {
      dataManager.invalidate('player_info');
      dataManager.invalidate('battle_log');
      refreshBattle();
    }, NPC_TURN_REFRESH_INTERVAL);
  }

  /** 停止 NPC 回合自动刷新循环 */
  function stopNpcTurnRefresh(): void {
    if (npcTurnRefreshTimer !== null) {
      clearInterval(npcTurnRefreshTimer);
      npcTurnRefreshTimer = null;
    }
  }

  /** 是否有 NPC 自动刷新定时器在运行 */
  function hasNpcTurnRefreshTimer(): boolean {
    return npcTurnRefreshTimer !== null;
  }

  // ══════════════════════════════════════════════════
  // 守护进程（纯后端 tick 激活器）
  // ══════════════════════════════════════════════════

  /** 心跳拍：fire-and-forget，成功/失败都不影响前端业务 */
  async function _daemonBeat(): Promise<void> {
    const apiBase = import.meta.env.VITE_API_BASE || '/phpdts';
    try {
      await fetch(`${apiBase}/api_v2.php?action=heartbeat`, { credentials: 'include' });
    } catch {
      // 静默失败，下次心跳重试
    }
  }

  /** 启动守护进程（页面挂载时调用） */
  function startDaemonPoll(): void {
    if (daemonTimer !== null) return;
    daemonTimer = setInterval(_daemonBeat, DAEMON_BEAT_INTERVAL);
  }

  /** 停止守护进程（页面卸载时调用） */
  function stopDaemonPoll(): void {
    if (daemonTimer !== null) {
      clearInterval(daemonTimer);
      daemonTimer = null;
    }
  }

  // ══════════════════════════════════════════════════
  // 模式切换
  // ══════════════════════════════════════════════════

  /**
   * 进入 battle 模式
   *
   * 只负责状态切换和首次进入的初始化。
   * battlelog 的拉取播放由 refreshBattle() 独立调用。
   */
  function enterBattleMode(enemyPid: number, playerTurn: boolean): void {
    if (currentMode.value === 'battle' && currentEnemyPid.value === enemyPid) {
      updateActionPanel(playerTurn);
      return;
    }

    currentMode.value = 'battle';
    currentEnemyPid.value = enemyPid;

    // 敌人名称暂空，等 playTurnSegment/playPhase0Segment 从 battlelog 提取后更新
    enemyName.value = '';
    enemyLocation.value = null;

    updateActionPanel(playerTurn);
  }

  /**
   * 退出战斗模式
   *
   * DOM 切换由 currentMode ref 响应式驱动，battle-active class 由 App.vue 处理。
   */
  function exitBattleMode(): void {
    if (currentMode.value === 'normal') return;

    currentMode.value = 'normal';
    currentEnemyPid.value = 0;
    enemyName.value = '';
    enemyLocation.value = null;
    isPlayerTurn.value = false;
    battleLogEntries.value = [];
    battleModalOpen.value = false;
    currentSegment.value = null;

    dataManager.invalidate('enemies');
    dataManager.broadcast('battle:ended');
  }

  /**
   * 更新动作面板：玩家顺位时显示装填区，否则显示等待提示
   */
  function updateActionPanel(playerTurn: boolean): void {
    isPlayerTurn.value = playerTurn;
    if (playerTurn) {
      nextTick(() => {
        dataManager.broadcast('battle:preload-init', {
          mode: 'in-battle',
          enemyPid: currentEnemyPid.value,
          playerPid: currentPid.value,
        });
      });
    }
  }

  // ══════════════════════════════════════════════════
  // 玩家主动攻击流程
  // ══════════════════════════════════════════════════

  /**
   * 玩家主动攻击：切换到预装填界面
   *
   * @param enemyPid 敌人 PID（0 表示瞄准模式，需先选目标）
   */
  function startBattle(enemyPid: number): void {
    if (currentMode.value !== 'normal') return;

    currentMode.value = 'battle';
    currentEnemyPid.value = enemyPid;
    isPlayerTurn.value = true;

    enemyName.value = enemyPid > 0 ? '' : '瞄准模式';
    enemyLocation.value = null;

    nextTick(() => {
      dataManager.broadcast('battle:preload-init', {
        mode: 'pre-battle',
        enemyPid,
        playerPid: currentPid.value,
      });
    });

    dataManager.broadcast('battle:started', { enemyPid });
  }

  // ══════════════════════════════════════════════════
  // 主刷新函数
  // ══════════════════════════════════════════════════

  /**
   * 刷新战斗状态：检测 action 变化，进入/退出战斗模式
   *
   * 职责分工：
   * - 本函数负责状态管理（进入/退出战斗模式、启停 NPC 刷新、玩家回合 toast）
   * - fetchAndPlayBattleLog 只负责拉取-播放-标记，不涉及状态判断
   *
   * 状态机驱动（3 态）：
   *  - 用 obl_battle_state 作为单一数据源决定轮询行为
   *  - PROCESSING → 继续轮询（后端正在处理）
   *  - PLAYER_TURN → 停止轮询，启用玩家操作
   *  - IDLE → 停止轮询
   */
  async function refreshBattle(): Promise<void> {
    if (isProcessingBattle.value) return;
    isProcessingBattle.value = true;

    try {
      const result = await dataManager.fetch('player_info', true);
      if (result.status !== 'success' || !result.data) return;

      const playerInfo = result.data as PlayerInfo;
      const action = playerInfo.action || '';
      const battleQueue = playerInfo.battle_queue || null;
      const battleState = playerInfo.obl_battle_state;

      currentGroomid.value = parseInt(String(playerInfo.groomid)) || 0;
      currentPid.value = parseInt(String(playerInfo.pid)) || 0;

      if (action === 'battle') {
        const enemyPid = extractEnemyPid(battleQueue);
        const playerTurn = battleState === 'PLAYER_TURN';
        enterBattleMode(enemyPid, playerTurn);

        if (battleState === 'PROCESSING') {
          startNpcTurnRefresh();
        } else {
          stopNpcTurnRefresh();
        }
      } else {
        stopNpcTurnRefresh();
      }

      // 独立播放积压的 battlelog
      await fetchAndPlayBattleLog();

      // 播放完成后，根据 action 决定后续状态
      if (action === 'battle') {
        const afterResult = await dataManager.fetch('player_info', true);
        if (afterResult.status === 'success' && afterResult.data) {
          const afterInfo = afterResult.data as PlayerInfo;
          const afterAction = afterInfo.action || '';
          if (afterAction === 'battle') {
            if (afterInfo.obl_battle_state === 'PLAYER_TURN') {
              const toastStore = useToastStore();
              toastStore.showToast('你的回合', 'info', YOUR_TURN_TOAST_DURATION);
            }
          } else {
            exitBattleMode();
          }
        }
      } else {
        exitBattleMode();
      }
    } catch (e) {
      console.error('[Battle] refreshBattle error:', e);
      useToastStore().showToast('战斗数据异常，请刷新', 'error', 4000, false, 'battle-error');
    } finally {
      isProcessingBattle.value = false;
    }
  }

  // ══════════════════════════════════════════════════
  // battlelog 拉取 + 导演编排 + 播放 + 标记
  // ══════════════════════════════════════════════════

  /**
   * 拉取未播放的 battlelog，导演编排后播放，播完标记
   *
   * 纯粹的"拉取-播放-标记"播放器，不涉及状态管理逻辑：
   * - 不判断 action（由 refreshBattle 负责）
   * - 不调用 exitBattleMode（由 refreshBattle 负责）
   * - 不显示 toast（由 refreshBattle 负责）
   */
  async function fetchAndPlayBattleLog(): Promise<void> {
    if (isPlayingBattleLog.value) return;
    if (!currentGroomid.value || !currentPid.value) return;

    try {
      dataManager.invalidate('battle_log');
      const result = await dataManager.fetch('battle_log', true);
      if (result.status !== 'success' || !result.data) return;

      const entries = (result.data as { entries?: BattleLogEntry[] }).entries || [];
      if (entries.length === 0) return;

      isPlayingBattleLog.value = true;

      // 1. 导演编排（同步纯函数）
      const script = direct(entries);
      if (script.segments.length === 0) {
        await markBattleLogPlayed(currentGroomid.value, currentPid.value, collectAllLogIds(entries));
        return;
      }

      // 2. 提取 NPC PID（替代旧 groupByEncounter）
      const npcPid = extractNpcPid(script);

      // 3. 演员执行
      await playScript(script, npcPid);

      // 4. 标记已播放（基于原始 entries 的 log_id，不依赖导演输出）
      const markResult = await markBattleLogPlayed(
        currentGroomid.value,
        currentPid.value,
        collectAllLogIds(entries),
      );
      if (!markResult.success) {
        console.warn('[Battle] markBattleLogPlayed returned failure:', markResult);
      }
    } catch (e) {
      console.error('[Battle] fetchAndPlayBattleLog error:', e);
      useToastStore().showToast('战斗数据异常，请刷新', 'error', 4000, false, 'battle-error');
    } finally {
      isPlayingBattleLog.value = false;
    }
  }

  /**
   * 战斗播放器：按 PlayScript 分段执行
   *
   * 不做任何业务判断，只读 script 字段执行。
   * 逐段播放，每段根据 SegmentKind 决定渲染方式。
   */
  async function playScript(script: PlayScript, npcPid: number): Promise<void> {
    for (const segment of script.segments) {
      switch (segment.kind) {
        case 'phase0':
          await playPhase0Segment(segment, npcPid);
          break;
        case 'round':
          await playRoundSegment(segment, npcPid);
          break;
        case 'turn':
          await playTurnSegment(segment, npcPid);
          break;
        case 'battle_end':
          await playBattleEndSegment(segment, npcPid);
          break;
        case 'ambush_battle_end':
          await playAmbushBattleEndSegment(segment, npcPid);
          break;
      }
    }
  }

  /** Phase 0 段：突袭攻击，无 Turn/Round 结构 */
  async function playPhase0Segment(segment: PlaySegment, npcPid: number): Promise<void> {
    updateEnemyNameFromSegment(segment);
    await refreshEnemyLocation(npcPid);
    await playSegmentInModal(segment, { npcPid, alwaysShowHeader: true });
  }

  /** Round 段：先攻掷骰，即使 entries 渲染为空也显示段分隔符 */
  async function playRoundSegment(segment: PlaySegment, npcPid: number): Promise<void> {
    await playSegmentInModal(segment, { npcPid, alwaysShowHeader: true });
  }

  /** Turn 段：单回合动作，切换 HP 条目标 */
  async function playTurnSegment(segment: PlaySegment, npcPid: number): Promise<void> {
    updateEnemyNameFromSegment(segment);
    await refreshEnemyLocation(npcPid);

    // 碰撞动画（读 animation 字段，不判断 action_id）
    for (const e of segment.entries) {
      if (e.animation === 'collision') {
        dataManager.broadcast('battle:play-collision', { entry: e, npcPid });
        await sleep(COLLISION_ANIM_DURATION);
      }
    }

    // 模态框播放
    await playSegmentInModal(segment, { npcPid });

    // 伤害数字
    dataManager.broadcast('battle:play-damage-numbers', {
      entries: segment.entries,
      npcPid,
    });
  }

  /** Battle End 段：标准战斗终结 */
  async function playBattleEndSegment(segment: PlaySegment, npcPid: number): Promise<void> {
    await playSegmentInModal(segment, { npcPid, isBattleEnd: true });
  }

  /** Ambush Battle End 段：突袭阶段结束 */
  async function playAmbushBattleEndSegment(segment: PlaySegment, npcPid: number): Promise<void> {
    await playSegmentInModal(segment, { npcPid, isBattleEnd: true });
  }

  interface SegmentPlayOptions {
    npcPid: number;
    /** 即使 entries 渲染为空也打开模态框（显示段分隔符） */
    alwaysShowHeader?: boolean;
    /** 战斗结束段（即使无渲染条目也打开） */
    isBattleEnd?: boolean;
  }

  /**
   * 在模态框中播放一个 segment
   *
   * 设置 currentSegment（供 BattleModal 读取 meta），打开模态框，等待关闭。
   * 模态框根据 currentSegment.kind 和 entries 逐条渲染。
   */
  async function playSegmentInModal(
    segment: PlaySegment,
    options: SegmentPlayOptions,
  ): Promise<void> {
    const rendered = segment.entries
      .map(e => ({ entry: e, html: renderDirectedEntryHtml(e, currentPid.value) }))
      .filter(r => r.html);

    // 无渲染条目时的处理：
    // - isBattleEnd：仍打开模态框（显示战斗结束文字）
    // - alwaysShowHeader：仍打开模态框（显示段分隔符）
    // - 其他：跳过
    if (rendered.length === 0 && !options.isBattleEnd && !options.alwaysShowHeader) return;

    currentSegment.value = segment;
    battleLogEntries.value = rendered.map(r => r.entry);
    battleModalOpen.value = true;

    await waitForModalClose();
  }

  /** 等待模态框关闭 */
  async function waitForModalClose(): Promise<void> {
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        _modalResolve = null;
        resolve();
      }, MODAL_TIMEOUT);
      _modalResolve = () => {
        clearTimeout(timeout);
        resolve();
      };
    });
  }

  /**
   * 模态框播放完成通知（供 BattleModal 组件调用）
   *
   * BattleModal 播放完后调用本函数，触发 waitForModalClose 中的 Promise resolve。
   */
  function notifyModalClosed(): void {
    battleModalOpen.value = false;
    battleLogEntries.value = [];
    currentSegment.value = null;
    if (_modalResolve) {
      _modalResolve();
      _modalResolve = null;
    }
  }

  /** 从 segment entries 读取敌人名称（优先用 action entry 的 target_name） */
  function updateEnemyNameFromSegment(segment: PlaySegment): void {
    const firstAction = segment.entries.find(e => e.directedKind === 'action');
    if (firstAction?.target_name) {
      enemyName.value = firstAction.target_name;
    } else if (firstAction?.actor_name && Number(firstAction.actor_type) > 0) {
      enemyName.value = firstAction.actor_name;
    }
  }

  /** 从 enemies API 获取敌人位置（替代旧 refreshContextFromApi 的位置部分） */
  async function refreshEnemyLocation(npcPid: number): Promise<void> {
    if (npcPid <= 0) return;
    try {
      const enemiesResult = await dataManager.fetch('enemies', true);
      if (enemiesResult.status === 'success' && enemiesResult.data) {
        const enemies = (enemiesResult.data as { enemies?: Enemy[] }).enemies || [];
        for (const enemy of enemies) {
          if (parseInt(String(enemy.pid)) === npcPid) {
            enemyLocation.value = enemy.pls ?? null;
            return;
          }
        }
      }
    } catch (e) {
      console.error('[Battle] refreshEnemyLocation error:', e);
    }
  }

  // ══════════════════════════════════════════════════
  // 装填区执行完成后的刷新处理
  // ══════════════════════════════════════════════════

  /**
   * 装填区执行完成后的刷新处理
   *
   * battle-preload.js 提交命令后广播 preload:executed 事件，
   * 本函数监听该事件并刷新战斗状态。
   */
  async function onPreloadExecuted(): Promise<void> {
    dataManager.invalidate('player_info');
    dataManager.invalidate('enemies');
    dataManager.invalidate('battle_log');

    await refreshBattle();
  }

  // ══════════════════════════════════════════════════
  // 初始化
  // ══════════════════════════════════════════════════

  let _listenersRegistered = false;

  /**
   * 注册事件监听
   *
   * 在 App.vue 的 onMounted 中调用。
   */
  function registerListeners(): void {
    if (_listenersRegistered) return;
    _listenersRegistered = true;

    dataManager.listen('game:action-completed', () => {
      refreshBattle();
    });
    dataManager.listen('preload:executed', () => {
      onPreloadExecuted();
    });
    dataManager.listen('game:tick-advanced', () => {
      refreshBattle();
    });
  }

  /** 重置为初始状态（退出战斗/切换角色时） */
  function reset(): void {
    currentMode.value = 'normal';
    currentEnemyPid.value = 0;
    currentGroomid.value = 0;
    currentPid.value = 0;
    isPlayingBattleLog.value = false;
    isProcessingBattle.value = false;
    isPlayerTurn.value = false;
    enemyName.value = '';
    enemyLocation.value = null;
    battleLogEntries.value = [];
    battleModalOpen.value = false;
    currentSegment.value = null;
    stopNpcTurnRefresh();
    if (_modalResolve) {
      _modalResolve();
      _modalResolve = null;
    }
  }

  return {
    // 状态
    currentMode,
    currentEnemyPid,
    currentGroomid,
    currentPid,
    isPlayingBattleLog,
    isProcessingBattle,
    isPlayerTurn,
    enemyName,
    enemyLocation,
    battleLogEntries,
    battleModalOpen,
    currentSegment,
    // 定时器管理
    startNpcTurnRefresh,
    stopNpcTurnRefresh,
    hasNpcTurnRefreshTimer,
    // 守护进程
    startDaemonPoll,
    stopDaemonPoll,
    // 模式切换
    enterBattleMode,
    exitBattleMode,
    updateActionPanel,
    // 玩家主动攻击
    startBattle,
    // 主刷新
    refreshBattle,
    // battlelog 播放
    fetchAndPlayBattleLog,
    notifyModalClosed,
    // 装填区执行完成
    onPreloadExecuted,
    // 初始化
    registerListeners,
    // 重置
    reset,
  };
});
