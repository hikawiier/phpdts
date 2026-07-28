// @module O 内容工具箱
//
// 验证规则函数集（P0 迁移到 O-10 structure-validator）
//
// 研判：
//   - 纯函数规则集，是 O-3 框架的核心实现
//   - 读取 MapProject 数据结构（regions / grids / tiles）
//   - 读取 configStore 暴露的 scatterPool / poiTable / poiPool
//   - M8 生成器写入 projectStore 后调用 runFullValidation 形成闭环
//
// 设计意图（对齐 2.8 dry-run 契约 + §3.5）：
//   - 纯函数集：不修改 state，只返回 issues 数组
//   - 两级验证分级：
//     · Light（实时、debounce 300ms）：跳过 BFS 与配置交叉引用，O(格数)
//     · Full（按需）：含连通性 BFS + 可选配置交叉引用，O(格数+边数)
//   - 严重级别对齐 2.15：error / warning 两档，无 info 级
//   - 每个 issue 携带 location 锚点便于点击跳转，hint 提供修复建议
//   - rule ID 即 i18n key 锚点（ValidatePanel 可用 rule ID 查 i18n 文案）
//
// 接口契约（供 M8 生成器闭环 + ValidateView 调用）：
//   - runLightValidation(project) → ValidateIssue[]
//   - runFullValidation(project, options?) → ValidateIssue[]
//   - runValidation(project, mode, options?) → ValidateIssue[]（统一入口）
//   - runStructureValidationFromGraph(graphStore) → ValidateIssue[]（P1-H 新增：
//     第 2 层结构校验直接从 graph-store 读取 world.region / world.tile 节点，
//     重建 MapProject 形状后调用纯函数规则集，避免依赖 projectStore）
//   - summarize(issues) → ValidateSummary
//   - validateTile(pgroup, pls, tile) → ValidateIssue[]（单格实时校验）
//   - validateRegion(pgroup, region) → ValidateIssue[]（单区域实时校验）
//
// M8 生成器调用示例（includeConfig=false 保持生成器纯函数性）：
//   const issues = runFullValidation(project, { includeConfig: false });

import {
  PLS_MAX,
  PLS_MIN,
  PGROUP_MAX,
  PGROUP_MIN,
  TIDE_TYPES,
  FLOOR_TYPES,
  VALIDATE_RULES,
  detectIslands,
} from '@/shared';
import type {
  MapProject,
  Pgroup,
  Pls,
  Region,
  Tile,
  ValidateIssue,
  ValidateMode,
  ValidateOptions,
  ValidateSeverity,
  ValidateSummary,
} from '@/shared';
import type { useGraphStore } from '@/graph/graph-store';
import { projectFromGraph } from '@/graph/assemblers/world-assembler';

/**
 * GraphStore 类型别名——避免在函数签名中写长 ReturnType 表达式。
 *
 * 使用 type-only import 不会引入运行时依赖；validate-rules.ts 仍是纯函数模块，
 * 调用方传入 graphStore 实例即可。
 */
type GraphStore = ReturnType<typeof useGraphStore>;

// ─── 内部工具 ───────────────────────────────────────────────────

/**
 * 将 Record<Pgroup, T> 的 key 数组解析为有序 Pgroup[]
 */
function pgroupKeys(record: Record<Pgroup, unknown>): Pgroup[] {
  return Object.keys(record).map((k) => Number(k) as Pgroup).sort((a, b) => a - b);
}

/**
 * 将 Record<Pls, T> 的 key 数组解析为有序 Pls[]
 */
function plsKeys(record: Record<Pls, unknown>): Pls[] {
  return Object.keys(record).map((k) => Number(k) as Pls).sort((a, b) => a - b);
}

/**
 * 构造 issue 工厂（减少样板代码）
 */
function makeIssue(
  rule: ValidateIssue['rule'],
  severity: ValidateSeverity,
  message: string,
  location: { pgroup?: Pgroup | null; pls?: Pls | null; field?: string },
  hint?: string,
): ValidateIssue {
  return { rule, severity, message, location, hint };
}

// ─── 规则 1：pls / pgroup 范围 + tide / floor 取值 + 占用冲突 ─────
//
// 范围规则覆盖：
//   - pgroup ∈ [1, 255]（后端 tinyint 上限）
//   - pls ∈ [1, 254]（pls=0 保留不使用）
//   - tide ∈ {shallow, deep, abyss}（safe 由 preset_safe 标记，对齐 DESIGN.md 1.3）
//   - floor ∈ {standard, water, vegetation, metal, magic}
//   - 同 (pgroup, x, y) 坐标唯一（占用冲突）

