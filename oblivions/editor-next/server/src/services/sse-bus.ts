//
// O-1 Workspace Gateway SSE 推送通道
//
// 内部 EventEmitter + Express 路由 GET /api/events。
// 每个连接独立 listener，连接关闭时清理。
//
// @module O 内容工具箱
//

import type { Express, Request, Response } from 'express';
import { EventEmitter } from 'node:events';

interface SseEvent {
  event: string;
  data: unknown;
}

class SseBus extends EventEmitter {
  private nextClientId = 1;
  private readonly clients = new Map<number, Response>();

  constructor() {
    super();
    // Node 默认 maxListeners=10，每个客户端注册一个 listener，提前抬高阈值
    this.setMaxListeners(100);
  }

  /**
   * 广播事件给所有已连接客户端
   */
  broadcast(event: string, data: unknown): void {
    const payload: SseEvent = { event, data };
    for (const res of this.clients.values()) {
      this.writeTo(res, payload);
    }
  }

  /**
   * 在 Express app 上挂载 GET /api/events 路由
   */
  attach(app: Express, routePath: string = '/api/events'): void {
    app.get(routePath, (req: Request, res: Response) => {
      this.handleConnection(req, res);
    });
  }

  private handleConnection(_req: Request, res: Response): void {
    const clientId = this.nextClientId++;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // 禁用 nginx 等中间代理的缓冲（开发环境通常无代理，但保留兼容）
      'X-Accel-Buffering': 'no',
    });
    res.write(': connected\n\n');

    this.clients.set(clientId, res);

    // 心跳：每 25s 写一行注释，防止代理超时关闭连接
    const heartbeat = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        // 写入失败说明连接已断开，setInterval 会在 close 事件中被清理
      }
    }, 25000);

    const cleanup = (): void => {
      clearInterval(heartbeat);
      this.clients.delete(clientId);
    };

    res.on('close', cleanup);
    res.on('error', cleanup);
  }

  private writeTo(res: Response, payload: SseEvent): void {
    const data = `event: ${payload.event}\ndata: ${JSON.stringify(payload.data)}\n\n`;
    try {
      res.write(data);
    } catch {
      // 写入失败时连接已断开，EventEmitter 之外的清理由 res.close 事件处理
    }
  }

  /**
   * 当前连接数（用于诊断/测试）
   */
  get clientCount(): number {
    return this.clients.size;
  }
}

export const sseBus = new SseBus();
