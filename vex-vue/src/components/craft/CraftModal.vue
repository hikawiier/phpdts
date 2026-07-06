<script setup lang="ts">
// ══════════════════════════════════════════════════
// 合成模态框 / Craft Modal
//
// 三列布局合成界面（设计案 §3）：
//   左（参考 25%）：配方列表 CraftRecipeList
//   中（状态 30%）：① 素材池 + ④ 反馈
//   右（操作 45%）：② 背包素材 + ③ 工作台候选 + 合成按钮
//
// itm0 锁定态（§8.6）：②③ 禁用 + ④ 显示锁定提示 +
//   合成按钮替换为 [尝试堆叠合并] / [丢到地上]
//
// 反馈区渲染（§3.4）：构造 fake LogEntry 复用 renderLogEntry
//
// 相关文档：oblivions/docs/vex-vue-合成界面设计案.md
// ══════════════════════════════════════════════════

import { computed, watch, onUnmounted } from 'vue';
import { useCraftStore, itemMatchesMaterial } from '@/stores/craft';
import { useInventoryStore } from '@/stores/inventory';
import { commandQueue } from '@/stores/command-queue';
import { renderLogEntry } from '@/data/log-templates';
import { getItemName, isInfinite } from '@/data/item-locale';
import { getItmkName } from '@/data/itmk-locale';
import { getRecipeName } from '@/data/recipe-locale';
import type {
  LogEntry,
  InventoryItem,
  WorkbenchMaterial,
  CraftMaterial,
} from '@/types/api';
import CraftRecipeList from './CraftRecipeList.vue';

const craftStore = useCraftStore();
const inventoryStore = useInventoryStore();

// ── 派生状态 ──
const craftModalOpen = computed(() => craftStore.craftModalOpen);
const loading = computed(() => craftStore.loading);
const previewLoading = computed(() => craftStore.previewLoading);
const itm0Locked = computed(() => craftStore.itm0Locked);

const inventorySlots = computed<InventoryItem[]>(() => inventoryStore.slots);
const nonEmptySlots = computed(() => inventorySlots.value.filter(s => !s.empty));

/** 已选背包槽位 + join inventory 数据 + 预计算匹配的 material（§8.5 消耗提示） */
const selectedBackpackSlots = computed(() => {
  return craftStore.backpackSlots.map(bs => {
    const inv = inventoryStore.slots.find(i => i.slot === bs.slot);
    const mat = findMatchingMaterial(bs.slot);
    return { slot: bs.slot, count: bs.count, inv, mat };
  });
});

/** 工作台素材按 source 分组（§3.2 ③） */
const wbMaterialsBySource = computed<Record<string, WorkbenchMaterial[]>>(() => {
  const groups: Record<string, WorkbenchMaterial[]> = {};
  for (const wb of craftStore.availableWbMaterials) {
    const key = wb.source || 'poi';
    if (!groups[key]) groups[key] = [];
    groups[key].push(wb);
  }
  return groups;
});

const hasAnyWb = computed(() => craftStore.availableWbMaterials.length > 0);

// ── 反馈区 HTML（§3.4） ──
const feedbackHtml = computed<string>(() => {
  const log = craftStore.previewLog;
  if (!log) return '';
  // craft.ready：注入配方名，显示"可合成：xxx"
  const params = { ...log.params };
  if (log.id === 'craft.ready' && craftStore.previewResult?.recipe_id) {
    params.recipe_name = getRecipeName(craftStore.previewResult.recipe_id);
  }
  const fakeEntry: LogEntry = {
    id: log.id,
    logcategory: 'system',
    params,
    html: null,
    debug: false,
    ts: 0,
  };
  return renderLogEntry(fakeEntry);
});

/** itm0 锁定态合成结果反馈（覆盖 previewLog，§8.6） */
const lockedFeedbackHtml =
  '<span class="yellow">[!] 合成部分成功，请先处理手持道具</span><br>' +
  '<span class="grey">产物拿在手中，处理后可继续操作</span>';

// ── 消耗计算（match_count=1 时使用，§8.5） ──

/**
 * 在当前匹配配方（previewResult.recipe_id）中查找该背包槽对应的 material
 * @returns material 对象（含 consume / count），无匹配或 match_count≠1 时返回 null
 */
