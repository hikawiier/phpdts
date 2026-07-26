/**
 * @module K 状态管理层
 */

// ══════════════════════════════════════════════════
// 探索场景状态 store / Explore Scene Store
//
// 承载探索场景的内部状态（F-K2-Explore §5）：
//   - 移动模式（高亮可达范围，占位）
//   - 主动探索占位演出（扫描波纹，演出与结算解耦 §5.5/§7.4）
//   - 当前移动倾向（四种，§5.6）
//   - 当前临时目标 / 暂停目标（§5.9）
//   - 手机横屏右侧标签（战报 / 当前格）
//   - 已探索图格集合（三态认知视觉 B5.20-B5.25 的"已探索"维度）
//   - 单一输入门控 inputLocked（演出期间锁定状态变更操作，§5.4）
//
// 与现有 store 的关系（避免双源真值）：
//   - 玩家位置：派生自 mapStore.curLoc / curRegion（K-6 不可变投影，不复制）
//   - 抽屉开关：复用 uiStore.playerDrawerOpen / inventoryDrawerOpen（L-8 push 模式）
//   - 日志：复用 logStore（K-8 增量获取），不本地复制
//   - 探索命令：3.4 接后端 API；本子任务为占位方法
//
// 本子任务（3.2）只建立 store 骨架：
//   - 探索/移动的本地随机驱动替换为占位方法（后续 3.4 接后端）
//   - 扫描演出为纯视觉占位（setTimeout 模拟，不接业务结算）
// ══════════════════════════════════════════════════

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { useMapStore } from '@/stores/map';
import { useUiStore } from '@/stores/ui';
import { useToastStore } from '@/stores/toast';
import { commandQueue } from '@/stores/command-queue';
import { useMoveDirectorStore } from '@/stores/move-director';
import { useTileActionStore } from '@/stores/tileAction';
import { debugBus } from '@/composables/useDebugBus';

/** 移动倾向（§5.6） */
export type MoveTendency = 'steady' | 'nearby' | 'deep' | 'efficient';

export interface TendencyOption {
  id: MoveTendency;
  label: string;
  hint: string;
}

export const TENDENCY_OPTIONS: TendencyOption[] = [
  { id: 'steady', label: '稳健探索', hint: '默认每次一格，软性偏好低潮汐' },
  { id: 'nearby', label: '就近探索', hint: '同行动次数内优先更近的未探索格' },
  { id: 'deep', label: '深入险境', hint: '主动选择高潮汐未探索目标' },
  { id: 'efficient', label: '效率优先', hint: '尽量满移动力，减少行动次数' },
];

/** 临时目标三态（§5.9） */
export type TargetState =
  | { kind: 'none' }
  | { kind: 'active'; pls: string | number; name: string }
  | { kind: 'paused'; pls: string | number; name: string };

// ─── DebugBus state 注册标志（避免重复注册） ───
let _debugStateRegistered = false;

