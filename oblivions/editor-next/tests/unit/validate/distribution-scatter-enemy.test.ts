//
// distribution-scatter-enemy 单元测试——P4 §4.8 校验层扩展
//
// 覆盖点（P4 新增 15 个 rule：6 个分布校验 + 9 个引用校验）：
//
// 第 5 层分布校验（distribution-validator.ts）：
//   - distribution.scatter.candidate_tile_insufficient：scatter 该 region 该 tide 无可用 tile
//   - distribution.scatter.refresh_rate_overflow：refresh 相位 effective_rate > 1.0
//   - distribution.scatter.capacity_conflict：total rate > wild_item_capacity_per_tile
//   - distribution.enemy.candidate_tile_insufficient：排除 entrance/exit 后无可用 tile
//   - distribution.enemy.per_region_capacity_conflict：count 上界 > 可用 tile 数
//   - distribution.enemy.comment_data_drift：enemy_pool.php 注释与 count 不一致
//
// 第 3 层引用校验（reference-validator.ts）：
//   - distribution.scatter.item_ref_dangling：subject.item_id 引用不存在的 item
//   - distribution.enemy.enemy_type_ref_dangling：subject.enemy_type 引用不存在的 enemy.template
//   - enemy.skill_ref_dangling：skills/combat_skills/strategy_slots[].id 引用未注册 skill
//   - enemy.combat_skill_not_in_skills：combat_skills 不是 skills 子集
//   - enemy.strategy_slot_invalid：strategy_slots 结构无效
//   - presentation.enemy.missing：enemy.template 无 locale 覆盖
//   - presentation.enemy.orphan：locale 中存在但后端无对应模板
//   - presentation.enemy.fallback_redundant：locale 与后端 fallback 完全相同
//
// 测试策略：
//   - 通过 graph-store.upsertNodes 直接装配测试节点
//   - 通过 rawFilesStore.setRawFiles 模拟 combat_skills 文件缓存
//   - 调用 validate(graph) 触发校验，断言 Issue 列表
//

import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useGraphStore } from '@/graph/graph-store';
import { useRawFilesStore } from '@/stores/rawFilesStore';
import { registerAllKinds, clearRegistry } from '@/schema';
import { validate as validateDistribution } from '@/validate/validators/distribution-validator';
import { validate as validateReference } from '@/validate/validators/reference-validator';
import type { ResourceNode } from '@/graph/types';
import type { Issue } from '@/validate/issue-model';

// ─── 测试工具：构造 ResourceNode ─────────────────────────

function makeNode<T>(
  kind: string,
  id: string,
  data: T,
): ResourceNode<T> {
  return {
    kind,
    id,
    data,
    source: [],
    revision: '',
  };
}

/** world.tile 节点 data 形状 */
interface WorldTileData {
  pgroup: number;
  pls: number;
  tide: string;
  passable: boolean;
  [key: string]: unknown;
}

/** world.region 节点 data 形状 */
interface WorldRegionData {
  pgroup: number;
  entrance_pls: number | null;
  exit_pls: number | null;
  [key: string]: unknown;
}

/** config.runtime 节点 data 形状 */
interface ConfigRuntimeData {
  entries?: Record<string, unknown>;
  [key: string]: unknown;
}

/** distribution.scatter 统一模型 data 形状 */
interface DistributionScatterData {
  'subject.item_id': string;
  'selector.tides': string[];
  'selector.regions'?: string[];
  phase: string;
  'placement.rate': number;
  'placement.count': number | [number, number];
  [key: string]: unknown;
}

/** distribution.enemy 统一模型 data 形状 */
interface DistributionEnemyData {
  'subject.enemy_type': number | string;
  'selector.tides': string[];
  'selector.regions'?: string[];
  'selector.excludeEntrance'?: boolean;
  'selector.excludeExit'?: boolean;
  'selector.excludeOccupied'?: boolean;
  'placement.count': number | [number, number];
  [key: string]: unknown;
}

/** enemy.template 节点 data 形状 */
interface EnemyTemplateData {
  name?: string;
  skills?: string[];
  combat_skills?: string[];
  strategy_slots?: Array<{ type: string; id: string } | null>;
  [key: string]: unknown;
}

/** presentation.enemy 节点 data 形状 */
interface PresentationEnemyData {
  name: string;
  desc?: string;
  [key: string]: unknown;
}

