/**
 * @module O 内容工具箱
 * @framework O-2 Schema 注册表
 *
 * Schema 注册表核心类型。每种资源 kind 通过 KindSchema 声明完整契约：
 * ID 规则、字段 schema、引用字段、presentation 字段、解析器/序列化器、
 * 校验规则、列表列、详情页分组、复制策略。
 *
 * P5 阶段新增 authorFormat / projectionTargets / adapterFormat 元数据，
 * 支持 O-11 内容单源编译：authorFormat 声明作者资源 YAML 文件位置，
 * projectionTargets 声明编译产物目标与投影器，adapterFormat 标记
 * 过渡期读取来源（YAML 优先 / PHP·TS fallback）。
 *
 * 新增资源种类的标准路径是"注册 schema + adapter + validator + projection"，
 * 而不是新增专用页面与专用 store。
 */

import type { FieldType } from '../shared/constants/schema';

/**
 * 首批 15 种资源 kind。
 * P0 阶段声明常量；P1-P4 逐步填充各 kind 的完整字段 schema。
 *
 * 注意：presentation.itmk / presentation.tag / presentation.status / presentation.ui /
 * presentation.skill / presentation.battle / presentation.log / presentation.feedback /
 * presentation.terrain 在 P3-P4 阶段按需追加，不在首批 15 种内。
 */
export const BUILTIN_KINDS = [
  'world.region',
  'world.tile',
  'item.template',
  'poi.template',
  'enemy.template',
  'recipe.template',
  'loot.table',
  'distribution.scatter',
  'distribution.poi',
  'distribution.enemy',
  'config.runtime',
  'presentation.item',
  'presentation.poi',
  'presentation.recipe',
  'presentation.enemy',
] as const;

export type ResourceKind = (typeof BUILTIN_KINDS)[number] | (string & {});

/**
 * 资源 kind 的来源文件描述。
 * 同一 kind 可能跨多个文件（如 item.template 来自 item_table.php，presentation.item 来自 item-locale.ts）。
 *
 * P5 阶段 format 新增 'yaml'——authorFormat.filePath 指向 oblivions/content/ 下的 YAML 作者资源，
 * sourceFiles 在过渡期保留 PHP/TS 路径作为 fallback（迁移完成后移除）。
 */
export interface SourceFileSpec {
  /** 文件路径模板，支持 ${id} 变量（如 `oblivions/gamedata/tiles/region_${id}.php`） */
  path: string;
  /** 文件格式 */
  format: 'php' | 'ts' | 'yaml';
  /** 适配器名称（在 O-4 adapter-registry 中注册） */
  parser: ParserName;
  /**
   * 该文件承载此 kind 资源的方式：
   * - single：整文件是单个资源（如 oblivions/gamedata/map.php → world.region:0/1）
   * - map-keyed：文件是 Map<id, entry>，每个 key 是一个资源（如 item_table.php）
   * - partitioned：文件按某种分区组织（如 scatter_pool.php 按 tide 桶 + phase）
   */
  load: 'single' | 'map-keyed' | 'partitioned';
  /**
   * 仅 load='single' 时生效——声明该单一节点的固定 ID。
   *
   * 设计意图：config.runtime 的节点 ID 必须是 'obl_config'（configStore.oblConfig
   * computed 按 ID 查找），但 php-adapter 的 single 模式默认生成 id='default'。
   * 通过 schema 显式声明 ID，让 adapter 尊重 schema 契约，避免 ID 不匹配导致
   * 派生 computed 找不到节点。
   *
   * 不指定时回退到 'default'（保持向后兼容）。
   */
  singleNodeId?: string;
}

/**
 * 适配器名称——在 adapter-registry 中路由。
 */
export type ParserName =
  | 'php-array'           // 标准 `return [...]` 或 `return array(...)`
  | 'php-global-var'      // `$var = array(...)` 全局变量赋值（enemies_config.php 唯一）
  | 'ts-locale'           // `export const XXX_LOCALE: Record<string, XxxEntry> = {...}`
  | 'ts-terrain-desc'     // terrain-desc.ts 复杂形态（P3 接入）
  | 'ts-status-locale'    // status-locale 内部常量形态（P3 接入）
  | 'php-function-def'    // combat_skills/skill_*.php 标记为代码模块，不解析内部
  | 'yaml';               // P5 作者资源 YAML 文件（oblivions/content/*.yaml）

/**
 * 引用字段声明——用于自动构建反向索引与删除保护。
 */
