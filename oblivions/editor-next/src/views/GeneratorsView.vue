<script setup lang="ts">
//
// GeneratorsView：随机生成视图（对齐 NEW_DESIGN.md §3.7.6 + Dian.md O-4）
//
// 设计意图（对齐 2.6 配置驱动 + 2.15 灰阶基底）：
//   - 顶部工具栏：标题 + 项目状态摘要（区域数 / 地图格数）
//   - 主内容：生成器卡片网格（schema 驱动渲染每个生成器入口）
//   - 双入口按钮：
//     · "全项目生成"：打开 GeneratorModal mode='full'（覆盖式，弹 confirm）
//     · "追加区域生成"：打开 GeneratorModal mode='region'（追加式，无 confirm）
//   - 视觉对齐 2.15：卡片用灰阶，hover 反馈用灰阶过渡
//   - 挂载 GeneratorModal 由本视图负责（与 BackendView 挂载 BackupModal 模式一致）
//
// 数据流：
//   - 生成器列表：listGenerators() 从 registry 读取
//   - 模态打开：ui.openGeneratorModal(mode, returnFocusEl) 传触发按钮 DOM 用于焦点恢复
//   - 模态：GeneratorModal 内部处理生成 + 验证 + 写入 store

import { computed } from 'vue';
import { useUiStore } from '@/stores/uiStore';
import { useProjectStore } from '@/stores/projectStore';
import { listGenerators, hasGenerators } from '@/services/generators/registry';
import type { Generator } from '@/shared';
import BaseButton from '@/components/common/BaseButton.vue';
import GeneratorModal from '@/components/modals/GeneratorModal.vue';

const ui = useUiStore();
const project = useProjectStore();

const generators = computed<Generator[]>(() => listGenerators());
const hasAnyGenerator = computed(() => hasGenerators());
const hasProject = computed(() => project.hasProject);
const regionCount = computed(() => project.regionCount);

/**
 * 打开全项目模态（覆盖式，弹 confirm 提示备份风险）
 * 触发按钮作为 returnFocusEl，模态关闭后焦点恢复
 */
function openFull(event: Event): void {
  const target = event.currentTarget as HTMLButtonElement;
  ui.openGeneratorModal('full', target);
}

/**
 * 打开单区域模态（追加式，无 confirm）
 * 触发按钮作为 returnFocusEl，模态关闭后焦点恢复
 */
function openRegion(event: Event): void {
  const target = event.currentTarget as HTMLButtonElement;
  ui.openGeneratorModal('region', target);
}
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden">
    <!-- 顶部工具栏 -->
    <div class="flex items-center justify-between border-b border-gray-800 px-2 py-1">
      <div class="flex items-center gap-2 text-xs">
        <span class="text-gray-300">随机生成</span>
        <span
          class="rounded border border-gray-800 bg-gray-900 px-1 py-0.5 text-[10px] text-gray-600"
        >
          {{ hasAnyGenerator ? `${generators.length} 个生成器` : '无生成器' }}
        </span>
        <span
          v-if="hasProject"
          class="rounded border border-gray-700 bg-gray-800 px-1 py-0.5 text-[10px] text-gray-300"
        >
          当前项目 {{ regionCount }} 个区域
        </span>
      </div>
      <div class="flex items-center gap-2">
        <BaseButton
          variant="primary"
          size="sm"
          :disabled="!hasAnyGenerator"
          title="生成结果将覆盖当前项目的所有区域"
          @click="openFull"
        >
          全项目生成
        </BaseButton>
        <BaseButton
          variant="default"
          size="sm"
          :disabled="!hasAnyGenerator"
          title="生成结果将作为新区域追加到当前项目"
          @click="openRegion"
        >
          追加区域生成
        </BaseButton>
      </div>
    </div>

    <!-- 主内容：生成器卡片网格 -->
    <div class="flex-1 overflow-auto p-3">
      <div
        v-if="!hasAnyGenerator"
        class="flex h-full items-center justify-center text-gray-500"
      >
        <div class="text-center">
          <h2 class="mb-2 text-lg text-gray-300">无可用生成器</h2>
          <p class="text-sm">生成器需要在应用启动时注册到 registry</p>
        </div>
      </div>

      <div
        v-else
        class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
      >
        <div
          v-for="gen in generators"
          :key="gen.id"
          class="rounded border border-gray-800 bg-gray-900 p-3 hover:border-gray-700 transition-colors"
        >
          <div class="mb-2 flex items-center justify-between">
            <h3 class="text-sm font-medium text-gray-200">{{ gen.name }}</h3>
            <span class="text-[10px] text-gray-600 font-mono">#{{ gen.id }}</span>
          </div>
          <p class="text-xs text-gray-500 mb-3 min-h-[2.5rem]">
            {{ gen.description }}
          </p>
          <div class="flex gap-1 flex-wrap">
            <span
              v-for="field in gen.getParamSchema().slice(0, 4)"
              :key="field.key"
              class="rounded border border-gray-800 bg-gray-950 px-1.5 py-0.5 text-[10px] text-gray-500"
            >
              {{ field.label }}
            </span>
            <span
              v-if="gen.getParamSchema().length > 4"
              class="text-[10px] text-gray-600 self-center"
            >
              +{{ gen.getParamSchema().length - 4 }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- 生成器双模式模态框（由顶部按钮触发） -->
    <GeneratorModal />
  </div>
</template>
