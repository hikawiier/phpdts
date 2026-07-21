//
// PHP 数组解析器（移植自 oblivions/editor/src/lib/php-array-parser.js，加 TS 类型）
//
// 将 PHP return [...] 格式解析为 TS 值（对象 / 数组 / 字符串 / 数字 / 布尔 / null）
// 支持：
//   - // 与 /* *\/ 注释
//   - 单引号字符串（支持 \' 与 \\ 转义）
//   - 双引号字符串（支持 \" 与 \\ 转义）
//   - true / false / null（大小写不敏感）
//   - 整数 / 浮点数（含负数）
//   - 嵌套数组（关联数组 → 对象，索引数组 → 数组）
//
// 归一化层（normalizeMapProject）：
//   - pgroup / pls 在 PHP 中是字符串 key（关联数组），TS 中转为 number
//   - 旧 exit_links 裸 pgroup 数字数组自动迁移为对象数组
//   - 由 parseMapPhp / parseRegionPhp 调用，输出对齐 types/map.ts 类型守护

import type {
  Pgroup,
  Pls,
  MapProject,
  Region,
  Grid,
  Tile,
  ExitLink,
} from '../types/map';

/**
 * 解析后的 PHP 值类型
 */
export type PhpValue =
  | string
  | number
  | boolean
  | null
  | PhpValue[]
  | { [key: string]: PhpValue };

/**
 * 解析错误（携带行号 + 列号 + 期望 token，对齐 NEW_DESIGN.md §3.2.1）
 */
export interface PhpParseError {
  message: string;
  line?: number;
  column?: number;
  expected?: string;
}

/**
 * 解析结果（对齐 NEW_DESIGN.md §3.2.1：ok=false 时携带 error）
 */
export interface PhpParseResult {
  ok: boolean;
  value: PhpValue | null;
  error?: PhpParseError;
}

/**
 * Token 类型
 */
type TokenType = 'PUNCT' | 'ARROW' | 'STRING' | 'NUMBER' | 'BOOL' | 'NULL' | 'IDENT';

interface Token {
  type: TokenType;
  value: string | number | boolean | null;
  line: number;
  column: number;
}

/**
 * 解析 PHP 文件内容，提取 return 语句中的数组
 *
 * @param phpCode PHP 文件完整内容
 * @returns 解析结果；输入无 return [...] 时 ok=false
 */
export function parsePhpArray(phpCode: string): PhpParseResult {
  // 提取 return [...] 中的内容
  const returnMatch = phpCode.match(/return\s*\[/s);
  if (!returnMatch) {
    return { ok: false, value: null, error: { message: '未找到 return [...]' } };
  }

  const returnIdx = phpCode.indexOf('return');
  if (returnIdx === -1) {
    return { ok: false, value: null, error: { message: '未找到 return 语句' } };
  }
  const startIdx = phpCode.indexOf('[', returnIdx);
  if (startIdx === -1) {
    return {
      ok: false,
      value: null,
      error: { message: 'return 后未找到 [' },
    };
  }

  // 计算起始行列（用于错误定位）
  const { line: startLine, column: startColumn } = computeLineColumn(phpCode, startIdx);

  // 找到匹配的闭合括号（跳过字符串与注释内的括号）
  let depth = 0;
  let endIdx = -1;
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;
  for (let i = startIdx; i < phpCode.length; i++) {
    const ch = phpCode[i];
    const next = phpCode[i + 1];

    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inSingle) {
      // 转义 \' 与 \\：跳过两个字符，避免被误识别为字符串结束
      if (ch === '\\' && (next === "'" || next === '\\')) {
        i++;
        continue;
      }
      if (ch === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      // 转义 \" 与 \\：跳过两个字符，避免被误识别为字符串结束
      if (ch === '\\' && (next === '"' || next === '\\')) {
        i++;
        continue;
      }
      if (ch === '"') inDouble = false;
      continue;
    }

    if (ch === '/' && next === '/') {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i++;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }

    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) {
        endIdx = i;
        break;
      }
    }
  }
  if (endIdx === -1) {
    return {
      ok: false,
      value: null,
      error: {
        message: '未找到匹配的 ]',
        line: startLine,
        column: startColumn,
        expected: ']',
      },
    };
  }

  const arrayContent = phpCode.substring(startIdx, endIdx + 1);
  const tokens = tokenize(arrayContent);
  const parser = new TokenParser(tokens);
  const value = parser.parseValue();
  if (value === null) {
    return {
      ok: false,
      value: null,
      error: {
        message: '解析返回 null：token 流不完整',
        line: startLine,
        column: startColumn,
        expected: 'array | string | number | bool | null',
      },
    };
  }
  return { ok: true, value };
}