export function validateTilesBasic(project: MapProject): ValidateIssue[] {
  const issues: ValidateIssue[] = [];
  const { regions, tiles } = project;

  // pgroup 范围
  for (const pgroup of pgroupKeys(regions)) {
    if (pgroup < PGROUP_MIN || pgroup > PGROUP_MAX || !Number.isFinite(pgroup)) {
      issues.push(
        makeIssue(
          VALIDATE_RULES.PGROUP_RANGE,
          'error',
          `pgroup=${pgroup} 超出范围 [${PGROUP_MIN}-${PGROUP_MAX}]`,
          { pgroup: null },
          '删除该区域或迁移到合法 pgroup',
        ),
      );
    }
  }

  // pls 范围 + tide/floor + 占用冲突
  for (const pgroup of pgroupKeys(tiles)) {
    const tilesInRegion = tiles[pgroup];
    if (!tilesInRegion) continue;
    // 坐标占用追踪：`${x},${y}` → pls（用于检测同坐标冲突）
    const seenCoords = new Map<string, Pls>();

    for (const pls of plsKeys(tilesInRegion)) {
      const tile = tilesInRegion[pls];
      if (!tile) continue;

      // pls 范围
      if (pls < PLS_MIN || pls > PLS_MAX || !Number.isFinite(pls)) {
        issues.push(
          makeIssue(
            VALIDATE_RULES.PLS_RANGE,
            'error',
            `pgroup=${pgroup} pls=${pls} 超出范围 [${PLS_MIN}-${PLS_MAX}]`,
            { pgroup, pls: null },
            '删除该格或重新分配 pls',
          ),
        );
      }

      // tide 取值（safe 不合法，应使用 preset_safe=true）
      if (!TIDE_TYPES.includes(tile.tide)) {
        issues.push(
          makeIssue(
            VALIDATE_RULES.TIDE_INVALID,
            'error',
            `pgroup=${pgroup} pls=${pls} tide="${tile.tide}" 不在 [${TIDE_TYPES.join(',')}]`,
            { pgroup, pls },
            'tide 必须为 shallow/deep/abyss；安全区用 preset_safe=true',
          ),
        );
      }

      // floor 取值
      if (!FLOOR_TYPES.includes(tile.floor)) {
        issues.push(
          makeIssue(
            VALIDATE_RULES.FLOOR_INVALID,
            'error',
            `pgroup=${pgroup} pls=${pls} floor="${tile.floor}" 不在 [${FLOOR_TYPES.join(',')}]`,
            { pgroup, pls },
            'floor 必须为 standard/water/vegetation/metal/magic',
          ),
        );
      }

      // 占用冲突（同坐标同区域）
      const coordKey = `${tile.x},${tile.y}`;
      const existing = seenCoords.get(coordKey);
      if (existing !== undefined) {
        issues.push(
          makeIssue(
            VALIDATE_RULES.OCCUPY_CONFLICT,
            'error',
            `pgroup=${pgroup} 坐标 (${tile.x},${tile.y}) 被 pls=${existing} 与 pls=${pls} 同时占用`,
            { pgroup, pls },
            '移动其中一格或删除冲突格',
          ),
        );
      } else {
        seenCoords.set(coordKey, pls);
      }
    }
  }

  return issues;
}

// ─── 规则 2：区域引用完整性 ─────────────────────────────────────
//
// 覆盖：
//   - next_region / prev_region 指向存在的 pgroup
//   - next/prev 对称性（A.next=B ⇔ B.prev=A）
//   - entrance_pls / exit_pls 指向存在的 pls
//   - 缺少 entrance_pls / exit_pls → warning

