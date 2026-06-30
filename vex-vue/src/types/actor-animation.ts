// ══════════════════════════════════════════════════
// ActorAnimation 类型定义
//
// 独立存放于 types/ 目录，避免 useMapEntities ↔ useActorAnimation 循环依赖。
// useActorAnimation.ts 实现 ActorAnimation 接口并 re-export 本类型。
// ══════════════════════════════════════════════════

/** 移动分级（供调用方判断，moveTo 内部不决策长距离） */
export type MoveTier = 'duck' | 'jump' | 'long';

/** 攻击类型（近战冲撞 / 远程姿势） */
export type AttackKind = 'melee' | 'ranged';

/**
 * 动作动画规格 — 按 action_id 驱动 collision 阶段的时序与动画类型
 *
 * 时序模型：
 *   0s ──→ attacker.impactAt ──→ target.duration 结束
 *   │           │                  │
 *   攻击动画开始  命中时刻            受击完成
 *               │
 *               └─ 受击动画开始
 *
 * 攻击后摇（impactAt ~ 攻击动画结束）与受击动画重叠播放，节奏紧凑。
 * 新增动作（如 ranged/charge-cast）时在 action-specs.ts 扩展规格表，无需改 battle.ts。
 */
export interface ActionAnimationSpec {
  /** 攻击者动画规格 */
  attacker: {
    /** 攻击类型（决定 attackAnim 分支） */
    kind: AttackKind;
    /** 命中时刻（毫秒）— 攻击动画开始到此时刻，到点才触发受击 */
    impactAt: number;
  };
  /** 受击者动画规格 */
  target: {
    /** 受击动画时长+缓冲（毫秒）— impactAt 后等待此时长，确保受击播完 */
    duration: number;
  };
}

/**
 * 每 actor 独立动画控制器接口
 *
 * 封装 isMoving / animToken 竞态保护，每 actor 实例独立。
 * player 和敌人移动互不干扰，未来战斗碰撞可独立 kill。
 */
export interface ActorAnimation {
  /** 命令式注入/更新 el（替代响应式 ref，避免普通 Map 无响应式问题） */
  setEl(el: HTMLElement | null): void;
  /** 首次入场 / 强调到达：setDown + popUp */
  enter(onUp?: () => void): void;
  /** 跨区域到达：淡入弹起（无倒下阶段） */
  arrive(): void;
  /**
   * 移动到指定坐标（仅处理鸭子步/跳跃，长距离由调用方判断后走 enter/arrive）
   * 内部封装 animToken 竞态保护 + done 回调（startIdle + updateEntityZIndex）
   */
  moveTo(toX: number, toY: number, cellW: number, cellH: number, onDone?: () => void): void;
  /** 预锁定 isMoving=true（防止 rAF 前 syncEntityPosition 瞬移） */
  lockMove(): void;
  /** 解除预锁定（降级/区域切换/长距离分支调用，恢复正常同步） */
  unlockMove(): void;
  /** 进入 idle 循环 */
  idle(): void;
  /** 倒下 */
  playFall(onDown?: () => void): void;
  /** 淡出消失（NPC 从视野消失时调用，由 TransitionGroup leave 钩子触发） */
  playFadeOut(onDone?: () => void): void;
  /** 受击摇晃（direction: 1 右偏 / -1 左偏 / 0 仅压缩） */
  playHit(direction?: 1 | -1 | 0): void;
  /** 攻击冲撞（targetPosition 用于计算方向，kind 区分近战/远程） */
  playAttack(targetPosition?: { x: number; y: number }, kind?: AttackKind): void;
  /** 获取当前 GSAP transform 位置（供战斗系统计算碰撞轨迹） */
  getPosition(): { x: number; y: number };
  /** 获取当前 el（供战斗系统操作 DOM） */
  getEl(): HTMLElement | null;
  /** 杀掉所有 tween（供战斗系统接管） */
  killAll(): void;
  /** 是否正在移动动画中（供 syncEntityPosition 跳过同步） */
  readonly isMoving: boolean;
}