/**
 * 计算字符索引对应的行列号
 */
function computeLineColumn(source: string, index: number): { line: number; column: number } {
  let line = 1;
  let column = 1;
  for (let i = 0; i < index && i < source.length; i++) {
    if (source[i] === '\n') {
      line++;
      column = 1;
    } else {
      column++;
    }
  }
  return { line, column };
}

/**
 * 简易词法分析
 */
function tokenize(str: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  let column = 1;

  const advance = (n = 1): void => {
    for (let k = 0; k < n; k++) {
      if (i >= str.length) break;
      if (str[i] === '\n') {
        line++;
        column = 1;
      } else {
        column++;
      }
      i++;
    }
  };

  while (i < str.length) {
    // 跳过空白
    if (/\s/.test(str[i]!)) {
      advance();
      continue;
    }

    // 单行注释
    if (str[i] === '/' && str[i + 1] === '/') {
      while (i < str.length && str[i] !== '\n') advance();
      continue;
    }

    // 多行注释
    if (str[i] === '/' && str[i + 1] === '*') {
      advance(2);
      while (i < str.length - 1 && !(str[i] === '*' && str[i + 1] === '/')) advance();
      advance(2);
      continue;
    }

    // 标点（含 => 双字符）
    if ('[](),:=>'.includes(str[i]!)) {
      if (str[i] === '=' && str[i + 1] === '>') {
        tokens.push({ type: 'ARROW', value: '=>', line, column });
        advance(2);
        continue;
      }
      tokens.push({ type: 'PUNCT', value: str[i]!, line, column });
      advance();
      continue;
    }

    // 字符串（单引号）
    if (str[i] === "'") {
      const startLine = line;
      const startCol = column;
      let val = '';
      advance(); // skip opening quote
      while (i < str.length && str[i] !== "'") {
        if (str[i] === '\\' && str[i + 1] === "'") {
          val += "'";
          advance(2);
        } else if (str[i] === '\\' && str[i + 1] === '\\') {
          val += '\\';
          advance(2);
        } else {
          val += str[i];
          advance();
        }
      }
      advance(); // skip closing quote
      tokens.push({ type: 'STRING', value: val, line: startLine, column: startCol });
      continue;
    }

    // 字符串（双引号）
    if (str[i] === '"') {
      const startLine = line;
      const startCol = column;
      let val = '';
      advance(); // skip opening quote
      while (i < str.length && str[i] !== '"') {
        if (str[i] === '\\' && str[i + 1] === '"') {
          val += '"';
          advance(2);
        } else if (str[i] === '\\' && str[i + 1] === '\\') {
          val += '\\';
          advance(2);
        } else {
          val += str[i];
          advance();
        }
      }
      advance(); // skip closing quote
      tokens.push({ type: 'STRING', value: val, line: startLine, column: startCol });
      continue;
    }

    // 数字（含负数）
    if (/-?\d/.test(str[i]!) || (str[i] === '-' && /\d/.test(str[i + 1] ?? ''))) {
      const startLine = line;
      const startCol = column;
      let num = '';
      if (str[i] === '-') {
        num += '-';
        advance();
      }
      while (i < str.length && /[\d.]/.test(str[i]!)) {
        num += str[i];
        advance();
      }
      tokens.push({
        type: 'NUMBER',
        value: parseFloat(num),
        line: startLine,
        column: startCol,
      });
      continue;
    }

    // 关键字 / 标识符
    if (/[a-zA-Z_]/.test(str[i]!)) {
      const startLine = line;
      const startCol = column;
      let word = '';
      while (i < str.length && /[a-zA-Z0-9_]/.test(str[i]!)) {
        word += str[i];
        advance();
      }
      const lower = word.toLowerCase();
      if (lower === 'true') {
        tokens.push({ type: 'BOOL', value: true, line: startLine, column: startCol });
      } else if (lower === 'false') {
        tokens.push({ type: 'BOOL', value: false, line: startLine, column: startCol });
      } else if (lower === 'null') {
        tokens.push({ type: 'NULL', value: null, line: startLine, column: startCol });
      } else {
        tokens.push({ type: 'IDENT', value: word, line: startLine, column: startCol });
      }
      continue;
    }

    // 跳过未知字符
    advance();
  }

  return tokens;
}

