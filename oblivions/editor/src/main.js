// ══════════════════════════════════════════════════
// 应用入口 / Application entry point
// ══════════════════════════════════════════════════

import state, { loadFromStorage, loadProject } from './state.js';
import { initToolShortcuts } from './tools.js';
import { initRegionPanel, renderRegionPanel } from './render/region-panel.js';
import { renderGrid } from './render/grid.js';
import { renderTilePanel } from './render/tile-panel.js';
import { parseMapPhp, parseRegionPhp, extractPgroupFromFilename } from './lib/php-array-parser.js';
import { generateMapPhp, generateRegionPhp } from './lib/php-codegen.js';
import { exportZip } from './lib/export-zip.js';

function init() {
  loadFromStorage();

  initRegionPanel();
  initToolShortcuts();
  initImportDir();
  initImportModal();
  initExportButton();
  initQuickExport();
  initDragDrop();
  updateQuickExportVisibility();

  renderRegionPanel();
  renderGrid();
  renderTilePanel();
}

// ══════════════════════════════════════════════════
// 目录导入
// ══════════════════════════════════════════════════

function initImportDir() {
  document.getElementById('btnImportDir')?.addEventListener('click', async () => {
    if (window.showDirectoryPicker) {
      try {
        const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
        await importFromDirectoryHandle(dirHandle);
        return;
      } catch (e) {
        if (e.name === 'AbortError') return;
        // readwrite 权限被拒，尝试 readonly
        try {
          const dirHandle = await window.showDirectoryPicker({ mode: 'read' });
          await importFromDirectoryHandle(dirHandle);
          return;
        } catch (e2) {
          if (e2.name === 'AbortError') return;
          console.warn('showDirectoryPicker failed:', e2);
        }
      }
    }

    // 回退
    const input = document.createElement('input');
    input.type = 'file';
    input.webkitdirectory = true;
    input.directory = true;
    input.accept = '.php';
    input.addEventListener('change', async () => {
      if (!input.files.length) return;
      await importFromFileList(input.files);
    });
    input.click();
  });
}

async function importFromDirectoryHandle(dirHandle) {
  const project = { regions: {}, grids: {}, tiles: {} };
  let mapContent = null;

  // 先检查根目录
  try {
    const mapFile = await dirHandle.getFileHandle('map.php');
    const file = await mapFile.getFile();
    mapContent = await file.text();
  } catch (e) { /* 根目录没有 */ }

  // 检查子目录
  if (!mapContent) {
    for await (const entry of dirHandle.values()) {
      if (entry.kind === 'directory') {
        try {
          const mapFile = await entry.getFileHandle('map.php');
          const file = await mapFile.getFile();
          mapContent = await file.text();
          dirHandle = entry;
          break;
        } catch (e) { /* 继续 */ }
      }
    }
  }

  if (mapContent) {
    const mapData = parseMapPhp(mapContent);
    if (mapData) {
      project.regions = mapData.regions;
      project.grids = mapData.grids;
    }
  }

  // 读取 tiles/
  try {
    const tilesDir = await dirHandle.getDirectoryHandle('tiles');
    for await (const entry of tilesDir.values()) {
      if (entry.kind === 'file' && entry.name.startsWith('region_') && entry.name.endsWith('.php')) {
        const pgroup = extractPgroupFromFilename(entry.name);
        if (pgroup === null) continue;
        const file = await entry.getFile();
        const content = await file.text();
        const regionData = parseRegionPhp(content, pgroup);
        if (regionData) project.tiles[regionData.pgroup] = regionData.tiles;
      }
    }
  } catch (e) {
    for await (const entry of dirHandle.values()) {
      if (entry.kind === 'file' && entry.name.startsWith('region_') && entry.name.endsWith('.php')) {
        const pgroup = extractPgroupFromFilename(entry.name);
        if (pgroup === null) continue;
        const file = await entry.getFile();
        const content = await file.text();
        const regionData = parseRegionPhp(content, pgroup);
        if (regionData) project.tiles[regionData.pgroup] = regionData.tiles;
      }
    }
  }

  // 保存目录句柄
  state.dirHandle = dirHandle;
  finishImport(project);
}

