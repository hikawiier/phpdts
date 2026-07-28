<!-- @module O 内容工具箱 -->
<script setup lang="ts">
//
// ValidateView：验证视图（O-6 领域工作区一级路由）
//
// 研判：
//   - 验证工具集的视图入口
//   - 跳转 issue 通过 projectStore.setCurrentPgroup / setSelectedPls
//   - includeConfig 开关控制是否读取 configStore 数据
//   - P6 新增：镜像校验段（MirrorCheckSection）展示镜像器状态
//
// 设计意图（对齐 §3.5 + 2.15 视觉 + P6 §4.7.1）：
//   - 顶部工具栏：运行 Full 验证按钮 + Light 验证状态 + includeConfig 开关 + 汇总
//   - 主内容：ValidatePanel（issue 列表 + 过滤 + 跳转）
//   - 底部：MirrorCheckSection（P6 新增——镜像器状态 + 差异列表 + 不变量违反）
//   - 点击 issue 跳转到 MapEditorView 并选中对应 (pgroup, pls)
//   - 视觉对齐 2.15：灰阶基底 + 唯一强调色（accent-error 仅用于错误统计 + 错误按钮）
//   - 生成器闭环（M8）：生成器写入 projectStore 后调用 validate.runFull({ includeConfig: false })
//
// 数据流：
//   - 触发：validate.runFull() / validate.runLight() / validate.runMirrorValidation()
//   - 读取：validate.filteredIssues / errorCount / warningCount / summary
//   - 镜像：validate.mirrorStatusList / mirrorBlockingCount / hasMirrorBackendUnavailable
//   - 跳转：emit('jump', location) → router.push({ name: 'world' }) + projectStore 跳转
//
// O-6 + O-10 适配（P0-G/P0-H）：
//   - 路由路径不变（/validate 仍为一级路由），但 issue 跳转目标从 /map 改为 /world
//   - validateStore 已重构为从 graph-store 查询 loot.table / item.template 节点 ID 集合
//   - "完整验证"按钮启用条件：projectStore.hasProject || graphStore.nodeCount > 0
//     P0 阶段 graph-store 通过 Gateway 加载，即使 projectStore 未导入项目也能运行引用校验
//
// P6 扩展（执行案 §4.7.1）：
//   - 新增 MirrorCheckSection 段，展示镜像器的当前状态与最近一次对比结果
//   - 镜像校验独立于同步 issues——通过 validate.mirrorResults state 单独追踪
//   - 用户可手动触发镜像校验（不依赖编译管道第 9 步）

import { computed, onMounted, onBeforeUnmount } from 'vue';
import { useRouter } from 'vue-router';
import { useValidateStore } from '@/stores/validateStore';
import { useProjectStore } from '@/stores/projectStore';
import { useConfigStore } from '@/stores/configStore';
import { useUiStore } from '@/stores/uiStore';
import { useGraphStore } from '@/graph/graph-store';
import ValidatePanel from '@/components/panels/ValidatePanel.vue';
import MirrorCheckSection from '@/components/validate/MirrorCheckSection.vue';
import BaseButton from '@/components/common/BaseButton.vue';
import BaseCheckbox from '@/components/common/BaseCheckbox.vue';
import type { ValidateIssueLocation } from '@/shared';

const validate = useValidateStore();
const project = useProjectStore();
const config = useConfigStore();
const ui = useUiStore();
const graph = useGraphStore();
const router = useRouter();

// ─── 汇总信息 ──────────────────────────────────────
const errorCount = computed(() => validate.errorCount);
const warningCount = computed(() => validate.warningCount);
const hasConfig = computed(() => config.hasConfig);
const lastRunMode = computed(() => validate.lastRunMode);

// P0 阶段：graph-store 加载完成后即可运行校验，无需 projectStore 导入项目
const canRunValidation = computed(() => project.hasProject || graph.nodeCount > 0);

// ─── 运行验证 ──────────────────────────────────────
function handleRunFull(): void {
  validate.runFull();
  ui.showToast(
    `验证完成（${validate.errorCount} 错误，${validate.warningCount} 警告）`,
    validate.errorCount > 0 ? 'error' : 'success',
  );
}

function handleRunLight(): void {
  validate.runLight();
  ui.showToast(
    `Light 验证完成（${validate.errorCount} 错误，${validate.warningCount} 警告）`,
    validate.errorCount > 0 ? 'error' : 'info',
  );
}

// ─── includeConfig 开关 ────────────────────────────
function handleToggleIncludeConfig(value: boolean): void {
  validate.setIncludeConfig(value);
}

// ─── issue 跳转 ────────────────────────────────────
function handleJump(location: ValidateIssueLocation): void {
  if (location.pgroup != null) {
    project.setCurrentPgroup(location.pgroup);
    if (location.pls != null) {
      project.setSelectedPls(location.pls);
    }
    void router.push({ name: 'world' });
  }
}

// ─── 切换到 ValidateView 时自动跑一次 Light 验证 ─────
onMounted(() => {
  if (project.hasProject && validate.lastRunMode === null) {
    validate.runLight();
  }
});

onBeforeUnmount(() => {
  validate.cancelScheduledLight();
});
</script>

<template>
  <div class="flex h-full flex-col gap-2 overflow-hidden">
    <!-- 顶部工具栏 -->
    <div class="flex items-center justify-between border-b border-gray-800 px-2 py-1">
      <div class="flex items-center gap-2 text-xs">
        <span class="text-gray-300">验证</span>
        <span
          v-if="lastRunMode === 'light'"
          class="rounded border border-gray-700 px-1 py-0.5 text-[10px] text-gray-400"
        >
          Light 实时
        </span>
        <span
          v-else-if="lastRunMode === 'full'"
          class="rounded border border-gray-500 px-1 py-0.5 text-[10px] text-gray-200"
        >
          Full 完整
        </span>
        <span v-if="errorCount > 0" class="text-[10px] text-accent-error">
          {{ errorCount }} 错误
        </span>
        <span v-if="warningCount > 0" class="text-[10px] text-gray-500">
          {{ warningCount }} 警告
        </span>
      </div>
      <div class="flex items-center gap-1">
        <label class="flex cursor-pointer items-center gap-1 text-[10px] text-gray-400" title="启用配置交叉引用校验（poi_pool / loot_table_id / scatter item_id）">
          <BaseCheckbox
            :model-value="validate.includeConfig"
            @update:model-value="handleToggleIncludeConfig"
          />
          <span>含配置引用</span>
        </label>
        <BaseButton size="sm" variant="ghost" :disabled="!canRunValidation" @click="handleRunLight">
          Light
        </BaseButton>
        <BaseButton size="sm" variant="primary" :disabled="!canRunValidation" @click="handleRunFull">
          完整验证
        </BaseButton>
      </div>
    </div>

    <!-- 提示：未启用配置引用时显示 -->
    <div
      v-if="!validate.includeConfig && hasConfig"
      class="px-2 py-0.5 text-[10px] text-gray-600"
    >
      已关闭配置交叉引用校验（生成器调用时强制关闭，避免误报配置数据缺失）
    </div>

    <!-- 主内容：ValidatePanel -->
    <div class="flex-1 overflow-hidden">
      <ValidatePanel @jump="handleJump" />
    </div>

    <!-- P6 镜像校验段（执行案 §4.7.1） -->
    <MirrorCheckSection />
  </div>
</template>
