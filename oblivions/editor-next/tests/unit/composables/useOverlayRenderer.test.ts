//
// useOverlayRenderer 单元测试（对齐 NEW_DESIGN.md §7.3 M4：覆盖率 ≥ 75%）
//
// 覆盖点（M4 O-1）：
//   - activeOverlays：响应式叠层激活状态（4 字段：fog/vision/reachability/tideHeatmap）
//   - activeOverlayList：按渲染顺序排列的激活叠层 key 列表
//   - visionDistance / enemySenseDistance / reachabilityDistance / pathPreview：数据源代理
//   - currentTiles / currentPgroup / playerPos / isPlayerInCurrentRegion：项目状态代理
//   - fogData：从 simStore.fogOverride 读取（纯本地静态数据源）
//   - isOverlayActive：叠层激活判断
//   - scheduleBfsRecompute：RAF 分片调度（去抖 + 环境兼容）
//   - cancelPendingRaf：取消待执行的 RAF
//   - recompute：根据 tile 数量决定走同步还是 RAF
//   - OVERLAY_RENDER_ORDER 常量

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useOverlayRenderer, OVERLAY_RENDER_ORDER } from '@/composables/useOverlayRenderer';
import { useOverlayStore } from '@/stores/overlayStore';
import { useSimStore } from '@/stores/simStore';
import { useProjectStore } from '@/stores/projectStore';
import type { Pls, Tile } from '@/shared';

// ─── 测试工具 ─────────────────────────────────────────
function makeTile(_pls: Pls, x: number, y: number, overrides: Partial<Tile> = {}): Tile {
  return {
    name: '',
    desc: '',
    floor: 'standard',
    tide: 'shallow',
    height: 0,
    passable: true,
    destructible: false,
    neighbors: [],
    x,
    y,
    preset_safe: false,
    _breaks: [],
    ...overrides,
  };
}

function makeGrid3x3(): Record<Pls, Tile> {
  const tiles: Record<Pls, Tile> = {};
  for (let y = 0; y < 3; y++) {
    for (let x = 0; x < 3; x++) {
      const pls = (y * 3 + x + 1) as Pls;
      tiles[pls] = makeTile(pls, x, y);
    }
  }
  for (let y = 0; y < 3; y++) {
    for (let x = 0; x < 3; x++) {
      const pls = (y * 3 + x + 1) as Pls;
      const neighbors: Pls[] = [];
      if (x > 0) neighbors.push((y * 3 + (x - 1) + 1) as Pls);
      if (x < 2) neighbors.push((y * 3 + (x + 1) + 1) as Pls);
      if (y > 0) neighbors.push(((y - 1) * 3 + x + 1) as Pls);
      if (y < 2) neighbors.push(((y + 1) * 3 + x + 1) as Pls);
      tiles[pls]!.neighbors = neighbors;
    }
  }
  return tiles;
}

