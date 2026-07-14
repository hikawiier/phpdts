/**
 * @module K 状态管理层
 */

// ══════════════════════════════════════════════════
// Oblivions 地形描述词库 / Oblivions terrain description lexicon
//
// 从后端 oblivions/gamedata/terrain_desc.php 迁移。
// 无名地块根据 floor/tide/passable 属性随机生成描述文本。
// 视觉呈现完全由前端负责，后端只传原始属性参数。
// ══════════════════════════════════════════════════

/** 地面类型 */
export type FloorType = 'standard' | 'metal' | 'water' | 'vegetation';

/** 潮汐/深度类型 */
export type TideType = 'shallow' | 'deep' | 'abyss';

/** 地面类型词库配置 */
export interface FloorConfig {
  /** 地形名称候选（名词） */
  name: string[];
  /** 形容词修饰候选 */
  adj: string[];
}

/** 完整的地形描述词库 */
export interface TerrainDescConfig {
  floor: Record<FloorType, FloorConfig>;
  tide: Record<TideType, string[]>;
  impassable_suffix: string[];
  templates: {
    default: string[];
    no_tide: string[];
  };
}

/** 地形描述词库（与现有 vex/data/terrain-desc.js 一致） */
export const TERRAIN_DESC: TerrainDescConfig = {
  // ─── 地面类型 / Floor ────────────────────────────────
  // name: 地形名称候选（名词），adj: 形容词修饰候选
  floor: {
    standard: {
      name: ['荒地', '空地', '平地', '碎石地'],
      adj: ['荒芜的', '空旷的', '干裂的', '布满灰尘的'],
    },
    metal: {
      name: ['废铁地', '金属地', '铁皮地', '锈蚀地'],
      adj: ['金属覆盖的', '锈迹斑斑的', '铁皮铺就的', '残骸堆积的'],
    },
    water: {
      name: ['湿地', '水洼地', '泥潭', '浅滩'],
      adj: ['泥泞的', '潮湿的', '积水覆盖的', '黏腻的'],
    },
    vegetation: {
      name: ['灌木丛', '草丛', '荆棘地', '枯枝地'],
      adj: ['杂草丛生的', '藤蔓缠绕的', '枯枝遍地的', '荆棘密布的'],
    },
  },

  // ─── 潮汐/深度 / Tide ────────────────────────────────
  // 叠加在 floor 之上的修饰前缀，空字符串表示无修饰
  tide: {
    shallow: [''],
    deep: ['深', '幽深的', '没过膝盖的'],
    abyss: ['深渊般的', '深不见底的', '令人窒息的'],
  },

  // ─── 不可通行修饰 / Impassable ───────────────────────
  // passable=false 时随机追加的后缀描述
  impassable_suffix: ['，无法通行', '，挡住了去路', '，无法通过'],

  // ─── 描述模板 / Templates ─────────────────────────────
  // {tide_adj}  — 潮汐修饰词
  // {floor_adj} — 地面修饰词
  // {floor_name} — 地形名称
  // 有潮汐修饰时随机选一个，无潮汐修饰时随机选一个
  templates: {
    default: [
      '一片{tide_adj}{floor_adj}{floor_name}',
      '{tide_adj}{floor_adj}{floor_name}',
      '一处{tide_adj}{floor_adj}{floor_name}',
    ],
    no_tide: [
      '一片{floor_adj}{floor_name}',
      '{floor_adj}{floor_name}',
      '一处{floor_adj}{floor_name}',
    ],
  },
};

/** 从数组中随机取一个元素 */
function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * 生成无名地块的随机描述
 *
 * @param floor    地面类型（standard/metal/water/vegetation）
 * @param tide     潮汐类型（shallow/deep/abyss）
 * @param passable 是否可通行
 * @returns 描述文本
 */
export function generateTerrainDesc(
  floor: string,
  tide: string,
  passable: boolean,
): string {
  const floorCfg =
    TERRAIN_DESC.floor[floor as FloorType] || TERRAIN_DESC.floor.standard;
  const floorName = pickRandom(floorCfg.name);
  const floorAdj = pickRandom(floorCfg.adj);

  const tidePool = TERRAIN_DESC.tide[tide as TideType] || [''];
  const tideAdj = pickRandom(tidePool);

  let text: string;
  if (tideAdj) {
    const tpl = pickRandom(TERRAIN_DESC.templates.default);
    text = tpl
      .replace('{tide_adj}', tideAdj)
      .replace('{floor_adj}', floorAdj)
      .replace('{floor_name}', floorName);
  } else {
    const tpl = pickRandom(TERRAIN_DESC.templates.no_tide);
    text = tpl
      .replace('{floor_adj}', floorAdj)
      .replace('{floor_name}', floorName);
  }

  if (!passable) {
    text += pickRandom(TERRAIN_DESC.impassable_suffix);
  }

  return text;
}
