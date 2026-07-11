<script setup lang="ts">
// ══════════════════════════════════════════════════
// 瞄准模式 / Aim Mode
//
// 替代现有 vex/js/battle-aim.js 的 DOM 操作逻辑。
// 职责：
// - 监听 battle:aim-mode / battle:aim-exit 事件
// - 瞄准模式下标记敌人格为可选目标（.aim-targetable class）
// - mousemove 实时绘制 SVG 贝塞尔曲线（AP 栏 → 光标/敌人）
// - 点击敌人格确认目标 → broadcast 'battle:aim-target-selected'
//
// 实现说明：
// - 敌人格的 .aim-targetable class 通过 DOM 操作添加/移除（CSS 高亮效果）
// - SVG 路径线用 Vue 响应式 aimLine ref + computed pathData 驱动
// - click/mousemove 用事件委托（绑定在 mapGrid 上，检查 event.target.closest）
// ══════════════════════════════════════════════════

import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { dataManager } from '@/stores/data-manager';
import { useMapStore } from '@/stores/map';
import { useCharacterStore } from '@/stores/character';
import { findPath } from '@/composables/useMapReachability';
import { useBattleStore } from '@/stores/battle';
import type { CombatTargetCandidate } from '@/types/api';
import { findSelectableCombatTarget } from '@/utils/combat-targeting';
import { useAimTargetingStore } from '@/stores/aim-targeting';
import type { AimModeEventData } from '@/types/events';
import { useToastStore } from '@/stores/toast';

// ── 状态 ──
const aimModeActive = ref<boolean>(false);
const aimActionRange = ref<number>(1);
const aimTargetMode = ref<'enemy' | 'tile'>('enemy');
const aimOriginPls = ref<number | null>(null);
const mapStore = useMapStore();
const characterStore = useCharacterStore();
const battleStore = useBattleStore();
const aimTargetingStore = useAimTargetingStore();
const toastStore = useToastStore();
const focusedTargetPid = ref<number | null>(null);
interface DisambiguationState {
  left: number;
  top: number;
  candidates: CombatTargetCandidate[];
  focusedPid: number | null;
}
const disambiguation = ref<DisambiguationState | null>(null);

// ── SVG 路径线数据 ──
interface AimLineData {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  visible: boolean;
}
const aimLine = ref<AimLineData>({ startX: 0, startY: 0, endX: 0, endY: 0, visible: false });

// ── 贝塞尔曲线路径 computed ──
const pathData = computed<string>(() => {
  if (!aimLine.value.visible) return '';
  const { startX, startY, endX, endY } = aimLine.value;

  // 柔化三次贝塞尔曲线：两端切线水平，平滑过渡
  const dx = Math.abs(startX - endX);
  const offset = Math.max(40, dx * 0.35);
  const cp1X = startX - offset;
  const cp1Y = startY;
  const cp2X = endX + offset;
  const cp2Y = endY;

  return `M ${startX} ${startY} C ${cp1X} ${cp1Y}, ${cp2X} ${cp2Y}, ${endX} ${endY}`;
});

// ── 事件处理函数引用（用于 add/removeEventListener） ──
let _onMouseMove: ((e: MouseEvent) => void) | null = null;
let _onMouseLeave: (() => void) | null = null;
let _onClick: ((e: MouseEvent) => void) | null = null;
let _onKeyDown: ((e: KeyboardEvent) => void) | null = null;

// ══════════════════════════════════════════════════
// DOM 元素查询
// ══════════════════════════════════════════════════

function getMapGrid(): HTMLElement | null {
  return document.getElementById('mapGrid');
}

/** 获取 AP 栏元素作为瞄准线起点 */
function getAimStartElement(): HTMLElement | null {
  return (
    document.querySelector<HTMLElement>('.ap-bar-container') ||
    document.getElementById('preloadQueueArea') ||
    document.getElementById('battleActionBar')
  );
}

// ══════════════════════════════════════════════════
// 标记敌人格
// ══════════════════════════════════════════════════

/** 标记所有敌人格为瞄准可选目标 + 绑定事件 */

function isEnemyInActionRange(pid: number): boolean {
  const range = Math.max(0, Number(aimActionRange.value || 1));
  const enemy = characterStore.enemyList.find(
    (c) => c.pid === pid && String(c.pgroup) === String(mapStore.curRegion),
  );
  const originPls = aimOriginPls.value ?? mapStore.curLoc;
  if (!enemy || originPls === null) return false;
  const path = findPath(originPls, enemy.pls);
  if (!path) return false;
  return Math.max(0, path.length - 1) <= range;
}

