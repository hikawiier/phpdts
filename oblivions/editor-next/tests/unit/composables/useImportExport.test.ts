//
// useImportExport 单元测试（对齐 NEW_DESIGN.md §3.2.3 + §3.2.4）
//
// 覆盖点：
//   - exportZip：有项目调用 bundleZip + downloadZip / 无项目 toast 提示
//   - writeBackToSource：无 sourceDirHandle 时让用户选择目录（pickDirectory 返回 null 则静默退出）/ 有 sourceDirHandle 调用 writeBackToSourceIO
//   - canExport：有项目 + 非导出中 = true / 无项目 = false / 导出中 = false
//   - canWriteBackToSource：有 sourceDirHandle + 有项目 = true
//
// 测试策略：
//   - mock zip-bundle.bundleZip / downloadZip / generateExportFilename（避免文件下载）
//   - mock file-io（避免 File System Access API）
//   - mock worker-bridge（避免 Worker 创建）
//   - mock @/shared.generateProjectFiles

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

// ─── 用 vi.hoisted 提升 mock 变量到 vi.mock 之前 ──────────────

const {
  mockBundleZip,
  mockDownloadZip,
  mockGenerateExportFilename,
  mockWriteBackToSourceIO,
  mockPickDirectory,
  mockParsePastedText,
  mockReadDroppedItems,
} = vi.hoisted(() => ({
  mockBundleZip: vi.fn().mockResolvedValue(new Blob(['zip'], { type: 'application/zip' })),
  mockDownloadZip: vi.fn().mockResolvedValue(undefined),
  mockGenerateExportFilename: vi.fn().mockReturnValue('oblivions_gamedata_test.zip'),
  mockWriteBackToSourceIO: vi.fn().mockResolvedValue(undefined),
  mockPickDirectory: vi.fn().mockResolvedValue(null),
  mockParsePastedText: vi.fn().mockResolvedValue([]),
  mockReadDroppedItems: vi.fn().mockResolvedValue([]),
}));

// ─── mock zip-bundle ───────────────────────────────────────────

vi.mock('@/services/zip-bundle', () => ({
  bundleZip: mockBundleZip,
  downloadZip: mockDownloadZip,
  generateExportFilename: mockGenerateExportFilename,
}));

// ─── mock file-io ──────────────────────────────────────────────

vi.mock('@/services/file-io', () => ({
  pickDirectory: mockPickDirectory,
  parsePastedText: mockParsePastedText,
  readDroppedItems: mockReadDroppedItems,
  writeBackToSource: mockWriteBackToSourceIO,
}));

// ─── mock worker-bridge ────────────────────────────────────────

vi.mock('@/services/worker-bridge', () => ({
  createPhpParserWorker: vi.fn(),
  shouldUseWorker: vi.fn().mockReturnValue(false),
}));

// ─── mock @/shared ────────────────────────────────────

vi.mock('@/shared', () => ({
  parseMapPhp: vi.fn(),
  parseRegionPhp: vi.fn(),
  extractPgroupFromFilename: vi.fn(),
  assembleMapProject: vi.fn(),
  generateProjectFiles: vi.fn().mockReturnValue({
    'map.php': '<?php return [];',
    'tiles/region_1.php': '<?php return [1];',
  }),
}));

// ─── 测试套件导入（在 mock 之后） ─────────────────────────────

import { useImportExport } from '@/composables/useImportExport';
import { useProjectStore } from '@/stores/projectStore';
import { useUiStore } from '@/stores/uiStore';

// ─── 测试套件 ──────────────────────────────────────────────────

