// @module O 内容工具箱
//
// 序列化库导出聚合（@/shared/serializer）
//
// 注意：php-array-parser 与 php-codegen 均定义了 PhpValue 类型（两者结构相同）。
// 为避免 `export *` 冲突，PhpValue 统一从 php-array-parser 导出；
// php-codegen 的其余导出在此显式列出（stripEditorFields 由 strip-editor-fields 再导出）。

export * from './php-array-parser';
export {
  type CodegenValue,
  type PhpCodegenOptions,
  generateMapPhp,
  generateRegionPhp,
  generateConfigPhp,
  generatePhpFile,
  valueToPhp,
  generateProjectFiles,
} from './php-codegen';
export * from './strip-editor-fields';
