// ══════════════════════════════════════════════════
// 工具模式管理 / Tool mode management
// ══════════════════════════════════════════════════

import state from './state.js';

const TOOL_LIST = ['select', 'draw', 'erase', 'break', 'restore', 'paint'];

/**
 * 切换工具
 */
export function setTool(tool) {
  if (!TOOL_LIST.includes(tool)) return;
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
  grid.style.cursor = cursors[state.currentTool] || 'default';
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

    if (keyMap[e.key.toLowerCase()]) {
      setTool(keyMap[e.key.toLowerCase()]);
      e.preventDefault();
    }
  });

  // 工具栏按钮点击
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
