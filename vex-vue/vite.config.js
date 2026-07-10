import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';
import http from 'node:http';

// 保持 TCP 连接复用，避免 Vite proxy 每次请求重新建立连接（~300ms → ~5ms）
const proxyAgent = new http.Agent({ keepAlive: true, maxSockets: 10 });

// 部署路径：生产环境 /phpdts/vex-vue/，开发环境 /（dev server 根路径）
export default defineConfig(({ command }) => ({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  base: command === 'build' ? '/phpdts/vex-vue/' : '/',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          'vue-vendor': ['vue', 'pinia'],
        },
      },
    },
  },
  server: {
    port: 5174,
    proxy: {
      '/phpdts/oblivions/api/command.php': {
        target: 'http://127.0.0.1',
        changeOrigin: true,
        agent: proxyAgent,
      },
      '/phpdts/oblivions/api/heartbeat.php': {
        target: 'http://127.0.0.1',
        changeOrigin: true,
        agent: proxyAgent,
      },
      '/phpdts/oblivions/api/state.php': {
        target: 'http://127.0.0.1',
        changeOrigin: true,
        agent: proxyAgent,
      },
      '/phpdts/img/': {
        target: 'http://127.0.0.1',
        changeOrigin: true,
        agent: proxyAgent,
      },
    },
  },
}));
