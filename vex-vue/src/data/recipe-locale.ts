export interface RecipeLocaleEntry {
  name: string;
  desc: string;
}

export const RECIPE_LOCALE: Record<string, RecipeLocaleEntry> = {};

export function getRecipeName(recipeId: string | number | undefined, fallbackName?: string): string {
  if (recipeId === undefined || recipeId === null || recipeId === '') return fallbackName || '';
  const key = String(recipeId);
  return RECIPE_LOCALE[key]?.name || fallbackName || key;
}

export function getRecipeDesc(recipeId: string | number | undefined, fallbackDesc?: string): string {
  if (recipeId === undefined || recipeId === null || recipeId === '') return fallbackDesc || '';
  return RECIPE_LOCALE[String(recipeId)]?.desc || fallbackDesc || '';
}