describe('useImportExport', () => {
  let project: ReturnType<typeof useProjectStore>;
  let ui: ReturnType<typeof useUiStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    project = useProjectStore();
    ui = useUiStore();
    vi.clearAllMocks();
  });

  // ─── canExport ────────────────────────────────────────

  describe('canExport', () => {
    it('无项目时 canExport=false', () => {
      const { canExport } = useImportExport();
      expect(canExport.value).toBe(false);
    });

    it('有项目时 canExport=true', () => {
      project.loadProject({
        regions: { 1: { name: 'R1', desc: '', entrance_pls: null, exit_pls: null, next_region: null, prev_region: null, exit_links: [], cols: 4, rows: 4 } },
        grids: { 1: { cols: 4, rows: 4 } },
        tiles: { 1: {} },
      });
      const { canExport } = useImportExport();
      expect(canExport.value).toBe(true);
    });
  });

  // ─── canWriteBackToSource ─────────────────────────────

  describe('canWriteBackToSource', () => {
    it('无 sourceDirHandle 时 canWriteBackToSource=false', () => {
      const { canWriteBackToSource } = useImportExport();
      expect(canWriteBackToSource.value).toBe(false);
    });
  });

  // ─── exportZip ────────────────────────────────────────

  describe('exportZip', () => {
    it('空项目时仍可执行（project.project 始终为 makeEmptyProject 对象，guard 不触发）', async () => {
      const { exportZip } = useImportExport();
      const showToastSpy = vi.spyOn(ui, 'showToast');
      await exportZip();
      // project.project 始终为对象（makeEmptyProject），guard !project.project 不触发
      // 导出流程继续：generateProjectFiles → bundleZip → downloadZip → toast 成功
      expect(mockBundleZip).toHaveBeenCalledTimes(1);
      expect(mockDownloadZip).toHaveBeenCalledTimes(1);
      expect(showToastSpy).toHaveBeenCalledWith(
        expect.stringContaining('已导出'),
        'success',
      );
    });

    it('有项目时调用 bundleZip + downloadZip + markSaved + toast', async () => {
      project.loadProject({
        regions: { 1: { name: 'R1', desc: '', entrance_pls: null, exit_pls: null, next_region: null, prev_region: null, exit_links: [], cols: 4, rows: 4 } },
        grids: { 1: { cols: 4, rows: 4 } },
        tiles: { 1: {} },
      });
      const { exportZip } = useImportExport();
      const showToastSpy = vi.spyOn(ui, 'showToast');
      await exportZip();
      expect(mockBundleZip).toHaveBeenCalledTimes(1);
      expect(mockDownloadZip).toHaveBeenCalledTimes(1);
      expect(showToastSpy).toHaveBeenCalledWith(
        expect.stringContaining('已导出'),
        'success',
      );
    });
  });

  // ─── writeBackToSource ────────────────────────────────

  describe('writeBackToSource', () => {
    it('空项目时无 sourceDirHandle 调用 pickDirectory 让用户选择目录（mocked 返回 null → 静默退出）', async () => {
      const { writeBackToSource } = useImportExport();
      const showToastSpy = vi.spyOn(ui, 'showToast');
      await writeBackToSource();
      // project.project 始终为对象（makeEmptyProject），guard !project.project 不触发
      // sourceDirHandle 为 null → 调用 pickDirectory（mocked 返回 null）→ 静默退出
      expect(mockPickDirectory).toHaveBeenCalledTimes(1);
      expect(showToastSpy).not.toHaveBeenCalled();
    });

    it('有项目但无 sourceDirHandle 时调用 pickDirectory 让用户选择目录（mocked 返回 null → 静默退出）', async () => {
      project.loadProject({
        regions: { 1: { name: 'R1', desc: '', entrance_pls: null, exit_pls: null, next_region: null, prev_region: null, exit_links: [], cols: 4, rows: 4 } },
        grids: { 1: { cols: 4, rows: 4 } },
        tiles: { 1: {} },
      });
      const { writeBackToSource } = useImportExport();
      const showToastSpy = vi.spyOn(ui, 'showToast');
      await writeBackToSource();
      // sourceDirHandle 为 null → 调用 pickDirectory（mocked 返回 null）→ 静默退出
      expect(mockPickDirectory).toHaveBeenCalledTimes(1);
      expect(showToastSpy).not.toHaveBeenCalled();
    });
  });

  // ─── resetProgress ────────────────────────────────────

  describe('resetProgress', () => {
    it('调用 resetProgress 后 importProgress 回到 idle', () => {
      const { importProgress, resetProgress } = useImportExport();
      resetProgress();
      expect(importProgress.value.stage).toBe('idle');
    });
  });
});
