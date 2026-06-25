# Battlelog 播放增强设计案

## 1. 问题分析

### 1.1 现状

当前 battlelog 播放只展示攻击伤害日志（`unarmed_strike`），丢失了大量战斗流程信息：

| 丢失的信息 | 后端已有日志 | 前端处理 |
|-----------|-------------|---------|
| 玩家突袭 NPC | `initiative.roll`（extra.ambush_pid） | phase 过滤 + 模板返回空字符串 |
| 先攻掷骰结果 | `initiative.roll`（extra.rolls） | 同上 |
| 先攻队列建立 | `queue_create` | phase 过滤 + 模板返回空字符串 |
| 先攻队列重建 | `queue_rebuild` | phase 过滤 + 无模板 |
| 队列状态更新 | `queue_update` | phase 过滤 + 模板返回空字符串 |
| AP 恢复 | `ap_recover` | phase 过滤 + 模板返回空字符串 |
| 战斗结束 | `battle_end` | phase 过滤（phase=finish_check） |

### 1.2 根因

1. **前端 phase 过滤过于严格**：`playBattleLogGroup` 中 `entries.filter((e) => e.phase === 'excute')` 只保留执行阶段的日志
2. **后端缺少 turn 字段**：emit 时没有写入 turn 字段，前端无法按回合分组
3. **模板缺失**：`initiative.roll`/`queue_create`/`queue_update` 模板返回空字符串，`queue_rebuild` 无模板
4. **缺少"回合开始"事件**：没有 `turn_start` 日志，无法体现回合交替

### 1.3 期望效果

用户希望看到的播放流程（以玩家突袭 NPC 为例）：

```
—— 第 1 回合 ——
玩家突袭了 NPC！
玩家对 NPC 使用了空手攻击，造成 50 点伤害。
—— 先攻队列已建立 ——
先攻掷骰：玩家 15 点，NPC 8 点。
玩家取得先攻。

—— 第 2 回合 ——
AP 恢复 2 点。
—— 先攻队列已重建 ——
先攻掷骰：玩家 12 点，NPC 18 点。
NPC 取得先攻。
NPC 对玩家使用了空手攻击，造成 30 点伤害。

—— 战斗结束 ——
你击败了 NPC！
```

---

## 2. 后端改动

### 2.1 BattleLogCollector 添加 turn 字段

**文件**：`oblivions/include/game/battle_log.func.php`

```php
class BattleLogCollector {
    private $entries = [];
    private $phase = '';
    private $turn = 0;  // 新增

    public function setPhase($phase) {
        $this->phase = (string)$phase;
    }

    // 新增
    public function setTurn($turn) {
        $this->turn = (int)$turn;
    }

    // 新增
    public function getTurn() {
        return $this->turn;
    }

    // 新增：turn 递增
    public function incrementTurn() {
        $this->turn++;
    }

    public function emit(array $params) {
        $this->entries[] = [
            // ... 现有字段
            'ts'           => time(),
            'phase'        => $this->phase,
            'turn'         => $this->turn,  // 新增
        ];
    }
}
```

### 2.2 battle_new_turn 设置 turn

**文件**：`oblivions/include/game/battle/battle.main.php`

```php
function battle_new_turn(&$actor_data, &$obl_battle_log)
{
    $battle_cache = [];

    // 新增：回合递增 + emit 回合开始日志
    $obl_battle_log->incrementTurn();
    $obl_battle_log->emit([
        'actor_pid'   => (int)$actor_data['pid'],
        'actor_type'  => (int)$actor_data['type'],
        'target_pid'  => 0,
        'target_type' => -1,
        'action_id'   => 'turn_start',
        'extra'       => [
            'turn' => $obl_battle_log->getTurn(),
        ],
    ]);

    $obl_battle_log->setPhase('prepare');
    battle_prepare($actor_data, $battle_cache, $obl_battle_log);
    battle_queue_update($actor_data, $obl_battle_log, $battle_cache);
    obl_save_player($actor_data);
}
```

