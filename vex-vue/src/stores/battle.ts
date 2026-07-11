// ══════════════════════════════════════════════════
// 战斗状态机 store
//
// 替代现有 vex/js/battle.js 的模块内部状态 + 函数逻辑。
//
// 状态机简化为 normal/battle 两态：
// - normal（探索）→ 玩家点击敌人 → startBattle() → battle
// - battle（战斗）→ 玩家/NPC 回合交替 → 播放 battlelog → 继续 battle 或回 normal
//
// presentation 数据流（不可变批次 + v2 导演编排）：
// - command/heartbeat 顶层返回 presentation.v1 批次
// - inbox 按 batch_seq 去重并连续交给 DirectorV2.directV2() 编排为脚本
// - DirectorV2.planPlaybackV2() 把语义脚本编排为 playback steps
// - BattlePlaybackRunner 按 steps 执行动作动画、文本模态框、残留反馈
// - presentation.v1 批次按 batch_seq 连续消费，成功播放后推进本地 cursor
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
import { getHeartbeatChangedScopes, isHeartbeatSoftFailed, oblHeartbeat, type OblHeartbeatResponse } from '@/api/client';
import { useToastStore } from '@/stores/toast';
import { usePlayerAvatarStore } from '@/stores/player-avatar';
import { usePlayerStore } from '@/stores/player';
import { useMapStore } from '@/stores/map';
import { useCharacterStore } from '@/stores/character';
import { useEntitiesStore } from '@/stores/entities';
import { usePresentationSceneStore } from '@/stores/presentation-scene';
import { ingestPresentationResponse, presentationInbox } from '@/stores/presentation-inbox';
import type { ApiAction } from '@/api/endpoints';
import { getSceneGeometry } from '@/composables/sceneRegistry';
import type { BattleQueue, PlayerInfo, Enemy, CombatViewModel, CombatTargetsResponse } from '@/types/api';
import type { PresentationAnimationRun } from '@/types/presentation-scene';
import {
  directV2,
  isBattleLogV2Event,
  planPlaybackV2,
  type BattlePlayScriptV2,
  type BattleSegmentV2,
} from './battle-director-v2';
import { runBattlePlaybackPlan, type SegmentPlayOptions } from './battle-playback-runner';
import {
  createBattlePresentationSession,
  type BattlePresentationSession,
  type PostCombatHandoffRun,
} from './battle-presentation-session';
import {
  PendingAuthorityScopes,
  drainBattleTicksToStable,
  shouldCommitBattleVisualState,
} from './battle-ui-policy';
import { getStatusLocale } from '@/data/status-locale';

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

/** 单次刷新最多连续推进的战斗 tick，防止异常状态导致无限排空。 */
const MAX_BATTLE_DRAIN_CYCLES = 32;

