/**
 * @module O 内容工具箱
 *
 * scatter_pool.php 逆向投影器——从 oblivions/gamedata/scatter_pool.php 提取
 * distribution.scatter 数据，输出 oblivions/content/distributions/scatter-pool.yaml 作者资源结构。
 *
 * 边界：scatter_pool.php 按 tide × phase 矩阵分组（shallow/deep/abyss × initial/refresh），
 * 逆向投影原样保留嵌套结构，正向投影器按相同结构输出。
 */

import { reverseProjectPartitionedPhp } from './php-shared';
import type { ReverseProjectOptions, ReverseProjectResult } from './types';

const ROOT_KEY = 'scatter_pool';
const YAML_FILE_PATH = 'oblivions/content/distributions/scatter-pool.yaml';

export function reverseProjectScatterPool(options: ReverseProjectOptions): ReverseProjectResult {
  return reverseProjectPartitionedPhp(options, ROOT_KEY, YAML_FILE_PATH);
}
