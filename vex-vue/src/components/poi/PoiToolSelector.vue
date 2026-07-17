<script setup lang="ts">
/**
 * @module L Vue 组件
 * @framework L-9 POI 交互模态框
 */
// ══════════════════════════════════════════════════
// POI 工具选择器 / POI Tool Selector
//
// L-9 POI 交互模态框的右侧"可用工具/技能"区（设计案 §4.2）。
//
// 单选 tool_id / skill_id，对齐后端 obl_command_contract.php 的 payload_schema
// （单值字符串，非数组）。玩家可选 0 或 1 件工具，选中后通过 poiStore.setToolId
// 写入 selectedToolId，由 poiStore.doSearch 透传到 poi.search payload。
//
// 工具列表派生自 inventoryStore.slots（响应式），玩家在 POI 模态框外消耗工具时
// 自动从列表移除；若选中的工具被消耗，selectedToolId 自动清空（设计案 §2.11 边界 9）。
//
// 技能选择暂未实现：前端无 skillStore，后端 skill_list scope 由战斗 UI 消费，
// POI 模态框暂不需要技能路由。待后续落地 skillStore 后扩展。
//
// 相关文档：oblivions/docs/搜索建筑物与掉落机制重构-模块L-POI交互界面.md §2.3 §2.4.1 §2.5
// ══════════════════════════════════════════════════

import { computed, watch } from 'vue';
import { usePoiStore } from '@/stores/poi';
import { useInventoryStore } from '@/stores/inventory';
import { getItemName, isInfinite } from '@/data/item-locale';
import { getItmkName } from '@/data/itmk-locale';
import type { InventoryItem } from '@/types/api';

const poiStore = usePoiStore();
const inventoryStore = useInventoryStore();

// ── 派生状态 ──
const selectedToolId = computed(() => poiStore.selectedToolId);
const currentPoi = computed(() => poiStore.currentPoi);

/**
 * 当前 POI 接受的有效工具 ID 集合
 * （prob_mods_source ∪ loot_table_overrides keys，并集即"可改良本 POI 的工具"）
 */
const effectiveToolIds = computed<Set<string>>(() => {
  const poi = currentPoi.value;
  if (!poi) return new Set<string>();
  const ids = new Set<string>();
  (poi.prob_mods_source || []).forEach(id => ids.add(id));
  (poi.loot_table_overrides || []).forEach(id => ids.add(id));
  return ids;
});

/** 当前 POI 是否接受任何工具改良 */
const hasEffectiveTools = computed<boolean>(() => effectiveToolIds.value.size > 0);

/**
 * 当前 POI 可用的工具槽位列表
 * - POI 不接受任何工具 → 返回空（template 显示"此 POI 不接受工具改良"）
 * - POI 接受特定工具 → 仅显示在白名单中且非空的背包槽位
 *   （避免无关道具污染注意力，设计案 §2.4.1 工具有效性约束）
 */
const nonEmptySlots = computed<InventoryItem[]>(() => {
  if (!hasEffectiveTools.value) return [];
  return inventoryStore.slots.filter(s => {
    if (s.empty) return false;
    const tid = s.itmid || s.item_id;
    return !!tid && effectiveToolIds.value.has(tid);
  });
});

/**
 * 当前选中的工具对应的背包槽位号（用于列表高亮）
 * 通过 itmid 反查，避免依赖 slot（后端 payload 只接收 tool_id 字符串）
 */
const selectedSlot = computed<number | null>(() => {
  const tid = selectedToolId.value;
  if (!tid) return null;
  for (const inv of nonEmptySlots.value) {
    if ((inv.itmid || inv.item_id) === tid) return inv.slot;
  }
  return null;
});

// ── 边界 9：选中的工具被消耗时自动清空 selectedToolId ──
watch(
  () => nonEmptySlots.value,
  (slots) => {
    const tid = selectedToolId.value;
    if (!tid) return;
    const stillExists = slots.some(inv => (inv.itmid || inv.item_id) === tid);
    if (!stillExists) {
      poiStore.clearToolId();
    }
  },
);

// ── 辅助渲染 ──

function slotDisplayName(item: InventoryItem): string {
  return getItemName(item.itmid || item.item_id, item.name);
}

function slotMeta(item: InventoryItem): string {
  const dur = item.durability;
  const label = isInfinite(dur) ? '∞' : String(dur ?? '0');
  return item.stack ? `数量：${label}` : `耐久：${label}`;
}

function isSlotSelected(slot: number): boolean {
  return selectedSlot.value === slot;
}

// ── 事件处理 ──