function isEnemySelectable(pid: number): boolean {
  return Boolean(findSelectableCombatTarget(
    battleStore.combatTargets,
    battleStore.currentQid,
    pid,
    targetPid => characterStore.getCharacter(targetPid),
  ));
}

function candidateIsSelectable(candidate: CombatTargetCandidate | undefined): boolean {
  return Boolean(candidate)
    && isEnemySelectable(Number(candidate?.pid))
    && isEnemyInActionRange(Number(candidate?.pid));
}

function candidateLabel(candidate: CombatTargetCandidate): string {
  const character = characterStore.getCharacter(Number(candidate.pid));
  return character?.name || `目标 ${candidate.pid}`;
}

function candidateStatus(candidate: CombatTargetCandidate | undefined): string {
  if (!candidate) return '不可选择';
  if (candidateIsSelectable(candidate)) return candidate.participation === 'joinable' ? '可加入' : '参战中';
  if (candidate.selectable && !isEnemyInActionRange(Number(candidate.pid))) return '距离过远';
  return candidate.reason || candidate.participation;
}

function currentTileCandidateIds(): number[] {
  if (!mapStore.links || mapStore.curRegion === null) return [];
  const tiles = mapStore.links.tiles[String(mapStore.curRegion)] ?? {};
  return Object.keys(tiles).map(Number).filter(pls => Number.isFinite(pls) && pls > 0);
}

function applyAimTargetable(): void {
  const grid = getMapGrid();
  if (!grid) return;
  clearAimTargetable();

  if (aimTargetMode.value !== 'tile') {
  const enemyEntities = grid.querySelectorAll<HTMLElement>('[data-character-pid]');
  enemyEntities.forEach((entity) => {
    const pid = parseInt(entity.getAttribute('data-character-pid') || '0');
    entity.classList.remove('aim-targetable', 'aim-out-of-range', 'aim-blocked', 'aim-focused');
    const candidate = battleStore.combatTargets.candidates.find(item => Number(item.pid) === pid);
    if (!candidate) return;
    if (pid > 0 && isEnemySelectable(pid) && isEnemyInActionRange(pid)) {
      entity.classList.add('aim-targetable');
      entity.dataset.aimStatus = 'selectable';
      entity.title = '可选择目标';
      if (pid === focusedTargetPid.value) entity.classList.add('aim-focused');
    } else {
      const outOfRange = isEnemySelectable(pid);
      entity.classList.add(outOfRange ? 'aim-out-of-range' : 'aim-blocked');
      entity.dataset.aimStatus = outOfRange ? 'out-of-range' : 'blocked';
      entity.title = outOfRange ? '目标距离过远' : candidateStatus(candidate);
    }
  });
  }

  // 事件委托：在 mapGrid 上绑定 mousemove + click
  _onMouseMove = onAimMouseMove;
  _onMouseLeave = onAimMouseLeave;
  _onClick = onAimClick;
  grid.addEventListener('mousemove', _onMouseMove);
  grid.addEventListener('mouseleave', _onMouseLeave);
  grid.addEventListener('click', _onClick);
}

/** 清除所有敌人格的瞄准标记和事件 */
function clearAimTargetable(): void {
  const grid = getMapGrid();
  if (!grid) return;

  grid.querySelectorAll<HTMLElement>('.aim-hover').forEach(element => {
    element.classList.remove('aim-hover');
  });
  const markedEntities = grid.querySelectorAll<HTMLElement>(
    '[data-character-pid].aim-targetable, [data-character-pid].aim-out-of-range, '
    + '[data-character-pid].aim-blocked, [data-character-pid].aim-focused',
  );
  markedEntities.forEach((entity) => {
    entity.classList.remove('aim-targetable', 'aim-out-of-range', 'aim-blocked', 'aim-focused');
    if (entity.dataset.aimStatus) {
      delete entity.dataset.aimStatus;
      entity.removeAttribute('title');
    }
  });

  if (_onMouseMove) grid.removeEventListener('mousemove', _onMouseMove);
  if (_onMouseLeave) grid.removeEventListener('mouseleave', _onMouseLeave);
  if (_onClick) grid.removeEventListener('click', _onClick);
  _onMouseMove = null;
  _onMouseLeave = null;
  _onClick = null;
}

// ══════════════════════════════════════════════════
// mousemove：实时绘制瞄准线
// ══════════════════════════════════════════════════

