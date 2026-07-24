/**
 * @module K 状态管理层
 * @framework K-9 有序批处理消费者 + 间隙检测
 */

// 演出批次收件箱：缓存来自 command/heartbeat 响应的实时演出事件
// 按 batch_seq 顺序消费，支持 gap 检测与权威回退（F5 冷启动时的展示快进）
import type { CommandResult, OblHeartbeatResponse } from '@/api/client';
import type { PresentationBatchV1 } from '@/types/api';

// 校验是否为有效的 presentation.v1 batch 结构
function isPresentationBatch(value: unknown): value is PresentationBatchV1 {
  if (!value || typeof value !== 'object') return false;
  const batch = value as Partial<PresentationBatchV1>;
  return batch.schema === 'presentation.v1'
    && Number.isInteger(batch.batch_seq)
    && Number(batch.batch_seq) > 0
    && Array.isArray(batch.events);
}

// PresentationInbox 类：管理 batch 序列的存储和顺序消费
// cursor 表示已消费的 batch_seq；pending 缓存在等待消费的 batch
// gapHead 表示检测到跳号（需要快进到权威最新）
class PresentationInbox {
  private cursor: number | null = null;
  private observedHead = 0;
  private readonly pending = new Map<number, PresentationBatchV1>();

  // 初始化：设置起始 cursor（从权威快照的 headSeq 开始，跳过已代表的历史 batch）
  initialize(headSeq: number): void {
    if (this.cursor !== null) return;
    this.cursor = Math.max(0, Number(headSeq) || 0);
    this.observedHead = Math.max(this.observedHead, this.cursor);
    for (const seq of this.pending.keys()) {
      if (seq <= this.cursor) this.pending.delete(seq);
    }
  }

  enqueueResponse(response: CommandResult | OblHeartbeatResponse | null | undefined): boolean {
    if (!response) return false;
    const accepted = this.enqueue(response.presentation);
    this.observedHead = Math.max(this.observedHead, Number(response.presentation_head_seq) || 0);
    return accepted;
  }

  enqueue(value: unknown): boolean {
    if (!isPresentationBatch(value)) return false;
    const batch = value;
    if (this.cursor === null) this.cursor = batch.batch_seq - 1;
    if (batch.batch_seq <= this.cursor || this.pending.has(batch.batch_seq)) return false;
    const events = [...batch.events].sort((left, right) =>
      Number(left.event_seq ?? left.log_id) - Number(right.event_seq ?? right.log_id));
    this.pending.set(batch.batch_seq, { ...batch, events });
    return true;
  }

  peekNext(): PresentationBatchV1 | null {
    if (this.cursor === null) return null;
    return this.pending.get(this.cursor + 1) ?? null;
  }

  commit(batchSeq: number): void {
    if (this.cursor === null || batchSeq !== this.cursor + 1) {
      throw new Error(`presentation batch commit out of order: cursor=${this.cursor}, batch=${batchSeq}`);
    }
    this.pending.delete(batchSeq);
    this.cursor = batchSeq;
  }

  get gapHead(): number | null {
    if (this.cursor === null || this.pending.has(this.cursor + 1)) return null;
    return this.observedHead > this.cursor ? this.observedHead : null;
  }

  commitGap(headSeq: number): void {
    if (this.gapHead !== headSeq) throw new Error(`presentation gap changed before rebase: ${headSeq}`);
    this.cursor = headSeq;
    for (const seq of this.pending.keys()) {
      if (seq <= headSeq) this.pending.delete(seq);
    }
  }

  /**
   * 按 batch_seq 顺序消费所有可用 batch（F-K4-Director §四 K-9 协同）。
   *
   * 移动导演消费 map.navigate 返回的多次移动结果批次。
   * 仅在探索模式（非战斗演出期）使用——战斗演出由 K-7 presentation-scene
   * 通过 peekNext/commit 逐批消费，本方法不与之冲突。
   *
   * 返回按 batch_seq 升序排列的已消费 batch 列表；无可用 batch 时返回空数组。
   */
  drainOrderedBatches(): PresentationBatchV1[] {
    const batches: PresentationBatchV1[] = [];
    for (;;) {
      const batch = this.peekNext();
      if (!batch) break;
      batches.push(batch);
      this.commit(batch.batch_seq);
    }
    return batches;
  }

  reset(): void {
    this.cursor = null;
    this.observedHead = 0;
    this.pending.clear();
  }

  get currentCursor(): number | null {
    return this.cursor;
  }
}

export const presentationInbox = new PresentationInbox();

/**
 * 将命令/心跳响应中的演出批次入队（K-9 有序批处理消费者）。
 *
 * 不在此处调用 presentationScene.beginPlayback()：
 *   - 战斗演出由 battle.ts playScript() 直接调用 beginPlayback() 认领场景
 *   - 探索模式下调用 beginPlayback() 会将 presentationScene.phase 设为 'playing'，
 *     导致 syncAuthoritative 延迟应用实体快照（presentation-scene.ts syncAuthoritative
 *     在 phase !== 'idle' 时将快照存为 pending 而不立即应用），
 *     阻断移动导演的位置动画驱动链：
 *       applyStep → mapStore.updateMapData → stopAuthorityWatch → syncAuthoritative
 *       → (延迟) → stopEntitiesWatch 不触发 → playWorldMove 不调用 → 小人直接跳格
 *   - 探索模式下 presentationScene.phase 始终保持 'idle'，syncAuthoritative 立即应用
 */
export function ingestPresentationResponse(
  response: CommandResult | OblHeartbeatResponse | null | undefined,
): boolean {
  return presentationInbox.enqueueResponse(response);
}

/**
 * 按 batch_seq 顺序消费所有可用 batch（移动导演消费多次移动结果用，F-K4-Director §四 K-9）。
 *
 * 与 ingestPresentationResponse 配合：导航命令响应入队后，移动导演调用本方法
 * 按 batch_seq 顺序消费所有可用批次，获取其中的演出事件。
 */
export function drainOrderedBatches(): PresentationBatchV1[] {
  return presentationInbox.drainOrderedBatches();
}