### 2.3 queue_create 添加 is_rebuild 标记

**文件**：`oblivions/include/game/battle/battle.func.php`

`queue_create`/`queue_rebuild` 的 emit 已经通过 action_id 区分，但 extra 中需要补充 `is_rebuild` 标记和先攻者信息：

```php
// queue_create 的 emit（第 143-152 行附近）
$obl_battle_log->emit([
    'actor_pid'   => (int)$actor_data['pid'],
    'actor_type'  => (int)$actor_data['type'],
    'target_pid'  => 0,
    'target_type' => -1,
    'action_id'   => $is_rebuild ? 'queue_rebuild' : 'queue_create',
    'extra'       => [
        'qid' => $qid,
        'combatants' => $combatants,
        'is_rebuild' => $is_rebuild,  // 新增
        'first_pid'  => $initiative_result[0]['pid'] ?? 0,  // 新增：先攻者 PID
        'first_type' => $initiative_result[0]['type'] ?? 0,  // 新增：先攻者类型
    ],
]);
```

### 2.4 不需要新增 ambush 事件

`initiative.roll` 已经包含 `ambush_pid` 字段，前端模板可以据此判断是否是突袭，不需要新增 action_id。

---

## 3. 前端改动

### 3.1 取消 phase 过滤

**文件**：`vex-vue/src/stores/battle.ts`

`playBattleLogGroup` 中取消 `phase === 'excute'` 过滤，改为播放所有条目：

```typescript
async function playBattleLogGroup(
  entries: BattleLogEntry[],
  npcPid: number,
): Promise<void> {
  // 移除 phase 过滤，播放所有条目
  // 按 log_id 升序排序（确保播放顺序正确）
  const sortedEntries = [...entries].sort(
    (a, b) => Number(a.log_id || 0) - Number(b.log_id || 0),
  );
  if (sortedEntries.length === 0) return;

  const context = await buildPlayContext(npcPid);
  playContext.value = context;

  // 从 battlelog 重建初始 HP（只处理有 HP 快照的条目）
  rebuildInitialHpFromEntries(context, sortedEntries);

  enemyName.value = context.enemyName;
  enemyLocation.value = context.npcLocation;

  // 1. 碰撞动画（只对 unarmed_strike，其他 action_id 被 CollisionAnimation 显式跳过）
  for (const entry of sortedEntries) {
    if (entry.action_id === 'unarmed_strike') {
      dataManager.broadcast('battle:play-collision', { entry, npcPid });
      await sleep(COLLISION_ANIM_DURATION);
    }
  }

  // 2. 模态框（所有条目，模板返回空字符串的自然跳过）
  battleLogEntries.value = sortedEntries;
  battleModalOpen.value = true;
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      _modalResolve = null;
      resolve();
    }, MODAL_TIMEOUT);
    _modalResolve = () => {
      clearTimeout(timeout);
      resolve();
    };
  });

  // 3. 伤害数字（只对 unarmed_strike）
  dataManager.broadcast('battle:play-damage-numbers', {
    entries: sortedEntries,
    npcPid,
  });
}
```

### 3.2 补全模板

**文件**：`vex-vue/src/data/battle-templates.ts`

