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
}

export type OverlayKey = keyof OverlayFlags;

export const useOverlayStore = defineStore('overlay', () => {
  // ─── state ────────────────────────────────────────────
  const flags = ref<OverlayFlags>({
    fog: false,
    vision: false,
    reachability: false,
    tideHeatmap: false,
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
