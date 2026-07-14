/**
 * @module K 状态管理层
 */

// ══════════════════════════════════════════════════
// 玩家小人动画意图类型
//
// 事件源层（battle.ts / map.ts / player.ts / 调试按钮）调用 store action，
// store 派发意图，useMapEntities 将其映射为 ActorRuntime command。
//
// 具体动画由 ActorRuntime 的四通道 lease 执行，事件层不直接操作 DOM/GSAP。
// ══════════════════════════════════════════════════

export type PlayerAvatarIntent =
  | 'enter'         // 入场（首次加载）
  | 'move'          // 移动到新格
  | 'battle-start'  // 战斗开始（主动攻击或被动遭遇）
  | 'battle-end'    // 战斗结束
  | 'hit'           // 玩家受击（真实掉血）
  | 'die'           // 玩家死亡
  | 'attack'        // 玩家发动攻击（冲撞）
  | 'flee'          // 玩家逃跑（淡出，不设 isDown）
  | 'revive'        // 玩家复活弹起（复用 enter/popUp）
  | 'low-hp'        // HP 进入危险区（< 30%）
  | 'normal-hp'     // HP 恢复到安全区（≥ 30%）
  | 'popup'         // 调试：弹起
  | 'fall'          // 调试：倒下
  | 'idle';         // 兜底：重置到 idle