```typescript
export const BATTLE_TEMPLATES: Record<string, BattleTemplate> = {
  // ── 回合开始 ──
  turn_start: {
    render(entry, ctx) {
      const turn = entry.extra?.turn ?? '?';
      return `<div class="turn-divider">—— 第 ${turn} 回合 ——</div>`;
    },
  },

  // ── 先攻掷骰 ──
  'initiative.roll': {
    render(entry, ctx) {
      const extra = entry.extra || {};
      const rolls = extra.rolls || [];
      const ambushPid = extra.ambush_pid || 0;

      // 突袭提示
      if (ambushPid > 0) {
        const ambusher = ambushPid === ctx.playerPid ? '你' : ctx.enemyName;
        return `<span class="yellow">${escapeHtml(ambusher)}</span>突袭了对手！`;
      }

      // 正常先攻掷骰
      const rollTexts = rolls.map((r: any) => {
        const name = r.pid === ctx.playerPid ? '你' : ctx.enemyName;
        return `${escapeHtml(name)} ${r.myorder} 点`;
      });
      return `先攻掷骰：${rollTexts.join('，')}。`;
    },
  },

  // ── 队列创建/重建 ──
  queue_create: {
    render(entry, ctx) {
      const extra = entry.extra || {};
      const firstPid = extra.first_pid || 0;
      const firstName = firstPid === ctx.playerPid ? '你' : ctx.enemyName;
      return `先攻队列已建立。<span class="yellow">${escapeHtml(firstName)}</span>取得先攻。`;
    },
  },
  queue_rebuild: {
    render(entry, ctx) {
      const extra = entry.extra || {};
      const firstPid = extra.first_pid || 0;
      const firstName = firstPid === ctx.playerPid ? '你' : ctx.enemyName;
      return `先攻队列已重建。<span class="yellow">${escapeHtml(firstName)}</span>取得先攻。`;
    },
  },

  // ── 队列更新 ──
  queue_update: {
    render(entry, ctx) {
      const extra = entry.extra || {};
      const remaining = extra.remaining ?? '?';
      return `队列更新：剩余 ${remaining} 人待行动。`;
    },
  },

  // ── AP 恢复 ──
  ap_recover: {
    render(entry, ctx) {
      const amount = entry.effect_value || 0;
      if (amount <= 0) return '';
      return `<span class="yellow">你</span>恢复了 ${amount} 点 AP。`;
    },
  },

  // ── 战斗结束（已有，保持不变） ──
  battle_end: {
    render(entry, ctx) {
      if (Number(entry.actor_type) !== 0) {
        return `═══ 战斗胜利！你击败了 ${escapeHtml(ctx.enemyName)} ═══`;
      }
      return `═══ 战斗结束 ═══`;
    },
  },

  // ── 攻击（已有，保持不变） ──
  unarmed_strike: { /* 保持不变 */ },
  escape: { /* 保持不变 */ },
};
```

### 3.3 BattleModal 支持回合分隔符

**文件**：`vex-vue/src/components/battle/BattleModal.vue`

`turn_start` 模板返回的是 `<div class="turn-divider">`，BattleModal 的渲染逻辑已经支持 HTML，所以不需要额外改动。只需添加 CSS 样式：

```css
.turn-divider {
  text-align: center;
  color: #888;
  font-size: 0.9em;
  margin: 8px 0;
  border-top: 1px dashed #555;
  border-bottom: 1px dashed #555;
  padding: 4px 0;
}
```

### 3.4 分组逻辑重构（支持多 NPC + 流程/战斗分离）

**文件**：`vex-vue/src/stores/battle.ts`

#### 3.4.1 设计原则

1. **流程信息与战斗动画分离**：无目标条目（`turn_start`/`initiative.roll`/`queue_create`/`queue_rebuild`/`queue_update`/`ap_recover`/`battle_end`）单独播放一个模态框，不与攻击日志混在一起
2. **按战斗对分组攻击日志**：有目标条目（`unarmed_strike`/`escape`）按"战斗对"（无序对 `{min(pid1,pid2), max(pid1,pid2)}`）分组，每个战斗对单独播放一个模态框
3. **先攻轮交换不拆分**：`actor_pid` 和 `target_pid` 互换的条目属于同一战斗对（如玩家攻击 NPC → NPC 攻击玩家），不分开播放
4. **保持时序顺序**：按 `log_id` 升序扫描，流程信息和战斗动画交替播放

#### 3.4.2 分组算法

