//
// O-1 Workspace Gateway 入口
//
// 启动本地工作区服务：
//   - 端口固定 5180，绑定 127.0.0.1，禁止外部访问
//   - 读路由：health / read / read-dir / parse-php / parse-ts-locale / lint-php / events
//   - 写路由（O-5）：write / backups / restore
//   - chokidar 监听 gamedata/ 与 vex-vue/src/data/，通过 SSE 推送 file:changed
//     发布期间暂停 watcher 事件广播，避免自身写入触发 refetch
//
// 不加载 obl_bootstrap.php、不连接游戏数据库。
//
// @module O 内容工具箱
// @framework O-1 Workspace Gateway
//              O-5 Change Set（写路由集成）
//

import express from 'express';
import { loadConfig } from './config';
import { sseBus } from './services/sse-bus';
import { startFileWatcher, setGlobalWatcher } from './services/file-watcher';
import { registerHealthRoute } from './routes/health';
import { registerReadRoute } from './routes/read';
import { registerReadDirRoute } from './routes/read-dir';
import { registerParsePhpRoute } from './routes/parse-php';
import { registerParseTsLocaleRoute } from './routes/parse-ts-locale';
import { registerLintPhpRoute } from './routes/lint-php';
import { registerWriteRoute } from './routes/write';
import { registerBackupListRoute } from './routes/backup-list';
import { registerRestoreRoute } from './routes/restore';
import { registerMigrateRoute } from './routes/migrate';
import { registerStateRoute } from './routes/state';

function main(): void {
  const config = loadConfig();

  const app = express();
  // POST 路由需要 JSON body 解析（限制 8MB，足够 gamedata 中最大单文件）
  app.use(express.json({ limit: '8mb' }));

  // 挂载读路由
  registerHealthRoute(app, config);
  registerReadRoute(app, config);
  registerReadDirRoute(app, config);
  registerParsePhpRoute(app, config);
  registerParseTsLocaleRoute(app, config);
  registerLintPhpRoute(app, config);
  registerStateRoute(app, config);

  // 挂载 O-5 写路由
  registerWriteRoute(app, config);
  registerBackupListRoute(app, config);
  registerRestoreRoute(app, config);

  // 挂载 O-11 迁移路由
  registerMigrateRoute(app, config);

  // SSE 通道
  sseBus.attach(app, '/api/events');

  // 启动文件监听并注册为全局句柄，供写路由在发布期间 pause/resume
  const watcherHandle = startFileWatcher(config);
  setGlobalWatcher(watcherHandle);

  const server = app.listen(config.port, config.host, () => {
    console.log('[gateway] Workspace Gateway 已启动');
    console.log(`[gateway] 监听: http://${config.host}:${config.port}`);
    console.log(`[gateway] 工作区根路径: ${config.workspaceRoot}`);
    console.log(`[gateway] gamedata 路径: ${config.gamedataPath}`);
    console.log(`[gateway] vex-vue data 路径: ${config.vexVueDataPath}`);
    console.log(`[gateway] 备份目录: ${config.backupPath}`);
    console.log('[gateway] 路由:');
    console.log('  GET  /api/health');
    console.log('  GET  /api/read?path=<relPath>');
    console.log('  GET  /api/read-dir?path=<relPath>&recursive=false');
    console.log('  POST /api/parse-php');
    console.log('  POST /api/parse-ts-locale (501, P0-D 实现)');
    console.log('  POST /api/lint-php');
    console.log('  GET  /api/state?scope=<stateScope>&debug=all');
    console.log('  POST /api/write (O-5 原子发布)');
    console.log('  GET  /api/backups (O-5 备份列表)');
    console.log('  POST /api/restore (O-5 备份还原)');
    console.log('  POST /api/migrate (O-11 一次性迁移)');
    console.log('  GET  /api/migration-status (O-11 迁移状态探测)');
    console.log('  GET  /api/events (SSE)');
  });

  // 优雅关闭
  const shutdown = (signal: string): void => {
    console.log(`[gateway] 收到 ${signal}，关闭中...`);
    server.close(() => {
      watcherHandle.stop();
      setGlobalWatcher(null);
      process.exit(0);
    });
    // 强制超时退出（防止连接挂起）
    setTimeout(() => process.exit(1), 3000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();
