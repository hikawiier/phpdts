<script setup lang="ts">
/**
 * @module L Vue 组件
 * @framework L-3 战斗装填轨道与时序规划
 */
// ══════════════════════════════════════════════════
// 装填区 / Preload Area（v4 重构版）
//
// 设计案：oblivions/docs/战斗操作区-装填轨道与AP槽-设计案-2026-07-12.md
//
// 核心概念：
// - 装填队列 = 时序动作轨道（序号/手柄/target chip/AP/finisher标记/删除）
// - 半成品态 = pendingItem 虚拟项（不入 queue，独立 ref）
// - AP 预算槽 = N 个四态方块（available/locked/overload/depleted）
// - 技能库 = 标签页筛选 + 扁平列表
//
// 两种模式：
// - 'pre-battle'：玩家点击敌人后、战斗开始前。执行 → battle.start
// - 'in-battle'：战斗中玩家回合。执行 → battle.submit_turn
//
// 瞄准模式（target=enemy 且无 enemyPid 时触发）：
// - 进入瞄准 → broadcast 'battle:aim-mode' → AimMode 组件接管地图选目标
// - 选定目标 → AimMode broadcast 'battle:aim-target-selected' → 本组件 onTargetSelect
// - 退出瞄准 → broadcast 'battle:aim-exit'
// ══════════════════════════════════════════════════

import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { dataManager } from '@/stores/data-manager';
import { commandQueue } from '@/stores/command-queue';
import { useMapStore } from '@/stores/map';
import { useCharacterStore } from '@/stores/character';
import { useBattleStore } from '@/stores/battle';
import { useToastStore } from '@/stores/toast';
import { findPath } from '@/composables/useMapReachability';
import { getSkillTemplate } from '@/data/skill-templates';
import { findSelectableCombatTarget } from '@/utils/combat-targeting';
import type { Skill, CombatAimIntent, CombatViewModel, CombatTargetViewModel, CombatantViewModel } from '@/types/api';
import type { Character } from '@/types/character';
import type { PreloadInitEventData } from '@/types/events';
import { estimateMoveActionCost, getSkillBaseRange } from '@/utils/combat-action-cost';
import {
  type SkillCategory,
  SKILL_CATEGORY_LABELS,
  SKILL_CATEGORY_TAB_ORDER,
  getSkillCategory,
  isFinisherSkill,
} from '@/utils/skill-category';

// ── 类型定义 ──
type TargetIntent = CombatAimIntent;

type QueueItemStatus = 'draft' | 'locked' | 'submitted';

interface QueueItem {
  id: number;
  act_id: string;
  target: TargetIntent;
  status: QueueItemStatus;
}

/** 半成品虚拟项，不入 queue，独立 ref */
interface PendingItem {
  id: number;
  act_id: string;
  target: { type: 'pending' };
  /** 重新瞄准时暂存原 target（undefined 表示新建而非重新瞄准） */
  _prevTarget?: TargetIntent;
  /** 重新瞄准时暂存原位置 */
  _prevIndex?: number;
}

interface ApSlotState {
  index: number;
  state: 'available' | 'locked' | 'overload' | 'depleted';
  lockedByOrder?: number;
}

/** 轨道渲染项（合并 queue 项与 pending 虚拟项） */
interface TrackItem {
  id: number;
  act_id: string;
  target: TargetIntent;
  status: QueueItemStatus;
  apCost: number;
  isFinisher: boolean;
  category: SkillCategory;
  order: number;
  isPending: boolean;
  /** queue.value 中的索引，-1 表示 pending 虚拟项 */
  queueIndex: number;
}

// ── 状态 ──
const mode = ref<'pre-battle' | 'in-battle' | ''>('');
const skills = ref<Skill[]>([]);
// 前端过滤 hidden 技能（后端正常返回，前端不显示）
const visibleSkills = computed(() => skills.value.filter(s => !s.hidden));
const playerAp = ref<number>(0);
const playerMaxAp = ref<number>(0);

const queue = ref<QueueItem[]>([]);
let queueIdSeed = 0;

const aimMode = ref<boolean>(false);
const pendingActId = ref<string | null>(null);
const pendingTargetMode = ref<'enemy' | 'tile'>('enemy');
const pendingItem = ref<PendingItem | null>(null);

const enemyPid = ref<number>(0);
const playerPid = ref<number>(0);
const combatContext = ref<CombatViewModel | null>(null);
const sessionKey = ref<string>('');

// ── 新增状态 ──
const activeCategory = ref<'all' | SkillCategory>('all');
const confirmClear = ref<boolean>(false);
let confirmClearTimer: ReturnType<typeof setTimeout> | null = null;
const hoveredOrder = ref<number | null>(null);
const draggingIndex = ref<number | null>(null);
const dropTargetIndex = ref<number | null>(null);

const mapStore = useMapStore();
const characterStore = useCharacterStore();
const battleStore = useBattleStore();

// ══════════════════════════════════════════════════
// 初始化（监听 battle:preload-init 事件）
// ══════════════════════════════════════════════════

async function initPreloadArea(data: PreloadInitEventData): Promise<void> {
  const nextQid = data.combatContext?.qid ?? null;
  const nextSessionKey = data.mode === 'in-battle'
    ? `in-battle:${nextQid ?? 'none'}`
    : `pre-battle:${data.playerPid || 0}`;
  if (sessionKey.value === nextSessionKey) {
    onPreloadContextRefresh(data);
    await fetchSkillList();
    return;
  }
  sessionKey.value = nextSessionKey;
  mode.value = data.mode;
  combatContext.value = data.combatContext || null;
  enemyPid.value = data.mode === 'pre-battle'
    ? (data.enemyPid || battleStore.combatTargets.suggestedTargetPid || 0)
    : (battleStore.combatTargets.suggestedTargetPid || combatContext.value?.suggestedTargetPid || data.enemyPid || 0);
  playerPid.value = data.playerPid || 0;
  queue.value = [];
  aimMode.value = false;
  pendingActId.value = null;
  pendingTargetMode.value = 'enemy';
  pendingItem.value = null;
  activeCategory.value = 'all';
  confirmClear.value = false;
  if (confirmClearTimer) {
    clearTimeout(confirmClearTimer);
    confirmClearTimer = null;
  }

  await fetchSkillList();
}

async function fetchSkillList(): Promise<void> {
  try {
    const result = await dataManager.fetch('skill_list', true);
    if (result.status === 'success' && result.data) {
      const data = result.data as {
        skills?: Skill[];
        player_ap?: string | number;
        player_max_ap?: string | number;
      };
      skills.value = data.skills || [];
      playerAp.value = parseInt(String(data.player_ap)) || 0;
      playerMaxAp.value = parseInt(String(data.player_max_ap)) || 0;
    } else {
      skills.value = [];
      playerAp.value = 0;
      playerMaxAp.value = 0;
    }
  } catch (e) {
    console.error('[Preload] fetchSkillList error:', e);
    useToastStore().showToast('技能列表加载失败，请重进战斗', 'error', 4000, false, 'skill-fetch');
    skills.value = [];
    playerAp.value = 0;
    playerMaxAp.value = 0;
  }
}

// ══════════════════════════════════════════════════
// 技能派生集合（终结性字段驱动，单一数据源）
// ══════════════════════════════════════════════════

/** act_id → Skill 映射（从已加载技能表派生） */
const skillByActId = computed<Map<string, Skill>>(() => {
  const map = new Map<string, Skill>();
  for (const s of skills.value) map.set(s.act_id, s);
  return map;
});

