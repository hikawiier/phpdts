/**
 * @module O 内容工具箱
 *
 * Schema 投影器——把 O-2 KindSchema 派生为 JSON Schema，用于约束 YAML 作者资源。
 *
 * 设计意图：
 *   - YAML 作者资源文件用 JSON Schema 约束，IDE 可自动补全与校验
 *   - 不重写 schema 定义——直接从 O-2 Schema Registry 派生，保持单一事实源
 *   - 派生是单向的：KindSchema → JSON Schema，反向不需要（作者编辑 YAML，
 *     经 JSON Schema 校验后进入 Resource Graph，再由投影器生成 PHP/TS）
 *
 * 派生规则：
 *   - authorFormat.rootKey → JSON Schema 顶层 properties[rootKey]
 *   - fields[] → entry properties 的字段（按 FieldType 映射到 JSON Schema type）
 *   - required 字段标记为 required 数组
 *   - sourceFiles[0].load 决定 entries 容器形态：
 *     * single → rootKey 值是单个 entry
 *     * map-keyed → rootKey 值是 Map<id, entry>，key 匹配 idPattern
 *     * partitioned → rootKey 值是 Map<tide, Map<id, entry>>（distribution.* tide 桶）
 *
 * 边界：
 *   - effect.func / world.region / world.tile 等无 authorFormat 的 kind 不投影（返回 null）
 *   - partitioned load（distribution.*）的 tide 桶名不强制 enum——
 *     具体桶名约束由 O-10 第 6 层校验
 *   - terrain-desc 等独立结构投影器暂不在此处派生——terrain 结构复杂
 *     （嵌套词库 + FloorType/TideType 类型别名），需要 P5-2 阶段独立实现
 *     terrainSchemaProjection
 *   - idPattern 含 i/m/s 标志时跳过 patternProperties——JSON Schema pattern
 *     是 ECMA 262 正则子集，不支持这些标志
 */

import type { KindSchema, FieldSchemaSpec } from '../schema/types';

/**
 * JSON Schema 节点——最小化类型，避免引入 json-schema-draft-07 类型包
 *
 * 仅声明派生器用到的字段，调用方（如 IDE 校验）按标准 JSON Schema Draft 07 消费。
 */
export interface JsonSchema {
  type?: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema | JsonSchema[];
  required?: string[];
  enum?: unknown[];
  additionalProperties?: boolean | JsonSchema;
  description?: string;
  title?: string;
  pattern?: string;
  patternProperties?: Record<string, JsonSchema>;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  oneOf?: JsonSchema[];
  /** JSON Schema Draft 07 声明 */
  $schema?: string;
  /** schema 文件 ID（如 'oblivions/content/_schemas/item-template.schema.json'） */
  $id?: string;
}

const JSON_SCHEMA_DRAFT_URL = 'http://json-schema.org/draft-07/schema#';

/**
 * 把 O-2 KindSchema 派生为 JSON Schema，用于约束 YAML 作者资源。
 *
 * @param kindSchema 资源 kind 的 schema 契约
 * @returns JSON Schema 对象；无 authorFormat 时返回 null（如 effect.func / world.region）
 */
export function projectSchemaToJsonSchema(kindSchema: KindSchema): JsonSchema | null {
  const authorFormat = kindSchema.authorFormat;
  if (!authorFormat) return null;

  const entrySchema = buildEntrySchema(kindSchema);
  const entriesSchema = buildEntriesSchema(kindSchema, entrySchema);

  const title = `${kindSchema.kind} 作者资源 schema`;
  const $id = buildSchemaId(kindSchema);

  // 包装到 rootKey 下（若声明）
  if (authorFormat.rootKey) {
    return {
      $schema: JSON_SCHEMA_DRAFT_URL,
      $id,
      title,
      type: 'object',
      properties: {
        [authorFormat.rootKey]: entriesSchema,
      },
      additionalProperties: false,
    };
  }

  // 无 rootKey：顶层直接是 entriesSchema
  return {
    $schema: JSON_SCHEMA_DRAFT_URL,
    $id,
    title,
    ...entriesSchema,
  };
}

