/**
 * @module O 内容工具箱
 *
 * enemy-locale.ts 逆向投影器——从 vex-vue/src/data/enemy-locale.ts 提取
 * presentation.enemy 数据，输出 oblivions/content/presentations/enemy-locale.yaml 作者资源结构。
 */

import { reverseProjectStandardTsLocale } from './ts-shared';
import type { ReverseProjectOptions, ReverseProjectResult } from './types';

const KIND = 'presentation.enemy';
const ROOT_KEY = 'enemies';
const YAML_FILE_PATH = 'oblivions/content/presentations/enemy-locale.yaml';

export function reverseProjectEnemyLocale(options: ReverseProjectOptions): ReverseProjectResult {
  return reverseProjectStandardTsLocale(options, KIND, ROOT_KEY, YAML_FILE_PATH);
}
