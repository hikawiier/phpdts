<script setup lang="ts">
/**
 * @module L Vue 组件
 * @framework L-5 附加后演出效果
 */
// ══════════════════════════════════════════════════
// 战斗命中伤害数字 / Damage Number
//
// 触发方式：监听 dataManager 'battle:play-damage-numbers' 事件
// 数据格式：{ effects: DirectedEffect[] }
//
// 实现方式：
// - 用 Vue 响应式 damageList ref + v-for 渲染（替代原前端的 document.createElement）
// - 从当前 SceneGeometry 的交互根查询目标，适配探索/战斗场景切换
// - Teleport to body + position: fixed，锚定目标立绘上半身
// ══════════════════════════════════════════════════

import { ref, onMounted, onUnmounted } from 'vue';
import { dataManager } from '@/stores/data-manager';
import { getSceneGeometry } from '@/composables/sceneRegistry';
import type { DirectedEffect } from '@/stores/battle-director';
import type { PlayDamageNumbersEventData } from '@/types/events';

const DISPLAY_DURATION = 1250;

interface DamageItem {
  id: number;
  left: number;
  top: number;
  text: string;
  delay: number;
  targetKey: string;
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
// 场景目标解析
// ══════════════════════════════════════════════════

interface DamageTargetElement {
  key: string;
  element: HTMLElement;
}

function getTargetElement(effect: DirectedEffect): DamageTargetElement | null {
  const geometry = getSceneGeometry();
  const root = geometry?.getInteractionRoot?.();
  if (!root) return null;
  const snapshot = effect.target.snapshot;
  let key = effect.target.id || 'unknown';
  let entity: HTMLElement | null = null;

  if (snapshot?.type === 0 || effect.target.id === 'player') {
    key = 'player';
    entity = root.querySelector<HTMLElement>('[data-entity-id="player"]');
  } else {
    const pid = Number(snapshot?.pid ?? effect.target.pid ?? 0);
    if (pid > 0) {
      key = `pid:${pid}`;
      entity = root.querySelector<HTMLElement>(`[data-character-pid="${pid}"]`);
    }
  }

  if (!entity && effect.target.id.startsWith('enemy-')) {
    key = effect.target.id;
    entity = root.querySelector<HTMLElement>(`[data-entity-id="${effect.target.id}"]`);
  }
  if (!entity) return null;
  return { key, element: entity.querySelector<HTMLElement>('.entity-img') ?? entity };
}

// ══════════════════════════════════════════════════
// 播放逻辑
// ══════════════════════════════════════════════════

/**
 * 在动作命中阶段读取目标立绘的实时视口坐标并显示伤害数字。
 */
function playDamageNumbersAtImpact(effects: DirectedEffect[]): void {
  if (!effects || !effects.length) return;
  const targetCounts = new Map<string, number>();

  for (const effect of effects) {
    if (effect.visual.kind !== 'damage_number') continue;

    const damage = Number(effect.visual.value ?? effect.value ?? 0);
    if (damage <= 0) continue;

    const target = getTargetElement(effect);
    if (!target) continue;
    const targetRect = target.element.getBoundingClientRect();
    const targetIndex = targetCounts.get(target.key) ?? 0;
    targetCounts.set(target.key, targetIndex + 1);
    const lane = Math.ceil(targetIndex / 2);
    const offsetX = targetIndex === 0 ? 0 : (targetIndex % 2 === 1 ? 1 : -1) * lane * 18;
    const offsetY = -Math.floor(targetIndex / 2) * 10;
    const delay = Math.min(targetIndex, 4) * 55;

    const item: DamageItem = {
      id: nextId++,
      left: targetRect.left + targetRect.width / 2 + offsetX,
      top: targetRect.top + targetRect.height * 0.32 + offsetY,
      text: '-' + damage,
      delay,
      targetKey: target.key,
    };

    damageList.value.push(item);

    const itemId = item.id;
    addTimer(() => {
      const idx = damageList.value.findIndex((d) => d.id === itemId);
      if (idx >= 0) {
        damageList.value.splice(idx, 1);
      }
    }, DISPLAY_DURATION + delay);
  }
}

// ══════════════════════════════════════════════════
// 事件监听
// ══════════════════════════════════════════════════

function onPlayDamageNumbers(data: unknown): void {
  const payload = data as PlayDamageNumbersEventData;
  if (!payload || !Array.isArray(payload.effects)) return;
  playDamageNumbersAtImpact(payload.effects);
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
  playDamageNumbersAtImpact,
});
</script>

<template>
  <Teleport to="body">
    <div
      v-for="item in damageList"
      :key="item.id"
      class="battle-damage-number"
      data-battle-damage-number
      :data-target-key="item.targetKey"
      :style="{
        left: item.left + 'px',
        top: item.top + 'px',
        animationDelay: item.delay + 'ms',
      }"
    >
      {{ item.text }}
    </div>
  </Teleport>
</template>