export function validateRegionReferences(project: MapProject): ValidateIssue[] {
  const issues: ValidateIssue[] = [];
  const { regions, tiles } = project;

  for (const pgroup of pgroupKeys(regions)) {
    const region = regions[pgroup];
    if (!region) continue;
    const tilesInRegion = tiles[pgroup] ?? {};

    // next_region 引用
    if (region.next_region !== null && !regions[region.next_region]) {
      issues.push(
        makeIssue(
          VALIDATE_RULES.REGION_NEXT_DANGLING,
          'error',
          `区域 ${pgroup}.next_region=${region.next_region} 不存在`,
          { pgroup },
          '在区域属性面板中重设 next_region',
        ),
      );
    }
    // prev_region 引用
    if (region.prev_region !== null && !regions[region.prev_region]) {
      issues.push(
        makeIssue(
          VALIDATE_RULES.REGION_PREV_DANGLING,
          'error',
          `区域 ${pgroup}.prev_region=${region.prev_region} 不存在`,
          { pgroup },
          '在区域属性面板中重设 prev_region',
        ),
      );
    }
    // next/prev 对称性
    if (region.next_region !== null && regions[region.next_region]) {
      const target = regions[region.next_region];
      if (target && target.prev_region !== pgroup) {
        issues.push(
          makeIssue(
            VALIDATE_RULES.REGION_NEXT_PREV_ASYMMETRIC,
            'error',
            `区域 ${pgroup}.next_region=${region.next_region} 但 ${region.next_region}.prev_region=${target.prev_region}（应双向对称）`,
            { pgroup },
            '在区域属性面板中重设 next_region 会自动同步 prev_region',
          ),
        );
      }
    }

    // entrance_pls 引用
    if (region.entrance_pls !== null) {
      if (!tilesInRegion[region.entrance_pls]) {
        issues.push(
          makeIssue(
            VALIDATE_RULES.REGION_ENTRANCE_DANGLING,
            'error',
            `区域 ${pgroup}.entrance_pls=${region.entrance_pls} 不存在`,
            { pgroup },
            '在区域属性面板中重设入口格',
          ),
        );
      }
    } else {
      // 缺少 entrance → warning（BFS 会跳过此区域，提前提示）
      issues.push(
        makeIssue(
          VALIDATE_RULES.REGION_NO_ENTRANCE,
          'warning',
          `区域 ${pgroup} 未设置 entrance_pls`,
          { pgroup },
          '在区域属性面板中指定入口地图格',
        ),
      );
    }

    // exit_pls 引用
    if (region.exit_pls !== null) {
      if (!tilesInRegion[region.exit_pls]) {
        issues.push(
          makeIssue(
            VALIDATE_RULES.REGION_EXIT_DANGLING,
            'error',
            `区域 ${pgroup}.exit_pls=${region.exit_pls} 不存在`,
            { pgroup },
            '在区域属性面板中重设出口格',
          ),
        );
      }
    } else {
      issues.push(
        makeIssue(
          VALIDATE_RULES.REGION_NO_EXIT,
          'warning',
          `区域 ${pgroup} 未设置 exit_pls`,
          { pgroup },
          '在区域属性面板中指定出口地图格',
        ),
      );
    }
  }

  return issues;
}

// ─── 规则 3：neighbors 悬空 + 对称性 ─────────────────────────────
//
// 覆盖：
//   - A.neighbors 中的 pls 必须存在（悬空检查）
//   - A→B 与 B→A 对称（不对称检查，按排序键去重只报一次）

