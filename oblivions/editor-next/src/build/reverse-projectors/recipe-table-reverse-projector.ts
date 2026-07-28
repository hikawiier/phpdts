/**
 * @module O 内容工具箱
 *
 * recipe_table.php 逆向投影器——从 oblivions/gamedata/recipe_table.php 提取
 * recipe.template 数据，输出 oblivions/content/recipes/recipes.yaml 作者资源结构。
 */

import { reverseProjectMapKeyedPhp } from './php-shared';
import type { ReverseProjectOptions, ReverseProjectResult } from './types';

const ROOT_KEY = 'recipes';
const YAML_FILE_PATH = 'oblivions/content/recipes/recipes.yaml';

export function reverseProjectRecipeTable(options: ReverseProjectOptions): ReverseProjectResult {
  return reverseProjectMapKeyedPhp(options, ROOT_KEY, YAML_FILE_PATH);
}
