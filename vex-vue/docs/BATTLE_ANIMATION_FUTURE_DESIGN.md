# 战斗动作编排设计案（未来扩展）

> 本文档规划 [BATTLE_ACTOR_ANIMATION_DESIGN.md](./BATTLE_ACTOR_ANIMATION_DESIGN.md)（M1-M4 已实现）之后的动画架构演进方向。
>
> **当前状态**：设计阶段，未实现。所有内容作为技术储备，按实际需求触发实施。

---

## 一、背景与动机

### 1.1 当前架构的局限

M1-M4 已实现的 collision 分支假设了"攻击者动画 + 受击者动画"成对出现：

```
collision 分支：阶段1 攻击者冲撞 → impactAt → 阶段2 受击者摇晃
```

这套假设只覆盖了"单体攻击"这一种动作形态。但随着技能系统扩展，会出现不匹配的动作：

- **自我治疗**：actor 对自己施法，无受击者，但有施法动画
- **范围攻击**：一个 actor 同时命中多个 target
- **Buff 技能**：actor 施法，target 无受击但有状态图标
- **被动触发**：无施法者动画，只有受击反应（如反击）

当前 `decideAnimation` 只区分 `'collision'`（攻击）和 `'none'`（无动画），**中间形态无处安放**——自我治疗会走 `'none'`，丢失施法动画。

### 1.2 isFled 启发的核心洞察

逃跑（flee）和攻击（attack）从游戏语义上毫不相关，但从**后端执行顺序**和**导演渲染**角度看，它们都是"玩家执行的一次动作"：

- 后端：都是 `once_execute_pre` + `once_execute_post` 配对
- 导演：都被 `pairPrePost` 合并为一条 `directedKind='action'` 的 DirectedEntry
- 动画：都应该是"施法者播放某个动作"的编排单位

**洞察**：动画编排应该按"一次动作"为单位组织，而不是按"攻击+受击"固定两阶段。每次动作的动画规格由动作类型决定——可能有受击，可能没有，可能多目标。

### 1.3 设计目标

把 collision 分支从"硬编码两阶段"升级为"按动作规格编排"的统一模型，支持多种动作形态。同时规划受击效果多样化、BOSS 大招、意图动画（兜底模板）、视觉风格原则等扩展。

---

## 二、动作形态分类

按"是否有施法者动画 / 是否有受击者 / 命中时机"维度分类：

| 形态 | 例子 | 施法者动画 | 受击者动画 | 命中时机 | 目标数量 |
|------|------|-----------|-----------|---------|---------|
| 单体攻击 | unarmed_strike | ✓ | ✓ | impactAt | 1 |
| 自我施法 | 治疗/Buff/变形 | ✓ | ✗ | 无 | 0 |
| 范围攻击 | AOE 爆发 | ✓ | ✓ | impactAt（同时） | N |
| 远程射击 | 弓箭/火球 | ✓ | ✓ | impactAt（含飞行时间） | 1 |
| 被动触发 | 反击/护盾反伤 | ✗ | ✓ | 即时 | 1 |

当前架构只实现了第一类。本设计案规划统一的编排模型覆盖全部形态。

> **注**："施法者动画 ✓"不等于必须设计专属 GSAP 动画——自我施法类可走意图动画兜底模板（见 §7），弹小型图标立绘即可传达意图。

---

## 三、ActionAnimationSpec 演进

### 3.1 当前接口（已实现）

```typescript
interface ActionAnimationSpec {
  attacker: { kind: AttackKind; impactAt: number };
  target: { duration: number };
}
```

局限：假设必有受击者，`target.duration` 不可选。

### 3.2 未来扩展接口

