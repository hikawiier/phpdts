// ══════════════════════════════════════════════════
// CharacterHub — 角色数据分发中心
//
// 以 pid 为 key 的统一角色数据中心，消除敌人数据在
// mapStore.enemies / combatContext.combatants / battleStore.enemyLocation 之间的分裂。
//
// 写入入口（merge* 方法）：
//   - mergeEnemies(enemies)         ← enemies scope（探索态敌人列表）
//   - mergePlayer(playerInfo)       ← player_info scope（玩家自身）
//   - mergeCombatContext(context)   ← player_info.combat_context（战斗派生字段）
//
// 读取出口（computed / getter）：
//   - aliveList   ← 所有存活角色（state === 0），供 entities 渲染
//   - enemyList   ← 所有存活敌人（type > 0）
//   - player      ← 玩家自身（type === 0）
//   - getCharacter(pid) ← 按 pid 查询
//
// 关联文档：oblivions/docs/地图实体真值源统一设计案.md
// ══════════════════════════════════════════════════

import { defineStore } from 'pinia';
import { reactive, computed } from 'vue';
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
function normalizeEnemy(enemy: Enemy): Partial<Character> {
  return {
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
    discovered: Boolean(enemy.discovered),
  };
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

  // ══════════════════════════════════════════════════
  // 写入方法
  // ══════════════════════════════════════════════════

  /**
   * 合并 enemies scope 数据
   *
   * 语义：区域清理 + 合并写入
   * 1. 清理：不在新列表中且 pgroup !== 当前区域的旧角色（跨区域移动后旧区域敌人残留清理）
   * 2. 合并：已存在的角色更新字段，新角色插入
   *
   * 区域清理用 mapStore.curRegion（来自 game_map scope，移动后最先到达）。
   * 玩家角色安全性：enemies 列表不含玩家自身，newPids 不含玩家 pid；
   * 但玩家 pgroup === currentRegion，清理条件 c.pgroup !== currentRegion 对玩家为 false，不会被误删。
   */
  function mergeEnemies(enemies: Enemy[]): void {
    const mapStore = useMapStore();
    const currentRegion = mapStore.curRegion;
    const newPids = new Set(enemies.map(e => num(e.pid)));

    // 区域清理
    for (const [pid, c] of characters) {
      if (!newPids.has(pid) && c.pgroup !== num(currentRegion)) {
        characters.delete(pid);
      }
    }

    // 合并新数据
    for (const enemy of enemies) {
      const pid = num(enemy.pid);
      const existing = characters.get(pid);
      const patch = normalizeEnemy(enemy);
      characters.set(pid, { ...(existing as Character), ...(patch as Character) } as Character);
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

  /** 所有存活敌人（type > 0） */
  const enemyList = computed<Character[]>(() =>
    aliveList.value.filter(c => c.type > 0),
  );

  /** 玩家自身（type === 0） */
  const player = computed<Character | undefined>(() =>
    [...characters.values()].find(c => c.type === 0),
  );

  return {
    characters,
    mergeEnemies,
    mergePlayer,
    mergeCombatContext,
    getCharacter,
    aliveList,
    enemyList,
    player,
  };
});
