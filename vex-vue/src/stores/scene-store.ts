/**
 * @module K 状态管理层
 * @framework K-11 三场景所有权
 */

// ══════════════════════════════════════════════════
// 场景所有权 store
//
// 承载"探索 / 完整地图 / 战斗"三场景的所有权与切换。
// 对齐 F-K1-Scenes §三不变量 / B5.33-B5.41：
//   - 探索与战斗是中央工作区的互斥场景
//   - 完整地图是全屏模态，冻结下方探索场景并接管输入
//   - 单一顶栏按场景切换内容
//
// 渲染派生关系：
//   - centralScene = current === 'battle' ? 'battle' : 'explore'
//     （atlas 打开时 explore 仍挂载在下方，冻结但可见——模态覆盖与中央所有者解耦）
//   - isAtlasOverlay = current === 'atlas'
//
// 与 battle.ts 的关系（避免双源真值）：
//   - battle.ts.currentMode 派生自 isBattle（isBattle ? 'battle' : 'normal'）
//   - battle.ts.enterBattleMode / exitBattleMode / startBattle / reset 内部
//     调用 enterBattle / exitBattle，不直接维护模式真值
//   - 单一真源在 current，无双源冲突
//
// 与 K-7 视觉状态过渡机的关系：
//   - K-7 保持战斗专属三态（idle/playing/rebasing），不扩展为通用场景机
//   - 完整地图场景的进入/退出过渡由本框架独立承载，不依赖 K-7
//   - 战斗场景进入/退出仍由 K-7 承载
// ══════════════════════════════════════════════════

import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

export type SceneId = 'explore' | 'atlas' | 'battle';

export const useSceneStore = defineStore('scene', () => {
  // 当前所有者场景（单一真源，不用多 bool 避免组合爆炸）
  const current = ref<SceneId>('explore');

  const isExplore = computed(() => current.value === 'explore');
  const isAtlas = computed(() => current.value === 'atlas');
  const isBattle = computed(() => current.value === 'battle');

  // 中央工作区所有者：探索与战斗互斥
  // atlas 打开时仍返回 explore（保证 atlas 模态覆盖时 explore 不卸载，仅冻结）
  const centralScene = computed<'explore' | 'battle'>(() =>
    current.value === 'battle' ? 'battle' : 'explore',
  );

  // atlas 作为 explore 之上的模态覆盖
  const isAtlasOverlay = computed(() => current.value === 'atlas');

  /**
   * 打开完整地图（从探索场景进入）
   * 守门：战斗场景下直接 return（完整地图入口在战斗场景隐藏）
   */
  function openAtlas(): void {
    if (current.value === 'battle') return;
    current.value = 'atlas';
  }

  /** 关闭完整地图，回到探索场景 */
  function closeAtlas(): void {
    if (current.value !== 'atlas') return;
    current.value = 'explore';
  }

  /**
   * 进入战斗场景
   * 单值赋值天然完成"先关 atlas 再进 battle"——无需显式 closeAtlas
   */
  function enterBattle(): void {
    current.value = 'battle';
  }

  /** 退出战斗场景，回到探索场景 */
  function exitBattle(): void {
    if (current.value !== 'battle') return;
    current.value = 'explore';
  }

  return {
    current,
    isExplore,
    isAtlas,
    isBattle,
    centralScene,
    isAtlasOverlay,
    openAtlas,
    closeAtlas,
    enterBattle,
    exitBattle,
  };
});
