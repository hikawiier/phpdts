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

    // K-12-B：仅查询网格 cell，排除实体元素（玩家头像/敌人等也带 data-pls）。
    // 否则当目标格在视野网格外（cell 未渲染）时，querySelector 会错误匹配
    // 玩家头像元素（applyStep 更新 curLoc 后头像 data-pls 变为目标 pls），
    // 返回头像的 offsetLeft/offsetTop（CSS 定位 0,0 + GSAP transform 不影响），
    // 导致 anchor 永远是网格左上角 (cellWidth/2, cellHeight)，跳跃落点全部错误。
    const cell = grid.querySelector<HTMLElement>(
      `[data-pls="${tile.pls}"]:not(.entity)`,
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
