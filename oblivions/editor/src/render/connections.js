// ══════════════════════════════════════════════════
// SVG 连接线渲染 / SVG connection lines renderer
// ══════════════════════════════════════════════════

import state, { currentTiles, currentGrid } from '../state.js';

const CELL_W = 52;
const CELL_H = 44;
const HEADER_W = 38;
const HEADER_H = 28;

/**
 * 渲染地图格之间的连接线
 */
export function renderConnections() {
  const svg = document.getElementById('connectionsLayer');
  if (!svg) return;

  svg.innerHTML = '';

  const pgroup = state.currentRegion;
  if (pgroup === null) return;

  const tiles = currentTiles();
  const grid = currentGrid();
  const cols = grid.cols || 8;
  const rows = grid.rows || 6;

  // 设置 SVG 尺寸
  const svgW = HEADER_W + cols * CELL_W;
  const svgH = HEADER_H + rows * CELL_H;
  svg.setAttribute('width', svgW);
  svg.setAttribute('height', svgH);
  svg.setAttribute('viewBox', `0 0 ${svgW} ${svgH}`);

  // 收集已绘制的连接对（避免重复）
  const drawn = new Set();

  for (const pls in tiles) {
    const tile = tiles[pls];
    const cx1 = HEADER_W + tile.x * CELL_W + CELL_W / 2;
    const cy1 = HEADER_H + tile.y * CELL_H + CELL_H / 2;

    for (const nPls of tile.neighbors) {
      const pairKey = Math.min(pls, nPls) + '-' + Math.max(pls, nPls);
      if (drawn.has(pairKey)) continue;
      drawn.add(pairKey);

      const neighbor = tiles[nPls];
      if (!neighbor) continue;

      const cx2 = HEADER_W + neighbor.x * CELL_W + CELL_W / 2;
      const cy2 = HEADER_H + neighbor.y * CELL_H + CELL_H / 2;

      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', cx1);
      line.setAttribute('y1', cy1);
      line.setAttribute('x2', cx2);
      line.setAttribute('y2', cy2);
      line.setAttribute('stroke', '#55efc4');
      line.setAttribute('stroke-width', '2');
      line.setAttribute('stroke-opacity', '0.6');
      svg.appendChild(line);
    }

    // 绘制已断开连接的红色虚线
    const breaks = tile._breaks || [];
    for (const bPls of breaks) {
      const pairKey = Math.min(pls, bPls) + '-' + Math.max(pls, bPls);
      const breakKey = 'break-' + pairKey;
      if (drawn.has(breakKey)) continue;
      drawn.add(breakKey);

      const broken = tiles[bPls];
      if (!broken) continue;

      const cx2 = HEADER_W + broken.x * CELL_W + CELL_W / 2;
      const cy2 = HEADER_H + broken.y * CELL_H + CELL_H / 2;

      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', cx1);
      line.setAttribute('y1', cy1);
      line.setAttribute('x2', cx2);
      line.setAttribute('y2', cy2);
      line.setAttribute('stroke', '#ff7675');
      line.setAttribute('stroke-width', '2');
      line.setAttribute('stroke-dasharray', '4,4');
      line.setAttribute('stroke-opacity', '0.7');
      svg.appendChild(line);
    }
  }
}
