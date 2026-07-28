/**
 * @module O 内容工具箱
 * @framework O-5 Change Set
 *
 * 变更集——累积工作区编辑动作并生成 diff 的核心数据结构。
 *
 * 设计意图：
 * - 工作区加载完成后捕获基线 FileRevision（mtime + size + contentHash 三元组），
 *   后续编辑动作累积为 NodeChange，computeDiff() 派生 added/updated/removed 节点清单。
 * - 同一 nodeId 的连续编辑通过 mergeNodeChange 合并，避免发布时产生冗余 diff。
 * - 基线失效检测（isBaselineStale）用于外部修改冲突诊断——任一三元组字段不一致即视为失效。
 * - P0 阶段仅实现数据结构 + 基线捕获 + diff 生成；原子发布（临时目录、备份、原子替换）在 P5 实现。
 * - P3 §4.7.3 batchAdd/batchUpdate/batchRemove 支持单次跨 kind 批量操作：典型场景
 *   「新增 POI」需同时 add poi.template + add presentation.poi + 可选 add loot.table
 *   + 可选 add distribution.poi，调用方一次 batchAdd 提交所有节点，避免多次调用
 *   applyNodeChange 时遗漏中间状态。原子性由 JS 单线程同步循环天然保证——
 *   同步方法调用对外不可中断，batch 内所有 entry 在控制权返回前已合并入 pendingChanges。
 * - P5-3 §4.6 compileAndPublish 接入八步编译管道——浏览器端通过依赖注入 compileFn
 *   调用 content-compiler.compile（经 Gateway 路由）；编译成功后清空变更集并保留 baseline。
 *
 * 持久化约定（localStorage）：
 * - `workspace:baseline` → serializeBaseline() 输出，跨会话恢复基线
 * - `workspace:change-set` → serialize() 输出，跨会话恢复未提交变更
 * - 仅持久化元数据（pendingChanges + affectedFiles + baseline），不含完整图
 *
 * 集成点（待后续任务接入，P0-E 仅留 TODO）：
 *
 * TODO(P0-H): main.ts 中初始化 ChangeSet 单例并挂载到全局（如 app.provide 或 window.__phpdtsDebug）。
 *   建议入口：
 *     const changeSet = new ChangeSet();
 *     app.provide('changeSet', changeSet);
 *   并在 SSE file:changed 事件触发时调用 isBaselineStale() 检测冲突。
 *
 * TODO(P0-D): loader.ts 在 loadWorkspace() 完成后调用 captureBaseline()：
 *     await changeSet.captureBaseline(files);
 *   其中 files 来自 Gateway /api/read 与 /api/read-dir 的批量响应。
 *   加载完成后还可调用 restoreFromLocalStorage() 恢复上次会话的未提交变更。
 *
 * TODO(P0-G): validateStore 在 runFull() 时查询 computeDiff() 判断是否阻断：
 *     const diff = changeSet.computeDiff();
 *     if (diff.addedNodes.length + diff.updatedNodes.length + diff.removedNodes.length === 0) {
 *       return; // 无变更，跳过完整校验
 *     }
 *   affectedFiles 用于校验报告展示受影响文件清单。
 */

import type { FileRevision } from './file-revision';
import {
  computeFileRevision,
  isRevisionEqual,
  serializeRevision,
  deserializeRevision,
} from './file-revision';
import type { NodeChange, NodeChangeMergeResult } from './node-change';
import { createNodeChange, mergeNodeChange, NODE_CHANGE_CANCELED } from './node-change';
// `import type` 在编译时被擦除，不会引入 atomic-publisher.ts 的 Node.js fs 依赖。
// change-set.ts 仍是浏览器安全模块；publish() 通过依赖注入调用实际的发布函数。
import type {
  PublishResult,
  PublishableFile,
  BaselineEntry,
} from './atomic-publisher';
// P5-3：compileAndPublish 通过依赖注入 compileFn 调用 content-compiler.compile。
// P6-4：透传 mirrorFn / skipMirror 选项给 compileFn。
// `import type` 编译时擦除，不引入 Node.js fs 依赖；change-set 仍是浏览器安全模块。
import type {
  CompileOptions,
  CompileResult,
  ResourceGraph,
  BaselineRevision,
  MirrorFn,
} from './content-compiler';

/** localStorage 键名约定 */
export const BASELINE_LS_KEY = 'workspace:baseline';
export const CHANGE_SET_LS_KEY = 'workspace:change-set';

/** 基线捕获输入——单个文件的路径、内容与元数据 */
export interface BaselineFileInput {
  path: string;
  content: string;
  mtime: number;
  size: number;
}

