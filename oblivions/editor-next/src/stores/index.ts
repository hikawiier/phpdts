// @module O 内容工具箱
//
// Pinia stores 聚合导出（8 个，对齐 NEW_DESIGN.md §2.3）
// 各 store 单独定义 framework 归属，这里仅做导出聚合

export { useProjectStore } from './projectStore';
export { useSimStore } from './simStore';
export { useConfigStore } from './configStore';
export { useRawFilesStore } from './rawFilesStore';
export { useOverlayStore } from './overlayStore';
export { useToolStore } from './toolStore';
export { useHistoryStore } from './historyStore';
export { useValidateStore } from './validateStore';
export { useUiStore } from './uiStore';

// 辅助函数导出
export { createCommand } from './historyStore';
export {
  EDITOR_TOOL_LIST,
  TOOL_SHORTCUTS,
  TOOL_SHORTCUT_LABELS,
  DEFAULT_BRUSH,
  sanitizeBrush,
} from './toolStore';

// 常量导出（供 SimulatePanel / useOverlayRenderer 使用）
export { DEFAULT_SIM_CONFIG, RAF_BATCH_THRESHOLD } from './simStore';

// 类型导出（供组件 / 测试使用）
export type { SimConfig, DiscoveredItem } from './simStore';
export type { OverlayFlags } from './overlayStore';
export type {
  ToolId,
  BrushPreset,
} from './toolStore';
export type { Command } from './historyStore';
export type { ValidateFilter } from './validateStore';
export type { ModalKey, ConfirmDialogState, ToastItem } from './uiStore';
