// @module O 内容工具箱
//
// useImportExport：导入导出 composable（对齐 editor-next-独立化与备份还原功能-设计案 + P1 执行案 §4.7）
//
// 封装 file-io / zip-bundle / worker-bridge 服务，对接 ImportModal / ExportModal
//
// 导入路径（纯本地静态数据源）：
//   1. importFromDirectory：File System Access API 目录选择（首选）/ webkitdirectory 回退
//   2. importFromPaste：手动粘贴多文件（用 \n---\n 分隔）
//   3. importFromDrop：拖拽导入（递归读取 webkitGetAsEntry）
//   4. restoreFromBackup：从 oblivions/gamedata/backup/{timestamp}/ 还原
//   5. importFromPresetPath：通过 vite /@fs/ fetch 读取 editor.config.json 预设路径（仅开发环境）
//
// 导出路径：
//   1. exportZip：ZIP 打包下载（全量文件：map+tiles+4 配置+rawFiles 缓存）
//   2. writeBackToSource：写入源 gamedata 目录（写入前自动备份旧文件为 ZIP 下载）
//   3. backupGamedata：把 gamedata 目录所有 .php 备份到 backup/{timestamp}/ 子目录
//
// P1-F 重构（对齐 §4.7）：
//   - isParsedFile 改为查 Schema 注册表（graphStore.isPathCoveredByGraph）+ configStore 覆盖判定
//     不再硬编码 map.php / tiles/region_*.php / obl_config.php 列表
//   - writeBackToSource 保留为 P1 过渡期的浏览器 FSAA 兼容路径，但 emit warning 提示
//     用户启用 Workspace Gateway 获得原子发布（备份 + 原子替换 + 外部修改冲突检测）
//   - collectAllExportFiles / exportZip 行为不变
//
// 字段过滤：导出时剥离 _breaks（由 php-codegen.stripEditorFields 实现）
// 旧 exit_links 格式自动迁移：由 php-array-parser.migrateExitLinks 实现
// Worker 后台解析：大地图（>10000 格）默认走 php-parser.worker

import { ref, computed } from 'vue';
import { useProjectStore } from '@/stores/projectStore';
import { useConfigStore } from '@/stores/configStore';
import { useRawFilesStore } from '@/stores/rawFilesStore';
import { useUiStore } from '@/stores/uiStore';
import { useGraphStore } from '@/graph/graph-store';
import {
  parseMapPhp,
  parseRegionPhp,
  extractPgroupFromFilename,
  assembleMapProject,
  generateProjectFiles,
  type MapProject,
  type Pgroup,
  type Pls,
  type Tile,
} from '@/shared';
import {
  pickDirectory,
  parsePastedText,
  readDroppedItems,
  readPhpFilesFromDirectory,
  writeTextFile,
  writeBackToSource as writeBackToSourceIO,
  formatBackupTimestamp,
  listSubDirectories,
  listZipFiles,
  type FileEntry,
  type DirectoryPicker,
} from '@/services/file-io';
import {
  bundleZip,
  downloadZip,
  generateExportFilename,
  unzipBundle,
} from '@/services/zip-bundle';
import {
  createPhpParserWorker,
  shouldUseWorker,
  type PhpParserBridge,
} from '@/services/worker-bridge';
import {
  CONFIG_FILE_SCATTER_POOL,
  CONFIG_FILE_POI_TABLE,
  CONFIG_FILE_POI_POOL,
  CONFIG_FILE_OBL_CONFIG,
} from '@/stores/configStore';
import {
  loadPresetConfig,
  toViteFsUrl,
  type PresetConfig,
} from '@/composables/usePresetConfig';

/**
 * 导入进度状态
 */
export interface ImportProgress {
  readonly stage: 'idle' | 'parsing' | 'assembling' | 'done' | 'error';
  readonly current: number;
  readonly total: number;
  readonly message: string;
  readonly error?: { message: string; line?: number; column?: number; expected?: string };
}

/**
 * 解析统计：用于 UI 展示 "已读取 N 个文件（M 个解析，K 个原始缓存）"
 */
export interface ParseStats {
  /** 总文件数 */
  readonly total: number;
  /** 已解析的文件数（map.php + tiles + 4 个配置） */
  readonly parsed: number;
  /** 原始缓存文件数 */
  readonly cached: number;
}

/**
 * parseFilesToProject 返回值：MapProject + 解析统计
 */
export interface ParseFilesResult {
  readonly project: MapProject | null;
  readonly stats: ParseStats;
}

