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
