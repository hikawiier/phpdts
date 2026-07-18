/**
 * @module K 状态管理层
 */

// ══════════════════════════════════════════════════
// Oblivions 日志模板配置 / Oblivions log templates
//
// 按 ID 索引渲染文案，后端只传参数，前端完全控制视觉呈现。
// 相关文档：oblivions/docs/结构化日志系统设计案.md
// ══════════════════════════════════════════════════

import { generateTerrainDesc } from './terrain-desc';
import { escapeHtml } from '@/utils/format';
import { ITEM_LOCALE } from './item-locale';
import { getPoiName } from './poi-locale';
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
  'wait.success': {
    text: '你停下来调整了一下状态。',
  },
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
  // 探索后钩子完成（调试日志，三段式占位骨架的完成标记）
  'explore.hook_completed': {
    render: () => `<span class="grey">[调试] 探索钩子已执行。</span>`,
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
  // 普通档掉落（params={iaid, item_ids}；search.result 仅在 loot 命中时 emit）
  'search.result': {
    render: (params) => {
      const itemIds = params.item_ids as string[] | undefined;
      if (itemIds && itemIds.length > 0) {
        const itemsHtml = itemIds
          .map((id) => ITEM_LOCALE[id]?.name ?? id)
          .map(escapeHtml)
          .join('、');
        return `发现了 <span class="yellow">${itemsHtml}</span>。`;
      }
      return `<span class="grey">什么也没找到。</span>`;
    },
  },
  // POI 实例无效（防御性，params=[]）
  'search.invalid_poi': {
    render: () => `<span class="grey">[系统] 无效的建筑物。</span>`,
  },
  // POI 已搜空（终态，params={iaid}）
  'search.exhausted': {
    text: '这里已经被搜空了。',
  },
  // POI 冷却中（params={iaid, until?}）
  'search.in_cooldown': {
    text: '这里暂时没有可搜刮的东西，稍后再来。',
  },
  // 保底机制触发（params={iaid, item_ids}）
  'search.pity_triggered': {
    render: (params) => {
      const itemIds = params.item_ids as string[] | undefined;
      if (itemIds && itemIds.length > 0) {
        const itemsHtml = itemIds
          .map((id) => ITEM_LOCALE[id]?.name ?? id)
          .map(escapeHtml)
          .join('、');
        return `<span class="yellow">保底触发！</span>发现了 <span class="yellow">${itemsHtml}</span>。`;
      }
      return `<span class="yellow">保底触发！</span>但什么也没找到。`;
    },
  },
  // 空档：什么也没找到（params={iaid}）
  'search.nothing_found': {
    render: () => `搜刮了一番，<span class="grey">什么也没找到。</span>`,
  },
  // 并发冲突（乐观锁抢占失败，params={iaid, old_state, new_state}）
  'search.concurrent_conflict': {
    render: () => `<span class="grey">[系统] 操作冲突，请重试。</span>`,
  },
  // 事件函数未定义（降级为普通档判定，params={event_id}）
  'search.event_pending': {
    render: (params) =>
      `<span class="grey">[系统] 事件「${escapeHtml(String(params.event_id))}」尚未实现。</span>`,
  },
  // 事件：发现额外补给箱（良性，params={iaid, item_ids}）
  'search.event.find_extra_cache': {
    render: (params) => {
      const itemIds = params.item_ids as string[] | undefined;
      if (itemIds && itemIds.length > 0) {
        const itemsHtml = itemIds
          .map((id) => ITEM_LOCALE[id]?.name ?? id)
          .map(escapeHtml)
          .join('、');
        return `发现一个<span class="yellow">额外的补给箱</span>！里面装着 <span class="yellow">${itemsHtml}</span>。`;
      }
      return `发现一个<span class="yellow">额外的补给箱</span>！但里面是空的。`;
    },
  },
  // 事件：发现安全路径（良性，params={iaid, expires_turn}）
  'search.event.safe_route': {
    render: (params) => {
      const expires = Number(params.expires_turn);
      const suffix = !Number.isNaN(expires) && expires > 0 ? `（持续至 tick ${expires}）` : '';
      return `发现一条<span class="yellow">安全路径</span>，下次移动体力消耗减半！${suffix}`;
    },
  },
  // 事件：触发陷阱（恶性，params={iaid, damage}）
  'search.event.trap_trigger': {
    render: (params) => {
      const damage = Number(params.damage) || 0;
      return `<span class="red">触发了陷阱！</span>受到 <span class="red">${damage}</span> 点伤害。`;
    },
  },
  // 事件：结构坍塌（恶性，params={iaid}）
  'search.event.structure_collapse': {
    render: () =>
      `<span class="red">建筑物在你搜刮时坍塌了！</span>所有物资都被压坏了。`,
  },

  // ─── loot（错误日志，红色高亮） ─────────────────
  // 战利品表未找到（params={table_id}）
  'loot.table_not_found': {
    render: (params) =>
      `<span class="red">[战利品] 表「${escapeHtml(String(params.table_id))}」未找到。</span>`,
  },
  // 战利品表条目超限（params={table_id, total, limit}）
  'loot.entries_exceed_limit': {
    render: (params) => {
      const total = Number(params.total) || 0;
      const limit = Number(params.limit) || 0;
      return `<span class="red">[战利品] 表「${escapeHtml(String(params.table_id))}」条目超限（${total}/${limit}）。</span>`;
    },
  },
  // 道具模板缺失（params={item_id}）
  'loot.item_template_missing': {
    render: (params) =>
      `<span class="red">[战利品] 道具模板「${escapeHtml(String(params.item_id))}」缺失。</span>`,
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
  'restore_hp.invalid': {
    render: (params) => `<span class="grey">[系统] HP 恢复量或上限异常（amount=${params.amount}, mhp=${params.mhp}）。</span>`,
  },
  'restore_hp.success': {
    render: (params) => {
      const amount = params.amount as number;
      if (amount <= 0) return `<span class="lime">HP 已满。</span>`;
      return `<span class="lime">HP 恢复了 ${amount} 点。</span>`;
    },
  },
  'restore_sp.invalid': {
    render: (params) => `<span class="grey">[系统] SP 恢复量或上限异常（amount=${params.amount}, msp=${params.msp}）。</span>`,
  },
  'restore_sp.success': {
    render: (params) => {
      const amount = params.amount as number;
      if (amount <= 0) return `<span class="lime">SP 已满。</span>`;
      return `<span class="lime">SP 恢复了 ${amount} 点。</span>`;
    },
  },
  'cure_bs.success': {
    render: (params) => {
      const cured = params.cured as string[] | undefined;
      if (!cured || cured.length === 0) return `<span class="lime">身体状态正常，无需清除。</span>`;
      return `<span class="lime">清除了身体状态：${cured.map(escapeHtml).join('、')}。</span>`;
    },
  },
  'gain_resistance.triggered': {
    render: () => `<span class="grey">[系统] 抗性跃迁事件已触发（占位，等待被动技能系统订阅）。</span>`,
  },
  'open_gift_box.table_missing': {
    render: () => `<span class="red">[系统] 礼盒战利品表缺失。</span>`,
  },
  'open_gift_box.empty': {
    render: () => `<span class="grey">礼盒是空的。</span>`,
  },
  'open_gift_box.bag_full': {
    render: (params) => {
      const dropped = (params.dropped as string[] | undefined) ?? [];
      const names = dropped.map((id) => ITEM_LOCALE[id]?.name ?? id).map(escapeHtml).join('、');
      return `<span class="red">背包已满，丢失了：${names}。</span>`;
    },
  },
  'open_gift_box.success': {
    render: (params) => {
      const count = params.count as number;
      return `<span class="yellow">礼盒打开了，获得了 ${count} 件物品。</span>`;
    },
  },
  'durability.broken': {
    render: (params) => {
      const name = ITEM_LOCALE[params.item_id as string]?.name ?? params.item_id;
      return `<span class="red">${escapeHtml(name)}已损坏。</span>`;
    },
  },

  // ─── equip / unequip ───────────────────────────
  'equip.success': {
    render: (params) => {
      const name = ITEM_LOCALE[params.item_id as string]?.name ?? params.item_id;
      return `你装备了<span class="yellow">${escapeHtml(name)}</span>。`;
    },
  },
  'equip.empty_slot': {
    text: '该槽位没有道具。',
  },
  'equip.not_equippable': {
    render: (params) => {
      const name = ITEM_LOCALE[params.item_id as string]?.name ?? params.item_id;
      return `<span class="red">${escapeHtml(name)}无法装备。</span>`;
    },
  },
  'equip.broken': {
    render: (params) => {
      const name = ITEM_LOCALE[params.item_id as string]?.name ?? params.item_id;
      return `<span class="red">${escapeHtml(name)}已损坏，无法装备。</span>`;
    },
  },
  'equip.invalid_kind': {
    render: (params) => {
      const name = ITEM_LOCALE[params.item_id as string]?.name ?? params.item_id;
      return `<span class="red">${escapeHtml(name)}的类别无法装备。</span>`;
    },
  },
  'equip.invalid_slot': {
    text: '无效的装备槽位。',
  },
  'equip.bag_full': {
    render: (params) => {
      const name = ITEM_LOCALE[params.item_id as string]?.name ?? params.item_id;
      return `<span class="red">背包已满，无法装备${escapeHtml(name)}。</span>`;
    },
  },
  'unequip.success': {
    render: (params) => {
      const name = ITEM_LOCALE[params.item_id as string]?.name ?? params.item_id;
      return `你卸下了<span class="yellow">${escapeHtml(name)}</span>。`;
    },
  },
  'unequip.empty_slot': {
    text: '该装备槽位是空的。',
  },
  'unequip.invalid_slot': {
    text: '无效的装备槽位。',
  },
  'unequip.bag_full': {
    render: (params) => {
      const name = ITEM_LOCALE[params.item_id as string]?.name ?? params.item_id;
      return `<span class="red">背包已满，无法卸下${escapeHtml(name)}。</span>`;
    },
  },

  // ─── swap_weapon ───────────────────────────────
  // 主副武器交换（item.swap_weapon）
  // params: { wep_item_id, wep2_item_id }（交换后的新主/副武器模板 ID，可能为空）
  'swap_weapon.success': {
    render: (params) => {
      const wepId = params.wep_item_id as string | undefined;
      const wep2Id = params.wep2_item_id as string | undefined;
      const wepName = wepId ? (ITEM_LOCALE[wepId]?.name ?? wepId) : '';
      const wep2Name = wep2Id ? (ITEM_LOCALE[wep2Id]?.name ?? wep2Id) : '';
      // 主副武器都非空：显示双武器名
      if (wepName && wep2Name) {
        return `主副武器已交换：<span class="yellow">${escapeHtml(wepName)}</span> ⇄ <span class="yellow">${escapeHtml(wep2Name)}</span>。`;
      }
      // 仅主武器（原副武器为空，副武器被换到主手）
      if (wepName) {
        return `将<span class="yellow">${escapeHtml(wepName)}</span>换到了主手。`;
      }
      // 仅副武器（原主武器为空，主手为空，副手收到原主武器——实际不会发生，因为字段对调）
      if (wep2Name) {
        return `将<span class="yellow">${escapeHtml(wep2Name)}</span>换到了副手。`;
      }
      // 双空（理论上已被 both_empty 拦截）
      return `<span class="grey">主副武器均为空，无需交换。</span>`;
    },
  },
  // 双空：主副武器均为空，无交换发生
  'swap_weapon.both_empty': {
    text: '主副武器均为空，无需交换。',
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

  // ─── poi.interact / F-6 道具交互 ───────────────
  'poi.interact.empty_slot': {
    text: '该槽位没有道具。',
  },
  'poi.interact.not_interactive': {
    render: (params) => {
      const name = ITEM_LOCALE[params.item_id as string]?.name ?? params.item_id;
      return `<span class="red">${escapeHtml(name)}</span>无法与 POI 交互。`;
    },
  },
  'poi.interact.broken': {
    render: (params) => {
      const name = ITEM_LOCALE[params.item_id as string]?.name ?? params.item_id;
      return `<span class="red">${escapeHtml(name)}已损坏，无法用于交互。</span>`;
    },
  },
  'poi.interact.no_interaction': {
    text: '该道具无法与此 POI 交互。',
  },
  'poi.interact.already_unlocked': {
    text: '此 POI 已被解锁。',
  },
  'poi.interact.already_ignited': {
    text: '此 POI 已被点燃。',
  },
  'poi.interact.already_done': {
    text: '此 POI 已被交互过。',
  },
  'poi.interact.concurrent_conflict': {
    render: () => `<span class="grey">[系统] 操作冲突，请重试。</span>`,
  },
  'poi.interact.success': {
    render: (params) => {
      const name = ITEM_LOCALE[params.item_id as string]?.name ?? params.item_id;
      return `你使用<span class="yellow">${escapeHtml(name)}</span>与 POI 交互。`;
    },
  },
  // ─── place_poi / F-7 玩家放置 POI ───────────────
  // params: {item_id, poi_id, iaid, placed_by_pid, placed_at_day, ttl_days}
  'place_poi.success': {
    render: (params) => {
      const itemName = ITEM_LOCALE[params.item_id as string]?.name ?? (params.item_id as string);
      const poiName = getPoiName(params.poi_id as string);
      const ttlDays = Number(params.ttl_days) || 0;
      const ttlSuffix = ttlDays > 0
        ? `（<span class="grey">${ttlDays} 天后到期</span>）`
        : '';
      return `你使用<span class="yellow">${escapeHtml(itemName)}</span>放置了<span class="yellow">${escapeHtml(poiName)}</span>${ttlSuffix}。`;
    },
  },
  // ─── poi.durability / E-12 POI 耐久清理（系统级，day_changed 触发）──
  // params: {day, cleaned_count, iaid_list}
  'poi.durability.cleanup': {
    render: (params) => {
      const day = Number(params.day) || 0;
      const count = Number(params.cleaned_count) || 0;
      if (count <= 0) return '';
      const dayPrefix = day > 0 ? `第 ${day} 天清晨，` : '清晨，';
      return `<span class="grey">${dayPrefix}${count} 个放置物到期消逝。</span>`;
    },
  },
  // ─── poi.dismantle / F-7 玩家拆除 POI ───────────
  // params: {iaid, poi_id, returned_ids, dropped_ids}
  'poi.dismantle.success': {
    render: (params) => {
      const poiName = getPoiName(params.poi_id as string);
      const returnedIds = (params.returned_ids as string[] | undefined) ?? [];
      const droppedIds = (params.dropped_ids as string[] | undefined) ?? [];

      const parts: string[] = [`你拆除了<span class="yellow">${escapeHtml(poiName)}</span>`];
      if (returnedIds.length > 0) {
        const names = returnedIds
          .map((id) => ITEM_LOCALE[id]?.name ?? id)
          .map(escapeHtml)
          .join('、');
        parts.push(`获得<span class="yellow">${names}</span>`);
      }
      if (droppedIds.length > 0) {
        parts.push(`<span class="grey">${droppedIds.length} 件掉到地上</span>`);
      }
      return parts.join('，') + '。';
    },
  },
  'unlock_door.unlocked': {
    text: '门被撬开了。',
  },
  'open_container.opened': {
    render: (params) => {
      const count = Number(params.item_count) || 0;
      return count > 0 ? `宝箱被打开，获得了 ${count} 件物品。` : '宝箱被打开，但是空的。';
    },
  },
  'ignite.ignited': {
    text: '火堆被点燃了。',
  },

  // ─── place_poi 错误分支 ──────────────────────────
  // 同格同模板软上限触发：params={item_id, poi_id, pgroup, pls}
  'place_poi.tile_limit': {
    render: (params) => {
      const itemName = ITEM_LOCALE[params.item_id as string]?.name ?? (params.item_id as string);
      const poiName = getPoiName(params.poi_id as string);
      return `<span class="red">这个格子里已经有一个${escapeHtml(poiName)}了，无法再放置${escapeHtml(itemName)}。</span>`;
    },
  },

  // ─── debug.* 调试日志（A-5 调试工具框架）─────────
  // params={before_tick, after_tick, before_day, after_day, before_phase, after_phase, ticks}
  'debug.advance_tick': {
    render: (params) => {
      const ticks = Number(params.ticks) || 0;
      const beforeTick = Number(params.before_tick) ?? 0;
      const afterTick = Number(params.after_tick) ?? 0;
      const beforeDay = Number(params.before_day) ?? 1;
      const afterDay = Number(params.after_day) ?? 1;
      const beforePhase = String(params.before_phase ?? 'day');
      const afterPhase = String(params.after_phase ?? 'day');
      return `<span class="grey">[调试] 推进了 ${ticks} tick：tick ${beforeTick}→${afterTick}，D${beforeDay}→D${afterDay}，${escapeHtml(beforePhase)}→${escapeHtml(afterPhase)}。</span>`;
    },
  },
  // params={from_day, to_day}
  'debug.trigger_day_changed': {
    render: (params) => {
      const fromDay = Number(params.from_day) ?? 1;
      const toDay = Number(params.to_day) ?? 1;
      return `<span class="grey">[调试] 触发 day_changed 事件：D${fromDay} → D${toDay}。</span>`;
    },
  },
  // params={item_id, requested, stored_count, dropped_count}
  'debug.give_item': {
    render: (params) => {
      const itemId = String(params.item_id ?? '');
      const itemName = ITEM_LOCALE[itemId]?.name ?? itemId;
      const requested = Number(params.requested) ?? 0;
      const stored = Number(params.stored_count) ?? 0;
      const dropped = Number(params.dropped_count) ?? 0;
      const parts: string[] = [`给予 <span class="yellow">${escapeHtml(itemName)}</span> ×${requested}`];
      if (stored > 0) parts.push(`入背包 ${stored}`);
      if (dropped > 0) parts.push(`掉地上 ${dropped}`);
      return `<span class="grey">[调试] ${parts.join('，')}。</span>`;
    },
  },
  // params={target, before_tick, after_tick, before_day, after_day, before_phase, after_phase, delta}
  'debug.advance_to_phase': {
    render: (params) => {
      const target = String(params.target ?? '');
      const beforeTick = Number(params.before_tick) ?? 0;
      const afterTick = Number(params.after_tick) ?? 0;
      const beforeDay = Number(params.before_day) ?? 1;
      const afterDay = Number(params.after_day) ?? 1;
      const beforePhase = String(params.before_phase ?? 'day');
      const afterPhase = String(params.after_phase ?? 'day');
      const delta = Number(params.delta) ?? 0;
      return `<span class="grey">[调试] 推进到相位 ${escapeHtml(target)}（${delta} tick）：tick ${beforeTick}→${afterTick}，D${beforeDay}→D${afterDay}，${escapeHtml(beforePhase)}→${escapeHtml(afterPhase)}。</span>`;
    },
  },
  // params={from:{pgroup,pls}, to:{pgroup,pls}}
  'debug.reset_position': {
    render: (params) => {
      const from = params.from as Record<string, number> | undefined;
      const to = params.to as Record<string, number> | undefined;
      const fromStr = from ? `(${from.pgroup},${from.pls})` : '?';
      const toStr = to ? `(${to.pgroup},${to.pls})` : '?';
      return `<span class="grey">[调试] 重置位置：${fromStr} → ${toStr}。</span>`;
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
