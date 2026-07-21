//
// simStore 单元测试（对齐 NEW_DESIGN.md §7.3 M4：覆盖率 ≥ 85%）
//
// 覆盖点：
//   - state：playerPos / config / fogOverride / visionResult / reachabilityResult /
//            enemySenseResult / pathPreview / discoveredItems / hoverTargetPls
//   - actions：setPlayerPos / updateConfig / recomputeBfs / setHoverTarget /
//              clearPathPreview / simulateExplore / clearBfsResults / resetSim
//   - 边界：
//     - recomputeBfs 在无玩家位置时清空结果
//     - recomputeBfs 在玩家所在格无效时清空路径预览
//     - setHoverTarget 在无玩家位置时清空路径
//     - simulateExplore 在无玩家位置时无操作
//     - DEFAULT_SIM_CONFIG 默认值
//     - RAF_BATCH_THRESHOLD 常量

import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import {
  useSimStore,
  DEFAULT_SIM_CONFIG,
  RAF_BATCH_THRESHOLD,
} from '@/stores/simStore';
import type { Pls, Tile } from '@/shared';

// ─── 测试工具：构造 tile 字典 ─────────────────────────────
function makeTile(
  _pls: Pls,
  x: number,
  y: number,
  overrides: Partial<Tile> = {},
): Tile {
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

/**
 * 构造一个 3x3 的连通网格（pls 1-9 对应 (0,0)-(2,2)）
 * 所有格 passable=true，自动建立 4 邻接（上下左右）
 */
function makeGrid3x3(): Record<Pls, Tile> {
  const tiles: Record<Pls, Tile> = {};
  for (let y = 0; y < 3; y++) {
    for (let x = 0; x < 3; x++) {
      const pls = (y * 3 + x + 1) as Pls;
      tiles[pls] = makeTile(pls, x, y);
    }
  }
  // 建立 4 邻接
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

describe('simStore', () => {
  let sim: ReturnType<typeof useSimStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    sim = useSimStore();
  });

  describe('常量导出', () => {
    it('DEFAULT_SIM_CONFIG 默认值对齐设计', () => {
      expect(DEFAULT_SIM_CONFIG).toEqual({
        visionRange: 1,
        enemySenseRange: 3,
        movePower: 3,
        discoverLimit: 2,
      });
    });

    it('RAF_BATCH_THRESHOLD = 1000', () => {
      expect(RAF_BATCH_THRESHOLD).toBe(1000);
    });
  });

  describe('初始状态', () => {
    it('playerPos = { pgroup: null, pls: null }', () => {
      expect(sim.playerPos).toEqual({ pgroup: null, pls: null });
    });

    it('config 等于 DEFAULT_SIM_CONFIG 副本', () => {
      expect(sim.config).toEqual(DEFAULT_SIM_CONFIG);
      expect(sim.config).not.toBe(DEFAULT_SIM_CONFIG);
    });

    it('fogOverride 为空对象', () => {
      expect(sim.fogOverride).toEqual({});
    });

    it('visionResult 为空 Map', () => {
      expect(sim.visionResult.size).toBe(0);
    });

    it('reachabilityResult 为空 Map', () => {
      expect(sim.reachabilityResult.size).toBe(0);
    });

    it('enemySenseResult 为空 Map', () => {
      expect(sim.enemySenseResult.size).toBe(0);
    });

    it('pathPreview 为空数组', () => {
      expect(sim.pathPreview).toEqual([]);
    });

    it('discoveredItems 为空对象', () => {
      expect(sim.discoveredItems).toEqual({});
    });

    it('hoverTargetPls 为 null', () => {
      expect(sim.hoverTargetPls).toBeNull();
    });
  });

  describe('setPlayerPos', () => {
    it('设置玩家位置', () => {
      sim.setPlayerPos(1, 5);
      expect(sim.playerPos).toEqual({ pgroup: 1, pls: 5 });
    });

    it('清空玩家位置', () => {
      sim.setPlayerPos(1, 5);
      sim.setPlayerPos(null, null);
      expect(sim.playerPos).toEqual({ pgroup: null, pls: null });
    });
  });

  describe('updateConfig', () => {
    it('部分更新 visionRange', () => {
      sim.updateConfig({ visionRange: 3 });
      expect(sim.config.visionRange).toBe(3);
      expect(sim.config.movePower).toBe(DEFAULT_SIM_CONFIG.movePower);
    });

    it('部分更新 movePower', () => {
      sim.updateConfig({ movePower: 5 });
      expect(sim.config.movePower).toBe(5);
    });

    it('部分更新 enemySenseRange', () => {
      sim.updateConfig({ enemySenseRange: 4 });
      expect(sim.config.enemySenseRange).toBe(4);
    });

    it('部分更新 discoverLimit', () => {
      sim.updateConfig({ discoverLimit: 1 });
      expect(sim.config.discoverLimit).toBe(1);
    });

    it('多字段同时更新', () => {
      sim.updateConfig({ visionRange: 5, movePower: 10 });
      expect(sim.config.visionRange).toBe(5);
      expect(sim.config.movePower).toBe(10);
    });
  });

  describe('recomputeBfs', () => {
    it('无玩家位置时清空结果', () => {
      const tiles = makeGrid3x3();
      sim.recomputeBfs(tiles);
      expect(sim.visionResult.size).toBe(0);
      expect(sim.reachabilityResult.size).toBe(0);
      expect(sim.enemySenseResult.size).toBe(0);
      expect(sim.pathPreview).toEqual([]);
    });

    it('玩家所在格无效时清空路径预览', () => {
      const tiles = makeGrid3x3();
      sim.setPlayerPos(1, 999); // pls 999 不存在
      sim.recomputeBfs(tiles);
      expect(sim.visionResult.size).toBe(0);
      expect(sim.pathPreview).toEqual([]);
    });

    it('计算视野范围（vision_range=1）', () => {
      const tiles = makeGrid3x3();
      sim.setPlayerPos(1, 5); // (1,1) 中心格
      sim.updateConfig({ visionRange: 1 });
      sim.recomputeBfs(tiles);
      // 玩家格 + 4 邻接 = 5 格（vision_range=1）
      expect(sim.visionResult.size).toBe(5);
      expect(sim.visionResult.get(5 as Pls)).toBe(0);
      expect(sim.visionResult.get(2 as Pls)).toBe(1); // 上邻
      expect(sim.visionResult.get(4 as Pls)).toBe(1); // 左邻
      expect(sim.visionResult.get(6 as Pls)).toBe(1); // 右邻
      expect(sim.visionResult.get(8 as Pls)).toBe(1); // 下邻
    });

    it('计算可达性（move_power=1）', () => {
      const tiles = makeGrid3x3();
      sim.setPlayerPos(1, 5);
      sim.updateConfig({ movePower: 1 });
      sim.recomputeBfs(tiles);
      // 玩家格 + 4 邻接 = 5 格（move_power=1）
      expect(sim.reachabilityResult.size).toBe(5);
    });

    it('计算敌人感知范围（enemy_sense_range=2）', () => {
      const tiles = makeGrid3x3();
      sim.setPlayerPos(1, 5);
      sim.updateConfig({ enemySenseRange: 2 });
      sim.recomputeBfs(tiles);
      // 3x3 网格中所有 9 格都在感知范围内
      expect(sim.enemySenseResult.size).toBe(9);
    });

    it('视野自动点亮 fogOverride', () => {
      const tiles = makeGrid3x3();
      sim.setPlayerPos(1, 5);
      sim.updateConfig({ visionRange: 1 });
      sim.recomputeBfs(tiles);
      // fogOverride[1][5] = 1（玩家格）
      // fogOverride[1][2/4/6/8] = 1（邻接格）
      expect(sim.fogOverride[1]).toBeDefined();
      expect(sim.fogOverride[1]![5 as Pls]).toBe(1);
      expect(sim.fogOverride[1]![2 as Pls]).toBe(1);
    });

    it('已有 hover 目标时重算路径预览', () => {
      const tiles = makeGrid3x3();
      sim.setPlayerPos(1, 5);
      sim.recomputeBfs(tiles);
      // 设置 hover 目标
      sim.setHoverTarget(tiles, 1 as Pls);
      expect(sim.pathPreview.length).toBeGreaterThan(0);
      // 再次 recompute 应保留路径预览
      sim.recomputeBfs(tiles);
      expect(sim.pathPreview.length).toBeGreaterThan(0);
    });

    it('hover 目标等于玩家位置时清空路径预览', () => {
      const tiles = makeGrid3x3();
      sim.setPlayerPos(1, 5);
      sim.recomputeBfs(tiles);
      sim.setHoverTarget(tiles, 5 as Pls);
      expect(sim.pathPreview).toEqual([]);
    });
  });

  describe('setHoverTarget', () => {
    it('设置有效目标时计算路径', () => {
      const tiles = makeGrid3x3();
      sim.setPlayerPos(1, 5);
      sim.recomputeBfs(tiles);
      sim.setHoverTarget(tiles, 1 as Pls);
      expect(sim.hoverTargetPls).toBe(1);
      expect(sim.pathPreview.length).toBeGreaterThan(0);
      // 路径起点为玩家位置
      expect(sim.pathPreview[0]).toBe(5);
      // 路径终点为 hover 目标
      expect(sim.pathPreview[sim.pathPreview.length - 1]).toBe(1);
    });

    it('null 目标清空路径', () => {
      const tiles = makeGrid3x3();
      sim.setPlayerPos(1, 5);
      sim.recomputeBfs(tiles);
      sim.setHoverTarget(tiles, 1 as Pls);
      sim.setHoverTarget(tiles, null);
      expect(sim.hoverTargetPls).toBeNull();
      expect(sim.pathPreview).toEqual([]);
    });

    it('无玩家位置时清空路径', () => {
      const tiles = makeGrid3x3();
      sim.setHoverTarget(tiles, 1 as Pls);
      expect(sim.hoverTargetPls).toBe(1);
      expect(sim.pathPreview).toEqual([]);
    });

    it('目标等于玩家位置时清空路径', () => {
      const tiles = makeGrid3x3();
      sim.setPlayerPos(1, 5);
      sim.recomputeBfs(tiles);
      sim.setHoverTarget(tiles, 5 as Pls);
      expect(sim.pathPreview).toEqual([]);
    });

    it('tiles 为 null 时清空路径', () => {
      sim.setPlayerPos(1, 5);
      sim.setHoverTarget(null, 1 as Pls);
      expect(sim.pathPreview).toEqual([]);
    });
  });

  describe('clearPathPreview', () => {
    it('清空 hoverTargetPls 和 pathPreview', () => {
      const tiles = makeGrid3x3();
      sim.setPlayerPos(1, 5);
      sim.recomputeBfs(tiles);
      sim.setHoverTarget(tiles, 1 as Pls);
      expect(sim.pathPreview.length).toBeGreaterThan(0);
      sim.clearPathPreview();
      expect(sim.hoverTargetPls).toBeNull();
      expect(sim.pathPreview).toEqual([]);
    });
  });

  describe('simulateExplore', () => {
    it('无玩家位置时无操作', () => {
      const tiles = makeGrid3x3();
      sim.simulateExplore(tiles);
      expect(sim.discoveredItems).toEqual({});
    });

    it('视野内无道具时不填充 discoveredItems', () => {
      const tiles = makeGrid3x3();
      sim.setPlayerPos(1, 5);
      sim.updateConfig({ visionRange: 1 });
      sim.simulateExplore(tiles);
      // 没传 itemsAtPls，所以无 discoveredItems
      expect(sim.discoveredItems).toEqual({});
    });

    it('视野内有道具时填充 discoveredItems（distance ≤ discoverLimit → 1）', () => {
      const tiles = makeGrid3x3();
      sim.setPlayerPos(1, 5);
      sim.updateConfig({ visionRange: 1, discoverLimit: 2 });
      // 在玩家格放一个道具
      const itemsAtPls: Record<Pls, Array<{ iid: number }>> = {
        5: [{ iid: 100 }],
      };
      sim.simulateExplore(tiles, itemsAtPls);
      // distance=0 ≤ 2 → discovered=1
      expect(sim.discoveredItems[5]).toBeDefined();
      expect(sim.discoveredItems[5]!.length).toBe(1);
      expect(sim.discoveredItems[5]![0]).toEqual({ iid: 100, discovered: 1 });
    });

    it('视野边缘（distance > discoverLimit → 2）', () => {
      const tiles = makeGrid3x3();
      sim.setPlayerPos(1, 5);
      sim.updateConfig({ visionRange: 2, discoverLimit: 0 });
      // 在 dist=1 的格放道具（distance=1 > 0 → discovered=2）
      const itemsAtPls: Record<Pls, Array<{ iid: number }>> = {
        2: [{ iid: 200 }],
      };
      sim.simulateExplore(tiles, itemsAtPls);
      expect(sim.discoveredItems[2]).toBeDefined();
      expect(sim.discoveredItems[2]![0]).toEqual({ iid: 200, discovered: 2 });
    });

    it('玩家格 distance=0 始终 discovered=1（即使 discoverLimit=0）', () => {
      const tiles = makeGrid3x3();
      sim.setPlayerPos(1, 5);
      sim.updateConfig({ visionRange: 1, discoverLimit: 0 });
      const itemsAtPls: Record<Pls, Array<{ iid: number }>> = {
        5: [{ iid: 300 }],
      };
      sim.simulateExplore(tiles, itemsAtPls);
      // distance=0 ≤ 0 → discovered=1
      expect(sim.discoveredItems[5]![0]).toEqual({ iid: 300, discovered: 1 });
    });
  });

  describe('clearBfsResults', () => {
    it('清空所有 BFS 结果', () => {
      const tiles = makeGrid3x3();
      sim.setPlayerPos(1, 5);
      sim.recomputeBfs(tiles);
      expect(sim.visionResult.size).toBeGreaterThan(0);
      sim.clearBfsResults();
      expect(sim.visionResult.size).toBe(0);
      expect(sim.reachabilityResult.size).toBe(0);
      expect(sim.enemySenseResult.size).toBe(0);
      expect(sim.pathPreview).toEqual([]);
      expect(sim.hoverTargetPls).toBeNull();
    });
  });

  describe('resetSim', () => {
    it('重置整个 Simulate 状态', () => {
      const tiles = makeGrid3x3();
      sim.setPlayerPos(1, 5);
      sim.recomputeBfs(tiles);
      sim.setHoverTarget(tiles, 1 as Pls);
      expect(sim.playerPos.pls).toBe(5);
      expect(sim.visionResult.size).toBeGreaterThan(0);

      sim.resetSim();
      expect(sim.playerPos).toEqual({ pgroup: null, pls: null });
      expect(sim.fogOverride).toEqual({});
      expect(sim.discoveredItems).toEqual({});
      expect(sim.visionResult.size).toBe(0);
      expect(sim.pathPreview).toEqual([]);
      expect(sim.hoverTargetPls).toBeNull();
    });

    it('resetSim 不重置 config（独立维度）', () => {
      sim.updateConfig({ visionRange: 5 });
      sim.resetSim();
      expect(sim.config.visionRange).toBe(5);
    });
  });
});
