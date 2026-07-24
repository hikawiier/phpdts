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
//   - clickMove(areaId)：点击移动业务逻辑（当前格广播探索 / 可达格委托移动导演逐格演出）
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
import { useExploreStore } from '@/stores/explore-store';
import { useMoveDirectorStore } from '@/stores/move-director';
import { debugBus } from '@/composables/useDebugBus';
import { setRenderCallbacks, setPathPreviewGetter, getZoomLevel, triggerHighlight } from '@/composables/useMapRender';
import { setInteractionCallbacks, showPathPreview, clearPathPreview, centerOnPlayer, getPathPreviewCells } from '@/composables/useMapInteraction';
import type { Character } from '@/types/character';
import { isBattleMapInputLocked } from '@/stores/battle-ui-policy';
import { usePresentationSceneStore } from '@/stores/presentation-scene';
import { getStatusLocale } from '@/data/status-locale';
import { renderCommandFeedback } from '@/data/command-feedback';

/**
 * 点击移动 / 点击当前格探索
 *
 *   - 点击当前格 → 广播 map:click-current（tile-action 监听执行探索）
 *   - 点击其他格 → 委托 moveDirector.startNavigation 发送 map.navigate 并解析逐格演出
 *     （F-K4-Director §5.2 / 设计案 §8.2；与 MainActionBar.onMove 同入口）
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

  // 点击相邻可达格 → 委托移动导演逐格演出（F-K4-Director §5.2 / 设计案 §8.2）
  //
  // 修复"点击地图相邻格子绕过移动导演"断档：原先直接发送 map.move（单次原子移动），
  // 而移动导演只监听 map.navigate（高层导航），导致点击可达格走旧路径完全绕过导演，
  // 无移动动画 / 无迷雾清除 / 无 DiscoveryModal 发现反馈。
  // 现统一委托 moveDirector.startNavigation，由其发送 map.navigate 并解析逐格演出。
  // inputLocked 门控由 startNavigation 内部处理（move-director.ts:596-597），无需重复检查。
  // 旧 map.move 路径（invalidate/loadMap/clearPathPreview/highlightCell）已删除，移动导演
  // 内部演出流程统一接管迷雾清除/发现反馈/位置投影；如需回退请通过 git 历史恢复。
  debugBus.emit('action', 'clickMove:trigger', { target: areaId, current: mapStore.curLoc });
  const explore = useExploreStore();
  const moveDirector = useMoveDirectorStore();
  await moveDirector.startNavigation(explore.tendency, Number(areaId));
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
