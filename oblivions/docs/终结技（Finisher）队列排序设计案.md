# 终结技（Finisher）队列排序设计案

> 配套设计：`逃跑功能设计案.md`
> 前置需求：技能装填队列中，有 `finisher=1` tag 的技能必须永远在队列末端执行

---

## 一、需求

有 `finisher=1` 标记的动作为"终结技"，在装填队列中满足：

> **一条队列中至多一个终结技，且它永远在队列最末尾执行。**

### 场景示例

| 操作序列 | 队列最终顺序 | 说明 |
|----------|-------------|------|
| 普通A → 终结B | [A, B] | 终结技推入末尾 |
| 终结B → 普通A | ~~[B, A]~~ → [A, B] | 普通技插入终结技之前 |
| 终结B → 普通A → 普通C | [A, C, B] | 多个普通技按加入顺序排在终结技前 |
| 终结B → 终结D | 拒绝 D | 队列已有终结技 |

---

## 二、Config 层

### 2.1 `skill_config.php` — 新增 `finisher` 字段

```php
'escape' => [
    'apcost'        => 0,
    'cd'            => 1,
    'finisher'      => 1,        // ← 新增：标记为终结技
    'target'        => 'self',
    'category'      => 'escape',
    'lifetime'      => 'permanent',
],
```

- `finisher = 1`：该技能是终结技
- 不存在或 `0`：普通技
- 未来可以有多个技能标记为 `finisher`（不过队列中只能存在一个）

### 2.2 `skill.main.php` — 新增 `skill_is_finisher($skill_id)`

```php
function skill_is_finisher($skill_id) {
    $config = skill_get_config($skill_id);
    if (!$config) return false;
    return !empty($config['finisher']);
}
```

纯配置查询，不涉及玩家状态。

---

## 三、前端层（交互体验）

**文件**：`vex-vue/src/components/battle/PreloadArea.vue`

### 3.1 `addToQueue` 改造

| 场景 | 操作 |
|------|------|
| 加入普通技，队列无终结技 | `push` 到末尾 |
| 加入普通技，队列有终结技 | `splice(finisherIndex, 0, item)` 插入到终结技前 |
| 加入终结技，队列已有终结技 | toast 提示"终结技已存在"，拒绝加入 |
| 加入终结技，队列无终结技 | `push` 到末尾 |

### 3.2 `removeFromQueue` 改造

不变。普通删除即可，终结技会自动保持末位。

### 3.3 `onSkillClick` 约束

```typescript
function onSkillClick(actId: string): void {
  const skill = skills.value.find((s) => s.act_id === actId);
  if (!skill || !skill.available) return;

  // CD 技能在队列中只能出现一次（已有改动）
  if (Number(skill.cd) > 0 && queue.value.some((item) => item.act_id === actId)) {
    useToastStore().showToast('该技能有冷却，无法重复装填', 'warn', 3000);
    return;
  }

  // 终结技队列排他
  if (Number(skill.finisher) > 0 && queue.value.some((item) => item.act_id === actId)) {
    useToastStore().showToast('终结技已存在，无法重复装填', 'warn', 3000);
    return;
  }
  // ... 后续处理
}
```

> `Skill` 类型需新增 `finisher` 字段（由 `skill_list` API 从 config 读取）。

---

## 四、后端层（安全兜底）

**文件**：`oblivions/include/game/battle/battle.main.php`

### 4.1 `battle_sort_actions`

新增独立步骤，挂在 `battle_main` 中 `verify` 和 `execute` 之间：

```php
function battle_main(&$actor_data, &$atk_act, &$obl_battle_log, &$battle_cache) {
    $obl_battle_log->setPhase('verify');
    battle_verify($actor_data, $atk_act, $obl_battle_log, $battle_cache);

    // 终结技排序（安全兜底，不信任前端顺序）
    battle_sort_actions($atk_act);

    if (!empty($atk_act)) {
        $obl_battle_log->setPhase('excute');
        battle_execute($actor_data, $atk_act, $obl_battle_log, $battle_cache);
    }
}
```

### 4.2 排序规则

