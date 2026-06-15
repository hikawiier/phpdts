# OBLIVIONS — Vex Frontend

ASCII 终端风格的大逃杀游戏前端界面。

## 快速开始

```bash
npm install
npm run dev
```

`npm run dev` 启动 Tailwind 监听模式，自动重编译 CSS。浏览器访问 `http://localhost/phpdts/vex/`。

## 脚本

| 命令 | 说明 |
|------|------|
| `npm run dev` | 监听模式，文件变化自动重编译 CSS |
| `npm run build` | 生产构建，输出压缩 CSS |

## 目录结构

```
vex/
├── css/
│   ├── input.css       # Tailwind 入口（主题色板定义）
│   ├── output.css      # 构建产物（git 忽略）
│   └── terminal.css    # 自定义样式（CRT 特效、动画、组件类）
├── js/
│   ├── app.js          # 入口，全局事件绑定
│   ├── map.js          # 地图渲染与移动
│   ├── tile-action.js  # 地格交互（搜索/拾取/探索）
│   ├── inventory.js    # 背包与装备
│   ├── player.js       # 玩家信息抽屉
│   ├── log.js          # 日志（事件驱动）
│   ├── data.js         # 全局配置与 DebugBus
│   ├── data-manager.js # 数据层（缓存/去重/事件订阅）
│   ├── command-queue.js # 命令队列（防抖/防重复提交）
│   ├── utils.js        # 工具函数
│   └── debug.js        # 调试面板（?debug=ai 时加载）
├── index.html
└── package.json
```

## CSS 开发说明

- **`terminal.css`**：直接编辑，刷新即生效
- **Tailwind 类名/主题色**：编辑 `css/input.css` 或在 HTML/JS 中使用新类名后，需 `npm run dev` 或 `npm run build` 重新编译

## 调试

URL 加 `?debug=ai` 启用调试面板。
