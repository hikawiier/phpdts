/**
 * @module O 内容工具箱
 *
 * 世界资源装配器——把 MapProject 转换为 ResourceNode[] + RelationshipEdge[]。
 *
 * 装配策略：
 * - 每个 region 一个 world.region 节点（id = String(pgroup)）
 * - 每个 tile 一个 world.tile 节点（id = `${pgroup}:${pls}`）
 * - contains 边：world.region:${pgroup} → world.tile:${pgroup}:${pls}
 * - adjacent_to 边：world.tile 之间按 neighbors 数组连接（对称，只存 from < to）
 *
 * 边界：
 * - _breaks 字段不参与 adjacent_to 边构建——_breaks 是编辑器专用状态，记录"被显式断开的连通"
 * - 区域间 exit_links 不创建 adjacent_to 边——跨区域连接是显式声明的，不是拓扑邻接
 * - neighbors 引用的是同区域内的 pls（局部索引），跨区域邻接由 exit_links 表达
 */

import type { ResourceNode } from '../types';
import type { RelationshipEdge, NodeId, SourceAnchor } from '../edge';
import { buildEdgeId } from '../edge';
import type { RelationshipType } from '../relationship-types';
import type {
  MapProject,
  Region,
  Tile,
  Grid,
  Pgroup,
  Pls,
} from '../../shared/types/map';

/** world.region 节点 data 形状——Region 附加 pgroup */
export interface WorldRegionData extends Region {
  pgroup: Pgroup;
}

/** world.tile 节点 data 形状——Tile 附加 pgroup 与 pls */
export interface WorldTileData extends Tile {
  pgroup: Pgroup;
  pls: Pls;
}

/**
 * 把 MapProject 转换为 ResourceNode[] + RelationshipEdge[]。
 *
 * 输出节点的 revision 字段留空（''），由 graph-store 在 upsert 时计算填充。
 * 边的 sourceAnchor 字段省略——装配阶段无行级精度，行号由 O-4 adapter 在解析时补充。
 */
export function assembleWorldResources(mapProject: MapProject): {
  nodes: ResourceNode[];
  edges: RelationshipEdge[];
} {
  const nodes: ResourceNode[] = [];
  const edges: RelationshipEdge[] = [];

  // —— 装配 world.region 节点 + 该区域内的 world.tile 节点 + contains/adjacent_to 边 ——
  for (const pgroupKey of Object.keys(mapProject.regions)) {
    const pgroup = Number(pgroupKey) as Pgroup;
    const region = mapProject.regions[pgroup];
    if (!region) continue;

    const regionId = String(pgroup);
    const regionNodeId: NodeId = `world.region:${regionId}`;
    const regionSource: SourceAnchor = {
      filePath: 'oblivions/gamedata/map.php',
      lineStart: 1,
      lineEnd: 1,
      format: 'php',
    };
    const regionData: WorldRegionData = { ...region, pgroup };
    nodes.push({
      kind: 'world.region',
      id: regionId,
      data: regionData,
      source: [regionSource],
      revision: '',
    });

    // —— 装配该 region 的 world.tile 节点 + contains 边 + adjacent_to 边 ——
    const tilesInRegion = mapProject.tiles[pgroup];
    if (!tilesInRegion) continue;

    const tileSource: SourceAnchor = {
      filePath: `oblivions/gamedata/tiles/region_${pgroup}.php`,
      lineStart: 1,
      lineEnd: 1,
      format: 'php',
    };

    // 先收集本区域所有 pls，便于邻居存在性校验
    const regionPlsSet = new Set<Pls>();
    for (const plsKey of Object.keys(tilesInRegion)) {
      regionPlsSet.add(Number(plsKey) as Pls);
    }

    for (const plsKey of Object.keys(tilesInRegion)) {
      const pls = Number(plsKey) as Pls;
      const tile = tilesInRegion[pls];
      if (!tile) continue;

      const tileId = `${pgroup}:${pls}`;
      const tileNodeId: NodeId = `world.tile:${tileId}`;
      const tileData: WorldTileData = { ...tile, pgroup, pls };
      nodes.push({
        kind: 'world.tile',
        id: tileId,
        data: tileData,
        source: [tileSource],
        revision: '',
      });

      // contains 边：region → tile
      edges.push(makeEdge('contains', regionNodeId, tileNodeId));

      // adjacent_to 边：对 neighbors 中每个 pls 建边，对称去重（from < to）
      // _breaks 不参与邻接构建——它是编辑器专用断开状态，由 useToolActions.breakTileConnection 维护
      // 跨区域邻居由 exit_links 表达，不在此处；neighbors 引用同区域 pls
      for (const neighborPls of tile.neighbors) {
        if (!regionPlsSet.has(neighborPls)) continue;
        const neighborTileId = `${pgroup}:${neighborPls}`;
        const neighborNodeId: NodeId = `world.tile:${neighborTileId}`;
        if (tileNodeId === neighborNodeId) continue; // 自环保护
        // 对称去重：仅 from < to（按 nodeId 字符串比较）
        if (tileNodeId < neighborNodeId) {
          edges.push(makeEdge('adjacent_to', tileNodeId, neighborNodeId));
        }
      }
    }
  }

  return { nodes, edges };
}

