/**
 * @module O 内容工具箱
 *
 * poi_interactions.php 逆向投影器——桩实现。
 *
 * 设计意图（执行案 06-P5 §4.3.2 注）：
 * - poi_interactions.php 在 P5 阶段"暂不编辑，原样保留"——无 kind，无正向投影器
 * - 逆向投影器返回 success=true 但不输出 YAML 资源——
 *   migration-flow 据此跳过 YAML 写入，仅做备份
 * - 与其他 11 个 PHP 逆向投影器保持统一接口，避免 migration-flow 特殊分支
 *
 * 边界：
 * - 文件不存在时仍返回 success=true（不阻断迁移流程）
 * - 文件存在但内容为空也返回 success=true
 */

import type { ReverseProjectOptions, ReverseProjectResult } from './types';

export function reverseProjectPoiInteractions(_options: ReverseProjectOptions): ReverseProjectResult {
  // 桩实现——不输出 YAML 资源，让 migration-flow 跳过 YAML 写入
  return {
    success: true,
    diagnostics: [
      {
        severity: 'info',
        code: 'reverse_projector.poi_interactions_preserved',
        message: 'poi_interactions.php 在 P5 阶段保留为 PHP 格式，不进入作者资源 YAML',
      },
    ],
  };
}
