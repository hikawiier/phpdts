/**
 * @module O 内容工具箱
 *
 * enemy.template kind 完整 schema。来源：oblivions/gamedata/enemies_config.php。
 *
 * 字段来源：enemies_config.php:17-53 两个敌人模板的实际字段分布（16 字段 / 4 组）。
 *
 * 特例：enemies_config.php 使用 `$obl_enemies_config = array(...)` 全局变量赋值形态
 * （其他根级 PHP 都是 `return [...]`），因此 parser 使用 'php-global-var' 适配器。
 * P5 单源编译阶段会改造为 `return [...]` 标准形态（见执行案 06-P5 §19）。
 *
 * 引用字段（refKind='effect.skill'，与 effect.func 命名空间对齐）：
 * - skills[] / combat_skills[] / strategy_slots[].id：引用 effect.skill（虚拟节点集合）
 *
 * effect.skill 不注册为 BUILTIN_KIND——P4 阶段是纯字符串集合（从所有敌人已用 ID 派生），
 * P5+ 扩展为完整 effect.registry 时再注册为 BUILTIN_KIND。
 *
 * presentationFields：name 标记为 presentation + deprecated，由 presentation.enemy.name 投影。
 * 过渡期由 O-5 Change Set 自动同步 enemies_config.name ↔ enemy-locale.name（双向）。
 */

import type { KindSchema } from '../types';

/**
 * 性别枚举（与 enemies_config.php gd 字段对齐）。
 */
export const ENEMY_GD_OPTIONS = [
  { value: 'm', label: '男' },
  { value: 'f', label: '女' },
] as const;

/**
 * AI 行为类型枚举（与 enemies_config.php ai_type 字段对齐）。
 *
 * - patrol：巡逻型——按 vision_range BFS 感知玩家，action_chance 概率行动
 * - aggressive：侵略型——感知范围更大，主动追击玩家
 * - idle：静止型——不主动行动，仅反击
 */
export const ENEMY_AI_TYPE_OPTIONS = [
  { value: 'patrol', label: '巡逻' },
  { value: 'aggressive', label: '侵略' },
  { value: 'idle', label: '静止' },
] as const;

