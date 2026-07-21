// i18n 框架入口（对齐 NEW_DESIGN.md §2.5：vue-i18n + zh-CN 默认 + en-US 备用）

import { createI18n } from 'vue-i18n';
import zhCN from './zh-CN';
import enUS from './en-US';

export type MessageSchema = typeof zhCN;

export const SUPPORTED_LOCALES = ['zh-CN', 'en-US'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: SupportedLocale = 'zh-CN';
export const FALLBACK_LOCALE: SupportedLocale = 'en-US';

/**
 * 从 localStorage 读取用户上次选择的语言，回退到默认中文。
 */
function detectInitialLocale(): SupportedLocale {
  if (typeof window === 'undefined' || !window.localStorage) {
    return DEFAULT_LOCALE;
  }
  const stored = window.localStorage.getItem('oblivions.editor.locale');
  if (stored && (SUPPORTED_LOCALES as readonly string[]).includes(stored)) {
    return stored as SupportedLocale;
  }
  return DEFAULT_LOCALE;
}

const messages = {
  'zh-CN': zhCN,
  'en-US': enUS,
};

export const i18n = createI18n({
  legacy: false,
  locale: detectInitialLocale(),
  fallbackLocale: FALLBACK_LOCALE,
  messages,
  missingWarn: false,
  fallbackWarn: false,
});

/**
 * 切换语言并持久化到 localStorage。
 */
export function setLocale(locale: SupportedLocale): void {
  // vue-i18n 的 Composer 类型在 strict 模式下推断较复杂，使用 cast 保证可用性
  (i18n.global.locale as unknown as { value: string }).value = locale;
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem('oblivions.editor.locale', locale);
  }
}

export { zhCN, enUS };
