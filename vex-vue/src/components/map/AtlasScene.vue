<script setup lang="ts">
/**
 * @module L Vue 组件
 * @framework L-10 完整地图全屏模态场景
 */
// ══════════════════════════════════════════════════
// AtlasScene — 完整地图模态场景（F-K3-Atlas / B5.1-B5.19）
//
// 由 App.vue 以 absolute inset-0 模态覆盖承载（B5.33 从上方淡入）。
// 本组件负责模态 header 与内部内容：
//   - 区域/目标摘要、视图工具、图层开关与返回入口
//   - 可缩放/拖动的区域地图主区（B5.4/B5.5）
//   - 初始适配算法（B5.3）：根据工作区尺寸自动计算 baseScale，支持任意区域尺寸/极端长宽比
//   - 三态认知视觉（B5.20-B5.25，对齐 LocalMapView 风格）
//   - 桌面 hover 更新右侧详情与路径预览，click 只锁定选中（B5.10/B5.11）
//   - 桌面/手机横屏统一由详情区二次确认"前往"（B5.12）
//   - 路线显示：预览路线（已知精确/迷雾方向，B5.13/B5.14）+ 历史路线独立图层（B5.17）
//   - 路线开关（B5.15）+ 取消选择/提交后预览清除（B5.16）
//   - 右侧详情栏：图格坐标/地名/认知状态/已知内容摘要/"前往"按钮
//   - 不显示正式探索百分比（B5.18）；不显示空间覆盖/迷雾比例/候选目标（B5.19）
//
// 视图变换数学：
//   - BASE_CELL_W = 48px；BASE_CELL_H = 36px（4:3 长宽比，对齐主页面桌面图格）
//   - baseScale = 初始适配缩放（contain 留白并限制最大图格尺度）
//   - actualScale = baseScale * zoom（实际渲染缩放）
//   - 图格轨道直接使用 BASE_CELL * actualScale 计算，文字保持稳定屏幕字号
//   - centerX/Y = 居中偏移（动态计算，resize 时自动调整）
//   - canvas transform 只负责 translate，避免整体缩放同步放大文字和角标
//
// 不变量：
//   - 打开 atlas 不推进游戏刻（B5.1）：本组件不调用 explore.moveTo
//   - 提交目标后立即清除预览路线（B5.16）：commitTarget 清除 selectedPls → previewRoute 自动 null
//   - 历史路线与当前目标路线视觉区分（B5.17）：history 灰虚线 / preview 白实线或白虚线
//   - 区域数据派生自 atlas-projection（共享 K-6 底层认知状态，不复制真值）
// ══════════════════════════════════════════════════

import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import { useAtlasStore } from '@/stores/atlas-store';
import { useExploreStore } from '@/stores/explore-store';
import { useSceneStore } from '@/stores/scene-store';
import { getDirectionArrow } from '@/composables/useMapReachability';
import type { AtlasTile } from '@/stores/atlas-projection';

const atlas = useAtlasStore();
const explore = useExploreStore();
const sceneStore = useSceneStore();

// ── 基准尺寸（与主页面 4:3 长宽比对齐） ──
// 设计意图（F-K3-Atlas §5.1）：完整地图单元格长宽比与主页面一致，避免认知割裂
// 图格尺寸与路线坐标随 actualScale 计算，文字与标记不参与整体缩放
const BASE_CELL_W = 48;
const BASE_CELL_H = 36;
const MAX_FIT_SCALE = 1.45;

// ── compact 自判断（手机横屏布局 / 桌面布局） ──
// 横屏是主设计基准（844×390）；窄屏（<=900px）走手机横屏布局
const isCompact = ref<boolean>(false);
let compactMql: MediaQueryList | null = null;
if (typeof window !== 'undefined' && window.matchMedia) {
  compactMql = window.matchMedia('(max-width: 900px)');
  isCompact.value = compactMql.matches;
}
function onCompactChange(e: MediaQueryListEvent): void {
  isCompact.value = e.matches;
  requestAnimationFrame(() => {
    atlas.setZoom(1);
    atlas.setPan(0, 0);
    computeBaseScale();
  });
}

// ── DOM 引用与工作区尺寸 ──
const mapViewportRef = ref<HTMLDivElement | null>(null);
const viewportW = ref<number>(0);
const viewportH = ref<number>(0);

// ── 拖动状态 ──
const dragging = ref<boolean>(false);
const dragStartX = ref<number>(0);
const dragStartY = ref<number>(0);
const dragStartPanX = ref<number>(0);
const dragStartPanY = ref<number>(0);
const hasDragged = ref<boolean>(false);

// ── 初始适配缩放（让整个网格以 92% 边距适配可视区） ──
const baseScale = ref<number>(1);
const actualScale = computed<number>(() => baseScale.value * atlas.zoom);

const gridPxW = computed<number>(() => atlas.gridW * BASE_CELL_W);
const gridPxH = computed<number>(() => atlas.gridH * BASE_CELL_H);
const cellW = computed<number>(() => BASE_CELL_W * actualScale.value);
const cellH = computed<number>(() => BASE_CELL_H * actualScale.value);
const renderGridW = computed<number>(() => gridPxW.value * actualScale.value);
const renderGridH = computed<number>(() => gridPxH.value * actualScale.value);
const showTileNames = computed<boolean>(() => cellW.value >= 54 && cellH.value >= 34);

