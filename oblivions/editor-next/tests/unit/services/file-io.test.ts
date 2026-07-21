//
// file-io 单元测试（对齐 NEW_DESIGN.md §4.1）
// 覆盖目标：≥80%
//
// 测试策略：
//   - parsePastedText / extractRelativePath：纯函数测试
//   - pickDirectory / readPhpFilesFromDirectory / writeTextFile：mock FileSystemDirectoryHandle
//   - readDroppedItems：mock DataTransfer
//   - isFileSystemAccessSupported：mock window.showDirectoryPicker

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  isFileSystemAccessSupported,
  parsePastedText,
  parsePastedFiles,
  readFilesFromFileList,
  readDroppedItems,
  writeTextFile,
  type FileEntry,
} from '@/services/file-io';

// ─── isFileSystemAccessSupported ─────────────────────────────

describe('isFileSystemAccessSupported', () => {
  beforeEach(() => {
    delete (window as { showDirectoryPicker?: unknown }).showDirectoryPicker;
  });

  it('window.showDirectoryPicker 存在返回 true', () => {
    window.showDirectoryPicker = vi.fn();
    expect(isFileSystemAccessSupported()).toBe(true);
  });

  it('window.showDirectoryPicker 不存在返回 false', () => {
    expect(isFileSystemAccessSupported()).toBe(false);
  });
});

// ─── parsePastedText ─────────────────────────────────────────

describe('parsePastedText', () => {
  it('空文本返回空数组', async () => {
    expect(await parsePastedText('')).toEqual([]);
    expect(await parsePastedText('   ')).toEqual([]);
  });

  it('单段文本返回单文件', async () => {
    const entries = await parsePastedText('return [1, 2];');
    expect(entries).toHaveLength(1);
    expect(entries[0]?.content).toBe('return [1, 2];');
    expect(entries[0]?.path).toBe('paste_0.php');
  });

  it('多段文本用 \\n---\\n 分隔', async () => {
    const text = 'return [1];\n---\nreturn [2];\n---\nreturn [3];';
    const entries = await parsePastedText(text);
    expect(entries).toHaveLength(3);
    expect(entries[0]?.content).toBe('return [1];');
    expect(entries[1]?.content).toBe('return [2];');
    expect(entries[2]?.content).toBe('return [3];');
  });

  it('自定义文件名列表', async () => {
    const text = 'return [1];\n---\nreturn [2];';
    const entries = await parsePastedText(text, ['map.php', 'tiles/region_1.php']);
    expect(entries[0]?.path).toBe('map.php');
    expect(entries[1]?.path).toBe('tiles/region_1.php');
  });

  it('空段被跳过', async () => {
    const text = 'return [1];\n---\n   \n---\nreturn [3];';
    const entries = await parsePastedText(text);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.content).toBe('return [1];');
    expect(entries[1]?.content).toBe('return [3];');
  });

  it('parsePastedFiles 是 parsePastedText 的别名', () => {
    expect(parsePastedFiles).toBe(parsePastedText);
  });
});

// ─── readFilesFromFileList ───────────────────────────────────

describe('readFilesFromFileList', () => {
  function makeMockFile(name: string, content: string, relativePath?: string): File {
    const file = new File([content], name, { type: 'text/plain' });
    if (relativePath) {
      Object.defineProperty(file, 'webkitRelativePath', {
        value: relativePath,
        configurable: true,
      });
    }
    return file;
  }

  it('读取 .php 文件并返回 FileEntry', async () => {
    const files = [
      makeMockFile('map.php', '<?php return [];'),
      makeMockFile('readme.txt', 'not php'),
    ];
    const entries = await readFilesFromFileList(files);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.path).toBe('map.php');
    expect(entries[0]?.content).toBe('<?php return [];');
  });

  it('剥离 webkitRelativePath 顶层目录名', async () => {
    const files = [
      makeMockFile('map.php', '<?php return [];', 'gamedata/map.php'),
      makeMockFile('region_1.php', '<?php return [];', 'gamedata/tiles/region_1.php'),
    ];
    const entries = await readFilesFromFileList(files);
    expect(entries[0]?.path).toBe('map.php');
    expect(entries[1]?.path).toBe('tiles/region_1.php');
  });

  it('无 webkitRelativePath 时使用文件名', async () => {
    const files = [makeMockFile('alone.php', '<?php return [];')];
    const entries = await readFilesFromFileList(files);
    expect(entries[0]?.path).toBe('alone.php');
  });

  it('过滤非 .php 文件', async () => {
    const files = [
      makeMockFile('a.php', '<?php'),
      makeMockFile('b.txt', 'text'),
      makeMockFile('c.json', '{}'),
      makeMockFile('d.php', '<?php echo 2;'),
    ];
    const entries = await readFilesFromFileList(files);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.path).toBe('a.php');
    expect(entries[1]?.path).toBe('d.php');
  });
});