export interface RefFieldSpec {
  /** 字段路径（支持点号嵌套，如 `materials[].item_id`） */
  field: string;
  /** 引用目标的资源 kind */
  refKind: string;
  /** 引用目标的字段名（默认 'id'） */
  refField?: string;
  /** 是否必填（默认 false） */
  required?: boolean;
  /**
   * 引用类型——影响反向索引的边类型：
   * - direct：直接引用（item_id）
   * - tag：tag 性质引用
   * - itmk：itmk 类别引用
   * - loot_table：loot_table_id
   * - effect：use_effect 等效果引用
   */
  refType?: 'direct' | 'tag' | 'itmk' | 'loot_table' | 'effect';
}

/**
 * 呈现字段声明——用于 O-9 呈现工作区自动派生查询。
 */
export interface PresentationFieldSpec {
  /** 字段名 */
  field: string;
  /** 标记为呈现字段 */
  presentation: true;
  /** 是否已废弃（如 item_table.itm 已迁移至前端 locale） */
  deprecated?: boolean;
  /** 投影目标（如 `presentation.item.name`）——P5 单源编译使用 */
  projectTo?: string;
}

/**
 * 列表列声明——O-7 模板工作区中栏表格使用。
 */
export interface ListColumnSpec {
  /** 字段路径 */
  field: string;
  /** 列标题 i18n key */
  labelKey: string;
  /** 是否可排序 */
  sortable?: boolean;
  /** 是否可筛选 */
  filterable?: boolean;
  /** 是否默认可见 */
  defaultVisible?: boolean;
  /** 列宽（px） */
  width?: number;
}

/**
 * 详情页分组声明——O-7 右栏详情检查器使用。
 */
export interface DetailGroupSpec {
  /** 分组 ID */
  id: string;
  /** 分组标题 i18n key */
  labelKey: string;
  /** 分组包含的字段路径 */
  fields: string[];
  /** 默认折叠 */
  defaultCollapsed?: boolean;
}

/**
 * 校验器声明——绑定到 O-10 分层校验的某一层。
 */
export interface ValidatorSpec {
  /** rule ID（全局唯一，跨版本保持稳定） */
  ruleId: string;
  /** 校验层 */
  layer: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  /** 严重级别（二档，对齐 validate.ts 与 P6 §4.5.1 决策） */
  severity: 'error' | 'warning';
  /** 校验函数 ID（在 O-10 validators/ 中实现） */
  validatorFn: string;
  /** 阻断发布（P6 镜像校验扩展字段，P0 阶段不使用） */
  blocking?: boolean;
}

/**
 * 复制策略——O-7 模板工作区"复制资源"命令使用。
 */
export type CopyStrategy =
  | 'deep-clone'           // 默认深拷贝
  | 'clone-with-new-id'    // 深拷贝并要求新 ID
  | 'shallow-clone'        // 浅拷贝（仅顶层字段）
  | 'none';                // 不允许复制（只读资源，如 config.runtime）

/**
 * 作者资源文件格式描述（P5 O-11 单源编译）。
 *
 * 声明该 kind 的作者资源 YAML 文件位置与结构——content-compiler 按 authorFormat
 * 定位作者资源，逆向投影器（P5-4 迁移流程）按 authorFormat 写入 YAML。
 *
 * 设计意图：把"作者资源在哪里 / 顶层 key 是什么 / entry key 字段名"三项契约
 * 集中在 schema 中声明，避免投影器与迁移流程硬编码路径。
 */
export interface AuthorFormat {
  /** 作者资源文件格式——P5 阶段统一为 'yaml'，'json' 保留扩展 */
  format: 'yaml' | 'json';
  /** 作者资源文件路径（如 'oblivions/content/items/items.yaml'） */
  filePath: string;
  /** 顶层 key（如 'items'）；省略时文件顶层直接是 entry map */
  rootKey?: string;
  /** 每个 entry 的 key 字段名（如 'id'）；map-keyed load 下即 YAML key 本身 */
  itemKey: string;
}

/**
 * 编译产物投影目标（P5 O-11 单源编译）。
 *
 * 声明该 kind 投影到哪个编译产物文件、使用哪个投影器、PHP 文件头 @module 标签等
 * 元数据。投影器（P5-2）按 projectionTargets 派生 PHP/TS 输出。
 *
 * 字段顺序、对齐风格、分组注释等元数据由 projectionTargets 字段决定，
 * 保证字节稳定（PHP）与语义稳定（TS）的 round-trip 一致性。
 */
