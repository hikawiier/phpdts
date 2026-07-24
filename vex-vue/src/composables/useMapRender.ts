/**
 * @module M 组合式函数
 * @framework M-3 响应式网格渲染
 */

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
import { task3Debug } from '@/utils/task3-debug';
import type { TileInfo } from '@/types/api';
import type { Character } from '@/types/character';
import { isTileRevealed, type FogProjection } from '@/utils/map-visibility';

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
  /** 路径预览方向箭头（空串表示该格不在预览路径上） */
  pathArrow: string;
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

// ─── 路径预览状态注入（由 useMapInteraction 提供，避免循环依赖） ───
// useMapInteraction 持有响应式 pathPreviewCells 状态并调用 setPathPreviewGetter 注入读取接口；
// cells computed 通过此 getter 读取当前预览，让 Vue 以 :class / v-if 管理 DOM。
const EMPTY_PATH_PREVIEW: ReadonlyMap<string, string> = new Map();
let _pathPreviewGetter: () => ReadonlyMap<string, string> = () => EMPTY_PATH_PREVIEW;

// ─── 临时动画状态（cell-shake / move-highlight） ───
// 由 triggerShakeCurrent / triggerHighlight 写入，cells computed 读取注入 class。
// 取代旧命令式 classList.add + setTimeout 自清理（Vue v-for diff 不清理命令式 class）。
const _shakePls = ref<string | null>(null);
const _highlightPls = ref<string | null>(null);

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

// ─── 局部视野边界（F-K2-Explore §三.1：只渲染当前视野覆盖的局部地图） ──
// 设计案 §7.2：视野之外的图格不进入当前舞台
// 实现：以玩家所在格为中心、半径=VISION_RADIUS+1 的固定矩形（不复制后端 BFS）
//   - VISION_RADIUS 对齐 obl_config.vision_range=1（玩家脚下 + 邻接格）
//   - +1 格余量确保 BFS 可达集（含对角线邻居）落在矩形内
//   - 矩形内非 BFS 可达格自动呈现为迷雾格（isTileRevealed 返回 false）
// cells/gridStyle/applyGridLayout 都引用此边界
const VISION_RADIUS = 1; // 对齐 obl_config.vision_range=1
const visionBounds = computed(() => {
  const mapStore = useMapStore();
  const defaultBounds = { minR: 0, maxR: 0, minC: 0, maxC: 0, cols: 1, rows: 1 };
  if (!mapStore.links || mapStore.curRegion === null || mapStore.curLoc === null) return defaultBounds;

  const tiles = mapStore.links.tiles[String(mapStore.curRegion)] as
    | Record<string, TileInfo & { x?: number; y?: number }>
    | undefined;
  if (!tiles) return defaultBounds;

  // 视觉中心：移动导演逐格播放期间冻结在起点，防止网格跟随 curLoc 即时重居中
  // 导致玩家格始终位于网格中心 → from/anchor 相同 → playWorldMove 跳过动画（K-12）
  const centerPls = mapStore.visualCenter ?? mapStore.curLoc;
  const playerTile = tiles[String(centerPls)];
  if (!playerTile || playerTile.x === undefined || playerTile.y === undefined) return defaultBounds;

  const px = playerTile.x;
  const py = playerTile.y;
  // 半径 = VISION_RADIUS + 1（余量覆盖 BFS 对角线邻居）
  let minC = Math.max(0, px - VISION_RADIUS - 1);
  let maxC = px + VISION_RADIUS + 1;
  let minR = Math.max(0, py - VISION_RADIUS - 1);
  let maxR = py + VISION_RADIUS + 1;

  // K-12-E：跳跃目标扩展——jump tier 目标格常在 5x5 视野外，
  // 扩展 bounds 为包含起点和目标的包围盒，让目标格进入渲染范围
  let jumpTargetXY: { x: number; y: number } | null = null;
  const jumpTarget = mapStore.jumpTargetPls;
  if (jumpTarget !== null) {
    const targetTile = tiles[String(jumpTarget)];
    if (targetTile && targetTile.x !== undefined && targetTile.y !== undefined) {
      jumpTargetXY = { x: targetTile.x, y: targetTile.y };
      minC = Math.min(minC, Math.max(0, jumpTargetXY.x - VISION_RADIUS - 1));
      maxC = Math.max(maxC, jumpTargetXY.x + VISION_RADIUS + 1);
      minR = Math.min(minR, Math.max(0, jumpTargetXY.y - VISION_RADIUS - 1));
      maxR = Math.max(maxR, jumpTargetXY.y + VISION_RADIUS + 1);
    }
  }

  task3Debug.log('map-render.visionBounds.recomputed', {
    centerPls,
    centerSource: mapStore.visualCenter !== null ? 'visualCenter' : 'curLoc',
    curLoc: mapStore.curLoc,
    visualCenter: mapStore.visualCenter,
    jumpTargetPls: jumpTarget,
    jumpTargetXY,
    projectionRevision: mapStore.projectionRevision,
    bounds: { minR, maxR, minC, maxC, cols: maxC - minC + 1, rows: maxR - minR + 1 },
    playerTileXY: { x: px, y: py },
  });

  return {
    minR,
    maxR,
    minC,
    maxC,
    cols: maxC - minC + 1,
    rows: maxR - minR + 1,
  };
});