/** computeDiff 输出——O-10 校验与 O-6 构建工作区展示共用 */
export interface ChangeSetDiff {
  addedNodes: string[];
  updatedNodes: string[];
  removedNodes: string[];
  affectedFiles: string[];
}

/**
 * 批量 add 入参——nodeId 已含 kind 前缀（如 `poi.template:supply_cache`），
 * 因此 batchAdd 可在一次调用中跨 kind 提交（执行案 §4.7.3）。
 */
export interface BatchAddEntry {
  nodeId: string;
  newData: unknown;
}

/**
 * 批量 update 入参——oldData 可选（用于回滚诊断与 update+remove 合并追溯）。
 */
export interface BatchUpdateEntry {
  nodeId: string;
  oldData?: unknown;
  newData: unknown;
}

/** 序列化后的 ChangeSet 元数据结构（持久化用） */
interface SerializedChangeSet {
  pendingChanges: NodeChange[];
  affectedFiles: string[];
}

/** 序列化后的基线结构（持久化用） */
interface SerializedBaseline {
  entries: Array<{ path: string; revision: string }>;
}

/**
 * ChangeSet——变更集核心类。
 *
 * 使用方式：
 *   const cs = new ChangeSet();
 *   await cs.captureBaseline(files);
 *   cs.applyNodeChange(createNodeChange('add', 'item.template:compass', undefined, data));
 *   cs.markFileAffected('oblivions/gamedata/item_table.php');
 *   const diff = cs.computeDiff();
 */
export class ChangeSet {
  private baseline: Map<string, FileRevision> = new Map();
  private pendingChanges: Map<string, NodeChange> = new Map();
  private affectedFiles: Set<string> = new Set();

  /**
   * 捕获基线——批量写入文件 revision。
   *
   * 重复调用会覆盖既有基线（用于工作区重载场景）。
   * 捕获完成后可调用 persistBaseline() 写入 localStorage。
   */
  async captureBaseline(files: BaselineFileInput[]): Promise<void> {
    for (const file of files) {
      const revision = await computeFileRevision(file.content, {
        mtime: file.mtime,
        size: file.size,
      });
      this.baseline.set(file.path, revision);
    }
  }

  /**
   * 应用节点变更——合并到 pendingChanges。
   *
   * 同一 nodeId 的连续变更通过 mergeNodeChange 合并；
   * 若合并结果为 NODE_CHANGE_CANCELED（add + remove 相消），从 pendingChanges 移除该条目。
   *
   * 注意：本方法不更新 affectedFiles——节点变更与文件影响是多对多关系，
   * 调用方应同时调用 markFileAffected() 标记受影响文件。
   */
  applyNodeChange(change: NodeChange): void {
    const existing = this.pendingChanges.get(change.nodeId);
    if (!existing) {
      this.pendingChanges.set(change.nodeId, change);
      return;
    }
    const merged: NodeChangeMergeResult = mergeNodeChange(existing, change);
    if (merged === NODE_CHANGE_CANCELED) {
      this.pendingChanges.delete(change.nodeId);
      return;
    }
    this.pendingChanges.set(change.nodeId, merged);
  }

  /**
   * 标记文件为受影响——供调用方在 applyNodeChange 后显式登记。
   *
   * 节点→文件的映射由调用方（loader / validate）维护，ChangeSet 不内置 resolver。
   */
  markFileAffected(filePath: string): void {
    this.affectedFiles.add(filePath);
  }

  /**
   * 批量标记文件为受影响——batchAdd / batchUpdate / batchRemove 的配套辅助。
   *
   * 跨 kind 编辑场景下，一次 batchAdd 通常影响多个文件（poi_table.php +
   * poi-locale.ts + loot_tables.php + poi_pool.php），调用方传入完整文件清单
   * 一次标记，避免多次 markFileAffected 调用遗漏。
   */
  markFilesAffected(filePaths: string[]): void {
    for (const p of filePaths) {
      this.affectedFiles.add(p);
    }
  }

