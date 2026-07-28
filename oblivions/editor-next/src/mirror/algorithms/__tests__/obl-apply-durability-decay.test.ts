/**
 * @module O 内容工具箱
 *
 * obl-apply-durability-decay 单元测试。
 *
 * 覆盖点（对齐 PHP loot.engine.func.php:290-312 边界）：
 *   - 空列表返回空数组
 *   - stackable 物品跳过（itms 不变）
 *   - 非_stackable + itms='∞' 保留 ∞
 *   - 非_stackable + itms 为正数 → 衰减到 [1, max]
 *   - 非_stackable + itms=0 保留 0
 *   - 非_stackable + itms 为负值 保留原值
 *   - 非_stackable + itms 为非数值 保留原值
 *   - 模板缺失保留原值
 *   - 纯函数：输入不被修改
 */

import { describe, it, expect } from 'vitest';
import { createRng } from '@/shared/algorithms/seed-random';
import { oblApplyDurabilityDecay } from '../obl-apply-durability-decay';
import type { ItemInstance, ItemTable } from '../types';

function makeInstance(itmid: string, itms: string): ItemInstance {
  return {
    itm: '',
    itmk: 'WP',
    itme: 10,
    itms,
    itmsk: '',
    itmpara: [],
    itmid,
  };
}

const itemTable: ItemTable = {
  // 非 stackable 装备
  rusty_pipe: { itmk: 'WP', itme: 5, itms: '20', itmsk: '', itmpara: '', stack: false },
  // stackable 数量模型
  scrap_metal: { itmk: 'MT', itme: 0, itms: '1', itmsk: '', itmpara: '', stack: true, stack_limit: 99 },
  // 无限耐久物品
  compass: { itmk: 'TK', itme: 0, itms: '∞', itmsk: '', itmpara: '', stack: false },
  // itms 为 0 的非 stackable（防御性）
  broken_wep: { itmk: 'WP', itme: 0, itms: '0', itmsk: '', itmpara: '', stack: false },
};

describe('oblApplyDurabilityDecay', () => {
  it('空列表返回空数组', () => {
    const rng = createRng(42);
    const result = oblApplyDurabilityDecay([], itemTable, rng);
    expect(result).toEqual([]);
  });

  it('stackable 物品跳过（itms 不变）', () => {
    const rng = createRng(42);
    const items = [makeInstance('scrap_metal', '15')];
    const result = oblApplyDurabilityDecay(items, itemTable, rng);
    expect(result[0]!.itms).toBe('15');
  });

  it('非 stackable + itms=\'∞\' 保留 ∞', () => {
    const rng = createRng(42);
    const items = [makeInstance('compass', '∞')];
    const result = oblApplyDurabilityDecay(items, itemTable, rng);
    expect(result[0]!.itms).toBe('∞');
  });

  it('非 stackable + itms 为正数 → 衰减到 [1, max]', () => {
    const rng = createRng(42);
    const max = 20;
    const items = [makeInstance('rusty_pipe', String(max))];
    for (let i = 0; i < 50; i++) {
      const result = oblApplyDurabilityDecay(items, itemTable, rng);
      const decayed = parseInt(result[0]!.itms, 10);
      expect(decayed).toBeGreaterThanOrEqual(1);
      expect(decayed).toBeLessThanOrEqual(max);
    }
  });

  it('非 stackable + itms=0 保留 0', () => {
    const rng = createRng(42);
    const items = [makeInstance('broken_wep', '0')];
    const result = oblApplyDurabilityDecay(items, itemTable, rng);
    expect(result[0]!.itms).toBe('0');
  });

  it('非 stackable + itms 为负值 保留原值', () => {
    const rng = createRng(42);
    const items = [makeInstance('rusty_pipe', '-5')];
    const result = oblApplyDurabilityDecay(items, itemTable, rng);
    expect(result[0]!.itms).toBe('-5');
  });

  it('非 stackable + itms 为非数值 保留原值', () => {
    const rng = createRng(42);
    const items = [makeInstance('rusty_pipe', 'abc')];
    const result = oblApplyDurabilityDecay(items, itemTable, rng);
    expect(result[0]!.itms).toBe('abc');
  });

  it('模板缺失保留原值', () => {
    const rng = createRng(42);
    const items = [makeInstance('nonexistent_item', '20')];
    const result = oblApplyDurabilityDecay(items, itemTable, rng);
    expect(result[0]!.itms).toBe('20');
  });

  it('纯函数：输入数组不被修改', () => {
    const rng = createRng(42);
    const original = makeInstance('rusty_pipe', '20');
    const items = [original];
    oblApplyDurabilityDecay(items, itemTable, rng);
    expect(original.itms).toBe('20');
  });

  it('混合列表：stackable 跳过 + 非 stackable 衰减 + ∞ 保留', () => {
    const rng = createRng(42);
    const items = [
      makeInstance('scrap_metal', '15'),     // stackable, 保留
      makeInstance('rusty_pipe', '20'),      // 非 stackable, 衰减
      makeInstance('compass', '∞'),          // ∞, 保留
      makeInstance('broken_wep', '0'),       // 0, 保留
    ];
    const result = oblApplyDurabilityDecay(items, itemTable, rng);
    expect(result[0]!.itms).toBe('15');       // stackable 不变
    expect(result[1]!.itms).not.toBe('20');   // 衰减后不再是 20
    expect(parseInt(result[1]!.itms, 10)).toBeGreaterThanOrEqual(1);
    expect(parseInt(result[1]!.itms, 10)).toBeLessThanOrEqual(20);
    expect(result[2]!.itms).toBe('∞');        // ∞ 保留
    expect(result[3]!.itms).toBe('0');        // 0 保留
  });

  it('相同 seed 产生相同衰减结果', () => {
    const items = [makeInstance('rusty_pipe', '20')];
    const rng1 = createRng(42);
    const rng2 = createRng(42);
    const seq1: string[] = [];
    const seq2: string[] = [];
    for (let i = 0; i < 20; i++) {
      seq1.push(oblApplyDurabilityDecay(items, itemTable, rng1)[0]!.itms);
      seq2.push(oblApplyDurabilityDecay(items, itemTable, rng2)[0]!.itms);
    }
    expect(seq1).toEqual(seq2);
  });
});
