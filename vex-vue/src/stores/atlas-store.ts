/**
 * @module L Vue 组件
 * @framework L-10 完整地图全屏模态场景
 */

// ══════════════════════════════════════════════════
// 完整地图视图状态 store / Atlas Store
//
// F-K3-Atlas / B5.1-B5.19：完整地图全屏模态场景状态。
// 区域数据从 atlas-projection 派生（共享 K-6 底层认知状态，不复制真值）。
//
// 承载完整地图的视图状态与目标操作：
//   - 视图变换：zoom / panX / panY（AtlasScene 应用为 CSS transform）
//   - pendingFocus：'player' | 'target' | 'fit' | null
//     由顶栏工具按钮触发，AtlasScene watch 并消费后回 null
//     （避免 store 直接持有 DOM 尺寸，初始适配算法在组件内执行）
//   - 选中图格 / hover 图格（桌面 tooltip + 手机横屏选中详情）
//   - 路线显示开关 / 历史路线图层（B5.15-B5.17）
//   - 提交目标：将选中格同步到 explore.target，关闭 atlas（B5.9）
//
// 与 explore 的衔接：
//   - atlas 通过 atlas-projection 共享底层认知状态
//   - commitTarget 调用 explore.setTarget(pls, name)（正式签名）
//   - 真实寻路由 3.4 移动导演承载；本 store 仅标记目标
//   - 提交后将预览路线推入 historyRoutes（模拟导航完成，B5.17）
//     3.4 移动导演完成后可重新推入实际路线覆盖
//
// 选中/hover 状态用 pls（位置 ID）而非 AtlasTile 引用存储：
//   - atlas-projection.tiles 是 computed，每次 mapStore 变化都重新生成新对象
//   - 若直接持有 AtlasTile 引用，tiles 重算后会变成"陈旧"对象
//   - 用 pls 标识 + computed 查找，保证选中/hover 在 tiles 重算时仍有效
//
// 不变量：
//   - 打开 atlas 不推进游戏刻（B5.1）：本 store 不调用 explore.moveTo
//   - 提交目标后立即清除预览路线，不残留（B5.16）
//   - 历史路线与当前目标路线视觉区分（B5.17）
//   - 完整地图是只读视图 + 玩家点击触发导航命令，本身不需要原子写入语义
// ══════════════════════════════════════════════════

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { useAtlasProjectionStore, type AtlasTile } from '@/stores/atlas-projection';
import { useExploreStore } from '@/stores/explore-store';
import { useSceneStore } from '@/stores/scene-store';
import { useMapStore } from '@/stores/map';
import { useMoveDirectorStore } from '@/stores/move-director';
import { findPath } from '@/composables/useMapReachability';

export type AtlasFocusKind = 'player' | 'target' | 'fit';

export interface PreviewRoute {
  from: { x: number; y: number };
  to: { x: number; y: number };
  /** true = 已知精确路线（实线）；false = 迷雾方向路线（虚线，B5.13） */
  known: boolean;
}

export interface HistoryRoute {
  id: number;
  from: { x: number; y: number };
  to: { x: number; y: number };
  name: string;
  known: boolean;
}

const ZOOM_MIN = 0.3;
const ZOOM_MAX = 3.0;
const ZOOM_STEP = 1.15;

let historyIdSeq = 1;

