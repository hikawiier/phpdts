/**
 * @module O 内容工具箱
 *
 * item_table.php 逆向投影器——从 oblivions/gamedata/item_table.php 提取
 * item.template 数据，输出 oblivions/content/items/items.yaml 作者资源结构。
 *
 * 设计意图（执行案 06-P5 §4.10.1）：
 * - 与正向投影器 item-table-projector.projectItemTable 方向相反
 * - 复用 php-shared.reverseProjectMapKeyedPhp 通用解析逻辑
 * - 输出 rootKey='items' 的 map-keyed 字典，每个 key 是 item ID
 */

import { reverseProjectMapKeyedPhp } from './php-shared';
import type { ReverseProjectOptions, ReverseProjectResult } from './types';

const ROOT_KEY = 'items';
const YAML_FILE_PATH = 'oblivions/content/items/items.yaml';

/**
 * 从 item_table.php 内容提取 item.template 数据。
 *
 * @returns ReverseProjectResult——成功时 resource.data 是 Record<itemId, entry>
 */
export function reverseProjectItemTable(options: ReverseProjectOptions): ReverseProjectResult {
  return reverseProjectMapKeyedPhp(options, ROOT_KEY, YAML_FILE_PATH);
}