export interface ProjectionTarget {
  /** 编译产物类型——PHP gamedata / TS locale / TS terrain-desc（独立结构） */
  kind: 'php' | 'ts-locale' | 'ts-terrain';
  /** 编译产物路径（如 'oblivions/gamedata/item_table.php'） */
  filePath: string;
  /** 投影器模块路径（如 './projectors/item-table-projector'） */
  projector: string;
  /** PHP 文件头 @module 标签（如 'F 物品系统'）；TS 产物用 'K 状态管理层' */
  module: string;
  /** PHP 文件节标题块注释（如 'Oblivions 道具表'） */
  sectionTitle?: string;
  /** PHP 文件分组注释（如 '======== 基础道具 ========'） */
  groupSeparator?: string;
  /** 字段顺序（如 ['itm', 'itmk', 'itme', ...]）；投影器按此顺序输出字段 */
  fieldOrder?: string[];
  /** 字段对齐风格——'space-padded' 用空格补齐（如 `'itm'      =>`），'compact' 紧凑 */
  alignmentStyle?: 'space-padded' | 'compact';
}

/**
 * 当前 kind 的读取来源标记（P5 过渡期）。
 *
 * - 'yaml'：从 oblivions/content/ 下的 YAML 作者资源读取（P5 迁移完成后的事实源）
 * - 'php'：从 oblivions/gamedata/*.php 读取（过渡期 fallback）
 * - 'ts-locale'：从 vex-vue/src/data/*-locale.ts 读取（过渡期 fallback）
 *
 * 迁移流程（P5-4）逐 kind 切换 adapterFormat：php/ts-locale → yaml。
 * 迁移完成后所有 kind 的 adapterFormat 均为 'yaml'。
 */
export type AdapterFormat = 'yaml' | 'php' | 'ts-locale';

/**
 * KindSchema——某种资源 kind 的完整契约。
 *
 * 注册表是工具箱所有上层能力的统一入口——列表、详情、校验、构建、地图叠层
 * 都从同一份 schema 派生。
 *
 * 注：data 字段的强类型在 P1+ 阶段按 kind 单独定义 `XxxTemplateData` 后通过
 * 类型守卫或 schema-driven 解析器派生；P0 阶段统一为 unknown，避免引入未使用的泛型。
 */
export interface KindSchema {
  /** 资源 kind */
  kind: ResourceKind;
  /** ID 正则（新建/重命名必须先通过 pattern 校验） */
  idPattern: RegExp;
  /** 来源文件清单（多源） */
  sourceFiles: SourceFileSpec[];
  /** 适配器名称（与 sourceFiles[0].parser 一致，便于快速路由） */
  parser: ParserName;
  /** 字段 schema 列表（P1-P4 填充） */
  fields: FieldSchemaSpec[];
  /** 引用字段声明（P0 阶段必须提供最小 schema，否则引用校验无法从图查询） */
  refFields: RefFieldSpec[];
  /** 呈现字段声明（P0 标记 presentation 字段，供 O-9 派生查询） */
  presentationFields: PresentationFieldSpec[];
  /** 列表列（P2 填充） */
  listColumns: ListColumnSpec[];
  /** 详情页分组（P2 填充） */
  detailGroups: DetailGroupSpec[];
  /** 校验器声明（P2 填充完整，P0 仅引用校验最小集） */
  validators: ValidatorSpec[];
  /** 复制策略 */
  copyStrategy: CopyStrategy;
  /** 该 kind 是否在 P0 阶段已装配（用于总览页资源覆盖率统计） */
  p0Loaded?: boolean;
  /**
   * 序列化器名称（O-4 §4.3.2 写路径）。
   * 不指定时使用 parser 同名默认序列化器；指定时由 adapter-registry 路由到专用序列化器。
   * 例如：world.region → 'php-region'、world.tile → 'php-tile'。
   */
  serializer?: string;
  /**
   * 只读标志。true 时禁止通过 graph-store 编辑器修改字段（仅允许通过序列化器重建）。
   * 用于保护既有后端契约资源，如 config.runtime（obl_config.php）。
   */
  readOnly?: boolean;

  /**
   * 与该 kind 关联的辅助静态数据——schema 是契约 + 静态数据，不存放动态节点。
   *
   * 设计意图：某些 kind 的源文件除了主体 ResourceNode 数据外，还包含与该 kind
   * 强耦合的辅助常量（如 recipe-locale.ts 同时导出 RECIPE_LOCALE 与
   * RECIPE_CATEGORY_LABELS）。后者是 4 个固定 key 的中文标签字典，与
   * recipe.template.category 字段的 options 一一对应——新增 category 枚举值
   * 时必须同步更新 schema.fields 中 category 的 options 与 auxiliaryData.categoryLabels
   * 两处，由 O-10 第 6 层 `recipe_category_label_missing` 规则校验一致性。
   *
   * auxiliaryData 让 adapter 在 serialize 阶段可以从 schema 读取这些辅助数据
   * 重建完整文件，避免在 adapter 中硬编码业务数据。
   */
  auxiliaryData?: Record<string, unknown>;

