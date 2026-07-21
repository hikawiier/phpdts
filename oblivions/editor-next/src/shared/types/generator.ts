//
// 随机生成器 schema 与参数类型定义
// Schema 驱动 UI（对齐 2.6 配置驱动）：参数字段描述含 type / options / hideInRegionMode 等元数据

import type { MapProject, Region, Pls, Tile } from './map';

/**
 * 生成器参数字段类型
 */
export type GeneratorParamType = 'number' | 'select' | 'boolean' | 'text' | 'range';

/**
 * 生成器参数 schema 字段描述
 */
export interface GeneratorParamField {
  key: string;
  label: string; // i18n key
  type: GeneratorParamType;
  default: number | string | boolean;
  options?: Array<{ value: string; label: string }>;
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
  hideInRegionMode?: boolean; // 单区域模式下隐藏此字段
}

/**
 * 生成器参数（key → value）
 */
export type GeneratorParams = Record<string, number | string | boolean>;

/**
 * 生成器全项目生成结果（覆盖式）
 */
export interface GeneratorFullResult {
  regions: MapProject['regions'];
  grids: MapProject['grids'];
  tiles: MapProject['tiles'];
}

/**
 * 生成器单区域生成结果（追加式）
 */
export interface GeneratorRegionResult {
  region: Region;
  tiles: Record<Pls, Tile>;
}

/**
 * 生成器接口契约
 *
 * 实现方需提供：
 *   1. id / name / description 元信息
 *   2. getParamSchema() 返回参数 schema 数组（驱动 UI 自动渲染）
 *   3. getDefaultParams() 返回默认参数对象
 *   4. generate(params, seed) 全项目模式
 *   5. generateRegion(params, seed, existingPgroups) 单区域模式（默认实现取首区域 + remap pgroup）
 */
export interface Generator {
  id: string;
  name: string; // i18n key
  description: string; // i18n key
  getParamSchema(): GeneratorParamField[];
  getDefaultParams(): GeneratorParams;
  generate(params: GeneratorParams, seed?: number): GeneratorFullResult;
  generateRegion(
    params: GeneratorParams,
    seed: number | undefined,
    existingPgroups: Pls[],
  ): GeneratorRegionResult;
  validate?(result: GeneratorFullResult | GeneratorRegionResult): unknown[];
}
