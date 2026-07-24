<script setup lang="ts">
/**
 * @module L Vue 组件
 */
// ══════════════════════════════════════════════════
// ExploreScene — 探索场景（F-K2-Explore §5 / 设计案 §7.2）
//
// 三段式 push 布局（对齐正式 App.vue §3.8 / L-8 push 模式持久抽屉）：
//   root (h-full flex flex-row)
//     ├── PlayerDrawer（LEFT push，flex-basis 0↔220，挤压中央工作区）
//     ├── 中央工作区 (flex-1 flex)
//     │   桌面：MapContainer 地图 (flex:65) + 右侧 LogPanel+TileContextBar+MainActionBar (flex:35)
//     │   手机横屏：地图主区 + 右紧凑标签（战报/当前格）+ 底部主操作区
//     └── InventoryDrawer（RIGHT push，flex-basis 0↔220）
//
// 内部内容（3.2 实现）：
//   - 局部视野地图（MapContainer → MapGrid 三态认知 B5.20-B5.25）
//   - 当前格情境操作区（TileContextBar，移除探索按钮）
//   - 主操作区：移动/探索/倾向/目标（MainActionBar，§5.4 始终显示）
//   - 日志面板（LogPanel，K-8 增量获取 + 灰阶层级视觉）
//   - 主动探索占位演出（explore-store exploring 状态，§5.5 演出与结算解耦）
//   - 移动导演占位（explore-store moveMode/navigationPlaying，3.4 接入）
//
// 响应式（B6.14-B6.21）：
//   - 横屏是主设计基准（竖屏由 App.vue 的 PortraitHint 覆盖）
//   - 内部 matchMedia 检测宽度 ≤ 900 → compact 模式（手机横屏 844×390）
//   - compact 模式：flex-col + 底部 MainActionBar(variant=mobile) + 右侧标签切换
//
// 单一输入门控（§5.4）：inputLocked = exploring || navigationPlaying
//   - 演出期间锁定移动/探索/目标（会改变游戏状态的操作）
//   - 加速/跳过始终可用（不改变游戏状态，B6.10）
// ══════════════════════════════════════════════════

import { ref, onMounted, onUnmounted } from 'vue';
import MapContainer from '@/components/map/MapContainer.vue';
import LogPanel from '@/components/log/LogPanel.vue';
import TileContextBar from '@/components/actions/TileContextBar.vue';
import MainActionBar from '@/components/actions/MainActionBar.vue';
import PlayerDrawer from '@/components/layout/PlayerDrawer.vue';
import InventoryDrawer from '@/components/layout/InventoryDrawer.vue';
import { useExploreStore } from '@/stores/explore-store';
import { UI_TEXT } from '@/data/ui-locale';

const explore = useExploreStore();

// ── 响应式 compact 检测（B6.14-B6.21） ──
// 横屏是主设计基准；宽度 ≤ 900 视为手机横屏 compact 模式（覆盖 844×390）
const isCompact = ref<boolean>(false);
let compactMql: MediaQueryList | null = null;

function onCompactChange(event: MediaQueryListEvent): void {
  isCompact.value = event.matches;
}

// setup 阶段同步读取，避免首屏闪烁
if (typeof window !== 'undefined' && window.matchMedia) {
  compactMql = window.matchMedia('(max-width: 900px)');
  isCompact.value = compactMql.matches;
}

onMounted(() => {
  if (compactMql) {
    compactMql.addEventListener('change', onCompactChange);
  }
});

onUnmounted(() => {
  if (compactMql) {
    compactMql.removeEventListener('change', onCompactChange);
    compactMql = null;
  }
});
</script>

