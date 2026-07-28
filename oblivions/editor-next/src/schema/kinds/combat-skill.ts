/**
 * @module O 内容工具箱
 *
 * combat.skill kind 最小 schema。来源：oblivions/gamedata/combat_skill_config.php。
 *
 * P5-1 阶段最小化创建——仅声明 authorFormat / projectionTargets 元数据与基本契约，
 * 不填充完整字段 schema（pipeline / aim / capture / execution / delivery / ap_calc /
 * range / rules / effects / finisher 等复杂嵌套字段）。完整字段定义在 P5-2 投影器
 * 实现时补全。
 *
 * 数据结构：每个 act_id => 配置数组（map-keyed load），act_id 是技能标识符
 * （如 'move' / 'unarmed_strike' / 'escape' / 'heal' / 'throw' / 'whirlwind'）。
 * 与 skill.definition 共享同一命名空间（skill_id = act_id）。
 *
 * 不注册到 registerAllKinds()——P5-1 阶段不影响现有运行时行为。
 */

import type { KindSchema } from '../types';

export const combatSkillSchema: KindSchema = {
  kind: 'combat.skill',
  idPattern: /^[a-z][a-z0-9_]*$/,
  sourceFiles: [
    {
      path: 'oblivions/gamedata/combat_skill_config.php',
      format: 'php',
      parser: 'php-array',
      load: 'map-keyed',
    },
  ],
  parser: 'php-array',
  fields: [
    {
      key: 'pipeline',
      label: '管道类型',
      type: 'select',
      options: [
        { value: 'attack', label: '攻击' },
        { value: 'utility', label: '辅助' },
        { value: 'passive', label: '被动' },
      ],
      required: true,
      group: 'basic',
    },
  ],
  refFields: [],
  presentationFields: [],
  listColumns: [
    { field: 'pipeline', labelKey: 'schema.combat.skill.list.pipeline', sortable: true, filterable: true, defaultVisible: true, width: 100 },
  ],
  detailGroups: [
    {
      id: 'basic',
      labelKey: 'schema.combat.skill.group.basic',
      fields: ['pipeline'],
      defaultCollapsed: false,
    },
  ],
  validators: [],
  copyStrategy: 'clone-with-new-id',
  p0Loaded: false,
  authorFormat: {
    format: 'yaml',
    filePath: 'oblivions/content/skills/combat-skill-config.yaml',
    rootKey: 'combat_skills',
    itemKey: 'act_id',
  },
  projectionTargets: [
    {
      kind: 'php',
      filePath: 'oblivions/gamedata/combat_skill_config.php',
      projector: './projectors/combat-skill-config-projector',
      module: 'H 战斗与技能系统',
      sectionTitle: 'Oblivions 战斗技能配置表',
    },
  ],
};
