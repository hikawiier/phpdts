# Oblivions 前端契约补丁设计案

> 本案定义合成系统前端实现前需补齐的两处后端契约缺口，供《vex-vue-背包与道具使用界面设计案.md》和《vex-vue-合成界面设计案.md》依赖。
>
> 后端核心实现详见《道具使用与合成系统-设计案.md》和《堆叠功能与合成系统P2重构-设计案.md》。

---

## 一、背景

合成系统后端（命令 + API + 数据）已实现完整，但 `craft_preview` 和 `craft_workbench_materials` 两个 API 的返回字段与前端设计案要求存在两处契约缺口：

| 缺口 | 设计案要求 | 后端实际返回 | 影响 |
|------|-----------|-------------|------|
| **C1** | `craft_preview` 返回 `preview_logs` 用于区④显示分原因反馈（缺工具/多余素材/素材不足等 8 种 ID） | `item_craft_preview` 仅返回 `{match_count, craftable, is_new_recipe}` | 前端无法显示精细反馈文案，只能按 match_count 粗分 |
| **C2** | `craft_workbench_materials` 返回的素材含 `tags` 和 `itmk` 字段 | `item_get_available_workbench_materials` 仅返回 `[{source, id, item_id, tool_level}]` | `quickCraft` 无法本地匹配 `consume='none'` 的 tag/itmk 类型槽位 |

本案补齐这两处缺口，与前端实现一并执行。

---

## 二、C1：craft_preview 增加 preview_log 字段

### 2.1 设计决策

**preview_log 为单对象，非数组**。

原合成界面设计案 §3.4 使用 `preview_logs: [{id, params}]` 数组，但每次 preview 实际只触发 1 种反馈（match_count 是确定值），数组化属过度设计。改为单对象 `preview_log: {id, params}`，减少前端遍历渲染逻辑。

### 2.2 preview_log 的 ID 枚举与 params 契约

| 条件 | ID | params | 渲染文案（前端模板） |
|------|-----|--------|---------------------|
| 素材池为空（placed_items 为空，即 slots 与 workbench_materials 均空或仅含无效工作台素材） | `craft.empty_pool` | `{}` | "放入素材才能合成" |
| match_count=0，缺少工作台/工具素材 | `craft.tool_missing` | `{}` | "需要合适的工具（如烹饪器具/锻造工具）" |
| match_count=0，有多余素材 | `craft.extra_material` | `{}` | "有些素材用不上，试试移除部分素材" |
| match_count=0，素材数量/类别不足 | `craft.insufficient` | `{}` | "素材不足，试试放入更多同类素材" |
| match_count=0，其他无法分类的失败 | `craft.fail_no_match` | `{}` | "这些素材无法合成任何东西" |
| match_count≥2 | `craft.fail_ambiguous` | `{match_count: N}` | "素材指向不明确（匹配 {match_count} 个配方）" |
| match_count=1，非新配方 | `craft.ready` | `{}` | "可合成" |
| match_count=1，新配方 | `craft.new_recipe` | `{}` | "发现新配方！" |

**params 字段统一规则**：
- 所有 ID 的 params 均为对象（可为空 `{}`）
- 仅 `craft.fail_ambiguous` 携带 `match_count` 字段（match_count 数值）
- 其余 ID 无需 params（前端模板为静态文案）

**与命令日志的区分**：
- `craft.new_recipe`（preview 用，预判反馈）：仅前端区④显示，不入库
- `craft.new_recipe_discovered`（命令日志用）：合成成功且为新配方时由 `item_craft` emit，入 obl_log 表
- 两者 ID 不同，分别注册前端模板，避免混淆

### 2.3 后端实现方案

#### 2.3.1 新增失败原因分析函数

在 `oblivions/include/game/item/item.craft.func.php` 新增 `item_analyze_craft_failure`：

