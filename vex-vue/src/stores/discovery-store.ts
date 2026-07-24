/**
 * @module K 状态管理层
 */

// ══════════════════════════════════════════════════
// 发现合并模态 store / Discovery Merge Modal Store
//
// 承载"同次信息获取多重要发现合并为一个模态"的反馈层状态（F-K5-Feedback §5.3 / 设计案 §4.12 / §7.8 / §6.2）：
//   - 模态开/关 + 本次合并的发现项集合
//   - 已发现历史（用于"已发现不重复弹首次发现模态"，§7.8 不变量 7）
//   - 注意力等级分流（§4.12）：常规信息 / 普通道具 / 重要发现 / 强制事件
//   - 敌人批量合并（§7.8 不变量 10）
//   - "一键前往"只创建临时目标，不自动互动/拾取（§7.8 不变量 11，B4.13）
//
// 不变量：
//   1. 同次信息获取多重要发现合并为一个模态：不能连续弹出多个模态（§7.8 不变量 6）
//   2. 已发现内容不重复弹首次发现模态（§7.8 不变量 7）
//   3. 普通道具不弹模态（§7.8 不变量 8）—— 由 dispatchAttention 的 'item' 级别走 Toast
//   4. POI / 关键 / 任务 / 高价值道具进入重要发现模态（§7.8 不变量 9）
//   5. 敌人批量合并为敌人发现模态（§7.8 不变量 10）
//   6. POI / 关键道具模态的"一键前往"只创建临时目标（§7.8 不变量 11）
//
// 与 3.4 移动导演的接口契约（已决策项，接口签名固定）：
//   - 移动导演调用 dispatchAttention(level, payload) 触发反馈层
//   - 模态框打开时调用 playbackController.pausePlayback()
//   - 模态框关闭时调用 playbackController.resumePlayback()
//   - 强制事件（force）的反馈由移动导演负责（在最后一帧前显示原因），然后移交给战斗导演
//   - playbackController 由 3.4 移动导演通过 registerPlaybackController 注册
//
// 与 explore-store 的关系：
//   - "一键前往"调用 explore.setTarget(pls, name) 创建临时目标（§5.9）
//   - 不修改 explore-store 的 inputLocked（模态 overlay 阻断交互 + 移动导演 pause 已足够）
//
// 与 battle.ts 的关系：
//   - "进入战斗预装填"调用 battle.startBattle(enemyPid) 进入战斗场景
//   - 不修改 K-1 战斗导演
// ══════════════════════════════════════════════════

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { useToastStore } from '@/stores/toast';

/** 发现类型（与后端 W-E4 对齐 + 扩展 key_item） */
export type DiscoveryKind = 'enemy' | 'poi' | 'item' | 'key_item';

/** 注意力等级（设计案 §4.12 / W-E4） */
export type AttentionLevel = 'normal' | 'item' | 'important' | 'force';

/** 发现项（合并模态的展示单元） */
export interface DiscoveryItem {
  /** 自增 ID */
  id: number;
  /** 发现类型 */
  kind: DiscoveryKind;
  /** 实体名 */
  name: string;
  /** 所在位置 ID（用于"一键前往"setTarget） */
  pls: number;
  /** 注意力等级（决定是否入模态 + 是否中断导航） */
  attentionLevel: AttentionLevel;
  /** 数量（同名合并时累加，默认 1） */
  quantity: number;
  /** 敌人 PID（仅 enemy 类型，用于"进入战斗预装填"） */
  pid?: number;
}

/** 模态分组（按注意力等级 + 类型分组展示） */
export interface DiscoveryGroup {
  key: string;
  label: string;
  items: DiscoveryItem[];
}

/**
 * 注意力载荷（3.4 移动导演传入）。
 *
 * 接口签名固定——3.4 移动导演按此结构调用 dispatchAttention。
 */
export interface AttentionPayload {
  /** 本次注意力相关的移动结果（3.4 传入 MoveResult[]） */
  moves: unknown[];
  /** 发现内容（原始发现对象，由本 store 转换为 DiscoveryItem） */
  discoveries: unknown[];
  /** 中断信息（强制事件时由移动导演传入） */
  interrupt?: { reason: string; type: 'combat' | 'event' };
}

