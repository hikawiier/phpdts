// ══════════════════════════════════════════════════
// 格式化工具函数
//
// 替代现有 vex/js/utils.js 的 escapeHtml / getPlaceName / getGenderText。
// ══════════════════════════════════════════════════

import { useMapStore } from '@/stores/map';

/** 性别映射（与现有 data.js GENDER_NAMES 一致） */
const GENDER_NAMES: Record<string, string> = {
  '0': '未定',
  m: '男生',
  f: '女生',
  n: '投影',
};

/** HTML 转义（防 XSS） */
export function escapeHtml(str: unknown): string {
  if (typeof str !== 'string') str = String(str);
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(str as string));
  return div.innerHTML;
}

/**
 * 获取位置名称（从 mapStore.links.tiles 读取）
 * 与现有 utils.js getPlaceName 一致：找不到时返回 "位置{pls}"
 */
export function getPlaceName(pls: string | number | null | undefined): string {
  if (pls === null || pls === undefined) return 'unknown';
  const mapStore = useMapStore();
  if (mapStore.links && mapStore.curRegion !== null) {
    const tiles = mapStore.links.tiles[String(mapStore.curRegion)];
    if (tiles && tiles[String(pls)] && tiles[String(pls)].name) {
      return String(tiles[String(pls)].name);
    }
  }
  return '位置' + pls;
}

/** 性别文字 */
export function getGenderText(g: string | undefined | null): string {
  if (!g) return '未知';
  return GENDER_NAMES[g] || '未知';
}

/**
 * 判断值是否为"空"（falsy 语义）
 * 与现有 vex/js/utils.js isFalsy 一致
 * 兼容 passable 字段可能为 true/1/''/false/0 等多种类型
 */
export function isFalsy(v: unknown): boolean {
  return v === undefined || v === null || v === '' || v === 0 || v === false;
}
