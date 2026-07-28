<!-- @module O 内容工具箱 -->
<script setup lang="ts">
//
// DensityMatrixPanel：矩阵视图（执行案 §4.5.3 / §4.5.4 / DESIGN.md 2.15 灰阶）
//
// 设计意图：
//   - 以矩阵展示 资源 × tide × region (× phase) 密度
//     · 回答"每个资源在每个区域每个潮汐下生成多少个 / 概率多大"
//   - 三种资源类别（由 props.category 切换）：
//     · poi：行=poi.template，列=tide × region，单元格=per_region count
//     · scatter：行=item.template（scatter_pool 去重子集），列=tide × phase × region，
//       单元格=rate（per_tile_probability 模式）
//     · enemy：行=enemy.template，列=tide × region，单元格=count 或 [min,max]
//   - 单元格着色：灰阶，对齐 DESIGN.md 2.15
//   - 容量冲突标记：
//     · poi：每 tide × region 总 per_region 数 > 该 tide × region 可用 tile 数 → 列尾标红
//     · enemy：每 tide × region 总 count > 该 tide × region 可用 tile 数 → 列尾标红
//     · scatter：每 tide × region 的 total rate × tile_count 期望值 >
//       wild_item_capacity_per_tile × tile_count → 列尾标红
//
// 三视图同步：选中某行/列时 emit('select', ruleId) 给父 DistributionView——
//   由父同步规则表 / 叠层视图的高亮状态。选中规则在矩阵中边框高亮。
//
// 边界：
//   - 当前数据每条规则只有一个 tide + 全 region 统一 count；同一资源的同一 tide 列
//     在所有 region 子列中显示相同值
//   - selector.regions 当前运行时契约不支持 per-region 过滤，留空=所有区域
//   - 容量计算复用 distribution-validator.ts 的候选格逻辑（passable + excludeEntrance/Exit）
//

import { computed } from 'vue';
import { useGraphStore } from '@/graph/graph-store';
import { useDistributionWorkspace } from '@/composables/useDistributionWorkspace';
import {
  DISTRIBUTION_TIDE_ORDER,
  DISTRIBUTION_SCATTER_PHASE_ORDER,
  tideLabel,
  phaseLabel,
  parseRuleId,
  parseScatterRuleId,
  parseEnemyRuleId,
  type DistributionCategory,
  type DistributionPoiData,
  type DistributionScatterData,
  type DistributionEnemyData,
} from '@/schema/distribution-rule';
import type { WorldTileData, WorldRegionData } from '@/graph/assemblers/world-assembler';

const props = defineProps<{
  /** 资源类别——决定行/列维度与单元格语义 */
  category: DistributionCategory;
  /** 当前选中的规则 ID（用于三视图同步高亮） */
  selectedRuleId: string | null;
}>();

const emit = defineEmits<{
  /** 选中某条规则——父组件同步规则表 / 叠层视图 */
  select: [ruleId: string | null];
}>();

const graph = useGraphStore();
const workspace = useDistributionWorkspace();

// ─── Region 列表（按 pgroup 排序） ────────────────────────
const regionList = computed<Array<{ pgroup: number; name: string }>>(() => {
  const regionNodes = graph.findNodesByKind('world.region');
  const list: Array<{ pgroup: number; name: string }> = [];
  for (const node of regionNodes) {
    const data = node.data as WorldRegionData;
    if (typeof data.pgroup !== 'number') continue;
    const name = typeof data.name === 'string' && data.name.length > 0 ? data.name : `R${data.pgroup}`;
    list.push({ pgroup: data.pgroup, name });
  }
  list.sort((a, b) => a.pgroup - b.pgroup);
  return list;
});

// ─── 容量索引（按 tide × pgroup 统计可用 tile 数）──────────
/**
 * 复用 distribution-validator.ts 的候选格计算逻辑：
 *   passable=true ∧ tide 匹配 ∧ (excludeEntrance ⇒ pls ≠ entrance_pls) ∧
 *   (excludeExit ⇒ pls ≠ exit_pls)
 *
 * excludeEntrance / excludeExit 取所有规则的默认值（true）——容量基线按默认排除。
 * 单条规则覆盖时由叠层与校验器展示 per-rule 警告，矩阵列尾使用统一基线。
 */
