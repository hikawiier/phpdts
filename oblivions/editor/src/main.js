// ══════════════════════════════════════════════════
// 应用入口 / Application entry point
// ══════════════════════════════════════════════════
// @module O
// @framework O-4 编辑器守卫与后端对接
// @framework O-6 开局分布预览 overlay 守卫（updateOverlayToggleDisabled）

import state, {
  loadFromStorage,
  loadProject,
  setSimMode,
  setSimParams,
  setOverlayFlag,
} from './state.js';
import { initToolShortcuts, initBrushPresetPanel } from './tools.js';
import {
  performSimulateVision,
  performSimulateExplore,
  resetSimulation,
} from './tools/sim-tools.js';
import { initRegionPanel, renderRegionPanel } from './render/region-panel.js';
import { renderGrid } from './render/grid.js';
import { renderTilePanel } from './render/tile-panel.js';
import { initConfigPanel, rerenderConfigPanel } from './render/config-panel.js';
import { initValidatePanel, rerenderValidatePanel } from './render/validate-panel.js';
import { initBackendPanel, rerenderBackendPanel, handleImportFromBackend } from './render/backend-panel.js';
import { initGeneratorTools } from './tools/generator-tools.js';
// 阶段6 新增：注册示例生成器（任务3 子代理实现具体主题生成器时也会调用 registerGenerator）
import { registerSampleGenerator } from './generators/sample-generator.js';
// 任务3 新增：注册具体主题生成器（O-5 框架扩展实现）
import { registerArchipelagoGenerator } from './generators/archipelago-generator.js';
import { registerLabyrinthGenerator } from './generators/labyrinth-generator.js';
import { registerWetlandGenerator } from './generators/wetland-generator.js';
import { registerRuinsGenerator } from './generators/ruins-generator.js';
import { parseMapPhp, parseRegionPhp, extractPgroupFromFilename } from './lib/php-array-parser.js';
import { generateMapPhp, generateRegionPhp } from './lib/php-codegen.js';
import { exportZip } from './lib/export-zip.js';

function init() {
  loadFromStorage();

  initRegionPanel();
  initToolShortcuts();
  initBrushPresetPanel();
  initImportDir();
  initImportModal();
  initExportButton();
  initQuickExport();
  initDragDrop();
  initSimTools();          // 阶段2 新增：模拟工具/叠层/参数面板事件绑定
  initRightTabs();         // 阶段3 新增：右栏 Tab 切换（地图格 / 配置 / 验证 / 后端）
  initConfigPanel();       // 阶段3 新增：配置文件编辑面板
  initValidatePanel();     // 阶段4 新增：验证工具面板
  initBackendPanel();      // 阶段5 新增：后端对接面板（baseUrl 恢复 + 事件绑定）
  registerSampleGenerator(); // 阶段6 新增：注册示例生成器（任务3 在此基础上扩展）
  registerArchipelagoGenerator(); // 任务3 新增：群岛链生成器（多区域 + 距离场）
  registerLabyrinthGenerator();   // 任务3 新增：迷宫生成器（递归回溯）
  registerWetlandGenerator();     // 任务3 新增：潮汐湿地生成器（渐变场 + 安全岛）
  registerRuinsGenerator();       // 任务3 新增：废墟城市生成器（簇状 + height 分层）
  initGeneratorTools();    // 阶段6 新增：随机生成工具（生成器选择 + 参数 schema UI）
  updateQuickExportVisibility();
  updateExportButtons();   // AI 约束：根据 backend.connected 状态初始化导出/快速导出按钮
  updateOverlayToggleDisabled();  // 任务3 O-6：根据 backend.connected 同步 wilditem/poi overlay disabled

  renderRegionPanel();
  renderGrid();
  renderTilePanel();
}

// ══════════════════════════════════════════════════
// 阶段3 新增：右栏 Tab 切换（地图格 / 配置 / 验证）
// ══════════════════════════════════════════════════

function initRightTabs() {
  document.querySelectorAll('.right-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.rtab;
      if (!tab) return;
      // 切换按钮 active
      document.querySelectorAll('.right-tab-btn').forEach(b => {
        b.classList.toggle('active', b === btn);
      });
      // 切换内容显示
      document.querySelectorAll('.right-tab-content').forEach(c => {
        const isActive = c.id === `rtab-${tab}`;
        c.style.display = isActive ? 'flex' : 'none';
      });
      // 切换到 config / validate / backend 时重渲染（保证状态最新）
      if (tab === 'config') rerenderConfigPanel();
      if (tab === 'validate') rerenderValidatePanel();
      if (tab === 'backend') rerenderBackendPanel();
    });
  });
}

// ══════════════════════════════════════════════════
// 阶段2 新增：模拟工具/叠层/参数面板事件绑定
// UPGRADE_DESIGN.md §2.4-2.7
// ══════════════════════════════════════════════════

function initSimTools() {
  initModeSwitch();
  initSimActionButtons();
  initSimParamSliders();
  initOverlayToggles();
}