<template>
  <div class="explore-root relative h-full min-h-0 flex flex-row">
    <!-- ═══ LEFT PUSH: PlayerDrawer（属性抽屉，关闭时 flex-basis:0） ═══ -->
    <PlayerDrawer />

    <!-- ═══ 中央工作区（flex-1，被抽屉挤压时自动收缩） ═══ -->
    <div
      class="flex-1 flex min-h-0 min-w-0"
      :class="isCompact ? 'flex-col' : 'flex-row'"
    >
      <!-- ═══ 桌面：地图左 + 右侧面板 ═══ -->
      <template v-if="!isCompact">
        <!-- LeftPanel：局部视野地图（flex:65，被抽屉挤压时自动收缩） -->
        <MapContainer class="flex-[65_1_0%] min-w-0" />

        <!-- RightPanel：日志 + 情境操作 + 主操作区（flex:35） -->
        <div class="flex-[35_1_0%] min-w-0 flex flex-col min-h-0 overflow-hidden">
          <!-- CHRONICLE 日志（flex:5，逐次移动反馈需要足够空间） -->
          <div
            class="min-h-0 flex flex-col p-3 overflow-hidden border-b border-fg-dim/30"
            style="flex:5 1 0%;"
          >
            <div class="ascii-title flex-none mb-1.5">
              <span>┌─</span>
              <span class="ascii-label">{{ UI_TEXT.CHRONICLE }}</span>
              <span>─</span>
              <span class="flex-1 ascii-line"></span>
              <span>┐</span>
            </div>
            <div class="flex-1 min-h-0">
              <LogPanel />
            </div>
          </div>

          <!-- ACTIONS：情境操作 + 主操作区（flex:5，按钮密度低无需过大） -->
          <div
            class="min-h-0 flex flex-col p-3 overflow-hidden"
            style="flex:5 1 0%;"
          >
            <div class="ascii-title flex-none mb-1.5">
              <span>┌─</span>
              <span class="ascii-label">{{ UI_TEXT.ACTIONS }}</span>
              <span>─</span>
              <span class="flex-1 ascii-line"></span>
              <span>┐</span>
            </div>
            <div class="flex-1 overflow-y-auto min-h-0 flex flex-col gap-2">
              <!-- 当前格情境操作区（日志下方、主操作区上方） -->
              <TileContextBar />
              <!-- 主操作区：移动/探索/倾向/目标（始终显示） -->
              <div class="action-subtitle">主操作 · 始终显示</div>
              <MainActionBar variant="desktop" />
            </div>
          </div>
        </div>
      </template>

      <!-- ═══ 手机横屏 compact：地图主区 + 右紧凑标签 + 底部主操作区 ═══ -->
      <template v-else>
        <div class="flex-1 flex min-h-0">
          <!-- 地图主区 -->
          <MapContainer class="flex-1 min-w-0" />

          <!-- 右侧紧凑：标签切换（战报 / 当前格） -->
          <div class="flex flex-col w-[34%] min-w-0">
            <div class="flex gap-3 px-2 py-1 border-b border-fg-dim/30 flex-none">
              <button
                class="inv-tab"
                :class="{ active: explore.mobileTab === 'log' }"
                @click="explore.setMobileTab('log')"
              >战报</button>
              <button
                class="inv-tab"
                :class="{ active: explore.mobileTab === 'tile' }"
                @click="explore.setMobileTab('tile')"
              >当前格</button>
            </div>
            <div class="flex-1 min-h-0 p-2 overflow-hidden">
              <LogPanel v-if="explore.mobileTab === 'log'" />
              <TileContextBar v-else />
            </div>
          </div>
        </div>

        <!-- 主操作区固定底部安全区 -->
        <div class="flex-none border-t border-fg-dim/30 px-2 py-1.5 explore-mobile-actions">
          <MainActionBar variant="mobile" />
        </div>
      </template>
    </div>

    <!-- ═══ RIGHT PUSH: InventoryDrawer（背包抽屉，关闭时 flex-basis:0） ═══ -->
    <InventoryDrawer />
  </div>
</template>

<style scoped>
.explore-root {
  background: #000;
}

/* 手机横屏底部主操作区背景（与抽屉一致的暗底） */
.explore-mobile-actions {
  background: #0a0a0a;
}

/* 标签按钮样式（复用现有 .inv-tab 全局样式，此处仅占位以保证作用域隔离） */
:deep(.inv-tab) {
  cursor: pointer;
}
</style>