// 居中偏移（动态计算，resize 时自动调整；panX/panY 是用户相对偏移）
const centerX = computed<number>(() => (viewportW.value - renderGridW.value) / 2);
const centerY = computed<number>(() => (viewportH.value - renderGridH.value) / 2);

const canvasStyle = computed(() => ({
  transform: `translate(${atlas.panX + centerX.value}px, ${atlas.panY + centerY.value}px)`,
}));

const gridStyle = computed(() => ({
  gridTemplateColumns: `repeat(${atlas.gridW}, ${cellW.value}px)`,
  gridTemplateRows: `repeat(${atlas.gridH}, ${cellH.value}px)`,
  width: `${renderGridW.value}px`,
  height: `${renderGridH.value}px`,
}));

// ── 初始适配算法（B5.3） ──
function computeBaseScale(): void {
  const vw = viewportW.value;
  const vh = viewportH.value;
  if (vw <= 0 || vh <= 0) return;
  // contain 策略：取宽高方向的较小缩放，确保整个网格可见
  // 支持任意区域尺寸和极端长宽比（1:20 / 20:1）
  const scaleX = gridPxW.value > 0 ? vw / gridPxW.value : 1;
  const scaleY = gridPxH.value > 0 ? vh / gridPxH.value : 1;
  // 留 8% 边距暗示下方探索场景（设计案 §7.5 桌面"保留少量边缘"）
  baseScale.value = Math.min(Math.min(scaleX, scaleY) * 0.9, MAX_FIT_SCALE);
}

// ── 居中到指定网格坐标 ──
function centerOnCell(x: number, y: number): void {
  const cellPxX = (x + 0.5) * BASE_CELL_W;
  const cellPxY = (y + 0.5) * BASE_CELL_H;
  const scaledX = cellPxX * actualScale.value;
  const scaledY = cellPxY * actualScale.value;
  // 使 (scaledX, scaledY) 位于 viewport 中心：pan = viewportCenter - scaledX - centerX
  atlas.setPan(
    viewportW.value / 2 - scaledX - centerX.value,
    viewportH.value / 2 - scaledY - centerY.value,
  );
}

// ── 从 pls 查找 tiles 矩阵中的 AtlasTile（定位临时目标用） ──
function findTileByPls(pls: string | number): AtlasTile | null {
  const target = String(pls);
  for (const row of atlas.tiles) {
    for (const t of row) {
      if (t.pls === target) return t;
    }
  }
  return null;
}

// ── 坐标标签（与 useMapRender.coordLabel 格式一致：行字母 A-Z + 列数字 0-N） ──
// 设计意图：完整地图坐标显示与主页面地图保持认知一致（F-K3-Atlas §5.1）
// 数据/视图分离：坐标格式是视图层关注点，不污染 AtlasTile 数据结构
function coordLabel(x: number, y: number): string {
  return String.fromCharCode(65 + y) + x;
}

// ── 消费 pendingFocus（顶栏工具按钮触发） ──
watch(
  () => atlas.pendingFocus,
  (kind) => {
    if (!kind) return;
    // 等待 DOM 更新与样式应用
    requestAnimationFrame(() => {
      if (kind === 'fit') {
        computeBaseScale();
        atlas.setPan(0, 0);
      } else if (kind === 'player') {
        centerOnCell(atlas.playerX, atlas.playerY);
      } else if (kind === 'target') {
        // explore.target.pls 是位置 ID，需查找 tiles 矩阵获取 x/y
        const t = explore.target;
        if (t.kind === 'active' || t.kind === 'paused') {
          const tile = findTileByPls(t.pls);
          if (tile) centerOnCell(tile.x, tile.y);
        }
      }
      atlas.consumePendingFocus();
    });
  },
);

// ── 初始化与生命周期 ──
let resizeObserver: ResizeObserver | null = null;

function onWheel(e: WheelEvent): void {
  e.preventDefault();
  if (!mapViewportRef.value) return;
  const rect = mapViewportRef.value.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;
  // 鼠标在网格坐标系中的位置（缩放前）
  const oldScale = actualScale.value;
  const gridX = (mouseX - atlas.panX - centerX.value) / oldScale;
  const gridY = (mouseY - atlas.panY - centerY.value) / oldScale;
  // 缩放
  const delta = e.deltaY < 0 ? 1.12 : 1 / 1.12;
  const newZoom = Math.max(0.3, Math.min(3.0, atlas.zoom * delta));
  atlas.setZoom(newZoom);
  // 调整 pan 使鼠标位置保持在同一网格点
  const newScale = actualScale.value;
  atlas.setPan(
    mouseX - centerX.value - gridX * newScale,
    mouseY - centerY.value - gridY * newScale,
  );
}

