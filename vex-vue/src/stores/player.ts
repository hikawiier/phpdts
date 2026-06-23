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
import type { PlayerInfo } from '@/types/api';

export const usePlayerStore = defineStore('player', () => {
  // ── 状态 ──
  const playerInfo = ref<PlayerInfo | null>(null);
  const loading = ref<boolean>(false);
  const error = ref<string>('');

  // ── 计算属性（方便 UI 访问，自动处理 null） ──
  const hp = computed(() => Number(playerInfo.value?.hp ?? 0));
  const mhp = computed(() => Number(playerInfo.value?.mhp ?? 0));
  const sp = computed(() => Number(playerInfo.value?.sp ?? 0));
  const msp = computed(() => Number(playerInfo.value?.msp ?? 0));
  const ap = computed(() => Number(playerInfo.value?.ap ?? 0));
  const maxAp = computed(() => Number(playerInfo.value?.max_ap ?? 0));
  const name = computed(() => playerInfo.value?.name ?? '');
  const pls = computed(() => Number(playerInfo.value?.pls ?? 0));
  const action = computed(() => playerInfo.value?.action ?? '');
  const isInBattle = computed(() => action.value === 'battle');
  const oblTick = computed(() => playerInfo.value?.obl_tick ?? 0);
  const oblPretick = computed(() => playerInfo.value?.obl_pretick ?? 0);
  /** NPC 待结算标志：true 时玩家应等待 NPC 事件结算完毕 */
  const oblTickPendingNpc = computed(() => playerInfo.value?.obl_tick_pending_npc ?? false);

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
        playerInfo.value = result.data as PlayerInfo;
        return playerInfo.value;
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
    hp,
    mhp,
    sp,
    msp,
    ap,
    maxAp,
    name,
    pls,
    action,
    isInBattle,
    oblTick,
    oblPretick,
    oblTickPendingNpc,
    // actions
    loadPlayerInfo,
    reset,
  };
});
