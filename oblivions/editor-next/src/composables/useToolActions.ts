// @module O 内容工具箱
//
// useToolActions：工具操作入口（对齐 NEW_DESIGN.md §3.1 + §2.4.4 + P1 执行案 §4.8.2）
//
// 研判：
//   - 工具行为是 O-0 框架的核心交互
//   - 与 historyStore 配合：每个可撤销操作封装为 GraphCommand（基于 world 子图快照）
//   - 与 projectStore 配合：实际数据 mutation 通过 projectStore actions 完成
//   - 与 toolStore 配合：读取当前工具状态、画笔预设、breakFirst / batchSelection
//   - 边界处理：拖拽移动通过响应式 :class 驱动（对齐 2.13），禁止命令式 DOM
//
// P1-F 重构（对齐 §4.8.2）：
//   - 旧式 createCommand(description, doFn, undoFn) + history.push(cmd) 全部改为
//     history.executeGraph(description, () => mutation())
//   - undoFn 不再需要：historyStore 内部通过 projectStore.graphSnapshot() 记录
//     before/after，undo/redo 时通过 replaceGraphSnapshot 还原 world 子图
//   - 工具行为本身（clickTileSelect / startDragTile / 等）不改
//   - 不进 history 的操作（仅修改 selectedPls / batchSelection / breakFirst）保持原样
//
// 工具行为清单（§3.1.4）：
//   select       拖拽移动格 + 点击选中
//   draw         应用画笔预设新建格
//   erase        删除格
//   paint        批量刷画笔预设到已有格
//   break        两步点击，断开 A↔B 连通
//   restore      两步点击，恢复 A↔B 连通
//   batch-select 框选 + 批量修改/删除/复制

import { computed, ref } from 'vue';
import { useToolStore, useHistoryStore, useProjectStore } from '@/stores';
import { type AnyCommand } from '@/stores/historyStore';
import type { BrushPreset, ToolId } from '@/stores/toolStore';
import type { Pgroup, Pls, Tile, Floor, Tide } from '@/shared';

export interface BatchPatch {
  floor?: Floor;
  tide?: Tide;
  passable?: boolean;
  height?: number;
  destructible?: boolean;
  preset_safe?: boolean;
}

/**
 * 拖拽中状态（响应式，由 GridCell 通过 :class 读取视觉态，对齐 2.13）
 */
export interface DragState {
  readonly pls: Pls;
  readonly originX: number;
  readonly originY: number;
  /** 当前 hover 的目标坐标（null 表示无 hover） */
  hoverX: number | null;
  hoverY: number | null;
  /** 是否真正移动了（防误触阈值） */
  moved: boolean;
}