onMounted(() => {
  if (compactMql) {
    compactMql.addEventListener('change', onCompactChange);
  }
  if (mapViewportRef.value) {
    viewportW.value = mapViewportRef.value.clientWidth;
    viewportH.value = mapViewportRef.value.clientHeight;
    // 每次打开都从完整区域适配开始，不继承上次缩放或平移。
    atlas.setZoom(1);
    atlas.setPan(0, 0);
    computeBaseScale();
    resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      viewportW.value = entry.contentRect.width;
      viewportH.value = entry.contentRect.height;
      // 仅在 fit 状态（zoom=1, pan=0,0）下重新计算 baseScale，避免破坏用户视图
      if (atlas.zoom === 1 && atlas.panX === 0 && atlas.panY === 0) {
        computeBaseScale();
      }
    });
    resizeObserver.observe(mapViewportRef.value);
    // wheel 事件需 passive: false 才能 preventDefault
    mapViewportRef.value.addEventListener('wheel', onWheel, { passive: false });
  }
});

onBeforeUnmount(() => {
  if (resizeObserver && mapViewportRef.value) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
  if (mapViewportRef.value) {
    mapViewportRef.value.removeEventListener('wheel', onWheel);
  }
  if (compactMql) {
    compactMql.removeEventListener('change', onCompactChange);
    compactMql = null;
  }
});

// ── 拖动 ──
function onDragStart(e: MouseEvent): void {
  if (e.button !== 0) return;
  dragging.value = true;
  hasDragged.value = false;
  dragStartX.value = e.clientX;
  dragStartY.value = e.clientY;
  dragStartPanX.value = atlas.panX;
  dragStartPanY.value = atlas.panY;
}
function onDragMove(e: MouseEvent): void {
  if (!dragging.value) return;
  const dx = e.clientX - dragStartX.value;
  const dy = e.clientY - dragStartY.value;
  if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
    hasDragged.value = true;
  }
  atlas.setPan(dragStartPanX.value + dx, dragStartPanY.value + dy);
}
function onDragEnd(): void {
  dragging.value = false;
}

// ── 图格显示文字（地名或位置+pls，与 useMapRender.displayLabel 一致） ──
function tileDisplayLabel(t: AtlasTile): string {
  if (showTileNames.value && t.name) return t.name;
  return coordLabel(t.x, t.y);
}

// ── 图格交互 ──
// 类名与主页面地图（MapGrid.vue / terminal.css）对齐：
//   - 基础类 .map-cell 在模板中固定（复用全局样式）
//   - 四态认知视觉类（non-existent/fogged/cog-revealed/explored/cog-explored）对齐主页面命名
//   - non-existent 是 atlas 独有的第四态扩展（主页面地图通过 visionBounds 过滤不渲染此格）
//   - 死敌/活敌通过 has-enemy / has-dead-enemy 区分（B5.24 补全）
function tileClass(t: AtlasTile): Record<string, boolean> {
  const sel = atlas.selectedTile;
  const isDeadEnemy = !!t.enemy && t.enemy.state > 0;
  const pathArrow = routeArrow(t);
  return {
    // 四态认知视觉（与主页面地图类名对齐）
    'non-existent': t.state === 'non_existent',
    'fogged': t.state === 'fogged',
    'cog-revealed': t.state === 'revealed',
    'explored': t.state === 'explored',
    'cog-explored': t.state === 'explored',
    // 主页面地图现有状态类
    'current': !!t.current,
    'blocked': t.passable === false,
    'is-selected': !!sel && sel.pls === t.pls && !!t.pls,
    'cell-path': pathArrow !== '',
    'has-enemy': !!t.enemy && !isDeadEnemy,
    'has-dead-enemy': isDeadEnemy,
    'has-poi': !!t.poi,
    'has-item': !!t.item,
  };
}

function tileTitle(t: AtlasTile): string {
  if (t.state === 'non_existent') return '不存在的图格';
  if (t.state === 'fogged') return '迷雾（未揭示）';
  const parts: string[] = [];
  if (t.name) parts.push(t.name);
  if (t.pls) parts.push(`位置${t.pls}`);
  // 坐标标签与主页面地图一致（字母+数字，如 C3），不使用 (x,y) 数字元组
  parts.push(coordLabel(t.x, t.y));
  if (t.state === 'revealed') parts.push('已揭示 · 未到达');
  if (t.state === 'explored') parts.push('已探索');
  if (t.passable === false) parts.push('不可通行');
  if (t.enemy) {
    const status = t.enemy.state > 0 ? '（已死亡）' : '';
    parts.push(`敌人${status}：${t.enemy.name}`);
  }
  if (t.poi) parts.push(`POI：${t.poi.name}`);
  if (t.item) parts.push(`道具：${t.item.name}`);
  return parts.join(' · ');
}

function onTileClick(t: AtlasTile): void {
  // 拖动后释放不触发 click
  if (hasDragged.value) {
    hasDragged.value = false;
    return;
  }
  // 空格子（无 pls）不可点击
  if (!t.pls) return;
  // 桌面与手机横屏统一：点击只锁定图格，移动必须由详情区二次确认。
  atlas.selectTile(t);
}

function onTileHover(t: AtlasTile | null): void {
  if (isCompact.value) return;
  atlas.setHover(t);
}

