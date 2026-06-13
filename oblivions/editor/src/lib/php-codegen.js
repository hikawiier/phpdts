// ══════════════════════════════════════════════════
// PHP 代码生成器 / PHP code generator
// 将 JS 对象转换为 PHP 数组代码
// ══════════════════════════════════════════════════

/**
 * 生成 map.php 内容
 */
export function generateMapPhp(regions, grids) {
  const header = `<?php\nif (!defined('IN_GAME')) { exit('Access Denied'); }\n\n`;
  const regionsCode = valueToPhp(regions, 0);
  const gridsCode = valueToPhp(grids, 0);

  return header +
    `// ================================================================\n` +
    `// Oblivions 地图数据 — 区域元数据 + 网格布局\n` +
    `// 地图格数据按区域拆分至 tiles/region_{pgroup}.php，按需加载\n` +
    `// 数据结构：regions[pgroup] + grids[pgroup]\n` +
    `// pls 范围 1-254，区域内局部索引，pls=0 保留不使用\n` +
    `// ================================================================\n\n` +
    `return [\n` +
    `    'regions' => ${regionsCode},\n` +
    `    'grids' => ${gridsCode},\n` +
    `];\n`;
}

/**
 * 生成 region_*.php 内容
 */
export function generateRegionPhp(pgroup, tiles) {
  const header = `<?php\nif (!defined('IN_GAME')) { exit('Access Denied'); }\n\n`;
  const regionName = tiles && Object.keys(tiles).length > 0 ? '区域数据' : '空区域';

  // 过滤编辑器专有字段（_breaks）
  const cleanTiles = stripEditorFields(tiles);

  return header +
    `// ================================================================\n` +
    `// Oblivions 地图格数据 — 区域 ${pgroup}：${regionName}\n` +
    `// pls 范围 1-254，区域内局部索引\n` +
    `// ================================================================\n\n` +
    `return ${valueToPhp(cleanTiles, 0)};\n`;
}

/**
 * 移除编辑器专有字段（_breaks 等）
 */
function stripEditorFields(tiles) {
  const result = {};
  for (const pls in tiles) {
    const { _breaks, ...rest } = tiles[pls];
    result[pls] = rest;
  }
  return result;
}

/**
 * 将 JS 值转为 PHP 代码
 */
function valueToPhp(val, indent) {
  if (val === null || val === undefined) return 'null';
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  if (typeof val === 'number') return String(val);
  if (typeof val === 'string') return stringToPhp(val);

  if (Array.isArray(val)) {
    return arrayToPhp(val, indent);
  }

  if (typeof val === 'object') {
    return objectToPhp(val, indent);
  }

  return 'null';
}

/**
 * 字符串转 PHP 字符串
 */
function stringToPhp(str) {
  const escaped = str.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return `'${escaped}'`;
}

/**
 * 索引数组转 PHP
 */
function arrayToPhp(arr, indent) {
  if (arr.length === 0) return '[]';

  const pad = '    '.repeat(indent + 1);
  const closePad = '    '.repeat(indent);
  const items = arr.map(item => `${pad}${valueToPhp(item, indent + 1)}`);
  return `[\n${items.join(',\n')}\n${closePad}]`;
}

/**
 * 关联数组（对象）转 PHP
 */
function objectToPhp(obj, indent) {
  const keys = Object.keys(obj);
  if (keys.length === 0) return '[]';

  const pad = '    '.repeat(indent + 1);
  const closePad = '    '.repeat(indent);

  const items = keys.map(key => {
    const phpKey = typeof key === 'number' ? key : stringToPhp(String(key));
    const phpVal = valueToPhp(obj[key], indent + 1);
    return `${pad}${phpKey} => ${phpVal}`;
  });

  return `[\n${items.join(',\n')}\n${closePad}]`;
}
