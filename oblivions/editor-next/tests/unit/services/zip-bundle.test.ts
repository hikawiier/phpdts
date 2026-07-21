//
// zip-bundle 单元测试（对齐 NEW_DESIGN.md §4.1）
// 覆盖目标：≥80%
//
// 测试策略：
//   - bundleZip / unzipBundle：round-trip 真实 ZIP 打包/解压
//   - downloadZip：mock file-saver.saveAs
//   - generateExportFilename：纯函数测试

import { describe, it, expect, vi, beforeEach } from 'vitest';
import JSZip from 'jszip';
import {
  bundleZip,
  downloadZip,
  unzipBundle,
  generateExportFilename,
} from '@/services/zip-bundle';
import type { FileEntry } from '@/services/file-io';

// mock file-saver
vi.mock('file-saver', () => ({
  saveAs: vi.fn(),
}));

import { saveAs } from 'file-saver';

// ─── bundleZip ───────────────────────────────────────────────

describe('bundleZip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('将 FileEntry 列表打包为 ZIP Blob', async () => {
    const entries: FileEntry[] = [
      { path: 'map.php', content: '<?php return [];' },
      { path: 'tiles/region_1.php', content: '<?php return [1];' },
    ];
    const blob = await bundleZip(entries);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
  });

  it('空 entries 也能打包', async () => {
    const blob = await bundleZip([]);
    expect(blob).toBeInstanceOf(Blob);
  });

  it('ZIP 内文件路径与 entries.path 一致', async () => {
    const entries: FileEntry[] = [
      { path: 'a.php', content: 'content-a' },
      { path: 'sub/b.php', content: 'content-b' },
    ];
    const blob = await bundleZip(entries);
    // 解压验证
    const unzipped = await unzipBundle(blob);
    expect(unzipped).toHaveLength(2);
    const paths = unzipped.map((e) => e.path).sort();
    expect(paths).toEqual(['a.php', 'sub/b.php']);
  });
});

// ─── unzipBundle ─────────────────────────────────────────────

describe('unzipBundle', () => {
  it('round-trip：打包后解压内容一致', async () => {
    const entries: FileEntry[] = [
      { path: 'map.php', content: '<?php return [1, 2, 3];' },
      { path: 'tiles/region_1.php', content: '<?php return ["x" => 1];' },
    ];
    const blob = await bundleZip(entries);
    const unzipped = await unzipBundle(blob);
    expect(unzipped).toHaveLength(2);
    const byPath = new Map(unzipped.map((e) => [e.path, e.content]));
    expect(byPath.get('map.php')).toBe('<?php return [1, 2, 3];');
    expect(byPath.get('tiles/region_1.php')).toBe('<?php return ["x" => 1];');
  });

  it('非 .php 文件被过滤', async () => {
    const zip = new JSZip();
    zip.file('a.php', '<?php');
    zip.file('b.txt', 'text');
    zip.file('c.json', '{}');
    const blob = await zip.generateAsync({ type: 'blob' });
    const unzipped = await unzipBundle(blob);
    expect(unzipped).toHaveLength(1);
    expect(unzipped[0]?.path).toBe('a.php');
  });

  it('目录条目被跳过', async () => {
    const zip = new JSZip();
    zip.folder('subdir');
    zip.file('subdir/a.php', '<?php');
    const blob = await zip.generateAsync({ type: 'blob' });
    const unzipped = await unzipBundle(blob);
    expect(unzipped).toHaveLength(1);
    expect(unzipped[0]?.path).toBe('subdir/a.php');
  });
});

// ─── downloadZip ─────────────────────────────────────────────

describe('downloadZip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('调用 file-saver.saveAs', async () => {
    const blob = new Blob(['test'], { type: 'application/zip' });
    await downloadZip(blob, 'test.zip');
    expect(saveAs).toHaveBeenCalledWith(blob, 'test.zip');
  });
});

// ─── generateExportFilename ──────────────────────────────────

describe('generateExportFilename', () => {
  it('默认前缀 oblivions_gamedata', () => {
    const filename = generateExportFilename();
    expect(filename).toMatch(/^oblivions_gamedata_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.zip$/);
  });

  it('自定义前缀', () => {
    const filename = generateExportFilename('oblivions_backup');
    expect(filename).toMatch(/^oblivions_backup_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.zip$/);
  });

  it('时间戳中的 : 与 . 被替换为 -', () => {
    const filename = generateExportFilename();
    // 去掉前缀与 .zip 后缀后，时间戳段不应含 : 或 .（ISO 中的 : 与 . 都被替换为 -）
    // ISO 时间戳格式 2024-01-01T12:30:45.123Z → 文件名中应为 2024-01-01T12-30-45
    const ts = filename.replace(/^oblivions_gamedata_/, '').replace(/\.zip$/, '');
    expect(ts).not.toMatch(/[:.]/);
  });
});