export function validateNeighbors(project: MapProject): ValidateIssue[] {
  const rawIssues: ValidateIssue[] = [];
  const { tiles } = project;

  for (const pgroup of pgroupKeys(tiles)) {
    const tilesInRegion = tiles[pgroup];
    if (!tilesInRegion) continue;

    for (const pls of plsKeys(tilesInRegion)) {
      const tile = tilesInRegion[pls];
      if (!tile || !Array.isArray(tile.neighbors)) continue;

      for (const nPls of tile.neighbors) {
        // 悬空检查
        if (!tilesInRegion[nPls]) {
          rawIssues.push(
            makeIssue(
              VALIDATE_RULES.NEIGHBOR_DANGLING,
              'error',
              `pgroup=${pgroup} pls=${pls} 引用悬空邻居 pls=${nPls}`,
              { pgroup, pls },
              '删除该邻居引用或恢复被删除的格',
            ),
          );
          continue;
        }
        // 对称性检查
        const neighbor = tilesInRegion[nPls];
        if (!neighbor || !Array.isArray(neighbor.neighbors) || !neighbor.neighbors.includes(pls)) {
          rawIssues.push(
            makeIssue(
              VALIDATE_RULES.NEIGHBOR_ASYMMETRIC,
              'error',
              `pgroup=${pgroup} pls=${pls}→${nPls} 但 ${nPls}.neighbors 不含 ${pls}（不对称）`,
              { pgroup, pls },
              '使用"恢复连通"工具重新建立双向连通',
            ),
          );
        }
      }
    }
  }

  // 去重：每对不对称只报一次（pls A→B 和 B→A 是同一问题，按 [min,max] 排序键去重）
  const seen = new Set<string>();
  return rawIssues.filter((issue) => {
    if (issue.rule !== VALIDATE_RULES.NEIGHBOR_ASYMMETRIC) return true;
    // 从 message 中提取 pls=A→B
    const match = issue.message.match(/pls=(\d+)→(\d+)/);
    if (!match) return true;
    const a = Number(match[1]);
    const b = Number(match[2]);
    const key = `${Math.min(a, b)}-${Math.max(a, b)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── 规则 4：exit_links 引用 ──────────────────────────────────────
//
// 覆盖：
//   - exit_links[idx].to_pgroup 必须存在
//   - exit_links[idx].from_pls 在源区域必须存在（若指定）
//   - exit_links[idx].to_pls 在目标区域必须存在（若指定）

export function validateExitLinks(project: MapProject): ValidateIssue[] {
  const issues: ValidateIssue[] = [];
  const { regions, tiles } = project;

  for (const pgroup of pgroupKeys(regions)) {
    const region = regions[pgroup];
    if (!region || !Array.isArray(region.exit_links)) continue;

    region.exit_links.forEach((link, idx) => {
      // to_pgroup 引用
      if (link.to_pgroup == null || !regions[link.to_pgroup]) {
        issues.push(
          makeIssue(
            VALIDATE_RULES.EXIT_LINK_TO_PGROUP_DANGLING,
            'error',
            `区域 ${pgroup}.exit_links[${idx}].to_pgroup=${link.to_pgroup} 不存在`,
            { pgroup, field: `exit_links[${idx}].to_pgroup` },
            '删除该 exit_link 或重设 to_pgroup',
          ),
        );
        return;
      }
      // from_pls 在源区域存在（若指定）
      if (link.from_pls != null) {
        const srcTiles = tiles[pgroup] ?? {};
        if (!srcTiles[link.from_pls]) {
          issues.push(
            makeIssue(
              VALIDATE_RULES.EXIT_LINK_TO_PLS_DANGLING,
              'error',
              `区域 ${pgroup}.exit_links[${idx}].from_pls=${link.from_pls} 不存在`,
              { pgroup, pls: link.from_pls, field: `exit_links[${idx}].from_pls` },
              '重设 from_pls 或删除该 exit_link',
            ),
          );
        }
      }
      // to_pls 在目标区域存在（若指定）
      if (link.to_pls != null) {
        const dstTiles = tiles[link.to_pgroup] ?? {};
        if (!dstTiles[link.to_pls]) {
          issues.push(
            makeIssue(
              VALIDATE_RULES.EXIT_LINK_TO_PLS_DANGLING,
              'error',
              `区域 ${pgroup}.exit_links[${idx}].to_pls=${link.to_pls} 在 to_pgroup=${link.to_pgroup} 中不存在`,
              { pgroup: link.to_pgroup, pls: link.to_pls, field: `exit_links[${idx}].to_pls` },
              '重设 to_pls 或删除该 exit_link',
            ),
          );
        }
      }
    });
  }

  return issues;
}

// ─── 规则 5：连通性孤岛（从 entrance_pls BFS） ────────────────────
//
// 边界案例：跳过未设置 entrance_pls 的区域（已在规则 2 报 warning，避免重复告警）
// 复用 shared/algorithms/connectivity.ts 的 detectIslands（纯函数 BFS）

export function validateConnectivity(project: MapProject): ValidateIssue[] {
  const issues: ValidateIssue[] = [];
  const { regions, tiles } = project;

  for (const pgroup of pgroupKeys(regions)) {
    const region = regions[pgroup];
    if (!region) continue;
    const tilesInRegion = tiles[pgroup] ?? {};
    const tileKeys = plsKeys(tilesInRegion);

    if (tileKeys.length === 0) continue;

    // 跳过未设置 entrance_pls 的区域（已在规则 2 报 REGION_NO_ENTRANCE warning）
    if (region.entrance_pls == null) continue;
    if (!tilesInRegion[region.entrance_pls]) continue;

    const result = detectIslands(tilesInRegion, region.entrance_pls);
    if (result.unreachable.length > 0) {
      const preview = result.unreachable.slice(0, 5).join(', ');
      const suffix = result.unreachable.length > 5 ? ' ...' : '';
      issues.push(
        makeIssue(
          VALIDATE_RULES.CONNECTIVITY_ISLAND,
          'warning',
          `区域 ${pgroup} 有 ${result.unreachable.length} 个不可达格（从 entrance_pls=${region.entrance_pls} BFS）：${preview}${suffix}`,
          { pgroup, pls: result.unreachable[0]! },
          '使用"恢复连通"工具或检查断开列表',
        ),
      );
    }
  }

  return issues;
}

// ─── 规则 6：配置文件交叉引用 ────────────────────────────────────
//
// 覆盖：
//   - poi_pool → poi_table：poi_id 必须存在（error）
//   - poi_table.loot_table_id → loot_tables：未在 lootTableIds 中则 warning
//   - scatter_pool → item_table：未在 itemTableIds 中则 warning
//
// 边界案例：
//   - lootTableIds / itemTableIds 未提供（空数组）时跳过对应规则
//   - scatterPool / poiTable / poiPool 为 null 时跳过对应规则
//   - 生成器调用时强制 includeConfig=false，跳过整段

export function validateConfigReferences(
  options: Pick<ValidateOptions, 'lootTableIds' | 'itemTableIds' | 'scatterPool' | 'poiTable' | 'poiPool'> = {},
): ValidateIssue[] {
  const issues: ValidateIssue[] = [];
  const { lootTableIds = [], itemTableIds = [], scatterPool, poiTable, poiPool } = options;

  // poi_pool → poi_table
  if (poiPool && poiTable) {
    for (const tide of TIDE_TYPES) {
      const list = poiPool[tide] ?? [];
      list.forEach((entry, idx) => {
        if (!entry.poi_id) return; // 空 poi_id 跳过（未填写）
        if (!poiTable[entry.poi_id]) {
          issues.push(
            makeIssue(
              VALIDATE_RULES.POI_POOL_REF,
              'error',
              `poi_pool.${tide}[${idx}].poi_id="${entry.poi_id}" 在 poi_table 中不存在`,
              { pgroup: null, field: `poi_pool.${tide}[${idx}]` },
              '在 POI 模板 Tab 中创建该模板，或修正引用',
            ),
          );
        }
      });
    }
  }

  // poi_table.loot_table_id → loot_tables（warning：外部依赖，可能未提供）
  if (lootTableIds.length > 0 && poiTable) {
    const lootSet = new Set(lootTableIds);
    for (const poiId of Object.keys(poiTable)) {
      const tpl = poiTable[poiId];
      if (!tpl) continue;
      if (tpl.loot_table_id && !lootSet.has(tpl.loot_table_id)) {
        issues.push(
          makeIssue(
            VALIDATE_RULES.POI_LOOT_TABLE_REF,
            'warning',
            `poi_table.${poiId}.loot_table_id="${tpl.loot_table_id}" 在 loot_tables 中未找到`,
            { pgroup: null, field: `poi_table.${poiId}.loot_table_id` },
            '若编辑器未导入 loot_tables.php 可忽略',
          ),
        );
      }
    }
  }

  // scatter_pool → item_table（warning）
  if (itemTableIds.length > 0 && scatterPool) {
    const itemSet = new Set(itemTableIds);
    for (const tide of TIDE_TYPES) {
      const phase = scatterPool[tide];
      if (!phase) continue;
      for (const phaseKey of ['initial', 'refresh'] as const) {
        const list = phase[phaseKey] ?? [];
        list.forEach((entry, idx) => {
          if (!entry.item_id) return;
          if (!itemSet.has(entry.item_id)) {
            issues.push(
              makeIssue(
                VALIDATE_RULES.SCATTER_ITEM_REF,
                'warning',
                `scatter_pool.${tide}.${phaseKey}[${idx}].item_id="${entry.item_id}" 在 item_table 中未找到`,
                { pgroup: null, field: `scatter_pool.${tide}.${phaseKey}[${idx}]` },
                '若编辑器未导入 item_table.php 可忽略',
              ),
            );
          }
        });
      }
    }
  }

  return issues;
}

// ─── 入口：Light / Full 验证 ─────────────────────────────────────

/**
 * 运行 Light 验证（实时、跳过 BFS 与配置交叉引用）
 *
 * 对齐 NEW_DESIGN.md §3.5.2：编辑时实时触发（debounce 300ms）
 * O(格数)，适合在 projectStore mutation 后高频调用
 *
 * @param project 地图项目
 * @returns issues 数组
 */
export function runLightValidation(project: MapProject): ValidateIssue[] {
  return [
    ...validateTilesBasic(project),
    ...validateRegionReferences(project),
    ...validateNeighbors(project),
    ...validateExitLinks(project),
  ];
}

/**
 * 运行 Full 验证（按需、含连通性 BFS + 可选配置交叉引用）
 *
 * 对齐 NEW_DESIGN.md §3.5.2：用户点击"完整验证"按钮或生成器写入后触发
 * O(格数+边数)
 *
 * @param project 地图项目
 * @param options 验证选项：
 *   - includeConnectivity=true（默认）执行连通性 BFS
 *   - includeConfig=true（默认）执行配置交叉引用，需提供 scatterPool / poiTable / poiPool
 *   - lootTableIds / itemTableIds 未提供时跳过对应外部引用校验
 * @returns issues 数组
 */
export function runFullValidation(
  project: MapProject,
  options: ValidateOptions = {},
): ValidateIssue[] {
  const {
    includeConnectivity = true,
    includeConfig = true,
    lootTableIds,
    itemTableIds,
    scatterPool,
    poiTable,
    poiPool,
  } = options;

  const issues: ValidateIssue[] = [...runLightValidation(project)];

  if (includeConnectivity) {
    issues.push(...validateConnectivity(project));
  }

  if (includeConfig) {
    issues.push(
      ...validateConfigReferences({
        lootTableIds,
        itemTableIds,
        scatterPool,
        poiTable,
        poiPool,
      }),
    );
  }

  return issues;
}

/**
 * 统一入口：按 mode 分发 Light / Full 验证
 *
 * @param project 地图项目
 * @param mode 'light' | 'full'
 * @param options Full 模式下的验证选项（Light 模式忽略）
 */
export function runValidation(
  project: MapProject,
  mode: ValidateMode,
  options: ValidateOptions = {},
): ValidateIssue[] {
  return mode === 'light'
    ? runLightValidation(project)
    : runFullValidation(project, options);
}

// ─── 单格 / 单区域实时校验（编辑器输入 UI 使用） ────────────────

/**
 * 校验单个 tile 的字段（编辑时实时调用）
 *
 * 用于 TilePanel 字段失焦时的局部校验，避免跑全量 Light 验证
 */
export function validateTile(pgroup: Pgroup, pls: Pls, tile: Tile | null): ValidateIssue[] {
  const issues: ValidateIssue[] = [];
  if (!tile) return issues;

  if (tile.tide && !TIDE_TYPES.includes(tile.tide)) {
    issues.push(
      makeIssue(
        VALIDATE_RULES.TIDE_INVALID,
        'error',
        `tide="${tile.tide}" 不在 [${TIDE_TYPES.join(',')}]`,
        { pgroup, pls },
      ),
    );
  }
  if (tile.floor && !FLOOR_TYPES.includes(tile.floor)) {
    issues.push(
      makeIssue(
        VALIDATE_RULES.FLOOR_INVALID,
        'error',
        `floor="${tile.floor}" 不在 [${FLOOR_TYPES.join(',')}]`,
        { pgroup, pls },
      ),
    );
  }
  if (pls < PLS_MIN || pls > PLS_MAX) {
    issues.push(
      makeIssue(
        VALIDATE_RULES.PLS_RANGE,
        'error',
        `pls=${pls} 超出范围 [${PLS_MIN}-${PLS_MAX}]`,
        { pgroup, pls },
      ),
    );
  }

  return issues;
}

/**
 * 校验单个区域字段
 *
 * 用于 RegionPanel 字段失焦时的局部校验
 */
export function validateRegion(pgroup: Pgroup, region: Region | null): ValidateIssue[] {
  const issues: ValidateIssue[] = [];
  if (!region) return issues;

  if (pgroup < PGROUP_MIN || pgroup > PGROUP_MAX) {
    issues.push(
      makeIssue(
        VALIDATE_RULES.PGROUP_RANGE,
        'error',
        `pgroup=${pgroup} 超出范围 [${PGROUP_MIN}-${PGROUP_MAX}]`,
        { pgroup },
      ),
    );
  }

  return issues;
}

// ─── 汇总统计 ────────────────────────────────────────────────────

/**
 * 汇总 issues 统计
 *
 * P6 扩展：新增 blockingCount 统计 blocking=true 的 issue 数量（执行案 §4.5.1）。
 * blocking=true 的 issue 阻断构建发布，与 severity='error' 是正交维度——
 * 可以存在"非阻断的 error"（如已知引用失败）和"阻断的 error"（如镜像不一致）。
 *
 * @returns { errors, warnings, blockingCount, byRule }
 */
export function summarize(issues: readonly ValidateIssue[]): ValidateSummary {
  let errors = 0;
  let warnings = 0;
  let blockingCount = 0;
  const byRule: Record<string, number> = {};
  for (const issue of issues) {
    if (issue.severity === 'error') errors++;
    else warnings++;
    if (issue.blocking) blockingCount++;
    byRule[issue.rule] = (byRule[issue.rule] ?? 0) + 1;
  }
  return { errors, warnings, blockingCount, byRule };
}

// ─── P1-H 新增：从 graph-store 读取的第 2 层结构校验入口 ────────
//
// 设计意图（执行案 §三 + §5.3）：
//   - 第 2 层结构校验改为从 graph-store 读取 world.region / world.tile 节点，
//     不再依赖 projectStore（projectStore 已退化为 graph-store 的响应式入口）
//   - 通过 projectFromGraph 重建 MapProject 形状，复用现有 5 个纯函数规则集
//     （validateTilesBasic / validateRegionReferences / validateNeighbors /
//     validateExitLinks / validateConnectivity），保持 17 个 structure rule ID 与
//     severity 不变
//   - 不含配置交叉引用（POI_POOL_REF / POI_LOOT_TABLE_REF / SCATTER_ITEM_REF）——
//     这 3 个 rule ID 属于第 3 层 reference-validator，由其独立读取 graph-store
//   - 现有 runLightValidation(project) / runFullValidation(project, options?) 保留，
//     供现有单元测试与 M8 生成器（includeConfig=false）继续使用

/**
 * 从 graph-store 读取并运行第 2 层结构校验。
 *
 * 内部流程：
 *   1. 从 graph-store 读取 world.region / world.tile 节点
 *   2. 通过 projectFromGraph 重建 MapProject 形状
 *   3. 调用 5 个结构校验纯函数（17 个 rule ID）：
 *      - validateTilesBasic：PLS_RANGE / PGROUP_RANGE / TIDE_INVALID / FLOOR_INVALID / OCCUPY_CONFLICT
 *      - validateRegionReferences：REGION_NEXT_DANGLING / REGION_PREV_DANGLING /
 *        REGION_NEXT_PREV_ASYMMETRIC / REGION_ENTRANCE_DANGLING / REGION_EXIT_DANGLING /
 *        REGION_NO_ENTRANCE / REGION_NO_EXIT
 *      - validateNeighbors：NEIGHBOR_DANGLING / NEIGHBOR_ASYMMETRIC
 *      - validateExitLinks：EXIT_LINK_TO_PGROUP_DANGLING / EXIT_LINK_TO_PLS_DANGLING
 *      - validateConnectivity：CONNECTIVITY_ISLAND
 *
 * 不含 Light / Full 入口的分级语义——调用方（structure-validator）决定是否包含 BFS。
 * 本函数始终包含 BFS（与 structure-validator 当前行为一致）。
 *
 * @param graphStore graph-store 实例
 * @returns ValidateIssue[]（17 个 structure rule ID 之一）
 */
export function runStructureValidationFromGraph(graphStore: GraphStore): ValidateIssue[] {
  const regionNodes = graphStore.findNodesByKind('world.region');
  const tileNodes = graphStore.findNodesByKind('world.tile');
  const project: MapProject = projectFromGraph(regionNodes, tileNodes);

  const issues: ValidateIssue[] = [];
  issues.push(...validateTilesBasic(project));
  issues.push(...validateRegionReferences(project));
  issues.push(...validateNeighbors(project));
  issues.push(...validateExitLinks(project));
  issues.push(...validateConnectivity(project));
  return issues;
}
