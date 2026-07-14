/// <reference types="vite/client" />

/**
 * @module K 状态管理层
 */

interface ImportMetaEnv {
  readonly VITE_API_BASE: string;
  readonly VITE_DEBUG: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
