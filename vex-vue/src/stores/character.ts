/**
 * @module K 状态管理层
 * @framework K-5 角色数据枢纽
 */

// ══════════════════════════════════════════════════
// CharacterHub — 角色数据分发中心
//
// 以 pid 为 key 的统一角色数据中心，消除敌人数据在
// mapStore.enemies / combatContext.combatants / battleStore.enemyLocation 之间的分裂。
//
// 写入入口：
//   - replaceMapEnemies(enemies)    ← enemies 完整地图 roster
//   - mergeEnemyPatches(enemies)    ← combat_targets 等资料 patch
//   - mergePlayer(playerInfo)       ← player_info scope（玩家自身）
//   - mergeCombatContext(context)   ← player_info.combat_context（战斗派生字段）
//
// 读取出口（computed / getter）：
//   - mapVisibleList ← 玩家 + enemies roster 中的存活 NPC，供 entities 渲染
//   - aliveList   ← 资料缓存中的所有存活角色
//   - enemyList   ← 所有存活敌人（type > 0）
//   - player      ← 玩家自身（type === 0）
//   - getCharacter(pid) ← 按 pid 查询
//
// 关联文档：oblivions/docs/地图实体真值源统一设计案.md
// ══════════════════════════════════════════════════

import { defineStore } from 'pinia';
import { reactive, computed, shallowRef } from 'vue';
import { useMapStore } from '@/stores/map';
import type { Character, CombatState } from '@/types/character';
import type { CombatViewModel, Enemy, PlayerInfo } from '@/types/api';

/** player_info.equipment 的 7 槽 key → Character 装备索引字段名 */
const EQUIPMENT_SLOT_TO_KEY: Record<string, keyof Character> = {
  wep:  'wepid',
  wep2: 'wep2id',
  arb:  'arbid',
  arh:  'arhid',
  ara:  'araid',
  arf:  'arfid',
  art:  'artid',
};