const capacityByTideAndRegion = computed<Map<string, number>>(() => {
  const map = new Map<string, number>();
  const tileNodes = graph.findNodesByKind('world.tile');
  const regionNodes = graph.findNodesByKind('world.region');

  // 按 (tide, pgroup) 收集 passable pls 集合
  const tilesByTideRegion = new Map<string, Map<number, Set<number>>>();
  for (const node of tileNodes) {
    const data = node.data as WorldTileData;
    if (typeof data.pgroup !== 'number') continue;
    if (typeof data.tide !== 'string') continue;
    if (typeof data.pls !== 'number') continue;
    if (data.passable !== true) continue;
    const key = data.tide;
    let regionMap = tilesByTideRegion.get(key);
    if (!regionMap) {
      regionMap = new Map();
      tilesByTideRegion.set(key, regionMap);
    }
    let plsSet = regionMap.get(data.pgroup);
    if (!plsSet) {
      plsSet = new Set();
      regionMap.set(data.pgroup, plsSet);
    }
    plsSet.add(data.pls);
  }

  // 区域 entrance/exit
  const regionEntranceExit = new Map<number, { entrancePls: number | null; exitPls: number | null }>();
  for (const node of regionNodes) {
    const data = node.data as WorldRegionData;
    if (typeof data.pgroup !== 'number') continue;
    regionEntranceExit.set(data.pgroup, {
      entrancePls: data.entrance_pls ?? null,
      exitPls: data.exit_pls ?? null,
    });
  }

  for (const [tide, regionMap] of tilesByTideRegion) {
    for (const [pgroup, plsSet] of regionMap) {
      const regionInfo = regionEntranceExit.get(pgroup);
      let available = plsSet.size;
      if (regionInfo) {
        if (regionInfo.entrancePls !== null && plsSet.has(regionInfo.entrancePls)) available -= 1;
        if (regionInfo.exitPls !== null && plsSet.has(regionInfo.exitPls)) available -= 1;
      }
      map.set(`${tide}:${pgroup}`, Math.max(0, available));
    }
  }
  return map;
});

// ─── 通用行/列/单元格抽象 ─────────────────────────────────

interface MatrixRow {
  /** 资源 ID（poiId / itemId / enemyType） */
  resourceId: string;
  /** 显示名（中文名 fallback） */
  label: string;
  /** 列 key → 规则 ID（每资源每列至多一条规则） */
  ruleByColumn: Map<string, string>;
  /** 列 key → 单元格显示文本 */
  valueByColumn: Map<string, string>;
  /** 列 key → 数值（用于灰阶着色，rate 或 count） */
  numericByColumn: Map<string, number>;
}

interface MatrixColumn {
  key: string;
  tide: string;
  phase?: string;
  pgroup: number;
  regionLabel: string;
}

// ─── 矩阵列定义 ─────────────────────────────────────────
const columns = computed<MatrixColumn[]>(() => {
  const cols: MatrixColumn[] = [];
  if (props.category === 'scatter') {
    // tide × phase × region
    for (const tide of DISTRIBUTION_TIDE_ORDER) {
      for (const phase of DISTRIBUTION_SCATTER_PHASE_ORDER) {
        for (const region of regionList.value) {
          cols.push({
            key: `${tide}:${phase}:R${region.pgroup}`,
            tide,
            phase,
            pgroup: region.pgroup,
            regionLabel: region.name,
          });
        }
      }
    }
  } else {
    // tide × region (poi / enemy)
    for (const tide of DISTRIBUTION_TIDE_ORDER) {
      for (const region of regionList.value) {
        cols.push({
          key: `${tide}:R${region.pgroup}`,
          tide,
          pgroup: region.pgroup,
          regionLabel: region.name,
        });
      }
    }
  }
  return cols;
});

