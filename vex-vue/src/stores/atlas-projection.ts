/**
 * @module L Vue 组件
 * @framework L-10 完整地图全屏模态场景
 */

// ══════════════════════════════════════════════════
// 完整地图独立投影 / Atlas Projection
//
// F-K3-Atlas §5.5 / M-K-Module §五 决策方案A：
//   - K-6 MapProjection 仅承载局部视野投影（currentTile/links/enemies）
//   - 完整地图走独立投影（本 store）
//   - 两种投影共享底层认知状态权威源（mapStore.links + exploreStore.exploredTiles）
//
// 本 store 是只读派生层，不写入 mapStore：
//   - 从 mapStore.links.tiles[curRegion] 派生区域完整图格矩阵（AtlasTile[][]）
//   - 从 mapStore.links.grids[curRegion] 获取区域网格尺寸（cols/rows）
//   - 从 mapStore.links.fog[curRegion][pls] 派生"已揭示"维度
//   - 从 exploreStore.isExplored(pls) 派生"已探索"维度
//   - 从 mapStore.enemies 过滤 discovered=1 的敌人（按 pls 索引）
//   - 玩家位置派生自 mapStore.curLoc（K-6 不可变投影，不复制真值）
//
// 三态认知视觉（F-K3-Atlas §5.1 / B5.20-B5.22）：
//   - fogged：迷雾格，只显示位置和轮廓，隐藏 name/passable/enemy/poi/item
//   - revealed：已揭示但未探索，显示已知地图信息（name/passable）+ discovered=1 敌人，标记"未到达"
//   - explored：已探索，显示完整已知信息（name/passable/enemy/poi/item）
//
// 不变量：
//   - 玩家所在格始终视为已探索（B5.23）
//   - 迷雾格隐藏一切内容（B5.20）
//   - discovered=1 的敌人在非迷雾格显示（B5.24）
//   - POI/Item 字段为占位接口（区域级数据源待后端提供，3.3 阶段留空）
//   - 本 store 不推进游戏刻（F-K3-Atlas §三.3）：纯只读派生
// ══════════════════════════════════════════════════

import { defineStore } from 'pinia';
import { computed } from 'vue';
import { useMapStore } from '@/stores/map';
import { useExploreStore } from '@/stores/explore-store';
import { isFalsy } from '@/utils/format';
import { isTileRevealed, type FogProjection } from '@/utils/map-visibility';
import type { TileInfo, Enemy } from '@/types/api';

/** 完整地图图格（独立于 K-6 局部视野投影） */
export interface AtlasTile {
  /** 位置 ID（与 K-6 TileRef.pls 一致；空字符串表示不存在的图格） */
  pls: string;
  /** 网格列（来自 tile.x） */
  x: number;
  /** 网格行（来自 tile.y） */
  y: number;
  /** 四态认知（B5.20-B5.22 + 不存在图格）
   *  - non_existent：区域拓扑中不存在的图格（不渲染或空白，不标 ?）
   *  - fogged：迷雾格，只显示位置和轮廓，隐藏 name/passable/enemy/poi/item，标 ?
   *  - revealed：已揭示但未探索，显示已知地图信息（name/passable）+ discovered=1 敌人，标记"未到达"
   *  - explored：已探索，显示完整已知信息（name/passable/enemy/poi/item）
   */
  state: 'non_existent' | 'fogged' | 'revealed' | 'explored';
  /** 玩家所在格（B5.23） */
  current: boolean;
  /** 地名（迷雾格不暴露） */
  name?: string;
  /** 通行性（迷雾格不暴露；undefined=未知，false=不可通行，true=可通行） */
  passable?: boolean;
  /** discovered=1 的敌人（B5.24，迷雾格不暴露）
   *  state: 0=活着，>0=死亡（B5.24 补全：死敌/活敌区分显示） */
  enemy?: { pid: string | number; name: string; state: number };
  /** 已发现的 POI（B5.25，占位接口，区域级数据源待接入） */
  poi?: { name: string };
  /** 已发现的普通地面道具（B5.25，占位接口，区域级数据源待接入） */
  item?: { name: string };
}

/** 区域网格元数据（links.grids[pgroup]） */
interface RegionGridMeta {
  cols?: number;
  rows?: number;
}

/** 区域元数据（links.regions[pgroup]） */
interface RegionMeta {
  name?: string;
  exit_pls?: string | number;
  entrance_pls?: string | number;
  prev_region?: string | number | null;
}

