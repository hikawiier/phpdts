//
// file-io：文件 IO 封装（对齐 NEW_DESIGN.md §3.2.3 + §3.2.4）
//
// 实现四种导入路径：
//   1. File System Access API 目录选择（showDirectoryPicker，首选）
//   2. <input webkitdirectory> 回退（浏览器不支持 FSAA 时）
//   3. 手动粘贴多文件（用 \n---\n 分隔）
//   4. 拖拽导入（webkitGetAsEntry 递归读取）
//
// 实现两种导出路径（仅文件 IO 层，业务编排见 useImportExport）：
//   - 写回源目录（备份旧文件为 ZIP 后再覆盖）
//   - 输出 FileEntry 列表交由 zip-bundle 打包
//
// 类型定义：FileEntry { path, content }，path 是相对路径（如 'map.php' / 'tiles/region_1.php'）

// File System Access API 类型补充（lib.dom.d.ts 已含 FileSystemDirectoryHandle / FileSystemFileHandle /
// FileSystemHandle / DataTransferItem.webkitGetAsEntry / HTMLInputElement.webkitdirectory 等）
// 仅补充：
//   1. showDirectoryPicker（Chromium 系非标准 API，未进入 lib.dom.d.ts）
//   2. FileSystemDirectoryHandle 的异步迭代方法（TS 5.9 lib.dom.d.ts 尚未声明 values/entries/keys/asyncIterator）
//   3. FileSystemDirectoryEntry / FileSystemDirectoryReader（拖拽 API 中使用，TS 5.9 lib.dom.d.ts 已含，
//      但为避免重复声明仅在使用处用类型断言）
//   4. HTMLInputElement.directory（旧 Firefox 前缀，非标准）
declare global {
  interface Window {
    showDirectoryPicker?: (options?: {
      mode?: 'read' | 'readwrite';
    }) => Promise<FileSystemDirectoryHandle>;
  }
  interface FileSystemDirectoryHandle {
    values(): AsyncIterableIterator<FileSystemHandle>;
    entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
    keys(): AsyncIterableIterator<string>;
    [Symbol.asyncIterator](): AsyncIterableIterator<FileSystemHandle>;
  }
  interface HTMLInputElement {
    directory?: boolean;
  }
}

/**
 * 文件条目：path 是相对路径，content 是 PHP 文件内容
 */
export interface FileEntry {
  readonly path: string;
  readonly content: string;
}

/**
 * 目录选择结果：包含文件列表与可选的目录句柄（用于写回源目录）
 */
export interface DirectoryPicker {
  readonly files: FileEntry[];
  readonly handle: FileSystemDirectoryHandle | null;
}

/**
 * File System Access API 是否可用（运行时检测，对齐 §3.2.3 回退策略）
 */
export function isFileSystemAccessSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.showDirectoryPicker === 'function'
  );
}

/**
 * 通过 File System Access API 选择目录并读取 .php 文件
 *
 * @param mode 'readwrite' 优先尝试写入权限，失败回退 'read'；'read' 只读
 * @returns 解析失败或用户取消返回 null
 */
export async function pickDirectory(
  mode: 'readwrite' | 'read' = 'readwrite',
): Promise<DirectoryPicker | null> {
  if (!isFileSystemAccessSupported()) {
    return pickDirectoryFallback();
  }

  let handle: FileSystemDirectoryHandle;
  try {
    handle = await window.showDirectoryPicker!({ mode });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return null;
    // readwrite 失败回退 read
    if (mode === 'readwrite') {
      try {
        handle = await window.showDirectoryPicker!({ mode: 'read' });
      } catch (err2) {
        if (err2 instanceof DOMException && err2.name === 'AbortError') return null;
        // FSAA 异常时回退到 webkitdirectory
        return pickDirectoryFallback();
      }
    } else {
      return null;
    }
  }

  // 先在根目录找 map.php，找不到则在子目录中查找
  let files = await readPhpFilesFromDirectory(handle, '');
  if (!files.some((f) => f.path === 'map.php')) {
    // 在子目录中查找 gamedata 根
    for await (const entry of handle.values()) {
      if (entry.kind !== 'directory') continue;
      try {
        const subDir = await handle.getDirectoryHandle(entry.name);
        const subFiles = await readPhpFilesFromDirectory(subDir, '');
        if (subFiles.some((f) => f.path === 'map.php')) {
          files = subFiles;
          handle = subDir;
          break;
        }
      } catch {
        // 继续
      }
    }
  }

  return { files, handle };
}