  /**
   * 批量 add——单次调用可跨 kind，原子提交（执行案 §4.7.3）。
   *
   * 典型场景「新增 POI」：
   *   cs.batchAdd([
   *     { nodeId: 'poi.template:supply_cache', newData: poiTemplateData },
   *     { nodeId: 'presentation.poi:supply_cache', newData: localeData },
   *     { nodeId: 'loot.table:cache_loot', newData: lootTableData },         // 可选
   *     { nodeId: 'distribution.poi:shallow:supply_cache', newData: ruleData }, // 可选
   *   ]);
   *   cs.markFilesAffected([
   *     'oblivions/gamedata/poi_table.php',
   *     'vex-vue/src/data/poi-locale.ts',
   *     'oblivions/gamedata/loot_tables.php',
   *     'oblivions/gamedata/poi_pool.php',
   *   ]);
   *
   * 原子性：JS 单线程同步循环对外不可中断——所有 entry 在控制权返回前已合并入
   * pendingChanges。同一 nodeId 在 batch 内出现多次时按 mergeNodeChange 规则合并。
   *
   * 不更新 affectedFiles——节点→文件映射由调用方维护，需配套调用 markFilesAffected。
   */
  batchAdd(entries: BatchAddEntry[]): void {
    for (const entry of entries) {
      const change = createNodeChange('add', entry.nodeId, undefined, entry.newData);
      this.applyNodeChange(change);
    }
  }

  /**
   * 批量 update——同 batchAdd 但 type='update'（执行案 §4.7.3）。
   *
   * 典型场景「修改 POI 中文名」：
   *   cs.batchUpdate([
   *     { nodeId: 'poi.template:supply_cache', oldData: oldTpl, newData: newTpl },
   *     { nodeId: 'presentation.poi:supply_cache', oldData: oldLocale, newData: newLocale },
   *   ]);
   *
   * oldData 可选——主要供回滚诊断与 update+remove 合并追溯使用；缺失时合并
   * 结果的 oldData 字段为 undefined，不影响主流程。
   */
  batchUpdate(entries: BatchUpdateEntry[]): void {
    for (const entry of entries) {
      const change = createNodeChange('update', entry.nodeId, entry.oldData, entry.newData);
      this.applyNodeChange(change);
    }
  }

  /**
   * 批量 remove——按 nodeId 数组移除节点（执行案 §4.7.3）。
   *
   * 典型场景「删除 POI」：
   *   cs.batchRemove([
   *     'poi.template:supply_cache',
   *     'presentation.poi:supply_cache',
   *     'distribution.poi:shallow:supply_cache',
   *   ]);
   *
   * 注意：本方法不接收 oldData。需要 oldData 用于回滚诊断时，调用方应直接
   * 使用 applyNodeChange(createNodeChange('remove', nodeId, oldData, undefined))。
   * batchRemove 适用于「按 ID 批量清理」的简单场景，oldData 缺失时合并结果
   * 的 oldData 字段为 undefined，不影响主流程。
   */
  batchRemove(nodeIds: string[]): void {
    for (const nodeId of nodeIds) {
      const change = createNodeChange('remove', nodeId, undefined, undefined);
      this.applyNodeChange(change);
    }
  }

  /**
   * 计算 diff——按 type 分组输出 pendingChanges 中的节点 ID。
   *
   * affectedFiles 来自显式 markFileAffected() 调用，按字母序输出便于展示稳定。
   */
  computeDiff(): ChangeSetDiff {
    const addedNodes: string[] = [];
    const updatedNodes: string[] = [];
    const removedNodes: string[] = [];

    for (const [nodeId, change] of this.pendingChanges) {
      switch (change.type) {
        case 'add':
          addedNodes.push(nodeId);
          break;
        case 'update':
          updatedNodes.push(nodeId);
          break;
        case 'remove':
          removedNodes.push(nodeId);
          break;
      }
    }

    // 排序保证输出稳定，便于 O-6 展示与 O-10 比对
    addedNodes.sort();
    updatedNodes.sort();
    removedNodes.sort();

    return {
      addedNodes,
      updatedNodes,
      removedNodes,
      affectedFiles: Array.from(this.affectedFiles).sort(),
    };
  }

  /**
   * 清空所有状态——基线、待提交变更、受影响文件。
   *
   * 工作区重载或切换时调用。
   */
  clear(): void {
    this.baseline.clear();
    this.pendingChanges.clear();
    this.affectedFiles.clear();
  }

  /**
   * 是否为空——无待提交变更且无受影响文件。
   *
   * 注意：基线不为空不算「非空」，因为基线是加载后的常态。
   */
  isEmpty(): boolean {
    return this.pendingChanges.size === 0 && this.affectedFiles.size === 0;
  }

  /** 获取所有待提交变更（按 nodeId 排序，便于展示）。 */
  getPendingChanges(): NodeChange[] {
    return Array.from(this.pendingChanges.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([, change]) => change);
  }

  /** 获取指定路径的基线 revision。 */
  getBaseline(path: string): FileRevision | undefined {
    return this.baseline.get(path);
  }

