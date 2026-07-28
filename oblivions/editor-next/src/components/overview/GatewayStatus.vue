<!-- @module O 内容工具箱 -->
<script setup lang="ts">
//
// GatewayStatus：Gateway 连接状态指示灯（对齐 O-6 §4.6.3 + O-1 Workspace Gateway）
//
// 设计意图：
//   - 订阅 sse-client 连接状态：绿灯（open）/ 黄灯（connecting）/ 红灯（closed）
//   - 通过 /api/health 获取 Gateway 工作区根路径
//   - Gateway 不可达时显示红字提示，不阻塞总览页其他功能
//
// P0-H 集成提示：
//   - main.ts 中应调用 ensureSseClient() 并 connect() 启动全局单例
//   - 此组件自身也调用 ensureSseClient() 保证 P0-H 完成前可用
import { onBeforeUnmount, onMounted, ref } from 'vue';
import {
  ensureSseClient,
  type SseConnectionState,
} from '@/services/workspace/sse-client';
import { getHealth, GatewayUnavailableError } from '@/services/workspace/gateway-client';

const state = ref<SseConnectionState>('closed');
const workspaceRoot = ref<string>('');
const healthError = ref<string>('');
let unsubState: (() => void) | null = null;

const stateMeta = (() => {
  const map: Record<SseConnectionState, { dot: string; label: string }> = {
    open: { dot: 'bg-green-500', label: '已连接' },
    connecting: { dot: 'bg-yellow-500', label: '重连中' },
    closed: { dot: 'bg-red-500', label: '离线' },
  };
  return map;
})();

async function refreshHealth(): Promise<void> {
  try {
    const res = await getHealth();
    workspaceRoot.value = res.workspaceRoot;
    healthError.value = '';
  } catch (err) {
    healthError.value =
      err instanceof GatewayUnavailableError ? 'Gateway 不可达' : 'Gateway 错误';
  }
}

onMounted(() => {
  const client = ensureSseClient();
  state.value = client.getState();
  unsubState = client.subscribeState((s) => {
    state.value = s;
  });
  // SSE 客户端可能尚未 connect（P0-H 完成前），主动触发一次
  if (client.getState() === 'closed') {
    client.connect();
  }
  void refreshHealth();
});

onBeforeUnmount(() => {
  if (unsubState !== null) {
    unsubState();
    unsubState = null;
  }
});
</script>

<template>
  <div class="flex items-center gap-2 text-xs text-gray-400">
    <span
      class="inline-block h-2 w-2 rounded-full"
      :class="stateMeta[state].dot"
      :title="stateMeta[state].label"
    />
    <span class="text-gray-300">Gateway</span>
    <span v-if="workspaceRoot" class="text-gray-500" :title="workspaceRoot">
      {{ workspaceRoot }}
    </span>
    <span v-else-if="healthError" class="text-accent-error">{{ healthError }}</span>
    <span v-else class="text-gray-600">查询中…</span>
  </div>
</template>
