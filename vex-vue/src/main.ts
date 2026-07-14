/**
 * @module K 状态管理层
 */

import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { useToastStore } from '@/stores/toast';
import './assets/styles/input.css';
import './assets/styles/terminal.css';
import './assets/styles/battle.css';

const app = createApp(App);
const pinia = createPinia();
app.use(pinia);

// ── 全局错误处理 ──
// 捕获 Vue 组件渲染/生命周期错误（mount 前注册以捕获初始渲染错误）
app.config.errorHandler = (err, _instance, info) => {
  console.error('[Vue] errorHandler:', err, info);
  try {
    useToastStore().showToast('界面异常，请刷新', 'error', 4000, false, 'global-error');
  } catch {
    // Pinia 未就绪时仅 console
  }
};

app.mount('#app');

// 捕获运行时同步错误（mount 后注册，Pinia 已就绪）
window.addEventListener('error', (event) => {
  console.error('[Window] error:', event.error ?? event.message);
  try {
    useToastStore().showToast('运行异常，请刷新', 'error', 4000, false, 'global-error');
  } catch {
    // 忽略
  }
});

// 捕获未处理的 Promise rejection
window.addEventListener('unhandledrejection', (event) => {
  console.error('[Window] unhandledrejection:', event.reason);
  try {
    useToastStore().showToast('异步异常，请刷新', 'error', 4000, false, 'global-error');
  } catch {
    // 忽略
  }
});
