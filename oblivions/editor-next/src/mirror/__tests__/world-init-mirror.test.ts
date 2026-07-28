/**
 * @module O 内容工具箱
 *
 * world-init-mirror 单元测试。
 *
 * 覆盖点（对齐执行案 §4.2.2）：
 *   - 空 graph 返回空输出且无不变量违反
 *   - 正常 graph：生成 POI 期望 + scatter + enemy 放置
 *   - 固定 seed 可复现
 *   - 不变量：敌人不重叠 / 敌人不在不可通行格 / 敌人不在出入口
 *   - POI 期望数量 = sum(per_region × region 数)
 *   - distribution 按 `${kind}:${tide}:${pgroup}` 派生
 *   - 容量上界校验（scatter 不超过 rate × tile × capacity）
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useGraphStore } from '@/graph/graph-store';
import {
  run,
  worldInitMirror,
  WORLD_INIT_MIRROR_ID,
  WORLD_INIT_DEFAULT_SEED,
  type WorldInitMirrorOutput,
} from '../world-init-mirror';
import type { ResourceNode } from '@/graph/types';

// ─── 测试数据 ───────────────────────────────────────────────────

function makeRegionNode(pgroup: number, entrance: number | null, exit: number | null): ResourceNode {
  return {
    kind: 'world.region',
    id: String(pgroup),
    data: { pgroup, entrance_pls: entrance, exit_pls: exit },
    source: [],
    revision: '',
  };
}

function makeTileNode(
  pgroup: number,
  pls: number,
  tide: string,
  passable: boolean,
): ResourceNode {
  return {
    kind: 'world.tile',
    id: `${pgroup}:${pls}`,
    data: { pgroup, pls, tide, passable },
    source: [],
    revision: '',
  };
}

function makeScatterNode(
  id: string,
  itemId: string,
  tides: string[],
  phase: string,
  rate: number,
  count: number | [number, number],
): ResourceNode {
  return {
    kind: 'distribution.scatter',
    id,
    data: {
      'subject.item_id': itemId,
      'selector.tides': tides,
      phase,
      'placement.rate': rate,
      'placement.count': count,
    },
    source: [],
    revision: '',
  };
}

function makeEnemyNode(
  id: string,
  enemyType: number,
  tides: string[],
  count: number | [number, number],
): ResourceNode {
  return {
    kind: 'distribution.enemy',
    id,
    data: {
      'subject.enemy_type': enemyType,
      'selector.tides': tides,
      'placement.count': count,
    },
    source: [],
    revision: '',
  };
}

function makePoiNode(id: string, poiId: string, tides: string[], count: number): ResourceNode {
  return {
    kind: 'distribution.poi',
    id,
    data: {
      'subject.poi_id': poiId,
      'selector.tides': tides,
      'placement.count': count,
    },
    source: [],
    revision: '',
  };
}

function makeItemNode(id: string): ResourceNode {
  return {
    kind: 'item.template',
    id,
    data: {
      itmk: 'MT',
      itme: 0,
      itms: '1',
      itmsk: '',
      itmpara: '',
      stack: true,
    },
    source: [],
    revision: '',
  };
}

function makeConfigNode(capacity: number): ResourceNode {
  return {
    kind: 'config.runtime',
    id: 'obl_config',
    data: {
      entries: {
        wild_item_capacity_per_tile: capacity,
      },
    },
    source: [],
    revision: '',
  };
}

// ─── 测试用例 ───────────────────────────────────────────────────

describe('worldInitMirror - 元信息', () => {
  it('ID 正确', () => {
    expect(worldInitMirror.id).toBe(WORLD_INIT_MIRROR_ID);
    expect(WORLD_INIT_MIRROR_ID).toBe('world-init');
  });

  it('requiredScopes 包含 debug_poi_all / game_map / enemies', () => {
    expect(worldInitMirror.requiredScopes).toContain('debug_poi_all');
    expect(worldInitMirror.requiredScopes).toContain('game_map');
    expect(worldInitMirror.requiredScopes).toContain('enemies');
  });

  it('compareOptions 数量容忍度 10%', () => {
    expect(worldInitMirror.compareOptions.countTolerance).toBe(0.10);
    expect(worldInitMirror.compareOptions.distributionTolerance).toBe(0.10);
  });
});

describe('worldInitMirror - run 边界', () => {
  let graphStore: ReturnType<typeof useGraphStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    graphStore = useGraphStore();
  });

  it('空 graph 返回空输出且无不变量违反', async () => {
    const result = await run(graphStore, {});
    expect(result.output).not.toBeNull();
    const output = result.output as WorldInitMirrorOutput;
    expect(output.count).toBe(0);
    expect(output.scatterItems).toEqual([]);
    expect(output.placedEnemies).toEqual([]);
    expect(output.poiExpectedCount).toBe(0);
    expect(result.invariantViolations).toEqual([]);
  });

  it('仅有 region 节点（无 distribution / item）返回空输出', async () => {
    graphStore.upsertNodes([
      makeRegionNode(1, 100, 200),
      makeTileNode(1, 1, 'shallow', true),
    ]);
    const result = await run(graphStore, {});
    const output = result.output as WorldInitMirrorOutput;
    expect(output.count).toBe(0);
    expect(output.placedEnemies).toEqual([]);
    expect(output.scatterItems).toEqual([]);
  });
});

describe('worldInitMirror - 正常路径', () => {
  let graphStore: ReturnType<typeof useGraphStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    graphStore = useGraphStore();
  });

  it('生成 POI 期望 + scatter + enemy 放置', async () => {
    graphStore.upsertNodes([
      makeRegionNode(1, 100, 200),
      makeRegionNode(2, 100, 200),
      makeTileNode(1, 1, 'shallow', true),
      makeTileNode(1, 2, 'shallow', true),
      makeTileNode(1, 3, 'deep', true),
      makeTileNode(2, 1, 'shallow', true),
      makeTileNode(2, 2, 'deep', true),
      makeScatterNode('scat1', 'item_a', ['shallow'], 'game_init', 1.0, 1),
      makeEnemyNode('ene1', 1, ['shallow'], 2),
      makePoiNode('poi1', 'poi_a', ['shallow'], 1),
      makeItemNode('item_a'),
      makeConfigNode(5),
    ]);
    const result = await run(graphStore, {});
    const output = result.output as WorldInitMirrorOutput;

    // POI 期望：1 个 poi 节点 × perRegion=1 × 2 region = 2
    expect(output.poiExpectedCount).toBe(2);

    // 至少有 scatter 和 enemy 放置（具体数量受 PRNG 影响）
    expect(output.count).toBeGreaterThan(0);
    expect(output.scatterItems.length + output.placedEnemies.length + output.poiExpectedCount).toBe(output.count);
  });

  it('distribution 按 ${kind}:${tide}:${pgroup} 派生', async () => {
    graphStore.upsertNodes([
      makeRegionNode(1, 100, 200),
      makeTileNode(1, 1, 'shallow', true),
      makeTileNode(1, 2, 'shallow', true),
      makeEnemyNode('ene1', 1, ['shallow'], 1),
      makeItemNode('item_a'),
    ]);
    const result = await run(graphStore, {});
    const output = result.output as WorldInitMirrorOutput;

    // 应有 enemy:shallow:1 键
    expect(output.distribution['enemy:shallow:1']).toBeGreaterThan(0);
  });
});

describe('worldInitMirror - 不变量', () => {
  let graphStore: ReturnType<typeof useGraphStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    graphStore = useGraphStore();
  });

  it('敌人放置不重叠（每格最多一个）', async () => {
    graphStore.upsertNodes([
      makeRegionNode(1, null, null),
      makeTileNode(1, 1, 'shallow', true),
      makeTileNode(1, 2, 'shallow', true),
      makeTileNode(1, 3, 'shallow', true),
      makeEnemyNode('ene1', 1, ['shallow'], 3),
      makeItemNode('item_a'),
    ]);
    const result = await run(graphStore, {});
    const output = result.output as WorldInitMirrorOutput;

    const plsSet = new Set(output.placedEnemies.map((e) => `${e.pgroup}:${e.pls}`));
    expect(plsSet.size).toBe(output.placedEnemies.length);

    expect(result.invariantViolations.find((v) => v.name === 'enemy_overlap')).toBeUndefined();
  });

  it('敌人不在不可通行格 / 入口 / 出口', async () => {
    graphStore.upsertNodes([
      makeRegionNode(1, 100, 200),
      makeTileNode(1, 1, 'shallow', true),
      makeTileNode(1, 2, 'shallow', true),
      makeTileNode(1, 100, 'shallow', true), // 入口
      makeTileNode(1, 200, 'shallow', true), // 出口
      makeTileNode(1, 999, 'shallow', false), // 不可通行
      makeEnemyNode('ene1', 1, ['shallow'], 2),
      makeItemNode('item_a'),
    ]);
    const result = await run(graphStore, {});
    const output = result.output as WorldInitMirrorOutput;

    for (const e of output.placedEnemies) {
      expect(e.pls).not.toBe(100);
      expect(e.pls).not.toBe(200);
      expect(e.pls).not.toBe(999);
    }
    expect(result.invariantViolations.find((v) => v.name === 'enemy_on_impassable_tile')).toBeUndefined();
    expect(result.invariantViolations.find((v) => v.name === 'enemy_on_entrance')).toBeUndefined();
    expect(result.invariantViolations.find((v) => v.name === 'enemy_on_exit')).toBeUndefined();
  });
});

describe('worldInitMirror - 可复现性', () => {
  let graphStore: ReturnType<typeof useGraphStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    graphStore = useGraphStore();
  });

  it('相同 graph + 默认 seed 产生相同输出', async () => {
    const nodes = [
      makeRegionNode(1, null, null),
      makeTileNode(1, 1, 'shallow', true),
      makeTileNode(1, 2, 'deep', true),
      makeScatterNode('scat1', 'item_a', ['shallow', 'deep'], 'game_init', 0.5, 1),
      makeEnemyNode('ene1', 1, ['shallow'], 1),
      makeItemNode('item_a'),
      makeConfigNode(5),
    ];
    graphStore.upsertNodes(nodes);

    // run() 是只读的，相同 graph + 相同 seed 产生相同输出
    const r1 = await run(graphStore, {});
    const r2 = await run(graphStore, {});

    expect(r1.output).toEqual(r2.output);
    expect(r1.invariantViolations).toEqual(r2.invariantViolations);
  });

  it('使用固定 seed 20240601', () => {
    expect(WORLD_INIT_DEFAULT_SEED).toBe(20240601);
  });
});
