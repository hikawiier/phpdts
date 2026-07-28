/**
 * @module O 内容工具箱
 *
 * ui-locale.ts 逆向投影器——从 vex-vue/src/data/ui-locale.ts 提取
 * presentation.ui 数据，输出 oblivions/content/presentations/ui-locale.yaml 作者资源结构。
 *
 * 边界：ui-locale.ts 是简单形态 `Record<string, string>`（UI key→中文文案）。
 */

import { reverseProjectStandardTsLocale } from './ts-shared';
import type { ReverseProjectOptions, ReverseProjectResult } from './types';

const KIND = 'presentation.ui';
const ROOT_KEY = 'ui';
const YAML_FILE_PATH = 'oblivions/content/presentations/ui-locale.yaml';

export function reverseProjectUiLocale(options: ReverseProjectOptions): ReverseProjectResult {
  return reverseProjectStandardTsLocale(options, KIND, ROOT_KEY, YAML_FILE_PATH);
}
