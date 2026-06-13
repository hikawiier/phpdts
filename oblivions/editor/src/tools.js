// ══════════════════════════════════════════════════
// 工具模式管理 / Tool mode management
// ══════════════════════════════════════════════════

import state from './state.js';

const TOOL_LIST = ['select', 'draw', 'erase', 'break', 'restore'];

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
