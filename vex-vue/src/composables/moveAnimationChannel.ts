/**
 * @module M 组合式函数
 * @framework M-1 租赁式动画架构
 */

// ══════════════════════════════════════════════════
// 移动动画完成信号通道（M-1-A / K-12-B 支撑）
//
// 用途：useMapEntities.playWorldMove 动画完成时向 moveDirector 发送信号，
// 替代旧的固定 setTimeout 节奏。moveDirector 据此推进下一步，超时兜底由
// moveDirector 自身管理。
//
// 设计原则（设计案 M-1-A）：
//   - 独立信号通道，不走 mapStore 状态（避免 K-6 投影修订号污染）
//   - 不走 playerAvatar K-10 意图通道（姿态通道，不是位置通道）
//   - 携带 targetPls 供 moveDirector 过滤过期信号（防 stale completion）
//   - completed=false 表示动画被抢占/取消，moveDirector 应走超时兜底
// ══════════════════════════════════════════════════

import { task3Debug } from '@/utils/task3-debug';

export interface MoveAnimationCompletionEvent {
  /** 动画所属实体 ID（moveDirector 仅消费 'player'） */
  actorId: string;
  /** 动画目标 pls（moveDirector 据此匹配当前 step，过滤过期信号） */
  targetPls: number;
  /** true=动画正常完成；false=被抢占/取消，moveDirector 不应据此推进 */
  completed: boolean;
}

type CompletionListener = (event: MoveAnimationCompletionEvent) => void;

const listeners = new Set<CompletionListener>();

/** 发送完成信号（由 useMapEntities 调用） */
export function emitMoveAnimationCompletion(event: MoveAnimationCompletionEvent): void {
  task3Debug.log('move-animation-channel.emit', {
    actorId: event.actorId,
    targetPls: event.targetPls,
    completed: event.completed,
    listenerCount: listeners.size,
  });
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (err) {
      task3Debug.log('move-animation-channel.listener-error', {
        actorId: event.actorId,
        targetPls: event.targetPls,
        error: err instanceof Error ? { name: err.name, message: err.message } : String(err),
      });
      // 订阅者异常不影响其他订阅者
    }
  }
}

/** 订阅完成信号（由 moveDirector 调用），返回取消订阅函数 */
export function onMoveAnimationCompletion(listener: CompletionListener): () => void {
  listeners.add(listener);
  task3Debug.log('move-animation-channel.subscribe', {
    listenerCountAfterSubscribe: listeners.size,
  });
  return () => {
    listeners.delete(listener);
    task3Debug.log('move-animation-channel.unsubscribe', {
      listenerCountAfterUnsubscribe: listeners.size,
    });
  };
}
