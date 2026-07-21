// ══════════════════════════════════════════════════
// PHP 数组解析器 / PHP array parser
// 将 PHP return [...] 格式解析为 JS 对象
// ══════════════════════════════════════════════════
// @module O

/**
 * 解析 PHP 文件内容，提取 return 语句中的数组
 * @param {string} phpCode - PHP 文件完整内容
 * @returns {object|null} 解析出的 JS 对象
 */
export function parsePhpArray(phpCode) {
  // 提取 return [...] 中的内容
  const returnMatch = phpCode.match(/return\s*\[/s);
  if (!returnMatch) return null;

  const startIdx = phpCode.indexOf('[', phpCode.indexOf('return'));
  if (startIdx === -1) return null;

  // 找到匹配的闭合括号
  let depth = 0;
  let endIdx = -1;
  for (let i = startIdx; i < phpCode.length; i++) {
    if (phpCode[i] === '[') depth++;
    else if (phpCode[i] === ']') {
      depth--;
      if (depth === 0) {
        endIdx = i;
        break;
      }
    }
  }
  if (endIdx === -1) return null;

  const arrayContent = phpCode.substring(startIdx, endIdx + 1);
  return parseArrayString(arrayContent);
}

/**
 * 解析 PHP 数组字符串为 JS 对象
 */
function parseArrayString(str) {
  const tokens = tokenize(str);
  const parser = new TokenParser(tokens);
  return parser.parseValue();
}

/**
 * 简易词法分析
 */
function tokenize(str) {
  const tokens = [];
  let i = 0;

  while (i < str.length) {
    // 跳过空白
    if (/\s/.test(str[i])) { i++; continue; }

    // 单行注释
    if (str[i] === '/' && str[i + 1] === '/') {
      while (i < str.length && str[i] !== '\n') i++;
      continue;
    }

    // 多行注释
    if (str[i] === '/' && str[i + 1] === '*') {
      i += 2;
      while (i < str.length - 1 && !(str[i] === '*' && str[i + 1] === '/')) i++;
      i += 2;
      continue;
    }

    // 标点
    if ('[](),:=>'.includes(str[i])) {
      // 处理 => 作为一个 token
      if (str[i] === '=' && str[i + 1] === '>') {
        tokens.push({ type: 'ARROW', value: '=>' });
        i += 2;
        continue;
      }
      tokens.push({ type: 'PUNCT', value: str[i] });
      i++;
      continue;
    }

    // 字符串（单引号）
    if (str[i] === "'") {
      let val = '';
      i++;
      while (i < str.length && str[i] !== "'") {
        if (str[i] === '\\' && str[i + 1] === "'") {
          val += "'";
          i += 2;
        } else if (str[i] === '\\' && str[i + 1] === '\\') {
          val += '\\';
          i += 2;
        } else {
          val += str[i];
          i++;
        }
      }
      i++; // skip closing quote
      tokens.push({ type: 'STRING', value: val });
      continue;
    }

    // 字符串（双引号）
    if (str[i] === '"') {
      let val = '';
      i++;
      while (i < str.length && str[i] !== '"') {
        if (str[i] === '\\' && str[i + 1] === '"') {
          val += '"';
          i += 2;
        } else if (str[i] === '\\' && str[i + 1] === '\\') {
          val += '\\';
          i += 2;
        } else {
          val += str[i];
          i++;
        }
      }
      i++;
      tokens.push({ type: 'STRING', value: val });
      continue;
    }

    // 数字
    if (/-?\d/.test(str[i]) || (str[i] === '-' && /\d/.test(str[i + 1]))) {
      let num = '';
      if (str[i] === '-') { num += '-'; i++; }
      while (i < str.length && /[\d.]/.test(str[i])) {
        num += str[i];
        i++;
      }
      tokens.push({ type: 'NUMBER', value: parseFloat(num) });
      continue;
    }

    // 关键字 / 标识符
    if (/[a-zA-Z_]/.test(str[i])) {
      let word = '';
      while (i < str.length && /[a-zA-Z0-9_]/.test(str[i])) {
        word += str[i];
        i++;
      }
      if (word === 'true' || word === 'TRUE') {
        tokens.push({ type: 'BOOL', value: true });
      } else if (word === 'false' || word === 'FALSE') {
        tokens.push({ type: 'BOOL', value: false });
      } else if (word === 'null' || word === 'NULL') {
        tokens.push({ type: 'NULL', value: null });
      } else {
        tokens.push({ type: 'IDENT', value: word });
      }
      continue;
    }

    // 跳过未知字符
    i++;
  }

  return tokens;
}

/**
 * Token 流解析器
 */
class TokenParser {
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
  }

  peek() {
    return this.pos < this.tokens.length ? this.tokens[this.pos] : null;
  }

  consume() {
    return this.pos < this.tokens.length ? this.tokens[this.pos++] : null;
  }

  expect(type, value) {
    const tok = this.consume();
    if (!tok || tok.type !== type || (value !== undefined && tok.value !== value)) {
      // 宽容模式：不抛异常
      return null;
    }
    return tok;
  }

  parseValue() {
    const tok = this.peek();
    if (!tok) return null;

    switch (tok.type) {
      case 'PUNCT':
        if (tok.value === '[') return this.parseArray();
        break;
      case 'STRING':
        this.consume();
        return tok.value;
      case 'NUMBER':
        this.consume();
        return tok.value;
      case 'BOOL':
        this.consume();
        return tok.value;
      case 'NULL':
        this.consume();
        return null;
    }
    return null;
  }

  parseArray() {
    this.expect('PUNCT', '[');

    // 检测是关联数组还是索引数组
    // 先预读，看是否有 => 模式
    const items = [];
    let isAssoc = false;

    while (this.peek() && !(this.peek().type === 'PUNCT' && this.peek().value === ']')) {
      const key = this.parseValue();
      if (key === null && this.peek() && this.peek().type === 'PUNCT' && this.peek().value === ']') break;

      // 检查是否有 =>
      const nextTok = this.peek();
      if (nextTok && nextTok.type === 'ARROW') {
        isAssoc = true;
        this.consume(); // skip =>
        const val = this.parseValue();
        items.push({ key, value: val });
      } else {
        // 索引数组元素
        items.push({ key: items.length, value: key });
      }

      // 跳过逗号
      if (this.peek() && this.peek().type === 'PUNCT' && this.peek().value === ',') {
        this.consume();
      }
    }

    this.expect('PUNCT', ']');

    if (isAssoc) {
      const obj = {};
      for (const item of items) {
        obj[item.key] = item.value;
      }
      return obj;
    }
    return items.map(item => item.value);
  }
}

/**
 * 解析 map.php 内容
 */
export function parseMapPhp(phpCode) {
  const data = parsePhpArray(phpCode);
  if (!data) return null;
  return {
    regions: data.regions || {},
    grids: data.grids || {},
  };
}

/**
 * 解析 region_*.php 内容
 * 返回 { pgroup: { pls: tileData } } 结构
 * 需要外部传入 pgroup，因为文件名中包含此信息
 */
export function parseRegionPhp(phpCode, pgroup) {
  const data = parsePhpArray(phpCode);
  if (!data) return null;
  return { pgroup, tiles: data };
}

/**
 * 从 PHP 文件名中提取 pgroup
 * 如 region_1.php → 1
 */
export function extractPgroupFromFilename(filename) {
  const match = filename.match(/region_(\d+)/);
  return match ? parseInt(match[1]) : null;
}
