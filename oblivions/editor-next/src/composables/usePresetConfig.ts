// @module O 内容工具箱
//
// usePresetConfig：编辑器预设路径配置读取
//
// 设计意图：
//   - AI 助手通过编辑 editor.config.json 设置 gamedata / backup 预设路径
//   - 用户在浏览器点击"使用预设路径"即可导入，无需每次手动选择目录
//   - 仅开发环境生效（vite dev server 从项目根目录提供 /editor.config.json）
//   - 生产构建不可用（无 vite dev server），降级为 null 不报错
//
// 读取方式：fetch('/editor.config.json')
// 缓存策略：模块级单例缓存，避免重复 fetch
//

/**
 * 预设路径配置结构
 */
export interface PresetConfig {
  /** gamedata 目录绝对路径（如 D:/wamp64/www/phpdts/oblivions/gamedata） */
  readonly gamedataPath: string;
  /** backup 目录绝对路径（如 D:/wamp64/www/phpdts/oblivions/gamedata/backup） */
  readonly backupPath: string;
}

// ─── 模块级缓存（单例，跨 composable 实例共享） ────────────────
let cachedConfig: PresetConfig | null = null;
let fetchPromise: Promise<PresetConfig | null> | null = null;

/**
 * 加载预设路径配置
 *
 * 行为：
 *   - 首次调用触发 fetch('/editor.config.json')
 *   - 后续调用返回缓存（无论成功或失败）
 *   - fetch 失败、JSON 解析失败、字段缺失均返回 null（静默降级）
 *   - 测试环境（jsdom）fetch 文件不存在时返回 null
 *
 * @returns 配置对象或 null
 */
export async function loadPresetConfig(): Promise<PresetConfig | null> {
  // 已有缓存直接返回
  if (cachedConfig !== null) {
    return cachedConfig;
  }
  // 已有进行中的 fetch 复用 Promise（避免并发重复请求）
  if (fetchPromise !== null) {
    return fetchPromise;
  }

  fetchPromise = (async (): Promise<PresetConfig | null> => {
    try {
      // 仅浏览器环境 + vite dev server 可访问 /editor.config.json
      if (typeof fetch !== 'function') return null;
      const resp = await fetch('/editor.config.json', { cache: 'no-cache' });
      if (!resp.ok) return null;
      const data = (await resp.json()) as Partial<PresetConfig>;
      if (typeof data.gamedataPath !== 'string' || !data.gamedataPath) return null;
      if (typeof data.backupPath !== 'string' || !data.backupPath) return null;
      const config: PresetConfig = {
        gamedataPath: data.gamedataPath,
        backupPath: data.backupPath,
      };
      cachedConfig = config;
      return config;
    } catch {
      // 静默降级：fetch 不存在 / 网络错误 / JSON 解析失败等
      return null;
    }
  })();

  return fetchPromise;
}

/**
 * 重置缓存（仅测试用）
 *
 * 生产代码不应调用：配置在单次会话内不会变化
 */
export function resetPresetConfigCache(): void {
  cachedConfig = null;
  fetchPromise = null;
}

/**
 * 同步获取已缓存的预设配置（未加载时返回 null）
 *
 * 用于 UI 同步展示预设路径（如 ImportModal 按钮文案、ExportModal 提示）
 * 首次渲染时返回 null，需在 onMounted 中调用 loadPresetConfig 异步加载
 */
export function getCachedPresetConfig(): PresetConfig | null {
  return cachedConfig;
}

/**
 * 将本地绝对路径转换为 vite dev server 的 /@fs/ URL
 *
 * vite 开发服务器通过 /@fs/ 前缀可访问 server.fs.allow 范围内的任意文件
 * Windows 路径 D:/foo/bar.php → /@fs/D:/foo/bar.php
 *
 * @param absolutePath 文件绝对路径
 * @returns vite /@fs/ URL
 */
export function toViteFsUrl(absolutePath: string): string {
  // 统一斜杠方向（vite 接受正斜杠）
  const normalized = absolutePath.replace(/\\/g, '/');
  return `/@fs/${normalized}`;
}
