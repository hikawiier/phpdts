// @module O 内容工具箱
//
// overlayStore：叠层开关（对齐 NEW_DESIGN.md §2.3.6）
// 承载叠层开关状态
// 默认关闭；按需开启

import { defineStore } from 'pinia';
import { ref } from 'vue';

export interface OverlayFlags {
  fog: boolean;
  vision: boolean;
  reachability: boolean;
  tideHeatmap: boolean;
  /**
   * 野生道具分布叠层（O-8）：选中某 distribution.scatter 规则后激活，
   * 在地图画布上灰阶高亮候选格 / 排除格 / 生成率。
   */
  wilditem: boolean;
  /**
   * POI 分布叠层（O-8）：选中某 distribution.poi 规则后激活，
   * 在地图画布上灰阶高亮候选格 / 排除格 / 理论概率。
   */
  poi: boolean;
  /**
   * 敌人分布叠层（O-8）：选中某 distribution.enemy 规则后激活，
   * 在地图画布上灰阶高亮候选格 / 排除格 / 放置数量。
   */
  enemy: boolean;
}

export type OverlayKey = keyof OverlayFlags;

export const useOverlayStore = defineStore('overlay', () => {
  // ─── state ────────────────────────────────────────────
  const flags = ref<OverlayFlags>({
    fog: false,
    vision: false,
    reachability: false,
    tideHeatmap: false,
    wilditem: false,
    poi: false,
    enemy: false,
  });

  // ─── actions ──────────────────────────────────────────
  function toggle(key: OverlayKey, value?: boolean): void {
    const next = value ?? !flags.value[key];
    flags.value = { ...flags.value, [key]: next };
  }

  function setFlag(key: OverlayKey, value: boolean): void {
    flags.value = { ...flags.value, [key]: value };
  }

  function resetAll(): void {
    flags.value = {
      fog: false,
      vision: false,
      reachability: false,
      tideHeatmap: false,
      wilditem: false,
      poi: false,
      enemy: false,
    };
  }

  return {
    // state
    flags,
    // actions
    toggle,
    setFlag,
    resetAll,
  };
});
