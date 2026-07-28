/**
 * @module O 内容工具箱
 *
 * TS locale 适配器——读取侧解析 vex-vue/src/data/*-locale.ts 为 ResourceNode[]；
 * 写入侧（P5-2 切换）路由到 build/projectors/*-locale-projector.ts 投影器，
 * adapter 不再内联维护文件模板。
 *
 * 读取侧支持的形态（执行案 §4.4.2）：
 *   1. 标准形态：`export const XXX_LOCALE: Record<string, XxxEntry> = { ... };`
 *   2. 多常量形态：`export const RECIPE_LOCALE: ...; export const RECIPE_CATEGORY_LABELS: ...;`
 *
 * 读取策略：
 *   - 不引入完整的 TypeScript 编译器（包体积大）
 *   - 用正则定位 `const NAME: Record<string, T> = {` 起始位置
 *   - 用简易 tokenizer + 递归下降解析对象字面量
 *   - 多常量文件按启发式选择：优先取 value 是对象类型的常量（过滤 Record<string, string>）
 *     单常量文件直接使用（覆盖 itmk/tag locale 的 Record<string, string>）
 */

import type { KindSchema } from '../schema/types';
import type { ResourceNode } from '../graph/types';
import type { SourceAnchor } from '../graph/edge';
// P5-2 投影器接管写入侧（执行案 §4.2.2 / §4.3.3）——adapter 写入路径从内联 serializeXxx
// 切换为调用独立投影器。projector 是纯函数模块，无副作用；`import type` 编译时擦除，
// 运行时调用需要函数值，故用普通 import。
import { projectPoiLocale } from '../build/projectors/poi-locale-projector';
import { projectEnemyLocale } from '../build/projectors/enemy-locale-projector';
import { projectItemLocale } from '../build/projectors/item-locale-projector';
import { projectRecipeLocale } from '../build/projectors/recipe-locale-projector';
import { projectTerrainDesc } from '../build/projectors/terrain-desc-projector';
import { projectItmkLocale } from '../build/projectors/itmk-locale-projector';
import { projectTagLocale } from '../build/projectors/tag-locale-projector';
import { projectStatusLocale } from '../build/projectors/status-locale-projector';
import { projectUiLocale } from '../build/projectors/ui-locale-projector';

/**
 * 序列化后的 TS 文件形态——P1 阶段实现写路径时使用。
 */
export interface SerializedTsFile {
  filePath: string;
  content: string;
}

/**
 * TS 字面量值类型（与 PhpValue 对齐，但独立声明以避免耦合）
 */
type TsValue =
  | string
  | number
  | boolean
  | null
  | TsValue[]
  | { [key: string]: TsValue };

/**
 * 单个 `const NAME: Record<string, T> = { ... }` 声明的解析结果
 */
interface ConstDecl {
  /** 常量名（如 ITEM_LOCALE） */
  name: string;
  /** 类型参数（如 ItemLocaleEntry / string） */
  valueType: string;
  /** 解析后的对象字面量（key 顺序保留） */
  value: Map<string, TsValue>;
  /** value 是否为对象类型（Record<string, XxxEntry>，而非 Record<string, string>） */
  isObjectValue: boolean;
}

/**
 * 解析 TS locale 文件为 ResourceNode[]
 *
 * @param filePath 工作区相对路径（如 'vex-vue/src/data/item-locale.ts'）
 * @param content TS 文件完整内容
 * @param kindSchema 资源 kind 的 schema 契约
 */