```typescript
interface ActionAnimationSpec {
  /** 施法者动画规格（被动触发类可为 null） */
  attacker: {
    kind: AttackKind;
    duration: number;          // 施法者动画总时长
  } | null;

  /** 命中时刻（毫秒）；null = 无命中时刻（自我施法/无受击） */
  impactAt: number | null;

  /** 受击规格；null = 无受击阶段（自我施法/Buff） */
  target: {
    kind: HitKind;             // 受击效果类型（见 §5）
    duration: number;
  } | null;

  /** 多目标模式：'single' 单体 | 'simultaneous' 同时多目标 | 'sequential' 逐个命中 */
  targetMode?: 'single' | 'simultaneous' | 'sequential';
}
```

### 3.3 统一编排流程

battle.ts 的 collision/action 分支改为按规格驱动：

```typescript
const spec = resolveActionSpec(e.action_id);

// 阶段 1：施法者动画（若有）
if (spec.attacker) {
  playAttackerAnim(spec.attacker.kind);
}

// 阶段 2：等命中时刻 + 触发受击（若有 impactAt 且有 target）
if (spec.impactAt !== null && spec.target) {
  await sleep(spec.impactAt);
  if (spec.targetMode === 'simultaneous') {
    // 范围攻击：所有目标同时受击
    targets.forEach(t => t.playHit(spec.target!.kind));
  } else {
    // 单体或逐个
    target?.playHit(spec.target.kind);
  }
  await sleep(spec.target.duration);
} else if (spec.attacker) {
  // 无受击，只等施法者动画完成
  await sleep(spec.attacker.duration);
}
```

这样自我治疗就是 `{ attacker: {kind:'self-cast', duration:600}, impactAt: null, target: null }`，只播施法动画然后进入下一条 entry。

---

## 四、AttackKind 扩展路径

### 4.1 当前类型（已实现）

```typescript
type AttackKind = 'melee' | 'ranged';
```

### 4.2 未来扩展

```typescript
type AttackKind =
  | 'melee'          // 近战冲撞（已实现）
  | 'ranged'         // 远程姿势（已实现骨架）
  | 'self-cast'      // 自我施法（治疗/Buff，无位移，可走意图动画兜底）
  | 'charge-cast'    // 蓄力施法（BOSS 大招，长前摇+立绘弹出）
  | 'leap-strike'    // 跳劈（位移到目标上方+下砸）
  | 'aoe-burst'      // 范围爆发（原地+扩散立绘弹出）
  | 'dash-strike';   // 冲刺斩（长距离位移穿过目标）
```

### 4.3 各类型动画规格预设

| kind | duration | impactAt | 特征 |
|------|----------|----------|------|
| melee | 300ms | 200ms | 蓄力后撤→冲撞→回正（已实现） |
| ranged | 300ms | 250ms | 后仰→前倾释放→回正，需配套飞行物 |
| self-cast | 600ms | null | 举手→释放→回正（或直接走意图动画兜底） |
| charge-cast | 1500ms | 1400ms | 长蓄力+立绘弹出→释放爆发 |
| leap-strike | 800ms | 500ms | 起跳→空中→下砸（位移到目标格） |
| aoe-burst | 700ms | 400ms | 原地蓄力→扩散立绘弹出 |
| dash-strike | 600ms | 300ms | 起手→冲刺穿过目标→回正 |

---

## 五、受击效果多样化（HitKind）

### 5.1 动机

当前 `hitAnim` 是单一的"压缩+反向过头+回正"3 段动画（动漫感普通受击）。但不同攻击力度应有不同受击表现：

- 普通攻击 → 轻微受击（当前效果）
- BOSS 致命攻击 → 夸张左右抖动 + 大幅度位移
- 击飞攻击 → 垂直弹起 + 旋转落地
- 冰冻攻击 → 冻结姿态 + 静止
- 击晕攻击 → 旋转倒下 + 击晕图标立绘

### 5.2 HitKind 类型定义

```typescript
type HitKind =
  | 'normal'     // 普通受击（当前 hitAnim，3 段动漫感）
  | 'heavy'      // 重击（夸张左右抖动 + 大位移 + 更长时长）
  | 'launch'     // 击飞（垂直弹起 + 旋转 + 落地）
  | 'freeze'     // 冰冻（冻结姿态 + 静止 + 解冻回正）
  | 'stun'       // 击晕（旋转倒下 + 击晕图标立绘 + 缓慢起身）
  | 'knockback'; // 击退（向后位移 + 跌坐）
```

