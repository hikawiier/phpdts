// ══════════════════════════════════════════════════
// 战斗状态机 store
//
// 替代现有 vex/js/battle.js 的模块内部状态 + 函数逻辑。
//
// 状态机简化为 normal/battle 两态：
// - normal（探索）→ 玩家点击敌人 → startBattle() → battle
// - battle（战斗）→ 玩家/NPC 回合交替 → 播放 battlelog → 继续 battle 或回 normal
//
// battlelog 数据流（played 标记机制 + v2 导演编排）：
// - 后端所有 battlelog 持久化到文件，每条带 log_id + played=0
// - 前端拉取 played=0 的 v2 event → DirectorV2.directV2() 编排为脚本
// - DirectorV2.planPlaybackV2() 把语义脚本编排为 playback steps
// - BattlePlaybackRunner 按 steps 执行动作动画、文本模态框、残留反馈
// - 播完调 mark_battle_log_played.php 标记 played=1
//
// 演出事件转发（store → 组件单向触发）：
// - battle:preload-init → PreloadArea 组件初始化装填区
// - battle:play-damage-numbers → DamageNumber 组件播放残留数字
//
// 模态框播放完成机制：
// - store 设置 currentSegment + battleModalOpen=true，返回 Promise
// - BattleModal 播放完成后调用 store.notifyModalClosed()
// - store 触发 resolve，继续后续流程
//
// 关联文档：oblivions/docs/设计案3-重构前端播放系统.md
// ══════════════════════════════════════════════════

import { defineStore } from 'pinia';
import { ref, nextTick } from 'vue';
import { dataManager } from '@/stores/data-manager';
import { getHeartbeatChangedScopes, markBattleLogPlayed, oblHeartbeat, type OblHeartbeatResponse } from '@/api/client';
import { useToastStore } from '@/stores/toast';
import { usePlayerAvatarStore } from '@/stores/player-avatar';
import { usePlayerStore } from '@/stores/player';
import { useMapStore } from '@/stores/map';
import type { BattleLogRawEntry, BattleQueue, PlayerInfo, Enemy, CombatViewModel } from '@/types/api';
import {
  directV2,
  isBattleLogV2Event,
  planPlaybackV2,
  type BattlePlayScriptV2,
  type BattleSegmentV2,
} from './battle-director-v2';
import { runBattlePlaybackPlan, type SegmentPlayOptions } from './battle-playback-runner';

/** NPC 回合自动刷新间隔（毫秒）— 与 commandQueue pendingNpc 轮询一致 */
export const NPC_TURN_REFRESH_INTERVAL = 1000;

/** 守护进程快心跳间隔（毫秒）— PROCESSING 时尽快推进 NPC / battlelog */
const DAEMON_BEAT_FAST_INTERVAL = 300;

/** 守护进程慢心跳间隔（毫秒）— 非 PROCESSING 时降低空转请求 */
const DAEMON_BEAT_IDLE_INTERVAL = 1000;

/** "你的回合" Toast 显示时长（毫秒） */
const YOUR_TURN_TOAST_DURATION = 2000;

/** 模态框播放超时兜底（毫秒）— 防止组件异常卸载未通知导致 Promise 永久挂起 */
const MODAL_TIMEOUT = 30000;

function collectAllLogIds(entries: BattleLogRawEntry[]): number[] {
  return entries.map(e => Number(e.log_id)).filter(id => id > 0);
}

function extractNpcPidFromScriptV2(script: BattlePlayScriptV2): number {
  for (const segment of script.segments) {
    if (segment.actor && segment.actor.type > 0) return segment.actor.pid;
    for (const action of segment.actions) {
      if (action.actor.type > 0) return action.actor.pid;
      for (const target of action.targets) {
        if (target.snapshot && target.snapshot.type > 0) return target.snapshot.pid;
        if (target.kind === 'pid' && target.pid && target.pid > 0) return target.pid;
      }
      for (const effect of action.effects) {
        if (effect.source && effect.source.type > 0) return effect.source.pid;
        if (effect.target.snapshot && effect.target.snapshot.type > 0) return effect.target.snapshot.pid;
        if (effect.target.kind === 'pid' && effect.target.pid && effect.target.pid > 0) return effect.target.pid;
      }
    }
    for (const notice of segment.notices) {
      if (notice.actor && notice.actor.type > 0) return notice.actor.pid;
      if (notice.combatant && notice.combatant.type > 0) return notice.combatant.pid;
    }
  }
  return 0;
}