/**
 * Token 流解析器
 */
class TokenParser {
  private readonly tokens: Token[];
  private pos = 0;

  /**
   * 哨兵标记：区分"parseValue 返回 null 因为是 NULL token"vs"无 token 可解析"
   *
   * 旧实现 parseValue 返回 null 同时表示两种含义，导致索引数组中 null 元素被错误跳过，
   * 关联数组中 NULL 值被错误跳过。引入哨兵区分两种情况，修复 NULL 元素保留问题。
   */
  private static readonly NO_VALUE: unique symbol = Symbol('no-value');

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token | null {
    return this.pos < this.tokens.length ? this.tokens[this.pos]! : null;
  }

  private consume(): Token | null {
    return this.pos < this.tokens.length ? this.tokens[this.pos++]! : null;
  }

  private expect(
    type: TokenType,
    value?: string | number | boolean | null,
  ): Token | null {
    const tok = this.consume();
    if (!tok || tok.type !== type || (value !== undefined && tok.value !== value)) {
      // 宽容模式：不抛异常
      return null;
    }
    return tok;
  }

  parseValue(): PhpValue | null {
    const v = this.tryParseValue();
    return v === TokenParser.NO_VALUE ? null : v;
  }

  /**
   * 内部解析：返回 PhpValue 或 NO_VALUE 哨兵
   *
   * NO_VALUE 表示当前 peek token 不是有效值（如 ARROW / IDENT / 不识别的 PUNCT），
   * 调用方应据此跳过 token 而不是把 null 元素从数组中剔除
   */
  private tryParseValue(): PhpValue | typeof TokenParser.NO_VALUE {
    const tok = this.peek();
    if (!tok) return TokenParser.NO_VALUE;

    switch (tok.type) {
      case 'PUNCT':
        if (tok.value === '[') return this.parseArray();
        return TokenParser.NO_VALUE;
      case 'STRING':
        this.consume();
        return tok.value as string;
      case 'NUMBER':
        this.consume();
        return tok.value as number;
      case 'BOOL':
        this.consume();
        return tok.value as boolean;
      case 'NULL':
        this.consume();
        return null; // 显式 NULL token，是有效值
      default:
        // ARROW / IDENT 等不是值
        return TokenParser.NO_VALUE;
    }
  }

  private parseArray(): PhpValue {
    this.expect('PUNCT', '[');

    // 检测是关联数组还是索引数组
    const items: Array<{ key: PhpValue; value: PhpValue }> = [];
    let isAssoc = false;

    while (true) {
      const next = this.peek();
      if (!next) break;
      if (next.type === 'PUNCT' && next.value === ']') break;

      // 连续逗号（空元素）：宽容跳过
      if (next.type === 'PUNCT' && next.value === ',') {
        this.consume();
        continue;
      }

      const key = this.tryParseValue();
      if (key === TokenParser.NO_VALUE) {
        // 不识别的 token：跳过避免死循环
        this.consume();
        continue;
      }

      // 检查是否有 =>
      const afterKey = this.peek();
      if (afterKey && afterKey.type === 'ARROW') {
        isAssoc = true;
        this.consume(); // skip =>
        const val = this.tryParseValue();
        if (val !== TokenParser.NO_VALUE) {
          items.push({ key: key as PhpValue, value: val as PhpValue });
        }
      } else {
        // 索引数组元素（null 也是有效元素）
        items.push({ key: items.length, value: key as PhpValue });
      }

      // 跳过逗号
      const after = this.peek();
      if (after && after.type === 'PUNCT' && after.value === ',') {
        this.consume();
      }
    }

    this.expect('PUNCT', ']');

    if (isAssoc) {
      const obj: { [key: string]: PhpValue } = {};
      for (const item of items) {
        obj[String(item.key)] = item.value;
      }
      return obj;
    }
    return items.map((item) => item.value);
  }
}

// ──────────────────────────────────────────────────────────────
// 归一化层：将 PhpValue 转为 MapProject 形状（pgroup / pls 转 number，exit_links 迁移）
// ──────────────────────────────────────────────────────────────

