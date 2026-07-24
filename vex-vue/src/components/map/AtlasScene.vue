<script setup lang="ts">
/**
 * @module L Vue 组件
 * @framework L-10 完整地图全屏模态场景
 */
// ══════════════════════════════════════════════════
// AtlasScene — 完整地图全屏模态场景（F-K3-Atlas / B5.1-B5.19）
//
// 由 App.vue 以 absolute inset-0 模态覆盖承载（B5.33 从上方淡入）。
// 本组件负责内部内容：
//   - 可缩放/拖动的区域地图主区（B5.4/B5.5）
//   - 初始适配算法（B5.3）：根据工作区尺寸自动计算 baseScale，支持任意区域尺寸/极端长宽比
//   - 三态认知视觉（B5.20-B5.25，对齐 LocalMapView 风格）
//   - 桌面 hover tooltip + click 直接前往（B5.10/B5.11）
//   - 手机横屏 click 选中 + 详情区"前往"按钮（B5.12）
//   - 路线显示：预览路线（已知精确/迷雾方向，B5.13/B5.14）+ 历史路线独立图层（B5.17）
//   - 路线开关（B5.15）+ 取消选择/提交后预览清除（B5.16）
//   - 右侧详情栏：图格坐标/地名/认知状态/已知内容摘要/"前往"按钮
//   - 不显示正式探索百分比（B5.18）；不显示空间覆盖/迷雾比例/候选目标（B5.19）
//
// 视图变换数学：
//   - BASE_CELL_W = 30px（基准单元格宽度）；BASE_CELL_H = 22px（基准单元格高度，4:3 长宽比，对齐主页面桌面 48×36）
//   - baseScale = 初始适配缩放（min(viewportW/gridPxW, viewportH/gridPxH) * 0.92）
//   - actualScale = baseScale * zoom（实际渲染缩放）
//   - centerX/Y = 居中偏移（动态计算，resize 时自动调整）
//   - canvas transform: translate(panX + centerX, panY + centerY) scale(actualScale)
//   - transform-origin: 0 0
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
import type { AtlasTile } from '@/stores/atlas-projection';

const atlas = useAtlasStore();
const explore = useExploreStore();

// ── 基准尺寸（与主页面 4:3 长宽比对齐：桌面 48×36 → atlas 30×22） ──
// 设计意图（F-K3-Atlas §5.1）：完整地图单元格长宽比与主页面一致，避免认知割裂
// 拆分 W/H 后，SVG 路线 y 坐标、tooltip 位置、centerOnCell 均需适配 BASE_CELL_H
const BASE_CELL_W = 30;
const BASE_CELL_H = 22;

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

// 居中偏移（动态计算，resize 时自动调整；panX/panY 是用户相对偏移）
const centerX = computed<number>(() => (viewportW.value - gridPxW.value * actualScale.value) / 2);
const centerY = computed<number>(() => (viewportH.value - gridPxH.value * actualScale.value) / 2);

const canvasStyle = computed(() => ({
  transform: `translate(${atlas.panX + centerX.value}px, ${atlas.panY + centerY.value}px) scale(${actualScale.value})`,
  transformOrigin: '0 0',
}));

