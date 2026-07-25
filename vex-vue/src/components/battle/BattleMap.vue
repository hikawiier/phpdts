<script setup lang="ts">
/**
 * @module L Vue 组件
 * @framework L-12 固定等距战斗场景
 * @framework M-2 场景差异投影
 */

import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useMapStore } from '@/stores/map';
import { useBattleStore } from '@/stores/battle';
import { useCharacterStore } from '@/stores/character';
import { usePlayerAvatarStore } from '@/stores/player-avatar';
import { usePresentationSceneStore } from '@/stores/presentation-scene';
import { useAimTargetingStore, type AimTileVisualState } from '@/stores/aim-targeting';
import { useMapEntities } from '@/composables/useMapEntities';
import { createIsometricBattleGeometry } from '@/composables/isometricBattleGeometry';
import {
  createIsometricLayout,
  deterministicBattleTileDelay,
  projectIsometric,
} from '@/utils/isometric-battle';
import { isFalsy } from '@/utils/format';
import { isDebugEnabled } from '@/utils/debug-flags';
import type { ActorRuntime } from '@/types/actor-runtime';
import type { MapEntity } from '@/types/map-entity';
import type { TileInfo } from '@/types/api';

interface BattleTile {
  pls: number;
  x: number;
  y: number;
  name: string;
  passable: boolean;
  isCurrent: boolean;
  isMetal: boolean;
  isDeep: boolean;
  delay: number;
}

type EntryPhase = 'staged' | 'rising' | 'actors' | 'ready';

interface BattleActorHud {
  name: string;
  hp: number;
  mhp: number;
  ap: number;
  maxAp: number;
  hpPercent: number;
}

const DEFAULT_ZOOM = 1.6;
const MIN_ZOOM = 0.9;
const MAX_ZOOM = 1.9;
const ZOOM_STEP = 0.1;
const DRAG_THRESHOLD = 5;

const mapStore = useMapStore();
const battleStore = useBattleStore();
const characterStore = useCharacterStore();
const playerAvatarStore = usePlayerAvatarStore();
const presentationSceneStore = usePresentationSceneStore();
const aimTargetingStore = useAimTargetingStore();
const actorLabelsEnabled = isDebugEnabled('labels');
const gridRef = ref<HTMLElement | null>(null);
const shellRef = ref<HTMLElement | null>(null);
const stageWidth = ref(1);
const stageHeight = ref(1);
const zoomLevel = ref(DEFAULT_ZOOM);
const focusXRatio = ref(0.46);
const cameraOffsetX = ref(0);
const cameraOffsetY = ref(0);
const isDragging = ref(false);
const entryPhase = ref<EntryPhase>('staged');
const timers: ReturnType<typeof setTimeout>[] = [];
let resizeObserver: ResizeObserver | null = null;
let entryStarted = false;
let projectionSyncGeneration = 0;
let dragPointerId: number | null = null;
let dragStartX = 0;
let dragStartY = 0;
let dragLastX = 0;
let dragLastY = 0;
let dragMoved = false;
let suppressNextClick = false;
let readySettled = false;
let actorStageSettled = false;
let tileRiseSettled = false;
let playerEntrySettled = false;
let resolveReady!: () => void;
let resolveActorStage!: () => void;
let resolveTileRise!: () => void;
let resolvePlayerEntry!: () => void;
const readyPromise = new Promise<void>(resolve => { resolveReady = resolve; });
const actorStagePromise = new Promise<void>(resolve => { resolveActorStage = resolve; });
const tileRisePromise = new Promise<void>(resolve => { resolveTileRise = resolve; });
const playerEntryPromise = new Promise<void>(resolve => { resolvePlayerEntry = resolve; });

const visualPlayerPls = computed<number | null>(() => {
  const player = presentationSceneStore.snapshot.entities.find(entity => entity.id === 'player');
  const pls = Number(player?.pls ?? mapStore.curLoc);
  return Number.isFinite(pls) && pls > 0 ? pls : null;
});

function settleActorStage(): void {
  if (actorStageSettled) return;
  actorStageSettled = true;
  resolveActorStage();
}

function settleTileRise(): void {
  if (tileRiseSettled) return;
  tileRiseSettled = true;
  resolveTileRise();
}

