// @module O 内容工具箱
//
// configStore：配置文件缓存（对齐 NEW_DESIGN.md §3.4 + DESIGN.md §3.4.4）
//
// 研判（P1-E 重构后）：
//   - 配置编辑框架的核心状态层
//   - 复用 shared 的 parsePhpArray / generateConfigPhp 序列化器
//   - validateStore 配置交叉引用校验读取此处 state
//   - M7 后端保存调用 toPhpFiles()，由 generateConfigPhp 反向生成
//
// 设计意图（对齐 2.6 配置驱动 + §3.4.4 配置缓存策略）：
//   - 内存缓存 scatter_pool / poi_table / poi_pool（P3/P4 才迁移到 Resource Graph）
//   - oblConfig 改为派生自 graph-store 的 config.runtime:obl_config 节点（只读）
//   - 不持久化到 localStorage——配置变更必须显式保存到后端或导出才能持久化
//   - 数据流单向：解析 PHP → configStore → 编辑 → 反向生成 PHP
//   - rate 是"基础率"，不与运行时倍率预先折算（倍率由后端应用）
//   - obl_config 只读不编辑（避免覆盖后端现存配置）；loadFromPhpStrings 内部
//     把 obl_config 解析后写入 graph-store 的 config.runtime:obl_config 节点
//   - 配置缓存与地图数据隔离，保存配置不触发地图重渲染
//
// 接口约定（供 M6 / M7 使用）：
//   - state：scatterPool / poiTable / poiPool / oblConfig（派生 computed，只读）/ isDirty
//   - 加载：loadFromPhpStrings(files: Record<string, string>) → ParseResult
//   - scatter CRUD：updateScatterEntry / addScatterEntry / removeScatterEntry / moveScatterEntry
//   - poi_table CRUD：updatePoiTemplate / addPoiTemplate / removePoiTemplate / renamePoiTemplate
//   - poi_pool CRUD：updatePoiPoolEntry / addPoiPoolEntry / removePoiPoolEntry / movePoiPoolEntry
//   - 导出：toPhpFiles() → Record<string, string>（文件路径 → 内容映射）
//   - 重置：reset()

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import {
  parsePhpArray,
  generateConfigPhp,
  type PhpValue,
  type CodegenValue,
} from '@/shared';
import type {
  ScatterPool,
  ScatterPoolEntry,
  ScatterPoolPhase,
  PoiTable,
  PoiTableEntry,
  PoiPool,
  PoiPoolEntry,
  PoiEventPoolEntry,
  PoiDismantleReturn,
  PoiLootTableOverride,
  OblConfig,
} from '@/shared';
import type { Tide } from '@/shared';
import { useGraphStore } from '@/graph/graph-store';

/**
 * 加载结果（对齐 NEW_DESIGN.md §3.4.4 单向数据流）
 */
export interface ConfigLoadResult {
  /** 是否全部成功 */
  ok: boolean;
  /** 已加载的文件名列表 */
  loaded: string[];
  /** 失败的文件 → 错误信息 */
  errors: Record<string, string>;
}

/**
 * Scatter 相位类型
 */
export type ScatterPhase = 'initial' | 'refresh';

/**
 * 配置文件名常量（对齐 gamedata/）
 */
export const CONFIG_FILE_SCATTER_POOL = 'scatter_pool.php';
export const CONFIG_FILE_POI_TABLE = 'poi_table.php';
export const CONFIG_FILE_POI_POOL = 'poi_pool.php';
export const CONFIG_FILE_OBL_CONFIG = 'obl_config.php';

/**
 * Tide 三档 + Scatter 两相位（schema 驱动 UI 复用）
 */
const TIDES: readonly Tide[] = ['shallow', 'deep', 'abyss'];
const PHASES: readonly ScatterPhase[] = ['initial', 'refresh'];

/**
 * 空散布池（初始化用）
 */
function makeEmptyScatterPool(): ScatterPool {
  return {
    shallow: { initial: [], refresh: [] },
    deep: { initial: [], refresh: [] },
    abyss: { initial: [], refresh: [] },
  };
}

/**
 * 空 POI 生成池
 */
function makeEmptyPoiPool(): PoiPool {
  return { shallow: [], deep: [], abyss: [] };
}

