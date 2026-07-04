# 道具-系统钩子 Tag 设计案

> 本案定义道具与各游戏系统交互的"钩子 Tag"。
> 与《道具使用与合成系统-设计案.md》中的"性质描述 Tag"分离——性质描述 Tag 服务于合成系统的大类素材匹配，系统钩子 Tag 服务于装备/地图交互等系统的入口判断。

---

## 一、设计目标

### 1.1 为什么需要系统钩子 Tag

道具在游戏中有多种交互方式：装备、使用、与 POI 互动等。有些道具跨多个系统——例如撬棍既能当武器装备（战斗系统），又能用来撬门（地图交互系统）。

系统需要一个统一的"入口判断"机制：给定一个道具，判断它能被哪些系统使用。这就是系统钩子 Tag 的作用。

### 1.2 与 itmk 的分工

`itmk`（道具类别）和系统钩子 Tag 各司其职，不重叠：

| 字段 | 职责 | 示例 |
|------|------|------|
| `itmk` | 道具的**物理分类**与**装备槽位类型** | WP=武器槽，AR=胸甲槽，AH=头盔槽，AF=足部槽，AA=饰品槽 |
| 系统钩子 Tag | 道具与各系统的**交互入口判断** | tag_equippable=可装备，tag_usable=可使用，tag_poi_interactive=可与POI互动 |

**关键区分**：
- itmk 回归"物理分类 + 装备槽位类型"职责，**不再承担**"是否可装备/可使用"的判断
- 系统钩子 Tag 是各系统入口的**唯一判断依据**——各系统只查 Tag，不查 itmk

### 1.3 `tag_usable` 与 `use_effect` 的分层关系

道具的"使用"行为分两层：

| 层次 | 字段 | 语义 |
|------|------|------|
| 属性层 | `tag_usable`（系统钩子 Tag） | 道具是否可被"使用"命令调用 |
| 实现层 | `use_effect`（item_table 字段） | 使用时触发的具体效果函数名 |

**为什么需要分层**：
- `tag_usable` 是"可使用"的属性标识，与其他系统钩子 Tag（`tag_equippable` / `tag_poi_interactive`）统一架构
- `use_effect` 只记录"具体效果"，不再承担"是否可使用"的判断职责
- 鉴定系统场景下可独立控制：未鉴定道具显示 `tag_usable`（"这东西能用"）但隐藏 `use_effect`（"但不知道用了会怎样"）

**数据约束**：`use_effect` 非空 ⟺ `tags` 包含 `tag_usable`。由数据校验保证一致性。

### 1.4 核心设计原则：钩子 Tag 是通用标识

所有可装备/可使用/可互动的道具都**显式标注**对应钩子 Tag，不依赖 itmk 隐式判断。

**为什么不用 itmk 隐式判断**：
- 如果 itmk=WP 的道具"默认可装备"不需要 tag_equippable，那装备系统就得维护 `itmk in [WP,WK,WG,WD,WF,AR,AH,AF,AA]` 的白名单——每个系统都得维护一份，容易不一致
- 鉴定系统场景下，如果 itmk 已知但 tag_equippable 隐藏，玩家能通过 itmk 推断"可装备"，破坏鉴定系统的信息控制
- 统一为"只查 Tag"后，各系统入口逻辑简单一致：`has_tag('tag_xxx')`

**数据冗余的代价**：itmk=WP 的道具必然有 tag_equippable——这个冗余由数据校验保证一致性（itmk=WP ⟹ tag_equippable 存在），不增加查询复杂度。

---

## 二、钩子 Tag 列表

| Tag ID | 名称 | 消费方 | 典型道具 |
|--------|------|--------|---------|
| `tag_equippable` | 可装备 | 装备系统 | 撬棍（当武器）、废铁刀、废铁背心 |
| `tag_usable` | 可使用 | 道具使用系统（obl_use_item 命令） | 面包、生命药剂、绷带 |
| `tag_poi_interactive` | 可与POI互动 | 地图交互系统 | 撬棍（撬门）、开锁器（开锁） |

### 2.1 `tag_equippable`（可装备）

**语义**：道具可以被玩家装备到装备槽位。

**判断逻辑**：
- 所有可装备道具都**显式标注** `tag_equippable`，不依赖 itmk 隐式判断
- itmk=WP/WK/WG/WD/WF/AR/AH/AF/AA 的道具可装备 → 必须标注 `tag_equippable`
- itmk=TK 的道具，如果可装备（如撬棍当武器用）→ 标注 `tag_equippable`
- itmk=MT/HH/HS/DX 的道具不可装备 → 不应标注 `tag_equippable`

