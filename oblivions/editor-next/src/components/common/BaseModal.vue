<script setup lang="ts">
// 通用模态框（灰阶基底，对齐 DESIGN.md 2.15 + 2.14 modal 优先级）
import { useUiStore } from '@/stores/uiStore';
import { useEditorKeyboard, type KeyboardContext } from '@/composables/useEditorKeyboard';
import { onBeforeUnmount, onMounted, watch } from 'vue';

const props = withDefaults(
  defineProps<{
    open: boolean;
    title?: string;
    closable?: boolean;
  }>(),
  {
    closable: true,
  },
);

const emit = defineEmits<{ close: [] }>();

const ui = useUiStore();
const keyboard = useEditorKeyboard();

function close(): void {
  if (!props.closable) return;
  emit('close');
}

// 注册 modal 层键盘上下文（ESC 关闭）
const ctx: KeyboardContext = {
  name: 'modal',
  isActive: () => props.open,
  handle: (event: KeyboardEvent) => {
    if (event.key === 'Escape' && props.closable) {
      close();
      return true;
    }
    return false;
  },
};

onMounted(() => {
  keyboard.register(ctx);
});

onBeforeUnmount(() => {
  // register 返回的 unregister 由 keyboard 内部管理
});

watch(
  () => props.open,
  (open) => {
    // 与 uiStore.modals 同步（用于全局 modal 检测）
    // 此处不直接修改 ui.modals（避免与 uiStore.openModal 重复），
    // 而是通过 closable 控制
    void ui;
    void open;
  },
);
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      @click.self="close"
    >
      <div
        class="flex max-h-[80vh] w-[min(640px,90vw)] flex-col rounded border border-gray-700 bg-gray-900 shadow-2xl"
        role="dialog"
        aria-modal="true"
      >
        <header
          v-if="title || closable"
          class="flex items-center justify-between border-b border-gray-800 px-4 py-2"
        >
          <h3 class="text-sm font-semibold text-gray-100">{{ title }}</h3>
          <button
            v-if="closable"
            type="button"
            class="text-gray-500 hover:text-gray-300"
            aria-label="close"
            @click="close"
          >
            ×
          </button>
        </header>
        <div class="flex-1 overflow-auto px-4 py-3 text-sm text-gray-200">
          <slot />
        </div>
        <footer
          v-if="$slots.footer"
          class="flex items-center justify-end gap-2 border-t border-gray-800 px-4 py-2"
        >
          <slot name="footer" />
        </footer>
      </div>
    </div>
  </Teleport>
</template>
