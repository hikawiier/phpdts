<script setup lang="ts">
/**
 * @module L Vue 组件
 * @framework L-7 混合渲染策略地图网格
 */
// ══════════════════════════════════════════════════
// MapGrid — 地图网格组件
//
// 阶段 B 策略（M3B）：响应式数据驱动渲染。
//   cells computed（来自 useMapRender）返回 CellData[]，
//   本组件用 v-for 渲染，:class/:style/{{}} 绑定数据。
//
// 职责：
//   - 挂载 #mapGrid + #mapContainer DOM 元素
//   - v-for 渲染 cells（替代 innerHTML 命令式渲染）
//   - onMounted: 注册业务回调 + 应用布局 + 初始化交互 + 居中
//   - watch mapStore 数据变化 → 重新应用布局 + 居中
//   - onUnmounted: 清理事件监听 + 重置渲染状态
//
// 注意：#mapGrid 和 #mapContainer 的 id 保留（与现有 CSS + useMapInteraction 一致）。
//       cell DOM 由 Vue v-for 管理，不能再通过 innerHTML 修改。
//       shakeCurrentCell/highlightCell/showPathPreview 仍通过 class 切换操作 DOM
//       （只添加/移除临时 class，不修改内容，与 Vue 虚拟 DOM 兼容）。
// ══════════════════════════════════════════════════

import { ref, onMounted, onUnmounted, watch, nextTick, computed } from 'vue';
import { useMapStore } from '@/stores/map';
import { useCharacterStore } from '@/stores/character';
import {
  cells,
  gridStyle,
  nameFontSize,
  renderMapGrid,
  resetRenderState,
  triggerCellClick,
  triggerEnemyClick,
  triggerCellHover,
  triggerCellLeave,
  type CellData,
} from '@/composables/useMapRender';
import { initMapInteraction, centerOnPlayer } from '@/composables/useMapInteraction';
import { setupMapCallbacks } from '@/composables/useMapBusiness';
import { dataManager } from '@/stores/data-manager';
import { useMapEntities } from '@/composables/useMapEntities';
import { useBattleStore } from '@/stores/battle';
import { usePlayerAvatarStore } from '@/stores/player-avatar';
import { useUiStore } from '@/stores/ui';
import type { MapEntity } from '@/types/map-entity';
import { isBattleMapInputLocked } from '@/stores/battle-ui-policy';
import { usePresentationSceneStore } from '@/stores/presentation-scene';
import { selectAimTileFromMapObject, useAimTargetingStore, type AimTileVisualState } from '@/stores/aim-targeting';
import { isDebugEnabled } from '@/utils/debug-flags';

const mapStore = useMapStore();
const characterStore = useCharacterStore();
const battleStore = useBattleStore();
const playerAvatarStore = usePlayerAvatarStore();
const uiStore = useUiStore();
const presentationScene = usePresentationSceneStore();
const aimTargetingStore = useAimTargetingStore();
const actorLabelsEnabled = isDebugEnabled('labels');

function isMapCommandInputLocked(): boolean {
  return isBattleMapInputLocked({
    currentMode: battleStore.currentMode,
    isPlayingBattleLog: battleStore.isPlayingBattleLog,
    isProcessingBattle: battleStore.isProcessingBattle,
    presentationPhase: presentationScene.phase,
  });
}

// ─── DOM 引用（供布局计算 + 交互事件使用） ───
const gridRef = ref<HTMLElement | null>(null);
const containerRef = ref<HTMLElement | null>(null);

// ─── 多实体动画 composable（替代 useActors） ───
// gridRef 复用上面的 #mapGrid 引用，useMapEntities 内部 watch(gridRef) 挂载 ResizeObserver
const entityAnim = useMapEntities(gridRef);
const { setEntityRef, syncAllPositions, displayEntities, dispose: disposeEntities } = entityAnim;

// ─── 交互事件 cleanup 函数 ───
let cleanupInteraction: (() => void) | null = null;

