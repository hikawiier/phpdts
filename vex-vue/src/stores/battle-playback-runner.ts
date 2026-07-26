/**
 * @module K 状态管理层
 */

// 战斗播放运行器：消费 PlaybackStep 列表，按 awaitPolicy 执行动画/日志/场景切换
// 职责：遍历 steps → 创建执行任务 → 处理场景保护 → 执行完成回调
import {
  playActionChoreography,
  playCombatantCleared,
  prepareBattlefield,
  type BattleActorExecutionContext,
  type PlaybackExecutionTask,
} from './battle-actor-executor';
import type { SceneGeometry } from '@/types/scene';
import type { BattlePresentationSession } from './battle-presentation-session';
import { actorTraceEnabled, debugBus } from '@/composables/useDebugBus';
import type {
  BattlePlaybackPlan,
  BattleSegment,
  PlaybackStep,
} from './battle-director';

export interface SegmentPlayOptions {
  alwaysShowHeader?: boolean;
}

// 播放运行时上下文：包含当前 PID、NPC PID、场景几何、演出会话
export interface BattlePlaybackRuntime {
  currentPid: number;
  npcPid: number;
  scene: SceneGeometry;
  presentation: BattlePresentationSession;
  updateSegmentContext(segment: BattleSegment, npcPid: number): Promise<void>;
  playSegmentText(segment: BattleSegment, options: SegmentPlayOptions): Promise<void>;
  enterBattleEndMask(segment: BattleSegment, sessionId: string): Promise<void>;
  handoffPresentationScene(segment: BattleSegment, sessionId: string): Promise<void>;
  playBattleEndContent(segment: BattleSegment, sessionId: string): Promise<void>;
}

// 播放入口：遍历所有 PlaybackStep 并串行执行
export async function runBattlePlaybackPlan(
  plan: BattlePlaybackPlan,
  runtime: BattlePlaybackRuntime,
): Promise<void> {
  for (const step of plan.steps) await runStep(step, runtime);
}

async function runStep(step: PlaybackStep, runtime: BattlePlaybackRuntime): Promise<void> {
  if (actorTraceEnabled) debugBus.emit('battle-playback', 'step:start', describeStep(step));
  if (!runtime.scene.active) throw new Error(`Battle scene replaced before step ${step.id}`);
  const task = guardScene(createStepTask(step, runtime), runtime.scene, step.id);
  try {
    if (step.awaitPolicy === 'none') {
      void task.finished.finally(() => {
        if (actorTraceEnabled) debugBus.emit('battle-playback', 'step:settle', describeStep(step));
      });
      return;
    }
    if (step.timeout && step.timeout > 0) {
      await withTimeout(task, step.timeout, step.id);
      return;
    }
    await task.finished;
  } finally {
    if (step.awaitPolicy !== 'none' && actorTraceEnabled) {
      debugBus.emit('battle-playback', 'step:settle', describeStep(step));
    }
  }
}

function describeStep(step: PlaybackStep): Record<string, unknown> {
  if (step.kind === 'combatant_cleared') {
    return {
      stepId: step.id,
      kind: step.kind,
      actorId: step.notice.combatant
        ? (step.notice.combatant.type === 0 ? 'player' : `enemy-${step.notice.combatant.pid}`)
        : null,
      reason: step.notice.reason ?? null,
      rawLogId: step.notice.rawLogId,
    };
  }
  if (step.kind === 'action_choreography') {
    return {
      stepId: step.id,
      kind: step.kind,
      actorId: step.action.actor.type === 0 ? 'player' : `enemy-${step.action.actor.pid}`,
      actionUid: step.action.actionUid,
    };
  }
  return { stepId: step.id, kind: step.kind };
}

function guardScene(
  task: PlaybackExecutionTask,
  scene: SceneGeometry,
  label: string,
): PlaybackExecutionTask {
  let rejectGuard!: (reason: Error) => void;
  let settled = false;
  const invalidated = new Promise<void>((_, reject) => { rejectGuard = reject; });
  const timer = setInterval(() => {
    if (settled || scene.active) return;
    rejectGuard(new Error(`Battle scene replaced during step ${label}`));
    task.cancel('scene_replaced');
  }, 16);
  const finished = Promise.race([task.finished, invalidated]).finally(() => {
    settled = true;
    clearInterval(timer);
  });
  return {
    finished,
    cancel(reason) {
      task.cancel(reason);
    },
  };
}

function createStepTask(step: PlaybackStep, runtime: BattlePlaybackRuntime): PlaybackExecutionTask {
  const actorContext: BattleActorExecutionContext = {
    scene: runtime.scene,
    presentation: runtime.presentation,
    currentPid: runtime.currentPid,
  };
  switch (step.kind) {
    case 'segment_context':
      return promiseTask(runtime.updateSegmentContext(step.segment, runtime.npcPid));
    case 'prepare_map':
      return prepareBattlefield(actorContext);
    case 'action_choreography':
      return playActionChoreography(step.action, actorContext);
    case 'combatant_cleared':
      return playCombatantCleared(step.notice, actorContext);
    case 'battle_end_overlay_enter':
      return promiseTask(runtime.enterBattleEndMask(step.segment, runtime.presentation.id));
    case 'presentation_scene_handoff':
      return promiseTask(runtime.handoffPresentationScene(step.segment, runtime.presentation.id));
    case 'battle_end_modal_content':
      return promiseTask(runtime.playBattleEndContent(step.segment, runtime.presentation.id));
    case 'modal_text':
      return promiseTask(runtime.playSegmentText(step.segment, step.options));
  }
}

function promiseTask(finished: Promise<void>): PlaybackExecutionTask {
  let cancelResolve!: () => void;
  const cancelled = new Promise<void>(resolve => { cancelResolve = resolve; });
  return { finished: Promise.race([finished, cancelled]), cancel: cancelResolve };
}

function withTimeout(task: PlaybackExecutionTask, ms: number, label: string): Promise<void> {
  return new Promise(resolve => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      if (import.meta.env.DEV) console.warn(`[BattlePlayback] step ${label} timed out after ${ms}ms`);
      task.cancel('timeout');
      void task.finished.finally(finish);
    }, ms);
    task.finished.then(finish).catch(error => {
      if (import.meta.env.DEV) console.warn(`[BattlePlayback] step ${label} failed`, error);
      finish();
    });
  });
}