### 5.3 heavy 受击设计草案（BOSS 致命攻击）

用户反馈当前普通受击"像被人敲了一下头缩了一下"，已满足普通攻击。`heavy` 留作 BOSS 重击：

```
段 1（0~0.12s）：scaleY 0.55 深压缩 + scaleX 1.25 横拉 + rotation 12° + x 偏移 2.5dx
段 2（0.12~0.28s）：scaleY 1.30 大幅拉伸 + scaleX 0.85 + rotation -10° + x 反向 3.5dx
段 3（0.28~0.32s）：scaleY 0.70 二次压缩 + rotation 8° + x 1.0dx（二次反弹）
段 4（0.32~0.55s）：elastic.out 振荡回正 + 补回偏移
```

特征：
- 比 normal 更深的压缩（0.55 vs 0.70）
- 加入"二次反弹"阶段（段 3），模拟"被打飞后撞墙弹回"
- 总时长 0.55s（normal 0.42s），节奏更慢更有分量
- 偏移幅度更大（2.5/3.5/1.0/... vs 1.8/2.4/0.6）

### 5.4 受击规格表

```typescript
const HIT_SPEC_TABLE: Record<HitKind, { duration: number; amplitude: number }> = {
  normal:   { duration: 420, amplitude: 1.0 },   // 当前 hitAnim
  heavy:    { duration: 550, amplitude: 1.8 },   // BOSS 重击
  launch:   { duration: 800, amplitude: 2.0 },   // 击飞
  freeze:   { duration: 1200, amplitude: 0 },    // 静止
  stun:     { duration: 1500, amplitude: 1.5 },  // 击晕
  knockback:{ duration: 600, amplitude: 2.5 },   // 击退
};
```

### 5.5 与 ActionAnimationSpec 的关系

`ActionAnimationSpec.target.kind` 指定受击类型。不同攻击动作可触发不同受击：

- unarmed_strike → target.kind = 'normal'
- BOSS power_strike → target.kind = 'heavy'
- 击飞技能 → target.kind = 'launch'

`playHit` 接口扩展：

```typescript
playHit(kind?: HitKind = 'normal', direction?: 1 | -1 | 0): void;
```

---

## 六、BOSS 大招三阶段模型

### 6.1 复杂技能的动画细分

普通攻击的"蓄力→冲撞→回正"已经够用，但 BOSS 大招需要更明显的阶段划分：

```
windup（前摇/蓄力）→ release（释放/命中）→ recover（后摇/余韵）
```

### 6.2 三阶段规格

```typescript
interface BossSkillSpec {
  windup:  { duration: number; anim: 'charge' | 'leap' | 'channel' };
  release: { duration: number; impactAt: number; illustration: string };  // 场景立绘 id（见 §8）
  recover: { duration: number; anim: 'stand' | 'stagger' };
}
```

### 6.3 charge-cast 示例（BOSS 蓄力大招）

```
windup (0~1200ms)：
  - BOSS 身体下沉蓄力，scaleY 0.7 + 微微震动
  - 弹出"能量聚集"场景立绘层（黑白纹样向 BOSS 收拢，复用 popUp 机制）

release (1200~1500ms)：
  - BOSS 弹起释放，scaleY 1.3 + 双手张开
  - impactAt=1400ms：弹出"冲击爆发"场景立绘层（替代震波闪屏）
  - 所有目标同时 playHit('heavy')

recover (1500~2000ms)：
  - BOSS 回正，scaleY 回 1
  - 余韵："地面裂纹"场景立绘层残留淡出
```

### 6.4 与 ActionAnimationSpec 的整合

BOSS 大招仍走 `ActionAnimationSpec`，但 `attacker.kind = 'charge-cast'`，`target.kind = 'heavy'`，`targetMode = 'simultaneous'`。三阶段由 `attackAnim` 内部实现（timeline 三个大段），`impactAt` 对齐 release 阶段的命中时刻。

