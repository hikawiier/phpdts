// ══════════════════════════════════════════════════
// 玩家信息 store
//
// 替代现有 vex/js/player.js 的 player_info 状态管理。
// M1 阶段提供基础状态 + loadPlayerInfo() action，
// UI 渲染逻辑（状态栏/属性详情）在 M2/M4 阶段迁移。
//
// 注意（迁移计划 2.9 节 M0 发现）：
//   - player_info 数值字段均为字符串（如 "hp":"398"）
//   - 存在未记录字段：tacpara / skillpara / obl_tick / obl_pretick
//   - obl_tick / obl_pretick 是数字类型（非字符串）
// ══════════════════════════════════════════════════

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { dataManager } from '@/stores/data-manager';
import { useCharacterStore } from '@/stores/character';
import type { PlayerInfo, BattleState, CombatViewModel } from '@/types/api';

export const usePlayerStore = defineStore('player', () => {
  // ── 状态 ──
  const playerInfo = ref<PlayerInfo | null>(null);
  const loading = ref<boolean>(false);
  const error = ref<string>('');

  // ── 计算属性（方便 UI 访问，自动处理 null） ──
  // 标准标量字段（hp/mhp/sp/msp/ap/max_ap/pls/name 等）已迁移到 CharacterHub（characterStore.player）。
  // playerStore 保留 UI 派生状态 + JSON 大字段解析。
  const action = computed(() => playerInfo.value?.action ?? '');
  const isInBattle = computed(() => action.value === 'battle');
  const oblTick = computed(() => playerInfo.value?.obl_tick ?? 0);
  const oblPretick = computed(() => playerInfo.value?.obl_pretick ?? 0);
  const combatContext = computed<CombatViewModel | null>(() => playerInfo.value?.combat_context ?? null);

  // ── 战斗状态机（3 态） ──
  /** 当前玩家所在战场的状态 */
  const oblBattleState = computed<BattleState>(
    () => playerInfo.value?.obl_battle_state ?? 'IDLE',
  );
  /** 战斗是否活跃（PLAYER_TURN / PROCESSING） */
  const isBattleActive = computed(
    () => oblBattleState.value === 'PLAYER_TURN'
      || oblBattleState.value === 'PROCESSING',
  );
  /** 是否轮到玩家行动（PLAYER_TURN 状态） */
  const isPlayerTurn = computed(
    () => oblBattleState.value === 'PLAYER_TURN',
  );
  /** 后端是否正在处理中（PROCESSING 状态，前端应继续轮询） */
  const isNpcActing = computed(
    () => oblBattleState.value === 'PROCESSING',
  );

  /**
   * 拉取玩家信息
   *
   * @param forceRefresh true 时强制刷新（跳过缓存）
   */
  async function loadPlayerInfo(forceRefresh = false): Promise<PlayerInfo | null> {
    loading.value = true;
    error.value = '';
    try {
      const result = await dataManager.fetch('player_info', forceRefresh);
      if (result.status === 'success' && result.data) {
        const info = result.data as PlayerInfo;
        playerInfo.value = info;
        // 同步写入 CharacterHub（玩家自身 + 战斗上下文）
        const characterStore = useCharacterStore();
        characterStore.mergePlayer(info);
        characterStore.mergeCombatContext(info.combat_context);
        return info;
      }
      error.value = result.msg || '拉取玩家信息失败';
      return null;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      return null;
    } finally {
      loading.value = false;
    }
  }

  /**
   * 直接设置玩家信息（供 battleStore.refreshBattle 等已自行拉取数据的场景使用）
   *
   * 与 loadPlayerInfo 的区别：不走 dataManager，不管理 loading 状态。
   * 仅清空 error（数据已成功获取才会调用此方法）。
   *
   * 同步写入 CharacterHub（玩家自身 + 战斗上下文），与 loadPlayerInfo 保持一致。
   */
  function syncCharacterProjection(info: PlayerInfo | null = playerInfo.value): void {
    if (!info) return;
    const characterStore = useCharacterStore();
    characterStore.mergePlayer(info);
    characterStore.mergeCombatContext(info.combat_context);
  }

  function setPlayerInfo(info: PlayerInfo, options: { syncCharacters?: boolean } = {}): void {
    playerInfo.value = info;
    error.value = '';
    if (options.syncCharacters !== false) syncCharacterProjection(info);
  }

  /** 重置为初始状态 */
  function reset(): void {
    playerInfo.value = null;
    loading.value = false;
    error.value = '';
  }

  return {
    // 状态
    playerInfo,
    loading,
    error,
    // 计算属性
    action,
    isInBattle,
    oblTick,
    oblPretick,
    combatContext,
    oblBattleState,
    isBattleActive,
    isPlayerTurn,
    isNpcActing,
    // actions
    loadPlayerInfo,
    setPlayerInfo,
    syncCharacterProjection,
    reset,
  };
});