export const enemyTemplateSchema: KindSchema = {
  kind: 'enemy.template',
  idPattern: /^[1-9]\d*$/, // 敌人类型 ID 是数字（1, 2, ...）
  sourceFiles: [
    {
      path: 'oblivions/gamedata/enemies_config.php',
      format: 'php',
      parser: 'php-global-var',
      load: 'map-keyed',
    },
  ],
  parser: 'php-global-var',
  fields: [
    // ─── basic（基本属性）──────────────────────────────
    {
      key: 'name',
      label: '后端 fallback 名（deprecated）',
      type: 'text',
      required: true,
      default: '',
      presentation: true,
      deprecated: true,
      description:
        'deprecated 后端 fallback 中文名——由 presentation.enemy.name 投影。' +
        '运行时 obl_create_enemy_record 直接物化到实例字段 view.name。' +
        'P4 阶段由 O-5 Change Set 双向同步 enemy-locale.ts；P5 单源编译后从 enemies_config.php 移除。',
      group: 'basic',
    },
    {
      key: 'icon',
      label: '前端图标 key',
      type: 'text',
      required: true,
      default: '',
      placeholder: '如 enemy_slime',
      description: '前端图标 key——前端按此 key 查找敌人图标资源。',
      group: 'basic',
    },
    {
      key: 'gd',
      label: '性别',
      type: 'select',
      options: ENEMY_GD_OPTIONS,
      required: true,
      default: 'm',
      description: '性别枚举（m/f）——影响后端人称代词与部分事件文本。',
      group: 'basic',
    },

    // ─── combat（战斗属性）──────────────────────────────
    {
      key: 'hp',
      label: '当前生命',
      type: 'number',
      required: true,
      default: 1,
      min: 0,
      step: 1,
      description: '当前生命——初始化时 hp=mhp；运行时受伤时减少，归零时死亡。',
      group: 'combat',
    },
    {
      key: 'mhp',
      label: '最大生命',
      type: 'number',
      required: true,
      default: 1,
      min: 0,
      step: 1,
      description: '最大生命——hp 上限。',
      group: 'combat',
    },
    {
      key: 'sp',
      label: '当前体力',
      type: 'number',
      required: true,
      default: 0,
      min: 0,
      step: 1,
      description: '当前体力——初始化时 sp=msp；技能消耗时减少。',
      group: 'combat',
    },
    {
      key: 'msp',
      label: '最大体力',
      type: 'number',
      required: true,
      default: 0,
      min: 0,
      step: 1,
      description: '最大体力——sp 上限。',
      group: 'combat',
    },
    {
      key: 'att',
      label: '攻击',
      type: 'number',
      required: true,
      default: 0,
      min: 0,
      step: 1,
      description: '攻击力——影响物理伤害计算。',
      group: 'combat',
    },
    {
      key: 'def',
      label: '防御',
      type: 'number',
      required: true,
      default: 0,
      min: 0,
      step: 1,
      description: '防御力——减少受到的物理伤害。',
      group: 'combat',
    },
    {
      key: 'lvl',
      label: '等级',
      type: 'number',
      required: true,
      default: 1,
      min: 1,
      step: 1,
      description: '等级——影响经验奖励与部分战斗参数。',
      group: 'combat',
    },

    // ─── ai（AI 行为）──────────────────────────────────
    {
      key: 'ai_type',
      label: 'AI 类型',
      type: 'select',
      options: ENEMY_AI_TYPE_OPTIONS,
      required: true,
      default: 'patrol',
      description:
        'AI 行为类型——patrol 巡逻 / aggressive 侵略 / idle 静止。' +
        '与 vision_range / action_chance 共同决定 AI 决策。',
      group: 'ai',
    },
    {
      key: 'vision_range',
      label: '感知范围',
      type: 'number',
      required: true,
      default: 0,
      min: 0,
      step: 1,
      description: '感知范围（BFS 跳数）——与 E-6 视野系统对齐。0 表示无感知。',
      group: 'ai',
    },
    {
      key: 'action_chance',
      label: '行动意愿',
      type: 'number',
      required: true,
      default: 0,
      min: 0,
      max: 1,
      step: 0.05,
      description: '0-1，每 tick 行动概率——AI 决策时按此概率判定是否行动。',
      group: 'ai',
    },

    // ─── skills（技能）─────────────────────────────────
    {
      key: 'skills',
      label: '拥有技能',
      type: 'string-list',
      required: false,
      default: [],
      placeholder: '如 unarmed_strike / escape',
      description:
        '拥有技能 ID 列表——refKind=effect.skill（虚拟节点集合）。' +
        'P4 阶段 effect.skill 是纯字符串集合，P5+ 扩展为完整 effect.registry。',
      group: 'skills',
    },
    {
      key: 'combat_skills',
      label: '战斗倾向技能',
      type: 'string-list',
      required: false,
      default: [],
      placeholder: '如 unarmed_strike',
      description:
        '战斗中倾向于使用的技能（按优先级排列）——refKind=effect.skill。' +
        '应为 skills 的子集（O-10 第 3 层 enemy.combat_skill_not_in_skills 校验）。',
      group: 'skills',
    },
    {
      key: 'strategy_slots',
      label: '策略槽（4 槽）',
      type: 'json',
      required: false,
      default: [null, null, null, null],
      placeholder: '如 [{"type":"skill","id":"unarmed_strike"},null,null,null]',
      description:
        '4 槽结构数组，每槽可为 null 或 {type:"skill", id:"..."}。' +
        'id refKind=effect.skill。O-7 详情页用 4 个独立槽位编辑器渲染。' +
        'JSON 字符串字段——PHP 中是数组，适配器原样保留为 JSON 字符串。',
      group: 'skills',
    },
  ],
  refFields: [
    // effect.skill 是纯字符串集合（P4），不注册为 BUILTIN_KIND
    // O-3 边构建器创建 consumes_skill / casts_skill 边时，to 端点用
    // `effect.skill:{skill_id}` 字符串引用，但不入 graph-store 节点表
    { field: 'skills[]', refKind: 'effect.skill', refField: 'id', required: false, refType: 'direct' },
    { field: 'combat_skills[]', refKind: 'effect.skill', refField: 'id', required: false, refType: 'direct' },
    { field: 'strategy_slots[].id', refKind: 'effect.skill', refField: 'id', required: false, refType: 'direct' },
  ],
  presentationFields: [
    // name 已迁移至实例字段（NPC 实例化时写入 view.name）
    // P4 阶段新建 enemy-locale.ts，name 投影至 presentation.enemy.name（双向同步）
    { field: 'name', presentation: true, deprecated: true, projectTo: 'presentation.enemy.name' },
  ],
  listColumns: [
    { field: 'name', labelKey: 'schema.enemy.template.list.name', sortable: true, filterable: true, defaultVisible: true, width: 160 },
    { field: 'lvl', labelKey: 'schema.enemy.template.list.lvl', sortable: true, defaultVisible: true, width: 80 },
    { field: 'ai_type', labelKey: 'schema.enemy.template.list.ai_type', sortable: true, filterable: true, defaultVisible: true, width: 100 },
    { field: 'hp', labelKey: 'schema.enemy.template.list.hp', sortable: true, defaultVisible: true, width: 80 },
    { field: 'att', labelKey: 'schema.enemy.template.list.att', sortable: true, defaultVisible: true, width: 80 },
  ],
  detailGroups: [
    {
      id: 'basic',
      labelKey: 'schema.enemy.template.group.basic',
      fields: ['name', 'icon', 'gd'],
      defaultCollapsed: false,
    },
    {
      id: 'combat',
      labelKey: 'schema.enemy.template.group.combat',
      fields: ['hp', 'mhp', 'sp', 'msp', 'att', 'def', 'lvl'],
      defaultCollapsed: false,
    },
    {
      id: 'ai',
      labelKey: 'schema.enemy.template.group.ai',
      fields: ['ai_type', 'vision_range', 'action_chance'],
      defaultCollapsed: false,
    },
    {
      id: 'skills',
      labelKey: 'schema.enemy.template.group.skills',
      fields: ['skills', 'combat_skills', 'strategy_slots'],
      defaultCollapsed: false,
    },
  ],
  validators: [
    // 第 2 层结构校验
    {
      ruleId: 'enemy_strategy_slot_invalid',
      layer: 2,
      severity: 'error',
      validatorFn: 'enemy.strategy_slot_invalid',
    },
    // 第 3 层引用校验（effect.skill 是虚拟节点，从所有敌人已用 ID 派生）
    {
      ruleId: 'enemy.skill_ref_dangling',
      layer: 3,
      severity: 'warning',
      validatorFn: 'enemy.skill_ref_dangling',
    },
    {
      ruleId: 'enemy.combat_skill_not_in_skills',
      layer: 3,
      severity: 'warning',
      validatorFn: 'enemy.combat_skill_not_in_skills',
    },
    // 第 6 层呈现校验
    {
      ruleId: 'presentation.enemy.missing',
      layer: 6,
      severity: 'error',
      validatorFn: 'presentation.enemy.missing',
    },
  ],
  copyStrategy: 'deep-clone',
  p0Loaded: true,

  // —— P5 O-11 单源编译元数据 ——
  // enemies_config.php 在 P5 改造为 `return [...]` 标准形态（执行案 §4.4），
  // 同步修改 init.func.php:282-283 的消费方。当前 sourceFiles.parser 仍为
  // 'php-global-var'（过渡期 fallback），P5-4 迁移完成后切为 'php-array'。
  authorFormat: {
    format: 'yaml',
    filePath: 'oblivions/content/enemies/enemies.yaml',
    rootKey: 'enemies',
    itemKey: 'id',
  },
  projectionTargets: [
    {
      kind: 'php',
      filePath: 'oblivions/gamedata/enemies_config.php',
      projector: './projectors/enemies-config-projector',
      module: 'E 游戏逻辑',
      sectionTitle: 'Oblivions 敌人模板配置',
    },
  ],
};
