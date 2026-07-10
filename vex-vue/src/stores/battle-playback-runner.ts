import { dataManager } from '@/stores/data-manager';
import {
  playActionDelivery,
  playActionAnimation,
  playCombatantJoined,
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
  BattleSegmentV2,
  PlaybackStep,
} from './battle-director-v2';

export interface SegmentPlayOptions {
  alwaysShowHeader?: boolean;
  isBattleEnd?: boolean;
}

export interface BattlePlaybackRuntime {
  currentPid: number;
  npcPid: number;
  scene: SceneGeometry;
  presentation: BattlePresentationSession;
  updateSegmentContext(segment: BattleSegmentV2, npcPid: number): Promise<void>;
  playSegmentInModal(segment: BattleSegmentV2, options: SegmentPlayOptions): Promise<void>;
  enterBattleEndOverlay(segment: BattleSegmentV2, sessionId: string): Promise<void>;
  handoffPresentationScene(segment: BattleSegmentV2, sessionId: string): Promise<void>;
  playBattleEndModalContent(segment: BattleSegmentV2, sessionId: string): Promise<void>;
}

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
  if (step.kind === 'action_animation' || step.kind === 'action_delivery') {
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
    case 'action_delivery':
      return playActionDelivery(step.action, step.delivery, actorContext);
    case 'combatant_joined':
      return playCombatantJoined(step.joined, actorContext);
    case 'action_animation':
      return playActionAnimation(step.action, actorContext);
    case 'combatant_cleared':
      return playCombatantCleared(step.notice, actorContext);
    case 'battle_end_overlay_enter':
      return promiseTask(runtime.enterBattleEndOverlay(step.segment, runtime.presentation.id));
    case 'presentation_scene_handoff':
      return promiseTask(runtime.handoffPresentationScene(step.segment, runtime.presentation.id));
    case 'battle_end_modal_content':
      return promiseTask(runtime.playBattleEndModalContent(step.segment, runtime.presentation.id));
    case 'modal_text':
      return promiseTask(runtime.playSegmentInModal(step.segment, step.options));
    case 'damage_linger':
      dataManager.broadcast('battle:play-damage-numbers', {
        effects: step.effects,
        npcPid: runtime.npcPid,
      });
      return promiseTask(Promise.resolve());
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