/**
 * 通过 <input webkitdirectory> 回退选择目录
 *
 * 浏览器不支持 File System Access API 时使用，无法获得写句柄
 */
export async function pickDirectoryFallback(): Promise<DirectoryPicker | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.webkitdirectory = true;
    input.directory = true;
    input.accept = '.php';
    input.addEventListener('change', async () => {
      if (!input.files || input.files.length === 0) {
        resolve(null);
        return;
      }
      const files = await readFilesFromFileList(input.files);
      resolve({ files, handle: null });
    });
    // 用户取消时 change 不触发，无法检测；这里监听 window focus 作为取消信号
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

/**
 * 从 FileList 读取 .php 文件，返回 FileEntry 列表（path 为相对路径）
 *
 * webkitdirectory 下 file.webkitRelativePath 形如 'gamedata/map.php'，
 * 截取首段目录名保留子路径 'map.php' / 'tiles/region_1.php'
 */
export async function readFilesFromFileList(fileList: FileList | File[]): Promise<FileEntry[]> {
  const files = Array.from(fileList).filter((f) => f.name.endsWith('.php'));
  const entries: FileEntry[] = [];
  for (const file of files) {
    const path = extractRelativePath(file);
    const content = await file.text();
    entries.push({ path, content });
  }
  return entries;
}

/**
 * 从 File 对象提取相对路径（剥离 webkitdirectory 顶层目录名）
 */
function extractRelativePath(file: File): string {
  // webkitRelativePath 形如 'gamedata/map.php' 或 'gamedata/tiles/region_1.php'
  const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? file.name;
  const parts = relative.split('/');
  // 剥离顶层目录名（如 'gamedata'）
  if (parts.length > 1) {
    return parts.slice(1).join('/');
  }
  return parts[0] ?? file.name;
}

/**
 * 递归读取目录中所有 .php 文件
 *
 * @param handle 目录句柄
 * @param prefix 路径前缀（用于递归拼接子目录路径）
 */
export async function readPhpFilesFromDirectory(
  handle: FileSystemDirectoryHandle,
  prefix: string,
): Promise<FileEntry[]> {
  const entries: FileEntry[] = [];
  for await (const item of handle.values()) {
    if (item.kind === 'file' && item.name.endsWith('.php')) {
      try {
        const fileHandle = await handle.getFileHandle(item.name);
        const file = await fileHandle.getFile();
        const content = await file.text();
        const path = prefix ? `${prefix}/${item.name}` : item.name;
        entries.push({ path, content });
      } catch {
        // 跳过读取失败的文件
      }
    } else if (item.kind === 'directory') {
      try {
        const subDir = await handle.getDirectoryHandle(item.name);
        const subPrefix = prefix ? `${prefix}/${item.name}` : item.name;
        const subEntries = await readPhpFilesFromDirectory(subDir, subPrefix);
        entries.push(...subEntries);
      } catch {
        // 跳过读取失败的目录
      }
    }
  }
  return entries;
}

/**
 * 解析手动粘贴的多文件文本（用 \n---\n 分隔）
 *
 * 对齐 oblivions/editor/src/main.js initImportModal 行为：
 *   - 输入文本用 \n---\n 分隔为多个部分
 *   - 每个部分视为一个独立的 PHP 文件内容
 *   - 文件名按顺序分配（map.php / tiles/region_1.php / ...）
 *
 * @param text 用户粘贴的文本
 * @param filenames 可选文件名列表，未提供时按 'paste_0.php' / 'paste_1.php' 分配
 */
