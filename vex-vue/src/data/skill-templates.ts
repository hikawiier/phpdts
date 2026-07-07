// ══════════════════════════════════════════════════
// 技能显示模板 / Skill display templates
//
// 按 skill_id（act_id）索引，前端负责渲染技能名称/描述/动作描述。
// 后端 skill_config.php 不含显示信息，由本文件按 skill_id 查询。
//
// 迁移自现有 vex/data/skill-templates.js（M6 阶段 1）。
// ══════════════════════════════════════════════════

/** 技能显示模板 */
export interface SkillTemplate {
  /** 技能名称（显示在装填区按钮上） */
  name: string;
  /** 技能描述（显示在按钮副文本） */
  desc: string;
  /** 动作描述（用于 battle_log 渲染，目前由 battle-templates.ts 各模板自行处理） */
  action_desc: string;
}

/** 技能 ID → 显示模板映射 */
export const SKILL_TEMPLATES: Record<string, SkillTemplate> = {
  unarmed_strike: {
    name: '空手攻击',
    desc: '徒手攻击敌人',
    action_desc: '空手击打了',
  },
  escape: {
    name: '逃跑',
    desc: '50% 概率逃离战斗',
    action_desc: '尝试逃跑',
  },
  throw: {
    name: '投掷',
    desc: '使用投掷武器攻击中距离敌人',
    action_desc: '投掷武器',
  },
};

/** 默认模板（未注册的 skill_id 使用） */
const DEFAULT_TEMPLATE: SkillTemplate = {
  name: '',
  desc: '',
  action_desc: '',
};

/**
 * 获取技能显示模板
 *
 * 迁移自现有 vex/data/skill-templates.js getSkillTemplate()。
 * 未找到时返回以 skillId 作为 name/action_desc 的默认模板（与原前端一致）。
 *
 * @param skillId 技能 ID（对应 API 返回的 act_id 字段）
 * @returns 模板对象 {name, desc, action_desc}
 */
export function getSkillTemplate(skillId: string): SkillTemplate {
  const tpl = SKILL_TEMPLATES[skillId];
  if (tpl) return tpl;
  // 默认模板：用 skillId 兜底（与原前端一致）
  return {
    name: skillId,
    desc: DEFAULT_TEMPLATE.desc,
    action_desc: skillId,
  };
}
