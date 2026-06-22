// ══════════════════════════════════════════════════
// 地图主模块 / Map main module
//
// 职责：数据加载（loadMap）、点击移动业务逻辑（clickMove）、
//       敌人点击战斗触发（handleEnemyClick）、移动高亮（highlightCell）、
//       事件协调（battle:ended 订阅）、DebugBus 状态注册。
//
// 拆分自原 map.js（775 行），算法层见 map-reachability.js，
// 渲染层见 map-render.js，交互层见 map-interaction.js。
// ══════════════════════════════════════════════════

import { DebugBus, mapData, updateMapData } from './data.js';
import { escapeHtml, getPlaceName } from './utils.js';
import { dataManager } from './data-manager.js';
import { commandQueue } from './command-queue.js';
import { startBattle, getBattleMode } from './battle.js';
import { renderMapGrid, setRenderCallbacks, getZoomLevel } from './map-render.js';
import { findPath } from './map-reachability.js';
import { initMapInteraction as _initMapInteraction, setInteractionCallbacks, centerOnPlayer, showPathPreview, clearPathPreview } from './map-interaction.js';
import { initBattleAim } from './battle-aim.js';

// ══════════════════════════════════════════════════
// 回调注册：将业务逻辑注入渲染层和交互层
// ══════════════════════════════════════════════════

// 战斗模式下屏蔽地图交互（移动/探索/攻击均由战斗系统接管）
function isBattleActive() {
    return getBattleMode() === 'battle';
}

setRenderCallbacks({
    onCellClick: function(pls) { if (isBattleActive()) return; clickMove(pls); },
    onEnemyClick: function(enemy) { if (isBattleActive()) return; handleEnemyClick(enemy); },
    onCellHover: function(pls) { if (isBattleActive()) return; showPathPreview(pls); },
    onCellLeave: function() { if (isBattleActive()) return; clearPathPreview(); },
    centerOnPlayer: centerOnPlayer
});

setInteractionCallbacks({
    onKeyMove: function(pls) { if (isBattleActive()) return; clickMove(pls); }
});

// ══════════════════════════════════════════════════
// 加载地图数据
// ══════════════════════════════════════════════════

export async function loadMap() {
    const infoEl = document.getElementById('mapInfo');
    if (infoEl) infoEl.innerHTML = '<span class="grey">loading...</span>';

    DebugBus.emit('api', 'loadMap:start', { action: 'game_map' });
    const t0 = Date.now();
    // P15: 并行发起 game_map 和 enemies 请求，减少串行等待
    // 统一读取入口：经 dataManager.fetch（去重 + 白名单缓存）
    const gameMapPromise = dataManager.fetch('game_map', true);
    const enemyPromise = dataManager.fetch('enemies', true);
    const result = await gameMapPromise;
    const elapsed = Date.now() - t0;

    DebugBus.emit('api', 'loadMap:response', {
        elapsed_ms: elapsed,
        status: result.status,
        hasLinks: !!(result.data && result.data.links)
    });

    if (result.status !== 'success') {
        if (infoEl) infoEl.innerHTML = '<span class="grey">数据加载失败</span>';
        return;
    }
    const d = result.data;
    const { prevRegion } = updateMapData({
        curLoc: d.currentLocation !== undefined ? d.currentLocation : null,
        curRegion: d.currentRegion !== undefined ? d.currentRegion : null,
        links: d.links || null
    });

    // 区域切换 CRT 闪烁过渡
    if (prevRegion !== null && prevRegion !== mapData.curRegion) {
        const grid = document.getElementById('mapGrid');
        if (grid) {
            grid.classList.add('crt-transition');
            setTimeout(() => grid.classList.remove('crt-transition'), 500);
        }
    }

    // 等待 enemy 请求完成（与 game_map 处理并行，此时通常已完成）
    try {
        const enemiesResult = await enemyPromise;
        updateMapData({
            enemies: (enemiesResult.status === 'success' && enemiesResult.data)
                ? (enemiesResult.data.enemies || [])
                : []
        });
    } catch (e) {
        updateMapData({ enemies: [] });
    }

    renderMapGrid();
    // 渲染后居中到玩家位置
    requestAnimationFrame(() => centerOnPlayer(true));

    // mapInfo 状态行
    const curName = mapData.curLoc !== null ? getPlaceName(mapData.curLoc) : 'unknown';
    let infoText = '> LOC: <span class="yellow">' + escapeHtml(curName) + '</span>';
    if (mapData.links && mapData.curRegion !== null) {
        const regionInfo = mapData.links.regions[mapData.curRegion];
        if (regionInfo) {
            infoText += ' | REGION: ' + escapeHtml(regionInfo.name);
        }
    }
    if (infoEl) infoEl.innerHTML = infoText;

    // 统一状态栏：由 player.js 管理，地图加载完成后广播 map:loaded
    dataManager.broadcast('map:loaded', { curLoc: mapData.curLoc, curRegion: mapData.curRegion, hasLinks: !!mapData.links });
}