export async function parsePastedText(
  text: string,
  filenames?: string[],
): Promise<FileEntry[]> {
  if (!text.trim()) return [];
  const parts = text.split(/\n---\n/);
  const entries: FileEntry[] = [];
  for (let i = 0; i < parts.length; i++) {
    const trimmed = parts[i]!.trim();
    if (!trimmed) continue;
    const path = filenames?.[i] ?? `paste_${i}.php`;
    entries.push({ path, content: trimmed });
  }
  return entries;
}

/**
 * 别名：与任务上下文中的 parsePastedFiles 名称对齐
 */
export const parsePastedFiles = parsePastedText;

/**
 * 从拖拽数据中递归读取 .php 文件
 *
 * 对齐 oblivions/editor/src/main.js drop 事件处理：
 *   - 优先使用 webkitGetAsEntry 递归读取目录结构
 *   - 回退到 dataTransfer.files 直接读取
 */
export async function readDroppedItems(dataTransfer: DataTransfer): Promise<FileEntry[]> {
  const items = dataTransfer.items;
  if (items && items.length > 0) {
    const entries: FileSystemEntry[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      const entry = item.webkitGetAsEntry?.();
      if (entry) entries.push(entry);
    }
    if (entries.length > 0) {
      return readEntriesRecursive(entries);
    }
  }
  // 回退到 dataTransfer.files
  if (dataTransfer.files && dataTransfer.files.length > 0) {
    return readFilesFromFileList(dataTransfer.files);
  }
  return [];
}

/**
 * 递归读取 FileSystemEntry 列表
 */
async function readEntriesRecursive(entries: FileSystemEntry[]): Promise<FileEntry[]> {
  const result: FileEntry[] = [];
  for (const entry of entries) {
    if (entry.isFile) {
      const fileEntry = entry as FileSystemFileEntry;
      const file = await readFileEntry(fileEntry);
      if (file.name.endsWith('.php')) {
        const content = await file.text();
        // webkitGetAsEntry 不提供完整路径，使用文件名作为 path
        result.push({ path: file.name, content });
      }
    } else if (entry.isDirectory) {
      const dirEntry = entry as FileSystemDirectoryEntry;
      const reader = dirEntry.createReader();
      const subEntries = await readAllDirectoryEntries(reader);
      const subFiles = await readEntriesRecursive(subEntries);
      // 为子目录文件拼接目录前缀
      for (const subFile of subFiles) {
        result.push({
          path: `${entry.name}/${subFile.path}`,
          content: subFile.content,
        });
      }
    }
  }
  return result;
}

/**
 * 读取目录下所有条目（readEntries 一次最多返回 100 条，需循环读取）
 */
function readAllDirectoryEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const all: FileSystemEntry[] = [];
    const readBatch = (): void => {
      reader.readEntries(
        (entries) => {
          if (entries.length === 0) {
            resolve(all);
          } else {
            all.push(...entries);
            readBatch();
          }
        },
        reject,
      );
    };
    readBatch();
  });
}

/**
 * 从 FileSystemEntry 读取 File 对象
 */
function readFileEntry(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => {
    entry.file(resolve, reject);
  });
}

/**
 * 写回源目录（备份旧文件为 ZIP 后再覆盖）
 *
 * 对齐 oblivions/editor/src/main.js quickExportToDir 行为：
 *   1. 收集旧文件内容，打包备份（备份由 zip-bundle 实现）
 *   2. 删除项目中不再存在的 region_*.php（避免残留）
 *   3. 写入新文件
 *
 * @param handle 源目录句柄（必须为 readwrite 模式）
 * @param entries 要写入的文件列表
 * @param options.backupOldFiles 是否备份旧文件（默认 true）
 * @param options.onBackup 备份回调，由调用方提供（实现备份 ZIP 下载）
 */
