<script setup lang="ts">
/**
 * @module L Vue 组件
 */
// ══════════════════════════════════════════════════
// DiscoveryModal — 发现合并模态（F-K5-Feedback §5.3 / 设计案 §7.8 / §6.2 / §4.12）
//
// 不变量：
//   1. 同次信息获取多重要发现合并为一个模态（§7.8 不变量 6）
//   2. 已发现内容不重复弹首次发现模态（§7.8 不变量 7，由 discovery-store 过滤）
//   3. 普通道具不弹模态（§7.8 不变量 8，由 discovery-store 过滤）
//   4. 敌人批量合并（§7.8 不变量 10，按 enemy 分组展示）
//   5. POI / 关键道具模态可"一键前往"：只创建临时目标，不自动互动/拾取（§7.8 不变量 11，B4.13）
//   6. 已发现敌人不会自动开战（§5.11/§6.3，由玩家决定）
//
// 触发源：
//   3.4 移动导演调用 discovery.dispatchAttention(level, payload)：
//     - 'important' 级别 → discovery-store 打开模态（pausePlayback）
//     - 'item' 级别 → discovery-store 显示 Toast，不弹模态
//     - 'force' 级别 → 移动导演负责反馈，不弹模态
//
// 按钮：
//   - 含敌人：[继续]（关闭模态，玩家保持探索态决策） + [进入战斗预装填]（场景交接）
//   - 仅 POI/关键道具：[继续] + [一键前往]（仅创建临时目标，B4.13）
//
// 卸载清理（§4.7）：
//   本组件无定时器、无事件监听、无回调引用——状态全部由 discovery-store 管理（会话级）。
//   组件卸载时不主动关闭模态（模态状态由玩家决策驱动）。
//   仅在场景切换到战斗时自动关闭（避免战斗场景上方残留探索反馈模态）。
// ══════════════════════════════════════════════════

import { watch, onBeforeUnmount } from 'vue';
import { useDiscoveryStore } from '@/stores/discovery-store';
import { useExploreStore } from '@/stores/explore-store';
import { useBattleStore } from '@/stores/battle';
import { useSceneStore } from '@/stores/scene-store';

const discovery = useDiscoveryStore();
const explore = useExploreStore();
const battleStore = useBattleStore();
const sceneStore = useSceneStore();

// ── 场景安全网：进入战斗场景时自动关闭发现模态 ──
// 场景：强制事件触发战斗交接时，发现模态可能仍处于打开状态
// 此时模态应立即关闭，避免战斗场景上方残留探索反馈模态
watch(
  () => sceneStore.isBattle,
  (isBattle) => {
    if (isBattle && discovery.open) {
      discovery.closeModal();
    }
  },
);

// ── 按钮动作 ──

/** 关闭模态（玩家选择暂不行动） */
function onContinue(): void {
  discovery.closeModal();
}

/**
 * "一键前往"：仅创建临时目标，不自动互动/拾取（§7.8 不变量 11，B4.13）。
 * 优先级：POI > 关键道具。如果同时有多个，取第一个。
 */
function onNavigateTo(): void {
  const target = discovery.poiItems[0] ?? discovery.keyItemItems[0];
  if (!target) return;
  explore.setTarget(target.pls, target.name);
  discovery.closeModal();
}

/**
 * "进入战斗预装填"：进入战斗场景（B4.3，§6.5 预装填）。
 * 仅在含敌人时显示。使用首个敌人的 PID 进入战斗。
 */
function onEnterCombatPreload(): void {
  const firstEnemy = discovery.enemyItems[0];
  const enemyPid = firstEnemy?.pid ?? 0;
  discovery.closeModal();
  battleStore.startBattle(enemyPid);
}

// ── 卸载清理（§4.7） ──
// 本组件无定时器、无事件监听、无回调引用。
// discovery-store 是会话级的，不在此强制清理。
// watch 自动随组件卸载而注销（Vue 内置）。
onBeforeUnmount(() => {
  // 无需手动清理：无 setTimeout/setInterval、无 dataManager.listen、无外部回调
});
</script>

