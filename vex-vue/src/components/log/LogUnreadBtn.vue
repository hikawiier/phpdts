<script setup lang="ts">
// ══════════════════════════════════════════════════
// 日志未读提示按钮 / Log Unread Button
//
// 替代现有 vex/js/log.js 的 #logUnreadBtn + updateUnreadButton 逻辑。
//
// 职责：
//   - 显示"↓ N 条新日志"
//   - 点击滚动到底部（调用 useLogScroll.scrollToBottom）
//   - unreadCount=0 时隐藏
// ══════════════════════════════════════════════════

defineProps<{
  count: number;
}>();

const emit = defineEmits<{
  (e: 'scroll-to-bottom'): void;
}>();
</script>

<template>
  <button
    v-if="count > 0"
    class="log-unread-btn absolute left-1/2 -translate-x-1/2 bottom-1 z-10"
    @click="emit('scroll-to-bottom')"
  >
    ↓ {{ count }} 条新日志
  </button>
</template>
