/**
 * @module K 状态管理层
 */

export interface PoiLocaleEntry {
  name: string;
  desc: string;
}

export const POI_LOCALE: Record<string, PoiLocaleEntry> = {
  supply_cache: { name: '补给储藏箱', desc: '一个被铁皮加固的木箱，里面可能还有能用的物资。' },
  scrap_pile: { name: '废料堆', desc: '堆积着各种金属废料，翻翻看也许能找到什么。' },
  landmark: { name: '地标', desc: '醒目的地标建筑，可以作为导航参考。' },
  danger_chest: { name: '危险宝箱', desc: '散发着不祥气息的金属箱，里面也许有值钱的东西。' },
  swamp_spring: { name: '沼泽泉眼', desc: '从地下涌出的清澈泉水，在污浊的沼泽中格外珍贵。' },
  life_totem: { name: '生命图腾', desc: '刻满符文的石柱，触碰后感到一股暖流涌入体内。' },
  ancient_relic: { name: '古代遗物', desc: '半埋在泥土中的古代装置，核心似乎还在运转。' },
  skill_totem: { name: '技能图腾', desc: '散发着神秘光芒的古老石碑，似乎能传授某种能力。' },

  // 工作台 POI（mechanic='craft_source'）
  forge_anvil_poi: { name: '铁砧', desc: '废弃的锻造铁砧，可以用来锻打金属制品。' },
  vent_stove: { name: '排风口火炉', desc: '废弃排风口改造成的火炉，能提供基础烹饪火源。' },
  precision_stove_poi: { name: '精密炉灶', desc: '工厂遗留的精密炉灶，控温精准，能烹饪高级料理。' },

  // ─── 内容扩充（任务3）── 浅水区 POI
  weapon_locker: { name: '武器柜', desc: '锈迹斑斑的金属柜，门虚掩着，里面应该有武器或弹药。' },
  tool_cabinet: { name: '工具间', desc: '堆满杂物的小工作间，墙上挂着各种工具。' },
  abandoned_kitchen: { name: '废弃厨房', desc: '满是油垢的厨房，炉灶上还摆着变质的食材。' },

  // ─── 内容扩充（任务3）── 深水区 POI
  abandoned_library: { name: '废弃图书馆', desc: '倒塌的书架散落着泛黄的纸张，知识在此长眠。' },
  mechanic_workshop: { name: '机械间', desc: '满是油污的车间，机械残骸堆积如山。' },
  pharmacy: { name: '药房', desc: '药品柜倾倒在地，散落着各色药瓶，空气中弥漫着消毒水味。' },
  hunter_cache: { name: '猎人储藏', desc: '藏在岩缝中的猎人物资，用油布仔细包裹着。' },

  // ─── 内容扩充（任务3）── 深渊区 POI
  mystic_shrine: { name: '神秘祭坛', desc: '石砌祭坛上凝结着古老的血迹，周围散发着令人不安的气息。' },

  // ─── 内容扩充（任务4）── 浅水区新增 POI
  abandoned_house: { name: '废弃住宅', desc: '坍塌了一半的木屋，里面散落着家居杂物和旧衣物。' },
  clothing_store: { name: '服装店', desc: '橱窗破碎的服装店，模特倒在地上，衣架上还有几件衣物。' },
  vehicle_wreck: { name: '汽车残骸', desc: '锈蚀变形的汽车残骸，车门半开，仪表盘还亮着微光。' },

  // ─── 内容扩充（任务4）── 深水区新增 POI
  office_building: { name: '废弃办公楼', desc: '玻璃幕墙破碎的办公楼，文件柜倾倒，电脑屏闪烁杂讯。' },
  forest_cabin: { name: '林中小屋', desc: '苔藓覆盖的木屋，烟囱歪斜，门口散落着猎具碎片。' },
  campfire_site: { name: '营火点', desc: '石块围拢的旧营火堆，灰烬中还埋着未燃尽的柴火。' },
  herb_garden: { name: '草药园', desc: '荒废的药草园，野生的草药与浆果丛在角落里蔓延。' },
};

export function getPoiName(poiId: string | number | undefined, fallbackName?: string): string {
  if (poiId === undefined || poiId === null || poiId === '') return fallbackName || '';
  const key = String(poiId);
  return POI_LOCALE[key]?.name || fallbackName || key;
}

export function getPoiDesc(poiId: string | number | undefined, fallbackDesc?: string): string {
  if (poiId === undefined || poiId === null || poiId === '') return fallbackDesc || '';
  return POI_LOCALE[String(poiId)]?.desc || fallbackDesc || '';
}