/** 终结技 act_id 集合（从 Skill.finisher 字段派生，后端为唯一权威） */
const finisherActIds = computed<Set<string>>(() => {
  const set = new Set<string>();
  for (const s of skills.value) {
    if (s.finisher) set.add(s.act_id);
  }
  return set;
});

/** 按 act_id 判定终结性（用于 QueueItem/PendingItem 等只有 act_id 的场景） */
function isFinisherAct(actId: string): boolean {
  return finisherActIds.value.has(actId);
}

// ══════════════════════════════════════════════════
// AP 预算槽计算（v4 四态模型）
// ══════════════════════════════════════════════════

/** 队列项 + 派生字段（computed 实时计算，不污染 QueueItem 数据结构） */
const queueWithCost = computed(() =>
  queue.value.map((item, index) => {
    const plannedLoc = getPlannedActorPls(queue.value.slice(0, index));
    const skill = skillByActId.value.get(item.act_id);
    return {
      ...item,
      apCost: estimateActionCostFrom(item, plannedLoc),
      isFinisher: isFinisherAct(item.act_id),
      category: skill ? getSkillCategory(skill) : ('assault' as SkillCategory),
      order: index + 1,
    };
  })
);

/** 队列累计 AP 消耗（从 queueWithCost 派生） */
const queueCost = computed<number>(() =>
  queueWithCost.value.reduce((sum, item) => sum + item.apCost, 0)
);

/** 预测剩余 AP */
const predictedAp = computed<number>(() => Math.max(0, playerAp.value - queueCost.value));

/** 是否超载（队列消耗超过当前 AP） */
const isOverload = computed<boolean>(() => queueCost.value > playerAp.value);

/** AP 槽四态矩阵（v5：遍历队列项分配槽位，序号表达归属而非槽位序号） */
const apSlots = computed<ApSlotState[]>(() => {
  const slots: ApSlotState[] = [];
  const maxAp = playerMaxAp.value;
  const curAp = playerAp.value;
  const cost = queueCost.value;
  const totalSlots = Math.max(maxAp, cost);

  // 第一阶段：遍历队列项，为每个项分配连续的 apCost 个槽位
  // 同一动作占据的多个槽都标记为该项的 order
  let slotIndex = 0;
  for (const item of queueWithCost.value) {
    for (let j = 0; j < item.apCost; j++) {
      if (slotIndex >= curAp) {
        slots.push({ index: slotIndex, state: 'overload' });
      } else {
        slots.push({ index: slotIndex, state: 'locked', lockedByOrder: item.order });
      }
      slotIndex++;
    }
  }

  // 第二阶段：剩余槽位按 available / depleted 填充
  for (let i = slotIndex; i < totalSlots; i++) {
    if (i < curAp) {
      slots.push({ index: i, state: 'available' });
    } else if (i < maxAp) {
      slots.push({ index: i, state: 'depleted' });
    }
  }
  return slots;
});

/** 不可用槽数量（AP 减益时） */
const depletedCount = computed(() =>
  apSlots.value.filter(s => s.state === 'depleted').length
);

/** 超载槽数量 */
const overloadCount = computed(() =>
  apSlots.value.filter(s => s.state === 'overload').length
);

/** 队列中是否已有终结技（用于技能库耗尽视觉反馈） */
const hasFinisherInQueue = computed(() =>
  queue.value.some(q => isFinisherAct(q.act_id))
);

// ══════════════════════════════════════════════════
// 快速瞄准派生（§2.3 数据源 + 推算位置缓存）
// ══════════════════════════════════════════════════

/** 队列中最后一个 pid 类型目标（快速瞄准数据源） */
const lastPidTarget = computed<{ pid: number; name: string; pls: number | string | null } | null>(() => {
  for (let i = queue.value.length - 1; i >= 0; i--) {
    const item = queue.value[i];
    if (item.target.type === 'pid') {
      const pid = parseInt(String(item.target.id));
      const target = getCombatTarget(pid);
      const name = target?.name || `目标${pid}`;
      const pls = (target as { pls?: number | string | null } | null)?.pls ?? null;
      return { pid, name, pls };
    }
  }
  return null;
});

/** 快速瞄准推算的玩家位置（前缀 = 完整 queue，因为快速瞄准追加到末尾） */
const quickAimPlannedLoc = computed(() => getPlannedActorPls());

/** 快速瞄准显示标签：名字(位置)——位置消除同名敌人歧义；位置缺失时退化为纯名字 */
const quickAimLabel = computed(() => {
  if (!lastPidTarget.value) return '';
  const { name, pls } = lastPidTarget.value;
  return pls !== null && pls !== undefined && pls !== '' ? `${name}(${pls})` : name;
});

// ══════════════════════════════════════════════════
// 轨道渲染项（合并 queue 项与 pending 虚拟项）
// ══════════════════════════════════════════════════

const trackItems = computed<TrackItem[]>(() => {
  const queueItems = queueWithCost.value;
  const pending = pendingItem.value;

  if (!pending) {
    return queueItems.map((item, i) => ({
      ...item,
      order: i + 1,
      isPending: false,
      queueIndex: i,
    }));
  }

  // pending item 存在时，构建合并视图
  const pendingSkill = skillByActId.value.get(pending.act_id);
  const pendingBase: Omit<TrackItem, 'order' | 'queueIndex'> = {
    id: pending.id,
    act_id: pending.act_id,
    target: { type: 'none' } as TargetIntent, // 占位，渲染时检查 isPending
    status: 'draft',
    apCost: 0,
    isFinisher: isFinisherAct(pending.act_id),
    category: pendingSkill ? getSkillCategory(pendingSkill) : ('assault' as SkillCategory),
    isPending: true,
  };

  const items: TrackItem[] = [];

  if (pending._prevIndex !== undefined) {
    // 重新瞄准：pending 项插入到原位置
    let qi = 0;
    for (let i = 0; i <= queueItems.length; i++) {
      if (i === pending._prevIndex) {
        items.push({ ...pendingBase, order: 0, queueIndex: -1 });
        continue;
      }
      if (qi < queueItems.length) {
        items.push({ ...queueItems[qi], order: 0, isPending: false, queueIndex: qi });
        qi++;
      }
    }
  } else {
    // 新建瞄准：pending 项追加到末尾
    for (let i = 0; i < queueItems.length; i++) {
      items.push({ ...queueItems[i], order: 0, isPending: false, queueIndex: i });
    }
    items.push({ ...pendingBase, order: 0, queueIndex: -1 });
  }

  // 重新计算序号
  return items.map((item, i) => ({ ...item, order: i + 1 }));
});

// ══════════════════════════════════════════════════
// 技能库筛选（§3.2 标签页）
// ══════════════════════════════════════════════════

const filteredSkills = computed<Skill[]>(() => {
  if (activeCategory.value === 'all') return visibleSkills.value;
  return visibleSkills.value.filter(s => getSkillCategory(s) === activeCategory.value);
});

/** Breadcrumb 中显示的 pending 技能射程文本 */
const pendingSkillRangeText = computed<string>(() => {
  if (!pendingItem.value) return '';
  const skill = skills.value.find(s => s.act_id === pendingItem.value!.act_id);
  if (!skill) return '';
  return skillRangeText(skill);
});

// ══════════════════════════════════════════════════
// 辅助函数（保留现有）
// ══════════════════════════════════════════════════

