//
// overlayStore 单元测试（对齐 NEW_DESIGN.md §7.3 M4：覆盖率 ≥ 85%）
//
// 覆盖点：
//   - state：flags（fog / vision / reachability / tideHeatmap / wilditem / poi / enemy）
//   - actions：toggle / setFlag / resetAll
//   - 边界：默认全 false / toggle 无值时翻转 / setFlag 强制值
//
// P4 扩展：O-8 分布工作区引入 wilditem / poi / enemy 三个分布叠层 flag，
// 对应 OverlayWilditemDistribution / OverlayPoiDistribution / OverlayEnemyDistribution 组件。

import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useOverlayStore } from '@/stores/overlayStore';

describe('overlayStore', () => {
  let overlay: ReturnType<typeof useOverlayStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    overlay = useOverlayStore();
  });

  describe('初始状态', () => {
    it('所有 flag 默认为 false', () => {
      expect(overlay.flags).toEqual({
        fog: false,
        vision: false,
        reachability: false,
        tideHeatmap: false,
        wilditem: false,
        poi: false,
        enemy: false,
      });
    });

    it('每个 flag 单独检查', () => {
      expect(overlay.flags.fog).toBe(false);
      expect(overlay.flags.vision).toBe(false);
      expect(overlay.flags.reachability).toBe(false);
      expect(overlay.flags.tideHeatmap).toBe(false);
      expect(overlay.flags.wilditem).toBe(false);
      expect(overlay.flags.poi).toBe(false);
      expect(overlay.flags.enemy).toBe(false);
    });
  });

  describe('toggle', () => {
    it('无值时翻转 false → true', () => {
      overlay.toggle('fog');
      expect(overlay.flags.fog).toBe(true);
    });

    it('无值时翻转 true → false', () => {
      overlay.toggle('fog');
      overlay.toggle('fog');
      expect(overlay.flags.fog).toBe(false);
    });

    it('传 true 强制开启', () => {
      overlay.toggle('fog', true);
      expect(overlay.flags.fog).toBe(true);
    });

    it('传 false 强制关闭', () => {
      overlay.toggle('fog');
      overlay.toggle('fog', false);
      expect(overlay.flags.fog).toBe(false);
    });

    it('toggle 各叠层独立', () => {
      overlay.toggle('fog', true);
      overlay.toggle('vision', true);
      overlay.toggle('reachability', true);
      overlay.toggle('tideHeatmap', true);
      overlay.toggle('wilditem', true);
      overlay.toggle('poi', true);
      overlay.toggle('enemy', true);
      expect(overlay.flags.fog).toBe(true);
      expect(overlay.flags.vision).toBe(true);
      expect(overlay.flags.reachability).toBe(true);
      expect(overlay.flags.tideHeatmap).toBe(true);
      expect(overlay.flags.wilditem).toBe(true);
      expect(overlay.flags.poi).toBe(true);
      expect(overlay.flags.enemy).toBe(true);
    });
  });

  describe('setFlag', () => {
    it('setFlag 强制设置为 true', () => {
      overlay.setFlag('fog', true);
      expect(overlay.flags.fog).toBe(true);
    });

    it('setFlag 强制设置为 false', () => {
      overlay.setFlag('fog', true);
      overlay.setFlag('fog', false);
      expect(overlay.flags.fog).toBe(false);
    });

    it('setFlag 不影响其他 flag', () => {
      overlay.setFlag('fog', true);
      overlay.setFlag('vision', true);
      overlay.setFlag('fog', false);
      expect(overlay.flags.fog).toBe(false);
      expect(overlay.flags.vision).toBe(true);
    });

    it('setFlag 对所有 key 都生效', () => {
      overlay.setFlag('fog', true);
      overlay.setFlag('vision', true);
      overlay.setFlag('reachability', true);
      overlay.setFlag('tideHeatmap', true);
      overlay.setFlag('wilditem', true);
      overlay.setFlag('poi', true);
      overlay.setFlag('enemy', true);
      expect(overlay.flags).toEqual({
        fog: true,
        vision: true,
        reachability: true,
        tideHeatmap: true,
        wilditem: true,
        poi: true,
        enemy: true,
      });
    });
  });

  describe('resetAll', () => {
    it('重置所有 flag 为 false', () => {
      overlay.setFlag('fog', true);
      overlay.setFlag('vision', true);
      overlay.setFlag('reachability', true);
      overlay.setFlag('tideHeatmap', true);
      overlay.setFlag('wilditem', true);
      overlay.setFlag('poi', true);
      overlay.setFlag('enemy', true);

      overlay.resetAll();

      expect(overlay.flags).toEqual({
        fog: false,
        vision: false,
        reachability: false,
        tideHeatmap: false,
        wilditem: false,
        poi: false,
        enemy: false,
      });
    });

    it('已是初始状态时无变化', () => {
      overlay.resetAll();
      expect(overlay.flags).toEqual({
        fog: false,
        vision: false,
        reachability: false,
        tideHeatmap: false,
        wilditem: false,
        poi: false,
        enemy: false,
      });
    });
  });
});