```typescript
/** 播放组类型 */
interface PlayGroup {
  /** flow=流程信息模态框，combat=战斗动画模态框 */
  type: 'flow' | 'combat';
  /** combat 组的 NPC pid（flow 组为 0） */
  npcPid: number;
  /** 该组的日志条目 */
  entries: BattleLogEntry[];
}

/**
 * 将 battlelog 条目按"流程信息/战斗动画"分类，并按战斗对分组
 *
 * 扫描顺序：按 log_id 升序
 * 分组规则：
 * - 无目标条目（target_pid==0 或 target_type==-1）→ 积累到 flow 缓冲区
 * - 有目标条目（actor_pid>0 且 target_pid>0）→ 按战斗对分组到 combat 组
 * - 类型切换时刷新缓冲区（flow→combat 或 combat→flow 或 combat 战斗对变化）
 */
function groupEntriesForPlayback(entries: BattleLogEntry[]): PlayGroup[] {
  const sorted = [...entries].sort(
    (a, b) => Number(a.log_id || 0) - Number(b.log_id || 0),
  );
  const groups: PlayGroup[] = [];
  let flowBuffer: BattleLogEntry[] = [];
  let combatGroup: { npcPid: number; entries: BattleLogEntry[] } | null = null;

  function flushFlow(): void {
    if (flowBuffer.length > 0) {
      groups.push({ type: 'flow', npcPid: 0, entries: flowBuffer });
      flowBuffer = [];
    }
  }

  function flushCombat(): void {
    if (combatGroup) {
      groups.push({
        type: 'combat',
        npcPid: combatGroup.npcPid,
        entries: combatGroup.entries,
      });
      combatGroup = null;
    }
  }

  for (const entry of sorted) {
    const actorPid = Number(entry.actor_pid);
    const targetPid = Number(entry.target_pid);
    const actorType = Number(entry.actor_type);
    const targetType = Number(entry.target_type);
    const hasTarget = actorPid > 0 && targetPid > 0 && targetType > 0;

    if (hasTarget) {
      // 有目标条目（攻击日志）
      flushFlow(); // 先刷新流程信息缓冲区

      // 确定战斗对的 NPC pid（type>0 的那一方）
      const npcPid = actorType > 0 ? actorPid : targetPid;

      if (!combatGroup || combatGroup.npcPid !== npcPid) {
        // 战斗对变化，刷新当前战斗组
        flushCombat();
        combatGroup = { npcPid, entries: [] };
      }
      combatGroup.entries.push(entry);
    } else {
      // 无目标条目（流程信息）
      flushCombat(); // 先刷新当前战斗组
      flowBuffer.push(entry);
    }
  }

  // 刷新剩余的缓冲区
  flushFlow();
  flushCombat();

  return groups;
}
```

#### 3.4.3 播放逻辑

```typescript
async function playBattleLogGroup(
  entries: BattleLogEntry[],
  _npcPid: number, // 保留参数兼容旧调用，实际使用分组算法的 npcPid
): Promise<void> {
  const groups = groupEntriesForPlayback(entries);
  if (groups.length === 0) return;

  // 从 initiative.roll 日志中提取所有参战者 pid（用于多 NPC 上下文）
  const allNpcPids = extractAllNpcPids(entries);

  // 构建多 NPC 上下文
  const context = await buildPlayContext(allNpcPids);
  playContext.value = context;

  enemyName.value = context.npcName; // 主敌人名称
  enemyLocation.value = context.npcLocation;

  // 逐组播放
  for (const group of groups) {
    if (group.type === 'flow') {
      // 流程信息模态框：无 HP 条，只播放文本
      await playFlowModal(group.entries, context);
    } else {
      // 战斗动画模态框：有 HP 条 + 碰撞动画 + 伤害数字
      await playCombatModal(group.entries, group.npcPid, context);
    }
  }
}

/** 从 initiative.roll 日志中提取所有参战者 pid */
function extractAllNpcPids(entries: BattleLogEntry[]): number[] {
  const pids = new Set<number>();
  for (const e of entries) {
    if (e.action_id === 'initiative.roll' && e.extra) {
      const rolls = (e.extra as { rolls?: Array<{ pid: number; type: number }> }).rolls || [];
      for (const r of rolls) {
        if (r.type > 0) pids.add(r.pid);
      }
    }
  }
  // 兜底：从攻击日志中提取
  if (pids.size === 0) {
    for (const e of entries) {
      const actorType = Number(e.actor_type);
      const targetType = Number(e.target_type);
      if (actorType > 0) pids.add(Number(e.actor_pid));
      if (targetType > 0) pids.add(Number(e.target_pid));
    }
  }
  return Array.from(pids);
}
```