function settlePlayerEntry(): void {
  if (playerEntrySettled) return;
  playerEntrySettled = true;
  resolvePlayerEntry();
}

function settleReady(): void {
  if (readySettled) return;
  readySettled = true;
  entryPhase.value = 'ready';
  resolveReady();
}

const battleTiles = computed<BattleTile[]>(() => {
  if (!mapStore.links || mapStore.curRegion === null) return [];
  const tiles = mapStore.links.tiles[String(mapStore.curRegion)] as Record<
    string,
    TileInfo & { x?: unknown; y?: unknown; floor?: unknown; tide?: unknown }
  > | undefined;
  if (!tiles) return [];
  return Object.entries(tiles)
    .flatMap(([pls, tile]) => {
      const x = Number(tile.x);
      const y = Number(tile.y);
      const normalizedPls = Number(pls);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(normalizedPls)) return [];
      return [{
        pls: normalizedPls,
        x,
        y,
        name: String(tile.name || ''),
        passable: !isFalsy(tile.passable),
        isCurrent: normalizedPls === visualPlayerPls.value,
        isMetal: tile.floor === 'metal',
        isDeep: tile.tide === 'deep',
        delay: deterministicBattleTileDelay(x, y),
      }];
    })
    .sort((left, right) => (left.x + left.y) - (right.x + right.y) || left.x - right.x);
});

const focusTile = computed(() => battleTiles.value.find(tile => tile.isCurrent) ?? null);

const layout = computed(() => {
  const base = createIsometricLayout(
    battleTiles.value,
    stageWidth.value,
    stageHeight.value,
    {
      zoom: zoomLevel.value,
      mirrorX: true,
      focus: focusTile.value,
      focusViewportXRatio: focusXRatio.value,
      focusViewportYRatio: 0.61,
    },
  );
  return {
    ...base,
    originX: base.originX + cameraOffsetX.value,
    originY: base.originY + cameraOffsetY.value,
  };
});

const regionName = computed(() => {
  if (!mapStore.links || mapStore.curRegion === null) return 'UNKNOWN FIELD';
  const region = (mapStore.links.regions as Record<string, { name?: string }>)[String(mapStore.curRegion)];
  return region?.name || `REGION ${mapStore.curRegion}`;
});

async function playBattlePlayerEntry(runtime: ActorRuntime): Promise<void> {
  playerAvatarStore.prepareBattleEntry();
  await nextTick();

  try {
    const enterLease = runtime.acquire({
      owner: 'world',
      channels: ['pose', 'visibility'],
      sessionId: `battle-entry:${runtime.generation}`,
      replaceEqualOwner: true,
    });
    if (enterLease) {
      try {
        const result = await enterLease.play({ kind: 'enter' }).finished;
        if (result.status === 'completed') {
          runtime.markStanding();
          playerAvatarStore.notifyUp();
        }
      } finally {
        enterLease.release();
      }
    }

    if (runtime.disposed) return;
    const transformLease = runtime.acquire({
      owner: 'battle',
      channels: ['pose', 'visibility'],
      sessionId: `battle-appearance:${runtime.generation}`,
      replaceEqualOwner: true,
    });
    if (!transformLease) {
      playerAvatarStore.commitAppearance('battle');
      return;
    }
    try {
      const [result] = await Promise.all([
        transformLease.play({
          kind: 'transform-appearance',
          swap: () => {
            if (playerAvatarStore.desiredAppearance === 'battle') {
              playerAvatarStore.commitAppearance('battle');
            }
          },
        }).finished,
        transformLease.play({ kind: 'reset-visible' }).finished,
      ]);
      if (result.status !== 'completed' && playerAvatarStore.desiredAppearance === 'battle') {
        playerAvatarStore.commitAppearance('battle');
      }
    } finally {
      transformLease.release();
    }
  } finally {
    settlePlayerEntry();
  }
}

const entityAnim = useMapEntities(gridRef, {
  createSceneGeometry: () => createIsometricBattleGeometry(
    gridRef,
    () => mapStore.curRegion,
    () => mapStore.projectionRevision,
    () => readyPromise,
  ),
  beforeFirstEntityEnter: () => actorStagePromise,
  onFirstPlayerEnter: playBattlePlayerEntry,
});
const {
  setEntityRef,
  syncAllPositions,
  playAllFirstEntries,
  displayEntities,
  dispose: disposeEntities,
} = entityAnim;
const hasActiveCombat = computed(() =>
  displayEntities.value.some(entity => entity.inCombat === true),
);