```php
/**
 * 分析素材池无法合成的原因（match_count=0 时调用）
 *
 * 策略：
 *   1. 遍历所有配方，对每个配方调用 item_resolve_material_mapping 判断是否匹配
 *   2. 对匹配失败的配方，分析失败原因（tool_missing / extra_material / insufficient）
 *   3. 返回出现次数最多的原因（并列时按优先级 tool_missing > extra_material > insufficient）
 *
 * 失败原因判定：
 *   - tool_missing：配方需要 consume='none' 工作台素材，但 placed_items 中无工作台素材
 *   - extra_material：所有 material 需求都能满足，但 placed_items 有多余素材未被消耗
 *   - insufficient：有 material 需求无法满足（数量/类别不足）
 *
 * 注意：失败原因分析使用独立的 available 副本模拟三阶段匹配，
 *       仅用于诊断失败原因，不影响实际合成逻辑。
 *       模拟匹配的 used 标记可能与 item_resolve_material_mapping 的实际执行路径
 *       不完全一致（原函数在 need>0 时立即 return null，此处继续遍历后续 material），
 *       但对失败原因判定结论无影响：只要有任何 material 未满足即为 insufficient。
 *
 * @param array $placed_items  _item_build_placed_items 返回的 placed_items
 * @return string  失败原因 ID（'craft.tool_missing' / 'craft.extra_material' / 'craft.insufficient' / 'craft.fail_no_match'）
 */
function item_analyze_craft_failure($placed_items) {
    // 检查 placed_items 是否包含工作台素材
    $has_workbench = false;
    foreach ($placed_items as $p) {
        if (isset($p['source']) && $p['source'] === 'workbench') {
            $has_workbench = true;
            break;
        }
    }

    $reasons = ['tool_missing' => 0, 'extra_material' => 0, 'insufficient' => 0];

    foreach (item_get_all_recipes() as $recipe) {
        $materials = $recipe['materials'];

        // 1. 检查是否需要工作台素材（consume='none'）
        $needs_workbench = false;
        foreach ($materials as $mat) {
            if (($mat['consume'] ?? 'all') === 'none') {
                $needs_workbench = true;
                break;
            }
        }
        if ($needs_workbench && !$has_workbench) {
            $reasons['tool_missing']++;
            continue;
        }

        // 2. 调用 item_resolve_material_mapping 判断是否匹配
        $mapping = item_resolve_material_mapping($materials, $placed_items);
        if ($mapping !== null) {
            // 此配方能匹配，跳过（match_count=0 时不应走到这里，防御性 continue）
            continue;
        }

        // 3. 匹配失败，分析原因：构建 available 副本模拟三阶段匹配
        //    item_resolve_material_mapping 返回 null 时无法区分"素材不足"和"多余素材"，
        //    此处独立模拟以获取 used 状态
        $available = [];
        foreach ($placed_items as $i => $p) {
            $available[] = [
                'index'      => $i,
                'item_id'    => $p['item_id'] ?? '',
                'itmk'       => $p['itmk'] ?? '',
                'tags'       => $p['tags'] ?? [],
                'tool_level' => $p['tool_level'] ?? 0,
                'source'     => $p['source'] ?? 'bag',
                'used'       => false,
            ];
        }

        $unmet_need = false;
        foreach (['item_id', 'itmk', 'tag'] as $match_key) {
            foreach ($materials as $mat) {
                if (!isset($mat[$match_key])) continue;
                $need = (int)($mat['count'] ?? 1);
                $consume = $mat['consume'] ?? 'all';
                $min_level = (int)($mat['min_level'] ?? 0);
                for ($i = 0; $i < count($available) && $need > 0; $i++) {
                    if ($available[$i]['used']) continue;
                    $matched = false;
                    if ($match_key === 'item_id') {
                        $matched = ($available[$i]['item_id'] === $mat['item_id']);
                    } elseif ($match_key === 'itmk') {
                        $matched = ($available[$i]['itmk'] === $mat['itmk']);
                    } else {
                        $matched = in_array($mat['tag'], $available[$i]['tags']);
                    }
                    if ($matched && $available[$i]['tool_level'] >= $min_level && item_can_consume($available[$i], $consume)) {
                        $available[$i]['used'] = true;
                        $need--;
                    }
                }
                if ($need > 0) $unmet_need = true;
            }
        }

        if ($unmet_need) {
            $reasons['insufficient']++;
        } else {
            $reasons['extra_material']++;
        }
    }

    // 返回出现次数最多的原因（并列时按优先级 tool_missing > extra_material > insufficient）
    $max_count = max($reasons['tool_missing'], $reasons['extra_material'], $reasons['insufficient']);
    if ($max_count === 0) return 'craft.fail_no_match';
    if ($reasons['tool_missing'] === $max_count) return 'craft.tool_missing';
    if ($reasons['extra_material'] === $max_count) return 'craft.extra_material';
    return 'craft.insufficient';
}
```

#### 2.3.2 修改 item_craft_preview

```php
function item_craft_preview($slots, &$pdata, $workbench_materials = []) {
    $slot_counts = item_parse_slots($slots);
    $built = _item_build_placed_items($pdata, $slot_counts, $workbench_materials);
    $placed_items = $built['placed_items'];

    $matched = [];
    foreach (item_get_all_recipes() as $recipe_id => $recipe) {
        if (item_materials_match($recipe['materials'], $placed_items)) {
            $matched[] = $recipe_id;
        }
    }
    $match_count = count($matched);
    $craftable = ($match_count === 1);

    $is_new_recipe = false;
    if ($craftable) {
        $recipe_id = $matched[0];
        $discovered = isset($pdata['oblpara']['discovered_recipes']) ? $pdata['oblpara']['discovered_recipes'] : [];
        if (!is_array($discovered)) $discovered = [];
        $is_new_recipe = !in_array($recipe_id, $discovered, true);
    }

    // 生成 preview_log（单对象）
    $preview_log = _item_build_preview_log($slot_counts, $workbench_materials, $placed_items, $match_count, $is_new_recipe);

    return [
        'match_count'   => $match_count,
        'craftable'     => $craftable,
        'is_new_recipe' => $is_new_recipe,
        'preview_log'   => $preview_log,
    ];
}
```

