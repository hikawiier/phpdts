<script setup lang="ts">
/**
 * @module A API 层
 * @framework A-5 调试工具框架
 */

import { computed } from 'vue';
import { debugBus } from '@/composables/useDebugBus';
import { useDebugConsoleStore } from '@/stores/debug-console';

const debug = useDebugConsoleStore();

const snapshotLabel = computed(() => {
  const snapshot = debug.backendState.snapshot;
  if (!snapshot.exists) return '无快照';
  return snapshot.created_at
    ? new Date(snapshot.created_at * 1000).toLocaleTimeString()
    : '已保存';
});

const eventTail = computed(() => {
  void debug.summary.lastEventSeq;
  return debugBus.tail(4);
});

async function invoke(action: () => Promise<unknown>): Promise<void> {
  try {
    await action();
  } catch {
    // 结构化错误已经写入 lastResult 与 DebugBus。
  }
}
</script>

<template>
  <div class="debug-console" data-debug-id="debug.console">
    <pre
      id="phpdts-debug-summary"
      class="debug-summary-node"
      data-debug-id="debug.summary"
    >{{ debug.summaryJson }}</pre>

    <section v-if="debug.open" class="debug-drawer" aria-label="调试台">
      <header class="debug-header">
        <div>
          <strong>TEST CONSOLE</strong>
          <span>{{ debug.summary.scene }} · {{ snapshotLabel }}</span>
        </div>
        <button
          type="button"
          title="收起调试台"
          data-debug-id="debug.console.close"
          @click="debug.toggle"
        >×</button>
      </header>

      <div class="debug-group">
        <span class="debug-label">会话</span>
        <div class="debug-row">
          <button
            type="button"
            :disabled="debug.busy"
            data-debug-id="debug.snapshot.save"
            @click="invoke(debug.session.start)"
          >保存</button>
          <button
            type="button"
            :disabled="debug.busy || !debug.backendState.snapshot.exists"
            data-debug-id="debug.snapshot.restore"
            @click="invoke(debug.session.restore)"
          >恢复</button>
          <button
            type="button"
            :disabled="debug.busy || !debug.backendState.snapshot.exists"
            data-debug-id="debug.snapshot.clear"
            @click="invoke(debug.session.clear)"
          >清除</button>
        </div>
      </div>

      <div class="debug-group">
        <span class="debug-label">场景</span>
        <button
          type="button"
          class="debug-wide"
          :disabled="debug.busy"
          data-debug-id="debug.scenario.adjacent-enemy"
          @click="invoke(() => debug.scenario.prepare('adjacent_enemy', 1))"
        >相邻敌人</button>
      </div>

      <div class="debug-group">
        <span class="debug-label">重置</span>
        <div class="debug-row">
          <button
            type="button"
            :disabled="debug.busy"
            data-debug-id="debug.reset.battle"
            @click="invoke(() => debug.gm.reset('battle'))"
          >战斗</button>
          <button
            type="button"
            :disabled="debug.busy"
            data-debug-id="debug.reset.vitals"
            @click="invoke(() => debug.gm.reset('vitals'))"
          >生命</button>
          <button
            type="button"
            :disabled="debug.busy"
            data-debug-id="debug.reset.all"
            @click="invoke(() => debug.gm.reset('all_transient'))"
          >全部</button>
        </div>
      </div>

      <div class="debug-observe">
        <div><span>位置</span><b>{{ debug.summary.player?.pgroup ?? '-' }}:{{ debug.summary.player?.pls ?? '-' }}</b></div>
        <div><span>弹层</span><b>{{ debug.summary.overlays.length }}</b></div>
        <div><span>操作</span><b>{{ debug.summary.actions.length }}</b></div>
        <div><span>事件</span><b>#{{ debug.summary.lastEventSeq }}</b></div>
      </div>

      <ol class="debug-events">
        <li v-for="event in eventTail" :key="event.seq">
          <span>#{{ event.seq }}</span>{{ event.step }}
        </li>
      </ol>

      <footer class="debug-footer">
        <span :class="{ error: debug.lastResult.includes(':') && !debug.lastResult.endsWith('OK') }">
          {{ debug.busy ? '执行中...' : (debug.lastResult || 'ready') }}
        </span>
        <div>
          <button type="button" data-debug-id="debug.summary.refresh" @click="debug.refreshSummary">刷新</button>
          <button type="button" data-debug-id="debug.events.clear" @click="debugBus.clear(); debug.refreshSummary()">清事件</button>
        </div>
      </footer>
    </section>

    <button
      v-else
      type="button"
      class="debug-trigger"
      title="打开 AI 前端测试调试台"
      data-debug-id="debug.console.open"
      @click="debug.toggle"
    >DBG</button>
  </div>