const actorHudById = computed<Record<string, BattleActorHud>>(() => {
  const result: Record<string, BattleActorHud> = {};
  for (const entity of displayEntities.value) {
    if (entity.kind !== 'actor' || entity.characterPid == null) continue;
    const character = characterStore.getCharacter(entity.characterPid);
    if (!character) continue;
    const mhp = Math.max(1, character.mhp);
    result[entity.id] = {
      name: character.name || (entity.id === 'player' ? '幸存者' : entity.id),
      hp: Math.max(0, character.hp),
      mhp,
      ap: Math.max(0, character.ap),
      maxAp: Math.max(0, character.max_ap),
      hpPercent: Math.max(0, Math.min(100, character.hp / mhp * 100)),
    };
  }
  return result;
});

function tileStyle(tile: BattleTile): Record<string, string> {
  const point = projectIsometric(tile, layout.value);
  return {
    left: `${point.x - layout.value.tileWidth / 2}px`,
    top: `${point.y - layout.value.tileHeight / 2}px`,
    width: `${layout.value.tileWidth}px`,
    height: `${layout.value.tileHeight}px`,
    zIndex: String(20 + (tile.x + tile.y) * 2),
    '--battle-tile-delay': `${tile.delay}ms`,
  };
}

function tileLabel(tile: BattleTile): string {
  return tile.name.trim();
}

function actorHud(entity: MapEntity): BattleActorHud | null {
  return actorHudById.value[entity.id] ?? null;
}

function aimStateClass(state: AimTileVisualState): string | null {
  if (state === 'targetable') return 'aim-targetable';
  if (state === 'out-of-range') return 'aim-out-of-range';
  if (state === 'blocked') return 'aim-blocked';
  return null;
}

function tileClass(tile: BattleTile): Array<string | Record<string, boolean>> {
  const aimState = aimTargetingStore.getTileVisualState(tile.pls, false);
  return [
    aimStateClass(aimState) || '',
    {
      'is-current': tile.isCurrent,
      'is-blocked': !tile.passable,
      'is-metal': tile.isMetal,
      'is-deep': tile.isDeep,
      'aim-hover': aimTargetingStore.aimHoverPls === tile.pls,
    },
  ];
}

function tileTitle(tile: BattleTile): string {
  if (!aimTargetingStore.isTileAim) return tile.name;
  const option = aimTargetingStore.getTileOption(tile.pls);
  if (!option || option.selectable) return option?.selectable ? '选择目标位置' : '';
  return option.reason || '当前无法选择该位置';
}

function imgStyle(entity: MapEntity): Record<string, string> {
  return { height: `${(entity.imgHeightRatio ?? 1) * 100}%` };
}

function entityClass(entity: MapEntity): Record<string, boolean> {
  const character = entity.characterPid != null
    ? characterStore.getCharacter(entity.characterPid)
    : undefined;
  const combat = character?.combat;
  const dimmed = hasActiveCombat.value
    && (combat?.inCombat !== true || combat?.active === false);
  const pid = entity.characterPid;
  const aimState = pid != null ? aimTargetingStore.getEnemyAimState(pid) : null;
  const passThroughEnemyAim = aimTargetingStore.active
    && aimTargetingStore.targetMode === 'enemy'
    && (character?.type ?? 0) <= 0;
  return {
    [`entity-${entity.kind}`]: true,
    'entity-player': entity.id === 'player',
    'entity-dimmed': dimmed,
    'aim-targetable': aimState?.status === 'selectable',
    'aim-out-of-range': aimState?.status === 'out-of-range',
    'aim-blocked': aimState?.status === 'blocked',
    'aim-focused': pid != null && aimTargetingStore.aimFocusedPid === pid,
    'aim-hover': pid != null && aimTargetingStore.aimHoverPid === pid,
    'aim-input-pass-through': passThroughEnemyAim,
  };
}

function entityTitle(entity: MapEntity): string {
  if (entity.characterPid == null) return '';
  return aimTargetingStore.getEnemyAimState(entity.characterPid)?.title ?? '';
}