function normalizePls(pls: string | number | null | undefined): number | null {
  if (pls === null || pls === undefined) return null;
  const n = Number(pls);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * 获取战斗中玩家自身信息
 *
 * 数据源：CharacterHub（characterStore.player）。
 * 未加载时回退到 combatContext.combatants 中的玩家元素，保留原逻辑兜底。
 */
function getCombatPlayer(): Character | CombatantViewModel | null {
  const player = characterStore.player;
  if (player) return player;
  const ctx = combatContext.value;
  if (!ctx) return null;
  return ctx.combatants.find((c) => Number(c.pid) === Number(ctx.playerPid)) || null;
}

/**
 * 获取目标信息（用于射程判断和目标显示）
 */
function getCombatTarget(pid: number): CombatTargetViewModel | Character | null {
  const ctx = combatContext.value;
  if (ctx) {
    const validTarget = ctx.validTargets.find((target) => Number(target.pid) === Number(pid));
    if (validTarget) return validTarget;
  }
  return characterStore.getCharacter(pid) || null;
}

function getActorBasePls(): number | null {
  return normalizePls(characterStore.player?.pls ?? getCombatPlayer()?.pls ?? mapStore.curLoc);
}

function getTileDistanceFrom(fromPls: number | null, targetPls: number): number | null {
  if (fromPls === null) return null;
  const path = findPath(fromPls, targetPls);
  if (!path) return null;
  return Math.max(0, path.length - 1);
}

/** 估算单项目标成本（基于此前位置） */
function estimateActionCostFrom(item: QueueItem, fromPls: number | null): number {
  const skill = skills.value.find((s) => s.act_id === item.act_id);
  if (!skill) return 0;

  if (skill.act_id === 'move' && item.target.type === 'tile') {
    const distance = getTileDistanceFrom(fromPls, item.target.id);
    return estimateMoveActionCost(skill, distance);
  }

  return Number(skill.apcost || 0);
}

/**
 * 按 prefix 队列推算玩家位置（move 类需要）
 * v4 补充：prefixQueue 为空数组时返回玩家当前位置 getActorBasePls()
 */
function getPlannedActorPls(prefixQueue: QueueItem[] = queue.value): number | null {
  let plannedLoc = getActorBasePls();
  for (const item of prefixQueue) {
    if (item.act_id === 'move' && item.target.type === 'tile') {
      plannedLoc = item.target.id;
    }
  }
  return plannedLoc;
}

function isEnemyInSkillRange(skill: Skill, targetPid: number, originPls: number | null = getActorBasePls()): boolean {
  if (originPls === null) return false;

  const combatTarget = getCombatTarget(targetPid);
  if (combatTarget) {
    const actorRegion = characterStore.player?.pgroup ?? getCombatPlayer()?.pgroup ?? mapStore.curRegion;
    if (String(combatTarget.pgroup) !== String(actorRegion)) return false;
    const path = findPath(originPls, combatTarget.pls);
    if (!path) return false;
    const distance = Math.max(0, path.length - 1);
    return distance <= getSkillBaseRange(skill);
  }

  return false;
}

/**
 * 判断技能是否可快速瞄准（显示快捷标签的条件，§2.4 提前过滤原则）
 *
 * 所有在 onQuickAimClick 中会导致 toast 失败的校验，都应在此提前过滤——
 * 快捷标签的职责是"快速添加"，不能添加就不应出现。
 */
function canQuickAim(skill: Skill): boolean {
  if (skill.aimType !== 'pid') return false;
  if (!skill.available) return false;  // 不可用技能（含 on_cd）不显示快捷标签
  if (!lastPidTarget.value) return false;
  // CD 重复：有 CD 的技能已在队列中时不显示快捷标签
  if (Number(skill.cd) > 0 && queue.value.some(item => item.act_id === skill.act_id)) return false;
  // 终结技耗尽态：不显示快捷标签（快速添加必然失败）
  if (isFinisherSkill(skill) && hasFinisherInQueue.value) return false;
  // 射程校验（用推算位置）
  return isEnemyInSkillRange(skill, lastPidTarget.value.pid, quickAimPlannedLoc.value);
}

function skillRangeText(skill: Skill): string {
  if (skill.aimType !== 'pid') return '';
  return ` R:${getSkillBaseRange(skill)}`;
}

function skillCdText(skill: Skill): string {
  if (skill.on_cd) {
    return ` CD:${Math.max(0, Number(skill.cd) - (Number(skill.current_tick) - Number(skill.lstact)))}t`;
  }
  if (Number(skill.cd) > 0) {
    return ` CD:${skill.cd}t`;
  }
  return '';
}

/** 根据 PID 查询目标显示文本 */
function getTargetDisplayText(target: TargetIntent): string {
  if (target.type === 'self') return '自己';
  if (target.type === 'none') return '无目标';
  if (target.type === 'tile') return `位置${target.id}`;

  const pid = parseInt(String(target.id));
  if (pid === parseInt(String(playerPid.value))) return '自己';

  const combatTarget = getCombatTarget(pid);
  if (combatTarget && Number(combatTarget.state) === 0) {
    return `位于位置${combatTarget.pls}的 ${combatTarget.name}`;
  }
  return `目标${pid}`;
}

function normalizeActions(actions: QueueItem[]): Array<{ act_id: string; target: TargetIntent; params: Record<string, unknown> }> {
  return actions.map((action) => ({
    act_id: action.act_id,
    target: action.target,
    params: {},
  }));
}

// ══════════════════════════════════════════════════
// 技能点击处理
// ══════════════════════════════════════════════════

function onSkillClick(actId: string): void {
  const skill = skills.value.find((s) => s.act_id === actId);
  if (!skill || !skill.available) return;

  // pendingItem 激活时禁用技能库交互（模态）
  if (pendingItem.value) return;

  // 瞄准模式下再次点击同一技能 → 退出瞄准（toggle）
  if (aimMode.value && pendingActId.value === actId) {
    onBreadcrumbCancel();
    return;
  }

  // 有 CD 定义的技能在队列中只能出现一次
  if (Number(skill.cd) > 0 && queue.value.some((item) => item.act_id === actId)) {
    useToastStore().showToast('该技能有冷却，无法重复装填', 'warning', 3000);
    return;
  }

  // 终结技唯一性：一场战斗只能有一个终结技（任意终结技，不限同一技能 ID）
  if (isFinisherAct(actId) && queue.value.some((item) => isFinisherAct(item.act_id))) {
    useToastStore().showToast('一场战斗只能有一个终结技', 'warning', 3000);
    return;
  }

  if (skill.aimType === 'none') {
    addToQueue(actId, { type: 'none' });
  } else if (skill.aimType === 'self') {
    addToQueue(actId, { type: 'self' });
  } else if (skill.aimType === 'tile') {
    // v4 新增：同时创建 pendingItem（无 _prevTarget，表示新建而非重新瞄准）
    pendingItem.value = {
      id: ++queueIdSeed,
      act_id: actId,
      target: { type: 'pending' },
    };
    enterAimMode(actId, 'tile');
  } else {
    // aimType === 'pid'（enemy）
    pendingItem.value = {
      id: ++queueIdSeed,
      act_id: actId,
      target: { type: 'pending' },
    };
    enterAimMode(actId, 'enemy');
  }
}

// ══════════════════════════════════════════════════
// 快速瞄准执行（§2.4 点击快捷标签，跳过瞄准模式直接入队）
// ══════════════════════════════════════════════════

/**
 * 快速瞄准点击处理
 *
 * 校验顺序：CD → 终结技 → 目标有效性 → 射程。先校验"技能自身约束"（与目标无关），
 * 再校验"目标约束"。CD 冲突或终结技冲突时，即使用户手动瞄准也无法添加，
 * 先报这些错误更符合用户心智模型。
 *
 * 与 onSkillClick 的 CD 和终结技校验完全一致，确保两条入队路径的约束对称。
 * canQuickAim 已提前过滤，正常流程中 CD/终结技/射程校验不应触发——
 * 保留作为 canQuickAim 到点击期间的竞态二次防御。
 */
function onQuickAimClick(actId: string): void {
  const skill = skills.value.find(s => s.act_id === actId);
  if (!skill || !skill.available) return;
  if (!lastPidTarget.value) return;

  const pid = lastPidTarget.value.pid;

  // CD 校验
  if (Number(skill.cd) > 0 && queue.value.some(item => item.act_id === actId)) {
    useToastStore().showToast('该技能有冷却，无法重复装填', 'warning', 3000);
    return;
  }

  // 终结技唯一性校验
  if (isFinisherAct(actId) && hasFinisherInQueue.value) {
    useToastStore().showToast('一场战斗只能有一个终结技', 'warning', 3000);
    return;
  }

  // 目标有效性校验（目标可能已死亡/状态变化）
  const candidate = findSelectableCombatTarget(
    battleStore.combatTargets,
    battleStore.currentQid,
    pid,
    targetPid => characterStore.getCharacter(targetPid),
  );
  if (!candidate) {
    useToastStore().showToast('目标状态已变化，请手动瞄准', 'warning', 3000);
    return;
  }

  // 射程校验（二次校验，防止 canQuickAim 到点击期间状态变化）
  if (!isEnemyInSkillRange(skill, pid, quickAimPlannedLoc.value)) {
    useToastStore().showToast('目标距离过远，请手动瞄准', 'warning', 3000);
    return;
  }

  // 直接入队，跳过瞄准模式
  addToQueue(actId, { type: 'pid', id: pid });
}

// ══════════════════════════════════════════════════
// 瞄准模式
// ══════════════════════════════════════════════════

function resetAimState(): void {
  aimMode.value = false;
  pendingActId.value = null;
  pendingTargetMode.value = 'enemy';
}

/** 内部退出瞄准（重置状态 + 广播 exit）。不处理 pendingItem */
function exitAimMode(): void {
  resetAimState();
  dataManager.broadcast('battle:aim-exit');
}

function enterAimMode(actId: string, targetMode: 'enemy' | 'tile' = 'enemy'): void {
  const skill = skills.value.find((s) => s.act_id === actId);
  aimMode.value = true;
  pendingActId.value = actId;
  pendingTargetMode.value = targetMode;
  dataManager.broadcast('battle:aim-mode', {
    actId,
    ...(targetMode === 'enemy' ? { actionRange: getSkillBaseRange(skill) } : {}),
    targetMode,
    originPls: getPlannedActorPls(),
    focusedTargetPid: mode.value === 'pre-battle'
      ? (enemyPid.value || battleStore.combatTargets.suggestedTargetPid || null)
      : (battleStore.combatTargets.suggestedTargetPid || enemyPid.value || null),
    prefixActions: normalizeActions(queue.value),
  });
}

/** 瞄准模式下选择目标（监听 battle:aim-target-selected 事件） */
function onTargetSelect(data: unknown): void {
  if (!aimMode.value || !pendingActId.value || !pendingItem.value) return;
  const pending = pendingItem.value;

  let target: TargetIntent;

  if (pendingTargetMode.value === 'tile') {
    const pls = typeof data === 'number'
      ? data
      : (data as { pls?: number; id?: number })?.pls ?? (data as { id?: number })?.id;
    if (typeof pls !== 'number' || pls <= 0) return;
    target = { type: 'tile', id: pls };
  } else {
    const pid = typeof data === 'number' ? data : (data as { pid?: number })?.pid;
    if (typeof pid !== 'number') return;

    const candidate = findSelectableCombatTarget(
      battleStore.combatTargets,
      battleStore.currentQid,
      pid,
      targetPid => characterStore.getCharacter(targetPid),
    );
    if (!candidate) {
      useToastStore().showToast('目标状态已变化，请重新选择', 'warning', 3000);
      return;
    }

    const skill = skills.value.find((s) => s.act_id === pendingActId.value);
    // 重新瞄准时使用原位置前的 prefix 推算位置；新建瞄准时使用完整 queue
    const prefixQueue = pending._prevIndex !== undefined
      ? queue.value.slice(0, pending._prevIndex)
      : queue.value;
    if (skill && !isEnemyInSkillRange(skill, pid, getPlannedActorPls(prefixQueue))) {
      useToastStore().showToast('目标距离过远，无法装填该技能', 'warning', 3000);
      return;
    }

    target = { type: 'pid', id: pid };
  }

  // 区分新建瞄准 vs 重新瞄准
  if (pending._prevIndex !== undefined) {
    // 重新瞄准：用 splice 回插原位，保留原 id
    queue.value.splice(pending._prevIndex, 0, {
      id: pending.id,
      act_id: pending.act_id,
      target,
      status: 'draft',
    });
  } else {
    // 新建瞄准：走正常 addToQueue 流程
    addToQueue(pending.act_id, target);
  }

  // 清除 pendingItem 后再 exitAimMode（避免 exitAimMode 触发 onAimExit 时重复处理）
  pendingItem.value = null;
  exitAimMode();
}

/** 瞄准模式退出（监听 battle:aim-exit 事件，如 ESC 退出） */
function onAimExit(): void {
  // 同步重置瞄准状态 + 处理 pendingItem（恢复原 target 或丢弃新建 pending）
  resetAimState();
  if (pendingItem.value) {
    const pending = pendingItem.value;
    if (pending._prevTarget !== undefined && pending._prevIndex !== undefined) {
      // 重新瞄准中退出：恢复原 target 到原位置
      queue.value.splice(pending._prevIndex, 0, {
        id: pending.id,
        act_id: pending.act_id,
        target: pending._prevTarget,
        status: 'draft',
      });
    }
    // 新建未完成的 pending（无 _prevTarget）：直接丢弃
    pendingItem.value = null;
  }
}

// ══════════════════════════════════════════════════
// 重新瞄准流程（§5.3）
// ══════════════════════════════════════════════════

/** 点击已入队项的 target chip → 进入重新瞄准 */
function onReAim(queueIndex: number): void {
  if (pendingItem.value) return; // 模态：pendingItem 激活时禁用
  if (queueIndex < 0 || queueIndex >= queue.value.length) return;

  const queueItem = queue.value[queueIndex];
  const skill = skills.value.find(s => s.act_id === queueItem.act_id);
  if (!skill) return;

  // 无目标/自身技能不支持重新瞄准
  if (skill.aimType === 'none' || skill.aimType === 'self') return;

  // 该项从 queue 中临时移除，存入 pendingItem
  queue.value.splice(queueIndex, 1);
  pendingItem.value = {
    id: queueItem.id,
    act_id: queueItem.act_id,
    target: { type: 'pending' },
    _prevTarget: queueItem.target,
    _prevIndex: queueIndex,
  };

  // enterAimMode 传移除该项后的 queue.value（语义正确：射程推算假设此前项已完成）
  const targetMode = skill.aimType === 'tile' ? 'tile' : 'enemy';
  enterAimMode(queueItem.act_id, targetMode);
}

/** Breadcrumb [取消] 按钮：取消当前瞄准 */
function onBreadcrumbCancel(): void {
  if (!pendingItem.value && !aimMode.value) return;

  if (pendingItem.value) {
    const pending = pendingItem.value;
    if (pending._prevTarget !== undefined && pending._prevIndex !== undefined) {
      // 重新瞄准取消：恢复原 target 到原位置（保留原 id，不调用 addToQueue）
      queue.value.splice(pending._prevIndex, 0, {
        id: pending.id,
        act_id: pending.act_id,
        target: pending._prevTarget,
        status: 'draft',
      });
    }
    // 新建瞄准取消：直接丢弃 pending
    pendingItem.value = null;
  }

  exitAimMode();
}

// ══════════════════════════════════════════════════
// 队列操作
// ══════════════════════════════════════════════════

function addToQueue(actId: string, target: TargetIntent): void {
  const isFinisher = isFinisherAct(actId);

  // 终结技唯一性：一场战斗只能有一个终结技
  if (isFinisher && queue.value.some(q => isFinisherAct(q.act_id))) {
    useToastStore().showToast('一场战斗只能有一个终结技', 'warning', 3000);
    return;
  }

  if (isFinisher) {
    queue.value.push({ id: ++queueIdSeed, act_id: actId, target, status: 'draft' });
  } else {
    // 普通技：如果队列有终结技，插入到它前面
    const finisherIdx = queue.value.findIndex((item) => isFinisherAct(item.act_id));
    if (finisherIdx >= 0) {
      queue.value.splice(finisherIdx, 0, { id: ++queueIdSeed, act_id: actId, target, status: 'draft' });
    } else {
      queue.value.push({ id: ++queueIdSeed, act_id: actId, target, status: 'draft' });
    }
  }
}

function removeFromQueue(queueIndex: number): void {
  if (pendingItem.value) return; // 模态：pendingItem 激活时禁用
  if (queueIndex < 0 || queueIndex >= queue.value.length) return;
  queue.value.splice(queueIndex, 1);
}

function clearQueue(): void {
  queue.value = [];
}

/** [清空] 按钮二次确认逻辑 */
function onClearClick(): void {
  if (pendingItem.value) return; // 模态：pendingItem 激活时禁用
  if (!confirmClear.value) {
    // 第一次点击：进入确认态，3 秒窗口
    confirmClear.value = true;
    confirmClearTimer = setTimeout(() => {
      confirmClear.value = false;
      confirmClearTimer = null;
    }, 3000);
  } else {
    // 第二次点击：执行清空
    if (confirmClearTimer) {
      clearTimeout(confirmClearTimer);
      confirmClearTimer = null;
    }
    confirmClear.value = false;
    clearQueue();
  }
}

// ══════════════════════════════════════════════════
// 拖拽重排（§5.2）
// ══════════════════════════════════════════════════

function onDragStart(e: DragEvent, trackIndex: number): void {
  if (pendingItem.value) { e.preventDefault(); return; }
  const item = trackItems.value[trackIndex];
  if (!item || item.isFinisher || item.isPending || item.queueIndex < 0) {
    e.preventDefault();
    return;
  }
  draggingIndex.value = trackIndex;
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(trackIndex));
  }
}