**装备槽位由 itmk 决定**：
- `tag_equippable` 只回答"能不能装备"
- "装备到哪个槽位"由 itmk 决定（WP→武器槽，AR→胸甲槽，AH→头盔槽，AF→足部槽，AA→饰品槽）
- TK 类道具标注 `tag_equippable` 时，装备系统需额外判断槽位（可能默认武器槽，或通过 itmpara 指定）

**消费方**：
- 装备系统：`has_tag('tag_equippable')` 判断道具是否可装备
- 前端背包 UI：基于 `tag_equippable` 显示"装备"按钮

### 2.2 `tag_usable`（可使用）

**语义**：道具可以被"使用"命令（`obl_use_item`）调用，触发使用效果。

**判断逻辑**：
- 所有可使用道具都**显式标注** `tag_usable`，不依赖 itmk 隐式判断
- itmk=HH/HS/DX 的消耗品通常可使用 → 标注 `tag_usable`（仅作合成素材、不可使用的 HH 道具除外）
- itmk=MT/TK 的道具如果有使用功能 → 标注 `tag_usable`
- itmk=WP/WK/... 的武器一般不可使用 → 不标注 `tag_usable`（除非有特殊武器可使用）

**与 use_effect 的分层关系**：
- `tag_usable` 标识"可使用"（属性层，见 §1.3）
- `use_effect` 字段记录"使用时触发的具体效果函数名"（实现层）
- `use_effect` 非空 ⟺ `tag_usable` 存在（数据校验保证）
- 具体效果的实现由归属系统注册（如 `item_use_effect_restore_sp` 由食物经验系统注册），见《道具使用与合成系统-设计案.md》§2.6

**消费方**：
- 道具使用系统：`obl_use_item` 命令检查 `has_tag('tag_usable')` 判断道具是否可使用
- 前端背包 UI：基于 `tag_usable` 显示"使用"按钮
- 鉴定系统（未来）：未鉴定道具可显示 `tag_usable` 但隐藏 `use_effect`

### 2.3 `tag_poi_interactive`（可与POI互动）

**语义**：道具可以对地图上的 POI 使用，触发特定的地图交互。

**判断逻辑**：
- 所有可与 POI 互动的道具都**显式标注** `tag_poi_interactive`，不依赖 itmk 隐式判断
- itmk 无法判断道具是否能与 POI 互动（TK 类可能有，其他类也可能有）
- 具体能对哪些 POI 互动、触发什么效果，由地图交互系统的 `mechanic` 机制决定

**与 POI mechanic 的关系**：
- POI 的 `mechanic` 字段定义 POI 的交互类型（如 `door_locked` = 上锁的门）
- 道具的 `tag_poi_interactive` 标识道具可参与 POI 交互（第一层过滤）
- 具体的"哪个道具能对哪个 POI 使用"由地图交互系统在运行时判断（第二层过滤，可能基于道具的 `itmpara` 或其他字段）

**消费方**：
- 地图交互系统：`has_tag('tag_poi_interactive')` 判断道具是否可参与 POI 交互
- 前端 POI 交互 UI：显示"使用道具"选项

### 2.4 典型道具映射示例

以下道具的 itmk + 钩子 Tag 组合示例（不穷举，完整映射由 item_table 数据决定）。包含本案引入的示例道具和《道具使用与合成系统-设计案.md》§3.2 中的道具：

| 道具 | itmk | 钩子 Tag | 说明 |
|------|------|---------|------|
| 撬棍（物理圣剑） | TK | `tag_equippable`, `tag_poi_interactive` | 跨系统道具：可装备当武器 + 可撬门 |
| 废铁刀 | WK | `tag_equippable` | 标准武器，装备到武器槽 |
| 废铁背心 | AR | `tag_equippable` | 标准防具，装备到胸甲槽 |
| 开锁器 | TK | `tag_poi_interactive` | 不可装备 + 可开锁 |
| 指南针 | TK | — | 不可装备 + 不可与 POI 互动 |
| 面包 | HH | `tag_usable` | 可使用（恢复 SP） |
| 生命药剂 | HH | `tag_usable` | 可使用（恢复 HP） |
| 绷带 | HH | `tag_usable` | 可使用（治愈 Body Status） |
| 生兔肉 | HH | `tag_usable` | 可使用（生吃触发抗性跃迁） |
| 沼泽草药 | HH | — | HH 类但仅作合成素材，不可使用 |
| 废铁片 | MT | — | 纯素材，不可装备/使用/互动 |
| 流浪汉厚底鞋 | AF | `tag_equippable` | 产物（足部防具） |
| 布包刀刃 | WK | `tag_equippable` | 产物（武器），兼有 `tag_sharp` 性质描述 Tag |
| 煎锅 | TK | — | 工具，不装备/不使用，作合成工作台素材 |