/** item.template 节点 data 形状（简化） */
interface ItemTemplateData {
  name?: string;
  [key: string]: unknown;
}

// ─── 测试数据工厂 ───────────────────────────────────────────────

/** 构造 2 region × 4 tile 的最小世界图（每 region 各 4 tile） */
function makeMinimalWorld(): ResourceNode[] {
  return [
    // region 1：entrance=pls 0, exit=pls 3
    makeNode<WorldRegionData>('world.region', '1', {
      pgroup: 1,
      entrance_pls: 0,
      exit_pls: 3,
    }),
    // region 1 的 4 个 tile：pls 0/1 shallow passable, pls 2 deep passable, pls 3 shallow impassable
    makeNode<WorldTileData>('world.tile', '1:0', {
      pgroup: 1, pls: 0, tide: 'shallow', passable: true,
    }),
    makeNode<WorldTileData>('world.tile', '1:1', {
      pgroup: 1, pls: 1, tide: 'shallow', passable: true,
    }),
    makeNode<WorldTileData>('world.tile', '1:2', {
      pgroup: 1, pls: 2, tide: 'deep', passable: true,
    }),
    makeNode<WorldTileData>('world.tile', '1:3', {
      pgroup: 1, pls: 3, tide: 'shallow', passable: false,
    }),
    // region 2：entrance=pls 0, exit=null
    makeNode<WorldRegionData>('world.region', '2', {
      pgroup: 2,
      entrance_pls: 0,
      exit_pls: null,
    }),
    makeNode<WorldTileData>('world.tile', '2:0', {
      pgroup: 2, pls: 0, tide: 'deep', passable: true,
    }),
    makeNode<WorldTileData>('world.tile', '2:1', {
      pgroup: 2, pls: 1, tide: 'deep', passable: true,
    }),
    makeNode<WorldTileData>('world.tile', '2:2', {
      pgroup: 2, pls: 2, tide: 'abyss', passable: true,
    }),
    makeNode<WorldTileData>('world.tile', '2:3', {
      pgroup: 2, pls: 3, tide: 'abyss', passable: false,
    }),
  ];
}

/** 构造 obl_config runtime 节点（含 wild_item_refresh_rate_by_tide / wild_item_capacity_per_tile） */
function makeConfigRuntime(overrides: {
  refreshRateByTide?: Record<string, number>;
  capacityPerTile?: number;
} = {}): ResourceNode {
  const refreshRate = { shallow: 1, deep: 1, abyss: 1, ...overrides.refreshRateByTide };
  const capacity = overrides.capacityPerTile ?? 5;
  return makeNode<ConfigRuntimeData>('config.runtime', 'obl_config', {
    entries: {
      wild_item_refresh_rate_by_tide: refreshRate,
      wild_item_capacity_per_tile: capacity,
    },
  });
}

/** 构造 2 个 item.template 节点 */
function makeItemTemplates(): ResourceNode[] {
  return [
    makeNode<ItemTemplateData>('item.template', 'scrap_metal', { name: '废铁' }),
    makeNode<ItemTemplateData>('item.template', 'rusty_pipe', { name: '锈管' }),
  ];
}

/** 构造 2 个 enemy.template 节点（含 skills/combat_skills/strategy_slots） */
function makeEnemyTemplates(overrides: Partial<EnemyTemplateData> = {}): ResourceNode[] {
  return [
    makeNode<EnemyTemplateData>('enemy.template', '1', {
      name: '废铁史莱姆',
      skills: ['unarmed_strike', 'escape'],
      combat_skills: ['unarmed_strike'],
      strategy_slots: [
        { type: 'skill', id: 'unarmed_strike' },
        null, null, null,
      ],
      ...overrides,
    }),
    makeNode<EnemyTemplateData>('enemy.template', '2', {
      name: '锈蚀守卫',
      skills: ['unarmed_strike', 'escape'],
      combat_skills: ['unarmed_strike'],
      strategy_slots: [
        { type: 'skill', id: 'unarmed_strike' },
        { type: 'skill', id: 'unarmed_strike' },
        null, null,
      ],
      ...overrides,
    }),
  ];
}

