// 路由表（4 个视图，对齐 NEW_DESIGN.md §2.2 目录结构 + §9.2 views/ 列表）
// 模拟能力已整合进 MapEditorView 可折叠模拟面板（C-2），不再独立成视图

import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';

export const ROUTE_NAMES = {
  map: 'map',
  config: 'config',
  validate: 'validate',
  generators: 'generators',
} as const;

export type RouteName = (typeof ROUTE_NAMES)[keyof typeof ROUTE_NAMES];

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    redirect: { name: ROUTE_NAMES.map },
  },
  {
    path: '/map',
    name: ROUTE_NAMES.map,
    component: () => import('@/views/MapEditorView.vue'),
    meta: { framework: 'O-0', titleKey: 'nav.map' },
  },
  {
    path: '/config',
    name: ROUTE_NAMES.config,
    component: () => import('@/views/ConfigView.vue'),
    meta: { framework: 'O-2', titleKey: 'nav.config' },
  },
  {
    path: '/validate',
    name: ROUTE_NAMES.validate,
    component: () => import('@/views/ValidateView.vue'),
    meta: { framework: 'O-3', titleKey: 'nav.validate' },
  },
  {
    path: '/generators',
    name: ROUTE_NAMES.generators,
    component: () => import('@/views/GeneratorsView.vue'),
    meta: { framework: 'O-5', titleKey: 'nav.generators' },
  },
];

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
});
