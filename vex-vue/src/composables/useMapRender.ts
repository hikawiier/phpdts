// ══════════════════════════════════════════════════
// 地图渲染层 / Map rendering layer
//
// 替代现有 vex/js/map-render.js。
// 阶段 B 策略（M3B）：响应式数据驱动渲染，
// cells computed 返回 CellData[]，由 MapGrid.vue 用 v-for 渲染。
//
// 职责：
//   - 响应式 cell 数据计算（cells computed）
//   - 网格布局样式计算（gridStyle computed）
//   - 缩放状态管理（通过 useMapZoom）
//   - 自适应格子尺寸 + 智能默认缩放（applyGridLayout）
//   - 事件回调注入（setRenderCallbacks，避免循环依赖）
//
// 依赖：
//   - mapStore（数据源）
//   - useMapReachability（computeReachableMap / isReachable）
//   - useMapZoom（缩放状态）
//   - dataManager（不可通行格点击时广播 ui:toast）
// ══════════════════════════════════════════════════

import { ref, computed, type ComputedRef } from 'vue';
import { useMapStore } from '@/stores/map';
import { useCharacterStore } from '@/stores/character';
import { isFalsy } from '@/utils/format';
import { isReachable } from '@/composables/useMapReachability';
import { createZoomState, ZOOM_STEP } from '@/composables/useMapZoom';
import type { TileInfo } from '@/types/api';
import type { Character } from '@/types/character';

// ─── 渲染回调类型（由 useMapBusiness 注入） ───
export interface RenderCallbacks {
  /** 点击可达格 → 移动 */
  onCellClick: (pls: string | number) => void;
  /** 点击敌人格 → 战斗确认 */
  onEnemyClick: (enemy: Character) => void;
  /** 悬停可达格 → 路径预览 */
  onCellHover: (pls: string | number) => void;
  /** 离开可达格 → 清除预览 */
  onCellLeave: () => void;
  /** 居中到玩家位置（缩放后调用） */
  centerOnPlayer: (smooth: boolean) => void;
}

// ─── CellData 接口（v-for 渲染数据） ───
export interface CellData {
  /** v-for key（pls 或 "empty_x_y"） */
  key: string;
  /** 位置 ID（空格子为空字符串） */
  pls: string;
  /** X 坐标（列） */
  x: number;
  /** Y 坐标（行） */
  y: number;
  /** 坐标标签（如 "D3"） */
  coordLabel: string;

  /** 无 tileInfo 的空格子 */
  isEmpty: boolean;
  /** 是否当前格（玩家所在） */
  isCurrent: boolean;
  /** 是否迷雾格 */
  isFogged: boolean;
  /** 是否可达（BFS 范围内） */
  isReachable: boolean;
  /** 是否出口格 */
  isExit: boolean;
  /** 是否入口格（且有前区域） */
  isEntrance: boolean;
  /** 是否可通行 */
  passable: boolean;
  /** 是否深水（潮汐） */
  isDeep: boolean;
  /** 是否金属地板 */
  isMetal: boolean;
  /** 是否预设安全区 */
  isSafe: boolean;

  /** 敌人对象（无则 null） */
  enemy: Character | null;
  /** 是否有敌人 */
  hasEnemy: boolean;
  /** 敌人名（预计算，避免模板重复访问） */
  enemyName: string;

  /** 地名 */
  name: string;
  /** 前缀符号（▸ 出口 / ◂ 入口 / 空串） */
  prefix: string;
  /** 显示文字（地名或 "位置"+pls，不含前缀） */
  displayLabel: string;

  /** CSS class 数组 */
  classList: string[];
  /** 行内样式（cursor 等） */
  styleObj: Record<string, string>;
  /** tooltip */
  title: string;
}

// ─── 模块级状态（单例，与现有 map-render.js 一致） ───
const zoomState = createZoomState();
let applyZoomTimer: ReturnType<typeof setTimeout> | null = null;

let _callbacks: RenderCallbacks = {
  onCellClick: () => {},
  onEnemyClick: () => {},
  onCellHover: () => {},
  onCellLeave: () => {},
  centerOnPlayer: () => {},
};

// ─── 响应式布局状态（供 gridStyle computed 使用） ───
const baseSize = ref<number>(48);
const baseHeight = ref<number>(32);
const colsRef = ref<number>(10);
const rowsRef = ref<number>(10);

