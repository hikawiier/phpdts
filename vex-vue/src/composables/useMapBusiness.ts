/**
 * @module M 组合式函数
 * @framework M-2 场景差异投影
 */

// ══════════════════════════════════════════════════
// 地图业务逻辑层 / Map business logic
//
// 替代现有 vex/js/map.js 的业务编排部分（loadMap/clickMove/handleEnemyClick/highlightCell）。
// loadMap() 本身迁移到 mapStore action（useMapBusiness 调用 mapStore.loadMap）。
//
// 职责：
//   - clickMove(areaId)：点击移动业务逻辑（提交命令 + 失效缓存 + 重新加载 + 广播）
//   - handleEnemyClick(enemy)：敌人点击战斗触发（M6 才有 startBattle，暂时占位）
//   - highlightCell(areaId)：移动路径高亮
//   - setupMapCallbacks()：注册渲染/交互回调 + battle:ended 监听 + DebugBus 状态
//
// 依赖：
//   - mapStore（loadMap / updateMapData / curLoc / curRegion / links / enemies）
//   - commandQueue（execute）
//   - dataManager（invalidate / broadcast / listen）
//   - useMapRender（setRenderCallbacks）
//   - useMapInteraction（setInteractionCallbacks）
//   - debugBus（registerState）
// ══════════════════════════════════════════════════

import { useMapStore } from '@/stores/map';
import { useBattleStore } from '@/stores/battle';
import { commandQueue } from '@/stores/command-queue';
import { dataManager } from '@/stores/data-manager';
import { debugBus } from '@/composables/useDebugBus';
import { setRenderCallbacks, setPathPreviewGetter, getZoomLevel, triggerHighlight } from '@/composables/useMapRender';
import { setInteractionCallbacks, showPathPreview, clearPathPreview, centerOnPlayer, getPathPreviewCells } from '@/composables/useMapInteraction';
import { perf } from '@/utils/perf';
import type { Character } from '@/types/character';
import { isBattleMapInputLocked, isSilentMapCommandLock } from '@/stores/battle-ui-policy';
import { usePresentationSceneStore } from '@/stores/presentation-scene';
import { getStatusLocale } from '@/data/status-locale';
import { renderCommandFeedback } from '@/data/command-feedback';

/**
 * 点击移动 / 点击当前格探索
 *
 * 与现有 vex/js/map.js clickMove 一致：
 *   - 点击当前格 → 广播 map:click-current（tile-action 监听执行探索）
 *   - 点击其他格 → commandQueue.execute(move) → 失效缓存 → loadMap → 广播
 */