export function parseTsLocale(
  filePath: string,
  content: string,
  kindSchema: KindSchema,
): ResourceNode[] {
  const decls = extractConstDecls(content);

  if (decls.length === 0) {
    // P0 阶段：形态 3（terrain-desc）/ 形态 4（无 Record<string,...>）返回空数组
    return [];
  }

  // 启发式选择常量：
  // - 单常量文件：直接使用（覆盖 itmk/tag 的 Record<string, string>）
  // - 多常量文件：优先取 value 是对象类型的（过滤 Record<string, string>）
  let selected: ConstDecl | undefined;
  if (decls.length === 1) {
    selected = decls[0];
  } else {
    const objectDecls = decls.filter((d) => d.isObjectValue);
    if (objectDecls.length > 0) {
      selected = objectDecls[0];
    } else {
      selected = decls[0];
    }
  }

  if (!selected) return [];

  const sourceAnchor: SourceAnchor = {
    filePath,
    lineStart: 0,
    lineEnd: 0,
    format: 'ts',
  };

  const nodes: ResourceNode[] = [];
  for (const [key, val] of selected.value) {
    nodes.push({
      kind: kindSchema.kind,
      id: key,
      data: val,
      source: [sourceAnchor],
      revision: '',
    });
  }
  return nodes;
}

/**
 * 从 TS 文件内容中提取所有 `const NAME: Record<string, T> = { ... }` 声明
 *
 * 正则匹配 `const NAME: Record<string, T> = {`，然后用 brace-matching 找闭合 `}`。
 */