// ─── 计算属性：格子尺寸 / 字体大小 / 网格样式 ───
const cellSize = computed<number>(() => Math.round(baseSize.value * zoomState.zoomLevel.value));
const cellHeight = computed<number>(() => Math.round(baseHeight.value * zoomState.zoomLevel.value));
const nameFontSize = computed<number>(() => Math.max(7, Math.round(9 * zoomState.zoomLevel.value)));
const meFontSize = computed<number>(() => Math.max(6, Math.round(8 * zoomState.zoomLevel.value)));

const gridStyle = computed<Record<string, string>>(() => ({
  gridTemplateColumns: `repeat(${colsRef.value}, ${cellSize.value}px)`,
  gridTemplateRows: `repeat(${rowsRef.value}, ${cellHeight.value}px)`,
}));

/**
 * 构建坐标索引：{x,y} → { pls, tile }
 * 与现有 map-render.js buildCoordIndex 一致
 */
function buildCoordIndex(
  tiles: Record<string, TileInfo & { x?: number; y?: number }>,
): Record<string, { pls: string; tile: TileInfo & { x?: number; y?: number } }> {
  const index: Record<string, { pls: string; tile: TileInfo & { x?: number; y?: number } }> = {};
  for (const pls in tiles) {
    const t = tiles[pls];
    if (t.x !== undefined && t.y !== undefined) {
      index[t.x + ',' + t.y] = { pls, tile: t };
    }
  }
  return index;
}

/**
 * 响应式 cell 数据（替代 renderMapGrid 的 DOM 生成）
 *
 * MapGrid.vue 用 v-for 渲染此数组。每次 mapStore 数据变化（links/enemies/curLoc/curRegion）
 * 或缩放变化时，computed 自动重新计算。
 *
 * 可达性缓存（computeReachableMap）在 mapStore.loadMap 中刷新，
 * 此处仅读取 isReachable 查询结果，不在 computed 中产生副作用。
 */