/**
 * 旧 exit_links 格式自动迁移
 *
 * 旧格式：`exit_links => [1, 2, 3]`（裸 pgroup 数字数组，未被后端读取）
 * 新格式：`exit_links => [{ from_pls => null, to_pgroup => 1, to_pls => null }, ...]`
 *
 * 对齐 FUNCTIONAL_LIST.md §框架 1 边界案例：
 *   "exit_links 字段在原 PHP 后端代码中未被读取，编辑器将其格式升级为对象数组
 *    以支持多对多出口映射；旧 PHP 文件导入时自动迁移"
 */
export function migrateExitLinks(raw: unknown): ExitLink[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    // 已是新格式（对象）
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const obj = item as { from_pls?: unknown; to_pgroup?: unknown; to_pls?: unknown };
      return {
        from_pls: toPlsOrNull(obj.from_pls),
        to_pgroup: toPgroupOrZero(obj.to_pgroup),
        to_pls: toPlsOrNull(obj.to_pls),
      } satisfies ExitLink;
    }
    // 旧格式：裸 pgroup 数字
    if (typeof item === 'number') {
      return {
        from_pls: null,
        to_pgroup: item as Pgroup,
        to_pls: null,
      } satisfies ExitLink;
    }
    // 字符串数字
    if (typeof item === 'string' && /^\d+$/.test(item)) {
      return {
        from_pls: null,
        to_pgroup: Number(item) as Pgroup,
        to_pls: null,
      } satisfies ExitLink;
    }
    // 未知格式：跳过（返回一个空 placeholder 以保持索引一致）
    return { from_pls: null, to_pgroup: 0 as Pgroup, to_pls: null } satisfies ExitLink;
  });
}

function toPgroupOrZero(value: unknown): Pgroup {
  if (typeof value === 'number' && Number.isFinite(value)) return value as Pgroup;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value) as Pgroup;
  return 0 as Pgroup;
}

function toPlsOrNull(value: unknown): Pls | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value as Pls;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value) as Pls;
  return null;
}

/**
 * 将 PHP 解析出的 raw region 对象归一化为 Region 类型
 */
function normalizeRegion(raw: unknown): Region {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    name: typeof obj.name === 'string' ? obj.name : '',
    desc: typeof obj.desc === 'string' ? obj.desc : '',
    entrance_pls: toPlsOrNull(obj.entrance_pls),
    exit_pls: toPlsOrNull(obj.exit_pls),
    next_region: toPlsOrNull(obj.next_region) as Pgroup | null,
    prev_region: toPlsOrNull(obj.prev_region) as Pgroup | null,
    exit_links: migrateExitLinks(obj.exit_links),
    cols: typeof obj.cols === 'number' ? obj.cols : 0,
    rows: typeof obj.rows === 'number' ? obj.rows : 0,
  };
}

/**
 * 将 PHP 解析出的 raw grid 对象归一化为 Grid 类型
 */
function normalizeGrid(raw: unknown): Grid {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    cols: typeof obj.cols === 'number' ? obj.cols : 0,
    rows: typeof obj.rows === 'number' ? obj.rows : 0,
  };
}

/**
 * 将 PHP 解析出的 raw tile 对象归一化为 Tile 类型
 *
 * _breaks 字段是编辑器专用，导入时若存在则保留（编辑器内部使用），导出时由 codegen 剥离
 */
function normalizeTile(raw: unknown): Tile {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const neighbors = Array.isArray(obj.neighbors)
    ? (obj.neighbors.filter((n) => typeof n === 'number') as Pls[])
    : [];
  const _breaks = Array.isArray(obj._breaks)
    ? (obj._breaks.filter((n) => typeof n === 'number') as Pls[])
    : undefined;
  const tile: Tile = {
    name: typeof obj.name === 'string' ? obj.name : '',
    desc: typeof obj.desc === 'string' ? obj.desc : '',
    floor: (typeof obj.floor === 'string' ? obj.floor : 'standard') as Tile['floor'],
    tide: (typeof obj.tide === 'string' ? obj.tide : 'shallow') as Tile['tide'],
    height: typeof obj.height === 'number' ? obj.height : 0,
    passable: typeof obj.passable === 'boolean' ? obj.passable : true,
    destructible:
      typeof obj.destructible === 'boolean' ? obj.destructible : false,
    neighbors,
    x: typeof obj.x === 'number' ? obj.x : 0,
    y: typeof obj.y === 'number' ? obj.y : 0,
    preset_safe:
      typeof obj.preset_safe === 'boolean' ? obj.preset_safe : false,
  };
  if (_breaks && _breaks.length > 0) {
    tile._breaks = _breaks;
  }
  return tile;
}

