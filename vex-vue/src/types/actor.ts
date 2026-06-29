/** 角色小人类型 */
export type ActorKind = 'player' | 'npc' | 'enemy';

/** 角色小人数据 */
export interface Actor {
  /** 唯一 ID（player / enemy-{pid} / npc-{pid}） */
  id: string;
  /** 角色类型 */
  kind: ActorKind;
  /** 所在位置 ID（pls） */
  pls: string | number;
  /** 立绘图片 URL */
  img: string;
}