function onDragOver(e: DragEvent, trackIndex: number): void {
  if (draggingIndex.value === null) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';

  // 根据光标在项的上半/下半判定插入位置（间隙语义）
  const itemEl = e.currentTarget as HTMLElement;
  const rect = itemEl.getBoundingClientRect();
  const isTopHalf = e.clientY < rect.top + rect.height / 2;
  let insertion = isTopHalf ? trackIndex : trackIndex + 1;

  // 不允许放置到 finisher 之后
  const finisherTrackIdx = trackItems.value.findIndex(t => t.isFinisher);
  if (finisherTrackIdx >= 0 && insertion > finisherTrackIdx) {
    insertion = finisherTrackIdx;
  }

  // 原位 no-op：不显示指示线
  const fromTrack = draggingIndex.value;
  if (insertion === fromTrack || insertion === fromTrack + 1) {
    dropTargetIndex.value = null;
    return;
  }

  dropTargetIndex.value = insertion;
}

function onDrop(e: DragEvent): void {
  e.preventDefault();
  if (draggingIndex.value === null || dropTargetIndex.value === null) {
    draggingIndex.value = null;
    dropTargetIndex.value = null;
    return;
  }

  const fromIdx = draggingIndex.value;
  const insertion = dropTargetIndex.value;

  // 拖拽期间无 pendingItem，trackItems[i].queueIndex === i
  const item = trackItems.value[fromIdx];
  if (!item || item.queueIndex < 0) {
    draggingIndex.value = null;
    dropTargetIndex.value = null;
    return;
  }

  // 源在插入点之前时，删除后插入点前移
  let toQueue = insertion;
  if (fromIdx < toQueue) toQueue -= 1;

  // finisher 约束兜底
  const finisherQueueIdx = queue.value.findIndex(q => isFinisherAct(q.act_id));
  if (finisherQueueIdx >= 0 && toQueue > finisherQueueIdx) {
    toQueue = finisherQueueIdx;
  }

  if (item.queueIndex !== toQueue) {
    const [moved] = queue.value.splice(item.queueIndex, 1);
    queue.value.splice(toQueue, 0, moved);
  }

  draggingIndex.value = null;
  dropTargetIndex.value = null;
}