// ─── 矩阵行（按类别派生） ─────────────────────────────────

const rows = computed<MatrixRow[]>(() => {
  if (props.category === 'poi') return poiRows.value;
  if (props.category === 'scatter') return scatterRows.value;
  return enemyRows.value;
});

// ─── POI 行 ──────────────────────────────────────────────
const poiRows = computed<MatrixRow[]>(() => {
  const poiNodes = graph.findNodesByKind('poi.template');
  const distNodes = graph.findNodesByKind('distribution.poi');

  // 按 poi_id + tide 索引规则
  const ruleByPoiAndTide = new Map<string, Map<string, { ruleId: string; count: number }>>();
  for (const node of distNodes) {
    const data = node.data as DistributionPoiData | null;
    if (!data || typeof data !== 'object') continue;
    const poiId = data['subject.poi_id'];
    const tides = data['selector.tides'];
    const count = data['placement.count'];
    if (typeof poiId !== 'string' || !Array.isArray(tides) || tides.length === 0) continue;
    if (typeof count !== 'number') continue;
    const tide = tides[0];
    if (typeof tide !== 'string') continue;

    let tideMap = ruleByPoiAndTide.get(poiId);
    if (!tideMap) {
      tideMap = new Map();
      ruleByPoiAndTide.set(poiId, tideMap);
    }
    tideMap.set(tide, { ruleId: node.id, count });
  }

  const result: MatrixRow[] = [];
  for (const node of poiNodes) {
    const poiId = node.id;
    const data = node.data as { name?: string } | null;
    const name = data?.name;
    const label = typeof name === 'string' && name.length > 0 ? name : poiId;

    const ruleByColumn = new Map<string, string>();
    const valueByColumn = new Map<string, string>();
    const numericByColumn = new Map<string, number>();
    const tideMap = ruleByPoiAndTide.get(poiId);
    if (tideMap) {
      for (const [tide, info] of tideMap) {
        for (const region of regionList.value) {
          const colKey = `${tide}:R${region.pgroup}`;
          ruleByColumn.set(colKey, info.ruleId);
          valueByColumn.set(colKey, String(info.count));
          numericByColumn.set(colKey, info.count);
        }
      }
    }
    result.push({ resourceId: poiId, label, ruleByColumn, valueByColumn, numericByColumn });
  }

  result.sort((a, b) => (a.resourceId < b.resourceId ? -1 : a.resourceId > b.resourceId ? 1 : 0));
  return result;
});

// ─── Scatter 行 ──────────────────────────────────────────
const scatterRows = computed<MatrixRow[]>(() => {
  const itemNodes = graph.findNodesByKind('item.template');
  const distNodes = graph.findNodesByKind('distribution.scatter');

  // 按 item_id 索引资源名
  const itemNameById = new Map<string, string>();
  for (const node of itemNodes) {
    const data = node.data as { name?: string } | null;
    const name = data?.name;
    itemNameById.set(node.id, typeof name === 'string' && name.length > 0 ? name : node.id);
  }

  // 按 (item_id, tide, phase) 索引规则
  const ruleByKey = new Map<string, { ruleId: string; rate: number; count: number | [number, number] }>();
  const itemIdsInScatter = new Set<string>();
  for (const node of distNodes) {
    const data = node.data as DistributionScatterData | null;
    if (!data || typeof data !== 'object') continue;
    const itemId = data['subject.item_id'];
    const tides = data['selector.tides'];
    const phase = data['phase'];
    const rate = data['placement.rate'];
    const count = data['placement.count'];
    if (typeof itemId !== 'string' || !Array.isArray(tides) || tides.length === 0) continue;
    if (typeof phase !== 'string' || phase !== 'game_init' && phase !== 'day_refresh') continue;
    if (typeof rate !== 'number') continue;
    const tide = tides[0];
    if (typeof tide !== 'string') continue;

    itemIdsInScatter.add(itemId);
    ruleByKey.set(`${itemId}:${tide}:${phase}`, { ruleId: node.id, rate, count: count ?? 1 });
  }

  const result: MatrixRow[] = [];
  for (const itemId of itemIdsInScatter) {
    const label = itemNameById.get(itemId) ?? itemId;
    const ruleByColumn = new Map<string, string>();
    const valueByColumn = new Map<string, string>();
    const numericByColumn = new Map<string, number>();
    for (const tide of DISTRIBUTION_TIDE_ORDER) {
      for (const phase of DISTRIBUTION_SCATTER_PHASE_ORDER) {
        const key = `${itemId}:${tide}:${phase}`;
        const info = ruleByKey.get(key);
        if (!info) continue;
        for (const region of regionList.value) {
          const colKey = `${tide}:${phase}:R${region.pgroup}`;
          ruleByColumn.set(colKey, info.ruleId);
          valueByColumn.set(colKey, info.rate.toFixed(2));
          numericByColumn.set(colKey, info.rate);
        }
      }
    }
    result.push({ resourceId: itemId, label, ruleByColumn, valueByColumn, numericByColumn });
  }

  result.sort((a, b) => (a.resourceId < b.resourceId ? -1 : a.resourceId > b.resourceId ? 1 : 0));
  return result;
});

