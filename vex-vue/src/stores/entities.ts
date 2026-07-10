// ══════════════════════════════════════════════════
// entities store
//
// 替代 actorsStore，泛化为多实体数据层。
// entities computed 从 CharacterHub（characterStore.aliveList）派生。
//
// 关键设计（CharacterHub 改造后）：
//   - 数据源统一为 characterStore.aliveList（所有存活角色 state === 0）
//   - 不再区分战斗/探索模式——所有存活实体都显示，活跃度由 inCombat 标记 + 渲染层半透明表达
//   - 玩家位置优先用 characterStore.player?.pls，回退 mapStore.curLoc（避免 player_info 未加载时玩家 actor 消失）
//   - entities computed 不依赖 playerAvatarStore.isDown
//     避免 isDown 变化触发 entities 重算 → watch(entities) → syncAllPositions
//   - 玩家 actor 的 isDown 在 useMapEntities.updateEntityZIndex 中实时读取
// ══════════════════════════════════════════════════

import { defineStore } from 'pinia';
import { computed } from 'vue';
import { useMapStore } from '@/stores/map';
import { useCharacterStore } from '@/stores/character';
import type { MapEntity } from '@/types/map-entity';

export const useEntitiesStore = defineStore('entities', () => {
  const mapStore = useMapStore();
  const characterStore = useCharacterStore();

  // ── 所有地图实体（响应式，从 CharacterHub 派生） ──
  // 注：不依赖 playerAvatarStore.isDown，避免 isDown 变化触发 entities 重算
  // 玩家 actor 的 isDown 在 useMapEntities.updateEntityZIndex 中实时读取
  const entities = computed<MapEntity[]>(() => {
    const list: MapEntity[] = [];
    const playerPls = characterStore.player?.pls ?? mapStore.curLoc;

    for (const c of characterStore.aliveList) {
      const isPlayer = c.type === 0;
      list.push({
        id: isPlayer ? 'player' : `enemy-${c.pid}`,
        kind: 'actor',
        actorKind: isPlayer ? 'player' : 'enemy',
        characterPid: c.pid,
        pls: isPlayer ? (playerPls ?? c.pls) : c.pls,
        img: isPlayer ? '/img/1.png' : `/img/n_${c.type}.png`,
        imgHeightRatio: 1.25,
        inCombat: c.combat?.inCombat ?? false,
      });
    }

    return list;
  });

  return { entities };
});
