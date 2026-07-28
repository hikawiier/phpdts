<!-- @module O 内容工具箱 -->
<script setup lang="ts">
//
// MapEditorView：兼容重定向入口（对齐 P1 执行案 §4.10.2）
//
// 设计意图：
//   - P1 把地图编辑主体迁移到 WorldView 的 MapTab 子组件
//   - 旧 /map 路由保留兼容重定向到 /world?tab=map
//   - 重定向通过 onMounted + router.replace 完成，避免在路由表中重复 redirect 配置
//     （路由表仍保留 redirect 配置作为最优先路径，此组件作为兜底）
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';

const router = useRouter();

onMounted(() => {
  void router.replace({ path: '/world', query: { tab: 'map' } });
});
</script>

<template>
  <div class="flex h-full items-center justify-center text-xs text-gray-500">
    重定向到 /world?tab=map ...
  </div>
</template>
