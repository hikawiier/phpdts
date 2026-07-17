/**
 * @module K 状态管理层
 */

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

  // ─── 内容扩充（任务3）── 基础配方
  craft_torch_unlit: { name: '未点燃火把', desc: '用树枝和脏布头捆扎成火把。' },
  craft_lockpick_set: { name: '撬锁器', desc: '用废铁片和生锈齿轮组装出专业撬锁工具。' },
  craft_tarpaulin: { name: '油布', desc: '用布料和绳索缝制出防水油布。' },
  craft_cloth_shoes: { name: '布鞋', desc: '用布料和脏布头缝出轻便布鞋。' },
  craft_assassin_hood: { name: '兜帽', desc: '用布料和脏布头裁剪出隐蔽兜帽。' },
  craft_glass_knife: { name: '玻璃小刀', desc: '用玻璃碎片和布料缠出锐利小刀。' },
  craft_wooden_club: { name: '木棒', desc: '用树枝和绳索捆成结实木棒。' },
  craft_wooden_splint: { name: '自制夹板', desc: '用树枝和布料缠出应急夹板。' },
  craft_sling: { name: '弹弓', desc: '用树枝、毛皮和绳索制作弹弓。' },
  craft_kitchen_knife: { name: '菜刀', desc: '用刀片碎片和木枪托拼出菜刀。' },
  craft_crowbar: { name: '撬棍', desc: '用废铁片和生锈齿轮锻造撬棍。' },
  craft_self_bow: { name: '自制弓', desc: '用木枪托、树枝和绳索制作简易弓。' },
  craft_hunting_arrow_bunch: { name: '狩猎箭束', desc: '用树枝和刀片碎片削出三支狩猎箭。' },
  craft_throwing_spear: { name: '投矛', desc: '用木枪托、刀片碎片和绳索制作投矛。' },
  craft_binoculars: { name: '双筒望远镜', desc: '用电路板、塑料碎片和小零件组装望远镜。' },

  // ─── 内容扩充（任务3）── 需烹饪工作台的配方
  craft_cooked_meat_chunk: { name: '熟肉块', desc: '在烹饪台上把生肉块烤熟。' },
  craft_cured_meat: { name: '熏制肉干', desc: '用烹饪台和旧报纸把熟肉熏制成肉干。' },
  craft_concentrated_soup: { name: '浓缩汤', desc: '用烹饪台把熟肉、草药和矿泉水熬成浓汤。' },

  // ─── 内容扩充（任务4）── 中阶近战武器
  craft_sharpened_spear: { name: '尖锐长矛', desc: '用木枪托、刀片碎片和绳索制作尖锐长矛。' },
  craft_broad_spear: { name: '宽幅长矛', desc: '用木枪托、刀片碎片和布料制作宽幅长矛。' },

  // ─── 内容扩充（任务4）── 中阶远程武器
  craft_compound_bow: { name: '复合弓', desc: '用木枪托、绳索、齿轮和电线制作复合弓。' },

  // ─── 内容扩充（任务4）── 中阶防具
  craft_beast_hide_coat: { name: '兽皮大衣', desc: '用锐器裁割毛皮和绳索缝制兽皮大衣。' },
  craft_scrap_metal_raincoat: { name: '金属薄片雨衣', desc: '用废铁片、油布和电线拼出金属雨衣。' },
  craft_tactical_vest: { name: '战术防弹背心', desc: '用废铁片、布料、小零件和电线组装战术背心。' },
  craft_combat_boots: { name: '战靴', desc: '用毛皮、废铁片和绳索缝制战靴。' },
  craft_tactical_gloves: { name: '战术手套', desc: '用布料、毛皮和电线缝制战术手套。' },

  // ─── 内容扩充（任务4）── 中阶工具/工作台
  craft_flashlight: { name: '手电筒', desc: '用电路板、电池、塑料碎片和小零件组装手电筒。' },
  craft_lighter: { name: '打火机', desc: '用废铁片、小零件和电池制作打火机。' },

  // ─── 内容扩充（任务4）── 布料精炼
  craft_clean_cloth_boil: { name: '煮沸清洁布料', desc: '在烹饪台上用矿泉水煮沸消毒脏布头。' },
  craft_clean_cloth_disinfect: { name: '酒精消毒布料', desc: '用威士忌消毒脏布头得到干净布料。' },

  // ─── 内容扩充（任务4）── 烹饪配方扩展
  craft_cooked_mushroom: { name: '蘑菇炖菜', desc: '在烹饪台上把蘑菇炖成简易炖菜。' },
  craft_wild_stew: { name: '野味炖汤', desc: '在烹饪台上用生肉、蘑菇和浆果炖出浓缩汤。' },
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
