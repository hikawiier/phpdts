# Oblivions 开发者工具箱（editor-next）

Oblivions 游戏的内容编辑、校验、编译与运行时镜像工具箱。读写本地 gamedata PHP 文件与 vex-vue TS locale 文件，不直接访问数据库。

## 快速启动

### 前置要求

- Node.js 20+
- pnpm 11+
- PHP CLI（仅 `php -l` 语法检查需要）

### 一键启动

```bash
cd oblivions/editor-next
pnpm install          # 首次安装依赖（含 server 子目录）
pnpm dev:all          # 同时启动 Gateway + 编辑器
```

启动后打开浏览器访问 **http://localhost:5175/**

### 分别启动

如果只想启动其中一个：

```bash
pnpm dev:gateway      # 仅启动 Workspace Gateway（端口 5180）
pnpm dev              # 仅启动编辑器（端口 5175）
```

### 配置文件

`editor.config.json` 指定工作区路径，默认值通常无需修改：

```json
{
  "workspaceRoot": "../..",
  "gamedataPath": "oblivions/gamedata",
  "vexVueDataPath": "vex-vue/src/data",
  "backupPath": "oblivions/editor-next/.backups"
}
```

- `workspaceRoot`：工作区根路径（相对 editor-next/，默认指向 phpdts/）
- `gamedataPath`：PHP 游戏数据目录（相对 workspaceRoot）
- `vexVueDataPath`：前端 locale 文件目录（相对 workspaceRoot）
- `backupPath`：编译发布备份目录

## 两个服务是什么

| 服务 | 端口 | 作用 |
|---|---|---|
| **编辑器**（Vite dev server） | 5175 | 浏览器中打开的 Vue 应用，提供 UI 界面 |
| **Workspace Gateway** | 5180 | 本地 Node 服务，代替浏览器直接读写文件系统 |

浏览器无法直接读写磁盘文件，所以 Gateway 充当"文件代理"——编辑器通过 HTTP 请求让 Gateway 读写文件。

**不需要单独启动 Gateway**——`pnpm dev:all` 会同时启动两个。

## 功能页面

| 页面 | 路径 | 功能 |
|---|---|---|
| 总览 | `/` | 工作区统计、作者资源状态、Gateway 连接状态 |
| 世界 | `/world` | 地图编辑器、区域配置 |
| 模板 | `/templates` | 道具/配方/敌人/POI 模板编辑 |
| 分布 | `/distribution` | POI/敌人分布规则 |
| 呈现 | `/presentation` | 中英文呈现文案、漂移报告 |
| 验证 | `/validate` | 8 层校验 + 镜像校验 |
| 构建 | `/build` | 九步编译管道 + 发布 + 备份历史 |

## 其他命令

```bash
pnpm build        # 类型检查 + 生产构建
pnpm test         # 运行单元测试
pnpm typecheck    # 仅类型检查（vue-tsc --noEmit）
```

## 技术栈

- Vue 3.5 + Vite 6 + TypeScript 5.7
- Pinia 2.3（状态管理）
- Tailwind CSS v4（样式）
- Vue Router 4（路由）
- Vue I18n 10（中英文国际化）
- Express 4（Workspace Gateway 服务端）
- Vitest 2（单元测试）

## 目录结构

```
editor-next/
├── src/                        # 编辑器源码
│   ├── views/                  # 7 个功能页面
│   ├── components/             # Vue 组件
│   ├── stores/                 # Pinia store
│   ├── graph/                  # Resource Graph（O-3）
│   ├── schema/                 # Schema 注册表（O-2）
│   ├── adapters/               # 源文件适配器（O-4）
│   ├── build/                  # 编译管道（O-5/O-11）
│   ├── validate/               # 8 层校验（O-10）
│   ├── mirror/                 # 运行时镜像校验（O-12）
│   ├── shared/                 # 共享库（类型/算法/常量）
│   └── services/               # 服务层
├── server/                     # Workspace Gateway（O-1）
│   └── src/
│       ├── main.ts             # Gateway 入口
│       ├── config.ts           # 配置加载
│       └── routes/             # HTTP 路由
├── editor.config.json          # 工作区路径配置
├── vite.config.ts              # Vite 配置（含 Gateway 代理）
└── package.json
```
