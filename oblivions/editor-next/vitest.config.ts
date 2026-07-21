//
// Vitest 配置（对齐 NEW_DESIGN.md §4.1）
// 单元 + 组件测试，jsdom 环境用于 Vue Test Utils

import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    // 禁用 CSS 处理：单元测试不需要验证样式，避免 postcss 解析 color-mix / var() 等新语法报错
    css: false,
    include: [
      'tests/unit/**/*.test.ts',
      'tests/components/**/*.test.ts',
      'src/**/*.test.ts',
    ],
    exclude: ['tests/e2e/**', 'node_modules/**', 'dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts', 'src/**/*.vue'],
      exclude: ['src/**/*.test.ts', 'src/**/*.spec.ts', 'src/**/*.stories.ts'],
    },
  },
});