function measureStage(): void {
  const shell = shellRef.value;
  if (!shell) return;
  stageWidth.value = Math.max(1, shell.clientWidth);
  stageHeight.value = Math.max(1, shell.clientHeight);
  syncProjection();
}

function syncProjection(): void {
  const generation = ++projectionSyncGeneration;
  nextTick(() => {
    let settled = false;
    const run = () => {
      if (settled || generation !== projectionSyncGeneration) return;
      settled = true;
      syncAllPositions();
    };
    requestAnimationFrame(run);
    timers.push(setTimeout(run, 50));
  });
}

function setZoom(next: number): void {
  zoomLevel.value = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
}

function zoomIn(): void {
  setZoom(zoomLevel.value + ZOOM_STEP);
}

function zoomOut(): void {
  setZoom(zoomLevel.value - ZOOM_STEP);
}

function centerOnPlayer(): void {
  focusXRatio.value = 0.5;
  cameraOffsetX.value = 0;
  cameraOffsetY.value = 0;
  measureStage();
  syncProjection();
}

function onWheelZoom(event: WheelEvent): void {
  setZoom(zoomLevel.value + (event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP));
}

function onPointerDown(event: PointerEvent): void {
  if (entryPhase.value !== 'ready' || event.button !== 0) return;
  const target = event.target as HTMLElement | null;
  if (target?.closest('.battle-map-toolbar')) return;
  dragPointerId = event.pointerId;
  dragStartX = dragLastX = event.clientX;
  dragStartY = dragLastY = event.clientY;
  dragMoved = false;
}

function onPointerMove(event: PointerEvent): void {
  if (dragPointerId !== event.pointerId) return;
  if (!dragMoved && Math.hypot(event.clientX - dragStartX, event.clientY - dragStartY) >= DRAG_THRESHOLD) {
    dragMoved = true;
    isDragging.value = true;
    shellRef.value?.setPointerCapture(event.pointerId);
  }
  if (!dragMoved) return;
  cameraOffsetX.value += event.clientX - dragLastX;
  cameraOffsetY.value += event.clientY - dragLastY;
  dragLastX = event.clientX;
  dragLastY = event.clientY;
  event.preventDefault();
}

function finishPointerDrag(event: PointerEvent): void {
  if (dragPointerId !== event.pointerId) return;
  if (dragMoved) {
    suppressNextClick = true;
    requestAnimationFrame(() => { suppressNextClick = false; });
  }
  const shell = shellRef.value;
  if (shell?.hasPointerCapture(event.pointerId)) shell.releasePointerCapture(event.pointerId);
  dragPointerId = null;
  dragMoved = false;
  isDragging.value = false;
}

function onClickCapture(event: MouseEvent): void {
  if (!suppressNextClick) return;
  event.preventDefault();
  event.stopPropagation();
}

function scheduleEntry(): void {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const start = () => {
    if (entryStarted) return;
    entryStarted = true;
    entryPhase.value = 'rising';
    if (reduceMotion) {
      entryPhase.value = 'actors';
      settleActorStage();
      syncAllPositions();
      playAllFirstEntries();
      settleTileRise();
      playerAvatarStore.commitAppearance('battle');
      settlePlayerEntry();
      requestAnimationFrame(settleReady);
      return;
    }
    timers.push(setTimeout(() => {
      entryPhase.value = 'actors';
      settleActorStage();
      syncAllPositions();
      playAllFirstEntries();
      if (!displayEntities.value.some(entity => entity.id === 'player')) settlePlayerEntry();
    }, 850));
    timers.push(setTimeout(settleTileRise, 930));
    void Promise.all([tileRisePromise, playerEntryPromise]).then(settleReady);
  };
  requestAnimationFrame(start);
  timers.push(setTimeout(start, 80));
}

watch([zoomLevel, focusXRatio, cameraOffsetX, cameraOffsetY, visualPlayerPls], syncProjection);

onMounted(() => {
  measureStage();
  if (shellRef.value) {
    resizeObserver = new ResizeObserver(measureStage);
    resizeObserver.observe(shellRef.value);
  }
  scheduleEntry();
});

onUnmounted(() => {
  for (const timer of timers) clearTimeout(timer);
  resizeObserver?.disconnect();
  settleActorStage();
  settleTileRise();
  settlePlayerEntry();
  settleReady();
  disposeEntities();
});
</script>