#### 3.4.4 流程信息模态框

```typescript
/** 播放流程信息模态框（无 HP 条，只有文本） */
async function playFlowModal(
  entries: BattleLogEntry[],
  ctx: BattlePlayContext,
): Promise<void> {
  // 过滤掉模板返回空字符串的条目
  const rendered = entries
    .map((e) => ({ entry: e, html: renderBattleLogEntryHtml(e, ctx) }))
    .filter((r) => r.html);

  if (rendered.length === 0) return;

  // 复用 BattleModal，但隐藏 HP 条
  battleLogEntries.value = rendered.map((r) => r.entry);
  battleModalOpen.value = true;
  // TODO: BattleModal 需要支持"无 HP 条模式"（通过 playContext 或新字段控制）
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      _modalResolve = null;
      resolve();
    }, MODAL_TIMEOUT);
    _modalResolve = () => {
      clearTimeout(timeout);
      resolve();
    };
  });
}
```

#### 3.4.5 战斗动画模态框

```typescript
/** 播放战斗动画模态框（有 HP 条 + 碰撞动画 + 伤害数字） */
async function playCombatModal(
  entries: BattleLogEntry[],
  npcPid: number,
  ctx: BattlePlayContext,
): Promise<void> {
  // 从攻击日志重建初始 HP
  rebuildInitialHpFromEntries(ctx, entries);

  // 1. 碰撞动画（只对 unarmed_strike）
  for (const entry of entries) {
    if (entry.action_id === 'unarmed_strike') {
      dataManager.broadcast('battle:play-collision', { entry, npcPid });
      await sleep(COLLISION_ANIM_DURATION);
    }
  }

  // 2. 模态框（显示 HP 条）
  battleLogEntries.value = entries;
  battleModalOpen.value = true;
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      _modalResolve = null;
      resolve();
    }, MODAL_TIMEOUT);
    _modalResolve = () => {
      clearTimeout(timeout);
      resolve();
    };
  });

  // 3. 伤害数字（只对 unarmed_strike）
  dataManager.broadcast('battle:play-damage-numbers', { entries, npcPid });
}
```

#### 3.4.6 groupByEncounter 简化

`groupByEncounter` 不再需要按 NPC pid 分组（分组逻辑移到 `groupEntriesForPlayback`），简化为：

```typescript
function groupByEncounter(entries: BattleLogEntry[]): { npcPid: number; entries: BattleLogEntry[] }[] {
  // 多 NPC 场景：所有条目归入同一组，由 groupEntriesForPlayback 进一步分组
  // npcPid 仅作为主敌人标识（用于 buildPlayContext 兜底）
  let primaryNpcPid = 0;
  for (const e of entries) {
    if (Number(e.actor_type) > 0) {
      primaryNpcPid = Number(e.actor_pid);
      break;
    }
    if (Number(e.target_type) > 0) {
      primaryNpcPid = Number(e.target_pid);
      break;
    }
  }
  if (primaryNpcPid === 0) return [];
  return [{ npcPid: primaryNpcPid, entries }];
}
```

### 3.5 BattlePlayContext 支持多 NPC

**文件**：`vex-vue/src/data/battle-templates.ts`