// ── 路线 SVG ──
const routeSvgStyle = computed(() => ({
  width: `${renderGridW.value}px`,
  height: `${renderGridH.value}px`,
}));
const routeSvgViewBox = computed(() => `0 0 ${renderGridW.value} ${renderGridH.value}`);
const previewRoutePoints = computed<string>(() => {
  const route = atlas.previewRoute;
  if (!route) return '';
  return route.points
    .map((point) => `${(point.x + 0.5) * cellW.value},${(point.y + 0.5) * cellH.value}`)
    .join(' ');
});
const knownRouteArrows = computed<ReadonlyMap<string, string>>(() => {
  const route = atlas.previewRoute;
  if (!atlas.routeVisible || !route || !route.known || route.points.length < 3) return new Map();
  const arrows = new Map<string, string>();
  for (let i = 1; i < route.points.length - 1; i++) {
    const from = route.points[i - 1];
    const current = route.points[i];
    const arrow = getDirectionArrow(from, current);
    if (arrow) arrows.set(`${current.x},${current.y}`, arrow);
  }
  return arrows;
});
function routeArrow(t: AtlasTile): string {
  return knownRouteArrows.value.get(`${t.x},${t.y}`) || '';
}

// ── 缩放百分比 ──
const zoomPercent = computed<number>(() => Math.round(atlas.zoom * 100));
const atlasIsFitted = computed<boolean>(
  () => atlas.zoom === 1 && atlas.panX === 0 && atlas.panY === 0,
);

// ── 详情栏：悬浮优先，移出后显示已选图格；无选择时回到当前格 ──
const currentTile = computed<AtlasTile | null>(() => {
  for (const row of atlas.tiles) {
    const tile = row.find((item) => item.current);
    if (tile) return tile;
  }
  return null;
});

const detailTile = computed<AtlasTile | null>(() => {
  if (isCompact.value) return atlas.selectedTile || currentTile.value;
  return atlas.hoverTile || atlas.selectedTile || currentTile.value;
});
const detailIsSelected = computed<boolean>(() => {
  const detail = detailTile.value;
  const selected = atlas.selectedTile;
  return !!detail && !!selected && detail.pls === selected.pls;
});
const gotoButtonText = computed<string>(() => {
  const detail = detailTile.value;
  if (!detail || detail.current) return '当前所在图格';
  if (!detailIsSelected.value) return '点击图格后可前往';
  return '确认前往  ›';
});
const gotoButtonTitle = computed<string>(() => {
  const detail = detailTile.value;
  if (!detail || detail.current) return '当前格';
  if (!detailIsSelected.value) return '先点击图格锁定选择，再确认前往';
  if (explore.inputLocked) return '当前正在执行其他行动';
  return '确认前往此处（关闭完整地图，回到探索场景）';
});

const detailName = computed<string>(() => detailTile.value?.name || '(无地名)');
const detailCoord = computed<string>(() => {
  const t = detailTile.value;
  if (!t) return '';
  const parts: string[] = [];
  if (t.pls) parts.push(`位置${t.pls}`);
  // 坐标标签与主页面地图一致（字母+数字，如 C3），不使用 (x,y) 数字元组
  parts.push(coordLabel(t.x, t.y));
  return parts.join(' · ');
});
const detailStateLabel = computed<string>(() => {
  const t = detailTile.value;
  if (!t) return '';
  if (t.state === 'non_existent') return '不存在的图格';
  if (t.state === 'fogged') return '迷雾（未揭示）';
  if (t.state === 'revealed') return '已揭示 · 未到达';
  return '已探索';
});
const detailSummary = computed<string>(() => {
  const t = detailTile.value;
  if (!t) return '';
  const parts: string[] = [];
  if (t.state === 'non_existent') {
    parts.push('区域拓扑中不存在的图格');
  } else if (t.state === 'fogged') {
    parts.push('迷雾区域，内容未知');
  } else {
    if (t.passable === false) parts.push('不可通行');
    if (t.enemy) {
      const status = t.enemy.state > 0 ? '（已死亡）' : '';
      parts.push(`敌人${status}：${t.enemy.name}`);
    }
    if (t.poi) parts.push(`POI：${t.poi.name}`);
    if (t.item) parts.push(`道具：${t.item.name}`);
    if (parts.length === 0) parts.push('无明显目标');
  }
  return parts.join(' · ');
});

function onGotoDetail(): void {
  const t = atlas.selectedTile;
  if (t && detailIsSelected.value && t.pls && !t.current && !explore.inputLocked) {
    atlas.commitTarget(t);
  }
}

// ── 当前目标显示（来自 explore.target，正式类型 pls/name） ──
const targetLabel = computed<string>(() => {
  const t = explore.target;
  if (t.kind === 'none') return '无';
  if (t.kind === 'paused') return `暂停：${t.name}`;
  return t.name;
});
const targetCoord = computed<string>(() => {
  const t = explore.target;
  if (t.kind === 'none') return '';
  return `位置${t.pls}`;
});
</script>