<template>
  <section class="battle-map-panel flex min-h-0 min-w-0 flex-col border-r border-fg-dim/30">
    <header class="battle-map-header flex-none">
      <div class="battle-map-heading">
        <span class="battle-map-kicker">TACTICAL FIELD</span>
        <strong>{{ regionName }}</strong>
      </div>
      <div class="battle-map-status">
        <span>{{ battleStore.currentQid === null ? 'PREP' : `Q-${battleStore.currentQid}` }}</span>
        <span>{{ battleTiles.length }} TILES</span>
      </div>
    </header>

    <div
      ref="shellRef"
      class="battle-map-shell relative min-h-0 flex-1 overflow-hidden"
      :class="[`phase-${entryPhase}`, { 'is-ready': entryPhase === 'ready', 'is-dragging': isDragging }]"
      @wheel.prevent="onWheelZoom"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="finishPointerDrag"
      @pointercancel="finishPointerDrag"
      @click.capture="onClickCapture"
    >
      <div class="battle-map-horizon" aria-hidden="true"></div>
      <div
        ref="gridRef"
        class="battle-map-grid absolute inset-0"
        data-scene-grid="battle"
        :aria-busy="entryPhase !== 'ready'"
      >
        <div v-if="battleTiles.length === 0" class="battle-map-empty">
          等待战场坐标...
        </div>

        <div
          v-for="tile in battleTiles"
          :key="tile.pls"
          class="battle-map-tile"
          :class="tileClass(tile)"
          :data-pls="tile.pls"
          :style="tileStyle(tile)"
          :title="tileTitle(tile)"
        >
          <span class="battle-map-tile-face" aria-hidden="true"></span>
          <span v-if="tileLabel(tile)" class="battle-map-tile-label">{{ tileLabel(tile) }}</span>
          <span v-if="tile.isCurrent" class="battle-map-current-mark" aria-hidden="true"></span>
        </div>

        <div
          v-for="entity in displayEntities"
          :key="entity.id"
          :ref="el => setEntityRef(entity.id, el as HTMLElement | null)"
          class="entity battle-map-entity"
          :class="entityClass(entity)"
          :data-entity-id="entity.id"
          :data-character-pid="entity.characterPid || undefined"
          :data-pls="entity.pls || undefined"
          :title="entityTitle(entity)"
        >
          <span v-if="actorLabelsEnabled" class="actor-debug-label" aria-hidden="true"></span>
          <div
            v-if="actorHud(entity)"
            class="battle-actor-hud"
            :title="`HP ${actorHud(entity)!.hp}/${actorHud(entity)!.mhp} · AP ${actorHud(entity)!.ap}/${actorHud(entity)!.maxAp}`"
          >
            <div class="battle-actor-hud-row">
              <strong>{{ actorHud(entity)!.name }}</strong>
              <span>AP {{ actorHud(entity)!.ap }}/{{ actorHud(entity)!.maxAp }}</span>
            </div>
            <span class="battle-actor-hp-track" aria-hidden="true">
              <span :style="{ width: `${actorHud(entity)!.hpPercent}%` }"></span>
            </span>
          </div>
          <div class="actor-action">
            <div class="actor-visibility">
              <div class="actor-pose">
                <img class="entity-img" :src="entity.img" :alt="entity.id" :style="imgStyle(entity)" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="battle-map-toolbar" aria-label="战斗地图镜头">
        <button type="button" title="缩小战斗地图" aria-label="缩小战斗地图" @click="zoomOut">−</button>
        <span>{{ Math.round(zoomLevel * 100) }}%</span>
        <button type="button" title="放大战斗地图" aria-label="放大战斗地图" @click="zoomIn">+</button>
        <button type="button" title="将镜头居中到玩家" aria-label="将镜头居中到玩家" @click="centerOnPlayer">◎</button>
      </div>

      <div class="battle-map-entry-copy" aria-hidden="true">
        <span>COMBAT SPACE</span>
        <strong>{{ entryPhase === 'ready' ? 'FIELD LOCKED' : 'ASSEMBLING FIELD' }}</strong>
      </div>
    </div>
  </section>
</template>

<style scoped>
.battle-map-panel {
  background: #050505;
}

