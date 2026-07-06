<script setup lang="ts">
// ══════════════════════════════════════════════════
// 合成配方列表 / Craft Recipe List
//
// 子组件：渲染配方列表，两级分组。
//
// 两级分组（设计案 §3.2）：
//   第一级：可合成 / 素材不全 / 无关联素材（三组分类，关联匹配）
//   第二级：category（food / tool / armor / weapon）
//
// 三组分类规则（关联匹配，不检查数量）：
//   - 可合成：每个 material 都能在背包或工作台找到匹配项（全匹配）
//   - 素材不全：背包素材能匹配至少一个 material，但不是所有 material 都有匹配
//   - 无关联素材：背包素材完全不能匹配任何 material
//
// 点击行为：
//   - 配方名点击：可合成组→quickCraft/fillMaterials；素材不全组→fillMaterials；无关联组→无操作
//   - +/- 点击：所有组统一展开/折叠完整配方（显示 materials）
// ══════════════════════════════════════════════════

import { ref, computed } from 'vue';
import type { CraftRecipe, CraftMaterial, WorkbenchMaterial, InventoryItem } from '@/types/api';
import { itemMatchesMaterial, wbMatchesMaterial } from '@/stores/craft';
import { getRecipeName, getCategoryLabel } from '@/data/recipe-locale';
import { getItemName } from '@/data/item-locale';
import { getItmkName } from '@/data/itmk-locale';
import { getTagName } from '@/data/tag-locale';

type RecipeGroupKind = 'craftable' | 'partial' | 'unrelated';

const props = defineProps<{
  recipes: CraftRecipe[];
  availableWbMaterials: WorkbenchMaterial[];
  inventorySlots: InventoryItem[];
  /** 当前 previewResult.recipe_id（精确可合成时非 null，用于 * 标记） */
  currentRecipeId: string | null;
}>();

const emit = defineEmits<{
  quickCraft: [recipeId: string];
  fillMaterials: [recipeId: string];
}>();

// ── 分组展开状态 ──
const craftableGroupExpanded = ref(true);
const partialGroupExpanded = ref(false);
const unrelatedGroupExpanded = ref(false);
const expandedCategories = ref<Set<string>>(new Set());
const userToggledCategories = ref<Set<string>>(new Set()); // 用户主动 toggle 过的分类
const expandedRecipes = ref<Set<string>>(new Set()); // 无关联组配方的 materials 展开

function toggleCategory(group: RecipeGroupKind, category: string): void {
  const key = `${group}:${category}`;
  userToggledCategories.value.add(key);
  if (expandedCategories.value.has(key)) {
    expandedCategories.value.delete(key);
  } else {
    expandedCategories.value.add(key);
  }
}

function isCategoryExpanded(group: RecipeGroupKind, category: string): boolean {
  const key = `${group}:${category}`;
  if (userToggledCategories.value.has(key)) {
    return expandedCategories.value.has(key);
  }
  // 默认：可合成组分类展开，其他组分类折叠（§3.2）
  return group === 'craftable';
}

function toggleRecipeExpand(recipeId: string): void {
  if (expandedRecipes.value.has(recipeId)) {
    expandedRecipes.value.delete(recipeId);
  } else {
    expandedRecipes.value.add(recipeId);
  }
}

// ── 三组分类判定 ──

/**
 * 判定配方分类（关联匹配，不检查数量）
 *
 * 规则：
 *   - 工作台 material（consume='none'）：只检查工作台是否匹配，不影响 hasBackpackMatch
 *   - 背包 material：匹配则 hasBackpackMatch=true，不匹配则 allMaterialsMatch=false
 *
 * @returns 'craftable'（全匹配）/ 'partial'（背包有关联但不全）/ 'unrelated'（背包完全无关联）
 */
function classifyRecipe(recipe: CraftRecipe): RecipeGroupKind {
  let hasBackpackMatch = false;
  let allMaterialsMatch = true;

  for (const mat of recipe.materials) {
    if (mat.consume === 'none') {
      const wbMatch = props.availableWbMaterials.some(wb => wbMatchesMaterial(wb, mat));
      if (!wbMatch) allMaterialsMatch = false;
    } else {
      const invMatch = props.inventorySlots.some(
        inv => !inv.empty && itemMatchesMaterial(inv, mat),
      );
      if (invMatch) {
        hasBackpackMatch = true;
      } else {
        allMaterialsMatch = false;
      }
    }
  }

  if (allMaterialsMatch) return 'craftable';
  if (hasBackpackMatch) return 'partial';
  return 'unrelated';
}

// ── 两级分组计算 ──

interface RecipeGroup {
  category: string;
  recipes: CraftRecipe[];
}

function buildGroups(kind: RecipeGroupKind): RecipeGroup[] {
  const map = new Map<string, CraftRecipe[]>();
  for (const recipe of props.recipes) {
    if (classifyRecipe(recipe) !== kind) continue;
    const cat = recipe.category || 'other';
    if (!map.has(cat)) map.set(cat, []);
    map.get(cat)!.push(recipe);
  }
  return Array.from(map.entries()).map(([category, recipes]) => ({ category, recipes }));
}