<template>
  <div class="atlas-shell h-full">
    <header class="atlas-header">
      <div class="atlas-header-identity">
        <span class="atlas-header-title">ATLAS</span>
        <span class="atlas-header-region">{{ atlas.regionName }}</span>
        <span class="atlas-header-size">{{ atlas.gridW }}×{{ atlas.gridH }}</span>
      </div>

      <div class="atlas-header-target" :title="targetCoord || '当前没有移动目标'">
        <span class="atlas-header-label">目标</span>
        <span :class="explore.target.kind === 'none' ? 'atlas-header-muted' : 'atlas-header-target-name'">
          {{ targetLabel }}
        </span>
        <span v-if="targetCoord" class="atlas-header-target-coord">{{ targetCoord }}</span>
      </div>

      <div class="atlas-header-tools" role="toolbar" aria-label="完整地图工具">
        <span class="atlas-header-tool-group">
          <button class="term-btn atlas-header-icon-btn" @click="atlas.zoomOut" title="缩小地图" aria-label="缩小地图">−</button>
          <span class="atlas-header-zoom">{{ zoomPercent }}%</span>
          <button class="term-btn atlas-header-icon-btn" @click="atlas.zoomIn" title="放大地图" aria-label="放大地图">+</button>
        </span>
        <span class="atlas-header-tool-group">
          <button class="term-btn atlas-header-btn" @click="atlas.focusPlayer" title="将玩家位置移到视图中央">玩家</button>
          <button
            class="term-btn atlas-header-btn"
            :disabled="!atlas.hasTarget"
            @click="atlas.focusTarget"
            title="将当前目标移到视图中央"
          >目标</button>
          <button
            class="term-btn atlas-header-btn"
            :class="{ 'is-active': atlasIsFitted }"
            @click="atlas.resetView"
            title="恢复完整区域适配"
          >适配</button>
        </span>
        <span class="atlas-header-tool-group">
          <button
            class="term-btn atlas-header-btn"
            :class="{ 'is-active': atlas.routeVisible }"
            @click="atlas.toggleRoute"
            title="显示或隐藏当前路线"
          >路线</button>
          <button
            class="term-btn atlas-header-btn"
            :class="{ 'is-active': atlas.historyVisible }"
            @click="atlas.toggleHistory"
            title="显示或隐藏历史路线"
          >历史</button>
          <button
            v-if="atlas.historyRoutes.length > 0"
            class="term-btn atlas-header-btn atlas-header-clear"
            @click="atlas.clearHistory"
            title="清除全部历史路线"
          >清除</button>
        </span>
      </div>

      <button class="term-btn atlas-header-close" @click="sceneStore.closeAtlas">返回</button>
    </header>

    <div class="atlas-body flex-1 min-h-0 flex flex-row">
      <!-- ═══ 地图主区 ═══ -->
      <div class="flex-1 min-w-0 flex flex-col">
      <div
        ref="mapViewportRef"
        class="atlas-viewport flex-1 min-h-0 relative overflow-hidden"
        :class="{ 'is-dragging': dragging }"
        @mousedown="onDragStart"
        @mousemove="onDragMove"
        @mouseup="onDragEnd"
        @mouseleave="onDragEnd"
      >
        <!-- 可变换的内层：translate + scale -->
        <div class="atlas-canvas" :style="canvasStyle">
          <!-- 网格（复用主页面地图 .ascii-map-grid 全局样式） -->
          <div class="ascii-map-grid" :style="gridStyle">
            <template v-for="row in atlas.tiles" :key="`ar${row[0]?.y ?? 0}`">
              <div
                v-for="t in row"
                :key="t.pls || `empty-${t.x}-${t.y}`"
                class="map-cell"
                :class="tileClass(t)"
                :title="tileTitle(t)"
                @click="onTileClick(t)"
                @mouseenter="onTileHover(t)"
                @mouseleave="onTileHover(null)"
              >
                <!-- 不存在图格：完全空（non_existent 是 atlas 独有的第四态） -->
                <template v-if="t.state === 'non_existent'"></template>

                <!-- 迷雾格：显示 ?（与主页面一致，复用 .cell-name） -->
                <template v-else-if="t.state === 'fogged'">
                  <span class="cell-name">?</span>
                </template>

                <!-- 当前格：玩家锚点 + 稳定屏幕字号 -->
                <template v-else-if="t.current">
                  <span class="cell-name pulse-white player-label">
                    <span class="player-at">@</span>
                    <span>{{ tileDisplayLabel(t) }}</span>
                  </span>
                </template>

                <template v-else>
                  <span :class="showTileNames && t.name ? 'cell-name' : 'cell-coord'">
                    {{ tileDisplayLabel(t) }}
                  </span>
                </template>

                <!-- 未到达角标：仅在 revealed 态显示（B5.21：· 标记玩家尚未到达） -->
                <span
                  v-if="t.state === 'revealed' && !t.current"
                  class="cell-unreached"
                  title="未到达"
                >·</span>
                <span v-if="t.enemy || t.poi || t.item" class="atlas-markers">
                  <span
                    v-if="t.enemy && !t.current"
                    :class="t.enemy.state > 0 ? 'atlas-marker-enemy-dead' : 'atlas-marker-enemy'"
                    :title="t.enemy.state > 0 ? '敌人（已死亡）' : '敌人'"
                  >E</span>
                  <span v-if="t.poi" class="atlas-marker-poi" title="POI">P</span>
                  <span v-if="t.item" class="atlas-marker-item" title="道具">$</span>
                </span>
                <span v-if="t.passable === false && t.state !== 'fogged' && t.state !== 'non_existent'" class="atlas-blocked" title="不可通行">×</span>
                <span v-if="routeArrow(t)" class="cell-path-arrow">{{ routeArrow(t) }}</span>
              </div>
            </template>
          </div>
          <!-- SVG 路线层（B5.13/B5.14/B5.17） -->
          <svg class="atlas-routes" :viewBox="routeSvgViewBox" :style="routeSvgStyle" aria-hidden="true">
            <!-- 历史路线图层（B5.17，可独立开关） -->
            <template v-if="atlas.historyVisible">
              <line
                v-for="r in atlas.historyRoutes"
                :key="`h${r.id}`"
                :x1="(r.from.x + 0.5) * cellW"
                :y1="(r.from.y + 0.5) * cellH"
                :x2="(r.to.x + 0.5) * cellW"
                :y2="(r.to.y + 0.5) * cellH"
                class="atlas-route-history"
              />
            </template>
            <!-- 预览路线（B5.13/B5.14，开关由 routeVisible 控制） -->
            <polyline
              v-if="atlas.routeVisible && atlas.previewRoute && !atlas.previewRoute.known"
              :points="previewRoutePoints"
              class="atlas-route-preview-fog"
            />
          </svg>
        </div>

        <!-- 缩放指示 -->
        <div class="atlas-zoom-indicator">
          <span>缩放 {{ zoomPercent }}% · {{ atlas.gridW }}×{{ atlas.gridH }}</span>
        </div>
      </div>

      <!-- 地图图例 -->
      <div class="atlas-legend flex-none">
        <span class="legend-group"><span class="legend-label">认知</span><b>@</b>玩家 <b>?</b>迷雾 <b>·</b>未到达 <b>×</b>不可通行</span>
        <span class="legend-group"><span class="legend-label">内容</span><b>E</b>敌人 <b class="legend-enemy-dead">E</b>死敌 <b>P</b>POI <b>$</b>道具</span>
        <span class="legend-group"><span class="legend-label">路线</span><span class="legend-route-known">→ 已知</span><span class="legend-route-fog">┄ 未知</span><span class="legend-route-history">┄ 历史</span></span>
      </div>
    </div>

      <!-- ═══ 右侧详情栏 ═══ -->
      <div class="flex flex-col border-l border-fg-dim/30 atlas-detail" :class="{ 'is-compact': isCompact }">
        <div class="ascii-title flex-none m-2 mb-1.5">
          <span>┌─</span>
          <span class="ascii-label">DETAIL · 图格详情</span>
          <span>─</span>
          <span class="flex-1 ascii-line"></span>
          <span>┐</span>
        </div>
        <div class="flex-1 overflow-y-auto min-h-0 p-3 atlas-detail-body">
          <!-- 选中/悬停图格详情 -->
          <div class="action-subtitle">{{ isCompact ? '已选图格' : '悬停图格' }}</div>
          <div v-if="detailTile" class="detail-panel">
            <div class="detail-name">{{ detailName }}</div>
            <div class="detail-coord">{{ detailCoord }}</div>
            <div class="detail-state"><span class="detail-state-mark"></span>{{ detailStateLabel }}</div>
            <div class="detail-summary">{{ detailSummary }}</div>
            <button
              class="term-btn detail-goto"
              :disabled="!detailIsSelected || detailTile.current || !detailTile.pls || explore.inputLocked"
              :title="gotoButtonTitle"
              @click="onGotoDetail"
            >{{ gotoButtonText }}</button>
          </div>
          <div v-else class="tile-empty">
            {{ isCompact ? '— 点击图格选中 —' : '— 悬停图格查看摘要 —' }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.atlas-shell {
  display: flex;
  flex-direction: column;
  background: #0a0a0a;
}
.atlas-body {
  min-width: 0;
}

/* ═══ 模态 Header：区域与目标摘要 + 地图工具 + 返回 ═══ */
.atlas-header {
  flex: 0 0 auto;
  min-width: 0;
  display: grid;
  grid-template-columns: auto minmax(120px, 0.7fr) minmax(0, auto) auto;
  align-items: center;
  gap: 10px;
  padding: 7px 9px;
  background: #0d0d0d;
  border-bottom: 1px solid rgba(86, 86, 86, 0.42);
}
.atlas-header-identity,
.atlas-header-target,
.atlas-header-tools,
.atlas-header-tool-group {
  display: flex;
  align-items: center;
}
.atlas-header-identity {
  min-width: 0;
  gap: 7px;
  white-space: nowrap;
}
.atlas-header-title {
  color: #f2f2f2;
  font-size: 12px;
  font-weight: 800;
}
.atlas-header-region {
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  color: #bdbdbd;
  font-size: 11px;
}
.atlas-header-size,
.atlas-header-label,
.atlas-header-muted,
.atlas-header-target-coord {
  color: #606060;
  font-size: 9px;
  white-space: nowrap;
}
.atlas-header-target {
  min-width: 0;
  gap: 5px;
  padding-left: 9px;
  border-left: 1px solid rgba(74, 74, 74, 0.4);
  overflow: hidden;
}
.atlas-header-target-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  color: #d5d5d5;
  font-size: 10px;
  white-space: nowrap;
}
.atlas-header-tools {
  min-width: 0;
  gap: 7px;
  overflow-x: auto;
  scrollbar-width: none;
}
.atlas-header-tools::-webkit-scrollbar {
  display: none;
}
.atlas-header-tool-group {
  flex: 0 0 auto;
  gap: 2px;
  padding-right: 7px;
  border-right: 1px solid rgba(74, 74, 74, 0.4);
}
.atlas-header-tool-group:last-child {
  padding-right: 0;
  border-right: 0;
}
.atlas-header-btn,
.atlas-header-icon-btn,
.atlas-header-close {
  min-height: 25px;
  padding: 2px 7px;
  border-color: rgba(88, 88, 88, 0.56);
  font-size: 10px;
  letter-spacing: 0;
  white-space: nowrap;
}
.atlas-header-icon-btn {
  width: 25px;
  padding-inline: 0;
  font-size: 14px;
}
.atlas-header-zoom {
  min-width: 36px;
  color: #858585;
  font-size: 9px;
  text-align: center;
}
.atlas-header-btn.is-active {
  color: #f3f3f3;
  border-color: #a5a5a5;
  background: rgba(255, 255, 255, 0.07);
}
.atlas-header-clear {
  color: #777;
}
.atlas-header-close {
  color: #f3f3f3;
  border-color: #a8a8a8;
  background: rgba(255, 255, 255, 0.07);
}