.battle-map-header {
  min-height: 48px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 7px 12px;
  border-bottom: 1px solid rgba(110, 110, 110, 0.28);
  background: #090909;
}

.battle-map-heading {
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.battle-map-heading strong {
  overflow: hidden;
  color: #d8d8d8;
  font-size: 12px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.battle-map-kicker,
.battle-map-status,
.battle-map-entry-copy span {
  color: #6f6f6f;
  font-size: 9px;
}

.battle-map-status {
  display: flex;
  gap: 10px;
  white-space: nowrap;
}

.battle-map-shell {
  isolation: isolate;
  cursor: grab;
  touch-action: none;
  user-select: none;
  background-color: #030303;
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.018) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.018) 1px, transparent 1px);
  background-size: 28px 28px;
}

.battle-map-shell.is-dragging {
  cursor: grabbing;
}

.battle-map-entity.aim-input-pass-through {
  pointer-events: none;
}

.battle-map-horizon {
  position: absolute;
  inset: 18% 8% 8%;
  z-index: 0;
  border-bottom: 1px solid rgba(150, 150, 150, 0.12);
  box-shadow: 0 28px 48px rgba(0, 0, 0, 0.82);
  pointer-events: none;
}

.battle-map-grid {
  z-index: 1;
  isolation: isolate;
  pointer-events: none;
}

.battle-map-shell.is-ready .battle-map-grid {
  pointer-events: auto;
}

.battle-map-empty {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: #666;
  font-size: 10px;
}

.battle-map-tile {
  position: absolute;
  clip-path: polygon(50% 0, 100% 50%, 50% 100%, 0 50%);
  transform: translateY(150px) scale(0.9);
  opacity: 0;
  color: #888;
  background: rgba(68, 68, 68, 0.34);
  cursor: default;
  will-change: transform, opacity;
}

.phase-rising .battle-map-tile,
.phase-actors .battle-map-tile,
.phase-ready .battle-map-tile {
  transform: translateY(0) scale(1);
  opacity: 1;
  transition:
    transform 520ms cubic-bezier(0.18, 0.82, 0.22, 1) var(--battle-tile-delay),
    opacity 260ms ease-out var(--battle-tile-delay),
    filter 140ms ease,
    background-color 120ms ease;
  filter: drop-shadow(0 8px 7px rgba(0, 0, 0, 0.48));
}

.battle-map-tile-face {
  position: absolute;
  inset: 2px;
  clip-path: inherit;
  background: rgba(255, 255, 255, 0.05);
}

.battle-map-tile:nth-child(3n) .battle-map-tile-face {
  background: rgba(255, 255, 255, 0.035);
}

.battle-map-tile.is-blocked {
  color: #c44;
  background: rgba(204, 68, 68, 0.3);
}

.battle-map-tile.is-blocked .battle-map-tile-face {
  background: #080808;
}

.battle-map-tile.is-metal {
  background: rgba(136, 136, 136, 0.46);
}

.battle-map-tile.is-deep .battle-map-tile-face {
  background: rgba(255, 255, 255, 0.025);
}

.battle-map-tile.is-current .battle-map-tile-face {
  background: #2a2a2a;
  box-shadow: inset 0 0 0 1px rgba(245, 245, 245, 0.9);
}

.battle-map-tile-label {
  position: absolute;
  inset: 0 12%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  color: inherit;
  font-size: 9px;
  line-height: 1;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
  pointer-events: none;
}

.battle-map-current-mark {
  position: absolute;
  inset: 17% 30%;
  clip-path: inherit;
  border: 1px solid rgba(255, 255, 255, 0.74);
  background: rgba(255, 255, 255, 0.08);
  box-shadow: 0 0 7px rgba(255, 255, 255, 0.24);
}

.battle-map-tile.aim-targetable {
  outline: none;
  background: rgba(190, 190, 190, 0.5);
  box-shadow: none;
  cursor: crosshair;
  filter: brightness(1.08) drop-shadow(0 0 5px rgba(230, 230, 230, 0.18));
}

.battle-map-tile.aim-targetable .battle-map-tile-face {
  background: rgba(255, 255, 255, 0.1);
  box-shadow: inset 0 0 0 1px rgba(235, 235, 235, 0.62);
}

.battle-map-tile.aim-out-of-range {
  background: #806c4e;
  cursor: not-allowed;
}

