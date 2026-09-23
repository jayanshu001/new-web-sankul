import logger from "../../utils/logger";
import { PERMISSION_CATALOG, ALL_CATALOG_KEYS, catalogKeysForGuard } from "./permissions.catalog";
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
  const catNow = new Date();
  for (let i = 0; i < groups.length; i++) {
    const title = groups[i];
    const slug = slugify(title);
    const cat = await prisma.permissionCategoryRow.upsert({
      where: { slug },
      // Explicit timestamps on insert so ws_permission_category rows are never
      // NULL either; existing rows are kept untouched (mirror $setOnInsert).
      create: { title, slug, orderBy: i, status: true, createdAt: catNow, updatedAt: catNow },
      update: {}, // keep existing (mirror $setOnInsert)
    });
    categoryIdByGroup.set(title, cat.id);
  }

  // Guard-aware: each module seeds ONLY under its own guard (a role can only hold
  // permissions of its own guard, so web keys don't belong under promoter/educator
  // and vice-versa). Batched per guard: read existing names once, createMany the
  // missing ones (skipDuplicates guards against races under a PM2 cluster).
  let inserted = 0;
  for (const guard of SEED_GUARDS) {
    const existing = await prisma.adminPermissionRow.findMany({
      where: { guardName: guard },
      select: { name: true },
    });
    const existingNames = new Set(existing.map((r) => r.name));
    // Existing rows are REUSED as-is (matched by name+guard); only genuinely
    // missing keys are created. New rows carry explicit created_at/updated_at so
    // the columns are never NULL — the Prisma timestamp middleware would fill
    // them too, but rows seeded before that middleware existed came out NULL, so
    // we set them here explicitly (and backfill the legacy NULLs below).
    const now = new Date();
    const toCreate: {
      name: string;
      guardName: string;
      categoryId: number | null;
      createdAt: Date;
      updatedAt: Date;
    }[] = [];
    for (const m of PERMISSION_CATALOG) {
      if (m.guard !== guard) continue; // seed under the module's own guard only
      const categoryId = categoryIdByGroup.get(m.group) ?? null;
      for (const p of m.permissions) {
        if (!existingNames.has(p.key)) {
          toCreate.push({ name: p.key, guardName: guard, categoryId, createdAt: now, updatedAt: now });
        }
      }
    }
    if (toCreate.length) {
      const res = await prisma.adminPermissionRow.createMany({ data: toCreate, skipDuplicates: true });
      inserted += res.count;
    }
  }

  // Self-heal legacy NULL timestamps. Rows (permissions + categories) seeded
  // before the Prisma timestamp middleware existed have NULL created_at/updated_at.
  // Stamp them once with the current time (flows through the IST write-shift like
  // any other Prisma write). Idempotent: after the first run the filters match
  // zero rows. `updatedAt: null` in `data` is preserved by the middleware only
  // when we DON'T pass it — so we set both explicitly here.
  const healNow = new Date();
  const [permHeal, catHeal] = await Promise.all([
    prisma.adminPermissionRow.updateMany({
      where: { OR: [{ createdAt: null }, { updatedAt: null }] },
      data: { createdAt: healNow, updatedAt: healNow },
    }),
    prisma.permissionCategoryRow.updateMany({
      where: { OR: [{ createdAt: null }, { updatedAt: null }] },
      data: { createdAt: healNow, updatedAt: healNow },
    }),
  ]);
  if (permHeal.count || catHeal.count) {
    logger.info(
      `[permissions] backfilled NULL timestamps — permissions: ${permHeal.count}, categories: ${catHeal.count}`
    );
  }

  // Deprecated = DB rows whose (guard, name) pair isn't a live catalog entry for
  // that guard. Computed per guard so a cross-seeded web key under the promoter
  // guard is correctly reported (and can be cleaned up via the deploy DDL).
  let deprecated: string[] = [];
  for (const guard of SEED_GUARDS) {
    const liveKeys = catalogKeysForGuard(guard);
    const rows = await prisma.adminPermissionRow.findMany({
      where: { guardName: guard },
      select: { name: true },
    });
    for (const name of new Set(rows.map((r) => r.name))) {
      if (!liveKeys.has(name)) deprecated.push(`${guard}:${name}`);
    }
  }
  logger.info(
    `[permissions] catalog sync complete (sql) — guards: [${SEED_GUARDS.join(", ")}], inserted: ${inserted}, catalog keys total: ${ALL_CATALOG_KEYS.size}, deprecated (guard:name) pairs: ${deprecated.length}`
  );
  if (deprecated.length > 0) logger.warn(`[permissions] deprecated (non-catalog for their guard) names still in DB (sql): ${deprecated.join(", ")}`);
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
