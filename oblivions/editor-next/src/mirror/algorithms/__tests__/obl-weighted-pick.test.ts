/**
 * @module O 内容工具箱
 *
 * obl-weighted-pick 单元测试。
 *
 * 覆盖点（对齐 PHP loot.engine.func.php:219-239 边界）：
 *   - 空列表返回 undefined
 *   - weight 全 0 时均匀随机（不抛错）
 *   - weight 缺失按 1.0 计
 *   - 单 entry 必选中
 *   - 加权分布：高频 entry 出现次数显著多于低频 entry
 *   - 浮点累加误差兜底（不丢失 entry）
 */

import { describe, it, expect } from 'vitest';
import { createRng } from '@/shared/algorithms/seed-random';
import { oblWeightedPick, type WeightedEntry } from '../obl-weighted-pick';

interface TestEntry extends WeightedEntry {
  item_id: string;
}

describe('oblWeightedPick', () => {
  it('空列表返回 undefined', () => {
    const rng = createRng(42);
    expect(oblWeightedPick<TestEntry>(rng, [])).toBeUndefined();
  });

  it('单 entry 必选中', () => {
    const rng = createRng(42);
    const entries: TestEntry[] = [{ item_id: 'a', weight: 10 }];
    for (let i = 0; i < 20; i++) {
      expect(oblWeightedPick(rng, entries)?.item_id).toBe('a');
    }
  });

  it('weight 全 0 时均匀随机（不抛错）', () => {
    const rng = createRng(7);
    const entries: TestEntry[] = [
      { item_id: 'a', weight: 0 },
      { item_id: 'b', weight: 0 },
      { item_id: 'c', weight: 0 },
    ];
    const counts: Record<string, number> = { a: 0, b: 0, c: 0 };
    for (let i = 0; i < 300; i++) {
      const picked = oblWeightedPick(rng, entries);
      if (picked) counts[picked.item_id] = (counts[picked.item_id] ?? 0) + 1;
    }
    // 全 0 时均匀分布：300 次 / 3 个 ≈ 100，宽松校验每个 ≥ 50
    expect(counts.a!).toBeGreaterThan(50);
    expect(counts.b!).toBeGreaterThan(50);
    expect(counts.c!).toBeGreaterThan(50);
    expect(counts.a! + counts.b! + counts.c!).toBe(300);
  });

  it('weight 缺失按 1.0 计', () => {
    const rng = createRng(11);
    const entries: TestEntry[] = [
      { item_id: 'a' }, // weight 缺失，按 1.0
      { item_id: 'b' }, // weight 缺失，按 1.0
    ];
    const counts: Record<string, number> = { a: 0, b: 0 };
    for (let i = 0; i < 200; i++) {
      const picked = oblWeightedPick(rng, entries);
      if (picked) counts[picked.item_id] = (counts[picked.item_id] ?? 0) + 1;
    }
    // 两个权重 1.0 的 entry 应大致均匀分布
    expect(counts.a!).toBeGreaterThan(60);
    expect(counts.b!).toBeGreaterThan(60);
  });

  it('加权分布：高频 entry 出现次数显著多于低频 entry', () => {
    const rng = createRng(99);
    const entries: TestEntry[] = [
      { item_id: 'common', weight: 90 },
      { item_id: 'rare', weight: 10 },
    ];
    const counts: Record<string, number> = { common: 0, rare: 0 };
    for (let i = 0; i < 1000; i++) {
      const picked = oblWeightedPick(rng, entries);
      if (picked) counts[picked.item_id] = (counts[picked.item_id] ?? 0) + 1;
    }
    // 90:10 分布，1000 次 → common ≈ 900，rare ≈ 100
    // 宽松校验：common 至少是 rare 的 5 倍
    expect(counts.common!).toBeGreaterThan(counts.rare! * 5);
    expect(counts.common! + counts.rare!).toBe(1000);
  });

  it('负 weight 不被特殊处理（参与累加，可能造成 totalWeight <= 0 触发均匀随机）', () => {
    // PHP (float)$e['weight'] 不拒绝负数；totalWeight <= 0 触发均匀随机
    const rng = createRng(33);
    const entries: TestEntry[] = [
      { item_id: 'a', weight: -5 },
      { item_id: 'b', weight: -5 },
    ];
    const counts: Record<string, number> = { a: 0, b: 0 };
    for (let i = 0; i < 200; i++) {
      const picked = oblWeightedPick(rng, entries);
      if (picked) counts[picked.item_id] = (counts[picked.item_id] ?? 0) + 1;
    }
    // totalWeight = -10 <= 0 → 均匀随机
    expect(counts.a!).toBeGreaterThan(50);
    expect(counts.b!).toBeGreaterThan(50);
  });

  it('三个 entry 加权分布正确', () => {
    const rng = createRng(2024);
    const entries: TestEntry[] = [
      { item_id: 'x', weight: 60 },
      { item_id: 'y', weight: 30 },
      { item_id: 'z', weight: 10 },
    ];
    const counts: Record<string, number> = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < 1000; i++) {
      const picked = oblWeightedPick(rng, entries);
      if (picked) counts[picked.item_id] = (counts[picked.item_id] ?? 0) + 1;
    }
    // 60:30:10 分布 → x ≈ 600, y ≈ 300, z ≈ 100
    expect(counts.x!).toBeGreaterThan(500);
    expect(counts.y!).toBeGreaterThan(200);
    expect(counts.z!).toBeGreaterThan(50);
    expect(counts.x!).toBeGreaterThan(counts.y!);
    expect(counts.y!).toBeGreaterThan(counts.z!);
  });

  it('相同 seed 产生相同选择序列', () => {
    const entries: TestEntry[] = [
      { item_id: 'a', weight: 1 },
      { item_id: 'b', weight: 2 },
      { item_id: 'c', weight: 3 },
    ];
    const rng1 = createRng(42);
    const rng2 = createRng(42);
    const seq1: string[] = [];
    const seq2: string[] = [];
    for (let i = 0; i < 50; i++) {
      seq1.push(oblWeightedPick(rng1, entries)!.item_id);
      seq2.push(oblWeightedPick(rng2, entries)!.item_id);
    }
    expect(seq1).toEqual(seq2);
  });
});