async function importFromFileList(fileList) {
  const project = { regions: {}, grids: {}, tiles: {} };
  const files = Array.from(fileList);

  const mapFile = files.find(f => f.name === 'map.php');
  if (mapFile) {
    const content = await mapFile.text();
    const mapData = parseMapPhp(content);
    if (mapData) {
      project.regions = mapData.regions;
      project.grids = mapData.grids;
    }
  }

  for (const file of files) {
    if (file.name.startsWith('region_') && file.name.endsWith('.php')) {
      const pgroup = extractPgroupFromFilename(file.name);
      if (pgroup === null) continue;
      const content = await file.text();
      const regionData = parseRegionPhp(content, pgroup);
      if (regionData) project.tiles[regionData.pgroup] = regionData.tiles;
    }
  }

  // FileList 方式无法保存写句柄
  state.dirHandle = null;
  finishImport(project);
}

function finishImport(project) {
  if (Object.keys(project.regions).length === 0) {
    alert('未找到有效的 map.php 数据。请确保选择了包含 map.php 的 gamedata 目录。');
    return;
  }

  for (const pgroup in project.regions) {
    if (!project.tiles[pgroup]) project.tiles[pgroup] = {};
  }

  loadProject(project);
  updateQuickExportVisibility();
  renderRegionPanel();
  renderGrid();
  renderTilePanel();
}

// ══════════════════════════════════════════════════
// 快速导出：直接写回源目录，旧文件打包备份
// ══════════════════════════════════════════════════

function initQuickExport() {
  document.getElementById('btnQuickExport')?.addEventListener('click', async () => {
    if (!state.dirHandle) {
      alert('快速导出仅在选择目录导入后可用');
      return;
    }

    if (Object.keys(state.project.regions).length === 0) {
      alert('没有可导出的数据');
      return;
    }

    if (!confirm('将直接覆盖源目录中的文件，旧文件会打包为备份。继续？')) return;

    try {
      await quickExportToDir(state.dirHandle);
    } catch (e) {
      if (e.name === 'NotAllowedError') {
        alert('写入权限被拒绝。请重新导入目录并授予写入权限。');
      } else {
        console.error('Quick export failed:', e);
        alert('快速导出失败: ' + e.message);
      }
    }
  });
}

async function quickExportToDir(dirHandle) {
  // 1. 收集旧文件内容，打包备份
  const backupZip = new (await import('jszip')).default();
  let hasBackup = false;

  // 备份 map.php
  try {
    const mapHandle = await dirHandle.getFileHandle('map.php');
    const mapFile = await mapHandle.getFile();
    backupZip.file('map.php', await mapFile.text());
    hasBackup = true;
  } catch (e) { /* 不存在 */ }

  // 备份 tiles/region_*.php
  try {
    const tilesDir = await dirHandle.getDirectoryHandle('tiles');
    for await (const entry of tilesDir.values()) {
      if (entry.kind === 'file' && entry.name.endsWith('.php')) {
        const file = await entry.getFile();
        backupZip.file('tiles/' + entry.name, await file.text());
        hasBackup = true;
      }
    }
  } catch (e) { /* tiles 目录不存在 */ }

  // 下载备份
  if (hasBackup) {
    const backupBlob = await backupZip.generateAsync({ type: 'blob' });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const { saveAs } = await import('file-saver');
    saveAs(backupBlob, `oblivions_backup_${timestamp}.zip`);
  }

  // 2. 写入新文件
  // 写 map.php
  const mapPhp = generateMapPhp(state.project.regions, state.project.grids);
  await writeTextFile(dirHandle, 'map.php', mapPhp);

  // 确保 tiles/ 目录存在
  const tilesDir = await dirHandle.getDirectoryHandle('tiles', { create: true });

  // 删除旧的 region_*.php（避免残留）
  for await (const entry of tilesDir.values()) {
    if (entry.kind === 'file' && entry.name.startsWith('region_') && entry.name.endsWith('.php')) {
      // 只删除项目中不再存在的区域文件
      const pgroup = extractPgroupFromFilename(entry.name);
      if (pgroup !== null && !state.project.tiles[pgroup]) {
        await tilesDir.removeEntry(entry.name);
      }
    }
  }

  // 写入 region_*.php
  for (const pgroup in state.project.tiles) {
    const regionPhp = generateRegionPhp(parseInt(pgroup), state.project.tiles[pgroup]);
    await writeTextFile(tilesDir, `region_${pgroup}.php`, regionPhp);
  }

  alert(`导出完成！${hasBackup ? '旧文件已备份下载。' : ''}`);
}

