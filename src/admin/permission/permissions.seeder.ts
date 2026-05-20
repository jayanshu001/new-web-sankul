import logger from "../../utils/logger";
import { Permission } from "../../models/admin/Permission.model";
import { PermissionCategory } from "../../models/admin/PermissionCategory.model";
import { PERMISSION_CATALOG, ALL_CATALOG_KEYS } from "./permissions.catalog";

const DEFAULT_GUARD = "api";

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
  // 1) Ensure a PermissionCategory exists for every group used in the catalog.
  const groups = Array.from(new Set(PERMISSION_CATALOG.map((m) => m.group)));
  const categoryIdByGroup = new Map<string, any>();

  for (let i = 0; i < groups.length; i++) {
    const title = groups[i];
    const slug = slugify(title);
    const cat = await PermissionCategory.findOneAndUpdate(
      { slug },
      { $setOnInsert: { title, slug, order: i, status: true } },
      { new: true, upsert: true }
    ).lean();
    categoryIdByGroup.set(title, cat!._id);
  }

  // 2) Upsert one Permission row per catalog key (name = key).
  let inserted = 0;
  for (const m of PERMISSION_CATALOG) {
    const categoryId = categoryIdByGroup.get(m.group);
    for (const p of m.permissions) {
      const result = await Permission.updateOne(
        { name: p.key, guardName: DEFAULT_GUARD },
        { $setOnInsert: { name: p.key, guardName: DEFAULT_GUARD, categoryId } },
        { upsert: true }
      );
      if ((result as any).upsertedCount > 0) inserted++;
    }
  }

  // 3) Report DB keys that are no longer in the catalog (deprecated).
  const dbKeys = await Permission.find({ guardName: DEFAULT_GUARD }, { name: 1 }).lean();
  const deprecated = dbKeys.map((r) => r.name).filter((k) => !ALL_CATALOG_KEYS.has(k));

  logger.info(
    `[permissions] catalog sync complete — inserted: ${inserted}, total catalog keys: ${ALL_CATALOG_KEYS.size}, deprecated rows: ${deprecated.length}`
  );
  if (deprecated.length > 0) {
    logger.warn(`[permissions] deprecated keys still in DB: ${deprecated.join(", ")}`);
  }
}
