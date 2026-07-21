// 应用入口（对齐 NEW_DESIGN.md §2.2：createApp + Pinia + Router + i18n）
//
// M8 扩展：启动时注册 5 个主题生成器到 registry
//   - 注册顺序不影响功能（registry 是 Map，按 ID 索引）
//   - 注册后 GeneratorsView 自动通过 listGenerators() 发现

import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { router } from './router';
import { i18n } from './i18n';
import './assets/styles/main.css';
import { registerSampleGenerator } from '@/services/generators/sample-generator';
import { registerLabyrinthGenerator } from '@/services/generators/labyrinth-generator';
import { registerWetlandGenerator } from '@/services/generators/wetland-generator';
import { registerRuinsGenerator } from '@/services/generators/ruins-generator';
import { registerArchipelagoGenerator } from '@/services/generators/archipelago-generator';

// 注册 M8 主题生成器到 registry（对齐 §3.7.2 + Dian.md O-5）
registerSampleGenerator();
registerLabyrinthGenerator();
registerWetlandGenerator();
registerRuinsGenerator();
registerArchipelagoGenerator();

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.use(i18n);
app.mount('#app');
