// ══════════════════════════════════════════════════
// actorAnimations — 纯动画函数模块
//
// 从 useMapEntities.ts 提取的 GSAP 动画函数，操作传入的 HTMLElement，不持有状态。
// 不 import 任何 store，只依赖 gsap。
// 回调（onUp/onDown/onComplete）由调用方注入。
//
// 约束：
//   - 可见性由 alpha 控制（倒下 alpha:0 不可见，站立 alpha:1 可见），不切换 z-index
//   - setDown/resetTransform 不动 x/y/xPercent/yPercent/width/height（位置由 syncEntityPosition 管）
//   - 角色投影由 .entity-img 的 CSS filter: drop-shadow 提供，无需独立阴影元素
//   - notifyUp 挂在回弹 tween 的 onComplete（非 timeline.onComplete，因末尾 idle repeat:-1）
//   - z-index 固定 Z_STANDING + Math.round(y)，由 JS 通过 el.style.zIndex 设置
// ══════════════════════════════════════════════════

import gsap from 'gsap';
import type { AttackKind } from '@/types/actor-animation';

// z-index 基准：Z_STANDING + Math.round(y)，Y 越大（屏幕越下方）z-index 越高
// 模拟透视：下方 actor 遮挡上方 actor。Z_STANDING=10 保证立绘始终在 cells(z-index:1) 之上
const Z_STANDING = 10;

/**
 * 基于 GSAP y 属性动态计算 z-index：下方 actor z-index 更高，遮挡上方 actor
 */
export function updateEntityZIndex(el: HTMLElement): void {
  const y = gsap.getProperty(el, 'y') as number;
  el.style.zIndex = String(Z_STANDING + Math.round(y));
}

/**
 * 压扁倒下状态：scaleY 极小 + 旋转 -90° + 完全透明
 * 不动 x/y/xPercent/yPercent/width/height（位置由 syncEntityPosition 管）
 */
export function setDown(el: HTMLElement): void {
  gsap.killTweensOf(el);
  gsap.set(el, {
    scaleY: 0.04,
    scaleX: 1,
    rotation: -90,
    alpha: 0,  // 完全透明（替代 z-index:-1 被地面遮挡）
  });
  updateEntityZIndex(el);
}

/**
 * idle 循环：轻微呼吸缩放
 * 重置 scale/rotation 到中性值：上一步动画可能让 scaleY/scaleX 停在与 idle 目标值重合的位置，
 * 导致 yoyo 无振幅看似静态
 */
export function startIdle(el: HTMLElement): void {
  gsap.killTweensOf(el);
  gsap.set(el, { scaleY: 1, scaleX: 1, rotation: 0 });
  gsap.to(el, {
    scaleY: 1.02,
    scaleX: 0.99,
    duration: 0.6,
    ease: 'sine.inOut',
    yoyo: true,
    repeat: -1,
  });
}

/**
 * 弹起动画：压扁蓄力 → elastic 回弹 → idle 循环
 * onUp 挂在回弹 tween（第二个）的 onComplete 上
 * （timeline 末尾是 repeat:-1 的 idle 循环，timeline 永不完成）
 */
export function popUp(el: HTMLElement, onUp?: () => void): void {
  gsap.killTweensOf(el);
  const tl = gsap.timeline();
  // setDown 已 alpha:0，压扁阶段保持透明（不可见）
  tl.to(el, {
    scaleY: 0.02, scaleX: 1.05, rotation: -95,
    duration: 0.12, ease: 'power1.in',
  });
  // 弹起时渐显（alpha 0→1），替代原 z-index 切换
  tl.to(el, {
    scaleY: 1, scaleX: 1, rotation: 0,
    alpha: 1,
    duration: 0.9, ease: 'elastic.out(1, 0.55)',
    onComplete: onUp,
  });
  tl.to(el, {
    scaleY: 1.02, scaleX: 0.99,
    duration: 0.6, ease: 'sine.inOut',
    yoyo: true, repeat: -1,
  });
}

