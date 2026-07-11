import { aimTileVisualState, createAimTargetingController, selectAimTileFromMapObject } from './aim-targeting';
import type { CombatPreviewTargetsResponse } from '@/types/api';
import { isTileRevealed } from '@/utils/map-visibility';
import { estimateMoveActionCost, getSkillBaseRange } from '@/utils/combat-action-cost';
import type { Skill } from '@/types/api';

function response(origin: number, selectablePls: number): CombatPreviewTargetsResponse {
  return {
    origin_pls: origin,
    range: { mode: 'move_power', base: 3, effective: 6, available_ap: 2, base_apcost: 1 },
    targets: {
      [selectablePls]: { selectable: true, distance: 1, reason: null },
    },
  };
}

export async function assertAimTargetingFixture(): Promise<void> {
  const moveSkill = {
    act_id: 'move',
    apcost: '1',
    action_range: 6,
    range_max: 0,
    range: { mode: 'move_power', base: 3, effective: 6, available_ap: 2, base_apcost: 1 },
  } as Skill;
  if (getSkillBaseRange(moveSkill) !== 3 || estimateMoveActionCost(moveSkill, 6) !== 2) {
    throw new Error('move AP estimate reused effective range as move power');
  }

  const pending: Array<(value: CombatPreviewTargetsResponse) => void> = [];
  const selected: number[] = [];
  const controller = createAimTargetingController(
    () => new Promise(resolve => pending.push(resolve)),
    pls => selected.push(pls),
  );

  const older = controller.enter({ actId: 'move', targetMode: 'tile', prefixActions: [], candidateIds: [11] });
  const newer = controller.enter({ actId: 'move', targetMode: 'tile', prefixActions: [], candidateIds: [21] });
  pending[1](response(20, 21));
  await newer;
  pending[0](response(10, 11));
  await older;
  if (controller.originPls.value !== 20 || controller.getTileOption(11) !== null) {
    throw new Error('stale target preview overwrote the newer aim session');
  }
  if (!selectAimTileFromMapObject(controller, { pls: 21 })
    || selectAimTileFromMapObject(controller, { pls: 21 })
    || selected.join(',') !== '21') {
    throw new Error('cell/entity tile selection was not committed exactly once');
  }
  controller.exit();
  if (controller.active.value || Object.keys(controller.targets.value).length !== 0) {
    throw new Error('aim exit did not clear targeting state');
  }

  if (aimTileVisualState({ selectable: true, distance: 1, reason: null }, false) !== 'targetable') {
    throw new Error('selectable target visual mismatch');
  }
  if (aimTileVisualState({ selectable: false, distance: 4, reason: 'tile_out_of_range' }, false) !== 'out-of-range') {
    throw new Error('out-of-range target visual mismatch');
  }
  for (const reason of ['tile_occupied', 'tile_impassable', 'tile_unreachable']) {
    if (aimTileVisualState({ selectable: false, distance: null, reason }, false) !== 'blocked') {
      throw new Error(`blocked target visual mismatch: ${reason}`);
    }
  }
  if (aimTileVisualState({ selectable: false, distance: null, reason: 'tile_unrevealed' }, false) !== 'none'
    || aimTileVisualState({ selectable: true, distance: 1, reason: null }, true) !== 'none') {
    throw new Error('hidden target leaked an aim class');
  }

  const fog = { 1: { 11: 1, 12: '1', 13: true, 14: 0, 15: '0', 16: false } };
  for (const pls of [11, 12, 13]) {
    if (!isTileRevealed(fog, 1, pls)) throw new Error(`revealed fog value rejected: ${pls}`);
  }
  for (const pls of [14, 15, 16, 17]) {
    if (isTileRevealed(fog, 1, pls)) throw new Error(`hidden fog value revealed: ${pls}`);
  }
  if (!isTileRevealed(fog, 1, 17, true)) throw new Error('current tile was not force revealed');
}
