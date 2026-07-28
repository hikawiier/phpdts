/**
 * @module O 内容工具箱
 *
 * 文件级 revision 三元组——基线捕获与冲突检测的最小判定单元。
 *
 * 设计意图：
 * - 节点级 revision（graph-store）只关心内容 hash；文件级 revision 还需 mtime + size
 *   两项元数据，避免仅靠 contentHash 在「同内容、不同时间戳」的 round-trip 场景误判未变更。
 * - 三元组全匹配才视为未变更；任一字段不一致即视为基线失效，触发外部修改提示。
 * - contentHash 复用 graph-store 的 computeRevision 思路（SHA-256 前 16 字节十六进制），
 *   但作用于原始文件内容字符串而非 JSON.stringify(node.data)。
 */

/**
 * 文件 revision 三元组。
 *
 * - mtime：文件最后修改时间（ms epoch），来自 Gateway `/api/read` 响应
 * - size：文件字节数
 * - contentHash：内容 SHA-256 前 16 字节十六进制（32 字符）
 *
 * 三者全等才视为同一 revision。
 */
export interface FileRevision {
  mtime: number;
  size: number;
  contentHash: string;
}

/**
 * 计算 FileRevision。
 *
 * 浏览器环境优先用 crypto.subtle.digest；Node.js / 单测环境走 djb2 polyfill
 * （与 graph-store.computeRevision 的降级策略一致，仅开发期使用，不用于生产）。
 */
export async function computeFileRevision(
  content: string,
  stat: { mtime: number; size: number },
): Promise<FileRevision> {
  const contentHash = await hashContent(content);
  return {
    mtime: stat.mtime,
    size: stat.size,
    contentHash,
  };
}

/**
 * 三元组全匹配才视为未变更。
 */
export function isRevisionEqual(a: FileRevision, b: FileRevision): boolean {
  return a.mtime === b.mtime && a.size === b.size && a.contentHash === b.contentHash;
}

/**
 * 序列化为字符串——用于 localStorage 持久化。
 *
 * 格式：`${mtime}|${size}|${contentHash}`，分隔符选用 `|` 避免与路径分隔符冲突。
 */
export function serializeRevision(r: FileRevision): string {
  return `${r.mtime}|${r.size}|${r.contentHash}`;
}

/**
 * 反序列化——与 serializeRevision 对偶。
 *
 * 非法格式返回 null，由调用方决定是否丢弃基线。
 */
export function deserializeRevision(s: string): FileRevision | null {
  const parts = s.split('|');
  if (parts.length !== 3) return null;
  const mtime = Number(parts[0]);
  const size = Number(parts[1]);
  const contentHash = parts[2];
  if (!Number.isFinite(mtime) || !Number.isFinite(size) || !contentHash) {
    return null;
  }
  return { mtime, size, contentHash };
}

// —— 内部：哈希计算（与 graph-store.computeRevision 同构，但作用于原始字符串）——

async function hashContent(content: string): Promise<string> {
  const cryptoObj = (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoObj?.subtle) {
    const buf = new TextEncoder().encode(content);
    const hashBuf = await cryptoObj.subtle.digest('SHA-256', buf);
    const bytes = new Uint8Array(hashBuf).slice(0, 16);
    return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  // Fallback：djb2 hash（仅开发期/Node 单测，不用于生产）
  let h = 5381;
  for (let i = 0; i < content.length; i++) {
    h = ((h << 5) + h + content.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16).padStart(8, '0').repeat(2).slice(0, 32);
}