// ─── 初始渲染标志（避免 watch 在 onMounted 前触发） ───
let initialized = false;

// ─── 错误/加载状态提示（cells 为空时显示） ───
const placeholderText = computed<string>(() => {
  if (mapStore.loading) return 'loading...';
  if (mapStore.error) return '数据加载失败';
  if (!mapStore.links) return '等待地图加载...';
  return 'no grid data';
});

// ─── 实体立绘高度动态绑定（imgHeightRatio × 100%） ───
function imgStyle(entity: MapEntity): Record<string, string> {
  const ratio = entity.imgHeightRatio ?? 1;
  return { height: `${ratio * 100}%` };
}

// ─── 实体 class 计算（含战斗中非活跃实体半透明） ───
// inCombat === true：正常不透明
// inCombat === false 且 currentMode === 'battle' 且 hasActiveCombat：半透明
// 预装填阶段（currentMode='battle' 但 combatContext 未加载）：hasActiveCombat=false，不半透明
// 探索模式：忽略 inCombat，全部正常显示
const hasActiveCombat = computed(() =>
  displayEntities.value.some(entity => entity.inCombat === true),
);

function entityClass(entity: MapEntity): Record<string, boolean> {
  const inBattle = battleStore.currentMode === 'battle';
  const dimmed = inBattle && hasActiveCombat.value && entity.inCombat === false;
  return {
    [`entity-${entity.kind}`]: true,
    'entity-player': entity.id === 'player',
    'entity-dimmed': dimmed,
  };
}

function aimStateClass(state: AimTileVisualState): string | null {
  if (state === 'targetable') return 'aim-targetable';
  if (state === 'out-of-range') return 'aim-out-of-range';
  if (state === 'blocked') return 'aim-blocked';
  return null;
}

function cellClass(cell: CellData): Array<string[] | string> {
  const state = aimTargetingStore.getTileVisualState(Number(cell.pls), cell.isFogged);
  const aimClass = aimStateClass(state);
  return aimClass ? [cell.classList, aimClass] : [cell.classList];
}

function cellTitle(cell: CellData): string {
  if (!aimTargetingStore.isTileAim || cell.isFogged) return cell.title;
  const option = aimTargetingStore.getTileOption(Number(cell.pls));
  if (!option || option.selectable) return option?.selectable ? '选择目标位置' : '';
  return option.reason || '当前无法选择该位置';
}

// ─── 单元格事件处理 ───
function onCellClick(cell: CellData): void {
  if (uiStore.mapInputMode === 'aim') {
    if (aimTargetingStore.isTileAim) selectAimTileFromMapObject(aimTargetingStore, cell);
    return;
  }
  if (isMapCommandInputLocked()) return;
  if (cell.isEmpty) return;
  if (cell.hasEnemy && cell.enemy) {
    // 敌人格：触发战斗确认
    triggerEnemyClick(cell.enemy);
  } else if (cell.isCurrent || cell.isReachable) {
    // 当前格（探索）/ 可达格（移动）
    triggerCellClick(cell.pls);
  } else if (!cell.passable) {
    // 不可通行格点击反馈
    const msg = cell.name ? '无法通过：' + cell.name : '此处无法通行';
    dataManager.broadcast('ui:toast', { type: 'error', msg });
  }
}

function onCellEnter(cell: CellData): void {
  if (uiStore.mapInputMode === 'aim') return;
  if (isMapCommandInputLocked()) return;
  if (cell.isEmpty || cell.isCurrent || cell.hasEnemy) return;
  if (cell.isReachable) {
    triggerCellHover(cell.pls);
  }
}

function onCellLeave(cell: CellData): void {
  if (uiStore.mapInputMode === 'aim') return;
  if (isMapCommandInputLocked()) return;
  if (cell.isEmpty || cell.isCurrent || cell.hasEnemy) return;
  if (cell.isReachable) {
    triggerCellLeave();
  }
}

