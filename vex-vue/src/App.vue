<script setup lang="ts">
// ══════════════════════════════════════════════════
// App.vue — 根布局
//
// 替代现有 vex/index.html 的 #app 主结构 + vex/js/app.js 的全局事件绑定。
//
// 布局（与现有 index.html 一致）：
//   #app (h-screen flex flex-col)
//     ├── StatusBar (flex-none)
//     └── main (flex-1 grid grid-cols-[65%_1fr])
//         ├── LeftPanel (地图)
//         └── RightPanel (日志+动作 / 战斗动作)
//   浮动组件（Teleport to body 或固定定位）：
//     ├── Modal
//     ├── Itm0Modal（itm0 非空时弹出提醒）
//     ├── PlayerDrawer
//     ├── InventoryDrawer
//     └── ToastContainer
//
// 全局功能：
//   - onMounted: 加载 player_info（状态栏显示真实数据）
//   - keydown: ESC/i/p 快捷键（与现有 app.js 一致）
//   - battle-active 类：战斗模式下红色边框光效
//   - debug-ai 类：?debug=ai 时显示 tick 调试
// ══════════════════════════════════════════════════

import { onMounted, onUnmounted, computed } from 'vue';
import { usePlayerStore } from '@/stores/player';
import { useMapStore } from '@/stores/map';
import { useBattleStore } from '@/stores/battle';
import { useUiStore } from '@/stores/ui';
import { useTileActionStore } from '@/stores/tileAction';
import { useInventoryStore } from '@/stores/inventory';
import { useToastStore } from '@/stores/toast';
import { useLogStore } from '@/stores/log';
import { useErrorLogStore } from '@/stores/error-log';
import { useCraftStore } from '@/stores/craft';
import { commandQueue } from '@/stores/command-queue';
import StatusBar from '@/components/layout/StatusBar.vue';
import LeftPanel from '@/components/layout/LeftPanel.vue';
import RightPanel from '@/components/layout/RightPanel.vue';
import PlayerDrawer from '@/components/layout/PlayerDrawer.vue';
import InventoryDrawer from '@/components/layout/InventoryDrawer.vue';
import Modal from '@/components/layout/Modal.vue';
import Itm0Modal from '@/components/inventory/Itm0Modal.vue';
import CraftModal from '@/components/craft/CraftModal.vue';
import ToastContainer from '@/components/layout/ToastContainer.vue';

const playerStore = usePlayerStore();
const mapStore = useMapStore();
const battleStore = useBattleStore();
const uiStore = useUiStore();
const tileActionStore = useTileActionStore();
const inventoryStore = useInventoryStore();
const toastStore = useToastStore();
const logStore = useLogStore();
const errorLogStore = useErrorLogStore();
const craftStore = useCraftStore();

// ── 战斗模式：根元素加 .battle-active 类（红色边框光效） ──
const isBattleActive = computed(() => battleStore.currentMode === 'battle');

// ── ?debug=ai 时加 .debug-ai 类（显示 tick 调试） ──
const isDebugAi = computed(() => {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('debug') === 'ai';
});

// ── 全局键盘快捷键（与现有 app.js 一致） ──
// ESC: 合成模态框 > 通用模态框 > 右抽屉 > 左抽屉（优先级，合成模态框最优先）
// i/I: 切换右抽屉
// p/P: 打开左抽屉
function onKeydown(e: KeyboardEvent): void {
  // 忽略输入框内的按键
  const target = e.target as HTMLElement;
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

  if (e.key === 'Escape') {
    if (craftStore.craftModalOpen) {
      craftStore.closeModal();
    } else if (uiStore.modalOpen) {
      uiStore.closeModal();
    } else if (uiStore.inventoryDrawerOpen) {
      uiStore.closeInventoryDrawer();
    } else if (uiStore.playerDrawerOpen) {
      uiStore.closePlayerDrawer();
    }
  } else if (e.key === 'i' || e.key === 'I') {
    uiStore.toggleInventoryDrawer();
  } else if (e.key === 'p' || e.key === 'P') {
    uiStore.openPlayerDrawer();
  }
}

// ── 初始化：加载玩家信息 + 地图数据 ──
// 与现有 vex/js/app.js loadAll() 一致：player_info + game_map + enemies 并行
// M4：同时注册 tileAction/inventory/toast 的事件监听（监听 map:loaded 等）
onMounted(async () => {
  document.addEventListener('keydown', onKeydown);

  // 注册 M4/M5/M6 store 的事件监听（监听 map:loaded / game:action-completed / ui:toast / preload:executed 等）
  tileActionStore.registerListeners();
  inventoryStore.registerListeners();
  toastStore.registerListeners();
  logStore.registerListeners();
  battleStore.registerListeners();
  errorLogStore.registerListeners();

  // 启动前端守护进程心跳（纯后端 tick 激活，200ms 间隔）
  battleStore.startDaemonPoll();

  // 错误日志独立轮询：默认关闭，URL 参数 ?poll_error=1 开启
  // 事件驱动（game:action-completed）始终生效，轮询仅作兜底
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('poll_error') === '1') {
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
  battleStore.stopDaemonPoll();
  document.removeEventListener('keydown', onKeydown);
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
      <!-- ═══ STATUS BAR ═══ -->
      <StatusBar />

      <!-- ═══ MAIN ═══ -->
      <main class="flex-1 grid grid-cols-[65%_1fr] min-h-0 overflow-hidden">
        <!-- LEFT: Map -->
        <LeftPanel />
        <!-- RIGHT: Log + Actions / Battle Actions -->
        <RightPanel />
      </main>
    </div>

    <!-- ═══ 浮动组件 ═══ -->
    <Modal />
    <Itm0Modal />
    <CraftModal />
    <PlayerDrawer />
    <InventoryDrawer />
    <ToastContainer />
  </div>
</template>
