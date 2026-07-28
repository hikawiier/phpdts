/**
 * @module A API 层
 * @framework A-5 调试工具框架
 */

import { computed, ref, watch } from 'vue';
import { defineStore } from 'pinia';
import { API_BASE, fetchWithTimeout } from '@/api/client';
import { sendOblCommand } from '@/api/obl-command';
import { debugBus } from '@/composables/useDebugBus';
import { dataManager } from '@/stores/data-manager';
import { useBattleStore } from '@/stores/battle';
import { useExploreStore } from '@/stores/explore-store';
import { useMapStore } from '@/stores/map';
import { useMoveDirectorStore } from '@/stores/move-director';
import { usePlayerStore } from '@/stores/player';
import { useSceneStore } from '@/stores/scene-store';
import { useToastStore } from '@/stores/toast';
import { isDebugAllEnabled } from '@/utils/debug-flags';
import { getEnemyName } from '@/data/enemy-locale';

interface DebugSnapshotMeta {
  exists: boolean;
  created_at?: number;
  player_pid?: number;
  room?: string;
  row_counts?: Record<string, number>;
}

interface DebugConsoleBackendState {
  snapshot: DebugSnapshotMeta;
  player?: Record<string, unknown>;
  enemies?: Array<Record<string, unknown>>;
  enemy_types?: Array<{ type: number; name: string }>;
  scenarios?: string[];
  mechanisms?: string[];
}

interface DebugOverlaySummary {
  key: string;
  type: string;
  title: string;
  text: string;
}

interface DebugActionSummary {
  id: string;
  label: string;
  disabled: boolean;
  reason: string;
}

export interface DebugUiSummary {
  revision: number;
  scene: string;
  player: Record<string, unknown> | null;
  navigation: Record<string, unknown>;
  battle: Record<string, unknown>;
  overlays: DebugOverlaySummary[];
  toasts: Array<Record<string, unknown>>;
  actors: Array<Record<string, unknown>>;
  actions: DebugActionSummary[];
  recentEvents: Array<{ seq: number; t: number; cat: string; step: string; data: unknown }>;
  lastEventSeq: number;
  snapshot: DebugSnapshotMeta;
}

function isVisible(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  return style.display !== 'none'
    && style.visibility !== 'hidden'
    && style.opacity !== '0'
    && element.getClientRects().length > 0;
}

function compactText(value: string, max = 180): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length > max ? `${compact.slice(0, max)}...` : compact;
}

function compactEventData(value: unknown): unknown {
  try {
    const json = JSON.stringify(value, (_key, item) => {
      if (typeof item === 'bigint') return String(item);
      if (item instanceof Error) return { name: item.name, message: item.message };
      if (item instanceof Element) return `[${item.tagName.toLowerCase()}]`;
      return item;
    });
    if (json === undefined) return null;
    if (json.length > 600) return `${json.slice(0, 600)}...`;
    return JSON.parse(json) as unknown;
  } catch {
    return '[unserializable]';
  }
}

