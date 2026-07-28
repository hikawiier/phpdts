/**
 * @module O 内容工具箱
 *
 * combat_skill_config.php 逆向投影器——从 oblivions/gamedata/combat_skill_config.php
 * 提取 combat.skill 数据，输出 oblivions/content/skills/combat-skill-config.yaml 作者资源结构。
 *
 * 边界：combat_skill_config.php 顶层 key 是 act_id，map-keyed 模式。
 */

import { reverseProjectMapKeyedPhp } from './php-shared';
import type { ReverseProjectOptions, ReverseProjectResult } from './types';

const ROOT_KEY = 'combat_skills';
const YAML_FILE_PATH = 'oblivions/content/skills/combat-skill-config.yaml';

export function reverseProjectCombatSkillConfig(options: ReverseProjectOptions): ReverseProjectResult {
  return reverseProjectMapKeyedPhp(options, ROOT_KEY, YAML_FILE_PATH);
}
