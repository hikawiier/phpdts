// ══════════════════════════════════════════════════
// Oblivions 日志模板配置 / Oblivions log templates
//
// 按 ID 索引渲染文案，后端只传参数，前端完全控制视觉呈现。
// 相关文档：oblivions/docs/结构化日志系统设计案.md
// ══════════════════════════════════════════════════

import { generateTerrainDesc } from './terrain-desc.js';
import { escapeHtml } from '../js/utils.js';

/**
 * 模板定义
 *
 * 每个模板可包含以下字段：
 * - text:           文案模板，{param} 占位符
 * - highlight:      需要高亮的参数名数组
 * - highlightClass: 高亮用的 CSS 类名（如 'yellow'/'red'）
 * - render:         自定义渲染函数（优先于 text），接收 params 对象，返回 HTML 字符串
 */
export const LOG_TEMPLATES = {
    // ─── move ────────────────────────────────────────
    'move.same_pos': {
        text: '已经在当前位置，不需要移动。',
    },
    'move.invalid_target': {
        text: '请选择正确的移动地点。',
    },
    'move.blocked': {
        // 有名格显示 name，无名格前端生成描述
        render: (params) => {
            const tileName = params.name || generateTerrainDesc(params.floor, params.tide, params.passable);
            return `<span class="red">${escapeHtml(tileName)}</span>，无法通行，请绕道。`;
        },
    },
    'move.unreachable': {
        render: (params) => {
            const tileName = params.name || generateTerrainDesc(params.floor, params.tide, params.passable);
            return `无法直接移动到<span class="yellow">${escapeHtml(tileName)}</span>。`;
        },
    },
    'move.no_path': {
        render: (params) => {
            const tileName = params.name || generateTerrainDesc(params.floor, params.tide, params.passable);
            return `无法直接移动到<span class="yellow">${escapeHtml(tileName)}</span>，需要通过相邻区域。`;
        },
    },
    'move.no_sp_far': {
        text: '体力不足，无法移动到那么远的地方。',
    },
    'move.success': {
        // 有名格显示 name，无名格前端生成描述
        render: (params) => {
            const fromName = params.from.name || generateTerrainDesc(params.from.floor, params.from.tide, params.from.passable);
            const toName = params.to.name || generateTerrainDesc(params.to.floor, params.to.tide, params.to.passable);
            return `从${escapeHtml(fromName)}移动到了<span class="yellow">${escapeHtml(toName)}</span>。`;
        },
    },
    'move.tile_desc': {
        // 特殊模板：有名格直接显示 desc，无名格前端组合随机描述
        render: (params) => {
            if (params.name) {
                // 有名格：显示 desc（若有）
                return params.desc ? escapeHtml(params.desc) : '';
            }
            // 无名格：前端组合随机描述
            const desc = generateTerrainDesc(params.floor, params.tide, params.passable);
            return escapeHtml(desc);
        },
    },
    'move.region_leave': {
        render: (params) => {
            return `离开了<span class="yellow">${escapeHtml(params.region_name)}</span>。`;
        },
    },
    'move.region_enter': {
        render: (params) => {
            let html = `进入了<span class="yellow">${escapeHtml(params.region_name)}</span>。`;
            if (params.region_desc) html += '<br>' + escapeHtml(params.region_desc);
            return html;
        },
    },
    'move.region_end': {
        text: '你已经到达了当前区域的尽头，前方似乎没有路了……',
    },
    'move.no_sp': {
        text: '体力不足，无法移动。',
    },

    // ─── explore ────────────────────────────────────
    'explore.no_sp': {
        text: '体力不足，无法探索。',
    },
    'explore.success': {
        text: '你仔细观察了周围的环境。',
    },

    // ─── search ─────────────────────────────────────
    'search.not_found': {
        text: '找不到这个建筑物。',
    },
    'search.not_adjacent': {
        text: '你不在那个建筑物旁边。',
    },
    'search.data_error': {
        text: '建筑物数据异常。',
    },
    'search.not_searchable': {
        text: '{poi_name}无法搜索。',
        highlight: ['poi_name'],
        highlightClass: 'yellow',
    },
    'search.already_searched': {
        text: '你已经搜索过{poi_name}了。',
        highlight: ['poi_name'],
        highlightClass: 'yellow',
    },
    'search.mechanic_pending': {
        text: '机制【{mechanic}】尚未实现。',
        highlight: ['mechanic'],
        highlightClass: 'yellow',
    },
    'search.mechanic_triggered': {
        text: '你搜索了{poi_name}……',
        highlight: ['poi_name'],
        highlightClass: 'yellow',
    },
    'search.result': {
        render: (params) => {
            if (params.items && params.items.length > 0) {
                const items = params.items.map(escapeHtml).join('、');
                return `你搜索了${escapeHtml(params.poi_name)}，发现了<span class="yellow">${items}</span>。`;
            }
            return `你搜索了${escapeHtml(params.poi_name)}，但什么也没找到。`;
        },
    },

    // ─── pickup ─────────────────────────────────────
    'pickup.not_found': {
        text: '找不到这个道具。',
    },
    'pickup.not_adjacent': {
        text: '那个道具不在你身边。',
    },
    'pickup.unknown': {
        text: '你不知道那里有什么。',
    },
    'pickup.trap': {
        render: (params) => {
            return `你伸手去拿<span class="yellow">${escapeHtml(params.item_name)}</span>——<br><span class="red">那是一个陷阱！</span>`;
        },
    },
    'pickup.nearsighted_reveal': {
        render: (params) => {
            return `你拿起了看似普通的东西——原来是<span class="yellow">${escapeHtml(params.item_name)}</span>！`;
        },
    },
    'pickup.bag_full': {
        text: '背包已满，无法拾取。',
    },
    'pickup.success': {
        text: '你拾取了{item_name}。',
        highlight: ['item_name'],
        highlightClass: 'yellow',
    },

    // ─── discard ────────────────────────────────────
    'discard.invalid_slot': {
        text: '无效的背包槽位。',
    },
    'discard.empty_slot': {
        text: '该槽位没有道具。',
    },
    'discard.success': {
        text: '你丢弃了{item_name}。',
        highlight: ['item_name'],
        highlightClass: 'yellow',
    },

    // ─── system ─────────────────────────────────────
    'system.mechanic_max_hp_up': {
        render: (params) => {
            return `一股暖流涌入体内，<span class="yellow">最大生命值 +${params.value}</span>！<br>当前生命：<span class="yellow">${params.hp}/${params.mhp}</span>`;
        },
    },
    'system.pickup_concurrent_loss': {
        text: '那个道具已经不在那里了。',
    },

    // ─── enemy ──────────────────────────────────────
    'enemy.discovered': {
        render: (params) => {
            return `你发现了<span class="red">${escapeHtml(params.enemy_name)}</span>的踪迹。`;
        },
    },
    'enemy.move': {
        render: (params) => {
            return `<span class="red">${escapeHtml(params.enemy_name)}</span>移动了位置。`;
        },
    },
    'enemy.ambush': {
        render: (params) => {
            return `<span class="red">${escapeHtml(params.enemy_name)}</span>突然向你发起了突袭！`;
        },
    },
    // ─── battle ────────────────────────────────────
    'battle.skirmish': {
        render: (params) => {
            const enemy = `<span class="red">${escapeHtml(params.enemy_name)}</span>`;
            if (params.initiator === 'player') {
                return `你与${enemy}发生碰撞，经过短暂交火后各自退回原地。`;
            }
            return `${enemy}与你发生碰撞，经过短暂交火后各自退回原地。`;
        },
    },
    'battle.invalid': {
        render: (params) => {
            return `<span class="yellow">[系统]</span>检测到异常战斗状态（${escapeHtml(params.reason)}），已自动清除。`;
        },
    },
    'battle.start': {
        render: (params) => {
            const enemy = `<span class="red">${escapeHtml(params.enemy_name)}</span>`;
            if (params.initiator === 'player') {
                return `你向${enemy}发起了攻击，战斗开始！`;
            }
            return `${enemy}向你发起了突袭，战斗开始！`;
        },
    },
    'battle.end': {
        render: (params) => {
            const enemy = `<span class="red">${escapeHtml(params.enemy_name)}</span>`;
            switch (params.result) {
                case 'victory':
                    return `你击败了${enemy}，战斗结束。`;
                case 'defeat':
                    return `你被${enemy}击败了...`;
                case 'escape':
                    return `你成功逃离了战斗。`;
                default:
                    return `战斗结束。`;
            }
        },
    },
};