/* ═══ 地图视口 ═══ */
.atlas-viewport {
  background: #020202;
  cursor: grab;
  user-select: none;
  position: relative;
}
.atlas-viewport.is-dragging {
  cursor: grabbing;
}

.atlas-canvas {
  position: absolute;
  top: 0;
  left: 0;
  will-change: transform;
}

/* ═══ 网格容器（模态外框已经承担整体边界，地图不再重复套总边框） ═══ */
/* 全局 .ascii-map-grid 提供 display:grid / gap:0 / position:relative / isolation:isolate */
.ascii-map-grid {
  border: 0;
  background: #000;
  box-shadow: none;
  padding: 0;
}

/* ═══ 单元格（复用全局 .map-cell，atlas 追加 cursor:pointer） ═══ */
/* 全局 .map-cell 提供 border/color/font-size:10px/position:relative/z-index:1/transition 等 */
/* atlas 所有非 non-existent 格都可点击，覆盖 cursor:default */
/* 字号回归全局 9px（cell-name/cell-coord）—— 不再覆盖 11px，与主页面认知一致（D4 对齐） */
.map-cell {
  cursor: pointer;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  font-size: 10px;
  letter-spacing: 0;
}

/* ═══ 四态认知视觉 — atlas 扩展（非存在格） ═══ */
/* non-existent 是 atlas 独有的第四态（主页面地图通过 visionBounds 过滤不渲染此格） */
/* 其余三态（fogged/cog-revealed/explored/cog-explored）复用全局 + 本 scoped 样式 */
.map-cell.non-existent {
  color: transparent;
  background: transparent;
  border-style: none;
  cursor: default;
  pointer-events: none;
}