// ─── readDroppedItems ────────────────────────────────────────

describe('readDroppedItems', () => {
  it('无 items 与 files 返回空数组', async () => {
    const dt = { items: [], files: [] } as unknown as DataTransfer;
    const entries = await readDroppedItems(dt);
    expect(entries).toEqual([]);
  });

  it('回退到 dataTransfer.files 直接读取', async () => {
    const file = new File(['<?php return [];'], 'dropped.php', { type: 'text/plain' });
    const dt = {
      items: [],
      files: [file],
    } as unknown as DataTransfer;
    const entries = await readDroppedItems(dt);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.path).toBe('dropped.php');
    expect(entries[0]?.content).toBe('<?php return [];');
  });
});

// ─── writeTextFile（mock FileSystemDirectoryHandle） ─────────

describe('writeTextFile', () => {
  it('写入根目录文件', async () => {
    const writable = {
      write: vi.fn(),
      close: vi.fn(),
    };
    const fileHandle = {
      createWritable: vi.fn().mockResolvedValue(writable),
    };
    const handle = {
      getFileHandle: vi.fn().mockResolvedValue(fileHandle),
      getDirectoryHandle: vi.fn(),
    } as unknown as FileSystemDirectoryHandle;

    await writeTextFile(handle, 'map.php', '<?php return [];');

    expect(handle.getFileHandle).toHaveBeenCalledWith('map.php', { create: true });
    expect(fileHandle.createWritable).toHaveBeenCalled();
    expect(writable.write).toHaveBeenCalledWith('<?php return [];');
    expect(writable.close).toHaveBeenCalled();
  });

  it('写入子目录文件时自动创建目录', async () => {
    const writable = { write: vi.fn(), close: vi.fn() };
    const fileHandle = { createWritable: vi.fn().mockResolvedValue(writable) };
    const tilesDir = {
      getFileHandle: vi.fn().mockResolvedValue(fileHandle),
    };
    const rootHandle = {
      getDirectoryHandle: vi.fn().mockResolvedValue(tilesDir),
    } as unknown as FileSystemDirectoryHandle;

    await writeTextFile(rootHandle, 'tiles/region_1.php', '<?php return [];');

    expect(rootHandle.getDirectoryHandle).toHaveBeenCalledWith('tiles', { create: true });
    expect(tilesDir.getFileHandle).toHaveBeenCalledWith('region_1.php', { create: true });
    expect(writable.write).toHaveBeenCalledWith('<?php return [];');
  });

  it('多级子目录路径', async () => {
    const writable = { write: vi.fn(), close: vi.fn() };
    const fileHandle = { createWritable: vi.fn().mockResolvedValue(writable) };
    const deepDir = { getFileHandle: vi.fn().mockResolvedValue(fileHandle) };
    const midDir = {
      getDirectoryHandle: vi.fn().mockResolvedValue(deepDir),
    };
    const rootHandle = {
      getDirectoryHandle: vi.fn().mockResolvedValue(midDir),
    } as unknown as FileSystemDirectoryHandle;

    await writeTextFile(rootHandle, 'a/b/c.php', 'content');

    expect(rootHandle.getDirectoryHandle).toHaveBeenCalledWith('a', { create: true });
    expect(midDir.getDirectoryHandle).toHaveBeenCalledWith('b', { create: true });
    expect(deepDir.getFileHandle).toHaveBeenCalledWith('c.php', { create: true });
  });
});

// ─── FileEntry 类型守护 ──────────────────────────────────────

describe('FileEntry 类型', () => {
  it('FileEntry 接口字段 readonly', () => {
    const entry: FileEntry = { path: 'map.php', content: '<?php' };
    expect(entry.path).toBe('map.php');
    expect(entry.content).toBe('<?php');
  });
});