/**
 * 渲染单条日志为 HTML
 *
 * @param {Object} entry 日志条目 {id, action, params, html, ts}
 * @returns {string} HTML 字符串（空字符串表示无内容，由调用方过滤）
 */
export function renderLogEntry(entry) {
    // fallback HTML 优先（逃生通道，正常为 null）
    if (entry.html) return entry.html;

    const template = LOG_TEMPLATES[entry.id];
    if (!template) {
        // 未知 ID：显示原始信息
        return `<span class="grey">[未知日志: ${escapeHtml(entry.id)}]</span>`;
    }

    const params = entry.params || {};

    // 自定义渲染函数优先
    if (template.render) {
        return template.render(params);
    }

    // 文本模板渲染
    let text = template.text || '';

    // 替换占位符（先转义参数值，再替换）
    for (const key in params) {
        const placeholder = new RegExp('\\{' + key + '\\}', 'g');
        text = text.replace(placeholder, escapeHtml(String(params[key])));
    }

    // 应用高亮：对已转义的高亮参数值包裹 span（防御空字符串）
    if (template.highlight && template.highlightClass) {
        for (const key of template.highlight) {
            if (params[key] !== undefined && params[key] !== '') {
                const escaped = escapeHtml(String(params[key]));
                if (escaped) {
                    const wrapped = `<span class="${template.highlightClass}">${escaped}</span>`;
                    text = text.replace(escaped, wrapped);
                }
            }
        }
    }

    return text;
}