/* ═══ 三态认知视觉（B5.20-B5.25，与 MapGrid.vue scoped :deep() 同值） ═══ */
/* D3 对齐：补全 cog-revealed/cog-explored 样式，让 atlas 三态认知视觉与主页面一致 */
/* MapGrid 的 :deep() scoped 不会跨组件应用到 atlas，必须在 atlas scoped 内同值定义 */
.map-cell.cog-revealed {
  color: #858585;
  background: rgba(255, 255, 255, 0.018);
  border-style: dashed;
  border-color: rgba(108, 108, 108, 0.42);
}
.map-cell.cog-explored {
  color: #c5c5c5;
  background: rgba(255, 255, 255, 0.035);
  border-style: solid;
  border-color: rgba(92, 92, 92, 0.42);
}

/* B5.23 玩家位置：复用全局 .map-cell.current，atlas 额外强调背景与边框 */
.map-cell.current {
  color: #fff;
  background: rgba(255, 255, 255, 0.1);
  border-color: #fff;
  border-style: solid;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.25);
  z-index: 2;
}

/* hover/选中高亮（atlas 所有非 current 非 non-existent 格可点击，独立 hover 样式） */
.map-cell:hover:not(.current):not(.non-existent) {
  border-color: rgba(255, 255, 255, 0.72);
  background: rgba(255, 255, 255, 0.065);
}
.map-cell.is-selected {
  border-color: #fff;
  border-style: solid;
  background: rgba(255, 255, 255, 0.15);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.4);
  z-index: 3;
}

.map-cell .cell-name,
.map-cell .cell-coord {
  max-width: calc(100% - 10px);
  font-size: 10px;
  line-height: 1.15;
  letter-spacing: 0;
}
.player-label {
  display: inline-flex !important;
  align-items: center;
  justify-content: center;
  gap: 4px;
}
.player-at {
  font-size: 12px;
  line-height: 1;
}

