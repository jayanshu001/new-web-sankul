/**
 * Catalog · Material (READ) — MySQL (Prisma) branch types.
 *
 * Tables: `ws_material` (226 rows) + `ws_material_category` (Phase: content
 * vertical; flag OFF). This module is scoped to the **category-navigation**
 * surface (`listMaterialCategoryChildren`) — the genuinely-wirable part.
 *
 * ⚠ SCOPE — the material ITEM listings stay BLOCKED (not built here):
 * `listMaterialsByCategory` gates each item via `getPurchasedMaterialIds`
 * (src/client/material/entitlement.ts), which joins **LiveCourse +
 * LiveCourseSubscription** (unmigrated) and reads the **Mongo-only embedded
 * `materialCategories.category[]`** arrays on Course/Package/LiveCourse. Also
 * `ws_material` has **no `isPaid` column** (the item filter is Mongo-only). So
 * only the category tree (parent → children + per-child material count) is
 * reproducible from SQL this pass.
 *
 * STRUCTURAL TRANSLATION (Mongo embedded ids → SQL parent-FK):
 *  - Mongo `MaterialCategory.childCategoryIds[]` (embedded) has NO SQL column.
 *    The SQL `ws_material_category.parent` (self-FK) is the equivalent: the
 *    children of category X are `WHERE parent = X`. `havingChildDirectory` →
 *    "does this category have any row with parent = its id".
 *
 * Ids are returned as strings to stay Mongo `_id`-shape compatible.
 */

/** `ws_material_category` row → DTO (Mongo `MaterialCategory`-shaped). */
export interface MaterialCategoryDto {
  _id: string;
  title: string;
  slug: string;
  image: string | null;
  /** SQL self-FK parent id (0 = root). */
  parent: number;
  order: number;
  status: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
}

/** A child category in the navigation list: category + count + has-children. */
export interface MaterialCategoryChildDto extends MaterialCategoryDto {
  /** Count of active materials directly in this category. */
  count: number;
  /** True when ≥1 category has `parent = this.id` (SQL equiv of childCategoryIds). */
  havingChildDirectory: boolean;
}

/** The `listMaterialCategoryChildren` response payload. */
export interface MaterialCategoryChildrenResult {
  parent: MaterialCategoryDto;
  list: Array<{ category: MaterialCategoryChildDto }>;
}