/**
 * 构建 schema $id——按 kind 派生文件路径（如 'item.template' → item-template.schema.json）
 */
function buildSchemaId(kindSchema: KindSchema): string {
  const fileName = kindSchema.kind.replace(/\./g, '-');
  return `oblivions/content/_schemas/${fileName}.schema.json`;
}

/**
 * 构建"entries 容器"的 JSON Schema——按 sourceFiles[0].load 决定形态。
 *
 * - single：rootKey 值直接是单个 entry（如 config.runtime）
 * - map-keyed：Map<id, entry>，key 应匹配 idPattern（patternProperties 约束）
 * - partitioned：Map<tide, Map<id, entry>>（distribution.* 按 tide 桶分组）
 */
function buildEntriesSchema(
  kindSchema: KindSchema,
  entrySchema: JsonSchema,
): JsonSchema {
  const spec = kindSchema.sourceFiles[0];
  if (!spec) {
    // 无 sourceFiles 描述：退化为 map-keyed 形态
    return {
      type: 'object',
      additionalProperties: entrySchema,
    };
  }

  switch (spec.load) {
    case 'single':
      // single 模式：rootKey 值直接是单个 entry
      return entrySchema;

    case 'map-keyed': {
      // map-keyed 模式：Map<id, entry>——key 应匹配 idPattern
      const result: JsonSchema = {
        type: 'object',
        additionalProperties: entrySchema,
      };
      const patternProperties = buildIdPatternProperties(kindSchema);
      if (patternProperties) {
        result.patternProperties = patternProperties;
      }
      return result;
    }

    case 'partitioned':
      // partitioned 模式（distribution.*）：按顶层 key 分桶（tide）
      // P5-1 阶段不强制 tide 桶名 enum——具体桶名约束由 O-10 第 6 层校验
      return {
        type: 'object',
        additionalProperties: {
          type: 'object',
          additionalProperties: entrySchema,
        },
      };

    default:
      return {
        type: 'object',
        additionalProperties: entrySchema,
      };
  }
}

/**
 * 构建 id 模式匹配的 patternProperties——把 idPattern 转为 JSON Schema pattern 字符串。
 *
 * 注意：JSON Schema pattern 是 ECMA 262 正则子集，不支持 i/m/s 标志——
 * 若 idPattern 含这些标志，跳过 patternProperties（不约束 key 格式）。
 */
function buildIdPatternProperties(
  kindSchema: KindSchema,
): Record<string, JsonSchema> | undefined {
  const pattern = idPatternToPatternString(kindSchema.idPattern);
  if (!pattern) return undefined;
  return {
    [pattern]: {
      description: `${kindSchema.kind} ID（匹配 ${pattern}）`,
    },
  };
}

function idPatternToPatternString(re: RegExp): string | undefined {
  const flags = re.flags;
  if (flags.includes('i') || flags.includes('m') || flags.includes('s')) {
    return undefined;
  }
  return re.source;
}

/**
 * 构建单个 entry 的 JSON Schema——按 fields[] 派生字段。
 */
function buildEntrySchema(kindSchema: KindSchema): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];

  for (const field of kindSchema.fields) {
    properties[field.key] = buildFieldSchema(field);
    if (field.required) {
      required.push(field.key);
    }
  }

  const entrySchema: JsonSchema = {
    type: 'object',
    description: `${kindSchema.kind} entry`,
    properties,
    // 允许扩展字段（如运行时附加的状态字段、投影器需要的元数据字段）
    additionalProperties: true,
  };
  if (required.length > 0) {
    entrySchema.required = required;
  }
  return entrySchema;
}