// ─── 归一化层：PhpValue → 强类型 ─────────────────────────────

/**
 * 将 PHP 解析的 count 字段归一化为 number | [number, number]
 *
 * PHP 中 count 可能是数字（1）或索引数组（[1,3]）
 */
function normalizeScatterCount(value: PhpValue | undefined): number | [number, number] {
  if (value === undefined || value === null) return 0;
  if (typeof value === 'number') return value;
  if (Array.isArray(value) && value.length >= 2) {
    const min = typeof value[0] === 'number' ? value[0] : 0;
    const max = typeof value[1] === 'number' ? value[1] : 0;
    return [min, max];
  }
  if (Array.isArray(value) && value.length === 1 && typeof value[0] === 'number') {
    return value[0];
  }
  return 0;
}

/**
 * 将 PHP 解析的 entry 归一化为 ScatterPoolEntry
 */
function normalizeScatterEntry(raw: PhpValue): ScatterPoolEntry | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, PhpValue>;
  const itemId = typeof obj.item_id === 'string' ? obj.item_id : '';
  const rate = typeof obj.rate === 'number' ? obj.rate : 0;
  return {
    item_id: itemId,
    count: normalizeScatterCount(obj.count),
    rate,
  };
}

/**
 * 将 PHP 解析的 phase 归一化为 ScatterPoolPhase
 */
function normalizeScatterPhase(raw: PhpValue): ScatterPoolPhase {
  const result: ScatterPoolPhase = { initial: [], refresh: [] };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return result;
  const obj = raw as Record<string, PhpValue>;
  for (const phase of PHASES) {
    const phaseData = obj[phase];
    if (Array.isArray(phaseData)) {
      result[phase] = phaseData
        .map(normalizeScatterEntry)
        .filter((e): e is ScatterPoolEntry => e !== null);
    }
  }
  return result;
}

/**
 * 将 PHP 解析的 scatter_pool 归一化为 ScatterPool
 */
function normalizeScatterPool(raw: PhpValue): ScatterPool {
  const result = makeEmptyScatterPool();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return result;
  const obj = raw as Record<string, PhpValue>;
  for (const tide of TIDES) {
    const tideData = obj[tide];
    if (tideData && typeof tideData === 'object' && !Array.isArray(tideData)) {
      result[tide] = normalizeScatterPhase(tideData);
    }
  }
  return result;
}

/**
 * 将 PHP 解析的 event_pool entry 归一化
 */
function normalizeEventPoolEntry(raw: PhpValue): PoiEventPoolEntry | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, PhpValue>;
  const eventId = typeof obj.event_id === 'string' ? obj.event_id : '';
  const weight = typeof obj.weight === 'number' ? obj.weight : 0;
  const kindRaw = obj.kind;
  const kind: 'good' | 'bad' = kindRaw === 'good' || kindRaw === 'bad' ? kindRaw : 'good';
  return { event_id: eventId, weight, kind };
}

/**
 * 将 PHP 解析的 dismantle_returns entry 归一化
 */
function normalizeDismantleReturn(raw: PhpValue): PoiDismantleReturn | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, PhpValue>;
  const itemId = typeof obj.item_id === 'string' ? obj.item_id : '';
  const count = typeof obj.count === 'number' ? obj.count : 0;
  return { item_id: itemId, count };
}

/**
 * 将 PHP 解析的 loot_table_overrides 归一化
 */
function normalizeLootTableOverride(raw: PhpValue): PoiLootTableOverride {
  const result: PoiLootTableOverride = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return result;
  const obj = raw as Record<string, PhpValue>;
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      result[key] = value;
    }
  }
  return result;
}

/**
 * 将 PHP 解析的 prob_mods_source 归一化为 string[]
 */
function normalizeStringList(raw: PhpValue): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === 'string');
}

/**
 * 将 PHP 解析的 poi_table 单条模板归一化为 PoiTableEntry
 *
 * 保留原 PHP 文件中存在的字段，未提供的字段不赋值（保持 optional）
 * searchable / repeatable 是必填字段，缺失时默认 false
 */
