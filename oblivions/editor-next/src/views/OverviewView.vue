<!-- @module O 内容工具箱 -->
<script setup lang="ts">
//
// OverviewView：工具箱总览（对齐 O-6 §4.6.3 + §4.9.1 + 设计案 §5.1）
//
// 研判：
//   - 工具箱首页，展示工作区健康状态 + 关键统计 + 作者资源迁移状态
//   - P5-4：新增"作者资源状态"卡片（AuthorResourceStatus）
//   - P5-4：新增"启动单源迁移"入口（MigrationConfirmModal）
//   - P0 阶段：graph-store 已就绪，validateStore 沿用旧接口（P0-G 后切换）
//   - 未保存变更数（P0-E ChangeSet 完成后接入）
//   - "重新加载工作区"按钮依赖 P0-D loader.loadWorkspace()，未完成前禁用
//
// 数据来源：
//   - graph-store.nodeCount → 资源总数
//   - validate.errorCount / warningCount → 阻断错误数 / 警告数（沿用旧 validateStore）
//   - 覆盖率：派生 getter 基于 renders_as 边统计，P2 呈现工作区完成后接入
//   - GatewayStatus 内部订阅 sse-client 状态 + 调用 /api/health
//   - AuthorResourceStatus 内部调用 /api/migration-status
//
// 设计意图（对齐 §5.1 + §4.9.1）：
//   - 总览解决"工作区状态、未保存变更、阻断错误、资源覆盖率、作者资源迁移状态"五个问题
//   - 不直接编辑内容，仅作为健康仪表盘 + 迁移入口
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useGraphStore } from '@/graph';
import { useValidateStore } from '@/stores/validateStore';
import StatCard from '@/components/overview/StatCard.vue';
import GatewayStatus from '@/components/overview/GatewayStatus.vue';
import AuthorResourceStatus from '@/components/overview/AuthorResourceStatus.vue';
import MigrationConfirmModal from '@/components/migration/MigrationConfirmModal.vue';
import BaseButton from '@/components/common/BaseButton.vue';

const graph = useGraphStore();
const validate = useValidateStore();
const router = useRouter();

// ─── 工作流指南 ───────────────────────────────────
const showGuide = ref(true);

interface WorkflowStep {
  num: number;
  title: string;
  desc: string;
  route: string;
  icon: string;
}

const workflowSteps: WorkflowStep[] = [
  { num: 1, title: '世界', desc: '编辑地图格、区域配置、随机生成器', route: '/world', icon: '🗺' },
  { num: 2, title: '模板', desc: '定义道具/配方/敌人的属性数据', route: '/templates', icon: '📋' },
  { num: 3, title: '分布', desc: '配置道具/敌人/POI 在地图上的放置规则', route: '/distribution', icon: '🗂' },
  { num: 4, title: '呈现', desc: '编辑中文名、描述等本地化文案', route: '/presentation', icon: '📝' },
  { num: 5, title: '验证', desc: '检查引用完整性、镜像一致性', route: '/validate', icon: '✓' },
  { num: 6, title: '构建', desc: '编译并发布到后端（需通过验证门禁）', route: '/build', icon: '📦' },
];

function goToStep(route: string): void {
  void router.push(route);
}

// ─── 统计卡片数据 ───────────────────────────────────
const resourceCount = computed(() => graph.nodeCount);
const errorCount = computed(() => validate.errorCount);
const warningCount = computed(() => validate.warningCount);
// P0 占位：覆盖率基于 renders_as 边统计，P2 呈现工作区完成后接入派生 getter
const coverageDisplay = 'P2 计算';

// ─── 未保存变更 ─────────────────────────────────────
// P0-E ChangeSet 完成后接入；P0 阶段占位 0
const unsavedChangeCount = ref(0);

// ─── 最近加载时间 ───────────────────────────────────
// P0-D loader 完成后写入；P0 阶段占位 null
const lastLoadedAt = ref<Date | null>(null);

// ─── 重新加载工作区 ─────────────────────────────────
// 依赖 P0-D loader.loadWorkspace()；未完成前按钮禁用
// TODO(P0-D): 切换为 `import { loadWorkspace } from '@/services/workspace/loader'`
//   并在 handleReloadWorkspace 中调用 graph.clear() + upsertNodes + rebuildIndexes
const loaderReady = false;
const reloadTooltip = loaderReady ? '重新加载工作区' : 'P0-D 完成后可用';

