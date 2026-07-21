# editor-next 独立化与备份还原功能 设计案

> 日期：2026-07-22
> 范围：editor-next 解耦独立化 + 4 个新增功能（读取/导出/备份/还原）
> 前置依赖：editor-next-纯前端化与视觉精简-设计案-2026-07-22.md（已完成）

---

## 一、当前问题

### 1.1 目录污染

`oblivions/` 根目录被 6 个 npm/workspace 产物污染：

| 文件/目录 | 性质 | 问题 |
|---|---|---|
| `oblivions/package.json` | workspace 根 manifest | 让 oblivions/ 变成 npm workspace 根 |
| `oblivions/pnpm-workspace.yaml` | workspace 声明 | 声明 shared + editor-next 为 workspace 子包 |
| `oblivions/pnpm-lock.yaml` | 依赖锁文件 | workspace 级依赖锁定 |
| `oblivions/node_modules/` | 依赖产物 | pnpm 安装产物（当前磁盘不存在，但 .gitignore 已忽略） |
| `oblivions/shared/` | 共享子包 | 编辑器与 vex-vue 共享类型/算法/常量（vex-vue 实际未接入） |
| `oblivions/editor-next/` | 编辑器子包 | 地图编辑器本体 |

### 1.2 框架级依赖关系

editor-next 与 shared 通过 3 层耦合绑定：

1. **pnpm-workspace.yaml**：声明两者为同一 workspace 子包
2. **editor-next/package.json**：`"@oblivions/shared": "workspace:*"` 协议依赖
3. **vite.config.ts + tsconfig.json**：相对路径 `../shared/src` 直接指向 shared 源码（运行时真正解析路径）

editor-next 在 Dian.md 中作为**模块 O** 被框架级纳入：
- 模块 O 包含 5 框架（O-0~O-4），72 处 `oblivions/editor-next` 路径引用
- 但 DESIGN.md 全文未提及 editor-next / monorepo / workspace
- DESIGN.md 2.12 节写"模块 A-N"未包含 O——存在文档失同步

### 1.3 git 状态割裂

根 `.gitignore` 整体忽略 `/oblivions/editor-next` 和 `/oblivions/shared`（源码不入库），但保留 oblivions/ 根的 workspace 配置文件——造成"配置在仓库内、源码在仓库外"的割裂状态。

### 1.4 配置文件支持不全