// ─── Enemy 行 ────────────────────────────────────────────
const enemyRows = computed<MatrixRow[]>(() => {
  const enemyNodes = graph.findNodesByKind('enemy.template');
  const distNodes = graph.findNodesByKind('distribution.enemy');

  // 按 enemy_type 索引资源名
  const enemyNameById = new Map<string, string>();
  for (const node of enemyNodes) {
    const data = node.data as { name?: string } | null;
    const name = data?.name;
    enemyNameById.set(node.id, typeof name === 'string' && name.length > 0 ? name : node.id);
  }

  // 按 (enemy_type, tide) 索引规则
  const ruleByEnemyAndTide = new Map<string, Map<string, { ruleId: string; count: number | [number, number] }>>();
  for (const node of distNodes) {
    const data = node.data as DistributionEnemyData | null;
    if (!data || typeof data !== 'object') continue;
    const enemyType = data['subject.enemy_type'];
    const tides = data['selector.tides'];
    const count = data['placement.count'];
    if (typeof enemyType !== 'string' || !Array.isArray(tides) || tides.length === 0) continue;
    const tide = tides[0];
    if (typeof tide !== 'string') continue;

    let tideMap = ruleByEnemyAndTide.get(enemyType);
    if (!tideMap) {
      tideMap = new Map();
      ruleByEnemyAndTide.set(enemyType, tideMap);
    }
    tideMap.set(tide, { ruleId: node.id, count: count ?? 1 });
  }

  const result: MatrixRow[] = [];
  for (const node of enemyNodes) {
    const enemyType = node.id;
    const label = enemyNameById.get(enemyType) ?? enemyType;
    const ruleByColumn = new Map<string, string>();
    const valueByColumn = new Map<string, string>();
    const numericByColumn = new Map<string, number>();
    const tideMap = ruleByEnemyAndTide.get(enemyType);
    if (tideMap) {
      for (const [tide, info] of tideMap) {
        for (const region of regionList.value) {
          const colKey = `${tide}:R${region.pgroup}`;
          ruleByColumn.set(colKey, info.ruleId);
          const c = info.count;
          if (Array.isArray(c)) {
            valueByColumn.set(colKey, `${c[0]}~${c[1]}`);
            numericByColumn.set(colKey, c[1]);
          } else {
            valueByColumn.set(colKey, String(c));
            numericByColumn.set(colKey, c);
          }
        }
      }
    }
    result.push({ resourceId: enemyType, label, ruleByColumn, valueByColumn, numericByColumn });
  }

  result.sort((a, b) => {
    const an = Number(a.resourceId);
    const bn = Number(b.resourceId);
    if (!Number.isNaN(an) && !Number.isNaN(bn)) return an - bn;
    return a.resourceId < b.resourceId ? -1 : a.resourceId > b.resourceId ? 1 : 0;
  });
  return result;
});

