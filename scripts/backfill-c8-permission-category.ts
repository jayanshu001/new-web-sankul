/*
 * C8 — Backfill Mongo permission categories into MySQL.
 *
 *   ws_permission_categories → ws_permission_category  (net-new table)
 *   ws_permissions.category_id ← remapped Mongo categoryId (optional)
 *
 * Strategy: net-new table → clear-then-insert. Assign FRESH SQL int ids
 * (auto-increment) while preserving Mongo order. Build a Mongo _id → SQL id
 * map. Then OPTIONALLY set ws_permissions.category_id: for each Mongo
 * Permission, map its Mongo categoryId → SQL category id and match the SQL
 * permission row by the (name, guard_name) natural key — UPDATE its
 * category_id; skip unmatched.
 *
 * Run: DATABASE_URL='...' MONGODB_URI='...' npx tsx scripts/backfill-c8-permission-category.ts
 */
import mongoose from "mongoose";
import dotenv from "dotenv";
import { prisma } from "../src/config/prisma";
import { PermissionCategory } from "../src/models/admin/PermissionCategory.model";
import { Permission } from "../src/models/admin/Permission.model";

dotenv.config();

(async () => {
  await mongoose.connect(process.env.MONGODB_URI as string, {
    serverSelectionTimeoutMS: 10000,
  });

  // ── 1. Clear net-new table, then insert categories (build mongoId → sqlId) ──
  await prisma.permissionCategoryRow.deleteMany({});

  const catMap = new Map<string, number>();
  const cats = await PermissionCategory.find({})
    .sort({ order: 1, _id: 1 })
    .lean();
  for (const c of cats) {
    const row = await prisma.permissionCategoryRow.create({
      data: {
        title: c.title,
        slug: c.slug,
        orderBy: c.order ?? 0,
        status: c.status ?? true,
        createdAt: c.createdAt ?? null,
        updatedAt: c.updatedAt ?? null,
      },
    });
    catMap.set(String(c._id), row.id);
  }
  console.log(`permission_category: ${cats.length}`);

  // ── 2. OPTIONAL: set ws_permissions.category_id by (name, guard_name) ──
  const perms = await Permission.find({}).lean();
  let updated = 0;
  let skipped = 0;
  for (const p of perms) {
    const sqlCatId = p.categoryId ? catMap.get(String(p.categoryId)) : undefined;
    if (!sqlCatId) {
      skipped++;
      continue;
    }
    const result = await prisma.adminPermissionRow.updateMany({
      where: { name: p.name, guardName: p.guardName },
      data: { categoryId: sqlCatId },
    });
    if (result.count > 0) updated += result.count;
    else skipped++;
  }
  console.log(`permissions linked: ${updated}, skipped: ${skipped}`);

  await mongoose.disconnect();
  await prisma.$disconnect();
  console.log("✅ C8 permission-category backfill complete");
  process.exit(0);
})();
