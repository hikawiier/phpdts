// ══════════════════════════════════════════════════
// itmk 道具类别代码 → 中文类别名映射
//
// 数据来源：oblivions/gamedata/item_table.php 中使用的 itmk 代码
// 中文命名参考旧模式 gamedata/ruleset/YELLOWKNIFE/cache/resources_1.php
// Oblivions 新增的 itmk（AR/AH/AA/AF/MT/DX/TK/SP）为自定义中文名
// ══════════════════════════════════════════════════

export const ITMK_LOCALE: Record<string, string> = {
  // 武器
  WP: '钝器',
  WK: '锐器',
  WG: '远程兵器',
  WD: '爆炸物',
  WF: '灵力兵器',
  // 防具
  AR: '身体护甲',
  AH: '头部护甲',
  AA: '饰品',
  AF: '足部护甲',
  // 消耗品
  HH: '生命恢复',
  HS: '体力恢复',
  DX: '解毒剂',
  // 素材/工具
  MT: '素材',
  TK: '工具',
  SP: '特殊道具',
};

/**
 * 获取 itmk 对应的中文类别名
 * @param itmk 道具类别代码（如 'HH'、'WK'）
 * @returns 中文类别名，未知代码原样返回，空值返回空字符串
 */
export function getItmkName(itmk: string | undefined | null): string {
  if (!itmk) return '';
  return ITMK_LOCALE[itmk] ?? itmk;
}
