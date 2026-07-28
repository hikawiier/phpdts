// @module O 内容工具箱
//
// 生成器注册表（M8 主题生成器；P1 归入 O-6 世界工作区命令）
//
// 设计意图（对齐 2.6 配置驱动 + 模式 5 注册表架构）：
//   - Map-based 全局注册表：Generator 实现统一接口，通过 registerGenerator 注册到全局 Map
//   - 工具栏自动发现：新生成器无需修改 UI 代码即可注册使用
//   - 编辑器启动时自动扫描注册（在 main.ts 调用各生成器的 register）
//
// 接口契约：
//   - registerGenerator(gen)        注册一个生成器，同 ID 覆盖
//   - registerGenerators(gens)      批量注册
//   - getGenerator(id)              按 ID 获取生成器
//   - listGenerators()              列出所有生成器（按 ID 字典序）
//   - hasGenerators()               是否注册了任意生成器
//   - clearRegistry()               清空注册表（仅供测试使用）

import type { Generator } from '@/shared';

const registry = new Map<string, Generator>();

/**
 * 注册一个生成器
 * 同 ID 重复注册会覆盖旧条目（便于热更新 + 调试）
 * @param generator 实现 Generator 接口的实例
 * @returns true=新注册，false=覆盖已有
 */
export function registerGenerator(generator: Generator): boolean {
  if (!generator || !generator.id) {
    throw new Error('registerGenerator: generator must have non-empty id');
  }
  const isNew = !registry.has(generator.id);
  registry.set(generator.id, generator);
  return isNew;
}

/**
 * 批量注册生成器
 */
export function registerGenerators(generators: Generator[]): void {
  for (const gen of generators) {
    registerGenerator(gen);
  }
}

/**
 * 获取指定 ID 的生成器
 */
export function getGenerator(id: string): Generator | undefined {
  return registry.get(id);
}

/**
 * 列出所有已注册的生成器（按 ID 字典序）
 */
export function listGenerators(): Generator[] {
  const entries: Generator[] = [];
  for (const id of [...registry.keys()].sort()) {
    const gen = registry.get(id);
    if (gen) entries.push(gen);
  }
  return entries;
}

/**
 * 检查是否注册了任意生成器
 */
export function hasGenerators(): boolean {
  return registry.size > 0;
}

/**
 * 清空注册表（仅供测试使用）
 */
export function clearRegistry(): void {
  registry.clear();
}
