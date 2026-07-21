//
// PHP 代码生成器（移植自 oblivions/editor/src/lib/php-codegen.js，加 TS 类型）
//
// 将 TS 对象转换为 PHP 数组代码（4 空格缩进、单引号字符串、'key' => value 形式）
// 文件头注入：
//   - <?php if (!defined('IN_GAME')) { exit('Access Denied'); }
//   - @module E 游戏逻辑 标签（对齐 NEW_DESIGN.md §3.2.2）
// 字段过滤：导出 region_*.php 时剥离编辑器专用字段 _breaks（保留 height / destructible / preset_safe）
// pgroup key 类型转换：TS number key 经 Object.keys 转为字符串后，codegen 输出为数字 key（不加引号）

import type { MapProject, Pgroup, Pls, Tile, Region, Grid } from '../types/map';

/**
 * 序列化目标 TS 值类型
 */
export type CodegenValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | CodegenValue[]
  | { [key: string]: CodegenValue };

/**
 * 标准文件头（含 @module E 游戏逻辑 标签，对齐 NEW_DESIGN.md §3.2.2）
 *
 * 注：@module E 标签用于后端工具识别该文件属于游戏逻辑模块
 */
const PHP_FILE_HEADER = `<?php\nif (!defined('IN_GAME')) { exit('Access Denied'); }\n// @module E 游戏逻辑\n\n`;

/**
 * 生成 map.php 内容
 */
export function generateMapPhp(
  regions: Record<Pgroup, Region>,
  grids: Record<Pgroup, Grid>,
): string {
  const regionsCode = valueToPhp(regions as unknown as CodegenValue, 0);
  const gridsCode = valueToPhp(grids as unknown as CodegenValue, 0);

  return (
    PHP_FILE_HEADER +
    `// ================================================================\n` +
    `// Oblivions 地图数据 — 区域元数据 + 网格布局\n` +
    `// 地图格数据按区域拆分至 tiles/region_{pgroup}.php，按需加载\n` +
    `// 数据结构：regions[pgroup] + grids[pgroup]\n` +
    `// pls 范围 1-254，区域内局部索引，pls=0 保留不使用\n` +
    `// ================================================================\n\n` +
    `return [\n` +
    `    'regions' => ${regionsCode},\n` +
    `    'grids' => ${gridsCode},\n` +
    `];\n`
  );
}

/**
 * 生成 region_*.php 内容
 *
 * 自动剥离编辑器专有字段 _breaks
 */
export function generateRegionPhp(
  pgroup: Pgroup,
  tiles: Record<Pls, Tile>,
): string {
  const regionName = tiles && Object.keys(tiles).length > 0 ? '区域数据' : '空区域';

  // 过滤编辑器专有字段（_breaks）
  const cleanTiles = stripEditorFields(tiles);

  return (
    PHP_FILE_HEADER +
    `// ================================================================\n` +
    `// Oblivions 地图格数据 — 区域 ${pgroup}：${regionName}\n` +
    `// pls 范围 1-254，区域内局部索引\n` +
    `// ================================================================\n\n` +
    `return ${valueToPhp(cleanTiles as unknown as CodegenValue, 0)};\n`
  );
}

/**
 * 生成配置文件 PHP 内容（scatter_pool / poi_table / poi_pool 通用）
 */
export function generateConfigPhp(
  name: string,
  description: string,
  data: CodegenValue,
): string {
  return (
    PHP_FILE_HEADER +
    `// ================================================================\n` +
    `// Oblivions 配置文件 — ${name}\n` +
    `// ${description}\n` +
    `// ================================================================\n\n` +
    `return ${valueToPhp(data, 0)};\n`
  );
}

/**
 * 移除编辑器专有字段（_breaks 等）
 *
 * 保留所有后端字段（含 height / destructible / preset_safe / neighbors）
 */
export function stripEditorFields(
  tiles: Record<Pls, Tile>,
): Record<Pls, Omit<Tile, '_breaks'>> {
  const result: Record<Pls, Omit<Tile, '_breaks'>> = {} as Record<
    Pls,
    Omit<Tile, '_breaks'>
  >;
  for (const plsStr of Object.keys(tiles)) {
    const pls = Number(plsStr) as Pls;
    const tile = tiles[pls];
    if (!tile) continue;
    // 解构剥离 _breaks，保留其余字段
    const { _breaks: _breaksIgnored, ...rest } = tile;
    void _breaksIgnored;
    result[pls] = rest as Omit<Tile, '_breaks'>;
  }
  return result;
}

/**
 * 将 TS 值转为 PHP 代码
 */
export function valueToPhp(val: CodegenValue, indent: number): string {
  if (val === null || val === undefined) return 'null';
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  if (typeof val === 'number') return String(val);
  if (typeof val === 'string') return stringToPhp(val);

  if (Array.isArray(val)) {
    return arrayToPhp(val, indent);
  }

  if (typeof val === 'object') {
    return objectToPhp(val as { [key: string]: CodegenValue }, indent);
  }

  return 'null';
}

/**
 * 字符串转 PHP 单引号字符串
 */
function stringToPhp(str: string): string {
  const escaped = str.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return `'${escaped}'`;
}

/**
 * 索引数组转 PHP
 */
function arrayToPhp(arr: CodegenValue[], indent: number): string {
  if (arr.length === 0) return '[]';

  const pad = '    '.repeat(indent + 1);
  const closePad = '    '.repeat(indent);
  const items = arr.map((item) => `${pad}${valueToPhp(item, indent + 1)}`);
  return `[\n${items.join(',\n')}\n${closePad}]`;
}

/**
 * 关联数组（对象）转 PHP
 *
 * pgroup / pls 在 TS 中是 number key，Object.keys 返回字符串后，
 * 数字字符串 key 直接输出为数字（不加引号），其他字符串 key 输出为单引号字符串
 */
function objectToPhp(obj: { [key: string]: CodegenValue }, indent: number): string {
  const keys = Object.keys(obj);
  if (keys.length === 0) return '[]';

  const pad = '    '.repeat(indent + 1);
  const closePad = '    '.repeat(indent);

  const items = keys.map((key) => {
    // 数字字符串 key 直接用数字（不加引号），否则用单引号字符串
    const phpKey = /^\d+$/.test(key) ? key : stringToPhp(key);
    const phpVal = valueToPhp(obj[key]!, indent + 1);
    return `${pad}${phpKey} => ${phpVal}`;
  });

  return `[\n${items.join(',\n')}\n${closePad}]`;
}

/**
 * 将整个 MapProject 序列化为 map.php + 所有 region_*.php 文件映射
 *
 * @param project 地图项目
 * @returns 文件名 → 内容 的映射（key=map.php 或 tiles/region_{pgroup}.php）
 */
export function generateProjectFiles(project: MapProject): Record<string, string> {
  const files: Record<string, string> = {};
  files['map.php'] = generateMapPhp(project.regions, project.grids);
  for (const pgroupStr of Object.keys(project.tiles)) {
    const pgroup = Number(pgroupStr) as Pgroup;
    const tiles = project.tiles[pgroup];
    if (tiles === undefined) continue;
    files[`tiles/region_${pgroup}.php`] = generateRegionPhp(pgroup, tiles);
  }
  return files;
}