function onAimMouseMove(e: MouseEvent): void {
  const target = e.target as HTMLElement | null;
  const selector = aimTargetMode.value === 'tile'
    ? '[data-pls].aim-targetable'
    : '[data-character-pid].aim-targetable';
  const aimCell = target?.closest?.(selector) as HTMLElement | null;

  // 清除所有敌人格的 aim-hover，仅高亮当前
  const grid = getMapGrid();
  if (grid) {
    grid.querySelectorAll<HTMLElement>('.aim-hover').forEach((c) => c.classList.remove('aim-hover'));
  }

  if (aimCell) {
    aimCell.classList.add('aim-hover');
    const rect = aimCell.getBoundingClientRect();
    drawAimLine(rect.left + rect.width / 2, rect.top + rect.height / 2);
  } else {
    drawAimLine(e.clientX, e.clientY);
  }
}

/** 光标离开地图区域：清除瞄准线 */
function onAimMouseLeave(): void {
  const grid = getMapGrid();
  if (grid) {
    grid.querySelectorAll<HTMLElement>('.aim-hover').forEach((c) => c.classList.remove('aim-hover'));
  }
  clearAimLine();
}

// ══════════════════════════════════════════════════
// 点击敌人格确认目标
// ══════════════════════════════════════════════════

function onAimClick(e: MouseEvent): void {
  const target = e.target as HTMLElement | null;
  if (aimTargetMode.value === 'enemy') {
    const entity = target?.closest?.('[data-character-pid]') as HTMLElement | null;
    if (!entity) return;
    e.stopPropagation();
    const pid = parseInt(entity.getAttribute('data-character-pid') || '0');
    const clicked = characterStore.getCharacter(pid);
    if (!clicked || clicked.type <= 0) return;
    const sameTileCandidates = battleStore.combatTargets.candidates.filter(candidate => {
      const character = characterStore.getCharacter(Number(candidate.pid));
      return Boolean(character && character.type > 0
        && String(character.pgroup) === String(clicked.pgroup)
        && String(character.pls) === String(clicked.pls));
    });
    if (sameTileCandidates.length > 1) {
      disambiguation.value = {
        left: Math.max(4, Math.min(e.clientX + 8, window.innerWidth - 220)),
        top: Math.max(4, Math.min(e.clientY + 8, window.innerHeight - 180)),
        candidates: sameTileCandidates,
        focusedPid: candidateIsSelectable(sameTileCandidates.find(item => Number(item.pid) === pid) as CombatTargetCandidate)
          ? pid
          : (sameTileCandidates.find(candidateIsSelectable)?.pid ?? null),
      };
      return;
    }
    confirmEnemyTarget(pid);
    return;
  }

  const tileTarget = target?.closest?.('[data-pls]') as HTMLElement | null;
  const pls = Number(tileTarget?.getAttribute('data-pls') || 0);
  if (pls > 0 && aimTargetingStore.selectTile(pls)) {
    e.stopPropagation();
  }
}

function confirmEnemyTarget(pid: number): void {
  if (!isEnemySelectable(pid) || !isEnemyInActionRange(pid)) return;
  disambiguation.value = null;
  dataManager.broadcast('battle:aim-target-selected', { pid });
}

function onDisambiguationSelect(candidate: CombatTargetCandidate): void {
  if (!candidateIsSelectable(candidate)) return;
  confirmEnemyTarget(Number(candidate.pid));
}

function refreshDisambiguation(): void {
  const current = disambiguation.value;
  if (!current || current.candidates.length === 0) return;
  const anchorCharacter = current.candidates
    .map(candidate => characterStore.getCharacter(Number(candidate.pid)))
    .find(Boolean);
  if (!anchorCharacter) {
    disambiguation.value = null;
    return;
  }
  const candidates = battleStore.combatTargets.candidates.filter(candidate => {
    const character = characterStore.getCharacter(Number(candidate.pid));
    return Boolean(character && character.type > 0 && character.state === 0
      && String(character.pgroup) === String(anchorCharacter.pgroup)
      && String(character.pls) === String(anchorCharacter.pls));
  });
  if (candidates.length <= 1) {
    disambiguation.value = null;
    return;
  }
  const focusedStillValid = candidates.some(candidate => Number(candidate.pid) === current.focusedPid && candidateIsSelectable(candidate));
  disambiguation.value = {
    ...current,
    candidates,
    focusedPid: focusedStillValid ? current.focusedPid : (candidates.find(candidateIsSelectable)?.pid ?? null),
  };
}

