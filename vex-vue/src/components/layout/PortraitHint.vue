<script setup lang="ts">
/**
 * @module K 状态管理层
 */
// ══════════════════════════════════════════════════
// PortraitHint — 竖屏旋转提示
//
// 对齐 B6.27-B6.29 / 设计案 §7.2：
//   - 竖屏不承载正式游戏操作
//   - 只显示简洁的旋转设备提示
//   - 不进入正式游戏布局
//
// 纯展示组件：姿态检测由父层（App.vue matchMedia orientation: portrait）
// 负责，本组件只负责渲染。fixed inset:0 z-index:9999 覆盖一切。
//
// 视觉语言：灰阶配色 + ASCII 标题 + 等宽字体 + 终端美学（§2.15）
// ══════════════════════════════════════════════════
</script>

<template>
  <div class="portrait-hint">
    <div class="portrait-hint-card">
      <div class="portrait-hint-icon">⟳</div>
      <div class="ascii-title">
        <span>┌─</span>
        <span class="ascii-label">ROTATE DEVICE</span>
        <span>─</span>
        <span class="flex-1 ascii-line"></span>
        <span>┐</span>
      </div>
      <p class="portrait-hint-text">请将设备旋转至横屏以进入游戏</p>
      <p class="portrait-hint-sub">横屏为本作主设计基准</p>
    </div>
  </div>
</template>

<style scoped>
.portrait-hint {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #0a0a0a;
  z-index: 9999;
}
.portrait-hint-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 32px 28px;
  border: 1px solid rgba(68, 68, 68, 0.5);
  background: rgba(255, 255, 255, 0.02);
  max-width: 80vw;
}
.portrait-hint-icon {
  font-size: 56px;
  color: #888;
  animation: portrait-rotate 2.4s ease-in-out infinite;
  line-height: 1;
}
.portrait-hint-text {
  color: #bbb;
  font-size: 13px;
  letter-spacing: 0.05em;
  text-align: center;
}
.portrait-hint-sub {
  color: #555;
  font-size: 10px;
  letter-spacing: 0.15em;
  text-align: center;
}
@keyframes portrait-rotate {
  0%, 100% { transform: rotate(0deg); }
  50% { transform: rotate(90deg); }
}
</style>
