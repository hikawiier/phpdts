/**
 * @module O 内容工具箱
 *
 * day-refresh-mirror 单元测试。
 *
 * 覆盖点（对齐执行案 §4.2.3）：
 *   - 空 graph 返回空输出且无不变量违反
 *   - 正常 graph：生成 refresh 结果
 *   - distribution 按 `refresh:${tide}:${pgroup}` 派生
 *   - 不变量：每格新增数量 ≤ capacity_per_tile
 *   - 不变量：effective_rate > 1.0 时 emit 违反
 *   - mode='non-daily' 时 refresh 返回空
 *   - 固定 seed 可复现
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useGraphStore } from '@/graph/graph-store';
import {
  run,
  dayRefreshMirror,
  DAY_REFRESH_MIRROR_ID,
  DAY_REFRESH_DEFAULT_SEED,
  DAY_REFRESH_DEFAULT_CURRENT_DAY,
  type DayRefreshMirrorOutput,
} from '../day-refresh-mirror';
import type { ResourceNode } from '@/graph/types';

// ─── 测试数据 ───────────────────────────────────────────────────

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

function makeConfigNode(
  mode: string,
  capacity: number,
  tideRate: Record<string, number>,
): ResourceNode {
  return {
    kind: 'config.runtime',
    id: 'obl_config',
    data: {
      entries: {
        wild_item_refresh_mode: mode,
        wild_item_capacity_per_tile: capacity,
        wild_item_refresh_rate_by_tide: tideRate,
      },
    },
    source: [],
    revision: '',
  };
}

// ─── 测试用例 ───────────────────────────────────────────────────

describe('dayRefreshMirror - 元信息', () => {
  it('ID 正确', () => {
    expect(dayRefreshMirror.id).toBe(DAY_REFRESH_MIRROR_ID);
    expect(DAY_REFRESH_MIRROR_ID).toBe('day-refresh');
  });

  it('requiredScopes 包含 game_map / debug_gamevars', () => {
    expect(dayRefreshMirror.requiredScopes).toContain('game_map');
    expect(dayRefreshMirror.requiredScopes).toContain('debug_gamevars');
  });

  it('compareOptions 数量容忍度 10%', () => {
    expect(dayRefreshMirror.compareOptions.countTolerance).toBe(0.10);
    expect(dayRefreshMirror.compareOptions.distributionTolerance).toBe(0.10);
  });
});

describe('dayRefreshMirror - run 边界', () => {
  let graphStore: ReturnType<typeof useGraphStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    graphStore = useGraphStore();
  });

  it('空 graph 返回空输出且无不变量违反', async () => {
    const result = await run(graphStore, {});
    expect(result.output).not.toBeNull();
    const output = result.output as DayRefreshMirrorOutput;
    expect(output.count).toBe(0);
    expect(output.refreshedItems).toEqual([]);
    expect(result.invariantViolations).toEqual([]);
  });

  it('mode != daily 时 refresh 返回空（即使有 scatter 配置）', async () => {
    graphStore.upsertNodes([
      makeTileNode(1, 1, 'shallow', true),
      makeScatterNode('scat1', 'item_a', ['shallow'], 'day_refresh', 1.0, 1),
      makeItemNode('item_a'),
      makeConfigNode('manual', 5, {}), // mode != daily
    ]);
    const result = await run(graphStore, {});
    const output = result.output as DayRefreshMirrorOutput;
    expect(output.count).toBe(0);
    expect(output.refreshedItems).toEqual([]);
    expect(output.mode).toBe('manual');
  });
});

describe('dayRefreshMirror - 正常路径', () => {
  let graphStore: ReturnType<typeof useGraphStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    graphStore = useGraphStore();
  });

  it('mode=daily + 高 rate 时生成 refresh 结果', async () => {
    graphStore.upsertNodes([
      makeTileNode(1, 1, 'shallow', true),
      makeTileNode(1, 2, 'shallow', true),
      makeTileNode(1, 3, 'deep', true),
      makeScatterNode('scat1', 'item_a', ['shallow', 'deep'], 'day_refresh', 1.0, 1),
      makeItemNode('item_a'),
      makeConfigNode('daily', 5, { shallow: 1.0, deep: 1.0 }),
    ]);
    const result = await run(graphStore, {});
    const output = result.output as DayRefreshMirrorOutput;

    expect(output.mode).toBe('daily');
    expect(output.capacityPerTile).toBe(5);
    expect(output.tideRate).toEqual({ shallow: 1.0, deep: 1.0 });
    expect(output.count).toBeGreaterThan(0);
  });

  it('distribution 按 refresh:${tide}:${pgroup} 派生', async () => {
    graphStore.upsertNodes([
      makeTileNode(1, 1, 'shallow', true),
      makeTileNode(1, 2, 'deep', true),
      makeScatterNode('scat1', 'item_a', ['shallow', 'deep'], 'day_refresh', 1.0, 1),
      makeItemNode('item_a'),
      makeConfigNode('daily', 5, {}),
    ]);
    const result = await run(graphStore, {});
    const output = result.output as DayRefreshMirrorOutput;

    // 至少有一个 refresh:xxx:1 键
    const refreshKeys = Object.keys(output.distribution).filter((k) => k.startsWith('refresh:'));
    expect(refreshKeys.length).toBeGreaterThan(0);
    for (const k of refreshKeys) {
      expect(k).toMatch(/^refresh:(shallow|deep|abyss):1$/);
    }
  });
});

describe('dayRefreshMirror - 不变量', () => {
  let graphStore: ReturnType<typeof useGraphStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    graphStore = useGraphStore();
  });

  it('每格新增数量 ≤ capacity_per_tile', async () => {
    graphStore.upsertNodes([
      makeTileNode(1, 1, 'shallow', true),
      makeTileNode(1, 2, 'shallow', true),
      makeScatterNode('scat1', 'item_a', ['shallow'], 'day_refresh', 1.0, 10), // count=10 但 capacity=2
      makeItemNode('item_a'),
      makeConfigNode('daily', 2, {}), // capacity=2
    ]);
    const result = await run(graphStore, {});
    const output = result.output as DayRefreshMirrorOutput;

    const countByPls = new Map<number, number>();
    for (const item of output.refreshedItems) {
      countByPls.set(item.pls, (countByPls.get(item.pls) ?? 0) + 1);
    }
    for (const [, cnt] of countByPls) {
      expect(cnt).toBeLessThanOrEqual(2);
    }
    expect(result.invariantViolations.find((v) => v.name === 'refresh_exceeds_capacity')).toBeUndefined();
  });

  it('effective_rate > 1.0 时 emit refresh_effective_rate_overflow', async () => {
    graphStore.upsertNodes([
      makeTileNode(1, 1, 'shallow', true),
      makeScatterNode('scat1', 'item_a', ['shallow'], 'day_refresh', 0.8, 1), // rate=0.8
      makeItemNode('item_a'),
      makeConfigNode('daily', 5, { shallow: 2.0 }), // 倍率=2.0 → effRate=1.6 > 1.0
    ]);
    const result = await run(graphStore, {});
    expect(
      result.invariantViolations.find((v) => v.name === 'refresh_effective_rate_overflow'),
    ).toBeDefined();
  });
});

describe('dayRefreshMirror - 可复现性', () => {
  let graphStore: ReturnType<typeof useGraphStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    graphStore = useGraphStore();
  });

  it('相同 graph + 默认 seed 产生相同输出', async () => {
    graphStore.upsertNodes([
      makeTileNode(1, 1, 'shallow', true),
      makeTileNode(1, 2, 'deep', true),
      makeScatterNode('scat1', 'item_a', ['shallow', 'deep'], 'day_refresh', 0.7, 1),
      makeItemNode('item_a'),
      makeConfigNode('daily', 5, { shallow: 1.0, deep: 1.0 }),
    ]);

    const r1 = await run(graphStore, {});
    const r2 = await run(graphStore, {});

    expect(r1.output).toEqual(r2.output);
  });

  it('使用固定 seed 20240602', () => {
    expect(DAY_REFRESH_DEFAULT_SEED).toBe(20240602);
  });

  it('使用固定 currentDay=2', () => {
    expect(DAY_REFRESH_DEFAULT_CURRENT_DAY).toBe(2);
  });
});