```typescript
/** NPC 信息（多 NPC 战斗时按 pid 索引） */
interface NpcInfo {
  name: string;
  hp: number;
  maxHp: number;
  location: string | number | null;
}

export interface BattlePlayContext {
  // ── 主敌人字段（兼容旧模板，取第一个 NPC） ──
  npcPid: number;
  npcName: string;
  npcHp: number;
  npcMaxHp: number;
  npcLocation: string | number | null;
  // ── 玩家字段 ──
  playerHp: number;
  playerMaxHp: number;
  playerName: string;
  playerPid: number; // 新增：玩家 PID（用于 displayActor/displayTarget 判断）
  // ── 多 NPC 索引（新增） ──
  npcs: Map<number, NpcInfo>;
  // ── 兼容旧字段名 ──
  enemyName: string;
  enemyHp: number;
  enemyMaxHp: number;
}
```

### 3.6 displayActor/displayTarget 支持多 NPC

**文件**：`vex-vue/src/data/battle-templates.ts`

```typescript
function displayActor(entry: BattleLogEntry, ctx: BattlePlayContext): string {
  if (Number(entry.actor_type) === 0) return '你';
  // 多 NPC：根据 actor_pid 查找对应名称
  const npcInfo = ctx.npcs?.get(Number(entry.actor_pid));
  return npcInfo?.name || ctx.npcName || '未知敌人';
}

function displayTarget(entry: BattleLogEntry, ctx: BattlePlayContext): string {
  if (Number(entry.target_type) === 0) return '你';
  if (Number(entry.target_type) > 0) {
    // 多 NPC：根据 target_pid 查找对应名称
    const npcInfo = ctx.npcs?.get(Number(entry.target_pid));
    return npcInfo?.name || ctx.npcName || '未知敌人';
  }
  return '';
}
```

### 3.7 buildPlayContext 支持多 NPC

**文件**：`vex-vue/src/stores/battle.ts`

```typescript
async function buildPlayContext(npcPids: number[]): Promise<BattlePlayContext> {
  const ctx: BattlePlayContext = {
    npcPid: npcPids[0] || 0,
    npcName: '敌人',
    npcHp: 0,
    npcMaxHp: 1,
    npcLocation: null,
    playerHp: 0,
    playerMaxHp: 1,
    playerName: '',
    playerPid: 0,
    npcs: new Map(),
    enemyName: '敌人',
    enemyHp: 0,
    enemyMaxHp: 1,
  };
  await refreshContextFromApi(ctx, npcPids);
  return ctx;
}

async function refreshContextFromApi(
  ctx: BattlePlayContext,
  npcPids: number[],
): Promise<void> {
  try {
    // 1. 拉取玩家信息
    const playerInfoResult = await dataManager.fetch('player_info', true);
    if (playerInfoResult.status === 'success' && playerInfoResult.data) {
      const playerInfo = playerInfoResult.data as PlayerInfo;
      ctx.playerHp = parseInt(String(playerInfo.hp)) || 0;
      ctx.playerMaxHp = parseInt(String(playerInfo.mhp)) || 1;
      ctx.playerName = playerInfo.name || '';
      ctx.playerPid = parseInt(String(playerInfo.pid)) || 0;
    }

    // 2. 拉取敌人列表，匹配所有 npcPids
    const enemiesResult = await dataManager.fetch('enemies', true);
    if (enemiesResult.status === 'success' && enemiesResult.data) {
      const enemies = (enemiesResult.data as { enemies?: Enemy[] }).enemies || [];
      for (const enemy of enemies) {
        const enemyPid = parseInt(String(enemy.pid));
        if (npcPids.includes(enemyPid)) {
          const info: NpcInfo = {
            name: enemy.name || '敌人',
            hp: parseInt(String(enemy.hp)) || 0,
            maxHp: parseInt(String(enemy.mhp)) || 1,
            location: enemy.pls || null,
          };
          ctx.npcs.set(enemyPid, info);

          // 主敌人（第一个 NPC）兼容旧字段
          if (enemyPid === ctx.npcPid) {
            ctx.npcName = info.name;
            ctx.npcHp = info.hp;
            ctx.npcMaxHp = info.maxHp;
            ctx.npcLocation = info.location;
            ctx.enemyName = info.name;
            ctx.enemyHp = info.hp;
            ctx.enemyMaxHp = info.maxHp;
          }
        }
      }
    }
  } catch (e) {
    console.error('[Battle] refreshContextFromApi error:', e);
  }
}
```