/**
 * 倒下动画：倾斜 → 旋转倒地 + 渐隐
 * onDown 挂在 timeline.onComplete（fall 末尾无 repeat，timeline 能正常完成）
 */
export function fall(el: HTMLElement, onDown?: () => void): void {
  gsap.killTweensOf(el);
  const tl = gsap.timeline({
    onComplete: () => onDown?.(),
  });
  tl.to(el, {
    rotation: -22, scaleY: 1.05, scaleX: 0.96,
    duration: 0.1, ease: 'power1.out',
  });
  tl.to(el, {
    rotation: -90, scaleY: 0.04, scaleX: 1,
    alpha: 0,  // 倒下后完全透明（替代 z-index:-1 被地面遮挡）
    duration: 0.32, ease: 'power2.in',
  });
}

/**
 * 移动动画（鸭子步摇摆）：位置插值 + 左右摇摆 + 脚步压缩
 * direction: 1 右移（先摆右 +）/ -1 左移（先摆左 −）/ 0 垂直移动（默认先摆右）
 * 摇摆模拟"走路时身体左右晃"，与移动方向无关，垂直移动也摇摆
 */
export function moveActor(
  el: HTMLElement,
  toX: number, toY: number,
  direction: 1 | -1 | 0,
  onComplete: () => void,
): void {
  gsap.killTweensOf(el);
  updateEntityZIndex(el);

  const duration = 0.5;
  const swayAmp = 12;
  const swayCycles = 2;
  const swaySegments = swayCycles * 4;  // 每周期 4 段（正→反→正→反）
  const swayDir = direction === 0 ? 1 : direction;  // 垂直移动默认先摆右

  const tl = gsap.timeline({ onComplete });

  // 1. 位置插值（旧格 → 新格），onUpdate 实时更新 z-index 保持 Y 排序
  tl.to(el, {
    x: toX, y: toY,
    duration,
    ease: 'power1.inOut',
    onUpdate: () => updateEntityZIndex(el),
  }, 0);

  // 2. 左右摇摆（方向感知）
  tl.to(el, {
    rotation: swayDir * swayAmp,
    duration: duration / swaySegments,
    ease: 'sine.inOut',
    yoyo: true,
    repeat: swaySegments - 1,
  }, 0);

  // 3. 脚步压缩（模拟着地，与摇摆同频）
  tl.to(el, {
    scaleY: 0.97,
    duration: duration / (swayCycles * 2),
    ease: 'sine.inOut',
    yoyo: true,
    repeat: swayCycles * 2 - 1,
  }, 0);
}

/**
 * 移动动画（棋子跳跃）：
 *   空中阶段（0~0.5s）：x 平移 + y 抛物线弧线 + scaleY 弹簧形变（蓄力→拉伸→落地压缩）
 *   落地阶段（0.5s+）：elastic.out 弹性缓动自动振荡衰减，模拟弹簧释放后自然弹跳
 *
 * peakY 取 min(fromY, toY) - jumpHeight，确保垂直/斜向移动时也"向上跳"
 * 屏幕坐标 y 向下为正，"向上跳"= y 减小，峰值比起点和终点都小
 */