// ══════════════════════════════════════════════════
// SVG 瞄准线绘制
// ══════════════════════════════════════════════════

/**
 * 绘制瞄准路径线（AP 栏左边缘 → 指定坐标）
 *
 * 更新 aimLine ref，由 computed pathData 驱动 SVG 渲染。
 */
function drawAimLine(endX: number, endY: number): void {
  const startEl = getAimStartElement();
  if (!startEl) return;

  const startRect = startEl.getBoundingClientRect();
  const startX = startRect.left;
  const startY = startRect.top + startRect.height / 2;

  aimLine.value = {
    startX,
    startY,
    endX,
    endY,
    visible: true,
  };
}

/** 清除瞄准路径线 */
function clearAimLine(): void {
  aimLine.value = { ...aimLine.value, visible: false };
}

// ══════════════════════════════════════════════════
// 退出瞄准模式
// ══════════════════════════════════════════════════

function exitAimMode(): void {
  // 广播 battle:aim-exit，PreloadArea 监听后清理自身状态
  dataManager.broadcast('battle:aim-exit');
}

// ══════════════════════════════════════════════════
// 事件监听
// ══════════════════════════════════════════════════

function onAimMode(data?: unknown): void {
  const payload = (data || {}) as AimModeEventData & {
    actId?: string;
    focusedTargetPid?: number | string | null;
  };
  aimActionRange.value = Math.max(0, Number(payload.actionRange || 1));
  aimTargetMode.value = payload.targetMode === 'tile' ? 'tile' : 'enemy';
  const originPls = payload.originPls !== undefined && payload.originPls !== null
    ? Number(payload.originPls)
    : Number(mapStore.curLoc);
  aimOriginPls.value = Number.isFinite(originPls) && originPls > 0 ? originPls : null;
  const focused = Number(payload.focusedTargetPid || 0);
  focusedTargetPid.value = Number.isFinite(focused) && focused > 0 ? focused : null;
  disambiguation.value = null;
  aimModeActive.value = true;
  void aimTargetingStore.enter({
    actId: String(payload.actId ?? payload.skillId ?? ''),
    targetMode: aimTargetMode.value,
    prefixActions: payload.prefixActions ?? [],
    candidateIds: currentTileCandidateIds(),
  });
  applyAimTargetable();
}

function onAimExit(): void {
  aimModeActive.value = false;
  aimTargetMode.value = 'enemy';
  aimOriginPls.value = null;
  focusedTargetPid.value = null;
  disambiguation.value = null;
  aimTargetingStore.exit();
  clearAimTargetable();
  clearAimLine();
}

function onBattleEnded(): void {
  if (aimModeActive.value) {
    exitAimMode();
  }
}

function onMapLoaded(): void {
  if (!aimModeActive.value) return;
  if (aimTargetMode.value === 'tile') void aimTargetingStore.refresh(currentTileCandidateIds());
  applyAimTargetable();
}

onMounted(() => {
  dataManager.listen('battle:aim-mode', onAimMode);
  dataManager.listen('battle:aim-exit', onAimExit);
  dataManager.listen('battle:ended', onBattleEnded);
  dataManager.listen('map:loaded', onMapLoaded);

  // ESC 键退出瞄准模式
  _onKeyDown = (e: KeyboardEvent) => {
    if (aimModeActive.value && e.key === 'Escape') {
      if (disambiguation.value) {
        disambiguation.value = null;
        return;
      }
      exitAimMode();
    } else if (aimModeActive.value && aimTargetMode.value === 'enemy' && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter'].includes(e.key)) {
      const pool = disambiguation.value?.candidates ?? battleStore.combatTargets.candidates;
      const selectable = pool.filter(candidateIsSelectable);
      if (selectable.length === 0) return;
      const activePid = disambiguation.value?.focusedPid ?? focusedTargetPid.value;
      const current = selectable.findIndex(c => Number(c.pid) === activePid);
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        const candidate = selectable[current >= 0 ? current : 0];
        confirmEnemyTarget(Number(candidate.pid));
        return;
      }
      e.preventDefault();
      const delta = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
      const nextIndex = (current + delta + selectable.length) % selectable.length;
      const nextPid = Number(selectable[nextIndex].pid);
      if (disambiguation.value) disambiguation.value.focusedPid = nextPid;
      else {
        focusedTargetPid.value = nextPid;
        applyAimTargetable();
      }
    }
  };
  document.addEventListener('keydown', _onKeyDown);
});