function onDragEnd(): void {
  draggingIndex.value = null;
  dropTargetIndex.value = null;
}

// ══════════════════════════════════════════════════
// hover 联动（§5.4 事件委托）
// ══════════════════════════════════════════════════

function onQueueTrackOver(e: MouseEvent): void {
  const target = e.target as HTMLElement | null;
  if (!target) return;
  const item = target.closest<HTMLElement>('[data-order]');
  hoveredOrder.value = item ? Number(item.dataset.order) : null;
}

function onQueueTrackLeave(): void {
  hoveredOrder.value = null;
}

// ══════════════════════════════════════════════════
// 执行装填队列
// ══════════════════════════════════════════════════

const executeCommand = computed(() => mode.value === 'pre-battle' ? 'battle.start' : 'battle.submit_turn');
const executeBlock = computed(() => commandQueue.getBlockDecision(executeCommand.value));

/** v2 修正：超载 AP 禁用通过 PreloadArea 内部派生（command-queue 的 5 层锁不含 AP 检查） */
const executeDisabled = computed<boolean>(() =>
  executeBlock.value !== null || isOverload.value || pendingItem.value !== null
);

async function onExecute(): Promise<void> {
  if (executeDisabled.value || queue.value.length === 0) return;

  const actions = queue.value.slice();

  let result;
  if (mode.value === 'pre-battle') {
    result = await commandQueue.execute({
      command: 'battle.start',
      payload: { actions: normalizeActions(actions) },
    });
  } else {
    result = await commandQueue.execute({
      command: 'battle.submit_turn',
      payload: { actions: normalizeActions(actions) },
    });
  }

  if (!result.success) {
    useToastStore().showToast(
      result.message || result.error || '战斗指令提交失败',
      'error',
      3000,
      !!result.messageIsHtml,
    );
    return;
  }

  // 锁定队列（设置 submitted 状态）
  queue.value.forEach(item => { item.status = 'submitted'; });
  mode.value = '';
  if (aimMode.value || pendingItem.value) {
    if (pendingItem.value) pendingItem.value = null;
    exitAimMode();
  }

  // 广播执行完成事件，battleStore 监听后刷新
  dataManager.broadcast('preload:executed', { result });
}

// ══════════════════════════════════════════════════
// isPlayerTurn watch（v2 补充：submitted 状态钩子）
// ══════════════════════════════════════════════════

watch(() => battleStore.isPlayerTurn, (isMyTurn, wasMyTurn) => {
  if (wasMyTurn && !isMyTurn) {
    // 玩家回合结束 → 锁定队列
    // v4 补充：若 pendingItem 仍激活，先执行取消流程
    if (pendingItem.value) {
      const pending = pendingItem.value;
      if (pending._prevTarget !== undefined && pending._prevIndex !== undefined) {
        // 重新瞄准中的 pending：恢复原 target 到原位置（标记为 submitted）
        queue.value.splice(pending._prevIndex, 0, {
          id: pending.id,
          act_id: pending.act_id,
          target: pending._prevTarget,
          status: 'submitted',
        });
      }
      // 新建未完成的 pending（无 _prevTarget）：直接丢弃
      pendingItem.value = null;
      exitAimMode();
    }
    queue.value.forEach(item => { item.status = 'submitted'; });
  } else if (!wasMyTurn && isMyTurn) {
    // 新回合开始 → 清空队列，重新可编辑
    queue.value = [];
    pendingItem.value = null;
    activeCategory.value = 'all';
    confirmClear.value = false;
    if (confirmClearTimer) {
      clearTimeout(confirmClearTimer);
      confirmClearTimer = null;
    }
  }
});

