<script setup lang="ts">
/**
 * @module L Vue 组件
 * @framework L-9 POI 交互模态框
 */
// ══════════════════════════════════════════════════
// POI 交互态主面板 / POI Interaction Panel
//
// L-9 交互态四区布局（设计案 §4.2）：
//   ├── 左列：POI 信息区（场景插图占位 + 名称 + 描述 + 状态徽章 + 搜索次数 + 机制结果）
//   ├── 中列上部：交互区（三档概率条 + PoiFeedbackPanel 反馈/道具列表）
//   ├── 中列下部：反馈区（已放入的工具/技能 + 搜索按钮 / itm0 锁定按钮组）
//   └── 右列：交互区（PoiToolSelector 可用工具/技能列表）
//
// itm0 锁定态（设计案 §2.9）：搜索按钮替换为 [尝试堆叠合并] / [丢到地上]
// 两个解锁按钮，与 CraftModal itm0 锁定态一致。
//
// 相关文档：oblivions/docs/搜索建筑物与掉落机制重构-模块L-POI交互界面.md §2.3 §2.8 §2.9
// ══════════════════════════════════════════════════

import { computed } from 'vue';
import { usePoiStore } from '@/stores/poi';
import { useInventoryStore } from '@/stores/inventory';
import { commandQueue } from '@/stores/command-queue';
import { getPoiName, getPoiDesc } from '@/data/poi-locale';
import { getItemName } from '@/data/item-locale';
import { getTagName } from '@/data/tag-locale';
import PoiToolSelector from './PoiToolSelector.vue';
import PoiFeedbackPanel from './PoiFeedbackPanel.vue';

const poiStore = usePoiStore();
const inventoryStore = useInventoryStore();

// ── 派生状态 ──
const currentPoi = computed(() => poiStore.currentPoi);
const itm0Locked = computed(() => poiStore.itm0Locked);
const canSearch = computed(() => poiStore.canSearch);
const searchLoading = computed(() => poiStore.searchLoading);
const currentPoiSearchable = computed(() => poiStore.currentPoiSearchable);

// ── F-6 道具交互派生状态 ──
const currentPoiInteractions = computed(() => poiStore.currentPoiInteractions);
const canInteract = computed(() => poiStore.canInteract);
const interactLoading = computed(() => poiStore.interactLoading);

/** 是否为机制型 POI（如生命图腾、技能图腾） */
const isMechanic = computed<boolean>(() => !!currentPoi.value?.mechanic);

/** 是否显示机制触发结果（已搜索的机制型 POI） */
const showMechanicResult = computed<boolean>(() => {
  const poi = currentPoi.value;
  return !!(poi && poi.mechanic && poi.searched);
});

/** 搜索按钮文字 */
const searchBtnText = computed<string>(() => {
  const poi = currentPoi.value;
  if (!poi) return '[搜索]';
  if (poi.mechanic) {
    return poi.searched ? '[再触碰]' : '[触碰]';
  }
  return poi.searched ? '[再搜索]' : '[搜索]';
});

/** 是否已达搜索上限（P1-3：合并 state==='exhausted' 与可重复次数耗尽两条判定） */
const searchLimitReached = computed<boolean>(() => {
  const poi = currentPoi.value;
  if (!poi || !poi.searchable) return false;
  if (poi.state === 'exhausted') return true;
  if (!poi.repeatable) return false;
  const remaining = Number(poi.search_count_remaining);
  if (!Number.isNaN(remaining) && remaining === 0) return true;
  const limit = Number(poi.repeat_limit) || 0;
  const count = Number(poi.search_count) || 0;
  return limit > 0 && count >= limit;
});

/** 是否处于冷却中（P1-3） */
const inCooldown = computed<boolean>(() => currentPoi.value?.state === 'cooldown');

/** 冷却剩余 tick 文案（P1-3） */
const cooldownLabel = computed<string>(() => {
  const poi = currentPoi.value;
  if (!poi || poi.state !== 'cooldown') return '';
  const remaining = Number(poi.cooldown_remaining_turn) || 0;
  return remaining > 0 ? `冷却中（剩余 ${remaining} tick）` : '冷却中';
});