export async function clickMove(areaId: string | number): Promise<void> {
  if (areaId === undefined || areaId === null) return;
  const mapStore = useMapStore();
  const battleStore = useBattleStore();
  const presentationScene = usePresentationSceneStore();
  if (isBattleMapInputLocked({
    currentMode: battleStore.currentMode,
    isPlayingBattleLog: battleStore.isPlayingBattleLog,
    isProcessingBattle: battleStore.isProcessingBattle,
    presentationPhase: presentationScene.phase,
  })) return;

  // 点击当前格 → 触发探索（广播事件，tile-action 监听执行）
  if (String(areaId) === String(mapStore.curLoc)) {
    dataManager.broadcast('map:click-current');
    return;
  }

  perf.clear();
  perf.mark('clickMove 开始', 'store');
  debugBus.emit('action', 'clickMove:trigger', { target: areaId, current: mapStore.curLoc });

  const cmdParams = {
    command: 'map.move',
    payload: { to: parseInt(String(areaId), 10) },
  };
  const t0 = Date.now();
  try {
    perf.mark('→ sendOblCommand 开始', 'store');
    const result = await commandQueue.execute(cmdParams);
    perf.mark('← sendOblCommand 完成', 'store');
    debugBus.emit('action', 'clickMove:response', {
      elapsed_ms: Date.now() - t0,
      success: result.success,
    });
    if (result.success) {
      // 精准失效：move 命令影响地图、动作条、背包
      perf.mark('→ invalidate', 'store');
      dataManager.invalidate('game_map');
      dataManager.invalidate('tile_actions');
      dataManager.invalidate('player_inventory');
      perf.mark('← invalidate 完成', 'store');

      perf.mark('→ loadMap 开始', 'store');
      await mapStore.loadMap();
      perf.mark('← loadMap 完成', 'store');

      perf.mark('→ broadcast game:action-completed', 'broadcast');
      dataManager.broadcast('game:action-completed');
      perf.mark('← broadcast game:action-completed 完成', 'broadcast');

      // 移动成功后清理路径预览：玩家位置已变化，旧预览路径失效。
      // 即便鼠标 @mouseleave 未触发（点击移动后鼠标静止），也能保证预览不残留。
      clearPathPreview();

      // 移动路径高亮：目标格闪烁
      highlightCell(areaId);
      perf.mark('clickMove 全部完成', 'store');

      perf.report();
    } else {
      if (result.error === 'LOCKED' && isSilentMapCommandLock(result.lockReason)) return;
      const message = result.message || result.error || '';
      debugBus.emit('action', 'clickMove:failed', { target: areaId, error: result.error, message });
      dataManager.broadcast('ui:toast', {
        type: 'error',
        msg: '移动失败' + (message ? ': ' + message : ''),
        isHtml: !!result.messageIsHtml,
      });
    }
  } catch (err) {
    debugBus.emit('error', 'clickMove:error', { error: err instanceof Error ? err.message : String(err) });
    dataManager.broadcast('ui:toast', { type: 'error', msg: '移动失败' });
  }
}

/**
 * 敌人格点击处理：调用后端 L0 可达性判断，通过后触发战斗开始
 *
 * 替代旧的硬编码 distance!==1 前端校验。后端 combat.can_engage 命令基于
 * actor 的 max_attack_range + move_power 判断目标是否可达。
 */
export async function handleEnemyClick(enemy: Character): Promise<void> {
  const mapStore = useMapStore();
  if (mapStore.curLoc === null) return;

  const enemyPid = parseInt(String(enemy.pid), 10);

  const result = await commandQueue.execute({
    command: 'combat.can_engage',
    payload: { target_pid: enemyPid },
  });

  if (!result.success) {
    dataManager.broadcast('ui:toast', { type: 'error', msg: result.message || '可达性判断失败' });
    return;
  }

  const engageData = (result.gamedata as {
    reachable: boolean;
    max_attack_range: number;
    move_power: number;
    distance: number;
    reason: string | null;
    capability?: {
      allowed?: boolean;
      reason?: string;
      source_status_ids?: string[];
      sources?: Array<{ skill_id?: string; hidden?: boolean }>;
    };
    actor_capability?: {
      allowed?: boolean;
      reason?: string;
      source_status_ids?: string[];
      sources?: Array<{ skill_id?: string; hidden?: boolean }>;
    };
    capability_failure?: {
      allowed?: boolean;
      reason?: string;
      source_status_ids?: string[];
      sources?: Array<{ skill_id?: string; hidden?: boolean }>;
    };
  } | undefined);

  if (!engageData) {
    dataManager.broadcast('ui:toast', { type: 'error', msg: '可达性判断返回数据异常' });
    return;
  }

  if (!engageData.reachable) {
    let msg: string;
    const capability = engageData.actor_capability
      ?? engageData.capability_failure
      ?? engageData.capability;
    if (engageData.reason === 'cross_zone') {
      msg = '目标在其他区域，无法发起战斗';
    } else if (engageData.reason === 'unreachable') {
      msg = '目标不可达，无法发起战斗';
    } else if (capability && capability.allowed === false) {
      const sourceIds = capability.source_status_ids
        ?? capability.sources?.filter(source => !source.hidden && source.skill_id).map(source => source.skill_id!)
        ?? [];
      const names = sourceIds.map(id => getStatusLocale(id).name);
      msg = engageData.reason === 'target_capability_blocked'
        ? `${names.join('、') || '当前状态'}使目标无法参与战斗。`
        : `${names.join('、') || '当前状态'}使你无法发起战斗。`;
    } else if (result.gamedata?.feedback) {
      msg = renderCommandFeedback(null, result.gamedata).message;
    } else {
      msg = `目标距离 ${engageData.distance} 格，你最远可达 ${engageData.max_attack_range + engageData.move_power} 格`;
    }
    dataManager.broadcast('ui:toast', { type: 'error', msg });
    return;
  }

  const battleStore = useBattleStore();
  battleStore.startBattle(enemyPid);
}