const craftableGroups = computed<RecipeGroup[]>(() => buildGroups('craftable'));
const partialGroups = computed<RecipeGroup[]>(() => buildGroups('partial'));
const unrelatedGroups = computed<RecipeGroup[]>(() => buildGroups('unrelated'));

const craftableCount = computed(() =>
  craftableGroups.value.reduce((sum, g) => sum + g.recipes.length, 0),
);
const partialCount = computed(() =>
  partialGroups.value.reduce((sum, g) => sum + g.recipes.length, 0),
);
const unrelatedCount = computed(() =>
  unrelatedGroups.value.reduce((sum, g) => sum + g.recipes.length, 0),
);

// ── 点击处理 ──

function onRecipeNameClick(recipe: CraftRecipe, group: RecipeGroupKind): void {
  // 无关联素材组：无操作（背包无关联素材，填充无意义）
  if (group === 'unrelated') return;
  // 素材不全组：fillMaterials（部分填充）
  if (group === 'partial') {
    emit('fillMaterials', recipe.recipe_id);
    return;
  }
  // 可合成组 + 精确匹配 → quickCraft；否则 → fillMaterials
  if (group === 'craftable' && props.currentRecipeId === recipe.recipe_id) {
    emit('quickCraft', recipe.recipe_id);
  } else {
    emit('fillMaterials', recipe.recipe_id);
  }
}

// ── 辅助渲染 ──

function materialDesc(mat: CraftMaterial): string {
  let target = '';
  if (mat.item_id) target = getItemName(mat.item_id);
  else if (mat.itmk) target = '任意 ' + getItmkName(mat.itmk);
  else if (mat.tag) target = '任意 ' + getTagName(mat.tag);
  const count = mat.count ?? 1;
  const consume = mat.consume ?? 'all';
  const consumeLabel = consume === 'none' ? '不消耗' : consume === 'durability' ? '扣耐久' : '';
  return `${target}×${count}${consumeLabel ? ' (' + consumeLabel + ')' : ''}`;
}
</script>