/**
 * 播放控制器接口（3.4 移动导演注册）。
 *
 * discovery-store 在模态框打开/关闭时调用 pause/resume，
 * 协同移动导演的演出会话（F-K5-Feedback §六.1）。
 */
export interface PlaybackController {
  pausePlayback(): void;
  resumePlayback(): void;
}

let itemIdGen = 1;

export const useDiscoveryStore = defineStore('discovery', () => {
  const toastStore = useToastStore();

  // ── 模态状态 ──
  const open = ref<boolean>(false);
  const items = ref<DiscoveryItem[]>([]);
  /** 模态标题（"发现 N 个敌对目标" / "本次发现" / "发现重要目标"） */
  const title = ref<string>('');
  /** 模态副标题（途中摘要，可空） */
  const subtitle = ref<string>('');
  /** 是否包含敌人（决定按钮文案：继续 / 进入战斗预装填） */
  const hasEnemy = ref<boolean>(false);
  /** 是否包含可"一键前往"的目标（POI / key_item） */
  const hasNavigable = ref<boolean>(false);

  // ── 已发现历史（key = `${kind}:${name}`，用于"已发现不重复弹模态"） ──
  const discoveredHistory = ref<Set<string>>(new Set());

  // ── 播放控制器（3.4 移动导演注册） ──
  let _playbackController: PlaybackController | null = null;

  // ══════════════════════════════════════════════════
  // 派生
  // ══════════════════════════════════════════════════

  /** 敌人发现分组 */
  const enemyItems = computed<DiscoveryItem[]>(() =>
    items.value.filter((i) => i.kind === 'enemy'),
  );

  /** POI 发现分组 */
  const poiItems = computed<DiscoveryItem[]>(() =>
    items.value.filter((i) => i.kind === 'poi'),
  );

  /** 关键道具分组 */
  const keyItemItems = computed<DiscoveryItem[]>(() =>
    items.value.filter((i) => i.kind === 'key_item'),
  );

  /** 按注意力等级 + 类型分组（用于模态 UI 分组展示） */
  const groups = computed<DiscoveryGroup[]>(() => {
    const result: DiscoveryGroup[] = [];
    if (enemyItems.value.length > 0) {
      result.push({
        key: 'enemy',
        label: `敌对目标 · ${enemyItems.value.length}`,
        items: enemyItems.value,
      });
    }
    if (poiItems.value.length > 0) {
      result.push({
        key: 'poi',
        label: `兴趣点 · ${poiItems.value.length}`,
        items: poiItems.value,
      });
    }
    if (keyItemItems.value.length > 0) {
      result.push({
        key: 'key_item',
        label: `关键道具 · ${keyItemItems.value.length}`,
        items: keyItemItems.value,
      });
    }
    return result;
  });

  // ══════════════════════════════════════════════════
  // 内部辅助
  // ══════════════════════════════════════════════════

  /** 历史键 */
  function historyKey(kind: DiscoveryKind, name: string): string {
    return `${kind}:${name}`;
  }

  /** 是否已发现过（用于"已发现不重复弹首次发现模态"） */
  function isDiscovered(kind: DiscoveryKind, name: string): boolean {
    return discoveredHistory.value.has(historyKey(kind, name));
  }

  /** 标记为已发现 */
  function markDiscovered(kind: DiscoveryKind, name: string): void {
    discoveredHistory.value.add(historyKey(kind, name));
  }

  /**
   * 将原始发现对象转换为 DiscoveryItem。
   *
   * 防御性转换：3.4 移动导演传入的 discoveries 是 unknown[]，
   * 此函数尝试从常见字段名中提取 kind/name/pls/pid/attentionLevel。
   */
  function convertDiscovery(raw: unknown): DiscoveryItem | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;

    // 确定 kind
    const rawKind = String(r.kind ?? r.type ?? '');
    let kind: DiscoveryKind;
    if (rawKind === 'enemy' || rawKind === 'poi' || rawKind === 'item' || rawKind === 'key_item') {
      kind = rawKind;
    } else if (rawKind === 'npc' || rawKind === 'hostile' || rawKind === 'enemy_npc') {
      kind = 'enemy';
    } else if (rawKind === 'mission' || rawKind === 'quest' || rawKind === 'high_value') {
      kind = 'key_item';
    } else {
      kind = 'item';
    }

    // 确定名称
    const name = String(r.name ?? r.title ?? r.display_name ?? '未知');

    // 确定位置 ID
    const pls = Number(r.pls ?? r.position ?? r.pls_id ?? 0);

    // 确定敌人 PID（仅 enemy 类型）
    const pid = r.pid !== undefined ? Number(r.pid) : (r.enemy_pid !== undefined ? Number(r.enemy_pid) : undefined);

    // 确定注意力等级
    const rawLevel = String(r.attentionLevel ?? r.attention_level ?? r.attention ?? 'important');
    const attentionLevel: AttentionLevel =
      rawLevel === 'normal' || rawLevel === 'item' || rawLevel === 'force'
        ? rawLevel
        : 'important';

    return {
      id: itemIdGen++,
      kind,
      name,
      pls,
      attentionLevel,
      quantity: 1,
      pid,
    };
  }

  // ══════════════════════════════════════════════════
  // 公共 API
  // ══════════════════════════════════════════════════

  /**
   * 注意力分发入口（3.4 移动导演调用）。
   *
   * 按注意力等级分流（设计案 §4.12 / F-K5-Feedback §5.4）：
   *   - normal：常规信息（迷雾/地形/潮汐变化），不弹模态，不中断导航
   *   - item：普通道具，显示具体名称和数量（Toast），不弹模态，不中断导航
   *   - important：重要发现（POI/关键道具/敌人），弹合并模态，中断导航（pausePlayback）
   *   - force：强制事件（陷阱/突袭/战斗），由 3.4 移动导演负责反馈，本 store 不弹模态
   *
   * 不变量保证：
   *   1. 同次多发现合并为一个模态（本方法一次性处理所有 discoveries，§7.8 不变量 6）
   *   2. 已发现内容不重复弹首次发现模态（§7.8 不变量 7）
   *   3. 普通道具不弹模态（§7.8 不变量 8）
   *   4. 敌人批量合并（§7.8 不变量 10）
   */
  function dispatchAttention(level: AttentionLevel, payload: AttentionPayload): void {
    switch (level) {
      case 'normal':
        // 常规信息：不弹模态，不中断导航
        // 日志由后端 obl_log 记录，logStore 自动获取
        return;

      case 'item':
        // 普通道具：显示具体名称和数量（Toast），不弹模态
        handleItemDiscoveries(payload);
        return;

      case 'important':
        // 重要发现：弹合并模态，中断导航
        handleImportantDiscoveries(payload);
        return;

      case 'force':
        // 强制事件：由 3.4 移动导演负责反馈（在最后一帧前显示原因）
        // 然后移交给战斗导演，本 store 不弹模态
        // 仅标记已发现的敌人/POI 历史（避免后续主动探索时重复弹模态）
        markDiscoveriesFromPayload(payload);
        return;
    }
  }

  /**
   * 处理普通道具发现（item 级别）。
   * 显示 Toast 提示具体名称和数量，不弹模态（§7.8 不变量 8）。
   */
  function handleItemDiscoveries(payload: AttentionPayload): void {
    const converted = payload.discoveries
      .map(convertDiscovery)
      .filter((d): d is DiscoveryItem => d !== null);
    if (converted.length === 0) return;

    // 普通道具：Toast 显示名称和数量
    if (converted.length === 1) {
      const item = converted[0];
      toastStore.showToast(
        `发现了 <span class="yellow">${escapeHtmlText(item.name)}</span>`,
        'info',
        2000,
        true,
        'discovery-item',
      );
    } else {
      const names = converted.map((i) => escapeHtmlText(i.name)).join('、');
      toastStore.showToast(
        `发现了 <span class="yellow">${names}</span>（${converted.length} 件）`,
        'info',
        2000,
        true,
        'discovery-item',
      );
    }
  }

  /**
   * 处理重要发现（important 级别）。
   * 弹出合并模态，中断导航（§7.8 不变量 6/9/10）。
   */
  function handleImportantDiscoveries(payload: AttentionPayload): void {
    const converted = payload.discoveries
      .map(convertDiscovery)
      .filter((d): d is DiscoveryItem => d !== null);

    // 过滤：仅重要发现入模态（普通道具 / 常规信息不弹模态，§7.8 不变量 8）
    const important = converted.filter(
      (i) => i.attentionLevel === 'important' || i.attentionLevel === 'force',
    );

    // 过滤：已发现内容不重复弹首次发现模态（§7.8 不变量 7）
    const fresh = important.filter((i) => !isDiscovered(i.kind, i.name));

    if (fresh.length === 0) {
      // 没有新内容需要弹模态：仅标记历史，不打开
      markDiscoveriesFromPayload(payload);
      return;
    }

    // 标记历史
    for (const i of fresh) {
      markDiscovered(i.kind, i.name);
    }

    items.value = fresh;
    hasEnemy.value = fresh.some((i) => i.kind === 'enemy');
    hasNavigable.value = fresh.some((i) => i.kind === 'poi' || i.kind === 'key_item');

    // 自动派生标题
    if (hasEnemy.value) {
      const n = enemyItems.value.length;
      title.value = `发现 ${n} 个敌对目标，对方尚未发现你`;
    } else if (fresh.some((i) => i.kind === 'key_item')) {
      title.value = '发现关键道具';
    } else {
      title.value = '本次发现';
    }
    subtitle.value = '';

    // 暂停移动导演播放（F-K5-Feedback §六.1）
    _playbackController?.pausePlayback();

    open.value = true;
  }

  /** 标记 payload 中的发现已记录到历史（不弹模态） */
  function markDiscoveriesFromPayload(payload: AttentionPayload): void {
    const converted = payload.discoveries
      .map(convertDiscovery)
      .filter((d): d is DiscoveryItem => d !== null);
    for (const i of converted) {
      markDiscovered(i.kind, i.name);
    }
  }

  /**
   * 关闭模态（玩家点"继续" / "进入战斗预装填" / "一键前往"）。
   * 不清空已发现历史——历史是会话级状态。
   * 恢复移动导演播放（F-K5-Feedback §六.1）。
   */
  function closeModal(): void {
    const wasOpen = open.value;
    open.value = false;
    items.value = [];
    title.value = '';
    subtitle.value = '';
    hasEnemy.value = false;
    hasNavigable.value = false;

    // 恢复移动导演播放（仅在模态打开时才恢复，避免误触发 resume）
    if (wasOpen) {
      _playbackController?.resumePlayback();
    }
  }

  /**
   * 重置已发现历史（开始新会话 / 调试用）。
   * 一般不需要调用——已发现历史在整个会话期内有效。
   */
  function resetHistory(): void {
    discoveredHistory.value.clear();
  }

  /**
   * 注册播放控制器（3.4 移动导演在初始化时调用）。
   *
   * discovery-store 在模态框打开时调用 pausePlayback()，
   * 在模态框关闭时调用 resumePlayback()，协同移动导演的演出会话。
   */
  function registerPlaybackController(controller: PlaybackController): void {
    _playbackController = controller;
  }

  /** 注销播放控制器（3.4 移动导演卸载时调用） */
  function unregisterPlaybackController(): void {
    _playbackController = null;
  }

  return {
    // 状态
    open,
    items,
    title,
    subtitle,
    hasEnemy,
    hasNavigable,
    discoveredHistory,
    // 派生
    enemyItems,
    poiItems,
    keyItemItems,
    groups,
    // 查询
    isDiscovered,
    // 注意力分发（3.4 移动导演调用）
    dispatchAttention,
    // 模态控制
    closeModal,
    // 历史
    resetHistory,
    markDiscovered,
    // 播放控制器注册（3.4 移动导演调用）
    registerPlaybackController,
    unregisterPlaybackController,
  };
});

/** 简易 HTML 转义（避免引入 utils 依赖） */
function escapeHtmlText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