function onEntityClick(entity: MapEntity, event: MouseEvent): void {
  if (uiStore.mapInputMode === 'aim') {
    if (aimTargetingStore.isTileAim) {
      event.stopPropagation();
      selectAimTileFromMapObject(aimTargetingStore, entity);
    }
    return;
  }
  if (!entity.characterPid) return;
  if (isMapCommandInputLocked()) return;
  event.stopPropagation();
  const character = characterStore.getCharacter(entity.characterPid);
  if (character && character.type > 0) triggerEnemyClick(character as never);
}

// ─── HP 危险/恢复触发 ───
// 注意：watch(curLoc) 已迁入 useMapEntities（移动后需先 syncAllPositions 再触发 onMove）
watch(
  () => {
    const player = characterStore.player;
    const mhp = player?.mhp ?? 1;
    return (player?.hp ?? 0) / mhp;
  },
  (ratio) => {
    playerAvatarStore.setHpRatio(ratio);
    if (ratio < 0.3) {
      playerAvatarStore.onLowHp();
    } else {
      playerAvatarStore.onNormalHp();
    }
  },
);

// ─── 监听 mapStore 数据变化 → 重新应用布局 + 居中 ───
// cells computed 会自动重新计算（响应式），这里只需处理布局 + 居中
watch(
  () => [mapStore.links, characterStore.mapEnemyList, mapStore.curLoc, mapStore.curRegion],
  () => {
    if (!initialized) return;
    if (!gridRef.value || !containerRef.value) return;
    try {
      renderMapGrid(gridRef.value, containerRef.value);
      // 渲染后居中到玩家位置（等 DOM 更新完成）
      nextTick(() => {
        requestAnimationFrame(() => centerOnPlayer(true));
      });
    } catch (e) {
      console.error('[MapGrid] render error:', e);
    }
  },
  { deep: false }, // 顶层引用变化即可（loadMap 会替换整个 links/enemies）
);

onMounted(() => {
  if (!gridRef.value || !containerRef.value) return;

  playerAvatarStore.preloadAppearanceImages();

  // 1. 注册业务回调（渲染/交互/事件监听/DebugBus）
  setupMapCallbacks();

  // 2. 应用布局（如果 mapStore 已有数据，cells computed 会自动渲染）
  if (mapStore.links && mapStore.curRegion !== null) {
    renderMapGrid(gridRef.value, containerRef.value);
    nextTick(() => {
      requestAnimationFrame(() => centerOnPlayer(true));
    });
  }

  // 3. 初始化交互事件（缩放/平移/键盘/触摸）
  cleanupInteraction = initMapInteraction(containerRef.value, gridRef.value);

  // 4. 首次入场动画由 useMapEntities 的 entities watch 接管：
  //    player el 可用后自动触发 onEnter（setDown + popUp），覆盖预加载和异步加载两种场景。
  //    syncAllPositions 作为初始同步保险（ResizeObserver 首次触发可能延迟一帧）
  nextTick(() => {
    syncAllPositions();
  });

  initialized = true;
});

onUnmounted(() => {
  if (cleanupInteraction) {
    cleanupInteraction();
    cleanupInteraction = null;
  }
  disposeEntities();
  resetRenderState();
  initialized = false;
});
</script>

