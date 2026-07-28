/**
 * @module O 内容工具箱
 *
 * poi-locale.ts 逆向投影器——从 vex-vue/src/data/poi-locale.ts 提取
 * presentation.poi 数据，输出 oblivions/content/presentations/poi-locale.yaml 作者资源结构。
 */

import { reverseProjectStandardTsLocale } from './ts-shared';
import type { ReverseProjectOptions, ReverseProjectResult } from './types';

const KIND = 'presentation.poi';
const ROOT_KEY = 'pois';
const YAML_FILE_PATH = 'oblivions/content/presentations/poi-locale.yaml';

export function reverseProjectPoiLocale(options: ReverseProjectOptions): ReverseProjectResult {
  return reverseProjectStandardTsLocale(options, KIND, ROOT_KEY, YAML_FILE_PATH);
}