/** 数值字段统一转 number（API 字符串值 → number） */
function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** 字符串字段统一转 string */
function str(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

/** 把 Enemy（enemies scope，字符串数值）归一化为 Character patch */
function normalizeEnemy(enemy: Enemy, replaceStatusProjection = false): Partial<Character> {
  const patch: Partial<Character> = {
    pid: num(enemy.pid),
    type: num(enemy.type),
    name: str(enemy.name),
    gd: str(enemy.gd),
    icon: str(enemy.icon),
    action: str(enemy.action),
    bid: num(enemy.bid),
    hp: num(enemy.hp),
    mhp: num(enemy.mhp),
    sp: num(enemy.sp),
    msp: num(enemy.msp),
    att: num(enemy.att),
    def: num(enemy.def),
    ap: num(enemy.ap),
    max_ap: num(enemy.max_ap),
    pgroup: num(enemy.pgroup),
    pls: num(enemy.pls),
    lvl: num(enemy.lvl),
    exp: num(enemy.exp),
    state: num(enemy.state),
    itemmaxslots: num(enemy.itemmaxslots),
    wepid: str(enemy.wepid),
    wep2id: str(enemy.wep2id),
    arbid: str(enemy.arbid),
    arhid: str(enemy.arhid),
    araid: str(enemy.araid),
    arfid: str(enemy.arfid),
    artid: str(enemy.artid),
    itemIds: Array.isArray(enemy.itemIds) ? enemy.itemIds.map(str) : [],
    discovered: num(enemy.discovered) === 1,
  };
  if (replaceStatusProjection || Array.isArray(enemy.statuses)) patch.statuses = enemy.statuses ?? [];
  if (replaceStatusProjection || enemy.capabilities !== undefined) patch.capabilities = enemy.capabilities ?? {};
  return patch;
}

/** 把 PlayerInfo（player_info scope）归一化为 Character patch */
function normalizePlayer(playerInfo: PlayerInfo): Partial<Character> {
  const patch: Partial<Character> = {
    pid: num(playerInfo.pid),
    type: num(playerInfo.type),
    name: str(playerInfo.name),
    gd: str(playerInfo.gd),
    icon: str(playerInfo.icon),
    action: str(playerInfo.action),
    bid: num(playerInfo.bid),
    hp: num(playerInfo.hp),
    mhp: num(playerInfo.mhp),
    sp: num(playerInfo.sp),
    msp: num(playerInfo.msp),
    att: num(playerInfo.att),
    def: num(playerInfo.def),
    ap: num(playerInfo.ap),
    max_ap: num(playerInfo.max_ap),
    pgroup: num(playerInfo.pgroup),
    pls: num(playerInfo.pls),
    lvl: num(playerInfo.lvl),
    exp: num(playerInfo.exp),
    state: num(playerInfo.state),
    itemmaxslots: num(playerInfo.itemmaxslots),
    itemIds: Array.isArray(playerInfo.itemIds) ? playerInfo.itemIds.map(str) : [],
    // player_info 不返回 discovered，玩家自身始终可见
    discovered: true,
    statuses: Array.isArray(playerInfo.statuses) ? playerInfo.statuses : [],
    capabilities: playerInfo.capabilities ?? {},
  };

  // 装备索引：从 equipment.{slot}.item_id 提取 7 槽模板 ID
  if (playerInfo.equipment && typeof playerInfo.equipment === 'object') {
    for (const [slotKey, charField] of Object.entries(EQUIPMENT_SLOT_TO_KEY)) {
      const slot = playerInfo.equipment[slotKey];
      const itemId = slot?.item_id ?? slot?.itmid ?? '';
      (patch as Record<string, unknown>)[charField] = str(itemId);
    }
  }

  return patch;
}

export const useCharacterStore = defineStore('character', () => {
  /** pid → Character 的响应式 Map（唯一真值源） */
  const characters = reactive<Map<number, Character>>(new Map());
  /** enemies scope 的完整地图投影 roster；候选数据不得修改它。 */
  const mapEnemyPids = shallowRef<ReadonlySet<number>>(new Set());

  // ══════════════════════════════════════════════════
  // 写入方法
  // ══════════════════════════════════════════════════

  /** 只合并角色资料；不得改变 MapGrid 的权威可见 roster。 */
  function mergeEnemyPatches(enemies: Enemy[]): void {
    for (const enemy of enemies) {
      const pid = num(enemy.pid);
      const existing = characters.get(pid);
      const patch = normalizeEnemy(enemy);
      const base = existing ?? ({ statuses: [], capabilities: {} } as Partial<Character>);
      characters.set(pid, { ...base, ...(patch as Character) } as Character);
    }
  }

  /** enemies scope 是完整 roster：合并资料后原子替换地图 NPC 成员集合。 */
  function replaceMapEnemies(enemies: Enemy[]): void {
    for (const enemy of enemies) {
      const pid = num(enemy.pid);
      const existing = characters.get(pid);
      const patch = normalizeEnemy(enemy, true);
      characters.set(pid, { ...(existing as Character), ...(patch as Character) } as Character);
    }
    mapEnemyPids.value = new Set(enemies.map(enemy => num(enemy.pid)).filter(pid => pid > 0));

    const currentRegion = num(useMapStore().curRegion);
    for (const [pid, character] of characters) {
      if (character.type === 0 || mapEnemyPids.value.has(pid)) continue;
      if (currentRegion > 0 && character.pgroup !== currentRegion && !character.combat?.inCombat) {
        characters.delete(pid);
      }
    }
  }

  /**
   * 合并 player_info scope 数据（玩家自身）
   *
   * 语义：合并更新（已存在的角色更新字段，新角色插入）
   * 装备索引从 equipment 结构提取，discovered 主动设 true（player_info 不返回此字段）。
   */
  function mergePlayer(playerInfo: PlayerInfo): void {
    const pid = num(playerInfo.pid);
    if (pid <= 0) return;
    const existing = characters.get(pid);
    const patch = normalizePlayer(playerInfo);
    characters.set(pid, { ...(existing as Character), ...(patch as Character) } as Character);
  }

  /**
   * 合并 combat_context 数据（战斗派生字段）
   *
   * 语义：替换更新（完整覆盖 Character.combat 字段）
   * 1. context === null：所有角色 combat 置 undefined
   * 2. context 非 null：
   *    - 在 combatants 中的角色：写入 CombatState，并用 combatant 的标准字段
   *      （hp/mhp/ap/max_ap/pls/state，(int) 强转的数字）覆盖 Character 对应字段
   *    - 不在 combatants 中的角色：combat 置 undefined
   *
   * combatants 包含玩家自身（玩家是战斗发起者在队列中），因此 mergeCombatContext
   * 会为玩家写入 CombatState.inCombat=true，entities 渲染时玩家 actor 不会半透明。
   */
  function mergeCombatContext(context: CombatViewModel | null): void {
    if (context === null) {
      for (const c of characters.values()) {
        c.combat = undefined;
      }
      return;
    }

    const combatantPids = new Set<number>();
    for (const combatant of context.combatants) {
      const pid = combatant.pid;
      combatantPids.add(pid);
      const existing = characters.get(pid);
      if (!existing) continue;

      // 写入 CombatState
      const combat: CombatState = {
        inCombat: true,
        active: combatant.active,
        done: combatant.done,
        myorder: combatant.myorder,
      };
      existing.combat = combat;

      // 用 combat_context 的 (int) 强转数字覆盖标准字段（比 enemies scope 的字符串更准确）
      existing.hp = combatant.hp;
      existing.mhp = combatant.mhp;
      existing.ap = combatant.ap;
      existing.max_ap = combatant.max_ap;
      existing.pls = combatant.pls;
      existing.state = combatant.state;
      existing.pgroup = combatant.pgroup;
    }

    // 不在 combatants 中的角色：combat 置 undefined
    for (const [pid, c] of characters) {
      if (!combatantPids.has(pid)) {
        c.combat = undefined;
      }
    }
  }

  // ══════════════════════════════════════════════════
  // 读取方法
  // ══════════════════════════════════════════════════

  /** 按 pid 查询角色 */
  function getCharacter(pid: number): Character | undefined {
    return characters.get(pid);
  }

  /** 所有存活角色（state === 0）。供 entities 渲染所有可见实体。 */
  const aliveList = computed<Character[]>(() =>
    [...characters.values()].filter(c => Number(c.state) === 0),
  );

  /** MapGrid 的权威 roster：玩家 + enemies 完整快照中的存活 NPC。 */
  const mapVisibleList = computed<Character[]>(() => {
    const visible: Character[] = [];
    for (const character of characters.values()) {
      if (Number(character.state) !== 0) continue;
      if (character.type === 0 || mapEnemyPids.value.has(character.pid)) visible.push(character);
    }
    return visible;
  });

  /** 所有存活敌人（type > 0） */
  const enemyList = computed<Character[]>(() =>
    aliveList.value.filter(c => c.type > 0),
  );

  const mapEnemyList = computed<Character[]>(() =>
    mapVisibleList.value.filter(c => c.type > 0),
  );

  /** 玩家自身（type === 0） */
  const player = computed<Character | undefined>(() =>
    [...characters.values()].find(c => c.type === 0),
  );

  return {
    characters,
    mapEnemyPids,
    mergeEnemyPatches,
    replaceMapEnemies,
    mergePlayer,
    mergeCombatContext,
    getCharacter,
    aliveList,
    mapVisibleList,
    enemyList,
    mapEnemyList,
    player,
  };
});
