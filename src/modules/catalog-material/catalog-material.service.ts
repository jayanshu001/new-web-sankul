/**
 * Catalog · Material service — dual-path (MySQL/Prisma ↔ Mongo/Mongoose).
 *
 * Module key: `catalog-material` (flag OFF). Scoped to the category-navigation
 * surface: `getCategoryChildren` reproduces `listMaterialCategoryChildren`
 * (parent → active children + per-child material count + has-grandchildren).
 *
 * The Mongo `childCategoryIds[]` embedded array has no SQL column; children are
 * resolved via the SQL `parent` self-FK (`WHERE parent = id`). See types.ts for
 * the blocked item-listing scope (entitlement + LiveCourse + Mongo embeds).
 */
import { isMysqlModule } from "../../config/migration";
import { catalogMaterialRepository as repo } from "./catalog-material.repository";
import { toMaterialCategoryDto } from "./catalog-material.transformer";
import type {
  MaterialCategoryChildrenResult,
  MaterialCategoryDto,
} from "./catalog-material.types";

export const MATERIAL_MODULE = "catalog-material";
export const isMaterialMysql = (): boolean => isMysqlModule(MATERIAL_MODULE);

/** Parse a string id to a positive int, else null. */
export const parseMaterialCategoryId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** Single material category by id (the navigation `parent`). */
export const findCategoryById = async (id: number): Promise<MaterialCategoryDto | null> => {
  const row = await repo.findCategoryById(id);
  return row ? toMaterialCategoryDto(row) : null;
};

/**
 * The `listMaterialCategoryChildren` composition: parent category + its active
 * children, each with a `count` (active materials in it) and
 * `havingChildDirectory` (≥1 grandchild). Returns null if the parent is missing.
 */
export const getCategoryChildren = async (
  parentId: number,
  search?: string
): Promise<MaterialCategoryChildrenResult | null> => {
  const parentRow = await repo.findCategoryById(parentId);
  if (!parentRow) return null;

  const children = await repo.listActiveChildren(parentId, {
    search: search?.trim() || undefined,
  });

  const childIds = children.map((c) => c.id);
  const [counts, parentsWithKids] = await Promise.all([
    Promise.all(childIds.map((cid) => repo.countActiveMaterials(cid))),
    repo.parentsWithChildren(childIds),
  ]);
  const hasKids = new Set(parentsWithKids.map((r) => r.parent));

  const list = children.map((c, i) => ({
    category: {
      ...toMaterialCategoryDto(c),
      count: counts[i],
      havingChildDirectory: hasKids.has(c.id),
    },
  }));

  return { parent: toMaterialCategoryDto(parentRow), list };
};