  /**
   * 检测基线是否失效——给定当前 revision，与基线比对。
   *
   * 三元组任一字段不一致即视为失效（外部修改触发）。
   * 无基线记录时返回 true（视为失效，调用方应触发重新捕获）。
   */
  isBaselineStale(path: string, currentRevision: FileRevision): boolean {
    const baseline = this.baseline.get(path);
    if (!baseline) return true;
    return !isRevisionEqual(baseline, currentRevision);
  }

  /**
   * 序列化 ChangeSet 元数据（pendingChanges + affectedFiles）为 JSON 字符串。
   *
   * 用于 localStorage `workspace:change-set` 键持久化。
   * 不含基线（基线用 serializeBaseline() 单独持久化）。
   */
  serialize(): string {
    const payload: SerializedChangeSet = {
      pendingChanges: Array.from(this.pendingChanges.values()),
      affectedFiles: Array.from(this.affectedFiles),
    };
    return JSON.stringify(payload);
  }

  /**
   * 反序列化——与 serialize() 对偶。
   *
   * 非法输入静默忽略，返回 false；成功返回 true。
   * 不清空既有状态，调用方应在反序列化前调用 clear() 或在新实例上调用。
   */
  deserialize(s: string): boolean {
    try {
      const payload = JSON.parse(s) as SerializedChangeSet;
      if (!payload || typeof payload !== 'object') return false;
      if (!Array.isArray(payload.pendingChanges) || !Array.isArray(payload.affectedFiles)) {
        return false;
      }
      for (const change of payload.pendingChanges) {
        if (typeof change?.nodeId === 'string' && typeof change?.type === 'string') {
          this.pendingChanges.set(change.nodeId, change);
        }
      }
      for (const filePath of payload.affectedFiles) {
        if (typeof filePath === 'string') {
          this.affectedFiles.add(filePath);
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 序列化基线为 JSON 字符串——用于 localStorage `workspace:baseline` 键。
   *
   * 格式：{ entries: [{ path, revision: "mtime|size|contentHash" }] }
   */
  serializeBaseline(): string {
    const entries: Array<{ path: string; revision: string }> = [];
    for (const [path, revision] of this.baseline) {
      entries.push({ path, revision: serializeRevision(revision) });
    }
    const payload: SerializedBaseline = { entries };
    return JSON.stringify(payload);
  }

  /**
   * 反序列化基线——与 serializeBaseline() 对偶。
   *
   * 非法 revision 字符串静默跳过；返回 false 表示输入完全无效。
   */
  deserializeBaseline(s: string): boolean {
    try {
      const payload = JSON.parse(s) as SerializedBaseline;
      if (!payload || typeof payload !== 'object' || !Array.isArray(payload.entries)) {
        return false;
      }
      for (const entry of payload.entries) {
        if (typeof entry?.path !== 'string') continue;
        const revision = deserializeRevision(entry.revision);
        if (revision) {
          this.baseline.set(entry.path, revision);
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 持久化到 localStorage——同时写入 baseline 与 change-set 两个键。
   *
   * SSR / 测试环境无 localStorage 时静默忽略。
   */
  persistToLocalStorage(): void {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    if (!ls) return;
    try {
      ls.setItem(BASELINE_LS_KEY, this.serializeBaseline());
      ls.setItem(CHANGE_SET_LS_KEY, this.serialize());
    } catch {
      // localStorage 配额不足或被禁用，静默忽略
    }
  }

  /**
   * 从 localStorage 恢复——同时读取 baseline 与 change-set。
   *
   * 返回是否成功恢复任意一项。SSR / 测试环境无 localStorage 时返回 false。
   */
  restoreFromLocalStorage(): boolean {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    if (!ls) return false;
    let restored = false;
    try {
      const baselineStr = ls.getItem(BASELINE_LS_KEY);
      if (baselineStr && this.deserializeBaseline(baselineStr)) {
        restored = true;
      }
    } catch {
      // 忽略读取错误
    }
    try {
      const csStr = ls.getItem(CHANGE_SET_LS_KEY);
      if (csStr && this.deserialize(csStr)) {
        restored = true;
      }
    } catch {
      // 忽略读取错误
    }
    return restored;
  }

  /**
   * 发布当前 Change Set——把已序列化的文件原子写入目标文件系统。
   *
   * 设计意图：
   * - ChangeSet 是领域逻辑层，不直接依赖 atomic-publisher（Node.js-only）或 gateway-client（HTTP）。
   *   调用方（如 BuildView 或 publish-service）通过 publishFn 参数注入实际发布函数：
   *     - 浏览器端：注入 `gatewayClient.publishFiles`
   *     - 测试端：注入 mock 函数
   * - 调用方负责先从 graph-store 读取节点 → 调用 serializeNodes 序列化为 PublishableFile[]
   *   → 传入本方法。ChangeSet 只负责：构造 baseline entries → 调用 publishFn → 成功后清空。
   * - 仅把 files 中出现的路径的 baseline 传给 publishFn（避免传整个 baseline Map）。
   * - 发布成功后清空 pendingChanges 与 affectedFiles，但保留 baseline（后续编辑仍需基线）。
   * - 发布失败（success=false）或检测到冲突（conflicts.length > 0）时不清空 Change Set，
   *   用户可选择放弃或重试。
   *
   * @param files 已序列化的待发布文件
   * @param publishFn 实际发布函数（依赖注入）
   * @returns PublishResult——成功 / 失败 / 冲突均通过此结构返回
   */
  async publish(
    files: PublishableFile[],
    publishFn: (
      files: PublishableFile[],
      baseline: BaselineEntry[],
    ) => Promise<PublishResult>,
  ): Promise<PublishResult> {
    // 构造 baseline entries——仅包含 files 中存在的路径
    const baseline: BaselineEntry[] = [];
    for (const file of files) {
      const revision = this.baseline.get(file.filePath);
      if (revision) {
        baseline.push({ filePath: file.filePath, revision });
      }
    }

    const result = await publishFn(files, baseline);

    // 发布成功后清空变更集（保留 baseline）
    if (result.success) {
      this.pendingChanges.clear();
      this.affectedFiles.clear();
    }

    return result;
  }

  /**
   * 编译并发布——P5-3 八步编译管道 + P6 第 9 步镜像校验入口（执行案 §4.6）。
   *
   * 设计意图：
   * - 与 publish() 类似的依赖注入模式——浏览器端通过 compileFn 注入
   *   gatewayClient.compile（实际调用 server 端 content-compiler.compile）。
   * - 调用方负责从 graph-store 提取节点构造 ResourceGraph 传入。
   * - ChangeSet 负责构造 BaselineRevision（从 baseline Map 转换）+ CompileOptions，
   *   调用 compileFn → 编译成功后清空 pendingChanges 与 affectedFiles，保留 baseline。
   * - 编译失败（success=false）时不清空变更集，用户可选择放弃或重试。
   *
   * 与 publish() 区别：
   * - publish() 接收已序列化的 PublishableFile[]——序列化在调用方完成
   * - compileAndPublish() 接收 ResourceGraph——序列化由 content-compiler 在管道中完成
   *   （九步管道步骤 2「内存编辑」负责投影生成）
   * - compileAndPublish() 走完整九步管道（基线捕获 → 投影 → diff → 校验 →
   *   临时目录 → lint → 冲突检查 → 原子替换 → 镜像校验），publish() 只走原子替换一步
   *
   * P6-4 扩展：
   * - 透传 mirrorFn / skipMirror 选项给 compileFn（content-compiler 第 9 步）
   * - 调用方通过 result.mirrorResults 获取镜像校验详情
   * - 镜像校验失败（success=false + mirrorRolledBack=true）时不清空变更集
   *
   * @param graph 内存中的 Resource Graph（nodes 数组）
   * @param workspaceRoot 工作区根路径
   * @param compileFn 编译函数（依赖注入，浏览器端走 Gateway）
   * @param options 编译选项（skipValidation / skipLint / skipMirror / mirrorFn）
   * @returns CompileResult——成功 / 失败均通过此结构返回，含 mirrorResults
   */
  async compileAndPublish(
    graph: ResourceGraph,
    workspaceRoot: string,
    compileFn: (options: CompileOptions) => Promise<CompileResult>,
    options?: { skipValidation?: boolean; skipLint?: boolean; skipMirror?: boolean; mirrorFn?: MirrorFn },
  ): Promise<CompileResult> {
    // 构造 BaselineRevision——把 ChangeSet 的 baseline Map 转换为 content-compiler 期望的形态
    const baseline: BaselineRevision = {
      files: new Map(this.baseline),
    };

    const compileOptions: CompileOptions = {
      baseline,
      graph,
      workspaceRoot,
      skipValidation: options?.skipValidation,
      skipLint: options?.skipLint,
      skipMirror: options?.skipMirror,
      mirrorFn: options?.mirrorFn,
    };

    const result = await compileFn(compileOptions);

    // 编译成功后清空变更集（保留 baseline——后续编辑仍需基线）
    // 注意：镜像校验失败（success=false + mirrorRolledBack=true）时不清空，
    // 因为编译产物已回滚到上一版，用户的变更仍未发布。
    if (result.success) {
      this.pendingChanges.clear();
      this.affectedFiles.clear();
    }

    return result;
  }
}
