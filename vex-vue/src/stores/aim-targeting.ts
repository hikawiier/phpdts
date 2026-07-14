/**
 * @module K 状态管理层
 */

import { computed, ref, type Ref } from 'vue';
import { defineStore } from 'pinia';
import { dataManager } from '@/stores/data-manager';
import {
  previewCombatTargets,
  type CombatPreviewTargetsRequest,
  type CombatPreviewTargetsTransport,
} from '@/api/combat-preview';
import type {
  CombatPreviewAction,
  CombatPreviewRangeProjection,
  CombatPreviewTargetOption,
} from '@/types/api';

// 瞄准目标 Store：管理战斗中的瞄准会话（选择敌人或选择格子）
// 通过后端 combat_preview API 获取可选目标列表，提供格子/角色两种瞄准模式
export type AimTargetMode = 'enemy' | 'tile';
export type AimTileVisualState = 'none' | 'targetable' | 'out-of-range' | 'blocked';

export interface AimTargetingSession {
  actId: string;
  targetMode: AimTargetMode;
  prefixActions: CombatPreviewAction[];
  candidateIds: number[];
}

export interface AimTargetingController {
  active: Ref<boolean>;
  targetMode: Ref<AimTargetMode>;
  actId: Ref<string | null>;
  loading: Ref<boolean>;
  error: Ref<string>;
  originPls: Ref<number | null>;
  range: Ref<CombatPreviewRangeProjection | null>;
  targets: Ref<Record<string, CombatPreviewTargetOption>>;
  enter(session: AimTargetingSession): Promise<void>;
  refresh(candidateIds?: number[]): Promise<void>;
  selectTile(pls: number): boolean;
  exit(): void;
  getTileOption(pls: number): CombatPreviewTargetOption | null;
  getTileVisualState(pls: number, hidden: boolean): AimTileVisualState;
}

export interface AimTileMapObject {
  pls: string | number;
}

const HIDDEN_REASONS = new Set(['tile_unrevealed', 'TARGET_NOT_VISIBLE', 'target_not_visible']);
const OUT_OF_RANGE_REASONS = new Set(['tile_out_of_range', 'out_of_range']);

export function aimTileVisualState(
  option: CombatPreviewTargetOption | null | undefined,
  hidden: boolean,
): AimTileVisualState {
  if (hidden || !option || HIDDEN_REASONS.has(String(option.reason))) return 'none';
  if (option.selectable) return 'targetable';
  if (OUT_OF_RANGE_REASONS.has(String(option.reason))) return 'out-of-range';
  return 'blocked';
}

export function selectAimTileFromMapObject(
  controller: Pick<AimTargetingController, 'selectTile'>,
  target: AimTileMapObject,
): boolean {
  const pls = Number(target.pls);
  return Number.isFinite(pls) && pls > 0 ? controller.selectTile(pls) : false;
}

