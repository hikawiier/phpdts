//
// 种子化伪随机数生成器（mulberry32 算法）
//
// 用于 O-4 随机生成扩展点：确保相同 seed + params 必产生相同结果（可复现性）
// 设计案 §3.7.4：seed=0 视为"使用随机种子"，正整数视为可复现种子

/**
 * 种子化伪随机数生成器接口
 */
export interface Rng {
  /** 实际使用的种子（用于日志记录与可复现性） */
  seed: number;
  /** 返回 [0, 1) 浮点数 */
  next(): number;
}

/**
 * 创建一个种子化伪随机数生成器（mulberry32 算法）
 *
 * @param seed  种子；undefined / 负数 / NaN → 用 Math.random 生成新种子；
 *              正整数（含 0 视为随机种子，对齐设计案 §3.7.4）→ 可复现种子
 * @returns Rng 实例
 */
export function createRng(seed?: number): Rng {
  let s: number;
  if (typeof seed === 'number' && isFinite(seed) && seed > 0) {
    s = seed >>> 0;
  } else {
    s = (Math.random() * 0xffffffff) >>> 0;
  }
  return {
    seed: s,
    next() {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

/**
 * 工具函数：从概率判断是否命中（rng.next() < rate → true）
 */
export function roll(rng: Rng, rate: number): boolean {
  return rng.next() < rate;
}

/**
 * 工具函数：从数组中按均匀分布随机取一个元素
 */
export function pick<T>(rng: Rng, arr: readonly T[]): T | undefined {
  if (!Array.isArray(arr) || arr.length === 0) return undefined;
  const idx = Math.floor(rng.next() * arr.length);
  return arr[idx];
}

/**
 * 工具函数：返回 [min, max] 闭区间内的随机整数
 */
export function randInt(rng: Rng, min: number, max: number): number {
  if (max < min) [min, max] = [max, min];
  return Math.floor(rng.next() * (max - min + 1)) + min;
}