#### 2.3.3 新增 _item_build_preview_log 辅助函数

```php
/**
 * 构建 preview_log 单对象
 *
 * @param array $slot_counts        item_parse_slots 结果
 * @param array $workbench_materials 工作台素材 ID 列表
 * @param array $placed_items        _item_build_placed_items 返回的 placed_items
 * @param int   $match_count         匹配配方数
 * @param bool  $is_new_recipe       是否新配方（仅 match_count=1 时有意义）
 * @return array  {id: string, params: array}
 */
function _item_build_preview_log($slot_counts, $workbench_materials, $placed_items, $match_count, $is_new_recipe) {
    // 1. 素材池实际为空（基于 placed_items 判断，而非输入参数）
    //    场景：玩家只选了无效工作台素材（slot_counts 空 + workbench_materials 非空），
    //    但 placed_items 实际为空时，应返回 empty_pool 而非走失败原因分析
    if (empty($placed_items)) {
        return ['id' => 'craft.empty_pool', 'params' => []];
    }

    // 2. match_count >= 2：指向不明确
    if ($match_count >= 2) {
        return ['id' => 'craft.fail_ambiguous', 'params' => ['match_count' => $match_count]];
    }

    // 3. match_count = 1：可合成
    if ($match_count === 1) {
        return $is_new_recipe
            ? ['id' => 'craft.new_recipe', 'params' => []]
            : ['id' => 'craft.ready', 'params' => []];
    }

    // 4. match_count = 0：分析失败原因
    $reason_id = item_analyze_craft_failure($placed_items);
    return ['id' => $reason_id, 'params' => []];
}
```

#### 2.3.4 API 层无需修改

`api_v2.php` 的 `handle_craft_preview` 直接透传 `item_craft_preview` 的返回值，无需修改：

```php
function handle_craft_preview() {
    // ... 现有参数解析
    $result = item_craft_preview($slots_arr, $pdata, $wb_arr);
    api_response('success', $result);  // 透传，含 preview_log 字段
}
```

### 2.4 前端类型契约（供合成界面设计案引用）

```typescript
// craft_preview 响应
export interface CraftPreviewResult {
  match_count: number
  craftable: boolean
  is_new_recipe: boolean
  preview_log: PreviewLog  // 单对象（非数组）
}

export interface PreviewLog {
  id: string  // 'craft.empty_pool' | 'craft.tool_missing' | 'craft.extra_material' | 'craft.insufficient' | 'craft.fail_no_match' | 'craft.fail_ambiguous' | 'craft.ready' | 'craft.new_recipe'
  params: Record<string, string | number | boolean>  // 通常为空对象，仅 craft.fail_ambiguous 含 count
}
```

### 2.5 前端渲染契约

前端在区④渲染 `preview_log` 时，构造完整 LogEntry 传入 `renderLogEntry`：

```typescript
// 构造 LogEntry（preview_log 不是真实日志，仅借用渲染机制）
const fakeEntry: LogEntry = {
  id: previewLog.id,
  logcategory: 'system',  // 与 craft.* 命令日志一致，不新增枚举值
  params: previewLog.params,
  html: null,
  debug: false,
  ts: 0,
}
const html = renderLogEntry(fakeEntry)
```

**logcategory 选择理由**：
- preview_log 不是真实日志事件，logcategory 字段对渲染无影响（`renderLogEntry` 仅按 `id` 查模板）
- 复用 `'system'`（与 `craft.success` 等命令日志一致），避免在 `LogEntry.logcategory` 枚举中新增 `'craft'`

### 2.6 前端新增日志模板

`vex-vue/src/data/log-templates.ts` 新增 6 个模板（preview 专用）：

```typescript
// ─── craft preview（预判反馈，非真实日志） ──────
'craft.empty_pool': {
  text: '放入素材才能合成。',
},
'craft.tool_missing': {
  text: '需要合适的工具（如烹饪器具/锻造工具）。',
},
'craft.extra_material': {
  text: '有些素材用不上，试试移除部分素材。',
},
'craft.insufficient': {
  text: '素材不足，试试放入更多同类素材。',
},
'craft.ready': {
  text: '可合成。',
},
'craft.new_recipe': {
  text: '发现新配方！',
},
```

**注意**：`craft.fail_no_match` 和 `craft.fail_ambiguous` 已在现有 log-templates.ts 中注册（命令日志复用），preview_log 直接复用，无需重复注册。

