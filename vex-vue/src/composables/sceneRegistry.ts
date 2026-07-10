import type { SceneGeometry } from '@/types/scene';

let nextGeneration = 0;
let activeScene: SceneGeometry | null = null;

/** Registers the mounted scene and returns an idempotent unregister callback. */
export function registerSceneGeometry(adapter: SceneGeometry): () => void {
  const generation = ++nextGeneration;
  let registeredActive = true;
  const registered: SceneGeometry = {
    generation,
    get active() {
      return registeredActive && activeScene === registered;
    },
    get projectionRevision() {
      return adapter.projectionRevision;
    },
    resolveTile: tile => adapter.resolveTile(tile),
    sceneToViewport: point => adapter.sceneToViewport(point),
    elementCenterToViewport: el => adapter.elementCenterToViewport(el),
  };

  activeScene = registered;
  let unregistered = false;
  return () => {
    if (unregistered) return;
    unregistered = true;
    registeredActive = false;
    if (activeScene === registered) activeScene = null;
  };
}

export function getSceneGeometry(): SceneGeometry | null {
  return activeScene;
}