// ══════════════════════════════════════════════════
// 生命周期
// ══════════════════════════════════════════════════

function onPreloadInit(data: unknown): void {
  if (data) initPreloadArea(data as PreloadInitEventData);
}

function onPreloadContextRefresh(data: unknown): void {
  if (!data) return;
  const next = data as PreloadInitEventData;
  combatContext.value = next.combatContext || combatContext.value;
  enemyPid.value = battleStore.combatTargets.suggestedTargetPid || next.enemyPid || enemyPid.value;
  playerPid.value = next.playerPid || playerPid.value;
}

function onBattleEnded(): void {
  sessionKey.value = '';
  mode.value = '';
  queue.value = [];
  aimMode.value = false;
  pendingActId.value = null;
  pendingTargetMode.value = 'enemy';
  pendingItem.value = null;
  activeCategory.value = 'all';
  confirmClear.value = false;
  if (confirmClearTimer) {
    clearTimeout(confirmClearTimer);
    confirmClearTimer = null;
  }
  enemyPid.value = 0;
  playerPid.value = 0;
  combatContext.value = null;
}

onMounted(() => {
  dataManager.listen('battle:preload-init', onPreloadInit);
  dataManager.listen('battle:preload-context-refresh', onPreloadContextRefresh);
  dataManager.listen('battle:aim-target-selected', onTargetSelect);
  dataManager.listen('battle:aim-exit', onAimExit);
  dataManager.listen('battle:ended', onBattleEnded);
});

onUnmounted(() => {
  dataManager.unlisten('battle:preload-init', onPreloadInit);
  dataManager.unlisten('battle:preload-context-refresh', onPreloadContextRefresh);
  dataManager.unlisten('battle:aim-target-selected', onTargetSelect);
  dataManager.unlisten('battle:aim-exit', onAimExit);
  dataManager.unlisten('battle:ended', onBattleEnded);
  if (confirmClearTimer) {
    clearTimeout(confirmClearTimer);
    confirmClearTimer = null;
  }
});

// 暴露方法供外部调用（如 StatusBar 的退出瞄准按钮）
defineExpose({
  exitAimMode,
});
</script>

<template>
  <div class="preload-root flex flex-col h-full min-h-0">
    <!-- Breadcrumb 区（条件渲染，sticky top:0） -->
    <div v-if="pendingItem" class="breadcrumb-area">
      <span class="breadcrumb-text">
        ▶ 瞄准中：[{{ getSkillTemplate(pendingItem.act_id).name }}]<span v-if="pendingSkillRangeText" class="breadcrumb-range">{{ pendingSkillRangeText }}</span>
      </span>
      <button class="breadcrumb-cancel" @click="onBreadcrumbCancel">[取消]</button>
    </div>

    <!-- 装填轨道区（信息区） -->
    <div class="queue-track-area">
      <!-- 标题行 -->
      <div class="queue-track-header">
        <span class="track-label">装填轨道 ({{ queue.length }})</span>
        <span class="track-cost">AP {{ queueCost }}</span>
      </div>

      <!-- 空状态 -->
      <div
        v-if="queue.length === 0 && !pendingItem"
        class="queue-empty"
      >
        点击下方技能加入轨道
      </div>

      <!-- 轨道项列表（事件委托 hover 联动） -->
      <div
        v-if="queue.length > 0 || pendingItem"
        class="queue-track-list"
        @mouseover="onQueueTrackOver"
        @mouseout="onQueueTrackLeave"
        @dragover.prevent
        @drop="onDrop($event)"
      >
        <template
          v-for="(item, i) in trackItems"
          :key="item.id"
        >
          <!-- 拖拽间隙指示线（插入位置 i） -->
          <div
            v-if="draggingIndex !== null && dropTargetIndex === i"
            class="drop-indicator"
          />
          <div
            class="queue-track-item"
            :class="{
              'is-pending': item.isPending,
              'is-finisher': item.isFinisher,
              'is-dragging': draggingIndex === i,
            }"
            :data-order="item.order"
            :draggable="!item.isFinisher && !item.isPending && !pendingItem"
            @dragstart="onDragStart($event, i)"
            @dragover="onDragOver($event, i)"
            @drop="onDrop($event)"
            @dragend="onDragEnd"
          >
          <!-- 拖拽手柄（finisher 项无手柄） -->
          <span class="drag-handle" v-if="!item.isFinisher">▶</span>
          <span class="drag-handle is-disabled" v-else>·</span>

          <!-- 序号 -->
          <span class="order">{{ item.order }}</span>

          <!-- 技能名 -->
          <span class="skill-name">[{{ getSkillTemplate(item.act_id).name }}]</span>

          <!-- 目标 chip（可点击重新瞄准） -->
          <span
            v-if="item.isPending"
            class="target-chip is-pending"
          >→ [选择中...]</span>
          <span
            v-else
            class="target-chip"
            @click.stop="onReAim(item.queueIndex)"
          >→ {{ getTargetDisplayText(item.target) }}</span>

          <!-- AP 徽标 -->
          <span class="ap-cost">AP:{{ item.apCost }}</span>

          <!-- finisher 标记 -->
          <span v-if="item.isFinisher" class="finisher-tag">[F]</span>

          <!-- 删除按钮（pending 项无删除） -->
          <button
            v-if="!item.isPending"
            class="remove-btn"
            @click.stop="removeFromQueue(item.queueIndex)"
          >[x]</button>
        </div>
        </template>
        <!-- 拖拽间隙指示线（末尾位置） -->
        <div
          v-if="draggingIndex !== null && dropTargetIndex === trackItems.length"
          class="drop-indicator"
        />
      </div>

      <!-- 操作按钮 -->
      <div v-if="queue.length > 0" class="queue-actions">
        <button
          class="obl-btn execute-btn"
          :class="{ 'turn-active': !executeDisabled }"
          :disabled="executeDisabled"
          :title="isOverload ? 'AP 不足，请减少装填' : (executeBlock?.message || '')"
          @click="onExecute"
        >
          <span class="font-bold">[执行]</span>
        </button>
        <button
          class="obl-btn clear-btn"
          :class="{ 'is-confirming': confirmClear }"
          @click="onClearClick"
        >
          <span>{{ confirmClear ? '[确认清空?]' : '[清空]' }}</span>
        </button>
      </div>
    </div>

    <!-- AP 槽区（四态格子 + 聚合徽标） -->
    <div class="ap-slots-area">
      <div class="ap-slots">
        <div
          v-for="slot in apSlots"
          :key="slot.index"
          class="ap-slot"
          :class="{
            'is-locked': slot.state === 'locked',
            'is-overload': slot.state === 'overload',
            'is-available': slot.state === 'available',
            'is-depleted': slot.state === 'depleted',
            'is-highlighted': hoveredOrder !== null && slot.lockedByOrder === hoveredOrder,
          }"
          :data-order="slot.lockedByOrder"
        >
          <template v-if="slot.state === 'locked'">{{ slot.lockedByOrder }}</template>
          <template v-else-if="slot.state === 'overload'">╳</template>
        </div>
      </div>
      <div class="ap-aggregate">
        AP {{ playerAp }}/{{ playerMaxAp }} · 锁定 {{ queueCost }} · 可用 {{ predictedAp }}
        <span v-if="isOverload"> · 超载 ╳{{ overloadCount }}</span>
        <span v-if="depletedCount > 0 && !isOverload"> · 不可用 {{ depletedCount }}</span>
      </div>
    </div>

    <!-- 技能库区（操作区，flex-1 独立滚动） -->
    <div class="skill-library" :class="{ 'is-disabled': pendingItem }">
      <!-- 标签栏 -->
      <div class="skill-tabs">
        <button
          class="skill-tab"
          :class="{ 'is-active': activeCategory === 'all' }"
          @click="activeCategory = 'all'"
        >全部</button>
        <button
          v-for="cat in SKILL_CATEGORY_TAB_ORDER"
          :key="cat"
          class="skill-tab"
          :class="{ 'is-active': activeCategory === cat }"
          @click="activeCategory = cat"
        >{{ SKILL_CATEGORY_LABELS[cat] }}</button>
      </div>

      <!-- 扁平列表 -->
      <div class="skill-list">
        <div v-if="filteredSkills.length === 0" class="skill-empty">
          无可用技能
        </div>
        <button
          v-for="skill in filteredSkills"
          :key="skill.act_id"
          class="skill-row"
          :class="{ 'is-finisher-exhausted': isFinisherSkill(skill) && hasFinisherInQueue }"
          :disabled="!skill.available"
          @click="onSkillClick(skill.act_id)"
        >
          <span class="skill-name-text">[{{ getSkillTemplate(skill.act_id).name }}]</span>
          <span class="skill-desc">{{ getSkillTemplate(skill.act_id).desc }}</span>
          <span class="meta">
            {{ Number(skill.apcost) > 0 ? `AP:${skill.apcost}` : '' }}{{ skillRangeText(skill) }}{{ skillCdText(skill) }}
          </span>
          <span
            v-if="skill.aimType === 'pid' && canQuickAim(skill)"
            class="quick-aim-tag"
            role="button"
            tabindex="0"
            :title="`用上次目标「${quickAimLabel}」快速装填`"
            @click.stop="onQuickAimClick(skill.act_id)"
            @keydown.enter.prevent="onQuickAimClick(skill.act_id)"
          >→{{ quickAimLabel }}</span>
          <span v-if="isFinisherSkill(skill)" class="finisher-tag">[F]</span>
          <span v-else class="category-tag">{{ SKILL_CATEGORY_LABELS[getSkillCategory(skill)] }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ══════════════════════════════════════════════════ */
/* 根容器 */
/* ══════════════════════════════════════════════════ */
.preload-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

/* ══════════════════════════════════════════════════ */
/* Breadcrumb 区（§3.4，sticky top:0） */
/* ══════════════════════════════════════════════════ */
.breadcrumb-area {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px 6px 14px;
  background: rgba(10, 10, 10, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.35);
  box-shadow: 2px 2px 0 rgba(0, 0, 0, 0.3);
  margin-bottom: 4px;
}

.breadcrumb-area::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 2px;
  background: #fff;
  animation: pulse-pending 1.2s ease-in-out infinite;
}