async function handleReloadWorkspace(): Promise<void> {
  if (!loaderReady) return;
  // TODO(P0-D): const result = await loadWorkspace();
  //   graph.clear();
  //   await graph.upsertNodes(result.nodes);
  //   graph.rebuildIndexes();
  //   lastLoadedAt.value = new Date();
  lastLoadedAt.value = new Date();
}

// ─── P5-4 迁移对话框 ────────────────────────────────
const showMigrationModal = ref(false);
const authorResourceRef = ref<InstanceType<typeof AuthorResourceStatus> | null>(null);

function handleMigrate(): void {
  showMigrationModal.value = true;
}

function handleMigrationClose(): void {
  showMigrationModal.value = false;
}

function handleMigrationDone(): void {
  showMigrationModal.value = false;
  // 迁移成功后刷新作者资源状态
  void authorResourceRef.value?.refresh();
}
</script>

<template>
  <div class="flex h-full flex-col gap-4 overflow-auto p-4">
    <!-- 顶部：工作区根路径 + Gateway 状态 -->
    <section class="flex items-center justify-between border-b border-gray-800 pb-3">
      <h2 class="text-sm text-gray-400">工作区总览</h2>
      <GatewayStatus />
    </section>

    <!-- 工作流指南（可折叠） -->
    <section class="rounded border border-gray-700 bg-gray-900/60">
      <button
        class="flex w-full items-center justify-between px-3 py-2 text-left text-xs text-gray-300 hover:bg-gray-800/50"
        @click="showGuide = !showGuide"
      >
        <span class="font-medium">如何使用本工具箱？点击查看 6 步工作流</span>
        <span class="text-gray-500">{{ showGuide ? '▼' : '▶' }}</span>
      </button>
      <div v-if="showGuide" class="border-t border-gray-800 p-3">
        <p class="mb-3 text-xs text-gray-400">
          本工具箱按以下顺序使用。点击任一步骤可直接跳转到对应页面。
        </p>
        <div class="grid grid-cols-6 gap-2">
          <button
            v-for="step in workflowSteps"
            :key="step.num"
            class="flex flex-col items-center gap-1 rounded border border-gray-700 bg-gray-800/50 p-2 text-center transition hover:border-gray-500 hover:bg-gray-700/50"
            @click="goToStep(step.route)"
          >
            <span class="text-lg">{{ step.icon }}</span>
            <span class="text-xs font-medium text-gray-200">{{ step.num }}. {{ step.title }}</span>
            <span class="text-[10px] leading-tight text-gray-500">{{ step.desc }}</span>
          </button>
        </div>
      </div>
    </section>

    <!-- 中部：4 个统计卡片 -->
    <section class="grid grid-cols-4 gap-3">
      <StatCard label="资源总数" :value="resourceCount" icon="📦" trend="up" />
      <StatCard label="阻断错误" :value="errorCount" icon="✕" trend="down" />
      <StatCard label="警告" :value="warningCount" icon="!" trend="flat" />
      <StatCard label="覆盖率" :value="coverageDisplay" icon="%" trend="flat" />
    </section>

    <!-- P5-4：作者资源状态卡片（迁移入口） -->
    <AuthorResourceStatus
      ref="authorResourceRef"
      @migrate="handleMigrate"
    />

    <!-- 下部：未保存变更 + 最近加载时间 + 重新加载按钮 -->
    <section
      class="flex items-center justify-between border-t border-gray-800 pt-3 text-xs text-gray-400"
    >
      <div class="flex items-center gap-4">
        <span>
          未保存变更：<span class="text-gray-200">{{ unsavedChangeCount }}</span>
        </span>
        <span v-if="lastLoadedAt">
          最近加载：{{ lastLoadedAt.toLocaleTimeString() }}
        </span>
        <span v-else>最近加载：—</span>
      </div>
      <BaseButton
        size="sm"
        variant="default"
        :disabled="!loaderReady"
        :title="reloadTooltip"
        @click="handleReloadWorkspace"
      >
        重新加载工作区
      </BaseButton>
    </section>

    <!-- P5-4：迁移确认对话框 -->
    <MigrationConfirmModal
      :open="showMigrationModal"
      @close="handleMigrationClose"
      @migrated="handleMigrationDone"
    />
  </div>
</template>