export const useAtlasStore = defineStore('atlas', () => {
  const projection = useAtlasProjectionStore();
  const explore = useExploreStore();
  const scene = useSceneStore();
  const mapStore = useMapStore();
  const moveDirector = useMoveDirectorStore();

  // ── 区域数据（派生自 atlas-projection，不复制真值） ──
  const tiles = computed<AtlasTile[][]>(() => projection.tiles);
  const playerX = computed<number>(() => projection.playerX);
  const playerY = computed<number>(() => projection.playerY);
  const gridW = computed<number>(() => projection.gridW);
  const gridH = computed<number>(() => projection.gridH);
  const regionName = computed<string>(() => projection.regionName);

  // ── 视图变换 ──
  // zoom = 1 表示初始适配状态（由 AtlasScene onMounted 根据工作区计算 actualBaseScale）
  // 实际渲染缩放 = actualBaseScale * zoom；panX/panY 是相对于初始适配的偏移
  const zoom = ref<number>(1);
  const panX = ref<number>(0);
  const panY = ref<number>(0);
  const pendingFocus = ref<AtlasFocusKind | null>(null);

  // ── 选中 / hover（存 pls，避免持有陈旧 tile 引用） ──
  const selectedPls = ref<string | null>(null);
  const hoverPls = ref<string | null>(null);

  // 从 tiles 矩阵中查找 pls 对应的 AtlasTile（响应式，tiles 重算时自动更新）
  const selectedTile = computed<AtlasTile | null>(() => {
    const pls = selectedPls.value;
    if (pls === null) return null;
    for (const row of tiles.value) {
      for (const t of row) {
        if (t.pls === pls) return t;
      }
    }
    return null;
  });
  const hoverTile = computed<AtlasTile | null>(() => {
    const pls = hoverPls.value;
    if (pls === null) return null;
    for (const row of tiles.value) {
      for (const t of row) {
        if (t.pls === pls) return t;
      }
    }
    return null;
  });

  // ── 路线显示 ──
  const routeVisible = ref<boolean>(true);
  const historyVisible = ref<boolean>(false);
  const historyRoutes = ref<HistoryRoute[]>([]);

  // ── 当前临时目标（来自 explore，用于顶栏显示与定位） ──
  const target = computed(() => explore.target);
  const hasTarget = computed(() => explore.target.kind !== 'none');

  // ── 预览路线：从玩家到选中图格（B5.13/B5.14） ──
  // known = 已知精确路线（实线）；!known = 迷雾方向路线（虚线）
  // 用 findPath 计算真实路径：可达且非迷雾 → known；否则 → 迷雾方向
  const previewRoute = computed<PreviewRoute | null>(() => {
    const sel = selectedTile.value;
    if (!sel || sel.current || !sel.pls) return null;
    const curPls = mapStore.curLoc;
    let known = false;
    if (curPls !== null && sel.state !== 'fogged') {
      // findPath 返回 pls 数组（BFS 最短路径）；可达且路径存在 → 已知精确路线
      const path = findPath(curPls, sel.pls);
      known = !!path && path.length > 0;
    }
    return {
      from: { x: playerX.value, y: playerY.value },
      to: { x: sel.x, y: sel.y },
      known,
    };
  });

  // ── 选中图格的认知状态描述 ──
  const selectedStateLabel = computed<string>(() => {
    const t = selectedTile.value;
    if (!t) return '';
    if (t.state === 'fogged') return '迷雾（未揭示）';
    if (t.state === 'revealed') return '已揭示 · 未到达';
    return '已探索';
  });

  // ── 视图操作 ──
  function zoomIn(): void {
    zoom.value = Math.min(ZOOM_MAX, zoom.value * ZOOM_STEP);
  }
  function zoomOut(): void {
    zoom.value = Math.max(ZOOM_MIN, zoom.value / ZOOM_STEP);
  }
  function setZoom(z: number): void {
    zoom.value = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
  }
  function setPan(x: number, y: number): void {
    panX.value = x;
    panY.value = y;
  }
  function panBy(dx: number, dy: number): void {
    panX.value += dx;
    panY.value += dy;
  }
  function resetView(): void {
    // 触发 AtlasScene 重新计算初始适配
    zoom.value = 1;
    panX.value = 0;
    panY.value = 0;
    pendingFocus.value = 'fit';
  }
  function focusPlayer(): void {
    pendingFocus.value = 'player';
  }
  function focusTarget(): void {
    if (!hasTarget.value) return;
    pendingFocus.value = 'target';
  }
  /** AtlasScene 消费 pendingFocus 后调用 */
  function consumePendingFocus(): void {
    pendingFocus.value = null;
  }

  // ── 选中 / hover ──
  function selectTile(t: AtlasTile | null): void {
    selectedPls.value = t && t.pls ? t.pls : null;
  }
  function clearSelection(): void {
    selectedPls.value = null;
  }
  function setHover(t: AtlasTile | null): void {
    hoverPls.value = t && t.pls ? t.pls : null;
  }

  // ── 路线开关 ──
  function toggleRoute(): void {
    routeVisible.value = !routeVisible.value;
  }
  function setRoute(visible: boolean): void {
    routeVisible.value = visible;
  }
  function toggleHistory(): void {
    historyVisible.value = !historyVisible.value;
  }
  function setHistory(visible: boolean): void {
    historyVisible.value = visible;
  }
  function clearHistory(): void {
    historyRoutes.value = [];
  }
  function addHistoryRoute(route: Omit<HistoryRoute, 'id'>): void {
    historyRoutes.value.push({ id: historyIdSeq++, ...route });
  }

  // ── 提交目标（B5.9） ──
  // 将选中图格同步到 explore.target（正式签名 setTarget(pls, name)），
  // 将预览路线推入 historyRoutes（模拟导航完成，B5.17；3.4 移动导演完成后可重新推入实际路线），
  // 清除选中（同时清除预览路线，B5.16），关闭 atlas 回到 explore，
  // 立即触发移动导演开始自动导航（F-K3-Atlas：点击目标后切回主页面并开始自动移动）
  function commitTarget(t: AtlasTile): void {
    if (t.current || !t.pls) return;
    const name = t.name || `位置${t.pls}`;
    // 同步到 explore.target（atlas-projection 共享底层认知状态，pls 与 K-6 一致）
    explore.setTarget(t.pls, name);
    // 推入历史路线（B5.17：导航完成后的实际路线作为独立历史图层）
    addHistoryRoute({
      from: { x: playerX.value, y: playerY.value },
      to: { x: t.x, y: t.y },
      name,
      known: t.state !== 'fogged',
    });
    // 清除选中 → previewRoute 自动清空（B5.16 不残留）
    selectedPls.value = null;
    hoverPls.value = null;
    // 关闭 atlas，回到 explore（F-K3-Atlas §三.4：选择目标后立即关闭）
    scene.closeAtlas();
    // 立即触发移动导演开始自动导航到目标
    // 不 await：commitTarget 是同步函数，移动导演异步执行不阻塞 UI 切换
    moveDirector.startNavigation(explore.tendency, Number(t.pls));
  }

  return {
    // 区域数据（派生自 atlas-projection）
    tiles,
    playerX,
    playerY,
    gridW,
    gridH,
    regionName,
    // 视图变换
    zoom,
    panX,
    panY,
    pendingFocus,
    // 选中 / hover
    selectedTile,
    hoverTile,
    // 路线
    routeVisible,
    historyVisible,
    historyRoutes,
    previewRoute,
    // 派生
    target,
    hasTarget,
    selectedStateLabel,
    // 视图操作
    zoomIn,
    zoomOut,
    setZoom,
    setPan,
    panBy,
    resetView,
    focusPlayer,
    focusTarget,
    consumePendingFocus,
    // 选中 / hover
    selectTile,
    clearSelection,
    setHover,
    // 路线
    toggleRoute,
    setRoute,
    toggleHistory,
    setHistory,
    clearHistory,
    addHistoryRoute,
    // 目标
    commitTarget,
  };
});