```php
function battle_sort_actions(array &$atk_act) {
    $normal = [];
    $finishers = [];

    foreach ($atk_act as $act) {
        if (skill_is_finisher($act['act_id'])) {
            $finishers[] = $act;
        } else {
            $normal[] = $act;
        }
    }

    // 多个终结技 → 只保留最后一个（后提交的覆盖前面的）
    if (count($finishers) > 1) {
        $finishers = [array_pop($finishers)];
    }

    // 普通技在前，终结技在后
    $atk_act = array_merge($normal, $finishers);
}
```

### 4.3 边界

- 校验（CD/AP）已在 `verify` 阶段完成，排序不重复校验
- 终结技被 `verify` 删除（CD 未转好）→ 不会出现在排序结果中，自然消失
- 排序后 `execute` 按序执行，终结技必定最后执行

---

## 五、Skill 类型扩展（前端 TypeScript）

**文件**：`vex-vue/src/types/api.ts`

```typescript
export interface Skill {
  act_id: string;
  apcost: number;
  cd: number;
  finisher?: number;       // ← 新增
  target: string;
  range_bonus: number;
  category: string;
  lstact: number;
  current_tick: number;
  on_cd: boolean;
  available: boolean;
}
```

`skill_list` API 已返回完整技能配置，从 `skill_get_available_list` 加一行即可：

```php
// skill.main.php skill_get_available_list()
$skills[] = array(
    'act_id'       => $skill_id,
    'apcost'       => $apcost,
    'cd'           => $cd,
    'finisher'     => isset($config['finisher']) ? (int)$config['finisher'] : 0,  // ← 新增
    'target'       => ...
);
```

---

## 六、完整数据流

```
         前端                             后端
   ┌──────────────┐            ┌──────────────────────┐
   │ skill_list    │ ──GET──→  │ skill_get_available  │ finisher 字段随 config 返回
   │ (含 finisher) │ ←─JSON──  │                      │
   └──────┬───────┘            └──────────────────────┘
          │
   ┌──────▼───────┐
   │ onClick      │ ──本地规则──→ 终结技排他 / 普通技插入终结技前
   │ sort+push    │
   └──────┬───────┘
          │
   ┌──────▼───────┐            ┌──────────────────────┐
   │ Execute POST │ ──JSON──→  │ battle_main           │
   │ (队列数组)    │            │  ├ verify             │
   └──────────────┘            │  ├ sort_actions (兜底) │ ← 后端不信任前端顺序
                               │  └ execute             │
                               └──────────────────────┘
```

---

## 七、文件变更清单

| 文件 | 变更 |
|------|------|
| `oblivions/gamedata/skill_config.php` | escape 配置加 `'finisher' => 1` |
| `oblivions/include/game/skill/skill.main.php` | 新增 `skill_is_finisher()`；`skill_get_available_list` 返回 `finisher` 字段 |
| `oblivions/include/game/battle/battle.main.php` | `battle_main` 新增 `battle_sort_actions()` 步骤 |
| `api_v2.php` | `skill_list` handler 会自动包含新字段（无需改） |
| `vex-vue/src/types/api.ts` | `Skill` 类型加 `finisher?: number` |
| `vex-vue/src/components/battle/PreloadArea.vue` | `onSkillClick` 加 finisher 排他检查；`addToQueue` 加 finisher 插入逻辑 |

---

## 八、安全边界

| 场景 | 前端行为 | 后端兜底 | 终端效果 |
|------|---------|---------|---------|
| 用户 fiddler 篡改顺序 | 无（任何顺序都允许） | `sort_actions` 强制重排 | 终结技仍在末尾 |
| 用户 fiddler 插入多个终结技 | 前端已拦截 | `sort_actions` 只保留最后一个 | 非法动作静默丢弃 |
| 网络延迟导致双击 | `commandQueue` 锁拦截 | 二次提交被并发锁拦住 | 无重复执行 |
| 正常操作 | 体验顺畅 | 无感知 | 正确执行 |

---

*文档结束。实现入口：Config 加 `finisher` → `skill.main.php` 加函数 → 前端排序 → 后端兜底。*
