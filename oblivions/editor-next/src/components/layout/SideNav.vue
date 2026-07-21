<script setup lang="ts">
// 左侧导航（对齐 NEW_DESIGN.md §2.2 components/layout/SideNav.vue）
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { ROUTE_NAMES } from '@/router';

const { t } = useI18n();

interface NavItem {
  readonly name: (typeof ROUTE_NAMES)[keyof typeof ROUTE_NAMES];
  readonly labelKey: string;
  readonly framework: string;
}

const items: NavItem[] = [
  { name: ROUTE_NAMES.map, labelKey: 'nav.map', framework: 'O-0' },
  { name: ROUTE_NAMES.config, labelKey: 'nav.config', framework: 'O-2' },
  { name: ROUTE_NAMES.validate, labelKey: 'nav.validate', framework: 'O-3' },
  { name: ROUTE_NAMES.generators, labelKey: 'nav.generators', framework: 'O-5' },
];
</script>

<template>
  <nav
    class="flex w-40 shrink-0 flex-col border-r border-gray-800 bg-gray-900 py-2"
  >
    <RouterLink
      v-for="item in items"
      :key="item.name"
      :to="{ name: item.name }"
      class="border-l-2 border-transparent px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 hover:text-gray-100"
      active-class="border-gray-400 bg-gray-800 text-gray-100"
    >
      {{ t(item.labelKey) }}
    </RouterLink>
  </nav>
</template>
