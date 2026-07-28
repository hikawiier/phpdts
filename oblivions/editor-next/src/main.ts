// @module O 内容工具箱
// 应用入口：createApp + Pinia + Router + i18n + O 内容工具箱装配
//
// 装配顺序约束（P0-H）：
//   1. registerAllKinds() 必须在 createApp 之前——避免 Pinia store 初始化时
//      schema 缺失（O-3 graph-store / O-4 adapter-registry / O-10 validators 均依赖
//      schema 已注册）
//   2. createApp + use(createPinia()) 后才能调用 useGraphStore() / useValidateStore()
//   3. ensureSseClient() 不依赖 Pinia，可在 createApp 之后任意时机启动
//   4. loadWorkspace() 依赖 Pinia 已就位，但异步执行不阻塞 mount——Gateway 不可达
//      时返回 ok=false 但不抛异常，UI 可正常渲染空状态
//
// M8 主题生成器：启动时注册 5 个生成器到 registry
//   - 注册顺序不影响功能（registry 是 Map，按 ID 索引）
//   - 注册后 GeneratorsView 自动通过 listGenerators() 发现

import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { router } from './router';
import { i18n } from './i18n';
import './assets/styles/main.css';

// O 内容工具箱装配
import { registerAllKinds } from '@/schema';                        // O-2 Schema 注册表
import { ensureSseClient } from '@/services/workspace/sse-client';  // O-1 Gateway SSE
import { loadWorkspace } from '@/services/workspace/loader';        // O-4 工作区加载器

// M8 主题生成器注册
import { registerSampleGenerator } from '@/services/generators/sample-generator';
import { registerLabyrinthGenerator } from '@/services/generators/labyrinth-generator';
import { registerWetlandGenerator } from '@/services/generators/wetland-generator';
import { registerRuinsGenerator } from '@/services/generators/ruins-generator';
import { registerArchipelagoGenerator } from '@/services/generators/archipelago-generator';

// 1. 注册所有 kind schema（必须在 Pinia 装配前，避免 store 初始化时 schema 缺失）
registerAllKinds();

// 2. 注册 M8 主题生成器
registerSampleGenerator();
registerLabyrinthGenerator();
registerWetlandGenerator();
registerRuinsGenerator();
registerArchipelagoGenerator();

// 3. 创建 app 并装配 Pinia / Router / i18n
const app = createApp(App);
app.use(createPinia());
app.use(router);
app.use(i18n);

// 4. 启动 SSE 客户端（Gateway 状态订阅）
const sseClient = ensureSseClient();
sseClient.connect();

// 5. 装配 Resource Graph（异步加载，不阻塞 mount）
//    Gateway 不可达时返回 ok=false 但不抛异常，UI 可正常渲染空状态
loadWorkspace().then((result) => {
  if (!result.ok) {
    // eslint-disable-next-line no-console
    console.warn('[main] 工作区加载失败：', result.diagnostics);
  } else {
    // eslint-disable-next-line no-console
    console.info('[main] 工作区加载完成：', result.diagnostics);
  }
}).catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[main] 工作区加载异常：', err);
});

// 6. mount
app.mount('#app');