---

## 七、意图动画（兜底模板）

### 7.1 动机

所有战斗动画都在信息模态框弹出前执行完毕（模态框遮挡后动画不可见）。但并非所有动作都需要设计专属 GSAP 动画：

- 攻击 → 需要冲撞动画模拟"打击"过程
- 受击 → 需要摇晃动画模拟"被打"反应
- 逃跑 → 不需要复杂动画，弹个"风纹"图标立绘就能传达意图
- 治疗 → 不需要复杂动画，弹个"加号"图标立绘就能传达意图
- Buff → 不需要复杂动画，弹个"光芒"图标立绘就能传达意图

**意图动画**就是给"不需要设计专属动画的动作"提供的兜底模板：用一个简单的小型图标立绘弹出表达"这个动作发生了"。

### 7.2 与结果动画的关系

| 类型 | 定义 | 例子 | 复杂度 |
|------|------|------|--------|
| 结果动画 | 需要设计专属 GSAP 动画模拟物理过程 | 攻击冲撞、受击摇晃、死亡倒下 | 高（多段 timeline） |
| 意图动画 | 兜底模板，弹小型图标立绘传达意图 | 逃跑（风纹）、治疗（加号）、Buff（光芒） | 低（单次 popUp） |

两者不是对立关系，而是"按动作复杂度选择"的两种策略。同一个动作链中可能既有结果动画也有意图动画（如：攻击用结果动画，逃跑用意图动画）。核心区别是**是否有必要设计专属动画**——攻击需要模拟打击过程，治疗弹个加号就够了。

### 7.3 实现方案

意图动画的本质是"小型图标立绘弹出"，与场景立绘共用 popUp 机制（见 §8）。区别仅在于图片素材的尺度——图标立绘是小型的、符号化的黑白图片，场景立绘是大型的、场景化的黑白图片。

```typescript
// 新增 illustration-popup.ts（统一立绘弹出入口）
function popIconIllustration(
  actorId: string,
  iconId: string,           // 图标立绘资源 id（见 §7.4 资源表）
  duration?: number,        // 默认 800ms
): void;
```

动画：图标立绘从小到大弹出（back.out）→ 停留 0.5s → 飘走淡出

调用方式：

```typescript
// player-avatar.ts
function onFlee(): void {
  popIconIllustration('player', 'flee');
  // 不需要派 'flee' intent 播放专属动画
}

function onSelfCast(kind: 'heal' | 'buff'): void {
  const iconId = kind === 'heal' ? 'heal' : 'buff';
  popIconIllustration('player', iconId);
}
```

### 7.4 图标立绘资源表

所有图标立绘都是**黑白单色图片素材**（非 Unicode emoji，因 OS 着色的 emoji 与单色界面冲突），由美术提供或从开源单色图标库选取：

| iconId | 用途 | 视觉描述 |
|--------|------|---------|
| `flee` | 逃跑 | 风的纹样 / 匆忙脚步剪影 |
| `heal` | 治疗 | 加号 / 十字纹样 |
| `buff` | 状态增强 | 光芒纹样 / 上升箭头 |
| `crit` | 暴击 | 爆裂纹样 / 感叹号 |
| `stun` | 眩晕 | 螺旋纹样 / 星星环绕 |
| `surprise` | 惊讶 | 问号纹样 |
| `angry` | 暴怒 | 怒气纹样 |

### 7.5 实施时机

当出现不需要专属动画的动作（逃跑/治疗/Buff）时实施。当前 `isFled` 状态标记保留，只需在 `onFlee` 里追加 `popIconIllustration('player', 'flee')` 即可。

---

## 八、视觉风格原则：立绘弹出

### 8.1 风格约束

项目采用基本黑白的单色界面。以下视觉手段与单色美学冲突，明确不使用：

