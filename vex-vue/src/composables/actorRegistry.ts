// ══════════════════════════════════════════════════
// actorRegistry — actor 动画控制器注册中心
//
// 模块级单例 Map，作为 battle.ts（store）与 useMapEntities（composable）之间的解耦层。
// battle.ts 不依赖 useMapEntities 实例，只依赖这个纯函数模块即可按 id 查询 actor 控制器。
//
// 依赖关系（无循环）：
//   - actorRegistry → 仅依赖类型 types/actor-animation
//   - useActorAnimation → 依赖 actorAnimations + 类型（不依赖 actorRegistry）
//   - useMapEntities → 依赖 useActorAnimation + actorRegistry（注册）
//   - battle.ts → 依赖 actorRegistry（查询）+ playerAvatarStore
// ══════════════════════════════════════════════════

import type { ActorAnimation } from '@/types/actor-animation';

const actors = new Map<string, ActorAnimation>();

/** 注册 actor 控制器（useMapEntities.setEntityRef 在创建控制器后调用） */
export function registerActor(id: string, controller: ActorAnimation): void {
  actors.set(id, controller);
}

/** 注销 actor 控制器（useMapEntities.setEntityRef 在 el 置 null 时调用） */
export function unregisterActor(id: string): void {
  actors.delete(id);
}

/** 按 id 查询 actor 控制器（battle.ts / intent watch 调用） */
export function getActorById(id: string): ActorAnimation | undefined {
  return actors.get(id);
}

/** 仅供调试用：查看所有已注册的 actor */
export function peekActors(): ReadonlyMap<string, ActorAnimation> {
  return actors;
}