export function closePresentationSessionOwnership(
  session: BattlePresentationSession,
  cancelPending: (reason: string) => void,
  reason: string,
): void {
  cancelPending(reason);
  if (session.active) session.abort(reason);
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
  const currentQid = ref<number | null>(null);
  const currentGroomid = ref<number>(0);
  const currentPid = ref<number>(0);
  const combatContext = ref<CombatViewModel | null>(null);
  const combatTargets = ref<CombatTargetsResponse>({ qid: null, suggestedTargetPid: null, candidates: [] });
  const isPlayingBattleLog = ref<boolean>(false);
  const isProcessingBattle = ref<boolean>(false);

  // ── 演出状态（供组件响应式读取） ──
  /** 当前是否玩家回合（供 BattleActionBar 决定显示装填区还是等待提示） */
  const isPlayerTurn = ref<boolean>(false);
  /** 敌人名称（供 BattleHeader 显示） */
  const enemyName = ref<string>('');
  /** 战斗模态框是否打开 */
  const battleModalOpen = ref<boolean>(false);
  /** 当前正在播放的 v2 段（供 BattleModal 读取 text cues/actions/notices） */
  const currentSegment = ref<BattleSegmentV2 | null>(null);
  const battleModalSessionId = ref<string | null>(null);
  const battleModalIsBattleEnd = ref(false);
  const battleModalContentReady = ref(false);

  // ── NPC 回合自动刷新定时器（不响应式，仅内部使用） ──
  let npcTurnRefreshRunning = false;
  let npcTurnRefreshTimer: ReturnType<typeof setTimeout> | null = null;

  // ── 守护进程定时器（不响应式，仅内部使用） ──
  let daemonTimer: ReturnType<typeof setTimeout> | null = null;
  let daemonRunning = false;
  let combatTargetsRequestGeneration = 0;
  const pendingAuthorityScopes = new PendingAuthorityScopes();
  let authorityRefreshRun: Promise<void> | null = null;
  let authorityRefreshGeneration = 0;
  let presentationSession: BattlePresentationSession | null = null;
  let presentationSceneGeneration = 0;
  let activePresentationBatchSeq: number | null = null;
  let pendingBattleEndHandoff: {
    sessionId: string;
    sceneGeneration: number;
    actorRun: PostCombatHandoffRun;
    worldRun: PresentationAnimationRun;
    finished: Promise<void>;
  } | null = null;

  // ── 模态框播放完成回调（内部使用） ──
  let nextModalSessionId = 1;
  let coveredWait: { sessionId: string; resolve: () => void } | null = null;
  let closedWait: { sessionId: string; resolve: () => void } | null = null;

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
    if (context?.suggestedTargetPid && context.suggestedTargetPid > 0) {
      return context.suggestedTargetPid;
    }
    return extractEnemyPid(battleQueue);
  }

  async function refreshMapEnemies(generation = authorityRefreshGeneration): Promise<Enemy[]> {
    const enemiesResult = await dataManager.fetch('enemies', true);
    if (enemiesResult.status !== 'success' || !enemiesResult.data) {
      return useMapStore().enemies;
    }
    const enemies = ((enemiesResult.data as { enemies?: Enemy[] }).enemies || []);
    if (generation !== authorityRefreshGeneration) return useMapStore().enemies;
    useMapStore().updateMapData({ enemies });
    return enemies;
  }

  async function loadCombatTargets(): Promise<CombatTargetsResponse> {
    const generation = ++combatTargetsRequestGeneration;
    const result = await dataManager.fetch('combat_targets', true);
    if (generation !== combatTargetsRequestGeneration) return combatTargets.value;
    const expectedQid = combatContext.value?.qid ?? currentQid.value;
    const raw = result.status === 'success' && result.data
      ? result.data as CombatTargetsResponse
      : { qid: expectedQid, suggestedTargetPid: null, candidates: [] };
    const next: CombatTargetsResponse = {
      qid: raw.qid === null ? null : Number(raw.qid),
      suggestedTargetPid: raw.suggestedTargetPid === null ? null : Number(raw.suggestedTargetPid),
      candidates: Array.isArray(raw.candidates)
        ? raw.candidates.map(candidate => ({ ...candidate, pid: Number(candidate.pid) }))
        : [],
    };
    if (next.qid !== expectedQid) return combatTargets.value;
    combatTargets.value = next;
    const enemies = next.candidates.flatMap(candidate => candidate.character ? [candidate.character] : []);
    if (enemies.length > 0) {
      const characterStore = useCharacterStore();
      characterStore.mergeEnemyPatches(enemies);
      characterStore.mergeCombatContext(combatContext.value);
    }
    dataManager.broadcast('battle:combat-targets-updated', next);
    return next;
  }

  function ingestHeartbeat(heartbeat: OblHeartbeatResponse): void {
    ingestPresentationResponse(heartbeat);
    noteAuthorityScopes(getHeartbeatChangedScopes(heartbeat));
  }

  function noteAuthorityScopes(changedScopes: readonly ApiAction[]): void {
    if (changedScopes.length === 0) return;
    for (const scope of changedScopes) {
      dataManager.invalidate(scope);
    }
    pendingAuthorityScopes.record(changedScopes);
  }

  function publishAuthoritativePlayerInfo(playerInfo: PlayerInfo): void {
    usePlayerStore().setPlayerInfo(playerInfo);
    currentGroomid.value = parseInt(String(playerInfo.groomid)) || 0;
    currentPid.value = parseInt(String(playerInfo.pid)) || 0;
    combatContext.value = playerInfo.combat_context || null;
  }

  async function flushAuthoritativeStores(additionalScopes: readonly ApiAction[] = []): Promise<void> {
    noteAuthorityScopes(additionalScopes);
    if (authorityRefreshRun) {
      await authorityRefreshRun;
      return flushAuthoritativeStores();
    }

    const run = (async () => {
      for (;;) {
        const scopes = pendingAuthorityScopes.take() as ApiAction[];
        if (scopes.length === 0) return;
        const generation = authorityRefreshGeneration;
        try {
          if (scopes.includes('player_info')) {
            const result = await dataManager.fetch('player_info', true);
            if (result.status !== 'success' || !result.data) {
              throw new Error('authoritative player_info refresh failed');
            }
            if (generation !== authorityRefreshGeneration) continue;
            publishAuthoritativePlayerInfo(result.data as PlayerInfo);
          }
          if (scopes.includes('game_map')) {
            await useMapStore().loadMap();
          } else if (scopes.includes('enemies')) {
            await refreshMapEnemies(generation);
          }
          if (generation !== authorityRefreshGeneration) continue;
          if (scopes.includes('combat_targets')) await loadCombatTargets();
        } catch (error) {
          if (generation === authorityRefreshGeneration) pendingAuthorityScopes.record(scopes);
          throw error;
        }
      }
    })();
    authorityRefreshRun = run;
    try {
      await run;
    } finally {
      if (authorityRefreshRun === run) authorityRefreshRun = null;
    }
  }

  function cancelPendingBattleEndHandoff(reason: string): void {
    const pending = pendingBattleEndHandoff;
    if (!pending) return;
    pendingBattleEndHandoff = null;
    if (presentationSession?.id === pending.sessionId
      && presentationSceneGeneration === pending.sceneGeneration) {
      usePresentationSceneStore().finishRebase();
      presentationSession = null;
      presentationSceneGeneration = 0;
    }
    pending.actorRun.cancel(reason);
    pending.worldRun.cancel(reason);
  }

  async function rebasePresentationScene(): Promise<boolean> {
    const sceneStore = usePresentationSceneStore();

    try {
      if (presentationSession?.active) {
        const exits = presentationSession.sealForHandoff();
        const handoffs = sceneStore.beginRebase(
          useEntitiesStore().entities,
          useMapStore().projectionRevision,
          exits,
        );
        await nextTick();
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        const rebaseToken = sceneStore.rebaseToken;
        const worldRun = rebaseToken === null
          ? { finished: Promise.resolve(), cancel: () => {} }
          : sceneStore.sealRebaseMoves(rebaseToken);
        const actorRun = presentationSession.startCommit(handoffs);
        await Promise.all([actorRun.finished, worldRun.finished]);
        presentationSession = null;
        presentationSceneGeneration = 0;
        sceneStore.finishRebase();
      } else {
        sceneStore.syncAuthoritative(useEntitiesStore().entities, useMapStore().projectionRevision);
      }
      return true;
    } catch (e) {
      sceneStore.rollbackRebase();
      console.error('[Battle] presentation scene rebase error:', e);
      return false;
    }
  }

  // ══════════════════════════════════════════════════
  // NPC 回合自动刷新循环
  // ══════════════════════════════════════════════════

  /**
   * 启动 NPC 回合自动刷新循环
   *
   * NPC 顺位时，后端由 oblivions/api/heartbeat.php 显式执行 NPC 先攻轮。
   * 前端轮询 refreshBattle() 会先 await heartbeat，再读取 player_info 与响应内 presentation。
   *
   * 使用 setTimeout 递归调度（与 scheduleDaemonBeat 一致）：await refreshBattle()
   * 完成后再安排下一次，避免 refreshBattle 耗时 >1s 时 interval tick 空转。
   */
  function startNpcTurnRefresh(): void {
    if (npcTurnRefreshRunning) return;
    npcTurnRefreshRunning = true;
    scheduleNpcTurnRefresh();
  }

  function scheduleNpcTurnRefresh(): void {
    if (!npcTurnRefreshRunning) return;
    npcTurnRefreshTimer = setTimeout(async () => {
      npcTurnRefreshTimer = null;
      if (!npcTurnRefreshRunning) return;
      dataManager.invalidate('player_info');
      await refreshBattle();
      scheduleNpcTurnRefresh();
    }, NPC_TURN_REFRESH_INTERVAL);
  }

  /** 停止 NPC 回合自动刷新循环 */
  function stopNpcTurnRefresh(): void {
    npcTurnRefreshRunning = false;
    if (npcTurnRefreshTimer !== null) {
      clearTimeout(npcTurnRefreshTimer);
      npcTurnRefreshTimer = null;
    }
  }

  /** 是否有 NPC 自动刷新定时器在运行 */
  function hasNpcTurnRefreshTimer(): boolean {
    return npcTurnRefreshRunning;
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
      ingestHeartbeat(heartbeat);
      const playerStore = usePlayerStore();
      if (heartbeat.presentation || presentationInbox.peekNext() || presentationInbox.gapHead !== null) {
        await refreshBattle(heartbeat);
        return;
      }
      await flushAuthoritativeStores(['player_info']);
      if (currentMode.value === 'normal'
        && !isPlayingBattleLog.value
        && !isProcessingBattle.value
        && playerStore.oblBattleState !== 'PROCESSING') {
        await rebasePresentationScene();
      }
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
    const nextQid = context?.qid ?? null;
    const session = presentationSession;
    if (session && session.qid !== nextQid) {
      closePresentationSessionOwnership(session, cancelPendingBattleEndHandoff, 'qid_changed');
      if (presentationSession === session) {
        presentationSession = null;
        presentationSceneGeneration = 0;
      }
    }
    if (currentMode.value === 'battle' && currentQid.value === nextQid && nextQid !== null) {
      currentEnemyPid.value = enemyPid;
      updateActionPanel(playerTurn, context, false);
      return;
    }

    currentMode.value = 'battle';
    currentEnemyPid.value = enemyPid;
    currentQid.value = nextQid;

    // 敌人名称暂空，等 playback segment_context step 从 battlelog 提取后更新
    enemyName.value = '';

    updateActionPanel(playerTurn, context, true);

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
    combatTargetsRequestGeneration++;
    currentEnemyPid.value = 0;
    currentQid.value = null;
    combatContext.value = null;
    combatTargets.value = { qid: null, suggestedTargetPid: null, candidates: [] };
    enemyName.value = '';
    isPlayerTurn.value = false;
    battleModalOpen.value = false;
    currentSegment.value = null;
    cancelPendingBattleEndHandoff('battle_exited');
    if (presentationSession?.active) presentationSession.abort('battle_exited');
    presentationSession = null;
    presentationSceneGeneration = 0;
    dataManager.invalidate('enemies');
    dataManager.broadcast('battle:ended');

    // 玩家小人：战斗结束意图
    usePlayerAvatarStore().onBattleEnd();
  }

  /**
   * 更新动作面板：玩家顺位时显示装填区，否则显示等待提示
   */
  function updateActionPanel(playerTurn: boolean, context: CombatViewModel | null = combatContext.value, initialize = false): void {
    isPlayerTurn.value = playerTurn;
    if (playerTurn) {
      nextTick(() => {
        dataManager.broadcast(initialize ? 'battle:preload-init' : 'battle:preload-context-refresh', {
          mode: 'in-battle',
          enemyPid: combatTargets.value.suggestedTargetPid || context?.suggestedTargetPid || currentEnemyPid.value,
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

    const capability = usePlayerStore().getCapabilityDecision('enter_combat');
    if (!capability.allowed) {
      const names = (capability.source_status_ids ?? []).map(id => getStatusLocale(id).name);
      useToastStore().showToast(
        `${names.join('、') || '当前状态'}使你无法发起战斗。`,
        'error',
      );
      return;
    }

    currentMode.value = 'battle';
    currentEnemyPid.value = enemyPid;
    currentQid.value = null;
    combatContext.value = null;
    isPlayerTurn.value = true;

    enemyName.value = enemyPid > 0 ? '' : '瞄准模式';

    nextTick(() => {
      dataManager.broadcast('battle:preload-init', {
        mode: 'pre-battle',
        enemyPid,
        playerPid: currentPid.value,
        combatContext: null,
      });
    });

    dataManager.broadcast('battle:started', { enemyPid });
    void loadCombatTargets();

    // 玩家小人：战斗开始意图
    usePlayerAvatarStore().onBattleStart();
  }

  // ══════════════════════════════════════════════════
  // 主刷新函数
  // ══════════════════════════════════════════════════

  /**
   * 刷新战斗状态：拉取 player_info，进入/维持战斗模式，触发 battlelog 播放
   *
   * 职责分工：
   * - 本函数负责拉取数据 + 进入/维持战斗模式 + 启停 NPC 刷新
   * - 退出战斗模式的判断不在本函数，由 consumePresentationBatches 排空批次并
   *   到达稳定状态后决定
   *
   * 状态机驱动（3 态）：
   *  - 用 obl_battle_state 作为单一数据源决定轮询行为
   *  - PROCESSING → 继续轮询（后端正在处理）
   *  - PLAYER_TURN → 停止轮询，启用玩家操作
   *  - IDLE → 停止轮询
   */
  async function refreshBattle(prefetchedHeartbeat?: OblHeartbeatResponse): Promise<void> {
    if (isProcessingBattle.value) return;
    isProcessingBattle.value = true;

    try {
      // 阶段三后只读 API 不再隐式推进世界；战斗刷新必须显式等待 tick 结算，
      // 否则可能读到旧的 PROCESSING 状态或拿不到刚生成的 battlelog。
      //
      // 若调用方已通过 commandQueue._checkBattleState 拿到 heartbeat 结果
      // （经 game:tick-advanced 事件传入），直接复用，避免重复 POST heartbeat。
      const heartbeat = prefetchedHeartbeat ?? await oblHeartbeat();
      if (isHeartbeatSoftFailed(heartbeat)) return; // tick 未推进，等下一轮
      ingestHeartbeat(heartbeat);
      await flushAuthoritativeStores(['player_info']);
      const playerInfo = usePlayerStore().playerInfo;
      if (!playerInfo) return;
      const action = playerInfo.action || '';
      const battleQueue = playerInfo.battle_queue || null;
      const nextCombatContext = playerInfo.combat_context || null;
      const battleState = playerInfo.obl_battle_state;

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

      // 拉取并播放 battlelog；内部会持续推进 PROCESSING，并先排空 heartbeat
      // 新生成的日志，再由稳定状态决定退出还是继续。
      await consumePresentationBatches();
      if (currentMode.value === 'normal' && action !== 'battle') {
        await rebasePresentationScene();
      }
    } catch (e) {
      console.error('[Battle] refreshBattle error:', e);
      useToastStore().showToast('战斗数据异常，请刷新', 'error', 4000, false, 'battle-error');
    } finally {
      isProcessingBattle.value = false;
    }
  }

  // ══════════════════════════════════════════════════
  // 后端校验
  // ══════════════════════════════════════════════════

  /**
   * 后端校验：拉取最新 player_info，根据 action 决定退出还是继续战斗
   *
   * 触发时机：
   * - 导演播完所有动画后（consumePresentationBatches 末尾）
   * - F5 刷新页面初始化时（App.vue onMounted，已有逻辑）
   *
   * 设计原则：退出战斗页面唯一判据是后端校验，前端不维护战斗状态机。
   */
  async function advanceAndReadBattleState(): Promise<PlayerInfo | null> {
    const afterHeartbeat = await oblHeartbeat();
    if (isHeartbeatSoftFailed(afterHeartbeat)) return null;
    ingestHeartbeat(afterHeartbeat);
    await flushAuthoritativeStores(['player_info']);
    return usePlayerStore().playerInfo;
  }

  async function applyVerifiedBattleState(afterInfo: PlayerInfo): Promise<void> {
    const afterAction = afterInfo.action || '';
    const afterBattleState = afterInfo.obl_battle_state;
    if (shouldCommitBattleVisualState(afterAction, afterBattleState)) {
      await rebasePresentationScene();
    }
    if (afterAction === 'battle') {
      // 继续战斗
      currentEnemyPid.value = resolveEnemyPid(afterInfo.battle_queue || null, combatContext.value);
      if (afterBattleState === 'PLAYER_TURN') {
        const toastStore = useToastStore();
        toastStore.showToast('你的回合', 'info', YOUR_TURN_TOAST_DURATION);
      }
    } else {
      // 后端校验说"不在战斗了"，退出
      exitBattleMode();
    }
  }

  async function playPendingPresentationBatches(): Promise<number> {
    let played = 0;
    for (;;) {
      const batch = presentationInbox.peekNext();
      if (!batch) {
        const gapHead = presentationInbox.gapHead;
        if (gapHead === null) break;
        await flushAuthoritativeStores(['player_info', 'game_map', 'combat_targets']);
        if (!await rebasePresentationScene()) throw new Error('presentation gap rebase failed');
        presentationInbox.commitGap(gapHead);
        continue;
      }
      const v2Events = batch.events.filter(isBattleLogV2Event);
      const authorityHead = usePlayerStore().playerInfo?.presentation_head_seq ?? 0;
      if (authorityHead < batch.batch_seq) break;
      if (v2Events.length > 0) {
        const scriptV2 = directV2(v2Events);
        if (import.meta.env.DEV) {
          (globalThis as Record<string, unknown>).__battleScriptV2 = scriptV2;
          (globalThis as Record<string, unknown>).__battleRawEventsV2 = v2Events;
          (globalThis as Record<string, unknown>).__presentationBatchV1 = batch;
        }

        if (scriptV2.segments.length > 0) {
          const npcPid = extractNpcPidFromScriptV2(scriptV2);
          activePresentationBatchSeq = batch.batch_seq;
          try {
            await playScriptV2(scriptV2, npcPid);
          } finally {
            activePresentationBatchSeq = null;
          }
        }
      } else if (batch.events.length > 0 && import.meta.env.DEV) {
        console.warn('[Battle] ignored non-v2 presentation events.', batch.events);
      }
      presentationInbox.commit(batch.batch_seq);
      played += batch.events.length;
    }
    return played;
  }

  // ══════════════════════════════════════════════════
  // presentation inbox + 导演编排 + 播放 + 后端校验
  // ══════════════════════════════════════════════════

  /**
   * 连续消费 presentation.v1，导演编排后播放并触发后端校验
   *
   * 职责：
   * - command/heartbeat 响应批次经 inbox 去重后交给导演播放
   * - heartbeat 每次推进后先播放它新生成的批次
   * - 非 PROCESSING 且尾随日志排空后，由后端 action 决定退出还是继续
   */
  async function consumePresentationBatches(): Promise<void> {
    if (isPlayingBattleLog.value) return;
    if (!currentGroomid.value || !currentPid.value) return;

    isPlayingBattleLog.value = true;
    try {
      await playPendingPresentationBatches();
      if (currentMode.value !== 'battle') return;

      const drain = await drainBattleTicksToStable({
        maxCycles: MAX_BATTLE_DRAIN_CYCLES,
        advance: advanceAndReadBattleState,
        playPending: playPendingPresentationBatches,
        isProcessing: info => info.obl_battle_state === 'PROCESSING',
      });
      if (drain.status === 'stable' && drain.snapshot) {
        await applyVerifiedBattleState(drain.snapshot);
        return;
      }
      if (drain.status === 'exhausted' && import.meta.env.DEV) {
        console.warn(`[Battle] drain exceeded ${MAX_BATTLE_DRAIN_CYCLES} cycles; preserving presentation session`);
      }
    } catch (e) {
      cancelPendingBattleEndHandoff('playback_error');
      presentationSession?.abort('playback_error');
      presentationSession = null;
      presentationSceneGeneration = 0;
      console.error('[Battle] consumePresentationBatches error:', e);
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

    const scene = await waitForSceneGeometry();
    if (!scene) throw new Error('Battle scene is not available');
    if (!presentationSession?.active
      || presentationSession.qid !== currentQid.value
      || presentationSceneGeneration !== scene.generation) {
      presentationSession?.abort('scene_or_qid_changed');
      cancelPendingBattleEndHandoff('scene_or_qid_changed');
      presentationSession = createBattlePresentationSession(currentQid.value);
      presentationSceneGeneration = scene.generation;
      usePresentationSceneStore().beginPlayback();
    }

    await runBattlePlaybackPlan(plan, {
      currentPid: currentPid.value,
      npcPid,
      scene,
      presentation: presentationSession,
      updateSegmentContext,
      playSegmentInModal,
      enterBattleEndOverlay,
      handoffPresentationScene,
      playBattleEndModalContent,
    });
  }

  async function waitForSceneGeometry() {
    for (let i = 0; i < 10; i++) {
      const scene = getSceneGeometry();
      if (scene) return scene;
      await nextTick();
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    }
    return getSceneGeometry();
  }

  async function updateSegmentContext(segment: BattleSegmentV2, _npcPid: number): Promise<void> {
    updateEnemyNameFromSegment(segment);
    // 敌人位置不再需要主动刷新——CharacterHub 已通过权威资料 patch 持有最新 pls，
    // BattleHeader 响应式派生。参数 _npcPid 保留以兼容 runBattlePlaybackPlan 调用签名。
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

    const sessionId = `modal-${nextModalSessionId++}`;
    openBattleModal(segment, sessionId, false, true);
    await waitForModalClose(sessionId);
  }

  function openBattleModal(
    segment: BattleSegmentV2,
    sessionId: string,
    isBattleEnd: boolean,
    contentReady: boolean,
  ): void {
    currentSegment.value = segment;
    battleModalSessionId.value = sessionId;
    battleModalIsBattleEnd.value = isBattleEnd;
    battleModalContentReady.value = contentReady;
    battleModalOpen.value = true;
  }

  async function enterBattleEndOverlay(segment: BattleSegmentV2, sessionId: string): Promise<void> {
    if (presentationSession?.id !== sessionId) throw new Error('stale battle-end presentation session');
    openBattleModal(segment, sessionId, true, false);
    await waitForBattleEndOverlayCovered(sessionId);
  }

  async function handoffPresentationScene(_segment: BattleSegmentV2, sessionId: string): Promise<void> {
    const session = presentationSession;
    if (session?.id !== sessionId) throw new Error('stale presentation handoff');
    // Authority refresh starts when responses arrive. Handoff only joins any
    // already-running refresh before publishing its latest snapshot.
    await flushAuthoritativeStores();
    const authorityHead = usePlayerStore().playerInfo?.presentation_head_seq ?? 0;
    if (activePresentationBatchSeq === null || authorityHead < activePresentationBatchSeq) {
      throw new Error('authoritative projection has not reached the presentation batch watermark');
    }
    const sceneGeneration = presentationSceneGeneration;
    const sceneStore = usePresentationSceneStore();
    let authorityPublished = false;
    try {
      if (presentationSession !== session
        || presentationSceneGeneration !== sceneGeneration
        || battleModalSessionId.value !== sessionId) {
        throw new Error('presentation handoff replaced while loading authority');
      }
      const exits = session.sealForHandoff();
      const handoffs = sceneStore.beginRebase(
        useEntitiesStore().entities,
        useMapStore().projectionRevision,
        exits,
      );
      authorityPublished = true;
      await nextTick();
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      if (presentationSession !== session
        || presentationSceneGeneration !== sceneGeneration
        || battleModalSessionId.value !== sessionId) {
        throw new Error('presentation handoff replaced before animation start');
      }

      const actorRun = session.startCommit(handoffs);
      const rebaseToken = sceneStore.rebaseToken;
      if (rebaseToken === null) throw new Error('presentation rebase token is missing');
      const worldRun = sceneStore.sealRebaseMoves(rebaseToken);
      const pending = {
        sessionId,
        sceneGeneration,
        actorRun,
        worldRun,
        finished: Promise.resolve(),
      };
      pendingBattleEndHandoff = pending;
      pending.finished = Promise.all([actorRun.finished, worldRun.finished]).then(() => {
        if (pendingBattleEndHandoff !== pending
          || presentationSession !== session
          || presentationSceneGeneration !== sceneGeneration) return;
        sceneStore.finishRebase();
        presentationSession = null;
        presentationSceneGeneration = 0;
      }).catch(error => {
        if (pendingBattleEndHandoff === pending
          && presentationSession === session
          && presentationSceneGeneration === sceneGeneration) {
          sceneStore.finishRebase();
          presentationSession = null;
          presentationSceneGeneration = 0;
        }
        throw error;
      });
      if (battleModalSessionId.value === sessionId) battleModalContentReady.value = true;
    } catch (error) {
      if (pendingBattleEndHandoff?.sessionId !== sessionId
        && presentationSession === session
        && presentationSceneGeneration === sceneGeneration) {
        if (authorityPublished) {
          sceneStore.cancelActiveRebaseMoves('battle_end_handoff_start_failed');
          sceneStore.finishRebase();
        }
        session.abort('battle_end_handoff_start_failed');
        presentationSession = null;
        presentationSceneGeneration = 0;
      }
      throw error;
    }
  }

  async function playBattleEndModalContent(_segment: BattleSegmentV2, sessionId: string): Promise<void> {
    if (battleModalSessionId.value !== sessionId) throw new Error('stale battle-end modal session');
    const pending = pendingBattleEndHandoff;
    if (!pending || pending.sessionId !== sessionId) throw new Error('battle-end handoff run is missing');
    const [modalResult, handoffResult] = await Promise.allSettled([
      waitForModalClose(sessionId),
      pending.finished,
    ]);
    if (pendingBattleEndHandoff === pending) pendingBattleEndHandoff = null;
    if (modalResult.status === 'rejected') throw modalResult.reason;
    if (handoffResult.status === 'rejected') throw handoffResult.reason;
  }

  function segmentHasRenderableText(segment: BattleSegmentV2): boolean {
    if (segment.notices.some(notice => Boolean(notice.text.html))) return true;
    return segment.actions.some(action =>
      action.text.some(text => Boolean(text.html)) ||
      action.effects.some(effect => Boolean(effect.text?.html)),
    );
  }

  /** 等待模态框关闭 */
  async function waitForBattleEndOverlayCovered(sessionId: string): Promise<void> {
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        if (coveredWait?.sessionId === sessionId) coveredWait = null;
        resolve();
      }, 5000);
      coveredWait = { sessionId, resolve: () => {
        clearTimeout(timeout);
        resolve();
      } };
    });
  }

  async function waitForModalClose(sessionId: string): Promise<void> {
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        if (closedWait?.sessionId === sessionId) closedWait = null;
        resolve();
      }, MODAL_TIMEOUT);
      closedWait = { sessionId, resolve: () => {
        clearTimeout(timeout);
        resolve();
      } };
    });
  }

  function notifyBattleEndOverlayCovered(sessionId: string): void {
    if (battleModalSessionId.value !== sessionId || coveredWait?.sessionId !== sessionId) return;
    const wait = coveredWait;
    coveredWait = null;
    wait.resolve();
  }

  /**
   * 模态框播放完成通知（供 BattleModal 组件调用）
   *
   * BattleModal 播放完后调用本函数，触发 waitForModalClose 中的 Promise resolve。
   */
  function notifyModalClosed(sessionId: string = battleModalSessionId.value ?? ''): void {
    if (!sessionId || battleModalSessionId.value !== sessionId) return;
    battleModalOpen.value = false;
    currentSegment.value = null;
    battleModalSessionId.value = null;
    battleModalIsBattleEnd.value = false;
    battleModalContentReady.value = false;
    if (closedWait?.sessionId === sessionId) {
      const wait = closedWait;
      closedWait = null;
      wait.resolve();
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
    dataManager.invalidate('combat_targets');

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
    dataManager.listen('game:tick-advanced', (data) => {
      const d = data as { heartbeat?: OblHeartbeatResponse } | undefined;
      refreshBattle(d?.heartbeat);
    });
    dataManager.listen('game:command-committed', (data) => {
      const d = data as { changedScopes?: ApiAction[] } | undefined;
      noteAuthorityScopes(d?.changedScopes ?? []);
      void flushAuthoritativeStores().catch(error => {
        console.error('[Battle] command authority refresh error:', error);
      });
    });
  }

  /** 重置为初始状态（退出战斗/切换角色时） */
  function reset(): void {
    combatTargetsRequestGeneration++;
    currentMode.value = 'normal';
    currentEnemyPid.value = 0;
    currentQid.value = null;
    currentGroomid.value = 0;
    currentPid.value = 0;
    combatContext.value = null;
    combatTargets.value = { qid: null, suggestedTargetPid: null, candidates: [] };
    isPlayingBattleLog.value = false;
    isProcessingBattle.value = false;
    isPlayerTurn.value = false;
    enemyName.value = '';
    battleModalOpen.value = false;
    currentSegment.value = null;
    battleModalSessionId.value = null;
    battleModalIsBattleEnd.value = false;
    battleModalContentReady.value = false;
    cancelPendingBattleEndHandoff('battle_reset');
    presentationSession?.abort('battle_reset');
    presentationSession = null;
    presentationSceneGeneration = 0;
    activePresentationBatchSeq = null;
    authorityRefreshGeneration++;
    pendingAuthorityScopes.clear();
    usePresentationSceneStore().reset();
    stopNpcTurnRefresh();
    coveredWait?.resolve();
    coveredWait = null;
    closedWait?.resolve();
    closedWait = null;
  }

  return {
    // 状态
    currentMode,
    currentEnemyPid,
    currentQid,
    combatContext,
    combatTargets,
    currentGroomid,
    currentPid,
    isPlayingBattleLog,
    isProcessingBattle,
    isPlayerTurn,
    enemyName,
    battleModalOpen,
    currentSegment,
    battleModalSessionId,
    battleModalIsBattleEnd,
    battleModalContentReady,
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
    loadCombatTargets,
    // presentation 播放
    consumePresentationBatches,
    notifyModalClosed,
    notifyBattleEndOverlayCovered,
    // 装填区执行完成
    onPreloadExecuted,
    // 初始化
    registerListeners,
    // 重置
    reset,
  };
});
