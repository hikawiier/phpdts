// ══════════════════════════════════════════════════
// 地图缩放状态管理 / Map zoom state
//
// 提取自现有 vex/js/map-render.js 的缩放常量 + zoomLevel 状态。
// useMapRender.ts 使用 createZoomState() 创建响应式缩放状态。
//
// 拆分原因（迁移计划 4.3 M3 任务 5）：
//   - 缩放逻辑独立可测
//   - useMapInteraction.ts 也需要 ZOOM_STEP 常量
//   - 避免与渲染逻辑耦合
// ══════════════════════════════════════════════════

import { ref, type Ref } from 'vue';

// ─── 缩放常量（与现有 map-render.js 一致） ───
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 2.5;
export const ZOOM_STEP = 0.15;

/**
 * 将缩放值限制在 [ZOOM_MIN, ZOOM_MAX] 范围内，并四舍五入到 0.01 精度
 * 与现有 map-render.js applyZoom 的 clamp 逻辑一致
 */
export function clampZoom(zoom: number): number {
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(zoom * 100) / 100));
}

/**
 * 创建响应式缩放状态
 *
 * @returns { zoomLevel, setZoom, getZoom, isInitialized, setInitialized }
 *   - zoomLevel: Ref<number> 响应式缩放级别
 *   - setZoom(v): 设置缩放（自动 clamp）
 *   - getZoom(): 获取当前缩放（非响应式读取）
 *   - isInitialized: Ref<boolean> 智能默认缩放是否已计算
 *   - setInitialized(v): 设置初始化标志
 */
export function createZoomState(): {
  zoomLevel: Ref<number>;
  setZoom: (v: number) => void;
  getZoom: () => number;
  isInitialized: Ref<boolean>;
  setInitialized: (v: boolean) => void;
  reset: () => void;
} {
  const zoomLevel = ref<number>(1);
  const isInitialized = ref<boolean>(false);

  function setZoom(v: number): void {
    zoomLevel.value = clampZoom(v);
  }

  function getZoom(): number {
    return zoomLevel.value;
  }

  function setInitialized(v: boolean): void {
    isInitialized.value = v;
  }

  function reset(): void {
    zoomLevel.value = 1;
    isInitialized.value = false;
  }

  return {
    zoomLevel,
    setZoom,
    getZoom,
    isInitialized,
    setInitialized,
    reset,
  };
}