function normalizePoiTableEntry(raw: PhpValue): PoiTableEntry | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, PhpValue>;
  const entry: PoiTableEntry = {
    searchable: typeof obj.searchable === 'boolean' ? obj.searchable : false,
    repeatable: typeof obj.repeatable === 'boolean' ? obj.repeatable : false,
  };
  // 基本字段（仅在存在时赋值，保留 round-trip）
  if (typeof obj.name === 'string') entry.name = obj.name;
  if (typeof obj.desc === 'string') entry.desc = obj.desc;
  if (typeof obj.repeat_limit === 'number') entry.repeat_limit = obj.repeat_limit;
  if (typeof obj.repeat_cooldown === 'number') entry.repeat_cooldown = obj.repeat_cooldown;
  // E-10 三档判定
  if (typeof obj.base_loot_chance === 'number') entry.base_loot_chance = obj.base_loot_chance;
  if (typeof obj.base_good_event_chance === 'number') entry.base_good_event_chance = obj.base_good_event_chance;
  if (typeof obj.base_bad_event_chance === 'number') entry.base_bad_event_chance = obj.base_bad_event_chance;
  if (typeof obj.loot_table_id === 'string') entry.loot_table_id = obj.loot_table_id;
  if (Array.isArray(obj.event_pool)) {
    entry.event_pool = obj.event_pool
      .map(normalizeEventPoolEntry)
      .filter((e): e is PoiEventPoolEntry => e !== null);
  }
  if (Array.isArray(obj.prob_mods_source)) {
    entry.prob_mods_source = normalizeStringList(obj.prob_mods_source);
  }
  if (obj.loot_table_overrides && typeof obj.loot_table_overrides === 'object' && !Array.isArray(obj.loot_table_overrides)) {
    entry.loot_table_overrides = normalizeLootTableOverride(obj.loot_table_overrides);
  }
  // 机制型
  if (typeof obj.mechanic === 'string') entry.mechanic = obj.mechanic;
  if (typeof obj.mechanic_value === 'string' || typeof obj.mechanic_value === 'number') {
    entry.mechanic_value = obj.mechanic_value;
  }
  // mechanic_params 类型不定（string[] / object / 其他），原样保留以支持 round-trip
  if (obj.mechanic_params !== undefined && obj.mechanic_params !== null) {
    entry.mechanic_params = obj.mechanic_params;
  }
  // E-12 耐久
  if (typeof obj.ttl_days === 'number') entry.ttl_days = obj.ttl_days;
  if (Array.isArray(obj.dismantle_returns)) {
    entry.dismantle_returns = obj.dismantle_returns
      .map(normalizeDismantleReturn)
      .filter((e): e is PoiDismantleReturn => e !== null);
  }
  return entry;
}

/**
 * 将 PHP 解析的 poi_table 归一化为 PoiTable
 */
function normalizePoiTable(raw: PhpValue): PoiTable {
  const result: PoiTable = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return result;
  const obj = raw as Record<string, PhpValue>;
  for (const [poiId, value] of Object.entries(obj)) {
    const entry = normalizePoiTableEntry(value);
    if (entry !== null) {
      result[poiId] = entry;
    }
  }
  return result;
}

/**
 * 将 PHP 解析的 poi_pool entry 归一化
 */
function normalizePoiPoolEntry(raw: PhpValue): PoiPoolEntry | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, PhpValue>;
  const poiId = typeof obj.poi_id === 'string' ? obj.poi_id : '';
  const perRegion = typeof obj.per_region === 'number' ? obj.per_region : 0;
  return { poi_id: poiId, per_region: perRegion };
}

/**
 * 将 PHP 解析的 poi_pool 归一化为 PoiPool
 */
function normalizePoiPool(raw: PhpValue): PoiPool {
  const result = makeEmptyPoiPool();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return result;
  const obj = raw as Record<string, PhpValue>;
  for (const tide of TIDES) {
    const tideData = obj[tide];
    if (Array.isArray(tideData)) {
      result[tide] = tideData
        .map(normalizePoiPoolEntry)
        .filter((e): e is PoiPoolEntry => e !== null);
    }
  }
  return result;
}

/**
 * 将 PHP 解析的 obl_config 归一化为 OblConfig
 *
 * obl_config 字段混合 number / string / boolean / 嵌套数组，
 * 用 Record<string, unknown> 兜底，保留 round-trip 完整性
 */
