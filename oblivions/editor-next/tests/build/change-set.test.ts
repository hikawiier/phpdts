//
// O-5 Change Set 单元测试
//
// 覆盖目标：
//   - 基线捕获与失效检测（FileRevision 三元组）
//   - NodeChange 5 种合并规则
//   - computeDiff 输出正确性
//   - 序列化/反序列化 round-trip
//
// 注意：本文件位于 tests/build/ 而非 tests/unit/build/，
// vitest 默认 include 不覆盖此路径——主要作为 TypeScript 类型校验与行为文档。
// 若需纳入 CI 运行，将本文件移至 tests/unit/build/ 或更新 vitest.config.ts 的 include。
//

import { describe, it, expect } from 'vitest';
import {
  computeFileRevision,
  isRevisionEqual,
  serializeRevision,
  deserializeRevision,
  type FileRevision,
} from '@/build/file-revision';
import {
  createNodeChange,
  isNodeChangeEqual,
  mergeNodeChange,
  NODE_CHANGE_CANCELED,
  type NodeChange,
} from '@/build/node-change';
import { ChangeSet } from '@/build/change-set';

// ─── FileRevision ────────────────────────────────────────────

describe('FileRevision', () => {
  it('computeFileRevision 生成稳定的三元组', async () => {
    const r1 = await computeFileRevision('hello', { mtime: 1000, size: 5 });
    const r2 = await computeFileRevision('hello', { mtime: 1000, size: 5 });
    expect(r1.mtime).toBe(1000);
    expect(r1.size).toBe(5);
    expect(r1.contentHash).toHaveLength(32);
    expect(isRevisionEqual(r1, r2)).toBe(true);
  });

  it('内容变化导致 contentHash 变化', async () => {
    const r1 = await computeFileRevision('hello', { mtime: 1000, size: 5 });
    const r2 = await computeFileRevision('world', { mtime: 1000, size: 5 });
    expect(r1.contentHash).not.toBe(r2.contentHash);
    expect(isRevisionEqual(r1, r2)).toBe(false);
  });

  it('mtime 变化导致 revision 不等', async () => {
    const r1 = await computeFileRevision('hello', { mtime: 1000, size: 5 });
    const r2 = await computeFileRevision('hello', { mtime: 2000, size: 5 });
    expect(isRevisionEqual(r1, r2)).toBe(false);
  });

  it('size 变化导致 revision 不等', async () => {
    const r1 = await computeFileRevision('hello', { mtime: 1000, size: 5 });
    const r2 = await computeFileRevision('hello', { mtime: 1000, size: 6 });
    expect(isRevisionEqual(r1, r2)).toBe(false);
  });

  it('serializeRevision / deserializeRevision round-trip', async () => {
    const r = await computeFileRevision('content', { mtime: 1234, size: 7 });
    const s = serializeRevision(r);
    const restored = deserializeRevision(s);
    expect(restored).not.toBeNull();
    expect(isRevisionEqual(r, restored as FileRevision)).toBe(true);
  });

  it('deserializeRevision 拒绝非法格式', () => {
    expect(deserializeRevision('invalid')).toBeNull();
    expect(deserializeRevision('a|b|c')).toBeNull();
    expect(deserializeRevision('1000|5|')).toBeNull();
  });
});

// ─── NodeChange 合并规则 ─────────────────────────────────────

