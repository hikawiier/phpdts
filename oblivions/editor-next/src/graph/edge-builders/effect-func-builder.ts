/**
 * @module O 内容工具箱
 *
 * effect.func 虚拟节点构建器——从 item.use_effects.func.php 提取 use_effect 函数清单。
 *
 * 与 O-4 adapter 的区别：
 *   - adapter 解析数据文件（return [...] / export const XXX = {...}）为 ResourceNode
 *   - 本构建器扫描代码文件（function 定义）提取虚拟节点
 *
 * 提取规则（P2 §4.4.4）：
 *   - 正则匹配 `^function item_use_effect_(\w+)\(` 模式
 *   - 函数名 = 捕获组 1（如 restore_hp）
 *   - 节点 id = 函数名，kind = 'effect.func'
 *   - data = { name, signature }
 *
 * 预期清单：6 个（restore_hp / restore_sp / cure_bs / gain_resistance / open_gift_box / place_poi）
 * 见 KNOWN_USE_EFFECTS 常量与 item.use_effects.func.php:12-18 文件头注释。
 *
 * 边界：
 *   - 注释中的 `function item_use_effect_xxx` 不应被匹配——正则要求行首 `^function`，
 *     PHP 注释行首是 `//` / `#` / `*`，自然被排除
 *   - 同名函数重复定义（不应出现）按首次匹配为准
 *   - 提取结果为空时返回空数组，loader 层应 emit diagnostic
 */

import type { ResourceNode } from '../types';
import type { SourceAnchor } from '../edge';

/** effect.func 节点 data 形状 */
export interface EffectFuncData {
  /** 函数名（不含 item_use_effect_ 前缀） */
  name: string;
  /** 完整函数签名（如 item_use_effect_restore_hp($item, &$pdata)） */
  signature: string;
}

/**
 * 从 item.use_effects.func.php 内容提取 effect.func 节点
 *
 * @param filePath 文件路径（用于 sourceAnchor）
 * @param content 文件完整内容
 * @returns effect.func 节点数组；提取失败返回空数组
 */
export function buildEffectFuncNodes(
  filePath: string,
  content: string,
): ResourceNode<EffectFuncData>[] {
  const sourceAnchor: SourceAnchor = {
    filePath,
    lineStart: 0,
    lineEnd: 0,
    format: 'php',
  };

  const nodes: ResourceNode<EffectFuncData>[] = [];
  const seen = new Set<string>();

  // 按行扫描，记录行号便于 sourceAnchor
  const lines = content.split('\n');
  // 正则：行首（允许前导空白）function item_use_effect_{name}(
  // - 使用 \w+ 捕获函数名（字母数字下划线）
  // - 不匹配注释行（PHP 注释行首是 // / # / *，正则要求 function 关键字开头）
  const re = /^\s*function\s+(item_use_effect_(\w+))\s*\(/;

  for (let i = 0; i < lines.length; i++) {
    const match = re.exec(lines[i]!);
    if (!match) continue;

    const signature = match[1]!; // 完整函数名（如 item_use_effect_restore_hp）
    const name = match[2]!; // 短名（如 restore_hp）

    // 同名函数重复定义时按首次匹配为准
    if (seen.has(name)) continue;
    seen.add(name);

    nodes.push({
      kind: 'effect.func',
      id: name,
      data: {
        name,
        signature: `${signature}($item, &$pdata)`,
      },
      source: [{ ...sourceAnchor, lineStart: i + 1, lineEnd: i + 1 }],
      revision: '',
    });
  }

  return nodes;
}