> itmk 列为建议值，最终由 item_table 数据决定。数据校验规则见 §6.3。

---

## 三、与性质描述 Tag 的区别

| 维度 | 性质描述 Tag | 系统钩子 Tag |
|------|------------|------------|
| 归属设计案 | 《道具使用与合成系统-设计案.md》 | 本案 |
| 服务系统 | 合成系统 | 装备系统、道具使用系统、地图交互系统等 |
| 作用 | 大类素材匹配（如 tag_sharp 匹配所有锐器） | 系统入口判断（如 tag_equippable 判断可装备） |
| 示例 | tag_sharp, tag_combustible, tag_raw_food | tag_equippable, tag_usable, tag_poi_interactive |
| 存储位置 | `item_table.tags` | `item_table.tags`（同一字段，不同 Tag ID） |

**关键点**：两类 Tag 存储在同一个 `item_table.tags` 字段中，只是语义和消费方不同。`item_get_tags()` 函数（定义于《道具使用与合成系统-设计案》§5.3）统一读取所有 Tag，各系统按需过滤自己关心的 Tag ID。

---

## 四、判断逻辑伪代码

各系统入口的判断逻辑统一为"只查 Tag，不查 itmk"：

```php
// 装备系统入口
function can_equip($item): bool {
    return item_has_tag($item['itmid'], 'tag_equippable');
}

// 道具使用系统入口（obl_use_item 命令）
function can_use($item): bool {
    return item_has_tag($item['itmid'], 'tag_usable');
}

// 地图交互系统入口（第一层过滤）
function can_interact_with_poi($item): bool {
    return item_has_tag($item['itmid'], 'tag_poi_interactive');
}
```

**装备槽位判断**（仅装备系统需要，基于 itmk）：

```php
// 装备到哪个槽位（仅当 can_equip 返回 true 时调用）
function get_equip_slot($item): string {
    $itmk = item_get_itmk($item['itmid']);
    return match ($itmk) {
        'WP', 'WK', 'WG', 'WD', 'WF' => 'weapon',
        'AR' => 'chest',
        'AH' => 'head',
        'AF' => 'feet',
        'AA' => 'accessory',
        'TK' => 'weapon',  // TK 类可装备道具默认武器槽（或通过 itmpara 指定）
        default => throw new LogicException("不可装备的 itmk: {$itmk}"),
    };
}
```

**关键**：`get_equip_slot` 只在 `can_equip` 返回 true 时调用，不会对不可装备的道具查询槽位。

---

## 五、预留扩展

后续系统可能需要的新钩子 Tag（如 `tag_trap_component` 陷阱组件、`tag_conductive` 导电、`tag_build_material` 建筑材料等），由各系统设计案在实际需要时定义。

**扩展原则**：
- 新钩子 Tag 只在它被实际消费时才定义（避免过度设计）
- 新钩子 Tag 是独立的系统入口判断，不与 itmk 重叠职责
- itmk 描述物理分类与装备槽位，钩子 Tag 描述系统交互能力，两者正交

---

## 六、实施说明

### 6.1 本案范围

本案定义三个钩子 Tag 的语义、判断逻辑和典型道具映射，**不实现具体的装备系统和地图交互系统**。这两个系统由各自的设计案实现时：
- 读取 `item_table.tags` 字段判断钩子 Tag（通过 `item_has_tag()` 函数）
- 在系统入口处调用对应的判断逻辑（见 §四 伪代码）

### 6.2 数据层改动

`item_table.tags` 字段已由《道具使用与合成系统-设计案.md》定义。本案不新增字段，只是定义新的 Tag ID 值：
- `tag_equippable`
- `tag_usable`
- `tag_poi_interactive`

### 6.3 数据校验

item_table 数据写入时需校验以下一致性规则：
- itmk ∈ {WP, WK, WG, WD, WF, AR, AH, AF, AA} ⟹ `tag_equippable` 存在
- `use_effect` 非空 ⟹ `tag_usable` 存在
- itmk ∈ {MT, HH, HS, DX} ⟹ `tag_equippable` 不存在（这些类别的道具不可装备）

**数据迁移**：现有 `item_table.php` 中的道具需按上述规则补充对应钩子 Tag。例如 itmk=WP/WK/AR/AH/AF 的现有武器防具需补 `tag_equippable`；有使用效果的现有消耗品需补 `tag_usable`。

---

*文档版本：v1.2 | 2026-07-05*