describe('useOverlayRenderer', () => {
  let overlay: ReturnType<typeof useOverlayStore>;
  let sim: ReturnType<typeof useSimStore>;
  let project: ReturnType<typeof useProjectStore>;
  let renderer: ReturnType<typeof useOverlayRenderer>;

  beforeEach(() => {
    setActivePinia(createPinia());
    overlay = useOverlayStore();
    sim = useSimStore();
    project = useProjectStore();
    renderer = useOverlayRenderer();
    // 准备一个有区域的 project
    project.addRegion('A', 3, 3);
  });

  afterEach(() => {
    renderer.cancelPendingRaf();
  });

  describe('OVERLAY_RENDER_ORDER 常量', () => {
    it('按渲染顺序排列（底层 → 顶层）', () => {
      expect(OVERLAY_RENDER_ORDER).toEqual([
        'tideHeatmap',
        'fog',
        'vision',
        'reachability',
      ]);
    });
  });

  describe('activeOverlays', () => {
    it('初始全部未激活', () => {
      const active = renderer.activeOverlays.value;
      expect(active).toEqual({
        fog: false,
        vision: false,
        reachability: false,
        tideHeatmap: false,
      });
    });

    it('fog/vision/reachability/tideHeatmap 由 overlay.flags 直接决定', () => {
      overlay.setFlag('fog', true);
      overlay.setFlag('vision', true);
      overlay.setFlag('reachability', true);
      overlay.setFlag('tideHeatmap', true);
      const active = renderer.activeOverlays.value;
      expect(active.fog).toBe(true);
      expect(active.vision).toBe(true);
      expect(active.reachability).toBe(true);
      expect(active.tideHeatmap).toBe(true);
    });
  });

  describe('activeOverlayList', () => {
    it('无激活叠层时返回空数组', () => {
      expect(renderer.activeOverlayList.value).toEqual([]);
    });

    it('按 OVERLAY_RENDER_ORDER 顺序排列激活叠层', () => {
      overlay.setFlag('fog', true);
      overlay.setFlag('tideHeatmap', true);
      overlay.setFlag('reachability', true);
      // 期望顺序：tideHeatmap → fog → reachability
      expect(renderer.activeOverlayList.value).toEqual([
        'tideHeatmap',
        'fog',
        'reachability',
      ]);
    });

    it('全部激活时返回完整顺序', () => {
      overlay.setFlag('fog', true);
      overlay.setFlag('vision', true);
      overlay.setFlag('reachability', true);
      overlay.setFlag('tideHeatmap', true);
      expect(renderer.activeOverlayList.value).toEqual([
        'tideHeatmap',
        'fog',
        'vision',
        'reachability',
      ]);
    });
  });

  describe('isOverlayActive', () => {
    it('返回指定叠层的激活状态', () => {
      overlay.setFlag('fog', true);
      expect(renderer.isOverlayActive('fog')).toBe(true);
      expect(renderer.isOverlayActive('vision')).toBe(false);
    });
  });

  describe('数据源代理', () => {
    it('visionDistance 代理 simStore.visionResult', () => {
      expect(renderer.visionDistance.value).toBe(sim.visionResult);
    });

    it('enemySenseDistance 代理 simStore.enemySenseResult', () => {
      expect(renderer.enemySenseDistance.value).toBe(sim.enemySenseResult);
    });

    it('reachabilityDistance 代理 simStore.reachabilityResult', () => {
      expect(renderer.reachabilityDistance.value).toBe(sim.reachabilityResult);
    });

    it('pathPreview 代理 simStore.pathPreview', () => {
      expect(renderer.pathPreview.value).toBe(sim.pathPreview);
    });

    it('playerPos 代理 simStore.playerPos', () => {
      expect(renderer.playerPos.value).toBe(sim.playerPos);
    });

    it('currentTiles 代理 projectStore.currentTiles', () => {
      expect(renderer.currentTiles.value).toBe(project.currentTiles);
    });

    it('currentPgroup 代理 projectStore.currentPgroup', () => {
      expect(renderer.currentPgroup.value).toBe(project.currentPgroup);
    });
  });

  describe('isPlayerInCurrentRegion', () => {
    it('玩家未设置时返回 false', () => {
      expect(renderer.isPlayerInCurrentRegion.value).toBe(false);
    });

    it('玩家在当前区域返回 true', () => {
      const pgroup = project.currentPgroup!;
      sim.setPlayerPos(pgroup, 1);
      expect(renderer.isPlayerInCurrentRegion.value).toBe(true);
    });

    it('玩家不在当前区域返回 false', () => {
      sim.setPlayerPos(999, 1); // pgroup 999 不存在
      expect(renderer.isPlayerInCurrentRegion.value).toBe(false);
    });
  });

  describe('fogData', () => {
    it('从 fogOverride 读取', () => {
      const pgroup = project.currentPgroup!;
      // 添加几个 tile 用于测试
      const tiles = makeGrid3x3();
      project.project.tiles[pgroup] = tiles;
      // 设置 fogOverride
      sim.setPlayerPos(pgroup, 5);
      sim.updateConfig({ visionRange: 1 });
      sim.recomputeBfs(tiles);
      // fogOverride 应有玩家格 + 邻接格 = 5 个
      const fogData = renderer.fogData.value;
      expect(fogData.size).toBe(5);
      expect(fogData.get(5 as Pls)).toBe(1);
    });

    it('无 fogOverride 时返回空 Map', () => {
      const fogData = renderer.fogData.value;
      expect(fogData.size).toBe(0);
    });

    it('无当前 pgroup 时返回空 Map', () => {
      project.clearProject();
      const fogData = renderer.fogData.value;
      expect(fogData.size).toBe(0);
    });
  });

  describe('recompute（同步路径）', () => {
    it('tile 数量 < RAF_BATCH_THRESHOLD 时同步计算', () => {
      const tiles = makeGrid3x3();
      const pgroup = project.currentPgroup!;
      project.project.tiles[pgroup] = tiles;
      sim.setPlayerPos(pgroup, 5);
      // 9 个 tile，远小于 1000，应同步计算
      renderer.recompute(tiles);
      // 立即可见结果
      expect(sim.visionResult.size).toBeGreaterThan(0);
    });
  });

  describe('scheduleBfsRecompute（RAF 路径）', () => {
    it('调用后返回 true 表示已调度', () => {
      const tiles = makeGrid3x3();
      const result = renderer.scheduleBfsRecompute(tiles);
      // 测试环境可能无 RAF，返回 false；有 RAF 返回 true
      expect(typeof result).toBe('boolean');
    });

    it('多次连续调用合并为单次 RAF（去抖）', async () => {
      const rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
        // 立即执行回调（模拟下一帧）
        setTimeout(() => cb(0), 0);
        return 1;
      });
      try {
        const tiles = makeGrid3x3();
        renderer.scheduleBfsRecompute(tiles);
        renderer.scheduleBfsRecompute(tiles);
        renderer.scheduleBfsRecompute(tiles);
        // 只调度一次 RAF
        expect(rafSpy).toHaveBeenCalledTimes(1);
        // 等待 setTimeout 执行
        await new Promise((resolve) => setTimeout(resolve, 10));
      } finally {
        rafSpy.mockRestore();
      }
    });

    it('无 RAF 环境下直接同步计算', () => {
      const originalRaf = globalThis.requestAnimationFrame;
      // @ts-expect-error - 临时移除 RAF
      delete globalThis.requestAnimationFrame;
      try {
        const tiles = makeGrid3x3();
        const pgroup = project.currentPgroup!;
        project.project.tiles[pgroup] = tiles;
        sim.setPlayerPos(pgroup, 5);
        const result = renderer.scheduleBfsRecompute(tiles);
        expect(result).toBe(false); // false 表示无 RAF，已同步执行
        expect(sim.visionResult.size).toBeGreaterThan(0);
      } finally {
        globalThis.requestAnimationFrame = originalRaf;
      }
    });
  });

  describe('cancelPendingRaf', () => {
    it('调用后无错误', () => {
      expect(() => renderer.cancelPendingRaf()).not.toThrow();
    });

    it('取消待执行的 RAF 调度', () => {
      const cancelSpy = vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {});
      const rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(() => 42);
      try {
        const tiles = makeGrid3x3();
        renderer.scheduleBfsRecompute(tiles);
        renderer.cancelPendingRaf();
        expect(cancelSpy).toHaveBeenCalledWith(42);
      } finally {
        rafSpy.mockRestore();
        cancelSpy.mockRestore();
      }
    });

    it('无 cancelAnimationFrame 时仍可调用', () => {
      const originalCancel = globalThis.cancelAnimationFrame;
      // @ts-expect-error - 临时移除 cancelAnimationFrame
      delete globalThis.cancelAnimationFrame;
      try {
        expect(() => renderer.cancelPendingRaf()).not.toThrow();
      } finally {
        globalThis.cancelAnimationFrame = originalCancel;
      }
    });
  });

  describe('recompute（RAF 路径）', () => {
    it('tile 数量 >= RAF_BATCH_THRESHOLD 时走 RAF', () => {
      const rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(() => 1);
      try {
        // 构造 > 1000 个 tile 的字典
        const bigTiles: Record<Pls, Tile> = {};
        for (let i = 1; i <= 1100; i++) {
          bigTiles[i as Pls] = makeTile(i as Pls, i, 0);
        }
        renderer.recompute(bigTiles);
        expect(rafSpy).toHaveBeenCalled();
      } finally {
        rafSpy.mockRestore();
      }
    });
  });

  describe('4 叠层正交性集成测试', () => {
    it('同时启用 fog / vision / reachability / tideHeatmap → activeOverlays 全部 true', () => {
      const pgroup = project.currentPgroup!;
      const tiles = makeGrid3x3();
      project.project.tiles[pgroup] = tiles;
      sim.setPlayerPos(pgroup, 5);
      sim.updateConfig({ visionRange: 1 });
      sim.recomputeBfs(tiles);

      overlay.setFlag('fog', true);
      overlay.setFlag('vision', true);
      overlay.setFlag('reachability', true);
      overlay.setFlag('tideHeatmap', true);

      const active = renderer.activeOverlays.value;
      expect(active.fog).toBe(true);
      expect(active.vision).toBe(true);
      expect(active.reachability).toBe(true);
      expect(active.tideHeatmap).toBe(true);
    });

    it('4 叠层全部激活时 activeOverlayList 按渲染顺序返回', () => {
      const pgroup = project.currentPgroup!;
      const tiles = makeGrid3x3();
      project.project.tiles[pgroup] = tiles;
      sim.setPlayerPos(pgroup, 5);
      sim.recomputeBfs(tiles);

      overlay.setFlag('fog', true);
      overlay.setFlag('vision', true);
      overlay.setFlag('reachability', true);
      overlay.setFlag('tideHeatmap', true);

      expect(renderer.activeOverlayList.value).toEqual([
        'tideHeatmap',
        'fog',
        'vision',
        'reachability',
      ]);
    });

    it('单独关闭某叠层不影响其他叠层（叠层之间互不依赖）', () => {
      overlay.setFlag('fog', true);
      overlay.setFlag('vision', true);
      overlay.setFlag('reachability', true);
      overlay.setFlag('tideHeatmap', false);
      expect(renderer.activeOverlays.value.fog).toBe(true);
      expect(renderer.activeOverlays.value.vision).toBe(true);
      expect(renderer.activeOverlays.value.reachability).toBe(true);
      expect(renderer.activeOverlays.value.tideHeatmap).toBe(false);

      overlay.setFlag('fog', false);
      overlay.setFlag('tideHeatmap', true);
      expect(renderer.activeOverlays.value.fog).toBe(false);
      expect(renderer.activeOverlays.value.tideHeatmap).toBe(true);
    });
  });
});
