<script setup lang="ts">
/**
 * @module L Vue 组件
 * @framework L-9 POI 交互模态框
 */
// ══════════════════════════════════════════════════
// POI 模态框根容器 / POI Modal Root
//
// L-9 POI 交互模态框的双态切换容器：
//   - 列表态（modalMode='list'）：v-for 渲染当前格 POI 卡片（纵列布局）
//   - 交互态（modalMode='interaction'）：渲染 PoiInteraction 子组件（四区布局）
//
// 由 poiStore.modalOpen 控制整体可见，poiStore.modalMode 控制内部态。
// 态切换由 store action 驱动而非组件内部 ref，便于命令响应回调强制切换态。
//
// Teleport to body 与 CraftModal 同模式，避免被父容器 overflow 裁剪。
//
// 相关文档：oblivions/docs/搜索建筑物与掉落机制重构-模块L-POI交互界面.md §2.3
// ══════════════════════════════════════════════════

import { computed, watch } from 'vue';
import { usePoiStore } from '@/stores/poi';
import { getPoiName, getPoiDesc } from '@/data/poi-locale';
import type { Poi } from '@/types/api';
import PoiInteraction from './PoiInteraction.vue';

const poiStore = usePoiStore();

// ── 派生状态 ──
const modalOpen = computed(() => poiStore.modalOpen);
const modalMode = computed(() => poiStore.modalMode);
const poiList = computed(() => poiStore.poiList);
const currentPoi = computed(() => poiStore.currentPoi);

// ── 问题4 方案2：交互态下 currentPoi 变 null 时自动关闭模态框 ──
// 场景：玩家点击拆除时 POI 已被 E-12 异步清理 / 其他玩家拆除 / 跨命令并发删除，
// 命令返回后 tile_actions 刷新使 currentPoi 自然变 null，交互态会渲染空白。
// 此时模态框已无内容可显示，自动关闭让玩家返回列表态/探索界面。
watch(
  () => currentPoi.value,
  (poi) => {
    if (modalOpen.value && modalMode.value === 'interaction' && poi === null) {
      poiStore.closeModal();
    }
  },
);

// ── 列表态卡片辅助渲染 ──

function poiDisplayName(poi: Poi): string {
  return getPoiName(poi.poi_id, poi.name);
}

function poiDisplayDesc(poi: Poi): string {
  return getPoiDesc(poi.poi_id, poi.desc);
}

/**
 * POI 状态徽章：按 state 字段映射到中文标签
 * idle → 按 POI 类型派生（交互型/搜刮型/机制型/地标型）
 * searched → 已搜索 / cooldown → 冷却中 / exhausted → 已搜空 / locked → 已上锁 / ignited → 已点燃
 * 兼容旧字段 fallback：searchable=false 时显示"地标"
 *
 * 类型判定优先级（与 poiActionButtonText 一致）：
 *   1. F-6 交互型（mechanic 以 interact_ 开头）→ "交互型"
 *   2. 搜刮型（searchable=true 且无 mechanic）→ "可搜索"
 *   3. 机制型（mechanic 非空且不以 interact_ 开头）→ "机制型"
 *   4. 地标型（其他）→ "地标"
 */
function poiStateBadge(poi: Poi): string {
  const state = poi.state;
  if (state === 'exhausted') return '已搜空';
  if (state === 'cooldown') return '冷却中';
  if (state === 'searched') return '已搜索';
  if (state === 'locked') return '已上锁';
  if (state === 'ignited') return '已点燃';
  if (state === 'idle') {
    return poiTypeLabel(poi);
  }
  // state 缺失时 fallback 到旧字段
  if (poi.searched) return '已搜索';
  if (poi.searchable) return '可搜索';
  return '地标';
}

/**
 * POI 类型标签（idle 态下用作徽章文案）
 * 与 poiActionButtonText 的判定基准一致，确保列表态徽章与操作按钮语义对齐
 */
function poiTypeLabel(poi: Poi): string {
  const mechanic = poi.mechanic;
  if (mechanic) {
    if (mechanic.startsWith('interact_')) return '交互型';
    return '机制型';
  }
  if (poi.searchable) return '可搜索';
  return '地标';
}

/**
 * POI 卡片操作按钮文案：按 POI 类型动态化（设计案 §3.2.2）
 * - 搜刮型（searchable=true 且无 mechanic）→ [搜刮]
 * - F-6 交互型（mechanic 以 interact_ 前缀开头）→ [交互]
 * - 机制型（mechanic 非空且不以 interact_ 开头，如 max_hp_up/learn_skill/craft_source）→ [触碰]
 * - 地标型（!searchable 且 !mechanic）→ [检查]
 */
function poiActionButtonText(poi: Poi): string {
  const mechanic = poi.mechanic;
  if (mechanic) {
    if (mechanic.startsWith('interact_')) return '[交互]';
    return '[触碰]';
  }
  if (poi.searchable) return '[搜刮]';
  return '[检查]';
}

