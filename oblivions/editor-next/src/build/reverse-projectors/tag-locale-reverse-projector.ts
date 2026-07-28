/**
 * @module O 内容工具箱
 *
 * tag-locale.ts 逆向投影器——从 vex-vue/src/data/tag-locale.ts 提取
 * presentation.tag 数据，输出 oblivions/content/presentations/tag-locale.yaml 作者资源结构。
 *
 * 边界：tag-locale.ts 是简单形态 `Record<string, string>`（tag_id→中文标签）。
 */

import { reverseProjectStandardTsLocale } from './ts-shared';
import type { ReverseProjectOptions, ReverseProjectResult } from './types';

const KIND = 'presentation.tag';
const ROOT_KEY = 'tags';
const YAML_FILE_PATH = 'oblivions/content/presentations/tag-locale.yaml';

export function reverseProjectTagLocale(options: ReverseProjectOptions): ReverseProjectResult {
  return reverseProjectStandardTsLocale(options, KIND, ROOT_KEY, YAML_FILE_PATH);
}