describe('NodeChange merge rules', () => {
  const nodeId = 'item.template:compass';

  it('add + update → add（newData 用 incoming）', () => {
    const add = createNodeChange('add', nodeId, undefined, { name: 'v1' });
    const update = createNodeChange('update', nodeId, { name: 'v1' }, { name: 'v2' });
    const merged = mergeNodeChange(add, update);
    expect(merged).not.toBe(NODE_CHANGE_CANCELED);
    expect((merged as NodeChange).type).toBe('add');
    expect((merged as NodeChange).newData).toEqual({ name: 'v2' });
    expect((merged as NodeChange).oldData).toBeUndefined();
  });

  it('update + update → update（oldData 用 existing，newData 用 incoming）', () => {
    const u1 = createNodeChange('update', nodeId, { name: 'v1' }, { name: 'v2' });
    const u2 = createNodeChange('update', nodeId, { name: 'v2' }, { name: 'v3' });
    const merged = mergeNodeChange(u1, u2);
    expect((merged as NodeChange).type).toBe('update');
    expect((merged as NodeChange).oldData).toEqual({ name: 'v1' });
    expect((merged as NodeChange).newData).toEqual({ name: 'v3' });
  });

  it('update + remove → remove（无 newData）', () => {
    const update = createNodeChange('update', nodeId, { name: 'v1' }, { name: 'v2' });
    const remove = createNodeChange('remove', nodeId, { name: 'v2' }, undefined);
    const merged = mergeNodeChange(update, remove);
    expect((merged as NodeChange).type).toBe('remove');
    expect((merged as NodeChange).newData).toBeUndefined();
  });

  it('add + remove → 取消（NODE_CHANGE_CANCELED）', () => {
    const add = createNodeChange('add', nodeId, undefined, { name: 'v1' });
    const remove = createNodeChange('remove', nodeId, { name: 'v1' }, undefined);
    const merged = mergeNodeChange(add, remove);
    expect(merged).toBe(NODE_CHANGE_CANCELED);
  });

  it('remove + add → update（视为还原）', () => {
    const remove = createNodeChange('remove', nodeId, { name: 'old' }, undefined);
    const add = createNodeChange('add', nodeId, undefined, { name: 'new' });
    const merged = mergeNodeChange(remove, add);
    expect((merged as NodeChange).type).toBe('update');
    expect((merged as NodeChange).oldData).toEqual({ name: 'old' });
    expect((merged as NodeChange).newData).toEqual({ name: 'new' });
  });

  it('isNodeChangeEqual: 同 nodeId + 同 type 视为相同', () => {
    const a = createNodeChange('update', nodeId, { x: 1 }, { x: 2 }, 1000);
    const b = createNodeChange('update', nodeId, { x: 3 }, { x: 4 }, 2000);
    expect(isNodeChangeEqual(a, b)).toBe(true);
  });

  it('isNodeChangeEqual: 不同 type 视为不同', () => {
    const a = createNodeChange('add', nodeId, undefined, { x: 1 });
    const b = createNodeChange('update', nodeId, { x: 0 }, { x: 1 });
    expect(isNodeChangeEqual(a, b)).toBe(false);
  });
});

// ─── ChangeSet ───────────────────────────────────────────────

