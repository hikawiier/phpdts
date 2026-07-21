//
// 配置文件 round-trip 集成测试（对齐 NEW_DESIGN.md §7.3 M5 + §3.4.4 单向数据流）
//
// 验证：PHP 解析 → 强类型归一化 → CRUD 编辑 → 反向 codegen → 重新解析后数据一致
//
// 覆盖点：
//   - 完整 PHP 文件集合（scatter_pool + poi_table + poi_pool）→ loadFromPhpStrings
//   - 无修改 round-trip：toPhpFiles → 重新 loadFromPhpStrings 后数据 deep equal
//   - CRUD 修改后 round-trip：修改后 toPhpFiles → 重新 loadFromPhpStrings 数据一致
//   - count 范围数组 [min, max] round-trip 保留
//   - poi_table 部分字段（landmark 无 E-10）round-trip 保留
//   - obl_config 不参与 toPhpFiles 导出（边界案例）
//   - mechanic_params JSON 字符串字段 round-trip 保留原结构

import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useConfigStore } from '@/stores/configStore';
import type {
  ScatterPool,
  PoiTable,
  PoiPool,
} from '@/shared';

// ─── 完整 PHP 文件集合（覆盖所有字段类型） ─────────────
function makeFullScatterPhp(): string {
  return `<?php
if (!defined('IN_GAME')) { exit('Access Denied'); }
return [
    'shallow' => [
        'initial' => [
            ['item_id' => 'scrap_metal', 'count' => [1,3], 'rate' => 0.60],
            ['item_id' => 'rusty_gear',  'count' => 1,     'rate' => 0.30],
        ],
        'refresh' => [
            ['item_id' => 'scrap_metal', 'count' => 1, 'rate' => 0.25],
        ],
    ],
    'deep' => [
        'initial' => [
            ['item_id' => 'swamp_herb', 'count' => [1,2], 'rate' => 0.40],
        ],
        'refresh' => [],
    ],
    'abyss' => [
        'initial' => [
            ['item_id' => 'ancient_core', 'count' => 1, 'rate' => 0.05],
        ],
        'refresh' => [],
    ],
];`;
}

function makeFullPoiTablePhp(): string {
  return `<?php
return [
    'supply_cache' => [
        'name' => '补给储藏箱',
        'desc' => '一个被铁皮加固的木箱',
        'searchable' => true,
        'repeatable' => false,
        'base_loot_chance' => 0.7,
        'base_good_event_chance' => 0.1,
        'base_bad_event_chance' => 0.1,
        'loot_table_id' => 'supply_cache_loot',
        'event_pool' => [
            ['event_id' => 'find_extra_cache', 'weight' => 30, 'kind' => 'good'],
            ['event_id' => 'trap_trigger', 'weight' => 35, 'kind' => 'bad'],
        ],
        'prob_mods_source' => ['lockpick'],
        'loot_table_overrides' => [
            'lockpick' => 'supply_cache_loot',
        ],
    ],
    'landmark' => [
        'name' => '地标',
        'searchable' => false,
        'repeatable' => false,
    ],
    'forge_anvil_poi' => [
        'searchable' => false,
        'repeatable' => false,
        'mechanic' => 'craft_source',
        'mechanic_value' => 'forge_t1',
        'mechanic_params' => ['passive', 'strategy'],
    ],
];`;
}

function makeFullPoiPoolPhp(): string {
  return `<?php
return [
    'shallow' => [
        ['poi_id' => 'supply_cache', 'per_region' => 2],
        ['poi_id' => 'landmark', 'per_region' => 1],
    ],
    'deep' => [],
    'abyss' => [],
];`;
}

function makeOblConfigPhp(): string {
  return `<?php
return [
    'wild_item_refresh_rate_by_tide' => [
        'shallow' => 0.5,
        'deep' => 1.0,
        'abyss' => 1.5,
    ],
    'max_wild_items_per_tile' => 3,
    'enable_poi_ttl' => true,
];`;
}