.breadcrumb-text {
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
}

.breadcrumb-range {
  color: #888;
  font-weight: 400;
  margin-left: 4px;
}

.breadcrumb-cancel {
  background: transparent;
  border: 1px solid var(--color-fg-dim);
  color: #888;
  font-size: 10px;
  padding: 2px 8px;
  cursor: pointer;
  transition: color 0.12s, border-color 0.12s;
}

.breadcrumb-cancel:hover {
  color: #fff;
  border-color: #fff;
}

/* ══════════════════════════════════════════════════ */
/* 装填轨道区（§3.1 信息区） */
/* ══════════════════════════════════════════════════ */
.queue-track-area {
  flex-shrink: 0;
  padding: 0 4px;
}

.queue-track-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 2px 6px;
  margin-bottom: 4px;
}

.track-label {
  color: #888;
  font-size: 11px;
}

.track-cost {
  color: #bbb;
  font-size: 11px;
  font-weight: 700;
}

.queue-empty {
  color: #444;
  font-size: 11px;
  text-align: center;
  padding: 10px 4px;
  border: 1px dashed rgba(68, 68, 68, 0.5);
}

.queue-track-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.queue-actions {
  display: flex;
  gap: 4px;
  margin-top: 6px;
  margin-bottom: 4px;
}

.execute-btn {
  flex: 1;
  padding: 8px 12px;
  cursor: pointer;
  color: #bbb;
  transition: border-color 0.12s, background 0.12s;
}

.execute-btn:hover:not(:disabled) {
  border-color: #ddd;
  background: rgba(255, 255, 255, 0.04);
}

.execute-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.clear-btn {
  flex: none;
  padding: 8px 12px;
  cursor: pointer;
  color: #888;
  transition: border-color 0.12s, color 0.12s, box-shadow 0.12s;
}

.clear-btn:hover {
  border-color: #ddd;
  color: #fff;
}

.clear-btn.is-confirming {
  border-color: rgba(255, 255, 255, 0.6);
  color: #fff;
  box-shadow: 2px 2px 0 rgba(0, 0, 0, 0.3);
  animation: pulse-pending 1.2s ease-in-out infinite;
}

/* ══════════════════════════════════════════════════ */
/* 装填轨道项（§4.4） */
/* ══════════════════════════════════════════════════ */
.queue-track-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px 6px 14px;
  border: 1px solid var(--color-fg-dim);
  margin-bottom: 2px;
  background: var(--color-bg);
  position: relative;
  transition: border-color 0.12s, background 0.12s, box-shadow 0.12s;
}

.queue-track-item::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 2px;
  background: #888;
  transition: background 0.12s;
}

.queue-track-item:hover {
  border-color: #ddd;
  background: rgba(255, 255, 255, 0.04);
}

.queue-track-item:hover::before {
  background: #fff;
}

.queue-track-item.is-pending::before {
  background: #fff;
  animation: pulse-pending 1.2s ease-in-out infinite;
}

.queue-track-item.is-finisher {
  border-color: rgba(255, 255, 255, 0.35);
  box-shadow: 2px 2px 0 rgba(0, 0, 0, 0.3);
}

.queue-track-item.is-dragging {
  opacity: 0.5;
  border-style: dashed;
}

