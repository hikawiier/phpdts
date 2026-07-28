/**
 * @module K 状态管理层
 */

export interface EnemyLocaleEntry {
  name: string;
  desc?: string;
}

export const ENEMY_LOCALE: Record<string, EnemyLocaleEntry> = {
  // ─── 浅水区敌人 ──────────────────────────────────────
  '1': { name: '废铁史莱姆', desc: '由废金属与污泥凝聚而成的小型生物，行动迟缓但攻击性明确。' },
  // ─── 深水区敌人 ──────────────────────────────────────
  '2': { name: '锈蚀守卫', desc: '遗骸化的旧时代守卫，残破装甲下仍保持攻击本能。' },
};

export function getEnemyName(enemyType: string | number, fallback?: string): string {
  const key = String(enemyType);
  return ENEMY_LOCALE[key]?.name ?? fallback ?? `enemy_${key}`;
}

export function getEnemyDesc(enemyType: string | number, fallback?: string): string {
  const key = String(enemyType);
  return ENEMY_LOCALE[key]?.desc ?? fallback ?? '';
}