gamedata/ 下共 15 个 PHP 文件 + `tiles/`（2 个）+ `combat_skills/`（9 个），编辑器当前仅支持：
- **读写**：map.php + tiles/region_*.php + scatter_pool.php + poi_table.php + poi_pool.php
- **只读**：obl_config.php
- **未支持**：其余 11 个配置文件 + combat_skills/*.php

### 1.5 备份/还原功能缺失

- **备份**：仅在"快速写回源目录"时下载备份 ZIP（前缀 `oblivions_backup_`），是写回的副产物，无独立入口，且只覆盖编辑器支持的文件
- **还原**：完全不存在。`unzipBundle` 函数（zip-bundle.ts #L44-L59）是孤儿代码，未接线

---

## 二、目标行为

### 2.1 解耦与独立化

1. **editor-next 成为完全自包含的独立工具**：shared 内联进 editor-next/src/shared/，删除 oblivions/ 根的 workspace 配置文件
2. **oblivions/ 目录不再有 workspace 污染**：删除 package.json / pnpm-workspace.yaml / pnpm-lock.yaml / shared/ / node_modules/
3. **Dian.md 不再包含模块 O**：editor-next 不再是 Oblivions 框架的一部分，不受双向锚点契约约束
4. **editor-next 内部维护自己的文档**：在 editor-next/ 下创建 README.md 承载设计意图

### 2.2 4 个新增功能

| 功能 | 入口 | 行为 |
|---|---|---|
| **a. 一键读取** | ImportModal 默认 Tab | 通过 FSAA 选择 oblivions/gamedata/ 目录，读取所有 .php 文件，解析支持的文件，其他作为原始字符串缓存 |
| **b. 一键导出** | ExportModal 主按钮 | 通过 FSAA 选择/复用 gamedata/ 目录，写入所有文件（编辑器生成的 + 缓存的原始文件），写入前自动备份 |
| **c. 一键备份** | TopBar 独立按钮 | 通过 FSAA 选择 gamedata/ 源目录 + oblivions/gamedata/backup/ 目标目录，创建时间戳子目录，复制所有 .php 文件（保持目录结构） |
| **d. 一键还原** | ImportModal "从备份还原" Tab | 选择 oblivions/gamedata/backup/ 目录 → 列出时间戳子目录供用户选择 → 选择目标 gamedata 目录 → 还原前自动备份当前状态 → 复制备份文件到目标目录 |

---

## 三、任务分解

### 阶段 1：解耦与独立化

#### 任务 A：shared 内联进 editor-next

**目标**：把 `oblivions/shared/src/*` 移到 `oblivions/editor-next/src/shared/*`，消除 workspace 耦合。

**步骤**：

1. **移动源码**：把 `oblivions/shared/src/` 下的 4 个子目录（algorithms / constants / serializer / types）+ index.ts 移到 `oblivions/editor-next/src/shared/`
2. **更新 import 路径**：editor-next/src 中 39 个文件、64 处 `@oblivions/shared` 引用改为 `@/shared`（已被 `@` alias 覆盖，无需新增 alias）
3. **更新 shared 内部自引用**：shared/src 中 5 处 `@oblivions/shared` 自引用（index.ts 桶导出）改为相对路径
4. **更新 editor-next/package.json**：移除 `"@oblivions/shared": "workspace:*"` 依赖
5. **更新 vite.config.ts**：移除 `'@oblivions/shared': fileURLToPath(new URL('../shared/src', import.meta.url))` alias
6. **更新 tsconfig.json**：移除 `"@oblivions/shared": ["../shared/src/index.ts"]` 和 `"@oblivions/shared/*": ["../shared/src/*"]` paths
7. **更新 vitest.config.ts**：如果有 `@oblivions/shared` alias 也移除
8. **移动测试**：把 `oblivions/shared/tests/` 移到 `oblivions/editor-next/src/shared/__tests__/` 或 `oblivions/editor-next/tests/shared/`
9. **删除 oblivions/shared/ 整个目录**
10. **删除 oblivions/package.json**
11. **删除 oblivions/pnpm-workspace.yaml**
12. **删除 oblivions/pnpm-lock.yaml**
13. **删除 oblivions/node_modules/**（如果存在）
14. **在 editor-next/ 下执行 `pnpm install`** 重新生成独立的 node_modules

**影响范围**：
- editor-next/src/（39 个文件 import 路径变更）
- editor-next/src/shared/（新增，从 shared/src 移入）
- editor-next/package.json（移除 workspace 依赖）
- editor-next/vite.config.ts（移除 alias）
- editor-next/tsconfig.json（移除 paths）
- editor-next/vitest.config.ts（如有 alias）
- oblivions/shared/（删除）
- oblivions/package.json（删除）
- oblivions/pnpm-workspace.yaml（删除）
- oblivions/pnpm-lock.yaml（删除）

**不变量**：
- editor-next 的功能不退化（所有 import 路径变更后语义不变）
- 类型检查通过
- 测试通过

---

#### 任务 B：移除 Dian.md 模块 O + 更新 validate_design_anchors.php

**目标**：editor-next 不再是 Dian.md 中的模块，不受双向锚点契约约束。

**步骤**：

1. **更新 Dian.md 第 1.1 节顶层模块划分表**（L163）：移除"地图编辑器"行
2. **删除 Dian.md 模块 O 整章**（L1368-L1460，包含 O-0~O-4 共 5 个框架）
3. **移除所有 editor-next 源文件中的 `@module O` / `@framework O-*` 标签**：
   - editor-next/src/ 下所有 .ts/.vue 文件的头部注释
   - 预计约 50+ 个文件需要清理标签（保留注释本身，只删 `@module` / `@framework` 行）
4. **更新 validate_design_anchors.php**：
   - `scanSourceFiles()`：移除 `oblivions/shared/src` 和 `oblivions/editor-next/src` 两个扫描根
   - `isExcludedPath()`：移除 `oblivions/editor-next/` 相关排除规则
   - `isSupportedAnchorExtension()`：移除 `oblivions/editor-next/` 和 `oblivions/shared/` 相关分支
5. **更新 .gitignore**：
   - 移除 `/oblivions/editor-next` 整体忽略（L131）—— editor-next 源码应入库
   - 移除 `/oblivions/shared` 整体忽略（L135）—— shared 已内联，目录已删
   - 保留 `node_modules/` 忽略（L121、L145）
   - 新增 `/oblivions/editor-next/node_modules/` 显式忽略（如需）
6. **运行 validate_design_anchors.php** 确认零错误

**影响范围**：
- oblivions/Dian.md（删除模块 O 章节 + 更新顶层模块表）
- oblivions/tools/validate_design_anchors.php（移除 editor-next/shared 扫描）
- editor-next/src/（50+ 文件清理 @module / @framework 标签）
- .gitignore（更新忽略规则）

**不变量**：
- validate_design_anchors.php 对 oblivions 后端 + vex-vue 的校验不退化
- editor-next 源码功能不变（只删标签不删代码）

---

#### 任务 C：editor-next 内部文档

**目标**：在 editor-next/ 下创建 README.md，承载原 Dian.md 模块 O 的核心设计意图。

**步骤**：

1. **创建 `oblivions/editor-next/README.md`**：
   - 项目定位（纯前端地图编辑器，读取本地静态 gamedata）
   - 技术栈（Vue 3 + Vite 6 + TypeScript 5.7 + Pinia 2.3 + Tailwind v4）
   - 开发命令（pnpm install / pnpm dev / pnpm build / pnpm test）
   - 目录结构概览（src/shared/ 内联共享库 + src/ 编辑器本体）
   - 核心设计原则（对齐 DESIGN.md 2.13/2.14/2.15/3.4，但作为参考而非约束）
   - 与 oblivions 后端的关系（纯前端工具，仅读写 gamedata PHP 文件，不触碰 DB）

**影响范围**：
- oblivions/editor-next/README.md（新增）

**不变量**：
- 不重复 DESIGN.md / Dian.md 的内容，只承载 editor-next 特有的设计意图

---

### 阶段 2：4 个新增功能

#### 任务 D：扩展配置文件支持（全量原始字符串保留）

**目标**：新增"原始文件缓存"机制，读取 gamedata/ 下所有 .php 文件，编辑器只解析支持的文件，其他作为原始字符串保留，用于备份/还原/导出。

**设计**：

1. **新增 `rawFilesStore`**（或扩展 projectStore）：
   ```typescript
   // rawFilesStore.ts
   state: {
     rawFiles: Record<string, string>;  // 相对路径 → 原始字符串
     sourceDirHandle: FileSystemDirectoryHandle | null;
   }
   actions: {
     setRawFiles(files: Record<string, string>): void;
     clearRawFiles(): void;
     getRawFile(path: string): string | undefined;
     getAllFiles(): Record<string, string>;  // 合并 rawFiles + 编辑器生成的文件
   }
   ```

2. **读取流程**（useImportExport.parseFilesToProject 扩展）：
   - readPhpFilesFromDirectory 已支持递归读取所有 .php
   - 解析 map.php + tiles/region_*.php → projectStore
   - 解析 scatter_pool/poi_table/poi_pool + obl_config → configStore
   - 其他 .php 文件 → rawFilesStore.rawFiles（原始字符串缓存）

3. **导出流程**（useImportExport 扩展）：
   - 生成 map.php + tiles/region_*.php → projectStore + php-codegen
   - 生成 scatter_pool/poi_table/poi_pool → configStore.toPhpFiles()
   - obl_config + 其他配置文件 → rawFilesStore.rawFiles（原样写出）
   - 合并所有文件 → 写入目录或打包 ZIP

**影响范围**：
- editor-next/src/stores/rawFilesStore.ts（新增）
- editor-next/src/composables/useImportExport.ts（扩展 parseFilesToProject + exportZip + writeBackToSource）
- editor-next/src/stores/projectStore.ts（可能调整 sourceDirHandle 移到 rawFilesStore）

**不变量**：
- 编辑器仅读写 gamedata PHP 文件，不触碰 DB
- 现有编辑能力（map/tiles/4 个配置）不退化
- 原始字符串缓存在导入时建立，导出时原样写出（round-trip 一致性）

---

#### 任务 E：功能 a - 一键从 obl 后端目录读取

**目标**：把"从 gamedata 目录读取"作为 ImportModal 最显著的入口。

**步骤**：

1. **调整 ImportModal Tab 顺序**：
   - 当前 4 Tab：directory / webkitdirectory / paste / drop
   - 调整为：directory（默认，突出显示）→ drop → webkitdirectory → paste
   - 或合并 directory + webkitdirectory 为单一"选择目录"Tab（FSAA 不可用时自动回退）

2. **directory Tab 文案优化**：
   - 标题："从 gamedata 目录读取"
   - 提示："选择 oblivions/gamedata 目录（含 map.php + tiles/ + 配置文件）"
   - 按钮文案："选择 gamedata 目录"

3. **读取逻辑**（复用现有 importFromDirectory）：
   - 调用 pickDirectory('readwrite') → 读取所有 .php → parseFilesToProject（扩展后支持全量缓存）
   - 成功后提示"已读取 N 个文件（M 个解析，K 个原始缓存）"

**影响范围**：
- editor-next/src/components/modals/ImportModal.vue（Tab 顺序 + 文案）
- editor-next/src/composables/useImportExport.ts（importFromDirectory 提示信息）

**不变量**：
- 不改变 FSAA + webkitdirectory 回退机制
- 不改变粘贴/拖拽导入能力

---

#### 任务 F：功能 b - 一键向 obl 后端目录导出

**目标**：在 ExportModal 提供"向 gamedata 目录写入"主按钮，支持全量文件写入。

**步骤**：

1. **ExportModal 改造**：
   - 当前 2 按钮：导出 ZIP / 快速写回源目录
   - 调整为 3 按钮：
     - **写入 gamedata 目录**（主按钮，突出显示）
     - 导出 ZIP
     - 备份 gamedata 目录（功能 c）

2. **"写入 gamedata 目录"逻辑**：
   - 如果有 sourceDirHandle（FSAA 导入后可用）→ 直接写回
   - 如果没有 sourceDirHandle → 提示选择目录（pickDirectory('readwrite')）
   - 写入前自动备份（调用功能 c 的备份逻辑，下载备份 ZIP）
   - 写入范围：map.php + tiles/region_*.php + scatter_pool/poi_table/poi_pool + obl_config + 其他原始缓存文件
   - 成功后提示"已写入 N 个文件，旧文件已备份下载"

3. **writeBackToSource 扩展**：
   - 当前只写入 map.php + tiles/region_*.php
   - 扩展为写入所有文件（编辑器生成的 + rawFilesStore 缓存的）

**影响范围**：
- editor-next/src/components/modals/ExportModal.vue（按钮调整 + 新逻辑）
- editor-next/src/composables/useImportExport.ts（writeBackToSource 扩展）

**不变量**：
- 写入前必须备份（避免数据丢失）
- 写入失败时回滚（或至少保留备份 ZIP）

---

#### 任务 G：功能 c - 一键备份 obl 后端目录

**目标**：新增独立的"备份"入口，把 gamedata/ 下所有 .php 文件备份到 `oblivions/gamedata/backup/{timestamp}/` 目录。

**设计**：

1. **备份目录固定为 `oblivions/gamedata/backup/`**：
   - 用户通过 FSAA 选择 gamedata 源目录（只读）
   - 用户通过 FSAA 选择 backup 目标目录（读写，应为 `oblivions/gamedata/backup/`）
   - 编辑器在 backup 目录下创建时间戳子目录（格式 `YYYYMMDD_HHMMSS`，如 `20260722_173747`）

2. **新增 `backupGamedata` 函数**（useImportExport）：
   ```typescript
   async function backupGamedata(): Promise<void> {
     // 1. 选择 gamedata 源目录（只读）
     const sourcePicker = await pickDirectory('read');
     
     // 2. 选择 backup 目标目录（读写）
     const backupPicker = await pickDirectory('readwrite');
     
     // 3. 创建时间戳子目录
     const timestamp = formatBackupTimestamp(new Date());  // YYYYMMDD_HHMMSS
     const backupDirHandle = await backupPicker.handle.getDirectoryHandle(timestamp, { create: true });
     
     // 4. 读取源目录所有 .php 文件
     const files = await readPhpFilesFromDirectory(sourcePicker.handle);
     
     // 5. 写入到备份子目录（保持目录结构）
     //    如 tiles/region_1.php → backup/{timestamp}/tiles/region_1.php
     //    combat_skills/skill_move.php → backup/{timestamp}/combat_skills/skill_move.php
     for (const file of files) {
       await writeFileToDirectoryHandle(backupDirHandle, file.path, file.content);
     }
     
     // 6. 提示成功
     ui.showToast(`已备份 ${files.length} 个文件到 backup/${timestamp}/`, 'success');
   }
   ```

3. **新增辅助函数 `writeFileToDirectoryHandle`**（file-io.ts）：
   - 递归创建子目录（如 `tiles/`、`combat_skills/`）
   - 写入文件内容

4. **新增辅助函数 `formatBackupTimestamp`**（file-io.ts 或 utils）：
   - 格式：`YYYYMMDD_HHMMSS`（与 oblivions/gamedata/backup/ 下已有的后端生成备份一致）

5. **入口位置**：
   - TopBar 新增独立"备份"按钮（与导入/导出按钮平级）
   - 点击后触发 backupGamedata 流程

6. **备份范围**：
   - 所有 gamedata 下的 .php 文件（根目录 15 个 + tiles/ + combat_skills/）
   - 保持原目录结构（tiles/region_1.php → backup/{timestamp}/tiles/region_1.php）
   - 不解析文件内容，纯文件复制

**影响范围**：
- editor-next/src/composables/useImportExport.ts（新增 backupGamedata）
- editor-next/src/services/file-io.ts（新增 writeFileToDirectoryHandle + formatBackupTimestamp）
- editor-next/src/components/layout/TopBar.vue（新增备份按钮）

**不变量**：
- 备份是只读源目录操作，不修改 gamedata 源目录
- 备份范围覆盖 gamedata/ 下所有 .php 文件（含子目录）
- 备份目录结构保持原 gamedata 目录结构
- 时间戳子目录不覆盖已有备份

---

#### 任务 H：功能 d - 一键从备份中还原

**目标**：新增"从备份还原"功能，从 `oblivions/gamedata/backup/{timestamp}/` 读取备份文件，还原到 gamedata 目录。

**设计**：

1. **ImportModal 新增"从备份还原"Tab**：
   - Tab 类型新增 `'restore'`
   - UI 流程：
     1. "选择备份目录"按钮（FSAA 选择 `oblivions/gamedata/backup/`）
     2. 列出备份目录下的所有时间戳子目录（供用户选择，显示为可点击列表）
     3. "选择目标 gamedata 目录"按钮（FSAA 选择还原目标，应为 `oblivions/gamedata/`）
     4. "还原"按钮（还原前自动备份当前 gamedata 状态）

2. **还原逻辑**：
   ```typescript
   async function restoreFromBackup(): Promise<void> {
     // 1. 选择备份目录（oblivions/gamedata/backup/）
     const backupPicker = await pickDirectory('read');
     
     // 2. 列出所有时间戳子目录
     const backups = await listSubDirectories(backupPicker.handle);
     // backups = ['20260719_173747', '20260719_174100', '20260722_173747', ...]
     // 用户从列表中选择一个备份
     
     // 3. 选择目标 gamedata 目录（读写）
     const targetPicker = await pickDirectory('readwrite');
     
     // 4. 还原前自动备份当前 gamedata 状态（避免数据丢失）
     await backupGamedata();  // 复用功能 c 的备份逻辑
     
     // 5. 从备份子目录读取所有文件
     const selectedBackupHandle = await backupPicker.handle.getDirectoryHandle(selectedTimestamp);
     const files = await readPhpFilesFromDirectory(selectedBackupHandle);
     
     // 6. 写入到目标 gamedata 目录（保持目录结构）
     for (const file of files) {
       await writeFileToDirectoryHandle(targetPicker.handle, file.path, file.content);
     }
     
     // 7. 同时导入到编辑器（用户可立即查看还原结果）
     const project = await parseFilesToProject(files);
     await finishImport(project, targetPicker.handle);
     
     // 8. 提示成功
     ui.showToast(`已从 backup/${selectedTimestamp}/ 还原 ${files.length} 个文件`, 'success');
   }
   ```

3. **新增辅助函数 `listSubDirectories`**（file-io.ts）：
   - 列出目录下所有子目录名（按名称降序，最新备份在前）

4. **还原前自动备份**：
   - 还原操作前自动调用 `backupGamedata()`，备份当前 gamedata 状态
   - 避免还原操作覆盖已有数据时丢失

5. **备份目录兼容性**：
   - 编辑器生成的备份：时间戳子目录 + 原样 .php 文件（如 `backup/20260722_173747/map.php`）
   - 后端生成的备份：`oblivions_map_backup_*.zip` 文件（在 backup/ 根目录）
   - 还原功能优先支持编辑器生成的子目录格式；后端生成的 ZIP 文件作为兼容性支持（如检测到 ZIP 文件，调用 unzipBundle 解压后还原）

**影响范围**：
- editor-next/src/components/modals/ImportModal.vue（新增 restore Tab）
- editor-next/src/composables/useImportExport.ts（新增 restoreFromBackup）
- editor-next/src/services/file-io.ts（新增 listSubDirectories）
- editor-next/src/services/zip-bundle.ts（unzipBundle 在兼容后端 ZIP 备份时被调用）

**不变量**：
- 还原前必须自动备份当前 gamedata 状态（避免数据丢失）
- 还原后自动导入到编辑器（用户可立即查看还原结果）
- 备份子目录格式与功能 c 生成的格式一致
- 还原操作不删除目标目录中备份里没有的文件（只覆盖/新增）

---

## 四、实施顺序

```
阶段 1：解耦与独立化
  ├─ 任务 A：shared 内联进 editor-next
  ├─ 任务 B：移除 Dian.md 模块 O + 更新 validate_design_anchors.php
  └─ 任务 C：editor-next 内部文档（README.md）

阶段 2：4 个新增功能
  ├─ 任务 D：扩展配置文件支持（全量原始字符串保留）  ← 其他功能的基础
  ├─ 任务 E：功能 a - 一键读取
  ├─ 任务 F：功能 b - 一键导出
  ├─ 任务 G：功能 c - 一键备份
  └─ 任务 H：功能 d - 一键还原
```

任务 A 和 B 可并行（无依赖），但建议先 A 后 B（A 完成后 shared 已内联，B 的标签清理范围更清晰）。
任务 D 是 E/F/G/H 的基础（全量缓存机制），必须先做。
任务 E/F/G/H 之间无强依赖，可并行。

---

## 五、不变量

1. **editor-next 保持纯前端**：不引入后端 API，不触碰 DB
2. **编辑器仅读写 gamedata PHP 文件**：运行时游戏通过 `obl_get_map_data()` 直接 require gamedata + 原生 SQL 操作 DB 表，编辑器不参与
3. **现有编辑能力不退化**：map/tiles/4 个配置的编辑能力保持
4. **双向锚点契约**：editor-next 不再参与，但 oblivions 后端 + vex-vue 仍参与
5. **round-trip 一致性**：原始字符串缓存的文件，导出时原样写出

---

## 六、跨层契约

### 6.1 编辑器与 gamedata 目录的契约

| 方向 | 文件范围 | 读写语义 |
|---|---|---|
| 读取 | gamedata/*.php + tiles/*.php + combat_skills/*.php | 全量读取，解析支持的文件，其他原始缓存 |
| 写入 | gamedata/*.php + tiles/*.php + combat_skills/*.php | 全量写入（编辑器生成的 + 原始缓存的），写入前备份 |
| 备份 | gamedata/*.php + tiles/*.php + combat_skills/*.php | 读取源目录所有 .php → 创建 backup/{timestamp}/ 子目录 → 原样复制文件（保持目录结构） |
| 还原 | backup/{timestamp}/*.php + tiles/*.php + combat_skills/*.php | 选择备份子目录 → 还原前自动备份当前 gamedata → 复制备份文件到目标 gamedata 目录 → 自动导入编辑器 |

### 6.2 编辑器与 oblivions 后端的契约

- **无直接契约**：编辑器是纯前端工具，与后端无 API 调用
- **间接契约**：编辑器写入的 gamedata PHP 文件，由后端 `obl_get_map_data()` require 读取——编辑器必须保证生成的 PHP 语法正确（已有 php-codegen 保证）

---

## 七、失败处理

| 场景 | 处理 |
|---|---|
| FSAA 不可用 | 回退到 webkitdirectory / 粘贴 / 拖拽（已有机制） |
| FSAA 权限被拒 | 提示用户"需要读写权限，请重新选择目录" |
| 备份目录已存在相同时间戳子目录 | 提示用户"备份已存在，请稍后重试或手动删除旧备份" |
| 备份目录列表为空 | 提示用户"未找到备份，请先执行备份操作" |
| 还原时目标目录非 gamedata | 提示用户"未找到 map.php，请确保选择了 gamedata 目录" |
| 写回失败（权限不足） | 提示用户检查目录权限，还原前的自动备份已保留 |
| PHP 解析失败 | 提示用户具体错误（行号/列号/期望 token） |
| 目标目录非 gamedata | 提示用户"未找到 map.php，请确保选择了 gamedata 目录" |

---

## 八、测试

### 8.1 类型检查
```bash
cd oblivions/editor-next && pnpm typecheck
```

### 8.2 单元测试
```bash
cd oblivions/editor-next && pnpm test
```

### 8.3 锚点校验
```bash
php oblivions/tools/validate_design_anchors.php
```
预期：0 errors（editor-next 不再参与校验）

### 8.4 手动测试

| 测试项 | 步骤 | 预期结果 |
|---|---|---|
| 解耦后类型检查 | `pnpm typecheck` | 通过 |
| 解耦后构建 | `pnpm build` | 通过 |
| 锚点校验 | `php validate_design_anchors.php` | 0 errors |
| 一键读取 | 选择 gamedata 目录 | 所有 .php 文件读取，4 个配置 + map + tiles 解析，其他原始缓存 |
| 一键导出 | 选择 gamedata 目录写入 | 所有文件写入，旧文件自动备份到 backup/{timestamp}/ |
| 一键备份 | 选择 gamedata 源 + backup 目标 | 创建 backup/{timestamp}/ 子目录，所有 .php 文件复制（保持目录结构） |
| 一键还原 | 选择 backup 目录 → 选择时间戳子目录 → 选择目标 gamedata | 还原前自动备份当前状态，文件还原，自动导入编辑器 |
| round-trip | 读取 → 导出 → 重新读取 | 数据一致 |
| 备份完整性 | 备份后对比源目录与备份目录 | 文件数量、目录结构、文件内容完全一致 |

---

## 九、风险

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| shared 内联后未来 vex-vue 要用 shared 需重新设计 | 低 | 低 | 当前 vex-vue 未用 shared，可接受；未来需要时可将 shared 重新抽离 |
| 移除模块 O 后 editor-next 设计意图失去 Dian.md 文档化 | 中 | 低 | 通过 editor-next/README.md 补偿 |
| 全量原始字符串保留增加内存占用 | 低 | 低 | gamedata 总大小有限（< 1MB），可接受 |
| 64 处 import 路径变更可能遗漏 | 中 | 中 | 类型检查 + 构建测试 + 单元测试保证覆盖 |
| FSAA 在某些浏览器不可用 | 中 | 中 | 已有 webkitdirectory / 粘贴 / 拖拽回退 |

---

## 十、非目标

1. **不重新引入后端 API**：编辑器保持纯前端，不依赖后端运行时
2. **不扩展所有配置文件的编辑 UI**：11 个未支持的配置文件作为原始字符串保留，不实现编辑器 UI
3. **不改变编辑器的纯前端定位**：不引入 Electron / Tauri 等桌面框架
4. **不改变 vex-vue 的结构**：vex-vue 当前未用 shared，本次任务不影响 vex-vue
5. **不改变 oblivions 后端**：后端代码完全不动

---

## 十一、验收标准

- [ ] oblivions/ 根目录不再有 package.json / pnpm-workspace.yaml / pnpm-lock.yaml
- [ ] oblivions/shared/ 目录已删除
- [ ] editor-next/src/shared/ 内联完成，类型检查通过
- [ ] Dian.md 模块 O 章节已删除
- [ ] validate_design_anchors.php 通过（0 errors）
- [ ] editor-next/src/ 中所有 `@module O` / `@framework O-*` 标签已移除
- [ ] editor-next/README.md 已创建
- [ ] 4 个新增功能（读取/导出/备份/还原）已实现并手动测试通过
- [ ] 备份功能创建时间戳子目录到 oblivions/gamedata/backup/，保持原目录结构
- [ ] 还原功能从时间戳子目录读取，还原前自动备份当前状态
- [ ] round-trip 测试通过（读取 → 导出 → 重新读取，数据一致）
- [ ] 备份完整性测试通过（源目录与备份目录文件数量、结构、内容一致）
