# Oblivions 地图编辑器（editor-next）

纯前端瓦片地图编辑器，用于离线编辑 Oblivions 游戏的地图数据与配置文件。读取本地静态 gamedata PHP 文件，与 Oblivions 后端运行时无直接契约——后端通过 `obl_get_map_data()` 直接 require gamedata PHP 文件 + 原生 SQL 操作 DB 表，编辑器仅读写 gamedata PHP 文件，不触碰 DB。

## 技术栈

- Vue 3.5 + Vite 6 + TypeScript 5.7
- Pinia 2.3（状态管理）
- Tailwind CSS v4（样式）
- Vue Router 4（路由）
- Vue I18n 10（中英文国际化）
- Vitest 2（单元测试）+ Playwright（E2E）+ Storybook 8（组件预览）

## 开发命令

```bash
pnpm install      # 安装依赖（首次）
pnpm dev          # 启动开发服务器（端口 5175）
pnpm build        # 类型检查 + 生产构建
pnpm test         # 运行单元测试
pnpm typecheck    # 仅类型检查（vue-tsc --noEmit）
pnpm storybook    # 启动 Storybook 组件预览
pnpm test:e2e     # 运行 Playwright E2E 测试
```

## 目录结构

```
editor-next/
├── src/
│   ├── shared/              # 内联共享库（类型 / 算法 / 序列化器 / 常量集）
│   │   ├── algorithms/      # BFS 视野/可达性/连通性/最短路径 + 种子化 PRNG
│   │   ├── constants/       # floor/tide/limits/schema 常量集
│   │   ├── serializer/      # PHP 数组解析器 / 代码生成器 / 编辑器字段剥离
│   │   ├── types/           # 地图/配置/生成器/验证类型定义
│   │   └── index.ts         # 桶导出
│   ├── components/          # Vue 组件（common/grid/overlays/panels/modals/config-editors/layout）
│   ├── composables/         # 组合式函数（键盘/工具/导入导出/叠层渲染）
│   ├── services/            # 服务层（文件 IO / Worker 桥 / ZIP / 验证规则 / 生成器）
│   ├── stores/              # Pinia store（项目/工具/配置/历史/模拟/叠层/验证/UI）
│   ├── views/               # 路由视图（地图编辑/配置/验证/生成器）
│   ├── workers/             # Web Worker（PHP 解析）
│   ├── i18n/                # 中英文文案
│   ├── router/              # 路由表
│   └── assets/              # 静态资源（Tailwind 入口 CSS）
├── tests/
│   ├── components/          # 组件测试
│   ├── unit/                # 单元测试（stores/services/composables/integration/perf/shared）
│   └── setup.ts             # Vitest 全局 setup
├── .storybook/              # Storybook 配置
├── public/                  # 静态公共资源
├── index.html               # Vite 入口 HTML
├── vite.config.ts           # Vite 配置
├── vitest.config.ts         # Vitest 配置
├── tsconfig.json            # TypeScript 配置（@ → src/）
├── tailwind.config.ts       # Tailwind 配置
├── playwright.config.ts     # Playwright 配置
└── package.json
```

## 核心设计原则

以下原则参考 `oblivions/DESIGN.md` 相关节，作为设计参考而非强制约束（editor-next 已从 Dian.md 模块体系中独立）：

- **2.13 v-for 管理子树**：网格渲染通过 `v-for` + 响应式 `:class` 驱动所有视觉态，禁止命令式 DOM 操作。大地图 PHP 解析放入 Web Worker 避免阻塞主线程。
- **2.14 统一键盘快捷键**：`useEditorKeyboard` 组合式函数集中管理所有快捷键，模态框优先级统一调度。
- **2.15 灰阶基底 + 唯一强调色**：正常态全用灰阶（9 阶），仅 error 红作为唯一强调色。不引入 ASCII 字符装饰，中文 UI 保持视觉一致性。
- **3.4 注意力稀缺**：默认折叠非核心面板（Simulate 叠层组、SimulatePanel），叠层激活时与格内容互斥以避免视觉杂糅。

## 与 Oblivions 后端的关系

编辑器是**纯前端工具**，与 Oblivions 后端运行时完全解耦：

- 编辑器读写 gamedata 目录下的 PHP 文件（地图数据 `obl_*.php`、配置 `scatter_pool.php` / `poi_table.php` / `poi_pool.php`）
- 后端运行时通过 `obl_get_map_data()` 直接 require 这些 PHP 文件，并通过原生 SQL 操作 DB 表（`bra_oblmapitem` / `bra_oblmappoi` / `bra_oblmapstates`）
- 编辑器不直接访问 DB，不与后端 API 通信，不参与运行时游戏逻辑
- BFS 算法（视野/可达性/连通性）从后端移植为 `src/shared/algorithms/` 中的纯函数，语义对齐但实现独立