// ─── 列尾统计（总分布 + 容量冲突标记） ──────────────────
interface ColumnSummary {
  /** 总数 / 总率（poi: total count；enemy: total count；scatter: total rate） */
  total: number;
  /** 该 tide × region 可用 tile 数 */
  capacity: number;
  /** 是否超容量 */
  conflict: boolean;
  /** 显示文本 */
  totalLabel: string;
}

const columnSummaries = computed<Map<string, ColumnSummary>>(() => {
  const map = new Map<string, ColumnSummary>();
  for (const col of columns.value) {
    let total = 0;
    let totalLabel = '0';
    for (const row of rows.value) {
      const num = row.numericByColumn.get(col.key);
      if (typeof num === 'number') total += num;
    }
    const capacity = capacityByTideAndRegion.value.get(`${col.tide}:${col.pgroup}`) ?? 0;
    let conflict = false;
    if (props.category === 'scatter') {
      // scatter 容量冲突：total rate × tile_count > wild_item_capacity_per_tile × tile_count
      // 简化为：total rate > wild_item_capacity_per_tile (默认 5)
      // 实际 per_tile 模式每 tile 独立判定，total rate 是"该格被任一 scatter 选中的概率上界"
      // P4 阶段简化为 total rate > 1.0 时 warning（理论概率超过 100%）
      conflict = capacity > 0 && total > 1.0;
      totalLabel = total.toFixed(2);
    } else {
      // poi / enemy：总数 > 容量
      conflict = capacity > 0 && total > capacity;
      totalLabel = String(total);
    }
    map.set(col.key, { total, capacity, conflict, totalLabel });
  }
  return map;
});

// ─── 单元格灰阶样式 ────────────────────────────────────────
function cellClass(value: string | undefined, numeric: number | undefined, isSelected: boolean): string {
  const base = 'matrix-cell ';
  if (value === undefined || numeric === undefined) return base + 'matrix-cell-empty';
  let shade: string;
  if (props.category === 'scatter') {
    // rate 灰阶：0=深 / 0.1-0.3=浅灰 / 0.3-0.6=中灰 / >0.6=深灰
    if (numeric <= 0) shade = 'matrix-shade-0';
    else if (numeric <= 0.3) shade = 'matrix-shade-1';
    else if (numeric <= 0.6) shade = 'matrix-shade-2';
    else shade = 'matrix-shade-3';
  } else {
    // count 灰阶
    if (numeric === 0) shade = 'matrix-shade-0';
    else if (numeric === 1) shade = 'matrix-shade-1';
    else if (numeric <= 3) shade = 'matrix-shade-2';
    else shade = 'matrix-shade-3';
  }
  return base + shade + (isSelected ? ' matrix-cell-selected' : '');
}

function rowCount(row: MatrixRow): number {
  let total = 0;
  for (const num of row.numericByColumn.values()) total += num;
  return total;
}

function rowCountLabel(row: MatrixRow): string {
  const total = rowCount(row);
  if (props.category === 'scatter') return total.toFixed(2);
  return String(total);
}

// ─── 选中规则 → 矩阵单元格定位 ────────────────────────────
function isCellSelected(resourceId: string, tide: string, phase?: string): boolean {
  if (props.selectedRuleId === null) return false;
  if (props.category === 'poi') {
    const parsed = parseRuleId(props.selectedRuleId);
    if (!parsed) return false;
    return parsed.poiId === resourceId && parsed.tide === tide;
  }
  if (props.category === 'scatter') {
    const parsed = parseScatterRuleId(props.selectedRuleId);
    if (!parsed) return false;
    return parsed.itemId === resourceId && parsed.tide === tide && parsed.phase === phase;
  }
  // enemy
  const parsed = parseEnemyRuleId(props.selectedRuleId);
  if (!parsed) return false;
  return parsed.enemyType === resourceId && parsed.tide === tide;
}