async function writeTextFile(dirHandle, name, content) {
  const fileHandle = await dirHandle.getFileHandle(name, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}

function updateQuickExportVisibility() {
  const btn = document.getElementById('btnQuickExport');
  if (btn) {
    btn.style.display = state.dirHandle ? '' : 'none';
  }
}

// ══════════════════════════════════════════════════
// 手动导入
// ══════════════════════════════════════════════════

function initImportModal() {
  const btnImport = document.getElementById('btnImport');
  const modal = document.getElementById('importModal');
  const btnClose = document.getElementById('importModalClose');
  const btnCancel = document.getElementById('importCancel');
  const btnConfirm = document.getElementById('importConfirm');

  const openModal = () => { modal.style.display = 'flex'; };
  const closeModal = () => { modal.style.display = 'none'; };

  btnImport?.addEventListener('click', openModal);
  btnClose?.addEventListener('click', closeModal);
  btnCancel?.addEventListener('click', closeModal);

  btnConfirm?.addEventListener('click', () => {
    const mapPhp = document.getElementById('importMapPhp')?.value || '';
    const tilesPhp = document.getElementById('importTilesPhp')?.value || '';

    const project = { regions: {}, grids: {}, tiles: {} };

    if (mapPhp.trim()) {
      const mapData = parseMapPhp(mapPhp);
      if (mapData) {
        project.regions = mapData.regions;
        project.grids = mapData.grids;
      }
    }

    if (tilesPhp.trim()) {
      const parts = tilesPhp.split(/\n---\n/);
      const regionKeys = Object.keys(project.regions).map(Number).sort((a, b) => a - b);

      for (let i = 0; i < parts.length; i++) {
        const trimmed = parts[i].trim();
        if (!trimmed) continue;
        const pgroup = i < regionKeys.length ? regionKeys[i] : (i + 1);
        const regionData = parseRegionPhp(trimmed, pgroup);
        if (regionData) project.tiles[regionData.pgroup] = regionData.tiles;
      }
    }

    state.dirHandle = null;
    finishImport(project);
    if (Object.keys(project.regions).length > 0) closeModal();
  });

  modal?.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });
}

// ══════════════════════════════════════════════════
// ZIP 导出
// ══════════════════════════════════════════════════

function initExportButton() {
  document.getElementById('btnExport')?.addEventListener('click', async () => {
    if (Object.keys(state.project.regions).length === 0) {
      alert('没有可导出的数据');
      return;
    }
    try {
      await exportZip(state.project);
    } catch (e) {
      console.error('Export failed:', e);
      alert('导出失败: ' + e.message);
    }
  });
}

// ══════════════════════════════════════════════════
// 拖拽导入
// ══════════════════════════════════════════════════

function initDragDrop() {
  document.body.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    document.body.classList.add('drag-over');
  });

  document.body.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    document.body.classList.remove('drag-over');
  });

  document.body.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    document.body.classList.remove('drag-over');

    // 拖拽无法获取写权限句柄
    state.dirHandle = null;

    const items = e.dataTransfer.items;
    if (items && items.length > 0) {
      const entries = [];
      for (const item of items) {
        const entry = item.webkitGetAsEntry?.();
        if (entry) entries.push(entry);
      }

      if (entries.length > 0) {
        const project = { regions: {}, grids: {}, tiles: {} };
        await readEntriesRecursive(entries, project);
        finishImport(project);
        return;
      }
    }

    const files = Array.from(e.dataTransfer.files).filter(f => f.name.endsWith('.php'));
    if (files.length === 0) return;
    await importFromFileList(files);
  });
}

async function readEntriesRecursive(entries, project) {
  for (const entry of entries) {
    if (entry.isFile) {
      const file = await readFileEntry(entry);
      await processFile(file, project);
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      const subEntries = await readAllDirectoryEntries(reader);
      await readEntriesRecursive(subEntries, project);
    }
  }
}

function readAllDirectoryEntries(reader) {
  return new Promise((resolve, reject) => {
    const all = [];
    const readBatch = () => {
      reader.readEntries((entries) => {
        if (entries.length === 0) resolve(all);
        else { all.push(...entries); readBatch(); }
      }, reject);
    };
    readBatch();
  });
}

function readFileEntry(entry) {
  return new Promise((resolve, reject) => { entry.file(resolve, reject); });
}

async function processFile(file, project) {
  if (file.name === 'map.php') {
    const content = await file.text();
    const mapData = parseMapPhp(content);
    if (mapData) { project.regions = mapData.regions; project.grids = mapData.grids; }
  } else if (file.name.startsWith('region_') && file.name.endsWith('.php')) {
    const pgroup = extractPgroupFromFilename(file.name);
    if (pgroup !== null) {
      const content = await file.text();
      const regionData = parseRegionPhp(content, pgroup);
      if (regionData) project.tiles[regionData.pgroup] = regionData.tiles;
    }
  }
}

init();
