// Permission catalog: admin permissions grouped by category, read from the DB.
import { prisma } from "../../config/prisma";

/**
 * The catalog is rendered entirely from `ws_permissions` + `ws_permission_category`;
 * nothing comes from the in-code registry.
 */

export interface CatalogPermissionRow {
  id: string;
  name: string;
}

export interface CatalogCategory {
  id: number | null;
  title: string | null;
  slug: string | null;
  orderBy: number | null;
  permissions: CatalogPermissionRow[];
}

/** Uncategorised rows (category_id NULL / dangling) fall into a trailing null-category bucket. */
export const getCatalogFromDb = async (guard: string): Promise<CatalogCategory[]> => {
  const [rows, categories] = await Promise.all([
    prisma.adminPermissionRow.findMany({
      where: { guardName: guard },
      select: { id: true, name: true, categoryId: true },
      orderBy: { name: "asc" },
    }),
    prisma.permissionCategoryRow.findMany({
      select: { id: true, title: true, slug: true, orderBy: true },
      orderBy: [{ orderBy: "asc" }, { id: "asc" }],
    }),
  ]);

  const buckets = new Map<number | null, CatalogCategory>();

  // Seed every category so empty ones are preserved in order_by order.
  for (const c of categories) {
    buckets.set(c.id, {
      id: c.id,
      title: c.title,
      slug: c.slug,
      orderBy: c.orderBy,
      permissions: [],
    });
  }

  const uncategorised: CatalogCategory = {
    id: null,
    title: null,
    slug: null,
    orderBy: null,
    permissions: [],
  };

  for (const r of rows) {
    const bucket =
      (r.categoryId != null && buckets.get(r.categoryId)) || uncategorised;
    bucket.permissions.push({ id: r.id.toString(), name: r.name });
  }

  const result = [...buckets.values()];
  if (uncategorised.permissions.length > 0) {
    result.push(uncategorised);
  }
  return result;
};