export async function writeBackToSource(
  handle: FileSystemDirectoryHandle,
  entries: FileEntry[],
  options?: {
    backupOldFiles?: boolean;
    onBackup?: (backupEntries: FileEntry[]) => Promise<void>;
  },
): Promise<void> {
  const { backupOldFiles = true, onBackup } = options ?? {};

  // 1. 收集旧文件并触发备份
  if (backupOldFiles && onBackup) {
    const oldEntries = await collectExistingFiles(handle);
    if (oldEntries.length > 0) {
      await onBackup(oldEntries);
    }
  }

  // 2. 写入新文件（按 path 分发到对应子目录）
  for (const entry of entries) {
    await writeTextFile(handle, entry.path, entry.content);
  }

  // 3. 删除项目中不再存在的 region_*.php（避免残留）
  // 仅当新 entries 中包含 tiles/ 前缀文件时才清理
  const newRegionFiles = new Set(
    entries
      .filter((e) => e.path.startsWith('tiles/region_') && e.path.endsWith('.php'))
      .map((e) => e.path.substring('tiles/'.length)),
  );
  if (newRegionFiles.size > 0) {
    try {
      const tilesDir = await handle.getDirectoryHandle('tiles');
      for await (const item of tilesDir.values()) {
        if (
          item.kind === 'file' &&
          item.name.startsWith('region_') &&
          item.name.endsWith('.php') &&
          !newRegionFiles.has(item.name)
        ) {
          await tilesDir.removeEntry(item.name);
        }
      }
    } catch {
      // tiles 目录不存在，无需清理
    }
  }
}

/**
 * 收集目录中已存在的所有 .php 文件（用于备份）
 */
export async function collectExistingFiles(
  handle: FileSystemDirectoryHandle,
): Promise<FileEntry[]> {
  return readPhpFilesFromDirectory(handle, '');
}

/**
 * 写入文本文件到目录（自动创建子目录）
 *
 * @param handle 根目录句柄
 * @param path 相对路径（如 'map.php' / 'tiles/region_1.php'）
 * @param content 文件内容
 */
export async function writeTextFile(
  handle: FileSystemDirectoryHandle,
  path: string,
  content: string,
): Promise<void> {
  const parts = path.split('/');
  let currentDir = handle;
  // 创建/进入子目录（除最后一段外）
  for (let i = 0; i < parts.length - 1; i++) {
    currentDir = await currentDir.getDirectoryHandle(parts[i]!, { create: true });
  }
  const fileName = parts[parts.length - 1]!;
  const fileHandle = await currentDir.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}

// ─── 备份/还原辅助（Task G2 + H1） ───────────────────────────────

/**
 * 格式化备份时间戳（YYYYMMDD_HHMMSS，对齐后端 oblivions/gamedata/backup/ 已有命名约定）
 *
 * 用于：
 *   - backupGamedata 创建时间戳子目录
 *   - listBackups 与后端 ZIP 备份名按时间戳排序
 */
export function formatBackupTimestamp(date: Date): string {
  const pad = (n: number): string => n.toString().padStart(2, '0');
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const h = pad(date.getHours());
  const min = pad(date.getMinutes());
  const s = pad(date.getSeconds());
  return `${y}${m}${d}_${h}${min}${s}`;
}

/**
 * 列出目录下所有子目录名（按名称降序排列，最新备份在前）
 *
 * 用于 restoreFromBackup 列出 backup/ 下所有时间戳子目录
 *
 * @param handle 目录句柄
 * @returns 子目录名数组（按名称降序排列）
 */
export async function listSubDirectories(
  handle: FileSystemDirectoryHandle,
): Promise<string[]> {
  const names: string[] = [];
  for await (const entry of handle.values()) {
    if (entry.kind === 'directory') {
      names.push(entry.name);
    }
  }
  return names.sort((a, b) => b.localeCompare(a));
}

/**
 * 列出目录下所有 .zip 文件名（按名称降序排列，最新在前）
 *
 * 用于 restoreFromBackup 兼容后端生成的 oblivions_map_backup_*.zip 备份
 *
 * @param handle 目录句柄
 * @returns .zip 文件名数组（按名称降序排列）
 */
export async function listZipFiles(
  handle: FileSystemDirectoryHandle,
): Promise<string[]> {
  const names: string[] = [];
  for await (const entry of handle.values()) {
    if (entry.kind === 'file' && entry.name.endsWith('.zip')) {
      names.push(entry.name);
    }
  }
  return names.sort((a, b) => b.localeCompare(a));
}
