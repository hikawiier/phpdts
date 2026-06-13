// ══════════════════════════════════════════════════
// 应用入口 / Application entry point
// ══════════════════════════════════════════════════

import state, { loadFromStorage, loadProject } from './state.js';
import { initToolShortcuts } from './tools.js';
import { initRegionPanel, renderRegionPanel } from './render/region-panel.js';
import { renderGrid } from './render/grid.js';
import { renderTilePanel } from './render/tile-panel.js';
import { parseMapPhp, parseRegionPhp, extractPgroupFromFilename } from './lib/php-array-parser.js';
import { exportZip } from './lib/export-zip.js';

/**
 * 初始化应用
 */
function init() {
  loadFromStorage();

  initRegionPanel();
  initToolShortcuts();
  initImportDir();
  initImportModal();
  initExportButton();
  initDragDrop();

  renderRegionPanel();
  renderGrid();
  renderTilePanel();
}

// ══════════════════════════════════════════════════
// 目录导入：选择 gamedata 目录，自动读取 map.php + tiles/region_*.php
// ══════════════════════════════════════════════════

function initImportDir() {
  document.getElementById('btnImportDir')?.addEventListener('click', async () => {
    // 优先使用 File System Access API（Chromium）
    if (window.showDirectoryPicker) {
      try {
        const dirHandle = await window.showDirectoryPicker({ mode: 'read' });
        await importFromDirectoryHandle(dirHandle);
        return;
      } catch (e) {
        if (e.name === 'AbortError') return; // 用户取消
        console.warn('showDirectoryPicker failed, falling back:', e);
      }
    }

    // 回退：使用 webkitdirectory input
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

/**
 * 通过 File System Access API 的 DirectoryHandle 读取
 */
async function importFromDirectoryHandle(dirHandle) {
  const project = { regions: {}, grids: {}, tiles: {} };

  // 读取 map.php（可能在根目录或 gamedata 子目录）
  let mapContent = null;

  // 先检查根目录是否有 map.php
  try {
    const mapFile = await dirHandle.getFileHandle('map.php');
    const file = await mapFile.getFile();
    mapContent = await file.text();
  } catch (e) {
    // 根目录没有，检查 gamedata 子目录
  }

  // 如果根目录没有，尝试查找 gamedata 子目录
  if (!mapContent) {
    for await (const entry of dirHandle.values()) {
      if (entry.kind === 'directory') {
        try {
          const mapFile = await entry.getFileHandle('map.php');
          const file = await mapFile.getFile();
          mapContent = await file.text();
          // 找到了，切换到这个子目录继续读取
          dirHandle = entry;
          break;
        } catch (e) {
          // 这个子目录没有 map.php，继续
        }
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

  // 读取 tiles/ 子目录中的 region_*.php
  try {
    const tilesDir = await dirHandle.getDirectoryHandle('tiles');
    for await (const entry of tilesDir.values()) {
      if (entry.kind === 'file' && entry.name.startsWith('region_') && entry.name.endsWith('.php')) {
        const pgroup = extractPgroupFromFilename(entry.name);
        if (pgroup === null) continue;
        const file = await entry.getFile();
        const content = await file.text();
        const regionData = parseRegionPhp(content, pgroup);
        if (regionData) {
          project.tiles[regionData.pgroup] = regionData.tiles;
        }
      }
    }
  } catch (e) {
    // tiles 目录不存在，尝试在根目录查找 region_*.php
    for await (const entry of dirHandle.values()) {
      if (entry.kind === 'file' && entry.name.startsWith('region_') && entry.name.endsWith('.php')) {
        const pgroup = extractPgroupFromFilename(entry.name);
        if (pgroup === null) continue;
        const file = await entry.getFile();
        const content = await file.text();
        const regionData = parseRegionPhp(content, pgroup);
        if (regionData) {
          project.tiles[regionData.pgroup] = regionData.tiles;
        }
      }
    }
  }

  finishImport(project);
}

/**
 * 通过 FileList（webkitdirectory 回退）读取
 */
async function importFromFileList(fileList) {
  const project = { regions: {}, grids: {}, tiles: {} };
  const files = Array.from(fileList);

  // 找到 map.php
  const mapFile = files.find(f => f.name === 'map.php');
  if (mapFile) {
    const content = await mapFile.text();
    const mapData = parseMapPhp(content);
    if (mapData) {
      project.regions = mapData.regions;
      project.grids = mapData.grids;
    }
  }

  // 找到所有 region_*.php
  for (const file of files) {
    if (file.name.startsWith('region_') && file.name.endsWith('.php')) {
      const pgroup = extractPgroupFromFilename(file.name);
      if (pgroup === null) continue;
      const content = await file.text();
      const regionData = parseRegionPhp(content, pgroup);
      if (regionData) {
        project.tiles[regionData.pgroup] = regionData.tiles;
      }
    }
  }

  finishImport(project);
}

/**
 * 完成导入
 */
function finishImport(project) {
  if (Object.keys(project.regions).length === 0) {
    alert('未找到有效的 map.php 数据。请确保选择了包含 map.php 的 gamedata 目录。');
    return;
  }

  // 为没有 tiles 数据的区域初始化空对象
  for (const pgroup in project.regions) {
    if (!project.tiles[pgroup]) {
      project.tiles[pgroup] = {};
    }
  }

  loadProject(project);
  renderRegionPanel();
  renderGrid();
  renderTilePanel();
}

// ══════════════════════════════════════════════════
// 手动导入：粘贴 PHP 内容
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

    // 解析 map.php
    if (mapPhp.trim()) {
      const mapData = parseMapPhp(mapPhp);
      if (mapData) {
        project.regions = mapData.regions;
        project.grids = mapData.grids;
      }
    }

    // 解析 region_*.php
    if (tilesPhp.trim()) {
      const parts = tilesPhp.split(/\n---\n/);
      // 按已解析的 regions 的 pgroup 顺序匹配
      const regionKeys = Object.keys(project.regions).map(Number).sort((a, b) => a - b);

      for (let i = 0; i < parts.length; i++) {
        const trimmed = parts[i].trim();
        if (!trimmed) continue;

        // pgroup：优先用 regions 中对应顺序的 key，否则用 i+1
        const pgroup = i < regionKeys.length ? regionKeys[i] : (i + 1);
        const regionData = parseRegionPhp(trimmed, pgroup);
        if (regionData) {
          project.tiles[regionData.pgroup] = regionData.tiles;
        }
      }
    }

    finishImport(project);
    if (Object.keys(project.regions).length > 0) {
      closeModal();
    }
  });

  modal?.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });
}

// ══════════════════════════════════════════════════
// 导出
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
// 拖拽文件导入
// ══════════════════════════════════════════════════

function initDragDrop() {
  document.body.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    document.body.classList.add('drag-over');
  });

  document.body.addEventListener('dragleave', (e) => {
    e.preventDefault();
    document.body.classList.remove('drag-over');
  });

  document.body.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    document.body.classList.remove('drag-over');

    const items = e.dataTransfer.items;
    if (items && items.length > 0) {
      // 尝试使用 webkitGetAsEntry 读取目录
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

    // 回退：只读取拖入的文件
    const files = Array.from(e.dataTransfer.files).filter(f => f.name.endsWith('.php'));
    if (files.length === 0) return;

    await importFromFileList(files);
  });
}

