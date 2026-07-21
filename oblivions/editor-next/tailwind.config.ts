//
// Tailwind v4 配置（对齐 vex-vue + 设计案 §0.2 灰阶基底 + 唯一强调色 token）
// 唯一强调色仅 error 红 #ff5555（C-6：路径绿已下线，路径线改用灰阶白 gray-100）
// Tide 三档用灰阶亮度区分，floor 用 CSS 形状纹理，POI / wild item 用形状字符 + 计数徽章

import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{vue,ts,tsx,js,jsx}'],
  theme: {
    extend: {
      colors: {
        // 灰阶基底（9 阶）
        gray: {
          50: '#f5f5f5',
          100: '#eeeeee',
          200: '#e5e5e5',
          300: '#cccccc',
          400: '#aaaaaa',
          500: '#888888',
          600: '#666666',
          700: '#444444',
          800: '#222222',
          900: '#111111',
        },
        // 唯一强调色 token（仅 error，C-6：path 已下线）
        accent: {
          error: '#ff5555', // ValidatePanel error 级问题
        },
        // Tide 三档灰阶亮度（OverlayTideHeatmap）
        tide: {
          shallow: '#cccccc',
          deep: '#888888',
          abyss: '#444444',
        },
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
