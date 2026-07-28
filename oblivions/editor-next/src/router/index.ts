// @module O 内容工具箱
// @framework O-6 领域工作区信息架构
// 路由表（7 个一级路由 + 兼容重定向，对齐 O-6 领域工作区信息架构）
//
// 重定向规则（P1 完整实现后）：
//   - /map → /world?tab=map（地图编辑归入世界工作区地图子 Tab）
//   - /generators → /world?tab=generator（生成器归入世界工作区生成子 Tab）
//   - /config 保留指向 ConfigView（P2 完成模板工作区后改为 /templates，P3 改为 /distribution）
//   - /validate 路径不变（视图复用，仅做 store API 最小适配）
//
// 设计意图（对齐设计案 §5.1）：
//   - 主导航按"领域工作区"组织，而非按文件或技术功能
//   - "随机生成"不再占一级导航，归入世界工作区的命令
//   - "配置编辑"被模板、分布和构建取代（P2+ 完成过渡）

import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';

export const ROUTE_NAMES = {
  overview: 'overview',
  world: 'world',
  templates: 'templates',
  distribution: 'distribution',
  presentation: 'presentation',
  validate: 'validate',
  build: 'build',
  // /config 保留为兼容路由（P2/P3 完成后改为重定向）
  config: 'config',
} as const;

export type RouteName = (typeof ROUTE_NAMES)[keyof typeof ROUTE_NAMES];

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: ROUTE_NAMES.overview,
    component: () => import('@/views/OverviewView.vue'),
    meta: { framework: 'O-6', titleKey: 'nav.overview' },
  },
  {
    path: '/world',
    name: ROUTE_NAMES.world,
    component: () => import('@/views/WorldView.vue'),
    meta: { framework: 'O-6', titleKey: 'nav.world' },
  },
  {
    path: '/templates',
    name: ROUTE_NAMES.templates,
    component: () => import('@/views/TemplatesView.vue'),
    meta: { framework: 'O-6', titleKey: 'nav.templates' },
  },
  {
    path: '/distribution',
    name: ROUTE_NAMES.distribution,
    component: () => import('@/views/DistributionView.vue'),
    meta: { framework: 'O-6', titleKey: 'nav.distribution' },
  },
  {
    path: '/presentation',
    name: ROUTE_NAMES.presentation,
    component: () => import('@/views/PresentationView.vue'),
    meta: { framework: 'O-6', titleKey: 'nav.presentation' },
  },
  {
    path: '/validate',
    name: ROUTE_NAMES.validate,
    component: () => import('@/views/ValidateView.vue'),
    meta: { framework: 'O-3', titleKey: 'nav.validate' },
  },
  {
    path: '/build',
    name: ROUTE_NAMES.build,
    component: () => import('@/views/BuildView.vue'),
    meta: { framework: 'O-6', titleKey: 'nav.build' },
  },
  // ─── 兼容路由 ─────────────────────────────────────
  // /config 保留指向 ConfigView（P1 阶段不重定向；P2/P3 后改指 /templates 或 /distribution）
  {
    path: '/config',
    name: ROUTE_NAMES.config,
    component: () => import('@/views/ConfigView.vue'),
    meta: { framework: 'O-2', titleKey: 'nav.config' },
  },
  // /map → /world?tab=map：地图编辑归入世界工作区地图子 Tab
  {
    path: '/map',
    redirect: { path: '/world', query: { tab: 'map' } },
  },
  // /generators → /world?tab=generator：生成器归入世界工作区生成子 Tab
  {
    path: '/generators',
    redirect: { path: '/world', query: { tab: 'generator' } },
  },
];

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
});
