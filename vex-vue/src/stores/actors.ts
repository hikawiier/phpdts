import { defineStore } from 'pinia';
import { computed } from 'vue';
import { useMapStore } from '@/stores/map';
import type { Actor } from '@/types/actor';

export const useActorsStore = defineStore('actors', () => {
  const mapStore = useMapStore();

  // ── actor 列表（响应式，从 mapStore 派生） ──
  const actors = computed<Actor[]>(() => {
    const list: Actor[] = [];

    // 玩家 actor（当前格存在时）
    if (mapStore.curLoc !== null && mapStore.curRegion !== null) {
      list.push({
        id: 'player',
        kind: 'player',
        pls: mapStore.curLoc,
        img: '/img/4.png',
      });
    }

    // 敌人 actors（state===0 的活动敌人，预留，当前不渲染立绘）
    // 未来启用时取消注释
    // if (mapStore.enemies) {
    //   for (const e of mapStore.enemies) {
    //     if (Number(e.state) === 0) {
    //       list.push({
    //         id: `enemy-${e.pid}`,
    //         kind: 'enemy',
    //         pls: e.pls,
    //         img: `/img/enemy_${e.icon}.png`,
    //       });
    //     }
    //   }
    // }

    return list;
  });

  return { actors };
});
