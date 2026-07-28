/**
 * @module O 内容工具箱
 * @framework O-10 分层校验
 *
 * 8 层校验器注册表与调度入口。
 *
 * 设计意图（执行案 §4.7.2）：
 *   - VALIDATOR_LAYERS：8 个校验器的元数据（layer / name / validate 函数）
 *   - runLayer(layer, graph, changeSet?)：运行单层
 *   - runLayers(layers, graph, changeSet?)：运行多层
 *   - runLight(graph, changeSet?)：运行第 1+2 层（实时校验，debounce 300ms）
 *   - runFull(graph, changeSet?)：运行第 1+2+3 层（按需完整校验）
 *   - runAll(graph, changeSet?)：运行全部 8 层（P6 镜像校验使用）
 *
 * P0 阶段：
 *   - 第 1 层（input）：返回空数组 + TODO（P1 实现）
 *   - 第 2 层（structure）：迁移现有 20 个规则
 *   - 第 3 层（reference）：实现 25 个引用规则（13 个实际检查 + 12 个 TODO 占位）
 *   - 第 4-8 层：返回空数组 + TODO（P1+ / P5 / P6 实现）
 */

import type { Issue, ValidationLayer } from '../issue-model';
import type { GraphStore, ChangeSet } from '../quick-fixes';
import { validate as validateInput } from './input-validator';
import { validate as validateStructure } from './structure-validator';
import { validate as validateReference } from './reference-validator';
import { validate as validateSemantic } from './semantic-validator';
import { validate as validateDistribution } from './distribution-validator';
import { validate as validatePresentation } from './presentation-validator';
import { validate as validateCompile } from './compile-validator';
import { validate as validateMirror } from './mirror-validator';

/**
 * 校验器元数据——每层一个条目。
 */
export interface ValidatorLayerMeta {
  /** 层编号（1-8） */
  layer: ValidationLayer;
  /** 层名称（i18n key 锚点） */
  name: string;
  /** 层描述（i18n key 锚点） */
  description: string;
  /** 校验函数 */
  validate: (graph: GraphStore, changeSet?: ChangeSet) => Issue[];
}

/**
 * 8 层校验器注册表——按层编号顺序排列。
 */
export const VALIDATOR_LAYERS: readonly ValidatorLayerMeta[] = [
  {
    layer: 1,
    name: 'input',
    description: '输入校验（PHP 解析失败 / 文件缺失）',
    validate: validateInput,
  },
  {
    layer: 2,
    name: 'structure',
    description: '结构校验（迁移现有 20 个规则）',
    validate: validateStructure,
  },
  {
    layer: 3,
    name: 'reference',
    description: '引用校验（25 个跨资源引用规则）',
    validate: validateReference,
  },
  {
    layer: 4,
    name: 'semantic',
    description: '语义校验（字段值业务语义）',
    validate: validateSemantic,
  },
  {
    layer: 5,
    name: 'distribution',
    description: '分布校验（POI 候选格与容量校验）',
    validate: validateDistribution,
  },
  {
    layer: 6,
    name: 'presentation',
    description: '呈现校验（呈现字段完整性与长度）',
    validate: validatePresentation,
  },
  {
    layer: 7,
    name: 'compile',
    description: '编译校验（单源编译前最终拦截）',
    validate: validateCompile,
  },
  {
    layer: 8,
    name: 'mirror',
    description: '运行时镜像校验（运行时行为对比）',
    validate: validateMirror,
  },
] as const;

/**
 * 按 layer 编号查找校验器元数据。
 */
export function getValidatorLayer(layer: ValidationLayer): ValidatorLayerMeta {
  const meta = VALIDATOR_LAYERS.find((v) => v.layer === layer);
  if (!meta) {
    throw new Error(`[O-10] Unknown validator layer: ${layer}`);
  }
  return meta;
}

/**
 * 运行单层校验。
 *
 * @param layer 层编号（1-8）
 * @param graph 图状态
 * @param changeSet Change Set（可选，第 7-8 层使用）
 * @returns Issue[]
 */
export function runLayer(
  layer: ValidationLayer,
  graph: GraphStore,
  changeSet?: ChangeSet,
): Issue[] {
  const meta = getValidatorLayer(layer);
  return meta.validate(graph, changeSet);
}

/**
 * 运行多层校验——按 layer 编号升序执行，合并所有 Issue。
 *
 * @param layers 层编号数组
 * @param graph 图状态
 * @param changeSet Change Set（可选）
 * @returns Issue[]
 */
export function runLayers(
  layers: readonly ValidationLayer[],
  graph: GraphStore,
  changeSet?: ChangeSet,
): Issue[] {
  const issues: Issue[] = [];
  for (const layer of layers) {
    issues.push(...runLayer(layer, graph, changeSet));
  }
  return issues;
}

/**
 * 运行 Light 校验——第 1+2 层。
 *
 * 适合编辑时实时触发（debounce 300ms）。
 * 对齐原 runLightValidation：跳过 BFS 与配置交叉引用。
 *
 * 注意：第 2 层（structure-validator）当前包含 BFS 与 cross-ref，
 * P1+ 阶段拆分为纯结构校验 + 独立 distribution 层后，Light 才真正跳过 BFS。
 *
 * @param graph 图状态
 * @param changeSet Change Set（可选）
 * @returns Issue[]
 */
export function runLight(graph: GraphStore, changeSet?: ChangeSet): Issue[] {
  return runLayers([1, 2], graph, changeSet);
}

/**
 * 运行 Full 校验——第 1+2+3 层。
 *
 * 对齐原 runFullValidation：含结构校验 + 引用校验。
 * 第 4-8 层仅在 O-5 Change Set 提交前调用（P5 完整实现）。
 *
 * @param graph 图状态
 * @param changeSet Change Set（可选）
 * @returns Issue[]
 */
export function runFull(graph: GraphStore, changeSet?: ChangeSet): Issue[] {
  return runLayers([1, 2, 3], graph, changeSet);
}

/**
 * 运行全部 8 层校验——P6 镜像校验使用。
 *
 * P0 阶段第 4-8 层返回空数组，实际仅 1+2+3 层生效。
 * P5/P6 阶段完整实现后，作为 Change Set 提交前的完整拦截。
 *
 * @param graph 图状态
 * @param changeSet Change Set（可选，第 7-8 层使用）
 * @returns Issue[]
 */
export function runAll(graph: GraphStore, changeSet?: ChangeSet): Issue[] {
  return runLayers([1, 2, 3, 4, 5, 6, 7, 8], graph, changeSet);
}