// ══════════════════════════════════════════════════
// 点击移动 / 点击当前格探索
// ══════════════════════════════════════════════════

async function clickMove(areaId) {
    if (areaId === undefined || areaId === null) return;

    // 点击当前格 → 触发探索（广播事件，tile-action 监听执行）
    if (areaId === mapData.curLoc) {
        dataManager.broadcast('map:click-current');
        return;
    }

    DebugBus.emit('action', 'clickMove:trigger', { target: areaId, current: mapData.curLoc });

    const cmdParams = { command: 'move', moveto: parseInt(areaId) };
    const t0 = Date.now();
    try {
        const result = await commandQueue.execute(cmdParams);
        DebugBus.emit('action', 'clickMove:response', { elapsed_ms: Date.now() - t0, success: result.success });
        if (result.success) {
            // 精准失效：move 命令影响地图、动作条、背包
            dataManager.invalidate('game_map');
            dataManager.invalidate('tile_actions');
            dataManager.invalidate('player_inventory');
            await loadMap();
            dataManager.broadcast('game:action-completed');
            // 移动路径高亮：目标格闪烁
            highlightCell(areaId);
        } else {
            DebugBus.emit('action', 'clickMove:failed', { moveto: areaId, error: result.error });
            dataManager.broadcast('ui:toast', { type: 'error', msg: '移动失败' + (result.error ? ': ' + result.error : '') });
        }
    } catch (err) {
        DebugBus.emit('error', 'clickMove:error', { error: err.message || String(err) });
        dataManager.broadcast('ui:toast', { type: 'error', msg: '移动失败' });
    }
}

/**
 * 敌人格点击处理：前端校验攻击距离（阶段一射程=1，相邻格），
 * 通过后触发战斗确认界面
 */
function handleEnemyClick(enemy) {
    // 前端校验攻击距离（阶段一射程=1，相邻格）
    const path = findPath(mapData.curLoc, parseInt(enemy.pls));
    const distance = path ? path.length - 1 : -1;
    if (distance !== 1) {
        dataManager.broadcast('ui:toast', { type: 'error', msg: '目标距离过远，需先靠近' });
        return;
    }
    startBattle(parseInt(enemy.pid));
}

// ══════════════════════════════════════════════════
// 移动路径高亮
// ══════════════════════════════════════════════════

function highlightCell(areaId) {
    const grid = document.getElementById('mapGrid');
    if (!grid) return;
    const cells = grid.querySelectorAll('.map-cell');
    for (const cell of cells) {
        if (cell.dataset.pls == areaId) {
            cell.classList.add('move-highlight');
            setTimeout(() => cell.classList.remove('move-highlight'), 600);
            break;
        }
    }
}

// ══════════════════════════════════════════════════
// 事件订阅 + 调试状态
// ══════════════════════════════════════════════════

// 战斗结束 → 刷新地图（敌人可能已死亡，需从地图移除）
dataManager.listen('battle:ended', function() {
    loadMap();
});

// 瞄准模式：初始化事件监听（battle:aim-mode / aim-exit / map:loaded）
initBattleAim();

DebugBus.registerState('map', function() {
    const tiles = (mapData.links && mapData.curRegion) ? mapData.links.tiles[mapData.curRegion] : null;
    const curTile = tiles && mapData.curLoc !== null ? tiles[mapData.curLoc] : null;
    const regionInfo = (mapData.links && mapData.curRegion) ? mapData.links.regions[mapData.curRegion] : null;
    return {
        pgroup: mapData.curRegion,
        pls: mapData.curLoc,
        regionName: regionInfo ? regionInfo.name : null,
        tileName: curTile ? curTile.name : null,
        hasLinks: !!mapData.links,
        zoomLevel: getZoomLevel()
    };
});

// ══════════════════════════════════════════════════
// 导出
// ══════════════════════════════════════════════════

export { _initMapInteraction as initMapInteraction };