export const useDebugConsoleStore = defineStore('debug-console', () => {
  const playerStore = usePlayerStore();
  const mapStore = useMapStore();
  const battleStore = useBattleStore();
  const sceneStore = useSceneStore();
  const exploreStore = useExploreStore();
  const moveDirector = useMoveDirectorStore();
  const toastStore = useToastStore();

  const enabled = isDebugAllEnabled();
  const open = ref(false);
  const busy = ref(false);
  const lastResult = ref('');
  const backendState = ref<DebugConsoleBackendState>({ snapshot: { exists: false } });
  const revision = ref(0);
  const summary = ref<DebugUiSummary>({
    revision: 0,
    scene: 'explore',
    player: null,
    navigation: {},
    battle: {},
    overlays: [],
    toasts: [],
    actors: [],
    actions: [],
    recentEvents: [],
    lastEventSeq: 0,
    snapshot: { exists: false },
  });
  const summaryJson = computed(() => JSON.stringify(summary.value, null, 2));

  const actionIds = new WeakMap<HTMLElement, string>();
  let actionSeq = 0;
  let observer: MutationObserver | null = null;
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  let initialized = false;
  let previousOverlays = new Map<string, DebugOverlaySummary>();
  let unwatch: (() => void) | null = null;

  function collectOverlays(): DebugOverlaySummary[] {
    const selectors = [
      '.modal-overlay.open',
      '.discovery-modal-overlay',
      '.battle-modal-overlay',
      '.atlas-overlay',
      '[role="dialog"]',
    ].join(',');
    const overlays: DebugOverlaySummary[] = [];
    document.querySelectorAll<HTMLElement>(selectors).forEach((element, index) => {
      if (!isVisible(element)) return;
      const title = compactText(
        element.querySelector<HTMLElement>('.modal-title, .battle-modal-title, [data-modal-title]')?.innerText
          ?? element.getAttribute('aria-label')
          ?? '',
        80,
      );
      const type = element.classList.contains('atlas-overlay')
        ? 'atlas'
        : element.classList.contains('discovery-modal-overlay')
          ? 'discovery'
          : element.classList.contains('battle-modal-overlay')
            ? 'battle'
            : 'modal';
      overlays.push({
        key: `${type}:${title || index}`,
        type,
        title,
        text: compactText(element.innerText),
      });
    });
    return overlays;
  }

  function assignActionId(element: HTMLElement): string {
    const explicit = element.dataset.debugId;
    const existing = element.dataset.debugActionId;
    let id = explicit || existing || actionIds.get(element);
    if (!id) {
      id = `action-${++actionSeq}`;
      actionIds.set(element, id);
    }
    if (existing !== id) element.dataset.debugActionId = id;
    return id;
  }

  function collectActions(): DebugActionSummary[] {
    const actions: DebugActionSummary[] = [];
    document.querySelectorAll<HTMLElement>('button, [role="button"], input[type="button"], input[type="submit"]').forEach(element => {
      if (!isVisible(element)) return;
      const button = element as HTMLButtonElement;
      const disabled = !!button.disabled || element.getAttribute('aria-disabled') === 'true';
      actions.push({
        id: assignActionId(element),
        label: compactText(element.innerText || (element as HTMLInputElement).value || element.getAttribute('aria-label') || '', 100),
        disabled,
        reason: disabled
          ? compactText(element.getAttribute('data-disabled-reason') || element.getAttribute('title') || '', 120)
          : '',
      });
    });
    return actions;
  }

  function emitOverlayChanges(overlays: DebugOverlaySummary[]): void {
    const current = new Map(overlays.map(item => [item.key, item]));
    current.forEach((overlay, key) => {
      if (!previousOverlays.has(key)) debugBus.emit('ui', 'ui.overlay.open', overlay);
    });
    previousOverlays.forEach((overlay, key) => {
      if (!current.has(key)) debugBus.emit('ui', 'ui.overlay.close', overlay);
    });
    previousOverlays = current;
  }

  function refreshSummary(): DebugUiSummary {
    if (!enabled || typeof document === 'undefined') return summary.value;
    const overlays = collectOverlays();
    const actions = collectActions();
    emitOverlayChanges(overlays);
    revision.value += 1;
    const info = playerStore.playerInfo;
    const eventSummary = debugBus.summary();
    summary.value = {
      revision: revision.value,
      scene: sceneStore.current,
      player: info ? {
        pid: Number(info.pid),
        name: info.name,
        pgroup: Number(info.pgroup),
        pls: Number(info.pls),
        hp: Number(info.hp),
        mhp: Number(info.mhp),
        sp: Number(info.sp),
        msp: Number(info.msp),
        ap: Number(info.ap),
        max_ap: Number(info.max_ap),
        action: info.action,
        bid: Number(info.bid),
        battleState: info.obl_battle_state,
      } : null,
      navigation: {
        phase: moveDirector.phase,
        playing: moveDirector.isPlaying,
        paused: moveDirector.isPaused,
        target: moveDirector.targetName,
        outcome: moveDirector.outcome,
        stepIndex: moveDirector.currentStepIndex,
        totalSteps: moveDirector.totalSteps,
      },
      battle: {
        mode: battleStore.currentMode,
        qid: battleStore.currentQid,
        playing: battleStore.isPlayingBattleLog,
        processing: battleStore.isProcessingBattle,
        playerTurn: battleStore.isPlayerTurn,
      },
      overlays,
      toasts: toastStore.toasts.map(toast => ({
        id: toast.id,
        type: toast.type,
        message: compactText(toast.message, 160),
        mergeId: toast.mergeId ?? null,
        count: toast.count,
      })),
      actors: [
        ...(info ? [{
          pid: Number(info.pid),
          type: Number(info.type),
          name: info.name,
          pgroup: Number(info.pgroup),
          pls: Number(info.pls),
          hp: Number(info.hp),
          mhp: Number(info.mhp),
        }] : []),
        ...mapStore.enemies.map(enemy => ({
          pid: Number(enemy.pid),
          type: Number(enemy.type),
          name: getEnemyName(enemy.type, enemy.name),
          pgroup: Number(enemy.pgroup),
          pls: Number(enemy.pls),
          hp: Number(enemy.hp),
          mhp: Number(enemy.mhp),
          discovered: Number(enemy.discovered),
        })),
      ],
      actions,
      recentEvents: debugBus.tail(30).map(event => ({
        seq: event.seq,
        t: Math.round(event.t * 10) / 10,
        cat: event.cat,
        step: event.step,
        data: compactEventData(event.data),
      })),
      lastEventSeq: eventSummary.lastSeq,
      snapshot: backendState.value.snapshot,
    };
    return summary.value;
  }

  function scheduleSummaryRefresh(): void {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      refreshSummary();
    }, 40);
  }

  async function loadBackendState(): Promise<void> {
    if (!enabled) return;
    const query = new URLSearchParams({
      scope: 'debug_console',
      debug: 'all',
      _: String(Date.now()),
    });
    const res = await fetchWithTimeout(`${API_BASE}/oblivions/api/state.php?${query.toString()}`, {
      credentials: 'include',
      cache: 'no-store',
    });
    const body = await res.json() as { status?: string; data?: DebugConsoleBackendState; code?: string };
    if (!res.ok || body.status !== 'success' || !body.data) {
      throw new Error(body.code || `HTTP ${res.status}`);
    }
    backendState.value = body.data;
    scheduleSummaryRefresh();
  }

  async function refreshRuntime(): Promise<void> {
    battleStore.reset();
    moveDirector.resetSession();
    if (sceneStore.isAtlas) sceneStore.closeAtlas();
    sceneStore.exitBattle();
    dataManager.invalidateAll();
    await Promise.all([
      playerStore.loadPlayerInfo(true),
      mapStore.loadMap(),
    ]);
    debugBus.emit('debug', 'debug.runtime.refreshed', {
      scene: sceneStore.current,
      pgroup: mapStore.curRegion,
      pls: mapStore.curLoc,
    });
    scheduleSummaryRefresh();
  }

  async function runCommand(
    command: string,
    payload: Record<string, unknown> = {},
    refresh = true,
  ): Promise<Record<string, unknown>> {
    if (!enabled || !command.startsWith('debug.')) throw new Error('DEBUG_MODE_REQUIRED');
    busy.value = true;
    lastResult.value = '';
    debugBus.emit('api', 'debug.command.request', { command, payload });
    try {
      const result = await sendOblCommand({ command, payload });
      if (!result.success) throw new Error(result.error || result.message || 'DEBUG_COMMAND_FAILED');
      const data = result.gamedata ?? {};
      debugBus.emit('api', 'debug.command.success', { command, data });
      if (refresh) await refreshRuntime();
      await loadBackendState();
      lastResult.value = `${command} OK`;
      return data;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastResult.value = `${command}: ${message}`;
      debugBus.emit('error', 'debug.command.error', { command, message });
      throw error;
    } finally {
      busy.value = false;
      scheduleSummaryRefresh();
    }
  }

  const session = {
    start: () => runCommand('debug.snapshot.save', {}, false),
    restore: () => runCommand('debug.snapshot.restore'),
    clear: () => runCommand('debug.snapshot.clear', {}, false),
  };

  const scenario = {
    prepare: (id = 'adjacent_enemy', enemyType = 1) => runCommand('debug.scenario.prepare', {
      scenario: id,
      enemy_type: enemyType,
    }),
  };

  const gm = {
    run: (command: string, payload: Record<string, unknown> = {}) => runCommand(command, payload),
    reset: (mechanism: 'battle' | 'vitals' | 'all_transient') => runCommand('debug.mechanism.reset', { mechanism }),
  };

  /**
   * 拉取后端诊断日志（A-5 调试工具框架，A-5-2 加固增强查询能力）
   *
   * 后端通过 OblivionsDiagnosticLogger 收集诊断信息并按 (groomid, pid) 持久化，
   * 此方法通过 debug_diag_log scope 拉取，支持多维度筛选与增量游标。
   *
   * 重载签名：
   *   - fetchDiagLog(category?, lines?)                       旧签名（向后兼容）
   *   - fetchDiagLog({ category?, id?, requestUid?, sinceSeq?, sinceTsMs?, lines? })  新签名
   *
   * @param categoryOrOptions 粗粒度分类字符串，或选项对象
   * @param lines             返回尾部条数（默认 200，上限 1000），仅旧签名生效
   */
  async function fetchDiagLog(
    categoryOrOptions: string | {
      category?: string;
      id?: string;
      requestUid?: string;
      sinceSeq?: number;
      sinceTsMs?: number;
      lines?: number;
    } = '',
    lines = 200,
  ): Promise<{
    available: boolean;
    matchedTotal: number;
    returned: number;
    hasMore: boolean;
    nextSinceSeq: number;
    entries: Array<{
      seq: number;
      request_uid: string;
      request_kind: string;
      command: string;
      id: string;
      category: string;
      params: Record<string, unknown>;
      ts: number;
      ts_ms: number;
    }>;
    /** @deprecated 仅旧签名返回，新签名恒为 matchedTotal */
    total?: number;
  }> {
    if (!enabled) throw new Error('DEBUG_MODE_REQUIRED');

    // 解析新旧签名
    let category = '';
    let id_filter = '';
    let request_uid = '';
    let since_seq = 0;
    let since_ts_ms = 0;
    let lines_num = 200;
    if (typeof categoryOrOptions === 'string') {
      category = categoryOrOptions;
      lines_num = lines;
    } else {
      category = categoryOrOptions.category ?? '';
      id_filter = categoryOrOptions.id ?? '';
      request_uid = categoryOrOptions.requestUid ?? '';
      since_seq = categoryOrOptions.sinceSeq ?? 0;
      since_ts_ms = categoryOrOptions.sinceTsMs ?? 0;
      lines_num = categoryOrOptions.lines ?? 200;
    }

    const params = new URLSearchParams({
      scope: 'debug_diag_log',
      debug: 'all',
      _: String(Date.now()),
    });
    if (category) params.set('category', category);
    if (id_filter) params.set('id', id_filter);
    if (request_uid) params.set('request_uid', request_uid);
    if (since_seq > 0) params.set('since_seq', String(since_seq));
    if (since_ts_ms > 0) params.set('since_ts_ms', String(since_ts_ms));
    params.set('lines', String(lines_num));

    const res = await fetchWithTimeout(
      `${API_BASE}/oblivions/api/state.php?${params.toString()}`,
      { credentials: 'include', cache: 'no-store' },
    );
    const body = await res.json() as {
      status?: string;
      data?: {
        available?: boolean;
        matched_total?: number;
        returned?: number;
        has_more?: boolean;
        next_since_seq?: number;
        entries?: unknown[];
        /** @deprecated 旧字段，仅旧签名兼容返回 */
        total?: number;
      };
      code?: string;
    };
    if (!res.ok || body.status !== 'success' || !body.data) {
      throw new Error(body.code || `HTTP ${res.status}`);
    }
    const data = body.data;
    return {
      available: !!data.available,
      matchedTotal: data.matched_total ?? data.total ?? 0,
      returned: data.returned ?? data.entries?.length ?? 0,
      hasMore: !!data.has_more,
      nextSinceSeq: data.next_since_seq ?? 0,
      entries: (data.entries ?? []) as Array<{
        seq: number;
        request_uid: string;
        request_kind: string;
        command: string;
        id: string;
        category: string;
        params: Record<string, unknown>;
        ts: number;
        ts_ms: number;
      }>,
      // 旧签名兼容
      total: data.matched_total ?? data.total ?? 0,
    };
  }

  function toggle(): void {
    open.value = !open.value;
    scheduleSummaryRefresh();
  }

  async function initialize(): Promise<void> {
    if (!enabled || initialized || typeof document === 'undefined') return;
    initialized = true;
    observer = new MutationObserver(records => {
      const hasBusinessMutation = records.some(record => {
        const target = record.target instanceof Element ? record.target : record.target.parentElement;
        return !target?.closest('[data-debug-id="debug.console"]');
      });
      if (hasBusinessMutation) scheduleSummaryRefresh();
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'disabled', 'aria-disabled', 'aria-hidden'] });
    unwatch = watch(
      [
        () => sceneStore.current,
        () => playerStore.playerInfo,
        () => mapStore.projectionRevision,
        () => exploreStore.navigationPlaying,
        () => moveDirector.phase,
        () => moveDirector.outcome,
        () => battleStore.currentMode,
        () => battleStore.currentQid,
        () => toastStore.toasts.map(item => `${item.id}:${item.count}`).join(','),
      ],
      scheduleSummaryRefresh,
      { deep: false },
    );
    debugBus.on(scheduleSummaryRefresh);
    await loadBackendState().catch(error => {
      lastResult.value = `debug_console: ${error instanceof Error ? error.message : String(error)}`;
    });
    refreshSummary();
    const root = globalThis as Record<string, unknown>;
    root.__phpdtsDebug = {
      ...((root.__phpdtsDebug as Record<string, unknown> | undefined) ?? {}),
      ui: () => summary.value,
      session,
      scenario,
      gm,
      fetchDiagLog,
      refresh: () => refreshSummary(),
    };
  }

  function destroy(): void {
    observer?.disconnect();
    observer = null;
    unwatch?.();
    unwatch = null;
    debugBus.off(scheduleSummaryRefresh);
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = null;
    initialized = false;
  }

  return {
    enabled,
    open,
    busy,
    lastResult,
    backendState,
    summary,
    summaryJson,
    toggle,
    initialize,
    destroy,
    refreshSummary,
    loadBackendState,
    refreshRuntime,
    runCommand,
    session,
    scenario,
    gm,
    fetchDiagLog,
  };
});
