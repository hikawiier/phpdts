<!-- @module O 内容工具箱 -->
<script setup lang="ts">
//
// MirrorCheckSection：镜像校验段（对齐执行案 §4.7.1）
//
// 设计意图：
//   - ValidateView 的子段，展示镜像器的当前状态与最近一次对比结果
//   - 用户可手动触发镜像校验（不依赖编译管道第 9 步）
//   - blocking=true 差异红色高亮，标记为"阻断发布"
//   - 后端不可达时降级为 warning 提示，不阻断
//
// 数据流：
//   - 读：validate.mirrorStatusList / mirrorIssues / mirrorBlockingCount /
//     hasMirrorBackendUnavailable / mirrorRunning / lastMirrorRunAt
//   - 写：validate.runMirrorValidation() / clearMirrorResults()
//
// 边界：
//   - 镜像校验运行中禁用按钮
//   - 后端不可达结果显示为 warning（黄色），不阻断发布
//   - blocking=true 差异使用 accent-error 红色高亮
import { ref } from 'vue';
import { useValidateStore } from '@/stores/validateStore';
import BaseButton from '@/components/common/BaseButton.vue';

const validate = useValidateStore();

// ─── 展开状态（镜像器 ID → 是否展开） ────────────────────────
const expanded = ref<Set<string>>(new Set());

function toggleExpand(mirrorId: string): void {
  if (expanded.value.has(mirrorId)) {
    expanded.value.delete(mirrorId);
  } else {
    expanded.value.add(mirrorId);
  }
}

// ─── 触发镜像校验 ────────────────────────────────────────────
async function handleRunMirror(): Promise<void> {
  await validate.runMirrorValidation();
}

// ─── 清空镜像结果 ────────────────────────────────────────────
function handleClear(): void {
  validate.clearMirrorResults();
  expanded.value.clear();
}

// ─── 状态样式 ────────────────────────────────────────────────
function statusClass(status: 'pending' | 'running' | 'success' | 'failed'): string {
  switch (status) {
    case 'success':
      return 'text-green-400 border-green-700';
    case 'failed':
      return 'text-accent-error border-accent-error/60';
    case 'running':
      return 'text-blue-400 border-blue-700 animate-pulse';
    default:
      return 'text-gray-600 border-gray-800';
  }
}

function statusGlyph(status: 'pending' | 'running' | 'success' | 'failed'): string {
  switch (status) {
    case 'success':
      return '✓';
    case 'failed':
      return '✕';
    case 'running':
      return '◐';
    default:
      return '○';
  }
}

function statusLabel(status: 'pending' | 'running' | 'success' | 'failed'): string {
  switch (status) {
    case 'success':
      return '通过';
    case 'failed':
      return '失败';
    case 'running':
      return '运行中';
    default:
      return '待运行';
  }
}