<template>
  <Teleport to="body">
    <Transition name="dm-fade">
      <div v-if="discovery.open" class="discovery-modal-overlay">
        <div class="discovery-modal-card">
          <!-- ═══ 标题区 ═══ -->
          <div class="dm-header">
            <span class="dm-glyph">⚠</span>
            <span class="dm-title">{{ discovery.title }}</span>
          </div>
          <div v-if="discovery.subtitle" class="dm-subtitle">{{ discovery.subtitle }}</div>

          <!-- ═══ 分组展示区（按注意力等级 + 类型分组，§13.7 长文本可滚动） ═══ -->
          <div class="dm-body">
            <div
              v-for="g in discovery.groups"
              :key="g.key"
              class="dm-group"
              :class="`grp-${g.key}`"
            >
              <div class="dm-group-label">{{ g.label }}</div>
              <div class="dm-group-items">
                <div
                  v-for="item in g.items"
                  :key="item.id"
                  class="dm-item"
                >
                  <span class="dm-item-glyph">
                    <template v-if="item.kind === 'enemy'">E</template>
                    <template v-else-if="item.kind === 'poi'">P</template>
                    <template v-else-if="item.kind === 'key_item'">K</template>
                    <template v-else>$</template>
                  </span>
                  <span class="dm-item-name">{{ item.name }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- ═══ 提示区 ═══ -->
          <div v-if="discovery.hasEnemy" class="dm-hint">
            已发现敌人不会自动开战（§5.11/§6.3），由你决定下一步
          </div>

          <!-- ═══ 按钮区（按场景动态切换文案） ═══ -->
          <div class="dm-actions">
            <button class="term-btn dm-btn dm-btn-secondary" @click="onContinue">
              [{{ discovery.hasEnemy ? '继续 · 保持探索' : '继续' }}]
            </button>
            <button
              v-if="discovery.hasEnemy"
              class="term-btn dm-btn dm-btn-primary"
              @click="onEnterCombatPreload"
            >[进入战斗预装填]</button>
            <button
              v-else-if="discovery.hasNavigable"
              class="term-btn dm-btn dm-btn-primary"
              @click="onNavigateTo"
            >[一键前往]</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.discovery-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 440; /* 低于全局 modal-overlay(450)，高于 move-director 与 atlas(20) */
  background: rgba(0, 0, 0, 0.78);
  display: flex;
  align-items: center;
  justify-content: center;
  backdrop-filter: blur(2px);
}

.discovery-modal-card {
  width: min(380px, 92%);
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  border: 1px solid rgba(255, 255, 255, 0.45);
  box-shadow: 2px 2px 0 rgba(0, 0, 0, 0.5);
  background: #0a0a0a;
  padding: 14px 16px;
}

/* ═══ 标题区 ═══ */
.dm-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}
.dm-glyph {
  color: #fff;
  font-size: 14px;
  font-weight: 900;
}
.dm-title {
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.06em;
  word-break: break-word;
}
.dm-subtitle {
  color: #777;
  font-size: 10px;
  line-height: 1.5;
  margin-bottom: 8px;
  padding-bottom: 6px;
  border-bottom: 1px solid rgba(68, 68, 68, 0.3);
  word-break: break-word;
}

/* ═══ 分组展示区 ═══ */
.dm-body {
  flex: 1 1 auto;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-right: 2px;
}
.dm-group {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.dm-group-label {
  color: #888;
  font-size: 10px;
  letter-spacing: 0.1em;
  border-bottom: 1px dashed rgba(68, 68, 68, 0.35);
  padding-bottom: 2px;
}
.grp-enemy .dm-group-label {
  color: #fff;
  border-bottom-color: rgba(255, 255, 255, 0.35);
}
.dm-group-items {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.dm-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 6px;
  border: 1px solid rgba(68, 68, 68, 0.4);
  font-size: 11px;
  color: #ccc;
}
.dm-item-glyph {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border: 1px solid currentColor;
  font-size: 10px;
  font-weight: 700;
  color: #aaa;
  flex: 0 0 auto;
}
.grp-enemy .dm-item-glyph {
  color: #fff;
}
.grp-enemy .dm-item {
  border-color: rgba(255, 255, 255, 0.35);
  color: #fff;
}
.grp-key_item .dm-item-glyph {
  color: #fff;
}
.dm-item-name {
  flex: 1 1 auto;
  word-break: break-word;
}

/* ═══ 提示区 ═══ */
.dm-hint {
  color: #666;
  font-size: 9px;
  letter-spacing: 0.04em;
  margin-top: 8px;
  padding-top: 6px;
  border-top: 1px solid rgba(68, 68, 68, 0.3);
  line-height: 1.4;
}

/* ═══ 按钮区 ═══ */
.dm-actions {
  display: flex;
  gap: 6px;
  margin-top: 10px;
}
.dm-btn {
  flex: 1;
  padding: 7px 10px;
  font-size: 11px;
  cursor: pointer;
  text-align: center;
}
.dm-btn-secondary {
  border-color: rgba(136, 136, 136, 0.5);
  color: #aaa;
}
.dm-btn-secondary:hover {
  border-color: #ddd;
  color: #ddd;
}
.dm-btn-primary {
  border-color: #fff;
  color: #fff;
  background: rgba(255, 255, 255, 0.06);
}
.dm-btn-primary:hover {
  background: rgba(255, 255, 255, 0.12);
}

/* ═══ 过渡（灰阶，§2.15） ═══ */
.dm-fade-enter-active {
  transition: opacity 0.2s ease;
}
.dm-fade-leave-active {
  transition: opacity 0.15s ease;
}
.dm-fade-enter-from,
.dm-fade-leave-to {
  opacity: 0;
}
</style>
