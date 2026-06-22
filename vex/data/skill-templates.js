// ══════════════════════════════════════════════════
// 技能显示模板 / Skill display templates
//
// 按 skill_id 索引，前端负责渲染技能名称/描述/动作描述。
// 后端 skill_config.php 不含显示信息，由本文件按 skill_id 查询。
// ══════════════════════════════════════════════════

export const SKILL_TEMPLATES = {
    'unarmed_strike': {
        name: '空手攻击',
        desc: '徒手攻击敌人',
        action_desc: '空手击打了',
    },
    'escape': {
        name: '逃跑',
        desc: '50% 概率逃离战斗',
        action_desc: '尝试逃跑',
    },
};

/**
 * 获取技能显示模板
 * @param {string} skillId 技能 ID
 * @returns {Object} 模板对象 {name, desc, action_desc}，未找到返回默认值
 */
export function getSkillTemplate(skillId) {
    return SKILL_TEMPLATES[skillId] || {
        name: skillId,
        desc: '',
        action_desc: skillId,
    };
}
