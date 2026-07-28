//
// 注册表单元测试（M8 主题生成器）
//
// 覆盖点：
//   - registerGenerator：新注册返回 true，覆盖注册返回 false
//   - registerGenerator：空 ID / 无 id 抛错
//   - registerGenerators：批量注册
//   - getGenerator：按 ID 获取，未注册返回 undefined
//   - listGenerators：按 ID 字典序返回
//   - hasGenerators：空 / 非空判断
//   - clearRegistry：清空（测试隔离用）

import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerGenerator,
  registerGenerators,
  getGenerator,
  listGenerators,
  hasGenerators,
  clearRegistry,
} from '@/services/generators/registry';
import type { Generator, GeneratorParams, GeneratorFullResult, GeneratorRegionResult, Pls } from '@/shared';

class MockGenerator implements Generator {
  constructor(
    public readonly id: string,
    public readonly name: string = `Mock ${id}`,
    public readonly description: string = '',
  ) {}
  getParamSchema() { return []; }
  getDefaultParams(): GeneratorParams { return {}; }
  generate(): GeneratorFullResult {
    return { regions: {}, grids: {}, tiles: {} };
  }
  generateRegion(
    _params: GeneratorParams,
    _seed: number | undefined,
    _existingPgroups: Pls[],
  ): GeneratorRegionResult {
    throw new Error('not implemented');
  }
}

describe('generators/registry', () => {
  beforeEach(() => {
    clearRegistry();
  });

  it('空 registry: hasGenerators=false / listGenerators=[]', () => {
    expect(hasGenerators()).toBe(false);
    expect(listGenerators()).toEqual([]);
  });

  it('registerGenerator: 新注册返回 true', () => {
    const isNew = registerGenerator(new MockGenerator('a'));
    expect(isNew).toBe(true);
    expect(hasGenerators()).toBe(true);
  });

  it('registerGenerator: 覆盖注册返回 false', () => {
    registerGenerator(new MockGenerator('a', 'First'));
    const isNew = registerGenerator(new MockGenerator('a', 'Second'));
    expect(isNew).toBe(false);
    expect(getGenerator('a')?.name).toBe('Second');
  });

  it('registerGenerator: 空 id 抛错', () => {
    expect(() => registerGenerator(new MockGenerator(''))).toThrow();
  });

  it('registerGenerator: falsy 实例抛错', () => {
    expect(() => registerGenerator(null as unknown as Generator)).toThrow();
  });

  it('registerGenerators: 批量注册', () => {
    registerGenerators([
      new MockGenerator('a'),
      new MockGenerator('b'),
      new MockGenerator('c'),
    ]);
    expect(listGenerators().map((g) => g.id)).toEqual(['a', 'b', 'c']);
  });

  it('getGenerator: 未注册返回 undefined', () => {
    expect(getGenerator('not-exist')).toBeUndefined();
  });

  it('listGenerators: 按 ID 字典序返回', () => {
    registerGenerators([
      new MockGenerator('c'),
      new MockGenerator('a'),
      new MockGenerator('b'),
    ]);
    const ids = listGenerators().map((g) => g.id);
    expect(ids).toEqual(['a', 'b', 'c']);
  });

  it('clearRegistry: 清空', () => {
    registerGenerators([new MockGenerator('a'), new MockGenerator('b')]);
    expect(hasGenerators()).toBe(true);
    clearRegistry();
    expect(hasGenerators()).toBe(false);
    expect(listGenerators()).toEqual([]);
  });
});
