import type { BattleState } from '@/types/api';

export interface BattleMapInputState {
  currentMode: 'normal' | 'battle';
  isPlayingBattleLog: boolean;
  isProcessingBattle: boolean;
}

/**
 * Accumulates authoritative cache changes until battle playback reaches a
 * boundary where the visual projection may safely catch up.
 */
export class DeferredVisualScopes {
  private readonly scopes = new Set<string>();

  record(scopes: readonly string[]): void {
    for (const scope of scopes) this.scopes.add(scope);
  }

  snapshot(): string[] {
    return [...this.scopes];
  }

  commit(scopes: readonly string[]): void {
    for (const scope of scopes) this.scopes.delete(scope);
  }

  clear(): void {
    this.scopes.clear();
  }
}

export function shouldCommitBattleVisualState(action: string, battleState: BattleState): boolean {
  return action !== 'battle' || battleState === 'PLAYER_TURN' || battleState === 'IDLE';
}

export function isBattleMapInputLocked(state: BattleMapInputState): boolean {
  return state.currentMode === 'battle'
    || state.isPlayingBattleLog
    || state.isProcessingBattle;
}

export function isSilentMapCommandLock(lockReason: string | null | undefined): boolean {
  return lockReason === 'BATTLE_LOG_PLAYING'
    || lockReason === 'MODE_BATTLE'
    || lockReason === 'BATTLE_PROCESSING';
}