.cell-unreached {
  position: absolute;
  top: 3px;
  left: 5px;
  color: #8d8d8d;
  font-size: 12px;
  line-height: 1;
  pointer-events: none;
}

.atlas-markers {
  position: absolute;
  left: 4px;
  right: 4px;
  bottom: 3px;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 4px;
  font-size: 8px;
  line-height: 1;
  pointer-events: none;
}
.atlas-marker-enemy {
  color: #fff;
  font-weight: 800;
  text-decoration: underline;
  text-underline-offset: 2px;
}
.atlas-marker-enemy-dead {
  color: #666;
  text-decoration: line-through;
}
.atlas-marker-poi {
  color: #c2c2c2;
}
.atlas-marker-item {
  color: #919191;
}
.atlas-blocked {
  position: absolute;
  top: 4px;
  right: 5px;
  color: #8c8c8c;
  font-size: 10px;
  font-weight: 700;
  pointer-events: none;
  line-height: 1;
}

/* ═══ SVG 路线层 ═══ */
.atlas-routes {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
  overflow: visible;
  z-index: 4;
}
/* B5.14 已知精确路线复用全局 .cell-path / .cell-path-arrow。 */
/* B5.13 迷雾方向路线：低权重虚线（不展示真实绕行） */
.atlas-route-preview-fog {
  fill: none;
  stroke: rgba(255, 255, 255, 0.32);
  stroke-width: 1.25;
  stroke-dasharray: 2 5;
  stroke-linecap: square;
}
/* B5.17 历史路线：灰短虚线（与当前目标路线视觉区分） */
.atlas-route-history {
  stroke: rgba(136, 136, 136, 0.55);
  stroke-width: 1.5;
  stroke-dasharray: 1 3;
  stroke-linecap: round;
}

/* ═══ 缩放指示 ═══ */
.atlas-zoom-indicator {
  position: absolute;
  bottom: 8px;
  right: 12px;
  color: #686868;
  font-size: 10px;
  pointer-events: none;
  letter-spacing: 0.05em;
}

/* ═══ 图例 ═══ */
.atlas-legend {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 18px;
  padding: 6px 12px 8px;
  color: #717171;
  font-size: 9px;
  letter-spacing: 0;
  border-top: 1px solid rgba(68, 68, 68, 0.2);
}
.legend-group { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
.legend-label { color: #494949; padding-right: 3px; }
.atlas-legend b { color: #aaa; font-weight: 700; }
.legend-enemy-dead { color: #666 !important; text-decoration: line-through; }
.legend-route-known { color: rgba(255, 255, 255, 0.85); }
.legend-route-fog { color: rgba(255, 255, 255, 0.55); }
.legend-route-history { color: rgba(136, 136, 136, 0.7); }

/* ═══ 详情栏 ═══ */
.atlas-detail {
  flex: 0 0 clamp(280px, 24vw, 340px);
  min-width: 0;
  background: #070707;
}
.atlas-detail.is-compact {
  flex-basis: 36%;
}
.atlas-detail-body { color: #888; font-size: 11px; padding: 10px 14px 14px; }
.detail-panel {
  padding: 9px 0 11px;
  margin-top: 2px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  border-bottom: 1px solid rgba(68, 68, 68, 0.28);
}
.detail-name { color: #f1f1f1; font-size: 13px; font-weight: 700; line-height: 1.35; }
.detail-coord { color: #6f6f6f; font-size: 10px; }
.detail-state { display: flex; align-items: center; gap: 6px; color: #aaa; font-size: 10px; }
.detail-state-mark { width: 5px; height: 5px; border: 1px solid currentColor; flex: 0 0 auto; }
.detail-summary { color: #999; font-size: 10px; line-height: 1.55; word-break: break-word; }
.detail-goto {
  margin-top: 8px;
  padding: 7px 10px;
  min-height: 32px;
  font-size: 11px;
  color: #f2f2f2;
  border-color: #9a9a9a;
  background: rgba(255, 255, 255, 0.055);
  text-align: left;
}
.tile-empty { color: #555; font-size: 11px; padding: 8px 0; }

@media (max-width: 900px) {
  .atlas-header {
    grid-template-columns: minmax(120px, auto) minmax(120px, 1fr) auto;
    grid-template-areas:
      "identity target close"
      "tools tools tools";
    gap: 5px 8px;
    padding: 5px 7px 6px;
  }
  .atlas-header-identity { grid-area: identity; }
  .atlas-header-target { grid-area: target; }
  .atlas-header-tools { grid-area: tools; }
  .atlas-header-close { grid-area: close; }
  .atlas-header-region { max-width: 96px; }
  .atlas-header-target-coord { display: none; }
  .atlas-header-btn,
  .atlas-header-icon-btn,
  .atlas-header-close {
    min-height: 23px;
  }
  .atlas-detail {
    min-width: 236px;
  }
  .atlas-detail-body {
    padding: 8px 10px 12px;
  }
  .atlas-legend {
    gap: 5px 10px;
    padding-block: 4px 6px;
  }
  .legend-group {
    gap: 3px;
  }
}
</style>
