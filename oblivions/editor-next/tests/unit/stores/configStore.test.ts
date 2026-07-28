//
// configStore 单元测试（对齐 NEW_DESIGN.md §7.3 M5：store 覆盖率 ≥ 85%）
//
// 覆盖点：
//   - state 初始状态：scatterPool / poiTable / poiPool / oblConfig / isDirty 均为 null/false
//   - loadFromPhpStrings：4 个文件 / 部分文件 / 文件名变体 / 解析失败
//   - 归一化层：scatter count 范围数组 / poi_table 部分字段 / obl_config 混合类型
//   - CRUD：scatter / poi_table / poi_pool 增删改查 + moveScatterEntry / renamePoiTemplate
//   - toPhpFiles：仅 scatter_pool / poi_table / poi_pool（obl_config 不导出）
//   - reset / clearAll / markSaved
//   - 边界：未加载时 CRUD 无操作 / 索引越界 / 重命名冲突

import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useConfigStore } from '@/stores/configStore';
import type {
  ScatterPool,
  PoiTable,
  PoiPool,
  OblConfig,
} from '@/shared';

// ─── 测试工具：构造 PHP 文件内容 ─────────────────────────
function makeScatterPhp(): string {
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
        'initial' => [],
        'refresh' => [],
    ],
    'abyss' => [
        'initial' => [],
        'refresh' => [],
    ],
];`;
}

function makePoiTablePhp(): string {
  return `<?php