- Unicode emoji（OS 着色，颜色不可控）
- 彩色粒子 / 彩色光点
- 屏幕闪白 / 屏幕变色
- 彩色震波 / 彩色圆环
- 残影（半透明 clone）

### 8.2 统一机制：立绘弹出

所有"特效"和"意图反馈"都通过**同一种机制**实现——黑白图片素材 + popUp 动画。按素材尺度分两层：

**小型图标立绘（轻量层）**

用于表达角色情绪/意图，悬浮在角色上方，符号化的单色小图。详见 §7（意图动画）。

```
  [风纹]
  ┌─┐
  │玩│
  └─┘
```

**大型场景立绘（重量层）**

用于模拟"环境/技能特效"，场景化的单色大图，通过不同图层的立绘弹出表达视觉冲击：

```
BOSS 钻出土地：
  ① 弹出"土地裂纹"场景立绘层（popUp 动画）
  ② 弹出 BOSS 立绘层（popUp 动画）
  → 两层立绘叠加，形成"破土而出"的视觉序列

重击命中：
  ① 弹出"冲击纹样"场景立绘层（命中点 popUp）
  → 替代传统震波闪屏

AOE 爆发：
  ① 弹出"扩散纹样"场景立绘层（popUp + scale 放大）
  → 替代彩色震波扩散
```

**核心原则**：所有视觉反馈都是黑白图片素材的弹出/淡出，与角色立绘共用同一套 popUp 动画机制，保证视觉语言统一。BOSS 钻出土地不是播放粒子特效，而是先弹土地裂纹立绘、再弹 BOSS 立绘——通过图层序列模拟"破土而出"的视觉过程。逃跑不是弹彩色 emoji，而是弹黑白"风纹"图标立绘——与整体单色风格一致。

### 8.3 立绘资源管理

所有立绘素材（图标级 + 场景级）集中在资源目录管理：

```
assets/illustrations/
  icons/        # 小型图标立绘（情绪/意图）
    flee.png
    heal.png
    buff.png
    crit.png
    stun.png
    ...
  scenes/       # 大型场景立绘（环境/技能）
    ground-crack.png
    impact-burst.png
    shockwave-pattern.png
    energy-gather.png
    ...
```

由 popUp 机制统一渲染，动画参数（弹出位置、缩放、时长）由调用方指定。

### 8.4 与 ActionAnimationSpec 的整合

`ActionAnimationSpec` 扩展 `illustrations` 字段：

```typescript
interface ActionAnimationSpec {
  // ... 原有字段
  illustrations?: {
    onWindup?: string[];    // 蓄力阶段弹出的立绘 id
    onImpact?: string[];    // 命中瞬间弹出的立绘 id
    onRecover?: string[];   // 后摇阶段弹出的立绘 id
  };
}
```

立绘 id 对应 `assets/illustrations/` 下的资源（如 `'ground-crack'`、`'impact-burst'`、`'flee'`、`'heal'`），由 popUp 机制统一渲染。

---

## 九、渐进式实施路径

### 9.1 实施触发点

本设计案**不主动实施**，按以下触发点渐进推进：

| 触发点 | 启动内容 |
|--------|---------|
| 后端出现第二种 action_id（如治疗） | 扩展 `decideAnimation` + `ActionAnimationSpec` 支持自我施法 |
| 后端出现远程攻击 | 实现 `ranged` 飞行物 + `ActionAnimationSpec.impactAt` 含飞行时间 |
| 后端出现 AOE 技能 | 实现 `targetMode: 'simultaneous'` 多目标受击 |
| 出现 BOSS 战 | 实现 `charge-cast` + 三阶段模型 + 场景立绘弹出 |
| 逃跑/治疗/Buff 需要视觉反馈 | 实施意图动画（图标立绘兜底模板） |
| 受击效果需差异化 | 扩展 `HitKind` + 重击/击飞等动画 |

### 9.2 演进原则

