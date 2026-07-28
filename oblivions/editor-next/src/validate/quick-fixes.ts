/**
 * @module O 内容工具箱
 *
 * QuickFix 类型与注册表。P0 阶段仅声明类型与空注册表，不注册实际修复函数。
 *
 * 设计意图（执行案 §4.7.1）：
 *   - 每条 Issue 可携带 quickFix 字段，指向一个可执行修复函数
 *   - 修复函数接收 graph-store 与 changeSet，应用修复并返回 Promise
 *   - 注册表用 ID 索引，UI 通过 quickFix.id 查找对应修复
 *   - P1+ 阶段逐步注册实际修复（如"删除悬空引用"、"添加缺失 locale 条目"）
 *
 * 类型占位说明：
 *   - GraphStore 类型用 ReturnType<typeof useGraphStore>，避免引入泛型
 *   - ChangeSet 类型由 O-5（P0-E 任务）实现，P0 阶段用 unknown 占位 + TODO 注释
 *     P0-E 完成后改为 import type { ChangeSet } from '@/build/change-set'
 */

import type { useGraphStore } from '@/graph/graph-store';

/**
 * GraphStore 类型——从 useGraphStore 返回值推导，避免维护重复类型。
 */
export type GraphStore = ReturnType<typeof useGraphStore>;

/**
 * ChangeSet 类型——由 O-5（P0-E 任务）实现。
 *
 * P0 阶段用 unknown 占位；P0-E 完成后改为：
 *   import type { ChangeSet } from '@/build/change-set';
 *   export type { ChangeSet };
 */
// TODO(P0-E): 替换为真实 ChangeSet 类型
export type ChangeSet = unknown;

/**
 * 可执行修复——每条 Issue 可携带一个 quickFix。
 *
 * apply 接收 graph-store 与 changeSet，应用修复并返回 Promise。
 * 修复函数应保持纯函数性（不直接 mutation store，而是写入 changeSet
 * 由 O-5 提交器统一应用）。
 */
export interface QuickFix {
  /** 修复 ID（全局唯一，UI 通过此 ID 查找） */
  id: string;
  /** 修复标题（UI 按钮文案，i18n key） */
  title: string;
  /** 执行修复——接收 graph-store 与 changeSet */
  apply: (graph: GraphStore, changeSet: ChangeSet) => Promise<void>;
}

/**
 * QuickFix 注册表——ID 索引的 Map。
 *
 * P0 阶段为空注册表；P1+ 阶段逐步注册实际修复函数。
 *
 * 使用方式：
 *   import { quickFixRegistry } from '@/validate/quick-fixes';
 *   const fix = quickFixRegistry.get('delete_dangling_ref');
 *   if (fix) await fix.apply(graph, changeSet);
 */
export class QuickFixRegistry {
  private readonly fixes = new Map<string, QuickFix>();

  /** 注册一个修复。同 ID 覆盖。 */
  register(fix: QuickFix): void {
    this.fixes.set(fix.id, fix);
  }

  /** 按 ID 获取修复。未注册返回 undefined。 */
  get(id: string): QuickFix | undefined {
    return this.fixes.get(id);
  }

  /** 列出所有已注册修复（按 ID 字典序）。 */
  list(): QuickFix[] {
    return Array.from(this.fixes.values()).sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    );
  }

  /** 是否注册了任意修复。 */
  hasFixes(): boolean {
    return this.fixes.size > 0;
  }

  /** 清空注册表（仅供测试使用）。 */
  clear(): void {
    this.fixes.clear();
  }
}

/**
 * 全局 QuickFix 注册表单例。
 *
 * P0 阶段为空；P1+ 阶段由各 kind 的修复模块在 main.ts 调用 register。
 */
export const quickFixRegistry = new QuickFixRegistry();
