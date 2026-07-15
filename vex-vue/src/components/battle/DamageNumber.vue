<script setup lang="ts">
/**
 * @module L Vue 组件
 * @framework L-5 附加后演出效果
 */
// ══════════════════════════════════════════════════
// 残留伤害数字 / Damage Number
//
// 替代现有 vex/js/battle-animation.js 的 playDamageNumbersAfterModal()。
// 模态框关闭后，在地图格上淡入显示伤害数字（残留反馈）。
//
// 触发方式：监听 dataManager 'battle:play-damage-numbers' 事件
// 数据格式：{ effects: DirectedEffect[], npcPid: number }
//
// 实现方式：
// - 用 Vue 响应式 damageList ref + v-for 渲染（替代原前端的 document.createElement）
// - Teleport to body + position: fixed（与原前端一致，避免依赖容器定位上下文）
// - 2s 后从 damageList 移除（与 CSS 动画时长匹配）
// ══════════════════════════════════════════════════

import { ref, onMounted, onUnmounted } from 'vue';
import { dataManager } from '@/stores/data-manager';
import type { DirectedEffect } from '@/stores/battle-director';
import type { PlayDamageNumbersEventData } from '@/types/events';

// 残留时间（与 CSS 动画 damage-linger 时长匹配）
const LINGER_DURATION = 2000;

interface DamageItem {
  id: number;
  left: number;
  top: number;
  text: string;
  marginTop: number;
}

const damageList = ref<DamageItem[]>([]);
let nextId = 0;

// 定时器跟踪（onUnmounted 时清理）
const timers: ReturnType<typeof setTimeout>[] = [];

function addTimer(fn: () => void, ms: number): void {
  const timer = setTimeout(fn, ms);
  timers.push(timer);
}

function clearAllTimers(): void {
  for (const timer of timers) {
    clearTimeout(timer);
  }
  timers.length = 0;
}

// ══════════════════════════════════════════════════
// DOM 元素查询
// ══════════════════════════════════════════════════

/** 按角色 PID 获取地图实体；cell 仅作为玩家尚未挂载时的兜底。 */
function getCharacterElement(pid: number, player = false): HTMLElement | null {
  const grid = document.getElementById('mapGrid');
  if (!grid) return null;
  return grid.querySelector<HTMLElement>(`[data-character-pid="${pid}"]`)
    ?? (player ? grid.querySelector<HTMLElement>('.map-cell.current') : null);
}

// ══════════════════════════════════════════════════
// 播放逻辑
// ══════════════════════════════════════════════════

/**
 * 模态框关闭后，在地图格上淡入显示伤害数字（残留反馈）
 *
 * 遍历该组 v2 effect visual plan，在受击方格子上显示伤害数字。
 * 动作动画已由 BattlePlaybackRunner 的 actor executor 执行；这里只显示数字，
 * 且使用淡入动画（damage-fade-in）而非浮起动画（damage-float）。
 *
 * 迁移自现有 vex/js/battle-animation.js playDamageNumbersAfterModal()。
 */
function playDamageNumbersAfterModal(effects: DirectedEffect[], enemyPid: number): void {
  if (!effects || !effects.length) return;

  for (let i = 0; i < effects.length; i++) {
    const effect = effects[i];
    if (effect.visual.kind !== 'damage_number') continue;

    const damage = Number(effect.visual.value ?? effect.value ?? 0);
    if (damage <= 0) continue;

    const targetEl = getTargetElement(effect, enemyPid);
    if (!targetEl) continue;

    // 用视口坐标（position: fixed），避免依赖容器的定位上下文
    const targetRect = targetEl.getBoundingClientRect();

    const item: DamageItem = {
      id: nextId++,
      left: targetRect.left + targetRect.width / 2,
      top: targetRect.top + targetRect.height / 2,
      text: '-' + damage,
      // 多条伤害数字错开显示（避免重叠）
      marginTop: i * 18,
    };

    damageList.value.push(item);

    // 停留 2s 后移除（与 CSS 动画时长匹配）
    const itemId = item.id;
    addTimer(() => {
      const idx = damageList.value.findIndex((d) => d.id === itemId);
      if (idx >= 0) {
        damageList.value.splice(idx, 1);
      }
    }, LINGER_DURATION);
  }
}

// ══════════════════════════════════════════════════
// 事件监听
// ══════════════════════════════════════════════════

function onPlayDamageNumbers(data: unknown): void {
  const payload = data as PlayDamageNumbersEventData;
  if (!payload || !Array.isArray(payload.effects) || typeof payload.npcPid !== 'number') return;
  playDamageNumbersAfterModal(payload.effects, payload.npcPid);
}

onMounted(() => {
  dataManager.listen('battle:play-damage-numbers', onPlayDamageNumbers);
});

onUnmounted(() => {
  dataManager.unlisten('battle:play-damage-numbers', onPlayDamageNumbers);
  clearAllTimers();
  damageList.value = [];
});

// 暴露方法供外部调用（备用，主要通过事件触发）
defineExpose({
  playDamageNumbersAfterModal,
});

function getTargetElement(effect: DirectedEffect, enemyPid: number): HTMLElement | null {
  const snapshot = effect.target.snapshot;
  if (snapshot?.type === 0 || effect.target.id === 'player') {
    return getCharacterElement(snapshot?.pid ?? effect.target.pid ?? 0, true);
  }
  if (snapshot && snapshot.type > 0) return getCharacterElement(snapshot.pid);
  if (effect.target.pid && effect.target.pid > 0) return getCharacterElement(effect.target.pid);
  return getCharacterElement(enemyPid);
}
</script>

<template>
  <Teleport to="body">
    <div
      v-for="item in damageList"
      :key="item.id"
      class="damage-number-linger"
      :style="{
        left: item.left + 'px',
        top: item.top + 'px',
        marginTop: item.marginTop + 'px',
      }"
    >
      {{ item.text }}
    </div>
  </Teleport>
</template>