/** POI 名称 */
const poiName = computed<string>(() => {
  const poi = currentPoi.value;
  return poi ? getPoiName(poi.poi_id, poi.name) : '';
});

/** POI 描述 */
const poiDesc = computed<string>(() => {
  const poi = currentPoi.value;
  return poi ? getPoiDesc(poi.poi_id, poi.desc) : '';
});

/** 搜索次数标签 */
const searchCountLabel = computed<string>(() => {
  const poi = currentPoi.value;
  if (!poi) return '';
  if (!poi.repeatable) return '';
  const limit = Number(poi.repeat_limit) || 0;
  if (limit <= 0) return '无限';
  const count = Number(poi.search_count) || 0;
  return `${count}/${limit}`;
});

/** 已发现道具计数 */
const itemCount = computed<number>(() => poiStore.currentPoiItems.length);

/** 是否显示搜索按钮区 */
const showSearchAction = computed<boolean>(() => {
  const poi = currentPoi.value;
  if (!poi) return false;
  if (!poi.searchable) return false;
  return true;
});

/** 是否显示工具选择器（可搜索且非机制型 POI） */
const showToolSelector = computed<boolean>(() => {
  if (itm0Locked.value) return false;
  const poi = currentPoi.value;
  if (!poi) return false;
  if (!poi.searchable) return false;
  if (poi.mechanic) return false;
  return currentPoiSearchable.value;
});

/** 是否显示概率条区（可搜索且非机制型 POI） */
const showProbabilityBars = computed<boolean>(() => {
  const poi = currentPoi.value;
  if (!poi) return false;
  if (!poi.searchable) return false;
  if (poi.mechanic) return false;
  return true;
});

// ── 概率条数据 ──

interface ProbBar {
  key: string;
  label: string;
  value: number;
  percent: number;
}

/** 三档概率条数据（基础值，未应用 prob_mods） */
const probBars = computed<ProbBar[]>(() => {
  const poi = currentPoi.value;
  if (!poi) return [];
  const loot = Number(poi.base_loot_chance) || 0;
  const good = Number(poi.base_good_event_chance) || 0;
  const bad = Number(poi.base_bad_event_chance) || 0;
  return [
    {
      key: 'loot',
      label: '物资',
      value: loot,
      percent: Math.round(loot * 100),
    },
    {
      key: 'good',
      label: '良性事件',
      value: good,
      percent: Math.round(good * 100),
    },
    {
      key: 'bad',
      label: '恶性事件',
      value: bad,
      percent: Math.round(bad * 100),
    },
  ];
});

/** 是否显示反馈区（PoiFeedbackPanel）
 *  - 有物品待拾取时始终显示（mechanic POI 开锁/开箱后掉落物需要拾取入口）
 *  - 否则按原逻辑：非 mechanic 或未搜索的 mechanic 显示
 */
const showFeedbackPanel = computed<boolean>(() => {
  if (itemCount.value > 0) return true;
  return !isMechanic.value || !showMechanicResult.value;
});

// ── 已放入工具/技能（中下部反馈区）──

const selectedToolId = computed(() => poiStore.selectedToolId);

/** 已选中工具的显示名（从背包查 itmid → 模板名） */
const selectedToolName = computed<string>(() => {
  const tid = selectedToolId.value;
  if (!tid) return '';
  const inv = inventoryStore.slots.find(s => !s.empty && (s.itmid || s.item_id) === tid);
  return inv ? getItemName(tid, inv.name) : tid;
});

// ── 事件处理 ──

function onSearch(): void {
  void poiStore.doSearch();
}

/** F-6 道具 × POI 交互按钮 */
function onInteract(slot: number, iaid: string | number): void {
  void poiStore.handleInteract(slot, iaid);
}

function onOrganize(): void {
  void inventoryStore.handleOrganize();
}

function onDiscardItm0(): void {
  void inventoryStore.handleDiscardItm0();
}

function onClearTool(): void {
  poiStore.clearToolId();
}

function onBack(): void {
  poiStore.exitInteraction();
}
</script>

