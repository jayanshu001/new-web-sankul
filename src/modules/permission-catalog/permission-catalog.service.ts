import { prisma } from "../../config/prisma";

/**
 * SQL home for the permissions CATALOG read path (catalog.controller).
 *
 * The catalog is rendered ENTIRELY from the database — `ws_permissions` rows and
 * their `ws_permission_category` (via `category_id`). Nothing is sourced from the
 * in-code registry: only fields that actually exist in the tables are surfaced
 * (permission `id`/`name`, and the owning category's `id`/`title`/`slug`).
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

/**
 * Build the guard-scoped catalog straight from the DB: every ws_permissions row
 * for the guard, grouped under its ws_permission_category. Uncategorised rows
 * (category_id NULL / dangling) fall into a trailing bucket with a null category.
 */
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

  // Seed one bucket per known category so empty categories are preserved and the
  // category ordering (order_by) is respected.
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
