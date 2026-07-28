<!-- @module O 内容工具箱 -->
<!-- @framework O-6 领域工作区信息架构 -->
<script setup lang="ts">
// 左侧导航（对齐 O-6 领域工作区信息架构）
//
// 7 项导航：总览 / 世界 / 模板 / 分布 / 呈现 / 验证 / 构建
// 兼容旧路由（/map / /generators）通过 router 重定向到 /world
//
// 设计意图（对齐设计案 §5.1）：
//   - 主导航按"领域工作区"组织，而非按文件或技术功能
//   - "随机生成"归入世界工作区命令，"配置编辑"被模板/分布/构建取代（P2+ 完成）
//   - icon 用 emoji 占位，P1 视觉重构时替换为 SVG 图标库
//
// 高亮策略：
//   - 路径前缀匹配会令 "/" 在所有路由上 active，因此禁用 active-class，
//     仅使用 exact-active-class 实现精确匹配高亮
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';

const { t } = useI18n();

interface NavItem {
  readonly key: string;
  readonly label: string;
  readonly icon: string;
  readonly to: string;
  readonly desc: string;
}

const NAV_ITEMS: readonly NavItem[] = [
  { key: 'overview', label: 'nav.overview', icon: 'home', to: '/', desc: '健康状态与工作流指南' },
  { key: 'world', label: 'nav.world', icon: 'map', to: '/world', desc: '编辑地图、区域、生成器' },
  { key: 'templates', label: 'nav.templates', icon: 'list', to: '/templates', desc: '定义道具/配方/敌人属性' },
  { key: 'distribution', label: 'nav.distribution', icon: 'grid', to: '/distribution', desc: '配置放置与刷新规则' },
  { key: 'presentation', label: 'nav.presentation', icon: 'text', to: '/presentation', desc: '编辑中文名与描述' },
  { key: 'validate', label: 'nav.validate', icon: 'check', to: '/validate', desc: '检查引用与镜像一致性' },
  { key: 'build', label: 'nav.build', icon: 'package', to: '/build', desc: '编译并发布到后端' },
] as const;

// P0 阶段用 emoji 占位；P1 视觉重构替换为 SVG 图标库
const ICON_GLYPH: Record<string, string> = {
  home: '🏠',
  map: '🗺',
  list: '📋',
  grid: '🗂',
  text: '📝',
  check: '✓',
  package: '📦',
};

function iconGlyph(icon: string): string {
  return ICON_GLYPH[icon] ?? '•';
}
</script>

<template>
  <nav
    class="flex w-40 shrink-0 flex-col border-r border-gray-800 bg-gray-900 py-2"
  >
    <RouterLink
      v-for="item in NAV_ITEMS"
      :key="item.key"
      :to="item.to"
      class="flex flex-col border-l-2 border-transparent px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 hover:text-gray-100"
      active-class=""
      exact-active-class="border-gray-400 bg-gray-800 text-gray-100"
      :title="item.desc"
    >
      <div class="flex items-center gap-2">
        <span class="w-4 text-center text-xs">{{ iconGlyph(item.icon) }}</span>
        <span>{{ t(item.label) }}</span>
      </div>
      <span class="mt-0.5 pl-6 text-[10px] leading-tight text-gray-500">{{ item.desc }}</span>
    </RouterLink>
  </nav>
</template>