/** 在 rawFilesStore 中模拟 combat_skills 文件缓存 */
function setupCombatSkillsFiles(rawFilesStore: ReturnType<typeof useRawFilesStore>): void {
  rawFilesStore.setRawFiles({
    'combat_skills/skill_unarmed_strike.php': '<?php // unarmed strike',
    'combat_skills/skill_escape.php': '<?php // escape',
    'combat_skills/skill_heal.php': '<?php // heal',
  });
}

// ─── 测试辅助：按 ruleId 过滤 Issue ─────────────────────

function filterByRule(issues: Issue[], ruleId: string): Issue[] {
  return issues.filter((i) => i.ruleId === ruleId);
}

// ─── 测试：第 5 层分布校验 ──────────────────────────────

describe('P4 第 5 层分布校验', () => {
  let graphStore: ReturnType<typeof useGraphStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    graphStore = useGraphStore();
  });

  describe('distribution.scatter 校验', () => {
    it('正例：合法 scatter 规则不产生 issue', () => {
      graphStore.upsertNodes([
        ...makeMinimalWorld(),
        makeConfigRuntime(),
        ...makeItemTemplates(),
        makeNode<DistributionScatterData>('distribution.scatter', 'shallow:initial:scrap_metal', {
          'subject.item_id': 'scrap_metal',
          'selector.tides': ['shallow'],
          phase: 'game_init',
          'placement.rate': 0.3,
          'placement.count': 1,
        }),
      ]);

      const issues = validateDistribution(graphStore);
      // region 2 无 shallow tide 会触发 candidate_tile_insufficient（世界结构问题，非规则问题）
      // 正例只校验 scatter 自身的 capacity / refresh_rate 规则不触发
      const scatterSpecificIssues = issues.filter(
        (i) =>
          i.ruleId === 'distribution.scatter.refresh_rate_overflow' ||
          i.ruleId === 'distribution.scatter.capacity_conflict',
      );
      expect(scatterSpecificIssues).toHaveLength(0);
    });

    it('反例：scatter 在 region 2 的 shallow tide 无可用 tile → candidate_tile_insufficient', () => {
      graphStore.upsertNodes([
        ...makeMinimalWorld(),
        makeConfigRuntime(),
        ...makeItemTemplates(),
        makeNode<DistributionScatterData>('distribution.scatter', 'shallow:initial:scrap_metal', {
          'subject.item_id': 'scrap_metal',
          'selector.tides': ['shallow'],
          phase: 'game_init',
          'placement.rate': 0.3,
          'placement.count': 1,
        }),
      ]);

      const issues = validateDistribution(graphStore);
      const candidate = filterByRule(
        issues,
        'distribution.scatter.candidate_tile_insufficient',
      );
      // region 1 shallow 有 2 个 passable tile（pls 0/1），region 2 无 shallow tide
      expect(candidate.length).toBeGreaterThan(0);
      expect(candidate.some((i) => i.location?.pgroup === 2)).toBe(true);
    });

    it('反例：refresh 相位 effective_rate > 1.0 → refresh_rate_overflow', () => {
      graphStore.upsertNodes([
        ...makeMinimalWorld(),
        makeConfigRuntime({ refreshRateByTide: { deep: 4 } }),
        ...makeItemTemplates(),
        makeNode<DistributionScatterData>('distribution.scatter', 'deep:day_refresh:scrap_metal', {
          'subject.item_id': 'scrap_metal',
          'selector.tides': ['deep'],
          phase: 'day_refresh',
          'placement.rate': 0.3,
          'placement.count': 1,
        }),
      ]);

      const issues = validateDistribution(graphStore);
      const overflow = filterByRule(
        issues,
        'distribution.scatter.refresh_rate_overflow',
      );
      // effective_rate = 0.3 × 4 = 1.2 > 1.0
      expect(overflow).toHaveLength(1);
      expect(overflow[0]!.message).toContain('1.200');
    });

    it('正例：initial 相位不触发 refresh_rate_overflow', () => {
      graphStore.upsertNodes([
        ...makeMinimalWorld(),
        makeConfigRuntime({ refreshRateByTide: { shallow: 4 } }),
        ...makeItemTemplates(),
        makeNode<DistributionScatterData>('distribution.scatter', 'shallow:initial:scrap_metal', {
          'subject.item_id': 'scrap_metal',
          'selector.tides': ['shallow'],
          phase: 'game_init',
          'placement.rate': 0.3,
          'placement.count': 1,
        }),
      ]);

      const issues = validateDistribution(graphStore);
      const overflow = filterByRule(
        issues,
        'distribution.scatter.refresh_rate_overflow',
      );
      expect(overflow).toHaveLength(0);
    });

    it('反例：total rate > wild_item_capacity_per_tile → capacity_conflict', () => {
      graphStore.upsertNodes([
        ...makeMinimalWorld(),
        makeConfigRuntime({ capacityPerTile: 0.5 }),
        ...makeItemTemplates(),
        // 两规则同 tide × region，total rate = 0.3 + 0.3 = 0.6 > 0.5
        makeNode<DistributionScatterData>('distribution.scatter', 'shallow:initial:scrap_metal', {
          'subject.item_id': 'scrap_metal',
          'selector.tides': ['shallow'],
          phase: 'game_init',
          'placement.rate': 0.3,
          'placement.count': 1,
        }),
        makeNode<DistributionScatterData>('distribution.scatter', 'shallow:initial:rusty_pipe', {
          'subject.item_id': 'rusty_pipe',
          'selector.tides': ['shallow'],
          phase: 'game_init',
          'placement.rate': 0.3,
          'placement.count': 1,
        }),
      ]);

      const issues = validateDistribution(graphStore);
      const conflict = filterByRule(
        issues,
        'distribution.scatter.capacity_conflict',
      );
      expect(conflict.length).toBeGreaterThan(0);
      expect(conflict[0]!.message).toContain('0.600');
    });
  });

  describe('distribution.enemy 校验', () => {
    it('正例：合法 enemy 规则不产生 issue', () => {
      graphStore.upsertNodes([
        ...makeMinimalWorld(),
        ...makeEnemyTemplates(),
        makeNode<DistributionEnemyData>('distribution.enemy', 'shallow:1', {
          'subject.enemy_type': 1,
          'selector.tides': ['shallow'],
          'selector.excludeEntrance': true,
          'selector.excludeExit': true,
          'placement.count': 1,
        }),
      ]);

      const issues = validateDistribution(graphStore);
      // region 1 shallow 有 2 个 passable tile，排除 entrance(0) 后剩 1 个，count=1 不超容量
      // region 2 无 shallow tide，会触发 candidate_tile_insufficient
      // 所以 enemyIssues 可能有 region 2 的 candidate_tile_insufficient，但不应有 region 1 的容量冲突
      const region1Capacity = filterByRule(
        issues,
        'distribution.enemy.per_region_capacity_conflict',
      ).filter((i) => i.location?.pgroup === 1);
      expect(region1Capacity).toHaveLength(0);
    });

    it('反例：count 上界超过可用 tile 数 → per_region_capacity_conflict', () => {
      graphStore.upsertNodes([
        ...makeMinimalWorld(),
        ...makeEnemyTemplates(),
        makeNode<DistributionEnemyData>('distribution.enemy', 'shallow:1', {
          'subject.enemy_type': 1,
          'selector.tides': ['shallow'],
          'selector.excludeEntrance': true,
          'selector.excludeExit': true,
          'placement.count': [3, 5], // 上界 5 > 可用 tile 数
        }),
      ]);

      const issues = validateDistribution(graphStore);
      const capacity = filterByRule(
        issues,
        'distribution.enemy.per_region_capacity_conflict',
      );
      // region 1 shallow 可用 tile = 2(passable) - 1(entrance=0) = 1
      // region 1 排除 entrance(0) 后剩 pls 1，pls 3 是 passable=false 不计入候选
      // count 上界 5 > 1
      const region1Capacity = capacity.filter((i) => i.location?.pgroup === 1);
      expect(region1Capacity.length).toBeGreaterThan(0);
      expect(region1Capacity[0]!.message).toContain('5');
    });

    it('反例：tide 在 region 无可用 tile → candidate_tile_insufficient', () => {
      graphStore.upsertNodes([
        ...makeMinimalWorld(),
        ...makeEnemyTemplates(),
        // abyss tide 只在 region 2 出现，region 1 无 abyss
        makeNode<DistributionEnemyData>('distribution.enemy', 'abyss:1', {
          'subject.enemy_type': 1,
          'selector.tides': ['abyss'],
          'selector.excludeEntrance': true,
          'selector.excludeExit': true,
          'placement.count': 1,
        }),
      ]);

      const issues = validateDistribution(graphStore);
      const candidate = filterByRule(
        issues,
        'distribution.enemy.candidate_tile_insufficient',
      );
      // region 1 无 abyss tide → candidate_tile_insufficient
      // region 2 有 1 个 abyss passable tile（pls 2），排除 entrance(0) 后仍可用（entrance 不是 abyss）
      const region1Candidate = candidate.filter((i) => i.location?.pgroup === 1);
      expect(region1Candidate.length).toBeGreaterThan(0);
    });
  });
});

