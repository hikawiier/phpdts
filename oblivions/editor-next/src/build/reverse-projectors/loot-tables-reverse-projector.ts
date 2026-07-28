/**
 * @module O 内容工具箱
 *
 * loot_tables.php 逆向投影器——从 oblivions/gamedata/loot_tables.php 提取
 * loot.table 数据，输出 oblivions/content/loot-tables/loot-tables.yaml 作者资源结构。
 *
 * 边界：loot_tables.php 三层嵌套 groups/entries 结构原样保留——
 * 逆向投影器不重构数据形态，仅移除 undefined 字段。
 */

import { reverseProjectMapKeyedPhp } from './php-shared';
import type { ReverseProjectOptions, ReverseProjectResult } from './types';

const ROOT_KEY = 'loot_tables';
const YAML_FILE_PATH = 'oblivions/content/loot-tables/loot-tables.yaml';

export function reverseProjectLootTables(options: ReverseProjectOptions): ReverseProjectResult {
  return reverseProjectMapKeyedPhp(options, ROOT_KEY, YAML_FILE_PATH);
}
