/**
 * @module O 内容工具箱
 * @framework O-2 Schema 注册表
 *
 * Schema 注册表核心。每种资源 kind 通过 KindSchema 声明完整契约，注册后
 * 供 O-3 Resource Graph / O-4 Source Adapter / O-7 模板工作区 / O-10 分层校验
 * 统一查询。
 *
 * 注册时机：main.ts 在 createApp 之前调用 registerAllKinds()（见 ./index.ts）。
 * 重复注册策略：dev 模式立即抛错（捕获开发期 typo）；prod 模式以后者为准并 emit warning，
 * 避免生产环境因重复注册阻断 UI。
 */

import type { KindSchema, ResourceKind } from './types';

const registry = new Map<ResourceKind, KindSchema>();

/**
 * 注册一种资源 kind 的 schema。
 *
 * @param schema 完整 KindSchema 契约
 * @throws dev 模式下重复注册同 kind 立即抛错；prod 模式仅 emit warning 并覆盖
 */
export function registerKind(schema: KindSchema): void {
  const existing = registry.get(schema.kind);
  if (existing !== undefined) {
    if (import.meta.env?.DEV) {
      throw new Error(
        `[O-2] Duplicate kind registration: '${schema.kind}'. ` +
          `Use clearRegistry() in tests between cases.`,
      );
    }
    // prod 模式：以后者为准，emit warning 到 console（生产环境无 debugBus 通道时的兜底）
    // eslint-disable-next-line no-console
    console.warn(
      `[O-2] Duplicate kind registration in prod: '${schema.kind}'. ` +
        `Later schema overrides earlier.`,
    );
  }
  registry.set(schema.kind, schema);
}

/**
 * 查询某种 kind 的 schema。
 * 未注册时返回 undefined，调用方需自行处理（如 O-4 adapter-registry 跳过未注册 kind）。
 */
export function getKindSchema(kind: ResourceKind): KindSchema | undefined {
  return registry.get(kind);
}

/**
 * 列出已注册的全部 kind。供 O-6 总览页统计资源覆盖率使用。
 */
export function listKinds(): ResourceKind[] {
  return Array.from(registry.keys());
}

/**
 * 断言 kind 已注册。用于 O-4 / O-7 / O-10 在已知 kind 必须存在的调用点做契约校验。
 *
 * @throws kind 未注册时抛错
 */
export function assertKind(kind: string): asserts kind is ResourceKind {
  if (!registry.has(kind as ResourceKind)) {
    throw new Error(`[O-2] Unknown resource kind: '${kind}'. Did you registerAllKinds()?`);
  }
}

/**
 * 清空注册表。仅供单元测试使用，避免测试用例间相互污染。
 * 生产代码禁止调用。
 */
export function clearRegistry(): void {
  registry.clear();
}
