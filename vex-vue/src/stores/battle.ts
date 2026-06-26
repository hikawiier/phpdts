// ══════════════════════════════════════════════════
// 战斗状态机 store
//
// 替代现有 vex/js/battle.js 的模块内部状态 + 函数逻辑。
// M2 阶段只迁移状态字段，M6 阶段补全完整战斗状态机。
//
// 状态机简化为 normal/battle 两态（迁移计划 2.5 节）：
// - normal（探索）→ 玩家点击敌人 → startBattle() → battle
// - battle（战斗）→ 玩家/NPC 回合交替 → 播放 battlelog → 继续 battle 或回 normal
//
// battlelog 数据流（played 标记机制）：
// - 后端所有 battlelog 持久化到文件，每条带 log_id + played=0
// - 前端拉取 played=0 的条目 → 按战斗分组 → 每组先播碰撞动画再播模态框
// - 播完调 mark_battle_log_played.php 标记 played=1
//
// 演出事件转发（store → 组件单向触发）：
// - battle:preload-init → PreloadArea 组件初始化装填区
// - battle:play-collision → CollisionAnimation 组件播放碰撞动画
// - battle:play-damage-numbers → DamageNumber 组件播放残留伤害数字
//
// 模态框播放完成机制：
// - store 设置 battleLogEntries + battleModalOpen=true，返回 Promise
// - BattleModal 播放完成后调用 store.notifyModalClosed()
// - store 触发 resolve，继续后续流程
// ══════════════════════════════════════════════════

