// ══════════════════════════════════════════════════
// entities store
//
// 替代 actorsStore，泛化为多实体数据层。
// entities computed 从 CharacterHub（characterStore.mapVisibleList）派生。
//
// 关键设计（CharacterHub 改造后）：
//   - 角色资料缓存与地图 roster 分离；隐藏但已知的 NPC 不生成 MapEntity
//   - enemies scope 决定 NPC roster，PresentationScene 决定演出期间 Actor 生命周期
//   - 玩家位置优先用 characterStore.player?.pls，回退 mapStore.curLoc（避免 player_info 未加载时玩家 actor 消失）
//   - entities computed 不依赖 playerAvatarStore.isDown
//     避免 isDown 变化触发 entities 重算 → watch(entities) → syncAllPositions
//   - 玩家 actor 的 isDown 在 useMapEntities.updateEntityZIndex 中实时读取
// ══════════════════════════════════════════════════

import { defineStore } from 'pinia';
import { computed } from 'vue';
import { useMapStore } from '@/stores/map';
import { useCharacterStore } from '@/stores/character';
import { usePlayerAvatarStore } from '@/stores/player-avatar';
import type { MapEntity } from '@/types/map-entity';

export const useEntitiesStore = defineStore('entities', () => {
  const mapStore = useMapStore();
  const characterStore = useCharacterStore();
  const playerAvatarStore = usePlayerAvatarStore();

  // ── 所有地图实体（响应式，从 CharacterHub 的权威 map roster 派生） ──
  // 注：不依赖 playerAvatarStore.isDown，避免 isDown 变化触发 entities 重算
  // 玩家 actor 的 isDown 在 useMapEntities.updateEntityZIndex 中实时读取
  const entities = computed<MapEntity[]>(() => {
    const list: MapEntity[] = [];
    const playerTile = mapStore.currentTile;

    for (const c of characterStore.mapVisibleList) {
      const isPlayer = c.type === 0;
      list.push({
        id: isPlayer ? 'player' : `enemy-${c.pid}`,
        kind: 'actor',
        actorKind: isPlayer ? 'player' : 'enemy',
        characterPid: c.pid,
        pls: isPlayer ? (playerTile?.pls ?? c.pls) : c.pls,
        pgroup: isPlayer ? (playerTile?.pgroup ?? c.pgroup) : c.pgroup,
        img: isPlayer ? playerAvatarStore.currentImage : `/img/n_${c.type}.png`,
        imgHeightRatio: 1.25,
        inCombat: c.combat?.inCombat ?? false,
      });
    }

    return list;
  });

  return { entities };
});