/* 拖拽间隙指示线（插入位置标记） */
.drop-indicator {
  height: 2px;
  background: var(--color-hi, #fff);
  margin: 1px 0;
  border-radius: 1px;
  box-shadow: 0 0 4px rgba(255, 255, 255, 0.4);
  animation: pulse-indicator 1s ease-in-out infinite;
}

@keyframes pulse-indicator {
  0%, 100% { opacity: 0.55; }
  50% { opacity: 1; }
}

.queue-track-item .drag-handle {
  cursor: grab;
  color: #555;
  user-select: none;
  font-size: 9px;
}

.queue-track-item .drag-handle.is-disabled {
  cursor: not-allowed;
  opacity: 0.2;
}

.queue-track-item.is-finisher .drag-handle {
  cursor: not-allowed;
  opacity: 0.2;
}

.queue-track-item .order {
  color: #fff;
  font-weight: 700;
  font-size: 12px;
  min-width: 16px;
}

.queue-track-item .skill-name {
  color: #bbb;
  font-size: 11px;
  font-weight: 700;
}

.queue-track-item .target-chip {
  cursor: pointer;
  color: #888;
  font-size: 10px;
  border-bottom: 1px dashed rgba(136, 136, 136, 0.4);
  transition: color 0.12s, border-color 0.12s;
  margin-left: auto;
}

.queue-track-item .target-chip:hover {
  color: #fff;
  border-bottom-color: #fff;
}

.queue-track-item .target-chip.is-pending {
  color: #fff;
  border-bottom: none;
  animation: pulse-pending 1.2s ease-in-out infinite;
}

.queue-track-item .ap-cost {
  color: #666;
  font-size: 10px;
}

.queue-track-item .remove-btn {
  background: transparent;
  border: none;
  color: #555;
  font-size: 11px;
  padding: 0 2px;
  cursor: pointer;
  transition: color 0.12s;
}

.queue-track-item .remove-btn:hover {
  color: #fff;
}

@keyframes pulse-pending {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

/* ══════════════════════════════════════════════════ */
/* AP 槽格子矩阵（§4.3，v4 四态） */
/* ══════════════════════════════════════════════════ */
.ap-slots-area {
  flex-shrink: 0;
  padding: 6px 6px;
  border-top: 1px solid rgba(68, 68, 68, 0.3);
  border-bottom: 1px solid rgba(68, 68, 68, 0.3);
}

.ap-slots {
  display: flex;
  gap: 3px;
  margin: 2px 0;
}

.ap-slot {
  width: 14px;
  height: 14px;
  border: 1px dashed rgba(136, 136, 136, 0.4);
  background: transparent;
  transition: border-color 0.12s, background 0.12s, box-shadow 0.12s;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 9px;
  font-weight: 700;
}

.ap-slot.is-locked {
  border-style: solid;
  border-color: rgba(255, 255, 255, 0.4);
  background-image: repeating-linear-gradient(
    45deg,
    rgba(255, 255, 255, 0.25) 0 2px,
    transparent 2px 5px
  );
}

.ap-slot.is-overload {
  border-color: rgba(255, 255, 255, 0.6);
  border-style: double;
  font-size: 12px;
  font-weight: 400;
  opacity: 0.7;
}

.ap-slot.is-depleted {
  border-style: dotted;
  border-color: rgba(136, 136, 136, 0.15);
  opacity: 0.35;
}

.ap-slot.is-highlighted {
  border-color: #fff;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.3);
}

.ap-aggregate {
  color: #888;
  font-size: 10px;
  margin-top: 4px;
  padding: 0 2px;
}

/* ══════════════════════════════════════════════════ */
/* 技能库区（§3.2 操作区，flex-1 独立滚动） */
/* ══════════════════════════════════════════════════ */
.skill-library {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 6px 4px 4px;
  transition: opacity 0.12s;
}

.skill-library.is-disabled {
  pointer-events: none;
  opacity: 0.4;
}

/* ── 标签栏（§4.2.1） ── */
.skill-tabs {
  display: flex;
  gap: 12px;
  padding: 4px 4px 6px;
  border-bottom: 1px solid var(--color-fg-dim);
  margin-bottom: 4px;
  position: sticky;
  top: 0;
  background: var(--color-bg);
  z-index: 5;
}

.skill-tab {
  background: transparent;
  border: none;
  color: #666;
  font-size: 11px;
  padding: 2px 0;
  cursor: pointer;
  border-bottom: 1px solid transparent;
  transition: color 0.12s, border-color 0.12s;
}

.skill-tab:hover {
  color: #ddd;
}

.skill-tab.is-active {
  color: #fff;
  border-bottom-color: #fff;
}

/* ── 技能列表项（§4.2.2） ── */
.skill-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.skill-empty {
  color: #444;
  font-size: 10px;
  text-align: center;
  padding: 12px 4px;
}

.skill-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px 6px 12px;
  border: 1px solid var(--color-fg-dim);
  margin-bottom: 2px;
  color: #bbb;
  cursor: pointer;
  transition: border-color 0.12s, background 0.12s;
  position: relative;
  overflow: hidden;
  background: transparent;
  text-align: left;
  font-family: inherit;
}

.skill-row::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 2px;
  background: #666;
  transition: background 0.12s;
}

.skill-row:hover:not(:disabled) {
  border-color: #ddd;
  background: rgba(255, 255, 255, 0.04);
}

.skill-row:hover:not(:disabled)::before {
  background: #fff;
}

.skill-row:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.skill-row:disabled:hover {
  border-color: var(--color-fg-dim);
  background: transparent;
}

.skill-row:disabled:hover::before {
  background: #666;
}

/* 终结技耗尽态：队列已有终结技时，其他终结技按钮黯淡 */
.skill-row.is-finisher-exhausted {
  opacity: 0.35;
  filter: grayscale(0.5);
}

.skill-row.is-finisher-exhausted:hover {
  opacity: 0.5;
  background: rgba(255, 255, 255, 0.02);
}

.skill-row.is-finisher-exhausted::before {
  background: #444;
}

.skill-row:active:not(:disabled) {
  transform: translateY(1px);
  box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.6);
}

.skill-row .skill-name-text {
  color: #fff;
  font-weight: 700;
  font-size: 11px;
}

.skill-row .skill-desc {
  color: #666;
  font-size: 10px;
}

.skill-row .meta {
  color: #666;
  font-size: 10px;
  margin-left: auto;
  white-space: nowrap;
}

.skill-row .category-tag {
  color: #555;
  font-size: 9px;
  margin-left: 6px;
  letter-spacing: 0.05em;
  white-space: nowrap;
}

.skill-row .finisher-tag {
  margin-left: 6px;
  padding: 1px 6px;
  border: 1px solid rgba(255, 255, 255, 0.35);
  background: var(--color-bg);
  box-shadow: 2px 2px 0 rgba(0, 0, 0, 0.3);
  color: #fff;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.1em;
  white-space: nowrap;
}

/* ══════════════════════════════════════════════════ */
/* 快速瞄准标签（§2.5，与轨道项 target chip 共享 → 视觉语言） */
/* ══════════════════════════════════════════════════ */
.skill-row .quick-aim-tag {
  margin-left: 6px;
  padding: 0 4px;
  border: 1px solid var(--color-fg-dim);
  color: var(--color-fg-mid);
  font-size: 10px;
  cursor: pointer;
  transition: color 0.12s, border-color 0.12s;
  white-space: nowrap;
}
.skill-row .quick-aim-tag:hover {
  color: var(--color-hi);
  border-color: var(--color-hi);
}
/* 耗尽态下技能行不显示快捷标签（canQuickAim 已返回 false，CSS 兜底） */
.skill-row.is-finisher-exhausted .quick-aim-tag {
  display: none;
}

/* ══════════════════════════════════════════════════ */
/* finisher 标记（轨道项内，与技能库项内共享样式） */
/* ══════════════════════════════════════════════════ */
.queue-track-item .finisher-tag {
  padding: 1px 6px;
  border: 1px solid rgba(255, 255, 255, 0.35);
  background: var(--color-bg);
  box-shadow: 2px 2px 0 rgba(0, 0, 0, 0.3);
  color: #fff;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.1em;
}

/* ══════════════════════════════════════════════════ */
/* reduced-motion 降级（§4.1） */
/* ══════════════════════════════════════════════════ */
@media (prefers-reduced-motion: reduce) {
  .breadcrumb-area::before,
  .queue-track-item.is-pending::before,
  .queue-track-item .target-chip.is-pending,
  .clear-btn.is-confirming,
  .drop-indicator {
    animation: none;
    opacity: 0.6;
  }

  .obl-btn.turn-active {
    animation: none;
  }

  .skill-row,
  .queue-track-item,
  .ap-slot,
  .skill-tab,
  .breadcrumb-cancel,
  .clear-btn,
  .execute-btn {
    transition: none;
  }
}
</style>