  // —— P5 O-11 单源编译元数据 ——

  /**
   * 作者资源文件格式描述（P5 O-11）。
   *
   * 声明该 kind 的作者资源 YAML 文件位置——content-compiler 按 authorFormat
   * 定位作者资源，逆向投影器（P5-4 迁移流程）按 authorFormat 写入 YAML。
   *
   * effect.func 等"代码模块派生的虚拟节点"不需要 authorFormat——它们不是
   * 数据资源，不进入作者资源目录。
   * world.region / world.tile 有 authorFormat（声明 YAML 位置）但无
   * projectionTargets——P5 阶段由 P1 projectStore 管理，不进入编译产物。
   */
  authorFormat?: AuthorFormat;

  /**
   * 编译产物投影目标列表（P5 O-11）。
   *
   * 声明该 kind 投影到哪些编译产物文件——通常是一个 PHP 文件或一个 TS locale 文件。
   * 一个 kind 原则上只有一个 projectionTarget，但保留数组形态以支持未来
   * "一个 kind 投影到多个文件"的扩展场景。
   *
   * world.region / world.tile 在 P5 阶段无 projectionTargets——P1 projectStore 管理。
   * effect.func 无 projectionTargets——代码模块不是数据资源。
   */
  projectionTargets?: ProjectionTarget[];

  /**
   * 当前 kind 的读取来源标记（P5 过渡期）。
   *
   * - 'yaml'：从 oblivions/content/ 下的 YAML 作者资源读取（P5 迁移完成后的事实源）
   * - 'php'：从 oblivions/gamedata/*.php 读取（过渡期 fallback）
   * - 'ts-locale'：从 vex-vue/src/data/*-locale.ts 读取（过渡期 fallback）
   *
   * 未声明时由 adapter-registry 按 sourceFiles[0].format 推断——
   * P5-1 阶段所有 kind 默认仍走 PHP/TS fallback（adapterFormat 留空或为 'php'/'ts-locale'），
   * P5-4 迁移流程逐 kind 切换为 'yaml'。
   */
  adapterFormat?: AdapterFormat;
}

/**
 * 字段 schema 规格——扩展现有 FieldSchema，新增 visibleWhen / refKind / refField / presentation。
 *
 * 不直接复用 FieldSchema，避免破坏现有 4 个配置 schema 的兼容性。
 * O-2 注册表的字段定义通过 FieldSchemaSpec 表达，O-7 渲染时转换为 FieldSchema。
 */
export interface FieldSchemaSpec {
  /** 字段名（snake_case，对齐后端 PHP） */
  key: string;
  /** UI 显示标签（中文） */
  label: string;
  /** 字段类型 */
  type: FieldType;
  /** select 类型的选项 */
  options?: ReadonlyArray<{ value: string; label: string }>;
  /** 是否必填（默认 false） */
  required?: boolean;
  /** number 类型的最小值 */
  min?: number;
  /** number 类型的最大值 */
  max?: number;
  /** number 类型的步进 */
  step?: number;
  /** 占位符文案 */
  placeholder?: string;
  /** 默认值（新增条目时使用） */
  default?: unknown;
  /** 字段分组（基本 / E-10 三档判定 / 机制型 / E-12 耐久） */
  group?: string;
  /** 帮助文案 */
  description?: string;
  /** entry-list 子 schema（type='entry-list' 时必填） */
  itemSchema?: FieldSchemaSpec[];
  /** string-list 元素类型（默认 text） */
  itemType?: 'text' | 'select';
  /** string-list select 选项（itemType='select' 时） */
  itemOptions?: ReadonlyArray<{ value: string; label: string }>;
  /** kv-list 值类型（默认 text） */
  valueType?: 'text' | 'select';
  /** kv-list value select 选项（valueType='select' 时） */
  valueOptions?: ReadonlyArray<{ value: string; label: string }>;
  /** kv-list key 占位符 */
  keyPlaceholder?: string;
  /** kv-list value 占位符 */
  valuePlaceholder?: string;

  // —— O-2 扩展字段 ——

  /** 条件可见性表达式（如 `mechanic != ''`，仅在条件成立时显示） */
  visibleWhen?: string;
  /** 引用字段——目标资源 kind（与 refFields 互补，便于详情页渲染资源选择器） */
  refKind?: string;
  /** 引用字段——目标字段名（默认 'id'） */
  refField?: string;
  /** 标记为呈现字段（与 presentationFields 互补） */
  presentation?: boolean;
  /** 标记为已废弃（如 item_table.itm 已迁移至前端 locale） */
  deprecated?: boolean;
}
