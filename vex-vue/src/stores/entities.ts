// ══════════════════════════════════════════════════
// entities store
//
// 替代 actorsStore，泛化为多实体数据层。
// entities computed 从 mapStore 派生，初版只含玩家 actor。
//
// 关键设计（v2）：
//   - entities computed 不依赖 playerAvatarStore.isDown
//     避免 isDown 变化触发 entities 重算 → watch(entities) → syncAllPositions
//   - 玩家 actor 的 isDown 在 useMapEntities.updateEntityZIndex 中
//     实时从 playerAvatarStore.isDown 读取
// ══════════════════════════════════════════════════

import { defineStore } from 'pinia';
import { computed } from 'vue';
import { useMapStore } from '@/stores/map';
import { useBattleStore } from '@/stores/battle';
import type { MapEntity } from '@/types/map-entity';

export const useEntitiesStore = defineStore('entities', () => {
  const mapStore = useMapStore();
  const battleStore = useBattleStore();

  // ── 所有地图实体（响应式，从 mapStore 派生） ──
  // 注：不依赖 playerAvatarStore.isDown，避免 isDown 变化触发 entities 重算
  // 玩家 actor 的 isDown 在 useMapEntities.updateEntityZIndex 中实时读取
  const entities = computed<MapEntity[]>(() => {
    const list: MapEntity[] = [];
    const combatContext = battleStore.combatContext;

    if (battleStore.currentMode === 'battle' && combatContext) {
      for (const combatant of combatContext.combatants) {
        if (!combatant.active || Number(combatant.state) > 0) continue;
        const isPlayer = Number(combatant.type) === 0;
        list.push({
          id: isPlayer ? 'player' : `enemy-${combatant.pid}`,
          kind: 'actor',
          actorKind: isPlayer ? 'player' : 'enemy',
          pls: combatant.pls,
          img: isPlayer ? '/img/1.png' : `/img/n_${combatant.type}.png`,
          imgHeightRatio: 1.25,
        });
      }
      return list;
    }

    // 玩家 actor
    if (mapStore.curLoc !== null && mapStore.curRegion !== null) {
      list.push({
        id: 'player',
        kind: 'actor',
        actorKind: 'player',
        pls: mapStore.curLoc,
        img: '/img/1.png',
        imgHeightRatio: 1.25,
      });
    }

    // 敌人 actors（state===0 的活动敌人）
    if (mapStore.enemies) {
      for (const e of mapStore.enemies) {
        if (Number(e.state) === 0) {
          list.push({
            id: `enemy-${e.pid}`,
            kind: 'actor',
            actorKind: 'enemy',
            pls: e.pls,
            img: `/img/n_${e.type}.png`,
            imgHeightRatio: 1.25,
          });
        }
      }
    }

    // 未来：NPC / POI / 草丛 / 蠕虫 / 裂隙
    // 各自从 mapStore 数据派生，push 到 list

    return list;
  });

  return { entities };
});
