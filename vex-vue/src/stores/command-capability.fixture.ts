import { createPinia, setActivePinia } from 'pinia';
import { commandQueue, CommandQueue, type CommandQueueOptions } from './command-queue';
import { usePlayerStore } from './player';
import { useInventoryStore } from './inventory';
import type { PlayerInfo } from '@/types/api';
import { computed, nextTick } from 'vue';
import type { CommandResult } from '@/api/client';

export function assertCommandCapabilityFixture(): void {
  setActivePinia(createPinia());
  const playerStore = usePlayerStore();
  const inventoryStore = useInventoryStore();
  playerStore.playerInfo = {
      obl_battle_state: 'IDLE',
      capabilities: {
        voluntary_move: {
          allowed: false,
          reason: 'status_blocked',
          source_status_ids: ['flustered'],
          expires_at_tick: 15,
        },
        enter_combat: {
          allowed: false,
          reason: 'status_blocked',
          source_status_ids: ['flustered'],
        },
        free_mutation: {
          allowed: false,
          reason: 'status_blocked',
          source_status_ids: ['flustered'],
        },
        time_pass: { allowed: true },
      },
    } as PlayerInfo;

  const moveBlock = commandQueue.getBlockDecision('map.move');
  if (moveBlock?.code !== 'CAPABILITY_BLOCKED'
    || moveBlock.capability !== 'voluntary_move'
    || moveBlock.expiresAtTick !== 15) {
    throw new Error('move capability block mismatch');
  }
  if (!commandQueue.canExecute('world.wait')) throw new Error('world.wait must remain executable');
  inventoryStore.inventoryData = {
    slots: [],
    num: 0,
    limit: 20,
    itm0: { slot: 0, empty: false, item_id: 'fixture' },
  };
  if (!commandQueue.canExecute('world.wait')) throw new Error('itm0 blocked world.wait recovery exit');
  if (commandQueue.canExecute('item.use')) throw new Error('free mutation capability was ignored');
  if (commandQueue.getCapabilityBlock('enter_combat')?.code !== 'CAPABILITY_BLOCKED') {
    throw new Error('pre-battle capability block mismatch');
  }

  playerStore.playerInfo = { capabilities: {} } as PlayerInfo;
  if (commandQueue.getCapabilityBlock('enter_combat') !== null) {
    throw new Error('missing capability key must be experience-layer allow');
  }
}

export async function assertCommandReactiveLockFixture(): Promise<void> {
  setActivePinia(createPinia());
  usePlayerStore().playerInfo = {
    obl_battle_state: 'IDLE',
    capabilities: {},
  } as PlayerInfo;

  const requestControl: { resolve?: (result: CommandResult) => void } = {};
  let requestCount = 0;
  const transport = (() => {
    requestCount += 1;
    return new Promise<CommandResult>(resolve => { requestControl.resolve = resolve; });
  }) as NonNullable<CommandQueueOptions['transport']>;
  const queue = new CommandQueue({ transport });
  const executable = computed(() => queue.canExecute('combat.can_engage'));
  if (!executable.value) throw new Error('reactive lock fixture did not start unlocked');

  const pending = queue.execute({ command: 'combat.can_engage', payload: { target_pid: 1 } });
  await nextTick();
  if (executable.value || !queue.isLocked) throw new Error('request lock was not reactive');
  const rejected = await queue.execute({ command: 'combat.can_engage', payload: { target_pid: 1 } });
  if (rejected.lockReason !== 'HTTP_LOCKED' || requestCount !== 1) {
    throw new Error('deferred transport allowed a duplicate request');
  }
  if (!requestControl.resolve) throw new Error('deferred transport resolver missing');
  requestControl.resolve({ success: false, error: 'FIXTURE_DONE' });
  await pending;
  await nextTick();
  if (!executable.value || queue.isLocked) throw new Error('request lock did not release reactively');

  let now = 1000;
  const scheduleControl: { callback?: () => void } = {};
  let cancelled = false;
  const cooldownQueue = new CommandQueue({
    transport: (async () => ({ success: true, timer: 1 })) as NonNullable<CommandQueueOptions['transport']>,
    now: () => now,
    schedule: callback => {
      scheduleControl.callback = callback;
      return 1 as unknown as ReturnType<typeof setTimeout>;
    },
    cancelSchedule: () => { cancelled = true; },
  });
  const cooldownExecutable = computed(() => cooldownQueue.canExecute('combat.can_engage'));
  await cooldownQueue.execute({ command: 'combat.can_engage', payload: { target_pid: 1 } });
  if (cooldownExecutable.value || cooldownQueue.remainingCooldown !== 1000) {
    throw new Error('cooldown did not become reactive');
  }
  now = 2000;
  scheduleControl.callback?.();
  await nextTick();
  if (!cooldownExecutable.value || Number(cooldownQueue.remainingCooldown) !== 0) {
    throw new Error('cooldown did not release without external reactive updates');
  }
  await cooldownQueue.execute({ command: 'combat.can_engage', payload: { target_pid: 1 } });
  cooldownQueue.destroy();
  if (!cancelled || Number(cooldownQueue.remainingCooldown) !== 0) {
    throw new Error('destroy did not clean the cooldown timer');
  }
}
