// @module O 内容工具箱
//
// zip-bundle：jszip 打包 + file-saver 下载（对齐 NEW_DESIGN.md §3.2.4）
//
// 提供四个出口：
//   1. bundleZip(entries)：通用 ZIP 打包（编辑器导出 gamedata 用）
//   2. downloadZip(blob, filename)：file-saver 下载（与 bundleZip 配合）
//   3. unzipBundle(blob)：解压 ZIP Blob 为 FileEntry 列表（导入用）
//   4. generateExportFilename(prefix)：生成时间戳文件名

import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import type { FileEntry } from './file-io';

/**
 * 将 FileEntry 列表打包为 ZIP Blob
 *
 * entries[i].path 作为 ZIP 内相对路径（如 'map.php' / 'tiles/region_1.php'），
 * entries[i].content 作为文件内容
 */
export async function bundleZip(entries: FileEntry[]): Promise<Blob> {
  const zip = new JSZip();
  for (const entry of entries) {
    zip.file(entry.path, entry.content);
  }
  return zip.generateAsync({ type: 'blob' });
}

/**
 * 下载 ZIP Blob 到本地
 *
 * 使用 file-saver 的 saveAs 实现
 */
export async function downloadZip(blob: Blob, filename: string): Promise<void> {
  saveAs(blob, filename);
}

/**
 * 解压 ZIP Blob 为 FileEntry 列表
 *
 * 用于导入已有的 gamedata ZIP 备份
 */
export async function unzipBundle(blob: Blob): Promise<FileEntry[]> {
  const zip = await JSZip.loadAsync(blob);
  const entries: FileEntry[] = [];
  const promises: Promise<void>[] = [];
  zip.forEach((path, file) => {
    if (file.dir) return;
    if (!path.endsWith('.php')) return;
    promises.push(
      file.async('string').then((content) => {
        entries.push({ path, content });
      }),
    );
  });
  await Promise.all(promises);
  return entries;
}

/**
 * 生成时间戳文件名（用于编辑器导出 ZIP）
 *
 * 文件名格式：oblivions_gamedata_<timestamp>.zip
 */
export function generateExportFilename(prefix = 'oblivions_gamedata'): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `${prefix}_${ts}.zip`;
}
