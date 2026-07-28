/**
 * @module O 内容工具箱
 *
 * obl-pick-event 单元测试。
 *
 * 覆盖点（对齐 PHP poi.search.func.php:838-863 边界）：
 *   - 空池返回空字符串
 *   - 非数组返回空字符串
 *   - 单 entry 必选中
 *   - weight 全 0 时均匀随机
 *   - weight 缺失按 1.0 计
 *   - 加权分布：高频 entry 出现次数显著多于低频 entry
 *   - event_id 缺失返回空字符串
 *   - 相同 seed 产生相同选择序列
 */

import { describe, it, expect } from 'vitest';
import { createRng } from '@/shared/algorithms/seed-random';
import { oblPickEvent } from '../obl-pick-event';
import type { PoiEventEntry } from '../types';

describe('oblPickEvent - 边界', () => {
  it('空池返回空字符串', () => {
    const rng = createRng(42);
    expect(oblPickEvent(rng, [])).toBe('');
  });

  it('非数组返回空字符串', () => {
    const rng = createRng(42);
    expect(oblPickEvent(rng, null as unknown as PoiEventEntry[])).toBe('');
    expect(oblPickEvent(rng, undefined as unknown as PoiEventEntry[])).toBe('');
  });

  it('单 entry 必选中', () => {
    const rng = createRng(42);
    const pool: PoiEventEntry[] = [{ event_id: 'trap_trigger', weight: 30 }];
    for (let i = 0; i < 20; i++) {
      expect(oblPickEvent(rng, pool)).toBe('trap_trigger');
    }
  });

  it('event_id 缺失返回空字符串', () => {
    const rng = createRng(42);
    const pool: PoiEventEntry[] = [{ weight: 30 } as PoiEventEntry];
    expect(oblPickEvent(rng, pool)).toBe('');
  });

  it('event_id 为非字符串返回空字符串', () => {
    const rng = createRng(42);
    const pool: PoiEventEntry[] = [
      { event_id: 123 as unknown as string, weight: 30 },
    ];
    expect(oblPickEvent(rng, pool)).toBe('');
  });
});

describe('oblPickEvent - weight 处理', () => {
  it('weight 全 0 时均匀随机', () => {
    const rng = createRng(7);
    const pool: PoiEventEntry[] = [
      { event_id: 'a', weight: 0 },
      { event_id: 'b', weight: 0 },
      { event_id: 'c', weight: 0 },
    ];
    const counts: Record<string, number> = { a: 0, b: 0, c: 0 };
    for (let i = 0; i < 300; i++) {
      const eid = oblPickEvent(rng, pool);
      if (eid) counts[eid] = (counts[eid] ?? 0) + 1;
    }
    // 全 0 时均匀分布：300 次 / 3 个 ≈ 100，宽松校验每个 ≥ 50
    expect(counts.a!).toBeGreaterThan(50);
    expect(counts.b!).toBeGreaterThan(50);
    expect(counts.c!).toBeGreaterThan(50);
    expect(counts.a! + counts.b! + counts.c!).toBe(300);
  });

  it('weight 缺失按 1.0 计', () => {
    const rng = createRng(11);
    const pool: PoiEventEntry[] = [
      { event_id: 'a' }, // weight 缺失，按 1.0
      { event_id: 'b' }, // weight 缺失，按 1.0
    ];
    const counts: Record<string, number> = { a: 0, b: 0 };
    for (let i = 0; i < 200; i++) {
      const eid = oblPickEvent(rng, pool);
      if (eid) counts[eid] = (counts[eid] ?? 0) + 1;
    }
    expect(counts.a!).toBeGreaterThan(60);
    expect(counts.b!).toBeGreaterThan(60);
  });

  it('加权分布：高频 entry 出现次数显著多于低频 entry', () => {
    const rng = createRng(99);
    const pool: PoiEventEntry[] = [
      { event_id: 'common', weight: 90 },
      { event_id: 'rare', weight: 10 },
    ];
    const counts: Record<string, number> = { common: 0, rare: 0 };
    for (let i = 0; i < 1000; i++) {
      const eid = oblPickEvent(rng, pool);
      if (eid) counts[eid] = (counts[eid] ?? 0) + 1;
    }
    // 90:10 分布，1000 次 → common ≈ 900，rare ≈ 100
    expect(counts.common!).toBeGreaterThan(counts.rare! * 5);
    expect(counts.common! + counts.rare!).toBe(1000);
  });

  it('三个 entry 加权分布正确', () => {
    const rng = createRng(2024);
    const pool: PoiEventEntry[] = [
      { event_id: 'trap_trigger', weight: 60, kind: 'bad' },
      { event_id: 'structure_collapse', weight: 30, kind: 'bad' },
      { event_id: 'find_extra_cache', weight: 10, kind: 'good' },
    ];
    const counts: Record<string, number> = {
      trap_trigger: 0,
      structure_collapse: 0,
      find_extra_cache: 0,
    };
    for (let i = 0; i < 1000; i++) {
      const eid = oblPickEvent(rng, pool);
      if (eid) counts[eid] = (counts[eid] ?? 0) + 1;
    }
    expect(counts.trap_trigger!).toBeGreaterThan(500);
    expect(counts.structure_collapse!).toBeGreaterThan(200);
    expect(counts.find_extra_cache!).toBeGreaterThan(50);
    expect(counts.trap_trigger!).toBeGreaterThan(counts.structure_collapse!);
    expect(counts.structure_collapse!).toBeGreaterThan(counts.find_extra_cache!);
  });

  it('负 weight 触发均匀随机', () => {
    const rng = createRng(33);
    const pool: PoiEventEntry[] = [
      { event_id: 'a', weight: -5 },
      { event_id: 'b', weight: -5 },
    ];
    const counts: Record<string, number> = { a: 0, b: 0 };
    for (let i = 0; i < 200; i++) {
      const eid = oblPickEvent(rng, pool);
      if (eid) counts[eid] = (counts[eid] ?? 0) + 1;
    }
    // totalWeight = -10 <= 0 → 均匀随机
    expect(counts.a!).toBeGreaterThan(50);
    expect(counts.b!).toBeGreaterThan(50);
  });
});

describe('oblPickEvent - 可复现性', () => {
  it('相同 seed 产生相同选择序列', () => {
    const pool: PoiEventEntry[] = [
      { event_id: 'a', weight: 1 },
      { event_id: 'b', weight: 2 },
      { event_id: 'c', weight: 3 },
    ];
    const rng1 = createRng(42);
    const rng2 = createRng(42);
    const seq1: string[] = [];
    const seq2: string[] = [];
    for (let i = 0; i < 50; i++) {
      seq1.push(oblPickEvent(rng1, pool));
      seq2.push(oblPickEvent(rng2, pool));
    }
    expect(seq1).toEqual(seq2);
  });
});
