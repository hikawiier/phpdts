// ══════════════════════════════════════════════════
// tag 道具标签 → 中文名映射
//
// 数据来源：oblivions/gamedata/item_table.php 中使用的 tag
// ══════════════════════════════════════════════════

export const TAG_LOCALE: Record<string, string> = {
  tag_combustible: '可燃物',
  tag_tool_cooking: '烹饪工具',
  tag_raw_food: '生食',
  tag_sharp: '锐器',
  tag_forge: '锻造台',
  tag_equippable: '可装备',
  tag_usable: '可使用',
  tag_weapon_throwing: '投掷武器',
};

/**
 * 获取 tag 对应的中文名
 * @param tag 标签代码（如 'tag_tool_cooking'）
 * @returns 中文名，未知标签原样返回，空值返回空字符串
 */
export function getTagName(tag: string | undefined | null): string {
  if (!tag) return '';
  return TAG_LOCALE[tag] ?? tag;
}
