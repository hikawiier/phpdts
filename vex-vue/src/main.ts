/**
 * @module K 状态管理层
 */

import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { useToastStore } from '@/stores/toast';
import { validateBattleTemplates } from '@/data/battle-templates';
import { animationTrace } from '@/utils/animation-trace';
import './assets/styles/input.css';
import './assets/styles/terminal.css';
import './assets/styles/battle.css';

const app = createApp(App);
const pinia = createPinia();
app.use(pinia);

// ── 开发模式：跨层契约校验 ──
// 校验 BATTLE_TEMPLATES 字典对后端已知枚举值的覆盖度（§3.3 跨层契约可校验）
if (import.meta.env.DEV) {
  validateBattleTemplates();
  // 动画追踪：挂载全局对象供浏览器侧调用
  // window.__PHPDTS_TRACE.events() / clear() / summary() / download() / tail() / filter() / since()
  window.__PHPDTS_TRACE = animationTrace;
  console.log(
    '%c[ANIMATION_TRACE] global ready: window.__PHPDTS_TRACE.events() / summary() / download()',
    'font-weight:bold;background:#334155;color:#e2e8f0;padding:2px 4px;border-radius:3px;',
  );
}

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
