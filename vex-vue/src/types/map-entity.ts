/**
 * @module K 状态管理层
 */

// ══════════════════════════════════════════════════
// 地图实体类型定义
//
// 替代 types/actor.ts，泛化支持多实体类型：
//   - actor（玩家/NPC/敌人立绘）
//   - poi（废弃大楼等建筑立绘，未来）
//   - grass（草丛遮挡下半身，未来）
//   - worm（大蠕虫，多格，未来）
//   - crevice（地面裂隙，固定层，未来）
//
// 设计要点：
//   - isDown 不作为 MapEntity 字段
//     玩家 actor 的 isDown 在 useMapEntities.updateEntityZIndex 中
//     实时从 playerAvatarStore.isDown 读取，避免 entities computed
//     依赖 isDown 触发不必要的重算
//   - NPC/敌人初版无 isDown 状态（无 popUp/fall 动画）
// ══════════════════════════════════════════════════

/** 地图实体类型 */
export type EntityKind = 'actor' | 'poi' | 'grass' | 'crevice' | 'worm';

/** 实体层级（用于固定层分配） */
export type EntityLayer =
  | 'ground-deco'      // 地面装饰层（裂隙）
  | 'air-occluder'     // 空中遮挡层（预留）
  | 'y-sorted';        // 参与 Y 排序的层（actor/poi/grass/worm）

/** actor 子类型 */
export type ActorKind = 'player' | 'npc' | 'enemy';

/** 地图实体数据 */
export interface MapEntity {
  /** 唯一 ID（player / enemy-{pid} / npc-{pid} / poi-{pls} / grass-{pls} / worm-{id} / crevice-{pls}） */
  id: string;
  /** 实体类型 */
  kind: EntityKind;
  /** 锚点格位置 ID（pls） */
  pls: string | number;
  /** 锚点所在区域（与 pls 共同组成 TileRef） */
  pgroup: string | number;
  /** 立绘图片 URL */
  img: string;
  /** 水平跨度（占几格宽，默认 1） */
  spanCols?: number;
  /** 垂直跨度（占几格高，默认 1） */
  spanRows?: number;
  /** 立绘相对 cell 高度的比例（默认 actor=1.5, poi=3, grass=0.5, worm=2, crevice=1） */
  imgHeightRatio?: number;

  // ── actor 特有 ──
  /** actor 子类型（仅 kind === 'actor' 时有效） */
  actorKind?: ActorKind;
  /** 角色实体对应的后端 PID */
  characterPid?: number;
  /** 是否在当前战斗中（供渲染层半透明区分：battle 模式下非 inCombat 的 actor 半透明） */
  inCombat?: boolean;
}