function findMatchingMaterial(slot: number): CraftMaterial | null {
  const recipeId = craftStore.previewResult?.recipe_id;
  if (!recipeId) return null;
  const recipe = craftStore.recipes.find(r => r.recipe_id === recipeId);
  if (!recipe) return null;
  const inv = inventoryStore.slots.find(i => i.slot === slot);
  if (!inv) return null;
  for (const mat of recipe.materials) {
    if (mat.consume === 'none') continue;
    if (itemMatchesMaterial(inv, mat)) return mat;
  }
  return null;
}

/** 数量模型剩余值（durability - count），无限或不可解析返回 null */
function remainCount(dur: string | number | undefined, count: number): number | null {
  if (isInfinite(dur)) return null;
  const total = parseItms(dur);
  if (!Number.isFinite(total)) return null;
  return total - count;
}

// ── 辅助渲染 ──

function parseItms(itms: string | number | undefined): number {
  if (itms === undefined || itms === null || itms === '') return 0;
  if (itms === '∞') return Infinity;
  const n = Number(itms);
  return Number.isFinite(n) ? n : 0;
}

function slotDisplayName(item: InventoryItem): string {
  return getItemName(item.itmid || item.item_id, item.name);
}

/** 道具元信息：数量模型显示 数量：N，耐久模型显示 耐久：N */
function slotMeta(item: InventoryItem): string {
  const dur = item.durability;
  const label = isInfinite(dur) ? '∞' : String(dur ?? '0');
  return item.stack ? `数量：${label}` : `耐久：${label}`;
}

function wbDisplayName(wbId: string): string {
  const wb = craftStore.availableWbMaterials.find(w => w.id === wbId);
  if (!wb) return '?';
  return getItemName(wb.item_id);
}

function wbSourceLabel(source: string): string {
  if (source === 'cat') return '猫身上';
  return 'POI 工作台';
}

function isSlotSelected(slot: number): boolean {
  return craftStore.backpackSlots.some(bs => bs.slot === slot);
}

function isWbSelected(id: string): boolean {
  return craftStore.wbMaterialIds.includes(id);
}

// ── 事件处理 ──

function onOverlayClick(e: MouseEvent): void {
  if (e.target === e.currentTarget) {
    craftStore.closeModal();
  }
}

function onClose(): void {
  craftStore.closeModal();
}

function onClear(): void {
  craftStore.clearSelection();
}

function onToggleBackpack(slot: number): void {
  if (itm0Locked.value) return;
  craftStore.toggleBackpackSlot(slot);
}

function onToggleWb(id: string): void {
  if (itm0Locked.value) return;
  craftStore.toggleWbMaterial(id);
}

function onAdjustCount(slot: number, delta: number): void {
  craftStore.adjustBackpackCount(slot, delta);
}

function onCraft(): void {
  if (commandQueue.isLocked) return;
  void craftStore.doCraft();
}

function onQuickCraft(recipeId: string): void {
  if (itm0Locked.value || commandQueue.isLocked) return;
  void craftStore.quickCraft(recipeId);
}

function onFillMaterials(recipeId: string): void {
  if (itm0Locked.value) return;
  void craftStore.fillRecipeMaterials(recipeId);
}

function onOrganize(): void {
  if (commandQueue.isLocked) return;
  void inventoryStore.handleOrganize();
}

function onDiscardItm0(): void {
  if (commandQueue.isLocked) return;
  void inventoryStore.handleDiscardItm0();
}

