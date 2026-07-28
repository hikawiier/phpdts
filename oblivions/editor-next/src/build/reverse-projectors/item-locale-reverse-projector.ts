/**
 * @module O 内容工具箱
 *
 * item-locale.ts 逆向投影器——从 vex-vue/src/data/item-locale.ts 提取
 * presentation.item 数据，输出 oblivions/content/presentations/item-locale.yaml 作者资源结构。
 */

import { reverseProjectStandardTsLocale } from './ts-shared';
import type { ReverseProjectOptions, ReverseProjectResult } from './types';

const KIND = 'presentation.item';
const ROOT_KEY = 'items';
const YAML_FILE_PATH = 'oblivions/content/presentations/item-locale.yaml';

export function reverseProjectItemLocale(options: ReverseProjectOptions): ReverseProjectResult {
  return reverseProjectStandardTsLocale(options, KIND, ROOT_KEY, YAML_FILE_PATH);
}
