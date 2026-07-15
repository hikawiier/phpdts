<script setup lang="ts">
/**
 * @module K 状态管理层
 * @framework K-1 战斗回合编排 + 演示播放管道
 */

// ══════════════════════════════════════════════════
// 战斗横幅组件 / Battle Banner
//
// 接管 turn_intro（权威回合开放）和 battle_end（终局战报）段的视觉呈现。
// 实现 BannerPlayer 接口（SegmentPlayer & BattleEndPlayer），
// 由 store 命令式调用 playSegment / showMask / showContent / cancelMask。
//
// 两层结构：
// - 遮罩层（mask）：turn_intro 和 battle_end 段均使用
// - 内容层（banner）：无框章节卡样式，装饰线 + 标题 + (可选附加信息) + 装饰线
//   turn_intro 直接投影 openingKind；battle_end 显示"战斗结束" + reason 附加信息
//
// 两套独立状态机：
// - maskOpen / maskClosing：遮罩层
// - bannerOpen / bannerClosing：内容层
//
// 关联文档：oblivions/docs/战斗横幅样式优化-2026-07-14.md
// ══════════════════════════════════════════════════

import { ref, onMounted, onUnmounted } from 'vue';
import { useBattleStore } from '@/stores/battle';
import type { BattleSegment } from '@/stores/battle-director';
import type { SegmentPlayOptions } from '@/stores/battle-playback-runner';

// ── 播放参数 ──
const COMPLETE_HOLD = 750;       // 播放完停留 ms
const TRANSITION_FALLBACK = 500; // 过渡兜底超时 ms

// ── 遮罩层状态 ──
const maskOpen = ref<boolean>(false);
const maskClosing = ref<boolean>(false);

// ── 横幅内容层状态 ──
const bannerOpen = ref<boolean>(false);
const bannerClosing = ref<boolean>(false);

// ── 重入保护（playSegment 用） ──
const playing = ref<boolean>(false);

// ── 当前段（由 playSegment / showContent 设置，供 template 渲染） ──
const currentSeg = ref<BattleSegment | null>(null);

// ── 播放控制 ──
let currentTimer: ReturnType<typeof setTimeout> | null = null;
let cancelRequested = false;
let rejectSleep: ((e?: unknown) => void) | null = null;

const battleStore = useBattleStore();

// ── DOM refs ──
const maskRef = ref<HTMLElement | null>(null);
const bannerRef = ref<HTMLElement | null>(null);

// ══════════════════════════════════════════════════
// 播放工具
// ══════════════════════════════════════════════════

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    rejectSleep = reject;
    currentTimer = setTimeout(() => {
      currentTimer = null;
      rejectSleep = null;
      resolve();
    }, ms);
  });
}

function waitForTransition(el: HTMLElement | null): Promise<void> {
  if (!el) return Promise.resolve();
  return new Promise(resolve => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      el.removeEventListener('transitionend', onTransitionEnd);
      clearTimeout(timeout);
      resolve();
    };
    const onTransitionEnd = (event: TransitionEvent) => {
      if (event.target === el && event.propertyName === 'opacity') finish();
    };
    const timeout = setTimeout(finish, TRANSITION_FALLBACK);
    el.addEventListener('transitionend', onTransitionEnd);
  });
}

function waitForMaskTransition(): Promise<void> {
  return waitForTransition(maskRef.value);
}

function waitForBannerTransition(): Promise<void> {
  return waitForTransition(bannerRef.value);
}

// ══════════════════════════════════════════════════
// BannerPlayer 接口实现
// ══════════════════════════════════════════════════

/**
 * 播放 turn_intro 段：
 * 遮罩 + 内容同时淡入 → 停留 → 遮罩 + 内容同时淡出
 */
async function playSegment(
  segment: BattleSegment,
  _sessionId: string,
  _options: SegmentPlayOptions,
): Promise<void> {
  // 重入保护：直接返回（命令式模式下"返回"即"推进"）
  if (playing.value) return;
  playing.value = true;
  try {
    currentSeg.value = segment;

    // 遮罩 + 内容同时淡入
    const maskEntered = waitForMaskTransition();
    const bannerEntered = waitForBannerTransition();
    maskOpen.value = true;
    maskClosing.value = false;
    bannerOpen.value = true;
    bannerClosing.value = false;
    await Promise.all([maskEntered, bannerEntered]);
    if (cancelRequested) return;

    await sleep(COMPLETE_HOLD);
    if (cancelRequested) return;

    // 内容 + 遮罩同时淡出
    const bannerExited = waitForBannerTransition();
    const maskExited = waitForMaskTransition();
    bannerClosing.value = true;
    maskClosing.value = true;
    bannerOpen.value = false;
    maskOpen.value = false;
    await Promise.all([bannerExited, maskExited]);
    bannerClosing.value = false;
    maskClosing.value = false;
    currentSeg.value = null;
  } finally {
    playing.value = false;
  }
}