export const useExploreStore = defineStore('explore', () => {
  const mapStore = useMapStore();
  const uiStore = useUiStore();
  const toastStore = useToastStore();

  // ── 移动模式：开启后高亮可达范围（占位，3.4 接移动导演） ──
  const moveMode = ref<boolean>(false);

  // ── 主动探索占位演出：扫描波纹（与结算解耦，纯视觉） ──
  const exploring = ref<boolean>(false);
  let exploreTimer: ReturnType<typeof setTimeout> | null = null;

  // ── 移动导演播放锁（F-K4-Director §5.4：复用单一门控，不建第二套锁） ──
  // 3.4 实现移动导演时由其切换；inputLocked 统一包含此锁
  const navigationPlaying = ref<boolean>(false);

  // ── 当前移动倾向（§5.6） ──
  const tendency = ref<MoveTendency>('steady');

  // ── 当前临时目标 / 暂停目标（§5.9） ──
  const target = ref<TargetState>({ kind: 'none' });

  // ── 手机横屏右侧标签：战报 / 当前格 ──
  const mobileTab = ref<'log' | 'tile'>('log');

  // ── 已探索图格集合（三态认知 B5.22：玩家到达过的格） ──
  // key 格式 `${pgroup}:${pls}`；玩家位置始终视为已探索（B5.23/B5.22 落点立即转已探索）
  // 3.4 接后端后由移动导演 / 探索结算写入；本子任务仅随 mapStore 当前格同步
  const exploredTiles = ref<Set<string>>(new Set());

  // ── 玩家位置（派生自 K-6 不可变投影，不复制真值） ──
  const playerPls = computed<number | null>(() => mapStore.curLoc);
  const playerRegion = computed<number | null>(() => mapStore.curRegion);

  /** 当前格是否已探索（玩家所在格始终视为已探索） */
  function isExplored(pls: string | number): boolean {
    if (String(pls) === String(mapStore.curLoc)) return true;
    return exploredTiles.value.has(`${mapStore.curRegion}:${pls}`);
  }

  /** 标记一格为已探索（3.4 移动导演落点 / 探索结算调用） */
  function markExplored(pls: string | number): void {
    const key = `${mapStore.curRegion}:${pls}`;
    if (!exploredTiles.value.has(key)) {
      const next = new Set(exploredTiles.value);
      next.add(key);
      exploredTiles.value = next;
    }
  }

  /**
   * 从后端 links.explored[pgroup] 重建已探索 Set（设计案 §4.4 + §9.4，Q5-2 修复）。
   *
   * mapStore.loadMap 在提交投影后调用本方法，从权威源一次性同步当前区域的已探索图格。
   * 跨区域切换时，旧区域的键保留在 Set 中（不影响 isExplored 仅查询当前区域），
   * 新区域的键由本次同步写入；玩家所在格始终视为已探索（isExplored 即时判定，无需写入）。
   *
   * 不变量：会话内增量（markExplored）与刷新后全量（syncExploredFromLinks）共享同一 Set，
   * 不存在两套真值。增量写入在新一次 loadMap 时被权威全量覆盖。
   */
  function syncExploredFromLinks(
    links: { explored?: Record<string, Record<string, number>> } | null | undefined,
    pgroup: number | null,
  ): void {
    if (!links || !links.explored || pgroup === null) return;
    const regionMap = links.explored[String(pgroup)];
    if (!regionMap) return;
    const next = new Set(exploredTiles.value);
    const prefix = `${pgroup}:`;
    // 清除该区域的旧键（避免持久化的过期探索状态残留）
    for (const key of next) {
      if (key.startsWith(prefix)) next.delete(key);
    }
    for (const pls of Object.keys(regionMap)) {
      next.add(`${pgroup}:${pls}`);
    }
    exploredTiles.value = next;
  }

  // ── 抽屉桥接（复用 uiStore，避免双源真值） ──
  const playerDrawerOpen = computed(() => uiStore.playerDrawerOpen);
  const inventoryDrawerOpen = computed(() => uiStore.inventoryDrawerOpen);

  function togglePlayerDrawer(): void {
    uiStore.togglePlayerDrawer();
  }
  function toggleInventoryDrawer(): void {
    uiStore.toggleInventoryDrawer();
  }

  // ── 单一输入门控（§5.4）：演出期间锁定状态变更操作 ──
  // 主动探索演出 + 移动导演播放共享同一锁源；加速/跳过始终可用（B6.10）
  const inputLocked = computed(() => exploring.value || navigationPlaying.value);

  // ── 移动模式开关（占位，3.4 接移动导演） ──
  function enterMoveMode(): void {
    if (exploring.value || navigationPlaying.value) return;
    moveMode.value = true;
  }
  function exitMoveMode(): void {
    moveMode.value = false;
  }
  function toggleMoveMode(): void {
    if (moveMode.value) exitMoveMode();
    else enterMoveMode();
  }

  // ── 主动探索（§5.5/§7.4 + 设计案 §13.2） ──
  // 探索是单次命令（§13.2.2 提交一次探索行动），不像导航是长时间演出，
  // 不需要 navigationLock 门控；委托给 tileAction.handleExplore 读取
  // explore_outcome 差异化反馈（与 startNavigation 委托 move-director 同模式）。
  // degraded_wait/no_discovery/normal 的 Toast 差异由 handleExplore 处理。
  async function explore(): Promise<void> {
    if (inputLocked.value) return;
    const tileActionStore = useTileActionStore();
    await tileActionStore.handleExplore();
  }

  /** 跳过主动探索演出（B6.10：加速/跳过始终可用，不被 inputLocked 门控） */
  function skipExplore(): void {
    if (!exploring.value) return;
    if (exploreTimer) {
      clearTimeout(exploreTimer);
      exploreTimer = null;
    }
    exploring.value = false;
    toastStore.showToast('已跳过扫描演出', 'info', 1200, false, 'explore-skip');
  }

  // ── 移动导演接入（F-K4-Director §5.2，3.4 实现） ──
  // UI 入口（MainActionBar 等）调用 explore.startNavigation()，
  // 由本方法委托 move-director 执行真实导航（发送 map.navigate → 逐格演出）。
  // 双向导入安全：move-director.ts 在 setup 函数内调用 useExploreStore()，
  // 此处 useMoveDirectorStore() 也在函数体内调用，setup 函数惰性执行无 TDZ。
  function startNavigation(): void {
    if (inputLocked.value) return;
    useMoveDirectorStore().startNavigation();
  }

  /**
   * 移动导演播放锁开关（§5.4 统一门控，3.4 由移动导演调用）。
   *
   * 联动 K-3 命令门控（F-K4-Director §三.7/§三.8：复用 K-3，不建第二套锁）：
   *   - 开启时 explore.inputLocked=true 阻塞 UI 输入
   *   - 同步 commandQueue.setNavigationPlaying(true) 阻塞探索命令通过队列派发
   *   - 关闭时两者同步释放（B6.13 演出追上权威状态后恢复输入）
   */
  function setNavigationLock(v: boolean): void {
    navigationPlaying.value = v;
    commandQueue.setNavigationPlaying(v);
  }

  // ── 倾向切换（§5.6） ──
  function setTendency(t: MoveTendency): void {
    tendency.value = t;
  }

  // ── 目标操作（§5.8/§5.9） ──
  function setTarget(pls: string | number, name: string): void {
    target.value = { kind: 'active', pls, name };
  }
  function clearTarget(): void {
    if (target.value.kind === 'none') return;
    target.value = { kind: 'none' };
  }
  function pauseTarget(): void {
    if (target.value.kind !== 'active') return;
    target.value = { kind: 'paused', pls: target.value.pls, name: target.value.name };
  }
  function resumeTarget(): void {
    if (target.value.kind !== 'paused') return;
    target.value = { kind: 'active', pls: target.value.pls, name: target.value.name };
  }

  // ── 手机横屏标签切换 ──
  function setMobileTab(tab: 'log' | 'tile'): void {
    mobileTab.value = tab;
  }

  // ─── DebugBus 状态注册（供 ?debug=ai 使用） ───
  if (!_debugStateRegistered) {
    _debugStateRegistered = true;
    debugBus.registerState('explore', () => ({
      tendency: tendency.value,
      inputLocked: inputLocked.value,
      navigationPlaying: navigationPlaying.value,
      exploredCount: exploredTiles.value.size,
      playerPls: playerPls.value,
    }));
  }

  return {
    // 状态
    moveMode,
    exploring,
    navigationPlaying,
    tendency,
    target,
    mobileTab,
    exploredTiles,
    // 派生
    playerPls,
    playerRegion,
    playerDrawerOpen,
    inventoryDrawerOpen,
    inputLocked,
    // 查询
    isExplored,
    // 抽屉桥接
    togglePlayerDrawer,
    toggleInventoryDrawer,
    // 移动模式
    enterMoveMode,
    exitMoveMode,
    toggleMoveMode,
    startNavigation,
    setNavigationLock,
    // 探索
    explore,
    skipExplore,
    // 倾向
    setTendency,
    // 目标
    setTarget,
    clearTarget,
    pauseTarget,
    resumeTarget,
    // 标签
    setMobileTab,
    // 已探索
    markExplored,
    syncExploredFromLinks,
  };
});
