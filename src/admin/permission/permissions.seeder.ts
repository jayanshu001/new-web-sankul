import logger from "../../utils/logger";
import { PERMISSION_CATALOG, ALL_CATALOG_KEYS } from "./permissions.catalog";
import { GUARDS } from "./permission.validation";
import { prisma } from "../../config/prisma";

/**
 * Guards the catalog is seeded under. A spatie permission row is guard-scoped and
 * a role can only be granted permissions of its OWN guard, so every catalog key
 * must exist under EACH assignable guard (web/educator/promoter) — otherwise a
 * role of that guard has no id to put in permission_ids. (Historically this
 * seeded a single, non-assignable "api" guard, which is why the table appeared
 * "not seeded from the catalog": the keys existed but under a guard no role uses.
 * See docs/backend-requests/permissions-table-not-seeded-from-catalog.md.)
 */
const SEED_GUARDS = GUARDS; // ["web", "educator", "promoter"]

/**
 * SQL catalog sync (ws_permission_category + ws_permissions) — mirrors the Mongo
 * sync. Runs at boot when `admin-rbac` is on (the SQL RBAC tables are then the
 * source of truth, read by admin-rbac/role.controller). Upserts a permission row
 * for every catalog key under every assignable guard; legacy/non-catalog rows are
 * left in place (reported as deprecated) so old assignments keep working.
 */
async function syncPermissionCatalogSql(): Promise<void> {
  const groups = Array.from(new Set(PERMISSION_CATALOG.map((m) => m.group)));
  const categoryIdByGroup = new Map<string, number>();
  for (let i = 0; i < groups.length; i++) {
    const title = groups[i];
    const slug = slugify(title);
    const cat = await prisma.permissionCategoryRow.upsert({
      where: { slug },
      create: { title, slug, orderBy: i, status: true },
      update: {}, // keep existing (mirror $setOnInsert)
    });
    categoryIdByGroup.set(title, cat.id);
  }

  // Batched per guard: read existing names once, createMany the missing ones
  // (skipDuplicates guards against races under a PM2 cluster). Avoids the old
  // per-key sequential findFirst (~250 × N guards) at boot.
  let inserted = 0;
  for (const guard of SEED_GUARDS) {
    const existing = await prisma.adminPermissionRow.findMany({
      where: { guardName: guard },
      select: { name: true },
    });
    const existingNames = new Set(existing.map((r) => r.name));
    const toCreate: { name: string; guardName: string; categoryId: number | null }[] = [];
    for (const m of PERMISSION_CATALOG) {
      const categoryId = categoryIdByGroup.get(m.group) ?? null;
      for (const p of m.permissions) {
        if (!existingNames.has(p.key)) toCreate.push({ name: p.key, guardName: guard, categoryId });
      }
    }
    if (toCreate.length) {
      const res = await prisma.adminPermissionRow.createMany({ data: toCreate, skipDuplicates: true });
      inserted += res.count;
    }
  }

  const dbKeys = await prisma.adminPermissionRow.findMany({
    where: { guardName: { in: [...SEED_GUARDS] } },
    select: { name: true },
  });
  const deprecated = [...new Set(dbKeys.map((r) => r.name).filter((k) => !ALL_CATALOG_KEYS.has(k)))];
  logger.info(
    `[permissions] catalog sync complete (sql) — guards: [${SEED_GUARDS.join(", ")}], inserted: ${inserted}, catalog keys/guard: ${ALL_CATALOG_KEYS.size}, deprecated names: ${deprecated.length}`
  );
  if (deprecated.length > 0) logger.warn(`[permissions] deprecated (non-catalog) names still in DB (sql): ${deprecated.join(", ")}`);
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/**
 * Sync ws_permissions + ws_permission_categories to match the catalog.
 *
 * - Insert missing categories (one per `group`) and missing permission rows.
 * - DB rows whose `name` is no longer in the catalog are left in place but
 *   reported in logs; the catalog endpoint surfaces them as deprecated so
 *   admins can clean up role assignments before hard-deletion.
 */
export async function syncPermissionCatalog(): Promise<void> {
  await syncPermissionCatalogSql();
}
