// ══════════════════════════════════════════════════
// ZIP 导出 / ZIP export
// ══════════════════════════════════════════════════

import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { generateMapPhp, generateRegionPhp } from './php-codegen.js';

/**
 * 导出项目数据为 ZIP 文件
 */
export async function exportZip(project) {
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