// ── 成功 banner 定时器 ──
let _bannerTimer: number | null = null;
watch(
  () => craftStore.successRecipeName,
  (name) => {
    if (name) {
      if (_bannerTimer !== null) clearTimeout(_bannerTimer);
      _bannerTimer = window.setTimeout(() => {
        craftStore.clearSuccessBanner();
        _bannerTimer = null;
      }, 2500);
    }
  },
);
onUnmounted(() => {
  if (_bannerTimer !== null) clearTimeout(_bannerTimer);
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="craftModalOpen"
      class="modal-overlay open"
      @click="onOverlayClick"
    >
      <div class="modal craft-modal">
        <div class="modal-header">
          <span class="modal-title">合成</span>
          <button class="modal-close" @click="onClose">[X]</button>
        </div>

        <Transition name="craft-toast">
          <div v-if="craftStore.successRecipeName" class="craft-toast">
            * 合成成功：{{ craftStore.successRecipeName }}
          </div>
        </Transition>

        <div class="modal-body craft-body">
          <!-- 加载中 -->
          <div v-if="loading" class="loading">loading...</div>

          <div v-else class="craft-columns">
            <!-- ── 左列：配方列表（参考） ── -->
            <div class="craft-col craft-col-left">
              <CraftRecipeList
                :recipes="craftStore.recipes"
                :available-wb-materials="craftStore.availableWbMaterials"
                :inventory-slots="inventorySlots"
                :current-recipe-id="craftStore.previewResult?.recipe_id ?? null"
                @quick-craft="onQuickCraft"
                @fill-materials="onFillMaterials"
              />
            </div>

            <!-- ── 中列：素材池 + 反馈（状态） ── -->
            <div class="craft-col craft-col-middle">
              <!-- ① 素材池 -->
              <div class="pool-section">
                <div class="ascii-title">
                  <span class="ascii-label">素材池</span>
                  <span class="ascii-line" style="flex:1"></span>
                  <button
                    v-if="craftStore.hasSelection"
                    class="clear-btn"
                    @click="onClear"
                  >[清空]</button>
                </div>
                <div v-if="!craftStore.hasSelection" class="dim pool-empty">
                  尚未选择素材
                </div>
                <template v-else>
                  <div
                    v-for="s in selectedBackpackSlots"
                    :key="'bp-' + s.slot"
                    class="pool-row"
                  >
                    <span class="pool-tag">[{{ s.slot }}]</span>
                    <span class="pool-name">{{ s.inv ? slotDisplayName(s.inv) : '?' }}</span>
                    <template v-if="s.inv?.stack">
                      <span class="pool-count">投入 {{ s.count }}</span>
                      <button
                        class="adj-btn"
                        @click="onAdjustCount(s.slot, -1)"
                      >[-]</button>
                      <button
                        class="adj-btn"
                        @click="onAdjustCount(s.slot, 1)"
                      >[+]</button>
                      <span
                        v-if="remainCount(s.inv?.durability, s.count) !== null"
                        class="pool-remain dim"
                      >剩余 {{ remainCount(s.inv?.durability, s.count) }}</span>
                    </template>
                    <template v-else>
                      <span
                        v-if="s.mat?.consume === 'durability'"
                        class="pool-count"
                      >扣 {{ s.mat?.count ?? 1 }} 耐久</span>
                      <span v-else class="pool-count">整槽消耗</span>
                    </template>
                  </div>
                  <div
                    v-for="wbId in craftStore.wbMaterialIds"
                    :key="'wb-' + wbId"
                    class="pool-row"
                  >
                    <span class="pool-tag">[T]</span>
                    <span class="pool-name">{{ wbDisplayName(wbId) }}</span>
                    <span class="pool-count dim">不消耗</span>
                  </div>
                  <div class="pool-total dim">
                    合计 {{ craftStore.backpackSlots.length + craftStore.wbMaterialIds.length }} 件素材
                  </div>
                </template>
              </div>

              <!-- ④ 反馈区 -->
              <div class="feedback-section">
                <div class="ascii-title">
                  <span class="ascii-label">反馈</span>
                  <span class="ascii-line" style="flex:1"></span>
                </div>
                <div
                  v-if="itm0Locked"
                  class="feedback-content log-content"
                  v-html="lockedFeedbackHtml"
                ></div>
                <div v-else-if="previewLoading" class="feedback-content dim">判读中...</div>
                <div
                  v-else
                  class="feedback-content log-content"
                  v-html="feedbackHtml"
                ></div>
              </div>
            </div>

            <!-- ── 右列：背包 + 工作台 + 合成按钮（操作） ── -->
            <div class="craft-col craft-col-right">
              <!-- ② 背包素材列表 -->
              <div class="bp-section" :class="{ locked: itm0Locked }">
                <div class="ascii-title">
                  <span class="ascii-label">背包素材</span>
                  <span class="ascii-line" style="flex:1"></span>
                </div>
                <div class="bp-list">
                  <div
                    v-for="inv in nonEmptySlots"
                    :key="'inv-' + inv.slot"
                    class="bp-row"
                    :class="{ selected: isSlotSelected(inv.slot) }"
                    @click="onToggleBackpack(inv.slot)"
                  >
                    <span class="bp-slot">[{{ inv.slot }}]</span>
                    <span class="bp-name">{{ slotDisplayName(inv) }}</span>
                    <span v-if="inv.kind" class="bp-itmk dim">{{ getItmkName(inv.kind) }}</span>
                    <span class="bp-meta">{{ slotMeta(inv) }}</span>
                    <span v-if="isSlotSelected(inv.slot)" class="bp-check">*</span>
                  </div>
                  <div v-if="nonEmptySlots.length === 0" class="dim bp-empty">
                    背包为空
                  </div>
                </div>
                <div v-if="itm0Locked" class="locked-overlay">
                  请先堆叠合并或丢到地上
                </div>
              </div>

              <!-- ③ 工作台候选 -->
              <div class="wb-section" :class="{ locked: itm0Locked }">
                <div class="ascii-title">
                  <span class="ascii-label">工作台候选</span>
                  <span class="ascii-line" style="flex:1"></span>
                </div>
                <div class="wb-list">
                  <template v-for="(materials, source) in wbMaterialsBySource" :key="source">
                    <div v-if="materials.length > 0" class="wb-group">
                      <div class="wb-source">- {{ wbSourceLabel(String(source)) }} -</div>
                      <div
                        v-for="wb in materials"
                        :key="wb.id"
                        class="wb-row"
                        :class="{ selected: isWbSelected(wb.id) }"
                        @click="onToggleWb(wb.id)"
                      >
                        <span class="wb-check">{{ isWbSelected(wb.id) ? '[x]' : '[ ]' }}</span>
                        <span class="wb-name">{{ getItemName(wb.item_id) }}</span>
                        <span class="wb-meta dim">(t:{{ wb.tool_level }})</span>
                      </div>
                    </div>
                  </template>
                  <div v-if="!hasAnyWb" class="dim wb-empty">
                    附近无可用工作台
                  </div>
                </div>
              </div>

              <!-- 合成按钮 / itm0 锁定按钮组 -->
              <div class="craft-action">
                <template v-if="itm0Locked">
                  <button
                    class="term-btn block"
                    :disabled="commandQueue.isLocked"
                    @click="onOrganize"
                  >[尝试堆叠合并]</button>
                  <button
                    class="term-btn block"
                    :disabled="commandQueue.isLocked"
                    @click="onDiscardItm0"
                  >[丢到地上]</button>
                </template>
                <template v-else>
                  <button
                    class="term-btn block craft-submit"
                    :disabled="!craftStore.isCraftable || commandQueue.isLocked"
                    @click="onCraft"
                  >[合成]</button>
                </template>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* 覆盖 .modal 默认宽度（360px），合成模态框需要更宽以容纳三列 */
.craft-modal {
  position: relative;
  box-sizing: border-box;
  width: 90vw;
  max-width: 1200px;
  padding: 12px;
}

.craft-toast {
  position: absolute;
  top: 8px;
  left: 50%;
  transform: translateX(-50%);
  border: 1px solid #888;
  background: #0a0a0a;
  color: #ddd;
  font-size: 12px;
  padding: 4px 16px;
  white-space: nowrap;
  z-index: 10;
  pointer-events: none;
  box-shadow: 0 0 8px rgba(255,255,255,0.06);
}

.craft-toast-enter-active, .craft-toast-leave-active {
  transition: opacity 0.3s ease, transform 0.3s ease;
}
.craft-toast-enter-from, .craft-toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-8px);
}

