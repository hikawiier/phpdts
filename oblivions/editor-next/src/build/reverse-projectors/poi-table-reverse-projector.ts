/**
 * @module O 内容工具箱
 *
 * poi_table.php 逆向投影器——从 oblivions/gamedata/poi_table.php 提取
 * poi.template 数据，输出 oblivions/content/pois/pois.yaml 作者资源结构。
 */

import { reverseProjectMapKeyedPhp } from './php-shared';
import type { ReverseProjectOptions, ReverseProjectResult } from './types';

const ROOT_KEY = 'pois';
const YAML_FILE_PATH = 'oblivions/content/pois/pois.yaml';

export function reverseProjectPoiTable(options: ReverseProjectOptions): ReverseProjectResult {
  return reverseProjectMapKeyedPhp(options, ROOT_KEY, YAML_FILE_PATH);
}
