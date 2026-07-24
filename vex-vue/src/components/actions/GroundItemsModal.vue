<script setup lang="ts">
/**
 * @module L Vue 组件
 * @framework L-1 统一交互列表模式
 */
// ══════════════════════════════════════════════════
// 脚边道具模态框 / Ground Items Modal
//
// F-K1-Scenes 改造后从 TileActionBar 拆出的浮动层模态框：
//   - TileContextBar 只渲染 [拾取] 按钮入口（onCheckGround → openGroundModal）
//   - 本组件订阅 tileActionStore.modalOpen && modalType==='ground' 渲染列表
//   - 全局浮动层（App.vue）挂载，Teleport to body 避免被场景容器裁剪
//   - 三场景（战斗/探索/Atlas）通用，不被场景 Transition 切断
//
// 交互（对齐原 TileActionBar ground 模态框逻辑）：
//   - 逐个拾取：每项 [拾取] 按钮 → handlePickup(iid)，store 刷新后列表自动更新
//   - 全部拾取：底部 [全部拾取] → handlePickupAll(items)，store 在 finally 中 closeModal
//   - 关闭：[X] / 点击遮罩 → closeModal()
//   - 防御：ground 模态框打开但列表变空时自动关闭（拾取最后一件后）
//
// 相关文档：oblivions/Dian.md F-K1-Scenes / B-K1-Scenes
// ══════════════════════════════════════════════════

import { computed, watch } from 'vue';
import { useTileActionStore } from '@/stores/tileAction';
import { commandQueue } from '@/stores/command-queue';
import type { GroundItem } from '@/types/api';
import { getItemName, isInfinite } from '@/data/item-locale';
import { getItmkName } from '@/data/itmk-locale';

const tileActionStore = useTileActionStore();

// ── 派生状态（精确订阅 ground 模态框，不误订阅 poi） ──
const isOpen = computed<boolean>(
  () => tileActionStore.modalOpen && tileActionStore.modalType === 'ground',
);
const modalTitle = computed<string>(() => tileActionStore.modalTitle);
const modalItems = computed<GroundItem[]>(() => tileActionStore.modalItems);

// ── 防御：ground 模态框打开但列表变空时自动关闭 ──
// 场景：逐个拾取取走最后一件后 groundItems 刷新为空，
// 此时模态框已无内容可显示，自动关闭让玩家返回探索界面。
// openGroundModal 内已有空列表 guard，此处只处理"打开后变空"的边界。
watch(
  () => isOpen.value && modalItems.value.length === 0,
  (empty) => {
    if (empty) {
      tileActionStore.closeModal();
    }
  },
);

// ── 交互处理 ──

function onOverlayClick(e: MouseEvent): void {
  if (e.target === e.currentTarget) {
    tileActionStore.closeModal();
  }
}

function onClose(): void {
  tileActionStore.closeModal();
}

function onPickup(iid: string | number): void {
  tileActionStore.handlePickup(iid);
}

function onPickupAll(): void {
  tileActionStore.handlePickupAll(modalItems.value);
}

// ── 道具渲染辅助（迁移自原 TileActionBar，保持显示一致） ──

/** 道具显示名：discovered===2 用伪装名（？），否则自定义名优先，最后回退 locale */
function itemDisplayName(item: GroundItem): string {
  if (item.discovered === 2) {
    const displayId = item.fake_item_id || item.item_id;
    const maskedName = displayId
      ? getItemName(displayId)
      : (item.display_name?.replace(/（？）$/, '') || '');
    return maskedName ? maskedName + '（？）' : '未知物品（？）';
  }
  const customName = item.itm?.trim();
  if (customName) return customName;
  return getItemName(item.item_id) || item.name || '';
}

/** discovered!==2 时显示 itmk + itme/itms 元信息 */
function showItemMeta(item: GroundItem): boolean {
  return item.discovered !== 2;
}

/** 效/耐 分数格式（如 5/10、30/∞） */
function itemMeta(item: GroundItem): string {
  const eff = String(item.itme ?? '0');
  const rawDur = String(item.itms ?? '');
  const dur = isInfinite(rawDur) ? '∞' : rawDur;
  return `${eff}/${dur}`;
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="isOpen"
      class="modal-overlay open"
      @click="onOverlayClick"
    >
      <div class="modal ground-modal">
        <div class="modal-header">
          <span class="modal-title">{{ modalTitle }}</span>
          <button class="modal-close" @click="onClose">[X]</button>
        </div>

        <div class="modal-body">
          <div class="ground-list">
            <div
              v-for="item in modalItems"
              :key="item.iid"
              class="ground-item"
            >
              <div class="ground-item-info">
                <span class="item-name">{{ itemDisplayName(item) }}</span>
                <span v-if="showItemMeta(item)" class="item-meta">
                  {{ getItmkName(item.itmk) }} {{ itemMeta(item) }}
                </span>
              </div>
              <button
                class="term-btn ground-pickup-btn"
                :disabled="!commandQueue.canExecute('item.pickup')"
                @click="onPickup(item.iid)"
              >[拾取]</button>
            </div>
          </div>
        </div>

        <div class="modal-footer">
          <button
            class="term-btn"
            :disabled="!commandQueue.canExecute('item.pickup')"
            @click="onPickupAll"
          >[全部拾取]</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* 脚边道具模态框：窄宽，与 Itm0Modal 同量级 */
.ground-modal {
  position: relative;
  box-sizing: border-box;
  width: 360px;
  max-width: 92vw;
  padding: 12px;
}

.modal-body {
  max-height: 70vh;
  overflow-y: auto;
}

/* ── 道具列表（纵列卡片：信息 + 拾取按钮，对齐 PoiModal 列表态卡片样式约定） ── */
.ground-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ground-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: 1px solid rgba(68, 68, 68, 0.3);
  transition: border-color 0.12s, background 0.12s;
}

.ground-item:hover {
  border-color: rgba(68, 68, 68, 0.6);
  background: rgba(255, 255, 255, 0.02);
}

.ground-item-info {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.item-name {
  color: #ddd;
  font-size: 12px;
  font-weight: 700;
}

.item-meta {
  color: #666;
  font-size: 10px;
  white-space: nowrap;
}

.ground-pickup-btn {
  flex: 0 0 auto;
  padding: 4px 12px;
  font-size: 11px;
}

.ground-pickup-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.15);
  color: #fff;
}
</style>