<template>
  <!-- 地图容器（保留 id 供 useMapInteraction 使用） -->
  <div
    id="mapContainer"
    ref="containerRef"
    class="map-container flex-1 min-h-0 overflow-auto relative"
  >
    <!-- 地图网格（保留 id 供 useMapRender + useMapInteraction 使用） -->
    <div id="mapGrid" ref="gridRef" class="ascii-map-grid" :style="gridStyle">
      <!-- 背景层：纯视觉黑底（立绘可见性由 GSAP alpha 控制，不依赖 z-index 遮挡） -->
      <div class="map-background"></div>

      <!-- 数据不可用时显示占位 -->
      <div v-if="cells.length === 0" class="error">{{ placeholderText }}</div>

      <!-- v-for 渲染 cell 列表 -->
      <div
        v-for="cell in cells"
        :key="cell.key"
        :class="cellClass(cell)"
        :data-pls="cell.pls || undefined"
        :style="cell.styleObj"
        :title="cellTitle(cell)"
        @click="onCellClick(cell)"
        @mouseenter="onCellEnter(cell)"
        @mouseleave="onCellLeave(cell)"
      >
        <!-- 空格子：无内容 -->
        <template v-if="cell.isEmpty"></template>

        <!-- 迷雾格：显示 ? -->
        <template v-else-if="cell.isFogged">
          <span class="cell-name" :style="{ fontSize: nameFontSize + 'px' }">?</span>
        </template>

        <!-- 当前格：立绘已迁出到 #mapGrid 直接子元素（角色层） -->
        <template v-else-if="cell.isCurrent">
          <span class="cell-name pulse-white player-label">
            {{ cell.prefix }}{{ cell.displayLabel }}
          </span>
        </template>

        <!-- 敌人格：前缀 + 地名（敌人名由立绘呈现） -->
        <template v-else-if="cell.hasEnemy">
          <span class="cell-name">
            {{ cell.prefix }}{{ cell.displayLabel }}
          </span>
        </template>

        <!-- 有名格：前缀 + 地名 -->
        <template v-else-if="cell.displayLabel">
          <span class="cell-name" :style="{ fontSize: nameFontSize + 'px' }">{{ cell.prefix }}{{ cell.displayLabel }}</span>
        </template>

        <!-- 无名格：坐标标签 -->
        <template v-else>
          <span class="cell-coord">{{ cell.coordLabel }}</span>
        </template>
      </div>

      <!-- 实体层：所有地图实体（actor/poi/grass/crevice/worm，与 cells 同级，absolute 定位） -->
      <!-- 可见性由 useMapEntities 通过 GSAP alpha 控制（z-index 固定 10，不再切换） -->
      <!-- 角色投影由 .entity-img 的 CSS filter: drop-shadow 提供，无需独立阴影元素 -->
      <!-- displayEntities 中间层：新敌人立即渲染，消失的敌人保留直到淡出动画完成 -->
      <!-- entity-dimmed：战斗中非活跃实体半透明（inCombat === false 且 currentMode === 'battle'） -->
      <div
        v-for="entity in displayEntities"
        :key="entity.id"
        :ref="el => setEntityRef(entity.id, el as HTMLElement | null)"
        class="entity"
        :class="entityClass(entity)"
        :data-entity-id="entity.id"
        :data-character-pid="entity.characterPid || undefined"
        :data-pls="entity.pls || undefined"
        @click="onEntityClick(entity, $event)"
      >
        <span
          v-if="actorLabelsEnabled"
          class="actor-debug-label"
          aria-hidden="true"
        ></span>
        <div class="actor-action">
          <div class="actor-visibility">
            <div class="actor-pose">
              <img class="entity-img" :src="entity.img" :alt="entity.id" :style="imgStyle(entity)" />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ═══ 当前格背景样式 ═══ */
/* 立绘已迁出到 #mapGrid 直接子元素（实体层 .entity），相关样式在 terminal.css 全局定义 */

:deep(.map-cell.current) {
  background: #2a2a2a;
  outline: 1px solid rgba(255, 255, 255, 0.4);
  outline-offset: -1px;
}

/* ═══ 战斗中非活跃实体半透明 ═══ */
/* inCombat === false 且 currentMode === 'battle' 时应用（非战斗 NPC 在战斗中视觉降级） */
/* 用 filter: opacity() 而非 CSS opacity 属性：GSAP alpha 直接设置 inline opacity，
   会覆盖 class 上的 opacity；filter 是独立属性，不被 GSAP 覆盖。
   最终效果 = GSAP opacity × filter opacity（正常 1×1=1，半透明 1×0.5=0.5，死亡淡出 0×0.5=0） */
.entity.entity-dimmed {
  filter: opacity(0.5);
}
</style>
