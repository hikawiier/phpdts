// ══════════════════════════════════════════════════
// Oblivions 日志模板配置 / Oblivions log templates
//
// 按 ID 索引渲染文案，后端只传参数，前端完全控制视觉呈现。
// 相关文档：oblivions/docs/结构化日志系统设计案.md
// ══════════════════════════════════════════════════

import { generateTerrainDesc } from './terrain-desc';
import { escapeHtml } from '@/utils/format';
import { ITEM_LOCALE } from './item-locale';
import type { LogEntry } from '@/types/api';

/** 日志参数类型 */
export type LogParams = Record<string, string | number | boolean | object>;

/**
 * 模板定义
 *
 * 每个模板可包含以下字段：
 * - text:           文案模板，{param} 占位符
 * - highlight:      需要高亮的参数名数组
 * - highlightClass: 高亮用的 CSS 类名（如 'yellow'/'red'）
 * - render:         自定义渲染函数（优先于 text），接收 params 对象，返回 HTML 字符串
 */
export interface LogTemplate {
  text?: string;
  highlight?: string[];
  highlightClass?: string;
  render?: (params: LogParams) => string;
}

/** 模板表（与现有 vex/data/log-templates.js 一致） */
export const LOG_TEMPLATES: Record<string, LogTemplate> = {
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
      const tileName =
        (params.name as string) ||
        generateTerrainDesc(
          params.floor as string,
          params.tide as string,
          !!params.passable,
        );
      return `<span class="red">${escapeHtml(tileName)}</span>，无法通行，请绕道。`;
    },
  },
  'move.occupied': {
    render: (params) => {
      const tileName =
        (params.name as string) ||
        generateTerrainDesc(
          params.floor as string,
          params.tide as string,
          !!params.passable,
        );
      return `<span class="red">${escapeHtml(tileName)}</span>已被占据。`;
    },
  },
  'move.unreachable': {
    render: (params) => {
      const tileName =
        (params.name as string) ||
        generateTerrainDesc(
          params.floor as string,
          params.tide as string,
          !!params.passable,
        );
      return `无法直接移动到<span class="yellow">${escapeHtml(tileName)}</span>。`;
    },
  },
  'move.no_path': {
    render: (params) => {
      const tileName =
        (params.name as string) ||
        generateTerrainDesc(
          params.floor as string,
          params.tide as string,
          !!params.passable,
        );
      return `无法直接移动到<span class="yellow">${escapeHtml(tileName)}</span>，需要通过相邻区域。`;
    },
  },
  'move.no_sp_far': {
    text: '体力不足，无法移动到那么远的地方。',
  },
  'move.success': {
    // 有名格显示 name，无名格前端生成描述
    render: (params) => {
      const from = params.from as Record<string, string | number | boolean>;
      const to = params.to as Record<string, string | number | boolean>;
      const fromName =
        (from?.name as string) ||
        generateTerrainDesc(
          from?.floor as string,
          from?.tide as string,
          !!from?.passable,
        );
      const toName =
        (to?.name as string) ||
        generateTerrainDesc(
          to?.floor as string,
          to?.tide as string,
          !!to?.passable,
        );
      return `从${escapeHtml(fromName)}移动到了<span class="yellow">${escapeHtml(toName)}</span>。`;
    },
  },
  'move.tile_desc': {
    // 特殊模板：有名格直接显示 desc，无名格前端组合随机描述
    render: (params) => {
      if (params.name) {
        // 有名格：显示 desc（若有）
        return params.desc ? escapeHtml(params.desc as string) : '';
      }
      // 无名格：前端组合随机描述
      const desc = generateTerrainDesc(
        params.floor as string,
        params.tide as string,
        !!params.passable,
      );
      return escapeHtml(desc);
    },
  },
  'move.region_leave': {
    render: (params) => {
      return `离开了<span class="yellow">${escapeHtml(params.region_name as string)}</span>。`;
    },
  },
  'move.region_enter': {
    render: (params) => {
      let html = `进入了<span class="yellow">${escapeHtml(params.region_name as string)}</span>。`;
      if (params.region_desc)
        html += '<br>' + escapeHtml(params.region_desc as string);
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
      const items = params.items as string[] | undefined;
      if (items && items.length > 0) {
        const itemsHtml = items.map(escapeHtml).join('、');
        return `你搜索了${escapeHtml(params.poi_name as string)}，发现了<span class="yellow">${itemsHtml}</span>。`;
      }
      return `你搜索了${escapeHtml(params.poi_name as string)}，但什么也没找到。`;
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
      return `你伸手去拿<span class="yellow">${escapeHtml(params.item_name as string)}</span>——<br><span class="red">那是一个陷阱！</span>`;
    },
  },
  'pickup.nearsighted_reveal': {
    render: (params) => {
      return `你拿起了看似普通的东西——原来是<span class="yellow">${escapeHtml(params.item_name as string)}</span>！`;
    },
  },
  'pickup.bag_full': {
    text: '背包已满，无法拾取。',
  },
  'pickup.empty_item': {
    text: '道具无效，无法拾取。',
  },
  'pickup.success': {
    render: (params) => {
      const name = ITEM_LOCALE[params.item_id as string]?.name ?? params.item_id;
      return `捡起了<span class="yellow">${escapeHtml(name)}</span>。`;
    },
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

  // ─── organize ───────────────────────────────────
  // item.to_bag：道具从 itm0 进入背包（拾取/合成/手动整理成功均复用此事件）
  'item.to_bag': {
    render: (params) => {
      const name = ITEM_LOCALE[params.item_id as string]?.name ?? params.item_id;
      return `把<span class="yellow">${escapeHtml(name)}</span>放进了背包。`;
    },
  },
  'organize.fail': {
    render: (params) => {
      const name = ITEM_LOCALE[params.item_id as string]?.name ?? params.item_id;
      return `背包已满，<span class="yellow">${escapeHtml(name)}</span>仍拿在手中。`;
    },
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
  'system.itm0_pending': {
    text: '你正手持道具，请先处理。',
  },
  'system.itm0_occupied': {
    text: '你正手持道具，请先处理。',
  },

  // ─── enemy ──────────────────────────────────────
  'enemy.discovered': {
    render: (params) => {
      return `你发现了<span class="red">${escapeHtml(params.enemy_name as string)}</span>的踪迹。`;
    },
  },
  'enemy.move': {
    render: (params) => {
      return `<span class="red">${escapeHtml(params.enemy_name as string)}</span>移动了位置。`;
    },
  },
  'enemy.ambush': {
    render: (params) => {
      return `<span class="red">${escapeHtml(params.enemy_name as string)}</span>突然向你发起了突袭！`;
    },
  },
  // ─── battle ────────────────────────────────────
  'battle.skirmish': {
    render: (params) => {
      const enemy = `<span class="red">${escapeHtml(params.enemy_name as string)}</span>`;
      if (params.initiator === 'player') {
        return `你与${enemy}发生碰撞，经过短暂交火后各自退回原地。`;
      }
      return `${enemy}与你发生碰撞，经过短暂交火后各自退回原地。`;
    },
  },
  'battle.invalid': {
    render: (params) => {
      return `<span class="yellow">[系统]</span>检测到异常战斗状态（${escapeHtml(params.reason as string)}），已自动清除。`;
    },
  },
  'battle.start': {
    render: (params) => {
      const enemy = `<span class="red">${escapeHtml(params.enemy_name as string)}</span>`;
      if (params.initiator === 'player') {
        return `你向${enemy}发起了攻击，战斗开始！`;
      }
      return `${enemy}向你发起了突袭，战斗开始！`;
    },
  },
  'battle.end': {
    render: (params) => {
      const enemy = `<span class="red">${escapeHtml(params.enemy_name as string)}</span>`;
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

  // ─── use_item / durability ─────────────────────
  'use_item.empty_slot': {
    text: '该槽位没有道具。',
  },
  'use_item.not_usable': {
    text: '这个道具无法使用。',
  },
  'use_item.broken': {
    render: (params) => {
      const name = ITEM_LOCALE[params.item_id as string]?.name ?? params.item_id;
      return `<span class="red">${escapeHtml(name)}已损坏，无法使用。</span>`;
    },
  },
  'use_item.effect_not_registered': {
    render: (params) => {
      return `<span class="grey">[系统] 使用效果「${escapeHtml(params.effect as string)}」尚未实现。</span>`;
    },
  },
  'use_item.success': {
    render: (params) => {
      const name = ITEM_LOCALE[params.item_id as string]?.name ?? params.item_id;
      return `你使用了<span class="yellow">${escapeHtml(name)}</span>。`;
    },
  },
  'durability.broken': {
    render: (params) => {
      const name = ITEM_LOCALE[params.item_id as string]?.name ?? params.item_id;
      return `<span class="red">${escapeHtml(name)}已损坏。</span>`;
    },
  },

  // ─── craft ─────────────────────────────────────
  'craft.success': {
    render: (params) => {
      const name = params.recipe_name as string | null | undefined;
      return name ? `合成成功：${name}。` : '合成成功。';
    },
  },
  'craft.fail_no_match': {
    text: '这些素材无法合成任何东西。',
  },
  'craft.fail_ambiguous': {
    render: (params) => {
      const count = params.match_count as number;
      return `素材指向不明确（匹配 ${count} 个配方），需要放更多素材。`;
    },
  },
  'craft.fail_bag_full': {
    text: '背包空间不足，无法放入合成产物。',
  },
  'craft.fail_itm0_occupied': {
    text: '你正手持道具，请先堆叠合并或丢弃。',
  },

  // ─── craft preview（预判反馈，非真实日志） ──────
  'craft.empty_pool': {
    text: '放入素材才能合成。',
  },
  'craft.tool_missing': {
    text: '需要合适的工具（如烹饪器具/锻造工具）。',
  },
  'craft.extra_material': {
    text: '有些素材用不上，试试移除部分素材。',
  },
  'craft.insufficient': {
    text: '可能缺少素材或工作台。',
  },
  'craft.ready': {
    render: (params) => {
      const name = params.recipe_name as string | undefined;
      return name ? `可合成：${name}。` : '可合成。';
    },
  },
};

/**
 * 渲染拾取+入背包合并 Toast 文案
 * - 单道具：捡起了 xxx，放入了背包。
 * - 批量：捡起了 N 件道具，放入了背包。
 *
 * 用于拾取成功场景下 pickup.success + item.to_bag 双 Toast 合并，
 * 避免两个几乎同时弹出的 Toast 造成视觉噪音。
 */
export function renderPickupToBagMerged(item_id: string, count: number): string {
  if (count > 1) {
    return `捡起了<span class="yellow">${count}</span>件道具，放入了背包。`;
  }
  const name = ITEM_LOCALE[item_id]?.name ?? item_id;
  return `捡起了<span class="yellow">${escapeHtml(name)}</span>，放入了背包。`;
}

/**
 * 渲染单条日志为 HTML
 *
 * @param entry 日志条目 {id, params, html, ts}
 * @returns HTML 字符串（空字符串表示无内容，由调用方过滤）
 */
export function renderLogEntry(entry: LogEntry): string {
  // fallback HTML 优先（逃生通道，正常为 null）
  if (entry.html) return entry.html;

  const template = LOG_TEMPLATES[entry.id];
  if (!template) {
    // 未知 ID：显示原始信息
    return `<span class="grey">[未知日志: ${escapeHtml(entry.id)}]</span>`;
  }

  const params: LogParams = (entry.params as LogParams) || {};

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
      const value = params[key];
      if (value !== undefined && value !== '') {
        const escaped = escapeHtml(String(value));
        if (escaped) {
          const wrapped = `<span class="${template.highlightClass}">${escaped}</span>`;
          // 使用函数形式 replace，避免 escaped 中的 $ 字符被当作特殊匹配模式
          text = text.replace(escaped, () => wrapped);
        }
      }
    }
  }

  return text;
}