export function jumpActor(
  el: HTMLElement,
  toX: number, toY: number,
  cellH: number,
  onComplete: () => void,
): void {
  gsap.killTweensOf(el);
  updateEntityZIndex(el);

  const airTime = 0.5;            // 空中阶段时长
  const jumpHeight = cellH * 0.6;
  const half = airTime / 2;

  const fromY = gsap.getProperty(el, 'y') as number;
  const peakY = Math.min(fromY, toY) - jumpHeight;

  const tl = gsap.timeline({ onComplete });

  // ── 空中阶段（0~0.5s）──

  // x 全程平移（空中阶段完成位移）
  tl.to(el, { x: toX, duration: airTime, ease: 'power1.inOut' }, 0);

  // y 抛物线：跳起（y 减小到 peakY）→ 落下（y 增大到 toY），onUpdate 实时更新 z-index
  tl.to(el, { y: peakY, duration: half, ease: 'power2.out', onUpdate: () => updateEntityZIndex(el) }, 0);
  tl.to(el, { y: toY, duration: half, ease: 'power2.in', onUpdate: () => updateEntityZIndex(el) }, half);

  // scaleY 弹簧形变（3 段：蓄力压缩 → 弹起拉伸 → 落地压缩）
  tl.to(el, { scaleY: 0.60, duration: 0.10, ease: 'power2.in'  }, 0);     // 蓄力压缩（弹簧压扁）
  tl.to(el, { scaleY: 1.20, duration: 0.15, ease: 'power2.out' }, 0.10);  // 弹起拉伸（弹簧释放）
  tl.to(el, { scaleY: 0.55, duration: 0.25, ease: 'sine.in'   }, 0.25);  // 空中渐回 + 落地压缩

  // ── 落地弹性阶段（0.5s+）──
  // elastic.out 自带振荡衰减：0.55 → 1.0 会冲到 ~1.15 → 回 ~0.92 → 弹 ~1.08 ... 逐渐收敛
  // duration 放宽到 0.9s，让弹簧振动充分释放，自然过渡到 idle
  tl.to(el, { scaleY: 1.0, duration: 0.9, ease: 'elastic.out(1, 0.35)' }, 0.50);
}

/**
 * 到达弹起动画（跨区域切换专用）：淡入 + back.out 弹性放大，无倒下阶段
 * 与 popUp 的区别：不 setDown 倒下，直接从透明缩小状态弹起出现，
 * 语义是"到达"而非"从地面爬起"
 */
export function arriveAnim(el: HTMLElement): void {
  gsap.killTweensOf(el);
  updateEntityZIndex(el);
  gsap.set(el, { alpha: 0, scaleY: 0.3, scaleX: 0.3, rotation: 0 });
  const tl = gsap.timeline();
  tl.to(el, { alpha: 1, scaleY: 1, scaleX: 1, duration: 0.4, ease: 'back.out(1.7)' });
  tl.to(el, { scaleY: 1.02, scaleX: 0.99, duration: 0.6, ease: 'sine.inOut', yoyo: true, repeat: -1 });
}

/**
 * 淡出消失动画：alpha 渐隐 + 轻微缩小
 * 用于 NPC 敌人从视野消失（被击败/逃跑/移出视野）
 * 由 TransitionGroup 的 leave 钩子调用，动画完成后 Vue 才移除 DOM 元素
 */
export function fadeOut(el: HTMLElement, onComplete?: () => void): void {
  gsap.killTweensOf(el);
  const tl = gsap.timeline({ onComplete: () => onComplete?.() });
  tl.to(el, {
    alpha: 0,
    scaleY: 0.7,
    scaleX: 0.7,
    duration: 0.35,
    ease: 'power2.in',
  });
}

/**
 * 受击摇晃动画（动漫感 3 段）：深压缩+侧倾 → 反向过头 → elastic 振荡回正
 * direction: 1 右偏（被左侧攻击者打中）/ -1 左偏（被右侧攻击者打中）/ 0 仅压缩无偏移
 * 总时长 ~0.42s，与 playTurnSegment 的 COLLISION_ANIM_DURATION(450ms) 对齐
 *
 * 段 1（0~0.10s）：scaleY 深压缩到 0.70 + scaleX 横向拉伸 1.15 + 朝受击方向侧倾 8° + 偏移 1.8dx
 * 段 2（0.10~0.22s）：scaleY 拉伸过头 1.18 + scaleX 压缩 0.92 + 反向侧倾 -6° + 反向偏移 2.4dx（动漫感核心：摆过头）
 * 段 3（0.22~0.42s）：elastic.out(1, 0.4) 自动振荡回正 + 补回 0.6dx 偏移
 *
 * 约束：x 用 += / -= 相对偏移，三段偏移和为 0（1.8 - 2.4 + 0.6 = 0），不污染 syncEntityPosition 的位置
 *       direction=0 时 dx=0、rotation=0，仅播放 scaleY/scaleX 形变（无方向偏移与侧倾）
 */
