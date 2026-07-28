/**
 * @module O 内容工具箱
 *
 * skill.definition kind 最小 schema。来源：oblivions/gamedata/skill_definition_config.php。
 *
 * P5-1 阶段最小化创建——仅声明 authorFormat / projectionTargets 元数据与基本契约，
 * 不填充完整字段 schema（category / lifetime / hidden / equipment_grant /
 * stacking / duration_ticks / capability_denies 等字段）。完整字段定义在 P5-2
 * 投影器实现时补全。
 *
 * 数据结构：每个 skill_id => 元数据数组（map-keyed load），skill_id 与 combat.skill
 * 的 act_id 共享命名空间。skill.definition 声明技能 identity 元数据（category /
 * lifetime / hidden），战斗机制由 combat.skill 声明。
 *
 * 不注册到 registerAllKinds()——P5-1 阶段不影响现有运行时行为。
 */

import type { KindSchema } from '../types';

export const skillDefinitionSchema: KindSchema = {
  kind: 'skill.definition',
  idPattern: /^[a-z][a-z0-9_]*$/,
  sourceFiles: [
    {
      path: 'oblivions/gamedata/skill_definition_config.php',
      format: 'php',
      parser: 'php-array',
      load: 'map-keyed',
    },
  ],
  parser: 'php-array',
  fields: [
    {
      key: 'category',
      label: '技能类别',
      type: 'select',
      options: [
        { value: 'assault', label: '攻击' },
        { value: 'maneuver', label: '机动' },
        { value: 'support', label: '辅助' },
        { value: 'passive', label: '被动' },
      ],
      required: true,
      group: 'basic',
    },
    {
      key: 'lifetime',
      label: '生命周期',
      type: 'select',
      options: [
        { value: 'permanent', label: '永久' },
        { value: 'equipment', label: '装备绑定' },
        { value: 'effect', label: '时效效果' },
      ],
      required: true,
      default: 'permanent',
      group: 'basic',
    },
    {
      key: 'hidden',
      label: '是否隐藏',
      type: 'boolean',
      required: true,
      default: false,
      group: 'basic',
    },
  ],
  refFields: [],
  presentationFields: [],
  listColumns: [
    { field: 'category', labelKey: 'schema.skill.definition.list.category', sortable: true, filterable: true, defaultVisible: true, width: 100 },
    { field: 'lifetime', labelKey: 'schema.skill.definition.list.lifetime', sortable: true, filterable: true, defaultVisible: true, width: 100 },
    { field: 'hidden', labelKey: 'schema.skill.definition.list.hidden', sortable: true, defaultVisible: true, width: 80 },
  ],
  detailGroups: [
    {
      id: 'basic',
      labelKey: 'schema.skill.definition.group.basic',
      fields: ['category', 'lifetime', 'hidden'],
      defaultCollapsed: false,
    },
  ],
  validators: [],
  copyStrategy: 'clone-with-new-id',
  p0Loaded: false,
  authorFormat: {
    format: 'yaml',
    filePath: 'oblivions/content/skills/skill-definition-config.yaml',
    rootKey: 'skill_definitions',
    itemKey: 'skill_id',
  },
  projectionTargets: [
    {
      kind: 'php',
      filePath: 'oblivions/gamedata/skill_definition_config.php',
      projector: './projectors/skill-definition-config-projector',
      module: 'H 战斗与技能系统',
      sectionTitle: 'Oblivions 技能定义配置表',
    },
  ],
};
