/**
 * @module O 内容工具箱
 *
 * effect.func kind schema——F-3 使用效果分发器注册的 use_effect 函数虚拟节点。
 *
 * 来源：oblivions/include/game/item/item.use_effects.func.php（F-3 框架下的 6 个函数定义）。
 *
 * 设计意图：
 *   - effect.func 是"代码模块派生的虚拟节点"——节点本身不是从数据文件解析而来，
 *     而是通过正则扫描 item.use_effects.func.php 中的 `function item_use_effect_{name}` 声明提取
 *   - 不通过 O-4 adapter 解析（item.use_effects.func.php 是函数定义文件，不是数据文件），
 *     而是通过 O-3 effect-func-builder 直接构建节点
 *   - 节点 id 是函数名（如 'restore_hp'），data 包含函数名与可选的描述
 *
 * 关系边：
 *   - 每个 item.template 的 use_effect 字段非空时，构建 uses_effect 边
 *     `item.template:{id} → effect.func:{name}`
 *
 * O-10 第 4 层语义校验：
 *   - item.use_effect_unknown 规则通过 uses_effect 边检测 use_effect 引用未注册的效果函数
 *
 * P2 §4.4.4 装配：effect-func-builder.ts 通过正则 `^function item_use_effect_(\w+)\(`
 * 提取函数名清单，预期 6 个：restore_hp / restore_sp / cure_bs / gain_resistance /
 * open_gift_box / place_poi（见 item.use_effects.func.php:12-18 文件头注释）。
 */

import type { KindSchema } from '../types';

export const effectFuncSchema: KindSchema = {
  kind: 'effect.func',
  idPattern: /^[a-z][a-z0-9_]*$/,
  sourceFiles: [
    {
      path: 'oblivions/include/game/item/item.use_effects.func.php',
      format: 'php',
      parser: 'php-function-def', // 标记为代码模块，O-4 adapter 不解析内部
      load: 'single',
    },
  ],
  parser: 'php-function-def',
  fields: [
    {
      key: 'name',
      label: '函数名',
      type: 'text',
      required: true,
      default: '',
      description:
        'use_effect 函数名（不含 item_use_effect_ 前缀）。' +
        '在 item.use_effects.func.php 中通过 `function item_use_effect_{name}($item, &$pdata)` 定义。',
      group: 'basic',
    },
    {
      key: 'signature',
      label: '函数签名',
      type: 'text',
      required: false,
      default: '',
      description: '完整函数签名（如 item_use_effect_restore_hp($item, &$pdata)）。',
      group: 'basic',
    },
  ],
  refFields: [],
  presentationFields: [],
  listColumns: [
    { field: 'name', labelKey: 'schema.effect.func.list.name', sortable: true, filterable: true, defaultVisible: true, width: 200 },
  ],
  detailGroups: [
    {
      id: 'basic',
      labelKey: 'schema.effect.func.group.basic',
      fields: ['name', 'signature'],
      defaultCollapsed: false,
    },
  ],
  validators: [],
  copyStrategy: 'none', // 虚拟节点不允许复制——只能由 effect-func-builder 重建
  p0Loaded: false, // P2 阶段由 effect-func-builder 装配，不走 loader 通用路径
};

/**
 * 已知 use_effect 函数清单——P2 阶段硬编码作为校验基线。
 *
 * 与 item.use_effects.func.php:12-18 文件头注释对齐。若新增 use_effect 函数，
 * 必须同步更新此清单与 item-template.ts 的 USE_EFFECT_OPTIONS。
 *
 * 此清单不作为运行时权威源——运行时权威源是 effect-func-builder 从文件中
 * 提取的实际函数清单。此清单仅用于：
 *   - 单元测试断言提取结果完整性
 *   - O-6 总览页"已知 vs 实际"漂移展示
 */
export const KNOWN_USE_EFFECTS = [
  'restore_hp',
  'restore_sp',
  'cure_bs',
  'gain_resistance',
  'open_gift_box',
  'place_poi',
] as const;