/**
 * 把 FieldSchemaSpec 派生为字段级 JSON Schema。
 *
 * FieldType → JSON Schema type 映射：
 *   - text            → { type: 'string' }
 *   - number          → { type: 'number', minimum?, maximum? }
 *   - boolean         → { type: 'boolean' }
 *   - select          → { type: 'string', enum: options.values }
 *   - json            → {}（任意类型，不约束）
 *   - count-range     → oneOf[number, [number, number]]（int 或 [min,max] 区间）
 *   - string-list     → { type: 'array', items: string | select-string }
 *   - kv-list         → { type: 'object', additionalProperties: value-schema }
 *   - entry-list      → { type: 'array', items: <itemSchema-derived> }
 *   - ref             → { type: 'string' }
 *   - ref-list        → { type: 'array', items: { type: 'string' } }
 */
function buildFieldSchema(field: FieldSchemaSpec): JsonSchema {
  const schema = fieldTypeToJsonSchema(field);
  if (field.description) {
    schema.description = field.description;
  }
  if (field.label) {
    schema.title = field.label;
  }
  return schema;
}

function fieldTypeToJsonSchema(field: FieldSchemaSpec): JsonSchema {
  switch (field.type) {
    case 'text':
      return { type: 'string' };

    case 'number': {
      const schema: JsonSchema = { type: 'number' };
      if (field.min !== undefined) schema.minimum = field.min;
      if (field.max !== undefined) schema.maximum = field.max;
      return schema;
    }

    case 'boolean':
      return { type: 'boolean' };

    case 'select': {
      const values = field.options?.map((opt) => opt.value) ?? [];
      return values.length > 0
        ? { type: 'string', enum: values }
        : { type: 'string' };
    }

    case 'json':
      // 不约束——任意 JSON 值
      return {};

    case 'count-range':
      // count 字段：number 或 [min, max] 区间（与 php-adapter 多态对齐）
      return {
        oneOf: [
          { type: 'number' },
          {
            type: 'array',
            items: [{ type: 'number' }, { type: 'number' }],
            minItems: 2,
            maxItems: 2,
          },
        ],
      };

    case 'string-list': {
      const itemSchema: JsonSchema =
        field.itemType === 'select' && field.itemOptions
          ? { type: 'string', enum: field.itemOptions.map((opt) => opt.value) }
          : { type: 'string' };
      return { type: 'array', items: itemSchema };
    }

    case 'kv-list': {
      // kv-list 是 Map<key, value>——key/value 类型由 valueType/valueOptions 决定
      const valueSchema: JsonSchema =
        field.valueType === 'select' && field.valueOptions
          ? { type: 'string', enum: field.valueOptions.map((opt) => opt.value) }
          : { type: 'string' };
      return {
        type: 'object',
        additionalProperties: valueSchema,
      };
    }

    case 'entry-list': {
      if (!field.itemSchema || field.itemSchema.length === 0) {
        return { type: 'array', items: {} };
      }
      // 把 itemSchema（FieldSchemaSpec[]）递归派生为 JsonSchema
      const itemJsonSchema = fieldSchemaArrayToJsonSchema(field.itemSchema);
      return { type: 'array', items: itemJsonSchema };
    }

    case 'ref':
      // ref 字段是单值字符串（资源 ID）
      return { type: 'string' };

    case 'ref-list':
      // ref-list 是 ID 数组
      return { type: 'array', items: { type: 'string' } };

    default:
      return {};
  }
}

/**
 * 把 FieldSchemaSpec[]（递归）派生为 JsonSchema object。
 *
 * 用于 entry-list 的 itemSchema 派生——递归处理嵌套 entry-list。
 */
function fieldSchemaArrayToJsonSchema(fields: FieldSchemaSpec[]): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];

  for (const field of fields) {
    properties[field.key] = buildFieldSchema(field);
    if (field.required) {
      required.push(field.key);
    }
  }

  const schema: JsonSchema = {
    type: 'object',
    properties,
    additionalProperties: true,
  };
  if (required.length > 0) {
    schema.required = required;
  }
  return schema;
}