**渲染说明**：所有模板统一走 `terminal.css` 灰阶渲染，不引入彩色信号色（详见前端美学风格设计案 §6.3）。如需强调特定反馈，实施时应改用 `render` 函数包裹 `<span class="bright">` 等灰阶标签。

---

## 三、C2：WorkbenchMaterial 增加 tags/itmk 字段

### 3.1 设计决策

`item_get_available_workbench_materials` 返回的每个素材增加 `tags` 和 `itmk` 字段，供前端 `quickCraft` 本地匹配 `consume='none'` 的 tag/itmk 类型槽位，避免为每个素材发起额外请求。

### 3.2 后端实现方案

修改 `item_get_available_workbench_materials`，在构建每个素材时追加 `tags` 和 `itmk` 字段：

```php
function item_get_available_workbench_materials(&$pdata) {
    $materials = [];

    // 1. 被动技能来源
    $materials[] = [
        'source'     => 'passive',
        'id'         => 'passive:innate_t0',
        'item_id'    => 'innate_craft_t0',
        'tool_level' => 0,
        'tags'       => item_get_tags('innate_craft_t0'),   // 新增
        'itmk'       => item_get_itmk('innate_craft_t0'),   // 新增
    ];

    // 2. POI 来源
    $pois = obl_get_poi_at_position($pdata['pgroup'], $pdata['pls']);
    foreach ($pois as $poi) {
        if (isset($poi['mechanic']) && $poi['mechanic'] === 'craft_source') {
            $item_id = isset($poi['mechanic_value']) ? $poi['mechanic_value'] : '';
            if ($item_id === '') continue;
            $materials[] = [
                'source'     => 'poi',
                'id'         => 'poi:' . $poi['iaid'],
                'item_id'    => $item_id,
                'tool_level' => item_get_tool_level($item_id),
                'tags'       => item_get_tags($item_id),   // 新增
                'itmk'       => item_get_itmk($item_id),   // 新增
            ];
        }
    }

    return $materials;
}
```

### 3.3 API 层无需修改

`api_v2.php` 的 `handle_craft_workbench_materials` 直接透传 `item_get_available_workbench_materials` 的返回值，无需修改。

### 3.4 前端类型契约（供合成界面设计案引用）

```typescript
export interface WorkbenchMaterial {
  source: 'passive' | 'cat' | 'poi'
  id: string
  item_id: string
  tool_level: number
  tags: string[]  // 新增：道具 tags（供 quickCraft 匹配 tag 类型槽位）
  itmk: string    // 新增：道具类别（供 quickCraft 匹配 itmk 类型槽位）
}
```

### 3.5 性能考量

- `item_get_tags` 和 `item_get_itmk` 内部带静态缓存（item.tag.func.php 实现），重复调用不会重复读取数据
- POI 数量通常很少（单格 0-2 个工作台 POI），新增字段对响应体积影响可忽略

---

## 四、文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `oblivions/include/game/item/item.craft.func.php` | 修改 | 新增 `item_analyze_craft_failure` / `_item_build_preview_log`；修改 `item_craft_preview` 返回 `preview_log`；修改 `item_get_available_workbench_materials` 追加 `tags`/`itmk` |
| `vex-vue/src/data/log-templates.ts` | 修改 | 新增 6 个 preview 专用模板（`craft.empty_pool` / `craft.tool_missing` / `craft.extra_material` / `craft.insufficient` / `craft.ready` / `craft.new_recipe`） |
| `api_v2.php` | 无需修改 | `handle_craft_preview` 和 `handle_craft_workbench_materials` 已透传完整返回值 |

---

## 五、验证要点

### 5.1 C1 验证

| 测试场景 | 期望 preview_log.id |
|---------|---------------------|
| 素材池为空 | `craft.empty_pool` |
| 仅放入 1 个布料（无配方匹配） | `craft.fail_no_match` 或 `craft.insufficient` |
| 放入煎锅配方素材但缺炉灶（工作台 POI） | `craft.tool_missing` |
| 放入绷带配方素材 + 多余的废铁片 | `craft.extra_material` |
| 放入绷带配方素材（恰好匹配） | `craft.ready` |
| 放入能匹配 2 个配方的素材 | `craft.fail_ambiguous`（params.match_count=2） |
| 放入未发现配方的素材 | `craft.new_recipe` |

### 5.2 C2 验证

- 调用 `craft_workbench_materials` API，确认返回的每个素材含 `tags`（数组）和 `itmk`（字符串）字段
- `quickCraft` 对 `consume='none'` 的 tag 类型槽位能本地匹配工作台素材

---

*文档版本：v1.2 | 2026-07-06（审阅修正：P1 删除 highlightClass + E3 行号 + O7 empty_pool 条件统一）*
