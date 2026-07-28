/**
 * @module O 内容工具箱
 *
 * loot-roll-mirror 单元测试。
 *
 * 覆盖点（对齐执行案 §4.2.4）：
 *   - 空 graph 返回空输出且无不变量违反
 *   - 正常 graph：每个 loot.table 跑 N 次掷骰
 *   - distribution 聚合所有 table 的 item 频次
 *   - 不变量：entries 总数 ≤ OBL_LOOT_MAX_ENTRIES=100
 *   - 不变量：group chance 在 [0,1] 范围
 *   - N=1000 次掷骰，统计显著
 *   - 固定 seed 可复现
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useGraphStore } from '@/graph/graph-store';
import {
  run,
  lootRollMirror,
  LOOT_ROLL_MIRROR_ID,
  LOOT_ROLL_DEFAULT_SEED,
  LOOT_ROLL_N,
  type LootRollMirrorOutput,
} from '../loot-roll-mirror';
import type { ResourceNode } from '@/graph/types';

// ─── 测试数据 ───────────────────────────────────────────────────

function makeLootTableNode(
  id: string,
  groups: Array<{
    chance?: number;
    entries: Array<{ item_id: string; weight?: number; count?: number | [number, number] }>;
  }>,
  durabilityDecay?: boolean,
): ResourceNode {
  return {
    kind: 'loot.table',
    id,
    data: {
      name: id,
      durability_decay: durabilityDecay ?? false,
      groups,
    },
    source: [],
    revision: '',
  };
}

function makeItemNode(id: string, stack: boolean = true): ResourceNode {
  return {
    kind: 'item.template',
    id,
    data: {
      itmk: stack ? 'MT' : 'WP',
      itme: 10,
      itms: stack ? '10' : '20',
      itmsk: '',
      itmpara: '',
      stack,
    },
    source: [],
    revision: '',
  };
}

// ─── 测试用例 ───────────────────────────────────────────────────

describe('lootRollMirror - 元信息', () => {
  it('ID 正确', () => {
    expect(lootRollMirror.id).toBe(LOOT_ROLL_MIRROR_ID);
    expect(LOOT_ROLL_MIRROR_ID).toBe('loot-roll');
  });

  it('requiredScopes 包含 player_inventory / debug_player_full', () => {
    expect(lootRollMirror.requiredScopes).toContain('player_inventory');
    expect(lootRollMirror.requiredScopes).toContain('debug_player_full');
  });

  it('compareOptions 分布容忍度 5%', () => {
    expect(lootRollMirror.compareOptions.countTolerance).toBe(0.05);
    expect(lootRollMirror.compareOptions.distributionTolerance).toBe(0.05);
  });
});

describe('lootRollMirror - run 边界', () => {
  let graphStore: ReturnType<typeof useGraphStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    graphStore = useGraphStore();
  });

  it('空 graph 返回空输出且无不变量违反', async () => {
    const result = await run(graphStore, {});
    expect(result.output).not.toBeNull();
    const output = result.output as LootRollMirrorOutput;
    expect(output.count).toBe(0);
    expect(output.tableResults).toEqual([]);
    expect(output.totalTables).toBe(0);
    expect(result.invariantViolations).toEqual([]);
  });

  it('无 loot.table 节点但有 item.template 节点时返回空', async () => {
    graphStore.upsertNodes([makeItemNode('item_a')]);
    const result = await run(graphStore, {});
    const output = result.output as LootRollMirrorOutput;
    expect(output.count).toBe(0);
    expect(output.totalTables).toBe(0);
  });
});

describe('lootRollMirror - 正常路径', () => {
  let graphStore: ReturnType<typeof useGraphStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    graphStore = useGraphStore();
  });

  it('每个 loot.table 跑 N=1000 次掷骰', async () => {
    graphStore.upsertNodes([
      makeLootTableNode('table1', [
        {
          chance: 1.0,
          entries: [
            { item_id: 'item_a', weight: 1, count: 1 },
            { item_id: 'item_b', weight: 1, count: 1 },
          ],
        },
      ]),
      makeItemNode('item_a'),
      makeItemNode('item_b'),
    ]);
    const result = await run(graphStore, {});
    const output = result.output as LootRollMirrorOutput;

    expect(output.totalTables).toBe(1);
    expect(output.tableResults).toHaveLength(1);
    expect(output.tableResults[0]!.totalRolls).toBe(LOOT_ROLL_N);
    expect(LOOT_ROLL_N).toBe(1000);
  });

  it('distribution 聚合所有 table 的 item 频次', async () => {
    graphStore.upsertNodes([
      makeLootTableNode('table1', [
        {
          chance: 1.0,
          entries: [{ item_id: 'item_a', weight: 1, count: 1 }],
        },
      ]),
      makeLootTableNode('table2', [
        {
          chance: 1.0,
          entries: [{ item_id: 'item_a', weight: 1, count: 1 }],
        },
      ]),
      makeItemNode('item_a'),
    ]);
    const result = await run(graphStore, {});
    const output = result.output as LootRollMirrorOutput;

    // 两个 table 都掷出 item_a，聚合分布中 item_a 应有 2× N 个左右
    expect(output.distribution['item_a']).toBeGreaterThan(0);
    expect(output.count).toBeGreaterThan(0);
  });

  it('高 weight entry 出现频率显著高于低 weight entry', async () => {
    graphStore.upsertNodes([
      makeLootTableNode('table1', [
        {
          chance: 1.0,
          entries: [
            { item_id: 'item_a', weight: 9, count: 1 }, // 90%
            { item_id: 'item_b', weight: 1, count: 1 }, // 10%
          ],
        },
      ]),
      makeItemNode('item_a'),
      makeItemNode('item_b'),
    ]);
    const result = await run(graphStore, {});
    const output = result.output as LootRollMirrorOutput;

    const freqA = output.tableResults[0]!.itemFrequencies['item_a'] ?? 0;
    const freqB = output.tableResults[0]!.itemFrequencies['item_b'] ?? 0;
    expect(freqA).toBeGreaterThan(freqB);
    // 9:1 权重比，1000 次掷骰下 freqA 应该 >> freqB
    expect(freqA / Math.max(freqB, 1)).toBeGreaterThan(3);
  });
});

describe('lootRollMirror - 不变量', () => {
  let graphStore: ReturnType<typeof useGraphStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    graphStore = useGraphStore();
  });

  it('entries 总数 ≤ 100 时不 emit 违反', async () => {
    const entries = [];
    for (let i = 0; i < 50; i++) {
      entries.push({ item_id: `item_${i}`, weight: 1, count: 1 });
    }
    graphStore.upsertNodes([
      makeLootTableNode('table1', [{ chance: 1.0, entries }]),
      ...Array.from({ length: 50 }, (_, i) => makeItemNode(`item_${i}`)),
    ]);
    const result = await run(graphStore, {});
    expect(
      result.invariantViolations.find((v) => v.name === 'loot_entries_exceed_limit'),
    ).toBeUndefined();
  });

  it('group chance 在 [0,1] 范围时不 emit 违反', async () => {
    graphStore.upsertNodes([
      makeLootTableNode('table1', [
        { chance: 0.5, entries: [{ item_id: 'item_a', weight: 1, count: 1 }] },
        { chance: 1.0, entries: [{ item_id: 'item_b', weight: 1, count: 1 }] },
      ]),
      makeItemNode('item_a'),
      makeItemNode('item_b'),
    ]);
    const result = await run(graphStore, {});
    expect(
      result.invariantViolations.find((v) => v.name === 'loot_group_chance_out_of_range'),
    ).toBeUndefined();
  });
});

describe('lootRollMirror - 可复现性', () => {
  let graphStore: ReturnType<typeof useGraphStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    graphStore = useGraphStore();
  });

  it('相同 graph + 默认 seed 产生相同输出', async () => {
    graphStore.upsertNodes([
      makeLootTableNode('table1', [
        {
          chance: 1.0,
          entries: [
            { item_id: 'item_a', weight: 1, count: 1 },
            { item_id: 'item_b', weight: 2, count: 1 },
          ],
        },
      ]),
      makeItemNode('item_a'),
      makeItemNode('item_b'),
    ]);

    const r1 = await run(graphStore, {});
    const r2 = await run(graphStore, {});

    expect(r1.output).toEqual(r2.output);
  });

  it('使用固定 seed 20240603', () => {
    expect(LOOT_ROLL_DEFAULT_SEED).toBe(20240603);
  });
});
