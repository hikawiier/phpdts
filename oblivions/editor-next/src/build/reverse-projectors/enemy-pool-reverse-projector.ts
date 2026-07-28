/**
 * @module O 内容工具箱
 *
 * enemy_pool.php 逆向投影器——从 oblivions/gamedata/enemy_pool.php 提取
 * distribution.enemy 数据，输出 oblivions/content/distributions/enemy-pool.yaml 作者资源结构。
 */

import { reverseProjectPartitionedPhp } from './php-shared';
import type { ReverseProjectOptions, ReverseProjectResult } from './types';

const ROOT_KEY = 'enemy_pool';
const YAML_FILE_PATH = 'oblivions/content/distributions/enemy-pool.yaml';

export function reverseProjectEnemyPool(options: ReverseProjectOptions): ReverseProjectResult {
  return reverseProjectPartitionedPhp(options, ROOT_KEY, YAML_FILE_PATH);
}
