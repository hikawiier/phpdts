---
name: "oblivions-compass"
description: "在 PHPDTS 工作区内，通过 Dian.md 框架锚点、源码 @module/@framework 标签、codebase-memory 图谱、调试通道和浏览器证据定位 Oblivions 后端与 vex-vue 前端。用于查找模块或框架归属、设计与代码双向映射、调用链或数据流、影响范围、跨层契约、诊断通道，以及视觉、动画、交互任务的运行时验收；用户显式调用 compass/指南针或无法直接确定文件时也应使用。不要用于无关工作区。"
---

# Oblivions Compass

将本 Skill 作为 PHPDTS 的证据路由器：先找到最小可信锚点，再解释或修改系统。

## 开始

1. 定位包含 `oblivions/DESIGN.md`、`oblivions/Dian.md`、锚点校验器和 `vex-vue/` 的 PHPDTS 根目录。
2. 读取最新 `AGENTS.md`；存在 `user_AGENTS.md` 时一并参考。
3. 优先使用 Codebase Memory 的 `phpdts` 项目。
4. 文档、标签、图谱与源码冲突时，以当前源码行为为准并报告漂移。
5. 用户只要求定位、解释、评估或审查时，给出证据后停止；只有用户要求修改时才继续实现。

## 证据规则

- 设计到代码：按稳定框架编号读取 `Dian.md` 的局部章节和 `**代码锚点：**`，再核对源码 `@framework` 标签。
- 代码到设计：读取文件头 `@module` / `@framework`，再回到对应 `Dian.md` 章节理解意图与边界。
- `@module` 表示唯一主要模块；每条 `@framework` 只表示文件直接实现的基准框架。目录、import、普通调用或消费关系不能证明框架归属。
- 跨模块模式是多个基准框架的综合；未升格为编号框架时，不得虚构 `@framework`。
- `Dian.md` 管模块、框架、设计意图、边界案例和代码锚点；`DESIGN.md` 管术语、原则、文档哲学和锚点契约；函数与关系用图谱动态查询。
- 先搜索标题、框架编号或准确术语，再局部读取；不得默认通读大型文档或依赖静态代码库文档。
- `oblivions/docs/归档/` 只证明设计历史，不证明当前实现。

## 路由任务

| 需求 | 首选入口 | 后续 |
|---|---|---|
| 概念或原则 | 搜索 `DESIGN.md` | 读取命中章节 |
| 模块或框架归属 | `Dian.md` 框架编号 | 核对代码锚点与源码标签 |
| 已知文件反查设计 | `@module` / `@framework` | 打开对应框架章节 |
| 符号定义或实现 | `search_graph` | `get_code_snippet` |
| 调用链、影响或数据流 | `trace_path` | 检查关键端点源码 |
| 字面量、配置、错误文本或标签 | `search_code` | 必要时使用限定范围的 `rg` |
| 日志、诊断或未触发原因 | `AGENTS.md` 调试矩阵 + `Dian A-5` | 选择既有通道 |
| 视觉、动画或交互 | 前端运行时测试与 GM 手册 | 执行真实浏览器验收 |
| 未知结构或边界 | `get_architecture` | 限定路径和 aspect |
| 复杂多跳关系 | `get_graph_schema` + `query_graph` | 回到源码确认 |
| 跨层契约 | 精确字段、事件 ID、命令和框架编号 | 同时确认前后端与运行时 |

## 工具纪律

- 用 `search_graph(project="phpdts", query=..., file_pattern=...)` 查定义；精确匹配使用 `name_pattern`。
- 检查 `total` 与 `has_more`，通过路径、标签或分页处理截断。
- 将返回的 `qualified_name` 传给 `get_code_snippet(..., include_neighbors=true)`。
- 用 `trace_path(..., direction="inbound"|"outbound"|"both", mode="calls"|"data_flow")` 查询关系。
- 用 `search_code(..., mode="compact"|"files", path_filter=...)` 查询实时文本；只有正则模式才设置 `regex=true`。
- 定向查询不足时才使用 `get_architecture`；简单工具无法表达关系时才使用 `query_graph`。
- 图谱可能落后于未提交修改；用源码和 `search_code` 验证当前文本，不得为了迎合旧图谱否定新源码。
- 保留框架编号、路径、字段、表名、命令、事件 ID 和枚举值等反向搜索锚点；不固化数量、排名或延迟快照。

## 运行时验收门槛

视觉、动画、交互和玩家操作路径任务必须：

1. 先读 `vex-vue/docs/前端运行时测试与GM调试操作手册.md`。
2. 从玩家画面与操作路径反推前端状态、API 和后端模型。
3. 使用可用浏览器工具执行真实操作，不以静态 DOM、类型或单元测试替代玩家路径。
4. 同时检查可见结果、前端状态、HTTP 契约和后端权威状态；缺少任一层即标记待验证。
5. 按手册保存和恢复会改变状态的测试现场，并区分环境故障与产品缺陷。

无法运行浏览器验收时，明确说明“尚未完成玩家视角验收”，不得宣称功能完成或视觉正确。

## 调试通道

新增或建议调试信息前，先读最新调试矩阵与 `Dian A-5`：

| 目的 | 通道 |
|---|---|
| 玩家可见反馈 | `$obl_log` |
| 真实错误或命令失败 | `$obl_error_log` |
| 调试期流程诊断 | `obl_diag_emit()` |
| 严重契约错误 | `obl_diag_critical()` |
| 前端运行时事件 | `debugBus.emit()` |

禁止推荐散乱 `error_log`、`console.log`、`var_dump` 或自建日志文件；ID、结构化参数等细节以当前项目契约为准。

## 变更校验与维护边界

- 修改归属、标签、代码锚点或框架章节时，迁移期间运行 `php oblivions/tools/validate_design_anchors.php --module=X`，最终运行严格校验 `php oblivions/tools/validate_design_anchors.php`。
- 修改校验器自身时运行 `php oblivions/tools/tests/validate_design_anchors_test.php`。
- 校验器只证明文档与标签集合一致，不能替代归属的语义判断。
- 普通导航、审查、文档或代码修改不得默认触发 `index_repository`。只有用户或更高优先级规则明确要求时才刷新，并显式使用 `name="phpdts"`；失败后报告陈旧状态，不自动重试。
- 每个任务完成后，按最新 `AGENTS.md` 研判并分级沉淀实际需求；写前读取 Dian 写入工作流并用 B-3 校准密度，先提炼“为解决什么问题、设计了什么”，再补代码锚点与真正非显然的边界案例。
- 写后以“能否作为未来从零重建的基准”自检并继续删减；不要把工作记录、实现噪声或为了展示考虑周全而罗列的内容写入 `Dian.md`。

## 回退与输出

- 文档未命中：用 `search_code` 查精确文本、`search_graph` 查相关符号。
- 符号未命中：检查限定范围的结构或聚类，再用新词汇重试。
- MCP 不可用：使用限定范围的 `rg` 和局部读取，并说明关系判断置信度下降。
- 穷尽上述路线后才向用户索取更多上下文。

按需返回：任务域、`@module` / `@framework` 归属、文档与代码锚点、调用或数据关系、运行时证据、调试通道、未确认项和下一步。不要用宽泛架构摘要替代精确锚点。