function normalizeOblConfig(raw: PhpValue): OblConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return { ...(raw as Record<string, unknown>) };
}

// ─── 反向序列化：强类型 → CodegenValue ─────────────────────

/**
 * 将 ScatterPoolEntry.count 转回 PHP 兼容形态：
 *   - number → number
 *   - [min, max] 且 min !== max → [min, max]
 *   - [min, max] 且 min === max → number（简化为单值）
 */
function scatterCountToCodegen(count: number | [number, number]): number | number[] {
  if (typeof count === 'number') return count;
  if (count[0] === count[1]) return count[0];
  return [count[0], count[1]];
}

/**
 * 将 ScatterPoolEntry 转为 CodegenValue
 */
function scatterEntryToCodegen(entry: ScatterPoolEntry): CodegenValue {
  return {
    item_id: entry.item_id,
    count: scatterCountToCodegen(entry.count),
    rate: entry.rate,
  };
}

/**
 * 将 ScatterPool 转为 CodegenValue
 */
function scatterPoolToCodegen(pool: ScatterPool): CodegenValue {
  const result: Record<string, CodegenValue> = {};
  for (const tide of TIDES) {
    const phase = pool[tide];
    result[tide] = {
      initial: phase.initial.map(scatterEntryToCodegen),
      refresh: phase.refresh.map(scatterEntryToCodegen),
    };
  }
  return result;
}

/**
 * 将 PoiTableEntry 转为 CodegenValue
 *
 * 仅输出已设置的字段（保持与原 PHP 文件形状一致，未设置的字段不写入）
 */
function poiTableEntryToCodegen(entry: PoiTableEntry): CodegenValue {
  const result: Record<string, CodegenValue> = {};
  // 基本
  if (entry.name !== undefined) result.name = entry.name;
  if (entry.desc !== undefined) result.desc = entry.desc;
  result.searchable = entry.searchable;
  result.repeatable = entry.repeatable;
  if (entry.repeat_limit !== undefined) result.repeat_limit = entry.repeat_limit;
  if (entry.repeat_cooldown !== undefined) result.repeat_cooldown = entry.repeat_cooldown;
  // E-10 三档判定
  if (entry.base_loot_chance !== undefined) result.base_loot_chance = entry.base_loot_chance;
  if (entry.base_good_event_chance !== undefined) result.base_good_event_chance = entry.base_good_event_chance;
  if (entry.base_bad_event_chance !== undefined) result.base_bad_event_chance = entry.base_bad_event_chance;
  if (entry.loot_table_id !== undefined) result.loot_table_id = entry.loot_table_id;
  if (entry.event_pool !== undefined) {
    result.event_pool = entry.event_pool.map((e) => ({
      event_id: e.event_id,
      weight: e.weight,
      kind: e.kind,
    }));
  }
  if (entry.prob_mods_source !== undefined) result.prob_mods_source = entry.prob_mods_source;
  if (entry.loot_table_overrides !== undefined) {
    result.loot_table_overrides = entry.loot_table_overrides;
  }
  // 机制型
  if (entry.mechanic !== undefined) result.mechanic = entry.mechanic;
  if (entry.mechanic_value !== undefined) result.mechanic_value = entry.mechanic_value;
  if (entry.mechanic_params !== undefined) result.mechanic_params = entry.mechanic_params as CodegenValue;
  // E-12 耐久
  if (entry.ttl_days !== undefined) result.ttl_days = entry.ttl_days;
  if (entry.dismantle_returns !== undefined) {
    result.dismantle_returns = entry.dismantle_returns.map((d) => ({
      item_id: d.item_id,
      count: d.count,
    }));
  }
  return result;
}

/**
 * 将 PoiTable 转为 CodegenValue
 */
function poiTableToCodegen(table: PoiTable): CodegenValue {
  const result: Record<string, CodegenValue> = {};
  for (const [poiId, entry] of Object.entries(table)) {
    result[poiId] = poiTableEntryToCodegen(entry);
  }
  return result;
}

/**
 * 将 PoiPool 转为 CodegenValue
 */
