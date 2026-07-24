<script setup lang="ts">
/**
 * @module K 状态管理层
 */

// ══════════════════════════════════════════════════
// App.vue — 根布局（三场景所有权框架 F-K1-Scenes）
//
// 替代现有 vex/index.html 的 #app 主结构 + vex/js/app.js 的全局事件绑定。
//
// 三段式结构（对齐 F-K1-Scenes §三不变量）：
//   #app (h-screen flex flex-col)
//     ├── StatusBar（单一顶栏所有者，按场景切换内容，不在各场景内部重复）
//     └── main (flex-1 flex min-h-0 overflow-hidden relative)
//         ├── Transition scene-fade mode=out-in → 探索/战斗中央工作区互斥（B5.34）
//         │   （3.2 实现 ExploreScene 内部，3.4 实现 BattleScene；本子任务先用 LeftPanel+RightPanel 占位）
//         └── Transition atlas-fade → AtlasScene 模态覆盖（absolute inset-0，B5.33）
//             （3.3 实现 AtlasScene，本子任务留接入点）
//   浮动组件：
//     ├── Modal / Itm0Modal / CraftModal / PoiModal / DiscoveryModal / ToastContainer
//     └── PortraitHint（竖屏旋转提示，fixed inset:0 z-index:9999 覆盖一切）
//
// 全局功能：
//   - onMounted: 加载 player_info + 地图数据 + 注册 store 事件监听
//   - battle-active 类：战斗模式下红色边框光效（派生自 sceneStore.isBattle）
//   - debug-ai 类：?debug=ai 时显示 tick 调试
//   - 竖屏检测：matchMedia orientation: portrait，竖屏时挂载 PortraitHint
// ══════════════════════════════════════════════════

import { onMounted, onUnmounted, computed, ref } from 'vue';
import { usePlayerStore } from '@/stores/player';
import { useMapStore } from '@/stores/map';
import { useBattleStore } from '@/stores/battle';
import { useSceneStore } from '@/stores/scene-store';
import { useTileActionStore } from '@/stores/tileAction';
import { useInventoryStore } from '@/stores/inventory';
import { useToastStore } from '@/stores/toast';
import { useLogStore } from '@/stores/log';
import { useErrorLogStore } from '@/stores/error-log';
import { usePoiStore } from '@/stores/poi';
import { commandQueue } from '@/stores/command-queue';
import StatusBar from '@/components/layout/StatusBar.vue';
import ExploreScene from '@/components/layout/ExploreScene.vue';
import AtlasScene from '@/components/map/AtlasScene.vue';
import LeftPanel from '@/components/layout/LeftPanel.vue';
import RightPanel from '@/components/layout/RightPanel.vue';
import PlayerDrawer from '@/components/layout/PlayerDrawer.vue';
import InventoryDrawer from '@/components/layout/InventoryDrawer.vue';
import Modal from '@/components/layout/Modal.vue';
import Itm0Modal from '@/components/inventory/Itm0Modal.vue';
import CraftModal from '@/components/craft/CraftModal.vue';
import PoiModal from '@/components/poi/PoiModal.vue';
import GroundItemsModal from '@/components/actions/GroundItemsModal.vue';
import DiscoveryModal from '@/components/DiscoveryModal.vue';
import ToastContainer from '@/components/layout/ToastContainer.vue';
import PortraitHint from '@/components/layout/PortraitHint.vue';
import { isDebugEnabled } from '@/utils/debug-flags';

const playerStore = usePlayerStore();
const mapStore = useMapStore();
const battleStore = useBattleStore();
const sceneStore = useSceneStore();
const tileActionStore = useTileActionStore();
const inventoryStore = useInventoryStore();
const toastStore = useToastStore();
const logStore = useLogStore();
const errorLogStore = useErrorLogStore();
const poiStore = usePoiStore();

// ── 战斗模式：根元素加 .battle-active 类（红色边框光效） ──
// 派生自 sceneStore.isBattle（单一真源）
const isBattleActive = computed(() => sceneStore.isBattle);

// ── ?debug=ai 时加 .debug-ai 类（显示 tick 调试） ──
const isDebugAi = computed(() => isDebugEnabled('ai'));

// ── 竖屏检测：横屏是主设计基准，竖屏只显示旋转提示（设计案 §7.2 / B6.27-B6.29） ──
const isPortrait = ref(false);
let orientationMql: MediaQueryList | null = null;

function onOrientationChange(event: MediaQueryListEvent): void {
  isPortrait.value = event.matches;
}

// setup 阶段同步读取姿态，避免首屏闪烁
if (typeof window !== 'undefined' && window.matchMedia) {
  orientationMql = window.matchMedia('(orientation: portrait)');
  isPortrait.value = orientationMql.matches;
}

