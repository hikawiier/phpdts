/**
 * @module O 内容工具箱
 *
 * skill_definition_config.php 逆向投影器——从 oblivions/gamedata/skill_definition_config.php
 * 提取 skill.definition 数据，输出 oblivions/content/skills/skill-definition-config.yaml 作者资源结构。
 *
 * 边界：skill_definition_config.php 顶层 key 是技能 identity，map-keyed 模式。
 */

import { reverseProjectMapKeyedPhp } from './php-shared';
import type { ReverseProjectOptions, ReverseProjectResult } from './types';

const ROOT_KEY = 'skill_definitions';
const YAML_FILE_PATH = 'oblivions/content/skills/skill-definition-config.yaml';

export function reverseProjectSkillDefinitionConfig(options: ReverseProjectOptions): ReverseProjectResult {
  return reverseProjectMapKeyedPhp(options, ROOT_KEY, YAML_FILE_PATH);
}
