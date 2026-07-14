/**
 * @module K 状态管理层
 * Backend-authoritative map location.
 */
export interface TileRef {
  pgroup: number;
  pls: number;
}

/** Point in the unscaled local coordinate space of the active scene grid. */
export interface ScenePoint {
  readonly space: 'scene';
  x: number;
  y: number;
}

/** Point in browser viewport coordinates. */
export interface ViewportPoint {
  readonly space: 'viewport';
  x: number;
  y: number;
}

/** Bottom-center anchor of a tile in the active scene. */
export interface SceneAnchor {
  tile: TileRef;
  point: ScenePoint;
  cellWidth: number;
  cellHeight: number;
}

/** Read-only geometry port for the currently mounted scene. */
export interface SceneGeometry {
  readonly generation: number;
  readonly active: boolean;
  readonly projectionRevision: number;
  resolveTile(tile: TileRef): SceneAnchor | null;
  sceneToViewport(point: ScenePoint): ViewportPoint | null;
  elementCenterToViewport(el: HTMLElement): ViewportPoint;
}
