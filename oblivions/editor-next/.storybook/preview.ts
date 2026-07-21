//
// Storybook preview（对齐 NEW_DESIGN.md §4.4）

import type { Preview } from '@storybook/vue3';
import { createPinia } from 'pinia';
import { createI18n } from 'vue-i18n';
import { setup } from '@storybook/vue3';
import zhCN from '../src/i18n/zh-CN';
import enUS from '../src/i18n/en-US';
import '../src/assets/styles/main.css';

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  fallbackLocale: 'en-US',
  messages: { 'zh-CN': zhCN, 'en-US': enUS },
  missingWarn: false,
  fallbackWarn: false,
});

setup((app) => {
  app.use(createPinia());
  app.use(i18n);
});

const preview: Preview = {
  parameters: {
    actions: { argTypesRegex: '^on[A-Z].*' },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    backgrounds: {
      default: 'dark',
      values: [
        { name: 'dark', value: '#111111' },
        { name: 'light', value: '#f5f5f5' },
      ],
    },
  },
};

export default preview;
