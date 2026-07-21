// ══════════════════════════════════════════════════
// 工具模式管理 / Tool mode management
// ══════════════════════════════════════════════════
// @module O
//
// 阶段2 整合（UPGRADE_DESIGN.md §5.2）：
//   - 保留 tile-tools 原有 6 工具（select/draw/erase/break/restore/paint）
//   - 通过 isSimTool() 路由分发 sim-tools（sim-set-player 等）
//   - 后续阶段会拆分为 tools/tile-tools.js + tools/sim-tools.js + tools/generator-tools.js
//     过渡期保留 tools.js 作为统一入口，避免调用方迁移

import state from './state.js';
import { SIM_TOOL_LIST, SIM_TOOL_META, isSimTool } from './tools/sim-tools.js';

const TOOL_LIST = ['select', 'draw', 'erase', 'break', 'restore', 'paint'];

/**
 * 切换工具
 */
export function setTool(tool) {
  if (!TOOL_LIST.includes(tool) && !isSimTool(tool)) return;
  state.currentTool = tool;
  state.breakFirst = null;
  updateToolbarUI();
  updateCursor();
}

/**
 * 获取当前工具
 */
export function currentTool() {
  return state.currentTool;
}

/**
 * 更新工具栏按钮状态
 */
function updateToolbarUI() {
  document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tool === state.currentTool);
  });
  // 画笔预设面板：仅绘制/油漆桶工具时显示
  const brushPanel = document.getElementById('brushPresetPanel');
  if (brushPanel) {
    brushPanel.style.display = (state.currentTool === 'draw' || state.currentTool === 'paint') ? '' : 'none';
  }
  // 模拟参数面板：仅 sim-set-player 工具时显示
  const simPanel = document.getElementById('simParamPanel');
  if (simPanel) {
    simPanel.style.display = isSimTool(state.currentTool) ? '' : 'none';
  }
}

/**
 * 更新画布光标
 */
function updateCursor() {
  const grid = document.getElementById('gridContainer');
  if (!grid) return;

  const cursors = {
    select: 'pointer',
    draw: 'crosshair',
    erase: 'not-allowed',
    break: 'crosshair',
    restore: 'crosshair',
    paint: 'cell',
  };

  // sim-tools 光标
  let cursor = cursors[state.currentTool] || 'default';
  if (isSimTool(state.currentTool)) {
    cursor = SIM_TOOL_META[state.currentTool]?.cursor || 'crosshair';
  }
  grid.style.cursor = cursor;
}

/**
 * 键盘快捷键
 */
export function initToolShortcuts() {
  document.addEventListener('keydown', (e) => {
    // 如果焦点在输入框中，不处理快捷键
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

    const keyMap = {
      'v': 'select',
      'b': 'draw',
      'e': 'erase',
      'd': 'break',
      'r': 'restore',
      'f': 'paint',
    };

    // sim-tools 快捷键（'p' → sim-set-player）
    for (const toolId of SIM_TOOL_LIST) {
      const meta = SIM_TOOL_META[toolId];
      if (meta && meta.shortcut) {
        keyMap[meta.shortcut] = toolId;
      }
    }

    if (keyMap[e.key.toLowerCase()]) {
      setTool(keyMap[e.key.toLowerCase()]);
      e.preventDefault();
    }
  });

  // 工具栏按钮点击（含 sim-tools 按钮）
  document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      setTool(btn.dataset.tool);
    });
  });
}

/**
 * 设置画笔预设
 */
export function setBrushPreset(preset) {
  Object.assign(state.brushPreset, preset);
}

/**
 * 获取画笔预设
 */
export function getBrushPreset() {
  return { ...state.brushPreset };
}

/**
 * 初始化画笔预设面板事件
 */
export function initBrushPresetPanel() {
  const floorEl = document.getElementById('brushFloor');
  const tideEl = document.getElementById('brushTide');
  const passableEl = document.getElementById('brushPassable');

  if (floorEl) {
    floorEl.value = state.brushPreset.floor;
    floorEl.addEventListener('change', () => {
      setBrushPreset({ floor: floorEl.value });
    });
  }
  if (tideEl) {
    tideEl.value = state.brushPreset.tide;
    tideEl.addEventListener('change', () => {
      setBrushPreset({ tide: tideEl.value });
    });
  }
  if (passableEl) {
    passableEl.checked = state.brushPreset.passable;
    passableEl.addEventListener('change', () => {
      setBrushPreset({ passable: passableEl.checked });
    });
  }
}

// ─── 阶段2 新增：re-export sim-tools 公共 API（§5.2 过渡策略）──────────────────
// 调用方可从 tools.js 直接 import 模拟相关 API，无需感知 sim-tools 模块路径
export {
  isSimTool,
  handleSimToolClick,
  setPlayerAt,
  performSimulateVision,
  performSimulateExplore,
  resetSimulation,
} from './tools/sim-tools.js';

// ─── 阶段6 新增：re-export generator-tools 公共 API（§5.2 过渡策略）───────────
// 随机生成工具是 toolbar 按钮 + modal 对话框形态（非 click-on-grid 工具），
// 与 sim-tools 不同：不通过 setTool 路由，而是独立 init 注入按钮 + 模态框。
// 此处 re-export 保持 tools.js 作为统一入口的过渡契约。
export { initGeneratorTools } from './tools/generator-tools.js';