const cells: ComputedRef<CellData[]> = computed(() => {
  const mapStore = useMapStore();
  const characterStore = useCharacterStore();
  if (!mapStore.links || mapStore.curRegion === null) return [];

  const regionGrid = (mapStore.links.grids as Record<string, { cols?: number; rows?: number }>)[String(mapStore.curRegion)];
  if (!regionGrid) return [];

  const cols = regionGrid.cols || 10;
  const rows = regionGrid.rows || 10;

  const fogData = mapStore.links.fog as Record<string, Record<string, number>> | undefined;
  const regionFog = fogData && fogData[String(mapStore.curRegion)] ? fogData[String(mapStore.curRegion)] : {};
  const regionInfo = (mapStore.links.regions as Record<string, { name?: string; exit_pls?: string | number; entrance_pls?: string | number; prev_region?: string | number | null }>)[String(mapStore.curRegion)];

  const tiles = mapStore.links.tiles[String(mapStore.curRegion)] as Record<string, TileInfo & { x?: number; y?: number; neighbors?: (string | number)[]; passable?: unknown; tide?: string; floor?: string; preset_safe?: unknown }> | undefined;
  const coordIndex = tiles ? buildCoordIndex(tiles) : {};

  const result: CellData[] = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const tileInfo = coordIndex[c + ',' + r];

      // 空格子（无 tileInfo）
      if (!tileInfo) {
        result.push({
          key: 'empty_' + c + '_' + r,
          pls: '',
          x: c,
          y: r,
          coordLabel: '',
          isEmpty: true,
          isCurrent: false,
          isFogged: false,
          isReachable: false,
          isExit: false,
          isEntrance: false,
          passable: false,
          isDeep: false,
          isMetal: false,
          isSafe: false,
          enemy: null,
          hasEnemy: false,
          enemyName: '',
          name: '',
          prefix: '',
          displayLabel: '',
          classList: ['map-cell', 'empty'],
          styleObj: {},
          title: '',
        });
        continue;
      }

      const pls = String(tileInfo.pls);
      // 统一用 String() 比较（curLoc 可能是 number，tileInfo.pls 是 string）
      const isCurrent = String(tileInfo.pls) === String(mapStore.curLoc);
      const isFogged = !isCurrent && !regionFog[pls];
      const isExit = !!(regionInfo && String(tileInfo.pls) === String(regionInfo.exit_pls));
      const isEntrance = !!(regionInfo && String(tileInfo.pls) === String(regionInfo.entrance_pls) && regionInfo.prev_region !== null);
      const passable = !isFalsy(tileInfo.tile.passable);
      const isDeep = tileInfo.tile.tide === 'deep';
      const isMetal = tileInfo.tile.floor === 'metal';
      const isSafe = !!tileInfo.tile.preset_safe;
      const name = (tileInfo.tile.name as string) || '';
      const coordLabel = String.fromCharCode(65 + (tileInfo.tile.y ?? 0)) + (tileInfo.tile.x ?? 0);

      const classList: string[] = ['map-cell'];
      const styleObj: Record<string, string> = {};
      let title = '';

      // 已探索（非迷雾）格才有微背景 + 潮汐/地板视觉
      if (!isFogged) {
        classList.push('explored');
        if (isDeep) classList.push('tide-deep');
        if (isMetal) classList.push('floor-metal');
        if (isSafe) classList.push('safe-zone');
      }

      const prefix = isExit ? '▸' : (isEntrance ? '◂' : '');

      let displayLabel = '';
      let enemy: Character | null = null;
      let hasEnemy = false;
      let enemyName = '';
      let cellReachable = false;

      if (isFogged) {
        classList.push('fogged');
        displayLabel = '?';
      } else if (isCurrent) {
        // 当前格：总是可达
        cellReachable = true;
        classList.push('current', 'reachable');
        if (isExit) classList.push('exit-tile');
        if (isEntrance) classList.push('entrance-tile');
        displayLabel = name || ('位置' + pls);
      } else {
        // 其他格：查询可达性
        cellReachable = isReachable(pls);
        if (cellReachable) {
          classList.push('reachable');
        } else {
          classList.push('unreachable');
        }
        if (!passable) classList.push('blocked');
        if (isExit) classList.push('exit-tile');
        if (isEntrance) classList.push('entrance-tile');

        displayLabel = name;

        // 只读取 enemies 完整快照中的权威可见敌人。
        enemy = characterStore.mapEnemyList.find(e => Number(e.pls) === Number(pls)) || null;
        if (enemy) {
          hasEnemy = true;
          enemyName = enemy.name;
          styleObj.cursor = 'crosshair';
          title = '点击攻击 ' + enemy.name;
        } else if (!cellReachable && !passable) {
          // 不可通行格点击反馈
          styleObj.cursor = 'pointer';
        }
      }

      result.push({
        key: pls,
        pls,
        x: tileInfo.tile.x ?? c,
        y: tileInfo.tile.y ?? r,
        coordLabel,
        isEmpty: false,
        isCurrent,
        isFogged,
        isReachable: cellReachable,
        isExit,
        isEntrance,
        passable,
        isDeep,
        isMetal,
        isSafe,
        enemy,
        hasEnemy,
        enemyName,
        name,
        prefix,
        displayLabel,
        classList,
        styleObj,
        title,
      });
    }
  }

  return result;
});

// ─── 事件触发函数（供 MapGrid.vue 调用，转发到 _callbacks） ───

export function triggerCellClick(pls: string | number): void {
  _callbacks.onCellClick(pls);
}

export function triggerEnemyClick(enemy: Character): void {
  _callbacks.onEnemyClick(enemy);
}

export function triggerCellHover(pls: string | number): void {
  _callbacks.onCellHover(pls);
}

export function triggerCellLeave(): void {
  _callbacks.onCellLeave();
}

/**
 * 注入事件回调，由 useMapBusiness 调用
 * 与现有 map-render.js setRenderCallbacks 语义一致
 */
export function setRenderCallbacks(callbacks: Partial<RenderCallbacks>): void {
  _callbacks = { ..._callbacks, ...callbacks };
}

/**
 * 应用网格布局（测量容器 + 智能默认缩放 + 容器居中）
 *
 * 替代原 renderMapGrid 的布局计算部分，不再生成 cell DOM（由 Vue v-for 管理）。
 * 更新响应式布局状态（baseSize/baseHeight/colsRef/rowsRef），gridStyle computed 自动更新。
 *
 * @param gridEl #mapGrid DOM 元素（仅用于 parentElement 回退）
 * @param containerEl #mapContainer DOM 元素（用于测量容器尺寸 + 居中布局）
 */
