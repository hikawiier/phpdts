/**
 * @module M 组合式函数
 */

import { toValue, type MaybeRefOrGetter, type Ref } from 'vue';
import type {
  SceneAnchor,
  SceneGeometry,
  ScenePoint,
  TileRef,
  ViewportPoint,
} from '@/types/scene';

function sameRegion(left: string | number | null, right: number): boolean {
  if (left === null) return false;
  const normalized = Number(left);
  return Number.isFinite(normalized) && normalized === right;
}

function scenePoint(x: number, y: number): ScenePoint {
  return { space: 'scene', x, y };
}

function viewportPoint(x: number, y: number): ViewportPoint {
  return { space: 'viewport', x, y };
}

/**
 * Measures a tile in the unscaled coordinate space of the map grid.
 * Registry registration supplies the public scene generation.
 */
export function createMapSceneGeometry(
  gridRef: Readonly<Ref<HTMLElement | null>>,
  currentRegion: MaybeRefOrGetter<string | number | null>,
  projectionRevision: MaybeRefOrGetter<number> = 0,
): SceneGeometry {
  function resolveTile(tile: TileRef): SceneAnchor | null {
    const grid = gridRef.value;
    if (!grid || !sameRegion(toValue(currentRegion), tile.pgroup)) return null;

    // K-12-B：只允许固定世界网格的 map-cell 作为空间锚点。
    // 玩家与敌人实体同样携带 data-pls，宽泛查询会误把动画元素当成图格坐标。
    const cell = grid.querySelector<HTMLElement>(
      `.map-cell[data-pls="${tile.pls}"]`,
    );
    if (!cell) return null;

    let offsetX = 0;
    let offsetY = 0;
    let node: HTMLElement | null = cell;
    while (node && node !== grid) {
      offsetX += node.offsetLeft;
      offsetY += node.offsetTop;
      node = node.offsetParent as HTMLElement | null;
    }

    const cellWidth = cell.offsetWidth;
    const cellHeight = cell.offsetHeight;
    if (node !== grid) {
      // A non-standard offsetParent chain can skip the grid. Rects provide a
      // scale-aware fallback while preserving scene-local coordinates.
      const gridRect = grid.getBoundingClientRect();
      const cellRect = cell.getBoundingClientRect();
      const scaleX = grid.offsetWidth > 0 ? gridRect.width / grid.offsetWidth : 0;
      const scaleY = grid.offsetHeight > 0 ? gridRect.height / grid.offsetHeight : 0;
      if (scaleX <= 0 || scaleY <= 0) return null;
      offsetX = (cellRect.left - gridRect.left) / scaleX;
      offsetY = (cellRect.top - gridRect.top) / scaleY;
    }

    return {
      tile,
      point: scenePoint(offsetX + cellWidth / 2, offsetY + cellHeight),
      cellWidth,
      cellHeight,
    };
  }

  function sceneToViewport(point: ScenePoint): ViewportPoint | null {
    const grid = gridRef.value;
    if (!grid || grid.offsetWidth <= 0 || grid.offsetHeight <= 0) return null;

    const rect = grid.getBoundingClientRect();
    const scaleX = rect.width / grid.offsetWidth;
    const scaleY = rect.height / grid.offsetHeight;
    if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY)) return null;

    return viewportPoint(rect.left + point.x * scaleX, rect.top + point.y * scaleY);
  }

  function elementCenterToViewport(el: HTMLElement): ViewportPoint {
    const rect = el.getBoundingClientRect();
    return viewportPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  return {
    generation: 0,
    active: true,
    get projectionRevision() {
      return Number(toValue(projectionRevision)) || 0;
    },
    resolveTile,
    sceneToViewport,
    elementCenterToViewport,
  };
}
