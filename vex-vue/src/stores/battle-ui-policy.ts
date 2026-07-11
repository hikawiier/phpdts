// 战斗 UI 策略函数集合：界定战斗模式下地图输入/命令锁/演出提交边界
import type { BattleState } from '@/types/api';

export interface BattleMapInputState {
  currentMode: 'normal' | 'battle';
  isPlayingBattleLog: boolean;
  isProcessingBattle: boolean;
  presentationPhase?: 'idle' | 'playing' | 'rebasing';
}

export interface BattleDrainResult<T> {
  status: 'stable' | 'deferred' | 'exhausted';
  snapshot: T | null;
  cycles: number;
}

export async function drainBattleTicksToStable<T>(options: {
  maxCycles: number;
  advance(): Promise<T | null>;
  playPending(): Promise<unknown>;
  isProcessing(snapshot: T): boolean;
}): Promise<BattleDrainResult<T>> {
  for (let cycle = 0; cycle < options.maxCycles; cycle++) {
    const snapshot = await options.advance();
    if (!snapshot) return { status: 'deferred', snapshot: null, cycles: cycle + 1 };

    // The advancing heartbeat may have generated render events. They must be
    // consumed before the snapshot is allowed to become a stable boundary.
    await options.playPending();
    if (!options.isProcessing(snapshot)) {
      return { status: 'stable', snapshot, cycles: cycle + 1 };
    }
  }
  return { status: 'exhausted', snapshot: null, cycles: options.maxCycles };
}

/** Accumulates authority scopes until the serialized refresh worker consumes them. */
export class PendingAuthorityScopes {
  private readonly scopes = new Set<string>();

  record(scopes: readonly string[]): void {
    for (const scope of scopes) this.scopes.add(scope);
  }

  take(): string[] {
    const pending = [...this.scopes];
    this.scopes.clear();
    return pending;
  }

  clear(): void {
    this.scopes.clear();
  }
}

export function shouldCommitBattleVisualState(action: string, battleState: BattleState): boolean {
  return action !== 'battle' || battleState === 'PLAYER_TURN' || battleState === 'IDLE';
}

export function isBattleMapInputLocked(state: BattleMapInputState): boolean {
  return state.presentationPhase === 'rebasing';
}

export function isSilentMapCommandLock(lockReason: string | null | undefined): boolean {
  return lockReason === 'PRESENTATION_NOT_CAUGHT_UP'
    || lockReason === 'MODE_BATTLE'
    || lockReason === 'BATTLE_PROCESSING';
}