function extractConstDecls(content: string): ConstDecl[] {
  const decls: ConstDecl[] = [];

  // 正则：可选 export + const + NAME + : + Record<string, T> + = + {
  // NAME 通常是全大写字母+下划线（如 ITEM_LOCALE），但宽松接受任意标识符
  const re = /(?:export\s+)?const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*:\s*Record<string,\s*([^>]+?)>\s*=\s*\{/g;
  let match: RegExpExecArray | null;

  while ((match = re.exec(content)) !== null) {
    const name = match[1]!;
    const valueType = match[2]!.trim();
    const openBraceIdx = content.indexOf('{', match.index + match[0].length - 1);
    if (openBraceIdx === -1) continue;

    const closeBraceIdx = findMatchingBrace(content, openBraceIdx);
    if (closeBraceIdx === -1) continue;

    const objLiteral = content.substring(openBraceIdx, closeBraceIdx + 1);
    const value = parseObjectLiteral(objLiteral);
    if (value === null) continue;

    // 判断 value 是否为对象类型（Record<string, XxxEntry>，valueType 不是 'string'）
    const isObjectValue = valueType !== 'string';

    decls.push({
      name,
      valueType,
      value,
      isObjectValue,
    });
  }

  return decls;
}

/**
 * 找匹配的闭合大括号（跳过字符串、模板字符串、注释、嵌套大括号）
 */
function findMatchingBrace(content: string, openIdx: number): number {
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = openIdx; i < content.length; i++) {
    const ch = content[i]!;
    const next = content[i + 1];

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
      if (ch === '\\' && next !== undefined) {
        i++;
        continue;
      }
      if (ch === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (ch === '\\' && next !== undefined) {
        i++;
        continue;
      }
      if (ch === '"') inDouble = false;
      continue;
    }
    if (inTemplate) {
      if (ch === '\\' && next !== undefined) {
        i++;
        continue;
      }
      if (ch === '`') inTemplate = false;
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
    if (ch === '`') {
      inTemplate = true;
      continue;
    }

    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// ──────────────────────────────────────────────────────────────
// 简易 TS 字面量 tokenizer + 递归下降 parser
// ──────────────────────────────────────────────────────────────

type TtTokenType =
  | 'PUNCT'   // { } [ ] : ,
  | 'STRING'  // '...' / "..." / `...`
  | 'NUMBER'
  | 'BOOL'    // true / false
  | 'NULL'    // null
  | 'IDENT';  // 其他标识符（如枚举值）

interface TtToken {
  type: TtTokenType;
  value: string | number | boolean | null;
  line: number;
  column: number;
}

function tokenizeTsLiteral(str: string): TtToken[] {
  const tokens: TtToken[] = [];
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

    // 标点
    if ('{}[]:,'.includes(str[i]!)) {
      tokens.push({ type: 'PUNCT', value: str[i]!, line, column });
      advance();
      continue;
    }

    // 单引号字符串
    if (str[i] === "'") {
      const startLine = line;
      const startCol = column;
      let val = '';
      advance();
      while (i < str.length && str[i] !== "'") {
        if (str[i] === '\\' && str[i + 1] !== undefined) {
          val += str[i + 1];
          advance(2);
        } else {
          val += str[i];
          advance();
        }
      }
      advance();
      tokens.push({ type: 'STRING', value: val, line: startLine, column: startCol });
      continue;
    }

    // 双引号字符串
    if (str[i] === '"') {
      const startLine = line;
      const startCol = column;
      let val = '';
      advance();
      while (i < str.length && str[i] !== '"') {
        if (str[i] === '\\' && str[i + 1] !== undefined) {
          val += str[i + 1];
          advance(2);
        } else {
          val += str[i];
          advance();
        }
      }
      advance();
      tokens.push({ type: 'STRING', value: val, line: startLine, column: startCol });
      continue;
    }

    // 模板字符串（简化处理，不支持 ${} 嵌套）
    if (str[i] === '`') {
      const startLine = line;
      const startCol = column;
      let val = '';
      advance();
      while (i < str.length && str[i] !== '`') {
        if (str[i] === '\\' && str[i + 1] !== undefined) {
          val += str[i + 1];
          advance(2);
        } else {
          val += str[i];
          advance();
        }
      }
      advance();
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
      while (i < str.length && /[\d.eExXa-fA-F]/.test(str[i]!)) {
        num += str[i];
        advance();
      }
      tokens.push({
        type: 'NUMBER',
        value: Number(num),
        line: startLine,
        column: startCol,
      });
      continue;
    }

    // 标识符 / 关键字
    if (/[A-Za-z_$]/.test(str[i]!)) {
      const startLine = line;
      const startCol = column;
      let word = '';
      while (i < str.length && /[A-Za-z0-9_$]/.test(str[i]!)) {
        word += str[i];
        advance();
      }
      const lower = word.toLowerCase();
      if (lower === 'true') {
        tokens.push({ type: 'BOOL', value: true, line: startLine, column: startCol });
      } else if (lower === 'false') {
        tokens.push({ type: 'BOOL', value: false, line: startLine, column: startCol });
      } else if (lower === 'null' || lower === 'undefined') {
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

class TsLiteralParser {
  private readonly tokens: TtToken[];
  private pos = 0;

  constructor(tokens: TtToken[]) {
    this.tokens = tokens;
  }

  private peek(): TtToken | null {
    return this.pos < this.tokens.length ? this.tokens[this.pos]! : null;
  }

  private consume(): TtToken | null {
    return this.pos < this.tokens.length ? this.tokens[this.pos++]! : null;
  }

  parseObject(): Map<string, TsValue> | null {
    const open = this.consume();
    if (!open || open.type !== 'PUNCT' || open.value !== '{') return null;

    const result = new Map<string, TsValue>();

    while (true) {
      const next = this.peek();
      if (!next) return null;
      if (next.type === 'PUNCT' && next.value === '}') {
        this.consume();
        return result;
      }

      // 跳过连续逗号
      if (next.type === 'PUNCT' && next.value === ',') {
        this.consume();
        continue;
      }

      // 解析 key
      const keyTok = this.consume();
      if (!keyTok) return null;
      let key: string;
      if (keyTok.type === 'STRING') {
        key = String(keyTok.value);
      } else if (keyTok.type === 'IDENT') {
        key = String(keyTok.value);
      } else if (keyTok.type === 'NUMBER') {
        key = String(keyTok.value);
      } else {
        // 不识别的 key token，跳过避免死循环
        continue;
      }

      // 期望 :
      const colon = this.consume();
      if (!colon || colon.type !== 'PUNCT' || colon.value !== ':') {
        continue;
      }

      // 解析 value
      const val = this.parseValue();
      if (val !== null) {
        result.set(key, val);
      }

      // 跳过逗号
      const after = this.peek();
      if (after && after.type === 'PUNCT' && after.value === ',') {
        this.consume();
      }
    }
  }

  parseValue(): TsValue | null {
    const tok = this.peek();
    if (!tok) return null;

    switch (tok.type) {
      case 'PUNCT':
        if (tok.value === '{') {
          // parseObject 返回 Map（顶层保留键顺序），嵌套对象转为 plain object 以匹配 TsValue 类型
          const map = this.parseObject();
          if (map === null) return null;
          const obj: { [key: string]: TsValue } = {};
          for (const [k, v] of map) obj[k] = v;
          return obj;
        }
        if (tok.value === '[') return this.parseArray();
        return null;
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
        return null;
      case 'IDENT':
        // 未识别的标识符（如枚举值），消费并返回字符串形式
        this.consume();
        return String(tok.value);
      default:
        return null;
    }
  }

  parseArray(): TsValue | null {
    const open = this.consume();
    if (!open || open.type !== 'PUNCT' || open.value !== '[') return null;

    const result: TsValue[] = [];
    while (true) {
      const next = this.peek();
      if (!next) return null;
      if (next.type === 'PUNCT' && next.value === ']') {
        this.consume();
        return result;
      }
      if (next.type === 'PUNCT' && next.value === ',') {
        this.consume();
        continue;
      }

      const val = this.parseValue();
      if (val !== null) {
        result.push(val);
      } else {
        // 无法解析的元素，跳过避免死循环
        this.consume();
      }

      const after = this.peek();
      if (after && after.type === 'PUNCT' && after.value === ',') {
        this.consume();
      }
    }
  }
}

/**
 * 解析 TS 对象字面量字符串为 Map<key, TsValue>
 *
 * 输入形如 `{ key1: { name: '...', desc: '...' }, key2: ... }`。
 * 用 Map 保留键顺序，确保 round-trip 一致性。
 */
function parseObjectLiteral(objLiteral: string): Map<string, TsValue> | null {
  const tokens = tokenizeTsLiteral(objLiteral);
  const parser = new TsLiteralParser(tokens);
  return parser.parseObject();
}

/**
 * 序列化 ResourceNode[] 为 TS locale 文件
 *
 * P5-2 写入侧切换（执行案 §4.2.2 / §4.3.3）——按 kindSchema.kind 路由到 9 个独立投影器：
 *   presentation.item / recipe / poi / enemy / terrain / itmk / tag / status / ui
 *
 * 投影器各自维护文件模板（interface / const / 辅助函数）与 codegen 工具，
 * adapter 仅负责路由。文件头统一生成 `// AUTO-GENERATED FROM oblivions/content/...` 注释。
 */
export function serializeTsLocale(
  nodes: ResourceNode[],
  kindSchema: KindSchema,
): SerializedTsFile[] {
  switch (kindSchema.kind) {
    case 'presentation.item':
      return projectItemLocale(nodes);
    case 'presentation.recipe':
      return projectRecipeLocale(nodes, kindSchema);
    case 'presentation.poi':
      return projectPoiLocale(nodes);
    case 'presentation.enemy':
      return projectEnemyLocale(nodes);
    case 'presentation.terrain':
      return projectTerrainDesc(nodes);
    case 'presentation.itmk':
      return projectItmkLocale(nodes);
    case 'presentation.tag':
      return projectTagLocale(nodes);
    case 'presentation.status':
      return projectStatusLocale(nodes, kindSchema);
    case 'presentation.ui':
      return projectUiLocale(nodes);
    default:
      return [];
  }
}

// ──────────────────────────────────────────────────────────────
// P5-2 写入侧切换完成：原内联 serializeItemLocale / serializeRecipeLocale
// 及其 codegen 工具（tsKey / tsString / stripUndefinedFields）已移除，
// 由 build/projectors/*-locale-projector.ts 独立维护文件模板与 codegen。
// ──────────────────────────────────────────────────────────────
