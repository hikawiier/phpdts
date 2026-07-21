// ══════════════════════════════════════════════════
// 地图格 CRUD 逻辑 / Tile CRUD logic
// ══════════════════════════════════════════════════
// @module O

import state, { nextPls, saveToStorage } from '../state.js';
import { autoConnect, disconnectAll } from './connectivity.js';

/**
 * 创建地图格
 * @param {number} pgroup - 区域ID
 * @param {number} x - 网格X坐标
 * @param {number} y - 网格Y坐标
 * @param {object} [preset] - 画笔预设 { floor, tide, passable, height, destructible }
 */
export function createTile(pgroup, x, y, preset) {
  const tiles = state.project.tiles[pgroup];
  if (!tiles) return null;

  // 检查该坐标是否已有格
  for (const pls in tiles) {
    if (tiles[pls].x === x && tiles[pls].y === y) return null;
  }

  const pls = nextPls(pgroup);
  // pls 范围校验（DESIGN.md 1.1：pls 1-254）
  if (pls === null) {
    alert('已达地图格数量上限（254），无法继续创建。');
    return null;
  }
  tiles[pls] = {
    name: '',
    desc: '',
    floor: preset?.floor || 'standard',
    tide: preset?.tide || 'shallow',
    height: preset?.height ?? 0,
    passable: preset?.passable !== undefined ? preset.passable : true,
    destructible: preset?.destructible ?? false,
    neighbors: [],
    x: x,
    y: y,
    preset_safe: false,
    _breaks: [],
  };

  // 自动连通
  autoConnect(pgroup, pls);
  saveToStorage();
  return pls;
}

/**
 * 删除地图格
 */
export function deleteTile(pgroup, pls) {
  const tiles = state.project.tiles[pgroup];
  if (!tiles || !tiles[pls]) return;

  // 清理连通关系
  disconnectAll(pgroup, pls);

  delete tiles[pls];

  // 清理区域中对该格的引用
  const region = state.project.regions[pgroup];
  if (region) {
    if (region.entrance_pls === pls) region.entrance_pls = null;
    if (region.exit_pls === pls) region.exit_pls = null;
  }

  if (state.selectedTile === pls) {
    state.selectedTile = null;
  }

  saveToStorage();
}

/**
 * 更新地图格属性
 */
export function updateTile(pgroup, pls, props) {
  const tiles = state.project.tiles[pgroup];
  if (!tiles || !tiles[pls]) return;

  const oldX = tiles[pls].x;
  const oldY = tiles[pls].y;

  Object.assign(tiles[pls], props);

  // 如果坐标变了，重新计算连通
  if (props.x !== undefined && props.x !== oldX || props.y !== undefined && props.y !== oldY) {
    // 先清除所有旧连通
    disconnectAll(pgroup, pls);
    tiles[pls].neighbors = [];
    // 重新自动连通
    autoConnect(pgroup, pls);
  }

  saveToStorage();
}

/**
 * 移动地图格坐标（拖拽）
 */
export function moveTile(pgroup, pls, newX, newY) {
  updateTile(pgroup, pls, { x: newX, y: newY });
}
