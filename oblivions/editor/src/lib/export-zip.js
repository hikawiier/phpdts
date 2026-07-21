// ══════════════════════════════════════════════════
// ZIP 导出 / ZIP export
// ══════════════════════════════════════════════════
// @module O
// @framework O-4 编辑器守卫与后端对接
//
// AI 约束：禁止 AI 使用导出 ZIP 功能操作编辑器，只允许在连接后端的情况下备份、导出到后端。
//   - exportZip() 入口强制检查 state.backend.connected，未连接抛错
//   - 备份功能（子项1.2）使用独立的 backupBackendZip() 路径，不受此约束
//   - 保存到后端（handleSaveConfig 内部调用 saveAllConfigs）走 command.php，不经此路径

import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { generateMapPhp, generateRegionPhp } from './php-codegen.js';
import state from '../state.js';

/**
 * 导出项目数据为 ZIP 文件
 *
 * AI 约束：禁止 AI 使用导出 ZIP 功能操作编辑器，只允许在连接后端的情况下备份、导出到后端。
 * 未连接后端时调用本函数抛错，阻止自动化导出。
 *
 * @param {Object} project  项目数据（regions / grids / tiles）
 * @throws {Error} 未连接后端时抛错"导出 ZIP 需先连接后端（AI 约束）"
 */
export async function exportZip(project) {
  // AI 约束守卫：未连接后端禁止导出 ZIP
  if (!state.backend.connected) {
    throw new Error('导出 ZIP 需先连接后端（AI 约束）');
  }

  const zip = new JSZip();

  // 生成 map.php
  const mapPhp = generateMapPhp(project.regions, project.grids);
  zip.file('map.php', mapPhp);

  // 生成各区域的 region_*.php
  const tilesFolder = zip.folder('tiles');
  for (const pgroup in project.tiles) {
    const regionPhp = generateRegionPhp(parseInt(pgroup), project.tiles[pgroup]);
    tilesFolder.file(`region_${pgroup}.php`, regionPhp);
  }

  // 生成并下载
  const blob = await zip.generateAsync({ type: 'blob' });
  saveAs(blob, 'oblivions_gamedata.zip');
}

/**
 * 备份后端数据为 ZIP 文件下载到用户本地
 *
 * 与 exportZip() 不同：备份走独立的 backend.* API 路径，复用 dumpBackend()
 * 返回的 gamedata 原始 PHP 文件 + DB 实例，不重新生成 PHP 代码（保留后端真实状态）。
 *
 * AI 约束例外：备份功能不受 exportZip() 的"未连接后端"守卫限制——
 * 备份本身要求 connected，且用途是数据安全而非编辑器导出。
 *
 * @param {Object} dump  dumpBackend() 返回的数据快照
 * @param {string} [timestamp]  可选 ISO 时间戳，用于文件名
 */
export async function backupBackendZip(dump, timestamp) {
  const zip = new JSZip();

  // 1. gamedata 文件：按相对路径写入 ZIP（保留 gamedata/ 目录结构）
  const gamedataRoot = zip.folder('gamedata');
  for (const [relPath, content] of Object.entries(dump.files || {})) {
    // relPath 形如 'map.php' / 'tiles/region_1.php' / 'scatter_pool.php'
    gamedataRoot.file(relPath, content);
  }

  // 2. DB 实例：序列化为 JSON，按表分文件
  const dbRoot = zip.folder('db');
  const db = dump.db || { fog: {}, wildItems: {}, poiInstances: {} };

  dbRoot.file('fog.json', JSON.stringify(db.fog || {}, null, 2));
  dbRoot.file('wild_items.json', JSON.stringify(db.wildItems || {}, null, 2));
  dbRoot.file('poi_instances.json', JSON.stringify(db.poiInstances || {}, null, 2));

  // 3. 元数据：备份生成时刻 + pgroup 列表
  zip.file('backup_manifest.json', JSON.stringify({
    timestamp: timestamp || dump.timestamp || new Date().toISOString(),
    pgroups: dump.pgroups || [],
    file_count: Object.keys(dump.files || {}).length,
    source: 'oblivions_editor_backend_panel',
  }, null, 2));

  // 4. 生成并下载
  const blob = await zip.generateAsync({ type: 'blob' });
  // 文件名：oblivions_backend_backup_<timestamp>.zip
  // timestamp 格式：ISO → 替换 [:.] 为 -，截到秒
  const ts = (timestamp || dump.timestamp || new Date().toISOString())
    .replace(/[:.]/g, '-').slice(0, 19);
  saveAs(blob, `oblivions_backend_backup_${ts}.zip`);
}