.craft-body {
  max-height: 80vh;
  overflow: hidden;
}

.craft-columns {
  display: grid;
  grid-template-columns: 25fr 30fr 45fr;
  gap: 8px;
  height: 72vh;
}

.craft-col {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid rgba(68, 68, 68, 0.3);
  padding: 6px;
}

.craft-col-left {
  overflow-y: auto;
}

.craft-col-middle {
  gap: 6px;
}

.craft-col-right {
  gap: 6px;
}

/* ── 中列：素材池 + 反馈 ── */
.pool-section {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  padding: 2px;
}

.feedback-section {
  flex: 0 0 auto;
  min-height: 60px;
  padding: 4px 2px;
  border-top: 1px dashed rgba(68, 68, 68, 0.3);
}

.pool-empty,
.bp-empty,
.wb-empty {
  font-size: 10px;
  padding: 8px;
  text-align: center;
}

.pool-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  padding: 3px 2px;
  font-size: 11px;
  border-bottom: 1px dashed rgba(68, 68, 68, 0.15);
}

.pool-tag {
  color: #888;
  flex: 0 0 auto;
}

.pool-name {
  color: #ddd;
  flex: 1 1 auto;
}

.pool-count {
  color: #bbb;
  flex: 0 0 auto;
}

.pool-remain {
  font-size: 10px;
  flex: 0 0 auto;
}