const gridStyle = computed<Record<string, string>>(() => ({
  gridTemplateColumns: `repeat(${visionBounds.value.cols}, ${cellSize.value}px)`,
  gridTemplateRows: `repeat(${visionBounds.value.rows}, ${cellHeight.value}px)`,
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

  const fogData = mapStore.links.fog as FogProjection;
  const regionInfo = (mapStore.links.regions as Record<string, { name?: string; exit_pls?: string | number; entrance_pls?: string | number; prev_region?: string | number | null }>)[String(mapStore.curRegion)];

  const tiles = mapStore.links.tiles[String(mapStore.curRegion)] as Record<string, TileInfo & { x?: number; y?: number; neighbors?: (string | number)[]; passable?: unknown; tide?: string; floor?: string; preset_safe?: unknown }> | undefined;
  const coordIndex = tiles ? buildCoordIndex(tiles) : {};

  // 读取路径预览状态（响应式，由 useMapInteraction 维护）
  const pathPreview = _pathPreviewGetter();

  // ── 局部视野渲染（F-K2-Explore §三.1：探索场景只渲染当前视野覆盖的局部地图） ──
  // 设计案 §7.2：视野之外的图格不进入当前舞台，不以完整区域迷雾铺满屏幕
  // 复用 visionBounds（视野边界单一信源，M-3 边界来源单一化）：
  //   - visionBounds 以玩家所在格为中心、半径=VISION_RADIUS+1 的固定矩形
  //   - 矩形外的图格完全不渲染（不进入 cells 数组）
  //   - 矩形内仍按 isTileRevealed 区分"已揭示格（显示内容）"与"迷雾格（显示 ?）"
  const renderMinR = visionBounds.value.minR;
  const renderMaxR = visionBounds.value.maxR;
  const renderMinC = visionBounds.value.minC;
  const renderMaxC = visionBounds.value.maxC;

  const result: CellData[] = [];

  for (let r = renderMinR; r <= renderMaxR; r++) {
    for (let c = renderMinC; c <= renderMaxC; c++) {
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
          pathArrow: '',
        });
        continue;
      }

      const pls = String(tileInfo.pls);
      // 统一用 String() 比较（curLoc 可能是 number，tileInfo.pls 是 string）
      const isCurrent = String(tileInfo.pls) === String(mapStore.curLoc);
      const isFogged = !isTileRevealed(fogData, mapStore.curRegion, pls, isCurrent);
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

      // 路径预览：若该格在当前预览路径上，叠加 cell-path class（箭头由 pathArrow 字段驱动 v-if 渲染）
      const pathArrow = pathPreview.get(pls) || '';
      if (pathArrow) {
        classList.push('cell-path');
      }

      // 临时动画：抖动（无效移动反馈）/ 高亮（移动成功反馈）
      // 由 triggerShakeCurrent / triggerHighlight 写入响应式状态，Vue :class 自动管理
      if (_shakePls.value === pls) {
        classList.push('cell-shake');
      }
      if (_highlightPls.value === pls) {
        classList.push('move-highlight');
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
        pathArrow,
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
 * 注入路径预览状态读取接口（由 useMapInteraction 调用）
 *
 * useMapInteraction 持有响应式 pathPreviewCells 状态（pls → arrow），
 * 通过此函数把读取接口注入渲染层。cells computed 调用 getter 读取当前预览，
 * 让 Vue 以 :class / v-if 管理 .cell-path 与 .cell-path-arrow DOM，
 * 取代旧的命令式 appendChild（避免与 v-for diff 冲突导致残留）。
 */
export function setPathPreviewGetter(getter: () => ReadonlyMap<string, string>): void {
  _pathPreviewGetter = getter;
}

// ─── 临时动画响应式状态（cell-shake / move-highlight） ───
// 与路径预览同理：命令式 classList.add 会被 Vue v-for diff 忽略，导致残留。
// 改为响应式状态驱动，cells computed 读取状态注入 class，Vue patch 自动管理。
let _shakeTimer: ReturnType<typeof setTimeout> | null = null;
let _highlightTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 触发当前格抖动动画（无效移动反馈）
 *
 * 读取 mapStore.curLoc 作为抖动目标，300ms 后自动清空状态。
 * 连续触发时清除前一个定时器，避免提前清空新动画。
 */
export function triggerShakeCurrent(): void {
  const mapStore = useMapStore();
  if (mapStore.curLoc === null) return;
  if (_shakeTimer) clearTimeout(_shakeTimer);
  _shakePls.value = String(mapStore.curLoc);
  _shakeTimer = setTimeout(() => {
    _shakePls.value = null;
    _shakeTimer = null;
  }, 300);
}

/**
 * 触发目标格高亮动画（移动成功反馈）
 *
 * @param pls 目标格 pls
 * 600ms 后自动清空状态。连续触发时清除前一个定时器。
 */
export function triggerHighlight(pls: string | number): void {
  if (_highlightTimer) clearTimeout(_highlightTimer);
  _highlightPls.value = String(pls);
  _highlightTimer = setTimeout(() => {
    _highlightPls.value = null;
    _highlightTimer = null;
  }, 600);
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

  // 布局维度来源统一：使用 visionBounds（视野局部矩形），不使用 regionGrid 完整区域维度
  // 渲染层（cells / gridStyle）已使用 visionBounds，布局计算必须同源
  // 否则单格尺寸按完整区域（如 20×20）计算，实际渲染的 5×5 视野网格会缩在容器左上角
  const vb = visionBounds.value;
  if (vb.cols <= 1 && vb.rows <= 1) return; // 安全检查：等待有效视野数据

  const cols = vb.cols;
  const rows = vb.rows;
  colsRef.value = cols;
  rowsRef.value = rows;

  // 自适应格子尺寸：同时考虑容器宽高约束，让视野网格填满容器
  const isMobile = window.innerWidth <= 900;
  const baseMin = isMobile ? 32 : 48;
  const parent = (containerEl || (gridEl ? gridEl.parentElement : null)) as HTMLElement | null;
  const containerWidth = parent ? parent.offsetWidth - 16 : 0;
  const containerHeight = parent ? parent.offsetHeight - 16 : 0;
  // 宽度约束：containerWidth / cols
  // 高度约束：containerHeight / (rows * 0.75)，0.75 = cellHeight/cellWidth 比
  const widthBasedSize = Math.floor(containerWidth / cols);
  const heightBasedSize = Math.floor(containerHeight / (rows * 0.75));
  const newBaseSize = Math.max(baseMin, Math.min(widthBasedSize, heightBasedSize));
  const newBaseHeight = Math.max(isMobile ? 26 : 36, Math.floor(newBaseSize * 0.75));

  baseSize.value = newBaseSize;
  baseHeight.value = newBaseHeight;

  // 智能默认缩放：fit 视野网格到容器（1.0x，不溢出）
  // 视野矩形边缘是迷雾格/空格，无需 1.25x 裁切引导探索；玩家应一眼看清完整视野边界
  if (!zoomState.isInitialized.value) {
    const fitZoomX = containerWidth / (cols * newBaseSize);
    const fitZoomY = containerHeight / (rows * newBaseHeight);
    const fitZoom = Math.min(fitZoomX, fitZoomY);
    const initZoom = Math.max(0.5, Math.min(2.5, fitZoom));
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
  // 清理动画状态与定时器，避免卸载后 setTimeout 触发修改已销毁状态
  if (_shakeTimer) {
    clearTimeout(_shakeTimer);
    _shakeTimer = null;
  }
  if (_highlightTimer) {
    clearTimeout(_highlightTimer);
    _highlightTimer = null;
  }
  _shakePls.value = null;
  _highlightPls.value = null;
}

// ─── 导出响应式数据 + 常量（供 MapGrid.vue 使用） ───
export {
  cells,
  gridStyle,
  nameFontSize,
  meFontSize,
  ZOOM_STEP,
};
