/*
 * Backfill ws_package.package_category_id from Mongo ws_packages.
 * Cross-store keys: package matched by NAME (SQL legacy id ≠ Mongo _id);
 * category matched by SLUG (ws_package_category was backfilled preserving slug).
 * Idempotent: recomputes the link for every Mongo package that has a category.
 */
import mongoose from "mongoose";
import dotenv from "dotenv";
import { prisma } from "../src/config/prisma";

dotenv.config();

(async () => {
  await mongoose.connect(process.env.MONGODB_URI as string, { serverSelectionTimeoutMS: 10000 });
  const db = mongoose.connection.db!;

  // Mongo category _id → slug
  const mCats = await db.collection("ws_package_categories").find({}).project({ _id: 1, slug: 1 }).toArray();
  const mongoCatSlug = new Map(mCats.map((c) => [String(c._id), c.slug as string]));

  // SQL category slug → SQL id
  const sCats = await prisma.packageCategory.findMany({ select: { id: true, slug: true } });
  const sqlCatBySlug = new Map(sCats.map((c) => [c.slug, c.id]));

  // SQL package name → SQL id (names should be unique enough in this dataset)
  const sPkgs = await prisma.package.findMany({ select: { id: true, name: true } });
  const sqlPkgByName = new Map(sPkgs.map((p) => [p.name, p.id]));

  const mPkgs = await db.collection("ws_packages").find({ packageCategoryId: { $ne: null } }).project({ name: 1, packageCategoryId: 1 }).toArray();

  let linked = 0, skippedPkg = 0, skippedCat = 0;
  for (const p of mPkgs) {
    const sqlPkgId = sqlPkgByName.get(p.name);
    if (!sqlPkgId) { skippedPkg++; console.log(`  ⚠ no SQL package for name="${p.name}"`); continue; }
    const slug = mongoCatSlug.get(String(p.packageCategoryId));
    const sqlCatId = slug ? sqlCatBySlug.get(slug) : undefined;
    if (!sqlCatId) { skippedCat++; console.log(`  ⚠ no SQL category for mongo cat ${p.packageCategoryId} (slug=${slug})`); continue; }
    await prisma.package.update({ where: { id: sqlPkgId }, data: { packageCategoryId: sqlCatId } });
    linked++;
  }
  console.log(`linked=${linked} skippedPkg=${skippedPkg} skippedCat=${skippedCat}`);

  await mongoose.disconnect();
  await prisma.$disconnect();
  process.exit(0);
})();