// ─── 时间格式化 ──────────────────────────────────────────────
function formatLastRun(ms: number | null): string {
  if (ms === null) return '';
  const date = new Date(ms);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

// ─── 差异维度标签 ─────────────────────────────────────────────
function dimensionLabel(dimension: 'count' | 'distribution' | 'reference' | 'capacity'): string {
  switch (dimension) {
    case 'count':
      return '数量';
    case 'distribution':
      return '分布';
    case 'reference':
      return '引用';
    case 'capacity':
      return '容量';
  }
}
</script>

<template>
  <section class="flex flex-col gap-2 border-t border-gray-800 px-2 py-2">
    <!-- 段标题 + 操作按钮 -->
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2 text-xs">
        <span class="text-gray-300">镜像校验</span>
        <span
          v-if="validate.mirrorBlockingCount > 0"
          class="rounded border border-accent-error/60 px-1 py-0.5 text-[10px] text-accent-error"
        >
          {{ validate.mirrorBlockingCount }} 阻断
        </span>
        <span
          v-if="validate.hasMirrorBackendUnavailable"
          class="rounded border border-yellow-700 px-1 py-0.5 text-[10px] text-yellow-400"
        >
          部分快照不可用
        </span>
        <span v-if="validate.lastMirrorRunAt !== null" class="text-[10px] text-gray-600">
          · {{ formatLastRun(validate.lastMirrorRunAt) }}
        </span>
      </div>
      <div class="flex items-center gap-1">
        <BaseButton
          size="sm"
          variant="ghost"
          :disabled="validate.mirrorRunning"
          @click="handleRunMirror"
        >
          {{ validate.mirrorRunning ? '运行中...' : '运行镜像校验' }}
        </BaseButton>
        <BaseButton
          v-if="validate.mirrorResults.length > 0"
          size="sm"
          variant="ghost"
          :disabled="validate.mirrorRunning"
          @click="handleClear"
        >
          清空
        </BaseButton>
      </div>
    </div>

    <!-- 后端不可达提示 -->
    <div
      v-if="validate.hasMirrorBackendUnavailable"
      class="rounded border border-yellow-800 bg-yellow-900/20 px-2 py-1 text-[10px] text-yellow-300"
    >
      部分后端快照不可用，对应镜像校验已跳过——不阻断发布。请确认游戏服务器已启动、?debug=all 已启用，且镜像所需 State API scope 可用。
    </div>

    <!-- 阻断发布提示 -->
    <div
      v-if="validate.mirrorBlockingCount > 0"
      class="rounded border border-accent-error/60 bg-[color-mix(in_srgb,var(--color-accent-error)_10%,transparent)] px-2 py-1 text-[10px] text-accent-error"
    >
      镜像校验发现 {{ validate.mirrorBlockingCount }} 个阻断发布差异——编译管道第 9 步将自动回滚到备份。
    </div>

    <!-- 镜像器状态列表 -->
    <ul v-if="validate.mirrorStatusList.length > 0" class="space-y-0.5">
      <li
        v-for="entry in validate.mirrorStatusList"
        :key="entry.id"
        class="rounded border-l-2 bg-gray-900/50"
        :class="statusClass(entry.status)"
      >
        <button
          type="button"
          class="flex w-full items-center gap-2 px-2 py-1 text-left"
          :disabled="!entry.result || (entry.result.differences.length === 0 && entry.result.invariantViolations.length === 0)"
          @click="entry.result && (entry.result.differences.length > 0 || entry.result.invariantViolations.length > 0) && toggleExpand(entry.id)"
        >
          <span class="w-3 text-center">{{ statusGlyph(entry.status) }}</span>
          <span class="flex-1 text-[11px]">
            <code class="font-mono text-gray-300">{{ entry.id }}</code>
            <span class="ml-1 text-[10px] text-gray-500">[{{ statusLabel(entry.status) }}]</span>
          </span>
          <span v-if="entry.result" class="flex-1 truncate text-[10px] text-gray-500">
            {{ entry.result.summary }}
          </span>
          <span
            v-if="entry.result && (entry.result.differences.length > 0 || entry.result.invariantViolations.length > 0)"
            class="text-[10px] text-gray-500"
          >
            {{ expanded.has(entry.id) ? '▼' : '▶' }}
          </span>
        </button>

        <!-- 展开详情：差异列表 + 不变量违反 -->
        <div
          v-if="expanded.has(entry.id) && entry.result"
          class="space-y-1 border-t border-gray-800 px-2 py-1"
        >
          <!-- 差异列表 -->
          <div v-if="entry.result.differences.length > 0" class="space-y-0.5">
            <div class="text-[10px] font-semibold text-gray-500">差异（{{ entry.result.differences.length }}）</div>
            <ul class="space-y-0.5 text-[10px]">
              <li
                v-for="(diff, idx) in entry.result.differences"
                :key="idx"
                :class="diff.isWithinTolerance ? 'text-gray-400' : 'text-accent-error'"
                class="break-all"
              >
                · [{{ dimensionLabel(diff.dimension) }}]
                期望=<code class="font-mono">{{ JSON.stringify(diff.expected) }}</code>
                实际=<code class="font-mono">{{ JSON.stringify(diff.actual) }}</code>
                <span :class="diff.isWithinTolerance ? 'text-gray-600' : 'text-accent-error'">
                  （{{ diff.isWithinTolerance ? '在容忍度内' : '超出容忍度' }} {{ (diff.tolerance * 100).toFixed(1) }}%）
                </span>
              </li>
            </ul>
          </div>

          <!-- 不变量违反列表 -->
          <div v-if="entry.result.invariantViolations.length > 0" class="space-y-0.5">
            <div class="text-[10px] font-semibold text-accent-error">
              不变量违反（{{ entry.result.invariantViolations.length }}）
            </div>
            <ul class="space-y-0.5 text-[10px] text-accent-error">
              <li
                v-for="(violation, idx) in entry.result.invariantViolations"
                :key="idx"
                class="break-all"
              >
                · [{{ violation.name }}] {{ violation.detail }}
              </li>
            </ul>
          </div>

          <!-- 无差异提示 -->
          <div
            v-if="entry.result.differences.length === 0 && entry.result.invariantViolations.length === 0"
            class="text-[10px] text-gray-600"
          >
            无差异，不变量校验通过
          </div>
        </div>
      </li>
    </ul>

    <!-- 未运行提示 -->
    <div
      v-if="validate.mirrorResults.length === 0 && !validate.mirrorRunning"
      class="text-[10px] text-gray-600"
    >
      尚未运行镜像校验——点击"运行镜像校验"按钮触发第 8 层验证
    </div>
  </section>
</template>