/**
 * 将 raw 对象的所有数字字符串 key 转为 number key（pgroup / pls 类型转换）
 *
 * PHP 关联数组 key 在 parser 中以字符串保留，归一化时按需转为 number
 */
function remapNumericKeys<T>(raw: unknown, normalize: (value: unknown) => T): Record<number, T> {
  const result: Record<number, T> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return result;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (/^-?\d+$/.test(key)) {
      result[Number(key)] = normalize(value);
    }
  }
  return result;
}

/**
 * 解析 map.php 内容并归一化为 MapProject 形状
 *
 * 不解析 tiles（tiles 在 tiles/region_*.php 中），需配合 parseRegionPhp 完成
 *
 * @param phpCode map.php 文件内容
 * @returns 解析失败返回 null；成功返回 { regions, grids, tiles: {} }（tiles 待填充）
 */
export function parseMapPhp(
  phpCode: string,
): { regions: Record<Pgroup, Region>; grids: Record<Pgroup, Grid>; tiles: Record<Pgroup, Record<Pls, Tile>> } | null {
  const result = parsePhpArray(phpCode);
  if (!result.ok || !result.value || typeof result.value !== 'object') return null;
  const data = result.value as { regions?: unknown; grids?: unknown };
  return {
    regions: remapNumericKeys(data.regions, normalizeRegion) as Record<Pgroup, Region>,
    grids: remapNumericKeys(data.grids, normalizeGrid) as Record<Pgroup, Grid>,
    tiles: {} as Record<Pgroup, Record<Pls, Tile>>,
  };
}

/**
 * 解析 region_*.php 内容并归一化为 { pgroup, tiles } 形状
 *
 * @param phpCode 文件内容
 * @param pgroup  区域编号（外部传入，因为文件名中包含此信息）
 */
export function parseRegionPhp(
  phpCode: string,
  pgroup: Pgroup,
): { pgroup: Pgroup; tiles: Record<Pls, Tile> } | null {
  const result = parsePhpArray(phpCode);
  if (!result.ok || !result.value) return null;
  const tiles = remapNumericKeys(result.value, normalizeTile) as Record<Pls, Tile>;
  return { pgroup, tiles };
}

/**
 * 从 PHP 文件名中提取 pgroup
 * 如 region_1.php → 1
 */
export function extractPgroupFromFilename(filename: string): Pgroup | null {
  const match = filename.match(/region_(\d+)/);
  return match ? parseInt(match[1]!, 10) : null;
}

/**
 * 将多个解析结果合并为完整 MapProject
 *
 * 调用方负责先调用 parseMapPhp 获得 regions/grids，再循环调用 parseRegionPhp 填充 tiles
 */
export function assembleMapProject(
  map: { regions: Record<Pgroup, Region>; grids: Record<Pgroup, Grid>; tiles: Record<Pgroup, Record<Pls, Tile>> },
  regionResults: Array<{ pgroup: Pgroup; tiles: Record<Pls, Tile> }>,
): MapProject {
  for (const result of regionResults) {
    map.tiles[result.pgroup] = result.tiles;
  }
  // 对缺失 tiles 的区域填充空对象，保持 regions / tiles 索引一致
  for (const pgroup of Object.keys(map.regions)) {
    const pgroupNum = Number(pgroup) as Pgroup;
    if (!map.tiles[pgroupNum]) {
      map.tiles[pgroupNum] = {} as Record<Pls, Tile>;
    }
  }
  return map as unknown as MapProject;
}

/**
 * 类型守护：判断 PHP 解析结果是否为 MapProject 形状
 *
 * 注意：PHP 解析后 pgroup / pls 均为字符串 key，调用方需自行转换为 number
 */
export function isMapProjectShape(value: unknown): value is {
  regions: Record<string, unknown>;
  grids: Record<string, unknown>;
  tiles: Record<string, unknown>;
} {
  if (!value || typeof value !== 'object') return false;
  const v = value as { regions?: unknown; grids?: unknown; tiles?: unknown };
  return v.regions !== undefined && v.grids !== undefined;
}
