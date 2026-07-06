export interface RecipeLocaleEntry {
  name: string;
  desc: string;
}

export const RECIPE_LOCALE: Record<string, RecipeLocaleEntry> = {
  // 基础配方
  craft_bandage: { name: '绷带', desc: '用三块布料包扎成急救绷带。' },
  craft_thick_shoes: { name: '流浪汉厚底鞋', desc: '用铝罐、电线和海绵拼凑出能穿的鞋子。' },
  craft_roasted_rabbit: { name: '烤兔肉', desc: '用可燃物生火把生兔肉烤熟。' },

  // 需工作台素材的配方
  craft_frying_pan: { name: '煎锅', desc: '在铁砧上锻打金属废料制成煎锅。' },
  craft_dismantle_pan: { name: '分解煎锅', desc: '将煎锅拆解回金属废料。' },
  craft_simple_stew: { name: '简易炖菜', desc: '用烹饪工具将烤兔肉和生食材炖成一锅杂烩。' },
  craft_blade_wrapped: { name: '布包刀刃', desc: '用布条缠绕锐器制成握感更稳的刀具。' },

  // 高级配方
  craft_precision_stove: { name: '精密炉灶', desc: '在高级烹饪台上用金属、电路板和齿轮组装出精密炉灶。' },
};

export function getRecipeName(recipeId: string | number | undefined, fallbackName?: string): string {
  if (recipeId === undefined || recipeId === null || recipeId === '') return fallbackName || '';
  const key = String(recipeId);
  return RECIPE_LOCALE[key]?.name || fallbackName || key;
}

export function getRecipeDesc(recipeId: string | number | undefined, fallbackDesc?: string): string {
  if (recipeId === undefined || recipeId === null || recipeId === '') return fallbackDesc || '';
  return RECIPE_LOCALE[String(recipeId)]?.desc || fallbackDesc || '';
}

// ── 配方分类本地化 ──────────────────────────────

export const RECIPE_CATEGORY_LABELS: Record<string, string> = {
  food: '食物',
  tool: '工具',
  armor: '护甲',
  weapon: '武器',
};

export function getCategoryLabel(category: string | undefined): string {
  if (!category) return '其他';
  return RECIPE_CATEGORY_LABELS[category] || category;
}
