/**
 * @module O 内容工具箱
 *
 * 事件池加权选择（移植自 poi.search.func.php:838-863）。
 *
 * 设计意图：
 * - E-10 POI 搜刮三档判定系统的事件档原语——按 weight 加权随机抽取一个 event_id
 * - 与 obl_weighted_pick 算法等价，但返回 event_id 字符串而非 entry 对象
 * - weight 全 0 时均匀随机（避免除零），与 obl_weighted_pick 兜底一致
 * - weight 缺失按 1.0 计，与 PHP isset 兜底一致
 *
 * 与 PHP 的差异：
 * - PRNG 通过依赖注入（rng: Rng），不调用 mt_rand / array_rand
 * - 不复现 PHP mt_rand 序列——P6 采用状态快照对比法
 *
 * @mirror-of oblivions/include/game/poi/poi.search.func.php:838-863 (obl_pick_event)
 */

import type { Rng } from '../../shared/algorithms/seed-random';
import { pickIndex } from './rng-helpers';
import type { PoiEventEntry } from './types';

/**
 * 从事件池按 weight 加权随机抽取一个 event_id。
 *
 * 算法：
 *   1. 累加所有 entry 的 weight（缺失按 1.0）
 *   2. 若 total_weight <= 0 → 均匀随机选一个（避免除零），返回该 entry 的 event_id
 *   3. 否则 r = rng.next() * total_weight，遍历累加 cum，r <= cum 时返回当前 entry 的 event_id
 *   4. 浮点累加误差兜底：返回最后一个 entry 的 event_id
 *
 * 关键不变量：
 *   - 空池或非数组返回空字符串 ''
 *   - event_id 缺失的 entry 返回 ''（防御性）
 *   - weight 全 0 时均匀随机
 *
 * @param rng        Rng 实例
 * @param eventPool  事件池（[['event_id', 'weight', 'kind'], ...]）
 * @returns 选中的 event_id；空池返回 ''
 */
export function oblPickEvent(
  rng: Rng,
  eventPool: readonly PoiEventEntry[],
): string {
  if (!Array.isArray(eventPool) || eventPool.length === 0) return '';

  let totalWeight = 0;
  for (const e of eventPool) {
    totalWeight += typeof e.weight === 'number' ? e.weight : 1.0;
  }

  // 全 0 权重：均匀随机选一个（避免除零）
  if (totalWeight <= 0) {
    const idx = pickIndex(rng, eventPool.length);
    const picked = eventPool[idx];
    const eid = picked?.event_id;
    return typeof eid === 'string' ? eid : '';
  }

  // 加权累加选择
  const r = rng.next() * totalWeight;
  let cum = 0;
  for (const e of eventPool) {
    const w = typeof e.weight === 'number' ? e.weight : 1.0;
    cum += w;
    if (r <= cum) {
      const eid = e.event_id;
      return typeof eid === 'string' ? eid : '';
    }
  }
  // 浮点累加误差兜底：返回最后一个 entry 的 event_id
  const last = eventPool[eventPool.length - 1];
  const eid = last?.event_id;
  return typeof eid === 'string' ? eid : '';
}
