/**
 * @module M 组合式函数
 * @framework M-2 场景差异投影
 * @framework L-12 固定等距战斗场景
 */

export interface IsometricCoordinate {
  x: number;
  y: number;
}

export interface IsometricLayout {
  tileWidth: number;
  tileHeight: number;
  originX: number;
  originY: number;
  mirrorX: boolean;
}

export interface IsometricPoint {
  x: number;
  y: number;
}

export interface IsometricLayoutOptions {
  zoom?: number;
  mirrorX?: boolean;
  focus?: IsometricCoordinate | null;
  focusViewportXRatio?: number;
  focusViewportYRatio?: number;
}

const MAX_BASE_TILE_WIDTH = 112;
const MAX_RENDERED_TILE_WIDTH = 216;
const MIN_BASE_TILE_WIDTH = 60;
const MIN_RENDERED_TILE_WIDTH = 22;
const HORIZONTAL_PADDING = 22;
const VERTICAL_PADDING = 14;
const ACTOR_HEADROOM_UNITS = 1.05;
const FLOOR_FOOTROOM_UNITS = 0.35;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function rawPoint(tile: IsometricCoordinate, mirrorX: boolean): IsometricPoint {
  const horizontal = (tile.x - tile.y) / 2;
  return {
    x: mirrorX ? -horizontal : horizontal,
    y: (tile.x + tile.y) / 4,
  };
}

export function createIsometricLayout(
  tiles: readonly IsometricCoordinate[],
  width: number,
  height: number,
  options: IsometricLayoutOptions = {},
): IsometricLayout {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const mirrorX = options.mirrorX ?? false;
  const points = tiles.length > 0
    ? tiles.map(tile => rawPoint(tile, mirrorX))
    : [{ x: 0, y: 0 }];
  const minX = Math.min(...points.map(point => point.x - 0.5));
  const maxX = Math.max(...points.map(point => point.x + 0.5));
  const minY = Math.min(...points.map(point => point.y - 0.25));
  const maxY = Math.max(...points.map(point => point.y + 0.25));
  const widthUnits = Math.max(1, maxX - minX);
  const heightUnits = Math.max(0.5, maxY - minY);
  const widthLimit = (safeWidth - HORIZONTAL_PADDING * 2) / widthUnits;
  const heightLimit = (safeHeight - VERTICAL_PADDING * 2)
    / (heightUnits + ACTOR_HEADROOM_UNITS + FLOOR_FOOTROOM_UNITS);
  const fittedWidth = Math.min(MAX_BASE_TILE_WIDTH, widthLimit, heightLimit);
  const baseTileWidth = Math.max(MIN_BASE_TILE_WIDTH, fittedWidth);
  const zoom = clamp(Number(options.zoom) || 1, 0.7, 1.7);
  const tileWidth = clamp(
    baseTileWidth * zoom,
    MIN_RENDERED_TILE_WIDTH,
    MAX_RENDERED_TILE_WIDTH,
  );
  const tileHeight = tileWidth / 2;
  const mapWidth = widthUnits * tileWidth;
  const mapHeight = heightUnits * tileWidth;
  const contentHeight = mapHeight + (ACTOR_HEADROOM_UNITS + FLOOR_FOOTROOM_UNITS) * tileWidth;
  const left = (safeWidth - mapWidth) / 2;
  const top = Math.max(
    VERTICAL_PADDING,
    (safeHeight - contentHeight) / 2 + ACTOR_HEADROOM_UNITS * tileWidth,
  );
  let originX = left - minX * tileWidth;
  let originY = top - minY * tileWidth;

  if (options.focus) {
    const focus = rawPoint(options.focus, mirrorX);
    const focusXRatio = clamp(options.focusViewportXRatio ?? 0.5, 0.2, 0.8);
    const focusYRatio = clamp(options.focusViewportYRatio ?? 0.6, 0.25, 0.8);
    originX = safeWidth * focusXRatio - focus.x * tileWidth;
    originY = safeHeight * focusYRatio - focus.y * tileWidth;
  }

  return {
    tileWidth,
    tileHeight,
    originX,
    originY,
    mirrorX,
  };
}

export function projectIsometric(
  tile: IsometricCoordinate,
  layout: IsometricLayout,
): IsometricPoint {
  const point = rawPoint(tile, layout.mirrorX);
  return {
    x: layout.originX + point.x * layout.tileWidth,
    y: layout.originY + point.y * layout.tileWidth,
  };
}

export function deterministicBattleTileDelayIndex(x: number, y: number): number {
  const mixed = x * 37 + y * 53 + x * y * 11;
  return ((mixed % 19) + 19) % 19;
}

export function deterministicBattleTileDelay(x: number, y: number): number {
  return deterministicBattleTileDelayIndex(x, y) * 18;
}