// ── 初始化：加载玩家信息 + 地图数据 ──
// 与现有 vex/js/app.js loadAll() 一致：player_info + game_map + enemies 并行
// M4：同时注册 tileAction/inventory/toast 的事件监听（监听 map:loaded 等）
onMounted(async () => {
  // 注册竖屏姿态监听
  if (orientationMql) {
    orientationMql.addEventListener('change', onOrientationChange);
  }

  // 注册 M4/M5/M6 store 的事件监听（监听 map:loaded / game:action-completed / ui:toast / preload:executed 等）
  tileActionStore.registerListeners();
  inventoryStore.registerListeners();
  toastStore.registerListeners();
  logStore.registerListeners();
  battleStore.registerListeners();
  errorLogStore.registerListeners();
  poiStore.registerListeners();

  // 启动前端守护进程心跳（纯后端 tick 激活，200ms 间隔）
  battleStore.startDaemonPoll();

  // 错误日志独立轮询：默认关闭，URL 参数 ?debug=error-poll 开启
  // 事件驱动（game:action-completed）始终生效，轮询仅作兜底
  if (isDebugEnabled('error-poll')) {
    errorLogStore.startPolling();
  }

  // 并行加载 player_info（状态栏）+ loadMap（地图）
  // loadMap 完成后会广播 map:loaded，触发 tileAction/inventory 自动加载
  await Promise.all([
    playerStore.loadPlayerInfo(true),
    mapStore.loadMap(),
  ]);

  // 刷新页面后若处于战斗中，调用 refreshBattle 进入战斗模式
  // （刷新时无事件触发 refreshBattle，需主动调用一次）
  if (playerStore.isInBattle) {
    await battleStore.refreshBattle();
  }
});

onUnmounted(() => {
  if (orientationMql) {
    orientationMql.removeEventListener('change', onOrientationChange);
    orientationMql = null;
  }
  battleStore.stopDaemonPoll();
  errorLogStore.stopPolling();
  commandQueue.destroy();
});
</script>

<template>
  <div
    id="app"
    class="h-screen overflow-hidden bg-bg text-fg-mid font-mono text-xs leading-[1.6] select-none"
    :class="{
      'battle-active': isBattleActive,
      'debug-ai': isDebugAi,
    }"
  >
    <div class="h-full flex flex-col">
      <!-- ═══ STATUS BAR（单一顶栏所有者，按场景切换内容 / B5.41） ═══ -->
      <StatusBar />

      <!-- ═══ MAIN（三场景所有权框架 F-K1-Scenes §三不变量） ═══ -->
      <main class="flex-1 flex min-h-0 overflow-hidden relative">
        <!-- 探索/战斗中央工作区互斥切换（Transition mode=out-in 灰阶淡入淡出，B5.34）
             3.2 实现 ExploreScene（含 PlayerDrawer/InventoryDrawer push 抽屉）
             3.4 替换战斗占位为 BattleScene -->
        <Transition name="scene-fade" mode="out-in">
          <ExploreScene v-if="!sceneStore.isBattle" key="explore" class="flex-1 flex min-h-0 min-w-0" />
          <div v-else key="battle" class="flex-1 flex min-h-0 min-w-0">
            <!-- 战斗场景占位：3.4 替换为 BattleScene 组件
                 当前复用 LeftPanel（区域地图战斗呈现，B5.27）+ RightPanel（战斗动作预装填/瞄准/参战者/执行反馈，B5.28）
                 PlayerDrawer/InventoryDrawer 暂保留在战斗占位（3.4 由 BattleScene 接管） -->
            <PlayerDrawer />
            <LeftPanel />
            <RightPanel />
            <InventoryDrawer />
          </div>
        </Transition>

        <!-- AtlasScene 模态覆盖（absolute inset-0，从上方淡入，B5.33）
             下方探索场景冻结但可见；AtlasScene 占满 atlas-overlay 内部 -->
        <Transition name="atlas-fade">
          <div v-if="sceneStore.isAtlas" class="atlas-overlay">
            <AtlasScene />
          </div>
        </Transition>
      </main>
    </div>

    <!-- ═══ 浮动组件（模态框 + Toast，仍 fixed 层） ═══ -->
    <Modal />
    <Itm0Modal />
    <CraftModal />
    <PoiModal />
    <GroundItemsModal />
    <DiscoveryModal />
    <ToastContainer />

    <!-- ═══ 竖屏旋转提示（fixed inset:0 z-index:9999，覆盖一切 / B6.27-B6.29） ═══ -->
    <PortraitHint v-if="isPortrait" />
  </div>
</template>

<style scoped>
/* 探索 ↔ 战斗：灰阶淡入淡出（B5.34 / §2.15 视觉语言统一性）
   out-in 保证旧场景先淡出再淡入，避免抖动 */
.scene-fade-enter-active,
.scene-fade-leave-active {
  transition: opacity 0.18s ease;
}
.scene-fade-enter-from,
.scene-fade-leave-to {
  opacity: 0;
}

/* 完整地图：从上方淡入（B5.33），灰阶，无彩色
   从顶栏降下的空间语义，translateY -14px→0
   atlas-overlay 是模态容器，AtlasScene 占满其内部（h-full） */
.atlas-overlay {
  position: absolute;
  inset: 0;
  z-index: 20;
  background: #0a0a0a;
  border-top: 1px solid rgba(68, 68, 68, 0.5);
  overflow: hidden;
}
.atlas-fade-enter-active {
  transition: opacity 0.22s ease, transform 0.22s ease;
}
.atlas-fade-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.atlas-fade-enter-from {
  opacity: 0;
  transform: translateY(-14px);
}
.atlas-fade-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