/** 显示终幕遮罩（仅遮罩层淡入），保持遮罩状态，等待 showContent 调用 */
async function showMask(
  _segment: BattleSegment,
  _sessionId: string,
): Promise<void> {
  const entered = waitForMaskTransition();
  maskOpen.value = true;
  maskClosing.value = false;
  await entered;
}

/**
 * 在已显示的遮罩上显示终局战报正文：
 * 内容淡入 → 停留 → 内容淡出 → 遮罩淡出
 */
async function showContent(
  segment: BattleSegment,
  _sessionId: string,
): Promise<void> {
  currentSeg.value = segment;

  // 内容淡入（遮罩已在 showMask 阶段打开）
  const bannerEntered = waitForBannerTransition();
  bannerOpen.value = true;
  bannerClosing.value = false;
  await bannerEntered;
  if (cancelRequested) return;

  await sleep(COMPLETE_HOLD);
  if (cancelRequested) return;

  // 内容淡出
  const bannerExited = waitForBannerTransition();
  bannerClosing.value = true;
  bannerOpen.value = false;
  await bannerExited;
  bannerClosing.value = false;
  if (cancelRequested) return;

  // 遮罩淡出
  const maskExited = waitForMaskTransition();
  maskClosing.value = true;
  maskOpen.value = false;
  await maskExited;
  maskClosing.value = false;
  currentSeg.value = null;
}

/** 关闭持续显示的遮罩（仅纯遮罩阶段生效；正文播放中为 no-op） */
function cancelMask(): void {
  if (bannerOpen.value) return;  // 正文正在播放，不干扰——正文流程会自行关闭遮罩
  maskOpen.value = false;
  maskClosing.value = false;
}

defineExpose({ playSegment, showMask, showContent, cancelMask });

// ══════════════════════════════════════════════════
// 生命周期
// ══════════════════════════════════════════════════

onMounted(() => {
  battleStore.registerBannerPlayer({
    playSegment,
    showMask,
    showContent,
    cancelMask,
  });
});

onUnmounted(() => {
  cancelRequested = true;
  if (currentTimer) {
    clearTimeout(currentTimer);
    currentTimer = null;
  }
  if (rejectSleep) {
    const r = rejectSleep;
    rejectSleep = null;
    r(new Error('BattleBanner unmounted'));
  }
  battleStore.unregisterBannerPlayer();
});
</script>

<template>
  <Teleport to="body">
    <!-- 遮罩层 -->
    <div
      ref="maskRef"
      class="battle-banner-mask"
      :class="{ open: maskOpen, closing: maskClosing }"
    ></div>
    <!-- 横幅内容层（turn_intro / battle_end 共用无框章节卡样式） -->
    <div
      ref="bannerRef"
      class="battle-banner"
      :class="{ open: bannerOpen, closing: bannerClosing }"
    >
      <!-- turn_intro: 装饰线 + 标题 + 回合提示 + 装饰线 -->
      <template v-if="currentSeg?.kind === 'turn_intro'">
        <div class="banner-line"></div>
        <div class="banner-title">{{ currentSeg.openingKind === 'battle_start' ? '战斗开始' : `第 ${currentSeg.roundNum ?? 0} 轮` }}</div>
        <div class="banner-subtitle" v-if="currentSeg.actor">
          {{ currentSeg.controller === 'player' ? '你的回合' : `${currentSeg.actor.name}的回合` }}
        </div>
        <div class="banner-line"></div>
      </template>

      <!-- battle_end: 装饰线 + 标题 + 附加信息 + 装饰线 -->
      <template v-else-if="currentSeg?.kind === 'battle_end'">
        <div class="banner-line"></div>
        <div class="banner-title">战斗结束</div>
        <div class="banner-subtitle">
          <span v-for="notice in currentSeg.notices" :key="notice.rawLogId">{{ notice.reason }}</span>
        </div>
        <div class="banner-line"></div>
      </template>
    </div>
  </Teleport>
</template>
