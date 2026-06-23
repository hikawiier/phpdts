<script setup lang="ts">
// ══════════════════════════════════════════════════
// 单条日志 / Log Entry
//
// 替代现有 vex/js/log.js 的 htmlParts.map 渲染逻辑。
//
// 职责：
//   - 用 v-html 渲染 renderLogEntry(entry) 输出（HTML 字符串，含高亮 span）
//   - 显示 [TAG] 标签（MOV/EXP/SRC/PKG/DSC/EMY/BTL/SYS）
//   - 最后一条加 log-new class（CSS 动画 1.5s 高亮闪烁）
//   - debug 日志加 [DBG] 前缀 + log-debug class（暗化样式）
//
// v-html 安全性：renderLogEntry 输出的 HTML 中所有动态参数已通过 escapeHtml 转义。
// ══════════════════════════════════════════════════

import { computed } from 'vue';
import { renderLogEntry } from '@/data/log-templates';
import { LOGCATEGORY_TAGS } from '@/stores/log';
import type { LogEntry } from '@/types/api';

const props = defineProps<{
  entry: LogEntry;
  isNew: boolean; // 是否为最后一条（触发 log-new 高亮动画）
}>();

/** 日志类别标签（如 MOV / EXP / SYS） */
const tag = computed<string>(() => {
  return LOGCATEGORY_TAGS[props.entry.logcategory] || 'SYS';
});

/** 渲染后的 HTML 内容（空字符串表示无内容，由调用方过滤） */
const htmlContent = computed<string>(() => {
  return renderLogEntry(props.entry);
});

/** 容器 class（log-entry + log-new + log-debug） */
const containerClass = computed<string[]>(() => {
  const cls = ['log-entry'];
  if (props.isNew) cls.push('log-new');
  if (props.entry.debug) cls.push('log-debug');
  return cls;
});
</script>

<template>
  <span :class="containerClass">
    <span v-if="entry.debug" class="log-tag-dbg">[DBG]</span>
    <span class="log-tag">[{{ tag }}]</span>
    <!-- v-html 安全性：renderLogEntry 输出的 HTML 中所有动态参数已通过 escapeHtml 转义 -->
    <span v-html="htmlContent"></span>
  </span>
</template>
