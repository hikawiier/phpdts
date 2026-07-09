import { dataManager } from '@/stores/data-manager';
import {
  playActionAnimation,
  playCombatantCleared,
  prepareBattlefield,
} from './battle-actor-executor';
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
  updateSegmentContext(segment: BattleSegmentV2, npcPid: number): Promise<void>;
  playSegmentInModal(segment: BattleSegmentV2, options: SegmentPlayOptions): Promise<void>;
}

export async function runBattlePlaybackPlan(
  plan: BattlePlaybackPlan,
  runtime: BattlePlaybackRuntime,
): Promise<void> {
  for (const step of plan.steps) {
    await runStep(step, runtime);
  }
}

async function runStep(step: PlaybackStep, runtime: BattlePlaybackRuntime): Promise<void> {
  const task = createStepTask(step, runtime);
  if (step.awaitPolicy === 'none') {
    void task;
    return;
  }
  if (step.timeout && step.timeout > 0) {
    await withTimeout(task, step.timeout, step.id);
    return;
  }
  await task;
}

function createStepTask(step: PlaybackStep, runtime: BattlePlaybackRuntime): Promise<void> {
  switch (step.kind) {
    case 'segment_context':
      return runtime.updateSegmentContext(step.segment, runtime.npcPid);
    case 'prepare_map':
      return prepareBattlefield();
    case 'action_animation':
      return playActionAnimation(step.action, runtime.currentPid);
    case 'combatant_cleared':
      return playCombatantCleared(step.notice, runtime.currentPid);
    case 'modal_text':
      return runtime.playSegmentInModal(step.segment, step.options);
    case 'damage_linger':
      dataManager.broadcast('battle:play-damage-numbers', {
        effects: step.effects,
        npcPid: runtime.npcPid,
      });
      return Promise.resolve();
  }
}

function withTimeout(task: Promise<void>, ms: number, label: string): Promise<void> {
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      if (import.meta.env.DEV) console.warn(`[BattlePlayback] step ${label} timed out after ${ms}ms`);
      resolve();
    }, ms);

    task
      .then(() => {
        clearTimeout(timer);
        resolve();
      })
      .catch(error => {
        clearTimeout(timer);
        if (import.meta.env.DEV) console.warn(`[BattlePlayback] step ${label} failed`, error);
        resolve();
      });
  });
}
