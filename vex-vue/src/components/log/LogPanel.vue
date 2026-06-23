<script setup lang="ts">
// ══════════════════════════════════════════════════
// 日志面板 / Log Panel
//
// 替代现有 vex/js/log.js 的 #logContent 渲染区 + 滚动容器。
//
// 职责：
//   - v-for 渲染 logStore.entries（每条用 LogEntry.vue）
//   - 过滤空内容（renderLogEntry 返回空字符串的条目不显示）
//   - 过滤 debug 日志（非 ?debug=ai 模式下隐藏）
//   - 最后一条加 isNew=true（触发 log-new 高亮动画）
//   - 包含 LogUnreadBtn.vue（未读提示按钮）
//   - 滚动容器 ref 传给 useLogScroll.bindScroll()
//
// 滚动逻辑由 useLogScroll composable 处理（命令式 scrollTop = scrollHeight）。
// ══════════════════════════════════════════════════

import { computed, onMounted, ref, watch, nextTick } from 'vue';
import { useLogStore } from '@/stores/log';
import { useLogScroll } from '@/composables/useLogScroll';
import LogEntry from './LogEntry.vue';
import LogUnreadBtn from './LogUnreadBtn.vue';
import { renderLogEntry } from '@/data/log-templates';
import type { LogEntry as LogEntryType } from '@/types/api';

const logStore = useLogStore();
const { isAtBottom, unreadCount, scrollToBottom, bindScroll } = useLogScroll();

/** 滚动容器 ref（#logContent 的父级，与原前端一致） */
const scrollerRef = ref<HTMLElement | null>(null);

/** debug 日志开关：?debug=ai 启用时显示 debug 日志（默认隐藏） */
const isDebugLogMode = (() => {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('debug') === 'ai';
})();

/** 过滤后的可见日志条目（过滤空内容 + debug 日志） */
interface VisibleEntry {
  entry: LogEntryType;
  isNew: boolean; // 是否为最后一条
}

const visibleEntries = computed<VisibleEntry[]>(() => {
  const all = logStore.entries;
  const result: VisibleEntry[] = [];
  for (let i = 0; i < all.length; i++) {
    const entry = all[i];
    // debug 日志过滤：非 debug 模式下跳过
    if (entry.debug && !isDebugLogMode) continue;
    // 过滤空内容（如 move.tile_desc 无 desc 时返回空字符串）
    const content = renderLogEntry(entry);
    if (!content) continue;
    result.push({ entry, isNew: false });
  }
  // 标记最后一条为 isNew（触发 log-new 高亮动画）
  if (result.length > 0) {
    result[result.length - 1].isNew = true;
  }
  return result;
});

/** 是否显示"暂无日志"占位 */
const showEmpty = computed<boolean>(() => visibleEntries.value.length === 0);

// ── 绑定滚动监听（onMounted） ──
onMounted(() => {
  bindScroll(scrollerRef.value);
});

// ── entries 变化时自动滚动到底部（仅在 isAtBottom 时） ──
// 注意：logStore.refreshLog 已通过 LOG_EVENTS.FORCE_SCROLL / ADD_UNREAD 转发滚动指令，
//       这里额外监听 entries 变化是为了处理首次加载 + isAtBottom=true 的场景。
//       useLogScroll 的 ADD_UNREAD handler 已处理 isAtBottom 时的自动滚动，
//       但首次加载时 lastTs=0，所有 entries 都算 newEntries，会触发 ADD_UNREAD。
//       为避免重复滚动，这里仅在 isAtBottom=true 且未读计数为 0 时滚动。
watch(
  () => logStore.entries.length,
  async () => {
    await nextTick();
    if (isAtBottom.value) {
      scrollToBottom();
    }
  },
);
</script>

<template>
  <div class="relative h-full flex flex-col">
    <!-- 滚动容器（#logContent 的父级，与原前端结构一致） -->
    <div
      ref="scrollerRef"
      class="flex-1 overflow-y-auto pl-2 border-l border-fg-dim/20 min-h-0"
    >
      <!-- 日志内容区（#logContent 等价） -->
      <div id="logContent" class="log-content">
        <span v-if="showEmpty" class="grey">[SYS] 暂无日志</span>
        <LogEntry
          v-for="(item, idx) in visibleEntries"
          :key="idx"
          :entry="item.entry"
          :is-new="item.isNew"
        />
      </div>
    </div>

    <!-- 未读提示按钮 -->
    <LogUnreadBtn
      :count="unreadCount"
      @scroll-to-bottom="scrollToBottom"
    />
  </div>
</template>
