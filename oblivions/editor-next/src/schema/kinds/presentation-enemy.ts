/**
 * @module O 内容工具箱
 *
 * presentation.enemy kind 完整 schema。来源：vex-vue/src/data/enemy-locale.ts。
 *
 * P4 新建：执行案 §1.3 明确说明 P0 阶段"敌人 name 来自 enemies_config.php 写入
 * 实例字段 view.name，前端 13 处直接读 view.name，无 enemy-locale"。P4 阶段新建
 * enemy-locale.ts 作为呈现单一源，过渡期由 O-5 Change Set 双向同步
 * enemies_config.name ↔ enemy-locale.name，P5 单源编译后从 enemies_config.php 移除 name。
 *
 * 标准形态：`export const ENEMY_LOCALE: Record<string, EnemyLocaleEntry> = { ... }`
 * 当前 2 个条目（enemy.template 同步），每个 key 是 enemy.template.id（数字字符串），
 * value 是 { name, desc }。
 *
 * fallback 链（vex-vue/src/data/enemy-locale.ts）：
 * - getEnemyName(enemyType, fallbackName)：locale → fallbackName → enemy_${key}
 * - getEnemyDesc(enemyType, fallbackDesc)：locale → fallbackDesc → ''
 *
 * presentation 是图叶子：无 refFields，被 renders_as 边连接
 * （enemy.template → presentation.enemy）。自身无 presentationFields（自身就是呈现数据）。
 *
 * 渲染预览（O-9 呈现工作区）：通过 iframe + postMessage 调用 getEnemyName /
 * getEnemyDesc 纯函数版本。后端 fallback 取自同 ID enemy.template 的 name 字段（deprecated）。
 */

import type { KindSchema } from '../types';

export const presentationEnemySchema: KindSchema = {
  kind: 'presentation.enemy',
  idPattern: /^[1-9]\d*$/, // 与 enemy.template.id 共享命名空间（数字字符串）
  sourceFiles: [
    {
      path: 'vex-vue/src/data/enemy-locale.ts',
      format: 'ts',
      parser: 'ts-locale',
      load: 'map-keyed',
    },
  ],
  parser: 'ts-locale',
  fields: [
    {
      key: 'name',
      label: '中文名',
      type: 'text',
      required: true,
      default: '',
      placeholder: '如：废铁史莱姆',
      description:
        '敌人中文显示名——前端 fallback 链：locale → fallbackName → enemy_${key}。' +
        '见 vex-vue/src/data/enemy-locale.ts getEnemyName()。' +
        'P4 阶段由 O-5 Change Set 双向同步 enemies_config.name ↔ enemy-locale.name。',
      group: 'basic',
    },
    {
      key: 'desc',
      label: '中文描述',
      type: 'text',
      required: true,
      default: '',
      placeholder: '敌人中文描述',
      description:
        '敌人中文描述——前端 fallback 链：locale → fallbackDesc → 空字符串。' +
        '见 vex-vue/src/data/enemy-locale.ts getEnemyDesc()。',
      group: 'basic',
    },
  ],
  refFields: [], // presentation 是图叶子；renders_as 边由同 ID 自动构建（不在 refFields 声明）
  presentationFields: [], // 自身就是呈现
  listColumns: [
    { field: 'name', labelKey: 'schema.presentation.enemy.list.name', sortable: true, filterable: true, defaultVisible: true, width: 180 },
    { field: 'desc', labelKey: 'schema.presentation.enemy.list.desc', filterable: true, defaultVisible: true, width: 320 },
  ],
  detailGroups: [
    {
      id: 'basic',
      labelKey: 'schema.presentation.enemy.group.basic',
      fields: ['name', 'desc'],
      defaultCollapsed: false,
    },
  ],
  validators: [
    // 第 2 层结构校验
    {
      ruleId: 'presentation_enemy_name_empty',
      layer: 2,
      severity: 'error',
      validatorFn: 'presentation.enemy.name_empty',
    },
    {
      ruleId: 'presentation_enemy_desc_empty',
      layer: 2,
      severity: 'warning',
      validatorFn: 'presentation.enemy.desc_empty',
    },
    // 第 6 层呈现校验
    // 孤儿 presentation.enemy：没有对应 enemy.template 节点
    {
      ruleId: 'presentation.enemy.orphan',
      layer: 6,
      severity: 'warning',
      validatorFn: 'presentation.enemy.orphan',
    },
    // 反向：enemy.template 缺少 presentation.enemy（无中文文案）
    {
      ruleId: 'presentation.enemy.missing',
      layer: 6,
      severity: 'error',
      validatorFn: 'presentation.enemy.missing',
    },
    // locale 与后端 fallback 完全相同——冗余但无害（P5 单源编译后消除）
    {
      ruleId: 'presentation.enemy.fallback_redundant',
      layer: 6,
      severity: 'warning',
      validatorFn: 'presentation.enemy.fallback_redundant',
    },
  ],
  copyStrategy: 'deep-clone',
  p0Loaded: true,

  // —— P5 O-11 单源编译元数据 ——
  authorFormat: {
    format: 'yaml',
    filePath: 'oblivions/content/presentations/enemy-locale.yaml',
    rootKey: 'enemies',
    itemKey: 'id',
  },
  projectionTargets: [
    {
      kind: 'ts-locale',
      filePath: 'vex-vue/src/data/enemy-locale.ts',
      projector: './projectors/enemy-locale-projector',
      module: 'K 状态管理层',
    },
  ],
};
