/**
 * @module O 内容工具箱
 *
 * poi_pool.php 逆向投影器——从 oblivions/gamedata/poi_pool.php 提取
 * distribution.poi 数据，输出 oblivions/content/distributions/poi-pool.yaml 作者资源结构。
 *
 * 边界：poi_pool.php 按 tide 桶分组（shallow/deep/abyss），partitioned 模式
 * 与 map-keyed 数据结构同构（顶层 key 是 tide 名）。
 */

import { reverseProjectPartitionedPhp } from './php-shared';
import type { ReverseProjectOptions, ReverseProjectResult } from './types';

const ROOT_KEY = 'poi_pool';
const YAML_FILE_PATH = 'oblivions/content/distributions/poi-pool.yaml';

export function reverseProjectPoiPool(options: ReverseProjectOptions): ReverseProjectResult {
  return reverseProjectPartitionedPhp(options, ROOT_KEY, YAML_FILE_PATH);
}