export function hitAnim(
  el: HTMLElement,
  direction: 1 | -1 | 0 = 0,
  onComplete?: () => void,
): void {
  gsap.killTweensOf(el);
  const dx = direction * 6;
  const tl = gsap.timeline({ onComplete: () => onComplete?.() });
  // 段 1：深压缩 + 横向拉伸 + 朝受击方向侧倾 + 大幅偏移
  tl.to(el, {
    scaleY: 0.70,
    scaleX: 1.15,
    rotation: direction * 8,
    x: `+=${dx * 1.8}`,
    duration: 0.10,
    ease: 'power2.in',
  });
  // 段 2：反向拉伸过头 + 反向侧倾（动漫感核心：身体反弹摆过头）
  tl.to(el, {
    scaleY: 1.18,
    scaleX: 0.92,
    rotation: direction * -6,
    x: `-=${dx * 2.4}`,
    duration: 0.12,
    ease: 'power2.out',
  });
  // 段 3：elastic 自动振荡回正 + 补回偏移
  tl.to(el, {
    scaleY: 1,
    scaleX: 1,
    rotation: 0,
    x: `+=${dx * 0.6}`,
    duration: 0.20,
    ease: 'elastic.out(1, 0.4)',
  });
}

/**
 * 攻击冲撞动画
 *
 * melee（默认）：蓄力后撤 → 朝目标方向冲撞 → 回正，总时长 ~0.3s
 * ranged：蓄力后仰 → 释放前倾 → 回正，总时长 ~0.3s
 *
 * 方向计算：由 targetPosition 与 actor 当前 x/y 算方向向量；未传则默认朝右
 * 约束：用绝对定位 startX/startY，段 3 回原位，避免污染 syncEntityPosition
 *
 * @param targetPosition 目标位置（用于 melee 算方向），undefined 时默认朝右冲撞
 * @param kind 'melee'（冲撞）或 'ranged'（姿势），默认 'melee'
 */
export function attackAnim(
  el: HTMLElement,
  targetPosition?: { x: number; y: number },
  kind: AttackKind = 'melee',
  onComplete?: () => void,
): void {
  gsap.killTweensOf(el);
  updateEntityZIndex(el);

  const startX = gsap.getProperty(el, 'x') as number;
  const startY = gsap.getProperty(el, 'y') as number;

  const tl = gsap.timeline({ onComplete: () => onComplete?.() });

  if (kind === 'ranged') {
    // ranged：蓄力后仰 → 释放前倾 → 回正（不位移）
    tl.to(el, { scaleY: 0.92, rotation: -5, duration: 0.1, ease: 'power1.in' });
    tl.to(el, { scaleY: 1.08, rotation: 8, duration: 0.15, ease: 'power2.out' });
    tl.to(el, { scaleY: 1, rotation: 0, duration: 0.05, ease: 'power2.inOut' });
    return;
  }

  // melee：蓄力 → 冲撞 → 回正
  // 方向向量（默认朝右）
  let dx = 15;
  let dy = 0;
  if (targetPosition) {
    const distX = targetPosition.x - startX;
    const distY = targetPosition.y - startY;
    const dist = Math.sqrt(distX * distX + distY * distY);
    if (dist > 0) {
      dx = (distX / dist) * 15;
      dy = (distY / dist) * 15;
    }
  }

  // 段 1（0~0.08s）：蓄力（scaleY 拉伸 + 微后撤 30%）
  tl.to(el, {
    scaleY: 1.15,
    x: startX - dx * 0.3,
    y: startY - dy * 0.3,
    duration: 0.08,
    ease: 'power1.in',
  });
  // 段 2（0.08~0.2s）：冲撞（朝目标方向位移 15px + 压缩）
  tl.to(el, {
    x: startX + dx,
    y: startY + dy,
    scaleY: 0.95,
    duration: 0.12,
    ease: 'power2.out',
  });
  // 段 3（0.2~0.3s）：回正（回原位 + scale 回 1）
  tl.to(el, {
    x: startX,
    y: startY,
    scaleY: 1,
    duration: 0.1,
    ease: 'power2.inOut',
  });
}