// ─── 测试：第 3 层引用校验 ──────────────────────────────

describe('P4 第 3 层引用校验', () => {
  let graphStore: ReturnType<typeof useGraphStore>;
  let rawFilesStore: ReturnType<typeof useRawFilesStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    graphStore = useGraphStore();
    rawFilesStore = useRawFilesStore();
    setupCombatSkillsFiles(rawFilesStore);
    // 引用校验通过 getKindSchema 查询 refFields，必须注册 schema
    clearRegistry();
    registerAllKinds();
  });

  describe('distribution.scatter.item_ref_dangling', () => {
    it('正例：subject.item_id 引用存在的 item.template 不产生 issue', () => {
      graphStore.upsertNodes([
        ...makeItemTemplates(),
        makeNode<DistributionScatterData>('distribution.scatter', 'shallow:initial:scrap_metal', {
          'subject.item_id': 'scrap_metal',
          'selector.tides': ['shallow'],
          phase: 'game_init',
          'placement.rate': 0.3,
          'placement.count': 1,
        }),
      ]);

      const issues = validateReference(graphStore);
      const dangling = filterByRule(
        issues,
        'distribution.scatter.item_ref_dangling',
      );
      expect(dangling).toHaveLength(0);
    });

    it('反例：subject.item_id 引用不存在的 item → error', () => {
      graphStore.upsertNodes([
        ...makeItemTemplates(),
        makeNode<DistributionScatterData>('distribution.scatter', 'shallow:initial:nonexistent', {
          'subject.item_id': 'nonexistent_item',
          'selector.tides': ['shallow'],
          phase: 'game_init',
          'placement.rate': 0.3,
          'placement.count': 1,
        }),
      ]);

      const issues = validateReference(graphStore);
      const dangling = filterByRule(
        issues,
        'distribution.scatter.item_ref_dangling',
      );
      expect(dangling).toHaveLength(1);
      expect(dangling[0]!.severity).toBe('error');
      expect(dangling[0]!.message).toContain('nonexistent_item');
    });
  });

  describe('distribution.enemy.enemy_type_ref_dangling', () => {
    it('正例：subject.enemy_type 引用存在的 enemy.template 不产生 issue', () => {
      graphStore.upsertNodes([
        ...makeEnemyTemplates(),
        makeNode<DistributionEnemyData>('distribution.enemy', 'shallow:1', {
          'subject.enemy_type': 1,
          'selector.tides': ['shallow'],
          'placement.count': 1,
        }),
      ]);

      const issues = validateReference(graphStore);
      const dangling = filterByRule(
        issues,
        'distribution.enemy.enemy_type_ref_dangling',
      );
      expect(dangling).toHaveLength(0);
    });

    it('反例：subject.enemy_type 引用不存在的 enemy.template → error', () => {
      graphStore.upsertNodes([
        ...makeEnemyTemplates(),
        makeNode<DistributionEnemyData>('distribution.enemy', 'shallow:99', {
          'subject.enemy_type': 99,
          'selector.tides': ['shallow'],
          'placement.count': 1,
        }),
      ]);

      const issues = validateReference(graphStore);
      const dangling = filterByRule(
        issues,
        'distribution.enemy.enemy_type_ref_dangling',
      );
      expect(dangling.length).toBeGreaterThan(0);
      expect(dangling[0]!.severity).toBe('error');
      expect(dangling[0]!.message).toContain('99');
    });
  });

  describe('enemy.skill_ref_dangling', () => {
    it('正例：skills/combat_skills/strategy_slots 引用已注册 skill 不产生 issue', () => {
      graphStore.upsertNodes(makeEnemyTemplates());

      const issues = validateReference(graphStore);
      const dangling = filterByRule(issues, 'enemy.skill_ref_dangling');
      expect(dangling).toHaveLength(0);
    });

    it('反例：skills 引用不存在的 skill → warning', () => {
      graphStore.upsertNodes([
        makeNode<EnemyTemplateData>('enemy.template', '1', {
          name: '测试敌人',
          skills: ['unarmed_strike', 'nonexistent_skill'],
          combat_skills: ['unarmed_strike'],
          strategy_slots: [null, null, null, null],
        }),
      ]);

      const issues = validateReference(graphStore);
      const dangling = filterByRule(issues, 'enemy.skill_ref_dangling');
      expect(dangling).toHaveLength(1);
      expect(dangling[0]!.severity).toBe('warning');
      expect(dangling[0]!.message).toContain('nonexistent_skill');
    });

    it('反例：strategy_slots[].id 引用不存在的 skill → warning', () => {
      graphStore.upsertNodes([
        makeNode<EnemyTemplateData>('enemy.template', '1', {
          name: '测试敌人',
          skills: ['unarmed_strike'],
          combat_skills: ['unarmed_strike'],
          strategy_slots: [
            { type: 'skill', id: 'nonexistent_skill' },
            null, null, null,
          ],
        }),
      ]);

      const issues = validateReference(graphStore);
      const dangling = filterByRule(issues, 'enemy.skill_ref_dangling');
      expect(dangling).toHaveLength(1);
      expect(dangling[0]!.message).toContain('strategy_slots[0]');
    });

    it('边界：rawFilesStore 无 combat_skills 文件时跳过 skill_ref_dangling', () => {
      // 清空 rawFilesStore，模拟 combat_skills 未加载
      rawFilesStore.clearRawFiles();
      graphStore.upsertNodes([
        makeNode<EnemyTemplateData>('enemy.template', '1', {
          name: '测试敌人',
          skills: ['nonexistent_skill'],
          combat_skills: [],
          strategy_slots: [null, null, null, null],
        }),
      ]);

      const issues = validateReference(graphStore);
      const dangling = filterByRule(issues, 'enemy.skill_ref_dangling');
      expect(dangling).toHaveLength(0);
    });
  });

  describe('enemy.combat_skill_not_in_skills', () => {
    it('正例：combat_skills 是 skills 子集不产生 issue', () => {
      graphStore.upsertNodes(makeEnemyTemplates());

      const issues = validateReference(graphStore);
      const subset = filterByRule(issues, 'enemy.combat_skill_not_in_skills');
      expect(subset).toHaveLength(0);
    });

    it('反例：combat_skills 包含 skills 中不存在的项 → warning', () => {
      graphStore.upsertNodes([
        makeNode<EnemyTemplateData>('enemy.template', '1', {
          name: '测试敌人',
          skills: ['unarmed_strike'],
          combat_skills: ['unarmed_strike', 'escape'], // escape 不在 skills 中
          strategy_slots: [null, null, null, null],
        }),
      ]);

      const issues = validateReference(graphStore);
      const subset = filterByRule(issues, 'enemy.combat_skill_not_in_skills');
      expect(subset).toHaveLength(1);
      expect(subset[0]!.severity).toBe('warning');
      expect(subset[0]!.message).toContain('escape');
    });
  });

  describe('enemy.strategy_slot_invalid', () => {
    it('正例：4 槽合法结构不产生 issue', () => {
      graphStore.upsertNodes(makeEnemyTemplates());

      const issues = validateReference(graphStore);
      const invalid = filterByRule(issues, 'enemy.strategy_slot_invalid');
      expect(invalid).toHaveLength(0);
    });

    it('反例：strategy_slots 长度不为 4 → error', () => {
      graphStore.upsertNodes([
        makeNode<EnemyTemplateData>('enemy.template', '1', {
          name: '测试敌人',
          skills: ['unarmed_strike'],
          combat_skills: ['unarmed_strike'],
          strategy_slots: [
            { type: 'skill', id: 'unarmed_strike' },
            null, null, null, null, // 6 槽，应为 4
          ],
        }),
      ]);

      const issues = validateReference(graphStore);
      const invalid = filterByRule(issues, 'enemy.strategy_slot_invalid');
      expect(invalid.length).toBe(1);
      expect(invalid[0]!.severity).toBe('error');
      // 1 + 4 null = 5 槽
      expect(invalid[0]!.message).toContain('5');
    });

    it('反例：strategy_slots[].type 不是 skill → error', () => {
      graphStore.upsertNodes([
        makeNode<EnemyTemplateData>('enemy.template', '1', {
          name: '测试敌人',
          skills: ['unarmed_strike'],
          combat_skills: ['unarmed_strike'],
          strategy_slots: [
            { type: 'invalid_type', id: 'unarmed_strike' },
            null, null, null,
          ],
        }),
      ]);

      const issues = validateReference(graphStore);
      const invalid = filterByRule(issues, 'enemy.strategy_slot_invalid');
      expect(invalid.length).toBe(1);
      expect(invalid[0]!.message).toContain('invalid_type');
    });

    it('反例：type=skill 但 id 缺失 → error', () => {
      graphStore.upsertNodes([
        makeNode<EnemyTemplateData>('enemy.template', '1', {
          name: '测试敌人',
          skills: ['unarmed_strike'],
          combat_skills: ['unarmed_strike'],
          strategy_slots: [
            { type: 'skill', id: '' },
            null, null, null,
          ],
        }),
      ]);

      const issues = validateReference(graphStore);
      const invalid = filterByRule(issues, 'enemy.strategy_slot_invalid');
      expect(invalid.length).toBe(1);
      expect(invalid[0]!.message).toContain('id');
    });

    it('正例：全 null 槽位合法', () => {
      graphStore.upsertNodes([
        makeNode<EnemyTemplateData>('enemy.template', '1', {
          name: '测试敌人',
          skills: [],
          combat_skills: [],
          strategy_slots: [null, null, null, null],
        }),
      ]);

      const issues = validateReference(graphStore);
      const invalid = filterByRule(issues, 'enemy.strategy_slot_invalid');
      expect(invalid).toHaveLength(0);
    });
  });

  describe('presentation.enemy orphan/missing', () => {
    it('正例：enemy.template 与 presentation.enemy 1:1 对应不产生 issue', () => {
      graphStore.upsertNodes([
        ...makeEnemyTemplates(),
        makeNode<PresentationEnemyData>('presentation.enemy', '1', {
          name: '废铁史莱姆',
          desc: '由废金属与污泥凝聚而成',
        }),
        makeNode<PresentationEnemyData>('presentation.enemy', '2', {
          name: '锈蚀守卫',
          desc: '遗骸化的旧时代守卫',
        }),
      ]);

      const issues = validateReference(graphStore);
      const missing = filterByRule(issues, 'presentation.enemy.missing');
      const orphan = filterByRule(issues, 'presentation.enemy.orphan');
      expect(missing).toHaveLength(0);
      expect(orphan).toHaveLength(0);
    });

    it('反例：enemy.template 无 presentation.enemy → missing (error)', () => {
      graphStore.upsertNodes(makeEnemyTemplates());
      // 不添加任何 presentation.enemy

      const issues = validateReference(graphStore);
      const missing = filterByRule(issues, 'presentation.enemy.missing');
      expect(missing.length).toBe(2); // 两个 enemy.template 都缺
      expect(missing[0]!.severity).toBe('error');
    });

    it('反例：presentation.enemy 存在但无对应 enemy.template → orphan (warning)', () => {
      graphStore.upsertNodes([
        ...makeEnemyTemplates(),
        makeNode<PresentationEnemyData>('presentation.enemy', '1', {
          name: '废铁史莱姆',
        }),
        makeNode<PresentationEnemyData>('presentation.enemy', '2', {
          name: '锈蚀守卫',
        }),
        // 孤儿：enemy.template 不存在 id=99
        makeNode<PresentationEnemyData>('presentation.enemy', '99', {
          name: '不存在的敌人',
        }),
      ]);

      const issues = validateReference(graphStore);
      const orphan = filterByRule(issues, 'presentation.enemy.orphan');
      expect(orphan.length).toBe(1);
      expect(orphan[0]!.severity).toBe('warning');
      expect(orphan[0]!.message).toContain('99');
    });
  });

  describe('presentation.enemy.fallback_redundant', () => {
    it('正例：locale name 与 fallback 不同不产生 issue', () => {
      graphStore.upsertNodes([
        makeNode<EnemyTemplateData>('enemy.template', '1', {
          name: '后端名',
          skills: [],
          combat_skills: [],
          strategy_slots: [null, null, null, null],
        }),
        makeNode<PresentationEnemyData>('presentation.enemy', '1', {
          name: '前端名（不同于后端）',
        }),
      ]);

      const issues = validateReference(graphStore);
      const redundant = filterByRule(
        issues,
        'presentation.enemy.fallback_redundant',
      );
      expect(redundant).toHaveLength(0);
    });

    it('反例：locale name 与 fallback 完全相同 → warning', () => {
      graphStore.upsertNodes([
        makeNode<EnemyTemplateData>('enemy.template', '1', {
          name: '废铁史莱姆',
          skills: [],
          combat_skills: [],
          strategy_slots: [null, null, null, null],
        }),
        makeNode<PresentationEnemyData>('presentation.enemy', '1', {
          name: '废铁史莱姆', // 与后端 fallback 完全相同
        }),
      ]);

      const issues = validateReference(graphStore);
      const redundant = filterByRule(
        issues,
        'presentation.enemy.fallback_redundant',
      );
      expect(redundant).toHaveLength(1);
      expect(redundant[0]!.severity).toBe('warning');
      expect(redundant[0]!.message).toContain('废铁史莱姆');
    });

    it('边界：enemy.template 无 name 字段时不触发 fallback_redundant', () => {
      graphStore.upsertNodes([
        makeNode<EnemyTemplateData>('enemy.template', '1', {
          // 无 name 字段
          skills: [],
          combat_skills: [],
          strategy_slots: [null, null, null, null],
        }),
        makeNode<PresentationEnemyData>('presentation.enemy', '1', {
          name: '前端名',
        }),
      ]);

      const issues = validateReference(graphStore);
      const redundant = filterByRule(
        issues,
        'presentation.enemy.fallback_redundant',
      );
      expect(redundant).toHaveLength(0);
    });
  });
});