/**
 * 移动路径高亮
 *
 * 委托 useMapRender.triggerHighlight 写入响应式状态，由 cells computed 驱动 :class 渲染。
 * 取代旧命令式 querySelector + classList.add + setTimeout 自清理。
 */
export function highlightCell(areaId: string | number): void {
  triggerHighlight(areaId);
}

// ─── battle:ended 监听标志（避免重复注册） ───
let _battleEndedListenerRegistered = false;
let _debugStateRegistered = false;

/**
 * 注册地图业务回调
 *
 * 由 MapGrid.vue 在 onMounted 调用，注入：
 *   - useMapRender 的渲染回调（onCellClick/onEnemyClick/onCellHover/onCellLeave/centerOnPlayer）
 *   - useMapInteraction 的交互回调（onKeyMove）
 *   - dataManager 的 battle:ended 监听（战斗结束 → 刷新地图）
 *   - debugBus 的状态注册（供 ?debug=ai 使用）
 *
 * 注意：battle:ended 监听只注册一次（模块级标志）。
 */
export function setupMapCallbacks(): void {
  const mapStore = useMapStore();
  const battleStore = useBattleStore();

  // ─── 注入渲染回调 ───
  setRenderCallbacks({
    onCellClick: (pls) => {
      if (battleStore.currentMode === 'battle') return;
      clickMove(pls);
    },
    onEnemyClick: (enemy) => {
      if (battleStore.currentMode === 'battle') return;
      handleEnemyClick(enemy);
    },
    onCellHover: (pls) => {
      if (battleStore.currentMode === 'battle') return;
      showPathPreview(pls);
    },
    onCellLeave: () => {
      if (battleStore.currentMode === 'battle') return;
      clearPathPreview();
    },
    centerOnPlayer: (smooth) => {
      centerOnPlayer(smooth);
    },
  });

  // ─── 注入路径预览状态读取接口 ───
  // useMapInteraction 持有响应式 pathPreviewCells 状态，useMapRender 的 cells computed 通过此 getter 读取。
  // 用注入而非直接 import 是为避免 useMapRender ↔ useMapInteraction 循环依赖。
  setPathPreviewGetter(getPathPreviewCells);

  // ─── 注入交互回调 ───
  setInteractionCallbacks({
    onKeyMove: (pls) => {
      if (battleStore.currentMode === 'battle') return;
      return clickMove(pls);
    },
  });

  // ─── battle:ended → 刷新地图（敌人可能已死亡） ───
  if (!_battleEndedListenerRegistered) {
    _battleEndedListenerRegistered = true;
    dataManager.listen('battle:ended', () => {
      mapStore.loadMap();
    });
  }

  // ─── DebugBus 状态注册（供 ?debug=ai 使用） ───
  if (!_debugStateRegistered) {
    _debugStateRegistered = true;
    debugBus.registerState('map', () => {
      const tiles = (mapStore.links && mapStore.curRegion !== null)
        ? (mapStore.links.tiles[String(mapStore.curRegion)] as Record<string, { name?: string }> | undefined)
        : null;
      const curTile = tiles && mapStore.curLoc !== null ? tiles[String(mapStore.curLoc)] : null;
      const regionInfo = (mapStore.links && mapStore.curRegion !== null)
        ? (mapStore.links.regions as Record<string, { name?: string }>)[String(mapStore.curRegion)]
        : null;
      return {
        pgroup: mapStore.curRegion,
        pls: mapStore.curLoc,
        regionName: regionInfo ? regionInfo.name : null,
        tileName: curTile ? curTile.name : null,
        hasLinks: !!mapStore.links,
        zoomLevel: getZoomLevel(),
      };
    });
  }
}