<template>
  <div class="recipe-list">
    <!-- 加载失败/空状态 -->
    <div v-if="recipes.length === 0" class="recipe-empty dim">配方列表加载失败</div>

    <template v-else>
      <!-- v 可合成组 -->
      <div class="recipe-group" v-if="craftableCount > 0">
        <div
          class="group-header craftable"
          @click="craftableGroupExpanded = !craftableGroupExpanded"
        >
          <span class="toggle">{{ craftableGroupExpanded ? '-' : '+' }}</span>
          <span class="group-label">可合成</span>
          <span class="group-count dim">({{ craftableCount }})</span>
        </div>
        <template v-if="craftableGroupExpanded">
          <div
            v-for="g in craftableGroups"
            :key="'c-' + g.category"
            class="category-block"
          >
            <div
              class="category-header"
              @click="toggleCategory('craftable', g.category)"
            >
              <span class="toggle">{{ isCategoryExpanded('craftable', g.category) ? '-' : '+' }}</span>
              <span class="category-label">{{ getCategoryLabel(g.category) }}</span>
              <span class="dim">({{ g.recipes.length }})</span>
            </div>
            <div v-if="isCategoryExpanded('craftable', g.category)" class="category-items">
              <div
                v-for="recipe in g.recipes"
                :key="recipe.recipe_id"
                class="recipe-row craftable"
                :class="{ precise: currentRecipeId === recipe.recipe_id }"
              >
                <span v-if="currentRecipeId === recipe.recipe_id" class="precise-marker">*</span>
                <span v-else class="marker-space"></span>
                <span class="recipe-name" @click="onRecipeNameClick(recipe, 'craftable')">{{ getRecipeName(recipe.recipe_id) }}</span>
                <span class="expand-toggle dim" @click.stop="toggleRecipeExpand(recipe.recipe_id)">
                  {{ expandedRecipes.has(recipe.recipe_id) ? '-' : '+' }}
                </span>
                <div
                  v-if="expandedRecipes.has(recipe.recipe_id)"
                  class="recipe-materials dim"
                >
                  <div v-for="(mat, i) in recipe.materials" :key="i" class="material-row">
                    - {{ materialDesc(mat) }}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </template>
      </div>

      <!-- v 素材不全组 -->
      <div class="recipe-group" v-if="partialCount > 0">
        <div
          class="group-header partial"
          @click="partialGroupExpanded = !partialGroupExpanded"
        >
          <span class="toggle">{{ partialGroupExpanded ? '-' : '+' }}</span>
          <span class="group-label">素材不全</span>
          <span class="group-count dim">({{ partialCount }})</span>
        </div>
        <template v-if="partialGroupExpanded">
          <div
            v-for="g in partialGroups"
            :key="'p-' + g.category"
            class="category-block"
          >
            <div
              class="category-header"
              @click="toggleCategory('partial', g.category)"
            >
              <span class="toggle">{{ isCategoryExpanded('partial', g.category) ? '-' : '+' }}</span>
              <span class="category-label">{{ getCategoryLabel(g.category) }}</span>
              <span class="dim">({{ g.recipes.length }})</span>
            </div>
            <div v-if="isCategoryExpanded('partial', g.category)" class="category-items">
              <div
                v-for="recipe in g.recipes"
                :key="recipe.recipe_id"
                class="recipe-row partial"
              >
                <span class="marker-space"></span>
                <span class="recipe-name" @click="onRecipeNameClick(recipe, 'partial')">{{ getRecipeName(recipe.recipe_id) }}</span>
                <span class="expand-toggle dim" @click.stop="toggleRecipeExpand(recipe.recipe_id)">
                  {{ expandedRecipes.has(recipe.recipe_id) ? '-' : '+' }}
                </span>
                <div
                  v-if="expandedRecipes.has(recipe.recipe_id)"
                  class="recipe-materials dim"
                >
                  <div v-for="(mat, i) in recipe.materials" :key="i" class="material-row">
                    - {{ materialDesc(mat) }}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </template>
      </div>

      <!-- v 无关联素材组 -->
      <div class="recipe-group" v-if="unrelatedCount > 0">
        <div
          class="group-header uncraftable"
          @click="unrelatedGroupExpanded = !unrelatedGroupExpanded"
        >
          <span class="toggle">{{ unrelatedGroupExpanded ? '-' : '+' }}</span>
          <span class="group-label dim">无关联素材</span>
          <span class="group-count dim">({{ unrelatedCount }})</span>
        </div>
        <template v-if="unrelatedGroupExpanded">
          <div
            v-for="g in unrelatedGroups"
            :key="'u-' + g.category"
            class="category-block"
          >
            <div
              class="category-header"
              @click="toggleCategory('unrelated', g.category)"
            >
              <span class="toggle">{{ isCategoryExpanded('unrelated', g.category) ? '-' : '+' }}</span>
              <span class="category-label dim">{{ getCategoryLabel(g.category) }}</span>
              <span class="dim">({{ g.recipes.length }})</span>
            </div>
            <div v-if="isCategoryExpanded('unrelated', g.category)" class="category-items">
              <div
                v-for="recipe in g.recipes"
                :key="recipe.recipe_id"
                class="recipe-row uncraftable"
              >
                <span class="marker-space"></span>
                <span class="recipe-name dim" @click="onRecipeNameClick(recipe, 'unrelated')">{{ getRecipeName(recipe.recipe_id) }}</span>
                <span class="expand-toggle dim" @click.stop="toggleRecipeExpand(recipe.recipe_id)">
                  {{ expandedRecipes.has(recipe.recipe_id) ? '-' : '+' }}
                </span>
                <div
                  v-if="expandedRecipes.has(recipe.recipe_id)"
                  class="recipe-materials dim"
                >
                  <div v-for="(mat, i) in recipe.materials" :key="i" class="material-row">
                    - {{ materialDesc(mat) }}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </template>
      </div>
    </template>
  </div>
</template>

<style scoped>
.recipe-list {
  height: 100%;
  overflow-y: auto;
  font-size: 11px;
}

.recipe-empty {
  padding: 8px;
  text-align: center;
}

.recipe-group {
  margin-bottom: 4px;
}

.group-header {
  cursor: pointer;
  padding: 2px 4px;
  user-select: none;
}
.group-header:hover {
  background: rgba(255, 255, 255, 0.05);
}
.group-header.craftable .group-label {
  color: #ddd;
  font-weight: 700;
}
.group-header.partial .group-label {
  color: #aaa;
  font-weight: 700;
}

.toggle {
  display: inline-block;
  width: 12px;
  color: #888;
}

.category-block {
  margin-left: 12px;
}

.category-header {
  cursor: pointer;
  padding: 2px 4px;
  user-select: none;
}
.category-header:hover {
  background: rgba(255, 255, 255, 0.05);
}
.category-label {
  color: #bbb;
}

.category-items {
  margin-left: 12px;
}

.recipe-row {
  cursor: pointer;
  padding: 2px 4px;
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
}
.recipe-row:hover {
  background: rgba(255, 255, 255, 0.05);
}
.recipe-row.craftable {
  color: #bbb;
}
.recipe-row.craftable.precise .recipe-name {
  color: #fff;
  font-weight: 700;
}
.recipe-row.partial {
  color: #999;
}
.recipe-row.uncraftable {
  color: #777;
}

.precise-marker {
  color: #fff;
  font-weight: 700;
  width: 12px;
  display: inline-block;
}
.marker-space {
  display: inline-block;
  width: 12px;
}

.recipe-name {
  flex: 1 1 auto;
}

.expand-toggle {
  margin-left: 4px;
}

.recipe-materials {
  width: 100%;
  margin-left: 12px;
  margin-top: 2px;
  margin-bottom: 2px;
}
.material-row {
  color: #666;
  font-size: 10px;
}

.dim {
  color: #555;
}
</style>
