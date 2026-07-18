/**
 * @module K 状态管理层
 */

export interface ItemLocaleEntry {
  name: string;
  desc: string;
}

export const ITEM_LOCALE: Record<string, ItemLocaleEntry> = {
  rusty_pipe: { name: '生锈的水管', desc: '一根锈迹斑斑的铁管，握在手里沉甸甸的。' },
  scrap_blade: { name: '废铁刀', desc: '用废铁片磨出的粗糙刀刃，勉强能割开东西。' },
  nail_gun: { name: '钉枪', desc: '工地上常见的气动钉枪，近距离威力不小。' },
  pipe_bomb: { name: '管状炸弹', desc: '用铁管和火药自制的简易爆炸物，小心别炸到自己。' },
  throwing_spear: { name: '投矛', desc: '适合投掷的短矛，能在中距离刺穿敌人。' },
  swamp_spear: { name: '沼泽长矛', desc: '用沼泽硬木和骨片制成的长矛，尖端涂有毒素。' },
  ancient_core_blade: { name: '核心刃', desc: '嵌入古代核心的武器，刃身散发微弱的光辉。' },
  scrap_vest: { name: '废铁背心', desc: '用铁皮和铁丝拼凑的简易护甲，聊胜于无。' },
  swamp_cloak: { name: '沼泽斗篷', desc: '用沼泽藤蔓编织的斗篷，能抵御部分攻击。' },
  rust_circlet: { name: '锈蚀头环', desc: '锈蚀的金属头环，提供基本的头部防护。' },
  bone_amulet: { name: '骨制护符', desc: '用不明骨骼雕刻的护符，散发着诡异的气息。' },
  bread: { name: '面包', desc: '朴素的干面包，能快速补充生命。' },
  mineral_water: { name: '矿泉水', desc: '未开封的瓶装水，能恢复体力。' },
  scrap_metal: { name: '废铁片', desc: '锈迹斑斑的金属碎片，也许能派上用场。' },
  rusty_gear: { name: '生锈齿轮', desc: '废弃机械中拆下的齿轮，也许能合成什么。' },
  health_potion: { name: '生命药剂', desc: '注入了回复魔力的红色液体，饮用后恢复生命。' },
  stamina_potion: { name: '体力药剂', desc: '淡绿色的液体，饮用后恢复体力。' },
  supply_pack: { name: '补给包', desc: '简易的急救补给，可多次使用。' },
  antidote: { name: '解毒剂', desc: '能中和常见毒素的药剂，沼泽中不可或缺。' },
  swamp_herb: { name: '沼泽草药', desc: '沼泽中生长的草药，能恢复少量生命但有轻微毒性。' },
  ancient_core: { name: '古代核心', desc: '散发微光的神秘核心，蕴含未知的能量。' },
  rope_coil: { name: '绳索', desc: '一卷结实的绳索，在沼泽地带可能派上用场。' },
  compass: { name: '指南针', desc: '老旧但还能用的指南针，在迷雾中辨别方向。' },
  lockpick: { name: '开锁器', desc: '简易的开锁工具，也许能打开某些宝箱。' },
  element_pocket: { name: '元素口袋', desc: '能收纳元素之力的神秘口袋，元素大师专属道具。' },
  mystery_box: { name: '神秘礼盒', desc: '包装精美的礼盒，打开后才知道里面是什么。' },

  // ─── 道具系统扩展（主设计案 v6.2 §3.2）──────────────────
  // 基础素材
  cloth: { name: '布料', desc: '破损的织物碎片，易燃，也可用于包扎。' },
  blade_shard: { name: '刀片碎片', desc: '锋利的金属碎片，可以切割东西。' },
  circuit_board: { name: '电路板', desc: '从废弃电子设备上拆下的电路板，蕴含未知价值。' },
  crushed_can: { name: '踩瘪的铝罐', desc: '被踩扁的铝制易拉罐，敲平后可作金属外底。' },
  scrap_wire: { name: '废弃电线', desc: '一截绝缘层破损的电线，适合缠绕固定。' },
  cabin_sponge: { name: '废舱海绵', desc: '从废弃舱室拆下的海绵块，可作鞋内垫。' },

  // 食物（可使用）
  rabbit_meat_raw: { name: '生兔肉', desc: '刚猎获的兔肉，生吃可能获得抗性，但有风险。' },
  roasted_rabbit: { name: '烤兔肉', desc: '用火烤过的兔肉，香气四溢，恢复体力。' },
  bandage: { name: '绷带', desc: '干净的布条绷带，能包扎伤口解除不良状态。' },
  simple_stew: { name: '简易炖菜', desc: '用锅炖煮的杂烩汤，营养丰富。' },

  // 装备产物
  thick_shoes: { name: '流浪汉厚底鞋', desc: '用废料拼凑的厚底鞋，保护双脚免受沼泽侵蚀。' },
  blade_wrapped: { name: '布包刀刃', desc: '用布条缠绕刀片制成的简易刀具，握感更稳。' },

  // 工具/工作台道具
  frying_pan: { name: '煎锅', desc: '铁匠锻造的平底锅，可以用来烹饪食物。' },
  precision_stove: { name: '精密炉灶', desc: '精密制造的炉灶，控温精准，能烹饪高级料理。' },
  forge_t1: { name: '铁砧', desc: '废弃的锻造铁砧，可以用来锻打金属。' },
  stove_t1: { name: '排风口火炉', desc: '废弃排风口改造成的火炉，能提供基础烹饪火源。' },
  stove_t2: { name: '精密炉灶', desc: '工厂级的精密炉灶，控温精准。' },

  // 虚拟素材（被动技能）
  innate_craft_t0: { name: '徒手合成', desc: '玩家自带的基础合成能力，无需任何工具。' },

  // ─── 道具素材扩展（附录A：搜索建筑物与掉落机制重构）──────────
  // 来源：oblivions/docs/原始方案/items.json（外部参考，已剔除容器/剧情/GUI）
  // 详见：oblivions/docs/搜索建筑物与掉落机制重构-附录A-道具素材扩展.md

  // 近战武器（WP 钝器 / WK 刃具）
  glass_knife: { name: '玻璃小刀', desc: '锐利但脆弱的玻璃刃具，需要小心使用。' },
  wooden_club: { name: '木棒', desc: '结实的木制棍棒，可燃，基础钝器。' },
  kitchen_knife: { name: '菜刀', desc: '常见的厨房菜刀，刃口仍算锋利。' },
  crowbar: { name: '撬棍', desc: '沉重的金属撬棍，既能撬门也能砸头。' },
  sharpened_spear: { name: '尖锐长矛', desc: '用木柄和刃片制成的长矛，带穿刺能力。' },
  broad_spear: { name: '宽幅长矛', desc: '双刃长矛，伤害更高，需要更高强度材料制作。' },
  multitool_knife: { name: '多功能小刀', desc: '含螺丝刀、钳、线切等多种工具的小刀，工具与武器兼备。' },
  wooden_splint: { name: '自制夹板', desc: '简易木制夹板，可作应急钝器或医疗夹板素材。' },

  // 远程武器（WG 枪械 / 弓）
  self_bow: { name: '自制弓', desc: '木制简易弓，张力一般但足以狩猎。' },
  compound_bow: { name: '复合弓', desc: '滑轮组的高张力弓，威力与精度兼备。' },
  sling: { name: '弹弓', desc: '入门级远程武器，配合石子使用。' },
  revolver: { name: '左轮手枪', desc: '经典的左轮手枪，威力不俗但沉重。' },
  hunting_rifle: { name: '狩猎步枪', desc: '大口径猎枪，远程精准，是顶级狩猎武器。' },

  // 投掷武器（WC）
  stone_pebble: { name: '石子', desc: '基础投掷弹药，圆润光滑，可堆叠。' },
  rock: { name: '石头', desc: '较重的投掷物，砸击力强但射程有限。' },
  hunting_arrow: { name: '狩猎箭', desc: '弓箭弹药，金属箭头锐利，也可作投掷。' },

  // 护甲（AR）
  tactical_vest: { name: '战术防弹背心', desc: '高强度纤维与陶瓷板组合的战术背心。' },
  beast_hide_coat: { name: '兽皮大衣', desc: '厚重兽皮缝制的大衣，保暖与防护兼备。' },
  scrap_metal_raincoat: { name: '金属薄片雨衣', desc: '用废金属片拼凑的防水雨衣。' },

  // 头具（AH）
  tactical_helmet: { name: '战术头盔', desc: '军用级防弹头盔，能抵御流弹。' },
  gas_mask: { name: '防毒面具', desc: 'XM54 防毒面具，可在 NBC 环境下使用。' },
  assassin_hood: { name: '兜帽', desc: '黑色兜帽，提供隐蔽加成。' },
  night_vision_goggles: { name: '夜视镜', desc: '夜间视野加成装备，稀有军用科技。' },

  // 足具（AF）
  cloth_shoes: { name: '布鞋', desc: '简易布制鞋，轻便但保护性差。' },
  sneakers: { name: '跑鞋', desc: '运动鞋，提供移动速度加成。' },
  combat_boots: { name: '战靴', desc: '军用战靴，厚重但能保护脚踝。' },

  // 配件（AA）
  bronze_amulet: { name: '古铜护身符', desc: '古朴的青铜护身符，散发着神秘气息。' },
  binoculars: { name: '双筒望远镜', desc: '可放大远处视野的望远镜，狩猎与侦察必备。' },
  rifle_scope: { name: '步枪瞄准镜', desc: '步枪专用瞄准镜，提升远程精度。' },
  tactical_gloves: { name: '战术手套', desc: '耐磨战术手套，提升抓握与操控。' },

  // 材料（MT）
  dirty_rag: { name: '脏布头', desc: '污浊的布片，可燃，清洗后可变为干净布料。' },
  clean_cloth: { name: '干净布料', desc: '洁净的布料，可燃，医疗与缝合用途。' },
  tarpaulin: { name: '油布', desc: '防水油布，可制作雨具或临时棚屋。' },
  tree_branch: { name: '树枝', desc: '可燃的树枝，制棒、制矛的基础原料。' },
  aa_battery: { name: 'AA 电池', desc: '通用电池，导体，可为电子设备供电。' },
  laptop_battery: { name: '笔记本电池', desc: '大容量电池，可为高能耗设备供电。' },
  glass_shard: { name: '玻璃碎片', desc: '锋利的玻璃片，可作刃具素材。' },
  plastic_shard: { name: '塑料碎片', desc: '塑料碎片，可加工成各类构件。' },
  small_parts: { name: '杂乱小零件', desc: '机械拆解得到的小零件，可组装工具。' },
  wooden_stock: { name: '木制枪托', desc: '木制枪托素材，可作长柄或枪械配件。' },
  rifle_barrel: { name: '枪管', desc: '枪械核心部件，沉重且耐高压。' },
  animal_pelt: { name: '小型动物毛皮', desc: '小型动物的毛皮，可缝制衣物。' },
  old_newspaper: { name: '旧报纸', desc: '泛黄的旧报纸，易燃，可作引火物。' },

  // 恢复品（HH 食物）
  soda_crackers: { name: '苏打饼干', desc: '干粮饼干，能少量恢复生命。' },
  wild_mushroom: { name: '蘑菇', desc: '野生蘑菇，生食可恢复体力。' },
  raw_meat_chunk: { name: '生肉块', desc: '生肉，需烹饪后食用更安全，生食有风险。' },
  cooked_meat_chunk: { name: '熟肉块', desc: '烹饪过的肉块，恢复生命值。' },
  cured_meat: { name: '熏制肉干', desc: '熏制长保质期肉干，远行干粮。' },
  berries: { name: '浆果', desc: '野生小果实，可恢复少量体力。' },
  concentrated_soup: { name: '浓缩汤', desc: '罐装浓缩汤，恢复大量生命。' },

  // 状态品（HS 饮料）
  cola: { name: '可乐', desc: '含糖碳酸饮料，能快速恢复体力。' },
  whiskey: { name: '威士忌', desc: '烈酒，可消毒伤口或治愈不良状态。' },
  herbal_tea: { name: '草本茶', desc: '草本冲泡的茶饮，恢复体力并舒缓身体。' },

  // 药物（DX）
  orange_pill: { name: '橙色药片', desc: '强效治疗药，少量即可恢复生命。' },
  painkiller: { name: '止痛药', desc: '非处方止痛药，缓解不良状态。' },
  white_pill: { name: '白色药片', desc: '基础治疗药，恢复少量生命。' },
  nano_medkit: { name: '纳米医疗包', desc: '顶级纳米机器人医疗包，能快速愈合重伤。' },

  // 工具（TK）
  flashlight: { name: '手电筒', desc: '便携照明工具，搜刮黑暗场所必备。' },
  lighter: { name: '打火机', desc: '生火工具，可点燃可燃物。' },
  lockpick_set: { name: '撬锁器', desc: '专业撬锁工具，比简易开锁器更耐用。' },
  torch_unlit: { name: '未点燃火把', desc: '粗制火把，可点燃后照明，也可燃。' },
  water_tester: { name: '水质检测器', desc: '检测水源污染程度的便携工具。' },

  // ─── F-7 玩家放置 POI 道具 ──────────────────────────
  // 木柴：use_effect=place_poi，itmpara='poi_id:campfire_unlit'
  // 通过合成 craft_firewood（tree_branch × 2 → firewood × 1）获得
  firewood: { name: '木柴', desc: '一捆干柴，可以使用放置未点燃的火堆。' },
};

export function getItemName(itemId: string | number | undefined, customName?: string): string {
  const name = customName?.trim();
  if (name) return name;
  if (itemId === undefined || itemId === null || itemId === '') return '';
  const key = String(itemId);
  return ITEM_LOCALE[key]?.name || key;
}

export function getItemDesc(itemId: string | number | undefined): string {
  if (itemId === undefined || itemId === null || itemId === '') return '';
  return ITEM_LOCALE[String(itemId)]?.desc || '';
}

/**
 * 判断 itms 是否为无限标识
 *
 * 无限标识统一为字符串 '∞'。
 * 数量模型表示无限数量，耐久模型表示无限耐久。
 */
export function isInfinite(itms: string | number | undefined | null): boolean {
  return String(itms ?? '') === '∞';
}