</template>

<style scoped>
.debug-console {
  position: fixed;
  left: 8px;
  bottom: 8px;
  z-index: 1200;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  letter-spacing: 0;
  user-select: text;
}
.debug-summary-node {
  position: fixed;
  left: -10000px;
  top: 0;
  width: 1px;
  height: 1px;
  overflow: hidden;
  white-space: pre-wrap;
}
.debug-trigger,
.debug-drawer button {
  border: 1px solid #46545b;
  border-radius: 3px;
  background: #121719;
  color: #c9d6d8;
  font: inherit;
  letter-spacing: 0;
  cursor: pointer;
}
.debug-trigger {
  width: 42px;
  height: 25px;
  color: #8ed6dc;
  font-size: 10px;
  font-weight: 700;
  box-shadow: 0 4px 16px rgba(0, 0, 0, .45);
}
.debug-drawer {
  width: min(310px, calc(100vw - 16px));
  max-height: min(650px, calc(100vh - 16px));
  overflow: auto;
  border: 1px solid #46545b;
  border-radius: 4px;
  background: rgba(9, 12, 13, .97);
  color: #aab7b9;
  box-shadow: 0 12px 34px rgba(0, 0, 0, .58);
}
.debug-header,
.debug-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 9px;
  border-bottom: 1px solid #283236;
}
.debug-header strong {
  display: block;
  color: #9fe2e7;
  font-size: 11px;
}
.debug-header span {
  display: block;
  color: #6f8084;
  font-size: 9px;
}
.debug-header button {
  width: 24px;
  height: 24px;
  font-size: 16px;
}
.debug-group {
  padding: 7px 9px;
  border-bottom: 1px solid #20282b;
}
.debug-label {
  display: block;
  margin-bottom: 5px;
  color: #6f8084;
  font-size: 9px;
}
.debug-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 5px;
}
.debug-group button {
  min-height: 27px;
  padding: 4px 6px;
  font-size: 10px;
}
.debug-group button:hover:not(:disabled),
.debug-footer button:hover,
.debug-trigger:hover {
  border-color: #75b7bc;
  color: #d8f3f5;
}
.debug-group button:disabled {
  opacity: .38;
  cursor: default;
}
.debug-wide { width: 100%; }
.debug-observe {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  padding: 8px 9px;
  border-bottom: 1px solid #20282b;
}
.debug-observe div {
  min-width: 0;
  text-align: center;
}
.debug-observe span,
.debug-observe b {
  display: block;
}
.debug-observe span {
  color: #617175;
  font-size: 8px;
}
.debug-observe b {
  overflow: hidden;
  color: #d0d9da;
  font-size: 10px;
  text-overflow: ellipsis;
}
.debug-events {
  margin: 0;
  padding: 7px 9px;
  list-style: none;
  border-bottom: 1px solid #20282b;
  color: #849397;
  font-size: 9px;
}
.debug-events li {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.debug-events span {
  display: inline-block;
  width: 36px;
  color: #b4a979;
}
.debug-footer {
  border-bottom: 0;
  font-size: 9px;
}
.debug-footer > span {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.debug-footer > span.error { color: #df8b82; }
.debug-footer > div { display: flex; gap: 4px; }
.debug-footer button { padding: 3px 5px; font-size: 9px; }

@media (max-height: 430px) {
  .debug-drawer {
    width: min(360px, calc(100vw - 16px));
    max-height: calc(100vh - 12px);
  }
  .debug-events { display: none; }
  .debug-group { padding-block: 5px; }
}
</style>
