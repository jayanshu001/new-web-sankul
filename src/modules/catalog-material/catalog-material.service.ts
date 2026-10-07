// Material categories: category lookup and directory children.
import { catalogMaterialRepository as repo } from "./catalog-material.repository";
import { toMaterialCategoryDto } from "./catalog-material.transformer";
import type {
  MaterialCategoryChildrenResult,
  MaterialCategoryDto,
} from "./catalog-material.types";

export const parseMaterialCategoryId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

export const findCategoryById = async (id: number): Promise<MaterialCategoryDto | null> => {
  const row = await repo.findCategoryById(id);
  return row ? toMaterialCategoryDto(row) : null;
};

/** Each child carries `count` (active materials) and `havingChildDirectory`. Null if the parent is missing. */
export const getCategoryChildren = async (
  parentId: number,
  search?: string,
  paging?: { skip?: number; take?: number }
): Promise<MaterialCategoryChildrenResult | null> => {
  const parentRow = await repo.findCategoryById(parentId);
  if (!parentRow) return null;

  const searchOpt = search?.trim() || undefined;
  const [children, total] = await Promise.all([
    repo.listActiveChildren(parentId, { search: searchOpt, skip: paging?.skip, take: paging?.take }),
    repo.countActiveChildren(parentId, { search: searchOpt }),
  ]);

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

  return { parent: toMaterialCategoryDto(parentRow), list, total };
};
