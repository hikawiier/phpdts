// ══════════════════════════════════════════════════
// 玩家小人动画意图类型
//
// 事件源层（battle.ts / map.ts / player.ts / 调试按钮）调用 store action，
// store 派发意图，composable 的 INTENT_HANDLERS 映射到具体 GSAP 动画。
//
// 当前所有非 die/fall/popup 意图都映射到 idle（沿用现有特效）。
// 未来扩展：在 INTENT_HANDLERS 中替换 handler 即可，事件层和 store 零改动。
// ══════════════════════════════════════════════════

export type PlayerAvatarIntent =
  | 'enter'         // 入场（首次加载）
  | 'move'          // 移动到新格
  | 'battle-start'  // 战斗开始（主动攻击或被动遭遇）
  | 'battle-end'    // 战斗结束
  | 'hit'           // 玩家受击（真实掉血）
  | 'die'           // 玩家死亡
  | 'low-hp'        // HP 进入危险区（< 30%）
  | 'normal-hp'     // HP 恢复到安全区（≥ 30%）
  | 'popup'         // 调试：弹起
  | 'fall'          // 调试：倒下
  | 'idle';         // 兜底：重置到 idle