### 3.8 rebuildInitialHpFromEntries 支持多 NPC

**文件**：`vex-vue/src/stores/battle.ts`

```typescript
function rebuildInitialHpFromEntries(
  ctx: BattlePlayContext,
  entries: BattleLogEntry[],
): void {
  let playerHpSet = false;
  const npcHpSet = new Set<number>(); // 已设置初始 HP 的 NPC pid 集合

  for (const entry of entries) {
    if (!entry.extra) continue;
    const extra = entry.extra as {
      actor_oldhp?: number;
      target_oldhp?: number;
    };

    // 玩家初始 HP：第一条 actor_type=0 的 actor_oldhp
    if (
      !playerHpSet &&
      Number(entry.actor_type) === 0 &&
      extra.actor_oldhp !== undefined
    ) {
      ctx.playerHp = Number(extra.actor_oldhp);
      playerHpSet = true;
    }

    // NPC 初始 HP：按 target_pid 分组，每个 NPC 独立设置
    if (
      Number(entry.target_type) > 0 &&
      extra.target_oldhp !== undefined
    ) {
      const targetPid = Number(entry.target_pid);
      if (!npcHpSet.has(targetPid)) {
        const npcInfo = ctx.npcs.get(targetPid);
        if (npcInfo) {
          npcInfo.hp = Number(extra.target_oldhp);
          npcHpSet.add(targetPid);
          // 主敌人兼容旧字段
          if (targetPid === ctx.npcPid) {
            ctx.npcHp = npcInfo.hp;
            ctx.enemyHp = npcInfo.hp;
          }
        }
      }
    }

    if (playerHpSet && npcHpSet.size >= ctx.npcs.size) break;
  }
}
```

### 3.9 BattleModal 支持流程信息模式

**文件**：`vex-vue/src/components/battle/BattleModal.vue`

新增 `isFlowMode` 计算属性，根据 `playContext` 或 `battleLogEntries` 判断是否为流程信息模式（无 HP 条）：

```typescript
const isFlowMode = computed(() => {
  // 如果当前组的所有条目都是无目标条目，则为流程信息模式
  return battleStore.battleLogEntries.every(
    (e) => Number(e.target_pid) === 0 || Number(e.target_type) === -1,
  );
});
```

模板中用 `v-if="!isFlowMode"` 隐藏 HP 条区域。

---

## 4. 实施步骤

### 阶段1：后端（turn 字段 + emit 补全）
1. `battle_log.func.php`：BattleLogCollector 添加 `$turn` 属性 + `setTurn()`/`getTurn()`/`incrementTurn()` 方法 + emit 写入 turn 字段
2. `battle.main.php`：`battle_new_turn` 中调用 `incrementTurn()` + emit `turn_start` 日志
3. `battle.func.php`：`battle_queue_create` 的 queue_create/queue_rebuild emit 补充 `is_rebuild`/`first_pid`/`first_type` 字段

### 阶段2：前端类型与上下文（多 NPC 支持）
1. `battle-templates.ts`：`BattlePlayContext` 新增 `playerPid` + `npcs: Map<number, NpcInfo>` 字段；新增 `NpcInfo` 接口
2. `battle-templates.ts`：`displayActor`/`displayTarget` 改为根据 `actor_pid`/`target_pid` 从 `ctx.npcs` 查找名称
3. `battle.ts`：`buildPlayContext` 改为接收 `npcPids: number[]`；`refreshContextFromApi` 遍历所有 npcPids 填充 `npcs` Map
4. `battle.ts`：`rebuildInitialHpFromEntries` 改为按 `target_pid` 分组，为每个 NPC 独立设置初始 HP