/**
 * 从 graph-store 重建 MapProject 形状（供 projectStore 派生）。
 *
 * - regions：从 world.region 节点重建（剥离 pgroup 字段）
 * - grids：从 world.region 节点的 cols/rows 派生
 * - tiles：从 world.tile 节点按 pgroup 分组重建，组内按 pls 排序保证确定性
 *
 * 调用方需自行过滤传入的节点（仅传 world.region / world.tile kind），本函数不做 kind 校验。
 */
export function projectFromGraph(
  regionNodes: ResourceNode[],
  tileNodes: ResourceNode[],
): MapProject {
  const regions: Record<Pgroup, Region> = {};
  const grids: Record<Pgroup, Grid> = {};
  const tiles: Record<Pgroup, Record<Pls, Tile>> = {};

  // —— 重建 regions + grids ——
  // 节点可能有两种形态：
  //   1. 编辑器写入：data 含 pgroup 字段，node.id 是 pgroup 数字字符串
  //   2. loader 加载（map-keyed）：node.id 是 "regions"/"grids"，data 是 { [pgroup]: {...} } 字典
  for (const node of regionNodes) {
    const data = node.data as WorldRegionData;
    const directPgroup = data.pgroup ?? Number(node.id);
    if (Number.isInteger(directPgroup) && directPgroup >= 1) {
      // 形态 1：标准 region 节点
      const region: Region = {
        name: data.name,
        desc: data.desc,
        entrance_pls: data.entrance_pls,
        exit_pls: data.exit_pls,
        next_region: data.next_region,
        prev_region: data.prev_region,
        exit_links: data.exit_links,
        cols: data.cols,
        rows: data.rows,
      };
      regions[directPgroup as Pgroup] = region;
      grids[directPgroup as Pgroup] = { cols: region.cols, rows: region.rows };
    } else if (data && typeof data === 'object' && !Array.isArray(data)) {
      // 形态 2：loader 加载的 map-keyed 字典节点（id="regions" 或 id="grids"）
      for (const [key, val] of Object.entries(data)) {
        const p = Number(key);
        if (!Number.isInteger(p) || p < 1) continue;
        const entry = val as Record<string, unknown>;
        if (!entry || typeof entry !== 'object') continue;
        if (node.id === 'grids') {
          if (!grids[p as Pgroup]) {
            grids[p as Pgroup] = {
              cols: (entry.cols as number) ?? 0,
              rows: (entry.rows as number) ?? 0,
            };
          }
        } else {
          if (!regions[p as Pgroup]) {
            regions[p as Pgroup] = {
              name: (entry.name as string) ?? '',
              desc: (entry.desc as string) ?? '',
              entrance_pls: (entry.entrance_pls as Pls | null) ?? null,
              exit_pls: (entry.exit_pls as Pls | null) ?? null,
              next_region: (entry.next_region as Pgroup | null) ?? null,
              prev_region: (entry.prev_region as Pgroup | null) ?? null,
              exit_links: (entry.exit_links as Region['exit_links']) ?? [],
              cols: (entry.cols as number) ?? 0,
              rows: (entry.rows as number) ?? 0,
            };
          }
          if (!grids[p as Pgroup]) {
            grids[p as Pgroup] = {
              cols: (entry.cols as number) ?? 0,
              rows: (entry.rows as number) ?? 0,
            };
          }
        }
      }
    }
  }

  // —— 重建 tiles（按 pgroup 分组，组内按 pls 排序）——
  // node.id 格式可能是 "pgroup:pls"（编辑器写入）或 "pgroup-pls"（loader 加载）
  const tilesByPgroup = new Map<Pgroup, Array<{ pls: Pls; tile: Tile }>>();
  for (const node of tileNodes) {
    const data = node.data as WorldTileData;
    const idParts = node.id.split(/[-:]/);
    const pgroup = data.pgroup ?? Number(idParts[0]);
    const pls = data.pls ?? Number(idParts[1]);
    if (!Number.isInteger(pgroup) || !Number.isInteger(pls)) continue;
    const { pgroup: _p, pls: _l, ...tileRest } = data;
    void _p; void _l;
    const p = pgroup as Pgroup;
    if (!tilesByPgroup.has(p)) {
      tilesByPgroup.set(p, []);
    }
    tilesByPgroup.get(p)!.push({ pls: pls as Pls, tile: tileRest as Tile });
  }

  for (const [pgroup, list] of tilesByPgroup) {
    // 按 pls 排序，保证重建结果确定性
    list.sort((a, b) => a.pls - b.pls);
    const tilesInRegion: Record<Pls, Tile> = {};
    for (const { pls, tile } of list) {
      tilesInRegion[pls] = tile;
    }
    tiles[pgroup] = tilesInRegion;
  }

  return { regions, grids, tiles };
}

/**
 * 构造一条 RelationshipEdge（无 sourceAnchor / metadata，由调用方按需补充）。
 */
function makeEdge(type: RelationshipType, from: NodeId, to: NodeId): RelationshipEdge {
  return {
    id: buildEdgeId(type, from, to),
    type,
    from,
    to,
  };
}