function applyGridLayout(
  gridEl: HTMLElement | null,
  containerEl: HTMLElement | null = null,
): void {
  const mapStore = useMapStore();
  if (!mapStore.links || mapStore.curRegion === null) return;

  const regionGrid = (mapStore.links.grids as Record<string, { cols?: number; rows?: number }>)[String(mapStore.curRegion)];
  if (!regionGrid) return;

  const cols = regionGrid.cols || 10;
  const rows = regionGrid.rows || 10;
  colsRef.value = cols;
  rowsRef.value = rows;

  // 自适应格子尺寸：根据容器宽度计算，移动端允许更小
  const isMobile = window.innerWidth <= 900;
  const baseMin = isMobile ? 32 : 48;
  const baseMax = isMobile ? 48 : 80;
  const parent = (containerEl || (gridEl ? gridEl.parentElement : null)) as HTMLElement | null;
  const containerWidth = parent ? parent.offsetWidth - 16 : 0;
  const newBaseSize = Math.max(baseMin, Math.min(baseMax, Math.floor(containerWidth / cols)));
  const newBaseHeight = Math.max(isMobile ? 26 : 36, Math.floor(newBaseSize * 0.75));

  baseSize.value = newBaseSize;
  baseHeight.value = newBaseHeight;

  // 智能默认缩放：首次渲染时自动计算，让地图比容器大 25%（边缘裁切，引导探索）
  if (!zoomState.isInitialized.value) {
    const fitZoomX = containerWidth / (cols * newBaseSize);
    const containerHeight = parent ? parent.offsetHeight - 16 : 0;
    const fitZoomY = containerHeight / (rows * newBaseHeight);
    const fitZoom = Math.min(fitZoomX, fitZoomY);
    const initZoom = Math.max(0.5, Math.min(2.5, fitZoom * 1.25));
    // 四舍五入到 0.05 精度
    zoomState.setZoom(Math.round(initZoom * 20) / 20);
    zoomState.setInitialized(true);
  }

  // 容器居中布局：grid 小于容器时居中，大于容器时从左上角开始（允许滚动居中）
  const zoomLevel = zoomState.getZoom();
  const cs = Math.round(newBaseSize * zoomLevel);
  const ch = Math.round(newBaseHeight * zoomLevel);
  const gridW = cols * cs;
  const gridH = rows * ch;
  if (containerEl) {
    const needCenterX = gridW <= containerEl.clientWidth;
    const needCenterY = gridH <= containerEl.clientHeight;
    containerEl.style.display = 'flex';
    containerEl.style.alignItems = needCenterY ? 'center' : 'flex-start';
    containerEl.style.justifyContent = needCenterX ? 'center' : 'flex-start';
  }

  updateZoomLabel();
}

/**
 * 渲染地图网格（兼容入口）
 *
 * 在 v-for 模式下，cell DOM 由 Vue 自动管理（cells computed → v-for）。
 * 此函数仅应用布局状态（applyGridLayout），保留是因为 useMapInteraction.applyZoom / onResize
 * 仍调用它。
 *
 * @param gridEl #mapGrid DOM 元素
 * @param containerEl #mapContainer DOM 元素
 */
export function renderMapGrid(
  gridEl: HTMLElement | null,
  containerEl: HTMLElement | null = null,
): void {
  applyGridLayout(gridEl, containerEl);
}

/**
 * 更新缩放标签
 */
export function updateZoomLabel(): void {
  const label = document.getElementById('zoomLevel');
  if (label) label.textContent = zoomState.getZoom().toFixed(1) + 'x';
}

/**
 * 应用缩放
 * 与现有 map-render.js applyZoom 一致
 */
export function applyZoom(
  newZoom: number,
  gridEl: HTMLElement | null,
  containerEl: HTMLElement | null = null,
): void {
  const prev = zoomState.getZoom();
  zoomState.setZoom(newZoom);
  if (zoomState.getZoom() === prev) return;
  renderMapGrid(gridEl, containerEl);
  // 延迟居中：等缩放操作稳定后再居中，避免连续快速缩放时反复计算
  if (applyZoomTimer) clearTimeout(applyZoomTimer);
  applyZoomTimer = setTimeout(() => {
    _callbacks.centerOnPlayer(false);
  }, 80);
}

/**
 * 获取当前缩放级别（供 DebugBus 状态注册使用）
 */
export function getZoomLevel(): number {
  return zoomState.getZoom();
}

/**
 * 重置渲染状态（组件卸载时调用）
 */
export function resetRenderState(): void {
  zoomState.reset();
  if (applyZoomTimer) {
    clearTimeout(applyZoomTimer);
    applyZoomTimer = null;
  }
}

// ─── 导出响应式数据 + 常量（供 MapGrid.vue 使用） ───
export {
  cells,
  gridStyle,
  nameFontSize,
  meFontSize,
  ZOOM_STEP,
};