function poiPoolToCodegen(pool: PoiPool): CodegenValue {
  const result: Record<string, CodegenValue> = {};
  for (const tide of TIDES) {
    result[tide] = pool[tide].map((e) => ({
      poi_id: e.poi_id,
      per_region: e.per_region,
    }));
  }
  return result;
}

// ─── Store 定义 ────────────────────────────────────────────

export const useConfigStore = defineStore('config', () => {
  // ─── graph-store 实例（响应式入口，用于派生 oblConfig） ───
  const graph = useGraphStore();

  // ─── state ────────────────────────────────────────────
  const scatterPool = ref<ScatterPool | null>(null);
  const poiTable = ref<PoiTable | null>(null);
  const poiPool = ref<PoiPool | null>(null);
  // oblConfig 改为派生 computed——从 graph-store 的 config.runtime:obl_config 节点读取
  // （见下方 computed 定义；此处仅留注释，不再保留独立 ref）
  const isDirty = ref(false);

  // ─── getters ──────────────────────────────────────────
  const hasConfig = computed(
    () => scatterPool.value !== null && poiTable.value !== null && poiPool.value !== null,
  );

  /**
   * POI 模板 ID 列表（供 PoiPoolEditor 联动下拉使用）
   */
  const poiIdOptions = computed(() => {
    if (!poiTable.value) return [] as ReadonlyArray<{ value: string; label: string }>;
    return Object.entries(poiTable.value).map(([id, entry]) => ({
      value: id,
      label: entry.name ? `${id} (${entry.name})` : id,
    }));
  });

  /**
   * oblConfig 派生 computed——从 graph-store 的 config.runtime:obl_config 节点读取 entries。
   *
   * 数据权威源是 graph-store 中的 `config.runtime:obl_config` 节点。
   * 外部不得直接修改（无 setOblConfig action）；oblConfig 由 loadFromPhpStrings
   * 解析后通过 graph.upsertNode 写入节点。
   *
   * 节点不存在时返回 null（与旧 ref<OblConfig | null> 行为一致）。
   */
  const oblConfig = computed<OblConfig | null>(() => {
    const nodes = graph.findNodesByKind('config.runtime');
    // config.runtime 节点 id 固定为 'obl_config'（见 schema/kinds/config-runtime.ts）
    const node = nodes.find((n) => n.id === 'obl_config');
    if (!node) return null;
    const data = node.data as { entries?: OblConfig };
    return data.entries ?? null;
  });

  // ─── 加载 ─────────────────────────────────────────────

  /**
   * 从 PHP 文件字符串映射加载配置（对齐 §3.4.4 单向数据流：解析 PHP → configStore）
   *
   * obl_config 部分不再写入本地 ref，而是通过 graph.upsertNode 写入 graph-store 的
   * config.runtime:obl_config 节点（oblConfig 派生 computed 自动响应）。
   *
   * @param files 文件名 → 内容映射，支持的 key：
   *   - 'scatter_pool.php' / 'poi_table.php' / 'poi_pool.php' / 'obl_config.php'
   *   - 也接受去掉 .php 后缀的简写：'scatter_pool' 等
   * @returns 加载结果（含成功/失败明细）
   */
  function loadFromPhpStrings(files: Record<string, string>): ConfigLoadResult {
    const loaded: string[] = [];
    const errors: Record<string, string> = {};

    const findFile = (canonical: string): string | undefined => {
      if (files[canonical] !== undefined) return files[canonical];
      const shortName = canonical.replace(/\.php$/, '');
      if (files[shortName] !== undefined) return files[shortName];
      // 兼容带路径前缀（如 gamedata/scatter_pool.php）
      for (const key of Object.keys(files)) {
        if (key.endsWith('/' + canonical) || key.endsWith('/' + shortName)) {
          return files[key];
        }
      }
      return undefined;
    };

    // scatter_pool
    const scatterContent = findFile(CONFIG_FILE_SCATTER_POOL);
    if (scatterContent !== undefined) {
      const result = parsePhpArray(scatterContent);
      if (result.ok && result.value !== null) {
        scatterPool.value = normalizeScatterPool(result.value);
        loaded.push(CONFIG_FILE_SCATTER_POOL);
      } else {
        errors[CONFIG_FILE_SCATTER_POOL] = result.error?.message ?? '解析失败';
      }
    }

    // poi_table
    const poiTableContent = findFile(CONFIG_FILE_POI_TABLE);
    if (poiTableContent !== undefined) {
      const result = parsePhpArray(poiTableContent);
      if (result.ok && result.value !== null) {
        poiTable.value = normalizePoiTable(result.value);
        loaded.push(CONFIG_FILE_POI_TABLE);
      } else {
        errors[CONFIG_FILE_POI_TABLE] = result.error?.message ?? '解析失败';
      }
    }

    // poi_pool
    const poiPoolContent = findFile(CONFIG_FILE_POI_POOL);
    if (poiPoolContent !== undefined) {
      const result = parsePhpArray(poiPoolContent);
      if (result.ok && result.value !== null) {
        poiPool.value = normalizePoiPool(result.value);
        loaded.push(CONFIG_FILE_POI_POOL);
      } else {
        errors[CONFIG_FILE_POI_POOL] = result.error?.message ?? '解析失败';
      }
    }

    // obl_config（只读）——写入 graph-store 的 config.runtime:obl_config 节点
    // oblConfig 派生 computed 自动响应节点变更
    const oblConfigContent = findFile(CONFIG_FILE_OBL_CONFIG);
    if (oblConfigContent !== undefined) {
      const result = parsePhpArray(oblConfigContent);
      if (result.ok && result.value !== null) {
        const entries = normalizeOblConfig(result.value);
        // 同步调用，computed 立即响应（P0-P4：graph-store actions 同步）
        graph.upsertNode({
          kind: 'config.runtime',
          id: 'obl_config',
          data: { entries },
          source: [
            {
              filePath: 'oblivions/gamedata/obl_config.php',
              lineStart: 1,
              lineEnd: 1,
              format: 'php',
            },
          ],
          revision: '',
        });
        loaded.push(CONFIG_FILE_OBL_CONFIG);
      } else {
        errors[CONFIG_FILE_OBL_CONFIG] = result.error?.message ?? '解析失败';
      }
    }

    isDirty.value = false;
    return {
      ok: Object.keys(errors).length === 0,
      loaded,
      errors,
    };
  }

  /**
   * 直接设置 scatter_pool（绕过 PHP 解析，供测试/程序化构造使用）
   */
  function setScatterPool(next: ScatterPool): void {
    scatterPool.value = next;
    isDirty.value = true;
  }

  /**
   * 直接设置 poi_table
   */
  function setPoiTable(next: PoiTable): void {
    poiTable.value = next;
    isDirty.value = true;
  }

  /**
   * 直接设置 poi_pool
   */
  function setPoiPool(next: PoiPool): void {
    poiPool.value = next;
    isDirty.value = true;
  }

  /**
   * 一次性加载全部配置（程序化构造，绕过 PHP 解析）。
   *
   * oblConfig 部分通过 graph.upsertNode 写入 config.runtime:obl_config 节点
   * （oblConfig 派生 computed 自动响应）。
   */
  function loadAll(payload: {
    scatterPool: ScatterPool;
    poiTable: PoiTable;
    poiPool: PoiPool;
    oblConfig?: OblConfig;
  }): void {
    scatterPool.value = payload.scatterPool;
    poiTable.value = payload.poiTable;
    poiPool.value = payload.poiPool;
    if (payload.oblConfig !== undefined) {
      // 同步调用，computed 立即响应（P0-P4：graph-store actions 同步）
      graph.upsertNode({
        kind: 'config.runtime',
        id: 'obl_config',
        data: { entries: payload.oblConfig },
        source: [
          {
            filePath: 'oblivions/gamedata/obl_config.php',
            lineStart: 1,
            lineEnd: 1,
            format: 'php',
          },
        ],
        revision: '',
      });
    }
    isDirty.value = false;
  }

  // ─── scatter_pool CRUD ───────────────────────────────

  /**
   * 更新单条 scatter entry
   */
  function updateScatterEntry(
    tide: Tide,
    phase: ScatterPhase,
    index: number,
    patch: Partial<ScatterPoolEntry>,
  ): void {
    if (!scatterPool.value) return;
    const list = scatterPool.value[tide]?.[phase];
    if (!list || index < 0 || index >= list.length) return;
    list[index] = { ...list[index]!, ...patch };
    isDirty.value = true;
  }

  /**
   * 新增 scatter entry
   */
  function addScatterEntry(
    tide: Tide,
    phase: ScatterPhase,
    entry: ScatterPoolEntry,
  ): void {
    if (!scatterPool.value) return;
    scatterPool.value[tide][phase].push(entry);
    isDirty.value = true;
  }

  /**
   * 删除 scatter entry
   */
  function removeScatterEntry(tide: Tide, phase: ScatterPhase, index: number): void {
    if (!scatterPool.value) return;
    const list = scatterPool.value[tide]?.[phase];
    if (!list || index < 0 || index >= list.length) return;
    list.splice(index, 1);
    isDirty.value = true;
  }

  /**
   * 移动 scatter entry（拖拽排序使用）
   *
   * @param from 起始索引
   * @param to 目标索引
   */
  function moveScatterEntry(
    tide: Tide,
    phase: ScatterPhase,
    from: number,
    to: number,
  ): void {
    if (!scatterPool.value) return;
    const list = scatterPool.value[tide]?.[phase];
    if (!list) return;
    if (from < 0 || from >= list.length) return;
    if (to < 0 || to >= list.length) return;
    if (from === to) return;
    const [item] = list.splice(from, 1);
    if (item !== undefined) list.splice(to, 0, item);
    isDirty.value = true;
  }

  // ─── poi_table CRUD ──────────────────────────────────

  /**
   * 新增 POI 模板
   *
   * @param poiId 模板 ID（如 supply_cache）
   * @param template 模板内容
   * @returns true=成功 / false=ID 已存在
   */
  function addPoiTemplate(poiId: string, template: PoiTableEntry): boolean {
    if (!poiTable.value) return false;
    if (poiTable.value[poiId] !== undefined) return false;
    poiTable.value[poiId] = template;
    isDirty.value = true;
    return true;
  }

  /**
   * 更新 POI 模板（patch 模式）
   */
  function updatePoiTemplate(poiId: string, patch: Partial<PoiTableEntry>): void {
    if (!poiTable.value) return;
    const entry = poiTable.value[poiId];
    if (!entry) return;
    poiTable.value[poiId] = { ...entry, ...patch };
    isDirty.value = true;
  }

  /**
   * 删除 POI 模板
   */
  function removePoiTemplate(poiId: string): void {
    if (!poiTable.value) return;
    if (poiTable.value[poiId] === undefined) return;
    delete poiTable.value[poiId];
    isDirty.value = true;
  }

  /**
   * 重命名 POI 模板 ID
   *
   * @returns true=成功 / false=源不存在或目标已存在
   */
  function renamePoiTemplate(oldId: string, newId: string): boolean {
    if (!poiTable.value) return false;
    if (poiTable.value[oldId] === undefined) return false;
    // 新旧同名视为成功（无操作）
    if (oldId === newId) return true;
    // 目标已存在则拒绝
    if (poiTable.value[newId] !== undefined) return false;
    // 保留插入顺序：重建对象
    const newTable: PoiTable = {};
    for (const [key, value] of Object.entries(poiTable.value)) {
      if (key === oldId) {
        newTable[newId] = value;
      } else {
        newTable[key] = value;
      }
    }
    poiTable.value = newTable;
    isDirty.value = true;
    return true;
  }

  // ─── poi_pool CRUD ───────────────────────────────────

  /**
   * 更新 poi_pool entry
   */
  function updatePoiPoolEntry(
    tide: Tide,
    index: number,
    patch: Partial<PoiPoolEntry>,
  ): void {
    if (!poiPool.value) return;
    const list = poiPool.value[tide];
    if (!list || index < 0 || index >= list.length) return;
    list[index] = { ...list[index]!, ...patch };
    isDirty.value = true;
  }

  /**
   * 新增 poi_pool entry
   */
  function addPoiPoolEntry(tide: Tide, entry: PoiPoolEntry): void {
    if (!poiPool.value) return;
    poiPool.value[tide].push(entry);
    isDirty.value = true;
  }

  /**
   * 删除 poi_pool entry
   */
  function removePoiPoolEntry(tide: Tide, index: number): void {
    if (!poiPool.value) return;
    const list = poiPool.value[tide];
    if (!list || index < 0 || index >= list.length) return;
    list.splice(index, 1);
    isDirty.value = true;
  }

  /**
   * 移动 poi_pool entry（拖拽排序使用）
   */
  function movePoiPoolEntry(tide: Tide, from: number, to: number): void {
    if (!poiPool.value) return;
    const list = poiPool.value[tide];
    if (!list) return;
    if (from < 0 || from >= list.length) return;
    if (to < 0 || to >= list.length) return;
    if (from === to) return;
    const [item] = list.splice(from, 1);
    if (item !== undefined) list.splice(to, 0, item);
    isDirty.value = true;
  }

  // ─── 导出 ─────────────────────────────────────────────

  /**
   * 反向生成 PHP 文件映射（对齐 §3.4.4：configStore → 反向生成 PHP 代码）
   *
   * 仅 scatter_pool / poi_table / poi_pool 参与导出（对齐 §3.4.4 obl_config 不编辑边界案例）
   *
   * @returns 文件名 → PHP 内容字符串映射
   *   - 'scatter_pool.php'：散布池
   *   - 'poi_table.php'：POI 模板表
   *   - 'poi_pool.php'：POI 生成池
   */
  function toPhpFiles(): Record<string, string> {
    const files: Record<string, string> = {};
    if (scatterPool.value) {
      files[CONFIG_FILE_SCATTER_POOL] = generateConfigPhp(
        'scatter_pool',
        '野生散落道具池，按 tide 三档分桶（initial / refresh），rate 是基础率不折算',
        scatterPoolToCodegen(scatterPool.value),
      );
    }
    if (poiTable.value) {
      files[CONFIG_FILE_POI_TABLE] = generateConfigPhp(
        'poi_table',
        'POI 模板表（基本 + E-10 三档判定 + 机制型 + E-12 耐久 + 子列表）',
        poiTableToCodegen(poiTable.value),
      );
    }
    if (poiPool.value) {
      files[CONFIG_FILE_POI_POOL] = generateConfigPhp(
        'poi_pool',
        'POI 生成池，按 tide 三档分桶，每条含 poi_id + per_region',
        poiPoolToCodegen(poiPool.value),
      );
    }
    return files;
  }

  // ─── 重置 ─────────────────────────────────────────────

  /**
   * 重置配置缓存（清空所有 state）
   *
   * 对齐 §3.4.4：配置缓存仅保存在内存，不持久化到 localStorage。
   * oblConfig 派生自 graph-store，reset 时移除 graph-store 中的 config.runtime 节点。
   */
  function reset(): void {
    scatterPool.value = null;
    poiTable.value = null;
    poiPool.value = null;
    // 移除 graph-store 中的 config.runtime 节点（oblConfig 派生 computed 自动响应为 null）
    graph.removeNode('config.runtime:obl_config');
    isDirty.value = false;
  }

  /**
   * 标记已保存（外部保存成功后调用，清 dirty 标志）
   */
  function markSaved(): void {
    isDirty.value = false;
  }

  // ─── 兼容 M1 接口（保留旧 API 不破坏现有调用） ────────
  function clearAll(): void {
    reset();
  }

  return {
    // state
    scatterPool,
    poiTable,
    poiPool,
    oblConfig,
    isDirty,
    // getters
    hasConfig,
    poiIdOptions,
    // 加载
    loadFromPhpStrings,
    loadAll,
    setScatterPool,
    setPoiTable,
    setPoiPool,
    // scatter CRUD
    updateScatterEntry,
    addScatterEntry,
    removeScatterEntry,
    moveScatterEntry,
    // poi_table CRUD
    addPoiTemplate,
    updatePoiTemplate,
    removePoiTemplate,
    renamePoiTemplate,
    // poi_pool CRUD
    updatePoiPoolEntry,
    addPoiPoolEntry,
    removePoiPoolEntry,
    movePoiPoolEntry,
    // 导出
    toPhpFiles,
    // 重置
    reset,
    clearAll,
    markSaved,
  };
});
