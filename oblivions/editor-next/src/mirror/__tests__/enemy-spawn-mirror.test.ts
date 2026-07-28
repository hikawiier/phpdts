/**
 * @module O 内容工具箱
 *
 * enemy-spawn-mirror 单元测试。
 *
 * 覆盖点（对齐执行案 §4.2.6）：
 *   - 空 graph 返回空输出且无不变量违反
 *   - 正常 graph：每个 region 调用 oblInitEnemies 累积放置
 *   - distribution 按 `enemy:${tide}:${pgroup}` 派生
 *   - perRegionCount / perTypeCount 正确聚合
 *   - 不变量：敌人不重叠（每格最多一个）
 *   - 不变量：数量 ≤ max(count) × region 数
 *   - 不变量：不在不可通行格 / 入口 / 出口
 *   - 不变量：enemy_type 必须为正整数
 *   - 固定 seed 可复现
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useGraphStore } from '@/graph/graph-store';
import {
  run,
  enemySpawnMirror,
  ENEMY_SPAWN_MIRROR_ID,
  ENEMY_SPAWN_DEFAULT_SEED,
  type EnemySpawnMirrorOutput,
} from '../enemy-spawn-mirror';
import type { ResourceNode } from '@/graph/types';

// ─── 测试数据 ───────────────────────────────────────────────────

function makeRegionNode(
  pgroup: number,
  entrance: number | null,
  exit: number | null,
): ResourceNode {
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

// ─── 测试用例 ───────────────────────────────────────────────────

describe('enemySpawnMirror - 元信息', () => {
  it('ID 正确', () => {
    expect(enemySpawnMirror.id).toBe(ENEMY_SPAWN_MIRROR_ID);
    expect(ENEMY_SPAWN_MIRROR_ID).toBe('enemy-spawn');
  });

  it('requiredScopes 包含 enemies / game_map', () => {
    expect(enemySpawnMirror.requiredScopes).toContain('enemies');
    expect(enemySpawnMirror.requiredScopes).toContain('game_map');
  });

  it('compareOptions 数量容忍度 10%', () => {
    expect(enemySpawnMirror.compareOptions.countTolerance).toBe(0.10);
    expect(enemySpawnMirror.compareOptions.distributionTolerance).toBe(0.10);
  });
});

describe('enemySpawnMirror - run 边界', () => {
  let graphStore: ReturnType<typeof useGraphStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    graphStore = useGraphStore();
  });

  it('空 graph 返回空输出且无不变量违反', async () => {
    const result = await run(graphStore, {});
    expect(result.output).not.toBeNull();
    const output = result.output as EnemySpawnMirrorOutput;
    expect(output.count).toBe(0);
    expect(output.placedEnemies).toEqual([]);
    expect(output.distribution).toEqual({});
    expect(output.perRegionCount).toEqual({});
    expect(output.perTypeCount).toEqual({});
    expect(output.totalRegions).toBe(0);
    expect(output.totalEnemyTypes).toBe(0);
    expect(result.invariantViolations).toEqual([]);
  });

  it('仅有 region 节点（无 tile / distribution.enemy）返回空输出', async () => {
    graphStore.upsertNodes([makeRegionNode(1, 100, 200)]);
    const result = await run(graphStore, {});
    const output = result.output as EnemySpawnMirrorOutput;
    expect(output.count).toBe(0);
    expect(output.placedEnemies).toEqual([]);
    expect(output.totalRegions).toBe(1);
  });
});

describe('enemySpawnMirror - 正常路径', () => {
  let graphStore: ReturnType<typeof useGraphStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    graphStore = useGraphStore();
  });

  it('生成敌人放置结果 + distribution / perRegionCount / perTypeCount 聚合', async () => {
    graphStore.upsertNodes([
      makeRegionNode(1, 100, 200),
      makeRegionNode(2, 100, 200),
      makeTileNode(1, 1, 'shallow', true),
      makeTileNode(1, 2, 'shallow', true),
      makeTileNode(1, 3, 'deep', true),
      makeTileNode(2, 1, 'shallow', true),
      makeTileNode(2, 2, 'deep', true),
      makeEnemyNode('ene1', 1, ['shallow'], 2),
      makeEnemyNode('ene2', 2, ['deep'], 1),
    ]);
    const result = await run(graphStore, {});
    const output = result.output as EnemySpawnMirrorOutput;

    expect(output.count).toBeGreaterThan(0);
    expect(output.totalRegions).toBe(2);
    expect(output.totalEnemyTypes).toBeGreaterThan(0);

    // distribution key 格式：enemy:${tide}:${pgroup}
    for (const key of Object.keys(output.distribution)) {
      expect(key).toMatch(/^enemy:(shallow|deep|abyss):[0-9]+$/);
    }

    // perRegionCount key 是 pgroup 数字（1 或 2）
    for (const k of Object.keys(output.perRegionCount)) {
      const pgroup = Number(k);
      expect([1, 2]).toContain(pgroup);
    }

    // perTypeCount 总和 = count
    let typeSum = 0;
    for (const [, cnt] of Object.entries(output.perTypeCount)) {
      typeSum += cnt;
    }
    expect(typeSum).toBe(output.count);
  });

  it('distribution 按 enemy:${tide}:${pgroup} 派生', async () => {
    graphStore.upsertNodes([
      makeRegionNode(1, null, null),
      makeTileNode(1, 1, 'shallow', true),
      makeTileNode(1, 2, 'deep', true),
      makeEnemyNode('ene1', 1, ['shallow'], 1),
      makeEnemyNode('ene2', 2, ['deep'], 1),
    ]);
    const result = await run(graphStore, {});
    const output = result.output as EnemySpawnMirrorOutput;

    // 至少有一个 enemy:xxx:1 键
    const enemyKeys = Object.keys(output.distribution).filter((k) => k.startsWith('enemy:'));
    expect(enemyKeys.length).toBeGreaterThan(0);
  });
});

describe('enemySpawnMirror - 不变量', () => {
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
    ]);
    const result = await run(graphStore, {});
    const output = result.output as EnemySpawnMirrorOutput;

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
    ]);
    const result = await run(graphStore, {});
    const output = result.output as EnemySpawnMirrorOutput;

    for (const e of output.placedEnemies) {
      expect(e.pls).not.toBe(100);
      expect(e.pls).not.toBe(200);
      expect(e.pls).not.toBe(999);
    }
    expect(result.invariantViolations.find((v) => v.name === 'enemy_on_impassable_tile')).toBeUndefined();
    expect(result.invariantViolations.find((v) => v.name === 'enemy_on_entrance')).toBeUndefined();
    expect(result.invariantViolations.find((v) => v.name === 'enemy_on_exit')).toBeUndefined();
  });

  it('enemy_type 无效（≤0）时 emit enemy_type_invalid', async () => {
    graphStore.upsertNodes([
      makeRegionNode(1, null, null),
      makeTileNode(1, 1, 'shallow', true),
      makeEnemyNode('ene1', 0, ['shallow'], 1), // enemy_type=0 无效
    ]);
    const result = await run(graphStore, {});
    expect(
      result.invariantViolations.find((v) => v.name === 'enemy_type_invalid'),
    ).toBeDefined();
  });

  it('enemy_type 为 NaN 时 emit enemy_type_invalid', async () => {
    graphStore.upsertNodes([
      makeRegionNode(1, null, null),
      makeTileNode(1, 1, 'shallow', true),
      makeEnemyNode('ene1', NaN, ['shallow'], 1),
    ]);
    const result = await run(graphStore, {});
    expect(
      result.invariantViolations.find((v) => v.name === 'enemy_type_invalid'),
    ).toBeDefined();
  });

  it('正常配置不 emit 不变量违反', async () => {
    graphStore.upsertNodes([
      makeRegionNode(1, null, null),
      makeTileNode(1, 1, 'shallow', true),
      makeTileNode(1, 2, 'shallow', true),
      makeEnemyNode('ene1', 1, ['shallow'], 1),
    ]);
    const result = await run(graphStore, {});
    expect(result.invariantViolations).toEqual([]);
  });
});

describe('enemySpawnMirror - count 区间', () => {
  let graphStore: ReturnType<typeof useGraphStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    graphStore = useGraphStore();
  });

  it('count=[min,max] 时实际数量在 [min,max] 范围内', async () => {
    // 多个 tile 保证候选格充足
    const tileNodes: ResourceNode[] = [];
    for (let i = 1; i <= 10; i++) {
      tileNodes.push(makeTileNode(1, i, 'shallow', true));
    }
    graphStore.upsertNodes([
      makeRegionNode(1, null, null),
      ...tileNodes,
      makeEnemyNode('ene1', 1, ['shallow'], [2, 4]),
    ]);

    // 跑多次验证 count 区间
    for (let i = 0; i < 10; i++) {
      const result = await run(graphStore, {});
      const output = result.output as EnemySpawnMirrorOutput;
      expect(output.count).toBeGreaterThanOrEqual(2);
      expect(output.count).toBeLessThanOrEqual(4);
    }
  });

  it('count 上界校验：放置数量 ≤ max(count) × region 数', async () => {
    graphStore.upsertNodes([
      makeRegionNode(1, null, null),
      makeRegionNode(2, null, null),
      makeTileNode(1, 1, 'shallow', true),
      makeTileNode(1, 2, 'shallow', true),
      makeTileNode(2, 1, 'shallow', true),
      makeTileNode(2, 2, 'shallow', true),
      makeEnemyNode('ene1', 1, ['shallow'], [1, 3]),
    ]);
    const result = await run(graphStore, {});
    // 上界 = 3 × 2 = 6
    expect(result.invariantViolations.find((v) => v.name === 'enemy_count_exceeds_upper_bound')).toBeUndefined();
  });
});

describe('enemySpawnMirror - 可复现性', () => {
  let graphStore: ReturnType<typeof useGraphStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    graphStore = useGraphStore();
  });

  it('相同 graph + 默认 seed 产生相同输出', async () => {
    graphStore.upsertNodes([
      makeRegionNode(1, null, null),
      makeTileNode(1, 1, 'shallow', true),
      makeTileNode(1, 2, 'deep', true),
      makeEnemyNode('ene1', 1, ['shallow', 'deep'], 1),
    ]);

    const r1 = await run(graphStore, {});
    const r2 = await run(graphStore, {});

    expect(r1.output).toEqual(r2.output);
    expect(r1.invariantViolations).toEqual(r2.invariantViolations);
  });

  it('使用固定 seed 20240605', () => {
    expect(ENEMY_SPAWN_DEFAULT_SEED).toBe(20240605);
  });
});

describe('enemySpawnMirror - PlacedEnemy 字段', () => {
  let graphStore: ReturnType<typeof useGraphStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    graphStore = useGraphStore();
  });

  it('每个 PlacedEnemy 含 pgroup + pls + enemy_type', async () => {
    graphStore.upsertNodes([
      makeRegionNode(1, null, null),
      makeTileNode(1, 1, 'shallow', true),
      makeTileNode(1, 2, 'shallow', true),
      makeEnemyNode('ene1', 5, ['shallow'], 1),
    ]);
    const result = await run(graphStore, {});
    const output = result.output as EnemySpawnMirrorOutput;

    for (const e of output.placedEnemies) {
      expect(e.pgroup).toBe(1);
      expect(e.enemy_type).toBe(5);
      expect(e.pls).toBeGreaterThanOrEqual(1);
      expect(e.pls).toBeLessThanOrEqual(2);
    }
  });
});
