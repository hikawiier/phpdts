/**
 * @module O 内容工具箱
 *
 * status-locale.ts 逆向投影器——从 vex-vue/src/data/status-locale.ts 提取
 * presentation.status 数据，输出 oblivions/content/presentations/status-locale.yaml 作者资源结构。
 *
 * 边界：status-locale.ts 是标准形态 + description 字段（StatusLocaleEntry { name; description }）。
 */

import { reverseProjectStandardTsLocale } from './ts-shared';
import type { ReverseProjectOptions, ReverseProjectResult } from './types';

const KIND = 'presentation.status';
const ROOT_KEY = 'statuses';
const YAML_FILE_PATH = 'oblivions/content/presentations/status-locale.yaml';

export function reverseProjectStatusLocale(options: ReverseProjectOptions): ReverseProjectResult {
  return reverseProjectStandardTsLocale(options, KIND, ROOT_KEY, YAML_FILE_PATH);
}
