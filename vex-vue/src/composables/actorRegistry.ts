/**
 * @module M 组合式函数
 * @framework M-1 租赁式动画架构
 */

// ══════════════════════════════════════════════════
// actorRegistry — actor 动画控制器注册中心
//
// 模块级单例 Map，作为 battle.ts（store）与 useMapEntities（composable）之间的解耦层。
// battle.ts 不依赖 useMapEntities 实例，只依赖这个纯函数模块即可按 id 查询 actor 控制器。
//
// 依赖关系（无循环）：
//   - actorRegistry → 仅依赖类型 types/actor-runtime
//   - useActorRuntime → 依赖 actorAnimations + 类型（不依赖 actorRegistry）
//   - useMapEntities → 依赖 useActorRuntime + actorRegistry（注册）
//   - battle.ts → 依赖 actorRegistry（查询）+ playerAvatarStore
// ══════════════════════════════════════════════════

import type { ActorRuntime } from '@/types/actor-runtime';
import { actorTraceEnabled, debugBus } from '@/composables/useDebugBus';

const actors = new Map<string, ActorRuntime>();

/** 注册 actor 控制器（useMapEntities.setEntityRef 在创建控制器后调用） */
export function registerActor(id: string, controller: ActorRuntime): void {
  const existing = actors.get(id);
  if (existing && existing !== controller) existing.dispose();
  actors.set(id, controller);
  if (actorTraceEnabled) {
    debugBus.emit('actor', 'registry:register', {
      actorId: id,
      generation: controller.generation,
      replacedGeneration: existing?.generation ?? null,
    });
  }
}

/** 注销 actor 控制器（useMapEntities.setEntityRef 在 el 置 null 时调用） */
export function unregisterActor(id: string): void {
  const actor = actors.get(id);
  if (actorTraceEnabled) {
    debugBus.emit('actor', 'registry:unregister', {
      actorId: id,
      generation: actor?.generation ?? null,
      existed: Boolean(actor),
    });
  }
  actor?.dispose();
  actors.delete(id);
}

/** 按 id 查询 actor 控制器（battle.ts / intent watch 调用） */
export function getActorById(id: string): ActorRuntime | undefined {
  return actors.get(id);
}

/** 仅供调试用：查看所有已注册的 actor */
export function peekActors(): ReadonlyMap<string, ActorRuntime> {
  return actors;
}