1. **按需提取，不提前抽象**：当前 `ActionAnimationSpec` 只覆盖 collision，等第二种动作形态出现时再扩展接口
2. **接口先行**：新动作先在 `ActionAnimationSpec` 定义规格，再实现动画函数，最后接入 battle.ts
3. **动画函数独立**：每种 `AttackKind` / `HitKind` 对应独立的动画函数（如 `attackAnim` / `heavyHitAnim` / `launchHitAnim`），不混用条件分支
4. **规格表集中管理**：所有动作规格集中在 `action-specs.ts`，battle.ts 零硬编码
5. **意图动画优先**：新动作先考虑图标立绘兜底，确有必要再设计专属 GSAP 动画
6. **立绘统一**：所有视觉反馈（意图/特效）都用黑白图片素材 + popUp 机制，不引入 Unicode emoji 或彩色 VFX

### 9.3 与当前架构的兼容性

当前已实现的 `ActionAnimationSpec` 接口（`attacker.kind` + `attacker.impactAt` + `target.duration`）是未来扩展的子集。演进路径：

```
当前：ActionAnimationSpec { attacker, target }    // 必有受击
  ↓ 扩展 target 为可选
中期：ActionAnimationSpec { attacker, target? }    // 支持自我施法
  ↓ 扩展 target.kind + illustrations
后期：ActionAnimationSpec { attacker, target?, illustrations? }  // 支持差异化受击+立绘弹出
```

每一步都是向后兼容的接口扩展，不破坏已实现的 M1-M4 代码。

---

## 十、关联文档

- [BATTLE_ACTOR_ANIMATION_DESIGN.md](./BATTLE_ACTOR_ANIMATION_DESIGN.md) — 当前已实现的 M1-M4 设计案
- [BATTLE_ACTOR_ANIMATION_REQUIREMENTS.md](./BATTLE_ACTOR_ANIMATION_REQUIREMENTS.md) — 原始需求文档
- [oblivions/DESIGN.md](../../oblivions/DESIGN.md) §2.7、§2.18 — 后端战斗系统与播放三段式

---

## 附录：讨论沉淀记录

以下洞察来自 M1-M4 实施过程中的讨论，作为本设计案的理论基础：

### A.1 isFled 启发（2026-07-01）

> 逃跑和攻击从游戏语义上不相关，但从后端执行顺序和导演渲染看都是"一次动作"。动画编排应该按动作次为单位，而非"攻击+受击"固定两阶段。

### A.2 自我治疗场景（2026-07-01）

> 自我治疗技能需要在"动作动画阶段"播放施法动画，但不触发受击。当前 collision 分支的"攻击+受击"成对假设无法覆盖此场景，需要扩展为"可选受击"的编排模型。

### A.3 受击效果差异化（2026-07-01）

> 当前普通受击（3 段动漫感）已满足普通攻击。夸张的左右抖动留作未来"重击/致命攻击"的受击效果，通过 HitKind 区分。

### A.4 意图动画兜底模板（2026-07-01）

> 逃跑淡出动画因 BattleModal 遮挡无视觉效果。根因：逃跑不需要专属动画，强行设计淡出是多余的。改为意图动画（图标立绘兜底模板）：弹个"风纹"图标立绘传达"逃跑"意图即可。治疗/Buff 同理——弹"加号"/"光芒"比设计专属施法动画更简单有效。意图动画 = 给不需要专属动画的动作加的默认模板。

### A.5 视觉风格原则：立绘统一（2026-07-01）

> 黑白单色界面下，Unicode emoji（OS 着色）和传统彩色 VFX（粒子/闪屏/震波）都破坏视觉一致性。统一用"立绘弹出"机制：所有视觉反馈都是黑白图片素材 + popUp 动画，按素材尺度分两层——小型图标立绘（情绪/意图，如风纹/加号/光芒）和大型场景立绘（环境/技能，如土地裂纹/冲击爆发）。BOSS 钻出土地 = 弹土地裂纹立绘 → 弹 BOSS 立绘；逃跑 = 弹风纹图标立绘。两者共用同一套 popUp 机制，保证视觉语言统一。