export function useToolActions() {
  const tool = useToolStore();
  const history = useHistoryStore();
  const project = useProjectStore();

  // ─── 拖拽状态（响应式 :class 驱动，对齐 2.13） ─────────
  const drag = ref<DragState | null>(null);

  // ─── 工具与画笔代理 ───────────────────────────────────
  const currentTool = computed<ToolId>(() => tool.current);
  const brush = computed<BrushPreset>(() => tool.brush);

  function setTool(id: ToolId): void {
    tool.setTool(id);
  }

  function updateBrush(patch: Partial<BrushPreset>): void {
    tool.updateBrush(patch);
  }

  function resetBrush(): void {
    tool.resetBrush();
  }

  // ─── 当前 pgroup 取值（用于 actions 内部读取） ────────
  function ensurePgroup(): Pgroup | null {
    return project.currentPgroup;
  }

  // ═════════════════════════════════════════════════════
  // select 工具：点击选中 + 拖拽移动
  // ═════════════════════════════════════════════════════

  /**
   * 点击已有格：选中该格（select 工具下）
   */
  function clickTileSelect(pls: Pls): void {
    if (tool.current !== 'select') return;
    if (drag.value !== null && drag.value.moved) return; // 拖拽中不触发点击
    project.setSelectedPls(pls);
  }

  /**
   * 拖拽开始（select 工具下，左键按下）
   *
   * 不操作 DOM，只更新响应式 drag 状态，GridCell 通过 :class 渲染拖拽态
   */
  function startDragTile(pls: Pls): void {
    if (tool.current !== 'select') return;
    const pgroup = ensurePgroup();
    if (pgroup === null) return;
    const tile = project.currentTiles[pls];
    if (!tile) return;
    drag.value = {
      pls,
      originX: tile.x,
      originY: tile.y,
      hoverX: null,
      hoverY: null,
      moved: false,
    };
  }

  /**
   * 拖拽移动中：更新 hover 坐标（不修改数据，仅驱动 :class 视觉态）
   */
  function updateDragHover(x: number | null, y: number | null): void {
    if (drag.value === null) return;
    drag.value = { ...drag.value, hoverX: x, hoverY: y, moved: true };
  }

  /**
   * 拖拽结束：若目标坐标有效且未被占用，则调用 moveTile 并封装为 Command
   *
   * @returns true 表示已消费拖拽（无论是否实际移动）
   */
  function endDragTile(targetX: number | null, targetY: number | null): boolean {
    if (drag.value === null) return false;
    const state = drag.value;
    drag.value = null;
    if (!state.moved || targetX === null || targetY === null) return true;
    if (state.originX === targetX && state.originY === targetY) return true;

    const pgroup = ensurePgroup();
    if (pgroup === null) return true;
    const tiles = project.currentTiles;
    const tile = tiles[state.pls];
    if (!tile) return true;

    // 目标坐标已被其他格占用 → 失败
    const existing = project.findTileByCoord(pgroup, targetX, targetY);
    if (existing !== null && existing !== state.pls) return true;

    // GraphCommand：historyStore 内部自动记录 before/after 快照
    // undo/redo 通过 replaceGraphSnapshot 还原 world 子图（含 _breaks / neighbors / adjacent_to 边）
    history.executeGraph('history.tile.move', () => {
      project.moveTile(pgroup, state.pls, targetX, targetY);
    });
    return true;
  }

  function cancelDrag(): void {
    drag.value = null;
  }

  // ═════════════════════════════════════════════════════
  // draw 工具：在空白格点击新建格（应用画笔预设）
  // ═════════════════════════════════════════════════════

  /**
   * 在空白格点击：用画笔预设创建新格
   *
   * @returns 新 pls（失败返回 null）
   */
  function clickEmptyDraw(x: number, y: number): Pls | null {
    if (tool.current !== 'draw') return null;
    const pgroup = ensurePgroup();
    if (pgroup === null) return null;
    const preset = tool.brush;
    // 用 createGraphCommand + 条件 push：addTile 失败时不入栈（避免空 Command 污染历史）
    let newPls: Pls | null = null;
    const cmd = history.createGraphCommand('history.tile.add', () => {
      newPls = project.addTile(pgroup, x, y, preset);
    });
    if (newPls === null) return null;
    history.push(cmd);
    project.setSelectedPls(newPls);
    return newPls;
  }

  // ═════════════════════════════════════════════════════
  // erase 工具：删除格
  // ═════════════════════════════════════════════════════

  /**
   * 点击已有格：删除该格（erase 工具下）
   */
  function clickTileErase(pls: Pls): void {
    if (tool.current !== 'erase') return;
    const pgroup = ensurePgroup();
    if (pgroup === null) return;
    const tile = project.currentTiles[pls];
    if (!tile) return;

    history.executeGraph('history.tile.delete', () => {
      project.deleteTile(pgroup, pls);
    });
  }

  // ═════════════════════════════════════════════════════
  // paint 工具：油漆桶批量刷画笔预设到已有格
  // ═════════════════════════════════════════════════════

  /**
   * 点击已有格：用画笔预设覆盖 floor / tide / passable / height / destructible / preset_safe
   *
   * 注意：paint 工具只覆盖画笔控制的字段，保留 name / desc / x / y / neighbors / _breaks
   */
  function clickTilePaint(pls: Pls): void {
    if (tool.current !== 'paint') return;
    const pgroup = ensurePgroup();
    if (pgroup === null) return;
    const tile = project.currentTiles[pls];
    if (!tile) return;
    const preset = tool.brush;

    const patch: Partial<Tile> = {
      floor: preset.floor,
      tide: preset.tide,
      passable: preset.passable,
      height: preset.height,
      destructible: preset.destructible,
      preset_safe: preset.preset_safe,
    };
    history.executeGraph('history.tile.paint', () => {
      project.updateTile(pgroup, pls, patch);
    });
  }

  // ═════════════════════════════════════════════════════
  // break / restore 工具：两步点击
  // ═════════════════════════════════════════════════════

  /**
   * break 工具：两步点击
   *
   * 第一次点击：记录 breakFirst
   * 第二次点击：断开 breakFirst 与当前格的双向连接，封装为 Command
   */
  function clickTileBreak(pls: Pls): void {
    if (tool.current !== 'break') return;
    const pgroup = ensurePgroup();
    if (pgroup === null) return;

    if (tool.breakFirst === null) {
      tool.setBreakFirst(pls);
      return;
    }
    const first = tool.breakFirst;
    if (first === pls) {
      // 再次点击同一格：取消
      tool.setBreakFirst(null);
      return;
    }
    tool.setBreakFirst(null);

    history.executeGraph('history.connect.break', () => {
      project.breakTileConnection(pgroup, first, pls);
    });
  }

  /**
   * restore 工具：两步点击
   */
  function clickTileRestore(pls: Pls): void {
    if (tool.current !== 'restore') return;
    const pgroup = ensurePgroup();
    if (pgroup === null) return;

    if (tool.breakFirst === null) {
      tool.setBreakFirst(pls);
      return;
    }
    const first = tool.breakFirst;
    if (first === pls) {
      tool.setBreakFirst(null);
      return;
    }
    tool.setBreakFirst(null);

    history.executeGraph('history.connect.restore', () => {
      project.restoreTileConnection(pgroup, first, pls);
    });
  }

  // ═════════════════════════════════════════════════════
  // batch-select 工具：框选 + 批量修改/删除/复制
  // ═════════════════════════════════════════════════════

  /**
   * 点击格：toggle 加入/移出批量选择
   */
  function clickTileBatchToggle(pls: Pls): void {
    if (tool.current !== 'batch-select') return;
    tool.toggleBatchSelection(pls);
  }

  /**
   * 设置批量选择（替换）
   */
  function setBatchSelection(plsList: Pls[]): void {
    tool.setBatchSelection(plsList);
  }

  /**
   * 框选：将 (x1,y1)-(x2,y2) 矩形内所有格加入批量选择
   */
  function selectRect(x1: number, y1: number, x2: number, y2: number): void {
    const pgroup = ensurePgroup();
    if (pgroup === null) return;
    const tiles = project.currentTiles;
    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    const minY = Math.min(y1, y2);
    const maxY = Math.max(y1, y2);
    const selected: Pls[] = [];
    for (const plsKey of Object.keys(tiles)) {
      const pls = Number(plsKey) as Pls;
      const t = tiles[pls];
      if (!t) continue;
      if (t.x >= minX && t.x <= maxX && t.y >= minY && t.y <= maxY) {
        selected.push(pls);
      }
    }
    setBatchSelection(selected);
  }

  /**
   * 批量修改：将 patch 应用到 batchSelection 中所有格
   *
   * 封装为单个 Command（一次撤销还原所有格）
   */
  function batchApplyPatch(patch: BatchPatch): void {
    const pgroup = ensurePgroup();
    if (pgroup === null) return;
    const selection = [...tool.batchSelection];
    if (selection.length === 0) return;

    history.executeGraph('history.tile.batchPatch', () => {
      for (const pls of selection) {
        project.updateTile(pgroup, pls, patch);
      }
    });
  }

  /**
   * 批量删除：删除 batchSelection 中所有格
   *
   * 封装为单个 Command
   */
  function batchDelete(): void {
    const pgroup = ensurePgroup();
    if (pgroup === null) return;
    const selection = [...tool.batchSelection];
    if (selection.length === 0) return;

    history.executeGraph('history.tile.batchDelete', () => {
      for (const pls of selection) {
        project.deleteTile(pgroup, pls);
      }
    });
    tool.clearBatchSelection();
  }

  /**
   * 批量复制：将 batchSelection 中的格复制到目标 pgroup
   *
   * 保留 x / y 相对位置，自动分配新 pls，自动建立连通
   */
  function batchCopyTo(targetPgroup: Pgroup): Pls[] {
    const srcPgroup = ensurePgroup();
    if (srcPgroup === null) return [];
    const selection = [...tool.batchSelection];
    if (selection.length === 0) return [];

    // 在 doFn 内部收集新增 pls 列表；snapshot 自动记录 before/after
    const newPlsList: Pls[] = [];
    history.executeGraph('history.tile.batchCopy', () => {
      for (const srcPls of selection) {
        const srcTile = project.currentTiles[srcPls];
        if (!srcTile) continue;
        // 检查目标 pgroup 同坐标是否已占用
        const existing = project.findTileByCoord(targetPgroup, srcTile.x, srcTile.y);
        if (existing !== null) continue; // 跳过冲突
        const newPls = project.addTile(targetPgroup, srcTile.x, srcTile.y, {
          floor: srcTile.floor,
          tide: srcTile.tide,
          passable: srcTile.passable,
          height: srcTile.height,
          destructible: srcTile.destructible,
          preset_safe: srcTile.preset_safe,
        });
        if (newPls !== null) {
          // 复制 name / desc
          project.updateTile(targetPgroup, newPls, {
            name: srcTile.name,
            desc: srcTile.desc,
          });
          newPlsList.push(newPls);
        }
      }
    });
    return newPlsList;
  }

  // ═════════════════════════════════════════════════════
  // 统一入口：根据当前工具分发点击事件
  // ═════════════════════════════════════════════════════

  /**
   * 点击已有格的统一分发（由 GridCell 触发）
   */
  function handleTileClick(pls: Pls): void {
    switch (tool.current) {
      case 'select':
        clickTileSelect(pls);
        break;
      case 'erase':
        clickTileErase(pls);
        break;
      case 'paint':
        clickTilePaint(pls);
        break;
      case 'break':
        clickTileBreak(pls);
        break;
      case 'restore':
        clickTileRestore(pls);
        break;
      case 'batch-select':
        clickTileBatchToggle(pls);
        break;
      case 'draw':
        // draw 工具点击已有格：选中（不重新绘制，避免覆盖）
        project.setSelectedPls(pls);
        break;
      default:
        break;
    }
  }

  /**
   * 点击空白格的统一分发
   */
  function handleEmptyClick(x: number, y: number): void {
    if (tool.current === 'draw') {
      clickEmptyDraw(x, y);
    }
    // 其他工具不响应空白格点击
  }

  // ─── 撤销/重做代理 ───────────────────────────────────
  function undo(): AnyCommand | null {
    return history.undo();
  }

  function redo(): AnyCommand | null {
    return history.redo();
  }

  return {
    // 状态代理
    currentTool,
    brush,
    drag,
    // 工具与画笔
    setTool,
    updateBrush,
    resetBrush,
    // select
    clickTileSelect,
    startDragTile,
    updateDragHover,
    endDragTile,
    cancelDrag,
    // draw
    clickEmptyDraw,
    // erase
    clickTileErase,
    // paint
    clickTilePaint,
    // break / restore
    clickTileBreak,
    clickTileRestore,
    // batch-select
    clickTileBatchToggle,
    setBatchSelection,
    selectRect,
    batchApplyPatch,
    batchDelete,
    batchCopyTo,
    // 统一分发
    handleTileClick,
    handleEmptyClick,
    // 撤销/重做
    undo,
    redo,
  };
}