if (!defined('IN_GAME')) { exit('Access Denied'); }
return [
    'supply_cache' => [
        'name' => '补给储藏箱',
        'desc' => '一个被铁皮加固的木箱',
        'searchable' => true,
        'repeatable' => false,
        'base_loot_chance' => 0.7,
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
        'mechanic' => 'forge_anvil',
        'mechanic_value' => 'forge_t1',
        'mechanic_params' => ['passive', 'strategy'],
    ],
];`;
}

function makePoiPoolPhp(): string {
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

describe('configStore', () => {
  let config: ReturnType<typeof useConfigStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    config = useConfigStore();
  });

  // ─── 初始状态 ───────────────────────────────────────
  describe('初始状态', () => {
    it('state 均为 null / false', () => {
      expect(config.scatterPool).toBeNull();
      expect(config.poiTable).toBeNull();
      expect(config.poiPool).toBeNull();
      expect(config.oblConfig).toBeNull();
      expect(config.isDirty).toBe(false);
    });

    it('hasConfig 为 false', () => {
      expect(config.hasConfig).toBe(false);
    });

    it('poiIdOptions 为空数组', () => {
      expect(config.poiIdOptions).toEqual([]);
    });
  });

  // ─── loadFromPhpStrings ─────────────────────────────
  describe('loadFromPhpStrings', () => {
    it('加载全部 4 个文件', () => {
      const result = config.loadFromPhpStrings({
        'scatter_pool.php': makeScatterPhp(),
        'poi_table.php': makePoiTablePhp(),
        'poi_pool.php': makePoiPoolPhp(),
        'obl_config.php': makeOblConfigPhp(),
      });
      expect(result.ok).toBe(true);
      expect(result.loaded).toHaveLength(4);
      expect(Object.keys(result.errors)).toHaveLength(0);
      expect(config.scatterPool).not.toBeNull();
      expect(config.poiTable).not.toBeNull();
      expect(config.poiPool).not.toBeNull();
      expect(config.oblConfig).not.toBeNull();
      expect(config.isDirty).toBe(false);
    });

    it('加载部分文件（仅 scatter_pool）', () => {
      const result = config.loadFromPhpStrings({
        'scatter_pool.php': makeScatterPhp(),
      });
      expect(result.ok).toBe(true);
      expect(result.loaded).toEqual(['scatter_pool.php']);
      expect(config.scatterPool).not.toBeNull();
      expect(config.poiTable).toBeNull();
    });

    it('支持简写文件名（无 .php 后缀）', () => {
      const result = config.loadFromPhpStrings({
        scatter_pool: makeScatterPhp(),
      });
      expect(result.ok).toBe(true);
      expect(config.scatterPool).not.toBeNull();
    });

    it('支持带路径前缀的文件名', () => {
      const result = config.loadFromPhpStrings({
        'gamedata/scatter_pool.php': makeScatterPhp(),
      });
      expect(result.ok).toBe(true);
      expect(config.scatterPool).not.toBeNull();
    });

    it('解析失败时返回错误信息', () => {
      const result = config.loadFromPhpStrings({
        'scatter_pool.php': '<?php this is not valid php',
      });
      expect(result.ok).toBe(false);
      expect(result.errors['scatter_pool.php']).toBeDefined();
      expect(config.scatterPool).toBeNull();
    });

    it('加载后 isDirty 为 false', () => {
      config.loadFromPhpStrings({
        'scatter_pool.php': makeScatterPhp(),
      });
      expect(config.isDirty).toBe(false);
    });

    it('hasConfig 在三个核心文件加载后为 true', () => {
      config.loadFromPhpStrings({
        'scatter_pool.php': makeScatterPhp(),
        'poi_table.php': makePoiTablePhp(),
        'poi_pool.php': makePoiPoolPhp(),
      });
      expect(config.hasConfig).toBe(true);
    });

    it('hasConfig 在缺少任一核心文件时为 false', () => {
      config.loadFromPhpStrings({
        'scatter_pool.php': makeScatterPhp(),
        'poi_table.php': makePoiTablePhp(),
        // 缺 poi_pool
      });
      expect(config.hasConfig).toBe(false);
    });
  });

  // ─── 归一化层 ───────────────────────────────────────
  describe('归一化层', () => {
    beforeEach(() => {
      config.loadFromPhpStrings({
        'scatter_pool.php': makeScatterPhp(),
        'poi_table.php': makePoiTablePhp(),
        'poi_pool.php': makePoiPoolPhp(),
        'obl_config.php': makeOblConfigPhp(),
      });
    });

    it('scatter count 支持范围数组 [min, max]', () => {
      const entry = config.scatterPool!.shallow.initial[0]!;
      expect(entry.item_id).toBe('scrap_metal');
      expect(entry.count).toEqual([1, 3]);
      expect(entry.rate).toBeCloseTo(0.6);
    });

    it('scatter count 支持单值数字', () => {
      const entry = config.scatterPool!.shallow.initial[1]!;
      expect(entry.count).toBe(1);
    });

    it('poi_table 部分字段保留（landmark 无 E-10）', () => {
      const landmark = config.poiTable!['landmark']!;
      expect(landmark.name).toBe('地标');
      expect(landmark.searchable).toBe(false);
      expect(landmark.base_loot_chance).toBeUndefined();
      expect(landmark.event_pool).toBeUndefined();
    });

    it('poi_table event_pool 子列表正确归一化', () => {
      const supply = config.poiTable!['supply_cache']!;
      expect(supply.event_pool).toHaveLength(2);
      expect(supply.event_pool![0]).toEqual({
        event_id: 'find_extra_cache',
        weight: 30,
        kind: 'good',
      });
      expect(supply.event_pool![1]!.kind).toBe('bad');
    });

    it('poi_table loot_table_overrides kv-list 归一化', () => {
      const supply = config.poiTable!['supply_cache']!;
      expect(supply.loot_table_overrides).toEqual({
        lockpick: 'supply_cache_loot',
      });
    });

    it('poi_table mechanic_params 保留原结构', () => {
      const forge = config.poiTable!['forge_anvil_poi']!;
      expect(forge.mechanic).toBe('forge_anvil');
      expect(forge.mechanic_value).toBe('forge_t1');
      expect(forge.mechanic_params).toEqual(['passive', 'strategy']);
    });

    it('poi_table searchable/repeatable 缺失时默认 false', () => {
      const forge = config.poiTable!['forge_anvil_poi']!;
      expect(forge.searchable).toBe(false);
      expect(forge.repeatable).toBe(false);
    });

    it('obl_config 混合类型保留', () => {
      expect(config.oblConfig!['max_wild_items_per_tile']).toBe(3);
      expect(config.oblConfig!['enable_poi_ttl']).toBe(true);
      const rates = config.oblConfig!['wild_item_refresh_rate_by_tide'] as Record<string, number>;
      expect(rates['shallow']).toBeCloseTo(0.5);
    });

    it('poiIdOptions 来自 poiTable', () => {
      const options = config.poiIdOptions;
      expect(options).toHaveLength(3);
      expect(options[0]!.value).toBe('supply_cache');
      expect(options[0]!.label).toContain('补给储藏箱');
    });
  });

  // ─── scatter CRUD ───────────────────────────────────
  describe('scatter_pool CRUD', () => {
    beforeEach(() => {
      config.loadFromPhpStrings({
        'scatter_pool.php': makeScatterPhp(),
      });
    });

    it('addScatterEntry 新增条目', () => {
      const initialLength = config.scatterPool!.shallow.initial.length;
      config.addScatterEntry('shallow', 'initial', {
        item_id: 'new_item',
        count: 5,
        rate: 0.5,
      });
      expect(config.scatterPool!.shallow.initial).toHaveLength(initialLength + 1);
      expect(config.isDirty).toBe(true);
    });

    it('updateScatterEntry 更新字段', () => {
      config.updateScatterEntry('shallow', 'initial', 0, { rate: 0.99 });
      expect(config.scatterPool!.shallow.initial[0]!.rate).toBeCloseTo(0.99);
      expect(config.isDirty).toBe(true);
    });

    it('updateScatterEntry 索引越界时无操作', () => {
      const before = JSON.parse(JSON.stringify(config.scatterPool));
      config.updateScatterEntry('shallow', 'initial', 999, { rate: 0 });
      expect(config.scatterPool).toEqual(before);
    });

    it('removeScatterEntry 删除条目', () => {
      const initialLength = config.scatterPool!.shallow.initial.length;
      config.removeScatterEntry('shallow', 'initial', 0);
      expect(config.scatterPool!.shallow.initial).toHaveLength(initialLength - 1);
      expect(config.isDirty).toBe(true);
    });

    it('removeScatterEntry 索引越界时无操作', () => {
      const before = JSON.parse(JSON.stringify(config.scatterPool));
      config.removeScatterEntry('shallow', 'initial', 999);
      expect(config.scatterPool).toEqual(before);
    });

    it('moveScatterEntry 重新排序', () => {
      // original: [scrap_metal, rusty_gear]
      config.moveScatterEntry('shallow', 'initial', 0, 1);
      expect(config.scatterPool!.shallow.initial[0]!.item_id).toBe('rusty_gear');
      expect(config.scatterPool!.shallow.initial[1]!.item_id).toBe('scrap_metal');
      expect(config.isDirty).toBe(true);
    });

    it('moveScatterEntry from===to 时无操作', () => {
      const before = JSON.parse(JSON.stringify(config.scatterPool));
      config.moveScatterEntry('shallow', 'initial', 0, 0);
      expect(config.scatterPool).toEqual(before);
    });

    it('未加载时 CRUD 无操作', () => {
      config.reset();
      config.addScatterEntry('shallow', 'initial', { item_id: 'x', count: 1, rate: 0 });
      expect(config.scatterPool).toBeNull();
    });
  });

  // ─── poi_table CRUD ─────────────────────────────────
  describe('poi_table CRUD', () => {
    beforeEach(() => {
      config.loadFromPhpStrings({
        'poi_table.php': makePoiTablePhp(),
      });
    });

    it('addPoiTemplate 新增模板', () => {
      const ok = config.addPoiTemplate('new_poi', {
        searchable: true,
        repeatable: false,
      });
      expect(ok).toBe(true);
      expect(config.poiTable!['new_poi']).toBeDefined();
      expect(config.isDirty).toBe(true);
    });

    it('addPoiTemplate ID 已存在时返回 false', () => {
      const ok = config.addPoiTemplate('landmark', {
        searchable: false,
        repeatable: false,
      });
      expect(ok).toBe(false);
    });

    it('updatePoiTemplate patch 字段', () => {
      config.updatePoiTemplate('landmark', { name: '新地标' });
      expect(config.poiTable!['landmark']!.name).toBe('新地标');
      expect(config.isDirty).toBe(true);
    });

    it('updatePoiTemplate 不存在时无操作', () => {
      config.updatePoiTemplate('not_exist', { name: 'x' });
      expect(config.poiTable!['not_exist']).toBeUndefined();
    });

    it('removePoiTemplate 删除模板', () => {
      config.removePoiTemplate('landmark');
      expect(config.poiTable!['landmark']).toBeUndefined();
      expect(config.isDirty).toBe(true);
    });

    it('renamePoiTemplate 保留插入顺序', () => {
      const ok = config.renamePoiTemplate('landmark', 'new_landmark');
      expect(ok).toBe(true);
      const keys = Object.keys(config.poiTable!);
      // landmark 原本在第二位，重命名后应保留位置
      expect(keys[1]).toBe('new_landmark');
      expect(keys).not.toContain('landmark');
      expect(config.isDirty).toBe(true);
    });

    it('renamePoiTemplate 目标已存在时返回 false', () => {
      const ok = config.renamePoiTemplate('landmark', 'supply_cache');
      expect(ok).toBe(false);
    });

    it('renamePoiTemplate 源不存在时返回 false', () => {
      const ok = config.renamePoiTemplate('not_exist', 'new_id');
      expect(ok).toBe(false);
    });

    it('renamePoiTemplate 新旧同名时返回 true 但不修改', () => {
      const ok = config.renamePoiTemplate('landmark', 'landmark');
      expect(ok).toBe(true);
    });

    it('未加载时 CRUD 无操作', () => {
      config.reset();
      config.addPoiTemplate('x', { searchable: false, repeatable: false });
      expect(config.poiTable).toBeNull();
    });
  });

  // ─── poi_pool CRUD ──────────────────────────────────
  describe('poi_pool CRUD', () => {
    beforeEach(() => {
      config.loadFromPhpStrings({
        'poi_pool.php': makePoiPoolPhp(),
      });
    });

    it('addPoiPoolEntry 新增条目', () => {
      config.addPoiPoolEntry('deep', { poi_id: 'new_poi', per_region: 1 });
      expect(config.poiPool!.deep).toHaveLength(1);
      expect(config.isDirty).toBe(true);
    });

    it('updatePoiPoolEntry 更新字段', () => {
      config.updatePoiPoolEntry('shallow', 0, { per_region: 10 });
      expect(config.poiPool!.shallow[0]!.per_region).toBe(10);
      expect(config.isDirty).toBe(true);
    });

    it('removePoiPoolEntry 删除条目', () => {
      const before = config.poiPool!.shallow.length;
      config.removePoiPoolEntry('shallow', 0);
      expect(config.poiPool!.shallow).toHaveLength(before - 1);
      expect(config.isDirty).toBe(true);
    });

    it('movePoiPoolEntry 重新排序', () => {
      config.movePoiPoolEntry('shallow', 0, 1);
      expect(config.poiPool!.shallow[0]!.poi_id).toBe('landmark');
      expect(config.poiPool!.shallow[1]!.poi_id).toBe('supply_cache');
      expect(config.isDirty).toBe(true);
    });

    it('未加载时 CRUD 无操作', () => {
      config.reset();
      config.addPoiPoolEntry('shallow', { poi_id: 'x', per_region: 1 });
      expect(config.poiPool).toBeNull();
    });
  });

  // ─── toPhpFiles ─────────────────────────────────────
  describe('toPhpFiles', () => {
    beforeEach(() => {
      config.loadFromPhpStrings({
        'scatter_pool.php': makeScatterPhp(),
        'poi_table.php': makePoiTablePhp(),
        'poi_pool.php': makePoiPoolPhp(),
        'obl_config.php': makeOblConfigPhp(),
      });
    });

    it('导出 scatter_pool / poi_table / poi_pool 三个文件', () => {
      const files = config.toPhpFiles();
      expect(Object.keys(files)).toContain('scatter_pool.php');
      expect(Object.keys(files)).toContain('poi_table.php');
      expect(Object.keys(files)).toContain('poi_pool.php');
    });

    it('不导出 obl_config（对齐 §3.4.4 边界案例）', () => {
      const files = config.toPhpFiles();
      expect(Object.keys(files)).not.toContain('obl_config.php');
    });

    it('scatter_pool 导出包含 return 语法', () => {
      const files = config.toPhpFiles();
      expect(files['scatter_pool.php']).toContain('return');
      expect(files['scatter_pool.php']).toContain('scrap_metal');
    });

    it('未加载的文件不导出', () => {
      config.reset();
      config.loadFromPhpStrings({
        'scatter_pool.php': makeScatterPhp(),
      });
      const files = config.toPhpFiles();
      expect(Object.keys(files)).toEqual(['scatter_pool.php']);
    });

    it('全部未加载时返回空对象', () => {
      config.reset();
      const files = config.toPhpFiles();
      expect(files).toEqual({});
    });
  });

  // ─── reset / clearAll / markSaved ───────────────────
  describe('reset / clearAll / markSaved', () => {
    beforeEach(() => {
      config.loadFromPhpStrings({
        'scatter_pool.php': makeScatterPhp(),
        'poi_table.php': makePoiTablePhp(),
        'poi_pool.php': makePoiPoolPhp(),
        'obl_config.php': makeOblConfigPhp(),
      });
      config.isDirty = true;
    });

    it('reset 清空所有 state', () => {
      config.reset();
      expect(config.scatterPool).toBeNull();
      expect(config.poiTable).toBeNull();
      expect(config.poiPool).toBeNull();
      expect(config.oblConfig).toBeNull();
      expect(config.isDirty).toBe(false);
    });

    it('clearAll 等价于 reset', () => {
      config.clearAll();
      expect(config.scatterPool).toBeNull();
      expect(config.isDirty).toBe(false);
    });

    it('markSaved 清 isDirty', () => {
      config.markSaved();
      expect(config.isDirty).toBe(false);
    });
  });

  // ─── 程序化构造（绕过 PHP 解析） ────────────────────
  describe('程序化构造', () => {
    it('setScatterPool 直接设置 + 标记 dirty', () => {
      const pool: ScatterPool = {
        shallow: { initial: [], refresh: [] },
        deep: { initial: [], refresh: [] },
        abyss: { initial: [], refresh: [] },
      };
      config.setScatterPool(pool);
      expect(config.scatterPool).toEqual(pool);
      expect(config.isDirty).toBe(true);
    });

    it('setPoiTable 直接设置 + 标记 dirty', () => {
      const table: PoiTable = { x: { searchable: false, repeatable: false } };
      config.setPoiTable(table);
      expect(config.poiTable).toEqual(table);
      expect(config.isDirty).toBe(true);
    });

    it('setPoiPool 直接设置 + 标记 dirty', () => {
      const pool: PoiPool = {
        shallow: [],
        deep: [],
        abyss: [],
      };
      config.setPoiPool(pool);
      expect(config.poiPool).toEqual(pool);
      expect(config.isDirty).toBe(true);
    });

    it('oblConfig 通过 loadAll 写入 graph-store（不再提供 setOblConfig）', () => {
      // P1-E 重构后 oblConfig 是从 graph-store 派生的只读 computed
      // 不再提供 setOblConfig action；通过 loadAll 或 loadFromPhpStrings 写入
      const cfg: OblConfig = { key: 'value' };
      config.loadAll({
        scatterPool: {
          shallow: { initial: [], refresh: [] },
          deep: { initial: [], refresh: [] },
          abyss: { initial: [], refresh: [] },
        },
        poiTable: { x: { searchable: false, repeatable: false } },
        poiPool: { shallow: [], deep: [], abyss: [] },
        oblConfig: cfg,
      });
      expect(config.oblConfig).toEqual(cfg);
      expect(config.isDirty).toBe(false);
    });

    it('loadAll 一次性加载全部配置', () => {
      config.loadAll({
        scatterPool: {
          shallow: { initial: [], refresh: [] },
          deep: { initial: [], refresh: [] },
          abyss: { initial: [], refresh: [] },
        },
        poiTable: { x: { searchable: false, repeatable: false } },
        poiPool: { shallow: [], deep: [], abyss: [] },
        oblConfig: { k: 1 },
      });
      expect(config.hasConfig).toBe(true);
      expect(config.oblConfig).toEqual({ k: 1 });
      expect(config.isDirty).toBe(false);
    });
  });
});