<template>
  <div v-if="currentPoi" class="poi-interaction">
    <!-- ── 三列四区布局 ── -->
    <div class="poi-columns">
      <!-- ═══ 左列：POI 信息区 ═══ -->
      <div class="poi-col poi-col-left">
        <div class="ascii-title">
          <span class="ascii-label">POI 信息</span>
          <span class="ascii-line" style="flex:1"></span>
        </div>

        <!-- 场景插图占位（ASCII 框） -->
        <div class="poi-illustration">
          <pre class="poi-illustration-ascii">┌──────────┐
│          │
│  [场景]  │
│          │
└──────────┘</pre>
        </div>

        <div class="poi-info-name">
          <span class="poi-info-title">{{ poiName }}</span>
          <span v-if="itemCount > 0" class="dim poi-info-meta">已发现 {{ itemCount }} 个物品</span>
        </div>

        <div class="poi-info-desc dim">{{ poiDesc }}</div>

        <!-- 搜索次数 / 冷却信息 -->
        <div v-if="searchCountLabel" class="poi-info-row">
          <span class="dim">搜索次数：</span>
          <span>{{ searchCountLabel }}</span>
        </div>
        <div v-if="inCooldown" class="poi-info-row">
          <span class="dim">状态：</span>
          <span>{{ cooldownLabel }}</span>
        </div>

        <!-- 机制触发结果（已搜索的机制型 POI） -->
        <div v-if="showMechanicResult" class="mechanic-result">
          <div class="mechanic-effect">
            ✦ {{ currentPoi.mechanic }} +{{ currentPoi.mechanic_value || 0 }}
          </div>
        </div>
      </div>

      <!-- ═══ 中列：交互区（上） + 反馈区（下） ═══ -->
      <div class="poi-col poi-col-middle">
        <!-- ── 中上部：交互区（概率条 + 反馈/道具列表） ── -->
        <div class="poi-interaction-zone">
          <!-- 概率条区 -->
          <div v-if="showProbabilityBars" class="prob-section">
            <div class="ascii-title">
              <span class="ascii-label">搜索概率</span>
              <span class="ascii-line" style="flex:1"></span>
            </div>
            <div class="prob-bars">
              <div
                v-for="bar in probBars"
                :key="bar.key"
                class="prob-bar-row"
              >
                <span class="prob-bar-label">{{ bar.label }}</span>
                <div class="prob-bar-track">
                  <div
                    class="prob-bar-fill"
                    :class="`is-${bar.key}`"
                    :style="{ width: bar.percent + '%' }"
                  ></div>
                </div>
                <span class="prob-bar-value">{{ bar.percent }}%</span>
              </div>
            </div>
            <div class="dim prob-hint">基础概率（未应用工具/技能修正）</div>
          </div>

          <!-- 反馈区：PoiFeedbackPanel（搜索结果 + 道具列表 + 拾取按钮） -->
          <PoiFeedbackPanel v-if="showFeedbackPanel" />
        </div>

        <!-- ── F-6 道具交互区（currentPoiInteractions 非空时显示） ── -->
        <div v-if="currentPoiInteractions.length > 0" class="poi-interact-zone">
          <div class="ascii-title">
            <span class="ascii-label">道具交互</span>
            <span class="ascii-line" style="flex:1"></span>
          </div>
          <div class="interact-list">
            <div
              v-for="interact in currentPoiInteractions"
              :key="interact.interaction_id"
              class="interact-row"
            >
              <span class="interact-name">{{ interact.name }}</span>
              <span class="dim interact-need">需要：{{ getItemName(interact.required_item || '', '') || getTagName(interact.required_tag) }}</span>
              <div class="interact-slots">
                <button
                  v-for="slot in interact.available_slots"
                  :key="slot"
                  class="term-btn interact-btn"
                  :disabled="!canInteract || interactLoading || interact.available_slots.length === 0"
                  @click="onInteract(slot, currentPoi!.iaid)"
                >[槽位 {{ slot }}]</button>
                <span
                  v-if="interact.available_slots.length === 0"
                  class="dim interact-no-slot"
                >(缺少道具)</span>
              </div>
            </div>
          </div>
        </div>

        <!-- ── 中下部：反馈区（已放入的工具/技能 + 搜索按钮） ── -->
        <div class="poi-action-zone">
          <div class="ascii-title">
            <span class="ascii-label">已放入</span>
            <span class="ascii-line" style="flex:1"></span>
          </div>

          <div class="placed-section">
            <div v-if="selectedToolId" class="placed-item">
              <span class="placed-check">[x]</span>
              <span class="placed-name">{{ selectedToolName }}</span>
              <button class="clear-btn" @click="onClearTool">[清除]</button>
            </div>
            <div v-else class="dim placed-empty">
              未选择工具/技能
            </div>
          </div>

          <!-- 搜索按钮 / itm0 锁定按钮组 -->
          <div v-if="showSearchAction" class="poi-action">
            <template v-if="itm0Locked">
              <button
                class="term-btn block"
                :disabled="!commandQueue.canExecute('inventory.organize')"
                @click="onOrganize"
              >[尝试堆叠合并]</button>
              <button
                class="term-btn block"
                :disabled="!commandQueue.canExecute('item.discard')"
                @click="onDiscardItm0"
              >[丢到地上]</button>
            </template>
            <template v-else>
              <button
                v-if="inCooldown"
                class="term-btn block"
                disabled
              >{{ cooldownLabel }}</button>
              <div v-else-if="searchLimitReached" class="dim search-limit">
                已达搜索上限
              </div>
              <button
                v-else
                class="term-btn block poi-search-btn"
                :disabled="!canSearch || searchLoading || !currentPoiSearchable"
                @click="onSearch"
              >{{ searchBtnText }}</button>
            </template>
          </div>
        </div>
      </div>

      <!-- ═══ 右列：可用工具/技能区 ═══ -->
      <div class="poi-col poi-col-right">
        <PoiToolSelector v-if="showToolSelector" />
        <div v-else class="dim poi-tools-empty">
          <div class="ascii-title">
            <span class="ascii-label">可用工具/技能</span>
            <span class="ascii-line" style="flex:1"></span>
          </div>
          <div class="dim" style="padding:8px;text-align:center;font-size:10px;">
            {{ isMechanic ? '机制型 POI 不需要工具' : '当前不可搜索' }}
          </div>
        </div>
      </div>
    </div>

    <!-- ── 底部：返回列表 ── -->
    <div class="poi-footer">
      <button class="term-btn block" @click="onBack">[返回列表]</button>
    </div>
  </div>
