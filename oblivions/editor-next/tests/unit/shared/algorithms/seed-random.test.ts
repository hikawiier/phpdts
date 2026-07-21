//
// seed-random 单元测试示例（对齐 NEW_DESIGN.md §4.1：每条规则至少 1 正例 + 1 反例）

import { describe, it, expect } from 'vitest';
import { createRng, roll, pick, randInt } from '@/shared/algorithms/seed-random';

describe('createRng / mulberry32', () => {
  it('相同种子产生相同序列', () => {
    const a = createRng(42);
    const b = createRng(42);
    const seqA = [a.next(), a.next(), a.next()];
    const seqB = [b.next(), b.next(), b.next()];
    expect(seqA).toEqual(seqB);
  });

  it('不同种子产生不同序列', () => {
    const a = createRng(1);
    const b = createRng(2);
    const seqA = [a.next(), a.next(), a.next()];
    const seqB = [b.next(), b.next(), b.next()];
    expect(seqA).not.toEqual(seqB);
  });

  it('输出始终在 [0, 1) 区间', () => {
    const rng = createRng(123);
    for (let i = 0; i < 100; i++) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('未指定种子（Math.random 回退）不抛错', () => {
    const rng = createRng();
    expect(typeof rng.next()).toBe('number');
  });
});

describe('roll', () => {
  it('rate=1 永远命中', () => {
    const rng = createRng(42);
    for (let i = 0; i < 50; i++) {
      expect(roll(rng, 1)).toBe(true);
    }
  });

  it('rate=0 永远不命中', () => {
    const rng = createRng(42);
    for (let i = 0; i < 50; i++) {
      expect(roll(rng, 0)).toBe(false);
    }
  });

  it('rate=0.5 在 [0,1) 范围内随机', () => {
    const rng = createRng(42);
    let hits = 0;
    for (let i = 0; i < 1000; i++) {
      if (roll(rng, 0.5)) hits++;
    }
    // 大数定律：1000 次命中数应在 500 ± 5σ 内
    expect(hits).toBeGreaterThan(400);
    expect(hits).toBeLessThan(600);
  });
});

describe('pick', () => {
  it('从非空数组中返回数组元素', () => {
    const rng = createRng(7);
    const arr = [10, 20, 30, 40, 50];
    for (let i = 0; i < 20; i++) {
      const value = pick(rng, arr);
      expect(arr).toContain(value);
    }
  });

  it('空数组返回 undefined（不抛错）', () => {
    const rng = createRng(7);
    expect(pick(rng, [])).toBeUndefined();
  });
});

describe('randInt', () => {
  it('返回值在 [min, max] 闭区间', () => {
    const rng = createRng(99);
    for (let i = 0; i < 200; i++) {
      const value = randInt(rng, 5, 10);
      expect(value).toBeGreaterThanOrEqual(5);
      expect(value).toBeLessThanOrEqual(10);
    }
  });

  it('min === max 时只返回该值', () => {
    const rng = createRng(99);
    for (let i = 0; i < 20; i++) {
      expect(randInt(rng, 7, 7)).toBe(7);
    }
  });
});
