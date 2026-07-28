// @module O 内容工具箱
//
// 叠层开关 key 常量（对齐设计案 §2.3.6 overlayStore.flags）

export const OVERLAY_KEYS = {
  FOG: 'fog',
  VISION: 'vision',
  REACHABILITY: 'reachability',
  TIDE_HEATMAP: 'tideHeatmap',
  WILDITEM: 'wilditem',
  POI: 'poi',
  ENEMY: 'enemy',
} as const;

export type OverlayKey = (typeof OVERLAY_KEYS)[keyof typeof OVERLAY_KEYS];

/**
 * 叠层 key 列表（用于遍历与持久化）
 */
export const OVERLAY_KEY_LIST: readonly OverlayKey[] = Object.values(OVERLAY_KEYS);