function onSelectTool(inv: InventoryItem): void {
  const tid = inv.itmid || inv.item_id;
  if (!tid) return;
  if (selectedToolId.value === tid) {
    // 再次点击同一工具 → 取消选择
    poiStore.clearToolId();
  } else {
    poiStore.setToolId(tid);
  }
}

function onClearTool(): void {
  poiStore.clearToolId();
}
</script>

<template>
  <div class="poi-tool-selector">
    <div class="ascii-title">
      <span class="ascii-label">可用工具/技能</span>
      <span class="ascii-line" style="flex:1"></span>
    </div>

    <div class="tool-list">
      <div v-if="nonEmptySlots.length === 0" class="dim tool-empty">
        <template v-if="!hasEffectiveTools">此 POI 不接受工具改良</template>
        <template v-else>背包中没有该 POI 可用的工具</template>
      </div>
      <div
        v-for="inv in nonEmptySlots"
        :key="inv.slot"
        class="tool-row"
        :class="{ selected: isSlotSelected(inv.slot) }"
        @click="onSelectTool(inv)"
      >
        <span class="tool-check">{{ isSlotSelected(inv.slot) ? '[x]' : '[ ]' }}</span>
        <span class="tool-slot">[{{ inv.slot }}]</span>
        <span class="tool-name">{{ slotDisplayName(inv) }}</span>
        <span v-if="inv.kind" class="tool-itmk dim">{{ getItmkName(inv.kind) }}</span>
        <span class="tool-meta dim">{{ slotMeta(inv) }}</span>
      </div>
    </div>

    <!-- 技能区占位（无 skillStore 时显示空状态） -->
    <div class="skill-section">
      <div class="ascii-title">
        <span class="ascii-label">技能</span>
        <span class="ascii-line" style="flex:1"></span>
      </div>
      <div class="dim skill-empty">
        技能系统未接入
      </div>
    </div>

    <div v-if="selectedToolId" class="tool-selected-hint">
      <span class="dim">已选：</span>
      <span class="tool-selected-id">{{ selectedToolId }}</span>
      <button class="clear-btn" @click.stop="onClearTool">[清除]</button>
    </div>
    <div class="dim tool-hint">
      选择一件道具作为搜索工具（部分 POI 支持工具路由改良掉落表）
    </div>
  </div>
</template>

<style scoped>
.poi-tool-selector {
  display: flex;
  flex-direction: column;
  gap: 6px;
  height: 100%;
  overflow: hidden;
}

.ascii-title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
  font-size: 10px;
  color: #666;
}

.ascii-label {
  flex: 0 0 auto;
}

.ascii-line {
  height: 1px;
  background: rgba(68, 68, 68, 0.3);
}

.tool-list {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
  min-height: 60px;
}

.tool-empty {
  font-size: 10px;
  padding: 6px;
  text-align: center;
}

.tool-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 4px;
  font-size: 11px;
  cursor: pointer;
  border: 1px solid transparent;
  transition: background 0.12s, border-color 0.12s;
  user-select: none;
}

.tool-row:hover {
  background: rgba(255, 255, 255, 0.05);
  border-color: rgba(68, 68, 68, 0.3);
}

.tool-row.selected {
  background: rgba(255, 255, 255, 0.08);
  border-color: #888;
}

.tool-check {
  color: #888;
  flex: 0 0 auto;
}

.tool-row.selected .tool-check {
  color: #fff;
}

.tool-slot {
  color: #888;
  flex: 0 0 auto;
}

.tool-name {
  color: #ddd;
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-itmk {
  font-size: 10px;
  flex: 0 0 auto;
}

.tool-meta {
  color: #666;
  font-size: 10px;
  flex: 0 0 auto;
  white-space: nowrap;
}

.skill-section {
  flex: 0 0 auto;
  margin-top: 4px;
  padding-top: 4px;
  border-top: 1px dashed rgba(68, 68, 68, 0.3);
}

.skill-empty {
  font-size: 10px;
  padding: 6px;
  text-align: center;
}

.tool-selected-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 4px;
  font-size: 11px;
  color: #ddd;
  flex: 0 0 auto;
  border-top: 1px dashed rgba(68, 68, 68, 0.3);
}

.tool-selected-id {
  flex: 1 1 auto;
  color: #ddd;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.clear-btn {
  background: none;
  border: 1px solid #555;
  color: #888;
  cursor: pointer;
  font-family: inherit;
  font-size: 10px;
  padding: 0 4px;
  flex: 0 0 auto;
  transition: background 0.12s, color 0.12s;
}

.clear-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

.tool-hint {
  font-size: 10px;
  padding: 4px 2px;
  text-align: center;
  flex: 0 0 auto;
}

.dim {
  color: #555;
}
</style>
