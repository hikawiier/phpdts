//
// Vitest setup（对齐 NEW_DESIGN.md §4.1）
// 全局 mock / polyfill 配置

import { config } from '@vue/test-utils';

// 全局 stub 配置：避免 RouterLink / i18n 在纯单元测试中触发依赖
config.global.stubs = {
  RouterLink: { template: '<a><slot /></a>' },
  RouterView: { template: '<div><slot /></div>' },
};

// jsdom 环境补齐 matchMedia / IntersectionObserver 等浏览器 API
if (typeof window !== 'undefined') {
  if (!window.matchMedia) {
    window.matchMedia = (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });
  }
}

// jsdom 的 File 实现缺少 Blob.prototype.text（file.text()），用 FileReader polyfill
// file-io.ts 的 readFilesFromFileList / readDroppedItems 依赖 file.text() 读取文本
if (typeof File !== 'undefined' && typeof File.prototype.text !== 'function') {
  File.prototype.text = function text(): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(this);
    });
  };
}