function onCellClick(ruleId: string | undefined): void {
  if (!ruleId) return;
  if (props.selectedRuleId === ruleId) {
    emit('select', null);
    workspace.selectRule(null);
  } else {
    emit('select', ruleId);
    workspace.selectRule(ruleId);
  }
}

// ─── 列分组（按 tide 主序 + phase 次序） ──────────────────
interface TideGroup {
  tide: string;
  /** phase undefined for poi/enemy；string for scatter */
  phase?: string;
  colspan: number;
  label: string;
}

const tideGroups = computed<TideGroup[]>(() => {
  const groups: TideGroup[] = [];
  if (props.category === 'scatter') {
    for (const tide of DISTRIBUTION_TIDE_ORDER) {
      for (const phase of DISTRIBUTION_SCATTER_PHASE_ORDER) {
        groups.push({
          tide,
          phase,
          colspan: regionList.value.length,
          label: `${tideLabel(tide)} · ${phaseLabel(phase)}`,
        });
      }
    }
  } else {
    for (const tide of DISTRIBUTION_TIDE_ORDER) {
      groups.push({
        tide,
        colspan: regionList.value.length,
        label: tideLabel(tide),
      });
    }
  }
  return groups;
});
</script>

<template>
  <div class="flex h-full flex-col overflow-auto p-2 text-sm">
    <div v-if="rows.length === 0" class="flex h-full items-center justify-center text-xs text-gray-600">
      无 {{ category === 'poi' ? 'POI' : category === 'scatter' ? '野生道具' : '敌人' }} 模板数据
    </div>

    <table v-else class="w-full border-collapse text-xs">
      <thead class="sticky top-0 bg-gray-950">
        <tr>
          <th class="border border-gray-800 p-1 text-left text-gray-400">
            {{ category === 'poi' ? 'POI' : category === 'scatter' ? '道具' : '敌人' }}
          </th>
          <th
            v-for="(g, idx) in tideGroups"
            :key="`header-tide-${idx}`"
            :colspan="g.colspan"
            class="border border-gray-800 p-1 text-center text-gray-300"
          >
            {{ g.label }}
          </th>
          <th class="border border-gray-800 p-1 text-gray-400">总计</th>
        </tr>
        <tr>
          <th class="border border-gray-800 bg-gray-900 p-1 text-left text-[10px] text-gray-500">ID / 名称</th>
          <template v-for="(g, gidx) in tideGroups" :key="`subheader-tide-${gidx}`">
            <th
              v-for="region in regionList"
              :key="`subheader-${g.tide}-${g.phase ?? ''}-${region.pgroup}`"
              class="border border-gray-800 bg-gray-900 p-1 text-center text-[10px] text-gray-500"
            >
              {{ region.name }}
            </th>
          </template>
          <th class="border border-gray-800 bg-gray-900 p-1 text-[10px] text-gray-500">∑</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="`row-${row.resourceId}`">
          <td class="border border-gray-800 p-1">
            <div class="text-gray-200">{{ row.label }}</div>
            <div class="text-[10px] text-gray-500">{{ row.resourceId }}</div>
          </td>
          <template v-for="(g, gidx) in tideGroups" :key="`cell-${row.resourceId}-${gidx}`">
            <td
              v-for="region in regionList"
              :key="`cell-${row.resourceId}-${g.tide}-${g.phase ?? ''}-${region.pgroup}`"
              :class="cellClass(
                row.valueByColumn.get(`${g.tide}:${g.phase ?? ''}:${g.phase ? 'R' : ''}${g.phase ? region.pgroup : ''}`) ?? row.valueByColumn.get(`${g.tide}:R${region.pgroup}`),
                row.numericByColumn.get(`${g.tide}:${g.phase ?? ''}:${g.phase ? 'R' : ''}${g.phase ? region.pgroup : ''}`) ?? row.numericByColumn.get(`${g.tide}:R${region.pgroup}`),
                isCellSelected(row.resourceId, g.tide, g.phase),
              )"
              class="cursor-pointer border border-gray-800 p-1 text-center"
              :title="`${row.resourceId} × ${g.label} × ${region.name}`"
              @click="onCellClick(
                row.ruleByColumn.get(`${g.tide}:${g.phase ?? ''}:${g.phase ? 'R' : ''}${g.phase ? region.pgroup : ''}`)
                  ?? row.ruleByColumn.get(`${g.tide}:R${region.pgroup}`)
              )"
            >
              {{
                row.valueByColumn.get(`${g.tide}:${g.phase ?? ''}:${g.phase ? 'R' : ''}${g.phase ? region.pgroup : ''}`)
                  ?? row.valueByColumn.get(`${g.tide}:R${region.pgroup}`)
                  ?? '—'
              }}
            </td>
          </template>
          <td class="border border-gray-800 bg-gray-900 p-1 text-center text-gray-300">
            {{ rowCountLabel(row) }}
          </td>
        </tr>
      </tbody>
      <tfoot>
        <tr>
          <td class="border border-gray-800 bg-gray-900 p-1 text-[10px] text-gray-500">列总计 / 容量</td>
          <template v-for="col in columns" :key="`summary-${col.key}`">
            <td
              class="border border-gray-800 p-1 text-center"
              :class="columnSummaries.get(col.key)?.conflict
                ? 'bg-accent-error/20 text-accent-error'
                : 'bg-gray-900 text-gray-300'"
            >
              {{ columnSummaries.get(col.key)?.totalLabel ?? '0' }}
              <span class="text-[9px] text-gray-500">
                / {{ columnSummaries.get(col.key)?.capacity ?? 0 }}
              </span>
              <span v-if="columnSummaries.get(col.key)?.conflict" class="ml-0.5">⚠</span>
            </td>
          </template>
          <td class="border border-gray-800 bg-gray-900 p-1 text-center text-[10px] text-gray-500">—</td>
        </tr>
      </tfoot>
    </table>

    <div class="mt-2 border-t border-gray-800 pt-2 text-[10px] text-gray-600">
      <template v-if="category === 'poi'">
        单元格 = 该 POI 在对应 tide × region 的 per_region 数量；列尾显示"总计 / 容量"。<br />
        灰阶：0=深 / 1=浅灰 / 2-3=中灰 / ≥4=深灰（对齐 DESIGN.md 2.15）。<br />
        ⚠ 标记列总计超过该 tide × region 可用 tile 数（warning 级别，运行时按 E-9 自动调整）。
      </template>
      <template v-else-if="category === 'scatter'">
        单元格 = 该道具在对应 tide × phase × region 的基础率（rate）；列尾显示"总率 / 容量"。<br />
        灰阶：0=深 / ≤0.3=浅灰 / ≤0.6=中灰 / >0.6=深灰（rate 模式）。<br />
        ⚠ 标记该 tide × region 总率 > 1.0（理论概率上界超过 100%，warning 级别）。
      </template>
      <template v-else>
        单元格 = 该敌人在对应 tide × region 的 per_region count；列尾显示"总计 / 容量"。<br />
        灰阶：0=深 / 1=浅灰 / 2-3=中灰 / ≥4=深灰（对齐 DESIGN.md 2.15）。<br />
        ⚠ 标记列总计超过该 tide × region 可用 tile 数（warning 级别，运行时按 init.func.php 自动调整）。
      </template>
    </div>
  </div>
</template>

<style scoped>
.matrix-cell {
  font-variant-numeric: tabular-nums;
  transition: background-color 0.1s;
}

.matrix-cell-empty {
  background-color: transparent;
  color: #4b5563;
}

.matrix-shade-0 {
  background-color: #1f2937;
  color: #9ca3af;
}

.matrix-shade-1 {
  background-color: #6b7280;
  color: #f3f4f6;
}

.matrix-shade-2 {
  background-color: #4b5563;
  color: #e5e7eb;
}

.matrix-shade-3 {
  background-color: #1f2937;
  color: #d1d5db;
  font-weight: 600;
}

.matrix-cell-selected {
  outline: 2px solid var(--color-accent-error, #ef4444);
  outline-offset: -2px;
}
</style>