.battle-map-tile.aim-blocked {
  background: #5a3434;
  cursor: not-allowed;
}

.battle-map-tile.aim-hover {
  filter: brightness(1.55);
}

:deep(.battle-map-entity) {
  z-index: 200;
}

.phase-staged :deep(.battle-map-entity),
.phase-rising :deep(.battle-map-entity) {
  visibility: hidden;
}

.phase-actors :deep(.battle-map-entity),
.phase-ready :deep(.battle-map-entity) {
  visibility: visible;
}

.battle-actor-hud {
  position: absolute;
  left: 50%;
  bottom: calc(100% + 6px);
  z-index: 4;
  width: max-content;
  min-width: 86px;
  max-width: 126px;
  transform: translateX(-50%);
  color: #d8d8d8;
  font-size: 8px;
  line-height: 1.2;
  text-shadow: 0 1px 2px #000;
  pointer-events: none;
}

.battle-actor-hud-row {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 7px;
  margin-bottom: 3px;
  padding: 2px 4px;
  border: 1px solid rgba(180, 180, 180, 0.34);
  background: rgba(4, 4, 4, 0.86);
}

.battle-actor-hud-row strong {
  min-width: 0;
  overflow: hidden;
  font-size: 9px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.battle-actor-hud-row span {
  flex: none;
  color: #a8c4d8;
}

.battle-actor-hp-track {
  display: block;
  height: 4px;
  overflow: hidden;
  border: 1px solid rgba(175, 175, 175, 0.32);
  background: rgba(0, 0, 0, 0.82);
}

.battle-actor-hp-track > span {
  display: block;
  height: 100%;
  background: #c6574f;
  transition: width 180ms ease-out;
}

.phase-actors .battle-actor-hud {
  animation: battle-hud-arrive 420ms 180ms ease-out both;
}

@keyframes battle-hud-arrive {
  from { opacity: 0; transform: translate(-50%, 8px); }
  to { opacity: 1; transform: translate(-50%, 0); }
}

:deep(.battle-map-entity.entity-dimmed) {
  filter: opacity(0.42) saturate(0.45);
}

.battle-map-toolbar {
  position: absolute;
  top: 9px;
  right: 9px;
  z-index: 500;
  display: flex;
  height: 28px;
  align-items: center;
  gap: 3px;
  padding: 2px;
  border: 1px solid rgba(145, 145, 145, 0.28);
  background: rgba(5, 5, 5, 0.86);
  opacity: 0.42;
  pointer-events: none;
  cursor: default;
}

.battle-map-shell.is-ready .battle-map-toolbar {
  opacity: 1;
  pointer-events: auto;
}

.battle-map-toolbar button {
  display: grid;
  width: 23px;
  height: 22px;
  place-items: center;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 3px;
  color: #c8c8c8;
  background: transparent;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
}

.battle-map-toolbar button:hover,
.battle-map-toolbar button:focus-visible {
  border-color: rgba(205, 205, 205, 0.34);
  background: #1c1c1c;
  outline: none;
}

.battle-map-toolbar > span {
  width: 34px;
  color: #777;
  font-size: 8px;
  text-align: center;
}

.battle-map-entry-copy {
  position: absolute;
  left: 12px;
  bottom: 9px;
  z-index: 400;
  display: flex;
  flex-direction: column;
  pointer-events: none;
}

.battle-map-entry-copy strong {
  color: #a5a5a5;
  font-size: 10px;
  font-weight: 600;
}

.phase-ready .battle-map-entry-copy {
  opacity: 0.45;
}

@media (max-width: 900px) {
  .battle-map-header {
    min-height: 38px;
    padding: 4px 8px;
  }

  .battle-map-kicker,
  .battle-map-status {
    font-size: 8px;
  }

  .battle-map-heading strong {
    font-size: 10px;
  }

  .battle-map-entry-copy {
    left: 8px;
    bottom: 5px;
  }

  .battle-map-toolbar {
    top: 5px;
    right: 5px;
  }

  .battle-actor-hud {
    min-width: 74px;
    max-width: 104px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .battle-map-tile {
    transform: none;
    opacity: 1;
    transition: none;
  }

  .phase-actors .battle-actor-hud {
    animation: none;
  }
}
</style>
