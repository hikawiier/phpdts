# Oblivions 内容作者资源

> 本目录是 P5 单源编译的作者资源唯一事实源。

---

## 编译流程

```
oblivions/content/*.yaml  →  Resource Graph  →  投影器  →  PHP/TS 编译产物
（作者资源 YAML）           （内存图）          （P5-2）   （gamedata / locale）
```

1. 作者在 `oblivions/content/` 下编辑 YAML 资源文件
2. 工具箱加载 YAML 文件，构建 Resource Graph（O-3）
3. 触发编译时，按 kind 调用对应投影器（O-11）
4. 投影器输出 PHP gamedata 与 vex-vue locale 文件
5. 编译产物头部生成 `// AUTO-GENERATED FROM oblivions/content/...` 注释
6. 编译产物进入只读保护，工具箱拒绝直接编辑

---

## 目录结构

```
oblivions/content/
├── README.md                                    # 本文件
├── worlds/                                      # 世界资源（P1 projectStore 管理，P5 不纳入编译产物）
│   ├── regions.yaml
│   └── tiles/
│       ├── region_0.yaml
│       └── region_1.yaml
├── items/items.yaml                             # 道具模板（→ item_table.php）
├── recipes/recipes.yaml                         # 合成配方（→ recipe_table.php）
├── pois/pois.yaml                               # POI 模板（→ poi_table.php）
├── loot-tables/loot-tables.yaml                 # 战利品表（→ loot_tables.php）
├── enemies/enemies.yaml                         # 敌人模板（→ enemies_config.php）
├── skills/
│   ├── combat-skill-config.yaml                 # 战斗技能配置（→ combat_skill_config.php）
│   └── skill-definition-config.yaml             # 技能定义（→ skill_definition_config.php）
├── distributions/
│   ├── poi-pool.yaml                            # POI 分布池（→ poi_pool.php）
│   ├── enemy-pool.yaml                          # 敌人分布池（→ enemy_pool.php）
│   └── scatter-pool.yaml                        # 野生道具分布池（→ scatter_pool.php）
├── presentations/                               # 中文呈现（→ vex-vue/src/data/*-locale.ts）
│   ├── item-locale.yaml
│   ├── recipe-locale.yaml
│   ├── poi-locale.yaml
│   ├── enemy-locale.yaml
│   ├── terrain-desc.yaml
│   ├── itmk-locale.yaml
│   ├── tag-locale.yaml
│   ├── status-locale.yaml
│   └── ui-locale.yaml
├── runtime-config/obl-config.yaml               # 运行时配置（→ obl_config.php）
└── _schemas/                                    # JSON Schema 约束（由 schema-projection.ts 派生）
```

---

## 编辑约定

- 修改 YAML 后需在工具箱中触发编译（构建工作区 → 编译管道）
- 编译产物（`oblivions/gamedata/` + `vex-vue/src/data/`）为只读，禁止直接编辑
- YAML 文件支持注释、多行字符串、引用等特性，便于 diff 与 review
- 每个 YAML 文件配套一个 JSON Schema 约束文件（`_schemas/*.schema.json`），支持 IDE 自动补全与校验

---

## 参考文档

- [P5 内容单源编译执行案](../docs/工具箱与内容编译-执行案/06-P5-内容单源编译.md)
- [Dian.md 框架 O-11 内容单源编译](../Dian.md)
