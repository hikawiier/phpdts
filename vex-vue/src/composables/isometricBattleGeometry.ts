/**
 * @module M 组合式函数
 * @framework M-2 场景差异投影
 * @framework L-12 固定等距战斗场景
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

export function createIsometricBattleGeometry(
  gridRef: Readonly<Ref<HTMLElement | null>>,
  currentRegion: MaybeRefOrGetter<string | number | null>,
  projectionRevision: MaybeRefOrGetter<number>,
  whenReady: () => Promise<void>,
): SceneGeometry {
  function resolveTile(tile: TileRef): SceneAnchor | null {
    const grid = gridRef.value;
    if (!grid || !sameRegion(toValue(currentRegion), tile.pgroup)) return null;
    const cell = grid.querySelector<HTMLElement>(
      `.battle-map-tile[data-pls="${tile.pls}"]`,
    );
    if (!cell) return null;

    const cellWidth = cell.offsetWidth;
    const tileHeight = cell.offsetHeight;
    const actorHeight = Math.min(72, Math.max(48, cellWidth * 0.48));
    return {
      tile,
      point: scenePoint(
        cell.offsetLeft + cellWidth / 2,
        cell.offsetTop + tileHeight * 0.76,
      ),
      cellWidth,
      cellHeight: actorHeight,
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
    getInteractionRoot: () => gridRef.value,
    whenReady,
    resolveTile,
    sceneToViewport,
    elementCenterToViewport,
  };
}