</template>

<style scoped>
.poi-interaction {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* ── 三列网格布局 ── */
.poi-columns {
  display: grid;
  grid-template-columns: 25fr 40fr 35fr;
  gap: 8px;
  height: 70vh;
  min-height: 480px;
}

.poi-col {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid rgba(68, 68, 68, 0.3);
  padding: 6px;
}

/* ── 通用 ASCII 标题 ── */
.ascii-title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  font-size: 10px;
  color: #666;
  flex: 0 0 auto;
}

.ascii-label {
  flex: 0 0 auto;
}

.ascii-line {
  height: 1px;
  background: rgba(68, 68, 68, 0.3);
}

/* ═══ 左列：POI 信息区 ═══ */
.poi-col-left {
  overflow-y: auto;
  gap: 4px;
}

.poi-illustration {
  flex: 0 0 auto;
  display: flex;
  justify-content: center;
  padding: 6px 0;
  margin-bottom: 4px;
  border: 1px dashed rgba(68, 68, 68, 0.2);
}

.poi-illustration-ascii {
  margin: 0;
  font-family: inherit;
  font-size: 10px;
  line-height: 1.2;
  color: #555;
  white-space: pre;
}

.poi-info-name {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  flex: 0 0 auto;
}

.poi-info-title {
  color: #ddd;
  font-size: 13px;
  font-weight: 700;
}

.poi-info-meta {
  color: #555;
  font-size: 10px;
}

.poi-info-desc {
  color: #777;
  font-size: 11px;
  line-height: 1.5;
  margin-top: 4px;
  flex: 0 0 auto;
}

