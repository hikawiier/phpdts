/**
 * @module O 内容工具箱
 *
 * itmk-locale.ts 逆向投影器——从 vex-vue/src/data/itmk-locale.ts 提取
 * presentation.itmk 数据，输出 oblivions/content/presentations/itmk-locale.yaml 作者资源结构。
 *
 * 边界：itmk-locale.ts 是简单形态 `Record<string, string>`（key→中文名扁平映射），
 * parseTsLocale 启发式选择第一个常量（单常量文件直接使用）。
 */

import { reverseProjectStandardTsLocale } from './ts-shared';
import type { ReverseProjectOptions, ReverseProjectResult } from './types';

const KIND = 'presentation.itmk';
const ROOT_KEY = 'itmk';
const YAML_FILE_PATH = 'oblivions/content/presentations/itmk-locale.yaml';

export function reverseProjectItmkLocale(options: ReverseProjectOptions): ReverseProjectResult {
  return reverseProjectStandardTsLocale(options, KIND, ROOT_KEY, YAML_FILE_PATH);
}