.adj-btn {
  background: none;
  border: 1px solid #555;
  color: #bbb;
  cursor: pointer;
  font-family: inherit;
  font-size: 10px;
  padding: 0 4px;
  margin-left: 2px;
  transition: background 0.12s;
}

.adj-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

.clear-btn {
  background: none;
  border: 1px solid #555;
  color: #888;
  cursor: pointer;
  font-family: inherit;
  font-size: 10px;
  padding: 1px 6px;
  flex: 0 0 auto;
  transition: background 0.12s, color 0.12s;
}

.clear-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

.pool-total {
  font-size: 10px;
  padding: 4px 2px;
  text-align: right;
}

.feedback-content {
  font-size: 11px;
  padding: 4px 2px;
  line-height: 1.5;
}

/* ── 右列：背包 + 工作台 ── */
.bp-section {
  flex: 2 1 auto;
  min-height: 120px;
  display: flex;
  flex-direction: column;
  position: relative;
  overflow: hidden;
}

.wb-section {
  flex: 1 1 auto;
  max-height: 40%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
}

.bp-list,
.wb-list {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 2px;
}

.bp-row,
.wb-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  font-size: 11px;
  cursor: pointer;
  border: 1px solid transparent;
  transition: background 0.12s, border-color 0.12s;
  user-select: none;
}

.bp-row:hover,
.wb-row:hover {
  background: rgba(255, 255, 255, 0.05);
  border-color: rgba(68, 68, 68, 0.3);
}

.bp-row.selected,
.wb-row.selected {
  background: rgba(255, 255, 255, 0.08);
  border-color: #888;
}

.bp-slot {
  color: #888;
  flex: 0 0 auto;
}

.bp-name {
  color: #ddd;
  flex: 1 1 auto;
}

.bp-itmk {
  font-size: 10px;
  flex: 0 0 auto;
}

.bp-meta {
  color: #666;
  font-size: 10px;
  flex: 0 0 auto;
  white-space: nowrap;
}

.bp-check {
  color: #fff;
  font-weight: 700;
  flex: 0 0 auto;
}

.wb-check {
  color: #888;
  flex: 0 0 auto;
}

.wb-name {
  color: #bbb;
  flex: 1 1 auto;
}

.wb-meta {
  font-size: 10px;
  flex: 0 0 auto;
  white-space: nowrap;
}

.wb-source {
  color: #666;
  font-size: 10px;
  padding: 4px 2px 2px;
  border-top: 1px dashed rgba(68, 68, 68, 0.2);
}

.wb-group:first-child .wb-source {
  border-top: none;
}

/* ── itm0 锁定态（§8.6） ── */
.bp-section.locked,
.wb-section.locked {
  opacity: 0.4;
  pointer-events: none;
}

.locked-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
  color: #ccc;
  font-size: 11px;
  text-align: center;
  padding: 8px;
  pointer-events: none;
}

/* ── 合成按钮区 ── */
.craft-action {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-top: 6px;
  border-top: 1px solid rgba(68, 68, 68, 0.3);
}

/* 高亮合成按钮：白边白字，hover 反色 */
.craft-submit {
  border-color: #fff;
  color: #fff;
  font-weight: 700;
}

.craft-submit:hover:not(:disabled) {
  background: #fff;
  color: #0a0a0a;
}

.dim {
  color: #555;
}

.loading {
  padding: 16px;
  text-align: center;
  color: #555;
}

/* ── reduced-motion 兜底（§3.3） ── */
@media (prefers-reduced-motion: reduce) {
  .adj-btn,
  .bp-row,
  .wb-row,
  .craft-submit {
    transition: none;
  }
}
</style>
