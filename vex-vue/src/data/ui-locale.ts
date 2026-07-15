/**
 * @module K 状态管理层
 */
// ══════════════════════════════════════════════════
// UI 文本中文化字典
//
// 将硬编码英文 UI 文本降格为 key，通过字典查询中文。
// 复用现有 *-locale.ts（item/tag/status/poi/recipe/itmk）的既有模式，
// 不引入 vue-i18n 框架。
//
// 资源缩写（HP/SP/AP/LV）保留 ASCII 终端风格——约定俗成的游戏术语
// 缩写中文化反而破坏终端风格。将其纳入字典仅为统一查询入口，
// value 与 key 相同。
// ══════════════════════════════════════════════════

export const UI_TEXT = {
  // ASCII 区块标题
  CARTOGRAPHY: '地图',
  CHRONICLE: '战报',
  ACTIONS: '动作',
  COMBAT: '战斗',
  INVENTORY: '背包',
  ARMAMENT: '装备',
  SURVIVOR: '幸存者',
  // PlayerDrawer 区段标题
  VITALITY: '生命',
  STAMINA: '体力',
  ACTION_POINTS: '行动点',
  EXPERIENCE: '经验',
  STATUS_EFFECTS: '状态效果',
  PROFILE: '档案',
  // PlayerDrawer 行内标识
  ATK: '攻击',
  DEF: '防御',
  KILLS: '击杀',
  POS: '位置',
  STATE: '状态',
  NAME: '名字',
  // MapContainer 行内标识
  LOC: '位置',
  REGION: '区域',
  // 状态
  LOADING: '加载中...',
  // 资源缩写（保留 ASCII 终端风格，value 同 key 便于统一管理）
  HP: 'HP',
  SP: 'SP',
  AP: 'AP',
  LV: 'LV',
} as const;

export type UiTextKey = keyof typeof UI_TEXT;

/** 查询 UI 文本；未命中时返回 key 本身（便于反查缺失项） */
export function getUiText(key: UiTextKey): string {
  return UI_TEXT[key] ?? key;
}
