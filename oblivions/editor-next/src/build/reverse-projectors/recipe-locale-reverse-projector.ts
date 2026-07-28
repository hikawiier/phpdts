/**
 * @module O 内容工具箱
 *
 * recipe-locale.ts 逆向投影器——从 vex-vue/src/data/recipe-locale.ts 提取
 * presentation.recipe 数据，输出 oblivions/content/presentations/recipe-locale.yaml 作者资源结构。
 *
 * 边界：recipe-locale.ts 同时导出 RECIPE_LOCALE 与 RECIPE_CATEGORY_LABELS，
 * parseTsLocale 启发式选择对象类型的 RECIPE_LOCALE；CATEGORY_LABELS 是 4 个固定 key
 * 的中文标签字典，由 schema.auxiliaryData 承载，不进入 YAML 作者资源。
 */

import { reverseProjectStandardTsLocale } from './ts-shared';
import type { ReverseProjectOptions, ReverseProjectResult } from './types';

const KIND = 'presentation.recipe';
const ROOT_KEY = 'recipes';
const YAML_FILE_PATH = 'oblivions/content/presentations/recipe-locale.yaml';

export function reverseProjectRecipeLocale(options: ReverseProjectOptions): ReverseProjectResult {
  return reverseProjectStandardTsLocale(options, KIND, ROOT_KEY, YAML_FILE_PATH);
}