const gridStyle = computed(() => ({
  gridTemplateColumns: `repeat(${atlas.gridW}, ${BASE_CELL_W}px)`,
  gridTemplateRows: `repeat(${atlas.gridH}, ${BASE_CELL_H}px)`,
  width: `${gridPxW.value}px`,
  height: `${gridPxH.value}px`,
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
  baseScale.value = Math.min(scaleX, scaleY) * 0.92;
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
    computeBaseScale();
    // B5.3 初始适配算法补全：以玩家所在格为视口中心（F-K3-Atlas §5.1 / B5.6 默认行为）
    // 设计意图：玩家打开 atlas 后第一眼看到自己（@标记位于视口中心）
    // 与 B5.3 不冲突：contain 策略保证整个网格可见，centerOnCell 让玩家格位于视口中心
    // 与 pendingFocus='player' 显式触发不同：此为初始默认视图，不通过 pendingFocus 间接路由
    centerOnCell(atlas.playerX, atlas.playerY);
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

// ── 图格前缀（与 useMapRender 一致：出口 ▸ / 入口 ◂ / 空串） ──
// AtlasTile 接口未暴露 isExit/isEntrance；atlas 不强调出入口（视觉密度高，前缀增加噪音）
// 出入口信息通过 tooltip/detail 栏传达（F-K3-Atlas §5.1 视觉简化）
function tilePrefix(_t: AtlasTile): string {
  return '';
}

// ── 图格显示文字（地名或位置+pls，与 useMapRender.displayLabel 一致） ──
function tileDisplayLabel(t: AtlasTile): string {
  return t.name || (t.pls ? `位置${t.pls}` : '');
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
  if (isCompact.value) {
    // 手机横屏（B5.12）：点击选中并显示详情
    atlas.selectTile(t);
  } else {
    // 桌面（B5.11）：点击直接前往（立即关闭完整地图，执行导航）
    atlas.commitTarget(t);
  }
}

function onTileHover(t: AtlasTile | null): void {
  if (isCompact.value) return;
  atlas.setHover(t);
}

// ── tooltip 位置（桌面 B5.10） ──
const tooltipStyle = computed(() => {
  const t = atlas.hoverTile;
  if (!t) return { display: 'none' };
  const cellPxX = t.x * BASE_CELL_W * actualScale.value + atlas.panX + centerX.value;
  const cellPxY = t.y * BASE_CELL_H * actualScale.value + atlas.panY + centerY.value;
  const cellSizeW = BASE_CELL_W * actualScale.value;
  const placeLeft = cellPxX + cellSizeW + 8 + 240 > viewportW.value;
  return {
    left: placeLeft ? `${cellPxX - 248}px` : `${cellPxX + cellSizeW + 8}px`,
    top: `${cellPxY + 8}px`,
  };
});

// ── 路线 SVG ──
const routeSvgStyle = computed(() => ({
  width: `${gridPxW.value}px`,
  height: `${gridPxH.value}px`,
}));
const routeSvgViewBox = computed(() => `0 0 ${gridPxW.value} ${gridPxH.value}`);

// ── 缩放百分比 ──
const zoomPercent = computed<number>(() => Math.round(atlas.zoom * 100));

// ── 详情栏：桌面跟随 hover，手机横屏跟随 selected ──
const detailTile = computed<AtlasTile | null>(() =>
  isCompact.value ? atlas.selectedTile : atlas.hoverTile,
);

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
  const t = detailTile.value;
  if (t && t.pls && !t.current) {
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
  <div class="atlas-shell h-full flex flex-row">
    <!-- ═══ 地图主区 ═══ -->
    <div class="flex-1 min-w-0 flex flex-col">
      <div class="ascii-title flex-none m-2 mb-1.5">
        <span>┌─</span>
        <span class="ascii-label">ATLAS · 完整地图</span>
        <span>─</span>
        <span class="flex-1 ascii-line"></span>
        <span>┐</span>
      </div>
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

                <!-- 当前格：@ + 地名（与主页面一致，复用 .cell-name + .player-at + .pulse-white） -->
                <template v-else-if="t.current">
                  <span class="cell-name pulse-white player-label">
                    <span class="player-at">@</span>{{ tilePrefix(t) }}{{ tileDisplayLabel(t) }}
                  </span>
                </template>

                <!-- 有地名格：显示地名（与主页面一致，复用 .cell-name） -->
                <template v-else-if="t.name">
                  <span class="cell-name">{{ tilePrefix(t) }}{{ t.name }}</span>
                </template>

                <!-- 无地名格：显示坐标 C3（与主页面一致，复用 .cell-coord） -->
                <template v-else>
                  <span class="cell-coord">{{ coordLabel(t.x, t.y) }}</span>
                </template>

                <!-- 未到达角标：仅在 revealed 态显示（B5.21：· 标记玩家尚未到达） -->
                <span
                  v-if="t.state === 'revealed' && !t.current"
                  class="cell-unreached"
                  title="未到达"
                >·</span>
                <!-- 敌人 badge：根据 state 区分死活（B5.24 补全）
                     活敌人：红色高亮 E（威胁优先级高）
                     死敌人：灰色 E + line-through（视觉降级，保留 E 字母表明本质仍是敌人） -->
                <span
                  v-if="t.enemy && !t.current"
                  class="atlas-badge"
                  :class="t.enemy.state > 0 ? 'atlas-badge-enemy-dead' : 'atlas-badge-enemy'"
                  :title="t.enemy.state > 0 ? '敌人（已死亡）' : '敌人'"
                >E</span>
                <!-- POI / 道具 badge：保留 atlas-specific（主页面用立绘呈现） -->
                <span v-if="t.poi" class="atlas-badge atlas-badge-poi" title="POI">P</span>
                <span v-if="t.item" class="atlas-badge atlas-badge-item" title="道具">$</span>
                <!-- 不可通行标记：右下角红色角标（与主页面 .map-cell.blocked 红色文字视觉协调） -->
                <span v-if="t.passable === false && t.state !== 'fogged' && t.state !== 'non_existent'" class="atlas-blocked" title="不可通行">×</span>
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
                :x1="(r.from.x + 0.5) * BASE_CELL_W"
                :y1="(r.from.y + 0.5) * BASE_CELL_H"
                :x2="(r.to.x + 0.5) * BASE_CELL_W"
                :y2="(r.to.y + 0.5) * BASE_CELL_H"
                class="atlas-route-history"
              />
            </template>
            <!-- 预览路线（B5.13/B5.14，开关由 routeVisible 控制） -->
            <line
              v-if="atlas.routeVisible && atlas.previewRoute"
              :x1="(atlas.previewRoute.from.x + 0.5) * BASE_CELL_W"
              :y1="(atlas.previewRoute.from.y + 0.5) * BASE_CELL_H"
              :x2="(atlas.previewRoute.to.x + 0.5) * BASE_CELL_W"
              :y2="(atlas.previewRoute.to.y + 0.5) * BASE_CELL_H"
              :class="atlas.previewRoute.known ? 'atlas-route-preview-known' : 'atlas-route-preview-fog'"
            />
          </svg>
        </div>

        <!-- 桌面 hover tooltip（B5.10） -->
        <div v-if="!isCompact && atlas.hoverTile" class="atlas-tooltip" :style="tooltipStyle">
          <div class="tooltip-name">{{ atlas.hoverTile.name || '(无地名)' }}</div>
          <div class="tooltip-coord">{{ detailCoord }}</div>
          <div class="tooltip-state">{{ detailStateLabel }}</div>
          <div v-if="atlas.hoverTile.enemy" class="tooltip-entity">{{ atlas.hoverTile.enemy.state > 0 ? '敌人（已死亡）' : '敌人' }} · {{ atlas.hoverTile.enemy.name }}</div>
          <div v-if="atlas.hoverTile.poi" class="tooltip-entity">POI · {{ atlas.hoverTile.poi.name }}</div>
          <div v-if="atlas.hoverTile.item" class="tooltip-entity">道具 · {{ atlas.hoverTile.item.name }}</div>
        </div>

        <!-- 缩放指示 -->
        <div class="atlas-zoom-indicator">
          <span>缩放 {{ zoomPercent }}% · {{ atlas.gridW }}×{{ atlas.gridH }}</span>
        </div>
      </div>

      <!-- 地图图例 -->
      <div class="atlas-legend flex-none">
        <span><b>@</b>玩家</span>
        <span><b>?</b>迷雾</span>
        <span><b>·</b>未到达</span>
        <span><b>E</b>敌人</span>
        <span class="legend-enemy-dead"><b>E</b>死敌</span>
        <span><b>P</b>POI</span>
        <span><b>$</b>道具</span>
        <span class="legend-blocked"><b>×</b>不可通行</span>
        <span class="legend-route-known">━ 已知路线</span>
        <span class="legend-route-fog">┄ 迷雾方向</span>
        <span class="legend-route-history">┄ 历史路线</span>
      </div>
    </div>

    <!-- ═══ 右侧详情栏 ═══ -->
    <div class="flex flex-col border-l border-fg-dim/30 atlas-detail" :class="isCompact ? 'w-[34%]' : 'w-[28%]'">
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
        <div v-if="detailTile" class="detail-card">
          <div class="detail-name">{{ detailName }}</div>
          <div class="detail-coord">{{ detailCoord }}</div>
          <div class="detail-state">{{ detailStateLabel }}</div>
          <div class="detail-summary">{{ detailSummary }}</div>
          <button
            class="term-btn detail-goto"
            :disabled="detailTile.current || !detailTile.pls"
            :title="detailTile.current ? '当前格' : '前往此处（关闭完整地图，回到探索场景）'"
            @click="onGotoDetail"
          >{{ detailTile.current ? '[当前格]' : '[前往此处]' }}</button>
        </div>
        <div v-else class="tile-empty">
          {{ isCompact ? '— 点击图格选中 —' : '— 悬停图格查看摘要 —' }}
        </div>

        <!-- 路线显示开关（B5.15） -->
        <div class="action-subtitle" style="margin-top:12px">路线显示</div>
        <div class="route-controls">
          <button
            class="term-btn"
            :class="{ 'is-active': atlas.routeVisible }"
            @click="atlas.toggleRoute"
          >{{ atlas.routeVisible ? '[✓] 当前路线' : '[ ] 当前路线' }}</button>
          <button
            class="term-btn"
            :class="{ 'is-active': atlas.historyVisible }"
            @click="atlas.toggleHistory"
          >{{ atlas.historyVisible ? '[✓] 历史路线' : '[ ] 历史路线' }}</button>
          <button
            v-if="atlas.historyRoutes.length > 0"
            class="term-btn route-clear-btn"
            @click="atlas.clearHistory"
          >[清除历史路线]</button>
        </div>
        <div v-if="atlas.historyRoutes.length > 0" class="history-list">
          <div class="history-count">历史路线 {{ atlas.historyRoutes.length }} 条</div>
          <div v-for="r in atlas.historyRoutes" :key="r.id" class="history-item">
            <span class="history-name">{{ r.name }}</span>
            <span class="history-coord">({{ r.from.x }},{{ r.from.y }})→({{ r.to.x }},{{ r.to.y }})</span>
          </div>
        </div>

        <!-- 当前目标（B5.39 顶栏同步） -->
        <div class="action-subtitle" style="margin-top:12px">当前目标</div>
        <div class="detail-card">
          <div v-if="explore.target.kind === 'none'" class="tile-empty">— 未选择目标 —</div>
          <div v-else>
            <div class="detail-name">{{ targetLabel }}</div>
            <div class="detail-coord">{{ targetCoord }}</div>
            <div class="detail-state">{{ explore.target.kind === 'paused' ? '暂停中' : '激活中' }}</div>
          </div>
        </div>

        <div class="action-subtitle" style="margin-top:12px">操作提示</div>
        <div class="hint-text">
          {{ isCompact
            ? '点击图格选中 → 详情区"前往"按钮提交。工具按钮在顶栏。'
            : '滚轮缩放 · 拖动平移 · 悬停查看 · 点击图格直接前往。工具按钮在顶栏。' }}
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.atlas-shell {
  background: #0a0a0a;
}

/* ═══ 地图视口 ═══ */
.atlas-viewport {
  background:
    repeating-linear-gradient(0deg, rgba(68,68,68,0.06) 0 1px, transparent 1px 48px),
    repeating-linear-gradient(90deg, rgba(68,68,68,0.06) 0 1px, transparent 1px 48px),
    #000;
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

/* ═══ 网格容器（复用全局 .ascii-map-grid，atlas 追加边框/底色） ═══ */
/* 全局 .ascii-map-grid 提供 display:grid / gap:0 / position:relative / isolation:isolate */
/* atlas 在此基础上追加边框与黑底，让完整地图轮廓清晰（主页面地图无此需求，由 .map-background 提供） */
.ascii-map-grid {
  border: 1px solid rgba(68, 68, 68, 0.4);
  background: #000;
  padding: 0;  /* 覆盖全局 2px padding，让网格紧贴边框（与 SVG 路线层坐标对齐） */
}

/* ═══ 单元格（复用全局 .map-cell，atlas 追加 cursor:pointer） ═══ */
/* 全局 .map-cell 提供 border/color/font-size:10px/position:relative/z-index:1/transition 等 */
/* atlas 所有非 non-existent 格都可点击，覆盖 cursor:default */
/* 字号回归全局 9px（cell-name/cell-coord）—— 不再覆盖 11px，与主页面认知一致（D4 对齐） */
.map-cell {
  cursor: pointer;
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
  color: #777;
  background: rgba(255, 255, 255, 0.025);
  border-style: dashed;
  border-color: rgba(68, 68, 68, 0.45);
}
.map-cell.cog-explored {
  color: #bbb;
  background: rgba(255, 255, 255, 0.05);
  border-style: solid;
  border-color: rgba(68, 68, 68, 0.4);
}

/* B5.23 玩家位置：复用全局 .map-cell.current，atlas 额外强调背景与边框 */
.map-cell.current {
  color: #fff;
  background: rgba(255, 255, 255, 0.12);
  border-color: #fff;
  border-style: solid;
  z-index: 2;
}

/* hover/选中高亮（atlas 所有非 current 非 non-existent 格可点击，独立 hover 样式） */
.map-cell:hover:not(.current):not(.non-existent) {
  border-color: rgba(255, 255, 255, 0.6);
  background: rgba(255, 255, 255, 0.08);
}
.map-cell.is-selected {
  border-color: #fff;
  border-style: solid;
  background: rgba(255, 255, 255, 0.15);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.4);
  z-index: 3;
}

/* 玩家 @ 标记：复用全局 .cell-name + .player-at，字号回归全局 9px（D4 对齐） */
/* 全局 .map-cell.current .cell-name 已应用 pulse-white 动画，无需重复定义 */
/* 删除原 .map-cell.current .player-at { font-size: 14px; } 覆盖 —— 与主页面同字号 */

/* 实体角标（B5.24/B5.25，atlas-specific：主页面用立绘呈现，无角标） */
.atlas-badge {
  position: absolute;
  top: 1px;
  font-size: 8px;
  font-weight: 700;
  pointer-events: none;
  line-height: 1;
  padding: 0 2px;
}
/* 活敌人：红色高亮 E（B5.24：威胁优先级高） */
.atlas-badge-enemy {
  left: 2px;
  color: #fff;
  background: rgba(204, 68, 68, 0.85);
  border: 1px solid #f44;
}
/* 死敌人：灰色 × + line-through（B5.24 补全：威胁已消除，视觉降级） */
.atlas-badge-enemy-dead {
  left: 2px;
  color: #666;
  background: rgba(0, 0, 0, 0.7);
  border: 1px solid rgba(136, 136, 136, 0.4);
  text-decoration: line-through;
}
.atlas-badge-poi {
  right: 2px;
  color: #ddd;
  background: rgba(0, 0, 0, 0.7);
  border: 1px solid #888;
}
.atlas-badge-item {
  right: 2px;
  bottom: 1px;
  top: auto;
  color: #ddd;
  background: rgba(0, 0, 0, 0.7);
  border: 1px solid #666;
}
/* 不可通行角标（美学强化 §3.1：从全格 × 覆盖降为右下角红色角标，与主页面 .map-cell.blocked 红色文字视觉协调）
   主内容仍显示地名/坐标，× 角标作辅助标识，避免在 4:3 小格内遮挡信息 */
.atlas-blocked {
  position: absolute;
  bottom: 1px;
  left: 2px;
  color: rgba(204, 68, 68, 0.7);
  font-size: 9px;
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
/* B5.14 已知精确路线：白实线 */
.atlas-route-preview-known {
  stroke: rgba(255, 255, 255, 0.85);
  stroke-width: 2;
  stroke-dasharray: none;
  stroke-linecap: round;
}
/* B5.13 迷雾方向路线：白虚线（不展示真实绕行） */
.atlas-route-preview-fog {
  stroke: rgba(255, 255, 255, 0.45);
  stroke-width: 2;
  stroke-dasharray: 4 4;
  stroke-linecap: round;
}
/* B5.17 历史路线：灰短虚线（与当前目标路线视觉区分） */
.atlas-route-history {
  stroke: rgba(136, 136, 136, 0.55);
  stroke-width: 1.5;
  stroke-dasharray: 1 3;
  stroke-linecap: round;
}

/* ═══ tooltip（B5.10） ═══ */
.atlas-tooltip {
  position: absolute;
  background: #0a0a0a;
  border: 1px solid rgba(68, 68, 68, 0.7);
  padding: 6px 10px;
  font-size: 10px;
  color: #bbb;
  pointer-events: none;
  z-index: 10;
  max-width: 240px;
}
.tooltip-name { color: #fff; font-weight: 700; margin-bottom: 2px; }
.tooltip-coord { color: #888; font-size: 9px; }
.tooltip-state { color: #aaa; font-size: 9px; margin-top: 2px; }
.tooltip-entity { color: #999; font-size: 9px; margin-top: 1px; }

/* ═══ 缩放指示 ═══ */
.atlas-zoom-indicator {
  position: absolute;
  bottom: 8px;
  right: 12px;
  color: #555;
  font-size: 10px;
  pointer-events: none;
  letter-spacing: 0.05em;
}

/* ═══ 图例 ═══ */
.atlas-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  padding: 4px 12px 8px;
  color: #555;
  font-size: 9px;
  letter-spacing: 0.05em;
  border-top: 1px solid rgba(68, 68, 68, 0.2);
}
.atlas-legend b { color: #aaa; font-weight: 700; margin-right: 2px; }
.legend-enemy-dead { color: #666; }
.legend-enemy-dead b { color: #666; text-decoration: line-through; }
.legend-blocked { color: rgba(204, 68, 68, 0.7); }
.legend-blocked b { color: rgba(204, 68, 68, 0.7); }
.legend-route-known { color: rgba(255, 255, 255, 0.85); }
.legend-route-fog { color: rgba(255, 255, 255, 0.55); }
.legend-route-history { color: rgba(136, 136, 136, 0.7); }

/* ═══ 详情栏 ═══ */
.atlas-detail-body { color: #888; font-size: 11px; }
.detail-card {
  border: 1px solid rgba(68, 68, 68, 0.4);
  padding: 8px 10px;
  margin-top: 4px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.detail-name { color: #fff; font-size: 11px; font-weight: 700; }
.detail-coord { color: #777; font-size: 10px; }
.detail-state { color: #aaa; font-size: 10px; }
.detail-summary { color: #999; font-size: 10px; line-height: 1.5; }
.detail-goto { margin-top: 6px; padding: 5px 8px; font-size: 11px; }
.tile-empty { color: #555; font-size: 11px; padding: 8px 0; }

.route-controls { display: flex; flex-direction: column; gap: 4px; margin-top: 4px; }
.route-controls .term-btn { padding: 4px 8px; font-size: 10px; text-align: left; }
.route-controls .term-btn.is-active { border-color: #fff; color: #fff; background: rgba(255,255,255,0.08); }
.route-clear-btn { color: #aaa; border-color: rgba(136, 136, 136, 0.5); }
.route-clear-btn:hover { color: #fff; border-color: #fff; }

.history-list { margin-top: 8px; }
.history-count { color: #888; font-size: 10px; margin-bottom: 4px; }
.history-item {
  display: flex;
  justify-content: space-between;
  padding: 2px 0;
  font-size: 9px;
  color: #777;
  border-bottom: 1px dashed rgba(68, 68, 68, 0.3);
}
.history-name { color: #aaa; }
.history-coord { color: #666; }

.hint-text { color: #666; font-size: 10px; line-height: 1.5; padding: 4px 0; }
</style>
