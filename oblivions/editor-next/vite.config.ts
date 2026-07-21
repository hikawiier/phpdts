//
// Vite 配置（与 vex-vue 对齐：Vue 3 + Vite 6 + Tailwind v4）
// 端口 5175（与 vex-vue 5174 区分，对齐 NEW_DESIGN.md §2.2）

import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';
import http from 'node:http';

// 保持 TCP 连接复用（对齐 vex-vue 配置）
const proxyAgent = new http.Agent({ keepAlive: true, maxSockets: 10 });

export default defineConfig(({ command }) => ({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  base: command === 'build' ? '/phpdts/oblivions/editor-next/' : '/',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          'vue-vendor': ['vue', 'pinia', 'vue-router', 'vue-i18n'],
        },
      },
    },
  },
  server: {
    port: 5175,
    // 允许 vite dev server 通过 /@fs/ 前缀访问项目上级目录
    // 用于 importFromPresetPath：从 editor.config.json 预设的 gamedataPath 读取 .php 文件
    // 范围：'..' = oblivions/，'../..' = phpdts/（覆盖预设路径 oblivions/gamedata/）
    fs: {
      allow: ['..', '../..'],
    },
    proxy: {
      '/phpdts/oblivions/api/command.php': {
        target: 'http://127.0.0.1',
        changeOrigin: true,
        agent: proxyAgent,
      },
      '/phpdts/oblivions/api/state.php': {
        target: 'http://127.0.0.1',
        changeOrigin: true,
        agent: proxyAgent,
      },
    },
  },
  worker: {
    format: 'es',
  },
}));