/**
 * 模式开关：Simulate ↔ Live
 * Live 模式需先在后端面板配置并连接成功（UPGRADE_DESIGN.md §2.4.3）
 */
function initModeSwitch() {
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      const mode = btn.dataset.mode;
      if (mode !== 'simulate' && mode !== 'live') return;
      // Live 模式需先连接后端（连接入口在右栏"后端"Tab）
      if (mode === 'live' && !state.backend.connected) {
        alert('Live 模式需先在右栏"后端"Tab 配置并连接后端');
        // 自动切到后端面板，引导用户连接
        const backendTab = document.querySelector('.right-tab-btn[data-rtab="backend"]');
        if (backendTab) backendTab.click();
        return;
      }
      setSimMode(mode);
      // 更新按钮状态
      document.querySelectorAll('.mode-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.mode === mode);
      });
      // 切换模式 → 重渲染（叠层数据源变化）
      renderGrid();
    });
  });
}

/**
 * 模拟操作按钮：视野 BFS / 模拟探索 / 重置
 */
function initSimActionButtons() {
  document.getElementById('btnSimVision')?.addEventListener('click', () => {
    const playerPos = state.simState.playerPos;
    if (playerPos.pgroup === null || playerPos.pls === null) {
      alert('请先使用"玩家"工具点击地图格设置玩家位置');
      return;
    }
    performSimulateVision();
    renderGrid();
  });

  document.getElementById('btnSimExplore')?.addEventListener('click', () => {
    const playerPos = state.simState.playerPos;
    if (playerPos.pgroup === null || playerPos.pls === null) {
      alert('请先使用"玩家"工具点击地图格设置玩家位置');
      return;
    }
    const result = performSimulateExplore();
    renderGrid();
    if (result.discovered.length === 0) {
      const items = state.liveState.wildItems[playerPos.pgroup];
      if (!items || Object.keys(items).length === 0) {
        alert('当前区域无道具实例可发现（请在右栏"后端"Tab 切换 Live 模式并加载 Live 数据）');
      } else {
        alert('视野范围内无可发现道具');
      }
    } else {
      const summary = result.discovered
        .map(d => `#${d.pls}: discovered=${d.discovered}`)
        .join('\n');
      alert(`本次发现 ${result.discovered.length} 个道具：\n${summary}`);
    }
  });

  document.getElementById('btnSimReset')?.addEventListener('click', () => {
    if (state.simState.playerPos.pgroup === null) return;
    if (!confirm('清空所有模拟缓存（玩家位置/迷雾/视野/发现）？')) return;
    resetSimulation();
    renderGrid();
  });
}

/**
 * 模拟参数滑块：视野/移动力/发现数
 * 调整时实时更新 state.simState + 重算 BFS（如适用）
 */
function initSimParamSliders() {
  const sliders = [
    { id: 'simVisionRange', valId: 'simVisionRangeVal', key: 'visionRange', recompute: 'vision' },
    { id: 'simMovePower', valId: 'simMovePowerVal', key: 'movePower', recompute: 'reachability' },
    { id: 'simDiscoverLimit', valId: 'simDiscoverLimitVal', key: 'discoverLimit', recompute: null },
  ];

  for (const s of sliders) {
    const slider = document.getElementById(s.id);
    const valEl = document.getElementById(s.valId);
    if (!slider || !valEl) continue;

    // 同步初始值
    slider.value = state.simState[s.key];
    valEl.textContent = state.simState[s.key];

    slider.addEventListener('input', () => {
      const value = parseInt(slider.value);
      setSimParams({ [s.key]: value });
      valEl.textContent = value;

      // 若已设置玩家位置 → 实时重算
      const playerPos = state.simState.playerPos;
      if (playerPos.pgroup !== null && playerPos.pls !== null) {
        if (s.recompute === 'vision') {
          performSimulateVision();
        }
        // reachability overlay 在下次 renderGrid 时自动重算
      }
      renderGrid();
    });
  }
}

/**
 * 叠层开关：fog/vision/reachability/tideHeatmap
 * 切换时实时重渲染画布
 */
function initOverlayToggles() {
  document.querySelectorAll('.overlay-toggle input[type="checkbox"]').forEach(cb => {
    const overlayKey = cb.dataset.overlay;
    if (!overlayKey) return;

    // 同步初始状态
    cb.checked = !!state.overlayFlags[overlayKey];

    cb.addEventListener('change', () => {
      setOverlayFlag(overlayKey, cb.checked);
      renderGrid();
    });
  });
}

// ══════════════════════════════════════════════════
// 目录导入 / 后端导入
// ══════════════════════════════════════════════════
// AI 约束：connected 状态下"导入目录"按钮切换为"从后端导入"——
// 调用 backend-panel.js 的 handleImportFromBackend() 拉取完整后端数据填入 state。
// 未连接时保留原目录导入逻辑。