.poi-info-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: #ddd;
  margin-top: 4px;
  flex: 0 0 auto;
}

.mechanic-result {
  margin-top: 8px;
  padding: 8px;
  border: 1px solid #888;
  background: rgba(255, 255, 255, 0.04);
  flex: 0 0 auto;
}

.mechanic-effect {
  color: #ddd;
  font-size: 12px;
  text-align: center;
}

/* ═══ 中列：交互区（上） + 反馈区（下） ═══ */
.poi-col-middle {
  gap: 6px;
}

.poi-interaction-zone {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
  min-height: 0;
}

/* ── 概率条区 ── */
.prob-section {
  flex: 0 0 auto;
  padding: 2px;
}

.prob-bars {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.prob-bar-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
}

.prob-bar-label {
  color: #888;
  flex: 0 0 56px;
  text-align: right;
}

.prob-bar-track {
  flex: 1 1 auto;
  height: 10px;
  background: rgba(68, 68, 68, 0.2);
  border: 1px solid rgba(68, 68, 68, 0.4);
  position: relative;
  overflow: hidden;
}

.prob-bar-fill {
  height: 100%;
  background: #888;
  transition: width 0.2s ease-out;
}

/* 三档概率条用不同灰阶区分（DESIGN.md §2.15 灰阶为基底） */
.prob-bar-fill.is-loot {
  background: #ddd;
}

.prob-bar-fill.is-good {
  background: #888;
}

.prob-bar-fill.is-bad {
  background: #444;
  border-right: 1px solid #666;
}

.prob-bar-value {
  color: #ddd;
  flex: 0 0 36px;
  text-align: right;
  font-size: 10px;
}

.prob-hint {
  font-size: 10px;
  padding: 2px 0;
  text-align: right;
}

/* ── F-6 道具交互区 ── */
.poi-interact-zone {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px;
  border: 1px solid rgba(68, 68, 68, 0.4);
  background: rgba(255, 255, 255, 0.02);
}

.interact-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.interact-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  padding: 4px;
  font-size: 11px;
  border: 1px dashed rgba(68, 68, 68, 0.3);
}

.interact-name {
  color: #ddd;
  flex: 0 0 auto;
  font-weight: 700;
}

.interact-need {
  flex: 1 1 auto;
  font-size: 10px;
}

.interact-slots {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
  flex-wrap: wrap;
}

.interact-btn {
  font-size: 10px;
  padding: 1px 6px;
}

.interact-no-slot {
  font-size: 10px;
  font-style: italic;
}

/* ── 中下部：反馈区（已放入 + 搜索按钮） ── */
.poi-action-zone {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 6px;
  border-top: 1px dashed rgba(68, 68, 68, 0.3);
}

.placed-section {
  flex: 0 0 auto;
  min-height: 28px;
}

.placed-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  font-size: 11px;
  border: 1px solid rgba(68, 68, 68, 0.3);
  background: rgba(255, 255, 255, 0.03);
}

.placed-check {
  color: #fff;
  flex: 0 0 auto;
}

.placed-name {
  color: #ddd;
  flex: 1 1 auto;
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

.placed-empty {
  font-size: 10px;
  padding: 6px;
  text-align: center;
}

.poi-action {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.search-limit {
  font-size: 11px;
  text-align: center;
  padding: 6px;
}

.poi-search-btn {
  border-color: #fff;
  color: #fff;
  font-weight: 700;
}

.poi-search-btn:hover:not(:disabled) {
  background: #fff;
  color: #0a0a0a;
}

/* ═══ 右列：可用工具/技能区 ═══ */
.poi-col-right {
  overflow: hidden;
}

.poi-tools-empty {
  display: flex;
  flex-direction: column;
  height: 100%;
}

/* ── 底部 ── */
.poi-footer {
  padding-top: 6px;
  border-top: 1px solid rgba(68, 68, 68, 0.3);
  flex: 0 0 auto;
}

.dim {
  color: #555;
}

/* ── reduced-motion 兜底 ── */
@media (prefers-reduced-motion: reduce) {
  .prob-bar-fill,
  .poi-search-btn {
    transition: none;
  }
}
</style>
