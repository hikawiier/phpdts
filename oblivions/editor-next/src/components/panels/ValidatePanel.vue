<script setup lang="ts">
//
// ValidatePanel：验证结果面板（对齐 NEW_DESIGN.md §3.5.3 + §3.5.4）
//
// 研判：
//   - 验证工具集的 UI 入口
//   - 点击 issue 跳转通过 projectStore.setCurrentPgroup / setSelectedPls
//
// 设计意图（对齐 2.15 灰阶基底 + 唯一强调色 + §3.5.3）：
//   - 结果面板：列出所有 issues，点击跳转到对应格 / 区域
//   - 过滤器：all / error / warning 三档
//   - error 用唯一强调色（红 #ff5555，对齐 colors.ts ACCENT_COLORS.error）
//   - warning 用灰阶中灰 + 虚线边框（避免引入次级彩色）
//   - 每个 issue 展示 rule ID + message + hint（hint 灰阶辅助色）
//   - location 锚点：点击 issue 触发 emit('jump', location)
//
// 数据流：
//   - 读：validate.filteredIssues / errorCount / warningCount / lastRunMode / lastRunAt
//   - 写：validate.setFilter（过滤器切换）
//   - 跳转：emit('jump', location) → ValidateView 处理路由 + projectStore 跳转

import { computed } from 'vue';
import { useValidateStore, type ValidateFilter } from '@/stores/validateStore';
import type { ValidateIssue, ValidateIssueLocation } from '@/shared';

const validate = useValidateStore();

const emit = defineEmits<{
  jump: [location: ValidateIssueLocation];
}>();

// ─── 过滤器按钮 ─────────────────────────────────────
const filterButtons: ReadonlyArray<{ key: ValidateFilter; labelKey: string }> = [
  { key: 'all', labelKey: 'validate.filter.all' },
  { key: 'error', labelKey: 'validate.filter.error' },
  { key: 'warning', labelKey: 'validate.filter.warning' },
];

// ─── 时间格式化 ─────────────────────────────────────
const lastRunText = computed<string>(() => {
  if (validate.lastRunAt === null) return '';
  const date = new Date(validate.lastRunAt);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
});

// ─── issue 跳转 ─────────────────────────────────────
function handleIssueClick(issue: ValidateIssue): void {
  // 跳转锚点：location.pgroup / pls 都为 null 时不触发跳转
  const loc = issue.location;
  if (loc.pgroup == null && loc.pls == null) return;
  emit('jump', loc);
}

function handleFilterClick(next: ValidateFilter): void {
  validate.setFilter(next);
}
</script>

<template>
  <div class="flex h-full flex-col gap-2 overflow-hidden">
    <!-- 顶部：过滤器 + 统计 -->
    <div class="flex items-center justify-between border-b border-gray-800 px-2 py-1">
      <div class="flex items-center gap-1">
        <button
          v-for="btn in filterButtons"
          :key="btn.key"
          type="button"
          class="rounded border px-2 py-0.5 text-[11px] transition-colors"
          :class="
            validate.filter === btn.key
              ? 'border-gray-500 bg-gray-700 text-gray-100'
              : 'border-gray-800 bg-transparent text-gray-400 hover:text-gray-200'
          "
          @click="handleFilterClick(btn.key)"
        >
          {{ btn.key === 'all' ? '全部' : btn.key === 'error' ? '仅错误' : '仅警告' }}
          <span v-if="btn.key === 'all'" class="ml-1 text-[10px] text-gray-500">
            ({{ validate.issues.length }})
          </span>
          <span v-else-if="btn.key === 'error'" class="ml-1 text-[10px] text-accent-error">
            ({{ validate.errorCount }})
          </span>
          <span v-else class="ml-1 text-[10px] text-gray-500">
            ({{ validate.warningCount }})
          </span>
        </button>
      </div>
      <div class="text-[10px] text-gray-600">
        <span v-if="validate.lastRunMode === 'light'">Light</span>
        <span v-else-if="validate.lastRunMode === 'full'">Full</span>
        <span v-if="lastRunText"> · {{ lastRunText }}</span>
      </div>
    </div>

    <!-- 空状态 -->
    <div
      v-if="!validate.hasIssues"
      class="flex flex-1 items-center justify-center text-xs text-gray-600"
    >
      暂无验证问题
    </div>

    <!-- 过滤后空（有 issues 但被过滤掉） -->
    <div
      v-else-if="validate.filteredIssues.length === 0"
      class="flex flex-1 items-center justify-center text-xs text-gray-600"
    >
      当前过滤器下无问题
    </div>

    <!-- issue 列表 -->
    <div v-else class="flex-1 overflow-auto">
      <ul class="flex flex-col gap-1 p-1">
        <li
          v-for="(issue, idx) in validate.filteredIssues"
          :key="`${issue.rule}-${idx}`"
        >
          <button
            type="button"
            class="group flex w-full flex-col gap-1 rounded border px-2 py-1 text-left transition-colors"
            :class="
              issue.severity === 'error'
                ? 'border-accent-error/60 bg-[color-mix(in_srgb,var(--color-accent-error)_8%,transparent)] hover:bg-[color-mix(in_srgb,var(--color-accent-error)_18%,transparent)]'
                : 'border-gray-700 border-dashed bg-gray-900/50 hover:bg-gray-800/60'
            "
            :data-rule="issue.rule"
            :data-severity="issue.severity"
            :data-pgroup="issue.location.pgroup ?? ''"
            :data-pls="issue.location.pls ?? ''"
            @click="handleIssueClick(issue)"
          >
            <!-- 第一行：rule ID + severity 标签 + 位置锚点 -->
            <div class="flex items-center gap-2 text-[10px]">
              <span
                :class="
                  issue.severity === 'error'
                    ? 'text-accent-error font-semibold'
                    : 'text-gray-400 font-medium'
                "
              >
                {{ issue.severity === 'error' ? '错误' : '警告' }}
              </span>
              <code class="font-mono text-gray-500">{{ issue.rule }}</code>
              <span class="ml-auto text-gray-600">
                <template v-if="issue.location.pgroup != null">
                  pgroup={{ issue.location.pgroup }}
                </template>
                <template v-if="issue.location.pls != null">
                  · pls={{ issue.location.pls }}
                </template>
                <template v-if="issue.location.field">
                  · {{ issue.location.field }}
                </template>
              </span>
            </div>
            <!-- 第二行：message -->
            <div
              class="text-xs"
              :class="issue.severity === 'error' ? 'text-gray-200' : 'text-gray-300'"
            >
              {{ issue.message }}
            </div>
            <!-- 第三行：hint（修复建议，灰阶辅助色） -->
            <div v-if="issue.hint" class="text-[10px] text-gray-500">
              💡 {{ issue.hint }}
            </div>
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>