export const useBattleStore = defineStore('battle', () => {
  // ── 战斗状态 ──
  const currentMode = ref<'normal' | 'battle'>('normal');
  const currentEnemyPid = ref<number>(0);
  const currentGroomid = ref<number>(0);
  const currentPid = ref<number>(0);
  const combatContext = ref<CombatViewModel | null>(null);
  const isPlayingBattleLog = ref<boolean>(false);
  const isProcessingBattle = ref<boolean>(false);

  // ── 演出状态（供组件响应式读取） ──
  /** 当前是否玩家回合（供 BattleActionBar 决定显示装填区还是等待提示） */
  const isPlayerTurn = ref<boolean>(false);
  /** 敌人名称（供 BattleHeader 显示） */
  const enemyName = ref<string>('');
  /** 敌人位置（供 BattleHeader 显示） */
  const enemyLocation = ref<string | number | null>(null);
  /** 战斗模态框是否打开 */
  const battleModalOpen = ref<boolean>(false);
  /** 当前正在播放的 v2 段（供 BattleModal 读取 text cues/actions/notices） */
  const currentSegment = ref<BattleSegmentV2 | null>(null);

  // ── NPC 回合自动刷新定时器（不响应式，仅内部使用） ──
  let npcTurnRefreshTimer: ReturnType<typeof setInterval> | null = null;

  // ── 守护进程定时器（不响应式，仅内部使用） ──
  let daemonTimer: ReturnType<typeof setTimeout> | null = null;
  let daemonRunning = false;

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

  function resolveEnemyPid(battleQueue: BattleQueue | null, context: CombatViewModel | null): number {
    if (context?.defaultTargetPid && context.defaultTargetPid > 0) {
      return context.defaultTargetPid;
    }
    return extractEnemyPid(battleQueue);
  }

  async function refreshMapEnemies(): Promise<Enemy[]> {
    const enemiesResult = await dataManager.fetch('enemies', true);
    const enemies = enemiesResult.status === 'success' && enemiesResult.data
      ? ((enemiesResult.data as { enemies?: Enemy[] }).enemies || [])
      : [];
    useMapStore().updateMapData({ enemies });
    return enemies;
  }

  async function applyHeartbeatChangedScopes(heartbeat: OblHeartbeatResponse): Promise<void> {
    const changedScopes = getHeartbeatChangedScopes(heartbeat);
    if (changedScopes.length === 0) return;

    for (const scope of changedScopes) {
      dataManager.invalidate(scope);
    }

    try {
      if (changedScopes.includes('game_map')) {
        await useMapStore().loadMap();
      } else if (changedScopes.includes('enemies')) {
        await refreshMapEnemies();
      }
    } catch (e) {
      console.error('[Battle] map sync after heartbeat error:', e);
    }
  }

  // ══════════════════════════════════════════════════
  // NPC 回合自动刷新循环
  // ══════════════════════════════════════════════════

  /**
   * 启动 NPC 回合自动刷新循环
   *
   * NPC 顺位时，后端由 oblivions/api/heartbeat.php 显式执行 NPC 先攻轮。
   * 前端轮询 refreshBattle() 会先 await heartbeat，再拉取 player_info/battle_log。
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

  /** 当前心跳间隔：PROCESSING 快速推进，其他状态降低空转请求 */
  function getDaemonBeatInterval(): number {
    return usePlayerStore().oblBattleState === 'PROCESSING'
      ? DAEMON_BEAT_FAST_INTERVAL
      : DAEMON_BEAT_IDLE_INTERVAL;
  }

  /** 心跳拍：fire-and-forget，成功/失败都不影响前端业务 */
  async function _daemonBeat(): Promise<void> {
    try {
      const heartbeat = await oblHeartbeat();
      await applyHeartbeatChangedScopes(heartbeat);
    } catch {
      // 静默失败，下次心跳重试
    }
  }

  /** 安排下一次心跳；使用 setTimeout 避免 heartbeat 慢请求重叠 */
  function scheduleDaemonBeat(delay = getDaemonBeatInterval()): void {
    if (!daemonRunning) return;
    if (daemonTimer !== null) clearTimeout(daemonTimer);
    daemonTimer = setTimeout(async () => {
      daemonTimer = null;
      await _daemonBeat();
      scheduleDaemonBeat();
    }, delay);
  }

  /** 启动守护进程（页面挂载时调用） */
  function startDaemonPoll(): void {
    if (daemonRunning) return;
    daemonRunning = true;
    scheduleDaemonBeat(getDaemonBeatInterval());
  }

  /** 停止守护进程（页面卸载时调用） */
  function stopDaemonPoll(): void {
    daemonRunning = false;
    if (daemonTimer !== null) {
      clearTimeout(daemonTimer);
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
  function enterBattleMode(enemyPid: number, playerTurn: boolean, context: CombatViewModel | null = combatContext.value): void {
    if (currentMode.value === 'battle' && currentEnemyPid.value === enemyPid) {
      updateActionPanel(playerTurn);
      return;
    }

    currentMode.value = 'battle';
    currentEnemyPid.value = enemyPid;

    // 敌人名称暂空，等 playback segment_context step 从 battlelog 提取后更新
    enemyName.value = '';
    enemyLocation.value = null;

    updateActionPanel(playerTurn, context);

    // 玩家小人：被动遭遇战也触发战斗开始意图
    usePlayerAvatarStore().onBattleStart();
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
    combatContext.value = null;
    enemyName.value = '';
    enemyLocation.value = null;
    isPlayerTurn.value = false;
    battleModalOpen.value = false;
    currentSegment.value = null;

    dataManager.invalidate('enemies');
    dataManager.broadcast('battle:ended');

    // 玩家小人：战斗结束意图
    usePlayerAvatarStore().onBattleEnd();
  }

  /**
   * 更新动作面板：玩家顺位时显示装填区，否则显示等待提示
   */
  function updateActionPanel(playerTurn: boolean, context: CombatViewModel | null = combatContext.value): void {
    isPlayerTurn.value = playerTurn;
    if (playerTurn) {
      nextTick(() => {
        dataManager.broadcast('battle:preload-init', {
          mode: 'in-battle',
          enemyPid: context?.defaultTargetPid || currentEnemyPid.value,
          playerPid: currentPid.value,
          combatContext: context,
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
    combatContext.value = null;
    isPlayerTurn.value = true;

    enemyName.value = enemyPid > 0 ? '' : '瞄准模式';
    enemyLocation.value = null;

    nextTick(() => {
      dataManager.broadcast('battle:preload-init', {
        mode: 'pre-battle',
        enemyPid,
        playerPid: currentPid.value,
        combatContext: null,
      });
    });

    dataManager.broadcast('battle:started', { enemyPid });

    // 玩家小人：战斗开始意图
    usePlayerAvatarStore().onBattleStart();
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
      // 阶段三后只读 API 不再隐式推进世界；战斗刷新必须显式等待 tick 结算，
      // 否则可能读到旧的 PROCESSING 状态或拿不到刚生成的 battlelog。
      const heartbeat = await oblHeartbeat();
      await applyHeartbeatChangedScopes(heartbeat);
      const result = await dataManager.fetch('player_info', true);
      if (result.status !== 'success' || !result.data) return;

      const playerInfo = result.data as PlayerInfo;
      usePlayerStore().playerInfo = playerInfo;
      const action = playerInfo.action || '';
      const battleQueue = playerInfo.battle_queue || null;
      const nextCombatContext = playerInfo.combat_context || null;
      const battleState = playerInfo.obl_battle_state;

      currentGroomid.value = parseInt(String(playerInfo.groomid)) || 0;
      currentPid.value = parseInt(String(playerInfo.pid)) || 0;
      combatContext.value = nextCombatContext;

      if (action === 'battle') {
        const enemyPid = resolveEnemyPid(battleQueue, nextCombatContext);
        const playerTurn = battleState === 'PLAYER_TURN';
        enterBattleMode(enemyPid, playerTurn, nextCombatContext);

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
        const afterHeartbeat = await oblHeartbeat();
        await applyHeartbeatChangedScopes(afterHeartbeat);
        const afterResult = await dataManager.fetch('player_info', true);
        if (afterResult.status === 'success' && afterResult.data) {
          const afterInfo = afterResult.data as PlayerInfo;
          usePlayerStore().playerInfo = afterInfo;
          combatContext.value = afterInfo.combat_context || null;
          const afterAction = afterInfo.action || '';
          if (afterAction === 'battle') {
            currentEnemyPid.value = resolveEnemyPid(afterInfo.battle_queue || null, combatContext.value);
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

      const entries = (result.data as { entries?: BattleLogRawEntry[] }).entries || [];
      if (entries.length === 0) return;

      isPlayingBattleLog.value = true;

      const v2Events = entries.filter(isBattleLogV2Event);

      // battlelog.v2 是唯一播放协议。历史 v1 条目只标记已播，避免阻塞队列。
      if (v2Events.length > 0) {
        const scriptV2 = directV2(v2Events);
        if (import.meta.env.DEV) {
          (globalThis as Record<string, unknown>).__battleScriptV2 = scriptV2;
          (globalThis as Record<string, unknown>).__battleRawEventsV2 = v2Events;
        }

        if (scriptV2.segments.length > 0) {
          const npcPid = extractNpcPidFromScriptV2(scriptV2);
          await playScriptV2(scriptV2, npcPid);
        }

        const markResult = await markBattleLogPlayed(
          currentGroomid.value,
          currentPid.value,
          collectAllLogIds(entries),
        );
        if (!markResult.success) {
          console.warn('[Battle] markBattleLogPlayed(v2 path) returned failure:', markResult);
        }
        return;
      }

      if (import.meta.env.DEV) {
        console.warn('[Battle] ignored non-v2 battlelog entries; battlelog.v2 is now required.', entries);
      }
      const markResult = await markBattleLogPlayed(
        currentGroomid.value,
        currentPid.value,
        collectAllLogIds(entries),
      );
      if (!markResult.success) {
        console.warn('[Battle] markBattleLogPlayed(non-v2 ignored) returned failure:', markResult);
      }
    } catch (e) {
      console.error('[Battle] fetchAndPlayBattleLog error:', e);
      useToastStore().showToast('战斗数据异常，请刷新', 'error', 4000, false, 'battle-error');
    } finally {
      isPlayingBattleLog.value = false;
    }
  }

  /**
   * 战斗播放器：由 Director 生成 playback plan，再交给 Runner 执行。
   *
   * battle.ts 只提供状态更新和模态框播放能力，不再内联动作动画编排。
   */
  async function playScriptV2(script: BattlePlayScriptV2, npcPid: number): Promise<void> {
    const plan = planPlaybackV2(script);
    if (import.meta.env.DEV) {
      (globalThis as Record<string, unknown>).__battlePlaybackPlanV2 = plan;
    }

    await runBattlePlaybackPlan(plan, {
      currentPid: currentPid.value,
      npcPid,
      updateSegmentContext,
      playSegmentInModal,
    });
  }

  async function updateSegmentContext(segment: BattleSegmentV2, npcPid: number): Promise<void> {
    updateEnemyNameFromSegment(segment);
    await refreshEnemyLocation(npcPid);
  }

  /**
   * 在模态框中播放一个 segment
   *
   * 设置 currentSegment，打开模态框，等待关闭。
   * 模态框根据 BattleSegmentV2 的 notices/actions/effects 逐条渲染。
   */
  async function playSegmentInModal(
    segment: BattleSegmentV2,
    options: SegmentPlayOptions,
  ): Promise<void> {
    // 无正文时的处理：
    // - isBattleEnd：仍打开模态框（显示战斗结束文字）
    // - alwaysShowHeader：仍打开模态框（显示段分隔符）
    // - 其他：跳过
    if (!segmentHasRenderableText(segment) && !options.isBattleEnd && !options.alwaysShowHeader) return;

    currentSegment.value = segment;
    battleModalOpen.value = true;

    await waitForModalClose();
  }

  function segmentHasRenderableText(segment: BattleSegmentV2): boolean {
    if (segment.notices.some(notice => Boolean(notice.text.html))) return true;
    return segment.actions.some(action =>
      action.text.some(text => Boolean(text.html)) ||
      action.effects.some(effect => Boolean(effect.text?.html)),
    );
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
    currentSegment.value = null;
    if (_modalResolve) {
      _modalResolve();
      _modalResolve = null;
    }
  }

  /** 从 v2 segment 读取敌人名称 */
  function updateEnemyNameFromSegment(segment: BattleSegmentV2): void {
    const targetEnemy = segment.actions
      .flatMap(action => action.targets)
      .find(target => target.snapshot && target.snapshot.type > 0);
    if (targetEnemy?.snapshot?.name) {
      enemyName.value = targetEnemy.snapshot.name;
      return;
    }

    const actorEnemy = segment.actions.find(action => action.actor.type > 0)?.actor;
    if (actorEnemy?.name) {
      enemyName.value = actorEnemy.name;
      return;
    }

    const noticeEnemy = segment.notices.find(notice => notice.combatant?.type && notice.combatant.type > 0)?.combatant;
    if (noticeEnemy?.name) {
      enemyName.value = noticeEnemy.name;
    }
  }

  /** 从 enemies API 获取敌人位置（替代旧 refreshContextFromApi 的位置部分） */
  async function refreshEnemyLocation(npcPid: number): Promise<void> {
    if (npcPid <= 0) return;
    try {
      const enemies = await refreshMapEnemies();
      for (const enemy of enemies) {
        if (parseInt(String(enemy.pid)) === npcPid) {
          enemyLocation.value = enemy.pls ?? null;
          return;
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
    combatContext.value = null;
    isPlayingBattleLog.value = false;
    isProcessingBattle.value = false;
    isPlayerTurn.value = false;
    enemyName.value = '';
    enemyLocation.value = null;
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
    combatContext,
    currentGroomid,
    currentPid,
    isPlayingBattleLog,
    isProcessingBattle,
    isPlayerTurn,
    enemyName,
    enemyLocation,
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
