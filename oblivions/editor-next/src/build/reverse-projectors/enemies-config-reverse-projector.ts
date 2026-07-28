/**
 * @module O 内容工具箱
 *
 * enemies_config.php 逆向投影器——从 oblivions/gamedata/enemies_config.php 提取
 * enemy.template 数据，输出 oblivions/content/enemies/enemies.yaml 作者资源结构。
 *
 * 边界：enemies_config.php 在 P5 改造为 return [...] 标准形态后，
 * parsePhpArrayExt 自动识别；旧形态 $obl_enemies_config = array(...) 也兼容。
 */

import { reverseProjectMapKeyedPhp } from './php-shared';
import type { ReverseProjectOptions, ReverseProjectResult } from './types';

const ROOT_KEY = 'enemies';
const YAML_FILE_PATH = 'oblivions/content/enemies/enemies.yaml';

export function reverseProjectEnemiesConfig(options: ReverseProjectOptions): ReverseProjectResult {
  return reverseProjectMapKeyedPhp(options, ROOT_KEY, YAML_FILE_PATH);
}