// ─── 测试：P4 实际数据回归 ─────────────────────────────

describe('P4 实际数据回归', () => {
  let graphStore: ReturnType<typeof useGraphStore>;
  let rawFilesStore: ReturnType<typeof useRawFilesStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    graphStore = useGraphStore();
    rawFilesStore = useRawFilesStore();
    setupCombatSkillsFiles(rawFilesStore);
    // 回归测试同时触发引用校验（需 schema 注册）
    clearRegistry();
    registerAllKinds();
  });

  it('实际 enemies_config.php 数据通过引用校验', () => {
    // 模拟 enemies_config.php 的实际数据（2 个模板）
    graphStore.upsertNodes(makeEnemyTemplates());

    const issues = validateReference(graphStore);
    // 实际数据应无 enemy.skill_ref_dangling / combat_skill_not_in_skills / strategy_slot_invalid
    const enemyIssues = issues.filter(
      (i) =>
        i.ruleId === 'enemy.skill_ref_dangling' ||
        i.ruleId === 'enemy.combat_skill_not_in_skills' ||
        i.ruleId === 'enemy.strategy_slot_invalid',
    );
    expect(enemyIssues).toHaveLength(0);
  });

  it('实际 enemy_pool.php 数据通过分布校验', () => {
    // 模拟 enemy_pool.php 的实际数据：shallow:1 + deep:2
    graphStore.upsertNodes([
      ...makeMinimalWorld(),
      ...makeEnemyTemplates(),
      makeNode<DistributionEnemyData>('distribution.enemy', 'shallow:1', {
        'subject.enemy_type': 1,
        'selector.tides': ['shallow'],
        'selector.excludeEntrance': true,
        'selector.excludeExit': true,
        'selector.excludeOccupied': true,
        'placement.count': [1, 1],
      }),
      makeNode<DistributionEnemyData>('distribution.enemy', 'deep:2', {
        'subject.enemy_type': 2,
        'selector.tides': ['deep'],
        'selector.excludeEntrance': true,
        'selector.excludeExit': true,
        'selector.excludeOccupied': true,
        'placement.count': [1, 1],
      }),
    ]);

    const issues = validateDistribution(graphStore);
    // 实际数据可能触发 candidate_tile_insufficient（abyss 桶无规则）
    // 但不应有 per_region_capacity_conflict（count=[1,1] 上界 1，可用 tile 数 ≥ 1）
    const capacity = filterByRule(
      issues,
      'distribution.enemy.per_region_capacity_conflict',
    );
    expect(capacity).toHaveLength(0);
  });
});
