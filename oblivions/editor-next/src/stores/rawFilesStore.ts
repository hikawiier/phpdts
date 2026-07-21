//
// rawFilesStore：原始文件缓存（对齐 editor-next-独立化与备份还原功能-设计案 Task D）
//
// 设计意图：
//   - 缓存 gamedata 目录下未被编辑器解析的 .php 文件（原始字符串）
//   - 与 configStore / projectStore 隔离：原始缓存不参与编辑器 UI，仅用于 round-trip 写回
//   - 同时承载 sourceDirHandle（从 useImportExport 移入此处全局共享）
//   - 不持久化到 localStorage（与 configStore 一致，纯内存）
//
// 不变量：
//   - 仅缓存未被编辑器解析的文件（map.php / tiles/region_*.php / 4 个配置文件 不入缓存）
//   - 导出时原样写出（round-trip 一致性）
//   - sourceDirHandle 仅在 FSAA 目录选择导入后非 null

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export const useRawFilesStore = defineStore('rawFiles', () => {
  // ─── state ────────────────────────────────────────────
  /** 相对路径 → 原始字符串（仅未被编辑器解析的文件） */
  const rawFiles = ref<Record<string, string>>({});
  /** 源目录句柄（FSAA 导入后可用，写入回源用） */
  const sourceDirHandle = ref<FileSystemDirectoryHandle | null>(null);

  // ─── getters ──────────────────────────────────────────
  /** 原始缓存文件数 */
  const rawFileCount = computed(() => Object.keys(rawFiles.value).length);
  /** 是否有源目录句柄（FSAA 写回用） */
  const hasSourceDirHandle = computed(() => sourceDirHandle.value !== null);

  // ─── actions ──────────────────────────────────────────

  /**
   * 设置原始文件缓存（覆盖式）
   */
  function setRawFiles(files: Record<string, string>): void {
    rawFiles.value = { ...files };
  }

  /**
   * 清空原始文件缓存
   */
  function clearRawFiles(): void {
    rawFiles.value = {};
  }

  /**
   * 获取单个原始文件内容
   */
  function getRawFile(path: string): string | undefined {
    return rawFiles.value[path];
  }

  /**
   * 返回所有原始缓存文件（编辑器生成的文件由调用方合并）
   */
  function getAllFiles(): Record<string, string> {
    return { ...rawFiles.value };
  }

  /**
   * 设置源目录句柄（FSAA 导入后传入，写回源目录用）
   */
  function setSourceDirHandle(handle: FileSystemDirectoryHandle | null): void {
    sourceDirHandle.value = handle;
  }

  /**
   * 清除源目录句柄
   */
  function clearSourceDirHandle(): void {
    sourceDirHandle.value = null;
  }

  /**
   * 重置全部状态（清空 rawFiles + sourceDirHandle）
   */
  function reset(): void {
    rawFiles.value = {};
    sourceDirHandle.value = null;
  }

  return {
    // state
    rawFiles,
    sourceDirHandle,
    // getters
    rawFileCount,
    hasSourceDirHandle,
    // actions
    setRawFiles,
    clearRawFiles,
    getRawFile,
    getAllFiles,
    setSourceDirHandle,
    clearSourceDirHandle,
    reset,
  };
});