function initImportDir() {
  document.getElementById('btnImportDir')?.addEventListener('click', async () => {
    // connected 状态下切换为"从后端导入"（替代手动目录导入）
    if (state.backend.connected) {
      await handleImportFromBackend();
      return;
    }
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
// AI 约束：未连接后端时禁用快速导出（与 exportZip 共用守卫策略）；
// 已连接后端时仍允许（用户已通过 token 认证，视为受信操作）。

function initQuickExport() {
  document.getElementById('btnQuickExport')?.addEventListener('click', async () => {
    // AI 约束守卫：未连接后端禁止快速导出
    if (!state.backend.connected) {
      alert('快速导出需先连接后端（AI 约束）');
      return;
    }
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
  // 委托给 updateExportButtons()：AI 约束状态 + dirHandle 可见性统一刷新
  updateExportButtons();
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
// AI 约束：禁止 AI 使用导出 ZIP 功能操作编辑器，只允许在连接后端的情况下备份、导出到后端。
//   - 未连接后端时按钮 disabled，hover 显示"需先连接后端（AI 约束）"
//   - 已连接后端时按钮可用，但 exportZip() 入口仍守卫（防绕过）
//   - 例外：备份功能（backend-panel.js 的 handleBackendBackup）使用独立的 backupBackendZip() 路径

function initExportButton() {
  document.getElementById('btnExport')?.addEventListener('click', async () => {
    // AI 约束守卫：未连接后端禁止导出 ZIP（与 exportZip 入口守卫双重保险）
    if (!state.backend.connected) {
      alert('导出 ZIP 需先连接后端（AI 约束）');
      return;
    }
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

/**
 * AI 约束：根据 state.backend.connected 同步导出/快速导出按钮的 disabled 状态
 * 在 init() 启动时调用一次；在 backend connect/disconnect 后调用刷新
 */
export function updateExportButtons() {
  const connected = !!state.backend.connected;
  const btnExport = document.getElementById('btnExport');
  const btnQuickExport = document.getElementById('btnQuickExport');
  const btnImportDir = document.getElementById('btnImportDir');

  if (btnExport) {
    btnExport.disabled = !connected;
    btnExport.title = connected
      ? '导出 ZIP（已连接后端）'
      : '导出ZIP（需先连接后端，AI 约束）';
  }
  if (btnQuickExport) {
    // 快速导出仅在 dirHandle 存在时显示，AI 约束叠加在 dirHandle 之上
    const visible = !!state.dirHandle;
    btnQuickExport.style.display = visible ? '' : 'none';
    if (visible) {
      btnQuickExport.disabled = !connected;
      btnQuickExport.title = connected
        ? '直接写回源目录，旧文件打包备份（已连接后端）'
        : '快速导出（需先连接后端，AI 约束）';
    }
  }
  if (btnImportDir) {
    // connected 状态下文案切换为"从后端导入"（点击行为在 initImportDir 中分流）
    btnImportDir.textContent = connected ? '从后端导入' : '导入目录';
    btnImportDir.title = connected
      ? '从已连接的后端拉取完整地图 + 配置 + DB 实例'
      : '选择 gamedata 目录自动导入';
  }
}

/**
 * 任务3 O-6：根据 state.backend.connected 同步 wilditem / poi overlay 开关的 disabled 状态
 *
 * 设计意图（UPGRADE_DESIGN.md §10.4 / §10.5）：
 *   - 道具分布 / POI 分布 overlay 数据源为 liveState.wildItems / liveState.poiInstances，
 *     该数据仅在 backend.connected === true 时由 handleLoadLiveData 拉取填充。
 *   - 未连接时强制禁用两个 overlay 开关，避免用户开启后看到空白画布产生"功能失效"误解。
 *   - 与 updateExportButtons() 同位调用（init 启动 + connect/disconnect 后）。
 *   - 断开连接时同时清空 overlayFlags.wilditem / poi，避免下次连接后旧开关状态意外激活。
 *
 * 同位调用点：init() / backend-panel.js handleBackendConnect 成功后 / handleBackendDisconnect 后
 */
export function updateOverlayToggleDisabled() {
  const connected = !!state.backend.connected;
  const overlayKeys = ['wilditem', 'poi'];
  for (const key of overlayKeys) {
    const cb = document.querySelector(`.overlay-toggle input[data-overlay="${key}"]`);
    if (!cb) continue;
    cb.disabled = !connected;
    const label = cb.closest('.overlay-toggle');
    if (label) {
      label.classList.toggle('is-disabled', !connected);
      label.title = connected
      ? '开局分布预览（观察者视角，需先在"后端"Tab 加载 Live 数据）'
      : '需先连接后端并加载 Live 数据（开局分布预览）';
    }
    // 断开连接时强制清空开关状态（避免下次连接后旧状态意外激活）
    if (!connected && state.overlayFlags[key]) {
      setOverlayFlag(key, false);
      cb.checked = false;
    }
  }
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