describe('ChangeSet', () => {
  it('captureBaseline 捕获基线，getBaseline 取回', async () => {
    const cs = new ChangeSet();
    await cs.captureBaseline([
      { path: 'a.php', content: 'aaa', mtime: 1000, size: 3 },
      { path: 'b.php', content: 'bbb', mtime: 2000, size: 3 },
    ]);
    expect(cs.getBaseline('a.php')).toBeDefined();
    expect(cs.getBaseline('a.php')?.size).toBe(3);
    expect(cs.getBaseline('b.php')?.mtime).toBe(2000);
    expect(cs.getBaseline('missing.php')).toBeUndefined();
  });

  it('isBaselineStale: 三元组全等返回 false', async () => {
    const cs = new ChangeSet();
    await cs.captureBaseline([{ path: 'a.php', content: 'aaa', mtime: 1000, size: 3 }]);
    const baseline = cs.getBaseline('a.php') as FileRevision;
    expect(cs.isBaselineStale('a.php', baseline)).toBe(false);
  });

  it('isBaselineStale: mtime 变化返回 true', async () => {
    const cs = new ChangeSet();
    await cs.captureBaseline([{ path: 'a.php', content: 'aaa', mtime: 1000, size: 3 }]);
    const current: FileRevision = { mtime: 9999, size: 3, contentHash: cs.getBaseline('a.php')!.contentHash };
    expect(cs.isBaselineStale('a.php', current)).toBe(true);
  });

  it('isBaselineStale: 无基线返回 true', () => {
    const cs = new ChangeSet();
    expect(cs.isBaselineStale('missing.php', { mtime: 0, size: 0, contentHash: '' })).toBe(true);
  });

  it('applyNodeChange: 首次写入 pendingChanges', () => {
    const cs = new ChangeSet();
    cs.applyNodeChange(createNodeChange('add', 'item.template:x', undefined, { v: 1 }));
    const pending = cs.getPendingChanges();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.type).toBe('add');
  });

  it('applyNodeChange: add + remove 相消后从 pendingChanges 移除', () => {
    const cs = new ChangeSet();
    cs.applyNodeChange(createNodeChange('add', 'item.template:x', undefined, { v: 1 }));
    cs.applyNodeChange(createNodeChange('remove', 'item.template:x', { v: 1 }, undefined));
    expect(cs.getPendingChanges()).toHaveLength(0);
    expect(cs.isEmpty()).toBe(true);
  });

  it('applyNodeChange: update + update 合并后只剩一条 update', () => {
    const cs = new ChangeSet();
    cs.applyNodeChange(createNodeChange('update', 'item.template:x', { v: 1 }, { v: 2 }));
    cs.applyNodeChange(createNodeChange('update', 'item.template:x', { v: 2 }, { v: 3 }));
    const pending = cs.getPendingChanges();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.type).toBe('update');
    expect(pending[0]?.oldData).toEqual({ v: 1 });
    expect(pending[0]?.newData).toEqual({ v: 3 });
  });

  it('computeDiff: 按 type 分组输出', () => {
    const cs = new ChangeSet();
    cs.applyNodeChange(createNodeChange('add', 'item.template:a', undefined, { v: 1 }));
    cs.applyNodeChange(createNodeChange('update', 'item.template:b', { v: 0 }, { v: 1 }));
    cs.applyNodeChange(createNodeChange('remove', 'item.template:c', { v: 1 }, undefined));
    cs.markFileAffected('oblivions/gamedata/item_table.php');
    cs.markFileAffected('vex-vue/src/data/item-locale.ts');

    const diff = cs.computeDiff();
    expect(diff.addedNodes).toEqual(['item.template:a']);
    expect(diff.updatedNodes).toEqual(['item.template:b']);
    expect(diff.removedNodes).toEqual(['item.template:c']);
    expect(diff.affectedFiles).toContain('oblivions/gamedata/item_table.php');
    expect(diff.affectedFiles).toContain('vex-vue/src/data/item-locale.ts');
  });

  it('computeDiff: 排序保证输出稳定', () => {
    const cs = new ChangeSet();
    cs.applyNodeChange(createNodeChange('add', 'item.template:c', undefined, {}));
    cs.applyNodeChange(createNodeChange('add', 'item.template:a', undefined, {}));
    cs.applyNodeChange(createNodeChange('add', 'item.template:b', undefined, {}));
    const diff = cs.computeDiff();
    expect(diff.addedNodes).toEqual(['item.template:a', 'item.template:b', 'item.template:c']);
  });

  it('isEmpty: 无变更返回 true', async () => {
    const cs = new ChangeSet();
    await cs.captureBaseline([{ path: 'a.php', content: 'x', mtime: 0, size: 1 }]);
    expect(cs.isEmpty()).toBe(true);
  });

  it('isEmpty: 有变更返回 false', () => {
    const cs = new ChangeSet();
    cs.applyNodeChange(createNodeChange('add', 'item.template:x', undefined, {}));
    expect(cs.isEmpty()).toBe(false);
  });

  it('clear: 清空所有状态', async () => {
    const cs = new ChangeSet();
    await cs.captureBaseline([{ path: 'a.php', content: 'x', mtime: 0, size: 1 }]);
    cs.applyNodeChange(createNodeChange('add', 'item.template:x', undefined, {}));
    cs.markFileAffected('a.php');
    cs.clear();
    expect(cs.getBaseline('a.php')).toBeUndefined();
    expect(cs.getPendingChanges()).toHaveLength(0);
    expect(cs.isEmpty()).toBe(true);
  });

  it('serialize / deserialize round-trip', () => {
    const cs1 = new ChangeSet();
    cs1.applyNodeChange(createNodeChange('add', 'item.template:x', undefined, { v: 1 }));
    cs1.applyNodeChange(createNodeChange('update', 'item.template:y', { v: 0 }, { v: 1 }));
    cs1.markFileAffected('a.php');
    const s = cs1.serialize();

    const cs2 = new ChangeSet();
    expect(cs2.deserialize(s)).toBe(true);
    expect(cs2.getPendingChanges()).toHaveLength(2);
    expect(cs2.computeDiff().affectedFiles).toEqual(['a.php']);
  });

  it('serializeBaseline / deserializeBaseline round-trip', async () => {
    const cs1 = new ChangeSet();
    await cs1.captureBaseline([{ path: 'a.php', content: 'x', mtime: 100, size: 1 }]);
    const s = cs1.serializeBaseline();

    const cs2 = new ChangeSet();
    expect(cs2.deserializeBaseline(s)).toBe(true);
    const restored = cs2.getBaseline('a.php');
    expect(restored).toBeDefined();
    expect(restored?.mtime).toBe(100);
    expect(restored?.size).toBe(1);
  });

  it('deserialize: 非法输入返回 false', () => {
    const cs = new ChangeSet();
    expect(cs.deserialize('not json')).toBe(false);
    expect(cs.deserialize('{}')).toBe(false);
    expect(cs.deserialize('{"pendingChanges":"x","affectedFiles":[]}')).toBe(false);
  });
});