watch(
  () => [battleStore.combatTargets, characterStore.aliveList.map(c => `${c.pid}:${c.pgroup}:${c.pls}:${c.state}`).join('|')],
  () => {
    if (aimModeActive.value) nextTick(() => {
      if (aimTargetMode.value !== 'tile') applyAimTargetable();
      refreshDisambiguation();
    });
  },
  { deep: true },
);

watch(
  () => aimTargetingStore.error,
  error => {
    if (aimModeActive.value && error) {
      toastStore.showToast(error, 'error', 3000, false, 'aim-preview-error');
    }
  },
);

onUnmounted(() => {
  dataManager.unlisten('battle:aim-mode', onAimMode);
  dataManager.unlisten('battle:aim-exit', onAimExit);
  dataManager.unlisten('battle:ended', onBattleEnded);
  dataManager.unlisten('map:loaded', onMapLoaded);
  clearAimTargetable();
  clearAimLine();
  if (_onKeyDown) {
    document.removeEventListener('keydown', _onKeyDown);
  }
});
</script>

<template>
  <!-- SVG 瞄准线覆盖层（Teleport to body，fixed 定位） -->
  <Teleport to="body">
    <svg
      v-show="aimLine.visible"
      class="aim-line-overlay"
    >
      <path :d="pathData" />
      <circle
        v-if="aimLine.visible"
        :cx="aimLine.startX"
        :cy="aimLine.startY"
        r="3"
        class="aim-dot"
      />
      <circle
        v-if="aimLine.visible"
        :cx="aimLine.endX"
        :cy="aimLine.endY"
        r="3"
        class="aim-dot"
      />
    </svg>
  </Teleport>
  <Teleport to="body">
    <div
      v-if="disambiguation"
      class="aim-disambiguation"
      :style="{ left: `${disambiguation.left}px`, top: `${disambiguation.top}px` }"
      role="menu"
      aria-label="选择同格目标"
      @click.stop
    >
      <button
        v-for="candidate in disambiguation.candidates"
        :key="candidate.pid"
        type="button"
        class="aim-disambiguation-item"
        :class="{
          focused: disambiguation.focusedPid === Number(candidate.pid),
          blocked: !candidateIsSelectable(candidate),
        }"
        :disabled="!candidateIsSelectable(candidate)"
        role="menuitem"
        @click="onDisambiguationSelect(candidate)"
      >
        <span>{{ candidateLabel(candidate) }}</span>
        <span class="aim-disambiguation-status">{{ candidateStatus(candidate) }}</span>
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.aim-line-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  pointer-events: none;
  z-index: 500;
}

.aim-line-overlay path {
  fill: none;
  stroke: #ff6b6b;
  stroke-width: 1.5;
  stroke-dasharray: 4 3;
  opacity: 0.7;
}

.aim-line-overlay .aim-dot {
  fill: #ff6b6b;
  opacity: 0.8;
}

:global(.aim-targetable) {
  outline: 1px solid #ff6b6b;
  box-shadow: inset 0 0 0 1px rgba(255, 107, 107, 0.65), 0 0 8px rgba(255, 107, 107, 0.35);
  cursor: crosshair;
}

:global(.aim-hover) {
  filter: brightness(1.25);
}

:global(.aim-out-of-range) {
  outline: 1px dashed rgba(255, 190, 90, 0.8);
  box-shadow: inset 0 0 0 999px rgba(0, 0, 0, 0.35);
  cursor: not-allowed;
}

:global(.aim-blocked) {
  outline: 1px dotted rgba(150, 150, 150, 0.7);
  box-shadow: inset 0 0 0 999px rgba(0, 0, 0, 0.52);
  cursor: not-allowed;
}

:global(.aim-focused) {
  outline-width: 2px;
  filter: brightness(1.2);
}

.aim-disambiguation {
  position: fixed;
  z-index: 530;
  width: 210px;
  border: 1px solid #777;
  background: #090909;
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.65);
  padding: 4px;
}

.aim-disambiguation-item {
  width: 100%;
  min-height: 30px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border: 1px solid transparent;
  background: transparent;
  color: #ddd;
  padding: 4px 6px;
  text-align: left;
  cursor: pointer;
}

.aim-disambiguation-item.focused {
  border-color: #ff6b6b;
  background: rgba(255, 107, 107, 0.12);
}

.aim-disambiguation-item.blocked {
  color: #777;
  cursor: not-allowed;
}

.aim-disambiguation-status {
  color: #999;
  font-size: 10px;
  white-space: nowrap;
}
</style>