### 阶段3：前端分组与播放（流程/战斗分离）
1. `battle.ts`：新增 `groupEntriesForPlayback` 函数（按 flow/combat 分类 + 战斗对分组）
2. `battle.ts`：新增 `extractAllNpcPids` 函数（从 initiative.roll 提取所有参战者 pid）
3. `battle.ts`：新增 `playFlowModal` 函数（流程信息模态框，无 HP 条）
4. `battle.ts`：新增 `playCombatModal` 函数（战斗动画模态框，有 HP 条 + 碰撞动画 + 伤害数字）
5. `battle.ts`：重写 `playBattleLogGroup`，改为调用 `groupEntriesForPlayback` + 逐组播放
6. `battle.ts`：简化 `groupByEncounter`（所有条目归入同一组，由 `groupEntriesForPlayback` 进一步分组）

### 阶段4：前端模板与样式
1. `battle-templates.ts`：补全 `turn_start`/`initiative.roll`/`queue_create`/`queue_rebuild`/`queue_update`/`ap_recover` 模板（使用 `ctx.npcs` 查找名称）
2. `BattleModal.vue`：新增 `isFlowMode` 计算属性，`v-if="!isFlowMode"` 隐藏 HP 条
3. `BattleModal.vue`：添加 `.turn-divider` CSS 样式

### 阶段5：验证
1. PHP 语法检查
2. TypeScript 类型检查
3. 实际战斗测试：突袭、正常先攻、队列重建、击杀、多 NPC 战斗

---

## 5. 边界情况

### 5.1 多 NPC 战斗（已支持）
- `groupEntriesForPlayback` 按战斗对（无序对）分组攻击日志，每个战斗对单独播放一个模态框
- `actor_pid` 和 `target_pid` 互换的条目属于同一战斗对，不分开播放（先攻轮交换）
- 无目标条目单独播放流程信息模态框，不与攻击日志混在一起
- `buildPlayContext` 从 `initiative.roll` 日志的 `extra.rolls` 中提取所有参战者 pid，构建多 NPC 上下文
- `displayActor`/`displayTarget` 根据 `actor_pid`/`target_pid` 从 `ctx.npcs` 查找对应名称

### 5.2 verify 阶段日志
`verify` 阶段的日志（技能校验失败）不播放，因为校验失败由命令拒绝（toast 提示）体现，不需要在 battlelog 中重复展示。

### 5.3 空模板跳过
模板返回空字符串的条目（如 `ap_recover` 恢复量为 0 时）会被 BattleModal 自然跳过，不显示。如果流程信息组的所有条目都返回空字符串，则该组不播放模态框（`playFlowModal` 中 `rendered.length === 0` 时直接 return）。

### 5.4 碰撞动画和伤害数字
`CollisionAnimation` 和 `DamageNumber` 已经显式跳过非 `unarmed_strike` 的 action_id，取消 phase 过滤后不会影响它们的行为。碰撞动画和伤害数字只在 `playCombatModal` 中触发，`playFlowModal` 不触发。

### 5.5 battle_end 日志的 actor_pid
`battle_end` 日志的 `actor_pid` 是**死亡方**的 pid（不是存活方）。模板中通过 `actor_type !== 0` 判断死亡方是 NPC 还是玩家，显示对应的"战斗胜利"或"战斗结束"文案。多 NPC 场景下，每个 NPC 死亡都会 emit 一条 `battle_end`，模板会根据 `actor_pid` 从 `ctx.npcs` 查找对应 NPC 名称。

### 5.6 敌人列表中找不到 NPC
如果 `enemies` API 返回的列表中找不到某个 NPC pid（如 NPC 已死亡从列表移除），`ctx.npcs` 中不会有该 NPC 的信息，`displayActor`/`displayTarget` 会回退到 `ctx.npcName` 或"未知敌人"。
