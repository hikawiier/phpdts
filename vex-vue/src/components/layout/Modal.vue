<script setup lang="ts">
// ══════════════════════════════════════════════════
// 通用居中模态框 / Modal
//
// 替代现有 vex/index.html 的 #modalOverlay + #modal。
// 用于 tile-action 的探索/搜索/拾取交互（M4）。
//
// 布局（与现有 index.html 一致）：
//   遮罩（点击空白关闭）
//   ┌─ title ────────── [X]
//   body（HTML 内容）
//
// 开关控制：uiStore.modalOpen
// 内容：uiStore.modalTitle + uiStore.modalBodyHtml（v-html 渲染）
// ══════════════════════════════════════════════════

import { useUiStore } from '@/stores/ui';

const uiStore = useUiStore();

/** 点击遮罩空白处关闭（与现有 app.js 一致：e.target === overlay） */
function onOverlayClick(e: MouseEvent): void {
  if (e.target === e.currentTarget) {
    uiStore.closeModal();
  }
}
</script>

<template>
  <div
    class="modal-overlay"
    :class="{ open: uiStore.modalOpen }"
    @click="onOverlayClick"
  >
    <div class="modal">
      <div class="modal-header">
        <span class="modal-title">{{ uiStore.modalTitle }}</span>
        <button class="modal-close" @click="uiStore.closeModal">[X]</button>
      </div>
      <!-- v-html 渲染调用方注入的 HTML（与现有 modalBody.innerHTML 一致） -->
      <div class="modal-body" v-html="uiStore.modalBodyHtml"></div>
    </div>
  </div>
</template>