/** 真实 tile 字段（links.tiles[pgroup][pls] 的扩展字段） */
type RegionTile = TileInfo & {
  x?: number;
  y?: number;
  neighbors?: (string | number)[];
  passable?: unknown;
  tide?: string;
  floor?: string;
  preset_safe?: unknown;
};

export const useAtlasProjectionStore = defineStore('atlas-projection', () => {
  const mapStore = useMapStore();
  const exploreStore = useExploreStore();

  // ── 玩家位置（派生自 K-6 不可变投影，不复制真值） ──
  // mapStore.curLoc 类型为 number | null（对齐 explore-store.playerPls）
  const playerPls = computed<number | null>(() => mapStore.curLoc);
  const playerRegion = computed<number | null>(() => mapStore.curRegion);

  // ── 当前区域 tile 字典（links.tiles[pgroup]） ──
  const regionTiles = computed<Record<string, RegionTile> | null>(() => {
    if (!mapStore.links || mapStore.curRegion === null) return null;
    const tiles = mapStore.links.tiles[String(mapStore.curRegion)] as Record<string, RegionTile> | undefined;
    return tiles || null;
  });

  // ── 坐标索引：{x,y} → { pls, tile }（与 useMapRender.buildCoordIndex 一致） ──
  const coordIndex = computed<Record<string, { pls: string; tile: RegionTile }>>(() => {
    const tiles = regionTiles.value;
    const index: Record<string, { pls: string; tile: RegionTile }> = {};
    if (!tiles) return index;
    for (const pls in tiles) {
      const t = tiles[pls];
      if (t.x !== undefined && t.y !== undefined) {
        index[`${t.x},${t.y}`] = { pls, tile: t };
      }
    }
    return index;
  });

  // ── 区域网格尺寸（links.grids[pgroup]） ──
  const gridW = computed<number>(() => {
    if (!mapStore.links || mapStore.curRegion === null) return 0;
    const grid = (mapStore.links.grids as Record<string, RegionGridMeta>)[String(mapStore.curRegion)];
    return grid?.cols || 0;
  });
  const gridH = computed<number>(() => {
    if (!mapStore.links || mapStore.curRegion === null) return 0;
    const grid = (mapStore.links.grids as Record<string, RegionGridMeta>)[String(mapStore.curRegion)];
    return grid?.rows || 0;
  });

  // ── 区域名（links.regions[pgroup].name） ──
  const regionName = computed<string>(() => {
    if (!mapStore.links || mapStore.curRegion === null) return 'unknown';
    const region = (mapStore.links.regions as Record<string, RegionMeta>)[String(mapStore.curRegion)];
    return region?.name || 'unknown';
  });

  // ── 玩家在网格中的 x/y 坐标（来自当前 tile 的 x/y 字段） ──
  const playerX = computed<number>(() => {
    const pls = playerPls.value;
    if (pls === null) return 0;
    const tile = regionTiles.value?.[String(pls)];
    return tile?.x ?? 0;
  });
  const playerY = computed<number>(() => {
    const pls = playerPls.value;
    if (pls === null) return 0;
    const tile = regionTiles.value?.[String(pls)];
    return tile?.y ?? 0;
  });

  // ── discovered=1 敌人索引（按 pls，仅当前区域） ──
  // B5.24：只显示 discovered=1 的敌人；迷雾格的敌人在 tiles computed 中按 state 过滤
  // B5.24 补全：收集 state 字段（0=活着，>0=死亡），用于视图层区分死活显示
  const enemiesByPls = computed<Record<string, { pid: string | number; name: string; state: number }>>(() => {
    const map: Record<string, { pid: string | number; name: string; state: number }> = {};
    if (mapStore.curRegion === null) return map;
    const curRegionStr = String(mapStore.curRegion);
    for (const e of mapStore.enemies as Enemy[]) {
      if (String(e.discovered) !== '1') continue;
      if (String(e.pgroup) !== curRegionStr) continue;
      // 归一化 state：兼容 string/number，0=活着，>0=死亡
      const stateNum = Number(e.state) || 0;
      map[String(e.pls)] = { pid: e.pid, name: e.name, state: stateNum };
    }
    return map;
  });

  // ── 区域级发现索引（K-Q5-C Q5-9：POI/道具显示） ──
  // 从 links.region_discoveries[curRegion][pls] 派生稀疏 pls → {poi_name, item_name}
  // 后端 obl_state_handle_game_map 一次性查询 discovered=1 的 POI 与 discovered>0 的道具
  // 供 tiles computed 在已揭示/已探索格上填充 poi/item 字段（§7.5 显示已发现的 POI 和道具）
  const discoveriesByPls = computed<Record<string, { poi_name?: string; item_name?: string }>>(() => {
    if (!mapStore.links || mapStore.curRegion === null) return {};
    const regionDiscoveries = (mapStore.links as unknown as {
      region_discoveries?: Record<string, Record<string, { poi_name?: string; item_name?: string }>>;
    }).region_discoveries;
    if (!regionDiscoveries) return {};
    const regionMap = regionDiscoveries[String(mapStore.curRegion)];
    if (!regionMap) return {};
    // 归一化 pls 为字符串键（后端返回的 pls 为数字 key，JS 对象 key 自动转字符串）
    return regionMap;
  });

  // ── 完整区域图格矩阵（AtlasTile[][]，y 行 x 列） ──
  // 从 links.tiles[curRegion] + fog + enemies + exploredTiles 派生
  // 缺失的格子（coordIndex 无对应 tile）渲染为迷雾空格
  const tiles = computed<AtlasTile[][]>(() => {
    const cols = gridW.value;
    const rows = gridH.value;
    if (cols <= 0 || rows <= 0) return [];

    const curPls = playerPls.value;
    const curRegion = playerRegion.value;
    const fogData = mapStore.links?.fog as FogProjection;
    const idx = coordIndex.value;
    const enemies = enemiesByPls.value;
    const discoveries = discoveriesByPls.value;
    const grid: AtlasTile[][] = [];

    for (let r = 0; r < rows; r++) {
      const row: AtlasTile[] = [];
      for (let c = 0; c < cols; c++) {
        const entry = idx[`${c},${r}`];
        // 缺失 tile 的空格子 → 不存在图格（非迷雾，不标 ?）
        // 设计案：标 ? 的是被迷雾笼罩的图格，而不是不存在的图格
        if (!entry) {
          row.push({
            pls: '',
            x: c,
            y: r,
            state: 'non_existent',
            current: false,
          });
          continue;
        }

        const { pls, tile } = entry;
        const isCurrent = curPls !== null && String(pls) === String(curPls);
        // 三态判定（B5.20-B5.22）
        // 玩家所在格始终视为已探索（B5.23）
        const isExplored = isCurrent || exploreStore.isExplored(pls);
        const isRevealed = isTileRevealed(fogData, curRegion ?? 0, pls, isCurrent);
        const state: AtlasTile['state'] = isExplored ? 'explored' : isRevealed ? 'revealed' : 'fogged';

        const atlasTile: AtlasTile = {
          pls,
          x: c,
          y: r,
          state,
          current: isCurrent,
        };

        // 迷雾格隐藏一切内容（B5.20）
        if (state !== 'fogged') {
          if (tile.name) atlasTile.name = tile.name;
          // passable 归一化：undefined=未知（不暴露），假值=false，真值=true
          if (tile.passable !== undefined) {
            atlasTile.passable = !isFalsy(tile.passable);
          }
          // discovered=1 的敌人在非迷雾格显示（B5.24）
          const enemy = enemies[pls];
          if (enemy) atlasTile.enemy = enemy;
          // K-Q5-C Q5-9：POI/Item 区域级数据源填充（§7.5 显示已发现的 POI 和普通地面道具）
          // 后端 obl_state_handle_game_map 一次性查询 discovered=1 的 POI 与 discovered>0 的道具，
          // 通过 links.region_discoveries[curRegion][pls] 下发稀疏 pls → {poi_name, item_name}
          // 已揭示/已探索格均显示（迷雾格已在 state !== 'fogged' 之外过滤）
          const discovery = discoveries[pls];
          if (discovery) {
            if (discovery.poi_name) atlasTile.poi = { name: discovery.poi_name };
            if (discovery.item_name) atlasTile.item = { name: discovery.item_name };
          }
        }

        row.push(atlasTile);
      }
      grid.push(row);
    }
    return grid;
  });

  return {
    // 派生自 K-6
    playerPls,
    playerRegion,
    playerX,
    playerY,
    regionName,
    // 区域网格
    gridW,
    gridH,
    tiles,
    // 索引
    enemiesByPls,
    discoveriesByPls,
  };
});