export function createAimTargetingController(
  transport: CombatPreviewTargetsTransport,
  onTileSelected: (pls: number) => void,
): AimTargetingController {
  const active = ref(false);
  const targetMode = ref<AimTargetMode>('enemy');
  const actId = ref<string | null>(null);
  const loading = ref(false);
  const error = ref('');
  const originPls = ref<number | null>(null);
  const range = ref<CombatPreviewRangeProjection | null>(null);
  const targets = ref<Record<string, CombatPreviewTargetOption>>({});
  const prefixActions = ref<CombatPreviewAction[]>([]);
  const candidateIds = ref<number[]>([]);
  let requestGeneration = 0;
  let selectionCommitted = false;

  async function requestPreview(): Promise<void> {
    if (!active.value || targetMode.value !== 'tile' || !actId.value) return;
    const generation = ++requestGeneration;
    loading.value = true;
    error.value = '';
    const request: CombatPreviewTargetsRequest = {
      act_id: actId.value,
      prefix_actions: prefixActions.value,
      candidate_ids: candidateIds.value,
    };
    try {
      const response = await transport(request);
      if (!active.value || generation !== requestGeneration) return;
      originPls.value = Number(response.origin_pls) || null;
      range.value = response.range;
      targets.value = response.targets ?? {};
    } catch (e) {
      if (!active.value || generation !== requestGeneration) return;
      error.value = e instanceof Error ? e.message : String(e);
      targets.value = {};
    } finally {
      if (generation === requestGeneration) loading.value = false;
    }
  }

  async function enter(session: AimTargetingSession): Promise<void> {
    requestGeneration += 1;
    active.value = true;
    targetMode.value = session.targetMode;
    actId.value = session.actId;
    prefixActions.value = session.prefixActions.slice();
    candidateIds.value = [...new Set(session.candidateIds.filter(id => id > 0))];
    originPls.value = null;
    range.value = null;
    targets.value = {};
    error.value = '';
    selectionCommitted = false;
    if (session.targetMode === 'tile') await requestPreview();
  }

  async function refresh(nextCandidateIds?: number[]): Promise<void> {
    if (nextCandidateIds) {
      candidateIds.value = [...new Set(nextCandidateIds.filter(id => id > 0))];
    }
    await requestPreview();
  }

  function getTileOption(pls: number): CombatPreviewTargetOption | null {
    return targets.value[String(pls)] ?? null;
  }

  function getTileVisualState(pls: number, hidden: boolean): AimTileVisualState {
    if (!active.value || targetMode.value !== 'tile') return 'none';
    return aimTileVisualState(getTileOption(pls), hidden);
  }

  function selectTile(pls: number): boolean {
    if (!active.value || targetMode.value !== 'tile' || selectionCommitted) return false;
    if (!getTileOption(pls)?.selectable) return false;
    selectionCommitted = true;
    onTileSelected(pls);
    return true;
  }

  function exit(): void {
    requestGeneration += 1;
    active.value = false;
    targetMode.value = 'enemy';
    actId.value = null;
    loading.value = false;
    error.value = '';
    originPls.value = null;
    range.value = null;
    targets.value = {};
    prefixActions.value = [];
    candidateIds.value = [];
    selectionCommitted = false;
  }

  return {
    active,
    targetMode,
    actId,
    loading,
    error,
    originPls,
    range,
    targets,
    enter,
    refresh,
    selectTile,
    exit,
    getTileOption,
    getTileVisualState,
  };
}

export type AimEnemyVisualStatus = 'selectable' | 'out-of-range' | 'blocked';

export interface AimEnemyVisualState {
  status: AimEnemyVisualStatus;
  title: string;
}

export const useAimTargetingStore = defineStore('aim-targeting', () => {
  const controller = createAimTargetingController(
    previewCombatTargets,
    pls => dataManager.broadcast('battle:aim-target-selected', { pls }),
  );
  const isTileAim = computed(() => controller.active.value && controller.targetMode.value === 'tile');

  // ── enemy 模式瞄准视觉状态（由 AimMode.vue 写入，MapGrid.vue entityClass/cellClass 消费） ──
  // 与 tile 模式的 getTileVisualState 对称：取代旧命令式 classList.add/remove
  const enemyAimStates = ref<Map<number, AimEnemyVisualState>>(new Map());
  const aimFocusedPid = ref<number | null>(null);
  const aimHoverPid = ref<number | null>(null); // enemy 模式 hover
  const aimHoverPls = ref<number | null>(null); // tile 模式 hover

  function setEnemyAimStates(states: Map<number, AimEnemyVisualState>, focusedPid: number | null): void {
    enemyAimStates.value = states;
    aimFocusedPid.value = focusedPid;
  }

  function clearEnemyAimStates(): void {
    enemyAimStates.value = new Map();
    aimFocusedPid.value = null;
    aimHoverPid.value = null;
    aimHoverPls.value = null;
  }

  function setAimHoverPid(pid: number | null): void {
    aimHoverPid.value = pid;
  }

  function setAimHoverPls(pls: number | null): void {
    aimHoverPls.value = pls;
  }

  function getEnemyAimState(pid: number): AimEnemyVisualState | null {
    return enemyAimStates.value.get(pid) ?? null;
  }

  return {
    ...controller,
    isTileAim,
    enemyAimStates,
    aimFocusedPid,
    aimHoverPid,
    aimHoverPls,
    setEnemyAimStates,
    clearEnemyAimStates,
    setAimHoverPid,
    setAimHoverPls,
    getEnemyAimState,
  };
});
