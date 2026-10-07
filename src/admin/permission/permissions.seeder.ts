// Permission catalog: boot seeder that syncs ws_permissions to the code catalog.
import logger from "../../utils/logger";
import { PERMISSION_CATALOG, ALL_CATALOG_KEYS, catalogKeysForGuard } from "./permissions.catalog";
import { GUARDS } from "./permission.validation";
import { prisma } from "../../config/prisma";

// Seed only under assignable guards: a role can only hold permissions of its own
// guard, so a key under any other guard has no role that can use it.
const SEED_GUARDS = GUARDS;

/**
 * Inserts missing categories and permission rows. Non-catalog rows are left in
 * place (reported as deprecated) so old role assignments keep working.
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
      create: { title, slug, orderBy: i, status: true, createdAt: catNow, updatedAt: catNow },
      update: {},
    });
    categoryIdByGroup.set(title, cat.id);
  }

  // Each module seeds only under its own guard. skipDuplicates guards against
  // concurrent boots under a PM2 cluster.
  let inserted = 0;
  for (const guard of SEED_GUARDS) {
    const existing = await prisma.adminPermissionRow.findMany({
      where: { guardName: guard },
      select: { name: true },
    });
    const existingNames = new Set(existing.map((r) => r.name));
    const now = new Date();
    const toCreate: {
      name: string;
      guardName: string;
      categoryId: number | null;
      createdAt: Date;
      updatedAt: Date;
    }[] = [];
    for (const m of PERMISSION_CATALOG) {
      if (m.guard !== guard) continue;
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

  // Self-heal rows seeded before the timestamp middleware existed (NULL
  // created_at/updated_at). Idempotent: later runs match zero rows.
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

  // Deprecated = (guard, name) pairs not in that guard's catalog, so a web key
  // cross-seeded under another guard is reported too.
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

export async function syncPermissionCatalog(): Promise<void> {
  await syncPermissionCatalogSql();
}