describe('配置 round-trip 集成测试', () => {
  let config: ReturnType<typeof useConfigStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    config = useConfigStore();
  });

  // ─── 工具：深拷贝当前 store 状态 ───────────────────
  function snapshotState(): {
    scatterPool: ScatterPool | null;
    poiTable: PoiTable | null;
    poiPool: PoiPool | null;
  } {
    return {
      scatterPool: JSON.parse(JSON.stringify(config.scatterPool)),
      poiTable: JSON.parse(JSON.stringify(config.poiTable)),
      poiPool: JSON.parse(JSON.stringify(config.poiPool)),
    };
  }

  // ─── 1. 无修改 round-trip ────────────────────────────
  it('PHP → 解析 → toPhpFiles → 重新解析后数据 deep equal', () => {
    // 第一次加载
    const loadResult = config.loadFromPhpStrings({
      'scatter_pool.php': makeFullScatterPhp(),
      'poi_table.php': makeFullPoiTablePhp(),
      'poi_pool.php': makeFullPoiPoolPhp(),
    });
    expect(loadResult.ok).toBe(true);
    const snapshot1 = snapshotState();

    // 导出 PHP 文件
    const files = config.toPhpFiles();
    expect(Object.keys(files)).toContain('scatter_pool.php');
    expect(Object.keys(files)).toContain('poi_table.php');
    expect(Object.keys(files)).toContain('poi_pool.php');

    // 重置后用导出的文件重新加载
    config.reset();
    const reloadResult = config.loadFromPhpStrings(files);
    expect(reloadResult.ok).toBe(true);
    const snapshot2 = snapshotState();

    // deep equal 验证 round-trip 一致性
    expect(snapshot2.scatterPool).toEqual(snapshot1.scatterPool);
    expect(snapshot2.poiTable).toEqual(snapshot1.poiTable);
    expect(snapshot2.poiPool).toEqual(snapshot1.poiPool);
  });

  // ─── 2. CRUD 修改后 round-trip ──────────────────────
  it('CRUD 修改后 → toPhpFiles → 重新解析后数据 deep equal', () => {
    config.loadFromPhpStrings({
      'scatter_pool.php': makeFullScatterPhp(),
      'poi_table.php': makeFullPoiTablePhp(),
      'poi_pool.php': makeFullPoiPoolPhp(),
    });

    // CRUD 操作：
    // 1. 修改 scatter shallow.initial[0] 的 rate
    config.updateScatterEntry('shallow', 'initial', 0, { rate: 0.99 });
    // 2. 新增 scatter 条目
    config.addScatterEntry('deep', 'refresh', {
      item_id: 'new_item',
      count: [2, 4],
      rate: 0.15,
    });
    // 3. 删除 scatter 条目
    config.removeScatterEntry('shallow', 'initial', 1); // 删 rusty_gear
    // 4. 新增 POI 模板
    config.addPoiTemplate('new_poi', {
      searchable: true,
      repeatable: false,
      name: '新 POI',
    });
    // 5. 修改 POI 模板字段
    config.updatePoiTemplate('landmark', { name: '新地标', desc: '测试描述' });
    // 6. 重命名 POI 模板
    config.renamePoiTemplate('forge_anvil_poi', 'forge_poi');
    // 7. 新增 poi_pool entry
    config.addPoiPoolEntry('deep', { poi_id: 'landmark', per_region: 3 });
    // 8. 修改 poi_pool entry
    config.updatePoiPoolEntry('shallow', 0, { per_region: 5 });

    const snapshot1 = snapshotState();

    // 导出并重新加载
    const files = config.toPhpFiles();
    config.reset();
    const reloadResult = config.loadFromPhpStrings(files);
    expect(reloadResult.ok).toBe(true);
    const snapshot2 = snapshotState();

    // deep equal 验证 round-trip 一致性
    expect(snapshot2.scatterPool).toEqual(snapshot1.scatterPool);
    expect(snapshot2.poiTable).toEqual(snapshot1.poiTable);
    expect(snapshot2.poiPool).toEqual(snapshot1.poiPool);
  });

  // ─── 3. count 范围数组 round-trip ───────────────────
  it('scatter count=[min,max] 范围数组 round-trip 保留', () => {
    config.loadFromPhpStrings({
      'scatter_pool.php': makeFullScatterPhp(),
    });
    // shallow.initial[0].count = [1,3]
    expect(config.scatterPool!.shallow.initial[0]!.count).toEqual([1, 3]);

    // round-trip
    const files = config.toPhpFiles();
    config.reset();
    config.loadFromPhpStrings(files);

    // 仍为 [1, 3]（min !== max）
    expect(config.scatterPool!.shallow.initial[0]!.count).toEqual([1, 3]);
  });

  it('scatter count 单值数字 round-trip 保留', () => {
    config.loadFromPhpStrings({
      'scatter_pool.php': makeFullScatterPhp(),
    });
    // shallow.initial[1].count = 1（单值）
    expect(config.scatterPool!.shallow.initial[1]!.count).toBe(1);

    const files = config.toPhpFiles();
    config.reset();
    config.loadFromPhpStrings(files);

    expect(config.scatterPool!.shallow.initial[1]!.count).toBe(1);
  });

  // ─── 4. poi_table 部分字段 round-trip ───────────────
  it('poi_table 部分字段（landmark 无 E-10）round-trip 保留', () => {
    config.loadFromPhpStrings({
      'poi_table.php': makeFullPoiTablePhp(),
    });
    const landmarkBefore = config.poiTable!['landmark']!;
    expect(landmarkBefore.base_loot_chance).toBeUndefined();
    expect(landmarkBefore.event_pool).toBeUndefined();

    const files = config.toPhpFiles();
    config.reset();
    config.loadFromPhpStrings(files);

    const landmarkAfter = config.poiTable!['landmark']!;
    expect(landmarkAfter.base_loot_chance).toBeUndefined();
    expect(landmarkAfter.event_pool).toBeUndefined();
    expect(landmarkAfter.name).toBe('地标');
    expect(landmarkAfter.searchable).toBe(false);
  });

  // ─── 5. mechanic_params round-trip ──────────────────
  it('mechanic_params 数组结构 round-trip 保留', () => {
    config.loadFromPhpStrings({
      'poi_table.php': makeFullPoiTablePhp(),
    });
    const forgeBefore = config.poiTable!['forge_anvil_poi']!;
    expect(forgeBefore.mechanic_params).toEqual(['passive', 'strategy']);

    const files = config.toPhpFiles();
    config.reset();
    config.loadFromPhpStrings(files);

    const forgeAfter = config.poiTable!['forge_anvil_poi']!;
    expect(forgeAfter.mechanic_params).toEqual(['passive', 'strategy']);
    expect(forgeAfter.mechanic).toBe('craft_source');
    expect(forgeAfter.mechanic_value).toBe('forge_t1');
  });

  // ─── 6. obl_config 不参与导出 ───────────────────────
  it('obl_config 不参与 toPhpFiles 导出（边界案例）', () => {
    config.loadFromPhpStrings({
      'scatter_pool.php': makeFullScatterPhp(),
      'poi_table.php': makeFullPoiTablePhp(),
      'poi_pool.php': makeFullPoiPoolPhp(),
      'obl_config.php': makeOblConfigPhp(),
    });
    expect(config.oblConfig).not.toBeNull();

    const files = config.toPhpFiles();
    // obl_config.php 不在导出列表中
    expect(Object.keys(files)).not.toContain('obl_config.php');
    // 三个核心文件仍正常导出
    expect(Object.keys(files)).toContain('scatter_pool.php');
    expect(Object.keys(files)).toContain('poi_table.php');
    expect(Object.keys(files)).toContain('poi_pool.php');
  });

  // ─── 7. event_pool 子列表 round-trip ────────────────
  it('poi_table event_pool 子列表 round-trip 保留', () => {
    config.loadFromPhpStrings({
      'poi_table.php': makeFullPoiTablePhp(),
    });
    const supplyBefore = config.poiTable!['supply_cache']!;
    expect(supplyBefore.event_pool).toHaveLength(2);

    const files = config.toPhpFiles();
    config.reset();
    config.loadFromPhpStrings(files);

    const supplyAfter = config.poiTable!['supply_cache']!;
    expect(supplyAfter.event_pool).toHaveLength(2);
    expect(supplyAfter.event_pool![0]).toEqual({
      event_id: 'find_extra_cache',
      weight: 30,
      kind: 'good',
    });
    expect(supplyAfter.event_pool![1]).toEqual({
      event_id: 'trap_trigger',
      weight: 35,
      kind: 'bad',
    });
  });

  // ─── 8. loot_table_overrides kv-list round-trip ─────
  it('loot_table_overrides kv-list round-trip 保留', () => {
    config.loadFromPhpStrings({
      'poi_table.php': makeFullPoiTablePhp(),
    });
    expect(config.poiTable!['supply_cache']!.loot_table_overrides).toEqual({
      lockpick: 'supply_cache_loot',
    });

    const files = config.toPhpFiles();
    config.reset();
    config.loadFromPhpStrings(files);

    expect(config.poiTable!['supply_cache']!.loot_table_overrides).toEqual({
      lockpick: 'supply_cache_loot',
    });
  });

  // ─── 9. prob_mods_source string-list round-trip ─────
  it('prob_mods_source string-list round-trip 保留', () => {
    config.loadFromPhpStrings({
      'poi_table.php': makeFullPoiTablePhp(),
    });
    expect(config.poiTable!['supply_cache']!.prob_mods_source).toEqual(['lockpick']);

    const files = config.toPhpFiles();
    config.reset();
    config.loadFromPhpStrings(files);

    expect(config.poiTable!['supply_cache']!.prob_mods_source).toEqual(['lockpick']);
  });

  // ─── 10. 三 tide 列表保留顺序 round-trip ────────────
  it('scatter 三 tide 列表顺序 round-trip 保留', () => {
    config.loadFromPhpStrings({
      'scatter_pool.php': makeFullScatterPhp(),
    });
    const before = config.scatterPool!.shallow.initial.map((e) => e.item_id);

    const files = config.toPhpFiles();
    config.reset();
    config.loadFromPhpStrings(files);

    const after = config.scatterPool!.shallow.initial.map((e) => e.item_id);
    expect(after).toEqual(before);
  });

  // ─── 11. poi_table 模板插入顺序 round-trip ──────────
  it('poi_table 模板插入顺序 round-trip 保留', () => {
    config.loadFromPhpStrings({
      'poi_table.php': makeFullPoiTablePhp(),
    });
    const before = Object.keys(config.poiTable!);

    const files = config.toPhpFiles();
    config.reset();
    config.loadFromPhpStrings(files);

    const after = Object.keys(config.poiTable!);
    expect(after).toEqual(before);
  });

  // ─── 12. renamePoiTemplate 后 round-trip ────────────
  it('重命名 POI 模板后插入顺序保留 + round-trip 一致', () => {
    config.loadFromPhpStrings({
      'poi_table.php': makeFullPoiTablePhp(),
    });
    // 原：[supply_cache, landmark, forge_anvil_poi]
    // 重命名中间的 landmark → new_landmark
    config.renamePoiTemplate('landmark', 'new_landmark');
    expect(Object.keys(config.poiTable!)).toEqual([
      'supply_cache',
      'new_landmark',
      'forge_anvil_poi',
    ]);

    const files = config.toPhpFiles();
    config.reset();
    config.loadFromPhpStrings(files);

    // round-trip 后顺序仍保留
    expect(Object.keys(config.poiTable!)).toEqual([
      'supply_cache',
      'new_landmark',
      'forge_anvil_poi',
    ]);
  });
});