/** 状态徽章附加信息（耐久剩余 / 搜索次数 / 冷却剩余 / 未拾取道具计数） */
function poiBadgeMeta(poi: Poi): string {
  const parts: string[] = [];
  // E-12 耐久剩余（仅 ttl_days > 0 的玩家放置 POI 显示）
  const ttlRemaining = poi.ttl_remaining_days;
  if (ttlRemaining !== null && ttlRemaining !== undefined && ttlRemaining > 0) {
    parts.push(`剩 ${ttlRemaining} 天`);
  }
  if (poi.repeatable) {
    const limit = Number(poi.repeat_limit) || 0;
    const count = Number(poi.search_count) || 0;
    if (limit > 0) parts.push(`${count}/${limit}`);
  }
  if (poi.state === 'cooldown') {
    const remaining = Number(poi.cooldown_remaining_turn) || 0;
    if (remaining > 0) parts.push(`${remaining}tick`);
  }
  const itemCount = (poi.items || []).length;
  if (itemCount > 0) parts.push(`${itemCount}个物品`);
  return parts.join(' ');
}

// ── 事件处理 ──

function onOverlayClick(e: MouseEvent): void {
  if (e.target === e.currentTarget) {
    poiStore.closeModal();
  }
}

function onClose(): void {
  poiStore.closeModal();
}

function onEnterInteraction(iaid: string | number): void {
  poiStore.enterInteraction(iaid);
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="modalOpen"
      class="modal-overlay open"
      @click="onOverlayClick"
    >
      <div class="modal poi-modal" :class="{ 'is-interaction': modalMode === 'interaction' }">
        <div class="modal-header">
          <span class="modal-title">POI</span>
          <button class="modal-close" @click="onClose">[X]</button>
        </div>

        <div class="modal-body">
          <!-- ── 列表态：POI 卡片列表（纵列布局，每张卡片含名称+徽章+操作按钮） ── -->
          <div v-if="modalMode === 'list'" class="poi-list">
            <div v-if="poiList.length === 0" class="tile-empty">
              此处无可交互建筑物
            </div>
            <div
              v-for="poi in poiList"
              :key="poi.iaid"
              class="poi-card"
            >
              <div class="poi-card-info">
                <div class="poi-card-name">
                  <span class="poi-card-title">{{ poiDisplayName(poi) }}</span>
                  <span class="poi-badge" :class="`is-${poi.state || 'idle'}`">
                    {{ poiStateBadge(poi) }}
                  </span>
                  <span v-if="poiBadgeMeta(poi)" class="poi-badge-meta dim">{{ poiBadgeMeta(poi) }}</span>
                </div>
                <div class="poi-card-desc dim">{{ poiDisplayDesc(poi) }}</div>
              </div>
              <button
                class="term-btn poi-check-btn"
                @click="onEnterInteraction(poi.iaid)"
              >{{ poiActionButtonText(poi) }}</button>
            </div>
          </div>

          <!-- ── 交互态：PoiInteraction 子组件（四区布局） ── -->
          <PoiInteraction v-else-if="modalMode === 'interaction'" />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* 列表态：520px 宽度容纳名称+徽章+按钮 */
.poi-modal {
  position: relative;
  box-sizing: border-box;
  width: 520px;
  max-width: 92vw;
  padding: 12px;
}

/* 交互态：放宽至 90vw / 980px 以容纳三列四区布局 */
.poi-modal.is-interaction {
  width: 90vw;
  max-width: 980px;
}

.modal-body {
  max-height: 80vh;
  overflow-y: auto;
}

/* ── 列表态卡片（纵列布局，每张卡片独立带操作按钮） ── */
.poi-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.poi-card {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid rgba(68, 68, 68, 0.3);
  transition: border-color 0.12s, background 0.12s;
}

.poi-card:hover {
  border-color: rgba(68, 68, 68, 0.6);
  background: rgba(255, 255, 255, 0.02);
}

.poi-card-info {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.poi-card-name {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.poi-card-title {
  color: #ddd;
  font-size: 12px;
  font-weight: 700;
}

.poi-badge {
  flex: 0 0 auto;
  padding: 1px 6px;
  font-size: 10px;
  color: #888;
  border: 1px solid rgba(68, 68, 68, 0.5);
  white-space: nowrap;
}

.poi-badge.is-idle {
  color: #ddd;
  border-color: #888;
}

.poi-badge.is-searched {
  color: #666;
}

.poi-badge.is-cooldown {
  color: #888;
  border-style: dashed;
}

.poi-badge.is-exhausted {
  color: #444;
  border-color: rgba(68, 68, 68, 0.3);
}

.poi-badge-meta {
  color: #555;
  font-size: 10px;
  flex: 0 0 auto;
}

.poi-card-desc {
  color: #555;
  font-size: 10px;
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.poi-check-btn {
  flex: 0 0 auto;
  padding: 4px 12px;
  font-size: 11px;
}

.poi-check-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.15);
  color: #fff;
}

.dim {
  color: #555;
}

.tile-empty {
  color: #555;
  font-size: 11px;
  padding: 8px;
  text-align: center;
  border: 1px dashed rgba(68, 68, 68, 0.3);
}
</style>
