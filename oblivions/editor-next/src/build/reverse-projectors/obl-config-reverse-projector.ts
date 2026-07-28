/**
 * @module O 内容工具箱
 *
 * obl_config.php 逆向投影器——从 oblivions/gamedata/obl_config.php 提取
 * config.runtime 数据，输出 oblivions/content/runtime-config/obl-config.yaml 作者资源结构。
 *
 * 边界：obl_config.php 是 single load 模式——整文件是单个 obl_config 字典，
 * 23 个顶层项原样保留。
 */

import { reverseProjectSinglePhp } from './php-shared';
import type { ReverseProjectOptions, ReverseProjectResult } from './types';

const ROOT_KEY = 'obl_config';
const YAML_FILE_PATH = 'oblivions/content/runtime-config/obl-config.yaml';

export function reverseProjectOblConfig(options: ReverseProjectOptions): ReverseProjectResult {
  return reverseProjectSinglePhp(options, ROOT_KEY, YAML_FILE_PATH);
}
