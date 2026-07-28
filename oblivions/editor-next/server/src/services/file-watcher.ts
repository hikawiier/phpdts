//
// O-1 Workspace Gateway 文件监听服务
//
// chokidar 监听 gamedata/ 与 vex-vue/src/data/，变更通过 sseBus 推送 file:changed 事件。
//
// O-5 扩展：新增 pause/resume 方法，在原子发布期间临时停止事件广播，避免 Gateway 自身
// 写入触发 file:changed 事件，进而触发前端 refetch 与 baseline 失效检测。
//
// 实现策略：chokidar 无原生 pause/resume；本模块通过 paused 标志位在 emit 之前过滤。
// 这样 watcher 仍在监听（无重连开销），但不向 SSE 推送事件。
//
// @module O 内容工具箱
//

import chokidar from 'chokidar';
import fs from 'node:fs';
import { sseBus } from './sse-bus';
import type { Config } from '../config';
import { toWorkspaceRelative } from '../config';

export interface FileChangeEvent {
  /** 相对 workspaceRoot 的路径（斜杠分隔） */
  path: string;
  type: 'changed' | 'added' | 'removed';
  mtime?: number;
}

/**
 * 文件监听句柄——startFileWatcher 返回。
 *
 * - stop：关闭 watcher，释放资源
 * - pause：临时停止事件广播（不关闭 watcher）
 * - resume：恢复事件广播
 *
 * pause/resume 用于 O-5 原子发布期间，避免 Gateway 自身写入触发 file:changed 事件。
 */
export interface WatcherHandle {
  stop: () => void;
  pause: () => void;
  resume: () => void;
}

/**
 * 启动文件监听。返回 WatcherHandle，含 stop / pause / resume 方法。
 */
export function startFileWatcher(config: Config): WatcherHandle {
  const watchTargets: Array<{ absDir: string; label: string }> = [];
  if (fs.existsSync(config.gamedataPath)) {
    watchTargets.push({ absDir: config.gamedataPath, label: 'gamedata' });
  } else {
    console.warn(`[gateway] gamedataPath 不存在，跳过监听: ${config.gamedataPath}`);
  }
  if (fs.existsSync(config.vexVueDataPath)) {
    watchTargets.push({ absDir: config.vexVueDataPath, label: 'vex-vue/data' });
  } else {
    console.warn(`[gateway] vexVueDataPath 不存在，跳过监听: ${config.vexVueDataPath}`);
  }

  if (watchTargets.length === 0) {
    console.warn('[gateway] 无可监听目录，file-watcher 未启动');
    return {
      stop: () => undefined,
      pause: () => undefined,
      resume: () => undefined,
    };
  }

  const watchPaths = watchTargets.map((t) => t.absDir);
  console.log('[gateway] file-watcher 监听目录:');
  for (const t of watchTargets) {
    console.log(`  - [${t.label}] ${t.absDir}`);
  }

  const watcher = chokidar.watch(watchPaths, {
    ignoreInitial: true,
    persistent: true,
    // 忽略备份目录、隐藏文件、node_modules
    ignored: (testPath: string) => {
      const parts = testPath.split(/[\\/]/);
      return parts.some((p) => p === 'node_modules' || p === '.backups' || p.startsWith('.'));
    },
    awaitWriteFinish: {
      stabilityThreshold: 80,
      pollInterval: 20,
    },
  });

  // paused 标志位——pause 期间不广播事件
  let paused = false;

  const emit = (absPath: string, type: FileChangeEvent['type']): void => {
    if (paused) return; // 发布期间静默
    let mtime: number | undefined;
    try {
      const stat = fs.statSync(absPath);
      if (stat.isFile()) {
        mtime = Math.floor(stat.mtimeMs);
      } else {
        return; // 仅推送文件事件
      }
    } catch {
      // 文件已删除等场景，mtime 留空
    }
    const relPath = toWorkspaceRelative(config.workspaceRoot, absPath);
    const payload: FileChangeEvent = { path: relPath, type, mtime };
    sseBus.broadcast('file:changed', payload);
  };

  watcher.on('add', (p) => emit(p, 'added'));
  watcher.on('change', (p) => emit(p, 'changed'));
  watcher.on('unlink', (p) => emit(p, 'removed'));

  return {
    stop: () => {
      watcher.close().catch((err) => {
        console.error('[gateway] file-watcher 关闭失败:', err);
      });
    },
    pause: () => {
      paused = true;
    },
    resume: () => {
      paused = false;
    },
  };
}

/**
 * 全局 watcher 引用——供 publish 路由在发布期间调用 pause/resume。
 *
 * main.ts 在 startFileWatcher 后调用 setGlobalWatcher(handle)；
 * withWatcherPaused(fn) 在 fn 执行期间 pause，结束后 resume（无论 fn 成功与否）。
 */
let globalWatcher: WatcherHandle | null = null;

export function setGlobalWatcher(handle: WatcherHandle | null): void {
  globalWatcher = handle;
}

/**
 * 在 fn 执行期间暂停 file-watcher 事件广播。
 *
 * 用于 O-5 原子发布路由：发布期间 pause，发布完成（无论成功失败）后 resume。
 * 全局 watcher 未设置时直接执行 fn，不报错（测试环境或 watcher 未启动场景）。
 */
export async function withWatcherPaused<T>(fn: () => Promise<T>): Promise<T> {
  if (globalWatcher) globalWatcher.pause();
  try {
    return await fn();
  } finally {
    if (globalWatcher) globalWatcher.resume();
  }
}