/**
 * 递归读取拖拽的目录条目
 */
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

/**
 * 读取目录中所有条目（readEntries 一次最多100条，需循环读取）
 */
function readAllDirectoryEntries(reader) {
  return new Promise((resolve, reject) => {
    const all = [];
    const readBatch = () => {
      reader.readEntries((entries) => {
        if (entries.length === 0) {
          resolve(all);
        } else {
          all.push(...entries);
          readBatch();
        }
      }, reject);
    };
    readBatch();
  });
}

/**
 * 读取 FileEntry 为 File 对象
 */
function readFileEntry(entry) {
  return new Promise((resolve, reject) => {
    entry.file(resolve, reject);
  });
}

/**
 * 处理单个文件
 */
async function processFile(file, project) {
  if (file.name === 'map.php') {
    const content = await file.text();
    const mapData = parseMapPhp(content);
    if (mapData) {
      project.regions = mapData.regions;
      project.grids = mapData.grids;
    }
  } else if (file.name.startsWith('region_') && file.name.endsWith('.php')) {
    const pgroup = extractPgroupFromFilename(file.name);
    if (pgroup !== null) {
      const content = await file.text();
      const regionData = parseRegionPhp(content, pgroup);
      if (regionData) {
        project.tiles[regionData.pgroup] = regionData.tiles;
      }
    }
  }
}

// 启动
init();