import { defineStore } from 'pinia';
import { ref, nextTick } from 'vue';
import { dataManager } from '@/stores/data-manager';
import { markBattleLogPlayed } from '@/api/client';
import { useToastStore } from '@/stores/toast';
import type { BattleLogEntry, BattleQueue, PlayerInfo, Enemy } from '@/types/api';
import type { BattlePlayContext } from '@/data/battle-templates';

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

  // ── M6 新增：演出状态（供组件响应式读取） ──
  /** 当前是否玩家回合（供 BattleActionBar 决定显示装填区还是等待提示） */
  const isPlayerTurn = ref<boolean>(false);
  /** 敌人名称（供 BattleHeader 显示） */
  const enemyName = ref<string>('');
  /** 敌人位置（供 BattleHeader 显示） */
  const enemyLocation = ref<string | number | null>(null);
  /** 当前正在播放的 battlelog 条目（供 BattleModal v-for 渲染） */
  const battleLogEntries = ref<BattleLogEntry[]>([]);
  /** 战斗模态框是否打开 */
  const battleModalOpen = ref<boolean>(false);
  /** 播放上下文（供 BattleModal 读取双方名称/HP） */
  const playContext = ref<BattlePlayContext | null>(null);

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
   * 迁移自现有 vex/js/battle.js extractEnemyPid()。
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

  /**
   * 按战斗分组（从 entries 推导 NPC pid）
   *
   * 单 NPC 战斗约束下，从 entries 中找 type>0 的一方作为 NPC pid，
   * 所有条目归入同一组。
   *
   * 迁移自现有 vex/js/battle.js groupByEncounter()。
   */
  function groupByEncounter(entries: BattleLogEntry[]): { npcPid: number; entries: BattleLogEntry[] }[] {
    let npcPid = 0;
    for (const e of entries) {
      if (Number(e.actor_type) > 0) {
        npcPid = Number(e.actor_pid);
        break;
      }
      if (Number(e.target_type) > 0) {
        npcPid = Number(e.target_pid);
        break;
      }
    }
    if (npcPid === 0) return [];
    return [{ npcPid, entries }];
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
      // 失效缓存确保拉取最新数据（触发后端 common.inc）
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
   *
   * 迁移自现有 vex/js/battle.js enterBattleMode()。
   */
  function enterBattleMode(enemyPid: number, playerTurn: boolean): void {
    // 已在 battle 模式且敌人未变，只更新动作面板
    if (currentMode.value === 'battle' && currentEnemyPid.value === enemyPid) {
      updateActionPanel(playerTurn);
      return;
    }

    currentMode.value = 'battle';
    currentEnemyPid.value = enemyPid;

    // 敌人名称暂空，等 playBattleLogGroup 从 battlelog 提取后更新
    enemyName.value = '';
    enemyLocation.value = null;

    // 根据顺位渲染动作面板
    updateActionPanel(playerTurn);
  }

  /**
   * 退出战斗模式
   *
   * 迁移自现有 vex/js/battle.js exitBattleMode()。
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
    playContext.value = null;

    // 失效敌人列表缓存（战斗结束后敌人列表可能变化：敌人死亡/刷新）
    dataManager.invalidate('enemies');

    // 广播战斗结束事件，触发地图和动作条刷新
    dataManager.broadcast('battle:ended');
  }

  /**
   * 更新动作面板：玩家顺位时显示装填区，否则显示等待提示
   *
   * 迁移自现有 vex/js/battle.js updateActionPanel()。
   * Vue 版通过 broadcast 'battle:preload-init' 事件触发 PreloadArea 组件初始化。
   */
  function updateActionPanel(playerTurn: boolean): void {
    isPlayerTurn.value = playerTurn;
    if (playerTurn) {
      // 初始化装填区（in-battle 模式）
      // 用 nextTick 延迟广播，确保 PreloadArea 组件已挂载（首次进入 battle 模式时组件还未渲染）
      nextTick(() => {
        dataManager.broadcast('battle:preload-init', {
          mode: 'in-battle',
          enemyPid: currentEnemyPid.value,
          playerPid: currentPid.value,
        });
      });
    }
    // NPC 回合时 BattleActionBar 根据 isPlayerTurn=false 显示等待提示
  }

  // ══════════════════════════════════════════════════
  // 玩家主动攻击流程
  // ══════════════════════════════════════════════════

  /**
   * 玩家主动攻击：切换到预装填界面
   *
   * 供外部调用（如地图点击敌人）。
   * 不再显示确认对话框，直接切换到战斗模式并初始化装填区。
   * 玩家在装填区预装填动作后点击"执行"提交 obl_battle_start。
   *
   * 迁移自现有 vex/js/battle.js startBattle()。
   *
   * @param enemyPid 敌人 PID（0 表示瞄准模式，需先选目标）
   */
  function startBattle(enemyPid: number): void {
    if (currentMode.value !== 'normal') return;

    // 切换到战斗模式（后端尚未知道战斗开始）
    currentMode.value = 'battle';
    currentEnemyPid.value = enemyPid;
    isPlayerTurn.value = true;

    // 无目标时显示瞄准提示
    enemyName.value = enemyPid > 0 ? '' : '瞄准模式';
    enemyLocation.value = null;

    // 初始化装填区（pre-battle 模式）
    // 用 nextTick 延迟广播，确保 PreloadArea 组件已挂载（currentMode 切换触发响应式渲染）
    nextTick(() => {
      dataManager.broadcast('battle:preload-init', {
        mode: 'pre-battle',
        enemyPid,
        playerPid: currentPid.value,
      });
    });

    // 广播战斗开始事件
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
 * 状态机驱动（阶段2重构）：
 * - 用 obl_battle_state 作为单一数据源决定轮询行为
 * - PLAYER_DONE / NPC_ACTING → 继续轮询（NPC 即将/正在行动）
 * - WAITING_PLAYER → 停止轮询，启用玩家操作
 * - IDLE / ENDED → 停止轮询
   *
   * 在 game:action-completed / preload:executed 事件中调用。
   * NPC 顺位时会由 startNpcTurnRefresh 定时循环调用本函数。
   *
   * 迁移自现有 vex/js/battle.js refreshBattle()。
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
      // 战斗状态机：单一数据源
      const battleState = playerInfo.obl_battle_state;

      // 记录 groomid 和 pid（用于标记接口）
      currentGroomid.value = parseInt(String(playerInfo.groomid)) || 0;
      currentPid.value = parseInt(String(playerInfo.pid)) || 0;

      if (action === 'battle') {
        // 从先攻队列中提取敌人 PID
        const enemyPid = extractEnemyPid(battleQueue);
        // 用状态机判断玩家回合（WAITING_PLAYER = 玩家可操作）
        const playerTurn = battleState === 'WAITING_PLAYER';
        enterBattleMode(enemyPid, playerTurn);

        // 用状态机决定轮询行为
        // PLAYER_DONE / NPC_ACTING → 继续轮询（tick 即将/正在推进）
        // WAITING_PLAYER / IDLE / ENDED → 停止轮询
        if (battleState === 'NPC_ACTING' || battleState === 'PLAYER_DONE') {
          startNpcTurnRefresh();
        } else {
          stopNpcTurnRefresh();
        }
      } else {
        // action='' 战斗已结束
        // 不立即退出战斗模式，等 battlelog 播放完成后再退出（避免组件卸载导致动画/模态框无法显示）
        stopNpcTurnRefresh();
      }

      // 独立播放积压的 battlelog（不管模式，有就播放，没有就跳过）
      await fetchAndPlayBattleLog();

      // 播放完成后，根据 action 决定后续状态
      if (action === 'battle') {
        // 仍在战斗中：重新拉取 player_info 确认当前顺位（动画播放期间状态可能变化）
        const afterResult = await dataManager.fetch('player_info', true);
        if (afterResult.status === 'success' && afterResult.data) {
          const afterInfo = afterResult.data as PlayerInfo;
          const afterAction = afterInfo.action || '';
          if (afterAction === 'battle') {
            // 用状态机判断是否轮到玩家
            if (afterInfo.obl_battle_state === 'WAITING_PLAYER') {
              const toastStore = useToastStore();
              toastStore.showToast('你的回合', 'info', YOUR_TURN_TOAST_DURATION);
            }
          } else {
            // 动画播放期间战斗已结束（后端推进了），退出战斗模式
            exitBattleMode();
          }
        }
      } else {
        // action !== 'battle'（战斗已结束），播放完成后退出战斗模式
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
  // battlelog 拉取 + 分组 + 播放 + 标记
  // ══════════════════════════════════════════════════

  /**
   * 拉取未播放的 battlelog，按战斗分组播放，播完标记
   *
   * 纯粹的"拉取-播放-标记"播放器，不涉及任何状态管理逻辑：
   * - 不判断 action（由 refreshBattle 负责）
   * - 不调用 exitBattleMode（由 refreshBattle 负责）
   * - 不显示 toast（由 refreshBattle 负责）
   *
   * 迁移自现有 vex/js/battle.js fetchAndPlayBattleLog()。
   */
  async function fetchAndPlayBattleLog(): Promise<void> {
    if (isPlayingBattleLog.value) return; // 防重入
    if (!currentGroomid.value || !currentPid.value) return;

    try {
      // 失效缓存，确保拉取最新
      dataManager.invalidate('battle_log');
      const result = await dataManager.fetch('battle_log', true);
      if (result.status !== 'success' || !result.data) return;

      const entries = (result.data as { entries?: BattleLogEntry[] }).entries || [];
      if (entries.length === 0) return;

      isPlayingBattleLog.value = true;

      // 按战斗分组
      const groups = groupByEncounter(entries);

      // 收集所有要标记的 log_id
      const allLogIds = entries.map((e) => Number(e.log_id)).filter((id) => id);

      // 逐组播放
      for (const group of groups) {
        await playBattleLogGroup(group.entries, group.npcPid);
      }

      // 标记为已播放
      const markResult = await markBattleLogPlayed(
        currentGroomid.value,
        currentPid.value,
        allLogIds,
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
   * 播放一组的 battlelog：先碰撞动画，再模态框，最后伤害数字
   *
   * 迁移自现有 vex/js/battle.js playBattleLogGroup()。
   * Vue 版通过事件转发触发组件动画，通过 ref 驱动模态框。
   *
   * @param entries 同一 NPC 的 battlelog 条目
   * @param npcPid NPC PID
   */
  async function playBattleLogGroup(
    entries: BattleLogEntry[],
    npcPid: number,
  ): Promise<void> {
    // 过滤出 excute 阶段的日志（核心伤害日志），其他阶段不播放动画
    const excuteEntries = entries.filter((e) => e.phase === 'excute');
    if (excuteEntries.length === 0) return;

    // 获取播放上下文（敌人名称+HP 从 API 获取）
    const context = await buildPlayContext(npcPid);
    playContext.value = context;

    // 从 battlelog 重建初始 HP（覆盖战后 API 数据）
    // battlelog 的 extra 携带 actor_oldhp/target_oldhp，第一条针对该目标的 entry 的 oldhp 即为战前 HP
    rebuildInitialHpFromEntries(context, excuteEntries);

    // 更新战斗 header（敌人名称+位置）
    enemyName.value = context.enemyName;
    enemyLocation.value = context.npcLocation;

    // 1. 先播放碰撞动画（冲刺+抖动，不含伤害数字）
    for (const entry of excuteEntries) {
      if (entry.action_id === 'unarmed_strike') {
        dataManager.broadcast('battle:play-collision', { entry, npcPid });
        await sleep(COLLISION_ANIM_DURATION);
      }
    }

    // 2. 播放模态框（详细战斗日志）
    battleLogEntries.value = excuteEntries;
    battleModalOpen.value = true;
    await new Promise<void>((resolve) => {
      // 超时兜底：30s 后自动 resolve，避免组件异常卸载未通知导致永久挂起
      const timeout = setTimeout(() => {
        _modalResolve = null;
        resolve();
      }, MODAL_TIMEOUT);
      _modalResolve = () => {
        clearTimeout(timeout);
        resolve();
      };
    });

    // 3. 模态框关闭后，伤害数字淡入显示在地图格上（残留反馈）
    dataManager.broadcast('battle:play-damage-numbers', {
      entries: excuteEntries,
      npcPid,
    });
  }

  /**
   * 模态框播放完成通知（供 BattleModal 组件调用）
   *
   * BattleModal 播放完打字机效果 + 停留后调用本函数，
   * 触发 playBattleLogGroup 中的 Promise resolve，继续后续流程。
   */
  function notifyModalClosed(): void {
    battleModalOpen.value = false;
    battleLogEntries.value = [];
    if (_modalResolve) {
      _modalResolve();
      _modalResolve = null;
    }
  }

  /**
   * 从 API 获取最新状态，更新播放上下文
   *
   * 迁移自现有 vex/js/battle.js refreshContextFromApi()。
   */
  async function refreshContextFromApi(ctx: BattlePlayContext): Promise<void> {
    try {
      const playerInfoResult = await dataManager.fetch('player_info', true);
      if (playerInfoResult.status === 'success' && playerInfoResult.data) {
        const playerInfo = playerInfoResult.data as PlayerInfo;
        ctx.playerHp = parseInt(String(playerInfo.hp)) || 0;
        ctx.playerMaxHp = parseInt(String(playerInfo.mhp)) || 1;
        ctx.playerName = playerInfo.name || '';
      }

      const enemiesResult = await dataManager.fetch('enemies', true);
      if (enemiesResult.status === 'success' && enemiesResult.data) {
        const enemies = (enemiesResult.data as { enemies?: Enemy[] }).enemies || [];
        for (const enemy of enemies) {
          if (parseInt(String(enemy.pid)) === parseInt(String(ctx.npcPid))) {
            ctx.npcName = enemy.name || '敌人';
            ctx.npcHp = parseInt(String(enemy.hp)) || 0;
            ctx.npcMaxHp = parseInt(String(enemy.mhp)) || 1;
            if (enemy.pls) ctx.npcLocation = enemy.pls;
            // 兼容旧字段名（供 battle-templates.ts 使用）
            ctx.enemyName = ctx.npcName;
            ctx.enemyHp = ctx.npcHp;
            ctx.enemyMaxHp = ctx.npcMaxHp;
            break;
          }
        }
      }
    } catch (e) {
      console.error('[Battle] refreshContextFromApi error:', e);
      useToastStore().showToast('战斗数据异常，请刷新', 'error', 4000, false, 'battle-error');
    }
  }

  /**
   * 首次构建播放上下文
   *
   * 迁移自现有 vex/js/battle.js buildPlayContext()。
   */
  async function buildPlayContext(npcPid: number): Promise<BattlePlayContext> {
    const ctx: BattlePlayContext = {
      npcPid,
      npcName: '敌人',
      npcHp: 0,
      npcMaxHp: 1,
      npcLocation: null,
      playerHp: 0,
      playerMaxHp: 1,
      playerName: '',
      // 兼容旧字段名
      enemyName: '敌人',
      enemyHp: 0,
      enemyMaxHp: 1,
    };
    await refreshContextFromApi(ctx);
    return ctx;
  }

  /**
   * 从 battlelog 条目重建初始 HP（覆盖战后 API 数据）
   *
   * 问题背景：buildPlayContext 通过 refreshContextFromApi 拉取的是战后 HP，
   * 作为模态框初始 HP 会导致 HP 条时序倒置（先显示战后血量再跳回战中血量）。
   *
   * 修复方案：battlelog 的 extra 携带 actor_oldhp/target_oldhp，
   * 第一条针对该目标的 entry 的 oldhp 即为该目标的战前 HP。
   *
   * @param ctx 播放上下文（会被原地修改）
   * @param entries excute 阶段的 battlelog 条目（按 log_id 升序）
   */
  function rebuildInitialHpFromEntries(ctx: BattlePlayContext, entries: BattleLogEntry[]): void {
    let playerHpSet = false;
    let npcHpSet = false;

    for (const entry of entries) {
      if (!entry.extra) continue;
      const extra = entry.extra as {
        actor_oldhp?: number;
        target_oldhp?: number;
      };

      // 玩家初始 HP：第一条 actor_type=0 的 actor_oldhp
      if (!playerHpSet && Number(entry.actor_type) === 0 && extra.actor_oldhp !== undefined) {
        ctx.playerHp = Number(extra.actor_oldhp);
        playerHpSet = true;
      }

      // 敌人初始 HP：第一条 target_type>0 的 target_oldhp
      if (!npcHpSet && Number(entry.target_type) > 0 && extra.target_oldhp !== undefined) {
        ctx.npcHp = Number(extra.target_oldhp);
        ctx.enemyHp = ctx.npcHp; // 兼容旧字段
        npcHpSet = true;
      }

      // 两方都重建完毕则退出
      if (playerHpSet && npcHpSet) break;
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
   *
   * 迁移自现有 vex/js/battle.js onPreloadExecuted()。
   */
  async function onPreloadExecuted(): Promise<void> {
    // 失效缓存
    dataManager.invalidate('player_info');
    dataManager.invalidate('enemies');
    dataManager.invalidate('battle_log');

    // 刷新战斗状态
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
   *
   * 迁移自现有 vex/js/battle.js initBattle()。
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
    // command-queue.ts 推进 tick 成功后广播此事件
    // 拉取最新状态并决定是否启动/停止 NPC 轮询
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
    playContext.value = null;
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
    playContext,
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
    playBattleLogGroup,
    notifyModalClosed,
    // 上下文
    buildPlayContext,
    refreshContextFromApi,
    // 装填区执行完成
    onPreloadExecuted,
    // 初始化
    registerListeners,
    // 重置
    reset,
  };
});