const INITIAL_PROGRESS: ImportProgress = {
  stage: 'idle',
  current: 0,
  total: 0,
  message: '',
};

/**
 * 判断文件路径是否为 tiles/region_*.php
 */
function isRegionFile(path: string): boolean {
  return path.startsWith('tiles/region_') && path.endsWith('.php');
}

/**
 * 判断文件路径是否为编辑器解析的配置文件
 */
function isConfigFile(path: string): boolean {
  // 兼容根级和带路径前缀（如 gamedata/scatter_pool.php）
  const baseName = path.includes('/') ? path.substring(path.lastIndexOf('/') + 1) : path;
  return (
    baseName === CONFIG_FILE_SCATTER_POOL ||
    baseName === CONFIG_FILE_POI_TABLE ||
    baseName === CONFIG_FILE_POI_POOL ||
    baseName === CONFIG_FILE_OBL_CONFIG
  );
}

export function useImportExport() {
  const project = useProjectStore();
  const config = useConfigStore();
  const rawFilesStore = useRawFilesStore();
  const ui = useUiStore();
  const graphStore = useGraphStore();

  /**
   * 判断文件是否已被编辑器解析（不进入 rawFiles 缓存）
   *
   * P1-F 重构（对齐 §4.7.1）：改为查 Schema 注册表
   *   - map.php / tiles/region_*.php / obl_config.php 由 Resource Graph 覆盖
   *     （通过 graphStore.isPathCoveredByGraph 判断，遍历已注册 kind 的 sourceFiles 模板）
   *   - scatter_pool.php / poi_table.php / poi_pool.php 仍由 configStore 覆盖
   *   - 其余文件（combat_skills/*.php 等）走 rawFilesStore
   */
  function isParsedFile(path: string): boolean {
    if (graphStore.isPathCoveredByGraph(path)) return true;
    if (isConfigFile(path)) return true;
    return false;
  }

  // ─── state ────────────────────────────────────────────
  // sourceDirHandle 已移入 rawFilesStore（全局共享）
  const importProgress = ref<ImportProgress>({ ...INITIAL_PROGRESS });
  const lastImportedFiles = ref<FileEntry[]>([]);
  const isImporting = ref(false);
  const isExporting = ref(false);
  /** 备份目录句柄：listBackups 时缓存，restoreFromBackup 时复用 */
  const backupDirHandle = ref<FileSystemDirectoryHandle | null>(null);

  // ─── getters ──────────────────────────────────────────
  /** 源目录句柄（兼容旧接口，从 rawFilesStore 读取） */
  const sourceDirHandle = computed(() => rawFilesStore.sourceDirHandle);
  const canWriteBackToSource = computed(
    () => rawFilesStore.sourceDirHandle !== null && project.hasProject,
  );
  const canExport = computed(() => project.hasProject && !isExporting.value);

  let workerBridge: PhpParserBridge | null = null;

  // ─── internal helpers ────────────────────────────────

  /**
   * 解析 PHP 文件列表为 MapProject + 配置 + 原始缓存
   *
   * 处理流程：
   *   1. 提取 map.php + tiles/region_*.php → 走原 parseMapPhp + parseRegionPhp 逻辑
   *   2. 提取 scatter_pool/poi_table/poi_pool/obl_config → 调用 config.loadFromPhpStrings()
   *   3. 剩余文件 → rawFilesStore.setRawFiles()
   *   4. 返回 MapProject + 解析统计
   */
  async function parseFilesToProject(files: FileEntry[]): Promise<ParseFilesResult> {
    const mapFile = files.find((f) => f.path === 'map.php' || f.path.endsWith('/map.php'));
    if (!mapFile) {
      throw new Error('未找到 map.php，请确保选择了包含 map.php 的 gamedata 目录');
    }

    // 计算总格数估算（用文件总大小作为代理指标，更精确需要先解析 map.php）
    const totalSize = files.reduce((sum, f) => sum + f.content.length, 0);
    const useWorker = shouldUseWorker(totalSize);

    // 1. 解析 map.php（主线程解析，map.php 通常较小）
    importProgress.value = {
      stage: 'parsing',
      current: 0,
      total: files.length,
      message: useWorker ? 'Worker 解析区域文件...' : '主线程解析 map.php...',
    };

    const map = parseMapPhp(mapFile.content);
    if (!map) {
      throw new Error('map.php 解析失败：未找到 regions/grids');
    }

    // 2. 解析 tiles/region_*.php
    const regionFiles = files.filter((f) => isRegionFile(f.path));
    const regionResults: Array<{ pgroup: Pgroup; tiles: Record<Pls, Tile> }> = [];

    // 大地图走 Worker
    if (useWorker && regionFiles.length > 0) {
      try {
        if (!workerBridge) {
          workerBridge = await createPhpParserWorker();
        }
        importProgress.value = {
          stage: 'parsing',
          current: 1,
          total: regionFiles.length + 1,
          message: `Worker 解析 ${regionFiles.length} 个区域文件...`,
        };
        const results = await workerBridge.parseFiles(regionFiles);
        for (const file of regionFiles) {
          const pgroup = extractPgroupFromFilename(file.path);
          if (pgroup === null) continue;
          const result = results[file.path];
          if (!result || !result.ok || !result.value) continue;
          const regionData = parseRegionPhp(file.content, pgroup);
          if (regionData) {
            regionResults.push({ pgroup, tiles: regionData.tiles });
          }
          importProgress.value = {
            stage: 'parsing',
            current: importProgress.value.current + 1,
            total: importProgress.value.total,
            message: `Worker 解析区域 ${pgroup}...`,
          };
        }
      } catch {
        // Worker 失败回退主线程
        importProgress.value = {
          stage: 'parsing',
          current: 0,
          total: regionFiles.length + 1,
          message: 'Worker 失败，回退主线程解析...',
        };
        for (const file of regionFiles) {
          const pgroup = extractPgroupFromFilename(file.path);
          if (pgroup === null) continue;
          const regionData = parseRegionPhp(file.content, pgroup);
          if (regionData) {
            regionResults.push({ pgroup, tiles: regionData.tiles });
          }
        }
      }
    } else {
      // 小地图走主线程
      for (let i = 0; i < regionFiles.length; i++) {
        const file = regionFiles[i]!;
        const pgroup = extractPgroupFromFilename(file.path);
        if (pgroup === null) continue;
        const regionData = parseRegionPhp(file.content, pgroup);
        if (regionData) {
          regionResults.push({ pgroup, tiles: regionData.tiles });
        }
        importProgress.value = {
          stage: 'parsing',
          current: i + 1,
          total: regionFiles.length + 1,
          message: `主线程解析区域 ${pgroup}...`,
        };
      }
    }

    // 3. 解析配置文件 → configStore
    const configFiles: Record<string, string> = {};
    for (const f of files) {
      if (isConfigFile(f.path)) {
        configFiles[f.path] = f.content;
      }
    }
    if (Object.keys(configFiles).length > 0) {
      config.loadFromPhpStrings(configFiles);
    }

    // 4. 缓存未支持的文件 → rawFilesStore（不缓存已被编辑器解析的文件）
    const rawFiles: Record<string, string> = {};
    for (const f of files) {
      if (!isParsedFile(f.path)) {
        rawFiles[f.path] = f.content;
      }
    }
    rawFilesStore.setRawFiles(rawFiles);

    // 5. 组装 MapProject（exit_links 迁移在 parseMapPhp/parseRegionPhp 内部完成）
    importProgress.value = {
      stage: 'assembling',
      current: files.length,
      total: files.length,
      message: '组装 MapProject...',
    };
    const mapProject = assembleMapProject(map, regionResults);

    // 6. 计算统计
    const parsedCount = 1 + regionFiles.length + Object.keys(configFiles).length;
    const cachedCount = Object.keys(rawFiles).length;
    const stats: ParseStats = {
      total: files.length,
      parsed: parsedCount,
      cached: cachedCount,
    };

    return { project: mapProject, stats };
  }

  /**
   * 完成导入：填充 projectStore + 配置源句柄 + 提示用户
   */
  function finishImport(result: ParseFilesResult | null, dirHandle: DirectoryPicker['handle']): void {
    if (!result || !result.project || Object.keys(result.project.regions).length === 0) {
      importProgress.value = {
        stage: 'error',
        current: 0,
        total: 0,
        message: '未找到有效的 map.php 数据',
        error: { message: '未找到有效的 map.php 数据。请确保选择了包含 map.php 的 gamedata 目录。' },
      };
      return;
    }
    const mapProject = result.project;
    project.loadProject(mapProject);
    rawFilesStore.setSourceDirHandle(dirHandle);
    importProgress.value = {
      stage: 'done',
      current: importProgress.value.total,
      total: importProgress.value.total,
      message: '导入完成',
    };
    const { stats } = result;
    ui.showToast(
      `导入成功：${Object.keys(mapProject.regions).length} 个区域（${stats.total} 文件：${stats.parsed} 解析 + ${stats.cached} 缓存）`,
      'success',
    );
  }

  // ─── 生成全量导出文件列表（编辑器生成的 + 配置 + 原始缓存） ───

  /**
   * 汇总所有应导出的文件（编辑器生成的 + 配置 + rawFiles 缓存）
   *
   * 用于 exportZip / writeBackToSource，确保 round-trip 一致性
   */
  function collectAllExportFiles(): Record<string, string> {
    const files: Record<string, string> = {};
    // 1. 编辑器生成的 map.php + tiles/region_*.php
    if (project.project) {
      Object.assign(files, generateProjectFiles(project.project));
    }
    // 2. 配置文件（scatter_pool / poi_table / poi_pool，不含 obl_config 因为只读）
    const configFiles = config.toPhpFiles();
    Object.assign(files, configFiles);
    // 3. 原始缓存（obl_config + 11 个未支持 + combat_skills/* 等）
    Object.assign(files, rawFilesStore.getAllFiles());
    return files;
  }

  // ─── actions ──────────────────────────────────────────

  /**
   * 从目录导入：File System Access API 首选，webkitdirectory 回退
   */
  async function importFromDirectory(): Promise<void> {
    if (isImporting.value) return;
    isImporting.value = true;
    importProgress.value = { ...INITIAL_PROGRESS, stage: 'parsing', message: '选择目录...' };
    try {
      const picker = await pickDirectory('readwrite');
      if (!picker) {
        importProgress.value = { ...INITIAL_PROGRESS };
        return;
      }
      lastImportedFiles.value = picker.files;
      const result = await parseFilesToProject(picker.files);
      finishImport(result, picker.handle);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      importProgress.value = {
        stage: 'error',
        current: 0,
        total: 0,
        message,
        error: { message },
      };
      ui.showToast(`导入失败：${message}`, 'error');
    } finally {
      isImporting.value = false;
    }
  }

  /**
   * 从手动粘贴导入：多文件用 \n---\n 分隔
   *
   * @param text 用户粘贴的文本
   * @param filenames 可选文件名列表（与文本分段一一对应）
   */
  async function importFromPaste(text: string, filenames?: string[]): Promise<void> {
    if (isImporting.value) return;
    isImporting.value = true;
    importProgress.value = { ...INITIAL_PROGRESS, stage: 'parsing', message: '解析粘贴文本...' };
    try {
      const files = await parsePastedText(text, filenames);
      if (files.length === 0) {
        importProgress.value = { ...INITIAL_PROGRESS };
        return;
      }
      lastImportedFiles.value = files;
      // 粘贴导入无法获得写句柄
      const result = await parseFilesToProject(files);
      finishImport(result, null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      importProgress.value = {
        stage: 'error',
        current: 0,
        total: 0,
        message,
        error: { message },
      };
      ui.showToast(`导入失败：${message}`, 'error');
    } finally {
      isImporting.value = false;
    }
  }

  /**
   * 从拖拽数据导入
   */
  async function importFromDrop(dataTransfer: DataTransfer): Promise<void> {
    if (isImporting.value) return;
    isImporting.value = true;
    importProgress.value = { ...INITIAL_PROGRESS, stage: 'parsing', message: '读取拖拽数据...' };
    try {
      const files = await readDroppedItems(dataTransfer);
      if (files.length === 0) {
        importProgress.value = { ...INITIAL_PROGRESS };
        return;
      }
      lastImportedFiles.value = files;
      // 拖拽导入无法获得写句柄
      const result = await parseFilesToProject(files);
      finishImport(result, null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      importProgress.value = {
        stage: 'error',
        current: 0,
        total: 0,
        message,
        error: { message },
      };
      ui.showToast(`导入失败：${message}`, 'error');
    } finally {
      isImporting.value = false;
    }
  }

  // ─── 预设路径导入（开发环境：通过 vite /@fs/ fetch 读取本地文件） ───

  /**
   * 预设路径已知的根级配置文件列表（除 map.php 和 tiles/region_*.php）
   *
   * fetch 时单个文件 404 不影响整体流程（仅跳过该文件）
   */
  const PRESET_ROOT_CONFIG_FILES: readonly string[] = [
    CONFIG_FILE_SCATTER_POOL,
    CONFIG_FILE_POI_TABLE,
    CONFIG_FILE_POI_POOL,
    CONFIG_FILE_OBL_CONFIG,
    'combat_skill_config.php',
    'enemies_config.php',
    'enemy_pool.php',
    // P3：gift_box_loot 已合并到 loot_tables.php，原文件已删除
    'item_table.php',
    'loot_tables.php',
    'poi_interactions.php',
    // P3：poi_loot.php 为孤儿文件（运行时零消费），已归档到 oblivions/docs/归档/
    'recipe_table.php',
    'skill_definition_config.php',
  ];

  /**
   * combat_skills/ 目录下已知的技能文件列表
   *
   * vite dev server 不支持目录列表，需硬编码文件名
   * 与 oblivions/gamedata/combat_skills/ 实际文件保持同步
   */
  const PRESET_COMBAT_SKILL_FILES: readonly string[] = [
    'skill_escape.php',
    'skill_execute.php',
    'skill_grenade.php',
    'skill_heal.php',
    'skill_move.php',
    'skill_throw.php',
    'skill_unarmed_strike.php',
    'skill_vampiric_bite.php',
    'skill_whirlwind.php',
  ];

  /**
   * 通过 vite /@fs/ fetch 单个文件，返回 FileEntry 或 null（404 / 网络错误）
   *
   * @param gamedataPath gamedata 目录绝对路径
   * @param relativePath 相对路径（如 'map.php' / 'tiles/region_1.php' / 'combat_skills/skill_move.php'）
   */
  async function fetchPresetFile(
    gamedataPath: string,
    relativePath: string,
  ): Promise<FileEntry | null> {
    const url = toViteFsUrl(`${gamedataPath}/${relativePath}`);
    try {
      const resp = await fetch(url);
      if (!resp.ok) return null;
      const content = await resp.text();
      if (!content) return null;
      return { path: relativePath, content };
    } catch {
      // vite dev server 不可达 / 跨域 / 文件不存在
      return null;
    }
  }

  /**
   * 从预设路径导入：通过 vite /@fs/ fetch 读取 gamedata 目录所有 .php 文件
   *
   * 行为：
   *   1. 读取 editor.config.json 获取 gamedataPath
   *   2. fetch map.php → 解析得到 regions keys（pgroups 列表）
   *   3. 并发 fetch tiles/region_{pgroup}.php + 根级配置文件 + combat_skills/*.php
   *   4. 单个文件 fetch 失败静默跳过（除 map.php 必须）
   *   5. 调用 parseFilesToProject + finishImport 完成导入
   *
   * 限制：
   *   - 仅 vite dev server 可用（生产构建无 /@fs/ 路由）
   *   - 无 dirHandle（无法直接写回源目录，导出仍需 FSAA 选目录）
   *   - server.fs.allow 必须包含 gamedataPath（见 vite.config.ts）
   *
   * @param preset 可选预设配置（外部已加载时传入，避免重复 fetch editor.config.json）
   */
  async function importFromPresetPath(preset?: PresetConfig | null): Promise<void> {
    if (isImporting.value) return;
    isImporting.value = true;
    importProgress.value = {
      ...INITIAL_PROGRESS,
      stage: 'parsing',
      message: '读取预设配置...',
    };
    try {
      // 1. 获取预设配置
      const config = preset ?? (await loadPresetConfig());
      if (!config || !config.gamedataPath) {
        const msg = '未找到预设路径配置（editor.config.json）';
        importProgress.value = {
          stage: 'error',
          current: 0,
          total: 0,
          message: msg,
          error: { message: msg },
        };
        ui.showToast(msg, 'error');
        return;
      }
      const gamedataPath = config.gamedataPath;

      // 2. fetch map.php（必需，缺失则中止）
      importProgress.value = {
        ...INITIAL_PROGRESS,
        stage: 'parsing',
        current: 0,
        total: 1,
        message: `fetch map.php...`,
      };
      const mapFile = await fetchPresetFile(gamedataPath, 'map.php');
      if (!mapFile) {
        const msg = `预设路径下未找到 map.php：${gamedataPath}/map.php`;
        importProgress.value = {
          stage: 'error',
          current: 0,
          total: 0,
          message: msg,
          error: { message: msg },
        };
        ui.showToast(msg, 'error');
        return;
      }

      // 3. 解析 map.php 得到 regions keys（用于确定 tiles/region_*.php 列表）
      const mapParse = parseMapPhp(mapFile.content);
      if (!mapParse) {
        const msg = 'map.php 解析失败：未找到 regions/grids';
        importProgress.value = {
          stage: 'error',
          current: 0,
          total: 0,
          message: msg,
          error: { message: msg },
        };
        ui.showToast(msg, 'error');
        return;
      }
      const pgroups = Object.keys(mapParse.regions);

      // 4. 构造 fetch 任务列表：tiles/region_{pgroup}.php + 根级配置 + combat_skills/*.php
      const relativePaths: string[] = [];
      for (const pgroup of pgroups) {
        relativePaths.push(`tiles/region_${pgroup}.php`);
      }
      for (const file of PRESET_ROOT_CONFIG_FILES) {
        relativePaths.push(file);
      }
      for (const file of PRESET_COMBAT_SKILL_FILES) {
        relativePaths.push(`combat_skills/${file}`);
      }

      // 5. 并发 fetch 所有文件（map.php 已读取，单独放入结果）
      importProgress.value = {
        ...INITIAL_PROGRESS,
        stage: 'parsing',
        current: 1,
        total: relativePaths.length + 1,
        message: `fetch ${relativePaths.length} 个文件...`,
      };
      const fetchResults = await Promise.all(
        relativePaths.map((p) => fetchPresetFile(gamedataPath, p)),
      );

      // 6. 汇总成功读取的文件
      const files: FileEntry[] = [mapFile];
      let fetchedCount = 1;
      for (const entry of fetchResults) {
        if (entry) {
          files.push(entry);
          fetchedCount++;
        }
      }
      importProgress.value = {
        ...INITIAL_PROGRESS,
        stage: 'parsing',
        current: fetchedCount,
        total: relativePaths.length + 1,
        message: `已读取 ${fetchedCount} 个文件，开始解析...`,
      };

      // 7. 调用现有解析流程完成导入（预设路径无法获得 dirHandle）
      lastImportedFiles.value = files;
      const result = await parseFilesToProject(files);
      finishImport(result, null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      importProgress.value = {
        stage: 'error',
        current: 0,
        total: 0,
        message,
        error: { message },
      };
      ui.showToast(`预设路径导入失败：${message}`, 'error');
    } finally {
      isImporting.value = false;
    }
  }

  /**
   * 导出 ZIP：打包所有文件（map + tiles + 配置 + 原始缓存）为 ZIP 下载
   */
  async function exportZip(): Promise<void> {
    if (isExporting.value) return;
    if (!project.project) {
      ui.showToast('没有可导出的项目', 'error');
      return;
    }
    isExporting.value = true;
    try {
      const files = collectAllExportFiles();
      const entries: FileEntry[] = Object.entries(files).map(([path, content]) => ({
        path,
        content,
      }));
      const blob = await bundleZip(entries);
      const filename = generateExportFilename();
      await downloadZip(blob, filename);
      project.markSaved();
      ui.showToast(`已导出 ${filename}（${entries.length} 个文件）`, 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ui.showToast(`导出失败：${message}`, 'error');
    } finally {
      isExporting.value = false;
    }
  }

  /**
   * 写入源 gamedata 目录：备份旧文件为 ZIP 下载，再覆盖写入全部文件
   *
   * 行为：
   *   - 如果有 sourceDirHandle（FSAA 导入后可用）→ 直接写回
   *   - 如果没有 sourceDirHandle → 提示用户选择目录（pickDirectory('readwrite')）
   *   - 写入范围：map.php + tiles + scatter_pool + poi_table + poi_pool + rawFiles 全部
   *   - 写入前自动备份旧文件为 oblivions_backup_<timestamp>.zip 下载
   *
   * P1-F（对齐 §4.7.2）：保留为过渡期浏览器 FSAA 兼容路径
   *   - 不支持原子发布（部分写入风险）与外部修改冲突检测
   *   - emit warning 提示用户启用 Workspace Gateway 获得原子发布能力
   *   - 完整原子发布路径（备份 + 原子替换 + 冲突检测）由 O-5 atomic-publisher 实现，
   *     通过 gatewayClient.publishFiles 触发——P1-G BuildView 阶段接入
   */
  async function writeBackToSource(): Promise<void> {
    if (isExporting.value) return;
    if (!project.project) {
      ui.showToast('没有可导出的项目', 'error');
      return;
    }
    // 优先用 rawFilesStore.sourceDirHandle，否则让用户选择目录
    let handle = rawFilesStore.sourceDirHandle;
    if (!handle) {
      try {
        const picker = await pickDirectory('readwrite');
        if (!picker || !picker.handle) {
          // 用户取消选择 → 静默退出（不弹任何 toast）
          return;
        }
        handle = picker.handle;
        rawFilesStore.setSourceDirHandle(handle);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ui.showToast(`选择目录失败：${message}`, 'error');
        return;
      }
    }
    // P1-F：FSAA 路径不支持原子发布，提示用户启用 Gateway
    // 仅在确定要执行写入时弹出（用户取消 pickDirectory 时静默退出，不弹此 warning）
    ui.showToast(
      '当前为浏览器 FSAA 写入路径，不支持原子发布与冲突检测；建议启用 Workspace Gateway 获得原子发布能力',
      'info',
    );
    isExporting.value = true;
    try {
      const files = collectAllExportFiles();
      const entries: FileEntry[] = Object.entries(files).map(([path, content]) => ({
        path,
        content,
      }));

      // 备份旧文件 + 写入新文件
      await writeBackToSourceIO(handle, entries, {
        backupOldFiles: true,
        onBackup: async (backupEntries) => {
          if (backupEntries.length === 0) return;
          const blob = await bundleZip(backupEntries);
          const filename = generateExportFilename('oblivions_backup');
          await downloadZip(blob, filename);
        },
      });
      project.markSaved();
      ui.showToast(`已写入 ${entries.length} 个文件，旧文件已备份下载`, 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ui.showToast(`写回失败：${message}`, 'error');
    } finally {
      isExporting.value = false;
    }
  }

  /**
   * 备份 gamedata 目录：把所有 .php 文件复制到 backup/{timestamp}/ 子目录
   *
   * 行为：
   *   1. 选择 gamedata 源目录（只读）
   *   2. 选择 backup 目标目录（读写，建议为 oblivions/gamedata/backup/）
   *   3. 创建时间戳子目录 YYYYMMDD_HHMMSS
   *   4. 读取源目录所有 .php 文件 → 写入到 backup/{timestamp}/（保持目录结构）
   */
  async function backupGamedata(): Promise<void> {
    if (isExporting.value) return;
    isExporting.value = true;
    try {
      // 1. 选择 gamedata 源目录（只读）
      const sourcePicker = await pickDirectory('read');
      if (!sourcePicker || !sourcePicker.handle) {
        return;
      }

      // 2. 选择 backup 目标目录（读写）
      const backupPicker = await pickDirectory('readwrite');
      if (!backupPicker || !backupPicker.handle) {
        return;
      }

      // 3. 创建时间戳子目录
      const timestamp = formatBackupTimestamp(new Date());
      const backupDirHandle = await backupPicker.handle.getDirectoryHandle(timestamp, {
        create: true,
      });

      // 4. 读取源目录所有 .php 文件（已支持递归子目录）
      const files = await readPhpFilesFromDirectory(sourcePicker.handle, '');

      // 5. 写入到备份子目录（保持目录结构，复用 writeTextFile）
      for (const file of files) {
        await writeTextFile(backupDirHandle, file.path, file.content);
      }

      ui.showToast(`已备份 ${files.length} 个文件到 backup/${timestamp}/`, 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ui.showToast(`备份失败：${message}`, 'error');
    } finally {
      isExporting.value = false;
    }
  }

  /**
   * 列出备份目录下所有备份（时间戳子目录 + 后端 ZIP 文件，按名称降序）
   *
   * 用于 ImportModal restore Tab：用户选择备份目录后，本函数返回可选备份列表
   *
   * @returns 备份名称数组（按名称降序，最新在前）+ 备份目录句柄（用于后续 restoreFromBackup 复用）
   */
  async function listBackups(): Promise<{ backups: string[]; handle: FileSystemDirectoryHandle } | null> {
    try {
      const picker = await pickDirectory('read');
      if (!picker || !picker.handle) {
        return null;
      }
      const handle = picker.handle;
      // 同时列出子目录（编辑器生成的备份）和 .zip 文件（后端生成的备份）
      const [subDirs, zipFiles] = await Promise.all([
        listSubDirectories(handle),
        listZipFiles(handle),
      ]);
      // 合并并按名称降序排列（最新在前）
      const backups = [...subDirs, ...zipFiles].sort((a, b) => b.localeCompare(a));
      if (backups.length === 0) {
        ui.showToast('未找到备份', 'error');
        return null;
      }
      // 缓存 handle 供 restoreFromBackup 复用
      backupDirHandle.value = handle;
      return { backups, handle };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ui.showToast(`列出备份失败：${message}`, 'error');
      return null;
    }
  }

  /**
   * 从备份还原：选择目标 gamedata 目录 → 还原前自动备份当前状态 → 复制备份文件 → 导入编辑器
   *
   * @param selectedTimestamp 选定备份名称（时间戳子目录名或 .zip 文件名）
   *
   * 行为：
   *   1. 选择目标 gamedata 目录（读写）
   *   2. 还原前自动备份当前 gamedata 状态（提示用户选源+目标，复用 backupGamedata 流程）
   *   3. 从备份读取所有文件（子目录 → readPhpFilesFromDirectory / .zip → unzipBundle）
   *   4. 写入到目标 gamedata 目录（保持目录结构）
   *   5. 同时导入到编辑器（用户可立即查看还原结果）
   */
  async function restoreFromBackup(selectedTimestamp: string): Promise<void> {
    if (isImporting.value) return;
    const backupHandle = backupDirHandle.value;
    if (!backupHandle) {
      ui.showToast('请先选择备份目录', 'error');
      return;
    }
    isImporting.value = true;
    importProgress.value = { ...INITIAL_PROGRESS, stage: 'parsing', message: '准备还原...' };
    try {
      // 1. 选择目标 gamedata 目录（读写）
      const targetPicker = await pickDirectory('readwrite');
      if (!targetPicker || !targetPicker.handle) {
        importProgress.value = { ...INITIAL_PROGRESS };
        return;
      }
      const targetHandle = targetPicker.handle;

      // 2. 还原前自动备份当前 gamedata 状态（提示用户先备份）
      ui.showToast('还原前请先备份当前 gamedata 状态（即将弹出备份流程）', 'info');
      await backupGamedata();

      // 3. 从备份读取所有文件
      importProgress.value = {
        stage: 'parsing',
        current: 0,
        total: 0,
        message: `读取备份 ${selectedTimestamp}...`,
      };
      let files: FileEntry[] = [];
      const isZip = selectedTimestamp.endsWith('.zip');
      if (isZip) {
        // 后端生成的 ZIP 备份
        const fileHandle = await backupHandle.getFileHandle(selectedTimestamp);
        const file = await fileHandle.getFile();
        const buffer = await file.arrayBuffer();
        const blob = new Blob([buffer]);
        files = await unzipBundle(blob);
      } else {
        // 编辑器生成的时间戳子目录
        const subDirHandle = await backupHandle.getDirectoryHandle(selectedTimestamp);
        files = await readPhpFilesFromDirectory(subDirHandle, '');
      }

      if (files.length === 0) {
        ui.showToast('备份中没有 .php 文件', 'error');
        importProgress.value = { ...INITIAL_PROGRESS };
        return;
      }

      // 4. 写入到目标 gamedata 目录（保持目录结构）
      importProgress.value = {
        stage: 'parsing',
        current: 0,
        total: files.length,
        message: `还原 ${files.length} 个文件...`,
      };
      for (let i = 0; i < files.length; i++) {
        const file = files[i]!;
        await writeTextFile(targetHandle, file.path, file.content);
        importProgress.value = {
          stage: 'parsing',
          current: i + 1,
          total: files.length,
          message: `写入 ${file.path}...`,
        };
      }

      // 5. 同时导入到编辑器（用户可立即查看还原结果）
      const result = await parseFilesToProject(files);
      finishImport(result, targetHandle);

      ui.showToast(`已从 ${selectedTimestamp} 还原 ${files.length} 个文件`, 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      importProgress.value = {
        stage: 'error',
        current: 0,
        total: 0,
        message,
        error: { message },
      };
      ui.showToast(`还原失败：${message}`, 'error');
    } finally {
      isImporting.value = false;
    }
  }

  /**
   * 重置导入进度
   */
  function resetProgress(): void {
    importProgress.value = { ...INITIAL_PROGRESS };
  }

  /**
   * 销毁 composable 时清理 Worker
   */
  function dispose(): void {
    if (workerBridge) {
      workerBridge.terminate();
      workerBridge = null;
    }
  }

  return {
    // state
    sourceDirHandle,
    importProgress,
    lastImportedFiles,
    isImporting,
    isExporting,
    // getters
    canWriteBackToSource,
    canExport,
    // actions
    importFromDirectory,
    importFromPaste,
    importFromDrop,
    importFromPresetPath,
    exportZip,
    writeBackToSource,
    backupGamedata,
    listBackups,
    restoreFromBackup,
    // 通用
    resetProgress,
    dispose,
  };
}
