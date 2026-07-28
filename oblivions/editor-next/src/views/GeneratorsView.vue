<!-- @module O 内容工具箱 -->
<script setup lang="ts">
//
// GeneratorsView：兼容重定向入口（对齐 P1 执行案 §4.10.3）
//
// 设计意图：
//   - P1 把生成器主体迁移到 WorldView 的 GeneratorTab 子组件
//   - 旧 /generators 路由保留兼容重定向到 /world?tab=generator
//   - 重定向通过 onMounted + router.replace 完成
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';

const router = useRouter();

onMounted(() => {
  void router.replace({ path: '/world', query: { tab: 'generator' } });
});
</script>

<template>
  <div class="flex h-full items-center justify-center text-xs text-gray-500">
    重定向到 /world?tab=generator ...
  </div>
</template>
